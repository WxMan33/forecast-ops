/* Verification context: what was known about each forecast when it was issued, kept apart from what was
   learned about the weather afterward. Three bases, never mixed:
     target   – fixed properties of what was forecast: valid date, month, season, lead, local day/night hour.
                Known before issue.
     issue    – facts recorded at retrieval: source status, provider-reported cycles, recipe weights requested
                and actually used, missing sources, retrieval times, code versions, the forecast's own implied
                day-to-day change and spread, and the latest observation the archive had already ingested.
                Built only from the capture, its bundle and observation rows whose firstSeenAt is no later
                than the capture's last retrieval. Stored once per capture and never rewritten.
     observed – classifications derived afterward from observations (observed warmup/cooldown, wet/dry,
                night sky and wind). Versioned and rebuilt every scoring run, because observations are revised.
                They describe the weather that happened; they can never choose weights at issue time.
   Climate patterns (ENSO, AO, NAO, PNA, MJO) have a reserved place in the issue context but are not
   collected: nothing here infers relationships with them. */
"use strict";
const U = require("./util.js");
const TG = require("./targets.js");
const VERSION = "context-v1";
const OBSERVED_VERSION = "observed-v1";
/* Classification thresholds, fixed by definition before any error was examined (not tuned to results). */
const CHANGE_F = 6; // day-to-day change of the daily high or low, °F: >= +6 warmup, <= -6 cooldown, otherwise small change
const SPREAD_F = [4, 8]; // ECMWF ENS 10–90 % width, °F: < 4 narrow, 4–8 moderate, > 8 wide
const REF_RECIPE = "baseline-v1"; // frozen and present in every capture; used only to describe the forecast's own implied change
const TEMP_TARGETS = ["tmax_clim", "tmin_clim", "tmax_day", "tmin_night"];
const H = 3600e3;

const season = (date) => { const m = +date.slice(5, 7); return m === 12 || m <= 2 ? "DJF" : m <= 5 ? "MAM" : m <= 8 ? "JJA" : "SON"; };
const changeClass = (d) => (d == null ? "unknown" : d >= CHANGE_F ? "warmup" : d <= -CHANGE_F ? "cooldown" : "small change");
const spreadClass = (w) => (w == null ? "unknown" : w < SPREAD_F[0] ? "narrow" : w <= SPREAD_F[1] ? "moderate" : "wide");
/* Local STANDARD-time hour of a UTC instant: 7–18 is day, otherwise night (the NWS 7a–7p convention). */
const lstHour = (t, loc) => new Date(t + loc.lstOffsetMin * 60e3).getUTCHours();
const dayNight = (t, loc) => { const h = lstHour(t, loc); return h >= 7 && h < 19 ? "day" : "night"; };
const leadBand = (lead) => (lead <= 0 ? "d0" : lead <= 2 ? "d1-2" : lead <= 4 ? "d3-4" : lead <= 7 ? "d5-7" : lead <= 10 ? "d8-10" : "d11+");
const hourBand = (h) => (h < 12 ? "0-12 h" : h < 24 ? "12-24 h" : h < 48 ? "24-48 h" : h < 72 ? "48-72 h" : h < 168 ? "3-7 d" : h <= 240 ? "7-10 d" : "10 d+");

function targetContext(target, date, lead, loc) {
  return { basis: "target", target, date, month: date.slice(0, 7), monthOfYear: +date.slice(5, 7), season: season(date), lead, leadBand: leadBand(lead) };
}

/* Daily extreme of an hourly series over a target window; null unless every hour is present. */
function windowExtreme(series, t0, step, [a, b], fn) {
  const vals = []; for (let t = a; t < b; t += H) { const i = Math.round((t - t0) / step); const v = series[i]; if (v == null) return null; vals.push(v); }
  return vals.length ? fn(...vals) : null;
}

/* Issue context for one capture. obsRows: every observation row in the archive; only rows the archive had
   ingested by the capture's last retrieval (firstSeenAt <= last) are used. */
function issueContext(cap, b, obsRows, loc, recipesById = {}) {
  const last = b.retrieval && b.retrieval.last, lastMs = last ? Date.parse(last) : null;
  const sources = {};
  Object.values(cap.sources || {}).forEach((s) => {
    const c = s.cycle || {};
    sources[s.id] = { kind: s.kind, status: s.status, httpStatus: s.httpStatus == null ? null : s.httpStatus, retrievedAt: s.retrievedAt || null, attempts: s.attempts == null ? null : s.attempts, horizonEnd: s.horizonEnd || null, members: s.members == null ? null : s.members,
      cycle: { kind: c.kind || null, reported: c.reported || null, status: c.status || "unknown", responseCycle: c.responseCycle == null ? null : c.responseCycle },
      nwsGridUpdateTime: s.kind === "nws" ? (s.parts && s.parts.grid && s.parts.grid.updateTime) || (c.kind === "nws-grid-update-time" ? c.reported : null) : undefined,
      modelVersion: null /* no provider reports a model version; see MODEL_VERSIONS in this file */ };
  });
  const recipes = {};
  Object.entries(b.blends || {}).forEach(([id, r]) => {
    const def = recipesById[id] || {};
    recipes[id] = { configHash: r.configHash || null, group: r.group || null, requested: r.requested || null, actual: r.actual || null, missing: r.missing || [], effectiveFrom: def.effectiveFrom || null, frozen: def.frozen || null,
      prospective: def.effectiveFrom ? Date.parse(cap.startedAt) >= Date.parse(def.effectiveFrom) : true };
  });
  const ok = Object.keys(sources).filter((k) => sources[k].status === "ok"), missing = Object.keys(sources).filter((k) => sources[k].status !== "ok");
  /* the latest climate-day observation the archive held at issue (persistence context) */
  const known = {};
  if (lastMs != null) obsRows.forEach((r) => {
    if (!["tmax_clim", "tmin_clim", "precip_clim"].includes(r.target) || !r.date || !r.firstSeenAt || Date.parse(r.firstSeenAt) > lastMs) return;
    const k = known[r.target]; if (!k || r.date > k.date || (r.date === k.date && r.firstSeenAt > k.firstSeenAt)) known[r.target] = { date: r.date, value: r.value, src: r.src, status: r.status, firstSeenAt: r.firstSeenAt };
  });
  /* the forecast's own implied change and spread (reference recipe, ECMWF ENS) */
  const implied = {}, hr = b.hourly, ref = hr && hr.temperature_2m && hr.temperature_2m["blend:" + REF_RECIPE];
  const ens = (b.sources && b.sources.ecmwf_ens) || {};
  TEMP_TARGETS.forEach((t) => {
    const fn = /^tmax/.test(t) ? Math.max : Math.min, out = (implied[t] = {});
    const dates = Object.keys(((b.blends || {})[REF_RECIPE] || {}).values && b.blends[REF_RECIPE].values[t] || {});
    dates.forEach((d) => {
      const cur = ref ? windowExtreme(ref, hr.t0, hr.stepMs, TG.TARGETS[t].window(d, loc), fn) : null;
      const prev = ref ? windowExtreme(ref, hr.t0, hr.stepMs, TG.TARGETS[t].window(U.addDays(d, -1), loc), fn) : null;
      const e = ens[t] && ens[t][d] && ens[t][d].ens, w = e && e.p90 != null && e.p10 != null ? Math.round((e.p90 - e.p10) * 10) / 10 : null;
      const sp = b.blends[REF_RECIPE].values[t][d].spread, mix = Array.isArray(sp) ? Math.round((sp[1] - sp[0]) * 10) / 10 : null;
      const step = cur != null && prev != null ? Math.round((cur - prev) * 10) / 10 : null;
      out[d] = { change: step, changeClass: changeClass(step), ensWidth10_90: w, spreadClass: spreadClass(w), mixedSourceRange: mix };
    });
  });
  return {
    version: VERSION, basis: "issue", captureId: cap.captureId, edition: cap.edition || null, loc: loc.id, slot: cap.slot, trigger: cap.trigger, timeliness: cap.timeliness || null,
    startedAt: cap.startedAt, retrieval: b.retrieval || null, code: cap.code || null, normVersion: b.version, targetsVersion: b.targetsVersion || null,
    sources, availability: { ok: ok.length, total: Object.keys(sources).length, missing }, recipes,
    knownAtIssue: known, implied: { ref: REF_RECIPE, thresholds: { changeF: CHANGE_F, spreadF: SPREAD_F }, byTarget: implied },
    climatePatterns: CLIMATE_PATTERNS.map((p) => ({ id: p.id, status: "not collected", value: null, asOf: null, source: null })),
  };
}

/* ---------- observed (derived afterward) ---------- */
/* Sky and wind from a routine METAR body. */
function skyWind(raw) {
  const body = " " + String(raw || "").split(" RMK ")[0] + " ";
  const w = /\s(\d{3}|VRB)(\d{2,3})(G\d{2,3})?KT\s/.exec(body), calm = /\s00000KT\s/.test(body);
  const layers = [...body.matchAll(/\s(FEW|SCT|BKN|OVC|VV)(\d{3})/g)].map((m) => m[1]);
  const clear = /\s(SKC|CLR|NCD|NSC)\s/.test(body);
  const cover = layers.includes("OVC") || layers.includes("VV") ? "overcast" : layers.includes("BKN") ? "broken" : layers.includes("SCT") ? "scattered" : layers.includes("FEW") || clear ? "clear-few" : null;
  return { windKt: calm ? 0 : w ? +w[2] : null, cover };
}
/* Night classes over a window of routine reports: radiational (mostly clear-few and wind <= 5 kt),
   cloudy (mostly broken or overcast), windy (mean wind >= 10 kt), otherwise mixed. */
function nightClass(reports) {
  const r = reports.map(skyWind).filter((x) => x.cover && x.windKt != null);
  if (r.length < 9) return { cls: "unknown", reports: r.length };
  const f = (p) => r.filter(p).length / r.length, meanW = r.reduce((s, x) => s + x.windKt, 0) / r.length;
  const clearCalm = f((x) => x.cover === "clear-few" && x.windKt <= 5), cloudy = f((x) => x.cover === "broken" || x.cover === "overcast");
  const cls = clearCalm >= 2 / 3 ? "radiational" : meanW >= 10 ? "windy" : cloudy >= 2 / 3 ? "cloudy" : "mixed";
  return { cls, reports: r.length, clearCalmShare: Math.round(clearCalm * 100) / 100, cloudyShare: Math.round(cloudy * 100) / 100, meanWindKt: Math.round(meanW * 10) / 10 };
}
/* Observed context per climate date. best: OBS.best map; hourlyRows: temp_hourly observation rows (with report text). */
function observedContext(best, hourlyRows, loc) {
  const val = (t, d) => { const o = best.get(`${t}|${d}`); return o ? o.value : null; };
  const dates = new Set(); best.forEach((v, k) => { const [t, d] = k.split("|"); if (t === "tmax_clim" || t === "tmin_clim") dates.add(d); });
  const reps = new Map(); hourlyRows.forEach((r) => { if (r.report && r.time != null) reps.set(r.time, r.report); });
  const night = (d) => { const s = TG.dayStartUtc(d, loc.lstOffsetMin); const a = []; for (let t = s + 19 * H + H; t <= s + 31 * H; t += H) if (reps.has(t)) a.push(reps.get(t)); return nightClass(a); };
  const out = {};
  [...dates].sort().forEach((d) => {
    const p = U.addDays(d, -1), tx = val("tmax_clim", d), txp = val("tmax_clim", p), tn = val("tmin_clim", d), tnp = val("tmin_clim", p), pr = val("precip_clim", d);
    const dx = tx != null && txp != null ? tx - txp : null, dn = tn != null && tnp != null ? tn - tnp : null;
    out[d] = { basis: "observed", version: OBSERVED_VERSION, tmax: tx, tmaxChange: dx, tmaxClass: changeClass(dx), tmin: tn, tminChange: dn, tminClass: changeClass(dn), wet: pr == null ? null : pr >= 0.01,
      /* the night AFTER the date (tmin_night) and the night BEFORE it, which usually holds the climate-day low */
      nightAfter: night(d), nightBefore: night(p) };
  });
  return out;
}

/* Reserved: climate-pattern indices. Each, when collected, must be stored AS PUBLISHED with its publication
   time, so an issue-time analysis uses only values public before the capture; revised values are new rows. */
const CLIMATE_PATTERNS = [
  { id: "enso-oni", label: "ENSO (Oceanic Niño Index)", cadence: "monthly, 3-month running mean, revised", source: "NOAA CPC" },
  { id: "enso-relative-oni", label: "ENSO (relative ONI)", cadence: "monthly", source: "NOAA CPC" },
  { id: "ao", label: "Arctic Oscillation", cadence: "daily index and forecasts", source: "NOAA CPC" },
  { id: "nao", label: "North Atlantic Oscillation", cadence: "daily index and forecasts", source: "NOAA CPC" },
  { id: "pna", label: "Pacific–North American pattern", cadence: "daily index and forecasts", source: "NOAA CPC" },
  { id: "mjo", label: "Madden–Julian Oscillation (RMM phase/amplitude)", cadence: "daily", source: "BoM / CPC" },
];
/* Reserved: model upgrades. No provider reports a model version with its forecast, so versions must come from
   dated upgrade notices. Comparisons spanning an entry here must be split at its date. Empty until entered
   from a cited notice; nothing is guessed. */
const MODEL_VERSIONS = [];

module.exports = { VERSION, OBSERVED_VERSION, CHANGE_F, SPREAD_F, REF_RECIPE, TEMP_TARGETS, CLIMATE_PATTERNS, MODEL_VERSIONS,
  season, changeClass, spreadClass, dayNight, lstHour, leadBand, hourBand, targetContext, issueContext, observedContext, skyWind, nightClass, windowExtreme };
