/* Trend archive: cycle selection, per-source pairing, identical-window comparison, coverage and
   interval limits, plain-language agreement rules, timing and rain rounds. Synthetic rows only. */
"use strict";
const assert = require("assert"), TA = require("../assets/trend-archive-core.js");
let n = 0; const ok = (c, m) => { assert(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const H = 3600e3, Z = (s) => Date.parse(s);
eq(TA.cycles(Z("2026-11-04T20:41Z"), 5).map((x) => new Date(x).toISOString().slice(5, 13)), ["11-04T12", "11-04T00", "11-03T12", "11-03T00", "11-02T12"], "five most recent 00Z/12Z cycles, newest first");
eq(TA.cycles(Z("2026-11-04T00:00Z"), 1).map(TA.cycleId), ["2026110400"], "a cycle at its own time counts");
/* index with confirmed runs and one snapshot-only source */
const cyc = ["2026-11-04T12:00:00.000Z", "2026-11-04T00:00:00.000Z", "2026-11-03T12:00:00.000Z", "2026-11-03T00:00:00.000Z", "2026-11-02T12:00:00.000Z"];
const idx = { cycles: cyc.map((c, k) => ({ cycle: c, sources: { a: { identity: "confirmed-run", file: `a${k}` }, b: { identity: k === 2 ? "unavailable" : "confirmed-run", file: `b${k}` }, e: { identity: "snapshot", file: `e${k}` } } })) };
const pr = (lag) => Object.fromEntries(TA.pairs(idx, lag).map((p) => [p.id, p.ref ? new Date(p.ref.cycle).toISOString().slice(5, 13) : p.why]));
eq(pr(12), { a: "11-04T00", b: "11-04T00" }, "12 h: each source vs its own previous run; snapshots never paired as runs");
eq(pr(24), { a: "11-03T12", b: "no archived 24-h-earlier run" }, "24 h: a missing earlier run is reported, never substituted");
eq(pr(48), { a: "11-02T12", b: "11-02T12" }, "48 h: newest vs two days earlier");
/* comparisons only over identical windows and coverage */
const win = [Z("2026-11-06T05:00Z"), Z("2026-11-07T05:00Z")];
const row = (o) => ({ win, hi: 60, lo: 40, qpf: 0.2, sn: 0, support: { hi: [0], lo: [0], qpf: [0], sn: [0] }, prorated: false, timing: { status: "wet", onset: Z("2026-11-06T18:00Z"), end: Z("2026-11-06T22:00Z"), onsetClipped: false, endClipped: false, rounds: [{}] }, ...o });
let c = TA.compareSource({ "2026-11-06": row({ hi: 63 }) }, { "2026-11-06": row({}) });
eq(c[0].fields.hi, { from: 60, to: 63, delta: 3 }, "same window: compared");
eq(TA.compareSource({ "2026-11-06": row({ win: [win[0] + H, win[1] + H] }) }, { "2026-11-06": row({}) }), [], "different windows: not compared");
c = TA.compareSource({ "2026-11-06": row({ hi: 70, support: { hi: [0, 1], lo: [0], qpf: [0], sn: [0] } }) }, { "2026-11-06": row({}) });
ok(!c[0].fields.hi && c[0].limited.some((x) => /coverage/.test(x)), "changed member coverage: excluded and reported");
c = TA.compareSource({ "2026-11-06": row({ qpf: 0.6, prorated: true }) }, { "2026-11-06": row({}) });
ok(!c[0].fields.qpf && c[0].limited.some((x) => /interval/.test(x)), "prorated intervals: precipitation not compared");
c = TA.compareSource({ "2026-11-06": row({ hi: null }) }, { "2026-11-06": row({}) });
ok(!c[0].fields.hi, "missing value: no comparison (never zero)");
/* plain-language rules */
const src = (id, cur, ref) => ({ id, items: TA.compareSource({ "2026-11-06": row(cur) }, { "2026-11-06": row(ref || {}) }) });
let L = TA.summarize([src("a", { qpf: 0.26 }), src("b", { qpf: 0.27 }), src("c", { qpf: 0.25 }), src("d", { qpf: 0.2 })]);
ok(L.some((l) => l.kind === "qpf" && /risen slightly/.test(l.text) && /3 of 4/.test(l.text)), `three of four up by ~0.06": "risen slightly" (${L.map((l) => l.text)})`);
L = TA.summarize([src("a", { qpf: 0.26 }), src("b", { qpf: 0.27 })]);
eq(L.filter((l) => l.kind === "qpf"), [], "fewer than three sources: no trend line");
L = TA.summarize([src("a", { qpf: 0.5 }), src("b", { qpf: 0.45 }), src("c", { qpf: 0.0 }), src("d", { qpf: 0.02 })]);
ok(L.some((l) => l.kind === "qpf" && /disagree/.test(l.text)), "two up sharply, two down: reported as disagreement, not a trend");
L = TA.summarize([src("a", { hi: 53 }), src("b", { hi: 52 }), src("c", { hi: 54 })]);
ok(L.some((l) => /high is trending sharply cooler/.test(l.text)), "high down 6-8°F in all three: sharply cooler");
L = TA.summarize([src("a", { hi: 60.4 }), src("b", { hi: 60.5 }), src("c", { hi: 59.6 })]);
eq(L.filter((l) => l.kind === "hi"), [], "changes under 1°F: nothing said");
/* timing: earlier arrival; clipped windows and quiet days excluded; rounds kept separate */
const t = (onsetH, o = {}) => ({ timing: { status: "wet", onset: Z("2026-11-06T00:00Z") + onsetH * H, end: Z("2026-11-06T23:00Z"), onsetClipped: false, endClipped: false, rounds: [{}], ...o } });
L = TA.summarize([src("a", t(14), t(18)), src("b", t(15), t(18)), src("c", t(13), t(17)), src("d", t(18, { onsetClipped: true }), t(18))]);
ok(L.some((l) => l.kind === "onset" && /arrive earlier/.test(l.text) && /3 of 3/.test(l.text)), "three models 3-4 h earlier: arrival earlier; the clipped window is excluded");
L = TA.summarize([src("a", t(14, { rounds: [{}, {}] }), t(14)), src("b", t(14, { rounds: [{}, {}] }), t(14)), src("c", t(14, { rounds: [{}, {}] }), t(14))]);
ok(L.some((l) => l.kind === "rounds" && /separate rounds/.test(l.text)), "rounds: a split into separate rounds is reported");
L = TA.summarize([src("a", { timing: { status: "quiet", rounds: [] } }, t(14)), src("b", { timing: { status: "quiet", rounds: [] } }, t(14)), src("c", t(14), t(14)), src("d", { timing: { status: "quiet", rounds: [] } }, t(15))]);
ok(L.some((l) => l.kind === "signal" && /Fewer models now show precipitation \(4 → 1 of 4\)/.test(l.text)), "precipitation signal lost in three of four models");
const ens = { timing: { status: "ensemble", members: 31, wet: 20, onset: 0, end: 0 } };
eq(TA.compareSource({ "2026-11-06": row(ens) }, { "2026-11-06": row(ens) })[0].timing, null, "ensemble timing is not compared as a single run");
/* whole-archive trend: missing files are skipped with a reason */
const mk = (rows) => ({ version: 1, method: "model-trends-v1", tz: "America/New_York", loc: [39.0446, -84.6723], rows });
const files = { a0: mk({ "2026-11-06": row({ hi: 63 }) }), a1: mk({ "2026-11-06": row({}) }), b0: mk({ "2026-11-06": row({ hi: 64 }) }) };
const T = TA.trend(idx, files, 12);
eq([T.perSource.map((p) => p.id), T.skipped], [["a"], [{ id: "b", why: "archive file unavailable" }]], "unavailable files are skipped with a reason");
console.log(`ok - ${n} trend-archive checks passed`);
