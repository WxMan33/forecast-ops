// Run with: node tests/core.test.js   (no dependencies)
const C = require("../assets/ops-core.js");
const assert = require("assert");
let n = 0;
const near = (a, b, tol, msg) => { assert.ok(a != null && Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const S = C.severe, MS = C.MS;

// Straight-line hodograph: 40 kt of shear over 0-6 km, all in +u.
const straight = [{ h: 0, u: 0, v: 0 }];
for (let h = 1000; h <= 9000; h += 1000) straight.push({ h, u: (Math.min(h, 6000) / 6000) * 40, v: 0 });
const bk = S.bunkers(straight);
near(S.bulk(straight, 6000), 40, 1e-9, "0-6 km bulk shear");
near(bk.rm.u, 20, 1e-6, "Bunkers RM u (mean wind)");
near(bk.rm.v, -7.5 / MS, 1e-6, "Bunkers RM deviates 7.5 m/s right of shear");
near(S.srh(straight, 3000, bk.rm), 20 * (7.5 / MS) * MS * MS, 1, "SRH, straight hodograph offset from storm");

// Quarter circle of radius 20 kt turning clockwise, storm at origin: SRH = 2 x swept area.
const circ = [];
for (let h = 0; h <= 3000; h += 100) { const a = (h / 3000) * (Math.PI / 2); circ.push({ h, u: -20 * Math.cos(a), v: 20 * Math.sin(a) }); }
near(S.srh(circ, 3000, { u: 0, v: 0 }), 2 * ((Math.PI * 400) / 4) * MS * MS, 2, "SRH, veering quarter circle");

near(S.stp(1500, 500, 150, 20 / MS), 1, 1e-9, "STP unity case");
near(S.scp(1000, 50, 20 / MS), 1, 1e-9, "SCP unity case");
near(S.fromDir({ u: 0, v: -10 }), 0, 1e-9, "wind from north");

// Missing data must never read as a quiet LOW.
eq(S.tier({ cape: 1500, bs6: null, srh3: null, stp: null, scp: null }), "limited", "severe: CAPE without winds is limited");
eq(S.tier({ cape: 50, bs6: null }), "normal", "severe: no instability is low even without winds");
eq(S.tier({ cape: null }), "nodata", "severe: no CAPE is no data");
eq(S.tier({ cape: 1500, bs6: 45, srh3: 60, scp: 1.8, stp: 0.3 }), "prepare", "severe: SCP >= 1 is elevated");
eq(S.flags({ cape: 2000, lr75: null, bs6: 50 }), [], "severe: hail flag needs a lapse rate");
eq(C.thunder.tier(null, 800, null), "limited", "thunder: CAPE with no codes or PoP is limited");
eq(C.thunder.tier(0.6, 900, 50), "action", "thunder: majority thunder codes");

// Winter: incomplete coverage is excluded, not counted as zero.
const full = Array(24).fill(0.1), gappy = full.map((x, i) => (i < 12 ? null : x));
const ws = C.winter.windowStats([{ w: 1, a: full }, { w: 1, a: gappy }], 0, 24);
eq(ws.used, 1, "winter: member with 50% coverage is excluded");
near(ws.tot[0], 2.4, 1e-9, "winter: full member total");
eq(C.stats.cumulativeStrict([0.1, 0.2, null, 0.3]), [0.1, 0.30000000000000004, null, null], "plume stops at first gap");
eq(C.winter.tier({ 0.1: 0.9, 1: 0.5, 4: 0.1 }, 10), "prepare", "winter tier");
eq(C.winter.tier({}, 0), "nodata", "winter: no usable members");

// Blend agreement is about temperature only and reports the real range.
const ag = C.blend.agreement([60, 62, 66]);
eq([ag.word, ag.lo, ag.hi], ["FAIR", 60, 66], "agreement range");

console.log(`ok - ${n} checks passed`);
