/* In-Flight Icing (IFI) decoding against ECMWF ecCodes on the official fixture records (tests/fixtures/threats/ifi, cycle
   2026-11-23 01Z), field identity checks, the severity ground mask and the colours.  Run: node tests/threats-ifi.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), G = require("../assets/threats-gtg.js"), I = require("../assets/threats-ifi.js");
const X = path.join(__dirname, "fixtures/threats/ifi"), man = JSON.parse(fs.readFileSync(path.join(X, "manifest.json"), "utf8")), ref = JSON.parse(fs.readFileSync(path.join(X, "ifi-fixture.eccodes.json"), "utf8"));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const dec = {}; for (const [k, f] of Object.entries(man.records)) dec[k] = G.decode(fs.readFileSync(path.join(X, f)));
ok("the fixture: four records of cycle 01Z Nov 23, each the field, height and hour its name says (checked by I.check)", () => {
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
console.log(n + " passed");
