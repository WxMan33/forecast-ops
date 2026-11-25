#!/usr/bin/env node
/* Weather Threats map: threat feeds follow the selected layers. On desktop and a 390 px phone:
     1. a fresh /threats visit opens the venue's 7-day dashboard with every map layer off ("Layers · None selected"): only the
        dashboard's own sources are requested, no map-layer feed;
     2. opening the Layers picker makes zero threat-feed requests;
     3. Severe storms alone requests only its feeds (NWS alerts, SPC Mesoscale Discussions, SPC convective outlooks, SPC storm reports);
     4. turning it off again stops those refreshes (no threat-feed request over 70 s, longer than the 60 s alert/MD refresh);
     5. a shared link with layers=flood keeps that selection and requests only alerts and the WPC rainfall outlook;
     6. a Planner-style link (venue, view, layers=severe) keeps its selection; a demo link keeps every layer on, with no
        live request.
   Every request the page makes is classified; anything that is not a threat feed (basemap, page assets) is listed apart.
     node tools/threats-feeds-check.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/feeds-check");
const PAGE = process.env.THREATS_PAGE || "/threats";
if (!HOST) { console.error("usage: threats-feeds-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 700))); };
/* threat feeds by the layer family they serve (first match wins) */
const FEEDS = [
  ["gauges", /api\.water\.noaa\.gov/],
  ["reports", /climo\/reports|\/api\/spc\/reports/],
  /* the NWS alerts feed: the active list, the outlines of alerts issued by zone, and the earlier messages an alert references */
  ["alerts", /\/alerts\/active/],
  ["alerts-zones", /api\.weather\.gov\/zones|\/api\/nws\/zones/],
  ["alerts-refs", /(api\.weather\.gov|\/api\/nws)\/alerts\/urn/],
  ["md", /spc\.noaa\.gov\/products\/md|spc_mesoscale_discussion|\/api\/nws\/spc\/md|\/api\/spc\/md/],
  ["spc", /spc\.noaa\.gov\/products\/outlook|\/api\/(nws\/)?spc\/outlook/],
  ["fire", /fire_wx/],
  ["ero", /eromap|wpc_precip_hazards|\/api\/wpc\/ero/],
  ["wssi", /wpc_wssi_p|\/api\/wpc\/wssi/],
  ["nifc", /WFIGS|services3\.arcgis\.com/],
  ["hms", /satepsanone|\/api\/smoke/],
  ["airnow", /AirNow|airnowtech|Air%20Now/i],
  ["nhc", /tropical\/rest|nhc\.noaa\.gov/],
  ["awc", /aviationweather\.gov|\/api\/awc\//],
  ["faa", /\/api\/faa\//],
  ["gtg", /\/api\/gtg\//],
  ["ifi", /\/api\/ifi\//],
  ["model", /raw\.githubusercontent\.com/],
  ["nws-other", /api\.weather\.gov|\/api\/nws\//],
];
/* the venue's NWS point record (time zone, forecast office) is a one-off venue lookup, cached 24 h: not a threat feed */
const feedOf = (u) => { if (/\/points\/-?\d/.test(u)) return null; for (const [k, re] of FEEDS) if (re.test(u)) return k; return null; };
const tally = (list) => list.reduce((o, r) => ((o[r.feed] = (o[r.feed] || 0) + 1), o), {});
const DEV = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
(async () => {
  const b = await chromium.launch(), out = { host: HOST, at: new Date().toISOString(), devices: {} };
  for (const [d, o] of Object.entries(DEV)) {
    const rec = (out.devices[d] = {});
    const page = async () => {
      const ctx = await b.newContext(o), p = await ctx.newPage(), reqs = [], other = new Map(), errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      p.on("request", (r) => { const u = r.url(), f = feedOf(u); if (f) reqs.push({ feed: f, url: u, t: Date.now() }); else { const h = (/^https?:\/\/([^/]+)/.exec(u) || [])[1] || u.slice(0, 20); other.set(h, (other.get(h) || 0) + 1); } });
      return { ctx, p, reqs, other, errs };
    };
    const ready = (p) => p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.liveReady && !window.__threats.data.loading, null, { timeout: 90000 });
    const state = (p) => p.evaluate(() => { const T = window.__threats, m = T.map;
      return { layers: Object.keys(T.S.layers).filter((k) => T.S.layers[k]), sum: document.getElementById("txLayersSum").textContent.replace(/^Manual · /, ""), btn: document.getElementById("txLayersBtn").innerText.replace(/\s+/g, " ").trim(),
        prompt: !!document.querySelector("#txPanelBody [data-kind=no-layers] [data-open-layers]"), promptText: (document.querySelector("#txPanelBody [data-kind=no-layers]") || {}).innerText || "", peek: document.getElementById("txPeek1").textContent,
        basemap: !!(m && m.loaded && m.isStyleLoaded() !== false && m.getStyle().sources && Object.keys(m.getStyle().sources).length), tilesLoaded: m && m.areTilesLoaded(), marker: !!document.querySelector(".maplibregl-marker"),
        feeds: window.ThreatsLive.mapFeeds ? window.ThreatsLive.mapFeeds() : "n/a", products: T.data.products.length }; });
    const since = (reqs, t0) => reqs.filter((r) => r.t >= t0);

    /* 1: a fresh visit: the 7-day dashboard, radar and the warning, watch and advisory layers; SPC, WPC rainfall and NHC feeds and river gauges only when conditions near the venue call for them */
    { const { ctx, p, reqs, other, errs } = await page();
      await p.goto(HOST + PAGE, { waitUntil: "domcontentloaded" }); await ready(p);
      await p.waitForFunction(() => window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(4000);
      const s0 = await state(p), dash = await p.evaluate(() => ({ view: window.__threats.S.view, state: window.__threats.outlook.state, days: document.querySelectorAll("#txPanelBody .px-olday").length, head: (document.querySelector("#txPanelBody .px-olhead .px-big") || {}).textContent, radar: window.__threats.radar.state, radarOn: window.__threats.S.radar, auto: window.__threats.S.auto, need: window.__threats.S.autoNeed || {}, gauge: window.__threats.S.gaugeWhy }));
      const by0 = tally(reqs); rec.fresh = { requests: reqs.length, byFeed: by0, other: Object.fromEntries(other), state: s0, dash };
      await p.screenshot({ path: path.join(OUT, `fresh-${d}.png`) });
      const DEF = ["severe", "flood", "winter", "heat", "wind", "tropical", "coastal"], NOT = ["nifc", "fire-map", "monitors", "awc"], fireMap = reqs.some((r) => r.feed === "fire" && Date.now()); // fire outlooks may come from the dashboard
      check(`(${d}) FRESH VISIT: the 7-day dashboard ('${dash.head}'); map defaults ${s0.sum}: radar plus the warning, watch and advisory layers, automatic extras only where conditions call for them (${Object.keys(dash.need).filter((k) => dash.need[k]).join(", ") || "none needed"}); fire, smoke and aviation off (requests: ${Object.entries(by0).map(([k, v]) => k + " " + v).join(", ")})`,
        dash.view === "outlook" && dash.state === "ok" && dash.days === 7 && dash.radarOn && JSON.stringify(s0.layers) === JSON.stringify([...DEF.slice(0, 5), ...(dash.need.fire ? ["fire"] : []), ...(dash.need.smoke ? ["smoke"] : []), ...DEF.slice(5)]) && /^Auto · /.test(s0.sum) && JSON.stringify(s0.feeds) === JSON.stringify(["alerts", ...(dash.need.flood ? ["ero"] : []), ...(dash.need.severe ? ["md"] : []), ...(dash.need.tropical ? ["nhc"] : []), ...(dash.need.severe ? ["reports", "spc"] : [])].sort()) && dash.auto && !(by0.gauges > 1 && !dash.gauge) && by0.alerts >= 1 && !by0.nifc && !by0.monitors && !by0.awc && s0.basemap && s0.marker && !errs.length, { dash, by0, s0, errs });
      await ctx.close(); }
    /* 2-4: from no layers (?layers=none): open the picker, Severe storms alone, then off again */
    { const { ctx, p, reqs, other, errs } = await page();
      await p.goto(HOST + PAGE + "?layers=none&view=active", { waitUntil: "domcontentloaded" }); await ready(p); await p.waitForTimeout(6000);
      const s0 = await state(p);
      check(`(${d}) ?layers=none: every layer off, 'Layers · None selected', no threat-feed request (${reqs.length})`, reqs.length === 0 && !s0.layers.length && s0.sum === "None selected" && !errs.length, { s0, reqs: reqs.map((r) => r.url), errs });
      let t0 = Date.now(); await p.click("#txLayersBtn"); await p.waitForTimeout(5000);
      const pick = since(reqs, t0), sp = await p.evaluate(() => !document.getElementById("txLayersPop").hidden); rec.pickerOpen = { requests: pick.length, byFeed: tally(pick) };
      await p.screenshot({ path: path.join(OUT, `picker-open-${d}.png`) });
      check(`(${d}) OPENING THE LAYER PICKER: zero threat-feed requests (${pick.length})`, sp && pick.length === 0, { sp, pick: pick.map((r) => r.url) });
      t0 = Date.now(); await p.click('#txLayersPop input[data-layer="severe"]'); await ready(p); await p.waitForTimeout(10000);
      const sev = since(reqs, t0), ss = await state(p), by = tally(sev); rec.severeOnly = { requests: sev.length, byFeed: by, urls: sev.map((r) => r.url), state: ss };
      await p.click("#txLayersPop [data-layers-close]").catch(() => {}); await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, `severe-only-${d}.png`) });
      check(`(${d}) SEVERE STORMS ALONE: only its feeds (${Object.entries(by).map(([k, v]) => k + " " + v).join(", ")}): NWS alerts, SPC MDs, SPC outlooks and SPC storm reports each requested, nothing else`,
        Object.keys(by).every((k) => ["alerts", "alerts-zones", "alerts-refs", "md", "spc", "reports"].includes(k)) && by.alerts >= 1 && by.md >= 1 && by.spc >= 1 && by.reports >= 1 && ss.sum === "Severe storms" && JSON.stringify(ss.feeds) === JSON.stringify(["alerts", "md", "reports", "spc"]) && !ss.prompt && !errs.length, { by, ss, errs });
      await p.click("#txLayersBtn"); await p.click('#txLayersPop input[data-layer="severe"]'); t0 = Date.now(); await p.waitForTimeout(70000);
      const off = since(reqs, t0), so = await state(p); rec.severeOff70s = { requests: off.length, byFeed: tally(off), state: so };
      check(`(${d}) SEVERE STORMS OFF AGAIN: its refreshes stop: zero threat-feed requests in 70 s (${off.length}); the prompt returns`, off.length === 0 && !so.layers.length && so.sum === "None selected" && so.prompt && !so.feeds.length && !errs.length, { off: off.map((r) => r.url), so, errs });
      rec.total = { requests: reqs.length, byFeed: tally(reqs) }; await ctx.close(); }

    /* 5: a shared link with layers=flood */
    { const { ctx, p, reqs, errs } = await page();
      await p.goto(HOST + PAGE + "?layers=flood&scope=national&view=active", { waitUntil: "domcontentloaded" }); await ready(p); await p.waitForTimeout(8000);
      const s = await state(p), by = tally(reqs); rec.floodLink = { requests: reqs.length, byFeed: by, state: s };
      check(`(${d}) SHARED LINK layers=flood keeps its selection and requests only alerts and the WPC rainfall outlook (${Object.entries(by).map(([k, v]) => k + " " + v).join(", ")})`,
        JSON.stringify(s.layers) === '["flood"]' && s.sum === "Flooding" && Object.keys(by).every((k) => ["alerts", "alerts-zones", "alerts-refs", "ero"].includes(k)) && by.alerts >= 1 && by.ero >= 1 && !errs.length, { s, by, errs });
      await ctx.close(); }

    /* 6: a Planner-style "View on map" link, and a demo link */
    { const { ctx, p, reqs, errs } = await page();
      await p.goto(HOST + PAGE + "?lat=39.1113&lon=-84.5222&name=TQL%20Stadium&tz=America%2FNew_York&scope=venue&view=day1&layers=severe,smoke", { waitUntil: "domcontentloaded" }); await ready(p); await p.waitForTimeout(8000);
      const s = await state(p), by = tally(reqs); rec.plannerLink = { requests: reqs.length, byFeed: by, state: s };
      check(`(${d}) PLANNER LINK (venue, Day 1, layers=severe,smoke) keeps its selection and requests only those layers' feeds (${Object.entries(by).map(([k, v]) => k + " " + v).join(", ")})`,
        JSON.stringify(s.layers) === '["severe","smoke"]' && s.sum === "Severe storms, Smoke & air" && Object.keys(by).every((k) => ["alerts", "alerts-zones", "alerts-refs", "md", "spc", "reports", "hms", "airnow"].includes(k)) && by.alerts >= 1 && by.hms >= 1 && s.marker && !errs.length, { s, by, errs });
      await ctx.close(); }
    { const { ctx, p, reqs, errs } = await page();
      await p.goto(HOST + PAGE + "?scenario=overlap&scope=venue&view=active", { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 90000 }); await p.waitForTimeout(5000);
      const s = await state(p); rec.demoLink = { requests: reqs.length, byFeed: tally(reqs), state: { layers: s.layers, sum: s.sum } };
      check(`(${d}) DEMO LINK keeps every layer on (its shared selection) and requests no live feed (${reqs.length})`, s.sum === "All 10" && s.layers.length === 10 && reqs.length === 0 && !errs.length, { s, reqs: reqs.map((r) => r.url), errs });
      await ctx.close(); }
  }
  fs.writeFileSync(path.join(OUT, "feeds-check.json"), JSON.stringify({ ...out, results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
