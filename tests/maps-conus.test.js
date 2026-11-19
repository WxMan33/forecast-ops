/* Full-CONUS HRRR beta (maps-conus-core.js): tile decoding against the pipeline's own encoder, placement on
   the HRRR CONUS grid (NOAA's published grid definition, with eccodes' nearest-gridpoint answers recorded by
   forecast-ops-maps/pipeline/conus.py), level choice, tiles in view, and the drawing mesh's accuracy.
   Values are synthetic; the grid and checkpoint cells are NOAA's public HRRR grid. */
"use strict";
const assert = require("assert"), zlib = require("zlib");
const MC = require("../assets/maps-core.js"), K = require("../assets/maps-conus-core.js");
let n = 0; const ok = (c, m) => { assert(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* 1. a tile encoded by pipeline/conus.py encode_tile (synthetic values, missing sentinel, both int16 extremes) */
const want = [[-200, -211, -222, -233, -244, -255, 32767], [-163, -174, -185, -196, -207, -218, -229], [-126, -137, -148, -32768, -170, -181, -192], [-89, -100, -111, -122, -133, -144, -155], [-32767, -63, -74, -85, -96, -107, -118]];
const t = K.decodeTile(zlib.gunzipSync(Buffer.from("H4sIAAAAAAAA/+sXBQFmVzAl+ltU9PoaUdGNEN7fBjDFyAAC/yAUmPkPzvz/H0wBAFK4kwdGAAAA", "base64")), 5, 7);
eq(Array.from(t.values), want.flat(), "JS decoder reproduces the Python encoder's tile exactly");
ok(t.bytes[2 * 6] === 0xff && t.bytes[2 * 6 + 1] === 0x7f, "texture bytes are little-endian [low, high] pairs");
assert.throws(() => K.decodeTile(new Uint8Array(10), 5, 7)); n++;

/* 2. the HRRR CONUS grid: placement matches eccodes at 15 places across the domain */
const G = { gridType: "lambert", Nx: 1799, Ny: 1059, LaDInDegrees: 38.5, LoVInDegrees: 262.5, Latin1InDegrees: 38.5, Latin2InDegrees: 38.5, latitudeOfFirstGridPointInDegrees: 21.138123, longitudeOfFirstGridPointInDegrees: 237.280472,
  DxInMetres: 3000, DyInMetres: 3000, radius: 6371229, i0: 0, j0: 0, nx: 1799, ny: 1059, x0: -2697520.1425219304, y0: -1587306.1525566624 };
const CP = [["CVG airport", 39.04456, -84.67229, [1267, 575], 39.04612, -84.68172], ["Downtown Cincinnati", 39.1031, -84.512, [1272, 578], 39.1074, -84.4951], ["Dayton (DAY)", 39.9024, -84.2194, [1276, 608], 39.89302, -84.20737],
  ["Louisville (SDF)", 38.1744, -85.736, [1241, 539], 38.17692, -85.73691], ["Lexington (LEX)", 38.0365, -84.6059, [1274, 538], 38.03135, -84.62022], ["Columbus (CMH)", 39.998, -82.8919, [1312, 617], 39.98646, -82.90776],
  ["Huntington (HTS)", 38.3667, -82.558, [1332, 559], 38.35573, -82.54335], ["SW corner area", 37.75, -86.45, [1222, 521], 37.75838, -86.45822], ["NE corner area", 40.6, -82.5, [1320, 641], 40.59074, -82.49276],
  ["Seattle (SEA)", 47.4502, -122.3088, [277, 947], 47.46028, -122.30923], ["Miami (MIA)", 25.7959, -80.287, [1484, 109], 25.78755, -80.28397], ["Boston (BOS)", 42.3656, -71.0096, [1616, 776], 42.35738, -71.02612],
  ["San Diego (SAN)", 32.7338, -117.1933, [287, 381], 32.74072, -117.18832], ["Denver (DEN)", 39.8561, -104.6737, [695, 587], 39.84693, -104.67984], ["Brownsville (BRO)", 25.9068, -97.4259, [902, 59], 25.91552, -97.41715]];
const P = MC.projector(G);
CP.forEach(([name, la, lo, cell, gla, glo]) => {
  eq(P.nearest(la, lo), cell, `${name}: viewer cell = eccodes nearest grid point`);
  const [a, b] = P.fromCell(cell[0], cell[1]); ok(Math.abs(a - gla) < 2e-4 && Math.abs(b - glo) < 2e-4, `${name}: cell centre matches GRIB lat/lon`);
});
ok(P.nearest(55, -60) === null && P.nearest(15, -100) === null, "outside the HRRR grid: no cell (left blank)");

/* 3. click-to-read uses the native (L0) tile holding the cell, at full precision */
const MAN = { tile: 256, grid: G, levels: [{ level: 0, nx: 1799, ny: 1059, tilesX: 8, tilesY: 5 }, { level: 1, nx: 900, ny: 530, tilesX: 4, tilesY: 3 }, { level: 2, nx: 450, ny: 265, tilesX: 2, tilesY: 2 }],
  fields: { t2m: { scale: 0.1, displayStep: 5 } } };
{ const d = K.tileDims(MAN, 0, 4, 2), raw = new Uint8Array(d.nx * d.ny * 2), v = 644, z = (v << 1) ^ (v >> 15), at = (575 - 512) * d.nx + 0; // first cell of a row: difference = value
  raw[at] = z & 0xff; raw[d.nx * d.ny + at] = z >> 8;
  const tiles = { [K.tileName(0, 4, 2)]: K.decodeTile(raw, d.ny, d.nx) };
  ok(Math.abs(K.valueAt(MAN, "t2m", tiles, 1024, 575) - 64.4) < 1e-9, "CVG-row value read from tile L0_4_2 at 0.1 degF");
  ok(K.valueAt(MAN, "t2m", tiles, 1300, 575) === undefined, "a cell whose tile is not loaded (L0_5_2) reads as not yet available");
  ok(Math.abs(K.valueAt(MAN, "t2m", tiles, 1100, 575) - 64.4) < 1e-9, "zero differences repeat the value along the row");
  ok(K.valueAt(MAN, "t2m", tiles, 1100, 576) === 0, "a stored zero is 0 degF, not missing"); }
eq(K.tileDims(MAN, 0, 7, 4), { nx: 1799 - 7 * 256, ny: 1059 - 4 * 256 }, "edge tiles are cut to the grid");
ok(K.scaleOf(MAN.fields.t2m, 0) === 0.1 && K.scaleOf(MAN.fields.t2m, 2) === 0.5, "L0 in 0.1 degF; L1/L2 in 0.5 degF display steps");

/* 4. level choice and tiles in view */
eq([0.3, 0.6, 1.1, 2.5].map((px) => K.levelFor(px, MAN.levels)), [2, 2, 1, 0], "coarsest level with cells >= 2 device px; native once cells are that big");
eq(K.tilesFor(MAN, 0, 1200, 1340, 500, 650), [[4, 1], [5, 1], [4, 2], [5, 2]], "Ohio Valley view: 4 of 40 native tiles");
eq(K.tilesFor(MAN, 2, 0, 1798, 0, 1058).length, 4, "whole grid at L2: 4 tiles");
eq(K.tilesFor(MAN, 0, -50, 3000, -50, 3000).length, 40, "requests are clamped to the grid");

/* 5. the drawing mesh: nodes every 8 cells put every cell within 1% of a cell of its projected position */
const mesh = K.gridMesh(P, 1799, 1059, MC.merc, 8);
ok(mesh.pos.length === mesh.g.length && mesh.count % 3 === 0 && mesh.idx.every((x) => x < mesh.pos.length / 2), "mesh buffers are consistent");
eq([mesh.g[0], mesh.g[1]], [0, 0], "mesh starts at the grid's outer edge");
const err = K.meshError(P, 1799, 1059, MC.merc, 8); ok(err < 0.01, `linear interpolation inside 8-cell patches is within ${err.toFixed(4)} cells`);
ok(mesh.ring.length > 1000 && mesh.ring[0][0] === mesh.ring[mesh.ring.length - 1][0], "footprint outline is closed");

/* 6. colour table follows the temperature scale used on the Tri-State maps */
const lut = K.lut((v) => MC.color("t2m", v), -20, 120), at = (v) => Array.from(lut.slice(Math.floor(((v + 20) / 140) * 1024) * 4, Math.floor(((v + 20) / 140) * 1024) * 4 + 3));
eq(at(71), MC.color("t2m", 71).slice(0, 3), "71 degF colour matches the shared scale");

/* 7. packed layout: one file per field-hour; tiles in a row are one byte range */
{ const lens = []; let k = 0; [2, 1, 0].forEach((L) => { const lv = K.levelInfo(MAN, L); for (let i = 0; i < lv.tilesX * lv.tilesY; i++) lens.push(100 + k++); });
  const ix = K.packIndex(MAN, { pack: { lengths: lens } });
  eq(ix["L2_0_0.bin.gz"], [0, 100], "coarsest level first");
  eq(ix["L1_0_0.bin.gz"][0], 100 + 101 + 102 + 103, "then L1, row by row");
  eq(Object.keys(ix).length, 4 + 12 + 40, "56 tiles per field-hour");
  const r = K.packRanges(ix, ["L0_4_1.bin.gz", "L0_5_1.bin.gz", "L0_4_2.bin.gz", "L0_5_2.bin.gz"]);
  eq(r.length, 2, "a 2 x 2 block of native tiles = 2 range requests (one per tile row)");
  eq([r[0].tiles.map((t) => t.name), r[0].end - r[0].start], [["L0_4_1.bin.gz", "L0_5_1.bin.gz"], ix["L0_4_1.bin.gz"][1] + ix["L0_5_1.bin.gz"][1]], "adjacent tiles share a range");
  eq(K.packRanges(ix, ["L2_0_0.bin.gz", "L2_1_0.bin.gz", "L2_0_1.bin.gz", "L2_1_1.bin.gz"]).length, 1, "the whole coarse level is one request");
  assert.throws(() => K.packIndex(MAN, { pack: { lengths: lens.slice(1) } })); n++; }

console.log(`ok - ${n} CONUS map checks passed`);
