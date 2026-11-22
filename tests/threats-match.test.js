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
ok("a warning that expires during an outage drops out of the items, gets a note, and the source stays unknown", () => {
  const ev = event("Daytona", ...DAYTONA, FRI), clock = Date.parse("2026-11-20T19:40:00Z");
  const s = F.createAlertStore(), msgs = ["nws-archive-kmlb-ff-w-0036.json", "nws-archive-kjax-ff-w-0054.json"].flatMap(chain).filter((f) => Date.parse(f.properties.sent) < Date.parse("2026-11-20T18:00:00Z"));
  s.ingest({ type: "FeatureCollection", features: msgs }, "2026-11-20T18:00:00Z"); s.fail("2026-11-20T19:40:00Z", "outage");
  const products = [...s.products(clock).filter((p) => p.status === "active" || p.status === "lapsed"), ...eroAt(clock)];
  assert.ok(products.some((p) => p.id === "KMLB.FF.W.0036.2026" && p.status === "lapsed"));
  const st = allOk(clock); st["nws-alerts"] = { kind: "stale", lastOk: "2026-11-20T18:00:00Z" };
  const r = M.forEvent({ products, state: st, event: ev, now: clock, families: ["flood"] });
  assert.ok(!r.items.some((i) => i.kind === "warning"), "no active warning item");
  assert.strictEqual(r.notes.length, 1); assert.match(r.notes[0].text, /^Flash Flood Warning reached its published expiration \(2:30 p\.m\.\) while the source could not be reached/);
  assert.match(r.statuses.find((x) => x.id === "nws-alerts").text, /^Not confirmed since 1 p\.m\./); assert.strictEqual(r.confirmed, false);
});
console.log(n + " passed");

/* ---------------- WINTER: NWS winter alerts (ARCHIVED official, NWS Salt Lake City, Nov 18–20) and WPC WSSI-P
   (official, captured from the NOAA map service 2026-11-20 21:23Z) ---------------- */
{
  const zones = JSON.parse(fs.readFileSync(FX("nws-zones-utah-20261120.json"), "utf8")).zones;
  const wssi = (f) => F.parseWSSIP(JSON.parse(fs.readFileSync(FX(f), "utf8")));
  const CASCADES = wssi("wpc-wssi-p-overall-cascades-20261120.json"), WASATCH = wssi("wpc-wssi-p-overall-wasatch-20261120.json");
  /* replay the Utah chains like the page does: cumulative answers, then zone shapes for county/zone-based products */
  function winter(clock) {
    const s = F.createAlertStore(), msgs = ["nws-archive-kslc-ww-y-0018.json", "nws-archive-kslc-ws-w-0003.json"].flatMap(chain).sort((a, b) => (a.properties.sent < b.properties.sent ? -1 : 1));
    msgs.forEach((f, i) => { const at = Date.parse(f.properties.sent) + 30e3; if (at <= clock) s.ingest({ type: "FeatureCollection", features: msgs.slice(0, i + 1) }, new Date(at).toISOString()); });
    return s.products(clock).filter((p) => p.status === "active").map((p) => { const z = F.zoneShape(p.zones, p.zones.map((u) => (zones[u] ? zones[u].geometry : null))); return { ...p, geometry: z.geometry, geometryIncomplete: z.incomplete, zoneInfo: z }; });
  }
  const evW = (name, lat, lon, times, tz) => { const ev = { id: "w", name, loc: { name, lat, lon }, tz, times }; assert.deepStrictEqual(C.event.validate(ev), []); return { name, lat, lon, tz, windows: C.event.windows(ev) }; };
  const SNOWBIRD = [40.5813, -111.6556], PARKCITY = [40.6514, -111.508], CRYSTAL = [46.935, -121.475];
  const FRI_UT = { setup: "2026-11-20T14:00", gates: "2026-11-20T16:00", start: "2026-11-20T17:00", end: "2026-11-20T21:00", teardown: "2026-11-20T23:00" };
  const wstate = (clock) => ({ "nws-alerts": OK(clock), "wpc-wssi-p": { ...OK(clock), reachEnd: "2026-11-27T00:00:00.000Z" } });
  const runW = (ev, clock, outlook = []) => M.forEvent({ products: [...winter(clock), ...outlook], state: wstate(clock), event: ev, now: clock, families: ["winter"] });

  ok("WINTER several days out: WSSI-P at Crystal Mountain for Tuesday, wording from the probability, window and phases shown", () => {
    const tue = { setup: "2026-11-24T07:00", gates: "2026-11-24T09:00", start: "2026-11-24T10:00", end: "2026-11-24T15:00", teardown: "2026-11-24T17:00" };
    const r = M.forEvent({ products: CASCADES, state: wstate(Date.parse("2026-11-20T21:30:00Z")), event: evW("Crystal Mountain", ...CRYSTAL, tue, "America/Los_Angeles"), now: Date.parse("2026-11-20T21:30:00Z"), families: ["winter"] });
    assert.strictEqual(r.items.length, 1); const it = r.items[0];
    assert.match(it.headline, /^Minor winter impacts (likely|possible) Tuesday · \d+% chance of at least Minor impacts$/);
    const pct = +/(\d+)% chance/.exec(it.headline)[1]; assert.strictEqual(/likely/.test(it.headline), pct >= 60);
    assert.match(it.line, /^WPC's winter storm severity outlook \(WSSI-P\) for the 24 hours .+ includes the venue and overlaps setup, gates, the event and teardown\. Expect a few inconveniences/);
    assert.ok(it.levels.find(([L]) => L === "WWA")[1] >= pct, "cumulative levels");
  });
  ok("WINTER replay 1 (Nov 18, 4:00 p.m. MST): Winter Weather Advisory at Snowbird, drawn from its forecast zone", () => {
    const r = runW(evW("Snowbird", ...SNOWBIRD, FRI_UT, "America/Denver"), Date.parse("2026-11-18T23:00:00Z"));
    assert.deepStrictEqual(r.items.map((i) => [i.kind, i.headline]), [["advisory", "Winter Weather Advisory during setup, gates, the event and teardown"]]);
    assert.match(r.items[0].line, /^In effect at the venue until 11 a\.m\. Saturday \(issued for the forecast zone that includes the venue\)\.$/);
  });
  ok("WINTER replay 2 (Nov 19, 10:00 a.m. MST): the advisory was upgraded; a Winter Storm Warning applies at Snowbird", () => {
    const r = runW(evW("Snowbird", ...SNOWBIRD, FRI_UT, "America/Denver"), Date.parse("2026-11-19T17:00:00Z"));
    assert.deepStrictEqual(r.items.map((i) => [i.kind, i.headline]), [["warning", "Winter Storm Warning during setup, gates, the event and teardown"]]);
  });
  ok("WINTER: changing the venue to Park City (Wasatch Back zone) gives the advisory, not the warning", () => {
    const r = runW(evW("Park City Mountain", ...PARKCITY, FRI_UT, "America/Denver"), Date.parse("2026-11-19T17:00:00Z"));
    assert.deepStrictEqual(r.items.map((i) => i.kind), ["advisory"]); assert.match(r.items[0].line, /until 5 a\.m\. Saturday/);
  });
  ok("WINTER: moving the event after the warning ends removes it; a two-day event lists only the phases it overlaps", () => {
    const sat = { setup: "2026-11-21T12:00", start: "2026-11-21T13:00", end: "2026-11-21T17:00" };
    assert.strictEqual(runW(evW("Snowbird", ...SNOWBIRD, sat, "America/Denver"), Date.parse("2026-11-19T17:00:00Z")).items.length, 0);
    const span2 = { setup: "2026-11-21T08:00", gates: "2026-11-21T10:00", start: "2026-11-21T12:00", end: "2026-11-21T16:00" };
    const r = runW(evW("Snowbird", ...SNOWBIRD, span2, "America/Denver"), Date.parse("2026-11-19T17:00:00Z"));
    assert.strictEqual(r.items[0].headline, "Winter Storm Warning during setup and gates"); // ends 11 a.m. Saturday
  });
  ok("WINTER now (Nov 20, 2:30 p.m. MST): Winter Storm Warning and the WSSI-P outlook for the same Snowbird event", () => {
    const clock = Date.parse("2026-11-20T21:30:00Z"), r = runW(evW("Snowbird", ...SNOWBIRD, FRI_UT, "America/Denver"), clock, WASATCH);
    assert.deepStrictEqual(r.items.map((i) => i.kind), ["warning", "outlook"]);
    assert.match(r.items[1].headline, /(likely|possible) Friday · \d+% chance of at least/);
  });
  ok("WINTER coverage: an event past the last WSSI-P window says where the outlook ends", () => {
    const later = { start: "2026-11-28T10:00", end: "2026-11-28T15:00" };
    const r = M.forEvent({ products: CASCADES, state: wstate(Date.parse("2026-11-20T21:30:00Z")), event: evW("Crystal Mountain", ...CRYSTAL, later, "America/Los_Angeles"), now: Date.parse("2026-11-20T21:30:00Z"), families: ["winter"] });
    assert.strictEqual(r.items.length, 0); assert.strictEqual(r.confirmed, false);
    assert.match(r.statuses.find((s) => s.id === "wpc-wssi-p").text, /runs past the outlooks issued so far \(they end Thu 4 p\.m\.\)/);
  });
  ok("WINTER: flooding items are untouched by the winter family and vice versa", () => {
    const r = run(event("Daytona", ...DAYTONA, FRI), NOON);
    assert.deepStrictEqual(r.items.map((i) => i.family), ["flood", "flood"]);
  });
}
console.log(n + " passed (with winter)");

/* ---------------- FIRE: SPC Fire Weather Outlooks (ARCHIVED, SPC's archive: Jul 29 Day 3-8, Jul 31 Day 2, Aug 1 Day 1),
   NWS Red Flag Warning / Fire Weather Watch (ARCHIVED, NWS Denver/Boulder, Nov 17-18) and NIFC WFIGS incidents
   (official snapshot captured 2026-11-21) ---------------- */
{
  const fj = (f) => JSON.parse(fs.readFileSync(FX(f), "utf8"));
  const fire = (f, day, part) => F.parseFireOutlook(fj(f), day, part).products;
  const D38_0729 = fire("spc-fire-day38-20260729.geojson", 3, "windrh"), D2_0731 = fire("spc-fire-day2-20260731-2000-windrh.geojson", 2, "windrh"), D1_0801 = fire("spc-fire-day1-20260801-1700-windrh.geojson", 1, "windrh");
  const NIFC = F.parseNIFC(fj("nifc-wfigs-20261121-incidents.geojson"), fj("nifc-wfigs-20261121-perimeters.geojson"));
  const zonesCO = fj("nws-zones-colorado-fire-20261121.json").zones;
  const evF = (name, lat, lon, times, tz) => { const ev = { id: "f", name, loc: { name, lat, lon }, tz, times }; assert.deepStrictEqual(C.event.validate(ev), []); return { name, lat, lon, tz, windows: C.event.windows(ev) }; };
  const fstate = (clock, extra = {}) => ({ "nws-alerts": OK(clock), "spc-fire": { ...OK(clock), reachEnd: "2026-08-08T12:00:00Z" }, "nifc-wfigs": OK(clock), ...extra });
  const MOSES = [47.1166, -119.2783] /* Grant County Fairgrounds, Moses Lake */, SPOKANE = [47.665, -117.4235], MISSOULA = [46.8721, -113.994];
  const SAT_AUG1 = { setup: "2026-08-01T08:00", gates: "2026-08-01T11:00", start: "2026-08-01T12:00", end: "2026-08-01T20:00", teardown: "2026-08-01T22:00" };
  const runF = (ev, clock, products, state = fstate(clock)) => M.forEvent({ products, state, event: ev, now: clock, families: ["fire"] });

  ok("FIRE days ahead (Jul 29): SPC Day 3-8 marks a Critical fire weather area for Saturday Aug 1 at Moses Lake", () => {
    const r = runF(evF("Grant County Fairgrounds", ...MOSES, SAT_AUG1, "America/Los_Angeles"), Date.parse("2026-07-29T22:30:00Z"), D38_0729);
    assert.deepStrictEqual(r.items.map((i) => i.headline), ["Critical fire weather area Saturday (Day 4 outlook)"]);
    assert.match(r.items[0].line, /^The SPC Day 4 fire weather outlook includes the venue and its period \(Sat 5 a\.m\. – Sun 5 a\.m\.\) overlaps setup, gates, the event and teardown\. .*not whether a fire starts\.$/);
  });
  ok("FIRE two days out (Jul 31): Day 2 Extremely Critical at Moses Lake; moving the venue to Spokane gives Critical, Missoula Elevated", () => {
    const at = Date.parse("2026-07-31T21:00:00Z"), h = (v) => runF(evF("v", ...v, SAT_AUG1, "America/Los_Angeles"), at, D2_0731).items.map((i) => i.headline);
    assert.deepStrictEqual(h(MOSES), ["Extremely Critical fire weather risk Saturday"]);
    assert.deepStrictEqual(h(SPOKANE), ["Critical fire weather risk Saturday"]);
    assert.deepStrictEqual(runF(evF("v", ...MISSOULA, SAT_AUG1, "America/Denver"), at, D2_0731).items.map((i) => i.headline), ["Elevated fire weather risk Saturday"]);
  });
  ok("FIRE day of (Aug 1, 11 a.m. MDT): the Day 1 update raises Missoula from Elevated to Critical", () => {
    const r = runF(evF("v", ...MISSOULA, SAT_AUG1, "America/Denver"), Date.parse("2026-08-01T17:30:00Z"), D1_0801);
    assert.deepStrictEqual(r.items.map((i) => [i.headline, i.phases.join("+")]), [["Critical fire weather risk Saturday", "gates+event+teardown"]]);
  });
  ok("FIRE: an event after the outlook period is not matched; the Day 3-8 range is stated when the event runs past it", () => {
    const sun = { start: "2026-08-02T14:00", end: "2026-08-02T18:00" };
    assert.strictEqual(runF(evF("v", ...MOSES, sun, "America/Los_Angeles"), Date.parse("2026-07-31T21:00:00Z"), D2_0731).items.length, 0);
    const late = { start: "2026-08-09T10:00", end: "2026-08-09T14:00" }, r = runF(evF("v", ...MOSES, late, "America/Los_Angeles"), Date.parse("2026-07-31T21:00:00Z"), D2_0731);
    assert.strictEqual(r.confirmed, false); assert.match(r.statuses.find((s) => s.id === "spc-fire").text, /runs past the outlooks issued so far/);
  });

  ok("FIRE day label follows the event's own local date inside the outlook window (Cheyenne, Day 1 valid Wed 10 a.m. - Thu 5 a.m. MST)", () => {
    const d1 = fire("spc-fire-day1-20261118-1700-windrh.geojson", 1, "windrh"), clock = Date.parse("2026-11-19T01:00:00Z"), CHY = [41.1505, -104.8301]; // Wed 6 p.m. MST
    const h = (t) => runF(evF("Cheyenne Frontier Days Arena", ...CHY, t, "America/Denver"), clock, d1).items.map((i) => i.headline);
    assert.deepStrictEqual(h({ start: "2026-11-18T20:00", end: "2026-11-18T23:00" }), ["Elevated fire weather risk Wednesday"]);
    assert.deepStrictEqual(h({ start: "2026-11-19T00:30", end: "2026-11-19T03:00" }), ["Elevated fire weather risk Thursday"]); // after local midnight, still inside the window
    assert.deepStrictEqual(h({ start: "2026-11-19T06:00", end: "2026-11-19T09:00" }), []); // after the window ends (5 a.m. MST)
  });
  /* NWS Denver/Boulder: Fire Weather Watch 0044 (Nov 17 12:46 MST) upgraded to Red Flag Warning 0057 for COZ238/239 (23:11) */
  function rfw(clock) {
    const s = F.createAlertStore(), msgs = ["nws-archive-kbou-fw-a-0044.json", "nws-archive-kbou-fw-w-0057.json"].flatMap(chain).sort((a, b) => (a.properties.sent < b.properties.sent ? -1 : 1));
    msgs.forEach((f, i) => { const at = Date.parse(f.properties.sent) + 30e3; if (at <= clock) s.ingest({ type: "FeatureCollection", features: msgs.slice(0, i + 1) }, new Date(at).toISOString()); });
    return s.products(clock).filter((p) => p.status === "active").map((p) => { const z = F.zoneShape(p.zones, p.zones.map((u) => (zonesCO[u] ? zonesCO[u].geometry : null))); return { ...p, geometry: z.geometry, geometryIncomplete: z.incomplete, zoneInfo: z }; });
  }
  const FTC = [40.5718, -105.0897], DEN = [39.7439, -105.0201];
  const WED = { setup: "2026-11-18T07:00", gates: "2026-11-18T10:00", start: "2026-11-18T11:00", end: "2026-11-18T15:00", teardown: "2026-11-18T18:00" };
  ok("FIRE replay Nov 17 1 p.m. MST: Fire Weather Watch at Fort Collins from its fire weather zone, with its start time", () => {
    const clock = Date.parse("2026-11-17T20:00:00Z"), r = runF(evF("Canvas Stadium", ...FTC, WED, "America/Denver"), clock, rfw(clock));
    assert.deepStrictEqual(r.items.map((i) => [i.kind, i.headline]), [["watch", "Fire Weather Watch during setup, gates, the event and teardown"]]);
    assert.match(r.items[0].line, /^In effect at the venue from 8 a\.m\. Wednesday until 4 p\.m\. Wednesday \(issued for the fire weather zone that includes the venue\)\.$/);
  });
  ok("FIRE replay Nov 18 midnight: upgraded to a Red Flag Warning at Fort Collins; Denver's watch was cancelled, so nothing there", () => {
    const clock = Date.parse("2026-11-18T07:00:00Z");
    assert.deepStrictEqual(runF(evF("Canvas Stadium", ...FTC, WED, "America/Denver"), clock, rfw(clock)).items.map((i) => [i.kind, i.headline]), [["warning", "Red Flag Warning during setup, gates, the event and teardown"]]);
    assert.strictEqual(runF(evF("Empower Field", ...DEN, WED, "America/Denver"), clock, rfw(clock)).items.length, 0);
  });
  ok("FIRE replay Nov 18 4:30 p.m. MST: the Red Flag Warning has expired and is gone", () => {
    const clock = Date.parse("2026-11-18T23:30:00Z");
    assert.strictEqual(runF(evF("Canvas Stadium", ...FTC, { start: "2026-11-18T16:30", end: "2026-11-18T19:00" }, "America/Denver"), clock, rfw(clock)).items.length, 0);
  });

  /* NIFC WFIGS snapshot (2026-11-21) */
  const PUEBLO = [38.2655, -104.7246] /* Lake Pueblo State Park */, FAIRGROUNDS_CO = [38.2611, -104.6189], NOW_NIFC = Date.parse("2026-11-21T01:30:00Z");
  const SAT_CO = { setup: "2026-11-21T08:00", start: "2026-11-21T10:00", end: "2026-11-21T16:00" };
  ok("FIRE incidents: Lake Pueblo State Park lists the Aspen Acres perimeter (12.5 mi) with distance, size, containment and NIFC's update time; the State Fairgrounds (17.5 mi) does not", () => {
    assert.ok(!runF(evF("Colorado State Fairgrounds", ...FAIRGROUNDS_CO, SAT_CO, "America/Denver"), NOW_NIFC, NIFC).items.some((i) => /Aspen Acres/.test(i.headline)));
    const r = runF(evF("Lake Pueblo State Park", ...PUEBLO, SAT_CO, "America/Denver"), NOW_NIFC, NIFC);
    const it = r.items.find((i) => i.kind === "incident" && /Aspen Acres/.test(i.headline));
    assert.ok(it, JSON.stringify(r.items.map((i) => i.headline)));
    assert.match(it.headline, /^Wildfire 1[23] miles southwest: Aspen Acres · 102,007 acres · 96% contained$/);
    assert.match(it.line, /^Active incident reported to NIFC \(updated Nov 19, 3:29 PM\)\. Incidents have no end time/);
    assert.ok(r.items.every((i) => i.product.category !== "RX"), "prescribed fires are not listed");
  });
  ok("FIRE incidents: a venue far from any incident gets none; an event already over gets none", () => {
    assert.strictEqual(runF(evF("v", 39.0997, -94.5786, SAT_CO, "America/Chicago"), NOW_NIFC, NIFC).items.filter((i) => i.kind === "incident").length, 0);
    assert.strictEqual(runF(evF("v", ...PUEBLO, { start: "2026-11-19T10:00", end: "2026-11-19T16:00" }, "America/Denver"), NOW_NIFC, NIFC).items.length, 0);
  });
  ok("FIRE incidents: a perimeter that includes the venue is said so; a point-only fire says it has no mapped perimeter", () => {
    const withPer = NIFC.find((p) => p.geometry && p.category === "WF"), c = T.bbox(withPer.geometry);
    const inside = (() => { for (let i = 0; i < 400; i++) { const pt = [c[0] + ((i % 20) + 0.5) * (c[2] - c[0]) / 20, c[1] + (Math.floor(i / 20) + 0.5) * (c[3] - c[1]) / 20]; if (T.contains(withPer.geometry, pt)) return pt; } })();
    const r = runF(evF("v", inside[1], inside[0], SAT_CO, "America/Denver"), NOW_NIFC, [withPer]);
    assert.match(r.items[0].headline, new RegExp("^Wildfire perimeter includes the venue: "));
    const pointOnly = NIFC.find((p) => !p.geometry && p.category === "WF" && p.acres > 1);
    const r2 = runF(evF("v", pointOnly.point[1] + 0.05, pointOnly.point[0], SAT_CO, "America/Denver"), NOW_NIFC, [pointOnly]);
    assert.match(r2.items[0].headline, /^Wildfire (3|4) miles south \(reported location; no mapped perimeter\): /);
  });
  ok("FIRE: an NIFC outage keeps the summary unconfirmed; fire items don't leak into other families", () => {
    const r = runF(evF("v", 39.0997, -94.5786, SAT_CO, "America/Chicago"), NOW_NIFC, NIFC, fstate(NOW_NIFC, { "nifc-wfigs": { kind: "unavailable" } }));
    assert.strictEqual(r.confirmed, false); assert.match(r.statuses.find((s) => s.id === "nifc-wfigs").text, /^Not responding/);
    assert.strictEqual(M.forEvent({ products: NIFC, state: allOk(NOW_NIFC), event: evF("v", ...PUEBLO, SAT_CO, "America/Denver"), now: NOW_NIFC, families: ["flood"] }).items.length, 0);
  });
}
console.log(n + " passed (with winter and fire)");

/* ---------------- SMOKE AND AIR QUALITY (ARCHIVED official): NOAA HMS smoke (Jul 14 and 16, 2026), AirNow hourly monitor
   AQI (HourlyAQObs) and reporting-area forecasts (reportingarea.dat, Jul 14-16) ---------------- */
{
  const txt = (f) => fs.readFileSync(FX(f), "utf8");
  const hms = (f, clock) => F.parseHMS(txt(f)).filter((p) => Date.parse(p.obsEnd) <= clock);
  const mons = (f) => F.parseAirNowMonitors(JSON.parse(txt(f)));
  const fcst = (f, clock) => F.aqForecastProducts(F.parseReportingArea(txt(f)).filter((r) => r.issueDate <= new Date(clock).toISOString().slice(0, 10)));
  const evS = (name, lat, lon, times, tz) => { const ev = { id: "s", name, loc: { name, lat, lon }, tz, times }; assert.deepStrictEqual(C.event.validate(ev), []); return { name, lat, lon, tz, windows: C.event.windows(ev) }; };
  const sstate = (clock, extra = {}) => ({ "noaa-hms": OK(clock), "airnow-obs": OK(clock), "airnow-fcst": OK(clock), "noaa-naqfc-smoke": OK(clock), ...extra });
  const runS = (ev, clock, products, state = sstate(clock)) => M.forEvent({ products, state, event: ev, now: clock, families: ["smoke"] });
  const SOLDIER = [41.8623, -87.6167], METLIFE = [40.8135, -74.0745], LINC = [39.9008, -75.1675];
  const CHI = Date.parse("2026-07-16T22:30:00Z"), CHI_EV = { gates: "2026-07-16T18:00", start: "2026-07-16T19:00", end: "2026-07-16T22:00" };
  const chiProducts = () => [...hms("hms-smoke-20260716-east.kml", CHI), ...mons("airnow-monitors-2026071622-chicago.geojson"), ...fcst("airnow-ra-20260716.dat", CHI)];

  ok("SMOKE Chicago, Jul 16 5:30 p.m. CDT (no wildfire within 15 miles): smoke overhead, Hazardous air at a nearby monitor and a Hazardous forecast, as separate items", () => {
    const r = runS(evS("Soldier Field", ...SOLDIER, CHI_EV, "America/Chicago"), CHI, chiProducts());
    assert.deepStrictEqual(r.items.map((i) => i.kind), ["aqobs", "smoke", "aqfcst"], JSON.stringify(r.items.map((i) => i.headline)));
    assert.match(r.items[1].headline, /^Smoke detected over the area · (Light|Medium|Heavy) \(satellite, \d+(:\d\d)? (a|p)\.m\.–\d+(:\d\d)? (a|p)\.m\.\)$/);
    assert.match(r.items[1].line, /does not say what the air is like at the ground/);
    assert.match(r.items[0].headline, /^Air quality now: Hazardous \(AQI \d+, PM2\.5\) at .+, \d+ miles? \w+$/);
    assert.match(r.items[0].line, /^AirNow monitor reading for 5 p\.m\. \(Chicago reporting area, Illinois EPA\)\. Preliminary data; current conditions, not a forecast\./);
    assert.strictEqual(r.items[2].headline, "Air quality forecast Thursday: Hazardous (PM2.5)");
    assert.ok(!r.items.some((i) => /wildfire/i.test(i.headline + i.line)), "no wildfire attribution");
    assert.match(r.statuses.find((s) => s.id === "airnow-obs").text, /nearest monitor .+ AQI \d+ /);
  });
  ok("SMOKE MetLife, Jul 14 5:30 p.m. EDT: a mapped plume overhead while the nearest surface reading is reported separately (no 'unhealthy' surface item)", () => {
    const clock = Date.parse("2026-07-14T21:30:00Z"), ev = evS("MetLife Stadium", ...METLIFE, { gates: "2026-07-14T18:00", start: "2026-07-14T19:00", end: "2026-07-14T22:00" }, "America/New_York");
    const r = runS(ev, clock, [...hms("hms-smoke-20260714-east.kml", clock), ...mons("airnow-monitors-2026071421-nyc.geojson")], sstate(clock, { "airnow-fcst": { kind: "na" } }));
    const smoke = r.items.find((i) => i.kind === "smoke");
    assert.ok(smoke && /^Smoke detected over the area · Heavy/.test(smoke.headline), JSON.stringify(r.items.map((i) => i.headline)));
    assert.ok(!r.items.some((i) => i.kind === "aqobs"), "surface was below Unhealthy for Sensitive Groups");
    assert.match(r.statuses.find((s) => s.id === "airnow-obs").text, /^Checked .* · nearest monitor .+: AQI \d+ (Good|Moderate) \((PM2\.5|Ozone|PM10)\) for 5 p\.m\.$/);
  });
  ok("SMOKE days ahead, Philadelphia: the Jul 14 forecast for Thursday is Moderate (no item); the Jul 15 forecast raises it to Unhealthy 180", () => {
    const ev = evS("Lincoln Financial Field", ...LINC, { start: "2026-07-16T13:00", end: "2026-07-16T17:00" }, "America/New_York");
    const c14 = Date.parse("2026-07-14T22:00:00Z"), c15 = Date.parse("2026-07-15T22:00:00Z");
    assert.deepStrictEqual(runS(ev, c14, fcst("airnow-ra-20260714.dat", c14), sstate(c14, { "noaa-hms": { kind: "na" }, "airnow-obs": { kind: "na" } })).items.map((i) => i.headline), []);
    const r = runS(ev, c15, fcst("airnow-ra-20260715.dat", c15), sstate(c15, { "noaa-hms": { kind: "na" }, "airnow-obs": { kind: "na" } }));
    assert.deepStrictEqual(r.items.map((i) => i.headline), ["Air quality forecast Thursday: Unhealthy (AQI 180, PM2.5)"]);
    assert.match(r.items[0].line, /^Philadelphia reporting area forecast by .+, issued Jul 15\. A forecast for the whole day \(the event falls on it\), not timing within it\./);
  });
  ok("SMOKE: moving the Chicago event to Saturday keeps current conditions (with their time) but drops the Thursday forecast; moving the venue to Philadelphia changes the area", () => {
    const sat = runS(evS("Soldier Field", ...SOLDIER, { start: "2026-07-18T19:00", end: "2026-07-18T22:00" }, "America/Chicago"), CHI, chiProducts());
    assert.deepStrictEqual(sat.items.map((i) => i.kind), ["aqobs", "smoke"]); assert.match(sat.items[0].line, /Your event starts Saturday 7 p\.m\./);
    const phl = runS(evS("Lincoln Financial Field", ...LINC, CHI_EV, "America/New_York"), CHI, [...chiProducts(), ...fcst("airnow-ra-20260716.dat", CHI)]);
    assert.ok(!phl.items.some((i) => i.kind === "aqobs"), "Chicago monitors are far from Philadelphia");
    assert.match(phl.statuses.find((s) => s.id === "airnow-obs").text, /^No AirNow monitor reading within 15 miles/);
    assert.ok(phl.items.some((i) => i.kind === "aqfcst" && /Philadelphia/.test(i.line)));
  });
  ok("SMOKE: a past event gets no current-condition items; a source outage keeps 'not fully confirmed'; smoke never enters other families", () => {
    assert.strictEqual(runS(evS("Soldier Field", ...SOLDIER, { start: "2026-07-15T19:00", end: "2026-07-15T22:00" }, "America/Chicago"), CHI, chiProducts()).items.length, 0);
    const r = runS(evS("v", 39.0997, -94.5786, { start: "2026-07-17T19:00", end: "2026-07-17T22:00" }, "America/Chicago"), CHI, [], sstate(CHI, { "noaa-hms": { kind: "unavailable" } }));
    assert.strictEqual(r.confirmed, false); assert.match(r.statuses.find((s) => s.id === "noaa-hms").text, /^Not responding/);
    assert.strictEqual(M.forEvent({ products: chiProducts(), state: allOk(CHI), event: evS("Soldier Field", ...SOLDIER, CHI_EV, "America/Chicago"), now: CHI, families: ["fire", "flood"] }).items.length, 0);
  });
  ok("SMOKE NAQFC is switched off until NOAA documents the field and unit: no Planner item and no source line, even with smoke in the guidance", () => {
    const clock = Date.parse("2026-11-21T03:00:00Z"), hours = []; for (let h = 4; h <= 50; h++) hours.push({ t: new Date(clock + (h - 3) * 3600e3).toISOString(), v: h >= 15 && h <= 17 ? 40 : 0, run: "2026-11-20T06:00:00.000Z", fh: h });
    const nq = { id: "nq", kind: "smokefcst", program: "naqfc", family: "smoke", sourceId: "noaa-naqfc-smoke", run: "2026-11-20T06:00:00.000Z", hours, validStart: hours[0].t, validEnd: hours[hours.length - 1].t, pointHit: [-104.99, 39.74] };
    const ev = evS("v", 39.74, -104.99, { setup: "2026-11-21T07:00", gates: "2026-11-21T09:00", start: "2026-11-21T10:00", end: "2026-11-21T15:00" }, "America/Denver");
    const r = runS(ev, clock, [nq], sstate(clock));
    assert.strictEqual(F.NAQFC_ENABLED, false); assert.strictEqual(r.items.length, 0); assert.ok(!r.statuses.some((x) => /NAQFC/.test(x.name)));
  });

}
console.log(n + " passed (with winter, fire and smoke)");

/* ---------------- TROPICAL (ARCHIVED official): NWS Mobile Tropical Cyclone Watch/Warning products for Hurricane Isaias
   (AL092026, Oct 7-10, 2026, text as archived by the Iowa Environmental Mesonet) and NHC advisory GIS. COASTAL (LIVE
   payload captured 2026-11-21): NWS Jacksonville coastal flood, high surf and rip current products. ---------------- */
{
  const DIR = FX("tcv-kmob-al092026"), tcvs = fs.readdirSync(DIR).sort().flatMap((f) => F.tcvToAlerts(fs.readFileSync(path.join(DIR, f), "utf8"), f.replace(".txt", "")));
  const zonesG = JSON.parse(fs.readFileSync(FX("nws-zones-gulf-al092026.json"), "utf8")).zones, zonesJ = JSON.parse(fs.readFileSync(FX("nws-zones-kjax-coastal-20261121.json"), "utf8")).zones;
  const replay = (msgs, clock, zones) => {
    const s = F.createAlertStore(), m = msgs.filter((f) => Date.parse(f.properties.sent) + 30e3 <= clock).sort((a, b) => (a.properties.sent < b.properties.sent ? -1 : 1));
    m.forEach((f, i) => { if (i === m.length - 1 || m[i + 1].properties.sent !== f.properties.sent) s.ingest({ type: "FeatureCollection", features: m.slice(0, i + 1) }, new Date(Date.parse(f.properties.sent) + 30e3).toISOString()); });
    if (m.length) s.ingest({ type: "FeatureCollection", features: m }, new Date(clock).toISOString());
    return s.products(clock).filter((p) => p.status === "active").map((p) => { const z = F.zoneShape(p.zones, p.zones.map((u) => (zones[u] ? zones[u].geometry : null))); return { ...p, geometry: z.geometry, geometryIncomplete: z.incomplete, zoneInfo: z }; });
  };
  const evT = (name, lat, lon, times, tz) => { const ev = { id: "t", name, loc: { name, lat, lon }, tz, times }; assert.deepStrictEqual(C.event.validate(ev), []); return { name, lat, lon, tz, windows: C.event.windows(ev) }; };
  const tstate = (clock) => ({ "nws-alerts": OK(clock), nhc: OK(clock) });
  const runT = (ev, clock, fams = ["tropical"]) => M.forEvent({ products: replay(tcvs, clock, zonesG), state: tstate(clock), event: ev, now: clock, families: fams });
  const GULF_SHORES = [30.2970, -87.5600] /* The Wharf, Orange Beach (Baldwin Coastal) */, MOBILE = [30.8829, -87.7731] /* Bay Minette (Baldwin Inland) */;
  const FRI_OCT9 = { setup: "2026-10-09T12:00", gates: "2026-10-09T16:00", start: "2026-10-09T17:00", end: "2026-10-09T21:00", teardown: "2026-10-09T23:00" };

  ok("TROPICAL replay Oct 7 noon CDT (advisory 4): Hurricane Watch and Storm Surge Watch at Orange Beach for a Friday event, until further notice, with NWS's wind window", () => {
    const r = runT(evT("The Wharf, Orange Beach", ...GULF_SHORES, FRI_OCT9, "America/Chicago"), Date.parse("2026-10-07T17:00:00Z"));
    assert.deepStrictEqual(r.items.map((i) => i.headline).sort(), ["Hurricane Watch during setup, gates, the event and teardown", "Storm Surge Watch during setup, gates, the event and teardown"]);
    assert.match(r.items[0].line, /^In effect at the venue until further notice \(issued for the forecast zone that includes the venue\)\. NWS window for tropical-storm-force winds: Friday afternoon until early Saturday morning\. Updated with each NHC advisory\.$/);
  });
  ok("TROPICAL replay Oct 8 midnight: upgraded to Hurricane Warning and Storm Surge Warning; inland Bay Minette (Baldwin Inland) gets the Hurricane Warning without storm surge", () => {
    const clock = Date.parse("2026-10-08T05:00:00Z");
    assert.deepStrictEqual(runT(evT("The Wharf, Orange Beach", ...GULF_SHORES, FRI_OCT9, "America/Chicago"), clock).items.map((i) => i.product.event).sort(), ["Hurricane Warning", "Storm Surge Warning"]);
    const mob = runT(evT("Bay Minette", ...MOBILE, FRI_OCT9, "America/Chicago"), clock).items.map((i) => i.product.event);
    assert.ok(mob.includes("Hurricane Warning") && !mob.some((e) => /Storm Surge/.test(e)), JSON.stringify(mob));
  });
  ok("TROPICAL replay Oct 10 2 a.m. CDT: the warnings were cancelled, so a Saturday evening event has none; tropical items stay out of other families", () => {
    const clock = Date.parse("2026-10-10T07:00:00Z"), sat = { start: "2026-10-10T17:00", end: "2026-10-10T21:00" };
    assert.strictEqual(runT(evT("The Wharf, Orange Beach", ...GULF_SHORES, sat, "America/Chicago"), clock).items.length, 0);
    assert.strictEqual(runT(evT("The Wharf, Orange Beach", ...GULF_SHORES, FRI_OCT9, "America/Chicago"), Date.parse("2026-10-08T05:00:00Z"), ["flood", "coastal"]).items.length, 0);
  });
  ok("TROPICAL: NHC advisory GIS parses to cone, track, points and coastal watch/warning segments (map context only, never a Planner item)", () => {
    const g = F.parseNHC(JSON.parse(fs.readFileSync(FX("nhc-al092026-adv006.geojson"), "utf8")));
    assert.deepStrictEqual([...new Set(g.map((p) => p.part))].sort(), ["cone", "points", "track", "watchwarning"]);
    assert.ok(g.every((p) => p.issued === "2026-10-08T03:00:00.000Z" && p.storm === "Isaias"));
    const r = M.forEvent({ products: g, state: tstate(Date.parse("2026-10-08T05:00:00Z")), event: evT("The Wharf, Orange Beach", ...GULF_SHORES, FRI_OCT9, "America/Chicago"), now: Date.parse("2026-10-08T05:00:00Z"), families: ["tropical"] });
    assert.strictEqual(r.items.length, 0);
  });
  ok("TROPICAL wind speed probabilities outside the cone: a Panama City test point is outside NHC's advisory-6 cone, and its official probability (a band, as published) is still listed with the threshold and full window; the cone stays map context", () => {
    const clock = Date.parse("2026-10-08T05:00:00Z"), cone = F.parseNHC(JSON.parse(fs.readFileSync(FX("nhc-al092026-adv006.geojson"), "utf8"))).find((p) => p.part === "cone");
    const PNS = [30.16, -85.66]; // Panama City, FL (test point) assert.ok(!T.contains(cone.geometry, [PNS[1], PNS[0]]), "outside the cone");
    const w = F.parseNHCWsp({ 34: { features: [{ attributes: { percentage: "40-50%", idp_filedate: Date.parse("2026-10-08T03:00:00Z") } }] }, 50: { features: [{ attributes: { percentage: "10-20%" } }] }, 64: { features: [] } }, [PNS[1], PNS[0]]);
    const r = M.forEvent({ products: [cone, ...w], state: tstate(clock), event: evT("Panama City test point", ...PNS, FRI_OCT9, "America/Chicago"), now: clock, families: ["tropical"] });
    assert.deepStrictEqual(r.items.map((i) => i.headline), ["40-50% chance of tropical-storm-force winds (39+ mph, 34 kt) at the venue through Monday"]);
    assert.match(r.items[0].line, /forecast window Oct 7, 10 PM CDT – Oct 12, 10 PM CDT: 39\+ mph \(34 kt\) 40-50%, 58\+ mph \(50 kt\) 10-20%, 74\+ mph \(64 kt\) under 5%/);
  });
  ok("TROPICAL wind speed probabilities: listed from 10% for 34 kt, as a 5-day chance without phase timing", () => {
    const clock = Date.parse("2026-10-08T05:00:00Z"), pt = [GULF_SHORES[1], GULF_SHORES[0]], q = (kt, pct) => ({ id: "w" + kt, kind: "tcwind", family: "tropical", sourceId: "nhc", kt, pct, pointHit: pt, issued: "2026-10-08T03:00:00.000Z" });
    const r = M.forEvent({ products: [q(34, 70), q(50, 35), q(64, 3)], state: tstate(clock), event: evT("The Wharf, Orange Beach", ...GULF_SHORES, FRI_OCT9, "America/Chicago"), now: clock, families: ["tropical"] });
    assert.deepStrictEqual(r.items.map((i) => i.headline), ["70% chance of tropical-storm-force winds (39+ mph, 34 kt) at the venue through Monday"]);
    assert.match(r.items[0].line, /^NHC wind speed probabilities, forecast window Oct 7, 10 PM CDT – Oct 12, 10 PM CDT: 39\+ mph \(34 kt\) 70%, 58\+ mph \(50 kt\) 35%, 74\+ mph \(64 kt\) under 5%\. The chance of those winds at some time in that window, not timing; it applies whether or not the venue is inside the forecast cone\./);
    assert.strictEqual(M.forEvent({ products: [q(34, 5)], state: tstate(clock), event: evT("v", ...GULF_SHORES, FRI_OCT9, "America/Chicago"), now: clock, families: ["tropical"] }).items.length, 0);
  });

  const coastal = JSON.parse(fs.readFileSync(FX("nws-live-kjax-coastal-20261121.json"), "utf8")).features, CL = Date.parse("2026-11-21T18:30:00Z");
  const runC = (ev, clock = CL) => M.forEvent({ products: replay(coastal, clock, zonesJ), state: { "nws-alerts": OK(clock) }, event: ev, now: clock, families: ["coastal"] });
  const FLAGLER = [29.4802, -81.1065], JAXBEACH = [30.2858, -81.3889], INLAND = [29.42, -81.17];
  const pts = JSON.parse(fs.readFileSync(FX("nws-points-coastal-20261122.json"), "utf8")).points;
  const placed = (ev, key) => ({ ...ev, zones: F.pointZones({ properties: pts[key] }) }); // NWS's own placement of the venue
  const SAT_PM = { start: "2026-11-21T14:00", end: "2026-11-21T18:00" };
  ok("COASTAL (no tropical system): Flagler Beach Pier, which NWS places in marine zone AMZ454 (no land zone): the Coastal Flagler products are flagged 'for the adjacent shoreline', with their end times", () => {
    const r = runC(placed(evT("Flagler Beach Pier", ...FLAGLER, SAT_PM, "America/New_York"), "29.4802,-81.1065"));
    assert.deepStrictEqual(r.items.map((i) => i.headline), ["Coastal alert for the adjacent shoreline: Coastal Flood Warning", "Coastal alert for the adjacent shoreline: High Surf Advisory", "Coastal alert for the adjacent shoreline: Rip Current Statement"]);
    assert.ok(r.items.every((i) => i.adjacent && !i.officialPlacement));
    assert.match(r.items[0].line, /^Issued for .*Coastal Flagler.*; NWS places the venue in no land forecast zone \(AMZ454\), 1 mile from that zone\. It covers the shoreline next to the venue, not the venue's own zone\. In effect until 5 a\.m\. Monday during the event\.$/);
  });
  ok("COASTAL: an inland point 0.6 mi from Coastal Flagler, which NWS places in Inland Flagler, gets only the Coastal Flood Warning issued for its own zone; no surf or rip current flag", () => {
    const r = runC(placed(evT("Inland point near Palm Coast", ...INLAND, SAT_PM, "America/New_York"), "29.42,-81.17"));
    assert.deepStrictEqual(r.items.map((i) => i.headline), ["Coastal Flood Warning during the event"]);
    assert.ok(r.items[0].officialPlacement && !r.items[0].adjacent); assert.match(r.items[0].line, /that includes the venue, as NWS places it\)/);
    const z138 = zonesJ["https://api.weather.gov/zones/forecast/FLZ138"].geometry; assert.ok(!T.contains(z138, [INLAND[1], INLAND[0]]) && T.nearestEdge(z138, [INLAND[1], INLAND[0]]).km < 1.5 * T.KM_PER_MI, "within 1.5 mi and outside the alert area");
  });
  ok("COASTAL: Jacksonville Beach Pier, which NWS places in Coastal Duval: the advisory 'covers the venue' (official placement), not the Flagler warning; a Monday-noon event gets nothing; coastal stays out of tropical", () => {
    const r = runC(placed(evT("Jacksonville Beach Pier", ...JAXBEACH, SAT_PM, "America/New_York"), "30.2858,-81.3889"));
    const ev = r.items.map((i) => i.headline.split(" during ")[0]);
    assert.ok(ev.includes("Coastal Flood Advisory") && !ev.some((e) => /Coastal Flood Warning/.test(e)) && r.items.every((i) => i.officialPlacement), JSON.stringify(ev));
    assert.strictEqual(runC(placed(evT("Flagler Beach Pier", ...FLAGLER, { start: "2026-11-23T12:00", end: "2026-11-23T15:00" }, "America/New_York"), "29.4802,-81.1065")).items.length, 0);
    assert.strictEqual(M.forEvent({ products: replay(coastal, CL, zonesJ), state: { "nws-alerts": OK(CL), nhc: OK(CL) }, event: placed(evT("Flagler Beach Pier", ...FLAGLER, SAT_PM, "America/New_York"), "29.4802,-81.1065"), now: CL, families: ["tropical"] }).items.length, 0);
  });
  ok("WINTER-style WSSI-P with a level unavailable (Extreme failed after retry): the answered levels are kept, Extreme reads unavailable in the item and the status", () => {
    const clock = Date.parse("2026-11-20T21:30:00Z"), CR = [46.935, -121.475], tue = { start: "2026-11-24T10:00", end: "2026-11-24T15:00" };
    const prods = F.parseWSSIP(JSON.parse(fs.readFileSync(FX("wpc-wssi-p-overall-cascades-20261120.json"), "utf8"))).filter((p) => p.category !== "EXTREME");
    const st = { "nws-alerts": OK(clock), "wpc-wssi-p": { ...OK(clock), reachEnd: "2026-11-27T00:00:00.000Z", unavailable: ["EXTREME"] } };
    const r = M.forEvent({ products: prods, state: st, event: evT("Crystal Mountain", ...CR, tue, "America/Los_Angeles"), now: clock, families: ["winter"] });
    assert.strictEqual(r.items.length, 1); assert.deepStrictEqual(r.items[0].levels.find(([L]) => L === "EXTREME"), ["EXTREME", null]);
    assert.ok(r.items[0].levels.find(([L]) => L === "MINOR")[1] > 0, "answered levels kept");
    assert.match(r.statuses.find((x) => x.id === "wpc-wssi-p").text, /· Extreme unavailable$/);
  });
  ok("COASTAL without NWS's placement (points lookup unavailable): the drawn outline decides; the pier, outside it, gets nothing (no flag without official placement)", () => {
    assert.strictEqual(runC(evT("Flagler Beach Pier", ...FLAGLER, SAT_PM, "America/New_York")).items.length, 0);
  });
}
console.log(n + " passed (with winter, fire, smoke, tropical and coastal)");

/* ---------------- AVIATION (official, captured live 2026-11-22 16:3xZ): NOAA Aviation Weather Center METARs and TAFs
   for KORD, KMDW and KMKE ---------------- */
{
  const met = F.parseMETAR(JSON.parse(fs.readFileSync(FX("awc-metar-kord-kmke-kmdw-20261122.json"), "utf8"))), taf = F.parseTAF(JSON.parse(fs.readFileSync(FX("awc-taf-kord-kmke-kmdw-20261122.json"), "utf8")));
  const AV = [...met, ...taf], CLK = Date.parse("2026-11-22T16:35:00Z"), UC = [41.8807, -87.6742];
  const evA = (times, airports) => { const ev = { id: "a", name: "United Center", loc: { name: "United Center", lat: UC[0], lon: UC[1] }, tz: "America/Chicago", times }; assert.deepStrictEqual(C.event.validate(ev), []); return { name: ev.name, lat: UC[0], lon: UC[1], tz: ev.tz, windows: C.event.windows(ev), airports }; };
  const W = (a, b) => ({ startMs: Date.parse(a), endMs: Date.parse(b) });
  const SUN = { start: "2026-11-22T12:00", end: "2026-11-22T15:00" };
  const airports = [{ icao: "KORD", role: "primary", arrive: W("2026-11-22T16:45:00Z", "2026-11-22T17:30:00Z"), depart: W("2026-11-23T16:00:00Z", "2026-11-23T17:00:00Z") }, { icao: "KMDW", role: "alternate", arrive: W("2026-11-22T16:45:00Z", "2026-11-22T17:30:00Z"), depart: null }];
  const runA = (ev, fams = ["aviation"]) => M.forEvent({ products: AV, state: { awc: OK(CLK), "nws-alerts": OK(CLK) }, event: ev, now: CLK, families: fams });
  ok("AVIATION: the venue has no official hazard, but the primary arrival airport (O'Hare) has IFR in its TAF during the arrival window, and IFR now; the alternate (Midway) is named separately", () => {
    const ev = evA(SUN, airports);
    assert.strictEqual(M.forEvent({ products: AV, state: { "nws-alerts": OK(CLK) }, event: ev, now: CLK, families: ["severe", "flood", "winter"] }).items.length, 0, "venue looks fine");
    const r = runA(ev), c = r.items.map((i) => i.code), h = r.items.map((i) => i.headline);
    assert.ok(c.includes("KORD arrival (Sun 10:45 a.m.–11:30 a.m.): temporarily IFR forecast"), JSON.stringify(c));
    assert.ok(c.includes("KORD now: IFR (observed 10:31 a.m.)"), JSON.stringify(c));
    assert.ok(c.includes("KMDW arrival (Sun 10:45 a.m.–11:30 a.m.): temporarily IFR forecast"), JSON.stringify(c));
    // plain language leads; no raw report or code group in the headline or the line
    assert.ok(h.includes("Low clouds (ceiling 700 ft) at times during your arrival, Sun 10:45 a.m.–11:30 a.m. at O'Hare (KORD) · IFR"), JSON.stringify(h));
    assert.ok(h.some((x) => /^Right now at O'Hare \(KORD\): low clouds \(ceiling \d[\d,]* ft\).* · IFR, observed 10:31 a\.m\.$/.test(x)), JSON.stringify(h));
    const ord = r.items.find((i) => i.code.startsWith("KORD arrival"));
    assert.strictEqual(ord.line, "Primary airport. From the airport's forecast issued 10:27 a.m. (amended); a forecast for the airport, not the venue.");
    assert.ok(r.items.filter((i) => i.family === "aviation").every((i) => !/METAR|TAF|\d{4}Z|KORD \d/.test(i.headline + " " + i.line)), "no raw codes up front");
    assert.match(r.items.find((i) => i.airport === "KMDW").line, /^Alternate airport/);
    // per-airport summary: every window gets a plain line, concerns or not
    const so = r.airports.find((x) => x.icao === "KORD");
    assert.deepStrictEqual([so.name, so.role, so.windows.map((w) => w.kind + ":" + w.concern)], ["O'Hare", "primary", ["arrival:true", "departure:false"]]);
    assert.match(so.windows[1].text, /^Your departure, Mon 10 a\.m\.–11 a\.m\. at O'Hare \(KORD\): good flying conditions forecast \(VFR\)\.$/);
    assert.ok(so.now.concern && r.airports.find((x) => x.icao === "KMDW").windows.length === 1);
    assert.strictEqual(r.venueSummary, ""); // aviation-only run
    assert.match(r.statuses.find((x) => x.id === "awc").text, /KORD METAR 1631Z IFR · TAF 1627Z AMD valid to Mon 12 p\.m\./);
  });
  ok("AVIATION: the Monday departure window falls in O'Hare's VFR period (no item); moving the arrival to the afternoon drops the IFR item; a window past the TAF says so", () => {
    const r = runA(evA(SUN, airports)); assert.ok(!r.items.some((i) => /departure/.test(i.headline)));
    const rv = runA(evA(SUN, airports), ["flood", "aviation"]); assert.match(rv.venueSummary, /^Not fully confirmed: no flooding threats found at the venue/); assert.ok(!/airport/.test(rv.venueSummary)); assert.ok(/weather threats? for this event/.test(rv.summary));
    const later = [{ icao: "KORD", role: "primary", arrive: W("2026-11-22T20:00:00Z", "2026-11-22T21:00:00Z"), depart: null }];
    assert.ok(!runA(evA(SUN, later)).items.some((i) => i.kind === "taf"));
    const past = [{ icao: "KORD", role: "primary", arrive: null, depart: W("2026-11-23T20:00:00Z", "2026-11-23T21:00:00Z") }];
    const rp = runA(evA({ start: "2026-11-23T12:00", end: "2026-11-23T13:00" }, past)); const st = rp.statuses.find((x) => x.id === "awc");
    assert.ok(!st.ok && /the departure window runs past the TAF \(ends 12 p\.m\.\)/.test(st.text), st.text);
  });
  ok("AVIATION: no airports set means no aviation source line; flight category follows the FAA definitions", () => {
    assert.ok(!runA(evA(SUN, [])).statuses.some((x) => x.id === "awc"));
    assert.deepStrictEqual([F.fltCat(400, 10), F.fltCat(900, 10), F.fltCat(2000, 10), F.fltCat(null, 2), F.fltCat(5000, 10)], ["LIFR", "IFR", "MVFR", "IFR", "VFR"]);
  });
}
console.log(n + " passed (with aviation)");
