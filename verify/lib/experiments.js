/* Experimental temperature weights: fit once on earlier dates, evaluate only on later, unseen dates.
   See config/experiments.js for the protocol. Never changes a recipe or a default. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js");
const LN = require("./learn.js");
const SC = require("./score.js");
const CX = require("./context.js");
const BLENDS = require("../config/blends.js");
const VERSION = "experiments-v1";

/* Matched rows for an experiment: one per capture, target and date, primary only, with every source present
   and the prior recipe's own value for comparison. */
function rows(exp, pairs, issue) {
  const by = new Map();
  pairs.filter((p) => p.cls === "primary" && exp.targets.includes(p.target) && CX.leadBand(p.lead) === exp.band && (exp.sources.includes(p.id) || p.id === exp.prior))
    .forEach((p) => { const k = `${p.captureId}|${p.target}|${p.date}`; const r = by.get(k) || by.set(k, { captureId: p.captureId, target: p.target, date: p.date, o: p.o, v: {}, base: null }).get(k);
      if (p.id === exp.prior && p.track === "blend") r.base = p.v; else if (p.track === "source") r.v[p.id] = p.v; });
  return [...by.values()].filter((r) => r.base != null && exp.sources.every((s) => r.v[s] != null)).map((r) => {
    const x = issue[r.captureId], f = x && x.implied.byTarget[r.target] && x.implied.byTarget[r.target][r.date];
    return { ...r, startedAt: x ? x.startedAt : null, cond: exp.condition ? (exp.condition.dim === "forecastChange" ? (f ? f.changeClass : "unknown") : "unknown") : "all" };
  });
}
const priorWeights = (exp) => { const r = BLENDS.recipes.find((x) => x.id === exp.prior); const w = {}; exp.sources.forEach((s) => (w[s] = (r && r.weights[s]) || 0)); return w; };

function runAll(DATA, list, pairs, issue, nowMs) {
  const dir = path.join(DATA, "experiments"), out = [];
  list.forEach((exp) => {
    if (exp.condition && exp.condition.basis === "observed") { out.push({ id: exp.id, status: "refused: an observed-basis condition cannot select weights at issue time" }); return; }
    const all = rows(exp, pairs, issue), file = path.join(dir, `${exp.id}.fit.json`), fit = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const classes = [...new Set(all.map((r) => r.cond))].sort();
    if (!fit) {
      const per = classes.map((c) => ({ cls: c, dates: new Set(all.filter((r) => r.cond === c).map((r) => r.date)).size }));
      const known = per.filter((p) => p.cls !== "unknown"), ready = known.length > 0 && known.every((p) => p.dates >= exp.minTrainDates);
      if (!ready) { out.push({ id: exp.id, label: exp.label, status: "waiting for training dates", need: exp.minTrainDates, have: per, cases: all.length }); return; }
      const lastTrain = all.map((r) => r.date).sort().pop(), fits = {};
      per.filter((p) => p.cls !== "unknown").forEach((p) => { const rs = all.filter((r) => r.cond === p.cls); const f = LN.fitWeights(rs, exp.sources, priorWeights(exp)); fits[p.cls] = { ...f, dates: p.dates, from: rs.map((r) => r.date).sort()[0], to: rs.map((r) => r.date).sort().pop() }; });
      const rec = { version: VERSION, id: exp.id, fittedAt: U.iso(nowMs), lastTrainDate: lastTrain, embargoDays: exp.embargoDays, sources: exp.sources, prior: exp.prior, condition: exp.condition, fits, note: "experimental; never a default" };
      U.mkdirp(dir); fs.writeFileSync(file, JSON.stringify(rec, null, 1));
      out.push({ id: exp.id, label: exp.label, status: "fitted now; evaluation starts with later captures", fittedAt: rec.fittedAt, lastTrainDate: lastTrain, fits: Object.fromEntries(Object.entries(fits).map(([k, f]) => [k, { ok: f.ok, weights: f.weights, dates: f.dates, trainMAE: f.trainMAE, priorMAE: f.priorMAE }])) });
      return;
    }
    /* evaluation: captures started after the fit, valid dates beyond the embargo */
    const cut = U.addDays(fit.lastTrainDate, fit.embargoDays);
    const ev = all.filter((r) => r.startedAt && r.startedAt > fit.fittedAt && r.date > cut);
    const res = {};
    Object.entries(fit.fits).forEach(([cls, f]) => {
      if (!f.ok) { res[cls] = { status: `not fitted: ${f.why}` }; return; }
      const er = ev.filter((r) => r.cond === cls); if (!er.length) { res[cls] = { status: "no unseen cases yet", evalDates: 0 }; return; }
      const e = LN.evaluate(er, f.weights, (r) => Math.abs(r.base - r.o));
      const cand = er.reduce((s, r) => s + Math.abs(Object.keys(f.weights).reduce((t, k) => t + f.weights[k] * r.v[k], 0) - r.o), 0) / er.length, base = er.reduce((s, r) => s + Math.abs(r.base - r.o), 0) / er.length;
      res[cls] = { ...e, cases: er.length, candidateMAE: cand, priorMAE: base };
    });
    out.push({ id: exp.id, label: exp.label, status: "evaluating on unseen dates", fittedAt: fit.fittedAt, lastTrainDate: fit.lastTrainDate, evalAfter: cut, results: res });
  });
  return out;
}
module.exports = { VERSION, rows, runAll, priorWeights, MIN_DATES: SC.MIN_DATES };
