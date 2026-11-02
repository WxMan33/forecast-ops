/* Thunder: hour-by-hour model thunder signal on the Heads-Up color scale. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core;
  O.shell("thunder", "Thunder");

  const MODELS = [
    { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1.25 },
    { id: "ncep_nam_conus", name: "NAM 3 km", w: 1 },
    { id: "gfs_seamless", name: "GFS", w: 1 },
    { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
    { id: "icon_seamless", name: "ICON", w: 1 },
    { id: "gem_seamless", name: "GEM", w: 0.75 },
  ];
  const HOURLY = ["cape", "lifted_index", "convective_inhibition", "precipitation_probability", "precipitation", "weather_code",
    "wind_speed_10m", "wind_direction_10m", "wind_speed_500hPa", "wind_direction_500hPa", "lightning_potential"];
  const TABS = [
    { id: "cape", label: "CAPE", v: "cape", unit: "J/kg", zero: true, sub: "Convective available potential energy. Above about 1000 J/kg is enough for robust storms if something sets them off." },
    { id: "li", label: "Lifted index", v: "lifted_index", unit: "°C", dec: 0, sub: "Negative means unstable. −3 to −6 is moderately unstable, below −6 strongly unstable." },
    { id: "cin", label: "CIN", v: "convective_inhibition", unit: "J/kg", zero: true, sub: "The cap. Larger values hold storms back until it erodes or is broken." },
    { id: "shear", label: "Deep-layer shear", v: "shear", unit: "kt", zero: true, sub: "Vector wind difference, 10 m to 500 hPa, as a stand-in for 0–6 km shear. About 30 kt or more favors organized storms. SEVERE has the full profile." },
    { id: "pop", label: "Precip chance", v: "precipitation_probability", unit: "%", min: 0, max: 100, sub: "Model precipitation probability, where the model provides it." },
    { id: "ltg", label: "Lightning potential", v: "lightning_potential", unit: "J/kg", zero: true, sub: "ICON's lightning potential index. Only ICON carries it, so other models show nothing here." },
  ];
  const CODE = (c) => (c == null ? "—" : c >= 95 ? "THUNDER" : c >= 71 && c <= 86 && !(c >= 80 && c <= 82) ? "SNOW" : c >= 51 ? "RAIN" : c === 45 || c === 48 ? "FOG" : "DRY");

  let data = null, chart = null, sel = null, fresh = false, prevSnap = null, tab = O.store.get("ops_thunder_tab", "cape");
  const picker = O.modelPicker($("models"), "ops_thunder_models", MODELS, render);
  const showLines = O.linesToggle($("linesBtn"), "ops_thunder_lines", () => renderChart());
  O.locationCard($("locCard"), () => run());
  $("runBtn").addEventListener("click", () => run());
  $("days").value = String(O.store.get("ops_thunder_days", 3));
  $("days").addEventListener("change", () => { O.store.set("ops_thunder_days", +$("days").value); run(); });
  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label; b.setAttribute("aria-selected", t.id === tab);
    b.addEventListener("click", () => { tab = t.id; O.store.set("ops_thunder_tab", tab); document.querySelectorAll("#tabs .tab").forEach((x) => x.setAttribute("aria-selected", x === b)); renderChart(); });
    $("tabs").appendChild(b);
  });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });

  /* 10 m to 500 hPa vector difference, mph in, knots out. Directions are "from". */
  function shear(s1, d1, s2, d2) {
    if ([s1, d1, s2, d2].some((x) => x == null)) return null;
    const a = C.severe.uv(s1, d1), b = C.severe.uv(s2, d2);
    return Math.hypot(b.u - a.u, b.v - a.v) * 0.868976;
  }

  async function run() {
    $("runBtn").disabled = true; O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${MODELS.length} models…`;
    const params = { forecast_days: $("days").value, temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" };
    const res = await Promise.allSettled(MODELS.map((m) => O.fetchModel("https://api.open-meteo.com/v1/forecast", params, m.id,
      m.id === "icon_seamless" ? HOURLY : HOURLY.filter((v) => v !== "lightning_potential"))));
    $("runBtn").disabled = false;
    let master = null; const ok = [], empty = [], failed = [], partial = [];
    res.forEach((r, i) => {
      const m = MODELS[i];
      if (r.status !== "fulfilled") { failed.push(m.name); picker.setStatus(m.id, "none"); return; }
      const h = O.pick(r.value.hourly, HOURLY);
      if (!O.hasData(h.cape) && !O.hasData(h.weather_code)) { empty.push(m.name); picker.setStatus(m.id, "none"); return; }
      if (!O.hasData(h.weather_code) || !O.hasData(h.cape)) partial.push(`${m.name}: no ${O.hasData(h.cape) ? "weather codes" : "CAPE"}`);
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
    ok.forEach(({ m, j, h }) => {
      const a = {}; HOURLY.forEach((v) => (a[v] = O.align(times, j.hourly.time, h[v])));
      a.shear = times.map((_, i) => shear(a.wind_speed_10m[i], a.wind_direction_10m[i], a.wind_speed_500hPa[i], a.wind_direction_500hPa[i]));
      data.models[m.id] = a;
    });
    O.dataStatus([...failed.map((n) => `${n}: request failed`), ...empty.map((n) => `${n}: no coverage here`), ...partial]);
    $("runMsg").textContent = `${ok.length} models loaded` + (empty.length ? ` · no coverage here: ${empty.join(", ")}` : "") +
      (failed.length ? ` · failed: ${failed.join(", ")}` : "") + (partial.length ? ` · ${partial.join(", ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    sel = null; fresh = true;
    render();
  }

  const active = (v) => (data ? MODELS.filter((m) => data.models[m.id] && picker.on(m.id) && O.hasData(data.models[m.id][v])) : []);
  const blend = (v) => { const ms = active(v); return O.blendSeries(ms.map((m) => ({ w: picker.w(m.id), data: data.models[m.id][v] })), data.times.length); };

  function compute() {
    const n = data.times.length, wm = active("weather_code");
    const cape = blend("cape"), pop = blend("precipitation_probability"), li = blend("lifted_index"), sh = blend("shear");
    const frac = [];
    for (let i = 0; i < n; i++) frac.push(C.stats.weightedShare(wm.map((m) => data.models[m.id].weather_code[i]), wm.map((m) => picker.w(m.id)), C.thunder.isThunderCode));
    const tiers = frac.map((f, i) => C.thunder.tier(f, cape.mean[i], pop.mean[i]));
    const perModel = MODELS.filter((m) => data.models[m.id] && picker.on(m.id)).map((m) => {
      const a = data.models[m.id];
      return { m, tiers: a.cape.map((c, i) => C.thunder.tier(a.weather_code[i] == null ? null : C.thunder.isThunderCode(a.weather_code[i]) ? 1 : 0, c, a.precipitation_probability[i])) };
    });
    return { frac, tiers, perModel, cape, pop, li, sh };
  }
  const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);

  function render() {
    if (!data) {
      $("strip").innerHTML = '<p class="msg">No forecast loaded yet.</p>';
      $("daily").innerHTML = ""; $("detail").innerHTML = "";
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    const Cx = compute(); data.C = Cx;
    const now = Math.max(0, O.nowIndex(data.times, data.tz)), end = Math.min(data.times.length, now + 24);
    const next = Cx.tiers.slice(now, end), worst = O.maxTier(next), firstIdx = next.findIndex((t) => t === worst);
    if (sel == null) sel = O.TIER[worst].rank >= 1 ? now + firstIdx : now;
    drawStrip(Cx);

    const capeWin = Cx.cape.max.slice(now, end).filter((x) => x != null), peak = capeWin.length ? Math.max(...capeWin) : null;
    const frWin = Cx.frac.slice(now, end).filter((x) => x != null), frMax = frWin.length ? Math.max(...frWin) : null;
    O.headline({
      tier: worst, note: "Model thunder signal · next 24 h",
      stats: [
        { num: O.TIER[worst].rank >= 1 ? O.fmtWhen(data.times[now + firstIdx]) : "—", unit: O.TIER[worst].rank >= 1 ? "first" : "no signal" },
        { num: frMax == null ? "—" : Math.round(frMax * 100) + "%", unit: "max model thunder share" },
        { num: peak == null ? "—" : Math.round(peak).toLocaleString(), unit: "J/kg peak CAPE (any model)" },
      ],
    });

    /* daily table */
    const mx = (arr, idx) => { const v = idx.map((i) => arr[i]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const mn = (arr, idx) => { const v = idx.map((i) => arr[i]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
    const dayRows = O.dayGroups(data.times).filter((d) => d.idx.length >= 6).map((d) => {
      const t = O.maxTier(d.idx.map((i) => Cx.tiers[i]));
      const hot = d.idx.filter((i) => O.TIER[Cx.tiers[i]].rank >= 2);
      return { d, t, hot, fr: mx(Cx.frac, d.idx), capeB: mx(Cx.cape.mean, d.idx), capeX: mx(Cx.cape.max, d.idx), li: mn(Cx.li.mean, d.idx), sh: mx(Cx.sh.mean, d.idx) };
    });
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>Signal</th><th>Elevated+ hours</th><th>Window</th><th>Blend CAPE max</th><th>Any-model CAPE max</th><th>Min LI</th><th>Max shear</th><th>Thunder share max</th></tr></thead><tbody>` +
      dayRows.map((r) => {
        const win = r.hot.length ? `${O.fmtHour(O.hourOf(data.times[r.hot[0]]))}–${O.fmtHour((O.hourOf(data.times[r.hot[r.hot.length - 1]]) + 1) % 24)}` : "—";
        return `<tr><td class="display" style="font-size:12px">${O.fmtDay(r.d.k)}</td><td>${O.badge(r.t)}</td>` +
          `<td class="num">${r.hot.length}</td><td class="num">${win}</td><td class="num">${f(r.capeB, 0)}</td><td class="num">${f(r.capeX, 0)}</td>` +
          `<td class="num">${f(r.li, 1)}</td><td class="num">${f(r.sh, 0, " kt")}</td><td class="num">${r.fr == null ? "—" : Math.round(r.fr * 100) + "%"}</td></tr>`;
      }).join("") + "</tbody>";

    if (fresh) {
      const snap = {}; dayRows.forEach((r) => (snap[r.d.k] = { label: O.fmtDay(r.d.k), t: r.t, fr: r.fr == null ? null : r.fr * 100, cape: r.capeX }));
      prevSnap = O.trackChanges("thunder", snap); data.snap = snap; fresh = false;
    }
    if (data.snap) O.renderChanges($("changes"), prevSnap, data.snap, [
      { k: "t", label: "signal", tier: true },
      { k: "fr", label: "thunder share", min: 20, fmt: (v) => `${Math.round(v)}%` },
      { k: "cape", label: "peak CAPE", min: 500, fmt: (v) => `${Math.round(v)}` },
    ]);
    renderChart();
  }

  function drawStrip(Cx) {
    const rows = [{ name: "BLEND", color: O.css("--text"), tiers: Cx.tiers, bold: true }]
      .concat(Cx.perModel.map((p) => ({ name: p.m.name, color: O.modelColor(MODELS.indexOf(p.m)), tiers: p.tiers })));
    O.tierStrip($("strip"), data.times, rows, { nowIdx: O.nowIndex(data.times, data.tz), sel, onPick: (i) => { sel = i; drawStrip(data.C); renderChart(); $("strip").querySelector(".strip-scroll").focus(); } });
    drawDetail(Cx);
  }

  function drawDetail(Cx) {
    const i = sel, t = Cx.tiers[i];
    const ms = MODELS.filter((m) => data.models[m.id] && picker.on(m.id));
    $("detail").innerHTML = `<div class="detail">
      <div class="detail-head"><span class="when">${O.fmtDay(O.dayOf(data.times[i]))} · ${O.fmtHour(O.hourOf(data.times[i]))} ${O.tzShort(data.tz)}</span>${O.badge(t)}</div>
      <div class="tiles">
        <div class="tile"><span class="k">Thunder share</span><span class="v">${Cx.frac[i] == null ? "—" : Math.round(Cx.frac[i] * 100) + "%"}</span><span class="s">of model weight</span></div>
        <div class="tile"><span class="k">CAPE blend</span><span class="v">${f(Cx.cape.mean[i], 0)}</span><span class="s">range ${f(Cx.cape.min[i], 0)}–${f(Cx.cape.max[i], 0)} J/kg</span></div>
        <div class="tile"><span class="k">Precip chance</span><span class="v">${f(Cx.pop.mean[i], 0, "%")}</span><span class="s">blend</span></div>
        <div class="tile"><span class="k">Lifted index</span><span class="v">${f(Cx.li.mean[i], 1)}</span><span class="s">°C, blend</span></div>
        <div class="tile"><span class="k">Deep shear</span><span class="v">${f(Cx.sh.mean[i], 0, " kt")}</span><span class="s">10 m–500 hPa</span></div>
      </div>
      <div class="tablewrap"><table><thead><tr><th>Model</th><th>Weather</th><th>CAPE</th><th>Precip chance</th><th>Signal</th></tr></thead><tbody>${ms.map((m) => {
        const a = data.models[m.id], c = a.weather_code[i], p = Cx.perModel.find((x) => x.m === m);
        return `<tr><td><span class="sw" style="background:${O.modelColor(MODELS.indexOf(m))};margin-right:6px"></span>${O.esc(m.name)}</td><td class="num"${c >= 95 ? ' style="color:var(--prepare);font-weight:800"' : ""}>${CODE(c)}</td><td class="num">${f(a.cape[i], 0)}</td><td class="num">${f(a.precipitation_probability[i], 0, "%")}</td><td>${O.badge(p.tiers[i])}</td></tr>`;
      }).join("")}</tbody></table></div></div>`;
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    $("chartTitle").textContent = t.label; $("chartSub").textContent = t.sub;
    const ms = active(t.v), B = blend(t.v), labels = O.hourLabels(data.times), hours = data.times.map(O.hourOf), fg = O.css("--text");
    const ds = [];
    if (ms.length > 1) {
      ds.push({ label: "min", data: B.min, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true, hideTip: true, order: 5 });
      ds.push({ label: "spread", data: B.max, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), spanGaps: true, hideTip: true, order: 5 });
    }
    if (showLines() || ms.length === 1) ms.forEach((m) => ds.push(O.modelLine(m.name, data.models[m.id][t.v], O.modelColor(MODELS.indexOf(m)))));
    if (ms.length > 1) ds.push({ label: "BLEND", data: B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 1 });
    const base = O.chartBase({ labels, hours, nowIdx: O.nowIndex(data.times, data.tz), selIdx: sel, unit: t.unit, dec: t.dec || 0, yTitle: t.unit, beginAtZero: t.zero, yMin: t.min, yMax: t.max });
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    $("legend").innerHTML = (showLines() ? ms.map((m) => `<span><i class="sw" style="background:${O.modelColor(MODELS.indexOf(m))}"></i>${O.esc(m.name)}</span>`).join("") : "") +
      (ms.length > 1 ? `<span><i class="sw" style="background:${fg};height:4px"></i>Weighted blend</span><span><i class="sw" style="background:var(--band);height:10px"></i>Model range</span>` : "") +
      (!ms.length ? "<span>None of the checked models carry this field here.</span>" : "") + `<span>Dotted line: selected hour</span>`;
  }

  render();
  run();
})();
