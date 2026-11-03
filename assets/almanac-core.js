/* Daily Almanac calculations (no network). Browser: window.AlmanacCore; Node: require().
   Conventions:
   - Astronomy: USNO "rstt/oneday" for ONE point and date. Every time carries its zone label
     (ST/DT), so each is converted to an exact UTC instant; daylight = sunset instant - sunrise
     instant, so DST changes never add or remove an artificial hour. USNO rounds to the minute:
     durations are shown in whole minutes, and day-to-day changes carry +/-2 min rounding.
   - Climate: values are RCC-ACIS strings: "T" trace (0 for sums, flagged), "M" missing (never 0),
     "S" (subsequent/accumulated) and trailing "A" (accumulated total) are not daily values. */
(function (root) {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
  const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400e3);

  /* ---------- astronomy (USNO) ---------- */
  /* "07:08  ST" on date d with base offset tz (hours) -> {ms, label, zone} */
  function usnoInstant(d, txt, tz) {
    const m = /^(\d{1,2}):(\d{2})\s+(ST|DT)?/.exec(String(txt || "").trim()); if (!m) return null;
    const off = tz + (m[3] === "DT" ? 1 : 0);
    return { ms: Date.parse(`${d}T${pad(m[1])}:${m[2]}:00Z`) - off * 3600e3, label: `${pad(m[1])}:${m[2]}`, zone: m[3] || "", offset: off };
  }
  function parseOneDay(json) {
    const p = json && json.properties && json.properties.data; if (!p) return null;
    const d = `${p.year}-${pad(p.month)}-${pad(p.day)}`, tz = p.tz;
    const pick = (arr, name) => { const x = (arr || []).find((e) => e.phen === name); return x ? usnoInstant(d, x.time, tz) : null; };
    const sun = { civilBegin: pick(p.sundata, "Begin Civil Twilight"), rise: pick(p.sundata, "Rise"), transit: pick(p.sundata, "Upper Transit"), set: pick(p.sundata, "Set"), civilEnd: pick(p.sundata, "End Civil Twilight") };
    const moon = { rise: pick(p.moondata, "Rise"), transit: pick(p.moondata, "Upper Transit"), set: pick(p.moondata, "Set") };
    const cp = p.closestphase;
    return { date: d, tz, isdst: p.isdst, sun, moon, phase: p.curphase || null, illumination: p.fracillum != null ? parseFloat(p.fracillum) : null,
      closestPhase: cp ? { phase: cp.phase, date: `${cp.year}-${pad(cp.month)}-${pad(cp.day)}`, time: cp.time } : null,
      coords: json.geometry && json.geometry.coordinates ? { lon: json.geometry.coordinates[0], lat: json.geometry.coordinates[1] } : null, apiversion: json.apiversion || null };
  }
  /* daylight in whole minutes from instants (null if the sun doesn't rise or set) */
  const daylightMin = (a) => (a && a.sun.rise && a.sun.set ? Math.round((a.sun.set.ms - a.sun.rise.ms) / 60e3) : null);
  const fmtDur = (min) => (min == null ? "—" : `${Math.floor(min / 60)} h ${pad(min % 60)} min`);
  /* day-to-day change: both days must come from the same source, point and convention */
  function daylightChange(today, prev) {
    if (!today || !prev) return null;
    const a = today.coords, b = prev.coords;
    if (a && b && (Math.abs(a.lat - b.lat) > 1e-6 || Math.abs(a.lon - b.lon) > 1e-6)) return { error: "different locations" };
    const t = daylightMin(today), p = daylightMin(prev); if (t == null || p == null) return null;
    return { min: t - p, roundingMin: 2 };
  }
  /* USNO moon phases API (times in UT) -> next primary phase after the instant */
  function nextPhase(json, afterMs) {
    const list = ((json && json.phasedata) || []).map((x) => ({ phase: x.phase, ms: Date.parse(`${x.year}-${pad(x.month)}-${pad(x.day)}T${x.time}:00Z`) })).filter((x) => isFinite(x.ms)).sort((a, b) => a.ms - b.ms);
    return list.find((x) => x.ms > afterMs) || null;
  }

  /* ---------- NOAA Solar Calculator algorithm (gml.noaa.gov/grad/solcalc) ----------
     The same equations the NOAA GML calculator and its yearly tables use (Meeus-based), so rise and
     set match NOAA's table; the instants also carry seconds for daylight and its day-to-day change.
     Sunrise/sunset: sun's upper limb at the horizon with standard refraction (zenith 90.833 deg).
     Civil twilight: zenith 96 deg. Longitude east-positive. Returns UTC instants (ms). */
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  function jdOf(y, m, d) { if (m <= 2) { y -= 1; m += 12; } const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4); return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5; }
  const jc = (jd) => (jd - 2451545.0) / 36525.0;
  const meanLong = (t) => { let L = 280.46646 + t * (36000.76983 + t * 0.0003032); while (L > 360) L -= 360; while (L < 0) L += 360; return L; };
  const meanAnom = (t) => 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = (t) => 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const eqCenter = (t) => { const m = rad(meanAnom(t)); return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289; };
  const appLong = (t) => meanLong(t) + eqCenter(t) - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));
  const obliq = (t) => { const e0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60; return e0 + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t)); };
  const decl = (t) => deg(Math.asin(Math.sin(rad(obliq(t))) * Math.sin(rad(appLong(t)))));
  function eqTime(t) {
    const e = obliq(t), l0 = rad(meanLong(t)), ec = ecc(t), m = rad(meanAnom(t)); let y = Math.tan(rad(e) / 2); y *= y;
    return deg(y * Math.sin(2 * l0) - 2 * ec * Math.sin(m) + 4 * ec * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * ec * ec * Math.sin(2 * m)) * 4; // minutes
  }
  function hourAngle(lat, dec, zenith) { const c = Math.cos(rad(zenith)) / (Math.cos(rad(lat)) * Math.cos(rad(dec))) - Math.tan(rad(lat)) * Math.tan(rad(dec)); return Math.abs(c) > 1 ? null : deg(Math.acos(c)); }
  function eventUTCmin(rise, jd, lat, lon, zenith) { const t = jc(jd), h = hourAngle(lat, decl(t), zenith); if (h == null) return null; return 720 - 4 * (lon + (rise ? h : -h)) - eqTime(t); }
  /* NOAA's two-pass refinement: re-evaluate at the first estimate's time */
  function eventMs(rise, ymd, lat, lon, zenith = 90.833, passes = 2) {
    const [y, m, d] = ymd.split("-").map(Number), jd = jdOf(y, m, d);
    const t0 = eventUTCmin(rise, jd, lat, lon, zenith); if (t0 == null) return null;
    if (passes === 1) return Date.UTC(y, m - 1, d) + t0 * 60e3;
    const t1 = eventUTCmin(rise, jd + t0 / 1440, lat, lon, zenith); if (t1 == null) return null;
    return Date.UTC(y, m - 1, d) + t1 * 60e3;
  }
  function solarNoonMs(ymd, lon) {
    const [y, m, d] = ymd.split("-").map(Number), jd = jdOf(y, m, d);
    const off = 720 - lon * 4 - eqTime(jc(jd - lon / 360)), noon = 720 - lon * 4 - eqTime(jc(jd + off / 1440));
    return Date.UTC(y, m - 1, d) + noon * 60e3;
  }
  /* A local date's sun events. Rise/set are computed on the UTC date that holds local noon, then
     checked to fall on the local date (NOAA's table does the same for western longitudes). */
  function noaaSun(ymd, lat, lon, tzOffsetMinAtNoon) {
    const utcDay = new Date(Date.parse(ymd + "T12:00:00Z") - tzOffsetMinAtNoon * 60e3).toISOString().slice(0, 10);
    const ev = (rise, z) => eventMs(rise, utcDay, lat, lon, z);
    const r = { method: "NOAA Solar Calculator algorithm", lat, lon, date: ymd, rise: ev(true), set: ev(false), civilBegin: ev(true, 96), civilEnd: ev(false, 96), noon: solarNoonMs(utcDay, lon) };
    r.daylightSec = r.rise != null && r.set != null ? Math.round((r.set - r.rise) / 1000) : null;
    return r;
  }
  /* NOAA table style (verified on all 365 days of the 2026 Cincinnati table): drop fractional seconds,
     then round the minute up only when the whole seconds exceed 30. */
  const roundMin = (ms) => { const s = Math.floor(ms / 1000) % 60; return Math.floor(ms / 60e3) * 60e3 + (s > 30 ? 60e3 : 0); };
  const fmtHMS = (sec) => (sec == null ? "—" : `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`);
  const fmtDelta = (sec) => (sec == null ? "—" : `${sec > 0 ? "+" : sec < 0 ? "−" : "±"}${Math.floor(Math.abs(sec) / 60)}:${pad(Math.abs(sec) % 60)}`);

  /* ---------- climate values ---------- */
  function val(s) {
    if (s == null || s === "" || s === "M") return { v: null, missing: true };
    if (s === "S") return { v: null, missing: true, subsequent: true };
    if (/A$/.test(s)) return { v: null, missing: true, accumulated: s.replace(/A$/, "") };
    if (s === "T") return { v: 0, trace: true };
    const n = parseFloat(s); return isFinite(n) ? { v: n } : { v: null, missing: true };
  }
  const show = (x, d = 2) => (!x ? "—" : x.missing ? "M" : x.trace ? "T" : x.v.toFixed(d));
  /* Records for one calendar day from yearly rows [date, maxt, mint, pcpn, snow] -> each with ties and coverage */
  function records(rows) {
    const R = { years: 0, first: null, last: null };
    const by = [[1, "highMax", "max"], [2, "lowMin", "min"], [1, "lowMax", "min"], [2, "highMin", "max"], [3, "precip", "max"], [4, "snow", "max"]];
    const yrs = rows.map((r) => ({ y: +String(r[0]).slice(0, 4), v: r.slice(1).map(val) }));
    by.forEach(([k, key, how]) => {
      const ok = yrs.filter((x) => !x.v[k - 1].missing);
      if (!ok.length) { R[key] = null; return; }
      const best = how === "max" ? Math.max(...ok.map((x) => x.v[k - 1].v)) : Math.min(...ok.map((x) => x.v[k - 1].v));
      const tied = ok.filter((x) => x.v[k - 1].v === best);
      R[key] = { value: best, trace: best === 0 && tied.some((x) => x.v[k - 1].trace), years: tied.map((x) => x.y), n: ok.length, from: ok[0].y, to: ok[ok.length - 1].y, missingYears: yrs.length - ok.length };
      if (best === 0 && (key === "precip" || key === "snow")) R[key].note = "no measurable amount recorded on this date";
    });
    return R;
  }
  /* Accumulate daily values over [from, to] (inclusive). Normal values come from the same dates. */
  function accumulate(obsRows, normRows, from, to, col) {
    const obs = new Map(obsRows.map((r) => [r[0], val(r[col])])), norm = new Map((normRows || []).map((r) => [r[0], val(r[col])]));
    let sum = 0, trace = false, missing = [], days = 0, nsum = 0, nMissing = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days++; const o = obs.get(d);
      if (!o || o.missing) missing.push(d); else { sum += o.v; trace = trace || !!o.trace; }
      const n = norm.get(d); if (!n || n.missing) nMissing.push(d); else nsum += n.v;
    }
    const complete = !missing.length;
    return { from, to, days, total: Math.round(sum * 100) / 100, traceOnly: complete && sum === 0 && trace, complete, missing,
      normal: nMissing.length === days ? null : Math.round(nsum * 100) / 100, normalMissing: nMissing,
      departure: complete && !nMissing.length ? Math.round((sum - nsum) * 100) / 100 : null };
  }
  /* Consecutive days ending at `to` without measurable precipitation (trace counts as not measurable). */
  function dryStreak(obsRows, to, col = 3) {
    const m = new Map(obsRows.map((r) => [r[0], val(r[col])])), first = obsRows.length ? obsRows[0][0] : to;
    let n = 0;
    for (let d = to; d >= first; d = addDays(d, -1)) { const x = m.get(d); if (!x || x.missing) return { days: n, endedBy: "missing", at: d }; if (x.v >= 0.01) return { days: n, endedBy: "measurable", at: d, amount: x.v }; n++; }
    return { days: n, endedBy: "start of data", atLeast: true, from: first };
  }
  /* Days meeting a threshold in [from, to]; reports missing days. */
  function countDays(obsRows, from, to, col, test) {
    let n = 0, miss = 0, total = 0;
    obsRows.forEach((r) => { if (r[0] < from || r[0] > to) return; total++; const x = val(r[col]); if (x.missing) miss++; else if (test(x.v)) n++; });
    return { n, missing: miss, days: total };
  }
  /* Rank a value among yearly totals (ACIS [date, [value, missingCount]]), wettest/largest = 1, with ties.
     Years with missing days (beyond maxMissing) are excluded and counted. */
  function rank(rows, year, { maxMissing = 0, desc = true } = {}) {
    const all = (rows || []).filter((r) => Array.isArray(r[1])).map((r) => ({ y: +String(r[0]).slice(0, 4), x: val(r[1][0]), miss: r[1][1] }));
    if (!all.length) return { available: false, excluded: 0, n: 0, why: "no ranking data returned" };
    const ok = all.filter((a) => !a.x.missing && a.miss <= maxMissing), me = ok.find((a) => a.y === year);
    if (!me) return { available: false, excluded: all.length - ok.length, n: ok.length, why: "selected year's total is incomplete or missing" };
    const better = ok.filter((a) => (desc ? a.x.v > me.x.v : a.x.v < me.x.v)).length, ties = ok.filter((a) => a.x.v === me.x.v && a.y !== year).map((a) => a.y);
    return { available: true, rank: better + 1, of: ok.length, ties, value: me.x.v, excluded: all.length - ok.length, from: ok[0].y, to: ok[ok.length - 1].y };
  }
  /* Both ends of a historical ranking from yearly values (ACIS [date, [value, missingDays]]).
     Usable years: a value present and no missing days. Competition ranking with tied groups:
     high rank = 1 + (number of usable years with a HIGHER value), low rank = 1 + (number LOWER);
     years with an equal value are reported as ties for both. The selected year must itself be usable. */
  function rankBoth(rows, year) {
    const all = (rows || []).filter((r) => Array.isArray(r[1])).map((r) => ({ y: +String(r[0]).slice(0, 4), x: val(r[1][0]), miss: +r[1][1] || 0 }));
    const usable = all.filter((a) => !a.x.missing && a.miss === 0), excluded = all.filter((a) => a.x.missing || a.miss > 0).map((a) => a.y);
    const me = usable.find((a) => a.y === year);
    const base = { n: usable.length, from: usable.length ? usable[0].y : null, to: usable.length ? usable[usable.length - 1].y : null, excluded, excludedCount: excluded.length };
    if (!me) return { ...base, available: false, why: all.find((a) => a.y === year) ? "this year's total has missing days" : "no value for this year" };
    const v = me.x.v, ties = usable.filter((a) => a.y !== year && a.x.v === v).map((a) => a.y);
    return { ...base, available: true, value: v, ties,
      high: { rank: 1 + usable.filter((a) => a.x.v > v).length }, low: { rank: 1 + usable.filter((a) => a.x.v < v).length } };
  }
  /* Which end to lead with: the nearer extreme; a tie between ends goes to the departure's sign.
     level: "strong" (top 10 and top 10% of usable years), "notable" (top third), otherwise "typical". */
  function leadRank(rb, departure) {
    if (!rb || !rb.available) return null;
    const side = rb.high.rank < rb.low.rank ? "high" : rb.low.rank < rb.high.rank ? "low" : departure != null && departure < 0 ? "low" : "high";
    const r = rb[side].rank, other = side === "high" ? "low" : "high";
    const level = r <= 10 && r <= Math.max(1, Math.round(rb.n * 0.1)) ? "strong" : r <= rb.n / 3 ? "notable" : "typical";
    return { side, rank: r, other, otherRank: rb[other].rank, level, tied: rb.ties.length > 0 };
  }
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  /* Meteorological season containing a date: DJF (from Dec 1), MAM, JJA, SON. */
  function metSeason(d) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7);
    if (m === 12) return { id: "DJF", name: "Winter (Dec–Feb)", start: `${y}-12-01`, startMD: "12-01" };
    if (m <= 2) return { id: "DJF", name: "Winter (Dec–Feb)", start: `${y - 1}-12-01`, startMD: "12-01" };
    if (m <= 5) return { id: "MAM", name: "Spring (Mar–May)", start: `${y}-03-01`, startMD: "03-01" };
    if (m <= 8) return { id: "JJA", name: "Summer (Jun–Aug)", start: `${y}-06-01`, startMD: "06-01" };
    return { id: "SON", name: "Fall (Sep–Nov)", start: `${y}-09-01`, startMD: "09-01" };
  }
  /* Mean high, low and mean temperature over [from, to] against normals for the same dates.
     A departure is given only when every day has both an observation and a normal. */
  function meanTemps(obsRows, normRows, from, to) {
    const obs = new Map(obsRows.map((r) => [r[0], r])), nor = new Map((normRows || []).map((r) => [r[0], r]));
    const hi = [], lo = [], nhi = [], nlo = [], missing = [], nMissing = []; let days = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days++; const o = obs.get(d), n = nor.get(d);
      const oh = o ? val(o[1]) : { missing: true }, ol = o ? val(o[2]) : { missing: true };
      if (oh.missing || ol.missing) missing.push(d); else { hi.push(oh.v); lo.push(ol.v); }
      const nh = n ? val(n[1]) : { missing: true }, nl = n ? val(n[2]) : { missing: true };
      if (nh.missing || nl.missing) nMissing.push(d); else { nhi.push(nh.v); nlo.push(nl.v); }
    }
    const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null), r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    const complete = !missing.length && !nMissing.length;
    const mh = avg(hi), ml = avg(lo), nh = avg(nhi), nl = avg(nlo);
    return { from, to, days, complete, missing, normalMissing: nMissing, meanHigh: r1(mh), meanLow: r1(ml), mean: mh == null ? null : r1((mh + ml) / 2),
      normalHigh: r1(nh), normalLow: r1(nl), normalMean: nh == null ? null : r1((nh + nl) / 2),
      departure: complete ? r1((mh + ml) / 2 - (nh + nl) / 2) : null };
  }
  const API = { rankBoth, leadRank, ordinal, metSeason, meanTemps, noaaSun, eventMs, solarNoonMs, roundMin, fmtHMS, fmtDelta, jdOf, usnoInstant, parseOneDay, daylightMin, fmtDur, daylightChange, nextPhase, val, show, records, accumulate, dryStreak, countDays, rank, addDays, dayDiff };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.AlmanacCore = API;
})(typeof self !== "undefined" ? self : globalThis);
