/* Severe: model severe-weather environment from pressure-level soundings. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$;
  O.shell("severe", "Severe");

  const MODELS = [
    { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1.25 },
    { id: "ncep_nam_conus", name: "NAM 3 km", w: 1 },
    { id: "gfs_seamless", name: "GFS", w: 1 },
    { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
    { id: "icon_seamless", name: "ICON", w: 1 },
    { id: "gem_seamless", name: "GEM", w: 0.75 },
  ];
  const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250];
  const SURF = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "cape", "convective_inhibition",
    "lifted_index", "freezing_level_height", "precipitation_probability", "weather_code"];
  const PL = [];
  LEVELS.forEach((p) => ["temperature", "wind_speed", "wind_direction", "geopotential_height"].forEach((v) => PL.push(`${v}_${p}hPa`)));
  const HOURLY = [...SURF, ...PL];
  const MS = 0.514444;           // knots -> m/s
  const BUNKERS_KT = 7.5 / MS;   // 7.5 m/s deviation, in knots

  const TABS = [
    { id: "scp", label: "SCP", k: "scp", unit: "", dec: 1, zero: true, thr: [1, 4], sub: "Supercell composite, fixed-layer: (CAPE/1000) × (0–3 km SRH/50) × (0–6 km shear term). Around 1 means supercells are possible. 4 or more strongly favors them." },
    { id: "stp", label: "STP", k: "stp", unit: "", dec: 1, zero: true, thr: [1], sub: "Significant tornado parameter, fixed-layer: (CAPE/1500) × LCL term × (0–1 km SRH/150) × 0–6 km shear term. 1 or more is where most significant-tornado environments sit." },
    { id: "srh1", label: "0–1 km SRH", k: "srh1", unit: "m²/s²", zero: true, thr: [100], sub: "Storm-relative helicity in the lowest kilometer, relative to the Bunkers right-mover." },
    { id: "srh3", label: "0–3 km SRH", k: "srh3", unit: "m²/s²", zero: true, thr: [150], sub: "Storm-relative helicity, 0–3 km, relative to the Bunkers right-mover." },
    { id: "bs6", label: "0–6 km shear", k: "bs6", unit: "kt", zero: true, thr: [40], sub: "Bulk wind difference, 10 m to 6 km. 40 kt or more favors supercells. 25–40 kt supports organized multicells." },
    { id: "bs1", label: "0–1 km shear", k: "bs1", unit: "kt", zero: true, thr: [20], sub: "Bulk wind difference, 10 m to 1 km. Strong low-level shear supports tornadoes when other ingredients are there." },
    { id: "lr75", label: "700–500 lapse", k: "lr75", unit: "°C/km", dec: 1, thr: [7], sub: "Mid-level lapse rate. 7 °C/km or more is steep and helps large hail." },
    { id: "lr03", label: "0–3 km lapse", k: "lr03", unit: "°C/km", dec: 1, thr: [8], sub: "Low-level lapse rate. 8 °C/km or more means a well-mixed boundary layer that favors damaging downbursts." },
    { id: "lcl", label: "LCL", k: "lcl", unit: "m", zero: true, thr: [1000], sub: "Estimated cloud-base height above ground, 125 m × (T − Td). Below about 1000 m favors tornadoes." },
    { id: "frz", label: "Freezing level", k: "frz", unit: "ft", zero: true, sub: "Height of the 0 °C level above sea level. Lower freezing levels let more hail reach the ground." },
    { id: "cape", label: "CAPE", k: "cape", unit: "J/kg", zero: true, thr: [1000], sub: "Model CAPE as Open-Meteo reports it." },
    { id: "cin", label: "CIN", k: "cin", unit: "J/kg", zero: true, sub: "Convective inhibition (the cap). The sign convention depends on the model; larger values mean a stronger cap." },
  ];
  const KEYS = ["cape", "cin", "bs1", "bs6", "srh1", "srh3", "lr75", "lr03", "lcl", "frz", "stp", "scp", "mw6", "thunder"];

  let data = null, chart = null, tab = O.store.get("ops_severe_tab", "scp");
  const picker = O.modelPicker($("models"), "ops_severe_models", MODELS, render);
  $("resetW").addEventListener("click", () => picker.reset());
  O.locationCard($("locCard"), () => run());
  $("runBtn").addEventListener("click", () => run());
  $("days").value = String(O.store.get("ops_severe_days", 3));
  $("days").addEventListener("change", () => { O.store.set("ops_severe_days", +$("days").value); run(); });
  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label; b.setAttribute("aria-selected", t.id === tab);
    b.addEventListener("click", () => { tab = t.id; O.store.set("ops_severe_tab", tab); document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === b)); renderChart(); });
    $("tabs").appendChild(b);
  });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });
  $("hModel").addEventListener("change", drawHodo);
  $("hHour").addEventListener("input", drawHodo);
  $("hPeak").addEventListener("click", () => { if (data) { $("hHour").value = peakIndex(); drawHodo(); } });

  /* ===================== sounding math ===================== */
  const uv = (s, d) => ({ u: -s * Math.sin((d * Math.PI) / 180), v: -s * Math.cos((d * Math.PI) / 180) });
  const mag = (a) => Math.hypot(a.u, a.v);
  const fromDir = (a) => ((Math.atan2(-a.u, -a.v) * 180) / Math.PI + 360) % 360;

  /* Points sorted by height above ground: 10 m wind + 2 m temperature, then every usable pressure level. */
  function sounding(a, i, elev) {
    const s10 = a.wind_speed_10m[i], d10 = a.wind_direction_10m[i];
    if (s10 == null || d10 == null) return null;
    const pts = [{ h: 10, ...uv(s10, d10), t: a.temperature_2m[i], p: null }];
    for (const p of LEVELS) {
      const z = a[`geopotential_height_${p}hPa`] && a[`geopotential_height_${p}hPa`][i];
      if (z == null) continue;
      const h = z - elev;
      if (h <= 30) continue; // level is below ground here
      const s = a[`wind_speed_${p}hPa`] && a[`wind_speed_${p}hPa`][i], d = a[`wind_direction_${p}hPa`] && a[`wind_direction_${p}hPa`][i];
      const w = s != null && d != null ? uv(s, d) : { u: null, v: null };
      pts.push({ h, u: w.u, v: w.v, t: a[`temperature_${p}hPa`] ? a[`temperature_${p}hPa`][i] : null, p });
    }
    pts.sort((x, y) => x.h - y.h);
    return pts;
  }
  /* Linear interpolation of a field to height h (m AGL). Null above the highest point that has the field. */
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
  /* Bunkers internal-dynamics method (non-pressure-weighted 0–6 km mean wind). */
  function bunkers(pts) {
    const mean = layerMean(pts, 0, 6000), lo = layerMean(pts, 0, 500), hi = layerMean(pts, 5500, 6000);
    if (!mean || !lo || !hi) return null;
    const s = { u: hi.u - lo.u, v: hi.v - lo.v }, m = mag(s);
    if (m < 1e-6) return { rm: mean, lm: mean, mean };
    const k = BUNKERS_KT / m;
    return { rm: { u: mean.u + k * s.v, v: mean.v - k * s.u }, lm: { u: mean.u - k * s.v, v: mean.v + k * s.u }, mean };
  }
  /* Storm-relative helicity, 0–top m, in m²/s². Winds and storm motion in knots. */
  function srh(pts, top, sm) {
    let tot = 0, prev = windAt(pts, 0);
    if (!prev) return null;
    for (let h = 100; h <= top; h += 100) {
      const w = windAt(pts, h); if (!w) return null;
      tot += ((w.u - sm.u) * (prev.v - sm.v) - (prev.u - sm.u) * (w.v - sm.v)) * MS * MS;
      prev = w;
    }
    return tot;
  }
  const bulk = (pts, h) => { const a = windAt(pts, 0), b = windAt(pts, h); return a && b ? Math.hypot(b.u - a.u, b.v - a.v) : null; };

  function stpOf(cape, lcl, srh1, bs6kt) {
    if ([cape, lcl, srh1, bs6kt].some((x) => x == null)) return null;
    const lclT = lcl < 1000 ? 1 : lcl > 2000 ? 0 : (2000 - lcl) / 1000;
    const b = bs6kt * MS, shT = b < 12.5 ? 0 : b > 30 ? 1.5 : b / 20;
    return Math.max(0, (cape / 1500) * lclT * (srh1 / 150) * shT);
  }
  function scpOf(cape, srh3, bs6kt) {
    if ([cape, srh3, bs6kt].some((x) => x == null)) return null;
    const b = bs6kt * MS, shT = b < 10 ? 0 : b > 20 ? 1 : b / 20;
    return Math.max(0, (cape / 1000) * (srh3 / 50) * shT);
  }

  /* Every index for one model at one hour. */
  function indices(a, i, elev) {
    const pts = sounding(a, i, elev);
    const cape = a.cape[i], cin = a.convective_inhibition[i];
    const T = a.temperature_2m[i], Td = a.dew_point_2m[i];
    const lcl = T != null && Td != null ? Math.max(0, 125 * (T - Td)) : null;
    const code = a.weather_code[i];
    const out = { cape, cin, lcl, thunder: code == null ? null : code >= 95 && code <= 99 ? 1 : 0 };
    if (!pts) return out;
    const bk = bunkers(pts);
    out.bs1 = bulk(pts, 1000); out.bs6 = bulk(pts, 6000);
    out.mw6 = bk ? mag(bk.mean) : null;
    out.srh1 = bk ? srh(pts, 1000, bk.rm) : null;
    out.srh3 = bk ? srh(pts, 3000, bk.rm) : null;
    const p7 = pts.find((p) => p.p === 700), p5 = pts.find((p) => p.p === 500);
    out.lr75 = p7 && p5 && p7.t != null && p5.t != null ? (p7.t - p5.t) / ((p5.h - p7.h) / 1000) : null;
    const t3 = at(pts, "t", 3000);
    out.lr03 = T != null && t3 != null ? (T - t3) / 3 : null;
    let frz = a.freezing_level_height[i];
    if (frz == null) { // fall back to the profile's first 0 °C crossing
      for (let k = 0; k < pts.length - 1; k++) {
        const x = pts[k], y = pts[k + 1];
        if (x.t != null && y.t != null && x.t >= 0 && y.t < 0) { frz = x.h + ((y.h - x.h) * x.t) / (x.t - y.t) + elev; break; }
      }
    }
    out.frz = frz == null ? null : frz * 3.28084;
    out.stp = stpOf(cape, lcl, out.srh1, out.bs6);
    out.scp = scpOf(cape, out.srh3, out.bs6);
    return out;
  }

  function tierOf(x) {
    if (!x || x.cape == null) return "nodata";
    const c = x.cape, b6 = x.bs6 == null ? 0 : x.bs6;
    if (c < 100) return "normal";
    if ((x.stp || 0) >= 1 || (x.scp || 0) >= 4) return "action";
    if ((x.scp || 0) >= 1 || (c >= 1000 && b6 >= 40)) return "prepare";
    if (c >= 500 && b6 >= 25) return "monitor";
    return "normal";
  }
  function flags(x) {
    const f = [], c = x.cape || 0;
    if (c >= 1000 && (x.lr75 || 0) >= 7 && (x.bs6 || 0) >= 30) f.push("HAIL");
    if (c >= 500 && ((x.lr03 || 0) >= 8 || (x.mw6 || 0) >= 35)) f.push("WIND");
    if (c >= 250 && (x.srh1 || 0) >= 100 && x.lcl != null && x.lcl <= 1250 && (x.bs6 || 0) >= 30) f.push("TOR");
    return f;
  }

  /* ===================== fetch ===================== */
  async function run() {
    $("runBtn").disabled = true; O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${MODELS.length} model soundings…`;
    const params = { forecast_days: $("days").value, temperature_unit: "celsius", wind_speed_unit: "kn", precipitation_unit: "inch" };
    const res = await Promise.allSettled(MODELS.map((m) => O.fetchModel("https://api.open-meteo.com/v1/forecast", params, m.id, HOURLY)));
    $("runBtn").disabled = false;
    let master = null; const ok = [], empty = [], failed = [];
    res.forEach((r, i) => {
      const m = MODELS[i];
      if (r.status !== "fulfilled") { failed.push(m.name); picker.setStatus(m.id, "none"); return; }
      const h = O.pick(r.value.hourly, HOURLY);
      if (!O.hasData(h.cape) && !O.hasData(h.wind_speed_500hPa)) { empty.push(m.name); picker.setStatus(m.id, "none"); return; }
      picker.setStatus(m.id, "ok");
      if (!master || r.value.hourly.time.length > master.hourly.time.length) master = r.value;
      ok.push({ m, j: r.value, h });
    });
    picker.redraw();
    if (!ok.length) {
      data = null; O.setChip("NO DATA", "err"); O.headline({ tier: "nodata" });
      $("runMsg").className = "msg err"; $("runMsg").textContent = "Couldn't reach Open-Meteo. Check your connection and try again.";
      render(); return;
    }
    const times = master.hourly.time;
    data = { times, tz: master.timezone, models: {} };
    const thin = [];
    ok.forEach(({ m, j, h }) => {
      const a = {}; HOURLY.forEach((v) => (a[v] = O.align(times, j.hourly.time, h[v])));
      const elev = j.elevation || 0;
      const idx = times.map((_, i) => indices(a, i, elev));
      const series = {}; KEYS.forEach((k) => (series[k] = idx.map((x) => (x[k] == null || !isFinite(x[k]) ? null : x[k]))));
      if (!O.hasData(series.srh1)) thin.push(m.name);
      data.models[m.id] = { a, elev, series };
    });
    O.setChip("LIVE · OPEN-METEO", "live");
    $("runMsg").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${ok.length} models` +
      (thin.length ? ` · no upper-air winds: ${thin.join(", ")}` : "") + (empty.length ? ` · no coverage here: ${empty.join(", ")}` : "") +
      (failed.length ? ` · failed: ${failed.join(", ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    $("hHour").max = times.length - 1;
    $("hHour").value = peakIndex();
    render();
  }

  /* ===================== blend + render ===================== */
  const activeModels = () => (data ? MODELS.filter((m) => data.models[m.id] && picker.on(m.id)) : []);
  const activeFor = (k) => activeModels().filter((m) => O.hasData(data.models[m.id].series[k]));
  function blendKey(k) { const ms = activeFor(k); return O.blendSeries(ms.map((m) => ({ w: picker.w(m.id), data: data.models[m.id].series[k] })), data.times.length); }
  function blended() {
    const B = {}; KEYS.forEach((k) => (B[k] = blendKey(k)));
    return data.times.map((_, i) => { const x = {}; KEYS.forEach((k) => (x[k] = B[k].mean[i])); x.capeMax = B.cape.max[i]; return x; });
  }
  function peakIndex() {
    const B = blendKey("scp").mean, now = Math.max(0, O.nowIndex(data.times, data.tz));
    let best = now, bv = -1;
    B.forEach((v, i) => { if (i >= now && v != null && v > bv) { bv = v; best = i; } });
    return best;
  }

  function render() {
    if (!data) {
      $("strip").innerHTML = '<p class="msg">No forecast loaded yet.</p>';
      $("daily").innerHTML = ""; $("hodo").innerHTML = ""; $("hTiles").innerHTML = "";
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    const bl = blended(), tiers = bl.map(tierOf);
    const rows = [{ name: "BLEND", color: O.css("--text"), tiers, bold: true }]
      .concat(activeModels().map((m) => ({ name: m.name, color: O.modelColor(MODELS.indexOf(m)), tiers: data.times.map((_, i) => { const s = data.models[m.id].series, x = {}; KEYS.forEach((k) => (x[k] = s[k][i])); return tierOf(x); }) })));
    $("strip").innerHTML = O.tierStrip(data.times, rows, 1);

    /* headline */
    const now = Math.max(0, O.nowIndex(data.times, data.tz)), end = Math.min(data.times.length, now + 24);
    const win = tiers.slice(now, end), worst = O.maxTier(win), first = win.findIndex((t) => t === worst);
    const mx = (k, s, e) => { const v = bl.slice(s, e).map((x) => x[k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    O.headline({
      tier: worst, word: worst === "nodata" ? "NO DATA" : O.TIER[worst].word,
      stats: [
        { num: worst === "nodata" || worst === "normal" ? "—" : O.fmtWhen(data.times[now + first]), unit: worst === "normal" ? "no signal next 24 h" : "first, next 24 h" },
        { num: fmt(mx("scp", now, end), 1), unit: "peak SCP" },
        { num: fmt(mx("stp", now, end), 1), unit: "peak STP" },
      ],
    });

    /* daily table */
    const days = [];
    data.times.forEach((t, i) => { const k = O.dayOf(t); if (!days.length || days[days.length - 1].k !== k) days.push({ k, idx: [] }); days[days.length - 1].idx.push(i); });
    const dmax = (k, idx) => { const v = idx.map((i) => bl[i][k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const dmin = (k, idx) => { const v = idx.map((i) => bl[i][k]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>Signal</th><th>Storms in models</th><th>CAPE</th><th>0–6 km shear</th><th>0–1 km SRH</th><th>0–3 km SRH</th><th>SCP</th><th>STP</th><th>700–500 LR</th><th>Min LCL</th><th>Flags</th></tr></thead><tbody>` +
      days.filter((d) => d.idx.length >= 6).map((d) => {
        const t = O.maxTier(d.idx.map((i) => tiers[i]));
        const fl = new Set(); d.idx.forEach((i) => flags(bl[i]).forEach((f) => fl.add(f)));
        const th = dmax("thunder", d.idx);
        /* LCL only matters when there is instability: use hours with CAPE >= 250 when any exist */
        const unstable = d.idx.filter((i) => (bl[i].cape || 0) >= 250);
        return `<tr><td class="display" style="font-size:12px">${O.fmtDay(d.k)}</td><td><span class="badge" style="--b:${O.TIER[t].color}">${O.TIER[t].word}</span></td>` +
          `<td class="num">${th == null ? "—" : Math.round(th * 100) + "%"}</td><td class="num">${fmt(dmax("cape", d.idx), 0)}</td><td class="num">${fmt(dmax("bs6", d.idx), 0, " kt")}</td>` +
          `<td class="num">${fmt(dmax("srh1", d.idx), 0)}</td><td class="num">${fmt(dmax("srh3", d.idx), 0)}</td><td class="num">${fmt(dmax("scp", d.idx), 1)}</td><td class="num">${fmt(dmax("stp", d.idx), 1)}</td>` +
          `<td class="num">${fmt(dmax("lr75", d.idx), 1)}</td><td class="num">${fmt(dmin("lcl", unstable.length ? unstable : d.idx), 0, " m")}</td>` +
          `<td style="white-space:normal;min-width:110px;text-align:left">${fl.size ? [...fl].map((f) => `<span class="flag">${f}</span>`).join("") : '<span class="msg">—</span>'}</td></tr>`;
      }).join("") + "</tbody>";

    /* hodograph model list */
    const sel = $("hModel"), cur = sel.value || "blend";
    sel.innerHTML = `<option value="blend">Blend (weighted mean profile)</option>` + activeModels().map((m) => `<option value="${m.id}">${O.esc(m.name)}</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "blend";
    drawHodo();
    renderChart();
  }
  const fmt = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);

  /* ===================== hodograph ===================== */
  function profileFor(id, i) {
    const one = (m) => { const d = data.models[m]; return sounding(d.a, i, d.elev); };
    if (id !== "blend") return one(id);
    const ms = activeModels(); if (!ms.length) return null;
    /* weighted mean wind on a fixed height grid, so different models' levels line up */
    const pts = [];
    for (let h = 0; h <= 9000; h += 250) {
      let u = 0, v = 0, t = 0, w = 0, wt = 0, tt = 0;
      ms.forEach((m) => { const p = one(m.id); if (!p) return; const x = windAt(p, h), y = at(p, "t", h), ww = picker.w(m.id);
        if (x) { u += ww * x.u; v += ww * x.v; w += ww; } if (y != null) { t += ww * y; wt += ww; tt++; } });
      pts.push({ h: h || 10, u: w ? u / w : null, v: w ? v / w : null, t: wt ? t / wt : null });
    }
    return pts;
  }

  function drawHodo() {
    if (!data) return;
    const i = +$("hHour").value, id = $("hModel").value || "blend";
    $("hWhen").textContent = `${O.fmtDay(O.dayOf(data.times[i]))} ${O.fmtHour(O.hourOf(data.times[i]))} ${O.tzShort(data.tz)}`;
    const pts = profileFor(id, i);
    const trace = []; if (pts) for (let h = 0; h <= 9000; h += 250) { const w = windAt(pts, h); if (w) trace.push({ h, ...w }); }
    const bk = pts ? bunkers(pts) : null;
    const S = 420, c = S / 2;
    const maxKt = Math.min(120, Math.max(40, Math.ceil((Math.max(0, ...trace.map(mag), ...(bk ? [mag(bk.rm), mag(bk.lm)] : [])) + 5) / 10) * 10));
    const sc = (c - 18) / maxKt, X = (u) => c + u * sc, Y = (v) => c - v * sc;
    const col = { line: O.css("--line"), muted: O.css("--muted"), faint: O.css("--faint"), text: O.css("--text"), mono: O.css("--font-mono") };
    let svg = `<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg" font-family="${col.mono}">`;
    for (let r = 10; r <= maxKt; r += 10) svg += `<circle cx="${c}" cy="${c}" r="${r * sc}" fill="none" stroke="${col.line}" stroke-width="${r % 20 === 0 ? 1 : 0.6}"/>` +
      (r % 20 === 0 ? `<text x="${c + r * sc * 0.707 + 2}" y="${c - r * sc * 0.707 - 2}" font-size="9" fill="${col.faint}">${r}</text>` : "");
    svg += `<line x1="${c}" y1="8" x2="${c}" y2="${S - 8}" stroke="${col.line}"/><line x1="8" y1="${c}" x2="${S - 8}" y2="${c}" stroke="${col.line}"/>`;
    if (!trace.length) svg += `<text x="${c}" y="${c - 12}" text-anchor="middle" font-size="12" fill="${col.muted}">No upper-air winds for this model/hour</text>`;
    const layers = [[0, 1000, "--h01"], [1000, 3000, "--h13"], [3000, 6000, "--h36"], [6000, 9000, "--h69"]];
    layers.forEach(([a, b, v]) => {
      const seg = trace.filter((p) => p.h >= a && p.h <= b);
      if (seg.length > 1) svg += `<polyline points="${seg.map((p) => `${X(p.u).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="${O.css(v)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    [1000, 3000, 6000, 9000].forEach((h) => { const p = trace.find((q) => q.h === h); if (p) svg += `<circle cx="${X(p.u)}" cy="${Y(p.v)}" r="2.5" fill="${col.text}"/><text x="${X(p.u) + 5}" y="${Y(p.v) - 4}" font-size="10" fill="${col.text}">${h / 1000}</text>`; });
    if (bk) {
      svg += `<rect x="${X(bk.mean.u) - 3.5}" y="${Y(bk.mean.v) - 3.5}" width="7" height="7" fill="${col.muted}"/>`;
      [["RM", bk.rm], ["LM", bk.lm]].forEach(([l, p]) => (svg += `<circle cx="${X(p.u)}" cy="${Y(p.v)}" r="4.5" fill="none" stroke="${col.text}" stroke-width="1.75"/><text x="${X(p.u) + 7}" y="${Y(p.v) + 4}" font-size="10" font-weight="700" fill="${col.text}">${l}</text>`));
    }
    svg += `<text x="12" y="20" font-size="10" fill="${col.muted}">kt</text></svg>`;
    $("hodo").innerHTML = svg;

    /* readout tiles for this profile and hour */
    let x;
    if (id === "blend") { const b = blended()[i]; x = b; } else { const s = data.models[id].series; x = {}; KEYS.forEach((k) => (x[k] = s[k][i])); }
    const rmTxt = bk ? `${String(Math.round(fromDir(bk.rm) / 5) * 5).padStart(3, "0")}°/${Math.round(mag(bk.rm))} kt` : "—";
    const fl = x ? flags(x) : [];
    $("hTiles").innerHTML = [
      ["Environment", x ? O.TIER[tierOf(x)].word : "—", fl.length ? fl.join(" · ") : "no ingredient flags"],
      ["SCP / STP", `${fmt(x && x.scp, 1)} / ${fmt(x && x.stp, 1)}`, "fixed-layer"],
      ["CAPE", fmt(x && x.cape, 0), "J/kg"],
      ["0–1 / 0–3 km SRH", `${fmt(x && x.srh1, 0)} / ${fmt(x && x.srh3, 0)}`, "m²/s², right-mover"],
      ["0–1 / 0–6 km shear", `${fmt(x && x.bs1, 0)} / ${fmt(x && x.bs6, 0)}`, "kt"],
      ["Bunkers RM", rmTxt, "storm motion (from)"],
      ["LCL", fmt(x && x.lcl, 0, " m"), "above ground"],
      ["700–500 lapse", fmt(x && x.lr75, 1), "°C/km"],
    ].map(([k, v, s]) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join("");
  }

  /* ===================== chart ===================== */
  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    $("chartTitle").textContent = t.label; $("chartSub").textContent = t.sub;
    const ms = activeFor(t.k), B = blendKey(t.k), labels = O.hourLabels(data.times), hours = data.times.map(O.hourOf), fg = O.css("--text");
    const ds = [];
    if (ms.length > 1) {
      ds.push({ label: "min", data: B.min, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true, hideTip: true, order: 5 });
      ds.push({ label: "spread", data: B.max, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), spanGaps: true, hideTip: true, order: 5 });
    }
    ms.forEach((m) => ds.push({ label: m.name, data: data.models[m.id].series[t.k], borderColor: O.modelColor(MODELS.indexOf(m)), borderWidth: 1.25, pointRadius: 0, tension: 0.2, spanGaps: true, order: 3 }));
    if (ms.length > 1) ds.push({ label: "BLEND", data: B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.2, spanGaps: true, order: 1 });
    (t.thr || []).forEach((v) => ds.push({ label: `${v}`, data: data.times.map(() => v), borderColor: O.css("--prepare"), borderWidth: 1.25, borderDash: [5, 4], pointRadius: 0, hideTip: true, order: 2 }));
    const base = O.chartBase({ labels, hours, nowIdx: O.nowIndex(data.times, data.tz), unit: t.unit, dec: t.dec || 0, yTitle: t.unit || t.label, beginAtZero: t.zero });
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    $("legend").innerHTML = ms.map((m) => `<span><i class="sw" style="background:${O.modelColor(MODELS.indexOf(m))}"></i>${O.esc(m.name)}</span>`).join("") +
      (ms.length > 1 ? `<span><i class="sw" style="background:${fg};height:4px"></i>Weighted blend</span><span><i class="sw" style="background:var(--band);height:10px"></i>Model spread</span>` : "") +
      (t.thr ? `<span><i class="sw" style="background:var(--prepare)"></i>Reference: ${t.thr.join(", ")}</span>` : "") +
      (!ms.length ? "<span>None of the checked models carry this field here.</span>" : "");
  }

  render();
  run();
})();
