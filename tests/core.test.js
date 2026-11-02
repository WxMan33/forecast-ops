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

console.log(`ok - ${n} checks passed`);
