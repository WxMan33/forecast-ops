/* Radar reflectivity drawn from measured values, matching Predictable's MRMS view (heads-up a6a83c1: lib/mrms.ts,
   lib/mrmsComposite/{source,indexedPng,render}.ts, lib/level3/colorTable.ts):
     source: Iowa Environmental Mesonet's MRMS lowest-elevation composite reflectivity (lcref), a 0.01-degree indexed PNG whose
       pixel values are the measured values (dBZ = index * 0.5 - 32), its world file and a JSON with the scan time;
       https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=4. IEM allows browsers to read it (Access-Control-Allow-Origin: *),
       so the browser reads it directly: no server of ours in between.
     colours: the "Reflectivity 2026" table, below 5 dBZ transparent, each band with its own transparency; nearest-neighbour
       sampling into map tiles; the layer at 85% opacity by default.
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
  const THRESHOLD = 5, OPACITY = 0.85;
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
  /* an 8-bit indexed PNG (colour type 3, no interlace) -> its indices and per-index alpha; inflate is injected (zlib) */
  async function decodeIndexedPng(bytes, inflate) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]; for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw Error("not a PNG");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [], alpha = new Uint8Array(256).fill(255);
    let w = 0, h = 0, ended = false, total = 0;
    for (let o = 8; o + 12 <= bytes.length;) {
      const len = dv.getUint32(o), type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]), c = bytes.subarray(o + 8, o + 8 + len);
      if (o + len + 12 > bytes.length) throw Error("truncated PNG");
      if (type === "IHDR") { if (len !== 13 || c[8] !== 8 || c[9] !== 3 || c[10] || c[11] || c[12]) throw Error("unsupported PNG encoding (expected 8-bit indexed)"); w = dv.getUint32(o + 8); h = dv.getUint32(o + 12); if (!w || !h || w * h > 40e6) throw Error("invalid grid size"); }
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
  function renderTile(grid, lut, z, x, y, size = 256) {
    const rgba = new Uint8ClampedArray(size * size * 4), n = 2 ** z, cols = new Int32Array(size);
    for (let px = 0; px < size; px++) { const lon = (x + (px + 0.5) / size) / n * 360 - 180; cols[px] = Math.round((lon - grid.firstLon) / grid.dx); }
    for (let py = 0; py < size; py++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / size) / n))) * 180 / Math.PI, row = Math.round((lat - grid.firstLat) / grid.dy);
      if (row < 0 || row >= grid.height) continue;
      for (let px = 0; px < size; px++) { const col = cols[px]; if (col < 0 || col >= grid.width) continue; const k = grid.indices[row * grid.width + col] * 4; if (!lut[k + 3]) continue;
        const d = (py * size + px) * 4; rgba[d] = lut[k]; rgba[d + 1] = lut[k + 1]; rgba[d + 2] = lut[k + 2]; rgba[d + 3] = lut[k + 3]; }
    }
    return rgba;
  }
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
  function createClient(opts = {}) {
    const fetchFn = opts.fetch || ((u) => fetch(u, { cache: "no-store" }));
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
    return { state, refresh, tile, tileUrl: () => "lcref://{z}/{x}/{y}?t=" + state.scan };
  }
  return { BASE, STOPS, THRESHOLD, OPACITY, dbzToRgba, indexDbz, palette, parseWorldFile, parseMeta, decodeIndexedPng, renderTile, legend, createClient };
});
