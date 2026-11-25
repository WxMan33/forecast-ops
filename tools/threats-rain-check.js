/* Rainfall overlays on the Threats map, against a hosted page: live feeds, a replay of saved NOAA responses with the clock
   pinned (current and delayed), a simulated outage, and automatic Flooding at a live flood alert; desktop and phone.
   Usage: node tools/threats-rain-check.js https://<preview host> [outDir]
   Replay files: tests/fixtures/threats/rain/ (saved 2026-11-25 ~03:15Z). */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/rain-check");
if (!HOST) { console.error("usage: node tools/threats-rain-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const FX = (f) => path.join(__dirname, "..", "tests", "fixtures", "threats", "rain", f);
const CVG = "lat=39.1111&lon=-84.5223&name=" + encodeURIComponent("TQL Stadium, Cincinnati, OH") + "&tz=America/New_York";
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const MRMS = /mapservices\.weather\.noaa\.gov\/raster\/rest\/services\/obs\/mrms_qpe\//, WPC = /mapservices\.weather\.noaa\.gov\/vector\/rest\/services\/precip\/wpc_qpf\//;

async function page(b, phone, query, setup) {
  const ctx = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage(), errs = [], reqs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("request", (r) => { const u = r.url(); if (MRMS.test(u) || WPC.test(u)) reqs.push(u); });
  if (setup) await setup(p);
  await p.goto(HOST + "/threats.html?" + query, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.map, null, { timeout: 60000 });
  return { ctx, p, errs, reqs };
}
const st = (p) => p.evaluate(() => { const T = window.__threats, m = T.map, vis = (id) => !!(m.getLayer(id) && m.getLayoutProperty(id, "visibility") === "visible");
  const rows = [...document.querySelectorAll(".px-src")].map((x) => ({ cls: x.className.replace("px-src", "").trim(), src: x.dataset.src || "", text: x.innerText.replace(/\s+/g, " ") })).filter((r) => /^rain-/.test(r.src));
  const lg = (k) => { const e = document.querySelector(`[data-lg="rain-${k}"]`); return e ? { text: e.textContent.replace(/\s+/g, " "), swatches: e.querySelectorAll(".lg-rain img").length } : null; };
  const ven = document.querySelector(".px-rain"); return { S: { rain: T.S.rain, auto: T.S.auto, flood: T.S.layers.flood, view: T.S.view, need: T.S.autoNeed }, obsOn: vis("rain-obs"), fcstOn: vis("rain-fcst"), rows, lgObs: lg("obs"), lgFcst: lg("fcst"), venue: ven ? ven.innerText.replace(/\s+/g, " ") : "", errors: T.errors.map((e) => e.stage + ": " + e.message) }; });
const waitRain = (p, k, ms = 45000) => p.waitForFunction((k) => { const r = window.__threats.rain[k]; return r && (r.meta || r.err); }, k, { timeout: ms }).catch(() => {});
const waitVenue = (p, ms = 45000) => p.waitForFunction(() => { const v = window.__threats.rain.venue; return v && v.obs && v.fcst; }, null, { timeout: ms }).catch(() => {});
const openPicker = async (p) => { if (!(await p.isVisible("#txLayersPop"))) { await p.click("#txLayersBtn"); await p.waitForTimeout(300); } };

/* the replay: every MRMS and WPC request answered from the saved files (tiles: one saved image) */
async function replay(p) {
  const j = (f) => ({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(FX(f)) });
  const png = (f) => ({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(FX(f)) });
  await p.route(MRMS, (r) => { const u = decodeURIComponent(r.request().url()); if (/\/query\?/.test(u)) return r.fulfill(j("mrms-catalog.json")); if (/\/legend\?/.test(u)) return r.fulfill(j("mrms-legend-" + ((/rft_(\d+hr)/.exec(u) || [])[1] || "24hr") + ".json")); if (/\/identify\?/.test(u)) return r.fulfill(j("mrms-identify-cvg-24hr.json")); if (/\/exportImage\?/.test(u)) return r.fulfill(png("mrms-tile-sample.png")); return r.abort(); });
  await p.route(WPC, (r) => { const u = decodeURIComponent(r.request().url()); const L = (/\/(\d+)\/query\?/.exec(u) || [])[1]; if (L) return r.fulfill(j("wpc-point-cvg-" + (["1", "2", "3", "9"].includes(L) ? L : "9") + ".json")); if (/\/legend\?/.test(u)) return r.fulfill(j("wpc-legend.json")); if (/\/export\?/.test(u)) return r.fulfill(png("wpc-tile-sample.png")); return r.abort(); });
}

(async () => {
  const b = await chromium.launch(), R = {};
  for (const phone of [false, true]) {
    const d = phone ? "phone" : "desktop";

    /* 1. LIVE: rain that has fallen (24 h) at the venue, then rain still to come, the Day 2 period, and the 72 h window */
    { const v = await page(b, phone, CVG + "&layers=flood&rain=obs24&view=active&scope=venue"); await waitRain(v.p, "obs"); await waitVenue(v.p); await v.p.waitForTimeout(2500);
      const a = await st(v.p), tiles = v.reqs.filter((u) => /exportImage/.test(u));
      await v.p.screenshot({ path: path.join(OUT, `live-obs-${d}.png`) });
      check(`(${d}) LIVE rain that has fallen: drawn alone; source row '${(a.rows[0] || {}).text}'; legend ${a.lgObs && a.lgObs.swatches} NOAA swatches; ${tiles.length} images for the view; venue: '${a.venue.slice(0, 160)}'`,
        a.obsOn && !a.fcstOn && a.rows.length === 1 && /24 hours ending \w{3}, \w{3} \d+, \d+:\d\d [AP]M E[SD]T/.test(a.rows[0].text) && /current|stale/.test(a.rows[0].cls) && a.lgObs && a.lgObs.swatches === 24 && /Above 24\.00/.test(a.lgObs.text) && tiles.length > 0 && tiles.length <= 40 && tiles.every((u) => /_QPE_24H/.test(decodeURIComponent(u)))
        && /Rain that has fallen/.test(a.venue) && /Rain still to come/.test(a.venue) && /( in |No radar estimate)/.test(a.venue) && /issued/.test(a.venue) && !v.errs.length && !a.errors.length, { a, tiles: tiles.length, errs: v.errs });
      R["live-" + d] = { obs: a };
      await openPicker(v.p); await v.p.check('input[data-rain="fcst"]'); await waitRain(v.p, "fcst"); await v.p.waitForTimeout(2500);
      const f = await st(v.p), wt = v.reqs.filter((u) => /\/export\?/.test(u));
      check(`(${d}) LIVE rain still to come: turning it on turns the fallen overlay off; row '${(f.rows[0] || {}).text}'; legend ${f.lgFcst && f.lgFcst.swatches} swatches; only layer 9 (Days 1–3) images; manual choice kept`,
        f.fcstOn && !f.obsOn && f.S.rain.fcst && !f.S.rain.obs && f.S.auto === false && /Days 1–3: .+ – .+ · issued /.test((f.rows[0] || {}).text) && f.lgFcst && f.lgFcst.swatches >= 17 && wt.length > 0 && wt.every((u) => /layers=show:9&/.test(u)) && !v.errs.length, { f, wt: wt.length });
      await v.p.screenshot({ path: path.join(OUT, `live-fcst-${d}.png`) });
      if (phone) { await v.p.keyboard.press("Escape").catch(() => {}); }
      const n0 = v.reqs.length; await v.p.evaluate(() => { const T = window.__threats; T.S.view = "day2"; T.drawAll(); }); await waitRain(v.p, "fcst"); await v.p.waitForTimeout(2500);
      const d2 = await st(v.p), newReq = v.reqs.slice(n0), day2 = newReq.filter((u) => /\/export\?/.test(u));
      check(`(${d}) LIVE Day 2 view: the forecast follows the Time tab (Day 2 period only: ${day2.length} images, layer 2); row '${(d2.rows[0] || {}).text}'`,
        d2.fcstOn && /Day 2: /.test((d2.rows[0] || {}).text) && day2.length > 0 && day2.every((u) => /layers=show:2&/.test(u)) && !newReq.some((u) => /layers=show:(1|3|9)&/.test(u)), { d2, newReq: newReq.length });
      await v.p.evaluate(() => { const T = window.__threats; T.S.view = "active"; T.drawAll(); });
      await openPicker(v.p); await v.p.selectOption("select[data-rain-win]", "72"); await waitRain(v.p, "obs"); await v.p.waitForTimeout(2500);
      const w72 = await st(v.p);
      check(`(${d}) LIVE choosing Past 72 hours switches back to the fallen overlay: row '${(w72.rows[0] || {}).text}'; legend tops at 'Above 40.00'`,
        w72.obsOn && !w72.fcstOn && /72 hours ending/.test((w72.rows[0] || {}).text) && w72.lgObs && /Above 40\.00/.test(w72.lgObs.text), { w72 });
      if (phone) { const over = await v.p.evaluate(() => { const r = document.getElementById("txRain"); return r ? [...r.querySelectorAll("select, label")].some((x) => x.getBoundingClientRect().right > window.innerWidth + 1) : true; }); check(`(${d}) the rainfall controls fit a ${await v.p.evaluate(() => window.innerWidth)} px screen`, !over, { over }); }
      await v.p.screenshot({ path: path.join(OUT, `live-72h-${d}.png`) }); await v.ctx.close(); }

    /* 2. REPLAY (saved NOAA answers, clock pinned): current at 03:30Z; delayed at 09:00Z */
    for (const [label, at, expectCls] of [["current", "2026-11-25T03:30:00Z", "current"], ["delayed", "2026-11-25T09:00:00Z", "stale"]]) {
      const v = await page(b, phone, CVG + "&layers=flood&rain=obs24&view=active&scope=venue", async (p) => { await p.clock.setFixedTime(new Date(at)); await replay(p); });
      await waitRain(v.p, "obs"); await waitVenue(v.p); await v.p.waitForTimeout(2000);
      const a = await st(v.p), row = a.rows[0] || {};
      check(`(${d}) REPLAY ${label} (clock ${at}): row '${row.text}' (${row.cls}); venue '${a.venue.slice(0, 220)}'`,
        a.obsOn && row.cls === expectCls && /24 hours ending Tue, Nov 24, 9:00 PM EST/.test(row.text) && /Days 1–3: Tue, Nov 24, 7:00 PM EST – Fri, Nov 27, 7:00 PM EST · issued Tue, Nov 24, 5:25 PM EST/.test(a.venue) && (label === "delayed" ? /7 h ago \(delayed\)/.test(row.text) && /h ago: delayed/.test(a.venue) : !/delayed/.test(row.text))
        && /less than 0\.01 in/.test(a.venue) && /1\.50–1\.75 in/.test(a.venue) && /Days 1–3: /.test(a.venue) && /issued/.test(a.venue) && !v.errs.length, { a, errs: v.errs });
      if (label === "current") await v.p.screenshot({ path: path.join(OUT, `replay-${d}.png`) });
      await v.ctx.close(); }

    /* 3. OUTAGE: both services refuse; nothing drawn, every place says so, no amount shown */
    { const v = await page(b, phone, CVG + "&layers=flood&rain=obs24&view=active&scope=venue", async (p) => { await p.route(MRMS, (r) => r.abort()); await p.route(WPC, (r) => r.abort()); });
      await waitRain(v.p, "obs"); await waitVenue(v.p); await v.p.waitForTimeout(2000);
      const a = await st(v.p);
      await openPicker(v.p); await v.p.check('input[data-rain="fcst"]'); await waitRain(v.p, "fcst"); await v.p.waitForTimeout(1500); const f = await st(v.p);
      check(`(${d}) OUTAGE: not drawn; rows '${(a.rows[0] || {}).text}' / '${(f.rows[0] || {}).text}'; legend '${a.lgObs && a.lgObs.text.slice(0, 80)}'; venue '${a.venue.slice(0, 200)}'`,
        !a.obsOn && !f.fcstOn && /Not responding · not drawn/.test((a.rows[0] || {}).text) && (a.rows[0] || {}).cls === "unavailable" && /Not responding · not drawn/.test((f.rows[0] || {}).text)
        && a.lgObs && /Not responding/.test(a.lgObs.text) && /rain that has fallen at the venue is unknown/.test(a.venue) && /rain still to come at the venue is unknown/.test(a.venue) && !/\d\.\d\d in/.test(a.venue) && !v.errs.length, { a, f, errs: v.errs });
      await v.p.screenshot({ path: path.join(OUT, `outage-${d}.png`) }); await v.ctx.close(); }
  }

  /* 4. AUTOMATIC (live): a fresh visit at a live NWS flood alert turns rainfall on by condition; quiet CVG doesn't; manual layers=flood doesn't */
  { const v = await page(b, false, "layers=flood&scope=national&view=active"); await v.p.waitForTimeout(6000);
    const spot = await v.p.evaluate(() => { const ps = window.__threats.data.products.filter((x) => x.sourceId === "nws-alerts" && x.family === "flood" && x.geometry && Date.parse(x.expires) > Date.now() && / (Warning|Advisory)$/.test(x.event || "")); const p = ps[0]; if (!p) return null; const b = window.ThreatsCore.bbox(p.geometry); return { lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2, ev: p.event, area: (p.areaDesc || "").slice(0, 50), n: ps.length }; });
    await v.ctx.close();
    if (!spot) check("AUTOMATIC at a live flood alert: no flood warning or advisory active anywhere right now (case not run)", true, {});
    else { const a = await page(b, false, `lat=${spot.lat.toFixed(4)}&lon=${spot.lon.toFixed(4)}&name=${encodeURIComponent("Flood alert test spot")}`); await a.p.waitForFunction(() => window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 90000 }).catch(() => {}); await waitRain(a.p, "obs"); await waitVenue(a.p); await a.p.waitForTimeout(2500);
      await a.p.screenshot({ path: path.join(OUT, `auto-flood-alert.png`) });
      await a.p.evaluate(() => { const T = window.__threats; T.S.view = "active"; T.S.scope = "venue"; T.drawAll(); }); await waitVenue(a.p); await a.p.waitForTimeout(1500); // the venue view lists the sources and both amounts
      const s = await st(a.p);
      check(`AUTOMATIC at a live ${spot.ev} (${spot.area}): fresh visit, Flooding needed, the rain that has fallen drawn; venue lists both amounts`, s.S.auto && s.S.need && s.S.need.flood && s.S.rain.obs && !s.S.rain.fcst && s.obsOn && s.rows.length === 1 && /hours ending/.test(s.rows[0].text) && /Rain that has fallen/.test(s.venue) && /Rain still to come/.test(s.venue) && !a.errs.length, { spot, s });
      await openPicker(a.p); await a.p.uncheck('input[data-layer="wind"]'); await a.p.waitForTimeout(1500); const m = await st(a.p);
      check("AUTOMATIC → manual: changing a layer keeps the rainfall overlay as it was (no automatic changes after)", m.S.auto === false && m.S.rain.obs && m.obsOn, { m: m.S });
      await a.ctx.close(); }
    const q = await page(b, false, CVG); await q.p.waitForFunction(() => window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 90000 }).catch(() => {}); await q.p.waitForTimeout(3000);
    const qs = await st(q.p), qreq = q.reqs.length;
    check(`AUTOMATIC at CVG: ${qs.S.need && qs.S.need.flood ? "Flooding needed: a rainfall overlay drawn" : "nothing near calls for Flooding: no rainfall overlay and no rainfall requests (" + qreq + ")"}`,
      qs.S.auto && (qs.S.need && qs.S.need.flood ? (qs.obsOn || qs.fcstOn) : (!qs.obsOn && !qs.fcstOn && qreq === 0)), { qs: qs.S, qreq });
    await q.ctx.close();
    const m = await page(b, false, CVG + "&layers=flood"); await m.p.waitForTimeout(5000); const ms = await st(m.p);
    check(`MANUAL layers=flood: no rainfall overlay unless chosen (${m.reqs.length} rainfall requests)`, !ms.S.auto && !ms.S.rain.obs && !ms.S.rain.fcst && !ms.obsOn && !ms.fcstOn && m.reqs.length === 0, { ms: ms.S, reqs: m.reqs.length });
    await m.ctx.close(); }

  await b.close();
  fs.writeFileSync(path.join(OUT, "rain-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
