/* Context layer: issue-time vs derived context, never-rewritten issue records, thresholds, small-sample
   flags, matched cells, and the experimental-weight protocol (fit once on earlier dates, evaluate only on
   later unseen dates, refuse observed-basis conditions). Synthetic values only. */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const CX = require("../lib/context.js"), ST = require("../lib/stratify.js"), EX = require("../lib/experiments.js"), CR = require("../lib/context-report.js");
const U = require("../lib/util.js"), TG = require("../lib/targets.js");
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log("FAIL " + m); } };
const loc = { id: "TST", tz: "America/New_York", lstOffsetMin: -300 };
const H = 3600e3;

/* ---------- a synthetic capture and bundle ---------- */
const t0 = Date.parse("2026-01-10T00:00:00Z"), last = "2026-01-10T17:00:02.000Z";
const hourly = (f) => Array.from({ length: 24 * 6 }, (_, i) => f(t0 + i * H));
const ref = hourly((t) => { const d = Math.floor((t - t0 + 5 * H) / 86400e3); return 30 + d * 8 + 5 * Math.sin(((t / H) % 24) / 24 * 2 * Math.PI); }); // warms about 8 °F a day
const bundle = { version: "normalize-test", retrieval: { first: "2026-01-10T17:00:00.000Z", last }, hourly: { t0, stepMs: H, temperature_2m: { "blend:baseline-v1": ref } },
  sources: { ecmwf_ens: { tmax_clim: { "2026-01-12": { v: 50, ens: { p10: 45, p90: 54 } } } } },
  blends: { "baseline-v1": { configHash: "abc", group: "ope", requested: { nws: 3 }, actual: { nws: 3 }, missing: ["gfs_seamless"], values: { tmax_clim: { "2026-01-12": { v: 50, spread: [47, 53] } }, tmin_clim: {} } } } };
const cap = { captureId: "2026-01-10_midday", edition: "2026-01-10_midday", localDate: "2026-01-10", slot: "midday", trigger: "scheduled", startedAt: "2026-01-10T17:00:00.000Z", timeliness: { status: "on_time" }, code: { commit: "x" },
  sources: { nws: { id: "nws", kind: "nws", status: "ok", retrievedAt: last, cycle: { kind: "nws-grid-update-time", reported: "2026-01-10T15:00:00Z", status: "provider-reported" } }, gfs_seamless: { id: "gfs_seamless", kind: "det", status: "failed", httpStatus: 429 } } };
const obsRows = [
  { target: "tmax_clim", date: "2026-01-09", value: 31, src: "CLI", status: "preliminary", firstSeenAt: "2026-01-10T08:00:00.000Z" },
  { target: "tmax_clim", date: "2026-01-10", value: 40, src: "CLI", status: "preliminary", firstSeenAt: "2026-01-11T08:00:00.000Z" }, // ingested after issue: must be ignored
];
const ic = CX.issueContext(cap, bundle, obsRows, loc, { "baseline-v1": { frozen: "2026-11-03" } });
ok(ic.basis === "issue" && ic.version === CX.VERSION, "issue context is labelled");
ok(ic.knownAtIssue.tmax_clim && ic.knownAtIssue.tmax_clim.date === "2026-01-09", "only observations ingested by the last retrieval are known at issue");
ok(ic.availability.missing.length === 1 && ic.availability.missing[0] === "gfs_seamless" && ic.sources.gfs_seamless.httpStatus === 429, "missing sources and their HTTP status are recorded");
ok(ic.sources.nws.nwsGridUpdateTime === "2026-01-10T15:00:00Z" && ic.sources.nws.modelVersion === null, "NWS grid update time kept; model version stays unknown");
ok(ic.recipes["baseline-v1"].missing[0] === "gfs_seamless" && ic.recipes["baseline-v1"].configHash === "abc", "recipe hash and missing sources recorded");
const imp = ic.implied.byTarget.tmax_clim["2026-01-12"];
ok(imp && imp.changeClass === "warmup" && imp.change >= CX.CHANGE_F, "forecast's own warmup is classified at issue");
ok(imp.spreadClass === "wide" && imp.ensWidth10_90 === 9 && imp.mixedSourceRange === 6, "ensemble width and mixed-source range recorded");
ok(ic.climatePatterns.every((p) => p.status === "not collected" && p.value === null), "climate patterns reserved, not collected");
/* missing values stay missing */
const gap = ref.slice(); gap[40] = null;
ok(CX.windowExtreme(gap, t0, H, TG.TARGETS.tmax_clim.window("2026-01-11", loc), Math.max) === null, "a missing hour makes the daily extreme missing, not filled");
ok(CX.changeClass(null) === "unknown" && CX.changeClass(6) === "warmup" && CX.changeClass(-6) === "cooldown" && CX.changeClass(5.9) === "small change", "change thresholds");

/* ---------- stored once, never rewritten ---------- */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-"));
const s1 = CR.storeIssueContext(DATA, loc, cap, bundle, obsRows, Date.parse(last) + 60e3);
const before = fs.readFileSync(path.join(DATA, s1.path), "utf8");
const s2 = CR.storeIssueContext(DATA, loc, cap, { ...bundle, blends: {} }, [], Date.parse(last) + 86400e3);
ok(!s1.existed && s2.existed && fs.readFileSync(path.join(DATA, s1.path), "utf8") === before, "an issue context is never rewritten");
ok(JSON.parse(before).builtAfterCapture === false, "built at capture time is labelled so");
const s3 = CR.storeIssueContext(DATA, loc, { ...cap, captureId: "2026-01-10_midday_a2" }, bundle, obsRows, Date.parse(last) + 2 * 86400e3);
ok(s3.ctx.builtAfterCapture === true && s3.ctx.knownAtIssue.tmax_clim.date === "2026-01-09", "a backfilled context says so and still uses only issue-time observations");

/* ---------- observed classes ---------- */
const rep = (wind, sky) => `KTST 100052Z ${wind} 10SM ${sky} 05/01 A3010 RMK AO2`;
ok(CX.nightClass(Array(12).fill(rep("00000KT", "CLR"))).cls === "radiational", "clear and calm night is radiational");
ok(CX.nightClass(Array(12).fill(rep("18012KT", "OVC040"))).cls === "windy", "windy night");
ok(CX.nightClass(Array(12).fill(rep("18004KT", "BKN030"))).cls === "cloudy", "cloudy night");
ok(CX.nightClass(Array(8).fill(rep("00000KT", "CLR"))).cls === "unknown", "too few reports stay unknown");
const best = new Map([["tmax_clim|2026-01-11", { value: 30 }], ["tmax_clim|2026-01-12", { value: 45 }], ["tmin_clim|2026-01-12", { value: 20 }], ["precip_clim|2026-01-12", { value: 0.2 }]]);
const oc = CX.observedContext(best, [], loc)["2026-01-12"];
ok(oc.basis === "observed" && oc.tmaxClass === "warmup" && oc.tminClass === "unknown" && oc.wet === true, "observed classes; a missing previous day stays unknown");

/* ---------- stratified cells ---------- */
function pairsFor(nDates, members, opts = {}) {
  const ps = [];
  for (let i = 0; i < nDates; i++) { const d = U.addDays("2026-02-01", i), cid = `${U.addDays(d, -1)}_midday`;
    members.forEach((m, k) => { if (opts.skip && opts.skip(m, i)) return; ps.push({ cls: "primary", track: m.includes("-") ? "blend" : "source", id: m, target: "tmax_clim", date: d, lead: 1, slot: "midday", captureId: cid, v: 50 + k, o: 50 }); }); }
  return ps;
}
let t = ST.stratify({ pairs: pairsFor(9, ["baseline-v1", "nbm-only"]), hourlyPairs: [] }, {}, {}, loc).find((x) => x.dim === "all" && x.set === "blends");
ok(t && t.dates === 9 && !t.lowestMAE && t.flag === "too few dates to compare", "under 10 dates: no ordering");
t = ST.stratify({ pairs: pairsFor(12, ["baseline-v1", "nbm-only"]), hourlyPairs: [] }, {}, {}, loc).find((x) => x.dim === "all" && x.set === "blends");
ok(t.lowestMAE === "baseline-v1" && /small sample/.test(t.flag) && t.members["nbm-only"].mae === 1, "10–29 dates: descriptive ordering, small-sample flag");
t = ST.stratify({ pairs: pairsFor(20, ["baseline-v1", "nbm-only", "gefs-only"], { skip: (m, i) => m === "gefs-only" && i > 3 }), hourlyPairs: [] }, {}, {}, loc).find((x) => x.dim === "all" && x.set === "blends");
ok(t.membersUsed.length === 2 && t.membersLeftOut[0] === "gefs-only" && t.cases === 20, "a member with short coverage is left out and named, not allowed to shrink the matched set");
const issueMap = { }; pairsFor(12, ["baseline-v1"]).forEach((p) => { issueMap[p.captureId] = { availability: { missing: [] }, implied: { byTarget: { tmax_clim: { [p.date]: { changeClass: p.date < "2026-02-07" ? "warmup" : "cooldown", spreadClass: "narrow" } } } } }; });
const cells = ST.stratify({ pairs: pairsFor(12, ["baseline-v1", "nbm-only"]), hourlyPairs: [] }, issueMap, {}, loc).filter((x) => x.dim === "forecastChange" && x.set === "blends");
ok(cells.length === 2 && cells.every((c) => c.basis === "issue") && cells.reduce((s, c) => s + c.cases, 0) === 12, "issue-basis classes split the matched cases");

/* ---------- experiments ---------- */
const EXP = [{ id: "exp-test", label: "test", targets: ["tmax_clim"], band: "d1-2", sources: ["nws", "ncep_nbm_conus"], prior: "baseline-v1", condition: null, minTrainDates: 15, embargoDays: 3 },
  { id: "exp-bad", label: "bad", targets: ["tmax_clim"], band: "d1-2", sources: ["nws"], prior: "baseline-v1", condition: { basis: "observed", dim: "observedChange" }, minTrainDates: 1, embargoDays: 0 }];
const expPairs = (from, nDates) => { const ps = [], issue = {}; for (let i = 0; i < nDates; i++) { const d = U.addDays(from, i), cid = `${U.addDays(d, -1)}_midday`;
  issue[cid] = { startedAt: `${U.addDays(d, -1)}T17:00:00.000Z`, implied: { byTarget: {} } };
  [["nws", 49], ["ncep_nbm_conus", 52], ["baseline-v1", 51]].forEach(([id, v]) => ps.push({ cls: "primary", track: id.includes("-") ? "blend" : "source", id, target: "tmax_clim", date: d, lead: 1, captureId: cid, v, o: 50 })); }
  return { ps, issue }; };
const E = fs.mkdtempSync(path.join(os.tmpdir(), "exp-")), blendsBefore = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "../config/blends.js"))).digest("hex");
let a = expPairs("2026-03-01", 10), r = EX.runAll(E, EXP, a.ps, a.issue, Date.parse("2026-03-11T00:00:00Z"));
ok(r[0].status === "waiting for training dates" && r[0].have[0].dates === 10 && !fs.existsSync(path.join(E, "experiments/exp-test.fit.json")), "waits below the required training dates; nothing fitted");
ok(/refused/.test(r[1].status), "an observed-basis condition is refused");
a = expPairs("2026-03-01", 20); r = EX.runAll(E, EXP, a.ps, a.issue, Date.parse("2026-03-21T00:00:00Z"));
const fitFile = path.join(E, "experiments/exp-test.fit.json"), fit1 = fs.readFileSync(fitFile, "utf8");
ok(/fitted now/.test(r[0].status) && JSON.parse(fit1).lastTrainDate === "2026-03-20", "fitted once on the earlier dates");
const later = expPairs("2026-03-01", 40); r = EX.runAll(E, EXP, later.ps, later.issue, Date.parse("2026-04-10T00:00:00Z"));
ok(fs.readFileSync(fitFile, "utf8") === fit1, "a fit is never redone or edited");
const res0 = r[0].results.all;
/* unseen = captures after the fit (started 2026-03-21 or later) and dates after 2026-03-23 (embargo) */
ok(r[0].status === "evaluating on unseen dates" && r[0].evalAfter === "2026-03-23" && res0.evalDates === 17, "evaluated only on later captures beyond the embargo");
ok(/insufficient unseen dates/.test(res0.status), "short evaluation reads as insufficient");
ok(crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "../config/blends.js"))).digest("hex") === blendsBefore, "recipes are untouched");

console.log(fails ? `${fails} of ${n} context checks failed` : `ok - ${n} context checks passed`);
process.exit(fails ? 1 : 0);
