/* The venue's 7-day dashboard (assets/threats-outlook.js) and SPC Day 4-8 parsing.
   Run: node tests/threats-outlook.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const F = require("../assets/threats-feeds.js"), O = require("../assets/threats-outlook.js");
const FX = (f) => path.join(__dirname, "fixtures", "threats", f);
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const box = (lon, lat, d = 1) => ({ type: "Polygon", coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
const V = { name: "TQL Stadium", lat: 39.1113, lon: -84.5222 }, NOW = Date.parse("2026-11-23T21:20:00Z"), TZ = "America/New_York";

ok("SPC Day 4-8: today's real Day 4 file is 'Potential Too Low' (quiet); Days 6-8 wording 'Predictability Too Low' is unknown; a 15% area is read", () => {
  const d4 = F.parseDay48(JSON.parse(fs.readFileSync(FX("spc-day4prob-20261124.json"), "utf8")), 4);
  assert.strictEqual(d4.status, "potential-too-low"); assert.strictEqual(d4.products.length, 0); assert.strictEqual(d4.validStart, "2026-11-27T12:00:00.000Z");
  const d6 = F.parseDay48({ features: [{ type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: { DN: 0, LABEL: "Predictability Too Low", VALID_ISO: "2026-11-29T12:00:00+00:00", EXPIRE_ISO: "2026-11-30T12:00:00+00:00" } }] }, 6);
  assert.strictEqual(d6.status, "predictability-too-low");
  const d5 = F.parseDay48({ features: [{ type: "Feature", geometry: box(-90, 35, 3), properties: { DN: 15, LABEL: "15%", VALID_ISO: "2026-11-28T12:00:00+00:00", EXPIRE_ISO: "2026-11-29T12:00:00+00:00" } }] }, 5);
  assert.strictEqual(d5.status, "areas"); assert.strictEqual(d5.products[0].prob, 15);
  assert.throws(() => F.parseDay48({ features: [] }, 4), /unrecognized SPC Day 4-8/);
});

const grid = F.parseGrid(JSON.parse(fs.readFileSync(FX("nws-gridpoints-ILN-35-38.json"), "utf8")), NOW, 168);
const base = () => ({ now: NOW, tz: TZ, venue: V, days: 7, states: { spc: { 1: "ok", 2: "ok", 3: "ok" }, fire: "ok", wssi: "ok", grid: "ok", alerts: "ok" },
  spc: [], spc48: [], ero: [], fire: [], wssi: [], nhc: [], aq: [], alerts: [], grid });

ok("DASHBOARD: 7 local days from today; the headline is the highest threat (an SPC Slight risk tomorrow), with its source and day", () => {
  const i = base(); i.spc = [{ day: 2, category: "MRGL", geometry: box(V.lon, V.lat, 3), validStart: "2026-11-24T12:00:00Z" }, { day: 2, category: "SLGT", geometry: box(V.lon, V.lat, 1), validStart: "2026-11-24T12:00:00Z" }];
  const r = O.build(i);
  assert.deepStrictEqual(r.days.map((d) => d.date), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  assert.strictEqual(r.days[0].label, "Today"); assert.strictEqual(r.days[1].label, "Tomorrow"); assert.strictEqual(r.days[2].label, "Wed, Nov 25");
  assert.deepStrictEqual(r.headline, { level: 2, text: "Severe storms: Slight risk (2 of 5)", when: "Tomorrow", source: "SPC Day 2" });
  assert.ok(!r.days[1].items.some((x) => /Marginal/.test(x.text)), "only the highest SPC category at the venue");
});

ok("DASHBOARD: a source that did not answer is 'not confirmed' on its day, never quiet; SPC 'predictability too low' is shown as a limit, not a failure", () => {
  const i = base(); i.states.spc[1] = "failed"; i.spcDayStart = { 1: "2026-11-23T12:00:00Z" };
  i.ero = [{ day: 1, failed: true, validStart: "2026-11-23T12:00:00Z" }];
  i.spc48 = [{ day: 6, status: "predictability-too-low", products: [], validStart: "2026-11-28T12:00:00Z" }];
  const r = O.build(i);
  assert.deepStrictEqual(r.days[0].unknown, ["SPC Day 1 outlook not confirmed", "WPC Day 1 rainfall outlook not confirmed"]);
  assert.deepStrictEqual(r.days[5].unknown, []); assert.deepStrictEqual(r.days[5].limits, ["SPC can't say yet for severe storms (Day 6: predictability too low)"]);
  assert.ok(/sources that answered/.test(r.headline.text) || r.headline.level >= 1, r.headline.text);
});

ok("DASHBOARD: NWS alerts at the venue are listed and placed on every local day they cover; the NWS grid adds gusts and rain chance by day", () => {
  const i = base(); i.alerts = [{ event: "Wind Advisory", onset: "2026-11-24T15:00:00Z", ends: "2026-11-25T23:00:00Z", senderName: "NWS Wilmington OH" }, { event: "Special Weather Statement", onset: "2026-11-23T20:00:00Z", ends: "2026-11-23T23:00:00Z" }];
  const r = O.build(i);
  assert.deepStrictEqual(r.alerts.map((a) => [a.event, a.level]), [["Wind Advisory", 1], ["Special Weather Statement", 0]]);
  assert.ok(r.days[1].items.some((x) => x.text === "Wind Advisory") && r.days[2].items.some((x) => x.text === "Wind Advisory") && !r.days[3].items.some((x) => x.text === "Wind Advisory"));
  const g = grid.rows.filter((x) => O.localDate(Date.parse(x.t), TZ) === "2026-11-24").reduce((m, x) => Math.max(m, x.gust || 0), 0);
  const gi = r.days[1].items.find((x) => x.key === "wind"); assert.ok(g >= 25 ? gi && gi.text === "Gusts to " + g + " mph" : !gi, JSON.stringify({ g, gi }));
});

ok("DASHBOARD: Day 4-8 15% area over the venue, WPC Day 2 rainfall, WSSI-P Moderate 40%, fire Critical, AirNow USG each land on their own day", () => {
  const i = base();
  i.spc48 = [{ day: 4, status: "areas", products: [{ prob: 15, geometry: box(V.lon, V.lat) }], validStart: "2026-11-26T12:00:00Z" }];
  i.ero = [{ day: 2, products: [{ category: "SLGT", geometry: box(V.lon, V.lat) }], validStart: "2026-11-24T12:00:00Z" }];
  i.wssi = [{ start: "2026-11-25T12:00:00Z", end: "2026-11-26T12:00:00Z", levels: { WWA: 80, MINOR: 60, MODERATE: 40, MAJOR: 10, EXTREME: 0 } }];
  i.fire = [{ day: 3, part: "windrh", category: "CRIT", geometry: box(V.lon, V.lat), validStart: "2026-11-25T12:00:00Z" }];
  i.aq = [{ validDate: "2026-11-27", category: "Unhealthy for Sensitive Groups", aqi: 105, pollutant: "PM2.5" }];
  const r = O.build(i), find = (d, k) => r.days[d].items.find((x) => x.key === k);
  assert.strictEqual(find(3, "severe").text, "Severe storms: 15% chance within 25 miles");
  assert.strictEqual(find(1, "rain").text, "Excessive rainfall: Slight (2 of 4)");
  assert.strictEqual(find(2, "winter").text, "Winter storm impacts: 40% chance of Moderate or worse");
  assert.strictEqual(find(2, "fire").text, "Fire weather: Critical");
  assert.strictEqual(find(4, "air").text, "Air quality: Unhealthy for Sensitive Groups (AQI 105), PM2.5");
});
ok("DASHBOARD: a river gauge within 25 miles forecast to reach moderate flooding lands on the forecast day; one 60 miles away does not; a failed gauge query is 'not confirmed'", () => {
  const i = base(); i.states.gauges = "ok";
  i.gauges = [{ name: "Ohio River at Cincinnati", point: [-84.51, 39.09], obs: { category: "action", value: 50, unit: "ft" }, fcst: { category: "moderate", value: 60, unit: "ft", time: "2026-11-26T06:00:00Z" } },
    { name: "Far River", point: [-85.6, 39.6], obs: { category: "major", value: 30, unit: "ft" }, fcst: null }];
  const r = O.build(i), it = r.days[2].items.find((x) => x.key === "river");
  assert.strictEqual(it.text, "Ohio River at Cincinnati: forecast moderate flooding (60 ft)"); assert.strictEqual(it.level, 2);
  assert.ok(!r.days.some((d) => d.items.some((x) => /Far River/.test(x.text))));
  const j = base(); j.states.gauges = "failed"; assert.ok(O.build(j).days[0].unknown.includes("NOAA river gauges not confirmed"));
});
console.log(n + " passed");
