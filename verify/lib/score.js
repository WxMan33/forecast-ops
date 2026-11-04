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
const VERSION = "score-v3"; // v3: one capture per edition and source; primary/late/superseded/pilot classes; independence counts; lead hours
const ED = require("./editions.js");
const TM = require("./timing.js");
const MIN_DATES = 30; // distinct valid dates before any comparison is called anything but "insufficient"
const BLENDS = require("../config/blends.js");
/* A recipe is prospective only for captures that STARTED at or after its effectiveFrom. Values for an
   earlier capture (e.g. produced by re-normalizing old evidence) are labelled "retrospective" and never
   enter primary scorecards or matched comparisons. */
const EFFECTIVE = Object.fromEntries(BLENDS.recipes.concat(BLENDS.candidates || []).filter((r) => r.effectiveFrom).map((r) => [r.id, Date.parse(r.effectiveFrom)]));
const retrospective = (rid, cap) => EFFECTIVE[rid] != null && !(Date.parse(cap.startedAt) >= EFFECTIVE[rid]);

/* Bundles of the CURRENT normalizer version (older versions stay on disk beside them). */
function loadBundles(DATA, loc, version) {
  const caps = U.readJSONL(path.join(DATA, "captures", `${loc.id}.jsonl`));
  return caps.map((c) => {
    const p = bundlePath(c, loc, version); if (!fs.existsSync(path.join(DATA, p))) return null;
    try { const b = JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA, p))).toString()); b.__path = p; return b.error ? null : { cap: c, b, path: p }; } catch (e) { return null; }
  }).filter(Boolean);
}
const bundlePath = (cap, loc, version) => `normalized/${loc.id}/${cap.localDate.slice(0, 4)}/${cap.captureId}.${version}.json.gz`;
function loadCorrections(DATA) { return U.readJSONLDir(path.join(DATA, "corrections")); }

/* Apply review decisions and corrections (audit trail stays in corrections/). */
function reviewedTV(recs, corr) {
  /* A decision applies to its own capture. It also applies to another capture ONLY when all of these
     match: station, product, extraction version, evidence content hash and date interpretation (the
     dates assigned to the values). The same image re-published on another date, or re-extracted by a
     newer extractor, is not covered and goes back to review. */
  const key = (c) => `${c.captureId}|${c.product}`;
  const scope = (x) => [x.station, x.product, x.extractVersion, x.contentSha256, x.firstDate, x.lastDate].join("|");
  const recScope = (r) => scope({ station: r.station, product: r.product, extractVersion: r.extractVersion, contentSha256: r.evidence && r.evidence[0] && r.evidence[0].contentSha256, firstDate: r.days && r.days[0] && r.days[0].date, lastDate: r.days && r.days.length && r.days[r.days.length - 1].date });
  const byRec = new Map(), byScope = new Map();
  corr.forEach((c) => { if (c.kind !== "tv-review") return; (byRec.get(key(c)) || byRec.set(key(c), []).get(key(c))).push(c);
    if (c.scope && c.scope.contentSha256 && c.scope.extractVersion && c.scope.station && c.scope.firstDate) { const k = scope({ ...c.scope, product: c.product }); (byScope.get(k) || byScope.set(k, []).get(k)).push(c); } });
  return recs.filter((r) => r.status === "ok").map((r) => {
    const own = byRec.get(key(r)) || [], viaScope = (byScope.get(recScope(r)) || []).filter((c) => !own.includes(c));
    const cs = [...own, ...viaScope].sort((a, b) => a.at.localeCompare(b.at));
    let status = r.review ? r.review.status : "needs-review"; const days = JSON.parse(JSON.stringify(r.days || []));
    cs.forEach((c) => {
      if (c.decision === "approve") status = "approved";
      else if (c.decision === "reject") status = "rejected";
      else if (c.decision === "correct") { let d = days.find((x) => x.date === c.date); if (!d && c.date) { d = { date: c.date, by: {} }; days.push(d); } if (d) { d[c.field] = c.value; (d.corrected = d.corrected || []).push(c.field); } status = "corrected"; }
    });
    return { ...r, days, reviewStatus: status, corrections: cs.length, inheritedDecisions: viaScope.length };
  });
}

/* Forecast cases from bundles and TV records. */
function cases(bundles, tv, loc, capsById = {}) {
  const out = [];
  const add = (o) => out.push(o);
  bundles.forEach(({ cap, b }) => {
    const base = { captureId: cap.captureId, slot: cap.slot, trigger: cap.trigger, slotTarget: cap.slotTarget, edition: ED.isEdition(cap) ? `${loc.id}|${ED.editionId(cap)}` : null, timeliness: cap.timeliness && cap.timeliness.status, localDate: cap.localDate, retrievedLast: b.retrieval && b.retrieval.last, normVersion: b.version };
    const srcRet = (id) => (b.sourceIssue && b.sourceIssue[id] ? b.sourceIssue[id].retrievedAt : null);
    Object.entries(b.sources || {}).forEach(([id, o]) => Object.entries(o).forEach(([t, byD]) => Object.entries(byD).forEach(([d, x]) => add({ ...base, track: "source", id, selKey: `source:${id}`, selRetrieved: srcRet(id), target: t, date: d, lead: TG.leadDay(cap.localDate, d), v: x.v, ens: x.ens, flags: x.flags || [] }))));
    Object.entries((b.official && b.official.nws) || {}).forEach(([t, byD]) => Object.entries(byD).forEach(([d, x]) => add({ ...base, track: "source", id: "nws-official", selKey: "source:nws", selRetrieved: srcRet("nws"), target: t, date: d, lead: TG.leadDay(cap.localDate, d), v: x.v, flags: x.flags || [] })));
    Object.entries(b.blends || {}).forEach(([rid, info]) => Object.entries(info.values || {}).forEach(([t, byD]) => Object.entries(byD).forEach(([d, x]) => add({ ...base, track: "blend", id: rid, selKey: `blend:${rid}`, selRetrieved: base.retrievedLast, group: info.group, retrospective: retrospective(rid, cap), target: t, date: d, lead: TG.leadDay(cap.localDate, d), v: x.v, spread: x.spread, flags: x.flags || [] }))));
  });
  tv.forEach((r) => {
    if (!["auto-accepted", "approved", "corrected"].includes(r.reviewStatus)) return;
    const cap = capsById[r.captureId] || {};
    const base = { captureId: r.captureId, slot: r.slot, trigger: cap.trigger, slotTarget: r.slotTarget || cap.slotTarget, edition: ED.isEdition(cap) ? `${loc.id}|${ED.editionId(cap)}` : null, timeliness: r.timeliness && r.timeliness.status, localDate: r.captureId.slice(0, 10), track: "tv", id: r.product, selKey: `tv:${r.product}`, selRetrieved: r.retrievedAt, station: r.station, locClass: r.location && r.location.class, retrievedLast: r.retrievedAt, extractVersion: r.extractVersion, reviewStatus: r.reviewStatus };
    const got = Date.parse(r.retrievedAt);
    (r.days || []).forEach((d) => {
      /* prospective only: skip any date whose target window had begun before retrieval */
      const fut = (t) => TM.windowOk(TG.TARGETS[t].window(d.date, loc)[0], got);
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
  pairs.filter((p) => p.target === target && p.lead === lead && p.slot === slot && p.cls === "primary" && members.includes(p.id)).forEach((p) => { const k = `${p.captureId}|${p.date}`; (idx.get(k) || idx.set(k, {}).get(k))[p.id] = p; });
  const rows = [...idx.values()].filter((r) => members.every((m) => r[m]));
  if (!rows.length) return { n: 0, members };
  const kind = (TG.TARGETS[target] || {}).kind, loss = (p) => (kind === "prob" ? (p.v - p.o) ** 2 : Math.abs(p.v - p.o));
  const res = { n: rows.length, dates: new Set(rows.map((r) => r[members[0]].date)).size, members: {}, ref, metric: kind === "prob" ? "Brier" : "MAE" };
  members.forEach((m) => { const d = rows.map((r) => r[m].sourceTimeliness && r[m].sourceTimeliness.delayMin).filter((x) => x != null);
    res.members[m] = { score: mean(rows.map((r) => loss(r[m]))), retrievalDelayMin: d.length ? { mean: Math.round(mean(d) * 10) / 10, max: Math.max(...d) } : null }; });
  members.filter((m) => m !== ref && members.includes(ref)).forEach((m) => {
    const byDate = {}; rows.forEach((r) => { (byDate[r[m].date] = byDate[r[m].date] || []).push(loss(r[m]) - loss(r[ref])); });
    const ci = blockBootstrap(byDate);
    const verdict = res.dates < MIN_DATES ? "insufficient evidence" : !ci ? "insufficient evidence" : ci.hi < 0 ? `better than ${ref}` : ci.lo > 0 ? `worse than ${ref}` : "no clear difference";
    Object.assign(res.members[m], { diffVsRef: res.members[m].score - res.members[ref].score, ci90: ci && [ci.lo, ci.hi], verdict });
  });
  return res;
}

/* opts.receipts: GitHub confirmation context (lib/receipts.js confirmContext); without it personal
   forecasts wait for confirmed receipts and are not scored. */
function scoreAll(DATA, loc, nowMs = Date.now(), normVersion = require("./normalize.js").VERSION, opts = {}) {
  const obsRows = U.readJSONLDir(path.join(DATA, "obs", loc.id));
  const best = OBS.best(obsRows);
  const bundles = loadBundles(DATA, loc, normVersion);
  const tv = reviewedTV(U.readJSONLDir(path.join(DATA, "tv", loc.id)), loadCorrections(DATA));
  const capsAll = U.readJSONL(path.join(DATA, "captures", `${loc.id}.jsonl`)), capsById = Object.fromEntries(capsAll.map((c) => [c.captureId, c]));
  const all = cases(bundles, tv, loc, capsById);
  /* one capture per edition and source/product (see lib/editions.js) */
  const seen = new Set(), items = [];
  all.forEach((c) => { if (!c.edition) return; const k = `${c.edition}|${c.selKey}|${c.captureId}`; if (seen.has(k)) return; seen.add(k); items.push({ edition: c.edition, key: c.selKey, captureId: c.captureId, retrievedAt: c.selRetrieved, target: c.slotTarget }); });
  const sel = ED.select(items);
  all.forEach((c) => {
    if (c.retrospective) { c.cls = "retrospective"; return; }
    if (!c.edition) { c.cls = "pilot"; return; }
    const s = sel.get(`${c.edition}|${c.selKey}|${c.captureId}`);
    c.sourceTimeliness = s ? s.timeliness : null;
    c.cls = !s || !s.selected ? "superseded" : s.timeliness.status === "on_time" ? "primary" : "late";
  });
  const PERSONAL = require('./personal.js');
  const personal = PERSONAL.load(DATA, loc, nowMs, opts.receipts || null);
  const personalScored = PERSONAL.score(personal, best, loc, nowMs);
  const pairs = personalScored.pairs.slice(), pending = [];
  /* personal pairs carry the time GitHub received them as their retrieval boundary */
  const rejected = [];
  all.forEach((c) => {
    if (!TG.TARGETS[c.target]) return;
    const o = best.get(`${c.target}|${c.date}`);
    /* boundary re-checked at scoring time (defence in depth): the window must start after retrieval + minimum lead */
    if (!c.retrievedLast || !TM.windowOk(TG.TARGETS[c.target].window(c.date, loc)[0], Date.parse(c.retrievedLast))) { rejected.push({ ...c, why: "window starts before retrieval + minimum lead" }); return; }
    if (o) pairs.push({ ...c, leadHours: Math.round((TG.TARGETS[c.target].window(c.date, loc)[0] - Date.parse(c.retrievedLast)) / 360e3) / 10, o: o.value, obsSrc: o.src, obsStatus: o.status, obsRevised: o.revised, obsWindowStart: U.iso(TG.TARGETS[c.target].window(c.date, loc)[0]), leadMinToWindow: TM.leadMin(TG.TARGETS[c.target].window(c.date, loc)[0], Date.parse(c.retrievedLast)) });
    else { const end = TG.TARGETS[c.target].window(c.date, loc)[1]; if (end < nowMs) pending.push({ target: c.target, date: c.date }); }
  });
  /* hourly temperature (valid instants), by lead day; the observation's MEASUREMENT time must be at
     least the minimum lead after the capture's last retrieval */
  const hourly = {}, hourlyPairs = [];
  bundles.forEach(({ cap, b }) => {
    if (!b.hourly || !b.retrieval || !b.retrieval.last) return; const last = Date.parse(b.retrieval.last);
    Object.entries(b.hourly.temperature_2m || {}).forEach(([id, arr]) => arr.forEach((v, i) => {
      if (v == null) return; const t = b.hourly.t0 + i * b.hourly.stepMs;
      const o = best.get(`temp_hourly|${t}`); if (!o || o.obsAt == null) return;
      if (!TM.obsOk(o.obsAt, last)) return;
      const ld = Math.ceil((t - last) / 86400e3), k = `${id}|${ld}|${cap.slot}`, e = v - o.value;
      const ed = ED.isEdition(cap) ? `${loc.id}|${ED.editionId(cap)}` : null, sk = id.startsWith("blend:") ? id : `source:${id}`, sv = ed && sel.get(`${ed}|${sk}|${cap.captureId}`);
      const cls = id.startsWith("blend:") && retrospective(id.slice(6), cap) ? "retrospective" : !ed ? "pilot" : !sv || !sv.selected ? "superseded" : sv.timeliness.status === "on_time" ? "primary" : "late";
      hourlyPairs.push({ cls, leadHours: Math.round((t - last) / 360e3) / 10, captureId: cap.captureId, slot: cap.slot, timeliness: cap.timeliness && cap.timeliness.status, id, valid: U.iso(t), v, o: o.value, obsMeasured: U.iso(o.obsAt), obsIngested: o.seenAt, obsRawSha: o.sha, obsReport: o.report, retrievedLast: b.retrieval.last, leadMin: TM.leadMin(o.obsAt, last), normVersion: b.version, bundle: b.__path });
      const hk = `${k}|${cls}`, h = (hourly[hk] = hourly[hk] || { id, leadDay: ld, slot: cap.slot, cls, n: 0, abs: 0, sum: 0, in2: 0, hours: new Set(), dates: new Set(), lead: [] });
      h.n++; h.abs += Math.abs(e); h.sum += e; h.in2 += Math.abs(e) <= 2 ? 1 : 0; h.hours.add(t); h.dates.add(new Date(t + loc.lstOffsetMin * 60e3).toISOString().slice(0, 10)); h.lead.push((t - last) / 3600e3);
    }));
  });
  /* sample description: unique dates, 7-day blocks, and DESCRIPTIVE wet/dry groups (maximal runs of
     consecutive climate days with the same observed wet/dry state, split at 7 days). The groups describe
     the weather sampled; they are not a test or proof of statistical independence. Uncertainty comes
     from the 7-day block bootstrap. */
  const wet = {}; best.forEach((v, k) => { const [t, d] = k.split("|"); if (t === "precip_clim") wet[d] = v.value >= 0.01; });
  const epi = {}; { let prev = null, id = 0, len = 0; Object.keys(wet).sort().forEach((d) => { const cont = prev && U.dayDiff(prev.d, d) === 1 && prev.w === wet[d] && len < 7; if (!cont) { id++; len = 0; } len++; epi[d] = `${wet[d] ? "wet" : "dry"}-${id}`; prev = { d, w: wet[d] }; }); }
  const block = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / (7 * 86400e3));
  const indep = (dates) => { const u = [...new Set(dates)]; return { uniqueDates: u.length, blocks7d: new Set(u.map(block)).size, episodes: new Set(u.map((d) => epi[d] || `unknown-${block(d)}`)).size, episodesKnown: u.filter((d) => epi[d]).length === u.length }; };
  const leadStats = (a) => (a.length ? { meanH: Math.round(a.reduce((s, x) => s + x, 0) / a.length * 10) / 10, minH: Math.round(Math.min(...a) * 10) / 10, maxH: Math.round(Math.max(...a) * 10) / 10 } : null);
  /* summaries: primary (scheduled, selected, on time) separate from late, superseded and pilot */
  const groups = {};
  pairs.forEach((p) => { const k = [p.track, p.id, p.target, p.lead, p.slot, p.cls].join("|"); (groups[k] = groups[k] || []).push(p); });
  const summary = Object.entries(groups).map(([k, ps]) => { const [track, id, target, lead, slot, cls] = k.split("|"); return { track, id, target, lead: +lead, leadGroup: TG.leadGroup(+lead), slot, cls, timeliness: cls === "primary" ? "on_time" : cls, ...metrics(target, ps), ...indep(ps.map((p) => p.date)), leadHours: leadStats(ps.map((p) => p.leadHours)), ens: ensMetrics(ps), obsRevised: ps.filter((p) => p.obsRevised).length, flags: [...new Set(ps.flatMap((p) => p.flags || []))] }; });
  /* matched comparisons: OPE blends + benchmarks + sources (temperature and PoP), TV pilot separately */
  const comps = [];
  const opeMembers = ["baseline-v1", "equal-raw-v1", "ecmwf-ens-only", "gefs-only", "nbm-only", "nws-only"];
  /* The operational default (site preset, archived with an effectiveFrom) in its own set, so editions
     captured before it existed still count in the established set above. */
  /* the scoped (short/long-range) default: its own set, with Default v2 and Baseline v1, so the
     short-range emphasis is judged against both on the same cases */
  const scopedRecipe = BLENDS.recipes.find((r) => r.rules && r.rules.periodWeights), scopedMembers = scopedRecipe ? [scopedRecipe.id, U.Core.blend.PREFERRED.id, ...opeMembers].filter((x, k, a) => a.indexOf(x) === k && BLENDS.recipes.some((r) => r.id === x)) : null;
  const defaultId = U.Core.blend.PREFERRED.id, defaultMembers = BLENDS.recipes.some((r) => r.id === defaultId) && !opeMembers.includes(defaultId) ? [defaultId, ...opeMembers] : null;
  const tvIds = [...new Set(pairs.filter((p) => p.track === "tv" && p.locClass !== "explicit-other-point").map((p) => p.id))];
  ["tmax_clim", "tmin_clim", "pop01_clim", "precip_clim"].forEach((t) => [1, 2, 3, 4, 5, 6, 7].forEach((L) => ["midday", "evening"].forEach((sl) => { const r = matched(pairs, opeMembers, "baseline-v1", t, L, sl); if (r.n) comps.push({ set: "ope", target: t, lead: L, slot: sl, ...r });
    if (defaultMembers) { const d = matched(pairs, defaultMembers, "baseline-v1", t, L, sl); if (d.n) comps.push({ set: "default", target: t, lead: L, slot: sl, ...d }); }
    if (scopedMembers) { const d = matched(pairs, scopedMembers, "baseline-v1", t, L, sl); if (d.n) comps.push({ set: "scoped", target: t, lead: L, slot: sl, ...d }); } })));
  ["tmax_clim", "tmin_night", "pop01_clim"].forEach((t) => [1, 2, 3, 4, 5, 6, 7].forEach((L) => ["midday", "evening"].forEach((sl) => { const mem = [...tvIds, "baseline-v1"]; if (tvIds.length) { const r = matched(pairs, mem, "baseline-v1", t, L, sl); if (r.n) comps.push({ set: "tv-pilot", target: t, lead: L, slot: sl, ...r }); } })));
  const obsBest = [...best.entries()].filter(([k]) => !k.startsWith("temp_hourly")).map(([k, v]) => { const [target, date] = k.split("|"); return { target, date, ...v }; });
  /* eligibility counts per source/product: prospective values held, matched to an observation, scored */
  const elig = {};
  const E = (track, id) => (elig[`${track}|${id}`] = elig[`${track}|${id}`] || { track, id, eligible: 0, matched: 0, scored: 0, hourlyEligible: 0, hourlyScored: 0 });
  all.forEach((c) => { if (TG.TARGETS[c.target] && c.retrievedLast && TM.windowOk(TG.TARGETS[c.target].window(c.date, loc)[0], Date.parse(c.retrievedLast))) E(c.track, c.id).eligible++; });
  pairs.forEach((p) => { const e = E(p.track, p.id); e.matched++; e.scored++; });
  bundles.forEach(({ b }) => { if (!b.hourly || !b.retrieval || !b.retrieval.last) return; const last = Date.parse(b.retrieval.last);
    Object.entries(b.hourly.temperature_2m || {}).forEach(([id, arr]) => { const tr = id.startsWith("blend:") ? "blend" : "source", nm = id.replace(/^blend:/, "");
      arr.forEach((v, i) => { if (v != null && TM.obsOk(b.hourly.t0 + i * b.hourly.stepMs - TM.MATCH_TOLERANCE_MIN * 60e3, last)) E(tr, nm).hourlyEligible++; }); }); });
  hourlyPairs.forEach((p) => { E(p.id.startsWith("blend:") ? "blend" : "source", p.id.replace(/^blend:/, "")).hourlyScored++; });
  return { personal: { ...personal, ...personalScored }, version: VERSION, timing: TM.VERSION, normVersion, eligibility: Object.values(elig), at: U.iso(nowMs), pairs, hourlyPairs, rejected, pending, obsBest, summary, hourly: Object.values(hourly).map((h) => ({ id: h.id, leadDay: h.leadDay, slot: h.slot, cls: h.cls, n: h.n, uniqueHours: h.hours.size, ...indep([...h.dates]), leadHours: leadStats(h.lead), mae: h.abs / h.n, bias: h.sum / h.n, within2: h.in2 / h.n })), editionsVersion: ED.VERSION, comparisons: comps, bundles: bundles.length, tv, obsCount: obsRows.length, minDates: MIN_DATES };
}
module.exports = { VERSION, EFFECTIVE, retrospective, scoreAll, cases, metrics, ensMetrics, matched, blockBootstrap, reviewedTV, MIN_DATES };
