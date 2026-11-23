/* Weather threats, aviation: NOAA NCEP In-Flight Icing (IFI), model guidance. Pure; uses ThreatsGTG's GRIB2 decoder and
   Lambert projection (same 3 km CONUS grid). Shared by the map and the Node tests.

   Source: NCEP Domestic Aviation Forecast System (DAFS), dafs.tCCz.ifi.3km.conus.fFFF.grib2 on NOMADS: hourly cycles, forecast
   hours 1-18 (no analysis hour), 180 records = 60 heights x 3 fields. Heights: 152.4 m (500 ft) to 9,144 m (30,000 ft) above
   MSL every 500 ft. Fields, as NCEP's GRIB2 tables name them (grib2_table4-2-0-19):
     prob  0/19/233 ICPRB "Icing probability", non-dim (0-1 in steps of 0.01). Bitmap: no value below the ground.
     sev   0/19/37  ICESEV "Icing Severity", Table 4.228: 0 None, 1 Trace, 2 Light, 3 Moderate, 4 Severe, 255 Missing. No
           bitmap: cells below the ground carry 0 ("None"), so the map takes the ground mask from the probability record of the
           same height and hour, and never reads a below-ground cell as "None".
     (not drawn) 0/19/217 SIPD "Supercooled Large Droplet (SLD) Icing", which NCEP's table gives in Table 4.207 codes, but the
           files hold -0.1 and 0 to 1 in steps of 0.1; -0.1 is not defined in the tables, so the field is left out. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./threats-gtg.js"));
  else root.ThreatsIFI = factory(root.ThreatsGTG);
})(typeof globalThis !== "undefined" ? globalThis : this, function (G) {
  "use strict";
  const HEIGHTS = Array.from({ length: 60 }, (_, k) => ({ ft: (k + 1) * 500, m: Math.round((k + 1) * 500 * 0.3048 * 10) / 10 }));
  const FIELDS = {
    prob: { label: "Icing probability", grib: "GRIB2 0/19/233 (ICPRB)", unit: "non-dimensional, 0–1", category: 19, number: 233 },
    sev: { label: "Icing severity", grib: "GRIB2 0/19/37 (ICESEV), NCEP Table 4.228", unit: "category", category: 19, number: 37 },
  };
  const SEV_WORD = ["none", "trace", "light", "moderate", "severe"];
  /* modeled icing is drawn in cyan-to-teal fills, apart from turbulence guidance (violet), icing advisories (blue outlines) and
     pilot reports (dots and rings) */
  const PROB_BINS = [[0.05, "5–20%"], [0.2, "20–40%"], [0.4, "40–60%"], [0.6, "60% or more"]];
  const PROB_COLORS = [[207, 250, 254, 110], [103, 232, 249, 150], [8, 145, 178, 190], [22, 78, 99, 225]];
  const SEV_COLORS = { 1: [207, 250, 254, 110], 2: [103, 232, 249, 150], 3: [8, 145, 178, 195], 4: [22, 78, 99, 230] };
  const probBin = (v) => { let b = -1; for (let i = 0; i < PROB_BINS.length; i++) if (v >= PROB_BINS[i][0]) b = i; return b; };
  const sevCode = (v) => (Number.isFinite(v) && v >= 0 && v <= 4 && Math.round(v) === v ? v : v === 255 ? null : NaN);
  function check(dec, field, ft, fh) {
    const f = FIELDS[field], h = HEIGHTS.find((x) => x.ft === ft);
    if (!f || !h) throw Error("unknown IFI field or height");
    if (dec.product.category !== f.category || dec.product.number !== f.number) throw Error("expected " + f.grib + ", got 0/" + dec.product.category + "/" + dec.product.number);
    if (Math.abs(dec.product.level - h.m) > 0.05) throw Error("expected " + h.m + " m, got " + dec.product.level + " m");
    if (fh != null && dec.product.forecast !== fh) throw Error("expected +" + fh + " h, got +" + dec.product.forecast + " h");
    return true;
  }
  /* the value at a spot: probability as published (0-1); severity as its Table 4.228 word, masked where the probability record
     has no value (below the ground) */
  function valueAt(dec, field, lon, lat, mask, P) {
    const v = G.valueAt(dec, lon, lat, P); if (!v.inside) return { inside: false };
    if (field === "prob") return { inside: true, i: v.i, j: v.j, value: v.value, text: v.value == null ? "no value (below the ground)" : "icing probability " + Math.round(v.value * 100) + "%" };
    const m = mask ? mask.field[v.j * dec.grid.nx + v.i] : 0; if (!Number.isFinite(m)) return { inside: true, i: v.i, j: v.j, value: null, text: "no value (below the ground)" };
    const c = sevCode(v.value); return { inside: true, i: v.i, j: v.j, value: v.value, code: c, text: c == null ? "missing (255)" : Number.isNaN(c) ? "not a Table 4.228 code (" + v.value + ")" : "icing severity " + SEV_WORD[c] + " (code " + c + ")" };
  }
  function render(dec, field, opts = {}) {
    const mask = opts.mask ? opts.mask.field : null;
    return G.renderWith(dec, field === "prob" ? (v) => { const b = probBin(v); return b < 0 ? null : PROB_COLORS[b]; } : (v, k) => { if (mask && !Number.isFinite(mask[k])) return null; const c = sevCode(v); return c >= 1 ? SEV_COLORS[c] : null; }, opts);
  }
  const levelLabel = (ft) => (ft >= 18000 ? "FL" + String(ft / 100).padStart(3, "0") : ft.toLocaleString("en-US") + " ft");
  /* ---------- Planner: modeled icing along an approximate route ----------
     Heights: IFI heights in the band on whole thousands of feet (the map's control), at most MAX_LEVELS spread evenly (always
     the band's lowest and highest); heights above 30,000 ft are out of range and said so. Hours: the model's whole hours in the
     time in the air, at most MAX_HOURS, inside the cycle's +1 to +18 h. Findings: stretches with icing probability at or above
     PROB_MIN, and, separately, modeled severity at or above SEV_MIN. Each names the other field at the same cell, height and
     valid time. Cells below the ground have no value and are never "no icing". */
  const MAX_LEVELS = 4, MAX_HOURS = 3, SAMPLE_KM = 10, MI = 1.609344, STALE_H = 4, PROB_MIN = 0.4, SEV_MIN = 3;
  function routePlan(route, cycleMs, now) {
    const all = HEIGHTS.filter((h) => h.ft % 1000 === 0 && h.ft >= route.lowFt && h.ft <= route.highFt);
    const pick = (a, n) => (a.length <= n ? a : Array.from({ length: n }, (_, k) => a[Math.round((k * (a.length - 1)) / (n - 1))]).filter((x, k, l) => l.indexOf(x) === k));
    const levels = pick(all, MAX_LEVELS), aboveTop = route.highFt > 30000;
    const first = cycleMs + 3600e3, reachMs = cycleMs + 18 * 3600e3, from = Math.max(route.startMs, now - 30 * 60e3), hrs = [];
    for (let t = Math.ceil((route.startMs - 30 * 60e3) / 3600e3) * 3600e3; t <= route.endMs + 30 * 60e3; t += 3600e3) if (t >= first && t <= reachMs && t >= from - 30 * 60e3) hrs.push(t);
    return { levels: levels.map((h) => ({ ft: h.ft, m: h.m })), hours: pick(hrs, MAX_HOURS).map((t) => ({ validMs: t, fh: Math.round((t - cycleMs) / 3600e3) })), firstMs: first, reachMs, aboveTop, noLevels: !levels.length };
  }
  const kmBetween = (a, b) => { const kx = 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180); return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110.574); };
  /* fields: [{ ft, fh, validMs, prob: dec, sev: dec }]; failed: [{ ft, fh, validMs, field, error }] */
  function routeIcing({ route, fields, failed = [], cycleMs, now, plan }) {
    const P = fields.length ? G.projection(fields[0].prob.grid) : null, L = kmBetween(route.oPt, route.dPt), n = Math.max(2, Math.ceil(L / SAMPLE_KM) + 1);
    const timed = !!route.timed, span = route.endMs - route.startMs, byHour = new Map();
    for (const f of fields) { if (!byHour.has(f.validMs)) byHour.set(f.validMs, []); byHour.get(f.validMs).push(f); }
    const hourList = [...byHour.keys()].sort((a, b) => a - b), pts = [];
    for (let k = 0; k < n; k++) {
      const fr = k / (n - 1), pt = [route.oPt[0] + (route.dPt[0] - route.oPt[0]) * fr, route.oPt[1] + (route.dPt[1] - route.oPt[1]) * fr], mi = (fr * L) / MI, t = timed ? route.startMs + fr * span : null;
      if (timed && t > plan.reachMs + 30 * 60e3) { pts.push({ k, pt, mi, t, gap: "noForecast" }); continue; }
      if (timed && t < plan.firstMs - 30 * 60e3) { pts.push({ k, pt, mi, t, gap: "beforeFirst" }); continue; }
      if (timed && t < now - 30 * 60e3) { pts.push({ k, pt, mi, t, gap: "past" }); continue; }
      const hs = timed ? (hourList.length ? [hourList.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a))] : []) : hourList;
      let inside = false, below = 0, levelsSeen = 0, prob = null, sev = null;
      for (const h of hs) for (const f of byHour.get(h)) {
        const v = G.valueAt(f.prob, pt[0], pt[1], P); if (!v.inside) continue; inside = true; levelsSeen++;
        if (v.value == null) { below++; continue; } // no probability value: below the ground (severity says 0 there)
        const sv = sevCode(f.sev.field[v.j * f.prob.grid.nx + v.i]), cell = { ft: f.ft, fh: f.fh, validMs: f.validMs, i: v.i, j: v.j };
        if (!prob || v.value > prob.v) prob = { v: v.value, sevSame: Number.isInteger(sv) ? sv : null, ...cell };
        if (Number.isInteger(sv) && (!sev || sv > sev.v)) sev = { v: sv, probSame: v.value, ...cell };
      }
      pts.push({ k, pt, mi, t, gap: !hs.length ? "noForecast" : !inside ? "outside" : levelsSeen && below === levelsSeen ? "belowGround" : null, prob, sev, partBelow: below > 0 && below < levelsSeen });
    }
    const runs = (pred) => { const out = []; let cur = null; for (const p of pts) { if (pred(p)) { if (!cur) out.push((cur = [])); cur.push(p); } else cur = null; } return out; };
    const finding = (r, key) => { const peak = r.reduce((a, b) => (b[key].v > a[key].v ? b : a)), x = peak[key];
      return { fromMi: Math.round(r[0].mi), toMi: Math.round(r[r.length - 1].mi), midPt: peak.pt, peak: x, levels: [...new Set(r.map((p) => p[key].ft))].sort((a, b) => a - b), validTimes: [...new Set(r.map((p) => p[key].validMs))].sort((a, b) => a - b), encounter: timed ? { fromMs: r[0].t, toMs: r[r.length - 1].t } : null }; };
    const probFindings = runs((p) => !p.gap && p.prob && p.prob.v >= PROB_MIN).map((r) => finding(r, "prob"));
    const sevFindings = runs((p) => !p.gap && p.sev && p.sev.v >= SEV_MIN).map((r) => finding(r, "sev"));
    const gaps = ["outside", "belowGround", "noForecast", "beforeFirst", "past"].map((g) => ({ kind: g, runs: runs((p) => p.gap === g).map((r) => ({ fromMi: Math.round(r[0].mi), toMi: Math.round(r[r.length - 1].mi), fromMs: r[0].t, toMs: r[r.length - 1].t })) })).filter((g) => g.runs.length);
    const partBelow = runs((p) => !p.gap && p.partBelow).map((r) => ({ fromMi: Math.round(r[0].mi), toMi: Math.round(r[r.length - 1].mi) }));
    const checked = pts.filter((p) => !p.gap).length, windowBeyond = route.endMs > plan.reachMs + 30 * 60e3, windowBefore = route.startMs < plan.firstMs - 30 * 60e3, stale = now - cycleMs > STALE_H * 3600e3;
    const complete = !gaps.length && !failed.length && !windowBeyond && !windowBefore && !stale && !plan.aboveTop && !plan.noLevels && hourList.length > 0;
    return { timed, lengthMi: Math.round(L / MI), samples: n, checked, probFindings, sevFindings, gaps, partBelow, failed, windowBeyond, windowBefore, aboveTop: plan.aboveTop, noLevels: plan.noLevels, firstMs: plan.firstMs, reachMs: plan.reachMs, stale, cycleMs, complete,
      levels: plan.levels.map((l) => l.ft), hours: hourList, probMin: PROB_MIN, sevMin: SEV_MIN, maxProb: Math.max(0, ...pts.filter((p) => p.prob).map((p) => p.prob.v)), maxSev: Math.max(0, ...pts.filter((p) => p.sev).map((p) => p.sev.v)) };
  }
  return { HEIGHTS, FIELDS, SEV_WORD, PROB_BINS, PROB_COLORS, SEV_COLORS, check, valueAt, render, levelLabel, sevCode, TOP_FT: 30000, FIRST_FH: 1, LAST_FH: 18, routePlan, routeIcing, PROB_MIN, SEV_MIN, MAX_LEVELS, MAX_HOURS };
});
