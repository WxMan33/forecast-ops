/* Model maps v2: interactive HRRR map. MapLibre GL draws the basemap lines; a custom WebGL layer draws
   every native HRRR cell at its exact projected corners (no resampling); a 2-D overlay draws labels so
   cities, sites and highway names stay sharp above the weather. Point values always come from the
   original grid (maps-core), never from the display. Data: WxMan33/forecast-ops-maps. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, MC = window.MapsCore, esc = O.esc, ML = window.maplibregl;
  const Q = new URLSearchParams(location.search);
  const DATA = (Q.get("data") || "https://wxman33.github.io/forecast-ops-maps/data").replace(/\/$/, ""); // read before the shell rewrites the URL
  O.shell("maps", "Model maps", { forecastPoint: false });
  const TZ = "America/New_York", H = 3600e3;
  const FIELDS = {
    t2m: { label: "2-m temperature", scale: "t2m", units: "°F", dec: 0, smooth: true },
    precip: { label: "Precipitation", scale: "precip", units: "in", dec: 2, smooth: true },
    refc: { label: "Composite reflectivity (simulated)", short: "Composite reflectivity", scale: "refc", units: "dBZ", dec: 0, smooth: true },
    refd1km: { label: "1 km AGL reflectivity (simulated)", short: "1 km reflectivity", scale: "refc", units: "dBZ", dec: 0, smooth: true },
  };
  const st = { index: null, run: null, man: null, fields: {}, h: 0, field: O.store.get("maps2_field", "t2m"), win: O.store.get("maps2_win", "1"), smooth: !!O.store.get("maps2_smooth", false),
    lat: null, P: null, mesh: null, frames: new Map(), sel: null, play: null, base: null, map: null, view: O.store.get("maps2_view", "tristate"), loaded: 0 };
  const fmtLocal = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" });
  const fmtUTC = (ms) => { const d = new Date(ms).toISOString(); return `${d.slice(5, 10).replace("-", "/")} ${d.slice(11, 13)}Z`; };
  const MB = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  const fetchT = (url, ms = 30000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal, cache: "no-cache" }).finally(() => clearTimeout(t)); };
  const getJSON = async (u) => { const r = await fetchT(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  async function getGz(u) { if (typeof DecompressionStream !== "function") throw new Error("this browser cannot decompress the map data"); const r = await fetchT(u, 60000); if (!r.ok) throw new Error(`HTTP ${r.status}`); return new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(); }
  const css = (n, d) => getComputedStyle(document.body).getPropertyValue(n).trim() || d;

  /* ---------- values from the ORIGINAL grid ---------- */
  function valueAt(h, i, j) {
    const f = st.field;
    if (f === "precip") { const w = st.win === "run" ? "run" : +st.win, p = MC.precip(st.man, st.fields, h, w, i, j); return { v: MC.mmToIn(p.mm), why: p.why }; }
    const fd = st.fields[f]; if (!fd) return { v: null, why: "not in this run" };
    return { v: fd.at(h, i, j) };
  }
  const fieldOk = (f) => f === "precip" ? !!(st.fields.apcp_hour && st.fields.apcp_run) : !!st.fields[f];
  /* one frame of colour-table coordinates for the GPU (cached per run/field/window/hour) */
  function frame(h) {
    const key = `${st.run.id}|${st.field}|${st.win}|${h}`; if (st.frames.has(key)) return st.frames.get(key);
    const g = st.man.grid, n = g.nx * g.ny, u = new Float32Array(n), ok = new Uint8Array(n), sc = FIELDS[st.field].scale; let any = false, why = null;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const r = valueAt(h, i, j), c = j * g.nx + i; if (r.v == null) { if (!why) why = r.why; continue; } const x = MC.scaleU(sc, r.v); ok[c] = 1; u[c] = x; any = true; }
    const fr = { u, ok, any, why }; if (st.frames.size > 400) st.frames.clear(); st.frames.set(key, fr); return fr;
  }

  /* ---------- the GPU weather layer ---------- */
  const VS = `attribute vec2 a_pos; attribute float a_u; attribute float a_ok; uniform mat4 u_matrix; varying float v_u; varying float v_ok;
    void main(){ v_u=a_u; v_ok=a_ok; gl_Position=u_matrix*vec4(a_pos,0.0,1.0); }`;
  const FS = `precision mediump float; uniform sampler2D u_cmap; uniform float u_op; varying float v_u; varying float v_ok;
    void main(){ if(v_ok<0.999) discard; if(v_u<0.0) discard; vec4 c=texture2D(u_cmap,vec2(clamp(v_u,0.0,1.0),0.5)); gl_FragColor=vec4(c.rgb*u_op,u_op); }`;
  const layer = {
    id: "weather", type: "custom", renderingMode: "2d",
    onAdd(map, gl) {
      this.gl = gl; const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p); this.p = p;
      this.loc = { pos: gl.getAttribLocation(p, "a_pos"), u: gl.getAttribLocation(p, "a_u"), ok: gl.getAttribLocation(p, "a_ok"), m: gl.getUniformLocation(p, "u_matrix"), cmap: gl.getUniformLocation(p, "u_cmap"), op: gl.getUniformLocation(p, "u_op") };
      this.buf = { pos: gl.createBuffer(), u: gl.createBuffer(), ok: gl.createBuffer(), idx: gl.createBuffer() }; this.tex = gl.createTexture(); this.count = 0;
    },
    setGeometry(pos, idx) { const gl = this.gl; if (!gl) return; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); this.count = idx.length; },
    setValues(u, ok) { const gl = this.gl; if (!gl) return; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.u); gl.bufferData(gl.ARRAY_BUFFER, u, gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.ok); gl.bufferData(gl.ARRAY_BUFFER, ok, gl.DYNAMIC_DRAW); },
    setColors(rgba, stepped) { const gl = this.gl; if (!gl) return; gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba); const f = stepped ? gl.NEAREST : gl.LINEAR; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); },
    render(gl, matrix) {
      if (!this.count) return; gl.useProgram(this.p); gl.uniformMatrix4fv(this.loc.m, false, matrix); gl.uniform1f(this.loc.op, 0.82);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.loc.cmap, 0);
      const at = (b, l, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0); };
      at(this.buf.pos, this.loc.pos, 2); at(this.buf.u, this.loc.u, 1); at(this.buf.ok, this.loc.ok, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    },
  };
  let geomMode = null;
  function upload() {
    if (!st.mesh || !layer.gl) return;
    const smooth = st.smooth && FIELDS[st.field].smooth, mode = `${st.run.id}|${smooth}`;
    if (geomMode !== mode) { const m = smooth ? st.mesh.smooth : st.mesh.native; layer.setGeometry(m.pos, m.idx); geomMode = mode; }
    const fr = frame(st.h), n = fr.u.length;
    if (smooth) { /* below-threshold cells sit half a colour step under the first bin, so a smoothed echo edge falls midway between cells instead of shrinking toward the echo */
      const sc = FIELDS[st.field].scale, below = MC.STEPPED[sc] ? -0.5 / MC.SCALES[sc].stops.length : -1, ok = new Float32Array(n), u = new Float32Array(n);
      for (let c = 0; c < n; c++) { ok[c] = fr.ok[c]; u[c] = fr.u[c] < 0 ? below : fr.u[c]; } layer.setValues(u, ok); }
    else { const u4 = new Float32Array(n * 4), ok4 = new Float32Array(n * 4); for (let c = 0; c < n; c++) { const u = fr.u[c], o = fr.ok[c]; for (let q = 0; q < 4; q++) { u4[c * 4 + q] = u; ok4[c * 4 + q] = o; } } layer.setValues(u4, ok4); }
    st.map.triggerRepaint();
    return fr;
  }
  function setColors() { const sc = FIELDS[st.field].scale; layer.setColors(MC.colorTable(sc), !!MC.STEPPED[sc]); }

  /* ---------- labels overlay (sharp text above the weather) ---------- */
  const SITES = [["CVG airport", 39.04456, -84.67229], ["TQL Stadium", 39.11113, -84.52229], ["Great American Ball Park", 39.0975, -84.5066], ["Paycor Stadium", 39.0955, -84.5161]];
  function drawLabels() {
    const cv = $("labels"), map = st.map, W = cv.clientWidth, Hh = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hh);
    if (!st.base) return;
    const z = map.getZoom(), fg = css("--text", "#e8eaee"), bg = css("--bg", "#0b0d12"), boxes = [];
    const free = (b) => !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    /* keep labels clear of the overlay panels (info, controls, legend, timeline, note) */
    const cr = cv.getBoundingClientRect(); ["mapInfo", "mapCtl", "legend", "timeline", "mapNote"].forEach((id) => { const e = $(id); if (!e || e.hidden || !e.offsetParent) return; const r = e.getBoundingClientRect(); boxes.push([r.left - cr.left - 3, r.top - cr.top - 3, r.right - cr.left + 3, r.bottom - cr.top + 3]); });
    const text = (x, y, t, size, weight, anchor, color = fg) => {
      ctx.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`; const w = ctx.measureText(t).width, h = size;
      const bx = anchor === "right" ? [x + 6, y - h / 2 - 2, x + 6 + w + 2, y + h / 2 + 2] : [x - w / 2 - 2, y - h - 6, x + w / 2 + 2, y - 4];
      if (bx[0] < 2 || bx[2] > W - 2 || bx[1] < 2 || bx[3] > Hh - 2 || !free(bx)) return false; boxes.push(bx);
      ctx.lineJoin = "round"; ctx.lineWidth = 3.2; ctx.strokeStyle = bg; ctx.fillStyle = color; ctx.textBaseline = "middle";
      const tx = anchor === "right" ? x + 7 : x - w / 2, ty = anchor === "right" ? y : y - h / 2 - 5; ctx.strokeText(t, tx, ty); ctx.fillText(t, tx, ty); return true;
    };
    const pt = (lat, lon) => { const p = map.project([lon, lat]); return [p.x, p.y]; };
    /* selected cell marker first (highest priority) */
    if (st.sel && st.lat) { const g = st.man.grid, per = g.nx * g.ny, c = st.sel[1] * g.nx + st.sel[0], [x, y] = pt(st.lat[c], st.lat[per + c]); ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 6, 12, 12); boxes.push([x - 8, y - 8, x + 8, y + 8]); }
    /* sites and the saved venue */
    if (z >= 7.2) SITES.forEach(([n, la, lo]) => { const [x, y] = pt(la, lo); if (x < 0 || y < 0 || x > W || y > Hh) return; ctx.fillStyle = fg; ctx.strokeStyle = bg; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(x - 3, y - 3, 6, 6); ctx.fill(); ctx.stroke(); text(x, y, n, 11.5, 600, "right"); });
    const L = O.location; if (L && !SITES.some((s) => Math.abs(s[1] - L.lat) < 0.005 && Math.abs(s[2] - L.lon) < 0.005)) { const [x, y] = pt(+L.lat, +L.lon); if (x > 0 && y > 0 && x < W && y < Hh) { ctx.fillStyle = css("--accent", "#4cb4f0"); ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill(); text(x, y, String(L.name).split(",")[0], 12, 700, "right"); } }
    /* cities by population, thinned by zoom and collisions */
    const minPop = z < 6.3 ? 400000 : z < 7 ? 120000 : z < 7.5 ? 30000 : z < 8 ? 12000 : 5000;
    st.base.layers.places.features.forEach((f) => { const p = f.properties; if (p.pop < minPop) return; const [lo, la] = f.geometry.coordinates, [x, y] = pt(la, lo); if (x < 0 || y < 0 || x > W || y > Hh) return;
      const big = p.pop >= 400000, ok = text(x, y, p.name, big ? 13.5 : 12, big ? 700 : 600, "right"); if (ok) { ctx.fillStyle = fg; ctx.strokeStyle = bg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, big ? 3.5 : 2.6, 0, 7); ctx.fill(); ctx.stroke(); } });
    /* interstate / highway route labels: one per route, near the middle of its visible part */
    if (z >= 6.6) { const done = new Set(); st.base.layers.roads.features.forEach((f) => { const lab = f.properties.label; if (!lab || done.has(lab) || f.properties.kind !== "major") return; const ln = f.geometry.coordinates.reduce((a, b) => (b.length > a.length ? b : a), []); const vis = ln.map(([lo, la]) => pt(la, lo)).filter(([x, y]) => x > 30 && y > 30 && x < W - 30 && y < Hh - 30); if (vis.length < 2) return; const [x, y] = vis[Math.floor(vis.length / 2)];
      ctx.font = "700 10.5px system-ui, sans-serif"; const w = ctx.measureText(lab).width + 8, bx = [x - w / 2, y - 8, x + w / 2, y + 8]; if (!free(bx)) return; boxes.push(bx); done.add(lab);
      ctx.fillStyle = css("--panel", "#151922"); ctx.strokeStyle = css("--muted", "#8a93a3"); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx[0], bx[1], w, 16, 4) : ctx.rect(bx[0], bx[1], w, 16); ctx.fill(); ctx.stroke(); ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(lab, x - w / 2 + 4, y + 0.5); }); }
  }

  /* ---------- map, basemap and views ---------- */
  function initMap() {
    const map = new ML.Map({ container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": palette().land } }] },
      center: [-84.5, 39.1], zoom: 6.6, minZoom: 5, maxZoom: 9, attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: false });
    map.touchZoomRotate.disableRotation(); map.addControl(new ML.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ML.AttributionControl({ compact: true, customAttribution: "NOAA HRRR · US Census (us-atlas) · Natural Earth · GeoNames (CC BY 4.0)" }), "bottom-right");
    st.map = map; return new Promise((res) => map.on("load", () => { if (innerWidth < 700) document.querySelectorAll(".maplibregl-ctrl-attrib").forEach((e) => e.classList.remove("maplibregl-compact-show")); res(); }));
  }
  const palette = () => (document.documentElement.getAttribute("data-theme") !== "light"
    ? { land: "#151a22", county: "#3a4250", state: "#cfd5de", road: "#6d5a3c", road2: "#4c4537", river: "#2d5d86", dma: "#7cc4f0", mask: "#0b0e13", maskOp: 0.6 }
    : { land: "#f1f2ee", county: "#b9bec6", state: "#353c47", road: "#c08436", road2: "#d8b98c", river: "#5f9bd0", dma: "#1f6fb0", mask: "#ffffff", maskOp: 0.65 });
  const PAINT = { bg: ["background-color", "land"], mask: ["fill-color", "mask"], "mask-edge": ["line-color", "state"], "rivers-minor": ["line-color", "river"], rivers: ["line-color", "river"], counties: ["line-color", "county"], roads2: ["line-color", "road2"], roads: ["line-color", "road"], states: ["line-color", "state"], dma: ["line-color", "dma"] };
  function applyPalette() { const C = palette(), map = st.map; Object.entries(PAINT).forEach(([id, [prop, k]]) => map.getLayer(id) && map.setPaintProperty(id, prop, C[k])); if (map.getLayer("mask")) map.setPaintProperty("mask", "fill-opacity", C.maskOp); drawLabels(); }
  function addBasemap() {
    const map = st.map, b = st.base.layers, C = palette();
    Object.entries(b).forEach(([k, v]) => map.addSource(k, { type: "geojson", data: v }));
    map.addLayer(layer);
    map.addSource("mask", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-100, 30], [-70, 30], [-70, 48], [-100, 48], [-100, 30]], st.mesh.extent.slice().reverse()] } } });
    map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": C.mask, "fill-opacity": C.maskOp } });
    map.addLayer({ id: "mask-edge", type: "line", source: "mask", paint: { "line-color": C.state, "line-width": 1, "line-dasharray": [2, 2], "line-opacity": 0.6 } });
    /* rivers by Natural Earth rank: the Ohio and other large rivers always; tributaries (Great Miami, Licking…) only when closer */
    map.addLayer({ id: "rivers-minor", type: "line", source: "rivers", filter: [">", ["get", "rank"], 8], minzoom: 7, paint: { "line-color": C.river, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 9, 1.2], "line-opacity": 0.7 } });
    map.addLayer({ id: "rivers", type: "line", source: "rivers", filter: ["<=", ["get", "rank"], 8], paint: { "line-color": C.river, "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["<=", ["get", "rank"], 5], 1.4, 0.7], 9, ["case", ["<=", ["get", "rank"], 5], 3, 1.5]], "line-opacity": 0.9 } });
    map.addLayer({ id: "counties", type: "line", source: "counties", paint: { "line-color": C.county, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 9, 0.9], "line-opacity": 0.8 } });
    map.addLayer({ id: "roads2", type: "line", source: "roads", filter: ["==", ["get", "kind"], "secondary"], minzoom: 7.4, paint: { "line-color": C.road2, "line-width": ["interpolate", ["linear"], ["zoom"], 7.4, 0.6, 9, 1.4] } });
    map.addLayer({ id: "roads", type: "line", source: "roads", filter: ["==", ["get", "kind"], "major"], paint: { "line-color": C.road, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 9, 2.4] } });
    map.addLayer({ id: "states", type: "line", source: "states", paint: { "line-color": C.state, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 9, 2.4] } });
    map.addLayer({ id: "dma", type: "line", source: "dma", paint: { "line-color": C.dma, "line-width": 1.4, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
    applyPalette(); window.addEventListener("ops:theme", applyPalette);
    map.on("render", drawLabels);
  }
  /* zoom limits: the closest view is the Cincinnati DMA; the widest is the model's data area */
  const TRISTATE = [[-86.6, 37.6], [-82.4, 40.7]];
  const DMAPAD = () => (innerWidth < 700 ? { top: 96, bottom: 150, left: 12, right: 12 } : { top: 70, bottom: 70, left: 24, right: 24 });
  function limits() {
    const map = st.map, dma = st.base.dma.bounds, ext = st.mesh.extent, xs = ext.map((p) => p[0]), ys = ext.map((p) => p[1]);
    /* closest zoom = the Cincinnati DMA view. Landscape: the whole DMA fits inside the map (clear of the overlays).
       Portrait phone: the DMA fills the map's height; fitting its width into ~390 px would make 3-km cells ~3 px wide. */
    const c = map.getContainer(), w = c.clientWidth, h = c.clientHeight, PAD = DMAPAD();
    const zFit = map.cameraForBounds(dma, { padding: PAD }).zoom, mY = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)) / (2 * Math.PI);
    const zH = Math.log2((h - 40) / (512 * (mY(dma[1][1]) - mY(dma[0][1])))); // a scale limit, so the overlays' padding is not subtracted
    const zDMA = w >= h ? zFit : Math.max(zFit, zH), zExt = map.cameraForBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 10 }).zoom;
    map.setMaxZoom(zDMA); map.setMinZoom(Math.max(4, zExt - 0.6));
    map.setMaxBounds([[Math.min(...xs) - 2.5, Math.min(...ys) - 1.8], [Math.max(...xs) + 2.5, Math.max(...ys) + 1.8]]);
    st.limits = { zDMA, ext: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]] };
  }
  function goView(v, animate = true) {
    const map = st.map, opt = { padding: { top: 70, bottom: 90, left: 16, right: 16 }, duration: animate ? 600 : 0 };
    if (v === "dma") { const c = map.cameraForBounds(st.base.dma.bounds, { padding: DMAPAD() }); map.easeTo({ center: c.center, zoom: st.limits.zDMA, duration: opt.duration }); } // the DMA view is the closest permitted zoom
    else if (v === "venue") { const L = O.location; if (!L || !st.P.nearest(+L.lat, +L.lon)) { note("The saved venue is outside the model data area."); return; } map.easeTo({ center: [+L.lon, +L.lat], zoom: Math.min(map.getZoom() + 1, map.getMaxZoom()), duration: opt.duration }); }
    else map.fitBounds(TRISTATE, opt); // fixed Tri-State bounds, independent of how large the model data area is
    st.view = v; O.store.set("maps2_view", v); document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  }
  function note(t) { const n = $("mapNote"); n.textContent = t || ""; n.hidden = !t; }

  /* ---------- runs and fields ---------- */
  async function loadRun(id, keepValid) {
    stop(); const r = st.index.runs.find((x) => x.id === id); if (!r) return;
    const prevValid = keepValid && st.man ? Date.parse(st.man.valid[st.h]) : null;
    $("mapInfo").textContent = `Loading ${fmtUTC(Date.parse(r.cycle))} run…`;
    const base = `${DATA.replace(/\/data$/, "")}/${r.path}`;
    try {
      const man = await getJSON(`${base}/manifest.json`), g = man.grid, nh = man.hours.length, fields = {}; let loaded = 0;
      const ll = await getGz(`${base}/${g.latlon.file}`); loaded += g.latlon.gzipBytes;
      await Promise.all(Object.entries(man.fields).map(async ([f, spec]) => { const b = await getGz(`${base}/${spec.file}`); fields[f] = MC.field(spec, b, nh, g.ny, g.nx); loaded += spec.gzipBytes; }));
      const sameGrid = st.man && JSON.stringify(st.man.grid.i0 + "," + st.man.grid.j0 + "," + st.man.grid.nx + "," + st.man.grid.ny) === JSON.stringify(g.i0 + "," + g.j0 + "," + g.nx + "," + g.ny);
      Object.assign(st, { run: r, man, fields, lat: new Float32Array(ll), loaded, P: MC.projector(g) }); st.frames.clear();
      if (!sameGrid || !st.mesh) { st.mesh = MC.mesh(g); geomMode = null; }
    } catch (e) { $("mapInfo").innerHTML = `<span class="state err">This run could not be loaded (${esc(e.message)}).</span>`; return; }
    /* keep the valid time when switching runs; otherwise the nearest available, and say so */
    let msg = null;
    if (prevValid != null) { const k = st.man.valid.findIndex((v) => Date.parse(v) === prevValid); if (k >= 0) st.h = k; else { const near = st.man.valid.map((v, i) => [Math.abs(Date.parse(v) - prevValid), i]).sort((a, b) => a[0] - b[0])[0][1]; st.h = near; msg = `${fmtLocal(prevValid)} is not in this run; showing the nearest valid time.`; } }
    st.h = Math.min(st.h, st.man.hours.length - 1);
    if (!fieldOk(st.field)) { msg = `${FIELDS[st.field].label} is not in this run.`; }
    buildFieldSel(); timeline(); refresh(); if (msg) { note(msg); const at = st.run.id; setTimeout(() => { if (st.run.id === at) refresh(); }, 5000); }
  }
  function buildFieldSel() {
    $("fieldSel").innerHTML = Object.entries(FIELDS).map(([k, f]) => `<option value="${k}" ${fieldOk(k) ? "" : "disabled"}>${esc(f.short || f.label)}${fieldOk(k) ? "" : " (not in this run)"}</option>`).join("");
    if (!fieldOk(st.field)) st.field = "t2m"; $("fieldSel").value = st.field; $("winSel").value = st.win; $("winSel").hidden = st.field !== "precip";
    $("smoothChk").checked = st.smooth; $("smoothChk").disabled = !FIELDS[st.field].smooth;
  }
  function missingHours() { if (st.field === "precip") return st.man.fields.apcp_hour.missingHours; const f = st.man.fields[st.field]; return f ? f.missingHours : []; }
  function timeline() {
    const m = st.man, n = m.hours.length; $("hourSl").max = String(n - 1); $("hourSl").value = String(st.h);
    const miss = new Set(missingHours());
    $("tlTicks").innerHTML = m.hours.map((h, i) => { const hr = +new Date(Date.parse(m.valid[i])).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }); const day = hr === 0; return day || miss.has(h) ? `<i class="${miss.has(h) ? "miss" : "day"}" style="left:${(100 * i) / Math.max(1, n - 1)}%" title="${miss.has(h) ? `F${h} missing` : "midnight"}"></i>` : ""; }).join("");
  }
  function windowText() {
    if (st.field !== "precip") return ""; const H0 = st.man.hours[st.h], c = Date.parse(st.man.cycle), w = st.win === "run" ? H0 : +st.win; if (!H0 || H0 - w < 0) return "window unavailable at this hour";
    return `${st.win === "run" ? "since run start" : `${w}-h total`} · ${fmtUTC(c + (H0 - w) * H)}–${fmtUTC(Date.parse(st.man.valid[st.h]))}`;
  }
  function refresh() {
    if (!st.man) return; const fr = upload(), m = st.man, F = FIELDS[st.field], valid = Date.parse(m.valid[st.h]), H0 = m.hours[st.h];
    const newest = st.index.runs[0], ageH = (Date.now() - Date.parse(newest.cycle)) / H, stale = ageH > 4 || (Date.now() - Date.parse(st.index.generatedAt)) / H > 3;
    const miss = missingHours();
    $("mapInfo").innerHTML = `<b class="fld">HRRR · ${esc(F.label)}</b><div>Init <b>${esc(fmtUTC(Date.parse(m.cycle)))}</b> · F${String(H0).padStart(2, "0")} · valid <b>${esc(fmtLocal(valid))}</b> (${esc(fmtUTC(valid))})</div>${st.field === "precip" ? `<div>${esc(windowText())}</div>` : ""}<div class="st msg${!stale && !miss.length ? " phone-hide" : ""}">${st.smooth && F.smooth ? "Smoothed display (values from original cells)" : "Native 3 km cells"}${stale ? ` · <span class="unavail">stale: newest run ${ageH.toFixed(1)} h old</span>` : ""}${miss.length ? ` · missing F${miss.join(", F")}` : ""}</div>`;
    $("tlValid").textContent = `${fmtLocal(valid)} · F${String(H0).padStart(2, "0")}`; $("hourSl").value = String(st.h);
    const blank = st.field !== "precip" && st.fields[st.field] && !st.fields[st.field].present(H0);
    note(blank ? `No ${F.label.toLowerCase()} for F${H0}: missing from this run (left blank).` : fr && !fr.any && fr.why ? `Unavailable at this hour: ${fr.why}.` : null);
    legend(); inspect(); drawLabels();
    $("runInfo").innerHTML = `Run ${esc(fmtUTC(Date.parse(m.cycle)))} (${esc(st.run.role)}), ${m.hours.length} forecast hours. Downloaded from NOAA: <b>${MB(m.gribBytesDownloaded)}</b> of GRIB2 messages; loaded by this page: <b>${MB(st.loaded)}</b> compressed. Grid ${m.grid.nx}×${m.grid.ny} cells of ${m.grid.DxInMetres / 1000} km; georeference check ${m.grid.georefMaxErrorCells} cells.`;
  }
  function legend() {
    const F = FIELDS[st.field], sc = MC.SCALES[F.scale], stops = sc.stops, title = st.field === "precip" ? `Precipitation (liquid), in · ${st.win === "run" ? "since run start" : `${st.win}-h total`}` : `${F.label}, ${F.units}`;
    const body = F.scale === "t2m" ? `<div class="lgbar" style="background:linear-gradient(to right,${stops.map(([t, c]) => `rgb(${c.join(",")}) ${(((t - stops[0][0]) / (stops[stops.length - 1][0] - stops[0][0])) * 100).toFixed(1)}%`).join(",")})"></div><div class="lgticks">${stops.filter((s, k) => k % 2 === 0 || s[0] === 32).map(([t]) => `<span style="left:${(((t - stops[0][0]) / (stops[stops.length - 1][0] - stops[0][0])) * 100).toFixed(1)}%">${t}</span>`).join("")}</div>`
      : `<div class="lgs">${stops.map(([t, c], k) => `<span class="lg"><i style="background:rgb(${c.join(",")})"></i>${t}${stops[k + 1] ? "" : "+"}</span>`).join("")}</div>`;
    $("legend").innerHTML = `<div class="lgt">${esc(title)}</div>${body}`;
  }
  const hav = (a, b, c, d) => { const R = 6371.2, t = (x) => (x * Math.PI) / 180, dl = t(c - a), dn = t(d - b), h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function inspect() {
    if (!st.sel || !st.man) return; const [i, j] = st.sel, g = st.man.grid, per = g.nx * g.ny, c = j * g.nx + i, la = st.lat[c], lo = st.lat[per + c], F = FIELDS[st.field], r = valueAt(st.h, i, j);
    const val = r.v == null ? `<span class="unavail">unavailable</span>${r.why ? ` (${esc(r.why)})` : ""}` : (st.field.startsWith("ref") && r.v < 5) ? `<b>no echo</b> <span class="msg">(model value ${r.v.toFixed(0)} dBZ)</span>` : `<b>${r.v.toFixed(F.dec)} ${esc(F.units)}</b>`;
    $("inspect").innerHTML = `<div class="inspect-v">${esc(F.label)}: ${val}</div><div class="msg">${st.selName ? esc(st.selName) + " · " : ""}HRRR cell ${i},${j} centred at ${la.toFixed(4)}, ${lo.toFixed(4)} (GRIB coordinates)${st.selDist != null ? ` · ${st.selDist.toFixed(1)} km from the point` : ""} · valid ${esc(fmtLocal(Date.parse(st.man.valid[st.h])))}${st.field === "precip" ? " · " + esc(windowText()) : ""}${st.smooth && F.smooth ? " · original cell value (the map colours are smoothed)" : ""}</div>`;
  }
  function select(lat, lon, name) { const c = st.P && st.P.nearest(lat, lon); if (!c) { st.sel = null; $("inspect").innerHTML = '<p class="msg">That point is outside the model data area.</p>'; drawLabels(); return; } const g = st.man.grid, per = g.nx * g.ny; st.sel = c; st.selName = name || null; st.selDist = hav(lat, lon, st.lat[c[1] * g.nx + c[0]], st.lat[per + c[1] * g.nx + c[0]]); inspect(); drawLabels(); }
  function step(d) { if (!st.man) return; st.h = (st.h + d + st.man.hours.length) % st.man.hours.length; refresh(); }
  function stop() { if (st.play) cancelAnimationFrame(st.play); st.play = null; $("playBtn").textContent = "PLAY"; $("playBtn").setAttribute("aria-pressed", "false"); }
  function play() {
    if (st.play) { stop(); return; } for (let h = 0; h < st.man.hours.length; h++) frame(h); // precompute every frame before playing
    let last = 0; const tick = (t) => { if (t - last > 600) { last = t; step(1); } st.play = requestAnimationFrame(tick); }; st.play = requestAnimationFrame(tick);
    $("playBtn").textContent = "PAUSE"; $("playBtn").setAttribute("aria-pressed", "true");
  }

  async function init() {
    if (!ML || !(() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })()) { $("mapInfo").innerHTML = '<span class="state err">This browser cannot draw the interactive map (WebGL unavailable).</span>'; return; }
    try { [st.base, st.index] = await Promise.all([getJSON("assets/maps/basemap.json"), getJSON(`${DATA}/index.json`)]); }
    catch (e) { $("mapInfo").innerHTML = `<span class="state err">Map data unavailable (${esc(e.message)}).</span>`; return; }
    if (!st.index.runs.length) { $("mapInfo").textContent = "No published runs yet."; return; }
    $("runSel").innerHTML = st.index.runs.map((r) => `<option value="${esc(r.id)}">${esc(fmtUTC(Date.parse(r.cycle)))} · ${r.hoursExpected} h${r.role.startsWith("latest") ? " · newest" : ""}</option>`).join("");
    await initMap();
    await loadRun(st.index.runs[0].id, false);
    addBasemap(); setColors(); limits(); goView(st.view === "venue" ? "tristate" : st.view, false); upload();
    $("placeSel").innerHTML = '<option value="">Click or tap the map, or choose…</option>' + [...SITES.map((s) => s[0]), "Dayton", "Columbus", "Louisville", "Lexington"].map((n) => `<option>${esc(n)}</option>`).join("");
    const PL = { Dayton: [39.9024, -84.2194], Columbus: [39.998, -82.8919], Louisville: [38.1744, -85.736], Lexington: [38.0365, -84.6059] };
    $("placeSel").addEventListener("change", () => { const n = $("placeSel").value, s = SITES.find((x) => x[0] === n), p = s ? [s[1], s[2]] : PL[n]; if (p) select(p[0], p[1], n); });
    st.map.on("click", (e) => { $("placeSel").value = ""; select(e.lngLat.lat, e.lngLat.lng, null); });
    $("fieldSel").addEventListener("change", () => { st.field = $("fieldSel").value; O.store.set("maps2_field", st.field); buildFieldSel(); setColors(); geomMode = null; timeline(); refresh(); });
    $("winSel").addEventListener("change", () => { st.win = $("winSel").value; O.store.set("maps2_win", st.win); refresh(); });
    $("runSel").addEventListener("change", async () => { await loadRun($("runSel").value, true); setColors(); upload(); });
    $("smoothChk").addEventListener("change", () => { st.smooth = $("smoothChk").checked; O.store.set("maps2_smooth", st.smooth); geomMode = null; refresh(); });
    $("hourSl").addEventListener("input", () => { st.h = +$("hourSl").value; refresh(); });
    $("playBtn").addEventListener("click", play);
    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => goView(b.dataset.view)));
    const L = O.location; $("venueBtn").textContent = L ? String(L.name).split(",")[0] : "Venue"; $("venueBtn").disabled = !(L && st.P.nearest(+L.lat, +L.lon));
    if (!document.fullscreenEnabled) $("fsBtn").hidden = true;
    $("fsBtn").addEventListener("click", () => { const s = $("stage"); if (document.fullscreenElement) document.exitFullscreen(); else if (s.requestFullscreen) s.requestFullscreen(); });
    document.addEventListener("fullscreenchange", () => { $("fsBtn").setAttribute("aria-pressed", String(!!document.fullscreenElement)); $("fsBtn").textContent = document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN"; setTimeout(() => { st.map.resize(); limits(); }, 50); });
    $("stage").addEventListener("keydown", (e) => { if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return; if (e.key === "ArrowRight" || e.key === "]") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft" || e.key === "[") { e.preventDefault(); step(-1); } else if (e.key === " ") { e.preventDefault(); play(); } });
    /* phones: the info box sits just below the (wrapping) control rows */
    const place = () => { $("mapInfo").style.top = innerWidth < 700 ? `${$("mapCtl").offsetTop + $("mapCtl").offsetHeight + 4}px` : ""; };
    if (window.ResizeObserver) new ResizeObserver(place).observe($("mapCtl")); place();
    let rz = null; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { limits(); place(); }, 200); });
    st.layer = layer; window.__maps = st; // test hook (read-only use)
  }
  init();
})();
