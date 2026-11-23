/* GTG decoder against ECMWF ecCodes: one real NCEP record (EDPARM at 10,668 m, cycle 2026-11-22 22Z, analysis), decoded here
   and compared with ecCodes' values at 16 cells and its field statistics; the Lambert projection puts each cell's ecCodes
   latitude and longitude back on the same cell; categories use AWC's EDR thresholds.  Run: node tests/threats-gtg.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), G = require("../assets/threats-gtg.js");
const X = path.join(__dirname, "fixtures/threats"), ref = JSON.parse(fs.readFileSync(path.join(X, "gtg-edparm-10668m-2026112222-f000.eccodes.json"), "utf8"));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const d = G.decode(fs.readFileSync(path.join(X, "gtg-edparm-10668m-2026112222-f000.grib2")));
ok("the record: EDPARM (0/19/30) at 10,668 m above MSL, cycle 22Z Nov 22, analysis, 1799 x 1059 Lambert conformal, 3 km", () => {
  assert.deepStrictEqual([d.product.discipline, d.product.category, d.product.number, d.product.levelType, d.product.level, d.product.forecast], [0, 19, 30, 102, 10668, 0]);
  assert.strictEqual(d.refTime, "2026-11-22T22:00:00.000Z"); assert.strictEqual(d.validTime, d.refTime);
  assert.deepStrictEqual([d.grid.nx, d.grid.ny, d.grid.dx, d.grid.latin1, d.grid.latin2, d.grid.loV], [1799, 1059, 3000, 38.5, 38.5, 262.5]);
});
ok("values: the same points have values as in ecCodes, and the field statistics agree", () => {
  let cnt = 0, max = -1, sum = 0; for (const v of d.field) if (Number.isFinite(v)) { cnt++; sum += v; if (v > max) max = v; }
  assert.strictEqual(cnt, ref.points_with_values); assert(Math.abs(max - ref.max) < 1e-6); assert(Math.abs(sum - ref.sum) / ref.sum < 1e-7, sum + " vs " + ref.sum); // float32 storage
});
ok("16 cells: the decoded value equals ecCodes' (to float32 rounding), and masked cells stay empty", () => {
  for (const c of ref.cells) { const v = d.field[c.j * d.grid.nx + c.i]; if (c.value == null) assert(!Number.isFinite(v), JSON.stringify(c)); else assert(Math.abs(v - c.value) < 1e-6, JSON.stringify(c) + " got " + v); }
});
ok("projection: each cell's ecCodes latitude and longitude lands back on that cell, and the inverse returns them", () => {
  const P = G.projection(d.grid);
  for (const c of ref.cells) { const v = G.valueAt(d, c.lon, c.lat, P); assert.deepStrictEqual([v.i, v.j], [c.i, c.j], JSON.stringify(c)); const [lo, la] = P.inv(c.i, c.j); assert(Math.abs(lo - c.lon) < 1e-4 && Math.abs(la - c.lat) < 1e-4, JSON.stringify([lo, la, c])); }
  assert.strictEqual(G.valueAt(d, 0, 0, P).inside, false);
});
ok("heights: the 51 levels in the files, 30 m then every 1,000 ft as NCEP labels them (304, 609 ... 15,240 m)", () => {
  assert.strictEqual(G.HEIGHTS.length, 51); assert.deepStrictEqual(G.HEIGHTS.slice(0, 4).map((h) => h.m), [30, 304, 609, 914]); assert.strictEqual(G.HEIGHTS.find((h) => h.ft === 35000).m, 10668); assert.strictEqual(G.HEIGHTS[50].m, 15240);
  assert.strictEqual(G.levelLabel(35000), "FL350"); assert.strictEqual(G.levelLabel(10000), "10,000 ft");
});
ok("categories: AWC's EDR thresholds by aircraft class (x100: light 13/16/36/64, medium 15/20/44/79, heavy 17/24/54/96)", () => {
  assert.deepStrictEqual([0.1, 0.15, 0.2, 0.44, 0.79].map((v) => G.category(v, "medium")), [0, 1, 2, 3, 4]);
  assert.deepStrictEqual([0.14, 0.16, 0.36, 0.64].map((v) => G.category(v, "light")), [1, 2, 3, 4]);
  assert.deepStrictEqual([0.16, 0.17, 0.24, 0.54, 0.96].map((v) => G.category(v, "heavy")), [0, 1, 2, 3, 4]);
  assert.strictEqual(G.category(null, "medium"), null);
});
ok("render: a Web Mercator image over the grid, transparent below light, the max cell's colour where it lies", () => {
  const img = G.render(d, { width: 400, cls: "medium" }); assert.strictEqual(img.rgba.length, img.width * img.height * 4);
  const [[w, nN], [e], , [, s]] = img.coordinates; assert(w < -130 && e > -65 && s < 22 && nN > 52, JSON.stringify(img.coordinates));
  let colored = 0; for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i]) colored++; assert(colored > 0 && colored < img.width * img.height);
});
ok("bad input is refused, never drawn: not GRIB, truncated, or another edition", () => {
  const b = fs.readFileSync(path.join(X, "gtg-edparm-10668m-2026112222-f000.grib2"));
  assert.throws(() => G.decode(Buffer.from("nope")), /not a GRIB/); assert.throws(() => G.decode(b.subarray(0, 5000)), /truncated/);
  const c = Buffer.from(b); c[7] = 1; assert.throws(() => G.decode(c), /edition 2/);
});
/* ---------- Planner: modeled turbulence along a route (synthetic fields on the real GTG grid) ---------- */
{
  const cyc = Date.parse("2026-11-23T00:00:00Z"), now = Date.parse("2026-11-23T02:00:00Z"), CVG = [-84.67, 39.05], EWR = [-74.17, 40.69];
  const blank = () => ({ grid: d.grid, field: new Float32Array(d.field.length).fill(0.05), product: d.product });
  // a moderate patch (EDR 0.30) around 40.0N 79.0W: on the CVG-EWR line, about 280 miles from CVG
  const patch = (dec, lon, lat, km, v) => { const P = G.projection(dec.grid); const [ci, cj] = P.ij(lon, lat), r = km / 3; for (let j = Math.floor(cj - r); j <= cj + r; j++) for (let i = Math.floor(ci - r); i <= ci + r; i++) if ((i - ci) ** 2 + (j - cj) ** 2 <= r * r) dec.field[j * dec.grid.nx + i] = v; return dec; };
  const lowPatch = patch(blank(), -79.0, 40.05, 30, 0.30), calm = blank();
  const run = (route, fieldsFor, extra = {}) => { const plan = G.routePlan(route, cyc, now), fields = [], failed = [];
    for (const h of plan.hours) for (const l of plan.levels) { const dec = fieldsFor(l.ft, h.fh); if (dec === "fail") failed.push({ ft: l.ft, fh: h.fh, validMs: h.validMs, error: "HTTP 502" }); else fields.push({ ft: l.ft, fh: h.fh, validMs: h.validMs, dec }); }
    return G.routeTurbulence({ route, cls: "medium", fields, failed, cycleMs: cyc, now: extra.now || now, plan }); };
  // the model: the patch only at or below 12,000 ft, and only at 12Z and 13Z
  const model = (ft, fh) => (ft <= 12000 && fh >= 12 && fh <= 13 ? lowPatch : calm);
  const R = (o) => ({ oPt: CVG, dPt: EWR, lowFt: 6000, highFt: 12000, startMs: cyc + 12 * 3600e3, endMs: cyc + 13 * 3600e3, timed: true, ...o });
  ok("plan: up to 4 heights spread over the band (its lowest and highest always), model hours inside the time in the air, limited to the cycle's 18 hours", () => {
    const p = G.routePlan(R({ lowFt: 6000, highFt: 12000 }), cyc, now); assert.deepStrictEqual(p.levels.map((l) => l.ft), [6000, 8000, 10000, 12000]); assert.deepStrictEqual(p.hours.map((h) => h.fh), [12, 13]);
    assert.deepStrictEqual(G.routePlan(R({ lowFt: 24000, highFt: 36000 }), cyc, now).levels.map((l) => l.ft), [24000, 28000, 32000, 36000]);
    const long = G.routePlan(R({ startMs: cyc + 10 * 3600e3, endMs: cyc + 17 * 3600e3 }), cyc, now); assert(long.hours.length === 3 && long.hours[0].fh === 10 && long.hours[2].fh === 17);
    assert.deepStrictEqual(G.routePlan(R({ startMs: cyc + 17 * 3600e3, endMs: cyc + 20 * 3600e3 }), cyc, now).hours.map((h) => h.fh), [17, 18]);
  });
  ok("ALTITUDE changes the result: the patch is met in a 6,000-12,000 ft band, not in FL240-FL360", () => {
    const low = run(R({}), model), high = run(R({ lowFt: 24000, highFt: 36000 }), model);
    assert.strictEqual(low.findings.length, 1); assert.strictEqual(high.findings.length, 0); assert(high.complete && low.complete);
    const f = low.findings[0]; assert.strictEqual(G.CAT_WORD[f.cat], "moderate"); assert(f.fromMi > 230 && f.toMi < 330, JSON.stringify(f)); assert(Math.abs(f.peak.edr - 0.3) < 1e-6);
  });
  ok("TIMED: with its own time in the air, the finding gets an estimated time from steady progress along the line", () => {
    const f = run(R({}), model).findings[0], frac = (f.fromMi + f.toMi) / 2 / run(R({}), model).lengthMi, est = cyc + 12 * 3600e3 + frac * 3600e3;
    assert(f.encounter && Math.abs((f.encounter.fromMs + f.encounter.toMs) / 2 - est) < 5 * 60e3, JSON.stringify(f.encounter));
    const u = run(R({ timed: false }), model); assert.strictEqual(u.findings[0].encounter, null, "no time in the air of its own: no encounter time");
  });
  ok("FLIGHT WINDOW changes the result: flying 15-16Z misses the patch that exists at 12-13Z", () => {
    const later = run(R({ startMs: cyc + 15 * 3600e3, endMs: cyc + 16 * 3600e3 }), model); assert.strictEqual(later.findings.length, 0); assert(later.complete);
    // timed: the patch at 12Z only; a 12:00-14:00 flight reaches mile ~280 around 13:00, when the model has no patch -> nothing
    const m12 = (ft, fh) => (ft <= 12000 && fh === 12 ? lowPatch : calm);
    assert.strictEqual(run(R({ endMs: cyc + 14 * 3600e3 }), m12).findings.length, 0); assert.strictEqual(run(R({ endMs: cyc + 14 * 3600e3, timed: false }), m12).findings.length, 1, "untimed: any checked hour counts (potential overlap)");
  });
  ok("INCOMPLETE COVERAGE: a flight past the cycle's reach, a route leaving the grid, a record that fails, an old cycle: each said, never complete", () => {
    const beyond = run(R({ startMs: cyc + 17 * 3600e3, endMs: cyc + 20 * 3600e3 }), model); assert(!beyond.complete); assert(beyond.gaps.some((g) => g.kind === "noForecast"), JSON.stringify(beyond.gaps));
    const sju = run(R({ dPt: [-66.0, 18.44] }), model); assert(!sju.complete && sju.gaps.some((g) => g.kind === "outside"), "San Juan is outside the 3 km CONUS grid");
    const fail = run(R({}), (ft, fh) => (ft === 8000 ? "fail" : model(ft, fh))); assert(!fail.complete && fail.failed.length === 2);
    const old = run(R({}), model, { now: cyc + 6 * 3600e3 }); assert(old.stale && !old.complete);
    const untimedBeyond = run(R({ startMs: cyc + 17 * 3600e3, endMs: cyc + 20 * 3600e3, timed: false }), model); assert(untimedBeyond.windowBeyond && !untimedBeyond.complete);
  });
  ok("aircraft class: an EDR 0.18 patch is moderate for light aircraft and below light for heavy aircraft", () => {
    const weak = patch(blank(), -79.0, 40.05, 30, 0.18), w = (ft, fh) => (ft <= 12000 && fh <= 13 ? weak : calm), plan = G.routePlan(R({}), cyc, now);
    const go = (cls) => G.routeTurbulence({ route: R({}), cls, fields: plan.hours.flatMap((h) => plan.levels.map((l) => ({ ft: l.ft, fh: h.fh, validMs: h.validMs, dec: w(l.ft, h.fh) }))), failed: [], cycleMs: cyc, now, plan });
    assert.strictEqual(go("heavy").findings.length, 0); assert.strictEqual(go("light").findings.length, 1); assert.strictEqual(go("light").findings[0].cat, 2);
  });
}
console.log(n + " passed");
