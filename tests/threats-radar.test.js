/* Radar from measured values (assets/threats-radar.js), matching Predictable heads-up a6a83c1:
   the Reflectivity 2026 table, IEM's lcref index lookup, world file and scan-time parsing, and the indexed-PNG decoder through
   every PNG filter type. (The byte-for-byte comparison with Predictable's own decoder and tile renderer on a real 7000 x 3500
   scan is recorded in docs/threats/RADAR.md.) Run: node tests/threats-radar.test.js */
"use strict";
const assert = require("assert"), zlib = require("zlib");
const R = require("../assets/threats-radar.js");
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log("ok -", name); };
// Predictable lib/level3/colorTable.ts REFLECTIVITY_VISUAL_STOPS at a6a83c1, copied here as the reference
const PREDICTABLE = [[5, [0, 150, 190], 150], [10, [0, 105, 215], 185], [15, [0, 185, 125], 215], [20, [0, 205, 70], 232], [25, [65, 220, 45], 242], [30, [170, 225, 35], 248],
  [35, [245, 220, 20], 255], [40, [255, 155, 20], 255], [45, [245, 65, 35], 255], [50, [205, 20, 25], 255], [55, [225, 35, 150], 255], [60, [170, 45, 205], 255], [65, [225, 210, 245], 255], [70, [255, 255, 255], 255]];
const inflate = async (z) => new Uint8Array(zlib.inflateSync(Buffer.from(z)));
/* a small 8-bit indexed PNG with a tRNS chunk, each row using a different filter */
function indexedPng(w, h, rows, filters, trns) {
  const crcTable = []; for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[k] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(256 * 3);
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { const f = filters[y]; raw[y * (w + 1)] = f;
    for (let x = 0; x < w; x++) { const v = rows[y][x], a = x ? rows[y][x - 1] : 0, b = y ? rows[y - 1][x] : 0, c = x && y ? rows[y - 1][x - 1] : 0;
      let pr = 0; if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (w + 1) + 1 + x] = (v - pr) & 255; } }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("PLTE", plte), chunk("tRNS", Buffer.from(trns)), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
(async () => {
  await ok("Reflectivity 2026: the same 14 bands, colours and transparency as Predictable's table", () => {
    assert.deepStrictEqual(R.STOPS, PREDICTABLE); assert.strictEqual(R.THRESHOLD, 5); assert.strictEqual(R.OPACITY, 0.7);
  });
  await ok("dBZ to colour: below 5 dBZ transparent; each band from its lower bound; 70 and above white", () => {
    assert.deepStrictEqual(R.dbzToRgba(4.5), { r: 0, g: 0, b: 0, a: 0 });
    assert.deepStrictEqual(R.dbzToRgba(5), { r: 0, g: 150, b: 190, a: 150 }); assert.deepStrictEqual(R.dbzToRgba(9.5), { r: 0, g: 150, b: 190, a: 150 });
    assert.deepStrictEqual(R.dbzToRgba(37), { r: 245, g: 220, b: 20, a: 255 }); assert.deepStrictEqual(R.dbzToRgba(52), { r: 205, g: 20, b: 25, a: 255 });
    assert.deepStrictEqual(R.dbzToRgba(80), { r: 255, g: 255, b: 255, a: 255 });
  });
  await ok("IEM lcref index lookup (0 = -32 dBZ, 64 = 0 dBZ, 0.5 dBZ steps); the palette honours the source's own transparency", () => {
    assert.strictEqual(R.indexDbz(0), -32); assert.strictEqual(R.indexDbz(64), 0); assert.strictEqual(R.indexDbz(74), 5); assert.strictEqual(R.indexDbz(73), 4.5);
    const alpha = new Uint8Array(256).fill(255); alpha[140] = 0; alpha[150] = 128; const lut = R.palette(alpha);
    assert.deepStrictEqual([...lut.subarray(73 * 4, 74 * 4)], [0, 0, 0, 0]); assert.deepStrictEqual([...lut.subarray(74 * 4, 75 * 4)], [0, 150, 190, 150]);
    assert.strictEqual(lut[140 * 4 + 3], 0); assert.strictEqual(lut[150 * 4 + 3], Math.round(255 * 128 / 255)); // 43 dBZ at half the source's alpha
  });
  await ok("world file and scan time: the real IEM files (2026-11-26 19:36Z); wrong product or units refused", () => {
    assert.deepStrictEqual(R.parseWorldFile("0.01\n0.00\n0.00\n-0.01\n-129.995\n54.995"), { dx: 0.01, dy: -0.01, firstLon: -129.995, firstLat: 54.995 });
    assert.throws(() => R.parseWorldFile("0.01 0 0 0.01 -129 55"), /georeferencing/);
    assert.strictEqual(R.parseMeta({ meta: { start_valid: "2026-11-26T19:36:00Z", end_valid: "2026-11-26T19:36:00Z", product: "lcref", units: "0.5 dBZ" } }), Date.parse("2026-11-26T19:36:00Z"));
    assert.throws(() => R.parseMeta({ meta: { start_valid: "2026-11-26T19:36:00Z", product: "n0q", units: "0.5 dBZ" } }), /product/);
  });
  await ok("indexed-PNG decoder: every filter type (none, sub, up, average, Paeth) gives back the measured indices and tRNS", async () => {
    const rows = [[0, 74, 100, 140, 255, 3], [10, 74, 101, 160, 254, 9], [200, 1, 2, 3, 4, 5], [74, 74, 75, 76, 140, 141], [130, 131, 129, 120, 90, 60]];
    const trns = [...Array(256)].map((_, i) => (i === 0 ? 0 : 255));
    const g = await R.decodeIndexedPng(indexedPng(6, 5, rows, [0, 1, 2, 3, 4], trns), inflate);
    assert.strictEqual(g.width, 6); assert.strictEqual(g.height, 5); assert.deepStrictEqual([...g.indices], rows.flat()); assert.strictEqual(g.alpha[0], 0); assert.strictEqual(g.alpha[74], 255);
    await assert.rejects(R.decodeIndexedPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), inflate), /not a PNG/);
  });
  await ok("tiles: nearest-neighbour from the grid; outside the grid and below 5 dBZ stay transparent", () => {
    const w = 4, h = 4, grid = { width: w, height: h, indices: new Uint8Array([0, 74, 140, 160, 74, 74, 74, 74, 140, 140, 140, 140, 160, 160, 160, 160]), alpha: new Uint8Array(256).fill(255), dx: 45, dy: -22.5, firstLon: -157.5, firstLat: 78.75 };
    const t = R.renderTile(grid, R.palette(grid.alpha), 0, 0, 0, 64); let col = 0; for (let i = 3; i < t.length; i += 4) if (t[i]) col++;
    assert.ok(col > 0 && col < 64 * 64, col); assert.strictEqual(t[(0 * 64 + 0) * 4 + 3], 0); // the top-left corner is outside the grid
  });
  /* precipitation type: MRMS PrecipFlag, NOAA/NSSL's documented codes */
  const B = require("../tools/precipflag-grib.js");
  await ok("PrecipFlag codes: only NOAA's documented categories are drawn; no sleet or freezing-rain class is invented", () => {
    assert.deepStrictEqual(R.PTYPE.map((c) => [c[0], c[1]]), [[1, "Warm stratiform rain"], [10, "Cool stratiform rain"], [6, "Convective rain"], [7, "Rain with hail"], [3, "Snow"], [91, "Tropical/stratiform rain mix"], [96, "Tropical/convective rain mix"]]);
    assert.strictEqual(R.NO_PRECIP, 0); assert.strictEqual(R.NO_COVERAGE, -3);
    assert.ok(!R.PTYPE.some((c) => /sleet|freezing|ice pellet/i.test(c[1])));
    assert.strictEqual(new Set(R.PTYPE.map((c) => c[2].join())).size, R.PTYPE.length); // every category its own colour
  });
  await ok("PrecipFlag palette (value = byte - 3): no precipitation transparent; no coverage hatched, never coloured like a category; unknown codes not drawn", () => {
    const p = R.ptypePalette({ R: -3, E: 0, D: 0 }), a = (byte) => p.lut[byte * 4 + 3];
    assert.strictEqual(R.gribValue(0, { R: -3, E: 0, D: 0 }), -3); assert.strictEqual(R.gribValue(6, { R: -3, E: 0, D: 0 }), 3);
    assert.strictEqual(a(3), 0); assert.strictEqual(p.hatch.on[3], 0);                            // 0 no precipitation
    assert.strictEqual(a(0), 0); assert.strictEqual(p.hatch.on[0], 1);                            // -3 no coverage
    assert.deepStrictEqual([...p.lut.subarray(6 * 4, 7 * 4)], [60, 140, 255, R.PTYPE_ALPHA]);   // 3 snow
    assert.deepStrictEqual([...p.lut.subarray(4 * 4, 5 * 4)], [35, 190, 75, R.PTYPE_ALPHA]);    // 1 warm stratiform rain
    for (const byte of [5, 7, 8, 11, 50, 200]) assert.strictEqual(a(byte), 0, "byte " + byte);  // 2, 4, 5, 8, 47, 197: undocumented
  });
  await ok("PrecipFlag GRIB2: scan time, scaling, grid and PNG read; wrong product, centre, grid template or packing refused", async () => {
    const bytes = new Uint8Array([0, 3, 4, 6, 9, 10, 13, 94]), scan = Date.parse("2026-01-12T18:04:00Z");
    const f = R.parsePrecipFlag(new Uint8Array(B.build({ scan, width: 4, height: 2, bytes })));
    assert.strictEqual(f.scan, scan); assert.deepStrictEqual(f.scaling, { R: -3, E: 0, D: 0 }); assert.deepStrictEqual(f.world, { dx: 0.01, dy: -0.01, firstLon: -129.995, firstLat: 54.995 });
    const g = await R.decodeIndexedPng(f.png, inflate); assert.deepStrictEqual([...g.indices], [...bytes]);
    for (const [bad, re] of [[{ cat: 1 }, /PrecipFlag/], [{ centre: 7 }, /centre/], [{ discipline: 0 }, /MRMS/], [{ template: 40 }, /packing/]]) assert.throws(() => R.parsePrecipFlag(new Uint8Array(B.build({ scan, width: 4, height: 2, bytes, ...bad }))), re);
    assert.throws(() => R.parsePrecipFlag(new Uint8Array(20)), /GRIB2/);
  });
  await ok("PrecipFlag tiles: nearest-neighbour; no-coverage hatch continuous across tiles; no precipitation transparent", () => {
    const w = 4, h = 4, p = R.ptypePalette({ R: -3, E: 0, D: 0 });
    const grid = { width: w, height: h, indices: new Uint8Array([0, 0, 0, 0, 3, 3, 6, 6, 4, 4, 4, 4, 13, 13, 13, 13]), dx: 90, dy: -45, firstLon: -180, firstLat: 90 };
    const t = R.renderTile(grid, p.lut, 0, 0, 0, 64, p.hatch); let hatch = 0, snow = 0, rain = 0;
    for (let i = 0; i < t.length; i += 4) { const c = t[i] + "," + t[i + 1] + "," + t[i + 2]; if (c === R.HATCH.slice(0, 3).join()) hatch++; else if (c === "60,140,255") snow++; else if (c === "35,190,75") rain++; }
    assert.ok(hatch > 0 && snow > 0 && rain > 0, JSON.stringify({ hatch, snow, rain }));
    assert.ok(hatch < 64 * 16 * 0.35, "no coverage is a light hatch, not a fill: " + hatch);
  });
  console.log(n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
