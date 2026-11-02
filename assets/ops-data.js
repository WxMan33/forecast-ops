/* Forecast Ops data loading: one way to request and align Open-Meteo data for every page,
   the overview, the live tests and any future server-side briefing. Browser (window.OpsData)
   or Node 18+ (require). Depends on ops-core.js. */
(function (root) {
  "use strict";
  const Core = root.OpsCore || (typeof require !== "undefined" ? require("./ops-core.js") : null);
  const S = Core.stats;

  /* GET JSON with a short session cache (browser only) and a 20 s timeout. */
  async function getJSON(url, cacheMin = 15) {
    const key = "ops_c:" + url;
    let cache = null;
    try { cache = root.sessionStorage || null; } catch (e) { cache = null; }
    if (cacheMin && cache) {
      try { const c = JSON.parse(cache.getItem(key) || "null"); if (c && Date.now() - c.at < cacheMin * 60e3) return c.json; } catch (e) { /* no cache */ }
    }
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    let res;
    try { res = await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(to); }
    const json = await res.json().catch(() => ({ error: true, reason: `HTTP ${res.status}` }));
    if (!res.ok && !json.error) { json.error = true; json.reason = `HTTP ${res.status}`; }
    if (cacheMin && cache && !json.error) { try { cache.setItem(key, JSON.stringify({ at: Date.now(), json })); } catch (e) { /* full */ } }
    return json;
  }

  /* One model, one request. If Open-Meteo rejects a variable (or a whole pressure level) for
     this model, drop it and retry, so one unsupported field never sinks the whole model. */
  async function fetchModel(base, params, model, hourly, daily, loc) {
    let hv = hourly.slice(), dv = (daily || []).slice();
    const dropped = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = new URLSearchParams({ ...params, latitude: loc.lat, longitude: loc.lon, timezone: "auto", models: model });
      if (hv.length) p.set("hourly", hv.join(","));
      if (dv.length) p.set("daily", dv.join(","));
      const json = await getJSON(`${base}?${p.toString().replace(/%2C/g, ",")}`);
      if (!json.error) { json.__dropped = dropped; return json; }
      const why = String(json.reason || "");
      const levels = [...why.matchAll(/(\d{3,4})\s*hPa/gi)].map((m) => `_${m[1]}hPa`);
      const bad = [...hv, ...dv].filter((v) => why.includes(v) || levels.some((l) => v.endsWith(l)));
      if (!bad.length) throw new Error(why || "Request failed");
      dropped.push(...bad);
      hv = hv.filter((v) => !bad.includes(v)); dv = dv.filter((v) => !bad.includes(v));
    }
    throw new Error("Too many unsupported variables");
  }

  /* Pull named arrays out of a response, tolerating model-suffixed keys. */
  function pick(block, names) {
    const out = {};
    if (!block) return out;
    const keys = Object.keys(block);
    for (const n of names) {
      const k = keys.find((k) => k === n) || keys.find((k) => k.startsWith(n + "_") && !/_member\d+/.test(k));
      if (k) out[n] = block[k];
    }
    return out;
  }

  /* Heights always in meters. Open-Meteo returns geopotential height and freezing level in FEET
     whenever imperial units are requested (e.g. precipitation_unit=inch), so normalize here. */
  const LENGTH = /^(geopotential_height_|freezing_level_height)/;
  const unitOf = (j, v) => { const u = j.hourly_units || {}; const k = Object.keys(u).find((k) => k === v || k.startsWith(v + "_")); return k ? String(u[k]).toLowerCase() : ""; };
  function toMeters(v, arr, unit) {
    if (!arr || !LENGTH.test(v)) return arr;
    if (unit === "ft" || unit === "feet") return arr.map((x) => (x == null ? null : x * 0.3048));
    return arr;
  }

  /* Deterministic models for a config spec. ids: which models to request (default: all in the spec).
     Returns {times, dtimes, tz, models: {id: {h, d, elev}}, status: {id: "ok"|"failed"|"empty"}, problems[]} */
  async function loadModels(spec, { lat, lon, days, ids } = {}) {
    const list = spec.models.filter((m) => !ids || ids.includes(m.id));
    const params = { ...spec.params, forecast_days: days || spec.days };
    const res = await Promise.allSettled(list.map((m) => fetchModel(spec.base, params, m.id, [...spec.hourly, ...((spec.extraHourly || {})[m.id] || [])], spec.daily, { lat, lon })));
    const status = {}, problems = [], ok = [];
    res.forEach((r, i) => {
      const m = list[i];
      if (r.status !== "fulfilled") { status[m.id] = "failed"; problems.push(`${m.name}: request failed`); return; }
      const names = [...spec.hourly, ...((spec.extraHourly || {})[m.id] || [])];
      const h = pick(r.value.hourly, names), d = pick(r.value.daily, spec.daily || []);
      if (!spec.require.some((v) => S.hasData(h[v]))) { status[m.id] = "empty"; problems.push(`${m.name}: no coverage at this point`); return; }
      const missing = spec.require.filter((v) => !S.hasData(h[v]));
      if (missing.length) problems.push(`${m.name}: no ${missing.join(", ")}`);
      status[m.id] = "ok";
      ok.push({ m, j: r.value, h, d, names });
    });
    if (!ok.length) return { times: [], dtimes: [], tz: null, models: {}, status, problems, empty: true };
    const master = ok.reduce((a, b) => (b.j.hourly.time.length > a.j.hourly.time.length ? b : a)).j;
    const times = master.hourly.time, dtimes = (master.daily && master.daily.time) || [];
    const models = {};
    ok.forEach(({ m, j, h, d, names }) => {
      const hh = {}, dd = {};
      names.forEach((v) => (hh[v] = S.align(times, j.hourly.time, toMeters(v, h[v], unitOf(j, v)))));
      (spec.daily || []).forEach((v) => (dd[v] = j.daily ? S.align(dtimes, j.daily.time, d[v]) : dtimes.map(() => null)));
      models[m.id] = { h: hh, d: dd, elev: j.elevation || 0 };
    });
    return { times, dtimes, tz: master.timezone, models, status, problems };
  }

  /* Ensembles for a config spec. Returns {times, tz, ens: {id: {var: [member arrays]}}, status, problems} */
  async function loadEnsemble(spec, { lat, lon, days, ids } = {}) {
    const list = spec.models.filter((m) => !ids || ids.includes(m.id));
    const params = { ...spec.params, forecast_days: days || spec.days };
    const res = await Promise.allSettled(list.map((m) => fetchModel(spec.base, params, m.id, spec.hourly, null, { lat, lon })));
    const status = {}, problems = [], ok = [];
    const members = (block, v) => Object.keys(block || {}).filter((k) => (k === v || k.startsWith(v + "_")) && Array.isArray(block[k])).map((k) => block[k]).filter(S.hasData);
    res.forEach((r, i) => {
      const m = list[i];
      if (r.status !== "fulfilled") { status[m.id] = "failed"; problems.push(`${m.name}: unavailable`); return; }
      const byVar = {}; spec.hourly.forEach((v) => (byVar[v] = members(r.value.hourly, v)));
      if (!byVar[spec.require[0]].length) { status[m.id] = "empty"; problems.push(`${m.name}: no members here`); return; }
      status[m.id] = "ok";
      ok.push({ m, j: r.value, byVar });
    });
    if (!ok.length) return { times: [], tz: null, ens: {}, status, problems, empty: true };
    const master = ok.reduce((a, b) => (b.j.hourly.time.length > a.j.hourly.time.length ? b : a)).j;
    const times = master.hourly.time, ens = {};
    ok.forEach(({ m, j, byVar }) => { ens[m.id] = {}; Object.keys(byVar).forEach((v) => (ens[m.id][v] = byVar[v].map((a) => S.align(times, j.hourly.time, a)))); });
    return { times, tz: master.timezone, ens, status, problems };
  }

  const OpsData = { getJSON, fetchModel, pick, loadModels, loadEnsemble, toMeters };
  if (typeof module !== "undefined" && module.exports) module.exports = OpsData;
  root.OpsData = OpsData;
})(typeof self !== "undefined" ? self : globalThis);
