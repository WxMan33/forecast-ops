#!/usr/bin/env node
/* GTG turbulence guidance on the map, against a deployment (Cloudflare Pages preview with the functions):
   turns the layer on, switches altitude and forecast hour, and checks what the page shows against the record it drew.
   Saves each record the page used (GRIB2 bytes) and the page's readings, so the values can be checked independently
   (tools/threats-gtg-verify.py reads them with ECMWF ecCodes).
     node tools/threats-gtg-check.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/gtg-check");
if (!HOST) { console.error("usage: threats-gtg-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 400))); };
(async () => {
  const b = await chromium.launch(), out = { host: HOST, at: new Date().toISOString(), steps: [] };
  for (const phone of [false, true]) {
    const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(), errs = [], recs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("response", async (r) => { if (/\/api\/gtg\/record\?/.test(r.url()) && r.status() === 200) { try { recs.push({ url: r.url(), body: await r.body(), record: r.headers()["x-gtg-record"], fileBytes: r.headers()["x-gtg-file-bytes"] }); } catch (x) { /* body gone */ } } });
    const tag = phone ? "phone" : "desktop";
    await p.goto(HOST + "/threats?layers=aviation&gtg=1&gft=30000&gfh=0&scope=national&view=active&sheet=open", { waitUntil: "domcontentloaded" });
    const settle = () => p.waitForFunction(() => window.__threats && window.__threats.ready && ["ok", "failed"].includes(window.__threats.gtg.state), null, { timeout: 120000 });
    await settle(); await p.waitForSelector("[data-gtg-status]", { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(800);
    const read = () => p.evaluate(() => { const g = window.__threats.gtg, d = g.dec, m = window.__threats.map;
      // the strongest cell in the field, and the readout there: a sample point the check can verify against the source grid
      let k = -1, best = -1; if (d) for (let i = 0; i < d.field.length; i++) if (d.field[i] > best) { best = d.field[i]; k = i; }
      const P = d && window.ThreatsGTG.projection(d.grid), ll = d ? P.inv(k % d.grid.nx, Math.floor(k / d.grid.nx)) : null, at = ll ? g.at(ll[0], ll[1]) : null;
      return { state: g.state, error: g.error, key: g.key, cycle: g.latest && g.latest.cycle, hours: g.latest && g.latest.hours, level: d && d.product.level, param: d && d.product.category + "/" + d.product.number, ref: d && d.refTime, valid: d && d.validTime, fh: d && d.product.forecast,
        nx: d && d.grid.nx, ny: d && d.grid.ny, points: d && d.points, max: best, maxAt: ll, maxIJ: d ? [k % d.grid.nx, Math.floor(k / d.grid.nx)] : null, readout: at, visible: m.getLayoutProperty("gtg-img", "visibility"),
        status: (document.querySelector("[data-gtg-status]") || {}).textContent || "", legend: (document.querySelector(".gtg-legend") || {}).textContent || "", label: /model guidance · noaa gtg/i.test((document.querySelector("#txPanelBody") || {}).innerText) && /Model guidance<\/b>, not an observation or an advisory/.test(document.getElementById("txPanelBody").innerHTML) }; });
    const s0 = await read(); out.steps.push({ tag, step: "FL300 +0 h", ...s0 });
    check(`GTG (${tag}): layer on at FL300, +0 h: EDPARM (19/30) at 9,144 m from the latest complete cycle, drawn, labelled model guidance`, s0.state === "ok" && s0.param === "19/30" && s0.level === 9144 && s0.fh === 0 && s0.valid === s0.ref && s0.visible === "visible" && s0.label && s0.hours && s0.hours.length === 19 && /^Cycle \d{4}Z/.test(s0.status) && !errs.length, { ...s0, errs });
    check(`GTG (${tag}): the readout at a grid cell equals the decoded grid value there`, s0.readout && Math.abs(s0.readout.value - s0.max) < 1e-9 && s0.readout.i === s0.maxIJ[0] && s0.readout.j === s0.maxIJ[1], s0.readout);
    // altitude: FL300 -> 10,000 ft
    await p.selectOption("[data-gtg-ft]", "10000"); await p.waitForFunction(() => window.__threats.gtg.key && /\|3048$/.test(window.__threats.gtg.key) && window.__threats.gtg.state === "ok", null, { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(500); const s1 = await read(); out.steps.push({ tag, step: "10,000 ft +0 h", ...s1 });
    check(`GTG (${tag}): switching altitude to 10,000 ft loads that height (3,048 m) for the same cycle and hour`, s1.state === "ok" && s1.level === 3048 && s1.fh === 0 && s1.cycle === s0.cycle && /10,000 ft/.test(s1.status) && s1.key !== s0.key, s1);
    // forecast hour: +0 -> +6
    await p.selectOption("[data-gtg-fh]", "6"); await p.waitForFunction(() => window.__threats.gtg.key && /\|6\|3048$/.test(window.__threats.gtg.key) && window.__threats.gtg.state === "ok", null, { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(500); const s2 = await read(); out.steps.push({ tag, step: "10,000 ft +6 h", ...s2 });
    check(`GTG (${tag}): switching to +6 h loads the 6-hour forecast, valid 6 hours after the cycle`, s2.state === "ok" && s2.fh === 6 && s2.level === 3048 && Date.parse(s2.valid) - Date.parse(s2.ref) === 6 * 3600e3 && /\(\+6 h\)/.test(s2.status), s2);
    // aircraft class changes the categories, not the values
    await p.click('[data-gtg-cls="heavy"]'); await p.waitForTimeout(800); const s3 = await read();
    check(`GTG (${tag}): heavy aircraft thresholds (0.17, 0.24, 0.54, 0.96) in the legend; same field`, /light ≥ 0\.17\s*moderate ≥ 0\.24\s*severe ≥ 0\.54\s*extreme ≥ 0\.96/.test(s3.legend) && s3.key === s2.key && s3.max === s2.max, s3.legend);
    if (!phone) await p.screenshot({ path: path.join(OUT, "gtg-map-desktop.png") }); else await p.screenshot({ path: path.join(OUT, "gtg-map-phone.png") });
    check(`GTG (${tag}): no script errors, no failed draw stage`, !errs.length && !(await p.evaluate(() => window.__threats.errors.length)), errs);
    recs.forEach((r, i) => { const f = path.join(OUT, `${tag}-record-${i}.grib2`); fs.writeFileSync(f, r.body); out.steps.filter((s) => s.tag === tag)[i] && (out.steps.filter((s) => s.tag === tag)[i].file = path.basename(f), out.steps.filter((s) => s.tag === tag)[i].idx = r.record, out.steps.filter((s) => s.tag === tag)[i].fileBytes = r.fileBytes); });
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "gtg-check.json"), JSON.stringify({ ...out, results }, null, 1));
  await b.close();
  const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
