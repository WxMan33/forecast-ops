/* Thunder: hour-by-hour model thunder signal using the app's fixed status tiers. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$;
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
    { id: "shear", label: "Deep-layer shear", v: "shear", unit: "kt", zero: true, sub: "Vector wind difference, 10 m to 500 hPa, as a stand-in for 0–6 km shear. About 30 kt or more favors organized storms." },
    { id: "pop", label: "Precip chance", v: "precipitation_probability", unit: "%", min: 0, max: 100, sub: "Model precipitation probability, where the model provides it." },
    { id: "ltg", label: "Lightning potential", v: "lightning_potential", unit: "J/kg", zero: true, sub: "ICON's lightning potential index. Only ICON carries it, so other models show nothing here." },
  ];

  let data = null, chart = null, tab = O.store.get("ops_thunder_tab", "cape");
  const picker = O.modelPicker($("models"), "ops_thunder_models", MODELS, render);
  $("resetW").addEventListener("click", () => picker.reset());
  O.locationCard($("locCard"), () => run());
  $("runBtn").addEventListener("click", () => run());
  $("days").value = String(O.store.get("ops_thunder_days", 3));
  $("days").addEventListener("change", () => { O.store.set("ops_thunder_days", +$("days").value); run(); });
  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label; b.setAttribute("aria-selected", t.id === tab);
    b.addEventListener("click", () => { tab = t.id; O.store.set("ops_thunder_tab", tab); document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === b)); renderChart(); });
    $("tabs").appendChild(b);
  });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });

  /* 10 m to 500 hPa vector difference, mph in, knots out. Directions are "from". */
  function shear(s1, d1, s2, d2) {
    if ([s1, d1, s2, d2].some((x) => x == null)) return null;
    const r = Math.PI / 180, u = (s, d) => -s * Math.sin(d * r), v = (s, d) => -s * Math.cos(d * r);
    return Math.hypot(u(s2, d2) - u(s1, d1), v(s2, d2) - v(s1, d1)) * 0.868976;
  }
  const isThunder = (c) => c != null && c >= 95 && c <= 99;

  /* The tier rule. frac = share of model weight showing a thunder weather code (null if no codes). */
  function tierOf(frac, cape, pop) {
    if (frac == null && cape == null) return "nodata";
    const f = frac || 0, c = cape == null ? 0 : cape, p = pop == null ? 0 : pop;
    if (f >= 0.5 && (cape == null || c >= 250)) return "action";
    if (f >= 0.25 || (c >= 1000 && p >= 40)) return "prepare";
    if (f > 0 || (c >= 250 && p >= 20)) return "monitor";
    return "normal";
  }

  async function run() {
    $("runBtn").disabled = true; O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${MODELS.length} models…`;
    const params = { forecast_days: $("days").value, temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" };
    const res = await Promise.allSettled(MODELS.map((m) => O.fetchModel("https://api.open-meteo.com/v1/forecast", params, m.id,
      m.id === "icon_seamless" ? HOURLY : HOURLY.filter((v) => v !== "lightning_potential"))));
    $("runBtn").disabled = false;
    let master = null; const ok = [], empty = [], failed = [];
    res.forEach((r, i) => {
      const m = MODELS[i];
      if (r.status !== "fulfilled") { failed.push(m.name); picker.setStatus(m.id, "none"); return; }
      const h = O.pick(r.value.hourly, HOURLY);
      if (!O.hasData(h.cape) && !O.hasData(h.weather_code)) { empty.push(m.name); picker.setStatus(m.id, "none"); return; }
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
    O.setChip("LIVE · OPEN-METEO", "live");
    $("runMsg").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${ok.length} models` +
      (empty.length ? ` · no coverage here: ${empty.join(", ")}` : "") + (failed.length ? ` · failed: ${failed.join(", ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    render();
  }

  const active = (v) => (data ? MODELS.filter((m) => data.models[m.id] && picker.on(m.id) && O.hasData(data.models[m.id][v])) : []);
  const blend = (v) => { const ms = active(v); return O.blendSeries(ms.map((m) => ({ w: picker.w(m.id), data: data.models[m.id][v] })), data.times.length); };

  function compute() {
    const n = data.times.length, wm = active("weather_code");
    const cape = blend("cape"), pop = blend("precipitation_probability"), li = blend("lifted_index"), sh = blend("shear");
    const frac = [];
    for (let i = 0; i < n; i++) {
      let w = 0, t = 0;
      wm.forEach((m) => { const c = data.models[m.id].weather_code[i]; if (c == null) return; w += picker.w(m.id); if (isThunder(c)) t += picker.w(m.id); });
      frac.push(w ? t / w : null);
    }
    const tiers = frac.map((f, i) => tierOf(f, cape.mean[i], pop.mean[i]));
    const perModel = MODELS.filter((m) => data.models[m.id] && picker.on(m.id)).map((m) => {
      const a = data.models[m.id];
      return { m, tiers: a.cape.map((c, i) => tierOf(a.weather_code[i] == null ? null : isThunder(a.weather_code[i]) ? 1 : 0, c, a.precipitation_probability[i])) };
    });
    return { frac, tiers, perModel, cape, pop, li, sh };
  }

  function render() {
    if (!data) {
      $("strip").innerHTML = '<p class="msg">No forecast loaded yet.</p>';
      $("daily").innerHTML = "";
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    const C = compute(); data.C = C;
    const rows = [{ name: "BLEND", color: O.css("--text"), tiers: C.tiers, bold: true }]
      .concat(C.perModel.map((p) => ({ name: p.m.name, color: O.modelColor(MODELS.indexOf(p.m)), tiers: p.tiers })));
    $("strip").innerHTML = O.tierStrip(data.times, rows, 1);

    /* headline: worst tier over the next 24 hours */
    const now = Math.max(0, O.nowIndex(data.times, data.tz)), end = Math.min(data.times.length, now + 24);
    const next = C.tiers.slice(now, end), worst = O.maxTier(next);
    const firstIdx = next.findIndex((t) => t === worst);
    const capeWin = C.cape.max.slice(now, end).filter((x) => x != null);
    const peak = capeWin.length ? Math.max(...capeWin) : null;
    const shWin = C.sh.mean.slice(now, end).filter((x) => x != null);
    O.headline({
      tier: worst,
      word: worst === "nodata" ? "NO DATA" : O.TIER[worst].word,
      stats: [
        { num: worst === "nodata" || worst === "normal" ? "—" : O.fmtWhen(data.times[now + firstIdx]), unit: worst === "normal" ? "no signal next 24 h" : "first, next 24 h" },
        { num: peak == null ? "—" : Math.round(peak).toLocaleString(), unit: "J/kg peak CAPE (any model)" },
        { num: shWin.length ? Math.round(Math.max(...shWin)) + " kt" : "—", unit: "max deep-layer shear" },
      ],
    });

    /* daily table */
    const dayIdx = [];
    data.times.forEach((t, i) => { const k = O.dayOf(t); if (!dayIdx.length || dayIdx[dayIdx.length - 1].k !== k) dayIdx.push({ k, idx: [] }); dayIdx[dayIdx.length - 1].idx.push(i); });
    const mx = (arr, idx) => { const v = idx.map((i) => arr[i]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const mn = (arr, idx) => { const v = idx.map((i) => arr[i]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
    const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>Signal</th><th>Prepare+ hours</th><th>Window</th><th>Blend CAPE max</th><th>Any-model CAPE max</th><th>Min LI</th><th>Max shear</th><th>Thunder share max</th></tr></thead><tbody>` +
      dayIdx.filter((d) => d.idx.length >= 6).map((d) => {
        const t = O.maxTier(d.idx.map((i) => C.tiers[i]));
        const hot = d.idx.filter((i) => O.TIER[C.tiers[i]].rank >= 2);
        const win = hot.length ? `${O.fmtHour(O.hourOf(data.times[hot[0]]))}–${O.fmtHour((O.hourOf(data.times[hot[hot.length - 1]]) + 1) % 24)}` : "—";
        const fr = mx(C.frac, d.idx);
        return `<tr><td class="display" style="font-size:12px">${O.fmtDay(d.k)}</td><td><span class="badge" style="--b:${O.TIER[t].color}">${O.TIER[t].word}</span></td>` +
          `<td class="num">${hot.length}</td><td class="num">${win}</td><td class="num">${f(mx(C.cape.mean, d.idx), 0)}</td><td class="num">${f(mx(C.cape.max, d.idx), 0)}</td>` +
          `<td class="num">${f(mn(C.li.mean, d.idx), 1)}</td><td class="num">${f(mx(C.sh.mean, d.idx), 0, " kt")}</td><td class="num">${fr == null ? "—" : Math.round(fr * 100) + "%"}</td></tr>`;
      }).join("") + "</tbody>";
    renderChart();
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
    ms.forEach((m) => ds.push({ label: m.name, data: data.models[m.id][t.v], borderColor: O.modelColor(MODELS.indexOf(m)), borderWidth: 1.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 3 }));
    if (ms.length > 1) ds.push({ label: "BLEND", data: B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 1 });
    const base = O.chartBase({ labels, hours, nowIdx: O.nowIndex(data.times, data.tz), unit: t.unit, dec: t.dec || 0, yTitle: t.unit, beginAtZero: t.zero, yMin: t.min, yMax: t.max });
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    $("legend").innerHTML = ms.map((m) => `<span><i class="sw" style="background:${O.modelColor(MODELS.indexOf(m))}"></i>${O.esc(m.name)}</span>`).join("") +
      (ms.length > 1 ? `<span><i class="sw" style="background:${fg};height:4px"></i>Weighted blend</span><span><i class="sw" style="background:var(--band);height:10px"></i>Model spread</span>` : "") +
      (!ms.length ? "<span>None of the checked models carry this field here.</span>" : "");
  }

  render();
  run();
})();
