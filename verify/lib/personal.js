/* Append-only personal forecasts (personal-v2).
   ISSUE TIME is GitHub's recorded receipt of the push that first brought the forecast onto main
   (lib/receipts.js). The commit's own timestamp is kept as "submittedAt" but never decides
   eligibility, order or lead. The original bytes come from the first commit that added the file.
   SELECTION POLICY (per captured edition):
     1. Candidates are accepted submissions received within the edition's on-time window
        (target .. target + 15 min, same local date, starting snapshot from that edition).
     2. The earliest RECEIVED candidate is primary; ties break on forecast ID.
     3. An original that was later altered or deleted keeps its primary slot (and is excluded), so
        changing a file can never promote a later revision.
     4. A submission excluded for any other reason (invalid values, unverifiable starting snapshot,
        missing or conflicting receipt evidence) never held the slot: the next valid candidate is
        primary. Such submissions are listed with their reasons.
     5. Later candidates are revisions; submissions outside the window are personal updates. All are
        kept and shown; only primary cases enter matched comparisons. Selection never looks at
        observations or scores.
   METHOD: my-forecast-v1 values are frozen and were entered for CVG climate days (midnight to
   midnight local standard time). A case is compared only while the current target definition is
   that same convention and window; otherwise it is excluded as "target definition changed". The
   starting snapshot's normalizer version is provenance only (basisNormVersion). */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const U = require("./util"), TG = require("./targets"), ED = require("./editions"), TM = require("./timing"), R = require("./receipts");
const M = require("../../assets/my-forecast-core");
const VERSION = "personal-v3";
/* What each personal-forecast method meant by its fields, FROZEN here independently of lib/targets.js:
   the convention label and the exact window function. my-forecast-v1 is CVG-only, so its climate day
   is midnight to midnight EST (UTC-5) all year. A case is compared only while the current target has
   the same convention AND produces the same UTC window; changing either excludes it explicitly. */
const DAY = 864e5, EST = 5 * 3600e3;
const climateDayEST = (d) => { const s = Date.parse(d + "T00:00:00Z") + EST; return [s, s + DAY]; };
const DEFINED = { "my-forecast-v1": {
  tmin_clim: { conv: "climate-day-LST", window: climateDayEST },
  tmax_clim: { conv: "climate-day-LST", window: climateDayEST },
  precip_clim: { conv: "climate-day-LST", window: climateDayEST } } };

function files(dir) { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".json") ? [path.join(dir, e.name)] : [])); }

/* Original bytes and the commit that first added the file. */
function provenance(DATA, rel) {
  const git = (args) => cp.execFileSync("git", ["-C", DATA, ...args], { encoding: "utf8", maxBuffer: 4e6, stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (git(["rev-parse", "--is-shallow-repository"]) !== "false") return { error: "Full repository history required to establish provenance." };
    const commits = git(["log", "--no-renames", "--diff-filter=A", "--format=%H", "--", rel]).split("\n").filter(Boolean), commit = commits.at(-1);
    if (!commit) return { error: "Not committed yet." };
    const original = cp.execFileSync("git", ["-C", DATA, "show", commit + ":" + rel], { maxBuffer: 4e6, stdio: ["ignore", "pipe", "ignore"] });
    const current = fs.existsSync(path.join(DATA, rel)) ? fs.readFileSync(path.join(DATA, rel)) : null;
    const submittedAt = git(["show", "-s", "--format=%cI", commit]);
    if (!current || !original.equals(current)) return { error: "Saved forecast was modified or deleted after its first commit; excluded from scoring.", commit, submittedAt, originalRecord: JSON.parse(original.toString()), tampered: true };
    return { commit, submittedAt, sha256: U.sha256(original) };
  } catch (e) { return { error: "Git provenance unavailable; excluded from scoring." }; }
}

const ms = (s) => (s ? Date.parse(s) : NaN);

/* rctx: GitHub confirmation context from receipts.confirmContext (required for any receipt to count). */
function load(DATA, loc, nowMs = Date.now(), rctx = null) {
  const entries = [], cases = [], caps = U.readJSONL(path.join(DATA, "captures", loc.id + ".jsonl"));
  const isAnc = R.ancestry(DATA);
  const processed = new Map(R.readProcessed(DATA).map((p) => [`${p.file}|${p.commit}`, p]));
  const paths = new Set(files(path.join(DATA, "personal-forecasts", loc.id)).map((f) => path.relative(DATA, f).split(path.sep).join("/")));
  try {
    const history = cp.execFileSync("git", ["-C", DATA, "log", "--no-renames", "--diff-filter=A", "--format=", "--name-only", "--", "personal-forecasts/" + loc.id], { encoding: "utf8", maxBuffer: 4e6, stdio: ["ignore", "pipe", "ignore"] });
    history.split("\n").filter((p) => p.startsWith("personal-forecasts/" + loc.id + "/") && p.endsWith(".json") && !p.includes("..")).forEach((p) => paths.add(p));
  } catch (e) { /* provenance errors on current files remain explicit */ }

  for (const rel of paths) {
    let r; const p = provenance(DATA, rel);
    try { r = p.originalRecord || JSON.parse(fs.readFileSync(path.join(DATA, rel))); } catch (e) { entries.push({ path: rel, status: "invalid", errors: ["Invalid JSON or deleted unverified file."] }); continue; }
    const rc = p.commit ? R.receiptFor(DATA, p.commit, rctx, isAnc) : { error: "No commit." };
    const receivedAt = rc.receivedAt || null, issued = ms(receivedAt);
    const errors = [], notes = [];
    if (p.error) errors.push(p.error);
    let awaiting = false;
    if (rc.error) { errors.push(rc.error); awaiting = !rc.conflict && !rc.tampered && !p.error; }
    errors.push(...(Number.isFinite(issued) ? M.validate(r, issued, loc.lstOffsetMin) : M.validate(r, NaN, loc.lstOffsetMin).filter((x) => !/Issue time/.test(x))));
    if (rel !== "personal-forecasts/" + loc.id + "/" + r.id + ".json") errors.push("Forecast ID must match its unique file name.");
    if (Number.isFinite(issued) && issued > nowMs + 60000) errors.push("Receipt time is in the future.");
    const sub = ms(p.submittedAt);
    if (Number.isFinite(sub) && Number.isFinite(issued)) {
      const lagMin = (issued - sub) / 60e3;
      if (lagMin < -R.RECEIPT_AGREE_S / 60) notes.push(`Commit time is ${Math.round(-lagMin)} min after GitHub's receipt (clock difference); receipt time used.`);
      else if (lagMin > 2) notes.push(`Committed ${Math.round(lagMin)} min before GitHub received it; receipt time used.`);
    }
    let cap, b, blend;
    try {
      cap = caps.find((c) => c.captureId === r.basis.captureId); const bRel = r.basis.bundle;
      if (!cap || !bRel.startsWith("normalized/" + loc.id + "/") || bRel.includes("..")) throw Error();
      b = JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA, bRel))).toString()); blend = b.blends[r.basis.recipeId];
      if (!blend || blend.configHash !== r.basis.hash || b.version !== r.basis.normalizer || b.captureId !== cap.captureId) throw Error();
      if (!Number.isFinite(issued) || Date.parse(b.retrieval.last) > issued) { if (Number.isFinite(issued)) throw Error(); }
    } catch (e) { errors.push("Starting blend snapshot could not be verified."); }
    const pr = processed.get(`${rel}|${p.commit}`);
    const e = { ...r, path: rel, submittedAt: p.submittedAt || null, receivedAt, receiptSource: rc.source || null, receiptEvidence: rc.evidence || rc.conflict || null, processedAt: pr ? pr.processedAt : null,
      issuedAt: receivedAt, issueTimeRule: "receivedAt (GitHub receipt of the push)", commit: p.commit || null, sha256: p.sha256 || null,
      status: awaiting && errors.length === 1 ? "awaiting-receipt" : errors.length ? "excluded" : "accepted", errors, notes, tampered: !!p.tampered };
    entries.push(e);
    const localDate = Number.isFinite(issued) ? U.localParts(issued, loc.tz).date : null;
    const inEdition = !!cap && ED.isEdition(cap) && localDate === cap.localDate;
    e.timeliness = inEdition ? ED.lateness(receivedAt, cap.slotTarget).status : "personal";
    e.slot = inEdition ? cap.slot : "personal";
    e.edition = inEdition ? ED.editionId(cap) : null;
    if (e.status !== "accepted") continue;
    e.baseRetrievedAt = b.retrieval.last;
    const defined = DEFINED[r.method] || {};
    r.days.forEach((d) => Object.entries(M.targets).forEach(([key, target]) => {
      if (d[key] == null) return;
      const tg = TG.TARGETS[target], def = defined[target];
      const win = def ? def.window(d.date) : null, cur = tg.window(d.date, loc);
      const compatible = !!def && def.conv === tg.conv && cur[0] === win[0] && cur[1] === win[1];
      cases.push({ track: "personal", id: "my-forecast", submissionId: r.id, captureId: cap.captureId, slot: e.slot, edition: e.edition, target, date: d.date, lead: TG.leadDay(localDate, d.date), v: d[key],
        conv: def ? def.conv : null, window: win, currentConv: tg.conv, currentWindow: cur, definedAs: def ? `${r.method}: ${def.conv} (frozen window)` : null, compatible,
        retrievedLast: receivedAt, issuedAt: receivedAt, receivedAt, submittedAt: p.submittedAt, processedAt: e.processedAt, leadHours: win ? (win[0] - issued) / 3600000 : null,
        normVersion: null, basisNormVersion: b.version, basis: r.basis, baseValue: blend.values?.[target]?.[d.date]?.v ?? null, baseRetrievedAt: b.retrieval.last, commit: p.commit, file: rel,
        flags: ["personal forecast", "issue time: GitHub receipt"].concat(compatible ? [] : ["target definition changed"]),
        cls: e.timeliness === "on_time" ? "eligible" : "personal" });
    }));
  }
  /* Selection policy (see header): earliest RECEIVED on-time candidate per edition, compared as times. */
  const first = new Map();
  entries.filter((e) => (e.status === "accepted" || e.tampered) && e.timeliness === "on_time" && e.edition)
    .sort((a, b) => ms(a.receivedAt) - ms(b.receivedAt) || String(a.id).localeCompare(String(b.id)))
    .forEach((e) => { if (!first.has(e.edition)) first.set(e.edition, e.id); });
  cases.forEach((c) => { if (c.cls === "eligible") c.cls = first.get(c.edition) === c.submissionId ? "primary" : "revision"; });
  entries.forEach((e) => { e.scoringClass = e.status === "awaiting-receipt" ? "awaiting-receipt" : e.status !== "accepted" ? "excluded" : e.timeliness !== "on_time" ? "personal" : first.get(e.edition) === e.id ? "primary" : "revision"; });
  return { version: M.VERSION, scorer: VERSION, receipts: R.VERSION, entries, cases };
}

function score(personal, best, loc, nowMs) {
  const pairs = [], pending = [], excluded = [];
  personal.cases.forEach((c) => {
    /* the frozen my-forecast-v1 window is the forecast's window; the current target must still match it */
    if (!c.window) { excluded.push({ ...c, why: "unknown personal forecast method" }); return; }
    const w = c.window, cur = TG.TARGETS[c.target].window(c.date, loc);
    if (!TM.windowOk(w[0], Date.parse(c.receivedAt))) return;
    if (!c.compatible || cur[0] !== w[0] || cur[1] !== w[1] || TG.TARGETS[c.target].conv !== c.conv) { excluded.push({ ...c, why: "target definition changed since submission" }); return; }
    const o = best.get(c.target + "|" + c.date);
    if (o) pairs.push({ ...c, o: o.value, obsSrc: o.src, obsStatus: o.status, obsRevised: o.revised, obsFlags: o.flags });
    else pending.push({ ...c, status: w[1] > nowMs ? "future" : "waiting for observation" });
  });
  return { pairs, pending, excluded };
}
module.exports = { VERSION, DEFINED, load, score, provenance };
