/* Forecast Ops core: model configuration, aggregation and forecast math. No page or DOM code.
   Loads in a browser (window.OpsCore) or Node (require), so the website, tests and any future
   server-side briefing all compute the same numbers from the same configuration.

   Conventions: missing values are null, never 0. Sounding winds in knots, heights in m above
   ground, sounding temperatures in °C. Signal keys: nodata, normal, monitor, prepare, action. */
(function (root) {
  "use strict";

  /* ======================= stats ======================= */
  const stats = {
    roundProbability(v) { return typeof v === "number" && Number.isFinite(v) && v >= -1e-9 && v <= 100 + 1e-9 ? Math.round(Math.max(0, Math.min(100, v)) / 5) * 5 : null; },
    /* Weighted mean/min/max across series at each index. series: [{w, data[]}] */
    blendSeries(series, n) {
      const mean = [], min = [], max = [], count = [];
      for (let i = 0; i < n; i++) {
        let s = 0, w = 0, lo = Infinity, hi = -Infinity, c = 0;
        for (const x of series) { const v = x.data[i]; if (v == null || !isFinite(v)) continue; const wi = typeof x.w === "function" ? x.w(i) : x.w; if (!(wi > 0)) continue; s += wi * v; w += wi; c++; lo = Math.min(lo, v); hi = Math.max(hi, v); }
        mean.push(w ? s / w : null); min.push(w ? lo : null); max.push(w ? hi : null); count.push(c);
      }
      return { mean, min, max, count };
    },
    weightedQuantile(vals, ws, q) {
      const idx = vals.map((v, i) => i).filter((i) => vals[i] != null).sort((a, b) => vals[a] - vals[b]);
      const tot = idx.reduce((s, i) => s + ws[i], 0); if (!tot) return null;
      let acc = 0;
      for (const i of idx) { acc += ws[i]; if (acc / tot >= q) return vals[i]; }
      return vals[idx[idx.length - 1]];
    },
    /* Running total. Once an hour is missing the rest is unknown, so it stays null. */
    cumulativeStrict(a) {
      let t = 0, broken = false;
      return a.map((x) => { if (broken || x == null) { broken = true; return null; } return (t += x); });
    },
    /* Align a series onto a master time axis by timestamp string. */
    align(masterTimes, times, arr) {
      if (!arr) return masterTimes.map(() => null);
      const at = new Map(times.map((t, i) => [t, i]));
      return masterTimes.map((t) => { const i = at.get(t); return i == null ? null : arr[i]; });
    },
    /* Weighted share of members/models meeting a test. Missing values don't count either way. */
    weightedShare(vals, ws, test) {
      let w = 0, hit = 0;
      vals.forEach((v, i) => { if (v == null) return; w += ws[i]; if (test(v)) hit += ws[i]; });
      return w ? hit / w : null;
    },
    hasData: (a) => Array.isArray(a) && a.some((x) => x != null),
    complete: (a, idx) => Array.isArray(a) && idx.length > 0 && idx.every((i) => a[i] != null),
  };

  /* ======================= time & windows ======================= */
  /* Open-Meteo with timezone=auto returns local wall-clock strings: "2026-11-02T14:00". */
  const time = {
    dayOf: (t) => t.slice(0, 10),
    hourOf: (t) => +t.slice(11, 13),
    /* Hour indices grouped by calendar day, optionally only within [s, e). */
    dayGroups(times, s = 0, e = times.length) {
      const out = [];
      for (let i = s; i < e; i++) { const k = time.dayOf(times[i]); if (!out.length || out[out.length - 1].k !== k) out.push({ k, idx: [] }); out[out.length - 1].idx.push(i); }
      return out;
    },
    /* The valid window an aggregate covers. Two summaries are only comparable if this matches. */
    windowKey: (times, idx) => (idx.length ? `${times[idx[0]]}/${times[idx[idx.length - 1]]}` : ""),

    /* ---- real instants: everything event-related is done in UTC milliseconds ---- */
    /* Minutes the zone is ahead of UTC at instant ms (e.g. -300 for EST). */
    offsetMin(ms, tz) {
      const o = {};
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(ms)).forEach((x) => (o[x.type] = x.value));
      return (Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(ms / 1000) * 1000) / 60000;
    },
    /* Local wall-clock "YYYY-MM-DDTHH:MM" in tz -> UTC ms. A time skipped by a spring-forward change
       moves forward to the first real minute; a repeated fall-back time resolves to its first occurrence. */
    /* What a local wall-clock time means in tz: "ok" (one instant), "ambiguous" (a repeated
       fall-back time: two instants) or "nonexistent" (skipped by spring-forward). */
    classify(local, tz) {
      const g = Date.UTC(+local.slice(0, 4), +local.slice(5, 7) - 1, +local.slice(8, 10), +local.slice(11, 13), +local.slice(14, 16));
      const cands = [...new Set([g - time.offsetMin(g - 12 * 3600e3, tz) * 60e3, g - time.offsetMin(g + 12 * 3600e3, tz) * 60e3])].sort((a, b) => a - b);
      const ok = cands.filter((m) => time.toLocal(m, tz) === local.slice(0, 16));
      return { kind: ok.length > 1 ? "ambiguous" : ok.length ? "ok" : "nonexistent", options: ok, after: Math.max(...cands) };
    },
    /* Local wall-clock -> UTC ms. fold picks the occurrence of a repeated fall-back time (0 = first,
       1 = second). A skipped spring-forward time resolves to the first real instant after the gap;
       event validation rejects those instead of resolving them silently. */
    toUtc(local, tz, fold = 0) {
      const c = time.classify(local, tz);
      if (c.kind === "nonexistent") return c.after;
      return c.options[Math.min(fold, c.options.length - 1)];
    },
    /* UTC ms -> local wall-clock "YYYY-MM-DDTHH:MM" in tz. */
    toLocal(ms, tz) {
      const o = {};
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(ms)).forEach((x) => (o[x.type] = x.value));
      return `${o.year}-${o.month}-${o.day}T${String(+o.hour % 24).padStart(2, "0")}:${o.minute}`;
    },
    /* UTC instants for a provider's hourly label axis. The labelling is detected per response,
       not assumed: "fixed" = one UTC offset for the whole response (labels step evenly with no
       repeats; observed from Open-Meteo, Nov 2026), "local" = true local time with DST (repeated
       or skipped labels). consistent = every label equals true local time in tz. */
    instants(times, tz, offsetSec) {
      if (!times.length) return { ms: [], consistent: false, mode: "none" };
      const lab = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16));
      const naive = times.map(lab);
      const even = naive.every((m, i) => i === 0 || m - naive[i - 1] === 3600e3);
      let ms, mode;
      if (even && offsetSec != null) { mode = "fixed"; ms = naive.map((m) => m - offsetSec * 1000); }
      else {
        mode = "local";
        const seen = {};
        ms = times.map((t) => { const k = t.slice(0, 16); const f = seen[k] || 0; seen[k] = f + 1; return time.toUtc(t, tz, f); });
      }
      return { ms, mode, consistent: !tz || ms.every((m, i) => time.toLocal(m, tz) === times[i].slice(0, 16)) };
    },
    /* Short zone name at an instant, e.g. "EDT". */
    abbr(ms, tz) { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName").value; } catch (e) { return ""; } },
  };

  /* ======================= signal tiers ======================= */
  /* Same fixed colors as Heads-Up; in guidance tools the words describe signal strength, not an action.
     Data completeness is a separate flag on each assessment, never a tier. */
  const TIERS = {
    nodata: { rank: -1, word: "NO DATA" },
    normal: { rank: 0, word: "LOW" },
    monitor: { rank: 1, word: "MARGINAL" },
    prepare: { rank: 2, word: "ELEVATED" },
    action: { rank: 3, word: "HIGH" },
  };
  const maxTier = (list) => list.reduce((a, b) => (TIERS[b] && TIERS[b].rank > TIERS[a].rank ? b : a), "nodata");

  /* ======================= model configuration ======================= */
  const FORECAST = "https://api.open-meteo.com/v1/forecast";
  const ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble";
  const US = { temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" };
  const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250];
  const PL = [];
  LEVELS.forEach((p) => ["temperature", "wind_speed", "wind_direction", "geopotential_height"].forEach((v) => PL.push(`${v}_${p}hPa`)));
  /* Each spec says what to request and how. Model w = default weight; on:false = off by default. */
  const config = {
    blend: {
      id: "blend", base: FORECAST, params: US, days: 7, require: ["temperature_2m"],
      models: [
        { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
        { id: "ecmwf_aifs025_single", name: "ECMWF AIFS", w: 1 },
        { id: "gfs_seamless", name: "GFS", w: 0.75 },
        { id: "ncep_nbm_conus", name: "NBM", w: 2 },
        { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1.5 },
        { id: "ncep_rrfs_conus", name: "RRFS 3 km", w: 1.5, note: "Native CVG point feed, or provider data where available. Only covered variables and windows contribute." },
        { id: "icon_seamless", name: "ICON", w: 1, on: false },
        { id: "gem_seamless", name: "GEM", w: 1, on: false },
        { id: "ukmo_seamless", name: "UKMO", w: 1, on: false },
        { id: "meteofrance_seamless", name: "Météo-France", w: 0.75, on: false },
        { id: "jma_seamless", name: "JMA", w: 0.75, on: false },
      ],
      /* Sources inside the blend that are not Open-Meteo deterministic models. Each has ONE total
         weight; an ensemble's weight is shared equally by its members, so member count never decides
         its influence. Default weights here are the user's stated preference, not verified skill. */
      extra: [
        { id: "nws", name: "NWS point forecast", w: 3, kind: "nws", note: "NWS gridded forecast. Precip and snow come from its multi-hour interval totals." },
        { id: "ecmwf_ens", name: "ECMWF ENS", w: 4, kind: "ens", ens: "ecmwf_ifs025", note: "51 members; the system's weight is shared by its members." },
        { id: "gefs", name: "GEFS", w: 0.75, kind: "ens", ens: "gfs025", note: "31 members; the system's weight is shared by its members." },
        { id: "rrfs_ens", name: "RRFS ensemble (5 members)", w: 1.25, kind: "ens", ens: "ncep_rrfs_conus_ensemble", note: "Five RRFS perturbed members, not the full time-lagged REFS product. One system weight shared across its five members. Only covered variables and windows contribute." },
      ],
      hourly: ["temperature_2m", "dew_point_2m", "apparent_temperature", "precipitation_probability", "precipitation", "snowfall", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "cloud_cover"],
      extraHourly: { gfs_hrrr: ["visibility", "weather_code"], ncep_rrfs_conus: ["visibility", "weather_code"] },
      daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "snowfall_sum", "precipitation_probability_max", "wind_gusts_10m_max"],
    },
    thunder: {
      id: "thunder", base: FORECAST, params: US, days: 3, require: ["cape", "weather_code"],
      models: [
        { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1.25 },
        { id: "ncep_rrfs_conus", name: "RRFS 3 km", w: 1, on: false, note: "Optional new source; current feed may be unavailable. Not included in the saved eight-source recipe." },
        { id: "gfs_seamless", name: "GFS", w: 1 },
        { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
        { id: "icon_seamless", name: "ICON", w: 1 },
        { id: "gem_seamless", name: "GEM", w: 0.75 },
      ],
      hourly: ["cape", "lifted_index", "convective_inhibition", "precipitation_probability", "precipitation", "weather_code",
        "wind_speed_10m", "wind_direction_10m", "wind_speed_500hPa", "wind_direction_500hPa"],
      extraHourly: { icon_seamless: ["lightning_potential"] },
    },
    severe: {
      /* Metric precipitation keeps heights in meters; ops-data.js also converts feet if they ever appear. */
      id: "severe", base: FORECAST, params: { temperature_unit: "celsius", wind_speed_unit: "kn", precipitation_unit: "mm" }, days: 3,
      require: ["cape", "wind_speed_500hPa"],
      models: [
        { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1.25 },
        { id: "ncep_rrfs_conus", name: "RRFS 3 km", w: 1, on: false, minimumFields: ["temperature_2m", "dew_point_2m", "cape", "wind_speed_10m", "wind_speed_500hPa", "temperature_700hPa", "temperature_500hPa", "geopotential_height_500hPa"], note: "Optional new source; current feed may be unavailable. Not included in the saved eight-source recipe." },
        { id: "gfs_seamless", name: "GFS", w: 1 },
        { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
        { id: "icon_seamless", name: "ICON", w: 1 },
        { id: "gem_seamless", name: "GEM", w: 0.75 },
      ],
      hourly: ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "cape", "convective_inhibition",
        "lifted_index", "freezing_level_height", "precipitation_probability", "weather_code", ...PL],
    },
    /* Ensembles used inside the blend (temperature and precipitation). */
    /* Open-Meteo metadata ids (static/meta.json) per blend source: provider-reported latest run. Seamless
       products combine several runs; the listed component is the global one. */
    metaIds: { ecmwf_ifs025: "ecmwf_ifs025", ecmwf_aifs025_single: "ecmwf_aifs025_single", gfs_seamless: "ncep_gfs013", ncep_nbm_conus: "ncep_nbm_conus", gfs_hrrr: "ncep_hrrr_conus",
      ncep_rrfs_conus: "ncep_rrfs_conus", rrfs_ens: "ncep_rrfs_conus_ensemble", icon_seamless: "dwd_icon", gem_seamless: "cmc_gem_gdps", ukmo_seamless: "ukmo_global_deterministic_10km",
      ecmwf_ens: "ecmwf_ifs025_ensemble", gefs: "ncep_gefs025" },
    blendEns: {
      id: "blendEns", base: ENSEMBLE, params: US, days: 7, ensemble: true, require: ["temperature_2m"],
      models: [
        { id: "ecmwf_ifs025", name: "ECMWF ENS", source: "ecmwf_ens" },
        { id: "gfs025", name: "GEFS", source: "gefs" },
        { id: "ncep_rrfs_conus_ensemble", name: "RRFS ensemble (5 members)", source: "rrfs_ens", optional: true, minMembers: 5 },
      ],
      hourly: ["temperature_2m", "precipitation", "snowfall"],
    },
    winter: {
      id: "winter", base: ENSEMBLE, params: US, days: 7, ensemble: true, require: ["snowfall"],
      models: [
        { id: "gfs025", name: "GEFS (GFS ens.)", w: 1 },
        { id: "ecmwf_ifs025", name: "ECMWF ENS", w: 1.25 },
        { id: "icon_seamless", name: "ICON EPS", w: 0.75 },
        { id: "gem_global", name: "GEM ENS", w: 0.75 },
        { id: "ncep_rrfs_conus_ensemble", name: "RRFS ensemble (5 members)", w: 1, on: false },
      ],
      hourly: ["snowfall", "temperature_2m", "precipitation"],
    },
    /* {id: weight} for models that are on by default. */
    defaultWeights(spec) { const w = {}; spec.models.forEach((m) => { if (m.on !== false && m.w > 0) w[m.id] = m.w; }); return w; },
    /* Stable text form of a weight set, stored with snapshots so changed settings are visible. */
    fingerprint(ws) { return Object.keys(ws).sort().map((k) => `${k}:${ws[k]}`).join(","); },
  };

  /* ======================= blend ======================= */
  const blend = {
    /* Agreement of model daily highs: a data-quality note about temperature only. */
    agreement(highs) {
      const v = highs.filter((x) => x != null);
      if (v.length < 2) return { level: 0, word: v.length ? "1 MODEL" : "—", lo: v[0] ?? null, hi: v[0] ?? null, n: v.length };
      const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo;
      return { level: r <= 3 ? 3 : r <= 6 ? 2 : 1, word: r <= 3 ? "TIGHT" : r <= 6 ? "FAIR" : "WIDE", lo, hi, range: r, n: v.length };
    },
    /* ---- sources ----
       data.models[id] is one blend source. Deterministic: {h, d}. Ensemble: {kind:"ens", h: member
       mean per hour, members: [{h}]}. NWS: {kind:"nws", h: hourly state fields, iv: {var: intervals}}. */

    /* Add ensemble systems and NWS to deterministic data as blend sources, on the same UTC axis. */
    addSources(data, ens, nwsAxis) {
      const at = new Map(data.ms.map((m, i) => [m, i]));
      if (ens && !ens.empty && ens.ms) {
        (config.blendEns.models).forEach((m) => {
          const E = ens.ens[m.id]; if (!E) return;
          const vars = Object.keys(E), n = Math.max(0, ...vars.map((v) => E[v].length)); if (!n) return;
          const onAxis = (a) => { const out = data.ms.map(() => null); ens.ms.forEach((ms, k) => { const i = at.get(ms); if (i != null) out[i] = a[k]; }); return out; };
          const members = Array.from({ length: n }, (_, k) => { const h = {}; vars.forEach((v) => { if (E[v][k]) h[v] = onAxis(E[v][k]); }); return { h }; });
          const h = {}; vars.forEach((v) => (h[v] = data.ms.map((_, i) => { let t = 0, c = 0; members.forEach((mb) => { const x = mb.h[v] && mb.h[v][i]; if (x != null) { t += x; c++; } }); return c ? t / c : null; })));
          const rt = ens.retrieved && ens.retrieved[m.id] || {};
          data.models[m.source] = { kind: "ens", h, members, n, provenance: ens.sourceProvenance && ens.sourceProvenance[m.id] || null, retrievedAt: rt.at || null, fromCache: !!rt.fromCache };
        });
      }
      if (nwsAxis) {
        const A = nwsAxis, h = {};
        ["temperature_2m", "dew_point_2m", "apparent_temperature", "precipitation_probability", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "cloud_cover"].forEach((v) => { if (A[v]) h[v] = A[v]; });
        if (stats.hasData(h.temperature_2m)) data.models.nws = { kind: "nws", h, iv: { precipitation: A.qpf || [], snowfall: A.snow || [] } };
      }
      return data;
    },
    /* Effective share of the total weight per source for variable v, among sources present. */
    shares(ws, rules, v, present) {
      const ids = Object.keys(ws).filter((id) => (!present || present.includes(id)) && blend.w(ws, rules, id, v) > 0);
      const tot = ids.reduce((t, id) => t + blend.w(ws, rules, id, v), 0);
      return ids.map((id) => ({ id, share: tot ? blend.w(ws, rules, id, v) / tot : 0 })).sort((a, b) => b.share - a.share);
    },
    /* Hard exclusions: values that are not comparable are never mixed in. NWS hourly PoP uses a
       different threshold and period from Open-Meteo's precipitation_probability. */
    EXCLUDE: { nws: ["precipitation_probability"] },
    /* Weight of source id for variable v, after preset rules and exclusions. */
    w(ws, rules, id, v) { if ((blend.EXCLUDE[id] || []).includes(v) || !(ws[id]>0)) return 0; if(rules?.absoluteByVar?.[v])return rules.absoluteByVar[v][id] || 0; if(rules?.absoluteWeights)return rules.absoluteWeights[id] || 0; return blend.weightFor(ws, rules, id, v); },
    /* One deterministic series over hours: extreme or sum, only if every hour is present. */
    reduce(a, use, how) {
      if (!use.length || !stats.complete(a, use)) return null;
      const v = use.map((i) => a[i]);
      return how === "max" ? Math.max(...v) : how === "min" ? Math.min(...v) : v.reduce((s, x) => s + x, 0);
    },
    /* A source's value for a window. Ensembles: each member's own extreme or total first (taking the
       extreme of the hourly member mean would flatten highs and lows), then the mean of the members
       that cover the window. NWS accumulations: from its interval totals, exact when the intervals
       line up with the window, otherwise prorated by overlap and flagged. Returns null or
       {v, members?: [values], prorated?: bool}. own: provider daily value (deterministic only). */
    sourceValue(md, hv, how, use, data, own) {
      if (!md) return null;
      if (md.kind === "ens") {
        const mv = md.members.map((mb) => blend.reduce(mb.h[hv], use, how)).filter((x) => x != null);
        return mv.length ? { v: mv.reduce((s, x) => s + x, 0) / mv.length, members: mv } : null;
      }
      if (md.kind === "nws" && how === "sum" && md.iv && md.iv[hv]) {
        if (!use.length) return null;
        const s = data.ms[use[0]] - 3600e3, e = data.ms[use[use.length - 1]];
        const t = nws.totalOver(md.iv[hv], s, e);
        if (!t.covers) return null;
        if (t.exact) return { v: t.lower };
        const p = nws.prorate(md.iv[hv], s, e);
        return p == null ? null : { v: p, prorated: true, range: [t.lower, t.upper] };
      }
      if (own != null) return { v: own };
      const v = blend.reduce(md.h[hv], use, how);
      return v == null ? null : { v };
    },
    /* Weighted combination of source values: mean, 10th/90th percentiles (ensemble members carry
       their system's weight shared equally) and per-source parts for the driver view. */
    combine(list, wOf) {
      let s = 0, w = 0, sLo = 0, sHi = 0, bounded = false; const vals = [], ws = [], parts = [];
      list.forEach(({ id, r }) => {
        const wi = wOf(id); if (!r || !(wi > 0)) return;
        s += wi * r.v; w += wi; parts.push({ id, v: r.v, w: wi, n: r.members ? r.members.length : 1, prorated: !!r.prorated, range: r.range || null });
        /* a prorated NWS total could lie anywhere in its lower-upper bounds; carry them to the blend */
        if (r.range) { bounded = true; sLo += wi * r.range[0]; sHi += wi * r.range[1]; } else { sLo += wi * r.v; sHi += wi * r.v; }
        if (r.members) r.members.forEach((x) => { vals.push(x); ws.push(wi / r.members.length); }); else { vals.push(r.v); ws.push(wi); }
      });
      if (!w) return { v: null, p10: null, p90: null, parts };
      parts.forEach((p) => (p.share = p.w / w));
      return { v: s / w, p10: stats.weightedQuantile(vals, ws, 0.1), p90: stats.weightedQuantile(vals, ws, 0.9), parts, bounds: bounded ? [sLo / w, sHi / w] : null };
    },
    /* Chance of at least thr (data units) over the window from ensemble members only: the weighted
       share of members, each system at its own precipitation weight. Other sources' probabilities
       use different thresholds and periods, so they are not mixed in. */
    ensChance(data, ids, wOf, use, thr) {
      let t = 0, w = 0, n = 0;
      ids.forEach((id) => { const md = data.models[id]; if (!md || md.kind !== "ens") return; const wi = wOf(id); if (!(wi > 0)) return;
        const mv = md.members.map((mb) => blend.reduce(mb.h.precipitation, use, "sum")).filter((x) => x != null); if (!mv.length) return;
        t += wi * mv.filter((x) => x >= thr).length / mv.length; w += wi; n += mv.length; });
      return w ? { v: (100 * t) / w, members: n } : null;
    },
    /* Wind direction (degrees the wind blows FROM) for the hours in idx: each source's wind as a vector (speed and
       direction), combined at the source's blend weight for sustained wind; an ensemble is the mean of its members'
       vectors. Never a plain average of angles (350° and 10° give 0°, not 180°). No source with both speed and
       direction: deg null, never north. Every contributing speed zero: calm (a calm wind has no direction). Winds that
       cancel (the combined vector is numerically zero against the winds' own scale): variable, with no direction. */
    windDirection(data, ids, wOf, idx) {
      let u = 0, v = 0, n = 0, moving = 0, scale = 0;
      const vec = (h) => { let a = 0, b = 0, k = 0, m = 0; (idx || []).forEach((i) => { const s = h && h.wind_speed_10m && h.wind_speed_10m[i], d = h && h.wind_direction_10m && h.wind_direction_10m[i];
        if (s == null || d == null || !isFinite(s) || !isFinite(d)) return; const r = (d * Math.PI) / 180; a += s * Math.sin(r); b += s * Math.cos(r); k++; if (s > 0) m++; }); return k ? { a: a / k, b: b / k, m } : null; };
      ids.forEach((id) => { const md = data.models[id], wi = wOf(id); if (!md || !(wi > 0)) return;
        const parts = md.kind === "ens" ? (md.members || []).map((mb) => vec(mb.h)).filter(Boolean) : [vec(md.h)].filter(Boolean); if (!parts.length) return;
        u += wi * parts.reduce((t, p) => t + p.a, 0) / parts.length; v += wi * parts.reduce((t, p) => t + p.b, 0) / parts.length; n++; moving += parts.reduce((t, p) => t + p.m, 0);
        scale += wi * parts.reduce((t, p) => t + Math.hypot(p.a, p.b), 0) / parts.length; });
      if (!n) return { deg: null, calm: false, variable: false };
      if (!moving) return { deg: null, calm: true, variable: false };
      if (Math.hypot(u, v) <= scale * 1e-9) return { deg: null, calm: false, variable: true };
      return { deg: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360, calm: false, variable: false };
    },
    /* Aggregate a window for every source. idx: hours for instantaneous fields; acc: hours whose
       preceding-hour accumulation falls inside (defaults to idx). opts: {rules, own(id, dv, how)}. */
    aggregate(data, ws, idx, acc, opts = {}) {
      const A = acc || idx, rules = blend.periodRules(data, opts.rules || null, idx), accRules = A===idx ? rules : blend.periodRules(data, opts.rules || null, A);
      const ids = Object.keys(data.models).filter((id) => (ws[id] || 0) > 0);
      const one = (hv, how, use, dv, only) => blend.combine(ids.filter((id) => !only || (data.models[id] && data.models[id].kind === only)).map((id) => ({ id, r: blend.sourceValue(data.models[id], hv, how, use, data, opts.own ? opts.own(id, dv, hv) : null) })), (id) => blend.w(ws, use===A ? accRules : rules, id, hv));
      /* ensemble members only (each system at its weight): a spread from ensembles alone, kept apart from the mixed-source spread */
      const eq = (hv, how, use) => { const c = one(hv, how, use, null, "ens"); return c.v == null ? null : [c.p10, c.p90]; };
      const hi = one("temperature_2m", "max", idx, "temperature_2m_max"), lo = one("temperature_2m", "min", idx, "temperature_2m_min");
      const qpf = one("precipitation", "sum", A, "precipitation_sum"), sn = one("snowfall", "sum", A, "snowfall_sum");
      const pop = one("precipitation_probability", "max", idx, "precipitation_probability_max"), gust = one("wind_gusts_10m", "max", idx, "wind_gusts_10m_max");
      const feel = one("apparent_temperature", "min", idx, null);
      /* sustained wind: same weighted combination as gusts (the hourly grids show it; nothing else reads it) */
      const wind = one("wind_speed_10m", "max", idx, null);
      const windDir = blend.windDirection(data, ids, (id) => blend.w(ws, rules, id, "wind_speed_10m"), idx);
      const srcHighs = hi.parts.map((p) => p.v);
      return {
        hi: hi.v, lo: lo.v, qpf: qpf.v, sn: sn.v, pop: pop.v, gust: gust.v, feel: feel.v, wind: wind.v, windDir: windDir.deg, windCalm: windDir.calm, windVariable: windDir.variable,
        hiR: [hi.p10, hi.p90], loR: [lo.p10, lo.p90], qpfR: [qpf.p10, qpf.p90], snR: [sn.p10, sn.p90],
        ensR: { hi: eq("temperature_2m", "max", idx), lo: eq("temperature_2m", "min", idx), qpf: eq("precipitation", "sum", A) },
        qpfBounds: qpf.bounds, snBounds: sn.bounds,
        chance: blend.ensChance(data, ids, (id) => blend.w(ws, accRules, id, "precipitation"), A, 0.01),
        parts: { hi: hi.parts, lo: lo.parts, qpf: qpf.parts, sn: sn.parts },
        prorated: qpf.parts.some((p) => p.prorated) || sn.parts.some((p) => p.prorated),
        ag: blend.agreement(srcHighs), contrib: hi.parts.map((p) => p.id),
      };
    },
    /* One model's value for a calendar day (kept for callers that need a single source). */
    modelDay(md, d, hv, dv, how, dtimes) {
      const r = blend.sourceValue(md, hv, how, d.idx, null, blend.ownDaily(md, d, dv, dtimes, hv));
      return r ? r.v : null;
    },
    /* The provider's own daily value, only when its day is the true local calendar day. */
    ownDaily(md, d, dv, dtimes, hv) {
      if (!md || md.kind || !dv || !md.d || !md.d[dv] || !dtimes) return null;
      if (hv && !stats.complete(md.h[hv], d.idx)) return null; // a model counts only with every hour of the day
      const j = dtimes.indexOf(d.k);
      const sameDay = !dtimes.labels || d.idx.every((i) => dtimes.labels[i] === dtimes.local[i]);
      return j >= 0 && sameDay ? md.d[dv][j] : null;
    },
    windowRow(data, ws, idx, acc, opts) { return blend.aggregate(data, ws, idx, acc, opts); },
    /* Comparison presets. "custom" is the user's own weights. "equal" is a raw-model consensus:
       every raw model at weight 1, NBM excluded because NBM is itself a calibrated blend of many
       of these models. "nbm" is NBM alone. NWS participates where enabled; its official periods also remain available for comparison. */
    PRESETS: {
      near48: { label: "Hi-res first 48 h", note: "Preferred base weights with HRRR/RRFS emphasis for the next 48 hours: temperatures ×2, precipitation/snow/gusts ×3, RRFS ensemble ×2 (temps ×1.5). Full boost through 36 h, fading to base at 48 h. Period weights average their hourly factors. Provisional preference, not verified skill; later guidance keeps the original recipe." },
      preferred: { label: "Your preferred weighting", note: "Brad’s ten-source default: ECMWF ENS ×4, NWS ×3, with supporting guidance. No extra temperature multiplier; preference, not verified skill." },
      custom: { label: "Custom weights", note: "Your saved models and weights." },
      equal: { label: "Equal raw consensus", note: "Every available raw model at weight 1. NBM excluded (it already blends and calibrates these models)." },
      nbm: { label: "NBM only", note: "The National Blend of Models by itself." },
    },
    PREFERRED: {
      id: "brad-default-2026-11-03-v2",
      weights: {"nws":3,"ecmwf_ens":4,"gefs":0.75,"rrfs_ens":1.25,"ecmwf_ifs025":1.25,"ecmwf_aifs025_single":1,"gfs_seamless":0.75,"ncep_nbm_conus":2,"gfs_hrrr":1.5,"ncep_rrfs_conus":1.5},
      /* Exact ten-source screenshot: no hidden variable or temperature multiplier. */
      rules: null,
    },
    presetRules(preset) { return preset === "near48" ? { near48: true } : preset === "preferred" ? blend.PREFERRED.rules : null; },
    presetWeights(preset, spec, custom) {
      if (preset === "preferred" || preset === "near48") return { ...blend.PREFERRED.weights };
      if (preset === "nbm") return { ncep_nbm_conus: 1 };
      if (preset === "equal") { const w = {}; spec.models.forEach((m) => { if (m.id !== "ncep_nbm_conus") w[m.id] = 1; }); return w; }
      return { ...custom };
    },
    /* Resolve a separate, versioned website preset. The frozen preferred recipe is unchanged. */
    CUSTOM_DEFAULTS: {
      id: "brad-scoped-temp-2026-11-05-v3",
      near: {nws:4,ecmwf_ens:3,gefs:0.75,rrfs_ens:2,ecmwf_ifs025:1,ecmwf_aifs025_single:0.75,gfs_seamless:0.5,ncep_nbm_conus:3,gfs_hrrr:3,ncep_rrfs_conus:3},
      far: {nws:3,ecmwf_ens:4,gefs:1,rrfs_ens:0.5,ecmwf_ifs025:1.25,ecmwf_aifs025_single:1,gfs_seamless:0.75,ncep_nbm_conus:2,gfs_hrrr:0,ncep_rrfs_conus:0.5},
      nearTemp: {nws:4,ecmwf_ens:4,gefs:0.75,rrfs_ens:1.5,ecmwf_ifs025:1,ecmwf_aifs025_single:1.25,gfs_seamless:0.5,ncep_nbm_conus:3,gfs_hrrr:2.5,ncep_rrfs_conus:2.5},
    },
    defaultProfiles(sources) {
      return Object.fromEntries(["near","far","nearTemp"].map(scope=>[scope,Object.fromEntries(sources.map(m=>{const w=blend.CUSTOM_DEFAULTS[scope][m.id]||0;return [m.id,{on:w>0,w:w||m.w||0}];}))]));
    },
    scopedWeights(profiles) {
      const flat=scope=>Object.fromEntries(Object.entries(scope||{}).filter(([,s])=>s.on&&Number.isFinite(s.w)&&s.w>0).map(([id,s])=>[id,s.w]));
      const near=flat(profiles.near),far=flat(profiles.far),nearTemp=profiles.nearTemp?flat(profiles.nearTemp):null,ws={};
      for(const id of new Set([...Object.keys(near),...Object.keys(far),...Object.keys(nearTemp||{})]))ws[id]=Math.max(near[id]||0,far[id]||0,nearTemp?.[id]||0);
      return {ws,rules:{periodWeights:{near,far,...(nearTemp?{nearTemp}:{})}}};
    },
    periodRules(data, rules, idx) {
      if(rules?.periodWeights&&idx.length){
        const now=rules.referenceMs||data.viewedAt||Date.now(),{near,far,nearTemp}=rules.periodWeights;
        const average=early=>Object.fromEntries([...new Set([...Object.keys(early),...Object.keys(far)])].map(id=>[id,idx.reduce((sum,i)=>sum+((data.ms[i]>=now&&data.ms[i]<now+48*3600000?early:far)[id]||0),0)/idx.length]));
        return {...rules,absoluteWeights:average(near),...(nearTemp?{absoluteByVar:{temperature_2m:average(nearTemp)}}:{})};
      }
      if (!rules?.near48 || !idx.length) return rules;
      const now = rules.referenceMs || data.viewedAt || Date.now(), byVar = { ...(rules.byVar || {}) };
      for (const v of ["temperature_2m", "apparent_temperature", "precipitation", "snowfall", "wind_gusts_10m"]) {
        const temp = ["temperature_2m", "apparent_temperature"].includes(v);
        byVar[v] = { ...(byVar[v] || {}) };
        for (const id of ["gfs_hrrr", "ncep_rrfs_conus", "rrfs_ens"]) {
          const boost = id === "rrfs_ens" ? (temp ? 1.5 : 2) : (temp ? 2 : 3);
          const factor = idx.reduce((sum,i) => { const lead=(data.ms[i]-now)/3600000; const strength=lead<0||lead>=48?0:lead<=36?1:(48-lead)/12; return sum+1+(boost-1)*strength; },0)/idx.length;
          byVar[v][id] = (byVar[v][id] || 1)*factor;
        }
      }
      return { ...rules, near48: false, byVar };
    },
    hourWeight(data, ws, rules, id, v, i) { return blend.w(ws, blend.periodRules(data, rules, [i]), id, v); },
    /* Weight of model id for variable v at lead hour L. base: {id: w}; rules (optional):
       {byVar: {v: {id: factor}}, byLead: [{maxH, factor: {id: factor}}]}. Shared by every page and
       future briefings. The near48 preset resolves its time-dependent factors before calling this helper. */
    weightFor(base, rules, id, v, leadH) {
      let w = base[id] || 0;
      if (!rules || !(w > 0)) return w;
      if (rules.byVar && rules.byVar[v] && rules.byVar[v][id] != null) w *= rules.byVar[v][id];
      if (rules.byLead && leadH != null) { const r = rules.byLead.find((x) => leadH <= x.maxH); if (r && r.factor[id] != null) w *= r.factor[id]; }
      return w;
    },
    /* Untested ideas for variable/lead weighting, recorded so they can be verified before use. */
    HYPOTHESES: [
      { id: "hrrr-short", text: "HRRR more weight in the first 18 h for precipitation timing and gusts; fade to zero by 48 h.", rules: { byLead: [{ maxH: 18, factor: { gfs_hrrr: 1.5 } }, { maxH: 48, factor: { gfs_hrrr: 0.75 } }] } },
      { id: "nbm-temps", text: "NBM more weight for 2 m temperature beyond day 2, where its bias correction helps most.", rules: { byVar: { temperature_2m: { ncep_nbm_conus: 1.5 } } } },
      { id: "ecmwf-mid", text: "ECMWF more weight days 3–7 for synoptic timing.", rules: { byLead: [{ maxH: 72, factor: {} }, { maxH: 168, factor: { ecmwf_ifs025: 1.3 } }] } },
    ],
    /* Precipitation timing per model and grouped scenarios, so different storm timings stay
       separate instead of averaging into long light precipitation. minAmt in the data's units. */
    precipScenarios(data, ws, s, e, { minAmt = 0.01, gapH = 3, ms } = {}) {
      const ids = Object.keys(ws).filter((id) => data.models[id] && ws[id] > 0);
      const at = ms || data.ms || data.times.map((_, i) => i * 3600e3);
      const models = ids.map((id) => {
        const a = data.models[id].h.precipitation; if (!a) return null;
        let on = null, off = null, tot = 0, n = 0;
        for (let i = s; i < e; i++) { if (a[i] == null) continue; n++; tot += a[i]; if (a[i] >= minAmt) { if (on == null) on = i; off = i; } }
        if (n < e - s) return { id, complete: false };
        return { id, complete: true, onset: on, end: off, total: tot };
      }).filter(Boolean);
      const wet = models.filter((m) => m.complete && m.onset != null).sort((a, b) => a.onset - b.onset);
      const groups = [];
      wet.forEach((m) => { const g = groups[groups.length - 1]; if (g && (at[m.onset] - at[g.last]) / 3600e3 < gapH) { g.items.push(m); g.last = m.onset; } else groups.push({ items: [m], last: m.onset }); });
      const scen = groups.map((g) => {
        const it = g.items, r = (k) => [Math.min(...it.map((x) => x[k])), Math.max(...it.map((x) => x[k]))];
        return { ids: it.map((x) => x.id), weight: it.reduce((t, x) => t + ws[x.id], 0), onset: r("onset").map((i) => at[i]), end: r("end").map((i) => at[i]), total: r("total") };
      });
      return { models, scenarios: scen, dry: models.filter((m) => m.complete && m.onset == null).map((m) => m.id), incomplete: models.filter((m) => !m.complete).map((m) => m.id) };
    },
    /* Daily rows for the full calendar days in data. ws: {sourceId: weight}; opts.rules: per-variable rules. */
    /* Source contributions by forecast day (point blend transparency). Uses EXACTLY the calculation
       behind dailyRows (same day groups, provider daily values and blend.aggregate), so it explains the
       displayed numbers rather than recomputing different ones. For each day and for lows, highs and
       precipitation separately:
         contributors  sources that produced a value, with effective share of that variable's weight
                       (after preset rules), usable ensemble members, and a leave-one-out effect:
                       the blend minus the same blend recomputed without that source, all else fixed
         missing       sources the recipe asks for (weight > 0) that gave no value: unavailable this
                       run, beyond their forecast horizon, no data, or partial (hours / members counted)
         changes       composition versus the previous day: sources that left or joined and share
                       changes. A dropout is never given a forecast effect here: its effect on a day it
                       has no data for cannot be calculated, so none is claimed.
       req: weights the recipe requests (before removing unavailable sources); ws: weights in use. */
    VARS: [
      { key: "lo", hv: "temperature_2m", how: "min", label: "Low" },
      { key: "hi", hv: "temperature_2m", how: "max", label: "High" },
      { key: "qpf", hv: "precipitation", how: "sum", label: "Precip" },
    ],
    horizon(md, hv) {
      if (!md) return null;
      const last = (a) => { if (!a) return -1; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return i; return -1; };
      if (md.kind === "ens") return Math.max(-1, ...md.members.map((mb) => last(mb.h[hv])));
      if (md.kind === "nws" && hv === "precipitation" && md.iv && md.iv.precipitation) return null; // NWS accumulations are intervals, not hours
      return last(md.h && md.h[hv]);
    },
    coverage(data, req, ws, opts = {}) {
      const dt = data.dtimes ? Object.assign(data.dtimes.slice(), { labels: data.labels, local: data.times }) : null;
      const rules = opts.rules || null, V = blend.VARS;
      const hz = {}; Object.keys(data.models).forEach((id) => { hz[id] = {}; ["temperature_2m", "precipitation"].forEach((hv) => { const i = blend.horizon(data.models[id], hv); hz[id][hv] = i == null ? null : i >= 0 ? data.ms[i] : -1; }); });
      const days = time.dayGroups(data.times).filter((d) => d.idx.length >= 12).map((d) => {
        const own = (id, dv, hv) => blend.ownDaily(data.models[id], d, dv, dt, hv);
        const dayRules=blend.periodRules(data,rules,d.idx);
        const full = blend.aggregate(data, ws, d.idx, d.idx, { ...opts, own });
        const cache = new Map();
        const without = (id) => { if (!cache.has(id)) { const w2 = { ...ws }; delete w2[id]; cache.set(id, Object.keys(w2).length ? blend.aggregate(data, w2, d.idx, d.idx, { ...opts, own }) : null); } return cache.get(id); };
        const vars = {};
        V.forEach((v) => {
          const parts = full.parts[v.key] || [], value = full[v.key] == null ? null : full[v.key];
          const contributors = parts.map((p) => {
            const md = data.models[p.id], wo = without(p.id), woV = wo && wo[v.key] != null ? wo[v.key] : null;
            return { id: p.id, share: p.share, v: p.v, members: md && md.kind === "ens" ? { usable: p.n, total: md.members.length } : null, prorated: !!p.prorated,
              withoutValue: woV, effect: value != null && woV != null ? value - woV : null, onlySource: parts.length === 1 };
          }).sort((a, b) => b.share - a.share);
          const have = new Set(parts.map((p) => p.id)), missing = [];
          Object.keys(req).filter((id) => blend.w(req, dayRules, id, v.hv) > 0 && !have.has(id)).forEach((id) => {
            const md = data.models[id], of = d.idx.length;
            if (!md) { missing.push({ id, reason: "unavailable", detail: "no data returned this run" }); return; }
            if (!(blend.w(ws, dayRules, id, v.hv) > 0)) { missing.push({ id, reason: "excluded", detail: "not used for this variable" }); return; }
            if (md.kind === "ens") {
              const some = md.members.filter((mb) => mb.h[v.hv] && d.idx.some((i) => mb.h[v.hv][i] != null)).length;
              const start = data.ms[d.idx[0]], end = hz[id][v.hv];
              missing.push(some ? { id, reason: "partial", detail: `no member covers the whole day (${some} of ${md.members.length} have some hours)` }
                : end != null && end >= 0 && end < start ? { id, reason: "beyond-horizon", detail: "forecast ends before this day" } : { id, reason: "no-data", detail: "no values for this day" });
              return;
            }
            if (md.kind === "nws" && v.hv === "precipitation" && md.iv && md.iv.precipitation) { missing.push({ id, reason: "no-data", detail: "NWS precipitation intervals do not cover this day" }); return; }
            const a = md.h && md.h[v.hv], k = a ? d.idx.filter((i) => a[i] != null).length : 0, end = hz[id][v.hv], start = data.ms[d.idx[0]];
            missing.push(k ? { id, reason: "partial", detail: `${k} of ${of} hours`, hours: k, of }
              : end != null && end >= 0 && end < start ? { id, reason: "beyond-horizon", detail: "forecast ends before this day" } : { id, reason: "no-data", detail: "no values for this day" });
          });
          vars[v.key] = { value, contributors, missing, totalShare: parts.reduce((s, p) => s + p.share, 0) };
        });
        return { k: d.k, win: time.windowKey(data.times, d.idx), hours: d.idx.length, vars };
      });
      /* composition change versus the previous day (no causal claim) */
      days.forEach((day, i) => {
        const prev = days[i - 1]; day.changes = {};
        V.forEach((v) => {
          if (!prev) { day.changes[v.key] = null; return; }
          const a = new Map(prev.vars[v.key].contributors.map((c) => [c.id, c.share])), b = new Map(day.vars[v.key].contributors.map((c) => [c.id, c.share]));
          const left = [...a.keys()].filter((id) => !b.has(id)), joined = [...b.keys()].filter((id) => !a.has(id));
          const shifts = [...b.keys()].filter((id) => a.has(id)).map((id) => ({ id, from: a.get(id), to: b.get(id) })).filter((x) => Math.abs(x.to - x.from) >= 0.005);
          day.changes[v.key] = { left, joined, shifts, changed: left.length > 0 || joined.length > 0 };
        });
      });
      const horizons = Object.fromEntries(Object.entries(hz).map(([id, h]) => [id, { temperature: h.temperature_2m > 0 ? h.temperature_2m : null, precipitation: h.precipitation > 0 ? h.precipitation : null }]));
      return { days, horizons };
    },
    dailyRows(data, ws, opts = {}) {
      const dt = data.dtimes ? Object.assign(data.dtimes.slice(), { labels: data.labels, local: data.times }) : null;
      return time.dayGroups(data.times).filter((d) => d.idx.length >= 12).map((d) => {
        const own = (id, dv, hv) => blend.ownDaily(data.models[id], d, dv, dt, hv);
        const r = blend.aggregate(data, ws, d.idx, d.idx, { ...opts, own });
        return { k: d.k, win: time.windowKey(data.times, d.idx), hours: d.idx.length, ...r };
      });
    },
  };

  /* ======================= thunder ======================= */
  const thunder = {
    isThunderCode: (c) => c != null && c >= 95 && c <= 99,
    /* Signal and data completeness, kept separate. frac: weighted share of models with a thunder code. */
    assess(frac, cape, pop) {
      const missing = [];
      if (frac == null) missing.push("thunder codes");
      if (cape == null) missing.push("CAPE");
      if (pop == null) missing.push("precip chance");
      if (frac == null && cape == null) return { tier: "nodata", limited: true, missing };
      const f = frac || 0, c = cape == null ? 0 : cape, p = pop == null ? 0 : pop;
      const tier = f >= 0.5 && (cape == null || c >= 250) ? "action"
        : f >= 0.25 || (c >= 1000 && p >= 40) ? "prepare"
        : f > 0 || (c >= 250 && p >= 20) ? "monitor" : "normal";
      return { tier, limited: missing.length > 0, missing };
    },
    /* 10 m to 500 hPa vector wind difference, mph in, knots out. */
    shear500(s1, d1, s2, d2) {
      if ([s1, d1, s2, d2].some((x) => x == null)) return null;
      const a = severe.uv(s1, d1), b = severe.uv(s2, d2);
      return Math.hypot(b.u - a.u, b.v - a.v) * 0.868976;
    },
    /* Hourly blend for data loaded with config.thunder. ws: {modelId: weight}. */
    hourly(data, ws) {
      const ids = Object.keys(ws).filter((id) => data.models[id] && ws[id] > 0), n = data.times.length;
      ids.forEach((id) => { const h = data.models[id].h; if (!h.shear) h.shear = data.times.map((_, i) => thunder.shear500(h.wind_speed_10m && h.wind_speed_10m[i], h.wind_direction_10m && h.wind_direction_10m[i], h.wind_speed_500hPa && h.wind_speed_500hPa[i], h.wind_direction_500hPa && h.wind_direction_500hPa[i])); });
      const B = (v) => stats.blendSeries(ids.filter((id) => stats.hasData(data.models[id].h[v])).map((id) => ({ w: ws[id], data: data.models[id].h[v] })), n);
      const cape = B("cape"), pop = B("precipitation_probability"), li = B("lifted_index"), sh = B("shear");
      const wc = ids.filter((id) => stats.hasData(data.models[id].h.weather_code));
      const frac = data.times.map((_, i) => stats.weightedShare(wc.map((id) => data.models[id].h.weather_code[i]), wc.map((id) => ws[id]), thunder.isThunderCode));
      const assess = frac.map((f, i) => thunder.assess(f, cape.mean[i], pop.mean[i]));
      const perModel = {};
      ids.forEach((id) => { const h = data.models[id].h; perModel[id] = data.times.map((_, i) => {
        const c = h.weather_code ? h.weather_code[i] : null;
        return thunder.assess(c == null ? null : thunder.isThunderCode(c) ? 1 : 0, h.cape ? h.cape[i] : null, h.precipitation_probability ? h.precipitation_probability[i] : null);
      }); });
      return { ids, frac, cape, pop, li, sh, assess, perModel };
    },
  };

  /* ======================= severe ======================= */
  const MS = 0.514444;          // knots -> m/s
  const BUNKERS_KT = 7.5 / MS;  // 7.5 m/s deviation, in knots
  function at(pts, key, h) {
    const ok = pts.filter((p) => p[key] != null);
    if (!ok.length || h > ok[ok.length - 1].h + 1) return null;
    if (h <= ok[0].h) return ok[0][key];
    for (let k = 0; k < ok.length - 1; k++) {
      const a = ok[k], b = ok[k + 1];
      if (h >= a.h && h <= b.h) return a[key] + ((b[key] - a[key]) * (h - a.h)) / (b.h - a.h);
    }
    return null;
  }
  const windAt = (pts, h) => { const u = at(pts, "u", h), v = at(pts, "v", h); return u == null || v == null ? null : { u, v }; };
  function layerMean(pts, h0, h1, step = 250) {
    let u = 0, v = 0, n = 0;
    for (let h = h0; h <= h1 + 1e-6; h += step) { const w = windAt(pts, h); if (!w) return null; u += w.u; v += w.v; n++; }
    return { u: u / n, v: v / n };
  }
  const SEVERE_NEEDS = { bs6: "0–6 km shear", srh1: "0–1 km SRH", srh3: "0–3 km SRH", lcl: "LCL" };
  const severe = {
    LEVELS,
    KEYS: ["cape", "cin", "bs1", "bs6", "srh1", "srh3", "lr75", "lr03", "lcl", "frz", "stp", "scp", "mw6", "thunder"],
    uv: (s, d) => ({ u: -s * Math.sin((d * Math.PI) / 180), v: -s * Math.cos((d * Math.PI) / 180) }),
    mag: (a) => Math.hypot(a.u, a.v),
    fromDir: (a) => ((Math.atan2(-a.u, -a.v) * 180) / Math.PI + 360) % 360,
    at, windAt,
    sounding(a, i, elev) {
      const s10 = a.wind_speed_10m && a.wind_speed_10m[i], d10 = a.wind_direction_10m && a.wind_direction_10m[i];
      if (s10 == null || d10 == null) return null;
      const pts = [{ h: 10, ...severe.uv(s10, d10), t: a.temperature_2m ? a.temperature_2m[i] : null, p: null }];
      for (const p of LEVELS) {
        const zA = a[`geopotential_height_${p}hPa`], z = zA && zA[i];
        if (z == null) continue;
        const h = z - elev;
        if (h <= 30) continue; // below ground here
        const s = a[`wind_speed_${p}hPa`] && a[`wind_speed_${p}hPa`][i], d = a[`wind_direction_${p}hPa`] && a[`wind_direction_${p}hPa`][i];
        const w = s != null && d != null ? severe.uv(s, d) : { u: null, v: null };
        pts.push({ h, u: w.u, v: w.v, t: a[`temperature_${p}hPa`] ? a[`temperature_${p}hPa`][i] : null, p });
      }
      pts.sort((x, y) => x.h - y.h);
      return pts;
    },
    bunkers(pts) {
      const mean = layerMean(pts, 0, 6000), lo = layerMean(pts, 0, 500), hi = layerMean(pts, 5500, 6000);
      if (!mean || !lo || !hi) return null;
      const s = { u: hi.u - lo.u, v: hi.v - lo.v }, m = severe.mag(s);
      if (m < 1e-6) return { rm: mean, lm: mean, mean };
      const k = BUNKERS_KT / m;
      return { rm: { u: mean.u + k * s.v, v: mean.v - k * s.u }, lm: { u: mean.u - k * s.v, v: mean.v + k * s.u }, mean };
    },
    srh(pts, top, sm) {
      let tot = 0, prev = windAt(pts, 0);
      if (!prev) return null;
      for (let h = 100; h <= top; h += 100) {
        const w = windAt(pts, h); if (!w) return null;
        tot += ((w.u - sm.u) * (prev.v - sm.v) - (prev.u - sm.u) * (w.v - sm.v)) * MS * MS;
        prev = w;
      }
      return tot;
    },
    bulk(pts, h) { const a = windAt(pts, 0), b = windAt(pts, h); return a && b ? Math.hypot(b.u - a.u, b.v - a.v) : null; },
    stp(cape, lcl, srh1, bs6kt) {
      if ([cape, lcl, srh1, bs6kt].some((x) => x == null)) return null;
      const lclT = lcl < 1000 ? 1 : lcl > 2000 ? 0 : (2000 - lcl) / 1000;
      const b = bs6kt * MS, shT = b < 12.5 ? 0 : b > 30 ? 1.5 : b / 20;
      return Math.max(0, (cape / 1500) * lclT * (srh1 / 150) * shT);
    },
    scp(cape, srh3, bs6kt) {
      if ([cape, srh3, bs6kt].some((x) => x == null)) return null;
      const b = bs6kt * MS, shT = b < 10 ? 0 : b > 20 ? 1 : b / 20;
      return Math.max(0, (cape / 1000) * (srh3 / 50) * shT);
    },
    indices(a, i, elev) {
      const pts = severe.sounding(a, i, elev);
      const cape = a.cape ? a.cape[i] : null, cin = a.convective_inhibition ? a.convective_inhibition[i] : null;
      const T = a.temperature_2m ? a.temperature_2m[i] : null, Td = a.dew_point_2m ? a.dew_point_2m[i] : null;
      const lcl = T != null && Td != null ? Math.max(0, 125 * (T - Td)) : null;
      const code = a.weather_code ? a.weather_code[i] : null;
      const out = { cape, cin, lcl, thunder: code == null ? null : thunder.isThunderCode(code) ? 1 : 0, bs1: null, bs6: null, mw6: null, srh1: null, srh3: null, lr75: null, lr03: null, frz: null, stp: null, scp: null };
      if (pts) {
        const bk = severe.bunkers(pts);
        out.bs1 = severe.bulk(pts, 1000); out.bs6 = severe.bulk(pts, 6000);
        out.mw6 = bk ? severe.mag(bk.mean) : null;
        out.srh1 = bk ? severe.srh(pts, 1000, bk.rm) : null;
        out.srh3 = bk ? severe.srh(pts, 3000, bk.rm) : null;
        const p7 = pts.find((p) => p.p === 700), p5 = pts.find((p) => p.p === 500);
        out.lr75 = p7 && p5 && p7.t != null && p5.t != null ? (p7.t - p5.t) / ((p5.h - p7.h) / 1000) : null;
        const t3 = at(pts, "t", 3000);
        out.lr03 = T != null && t3 != null ? (T - t3) / 3 : null;
        let frz = a.freezing_level_height ? a.freezing_level_height[i] : null;
        if (frz == null) for (let k = 0; k < pts.length - 1; k++) {
          const x = pts[k], y = pts[k + 1];
          if (x.t != null && y.t != null && x.t >= 0 && y.t < 0) { frz = x.h + ((y.h - x.h) * x.t) / (x.t - y.t) + elev; break; }
        }
        out.frz = frz == null ? null : frz * 3.28084; // ft MSL
      }
      out.stp = severe.stp(cape, lcl, out.srh1, out.bs6);
      out.scp = severe.scp(cape, out.srh3, out.bs6);
      return out;
    },
    /* Index arrays for one model's hourly data. */
    series(h, n, elev) {
      const rows = Array.from({ length: n }, (_, i) => severe.indices(h, i, elev));
      const out = {};
      severe.KEYS.forEach((k) => (out[k] = rows.map((x) => (x[k] == null || !isFinite(x[k]) ? null : x[k]))));
      return out;
    },
    /* Signal from what's available, plus a separate completeness flag listing what's missing. */
    assess(x) {
      if (!x || x.cape == null) return { tier: "nodata", limited: true, missing: ["CAPE"] };
      const missing = Object.keys(SEVERE_NEEDS).filter((k) => x[k] == null).map((k) => SEVERE_NEEDS[k]);
      const c = x.cape;
      const tier = c < 100 ? "normal"
        : (x.stp != null && x.stp >= 1) || (x.scp != null && x.scp >= 4) ? "action"
        : (x.scp != null && x.scp >= 1) || (c >= 1000 && x.bs6 != null && x.bs6 >= 40) ? "prepare"
        : c >= 500 && x.bs6 != null && x.bs6 >= 25 ? "monitor" : "normal";
      return { tier, limited: missing.length > 0, missing };
    },
    /* Ingredient flags; a flag needs every one of its inputs present. */
    flags(x) {
      const f = [], has = (...k) => k.every((n) => x[n] != null);
      if (has("cape", "lr75", "bs6") && x.cape >= 1000 && x.lr75 >= 7 && x.bs6 >= 30) f.push("HAIL");
      if (x.cape != null && x.cape >= 500 && ((x.lr03 != null && x.lr03 >= 8) || (x.mw6 != null && x.mw6 >= 35))) f.push("WIND");
      if (has("cape", "srh1", "lcl", "bs6") && x.cape >= 250 && x.srh1 >= 100 && x.lcl <= 1250 && x.bs6 >= 30) f.push("TOR");
      return f;
    },
  };

  /* ======================= winter ======================= */
  const winter = {
    THRESH: [0.1, 1, 2, 4, 6, 8, 12],
    /* Weighted members from loaded ensemble data. ws: {ensembleId: weight}. kind: "snowfall" | "temperature_2m" */
    members(data, ws, kind = "snowfall") {
      const out = [];
      Object.keys(ws).forEach((id) => {
        const e = data.ens[id]; if (!e || !(ws[id] > 0)) return;
        const arrs = e[kind] || []; if (!arrs.length) return;
        arrs.forEach((a) => out.push({ id, w: ws[id] / arrs.length, a }));
      });
      return out;
    },
    /* Stats for [s, e). Only members with EVERY hour count toward odds and percentiles. Members
       with gaps report a lower bound ("at least") and never decide a threshold either way. */
    windowStats(members, s, e) {
      const len = e - s;
      const sums = members.map((m) => { let t = 0, n = 0; for (let i = s; i < e; i++) if (m.a[i] != null) { t += m.a[i]; n++; } return { t, n }; });
      const tot = sums.map((x) => (len > 0 && x.n === len ? x.t : null));
      const lower = sums.map((x) => (x.n > 0 && x.n < len ? x.t : null));
      const ws = members.map((m) => m.w);
      const P = {}, partialAtLeast = {};
      winter.THRESH.forEach((t) => { P[t] = stats.weightedShare(tot, ws, (v) => v >= t); partialAtLeast[t] = lower.filter((v) => v != null && v >= t).length; });
      return {
        tot, lower, P, partialAtLeast, total: members.length,
        used: tot.filter((x) => x != null).length, partial: lower.filter((x) => x != null).length,
        p10: stats.weightedQuantile(tot, ws, 0.1), p50: stats.weightedQuantile(tot, ws, 0.5), p90: stats.weightedQuantile(tot, ws, 0.9),
      };
    },
    tier(st) {
      if (!st || !st.used) return "nodata";
      const p01 = st.P[0.1] || 0, p1 = st.P[1] || 0, p4 = st.P[4] || 0;
      if (p4 >= 0.5) return "action";
      if (p1 >= 0.4 || p4 >= 0.2) return "prepare";
      if (p1 >= 0.1 || p01 >= 0.3) return "monitor";
      return "normal";
    },
    /* ---------- interpreted read: how much, what could stick, and when ----------
       A qualitative assessment from the guidance the page already loads. There is no pavement temperature, no bridge-deck
       guidance and no observed snow depth here, so nothing below is a pavement accumulation amount; surfaces get a level
       (unlikely / possible / favored) with the reasons. The rules combine air temperature, wet-bulb, snowfall rate, how
       long it has been at or below freezing, and modeled ground (0 cm soil) temperature where a model provides it. They
       are documented rules of thumb, not a calibrated model; STICK holds every threshold so the page can show them.
       hours: [{ms, inWin, snow50, snow90, t50, det: [{type, t2F, twF, soilC, snowIn}]}] in time order (hours before the
       window feed the "cold for how long" count). st: windowStats for the window (or null when ensembles are missing). */
    STICK: { snowyRate: 0.02, burstRate: 0.5, heavyRate: 1.0, grassMildT: 34, grassWarmT: 36, pavedColdT: 30, pavedSoakH: 6, pavedShortSoakH: 3, warmSoilC: 2 },
    /* the hours stickRead reads, built the same way for the Winter page and the Event Manager: ensemble median and
       90th-percentile hourly snowfall and median temperature (members weighted {w, a}), plus each deterministic model's
       type, temperatures, ground and snowfall aligned by time. ms: the ensemble's hourly instants; [s, e) the window;
       lead: hours before s that feed the "cold for how long" count. det: {ms, rows: {id: W.series rows}} or null. */
    readHours({ ms, snow = [], temp = [], det = null, ids = [], s, e, lead = 12 }) {
      const a = Math.max(0, s - lead), n = e - a;
      const q = (mem, k, qq) => { const ws = mem.map((m) => m.w); return stats.weightedQuantile(mem.map((m) => m.a[k]), ws, qq); };
      const detIdx = det ? new Map(det.ms.map((m, i) => [m, i])) : null, use = det ? ids.filter((id) => det.rows[id]) : [];
      const out = [];
      for (let k = 0; k < n; k++) {
        const i = a + k, j = detIdx ? detIdx.get(ms[i]) : undefined;
        out.push({ ms: ms[i], inWin: i >= s, snow50: snow.length ? q(snow, i, 0.5) ?? null : null, snow90: snow.length ? q(snow, i, 0.9) ?? null : null, t50: temp.length ? q(temp, i, 0.5) ?? null : null,
          det: j == null ? [] : use.map((id) => { const r = det.rows[id][j]; return { type: r.wet ? r.codeType || r.split : "none", t2F: r.t2F, twF: r.twF, soilC: r.soilC, snowIn: r.snowIn }; }) });
      }
      return out;
    },
    stickRead(hours, st) {
      const K = winter.STICK, mean = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
      const win = hours.filter((h) => h.inWin), missing = [];
      const amount = st && st.used ? (() => {
        const pAny = st.P[0.1] || 0, agree = Math.max(pAny, 1 - pAny), share = st.used / st.total, spread = st.p90 - st.p10;
        const conf = share < 0.6 || agree < 0.6 ? "low" : agree >= 0.8 && spread <= Math.max(1, st.p50) ? "high" : "moderate";
        const why = share < 0.6 ? `only ${st.used} of ${st.total} members cover the whole window` : agree < 0.6 ? "members split on whether any measurable snow falls"
          : spread > Math.max(1, st.p50) ? `wide spread between members (${st.p10.toFixed(1)}" to ${st.p90.toFixed(1)}")` : agree >= 0.8 ? "members largely agree" : "members partly agree";
        return { p50: st.p50, p90: st.p90, p10: st.p10, pAny, p1: st.P[1] || 0, used: st.used, total: st.total, conf, why };
      })() : null;
      if (!amount) missing.push("ensemble snowfall");
      const hasDet = win.some((h) => h.det && h.det.length), hasTw = win.some((h) => h.det && h.det.some((d) => d.twF != null)), hasSoil = win.some((h) => h.det && h.det.some((d) => d.soilC != null));
      if (!hasDet) missing.push("model precipitation type, wet-bulb and ground temperature");
      else { if (!hasTw) missing.push("wet-bulb temperature"); if (!hasSoil) missing.push("modeled ground temperature"); }
      /* per hour: consensus snowfall rate, temperature, wet-bulb, ground, model type shares, and hours at or below 32 so far */
      let cold = 0;
      const H = hours.map((h) => {
        const d = h.det || [], wet = d.filter((x) => x.type && x.type !== "none");
        const T = h.t50 != null ? h.t50 : mean(d.map((x) => x.t2F)), r = h.snow50 != null ? h.snow50 : mean(d.map((x) => x.snowIn));
        cold = T != null && T <= 32 ? cold + 1 : 0;
        const snowShare = wet.length ? wet.filter((x) => x.type === "snow" || x.type === "mix").length / wet.length : null, rainShare = wet.length ? wet.filter((x) => x.type === "rain" || x.type === "freezing").length / wet.length : null;
        const snowy = r != null && r >= K.snowyRate;
        return { ms: h.ms, inWin: h.inWin, T, r, Tw: mean(d.map((x) => x.twF)), soil: mean(d.map((x) => x.soilC)), snowShare, rainShare, wetModels: wet.length, coldH: cold, snowy,
          type: !wet.length ? null : snowShare >= 0.5 ? "snow" : "rain" };
      });
      const W2 = H.filter((h) => h.inWin), snowyH = W2.filter((h) => h.snowy && h.T != null);
      const grassAt = (h) => {
        if (h.T > K.grassWarmT || (h.T > K.grassMildT && h.r < 0.2 && (h.Tw == null || h.Tw > 32))) return 0;
        let lv = (h.T <= 32 && (h.Tw == null || h.Tw <= 32)) || (h.T <= K.grassMildT && h.r >= K.burstRate) ? 2 : 1;
        if (lv === 2 && h.soil != null && h.soil > K.warmSoilC && h.r < 0.3) lv = 1;   // mild ground melts light snow
        return lv;
      };
      const pavedAt = (h) => {
        const groundOk = h.soil == null || h.soil <= 0;
        if ((h.T <= K.pavedColdT && h.coldH >= K.pavedSoakH && groundOk) || (h.T <= 32 && h.r >= K.heavyRate && h.coldH >= K.pavedShortSoakH)) return 2;
        if ((h.T <= 32 && (h.r >= K.burstRate || h.coldH >= K.pavedSoakH)) || (h.T <= 33 && h.r >= K.heavyRate)) return 1;
        return 0;
      };
      const LV = ["unlikely", "possible", "favored"];
      const surface = (fn) => {
        if (!snowyH.length) return { level: "none", hours: 0, snow: 0 };
        const lv = snowyH.map(fn), fav = snowyH.filter((h, i) => lv[i] === 2), pos = snowyH.filter((h, i) => lv[i] >= 1);
        const sum = (a) => a.reduce((t, h) => t + h.r, 0);
        const level = fav.length >= 2 || sum(fav) >= 0.3 ? "favored" : pos.length && sum(pos) >= 0.1 ? "possible" : "unlikely";
        return { level, hours: pos.length, favHours: fav.length, snow: sum(pos), byHour: lv };
      };
      const grass = surface(grassAt), paved = surface(pavedAt);
      /* drivers: plain-language reasons, in order of importance */
      const drivers = [];
      if (snowyH.length) {
        const Ts = snowyH.map((h) => h.T), tMin = Math.min(...Ts), tMax = Math.max(...Ts), rMax = Math.max(...snowyH.map((h) => h.r));
        const rg = (a, b) => (Math.round(a) === Math.round(b) ? `${Math.round(a)}` : `${Math.round(a)}–${Math.round(b)}`);
        drivers.push(`Air temperature during the snow: ${rg(tMin, tMax)}°F`);
        const tws = snowyH.map((h) => h.Tw).filter((x) => x != null); if (tws.length) drivers.push(`Wet-bulb ${rg(Math.min(...tws), Math.max(...tws))}°F (at or below 32°F helps snow reach the ground and stick)`);
        drivers.push(`Heaviest hourly rate about ${rMax.toFixed(rMax < 0.1 ? 2 : 1)}" per hour${rMax >= K.burstRate ? " (heavy enough to overcome some melting)" : rMax < 0.1 ? " (light: melts quickly on anything above freezing)" : ""}`);
        const maxCold = Math.max(...snowyH.map((h) => h.coldH)); drivers.push(maxCold ? `Up to ${maxCold} hour${maxCold > 1 ? "s" : ""} in a row at or below 32°F by the time snow falls` : "No stretch at or below 32°F while snow falls");
        const soils = snowyH.map((h) => h.soil).filter((x) => x != null); if (soils.length) drivers.push(`Modeled ground surface ${rg(Math.min(...soils) * 9 / 5 + 32, Math.max(...soils) * 9 / 5 + 32)}°F (ECMWF, ICON, UKMO only)`);
      }
      /* when: snowy hours where grass sticking is at least possible, grouped into ranges */
      const ranges = []; snowyH.forEach((h, i) => { if (grass.byHour[i] < 1) return; const last = ranges[ranges.length - 1]; if (last && h.ms - last.e <= 2 * 3600e3) { last.e = h.ms; last.snow += h.r; } else ranges.push({ s: h.ms, e: h.ms, snow: h.r }); });
      /* call-outs: a rain-to-snow change, a drop through freezing during precipitation, a heavy burst, mild ground at the start */
      const callouts = [];
      const typed = W2.filter((h) => h.type); for (let i = 1; i < typed.length; i++) if (typed[i - 1].type === "rain" && typed[i].type === "snow") { callouts.push({ kind: "transition", ms: typed[i].ms, text: "Models change rain to snow" }); break; }
      for (let i = 1; i < W2.length; i++) { const a = W2[i - 1], b = W2[i]; if (a.T != null && b.T != null && a.T > 32 && b.T <= 32 && W2.slice(Math.max(0, i - 3), i + 4).some((h) => h.snowy || h.wetModels)) { callouts.push({ kind: "cooling", ms: b.ms, text: "Temperature falls to 32°F during the precipitation" }); break; } }
      if (snowyH.length) { const pk = snowyH.reduce((a, h) => (h.r > a.r ? h : a)); if (pk.r >= K.burstRate) callouts.push({ kind: "burst", ms: pk.ms, text: `Heaviest burst, about ${pk.r.toFixed(1)}" per hour: rates like this can overcome melting` }); }
      if (snowyH.length && snowyH[0].soil != null && snowyH[0].soil > K.warmSoilC) callouts.push({ kind: "warmground", ms: snowyH[0].ms, text: `Ground still mild (about ${Math.round(snowyH[0].soil * 9 / 5 + 32)}°F modeled) when snow starts: early snow melts on contact` });
      callouts.sort((a, b) => a.ms - b.ms);
      /* conflicting guidance: models split on type during the snowy hours, or ensemble snow with every model raining */
      const split = snowyH.filter((h) => h.wetModels >= 2 && h.snowShare >= 0.34 && h.rainShare >= 0.34).length;
      const conflict = !snowyH.length ? null : split >= Math.max(2, snowyH.length / 3) ? "Models split between rain and snow for much of the snow window"
        : hasDet && snowyH.every((h) => h.wetModels && h.snowShare === 0) ? "Ensemble members show snow but every deterministic model shows rain" : null;
      const dry = amount ? amount.pAny < 0.1 && (amount.p90 == null || amount.p90 < 0.1) : !snowyH.length;
      /* without ensemble amounts, "no snow" needs the deterministic models' own snowfall; temperatures alone can't say it stays dry */
      const status = !amount && (!hasDet || !W2.some((h) => h.T != null)) ? "nodata" : dry ? "dry" : "snow";
      return { status, amount, grass: { ...grass, word: LV[["unlikely", "possible", "favored"].indexOf(grass.level)] || grass.level }, paved: { ...paved, word: paved.level },
        drivers, ranges, callouts, conflict, missing, snowyHours: snowyH.length };
    },
    /* Per calendar day stats (full days in the data, or clipped to [s, e) when given). */
    dayRows(times, members, s = 0, e = times.length) {
      return time.dayGroups(times, s, e).map((d) => ({ k: d.k, idx: d.idx, win: time.windowKey(times, d.idx), hours: d.idx.length, st: winter.windowStats(members, d.idx[0], d.idx[d.idx.length - 1] + 1) }));
    },
  };

  /* ======================= change tracking ======================= */
  /* Snapshots: {at, cfg, rows: {key: {label, win, contrib[], ...fields}}}.
     Rows are only compared when they cover the same valid window; contributor and
     settings changes are reported so a "change" is never just a different recipe. */
  const changes = {
    diff(prev, cur, spec) {
      /* items: forecast changes made with the same recipe. affected: differences on rows where the
         settings or contributing models changed; they are shown apart and must never be treated as
         a forecast change (e.g. by an alert). */
      const out = { items: [], affected: [], skipped: [], contribChanged: [], cfgChanged: !!(prev && cur && prev.cfg !== cur.cfg) };
      if (!prev || !cur) return out;
      Object.keys(cur.rows).forEach((k) => {
        const a = prev.rows[k], b = cur.rows[k];
        if (!a) return;
        if (a.win !== b.win) { out.skipped.push(b.label); return; }
        const ac = (a.contrib || []).slice().sort().join(","), bc = (b.contrib || []).slice().sort().join(",");
        const bucket = out.cfgChanged || ac !== bc ? out.affected : out.items;
        if (ac !== bc) out.contribChanged.push({ label: b.label, added: (b.contrib || []).filter((x) => !(a.contrib || []).includes(x)), removed: (a.contrib || []).filter((x) => !(b.contrib || []).includes(x)) });
        spec.forEach((f) => {
          const x = a[f.k], y = b[f.k];
          if (x == null || y == null) return;
          if (f.tier) { if (x !== y && TIERS[x] && TIERS[y]) bucket.push({ label: b.label, field: f.label, from: TIERS[x].word, to: TIERS[y].word, up: TIERS[y].rank > TIERS[x].rank }); return; }
          const d = y - x; if (Math.abs(d) < f.min) return;
          bucket.push({ label: b.label, field: f.label, from: f.fmt ? f.fmt(x) : x, to: f.fmt ? f.fmt(y) : y, up: d > 0 });
        });
      });
      return out;
    },
  };

  /* ======================= events ======================= */
  /* Event record: {id, name, loc: {name, lat, lon}, tz, times: {setup, gates, start, end, teardown}}
     Times are local wall-clock "YYYY-MM-DDTHH:MM" in the event's own time zone. start and end are
     required; setup, gates and teardown are optional and their phases are omitted when blank. */
  const event = {
    PHASES: [
      { key: "setup", label: "Setup", from: "setup", to: ["gates", "start"] },
      { key: "gates", label: "Gates", from: "gates", to: ["start"] },
      { key: "event", label: "Event", from: "start", to: ["end"] },
      { key: "teardown", label: "Teardown", from: "end", to: ["teardown"] },
    ],
    newId: () => "ev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    /* Problems that make the event unusable; [] when valid. */
    validate(ev) {
      const e = [], t = (ev && ev.times) || {}, okFmt = (x) => !x || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x);
      if (!ev || !ev.loc || !isFinite(ev.loc.lat) || !isFinite(ev.loc.lon)) e.push("Pick a location.");
      if (!ev || !ev.tz) e.push("The location's time zone is unknown.");
      if (event.hasSlots(ev)) return e.length ? e : event.validateSlots(ev);
      if (!t.start || !t.end) e.push("Event start and end are required.");
      Object.keys(t).forEach((k) => { if (!okFmt(t[k])) e.push(`${k} time is not valid.`); });
      if (e.length) return e;
      const ms = {}, fold = ev.fold || {};
      for (const k of ["setup", "gates", "start", "end", "teardown"]) {
        if (!t[k]) continue;
        const c = time.classify(t[k], ev.tz);
        if (c.kind === "nonexistent") { e.push(`${k} ${t[k].slice(11)} doesn't exist that day (clocks jump forward). Pick a time outside the skipped hour.`); continue; }
        if (c.kind === "ambiguous" && fold[k] !== 0 && fold[k] !== 1) { e.push(`${k} ${t[k].slice(11)} happens twice that night (clocks fall back). Choose which one.`); continue; }
        ms[k] = time.toUtc(t[k], ev.tz, fold[k] || 0);
      }
      if (e.length) return e;
      const order = ["setup", "gates", "start", "end", "teardown"].filter((k) => ms[k] != null);
      for (let i = 1; i < order.length; i++) if (ms[order[i]] < ms[order[i - 1]]) e.push(`${order[i]} is before ${order[i - 1]}.`);
      if (ms.end <= ms.start) e.push("Event end must be after start.");
      if (ms.teardown != null && ms.teardown - ms.setup > 0 && (ms.teardown || ms.end) - (ms.setup || ms.start) > 7 * 86400e3) e.push("Events longer than 7 days aren't supported.");
      return e;
    },
    validateSlots(ev) {
      const e = [], okFmt = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x);
      if (ev.slots.length > 24) e.push("An event can have up to 24 time slots.");
      const ms = [];
      ev.slots.forEach((x, i) => {
        const n = String((x && x.name) || "").trim() || `Slot ${i + 1}`;
        if (!x || !String(x.name || "").trim()) e.push(`Slot ${i + 1} needs a name.`);
        if (!okFmt(x && x.start) || !okFmt(x && x.end)) { e.push(`${n}: start and end need a date and time.`); return; }
        const r = {};
        for (const k of ["start", "end"]) { const c = time.classify(x[k], ev.tz); if (c.kind === "nonexistent") { e.push(`${n} ${k} ${x[k].slice(11)} doesn't exist that day (clocks jump forward). Pick a time outside the skipped hour.`); return; } r[k] = time.toUtc(x[k], ev.tz, (x.fold || {})[k] || 0); }
        if (!(r.end > r.start)) e.push(`${n} must end after it starts.`);
        ms.push(r);
      });
      if (!e.length && ms.length && Math.max(...ms.map((r) => r.end)) - Math.min(...ms.map((r) => r.start)) > 7 * 86400e3) e.push("Events longer than 7 days aren't supported.");
      return e;
    },
    /* Phase windows as real instants [startMs, endMs). An event with planner-defined slots (ev.slots) gets one window
       per slot, in time order, named as the planner named it; the main slot (event.mainOf) takes the key "event" so
       everything that leads with the main part keeps working. Without slots the fixed parts are read exactly as before.
       "all" spans the first start to the last end; all.spans lists the hours the event actually uses (the union of
       its windows): one span for the fixed parts, several when slots leave gaps. */
    windows(ev) {
      if (event.hasSlots(ev)) return event.slotWindows(ev);
      const t = ev.times, out = [];
      event.PHASES.forEach((p) => {
        if (!t[p.from]) return;
        const toKey = p.to.find((k) => t[k]); if (!toKey) return;
        const fold = ev.fold || {}, s = time.toUtc(t[p.from], ev.tz, fold[p.from] || 0), e = time.toUtc(t[toKey], ev.tz, fold[toKey] || 0);
        if (e > s) out.push({ key: p.key, label: p.label, startMs: s, endMs: e, startLocal: time.toLocal(s, ev.tz), endLocal: time.toLocal(e, ev.tz), hours: (e - s) / 3600e3 });
      });
      const all = out.length ? { key: "all", label: "Whole event", startMs: out[0].startMs, endMs: out[out.length - 1].endMs } : null;
      if (all) { all.startLocal = time.toLocal(all.startMs, ev.tz); all.endLocal = time.toLocal(all.endMs, ev.tz); all.hours = (all.endMs - all.startMs) / 3600e3; all.spans = event.union(out); out.push(all); }
      return out;
    },
    /* ---- planner-defined slots: ev.slots = [{ id, name, start, end, main?, fold? }] ----
       start/end are venue-local "YYYY-MM-DDTHH:MM" (end may be the next day); fold {start, end} picks the second of a
       time that happens twice on a fall-back night (first otherwise). ev.times then only carries the outer start and
       end ({start, end}), so builds without slots still read the event as one window. */
    LEGACY_LABELS: ["Setup", "Gates", "Event", "Teardown"],
    hasSlots: (ev) => !!(ev && Array.isArray(ev.slots) && ev.slots.length),
    /* the slot that leads the headline: the one marked main; else the one named "Event"; else the longest slot that
       isn't setup, gates, load-in or teardown work; else the first. Ties go to the earlier slot. */
    mainOf(slots, msOf) {
      if (!slots || !slots.length) return -1;
      const marked = slots.findIndex((x) => x.main === true); if (marked >= 0) return marked;
      const named = slots.findIndex((x) => String(x.name || "").trim().toLowerCase() === "event"); if (named >= 0) return named;
      const SIDE = /\b(setup|set-up|set up|gates?|doors|load[- ]?in|load[- ]?out|teardown|tear[- ]?down|strike|breakdown|vendor|arrival|parking)\b/i;
      const len = (x) => { const a = msOf ? msOf(x, "start") : Date.parse(x.start + ":00Z"), b = msOf ? msOf(x, "end") : Date.parse(x.end + ":00Z"); return isFinite(a) && isFinite(b) ? b - a : 0; };
      let best = -1; slots.forEach((x, i) => { if (SIDE.test(x.name || "")) return; if (best < 0 || len(x) > len(slots[best])) best = i; });
      return best >= 0 ? best : 0;
    },
    /* the slots in time order (ties by end), each with its real instants */
    slotList(ev) {
      const f = (x, k) => time.toUtc(x[k], ev.tz, (x.fold || {})[k] || 0);
      const list = ev.slots.map((x, i) => ({ ...x, i, startMs: f(x, "start"), endMs: f(x, "end") }));
      const mi = event.mainOf(ev.slots, (x, k) => f(x, k));
      list.forEach((x) => { x.main = x.i === mi; });
      return list.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.i - b.i);
    },
    slotWindows(ev) {
      const out = [];
      event.slotList(ev).forEach((x) => {
        if (!(x.endMs > x.startMs)) return;
        out.push({ key: x.main ? "event" : String(x.id || `slot${x.i}`), id: String(x.id || `slot${x.i}`), slot: true, main: x.main, label: String(x.name || "Event").trim() || "Event",
          startMs: x.startMs, endMs: x.endMs, startLocal: time.toLocal(x.startMs, ev.tz), endLocal: time.toLocal(x.endMs, ev.tz), hours: (x.endMs - x.startMs) / 3600e3 });
      });
      if (!out.length) return out;
      const all = { key: "all", label: "Whole event", startMs: Math.min(...out.map((w) => w.startMs)), endMs: Math.max(...out.map((w) => w.endMs)), spans: event.union(out) };
      all.startLocal = time.toLocal(all.startMs, ev.tz); all.endLocal = time.toLocal(all.endMs, ev.tz); all.hours = (all.endMs - all.startMs) / 3600e3; all.gaps = all.spans.length > 1;
      out.push(all);
      return out;
    },
    /* the union of windows as merged [s, e) spans (touching windows merge) */
    union(wins) {
      const w = wins.filter((x) => x.key !== "all" && x.endMs > x.startMs).map((x) => ({ s: x.startMs, e: x.endMs })).sort((a, b) => a.s - b.s), out = [];
      w.forEach((x) => { const l = out[out.length - 1]; if (l && x.s <= l.e) l.e = Math.max(l.e, x.e); else out.push({ ...x }); });
      return out;
    },
    /* ---- which slot an hourly value belongs to (planner-defined slots only; the fixed parts keep their own path) ----
       Every hourly value carries a time label L, but not every value means the same moment:
         "end" (the hour ending at L, i.e. L - 1 h to L): precipitation amount, snowfall, the ensemble share with at least
                0.01 in (from members' precipitation), precipitation chance (PoP: Open-Meteo's "preceding hour") and gusts
                (Open-Meteo's "maximum of the preceding hour")
         "at"  (the moment L): temperature, feels-like, sustained wind and direction, and the thunder tier (from CAPE and
                instantaneous fields)
       So rain labelled 4 PM fell 3–4 PM. An "end" value belongs to every slot its hour overlaps; an hour that only partly
       overlaps a slot is counted whole with that slot (hourly guidance can't split an hour). An "at" value belongs to the
       slots whose start <= L <= end (as Core.event.locate reads instantaneous fields). */
    KIND: { qpf: "end", sn: "end", chance: "end", pop: "end", gust: "end", temp: "at", feel: "at", wind: "at", thunder: "at" },
    HAZARD_KIND: { rain: "end", wind: "end", snow: "end", lightning: "at", heat: "at", cold: "at" },
    /* windows (or merged spans {s, e}) a value labelled L belongs to */
    holding(wins, L, kind) {
      const s = (w) => (w.startMs != null ? w.startMs : w.s), e = (w) => (w.endMs != null ? w.endMs : w.e);
      return wins.filter((w) => w.key !== "all" && (kind === "end" ? s(w) < L && e(w) > L - 3600e3 : s(w) <= L && L <= e(w)));
    },
    covers: (spans, L, kind) => !spans || event.holding(spans, L, kind).length > 0,
    /* "end" hours that only partly overlap the schedule (the rest of the hour is between slots or outside): counted whole
       with the slot(s) they touch. [{ s, e, labels }] for the hour [s, e). */
    partialHours(wins) {
      const ph = wins.filter((w) => w.key !== "all"); if (!ph.length) return [];
      const lo = Math.floor(Math.min(...ph.map((w) => w.startMs)) / 3600e3) * 3600e3, hi = Math.max(...ph.map((w) => w.endMs)), out = [];
      for (let L = lo + 3600e3; L - 3600e3 < hi; L += 3600e3) {
        const held = event.holding(ph, L, "end"); if (!held.length) continue;
        const cov = event.union(held.map((w) => ({ key: w.key, startMs: Math.max(w.startMs, L - 3600e3), endMs: Math.min(w.endMs, L) }))).reduce((t, x) => t + x.e - x.s, 0);
        if (cov < 3600e3) out.push({ s: L - 3600e3, e: L, labels: held.map((w) => w.label) });
      }
      return out;
    },
    /* how a part is named in a sentence: the fixed parts as before ("setup", "gates", "teardown", "event"); a planner's
       own slot name as typed ("Outdoor ceremony") */
    word: (label) => (event.LEGACY_LABELS.includes(label) ? String(label).toLowerCase() : String(label || "")),
    /* with an article: "the event", "setup", "the Outdoor ceremony" (a name that is a day or already has one: as typed) */
    phrase(label) {
      if (label === "Event") return "the event";
      if (event.LEGACY_LABELS.includes(label)) return label.toLowerCase();
      const l = String(label || "").trim();
      return /^(the|a|an|our|my|day\b|mon|tue|wed|thu|fri|sat|sun)/i.test(l) ? l : `the ${l}`;
    },
    /* the slots an editor shows for any event: its own, or its fixed parts read as slots (nothing stored changes) */
    slotsOf(ev) {
      if (event.hasSlots(ev)) return ev.slots.map((x) => ({ ...x }));
      const t = (ev && ev.times) || {}, out = [];
      if (!t.start || !t.end) return out;
      event.PHASES.forEach((p) => { if (!t[p.from]) return; const toKey = p.to.find((k) => t[k]); if (!toKey) return;
        const fold = {}; if ((ev.fold || {})[p.from]) fold.start = ev.fold[p.from]; if ((ev.fold || {})[toKey]) fold.end = ev.fold[toKey];
        out.push({ id: p.key, name: p.label, start: t[p.from], end: t[toKey], ...(p.key === "event" ? { main: true } : {}), ...(Object.keys(fold).length ? { fold } : {}) }); });
      return out;
    },
    /* the fixed parts behind a set of slots, when they are exactly a Setup/Gates/Event/Teardown schedule (in that order,
       back to back, the main slot named Event): then the event is saved the way it always was. null otherwise. */
    legacyTimes(slots) {
      if (!slots || !slots.length) return null;
      const s = slots.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)), names = s.map((x) => x.name);
      const order = event.LEGACY_LABELS.filter((n) => names.includes(n));
      if (names.length !== order.length || names.some((n, i) => n !== order[i]) || !names.includes("Event")) return null;
      if (s.some((x) => x.main === true && x.name !== "Event")) return null;
      for (let i = 1; i < s.length; i++) if (s[i].start !== s[i - 1].end) return null;
      const by = Object.fromEntries(s.map((x) => [x.name, x])), t = {};
      if (by.Setup) t.setup = by.Setup.start; if (by.Gates) t.gates = by.Gates.start;
      t.start = by.Event.start; t.end = by.Event.end; if (by.Teardown) t.teardown = by.Teardown.end;
      return t;
    },
    /* the outer start and end of a set of slots (what ev.times carries alongside them) */
    outerTimes(slots, tz) {
      const ms = (x, k) => (tz ? time.toUtc(x[k], tz, (x.fold || {})[k] || 0) : Date.parse(x[k] + ":00Z"));
      const a = slots.reduce((m, x) => (!m || ms(x, "start") < ms(m, "start") ? x : m), null), b = slots.reduce((m, x) => (!m || ms(x, "end") > ms(m, "end") ? x : m), null);
      return { start: a.start, end: b.end };
    },
    /* planner-facing notes that don't stop saving: overlapping slots */
    warnings(ev) {
      if (!event.hasSlots(ev) || !ev.tz) return [];
      const list = event.slotList(ev).filter((x) => x.endMs > x.startMs), out = [];
      for (let i = 1; i < list.length; i++) for (let j = 0; j < i; j++) if (list[i].startMs < list[j].endMs) out.push(`${list[j].name} and ${list[i].name} overlap.`);
      return out;
    },
    /* Hours of a data axis inside a window. idx: valid times in [start, end] (instantaneous fields);
       acc: hours whose preceding-hour accumulation lies in the window, i.e. (start, end]. need: hours
       the window requires at hourly resolution. */
    locate(win, inst) {
      const idx = [], acc = [];
      inst.ms.forEach((m, i) => { if (m >= win.startMs && m <= win.endMs) idx.push(i); if (m > win.startMs && m <= win.endMs + 3599e3 && m - 3600e3 < win.endMs) acc.push(i); });
      const need = Math.ceil((win.endMs - win.startMs) / 3600e3);
      return { idx, acc, need };
    },
    /* Coverage of a window by a data axis: past, beyond (no data yet), partial or full. */
    coverage(win, inst, nowMs) {
      if (win.endMs <= nowMs) return { status: "past", have: 0, need: 0 };
      if (!inst.ms.length || win.startMs > inst.ms[inst.ms.length - 1]) return { status: "beyond", have: 0, need: Math.ceil((win.endMs - win.startMs) / 3600e3) };
      /* full: the hourly periods (each hour covers the hour before its label) span the window edge to edge */
      const L = event.locate(win, inst), A = L.acc;
      const full = A.length > 0 && inst.ms[A[0]] - 3600e3 <= win.startMs && inst.ms[A[A.length - 1]] >= win.endMs && A[A.length - 1] - A[0] + 1 === A.length;
      return { status: full ? "full" : "partial", have: L.acc.length, need: L.need };
    },
    /* Stable key for comparing the same event window across updates. */
    windowKey: (ev, win) => `${ev.id}:${win.key}:${win.startMs}-${win.endMs}`,
  };

  /* ======================= NWS ======================= */
  /* Parsing for api.weather.gov point forecasts. Everything stays an NWS product: periods keep their
     own start/end and day/night flag, grid fields keep their valid intervals and units, and
     interval accumulations are never spread into hours. Missing values stay null. */
  const nws = {
    STALE_H: 12, // grid/forecast older than this is treated as unavailable
    durationMs(d) {
      const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d || "");
      return m ? ((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600e3 + (+m[3] || 0) * 60e3 : null;
    },
    /* "2026-11-02T12:00:00+00:00/PT6H" -> {s, e} in UTC ms */
    interval(vt) {
      const [a, d] = String(vt).split("/"), s = Date.parse(a), dur = nws.durationMs(d);
      return isNaN(s) || dur == null ? null : { s, e: s + dur };
    },
    /* Convert a value with a WMO unit code to the site's US units. */
    convert(uom, v) {
      if (v == null || !isFinite(v)) return null;
      switch (String(uom || "").replace(/^(wmoUnit|unit):/, "")) {
        case "degC": return v * 9 / 5 + 32;
        case "km_h-1": return v * 0.621371;
        case "m_s-1": return v * 2.23694;
        case "mm": return v / 25.4;
        case "m": return v * 3.28084;
        case "km": return v * 0.621371;
        default: return v; // degF, percent, degree_(angle) or unitless
      }
    },
    /* A grid "state" field (valid through its interval, e.g. temperature) at each instant. */
    stateAt(prop, msArr) {
      const iv = ((prop && prop.values) || []).map((x) => { const r = nws.interval(x.validTime); return r && { ...r, v: nws.convert(prop.uom, x.value) }; }).filter(Boolean);
      return msArr.map((m) => { const x = iv.find((y) => m >= y.s && m < y.e); return x ? x.v : null; });
    },
    /* A grid accumulation field (QPF, snowfall, ice) as its own intervals, in inches. */
    intervals(prop) {
      return ((prop && prop.values) || []).map((x) => { const r = nws.interval(x.validTime); return r && { ...r, v: nws.convert(prop.uom, x.value) }; }).filter(Boolean);
    },
    /* Accumulation over [s, e] from interval totals without allocating within intervals:
       lower = intervals entirely inside; upper = every interval that overlaps. exact when no interval
       straddles an edge and the intervals cover the whole window; otherwise report the range. */
    totalOver(ivs, s, e) {
      const over = ivs.filter((x) => x.e > s && x.s < e), known = over.filter((x) => x.v != null);
      const inside = known.filter((x) => x.s >= s && x.e <= e);
      const sorted = over.slice().sort((a, b) => a.s - b.s);
      let reach = s, covers = sorted.length > 0 && sorted[0].s <= s;
      sorted.forEach((x) => { if (x.s > reach) covers = false; reach = Math.max(reach, x.e); });
      covers = covers && reach >= e && known.length === over.length;
      if (!covers) return { lower: null, upper: null, exact: false, covers: false, n: over.length };
      const lower = inside.reduce((t, x) => t + x.v, 0), upper = known.reduce((t, x) => t + x.v, 0);
      return { lower, upper, exact: inside.length === known.length, covers: true, n: over.length };
    },
    /* Window total assuming a uniform rate inside each interval that straddles an edge. Used only
       when intervals don't line up; callers flag the result as prorated. null if not covered. */
    prorate(ivs, s, e) {
      const t = nws.totalOver(ivs, s, e); if (!t.covers) return null;
      return ivs.filter((x) => x.e > s && x.s < e).reduce((a, x) => a + x.v * (Math.min(e, x.e) - Math.max(s, x.s)) / (x.e - x.s), 0);
    },
    /* Official 12-hour day/night periods (forecast endpoint). */
    periods(fc) {
      return (((fc || {}).properties || {}).periods || []).map((p) => ({
        name: p.name, s: Date.parse(p.startTime), e: Date.parse(p.endTime), startTime: p.startTime, endTime: p.endTime, isDaytime: !!p.isDaytime,
        temp: p.temperature == null ? null : p.temperatureUnit === "C" ? p.temperature * 9 / 5 + 32 : p.temperature,
        pop: p.probabilityOfPrecipitation ? p.probabilityOfPrecipitation.value : null,
        wind: p.windSpeed || "", dir: p.windDirection || "", short: p.shortForecast || "", detailed: p.detailedForecast || "",
      }));
    },
    /* Hourly forecast periods (wording and official hourly values). */
    hourly(fh) {
      return (((fh || {}).properties || {}).periods || []).map((p) => ({
        s: Date.parse(p.startTime), e: Date.parse(p.endTime), short: p.shortForecast || "",
        temp: p.temperature == null ? null : p.temperatureUnit === "C" ? p.temperature * 9 / 5 + 32 : p.temperature,
        pop: p.probabilityOfPrecipitation ? p.probabilityOfPrecipitation.value : null,
      }));
    },
    /* Weather conditions (coverage/type/intensity) valid at each instant. */
    weatherAt(grid, msArr) {
      const w = (((grid || {}).properties || {}).weather || {}).values || [];
      const iv = w.map((x) => { const r = nws.interval(x.validTime); return r && { ...r, v: (x.value || []).filter((c) => c && c.weather) }; }).filter(Boolean);
      return msArr.map((m) => { const x = iv.find((y) => m >= y.s && m < y.e); return x ? x.v : null; });
    },
    /* Precipitation type named in NWS weather wording, or null. Sleet is NWS-only: models don't report it. */
    ptype(conds) {
      if (!conds || !conds.length) return null;
      const t = new Set(conds.map((c) => c.weather));
      const has = (...k) => k.some((x) => t.has(x));
      const kinds = [has("freezing_rain", "freezing_drizzle") && "freezing", has("sleet") && "sleet", has("snow", "snow_showers", "blowing_snow", "snow_grains") && "snow", has("rain", "rain_showers", "drizzle", "thunderstorms") && "rain"].filter(Boolean);
      return kinds.length > 1 ? (kinds.includes("freezing") ? "freezing" : "mix") : kinds[0] || null;
    },
    /* NWS grid values on an hourly axis of instants (US units). Accumulations are NOT here: use
       intervals/totalOver. pop is the hourly grid PoP: a probability for that hour, never a daily one. */
    onAxis(N, ms) {
      const g = N && N.parts && N.parts.grid ? N.parts.grid.properties : null;
      if (!g) return null;
      const f = (k) => (g[k] ? nws.stateAt(g[k], ms) : ms.map(() => null));
      const wx = nws.weatherAt(N.parts.grid, ms);
      return { temperature_2m: f("temperature"), dew_point_2m: f("dewpoint"), apparent_temperature: f("apparentTemperature"), precipitation_probability: f("probabilityOfPrecipitation"),
        wind_speed_10m: f("windSpeed"), wind_direction_10m: f("windDirection"), wind_gusts_10m: f("windGust"), cloud_cover: f("skyCover"),
        /* thunder probability: kept as NWS's own intervals; "thunder" samples the value valid at each hour */
        thunder: f("probabilityOfThunder"), thunderIv: nws.intervals(g.probabilityOfThunder ? { ...g.probabilityOfThunder, uom: "percent" } : null), weather: wx, ptype: wx.map(nws.ptype),
        qpf: nws.intervals(g.quantitativePrecipitation), snow: nws.intervals(g.snowfallAmount), ice: nws.intervals(g.iceAccumulation),
        covered: ms.map((m) => g.validTimes ? (() => { const v = nws.interval(g.validTimes); return v && m >= v.s && m < v.e; })() : false) };
    },
    /* Freshness and coverage of a point forecast. */
    status(parts, nowMs) {
      const t = (x) => (x && x.properties && x.properties.updateTime ? Date.parse(x.properties.updateTime) : null);
      const upd = { forecast: t(parts.forecast), hourly: t(parts.hourly), grid: t(parts.grid) };
      const age = (k) => (upd[k] == null ? null : (nowMs - upd[k]) / 3600e3);
      const vt = parts.grid && parts.grid.properties && parts.grid.properties.validTimes ? nws.interval(parts.grid.properties.validTimes) : null;
      const stale = {}; ["forecast", "hourly", "grid"].forEach((k) => (stale[k] = parts[k] == null || age(k) == null || age(k) > nws.STALE_H));
      return { updated: upd, ageH: { forecast: age("forecast"), hourly: age("hourly"), grid: age("grid") }, stale, valid: vt };
    },
  };

  /* ======================= winter diagnostics ======================= */
  const CP = 1004; // J/(kg K)
  Object.assign(winter, {
    /* WMO weather code -> precipitation type. The WMO set models use has no sleet / ice pellets. */
    codeType(c) {
      if (c == null) return null;
      if (c === 56 || c === 57 || c === 66 || c === 67) return "freezing";
      if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
      if ((c >= 51 && c <= 55) || (c >= 61 && c <= 65) || (c >= 80 && c <= 82) || c >= 95) return "rain";
      return "none";
    },
    /* Profile points for one hour: surface (2 m, surface pressure) plus every pressure level above
       ground. Metric inputs: °C, hPa, m. */
    profile(h, i, elev) {
      const pts = [];
      const ps = h.surface_pressure ? h.surface_pressure[i] : null, t2 = h.temperature_2m ? h.temperature_2m[i] : null;
      if (t2 != null) pts.push({ z: 2, p: ps, t: t2 });
      severe.LEVELS.forEach((p) => {
        const z = h[`geopotential_height_${p}hPa`] && h[`geopotential_height_${p}hPa`][i], t = h[`temperature_${p}hPa`] && h[`temperature_${p}hPa`][i];
        if (z == null || t == null || p < 500) return;
        if (ps != null && p >= ps) return;      // below ground
        if (z - elev <= 10) return;
        pts.push({ z: z - elev, p, t, rh: h[`relative_humidity_${p}hPa`] ? h[`relative_humidity_${p}hPa`][i] : null });
      });
      return pts.sort((a, b) => a.z - b.z);
    },
    /* Warm layers aloft and the cold layer beneath, from the profile. */
    structure(pts) {
      if (!pts || pts.length < 3) return null;
      const aloft = pts.filter((q) => q.z > 300);
      const maxA = aloft.reduce((m, q) => (m == null || q.t > m.t ? q : m), null);
      let warmBase = null, warmTop = null, coldDepth = null;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const zc = a.t !== b.t ? a.z + ((0 - a.t) * (b.z - a.z)) / (b.t - a.t) : null;
        if (a.t <= 0 && b.t > 0 && warmBase == null) { warmBase = zc; if (pts[0].t <= 0) coldDepth = zc; }
        if (a.t > 0 && b.t <= 0 && warmBase != null && warmTop == null) warmTop = zc;
      }
      const kuch = pts.filter((q) => q.p == null || q.p >= 500).reduce((m, q) => Math.max(m, q.t), -999);
      return { sfcT: pts[0].t, maxAloftT: maxA ? maxA.t : null, maxAloftZ: maxA ? maxA.z : null, warmBase, warmTop, warmDepth: warmBase != null && warmTop != null ? warmTop - warmBase : null, coldDepth, kucheraTmax: kuch > -999 ? kuch : null };
    },
    /* PROVISIONAL coverage checks for sparse pressure-level profiles. Passing them does NOT mean
       every warm or cold layer was resolved; it only rules out the clearly unusable cases.
       purpose "ptype": surface point, first level within 1500 m, data through at least 3000 m AGL,
         and a sub-freezing top (otherwise a warm layer may continue above the data).
       purpose "kuchera": surface point, first level within 1500 m, reaches 500 hPa, and no gap over
         1800 m anywhere below it (the warmest temperature could sit inside a gap).
       Both report the largest gap in any interval overlapping the lowest 3000 m (lowGap, with where it
       is) and flag it coarse above 1000 m. Thresholds are provisional and model-independent. */
    COVERAGE: { firstLevelMax: 1500, ptypeTop: 3000, gapFail: 1800, layerTop: 3000, coarseGap: 1000 },
    coverage(pts, purpose = "ptype") {
      const K = winter.COVERAGE, why = [];
      if (!pts || pts.length < 3) return { pass: false, coarse: true, lowGap: null, lowGapSpan: null, maxGap: null, why: ["fewer than 3 points"] };
      if (pts[0].z > 50) why.push("no surface point");
      if (pts[1].z > K.firstLevelMax) why.push(`first level ${Math.round(pts[1].z)} m above ground`);
      let lowGap = 0, lowGapSpan = null, maxGap = 0;
      for (let k = 1; k < pts.length; k++) {
        const g = pts[k].z - pts[k - 1].z;
        maxGap = Math.max(maxGap, g);
        if (pts[k - 1].z < K.layerTop && g > lowGap) { lowGap = g; lowGapSpan = [pts[k - 1].z, pts[k].z]; } // any interval overlapping the layer
      }
      if (purpose === "kuchera") {
        if (!pts.some((q) => q.p === 500)) why.push("does not reach 500 hPa");
        if (maxGap > K.gapFail) why.push(`${Math.round(maxGap)} m gap between levels below 500 hPa`);
      } else {
        if (pts[pts.length - 1].z < K.ptypeTop) why.push(`data stop at ${Math.round(pts[pts.length - 1].z)} m`);
        if (pts[pts.length - 1].t >= 0) why.push("top of the data is above freezing (warm layer may continue)");
      }
      return { pass: why.length === 0, coarse: lowGap > K.coarseGap, lowGap, lowGapSpan, maxGap, why, purpose };
    },
    /* Original Bourgouin energy method, following NCEP UPP CALWXT_BOURG (Baldwin; the operational
       implementation of Bourgouin 1992/2000), NOT the revised Bourgouin method (Birk et al. 2021).
       Energy of a layer = g·Δz·ln(T/273.15) (J/kg), integrated here on 25 m sub-layers.
         surfw  = warm energy in the surface-based warm layer
         areape = warm energy of every warm layer above it (all of them, summed)
         areane = cold energy of every layer below the highest warm layer
       Tree: areape < 2 -> surfw < 5.6 snow, > 13.2 rain, else rain/snow mix.
             areane > 66 + 0.66·areape -> ice pellets, unless surfw melts them (> 13.2 rain, 5.6–13.2 mix)
             areane < 46 + 0.66·areape -> freezing rain if the surface is below 0 °C, else rain
             otherwise -> freezing rain / ice pellet mix.
       UPP resolves transition zones with a random draw; here they are reported as named mixes.
       EXPERIMENTAL in this tool: model levels are coarse and there is no moisture information. */
    /* UPP's energy sums and decision tree on given layers, exactly as CALWXT_BOURG does them.
       layers: bottom -> top, each {zb, zt (m AGL), t (°C, one value per layer), p (hPa at mid)}.
       This is the part compared against the original Fortran on identical inputs (tests/upp/). */
    bourgouinLayers(layers) {
      const G = 9.80665, T0 = 273.15, n = layers.length;
      if (!n) return null;
      const K = (L) => L.t + T0, warm = (L) => K(L) >= T0 && (L.p == null || L.p > 250);
      /* top layer of the surface-based warm layer (UPP iwrml); n = none */
      let iwrml = n;
      if (K(layers[0]) >= T0) for (let k = 0; k < n - 1; k++) if (K(layers[k]) >= T0 && K(layers[k + 1]) < T0) { iwrml = k; break; }
      /* highest warm layer (UPP lhiwrm); -1 = none */
      let hi = -1; for (let k = 0; k < n; k++) if (warm(layers[k])) hi = k;
      let areape = 0, areane = 0, surfw = 0;
      for (let k = 0; k < n; k++) {
        const L = layers[k], a = Math.log(K(L) / T0) * G * (L.zt - L.zb);
        if (warm(L)) { if (k > iwrml || iwrml === n) areape += a; else surfw += a; }
        else if (k < hi) areane += Math.abs(a);
      }
      const sfcT = layers[0].t;
      let type, detail;
      if (areape < 2) { type = surfw < 5.6 ? "snow" : surfw > 13.2 ? "rain" : "mix"; detail = type === "mix" ? "rain/snow" : null; }
      else if (areane > 66 + 0.66 * areape) { type = surfw < 5.6 ? "sleet" : surfw > 13.2 ? "rain" : "mix"; detail = type === "mix" ? "sleet/rain" : null; }
      else if (areane < 46 + 0.66 * areape) type = sfcT < 0 ? "freezing" : "rain";
      else { type = "mix"; detail = "freezing rain/sleet"; }
      return { type, detail, PA: areape, NA: areane, sfcWarm: surfw };
    },
    /* Sparse pressure-level points -> layers. A representation CHOICE of this tool, separate from UPP:
       temperature is interpolated linearly in height between levels and split into 25 m layers. */
    pointsToLayers(pts, step = 25) {
      const hp = pts.map((q) => ({ h: q.z, t: q.t })), top = pts[pts.length - 1].z, layers = [];
      for (let z = pts[0].z; z < top - 1e-6; z += step) { const zt = Math.min(z + step, top); layers.push({ zb: z, zt, t: at(hp, "t", (z + zt) / 2), p: null }); }
      return layers;
    },
    /* Alternative representation for sensitivity: each level's temperature held constant between the
       midpoints to its neighbours (step layers, as a model's own layers would be treated by UPP). */
    pointsToStepLayers(pts) {
      const n = pts.length, layers = [];
      for (let k = 0; k < n; k++) {
        const zb = k === 0 ? pts[0].z : (pts[k - 1].z + pts[k].z) / 2, zt = k === n - 1 ? pts[n - 1].z : (pts[k].z + pts[k + 1].z) / 2;
        if (zt > zb) layers.push({ zb, zt, t: pts[k].t, p: null });
      }
      return layers;
    },
    /* Method identifiers stored with every logged diagnosis, so a record can be reproduced later. */
    METHOD_ID: "ptype-v1",
    METHOD: {
      ptype: "bourgouin-original via UPP CALWXT_BOURG@76d5b18 (energy sums + decision tree verified on identical layers)",
      primaryRepresentation: "linear-in-height, 25 m layers (pointsToLayers v1)",
      alternateRepresentation: "step layers between level midpoints (pointsToStepLayers v1)",
      coverage: "coverage v1 (provisional thresholds: first level 1500 m, ptype top 3000 m, gap fail 1800 m, coarse 1000 m in lowest 3 km)",
      kuchera: "Kuchera ratio from max T surface-500 hPa, clamped 0-30 (v1)",
    },
    /* Primary diagnosis plus the alternate representation. repSensitive when the two disagree in
       category: the result depends on how sparse levels are turned into layers. */
    bourgouin(pts) {
      const cov = winter.coverage(pts, "ptype");
      if (!cov.pass) return { type: null, unavailable: cov.why, cov };
      const r = winter.bourgouinLayers(winter.pointsToLayers(pts));
      const alt = winter.bourgouinLayers(winter.pointsToStepLayers(pts));
      const repSensitive = alt.type !== r.type || (alt.detail || null) !== (r.detail || null);
      return { ...r, alt, repSensitive, coarse: cov.coarse, cov, method: "bourgouin-original-upp" };
    },
    /* Kuchera snow ratio from the warmest temperature (K) between the surface and 500 hPa. */
    kuchera(tmaxC) {
      if (tmaxC == null) return null;
      const T = tmaxC + 273.15, r = T > 271.16 ? 12 + 2 * (271.16 - T) : 12 + (271.16 - T);
      return Math.max(0, Math.min(r, 30));
    },
    /* Hourly diagnostics for one deterministic model (metric hourly arrays). */
    series(h, n, elev, { minPrecipMm = 0.1 } = {}) {
      const out = [];
      for (let i = 0; i < n; i++) {
        /* rain = large-scale rain + convective showers; unknown (null) unless every part is reported */
        const pr = h.precipitation ? h.precipitation[i] : null, sn = h.snowfall ? h.snowfall[i] : null;
        const rn = h.rain && h.rain[i] != null && h.showers && h.showers[i] != null ? h.rain[i] + h.showers[i] : null;
        const pts = winter.profile(h, i, elev), st = winter.structure(pts), covP = winter.coverage(pts, "ptype"), covK = winter.coverage(pts, "kuchera");
        const wet = pr != null && pr >= minPrecipMm;
        const code = h.weather_code ? winter.codeType(h.weather_code[i]) : null;
        const split = sn != null && rn != null && wet ? (sn > 0.05 && rn > 0.05 ? "mix" : sn > 0.05 ? "snow" : "rain") : null;
        const bour = wet ? winter.bourgouin(pts) : null;
        /* Kuchera has its own coverage checks (through 500 hPa, no large gaps) */
        const swe = sn == null ? null : sn / 7 / 2.54; // Open-Meteo: snowfall cm = 7 × water cm  -> SWE inches
        const kr = st && covK.pass ? winter.kuchera(st.kucheraTmax) : null;
        out.push({ wet, precipIn: pr == null ? null : pr / 25.4, snowIn: sn == null ? null : sn / 2.54, swe, codeType: wet ? code : code === "none" ? "none" : code, split, bour, st,
          t2F: h.temperature_2m && h.temperature_2m[i] != null ? h.temperature_2m[i] * 9 / 5 + 32 : null,
          tdF: h.dew_point_2m && h.dew_point_2m[i] != null ? h.dew_point_2m[i] * 9 / 5 + 32 : null,
          twF: h.wet_bulb_temperature_2m && h.wet_bulb_temperature_2m[i] != null ? h.wet_bulb_temperature_2m[i] * 9 / 5 + 32 : null,
          soilC: h.soil_temperature_0cm ? h.soil_temperature_0cm[i] : null, kuchera: kr, covP, covK });
      }
      return out;
    },
    /* Precipitation-type changes over [s, e) for one model: [{i, from, to}]. Dry hours are skipped. */
    transitions(types, s, e) {
      const out = []; let prev = null;
      for (let i = s; i < e; i++) { const t = types[i]; if (!t || t === "none") continue; if (prev && t !== prev) out.push({ i, from: prev, to: t }); prev = t; }
      return out;
    },
    /* Snow totals over [s, e) from one model: as reported (7:1), 10:1 and Kuchera, all from the model's
       own snow water. Only when every hour is present. */
    scenarioTotals(rows, s, e) {
      const r = rows.slice(s, e);
      if (!r.length || r.some((x) => x.swe == null)) return null;
      const swe = r.reduce((t, x) => t + x.swe, 0);
      const kOk = r.every((x) => x.swe === 0 || x.kuchera != null);
      return { reported: r.reduce((t, x) => t + x.snowIn, 0), swe, ten: swe * 10, kuchera: kOk ? r.reduce((t, x) => t + x.swe * (x.kuchera || 0), 0) : null,
        warmHours: r.filter((x) => x.snowIn > 0 && ((x.t2F != null && x.t2F > 33) || (x.soilC != null && x.soilC > 0))).length };
    },
  });
  config.winterDet = {
    id: "winterDet", base: FORECAST, params: { temperature_unit: "celsius", wind_speed_unit: "kn", precipitation_unit: "mm" }, days: 5, require: ["temperature_2m", "precipitation"],
    models: [
      { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1 }, { id: "ncep_rrfs_conus", name: "RRFS 3 km", w: 1, on: false, note: "Optional new source; current feed may be unavailable. Not included in the saved eight-source recipe." }, { id: "gfs_seamless", name: "GFS", w: 1 },
      { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1 }, { id: "icon_seamless", name: "ICON", w: 1 }, { id: "gem_seamless", name: "GEM", w: 1 },
      { id: "ukmo_seamless", name: "UKMO", w: 1 }, { id: "ncep_nbm_conus", name: "NBM", w: 1 },
    ],
    hourly: ["temperature_2m", "dew_point_2m", "wet_bulb_temperature_2m", "precipitation", "rain", "showers", "snowfall", "weather_code", "surface_pressure", "soil_temperature_0cm",
      ...LEVELS.filter((p) => p >= 500).flatMap((p) => [`temperature_${p}hPa`, `geopotential_height_${p}hPa`, `relative_humidity_${p}hPa`])],
  };

  /* ======================= verification records ======================= */
  /* One record per source per valid window, so alternatives can later be scored against observations. */
  const verify = {
    SCHEMA: 1,
    record({ kind, source, location, retrievedAt, cycle = null, window, contributors = [], weights = null, values }) {
      return { schema: verify.SCHEMA, kind, source, location, retrievedAt, cycle, window, contributors, weights, values };
    },
  };

  const OpsCore = { stats, time, TIERS, maxTier, config, blend, thunder, severe, winter, changes, event, nws, verify, MS };
  if (typeof module !== "undefined" && module.exports) module.exports = OpsCore;
  root.OpsCore = OpsCore;
})(typeof self !== "undefined" ? self : globalThis);

