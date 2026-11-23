#!/usr/bin/env node
/* NOAA In-Flight Icing (IFI) on the Aviation map, desktop and phone.
   Fixture run (default; repeatable): the official records saved in tests/fixtures/threats/ifi (cycle 2026-11-23 01Z), served by
   a local server or a deployment; values are compared with the ecCodes answer key saved beside them.
   Live run (--live, a deployment with the functions): the newest complete cycle through /api/ifi; the records the page drew are
   saved for tools/threats-ifi-verify.py (ecCodes).
     node tools/threats-ifi-check.js [https://<host>] [OUT_DIR] [--live]
   Without a host, the repository is served locally (fixture run only). */
"use strict";
const { chromium } = require("playwright"), http = require("http"), fs = require("fs"), path = require("path");
const args = process.argv.slice(2), LIVE = args.includes("--live"), pos = args.filter((a) => !a.startsWith("--"));
let HOST = (pos[0] && /^https?:/.test(pos[0]) ? pos.shift() : "").replace(/\/$/, ""); const OUT = path.resolve(pos[0] || "docs/threats/ifi-check");
const ROOT = path.resolve(__dirname, ".."), REF = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/threats/ifi/ifi-fixture.eccodes.json"), "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 500))); };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".grib2": "application/octet-stream" };
(async () => {
  let srv = null;
  if (!HOST) { if (LIVE) { console.error("--live needs a deployment"); process.exit(2); }
    srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split("?")[0]); let p = path.join(ROOT, f); if (!fs.existsSync(p) && fs.existsSync(p + ".html")) p += ".html"; if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(r); });
    await new Promise((ok) => srv.listen(0, "127.0.0.1", ok)); HOST = "http://127.0.0.1:" + srv.address().port; }
  const b = await chromium.launch(), saved = [];
  for (const phone of [false, true]) {
    const tag = phone ? "phone" : "desktop", ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    p.on("response", async (r) => { if (LIVE && /\/api\/ifi\/record\?/.test(r.url()) && r.status() === 200) try { saved.push({ tag, url: r.url(), body: await r.body() }); } catch (x) { /* gone */ } });
    const page = (q) => (HOST.startsWith("http://127.") ? "/threats.html?" : "/threats?") + q;
    const state = () => p.evaluate(() => { const T = window.__threats, I = T.ifi, m = T.map, src = m.getSource("ifi");
      return { state: I.state, reason: I.reason, key: I.key, cycle: I.latest && I.latest.cycle, level: I.dec && I.dec.product.level, fh: I.dec && I.dec.product.forecast, param: I.dec && I.dec.product.category + "/" + I.dec.product.number, valid: I.dec && I.dec.validTime,
        visible: m.getLayoutProperty("ifi-img", "visibility"), img: src && src.url ? src.url.length + ":" + src.url.slice(-40) : null, status: (document.querySelector("[data-ifi-status]") || {}).textContent || "", unavailable: (document.querySelector("[data-ifi-unavailable]") || {}).textContent || "",
        legend: (document.querySelector(".ifi-legend") || {}).textContent || "", body: document.getElementById("txPanelBody").innerText }; });
    const settle = (re) => p.waitForFunction((re) => { const I = window.__threats && window.__threats.ifi; return I && I.key && new RegExp(re).test(I.key) && ["ok", "unavailable"].includes(I.state); }, re, { timeout: 120000 });
    const cellsMatch = (key) => p.evaluate((cells) => cells.filter((c) => c.value != null).map((c) => { const a = window.__threats.ifi.at(c.lon, c.lat); return { want: c.value, got: a && a.value, i: a && a.i, j: a && a.j, ci: c.i, cj: c.j }; }), REF.records[key].cells);
    if (!LIVE) {
      await p.goto(HOST + page("scenario=quiet&layers=aviation&ifi=1&ifisrc=fixture&ifield=prob&gft=5000&gfh=3&scope=national&view=active&sheet=open"), { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => window.__threats && window.__threats.ready, null, { timeout: 60000 }); await settle("\\|3\\|5000\\|prob$"); await p.waitForTimeout(700);
      const s0 = await state(), c0 = await cellsMatch("3|5000|prob");
      check(`IFI (${tag}): fixture, 5,000 ft +3 h: Icing probability (0/19/233) of cycle 01Z drawn in cyan, labelled model guidance, with its own legend`, s0.state === "ok" && s0.param === "19/233" && s0.level === 1524 && s0.fh === 3 && s0.visible === "visible" && /^Icing probability \(GRIB2 0\/19\/233 \(ICPRB\)\) · cycle 0100Z \(saved official records\)/.test(s0.status) && /5–20%\s*20–40%\s*40–60%\s*60% or more/.test(s0.legend) && /MODEL GUIDANCE · NOAA IFI/i.test(s0.body), s0);
      check(`IFI (${tag}): the values the map reads at 9 cells equal ecCodes' values for the same record (same cells)`, c0.length >= 9 && c0.every((x) => x.got != null && Math.abs(x.got - x.want) < 1e-6 && x.i === x.ci && x.j === x.cj), c0);
      await p.selectOption("[data-gtg-ft]", "15000"); await settle("\\|3\\|15000\\|prob$"); await p.waitForTimeout(500); const s1 = await state(), c1 = await cellsMatch("3|15000|prob");
      check(`IFI (${tag}): ALTITUDE 5,000 -> 15,000 ft loads 4,572 m and the drawn image changes; values match ecCodes`, s1.state === "ok" && s1.level === 4572 && s1.img !== s0.img && s1.visible === "visible" && c1.every((x) => Math.abs(x.got - x.want) < 1e-6), { s1: { ...s1, body: undefined }, c1 });
      await p.selectOption("[data-gtg-ft]", "5000"); await settle("\\|3\\|5000\\|prob$"); await p.selectOption("[data-gtg-fh]", "6"); await settle("\\|6\\|5000\\|prob$"); await p.waitForTimeout(500); const s2 = await state(), c2 = await cellsMatch("6|5000|prob");
      check(`IFI (${tag}): FORECAST HOUR +3 -> +6 h loads the 6-hour forecast (valid 07Z) and the drawn image changes; values match ecCodes`, s2.state === "ok" && s2.fh === 6 && s2.valid === "2026-11-23T07:00:00.000Z" && s2.img !== s0.img && c2.every((x) => Math.abs(x.got - x.want) < 1e-6), { s2: { ...s2, body: undefined }, c2 });
      await p.selectOption("[data-gtg-fh]", "3"); await settle("\\|3\\|5000\\|prob$"); await p.click('[data-ifi-field="sev"]'); await settle("\\|3\\|5000\\|sev$"); await p.waitForTimeout(500);
      const s3 = await state(), c3 = await cellsMatch("3|5000|sev"), sev = await p.evaluate(() => { const I = window.__threats.ifi, d = I.dec, G = window.ThreatsGTG, P = G.projection(d.grid), pr = window.__threats.ifi; let under = -1;
        for (let k = 0; k < d.field.length; k += 97) { const [lo, la] = P.inv(k % d.grid.nx, Math.floor(k / d.grid.nx)), a = pr.at(lo, la); if (d.field[k] === 0 && a && a.inside && a.value == null && a.text === "no value (below the ground)") { under = k; break; } /* the record says 0 there; the map says no value */ } return { under }; });
      check(`IFI (${tag}): Icing severity (0/19/37, Table 4.228) in its own legend; codes match ecCodes; a below-ground cell reads 'no value', never 'none'`, s3.state === "ok" && s3.param === "19/37" && /tracelightmoderatesevere/.test(s3.legend.replace(/\s+/g, "")) && c3.every((x) => x.got === x.want) && sev.under >= 0 && s3.img !== s0.img, { s3: { ...s3, body: undefined }, c3: c3.slice(0, 3), sev });
      // unavailable records: none of these may leave an old field on the map
      await p.click('[data-ifi-field="prob"]'); await p.selectOption("[data-gtg-ft]", "10000"); await settle("\\|3\\|10000\\|prob$"); await p.waitForTimeout(400); const u1 = await state();
      check(`IFI (${tag}): UNAVAILABLE RECORD (10,000 ft is not in the saved records): nothing drawn, and the panel says so and what is there`, u1.state === "unavailable" && u1.visible === "none" && /^Icing guidance not shown: not in this replay \(it has /.test(u1.unavailable), u1.unavailable);
      await p.selectOption("[data-gtg-ft]", "31000"); await settle("\\|3\\|31000\\|prob$"); await p.waitForTimeout(300); const u2 = await state();
      check(`IFI (${tag}): above 30,000 ft: not drawn, 'IFI stops at 30,000 ft (FL300)'`, u2.state === "unavailable" && u2.visible === "none" && /IFI stops at 30,000 ft \(FL300\)/.test(u2.unavailable), u2.unavailable);
      await p.selectOption("[data-gtg-ft]", "5000"); await p.selectOption("[data-gtg-fh]", "0"); await settle("\\|0\\|5000\\|prob$"); await p.waitForTimeout(300); const u3 = await state();
      check(`IFI (${tag}): +0 h: not drawn, 'covers +1 to +18 h'`, u3.state === "unavailable" && u3.visible === "none" && /covers \+1 to \+18 h/.test(u3.unavailable), u3.unavailable);
      await p.selectOption("[data-gtg-fh]", "3"); await settle("\\|3\\|5000\\|prob$"); await p.waitForTimeout(400); const s4 = await state();
      check(`IFI (${tag}): back to an available record: drawn again, the same image as before`, s4.state === "ok" && s4.visible === "visible" && s4.img === s0.img, { img: [s4.img, s0.img] });
    } else {
      await p.goto(HOST + page("layers=aviation&ifi=1&ifield=prob&gft=10000&gfh=3&scope=national&view=active&sheet=open"), { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => window.__threats && window.__threats.ready, null, { timeout: 60000 }); await settle("\\|10000\\|prob$"); await p.waitForTimeout(700); const s0 = await state();
      check(`IFI LIVE (${tag}): the newest complete cycle through /api/ifi: probability at 10,000 ft drawn`, s0.state === "ok" && s0.param === "19/233" && s0.level === 3048 && s0.visible === "visible" && /^Icing probability/.test(s0.status), s0);
      await p.selectOption("[data-gtg-ft]", "6000"); await settle("\\|6000\\|prob$"); await p.waitForTimeout(400); const s1 = await state();
      await p.selectOption("[data-gtg-fh]", "6"); await settle("\\|6000\\|prob$"); await p.waitForTimeout(400); const s2 = await state();
      check(`IFI LIVE (${tag}): altitude and forecast hour each load another record and change the image`, s1.state === "ok" && s1.level === 1828.8 && s1.img !== s0.img && s2.state === "ok" && s2.fh === s1.fh + 3 && s2.img !== s1.img, { s1: s1.key, s2: s2.key });
      const pick = await p.evaluate(() => { const d = window.__threats.ifi.dec, G = window.ThreatsGTG, P = G.projection(d.grid); let k = -1, best = -1; for (let i = 0; i < d.field.length; i++) if (d.field[i] > best) { best = d.field[i]; k = i; } const [lo, la] = P.inv(k % d.grid.nx, Math.floor(k / d.grid.nx)); return { i: k % d.grid.nx, j: Math.floor(k / d.grid.nx), lon: lo, lat: la, value: best, at: window.__threats.ifi.at(lo, la), key: window.__threats.ifi.key }; });
      saved.filter((x) => x.tag === tag).forEach((x, i) => fs.writeFileSync(path.join(OUT, `${tag}-ifi-${i}.grib2`), x.body));
      fs.writeFileSync(path.join(OUT, `${tag}-pick.json`), JSON.stringify({ ...pick, url: saved.filter((x) => x.tag === tag).pop().url }, null, 1));
      check(`IFI LIVE (${tag}): the readout at the strongest cell equals the decoded value there (checked against ecCodes by tools/threats-ifi-verify.py)`, pick.at && Math.abs(pick.at.value - pick.value) < 1e-9, pick);
    }
    await p.screenshot({ path: path.join(OUT, `ifi-map-${LIVE ? "live-" : ""}${tag}.png`) });
    check(`IFI (${tag}): no script errors, no failed draw stage`, !errs.length && !(await p.evaluate(() => window.__threats.errors.length)), errs);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, `ifi-check${LIVE ? "-live" : ""}.json`), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  await b.close(); if (srv) srv.close();
  const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
