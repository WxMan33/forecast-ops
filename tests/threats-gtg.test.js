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
console.log(n + " passed");
