/* Weather threats ↔ Event Planner matcher, on ARCHIVED official products from 2026-11-20:
   WPC Excessive Rainfall Outlook Days 1–3 (WPC's own GeoJSON) and NWS Flash Flood Warnings KMLB.FF.W.0036 (Volusia,
   NEW → EXT) and KJAX.FF.W.0054 (Flagler, NEW → CON, the update shrinks the polygon).
   Events use Event Manager's own schedule windows (OpsCore.event.windows). Run: node tests/threats-match.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
global.window = global; require("../assets/ops-core.js");
const C = global.OpsCore, T = require("../assets/threats-core.js"), F = require("../assets/threats-feeds.js"), M = require("../assets/threats-match.js");
const FX = (f) => path.join(__dirname, "fixtures", "threats", f);
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

const ero = [1, 2, 3].map((d) => F.parseERO(JSON.parse(fs.readFileSync(FX("wpc-ero-day" + d + "-20261120.geojson"), "utf8")), d, "wpc"));
const chain = (f) => JSON.parse(fs.readFileSync(FX(f), "utf8")).features;
/* replay NWS messages up to `clock` through the same store the page uses */
function warnings(files, clock) {
  // like a real answer, each replayed check carries every message issued so far (the store keeps the newest per event)
  const s = F.createAlertStore(), msgs = files.flatMap(chain).sort((a, b) => (a.properties.sent < b.properties.sent ? -1 : 1));
  msgs.forEach((f, i) => {
    const at = new Date(Date.parse(f.properties.sent) + 30e3).toISOString();
    if (Date.parse(at) <= clock) s.ingest({ type: "FeatureCollection", features: msgs.slice(0, i + 1) }, at);
  });
  return s.products(clock).filter((p) => p.status === "active");
}
const OK = (at) => ({ kind: "current", lastOk: new Date(at).toISOString() });
const allOk = (clock) => ({ "nws-alerts": OK(clock), "wpc-ero": { ...OK(clock), reachEnd: "2026-11-23T12:00:00Z" }, "spc-md": OK(clock), "spc-outlook": OK(clock) });
const eroAt = (clock) => ero.filter((o) => Date.parse(o.issued) <= clock).flatMap((o) => o.products);
function event(name, lat, lon, times) {
  const ev = { id: "t", name, loc: { name, lat, lon }, tz: "America/New_York", times };
  assert.deepStrictEqual(C.event.validate(ev), []);
  return { name, lat, lon, tz: ev.tz, windows: C.event.windows(ev) };
}
const DAYTONA = [29.1852, -81.0705], FAIRGROUNDS = [29.4447, -81.2896];
const FRI = { setup: "2026-11-20T09:00", gates: "2026-11-20T11:00", start: "2026-11-20T12:30", end: "2026-11-20T16:00", teardown: "2026-11-20T18:00" };
const NOON = Date.parse("2026-11-20T17:35:00Z"); // 12:35 p.m. EST: after the 0036 extension (12:23) and WPC's 15:35Z Day 1
const run = (ev, clock, files = ["nws-archive-kmlb-ff-w-0036.json", "nws-archive-kjax-ff-w-0054.json"], state = allOk(clock)) =>
  M.forEvent({ products: [...warnings(files, clock), ...eroAt(clock)], state, event: ev, now: clock, families: ["flood"] });

ok("Daytona Speedway, Friday: Flash Flood Warning and the WPC Day 1 outlook both apply, as separate items", () => {
  const r = run(event("Daytona", ...DAYTONA, FRI), NOON);
  assert.deepStrictEqual(r.items.map((i) => i.kind), ["warning", "outlook"]);
  const [w, o] = r.items;
  assert.strictEqual(w.headline, "Flash Flood Warning until 2:30 p.m."); assert.strictEqual(w.line, "Covers the venue during setup, gates and the event."); // first issued 10:04 a.m., during setup
  assert.strictEqual(w.product.issued, "2026-11-20T15:04:00.000Z"); assert.strictEqual(w.product.updated, "2026-11-20T17:23:00.000Z");
  assert.strictEqual(o.headline, "Excessive rainfall risk Friday · High (at least 70%)");
  assert.match(o.line, /^The WPC Day 1 outlook includes the venue and its period \(Fri 11 a\.m\. – Sat 7 a\.m\.\) overlaps gates, the event and teardown\. It is a risk for the whole period, not timing within it\.$/);
  assert.deepStrictEqual(o.phases, ["gates", "event", "teardown"]); // setup ends at 11 a.m., when the Day 1 period starts
  assert.strictEqual(r.confirmed, true);
});
ok("one item per outlook period at the highest category, even with several WPC areas around the venue", () => {
  const r = run(event("Daytona", ...DAYTONA, FRI), NOON);
  assert.strictEqual(r.items.filter((i) => i.kind === "outlook").length, 1);
  assert.strictEqual(r.items.find((i) => i.kind === "outlook").product.category, "HIGH");
});
ok("moving the venue outside both footprints removes both items; the summary says so only because sources are confirmed", () => {
  const r = run(event("Atlanta", 33.7554, -84.4008, FRI), NOON);
  assert.strictEqual(r.items.length, 0); assert.strictEqual(r.confirmed, true); assert.match(r.summary, /^No flooding threats apply/);
});
ok("moving the event outside the products' valid windows removes them", () => {
  const later = { setup: "2026-11-23T14:00", gates: "2026-11-23T16:00", start: "2026-11-23T17:00", end: "2026-11-23T20:00", teardown: "2026-11-23T21:00" };
  const r = run(event("Daytona", ...DAYTONA, later), NOON);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.confirmed, false); assert.match(r.statuses.find((s) => s.id === "wpc-ero").text, /runs past the outlooks issued so far/);
  assert.match(r.summary, /^Not fully confirmed/);
});
ok("an overnight event spanning two outlook periods gets the Day 1 and Day 2 items with their own categories", () => {
  const night = { setup: "2026-11-20T21:00", gates: "2026-11-20T22:00", start: "2026-11-20T23:00", end: "2026-11-21T08:00", teardown: "2026-11-21T09:00" };
  const r = run(event("Daytona night", ...DAYTONA, night), Date.parse("2026-11-20T20:30:00Z"));
  const out = r.items.filter((i) => i.kind === "outlook").map((i) => [i.product.day, i.product.category, i.phases.join("+")]);
  assert.deepStrictEqual(out, [[1, "HIGH", "setup+gates+event"], [2, "MRGL", "event+teardown"]]);
  assert.strictEqual(r.items.filter((i) => i.kind === "warning").length, 0); // both warnings had expired by then
});
ok("a real warning update that moves coverage off the venue changes the result (Flagler County Fairgrounds, KJAX 0054)", () => {
  const ev = event("Fairgrounds", ...FAIRGROUNDS, { gates: "2026-11-20T12:00", start: "2026-11-20T13:00", end: "2026-11-20T17:00" });
  const before = run(ev, Date.parse("2026-11-20T17:35:00Z"), ["nws-archive-kjax-ff-w-0054.json"]);
  const after = run(ev, Date.parse("2026-11-20T19:15:00Z"), ["nws-archive-kjax-ff-w-0054.json"]);
  assert.strictEqual(before.items.filter((i) => i.kind === "warning").length, 1);
  assert.strictEqual(after.items.filter((i) => i.kind === "warning").length, 0);
  assert.strictEqual(after.items.filter((i) => i.kind === "outlook")[0].product.category, "MDT"); // the outlook still applies
});
ok("changing the schedule to end before the warning starts drops the warning but keeps the outlook overlap logic", () => {
  const early = { setup: "2026-11-20T06:00", start: "2026-11-20T07:00", end: "2026-11-20T09:30" };
  const r = run(event("Daytona early", ...DAYTONA, early), Date.parse("2026-11-20T14:00:00Z"));
  assert.strictEqual(r.items.length, 0); // 0036 was issued at 10:04 a.m.; Day 1 starts at 11 a.m.
});
ok("a source outage never reads as 'no threats'", () => {
  const st = allOk(NOON); st["nws-alerts"] = { kind: "stale", lastOk: "2026-11-20T17:00:00Z" };
  const r = run(event("Atlanta", 33.7554, -84.4008, FRI), NOON, undefined, st);
  assert.strictEqual(r.items.length, 0); assert.strictEqual(r.confirmed, false); assert.match(r.summary, /^Not fully confirmed/);
  assert.match(r.statuses.find((s) => s.id === "nws-alerts").text, /^Not confirmed since 12 p\.m\./);
  st["nws-alerts"] = { kind: "unavailable" };
  assert.match(run(event("Atlanta", 33.7554, -84.4008, FRI), NOON, undefined, st).statuses.find((s) => s.id === "nws-alerts").text, /can't rule anything out/);
});
ok("an empty answer from the NOAA map service mirror is not 'no excessive rainfall'", () => {
  const s = F.createEROStore(1);
  s.ingest(JSON.parse(fs.readFileSync(FX("noaa-mapservice-ero-day1-empty-20261120.json"), "utf8")), "2026-11-20T20:30:00Z", "mapservice");
  assert.strictEqual(s.sourceInfo().state, "failed"); assert.match(s.sourceInfo().error, /mirror/);
  s.ingest(JSON.parse(fs.readFileSync(FX("wpc-ero-day1-20261120.geojson"), "utf8")), "2026-11-20T20:31:00Z", "wpc");
  assert.strictEqual(s.sourceInfo().state, "ok"); assert.strictEqual(s.current(Date.parse("2026-11-20T21:00:00Z")).products.length, 4);
  assert.strictEqual(s.current(Date.parse("2026-11-21T12:00:00Z")).status, "expired");
});
ok("a venue outside a provider's area is 'not covered', not 'nothing'", () => {
  const r = run(event("London", 51.5074, -0.1278, FRI), NOON);
  assert.strictEqual(r.confirmed, false); assert.ok(r.statuses.every((s) => !s.covered)); assert.match(r.statuses[0].text, /outside this source's area/);
});
ok("ERO parser: real WPC fields, UTC times, categories; unknown categories are refused", () => {
  const o = ero[0];
  assert.deepStrictEqual([o.issued, o.validStart, o.validEnd], ["2026-11-20T15:35:00.000Z", "2026-11-20T16:00:00.000Z", "2026-11-21T12:00:00.000Z"]);
  assert.throws(() => F.parseERO({ features: [{ properties: { OUTLOOK: "Extreme" }, geometry: {} }] }, 1, "wpc"), /category/);
});
ok("Flash Flood Warnings: real messages normalize as flood-family warnings with their own hazard text", () => {
  const p = F.normalizeAlert(chain("nws-archive-kmlb-ff-w-0036.json")[0]);
  assert.deepStrictEqual([p.kind, p.family, p.title, p.id], ["warning", "flood", "Flash Flood Warning", "KMLB.FF.W.0036.2026"]);
  assert.match(p.hazard, /Flash flooding radar indicated/);
});
console.log(n + " passed");
