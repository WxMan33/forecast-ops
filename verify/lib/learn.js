/* Preparation for local blend learning. Nothing here changes a default: candidates are fitted on
   EARLIER dates, evaluated on LATER dates, run in parallel, and promoted only by a recorded decision
   after demonstrating improvement on unseen dates.
   - Splits are by time with an embargo gap (no random splits; one weather episode never sits on both sides).
   - Weights are per variable and broad lead group (d1-2, d3-4, d5-7), non-negative, summing to 1, at the
     SYSTEM level (an ensemble is one source, never one vote per member), and shrunk toward Baseline v1.
   - Bias corrections are shrunk toward zero with small samples.
   - Source overlap (NBM, NWS and raw models share inputs) is measured, not assumed away. */
"use strict";
const SC = require("./score.js");
const TG = require("./targets.js");
const VERSION = "learn-v1";
const MODES = {
  "brads-preferred": { recipe: "baseline-v1", label: "Brad's preferred (Baseline v1)" },
  "local-verified": { recipe: null, label: "Local verified", rule: "set only by a recorded promotion after improvement on unseen dates" },
  custom: { recipe: null, label: "Custom" },
};
const PROMOTION = { minEvalDates: 60, ciLevel: 0.9, requireAllLeadGroupsNotWorse: true, embargoDays: 3, minTrainDates: 60 };

/* Time split: train = dates <= trainEnd - embargo; eval = dates > trainEnd. */
function timeSplit(pairs, trainEnd, embargoDays = PROMOTION.embargoDays) {
  const cut = new Date(Date.parse(trainEnd + "T00:00:00Z") - embargoDays * 86400e3).toISOString().slice(0, 10);
  return { train: pairs.filter((p) => p.date <= cut), eval: pairs.filter((p) => p.date > trainEnd), embargo: [cut, trainEnd] };
}
/* Rows of matched cases: {date, o, v:{source: value}} for one target and lead group (on-time captures only). */
function caseRows(pairs, target, group, sources) {
  const by = new Map();
  pairs.filter((p) => p.target === target && TG.leadGroup(p.lead) === group && p.timeliness === "on_time" && sources.includes(p.id) && p.track === "source")
    .forEach((p) => { const k = `${p.captureId}|${p.date}`; const r = by.get(k) || by.set(k, { date: p.date, o: p.o, v: {} }).get(k); r.v[p.id] = p.v; });
  return [...by.values()].filter((r) => sources.every((s) => r.v[s] != null));
}
const mae = (rows, w) => rows.reduce((t, r) => t + Math.abs(Object.keys(w).reduce((s, k) => s + w[k] * r.v[k], 0) - r.o), 0) / rows.length;
/* Constrained weights by coordinate search on the simplex, penalised toward the baseline shares. */
function fitWeights(rows, sources, prior, { lambda = 2, step = 0.05, iters = 200 } = {}) {
  if (rows.length < 10) return { ok: false, why: "too few cases" };
  const norm = (w) => { const t = sources.reduce((s, k) => s + Math.max(0, w[k] || 0), 0) || 1; const o = {}; sources.forEach((k) => (o[k] = Math.max(0, w[k] || 0) / t)); return o; };
  const p = norm(prior), loss = (w) => mae(rows, w) + lambda * sources.reduce((s, k) => s + (w[k] - p[k]) ** 2, 0);
  let w = { ...p }, cur = loss(w);
  for (let it = 0; it < iters; it++) {
    let improved = false;
    for (const a of sources) for (const b of sources) {
      if (a === b || w[b] < step) continue;
      const t = { ...w }; t[a] += step; t[b] -= step; const l = loss(t);
      if (l < cur - 1e-9) { w = t; cur = l; improved = true; }
    }
    if (!improved) break;
  }
  return { ok: true, weights: w, trainMAE: mae(rows, w), priorMAE: mae(rows, p), n: rows.length, lambda };
}
/* Shrunk mean error (subtract to correct). k = pseudo-count toward zero. */
function biasCorrection(errors, k = 20) { const n = errors.length; if (!n) return 0; const m = errors.reduce((s, x) => s + x, 0) / n; return (m * n) / (n + k); }
/* Pairwise error correlation between sources on shared cases (overlap check). */
function errorCorrelation(pairs, target, ids) {
  const by = new Map(); pairs.filter((p) => p.target === target && ids.includes(p.id)).forEach((p) => { const k = `${p.captureId}|${p.date}`; (by.get(k) || by.set(k, {}).get(k))[p.id] = p.v - p.o; });
  const rows = [...by.values()], out = {};
  ids.forEach((a) => ids.forEach((b) => { if (a >= b) return; const x = rows.filter((r) => r[a] != null && r[b] != null); if (x.length < 10) return;
    const ma = x.reduce((s, r) => s + r[a], 0) / x.length, mb = x.reduce((s, r) => s + r[b], 0) / x.length;
    const cov = x.reduce((s, r) => s + (r[a] - ma) * (r[b] - mb), 0), va = x.reduce((s, r) => s + (r[a] - ma) ** 2, 0), vb = x.reduce((s, r) => s + (r[b] - mb) ** 2, 0);
    out[`${a}~${b}`] = { r: cov / Math.sqrt(va * vb || 1), n: x.length }; }));
  return out;
}
/* Evaluate a fitted candidate against Baseline v1 on unseen dates; returns status, never promotes. */
function evaluate(evalRows, candW, baseRowsMAEFn) {
  const dates = new Set(evalRows.map((r) => r.date));
  const byDate = {}; evalRows.forEach((r) => { const c = Math.abs(Object.keys(candW).reduce((s, k) => s + candW[k] * r.v[k], 0) - r.o); (byDate[r.date] = byDate[r.date] || []).push(c - baseRowsMAEFn(r)); });
  const ci = SC.blockBootstrap(byDate);
  const status = dates.size < PROMOTION.minEvalDates ? "candidate: insufficient unseen dates" : ci && ci.hi < 0 ? "candidate: improved on unseen dates (eligible for a recorded promotion decision)" : "candidate: no demonstrated improvement";
  return { evalDates: dates.size, ci90: ci && [ci.lo, ci.hi], status };
}
module.exports = { VERSION, MODES, PROMOTION, timeSplit, caseRows, fitWeights, biasCorrection, errorCorrelation, evaluate };
