/* Full-CONUS HRRR map support (beta, conus-v1): pure functions shared by the viewer and its tests.
   The pipeline (forecast-ops-maps/pipeline/conus.py) publishes the whole native HRRR grid as tiles:
     L0 every native cell (full precision), L1 every 2nd cell, L2 every 4th cell (display steps),
   256 x 256 cells per tile, one file per tile per forecast hour. Nothing is resampled: a level-L cell
   is drawn over the 2^L x 2^L block of native cells it stands for, and click-to-read always uses L0. */
(function (root) {
  "use strict";
  const VERSION = "maps-conus-core-v1", MISS = -32768;

  /* Tile bytes (already gunzipped): [low bytes][high bytes] of zigzag-coded row differences.
     Returns the int16 values as a Uint8Array of little-endian [lo, hi] pairs (WebGL LUMINANCE_ALPHA
     upload) plus an Int16Array view of the same memory (click-to-read). */
  function decodeTile(raw, ny, nx) {
    const n = ny * nx; if (raw.length !== 2 * n) throw new Error(`tile size ${raw.length} != 2x${ny}x${nx}`);
    const out = new Uint8Array(2 * n);
    for (let j = 0; j < ny; j++) {
      let acc = 0; const r = j * nx;
      for (let i = 0; i < nx; i++) {
        const z = raw[r + i] | (raw[n + r + i] << 8), d = (z >>> 1) ^ -(z & 1);
        acc = (acc + d) & 0xffff; out[2 * (r + i)] = acc & 0xff; out[2 * (r + i) + 1] = acc >>> 8;
      }
    }
    return { bytes: out, values: new Int16Array(out.buffer), ny, nx };
  }

  /* Tile layout for one level of a manifest. */
  function levelInfo(man, L) { return man.levels.find((x) => x.level === L); }
  function tileDims(man, L, tx, ty) { const lv = levelInfo(man, L), T = man.tile; return { nx: Math.min(T, lv.nx - tx * T), ny: Math.min(T, lv.ny - ty * T) }; }
  const tileName = (L, tx, ty) => `L${L}_${tx}_${ty}.bin.gz`;

  /* Coarsest level whose cells are still at least `minPx` device pixels wide; L0 once native cells
     reach that size. cellPx = native cell width in device pixels at the current zoom. */
  function levelFor(cellPx, levels, minPx = 2) {
    const ls = levels.map((l) => l.level).sort((a, b) => a - b);
    for (const L of ls) if (cellPx * 2 ** L >= minPx) return L;
    return ls[ls.length - 1];
  }

  /* Tiles of level L covering a native-cell rectangle [i0,i1] x [j0,j1] (clamped to the grid). */
  function tilesFor(man, L, i0, i1, j0, j1) {
    const lv = levelInfo(man, L), s = 2 ** L, T = man.tile, out = [];
    const a = Math.max(0, Math.floor(i0 / s / T)), b = Math.min(lv.tilesX - 1, Math.floor(i1 / s / T));
    const c = Math.max(0, Math.floor(j0 / s / T)), d = Math.min(lv.tilesY - 1, Math.floor(j1 / s / T));
    for (let ty = c; ty <= d; ty++) for (let tx = a; tx <= b; tx++) out.push([tx, ty]);
    return out;
  }

  /* Display value of a stored integer at level L. */
  const scaleOf = (spec, L) => (L === 0 ? spec.scale : spec.scale * spec.displayStep);

  /* Native value at cell (i, j) from the L0 tile that holds it. */
  function valueAt(man, field, tiles, i, j) {
    const T = man.tile, tx = Math.floor(i / T), ty = Math.floor(j / T), t = tiles[tileName(0, tx, ty)];
    if (!t) return undefined;
    const v = t.values[(j - ty * T) * t.nx + (i - tx * T)];
    return v === MISS ? null : v * man.fields[field].scale;
  }

  /* Drawing mesh over the native grid: nodes on cell EDGES every `k` cells (edge e = cell index + 0.5),
     each carrying its exact Web Mercator position from the GRIB projection and its edge coordinate.
     Within a k x k patch the GPU interpolates linearly; meshError() measures what that costs. */
  function gridMesh(P, nx, ny, merc, k = 8) {
    const xs = [], ys = [];
    for (let e = 0; e < nx; e += k) xs.push(e); xs.push(nx);
    for (let e = 0; e < ny; e += k) ys.push(e); ys.push(ny);
    const W = xs.length, Hn = ys.length, pos = new Float32Array(W * Hn * 2), g = new Float32Array(W * Hn * 2), idx = new Uint32Array((W - 1) * (Hn - 1) * 6);
    for (let b = 0; b < Hn; b++) for (let a = 0; a < W; a++) {
      const [la, lo] = P.fromCell(xs[a] - 0.5, ys[b] - 0.5), m = merc(la, lo), q = (b * W + a) * 2;
      pos[q] = m[0]; pos[q + 1] = m[1]; g[q] = xs[a]; g[q + 1] = ys[b];
    }
    let t = 0; for (let b = 0; b < Hn - 1; b++) for (let a = 0; a < W - 1; a++) { const p = b * W + a; idx.set([p, p + 1, p + W + 1, p, p + W + 1, p + W], t); t += 6; }
    /* the footprint outline (outer cell edges), as lon/lat */
    const ring = [], edge = (e, f) => { const [la, lo] = P.fromCell(e - 0.5, f - 0.5); ring.push([lo, la]); };
    for (let e = 0; e <= nx; e += 4) edge(e, 0); edge(nx, 0); for (let f = 4; f <= ny; f += 4) edge(nx, f); edge(nx, ny);
    for (let e = nx - 4; e >= 0; e -= 4) edge(e, ny); edge(0, ny); for (let f = ny - 4; f > 0; f -= 4) edge(0, f); ring.push(ring[0]);
    return { pos, g, idx, count: idx.length, ring, k };
  }

  /* Largest error, in native cells, of linear interpolation inside mesh patches: for sample points the
     exact Mercator position is mapped back to grid coordinates by the patch's own bilinear/triangle
     interpolation and compared with the true cell coordinate. */
  function meshError(P, nx, ny, merc, k = 8, samples = 4) {
    let worst = 0;
    for (let b = 0; b + k <= ny; b += k * 7) for (let a = 0; a + k <= nx; a += k * 9) {
      const c = [[a, b], [a + k, b], [a + k, b + k], [a, b + k]].map(([e, f]) => { const [la, lo] = P.fromCell(e - 0.5, f - 0.5); return merc(la, lo); });
      for (let s = 1; s < samples; s++) for (let u = 1; u < samples; u++) {
        const fe = (s / samples) * k, ff = (u / samples) * k, [la, lo] = P.fromCell(a + fe - 0.5, b + ff - 0.5), m = merc(la, lo);
        /* triangle (0,1,2) if below the diagonal else (0,2,3), as drawn */
        const tri = ff <= fe ? [c[0], c[1], c[2], [0, 0], [k, 0], [k, k]] : [c[0], c[2], c[3], [0, 0], [k, k], [0, k]];
        const [p0, p1, p2, g0, g1, g2] = tri, det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
        const w1 = ((m[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (m[1] - p0[1])) / det, w2 = ((p1[0] - p0[0]) * (m[1] - p0[1]) - (m[0] - p0[0]) * (p1[1] - p0[1])) / det, w0 = 1 - w1 - w2;
        const ge = w0 * g0[0] + w1 * g1[0] + w2 * g2[0], gf = w0 * g0[1] + w1 * g1[1] + w2 * g2[1];
        worst = Math.max(worst, Math.abs(ge - fe), Math.abs(gf - ff));
      }
    }
    return worst;
  }

  /* 1024-entry colour table over [lo, hi] for a value -> colour function (null = transparent). */
  function lut(colorOf, lo, hi, n = 1024) {
    const out = new Uint8Array(n * 4);
    for (let x = 0; x < n; x++) { const v = lo + ((x + 0.5) / n) * (hi - lo), c = colorOf(v); if (c) out.set([c[0], c[1], c[2], 255], x * 4); }
    return out;
  }

  /* Packed layout (one file per field and hour; see forecast-ops-maps/pipeline/conus.py --pack): tiles are separate gzip
     members, levels from coarsest to native, each level row by row. Returns {name: [offset, length]} for an hour. */
  function packIndex(man, rec) {
    const out = {}, lens = rec.pack.lengths; let k = 0, off = 0;
    man.levels.map((l) => l.level).sort((a, b) => b - a).forEach((L) => { const lv = levelInfo(man, L);
      for (let ty = 0; ty < lv.tilesY; ty++) for (let tx = 0; tx < lv.tilesX; tx++) { out[tileName(L, tx, ty)] = [off, lens[k]]; off += lens[k]; k++; } });
    if (k !== lens.length) throw new Error(`pack index has ${lens.length} tiles, layout needs ${k}`);
    return out;
  }
  /* The byte ranges that fetch these tiles: tiles next to each other in the file share one request. */
  function packRanges(index, names) {
    const t = [...new Set(names)].map((n) => ({ name: n, off: index[n][0], len: index[n][1] })).sort((a, b) => a.off - b.off), out = [];
    t.forEach((x) => { const r = out[out.length - 1]; if (r && r.end === x.off) { r.end += x.len; r.tiles.push(x); } else out.push({ start: x.off, end: x.off + x.len, tiles: [x] }); });
    return out; // end is exclusive: HTTP Range bytes=start-(end-1)
  }

  const api = { VERSION, MISS, decodeTile, packIndex, packRanges, levelInfo, tileDims, tileName, levelFor, tilesFor, scaleOf, valueAt, gridMesh, meshError, lut };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MapsConusCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
