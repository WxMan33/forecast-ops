// Writes identical layer inputs for the original UPP Fortran (cases.txt) and this site's code (cases.json).
// Layers are 50 m thick from the ground to 5600 m; each layer has one temperature (UPP's representation).
// The site's code receives the same layers as points at layer midpoints, plus the surface and top.
const fs = require("fs"), path = require("path");
const DZ = 50, TOP = 5600, G = 9.80665;
const pStd = (z) => 101325 * Math.pow(1 - z / 44330.8, 5.255);
const pw = (P) => (z) => { if (z >= P[P.length - 1][0]) return P[P.length - 1][1] - 6.5 * (z - P[P.length - 1][0]) / 1000; for (let k = 1; k < P.length; k++) if (z <= P[k][0]) { const [z0, t0] = P[k - 1], [z1, t1] = P[k]; return t0 + ((t1 - t0) * (z - z0)) / (z1 - z0); } return P[0][1]; };
const lapse = (s) => (z) => s - 6.5 * z / 1000;
const cases = [];
const add = (name, group, Tf) => cases.push({ name, group, Tf });
add("all cold", "named", lapse(-4));
add("classic warm nose, shallow cold layer", "named", pw([[0, -2], [400, -3], [1200, 4], [2000, 0], [2400, -3]]));
add("weak warm nose, deep cold layer", "named", pw([[0, -10], [1200, -6], [1700, 1.2], [2100, -1], [2500, -4]]));
add("two warm layers aloft", "named", pw([[0, -3], [500, -2], [800, 2], [1100, -1], [1500, 2.5], [2000, -1], [2400, -4]]));
add("shallow surface warm layer", "named", pw([[0, 1], [150, 0], [400, -2], [1000, -5]]));
add("deep surface warm layer", "named", lapse(6));
add("surface warm + warm nose aloft", "named", pw([[0, 1.5], [250, -1], [700, -2], [1300, 3], [2000, 0], [2400, -3]]));
// threshold sweeps: warm nose amplitude over three cold-layer depths, and surface warm layers
for (const [label, sfc, coldTop] of [["shallow cold", -2, 400], ["mid cold", -5, 900], ["deep cold", -9, 1400]])
  for (let a = -0.5; a <= 5.0001; a += 0.05) add(`nose ${a.toFixed(2)} over ${label}`, "sweep", pw([[0, sfc], [coldTop, sfc - 1], [coldTop + 700, a], [coldTop + 1500, -1], [coldTop + 1900, -4]]));
for (let s = 0; s <= 6.0001; s += 0.05) add(`surface ${s.toFixed(2)} C, 600 m warm layer`, "sweep", pw([[0, s], [600, 0], [900, -2], [2000, -9]]));
for (let s = 0; s <= 4.0001; s += 0.05) add(`surface ${s.toFixed(2)} C under warm nose`, "sweep", pw([[0, s], [300, -1], [800, -2], [1400, 2.5], [2100, -1], [2500, -4]]));
// random profiles with 0-2 warm noses
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let k = 0; k < 300; k++) {
  const sfc = -10 + rnd() * 16, noses = Math.floor(rnd() * 3), spec = [];
  for (let m = 0; m < noses; m++) { const z0 = 200 + rnd() * 2500; spec.push([z0, z0 + 300 + rnd() * 1200, -2 + rnd() * 8]); }
  add(`random ${k}`, "random", (z) => spec.reduce((t, [a, b, pk]) => (z > a && z < b ? Math.max(t, pk - (Math.abs(z - (a + b) / 2) / ((b - a) / 2)) * (pk - t)) : t), lapse(sfc)(z)));
}
const nl = TOP / DZ, lines = [String(cases.length)], json = [];
cases.forEach((c) => {
  const layers = []; // bottom -> top
  for (let k = 0; k < nl; k++) { const zb = k * DZ, zt = zb + DZ, zm = zb + DZ / 2; layers.push({ zb, zt, zm, t: c.Tf(zm) }); }
  lines.push(String(nl));
  for (let k = nl - 1; k >= 0; k--) lines.push(`${(layers[k].t + 273.15).toFixed(5)} ${pStd(layers[k].zm).toFixed(2)}`);
  for (let k = nl; k >= 0; k--) { const z = k * DZ; lines.push(`${pStd(z).toFixed(2)} ${z.toFixed(2)}`); }
  const pts = [{ z: 0, p: pStd(0) / 100, t: layers[0].t }, ...layers.map((L) => ({ z: L.zm, p: pStd(L.zm) / 100, t: L.t })), { z: TOP, p: 500, t: layers[nl - 1].t }];
  json.push({ name: c.name, group: c.group, pts, layers: layers.map((L) => ({ zb: L.zb, zt: L.zt, t: L.t, p: pStd(L.zm) / 100 })) });
});
fs.writeFileSync(path.join(__dirname, "cases.txt"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, "cases.json"), JSON.stringify(json));
console.log(`${cases.length} cases written (${nl} layers each)`);
