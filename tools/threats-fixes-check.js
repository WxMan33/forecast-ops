#!/usr/bin/env node
/* Weather Threats map: the audit fixes and the three additions, on a deployment, desktop and a 390 px phone.
   Fixes: WPC rainfall "None Expected" reads none, not an outage; an unconfirmed SPC outlook says "Risk unknown"; fire
   incident and AirNow monitor dots open their details from a map click, smoke areas are listed in At this spot; the SPC
   Watch 705 replay loads; alerts no longer fetch every referenced earlier message on load (only when an alert is opened);
   zone outlines come from Cache Storage on the next visit; fully contained fires are hidden unless asked for.
   Additions: the no-layers prompt's presets; NOAA MRMS radar (live only, timestamped, stops when off); the venue's next
   12 hours from the NWS forecast grid, on request.
     node tools/threats-fixes-check.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/fixes-check");
if (!HOST) { console.error("usage: threats-fixes-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 700))); };
const FEEDS = [["alerts", /\/alerts\/active/], ["alerts-zones", /api\.weather\.gov\/zones|\/api\/nws\/zones/], ["alerts-refs", /(api\.weather\.gov|\/api\/nws)\/alerts\/urn/],
  ["md-page", /spc\.noaa\.gov\/products\/md/], ["md", /spc_mesoscale_discussion/], ["spc", /spc\.noaa\.gov\/products\/outlook/], ["fire", /fire_wx/], ["ero", /eromap|wpc_precip_hazards|\/api\/wpc\/ero/],
  ["nifc", /WFIGS|services3\.arcgis\.com/], ["hms", /satepsanone|\/api\/smoke/], ["airnow", /AirNow|airnowtech|Air%20Now/i], ["nhc", /tropical\/rest/], ["radar-time", /radar_base_reflectivity\/MapServer\/2\/query/],
  ["radar-tile", /radar_base_reflectivity\/MapServer\/export/], ["nws-point", /\/points\//], ["nws-grid", /\/gridpoints\//], ["awc", /aviationweather\.gov|\/api\/awc\//], ["nws-other", /api\.weather\.gov|\/api\/nws\//]];
const feedOf = (u) => { for (const [k, re] of FEEDS) if (re.test(u)) return k; return null; };
const tally = (l) => l.reduce((o, r) => ((o[r.feed] = (o[r.feed] || 0) + 1), o), {});
const DEV = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
(async () => {
  const b = await chromium.launch(), out = { host: HOST, at: new Date().toISOString(), devices: {} };
  for (const [d, o] of Object.entries(DEV)) {
    const ctx = await b.newContext(o), R = (out.devices[d] = {});
    const page = async (q, setup) => { const p = await ctx.newPage(), reqs = [], errs = []; p.on("pageerror", (e) => errs.push(e.message));
      p.on("request", (r) => { const f = feedOf(r.url()); if (f) reqs.push({ feed: f, url: r.url(), t: Date.now() }); });
      if (setup) await setup(p); await p.goto(HOST + "/threats" + q, { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => window.__threats && window.__threats.ready && (window.__threats.S.scenario !== "live" || window.__threats.liveReady) && !window.__threats.data.loading, null, { timeout: 90000 });
      return { p, reqs, errs }; };
    const since = (reqs, t0) => reqs.filter((r) => r.t >= t0);
    /* a control in the panel: on a phone the sheet may be collapsed, so open it first, as a person would by tapping it */
    const tap = async (p, sel) => { const l = p.locator(sel).first(); if (!(await l.isVisible()) && (await p.locator("#txPeek").isVisible())) { await p.locator("#txPeek").click(); await p.waitForTimeout(500); } await l.click(); };
    /* clicking the map at a lon/lat with the real pointer */
    const mapClick = async (p, pt) => { const xy = await p.evaluate((pt) => { const m = window.__threats.map; m.jumpTo({ center: pt, zoom: Math.max(m.getZoom(), 9) }); const r = m.getCanvas().getBoundingClientRect(), q = m.project(pt); return [r.left + q.x, r.top + q.y]; }, pt); await p.waitForTimeout(900);
      if (o.hasTouch) await p.touchscreen.tap(xy[0], xy[1]); else await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(900); };

    /* PRESETS, from a fresh visit */
    { const { p, reqs, errs } = await page("", null); await p.waitForTimeout(3000);
      const t0 = Date.now(); await tap(p, '[data-preset="venue"]'); await p.waitForFunction(() => window.__threats.liveReady && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(6000);
      const st = await p.evaluate(() => ({ layers: Object.keys(window.__threats.S.layers).filter((k) => window.__threats.S.layers[k]), scope: window.__threats.S.scope, feeds: window.ThreatsLive.mapFeeds(), sum: document.getElementById("txLayersSum").textContent }));
      const by = tally(since(reqs, t0)); R.presetVenue = { st, by };
      check(`(${d}) PRESET "Warnings at my venue": severe, flood, winter, coastal; venue view; only alerts, MDs, SPC and WPC outlooks requested (${JSON.stringify(by)}); no earlier-message lookups on load`,
        JSON.stringify(st.layers) === '["severe","flood","winter","coastal"]' && st.scope === "venue" && JSON.stringify(st.feeds) === '["alerts","ero","md","spc"]' && Object.keys(by).every((k) => ["alerts", "alerts-zones", "md-page", "md", "spc", "ero"].includes(k)) && !by["alerts-refs"] && (by["md-page"] || 0) <= 1 && !errs.length, { st, by, errs });
      await p.screenshot({ path: path.join(OUT, `preset-venue-${d}.png`) });
      // WPC rainfall: confirmed (current or none), never "Not responding" when WPC answered
      const ero = await p.evaluate(() => { const T = window.__threats; T.S.view = "day1"; T.drawAll(); return { st: T.data.state.ero1 && T.data.state.ero1.kind, src: T.data.sources.ero1, rows: [...document.querySelectorAll(".px-src")].map((r) => r.innerText.replace(/\s+/g, " ")).filter((x) => /rainfall/i.test(x)), panel: document.getElementById("txPanelBody").innerText.replace(/\s+/g, " ").slice(0, 400) }; });
      R.ero1 = ero;
      check(`(${d}) WPC RAINFALL Day 1 (${ero.src && ero.src.state}; today ${ero.st}): a confirmed answer reads current or none, not 'Not responding'`, ["current", "empty"].includes(ero.st) && !ero.rows.some((x) => /Not responding/.test(x)), ero);
      // opening an alert that updates an earlier one fetches that one message, once
      const t1 = Date.now(), opened = await p.evaluate(() => { const T = window.__threats, a = T.data.products.find((x) => (x.references || []).length && x.kind !== "outlook"); if (!a) return null; T.S.view = "active"; T.S.sel = a.id; T.drawAll(); T.drawAll(); return a.id; });
      await p.waitForTimeout(3000); const refs = since(reqs, t1).filter((r) => r.feed === "alerts-refs").length; R.refsOnOpen = { opened, refs };
      check(`(${d}) WHAT CHANGED: the earlier message is fetched when its alert is opened (${refs} request${refs === 1 ? "" : "s"} for ${opened || "no alert with a reference today"})`, !opened || refs === 1, { opened, refs });
      await p.close(); }
    /* zone outlines: a second visit in the same browser reads them from Cache Storage */
    { const { p, reqs } = await page("?layers=coastal,winter"); await p.waitForTimeout(8000); const z = reqs.filter((r) => r.feed === "alerts-zones").length;
      const cached = await p.evaluate(async () => (await (await caches.open("forecast-ops-zones-v1")).keys()).length); await p.close();
      const again = await page("?layers=coastal,winter"); await again.p.waitForTimeout(8000); const z2 = again.reqs.filter((r) => r.feed === "alerts-zones").length; await again.p.close();
      R.zones = { first: z, cached, second: z2 };
      check(`(${d}) ZONE OUTLINES: first visit ${z} downloads, ${cached} kept in Cache Storage; next visit ${z2}`, cached > 0 && z2 < Math.max(1, z) / 4, R.zones); }
    /* SPC outlook failing: risk unknown, never "No severe risk" */
    { const { p } = await page("?layers=severe&view=day1&scope=venue", (p) => p.route(/spc\.noaa\.gov\/products\/outlook/, (r) => r.abort())); await p.waitForTimeout(4000);
      const r = await p.evaluate(() => ({ peek: document.getElementById("txPeek2").textContent, big: (document.querySelector(".px-brief .px-big") || {}).textContent, body: document.getElementById("txPanelBody").innerText }));
      R.spcUnknown = r;
      check(`(${d}) SPC OUTLOOK NOT RESPONDING: the venue brief and summary say 'Risk unknown' ('${r.big}'), never 'No severe risk area'`, /Risk unknown · SPC Day 1 outlook not responding/.test(r.big || "") && /Risk unknown/.test(r.peek) && !/No severe risk/.test(r.body + r.peek), r);
      await p.screenshot({ path: path.join(OUT, `spc-unknown-${d}.png`) }); await p.close(); }
    /* map clicks: fire incident dot, AirNow monitor dot, a smoke area; contained fires */
    { const { p, errs } = await page("?layers=fire,smoke&scope=national"); await p.waitForTimeout(15000);
      const pick = await p.evaluate(() => { const T = window.__threats, ids = (s) => new Set((T.map.getSource(s)._data.features || []).map((f) => f.properties.id)), inc = ids("inc-pt"), mon = ids("aqmon"), ps = T.data.products;
        const fire = ps.filter((x) => x.kind === "incident" && inc.has(x.id) && x.point).sort((a, b) => (b.acres || 0) - (a.acres || 0))[0], vt = window.__threats.venue, dist = (pt) => Math.hypot(pt[0] - vt.lon, pt[1] - vt.lat),
          m = ps.filter((x) => x.kind === "aqobs" && mon.has(x.id) && x.point).sort((a, b) => dist(b.point) - dist(a.point))[0]; // away from the venue marker
        const hidden = ps.filter((x) => x.kind === "incident" && x.contained === 100 && x.category !== "RX"), drawnContained = hidden.filter((x) => inc.has(x.id)).length;
        const hms = ps.find((x) => x.kind === "smoke" && x.geometry && Date.parse(x.obsEnd) <= Date.now()); let inside = null;
        if (hms) { const bb = window.ThreatsCore.bbox(hms.geometry); for (let i = 1; i < 25 && !inside; i++) for (let j = 1; j < 25 && !inside; j++) { const q = [bb[0] + (bb[2] - bb[0]) * i / 25, bb[1] + (bb[3] - bb[1]) * j / 25]; if (window.ThreatsCore.contains(hms.geometry, q)) inside = q; } }
        return { fire: fire && { id: fire.id, name: fire.name, pt: fire.point }, mon: m && { id: m.id, site: m.site, pt: m.point }, contained: hidden.length, drawnContained, hms: hms && { id: hms.id, pt: inside } }; });
      R.clicks = { pick };
      if (pick.fire) { await mapClick(p, pick.fire.pt); const s = await p.evaluate(() => ({ sel: window.__threats.S.sel, body: document.getElementById("txPanelBody").innerText.slice(0, 160) })); R.clicks.fire = s;
        check(`(${d}) CLICK a fire incident dot (${pick.fire.name}): its own details open`, s.sel === pick.fire.id && s.body.includes(pick.fire.name), s); await p.screenshot({ path: path.join(OUT, `click-fire-${d}.png`) }); }
      await p.evaluate(() => { window.__threats.S.sel = null; window.__threats.drawAll(); });
      if (pick.mon) { await mapClick(p, pick.mon.pt); const s = await p.evaluate(() => ({ sel: window.__threats.S.sel, body: document.getElementById("txPanelBody").innerText.slice(0, 200) })); R.clicks.mon = s;
        check(`(${d}) CLICK an AirNow monitor dot (${pick.mon.site}): its own details open`, s.sel === pick.mon.id, s); }
      await p.evaluate(() => { window.__threats.S.sel = null; window.__threats.drawAll(); });
      if (pick.hms && pick.hms.pt) { await p.evaluate((pt) => { const m = window.__threats.map; m.jumpTo({ center: pt }); m.fire("click", { lngLat: { lng: pt[0], lat: pt[1] }, point: m.project(pt), originalEvent: {} }); }, pick.hms.pt); await p.waitForTimeout(700);
        const s = await p.evaluate(() => document.getElementById("txPanelBody").innerText.replace(/\s+/g, " ").slice(0, 300)); R.clicks.hms = s;
        check(`(${d}) CLICK inside a satellite smoke area: At this spot lists it`, /At this spot/i.test(s) && /smoke/i.test(s), s); }
      check(`(${d}) FULLY CONTAINED FIRES hidden by default (${pick.contained} listed by NIFC, ${pick.drawnContained} drawn)`, pick.drawnContained === 0, pick);
      if (pick.contained) { await p.evaluate(() => { const c = document.getElementById("ctnChk"); if (c) { c.checked = true; c.dispatchEvent(new Event("change")); } else { window.__threats.S.ctn = true; window.__threats.drawAll(); } }); await p.waitForTimeout(800);
        const n = await p.evaluate(() => { const T = window.__threats, inc = new Set(T.map.getSource("inc-pt")._data.features.map((f) => f.properties.id)); return T.data.products.filter((x) => x.kind === "incident" && x.contained === 100 && inc.has(x.id)).length; });
        check(`(${d}) "Fully contained fires" in the legend shows them (${n} drawn)`, n > 0, { n }); }
      check(`(${d}) no script errors on the fire and smoke map`, !errs.length, errs); await p.close(); }
    /* the SPC Watch 705 replay */
    { const { p, errs } = await page("?scenario=archive-ww705&scope=venue"); await p.waitForTimeout(3000);
      const r = await p.evaluate(() => ({ n: window.__threats.data.products.length, watch: window.__threats.data.products.filter((x) => x.kind === "watch").map((x) => x.event), drawn: window.__threats.map.getSource("active")._data.features.length, err: window.__threats.data.loadError, panel: document.getElementById("txPanelBody").innerText.slice(0, 160) }));
      R.ww705 = r; check(`(${d}) REPLAY SPC Tornado Watch 705 loads and draws (${r.watch.join(", ")})`, !r.err && r.watch.includes("Tornado Watch") && r.drawn >= 1 && !errs.length, { r, errs }); await p.screenshot({ path: path.join(OUT, `replay-ww705-${d}.png`) }); await p.close(); }
    /* RADAR: from none; image time; tiles; off stops it; demo: live only */
    { const { p, reqs, errs } = await page(""); await p.waitForTimeout(2000); const t0 = Date.now();
      await tap(p, "#txLayersBtn"); await p.locator("#txLayersPop input[data-radar]").check(); await tap(p, "#txLayersPop [data-layers-close]");
      await p.waitForFunction(() => window.__threats.radar.state === "ok" && window.__threats.map.getLayer("radar") && window.__threats.map.areTilesLoaded(), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(3000);
      const on = since(reqs, t0), by = tally(on), st = await p.evaluate(() => { const T = window.__threats, m = T.map; return { state: T.radar.state, valid: T.radar.valid, vis: m.getLayer("radar") && m.getLayoutProperty("radar", "visibility"), below: m.getStyle().layers.findIndex((l) => l.id === "radar") < m.getStyle().layers.findIndex((l) => l.id === "outlook-fill"), sum: document.getElementById("txLayersSum").textContent, row: (document.querySelector('[data-src="radar"]') || {}).innerText, feeds: window.ThreatsLive.mapFeeds() }; });
      R.radarOn = { by, st };
      check(`(${d}) RADAR on, with no hazard layer: 'Radar only'; image time read once (${by["radar-time"]}), ${by["radar-tile"] || 0} tiles; drawn under the hazards; status row '${st.row}'; no threat feed requested`,
        st.state === "ok" && st.vis === "visible" && st.below && st.sum === "Radar only" && by["radar-time"] === 1 && by["radar-tile"] > 0 && Object.keys(by).every((k) => /^radar/.test(k)) && /Image .* min old/.test(st.row || "") && !st.feeds.length && Date.now() - Date.parse(st.valid) < 60 * 60e3 && !errs.length, { by, st, errs });
      await p.screenshot({ path: path.join(OUT, `radar-${d}.png`) });
      await tap(p, "#txLayersBtn"); await p.locator("#txLayersPop input[data-radar]").uncheck(); await tap(p, "#txLayersPop [data-layers-close]"); const t1 = Date.now(); await p.waitForTimeout(8000);
      const off = since(reqs, t1), so = await p.evaluate(() => ({ state: window.__threats.radar.state, timer: !!window.__threats.radar.timer, vis: window.__threats.map.getLayoutProperty("radar", "visibility"), sum: document.getElementById("txLayersSum").textContent }));
      R.radarOff = { off: tally(off), so };
      check(`(${d}) RADAR off: hidden, its 5-minute refresh stopped, nothing more requested`, off.length === 0 && so.state === "off" && !so.timer && so.vis === "none" && so.sum === "None selected", { off: off.map((r) => r.url), so }); await p.close(); }
    { const { p } = await page("?scenario=overlap&radar=1"); await p.waitForTimeout(1500); const r = await p.evaluate(() => ({ dis: document.querySelector("#txLayersPop input[data-radar]").disabled, layer: !!window.__threats.map.getLayer("radar"), sum: document.getElementById("txLayersSum").textContent }));
      check(`(${d}) RADAR is live only: unavailable on a demo or replay (summary '${r.sum}')`, r.dis && !r.layer && !/Radar/.test(r.sum), r); await p.close(); }
    /* VENUE FORECAST, on request, with no layer on */
    { const { p, reqs, errs } = await page("?scope=venue&lat=39.1113&lon=-84.5222&name=TQL%20Stadium&tz=America%2FNew_York"); await p.waitForTimeout(2000);
      const before = reqs.length, t0 = Date.now(); await tap(p, "[data-vfc]"); await p.waitForSelector('[data-vfc-state="ok"], [data-vfc-state="failed"]', { timeout: 60000 });
      const r = await p.evaluate(() => { const g = document.querySelector(".px-vfc"); return { state: g && g.dataset.vfcState, sum: (document.querySelector(".px-vfcsum") || {}).textContent, rows: document.querySelectorAll(".px-vfcgrid [role=row]").length - 1, foot: ((g && g.querySelector(".lg-note")) || {}).textContent, hs: document.documentElement.scrollWidth > window.innerWidth + 1, data: window.__threats.vfc.data && { office: window.__threats.vfc.data.office, peakGust: window.__threats.vfc.data.peakGust } }; });
      const by = tally(since(reqs, t0)); await p.evaluate(() => window.__threats.drawAll()); await p.waitForTimeout(1000); const again = tally(since(reqs, t0)); R.vfc = { r, by, before };
      check(`(${d}) VENUE FORECAST: nothing requested until asked (${before}); then the NWS point and grid once each (${JSON.stringify(by)}); 12 hourly rows; summary '${r.sum}'; forecast office and update time named; no horizontal scroll`,
        before === 0 && r.state === "ok" && r.rows === 12 && by["nws-point"] === 1 && by["nws-grid"] === 1 && Object.keys(by).length === 2 && JSON.stringify(again) === JSON.stringify(by) && /Peak gust \d+ mph around/.test(r.sum) && /NWS forecast grid ILN 35,38, updated/.test(r.foot) && !r.hs && !errs.length, { r, by, again, errs });
      await p.locator(".px-vfc").scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(OUT, `venue-forecast-${d}.png`) }); await p.close(); }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "fixes-check.json"), JSON.stringify({ ...out, results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
