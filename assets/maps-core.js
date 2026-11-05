/* Forecast Ops model maps: pure functions shared by the viewer and its tests (maps-core-v1).
   The display uses the model's OWN Lambert conformal projection, so every native grid cell is an exact
   rectangle on screen: nothing is resampled. Locations and boundaries are projected into the grid with
   the GRIB projection parameters stored in each run's manifest. */
(function (root) {
  "use strict";
  const VERSION = "maps-core-v2";
  const rad = (d) => (d * Math.PI) / 180;

  /* Spherical Lambert conformal conic, GRIB2 template 3.30. Returns grid coordinates (fractional cell
     index within the crop) for a latitude/longitude, and back. */
  function projector(grid) {
    const R = grid.radius, p1 = rad(grid.Latin1InDegrees), p2 = rad(grid.Latin2InDegrees), p0 = rad(grid.LaDInDegrees);
    const l0 = rad(((grid.LoVInDegrees + 180) % 360 + 360) % 360 - 180);
    const n = Math.abs(p1 - p2) < 1e-12 ? Math.sin(p1) : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    const F = (Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n)) / n, rho0 = (R * F) / Math.pow(Math.tan(Math.PI / 4 + p0 / 2), n);
    const xy = (lat, lon) => {
      const L = rad(((lon + 180) % 360 + 360) % 360 - 180), rho = (R * F) / Math.pow(Math.tan(Math.PI / 4 + rad(lat) / 2), n);
      const th = n * ((((L - l0) + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      return [rho * Math.sin(th), rho0 - rho * Math.cos(th)];
    };
    const toCell = (lat, lon) => { const [x, y] = xy(lat, lon); return [(x - grid.x0) / grid.DxInMetres - grid.i0, (y - grid.y0) / grid.DyInMetres - grid.j0]; };
    const fromCell = (ci, cj) => {
      const x = (ci + grid.i0) * grid.DxInMetres + grid.x0, y = (cj + grid.j0) * grid.DyInMetres + grid.y0, dy = rho0 - y;
      const rho = Math.sign(n) * Math.hypot(x, dy), th = Math.atan2(Math.sign(n) * x, Math.sign(n) * dy);
      const lat = 2 * Math.atan(Math.pow((R * F) / rho, 1 / n)) - Math.PI / 2, lon = l0 + th / n;
      return [(lat * 180) / Math.PI, ((((lon * 180) / Math.PI) + 180) % 360 + 360) % 360 - 180];
    };
    /* nearest native cell; null outside the crop */
    const nearest = (lat, lon) => { const [fi, fj] = toCell(lat, lon), i = Math.round(fi), j = Math.round(fj); return i >= 0 && j >= 0 && i < grid.nx && j < grid.ny ? [i, j] : null; };
    return { toCell, fromCell, nearest };
  }

  /* One field's decoded block: values[hour][j][i] as a flat typed array. */
  function field(spec, buf, nHours, ny, nx) {
    const a = spec.dtype === "int16" ? new Int16Array(buf) : new Uint16Array(buf), miss = spec.dtype === "int16" ? -32768 : 65535, per = ny * nx;
    if (a.length !== nHours * per) throw new Error(`field size ${a.length} != ${nHours}x${ny}x${nx}`);
    const at = (h, i, j) => { if (h < 0 || h >= nHours || i < 0 || j < 0 || i >= nx || j >= ny) return null; const v = a[h * per + j * nx + i]; return v === miss ? null : v * spec.scale; };
    const present = (h) => !(spec.missingHours || []).includes(h);
    return { at, present, raw: a, per, miss };
  }

  /* Precipitation over a window ending at forecast hour index h, from compatible fields of this run only.
     width "run": the GRIB 0-N accumulation as published. Otherwise the sum of consecutive one-hour GRIB
     accumulations (N-1)-N for the last `width` hours; unavailable (null) unless every hour in the window
     is present with exactly that interval. Returns {mm, from, to} or {mm:null, why}. */
  function precip(man, fields, h, width, i, j) {
    const hrs = man.hours, H = hrs[h];
    if (width === "run") {
      const iv = man.fields.apcp_run.intervals[h];
      if (H === 0 || (iv && iv.endStep === iv.startStep)) return { mm: null, why: "no accumulation at the start of the run" }; // GRIB 0-0 h: zero-length interval
      if (!iv || iv.startStep !== 0 || iv.endStep !== H) return { mm: null, why: "run total missing for this hour" };
      const v = fields.apcp_run.at(h, i, j); return v == null ? { mm: null, why: "missing" } : { mm: v, from: 0, to: H };
    }
    if (H - width < 0) return { mm: null, why: `only ${H} h of this run precede this time` };
    let s = 0;
    for (let k = H - width + 1; k <= H; k++) {
      const hi = hrs.indexOf(k), iv = hi < 0 ? null : man.fields.apcp_hour.intervals[hi];
      if (!iv || iv.startStep !== k - 1 || iv.endStep !== k) return { mm: null, why: `hour ${k} is missing` };
      const v = fields.apcp_hour.at(hi, i, j); if (v == null) return { mm: null, why: `hour ${k} is missing` };
      s += v;
    }
    return { mm: s, from: H - width, to: H };
  }

  /* Colour scales: stepped, labelled, original. Returns [r,g,b,a] or null (transparent). */
  const SCALES = {
    t2m: { units: "°F", stops: [[-10, [94, 60, 153]], [0, [77, 92, 186]], [10, [62, 125, 214]], [20, [72, 165, 230]], [32, [120, 200, 236]], [33, [96, 186, 140]], [40, [128, 200, 110]], [50, [196, 214, 92]], [60, [238, 204, 78]], [70, [240, 150, 60]], [80, [222, 92, 52]], [90, [180, 40, 52]], [100, [128, 20, 60]]], step: 2 },
    d2m: { units: "°F", stops: [[-20,[135,91,60]],[0,[174,126,73]],[20,[195,169,103]],[35,[155,191,123]],[45,[83,169,116]],[55,[42,150,154]],[60,[58,134,184]],[65,[89,108,185]],[70,[133,83,172]],[75,[176,66,143]],[80,[216,91,136]]] },
    wind: { units: "mph", stops: [[0,[36,56,83]],[5,[52,94,139]],[10,[43,139,159]],[15,[71,169,135]],[20,[174,190,81]],[30,[230,164,57]],[40,[220,99,55]],[50,[181,57,103]],[65,[156,103,191]]] },
    cloud: { units: "%", stops: [[0,[27,42,61]],[20,[59,80,103]],[40,[94,114,136]],[60,[143,158,175]],[80,[190,199,209]],[100,[237,240,244]]] },
    precip: { units: "in", stops: [[0.01, [178, 226, 178]], [0.05, [120, 198, 121]], [0.10, [49, 163, 84]], [0.25, [0, 109, 44]], [0.50, [44, 127, 184]], [0.75, [37, 52, 148]], [1.00, [122, 1, 119]], [1.50, [197, 27, 138]], [2.00, [247, 104, 161]], [3.00, [253, 224, 239]]] },
    refc: { units: "dBZ", stops: [[5, [170, 210, 232]], [15, [95, 170, 220]], [20, [40, 180, 90]], [25, [20, 145, 60]], [30, [10, 110, 40]], [35, [240, 220, 40]], [40, [235, 165, 30]], [45, [225, 95, 25]], [50, [200, 20, 20]], [55, [150, 0, 60]], [60, [190, 70, 200]], [65, [245, 245, 245]]] },
  };
  function color(scale, v) {
    if (v == null || !Number.isFinite(v)) return null;
    const st = SCALES[scale].stops;
    if (scale === "t2m") { // continuous ramp between stops, in 2 degF steps; freezing stays a hard boundary
      const q = Math.floor(v / 2) * 2 + 1, x = Math.max(st[0][0], Math.min(st[st.length - 1][0], q));
      for (let k = 0; k < st.length - 1; k++) { const [a, ca] = st[k], [b, cb] = st[k + 1]; if (x >= a && x <= b) { if (b - a <= 1) return [...(x < b ? ca : cb), 205]; const f = (x - a) / (b - a); return [0, 1, 2].map((c) => Math.round(ca[c] + (cb[c] - ca[c]) * f)).concat(205); } }
      return [...st[x <= st[0][0] ? 0 : st.length - 1][1], 205];
    }
    if (scale === "d2m") {
      const x = Math.max(st[0][0], Math.min(st[st.length-1][0], v));
      for (let k=0;k<st.length-1;k++) { const [a,ca]=st[k], [b,cb]=st[k+1]; if(x>=a&&x<=b) { const f=(x-a)/(b-a); return ca.map((c,i)=>Math.round(c+(cb[i]-c)*f)).concat(205); } }
      return [...st[st.length-1][1],205];
    }
    if (v < st[0][0]) return null; // below the lowest threshold: transparent (no precipitation / echo shown)
    let c = st[0][1]; for (const [t, rgb] of st) { if (v >= t) c = rgb; } return [...c, 215];
  }
  const mmToIn = (mm) => (mm == null ? null : mm / 25.4);

  /* ---------- GPU rendering support (maps-core-v2) ----------
     Web Mercator coordinates in MapLibre's convention ([0,1] x [0,1]). Each native cell becomes a quad
     whose corners are the projection's own cell corners (i +/- 0.5, j +/- 0.5), so a cell is drawn
     exactly where the model put it; nothing is resampled. */
  const merc = (lat, lon) => [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2];
  function mesh(grid) {
    const P = projector(grid), nx = grid.nx, ny = grid.ny;
    /* corner lattice (nx+1) x (ny+1) shared by neighbouring cells */
    const cx = new Float64Array((nx + 1) * (ny + 1) * 2);
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const [la, lo] = P.fromCell(i - 0.5, j - 0.5), m = merc(la, lo), k = (j * (nx + 1) + i) * 2; cx[k] = m[0]; cx[k + 1] = m[1]; }
    const nPos = new Float32Array(nx * ny * 8), nIdx = new Uint32Array(nx * ny * 6);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i, corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      corners.forEach(([a, b], q) => { const k = (b * (nx + 1) + a) * 2; nPos[c * 8 + q * 2] = cx[k]; nPos[c * 8 + q * 2 + 1] = cx[k + 1]; });
      nIdx.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4, c * 4 + 2, c * 4 + 3], c * 6);
    }
    /* smoothing mesh: vertices at cell centres, two triangles per square of four centres */
    const sPos = new Float32Array(nx * ny * 2), sIdx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const [la, lo] = P.fromCell(i, j), m = merc(la, lo); sPos[(j * nx + i) * 2] = m[0]; sPos[(j * nx + i) * 2 + 1] = m[1]; }
    let t = 0; for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx; sIdx.set([a, b, c, a, c, d], t); t += 6; }
    /* data extent: outline of the outer cell edges, as lon/lat (for the outside-data mask) */
    const ring = [], edge = (i, j) => { const [la, lo] = P.fromCell(i - 0.5, j - 0.5); ring.push([lo, la]); };
    for (let i = 0; i <= nx; i++) edge(i, 0); for (let j = 1; j <= ny; j++) edge(nx, j); for (let i = nx - 1; i >= 0; i--) edge(i, ny); for (let j = ny - 1; j >= 1; j--) edge(0, j); ring.push(ring[0]);
    return { nx, ny, native: { pos: nPos, idx: nIdx }, smooth: { pos: sPos, idx: sIdx }, extent: ring, merc };
  }
  /* value -> colour-table coordinate u in [0,1]; -1 = below the first threshold (transparent).
     Stepped scales map to the centre of their step, so native rendering shows exact legend colours. */
  const STEPPED = { precip: true, refc: true, wind: true, cloud: true };
  function scaleU(scale, v) {
    if (v == null || !Number.isFinite(v)) return null;
    const st = SCALES[scale].stops, n = st.length;
    if (STEPPED[scale]) { if (v < st[0][0]) return -1; let k = 0; for (let q = 0; q < n; q++) if (v >= st[q][0]) k = q; return (k + 0.5) / n; }
    const lo = st[0][0], hi = st[n - 1][0]; return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  }
  /* 256-entry RGBA colour table matching scaleU and the legend */
  function colorTable(scale) {
    const st = SCALES[scale].stops, n = st.length, out = new Uint8Array(256 * 4);
    for (let x = 0; x < 256; x++) {
      const u = (x + 0.5) / 256; let c;
      if (STEPPED[scale]) c = st[Math.min(n - 1, Math.floor(u * n))][1];
      else { const v = st[0][0] + u * (st[n - 1][0] - st[0][0]); c = color(scale, v).slice(0, 3); }
      out.set([c[0], c[1], c[2], 255], x * 4);
    }
    return out;
  }

  const api = { VERSION, projector, field, precip, SCALES, color, mmToIn, mesh, merc, scaleU, colorTable, STEPPED };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MapsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
