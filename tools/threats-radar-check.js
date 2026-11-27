/* Radar from measured values (IEM lcref, Reflectivity 2026) on a hosted Threats page, desktop and phone:
     source: the page reads IEM's scan time and draws the layer from the measured grid (not NOAA's pre-coloured tiles);
     colours: a tile the page drew at CVG matches, pixel for pixel, the reference renderer (assets/threats-radar.js in Node, itself
       byte-identical to Predictable's renderMrmsTile) on the same scan;
     style: 85% opacity, nearest-neighbour resampling; the legend shows the 2026 bands; warnings and watches draw above radar;
     refreshes (phone profile, 4x CPU slowdown): over consecutive scans, each new scan is downloaded once (bytes, time) and decoded
       (time); an unchanged scan downloads nothing but the 126-byte scan time; tiles draw in a few ms;
     screenshots at CVG: desktop and phone, dark and light.
   Usage: node tools/threats-radar-check.js https://<host> [outDir] [minutes of refreshes, default 7] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const RD = require("../assets/threats-radar.js");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/radar-check"), MIN = +(process.argv[4] || 7);
if (!HOST) { console.error("usage: node tools/threats-radar-check.js https://host [outDir] [minutes]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const CVG = "lat=39.0446&lon=-84.6723&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky");
const passNotice = async (p) => { if (/External Content Notice/.test(await p.title().catch(() => ""))) { await p.getByText("Open the page", { exact: false }).first().click(); await p.waitForLoadState("domcontentloaded"); } };

async function open(b, ctxOpt, theme, slow) {
  const ctx = await b.newContext(ctxOpt), p = await ctx.newPage(), errs = [], reqs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("requestfinished", async (r) => { const u = r.url(); if (!/mesonet\.agron\.iastate\.edu\/data\/gis\/images\/4326\/mrms\/lcref|mapservices\.weather\.noaa\.gov\/.*radar/.test(u)) return;
    const s = await r.sizes().catch(() => null); reqs.push({ at: Date.now(), url: u.replace(/\?.*$/, "").split("/").pop() || u, bytes: s ? s.responseBodySize : null }); });
  if (slow) { const cdp = await ctx.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await p.addInitScript((th) => { try { localStorage.setItem("ops_theme", JSON.stringify(th)); localStorage.setItem("tx_radar_mode", "refl"); } catch (e) {} }, theme);
  await p.goto(HOST + "/threats.html?" + CVG + "&radar=1&view=active&scope=venue", { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
  await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.radar && window.__threats.radar.state === "ok" && window.__threats.radar.via, null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(4000);
  return { ctx, p, errs, reqs };
}
const read = (p) => p.evaluate(() => { const T = window.__threats, m = T.map, st = m.getStyle(), ids = st.layers.map((l) => l.id), r = T.radar, rs = T.radarStats;
  const above = st.layers.filter((l) => l.source === "active").map((l) => l.id), ri = ids.indexOf("radar");
  const politicalLines = [ids.includes("hu-state") ? "hu-state" : "states", "cnty-lines"];
  const boundariesAbove = ri >= 0 && politicalLines.every((id) => ids.indexOf(id) > ri);
  return { boundariesAbove, via: r.via, state: r.state, valid: r.valid, stats: rs && { scan: rs.scan, bytes: rs.bytes, downloadMs: rs.downloadMs, decodeMs: rs.decodeMs, size: rs.size, loads: rs.loads, tiles: rs.tileMs.length, tileMed: rs.tileMs.length ? rs.tileMs.slice().sort((a, b) => a - b)[Math.floor(rs.tileMs.length / 2)] : null, tileMax: rs.tileMs.length ? Math.max(...rs.tileMs) : null, error: rs.error },
    paint: m.getLayer("radar") ? { opacity: m.getPaintProperty("radar", "raster-opacity"), resampling: m.getPaintProperty("radar", "raster-resampling") } : null,
    radarIndex: ri, warningsAbove: above.length && above.every((id) => ids.indexOf(id) > ri), activeLayers: above.length,
    legend: !!document.querySelector('[data-lg="radar"] .lg-r26'), row: ((document.querySelector('[data-src="radar"]') || {}).innerText || "").replace(/\s+/g, " "), theme: document.documentElement.dataset.theme }; });

(async () => {
  const b = await chromium.launch();
  /* desktop, dark: source, style, layer order, pixel comparison */
  { const { ctx, p, errs } = await open(b, { viewport: { width: 1440, height: 900 } }, "dark", false); const s = await read(p);
    await p.screenshot({ path: path.join(OUT, "cvg-desktop-dark.png") });
    check(`(desktop) radar drawn from IEM's measured MRMS grid (via ${s.via}; scan ${s.valid}; ${s.stats && s.stats.size}); source row '${s.row.slice(0, 110)}'`, s.via === "iem" && s.state === "ok" && s.stats && s.stats.size === "7000x3500" && /MRMS reflectivity · lowest elevation, via IEM/.test(s.row), { s });
    check(`(desktop) style: opacity ${s.paint && s.paint.opacity}, resampling ${s.paint && s.paint.resampling}; legend shows the 2026 bands: ${s.legend}`, s.paint && s.paint.opacity === 0.7 && s.paint.resampling === "nearest" && s.legend, { s });
    check(`(desktop) warnings and watches draw above radar (radar layer ${s.radarIndex}; ${s.activeLayers} alert layers all above)`, s.radarIndex >= 0 && s.warningsAbove, { s });
    check("(desktop) state and county lines draw above radar", s.boundariesAbove, { s });
    /* the page's tile vs the reference renderer, same scan */
    /* IEM can publish a new scan between the page's download and this check's: try until both read the same scan */
    const tile = [9, 137, 195]; let pg, scan, png, wld;
    for (let k = 0; k < 4; k++) {
      pg = await p.evaluate(async ([z, x, y]) => { const T = window.__threats, r = await T.radar.client.tile({ url: `lcref://${z}/${x}/${y}` });
      const bmp = await createImageBitmap(new Blob([r.data], { type: "image/png" })), c = new OffscreenCanvas(256, 256), g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
      return { scan: T.radarStats.scan, rgba: Array.from(g.getImageData(0, 0, 256, 256).data) }; }, tile);
      const get = async (ext) => { const r = await fetch(RD.BASE + "." + ext); if (!r.ok) throw Error(ext + " " + r.status); return r; };
      scan = RD.parseMeta(await (await get("json")).json());
      if (scan === pg.scan) { [png, wld] = await Promise.all([get("png").then((r) => r.arrayBuffer()), get("wld").then((r) => r.text())]); if (RD.parseMeta(await (await get("json")).json()) === scan) break; }
      png = null; await p.waitForFunction((s0) => window.__threats.radarStats.scan !== s0, pg.scan, { timeout: 150000 }).catch(() => {}); await p.waitForTimeout(3000);
    }
    if (png) {
      const g = await RD.decodeIndexedPng(new Uint8Array(png), async (z) => new Uint8Array(zlib.inflateSync(Buffer.from(z)))), ref = RD.renderTile({ ...g, ...RD.parseWorldFile(wld) }, RD.palette(g.alpha), ...tile);
      /* a canvas round trip premultiplies alpha: compare colour within 1 step where alpha < 255, exactly where opaque */
      let bad = 0, coloured = 0; for (let i = 0; i < ref.length; i += 4) { const a = ref[i + 3]; if (a) coloured++; if (pg.rgba[i + 3] !== a) { bad++; continue; } if (!a) continue; const tol = a === 255 ? 0 : 2; for (let k = 0; k < 3; k++) if (Math.abs(pg.rgba[i + k] - ref[i + k]) > tol) { bad++; break; } }
      check(`(desktop) tile z${tile.join("/")} at CVG matches the reference renderer pixel for pixel on scan ${new Date(scan).toISOString()} (${coloured} coloured pixels; ${bad} differ)`, bad === 0, { bad, coloured });
    } else check(`(desktop) tile comparison: page and check never read the same scan in 4 tries`, false, {});
    /* the opacity slider (Layers → Radar): shows the percentage, moves the map at once, is remembered after a reload */
    { await p.locator("#txLayersBtn").click(); await p.waitForTimeout(400);
      const before = await p.evaluate(() => ({ shown: document.querySelector("[data-radar-op-val]").textContent, map: window.__threats.map.getPaintProperty("radar", "raster-opacity") }));
      await p.locator("[data-radar-op]").fill("50"); await p.waitForTimeout(200);
      const moved = await p.evaluate(() => ({ shown: document.querySelector("[data-radar-op-val]").textContent, map: window.__threats.map.getPaintProperty("radar", "raster-opacity") }));
      await p.screenshot({ path: path.join(OUT, "slider-desktop-50.png") });
      await p.reload({ waitUntil: "domcontentloaded" }); await passNotice(p);
      await p.waitForFunction(() => window.__threats && window.__threats.map && window.__threats.map.getLayer("radar"), null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(2000);
      const kept = await p.evaluate(() => ({ shown: document.querySelector("[data-radar-op-val]").textContent, map: window.__threats.map.getPaintProperty("radar", "raster-opacity") }));
      check(`(desktop) opacity slider: starts ${before.shown} (map ${before.map}); set to 50%: shows ${moved.shown}, map ${moved.map} at once; after a reload ${kept.shown} (map ${kept.map})`,
        before.shown === "70%" && before.map === 0.7 && moved.shown === "50%" && moved.map === 0.5 && kept.shown === "50%" && kept.map === 0.5, { before, moved, kept });
      await p.evaluate(() => localStorage.removeItem("tx_radar_opacity")); }
    check("(desktop) no script errors", !errs.length, { errs }); await ctx.close(); }
  /* desktop, light; phone, light: screenshots and the same source */
  for (const [name, opt, theme] of [["desktop-light", { viewport: { width: 1440, height: 900 } }, "light"], ["phone-light", { ...devices["iPhone 13"] }, "light"]]) {
    const { ctx, p, errs } = await open(b, opt, theme, false); const s = await read(p); await p.screenshot({ path: path.join(OUT, `cvg-${name}.png`) });
    check(`(${name}) theme ${s.theme}: radar from IEM, opacity ${s.paint && s.paint.opacity}, nearest; boundaries and warnings above`, s.via === "iem" && s.paint && s.paint.opacity === 0.7 && s.paint.resampling === "nearest" && s.warningsAbove && s.boundariesAbove && !errs.length, { s, errs }); await ctx.close(); }
  /* IEM not answering: within about 15 s the page shows NOAA's pre-coloured tiles, labelled as the fallback */
  { const ctx = await b.newContext({ ...devices["iPhone 13"] }), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem("tx_radar_mode", "refl"); } catch (e) {} }); // this check is about Reflectivity (Precipitation type is the default)
    await p.route(/mesonet\.agron\.iastate\.edu\/data\/gis\/images\/4326\/mrms\/lcref\.png/, () => {}); // never answers
    const t0 = Date.now(); await p.goto(HOST + "/threats.html?" + CVG + "&radar=1&view=active&scope=venue", { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
    await p.waitForFunction(() => window.__threats && window.__threats.radar && window.__threats.radar.via === "noaa" && window.__threats.radar.state === "ok", null, { timeout: 60000 }).catch(() => {});
    const s = await read(p), secs = Math.round((Date.now() - t0) / 1000);
    check(`(phone) IEM image not answering: NOAA's tiles shown after ${secs} s, labelled ('${s.row.slice(0, 80)}'); legend says fallback`, s.via === "noaa" && /fallback/.test(s.row) && secs <= 40 && !errs.length, { s, secs, errs });
    await ctx.close(); }
  /* phone, dark, 4x slower CPU: consecutive refreshes */
  { const { ctx, p, errs, reqs } = await open(b, { ...devices["iPhone 13"] }, "dark", true); const first = await read(p); await p.screenshot({ path: path.join(OUT, "cvg-phone-dark.png") });
    const scans = [{ scan: first.stats && first.stats.scan, bytes: first.stats && first.stats.bytes, downloadMs: first.stats && first.stats.downloadMs, decodeMs: first.stats && first.stats.decodeMs }];
    const t0 = Date.now(); while (Date.now() - t0 < MIN * 60e3) { await p.waitForTimeout(20e3);
      await p.evaluate(() => window.__threats.map.panBy([40, 0], { duration: 0 })); // keep tiles being drawn as a viewer would
      const s = await read(p); if (s.stats && s.stats.scan !== scans[scans.length - 1].scan) scans.push({ scan: s.stats.scan, bytes: s.stats.bytes, downloadMs: s.stats.downloadMs, decodeMs: s.stats.decodeMs }); }
    const last = await read(p); await p.screenshot({ path: path.join(OUT, "cvg-phone-dark-after-refreshes.png") });
    const pngs = reqs.filter((r) => /lcref\.png$/.test(r.url)), jsons = reqs.filter((r) => /lcref\.json$/.test(r.url)), noaa = reqs.filter((r) => /mapservices/.test(r.url)).length;
    const mb = (x) => (x / 1048576).toFixed(2);
    console.log("phone refreshes:", JSON.stringify(scans.map((x) => ({ scan: new Date(x.scan).toISOString().slice(11, 16) + "Z", MB: x.bytes && mb(x.bytes), downloadMs: x.downloadMs, decodeMs: x.decodeMs }))));
    check(`(phone, 4x slower CPU) ${scans.length} scans over ${MIN} min: each new scan downloaded once (${pngs.length} image downloads, ${mb(pngs.reduce((a, r) => a + (r.bytes || 0), 0))} MB), scan time read ${jsons.length} times; decode ${scans.map((x) => x.decodeMs + " ms").join(", ")}; tiles median ${Math.round(last.stats.tileMed)} ms, max ${Math.round(last.stats.tileMax)} ms (${last.stats.tiles}); NOAA radar requests ${noaa}`,
      scans.length >= 2 && pngs.length === scans.length && last.stats.loads === scans.length && noaa === 0 && last.via === "iem" && !errs.length, { scans, pngs: pngs.length, jsons: jsons.length, last: last.stats, errs });
    fs.writeFileSync(path.join(OUT, "refreshes.json"), JSON.stringify({ scans, requests: reqs, last: last.stats }, null, 1)); await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, "radar-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
