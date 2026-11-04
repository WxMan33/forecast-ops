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
   delayed local commit cannot make a late submission on time.
   TRUST BOUNDARY (receipts-v2). receipts/pushes.jsonl is a LOG, not evidence: anyone who can write to
   the repository can append to it. A receipt counts only if GitHub confirms it in the scoring run:
     live      the activity API, queried by that run, returns the same push (id, before, after, time);
     event     the push event that started that run;
     attested  a commit status (context forecast-ops/receipt) on the push's "after" commit created by
               github-actions[bot], i.e. by a collector run's GITHUB_TOKEN. A personal token cannot create
               a status under that identity, and statuses cannot be deleted, so the receipt stays
               checkable after the activity API's retention ends.
   A log row covering the forecast's commit that GitHub contradicts (inside the live API's coverage but
   not returned, or returned with different data) excludes the submission as tampered evidence. Rows
   older than the live coverage and without an attestation are ignored. Residual trust: the repository
   owner controls the workflow and the collector code it runs; see MY_FORECAST.md. */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const U = require("./util.js");
const VERSION = "receipts-v2";
const BOT = "github-actions[bot]", CONTEXT = "forecast-ops/receipt", COVERAGE_DAYS = 27;
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

/* ---------- GitHub confirmation ---------- */
const ghJSON = (args) => JSON.parse(cp.execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 32e6, stdio: ["ignore", "pipe", "pipe"] }) || "null");
const defaultGh = { activity: (repo) => ghJSON(["--paginate", "--slurp", `repos/${repo}/activity?ref=refs/heads/main&time_period=month&per_page=100`]).flat(),
  statuses: (repo, sha) => ghJSON(["--paginate", "--slurp", `repos/${repo}/commits/${sha}/statuses?per_page=100`]).flat(),
  post: (repo, sha, description) => ghJSON(["-X", "POST", `repos/${repo}/statuses/${sha}`, "-f", "state=success", "-f", `context=${CONTEXT}`, "-f", `description=${description}`]) };
const describe = (r) => `receipt-v1 at=${r.receivedAt.replace(/\.000Z$/, "Z")} before=${r.before && !ZERO.test(r.before) ? r.before : "none"} src=${r.source === "push-event" ? "event" : "activity"}:${String(r.id).slice(-24)}`;
function fromStatuses(sha, list) {
  return (Array.isArray(list) ? list : []).filter((s) => s && s.context === CONTEXT && s.creator && s.creator.login === BOT && typeof s.description === "string")
    .map((s) => { const m = /^receipt-v1 at=(\S+) before=([0-9a-f]{40}|none) src=(\S+)$/.exec(s.description); const t = m ? Date.parse(m[1]) : NaN;
      return Number.isFinite(t) ? { source: "attested", id: `status:${s.id}`, ref: "refs/heads/main", before: m[2] === "none" ? null : m[2], after: sha, receivedAt: new Date(t).toISOString(), origin: m[3], statusCreatedAt: s.created_at } : null; })
    .filter(Boolean);
}
/* Commits that first added each personal forecast file (the commits whose receipts matter). */
function personalCommits(DATA, locId) {
  try {
    const out = cp.execFileSync("git", ["-C", DATA, "log", "--no-renames", "--diff-filter=A", "--format=@%H", "--name-only", "--", `personal-forecasts/${locId}`], { encoding: "utf8", maxBuffer: 8e6, stdio: ["ignore", "pipe", "ignore"] });
    const first = new Map(); let c = null;
    out.split("\n").forEach((l) => { if (l.startsWith("@")) c = l.slice(1); else if (l.endsWith(".json") && c) first.set(l, c); }); // log is newest first: the last seen is the first addition
    return [...new Set(first.values())];
  } catch (e) { return []; }
}
const covers = (isAnc, commit) => (p) => p.ref === "refs/heads/main" && (p.after === commit || isAnc(commit, p.after)) && !(p.before && !ZERO.test(p.before) && (p.before === commit || isAnc(commit, p.before)));
/* Build the confirmation context for one scoring run. With network access (collector runs) it queries
   GitHub; without it (local runs, tests without a fake) nothing is confirmed and personal forecasts
   wait. `post` attests confirmed receipts so they stay checkable later. */
function confirmContext(DATA, { locId = "CVG", repo = process.env.GITHUB_REPOSITORY, gh = defaultGh, post = !!process.env.GITHUB_ACTIONS, eventRecs = null, nowMs = Date.now(), eventPath = process.env.GITHUB_EVENT_PATH, eventName = process.env.GITHUB_EVENT_NAME, runId = process.env.GITHUB_RUN_ID } = {}) {
  const ctx = { version: VERSION, at: new Date(nowMs).toISOString(), live: false, coverageFrom: null, confirmed: [], ledger: readPushes(DATA), errors: [], attested: 0 };
  if (!repo) { ctx.errors.push("no repository name: receipts cannot be confirmed with GitHub in this run"); return ctx; }
  const ev = eventRecs || (eventName === "push" && eventPath && fs.existsSync(eventPath) ? fromPushEvent(JSON.parse(fs.readFileSync(eventPath, "utf8")), runId) : []);
  let live = [];
  try { live = fromActivity(gh.activity(repo)); ctx.live = true; ctx.coverageFrom = new Date(nowMs - COVERAGE_DAYS * 864e5).toISOString(); } catch (e) { ctx.errors.push("activity api: " + String(e.message || e).slice(0, 300)); }
  if (live.length || ev.length) record(DATA, [...live, ...ev], ctx.at);
  ctx.ledger = readPushes(DATA);
  const isAnc = ancestry(DATA), commits = personalCommits(DATA, locId);
  const relevant = (list) => list.filter((p) => commits.some((c) => covers(isAnc, c)(p)));
  const shas = [...new Set(relevant([...ctx.ledger, ...live, ...ev]).map((p) => p.after))];
  const attested = [];
  shas.forEach((sha) => { try { attested.push(...fromStatuses(sha, gh.statuses(repo, sha))); } catch (e) { ctx.errors.push(`statuses ${sha.slice(0, 7)}: ` + String(e.message || e).slice(0, 200)); } });
  /* attest live/event receipts that matter and are not yet attested */
  if (post) relevant([...live, ...ev]).forEach((r) => {
    if (attested.some((a) => a.after === r.after)) return;
    try { gh.post(repo, r.after, describe(r)); attested.push({ source: "attested", id: `new:${r.after}`, ref: r.ref, before: r.before, after: r.after, receivedAt: r.receivedAt, origin: r.source }); ctx.attested++; }
    catch (e) { ctx.errors.push(`attest ${r.after.slice(0, 7)}: ` + String(e.message || e).slice(0, 200)); }
  });
  ctx.confirmed = [...live.map((r) => ({ ...r, source: "live" })), ...ev.map((r) => ({ ...r, source: "event" })), ...attested];
  return ctx;
}

/* The push that first brought `commit` onto main, from GitHub-confirmed records only. */
function receiptFor(DATA, commit, ctx, isAnc = ancestry(DATA)) {
  if (!commit) return { error: "No commit." };
  if (!ctx || !Array.isArray(ctx.confirmed)) return { error: "Receipt not confirmed with GitHub in this run (no GitHub access)." };
  const cov = covers(isAnc, commit), AG = RECEIPT_AGREE_S * 1000;
  const hits = ctx.confirmed.filter(cov);
  /* tamper check: every log row covering this commit must agree with what GitHub confirms */
  const cf = ctx.coverageFrom ? Date.parse(ctx.coverageFrom) : Infinity;
  for (const row of (ctx.ledger || []).filter(cov)) {
    const t = Date.parse(row.receivedAt);
    const ok = hits.some((h) => h.after === row.after && Math.abs(Date.parse(h.receivedAt) - t) <= AG && (h.before || null) === (row.before || null));
    if (!ok && (t >= cf || hits.some((h) => h.after === row.after))) return { error: "Receipt log contains a record GitHub does not confirm; excluded as tampered evidence.", conflict: [row], tampered: true };
  }
  if (!hits.length) return { error: "Awaiting GitHub-confirmed receipt evidence for this commit." };
  const byAfter = new Map(); hits.forEach((h) => (byAfter.get(h.after) || byAfter.set(h.after, []).get(h.after)).push(h));
  for (const list of byAfter.values()) {
    const t = list.map((h) => Date.parse(h.receivedAt));
    if (Math.max(...t) - Math.min(...t) > AG) return { error: "Receipt evidence conflicts between GitHub sources; excluded.", conflict: list };
  }
  const first = hits.slice().sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))[0];
  return { receivedAt: first.receivedAt, source: first.source, pushAfter: first.after, kind: first.kind || null, evidence: hits.map((h) => ({ source: h.source, id: h.id, receivedAt: h.receivedAt, after: h.after })) };
}

/* First collector run that processed each submission file (informational). */
function markProcessed(DATA, items, processedAt = U.iso(Date.now()), runId = process.env.GITHUB_RUN_ID || null) {
  const have = new Set(readProcessed(DATA).map((r) => `${r.file}|${r.commit}`));
  const add = items.filter((x) => x.file && x.commit && !have.has(`${x.file}|${x.commit}`)).map((x) => ({ file: x.file, commit: x.commit, processedAt, runId, version: VERSION }));
  if (add.length) U.appendJSONL(path.join(DATA, PROCESSED), add);
  return add.length;
}
module.exports = { VERSION, BOT, CONTEXT, COVERAGE_DAYS, RECEIPT_AGREE_S, FILE, PROCESSED, fromActivity, fromPushEvent, fromStatuses, describe, record, collect, confirmContext, personalCommits, receiptFor, ancestry, readPushes, readProcessed, markProcessed };
