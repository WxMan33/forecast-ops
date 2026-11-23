/* In-Flight Icing (IFI) decoding against ECMWF ecCodes on the official fixture records (tests/fixtures/threats/ifi, cycle
   2026-11-23 01Z), field identity checks, the severity ground mask and the colours.  Run: node tests/threats-ifi.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), G = require("../assets/threats-gtg.js"), I = require("../assets/threats-ifi.js");
const X = path.join(__dirname, "fixtures/threats/ifi"), man = JSON.parse(fs.readFileSync(path.join(X, "manifest.json"), "utf8")), ref = JSON.parse(fs.readFileSync(path.join(X, "ifi-fixture.eccodes.json"), "utf8"));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const dec = {}; for (const [k, f] of Object.entries(man.records)) dec[k] = G.decode(fs.readFileSync(path.join(X, f)));
ok("the fixture: the saved records of cycle 01Z Nov 23, each the field, height and hour its name says (checked by I.check)", () => {
  for (const [k, d] of Object.entries(dec)) { const [fh, ft, field] = k.split("|"); assert(I.check(d, field, +ft, +fh)); assert.strictEqual(d.refTime, "2026-11-23T01:00:00.000Z"); assert.strictEqual(d.validTime, new Date(Date.parse(d.refTime) + fh * 3600e3).toISOString()); }
  assert.throws(() => I.check(dec["3|5000|sev"], "prob", 5000, 3), /expected GRIB2 0\/19\/233/); assert.throws(() => I.check(dec["3|5000|prob"], "prob", 15000, 3), /expected 4572 m/); assert.throws(() => I.check(dec["6|5000|prob"], "prob", 5000, 3), /expected \+3 h/);
});
ok("values against ecCodes: points with values, maximum, sum, and 16 cells per record (masked cells stay empty)", () => {
  for (const [k, r] of Object.entries(ref.records)) { const d = dec[k]; let cnt = 0, max = -Infinity, sum = 0; for (const v of d.field) if (Number.isFinite(v)) { cnt++; sum += v; if (v > max) max = v; }
    assert.strictEqual(cnt, r.points_with_values, k); assert(Math.abs(max - r.max) < 1e-6, k); assert(Math.abs(sum - r.sum) / Math.max(1, r.sum) < 1e-7, k + " " + sum + " " + r.sum);
    for (const c of r.cells) { const v = d.field[c.j * d.grid.nx + c.i]; if (c.value == null) assert(!Number.isFinite(v), k + JSON.stringify(c)); else assert(Math.abs(v - c.value) < 1e-6, k + JSON.stringify(c) + " " + v);
      const P = G.projection(d.grid), at = G.valueAt(d, c.lon, c.lat, P); assert.deepStrictEqual([at.i, at.j], [c.i, c.j]); } }
});
ok("heights: 60, every 500 ft from 500 ft (152.4 m) to 30,000 ft (9,144 m)", () => {
  assert.strictEqual(I.HEIGHTS.length, 60); assert.deepStrictEqual([I.HEIGHTS[0].m, I.HEIGHTS[9].m, I.HEIGHTS[59].m], [152.4, 1524, 9144]); assert.strictEqual(I.TOP_FT, 30000);
});
ok("severity: Table 4.228 words; below the ground (no probability value) is 'no value', never 'none'", () => {
  const s = dec["3|5000|sev"], p = dec["3|5000|prob"], P = G.projection(s.grid); let under = -1, sev3 = -1;
  for (let k = 0; k < s.field.length && (under < 0 || sev3 < 0); k++) { if (under < 0 && !Number.isFinite(p.field[k])) under = k; if (sev3 < 0 && s.field[k] === 3 && Number.isFinite(p.field[k])) sev3 = k; }
  assert.strictEqual(s.field[under], 0, "the severity record itself says 0 under the ground");
  const ll = (k) => P.inv(k % s.grid.nx, Math.floor(k / s.grid.nx));
  assert.strictEqual(I.valueAt(s, "sev", ...ll(under), p, P).text, "no value (below the ground)"); assert.strictEqual(I.valueAt(s, "sev", ...ll(sev3), p, P).text, "icing severity moderate (code 3)");
  assert.strictEqual(I.sevCode(255), null); assert(Number.isNaN(I.sevCode(7)));
});
ok("render: probability in four bins from 5%; severity trace and up, nothing under the ground; transparent elsewhere", () => {
  const a = I.render(dec["3|5000|prob"], "prob", { width: 300 }), b = I.render(dec["3|5000|sev"], "sev", { width: 300, mask: dec["3|5000|prob"] }), c = I.render(dec["3|5000|sev"], "sev", { width: 300 });
  const lit = (img) => { let x = 0; for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i]) x++; return x; };
  assert(lit(a) > 0 && lit(b) > 0 && lit(b) <= lit(c));
});
/* ---------- Planner: modeled icing along a route, on the saved official records (cycle 01Z Nov 23) ---------- */
{
  const cyc = Date.parse("2026-11-23T01:00:00Z"), now = Date.parse(man.clock), ATL = [-84.43, 33.64], STL = [-90.37, 38.75], DEN = [-104.67, 39.86], MSP = [-93.22, 44.88], Z = (h, m) => Date.parse("2026-11-23T00:00:00Z") + h * 3600e3 + m * 60e3;
  const run = (route) => { const plan = I.routePlan(route, cyc, now), fields = [], failed = [];
    for (const h of plan.hours) for (const l of plan.levels) { const p = dec[h.fh + "|" + l.ft + "|prob"], v = dec[h.fh + "|" + l.ft + "|sev"]; if (p && v) fields.push({ ft: l.ft, fh: h.fh, validMs: h.validMs, prob: p, sev: v }); else failed.push({ ft: l.ft, fh: h.fh, validMs: h.validMs, field: p ? "sev" : "prob", error: "not in the saved records" }); }
    return I.routeIcing({ route, fields, failed, cycleMs: cyc, now, plan }); };
  const R = (o) => ({ oPt: ATL, dPt: STL, lowFt: 15000, highFt: 15900, startMs: Z(3, 45), endMs: Z(4, 15), timed: true, ...o });
  ok("plan: whole-thousand IFI heights in the band (up to 4), model hours +1..+18 of the cycle; above 30,000 ft is out of range", () => {
    assert.deepStrictEqual(I.routePlan(R({}), cyc, now).levels.map((l) => l.ft), [15000]); assert.deepStrictEqual(I.routePlan(R({}), cyc, now).hours.map((h) => h.fh), [3]);
    assert.deepStrictEqual(I.routePlan(R({ lowFt: 6000, highFt: 14000 }), cyc, now).levels.map((l) => l.ft), [6000, 9000, 11000, 14000]);
    const top = I.routePlan(R({ lowFt: 28000, highFt: 34000 }), cyc, now); assert(top.aboveTop); assert.deepStrictEqual(top.levels.map((l) => l.ft), [28000, 29000, 30000]);
    assert.deepStrictEqual(I.routePlan(R({ startMs: Z(0, 30), endMs: Z(2, 30) }), cyc, Z(0, 0)).hours.map((h) => h.fh), [1, 2], "no +0 hour");
  });
  ok("ATLANTA-ST. LOUIS 15,000 ft, 03:45-04:15Z: probability (40% or more) and moderate-or-worse severity findings, each with the other field at the same cell, height and time", () => {
    const r = run(R({})); assert(r.complete); assert(r.probFindings.length >= 1 && r.sevFindings.length >= 1);
    const f = r.probFindings.reduce((a, b) => (b.peak.v > a.peak.v ? b : a)); assert(f.peak.v >= 0.4 && f.peak.ft === 15000 && f.encounter);
    const P = G.projection(dec["3|15000|prob"].grid), k = f.peak.j * dec["3|15000|prob"].grid.nx + f.peak.i; assert.strictEqual(dec["3|15000|prob"].field[k], f.peak.v); assert.strictEqual(dec["3|15000|sev"].field[k], f.peak.sevSame, "severity at the very same cell");
    const sv = r.sevFindings[0]; assert(sv.peak.v >= 3); assert.strictEqual(dec["3|15000|prob"].field[sv.peak.j * dec["3|15000|prob"].grid.nx + sv.peak.i], sv.peak.probSame);
  });
  ok("ALTITUDE changes it: the same flight at 5,000 ft has no finding of either kind", () => { const r = run(R({ lowFt: 5000, highFt: 5900 })); assert.strictEqual(r.probFindings.length + r.sevFindings.length, 0); assert(r.complete && r.maxProb < 0.4); });
  ok("FLIGHT TIME changes it: 06:45-07:15Z at 15,000 ft has no probability finding (and a different severity stretch)", () => {
    const a = run(R({})), b = run(R({ startMs: Z(6, 45), endMs: Z(7, 15) })); assert(a.probFindings.length > 0 && b.probFindings.length === 0); assert.notDeepStrictEqual(a.sevFindings.map((f) => [f.fromMi, f.toMi]), b.sevFindings.map((f) => [f.fromMi, f.toMi]));
  });
  ok("UNAVAILABLE RECORD: 10,000 ft is not saved: listed as failed, not complete, no finding claimed", () => { const r = run(R({ lowFt: 10000, highFt: 10900 })); assert(!r.complete); assert.deepStrictEqual(r.failed.map((x) => x.ft + " " + x.field).sort(), ["10000 prob"]); assert.strictEqual(r.checked, 0); });
  ok("BELOW THE GROUND: Denver-Minneapolis at 5,000 ft is under the Rockies' foothills at first: 'belowGround', never 'none'", () => {
    const r = run({ oPt: DEN, dPt: MSP, lowFt: 5000, highFt: 5900, startMs: Z(3, 45), endMs: Z(4, 15), timed: true }); assert(r.gaps.some((g) => g.kind === "belowGround" && g.runs[0].fromMi === 0), JSON.stringify(r.gaps)); assert(!r.complete);
  });
  ok("OUT OF RANGE: a band above 30,000 ft and a flight before the cycle's first hour are stated", () => {
    assert(run(R({ lowFt: 29000, highFt: 34000 })).aboveTop); const early = run(R({ startMs: Z(1, 0), endMs: Z(1, 30), timed: false })); assert(early.windowBefore && !early.complete);
  });
}
console.log(n + " passed");
