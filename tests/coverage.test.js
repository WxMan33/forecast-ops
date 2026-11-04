/* Source contributions by forecast day: synthetic edge cases plus a real captured GFS response.
   The coverage panel must explain the displayed blend (same numbers as dailyRows), and must never
   attribute a forecast change to a dropout. */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const C = require("../assets/ops-core.js");
let n = 0; const ok = (c, m) => { assert(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, near = (a, b, t, m) => { assert(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`); n++; };

/* ---------- synthetic: three days, a horizon cut-off, a partial ensemble member, an unavailable source ---------- */
const T = Array.from({ length: 72 }, (_, i) => new Date(Date.UTC(2026, 10, 3, i)).toISOString().slice(0, 16));
const ms = T.map((t) => Date.parse(t + "Z"));
const day = (i) => Math.floor(i / 24);
const A = { h: { temperature_2m: T.map((_, i) => 40 + (i % 24 === 15 ? 10 : 0) + day(i)), precipitation: T.map((_, i) => (i % 24 === 6 ? 0.1 : 0)) }, d: {} };
const Bm = { h: { temperature_2m: T.map((_, i) => (i < 36 ? 50 + (i % 24 === 15 ? 6 : 0) : null)), precipitation: T.map((_, i) => (i < 36 ? 0.02 : null)) }, d: {} }; // ends 12:00 on day 2
const mem = (f) => ({ h: { temperature_2m: T.map(f), precipitation: T.map(() => 0) } });
const E = { kind: "ens", n: 3, members: [mem(() => 30), mem(() => 32), mem((_, i) => (i === 5 ? null : 34))] };
E.h = { temperature_2m: T.map((_, i) => 32), precipitation: T.map(() => 0) };
const data = { times: T, ms, dtimes: [], models: { a: A, b: Bm, e: E } };
const req = { a: 1, b: 1, e: 2, c: 1 }, ws = { a: 1, b: 1, e: 2 }; // "c" requested but unavailable
const cov = C.blend.coverage(data, req, ws), rows = C.blend.dailyRows(data, ws);
eq(cov.days.map((d) => d.k), rows.map((r) => r.k), "same day groups as the displayed table");
cov.days.forEach((d, i) => ["lo", "hi", "qpf"].forEach((k) => {
  const v = d.vars[k], r = rows[i];
  eq(v.value, r[k], `${d.k} ${k}: the panel shows the displayed blend value`);
  eq(v.contributors.map((c) => [c.id, c.share]).sort(), r.parts[k].map((p) => [p.id, p.share]).sort(), `${d.k} ${k}: contributors and shares come from the displayed calculation`);
  if (v.contributors.length) near(v.totalShare, 1, 1e-9, `${d.k} ${k}: shares sum to 100%`);
}));
const d1 = cov.days[0], d2 = cov.days[1], d3 = cov.days[2];
eq(d1.vars.hi.contributors.find((c) => c.id === "e").members, { usable: 2, total: 3 }, "ensemble: usable members counted per day (a member missing one hour drops out)");
eq(d2.vars.hi.contributors.find((c) => c.id === "e").members, { usable: 3, total: 3 }, "ensemble: all members usable on a complete day");
eq(d1.vars.hi.missing.map((m) => [m.id, m.reason]), [["c", "unavailable"]], "a requested source with no data this run is listed as unavailable");
eq(d2.vars.hi.missing.find((m) => m.id === "b"), { id: "b", reason: "partial", detail: "12 of 24 hours", hours: 12, of: 24 }, "partial day: hours counted, source excluded (no partial extremes)");
eq(d3.vars.hi.missing.find((m) => m.id === "b").reason, "beyond-horizon", "after the horizon: beyond-horizon");
eq(cov.horizons.b.temperature, ms[35], "forecast horizon = last valid hour");
/* leave-one-out effect: exactly the blend minus the same blend without that source */
const woA = C.blend.aggregate(data, { b: 1, e: 2 }, Array.from({ length: 24 }, (_, i) => i), Array.from({ length: 24 }, (_, i) => i));
near(d1.vars.hi.contributors.find((c) => c.id === "a").effect, rows[0].hi - woA.hi, 1e-9, "effect = with minus without, all else fixed");
near(d1.vars.hi.contributors.find((c) => c.id === "a").withoutValue, woA.hi, 1e-9, "the without-source value is reported");
/* composition change and the no-attribution rule */
eq(d2.changes.hi.left, ["b"], "day 2 high: B left (partial day)");
ok(d2.changes.hi.changed && d2.changes.hi.shifts.length > 0, "remaining shares shift when a source leaves");
eq(d1.changes.hi, null, "no comparison for the first day");
ok(d2.vars.hi.missing.every((m) => !("effect" in m)), "a source that dropped out is never given a forecast effect for a day it has no data for");
/* preset rules change temperature shares but not precipitation */
const covR = C.blend.coverage(data, req, ws, { rules: { byVar: { temperature_2m: { e: 2 } } } });
near(covR.days[0].vars.hi.contributors.find((c) => c.id === "e").share, 4 / 6, 1e-9, "rules: ensemble doubled for temperature (4 of 6 weight)");
eq(covR.days[0].vars.qpf.contributors.find((c) => c.id === "e").share, 2 / 4, "rules: precipitation share unchanged (2 of 4)");
/* a single remaining source: effect cannot be computed (nothing to compare with) */
const solo = C.blend.coverage({ times: T, ms, dtimes: [], models: { a: A } }, { a: 1 }, { a: 1 });
eq([solo.days[0].vars.hi.contributors[0].effect, solo.days[0].vars.hi.contributors[0].onlySource], [null, true], "only source: no leave-one-out effect is invented");
/* NWS precipitation intervals that do not cover a day are reported as such */
const nwsMd = { kind: "nws", h: { temperature_2m: T.map(() => 45) }, iv: { precipitation: [{ s: ms[0] - 3600e3, e: ms[11], v: 0.1 }] } };
const covN = C.blend.coverage({ times: T, ms, dtimes: [], models: { a: A, nws: nwsMd } }, { a: 1, nws: 1 }, { a: 1, nws: 1 });
ok(covN.days[2].vars.qpf.missing.some((m) => m.id === "nws" && /intervals do not cover/.test(m.detail)), "NWS precipitation gaps are explained in NWS terms");

/* ---------- real data: a captured GFS response at CVG, plus the same model truncated mid-forecast ---------- */
const om = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "om-cincinnati-gfs-blend.json"), "utf8"));
const rm = om.hourly.time.map((t) => Date.parse(t + "Z") - om.utc_offset_seconds * 1000);
const cut = 40, trunc = Object.fromEntries(Object.entries(om.hourly).map(([k, a]) => [k, k === "time" ? a : a.map((x, i) => (i < cut ? x : null))]));
const real = { times: om.hourly.time, ms: rm, dtimes: om.daily.time, models: { gfs_seamless: { h: om.hourly, d: om.daily }, gfs_cut: { h: trunc, d: {} } } };
const rws = { gfs_seamless: 1, gfs_cut: 1 }, rc = C.blend.coverage(real, rws, rws), rr = C.blend.dailyRows(real, rws);
eq(rc.days.map((d) => [d.vars.hi.value, d.vars.lo.value, d.vars.qpf.value]), rr.map((r) => [r.hi, r.lo, r.qpf]), "real GFS: panel values equal the displayed daily values");
eq(rc.horizons.gfs_cut.temperature, rm[cut - 1], "real GFS: truncated horizon detected at the last valid hour");
const dCut = rc.days.find((d) => d.vars.hi.missing.some((m) => m.id === "gfs_cut"));
ok(dCut && ["partial", "beyond-horizon"].includes(dCut.vars.hi.missing.find((m) => m.id === "gfs_cut").reason), "real GFS: the day the truncated copy stops is flagged");
const before = rc.days[0].vars.hi.contributors;
eq(before.map((c) => [c.id, c.share]).sort(), [["gfs_cut", 0.5], ["gfs_seamless", 0.5]], "real GFS: equal shares while both cover the day");
/* the full model uses the provider's own daily high where it matches the day; the copy uses its hourly
   maximum. The effect must equal an independent with/without calculation of the displayed rows. */
near(before.find((c) => c.id === "gfs_cut").effect, rr[0].hi - C.blend.dailyRows(real, { gfs_seamless: 1 })[0].hi, 1e-9, "real GFS: effect equals displayed blend minus the displayed blend without that source");
console.log(`ok - ${n} source-coverage checks passed`);
