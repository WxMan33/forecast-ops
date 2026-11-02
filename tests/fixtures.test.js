// Regression checks on captured real responses (tests/fixtures/, written by tests/capture.js).
// Repeatable and offline: run with  node tests/fixtures.test.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const C = require("../assets/ops-core.js");
const D = require("../assets/ops-data.js");
const F = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const N = C.nws;
const meta = F("capture-meta.json");
const capturedAt = Date.parse(meta.capturedAt);
console.log(`fixtures captured ${meta.capturedAt}`);

for (const place of ["cincinnati", "denver"]) {
  const pts = F(`nws-${place}-points.json`).json.properties;
  const fc = F(`nws-${place}-forecast.json`).json, fh = F(`nws-${place}-hourly.json`).json, grid = F(`nws-${place}-grid.json`).json;
  ok(pts.forecast && pts.forecastHourly && pts.forecastGridData && pts.timeZone, `${place}: points gives forecast, hourly, grid URLs and a time zone`);

  /* official day/night periods */
  const P = N.periods(fc);
  ok(P.length >= 12, `${place}: at least 12 forecast periods`);
  ok(P.every((p, i) => i === 0 || p.isDaytime !== P[i - 1].isDaytime), `${place}: periods alternate day/night`);
  ok(P.slice(1).every((p) => (p.e - p.s) === 12 * 3600e3 || (p.e - p.s) === 11 * 3600e3 || (p.e - p.s) === 13 * 3600e3), `${place}: full periods are ~12 h (11/13 h across a time change)`);
  ok(P.every((p) => p.temp != null && p.temp > -60 && p.temp < 130), `${place}: period temperatures in °F range`);
  ok(P.every((p) => p.pop == null || (p.pop >= 0 && p.pop <= 100)), `${place}: period PoP is a percent or null`);
  ok(P.every((p, i) => i === 0 || p.s === P[i - 1].e), `${place}: periods are contiguous`);

  /* hourly forecast */
  const Hh = N.hourly(fh);
  ok(Hh.length >= 100 && Hh.every((h, i) => i === 0 || h.s - Hh[i - 1].s === 3600e3), `${place}: hourly periods are consecutive hours`);

  /* grid: units converted, intervals respected */
  const gp = grid.properties;
  ok(gp.temperature.uom === "wmoUnit:degC" && gp.windGust.uom === "wmoUnit:km_h-1" && gp.quantitativePrecipitation.uom === "wmoUnit:mm", `${place}: grid units are as documented`);
  const ms = Hh.map((h) => h.s);
  const gT = N.stateAt(gp.temperature, ms);
  const diffs = Hh.map((h, i) => (h.temp != null && gT[i] != null ? Math.abs(h.temp - gT[i]) : null)).filter((x) => x != null);
  ok(diffs.length > 100 && Math.max(...diffs) <= 1, `${place}: grid temperature (°C→°F) matches the official hourly forecast within 1°F (max diff ${Math.max(...diffs).toFixed(2)})`);
  const gust = N.stateAt(gp.windGust, ms).filter((x) => x != null);
  ok(gust.length > 50 && gust.every((x) => x >= 0 && x < 150), `${place}: grid gusts converted to mph`);
  const q = N.intervals(gp.quantitativePrecipitation);
  ok(q.length > 0 && q.every((x) => x.e > x.s && (x.v == null || (x.v >= 0 && x.v < 10))), `${place}: QPF intervals in inches with positive durations`);
  const span = N.interval(gp.validTimes), whole = N.totalOver(q, q[0].s, q[q.length - 1].e);
  ok(whole.covers && whole.exact && Math.abs(whole.lower - q.reduce((t, x) => t + (x.v || 0), 0)) < 1e-9, `${place}: total over all intervals equals their sum (no duplication)`);
  ok(span && q[0].s >= span.s - 1, `${place}: grid validTimes covers its intervals`);
  const st = N.status({ forecast: fc, hourly: fh, grid }, capturedAt);
  ok(!st.stale.grid && !st.stale.forecast && st.ageH.grid >= 0, `${place}: fresh at capture time (grid ${st.ageH.grid.toFixed(1)} h old)`);
  ok(N.status({ forecast: fc, hourly: fh, grid }, capturedAt + 3 * 86400e3).stale.grid, `${place}: the same data three days later counts as stale`);
  /* thunder probability keeps NWS's own intervals; hourly display only samples them */
  const thIv = N.intervals({ ...gp.probabilityOfThunder, uom: "percent" });
  const durs = [...new Set(thIv.map((x) => (x.e - x.s) / 3600e3))];
  ok(thIv.length > 0 && durs.some((d) => d > 1), `${place}: thunder probability intervals are multi-hour (${durs.join(", ")} h)`);
  const axis = N.onAxis({ parts: { grid } }, ms);
  ok(ms.every((m, i) => { const iv = axis.thunderIv.find((x) => m >= x.s && m < x.e); return iv ? axis.thunder[i] === iv.v : axis.thunder[i] == null; }), `${place}: sampled thunder values equal their interval's value, nothing invented`);
  const wx = N.weatherAt(grid, ms);
  ok(wx.some((x) => x != null), `${place}: weather conditions present`);
}

/* Open-Meteo timestamp behavior from metadata + labels, not assumed */
const om = F("om-dst-newyork.json");
const inst = C.time.instants(om.hourly.time, om.timezone, om.utc_offset_seconds);
ok(inst.mode === "fixed" && !inst.consistent, "open-meteo: across the Nov 1 change the response is fixed-offset (detected), not true local");
ok(C.time.toLocal(inst.ms[0], "America/New_York") === "2026-10-31T01:00", "open-meteo: its 00:00 label on Oct 31 (EDT that day) is 01:00 true local");
const gfs = F("om-cincinnati-gfs-winter.json");
ok(gfs.hourly_units.geopotential_height_850hPa === "m" && gfs.hourly_units.snowfall === "cm", "open-meteo: metric request returns heights in m, snowfall in cm");
ok(D.toMeters("geopotential_height_850hPa", [5000], "ft")[0] === 1524, "loader: feet would be converted");

/* winter diagnostics on a real GFS response */
const h = {}; Object.keys(gfs.hourly).forEach((k) => (h[k] = gfs.hourly[k]));
const ws = C.winter.series(h, gfs.hourly.time.length, gfs.elevation);
ok(ws.length === gfs.hourly.time.length, "winter: one row per hour");
const profs = gfs.hourly.time.map((_, i) => C.winter.profile(h, i, gfs.elevation));
ok(profs.every((p) => p.length >= 8 && p.every((q, k) => k === 0 || q.z > p[k - 1].z)), "winter: GFS profiles have 8+ levels, ordered upward");
ok(ws.every((r) => r.twF == null || (r.tdF - 0.6 <= r.twF && r.twF <= r.t2F + 0.6)), "winter: wet-bulb lies between dew point and temperature");
ok(ws.every((r) => r.kuchera == null || (r.kuchera >= 0 && r.kuchera <= 30)), "winter: Kuchera ratios within bounds");
ok(profs.every((p) => C.winter.coverage(p).ok), "winter: real GFS profiles pass the completeness rule (surface to 500 hPa, no big gaps)");
ok(ws.every((r) => r.kuchera != null), "winter: so Kuchera is available every hour for GFS");
ok(ws.every((r) => !r.profileCoarse), "winter: real GFS profiles are not flagged coarse");
ok(ws.every((r) => !r.bour || ["snow", "rain", "mix", "freezing", "sleet"].includes(r.bour.type)), "winter: Bourgouin types only when wet, from the known set");
const inv = F("om-inventory.json");
ok(inv.ncep_nbm_conus.temperature_850hPa === "rejected" || inv.ncep_nbm_conus.temperature_850hPa.startsWith("0/"), "inventory: NBM has no profile (documented limitation)");
ok(!inv.gfs_seamless.wet_bulb_temperature_2m.startsWith("0/"), "inventory: wet-bulb available from GFS");

/* overview/detail consistency: the same function and settings give identical event rows */
const om2 = F("om-cincinnati-gfs-blend.json");
const data = { times: om2.hourly.time, dtimes: om2.daily.time, models: { gfs_seamless: { h: om2.hourly, d: om2.daily } } };
const A = C.blend.dailyRows(data, { gfs_seamless: 1 }), B2 = C.blend.dailyRows(JSON.parse(JSON.stringify(data)), { gfs_seamless: 1 });
ok(JSON.stringify(A) === JSON.stringify(B2), "consistency: identical inputs and weights give identical rows (overview = tool page)");

console.log(`ok - ${n} fixture checks passed`);
