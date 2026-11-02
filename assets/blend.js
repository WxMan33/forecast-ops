/* Model Blend: weighted multi-model point forecast. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$;
  O.shell("blend", "Model Blend");

  /* Forecast API model ids. w = default weight, on:false = starts unchecked.
     Regional models (HRRR, NAM, NBM) drop out on their own outside their domain. */
  const MODELS = [
    { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
    { id: "ecmwf_aifs025_single", name: "ECMWF AIFS", w: 1 },
    { id: "gfs_seamless", name: "GFS", w: 1 },
    { id: "ncep_nbm_conus", name: "NBM", w: 1.25 },
    { id: "gfs_hrrr", name: "HRRR (48 h)", w: 1 },
    { id: "ncep_nam_conus", name: "NAM 3 km", w: 0.75 },
    { id: "icon_seamless", name: "ICON", w: 1 },
    { id: "gem_seamless", name: "GEM", w: 1 },
    { id: "ukmo_seamless", name: "UKMO", w: 1 },
    { id: "meteofrance_seamless", name: "Météo-France", w: 0.75, on: false },
    { id: "jma_seamless", name: "JMA", w: 0.75, on: false },
  ];
  const HOURLY = ["temperature_2m", "dew_point_2m", "apparent_temperature", "precipitation_probability", "precipitation", "snowfall", "wind_speed_10m", "wind_gusts_10m", "cloud_cover"];
  const DAILY = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "snowfall_sum", "precipitation_probability_max", "wind_gusts_10m_max"];
  const TABS = [
    { id: "temp", label: "Temperature", v: "temperature_2m", unit: "°F" },
    { id: "dew", label: "Dew point", v: "dew_point_2m", unit: "°F" },
    { id: "feel", label: "Feels like", v: "apparent_temperature", unit: "°F" },
    { id: "pop", label: "Precip chance", v: "precipitation_probability", unit: "%", min: 0, max: 100 },
    { id: "qpf", label: "Precip (accum.)", v: "precipitation", unit: "in", accum: true, dec: 2 },
    { id: "snow", label: "Snow (accum.)", v: "snowfall", unit: "in", accum: true, dec: 1 },
    { id: "wind", label: "Wind", v: "wind_speed_10m", unit: "mph", zero: true },
    { id: "gust", label: "Gusts", v: "wind_gusts_10m", unit: "mph", zero: true },
    { id: "cloud", label: "Cloud cover", v: "cloud_cover", unit: "%", min: 0, max: 100 },
  ];

  let data = null; // { times, tz, dtimes, models: {id: {h:{}, d:{}}} }
  let tab = O.store.get("ops_blend_tab", "temp");
  let chart = null;

  const picker = O.modelPicker($("models"), "ops_blend_models", MODELS, render);
  $("resetW").addEventListener("click", () => picker.reset());
  O.locationCard($("locCard"), () => run());
  $("runBtn").addEventListener("click", () => run());
  $("days").value = String(O.store.get("ops_blend_days", 7));
  $("days").addEventListener("change", () => { O.store.set("ops_blend_days", +$("days").value); run(); });

  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label;
    b.setAttribute("aria-selected", t.id === tab);
    b.addEventListener("click", () => { tab = t.id; O.store.set("ops_blend_tab", tab); document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === b)); renderChart(); });
    $("tabs").appendChild(b);
  });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });

  async function run() {
    $("runBtn").disabled = true;
    O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${MODELS.length} models…`;
    const params = { forecast_days: $("days").value, temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" };
    const results = await Promise.allSettled(MODELS.map((m) => O.fetchModel("https://api.open-meteo.com/v1/forecast", params, m.id, HOURLY, DAILY)));
    $("runBtn").disabled = false;
    const ok = [], failed = [], empty = [];
    let master = null;
    results.forEach((r, i) => {
      const m = MODELS[i];
      if (r.status !== "fulfilled") { failed.push(m.name); picker.setStatus(m.id, "none"); return; }
      const j = r.value, h = O.pick(j.hourly, HOURLY), d = O.pick(j.daily, DAILY);
      if (!O.hasData(h.temperature_2m)) { empty.push(m.name); picker.setStatus(m.id, "none"); return; }
      picker.setStatus(m.id, "ok");
      if (!master || j.hourly.time.length > master.hourly.time.length) master = j;
      ok.push({ m, j, h, d });
    });
    picker.redraw();
    if (!ok.length) {
      data = null;
      O.setChip("NO DATA", "err");
      $("runMsg").className = "msg err";
      $("runMsg").textContent = "Couldn't reach Open-Meteo. Check your connection and try again.";
      O.headline({ tier: "nodata", word: "NO DATA" });
      render();
      return;
    }
    const times = master.hourly.time, dtimes = (master.daily && master.daily.time) || [];
    data = { times, dtimes, tz: master.timezone, models: {} };
    ok.forEach(({ m, j, h, d }) => {
      const hh = {}, dd = {};
      HOURLY.forEach((v) => (hh[v] = O.align(times, j.hourly.time, h[v])));
      DAILY.forEach((v) => (dd[v] = j.daily ? O.align(dtimes, j.daily.time, d[v]) : dtimes.map(() => null)));
      data.models[m.id] = { h: hh, d: dd };
    });
    O.setChip("LIVE · OPEN-METEO", "live");
    $("runMsg").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${ok.length} models` +
      (empty.length ? ` · no coverage here: ${empty.join(", ")}` : "") + (failed.length ? ` · failed: ${failed.join(", ")}` : "") +
      ` · times in ${O.tzShort(data.tz)}`;
    render();
  }

  const active = (v) => (data ? MODELS.filter((m) => data.models[m.id] && picker.on(m.id) && O.hasData(data.models[m.id].h[v])) : []);
  const series = (v, ms) => ms.map((m) => ({ w: picker.w(m.id), data: data.models[m.id].h[v] }));

  function days() {
    const out = [];
    data.times.forEach((t, i) => { const k = O.dayOf(t); if (!out.length || out[out.length - 1].k !== k) out.push({ k, idx: [] }); out[out.length - 1].idx.push(i); });
    return out.filter((d) => d.idx.length >= 12);
  }
  /* A model's daily value: its own daily field when present, else derived from its hourly data. */
  function dailyVal(m, day, dv, hv, how) {
    const j = data.dtimes.indexOf(day.k), md = data.models[m.id];
    const x = j >= 0 && md.d[dv] ? md.d[dv][j] : null;
    if (x != null) return x;
    const a = day.idx.map((i) => md.h[hv][i]).filter((y) => y != null);
    if (a.length < 12) return null;
    return how === "max" ? Math.max(...a) : how === "min" ? Math.min(...a) : a.reduce((s, y) => s + y, 0);
  }
  const wmean = (ms, f) => { let s = 0, w = 0; ms.forEach((m) => { const x = f(m); if (x != null) { s += picker.w(m.id) * x; w += picker.w(m.id); } }); return w ? s / w : null; };
  const confidence = (spread) => spread == null ? { word: "1 MODEL", tier: "nodata" } : spread <= 3 ? { word: "HIGH", tier: "normal" } : spread <= 6 ? { word: "MEDIUM", tier: "monitor" } : { word: "LOW", tier: "prepare" };
  const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);

  function render() {
    if (!data) {
      $("daily").innerHTML = '<tbody><tr><td class="msg">No forecast loaded yet.</td></tr></tbody>';
      if (chart) { chart.destroy(); chart = null; }
      $("legend").innerHTML = "";
      return;
    }
    renderDaily();
    renderNow();
    renderChart();
  }

  function renderDaily() {
    const tm = active("temperature_2m"), pm = active("precipitation");
    const rows = days().map((d) => {
      const highs = tm.map((m) => dailyVal(m, d, "temperature_2m_max", "temperature_2m", "max")).filter((x) => x != null);
      return {
        k: d.k,
        hi: wmean(tm, (m) => dailyVal(m, d, "temperature_2m_max", "temperature_2m", "max")),
        lo: wmean(tm, (m) => dailyVal(m, d, "temperature_2m_min", "temperature_2m", "min")),
        qpf: wmean(pm, (m) => dailyVal(m, d, "precipitation_sum", "precipitation", "sum")),
        sn: wmean(active("snowfall"), (m) => dailyVal(m, d, "snowfall_sum", "snowfall", "sum")),
        pop: wmean(active("precipitation_probability"), (m) => dailyVal(m, d, "precipitation_probability_max", "precipitation_probability", "max")),
        gust: wmean(active("wind_gusts_10m"), (m) => dailyVal(m, d, "wind_gusts_10m_max", "wind_gusts_10m", "max")),
        spread: highs.length > 1 ? Math.max(...highs) - Math.min(...highs) : null,
        n: highs.length,
      };
    });
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>High</th><th>Low</th><th>Precip</th><th>Snow</th><th>Max chance</th><th>Peak gust</th><th>High spread</th><th>Confidence</th></tr></thead><tbody>` +
      rows.map((r) => { const c = confidence(r.spread);
        return `<tr><td class="display" style="font-size:12px">${O.fmtDay(r.k)}</td><td class="num"><span class="hi">${f(r.hi, 0, "°")}</span></td><td class="num"><span class="lo">${f(r.lo, 0, "°")}</span></td>` +
          `<td class="num">${f(r.qpf, 2, '"')}</td><td class="num">${r.sn != null && r.sn >= 0.05 ? f(r.sn, 1, '"') : "—"}</td><td class="num">${f(r.pop, 0, "%")}</td>` +
          `<td class="num">${f(r.gust, 0, " mph")}</td><td class="num">${r.spread == null ? "—" : "±" + (r.spread / 2).toFixed(0) + "°"}</td>` +
          `<td><span class="badge" style="--b:${O.TIER[c.tier].color}">${c.word}</span></td></tr>`; }).join("") + "</tbody>";
    data.rows = rows;
  }

  function renderNow() {
    const now = Math.max(0, O.nowIndex(data.times, data.tz)), end = Math.min(data.times.length, now + 24);
    const win = (v, how) => {
      const ms = active(v); if (!ms.length) return null;
      const b = O.blendSeries(series(v, ms), data.times.length).mean.slice(now, end).filter((x) => x != null);
      if (!b.length) return null;
      return how === "max" ? Math.max(...b) : how === "min" ? Math.min(...b) : how === "sum" ? b.reduce((s, x) => s + x, 0) : b[0];
    };
    const tNow = win("temperature_2m"), hi = win("temperature_2m", "max"), lo = win("temperature_2m", "min");
    const qpf = win("precipitation", "sum"), pop = win("precipitation_probability", "max"), gust = win("wind_gusts_10m", "max");
    const tm = active("temperature_2m");
    const spreadNow = (() => { const v = tm.map((m) => data.models[m.id].h.temperature_2m[now]).filter((x) => x != null); return v.length > 1 ? Math.max(...v) - Math.min(...v) : null; })();
    const today = data.rows && data.rows[0], c = confidence(today ? today.spread : null);
    O.headline({
      tier: c.tier, word: c.tier === "nodata" ? "1 MODEL" : `${c.word} CONFIDENCE`,
      stats: [
        { num: `${f(hi, 0, "°")} / ${f(lo, 0, "°")}`, unit: "next 24 h hi / lo" },
        { num: f(pop, 0, "%"), unit: "max precip chance" },
      ],
    });
    $("tiles").innerHTML = [
      ["Now", f(tNow, 0, "°F"), spreadNow == null ? "" : `models span ${spreadNow.toFixed(0)}°`],
      ["24 h high / low", `${f(hi, 0, "°")} / ${f(lo, 0, "°")}`, `${tm.length} models in blend`],
      ["24 h precip", f(qpf, 2, '"'), `max chance ${f(pop, 0, "%")}`],
      ["Peak gust", f(gust, 0, " mph"), "blended, next 24 h"],
      ["Today's confidence", c.word, today && today.spread != null ? `highs span ${today.spread.toFixed(0)}°` : "needs 2+ models"],
    ].map(([k, v, s]) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join("");
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    $("chartTitle").textContent = t.label;
    const ms = active(t.v), n = data.times.length, B = O.blendSeries(series(t.v, ms), n);
    const labels = O.hourLabels(data.times), hours = data.times.map(O.hourOf), fg = O.css("--text");
    const ds = [];
    if (!t.accum && ms.length > 1) {
      ds.push({ label: "min", data: B.min, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true, hideTip: true, order: 5 });
      ds.push({ label: "spread", data: B.max, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), spanGaps: true, hideTip: true, order: 5 });
    }
    ms.forEach((m) => {
      const raw = data.models[m.id].h[t.v];
      ds.push({ label: m.name, data: t.accum ? cumTrim(raw) : raw, borderColor: O.modelColor(MODELS.indexOf(m)), borderWidth: 1.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 3 });
    });
    if (ms.length > 1 || t.accum) ds.push({ label: "BLEND", data: t.accum ? cumTrim(B.mean) : B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 1 });
    if (t.accum) ds.push({ type: "bar", label: "Blend per hour", data: B.mean, backgroundColor: O.css("--band"), yAxisID: "y2", order: 6, barPercentage: 1, categoryPercentage: 1, dec: 2 });
    const base = O.chartBase({ labels, hours, nowIdx: O.nowIndex(data.times, data.tz), unit: t.unit, dec: t.dec || 0, yTitle: t.accum ? `Accumulated (${t.unit})` : t.unit,
      y2Title: t.accum ? "Per hour (in)" : null, beginAtZero: t.accum || t.zero, yMin: t.min, yMax: t.max });
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    $("legend").innerHTML = ms.map((m) => `<span><i class="sw" style="background:${O.modelColor(MODELS.indexOf(m))}"></i>${O.esc(m.name)}</span>`).join("") +
      (ms.length > 1 || t.accum ? `<span><i class="sw" style="background:${fg};height:4px"></i>Weighted blend</span>` : "") +
      (!t.accum && ms.length > 1 ? `<span><i class="sw" style="background:var(--band);height:10px"></i>Model spread (min–max)</span>` : "") +
      (!ms.length ? "<span>None of the checked models carry this field here.</span>" : "");
  }
  /* Running total that stops where a model's data ends (e.g. HRRR at 48 h) instead of flat-lining. */
  function cumTrim(a) {
    let last = -1; a.forEach((x, i) => { if (x != null) last = i; });
    const c = O.cumulative(a); return c.map((x, i) => (i > last ? null : x));
  }

  render();
  run();
})();
