/* River gauges stay when zooming in past a live Flood Warning's edge (desktop and phone):
   start wide on a live Flood Warning already in effect (Flooding on, venue view); wait for its gauges to load; pick a loaded
   gauge whose point lies outside the warning's outline (else the gauge farthest from the outline's centre); zoom into it until
   the warning's outline is entirely off screen; the gauge must still be drawn, and tapping it must open its stage and
   hydrograph link. Skipped, and said so, when no Flood Warning is in effect anywhere.
   Usage: node tools/threats-gauge-zoom-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/gauge-zoom-check");
if (!HOST) { console.error("usage: node tools/threats-gauge-zoom-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const passNotice = async (p) => { if (/External Content Notice/.test(await p.title().catch(() => ""))) { await p.getByText("Open the page", { exact: false }).first().click(); await p.waitForLoadState("domcontentloaded"); } };

(async () => {
  const b = await chromium.launch();
  for (const [dev, opt] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { ...devices["iPhone 13"] }]]) {
    const ctx = await b.newContext(opt), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(HOST + "/threats.html?layers=flood&view=active&scope=national", { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
    await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.liveReady && !window.__threats.data.loading, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(3000);
    const fw = await p.evaluate(() => { const T = window.__threats, C = window.ThreatsCore, now = Date.now();
      const w = T.data.products.filter((x) => x.sourceId === "nws-alerts" && /Flood Warning/.test(x.event || "") && x.geometry && Date.parse(x.expires) > now && !(Date.parse(x.issued) > now))
        .map((x) => ({ id: x.id, ev: x.event, area: (x.areaDesc || x.area || "").slice(0, 60), bbox: C.bbox(x.geometry) })).sort((a, z) => (z.bbox[2] - z.bbox[0]) * (z.bbox[3] - z.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]));
      return w[0] || null; });
    if (!fw) { check(`(${dev}) no Flood Warning in effect anywhere right now: the gauge zoom case is skipped`, true, {}); await ctx.close(); continue; }
    /* wide: the whole warning in view, at regional zoom so gauges load */
    await p.evaluate((bb) => { const m = window.__threats.map; m.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 40, duration: 0, maxZoom: 9 }); if (m.getZoom() < 6.5) m.jumpTo({ zoom: 6.5 }); }, fw.bbox);
    await p.waitForFunction(() => window.__threats.map.getSource("gauge")._data.features.length > 0, null, { timeout: 45000 }).catch(() => {}); await p.waitForTimeout(2000);
    await p.screenshot({ path: path.join(OUT, `${dev}-1-wide.png`) });
    const pick = await p.evaluate((fw) => { const T = window.__threats, m = T.map, C = window.ThreatsCore, warn = T.data.products.find((x) => x.id === fw.id), f = m.getSource("gauge")._data.features;
      const cx = (fw.bbox[0] + fw.bbox[2]) / 2, cy = (fw.bbox[1] + fw.bbox[3]) / 2;
      const g = f.map((x) => ({ id: x.properties.id, pt: x.geometry.coordinates, inside: C.contains(warn.geometry, x.geometry.coordinates), d: (x.geometry.coordinates[0] - cx) ** 2 + (x.geometry.coordinates[1] - cy) ** 2 }));
      const outside = g.filter((x) => !x.inside).sort((a, z) => z.d - a.d); return { drawn: f.length, gauge: outside[0] || g.sort((a, z) => z.d - a.d)[0] || null }; }, fw);
    if (!pick.gauge) { check(`(${dev}) a live ${fw.ev} (${fw.area}): gauges loaded wide`, false, { fw, pick }); await ctx.close(); continue; }
    /* zoom into the gauge until the warning's outline is entirely off screen */
    const zoomed = await p.evaluate(async ([fw, pt]) => { const m = window.__threats.map, off = () => { const b = m.getBounds(); return b.getEast() < fw.bbox[0] || b.getWest() > fw.bbox[2] || b.getNorth() < fw.bbox[1] || b.getSouth() > fw.bbox[3]; };
      const C = window.ThreatsCore, warn = window.__threats.data.products.find((x) => x.id === fw.id);
      /* with the gauge inside the outline's box, "off screen" means no outline vertex in view and the view not inside the outline */
      const noOutline = () => { const b = m.getBounds(), box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; const rings = warn.geometry.type === "Polygon" ? warn.geometry.coordinates : warn.geometry.coordinates.flat();
        const anyVertex = rings.some((r) => r.some(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3])); const corners = [[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]];
        return !anyVertex && !corners.some((c) => C.contains(warn.geometry, c)); };
      let z = m.getZoom(); for (; z <= 14; z += 0.5) { m.jumpTo({ center: pt, zoom: z }); if (off() || noOutline()) break; } return { zoom: Math.min(z, 14), offscreen: off() || noOutline() }; }, [fw, pick.gauge.pt]);
    await p.waitForTimeout(5000);
    const after = await p.evaluate((id) => { const T = window.__threats, f = T.map.getSource("gauge")._data.features; return { drawn: f.length, kept: f.some((x) => x.properties.id === id), why: T.S.gaugeWhy, row: ([...document.querySelectorAll(".px-src")].map((x) => x.innerText.replace(/\s+/g, " ")).find((t) => /river gauges/i.test(t)) || "") }; }, pick.gauge.id);
    await p.screenshot({ path: path.join(OUT, `${dev}-2-zoomed.png`) });
    check(`(${dev}) live ${fw.ev} (${fw.area}): zoomed into gauge ${pick.gauge.id} (${pick.gauge.inside ? "inside" : "outside"} the outline) to z${zoomed.zoom}, outline off screen: ${zoomed.offscreen}; gauge still drawn: ${after.kept} (${after.drawn} gauges); row '${after.row.slice(0, 80)}'`, zoomed.offscreen && after.kept && !errs.length, { fw, pick, zoomed, after, errs });
    /* tap it */
    if (after.kept) { const xy = await p.evaluate((pt) => { const m = window.__threats.map, r = m.getCanvas().getBoundingClientRect(), q = m.project(pt); return [r.left + q.x, r.top + q.y]; }, pick.gauge.pt);
      if (!(await p.evaluate(([x, y]) => (document.elementFromPoint(x, y) || {}).tagName === "CANVAS", xy))) { await p.locator("#txSheetBtn").click().catch(() => {}); await p.waitForTimeout(600); }
      if (opt.hasTouch) await p.touchscreen.tap(xy[0], xy[1]); else await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(1500);
      let sel = await p.evaluate(() => window.__threats.S.sel);
      if (sel !== pick.gauge.id) { const row = p.locator(`#txPanelBody [data-id="${pick.gauge.id}"]`).first(); if (await row.count()) { await row.click(); await p.waitForTimeout(800); sel = await p.evaluate(() => window.__threats.S.sel); } }
      if (dev === "phone") { await p.locator("#txPeek").click().catch(() => {}); await p.waitForTimeout(600); }
      const det = await p.evaluate(() => document.getElementById("txPanelBody").innerText.replace(/\s+/g, " "));
      await p.screenshot({ path: path.join(OUT, `${dev}-3-tapped.png`) });
      check(`(${dev}) tapping the gauge opens it: '${det.slice(0, 120)}'`, sel === pick.gauge.id && /stage|ft/i.test(det) && /hydrograph/i.test(det), { sel, det: det.slice(0, 400) }); }
    await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, "gauge-zoom-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
