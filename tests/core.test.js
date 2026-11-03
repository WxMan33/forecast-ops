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
cur = { cfg: "a:2", rows: { d1: { label: "TUE", win: "T00/T23", contrib: ["a", "b"], qpf: 0.9, t: "action" } } };
d = C.changes.diff(prev, cur, spec);
eq([d.items.length, d.affected.map((x) => x.field)], [0, ["precip", "signal"]], "changes: with changed settings, differences are 'affected', never forecast changes");
cur = { cfg: "a:1", rows: { d1: { label: "TUE", win: "T00/T23", contrib: ["a"], qpf: 0.9, t: "normal" } } };
d = C.changes.diff(prev, cur, spec);
eq([d.items.length, d.affected.length], [0, 1], "changes: a dropped contributor also marks that row affected");

/* ---------- shared config ---------- */
eq(Object.keys(C.config.defaultWeights(C.config.blend)).includes("jma_seamless"), false, "config: off-by-default models excluded");
eq(C.config.fingerprint({ b: 1, a: 2 }), "a:2,b:1", "config: fingerprint is order-independent");

/* ---------- units: heights in feet are converted to meters ---------- */
const D = require("../assets/ops-data.js");
eq(D.toMeters("geopotential_height_700hPa", [9796.588, null], "ft").map((x) => (x == null ? null : Math.round(x))), [2986, null], "data: geopotential height ft -> m");
eq(D.toMeters("geopotential_height_700hPa", [2986], "m"), [2986], "data: meters untouched");
eq(D.toMeters("temperature_700hPa", [7], "ft"), [7], "data: only length fields are converted");

/* ---------- time zones: Open-Meteo's fixed-offset labels -> real instants ---------- */
const T = C.time, NY = "America/New_York";
const om = ["2026-10-31T23:00", "2026-11-01T00:00", "2026-11-01T01:00", "2026-11-01T02:00"]; // labelled at a fixed -05:00
const inst = T.instants(om, NY, -18000);
eq(inst.ms.map((m) => new Date(m).toISOString().slice(11, 16)), ["04:00", "05:00", "06:00", "07:00"], "time: instants = label - fixed offset");
eq([inst.consistent, T.toLocal(inst.ms[0], NY)], [false, "2026-11-01T00:00"], "time: before the change the labels are an hour off true local time, and that is flagged");
eq(T.toUtc("2026-11-01T01:30", NY), Date.UTC(2026, 10, 1, 5, 30), "time: repeated fall-back time resolves to its first occurrence");
eq(T.toLocal(T.toUtc("2027-03-14T02:30", NY), NY), "2027-03-14T03:30", "time: skipped spring-forward time moves to the first real time");

/* ---------- events ---------- */
const EV = C.event;
const ev = { id: "ev_x", name: "Night match", loc: { name: "TQL", lat: 39.1, lon: -84.5 }, tz: NY,
  times: { setup: "2026-10-31T21:00", gates: "2026-10-31T23:00", start: "2026-11-01T00:30", end: "2026-11-01T02:30", teardown: "2026-11-01T04:00" } };
eq(EV.validate(ev), [], "event: valid record");
const W2 = EV.windows(ev);
eq(W2.map((w) => w.key), ["setup", "gates", "event", "teardown", "all"], "event: phases in order plus whole event");
eq(W2.find((w) => w.key === "event").hours, 3, "event: 00:30-02:30 across the fall-back hour is 3 real hours");
eq(W2.find((w) => w.key === "gates").startLocal, "2026-10-31T23:00", "event: windows keep true local times");
eq(EV.validate({ ...ev, times: { ...ev.times, end: "2026-11-01T00:00" } }).length > 0, true, "event: end before start is rejected");
eq(EV.validate({ ...ev, times: { start: "2026-11-01T00:30", end: "2026-11-01T02:30" } }), [], "event: setup, gates and teardown are optional");
eq(EV.windows({ ...ev, times: { start: "2026-11-01T00:30", end: "2026-11-01T02:30" } }).map((w) => w.key), ["event", "all"], "event: optional phases are omitted");
// an hourly axis in fixed-offset labels covering the night
const axis = Array.from({ length: 12 }, (_, i) => { const m = Date.UTC(2026, 10, 1, 0) + i * 3600e3 - 0; const d2 = new Date(m); return `2026-${String(d2.getUTCMonth() + 1).padStart(2, "0")}-${String(d2.getUTCDate()).padStart(2, "0")}T${String(d2.getUTCHours()).padStart(2, "0")}:00`; }); // labels at -05:00: 2026-11-01T00..11 -> 05Z..16Z
const ax = T.instants(axis, NY, -18000);
const gw = W2.find((w) => w.key === "event"); // 04:30Z-07:30Z
const L = EV.locate(gw, ax);
eq(L.idx.map((i) => axis[i]), ["2026-11-01T00:00", "2026-11-01T01:00", "2026-11-01T02:00"], "event: instantaneous hours inside the window (05Z,06Z,07Z)");
eq(L.acc.map((i) => axis[i]), ["2026-11-01T00:00", "2026-11-01T01:00", "2026-11-01T02:00", "2026-11-01T03:00"], "event: accumulation hours covering the window's edges");
eq(EV.coverage(gw, ax, Date.UTC(2026, 10, 1, 0)).status, "full", "event: covered window");
eq(EV.coverage(W2.find((w) => w.key === "setup"), ax, Date.UTC(2026, 10, 1, 0)).status, "partial", "event: setup starts before the data does");
eq(EV.coverage(gw, ax, Date.UTC(2026, 10, 2, 0)).status, "past", "event: finished window");

/* ---------- time: classify, folds, provider-mode detection ---------- */
eq(T.classify("2026-11-01T01:30", NY).kind, "ambiguous", "time: fall-back 1:30 is ambiguous");
eq(T.classify("2027-03-14T02:30", NY).kind, "nonexistent", "time: spring-forward 2:30 doesn't exist");
eq(T.toUtc("2026-11-01T01:30", NY, 1) - T.toUtc("2026-11-01T01:30", NY, 0), 3600e3, "time: fold 1 is the second 1:30");
const localLabels = ["2026-11-01T00:00", "2026-11-01T01:00", "2026-11-01T01:00", "2026-11-01T02:00"]; // a provider using true local time
const lm = T.instants(localLabels, NY, -18000);
eq([lm.mode, lm.consistent, lm.ms.map((m, i) => (i ? (m - lm.ms[i - 1]) / 3600e3 : 0))], ["local", true, [0, 1, 1, 1]], "time: true-local labels with a repeated hour are detected and stay consecutive");
eq(T.instants(om, NY, -18000).mode, "fixed", "time: evenly stepped labels with an offset are fixed-offset");
eq(EV.validate({ ...ev, times: { start: "2026-11-01T01:30", end: "2026-11-01T03:00" } }).some((x) => /twice/.test(x)), true, "event: ambiguous time needs a choice");
eq(EV.validate({ ...ev, fold: { start: 1 }, times: { start: "2026-11-01T01:30", end: "2026-11-01T03:00" } }), [], "event: ambiguous time with an explicit choice is valid");
eq([1, 0].map((f) => EV.windows({ ...ev, fold: { start: f }, times: { start: "2026-11-01T01:30", end: "2026-11-01T03:00" } }).find((w) => w.key === "event").hours), [1.5, 2.5], "event: from the second 1:30 (EST) is 1.5 h; from the first (EDT) is 2.5 h");
eq(EV.validate({ ...ev, times: { start: "2027-03-14T02:15", end: "2027-03-14T05:00" } }).some((x) => /doesn't exist/.test(x)), true, "event: nonexistent time rejected");

/* ---------- NWS parsing (synthetic) ---------- */
const N = C.nws;
eq([N.durationMs("PT6H"), N.durationMs("P1DT4H"), N.durationMs("PT30M")], [6 * 3600e3, 28 * 3600e3, 30 * 60e3], "nws: ISO durations");
near(N.convert("wmoUnit:degC", 0), 32, 1e-9, "nws: degC -> F");
near(N.convert("wmoUnit:km_h-1", 100), 62.1371, 1e-6, "nws: km/h -> mph");
near(N.convert("wmoUnit:mm", 25.4), 1, 1e-9, "nws: mm -> in");
eq(N.convert("wmoUnit:degC", null), null, "nws: null stays null, never 0");
const H0 = Date.UTC(2026, 10, 3, 0);
const qpf = { uom: "wmoUnit:mm", values: [0, 1, 2].map((k) => ({ validTime: new Date(H0 + k * 6 * 3600e3).toISOString().replace(".000Z", "+00:00") + "/PT6H", value: 25.4 * (k + 1) })) };
const ivs = N.intervals(qpf);
let tot = N.totalOver(ivs, H0, H0 + 12 * 3600e3);
eq([tot.exact, tot.lower, tot.upper], [true, 3, 3], "nws: window aligned to intervals sums exactly");
tot = N.totalOver(ivs, H0 + 3 * 3600e3, H0 + 9 * 3600e3);
eq([tot.exact, tot.lower, tot.upper], [false, 0, 3], "nws: window straddling intervals gives a range, no allocation");
eq(N.totalOver(ivs, H0 + 12 * 3600e3, H0 + 24 * 3600e3).covers, false, "nws: window past the data is not covered (not zero)");
const temp = { uom: "wmoUnit:degC", values: [{ validTime: new Date(H0).toISOString().replace(".000Z", "+00:00") + "/PT3H", value: 10 }] };
eq(N.stateAt(temp, [H0, H0 + 2 * 3600e3, H0 + 3 * 3600e3]), [50, 50, null], "nws: state field holds through its interval only");
eq([N.ptype([{ weather: "snow" }]), N.ptype([{ weather: "sleet" }, { weather: "freezing_rain" }]), N.ptype([{ weather: "rain" }, { weather: "snow" }]), N.ptype([])], ["snow", "freezing", "mix", null], "nws: weather wording -> type");

/* ---------- winter diagnostics (synthetic profiles) ---------- */
const Wn = C.winter;
/* Offline cross-check against a separately written JavaScript port of UPP CALWXT_BOURG
   (tests/reference/upp-bourgouin.js, including its own points-to-layers conversion). This is not the
   original Fortran; that comparison runs in CI (tests/upp/). */
const UPP = require("./reference/upp-bourgouin.js");
const pStd = (z) => 1013.25 * Math.pow(1 - z / 44330.8, 5.255);
const mk = (Tf, top = 5600, dz = 50) => { const pts = []; for (let z = 0; z <= top; z += dz) pts.push({ z: z || 2, p: z >= top ? 500 : pStd(z), t: Tf(z) }); return pts; };
/* piecewise-linear soundings: [[height m, °C], ...], continued at 6.5 °C/km above the last point */
const pw = (P) => (z) => { if (z >= P[P.length - 1][0]) return P[P.length - 1][1] - 6.5 * (z - P[P.length - 1][0]) / 1000; for (let k = 1; k < P.length; k++) if (z <= P[k][0]) { const [z0, t0] = P[k - 1], [z1, t1] = P[k]; return t0 + ((t1 - t0) * (z - z0)) / (z1 - z0); } return P[0][1]; };
const lapse = (sfc) => (z) => sfc - 6.5 * z / 1000;
const CASES = {
  "all cold": [lapse(-4), "snow"],
  "classic warm nose over a shallow cold layer": [pw([[0, -2], [400, -3], [1200, 4], [2000, 0], [2400, -3]]), "freezing"],
  "weak warm nose over a deep cold layer": [pw([[0, -10], [1200, -6], [1700, 1.2], [2100, -1], [2500, -4]]), "sleet"],
  "two warm layers aloft (both counted)": [pw([[0, -3], [500, -2], [800, 2], [1100, -1], [1500, 2.5], [2000, -1], [2400, -4]]), null],
  "shallow surface warm layer": [pw([[0, 1], [150, 0], [400, -2], [1000, -5]]), "snow"],
  "deep surface warm layer": [lapse(6), "rain"],
  "surface warm + warm nose aloft": [pw([[0, 1.5], [250, -1], [700, -2], [1300, 3], [2000, 0], [2400, -3]]), null],
};
Object.entries(CASES).forEach(([name, [Tf, want]]) => {
  const pts = mk(Tf), mine = Wn.bourgouin(pts), ref = UPP.classify(pts);
  if (want) eq(mine.type, want, `bourgouin: ${name} -> ${want}`);
  eq(mine.type, ref.type, `bourgouin matches UPP reference: ${name} (${ref.type})`);
  near(mine.PA, ref.areape, Math.max(0.5, 0.03 * ref.areape), `bourgouin PA matches UPP: ${name}`);
  near(mine.NA, ref.areane, Math.max(0.5, 0.03 * ref.areane), `bourgouin NA matches UPP: ${name}`);
  near(mine.sfcWarm, ref.surfw, Math.max(0.5, 0.03 * ref.surfw), `bourgouin surface warm matches UPP: ${name}`);
});
/* randomized: 300 profiles with 0-2 warm noses; types must agree away from threshold edges */
let seed2 = 11; const rnd2 = () => ((seed2 = (seed2 * 16807) % 2147483647) / 2147483647);
let agree = 0, compared = 0;
for (let k = 0; k < 300; k++) {
  const sfc = -10 + rnd2() * 16, noses = Math.floor(rnd2() * 3), spec = [];
  for (let m = 0; m < noses; m++) { const z0 = 200 + rnd2() * 2500; spec.push([z0, z0 + 300 + rnd2() * 1200, -2 + rnd2() * 8]); }
  const Tf = (z) => spec.reduce((t, [a, b, pk]) => (z > a && z < b ? Math.max(t, pk - (Math.abs(z - (a + b) / 2) / ((b - a) / 2)) * (pk - t)) : t), lapse(sfc)(z));
  const pts = mk(Tf), mine = Wn.bourgouin(pts), ref = UPP.classify(pts);
  /* Edge zones. Known, explained difference: for a warm layer only tens of metres thick that barely
     exceeds 0 °C, UPP counts whole layers above freezing (≈2.5 J/kg here) while this code integrates only
     the above-freezing part (<2 J/kg), so they can fall either side of the 2 J/kg melting threshold. */
  const edge = Math.abs(ref.areape - 2) < 1.2 || [5.6, 13.2].some((x) => Math.abs(ref.surfw - x) < 0.15 * x) || [66 + 0.66 * ref.areape, 46 + 0.66 * ref.areape].some((x) => Math.abs(ref.areane - x) < 0.05 * x);
  if (edge) continue;
  compared++; if (mine.type === ref.type) agree++;
}
eq(agree, compared, `bourgouin: random profiles agree with UPP away from thresholds (${agree}/${compared})`);
/* representation sensitivity: same sparse levels, two layer representations */
const sens = [{ z: 2, p: 1000, t: -2 }, { z: 650, p: 925, t: -3 }, { z: 1400, p: 850, t: 0.6 }, { z: 2950, p: 700, t: -6 }, { z: 4150, p: 600, t: -14 }, { z: 5500, p: 500, t: -24 }];
const rs = Wn.bourgouin(sens);
eq([typeof rs.alt.PA, rs.repSensitive === (rs.alt.type !== rs.type || (rs.alt.detail || null) !== (rs.detail || null))], ["number", true], "representation: alternate step-layer diagnosis is always computed and compared");
const stepL = Wn.pointsToStepLayers(sens);
eq([stepL[0].zb, stepL[0].zt, stepL[stepL.length - 1].zt], [2, 326, 5500], "representation: step layers run between level midpoints, surface to top");
let sensCount = 0, tot2 = 0;
for (let a = -1; a <= 3; a += 0.1) { const p2 = sens.map((q, k) => (k === 2 ? { ...q, t: a } : q)); const r2 = Wn.bourgouin(p2); tot2++; if (r2.repSensitive) sensCount++; }
eq(sensCount > 0 && sensCount < tot2, true, `representation: a coarse warm nose sweep is sensitive in some cases (${sensCount}/${tot2}), not all`);
/* completeness: truncated, gappy or shallow profiles are unavailable, not guessed */
eq(Wn.bourgouin(mk(CASES["classic warm nose over a shallow cold layer"][0], 2500)).type, null, "bourgouin: data stopping at 2500 m fail the precip-type checks");
eq(Wn.bourgouin(mk(CASES["classic warm nose over a shallow cold layer"][0], 3400)).type, "freezing", "bourgouin: data through 3400 m (not 500 hPa) pass the precip-type checks");
eq(Wn.bourgouin(mk((z) => 3, 5600)).unavailable.some((x) => /above freezing/.test(x)), true, "bourgouin: warm at the top of the data fails the checks (layer may continue)");
const gappy = [{ z: 2, p: 1000, t: -2 }, { z: 2200, p: 780, t: 3 }, { z: 5600, p: 500, t: -25 }];
eq([Wn.coverage(gappy, "ptype").pass, Wn.coverage(gappy, "kuchera").pass], [false, false], "coverage: first level 2200 m up fails both policies");
eq(Wn.coverage(mk(lapse(-2), 5600, 1400)).coarse, true, "coverage: 1400 m spacing low down is flagged coarse");
const cross = [{ z: 2, p: 1000, t: -2 }, { z: 500, p: 950, t: -3 }, { z: 1500, p: 850, t: -5 }, { z: 2500, p: 750, t: -8 }, { z: 3500, p: 660, t: -12 }, { z: 5500, p: 500, t: -24 }];
const cv = Wn.coverage(cross, "ptype");
eq([cv.lowGap, cv.lowGapSpan, cv.coarse], [1000, [500, 1500], false], "coverage: reports the actual largest gap and where it is");
const cross2 = cross.map((q) => ({ ...q })); cross2.splice(3, 1); // 1500 -> 3500 m: crosses the 3 km layer top
eq([Wn.coverage(cross2, "ptype").lowGap, Wn.coverage(cross2, "ptype").coarse], [2000, true], "coverage: a gap crossing the top of the layer (1500->3500 m) is counted");
const noTop = cross.slice(0, 5);
eq([Wn.coverage(noTop, "ptype").pass, Wn.coverage(noTop, "kuchera").pass], [true, false], "coverage: precip type and Kuchera have separate requirements (500 hPa only needed for Kuchera)");
/* model-independent: the same rule applies to every model's level spacing */
const ecLike = [{ z: 2, p: 1000, t: -2 }, { z: 650, p: 925, t: -3 }, { z: 1400, p: 850, t: 2 }, { z: 2950, p: 700, t: -6 }, { z: 4150, p: 600, t: -14 }, { z: 5500, p: 500, t: -24 }];
const gfsLike = [{ z: 2, p: 1000, t: -2 }, { z: 200, p: 975, t: -2 }, { z: 420, p: 950, t: -3 }, { z: 650, p: 925, t: -3 }, { z: 880, p: 900, t: 0 }, { z: 1400, p: 850, t: 2 }, { z: 1900, p: 800, t: 0 }, { z: 2950, p: 700, t: -6 }, { z: 4150, p: 600, t: -14 }, { z: 5500, p: 500, t: -24 }];
eq([Math.round(Wn.coverage(ecLike).lowGap), Math.round(Wn.coverage(gfsLike).lowGap)], [1550, 1200], "coverage: actual gaps reported for ECMWF-like (850->700) and GFS-like (700->600 overlaps 3 km) levels");
near(Wn.kuchera(-5), 12 + (271.16 - 268.15), 1e-9, "kuchera: cold profile ratio");
near(Wn.kuchera(1), 12 + 2 * (271.16 - 274.15), 1e-9, "kuchera: warm profile ratio");
const prof = (sfc, levels) => [{ z: 2, p: 1000, t: sfc }, ...levels.map(([p, z, t]) => ({ p, z, t }))];
const st0 = Wn.structure(prof(-3, [[925, 700, -1], [850, 1400, 5], [800, 1900, 4], [700, 3000, -5]]));
eq([Math.round(st0.warmBase), Math.round(st0.warmTop), st0.maxAloftT], [817, 2389, 5], "winter: warm layer base/top (linear 0 °C crossings) and peak");
eq([Wn.codeType(66), Wn.codeType(73), Wn.codeType(61), Wn.codeType(3), Wn.codeType(null)], ["freezing", "snow", "rain", "none", null], "winter: WMO codes -> types");
const sr = Wn.series({ precipitation: [2, 2], snowfall: [1, 1], rain: [1, null], showers: [0, 0], temperature_2m: [0, 0] }, 2, 0);
eq([sr[0].split, sr[1].split], ["mix", null], "winter: missing rain stays unknown, never zero");
eq(Wn.series({ precipitation: [2], snowfall: [1], rain: [1], temperature_2m: [0] }, 1, 0)[0].split, null, "winter: model without a showers field gives no rain/snow split");
eq(Wn.transitions([null, "rain", "rain", "none", "freezing", "snow"], 0, 6).map((x) => `${x.from}>${x.to}@${x.i}`), ["rain>freezing@4", "freezing>snow@5"], "winter: transitions skip dry hours");
eq(Wn.scenarioTotals([{ swe: 0.1, snowIn: 0.7, kuchera: 15, t2F: 30 }, { swe: null, snowIn: null }], 0, 2), null, "winter: incomplete window gives no scenario totals");
const sc = Wn.scenarioTotals([{ swe: 0.1, snowIn: 0.7, kuchera: 15, t2F: 34 }, { swe: 0.2, snowIn: 1.4, kuchera: 12, t2F: 30 }], 0, 2);
eq([+sc.reported.toFixed(2), +sc.ten.toFixed(2), +sc.kuchera.toFixed(2), sc.warmHours], [2.1, 3, 3.9, 1], "winter: 7:1 as reported, 10:1 and Kuchera kept separate");

/* ---------- blend presets, weights and timing scenarios ---------- */
const BL = C.blend, spec2 = C.config.blend;
eq(Object.keys(BL.presetWeights("equal", spec2, {})).includes("ncep_nbm_conus"), false, "presets: raw consensus excludes NBM");
eq(BL.presetWeights("nbm", spec2, { a: 1 }), { ncep_nbm_conus: 1 }, "presets: NBM only");
eq(BL.presetWeights("custom", spec2, { a: 2 }), { a: 2 }, "presets: custom keeps the user's weights");
eq(BL.weightFor({ gfs_hrrr: 1 }, BL.HYPOTHESES[0].rules, "gfs_hrrr", "precipitation", 10), 1.5, "weights: lead-time rule applies");
eq(BL.weightFor({ gfs_hrrr: 1 }, null, "gfs_hrrr", "precipitation", 10), 1, "weights: no rules, base weight");
near(C.stats.blendSeries([{ w: (i) => (i ? 0 : 1), data: [1, 1] }, { w: 1, data: [3, 3] }], 2).mean[1], 3, 1e-9, "weights: per-index weight functions");
const pz = (on, off) => Array.from({ length: 24 }, (_, i) => (i >= on && i <= off ? 0.05 : 0));
const scenData = { times: Array(24).fill(""), ms: Array.from({ length: 24 }, (_, i) => i * 3600e3), models: { a: { h: { precipitation: pz(2, 5) } }, b: { h: { precipitation: pz(3, 6) } }, c: { h: { precipitation: pz(12, 15) } }, d: { h: { precipitation: pz(30, 31) } } } };
const ps2 = BL.precipScenarios(scenData, { a: 1, b: 1, c: 1, d: 1 }, 0, 24);
eq(ps2.scenarios.map((x) => x.ids.join("+")), ["a+b", "c"], "scenarios: early and late timings stay separate");
eq(ps2.dry, ["d"], "scenarios: models with no precip in the window are listed as dry");
eq(C.verify.record({ kind: "daily", source: "nws", values: { hi: 60 } }).schema, 1, "verify: record schema");

console.log(`ok - ${n} checks passed`);
