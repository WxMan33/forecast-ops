/* Severe: model severe-weather environment from pressure-level soundings.
   All sounding math is in ops-core.js (OpsCore.severe). */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core, S = C.severe;
  O.shell("severe", "Severe");

  const MODELS = [
    { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1.25 },
    { id: "ncep_nam_conus", name: "NAM 3 km", w: 1 },
    { id: "gfs_seamless", name: "GFS", w: 1 },
    { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
    { id: "icon_seamless", name: "ICON", w: 1 },
    { id: "gem_seamless", name: "GEM", w: 0.75 },
  ];
  const SURF = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "cape", "convective_inhibition",
    "lifted_index", "freezing_level_height", "precipitation_probability", "weather_code"];
  const PL = [];
  S.LEVELS.forEach((p) => ["temperature", "wind_speed", "wind_direction", "geopotential_height"].forEach((v) => PL.push(`${v}_${p}hPa`)));
  const HOURLY = [...SURF, ...PL];

  const TABS = [
    { id: "scp", label: "SCP ≈", k: "scp", unit: "", dec: 1, zero: true, thr: [1, 4], sub: "Supercell composite, fixed-layer estimate: (CAPE/1000) × (0–3 km SRH/50) × (0–6 km shear term). Around 1 means supercells are possible. 4 or more strongly favors them." },
    { id: "stp", label: "STP ≈", k: "stp", unit: "", dec: 1, zero: true, thr: [1], sub: "Significant tornado parameter, fixed-layer estimate: (CAPE/1500) × LCL term × (0–1 km SRH/150) × 0–6 km shear term. 1 or more is where most significant-tornado environments sit." },
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

  let data = null, chart = null, fresh = false, prevSnap = null, tab = O.store.get("ops_severe_tab", "scp");
  const picker = O.modelPicker($("models"), "ops_severe_models", MODELS, render);
  const showLines = O.linesToggle($("linesBtn"), "ops_severe_lines", () => renderChart());
  O.locationCard($("locCard"), () => run());
  $("runBtn").addEventListener("click", () => run());
  $("days").value = String(O.store.get("ops_severe_days", 3));
  $("days").addEventListener("change", () => { O.store.set("ops_severe_days", +$("days").value); run(); });
  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label; b.setAttribute("aria-selected", t.id === tab);
    b.addEventListener("click", () => { tab = t.id; O.store.set("ops_severe_tab", tab); document.querySelectorAll("#tabs .tab").forEach((x) => x.setAttribute("aria-selected", x === b)); renderChart(); });
    $("tabs").appendChild(b);
  });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });
  $("hModel").addEventListener("change", drawHodo);
  $("hHour").addEventListener("input", () => { drawStrip(); drawHodo(); renderChart(); });
  $("hPeak").addEventListener("click", () => { if (data) { $("hHour").value = peakIndex(); drawStrip(); drawHodo(); renderChart(); } });

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
      const idx = times.map((_, i) => S.indices(a, i, elev));
      const series = {}; KEYS.forEach((k) => (series[k] = idx.map((x) => (x[k] == null || !isFinite(x[k]) ? null : x[k]))));
      if (!O.hasData(series.srh1)) thin.push(m.name);
      data.models[m.id] = { a, elev, series };
    });
    O.dataStatus([...failed.map((n) => `${n}: request failed`), ...empty.map((n) => `${n}: no coverage here`),
      ...thin.map((n) => `${n}: no upper-air winds, so no shear, SRH, STP or SCP from it`)]);
    $("runMsg").textContent = `${ok.length} models loaded` + (thin.length ? ` · no upper-air winds: ${thin.join(", ")}` : "") +
      (empty.length ? ` · no coverage here: ${empty.join(", ")}` : "") + (failed.length ? ` · failed: ${failed.join(", ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    $("hHour").max = times.length - 1;
    $("hHour").value = peakIndex();
    fresh = true;
    render();
  }

  /* ===================== blend + render ===================== */
  const activeModels = () => (data ? MODELS.filter((m) => data.models[m.id] && picker.on(m.id)) : []);
  const activeFor = (k) => activeModels().filter((m) => O.hasData(data.models[m.id].series[k]));
  function blendKey(k) { const ms = activeFor(k); return O.blendSeries(ms.map((m) => ({ w: picker.w(m.id), data: data.models[m.id].series[k] })), data.times.length); }
  function blended() {
    const B = {}; KEYS.forEach((k) => (B[k] = blendKey(k)));
    return data.times.map((_, i) => { const x = {}; KEYS.forEach((k) => (x[k] = B[k].mean[i])); x.max = {}; KEYS.forEach((k) => (x.max[k] = B[k].max[i])); return x; });
  }
  const modelAt = (id, i) => { const s = data.models[id].series, x = {}; KEYS.forEach((k) => (x[k] = s[k][i])); return x; };
  function peakIndex() {
    const B = blendKey("scp").mean, now = Math.max(0, O.nowIndex(data.times, data.tz));
    let best = now, bv = -1;
    B.forEach((v, i) => { if (i >= now && v != null && v > bv) { bv = v; best = i; } });
    return best;
  }
  const fmt = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
  const pair = (b, m, d = 0, u = "") => (b == null && m == null ? "—" : `${fmt(b, d, u)}${m != null && b != null && m - b >= (d ? 0.5 : 1) ? ` <span class="msg">(${fmt(m, d)})</span>` : ""}`);

  function render() {
    if (!data) {
      $("strip").innerHTML = '<p class="msg">No forecast loaded yet.</p>';
      $("daily").innerHTML = ""; $("hodo").innerHTML = ""; $("hTiles").innerHTML = "";
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    const bl = blended(), tiers = bl.map(S.tier);
    data.bl = bl; data.tiers = tiers;
    drawStrip();

    /* headline */
    const now = Math.max(0, O.nowIndex(data.times, data.tz)), end = Math.min(data.times.length, now + 24);
    const win = tiers.slice(now, end), worst = O.maxTier(win), first = win.findIndex((t) => t === worst);
    const mx = (k, s, e, src = "mean") => { const v = bl.slice(s, e).map((x) => (src === "max" ? x.max[k] : x[k])).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    O.headline({
      tier: worst, note: "Severe environment only · next 24 h",
      stats: [
        { num: O.TIER[worst].rank >= 1 ? O.fmtWhen(data.times[now + first]) : "—", unit: O.TIER[worst].rank >= 1 ? "first" : "no signal" },
        { num: `${fmt(mx("scp", now, end), 1)} / ${fmt(mx("scp", now, end, "max"), 1)}`, unit: "SCP ≈ blend / max model" },
        { num: `${fmt(mx("stp", now, end), 1)} / ${fmt(mx("stp", now, end, "max"), 1)}`, unit: "STP ≈ blend / max model" },
      ],
    });

    /* daily table */
    const dmax = (k, idx, src) => { const v = idx.map((i) => (src ? bl[i].max[k] : bl[i][k])).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const dmin = (k, idx) => { const v = idx.map((i) => bl[i][k]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
    const rows = O.dayGroups(data.times).filter((d) => d.idx.length >= 6).map((d) => {
      const fl = new Set(); d.idx.forEach((i) => S.flags(bl[i]).forEach((f) => fl.add(f)));
      /* also flag when any single model meets a flag on its own */
      const mfl = new Set(); activeModels().forEach((m) => d.idx.forEach((i) => S.flags(modelAt(m.id, i)).forEach((f) => { if (!fl.has(f)) mfl.add(f); })));
      const unstable = d.idx.filter((i) => (bl[i].cape || 0) >= 250);
      return { d, t: O.maxTier(d.idx.map((i) => tiers[i])), fl, mfl, th: dmax("thunder", d.idx), cape: [dmax("cape", d.idx), dmax("cape", d.idx, 1)], bs6: [dmax("bs6", d.idx), dmax("bs6", d.idx, 1)],
        srh1: [dmax("srh1", d.idx), dmax("srh1", d.idx, 1)], srh3: [dmax("srh3", d.idx), dmax("srh3", d.idx, 1)], scp: [dmax("scp", d.idx), dmax("scp", d.idx, 1)], stp: [dmax("stp", d.idx), dmax("stp", d.idx, 1)],
        lr75: dmax("lr75", d.idx), lcl: dmin("lcl", unstable.length ? unstable : d.idx) };
    });
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>Signal</th><th>Storms in models</th><th>CAPE</th><th>0–6 km shear</th><th>0–1 km SRH</th><th>0–3 km SRH</th><th>SCP ≈</th><th>STP ≈</th><th>700–500 LR</th><th>Min LCL</th><th>Flags</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td class="display" style="font-size:12px">${O.fmtDay(r.d.k)}</td><td>${O.badge(r.t)}</td>` +
        `<td class="num">${r.th == null ? "—" : Math.round(r.th * 100) + "%"}</td><td class="num">${pair(...r.cape)}</td><td class="num">${pair(...r.bs6, 0, " kt")}</td>` +
        `<td class="num">${pair(...r.srh1)}</td><td class="num">${pair(...r.srh3)}</td><td class="num">${pair(...r.scp, 1)}</td><td class="num">${pair(...r.stp, 1)}</td>` +
        `<td class="num">${fmt(r.lr75, 1)}</td><td class="num">${fmt(r.lcl, 0, " m")}</td>` +
        `<td style="white-space:normal;min-width:120px;text-align:left">${r.fl.size || r.mfl.size ? [...r.fl].map((f) => `<span class="flag">${f}</span>`).join("") + [...r.mfl].map((f) => `<span class="flag dim" title="Met by at least one model, not by the blend">${f}?</span>`).join("") : '<span class="msg">—</span>'}</td></tr>`).join("") + "</tbody>";

    if (fresh) {
      const snap = {}; rows.forEach((r) => (snap[r.d.k] = { label: O.fmtDay(r.d.k), t: r.t, scp: r.scp[0], stp: r.stp[0], bs6: r.bs6[0], cape: r.cape[0] }));
      prevSnap = O.trackChanges("severe", snap); data.snap = snap; fresh = false;
    }
    if (data.snap) O.renderChanges($("changes"), prevSnap, data.snap, [
      { k: "t", label: "signal", tier: true },
      { k: "scp", label: "SCP", min: 1, fmt: (v) => v.toFixed(1) },
      { k: "stp", label: "STP", min: 0.5, fmt: (v) => v.toFixed(1) },
      { k: "bs6", label: "0–6 km shear", min: 10, fmt: (v) => `${Math.round(v)} kt` },
      { k: "cape", label: "CAPE", min: 500, fmt: (v) => `${Math.round(v)}` },
    ]);

    /* hodograph model list */
    const sel = $("hModel"), cur = sel.value || "blend";
    sel.innerHTML = `<option value="blend">Blend (weighted mean profile)</option>` + activeModels().map((m) => `<option value="${m.id}">${O.esc(m.name)}</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "blend";
    drawHodo();
    renderChart();
  }

  function drawStrip() {
    if (!data || !data.tiers) return;
    const rows = [{ name: "BLEND", color: O.css("--text"), tiers: data.tiers, bold: true }]
      .concat(activeModels().map((m) => ({ name: m.name, color: O.modelColor(MODELS.indexOf(m)), tiers: data.times.map((_, i) => S.tier(modelAt(m.id, i))) })));
    O.tierStrip($("strip"), data.times, rows, { nowIdx: O.nowIndex(data.times, data.tz), sel: +$("hHour").value,
      onPick: (i) => { $("hHour").value = i; drawStrip(); drawHodo(); renderChart(); $("strip").querySelector(".strip-scroll").focus(); } });
  }

  /* ===================== hodograph ===================== */
  function profileFor(id, i) {
    const one = (m) => { const d = data.models[m]; return S.sounding(d.a, i, d.elev); };
    if (id !== "blend") return one(id);
    const ms = activeModels(); if (!ms.length) return null;
    /* weighted mean wind on a fixed height grid, so different models' levels line up */
    const pts = [];
    for (let h = 0; h <= 9000; h += 250) {
      let u = 0, v = 0, t = 0, w = 0, wt = 0;
      ms.forEach((m) => { const p = one(m.id); if (!p) return; const x = S.windAt(p, h), y = S.at(p, "t", h), ww = picker.w(m.id);
        if (x) { u += ww * x.u; v += ww * x.v; w += ww; } if (y != null) { t += ww * y; wt += ww; } });
      pts.push({ h: h || 10, u: w ? u / w : null, v: w ? v / w : null, t: wt ? t / wt : null });
    }
    return pts;
  }

  function drawHodo() {
    if (!data) return;
    const i = +$("hHour").value, id = $("hModel").value || "blend";
    $("hWhen").textContent = `${O.fmtDay(O.dayOf(data.times[i]))} ${O.fmtHour(O.hourOf(data.times[i]))} ${O.tzShort(data.tz)}`;
    const pts = profileFor(id, i);
    const trace = []; if (pts) for (let h = 0; h <= 9000; h += 250) { const w = S.windAt(pts, h); if (w) trace.push({ h, ...w }); }
    const bk = pts ? S.bunkers(pts) : null;
    const Z = 420, c = Z / 2;
    const maxKt = Math.min(120, Math.max(40, Math.ceil((Math.max(0, ...trace.map(S.mag), ...(bk ? [S.mag(bk.rm), S.mag(bk.lm)] : [])) + 5) / 10) * 10));
    const sc = (c - 18) / maxKt, X = (u) => c + u * sc, Y = (v) => c - v * sc;
    const col = { line: O.css("--line"), muted: O.css("--muted"), faint: O.css("--faint"), text: O.css("--text"), mono: O.css("--font-mono") };
    let svg = `<svg viewBox="0 0 ${Z} ${Z}" xmlns="http://www.w3.org/2000/svg" font-family="${col.mono}">`;
    for (let r = 10; r <= maxKt; r += 10) svg += `<circle cx="${c}" cy="${c}" r="${r * sc}" fill="none" stroke="${col.line}" stroke-width="${r % 20 === 0 ? 1 : 0.6}"/>` +
      (r % 20 === 0 ? `<text x="${c + r * sc * 0.707 + 2}" y="${c - r * sc * 0.707 - 2}" font-size="10" fill="${col.faint}">${r}</text>` : "");
    svg += `<line x1="${c}" y1="8" x2="${c}" y2="${Z - 8}" stroke="${col.line}"/><line x1="8" y1="${c}" x2="${Z - 8}" y2="${c}" stroke="${col.line}"/>`;
    if (!trace.length) svg += `<text x="${c}" y="${c - 12}" text-anchor="middle" font-size="12" fill="${col.muted}">No upper-air winds for this model/hour</text>`;
    [[0, 1000, "--h01"], [1000, 3000, "--h13"], [3000, 6000, "--h36"], [6000, 9000, "--h69"]].forEach(([a, b, v]) => {
      const seg = trace.filter((p) => p.h >= a && p.h <= b);
      if (seg.length > 1) svg += `<polyline points="${seg.map((p) => `${X(p.u).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="${O.css(v)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    [1000, 3000, 6000, 9000].forEach((h) => { const p = trace.find((q) => q.h === h); if (p) svg += `<circle cx="${X(p.u)}" cy="${Y(p.v)}" r="2.5" fill="${col.text}"/><text x="${X(p.u) + 5}" y="${Y(p.v) - 4}" font-size="11" fill="${col.text}">${h / 1000}</text>`; });
    if (bk) {
      svg += `<rect x="${X(bk.mean.u) - 3.5}" y="${Y(bk.mean.v) - 3.5}" width="7" height="7" fill="${col.muted}"/>`;
      [["RM", bk.rm], ["LM", bk.lm]].forEach(([l, p]) => (svg += `<circle cx="${X(p.u)}" cy="${Y(p.v)}" r="4.5" fill="none" stroke="${col.text}" stroke-width="1.75"/><text x="${X(p.u) + 7}" y="${Y(p.v) + 4}" font-size="11" font-weight="700" fill="${col.text}">${l}</text>`));
    }
    svg += `<text x="12" y="20" font-size="11" fill="${col.muted}">kt</text></svg>`;
    $("hodo").innerHTML = svg;

    const x = id === "blend" ? data.bl[i] : modelAt(id, i), t = S.tier(x);
    const rmTxt = bk ? `${String(Math.round(S.fromDir(bk.rm) / 5) * 5).padStart(3, "0")}°/${Math.round(S.mag(bk.rm))} kt` : "—";
    const fl = S.flags(x);
    $("hTiles").innerHTML = [
      ["Environment", O.badge(t), fl.length ? fl.join(" · ") : "no ingredient flags"],
      ["SCP ≈ / STP ≈", `${fmt(x.scp, 1)} / ${fmt(x.stp, 1)}`, "fixed-layer estimates"],
      ["CAPE", fmt(x.cape, 0), "J/kg"],
      ["0–1 / 0–3 km SRH", `${fmt(x.srh1, 0)} / ${fmt(x.srh3, 0)}`, "m²/s², right-mover"],
      ["0–1 / 0–6 km shear", `${fmt(x.bs1, 0)} / ${fmt(x.bs6, 0)}`, "kt"],
      ["Bunkers RM", rmTxt, "storm motion (from)"],
      ["LCL", fmt(x.lcl, 0, " m"), "above ground"],
      ["700–500 lapse", fmt(x.lr75, 1), "°C/km"],
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
    if (showLines() || ms.length === 1) ms.forEach((m) => ds.push(O.modelLine(m.name, data.models[m.id].series[t.k], O.modelColor(MODELS.indexOf(m)), { tension: 0.2 })));
    if (ms.length > 1) ds.push({ label: "BLEND", data: B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.2, spanGaps: true, order: 1 });
    (t.thr || []).forEach((v) => ds.push({ label: `${v}`, data: data.times.map(() => v), borderColor: O.css("--prepare"), borderWidth: 1.25, borderDash: [5, 4], pointRadius: 0, hideTip: true, order: 2 }));
    const base = O.chartBase({ labels, hours, nowIdx: O.nowIndex(data.times, data.tz), selIdx: +$("hHour").value, unit: t.unit, dec: t.dec || 0, yTitle: t.unit || t.label, beginAtZero: t.zero });
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    $("legend").innerHTML = (showLines() ? ms.map((m) => `<span><i class="sw" style="background:${O.modelColor(MODELS.indexOf(m))}"></i>${O.esc(m.name)}</span>`).join("") : "") +
      (ms.length > 1 ? `<span><i class="sw" style="background:${fg};height:4px"></i>Weighted blend</span><span><i class="sw" style="background:var(--band);height:10px"></i>Model range</span>` : "") +
      (t.thr ? `<span><i class="sw" style="background:var(--prepare)"></i>Reference: ${t.thr.join(", ")}</span>` : "") +
      (!ms.length ? "<span>None of the checked models carry this field here.</span>" : "") + `<span>Dotted line: selected hour</span>`;
  }

  render();
  run();
})();
