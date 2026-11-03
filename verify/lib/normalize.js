/* Normalize one capture's saved raw evidence into forecast values per source, blend and target
   window. Uses the site's shared calculation code (assets/ops-core.js) for blends, ensemble member
   handling and NWS intervals, so verification scores the same numbers the site shows.
   Output: one compact bundle per capture (see verify/README.md "Normalized bundle"). */
"use strict";
const U = require("./util.js");
const C = U.Core, B = C.blend, S = C.stats;
const TG = require("./targets.js");
const SRC = require("./sources.js");
const VERSION = "normalize-v3"; // v2: prospective windows, full coverage; v3: boundary = last retrieval + minimum lead (lib/timing.js)
const TM = require("./timing.js");

const r1 = (x, d = 1) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const omMs = (t) => Date.parse(t + "Z"); // Open-Meteo GMT labels

/* Rebuild the shared-code "data" object from raw responses. */
function buildData(raw) {
  const det = Object.entries(raw.det).filter(([, j]) => j && j.hourly && j.hourly.time);
  if (!det.length) return null;
  const master = det.reduce((a, b) => (b[1].hourly.time.length > a[1].hourly.time.length ? b : a))[1];
  const ms = master.hourly.time.map(omMs);
  const at = new Map(ms.map((m, i) => [m, i]));
  const align = (j, arr) => { const out = ms.map(() => null); j.hourly.time.forEach((t, k) => { const i = at.get(omMs(t)); if (i != null && arr) out[i] = arr[k]; }); return out; };
  const data = { ms, times: ms.map((m) => C.time.toLocal(m, "UTC")), models: {} };
  det.forEach(([id, j]) => { const h = {}; SRC.DET_VARS.forEach((v) => { const k = Object.keys(j.hourly).find((x) => x === v || (x.startsWith(v + "_") && !/member/.test(x))); h[v] = align(j, k ? j.hourly[k] : null); }); data.models[id] = { h, d: {} }; });
  /* ensembles in the loader's shape: {ms, ens: {omId: {var: [member arrays]}}} */
  const ens = { ms, ens: {} };
  Object.entries(raw.ens).forEach(([sid, j]) => {
    if (!j || !j.hourly) return;
    const m = C.config.blendEns.models.find((x) => x.source === sid); if (!m) return;
    ens.ens[m.id] = {};
    SRC.ENS_VARS.forEach((v) => { ens.ens[m.id][v] = Object.keys(j.hourly).filter((k) => k === v || k.startsWith(v + "_")).map((k) => align(j, j.hourly[k])).filter(S.hasData); });
  });
  const nwsAxis = raw.nws && raw.nws.grid ? C.nws.onAxis({ parts: { grid: raw.nws.grid } }, ms) : null;
  B.addSources(data, ens, nwsAxis);
  return data;
}

/* Hour indices in a window. Returns [] unless EVERY hourly instant of the window exists on the axis,
   so a window running past the data (or with axis gaps) never yields a partial value. */
const idxIn = (ms, s, e) => { const want = Math.round((e - s) / 3600e3) + 1, out = ms.map((m, i) => (m >= s && m <= e ? i : -1)).filter((i) => i >= 0); return out.length === want ? out : []; };
const accIn = (ms, s, e) => { const want = Math.round((e - s) / 3600e3), out = ms.map((m, i) => (m > s && m <= e ? i : -1)).filter((i) => i >= 0); return out.length === want ? out : []; };
const quant = (v, q) => { const a = v.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))] : null; };
const ensStats = (mv) => (mv && mv.length ? { n: mv.length, mn: r1(Math.min(...mv), 2), mx: r1(Math.max(...mv), 2), p10: r1(quant(mv, 0.1), 2), p50: r1(quant(mv, 0.5), 2), p90: r1(quant(mv, 0.9), 2) } : null);

/* Values for one source over one target window. Returns {v, ...} or null (never a fake 0). */
function sourceTarget(data, id, key, win) {
  const md = data.models[id]; if (!md) return null;
  const tg = TG.TARGETS[key], [s, e] = win;
  const idx = idxIn(data.ms, s, e), acc = accIn(data.ms, s, e);
  if (tg.kind === "temp") {
    const r = B.sourceValue(md, "temperature_2m", /max/.test(key) ? "max" : "min", idx, data);
    return r ? { v: r1(r.v), ens: md.kind === "ens" ? ensStats(r.members) : undefined } : null;
  }
  if (tg.kind === "precip" || tg.kind === "snow") {
    const hv = tg.kind === "snow" ? "snowfall" : "precipitation";
    const r = B.sourceValue(md, hv, "sum", acc, data);
    return r ? { v: r1(r.v, 3), ens: md.kind === "ens" ? ensStats(r.members) : undefined, flags: r.prorated ? ["nws-prorated"] : undefined, range: r.range ? r.range.map((x) => r1(x, 3)) : undefined } : null;
  }
  if (tg.kind === "prob" && md.kind === "ens") {
    const mv = md.members.map((mb) => B.reduce(mb.h.precipitation, acc, "sum")).filter((x) => x != null);
    return mv.length ? { v: r1(mv.filter((x) => x >= tg.threshold).length / mv.length, 3), n: mv.length } : null;
  }
  return null; // deterministic precipitation_probability is a different quantity: not mapped to these targets
}

/* NWS's own published period values (official MaxT/MinT and period PoP), kept as their own ids. */
function nwsOfficial(raw, loc, dates) {
  const out = {}, g = raw.nws && raw.nws.grid && raw.nws.grid.properties, fc = raw.nws && raw.nws.forecast && raw.nws.forecast.properties;
  const lstDate = (ms) => new Date(ms + loc.lstOffsetMin * 60e3).toISOString().slice(0, 10);
  if (g) {
    [["maxTemperature", "tmax_day"], ["minTemperature", "tmin_night"]].forEach(([k, key]) => {
      (g[k] && g[k].values || []).forEach((x) => { const iv = C.nws.interval(x.validTime); if (!iv) return; const d = lstDate(iv.s); if (!dates.includes(d)) return;
        (out[key] = out[key] || {})[d] = { v: r1(C.nws.convert(g[k].uom, x.value)), validTime: x.validTime }; });
    });
  }
  if (fc) (fc.periods || []).forEach((p) => {
    const s = Date.parse(p.startTime), d = lstDate(s + 3600e3), pop = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
    if (pop == null || !dates.includes(d)) return;
    const key = p.isDaytime ? "pop01_day12" : "pop01_night12";
    (out[key] = out[key] || {})[d] = { v: pop / 100, period: `${p.startTime}/${p.endTime}`, name: p.name, flags: ["nws-period-pop"] };
  });
  return out;
}

/* Main: raw = {det:{id:json}, ens:{id:json}, nws:{grid,forecast,hourly}}; cap = capture record. */
function normalize(raw, cap, loc, recipes) {
  const data = buildData(raw);
  const bundle = { schema: 1, version: VERSION, targetsVersion: TG.VERSION, captureId: cap.captureId, loc: loc.id, slot: cap.slot, localDate: cap.localDate, slotTarget: cap.slotTarget, startedAt: cap.startedAt, timeliness: cap.timeliness, sources: {}, blends: {}, official: {}, hourly: null };
  if (!data) { bundle.error = "no deterministic model data"; return bundle; }
  const dates = Array.from({ length: 17 }, (_, k) => U.addDays(cap.localDate, k));
  const keys = Object.keys(TG.TARGETS);
  const present = Object.keys(data.models);
  /* prospective only: a window must start at least the minimum lead after the LAST source retrieval */
  const retr = Object.values(cap.sources || {}).map((s) => s.retrievedAt).filter(Boolean).sort();
  const lastMs = retr.length ? Date.parse(retr[retr.length - 1]) : Date.parse(cap.startedAt);
  bundle.retrieval = { first: retr[0] || null, last: retr[retr.length - 1] || null };
  bundle.timing = TM.VERSION;
  bundle.sourceIssue = Object.fromEntries(Object.values(cap.sources || {}).map((s) => [s.id, { retrievedAt: s.retrievedAt || null, issued: s.kind === "nws" ? s.issuedAt || null : s.meta ? s.meta.lastRunInit || null : null, issuedNote: s.kind === "nws" ? "NWS grid updateTime" : "provider metadata: latest run at retrieval", implausible: s.meta && s.meta.implausible }]));
  const prospective = (key, d) => TM.windowOk(TG.TARGETS[key].window(d, loc)[0], lastMs);
  /* sources */
  present.forEach((id) => {
    const o = {};
    keys.forEach((key) => dates.forEach((d) => { if (!prospective(key, d)) return; const v = sourceTarget(data, id, key, TG.TARGETS[key].window(d, loc)); if (v) (o[key] = o[key] || {})[d] = v; }));
    bundle.sources[id] = o;
  });
  bundle.official.nws = nwsOfficial(raw, loc, dates);
  Object.entries(bundle.official.nws).forEach(([key, byD]) => Object.keys(byD).forEach((d) => { if (!prospective(key, d)) delete byD[d]; }));
  /* blends: requested vs actual weights, missing sources, effective shares and contributors */
  recipes.forEach((rc) => {
    const wsAct = {}, missing = [];
    Object.entries(rc.weights).forEach(([id, w]) => { if (data.models[id]) wsAct[id] = w; else missing.push(id); });
    const info = { label: rc.label, group: rc.group, configHash: U.configHash({ weights: rc.weights, rules: rc.rules }), requested: rc.weights, rules: rc.rules, actual: wsAct, missing,
      shares: { temperature_2m: B.shares(wsAct, rc.rules, "temperature_2m").map((x) => [x.id, r1(x.share, 3)]), precipitation: B.shares(wsAct, rc.rules, "precipitation").map((x) => [x.id, r1(x.share, 3)]) }, values: {} };
    if (Object.keys(wsAct).length) keys.forEach((key) => dates.forEach((d) => {
      if (!prospective(key, d)) return;
      const tg = TG.TARGETS[key], [s, e] = tg.window(d, loc);
      const idx = idxIn(data.ms, s, e), acc = accIn(data.ms, s, e);
      const a = B.aggregate(data, wsAct, idx, acc, { rules: rc.rules });
      let v = null, extra = {};
      if (tg.kind === "temp") { const max = /max/.test(key); v = max ? a.hi : a.lo; extra = { spread: (max ? a.hiR : a.loR).map((x) => r1(x)), ensOnly: max ? a.ensR.hi : a.ensR.lo, used: (max ? a.parts.hi : a.parts.lo).map((p) => [p.id, p.n]) }; }
      else if (tg.kind === "precip") { v = a.qpf; extra = { spread: a.qpfR.map((x) => r1(x, 3)), bounds: a.qpfBounds, used: a.parts.qpf.map((p) => [p.id, p.n]), flags: a.prorated ? ["nws-prorated"] : undefined }; }
      else if (tg.kind === "snow") { v = a.sn; extra = { used: a.parts.sn.map((p) => [p.id, p.n]) }; }
      else if (tg.kind === "prob") { v = a.chance ? a.chance.v / 100 : null; extra = { n: a.chance ? a.chance.members : 0, note: "ensemble members only" }; }
      if (v != null) (info.values[key] = info.values[key] || {})[d] = { v: r1(v, tg.kind === "temp" ? 1 : 3), ...extra };
    }));
    bundle.blends[rc.id] = info;
  });
  /* hourly temperature series (UTC ms), every source and blend, for the hourly target */
  const n = data.ms.length, series = {};
  present.forEach((id) => { const a = data.models[id].h.temperature_2m; if (S.hasData(a)) series[id] = a.map((x) => r1(x)); });
  recipes.forEach((rc) => { const ws = bundle.blends[rc.id].actual, ids = Object.keys(ws); if (!ids.length) return;
    const b = S.blendSeries(ids.map((id) => ({ w: B.w(ws, rc.rules, id, "temperature_2m"), data: data.models[id].h.temperature_2m })), n).mean; series["blend:" + rc.id] = b.map((x) => r1(x)); });
  bundle.hourly = { t0: data.ms[0], stepMs: 3600e3, n, temperature_2m: series };
  return bundle;
}
module.exports = { VERSION, buildData, normalize, sourceTarget, nwsOfficial };
