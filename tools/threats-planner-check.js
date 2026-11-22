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
    p.on("requestfinished", async (r) => { const u = r.url(); if (!/\/api\/(nws|wpc|smoke|awc|faa)\/|services\.arcgis\.com\/cJ9YHowT8TU7DUyn|api\.weather\.gov|wpc\.ncep|mapservices|spc\.noaa\.gov\/products\/(exper\/)?fire_wx|services3\.arcgis\.com/.test(u)) return; const res = await r.response(), h = res ? await res.allHeaders() : {}; feeds.push({ url: u, status: res && res.status(), cache: h["x-forecast-ops-cache"] || null, upstreamAt: h["x-upstream-fetched-at"] || null }); });
    if (opts.blockNws) await p.route("**/api/nws/**", (route) => route.abort());
    if (opts.blockSmoke) { await p.route("**/api/smoke/**", (route) => route.abort()); await p.route(/services\.arcgis\.com\/cJ9YHowT8TU7DUyn|air_quality\/ndgd_smoke/, (route) => route.abort()); }
    if (opts.blockWssiExtreme) await p.route(/wpc_wssi_p\/MapServer\/4\/query/, (route) => route.abort());
    if (opts.slowSmoke) await p.route("**/api/smoke/**", async (route) => { await new Promise((r) => setTimeout(r, 25000)); route.continue(); });
    await p.goto(HOST + "/event-beta?" + query, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.EventThreatsLast, null, { timeout: 60000 });
    await p.waitForTimeout(opts.wait || 1200);
    const read = () => p.evaluate(() => { const r = window.EventThreatsLast; return { summary: r.summary, confirmed: r.confirmed, items: r.items.map((i) => ({ id: i.id, kind: i.kind, headline: i.headline, code: i.code || null, line: i.line, product: i.product.id, category: i.product.category || null, day: i.product.day || null, phases: i.phases })), statuses: r.statuses.map((s) => s.name + ": " + s.text), maps: [...document.querySelectorAll("[data-map]")].map((a) => a.href) }; });
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
    const s = await p.evaluate(() => ({ view: window.__threats.S.view, sel: window.__threats.S.sel, layers: window.__threats.S.layers, wlevel: window.__threats.S.wlevel, wwin: window.__threats.S.wwin, venue: (document.querySelector(".px-where") || {}).textContent, title: (document.querySelector(".px-title") || document.querySelector(".px-big") || {}).textContent, wssi: window.__threats.map.getSource("wssi")._data.features.length, mon: window.__threats.map.getSource("aqmon")._data.features.length }));
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

  /* 3d. FIRE (ARCHIVED official): SPC fire weather outlooks Jul 29-Aug 1, NWS Denver/Boulder watch -> Red Flag Warning
     Nov 17-18, NIFC WFIGS snapshot 2026-11-21 */
  const MOSES = ["Grant County Fairgrounds", 47.1166, -119.2783], CANVAS = ["Canvas Stadium", 40.5718, -105.0897], LAKEP = ["Lake Pueblo State Park", 38.2655, -104.7246];
  const SAT_AUG1 = { setup: "2026-08-01T08:00", gates: "2026-08-01T11:00", start: "2026-08-01T12:00", end: "2026-08-01T20:00", teardown: "2026-08-01T22:00" };
  const WED_CO = { setup: "2026-11-18T07:00", gates: "2026-11-18T10:00", start: "2026-11-18T11:00", end: "2026-11-18T15:00", teardown: "2026-11-18T18:00" };
  const SAT_CO = { setup: "2026-11-21T08:00", start: "2026-11-21T10:00", end: "2026-11-21T16:00" };
  v = await planner("threats=archive-fire-day4&e=" + EW(...MOSES, SAT_AUG1, "America/Los_Angeles"), { dsf: 2 }); r = await v.read();
  check("FIRE days ahead (Jul 29): 'Critical fire weather area Saturday (Day 4 outlook)' at Moses Lake, with window and phases", r.items.length === 1 && r.items[0].headline === "Critical fire weather area Saturday (Day 4 outlook)" && /Sat 5 a\.m\. – Sun 5 a\.m\.\) overlaps setup, gates, the event and teardown/.test(r.items[0].line), r.items);
  await shot(v, "ARCHIVED-planner-fire-day4-moseslake"); const f4 = r.maps[0]; await v.ctx.close();
  m = await openMap(f4, "ARCHIVED-map-from-planner-fire-day4");
  check("FIRE View on map (Day 4): Fire view, Day 4, the Critical area selected", m.s.view === "fire" && m.s.sel && /d4-windrh-CRIT/.test(m.s.sel) && m.s.layers.fire && /Critical fire weather area/.test(m.s.title) && !m.errs.length, m);
  v = await planner("threats=archive-fire-day2&e=" + EW(...MOSES, SAT_AUG1, "America/Los_Angeles"), { dsf: 2 }); r = await v.read();
  check("FIRE two days out (Jul 31): 'Extremely Critical fire weather risk Saturday'", r.items.length === 1 && r.items[0].headline === "Extremely Critical fire weather risk Saturday", r.items);
  await v.p.click(".et-more"); let fm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("FIRE More info (outlook): SPC Day 2, issued, valid window, category and SPC's meaning, official link", /SPC Day 2 fire weather outlook/.test(fm) && /Issued\s*Fri, Jul 31, 1:02 PM PDT/.test(fm) && /Sat, Aug 1, 5:00 AM PDT → Sun, Aug 2, 5:00 AM PDT/.test(fm) && /Extremely Critical \(wind and relative humidity\)/.test(fm) && /not by whether fires start/.test(fm), fm);
  const fsteps = await v.p.evaluate(() => {
    const base = window.EventThreats.current(), h = () => window.EventThreatsLast.items.map((i) => i.headline).join(" | ") || "none", out = [h()];
    window.EventThreats.update({ ...base, loc: { name: "Spokane Arena", lat: 47.665, lon: -117.4235 } }); out.push(h());
    window.EventThreats.update({ ...base, times: { start: "2026-08-02T10:00", end: "2026-08-02T16:00" } }); out.push(h());
    window.EventThreats.update(base); out.push(h()); return out;
  });
  check("FIRE same page: Moses Lake Extremely Critical → Spokane Critical → event moved to Sunday (none) → back", fsteps[0] === "Extremely Critical fire weather risk Saturday" && fsteps[1] === "Critical fire weather risk Saturday" && fsteps[2] === "none" && fsteps[3] === fsteps[0], fsteps);
  await shot(v, "ARCHIVED-planner-fire-day2-moseslake"); await v.ctx.close();
  v = await planner("threats=archive-fire-watch&e=" + EW(...CANVAS, WED_CO, "America/Denver"), { dsf: 2 }); r = await v.read();
  check("FIRE replay Nov 17 1 p.m.: Fire Weather Watch at Fort Collins from its fire weather zone, with its start", r.items.length === 1 && r.items[0].headline === "Fire Weather Watch during setup, gates, the event and teardown" && /from 8 a\.m\. Wednesday until 4 p\.m\. Wednesday \(issued for the fire weather zone/.test(r.items[0].line), r.items);
  await shot(v, "ARCHIVED-planner-fire-watch-fortcollins"); await v.ctx.close();
  v = await planner("threats=archive-fire-warning&e=" + EW(...CANVAS, WED_CO, "America/Denver"), { dsf: 2 }); r = await v.read();
  check("FIRE replay Nov 18 midnight: upgraded to 'Red Flag Warning during setup, gates, the event and teardown'", r.items.length === 1 && r.items[0].headline === "Red Flag Warning during setup, gates, the event and teardown", r.items);
  await v.p.click(".et-more"); fm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("FIRE More info (Red Flag): issued 11:11 PM, in effect 8 AM-4 PM, fire weather zones listed", /Issued\s*Tue, Nov 17, 11:11 PM MST/.test(fm) && /from Wed, Nov 18, 8:00 AM MST until Wed, Nov 18, 4:00 PM MST/.test(fm) && /fire weather zones it lists: COZ238, COZ239/.test(fm), fm);
  const den = await v.p.evaluate(() => { const base = window.EventThreats.current(); window.EventThreats.update({ ...base, loc: { name: "Empower Field", lat: 39.7439, lon: -105.0201 } }); const n = window.EventThreatsLast.items.length; window.EventThreats.update(base); return n; });
  check("FIRE: Denver (watch cancelled, not upgraded) has no fire weather alert", den === 0, den);
  await shot(v, "ARCHIVED-planner-fire-redflag-fortcollins"); const rfl = r.maps[0]; await v.ctx.close();
  m = await openMap(rfl, "ARCHIVED-map-from-planner-fire-redflag");
  check("FIRE View on map (Red Flag): Active now, the warning selected, Fire layer only", m.s.view === "active" && /KBOU\.FW\.W\.0057/.test(m.s.sel || "") && m.s.layers.fire && !m.s.layers.winter && /Red Flag Warning/.test(m.s.title) && !m.errs.length, m);
  v = await planner("threats=archive-fire-incidents&e=" + EW(...LAKEP, SAT_CO, "America/Denver"), { dsf: 2 }); r = await v.read();
  check("FIRE incidents (NIFC snapshot): 'Wildfire 12 miles southwest: Aspen Acres · 102,007 acres · 96% contained'", r.items.length === 1 && r.items[0].headline === "Wildfire 12 miles southwest: Aspen Acres · 102,007 acres · 96% contained" && /updated Nov 19, 3:29 PM/.test(r.items[0].line), r.items);
  await v.p.click(".et-more"); fm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("FIRE More info (incident): size, containment, discovered, NIFC update, perimeter date, distance, incident ID", /102,007 acres/.test(fm) && /96%/.test(fm) && /Discovered\s*Mon, Jun 29/.test(fm) && /Thu, Nov 19, 3:29 PM MST \(NIFC incident record\)/.test(fm) && /Mapped Mon, Aug 10/.test(fm) && /12 miles southwest of the venue to the perimeter edge/.test(fm) && /2026-COCUX-001160/.test(fm), fm);
  const far = await v.p.evaluate(() => { const base = window.EventThreats.current(); window.EventThreats.update({ ...base, loc: { name: "Colorado State Fairgrounds", lat: 38.2611, lon: -104.6189 } }); const n = window.EventThreatsLast.items.length; window.EventThreats.update(base); return n; });
  check("FIRE incidents: the State Fairgrounds (17.5 mi) does not list it", far === 0, far);
  await shot(v, "ARCHIVED-planner-fire-incident-lakepueblo"); const incl = r.maps[0]; await v.ctx.close();
  m = await openMap(incl, "ARCHIVED-map-from-planner-fire-incident");
  check("FIRE View on map (incident): Active now, Aspen Acres selected with its perimeter", m.s.view === "active" && /^nifc-/.test(m.s.sel || "") && m.s.title === "Aspen Acres" && !m.errs.length, m);
  v = await planner("threats=archive-fire-day2&e=" + EW(...MOSES, SAT_AUG1, "America/Los_Angeles"), { phone: true });
  check("FIRE phone: Planner section without horizontal scroll", (await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0 && !v.errors.length, v.errors);
  await shot(v, "ARCHIVED-planner-fire-phone"); await v.ctx.close();
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), p = await ctx.newPage();
    await p.goto(f4.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats").replace(/&sel=[^&]*/, "") + "&sheet=open"); await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(2500);
    check("FIRE phone map: Fire view without horizontal scroll", (await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await p.screenshot({ path: path.join(OUT, "ARCHIVED-map-fire-phone.png") }); await ctx.close(); }

  /* 4. LIVE feeds through the functions */
  v = await planner("e=" + E(...DAYTONA, { setup: "2026-11-21T09:00", gates: "2026-11-21T11:00", start: "2026-11-21T12:30", end: "2026-11-21T16:00", teardown: "2026-11-21T18:00" }), { dsf: 2, wait: 2000 });
  await v.p.waitForFunction(() => !window.EventThreatsLast.statuses.some((x) => /Loading/.test(x.text)), null, { timeout: 90000 }).catch(() => {}); await v.p.waitForTimeout(500); r = await v.read();
  const viaFn = v.feeds.filter((f) => /\/api\/(nws|wpc)\//.test(f.url)), direct = v.feeds.filter((f) => /api\.weather\.gov\/alerts\/active\?event=|wpc\.ncep|wpc_precip_hazards/.test(f.url)); // the threats feeds only; Event Manager's own point forecast requests are separate
  check("live: NWS and WPC requests go through the same-origin functions with their upstream time", viaFn.length >= 4 && direct.length === 0 && viaFn.every((f) => f.status === 200 && f.upstreamAt), { viaFn, direct });
  check("live: every source states its check time or its gap", r.statuses.length >= 2 && r.statuses.every((s) => /Checked|Not confirmed|Not responding|outside|No AirNow/.test(s)), r.statuses);
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
    await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.liveReady && window.__threats.map.getSource("wssi")._data.features.length > 0, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(2500);
    const s2 = await p.evaluate(() => ({ view: window.__threats.S.view, wssi: window.__threats.map.getSource("wssi")._data.features.length, big: (document.querySelector(".px-big") || {}).textContent }));
    check("LIVE winter View on map: WSSI-P areas drawn for the window, the venue's chance matches Planner", s2.view === "winter" && s2.wssi > 0 && new RegExp(liveW.headline.match(/(\d+)%/)[1] + "%").test(s2.big) && !errs.length, { s2, head: liveW.headline, errs });
    await p.screenshot({ path: path.join(OUT, "LIVE-map-winter-from-planner.png") }); await ctx.close();
  } else check("LIVE winter View on map: no live WSSI-P item at the test venue right now, so there is nothing to open (recorded, not a failure; the archived winter map link is checked above)", true, r.items.map((i) => i.headline));

  /* 4c. LIVE fire: SPC fire outlooks Days 1-8 and NIFC incidents answer; the venue's matching is stated per source */
  v = await planner("e=" + EW("Cheyenne Frontier Days Arena", 41.1505, -104.8301, { start: new Date(Date.now() + 2 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/Denver" }).slice(0, 16).replace(" ", "T"), end: new Date(Date.now() + 5 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/Denver" }).slice(0, 16).replace(" ", "T") }, "America/Denver"), { dsf: 2, wait: 2000 });
  await v.p.waitForFunction(() => !window.EventThreatsLast.statuses.some((x) => /Loading/.test(x.text)), null, { timeout: 90000 }).catch(() => {}); await v.p.waitForTimeout(500); r = await v.read();
  const fireFeeds = v.feeds.filter((f) => /spc\.noaa\.gov\/products\/(exper\/)?fire_wx|services3\.arcgis\.com/.test(f.url));
  check("LIVE fire: SPC fire outlooks (16 files, Days 1-8) and NIFC incidents + perimeters answered; both sources state their check time", fireFeeds.filter((f) => /fire_wx/.test(f.url) && f.status === 200).length >= 16 && fireFeeds.filter((f) => /arcgis/.test(f.url) && f.status === 200).length >= 2 && r.statuses.some((x) => /^SPC fire weather outlooks: Checked .* Days 1, 2, 3, 4, 5, 6, 7, 8/.test(x)) && r.statuses.some((x) => /^NIFC wildfire incidents \(WFIGS\): Checked/.test(x)), { st: r.statuses, n: fireFeeds.length });
  fs.writeFileSync(path.join(OUT, "live-planner-fire.json"), JSON.stringify({ at: new Date().toISOString(), result: r, feeds: fireFeeds }, null, 1));
  await shot(v, "LIVE-planner-fire-cheyenne"); await v.ctx.close();
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(HOST + "/threats?view=fire&fday=1&layers=fire", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.liveReady && window.__threats.map.getSource("inc-pt")._data.features.length > 0, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(3000);
    const s2 = await p.evaluate(() => ({ inc: window.__threats.map.getSource("inc-pt")._data.features.length, per: window.__threats.map.getSource("inc")._data.features.length, valid: document.getElementById("txValid").textContent }));
    check("LIVE fire map: NIFC incidents and perimeters drawn; Day 1 outlook window stated", s2.inc > 50 && s2.per > 10 && /SPC Day 1/.test(s2.valid) && !errs.length, { s2, errs });
    await p.screenshot({ path: path.join(OUT, "LIVE-map-fire-national.png") }); await ctx.close(); }

  /* 4d. SMOKE AND AIR QUALITY (ARCHIVED official): NOAA HMS daily KML and AirNow archived HourlyAQObs / reportingarea.dat */
  const SOLD = ["Soldier Field", 41.8623, -87.6167], METL = ["MetLife Stadium", 40.8135, -74.0745], LINCF = ["Lincoln Financial Field", 39.9008, -75.1675];
  const THU_CHI = { gates: "2026-07-16T18:00", start: "2026-07-16T19:00", end: "2026-07-16T22:00" }, TUE_NY = { gates: "2026-07-14T18:00", start: "2026-07-14T19:00", end: "2026-07-14T22:00" }, THU_PHL = { start: "2026-07-16T13:00", end: "2026-07-16T17:00" };
  v = await planner("threats=archive-smoke-chicago&e=" + EW(...SOLD, THU_CHI, "America/Chicago"), { dsf: 2 }); r = await v.read();
  check("SMOKE Chicago Jul 16 (no wildfire within 15 mi): surface reading, satellite smoke and the day's forecast are separate items, each with its own time; no wildfire attribution",
    JSON.stringify(r.items.map((i) => i.kind)) === JSON.stringify(["aqobs", "smoke", "aqfcst"]) && /^Air quality now: Hazardous \(AQI \d+, PM2\.5\) at .+, \d+ miles \w+$/.test(r.items[0].headline) && /AirNow monitor reading for 5 p\.m\./.test(r.items[0].line)
    && /^Smoke detected over the area · Medium \(satellite, 12 p\.m\.–3 p\.m\.\)$/.test(r.items[1].headline) && r.items[2].headline === "Air quality forecast Thursday: Hazardous (PM2.5)" && !r.items.some((i) => /wildfire/i.test(i.headline + i.line)), r.items);
  await v.p.locator(".et-more").nth(0).click(); await v.p.locator(".et-more").nth(1).click();
  let sm = await v.p.evaluate(() => [...document.querySelectorAll(".et-detail:not([hidden])")].map((d) => d.innerText).join("\n---\n"));
  check("SMOKE More info: monitor, reporting area, observed hour, preliminary-data note; satellite window, satellite, density and 'not a ground reading'", /Monitor\s*CHI_\w+ · Chicago reporting area/.test(sm) && /Observed\s*Thu, Jul 16, 5:00 PM CDT \(hourly reading\)/.test(sm) && /Preliminary data/.test(sm) && /Thu, Jul 16, 12:00 PM CDT → Thu, Jul 16, 3:00 PM CDT \(GOES-WEST imagery\)/.test(sm) && /does not measure air quality at the ground/.test(sm), sm);
  const ssteps = await v.p.evaluate(() => {
    const base = window.EventThreats.current(), k = () => window.EventThreatsLast.items.map((i) => i.kind).join("+") || "none", out = [k()];
    window.EventThreats.update({ ...base, times: { start: "2026-07-18T19:00", end: "2026-07-18T22:00" } }); out.push(k());
    window.EventThreats.update({ ...base, times: { start: "2026-07-15T19:00", end: "2026-07-15T22:00" } }); out.push(k());
    window.EventThreats.update({ ...base, loc: { name: "MetLife Stadium", lat: 40.8135, lon: -74.0745 } }); out.push(k() + "@" + (window.EventThreatsLast.items.find((i) => i.kind === "aqfcst") || { line: "" }).line.split(" reporting area")[0]);
    window.EventThreats.update(base); out.push(k()); return out;
  });
  check("SMOKE same page: Thursday all three → Saturday keeps current conditions only → past event none → moved to MetLife: no Chicago monitors, that day's smoke over New Jersey and the New York City Region forecast → back", JSON.stringify(ssteps) === JSON.stringify(["aqobs+smoke+aqfcst", "aqobs+smoke", "none", "smoke+aqfcst@New York City Region", "aqobs+smoke+aqfcst"]), ssteps);
  await shot(v, "ARCHIVED-planner-smoke-chicago"); const smLinks = r.maps; await v.ctx.close();
  m = await openMap(smLinks[0], "ARCHIVED-map-from-planner-smoke-monitor");
  check("SMOKE View on map (monitor): Smoke & air layer only, the monitor selected", m.s.view === "active" && /^airnow-/.test(m.s.sel || "") && m.s.layers.smoke && !m.s.layers.fire && /^CHI_/.test(m.s.title || "") && !m.errs.length, m);
  m = await openMap(smLinks[1], "ARCHIVED-map-from-planner-smoke-plume");
  check("SMOKE View on map (plume): the HMS polygon selected", /^hms-/.test(m.s.sel || "") && m.s.title === "Medium smoke detected" && !m.errs.length, m);
  v = await planner("threats=archive-smoke-metlife&e=" + EW(...METL, TUE_NY, "America/New_York"), { dsf: 2 }); r = await v.read();
  check("SMOKE MetLife Jul 14: 'Smoke detected over the area · Heavy'; the surface reading is reported separately (Moderate, not an item); the ozone forecast is labelled ozone",
    r.items[0] && /^Smoke detected over the area · Heavy \(satellite, 1 p\.m\.–4 p\.m\.\)$/.test(r.items[0].headline) && !r.items.some((i) => i.kind === "aqobs") && r.statuses.some((x) => /^AirNow air quality observations: Checked .* nearest monitor Union City High School \(4 miles southeast\): AQI 53 Moderate \(PM2\.5\) for 5 p\.m\.$/.test(x)) && r.items.some((i) => i.kind === "aqfcst" && /Ozone/.test(i.headline)), { items: r.items, st: r.statuses });
  await shot(v, "ARCHIVED-planner-smoke-metlife"); const ml = r.maps[0]; await v.ctx.close();
  m = await openMap(ml, "ARCHIVED-map-from-planner-smoke-metlife");
  check("SMOKE View on map (MetLife plume): Heavy plume selected; monitors drawn", m.s.title === "Heavy smoke detected" && m.s.mon > 0 && !m.errs.length, m);
  const f14 = await planner("threats=archive-smoke-forecast-0714&e=" + EW(...LINCF, THU_PHL, "America/New_York")); const r14 = await f14.read(); await f14.ctx.close();
  v = await planner("threats=archive-smoke-forecast-0715&e=" + EW(...LINCF, THU_PHL, "America/New_York"), { dsf: 2 }); r = await v.read();
  check("SMOKE days ahead, Philadelphia: Jul 14's forecast for Thursday is Moderate (no item); Jul 15's is 'Air quality forecast Thursday: Unhealthy (AQI 180, PM2.5)'", r14.items.length === 0 && r.items.length === 1 && r.items[0].headline === "Air quality forecast Thursday: Unhealthy (AQI 180, PM2.5)", { r14: r14.items, r: r.items });
  await shot(v, "ARCHIVED-planner-smoke-forecast-philadelphia"); await v.ctx.close();
  v = await planner("threats=archive-smoke-chicago&e=" + EW(...SOLD, THU_CHI, "America/Chicago"), { phone: true });
  check("SMOKE phone: Planner section without horizontal scroll", (await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0 && !v.errors.length, v.errors);
  await shot(v, "ARCHIVED-planner-smoke-phone"); await v.ctx.close();
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), p = await ctx.newPage();
    await p.goto(smLinks[1].replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats") + "&sheet=open"); await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(2500);
    check("SMOKE phone map: plume detail without horizontal scroll", (await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await p.screenshot({ path: path.join(OUT, "ARCHIVED-map-smoke-phone.png") }); await ctx.close(); }

  /* 4e. LIVE smoke and air quality: HMS through the function, AirNow and NOAA guidance direct; a venue with a current reading */
  v = await planner("e=" + EW("Ford Field", 42.34, -83.0456, { start: new Date(Date.now() + 2 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/Detroit" }).slice(0, 16).replace(" ", "T"), end: new Date(Date.now() + 5 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/Detroit" }).slice(0, 16).replace(" ", "T") }, "America/Detroit"), { dsf: 2, wait: 2000 });
  await v.p.waitForFunction(() => !window.EventThreatsLast.statuses.some((x) => /Loading/.test(x.text)), null, { timeout: 90000 }).catch(() => {}); await v.p.waitForTimeout(500); r = await v.read();
  const sf = v.feeds.filter((f) => /\/api\/smoke\/|cJ9YHowT8TU7DUyn|ndgd_smoke/.test(f.url));
  check("LIVE smoke: HMS via the function (upstream time), AirNow monitors + forecast area answered; NOAA smoke guidance is not requested (off until NOAA documents its unit); each source states its check time and the nearest monitor reading",
    sf.some((f) => /\/api\/smoke\/hms\//.test(f.url) && f.status === 200 && f.upstreamAt) && sf.some((f) => /Air%20Now%20Current/.test(f.url) && f.status === 200) && sf.some((f) => /\/api\/smoke\/airnow-area/.test(f.url) && f.status === 200) && !sf.some((f) => /ndgd_smoke/.test(f.url)) && !r.statuses.some((x) => /NAQFC/.test(x))
    && r.statuses.some((x) => /^NOAA satellite smoke analysis \(HMS\): Checked/.test(x)) && r.statuses.some((x) => /^AirNow air quality observations: Checked .* nearest monitor .+ AQI \d+/.test(x)) && r.statuses.some((x) => /^AirNow air quality forecasts: Checked .* reporting area/.test(x)), { st: r.statuses, feeds: sf.map((f) => [f.url.slice(0, 90), f.status]) });
  fs.writeFileSync(path.join(OUT, "live-planner-smoke.json"), JSON.stringify({ at: new Date().toISOString(), result: r, feeds: sf }, null, 1));
  await shot(v, "LIVE-planner-smoke-detroit"); await v.ctx.close();
  v = await planner("e=" + EW(...ATL, { start: new Date(Date.now() + 2 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16).replace(" ", "T"), end: new Date(Date.now() + 5 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16).replace(" ", "T") }), { blockSmoke: true, wait: 2000 });
  await v.p.waitForFunction(() => !window.EventThreatsLast.statuses.some((x) => /^NWS.*Loading|^WPC Excessive.*Loading/.test(x.name + ": " + x.text)), null, { timeout: 60000 }).catch(() => {}); await v.p.waitForTimeout(3000); r = await v.read();
  check("SMOKE feeds failed (blocked in this browser): the other sources still answer; smoke sources say not responding; nothing claims 'no smoke'", r.statuses.some((x) => /^NWS warnings, watches and advisories: Checked/.test(x)) && r.statuses.some((x) => /^NOAA satellite smoke analysis \(HMS\): Not responding/.test(x)) && r.statuses.some((x) => /^AirNow air quality observations: Not responding/.test(x)) && !r.confirmed, r);
  await shot(v, "LIVE-planner-smoke-feeds-blocked"); await v.ctx.close();
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage(); const t0 = Date.now();
    await p.route("**/api/smoke/**", async (route) => { await new Promise((res) => setTimeout(res, 25000)); route.continue().catch(() => {}); });
    await p.goto(HOST + "/threats", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.liveReady, null, { timeout: 60000 }).catch(() => {});
    const ms = Date.now() - t0, st = await p.evaluate(() => ({ live: window.__threats.liveReady, hms: window.__threats.data.state.hms && window.__threats.data.state.hms.kind }));
    check("SMOKE slow feed (HMS held 25 s): the map is ready before it answers; HMS reads 'Loading' meanwhile", st.live && ms < 20000 && st.hms === "loading", { ms, st });
    await ctx.close(); }

  /* 4f. MAP CRASH REGRESSION (2026-11-21: "Cannot read properties of undefined (reading 'slice')" at shade <- drawMap <- setView
     when an SPC fire weather Day 1 area existed: fire outlooks were taken for convective outlooks). Drives the map through
     scopes, every layer and every view; asserts no page error, no load-guard banner and no failed draw stage. */
  async function mapStress(query, name, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message + " @ " + (e.stack || "").split("\n")[1]));
    if (opts.block) await p.route(opts.block, (route) => route.abort());
    await p.goto(HOST + "/threats" + query, { waitUntil: "domcontentloaded" });
    await p.waitForFunction((live) => window.__threats && window.__threats.ready && !window.__threats.data.loading && (!live || window.__threats.liveReady), !!opts.live, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const click = async (sel) => { const el = p.locator(sel).first(); if (await el.count() && await el.isVisible()) { await el.click(); await p.waitForTimeout(600); } };
    for (const sc of ["national", "venue", "national"]) await click(`[data-scope="${sc}"]`);
    for (const L of ["severe", "flood", "winter", "fire", "smoke", "tropical", "coastal"]) { await click(`.tx-lb[data-layer="${L}"]`); await click(`.tx-lb[data-layer="${L}"]`); }
    for (const vw of ["day1", "day2", "day3", "winter", "fire", "active"]) { await click(`.tx-tb[data-view="${vw}"]`); await click('[data-scope="venue"]'); await click('[data-scope="national"]'); }
    for (const d of [1, 2, 4]) { await click('.tx-tb[data-view="fire"]'); await click(`[data-fday="${d}"]`); }
    await click('.tx-tb[data-view="active"]');
    if (opts.refreshWait) await p.waitForTimeout(opts.refreshWait); // background refreshes (alerts every minute)
    const st = await p.evaluate(() => ({ banner: !!document.getElementById("loadGuard"), stageErrors: window.__threats.errors.map((e) => e.stage + ": " + e.message), convectiveHasFire: window.__threats.data.products.some((x) => /^spcfire-/.test(x.program || "") && x.kind === "outlook") ? window.__threats.map.getSource("outlook")._data.features.some((f) => /^spc-fire-/.test(f.properties.id)) : false, rows: [...document.querySelectorAll(".px-src")].map((r) => r.innerText.replace(/\s+/g, " ")) }));
    await p.screenshot({ path: path.join(OUT, name + ".png") }); await ctx.close();
    return { errs, ...st };
  }
  let ms2 = await mapStress("?scenario=archive-fire-day1&layers=severe,flood,winter,fire,smoke,tropical,coastal", "ARCHIVED-map-crash-regression-fire-day1");
  check("CRASH REGRESSION (replay of the failing state: a Day 1 fire weather area with every layer on): scopes, layers and views, including Day 1, give no page error, no banner, no failed draw stage; fire areas never reach the convective outlook layer", !ms2.errs.length && !ms2.banner && !ms2.stageErrors.length && !ms2.convectiveHasFire, ms2);
  ms2 = await mapStress("", "LIVE-map-crash-regression", { live: true, refreshWait: 75000 });
  check("CRASH REGRESSION (live, CVG default, all layers): the same walk-through plus 75 s of background refreshes: no page error, no banner, no failed draw stage", !ms2.errs.length && !ms2.banner && !ms2.stageErrors.length && !ms2.convectiveHasFire, ms2);
  ms2 = await mapStress("", "LIVE-map-partial-feeds", { live: true, block: /spc\.noaa\.gov\/products\/(exper\/)?fire_wx|services3\.arcgis\.com|\/api\/smoke\//, refreshWait: 5000 });
  check("PARTIAL FEEDS (SPC fire outlooks, NIFC and HMS blocked): the other layers and every control still work with no error; the blocked sources say so", !ms2.errs.length && !ms2.banner && !ms2.stageErrors.length && ms2.rows.some((x) => /NIFC wildfire incidents \(WFIGS\) Not responding/.test(x)), ms2);
  ms2 = await mapStress("?scenario=archive-tropical-warning&layers=severe,flood,winter,fire,smoke,tropical,coastal", "ARCHIVED-map-crash-regression-tropical");
  check("CRASH REGRESSION (tropical replay with every layer on, NHC cone, track, points and warnings drawn): no page error, no banner, no failed draw stage", !ms2.errs.length && !ms2.banner && !ms2.stageErrors.length, ms2);

  /* 4g. TROPICAL (ARCHIVED official): Hurricane Isaias, NWS Mobile TCV texts (IEM archive) + NHC advisories 4 and 6 */
  const WHARF = ["The Wharf, Orange Beach", 30.297, -87.56], BAYM = ["Bay Minette", 30.8829, -87.7731];
  const FRI_OCT9 = { setup: "2026-10-09T12:00", gates: "2026-10-09T16:00", start: "2026-10-09T17:00", end: "2026-10-09T21:00", teardown: "2026-10-09T23:00" };
  v = await planner("threats=archive-tropical-watch&e=" + EW(...WHARF, FRI_OCT9, "America/Chicago"), { dsf: 2 }); r = await v.read();
  check("TROPICAL Oct 7 noon CDT (advisory 4): Hurricane Watch and Storm Surge Watch at Orange Beach for a Friday event, until further notice, with NWS's wind window", JSON.stringify(r.items.map((i) => i.headline).sort()) === JSON.stringify(["Hurricane Watch during setup, gates, the event and teardown", "Storm Surge Watch during setup, gates, the event and teardown"]) && /until further notice .* NWS window for tropical-storm-force winds: Friday afternoon until early Saturday morning\. Updated with each NHC advisory\.$/.test(r.items[0].line), r.items);
  await v.p.locator(".et-more").nth(0).click(); let tm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("TROPICAL More info: NWS Mobile, issued 11:09 AM CDT, 'until further notice · next NWS update due by', wind timing, the archived product link", /NWS Mobile AL/.test(tm) && /Issued\s*Wed, Oct 7, 11:09 AM CDT/.test(tm) && /until further notice · next NWS update due by/.test(tm) && /Wind timing\s*NWS window for tropical-storm-force winds: Friday afternoon until early Saturday morning/.test(tm) && await v.p.evaluate(() => /mesonet\.agron\.iastate\.edu\/p\.php\?pid=/.test(document.querySelector(".et-detail:not([hidden]) a").href)), tm);
  await shot(v, "ARCHIVED-planner-tropical-watch-orangebeach"); await v.ctx.close();
  v = await planner("threats=archive-tropical-warning&e=" + EW(...WHARF, FRI_OCT9, "America/Chicago"), { dsf: 2 }); r = await v.read();
  check("TROPICAL Oct 8 midnight (advisory 6): upgraded to Hurricane Warning and Storm Surge Warning", JSON.stringify(r.items.map((i) => i.headline.split(" during ")[0]).sort()) === JSON.stringify(["Hurricane Warning", "Storm Surge Warning"]), r.items);
  const tsteps = await v.p.evaluate(() => {
    const base = window.EventThreats.current(), k = () => window.EventThreatsLast.items.map((i) => i.product.event).sort().join("+") || "none", out = [k()];
    window.EventThreats.update({ ...base, loc: { name: "Bay Minette", lat: 30.8829, lon: -87.7731 } }); out.push(k());
    window.EventThreats.update({ ...base, loc: { name: "Atlanta", lat: 33.7554, lon: -84.4008 } }); out.push(k());
    window.EventThreats.update(base); out.push(k()); return out;
  });
  check("TROPICAL same page: Orange Beach warning + surge → inland Bay Minette warning only → Atlanta none → back", JSON.stringify(tsteps) === JSON.stringify(["Hurricane Warning+Storm Surge Warning", "Hurricane Warning", "none", "Hurricane Warning+Storm Surge Warning"]), tsteps);
  await shot(v, "ARCHIVED-planner-tropical-warning-orangebeach"); const trl = r.maps[0]; await v.ctx.close();
  m = await openMap(trl, "ARCHIVED-map-from-planner-tropical-warning");
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(HOST + "/threats?scenario=archive-tropical-warning&scope=national&layers=tropical", { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(2500);
    const s3 = await p.evaluate(() => ({ cone: window.__threats.map.getSource("tcone")._data.features.length, lines: window.__threats.map.getSource("tline")._data.features.length, pts: window.__threats.map.getSource("tpts")._data.features.length, txt: document.getElementById("txPanelBody").innerText }));
    check("TROPICAL map (advisory 6): NHC cone, track, forecast points and coastal warning segments drawn as regional context, with the cone caveat", s3.cone === 1 && s3.lines >= 2 && s3.pts >= 5 && /likely path of the storm's center; impacts reach well outside it/.test(s3.txt) && !errs.length, { ...s3, txt: s3.txt.slice(0, 400), errs });
    await p.screenshot({ path: path.join(OUT, "ARCHIVED-map-tropical-nhc-cone.png") }); await ctx.close(); }
  check("TROPICAL View on map (warning): Active now at the venue, the warning selected, Tropical layer", m.s.view === "active" && /^KMOB\.(HU|SS)\.W\.1009/.test(m.s.sel || "") && m.s.layers.tropical && !m.errs.length, m);

  /* 4h. COASTAL, standalone (no tropical system): NWS Jacksonville coastal products, captured live 2026-11-21 */
  const FLAGP = ["Flagler Beach Pier", 29.4802, -81.1065];
  v = await planner("threats=archive-coastal-flagler&e=" + EW(...FLAGP, { start: "2026-11-21T14:00", end: "2026-11-21T18:00" }, "America/New_York"), { dsf: 2 }); r = await v.read();
  check("COASTAL replay, Flagler Beach Pier (NWS places it in marine zone AMZ454, no land zone): flagged 'Coastal alert for the adjacent shoreline' for the Coastal Flagler products, with their end times", JSON.stringify(r.items.map((i) => i.headline)) === JSON.stringify(["Coastal alert for the adjacent shoreline: Coastal Flood Warning", "Coastal alert for the adjacent shoreline: High Surf Advisory", "Coastal alert for the adjacent shoreline: Rip Current Statement"]) && /NWS places the venue in no land forecast zone \(AMZ454\).*In effect until 5 a\.m\. Monday during the event\./.test(r.items[0].line), r.items);
  await v.p.locator(".et-more").nth(0).click(); { const cm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText); check("COASTAL More info (adjacent shoreline): says the venue is in no land zone (AMZ454) and how far the alert's zone is", /Coastal alert for the adjacent shoreline: NWS places the venue in no land forecast zone \(AMZ454\); the alert was issued for the coastal zone 1 mile away/.test(cm), cm); }
  { const inl = await v.p.evaluate(() => { const base = window.EventThreats.current(); window.EventThreats.update({ ...base, loc: { name: "Inland point near Palm Coast", lat: 29.42, lon: -81.17 } }); const h = window.EventThreatsLast.items.map((i) => i.headline); window.EventThreats.update(base); return h; });
    check("COASTAL inland point 0.6 mi from Coastal Flagler (NWS: Inland Flagler): only the Coastal Flood Warning issued for its own zone; no surf or rip current flag", JSON.stringify(inl) === JSON.stringify(["Coastal Flood Warning during the event"]), inl); }
  const csteps = await v.p.evaluate(() => {
    const base = window.EventThreats.current(), k = () => window.EventThreatsLast.items.map((i) => i.product.event).join("+") || "none", out = [k()];
    window.EventThreats.update({ ...base, loc: { name: "Jacksonville Beach Pier", lat: 30.2858, lon: -81.3889 } }); out.push(k());
    window.EventThreats.update({ ...base, times: { start: "2026-11-23T12:00", end: "2026-11-23T15:00" } }); out.push(k());
    window.EventThreats.update(base); out.push(k()); return out;
  });
  check("COASTAL same page: Flagler warning → Jacksonville Beach advisory (no warning) → Monday noon none → back", csteps[0] === "Coastal Flood Warning+High Surf Advisory+Rip Current Statement" && /Coastal Flood Advisory/.test(csteps[1]) && !/Coastal Flood Warning/.test(csteps[1]) && csteps[2] === "none" && csteps[3] === csteps[0], csteps);
  await shot(v, "ARCHIVED-planner-coastal-flagler"); const cml = r.maps[0]; await v.ctx.close();
  m = await openMap(cml, "ARCHIVED-map-from-planner-coastal");
  check("COASTAL View on map: the Coastal Flood Warning selected, Coastal layer", /KJAX\.CF\.W\.0004/.test(m.s.sel || "") && m.s.layers.coastal && /Coastal Flood Warning/.test(m.s.title || "") && !m.errs.length, m);
  v = await planner("threats=archive-coastal-flagler&e=" + EW(...FLAGP, { start: "2026-11-21T14:00", end: "2026-11-21T18:00" }, "America/New_York"), { phone: true });
  check("COASTAL phone: Planner section without horizontal scroll", (await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0 && !v.errors.length, v.errors);
  await shot(v, "ARCHIVED-planner-coastal-phone"); await v.ctx.close();

  /* 4i. LIVE coastal at the same pier, and live NHC on the map */
  { const nwsNow = await (await fetch("https://api.weather.gov/alerts/active?zone=FLZ138", { headers: { "User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)" } })).json().catch(() => ({ features: [] }));
    const liveEv = [...new Set((nwsNow.features || []).map((f) => f.properties.event).filter((e) => /Coastal Flood|High Surf|Rip Current|Beach Hazards/.test(e)))].sort();
    const st = new Date(Date.now() + 30 * 60e3).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16).replace(" ", "T"), en = new Date(Date.now() + 150 * 60e3).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16).replace(" ", "T");
    v = await planner("e=" + EW(...FLAGP, { start: st, end: en }, "America/New_York"), { dsf: 2, wait: 2000 });
    await v.p.waitForFunction(() => !window.EventThreatsLast.statuses.some((x) => /Loading/.test(x.text)), null, { timeout: 90000 }).catch(() => {}); await v.p.waitForTimeout(500); r = await v.read();
    const gotEv = [...new Set(r.items.map((i) => i.headline.replace(/^Coastal alert for the adjacent shoreline: /, "").split(" during ")[0]).filter((e) => /Coastal Flood|High Surf|Rip Current|Beach Hazards/.test(e)))].sort();
    check("LIVE coastal at Flagler Beach Pier: Planner lists exactly the coastal products NWS has active for Coastal Flagler now (" + (liveEv.join(", ") || "none") + ")", JSON.stringify(gotEv) === JSON.stringify(liveEv.filter((e) => r.items.length || true)) || (liveEv.length === 0 && gotEv.length === 0), { liveEv, gotEv, items: r.items.map((i) => i.headline), st: r.statuses });
    fs.writeFileSync(path.join(OUT, "live-planner-coastal.json"), JSON.stringify({ at: new Date().toISOString(), nwsActiveForZone: liveEv, result: r }, null, 1));
    await shot(v, "LIVE-planner-coastal-flagler"); await v.ctx.close(); }
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(HOST + "/threats?layers=tropical,coastal", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.liveReady && window.__threats.data.sources.nhc && window.__threats.data.sources.nhc.state !== "pending", null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(3000);
    const svc = await (await fetch("https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/3/query?where=1%3D1&returnCountOnly=true&f=json")).json().catch(() => ({}));
    const s4 = await p.evaluate(() => ({ two: window.__threats.map.getSource("two")._data.features.length, cones: window.__threats.map.getSource("tcone")._data.features.length, nhc: window.__threats.data.state.nhc && window.__threats.data.state.nhc.kind, txt: (document.getElementById("txPanelBody").innerText.match(/Tropics · NHC[\s\S]{0,300}/) || [""])[0] }));
    check("LIVE NHC on the map: the Tropical Weather Outlook areas NHC publishes now are drawn (" + svc.count + " area(s)); the source states its check", s4.two === svc.count && ["current", "empty"].includes(s4.nhc) && !errs.length, { s4, svc });
    await p.screenshot({ path: path.join(OUT, "LIVE-map-tropical-outlook.png") }); await ctx.close(); }

  /* 4j. CARRYOVERS: WSSI-P with the Extreme layer failing (blocked in this browser), and NOAA smoke guidance units */
  { v = await planner("e=" + EW("Snowbird", 40.5813, -111.6556, { start: new Date(Date.now() + 26 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/Denver" }).slice(0, 16).replace(" ", "T"), end: new Date(Date.now() + 30 * 3600e3).toLocaleString("sv-SE", { timeZone: "America/Denver" }).slice(0, 16).replace(" ", "T") }, "America/Denver"), { dsf: 2, wait: 1000, blockWssiExtreme: true });
    await v.p.waitForFunction(() => window.ThreatsLive && ["ok", "failed"].includes((window.ThreatsLive.snapshot().sources.wssip || {}).state), null, { timeout: 120000 }).catch(() => {}); await v.p.waitForTimeout(800);
    const w = await v.p.evaluate(() => window.ThreatsLive.snapshot().sources.wssip); r = await v.read();
    check("WSSI-P Extreme layer failing (blocked): after the retry, Extreme is unavailable, the other levels are kept, and Planner's source line says 'Extreme unavailable'", w.state === "ok" && JSON.stringify(w.unavailable) === JSON.stringify(["EXTREME"]) && r.statuses.some((x) => /WSSI-P\): Checked .*Extreme unavailable/.test(x)), { w, st: r.statuses.filter((x) => /WSSI/.test(x)) });
    if (w.state === "ok" && r.items.some((i) => /winter/i.test(i.headline) && i.kind === "outlook")) { const k = r.items.findIndex((i) => /winter/i.test(i.headline) && i.kind === "outlook"); await v.p.locator(".et-more").nth(k).click(); const wm = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText); check("WSSI-P More info: Extreme unavailable, the answered levels listed with their chances", /Extreme unavailable/.test(wm) && /Minor (under 5%|\d+%)/.test(wm), wm); }
    await shot(v, "LIVE-planner-wssip-extreme-blocked"); await v.ctx.close(); }
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/wpc_wssi_p\/MapServer\/4\/query/, (route) => route.abort());
    await p.goto(HOST + "/threats?lat=40.5813&lon=-111.6556&name=Snowbird&tz=America%2FDenver&scope=venue&view=winter&layers=winter", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.liveReady && window.__threats.data.sources.wssip && window.__threats.data.sources.wssip.state === "ok", null, { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(2500);
    const wtxt = await p.evaluate(() => (document.querySelector(".px-wlv") || {}).innerText || "");
    check("WSSI-P on the map with the Extreme layer failing: the winter panel shows 'Extreme unavailable' and keeps the other levels", /Extreme\s*unavailable/.test(wtxt) && /Minor\s*(under 5%|\d+%)/.test(wtxt) && !errs.length, { wtxt, errs });
    await p.screenshot({ path: path.join(OUT, "LIVE-map-wssip-extreme-unavailable.png") }); await ctx.close(); }
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage(), reqs = []; p.on("request", (q) => reqs.push(q.url()));
    await p.goto(HOST + "/threats?layers=smoke&scope=venue", { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.__threats && window.__threats.liveReady, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(6000);
    const rows = await p.evaluate(() => [...document.querySelectorAll(".px-src")].map((r) => r.innerText));
    check("NOAA smoke guidance off on the map too: no request to NOAA's smoke raster, no NAQFC row, no concentration shown", !reqs.some((u) => /ndgd_smoke/.test(u)) && !rows.some((x) => /NAQFC/.test(x)), { n: reqs.filter((u) => /ndgd_smoke/.test(u)).length, rows }); await ctx.close(); }

  /* 4k. AVIATION (official METAR/TAF, NOAA Aviation Weather Center): archived capture of Nov 22 16:3xZ, then live */
  const AIR = encodeURIComponent(JSON.stringify([{ i: "KORD", r: "p", a: ["2026-11-22T10:45", "2026-11-22T11:30"], d: ["2026-11-23T10:00", "2026-11-23T11:00"] }, { i: "KMDW", r: "a", a: ["2026-11-22T10:45", "2026-11-22T11:30"] }]));
  const UCV = ["United Center", 41.8807, -87.6742], SUN22 = { start: "2026-11-22T12:00", end: "2026-11-22T15:00" };
  v = await planner("threats=archive-aviation-chicago&air=" + AIR + "&e=" + EW(...UCV, SUN22, "America/Chicago"), { dsf: 2 }); r = await v.read();
  check("AVIATION archived: O'Hare (primary) has IFR in its TAF during the arrival window and IFR now; Midway (alternate) named separately; each item names the airport, window and issue/observation time", r.items.some((i) => i.code === "KORD arrival (Sun 10:45 a.m.–11:30 a.m.): temporarily IFR forecast" && i.headline === "Low clouds (ceiling 700 ft) at times during your arrival, Sun 10:45 a.m.–11:30 a.m. at O'Hare (KORD) · IFR") && r.items.some((i) => i.code === "KORD now: IFR (observed 10:31 a.m.)" && /^Right now at O'Hare \(KORD\): low clouds/.test(i.headline)) && r.items.some((i) => /^KMDW arrival/.test(i.code) && /^Alternate airport/.test(i.line)) && r.statuses.some((x) => /Aviation Weather Center.*KORD METAR 1631Z IFR · TAF 1627Z AMD/.test(x)), r.items);
  { const venueOnly = await v.p.evaluate(() => { const base = window.EventThreats.current(); return window.ThreatsMatch.forEvent({ products: [], state: {}, event: { lat: base.loc.lat, lon: base.loc.lon, tz: base.tz, windows: window.OpsCore.event.windows(base) }, now: Date.parse("2026-11-22T16:35:00Z"), families: ["severe", "flood", "winter", "fire", "tropical", "coastal"] }).items.length; });
    check("AVIATION: the venue itself has no hazard item (venue looks fine) while the arrival airport has the concern", venueOnly === 0, venueOnly); }
  const kordArr = r.items.find((i) => (i.code || "").startsWith("KORD arrival")).id; // airport items render grouped by airport, so find them by id, not by list position
  await v.p.locator(`.et-more[data-id="${kordArr}"]`).click();
  let am = await v.p.evaluate(() => document.querySelector(".et-detail:not([hidden])").innerText);
  check("AVIATION More info: airport and role, TAF issue (amended), valid window, your arrival window, the overlapping TEMPO period, the raw TAF", /KORD · Chicago\/O'Hare Intl · primary airport/.test(am) && /Issued\s*Sun, Nov 22, 10:27 AM CST \(1627Z, amended\)/.test(am) && /Your arrival window\s*Sun, Nov 22, 10:45 AM CST → Sun, Nov 22, 11:30 AM CST/.test(am) && /TEMPO Sun, Nov 22, 10:00 AM CST → Sun, Nov 22, 11:00 AM CST: IFR, ceiling 700 ft/.test(am) && /TAF KORD 221627Z/.test(am), am);
  { const lay = await v.p.evaluate(() => { const box = document.getElementById("threats"), vis = [...box.querySelectorAll(".et-head, .et-line, .et-ok")].map((e) => e.textContent);
      return { heads: [...box.querySelectorAll(".et-h")].map((h) => h.textContent), aps: [...box.querySelectorAll(".et-aph")].map((h) => h.textContent.replace(/\s+/g, " ").trim()), vis, mapAp: [...box.querySelectorAll("[data-map-ap]")].map((a) => a.dataset.mapAp) }; });
    check("AVIATION layout: airport weather under its own heading, one block per airport with its role and a View on map link; lines lead in plain language with no raw METAR/TAF or Zulu times", lay.heads.includes("Airport weather") && lay.aps[0] === "O'Hare (KORD) · primary airport View on map" && lay.aps[1] === "Midway (KMDW) · alternate airport View on map" && lay.vis.every((t) => !/METAR|TAF|\d{4}Z|SM\b|BKN|OVC/.test(t)) && JSON.stringify(lay.mapAp) === '["KORD","KMDW"]', lay); }
  const avsteps = await v.p.evaluate(() => { const base = window.EventThreats.current(), n = () => window.EventThreatsLast.items.filter((i) => i.kind === "taf").length, out = [n()]; window.EventThreats.update({ ...base, times: { start: "2026-11-23T12:00", end: "2026-11-23T13:00" } }); out.push(n()); window.EventThreats.update(base); out.push(n()); return out; });
  check("AVIATION: airport items follow their own windows, not the event hours (moving the event leaves the arrival items)", avsteps[0] >= 2 && avsteps[1] === avsteps[0] && avsteps[2] === avsteps[0], avsteps);
  await shot(v, "ARCHIVED-planner-aviation-chicago"); const avl = await v.p.evaluate((id) => document.querySelector(`[data-map="${CSS.escape(id)}"]`).href, kordArr); await v.ctx.close();
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(avl.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(2500);
    const s5 = await p.evaluate(() => ({ view: window.__threats.S.view, sel: window.__threats.S.sel, layers: window.__threats.S.layers, air: window.__threats.S.air, apt: window.__threats.map.getSource("apt")._data.features.map((f) => f.properties.label), title: (document.querySelector(".px-title") || {}).textContent, inView: (() => { const S = window.__threats.S, a = window.__threats.data.products.find((x) => x.airport === S.ap && x.point); return !!a && window.__threats.map.getBounds().contains(a.point); })(), zoom: window.__threats.map.getZoom() }));
    check("AVIATION View on map: the selected airport (O'Hare) is in view, framed with the venue", s5.inView && s5.zoom >= 8.5, s5);
    check("AVIATION View on map: Aviation layer, the event's airports drawn with their flight category, O'Hare's TAF selected", s5.layers.aviation && /^taf-KORD/.test(s5.sel || "") && s5.apt.includes("KORD · IFR") && s5.apt.some((x) => /^KMDW/.test(x)) && /O'Hare/.test(s5.title || "") && !errs.length, s5);
    await p.screenshot({ path: path.join(OUT, "ARCHIVED-map-from-planner-aviation.png") }); await ctx.close(); }
  v = await planner("threats=archive-aviation-chicago&air=" + AIR + "&e=" + EW(...UCV, SUN22, "America/Chicago"), { phone: true });
  check("AVIATION phone: Planner section and airports form without horizontal scroll", (await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0 && !v.errors.length, v.errors);
  await shot(v, "ARCHIVED-planner-aviation-phone"); await v.ctx.close();
  { const loc = (ms) => new Date(ms).toLocaleString("sv-SE", { timeZone: "America/Chicago" }).slice(0, 16).replace(" ", "T");
    const LA = encodeURIComponent(JSON.stringify([{ i: "KORD", r: "p", a: [loc(Date.now() + 15 * 60e3), loc(Date.now() + 75 * 60e3)] }, { i: "KMDW", r: "a", a: [loc(Date.now() + 15 * 60e3), loc(Date.now() + 75 * 60e3)] }]));
    v = await planner("air=" + LA + "&e=" + EW(...UCV, { start: loc(Date.now() + 2 * 3600e3), end: loc(Date.now() + 4 * 3600e3) }, "America/Chicago"), { dsf: 2, wait: 2000 });
    await v.p.waitForFunction(() => window.EventThreatsLast.statuses.some((x) => /Aviation Weather Center/.test(x.name) && !/Loading/.test(x.text)), null, { timeout: 90000 }).catch(() => {}); await v.p.waitForTimeout(800); r = await v.read();
    const af = v.feeds.filter((f) => /\/api\/awc\//.test(f.url));
    check("LIVE aviation: METAR and TAF for KORD and KMDW through the same-origin function with their upstream time; the source line names each airport's METAR and TAF times", af.length >= 2 && af.every((f) => f.status === 200 && f.upstreamAt) && r.statuses.some((x) => /KORD METAR \d{4}Z \w+ · TAF \d{4}Z/.test(x) && /KMDW METAR/.test(x)), { af, st: r.statuses.filter((x) => /Aviation/.test(x)), items: r.items.filter((i) => /^K(ORD|MDW)/.test(i.headline)).map((i) => i.headline) });
    fs.writeFileSync(path.join(OUT, "live-planner-aviation.json"), JSON.stringify({ at: new Date().toISOString(), result: r, feeds: af }, null, 1));
    await shot(v, "LIVE-planner-aviation-chicago"); await v.ctx.close(); }

  /* 4l. AVIATION PHASE 2 (pilot reports, SIGMETs, G-AIRMETs, CWAs, FAA airport status): official capture of Nov 22 21:19Z, then live */
  { const ML = ["MetLife Stadium", 40.8135, -74.0745], T22 = { gates: "2026-11-22T18:45", start: "2026-11-22T20:15", end: "2026-11-22T23:30" };
    const AIR2 = encodeURIComponent(JSON.stringify([{ i: "KEWR", r: "p", a: ["2026-11-22T18:15", "2026-11-22T19:00"], d: ["2026-11-23T09:00", "2026-11-23T10:00"] }, { i: "KLGA", r: "a", a: ["2026-11-22T18:15", "2026-11-22T19:00"] }]));
    const RT2 = encodeURIComponent(JSON.stringify({ o: "KORD", d: "KEWR", lo: 10000, hi: 16000, w: ["2026-11-22T16:30", "2026-11-22T18:30"] }));
    for (const phone of [false, true]) {
      v = await planner("threats=archive-aviation-enroute&air=" + AIR2 + "&rt=" + RT2 + "&e=" + EW(...ML, T22, "America/New_York"), { phone, dsf: phone ? 2 : 1 }); r = await v.read();
      const lay = await v.p.evaluate(() => { const box = document.getElementById("threats"); return { heads: [...box.querySelectorAll(".et-h")].map((h) => h.textContent), faa: [...box.querySelectorAll(".et-faa .et-head")].map((h) => h.textContent), route: [...box.querySelectorAll(".et-route .et-head")].map((h) => h.textContent), approx: (box.querySelector(".et-approx") || {}).textContent || "", hs: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
      const tag = phone ? "phone" : "desktop";
      check("AVIATION 2 (" + tag + "): Airport weather, Flight disruptions and Along the route are separate headings, without horizontal scroll", JSON.stringify(lay.heads) === JSON.stringify(["Airport weather", "Flight disruptions", "Along the route"]) && !lay.hs, lay);
      check("AVIATION 2 (" + tag + "): FAA weather disruption: Newark's ground delay program for low ceilings, active, overlapping the arrival window", lay.faa[0] === "Ground delay program for low ceilings, average delay 1 hr 45 min (up to 5 hr 55 min) at Newark (KEWR) · active now, until Sun 11:59 p.m." && r.items.some((i) => i.kind === "faa" && /Weather-related \(FAA: low ceilings\)\. Overlaps your arrival window/.test(i.line)), lay.faa);
      check("AVIATION 2 (" + tag + "): advisory overlapping the approximate route in time and altitude, worded as a potential overlap", lay.route.includes("Moderate icing forecast may overlap your approximate route, 6,000 ft to FL210, Sun 4:30 p.m. – 6:30 p.m. · G-AIRMET") && /^A straight line between the airports, not your flight plan: matches are potential overlaps/.test(lay.approx), lay.route);
      if (!phone) { await shot(v, "ARCHIVED-planner-aviation-enroute");
        const enHref = await v.p.evaluate(() => document.querySelector(".et-route [data-map]").href);
        const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), q = await ctx.newPage(), errs = []; q.on("pageerror", (e) => errs.push(e.message));
        await q.goto(enHref.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" }); await q.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await q.waitForTimeout(2500);
        const s6 = await q.evaluate(() => { const T0 = window.__threats, m = T0.map, sel = T0.data.products.find((x) => x.id === T0.S.sel), c = sel && sel.geometry.coordinates[0]; return { sel: T0.S.sel, kind: (document.querySelector("#txPanelBody .tx-kind") || {}).textContent, inView: !!c && m.getBounds().contains([c.reduce((a, x) => a + x[0], 0) / c.length, c.reduce((a, x) => a + x[1], 0) / c.length]), route: m.queryRenderedFeatures({ layers: ["route-line"] }).length, alt: T0.S.en.alt }; });
        check("AVIATION 2 View on map: the advisory selected and in view, labelled a forecast advisory, the approximate route drawn, the map filtered to the route's band", /^gairmet-/.test(s6.sel || "") && s6.kind === "G-AIRMET · FORECAST ADVISORY" && s6.inView && s6.route > 0 && JSON.stringify(s6.alt) === "[10000,16000]" && !errs.length, { s6, errs });
        /* turbulence report at one altitude: the 6,000 ft JFK report shows below 10,000 ft and not at FL180-FL290 */
        await q.goto(HOST + "/threats?scenario=archive-aviation-enroute&scope=venue&layers=aviation&view=active", { waitUntil: "domcontentloaded" }); await q.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 60000 }); await q.waitForTimeout(2000);
        const jid = await q.evaluate(() => window.__threats.data.products.find((x) => x.kind === "pirep" && /^JFK UA \/OV JFK 220005/.test(x.raw)).id), has = () => q.evaluate((id) => window.__threats.map.getSource("pirep")._data.features.some((f) => f.properties.id === id), jid);
        await q.locator('[data-en-alt="0-10000"]').click(); await q.waitForTimeout(300); const low = await has();
        await q.locator('[data-en-alt="18000-29000"]').click(); await q.waitForTimeout(300); const mid = await has();
        await q.locator('[data-en-alt="0-10000"]').click(); await q.evaluate((id) => { window.__threats.S.sel = id; window.__threats.drawAll(); }, jid); await q.waitForTimeout(300);
        const det = await q.evaluate(() => document.getElementById("txPanelBody").innerText);
        check("AVIATION 2 turbulence report at one altitude: JFK moderate-to-severe at 6,000 ft shows below 10,000 ft, not at FL180-FL290; its detail is a pilot observation", low && !mid && /PILOT REPORT · OBSERVATION/.test(det) && /moderate to severe turbulence at 6,000 ft/.test(det) && /M20P/.test(det), { low, mid, det: det.slice(0, 200) });
        await q.screenshot({ path: path.join(OUT, "ARCHIVED-map-aviation-enroute.png") }); await ctx.close(); }
      await v.ctx.close();
    }
    /* live: the same-origin functions answer with upstream times; the Planner says what it found (whatever it is today) */
    { const loc = (ms) => new Date(ms).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16).replace(" ", "T");
      const LA = encodeURIComponent(JSON.stringify([{ i: "KEWR", r: "p", a: [loc(Date.now() + 2 * 3600e3), loc(Date.now() + 3 * 3600e3)] }]));
      const LR = encodeURIComponent(JSON.stringify({ o: "KORD", d: "KEWR", lo: 10000, hi: 16000, w: [loc(Date.now() + 30 * 60e3), loc(Date.now() + 2 * 3600e3)] }));
      v = await planner("air=" + LA + "&rt=" + LR + "&e=" + EW(...ML, { start: loc(Date.now() + 4 * 3600e3), end: loc(Date.now() + 6 * 3600e3) }, "America/New_York"), { wait: 2000 });
      await v.p.waitForFunction(() => { const s = window.EventThreatsLast.statuses; return ["en route", "FAA"].every((k) => s.some((x) => x.name.includes(k) && !/Loading/.test(x.text))); }, null, { timeout: 120000 }).catch(() => {}); await v.p.waitForTimeout(800); r = await v.read();
      const ef = v.feeds.filter((f) => /\/api\/(awc\/(pirep|airsigmet|gairmet|cwa)|faa\/)/.test(f.url)), lr = await v.p.evaluate(() => ({ route: window.EventThreatsLast.route, faa: window.EventThreatsLast.disruptions.map((d) => d.lines.map((l) => l.text)) }));
      check("LIVE aviation 2: pilot reports, SIGMETs, G-AIRMETs (5 hours) and CWAs through the same-origin function with upstream times; the route checked", ["pirep", "airsigmet", "gairmet", "cwa"].every((k) => ef.some((f) => f.url.includes(k) && f.status === 200 && f.upstreamAt)) && ef.filter((f) => /gairmet/.test(f.url)).length === 5 && r.statuses.some((x) => /en route.*: Checked/.test(x)) && lr.route.set && lr.route.lines.length > 0, { ef: ef.map((f) => f.url.split("/api/")[1] + " " + f.status + " " + f.upstreamAt), st: r.statuses.filter((x) => /en route/.test(x)), lr: lr.route });
      /* FAA airport status: the FAA refuses requests from Cloudflare (403 "Access Denied", 2026-11-22), so live status is
         unavailable until official access exists. Either it answers, or every airport says disruptions are unknown and the
         source line says not responding; never "no disruptions" */
      const faaOk = ef.some((f) => /faa\/airport-events/.test(f.url) && f.status === 200 && f.upstreamAt) && r.statuses.some((x) => /FAA airport status.*: Checked/.test(x));
      const faaMarked = lr.faa.length >= 2 && lr.faa.every((ls) => ls.length === 1 && /FAA airport status isn't answering, so disruptions at .* are unknown\./.test(ls[0])) && r.statuses.some((x) => /FAA airport status.*: Not responding/.test(x)) && !lr.faa.flat().some((t) => /^No FAA-reported/.test(t));
      check("LIVE FAA airport status: " + (faaOk ? "answered and confirmed" : "explicitly unavailable: every airport says disruptions are unknown, the source line says not responding, never 'none'"), faaOk || faaMarked, { faa: lr.faa, st: r.statuses.filter((x) => /FAA/.test(x)), calls: ef.filter((f) => /faa/.test(f.url)).map((f) => f.status) });
      fs.writeFileSync(path.join(OUT, "live-planner-aviation-enroute.json"), JSON.stringify({ at: new Date().toISOString(), result: r, feeds: ef, route: lr }, null, 1));
      await shot(v, "LIVE-planner-aviation-enroute"); await v.ctx.close(); }
  }

  /* 5. outage: NWS route blocked in this browser */
  v = await planner("e=" + E(...ATL, FRI), { blockNws: true, wait: 4000 }); r = await v.read();
  check("NWS outage: status says not responding and the summary is not 'no threats'", !r.confirmed && /^Not fully confirmed/.test(r.summary) && r.statuses.some((s) => /^NWS warnings, watches and advisories: Not responding/.test(s)), r);
  await shot(v, "LIVE-planner-nws-outage-simulated"); await v.ctx.close();

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  const failed = results.filter((x) => !x.pass).length; console.log((results.length - failed) + " of " + results.length + " passed");
  await b.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
