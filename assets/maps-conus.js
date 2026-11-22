/* Model maps: full-CONUS HRRR beta (maps.html?domain=conus). A separate viewer from the Tri-State maps.
   Data: forecast-ops-maps conus-v1 tiles (see maps-conus-core.js). Drawing: a custom MapLibre WebGL layer
   samples the native grid from a texture with nearest-cell lookup, on a mesh whose nodes sit at exact
   projected cell edges, so every model cell is drawn where HRRR put it; outside the grid nothing is drawn.
   Only the tiles in view are downloaded, at the coarsest level that still shows at least one cell per
   ~2 screen pixels; every click reads the native cell at full precision. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, esc = O.esc, MC = window.MapsCore, K = window.MapsConusCore, ML = window.maplibregl;
  const TZ = "America/New_York", H = 3600e3, Q = new URLSearchParams(location.search);
  const DATA = (Q.get("data") || "https://wxman33.github.io/forecast-ops-maps/data").replace(/\/$/, "");
  const SITE = DATA.replace(/\/data$/, "");
  const PHONE = () => innerWidth < 700;
  const EMBED = Q.get("embed") === "1", PANEL = EMBED ? (Q.get("panel") || "") : "";   // a panel of the cycle comparison (compare=1 page)
  /* Fields: labels, units and Forecast Ops' own stepped colour scales. Below the lowest step nothing is drawn. */
  const stepped = (stops, alpha = 215) => (v) => { if (v == null || !Number.isFinite(v) || v < stops[0][0]) return null; let c = stops[0][1]; for (const [t, rgb] of stops) if (v >= t) c = rgb; return [...c, alpha]; };
  const SNOW1H = [[0.1, [196, 222, 240]], [0.25, [140, 190, 228]], [0.5, [86, 150, 214]], [1, [52, 102, 190]], [1.5, [92, 72, 172]], [2, [146, 64, 168]], [3, [204, 78, 160]], [4, [236, 140, 190]]];
  const SNOWRUN = [[0.1, [214, 232, 244]], [1, [168, 206, 236]], [2, [118, 170, 222]], [3, [72, 132, 204]], [4, [44, 94, 176]], [6, [70, 64, 160]], [8, [118, 58, 160]], [12, [170, 64, 160]], [18, [214, 96, 168]], [24, [240, 160, 200]], [36, [250, 214, 232]]];
  /* Forecast Ops' own scales for the CONUS viewer (not ColorBrewer, not a vendor table): greens for light amounts, blues for
     moderate, purples and warm tones for heavy; reflectivity keeps the conventional light-blue / green / yellow / red order. */
  const PRECIP = [[0.01, [190, 228, 196]], [0.05, [128, 200, 150]], [0.10, [62, 166, 112]], [0.25, [24, 124, 86]], [0.50, [58, 138, 196]], [0.75, [42, 82, 168]],
    [1.00, [104, 52, 160]], [1.50, [168, 52, 150]], [2.00, [226, 92, 150]], [3.00, [244, 150, 120]], [4.00, [250, 200, 110]]];
  const REFC = [[5, [160, 204, 228]], [15, [96, 164, 214]], [20, [52, 170, 104]], [25, [28, 140, 72]], [30, [18, 108, 52]], [35, [228, 208, 60]], [40, [232, 162, 46]],
    [45, [222, 104, 40]], [50, [198, 36, 36]], [55, [150, 20, 70]], [60, [176, 80, 176]], [65, [230, 200, 240]]];
  const PTYPE = { 1: ["Rain", [62, 168, 96]], 2: ["Snow", [72, 132, 228]], 3: ["Ice pellets", [232, 150, 44]], 4: ["Freezing rain", [214, 64, 150]] };
  const FIELDS = {
    t2m: { label: "2-m temperature", units: "°F", dec: 1, color: (v) => MC.color("t2m", v), range: [-20, 120],
      legend: { stops: MC.SCALES.t2m.stops, ticks: [-10, 0, 10, 20, 32, 40, 50, 60, 70, 80, 90, 100, 110] } },
    refc: { label: "Composite reflectivity (simulated)", short: "Sim. composite reflectivity", units: "dBZ", dec: 1, color: stepped(REFC), range: [-20, 80], steps: REFC,
      note: "Model-simulated reflectivity, not radar." },
    ptype: { label: "Precipitation type", units: "", dec: 0, cat: PTYPE, range: [0, 5],
      color: (v) => { const c = PTYPE[Math.round(v)]; return c ? [...c[1], 225] : null; },
      note: "Where the model is precipitating at the valid time. Several types at once: freezing rain > ice pellets > snow > rain." },
    apcp1h: { label: "1-h precipitation", units: "in", dec: 2, color: stepped(PRECIP), range: [0, 8], steps: PRECIP, window: 1 },
    apcp_run: { label: "Total precipitation since run start", short: "Run-total precipitation", units: "in", dec: 2, color: stepped(PRECIP), range: [0, 30], steps: PRECIP, window: "run" },
    asnow1h: { label: "1-h snowfall (HRRR)", units: "in", dec: 1, color: stepped(SNOW1H), range: [0, 8], steps: SNOW1H, window: 1,
      note: "HRRR's own snowfall (variable snow density), not 10:1. Hourly values are the difference of the run totals." },
    asnow_run: { label: "Total snowfall since run start (HRRR)", short: "Run-total snowfall", units: "in", dec: 1, color: stepped(SNOWRUN), range: [0, 60], steps: SNOWRUN, window: "run",
      note: "HRRR's own snowfall (variable snow density), not 10:1." },
  };
  /* this hour of this field: published, missing, or not applicable (e.g. accumulations at F00) */
  const hourRec = (fh) => (st.man && st.man.fields[st.field] ? st.man.fields[st.field].hours[String(fh)] : undefined);
  const hourState = (fh) => { const r = hourRec(fh); return !st.man.fields[st.field] ? "absent" : r == null ? "missing" : r.notApplicable ? "na" : "ok"; };
  const st = { index: null, run: null, man: null, field: "t2m", h: 0, level: null, tiles: new Map(), bytes: 0, loadedBytes: 0, play: null, sel: null, map: null, P: null, mesh: null, want: null };
  const fmtLocal = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" });
  const fmtUTC = (ms) => { const d = new Date(ms).toISOString(); return `${d.slice(11, 13)}Z ${new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}`; };
  const MB = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  const fetchT = (url, ms = 30000, headers) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal, ...(headers ? { headers } : {}) }).finally(() => clearTimeout(t)); };
  const getJSON = async (u) => { const r = await fetchT(u + (u.includes("?") ? "&" : "?") + "t=" + Math.floor(Date.now() / 60000), 20000); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  async function gunzip(u) {
    if (typeof DecompressionStream !== "function") throw new Error("this browser cannot decompress the map data");
    const r = await fetchT(u, 45000); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const n = +r.headers.get("content-length") || 0; st.loadedBytes += n;
    return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }

  /* ---------- tiles: fetch, decode, cache (least recently used, by decoded bytes) ---------- */
  const CACHE_LIMIT = () => (PHONE() ? 48e6 : 160e6);
  const key = (fh, L, tx, ty) => `${st.run.id}|${st.field}|${fh}|${K.tileName(L, tx, ty)}`;
  st.requests = 0;
  function remember(k, e) {
    st.tiles.set(k, e); st.bytes += e.size;
    while (st.bytes > CACHE_LIMIT() && st.tiles.size > 1) { const [k0, e0] = st.tiles.entries().next().value; if (k0 === k) break; st.tiles.delete(k0); st.bytes -= e0.size; }
  }
  const gunzipBytes = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  /* the tiles of one level and hour; packed runs fetch neighbouring tiles with one HTTP range request */
  function tiles(fh, L, list) {
    const out = list.map(([tx, ty]) => { const k = key(fh, L, tx, ty); if (st.tiles.has(k)) { const e = st.tiles.get(k); st.tiles.delete(k); st.tiles.set(k, e); return null; } return [tx, ty, k]; }).filter(Boolean);
    if (out.length) {
      if (st.man.layout !== "packed") out.forEach(([tx, ty, k]) => {
        const d = K.tileDims(st.man, L, tx, ty), url = `${SITE}/${st.run.path}/${st.field}/f${String(fh).padStart(2, "0")}/${K.tileName(L, tx, ty)}`, e = { t: null, size: d.nx * d.ny * 2 };
        st.requests++; e.p = gunzip(url).then((raw) => (e.t = K.decodeTile(raw, d.ny, d.nx))); e.p.catch(() => st.tiles.get(k) === e && st.tiles.delete(k)); remember(k, e); });
      else {
        const rec = st.man.fields[st.field].hours[String(fh)], ix = rec ? (rec.ix || (rec.ix = K.packIndex(st.man, rec))) : null, byName = {};
        out.forEach(([tx, ty, k]) => { const d = K.tileDims(st.man, L, tx, ty), e = { t: null, size: d.nx * d.ny * 2 }; e.p = new Promise((ok, no) => { e.ok = ok; e.no = no; });
          e.p.catch(() => st.tiles.get(k) === e && st.tiles.delete(k)); remember(k, e); byName[K.tileName(L, tx, ty)] = { e, d }; });
        if (!ix) Object.values(byName).forEach(({ e }) => e.no(new Error("hour not published")));
        else K.packRanges(ix, Object.keys(byName)).forEach(async (r) => {
          try {
            st.requests++;
            const res = await fetchT(`${SITE}/${st.run.path}/${rec.pack.file}`, 45000, { Range: `bytes=${r.start}-${r.end - 1}` });
            if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
            const buf = new Uint8Array(await res.arrayBuffer()), base = res.status === 200 ? 0 : r.start; st.loadedBytes += buf.length;
            if (res.status === 200 && buf.length !== rec.pack.bytes) throw new Error("server ignored the range request");
            await Promise.all(r.tiles.map(async (x) => { const { e, d } = byName[x.name]; try { e.t = K.decodeTile(await gunzipBytes(buf.subarray(x.off - base, x.off - base + x.len)), d.ny, d.nx); e.ok(e.t); } catch (err) { e.no(err); } }));
          } catch (err) { r.tiles.forEach((x) => byName[x.name].e.no(err)); }
        });
      }
    }
    return list.map(([tx, ty]) => st.tiles.get(key(fh, L, tx, ty)).p);
  }
  const tile = (fh, L, tx, ty) => tiles(fh, L, [[tx, ty]])[0];
  const ready = (fh, L, tx, ty) => { const e = st.tiles.get(key(fh, L, tx, ty)); return e && e.t; };

  /* ---------- what the view needs ---------- */
  function viewCells() {
    const m = st.map, c = m.getContainer(), w = c.clientWidth, h = c.clientHeight, pts = [];
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) { const ll = m.unproject([(a / 4) * w, (b / 4) * h]), g = st.P.toCell(ll.lat, ll.lng); pts.push(g); }
    const is = pts.map((p) => p[0]), js = pts.map((p) => p[1]), g = st.man.grid;
    return [Math.max(0, Math.floor(Math.min(...is)) - 2), Math.min(g.nx - 1, Math.ceil(Math.max(...is)) + 2), Math.max(0, Math.floor(Math.min(...js)) - 2), Math.min(g.ny - 1, Math.ceil(Math.max(...js)) + 2)];
  }
  function cellPx() {
    const m = st.map, c = m.getCenter(), mpp = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** m.getZoom();
    return (st.man.grid.DxInMetres / mpp) * (window.devicePixelRatio || 1);
  }
  function wanted() {
    const L = K.levelFor(cellPx(), st.man.levels), coarse = Math.max(...st.man.levels.map((l) => l.level)), [i0, i1, j0, j1] = viewCells();
    return { L, coarse, tiles: K.tilesFor(st.man, L, i0, i1, j0, j1), all: K.tilesFor(st.man, coarse, 0, st.man.grid.nx, 0, st.man.grid.ny) };
  }
  const fhNow = () => st.man.hours[st.h];
  /* load what the current hour needs; the coarsest level always covers the whole grid under the detail */
  async function need(fh, w = wanted()) {
    const jobs = tiles(fh, w.coarse, w.all);
    if (w.L !== w.coarse) jobs.push(...tiles(fh, w.L, w.tiles));
    return Promise.allSettled(jobs);
  }

  /* ---------- GPU layer ---------- */
  const VS = `attribute vec2 a_pos; attribute vec2 a_g; uniform mat4 u_matrix; varying vec2 v_g;
    void main(){ v_g=a_g; gl_Position=u_matrix*vec4(a_pos,0.0,1.0); }`;
  const FS = `precision highp float; uniform sampler2D u_tex; uniform sampler2D u_cmap; uniform vec2 u_size; uniform float u_every; uniform float u_scale; uniform vec2 u_lut; uniform float u_op; varying vec2 v_g;
    void main(){
      vec2 t = floor(v_g / u_every);
      if (t.x < 0.0 || t.y < 0.0 || t.x >= u_size.x || t.y >= u_size.y) discard;
      vec4 s = texture2D(u_tex, (t + 0.5) / u_size);
      float st = floor(s.r * 255.0 + 0.5) + 256.0 * floor(s.a * 255.0 + 0.5);
      if (st >= 32768.0) st -= 65536.0;
      if (st < -32767.5) discard;
      float u = (st * u_scale - u_lut.x) / (u_lut.y - u_lut.x);
      vec4 c = texture2D(u_cmap, vec2(clamp(u, 0.0, 1.0), 0.5));
      if (c.a < 0.01) discard;
      gl_FragColor = vec4(c.rgb * u_op, u_op); }`;
  const layer = {
    id: "hrrr", type: "custom", renderingMode: "2d",
    onAdd(map, gl) {
      this.gl = gl; const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p); this.p = p;
      this.loc = Object.fromEntries(["a_pos", "a_g"].map((n) => [n, gl.getAttribLocation(p, n)]).concat(["u_matrix", "u_tex", "u_cmap", "u_size", "u_every", "u_scale", "u_lut", "u_op"].map((n) => [n, gl.getUniformLocation(p, n)])));
      this.buf = { pos: gl.createBuffer(), g: gl.createBuffer(), idx: gl.createBuffer() }; this.cmap = gl.createTexture(); this.tex = {}; this.count = 0;
      this.uint = !!(gl instanceof WebGL2RenderingContext || gl.getExtension("OES_element_index_uint"));
    },
    setMesh(m) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.g); gl.bufferData(gl.ARRAY_BUFFER, m.g, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.uint ? m.idx : new Uint16Array(m.idx), gl.STATIC_DRAW); this.count = m.count; },
    setColors(rgba) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.cmap); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rgba.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((f) => gl.texParameteri(gl.TEXTURE_2D, f, gl.NEAREST)); [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((f) => gl.texParameteri(gl.TEXTURE_2D, f, gl.CLAMP_TO_EDGE)); },
    /* one texture per level, the size of that whole level; each slot remembers which hour's tile it holds */
    level(L) {
      const gl = this.gl, lv = K.levelInfo(st.man, L), k = `${st.run.id}|${st.field}|${L}`; // a texture holds one field: switching field starts clean
      if (this.tex[L] && this.tex[L].k === k) return this.tex[L];
      if (this.tex[L]) gl.deleteTexture(this.tex[L].t);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const empty = new Uint8Array(lv.nx * lv.ny * 2); for (let q = 1; q < empty.length; q += 2) empty[q] = 0x80; // -32768: nothing drawn
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, lv.nx, lv.ny, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, empty);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((f) => gl.texParameteri(gl.TEXTURE_2D, f, gl.NEAREST)); [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((f) => gl.texParameteri(gl.TEXTURE_2D, f, gl.CLAMP_TO_EDGE));
      return (this.tex[L] = { t, k, lv, slots: {} });
    },
    /* make the level texture show hour fh: upload ready tiles, blank slots holding another hour */
    show(L, fh, tiles) {
      const gl = this.gl, T = this.level(L), S = st.man.tile; gl.bindTexture(gl.TEXTURE_2D, T.t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const want = new Set(tiles.map(([x, y]) => `${x}_${y}`)); let shown = 0;
      Object.keys(T.slots).forEach((s) => { if (T.slots[s] !== fh || !want.has(s)) { const [x, y] = s.split("_").map(Number), d = K.tileDims(st.man, L, x, y), e = new Uint8Array(d.nx * d.ny * 2); for (let q = 1; q < e.length; q += 2) e[q] = 0x80;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x * S, y * S, d.nx, d.ny, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, e); delete T.slots[s]; } });
      tiles.forEach(([x, y]) => { const s = `${x}_${y}`, t = ready(fh, L, x, y); if (!t) return; shown++; if (T.slots[s] === fh) return;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x * S, y * S, t.nx, t.ny, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, t.bytes); T.slots[s] = fh; });
      return shown;
    },
    render(gl, matrix) {
      if (!this.count || !st.draw) return; const F = FIELDS[st.field], spec = st.man.fields[st.field];
      gl.useProgram(this.p); gl.uniformMatrix4fv(this.loc.u_matrix, false, matrix); gl.uniform1f(this.loc.u_op, 0.85);
      gl.uniform2f(this.loc.u_lut, F.range[0], F.range[1]);
      const at = (b, l) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0); };
      at(this.buf.pos, this.loc.a_pos); at(this.buf.g, this.loc.a_g); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.cmap); gl.uniform1i(this.loc.u_cmap, 1);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      st.draw.forEach((L) => { const T = this.tex[L]; if (!T) return;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.t); gl.uniform1i(this.loc.u_tex, 0);
        gl.uniform2f(this.loc.u_size, T.lv.nx, T.lv.ny); gl.uniform1f(this.loc.u_every, 2 ** L); gl.uniform1f(this.loc.u_scale, K.scaleOf(spec, L));
        gl.drawElements(gl.TRIANGLES, this.count, this.uint ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0); });
    },
  };

  /* ---------- draw the current hour ---------- */
  let drawToken = 0;
  async function redraw() {
    if (!st.man || !layer.gl) return; const token = ++drawToken, fh = fhNow(), w = wanted(); st.want = w;
    const hs = hourState(fh);
    if (st.gapValid != null) { st.draw = []; st.map.triggerRepaint(); info(); note(validGapText()); return; }
    if (hs !== "ok") { st.draw = []; st.map.triggerRepaint(); info(); note(gapText(fh, hs)); return; }
    const paint = () => { if (token !== drawToken) return;
      const nCoarse = layer.show(w.coarse, fh, w.all), nFine = w.L !== w.coarse ? layer.show(w.L, fh, w.tiles) : 0;
      st.draw = w.L !== w.coarse ? [w.coarse, w.L] : [w.coarse]; st.shown = { coarse: nCoarse, fine: nFine, of: w.tiles.length };
      st.map.triggerRepaint(); info(); };
    paint();
    const res = await need(fh, w); paint();
    const failed = res.filter((r) => r.status === "rejected");
    if (token === drawToken) note(failed.length ? `Some map tiles could not be loaded (${failed[0].reason && failed[0].reason.message}). Move the map or choose the hour again to retry.` : null);
    if (token === drawToken) prefetch(w);
  }
  /* after the visible hour is drawn, quietly fetch the same view for the next hours (for the loop) */
  let prefetching = 0;
  async function prefetch(w) {
    const p = ++prefetching, hrs = st.man.hours, start = st.h;
    for (let k = 1; k < hrs.length; k++) { if (p !== prefetching) return; const h = hrs[(start + k) % hrs.length]; if (hourState(h) === "ok") await need(h, w); }
    if (p === prefetching) info();
  }
  /* compare mode: the chosen valid time is outside this run */
  function validGapText() {
    const m = st.man, a = Date.parse(m.valid[m.hours[0]]), b = Date.parse(m.valid[m.hours[m.hours.length - 1]]);
    return `This run has no forecast hour valid at ${fmtLocal(st.gapValid)}. It covers ${fmtLocal(a)} to ${fmtLocal(b)} (F${String(m.hours[0]).padStart(2, "0")}–F${String(m.hours[m.hours.length - 1]).padStart(2, "0")}).`;
  }
  /* why an hour shows no map: said on the map, never drawn as zero */
  function gapText(fh, hs) {
    const F = FIELDS[st.field], f2 = `F${String(fh).padStart(2, "0")}`, r = hourRec(fh);
    if (hs === "na") return `${F.label}: not available at ${f2}. ${r.notApplicable.charAt(0).toUpperCase()}${r.notApplicable.slice(1)}.`;
    if (hs === "absent") return `${F.label} is not published for this run.`;
    return `${F.label}: ${f2} is missing for this run (not posted by NOAA yet, or it failed the source check). Nothing is drawn for this hour.`;
  }
  const frameReady = (fh, w) => hourState(fh) !== "ok" || w.all.every(([x, y]) => ready(fh, w.coarse, x, y)) && (w.L === w.coarse || w.tiles.every(([x, y]) => ready(fh, w.L, x, y)));

  /* ---------- text: init/valid times, level, sizes ---------- */
  function info() {
    if (!st.man) return; const m = st.man, F = FIELDS[st.field], fh = fhNow(), valid = Date.parse(m.valid[fh]), init = Date.parse(m.cycle);
    const w = st.want || wanted(), every = 2 ** w.L, loopReady = m.hours.filter((h) => frameReady(h, w)).length;
    if (st.gapValid != null) { $("mapInfo").innerHTML = `${PANEL ? `<b class="panel${PANEL === "B" ? " b" : ""}">${esc(PANEL)}</b> ` : ""}<b class="fld">HRRR ${esc(fmtUTC(init))} run · ${esc(F.label)}</b><div class="msg"><b>No forecast hour at ${esc(fmtLocal(st.gapValid))}</b></div>`; share(); return; }
    $("mapInfo").innerHTML = `${PANEL ? `<b class="panel${PANEL === "B" ? " b" : ""}">${esc(PANEL)}</b> ` : ""}<b class="fld">HRRR 3 km<span class="wide-only"> CONUS</span> · ${esc(F.label)}${F.units ? ` <span class="unit">(${esc(F.units)})</span>` : ""}</b><div>Init <b>${esc(fmtUTC(init))}</b> · F${String(fh).padStart(2, "0")} · valid <b>${esc(fmtLocal(valid))}</b><span class="wide-only"> (${esc(fmtUTC(valid))})</span></div>` +
      (F.window ? `<div class="msg">${esc(windowText(F, fh))}</div>` : "") + (F.note ? `<div class="msg fnote">${esc(F.note)}</div>` : "") +
      `<div class="msg">${every === 1 ? "Every native 3 km cell at this zoom" : `Every ${every === 2 ? "2nd" : "4th"} native cell<span class="wide-only"> at this zoom</span>; zoom in for every cell`}<span class="wide-only"> · click for the cell's own value</span></div>`;
    $("tlValid").textContent = `${fmtLocal(valid)} · F${String(fh).padStart(2, "0")}`; $("hourSl").value = String(st.h);
    $("runInfo").innerHTML = `Run ${esc(fmtUTC(init))}: ${m.status === "in progress" ? `<b>in progress</b>, ${m.hours.length} of ${m.hoursExpected + 1} hours posted by NOAA so far` : `${m.hours.length} forecast hours (${esc(m.status)})`}. ` +
      `Loop ready for this view: ${loopReady} of ${m.hours.length} hours. Downloaded this visit: <b>${MB(st.loadedBytes)}</b> compressed in ${st.requests} map-data requests; decoded tiles in memory: ${MB(st.bytes)}. ` +
      `Every cell is placed from the GRIB projection (checked against GRIB's own latitudes and longitudes: largest difference ${m.georef ? m.georef.maxErrorCells : "?"} cells). ${esc(m.attribution)}`;
    share();
  }
  /* accumulation window in words, ending at the valid time */
  function windowText(F, fh) {
    const v = Date.parse(st.man.valid[fh]), c = Date.parse(st.man.cycle);
    if (F.window === 1) return `Accumulated in the hour ending ${fmtLocal(v)}`;
    return `Accumulated from the run start (${fmtLocal(c)}) to ${fmtLocal(v)}, ${fh} h`;
  }
  function legend() {
    const F = FIELDS[st.field];
    if (F.cat || F.steps) {   /* stepped and categorical scales: one box per step, labelled with its lower bound */
      const items = F.cat ? Object.values(F.cat).map(([n, c]) => [n, c]) : F.steps.map(([t, c]) => [String(t), c]);
      $("legend").innerHTML = `<div class="lgt">${esc(F.short || F.label)}${F.units ? `, ${esc(F.units)}` : ""}</div><div class="lgsteps${F.cat ? " cat" : ""}">${items.map(([n, c]) => `<span><i style="background:rgb(${c.join(",")})"></i>${esc(n)}</span>`).join("")}</div>`;
      return;
    }
    legendRamp();
  }
  function legendRamp() {
    const F = FIELDS[st.field], [lo, hi] = [F.legend.ticks[0], F.legend.ticks[F.legend.ticks.length - 1]], n = 48;
    const grad = Array.from({ length: n + 1 }, (_, k) => { const v = lo + (k / n) * (hi - lo), c = F.color(v); return `rgb(${c.slice(0, 3).join(",")}) ${((k / n) * 100).toFixed(1)}%`; }).join(",");
    $("legend").innerHTML = `<div class="lgt">${esc(F.label)}, ${esc(F.units)}</div><div class="lgbar" style="background:linear-gradient(to right,${grad})"></div><div class="lgticks">${F.legend.ticks.filter((t, k) => !PHONE() || k % 2 === 0 || t === 32).map((t) => `<span style="left:${(((t - lo) / (hi - lo)) * 100).toFixed(1)}%">${t}</span>`).join("")}</div>`;
  }
  function note(t) { const n = $("mapNote"); n.textContent = t || ""; n.hidden = !t; }

  /* ---------- click-to-read: the native cell, full precision ---------- */
  async function select(lat, lon) {
    st.selPt = [lat, lon]; const c = st.P.nearest(lat, lon);
    if (!c) { st.sel = null; outline(); $("inspect").innerHTML = '<p class="msg">That point is outside the HRRR grid (nothing is drawn there).</p>'; share(); return; }
    st.sel = c; outline(); const [i, j] = c, fh = fhNow(), T = st.man.tile, tx = Math.floor(i / T), ty = Math.floor(j / T), F = FIELDS[st.field];
    if (st.gapValid != null) { $("inspect").innerHTML = `<p class="msg">${esc(validGapText())}</p>`; return; }
    if (hourState(fh) !== "ok") { $("inspect").innerHTML = `<p class="msg">${esc(gapText(fh, hourState(fh)))}</p>`; share(); return; }
    $("inspect").innerHTML = '<p class="msg">Reading the native cell…</p>';
    try { await tile(fh, 0, tx, ty); } catch (e) { $("inspect").innerHTML = `<p class="msg">Could not load that cell (${esc(e.message)}).</p>`; return; }
    if (!st.sel || st.sel[0] !== i || st.sel[1] !== j || fhNow() !== fh) return;
    const v = K.valueAt(st.man, st.field, { [K.tileName(0, tx, ty)]: ready(fh, 0, tx, ty) }, i, j), [la, lo] = st.P.fromCell(i, j), valid = Date.parse(st.man.valid[fh]);
    const shown = v == null ? '<span class="unavail">no data in this cell</span>' : F.cat ? `<b>${v === 0 ? "none (not precipitating)" : esc((F.cat[Math.round(v)] || ["?"])[0])}</b>` : `<b>${v.toFixed(F.dec)} ${esc(F.units)}</b>`;
    $("inspect").innerHTML = `<div class="inspect-v">${esc(F.label)}: ${shown}</div>${F.window ? `<div class="msg">${esc(windowText(F, fh))}</div>` : ""}` +
      `<div class="msg">HRRR native cell ${i}, ${j} (3 km), centred at ${la.toFixed(4)}, ${lo.toFixed(4)} · F${String(fh).padStart(2, "0")}, valid ${esc(fmtLocal(valid))} · stored to ${st.man.fields[st.field].scale} ${esc(F.units)} from GRIB, never from the display</div>`;
    share();
  }
  function outline() {
    const src = st.map.getSource("sel"); if (!src) return;
    if (!st.sel) { src.setData({ type: "FeatureCollection", features: [] }); return; }
    const [i, j] = st.sel, ring = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]].map(([a, b]) => { const [la, lo] = st.P.fromCell(i + a, j + b); return [lo, la]; });
    src.setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  async function reselect() { if (st.selPt) await select(st.selPt[0], st.selPt[1]); }

  /* ---------- PNG export: the current view with the same metadata and source credit ---------- */
  function grabMap() {   /* WebGL buffers are cleared after compositing: copy inside the frame that draws them */
    return new Promise((ok, no) => { const m = st.map; const t = setTimeout(() => no(new Error("the map did not redraw")), 8000);
      m.once("render", () => { clearTimeout(t); try { const c = m.getCanvas(), o = document.createElement("canvas"); o.width = c.width; o.height = c.height;
        const g = o.getContext("2d"); g.drawImage(c, 0, 0); const lab = $("labels"); if (lab && lab.width) g.drawImage(lab, 0, 0, o.width, o.height); ok(o); } catch (e) { no(e); } });
      m.triggerRepaint(); });
  }
  async function exportPng() {
    if (!st.man) return;
    /* the same area at a fixed 16:10 frame on every device: the map is resized off screen, drawn, copied, restored */
    const el = $("map"), saved = el.getAttribute("style") || "", bounds = st.map.getBounds(), dpr = window.devicePixelRatio || 1;
    let map;
    try {
      el.setAttribute("style", `${saved};position:fixed;left:0;top:0;width:${Math.round(1600 / dpr)}px;height:${Math.round(1000 / dpr)}px;z-index:-1`);
      st.map.resize(); st.map.fitBounds(bounds, { duration: 0, padding: 0 }); await redraw(); map = await grabMap();
    } finally { el.setAttribute("style", saved); st.map.resize(); st.map.fitBounds(bounds, { duration: 0, padding: 0 }); redraw(); }
    const F = FIELDS[st.field], m = st.man, fh = fhNow(), valid = Date.parse(m.valid[fh]), init = Date.parse(m.cycle), hs = hourState(fh);
    const W = 1600, mapH = Math.round((W * map.height) / map.width), HEAD = 150, FOOT = 116, H = HEAD + mapH + FOOT;
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    const dark = document.documentElement.getAttribute("data-theme") !== "light", fg = dark ? "#eef1f5" : "#14181f", mute = dark ? "#a9b2bf" : "#4b5563", bg = dark ? "#0d1117" : "#ffffff";
    const font = (w, px) => `${w} ${px}px "Archivo", "Helvetica Neue", Arial, sans-serif`, f2 = `F${String(fh).padStart(2, "0")}`;
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.font = font(800, 40); g.fillText(`HRRR 3 km · ${F.label}${F.units ? ` (${F.units})` : ""}`, 32, 56);
    g.font = font(600, 26); g.fillText(`Init ${fmtUTC(init)} · ${f2} · Valid ${fmtLocal(valid)} (${fmtUTC(valid)})`, 32, 96);
    g.fillStyle = mute; g.font = font(500, 22); g.fillText([F.window ? windowText(F, fh) : "", F.note || ""].filter(Boolean).join("  ·  ").slice(0, 150), 32, 130);
    g.drawImage(map, 0, HEAD, W, mapH);
    if (hs !== "ok") { g.fillStyle = dark ? "rgba(13,17,23,.78)" : "rgba(255,255,255,.82)"; g.fillRect(0, HEAD + mapH / 2 - 40, W, 80); g.fillStyle = fg; g.font = font(700, 28); g.textAlign = "center"; g.fillText(gapText(fh, hs).slice(0, 110), W / 2, HEAD + mapH / 2 + 10); g.textAlign = "left"; }
    /* legend */
    let x = 32; const y = HEAD + mapH + 22;
    const items = F.cat ? Object.values(F.cat).map(([n, col]) => [n, col]) : F.steps ? F.steps.map(([t, col]) => [String(t), col]) : null;
    g.font = font(600, 20);
    if (items) items.forEach(([n, col]) => { g.fillStyle = `rgb(${col.join(",")})`; g.fillRect(x, y, 34, 22); g.fillStyle = fg; g.fillText(n, x + 40, y + 18); x += 40 + g.measureText(n).width + 22; });
    else { const t = F.legend.ticks, lo = t[0], hi = t[t.length - 1], bw = 900; for (let k = 0; k < bw; k++) { const col = F.color(lo + (k / bw) * (hi - lo)); if (col) { g.fillStyle = `rgb(${col.slice(0, 3).join(",")})`; g.fillRect(x + k, y, 1, 22); } }
      g.fillStyle = fg; t.forEach((v) => g.fillText(String(v), x + ((v - lo) / (hi - lo)) * bw - 8, y + 46)); }
    g.fillStyle = mute; g.font = font(500, 19);
    g.fillText("Forecast Ops output · Data: NOAA/NCEP HRRR (NOAA Open Data Dissemination) · Model guidance, not an official forecast · Not endorsed by NOAA", 32, H - 42);
    g.fillText("Basemap: U.S. Census Bureau boundaries via us-atlas, Natural Earth · Colors and rendering: Forecast Ops", 32, H - 16);
    const blob = await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
    const a = document.createElement("a"), name = `forecast-ops-hrrr-${st.field}-${st.run.id}z-${f2.toLowerCase()}.png`;
    a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    window.__lastPng = { name, width: W, height: H, field: st.field, run: st.run.id, fh, mapH };   // test hook
    note(`Saved ${name} (${W} × ${H}).`);
  }
  /* ---------- cycle comparison: the embedded panel's controls, and the way in from the single-run view ---------- */
  const api = {
    ready: () => !!(st.man && st.map && st.map.loaded()),
    setField: (f) => setField(f),
    /* show the hour valid at ms; if this run has none, say so and draw nothing */
    setValid: (ms) => { if (!st.man) return; stop(); const i = st.man.hours.findIndex((h) => Date.parse(st.man.valid[h]) === ms);
      st.gapValid = i < 0 ? ms : null; if (i >= 0) st.h = i; note(null); redraw(); reselect(); },
    view: (center, zoom) => { const c = st.map.getCenter(); if (Math.abs(c.lng - center[0]) < 1e-6 && Math.abs(c.lat - center[1]) < 1e-6 && Math.abs(st.map.getZoom() - zoom) < 1e-4) return; st.syncing = true; st.map.jumpTo({ center, zoom }); },
    point: (lat, lon) => select(lat, lon),
    resize: () => { st.map.resize(); redraw(); },
    exportPng: () => exportPng(),
    state: () => (st.man ? { run: st.run.id, cycle: st.man.cycle, field: st.field, fh: st.gapValid != null ? null : fhNow(), gapValid: st.gapValid, hours: st.man.hours, valid: st.man.valid, status: st.man.status,
      hourState: st.gapValid != null ? "no-valid" : hourState(fhNow()), shown: st.shown, draw: (st.draw || []).length, point: $("inspect").innerText } : null),
  };
  function compareLink() {
    const runs = st.index.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle)), i = runs.findIndex((r) => r.id === st.run.id), b = runs[i + 1] || runs[i - 1];
    const q = new URLSearchParams({ domain: "conus", compare: "1", a: st.run.id, b: b ? b.id : st.run.id, field: st.field, valid: st.man.valid[fhNow()] });
    if (Q.get("data")) q.set("data", Q.get("data")); const c = st.map.getCenter(); q.set("map", `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${st.map.getZoom().toFixed(2)}`);
    return `${location.pathname}?${q.toString()}`;
  }
  /* ---------- shareable link ---------- */
  function share() {
    if (!st.man || !st.map || EMBED) return; const c = st.map.getCenter(), q = new URLSearchParams();
    q.set("domain", "conus"); if (Q.get("data")) q.set("data", Q.get("data"));
    q.set("run", st.run.id); q.set("fh", String(fhNow())); q.set("field", st.field);
    q.set("map", `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${st.map.getZoom().toFixed(2)}`);
    if (st.selPt) q.set("pt", `${st.selPt[0].toFixed(4)},${st.selPt[1].toFixed(4)}`);
    try { history.replaceState(null, "", `${location.pathname}?${q.toString()}`); } catch (e) { /* file:// */ }
  }

  /* ---------- runs, hours, loop ---------- */
  function runLabel(r) { const c = Date.parse(r.cycle); return `${fmtUTC(c)} · ${r.status === "in progress" ? `F00–F${String(Math.max(...r.hours)).padStart(2, "0")} so far` : `${r.hoursExpected} h`}${r === st.index.runs[0] ? " · newest" : ""}`; }
  async function openRun(id, keepValid, fhWanted) {
    stop(); const r = st.index.runs.find((x) => x.id === id) || st.index.runs[0];
    const prevValid = keepValid && st.man ? Date.parse(st.man.valid[fhNow()]) : null;
    $("mapInfo").textContent = `Loading ${fmtUTC(Date.parse(r.cycle))} run…`;
    const man = await getJSON(`${SITE}/${r.path}/manifest.json`);
    const sameGrid = st.man && JSON.stringify(st.man.grid) === JSON.stringify(man.grid);
    st.run = r; st.man = man; st.P = MC.projector(man.grid);
    if (!sameGrid) { st.mesh = K.gridMesh(st.P, man.grid.nx, man.grid.ny, MC.merc, 8); layer.setMesh(st.mesh); footprint(); }
    let h = 0;
    if (fhWanted != null && man.hours.includes(+fhWanted)) h = man.hours.indexOf(+fhWanted);
    else if (prevValid != null) { const v = man.hours.map((x) => Math.abs(Date.parse(man.valid[x]) - prevValid)); h = v.indexOf(Math.min(...v)); }
    st.h = h; $("runSel").value = r.id; timeline(); legend(); layer.setColors(K.lut(FIELDS[st.field].color, ...FIELDS[st.field].range, 4096)); note(null); await redraw(); reselect();
  }
  function timeline() {
    const m = st.man, n = m.hours.length; $("hourSl").max = String(n - 1); $("hourSl").value = String(st.h);
    $("tlTicks").innerHTML = m.hours.map((h, i) => { const hr = +new Date(Date.parse(m.valid[h])).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }); return hr === 0 ? `<i class="day" style="left:${(100 * i) / Math.max(1, n - 1)}%"></i>` : ""; }).join("") +
      /* hours with nothing to draw for this field are marked on the timeline: grey = not applicable, red = missing */
      m.hours.map((h, i) => { const hs = hourState(h); return hs === "ok" ? "" : `<i class="gap ${hs}" data-gap="${h}" title="F${String(h).padStart(2, "0")}: ${hs === "na" ? "not applicable" : "missing"}" style="left:${(100 * i) / Math.max(1, n - 1)}%"></i>`; }).join("");
  }
  /* switch field: same run, hour and view; the colour scale, legend and timeline follow */
  async function setField(f) {
    if (!FIELDS[f] || f === st.field) return; stop(); st.field = f; $("fieldSel").value = f;
    layer.setColors(K.lut(FIELDS[f].color, ...FIELDS[f].range, 4096)); legend(); timeline(); note(null); await redraw(); reselect();
  }
  function go(h) { st.h = (h + st.man.hours.length) % st.man.hours.length; redraw(); reselect(); }
  function stop() { if (st.play) clearTimeout(st.play); st.play = null; $("playBtn").textContent = "PLAY"; $("playBtn").setAttribute("aria-pressed", "false"); }
  /* the loop advances only to hours whose tiles for this view are in memory, so it never shows a gap */
  function play() {
    if (st.play) { stop(); return; }
    $("playBtn").textContent = "PAUSE"; $("playBtn").setAttribute("aria-pressed", "true"); prefetch(st.want || wanted());
    const tick = () => { const w = st.want || wanted(), nxt = (st.h + 1) % st.man.hours.length;
      if (frameReady(st.man.hours[nxt], w)) go(nxt); st.play = setTimeout(tick, PHONE() ? 650 : 500); };
    st.play = setTimeout(tick, 300);
  }

  /* ---------- map ---------- */
  const palette = () => (document.documentElement.getAttribute("data-theme") !== "light"
    ? { land: "#151a22", state: "#cfd5de", border: "#e6eaf0", coast: "#8fa3b8", lake: "#6f8fae", edge: "#9aa4b2" }
    : { land: "#f1f2ee", state: "#353c47", border: "#1d232b", coast: "#4b6b8a", lake: "#5f8db8", edge: "#55606e" });
  function footprint() { const s = st.map && st.map.getSource("footprint"); if (s && st.mesh) s.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: st.mesh.ring } }); }
  function initMap(base) {
    const C = palette(), view = (Q.get("map") || "").split(",").map(Number), hasView = view.length === 3 && view.every(Number.isFinite);
    const map = new ML.Map({ container: "map", style: { version: 8, glyphs: new URL("assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf", location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}"), sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": C.land } }] },
      center: hasView ? [view[1], view[0]] : [-97.5, 38.6], zoom: hasView ? view[2] : PHONE() ? 2.6 : 3.7, minZoom: 1.5, maxZoom: 10.5, attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: false,
      maxBounds: [[-175, -5], [-25, 72]] });
    map.touchZoomRotate.disableRotation(); map.addControl(new ML.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ML.AttributionControl({ compact: true, customAttribution: "Data: NOAA/NCEP HRRR · Forecast Ops output · US Census (us-atlas) · Natural Earth" }), "bottom-right");
    st.map = map;
    return new Promise((res) => map.on("load", () => {
      const L = base.layers; Object.entries(L).forEach(([k, v]) => map.addSource(k, { type: "geojson", data: v }));
      map.addLayer(layer);
      map.addSource("footprint", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "footprint", type: "line", source: "footprint", paint: { "line-color": C.edge, "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.8 } });
      map.addLayer({ id: "lakes", type: "line", source: "lakes", paint: { "line-color": C.lake, "line-width": 0.8 } });
      map.addLayer({ id: "coast", type: "line", source: "coast", paint: { "line-color": C.coast, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.4] } });
      map.addLayer({ id: "states", type: "line", source: "states", paint: { "line-color": C.state, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 8, 1.6], "line-opacity": 0.85 } });
      map.addLayer({ id: "borders", type: "line", source: "borders", paint: { "line-color": C.border, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.9, 8, 2] } });
      map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "sel", type: "line", source: "sel", paint: { "line-color": "#ffffff", "line-width": 2 } });
      map.addLayer({ id: "places", type: "symbol", source: "places", filter: [">=", ["get", "pop"], ["interpolate", ["linear"], ["zoom"], 3, 2500000, 5, 600000, 7, 100000]],
        layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10.5, 8, 13], "symbol-sort-key": ["-", 0, ["get", "pop"]], "text-padding": 6, "text-max-width": 10 },
        paint: { "text-color": getComputedStyle(document.body).getPropertyValue("--text").trim() || "#e8eaee", "text-halo-color": getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#0b0d12", "text-halo-width": 1.4 } });
      const repaint = () => { const P = palette(); [["bg", "background-color", "land"], ["footprint", "line-color", "edge"], ["lakes", "line-color", "lake"], ["coast", "line-color", "coast"], ["states", "line-color", "state"], ["borders", "line-color", "border"]].forEach(([id, p, k]) => map.setPaintProperty(id, p, P[k])); };
      window.addEventListener("ops:theme", repaint);
      if (window.ResizeObserver) { let t = null; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => map.resize(), 60); }).observe(map.getContainer()); }
      res();
    }));
  }

  /* ---------- page ---------- */
  function adaptEmbed() {
    document.body.classList.add("conus-embed");
    const ins = $("inspect"); if (ins) { ins.classList.add("panel-read"); $("stage").appendChild(ins); ins.innerHTML = ""; }
  }
  function adaptPage() {
    document.body.classList.add("maps-conus"); ["pngBtn", "cmpBtn"].forEach((id) => { if ($(id)) $(id).hidden = false; });
    ["winSel", "smoothChk"].forEach((id) => { const e = $(id); if (e) (e.closest("label") || e).hidden = true; });
    const seg = document.querySelector('[aria-label="Map view"]'); if (seg) seg.hidden = true;
    const ps = $("placeSel"); if (ps) ps.closest("div").hidden = true;
    $("inspect").innerHTML = '<p class="msg">Click or tap the map to read the HRRR value in that native 3 km cell. Values come from the full-precision grid, never from the display.</p>';
    const about = document.querySelector("#runInfo") && document.querySelector("#runInfo").previousElementSibling;
    if (about) about.textContent = "Beta: NOAA HRRR, full CONUS 3 km grid (1799 × 1059 cells) on the model's own Lambert conformal projection; areas outside the model grid are left blank. Zoomed out, the map draws every 2nd or 4th native cell (each drawn over the block it stands for) so a loop stays light on a phone; zoom in for every cell. Clicking always reads the native cell at full precision. Only the tiles in view are downloaded. Runs appear hour by hour as NOAA posts them; the 00, 06, 12 and 18 UTC runs go to 48 hours, the others to 18. Geography: US Census boundaries (us-atlas) and Natural Earth (public domain). Model guidance only, not an official forecast.";
  }
  async function start() {
    if (Q.get("compare") === "1" && window.MapsConusCompare) { window.MapsConusCompare.start(); return; }   // it sets up its own page shell
    O.shell("maps", "Model maps", { forecastPoint: false, subtitle: "Beta · HRRR 3 km, full CONUS" });
    regionToggle("conus"); adaptPage(); if (EMBED) adaptEmbed();
    if (!ML || !(() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })()) { $("mapInfo").innerHTML = '<span class="state err">This browser cannot draw the interactive map (WebGL unavailable).</span>'; return; }
    let base;
    try { [base, st.index] = await Promise.all([getJSON("assets/maps/basemap-conus.json"), getJSON(`${DATA}/conus/index.json`)]); }
    catch (e) { $("mapInfo").innerHTML = `<span class="state err">CONUS map data unavailable (${esc(e.message)}).</span>`; return; }
    if (!st.index.runs.length) { $("mapInfo").textContent = "No CONUS runs published yet."; return; }
    if (FIELDS[Q.get("field")]) st.field = Q.get("field");
    const published = new Set(st.index.runs.flatMap((r) => r.fields || []));
    $("fieldSel").innerHTML = Object.entries(FIELDS).filter(([k]) => !published.size || published.has(k)).map(([k, f]) => `<option value="${k}">${esc(f.label)}</option>`).join(""); $("fieldSel").value = st.field;
    $("runSel").innerHTML = st.index.runs.map((r) => `<option value="${esc(r.id)}">${esc(runLabel(r))}</option>`).join("");
    await initMap(base);
    const pt = (Q.get("pt") || "").split(",").map(Number); if (pt.length === 2 && pt.every(Number.isFinite)) st.selPt = pt;
    try { await openRun(Q.get("run") || st.index.runs[0].id, false, Q.get("fh")); }
    catch (e) { $("mapInfo").innerHTML = `<span class="state err">This run could not be loaded (${esc(e.message)}).</span>`; return; }
    if (!Q.get("map")) { /* open on the whole model footprint, clear of the overlays */
      const xs = st.mesh.ring.map((p) => p[0]), ys = st.mesh.ring.map((p) => p[1]);
      st.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: PHONE() ? { top: 150, bottom: 90, left: 6, right: 6 } : { top: 60, bottom: 80, left: 20, right: 20 }, duration: 0 });
      redraw(); }
    let mv = null; st.map.on("moveend", () => { clearTimeout(mv); mv = setTimeout(() => { redraw(); share(); }, 120); });
    st.map.on("click", (e) => select(e.lngLat.lat, e.lngLat.lng));
    $("fieldSel").addEventListener("change", () => setField($("fieldSel").value));
    $("pngBtn").addEventListener("click", () => exportPng().catch((e) => note(`Couldn't make the image (${e.message}).`)));
    $("runSel").addEventListener("change", () => openRun($("runSel").value, true).catch((e) => note(`Run could not be loaded (${e.message}).`)));
    $("hourSl").addEventListener("input", () => { stop(); go(+$("hourSl").value); });
    $("playBtn").addEventListener("click", play);
    if (!document.fullscreenEnabled) $("fsBtn").hidden = true;
    document.querySelectorAll("#mapCtl .ctlrow").forEach((r) => { if (![...r.children].some((c) => !c.hidden && c.offsetParent !== null)) r.hidden = true; }); // no empty control rows
    $("fsBtn").addEventListener("click", () => { const s = $("stage"); if (document.fullscreenElement) document.exitFullscreen(); else if (s.requestFullscreen) s.requestFullscreen(); });
    document.addEventListener("fullscreenchange", () => { $("fsBtn").setAttribute("aria-pressed", String(!!document.fullscreenElement)); $("fsBtn").textContent = document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN"; setTimeout(() => st.map.resize(), 50); });
    $("stage").addEventListener("keydown", (e) => { if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return; if (e.key === "ArrowRight") { e.preventDefault(); stop(); go(st.h + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); stop(); go(st.h - 1); } else if (e.key === " ") { e.preventDefault(); play(); } });
    const place = () => { $("mapInfo").style.top = PHONE() ? `${$("mapCtl").offsetTop + $("mapCtl").offsetHeight + 4}px` : ""; };
    if (window.ResizeObserver) new ResizeObserver(place).observe($("mapCtl")); place();
    window.__conus = st; // test hook (read-only use)
    if (EMBED) {   /* a panel of the cycle comparison: the page drives field, valid time, view and point; user moves are reported */
      st.map.on("moveend", () => { if (st.syncing) { st.syncing = false; return; } const c = st.map.getCenter(); parent.postMessage({ conus: "view", panel: PANEL, center: [c.lng, c.lat], zoom: st.map.getZoom() }, location.origin); });
      st.map.on("click", (e) => parent.postMessage({ conus: "point", panel: PANEL, lat: e.lngLat.lat, lon: e.lngLat.lng }, location.origin));
    }
    if (Q.get("valid")) api.setValid(Date.parse(Q.get("valid")));
    $("cmpBtn").addEventListener("click", () => { location.href = compareLink(); });
  }
  /* Tri-State | CONUS switch, shared by both viewers */
  function regionToggle(active) {
    const row = $("mapCtl") && $("mapCtl").querySelector(".ctlrow"); if (!row || $("regionSeg")) return;
    const d = document.createElement("div"); d.className = "seg"; d.id = "regionSeg"; d.setAttribute("role", "group"); d.setAttribute("aria-label", "Region");
    d.innerHTML = `<a class="segb" href="maps.html" aria-pressed="${active === "tristate"}">Tri-State</a><a class="segb" href="maps.html?domain=conus" aria-pressed="${active === "conus"}">CONUS <small class="wide-only">beta</small></a>`;
    row.prepend(d);
  }
  window.MapsConus = { start, regionToggle, api, FIELDS };
})();
