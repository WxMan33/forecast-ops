// Compares this site's Bourgouin energy sums and decision tree (winter.bourgouinLayers) with the
// original UPP Fortran on IDENTICAL layer inputs. Energies must agree to float precision
// (1e-3 J/kg + 1e-4 relative; the Fortran is single precision). Categories must agree, except where a
// UPP energy lies within that tolerance of a decision threshold (listed). Separately reports how much
// this site's points-to-layers representation (winter.bourgouin on the layer midpoints) differs: that
// is a representation choice, reported for information, not a pass/fail comparison with UPP.
const fs = require("fs"), path = require("path");
const C = require("../../assets/ops-core.js");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
const out = fs.readFileSync(path.join(__dirname, "fortran.out"), "utf8").trim().split("\n");
const res = [];
for (let i = 0; i < out.length; i++) {
  const l = out[i].trim();
  if (l.startsWith("C")) { const v = l.split(/\s+/).slice(1).map(Number); res.push({ k: v[0], cats: new Set(v.slice(1)) }); }
  else if (l.startsWith("E")) { const v = l.split(/\s+/).slice(1).map(Number); Object.assign(res[res.length - 1], { areape: v[0], areane: v[1], surfw: v[2], tlmhk: v[3] }); }
}
if (res.length !== cases.length) { console.error(`expected ${cases.length} results, got ${res.length}`); process.exit(1); }
const CODE = { snow: 1, sleet: 2, freezing: 4, rain: 8 };
const allowed = (m) => (m.type === "mix" ? { "rain/snow": [1, 8], "sleet/rain": [2, 8], "freezing rain/sleet": [2, 4, 8] }[m.detail] : [CODE[m.type]]);
const tol = (x) => 1e-3 + 1e-4 * Math.abs(x);
const rep = { typeDiffers: 0, maxPA: 0, maxNA: 0, maxSW: 0 };
let energyFail = [], catFail = [], explained = [], near = 0, maxD = { PA: 0, NA: 0, SW: 0 };
cases.forEach((c, i) => {
  const r = res[i], m = C.winter.bourgouinLayers(c.layers);
  const pm = C.winter.bourgouin(c.pts);
  if (pm.type) { if (pm.type !== m.type || pm.detail !== m.detail) rep.typeDiffers++; rep.maxPA = Math.max(rep.maxPA, Math.abs(pm.PA - r.areape)); rep.maxNA = Math.max(rep.maxNA, Math.abs(pm.NA - r.areane)); rep.maxSW = Math.max(rep.maxSW, Math.abs(pm.sfcWarm - r.surfw)); }
  const d = { PA: Math.abs(m.PA - r.areape), NA: Math.abs(m.NA - r.areane), SW: Math.abs(m.sfcWarm - r.surfw) };
  Object.keys(d).forEach((k) => (maxD[k] = Math.max(maxD[k], d[k])));
  if (d.PA > tol(r.areape) || d.NA > tol(r.areane) || d.SW > tol(r.surfw)) energyFail.push(`${c.name}: PA ${m.PA.toFixed(2)} vs ${r.areape.toFixed(2)}, NA ${m.NA.toFixed(2)} vs ${r.areane.toFixed(2)}, surface ${m.sfcWarm.toFixed(2)} vs ${r.surfw.toFixed(2)}`);
  const th = [[r.areape, 2], [r.surfw, 5.6], [r.surfw, 13.2], [r.areane, 66 + 0.66 * r.areape], [r.areane, 46 + 0.66 * r.areape]];
  const isNear = th.some(([v, x]) => Math.abs(v - x) <= tol(v));
  if (isNear) near++;
  const al = allowed(m), cats = [...r.cats];
  const agree = cats.every((x) => al.includes(x)) && (m.type === "mix" || cats.length === 1);
  if (!agree) (isNear ? explained : catFail).push(`${c.name} [${c.group}]: site ${m.type}${m.detail ? ` (${m.detail})` : ""}, UPP {${cats.join(",")}} · PA ${r.areape.toFixed(2)} NA ${r.areane.toFixed(2)} surface ${r.surfw.toFixed(2)}`);
});
const by = (g) => cases.filter((c) => c.group === g).length;
const summary = { comparison: "winter.bourgouinLayers vs original UPP Fortran, identical layers", cases: cases.length, named: by("named"), sweep: by("sweep"), random: by("random"), nearThreshold: near, energyMismatches: energyFail.length, categoryDisagreements: catFail.length, explainedNearThreshold: explained.length, maxEnergyDiff: maxD };
console.log(JSON.stringify(summary, null, 1));
console.log(`Representation effect (information only): this site's points->25 m layers conversion on the same profiles changes the category in ${rep.typeDiffers}/${cases.length} cases; largest energy differences vs UPP: PA ${rep.maxPA.toFixed(2)}, NA ${rep.maxNA.toFixed(2)}, surface ${rep.maxSW.toFixed(2)} J/kg.`);
if (explained.length) console.log("Near-threshold differences (energies within tolerance of a threshold):\n  " + explained.join("\n  "));
if (energyFail.length) console.log("ENERGY MISMATCHES:\n  " + energyFail.slice(0, 40).join("\n  "));
if (catFail.length) console.log("UNEXPLAINED CATEGORY DISAGREEMENTS:\n  " + catFail.slice(0, 40).join("\n  "));
fs.mkdirSync(path.join(__dirname, "..", "out"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "..", "out", "upp-summary.json"), JSON.stringify({ summary, representation: rep, explained, energyFail, catFail }, null, 1));
process.exit(energyFail.length || catFail.length ? 1 : 0);
