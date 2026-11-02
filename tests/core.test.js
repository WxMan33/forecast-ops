// Run with: node tests/core.test.js   (no dependencies)
const C = require("../assets/ops-core.js");
const assert = require("assert");
let n = 0;
const near = (a, b, tol, msg) => { assert.ok(a != null && Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const S = C.severe, MS = C.MS;

/* ---------- sounding math against hand-worked cases ---------- */
const straight = [{ h: 0, u: 0, v: 0 }];
for (let h = 1000; h <= 9000; h += 1000) straight.push({ h, u: (Math.min(h, 6000) / 6000) * 40, v: 0 });
const bk = S.bunkers(straight);
near(S.bulk(straight, 6000), 40, 1e-9, "0-6 km bulk shear");
near(bk.rm.u, 20, 1e-6, "Bunkers RM u (mean wind)");
near(bk.rm.v, -7.5 / MS, 1e-6, "Bunkers RM deviates 7.5 m/s right of shear");
near(S.srh(straight, 3000, bk.rm), 20 * (7.5 / MS) * MS * MS, 1, "SRH, straight hodograph offset from storm");
const circ = [];
for (let h = 0; h <= 3000; h += 100) { const a = (h / 3000) * (Math.PI / 2); circ.push({ h, u: -20 * Math.cos(a), v: 20 * Math.sin(a) }); }
near(S.srh(circ, 3000, { u: 0, v: 0 }), 2 * ((Math.PI * 400) / 4) * MS * MS, 2, "SRH, veering quarter circle");
near(S.stp(1500, 500, 150, 20 / MS), 1, 1e-9, "STP unity case");
near(S.scp(1000, 50, 20 / MS), 1, 1e-9, "SCP unity case");
near(S.fromDir({ u: 0, v: -10 }), 0, 1e-9, "wind from north");

/* ---------- signal and data completeness are separate ---------- */
eq(S.assess({ cape: 50, bs6: null, srh1: null, srh3: null, lcl: 900 }), { tier: "normal", limited: true, missing: ["0–6 km shear", "0–1 km SRH", "0–3 km SRH"] }, "severe: low CAPE with no winds is LOW *and* limited");
eq(S.assess({ cape: 1500, bs6: 45, srh1: null, srh3: null, lcl: 800, scp: null, stp: null }).tier, "prepare", "severe: elevated from CAPE+shear even with SRH missing");
eq(S.assess({ cape: 1500, bs6: 45, srh1: null, srh3: null, lcl: 800 }).limited, true, "severe: ...and flagged limited");
eq(S.assess({ cape: 1500, bs6: 45, srh1: 120, srh3: 200, lcl: 800, scp: 6, stp: 1.2 }), { tier: "action", limited: false, missing: [] }, "severe: complete inputs");
eq(S.assess({ cape: null }).tier, "nodata", "severe: no CAPE is no data");
eq(S.flags({ cape: 2000, lr75: null, bs6: 50 }), [], "severe: hail flag needs a lapse rate");
eq(C.thunder.assess(null, 800, null), { tier: "normal", limited: true, missing: ["thunder codes", "precip chance"] }, "thunder: CAPE-only hour can only show LOW, and is flagged limited");
eq(C.thunder.assess(0.6, 900, 50), { tier: "action", limited: false, missing: [] }, "thunder: majority thunder codes");

/* ---------- winter: only complete members decide odds ---------- */
// 72 h window; the snow is entirely in hours 30-36. Member B is missing exactly those 7 hours.
const snowy = Array.from({ length: 72 }, (_, i) => (i >= 30 && i < 37 ? 0.5 : 0));
const gapInSnow = snowy.map((x, i) => (i >= 30 && i < 37 ? null : x));
let st = C.winter.windowStats([{ w: 1, a: snowy }, { w: 1, a: gapInSnow }], 0, 72);
eq([st.used, st.partial], [1, 1], "winter: 65/72-hour member is partial, not used");
near(st.P[1], 1, 1e-9, "winter: odds come only from the complete member");
eq(st.lower[1], 0, "winter: partial member reports its lower bound (0, the snow is in the gap)");
eq(st.partialAtLeast[1], 0, "winter: that lower bound does not count toward 1\"+");
const lateGap = snowy.map((x, i) => (i >= 60 ? null : x));
st = C.winter.windowStats([{ w: 1, a: lateGap }], 0, 72);
eq([st.used, st.partialAtLeast[2], st.P[1]], [0, 1, null], "winter: a partial member already past 2\" is a lower bound, and no complete member means no odds");
eq(C.winter.tier(st), "nodata", "winter: no complete members is no data");
eq(C.stats.cumulativeStrict([0.1, 0.2, null, 0.3]), [0.1, 0.30000000000000004, null, null], "plume stops at first gap");

/* ---------- blend: a model counts for a day only with every hour of it ---------- */
const times = Array.from({ length: 48 }, (_, i) => `2026-11-0${3 + Math.floor(i / 24)}T${String(i % 24).padStart(2, "0")}:00`);
const full = (v) => times.map(() => v);
const data = { times, dtimes: [], models: {
  a: { h: { temperature_2m: full(50), precipitation: full(0.1) }, d: {} },
  hrrr: { h: { temperature_2m: times.map((_, i) => (i < 30 ? 60 : null)), precipitation: times.map((_, i) => (i < 30 ? 0.1 : null)) }, d: {} },
} };
const rows = C.blend.dailyRows(data, { a: 1, hrrr: 1 });
near(rows[0].hi, 55, 1e-9, "blend: both models on the complete day");
near(rows[1].hi, 50, 1e-9, "blend: HRRR's partial second day is left out, not averaged in");
near(rows[1].qpf, 2.4, 1e-9, "blend: partial-day precip isn't understated by a short model");
eq([rows[0].contrib, rows[1].contrib], [["a", "hrrr"], ["a"]], "blend: contributors recorded per day");
eq(rows[0].win, "2026-11-03T00:00/2026-11-03T23:00", "blend: row records its valid window");

/* ---------- change tracking compares like with like ---------- */
const spec = [{ k: "qpf", label: "precip", min: 0.1 }, { k: "t", label: "signal", tier: true }];
const prev = { cfg: "a:1", rows: { d1: { label: "TUE", win: "T00/T23", contrib: ["a", "b"], qpf: 0.5, t: "normal" }, d0: { label: "MON", win: "M14/M23", contrib: ["a"], qpf: 0.4 } } };
let cur = { cfg: "a:1", rows: { d1: { label: "TUE", win: "T00/T23", contrib: ["a", "b"], qpf: 0.8, t: "prepare" }, d0: { label: "MON", win: "M18/M23", contrib: ["a"], qpf: 0.1 } } };
let d = C.changes.diff(prev, cur, spec);
eq(d.items.map((x) => `${x.label} ${x.field}`), ["TUE precip", "TUE signal"], "changes: same window compared");
eq(d.skipped, ["MON"], "changes: shrinking 'rest of today' window is skipped, not reported as a drop");
eq(d.cfgChanged, false, "changes: same settings");
cur = { cfg: "a:2", rows: { d1: { label: "TUE", win: "T00/T23", contrib: ["a"], qpf: 0.5, t: "normal" } } };
d = C.changes.diff(prev, cur, spec);
eq([d.cfgChanged, d.contribChanged[0].removed], [true, ["b"]], "changes: settings and contributor changes are reported");
eq(d.items, [], "changes: no false change when values match");

/* ---------- shared config ---------- */
eq(Object.keys(C.config.defaultWeights(C.config.blend)).includes("jma_seamless"), false, "config: off-by-default models excluded");
eq(C.config.fingerprint({ b: 1, a: 2 }), "a:2,b:1", "config: fingerprint is order-independent");

console.log(`ok - ${n} checks passed`);
