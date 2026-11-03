/* Scoring: pairs every archived forecast with the best available observation for the SAME target
   window, then summarizes by track, source/product, target, lead day and capture slot.
   Rules: missing observations stay unscored (listed as pending); late captures are reported but
   excluded from matched comparisons; TV values count only after auto-acceptance or review approval;
   matched comparisons use only cases every competitor has; uncertainty comes from a block bootstrap
   over 7-day blocks of valid dates (forecasts of the same episode are correlated). */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js");
const OBS = require("./obs.js");
const TG = require("./targets.js");
const VERSION = "score-v1";
const MIN_DATES = 30; // distinct valid dates before any comparison is called anything but "insufficient"

function loadBundles(DATA, loc) {
  const caps = U.readJSONL(path.join(DATA, "captures", `${loc.id}.jsonl`));
  return caps.filter((c) => c.normalized && c.normalized.path && !c.normalized.error).map((c) => {
    try { return { cap: c, b: JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA, c.normalized.path))).toString()) }; } catch (e) { return null; }
  }).filter(Boolean);
}
function loadCorrections(DATA) { return U.readJSONLDir(path.join(DATA, "corrections")); }

/* Apply review decisions and corrections (audit trail stays in corrections/). */
function reviewedTV(recs, corr) {
  const key = (c) => `${c.captureId}|${c.product}`;
  const byRec = new Map(); corr.forEach((c) => { if (c.kind === "tv-review") (byRec.get(key(c)) || byRec.set(key(c), []).get(key(c))).push(c); });
  return recs.filter((r) => r.status === "ok").map((r) => {
    const cs = (byRec.get(key(r)) || []).sort((a, b) => a.at.localeCompare(b.at));
    let status = r.review ? r.review.status : "needs-review"; const days = JSON.parse(JSON.stringify(r.days || []));
    cs.forEach((c) => {
      if (c.decision === "approve") status = "approved";
      else if (c.decision === "reject") status = "rejected";
      else if (c.decision === "correct") { let d = days.find((x) => x.date === c.date); if (!d && c.date) { d = { date: c.date, by: {} }; days.push(d); } if (d) { d[c.field] = c.value; (d.corrected = d.corrected || []).push(c.field); } status = "corrected"; }
    });
    return { ...r, days, reviewStatus: status, corrections: cs.length };
  });
}

/* Forecast cases from bundles and TV records. */
function cases(bundles, tv, loc) {
  const out = [];
  const add = (o) => out.push(o);
  bundles.forEach(({ cap, b }) => {
    const base = { captureId: cap.captureId, slot: cap.slot, timeliness: cap.timeliness && cap.timeliness.status, localDate: cap.localDate };
    Object.entries(b.sources || {}).forEach(([id, o]) => Object.entries(o).forEach(([t, byD]) => Object.entries(byD).forEach(([d, x]) => add({ ...base, track: "source", id, target: t, date: d, lead: TG.leadDay(cap.localDate, d), v: x.v, ens: x.ens, flags: x.flags || [] }))));
    Object.entries((b.official && b.official.nws) || {}).forEach(([t, byD]) => Object.entries(byD).forEach(([d, x]) => add({ ...base, track: "source", id: "nws-official", target: t, date: d, lead: TG.leadDay(cap.localDate, d), v: x.v, flags: x.flags || [] })));
    Object.entries(b.blends || {}).forEach(([rid, info]) => Object.entries(info.values || {}).forEach(([t, byD]) => Object.entries(byD).forEach(([d, x]) => add({ ...base, track: "blend", id: rid, group: info.group, target: t, date: d, lead: TG.leadDay(cap.localDate, d), v: x.v, spread: x.spread, flags: x.flags || [] }))));
  });
  tv.forEach((r) => {
    if (!["auto-accepted", "approved", "corrected"].includes(r.reviewStatus)) return;
    const base = { captureId: r.captureId, slot: r.slot, timeliness: r.timeliness && r.timeliness.status, localDate: r.captureId.slice(0, 10), track: "tv", id: r.product, station: r.station, locClass: r.location && r.location.class };
    const got = Date.parse(r.retrievedAt);
    (r.days || []).forEach((d) => {
      /* prospective only: skip any date whose target window had begun before retrieval */
      const fut = (t) => TG.TARGETS[t].window(d.date, loc)[0] > got;
      const lead = TG.leadDay(base.localDate, d.date), fl = (k) => [d.by && d.by[k] ? `by:${d.by[k]}` : null, d.corrected && d.corrected.includes(k) ? "corrected" : null].filter(Boolean);
      if (d.hi != null && fut("tmax_clim")) add({ ...base, target: "tmax_clim", date: d.date, lead, v: d.hi, flags: fl("hi") });
      if (d.lo != null && r.lows === "following-night" && fut("tmin_night")) add({ ...base, target: "tmin_night", date: d.date, lead, v: d.lo, flags: fl("lo") });
      if (d.pop != null && fut("pop01_clim")) add({ ...base, target: "pop01_clim", date: d.date, lead, v: d.pop / 100, flags: [...fl("pop"), "period-unspecified"] });
      if (d.popDay != null && fut("pop01_day12")) add({ ...base, target: "pop01_day12", date: d.date, lead, v: d.popDay / 100, flags: ["civil 7a-7p"] });
      if (d.popNight != null && fut("pop01_night12")) add({ ...base, target: "pop01_night12", date: d.date, lead, v: d.popNight / 100, flags: ["civil 7p-7a"] });
    });
  });
  return out;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function metrics(target, ps) {
  const tg = TG.TARGETS[target] || { kind: "temp" }, n = ps.length;
  if (!n) return { n: 0 };
  const e = ps.map((p) => p.v - p.o);
  if (tg.kind === "temp") return { n, mae: mean(e.map(Math.abs)), bias: mean(e), within2: mean(e.map((x) => (Math.abs(x) <= 2 ? 1 : 0))), dates: new Set(ps.map((p) => p.date)).size };
  if (tg.kind === "precip" || tg.kind === "snow") { const wet = ps.filter((p) => p.o >= 0.01); return { n, mae: mean(e.map(Math.abs)), bias: mean(e), wet: { n: wet.length, mae: mean(wet.map((p) => Math.abs(p.v - p.o))), bias: mean(wet.map((p) => p.v - p.o)) }, dry: { n: n - wet.length, falseWet: mean(ps.filter((p) => p.o < 0.01).map((p) => (p.v >= 0.01 ? 1 : 0))) }, dates: new Set(ps.map((p) => p.date)).size }; }
  if (tg.kind === "prob") { const br = mean(ps.map((p) => (p.v - p.o) ** 2)), base = mean(ps.map((p) => p.o)); return { n, brier: br, baseRate: base, brierClim: base * (1 - base), dates: new Set(ps.map((p) => p.date)).size }; }
  return { n };
}
function ensMetrics(ps) {
  const e = ps.filter((p) => p.ens && p.ens.mn != null); if (!e.length) return null;
  return { n: e.length, inRange: mean(e.map((p) => (p.o >= p.ens.mn && p.o <= p.ens.mx ? 1 : 0))), in10_90: mean(e.map((p) => (p.o >= p.ens.p10 && p.o <= p.ens.p90 ? 1 : 0))), width: mean(e.map((p) => p.ens.mx - p.ens.mn)), width10_90: mean(e.map((p) => p.ens.p90 - p.ens.p10)) };
}
/* Deterministic block bootstrap of the mean paired difference, blocks = 7 consecutive valid dates. */
function blockBootstrap(diffsByDate, iters = 2000, seed = 12345) {
  const dates = Object.keys(diffsByDate).sort(); if (dates.length < 2) return null;
  const blocks = []; for (let i = 0; i < dates.length; i += 7) blocks.push(dates.slice(i, i + 7).flatMap((d) => diffsByDate[d]));
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const means = [];
  for (let k = 0; k < iters; k++) { let t = 0, c = 0; for (let j = 0; j < blocks.length; j++) { const b = blocks[Math.floor(rnd() * blocks.length)]; b.forEach((x) => { t += x; c++; }); } means.push(t / c); }
  means.sort((a, b) => a - b);
  return { lo: means[Math.floor(0.05 * iters)], hi: means[Math.floor(0.95 * iters)], blocks: blocks.length };
}
/* Matched comparison: cases every member has (same capture, same valid date, on time). */
function matched(pairs, members, ref, target, lead, slot) {
  const idx = new Map();
  pairs.filter((p) => p.target === target && p.lead === lead && p.slot === slot && p.timeliness === "on_time" && members.includes(p.id)).forEach((p) => { const k = `${p.captureId}|${p.date}`; (idx.get(k) || idx.set(k, {}).get(k))[p.id] = p; });
  const rows = [...idx.values()].filter((r) => members.every((m) => r[m]));
  if (!rows.length) return { n: 0, members };
  const kind = (TG.TARGETS[target] || {}).kind, loss = (p) => (kind === "prob" ? (p.v - p.o) ** 2 : Math.abs(p.v - p.o));
  const res = { n: rows.length, dates: new Set(rows.map((r) => r[members[0]].date)).size, members: {}, ref, metric: kind === "prob" ? "Brier" : "MAE" };
  members.forEach((m) => { res.members[m] = { score: mean(rows.map((r) => loss(r[m]))) }; });
  members.filter((m) => m !== ref && members.includes(ref)).forEach((m) => {
    const byDate = {}; rows.forEach((r) => { (byDate[r[m].date] = byDate[r[m].date] || []).push(loss(r[m]) - loss(r[ref])); });
    const ci = blockBootstrap(byDate);
    const verdict = res.dates < MIN_DATES ? "insufficient evidence" : !ci ? "insufficient evidence" : ci.hi < 0 ? `better than ${ref}` : ci.lo > 0 ? `worse than ${ref}` : "no clear difference";
    Object.assign(res.members[m], { diffVsRef: res.members[m].score - res.members[ref].score, ci90: ci && [ci.lo, ci.hi], verdict });
  });
  return res;
}

function scoreAll(DATA, loc, nowMs = Date.now()) {
  const obsRows = U.readJSONLDir(path.join(DATA, "obs", loc.id));
  const best = OBS.best(obsRows);
  const bundles = loadBundles(DATA, loc);
  const tv = reviewedTV(U.readJSONLDir(path.join(DATA, "tv", loc.id)), loadCorrections(DATA));
  const all = cases(bundles, tv, loc);
  const pairs = [], pending = [];
  all.forEach((c) => {
    if (!TG.TARGETS[c.target]) return;
    const o = best.get(`${c.target}|${c.date}`);
    if (o) pairs.push({ ...c, o: o.value, obsSrc: o.src, obsStatus: o.status, obsRevised: o.revised });
    else { const end = TG.TARGETS[c.target].window(c.date, loc)[1]; if (end < nowMs) pending.push({ target: c.target, date: c.date }); }
  });
  /* hourly temperature (valid instants), by lead day */
  const hourly = {};
  bundles.forEach(({ cap, b }) => {
    if (!b.hourly) return; const start = Date.parse(cap.startedAt);
    Object.entries(b.hourly.temperature_2m || {}).forEach(([id, arr]) => arr.forEach((v, i) => {
      if (v == null) return; const t = b.hourly.t0 + i * b.hourly.stepMs; if (t <= start) return;
      const o = best.get(`temp_hourly|${t}`); if (!o) return;
      const ld = Math.ceil((t - start) / 86400e3), k = `${id}|${ld}|${cap.slot}`, e = v - o.value;
      const h = (hourly[k] = hourly[k] || { id, leadDay: ld, slot: cap.slot, n: 0, abs: 0, sum: 0, in2: 0 }); h.n++; h.abs += Math.abs(e); h.sum += e; h.in2 += Math.abs(e) <= 2 ? 1 : 0;
    }));
  });
  /* summaries */
  const groups = {};
  pairs.forEach((p) => { const k = [p.track, p.id, p.target, p.lead, p.slot, p.timeliness === "on_time" ? "on_time" : p.timeliness].join("|"); (groups[k] = groups[k] || []).push(p); });
  const summary = Object.entries(groups).map(([k, ps]) => { const [track, id, target, lead, slot, tl] = k.split("|"); return { track, id, target, lead: +lead, slot, timeliness: tl, ...metrics(target, ps), ens: ensMetrics(ps), obsRevised: ps.filter((p) => p.obsRevised).length, flags: [...new Set(ps.flatMap((p) => p.flags || []))] }; });
  /* matched comparisons: OPE blends + benchmarks + sources (temperature and PoP), TV pilot separately */
  const comps = [];
  const opeMembers = ["baseline-v1", "equal-raw-v1", "ecmwf-ens-only", "gefs-only", "nbm-only", "nws-only"];
  const tvIds = [...new Set(pairs.filter((p) => p.track === "tv" && p.locClass !== "explicit-other-point").map((p) => p.id))];
  ["tmax_clim", "tmin_clim", "pop01_clim", "precip_clim"].forEach((t) => [1, 2, 3, 4, 5, 6, 7].forEach((L) => ["midday", "evening"].forEach((sl) => { const r = matched(pairs, opeMembers, "baseline-v1", t, L, sl); if (r.n) comps.push({ set: "ope", target: t, lead: L, slot: sl, ...r }); })));
  ["tmax_clim", "tmin_night", "pop01_clim"].forEach((t) => [1, 2, 3, 4, 5, 6, 7].forEach((L) => ["midday", "evening"].forEach((sl) => { const mem = [...tvIds, "baseline-v1"]; if (tvIds.length) { const r = matched(pairs, mem, "baseline-v1", t, L, sl); if (r.n) comps.push({ set: "tv-pilot", target: t, lead: L, slot: sl, ...r }); } })));
  const obsBest = [...best.entries()].filter(([k]) => !k.startsWith("temp_hourly")).map(([k, v]) => { const [target, date] = k.split("|"); return { target, date, ...v }; });
  return { version: VERSION, at: U.iso(nowMs), pairs, pending, obsBest, summary, hourly: Object.values(hourly).map((h) => ({ id: h.id, leadDay: h.leadDay, slot: h.slot, n: h.n, mae: h.abs / h.n, bias: h.sum / h.n, within2: h.in2 / h.n })), comparisons: comps, bundles: bundles.length, tv, obsCount: obsRows.length, minDates: MIN_DATES };
}
module.exports = { VERSION, scoreAll, cases, metrics, ensMetrics, matched, blockBootstrap, reviewedTV, MIN_DATES };
