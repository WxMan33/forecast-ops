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

  /* 4. LIVE feeds through the functions */
  v = await planner("e=" + E(...DAYTONA, { setup: "2026-11-21T09:00", gates: "2026-11-21T11:00", start: "2026-11-21T12:30", end: "2026-11-21T16:00", teardown: "2026-11-21T18:00" }), { dsf: 2, wait: 4000 }); r = await v.read();
  const viaFn = v.feeds.filter((f) => /\/api\/(nws|wpc)\//.test(f.url)), direct = v.feeds.filter((f) => /api\.weather\.gov\/alerts\/active\?event=|wpc\.ncep|wpc_precip_hazards/.test(f.url)); // the threats feeds only; Event Manager's own point forecast requests are separate
  check("live: NWS and WPC requests go through the same-origin functions with their upstream time", viaFn.length >= 4 && direct.length === 0 && viaFn.every((f) => f.status === 200 && f.upstreamAt), { viaFn, direct });
  check("live: every source states its check time or its gap", r.statuses.length >= 2 && r.statuses.every((s) => /Checked|Not confirmed|Not responding|outside/.test(s)), r.statuses);
  fs.writeFileSync(path.join(OUT, "live-planner.json"), JSON.stringify({ at: new Date().toISOString(), result: r, feeds: v.feeds }, null, 1));
  await shot(v, "LIVE-planner-daytona-saturday"); await v.ctx.close();

  /* 5. outage: NWS route blocked in this browser */
  v = await planner("e=" + E(...ATL, FRI), { blockNws: true, wait: 4000 }); r = await v.read();
  check("NWS outage: status says not responding and the summary is not 'no threats'", !r.confirmed && /^Not fully confirmed/.test(r.summary) && r.statuses.some((s) => /^NWS warnings and watches: Not responding/.test(s)), r);
  await shot(v, "LIVE-planner-nws-outage-simulated"); await v.ctx.close();

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  const failed = results.filter((x) => !x.pass).length; console.log((results.length - failed) + " of " + results.length + " passed");
  await b.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
