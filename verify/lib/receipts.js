/* Server receipt evidence for personal forecasts (receipts-v1).
   A Git commit's author/committer dates are written by whoever makes the commit, so they are never
   enough to establish when a forecast was issued: a commit can be made with any date, or made locally
   and pushed hours later. The issue time used for eligibility is the time GITHUB RECEIVED the push that
   first brought the forecast's commit onto main, taken from GitHub's own records:
     activity-api  GET /repos/{repo}/activity (activity_type push / force_push): GitHub's timestamp
                   for each ref update, with before/after commits. Queried on every collector run.
     push-event    the push event that started a run: repository.pushed_at (set by GitHub) with
                   before/after. Available only to the run that push triggered.
   Both are copied into receipts/pushes.jsonl (append-only, written by the collector) so the evidence
   outlives GitHub's activity retention. When the same push appears in both sources, their times must
   agree within RECEIPT_AGREE_S or the submission is excluded as conflicting evidence.
   Three times are kept per submission and never mixed:
     submittedAt   commit committer time (client clock or GitHub's, depending on how it was made)
     receivedAt    GitHub's recorded receipt of the push      <- determines eligibility and order
     processedAt   first collector run that saw the file      (workflow delay; informational only)
   A late-starting workflow therefore cannot make an on-time submission late, and a backdated or
   delayed local commit cannot make a late submission on time. */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const U = require("./util.js");
const VERSION = "receipts-v1";
const RECEIPT_AGREE_S = 120; // activity-api vs push-event time for the same push
const FILE = "receipts/pushes.jsonl", PROCESSED = "receipts/personal-processed.jsonl";
const ZERO = /^0+$/;

const readPushes = (DATA) => U.readJSONL(path.join(DATA, FILE));
const readProcessed = (DATA) => U.readJSONL(path.join(DATA, PROCESSED));

/* Normalize GitHub's records to {source, id, ref, before, after, receivedAt, kind, actor}. */
function fromActivity(items) {
  return (Array.isArray(items) ? items : []).filter((a) => a && (a.activity_type === "push" || a.activity_type === "force_push") && a.after && a.timestamp)
    .map((a) => ({ source: "activity-api", id: String(a.id), ref: a.ref, before: a.before || null, after: a.after, receivedAt: new Date(a.timestamp).toISOString(), kind: a.activity_type, actor: a.actor && a.actor.login || null }));
}
function fromPushEvent(ev, runId) {
  if (!ev || !ev.after || !ev.repository || ev.repository.pushed_at == null) return [];
  const p = ev.repository.pushed_at, ms = typeof p === "number" ? p * 1000 : Date.parse(p);
  if (!Number.isFinite(ms)) return [];
  return [{ source: "push-event", id: `run:${runId || "?"}:${ev.after}`, ref: ev.ref, before: ev.before || null, after: ev.after, receivedAt: new Date(ms).toISOString(), kind: ev.forced ? "force_push" : "push", actor: ev.pusher && ev.pusher.name || null }];
}

/* Append records not yet in the log (key: source + id). Returns the number added. */
function record(DATA, recs, recordedAt = U.iso(Date.now())) {
  const have = new Set(readPushes(DATA).map((r) => `${r.source}|${r.id}`));
  const add = recs.filter((r) => r.ref === "refs/heads/main" && !have.has(`${r.source}|${r.id}`)).map((r) => ({ ...r, recordedAt, version: VERSION }));
  if (add.length) U.appendJSONL(path.join(DATA, FILE), add);
  return add.length;
}

/* Collector step: gather receipt evidence from the triggering push event and the activity API. */
function collect(DATA, { eventPath = process.env.GITHUB_EVENT_PATH, eventName = process.env.GITHUB_EVENT_NAME, repo = process.env.GITHUB_REPOSITORY, runId = process.env.GITHUB_RUN_ID, fetchActivity } = {}) {
  const out = { pushEvent: 0, activity: 0, errors: [] };
  if (eventName === "push" && eventPath && fs.existsSync(eventPath)) {
    try { out.pushEvent = record(DATA, fromPushEvent(JSON.parse(fs.readFileSync(eventPath, "utf8")), runId)); } catch (e) { out.errors.push("push event: " + e.message); }
  }
  const get = fetchActivity || ((r) => JSON.parse(cp.execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${r}/activity?ref=refs/heads/main&time_period=month&per_page=100`], { encoding: "utf8", maxBuffer: 32e6, stdio: ["ignore", "pipe", "pipe"] })).flat());
  if (repo) { try { out.activity = record(DATA, fromActivity(get(repo))); } catch (e) { out.errors.push("activity api: " + String(e.message || e).slice(0, 300)); } }
  else out.errors.push("activity api: no repository name");
  return out;
}

/* Ancestry with a cache; missing objects (e.g. history removed by a force push) count as "no". */
function ancestry(DATA) {
  const cache = new Map();
  return (a, b) => {
    if (!a || !b || ZERO.test(b)) return false;
    const k = a + ">" + b; if (cache.has(k)) return cache.get(k);
    let r = false; try { cp.execFileSync("git", ["-C", DATA, "merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); r = true; } catch (e) { r = false; }
    cache.set(k, r); return r;
  };
}

/* The push that first brought `commit` onto main: commit is an ancestor of `after` and was not
   already reachable from `before`. Earliest such receipt wins. */
function receiptFor(DATA, commit, pushes = readPushes(DATA), isAnc = ancestry(DATA)) {
  if (!commit) return { error: "No commit." };
  const hits = pushes.filter((p) => p.ref === "refs/heads/main" && (p.after === commit || isAnc(commit, p.after)) && !(p.before && !ZERO.test(p.before) && (p.before === commit || isAnc(commit, p.before))));
  if (!hits.length) return { error: "Awaiting GitHub receipt evidence for this commit." };
  /* group the same push seen through both sources; disagreement is a conflict, not a choice */
  const byAfter = new Map(); hits.forEach((h) => (byAfter.get(h.after) || byAfter.set(h.after, []).get(h.after)).push(h));
  for (const list of byAfter.values()) {
    const t = list.map((h) => Date.parse(h.receivedAt));
    if (Math.max(...t) - Math.min(...t) > RECEIPT_AGREE_S * 1000) return { error: "Receipt evidence conflicts between GitHub sources; excluded.", conflict: list };
  }
  const first = hits.slice().sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))[0];
  return { receivedAt: first.receivedAt, source: first.source, pushAfter: first.after, kind: first.kind, evidence: hits.map((h) => ({ source: h.source, id: h.id, receivedAt: h.receivedAt, after: h.after })) };
}

/* First collector run that processed each submission file (informational). */
function markProcessed(DATA, items, processedAt = U.iso(Date.now()), runId = process.env.GITHUB_RUN_ID || null) {
  const have = new Set(readProcessed(DATA).map((r) => `${r.file}|${r.commit}`));
  const add = items.filter((x) => x.file && x.commit && !have.has(`${x.file}|${x.commit}`)).map((x) => ({ file: x.file, commit: x.commit, processedAt, runId, version: VERSION }));
  if (add.length) U.appendJSONL(path.join(DATA, PROCESSED), add);
  return add.length;
}
module.exports = { VERSION, RECEIPT_AGREE_S, FILE, PROCESSED, fromActivity, fromPushEvent, record, collect, receiptFor, ancestry, readPushes, readProcessed, markProcessed };
