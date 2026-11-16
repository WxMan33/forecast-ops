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
ok(r[0].status === "insufficient training data" && r[0].have[0].dates === 10 && /baseline-v1/.test(r[0].fallback) && !fs.existsSync(path.join(E, "experiments/exp-test.fit.json")), "waits below the required training dates; nothing fitted");
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

/* ---------- conditional experiments: every required class must reach the minimum; absent classes wait ---------- */
const COND = { id: "exp-cond", label: "cond", targets: ["tmax_clim"], band: "d1-2", sources: ["nws", "ncep_nbm_conus"], prior: "baseline-v1", condition: { basis: "issue", dim: "forecastChange" }, classes: ["warmup", "cooldown", "small change"], minTrainDates: 5, embargoDays: 3 };
const condPairs = (nDates, clsOf) => { const x = expPairs("2026-05-01", nDates); Object.values(x.issue).forEach((ic) => { ic.implied = { byTarget: { tmax_clim: {} } }; });
  x.ps.forEach((p) => { x.issue[p.captureId].implied.byTarget.tmax_clim[p.date] = { changeClass: clsOf(p.date) }; }); return x; };
const E2 = fs.mkdtempSync(path.join(os.tmpdir(), "exp2-"));
/* 40 dates, plenty of cooldown and small-change cases, NO warmup at all */
let c = condPairs(40, (d) => (+d.slice(8) % 2 ? "cooldown" : "small change")), cr = EX.runAll(E2, [COND], c.ps, c.issue, Date.parse("2026-06-15T00:00:00Z"))[0];
ok(cr.status === "insufficient training data" && cr.absent.length === 1 && cr.absent[0] === "warmup" && cr.have.find((h) => h.cls === "warmup").dates === 0, "an entirely absent warmup class keeps the experiment at insufficient training data");
ok(!fs.existsSync(path.join(E2, "experiments/exp-cond.fit.json")), "nothing is fitted while a required class is absent");
ok(/baseline-v1 \(the prior recipe, unchanged\)/.test(cr.fallback), "the documented fallback is the prior recipe");
/* unknown cases never count toward a class */
c = condPairs(40, (d) => (+d.slice(8) % 3 === 0 ? "warmup" : +d.slice(8) % 3 === 1 ? "cooldown" : "unknown")); cr = EX.runAll(E2, [COND], c.ps, c.issue, Date.parse("2026-06-15T00:00:00Z"))[0];
ok(cr.status === "insufficient training data" && cr.absent[0] === "small change" && cr.casesOutsideClasses > 0, "unknown cases are outside the classes and never fill an absent one");
/* all three present: fitted once, per class */
c = condPairs(40, (d) => ["warmup", "cooldown", "small change"][+d.slice(8) % 3]); cr = EX.runAll(E2, [COND], c.ps, c.issue, Date.parse("2026-06-15T00:00:00Z"))[0];
const cf = JSON.parse(fs.readFileSync(path.join(E2, "experiments/exp-cond.fit.json"), "utf8"));
ok(/fitted now/.test(cr.status) && Object.keys(cf.fits).sort().join() === "cooldown,small change,warmup" && cf.classes.length === 3, "fitted only when every required class has enough dates");
/* a fit lacking a class (e.g. written by an older version) evaluates that class on the fallback */
const E3 = fs.mkdtempSync(path.join(os.tmpdir(), "exp3-")); fs.mkdirSync(path.join(E3, "experiments"));
fs.writeFileSync(path.join(E3, "experiments/exp-cond.fit.json"), JSON.stringify({ ...cf, classes: ["cooldown", "small change"], fits: { cooldown: cf.fits.cooldown, "small change": cf.fits["small change"] } }));
c = condPairs(70, (d) => ["warmup", "cooldown", "small change"][+d.slice(8) % 3]); cr = EX.runAll(E3, [COND], c.ps, c.issue, Date.parse("2026-07-15T00:00:00Z"))[0];
ok(/insufficient training data; uses the fallback/.test(cr.results.warmup.status) && cr.unseenCasesOnFallback > 0, "a class without a fit is evaluated on the fallback, and counted");
ok(/refused/.test(EX.runAll(E2, [{ ...COND, id: "exp-noclasses", classes: undefined }], c.ps, c.issue, Date.now())[0].status), "a conditional experiment that does not name its classes is refused");

/* ---------- status visibility ---------- */
const st = CR.statusSection([{ captureId: "a", edition: "a", context: { error: "boom" } }], null, new Error("context exploded"));
ok(/Context report FAILED this run/.test(st) && /collection and scoring continued/.test(st) && /a \(boom\)/.test(st), "context failures are visible in the status report");

/* ---------- forecast cloud cover, wind and dewpoint (lib/context-vars.js) ---------- */
(async () => {
  const CV = require("../lib/context-vars.js"), SRC = require("../lib/sources.js");
  ok(JSON.stringify(SRC.DET_VARS) === JSON.stringify(["temperature_2m", "precipitation", "snowfall", "precipitation_probability"]), "the primary model request asks for exactly the same variables as before");
  const hours = Array.from({ length: 48 }, (_, i) => new Date(Date.parse("2026-01-10T00:00:00Z") + i * H).toISOString().slice(0, 16));
  const resp = (extra = {}) => JSON.stringify({ hourly_units: { cloud_cover: "%", wind_speed_10m: "mp/h", wind_direction_10m: "°", dew_point_2m: "°F" }, hourly: { time: hours, cloud_cover: hours.map(() => 10), wind_speed_10m: hours.map(() => 3), wind_direction_10m: hours.map(() => 180), dew_point_2m: hours.map(() => 20), ...extra } });
  const calls = []; const fake = (plan) => async (url, opt) => { calls.push({ url, opt }); const r = plan.shift(); const text = r.text || ""; return { ok: r.status === 200, status: r.status, retrievedAt: "2026-01-10T17:00:05.000Z", buf: Buffer.from(text), text, error: r.status ? undefined : "fetch failed" }; };
  const D2 = fs.mkdtempSync(path.join(os.tmpdir(), "cv-"));
  let r = await CV.collect({ lat: 1, lon: 2 }, D2, "cap", ["a", "b", "c", "d"], { fetchRaw: fake([{ status: 200, text: resp() }, { status: 429, text: '{"error":true,"reason":"limit"}' }, { status: 200, text: resp() }, { status: 200, text: resp() }]) });
  ok(r.sources.a.status === "ok" && r.sources.b.status === "rate-limited" && r.sources.c.status === "skipped after rate limit" && r.sources.d.status === "skipped after rate limit" && calls.length === 2, "the first HTTP 429 stops the remaining context requests");
  ok(calls.every((c) => c.opt.tries === 1) && /hourly=cloud_cover,wind_speed_10m,wind_direction_10m,dew_point_2m/.test(calls[0].url) && fs.existsSync(path.join(D2, r.sources.a.file.path)), "one attempt per model; raw response saved as received");
  calls.length = 0; r = await CV.collect({ lat: 1, lon: 2 }, D2, "cap2", ["a", "b", "c", "d", "e"], { fetchRaw: fake([{ status: 0 }, { status: 0 }, { status: 0 }, { status: 200, text: resp() }, { status: 200, text: resp() }]) });
  ok(calls.length === 3 && /network failures/.test(r.sources.d.status), "three requests without an answer stop the rest");
  const d = CV.describe(JSON.parse(resp({ dew_point_2m: hours.map(() => null), wind_direction_10m: undefined, cloud_cover: hours.map((_, i) => (i < 30 ? 50 : null)) })));
  ok(d.status === "partial" && d.missing.includes("dew_point_2m") && d.missing.includes("wind_direction_10m") && d.fields.wind_direction_10m.present === false && d.partialFields.includes("cloud_cover") && d.fields.cloud_cover.lastNonNull === hours[29] + "Z", "absent, all-null and short variables are recorded explicitly");
  /* night classes */
  const mk = (f) => { const m = new Map(); for (let k = 0; k < 96; k++) m.set(Date.parse("2026-01-10T00:00:00Z") + k * H, f(k)); return m; };
  const s0 = Date.parse("2026-01-10T00:00:00Z") + 5 * H + 19 * H; // 7 PM EST on Jan 10
  ok(CV.nightClass(mk(() => ({ cloud: 10, wind: 3, dew: 20 })), s0).cls === "clear/calm", "clear and calm forecast night");
  ok(CV.nightClass(mk(() => ({ cloud: 90, wind: 15 })), s0).cls === "windy", "windy forecast night (tested before cloudy, as for observed nights)");
  ok(CV.nightClass(mk(() => ({ cloud: 90, wind: 5 })), s0).cls === "cloudy", "cloudy forecast night");
  ok(CV.nightClass(mk(() => ({ cloud: 40, wind: 8 })), s0).cls === "mixed", "mixed forecast night");
  ok(CV.nightClass(mk((k) => ({ cloud: k === 27 ? null : 10, wind: 3 })), s0).cls === "unknown", "one missing hour makes the forecast night unknown");
  const nn = CV.nights(mk(() => ({ cloud: 10, wind: 3 })), s0 - 30 * 60e3, ["2026-01-10"], -300);
  ok(nn["2026-01-10"].cls === "not eligible", "a night that starts within an hour of retrieval is not issue-time guidance");
  ok(CV.consensus({ a: { cls: "windy" }, b: { cls: "windy" }, c: { cls: "mixed" } }).cls === "windy" && CV.consensus({ a: { cls: "windy" }, b: { cls: "cloudy" }, c: { cls: "mixed" } }).cls === "no majority" && CV.consensus({ a: { cls: "windy" }, b: { cls: "windy" } }).cls === "unknown", "model consensus needs a majority of at least three");
  const g = CV.seriesNWS({ properties: { skyCover: { uom: "wmoUnit:percent", values: [{ validTime: "2026-01-10T00:00:00+00:00/PT3H", value: 80 }] }, windSpeed: { uom: "wmoUnit:km_h-1", values: [{ validTime: "2026-01-10T00:00:00+00:00/PT2H", value: 16.09344 }] }, dewpoint: { uom: "wmoUnit:degC", values: [{ validTime: "2026-01-10T01:00:00+00:00/PT1H", value: 0 }] } } });
  const t1 = Date.parse("2026-01-10T01:00:00Z");
  ok(g.get(Date.parse("2026-01-10T02:00:00Z")).cloud === 80 && Math.abs(g.get(t1).wind - 10) < 1e-6 && g.get(t1).dew === 32 && g.get(Date.parse("2026-01-10T02:00:00Z")).wind === null, "NWS grid intervals expand hour by hour, in °F and mph; gaps stay null");
  /* issue context: forecast nights are issue basis, kept apart from observed nights */
  const ic2 = CX.issueContext(cap, bundle, obsRows, loc, {}, { models: { m1: { status: "ok", retrievedAt: last, series: mk(() => ({ cloud: 10, wind: 3 })) }, m2: { status: "rate-limited", retrievedAt: null, series: null } }, nws: null });
  ok(ic2.version === "context-v2" && ic2.forecastNight.nights["2026-01-10"].models.m1.cls === "clear/calm" && ic2.forecastNight.nights["2026-01-10"].nws.cls === "not available in our current collection" && ic2.forecastNight.modelStatus.m2 === "rate-limited", "forecast nights at issue, with each model's collection status");
  ok(ic2.contextAvailability.sources.m1.cloud[0] === true && ic2.contextAvailability.sources.m2.cloud === null, "availability by lead: a model whose request failed is 'not collected', not 'unavailable'");
  ok(!("radiational" in { [ic2.forecastNight.nights["2026-01-10"].models.m1.cls]: 1 }) && CX.nightClass(Array(12).fill("KTST 100052Z 00000KT 10SM CLR 05/01 A3010")).cls === "radiational", "forecast (clear/calm) and observed (radiational) night classes stay separate vocabularies");
  /* ---------- climate indices as published ---------- */
  const CI = require("../lib/climate-indices.js");
  ok(JSON.stringify(CI.latest("seasonal", "SEAS  YR   TOTAL   ANOM\nASO 2026  26.10  -0.55\nSON 2026  25.90  -0.71\n")) === JSON.stringify({ period: "SON 2026", value: -0.71, valueField: "last column (anomaly)" }), "ONI latest season parsed");
  ok(CI.latest("daily-csv", "year,month,day,ao_index_cdas\n2026,11,14,-0.321\n2026,11,15,0.112\n").date === "2026-11-15", "daily CPC index parsed");
  ok(CI.latest("rmm", "RMM values\nyear month day RMM1 RMM2 phase amplitude\n2026 11 14 0.512 -1.201 4 1.306 Final_value\n").phase === 4 && CI.latest("rmm", "<html>blocked</html>") === null, "MJO RMM parsed; an unknown format is unparsed, not guessed");
  const C1 = fs.mkdtempSync(path.join(os.tmpdir(), "ci-")), body = "SEAS YR TOTAL ANOM\nSON 2026 25.90 -0.71\n";
  const list = [{ id: "a", url: "https://h1.test/a", format: "seasonal", publisher: "p" }, { id: "b", url: "https://h1.test/b", format: "seasonal", publisher: "p" }, { id: "c", url: "https://h2.test/c", format: "seasonal", publisher: "p" }];
  const cfake = (m) => async (url) => { calls.push(url); const x = m[url]; return { ok: x.status === 200, status: x.status, retrievedAt: new Date(x.at || Date.parse("2026-11-16T15:00:00Z")).toISOString(), lastModified: "Mon, 09 Nov 2026 14:00:00 GMT", buf: Buffer.from(x.text || ""), text: x.text || "" }; };
  calls.length = 0;
  let cr1 = await CI.run(C1, Date.parse("2026-11-16T15:00:00Z"), { list, fetchRaw: cfake({ "https://h1.test/a": { status: 403 }, "https://h1.test/b": { status: 200, text: body }, "https://h2.test/c": { status: 200, text: body } }) });
  ok(calls.length === 2 && /skipped: h1.test/.test(cr1.results[1].status) && cr1.results[2].status === "new version saved", "a 403 stops further requests to that host for the day; other hosts continue");
  const log1 = U.readJSONLDir(path.join(C1, "climate", "retrievals"));
  ok(log1.find((r) => r.id === "c").serverLastModified === "Mon, 09 Nov 2026 14:00:00 GMT" && log1.find((r) => r.id === "c").at && log1.find((r) => r.id === "a").httpStatus === 403, "retrieval time, HTTP status and the server's Last-Modified are logged, failures included");
  calls.length = 0; cr1 = await CI.run(C1, Date.parse("2026-11-16T18:00:00Z"), { list, fetchRaw: cfake({}) });
  ok(calls.length === 0 && cr1.results[2].status === "already retrieved today", "at most once per UTC day");
  calls.length = 0; cr1 = await CI.run(C1, Date.parse("2026-11-17T15:00:00Z"), { list: [list[2]], fetchRaw: cfake({ "https://h2.test/c": { status: 200, text: body, at: Date.parse("2026-11-17T15:00:00Z") } }) });
  ok(cr1.results[0].status === "unchanged", "an unchanged publication is logged but not stored again");
  cr1 = await CI.run(C1, Date.parse("2026-11-18T15:00:00Z"), { list: [list[2]], fetchRaw: cfake({ "https://h2.test/c": { status: 200, text: body.replace("-0.71", "-0.65"), at: Date.parse("2026-11-18T15:00:00Z") } }) });
  const saved = fs.readdirSync(path.join(C1, "climate", "raw", "c"));
  ok(cr1.results[0].status === "new version saved" && saved.length === 2, "a revised publication is kept as a new version beside the old one");
  console.log(fails ? `${fails} of ${n} context checks failed` : `ok - ${n} context checks passed`);
  process.exit(fails ? 1 : 0);
})();
