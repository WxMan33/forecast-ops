"use strict";
/* Weather Records & Milestones engine (RecordsEngine, RecordsHolidays).
   1. Cincinnati Thanksgiving 2026: tests/fixtures/records/cvg-november.json is a real RCC-ACIS snapshot (retrieved
      2026-11-27; every November of the Cincinnati threaded record CVGthr and the CVG airport record, plus Jul 2025 on;
      2026 values preliminary). Expected numbers were verified independently against ACIS, the NWS daily climate report
      and NCEI (see the PR).
   2. Edge cases on SYNTHETIC series (invented values, not observations): ties, trace, missing, leap days, the
      1939-1941 Thanksgiving dates, coverage, interim reports and metric units. */
const assert = require("node:assert/strict");
const E = require("../assets/records-engine.js"), H = require("../assets/records-holidays.js"), fx = require("./fixtures/records/cvg-november.json");
let n = 0; const check = (name, f) => { f(); n++; console.log("PASS " + name); };
const CIN = { id: "cvg", name: "Cincinnati", country: "US", region: "OH", units: { precip: "in", temp: "F" }, record: { sid: "CVGthr", name: "Cincinnati Area", kind: "threaded" } };
const thr = E.series(fx.CVGthr.rows, 1), air = E.series(fx.CVG.rows, 1);

check("holiday rules: Thanksgiving by era, 1939-1941 candidates, movable and fixed US dates, Canada", () => {
  assert.deepEqual(H.datesFor("US-thanksgiving", 2026).dates, ["2026-11-26"]); assert.deepEqual(H.datesFor("US-thanksgiving", 2010).dates, ["2010-11-25"]);
  assert.deepEqual(H.datesFor("US-thanksgiving", 1938).dates, ["1938-11-24"], "last Thursday through 1938");
  assert.deepEqual(H.datesFor("US-thanksgiving", 1939).dates, ["1939-11-23", "1939-11-30"]); assert.deepEqual(H.datesFor("US-thanksgiving", 1941).dates, ["1941-11-20", "1941-11-27"]);
  assert.deepEqual(H.datesFor("US-thanksgiving", 1942).dates, ["1942-11-26"], "fourth Thursday from 1942"); assert.equal(H.datesFor("US-thanksgiving", 1850), null);
  assert.deepEqual(H.datesFor("US-memorial", 1970).dates, ["1970-05-30"]); assert.deepEqual(H.datesFor("US-memorial", 1971).dates, ["1971-05-31"]);
  assert.deepEqual(H.datesFor("US-labor", 2026).dates, ["2026-09-07"]); assert.deepEqual(H.datesFor("CA-thanksgiving", 2026).dates, ["2026-10-12"]); assert.equal(H.datesFor("CA-thanksgiving", 1950), null);
  assert.deepEqual(H.on("2026-11-26").map((x) => x.key), ["US-thanksgiving"]); assert.deepEqual(H.on("2026-10-12", "CA").map((x) => x.key), ["CA-thanksgiving"]);
});
check("Cincinnati, Nov 26 2026 (threaded record): 2.16 in breaks the 1.49 in record from 1946 by 0.67 in; 80 years old; 155 prior years, none missing", () => {
  const r = E.dailyRecord({ S: thr, date: "2026-11-26", el: "pcpn" });
  assert.equal(r.outcome, "new"); assert.equal(r.value, 2.16); assert.deepEqual(r.previous, { value: 1.49, years: [1946], age: 80, margin: 0.67 });
  assert.deepEqual([r.sample.n, r.sample.from, r.sample.to, r.sample.missing, r.enough], [155, 1871, 2025, 0, true]);
});
check("Cincinnati, Nov 26 2026 (airport-only record since 1947): breaks 1.44 in from 2007 by 0.72 in; kept distinct from the city record", () => {
  const r = E.dailyRecord({ S: air, date: "2026-11-26", el: "pcpn" });
  assert.deepEqual([r.outcome, r.previous.value, r.previous.years[0], r.previous.age, r.previous.margin, r.sample.n, r.sample.from], ["new", 1.44, 2007, 19, 0.72, 79, 1947]);
});
check("Cincinnati Thanksgiving ranking: 2nd of 156 (threaded) and 2nd of 80 (airport), behind 2010; the same with either 1939-1941 date", () => {
  const h = E.holidayRank({ S: thr, holiday: "US-thanksgiving", year: 2026, threshold: 2 });
  assert.deepEqual([h.rank, h.of, h.robust], [2, 156, true]);
  assert.deepEqual(h.top.map((t) => `${t.y}:${t.v}`), ["2010:2.62", "2026:2.16", "1961:1.16", "1968:0.93", "1921:0.92", "1980:0.84", "1918:0.83", "1887:0.81", "2003:0.79", "1925:0.77"]);
  assert.deepEqual(h.uncertainYears, [1939, 1940, 1941]);
  const a = E.holidayRank({ S: air, holiday: "US-thanksgiving", year: 2026, threshold: 2 });
  assert.deepEqual([a.rank, a.of], [2, 80]); assert.deepEqual(a.top.map((t) => t.y), [2010, 2026, 1961, 1968, 1980, 2003, 1990, 1959, 1979, 1957]);
});
check("historical frequency: 2 of 156 Thanksgivings reached 2.00 in (1 of 155 before 2026); trace stays apart from zero; no-measurable count varies 54/53 with the 1939-1941 date", () => {
  const h = E.holidayRank({ S: thr, holiday: "US-thanksgiving", year: 2026, threshold: 2 });
  assert.deepEqual(h.freq, { threshold: 2, count: 2, n: 156, before: { count: 1, n: 155 } });
  assert.deepEqual(h.dry, { measurable: 54, trace: 31, zero: 71 }); assert.deepEqual(h.dryRange, [54, 53]);
});
check("context: 4th wettest November day (after 1948, 2010, 2011); last day of any month this wet Jul 20 2025; November 4.34 in, +1.57 in, 157% of normal to date", () => {
  const lo = E.lastOccurrence({ S: thr, date: "2026-11-26" });
  assert.equal(lo.monthRank, 4); assert.deepEqual(lo.monthAbove.map((x) => x.date), ["1948-11-05", "2010-11-25", "2011-11-03"]);
  assert.deepEqual(lo.any, { date: "2025-07-20", value: 2.94 }); assert.deepEqual(lo.sameMonth, { date: "2011-11-03", value: 2.26 });
  const mt = E.monthToDate({ S: thr, date: "2026-11-26", normals: { month: 3.23, toDate: 2.77 } });
  assert.deepEqual([mt.total, mt.departure, mt.pct], [4.34, 1.57, 157]);
});
check("findings: the story leads with the record, then the Thanksgiving ranking and the frequency; plain copy, no em dashes; preliminary labelled", () => {
  const f = E.findings({ market: CIN, date: "2026-11-26", S: { pcpn: thr }, status: () => "preliminary", normals: { pcpn: { month: 3.23, toDate: 2.77 } }, thresholds: { pcpn: 2 } });
  assert.deepEqual(f.highlights.map((h) => h.id), ["rec-pcpn", "hol-US-thanksgiving", "freq-US-thanksgiving"]);
  assert.equal(f.items.find((i) => i.id === "rec-pcpn").copyFact, "Cincinnati's 2.16 in of rain on November 26, 2026 broke the Nov 26 record of 1.49 in set in 1946 (preliminary data).");
  assert.equal(f.items.find((i) => i.id === "hol-US-thanksgiving").copyFact, "Thanksgiving 2026 was Cincinnati's 2nd wettest on record, behind only 2010 (preliminary).");
  f.items.forEach((i) => { assert.doesNotMatch(i.head + i.body + i.copyFact + i.short, /—/); assert.ok(i.evidence.source && i.evidence.range && i.evidence.sample); assert.equal(i.status, "preliminary"); });
});
/* ---- synthetic edge cases ---- */
const syn = (fn, y0 = 1950, y1 = 2026, md = "11-26") => { const rows = []; for (let y = y0; y <= y1; y++) rows.push([`${y}-${md}`, fn(y)]); return E.series(rows); };
check("synthetic: a tie lists every tied year; trace and dry days set no amount record; missing years are excluded and counted", () => {
  const S = syn((y) => (y === 1960 || y === 1990 ? "1.50" : y === 2026 ? "1.50" : y % 7 === 0 ? "M" : y % 3 === 0 ? "T" : "0.20"));
  const r = E.dailyRecord({ S, date: "2026-11-26", el: "pcpn" });
  assert.equal(r.outcome, "tie"); assert.deepEqual(r.previous.years, [1960, 1990]); assert.ok(r.sample.missing > 0); assert.equal(r.sample.n + r.sample.missing, 76);
  assert.equal(E.dailyRecord({ S: syn((y) => (y === 2026 ? "T" : "0.10")), date: "2026-11-26", el: "pcpn" }), null, "trace is never a record amount");
  assert.equal(E.dailyRecord({ S: syn((y) => (y === 2026 ? "0.00" : "0.10")), date: "2026-11-26", el: "pcpn" }), null);
});
check("synthetic: coverage rules suppress a claim with too few usable years or too much missing", () => {
  assert.equal(E.dailyRecord({ S: syn((y) => (y === 2026 ? "2.00" : "0.10"), 2000), date: "2026-11-26", el: "pcpn" }).enough, false, "26 prior years < 30");
  assert.equal(E.dailyRecord({ S: syn((y) => (y === 2026 ? "2.00" : y % 3 ? "M" : "0.10"), 1900), date: "2026-11-26", el: "pcpn" }).enough, false, "under 80% coverage");
});
check("synthetic: a leap day compares leap years only", () => {
  const rows = []; for (let y = 1900; y <= 2028; y++) { const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; if (leap) rows.push([`${y}-02-29`, y === 2028 ? "3.00" : "0.50"]); }
  const r = E.dailyRecord({ S: E.series(rows), date: "2028-02-29", el: "pcpn", minYears: 20 }); assert.equal(r.sample.leapOnly, true); assert.equal(r.sample.n, 31); assert.equal(r.outcome, "new");
});
check("synthetic: temperatures (record high, warm low) and a cold-high minimum use the right direction", () => {
  const hi = E.dailyRecord({ S: syn((y) => (y === 2026 ? "75" : y === 1950 ? "74" : "50")), date: "2026-11-26", el: "hiMax" });
  assert.deepEqual([hi.outcome, hi.previous.value, hi.previous.margin], ["new", 74, 1]);
  const cold = E.dailyRecord({ S: syn((y) => (y === 2026 ? "20" : y === 1976 ? "22" : "40")), date: "2026-11-26", el: "loMax" }); assert.equal(cold.outcome, "new");
});
check("synthetic: a split-date year that changes the result makes the holiday claim not robust (never published)", () => {
  const rows = []; for (let y = 1900; y <= 2026; y++) { const d = H.datesFor("US-thanksgiving", y).dates; d.forEach((x, i) => rows.push([x, y === 1940 && i === 1 ? "5.00" : y === 2026 ? "3.00" : "0.10"])); }
  const h = E.holidayRank({ S: E.series(rows), holiday: "US-thanksgiving", year: 2026 }); assert.equal(h.robust, false);
  const f = E.findings({ market: CIN, date: "2026-11-26", S: { pcpn: E.series(rows) }, status: () => "final" }); assert.ok(!f.items.some((i) => i.id.startsWith("hol-")));
});
check("synthetic: an interim (same-day) report produces no findings", () => {
  const f = E.findings({ market: CIN, date: "2026-11-26", S: { pcpn: thr }, status: () => "interim" }); assert.equal(f.items.length, 0);
});
check("synthetic: metric market (mm, Canadian Thanksgiving) writes metric copy", () => {
  const rows = []; for (let y = 1957; y <= 2026; y++) rows.push([H.datesFor("CA-thanksgiving", y).dates[0], y === 2026 ? "30.0" : y === 1975 ? "25.0" : "2.0"]);
  const M = { ...CIN, name: "Toronto", country: "CA", region: "ON", units: { precip: "mm", raw: "mm", temp: "C" } };
  const f = E.findings({ market: M, date: "2026-10-12", S: { pcpn: E.series(rows) }, status: () => "final" });
  const h = f.items.find((i) => i.id === "hol-CA-thanksgiving"); assert.equal(h.head, "Wettest Thanksgiving on record"); assert.match(h.body, /30\.0 mm/); assert.equal(h.label, "Observed record");
});
check("calendar-day scope (the Almanac's per-date history for a market without a pack): daily records only, never holidays or context from partial data", () => {
  const rows = fx.CVGthr.rows.filter((r) => r[0].slice(5) === "11-26"), S = E.series(rows, 1);
  const f = E.findings({ market: CIN, date: "2026-11-26", S: { pcpn: S }, status: () => "preliminary", scope: "calendarDay" });
  assert.deepEqual(f.items.map((i) => i.id), ["rec-pcpn"]); assert.equal(f.scope, "calendarDay");
});
check("refresh: each pack is recomputed from the source, so a revised value or a final status replaces the preliminary finding", () => {
  const market = { ...CIN, tz: "America/New_York" }, nf = () => ({ month: 3.23, toDate: 2.77 });
  const prelim = E.pack({ market, S: { pcpn: thr }, through: "2026-11-26", days: 1, finalThrough: "2026-11-15", normalsFor: nf, generated: "2026-11-27T06:45:00Z" });
  const p = prelim.days["2026-11-26"]; assert.equal(p.status, "preliminary"); assert.equal(p.items[0].label, "Preliminary observation"); assert.match(p.items[0].copyFact, /\(preliminary data\)\.$/);
  /* the source revises Nov 26 down to 1.40 in (below the 1.49 in record): the record claim is gone on the next refresh */
  const revised = new Map(thr); revised.set("2026-11-26", { v: 1.4 });
  const r = E.pack({ market, S: { pcpn: revised }, through: "2026-11-26", days: 1, finalThrough: "2026-11-15", normalsFor: nf });
  const ri = (r.days["2026-11-26"] || { items: [] }).items; assert.ok(!ri.some((i) => i.id === "rec-pcpn" && /broke/.test(i.body)), "no record claim after a downward revision");
  /* NCEI finalizes the day: the same finding becomes an observed record, without the preliminary note */
  const fin = E.pack({ market, S: { pcpn: thr }, through: "2026-11-26", days: 1, finalThrough: "2026-11-30", normalsFor: nf }).days["2026-11-26"];
  assert.equal(fin.status, "final"); assert.equal(fin.items[0].label, "Observed record"); assert.doesNotMatch(fin.items.map((i) => i.copyFact).join(" "), /preliminary/);
  assert.equal(prelim.windowDays, 1); assert.equal(prelim.generated, "2026-11-27T06:45:00Z");
});
console.log(`${n} checks passed`);
