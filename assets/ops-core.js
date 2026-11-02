/* Forecast Ops core: model configuration, aggregation and forecast math. No page or DOM code.
   Loads in a browser (window.OpsCore) or Node (require), so the website, tests and any future
   server-side briefing all compute the same numbers from the same configuration.

   Conventions: missing values are null, never 0. Sounding winds in knots, heights in m above
   ground, sounding temperatures in °C. Signal keys: nodata, normal, monitor, prepare, action. */
(function (root) {
  "use strict";

  /* ======================= stats ======================= */
  const stats = {
    /* Weighted mean/min/max across series at each index. series: [{w, data[]}] */
    blendSeries(series, n) {
      const mean = [], min = [], max = [], count = [];
      for (let i = 0; i < n; i++) {
        let s = 0, w = 0, lo = Infinity, hi = -Infinity, c = 0;
        for (const x of series) { const v = x.data[i]; if (v == null || !isFinite(v)) continue; s += x.w * v; w += x.w; c++; lo = Math.min(lo, v); hi = Math.max(hi, v); }
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
    toUtc(local, tz) {
      const g = Date.UTC(+local.slice(0, 4), +local.slice(5, 7) - 1, +local.slice(8, 10), +local.slice(11, 13), +local.slice(14, 16));
      const a = g - time.offsetMin(g - 12 * 3600e3, tz) * 60e3, b = g - time.offsetMin(g + 12 * 3600e3, tz) * 60e3;
      const okA = time.toLocal(a, tz) === local.slice(0, 16), okB = time.toLocal(b, tz) === local.slice(0, 16);
      if (okA && okB) return Math.min(a, b);
      if (okA) return a;
      if (okB) return b;
      return Math.max(a, b); // skipped (spring forward): first real instant after the gap
    },
    /* UTC ms -> local wall-clock "YYYY-MM-DDTHH:MM" in tz. */
    toLocal(ms, tz) {
      const o = {};
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(ms)).forEach((x) => (o[x.type] = x.value));
      return `${o.year}-${o.month}-${o.day}T${String(+o.hour % 24).padStart(2, "0")}:${o.minute}`;
    },
    /* UTC instants for an Open-Meteo hourly axis. Open-Meteo labels a whole response with ONE fixed
       offset (utc_offset_seconds, the one in effect at request time), not real local time; across a
       daylight-saving change its labels drift an hour from the clock on the wall. So instants come
       from label − offset. "consistent" says whether every label also equals true local time in tz;
       when it doesn't, labels near a time change are off by an hour and pages say so. */
    instants(times, tz, offsetSec) {
      if (!times.length) return { ms: [], consistent: false };
      const lab = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16));
      const ms = offsetSec == null ? (() => { const t0 = time.toUtc(times[0], tz); return times.map((_, i) => t0 + i * 3600e3); })() : times.map((t) => lab(t) - offsetSec * 1000);
      return { ms, consistent: !tz || ms.every((m, i) => time.toLocal(m, tz) === times[i]) };
    },
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
        { id: "gfs_seamless", name: "GFS", w: 1 },
        { id: "ncep_nbm_conus", name: "NBM", w: 1.25 },
        { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1 },
        { id: "ncep_nam_conus", name: "NAM 3 km", w: 0.75 },
        { id: "icon_seamless", name: "ICON", w: 1 },
        { id: "gem_seamless", name: "GEM", w: 1 },
        { id: "ukmo_seamless", name: "UKMO", w: 1 },
        { id: "meteofrance_seamless", name: "Météo-France", w: 0.75, on: false },
        { id: "jma_seamless", name: "JMA", w: 0.75, on: false },
      ],
      hourly: ["temperature_2m", "dew_point_2m", "apparent_temperature", "precipitation_probability", "precipitation", "snowfall", "wind_speed_10m", "wind_gusts_10m", "cloud_cover"],
      daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "snowfall_sum", "precipitation_probability_max", "wind_gusts_10m_max"],
    },
    thunder: {
      id: "thunder", base: FORECAST, params: US, days: 3, require: ["cape", "weather_code"],
      models: [
        { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1.25 },
        { id: "ncep_nam_conus", name: "NAM 3 km", w: 1 },
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
        { id: "ncep_nam_conus", name: "NAM 3 km", w: 1 },
        { id: "gfs_seamless", name: "GFS", w: 1 },
        { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
        { id: "icon_seamless", name: "ICON", w: 1 },
        { id: "gem_seamless", name: "GEM", w: 0.75 },
      ],
      hourly: ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "cape", "convective_inhibition",
        "lifted_index", "freezing_level_height", "precipitation_probability", "weather_code", ...PL],
    },
    winter: {
      id: "winter", base: ENSEMBLE, params: US, days: 7, ensemble: true, require: ["snowfall"],
      models: [
        { id: "gfs025", name: "GEFS (GFS ens.)", w: 1 },
        { id: "ecmwf_ifs025", name: "ECMWF ENS", w: 1.25 },
        { id: "icon_seamless", name: "ICON EPS", w: 0.75 },
        { id: "gem_global", name: "GEM ENS", w: 0.75 },
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
    /* One model's value for a calendar day. A model only counts for a day if it has every hour
       of that day for the variable; otherwise sums and extremes would be understated. */
    modelDay(md, d, hv, dv, how, dtimes) {
      const a = md.h[hv];
      if (!stats.complete(a, d.idx)) return null;
      const j = dtimes ? dtimes.indexOf(d.k) : -1;
      const own = j >= 0 && md.d && md.d[dv] ? md.d[dv][j] : null;
      if (own != null) return own;
      const v = d.idx.map((i) => a[i]);
      return how === "max" ? Math.max(...v) : how === "min" ? Math.min(...v) : v.reduce((s, x) => s + x, 0);
    },
    /* Aggregate any window. idx: hours for instantaneous fields; acc: hours whose preceding-hour
       accumulation falls inside the window (defaults to idx). A model counts only if it has every hour. */
    windowRow(data, ws, idx, acc) {
      const ids = Object.keys(ws).filter((id) => data.models[id] && ws[id] > 0);
      const A = acc || idx, wmean = (list) => { let s = 0, w = 0; list.forEach(({ id, v }) => { if (v != null) { s += ws[id] * v; w += ws[id]; } }); return w ? s / w : null; };
      const per = (hv, how, use = idx) => ids.map((id) => { const a = data.models[id].h[hv]; if (!use.length || !stats.complete(a, use)) return { id, v: null }; const v = use.map((i) => a[i]); return { id, v: how === "max" ? Math.max(...v) : how === "min" ? Math.min(...v) : v.reduce((s, x) => s + x, 0) }; });
      const highs = per("temperature_2m", "max");
      return {
        hi: wmean(highs), lo: wmean(per("temperature_2m", "min")), qpf: wmean(per("precipitation", "sum", A)), sn: wmean(per("snowfall", "sum", A)),
        pop: wmean(per("precipitation_probability", "max")), gust: wmean(per("wind_gusts_10m", "max")), feel: wmean(per("apparent_temperature", "min")),
        ag: blend.agreement(highs.map((x) => x.v)), contrib: highs.filter((x) => x.v != null).map((x) => x.id),
      };
    },
    /* Daily rows for the full calendar days in data. ws: {modelId: weight} of models in use. */
    dailyRows(data, ws) {
      const ids = Object.keys(ws).filter((id) => data.models[id] && ws[id] > 0);
      return time.dayGroups(data.times).filter((d) => d.idx.length >= 12).map((d) => {
        const per = (hv, dv, how) => ids.map((id) => ({ id, v: blend.modelDay(data.models[id], d, hv, dv, how, data.dtimes) }));
        const wmean = (list) => { let s = 0, w = 0; list.forEach(({ id, v }) => { if (v != null) { s += ws[id] * v; w += ws[id]; } }); return w ? s / w : null; };
        const highs = per("temperature_2m", "temperature_2m_max", "max");
        return {
          k: d.k, win: time.windowKey(data.times, d.idx), hours: d.idx.length,
          hi: wmean(highs), lo: wmean(per("temperature_2m", "temperature_2m_min", "min")),
          qpf: wmean(per("precipitation", "precipitation_sum", "sum")), sn: wmean(per("snowfall", "snowfall_sum", "sum")),
          pop: wmean(per("precipitation_probability", "precipitation_probability_max", "max")),
          gust: wmean(per("wind_gusts_10m", "wind_gusts_10m_max", "max")),
          ag: blend.agreement(highs.map((x) => x.v)),
          contrib: highs.filter((x) => x.v != null).map((x) => x.id),
        };
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
      if (!t.start || !t.end) e.push("Event start and end are required.");
      Object.keys(t).forEach((k) => { if (!okFmt(t[k])) e.push(`${k} time is not valid.`); });
      if (e.length) return e;
      const ms = {}; ["setup", "gates", "start", "end", "teardown"].forEach((k) => { if (t[k]) ms[k] = time.toUtc(t[k], ev.tz); });
      const order = ["setup", "gates", "start", "end", "teardown"].filter((k) => ms[k] != null);
      for (let i = 1; i < order.length; i++) if (ms[order[i]] < ms[order[i - 1]]) e.push(`${order[i]} is before ${order[i - 1]}.`);
      if (ms.end <= ms.start) e.push("Event end must be after start.");
      if (ms.teardown != null && ms.teardown - ms.setup > 0 && (ms.teardown || ms.end) - (ms.setup || ms.start) > 7 * 86400e3) e.push("Events longer than 7 days aren't supported.");
      return e;
    },
    /* Phase windows as real instants [startMs, endMs). */
    windows(ev) {
      const t = ev.times, out = [];
      event.PHASES.forEach((p) => {
        if (!t[p.from]) return;
        const toKey = p.to.find((k) => t[k]); if (!toKey) return;
        const s = time.toUtc(t[p.from], ev.tz), e = time.toUtc(t[toKey], ev.tz);
        if (e > s) out.push({ key: p.key, label: p.label, startMs: s, endMs: e, startLocal: time.toLocal(s, ev.tz), endLocal: time.toLocal(e, ev.tz), hours: (e - s) / 3600e3 });
      });
      const all = out.length ? { key: "all", label: "Whole event", startMs: out[0].startMs, endMs: out[out.length - 1].endMs } : null;
      if (all) { all.startLocal = time.toLocal(all.startMs, ev.tz); all.endLocal = time.toLocal(all.endMs, ev.tz); all.hours = (all.endMs - all.startMs) / 3600e3; out.push(all); }
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

  const OpsCore = { stats, time, TIERS, maxTier, config, blend, thunder, severe, winter, changes, event, MS };
  if (typeof module !== "undefined" && module.exports) module.exports = OpsCore;
  root.OpsCore = OpsCore;
})(typeof self !== "undefined" ? self : globalThis);
