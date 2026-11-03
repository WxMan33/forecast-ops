// Daily Almanac checks against captured official responses (USNO, RCC-ACIS, NOAA GML, NWS CLI).
// Run: node tests/almanac.test.js
const A = require("../assets/almanac-core.js");
const fs = require("fs"), path = require("path"), assert = require("assert");
const F = path.join(__dirname, "fixtures", "almanac");
const J = (f) => JSON.parse(fs.readFileSync(path.join(F, f))).json;
const has = (f) => fs.existsSync(path.join(F, f));
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const usno = (d) => A.parseOneDay(J(`usno-downtown-${d}.json`));

/* ---------- daylight from instants: DST never adds an hour ---------- */
eq(A.daylightChange(usno("2026-11-01"), usno("2026-10-31")).min, -2, "fall-back day: -2 min, not -62");
eq(A.daylightChange(usno("2026-03-08"), usno("2026-03-07")).min, 3, "spring-forward day: +3 min, not +63");
eq([A.fmtDur(A.daylightMin(usno("2028-02-29"))), A.daylightChange(usno("2028-02-29"), usno("2028-02-28")).min, A.daylightChange(usno("2028-03-01"), usno("2028-02-29")).min], ["11 h 19 min", 3, 2], "leap day 2028: daylight and changes either side");
eq(A.daylightChange(usno("2026-06-21"), usno("2026-06-20")).min, 1, "solstice: change within the ±2 min rounding");
eq(A.daylightChange(A.parseOneDay(J("usno-cvg-2026-11-03.json")), usno("2026-11-02")), { error: "different locations" }, "never mixes CVG with the downtown point");
eq([usno("2026-11-01").sun.rise.zone, usno("2026-10-31").sun.rise.zone, usno("2026-03-08").sun.rise.zone], ["ST", "DT", "DT"], "USNO zone labels are carried per time");

/* ---------- cross-check: NOAA GML solar table at the same point (comparison source, not mixed in) ---------- */
{
  const html = fs.readFileSync(path.join(F, "noaa-solcalc-2026.html"), "utf8");
  const tables = html.split(/Sunrise Table|Sunset Table/).slice(1, 3).map((t) => t.split(/<tr/i).map((r) => [...r.matchAll(/>\s*(\d{1,2}:\d{2}|\d{1,2})\s*</g)].map((m) => m[1])).filter((r) => r.length >= 12));
  const noaa = (kind, m, d) => { const row = tables[kind].find((r) => +r[0] === d); return row ? row[m] : null; };
  [["2026-11-03", 11, 3], ["2026-11-01", 11, 1], ["2026-03-08", 3, 8], ["2026-06-21", 6, 21]].forEach(([iso, m, d]) => {
    const u = usno(iso); const diff = (a, b) => { const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number); return Math.abs(h1 * 60 + m1 - (h2 * 60 + m2)); };
    const nr = noaa(0, m, d), ns = noaa(1, m, d);
    assert.ok(nr && ns, `NOAA table has ${iso}`);
    assert.ok(diff(u.sun.rise.label, nr) <= 1 && diff(u.sun.set.label, ns) <= 1, `${iso}: USNO ${u.sun.rise.label}/${u.sun.set.label} vs NOAA ${nr}/${ns} within 1 min`); n++;
  });
}

/* ---------- records (Cincinnati Area threaded), ties, leap day ---------- */
{
  const r = A.records(J("acis-records2-CVGthr-11-03.json").data);
  eq([r.highMax.value, r.highMax.years, r.lowMin.value, r.lowMin.years, r.highMax.from, r.highMax.to], [81, [1946], 12, [1951], 1872, 2025], "Nov 3 records from the threaded record, with period");
  const tie = A.records([["1990-07-04", "95", "70", "0.00", "0.0"], ["2001-07-04", "95", "68", "T", "0.0"], ["2010-07-04", "M", "M", "M", "M"]]);
  eq([tie.highMax.years, tie.highMax.missingYears, tie.precip.trace, tie.snow.value], [[1990, 2001], 1, true, 0], "ties list every year; missing years counted; trace kept as trace");
  /* leap day: the yearly-step query substitutes Feb 28 in 1900 (not a leap year); the groupby middle value does not */
  const a4 = J("acis-leap-A-int4.json").data;
  eq(a4.some((x) => x[0] === "1900-02-28"), true, "ACIS yearly step from Feb 29 silently returns 1900-02-28");
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const gb = J("acis-leap-C-groupby3.json").data.filter((x) => leap(+x[0])).map((x) => [`${x[0]}-02-29`, ...x.slice(1).map((v) => v[1])]);
  eq([gb.some((x) => x[0].startsWith("1900")), gb.find((x) => x[0] === "1904-02-29").slice(1, 3)], [false, ["67", "40"]], "groupby middle value: true leap days only (1904 = 67/40)");
  const lr = A.records(gb);
  eq([lr.highMax.value, lr.highMax.years, lr.lowMin.value, lr.lowMin.years], [73, [1972], 6, [1884]], "Feb 29 records from leap years only");
  if (has("acis-records2-CVGthr-11-02.json")) {
    /* official CLI for Nov 2, 2026 lists record high 81 (1987) and record low 23 (1934) */
    const r2 = A.records(J("acis-records2-CVGthr-11-02.json").data.filter((x) => +x[0].slice(0, 4) <= 2025));
    eq([r2.highMax.value, r2.highMax.years.includes(1987), r2.lowMin.value, r2.lowMin.years.includes(1934)], [81, true, 23, true], "ACIS threaded records match the NWS CLI for Nov 2");
  }
}

/* ---------- normals, accumulations, traces, missing ---------- */
{
  const nov = J("acis-normals-CVG-2026-11.json").data;
  eq(nov.find((x) => x[0] === "2026-11-02").slice(1, 3), ["60", "39"], "CVG normals Nov 2 = 60/39, as in the NWS CLI");
  const feb = J("acis-normals-CVG-2028-02.json").data;
  const acc = A.accumulate([["2028-02-28", "50", "30", "0.10", "0.0"], ["2028-02-29", "45", "28", "T", "M"]], feb, "2028-02-28", "2028-02-29", 3);
  eq([acc.complete, acc.total, acc.normalMissing], [true, 0.1, ["2028-02-29"]], "no published Feb 29 precip normal: flagged, never 0");
  const snow = A.accumulate([["2028-02-28", "50", "30", "0.10", "0.0"], ["2028-02-29", "45", "28", "T", "M"]], feb, "2028-02-28", "2028-02-29", 4);
  eq([snow.complete, snow.missing, snow.departure], [false, ["2028-02-29"], null], "missing snowfall is not zero: total incomplete, no departure");
  const tr = A.accumulate([["2024-12-03", "30", "19", "T", "T"]], [], "2024-12-03", "2024-12-03", 3);
  eq([tr.traceOnly, tr.total], [true, 0], "trace-only total shows as T");
  const w = J("acis-obs-CVG-2025-winter.json").data;
  eq(A.dryStreak(w, "2024-12-03"), { days: 1, endedBy: "measurable", at: "2024-12-02", amount: A.val(w.find((x) => x[0] === "2024-12-02")[3]).v }, "dry streak: a trace day counts as dry");
  const rk = A.rank(J("acis-mtd2-CVGthr-11-02.json").data, 2026);
  eq([rk.available, rk.of >= 150, Array.isArray(rk.ties)], [true, true, true], "month-to-date rank with period and ties");
}
console.log(`ok - ${n} almanac checks passed`);
