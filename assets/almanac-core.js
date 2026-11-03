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
    const all = rows.map((r) => ({ y: +String(r[0]).slice(0, 4), x: val(r[1][0]), miss: r[1][1] }));
    const ok = all.filter((a) => !a.x.missing && a.miss <= maxMissing), me = ok.find((a) => a.y === year);
    if (!me) return { available: false, excluded: all.length - ok.length, n: ok.length, why: "selected year's total is incomplete or missing" };
    const better = ok.filter((a) => (desc ? a.x.v > me.x.v : a.x.v < me.x.v)).length, ties = ok.filter((a) => a.x.v === me.x.v && a.y !== year).map((a) => a.y);
    return { available: true, rank: better + 1, of: ok.length, ties, value: me.x.v, excluded: all.length - ok.length, from: ok[0].y, to: ok[ok.length - 1].y };
  }
  const API = { usnoInstant, parseOneDay, daylightMin, fmtDur, daylightChange, nextPhase, val, show, records, accumulate, dryStreak, countDays, rank, addDays, dayDiff };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.AlmanacCore = API;
})(typeof self !== "undefined" ? self : globalThis);
