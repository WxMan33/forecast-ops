#!/usr/bin/env node
/* Weather Threats map audit on a deployment (findings, not a gate). Desktop and a 390 px phone.
   A. Fresh visit and opening the picker: threat-feed requests (expect none).
   B. Each layer alone, from none: what it requests (feed, HTTP status), each source's state and fetch time, the newest
      product's issue and valid times, how many of its products the map draws, and a click on one drawn feature: the "At this
      spot" list names it, its detail panel names it, and its identifier appears in the raw source response. Smoke & air:
      satellite smoke (HMS) and surface monitors (AirNow) separately; NAQFC reported as disabled when it is.
      Then: off (no feeds left), and back on at once (quick feeds reused, not downloaded again).
   C. All layers on, then off: no threat-feed request for 70 s (alerts and MDs refresh every 60 s).
   D. Degraded feeds with another layer on (desktop): NWS alerts held 25 s; SPC outlooks failing; NWS alerts failing after a
      first success (stale after the next refresh); the map stays usable (a picker click answers) and each row says which.
   E. Saved replays for each layer (labelled replay), drawn and clickable; Planner-shaped and shared links open with their layers.
     node tools/threats-audit.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/audit");
if (!HOST) { console.error("usage: threats-audit.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const FEEDS = [["alerts", /\/alerts\/active/], ["alerts-zones", /api\.weather\.gov\/zones|\/api\/nws\/zones/], ["alerts-refs", /(api\.weather\.gov|\/api\/nws)\/alerts\/urn/],
  ["md", /spc\.noaa\.gov\/products\/md|spc_mesoscale_discussion/], ["spc", /spc\.noaa\.gov\/products\/outlook/], ["fire", /fire_wx/], ["ero", /eromap|wpc_precip_hazards|\/api\/wpc\/ero/],
  ["wssi", /wpc_wssi_p|\/api\/wpc\/wssi/], ["nifc", /WFIGS|services3\.arcgis\.com/], ["hms", /satepsanone|\/api\/smoke/], ["airnow", /AirNow|airnowtech|Air%20Now/i], ["nhc", /tropical\/rest|nhc\.noaa\.gov/],
  ["awc", /aviationweather\.gov|\/api\/awc\//], ["faa", /\/api\/faa\//], ["gtg", /\/api\/gtg\//], ["ifi", /\/api\/ifi\//], ["model", /raw\.githubusercontent\.com/], ["nws-other", /api\.weather\.gov|\/api\/nws\//]];
const feedOf = (u) => { for (const [k, re] of FEEDS) if (re.test(u)) return k; return null; };
const tally = (l) => l.reduce((o, r) => ((o[r.feed + (r.status && r.status >= 400 ? " HTTP " + r.status : r.status === 0 ? " failed" : "")] = (o[r.feed + (r.status && r.status >= 400 ? " HTTP " + r.status : r.status === 0 ? " failed" : "")] || 0) + 1), o), {});
const LAYERS = ["severe", "flood", "winter", "fire", "smoke", "tropical", "coastal", "aviation"];
const REPLAY = { severe: "archive-ww705", flood: "archive-flood-day", winter: "archive-winter-warning", fire: "archive-fire-incidents", smoke: "archive-smoke-chicago", tropical: "archive-tropical-warning", coastal: "archive-coastal-flagler", aviation: "archive-aviation-chicago" };
const DEV = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const log = (...a) => console.log(...a);
/* in the page: everything about one layer (family) as drawn now */
const INSPECT = ([fam, sub]) => {
  const T = window.__threats, C = window.ThreatsCore, m = T.map, d = T.data;
  const famOf = (p) => p.family || (p.kind === "outlook" ? (p.program === "ero" ? "flood" : /^spcfire-/.test(p.program || "") ? "fire" : p.program === "wssip" ? "winter" : "severe") : p.kind === "md" ? "severe" : p.kind === "incident" ? "fire" : ["smoke", "aqobs", "monitor"].includes(p.kind) ? "smoke" : /^tc/.test(p.kind) ? "tropical" : null);
  const prods = d.products.filter((p) => famOf(p) === fam && (!sub || sub(p)));
  const ids = new Set(prods.map((p) => p.id)), drawn = new Map();
  for (const s of ["active", "outlook", "ero", "hms", "aqmon", "inc", "inc-pt", "fireo", "tcone", "tline", "tpts", "two", "wssi", "apt", "pirep", "enr", "avroute"]) { const src = m.getSource(s); const fs = (src && src._data && src._data.features) || []; for (const f of fs) if (f.properties && ids.has(f.properties.id)) drawn.set(f.properties.id, s); }
  const rows = [...document.querySelectorAll(".px-src")].map((r) => r.innerText.replace(/\s+/g, " ").trim());
  const times = prods.map((p) => ({ issued: p.issued || p.updated || p.observed || null, start: p.validStart || p.onset || p.effective || null, end: p.expires || p.validEnd || null })).filter((x) => x.issued).sort((a, b) => (a.issued < b.issued ? 1 : -1));
  const kinds = prods.reduce((o, p) => ((o[p.kind] = (o[p.kind] || 0) + 1), o), {});
  return { products: prods.length, kinds, drawn: drawn.size, drawnBy: [...drawn.values()].reduce((o, s) => ((o[s] = (o[s] || 0) + 1), o), {}), newest: times[0] || null, rows, clock: d.clock,
    sources: Object.fromEntries(Object.entries(d.sources).filter(([k, v]) => v.state !== "off").map(([k, v]) => [k, { state: v.state, kind: d.state[k] && d.state[k].kind, lastOk: v.lastOk, count: v.count, error: v.error }])) };
};
(async () => {
  const b = await chromium.launch(), out = { host: HOST, at: new Date().toISOString(), devices: {}, degraded: {}, replay: {}, links: {} };
  const newPage = async (o, setup) => { const ctx = await b.newContext(o), p = await ctx.newPage(), reqs = [], bodies = [], errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("requestfinished", async (r) => { const f = feedOf(r.url()); if (!f) return; const res = await r.response().catch(() => null), st = res ? res.status() : 0; reqs.push({ feed: f, url: r.url(), status: st, t: Date.now() }); if (res && st < 400 && !/zones|alerts\/urn/.test(r.url())) { const tx = await res.text().catch(() => ""); bodies.push({ feed: f, text: tx.slice(0, 3e6) }); } });
    p.on("requestfailed", (r) => { const f = feedOf(r.url()); if (f) reqs.push({ feed: f, url: r.url(), status: 0, t: Date.now(), failure: (r.failure() || {}).errorText }); });
    if (setup) await setup(p); return { ctx, p, reqs, bodies, errs }; };
  const ready = (p, live = true) => p.waitForFunction((live) => window.__threats && window.__threats.ready && (!live || window.__threats.liveReady) && !window.__threats.data.loading, live, { timeout: 90000 });
  const toggle = async (p, L) => { if (await p.evaluate(() => document.getElementById("txLayersPop").hidden)) await p.click("#txLayersBtn"); const t = Date.now(); await p.click(`#txLayersPop input[data-layer="${L}"]`, { timeout: 60000 }); return Date.now() - t; };
  const closePop = (p) => p.evaluate(() => { const b = document.querySelector("#txLayersPop [data-layers-close]"); if (b && !document.getElementById("txLayersPop").hidden) b.click(); });
  /* click one drawn product of the family; returns what the panel and the raw source say about it */
  const clickOne = (p, fam, bodies, pick) => p.evaluate(([fam, pick]) => {
    const T = window.__threats, C = window.ThreatsCore, m = T.map, d = T.data;
    const famOf = (p) => p.family || (p.kind === "outlook" ? (p.program === "ero" ? "flood" : /^spcfire-/.test(p.program || "") ? "fire" : p.program === "wssip" ? "winter" : "severe") : p.kind === "md" ? "severe" : p.kind === "incident" ? "fire" : ["smoke", "aqobs", "monitor"].includes(p.kind) ? "smoke" : /^tc/.test(p.kind) ? "tropical" : null);
    const drawnIds = new Set(); for (const s of ["active", "outlook", "ero", "hms", "aqmon", "inc", "inc-pt", "fireo", "tcone", "tline", "tpts", "two", "wssi", "apt", "pirep", "enr"]) { const src = m.getSource(s); for (const f of (src && src._data && src._data.features) || []) drawnIds.add(f.properties && f.properties.id); }
    const cand = d.products.filter((p) => famOf(p) === fam && drawnIds.has(p.id) && (!pick || new RegExp(pick).test(p.kind)) && (p.point || p.geometry));
    const p0 = cand.find((p) => p.kind === "warning") || cand.find((p) => p.point) || cand[0]; if (!p0) return null;
    let pt = p0.point; if (!pt) { const bb = C.bbox(p0.geometry); for (let i = 1; i < 20 && !pt; i++) for (let j = 1; j < 20 && !pt; j++) { const q = [bb[0] + (bb[2] - bb[0]) * i / 20, bb[1] + (bb[3] - bb[1]) * j / 20]; if (C.contains(p0.geometry, q)) pt = q; } }
    if (!pt) return { id: p0.id, kind: p0.kind, noPoint: true };
    m.jumpTo({ center: pt }); m.fire("click", { lngLat: { lng: pt[0], lat: pt[1] }, point: m.project(pt), originalEvent: {} });
    const body = document.getElementById("txPanelBody"), spot = body.innerText.replace(/\s+/g, " ");
    const name = p0.title || p0.event || p0.name || p0.label || p0.category || p0.id;
    T.S.sel = p0.id; T.S.point = null; T.drawAll(); const det = body.innerText.replace(/\s+/g, " ");
    const keys = [p0.id, String(p0.id).split(/[:/]/).pop(), p0.name, p0.irwinId, p0.aqsid, p0.site, p0.station, p0.siteName].filter((x) => x && String(x).length > 3);
    return { id: p0.id, kind: p0.kind, name, point: pt, spotListsIt: spot.includes(String(name).slice(0, 40)) || spot.includes(String(p0.event || "").slice(0, 30) || "§"), detailNamesIt: det.includes(String(name).slice(0, 40)), detail: det.slice(0, 260), keys,
      fields: { issued: p0.issued || p0.updated || p0.observed || null, expires: p0.expires || p0.validEnd || null, category: p0.category || null } };
  }, [fam, pick]).then((r) => { if (r && r.keys) { r.inSource = r.keys.find((k) => bodies.some((x) => x.text.includes(String(k)))) || null; } return r; });

  for (const [dev, o] of Object.entries(DEV)) {
    const R = (out.devices[dev] = { layers: {} });
    const { ctx, p, reqs, bodies, errs } = await newPage(o);
    await p.goto(HOST + "/threats", { waitUntil: "domcontentloaded" }); await ready(p); await p.waitForTimeout(6000);
    R.fresh = { requests: reqs.length }; await p.click("#txLayersBtn"); await p.waitForTimeout(4000); R.picker = { requests: reqs.length - R.fresh.requests };
    log(dev, "fresh", R.fresh.requests, "picker", R.picker.requests);
    for (const L of LAYERS) {
      const t0 = Date.now(), clickMs = await toggle(p, L); await ready(p).catch(() => {}); await p.waitForTimeout(L === "fire" || L === "smoke" || L === "tropical" ? 20000 : 10000);
      if (L === "smoke") await p.evaluate(() => { window.__threats.S.scope = "venue"; window.__threats.drawAll(); }); if (L === "smoke") await p.waitForTimeout(8000);
      const on = reqs.filter((r) => r.t >= t0), info = await p.evaluate(INSPECT, [L]);
      await closePop(p);
      const click = L === "smoke" ? { hms: await clickOne(p, L, bodies, "^smoke$"), monitors: await clickOne(p, L, bodies, "aqobs|monitor") } : await clickOne(p, L, bodies);
      await p.screenshot({ path: path.join(OUT, `${dev}-${L}.png`) });
      /* outlooks draw in their own views: Day 1 for SPC and WPC rainfall, Fire for SPC fire weather */
      const vw = { severe: "day1", flood: "day1", fire: "fire" }[L]; let inView = null;
      if (vw) { await p.evaluate((v) => { const T = window.__threats; T.S.sel = null; T.S.point = null; T.S.view = v; T.drawAll(); }, vw); await p.waitForTimeout(3000);
        inView = { view: vw, info: await p.evaluate(INSPECT, [L]), click: await clickOne(p, L, bodies, "outlook") }; await p.screenshot({ path: path.join(OUT, `${dev}-${L}-${vw}.png`) });
        await p.evaluate(() => { const T = window.__threats; T.S.sel = null; T.S.point = null; T.S.view = "active"; T.drawAll(); }); }
      if (L === "smoke") { info.naqfcEnabled = await p.evaluate(() => !!(window.ThreatsFeeds || {}).NAQFC_ENABLED); await p.evaluate(() => { window.__threats.S.scope = "national"; window.__threats.S.sel = null; window.__threats.S.point = null; window.__threats.drawAll(); }); }
      await p.evaluate(() => { window.__threats.S.sel = null; window.__threats.S.point = null; window.__threats.drawAll(); });
      // off: no feeds left; back on at once: quick feeds reused
      await toggle(p, L); await p.waitForTimeout(1500); const feedsOff = await p.evaluate(() => window.ThreatsLive.mapFeeds());
      const t1 = Date.now(); await toggle(p, L); await p.waitForTimeout(4000); const again = reqs.filter((r) => r.t >= t1 && ["alerts", "md", "spc", "ero", "fire", "nifc", "hms", "nhc"].includes(r.feed));
      await toggle(p, L); await p.waitForTimeout(800);
      R.layers[L] = { clickMs, requests: tally(on), failed: on.filter((r) => !r.status || r.status >= 400).map((r) => r.url.slice(0, 140) + " " + (r.failure || r.status)), info, click, inView, feedsAfterOff: feedsOff, reRequestsOnReenable: tally(again) };
      log(dev, L, JSON.stringify({ req: R.layers[L].requests, failed: R.layers[L].failed, products: info.products, drawn: info.drawn, newest: info.newest, click, inView: inView && { products: inView.info.products, drawn: inView.info.drawn, click: inView.click }, off: feedsOff, again: R.layers[L].reRequestsOnReenable }).slice(0, 900));
    }
    // C: everything on, then off: 70 s without a threat-feed request
    if (await p.evaluate(() => document.getElementById("txLayersPop").hidden)) await p.click("#txLayersBtn"); await p.click("[data-layers-all]"); await ready(p).catch(() => {}); await p.waitForTimeout(15000);
    await p.click("[data-layers-reset]"); const t2 = Date.now(); await p.waitForTimeout(70000);
    R.allOffQuiet = { requests: tally(reqs.filter((r) => r.t >= t2)), feeds: await p.evaluate(() => window.ThreatsLive.mapFeeds()) }; log(dev, "all off 70 s", JSON.stringify(R.allOffQuiet));
    R.errors = errs; await ctx.close();
  }
  /* D: degraded feeds, another layer on (desktop) */
  const usable = async (p) => { const t = Date.now(); await p.click("#txLayersBtn"); await p.click('#txLayersPop input[data-layer="coastal"]', { timeout: 30000 }); const ms = Date.now() - t; await p.click('#txLayersPop input[data-layer="coastal"]'); await closePop(p); return ms; };
  const rowsOf = (p) => p.evaluate(() => [...document.querySelectorAll(".px-src")].map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  { const { ctx, p } = await newPage(DEV.desktop, (p) => p.route(/\/alerts\/active/, async (r) => { await new Promise((res) => setTimeout(res, 25000)); r.continue().catch(() => {}); }));
    await p.goto(HOST + "/threats?layers=flood", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(6000);
    const ms = await usable(p), rows = await rowsOf(p), panel = await p.evaluate(() => document.getElementById("txPanelBody").innerText.slice(0, 200));
    out.degraded.slowAlerts = { usableClickMs: ms, rows, panel }; log("slow alerts", JSON.stringify(out.degraded.slowAlerts).slice(0, 600)); await p.screenshot({ path: path.join(OUT, "degraded-slow-alerts.png") }); await ctx.close(); }
  { const { ctx, p } = await newPage(DEV.desktop, (p) => p.route(/spc\.noaa\.gov\/products\/outlook/, (r) => r.abort()));
    await p.goto(HOST + "/threats?layers=severe,smoke&view=day1", { waitUntil: "domcontentloaded" }); await ready(p).catch(() => {}); await p.waitForTimeout(12000);
    const ms = await usable(p), rows = await rowsOf(p), peek = await p.evaluate(() => document.getElementById("txPeek1").textContent + " / " + document.getElementById("txPeek2").textContent);
    out.degraded.spcFailing = { usableClickMs: ms, rows, peek }; log("spc failing", JSON.stringify(out.degraded.spcFailing).slice(0, 600)); await p.screenshot({ path: path.join(OUT, "degraded-spc-failing.png") }); await ctx.close(); }
  { let n = 0; const { ctx, p } = await newPage(DEV.desktop, (p) => p.route(/\/alerts\/active/, (r) => (n++ ? r.abort() : r.continue())));
    await p.goto(HOST + "/threats?layers=severe", { waitUntil: "domcontentloaded" }); await ready(p).catch(() => {}); await p.waitForTimeout(8000); const before = await rowsOf(p);
    await p.waitForTimeout(65000); const ms = await usable(p), rows = await rowsOf(p), notice = await p.evaluate(() => [...document.querySelectorAll(".px-notice")].map((x) => x.innerText.replace(/\s+/g, " ")).join(" | "));
    const kept = await p.evaluate(() => window.__threats.data.products.filter((x) => x.kind === "warning" || x.kind === "watch").length);
    out.degraded.alertsStale = { before, usableClickMs: ms, rows, notice, productsKept: kept }; log("alerts stale", JSON.stringify(out.degraded.alertsStale).slice(0, 700)); await p.screenshot({ path: path.join(OUT, "degraded-alerts-stale.png") }); await ctx.close(); }
  /* E: replays and links */
  for (const L of LAYERS) { const { ctx, p, errs } = await newPage(DEV.desktop);
    await p.goto(HOST + "/threats?scenario=" + REPLAY[L] + "&layers=" + L + "&scope=venue&view=active", { waitUntil: "domcontentloaded" }); await ready(p, false).catch(() => {}); await p.waitForTimeout(4000);
    const info = await p.evaluate(INSPECT, [L]), click = await clickOne(p, L, []), badge = await p.evaluate(() => document.getElementById("txBadge").textContent);
    out.replay[L] = { scenario: REPLAY[L], badge, products: info.products, drawn: info.drawn, newest: info.newest, click: click && { name: click.name, spot: click.spotListsIt, detail: click.detailNamesIt }, errs };
    log("replay", L, JSON.stringify(out.replay[L]).slice(0, 400)); await ctx.close(); }
  const LINKS = { "planner aviation": "lat=41.8807&lon=-87.6742&name=United%20Center&tz=America%2FChicago&scope=venue&view=active&layers=aviation&air=KORD,KMDW", "planner tropical": "lat=29.95&lon=-90.08&name=Superdome&tz=America%2FChicago&scope=venue&view=active&layers=tropical",
    "planner smoke": "lat=42.34&lon=-83.05&name=Comerica&tz=America%2FDetroit&scope=venue&view=active&layers=smoke", "planner fire view": "lat=34.07&lon=-118.24&name=Dodger%20Stadium&tz=America%2FLos_Angeles&scope=venue&view=fire&fday=2&layers=fire",
    "planner winter view": "lat=44.98&lon=-93.26&name=US%20Bank%20Stadium&tz=America%2FChicago&scope=venue&view=winter&wlevel=MINOR&layers=winter", "planner flood day 1": "lat=39.11&lon=-84.52&name=TQL&tz=America%2FNew_York&scope=venue&view=day1&layers=flood",
    "shared two layers": "layers=severe,coastal&scope=national&view=active" };
  for (const [k, q] of Object.entries(LINKS)) { const { ctx, p } = await newPage(DEV.phone); await p.goto(HOST + "/threats?" + q, { waitUntil: "domcontentloaded" }); await ready(p).catch(() => {}); await p.waitForTimeout(2500);
    out.links[k] = await p.evaluate(() => ({ layers: Object.keys(window.__threats.S.layers).filter((x) => window.__threats.S.layers[x]), view: window.__threats.S.view, scope: window.__threats.S.scope, sum: document.getElementById("txLayersSum").textContent, feeds: window.ThreatsLive.mapFeeds() }));
    out.links[k].want = (/layers=([a-z,]+)/.exec(q) || [])[1]; log("link", k, JSON.stringify(out.links[k])); await ctx.close(); }
  fs.writeFileSync(path.join(OUT, "audit.json"), JSON.stringify(out, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
