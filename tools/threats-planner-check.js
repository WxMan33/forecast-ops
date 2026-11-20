#!/usr/bin/env node
/* Weather threats ↔ Event Planner, end to end on a deployment (Cloudflare Pages preview with the functions).
   Opens real events in Event Manager (?e= links) and checks the "Weather threats" section, its More info and its
   View on map links, against ARCHIVED official products (NWS Flash Flood Warnings and WPC Excessive Rainfall Outlooks,
   Florida, 2026-11-20, replayed at fixed times) and against the LIVE feeds. Also blocks the NWS route in this browser
   to confirm an outage never reads as "no threats".
     node tools/threats-planner-check.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/planner-check");
if (!HOST) { console.error("usage: threats-planner-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const E = (name, lat, lon, t) => encodeURIComponent(JSON.stringify({ n: name, v: { name, lat, lon }, z: "America/New_York", t, g: 25 }));
const DAYTONA = ["Daytona International Speedway", 29.1852, -81.0705], FAIR = ["Flagler County Fairgrounds", 29.4447, -81.2896], ATL = ["Mercedes-Benz Stadium", 33.7554, -84.4008];
const FRI = { setup: "2026-11-20T09:00", gates: "2026-11-20T11:00", start: "2026-11-20T12:30", end: "2026-11-20T16:00", teardown: "2026-11-20T18:00" };
const MON = { setup: "2026-11-23T14:00", gates: "2026-11-23T16:00", start: "2026-11-23T17:00", end: "2026-11-23T20:00", teardown: "2026-11-23T21:00" };
const NIGHT = { setup: "2026-11-20T21:00", gates: "2026-11-20T22:00", start: "2026-11-20T23:00", end: "2026-11-21T08:00", teardown: "2026-11-21T09:00" };
const FAIR_T = { gates: "2026-11-20T12:00", start: "2026-11-20T13:00", end: "2026-11-20T17:00" };

const results = [];
const check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 300))); };

(async () => {
  const b = await chromium.launch();
  async function planner(query, opts = {}) {
    const ctx = await b.newContext(opts.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1000 }, deviceScaleFactor: opts.dsf || 1 });
    const p = await ctx.newPage(), errors = [], feeds = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("requestfinished", async (r) => { const u = r.url(); if (!/\/api\/(nws|wpc)\/|api\.weather\.gov|wpc\.ncep|mapservices/.test(u)) return; const res = await r.response(), h = res ? await res.allHeaders() : {}; feeds.push({ url: u, status: res && res.status(), cache: h["x-forecast-ops-cache"] || null, upstreamAt: h["x-upstream-fetched-at"] || null }); });
    if (opts.blockNws) await p.route("**/api/nws/**", (route) => route.abort());
    await p.goto(HOST + "/event-beta?" + query, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.EventThreatsLast, null, { timeout: 60000 });
    await p.waitForTimeout(opts.wait || 1200);
    const read = () => p.evaluate(() => { const r = window.EventThreatsLast; return { summary: r.summary, confirmed: r.confirmed, items: r.items.map((i) => ({ kind: i.kind, headline: i.headline, line: i.line, product: i.product.id, category: i.product.category || null, day: i.product.day || null, phases: i.phases })), statuses: r.statuses.map((s) => s.name + ": " + s.text), maps: [...document.querySelectorAll("[data-map]")].map((a) => a.href) }; });
    return { p, ctx, errors, feeds, read };
  }
  const shot = async (v, name, full) => { await v.p.locator("#secThreats").scrollIntoViewIfNeeded(); await v.p.waitForTimeout(300); await (full ? v.p.screenshot({ path: path.join(OUT, name + ".png") }) : v.p.locator("#secThreats").screenshot({ path: path.join(OUT, name + ".png") })); };

  /* 1. ARCHIVED: Daytona, Friday — both items, More info, View on map */
  let v = await planner("threats=archive-flood-day&e=" + E(...DAYTONA, FRI), { dsf: 2 }), r = await v.read();
  check("archived Daytona: Flash Flood Warning and WPC Day 1 High are separate items", r.items.length === 2 && r.items[0].kind === "warning" && r.items[1].kind === "outlook" && r.items[1].category === "HIGH", r.items);
  check("archived Daytona: warning wording from the product and schedule", r.items[0] && r.items[0].headline === "Flash Flood Warning until 2:30 p.m." && /Covers the venue during setup, gates and the event\./.test(r.items[0].line), r.items[0]);
  check("archived Daytona: outlook wording says it is a period risk, not timing", r.items[1] && /^Excessive rainfall risk Friday · High \(at least 70%\)$/.test(r.items[1].headline) && /not timing within it/.test(r.items[1].line), r.items[1]);
  await v.p.click(".et-more"); const more = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("More info: source, issued and updated, in effect until, last checked, venue, official link", /NWS Melbourne FL/.test(more) && /Issued[\s\S]*10:04 AM EST · updated Fri, Nov 20, 12:23 PM EST/.test(more) && /until Fri, Nov 20, 2:30 PM EST/.test(more) && /Last checked/.test(more) && /Inside the warning area/.test(more), more);
  check("More info: official product link points at the NWS alert record", await v.p.evaluate(() => /api\.weather\.gov\/alerts\/urn:oid:/.test(document.querySelector(".et-detail:not([hidden]) a").href)));
  await shot(v, "ARCHIVED-planner-daytona-desktop");
  const links = r.maps; await v.ctx.close();
  for (const [i, want] of [[0, { view: "active", layer: "flood", sel: "KMLB.FF.W.0036.2026" }], [1, { view: "day1", layer: "flood", sel: r.items[1] && r.items[1].product }]]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(links[i].replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(2500);
    const s = await p.evaluate(() => ({ view: window.__threats.S.view, scope: window.__threats.S.scope, sel: window.__threats.S.sel, layers: window.__threats.S.layers, title: (document.querySelector(".px-title") || {}).textContent, center: window.__threats.map.getCenter() }));
    check("View on map (" + want.view + "): opens the map on the venue with the product selected and the flooding layer on", s.view === want.view && s.sel === want.sel && s.layers.flood && !s.layers.severe && !!s.title && errs.length === 0, s);
    await p.screenshot({ path: path.join(OUT, "ARCHIVED-map-from-planner-" + want.view + ".png") }); await ctx.close();
  }

  /* 2. phone */
  v = await planner("threats=archive-flood-day&e=" + E(...DAYTONA, FRI), { phone: true });
  check("phone: section renders without horizontal scroll", (await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0 && v.errors.length === 0, v.errors);
  await shot(v, "ARCHIVED-planner-daytona-phone"); await v.ctx.close();

  /* 3. venue and schedule changes */
  v = await planner("threats=archive-flood-day&e=" + E(...ATL, FRI)); r = await v.read();
  check("venue outside both footprints: no items, and 'none apply' only because sources are confirmed", r.items.length === 0 && r.confirmed && /^No flooding threats apply/.test(r.summary), r); await v.ctx.close();
  /* on one page, through the same update path Event Manager's venue and schedule edits use */
  v = await planner("threats=archive-flood-day&e=" + E(...DAYTONA, FRI));
  const steps = await v.p.evaluate(() => {
    const base = window.EventThreats.current(), n = () => window.EventThreatsLast.items.length, out = [n()];
    window.EventThreats.update({ ...base, loc: { name: "Mercedes-Benz Stadium", lat: 33.7554, lon: -84.4008 } }); out.push(n());
    window.EventThreats.update(base); out.push(n());
    window.EventThreats.update({ ...base, times: { setup: "2026-11-20T06:00", start: "2026-11-20T07:00", end: "2026-11-20T09:30" } }); out.push(n());
    window.EventThreats.update(base); out.push(n());
    return out;
  });
  check("same page: venue moved out and back, hours moved before the products and back: 2 → 0 → 2 → 0 → 2", JSON.stringify(steps) === "[2,0,2,0,2]", steps);
  await v.ctx.close();
  v = await planner("threats=archive-flood-day&e=" + E(...DAYTONA, MON)); r = await v.read();
  check("event moved to Monday: items removed; outlook range stated, not 'none'", r.items.length === 0 && !r.confirmed && r.statuses.some((s) => /runs past the outlooks issued so far/.test(s)), r); await v.ctx.close();
  v = await planner("threats=archive-flood-night&e=" + E(...DAYTONA, NIGHT), { dsf: 2 }); r = await v.read();
  check("overnight event across two outlook periods: Day 1 High and Day 2 Marginal, each with its own phases", JSON.stringify(r.items.map((i) => [i.day, i.category, i.phases.join("+")])) === JSON.stringify([[1, "HIGH", "setup+gates+event"], [2, "MRGL", "event+teardown"]]), r.items);
  await shot(v, "ARCHIVED-planner-overnight"); await v.ctx.close();
  v = await planner("threats=archive-flood-day&e=" + E(...FAIR, FAIR_T)); const before = await v.read(); await v.ctx.close();
  v = await planner("threats=archive-flood-afternoon&e=" + E(...FAIR, FAIR_T), { dsf: 2 }); const after = await v.read();
  check("real warning update moves coverage off the venue: Flagler warning item drops at 2:20 p.m.; the outlook stays", before.items.some((i) => i.product === "KJAX.FF.W.0054.2026") && !after.items.some((i) => i.kind === "warning") && after.items.some((i) => i.kind === "outlook" && i.category === "MDT"), { before: before.items, after: after.items });
  await shot(v, "ARCHIVED-planner-fairgrounds-after-update"); await v.ctx.close();

  /* 3b. ARCHIVED outage: NWS answered until 1 p.m., the warning's published end (2:30 p.m.) passes, now 2:40 p.m. */
  v = await planner("threats=archive-flood-outage&e=" + E(...DAYTONA, FRI), { dsf: 2 }); r = await v.read();
  const notes = await v.p.evaluate(() => (window.EventThreatsLast.notes || []).map((n) => n.text));
  check("outage replay: the expired Flash Flood Warning is no longer an active item, a note says it reached its published expiration, NWS status stays unknown", !r.items.some((i) => i.kind === "warning") && notes.length === 1 && /reached its published expiration \(2:30 p\.m\.\)/.test(notes[0]) && r.statuses.some((x) => /^NWS warnings, watches and advisories: Not confirmed since 1 p\.m\./.test(x)) && !r.confirmed && r.items.some((i) => i.kind === "outlook"), { r, notes });
  await shot(v, "ARCHIVED-planner-outage-warning-expired"); await v.ctx.close();

  /* 3c. WINTER (ARCHIVED official): NWS Salt Lake City advisory → warning (Nov 18–19) and WPC WSSI-P captured Nov 20 */
  const EW = (name, lat, lon, t, z) => encodeURIComponent(JSON.stringify({ n: name, v: { name, lat, lon }, z, t, g: 25 }));
  const SNOW = ["Snowbird", 40.5813, -111.6556], PARK = ["Park City Mountain", 40.6514, -111.508], CRYS = ["Crystal Mountain", 46.935, -121.475];
  const FRI_UT = { setup: "2026-11-20T14:00", gates: "2026-11-20T16:00", start: "2026-11-20T17:00", end: "2026-11-20T21:00", teardown: "2026-11-20T23:00" };
  const TUE_WA = { setup: "2026-11-24T06:00", gates: "2026-11-24T09:00", start: "2026-11-24T10:00", end: "2026-11-24T15:00", teardown: "2026-11-24T17:00" };
  const LONG_WA = { setup: "2026-11-26T08:00", start: "2026-11-27T10:00", end: "2026-11-28T15:00", teardown: "2026-11-28T18:00" };
  const openMap = async (href, name) => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(href.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(2500);
    const s = await p.evaluate(() => ({ view: window.__threats.S.view, sel: window.__threats.S.sel, layers: window.__threats.S.layers, wlevel: window.__threats.S.wlevel, wwin: window.__threats.S.wwin, venue: (document.querySelector(".px-where") || {}).textContent, title: (document.querySelector(".px-title") || document.querySelector(".px-big") || {}).textContent, wssi: window.__threats.map.getSource("wssi")._data.features.length }));
    await p.screenshot({ path: path.join(OUT, name + ".png") }); await ctx.close(); return { s, errs };
  };
  // several days out: the outlook
  v = await planner("threats=archive-winter-outlook&e=" + EW(...CRYS, TUE_WA, "America/Los_Angeles"), { dsf: 2 }); r = await v.read();
  check("WINTER outlook 4 days ahead (Crystal Mountain, Tue): 'Minor winter impacts likely Tuesday · 60%', window and phases shown", r.items.length === 1 && /^Minor winter impacts likely Tuesday · 60% chance of at least Minor impacts$/.test(r.items[0].headline) && /24 hours Tue 4 a\.m\. – Wed 4 a\.m\..*overlaps setup, gates, the event and teardown/.test(r.items[0].line), r.items);
  await v.p.click(".et-more"); let wm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("WINTER More info: WPC file time, 24-hour window, chance per level, coverage end, official link", /WPC file Fri, Nov 20/.test(wm) && /Tue, Nov 24, 4:00 AM PST → Wed, Nov 25, 4:00 AM PST/.test(wm) && /Minor 60%/.test(wm) && /Covers through[\s\S]*Fri, Nov 27/.test(wm) && await v.p.evaluate(() => /prob_wssi/.test(document.querySelector(".et-detail:not([hidden]) a").href)), wm);
  await shot(v, "ARCHIVED-planner-winter-outlook-crystal"); const wl = r.maps[0]; await v.ctx.close();
  let m = await openMap(wl, "ARCHIVED-map-from-planner-winter-outlook");
  check("WINTER View on map (outlook): Winter 7-day view at the venue, same window and level, areas drawn", m.s.view === "winter" && m.s.wlevel === "MINOR" && m.s.wwin === "2026-11-24T12:00:00.000Z" && m.s.layers.winter && /Crystal Mountain/.test(m.s.venue) && /60% chance of at least Minor/.test(m.s.title) && m.s.wssi > 0 && !m.errs.length, m);
  // coverage end
  v = await planner("threats=archive-winter-outlook&e=" + EW(...CRYS, LONG_WA, "America/Los_Angeles")); r = await v.read();
  check("WINTER event running past the last WSSI-P window: coverage end stated, never 'none'", !r.confirmed && r.statuses.some((x) => /WSSI-P.*(runs past|beyond)/.test(x)), r); await v.ctx.close();
  // a later replay: the official alerts
  v = await planner("threats=archive-winter-advisory&e=" + EW(...SNOW, FRI_UT, "America/Denver"), { dsf: 2 }); r = await v.read();
  check("WINTER replay Nov 18 4 p.m.: Winter Weather Advisory at Snowbird, from its forecast zone", r.items.length === 1 && r.items[0].headline === "Winter Weather Advisory during setup, gates, the event and teardown" && /forecast zone that includes the venue/.test(r.items[0].line), r.items);
  await v.p.click(".et-more"); wm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("WINTER More info (advisory): issued 3:49 PM, in effect from Thu 11 AM, zones listed", /Issued\s*Wed, Nov 18, 3:49 PM MST/.test(wm) && /from Thu, Nov 19, 11:00 AM MST until Sat, Nov 21, 11:00 AM MST/.test(wm) && /UTZ110/.test(wm), wm);
  await shot(v, "ARCHIVED-planner-winter-advisory-snowbird"); await v.ctx.close();
  v = await planner("threats=archive-winter-warning&e=" + EW(...SNOW, FRI_UT, "America/Denver"), { dsf: 2 }); r = await v.read();
  check("WINTER replay Nov 19 10 a.m.: upgraded; 'Winter Storm Warning during setup, gates, the event and teardown'", r.items.length === 1 && r.items[0].headline === "Winter Storm Warning during setup, gates, the event and teardown" && r.items[0].product === "KSLC.WS.W.0003.2026", r.items);
  await shot(v, "ARCHIVED-planner-winter-warning-snowbird"); const wwl = r.maps[0];
  const wsteps = await v.p.evaluate(() => {
    const base = window.EventThreats.current(), h = () => window.EventThreatsLast.items.map((i) => i.headline).join(" | ") || "none", out = [h()];
    window.EventThreats.update({ ...base, loc: { name: "Park City Mountain", lat: 40.6514, lon: -111.508 } }); out.push(h());
    window.EventThreats.update({ ...base, times: { setup: "2026-11-21T14:00", start: "2026-11-21T16:00", end: "2026-11-21T20:00" } }); out.push(h());
    window.EventThreats.update({ ...base, times: { setup: "2026-11-21T08:00", gates: "2026-11-21T09:00", start: "2026-11-21T10:00", end: "2026-11-21T14:00" } }); out.push(h());
    window.EventThreats.update(base); out.push(h());
    return out;
  });
  check("WINTER same page: Snowbird warning → Park City advisory → event after the warning ends (none) → setup overlaps the warning → back", /^Winter Storm Warning during/.test(wsteps[0]) && /^Winter Weather Advisory during/.test(wsteps[1]) && wsteps[2] === "none" && /^Winter Storm Warning during setup/.test(wsteps[3]) && wsteps[4] === wsteps[0], wsteps);
  await v.ctx.close();
  m = await openMap(wwl, "ARCHIVED-map-from-planner-winter-warning");
  check("WINTER View on map (warning): Active now at Snowbird, the warning selected, Winter layer only", m.s.view === "active" && m.s.sel === "KSLC.WS.W.0003.2026" && m.s.layers.winter && !m.s.layers.flood && /Winter Storm Warning/.test(m.s.title) && !m.errs.length, m);
  v = await planner("threats=archive-winter-outlook&e=" + EW(...CRYS, TUE_WA, "America/Los_Angeles"), { phone: true });
  check("WINTER phone: Planner section without horizontal scroll", (await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0 && !v.errors.length, v.errors);
  await shot(v, "ARCHIVED-planner-winter-phone"); await v.ctx.close();
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), p = await ctx.newPage();
    await p.goto(wl.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats") + "&sheet=open"); await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(2500);
    check("WINTER phone map: winter view without horizontal scroll", (await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await p.screenshot({ path: path.join(OUT, "ARCHIVED-map-winter-phone.png") }); await ctx.close(); }

  /* 4. LIVE feeds through the functions */
  v = await planner("e=" + E(...DAYTONA, { setup: "2026-11-21T09:00", gates: "2026-11-21T11:00", start: "2026-11-21T12:30", end: "2026-11-21T16:00", teardown: "2026-11-21T18:00" }), { dsf: 2, wait: 9000 }); r = await v.read();
  const viaFn = v.feeds.filter((f) => /\/api\/(nws|wpc)\//.test(f.url)), direct = v.feeds.filter((f) => /api\.weather\.gov\/alerts\/active\?event=|wpc\.ncep|wpc_precip_hazards/.test(f.url)); // the threats feeds only; Event Manager's own point forecast requests are separate
  check("live: NWS and WPC requests go through the same-origin functions with their upstream time", viaFn.length >= 4 && direct.length === 0 && viaFn.every((f) => f.status === 200 && f.upstreamAt), { viaFn, direct });
  check("live: every source states its check time or its gap", r.statuses.length >= 2 && r.statuses.every((s) => /Checked|Not confirmed|Not responding|outside/.test(s)), r.statuses);
  fs.writeFileSync(path.join(OUT, "live-planner.json"), JSON.stringify({ at: new Date().toISOString(), result: r, feeds: v.feeds }, null, 1));
  await shot(v, "LIVE-planner-daytona-saturday"); await v.ctx.close();

  /* 4b. LIVE winter: a mountain venue this weekend; NWS winter alerts through the function, WSSI-P point values from the NOAA map service */
  v = await planner("e=" + EW(...SNOW, { setup: "2026-11-21T08:00", gates: "2026-11-21T09:00", start: "2026-11-21T10:00", end: "2026-11-21T16:00", teardown: "2026-11-21T18:00" }, "America/Denver"), { dsf: 2, wait: 2000 });
  await v.p.waitForFunction(() => !window.EventThreatsLast.statuses.some((x) => /Loading|Checking/.test(x.text)), null, { timeout: 90000 }).catch(() => {}); await v.p.waitForTimeout(500); r = await v.read();
  const ws = v.feeds.filter((f) => /wpc_wssi_p/.test(f.url));
  check("LIVE winter: WSSI-P point queries answered and the source states its check time", ws.filter((f) => f.status === 200).length >= 4 && r.statuses.some((x) => /WSSI-P\): Checked/.test(x)), { ws, st: r.statuses });
  check("LIVE winter: NWS winter alerts reach Planner (any active at the venue are listed with their phases)", r.statuses.some((x) => /^NWS warnings, watches and advisories: Checked/.test(x)), r);
  fs.writeFileSync(path.join(OUT, "live-planner-winter.json"), JSON.stringify({ at: new Date().toISOString(), result: r, feeds: v.feeds }, null, 1));
  await shot(v, "LIVE-planner-winter-snowbird"); const liveW = r.items.find((i) => /WSSI-P/.test(i.line)), liveWi = r.items.indexOf(liveW), liveMaps = r.maps; await v.ctx.close();
  if (liveW) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(liveMaps[liveWi].replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.map.getSource("wssi")._data.features.length > 0, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(2500);
    const s2 = await p.evaluate(() => ({ view: window.__threats.S.view, wssi: window.__threats.map.getSource("wssi")._data.features.length, big: (document.querySelector(".px-big") || {}).textContent }));
    check("LIVE winter View on map: WSSI-P areas drawn for the window, the venue's chance matches Planner", s2.view === "winter" && s2.wssi > 0 && new RegExp(liveW.headline.match(/(\d+)%/)[1] + "%").test(s2.big) && !errs.length, { s2, head: liveW.headline, errs });
    await p.screenshot({ path: path.join(OUT, "LIVE-map-winter-from-planner.png") }); await ctx.close();
  } else check("LIVE winter View on map: a WSSI-P item at the venue to open", false, r.items);

  /* 5. outage: NWS route blocked in this browser */
  v = await planner("e=" + E(...ATL, FRI), { blockNws: true, wait: 4000 }); r = await v.read();
  check("NWS outage: status says not responding and the summary is not 'no threats'", !r.confirmed && /^Not fully confirmed/.test(r.summary) && r.statuses.some((s) => /^NWS warnings, watches and advisories: Not responding/.test(s)), r);
  await shot(v, "LIVE-planner-nws-outage-simulated"); await v.ctx.close();

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  const failed = results.filter((x) => !x.pass).length; console.log((results.length - failed) + " of " + results.length + " passed");
  await b.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
