/* Forecast Ops core: pure forecast math, with no page or DOM code.
   Loads in a browser (window.OpsCore) or Node (require), so the same
   calculations can move into Heads-Up / OPE later and can be tested on their own.

   Conventions: winds in knots unless noted, heights in m above ground,
   temperatures in °C for soundings. Missing values are null, never 0. */
(function (root) {
  "use strict";

  /* ======================= stats ======================= */
  const stats = {
    /* Weighted mean/min/max across series at each index. series: [{w, data[]}] */
    blendSeries(series, n) {
      const mean = [], min = [], max = [], count = [];
      for (let i = 0; i < n; i++) {
        let s = 0, w = 0, lo = Infinity, hi = -Infinity, c = 0;
        for (const x of series) { const v = x.data[i]; if (v == null || !isFinite(v)) continue; s += x.w * v; w += x.w; c++; lo = Math.min(lo, v); hi = Math.max(hi, v); }
        mean.push(w ? s / w : null); min.push(w ? lo : null); max.push(w ? hi : null); count.push(c);
      }
      return { mean, min, max, count };
    },
    weightedQuantile(vals, ws, q) {
      const idx = vals.map((v, i) => i).filter((i) => vals[i] != null).sort((a, b) => vals[a] - vals[b]);
      const tot = idx.reduce((s, i) => s + ws[i], 0); if (!tot) return null;
      let acc = 0;
      for (const i of idx) { acc += ws[i]; if (acc / tot >= q) return vals[i]; }
      return vals[idx[idx.length - 1]];
    },
    /* Running total. Once an hour is missing the rest is unknown, so it stays null. */
    cumulativeStrict(a) {
      let t = 0, broken = false;
      return a.map((x) => { if (broken || x == null) { broken = true; return null; } return (t += x); });
    },
    /* Sum over [s, e) only if at least minCov of the hours are present; else null. */
    windowTotal(a, s, e, minCov = 0.9) {
      let t = 0, n = 0;
      for (let i = s; i < e; i++) if (a[i] != null) { t += a[i]; n++; }
      return e > s && n / (e - s) >= minCov ? t : null;
    },
    /* Align a series onto a master time axis by timestamp string. */
    align(masterTimes, times, arr) {
      if (!arr) return masterTimes.map(() => null);
      const at = new Map(times.map((t, i) => [t, i]));
      return masterTimes.map((t) => { const i = at.get(t); return i == null ? null : arr[i]; });
    },
    /* Weighted share of members/models meeting a test. Missing values don't count either way. */
    weightedShare(vals, ws, test) {
      let w = 0, hit = 0;
      vals.forEach((v, i) => { if (v == null) return; w += ws[i]; if (test(v)) hit += ws[i]; });
      return w ? hit / w : null;
    },
  };

  /* ======================= tiers ======================= */
  /* Same fixed colors as Heads-Up. In guidance tools the words describe signal strength, not an action. */
  const TIERS = {
    nodata: { rank: -1, word: "NO DATA" },
    normal: { rank: 0, word: "LOW" },
    limited: { rank: 0.5, word: "LIMITED DATA" },
    monitor: { rank: 1, word: "MARGINAL" },
    prepare: { rank: 2, word: "ELEVATED" },
    action: { rank: 3, word: "HIGH" },
  };
  const maxTier = (list) => list.reduce((a, b) => (TIERS[b] && TIERS[b].rank > TIERS[a].rank ? b : a), "nodata");

  /* ======================= blend ======================= */
  const blend = {
    /* Agreement of model daily highs: a data-quality note about temperature only. */
    agreement(highs) {
      const v = highs.filter((x) => x != null);
      if (v.length < 2) return { level: 0, word: "1 MODEL", lo: v[0] ?? null, hi: v[0] ?? null };
      const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo;
      return { level: r <= 3 ? 3 : r <= 6 ? 2 : 1, word: r <= 3 ? "TIGHT" : r <= 6 ? "FAIR" : "WIDE", lo, hi, range: r, n: v.length };
    },
  };

  /* ======================= thunder ======================= */
  const thunder = {
    isThunderCode: (c) => c != null && c >= 95 && c <= 99,
    /* frac: weighted share of models with a thunder code (null if none report codes). */
    tier(frac, cape, pop) {
      if (frac == null && cape == null) return "nodata";
      const f = frac || 0, c = cape == null ? 0 : cape, p = pop == null ? 0 : pop;
      if (f >= 0.5 && (cape == null || c >= 250)) return "action";
      if (f >= 0.25 || (c >= 1000 && p >= 40)) return "prepare";
      if (f > 0 || (c >= 250 && p >= 20)) return "monitor";
      /* Instability is there but a missing input could have raised the tier. */
      if (c >= 250 && (frac == null || pop == null)) return "limited";
      return "normal";
    },
  };

  /* ======================= severe ======================= */
  const MS = 0.514444;          // knots -> m/s
  const BUNKERS_KT = 7.5 / MS;  // 7.5 m/s deviation, in knots
  const uv = (s, d) => ({ u: -s * Math.sin((d * Math.PI) / 180), v: -s * Math.cos((d * Math.PI) / 180) });
  const mag = (a) => Math.hypot(a.u, a.v);
  const fromDir = (a) => ((Math.atan2(-a.u, -a.v) * 180) / Math.PI + 360) % 360;

  /* Linear interpolation of a field to height h. Null above the highest point that has it. */
  function at(pts, key, h) {
    const ok = pts.filter((p) => p[key] != null);
    if (!ok.length || h > ok[ok.length - 1].h + 1) return null;
    if (h <= ok[0].h) return ok[0][key];
    for (let k = 0; k < ok.length - 1; k++) {
      const a = ok[k], b = ok[k + 1];
      if (h >= a.h && h <= b.h) return a[key] + ((b[key] - a[key]) * (h - a.h)) / (b.h - a.h);
    }
    return null;
  }
  const windAt = (pts, h) => { const u = at(pts, "u", h), v = at(pts, "v", h); return u == null || v == null ? null : { u, v }; };
  function layerMean(pts, h0, h1, step = 250) {
    let u = 0, v = 0, n = 0;
    for (let h = h0; h <= h1 + 1e-6; h += step) { const w = windAt(pts, h); if (!w) return null; u += w.u; v += w.v; n++; }
    return { u: u / n, v: v / n };
  }
  const severe = {
    LEVELS: [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250],
    uv, mag, fromDir, at, windAt,
    /* Build a sounding from flat hourly arrays (Open-Meteo naming) at index i. */
    sounding(a, i, elev) {
      const s10 = a.wind_speed_10m && a.wind_speed_10m[i], d10 = a.wind_direction_10m && a.wind_direction_10m[i];
      if (s10 == null || d10 == null) return null;
      const pts = [{ h: 10, ...uv(s10, d10), t: a.temperature_2m ? a.temperature_2m[i] : null, p: null }];
      for (const p of severe.LEVELS) {
        const zA = a[`geopotential_height_${p}hPa`], z = zA && zA[i];
        if (z == null) continue;
        const h = z - elev;
        if (h <= 30) continue; // below ground here
        const s = a[`wind_speed_${p}hPa`] && a[`wind_speed_${p}hPa`][i], d = a[`wind_direction_${p}hPa`] && a[`wind_direction_${p}hPa`][i];
        const w = s != null && d != null ? uv(s, d) : { u: null, v: null };
        pts.push({ h, u: w.u, v: w.v, t: a[`temperature_${p}hPa`] ? a[`temperature_${p}hPa`][i] : null, p });
      }
      pts.sort((x, y) => x.h - y.h);
      return pts;
    },
    /* Bunkers internal-dynamics method, non-pressure-weighted 0–6 km mean wind. */
    bunkers(pts) {
      const mean = layerMean(pts, 0, 6000), lo = layerMean(pts, 0, 500), hi = layerMean(pts, 5500, 6000);
      if (!mean || !lo || !hi) return null;
      const s = { u: hi.u - lo.u, v: hi.v - lo.v }, m = mag(s);
      if (m < 1e-6) return { rm: mean, lm: mean, mean };
      const k = BUNKERS_KT / m;
      return { rm: { u: mean.u + k * s.v, v: mean.v - k * s.u }, lm: { u: mean.u - k * s.v, v: mean.v + k * s.u }, mean };
    },
    /* Storm-relative helicity 0–top m, in m²/s². */
    srh(pts, top, sm) {
      let tot = 0, prev = windAt(pts, 0);
      if (!prev) return null;
      for (let h = 100; h <= top; h += 100) {
        const w = windAt(pts, h); if (!w) return null;
        tot += ((w.u - sm.u) * (prev.v - sm.v) - (prev.u - sm.u) * (w.v - sm.v)) * MS * MS;
        prev = w;
      }
      return tot;
    },
    bulk(pts, h) { const a = windAt(pts, 0), b = windAt(pts, h); return a && b ? Math.hypot(b.u - a.u, b.v - a.v) : null; },
    stp(cape, lcl, srh1, bs6kt) {
      if ([cape, lcl, srh1, bs6kt].some((x) => x == null)) return null;
      const lclT = lcl < 1000 ? 1 : lcl > 2000 ? 0 : (2000 - lcl) / 1000;
      const b = bs6kt * MS, shT = b < 12.5 ? 0 : b > 30 ? 1.5 : b / 20;
      return Math.max(0, (cape / 1500) * lclT * (srh1 / 150) * shT);
    },
    scp(cape, srh3, bs6kt) {
      if ([cape, srh3, bs6kt].some((x) => x == null)) return null;
      const b = bs6kt * MS, shT = b < 10 ? 0 : b > 20 ? 1 : b / 20;
      return Math.max(0, (cape / 1000) * (srh3 / 50) * shT);
    },
    /* Every index for one model at one hour. a: hourly arrays (°C, kt), elev: m. */
    indices(a, i, elev) {
      const pts = severe.sounding(a, i, elev);
      const cape = a.cape ? a.cape[i] : null, cin = a.convective_inhibition ? a.convective_inhibition[i] : null;
      const T = a.temperature_2m ? a.temperature_2m[i] : null, Td = a.dew_point_2m ? a.dew_point_2m[i] : null;
      const lcl = T != null && Td != null ? Math.max(0, 125 * (T - Td)) : null;
      const code = a.weather_code ? a.weather_code[i] : null;
      const out = { cape, cin, lcl, thunder: code == null ? null : thunder.isThunderCode(code) ? 1 : 0, bs1: null, bs6: null, mw6: null, srh1: null, srh3: null, lr75: null, lr03: null, frz: null, stp: null, scp: null };
      if (pts) {
        const bk = severe.bunkers(pts);
        out.bs1 = severe.bulk(pts, 1000); out.bs6 = severe.bulk(pts, 6000);
        out.mw6 = bk ? mag(bk.mean) : null;
        out.srh1 = bk ? severe.srh(pts, 1000, bk.rm) : null;
        out.srh3 = bk ? severe.srh(pts, 3000, bk.rm) : null;
        const p7 = pts.find((p) => p.p === 700), p5 = pts.find((p) => p.p === 500);
        out.lr75 = p7 && p5 && p7.t != null && p5.t != null ? (p7.t - p5.t) / ((p5.h - p7.h) / 1000) : null;
        const t3 = at(pts, "t", 3000);
        out.lr03 = T != null && t3 != null ? (T - t3) / 3 : null;
        let frz = a.freezing_level_height ? a.freezing_level_height[i] : null;
        if (frz == null) for (let k = 0; k < pts.length - 1; k++) {
          const x = pts[k], y = pts[k + 1];
          if (x.t != null && y.t != null && x.t >= 0 && y.t < 0) { frz = x.h + ((y.h - x.h) * x.t) / (x.t - y.t) + elev; break; }
        }
        out.frz = frz == null ? null : frz * 3.28084; // ft MSL
      }
      out.stp = severe.stp(cape, lcl, out.srh1, out.bs6);
      out.scp = severe.scp(cape, out.srh3, out.bs6);
      return out;
    },
    /* Environment tier. Missing kinematics with real instability -> "limited", never a quiet LOW. */
    tier(x) {
      if (!x || x.cape == null) return "nodata";
      const c = x.cape;
      if (c < 100) return "normal";
      if ((x.stp != null && x.stp >= 1) || (x.scp != null && x.scp >= 4)) return "action";
      if ((x.scp != null && x.scp >= 1) || (c >= 1000 && x.bs6 != null && x.bs6 >= 40)) return "prepare";
      if (c >= 500 && x.bs6 != null && x.bs6 >= 25) return "monitor";
      if (c >= 500 && (x.bs6 == null || x.srh3 == null)) return "limited";
      return "normal";
    },
    /* Ingredient flags; a flag needs every one of its inputs present. */
    flags(x) {
      const f = [], has = (...k) => k.every((n) => x[n] != null);
      if (has("cape", "lr75", "bs6") && x.cape >= 1000 && x.lr75 >= 7 && x.bs6 >= 30) f.push("HAIL");
      if (x.cape != null && x.cape >= 500 && ((x.lr03 != null && x.lr03 >= 8) || (x.mw6 != null && x.mw6 >= 35))) f.push("WIND");
      if (has("cape", "srh1", "lcl", "bs6") && x.cape >= 250 && x.srh1 >= 100 && x.lcl <= 1250 && x.bs6 >= 30) f.push("TOR");
      return f;
    },
  };

  /* ======================= winter ======================= */
  const winter = {
    THRESH: [0.1, 1, 2, 4, 6, 8, 12],
    /* members: [{w, a[]}] hourly snowfall (in). Returns totals, odds and percentiles for [s, e). */
    windowStats(members, s, e, minCov = 0.9) {
      const tot = members.map((m) => stats.windowTotal(m.a, s, e, minCov));
      const ws = members.map((m) => m.w);
      const used = tot.filter((x) => x != null).length;
      const P = {}; winter.THRESH.forEach((t) => (P[t] = stats.weightedShare(tot, ws, (v) => v >= t)));
      return { tot, P, used, total: members.length,
        p10: stats.weightedQuantile(tot, ws, 0.1), p50: stats.weightedQuantile(tot, ws, 0.5), p90: stats.weightedQuantile(tot, ws, 0.9) };
    },
    tier(P, used) {
      if (!used) return "nodata";
      const p01 = P[0.1] || 0, p1 = P[1] || 0, p4 = P[4] || 0;
      if (p4 >= 0.5) return "action";
      if (p1 >= 0.4 || p4 >= 0.2) return "prepare";
      if (p1 >= 0.1 || p01 >= 0.3) return "monitor";
      return "normal";
    },
  };

  const OpsCore = { stats, TIERS, maxTier, blend, thunder, severe, winter, MS };
  if (typeof module !== "undefined" && module.exports) module.exports = OpsCore;
  root.OpsCore = OpsCore;
})(typeof self !== "undefined" ? self : globalThis);
