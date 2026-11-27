/* Event Manager "View on map" links: on the combined beta preview, every map link on the event page (across archived samples
   for each hazard family, plus airports) opens threats.html on the intended layer, venue and selected item, and the map keeps the
   link's layers: no automatic layer changes and no rainfall overlay unless the link names one.
   Usage: node tools/threats-maplinks-check.js https://<host> [outDir] */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/maplinks-check");
if (!HOST) { console.error("usage: node tools/threats-maplinks-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const E = (name, lat, lon, t, z = "America/New_York") => encodeURIComponent(JSON.stringify({ n: name, v: { name, lat, lon }, z, t, g: 25 }));
const CASES = [ // the same archived samples as the full regression
  ["flood", "threats=archive-flood-day&e=" + E("Daytona International Speedway", 29.1852, -81.0705, { setup: "2026-11-20T09:00", gates: "2026-11-20T11:00", start: "2026-11-20T12:30", end: "2026-11-20T16:00", teardown: "2026-11-20T18:00" })],
  ["winter outlook", "threats=archive-winter-outlook&e=" + E("Crystal Mountain", 46.935, -121.475, { setup: "2026-11-24T06:00", gates: "2026-11-24T09:00", start: "2026-11-24T10:00", end: "2026-11-24T15:00", teardown: "2026-11-24T17:00" }, "America/Los_Angeles")],
  ["winter warning", "threats=archive-winter-warning&e=" + E("Snowbird", 40.5813, -111.6556, { setup: "2026-11-20T14:00", gates: "2026-11-20T16:00", start: "2026-11-20T17:00", end: "2026-11-20T21:00", teardown: "2026-11-20T23:00" }, "America/Denver")],
  ["fire outlook", "threats=archive-fire-day2&e=" + E("Grant County Fairgrounds", 47.1166, -119.2783, { setup: "2026-08-01T08:00", gates: "2026-08-01T11:00", start: "2026-08-01T12:00", end: "2026-08-01T20:00", teardown: "2026-08-01T22:00" }, "America/Los_Angeles")],
  ["fire incidents", "threats=archive-fire-incidents&e=" + E("Lake Pueblo State Park", 38.2655, -104.7246, { setup: "2026-11-21T08:00", start: "2026-11-21T10:00", end: "2026-11-21T16:00" }, "America/Denver")],
  ["smoke", "threats=archive-smoke-chicago&e=" + E("Soldier Field", 41.8623, -87.6167, { gates: "2026-07-16T18:00", start: "2026-07-16T19:00", end: "2026-07-16T22:00" }, "America/Chicago")],
  ["tropical", "threats=archive-tropical-warning&e=" + E("The Wharf, Orange Beach", 30.297, -87.56, { setup: "2026-10-09T12:00", gates: "2026-10-09T16:00", start: "2026-10-09T17:00", end: "2026-10-09T21:00", teardown: "2026-10-09T23:00" }, "America/Chicago")],
  ["coastal", "threats=archive-coastal-flagler&e=" + E("Flagler Beach Pier", 29.4802, -81.1065, { start: "2026-11-21T14:00", end: "2026-11-21T18:00" })],
  ["aviation", "threats=archive-aviation-chicago&air=" + encodeURIComponent(JSON.stringify([{ i: "KORD", r: "p", a: ["2026-11-22T10:45", "2026-11-22T11:30"], d: ["2026-11-23T10:00", "2026-11-23T11:00"] }, { i: "KMDW", r: "a", a: ["2026-11-22T10:45", "2026-11-22T11:30"] }])) + "&e=" + E("United Center", 41.8807, -87.6742, { start: "2026-11-22T12:00", end: "2026-11-22T15:00" }, "America/Chicago")],
];
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 700))); };

(async () => {
  const b = await chromium.launch();
  for (const [label, query] of CASES) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } }), p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(HOST + "/event-beta?" + query, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.EventThreatsLast, null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(3500);
    const links = await p.evaluate(() => [...document.querySelectorAll("#secThreats a[data-map], #secThreats a[data-map-ap], #secThreats a.et-apmap")].map((a) => ({ text: a.closest("li, .et-ap") ? (a.closest("li, .et-ap").querySelector(".et-head, .et-aph") || {}).textContent || "" : "", href: a.href })).filter((x, i, s) => s.findIndex((y) => y.href === x.href) === i));
    const ev = (() => { const v = JSON.parse(decodeURIComponent(new URLSearchParams(query).get("e"))).v; return { lat: v.lat, lon: v.lon }; })(); // the event's own venue
    await ctx.close();
    check(`(${label}) Event Manager shows ${links.length} View on map link(s)`, links.length > 0 && !errs.length, { links: links.length, errs });
    for (const l of links.slice(0, 6)) {
      const u = new URL(l.href), q = u.searchParams, want = { layers: (q.get("layers") || "").split(",").filter(Boolean), sel: q.get("sel"), view: q.get("view"), lat: +q.get("lat"), lon: +q.get("lon"), scope: q.get("scope"), ap: q.get("ap") };
      const c2 = await b.newContext({ viewport: { width: 1280, height: 1000 } }), m = await c2.newPage(), e2 = [];
      m.on("pageerror", (e) => e2.push(e.message));
      await m.goto(l.href, { waitUntil: "domcontentloaded", timeout: 60000 });
      await m.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.map, null, { timeout: 60000 }).catch(() => {}); await m.waitForTimeout(3500);
      const s = await m.evaluate(() => { const T = window.__threats, S = T.S, v = T.venue || {}; const vis = (id) => !!(T.map.getLayer(id) && T.map.getLayoutProperty(id, "visibility") === "visible");
        return { layers: Object.keys(S.layers).filter((k) => S.layers[k]), sel: S.sel, view: S.view, scope: S.scope, auto: S.auto, rain: S.rain, rainDrawn: vis("rain-obs") || vis("rain-fcst"), ap: S.ap, venue: { lat: v.lat, lon: v.lon, name: v.name }, panel: (document.getElementById("txPanelBody") || {}).innerText.slice(0, 200), errors: T.errors.map((x) => x.stage + ": " + x.message) }; });
      const name = (l.text || "").replace(/\s+/g, " ").trim().slice(0, 70);
      const ok = want.layers.every((k) => s.layers.includes(k)) && s.layers.length === want.layers.length && (!want.sel || s.sel === want.sel) && (!want.view || s.view === want.view) && s.scope === want.scope
        && Math.abs(s.venue.lat - want.lat) < 1e-3 && Math.abs(s.venue.lon - want.lon) < 1e-3 && (!ev || (Math.abs(want.lat - ev.lat) < 1e-3 && Math.abs(want.lon - ev.lon) < 1e-3))
        && !s.auto && !s.rain.obs && !s.rain.fcst && !s.rainDrawn && (!want.ap || s.ap === want.ap) && !e2.length && !s.errors.length;
      check(`(${label}) '${name}' → layers ${s.layers.join(",")}, view ${s.view}, ${want.sel ? "selected " + (s.sel === want.sel ? "as linked" : s.sel) : "no selection"}, venue ${s.venue.name}; not automatic, no rainfall overlay`, ok, { want, s, e2 });
      await c2.close();
    }
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, "maplinks-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
