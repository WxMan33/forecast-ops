/* Issue-time weather context beyond temperature: forecast cloud cover, 10 m wind and dewpoint.
   - Collected by a SEPARATE, optional request per deterministic model, after the primary sources are done.
     The primary temperature/precipitation requests, their raw responses and their normalization are untouched,
     and a context failure never changes a capture's outcome.
   - Bounded: one attempt per model, sequential; the first HTTP 429 stops the remaining context requests for
     that capture (recorded as "skipped after rate limit"), so a limit is never probed repeatedly.
   - The raw response is saved as received. Missing variables, all-null variables and short horizons are
     recorded explicitly; nothing is filled.
   - NWS: no new request. Sky cover, wind and dewpoint come from the gridpoint response every capture already saves.
   Forecast night classes (NIGHT_VERSION) are defined here, before any of their errors were examined, and use
   only the capture's own responses. They are kept apart from the OBSERVED night classes in lib/context.js. */
"use strict";
const U = require("./util.js");
const VERSION = "ctxvars-v1";
const NIGHT_VERSION = "forecast-night-v1";
const OM = "https://api.open-meteo.com/v1/forecast";
const VARS = ["cloud_cover", "wind_speed_10m", "wind_direction_10m", "dew_point_2m"];
const UNITS = { temperature_unit: "fahrenheit", wind_speed_unit: "mph", timezone: "GMT" };
const H = 3600e3;
/* Forecast night thresholds (fixed by definition, matching the observed classes' intent):
   clear/calm: two thirds of the night's hours with cloud cover <= 25 % (about 2 oktas, "few") and wind <= 6 mph (about 5 kt);
   windy: mean wind >= 12 mph (about 10 kt); cloudy: two thirds of hours with cloud cover >= 63 % (5 oktas, "broken");
   otherwise mixed. Any missing hour makes the night "unknown". Same order of tests as the observed classes. */
const NIGHT = { clearCloudPct: 25, calmMph: 6, windyMph: 12, cloudyPct: 63, share: 2 / 3 };

/* ---------- collection ---------- */
async function collect(loc, dataRoot, rel, detIds, { days = 16, fetchRaw = U.fetchRaw, budgetMs = 180000, now = Date.now } = {}) {
  const t0 = now(); /* a total time budget: optional context never runs on indefinitely */
  const q = (o) => new URLSearchParams(o).toString().replace(/%2C/g, ","), out = { version: VERSION, vars: VARS, sources: {} };
  let limited = null, noAnswer = 0;
  for (const id of detIds) {
    /* three requests in a row without any answer: the network, not the models; stop instead of probing on */
    if (!limited && noAnswer >= 3) limited = `${noAnswer} requests without an answer`;
    if (!limited && now() - t0 >= budgetMs) limited = `optional time budget of ${Math.round(budgetMs / 1000)} s reached`;
    const url = `${OM}?${q({ latitude: loc.lat, longitude: loc.lon, ...UNITS, forecast_days: days, models: id, ...(/^ncep_rrfs/.test(id) ? { cell_selection: "nearest", elevation: "nan" } : {}), hourly: VARS.join(",") })}`;
    if (limited) { out.sources[id] = { status: /budget/.test(limited) ? "skipped: time budget reached" : noAnswer >= 3 ? "skipped after repeated network failures" : "skipped after rate limit", request: url, after: limited }; continue; }
    const rec = { status: "failed", request: url };
    try {
      const r = await fetchRaw(url, { accept: "application/json", tries: 1, timeoutMs: 20000 });
      Object.assign(rec, { retrievedAt: r.retrievedAt, httpStatus: r.status });
      noAnswer = r.status ? 0 : noAnswer + 1;
      if (r.buf && r.buf.length) rec.file = U.saveRaw(dataRoot, `${rel}/ctx-${id}.json`, r.buf);
      if (r.status === 429) { rec.status = "rate-limited"; limited = id; out.sources[id] = rec; continue; }
      const j = r.ok ? U.parseJSON(r.text) : null;
      if (!j || j.error) { rec.error = (j && j.reason) || r.error || `HTTP ${r.status}`; out.sources[id] = rec; continue; }
      Object.assign(rec, describe(j));
    } catch (e) { rec.error = String((e && e.message) || e); }
    out.sources[id] = rec;
  }
  return out;
}
/* What a response actually holds, per variable: present, non-null count, last non-null time, unit. */
function describe(j) {
  const h = j.hourly || {}, units = j.hourly_units || {}, t = h.time || [], fields = {}, missing = [], partial = [];
  VARS.forEach((v) => {
    const a = h[v];
    if (!Array.isArray(a)) { fields[v] = { present: false }; missing.push(v); return; }
    const idx = a.map((x, i) => (x == null ? -1 : i)).filter((i) => i >= 0);
    fields[v] = { present: true, unit: units[v] || null, nonNull: idx.length, of: a.length, lastNonNull: idx.length ? t[idx[idx.length - 1]] + "Z" : null };
    if (!idx.length) missing.push(v); else if (idx.length < a.length) partial.push(v);
  });
  return { status: missing.length === VARS.length ? "empty" : missing.length ? "partial" : "ok", fields, missing, partialFields: partial };
}

/* ---------- hourly series in common units (°F, mph, %, degrees) ---------- */
const toMph = (v, unit) => (v == null ? null : /km\/h|km_h/.test(unit || "") ? v / 1.609344 : /kn|kt/.test(unit || "") ? v * 1.150779 : /m\/s|m_s/.test(unit || "") ? v * 2.236936 : v);
const toF = (v, unit) => (v == null ? null : /°C|degC/.test(unit || "") ? v * 9 / 5 + 32 : v);
/* Open-Meteo response -> { t: Map(ms -> {cloud, wind, dir, dew}) } */
function seriesOM(j) {
  const h = (j && j.hourly) || {}, u = (j && j.hourly_units) || {}, m = new Map();
  (h.time || []).forEach((tt, i) => { m.set(Date.parse(tt + "Z"), { cloud: h.cloud_cover ? h.cloud_cover[i] : null, wind: toMph(h.wind_speed_10m ? h.wind_speed_10m[i] : null, u.wind_speed_10m), dir: h.wind_direction_10m ? h.wind_direction_10m[i] : null, dew: toF(h.dew_point_2m ? h.dew_point_2m[i] : null, u.dew_point_2m) }); });
  return m;
}
/* NWS gridpoint response -> same shape. validTime intervals ("...+00:00/PT3H") are expanded hour by hour. */
function seriesNWS(grid) {
  const p = (grid && grid.properties) || {}, m = new Map();
  const put = (key, field, conv) => {
    const f = p[field]; if (!f || !Array.isArray(f.values)) return;
    f.values.forEach((x) => {
      const [start, dur] = String(x.validTime).split("/"), t0 = Date.parse(start), mm = /P(?:(\d+)D)?T?(?:(\d+)H)?/.exec(dur || "") || [];
      const hours = (+(mm[1] || 0)) * 24 + (+(mm[2] || 0)) || 1;
      for (let k = 0; k < hours; k++) { const t = t0 + k * H; const r = m.get(t) || m.set(t, { cloud: null, wind: null, dir: null, dew: null }).get(t); r[key] = conv(x.value, f.uom); }
    });
  };
  put("cloud", "skyCover", (v) => v); put("wind", "windSpeed", toMph); put("dir", "windDirection", (v) => v); put("dew", "dewpoint", toF);
  return m;
}

/* ---------- forecast night class ---------- */
function nightClass(series, startMs, n = 12) {
  const hrs = []; for (let k = 0; k < n; k++) hrs.push(series.get(startMs + k * H));
  if (hrs.some((r) => !r || r.cloud == null || r.wind == null)) return { cls: "unknown", hours: hrs.filter((r) => r && r.cloud != null && r.wind != null).length };
  const f = (p) => hrs.filter(p).length / n, meanW = hrs.reduce((s, r) => s + r.wind, 0) / n, dews = hrs.map((r) => r.dew).filter((x) => x != null);
  const clearCalm = f((r) => r.cloud <= NIGHT.clearCloudPct && r.wind <= NIGHT.calmMph), cloudy = f((r) => r.cloud >= NIGHT.cloudyPct);
  const cls = clearCalm >= NIGHT.share ? "clear/calm" : meanW >= NIGHT.windyMph ? "windy" : cloudy >= NIGHT.share ? "cloudy" : "mixed";
  return { cls, hours: n, clearCalmShare: Math.round(clearCalm * 100) / 100, cloudyShare: Math.round(cloudy * 100) / 100, meanWindMph: Math.round(meanW * 10) / 10, meanDewF: dews.length ? Math.round(dews.reduce((s, x) => s + x, 0) / dews.length * 10) / 10 : null };
}
/* Night after each local date d: 7 PM-7 AM local standard time. A night counts only if it starts at least
   minLeadMin after the retrieval of the response it comes from (issue-time evidence only). */
function nights(series, retrievedAtMs, dates, lstOffsetMin, minLeadMin = 60) {
  const out = {};
  dates.forEach((d) => { const s = Date.parse(d + "T00:00:00Z") - lstOffsetMin * 60e3 + 19 * H;
    out[d] = s < retrievedAtMs + minLeadMin * 60e3 ? { cls: "not eligible", why: "night began before retrieval + minimum lead" } : nightClass(series, s); });
  return out;
}
/* Consensus of deterministic models: the class held by more than half of the models with a known class, if
   at least three are known; "no majority" otherwise; "unknown" with fewer than three. */
function consensus(byModel) {
  const known = Object.values(byModel).map((x) => x && x.cls).filter((c) => c && c !== "unknown" && c !== "not eligible");
  if (known.length < 3) return { cls: "unknown", n: known.length };
  const cnt = {}; known.forEach((c) => (cnt[c] = (cnt[c] || 0) + 1));
  const [top, k] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  return { cls: k > known.length / 2 ? top : "no majority", n: known.length, votes: cnt };
}
/* Availability of a variable over one local day (24 LST hours): every hour non-null. */
function dayAvailable(series, key, dayStartMs) { for (let k = 0; k < 24; k++) { const r = series.get(dayStartMs + k * H); if (!r || r[key] == null) return false; } return true; }

module.exports = { VERSION, NIGHT_VERSION, VARS, NIGHT, collect, describe, seriesOM, seriesNWS, nightClass, nights, consensus, dayAvailable, toMph, toF };
