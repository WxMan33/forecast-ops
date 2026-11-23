/* Model maps: full-CONUS HRRR, NBM and RRFS beta (maps.html?domain=conus[&model=nbm|rrfs]). A separate viewer from the Tri-State maps.
   Data: forecast-ops-maps conus-v1 tiles (see maps-conus-core.js). Drawing: a custom MapLibre WebGL layer
   samples the native grid from a texture with nearest-cell lookup, on a mesh whose nodes sit at exact
   projected cell edges, so every model cell is drawn where HRRR put it; outside the grid nothing is drawn.
   Only the tiles in view are downloaded, at the coarsest level that still shows at least one cell per
   ~2 screen pixels; every click reads the native cell at full precision. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, esc = O.esc, MC = window.MapsCore, K = window.MapsConusCore, ML = window.maplibregl;
  const TZ = "America/New_York", H = 3600e3, Q = new URLSearchParams(location.search);
  /* Data host: the isolated Model Maps preview (raw.githack.com) reads the R2 bucket, refreshed alongside the GitHub Pages
     build and the only host with RRFS and NBM through Day 3; everywhere else keeps GitHub Pages. ?data= overrides both. */
  const DATA_HOSTS = { r2: "https://pub-d40aeef98e1146a78125908fd1f9c48f.r2.dev/data", pages: "https://wxman33.github.io/forecast-ops-maps/data" };
  const DATA = (Q.get("data") || (location.hostname === "raw.githack.com" ? DATA_HOSTS.r2 : DATA_HOSTS.pages)).replace(/\/$/, "");
  const SITE = DATA.replace(/\/data$/, "");
  const PHONE = () => innerWidth < 700;
  /* the models this viewer can show; each is published in the same conus-v1 format under its own run list */
  const MODELS = {
    hrrr: { key: "hrrr", name: "HRRR", res: "3 km", label: "HRRR 3 km", index: "conus/index.json", credit: "NOAA/NCEP HRRR", source: "NOAA/NCEP HRRR (NOAA Open Data Dissemination)",
      about: "NOAA HRRR, full CONUS 3 km grid (1799 × 1059 cells)" },
    rrfs: { key: "rrfs", name: "RRFS", res: "3 km", label: "RRFS 3 km", index: "conus/rrfs/index.json", credit: "NOAA/NCEP RRFS", source: "NOAA/NCEP RRFS (NOAA Open Data Dissemination)",
      about: "NOAA/NCEP RRFS (Rapid Refresh Forecast System), full CONUS 3 km grid (1799 × 1059 cells, the HRRR grid)" },
    nbm: { key: "nbm", name: "NBM", res: "2.5 km", label: "NBM 2.5 km", index: "conus/nbm/index.json", credit: "NOAA/NWS National Blend of Models", source: "NOAA/NWS National Blend of Models (NOAA Open Data Dissemination)",
      about: "NOAA/NWS National Blend of Models (NBM), full CONUS 2.5 km grid (2345 × 1597 cells)" },
  };
  const M = MODELS[Q.get("model")] || MODELS.hrrr;
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
  /* Values overlay: how a number is written on the map, and which are left off (dry zeros) */
  const whole = (v) => String(Math.round(v)), lt = (min) => (v) => v >= min;
  const inch = (v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const snowIn = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const GUST = [[10, [178, 214, 226]], [20, [116, 186, 196]], [30, [82, 160, 120]], [40, [214, 196, 72]], [50, [226, 140, 52]], [60, [204, 70, 52]], [75, [156, 54, 120]], [90, [212, 150, 220]]];
  const FRZR = [[0.01, [244, 200, 226]], [0.05, [232, 152, 200]], [0.1, [214, 104, 176]], [0.25, [176, 64, 156]], [0.5, [128, 40, 140]], [0.75, [92, 30, 120]], [1, [60, 20, 96]]];
  const POP = [[5, [222, 236, 214]], [10, [190, 222, 178]], [20, [142, 198, 140]], [30, [92, 172, 120]], [40, [52, 146, 116]], [50, [40, 120, 150]], [60, [44, 94, 170]],
    [70, [70, 70, 170]], [80, [112, 56, 160]], [90, [160, 48, 140]]];
  const pct = (v) => `${Math.round(v)}%`;
  const GROUPS = ["Surface", "Precip & Snow", "Severe", "Upper Air"];
  const FIELDS = {
    t2m: { group: "Surface", vfmt: whole, label: "2-m temperature", units: "°F", dec: 1, color: (v) => MC.color("t2m", v), range: [-20, 120],
      legend: { stops: MC.SCALES.t2m.stops, ticks: [-10, 0, 10, 20, 32, 40, 50, 60, 70, 80, 90, 100, 110] } },
    d2m: { group: "Surface", vfmt: whole, label: "2-m dew point", units: "°F", dec: 1, color: (v) => MC.color("d2m", v), range: [-30, 90],
      legend: { stops: MC.SCALES.d2m.stops, ticks: [-20, 0, 20, 35, 45, 55, 60, 65, 70, 75, 80] } },
    gust: { group: "Surface", vfmt: whole, label: "Surface wind gust", units: "mph", dec: 0, color: stepped(GUST), range: [0, 120], steps: GUST,
      note: `${M.name}'s instantaneous gust diagnostic at the valid time, not an hourly maximum.` },
    refc: { group: "Severe", label: "Composite reflectivity (simulated)", short: "Sim. composite reflectivity", units: "dBZ", dec: 1, color: stepped(REFC), range: [-20, 80], steps: REFC,
      note: "Model-simulated reflectivity, not radar." },
    ptype: { group: "Precip & Snow", label: "Precipitation type", units: "", dec: 0, cat: PTYPE, range: [0, 5],
      color: (v) => { const c = PTYPE[Math.round(v)]; return c ? [...c[1], 225] : null; },
      note: "Where the model is precipitating at the valid time. Several types at once: freezing rain > ice pellets > snow > rain." },
    apcp1h: { group: "Precip & Snow", vfmt: inch, vmin: lt(0.01), label: "1-h precipitation", units: "in", dec: 2, color: stepped(PRECIP), range: [0, 8], steps: PRECIP, window: 1 },
    apcp_run: { group: "Precip & Snow", vfmt: inch, vmin: lt(0.01), label: "Total precipitation since run start", short: "Run-total precipitation", units: "in", dec: 2, color: stepped(PRECIP), range: [0, 30], steps: PRECIP, window: "run" },
    asnow1h: { group: "Precip & Snow", vfmt: snowIn, vmin: lt(0.1), label: `1-h snowfall (${M.name})`, units: "in", dec: 1, color: stepped(SNOW1H), range: [0, 8], steps: SNOW1H, window: 1,
      note: `${M.name}'s own snowfall (variable snow density), not 10:1. Hourly values are the difference of the run totals.` },
    frzr_run: { group: "Precip & Snow", vfmt: (v) => v.toFixed(2), vmin: lt(0.01), label: "Freezing rain since run start", short: "Run-total freezing rain", units: "in", dec: 2, color: stepped(FRZR), range: [0, 3], steps: FRZR, window: "run",
      note: "Liquid equivalent of freezing rain, not ice thickness on surfaces." },
    pop1h: { group: "Precip & Snow", vfmt: pct, vmin: lt(1), label: "1-h chance of precipitation (NBM)", short: "1-h PoP", units: "%", dec: 0, color: stepped(POP), range: [0, 100], steps: POP, window: 1,
      note: "NBM's chance of at least 0.01 in during the hour." },
    pop6h: { group: "Precip & Snow", vfmt: pct, vmin: lt(1), label: "6-h chance of precipitation (NBM)", short: "6-h PoP", units: "%", dec: 0, color: stepped(POP), range: [0, 100], steps: POP, window: 6,
      note: "NBM's chance of at least 0.01 in during the 6 hours; posted for windows ending 00, 06, 12 and 18Z.", ends: "00, 06, 12 and 18Z" },
    apcp6: { group: "Precip & Snow", vfmt: inch, vmin: lt(0.01), label: "6-h precipitation (same window across runs)", short: "6-h precipitation", units: "in", dec: 2, color: stepped(PRECIP), range: [0, 20], steps: PRECIP, window: 6, ends: "00, 06, 12 and 18Z",
      note: "Run total at the end of the window minus the run total at its start, cell by cell." },
    apcp12: { group: "Precip & Snow", vfmt: inch, vmin: lt(0.01), label: "12-h precipitation (same window across runs)", short: "12-h precipitation", units: "in", dec: 2, color: stepped(PRECIP), range: [0, 25], steps: PRECIP, window: 12, ends: "00 and 12Z",
      note: "Run total at the end of the window minus the run total at its start, cell by cell." },
    asnow6: { group: "Precip & Snow", vfmt: snowIn, vmin: lt(0.1), label: `6-h snowfall (${M.name}, same window across runs)`, short: "6-h snowfall", units: "in", dec: 1, color: stepped(SNOWRUN), range: [0, 60], steps: SNOWRUN, window: 6, ends: "00, 06, 12 and 18Z",
      note: `${M.name}'s own snowfall (variable density, not 10:1): run total at the end of the window minus the run total at its start.` },
    asnow12: { group: "Precip & Snow", vfmt: snowIn, vmin: lt(0.1), label: `12-h snowfall (${M.name}, same window across runs)`, short: "12-h snowfall", units: "in", dec: 1, color: stepped(SNOWRUN), range: [0, 60], steps: SNOWRUN, window: 12, ends: "00 and 12Z",
      note: `${M.name}'s own snowfall (variable density, not 10:1): run total at the end of the window minus the run total at its start.` },
    asnow_run: { group: "Precip & Snow", vfmt: snowIn, vmin: lt(0.1), label: `Total snowfall since run start (${M.name})`, short: "Run-total snowfall", units: "in", dec: 1, color: stepped(SNOWRUN), range: [0, 60], steps: SNOWRUN, window: "run",
      note: `${M.name}'s own snowfall (variable snow density), not 10:1.` },
  };
  /* Same-window fields, derived in the browser from a run's own run totals: window total = total(end) - total(start), at
     native resolution, then the display levels rebuilt with the pipeline's own rule. Windows end at fixed UTC hours so
     two runs can be compared over exactly the same hours. tol: decreases treated as packing noise (stored units). */
  const WIN = { apcp6: { base: "apcp_run", w: 6, tol: 5 }, apcp12: { base: "apcp_run", w: 12, tol: 5 }, asnow6: { base: "asnow_run", w: 6, tol: 5 }, asnow12: { base: "asnow_run", w: 12, tol: 5 } };
  const publishes = (published, k) => published.has(k) || (WIN[k] && published.has(WIN[k].base));
  function derive(man) {
    if (!man || !man.fields) return man; const c = Date.parse(man.cycle);
    Object.entries(WIN).forEach(([id, D]) => { const B = man.fields[D.base]; if (!B || man.fields[id]) return; const hours = {};
      man.hours.forEach((h) => { const end = c + h * H, start = end - D.w * H, rb = B.hours[String(h)];
        if (new Date(end).getUTCHours() % D.w) { hours[h] = { notApplicable: `${D.w}-h windows end at ${FIELDS[id].ends}` }; return; }
        if (h - D.w < 0) { hours[h] = { notApplicable: `this run starts at ${fmtUTC(c)}, after the window began (${fmtUTC(start)}), so it has no total for the whole window` }; return; }
        const ra = h - D.w === 0 ? {} : B.hours[String(h - D.w)];
        if (!rb || rb.notApplicable || !ra || ra.notApplicable) return;   /* an end or start hour not published: missing */
        hours[h] = { derived: [h - D.w, h], points: rb.points && (h - D.w === 0 || ra.points) ? true : undefined }; });
      const { hours: _h, ...spec } = B;
      man.fields[id] = { ...spec, label: FIELDS[id].label, window: `${D.w} h ending ${FIELDS[id].ends}`, coarse: B.coarse, derivedFrom: D.base,
        derivation: `computed in the viewer: ${D.base}(window end) - ${D.base}(window start) of the same run, per native cell; decreases up to ${D.tol} stored units set to 0, larger ones left missing; display levels by the pipeline's rule (${B.coarse}, rounded half to even)`, hours };
    });
    return man;
  }
  /* the field menu, grouped the way it's used on shift; groups with nothing published yet say so */
  function fieldOptions(published) {
    const ok = ([k]) => !published.size || publishes(published, k);
    return GROUPS.map((g) => { const fs = Object.entries(FIELDS).filter(([, f]) => f.group === g).filter(ok);
      return `<optgroup label="${esc(g)}">${fs.length ? fs.map(([k, f]) => `<option value="${k}">${esc(f.label)}</option>`).join("") : '<option disabled>Queued: not published yet</option>'}</optgroup>`; }).join("");
  }
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
  const key = (fh, L, tx, ty, f = st.field) => `${st.run.id}|${f}|${fh}|${K.tileName(L, tx, ty)}`;
  st.requests = 0;
  function remember(k, e) {
    st.tiles.set(k, e); st.bytes += e.size;
    while (st.bytes > CACHE_LIMIT() && st.tiles.size > 1) { const [k0, e0] = st.tiles.entries().next().value; if (k0 === k) break; st.tiles.delete(k0); st.bytes -= e0.size; }
  }
  const gunzipBytes = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  /* the tiles of one level and hour; packed runs fetch neighbouring tiles with one HTTP range request */
  function tiles(fh, L, list, f = st.field) {
    if (WIN[f]) return list.map(([tx, ty]) => windowTile(fh, L, tx, ty, f));
    const out = list.map(([tx, ty]) => { const k = key(fh, L, tx, ty, f); if (st.tiles.has(k)) { const e = st.tiles.get(k); st.tiles.delete(k); st.tiles.set(k, e); return null; } return [tx, ty, k]; }).filter(Boolean);
    if (out.length) {
      if (st.man.layout !== "packed") out.forEach(([tx, ty, k]) => {
        const d = K.tileDims(st.man, L, tx, ty), url = `${SITE}/${st.run.path}/${f}/f${String(fh).padStart(2, "0")}/${K.tileName(L, tx, ty)}`, e = { t: null, size: d.nx * d.ny * 2 };
        st.requests++; e.p = gunzip(url).then((raw) => (e.t = K.decodeTile(raw, d.ny, d.nx))); e.p.catch(() => st.tiles.get(k) === e && st.tiles.delete(k)); remember(k, e); });
      else {
        const rec = st.man.fields[f].hours[String(fh)], ix = rec ? (rec.ix || (rec.ix = K.packIndex(st.man, rec))) : null, byName = {};
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
    return list.map(([tx, ty]) => st.tiles.get(key(fh, L, tx, ty, f)).p);
  }
  /* one display tile of a same-window field: the native end and start tiles of the run total under it, differenced, then
     coarsened to level L exactly as the pipeline builds its levels */
  function windowTile(fh, L, tx, ty, f) {
    const k = key(fh, L, tx, ty, f);
    if (st.tiles.has(k)) { const e = st.tiles.get(k); st.tiles.delete(k); st.tiles.set(k, e); return e.p; }
    const D = WIN[f], spec = st.man.fields[f], T = st.man.tile, g = st.man.grid, s = 2 ** L, i0 = tx * T * s, j0 = ty * T * s, W = Math.min(T * s, g.nx - i0), Hh = Math.min(T * s, g.ny - j0);
    const l0 = []; for (let b = j0 / T; b <= Math.floor((j0 + Hh - 1) / T); b++) for (let a = i0 / T; a <= Math.floor((i0 + W - 1) / T); a++) l0.push([a, b]);
    const region = (ts) => { const q = new Int16Array(W * Hh); l0.forEach(([a, b], n) => { const t = ts[n], oi = a * T - i0, oj = b * T - j0;
      for (let j = 0; j < t.ny; j++) q.set(t.values.subarray(j * t.nx, (j + 1) * t.nx), (oj + j) * W + oi); }); return q; };
    const d = K.tileDims(st.man, L, tx, ty), e = { t: null, size: d.nx * d.ny * 2 }, h0 = fh - D.w;
    e.p = Promise.all([Promise.all(tiles(fh, 0, l0, D.base)), h0 > 0 ? Promise.all(tiles(h0, 0, l0, D.base)) : null]).then(([end, start]) => {
      const c = K.coarsenRegion(K.windowDiff(region(end), start ? region(start) : null, D.tol), W, Hh, L, spec.coarse, spec.displayStep);
      return (e.t = { values: c.values, bytes: new Uint8Array(c.values.buffer), nx: c.nx, ny: c.ny }); });
    e.p.catch(() => st.tiles.get(k) === e && st.tiles.delete(k)); remember(k, e); return e.p;
  }
  const tile = (fh, L, tx, ty) => tiles(fh, L, [[tx, ty]])[0];  // eslint-disable-line no-unused-vars
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
    return (st.man.grid.DxInMetres / mpp) * st.map.getPixelRatio();
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
    if (st.values && FIELDS[st.field].vfmt) jobs.push(points(fh));
    return Promise.allSettled(jobs);
  }

  /* ---------- Values overlay: exact grid values at cities and a sparse grid, steady through the loop ----------
     Points and values come from the pipeline's p{FF}.bin.gz (the stored native values at the basemap places and every 16th
     cell). Which points are labelled depends only on the view (zoom, map size, the controls over the map), never on the
     values or the hour, so labels stay put while the loop plays and both comparison panels label the same points. */
  /* Values: "places" (default: named towns and cities with their own native value), "grid" (places plus the sparse model
     grid) or "off". A link's values= wins; otherwise this viewer's last choice; older links/settings with values=0 mean off. */
  const VMODES = ["places", "grid", "off"];
  st.vmode = (() => { const q = Q.get("values"); if (q === "0" || q === "off") return "off"; if (VMODES.includes(q)) return q;
    try { const m = localStorage.getItem("conus_vmode"); if (VMODES.includes(m)) return m; if (localStorage.getItem("conus_values") === "0") return "off"; } catch (e) { /* private mode */ }
    return "places"; })();
  st.values = st.vmode !== "off";
  st.points = new Map(); st.labelSet = null;
  const ptsKey = (fh, f = st.field) => `${st.run.id}|${f}|${fh}`;
  function points(fh, f = st.field) {   /* Int16Array of stored values for this field-hour, or null when the hour has none */
    const r = st.man.fields[f] && st.man.fields[f].hours[String(fh)]; if (!r || !r.points || r.notApplicable) return Promise.resolve(null);
    const k = ptsKey(fh, f); if (st.points.has(k)) return st.points.get(k).p;
    const e = { v: null };
    if (WIN[f]) { const D = WIN[f];   /* label values of a same-window field: the same difference at the label points */
      e.p = Promise.all([points(fh, D.base), fh - D.w > 0 ? points(fh - D.w, D.base) : null]).then(([a, b]) => { if (!a || (fh - D.w > 0 && !b)) throw new Error("label points missing"); return (e.v = K.windowDiff(a, b, D.tol)); });
      e.p.catch(() => st.points.get(k) === e && st.points.delete(k)); st.points.set(k, e); return e.p; }
    e.p = gunzip(`${SITE}/${st.run.path}/${f}/p${String(fh).padStart(2, "0")}.bin.gz`).then((u8) => (e.v = new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1)));
    e.p.catch(() => st.points.get(k) === e && st.points.delete(k)); st.points.set(k, e); st.requests++;
    if (st.points.size > 400) st.points.delete(st.points.keys().next().value);
    return e.p;
  }
  const pointsReady = (fh) => { const r = hourRec(fh); if (!st.values || !FIELDS[st.field].vfmt || !r || !r.points) return true; const e = st.points.get(ptsKey(fh)); return !!(e && e.v); };
  /* screen rectangles the labels must stay clear of: the info box, legend, controls and readouts over the map */
  function blockedRects() {
    if (st.exporting) return [];   /* the export frame has no controls over it: its legend and credits are drawn below the map */
    const box = st.map.getContainer().getBoundingClientRect(), pad = 6;
    /* each control row on its own: the rows differ in width, and the corner beside a shorter row is open map */
    return ["#mapInfo", "#legend", "#mapCtl .ctlrow", ".maplibregl-ctrl-bottom-right", ".maplibregl-ctrl-bottom-left", "#inspect.panel-read", "#mapNote", "#timeline"].flatMap((q) => [...document.querySelectorAll(q)])
      .filter((e) => e && !e.hidden && e.offsetParent !== null && getComputedStyle(e).display !== "none")
      .map((e) => { const r = e.getBoundingClientRect(); return [r.left - box.left - pad, r.top - box.top - pad, r.right - box.left + pad, r.bottom - box.top + pad]; })
      .filter(([x0, y0, x1, y1]) => x1 > 0 && y1 > 0 && x0 < box.width && y0 < box.height);
  }
  const placeFilter = [">=", ["get", "pop"], ["interpolate", ["linear"], ["zoom"], 3, 2500000, 5, 500000, 6.5, 100000, 8, 12000, 9.5, 5000]];
  /* which points to label for this view: ranked cities and towns, then a sub-lattice anchored to the model grid */
  function chooseLabels() {
    const P = st.man.points; if (!P) return (st.labelSet = { list: [], why: "no label points published for this run" });
    const m = st.map, z = m.getZoom(), c = m.getContainer(), W = c.clientWidth, H = c.clientHeight, phone = PHONE() || W < 560, grid = st.vmode === "grid";
    const tier = z < 4.6 ? "national" : z < 6.5 ? "regional" : "local";
    /* Places mode spends the room the grid would use on more named towns; Places + grid keeps the sparse grid as before */
    const cfg = { national: { pop: phone ? 1.0e6 : 2.0e6, sep: phone ? 78 : 125, cap: phone ? 8 : 14, grid: 0 }, regional: { pop: grid ? 3.0e5 : 1.5e5, sep: phone ? 82 : 100, cap: phone ? (grid ? 10 : 12) : (grid ? 24 : 30), grid: phone ? 118 : 150 },
      local: { pop: 6.0e4, sep: phone ? 74 : 82, cap: phone ? (grid ? 14 : 18) : (grid ? 34 : 48), grid: phone ? 114 : 142 } }[tier];
    /* A plot is a box: a named one carries the name over its value, so its width follows the name. It is tried centred on the
       town, then below it, then above it, so a town next to a control or the timeline still gets its value. Boxes may not
       overlap each other, the controls or the edges. */
    const size = m.getZoom() <= 3 ? 12 : m.getZoom() >= 8 ? 14.5 : 12 + (m.getZoom() - 3) * 0.5, blocked = blockedRects(), placed = [];
    const boxOf = (o) => { if (!o.name) return [size * 1.4, size * 0.75]; return [Math.max(o.name.length * size * 0.78 * 0.31, size * 1.3) + 4, size * 1.12 + 4]; };
    /* the box for each text anchor (MapLibre's sense: "top" puts the label below the town, "right" puts it to the left) */
    const rectAt = (x, y, [hw, hh], a) => {
      const X = a.endsWith("left") ? [x + 2, x + 2 + 2 * hw] : a.endsWith("right") ? [x - 2 - 2 * hw, x - 2] : [x - hw, x + hw];
      const Y = a.startsWith("top") ? [y + 2, y + 2 + 2 * hh] : a.startsWith("bottom") ? [y - 2 - 2 * hh, y - 2] : [y - hh, y + hh];
      return [X[0], Y[0], X[1], Y[1]];
    };
    const hits = (r, q, pad) => r[0] - pad < q[2] && r[2] + pad > q[0] && r[1] - pad < q[3] && r[3] + pad > q[1];
    const fits = (r) => r[0] > 4 && r[1] > 4 && r[2] < W - 4 && r[3] < H - 4 && !blocked.some((q) => hits(r, q, 0)) && !placed.some((q) => hits(r, q, 6));
    const out = [], far = (x, y, d) => out.every((o) => (o.x - x) ** 2 + (o.y - y) ** 2 >= d * d);
    const add = (o, anchors, sep) => {
      const s = m.project([o.lon, o.lat]); if (!far(s.x, s.y, sep)) return false;
      const half = boxOf(o);
      for (const a of anchors) { const r = rectAt(s.x, s.y, half, a); if (fits(r)) { placed.push(r); out.push({ ...o, x: s.x, y: s.y, anchor: a }); return true; } }
      return false;
    };
    const named = ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"];
    const places = P.places.map(([name, lat, lon, pop], k) => ({ k, name, lat, lon, pop }))
      .filter((p) => p.pop >= cfg.pop).sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
    places.forEach((p) => { if (out.length < cfg.cap) add(p, named, cfg.sep * 0.55); });
    if (tier === "local" && K.levelFor(cellPx(), st.man.levels) === 0) {
      // The native tiles already cover these towns, so a plot uses the value at the town itself.
      const minPop = grid ? (z >= 8.5 ? 5000 : z >= 7.5 ? 12000 : 25000) : (z >= 8.5 ? 2500 : z >= 7.5 ? 6000 : 12000);
      const have = new Set(out.map((o) => o.name));
      st.towns.forEach(({ properties, geometry }, i) => {
        if (out.length >= cfg.cap || properties.pop < minPop || have.has(properties.name)) return;
        const [lon, lat] = geometry.coordinates, cell = st.P.nearest(lat, lon);
        if (cell) add({ k: `town:${i}`, lon, lat, name: properties.name, cell }, named, cfg.sep * 0.55);
      });
    }
    if (grid && cfg.grid) {
      const L = P.lattice, cpx = cellPx() / st.map.getPixelRatio(), sepG = cfg.grid * 0.75, step = Math.max(1, Math.floor(cfg.grid * 0.8 / (cpx * L.every))), nPl = P.places.length;   /* a finer lattice step thinned by distance packs a staggered pattern, not a sparse square one */
      for (let b = 0; b < L.ny; b += step) for (let a = 0; a < L.nx; a += step) {
        const i = L.i0 + a * L.every, j = L.j0 + b * L.every, [lat, lon] = st.P.fromCell(i, j);
        add({ k: nPl + b * L.nx + a, lon, lat }, ["center"], sepG);
      }
    }
    st.blockKey = JSON.stringify(blocked.map((r) => r.map(Math.round)));
    return (st.labelSet = { list: out, tier, mode: st.vmode, cities: out.filter((o) => o.name).length });
  }
  /* write this hour's numbers at the chosen points; missing cells and dry zeros are left blank */
  function paintLabels(fh) {
    const src = st.map && st.map.getSource("vals"); if (!src) return;
    const F = FIELDS[st.field], spec = st.man.fields[st.field], none = () => { src.setData({ type: "FeatureCollection", features: [] }); st.labelsShown = []; setPlaceFilter([]); };
    if (!st.values || !F.vfmt || st.gapValid != null || hourState(fh) !== "ok") return none();
    const e = st.points.get(ptsKey(fh)); if (!e || !e.v) return;   /* not loaded yet: keep the last frame's labels rather than flash */
    const set = st.labelSet || chooseLabels(), feats = [], shown = [];
    set.list.forEach((o) => {
      let v;
      if (o.cell) {
        const [i, j] = o.cell, tx = Math.floor(i / st.man.tile), ty = Math.floor(j / st.man.tile);
        v = K.valueAt(st.man, st.field, { [K.tileName(0, tx, ty)]: ready(fh, 0, tx, ty) }, i, j);
      } else {
        const raw = e.v[o.k];
        v = raw === undefined || raw === K.MISS ? null : raw * spec.scale;
      }
      const blank = v == null || (F.vmin && !F.vmin(v));   /* missing cell, or a dry zero that is not written */
      if (blank && !o.name) return;   /* a bare grid point with nothing to say is left off */
      const t = blank ? "" : F.vfmt(v); shown.push({ k: o.k, name: o.name || null, value: blank ? null : v, text: t, blank, anchor: o.anchor || "center", lon: o.lon, lat: o.lat, x: o.x, y: o.y });
      feats.push({ type: "Feature", properties: { t, n: o.name || "", city: o.name ? (blank ? 2 : 1) : 0, a: o.anchor || "center" }, geometry: { type: "Point", coordinates: [o.lon, o.lat] } }); });
    src.setData({ type: "FeatureCollection", features: feats }); st.labelsShown = shown;
    setPlaceFilter(shown.filter((o) => o.name).map((o) => o.name));
  }
  /* a city that carries a value shows its name with the number, so the plain name label is hidden for it */
  function setPlaceFilter(names) {
    try { st.map.setFilter("places", names.length ? ["all", placeFilter, ["!", ["in", ["get", "name"], ["literal", names]]]] : placeFilter); } catch (e) { /* style not ready */ }
  }
  /* Shading opacity: fades only the coloured forecast layer (it is drawn under boundaries, names and numbers); 100% is the
     standard look, 0% leaves the numbers on the plain basemap. A uniform in the draw call: nothing is fetched or re-decoded. */
  const SHADE_FULL = 0.85;
  st.shade = (() => { const v = Number(Q.get("shade")); return Q.get("shade") != null && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 100; })();
  function setShade(v) {
    st.shade = Math.max(0, Math.min(100, Math.round(Number(v)))); if (!Number.isFinite(st.shade)) st.shade = 100;
    const sl = $("shadeSl"); if (sl) { sl.value = String(st.shade); sl.setAttribute("aria-valuetext", `${st.shade}%`); $("shadeOut").textContent = `${st.shade}%`; $("shadeReset").disabled = st.shade === 100; }
    if (st.map) st.map.triggerRepaint(); share();
  }
  function setValues(mode) {
    st.vmode = mode === true ? "places" : mode === false ? "off" : VMODES.includes(mode) ? mode : "places"; st.values = st.vmode !== "off";
    try { localStorage.setItem("conus_vmode", st.vmode); } catch (e) { /* private mode */ }
    const sel = $("valSel"); if (sel) sel.value = st.vmode;
    st.labelSet = null; chooseLabels(); paintLabels(fhNow()); if (st.values) points(fhNow()).then(() => paintLabels(fhNow())).catch(() => {}); share();
  }

  /* ---------- GPU layer ---------- */
  const VS = `attribute vec2 a_pos; attribute vec2 a_g; uniform mat4 u_matrix; varying vec2 v_g;
    void main(){ v_g=a_g; gl_Position=u_matrix*vec4(a_pos,0.0,1.0); }`;
  const FS = `precision highp float; uniform sampler2D u_tex; uniform sampler2D u_cmap; uniform vec2 u_size; uniform float u_every; uniform float u_scale; uniform vec2 u_lut; uniform float u_op; uniform sampler2D u_mask; uniform vec2 u_msize; uniform float u_mevery; uniform float u_hasmask; varying vec2 v_g;
    void main(){
      vec2 t = floor(v_g / u_every);
      if (t.x < 0.0 || t.y < 0.0 || t.x >= u_size.x || t.y >= u_size.y) discard;
      if (u_hasmask > 0.5) {   /* a finer level is drawn over this one: leave its cells to it, so no cell is blended twice */
        vec2 tm = floor(v_g / u_mevery); vec4 m = texture2D(u_mask, (tm + 0.5) / u_msize);
        if (!(m.a > 0.498 && m.a < 0.504 && m.r < 0.002)) discard; }   /* the mask cell holds a value unless it is the -32768 sentinel */
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
      this.loc = Object.fromEntries(["a_pos", "a_g"].map((n) => [n, gl.getAttribLocation(p, n)]).concat(["u_matrix", "u_tex", "u_cmap", "u_size", "u_every", "u_scale", "u_lut", "u_op", "u_mask", "u_msize", "u_mevery", "u_hasmask"].map((n) => [n, gl.getUniformLocation(p, n)])));
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
      gl.useProgram(this.p); gl.uniformMatrix4fv(this.loc.u_matrix, false, matrix); /* full strength as the layer always looked: 0.85 with one level, and the two-level stack's 1 - 0.15² when zoomed in */
      const full = st.draw.length > 1 ? 1 - (1 - SHADE_FULL) ** 2 : SHADE_FULL; gl.uniform1f(this.loc.u_op, full * st.shade / 100);
      gl.uniform2f(this.loc.u_lut, F.range[0], F.range[1]);
      const at = (b, l) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0); };
      at(this.buf.pos, this.loc.a_pos); at(this.buf.g, this.loc.a_g); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.cmap); gl.uniform1i(this.loc.u_cmap, 1);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      st.draw.forEach((L, n) => { const T = this.tex[L]; if (!T) return; const Mk = n + 1 < st.draw.length ? this.tex[st.draw[n + 1]] : null;
        gl.uniform1f(this.loc.u_hasmask, Mk ? 1 : 0);
        if (Mk) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, Mk.t); gl.uniform1i(this.loc.u_mask, 2); gl.uniform2f(this.loc.u_msize, Mk.lv.nx, Mk.lv.ny); gl.uniform1f(this.loc.u_mevery, 2 ** st.draw[n + 1]); }
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
    if (st.gapValid != null) { st.draw = []; st.map.triggerRepaint(); info(); paintLabels(fh); note(validGapText()); return; }
    if (hs !== "ok") { st.draw = []; st.map.triggerRepaint(); info(); paintLabels(fh); note(gapText(fh, hs)); return; }
    const paint = () => { if (token !== drawToken) return;
      const nCoarse = layer.show(w.coarse, fh, w.all), nFine = w.L !== w.coarse ? layer.show(w.L, fh, w.tiles) : 0;
      st.draw = w.L !== w.coarse ? [w.coarse, w.L] : [w.coarse]; st.shown = { coarse: nCoarse, fine: nFine, of: w.tiles.length };
      st.map.triggerRepaint(); info(); paintLabels(fh); };
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
  const frameReady = (fh, w) => hourState(fh) !== "ok" || pointsReady(fh) && w.all.every(([x, y]) => ready(fh, w.coarse, x, y)) && (w.L === w.coarse || w.tiles.every(([x, y]) => ready(fh, w.L, x, y)));

  /* ---------- text: init/valid times, level, sizes ---------- */
  function info() {
    if (!st.man) return; const m = st.man, F = FIELDS[st.field], fh = fhNow(), valid = Date.parse(m.valid[fh]), init = Date.parse(m.cycle);
    const w = st.want || wanted(), every = 2 ** w.L, loopReady = m.hours.filter((h) => frameReady(h, w)).length;
    if (st.gapValid != null) { $("mapInfo").innerHTML = `${PANEL ? `<b class="panel${PANEL === "B" ? " b" : ""}">${esc(PANEL)}</b> ` : ""}<b class="fld">${M.name} ${esc(fmtUTC(init))} run · ${esc(F.label)}</b><div class="msg"><b>No forecast hour at ${esc(fmtLocal(st.gapValid))}</b></div>`; share(); return; }
    $("mapInfo").innerHTML = `${PANEL ? `<b class="panel${PANEL === "B" ? " b" : ""}">${esc(PANEL)}</b> ` : ""}<b class="fld">${M.label}<span class="wide-only"> CONUS</span> · ${esc(F.label)}${F.units ? ` <span class="unit">(${esc(F.units)})</span>` : ""}</b><div>Init <b>${esc(fmtUTC(init))}</b> · F${String(fh).padStart(2, "0")} · valid <b>${esc(fmtLocal(valid))}</b><span class="wide-only"> (${esc(fmtUTC(valid))})</span></div>` +
      (F.window ? `<div class="msg">${esc(windowText(F, fh))}</div>` : "") + (F.note ? `<div class="msg fnote">${esc(F.note)}</div>` : "") +
      `<div class="msg">${every === 1 ? `Every native ${M.res} cell at this zoom` : `Every ${every === 2 ? "2nd" : "4th"} native cell<span class="wide-only"> at this zoom</span>; zoom in for every cell`}<span class="wide-only"> · click for the cell's own value</span></div>`;
    $("tlValid").textContent = `${fmtLocal(valid)} · F${String(fh).padStart(2, "0")}`; $("hourSl").value = String(st.h);
    $("runInfo").innerHTML = `Run ${esc(fmtUTC(init))}: ${m.status === "in progress" ? `<b>in progress</b>, ${m.hours.length} of ${m.hoursExpected + 1} hours posted by NOAA so far` : `${m.hours.length} forecast hours (${esc(m.status)})`}. ` +
      `Loop ready for this view: ${loopReady} of ${m.hours.length} hours. Downloaded this visit: <b>${MB(st.loadedBytes)}</b> compressed in ${st.requests} map-data requests; decoded tiles in memory: ${MB(st.bytes)}. ` +
      `Every cell is placed from the GRIB projection (checked against GRIB's own latitudes and longitudes: largest difference ${m.georef ? m.georef.maxErrorCells : "?"} cells). ${esc(m.attribution)}`;
    share();
  }
  /* accumulation window in words, ending at the valid time */
  function windowText(F, fh) {
    const v = Date.parse(st.man.valid[fh]), c = Date.parse(st.man.cycle);
    const prob = F.units === "%";   /* a chance over the window, not an amount */
    if (F.window === 1) return `${prob ? "For" : "Accumulated in"} the hour ending ${fmtLocal(v)}`;
    if (typeof F.window === "number") return `${prob ? "For" : "Accumulated over"} the ${F.window} h from ${fmtLocal(v - F.window * H)} to ${fmtLocal(v)}`;
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
    if (!c) { st.sel = null; outline(); $("inspect").innerHTML = `<p class="msg">That point is outside the ${M.name} grid (nothing is drawn there).</p>`; share(); return; }
    st.sel = c; outline(); const [i, j] = c, fh = fhNow(), T = st.man.tile, tx = Math.floor(i / T), ty = Math.floor(j / T), F = FIELDS[st.field];
    if (st.gapValid != null) { $("inspect").innerHTML = `<p class="msg">${esc(validGapText())}</p>`; return; }
    if (hourState(fh) !== "ok") { $("inspect").innerHTML = `<p class="msg">${esc(gapText(fh, hourState(fh)))}</p>`; share(); return; }
    $("inspect").innerHTML = '<p class="msg">Reading the native cell…</p>';
    try { await tile(fh, 0, tx, ty); } catch (e) { $("inspect").innerHTML = `<p class="msg">Could not load that cell (${esc(e.message)}).</p>`; return; }
    if (!st.sel || st.sel[0] !== i || st.sel[1] !== j || fhNow() !== fh) return;
    const v = K.valueAt(st.man, st.field, { [K.tileName(0, tx, ty)]: ready(fh, 0, tx, ty) }, i, j), [la, lo] = st.P.fromCell(i, j), valid = Date.parse(st.man.valid[fh]);
    const shown = v == null ? '<span class="unavail">no data in this cell</span>' : F.cat ? `<b>${v === 0 ? "none (not precipitating)" : esc((F.cat[Math.round(v)] || ["?"])[0])}</b>` : `<b>${v.toFixed(F.dec)} ${esc(F.units)}</b>`;
    $("inspect").innerHTML = `<div class="inspect-v">${esc(F.label)}: ${shown}</div>${F.window ? `<div class="msg">${esc(windowText(F, fh))}</div>` : ""}` +
      `<div class="msg">${M.name} native cell ${i}, ${j} (${M.res}), centred at ${la.toFixed(4)}, ${lo.toFixed(4)} · F${String(fh).padStart(2, "0")}, valid ${esc(fmtLocal(valid))} · stored to ${st.man.fields[st.field].scale} ${esc(F.units)} from GRIB, never from the display</div>`;
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
  async function grabMap() {   /* WebGL buffers are cleared after compositing: copy inside the frame that draws them */
    /* first let the label source finish parsing and placing, so the copy never catches a half-placed set of labels */
    await new Promise((ok) => { const t = setTimeout(ok, 6000); st.map.once("idle", () => { clearTimeout(t); ok(); }); st.map.triggerRepaint(); });
    return new Promise((ok, no) => { const m = st.map; const t = setTimeout(() => no(new Error("the map did not redraw")), 8000);
      m.once("render", () => { clearTimeout(t); try { const c = m.getCanvas(), o = document.createElement("canvas"); o.width = c.width; o.height = c.height;
        const g = o.getContext("2d"); g.drawImage(c, 0, 0); const lab = $("labels"); if (lab && lab.width) g.drawImage(lab, 0, 0, o.width, o.height); ok(o); } catch (e) { no(e); } });
      m.triggerRepaint(); });
  }
  async function exportPng() {
    if (!st.man) return;
    /* the same area at a fixed 16:10 frame on every device: the map is resized off screen, drawn, copied, restored */
    const el = $("map"), saved = el.getAttribute("style") || "", bounds = st.map.getBounds(), dpr = window.devicePixelRatio || 1;
    let map, drawn = [];
    try {
      /* a fixed 1000 × 625 CSS frame drawn at 1.6× on every screen, so a retina laptop and a desk monitor export the same labels at the same size */
      el.setAttribute("style", `${saved};position:fixed;left:0;top:0;width:1000px;height:625px;z-index:-1`);
      st.exporting = true; st.map.setPixelRatio(1.6); st.map.resize(); st.map.fitBounds(bounds, { duration: 0, padding: 0 }); chooseLabels(); await redraw(); map = await grabMap();
      const k = 1600 / el.clientWidth; drawn = (st.labelsShown || []).map((o) => ({ text: o.text, name: o.name, x: Math.round(o.x * k), y: Math.round(o.y * k) }));   /* positions in the PNG's map area */
    } finally { st.exporting = false; st.map.setPixelRatio(dpr); el.setAttribute("style", saved); st.map.resize(); st.map.fitBounds(bounds, { duration: 0, padding: 0 }); chooseLabels(); redraw(); }
    const F = FIELDS[st.field], m = st.man, fh = fhNow(), valid = Date.parse(m.valid[fh]), init = Date.parse(m.cycle), hs = hourState(fh);
    const W = 1600, mapH = Math.round((W * map.height) / map.width), HEAD = 150, FOOT = 150, H = HEAD + mapH + FOOT;
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    const dark = document.documentElement.getAttribute("data-theme") !== "light", fg = dark ? "#eef1f5" : "#14181f", mute = dark ? "#a9b2bf" : "#4b5563", bg = dark ? "#0d1117" : "#ffffff";
    const font = (w, px) => `${w} ${px}px "Archivo", "Helvetica Neue", Arial, sans-serif`, f2 = `F${String(fh).padStart(2, "0")}`;
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.font = font(800, 40); g.fillText(`${M.label} · ${F.label}${F.units ? ` (${F.units})` : ""}`, 32, 56);
    g.font = font(600, 26); g.fillText(`Init ${fmtUTC(init)} · ${f2} · Valid ${fmtLocal(valid)} (${fmtUTC(valid)})`, 32, 96);
    g.fillStyle = mute; g.font = font(500, 22); g.fillText([F.window ? windowText(F, fh) : "", F.note || "", st.shade !== 100 ? `Shading ${st.shade}%` : ""].filter(Boolean).join("  ·  ").slice(0, 150), 32, 130);
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
    g.fillText(`Forecast Ops output · Data: ${M.source} · Model guidance, not an official forecast · Not endorsed by NOAA`, 32, H - 48);
    g.fillText("Basemap: U.S. Census Bureau boundaries via us-atlas, Natural Earth · GeoNames (CC BY 4.0) · Colors and rendering: Forecast Ops", 32, H - 20);
    const blob = await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
    const a = document.createElement("a"), name = `forecast-ops-${M.key}-${st.field}-${st.run.id}z-${f2.toLowerCase()}.png`;
    a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    window.__lastPng = { shade: st.shade, name, width: W, height: H, field: st.field, run: st.run.id, fh, mapH, head: HEAD, labels: drawn.map((o) => ({ ...o, y: o.y + HEAD })) };   // test hook
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
    setValues: (on) => setValues(on),
    setShade: (v) => setShade(v),
    /* test hook: SHA-256 of a display tile's stored int16 values for the current field (read only) */
    tileHash: async (fh, L, tx, ty) => { const t = await tiles(fh, L, [[tx, ty]])[0]; const b = new Uint8Array(t.values.buffer, t.values.byteOffset, t.values.byteLength);
      return { hash: [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join(""), nx: t.nx, ny: t.ny }; },
    labels: () => ({ tier: st.labelSet && st.labelSet.tier, chosen: st.labelSet ? st.labelSet.list.map((o) => o.k) : [], shown: st.labelsShown || [] }),
    state: () => (st.man ? { shade: st.shade, run: st.run.id, cycle: st.man.cycle, field: st.field, fh: st.gapValid != null ? null : fhNow(), gapValid: st.gapValid, hours: st.man.hours, valid: st.man.valid, status: st.man.status,
      hourState: st.gapValid != null ? "no-valid" : hourState(fhNow()), shown: st.shown, draw: (st.draw || []).length, point: $("inspect").innerText } : null),
  };
  function compareLink() {
    const runs = st.index.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle)), i = runs.findIndex((r) => r.id === st.run.id), b = runs[i + 1] || runs[i - 1];
    const q = new URLSearchParams({ domain: "conus", compare: "1", a: st.run.id, b: b ? b.id : st.run.id, field: st.field, valid: st.man.valid[fhNow()] });
    if (M.key !== "hrrr") q.set("model", M.key); if (st.shade !== 100) q.set("shade", String(st.shade)); if (st.vmode !== "places") q.set("values", st.vmode === "off" ? "0" : "grid"); if (Q.get("data")) q.set("data", Q.get("data")); const c = st.map.getCenter(); q.set("map", `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${st.map.getZoom().toFixed(2)}`);
    return `${location.pathname}?${q.toString()}`;
  }
  /* ---------- shareable link ---------- */
  function share() {
    if (!st.man || !st.map || EMBED) return; const c = st.map.getCenter(), q = new URLSearchParams();
    q.set("domain", "conus"); if (M.key !== "hrrr") q.set("model", M.key); if (Q.get("data")) q.set("data", Q.get("data"));
    q.set("run", st.run.id); q.set("fh", String(fhNow())); q.set("field", st.field); if (st.vmode !== "places") q.set("values", st.vmode === "off" ? "0" : "grid"); if (st.shade !== 100) q.set("shade", String(st.shade));
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
    const man = derive(await getJSON(`${SITE}/${r.path}/manifest.json`));
    const sameGrid = st.man && JSON.stringify(st.man.grid) === JSON.stringify(man.grid);
    st.run = r; st.man = man; st.P = MC.projector(man.grid);
    if (!sameGrid) { st.mesh = K.gridMesh(st.P, man.grid.nx, man.grid.ny, MC.merc, 8); layer.setMesh(st.mesh); footprint(); }
    st.labelSet = null;
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
    if (!FIELDS[f] || f === st.field) return; stop(); st.field = f; $("fieldSel").value = f; let moved = null;
    if (!EMBED && st.man && st.gapValid == null && hourState(fhNow()) === "na") {   /* the comparison page moves its panels itself */   /* e.g. 6-h PoP from an hour between windows: the window that contains this time */
      const k = st.man.hours.findIndex((h, i) => i >= st.h && hourState(h) === "ok"), j = k >= 0 ? k : st.man.hours.findIndex((h) => hourState(h) === "ok");
      if (j >= 0) { const from = fhNow(); st.h = j; moved = `${FIELDS[f].short || FIELDS[f].label} is for ${FIELDS[f].window}-h windows ending ${FIELDS[f].ends || "at fixed hours"}: showing F${String(fhNow()).padStart(2, "0")}, the window that includes F${String(from).padStart(2, "0")}.`; } }
    layer.setColors(K.lut(FIELDS[f].color, ...FIELDS[f].range, 4096)); legend(); timeline(); note(null); paintLabels(fhNow()); await redraw(); reselect(); if (moved) note(moved);
  }
  function go(h) { st.h = (h + st.man.hours.length) % st.man.hours.length; redraw(); reselect(); }
  function stop() { if (st.play) clearTimeout(st.play); st.play = null; $("playBtn").textContent = "PLAY"; $("playBtn").setAttribute("aria-pressed", "false"); }
  /* the loop advances only to hours whose tiles for this view are in memory, so it never shows a gap */
  function play() {
    if (st.play) { stop(); return; }
    $("playBtn").textContent = "PAUSE"; $("playBtn").setAttribute("aria-pressed", "true"); prefetch(st.want || wanted());
    const tick = () => { const w = st.want || wanted(), n = st.man.hours.length, has = st.man.hours.some((h) => hourState(h) === "ok");
      let nxt = (st.h + 1) % n; while (has && nxt !== st.h && hourState(st.man.hours[nxt]) === "na") nxt = (nxt + 1) % n;   /* e.g. 6-h PoP: step window to window */
      if (frameReady(st.man.hours[nxt], w)) go(nxt); st.play = setTimeout(tick, PHONE() ? 650 : 500); };
    st.play = setTimeout(tick, 300);
  }

  /* ---------- map ---------- */
  const palette = () => (document.documentElement.getAttribute("data-theme") !== "light"
    ? { land: "#151a22", county: "#748294", state: "#cfd5de", border: "#e6eaf0", coast: "#8fa3b8", lake: "#6f8fae", edge: "#9aa4b2" }
    : { land: "#f1f2ee", county: "#525e6b", state: "#353c47", border: "#1d232b", coast: "#4b6b8a", lake: "#5f8db8", edge: "#55606e" });
  function footprint() { const s = st.map && st.map.getSource("footprint"); if (s && st.mesh) s.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: st.mesh.ring } }); }
  function initMap(base, countyLines) {
    const C = palette(), view = (Q.get("map") || "").split(",").map(Number), hasView = view.length === 3 && view.every(Number.isFinite);
    const map = new ML.Map({ container: "map", fadeDuration: 0, style: { version: 8, glyphs: new URL("assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf", location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}"), sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": C.land } }] },
      center: hasView ? [view[1], view[0]] : [-97.5, 38.6], zoom: hasView ? view[2] : PHONE() ? 2.6 : 3.7, minZoom: 1.5, maxZoom: 10.5, attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: false,
      maxBounds: [[-175, -5], [-25, 72]] });
    map.touchZoomRotate.disableRotation(); map.addControl(new ML.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ML.AttributionControl({ compact: true, customAttribution: `Data: ${M.credit} · Forecast Ops output · US Census (us-atlas) · Natural Earth · GeoNames (CC BY 4.0)` }), "bottom-right");
    st.map = map;
    return new Promise((res) => map.on("load", () => {
      Object.entries(base.layers).forEach(([k, v]) => {
        const data = k === "places" ? { ...v, features: [...v.features, ...st.towns] } : v;
        map.addSource(k, { type: "geojson", data });
      });
      map.addLayer(layer);
      map.addSource("footprint", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "footprint", type: "line", source: "footprint", paint: { "line-color": C.edge, "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.8 } });
      map.addLayer({ id: "lakes", type: "line", source: "lakes", paint: { "line-color": C.lake, "line-width": 0.8 } });
      map.addLayer({ id: "coast", type: "line", source: "coast", paint: { "line-color": C.coast, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.4] } });
      map.addSource("counties", { type: "geojson", data: countyLines });
      map.addLayer({ id: "counties", type: "line", source: "counties", minzoom: 4.5, paint: {
        "line-color": C.county,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4.5, 0.5, 9, 1.05],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.5, 0, 6, 0.78],
      } });
      map.addLayer({ id: "states", type: "line", source: "states", paint: { "line-color": C.state, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 8, 1.6], "line-opacity": 0.85 } });
      map.addLayer({ id: "borders", type: "line", source: "borders", paint: { "line-color": C.border, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.9, 8, 2] } });
      map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "sel", type: "line", source: "sel", paint: { "line-color": "#ffffff", "line-width": 2 } });
      map.addLayer({ id: "places", type: "symbol", source: "places", filter: placeFilter,
        layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10.5, 8, 13], "symbol-sort-key": ["-", 0, ["get", "pop"]], "text-padding": 6, "text-max-width": 10 },
        paint: { "text-color": getComputedStyle(document.body).getPropertyValue("--text").trim() || "#e8eaee", "text-halo-color": getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#0b0d12", "text-halo-width": 1.4 } });
      /* Values overlay on top: always drawn (allow-overlap) and placed first, so city names give way to it */
      map.addSource("vals", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "vals", type: "symbol", source: "vals",
        layout: { "text-field": ["case", ["==", ["get", "city"], 1], ["format", ["get", "n"], { "font-scale": 0.78 }, "\n", {}, ["get", "t"], { "font-scale": 1.12 }], ["==", ["get", "city"], 2], ["format", ["get", "n"], { "font-scale": 0.85 }], ["get", "t"]],
          "text-anchor": ["coalesce", ["get", "a"], "center"],
          "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 12, 8, 14.5], "text-allow-overlap": true, "text-ignore-placement": false, "text-line-height": 1.05, "text-max-width": 14 },
        paint: { "text-color": getComputedStyle(document.body).getPropertyValue("--text").trim() || "#e8eaee", "text-halo-color": getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#0b0d12", "text-halo-width": 1.8 } });
      const repaint = () => { const P = palette(); [["bg", "background-color", "land"], ["footprint", "line-color", "edge"], ["lakes", "line-color", "lake"], ["coast", "line-color", "coast"], ["counties", "line-color", "county"], ["states", "line-color", "state"], ["borders", "line-color", "border"]].forEach(([id, p, k]) => map.setPaintProperty(id, p, P[k])); };
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
    document.body.classList.add("maps-conus"); ["pngBtn", "cmpBtn", "valCtl", "modelSel", "shadeCtl"].forEach((id) => { if ($(id)) $(id).hidden = false; });
    ["winSel", "smoothChk"].forEach((id) => { const e = $(id); if (e) (e.closest("label") || e).hidden = true; });
    const seg = document.querySelector('[aria-label="Map view"]'); if (seg) seg.hidden = true;
    const ps = $("placeSel"); if (ps) ps.closest("div").hidden = true;
    $("inspect").innerHTML = `<p class="msg">Click or tap the map to read the ${M.name} value in that native ${M.res} cell. Values come from the full-precision grid, never from the display.</p>`;
    const about = document.querySelector("#runInfo") && document.querySelector("#runInfo").previousElementSibling;
    if (about) about.textContent = "Beta: " + M.about + " on the model's own Lambert conformal projection; areas outside the model grid are left blank. Zoomed out, the map draws every 2nd or 4th native cell (each drawn over the block it stands for) so a loop stays light on a phone; zoom in for every cell. Clicking always reads the native cell at full precision. Only the tiles in view are downloaded. Runs appear hour by hour as NOAA posts them; the 00, 06, 12 and 18 UTC runs go to 48 hours, the others to 18. U.S. county boundaries appear as you zoom in. Geography: US Census boundaries (us-atlas), Natural Earth (public domain) and GeoNames (CC BY 4.0). Model guidance only, not an official forecast.";
  }
  async function start() {
    if (Q.get("compare") === "1" && window.MapsConusCompare) { window.MapsConusCompare.start(); return; }   // it sets up its own page shell
    O.shell("maps", "Model maps", { forecastPoint: false, subtitle: `Beta · ${M.label}, full CONUS` });
    regionToggle("conus"); adaptPage(); if (EMBED) adaptEmbed();
    if (!ML || !(() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })()) { $("mapInfo").innerHTML = '<span class="state err">This browser cannot draw the interactive map (WebGL unavailable).</span>'; return; }
    let base, detail;
    // A geography asset outage should still leave a usable forecast map.
    const geo = fetchT("assets/maps/conus-detail.geojson.gz", 8000).then(async (r) => {
      if (!r.ok) return null;
      const bytes = await gunzipBytes(new Uint8Array(await r.arrayBuffer()));
      return JSON.parse(new TextDecoder().decode(bytes));
    }).catch(() => null);
    try { [base, st.index, detail] = await Promise.all([getJSON("assets/maps/basemap-conus.json"), getJSON(`${DATA}/${M.index}`), geo]); }
    catch (e) { $("mapInfo").innerHTML = `<span class="state err">${esc(M.name)} map data is not available from this data host (${esc(e.message)}).${/404/.test(e.message) && M.key !== "hrrr" ? ` ${esc(M.name)} may be published on the other data host only.` : ""}</span>`; return; }
    if (!st.index.runs.length) { $("mapInfo").textContent = `No ${M.name} runs published yet.`; return; }
    if (FIELDS[Q.get("field")]) st.field = Q.get("field");
    const published = new Set(st.index.runs.flatMap((r) => r.fields || []));
    if (published.size && !publishes(published, st.field)) st.field = published.has("t2m") ? "t2m" : [...published][0];   /* a field this model does not publish: its temperature map instead */
    $("fieldSel").innerHTML = fieldOptions(published); $("fieldSel").value = st.field;
    if ($("modelSel")) {   /* switching model keeps the view, the valid time when the other model has it, and the field when it publishes it */
      $("modelSel").innerHTML = Object.values(MODELS).filter((m) => m.key !== "rrfs" || DATA !== DATA_HOSTS.pages).map((m) => `<option value="${m.key}">${esc(m.label)}</option>`).join(""); $("modelSel").value = M.key;
      $("modelSel").addEventListener("change", () => { const q = new URLSearchParams(location.search); q.set("model", $("modelSel").value); q.delete("run"); q.delete("fh");
        if (st.man) q.set("valid", st.man.valid[fhNow()]); location.href = `${location.pathname}?${q.toString()}`; }); }
    $("runSel").innerHTML = st.index.runs.map((r) => `<option value="${esc(r.id)}">${esc(runLabel(r))}</option>`).join("");
    const features = detail?.features || [];
    st.towns = features.filter((f) => f.geometry.type === "Point");
    await initMap(base, { type: "FeatureCollection", features: features.filter((f) => f.geometry.type === "MultiLineString") });
    const pt = (Q.get("pt") || "").split(",").map(Number); if (pt.length === 2 && pt.every(Number.isFinite)) st.selPt = pt;
    /* opened for a valid time (e.g. from the model menu): the newest run that has that hour, or the nearest hour of the newest run */
    let runWanted = Q.get("run"), fhWanted = Q.get("fh"), validNote = null; const vq = !EMBED && !runWanted && Q.get("valid") ? Date.parse(Q.get("valid")) : NaN;
    if (Number.isFinite(vq)) {
      const has = st.index.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle)).find((r) => r.hours.some((h) => Date.parse(r.cycle) + h * H === vq));
      if (has) { runWanted = has.id; fhWanted = String((vq - Date.parse(has.cycle)) / H); }
      else { const r0 = st.index.runs[0], near = r0.hours.reduce((b, h) => (Math.abs(Date.parse(r0.cycle) + h * H - vq) < Math.abs(Date.parse(r0.cycle) + b * H - vq) ? h : b), r0.hours[0]);
        runWanted = r0.id; fhWanted = String(near); validNote = `${M.name} has no published hour at ${fmtLocal(vq)}; showing the nearest, F${String(near).padStart(2, "0")}.`; }
    }
    try { await openRun(runWanted || st.index.runs[0].id, false, fhWanted); if (validNote) note(validNote); }
    catch (e) { $("mapInfo").innerHTML = `<span class="state err">This run could not be loaded (${esc(e.message)}).</span>`; return; }
    if (!Q.get("map")) { /* open on the whole model footprint, clear of the overlays */
      const xs = st.mesh.ring.map((p) => p[0]), ys = st.mesh.ring.map((p) => p[1]);
      st.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: PHONE() ? { top: 150, bottom: 90, left: 6, right: 6 } : { top: 60, bottom: 80, left: 20, right: 20 }, duration: 0 });
      redraw(); }
    let mv = null; st.map.on("moveend", () => { clearTimeout(mv); mv = setTimeout(() => { chooseLabels(); redraw(); share(); }, 120); });
    st.map.on("resize", () => { st.labelSet = null; });
    $("valSel").addEventListener("change", () => setValues($("valSel").value)); setValues(st.vmode);
    $("shadeSl").addEventListener("input", () => setShade($("shadeSl").value)); $("shadeReset").addEventListener("click", () => setShade(100)); setShade(st.shade);
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
    /* the plots stay clear of the info box, controls, legend and timeline: when one of those moves or changes size (the
       phone layout settles after the first draw), choose again; an unchanged layout keeps every plot where it is */
    const rechoose = () => { if (!st.man || !st.map) return; const k = JSON.stringify(blockedRects().map((r) => r.map(Math.round))); if (k === st.blockKey) return; st.blockKey = k; st.labelSet = null; chooseLabels(); paintLabels(fhNow()); };
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => requestAnimationFrame(rechoose)); ["mapInfo", "mapCtl", "legend", "timeline"].forEach((id) => $(id) && ro.observe($(id))); }
    window.__conus = st; // test hook (read-only use)
    if (EMBED) {   /* a panel of the cycle comparison: the page drives field, valid time, view and point; user moves are reported */
      st.map.on("moveend", () => { if (st.syncing) { st.syncing = false; return; } const c = st.map.getCenter(); parent.postMessage({ conus: "view", panel: PANEL, center: [c.lng, c.lat], zoom: st.map.getZoom() }, location.origin); });
      st.map.on("click", (e) => parent.postMessage({ conus: "point", panel: PANEL, lat: e.lngLat.lat, lon: e.lngLat.lng }, location.origin));
    }
    if (Q.get("valid") && EMBED) api.setValid(Date.parse(Q.get("valid")));   /* comparison panels: show that valid time or say this run has none */
    $("cmpBtn").addEventListener("click", () => { location.href = compareLink(); });
  }
  /* Tri-State | CONUS switch, shared by both viewers */
  function regionToggle(active) {
    const row = $("mapCtl") && $("mapCtl").querySelector(".ctlrow"); if (!row || $("regionSeg")) return;
    const d = document.createElement("div"); d.className = "seg"; d.id = "regionSeg"; d.setAttribute("role", "group"); d.setAttribute("aria-label", "Region");
    d.innerHTML = `<a class="segb" href="maps.html" aria-pressed="${active === "tristate"}">Tri-State</a><a class="segb" href="maps.html?domain=conus" aria-pressed="${active === "conus"}">CONUS <small class="wide-only">beta</small></a>`;
    row.prepend(d);
  }
  window.MapsConus = { start, regionToggle, api, FIELDS, MODEL: M, DATA, derive, publishes, fieldOptions: (pub) => fieldOptions(pub) };
})();
