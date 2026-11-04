/* Model maps: placement, click-to-inspect and precipitation windows, checked against a REAL HRRR
   package (18Z Nov 4 2026, f00-f03, produced by forecast-ops-maps/pipeline/hrrr.py) whose manifest
   records eccodes' own nearest-gridpoint answers on the full CONUS message, plus synthetic edge cases. */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const MC = require("../assets/maps-core.js");
let n = 0; const ok = (c, m) => { assert(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const dir = path.join(__dirname, "fixtures", "maps", "2026110418"), man = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const g = man.grid, nh = man.hours.length;
const load = (f) => { const b = zlib.gunzipSync(fs.readFileSync(path.join(dir, man.fields[f].file))); return MC.field(man.fields[f], b.buffer.slice(b.byteOffset, b.byteOffset + b.length), nh, g.ny, g.nx); };
const F = { t2m: load("t2m"), refc: load("refc"), apcp_hour: load("apcp_hour"), apcp_run: load("apcp_run") };
const P = MC.projector(g);

/* placement: our projection picks the same cell eccodes finds on the full grid, at every checkpoint */
const cp = g.checkpoints; ok(cp && cp.points.length >= 8, "manifest carries GRIB nearest-gridpoint checkpoints");
cp.points.forEach((p) => {
  eq(P.nearest(p.lat, p.lon), p.cell, `${p.name}: viewer cell = eccodes nearest grid point`);
  const [la, lo] = P.fromCell(p.cell[0], p.cell[1]);
  ok(Math.abs(la - p.gribLat) < 2e-4 && Math.abs(lo - p.gribLon) < 2e-4, `${p.name}: cell centre lat/lon matches GRIB (${la.toFixed(5)},${lo.toFixed(5)} vs ${p.gribLat},${p.gribLon})`);
  const h = man.hours.indexOf(cp.fh), v = F.t2m.at(h, p.cell[0], p.cell[1]), f = ((p.value - 273.15) * 9) / 5 + 32;
  ok(Math.abs(v - f) <= 0.051, `${p.name}: click-to-inspect value ${v.toFixed(1)}°F = GRIB ${f.toFixed(2)}°F (0.1° packing)`);
});
/* every cell centre in the package: projection inverse vs GRIB's own latitudes/longitudes */
const ll = zlib.gunzipSync(fs.readFileSync(path.join(dir, g.latlon.file))), lat = new Float32Array(ll.buffer.slice(ll.byteOffset, ll.byteOffset + ll.length));
let worst = 0; const per = g.nx * g.ny;
for (let j = 0; j < g.ny; j += 3) for (let i = 0; i < g.nx; i += 3) { const [a, b] = P.fromCell(i, j); worst = Math.max(worst, Math.abs(a - lat[j * g.nx + i]), Math.abs(b - lat[per + j * g.nx + i])); }
ok(worst < 2e-4, `all sampled cells: projected centres match GRIB lat/lon (worst ${worst.toExponential(2)}°)`);
eq(P.nearest(36.0, -84.5), null, "outside the crop: no value is invented");
eq(P.nearest(41.5, -84.5), null, "outside the crop (north)");

/* precipitation: intervals come from the manifest (GRIB startStep/endStep) */
eq(man.fields.apcp_hour.intervals.map((x) => x && [x.startStep, x.endStep]), [null, [0, 1], [1, 2], [2, 3]], "hourly accumulations carry their GRIB intervals; f00 has none");
eq(man.fields.apcp_run.intervals.map((x) => x && [x.startStep, x.endStep]), [[0, 0], [0, 1], [0, 2], [0, 3]], "run totals carry 0-N intervals as GRIB states them (HRRR f00 has a zero-length 0-0 h message)");
let maxDiff = 0, wet = 0;
for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
  const run = MC.precip(man, F, 3, "run", i, j).mm, sum = MC.precip(man, F, 3, 3, i, j).mm;
  maxDiff = Math.max(maxDiff, Math.abs(run - sum)); if (run > 0.25) wet++;
}
ok(maxDiff <= 0.031, `real data: sum of the three GRIB hourly fields equals the GRIB 0-3 h total everywhere (max diff ${maxDiff.toFixed(3)} mm, packing 0.01 mm)`);
eq(MC.precip(man, F, 0, "run", 10, 10), { mm: null, why: "no accumulation at the start of the run" }, "f00: precipitation unavailable, not zero");
eq(MC.precip(man, F, 2, 6, 10, 10).mm, null, "a 6-h window needs six hours of the run: unavailable at f02");
eq(MC.precip(man, F, 3, 24, 10, 10).mm, null, "a 24-h total requires the full window");
/* synthetic edge cases on the same layout */
const synth = JSON.parse(JSON.stringify(man)); synth.fields.apcp_hour.intervals[2] = null; synth.fields.apcp_hour.missingHours = [2];
const S2 = { ...F, apcp_hour: MC.field(synth.fields.apcp_hour, new Uint16Array(nh * per).fill(10).buffer, nh, g.ny, g.nx) };
eq(MC.precip(synth, S2, 3, 3, 5, 5), { mm: null, why: "hour 2 is missing" }, "a missing hour makes the window unavailable (never zero)");
eq(MC.precip(synth, S2, 1, 1, 5, 5).mm, 0.1, "hours that exist still sum");
const wrongIv = JSON.parse(JSON.stringify(man)); wrongIv.fields.apcp_hour.intervals[3] = { startStep: 0, endStep: 3 };
eq(MC.precip(wrongIv, F, 3, 3, 5, 5).mm, null, "a field whose GRIB interval is not (N-1)-N is never treated as an hourly amount");
const hole = new Uint16Array(nh * per).fill(65535); const S3 = { ...F, apcp_hour: MC.field(man.fields.apcp_hour, hole.buffer, nh, g.ny, g.nx) };
eq(MC.precip(man, S3, 1, 1, 5, 5).mm, null, "missing cells (sentinel) stay missing");
/* colour scales */
eq(MC.color("precip", 0.005), null, "below 0.01 in: transparent");
eq(MC.color("refc", 0), null, "no echo below 5 dBZ");
ok(MC.color("t2m", 31.9)[2] !== MC.color("t2m", 33)[2], "freezing line is a colour boundary");
eq(MC.color("t2m", null), null, "missing temperature is not coloured");

/* GPU mesh: every native cell is a quad at its exact projected corners; neighbours share corners (no gaps) */
const M = MC.mesh(g), unmerc = ([x, y]) => [(Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI, x * 360 - 180];
eq(M.native.pos.length, g.nx * g.ny * 8, "four corners per native cell");
eq(M.native.idx.length, g.nx * g.ny * 6, "two triangles per native cell");
{ const [ci, cj] = cp.points[0].cell, c = cj * g.nx + ci, q = [0, 1, 2, 3].map((k) => [M.native.pos[c * 8 + k * 2], M.native.pos[c * 8 + k * 2 + 1]]);
  const ctr = unmerc([(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]), back = P.nearest(ctr[0], ctr[1]);
  eq(back.join(","), cp.points[0].cell.join(","), "the CVG quad's centre maps back to the GRIB checkpoint cell");
  ok(Math.abs(ctr[0] - cp.points[0].gribLat) < 0.003 && Math.abs(ctr[1] - cp.points[0].gribLon) < 0.003, "quad centre within ~300 m of the GRIB grid point");
  const r = c + 1; ok(M.native.pos[r * 8] === q[1][0] && M.native.pos[r * 8 + 1] === q[1][1], "east neighbour shares the corner exactly (no seams)"); }
eq(M.smooth.pos.length, g.nx * g.ny * 2, "smoothing mesh: one vertex per cell centre (values never resampled)");
eq(M.extent[0].join(), M.extent[M.extent.length - 1].join(), "data-extent ring is closed");
/* colour table: stepped scales land exactly on their legend colours; below-threshold is transparent */
const T = MC.colorTable("refc"), uu = MC.scaleU("refc", 37), k = Math.floor(uu * 256);
eq([...T.slice(k * 4, k * 4 + 3)].join(), MC.color("refc", 37).slice(0, 3).join(), "37 dBZ renders the 35-40 legend colour");
eq(MC.scaleU("refc", 4.9), -1, "below 5 dBZ is not drawn");
eq(MC.scaleU("precip", null), null, "missing precipitation has no colour coordinate");
console.log(`ok - ${n} model-map checks passed (real HRRR package + synthetic cases)`);
