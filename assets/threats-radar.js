/* Radar reflectivity drawn from measured values, matching Predictable's MRMS view (heads-up a6a83c1: lib/mrms.ts,
   lib/mrmsComposite/{source,indexedPng,render}.ts, lib/level3/colorTable.ts):
     source: Iowa Environmental Mesonet's MRMS lowest-elevation composite reflectivity (lcref), a 0.01-degree indexed PNG whose
       pixel values are the measured values (dBZ = index * 0.5 - 32), its world file and a JSON with the scan time;
       https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=4. IEM allows browsers to read it (Access-Control-Allow-Origin: *),
       so the browser reads it directly: no server of ours in between.
     colours: the "Reflectivity 2026" table, below 5 dBZ transparent, each band with its own transparency; nearest-neighbour
       sampling into map tiles; the layer at 70% opacity to start (the viewer can change it).
   The page reads the scan time every 60 seconds and downloads the image only when a new scan is listed (about 1.2 MB). The
   decoding and the tile drawing happen in a Web Worker, so the page stays responsive. Pure pieces are exported for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ThreatsRadar = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const BASE = "https://mesonet.agron.iastate.edu/data/gis/images/4326/mrms/lcref";
  /* Reflectivity 2026 (Predictable lib/level3/colorTable.ts REFLECTIVITY_VISUAL_STOPS): inclusive lower bound in dBZ, colour, alpha 0-255 */
  const STOPS = [
    [5, [0, 150, 190], 150], [10, [0, 105, 215], 185], [15, [0, 185, 125], 215], [20, [0, 205, 70], 232], [25, [65, 220, 45], 242],
    [30, [170, 225, 35], 248], [35, [245, 220, 20], 255], [40, [255, 155, 20], 255], [45, [245, 65, 35], 255], [50, [205, 20, 25], 255],
    [55, [225, 35, 150], 255], [60, [170, 45, 205], 255], [65, [225, 210, 245], 255], [70, [255, 255, 255], 255]];
  const THRESHOLD = 5, OPACITY = 0.7; // the starting opacity; the page lets the viewer change it (Layers → Radar) and remembers it
  /* the colour for a dBZ value: the last band whose lower bound it reaches; below the first band, transparent */
  function dbzToRgba(dbz) { let c = null; for (const s of STOPS) { if (dbz >= s[0]) c = s; else break; } return c ? { r: c[1][0], g: c[1][1], b: c[1][2], a: c[2] } : { r: 0, g: 0, b: 0, a: 0 }; }
  const indexDbz = (i) => i * 0.5 - 32; // IEM's documented lcref lookup: index 0 = -32 dBZ, 64 = 0 dBZ
  /* index -> RGBA, honouring the source's own transparency (tRNS) as Predictable does */
  function palette(alpha, threshold = THRESHOLD) {
    const lut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { const dbz = indexDbz(i); if (dbz < threshold || !alpha[i]) continue; const c = dbzToRgba(dbz); if (!c.a) continue;
      lut[i * 4] = c.r; lut[i * 4 + 1] = c.g; lut[i * 4 + 2] = c.b; lut[i * 4 + 3] = Math.round(c.a * alpha[i] / 255); }
    return lut;
  }
  function parseWorldFile(text) {
    const v = String(text).trim().split(/\s+/).map(Number);
    if (v.length !== 6 || v.some((n) => !Number.isFinite(n)) || v[0] <= 0 || v[3] >= 0 || v[1] !== 0 || v[2] !== 0) throw Error("unsupported MRMS georeferencing");
    return { dx: v[0], dy: v[3], firstLon: v[4], firstLat: v[5] };
  }
  function parseMeta(j) {
    const m = j && j.meta; if (!m || m.product !== "lcref" || m.units !== "0.5 dBZ") throw Error("unexpected MRMS product or units");
    const t = Date.parse(m.start_valid || ""); if (!Number.isFinite(t)) throw Error("missing MRMS scan time"); return t;
  }
  /* an 8-bit indexed PNG (colour type 3, no interlace) -> its indices and per-index alpha; inflate is injected (zlib).
     8-bit greyscale (colour type 0, as inside MRMS GRIB2 PNG packing) decodes the same way: one byte per pixel, no palette. */
  async function decodeIndexedPng(bytes, inflate) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]; for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw Error("not a PNG");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [], alpha = new Uint8Array(256).fill(255);
    let w = 0, h = 0, ended = false, total = 0;
    for (let o = 8; o + 12 <= bytes.length;) {
      const len = dv.getUint32(o), type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]), c = bytes.subarray(o + 8, o + 8 + len);
      if (o + len + 12 > bytes.length) throw Error("truncated PNG");
      if (type === "IHDR") { if (len !== 13 || c[8] !== 8 || (c[9] !== 3 && c[9] !== 0) || c[10] || c[11] || c[12]) throw Error("unsupported PNG encoding (expected 8-bit indexed or greyscale)"); w = dv.getUint32(o + 8); h = dv.getUint32(o + 12); if (!w || !h || w * h > 40e6) throw Error("invalid grid size"); }
      else if (type === "IDAT") { parts.push(c); total += c.length; }
      else if (type === "tRNS") { if (len > 256) throw Error("invalid PNG transparency"); alpha.set(c); }
      else if (type === "IEND") { ended = true; break; }
      o += len + 12;
    }
    if (!w || !ended || !parts.length) throw Error("incomplete PNG");
    const z = new Uint8Array(total); { let p = 0; for (const c of parts) { z.set(c, p); p += c.length; } }
    const raw = await inflate(z); if (raw.length !== (w + 1) * h) throw Error("unexpected pixel count");
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const ip = y * (w + 1), op = y * w, f = raw[ip]; if (f > 4) throw Error("unsupported PNG filter");
      if (f === 0) { idx.set(raw.subarray(ip + 1, ip + 1 + w), op); continue; }
      for (let x = 0; x < w; x++) {
        const a = x ? idx[op + x - 1] : 0, b = y ? idx[op + x - w] : 0, c = x && y ? idx[op + x - w - 1] : 0;
        let pr = 0; if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1; else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        idx[op + x] = (raw[ip + 1 + x] + pr) & 255;
      }
    }
    return { width: w, height: h, indices: idx, alpha };
  }
  /* one 256 px web-mercator tile from the grid, nearest-neighbour, as Predictable's renderMrmsTile */
  /* pat (precipitation type only): {kind: Uint8Array(256), hatch: rgba, ua: rgba, ub: rgba}. kind 1 (no radar coverage): thin
     diagonal stripes; kind 2 (a code NOAA doesn't document): a two-tone checker, dark and light, so it reads on either basemap
     and can't pass for "no precipitation" or any category. Both patterns are continuous across tiles. */
  function renderTile(grid, lut, z, x, y, size = 256, pat = null) {
    const rgba = new Uint8ClampedArray(size * size * 4), n = 2 ** z, cols = new Int32Array(size);
    for (let px = 0; px < size; px++) { const lon = (x + (px + 0.5) / size) / n * 360 - 180; cols[px] = Math.round((lon - grid.firstLon) / grid.dx); }
    for (let py = 0; py < size; py++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / size) / n))) * 180 / Math.PI, row = Math.round((lat - grid.firstLat) / grid.dy);
      if (row < 0 || row >= grid.height) continue;
      for (let px = 0; px < size; px++) { const col = cols[px]; if (col < 0 || col >= grid.width) continue; const v = grid.indices[row * grid.width + col], k = v * 4;
        if (pat && pat.kind[v]) { const gx = x * size + px, gy = y * size + py; let c = null;
          if (pat.kind[v] === 1) { if ((gx + gy) % 9 < 2) c = pat.hatch; } else c = ((gx >> 1) + (gy >> 1)) & 1 ? pat.ua : pat.ub;
          if (c) { const d = (py * size + px) * 4; rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = c[3]; } continue; }
        if (!lut[k + 3]) continue;
        const d = (py * size + px) * 4; rgba[d] = lut[k]; rgba[d + 1] = lut[k + 1]; rgba[d + 2] = lut[k + 2]; rgba[d + 3] = lut[k + 3]; }
    }
    return rgba;
  }
  /* ---------- precipitation type: Predictable's radar with winter colours ----------
     Intensity comes from the same measured reflectivity as Reflectivity mode (IEM lcref); the type comes from NOAA/NSSL MRMS
     PrecipFlag for the same scan minute, on the same 0.01-degree grid. Each pixel:
       - PrecipFlag -3 (no radar coverage): grey stripes, so outside coverage never looks dry;
       - below 5 dBZ: transparent, as in Reflectivity;
       - PrecipFlag 3 (snow): a blue intensity ramp (SNOW_STOPS);
       - every rain class NOAA documents (1, 6, 7, 10, 91, 96) and 0: Predictable's Reflectivity 2026 colours, exactly;
       - any code NOAA doesn't document: a dark-and-light checker with its own legend line.
     PrecipFlag has no sleet, freezing-rain or mixed class, so none is drawn as an area; those come from ground reports. */
  const PTYPE = [[1, "Warm stratiform rain", "rain"], [10, "Cool stratiform rain", "rain"], [6, "Convective rain", "rain"], [7, "Rain with hail", "rain"],
    [91, "Tropical/stratiform rain mix", "rain"], [96, "Tropical/convective rain mix", "rain"], [3, "Snow", "snow"]];
  const NO_PRECIP = 0, NO_COVERAGE = -3;
  /* snow: light to deep blue with intensity (lower bound in dBZ, colour, alpha), below 5 dBZ transparent like rain */
  const SNOW_STOPS = [[5, [205, 230, 255], 170], [10, [160, 205, 255], 200], [15, [115, 175, 250], 220], [20, [75, 140, 240], 235],
    [25, [45, 105, 225], 245], [30, [30, 75, 200], 255], [35, [25, 50, 165], 255], [40, [40, 30, 130], 255]];
  /* no-coverage stripes per theme (light grey on the dark basemap, dark grey on the light one); unknown-code checker tones */
  const HATCH = { dark: [215, 215, 215, 170], light: [20, 20, 20, 200] }, UNKNOWN = [[25, 25, 25, 235], [250, 250, 250, 235]];
  const PTYPE_URL = "https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz";
  /* GRIB2 simple scaling: value = (R + X * 2^E) / 10^D */
  const gribValue = (x, p) => Math.round((p.R + x * 2 ** p.E) / 10 ** p.D);
  const CLS_REFL = 0, CLS_NOCOV = 1, CLS_UNKNOWN = 2, CLS_SNOW = 3;
  /* PrecipFlag byte -> how the pixel is coloured */
  function ptypeClasses(p) {
    const cls = new Uint8Array(256), known = new Map(PTYPE.map((c) => [c[0], c[2]]));
    for (let i = 0; i < 256; i++) { const v = gribValue(i, p); cls[i] = v === NO_COVERAGE ? CLS_NOCOV : v === NO_PRECIP ? CLS_REFL : known.get(v) === "snow" ? CLS_SNOW : known.has(v) ? CLS_REFL : CLS_UNKNOWN; }
    return cls;
  }
  /* reflectivity index -> snow RGBA, honouring the source's transparency as palette() does */
  function snowPalette(alpha, threshold = THRESHOLD) {
    const lut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { const dbz = indexDbz(i); if (dbz < threshold || !alpha[i]) continue; let c = null; for (const s of SNOW_STOPS) { if (dbz >= s[0]) c = s; else break; } if (!c) continue;
      lut[i * 4] = c[1][0]; lut[i * 4 + 1] = c[1][1]; lut[i * 4 + 2] = c[1][2]; lut[i * 4 + 3] = Math.round(c[2] * alpha[i] / 255); }
    return lut;
  }
  /* one 256 px tile from reflectivity (ref, with its Reflectivity 2026 lut and snow lut) and PrecipFlag (pf, with its classes),
     both on the same grid, nearest-neighbour; where PrecipFlag says rain the pixel is exactly renderTile's */
  function renderPtypeTile(ref, lut, snow, pf, cls, z, x, y, size = 256, pat = null) {
    const rgba = new Uint8ClampedArray(size * size * 4), n = 2 ** z, cols = new Int32Array(size);
    for (let px = 0; px < size; px++) { const lon = (x + (px + 0.5) / size) / n * 360 - 180; cols[px] = Math.round((lon - ref.firstLon) / ref.dx); }
    for (let py = 0; py < size; py++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / size) / n))) * 180 / Math.PI, row = Math.round((lat - ref.firstLat) / ref.dy);
      if (row < 0 || row >= ref.height) continue;
      for (let px = 0; px < size; px++) { const col = cols[px]; if (col < 0 || col >= ref.width) continue;
        const i = row * ref.width + col, c = cls[pf.indices[i]], d = (py * size + px) * 4;
        if (c === CLS_NOCOV) { if (pat && ((x * size + px) + (y * size + py)) % 9 < 2) { rgba[d] = pat.hatch[0]; rgba[d + 1] = pat.hatch[1]; rgba[d + 2] = pat.hatch[2]; rgba[d + 3] = pat.hatch[3]; } continue; }
        const k = ref.indices[i] * 4; if (!lut[k + 3]) continue; // below 5 dBZ: nothing, whatever the type
        if (c === CLS_UNKNOWN) { const u = (((x * size + px) >> 1) + ((y * size + py) >> 1)) & 1 ? UNKNOWN[0] : UNKNOWN[1]; rgba[d] = u[0]; rgba[d + 1] = u[1]; rgba[d + 2] = u[2]; rgba[d + 3] = u[3]; continue; }
        const L = c === CLS_SNOW ? snow : lut; rgba[d] = L[k]; rgba[d + 1] = L[k + 1]; rgba[d + 2] = L[k + 2]; rgba[d + 3] = L[k + 3]; }
    }
    return rgba;
  }
  /* PrecipFlag file name stamp for a scan time: YYYYMMDD-HHMM (UTC) */
  const pfStamp = (t) => { const d = new Date(t), p = (v) => String(v).padStart(2, "0"); return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" + p(d.getUTCHours()) + p(d.getUTCMinutes()); };
  /* one PrecipFlag GRIB2 message -> scan time, scaling, the embedded PNG and its georeferencing; anything else is refused */
  function parsePrecipFlag(g) {
    const dv = new DataView(g.buffer, g.byteOffset, g.byteLength), s32 = (o) => { const v = dv.getUint32(o); return v & 0x80000000 ? -(v & 0x7fffffff) : v; }, s16 = (o) => { const v = dv.getUint16(o); return v & 0x8000 ? -(v & 0x7fff) : v; };
    if (g.length < 200 || String.fromCharCode(g[0], g[1], g[2], g[3]) !== "GRIB" || g[7] !== 2) throw Error("not a GRIB2 message");
    if (g[6] !== 209) throw Error("not an MRMS (discipline 209) product");
    const sec = {};
    for (let o = 16; o + 5 <= g.length;) { if (g[o] === 55 && g[o + 1] === 55 && g[o + 2] === 55 && g[o + 3] === 55) break; const len = dv.getUint32(o); if (len < 5 || o + len > g.length) throw Error("truncated GRIB2"); if (sec[g[o + 4]] == null) sec[g[o + 4]] = o; o += len; }
    for (const n of [1, 3, 4, 5, 7]) if (sec[n] == null) throw Error("GRIB2 section " + n + " missing");
    const s1 = sec[1], s3 = sec[3], s4 = sec[4], s5 = sec[5], s7 = sec[7];
    if (dv.getUint16(s1 + 5) !== 161) throw Error("not from NCEP MRMS (centre 161)");
    if (g[s4 + 9] !== 6 || g[s4 + 10] !== 0) throw Error("not PrecipFlag (category 6, parameter 0)");
    if (dv.getUint16(s3 + 12) !== 0) throw Error("unexpected MRMS grid template");
    const w = dv.getUint32(s3 + 30), h = dv.getUint32(s3 + 34), la1 = s32(s3 + 46) / 1e6, lo1 = dv.getUint32(s3 + 50) / 1e6, di = dv.getUint32(s3 + 63) / 1e6, dj = dv.getUint32(s3 + 67) / 1e6, scanMode = g[s3 + 71];
    if (scanMode !== 0 || !(di > 0) || !(dj > 0)) throw Error("unexpected MRMS scanning mode");
    if (dv.getUint16(s5 + 9) !== 41 || g[s5 + 19] !== 8) throw Error("unexpected GRIB2 packing (expected 8-bit PNG, template 5.41)");
    const scaling = { R: dv.getFloat32(s5 + 11), E: s16(s5 + 15), D: s16(s5 + 17) };
    const scan = Date.UTC(dv.getUint16(s1 + 12), g[s1 + 14] - 1, g[s1 + 15], g[s1 + 16], g[s1 + 17], g[s1 + 18]);
    return { scan, width: w, height: h, scaling, png: g.subarray(s7 + 5, s7 + dv.getUint32(s7)), world: { dx: di, dy: -dj, firstLon: lo1 > 180 ? lo1 - 360 : lo1, firstLat: la1 } };
  }
  /* the snow ramp on the same dBZ bands as the rain legend, so the two bars line up */
  const snowLegend = () => STOPS.map(([v]) => { let c = SNOW_STOPS[0]; for (const s of SNOW_STOPS) if (v >= s[0]) c = s; return { dbz: v, rgba: `rgba(${c[1][0]},${c[1][1]},${c[1][2]},${(c[2] / 255).toFixed(3)})` }; });
  const legend = () => STOPS.map(([v, c, a]) => ({ dbz: v, rgba: `rgba(${c[0]},${c[1]},${c[2]},${(a / 255).toFixed(3)})` }));

  /* ---------- in the browser: a worker holds the grid and draws tiles; the page asks for tiles through the lcref:// protocol ---------- */
  function workerSource() {
    return `"use strict";
      const indexDbz = ${indexDbz.toString()}; const STOPS = ${JSON.stringify(STOPS)}; const THRESHOLD = ${THRESHOLD};
      ${dbzToRgba.toString()} ${palette.toString()} ${decodeIndexedPng.toString()} ${renderTile.toString()}
      const inflate = async (z) => new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
      let grid = null, lut = null;
      onmessage = async (e) => { const m = e.data;
        try {
          if (m.type === "load") { const t0 = performance.now(); const g = await decodeIndexedPng(new Uint8Array(m.png), inflate); grid = Object.assign(g, m.world); lut = palette(g.alpha, THRESHOLD);
            postMessage({ id: m.id, ok: true, decodeMs: Math.round(performance.now() - t0), width: g.width, height: g.height }); }
          else if (m.type === "tile") { if (!grid) throw Error("no radar grid yet"); const t0 = performance.now(); const rgba = renderTile(grid, lut, m.z, m.x, m.y);
            const c = new OffscreenCanvas(256, 256); c.getContext("2d").putImageData(new ImageData(rgba, 256, 256), 0, 0);
            const buf = await (await c.convertToBlob({ type: "image/png" })).arrayBuffer(); postMessage({ id: m.id, ok: true, png: buf, ms: performance.now() - t0 }, [buf]); }
        } catch (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
      };`;
  }
  /* the precipitation-type worker: holds the reflectivity grid and the PrecipFlag grid of the same minute, draws combined tiles */
  function ptypeWorkerSource() {
    return `"use strict";
      const indexDbz = ${indexDbz.toString()}; const STOPS = ${JSON.stringify(STOPS)}, SNOW_STOPS = ${JSON.stringify(SNOW_STOPS)}, THRESHOLD = ${THRESHOLD};
      const PTYPE = ${JSON.stringify(PTYPE)}, NO_PRECIP = ${NO_PRECIP}, NO_COVERAGE = ${NO_COVERAGE}, HATCH = ${JSON.stringify(HATCH)}, UNKNOWN = ${JSON.stringify(UNKNOWN)};
      const CLS_REFL = ${CLS_REFL}, CLS_NOCOV = ${CLS_NOCOV}, CLS_UNKNOWN = ${CLS_UNKNOWN}, CLS_SNOW = ${CLS_SNOW};
      const gribValue = ${gribValue.toString()};
      ${dbzToRgba.toString()} ${palette.toString()} ${snowPalette.toString()} ${ptypeClasses.toString()} ${parsePrecipFlag.toString()} ${decodeIndexedPng.toString()} ${renderPtypeTile.toString()}
      const unz = (kind) => async (z) => new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream(kind))).arrayBuffer());
      let ref = null, lut = null, snow = null, pf = null, cls = null, theme = "dark";
      const pat = () => ({ hatch: HATCH[theme === "light" ? "light" : "dark"] });
      onmessage = async (e) => { const m = e.data;
        try {
          if (m.type === "theme") { theme = m.theme; postMessage({ id: m.id, ok: true }); }
          else if (m.type === "load") { if (m.theme) theme = m.theme; const t0 = performance.now();
            const g = await decodeIndexedPng(new Uint8Array(m.png), unz("deflate")), f = parsePrecipFlag(await unz("gzip")(new Uint8Array(m.gz))), q = await decodeIndexedPng(f.png, unz("deflate"));
            const w = m.world, near = (a, b) => Math.abs(a - b) < 1e-6;
            if (g.width !== q.width || g.height !== q.height || !near(w.dx, f.world.dx) || !near(w.dy, f.world.dy) || !near(w.firstLon, f.world.firstLon) || !near(w.firstLat, f.world.firstLat)) throw Error("the reflectivity and precipitation-type grids don't match");
            ref = Object.assign(g, w); lut = palette(g.alpha, THRESHOLD); snow = snowPalette(g.alpha, THRESHOLD); pf = q; cls = ptypeClasses(f.scaling);
            const counts = new Uint32Array(256); for (const v of q.indices) counts[v]++;
            const codes = {}; for (let i = 0; i < 256; i++) if (counts[i]) codes[gribValue(i, f.scaling)] = counts[i];
            postMessage({ id: m.id, ok: true, pfScan: f.scan, decodeMs: Math.round(performance.now() - t0), width: g.width, height: g.height, codes }); }
          else if (m.type === "tile") { if (!ref) throw Error("no radar grid yet"); const t0 = performance.now(); const rgba = renderPtypeTile(ref, lut, snow, pf, cls, m.z, m.x, m.y, 256, pat());
            const c = new OffscreenCanvas(256, 256); c.getContext("2d").putImageData(new ImageData(rgba, 256, 256), 0, 0);
            const buf = await (await c.convertToBlob({ type: "image/png" })).arrayBuffer(); postMessage({ id: m.id, ok: true, png: buf, ms: performance.now() - t0 }, [buf]); }
        } catch (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
      };`;
  }
  /* precipitation type: IEM's reflectivity scan (as Reflectivity mode reads it), then the PrecipFlag file of that same minute
     through our forwarder (base ".../api/mrms"). If NOAA has no PrecipFlag for that minute, refresh() fails with
     unaligned: true and the page shows the labelled reflectivity fallback. */
  function createPtypeClient(opts = {}) {
    const base = String(opts.base || "").replace(/\/$/, "");
    const fetchFn = opts.fetch || ((u) => fetch(u, { cache: "no-store", signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || 15000) : undefined }));
    const state = { scan: null, pfScan: null, checkedAt: null, error: null, unaligned: false, bytes: null, pfBytes: null, downloadMs: null, decodeMs: null, size: null, codes: null, unknown: [], tileMs: [], loads: 0, turnovers: 0, theme: opts.theme === "light" ? "light" : "dark" };
    let worker = null, seq = 0, pending = new Map(), loading = null;
    const call = (msg, transfer) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }, transfer || []); });
    function ensureWorker() { if (worker) return; const url = URL.createObjectURL(new Blob([ptypeWorkerSource()], { type: "text/javascript" })); worker = new Worker(url);
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(Error(e.data.error)); }; }
    const get = async (ext) => { const r = await fetchFn(BASE + "." + ext); if (!r.ok) throw Error("IEM MRMS " + ext + " HTTP " + r.status); return r; };
    async function refresh() {
      if (!base) throw Error("no MRMS forwarder on this host");
      if (loading) return loading;
      loading = (async () => {
        let scan = parseMeta(await (await get("json")).json()), png, wld, t0; state.checkedAt = Date.now();
        if (state.scan === scan && !state.unaligned) return false;
        for (let attempt = 0; ; attempt++) { // a new IEM scan published mid-download is fetched straight away (as in Reflectivity)
          t0 = performance.now(); [png, wld] = await Promise.all([get("png").then((r) => r.arrayBuffer()), get("wld").then((r) => r.text())]);
          const after = parseMeta(await (await get("json")).json()); if (after === scan) break;
          if (attempt >= 2) throw Error("the MRMS scan kept changing during download; next refresh will retry");
          scan = after; state.turnovers++;
        }
        const r = await fetchFn(base + "/precipflag/at/" + pfStamp(scan));
        if (r.status === 404) { state.unaligned = true; const e = Error("no precipitation-type scan for the radar scan of " + new Date(scan).toISOString().slice(11, 16) + " UTC yet"); e.unaligned = true; throw e; }
        if (!r.ok) throw Error("MRMS precipitation type HTTP " + r.status);
        const gz = await r.arrayBuffer(); state.downloadMs = Math.round(performance.now() - t0); state.bytes = png.byteLength; state.pfBytes = gz.byteLength;
        ensureWorker(); const d = await call({ type: "load", png, world: parseWorldFile(wld), gz, theme: state.theme }, [png, gz]);
        if (d.pfScan !== scan) { state.unaligned = true; throw Error("precipitation-type scan " + new Date(d.pfScan).toISOString() + " doesn't match the radar scan " + new Date(scan).toISOString()); }
        const known = new Set([0, -3, ...PTYPE.map((c) => c[0])]);
        Object.assign(state, { scan, pfScan: d.pfScan, unaligned: false, decodeMs: d.decodeMs, size: d.width + "x" + d.height, codes: d.codes, unknown: Object.keys(d.codes).map(Number).filter((c) => !known.has(c)), error: null }); state.loads++;
        return true;
      })().catch((e) => { state.error = e.message; throw e; }).finally(() => { loading = null; });
      return loading;
    }
    async function tile(params) {
      const m = /ptype:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url); if (!m) throw Error("bad precipitation-type tile URL");
      const r = await call({ type: "tile", z: +m[1], x: +m[2], y: +m[3] }); state.tileMs.push(r.ms); if (state.tileMs.length > 200) state.tileMs.shift();
      return { data: r.png };
    }
    function dispose() { if (worker) { worker.terminate(); worker = null; } for (const p of pending.values()) p.rej(Error("stopped")); pending.clear(); state.scan = null; }
    /* the no-coverage stripes follow the basemap theme; a new theme is a new tile URL, so the map redraws */
    async function setTheme(th) { th = th === "light" ? "light" : "dark"; if (th === state.theme) return false; state.theme = th; if (worker) await call({ type: "theme", theme: th }); return true; }
    return { state, refresh, tile, dispose, setTheme, tileUrl: () => "ptype://{z}/{x}/{y}?t=" + state.scan + "&th=" + state.theme };
  }
  function createClient(opts = {}) {
    /* 15 s per request, as Predictable (source.ts AbortSignal.timeout(15_000)): a slow IEM falls back to NOAA's tiles and retries next minute */
    const fetchFn = opts.fetch || ((u) => fetch(u, { cache: "no-store", signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || 15000) : undefined }));
    const state = { scan: null, checkedAt: null, error: null, bytes: null, downloadMs: null, decodeMs: null, size: null, tileMs: [], loads: 0 };
    let worker = null, seq = 0, pending = new Map(), loading = null;
    const call = (msg, transfer) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }, transfer || []); });
    function ensureWorker() { if (worker) return; const url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" })); worker = new Worker(url);
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(Error(e.data.error)); }; }
    const get = async (ext) => { const r = await fetchFn(BASE + "." + ext); if (!r.ok) throw Error("IEM MRMS " + ext + " HTTP " + r.status); return r; };
    /* read the scan time; when it is new, download, confirm it didn't turn over mid-download, and decode */
    async function refresh() {
      if (loading) return loading;
      loading = (async () => {
        /* IEM publishes a new scan about every 2 minutes; if one lands while we download, download the new one straight away
           (up to twice) rather than failing, which on a first load would have meant NOAA's fallback tiles for a minute */
        let scan = parseMeta(await (await get("json")).json()), png, wld, t0; state.checkedAt = Date.now();
        if (state.scan === scan) return false;
        for (let attempt = 0; ; attempt++) {
          t0 = performance.now(); [png, wld] = await Promise.all([get("png").then((r) => r.arrayBuffer()), get("wld").then((r) => r.text())]);
          const after = parseMeta(await (await get("json")).json()); if (after === scan) break;
          if (attempt >= 2) throw Error("the MRMS scan kept changing during download; next refresh will retry");
          scan = after; state.turnovers = (state.turnovers || 0) + 1;
        }
        state.downloadMs = Math.round(performance.now() - t0); state.bytes = png.byteLength;
        ensureWorker(); const r = await call({ type: "load", png, world: parseWorldFile(wld) }, [png]);
        Object.assign(state, { scan, decodeMs: r.decodeMs, size: r.width + "x" + r.height, error: null }); state.loads++;
        return true;
      })().catch((e) => { state.error = e.message; throw e; }).finally(() => { loading = null; });
      return loading;
    }
    /* MapLibre protocol: lcref://{z}/{x}/{y}?t=<scan> */
    async function tile(params) {
      const m = /lcref:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url); if (!m) throw Error("bad radar tile URL");
      const r = await call({ type: "tile", z: +m[1], x: +m[2], y: +m[3] }); state.tileMs.push(r.ms); if (state.tileMs.length > 200) state.tileMs.shift();
      return { data: r.png };
    }
    function dispose() { if (worker) { worker.terminate(); worker = null; } for (const p of pending.values()) p.rej(Error("stopped")); pending.clear(); state.scan = null; }
    return { state, refresh, tile, dispose, tileUrl: () => "lcref://{z}/{x}/{y}?t=" + state.scan };
  }
  return { BASE, STOPS, THRESHOLD, OPACITY, dbzToRgba, indexDbz, palette, parseWorldFile, parseMeta, decodeIndexedPng, renderTile, legend, createClient,
    PTYPE, NO_PRECIP, NO_COVERAGE, SNOW_STOPS, HATCH, UNKNOWN, PTYPE_URL, gribValue, ptypeClasses, snowPalette, renderPtypeTile, pfStamp, parsePrecipFlag, snowLegend, createPtypeClient };
});
