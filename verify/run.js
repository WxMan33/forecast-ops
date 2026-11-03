#!/usr/bin/env node
/* Forecast Ops verification service: one entry point for the scheduled jobs.
     node verify/run.js collect  [--loc CVG] [--data DIR] [--manual] [--trigger scheduled|backup|manual]
     node verify/run.js observe  [--loc CVG] [--data DIR]
     node verify/run.js score    [--loc CVG] [--data DIR]
     node verify/run.js renormalize [--loc CVG] [--data DIR]   (rebuild normalized bundles from raw evidence)
   Every run appends an outcome to DATA/runs/, including failures, so gaps are visible. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./lib/util.js");
const LOCS = require("./config/locations.js"), SCHED = require("./config/schedule.js"), BLENDS = require("./config/blends.js"), TVCFG = require("./config/tv.js");
const SCH = require("./lib/schedule.js"), SRC = require("./lib/sources.js"), NORM = require("./lib/normalize.js"), OBS = require("./lib/obs.js"), TV = require("./lib/tv.js");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes("--" + k);
const cmd = process.argv[2];
const DATA = path.resolve(arg("data", process.env.VERIFY_DATA || "verify-data"));
const loc = LOCS[arg("loc", "CVG")];
const CODE = { commit: process.env.GITHUB_SHA || process.env.CODE_SHA || null, repo: process.env.CODE_REPO || "WxMan33/forecast-ops", normalize: NORM.VERSION, obs: OBS.VERSION, tv: TV.VERSION };
const month = (ms) => new Date(ms).toISOString().slice(0, 7);
const runLog = (rec) => U.appendJSONL(path.join(DATA, "runs", `${month(Date.now())}.jsonl`), [{ at: U.iso(Date.now()), loc: loc.id, code: CODE, ...rec }]);
const capturesFile = path.join(DATA, "captures", `${loc.id}.jsonl`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Load a capture's raw evidence back into memory. */
function loadRaw(cap) {
  const raw = { det: {}, ens: {}, nws: {} };
  Object.values(cap.sources || {}).forEach((s) => {
    const f = s.files || {}, J = (x) => (x ? U.parseJSON(U.loadRaw(DATA, x.path).toString()) : null);
    if (s.kind === "det") raw.det[s.id] = s.status === "ok" ? J(f.response) : null;
    else if (s.kind === "ens") raw.ens[s.id] = s.status === "ok" ? J(f.response) : null;
    else if (s.kind === "nws") ["forecast", "hourly", "grid"].forEach((k) => { if (s.parts && s.parts[k] && s.parts[k].status === "ok") raw.nws[k] = J(f[k]); });
  });
  return raw;
}
/* Bundles are written per normalizer version and never overwritten: older versions stay beside new ones. */
const bundleRel = (cap) => `normalized/${loc.id}/${cap.localDate.slice(0, 4)}/${cap.captureId}.${NORM.VERSION}.json.gz`;
function writeBundle(cap) {
  const rel = bundleRel(cap), full = path.join(DATA, rel);
  if (fs.existsSync(full)) return { path: rel, version: NORM.VERSION, existed: true };
  const b = NORM.normalize(loadRaw(cap), cap, loc, BLENDS.recipes.concat(BLENDS.candidates));
  U.mkdirp(path.dirname(full));
  fs.writeFileSync(full, U.gz(Buffer.from(JSON.stringify(b))));
  return { path: rel, version: NORM.VERSION, error: b.error || null, sources: Object.keys(b.sources).length, blends: Object.keys(b.blends).length };
}

async function collect() {
  const now = Date.now(), manual = flag("manual");
  let slot = manual ? null : SCH.resolve(now, loc.tz, SCHED);
  if (!manual && !slot.slot) { runLog({ job: "collect", outcome: "not-due", detail: slot.reason }); console.log("No capture slot due now:", slot.reason); return; }
  const have = U.readJSONL(capturesFile);
  if (!manual) {
    if (SCH.alreadyCaptured(have, slot.captureId)) { runLog({ job: "collect", outcome: "skipped-duplicate", captureId: slot.captureId, trigger: arg("trigger", "scheduled") }); console.log("Already captured", slot.captureId); return; }
    if (slot.waitMs > 0) { console.log(`Early by ${(slot.waitMs / 60e3).toFixed(1)} min: waiting for the target`); await sleep(slot.waitMs); }
  }
  const startedAt = Date.now(), lp = U.localParts(startedAt, loc.tz);
  const cap = manual
    ? { captureId: `${lp.date}_manual_${lp.hm.replace(":", "")}`, slot: "manual", localDate: lp.date, slotTarget: null, timeliness: { status: "manual", delayMin: null } }
    : { captureId: slot.captureId, slot: slot.slot, localDate: slot.localDate, slotTarget: U.iso(slot.target), timeliness: SCH.timeliness(startedAt, slot.target, SCHED) };
  Object.assign(cap, { schema: 1, loc: loc.id, trigger: manual ? "manual" : arg("trigger", "scheduled"), startedAt: U.iso(startedAt), scheduleConfig: SCHED, code: CODE });
  logConfig();
  const rel = `raw/${loc.id}/${cap.localDate.slice(0, 7)}/${cap.captureId}`;
  cap.sources = await SRC.collect(loc, DATA, rel);
  cap.sourcesRetrievedLast = Object.values(cap.sources).map((s) => s.retrievedAt).filter(Boolean).sort().pop();
  /* TV products (market pilot) */
  if (TVCFG.verifySite === loc.id && !flag("no-tv")) {
    const tvFile = path.join(DATA, "tv", loc.id, `${cap.localDate.slice(0, 7)}.jsonl`);
    const prevAll = U.readJSONLDir(path.join(DATA, "tv", loc.id)), prev = {};
    prevAll.forEach((r) => { if (r.status === "ok") prev[r.product] = r; });
    try { const recs = await TV.collect(TVCFG, loc, DATA, cap, prev); U.appendJSONL(tvFile, recs); cap.tv = recs.map((r) => ({ product: r.product, status: r.status, review: r.review && r.review.status, days: r.days ? r.days.length : 0, reason: r.reason || r.error })); }
    catch (e) { cap.tv = [{ status: "failed", error: String(e.message || e) }]; }
  }
  cap.finishedAt = U.iso(Date.now());
  try { cap.normalized = writeBundle(cap); } catch (e) { cap.normalized = { error: String(e.stack || e) }; }
  const st = Object.values(cap.sources).map((s) => s.status);
  cap.outcome = st.every((x) => x === "ok") ? "ok" : st.some((x) => x === "ok") ? "partial" : "failed";
  cap.summary = { ok: st.filter((x) => x === "ok").length, total: st.length, failed: Object.values(cap.sources).filter((s) => s.status !== "ok").map((s) => `${s.id}: ${s.status}${s.error ? ` (${String(s.error).slice(0, 80)})` : ""}`) };
  U.appendJSONL(capturesFile, [cap]);
  runLog({ job: "collect", outcome: cap.outcome, captureId: cap.captureId, timeliness: cap.timeliness, trigger: cap.trigger, failed: cap.summary.failed, normalized: !cap.normalized.error });
  console.log(`${cap.captureId}: ${cap.outcome} (${cap.timeliness.status}${cap.timeliness.delayMin != null ? `, ${cap.timeliness.delayMin.toFixed(1)} min` : ""}) sources ${cap.summary.ok}/${cap.summary.total}; TV ${(cap.tv || []).map((t) => `${t.product}:${t.status}/${t.review || "-"}`).join(" ")}; normalized ${cap.normalized.error ? "FAILED " + cap.normalized.error.slice(0, 200) : "ok"}`);
}

/* Configuration change log: every recipe, schedule, target or TV-config change is recorded by hash
   before the capture that first uses it, so no change can be applied silently or retroactively. */
function logConfig() {
  const file = path.join(DATA, "config-log.jsonl"), TGV = require("./lib/targets.js").VERSION;
  const cur = { recipes: Object.fromEntries(BLENDS.recipes.concat(BLENDS.candidates).map((r) => [r.id, U.configHash({ weights: r.weights, rules: r.rules })])), schedule: U.configHash(SCHED), targets: TGV, tv: U.configHash(TVCFG), location: U.configHash(loc) };
  const prev = U.readJSONL(file).filter((r) => r.loc === loc.id).pop();
  if (prev && U.stableStringify(prev.config) === U.stableStringify(cur)) return;
  const changed = prev ? Object.keys(cur).filter((k) => U.stableStringify(cur[k]) !== U.stableStringify(prev.config[k])) : ["initial"];
  U.appendJSONL(file, [{ at: U.iso(Date.now()), loc: loc.id, code: CODE, changed, config: cur }]);
}

async function observe() {
  const res = await OBS.fetchAll(loc, DATA, Date.now());
  const file = path.join(DATA, "obs", loc.id, `${month(Date.now())}.jsonl`);
  const seen = new Set(U.readJSONLDir(path.join(DATA, "obs", loc.id)).map((r) => r.key));
  const prevBest = OBS.best(U.readJSONLDir(path.join(DATA, "obs", loc.id)));
  const fresh = [];
  res.rows.forEach((r) => {
    const key = U.sha256(Buffer.from(JSON.stringify([r.src, r.target, r.date || r.time, r.value, r.flags, r.status, r.productId || null]))).slice(0, 16);
    if (seen.has(key)) return; seen.add(key);
    const pb = prevBest.get(`${r.target}|${r.date || r.time}`);
    fresh.push({ ...r, key, reports: undefined, firstSeenAt: r.seenAt, changesValue: pb && pb.value !== r.value ? { from: pb.value, fromSrc: pb.src, fromStatus: pb.status } : undefined });
  });
  U.appendJSONL(file, fresh);
  const bad = Object.entries(res.outcomes).filter(([, o]) => o.status !== "ok").map(([k, o]) => `${k}: ${o.error || o.status}`);
  runLog({ job: "observe", outcome: bad.length ? (bad.length === Object.keys(res.outcomes).length ? "failed" : "partial") : "ok", outcomes: res.outcomes, newRows: fresh.length, revisions: fresh.filter((r) => r.changesValue).length });
  console.log(`observe: ${fresh.length} new observation rows; ${JSON.stringify(res.outcomes)}`);
}

function renormalize() {
  const caps = U.readJSONL(capturesFile); let n = 0;
  caps.forEach((c) => { try { writeBundle(c); n++; } catch (e) { console.log("renormalize failed", c.captureId, e.message); } });
  runLog({ job: "renormalize", outcome: "ok", count: n }); console.log(`renormalized ${n} captures`);
}

async function score() {
  const SC = require("./lib/score.js"), RP = require("./lib/report.js");
  /* captures without a bundle of the current normalizer version get one, built from the raw evidence;
     bundles of older versions are kept untouched beside it */
  let rebuilt = 0;
  U.readJSONL(capturesFile).forEach((c) => {
    if (fs.existsSync(path.join(DATA, bundleRel(c)))) return;
    try { writeBundle(c); rebuilt++; } catch (e) { console.log("rebuild failed", c.captureId, e.message); }
  });
  if (rebuilt) runLog({ job: "renormalize", outcome: "ok", count: rebuilt, reason: `normalizer ${NORM.VERSION}` });
  const res = SC.scoreAll(DATA, loc);
  RP.writeReports(DATA, loc, res);
  runLog({ job: "score", outcome: "ok", pairs: res.pairs.length, pending: res.pending.length });
  console.log(`score: ${res.pairs.length} scored pairs, ${res.pending.length} awaiting observations`);
}

(async () => {
  try {
    if (!loc) throw new Error("unknown location");
    if (cmd === "collect") await collect();
    else if (cmd === "observe") await observe();
    else if (cmd === "score") await score();
    else if (cmd === "renormalize") renormalize();
    else { console.log("usage: run.js collect|observe|score|renormalize"); process.exit(2); }
  } catch (e) {
    try { runLog({ job: cmd, outcome: "crashed", error: String(e.stack || e).slice(0, 2000) }); } catch (e2) { /* ignore */ }
    console.error(e); process.exit(1);
  }
})();
