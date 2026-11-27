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
  /* hatch (precipitation type only): {on: Uint8Array(256), c: [r,g,b,a]}; those pixels get thin diagonal stripes, continuous across tiles */
  function renderTile(grid, lut, z, x, y, size = 256, hatch = null) {
    const rgba = new Uint8ClampedArray(size * size * 4), n = 2 ** z, cols = new Int32Array(size);
    for (let px = 0; px < size; px++) { const lon = (x + (px + 0.5) / size) / n * 360 - 180; cols[px] = Math.round((lon - grid.firstLon) / grid.dx); }
    for (let py = 0; py < size; py++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / size) / n))) * 180 / Math.PI, row = Math.round((lat - grid.firstLat) / grid.dy);
      if (row < 0 || row >= grid.height) continue;
      for (let px = 0; px < size; px++) { const col = cols[px]; if (col < 0 || col >= grid.width) continue; const v = grid.indices[row * grid.width + col], k = v * 4;
        if (hatch && hatch.on[v]) { if (((x * size + px) + (y * size + py)) % 9 < 2) { const d = (py * size + px) * 4; rgba[d] = hatch.c[0]; rgba[d + 1] = hatch.c[1]; rgba[d + 2] = hatch.c[2]; rgba[d + 3] = hatch.c[3]; } continue; }
        if (!lut[k + 3]) continue;
        const d = (py * size + px) * 4; rgba[d] = lut[k]; rgba[d + 1] = lut[k + 1]; rgba[d + 2] = lut[k + 2]; rgba[d + 3] = lut[k + 3]; }
    }
    return rgba;
  }
  /* ---------- precipitation type: MRMS PrecipFlag (NOAA/NSSL), a numeric category per 1 km pixel ----------
     Codes as NOAA documents them; only these are drawn. 0 (no precipitation) is transparent; -3 (no radar coverage) is a light
     hatch, so "outside coverage" never looks like "dry". The product has no sleet or freezing-rain category. Colours are ours. */
  const PTYPE = [
    [1, "Warm stratiform rain", [35, 190, 75]], [10, "Cool stratiform rain", [0, 150, 140]], [6, "Convective rain", [245, 200, 20]],
    [7, "Rain with hail", [225, 30, 150]], [3, "Snow", [60, 140, 255]], [91, "Tropical/stratiform rain mix", [150, 215, 40]], [96, "Tropical/convective rain mix", [255, 130, 30]]];
  const PTYPE_ALPHA = 235, NO_PRECIP = 0, NO_COVERAGE = -3, HATCH = [150, 150, 150, 120];
  const PTYPE_URL = "https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz";
  /* GRIB2 simple scaling: value = (R + X * 2^E) / 10^D */
  const gribValue = (x, p) => Math.round((p.R + x * 2 ** p.E) / 10 ** p.D);
  function ptypePalette(p) {
    const lut = new Uint8Array(256 * 4), hatch = { on: new Uint8Array(256), c: HATCH }, byCode = new Map(PTYPE.map((c) => [c[0], c[2]]));
    for (let i = 0; i < 256; i++) { const v = gribValue(i, p); if (v === NO_COVERAGE) { hatch.on[i] = 1; continue; } const c = byCode.get(v); if (!c) continue;
      lut[i * 4] = c[0]; lut[i * 4 + 1] = c[1]; lut[i * 4 + 2] = c[2]; lut[i * 4 + 3] = PTYPE_ALPHA; }
    return { lut, hatch };
  }
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
  const ptypeLegend = () => PTYPE.map(([code, label, c]) => ({ code, label, rgba: `rgba(${c[0]},${c[1]},${c[2]},${(PTYPE_ALPHA / 255).toFixed(3)})` }));
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
  /* the precipitation-type worker: gunzip the GRIB2 file, check it, decode its PNG, draw tiles with the category colours */
  function ptypeWorkerSource() {
    return `"use strict";
      const PTYPE = ${JSON.stringify(PTYPE)}, PTYPE_ALPHA = ${PTYPE_ALPHA}, NO_COVERAGE = ${NO_COVERAGE}, HATCH = ${JSON.stringify(HATCH)};
      const gribValue = ${gribValue.toString()};
      ${ptypePalette.toString()} ${parsePrecipFlag.toString()} ${decodeIndexedPng.toString()} ${renderTile.toString()}
      const unz = (kind) => async (z) => new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream(kind))).arrayBuffer());
      let grid = null, pal = null;
      onmessage = async (e) => { const m = e.data;
        try {
          if (m.type === "load") { const t0 = performance.now(); const f = parsePrecipFlag(await unz("gzip")(new Uint8Array(m.gz))); const g = await decodeIndexedPng(f.png, unz("deflate"));
            if (g.width !== f.width || g.height !== f.height) throw Error("PrecipFlag image size does not match its grid");
            grid = Object.assign(g, f.world); pal = ptypePalette(f.scaling);
            const counts = {}; for (let i = 0; i < 256; i++) counts[i] = 0; for (const v of g.indices) counts[v]++;
            const codes = {}; for (let i = 0; i < 256; i++) if (counts[i]) codes[gribValue(i, f.scaling)] = counts[i];
            postMessage({ id: m.id, ok: true, scan: f.scan, decodeMs: Math.round(performance.now() - t0), width: g.width, height: g.height, codes }); }
          else if (m.type === "tile") { if (!grid) throw Error("no precipitation-type grid yet"); const t0 = performance.now(); const rgba = renderTile(grid, pal.lut, m.z, m.x, m.y, 256, pal.hatch);
            const c = new OffscreenCanvas(256, 256); c.getContext("2d").putImageData(new ImageData(rgba, 256, 256), 0, 0);
            const buf = await (await c.convertToBlob({ type: "image/png" })).arrayBuffer(); postMessage({ id: m.id, ok: true, png: buf, ms: performance.now() - t0 }, [buf]); }
        } catch (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
      };`;
  }
  /* precipitation type through our same-origin forwarder (functions/api/mrms): the scan time every 60 s (about 100 bytes), the
     grid (about 230 KB) only for a new scan. base: ".../api/mrms" */
  function createPtypeClient(opts = {}) {
    const base = String(opts.base || "").replace(/\/$/, "");
    const fetchFn = opts.fetch || ((u) => fetch(u, { cache: "no-store", signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || 15000) : undefined }));
    const state = { scan: null, checkedAt: null, error: null, bytes: null, downloadMs: null, decodeMs: null, size: null, codes: null, unknown: [], tileMs: [], loads: 0 };
    let worker = null, seq = 0, pending = new Map(), loading = null;
    const call = (msg, transfer) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }, transfer || []); });
    function ensureWorker() { if (worker) return; const url = URL.createObjectURL(new Blob([ptypeWorkerSource()], { type: "text/javascript" })); worker = new Worker(url);
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(Error(e.data.error)); }; }
    async function refresh() {
      if (!base) throw Error("no MRMS forwarder on this host");
      if (loading) return loading;
      loading = (async () => {
        const r = await fetchFn(base + "/precipflag/time"); if (!r.ok) throw Error("MRMS precipitation type HTTP " + r.status);
        const j = await r.json(), listed = Date.parse(j && j.scan); if (!j || j.product !== "PrecipFlag" || !Number.isFinite(listed)) throw Error("unexpected MRMS precipitation-type answer");
        state.checkedAt = Date.now(); if (state.scan === listed) return false;
        const t0 = performance.now(), g = await fetchFn(base + "/precipflag/latest"); if (!g.ok) throw Error("MRMS precipitation type HTTP " + g.status);
        const gz = await g.arrayBuffer(); state.downloadMs = Math.round(performance.now() - t0); state.bytes = gz.byteLength;
        ensureWorker(); const d = await call({ type: "load", gz }, [gz]);
        const known = new Set([0, -3, ...PTYPE.map((c) => c[0])]);
        Object.assign(state, { scan: d.scan, decodeMs: d.decodeMs, size: d.width + "x" + d.height, codes: d.codes, unknown: Object.keys(d.codes).map(Number).filter((c) => !known.has(c)), error: null }); state.loads++;
        return true; // the scan time is the one inside the file, so a turnover between /time and /latest is never mislabelled
      })().catch((e) => { state.error = e.message; throw e; }).finally(() => { loading = null; });
      return loading;
    }
    async function tile(params) {
      const m = /ptype:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url); if (!m) throw Error("bad precipitation-type tile URL");
      const r = await call({ type: "tile", z: +m[1], x: +m[2], y: +m[3] }); state.tileMs.push(r.ms); if (state.tileMs.length > 200) state.tileMs.shift();
      return { data: r.png };
    }
    function dispose() { if (worker) { worker.terminate(); worker = null; } for (const p of pending.values()) p.rej(Error("stopped")); pending.clear(); state.scan = null; }
    return { state, refresh, tile, dispose, tileUrl: () => "ptype://{z}/{x}/{y}?t=" + state.scan };
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
        const scan = parseMeta(await (await get("json")).json()); state.checkedAt = Date.now();
        if (state.scan === scan) return false;
        const t0 = performance.now(), [png, wld] = await Promise.all([get("png").then((r) => r.arrayBuffer()), get("wld").then((r) => r.text())]);
        if (parseMeta(await (await get("json")).json()) !== scan) throw Error("the MRMS scan changed during download; next refresh will retry");
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
    PTYPE, PTYPE_ALPHA, NO_PRECIP, NO_COVERAGE, HATCH, PTYPE_URL, gribValue, ptypePalette, parsePrecipFlag, ptypeLegend, createPtypeClient };
});
