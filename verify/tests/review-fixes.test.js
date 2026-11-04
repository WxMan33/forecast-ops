/* Regression tests for the Nov 4 verification review (findings 1-5). Each block reproduces a failure
   that was demonstrated against a copy of the real archive, and asserts the corrected behaviour.
   All records here are synthetic test data. */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process"), zlib = require("zlib");
const R = require("../lib/receipts"), P = require("../lib/personal"), SC = require("../lib/score"), NORM = require("../lib/normalize"), OBS = require("../lib/obs"), TG = require("../lib/targets");
const BL = require("../config/blends"), loc = require("../config/locations").CVG, M = require("../../assets/my-forecast-core");
const VC = require("../../assets/verify-core.js"), PC = require("../../assets/precip-core.js");
let n = 0; const ok = (c, msg) => { assert(c, msg); n++; }, eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

/* ---------- a synthetic data repository with one on-time edition capture ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-fixes-"));
const git = (args, date) => cp.execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
const basis = { captureId: "2026-11-03_midday", recipeId: "baseline-v1", hash: "hash", bundle: "normalized/CVG/2026/2026-11-03_midday.normalize-v4.json.gz", normalizer: "normalize-v4" };
const rec = (id, hi) => ({ schema: 1, method: M.VERSION, id, location: "CVG", basis, note: "synthetic", days: [{ date: "2026-11-05", hi, lo: 40, precip: 0 }] });
let pushN = 0;
const commit = (r, commitDate) => { const f = `personal-forecasts/CVG/${r.id}.json`; fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(r) + "\n"); git(["add", f]); git(["commit", "-qm", "synthetic " + r.id], commitDate); return git(["rev-parse", "HEAD"]).trim(); };
/* Synthetic GitHub: what the activity API returns, the push event of the scoring run, and commit
   statuses (creator recorded). Receipts count only through these, never through the log alone. */
const truth = [], events = [], statusStore = new Map();
const gh = { activity: () => truth, statuses: (r, sha) => statusStore.get(sha) || [],
  post: (r, sha, description) => { const l = statusStore.get(sha) || []; l.push({ id: 1000 + l.length, context: R.CONTEXT, creator: { login: R.BOT }, description, created_at: "x" }); statusStore.set(sha, l); } };
const push = (after, at, source = "activity", before = null) => { const ts = new Date(at).toISOString();
  if (source === "event") events.push({ source: "push-event", id: `run:${++pushN}:${after}`, ref: "refs/heads/main", before, after, receivedAt: ts, kind: "push" });
  else truth.push({ id: ++pushN, activity_type: "push", ref: "refs/heads/main", before, after, timestamp: ts }); };
const ctxFor = (d, now, o = {}) => R.confirmContext(d, { repo: "o/r", gh, post: false, nowMs: now, eventRecs: events, ...o });
const L = (now = NOW, o = {}, d = dir) => P.load(d, loc, now, ctxFor(d, now, o));
const entry = (p, id) => p.entries.find((e) => e.id === id);
const NOW = Date.parse("2026-11-04T02:00:00Z");
try {
  git(["init", "-q", "-b", "main"]); git(["config", "user.name", "Synthetic"]); git(["config", "user.email", "synthetic@example.invalid"]);
  fs.mkdirSync(path.join(dir, "captures"), { recursive: true });
  fs.writeFileSync(path.join(dir, "captures/CVG.jsonl"), JSON.stringify({ captureId: basis.captureId, edition: basis.captureId, localDate: "2026-11-03", slot: "midday", trigger: "scheduled", slotTarget: "2026-11-03T17:00:00Z", startedAt: "2026-11-03T17:00:00Z" }) + "\n");
  const bundle = { captureId: basis.captureId, version: basis.normalizer, retrieval: { last: "2026-11-03T17:00:03Z" }, hourly: { t0: 0, stepMs: 3600e3, n: 0, temperature_2m: {} }, sources: {}, blends: { "baseline-v1": { configHash: "hash", values: {} } } };
  fs.mkdirSync(path.dirname(path.join(dir, basis.bundle)), { recursive: true }); fs.writeFileSync(path.join(dir, basis.bundle), zlib.gzipSync(JSON.stringify(bundle)));
  git(["add", "."]); git(["commit", "-qm", "base"], "2026-11-03T16:00:00Z"); const c0 = git(["rev-parse", "HEAD"]).trim(); push(c0, "2026-11-03T16:00:00Z");

  /* 1. Backdated commit: the commit says 17:05 on Nov 3, but GitHub received it on Nov 4. */
  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const cA = commit(rec(A, 70), "2026-11-03T17:05:00Z");
  let p = P.load(dir, loc, NOW, null);
  eq(entry(p, A).status, "awaiting-receipt", "1: with no GitHub access in the run, nothing is confirmed");
  p = L();
  eq([entry(p, A).status, entry(p, A).scoringClass, p.cases.length], ["awaiting-receipt", "awaiting-receipt", 0], "1: without GitHub receipt evidence a commit's own timestamp never makes it eligible");
  push(cA, "2026-11-04T01:29:00Z", "activity", c0);
  p = L();
  eq([entry(p, A).receivedAt, entry(p, A).submittedAt.startsWith("2026-11-03T17:05"), entry(p, A).scoringClass], ["2026-11-04T01:29:00.000Z", true, "personal"], "1: issue time is GitHub's receipt; the backdated submission is a late personal update, not primary");
  ok(entry(p, A).notes.some((x) => /before GitHub received it/.test(x)), "1: the gap between commit time and receipt is reported");

  /* 1b. Delayed workflow processing does not make an on-time submission late. */
  const B = "bbbbbbbb-0000-4000-8000-000000000002";
  const cB = commit(rec(B, 61), "2026-11-03T17:06:00Z"); push(cB, "2026-11-03T17:06:10Z", "activity", cA);
  R.markProcessed(dir, [{ file: `personal-forecasts/CVG/${B}.json`, commit: cB }], "2026-11-03T19:40:00Z", "run-late");
  p = L();
  eq([entry(p, B).receivedAt, entry(p, B).processedAt, entry(p, B).timeliness, entry(p, B).scoringClass], ["2026-11-03T17:06:10.000Z", "2026-11-03T19:40:00Z", "on_time", "primary"], "1b: a workflow that starts 2.5 h late records processedAt but eligibility follows receipt");
  ok(p.cases.every((c) => c.submissionId !== B || (c.receivedAt && c.submittedAt && c.processedAt)), "1b: submitted, received and processed times are kept separately on every case");

  /* 1c. Conflicting GitHub evidence for the same push excludes the submission. */
  const C = "cccccccc-0000-4000-8000-000000000003";
  const cC = commit(rec(C, 62), "2026-11-03T17:07:00Z"); push(cC, "2026-11-03T17:07:00Z", "activity", cB); push(cC, "2026-11-03T17:20:00Z", "event", cB);
  p = L();
  eq([entry(p, C).status, entry(p, C).errors.some((x) => /conflicts/.test(x))], ["excluded", true], "1c: receipt sources that disagree by more than 2 minutes exclude the submission");
  events.length = 0; // that push event belonged to one run only

  /* 1e. TRUST BOUNDARY: an invented early log row for the forecast commit cannot override GitHub's
         genuine (later) receipt for the push containing it. */
  const F = "ffffffff-0000-4000-8000-000000000006";
  const cF1 = commit(rec(F, 65), "2026-11-03T17:05:00Z"), cF2 = commit({ ...rec("ffffffff-0000-4000-8000-0000000000f2", 1), days: [{ date: "2026-11-06", hi: 50, lo: 40, precip: 0 }] }, "2026-11-03T17:05:30Z");
  push(cF2, "2026-11-03T21:00:00Z", "activity", cC); // genuine: both commits arrived in one push at 21:00
  R.record(dir, [{ source: "activity-api", id: "forged-1", ref: "refs/heads/main", before: cC, after: cF1, receivedAt: "2026-11-03T17:05:05.000Z", kind: "push" }]);
  p = L();
  eq([entry(p, F).status, entry(p, F).receivedAt, entry(p, F).errors.some((x) => /does not confirm/.test(x))], ["excluded", null, true], "1e: a log row GitHub does not confirm (inside live coverage) is treated as tampering and excludes the submission");
  ok(!p.cases.some((c) => c.submissionId === F), "1e: the forged early receipt never produces a primary or scored case");
  const later = Date.parse("2026-12-20T00:00:00Z"); // after the activity API's coverage has moved on
  const ctxPost = ctxFor(dir, NOW, { post: true }); // a collector run while the push was still in the live API attests it
  ok(ctxPost.attested >= 1 && (statusStore.get(cF2) || []).some((x) => x.creator.login === R.BOT), "1e: collector runs attest live receipts as github-actions[bot] commit statuses");
  truth.length = 0; // GitHub's activity retention has passed
  p = L(later);
  eq([entry(p, F).status, entry(p, F).receivedAt, entry(p, F).receiptSource], ["accepted", "2026-11-03T21:00:00.000Z", "attested"], "1e: once outside live coverage the forged row is ignored and the attested genuine receipt (21:00) is used, never the forged 17:05");
  statusStore.set(cF1, [{ id: 1, context: R.CONTEXT, creator: { login: "WxMan33" }, description: `receipt-v1 at=2026-11-03T17:05:05Z before=${cC} src=activity:forged`, created_at: "x" }]);
  p = L(later);
  eq(entry(p, F).receivedAt, "2026-11-03T21:00:00.000Z", "1e: a status created by any account other than github-actions[bot] is not evidence");
  statusStore.set(cF2, [...statusStore.get(cF2), { id: 77, context: R.CONTEXT, creator: { login: R.BOT }, description: `receipt-v1 at=2026-11-03T17:05:05Z before=${cC} src=activity:x`, created_at: "x" }]);
  p = L(later);
  eq(entry(p, F).status, "excluded", "1e: two bot attestations that disagree for the same push exclude the submission");
  statusStore.get(cF2).pop();
  const noNet = R.confirmContext(dir, { repo: "o/r", gh: { activity: () => { throw new Error("HTTP 403"); }, statuses: () => { throw new Error("HTTP 403"); }, post: () => {} }, post: false, nowMs: later, eventRecs: [] });
  p = P.load(dir, loc, later, noNet);
  eq([entry(p, F).status, noNet.errors.length > 0], ["awaiting-receipt", true], "1e: if GitHub cannot be queried the log is never used on its own: submissions wait");

  /* 1d. GitHub record parsing and de-duplication. */
  const act = R.fromActivity([{ id: 9, activity_type: "push", ref: "refs/heads/main", before: "b", after: "a", timestamp: "2026-11-03T12:10:00-05:00", actor: { login: "u" } }, { id: 10, activity_type: "branch_creation", after: "x", timestamp: "2026-11-03T17:00:00Z" }]);
  eq(act.map((x) => [x.id, x.receivedAt]), [["9", "2026-11-03T17:10:00.000Z"]], "1d: activity timestamps with any offset are normalized to UTC; non-push activity ignored");
  eq(R.fromPushEvent({ ref: "refs/heads/main", before: "b", after: "a", repository: { pushed_at: 1762189800 } }, "77")[0].receivedAt, "2025-11-03T17:10:00.000Z", "1d: push event repository.pushed_at (epoch seconds) is GitHub's receipt time");
  const evFile = path.join(dir, "event.json"); fs.writeFileSync(evFile, JSON.stringify({ ref: "refs/heads/main", before: "b", after: "zz", repository: { pushed_at: 1762189800 } }));
  const got = R.collect(dir, { eventPath: evFile, eventName: "push", repo: "o/r", runId: "5", fetchActivity: () => [{ id: 99, activity_type: "push", ref: "refs/heads/main", before: "b", after: "zz", timestamp: "2025-11-03T17:10:30Z" }] });
  const again = R.collect(dir, { eventPath: evFile, eventName: "push", repo: "o/r", runId: "5", fetchActivity: () => [{ id: 99, activity_type: "push", ref: "refs/heads/main", before: "b", after: "zz", timestamp: "2025-11-03T17:10:30Z" }] });
  eq([got.pushEvent, got.activity, again.pushEvent, again.activity], [1, 1, 0, 0], "1d: receipts are appended once (append-only log)");
  eq(R.collect(dir, { repo: "o/r", fetchActivity: () => { throw new Error("HTTP 403"); } }).errors[0].startsWith("activity api"), true, "1d: an API failure is reported, never invented");

  /* 2. Order by parsed receipt time, not by text: an earlier receipt written with a -05:00 offset wins. */
  const D = "dddddddd-0000-4000-8000-000000000004", E = "eeeeeeee-0000-4000-8000-000000000005";
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "review-order-"));
  cp.execFileSync("cp", ["-a", dir + "/.", dir2]);
  const git2 = (args, date) => cp.execFileSync("git", ["-C", dir2, ...args], { encoding: "utf8", env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
  fs.rmSync(path.join(dir2, "receipts"), { recursive: true, force: true }); git2(["checkout", "-q", "--detach", c0]); git2(["checkout", "-q", "-B", "main"]);
  const put2 = (r, d) => { const f = `personal-forecasts/CVG/${r.id}.json`; fs.mkdirSync(path.dirname(path.join(dir2, f)), { recursive: true }); fs.writeFileSync(path.join(dir2, f), JSON.stringify(r) + "\n"); git2(["add", f]); git2(["commit", "-qm", r.id], d); return git2(["rev-parse", "HEAD"]).trim(); };
  const cD = put2(rec(D, 63), "2026-11-03T17:05:00+00:00"), cE = put2(rec(E, 64), "2026-11-03T12:10:00-05:00");
  const truth2 = [{ id: 1, activity_type: "push", ref: "refs/heads/main", before: c0, after: cD, timestamp: "2026-11-03T12:05:00-05:00" }, { id: 2, activity_type: "push", ref: "refs/heads/main", before: cD, after: cE, timestamp: "2026-11-03T17:10:00Z" }];
  p = P.load(dir2, loc, NOW, R.confirmContext(dir2, { repo: "o/r", gh: { activity: () => truth2, statuses: () => [], post: () => {} }, post: false, nowMs: NOW, eventRecs: [] }));
  eq([entry(p, D).scoringClass, entry(p, E).scoringClass], ["primary", "revision"], "2: the earliest RECEIVED save is primary whatever offsets the commit or receipt text uses");
  fs.rmSync(dir2, { recursive: true, force: true });

  /* 3. Normalizer changes: personal values stay frozen and remain comparable while the target
        definition is unchanged; archive forecasts from mixed normalizers are never combined. */
  const W = TG.TARGETS.tmax_clim.window("2026-11-05", loc);
  const pr = (id, extra) => ({ id, cls: "primary", captureId: basis.captureId, target: "tmax_clim", date: "2026-11-05", slot: "midday", lead: 2, v: 60, o: 58, conv: "climate-day-LST", window: W, ...extra });
  const personal = pr("my-forecast", { track: "personal", normVersion: null, basisNormVersion: "normalize-v4", compatible: true });
  const m1 = VC.matched([personal, pr("blend:baseline-v1", { track: "blend", normVersion: "normalize-v5" })], { members: ["my-forecast", "blend:baseline-v1"], target: "tmax_clim", slot: "midday", lead: 2 });
  eq(m1.n, 1, "3: a personal forecast started from a v4 snapshot still matches v5 archive forecasts with the same definition and window");
  const m2 = VC.matched([pr("blend:a", { track: "blend", normVersion: "normalize-v4" }), pr("blend:b", { track: "blend", normVersion: "normalize-v5" })], { members: ["blend:a", "blend:b"], target: "tmax_clim", slot: "midday", lead: 2 });
  eq([m2.n, m2.methodMismatch], [0, 1], "3: archive forecasts from different normalizer versions are excluded, not merged");
  const m3 = VC.matched([{ ...personal, compatible: false }, pr("blend:baseline-v1", { track: "blend", normVersion: "normalize-v5" })], { members: ["my-forecast", "blend:baseline-v1"], target: "tmax_clim", slot: "midday", lead: 2 });
  eq(m3.n, 0, "3: a personal case whose definition no longer matches is excluded");
  const m4 = VC.matched([personal, pr("blend:baseline-v1", { track: "blend", normVersion: "normalize-v5", window: [W[0] + 3600e3, W[1] + 3600e3] })], { members: ["my-forecast", "blend:baseline-v1"], target: "tmax_clim", slot: "midday", lead: 2 });
  eq(m4.n, 0, "3: different windows never join");
  const pp = (id, extra) => ({ id, cls: "primary", captureId: basis.captureId, target: "precip_clim", date: "2026-11-05", slot: "midday", lead: 2, v: 0.1, o: 0.2, period: "climate-day-LST", window: W, flags: [], ...extra });
  eq(PC.select([pp("my-forecast", { track: "personal", normVersion: null, basisNormVersion: "normalize-v4", compatible: true }), pp("nbm", { track: "source", normVersion: "normalize-v5" })], { members: ["my-forecast", "nbm"], slot: "midday", lead: 2 }).n, 1, "3: precipitation join treats the personal snapshot version as provenance");
  const ps = PC.select([pp("a", { track: "source", normVersion: "normalize-v4" }), pp("b", { track: "source", normVersion: "normalize-v5" })], { members: ["a", "b"], slot: "midday", lead: 2 });
  eq([ps.n, ps.excluded["mixed normalizer versions"]], [0, 1], "3: precipitation join excludes mixed archive normalizers");
  const origWin = TG.TARGETS.tmax_clim.window; TG.TARGETS.tmax_clim.window = (d, L2) => origWin(d, L2).map((x) => x + 3600e3); // boundary moves 1 h, label unchanged
  try { const lp = L(), sc = P.score(lp, new Map([["tmax_clim|2026-11-05", { value: 58 }]]), loc, NOW + 5 * 864e5), c = lp.cases.find((x) => x.target === "tmax_clim" && x.submissionId === B);
    eq([c.conv, TG.TARGETS.tmax_clim.conv, c.window[0], c.currentWindow[0] - c.window[0], c.compatible], ["climate-day-LST", "climate-day-LST", Date.parse("2026-11-05T05:00:00Z"), 3600e3, false], "3: the personal window is frozen for my-forecast-v1; a shifted current boundary with the same label is detected");
    ok(sc.excluded.some((x) => x.target === "tmax_clim" && x.why === "target definition changed since submission") && !sc.pairs.some((x) => x.target === "tmax_clim"), "3: a boundary change under an unchanged convention label excludes the personal case");
  } finally { TG.TARGETS.tmax_clim.window = origWin; }
  { const lp = L(), c = lp.cases.find((x) => x.target === "tmax_clim" && x.submissionId === B); eq([c.compatible, c.window], [true, [Date.parse("2026-11-05T05:00:00Z"), Date.parse("2026-11-06T05:00:00Z")]], "3: unchanged target: frozen window equals the current one (midnight-midnight EST)"); }
  const conv = TG.TARGETS.tmax_clim.conv; TG.TARGETS.tmax_clim.conv = "some-new-definition";
  try { const lp = L(), sc = P.score(lp, new Map([["tmax_clim|2026-11-05", { value: 58 }]]), loc, NOW + 5 * 864e5);
    ok(lp.cases.some((c) => c.target === "tmax_clim") && lp.cases.filter((c) => c.target === "tmax_clim").every((c) => c.compatible === false) && sc.excluded.some((x) => x.why === "target definition changed since submission") && !sc.pairs.some((x) => x.target === "tmax_clim"), "3: an incompatible target-definition change excludes personal cases explicitly");
  } finally { TG.TARGETS.tmax_clim.conv = conv; }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

/* 4. Default v2 is prospective: never applied to, or scored for, a capture that started before it existed. */
{
  const v2 = BL.recipes.find((r) => r.id === "brad-default-2026-11-03-v2");
  ok(v2 && v2.effectiveFrom, "4: Default v2 carries an effectiveFrom");
  const hours = Array.from({ length: 96 }, (_, i) => new Date(Date.parse("2026-11-03T00:00:00Z") + i * 3600e3).toISOString().slice(0, 16));
  const det = { hourly: { time: hours, temperature_2m: hours.map(() => 50), precipitation: hours.map(() => 0), snowfall: hours.map(() => 0), precipitation_probability: hours.map(() => 0) } };
  const raw = { det: { ecmwf_ifs025: det }, ens: {}, nws: {} };
  const early = NORM.normalize(raw, { captureId: "x", slot: "midday", localDate: "2026-11-03", slotTarget: "2026-11-03T17:00:00Z", startedAt: "2026-11-03T17:00:00Z" }, loc, BL.recipes);
  eq([!!early.blends[v2.id], early.recipesNotApplied.map((x) => x.id).includes(v2.id)], [false, true], "4: re-normalizing the Nov 3 noon capture does not create Default v2 values");
  const later = NORM.normalize(raw, { captureId: "y", slot: "evening", localDate: "2026-11-03", slotTarget: "2026-11-04T04:30:00Z", startedAt: "2026-11-04T04:30:00Z" }, loc, BL.recipes);
  ok(!!later.blends[v2.id] && later.blends[v2.id].configHash === BL.FROZEN[v2.id], "4: captures after effectiveFrom carry Default v2 with its frozen hash");
  eq([SC.retrospective(v2.id, { startedAt: "2026-11-03T17:00:00Z" }), SC.retrospective(v2.id, { startedAt: "2026-11-04T04:30:00Z" }), SC.retrospective("baseline-v1", { startedAt: "2026-11-01T00:00:00Z" })], [true, false, false], "4: scoring labels pre-effective values retrospective");
  const capEarly = { captureId: "2026-11-03_midday", slot: "midday", trigger: "scheduled", localDate: "2026-11-03", slotTarget: "2026-11-03T17:00:00Z", startedAt: "2026-11-03T17:00:00Z", timeliness: { status: "on_time" } };
  const b = { version: "normalize-v4", retrieval: { last: "2026-11-03T17:00:03Z" }, sources: {}, official: {}, blends: { [v2.id]: { group: "ope", values: { tmax_clim: { "2026-11-05": { v: 60 } } } } } };
  const cs = SC.cases([{ cap: capEarly, b }], [], loc);
  eq(cs.map((c) => c.retrospective), [true], "4: a forced pre-effective value is flagged in the case list");
}

/* 5. ACIS accumulated totals are not a climate-day amount. */
{
  const rows = OBS.parseACIS({ data: [["2026-11-01", "60", "40", "M", "M"], ["2026-11-02", "61", "41", "1.40A", "0.0"], ["2026-11-03", "62", "42", "0.12", "0.0"]] });
  eq(rows.filter((r) => r.target === "precip_clim").map((r) => [r.date, r.value]), [["2026-11-03", 0.12]], "5: an accumulated ('A') total is not stored as that day's precipitation");
  eq(rows.filter((r) => r.target === "pop01_clim").map((r) => r.date), ["2026-11-03"], "5: ... nor as a wet/dry outcome");
  const best = OBS.best([{ target: "precip_clim", date: "2026-11-02", value: 1.4, src: "ACIS", status: "revised", flags: ["accumulated"] }, { target: "precip_clim", date: "2026-11-02", value: 0.31, src: "CLI", status: "preliminary", flags: [] }]);
  eq(best.get("precip_clim|2026-11-02").value, 0.31, "5: archived accumulated rows never outrank the day's own CLI amount");
}
console.log(`ok - ${n} review-fix regression checks passed`);
