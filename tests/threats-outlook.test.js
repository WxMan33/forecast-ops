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
  const r = O.build(i), it = r.days[3].items.find((x) => x.key === "river"); // 06Z Nov 26 is 1 a.m. EST Nov 26
  assert.strictEqual(it.text, "Ohio River at Cincinnati: forecast moderate flooding (60 ft)"); assert.strictEqual(it.level, 2);
  assert.ok(!r.days.some((d) => d.items.some((x) => /Far River/.test(x.text))));
  const j = base(); j.states.gauges = "failed"; assert.ok(O.build(j).days[0].unknown.includes("NOAA river gauges not confirmed"));
});
ok("DASHBOARD: approaching: a higher SPC area within 100 miles shows as 'Nearby', with distance and direction, one level lower; farther away it doesn't", () => {
  const i = base(), west = { type: "Polygon", coordinates: [[[-86.4, 38.6], [-85.6, 38.6], [-85.6, 39.6], [-86.4, 39.6], [-86.4, 38.6]]] }, far = { type: "Polygon", coordinates: [[[-92, 38], [-91, 38], [-91, 39], [-92, 39], [-92, 38]]] };
  i.spc = [{ day: 1, category: "MRGL", geometry: box(V.lon, V.lat, 2), validStart: "2026-11-23T12:00:00Z" }, { day: 1, category: "ENH", geometry: west, validStart: "2026-11-23T12:00:00Z" }, { day: 1, category: "HIGH", geometry: far, validStart: "2026-11-23T12:00:00Z" }];
  const r = O.build(i), nb = r.days[0].items.find((x) => x.near);
  assert.ok(/^Nearby: Enhanced risk \(3 of 5\), \d+ mi west$/.test(nb.text), nb.text); assert.strictEqual(nb.level, 2);
  assert.ok(r.days[0].items.some((x) => x.text === "Severe storms: Marginal risk (1 of 5)"));
});

/* ---------- the rain headline: duration, day labels and rounds (from "Heavy rain Thursday · Rain for 40 h Thursday") ---------- */
const NOW_W = Date.parse("2026-11-25T21:32:24Z"), H1 = 3600e3;
const THU = Date.parse("2026-11-26T05:00:00Z"); // Thursday 00:00 in Cincinnati
/* hourly rows from Thursday 00:00 local for 72 h; `hour(i)` returns { cov, qpf } for hour i (cov 0 = no rain type; wx: null = missing) */
const rowsFrom = (hour) => Array.from({ length: 72 }, (_, i) => { const h = hour(i) || {}; return { t: new Date(THU + i * H1).toISOString(), qpf: h.qpf === undefined ? 0 : h.qpf,
  wx: h.wx === null ? null : h.cov ? [{ type: "rain", cov: h.cov }] : [] }; });
const gridOf = (rows) => ({ rows, qpfThrough: rows.at(-1).t, wxThrough: rows.at(-1).t });
const lead = (rows) => { const hl = O.highlights(gridOf(rows), TZ, NOW_W); return { hl, lead: O.highlightLead(hl.list, TZ) }; };

ok("RAIN HEADLINE, real Cincinnati forecast grid (ILN 35,38, downtown; 2026-11-25 21:32Z): one event, not a 40-hour Thursday; the separate Sunday round reads 'More rain Sunday'", () => {
  const g = F.parseGrid(JSON.parse(fs.readFileSync(FX("nws-gridpoints-ILN-35-38-20261125T2132Z.json"), "utf8")), NOW_W, 168);
  const hl = O.highlights(g, TZ, NOW_W), L = O.highlightLead(hl.list, TZ);
  assert.strictEqual(L.text, "Heavy rain Thursday · More rain Sunday");
  assert.strictEqual(L.timing, "Rain likely from 3 AM Thursday through 7 PM Friday, with light rain after 7 AM Friday");
  const thu = hl.list.find((x) => x.kind === "linger" && x.day === "Thursday");
  assert.strictEqual(thu.short, "Rain likely Thursday into Friday");
  // Friday's 0.01 in per 6 h (NWS's smallest measurable amount, chance 70-79%) is light rain, said as such, not dropped
  assert.ok(/^Rain likely for about 40 hours, Thu 3 AM – Fri 7 PM \(about 1\.2 in\); covers 4 commutes: .*; light after Fri 7 AM \(0\.01 in or less per 6 hours\)$/.test(thu.text), thu.text);
  const sun = hl.list.find((x) => x.kind === "linger" && x.day === "Sunday");
  assert.ok(/\(rain amounts not in the NWS forecast yet\)/.test(sun.text), sun.text);
  assert.ok(!hl.list.some((x) => /40 h/.test(x.short)));
});

ok("RAIN HEADLINE: continuous rain across midnight is one round, named by both days; with heavy rain it is the same event, not a second item", () => {
  let r = lead(rowsFrom((i) => (i >= 18 && i < 30 ? { cov: 3, qpf: 0.05 } : null)));
  assert.deepStrictEqual(r.hl.list.map((x) => x.short), ["Rain likely Thursday into Friday"]);
  assert.ok(/^Rain likely for about 12 hours, Thu 6 PM – Fri 6 AM/.test(r.hl.list[0].text), r.hl.list[0].text);
  assert.strictEqual(r.lead.text, "Rain likely Thursday into Friday");
  r = lead(rowsFrom((i) => (i >= 18 && i < 30 ? { cov: 4, qpf: 0.1 } : null)));
  assert.strictEqual(r.lead.text, "Heavy rain Thursday");
  assert.strictEqual(r.lead.timing, "Rain likely from 6 PM Thursday through 6 AM Friday");
});

ok("RAIN HEADLINE: separate rounds with a dry gap stay separate; 'More rain Friday' only when Friday rain is supported", () => {
  // heavy Thursday 6 AM - 6 PM, dry Thursday night, rain likely Friday 10 AM - 6 PM
  let r = lead(rowsFrom((i) => (i >= 6 && i < 18 ? { cov: 4, qpf: 0.1 } : i >= 34 && i < 42 ? { cov: 3, qpf: 0.03 } : null)));
  assert.strictEqual(r.lead.text, "Heavy rain Thursday · More rain Friday");
  assert.strictEqual(r.lead.timing, "Rain likely from 6 AM through 6 PM Thursday");
  // the dry gap hidden behind "rain likely" with only traces still separates the rounds
  r = lead(rowsFrom((i) => (i >= 6 && i < 18 ? { cov: 4, qpf: 0.1 } : i >= 18 && i < 34 ? { cov: 3, qpf: 0.0015 } : i >= 34 && i < 42 ? { cov: 3, qpf: 0.03 } : null)));
  assert.strictEqual(r.lead.text, "Heavy rain Thursday · More rain Friday");
  assert.ok(r.hl.list.every((x) => !/2[0-9]+ hours|3[0-9]+ hours/.test(x.text)), "no round spans the dry gap");
  // a 2-hour lull is not a dry gap: one round
  r = lead(rowsFrom((i) => (i >= 6 && i < 12 ? { cov: 3, qpf: 0.03 } : i >= 12 && i < 14 ? { cov: 3, qpf: 0 } : i >= 14 && i < 20 ? { cov: 3, qpf: 0.03 } : null)));
  assert.deepStrictEqual(r.hl.list.map((x) => x.short), ["Rain likely Thursday"]);
  assert.ok(/about 14 hours/.test(r.hl.list[0].text), r.hl.list[0].text);
  // Friday rain too short to be supported (4 h): no "More rain Friday"
  r = lead(rowsFrom((i) => (i >= 6 && i < 18 ? { cov: 4, qpf: 0.1 } : i >= 34 && i < 38 ? { cov: 3, qpf: 0.03 } : null)));
  assert.strictEqual(r.lead.text, "Heavy rain Thursday");
});

ok("RAIN HEADLINE: missing hourly guidance is never bridged, and missing amounts are said, not assumed", () => {
  // two wet stretches with 2 hours of no weather data between them: two rounds, not one
  let r = lead(rowsFrom((i) => (i >= 6 && i < 14 ? { cov: 3, qpf: 0.03 } : i >= 14 && i < 16 ? { wx: null, qpf: null } : i >= 16 && i < 24 ? { cov: 3, qpf: 0.03 } : null)));
  assert.strictEqual(r.hl.list.filter((x) => x.kind === "linger").length, 2);
  assert.ok(r.hl.list.every((x) => /about 8 hours/.test(x.text)), r.hl.list.map((x) => x.text).join(" | "));
  // rain likely with no amounts: kept on the weather type alone, and the text says the amounts are missing
  r = lead(rowsFrom((i) => (i >= 6 && i < 14 ? { cov: 3, qpf: null } : null)));
  assert.strictEqual(r.hl.list[0].short, "Rain likely Thursday");
  assert.ok(/about 8 hours, .*\(rain amounts not in the NWS forecast yet\)(;|$)/.test(r.hl.list[0].text), r.hl.list[0].text);
  assert.strictEqual(r.hl.list[0].source, "NWS forecast (precipitation type, chance)");
});
// NWS-style 6-hour amounts: each block's total spread evenly over its hours, with the block's edges on every row
const sixHour = (rows, totals) => rows.map((r, i) => { const k = Math.floor(i / 6), tot = totals(k); return tot === undefined ? r : { ...r, qpf: tot / 6, qpfFrom: new Date(THU + k * 6 * H1).toISOString(), qpfTo: new Date(THU + (k + 1) * 6 * H1).toISOString() }; });

ok("RAIN HEADLINE, real CVG forecast grid (ILN 30,35; 2026-11-25 21:45Z): the airport's forecast reads the same as downtown, Sunday is a separate round", () => {
  const g = F.parseGrid(JSON.parse(fs.readFileSync(FX("nws-gridpoints-ILN-30-35-20261125T2145Z.json"), "utf8")), NOW_W, 168);
  // the grid's amounts come in a 3-hour then 6-hour intervals; every row carries its interval
  const thu7 = g.rows.find((r) => r.t === "2026-11-26T12:00:00.000Z");
  assert.deepStrictEqual([thu7.qpfFrom, thu7.qpfTo], ["2026-11-26T12:00:00.000Z", "2026-11-26T18:00:00.000Z"]);
  const hl = O.highlights(g, TZ, NOW_W), L = O.highlightLead(hl.list, TZ);
  assert.strictEqual(L.text, "Heavy rain Thursday · More rain Sunday");
  assert.strictEqual(L.timing, "Rain likely from 3 AM Thursday through 7 PM Friday, with light rain after 7 AM Friday");
  // the heavy-rain window and its wettest period start and end on the 6-hour interval edges
  assert.strictEqual(hl.list[0].text, "Heavy rain: about 1.2 in from Thu 1 AM – Fri 1 AM; heaviest Thu 7 AM – 1 PM (about 0.7 in)");
  const thu = hl.list.find((x) => x.kind === "linger" && x.day === "Thursday"), sun = hl.list.find((x) => x.kind === "linger" && x.day === "Sunday");
  assert.ok(/^Rain likely for about 40 hours, Thu 3 AM – Fri 7 PM \(about 1\.2 in\);.*; light after Fri 7 AM/.test(thu.text), thu.text);
  // 36 hours with no rain type (chance 0-9%) separate Friday from Sunday
  assert.strictEqual(sun.text, "Rain likely for about 12 hours, Sun 7 AM – 7 PM (rain amounts not in the NWS forecast yet)");
});

ok("RAIN HEADLINE: an edge set by 6-hour amounts is given as the interval it falls in, never as an hour the guidance doesn't resolve", () => {
  // rain likely Thu 6 AM - Fri 6 AM by weather type; the Thu 6 PM - midnight interval holds 0.06 in and the next none
  let rows = sixHour(rowsFrom((i) => (i >= 6 && i < 30 ? { cov: 3 } : null)), (k) => [0, 0.3, 0.3, 0.06, 0][k] ?? 0);
  let r = lead(rows), it = r.hl.list.find((x) => x.kind === "linger");
  assert.strictEqual(r.lead.timing, "Rain likely from 6 AM Thursday, ending between 6 PM Thursday and 12 AM Friday");
  assert.ok(it.text.includes("Thu 6 AM until between Thu 6 PM and Fri 12 AM"), it.text);
  assert.ok(/^Rain likely for about 12–18 hours, /.test(it.text), it.text);
  // and the start: rain likely from midnight, but the first interval with rain is Thu 6 AM - noon
  rows = sixHour(rowsFrom((i) => (i < 18 ? { cov: 3 } : null)), (k) => [0, 0.3, 0.3][k] ?? 0);
  r = lead(rows);
  assert.strictEqual(r.lead.timing, "Rain likely starting between 6 AM and 12 PM Thursday and lasting through 6 PM Thursday");
  // where the weather type sets both edges, they are to the hour
  rows = sixHour(rowsFrom((i) => (i >= 8 && i < 22 ? { cov: 3 } : null)), (k) => [0, 0.3, 0.3, 0.3][k] ?? 0);
  assert.strictEqual(lead(rows).lead.timing, "Rain likely from 8 AM through 10 PM Thursday");
});

ok("RAIN HEADLINE: light rain (0.01 in per 6 hours) at the end of a round is said, and a zero-amount interval is a dry gap", () => {
  let rows = sixHour(rowsFrom((i) => (i >= 6 && i < 30 ? { cov: 3 } : null)), (k) => [0, 0.3, 0.3, 0.01, 0.01][k] ?? 0);
  let r = lead(rows);
  assert.strictEqual(r.lead.timing, "Rain likely from 6 AM Thursday through 6 AM Friday, with light rain after 6 PM Thursday");
  // a whole 6-hour interval of zero amount, even under "rain likely", splits two rounds
  rows = sixHour(rowsFrom((i) => (i >= 6 && i < 36 ? { cov: 3 } : null)), (k) => [0, 0.3, 0, 0.3, 0.3][k] ?? 0);
  assert.deepStrictEqual(lead(rows).hl.list.filter((x) => x.kind === "linger").map((x) => x.short), ["Rain likely Thursday", "Rain likely Thursday into Friday"]);
});
console.log(n + " passed");
