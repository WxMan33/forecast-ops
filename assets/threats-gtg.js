/* Weather threats, aviation: NOAA NCEP Graphical Turbulence Guidance (GTG), model guidance. Pure; shared by the map and the
   Node tests. No network: the map asks the preview's same-origin function for one GRIB2 record (one height, one forecast hour).

   Source: NCEP Domestic Aviation Forecast System (DAFS), dafs.tCCz.gtg.3km.conus.fFFF.grib2 on NOMADS (hourly cycles,
   forecast hours 0-18; NCEP Products Inventory, DAFS). Field used: EDPARM, "Eddy Dissipation Parameter" (GRIB2 discipline 0,
   category 19, number 30; the combined clear-air, mountain-wave and convective turbulence), in m^(2/3) s^-1 (EDR, the cube
   root of the dissipation rate), on 51 heights above mean sea level: 30 m, then every 1,000 ft (304.8 m) to 15,240 m.
   Grid: Lambert conformal, 1799 x 1059 points, 3 km, true at 38.5N, LoV 262.5E, spherical earth (R = 6,371,229 m).
   Packing: GRIB2 template 5.3 (complex packing with spatial differencing) with a bitmap; decoded here, checked against ECMWF
   ecCodes in tests/threats-gtg.test.js.

   Categories: AWC's estimated EDR thresholds by aircraft weight class (aviationweather.gov GFA help, "EDR Threshold * 100"):
   light aircraft 13/16/36/64, medium 15/20/44/79, heavy 17/24/54/96 for light/moderate/severe/extreme. GTG is a forecast of
   atmospheric turbulence, not of what a given flight will feel. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ThreatsGTG = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const FT = 0.3048, R_EARTH = 6371229;
  /* the 51 heights in the files (metres above MSL) and their feet */
  // NCEP writes integer metres truncated, not rounded (304, 609, 914, 1219, ... 15240): match the file's own labels
  const LEVEL_FIX = (ft) => Math.floor(ft * FT + 1e-6);
  const HEIGHTS = [{ m: 30, ft: 100 }, ...Array.from({ length: 50 }, (_, k) => ({ m: LEVEL_FIX((k + 1) * 1000), ft: (k + 1) * 1000 }))];
  const CLASSES = { light: { label: "Light aircraft (under 15,500 lb)", t: [0.13, 0.16, 0.36, 0.64] }, medium: { label: "Medium aircraft (15,500–300,000 lb, e.g. A320, B737)", t: [0.15, 0.20, 0.44, 0.79] }, heavy: { label: "Heavy aircraft (over 300,000 lb, e.g. B777, A350)", t: [0.17, 0.24, 0.54, 0.96] } };
  const CAT_WORD = ["none", "light", "moderate", "severe", "extreme"];
  const category = (edr, cls) => { if (edr == null || !Number.isFinite(edr)) return null; const t = (CLASSES[cls] || CLASSES.medium).t; let c = 0; while (c < 4 && edr >= t[c]) c++; return c; };

  /* ---------- GRIB2 ---------- */
  function sections(buf) {
    const u = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
    if (u[0] !== 0x47 || u[1] !== 0x52 || u[2] !== 0x49 || u[3] !== 0x42) throw Error("not a GRIB message");
    if (u[7] !== 2) throw Error("not GRIB edition 2");
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), total = Number(dv.getBigUint64(8));
    if (total > u.length) throw Error("GRIB message truncated (" + u.length + " of " + total + " bytes)");
    const s = {}; let p = 16;
    while (p < total - 4) { const len = dv.getUint32(p), num = u[p + 4]; s[num] = { off: p, len }; p += len; }
    if (String.fromCharCode(u[total - 4], u[total - 3], u[total - 2], u[total - 1]) !== "7777") throw Error("GRIB end marker missing");
    return { u, dv, s, total, discipline: u[6] };
  }
  const sgn16 = (v) => (v & 0x8000 ? -(v & 0x7fff) : v), sgn32 = (v) => (v & 0x80000000 ? -(v & 0x7fffffff) : v), sgnN = (v, bytes) => { const top = 2 ** (bytes * 8 - 1); return v >= top ? -(v - top) : v; };
  function bits(u, start) { let pos = start * 8; return { read(n) { let v = 0; for (let i = 0; i < n; i++) { v = v * 2 + ((u[pos >> 3] >> (7 - (pos & 7))) & 1); pos++; } return v; }, align() { pos = Math.ceil(pos / 8) * 8; }, get byte() { return pos >> 3; } }; }
  function decode(buf) {
    const { u, dv, s, discipline } = sections(buf);
    const s1 = s[1].off, s3 = s[3].off, s4 = s[4].off, s5 = s[5].off, s6 = s[6].off, s7 = s[7].off;
    const ref = { year: dv.getUint16(s1 + 12), month: u[s1 + 14], day: u[s1 + 15], hour: u[s1 + 16], minute: u[s1 + 17] };
    const refTime = Date.UTC(ref.year, ref.month - 1, ref.day, ref.hour, ref.minute);
    if (dv.getUint16(s3 + 12) !== 30) throw Error("grid template " + dv.getUint16(s3 + 12) + " not supported (Lambert conformal only)");
    const g = s3 + 14; // template 3.30 starts at octet 15
    const grid = { shape: u[g], nx: dv.getUint32(g + 16), ny: dv.getUint32(g + 20), la1: sgn32(dv.getUint32(g + 24)) / 1e6, lo1: dv.getUint32(g + 28) / 1e6, laD: sgn32(dv.getUint32(g + 33)) / 1e6, loV: dv.getUint32(g + 37) / 1e6,
      dx: dv.getUint32(g + 41) / 1e3, dy: dv.getUint32(g + 45) / 1e3, scan: u[g + 50], latin1: sgn32(dv.getUint32(g + 51)) / 1e6, latin2: sgn32(dv.getUint32(g + 55)) / 1e6 };
    if (grid.shape !== 6) throw Error("earth shape " + grid.shape + " not supported");
    const pdt = dv.getUint16(s4 + 7), p = s4 + 9;
    const product = { category: u[p], number: u[p + 1], unitOfTime: u[p + 8], forecast: dv.getUint32(p + 9), levelType: u[p + 13], levelScale: u[p + 14], levelValue: dv.getUint32(p + 15), pdt };
    if (product.unitOfTime !== 1) throw Error("forecast time unit " + product.unitOfTime + " not supported (hours only)");
    const npts = dv.getUint32(s5 + 5), tmpl = dv.getUint16(s5 + 9), t = s5 + 11;
    if (tmpl !== 3) throw Error("packing template " + tmpl + " not supported (complex packing with spatial differencing only)");
    const R = dv.getFloat32(t), E = sgn16(dv.getUint16(t + 4)), D = sgn16(dv.getUint16(t + 6)), nbits = u[t + 8], missMgmt = u[t + 11];
    const NG = dv.getUint32(t + 20), widthRef = u[t + 24], widthBits = u[t + 25], lenRef = dv.getUint32(t + 26), lenInc = u[t + 30], lastLen = dv.getUint32(t + 31), lenBits = u[t + 35], order = u[t + 36], extra = u[t + 37];
    if (missMgmt !== 0) throw Error("missing-value management " + missMgmt + " not supported");
    // bitmap (section 6): indicator 0 = a bitmap follows
    const bmInd = u[s6 + 5], total = grid.nx * grid.ny; let bitmap = null;
    if (bmInd === 0) bitmap = u.subarray(s6 + 6, s6 + s[6].len); else if (bmInd !== 255) throw Error("bitmap indicator " + bmInd + " not supported");
    const vals = new Float64Array(npts);
    if (nbits) {
      let q = s7 + 5; const rd = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + u[q + i]; q += n; return sgnN(v, n); };
      const ival1 = order >= 1 ? rd(extra) : 0, ival2 = order >= 2 ? rd(extra) : 0, minsd = rd(extra);
      const b = bits(u, q), gref = new Array(NG), gw = new Array(NG), gl = new Array(NG);
      for (let i = 0; i < NG; i++) gref[i] = b.read(nbits); b.align();
      for (let i = 0; i < NG; i++) gw[i] = widthRef + b.read(widthBits); b.align();
      for (let i = 0; i < NG; i++) gl[i] = lenRef + lenInc * b.read(lenBits); b.align(); gl[NG - 1] = lastLen;
      let k = 0;
      for (let i = 0; i < NG; i++) { const w = gw[i], r0 = gref[i]; for (let j = 0; j < gl[i]; j++) vals[k++] = r0 + (w ? b.read(w) : 0); }
      if (k !== npts) throw Error("unpacked " + k + " values for " + npts + " points");
      if (order === 1) { vals[0] = ival1; for (let i = 1; i < npts; i++) vals[i] = vals[i] + minsd + vals[i - 1]; }
      else if (order === 2) { vals[0] = ival1; if (npts > 1) vals[1] = ival2; for (let i = 2; i < npts; i++) vals[i] = vals[i] + minsd + 2 * vals[i - 1] - vals[i - 2]; }
    }
    const scale2 = 2 ** E, scale10 = 10 ** -D, field = new Float32Array(total).fill(NaN);
    for (let i = 0, k = 0; i < total; i++) { if (bitmap && !((bitmap[i >> 3] >> (7 - (i & 7))) & 1)) continue; field[i] = (R + vals[k++] * scale2) * scale10; }
    const lv = product.levelValue / 10 ** product.levelScale;
    return { grid, product: { ...product, level: lv, discipline }, refTime: new Date(refTime).toISOString(), validTime: new Date(refTime + product.forecast * 3600e3).toISOString(), field, points: npts };
  }

  /* ---------- Lambert conformal (spherical) ---------- */
  function projection(grid) {
    const d = Math.PI / 180, R = R_EARTH, p1 = grid.latin1 * d, p2 = grid.latin2 * d, p0 = grid.laD * d, l0 = ((grid.loV + 540) % 360 - 180) * d;
    const n = Math.abs(p1 - p2) < 1e-9 ? Math.sin(p1) : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    const F = (Math.cos(p1) * Math.tan(Math.PI / 4 + p1 / 2) ** n) / n, rho = (phi) => (R * F) / Math.tan(Math.PI / 4 + phi / 2) ** n, rho0 = rho(p0);
    const fwd = (lon, lat) => { let dl = lon * d - l0; while (dl > Math.PI) dl -= 2 * Math.PI; while (dl < -Math.PI) dl += 2 * Math.PI; const r = rho(lat * d); return [r * Math.sin(n * dl), rho0 - r * Math.cos(n * dl)]; };
    const [x1, y1] = fwd(((grid.lo1 + 540) % 360) - 180, grid.la1);
    /* grid indices (fractional) of a lon/lat; scanning mode 64: i east, j north, rows consecutive in i */
    const ij = (lon, lat) => { const [x, y] = fwd(lon, lat); return [(x - x1) / grid.dx, (y - y1) / grid.dy]; };
    const inv = (i, j) => { const x = x1 + i * grid.dx, y = y1 + j * grid.dy, yy = rho0 - y, r = Math.sign(n) * Math.hypot(x, yy), th = Math.atan2(Math.sign(n) * x, Math.sign(n) * yy);
      const lat = 2 * Math.atan((R * F / r) ** (1 / n)) - Math.PI / 2; return [((th / n + l0) / d + 540) % 360 - 180, lat / d]; };
    return { ij, inv, n };
  }
  /* the value at a lon/lat: the nearest grid point (no interpolation: what the model says at that 3 km cell) */
  function valueAt(dec, lon, lat, P) {
    const [fi, fj] = (P || projection(dec.grid)).ij(lon, lat), i = Math.round(fi) + 0, j = Math.round(fj) + 0; // + 0: no negative zero at the edge
    if (i < 0 || j < 0 || i >= dec.grid.nx || j >= dec.grid.ny) return { inside: false, value: null, i, j };
    const v = dec.field[j * dec.grid.nx + i]; return { inside: true, value: Number.isFinite(v) ? v : null, i, j };
  }
  /* a Web Mercator image of the field (RGBA), with its lon/lat corners for a map image source */
  function render(dec, opts = {}) {
    const cls = opts.cls || "medium", colors = opts.colors || PALETTE;
    return renderWith(dec, (v) => { const c = category(v, cls); return c ? colors[c] : null; }, opts);
  }
  /* any field: color(value, cellIndex) gives [r, g, b, a] or null (transparent); cells without a value are never coloured */
  function renderWith(dec, color, opts = {}) {
    const P = projection(dec.grid), W = opts.width || 1100;
    let w = Infinity, e = -Infinity, s = Infinity, nn = -Infinity;
    for (const [i, j] of [[0, 0], [dec.grid.nx - 1, 0], [0, dec.grid.ny - 1], [dec.grid.nx - 1, dec.grid.ny - 1], [(dec.grid.nx - 1) / 2, 0], [(dec.grid.nx - 1) / 2, dec.grid.ny - 1]]) { const [lo, la] = P.inv(i, j); w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); nn = Math.max(nn, la); }
    const my = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)), yN = my(nn), yS = my(s), H = Math.round((W * (yN - yS)) / ((e - w) * Math.PI / 180));
    const out = new Uint8ClampedArray(W * H * 4), nx = dec.grid.nx, ny = dec.grid.ny, f = dec.field;
    for (let py = 0; py < H; py++) {
      const lat = (2 * Math.atan(Math.exp(yN - ((py + 0.5) / H) * (yN - yS))) - Math.PI / 2) * 180 / Math.PI;
      for (let px = 0; px < W; px++) {
        const lon = w + ((px + 0.5) / W) * (e - w), [fi, fj] = P.ij(lon, lat), i = Math.round(fi), j = Math.round(fj);
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue; const k = j * nx + i, v = f[k]; if (!Number.isFinite(v)) continue;
        const col = color(v, k); if (!col) continue; const o = (py * W + px) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = col[3];
      }
    }
    return { width: W, height: H, rgba: out, coordinates: [[w, nn], [e, nn], [e, s], [w, s]] };
  }
  /* model guidance is drawn as a violet fill, apart from advisories (outlined areas) and pilot reports (dots and rings) */
  const PALETTE = { 1: [196, 181, 253, 120], 2: [139, 92, 246, 170], 3: [91, 33, 182, 210], 4: [46, 16, 101, 235] };
  const levelLabel = (ft) => (ft >= 18000 ? "FL" + String(ft / 100).padStart(3, "0") : ft.toLocaleString("en-US") + " ft");
  /* ---------- Planner: modeled turbulence along an approximate route ----------
     Which records to read for a route: the GTG heights inside the altitude band (at most MAX_LEVELS, spread evenly, always
     the band's lowest and highest) and the model's whole-hour valid times inside the time in the air (at most MAX_HOURS:
     first, last and the middle), limited to what the cycle reaches (cycle + 18 h). */
  const MAX_LEVELS = 4, MAX_HOURS = 3, SAMPLE_KM = 10, MI = 1.609344, REACH_H = 18, STALE_H = 4;
  function routePlan(route, cycleMs, now) {
    const inBand = HEIGHTS.filter((h) => h.ft >= 1000 && h.ft >= route.lowFt && h.ft <= route.highFt);
    const pick = (a, n) => (a.length <= n ? a : Array.from({ length: n }, (_, k) => a[Math.round((k * (a.length - 1)) / (n - 1))]).filter((x, k, all) => all.indexOf(x) === k));
    let levels = pick(inBand, MAX_LEVELS);
    if (!levels.length) { const mid = (route.lowFt + route.highFt) / 2; levels = [HEIGHTS.filter((h) => h.ft >= 1000).reduce((a, b) => (Math.abs(b.ft - mid) < Math.abs(a.ft - mid) ? b : a))]; }
    const reachMs = cycleMs + REACH_H * 3600e3, from = Math.max(route.startMs, now - 30 * 60e3);
    const hrs = []; for (let t = Math.ceil((route.startMs - 30 * 60e3) / 3600e3) * 3600e3; t <= route.endMs + 30 * 60e3; t += 3600e3) if (t >= cycleMs && t <= reachMs && t >= from - 30 * 60e3) hrs.push(t);
    const hours = pick(hrs, MAX_HOURS).map((t) => ({ validMs: t, fh: Math.round((t - cycleMs) / 3600e3) }));
    return { levels: levels.map((h) => ({ ft: h.ft, m: h.m })), hours, reachMs };
  }
  const kmBetween = (a, b) => { const kx = 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180); return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110.574); };
  /* fields: [{ ft, fh, validMs, dec }] read for the plan; failed: [{ ft, fh, error }]. Timed: the route has its own time in
     the air, so each point's time is estimated by steady progress along the straight line; otherwise every checked hour counts
     for every point (a potential overlap, no encounter time). Findings: stretches of moderate or worse for the aircraft class. */
  function routeTurbulence({ route, cls, fields, failed = [], cycleMs, now, plan }) {
    const P = fields.length ? projection(fields[0].dec.grid) : null, L = kmBetween(route.oPt, route.dPt), n = Math.max(2, Math.ceil(L / SAMPLE_KM) + 1);
    const timed = !!route.timed, span = route.endMs - route.startMs, reachMs = plan.reachMs;
    const byHour = new Map(); for (const f of fields) { if (!byHour.has(f.validMs)) byHour.set(f.validMs, []); byHour.get(f.validMs).push(f); }
    const hourList = [...byHour.keys()].sort((a, b) => a - b), pts = [];
    for (let k = 0; k < n; k++) {
      const fr = k / (n - 1), pt = [route.oPt[0] + (route.dPt[0] - route.oPt[0]) * fr, route.oPt[1] + (route.dPt[1] - route.oPt[1]) * fr], mi = (fr * L) / MI;
      const t = timed ? route.startMs + fr * span : null;
      if (timed && t > reachMs + 30 * 60e3) { pts.push({ k, pt, mi, t, gap: "noForecast" }); continue; }
      if (timed && t < now - 30 * 60e3) { pts.push({ k, pt, mi, t, gap: "past" }); continue; }
      const hs = timed ? (hourList.length ? [hourList.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a))] : []) : hourList;
      let best = null, inside = false, any = false;
      for (const h of hs) for (const f of byHour.get(h)) { const v = valueAt(f.dec, pt[0], pt[1], P); if (v.inside) inside = true; if (v.value == null) continue; any = true; if (!best || v.value > best.edr) best = { edr: v.value, ft: f.ft, validMs: f.validMs, fh: f.fh }; }
      pts.push({ k, pt, mi, t, gap: !hs.length ? "noForecast" : !inside ? "outside" : !any ? "masked" : null, best, cat: best ? category(best.edr, cls) : null });
    }
    const runs = (pred) => { const out = []; let cur = null; for (const p of pts) { if (pred(p)) { if (!cur) out.push((cur = [])); cur.push(p); } else cur = null; } return out; };
    const findings = runs((p) => !p.gap && p.cat >= 2).map((r) => {
      const peak = r.reduce((a, b) => (b.best.edr > a.best.edr ? b : a)), mid = r[Math.floor(r.length / 2)];
      return { fromMi: Math.round(r[0].mi), toMi: Math.round(r[r.length - 1].mi), midPt: peak.pt, cat: Math.max(...r.map((p) => p.cat)), peak: peak.best, levels: [...new Set(r.map((p) => p.best.ft))].sort((a, b) => a - b),
        validTimes: [...new Set(r.map((p) => p.best.validMs))].sort((a, b) => a - b), encounter: timed ? { fromMs: r[0].t, toMs: r[r.length - 1].t } : null, midMi: Math.round(mid.mi) };
    });
    const gaps = ["outside", "masked", "noForecast", "past"].map((g) => ({ kind: g, runs: runs((p) => p.gap === g).map((r) => ({ fromMi: Math.round(r[0].mi), toMi: Math.round(r[r.length - 1].mi), fromMs: r[0].t, toMs: r[r.length - 1].t })) })).filter((g) => g.runs.length);
    const light = pts.filter((p) => !p.gap && p.cat === 1).length, checked = pts.filter((p) => !p.gap).length;
    const windowBeyond = route.endMs > reachMs + 30 * 60e3, stale = now - cycleMs > STALE_H * 3600e3;
    const complete = !gaps.length && !failed.length && !windowBeyond && !stale && hourList.length > 0;
    return { timed, lengthMi: Math.round(L / MI), samples: n, checked, light, findings, gaps, failed, windowBeyond, reachMs, stale, cycleMs, complete, levels: plan.levels.map((l) => l.ft), hours: hourList, cls };
  }
  return { HEIGHTS, CLASSES, CAT_WORD, PALETTE, category, decode, projection, valueAt, render, renderWith, levelLabel, sections, routePlan, routeTurbulence, MAX_LEVELS, MAX_HOURS, REACH_H, STALE_H };
});
