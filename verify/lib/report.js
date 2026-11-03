/* Private reports written into the data repository: STATUS.md (collector health), SCORECARD.md,
   review queue and a compact index for the dashboard. Nothing here is published. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js");
const TG = require("./targets.js");
const SCHED = require("../config/schedule.js");
const SCH = require("./schedule.js");

const f = (x, d = 1) => (x == null || !isFinite(x) ? "—" : x.toFixed(d));
const pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");

/* Edition health since collection was enabled (first scheduled run), from lib/editions.js.
   "Executed" (the collector ran) is reported separately from "captured within the window". */
const ED = require("./editions.js");
function captureHealth(caps, loc, nowMs, runs = []) {
  const schedRuns = runs.filter((r) => r.job === "collect" && r.trigger !== "manual");
  const startIso = [...caps.filter(ED.isEdition).map((c) => c.startedAt), ...schedRuns.map((r) => r.at)].sort()[0];
  const manual = caps.filter((c) => !ED.isEdition(c)).length;
  if (!startIso) return { enabled: false, expected: 0, slots: [], gaps: [], manual, executed: 0 };
  const first = U.localParts(Date.parse(startIso), loc.tz).date, today = U.localParts(nowMs, loc.tz).date, exp = [];
  for (let d = first; d <= today; d = U.addDays(d, 1)) SCHED.slots.forEach((s) => { const t = SCH.targetMs(d, s.local, loc.tz); if (t < Date.parse(startIso) - 3 * 3600e3) return; exp.push({ id: `${d}_${s.id}`, target: U.iso(t), future: nowMs < t + SCHED.lateMaxMin * 60e3 }); });
  const slots = ED.health(caps, runs, exp).map((x) => ({ ...x, status: x.edition === "captured_on_time" ? "on_time" : x.edition === "captured_partly_on_time" ? "partial" : x.edition === "captured_late" ? "late" : x.edition === "captured_off_schedule" ? "off_schedule" : x.edition }));
  return { enabled: true, since: startIso, expected: slots.filter((s) => s.status !== "pending").length, slots, gaps: slots.filter((s) => ["missed", "failed"].includes(s.status)), manual,
    executed: schedRuns.length, executedOk: schedRuns.filter((r) => !["crashed"].includes(r.outcome)).length, notDue: schedRuns.filter((r) => r.outcome === "not-due").length };
}

function writeReports(DATA, loc, res, nowMs = Date.now()) {
  const R = path.join(DATA, "reports"); U.mkdirp(R);
  const caps = U.readJSONL(path.join(DATA, "captures", `${loc.id}.jsonl`));
  const runs = U.readJSONLDir(path.join(DATA, "runs")).slice(-200);
  const H = captureHealth(caps, loc, nowMs, U.readJSONLDir(path.join(DATA, "runs")));
  const last = (job, ok) => runs.filter((r) => r.job === job && (!ok || ["ok", "partial"].includes(r.outcome))).pop();
  /* one queue item per distinct evidence (identical re-captures are collapsed and counted) */
  const qmap = new Map();
  res.tv.filter((r) => r.reviewStatus === "needs-review").forEach((r) => { const h = r.evidence && r.evidence[0] ? r.evidence[0].contentSha256 : r.captureId;
    const k = [r.station, r.product, r.extractVersion, h, r.days && r.days[0] && r.days[0].date, r.days && r.days.length && r.days[r.days.length - 1].date].join("|"); const prev = qmap.get(k); qmap.set(k, { r, n: (prev ? prev.n : 0) + 1, first: prev ? prev.first : r.captureId }); });
  const queue = [...qmap.values()].map(({ r, n, first }) => ({ captures: n, firstCapture: first,
    scope: { station: r.station, extractVersion: r.extractVersion, contentSha256: r.evidence && r.evidence[0] ? r.evidence[0].contentSha256 : null, firstDate: r.days && r.days[0] ? r.days[0].date : null, lastDate: r.days && r.days.length ? r.days[r.days.length - 1].date : null }, captureId: r.captureId, product: r.product, station: r.station, reason: r.review && r.review.reason, evidence: r.evidence, days: r.days, issues: r.extraction && r.extraction.issues, retrievedAt: r.retrievedAt, issuedAt: r.issuedAt, text: r.text ? r.text.slice(0, 3000) : undefined }));
  U.writeJSON(path.join(R, "review-queue.json"), { at: U.iso(nowMs), items: queue });
  /* compact scores for the dashboard (pairs omitted: they are rebuilt from the archive) */
  U.writeJSON(path.join(R, "scores.json"), { version: res.version, at: res.at, minDates: res.minDates, summary: res.summary, hourly: res.hourly, comparisons: res.comparisons, pendingCount: res.pending.length, pending: res.pending.slice(-300), pairsCount: res.pairs.length });
  const latestCap = caps[caps.length - 1];
  U.writeJSON(path.join(R, "index.json"), { at: U.iso(nowMs), loc, health: { ...H, slots: H.slots.slice(-60) }, captures: caps.slice(-40).map((c) => ({ captureId: c.captureId, slot: c.slot, trigger: c.trigger, startedAt: c.startedAt, timeliness: c.timeliness, outcome: c.outcome, summary: c.summary, tv: c.tv, normalized: c.normalized && !c.normalized.error })),
    runs: runs.slice(-60), lastRuns: { collect: last("collect"), observe: last("observe", true), score: last("score") }, reviewQueue: queue.length,
    tvLatest: Object.values(res.tv.reduce((m, r) => ((m[r.product] = r), m), {})).map((r) => ({ product: r.product, station: r.station, label: r.label, captureId: r.captureId, retrievedAt: r.retrievedAt, issuedAt: r.issuedAt, freshness: r.freshness, reviewStatus: r.reviewStatus, extraction: r.extraction, evidence: r.evidence, days: r.days, location: r.location, authorship: r.authorship, lows: r.lows, crossCheck: r.crossCheck })),
    latestBlendInfo: latestCap ? (() => { try { const b = JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA, latestCap.normalized.path))).toString()); return Object.fromEntries(Object.entries(b.blends).map(([k, v]) => [k, { label: v.label, configHash: v.configHash, requested: v.requested, actual: v.actual, missing: v.missing, shares: v.shares }])); } catch (e) { return null; } })() : null });
  /* CSV exports: scored pairs and best observations (the archive itself is the full export) */
  const csv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => { const v = r[c]; const s = v == null ? "" : Array.isArray(v) ? v.join(";") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n") + "\n";
  U.mkdirp(path.join(R, "exports"));
  fs.writeFileSync(path.join(R, "exports", "pairs.csv"), csv(res.pairs, ["captureId", "slot", "timeliness", "track", "id", "target", "date", "lead", "v", "o", "obsSrc", "obsStatus", "obsRevised", "flags"]));
  fs.writeFileSync(path.join(R, "exports", "observations.csv"), csv(res.obsBest || [], ["target", "date", "value", "src", "status", "revised", "versions", "flags"]));
  /* one fully traceable real pair: first hourly pair for Baseline v1 (falls back to any source) */
  const caps2 = U.readJSONL(path.join(DATA, "captures", `${loc.id}.jsonl`));
  const tp = (res.hourlyPairs || []).find((p) => p.id === "blend:baseline-v1") || (res.hourlyPairs || [])[0];
  let trace = null;
  if (tp) { const c = caps2.find((x) => x.captureId === tp.captureId) || {};
    trace = { forecast: { captureId: tp.captureId, slot: tp.slot, timeliness: tp.timeliness, captureStarted: c.startedAt, sourceRetrieval: Object.fromEntries(Object.values(c.sources || {}).map((s) => [s.id, { retrievedAt: s.retrievedAt, issued: s.kind === "nws" ? s.issuedAt : s.meta && s.meta.lastRunInit, rawFile: s.files && (s.files.response || s.files.grid) ? (s.files.response || s.files.grid).path : null, sha256: s.files && (s.files.response || s.files.grid) ? (s.files.response || s.files.grid).sha256 : null }])),
        lastRetrieval: tp.retrievedLast, recipe: tp.id, normalizedBundle: tp.bundle, normalizerVersion: tp.normVersion, validTime: tp.valid, value: tp.v },
      observation: { report: tp.obsReport, measuredAt: tp.obsMeasured, ingestedAt: tp.obsIngested, rawFileSha256: tp.obsRawSha, valueF: tp.o, matchRule: `routine report within ${require("./timing.js").MATCH_TOLERANCE_MIN} min before the valid hour` },
      timing: { leadMinutesFromLastRetrievalToMeasurement: tp.leadMin, minimumRequired: require("./timing.js").MIN_LEAD_MIN },
      score: { errorF: Math.round((tp.v - tp.o) * 10) / 10, absErrorF: Math.round(Math.abs(tp.v - tp.o) * 10) / 10, scoreVersion: res.version } }; }
  U.writeJSON(path.join(R, "trace-example.json"), trace || { note: "no eligible scored pair yet" });
  /* STATUS.md */
  const st = [];
  st.push(`# Verification status · ${loc.name}`, "", `Updated ${U.iso(nowMs)} (private; generated by verify/lib/report.js)`, "");
  st.push(`Schedule: ${SCHED.slots.map((s) => `${s.id} ${s.local}`).join(", ")} ${loc.tz}. On time = started within ${SCHED.onTimeMaxMin} min of the target; late up to ${SCHED.lateMaxMin} min; later = off schedule.`, "");
  st.push(H.enabled ? `Scheduled collection active since ${H.since}. Collector runs executed: ${H.executed} (${H.notDue} were "not due" triggers). Editions due: ${H.expected} · captured on time (all sources): ${H.slots.filter((s) => s.status === "on_time").length} · partly on time: ${H.slots.filter((s) => s.status === "partial").length} · late: ${H.slots.filter((s) => s.status === "late").length} · off schedule: ${H.slots.filter((s) => s.status === "off_schedule").length} · missed: ${H.slots.filter((s) => s.status === "missed").length} · failed: ${H.slots.filter((s) => s.status === "failed").length}. Manual (pilot) captures: ${H.manual}.`
    : `Scheduled collection: NOT ACTIVE (no scheduled run recorded). Manual (pilot) captures: ${H.manual}; they never enter primary scorecards.`, "");
  if (H.enabled) { st.push("| Edition | Target (UTC) | Status | Sources on time / captured / expected | Attempts | Collector runs |", "|---|---|---|---|---|---|");
    H.slots.slice(-28).reverse().forEach((s) => st.push(`| ${s.id} | ${s.target} | ${s.status} | ${s.sourcesOnTime} / ${s.sourcesCaptured} / ${s.sourcesExpected} | ${s.attempts} | ${s.collectorRuns} |`)); st.push(""); }
  st.push("| Capture | Trigger | Started | Timeliness | Outcome | Problems |", "|---|---|---|---|---|---|");
  caps.slice(-14).reverse().forEach((c) => st.push(`| ${c.captureId} | ${c.trigger} | ${c.startedAt} | ${c.timeliness.status}${c.timeliness.delayMin != null ? ` (${f(c.timeliness.delayMin)} min)` : ""} | ${c.outcome} | ${(c.summary.failed || []).join("; ") || "—"} |`));
  st.push("", "## Last runs", "", "| Job | At | Outcome | Detail |", "|---|---|---|---|");
  runs.slice(-15).reverse().forEach((r) => st.push(`| ${r.job} | ${r.at} | ${r.outcome} | ${(r.error || r.detail || (r.outcomes ? Object.entries(r.outcomes).map(([k, o]) => `${k}:${o.status}`).join(" ") : "") || "").toString().slice(0, 140).replace(/\|/g, "/")} |`));
  /* source/product status table */
  const schedOn = caps.some((c) => c.trigger === "scheduled" || c.trigger === "backup") ? "scheduled captures present" : "NOT scheduled (manual pilot runs only)";
  st.push("", "## Source / product status", "", `Timing rule: ${res.timing}. Scheduled collection: ${schedOn}.`, "", "| Track | Source / product | Latest capture | Review | Eligible forecasts (daily + hourly) | Matched obs | Scored |", "|---|---|---|---|---|---|---|");
  const lc = caps[caps.length - 1];
  (res.eligibility || []).sort((a, b) => a.track.localeCompare(b.track) || a.id.localeCompare(b.id)).forEach((e) => {
    const tvr = e.track === "tv" ? res.tv.filter((r) => r.product === e.id).pop() : null;
    st.push(`| ${e.track} | ${e.id} | ${tvr ? tvr.captureId : lc ? lc.captureId : "—"} | ${tvr ? tvr.reviewStatus : "n/a"} | ${e.eligible} + ${e.hourlyEligible} | ${e.matched + e.hourlyScored} | ${e.scored + e.hourlyScored} |`); });
  const latestTV = Object.values(res.tv.reduce((m, r) => ((m[r.product] = r), m), {}));
  latestTV.filter((r) => !(res.eligibility || []).some((e) => e.track === "tv" && e.id === r.product)).forEach((r) => st.push(`| tv | ${r.product} | ${r.captureId} | ${r.reviewStatus} | 0 (needs review: not eligible) | 0 | 0 |`));
  st.push("", `## Observations`, "", `${res.obsCount} observation rows archived · ${res.pairs.length} forecast values scored · ${res.pending.length} past-window values still waiting for an observation.`);
  st.push("", `## TV review queue`, "", queue.length ? queue.slice(-20).map((q) => `- ${q.captureId} · ${q.product}: ${q.reason}`).join("\n") : "Empty.");
  fs.writeFileSync(path.join(R, "STATUS.md"), st.join("\n") + "\n");
  /* SCORECARD.md */
  const sc = [], S = res.summary.filter((x) => x.cls === "primary");
  sc.push(`# Scorecard · ${loc.name}`, "", `Private results, ${U.iso(nowMs)}. Not for publication. PRIMARY tables use only scheduled editions, one capture per edition and source (${res.editionsVersion}), captured on time; late, superseded (retry/backup) and manual pilot captures are excluded and counted below. Pair counts are shown with unique dates, 7-day blocks and weather episodes (* = some dates lack an observed wet/dry state). Verdicts need ${res.minDates}+ distinct valid dates and a 90% block-bootstrap interval that excludes zero; until then everything reads "insufficient evidence". Timing: ${res.timing}.`, "");
  const cnt = (c) => res.pairs.filter((p) => p.cls === c).length + (res.hourlyPairs || []).filter((p) => p.cls === c).length;
  sc.push(`Scored pairs by class — primary: ${cnt("primary")} · late: ${cnt("late")} · superseded: ${cnt("superseded")} · pilot (manual): ${cnt("pilot")}.`, "");
  ["tmax_clim", "tmin_clim", "tmax_day", "tmin_night"].forEach((t) => {
    const rows = S.filter((x) => x.target === t && x.lead >= 1 && x.lead <= 7 && x.n); if (!rows.length) return;
    sc.push(`## ${TG.TARGETS[t].label}`, "", "| Track | Source/product | Slot | Lead day | Actual lead h (mean, min–max) | Pairs | Unique dates | 7-day blocks | Episodes | MAE °F | Bias °F | Within 2°F |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
    rows.sort((a, b) => a.track.localeCompare(b.track) || a.id.localeCompare(b.id) || a.slot.localeCompare(b.slot) || a.lead - b.lead).forEach((x) => sc.push(`| ${x.track} | ${x.id} | ${x.slot} | ${x.lead} | ${x.leadHours ? `${x.leadHours.meanH} (${x.leadHours.minH}–${x.leadHours.maxH})` : "—"} | ${x.n} | ${x.uniqueDates} | ${x.blocks7d} | ${x.episodes}${x.episodesKnown ? "" : "*"} | ${f(x.mae)} | ${f(x.bias)} | ${pct(x.within2)} |`));
    sc.push("");
  });
  ["pop01_clim", "pop01_day12", "pop01_night12"].forEach((t) => { const rows = S.filter((x) => x.target === t && x.lead >= 1 && x.lead <= 7 && x.n); if (!rows.length) return;
    sc.push(`## ${TG.TARGETS[t].label}`, "", "| Track | Source/product | Slot | Lead | n | Brier | Base rate |", "|---|---|---|---|---|---|---|");
    rows.forEach((x) => sc.push(`| ${x.track} | ${x.id} | ${x.slot} | ${x.lead} | ${x.n} | ${f(x.brier, 3)} | ${pct(x.baseRate)} |`)); sc.push(""); });
  const cmp = res.comparisons;
  if (cmp.length) { sc.push("## Matched comparisons (on-time captures, cases every member has)", ""); cmp.forEach((c) => { sc.push(`**${c.set} · ${c.target} · lead ${c.lead} · ${c.slot}** · ${c.n} cases, ${c.dates} dates · ${c.metric}`, ""); Object.entries(c.members).forEach(([m, x]) => sc.push(`- ${m}: ${f(x.score, 2)}${x.verdict ? ` · vs ${c.ref} ${f(x.diffVsRef, 2)} (90% CI ${x.ci90 ? `${f(x.ci90[0], 2)} to ${f(x.ci90[1], 2)}` : "—"}) · ${x.verdict}` : ""}`)); sc.push(""); }); }
  else sc.push("No matched comparisons yet: they need primary (scheduled, on-time) forecasts with verifying observations.");
  const hp = (res.hourly || []).filter((h) => h.cls === "primary");
  sc.push("", "## Hourly temperature (primary)", "", hp.length ? ["| Source | Slot | Lead day | Lead h (mean) | Pairs | Unique hours | Unique dates | MAE °F | Bias °F |", "|---|---|---|---|---|---|---|---|---|", ...hp.map((h) => `| ${h.id} | ${h.slot} | ${h.leadDay} | ${h.leadHours ? h.leadHours.meanH : "—"} | ${h.n} | ${h.uniqueHours} | ${h.uniqueDates} | ${f(h.mae)} | ${f(h.bias)} |`)].join("\n") : "None yet.");
  const pil = (res.hourly || []).filter((h) => h.cls === "pilot");
  if (pil.length) sc.push("", "## Pilot (manual captures; pipeline evidence only, not accuracy evidence)", "", `${pil.reduce((s, h) => s + h.n, 0)} hourly pairs over ${new Set(pil.flatMap((h) => [h.uniqueHours])).size ? Math.max(...pil.map((h) => h.uniqueHours)) : 0} unique verifying hours. No rankings are drawn from these.`);
  fs.writeFileSync(path.join(R, "SCORECARD.md"), sc.join("\n") + "\n");
}
module.exports = { writeReports, captureHealth };
