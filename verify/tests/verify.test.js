// Verification service tests (no network). Run: node verify/tests/verify.test.js
// Optional private regression fixtures (station pages are not committed publicly):
//   VERIFY_PRIVATE_FIXTURES=<dir with probe2 pages> node verify/tests/verify.test.js
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const U = require("../lib/util.js"), SCH = require("../lib/schedule.js"), TG = require("../lib/targets.js"), OBS = require("../lib/obs.js");
const TV = require("../lib/tv.js"), NORM = require("../lib/normalize.js"), SC = require("../lib/score.js");
const LOC = require("../config/locations.js").CVG, SCHED = require("../config/schedule.js"), BL = require("../config/blends.js");
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, t, m) => { assert.ok(a != null && Math.abs(a - b) <= t, `${m}: got ${a}, expected ${b}`); n++; };
const T = (s) => Date.parse(s), FX = path.join(__dirname, "fixtures");

/* ---------- schedule: delayed, early, duplicate, DST ---------- */
{
  const r = (s) => SCH.resolve(T(s), LOC.tz, SCHED);
  eq(r("2026-11-03T16:50:00Z").captureId, "2026-11-03_midday", "EST: 11:50 trigger serves the noon slot");
  near(r("2026-11-03T16:50:00Z").waitMs / 60e3, 10, 1e-6, "early run waits until the target");
  eq(SCH.timeliness(T("2026-11-03T17:20:00Z"), T("2026-11-03T17:00:00Z"), SCHED).status, "late", "20 min after target is late, not on time");
  eq(SCH.timeliness(T("2026-11-03T17:14:00Z"), T("2026-11-03T17:00:00Z"), SCHED).status, "on_time", "14 min: on time");
  eq(SCH.timeliness(T("2026-11-03T21:00:00Z"), T("2026-11-03T17:00:00Z"), SCHED).status, "off_schedule", "4 h late: off schedule");
  eq(r("2026-11-03T20:05:00Z").slot, null, "3 h 5 min after noon: no slot (recorded as not due; the slot shows as missed)");
  eq(r("2026-07-01T15:50:00Z").target, T("2026-07-01T16:00:00Z"), "EDT: noon is 16Z");
  eq(r("2026-07-02T03:20:00Z").captureId, "2026-07-01_evening", "EDT: 23:30 slot belongs to the local date, though it is the next UTC day");
  eq(SCH.targetMs("2026-03-08", "12:00", LOC.tz), T("2026-03-08T16:00:00Z"), "spring-forward day: noon EDT");
  eq(SCH.targetMs("2026-11-01", "23:30", LOC.tz), T("2026-11-02T04:30:00Z"), "fall-back day: 23:30 EST");
  eq(SCH.alreadyCaptured([{ captureId: "2026-11-03_midday", outcome: "partial" }], "2026-11-03_midday"), true, "duplicate capture is skipped");
  eq(SCH.alreadyCaptured([{ captureId: "2026-11-03_midday", outcome: "failed" }], "2026-11-03_midday"), false, "a failed attempt can be retried by the backup trigger");
}
/* ---------- target windows: conventions never mix ---------- */
{
  const w = (k, d) => TG.TARGETS[k].window(d, LOC).map(U.iso);
  eq(w("tmax_clim", "2026-07-15"), ["2026-07-15T05:00:00.000Z", "2026-07-16T05:00:00.000Z"], "climate day is local STANDARD time even in July (1 AM-1 AM EDT)");
  eq(w("tmax_day", "2026-01-15"), ["2026-01-15T12:00:00.000Z", "2026-01-16T00:00:00.000Z"], "daytime 7a-7p LST = 12Z-00Z");
  eq(w("tmin_night", "2026-01-15"), ["2026-01-16T00:00:00.000Z", "2026-01-16T12:00:00.000Z"], "overnight low of a date = the night AFTER it");
  eq([TG.leadDay("2026-11-03", "2026-11-04"), TG.leadGroup(2), TG.leadGroup(5)], [1, "d1-2", "d5-7"], "lead day and groups");
}
/* ---------- observations: METAR groups, traces, corrections ---------- */
{
  const m = OBS.parseMetar("KCVG 031752Z 21012KT 10SM FEW250 23/14 A2990 RMK AO2 SLP120 60012 T02330139 10239 20178 58015", "2026-11-03 17:52");
  eq([m.tempC, m.max6C, m.min6C, m.p6.inch], [23.3, 23.9, 17.8, 0.12], "METAR T-group and 6-h groups");
  eq(OBS.parseMetar("KCVG 030552Z 00000KT 10SM CLR M02/M05 A3010 RMK AO2 60000 T10221050 11011 21033 400561022", "2026-11-03 05:52").p6.trace, true, "6-h trace group");
  const reps = [["2026-11-03 17:52", "KCVG 031752Z 21012KT 10SM FEW250 23/14 A2990 RMK AO2 SLP120 T02330139 10239 20178"], ["2026-11-03 23:52", "KCVG 032352Z 21012KT 10SM FEW250 20/14 A2990 RMK AO2 SLP120 60000 T02000139 10250 20200"]]
    .map(([t, x]) => OBS.parseMetar(x, t));
  const mt = OBS.metarTargets(reps, LOC, ["2026-11-03"]);
  eq(mt.find((x) => x.target === "tmax_day").value, OBS.c2f(25.0), "daytime max from the two 6-h maxima");
  eq(mt.find((x) => x.target === "precip_day12").value, 0, "trace 12-h precip is 0 ...");
  eq(mt.find((x) => x.target === "precip_day12").flags, ["trace"], "... with a trace flag");
  eq(mt.find((x) => x.target === "pop01_day12").value, 0, "trace is not measurable precipitation");
  eq(mt.filter((x) => x.target === "tmin_night").length, 0, "missing night reports: unscored, not zero");
  const pno = OBS.metarTargets([reps[0], OBS.parseMetar("KCVG 032352Z 21012KT 10SM 20/14 A2990 RMK AO2 PNO T02000139 10250 20200", "2026-11-03 23:52")], LOC, ["2026-11-03"]);
  eq(pno.filter((x) => /precip/.test(x.target)).length, 0, "precip sensor not operating: amount unknown, unscored");
  const cor = OBS.parseIEM("station,valid,metar\nCVG,2026-11-03 17:52,KCVG 031752Z 21012KT 10SM 23/14 A2990 RMK AO2 T02330139\nCVG,2026-11-03 17:52,KCVG 031752Z COR 21012KT 10SM 22/14 A2990 RMK AO2 T02220139\n");
  eq([cor.length, cor[0].tempC], [1, 22.2], "a corrected METAR replaces the original");
  const cli = OBS.parseCLI(fs.readFileSync(path.join(FX, "cli-cvg-partial-2026-11-02.txt"), "utf8"));
  eq([cli.date, cli.complete, cli.vals.tmax_clim.value, cli.vals.precip_clim.value], ["2026-11-02", false, 59, 0.16], "real CLI: 4 PM report parsed and marked partial-day");
  eq(OBS.cliTargets(cli), [], "partial-day CLI is never used as the daily extreme");
  const full = OBS.parseCLI(fs.readFileSync(path.join(FX, "cli-cvg-partial-2026-11-02.txt"), "utf8").replace(/VALID TODAY AS OF 0400 PM LOCAL TIME\./, "").replace(/(PRECIPITATION \(IN\)\s*\n\s*TODAY\s+)0\.16/, "$1T"));
  const ft = OBS.cliTargets(full);
  eq([full.complete, ft.find((x) => x.target === "precip_clim").value, ft.find((x) => x.target === "precip_clim").flags, ft.find((x) => x.target === "pop01_clim").value], [true, 0, ["trace"], 0], "complete CLI with trace precipitation");
  const cf6 = OBS.parseCF6(fs.readFileSync(path.join(FX, "cf6-cvg-2026-11.txt"), "utf8"));
  eq(cf6.filter((x) => x.date === "2026-11-01").map((x) => [x.target, x.value]), [["tmax_clim", 68], ["tmin_clim", 56], ["precip_clim", 0.01], ["snow_clim", 0], ["pop01_clim", 1]], "real CF6 row");
  const acis = OBS.parseACIS(JSON.parse(fs.readFileSync(path.join(FX, "acis-cvg.json"), "utf8")));
  eq(acis.filter((x) => x.date === "2026-11-02").length, 0, "ACIS 'M' (not yet available) stays missing");
  const b = OBS.best([
    { target: "tmax_clim", date: "2026-11-01", value: 67, src: "CLI", status: "preliminary", seenAt: "2026-11-02T06:00Z" },
    { target: "tmax_clim", date: "2026-11-01", value: 68, src: "CLI", status: "corrected", seenAt: "2026-11-02T09:00Z" },
    { target: "tmax_clim", date: "2026-11-01", value: 99, src: "GHCND", status: "qc-failed" },
  ]).get("tmax_clim|2026-11-01");
  eq([b.value, b.status, b.revised], [68, "corrected", true], "corrections beat preliminary; QC-failed values are never used; revision visible");
  eq(OBS.best([{ target: "tmax_clim", date: "d", value: 68, src: "CLI", status: "corrected" }, { target: "tmax_clim", date: "d", value: 69, src: "GHCND", status: "final" }]).get("tmax_clim|d").value, 69, "final GHCN-Daily wins");
}
/* ---------- TV: dates, lows, uncertain OCR ---------- */
{
  /* synthetic OCR table laid out like the WCPO 9-day graphic */
  const names = ["TUE", "WED", "THU", "FRI", "SAT", "SUN", "MON", "TUE", "WED"], hi = [76, 68, 67, 62, 57, 58, 59, 61, 62], lo = [61, 51, 50, 44, 41, 39, 41, 40];
  const row = (x, y, t, c = 95) => ["5", "1", "1", "1", "1", "1", x - 25, y, 50, 30, c, t].join("\t");
  const mk = (drop) => ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    ...names.map((t, i) => row(145 + i * 123, 220, t)), ...hi.map((v, i) => row(145 + i * 123, 410, `${v}°`)), ...lo.map((v, i) => (drop === i ? null : row(206 + i * 123, 465, `${v}°`))).filter(Boolean)].join("\n");
  const r = TV.parseGraphicTSV(mk(), {});
  eq(r.days.map((d) => [d.dayName, d.hi, d.lo]), names.map((d, i) => [d, hi[i], i < 8 ? lo[i] : null]), "graphic: highs under columns, lows between columns = night after the day");
  eq(r.issues, [], "clean graphic has no issues");
  const bad = TV.parseGraphicTSV(mk(3), {});
  ok(bad.issues.some((x) => /no low after FRI/.test(x)) && bad.confidence <= 0.5, "a missing value lowers confidence and sends the capture to review");
  /* real failure seen in the first OCR run: "51" read as "1" */
  const misread = TV.parseGraphicTSV(mk().replace(/\t51°$/m, "\t1°"), {});
  ok(misread.issues.some((x) => /possible misread/.test(x)), "a dropped digit (51 read as 1) is caught by plausibility, not trusted");
  const days = r.days.map((d) => ({ ...d }));
  eq([TV.assignDates(days, "2026-11-02").ok, days[0].date, days[8].date], [true, "2026-11-03", "2026-11-11"], "issued Monday evening: first column TUE is the next day");
  eq(TV.assignDates(r.days.map((d) => ({ ...d })), "2026-11-03").firstOffset, 0, "issued Tuesday: first column is today");
  ok(!TV.assignDates(r.days.map((d) => ({ ...d })), "2026-10-30").ok, "graphic whose first day is days away from its issue date is ambiguous/stale");
  const wk = TV.adapters.wkrc(`x,"weatherForecasts":[{"dateTime":${T("2026-11-03T05:00:00Z")},"dayOfWeek":"Tuesday","origHiTempF":77,"origLoTempF":60,"origPrecipChance":10,"modifiedHiTempF":null,"modifiedLoTempF":58,"modifiedPrecipChance":20}],"y":1`, { loc: LOC });
  eq([wk.days[0].date, wk.days[0].hi, wk.days[0].lo, wk.days[0].pop, wk.days[0].by], ["2026-11-03", 77, 58, 20, { hi: "automated", lo: "team", pop: "team" }], "Local 12: team edits used where present; automated values labelled as automated");
  /* TV cases: following-night lows map to tmin_night; unreviewed values never score */
  const tvrec = [{ status: "ok", retrievedAt: "2026-11-03T03:30:00Z", captureId: "2026-11-02_evening", slot: "evening", product: "p", station: "S", lows: "following-night", location: { class: "generic-market" }, review: { status: "auto-accepted" }, days: [{ date: "2026-11-03", hi: 76, lo: 61, pop: 10, by: {} }] },
    { status: "ok", retrievedAt: "2026-11-03T03:30:00Z", captureId: "2026-11-02_evening", slot: "evening", product: "q", station: "S", lows: "unknown", location: { class: "generic-market" }, review: { status: "needs-review" }, days: [{ date: "2026-11-03", hi: 70, lo: 50 }] }];
  const cs = SC.cases([], SC.reviewedTV(tvrec, []), LOC);
  eq(cs.map((c) => [c.id, c.target, c.v]), [["p", "tmax_clim", 76], ["p", "tmin_night", 61], ["p", "pop01_clim", 0.1]], "TV: following-night low -> tmin_night; needs-review product not scored");
  const late = SC.cases([], SC.reviewedTV([{ ...tvrec[0], retrievedAt: "2026-11-03T06:00:00Z" }], []), LOC);
  eq(late.map((c) => c.target), ["tmin_night"], "TV retrieved after the climate day began: only windows still ahead are scored");
  const fixed = SC.reviewedTV(tvrec, [{ kind: "tv-review", captureId: "2026-11-02_evening", product: "q", decision: "correct", date: "2026-11-03", field: "hi", value: 71, at: "2026-11-04T00:00Z", by: "brad" }]);
  const ev = (sha) => [{ contentSha256: sha }], base2 = { ...tvrec[1], station: "S", extractVersion: "tv-extract-v1" };
  const dec = { kind: "tv-review", captureId: "2026-11-02_evening", product: "q", decision: "approve", at: "2026-11-04T00:00Z", scope: { station: "S", extractVersion: "tv-extract-v1", contentSha256: "abc", firstDate: "2026-11-03", lastDate: "2026-11-03" } };
  const chk = (r) => SC.reviewedTV([r], [dec])[0].reviewStatus;
  eq(chk({ ...base2, captureId: "2026-11-03_midday", evidence: ev("abc") }), "approved", "decision follows identical evidence with identical date interpretation");
  eq(chk({ ...base2, captureId: "2026-11-10_midday", evidence: ev("abc"), days: [{ date: "2026-11-10", hi: 70, lo: 50 }] }), "needs-review", "same image re-published with different assigned dates: back to review");
  eq(chk({ ...base2, captureId: "2026-11-03_midday", evidence: ev("abc"), extractVersion: "tv-extract-v2" }), "needs-review", "a newer extractor's output is not covered by an old decision");
  eq(chk({ ...base2, captureId: "2026-11-03_midday", evidence: ev("abc"), product: "other" }), "needs-review", "a decision on one product never affects another");
  eq(chk({ ...base2, captureId: "2026-11-03_midday", evidence: ev("abc"), station: "T" }), "needs-review", "... or another station");
  const g = { product: "g", station: "WCPO", captureId: "c1", location: { class: "generic-market" }, review: { status: "auto-accepted" }, days: [{ date: "2026-11-04", hi: 68, lo: 1 }] };
  const w = { product: "w", station: "WCPO", captureId: "c1", location: { class: "generic-market" }, retrievedAt: "x", days: [{ date: "2026-11-04", hi: 68, lo: 51 }] };
  TV.crossCheck(g, w, {}); eq([g.crossCheck.diffs, g.review.status, g.days[0].lo], [["2026-11-04 low 1 vs 51"], "needs-review", 1], "cross-check sends a disagreement to review and never changes the value");
  const g2 = { ...g, review: { status: "auto-accepted" }, crossCheck: undefined }; TV.crossCheck(g2, { ...w, captureId: "c0" }, {});
  eq(g2.crossCheck.skipped, ["different capture edition"], "no cross-check across capture editions");
  const g3 = { ...g, review: { status: "auto-accepted" } }; TV.crossCheck(g3, { ...w, station: "WKRC", location: { class: "explicit-other-point" } }, {});
  eq(g3.crossCheck.skipped, ["different station", "different location scope"], "no cross-check across stations or location scopes");
  eq(SC.cases([], SC.reviewedTV([{ ...base2, retrievedAt: "2026-11-02T20:00:00Z", evidence: ev("zzz") }], []), LOC).length, 0, "unresolved (needs-review) extractions never reach scoring");
  eq([fixed[1].reviewStatus, fixed[1].days[0].hi, fixed[1].days[0].corrected, tvrec[1].days[0].hi], ["corrected", 71, ["hi"], 70], "versioned correction applied at scoring; original record untouched");
}
/* ---------- normalization: outages, incomplete windows, frozen weights ---------- */
{
  Object.entries(BL.FROZEN).forEach(([id, h]) => { const r = BL.recipes.find((x) => x.id === id); eq(U.configHash({ weights: r.weights, rules: r.rules }), h, `recipe ${id} is frozen (edit = new id)`); });
  const hours = Array.from({ length: 24 * 4 }, (_, i) => new Date(T("2026-11-03T00:00:00Z") + i * 3600e3).toISOString().slice(0, 16));
  const det = (v, gapAt) => ({ hourly: { time: hours, temperature_2m: hours.map((_, i) => (i === gapAt ? null : v + (i % 24 === 20 ? 5 : 0))), precipitation: hours.map(() => 0.01), snowfall: hours.map(() => 0), precipitation_probability: hours.map(() => 50) } });
  const raw = { det: { ecmwf_ifs025: det(50), gfs_seamless: det(60, 30) }, ens: {}, nws: {} };
  const cap = { captureId: "2026-11-03_midday", slot: "midday", localDate: "2026-11-03", slotTarget: "x", startedAt: "2026-11-03T17:00:00Z", timeliness: { status: "on_time" } };
  const bdl = NORM.normalize(raw, cap, LOC, BL.recipes);
  eq(bdl.sources.ecmwf_ifs025.tmax_clim["2026-11-04"].v, 55, "source daily high over the climate-day window");
  eq(bdl.sources.gfs_seamless.tmax_clim["2026-11-04"], undefined, "a source missing an hour of the window gives no value (not a partial max)");
  const bv = bdl.blends["baseline-v1"];
  eq(bv.missing.sort(), ["ecmwf_aifs025_single", "ecmwf_ens", "gefs", "gem_seamless", "gfs_hrrr", "icon_seamless", "ncep_nam_conus", "ncep_nbm_conus", "nws", "ukmo_seamless"].sort(), "outage: missing sources recorded");
  eq(bv.actual, { ecmwf_ifs025: 1, gfs_seamless: 0.5 }, "outage: actual weights are the requested ones of the sources present");
  eq(bv.values.tmax_clim["2026-11-04"].v, 55, "blend uses only complete sources for that window");
  eq(bdl.blends["ecmwf-ens-only"].values, {}, "ECMWF-ENS-only blend is empty during an ECMWF ENS outage (never filled from other sources)");
  eq(Object.keys(bdl.sources.ecmwf_ifs025.tmax_clim), ["2026-11-04", "2026-11-05"], "the capture's own date (window already begun at noon) is not a forecast; later dates within data kept");
  eq(bdl.sources.ecmwf_ifs025.pop01_clim, undefined, "deterministic hourly PoP is not mapped to the >=0.01 in daily probability");
}
/* ---------- scoring: matched, on-time only, insufficient, pending ---------- */
{
  eq(SC.metrics("tmax_clim", [{ v: 70, o: 68, date: "a" }, { v: 65, o: 68, date: "b" }]), { n: 2, mae: 2.5, bias: -0.5, within2: 0.5, dates: 2 }, "temperature MAE, bias, within 2°F");
  const pm = SC.metrics("precip_clim", [{ v: 0.2, o: 0.5, date: "a" }, { v: 0.1, o: 0, date: "b" }]);
  eq([pm.wet.n, near(pm.wet.mae, 0.3, 1e-9, "wet MAE") === undefined, pm.dry.falseWet], [1, true, 1], "precip: wet and dry results kept apart");
  near(SC.metrics("pop01_clim", [{ v: 0.8, o: 1, date: "a" }, { v: 0.2, o: 0, date: "b" }]).brier, 0.04, 1e-12, "Brier score");
  const mk = (id, v, d, tl = "on_time") => ({ id, target: "tmax_clim", lead: 2, slot: "midday", timeliness: tl, cls: tl === "on_time" ? "primary" : "late", captureId: `c${d}`, date: `2026-01-${String(d).padStart(2, "0")}`, v, o: 50 });
  const P = [];
  for (let d = 1; d <= 10; d++) { P.push(mk("baseline-v1", 52, d)); P.push(mk("x", 51, d)); }
  P.push(mk("x", 50, 11)); P.push(mk("baseline-v1", 50, 12, "late")); P.push(mk("x", 80, 12, "late"));
  const m = SC.matched(P, ["baseline-v1", "x"], "baseline-v1", "tmax_clim", 2, "midday");
  eq([m.n, m.members.x.score, m.members.x.verdict], [10, 1, "insufficient evidence"], "matched: only shared on-time cases; 10 dates is insufficient evidence");
  const ci = SC.blockBootstrap({ a: [1], b: [1], c: [1] }), ci2 = SC.blockBootstrap({ a: [1], b: [1], c: [1] });
  eq(ci, ci2, "bootstrap is deterministic");
}
/* ---------- observation leakage: the real pilot timings ---------- */
{
  const TM = require("../lib/timing.js");
  const obs = T("2026-11-03T02:52:00Z"); // KCVG routine report used for the 03:00Z valid hour
  eq(["2026-11-03T02:43:14.854Z", "2026-11-03T02:50:15.393Z", "2026-11-03T02:51:49.537Z", "2026-11-03T02:53:42.585Z"].map((r) => TM.obsOk(obs, T(r))), [false, false, false, false],
    "pilot captures 02:43-02:53Z cannot be scored against the 02:52Z report (leads 8.8, 1.7, 0.2, -1.7 min)");
  eq(TM.obsOk(T("2026-11-03T03:52:00Z"), T("2026-11-03T02:43:14.854Z")), true, "the 03:52Z report is 68.8 min after the 02:43Z retrieval: eligible");
  eq(TM.windowOk(T("2026-11-03T05:00:00Z"), T("2026-11-03T04:30:00Z")), false, "a daily window starting 30 min after retrieval is not eligible");
  /* end to end through scoreAll with a temporary archive */
  const os = require("os"), D = fs.mkdtempSync(path.join(os.tmpdir(), "vf-"));
  const cap = { captureId: "2026-11-02_manual_2143", slot: "manual", localDate: "2026-11-02", timeliness: { status: "manual" }, startedAt: "2026-11-03T02:43:13Z", sources: {} };
  U.appendJSONL(path.join(D, "captures", "CVG.jsonl"), [cap]);
  const NV = NORM.VERSION, t0 = T("2026-11-03T03:00:00Z");
  const bundle = { version: NV, retrieval: { last: "2026-11-03T02:43:14.854Z" }, sources: {}, blends: {}, official: {}, hourly: { t0, stepMs: 3600e3, n: 2, temperature_2m: { x: [57.9, 58.5] } } };
  U.mkdirp(path.join(D, "normalized", "CVG", "2026"));
  fs.writeFileSync(path.join(D, "normalized", "CVG", "2026", `${cap.captureId}.${NV}.json.gz`), U.gz(Buffer.from(JSON.stringify(bundle))));
  U.appendJSONL(path.join(D, "obs", "CVG", "2026-11.jsonl"), [{ target: "temp_hourly", time: t0, value: 59, src: "METAR", status: "preliminary", obsAt: T("2026-11-03T02:52:00Z"), flags: [] },
    { target: "temp_hourly", time: t0 + 3600e3, value: 59, src: "METAR", status: "preliminary", obsAt: T("2026-11-03T03:52:00Z"), flags: [] }]);
  const res = SC.scoreAll(D, LOC, T("2026-11-03T05:00:00Z"));
  eq(res.hourlyPairs.map((p) => [p.valid, p.obsMeasured, p.leadMin]), [["2026-11-03T04:00:00.000Z", "2026-11-03T03:52:00.000Z", 68.8]], "scoreAll drops the 03:00Z pair (8.8 min lead) and keeps the 04:00Z pair with its timing");
  eq(res.hourlyPairs[0].normVersion, NV, "each scored pair records the normalizer version that produced it");
}
/* ---------- editions: one capture per edition and source; manual excluded ---------- */
{
  const ED = require("../lib/editions.js");
  const tg = "2026-11-04T17:00:00.000Z", it = (cid, ret) => ({ edition: "CVG|2026-11-04_midday", key: "source:x", captureId: cid, retrievedAt: ret, target: tg });
  const s = ED.select([it("a", "2026-11-04T17:02:00Z"), it("b", "2026-11-04T17:40:00Z"), it("c", "2026-11-04T17:01:00Z")]);
  eq([s.get("CVG|2026-11-04_midday|source:x|c").selected, s.get("CVG|2026-11-04_midday|source:x|a").selected, s.get("CVG|2026-11-04_midday|source:x|b").selected], [true, false, false], "earliest on-time retrieval is the one capture scored; retries and backups add nothing");
  const s2 = ED.select([it("b", "2026-11-04T17:40:00Z"), it("d", "2026-11-04T19:00:00Z")]);
  eq([s2.get("CVG|2026-11-04_midday|source:x|b").selected, s2.get("CVG|2026-11-04_midday|source:x|b").timeliness.status], [true, "late"], "no on-time capture: the earliest late one is kept and labelled late");
  eq([ED.isEdition({ slot: "manual", trigger: "manual" }), ED.isEdition({ slot: "midday", trigger: "backup" })], [false, true], "manual captures are never editions");
  eq([SCH.alreadyCaptured([{ captureId: "e", outcome: "partial" }], "e", "backup"), SCH.alreadyCaptured([{ captureId: "e", outcome: "partial" }], "e", "scheduled")], [false, true], "a backup trigger may retry an incomplete edition");
  const S = require("../lib/sources.js");
  eq(S.cycleOf("det", { meta: { metaUrl: "u", lastRunInit: null } }).status, "unknown", "no reported run: cycle stays unknown (never inferred)");
  eq([S.cycleOf("det", { meta: { metaUrl: "u", lastRunInit: "2026-05-26T00:00:00.000Z", implausible: "reported run is 4000 h old" } }).status, S.cycleOf("det", { meta: { metaUrl: "u", lastRunInit: "2026-05-26T00:00:00.000Z", implausible: "x" } }).reported], ["provider-reported-implausible", "2026-05-26T00:00:00.000Z"], "implausible reported cycle is kept as reported and flagged");
  /* scoreAll: manual excluded from primary, duplicate edition captures superseded */
  const os = require("os"), D = fs.mkdtempSync(path.join(os.tmpdir(), "vfe-")), NV = NORM.VERSION;
  const mkCap = (cid, trig, start) => ({ captureId: cid, slot: cid.includes("manual") ? "manual" : "midday", trigger: trig, localDate: "2026-11-04", slotTarget: tg, startedAt: start, timeliness: { status: "on_time" }, sources: {} });
  const caps = [mkCap("2026-11-04_midday", "scheduled", "2026-11-04T17:00:30Z"), mkCap("2026-11-04_manual_1205", "manual", "2026-11-04T17:05:00Z")];
  U.appendJSONL(path.join(D, "captures", "CVG.jsonl"), caps.concat([{ ...caps[0], captureId: "2026-11-04_midday_a2", edition: "2026-11-04_midday", startedAt: "2026-11-04T17:36:00Z", trigger: "backup" }]));
  U.mkdirp(path.join(D, "normalized", "CVG", "2026"));
  const wb = (cid, ret, v) => fs.writeFileSync(path.join(D, "normalized", "CVG", "2026", `${cid}.${NV}.json.gz`), U.gz(Buffer.from(JSON.stringify({ version: NV, retrieval: { last: ret }, sourceIssue: { x: { retrievedAt: ret } }, sources: { x: { tmax_clim: { "2026-11-06": { v } } } }, blends: {}, official: {} }))));
  wb("2026-11-04_midday", "2026-11-04T17:01:00Z", 60); wb("2026-11-04_manual_1205", "2026-11-04T17:05:10Z", 70); wb("2026-11-04_midday_a2", "2026-11-04T17:36:30Z", 65);
  U.appendJSONL(path.join(D, "obs", "CVG", "o.jsonl"), [{ target: "tmax_clim", date: "2026-11-06", value: 61, src: "CLI", status: "preliminary", flags: [] }]);
  const R = SC.scoreAll(D, LOC, T("2026-11-08T00:00:00Z"));
  eq(R.pairs.map((p) => [p.captureId, p.cls]).sort(), [["2026-11-04_manual_1205", "pilot"], ["2026-11-04_midday", "primary"], ["2026-11-04_midday_a2", "superseded"]], "scheduled edition is primary; its backup retry is superseded; manual capture is pilot only");
  eq(SCH.attemptId([{ captureId: "2026-11-04_midday" }], "2026-11-04_midday"), "2026-11-04_midday_a2", "a retry gets its own capture id (no collision with the first attempt's evidence)");
  const prim = R.summary.filter((x) => x.cls === "primary");
  eq([prim.length, prim[0].n, prim[0].uniqueDates, prim[0].leadHours.minH], [1, 1, 1, 36], "primary summary: pair count with unique dates and actual lead hours (window start - last retrieval)");
}
/* ---------- learning prep: time splits, constraints, shrinkage, no auto-promotion ---------- */
{
  const LR = require("../lib/learn.js");
  const P = Array.from({ length: 40 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`.replace(/-(3[2-9]|4\d)$/, (m) => m), id: "a", target: "tmax_clim", lead: 1, timeliness: "on_time" }));
  const sp = LR.timeSplit([{ date: "2026-01-10" }, { date: "2026-01-12" }, { date: "2026-01-14" }, { date: "2026-01-16" }], "2026-01-14", 3);
  eq([sp.train.map((x) => x.date), sp.eval.map((x) => x.date)], [["2026-01-10"], ["2026-01-16"]], "time split with embargo: no dates near the cut on either side");
  const rows = Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, o: 50 + (i % 7), v: { a: 50 + (i % 7) + 0.5, b: 50 + (i % 7) + 4 * ((i % 2) - 0.5) } }));
  const fw = LR.fitWeights(rows, ["a", "b"], { a: 1, b: 1 }, { lambda: 0.1 });
  ok(fw.ok && Math.abs(fw.weights.a + fw.weights.b - 1) < 1e-9 && fw.weights.a >= 0 && fw.weights.b >= 0 && fw.weights.a > 0.5, "fitted weights are non-negative, sum to 1 and favour the better source");
  const fw2 = LR.fitWeights(rows, ["a", "b"], { a: 1, b: 1 }, { lambda: 50 });
  ok(Math.abs(fw2.weights.a - 0.5) < Math.abs(fw.weights.a - 0.5), "strong shrinkage keeps weights near the baseline");
  near(LR.biasCorrection([2, 2, 2, 2], 20), 2 * 4 / 24, 1e-12, "bias correction is shrunk with a small sample");
  eq(LR.fitWeights(rows.slice(0, 5), ["a", "b"], { a: 1, b: 1 }).ok, false, "no fitting from a tiny sample");
  eq(LR.MODES["local-verified"].recipe, null, "no recipe is 'Local verified' until a recorded promotion");
}
/* ---------- private regression fixtures (real station pages), when available ---------- */
if (process.env.VERIFY_PRIVATE_FIXTURES) {
  const D = process.env.VERIFY_PRIVATE_FIXTURES, rd = (f) => require("zlib").gunzipSync(fs.readFileSync(path.join(D, f))).toString();
  const w = TV.adapters.wcpoWeb(rd("wcpo_com_weather.html.gz"));
  eq(w.days.slice(1, 4).map((d) => [d.date, d.hi, d.lo, d.pop]), [["2026-11-03", 76, 61, 0], ["2026-11-04", 68, 51, 80], ["2026-11-05", 67, 50, 0]], "real WCPO page");
  const k = TV.adapters.wkrc(rd("local12_com_weather.html.gz"), { loc: LOC });
  eq([k.meta.zip, k.days.length >= 7, k.days[1].by.hi], ["45226", true, "automated"], "real Local 12 page");
  const x = TV.adapters.wxix(rd("fox19_com_weather_.html.gz"), { loc: LOC });
  eq(x.days[1].date, "2026-11-03", "real FOX19 page");
}
console.log(`ok - ${n} verification checks passed`);
