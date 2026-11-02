/* Model Blend: weighted multi-model point forecast. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core;
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
  const RANGES = [["48", "48 H"], ["72", "72 H"], ["168", "7 D"], ["all", "ALL"]];

  let data = null, chart = null, viewDay = null, fresh = false, prevSnap = null;
  let tab = O.store.get("ops_blend_tab", "temp"), range = O.store.get("ops_blend_range", "168");

  const picker = O.modelPicker($("models"), "ops_blend_models", MODELS, render);
  const showLines = O.linesToggle($("linesBtn"), "ops_blend_lines", () => renderChart());
  O.locationCard($("locCard"), () => run());
  $("runBtn").addEventListener("click", () => run());
  $("days").value = String(O.store.get("ops_blend_days", 7));
  $("days").addEventListener("change", () => { O.store.set("ops_blend_days", +$("days").value); run(); });

  const mkTabs = (el, items, cur, onPick) => {
    el.innerHTML = "";
    items.forEach(([id, label]) => {
      const b = document.createElement("button");
      b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = label; b.setAttribute("aria-selected", id === cur);
      b.addEventListener("click", () => { el.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === b)); onPick(id); });
      el.appendChild(b);
    });
  };
  mkTabs($("tabs"), TABS.map((t) => [t.id, t.label]), tab, (id) => { tab = id; O.store.set("ops_blend_tab", tab); renderChart(); });
  mkTabs($("range"), RANGES, range, (id) => { range = id; viewDay = null; O.store.set("ops_blend_range", range); renderDaily(); renderChart(); });
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
    const problems = [...failed.map((n) => `${n}: request failed`), ...empty.map((n) => `${n}: no coverage at this point`)];
    O.dataStatus(problems);
    $("runMsg").textContent = `${ok.length} models loaded` + (empty.length ? ` · no coverage here: ${empty.join(", ")}` : "") +
      (failed.length ? ` · failed: ${failed.join(", ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    fresh = true;
    render();
  }

  const active = (v) => (data ? MODELS.filter((m) => data.models[m.id] && picker.on(m.id) && O.hasData(data.models[m.id].h[v])) : []);
  const series = (v, ms) => ms.map((m) => ({ w: picker.w(m.id), data: data.models[m.id].h[v] }));
  const days = () => O.dayGroups(data.times).filter((d) => d.idx.length >= 12);

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
  const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
  const meter = (lvl) => `<span class="meter" aria-hidden="true">${[1, 2, 3].map((k) => `<i class="${k <= lvl ? "on" : ""}"></i>`).join("")}</span>`;

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
    if (!data) return;
    const tm = active("temperature_2m"), pm = active("precipitation");
    const rows = days().map((d) => {
      const highs = tm.map((m) => dailyVal(m, d, "temperature_2m_max", "temperature_2m", "max"));
      return {
        k: d.k,
        hi: wmean(tm, (m) => dailyVal(m, d, "temperature_2m_max", "temperature_2m", "max")),
        lo: wmean(tm, (m) => dailyVal(m, d, "temperature_2m_min", "temperature_2m", "min")),
        qpf: wmean(pm, (m) => dailyVal(m, d, "precipitation_sum", "precipitation", "sum")),
        sn: wmean(active("snowfall"), (m) => dailyVal(m, d, "snowfall_sum", "snowfall", "sum")),
        pop: wmean(active("precipitation_probability"), (m) => dailyVal(m, d, "precipitation_probability_max", "precipitation_probability", "max")),
        gust: wmean(active("wind_gusts_10m"), (m) => dailyVal(m, d, "wind_gusts_10m_max", "wind_gusts_10m", "max")),
        ag: C.blend.agreement(highs),
      };
    });
    data.rows = rows;
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>High</th><th>Low</th><th>Precip</th><th>Snow</th><th>Max chance</th><th>Peak gust</th><th>Model highs</th><th>Temp agreement</th></tr></thead><tbody>` +
      rows.map((r) => `<tr data-k="${r.k}" class="${viewDay === r.k ? "sel" : ""}" tabindex="0"><td class="display" style="font-size:12px">${O.fmtDay(r.k)}</td><td class="num"><span class="hi">${f(r.hi, 0, "°")}</span></td><td class="num"><span class="lo">${f(r.lo, 0, "°")}</span></td>` +
          `<td class="num">${f(r.qpf, 2, '"')}</td><td class="num">${r.sn != null && r.sn >= 0.05 ? f(r.sn, 1, '"') : "—"}</td><td class="num">${f(r.pop, 0, "%")}</td>` +
          `<td class="num">${f(r.gust, 0, " mph")}</td><td class="num">${r.ag.lo == null ? "—" : r.ag.n > 1 ? `${r.ag.lo.toFixed(0)}–${r.ag.hi.toFixed(0)}°` : `${r.ag.lo.toFixed(0)}°`}</td>` +
          `<td title="${r.ag.n || 1} models">${meter(r.ag.level)}<span class="msg" style="color:var(--text);font-weight:700">${r.ag.word}</span></td></tr>`).join("") + "</tbody>";
    $("daily").querySelectorAll("tr[data-k]").forEach((tr) => {
      const pickDay = () => { viewDay = viewDay === tr.dataset.k ? null : tr.dataset.k; renderDaily(); renderChart(); };
      tr.addEventListener("click", pickDay);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickDay(); } });
    });

    if (fresh) {
      const snap = {}; rows.forEach((r) => (snap[r.k] = { label: O.fmtDay(r.k), hi: r.hi, lo: r.lo, qpf: r.qpf, pop: r.pop, sn: r.sn, gust: r.gust }));
      prevSnap = O.trackChanges("blend", snap); fresh = false;
      data.snap = snap;
    }
    if (data.snap) O.renderChanges($("changes"), prevSnap, data.snap, [
      { k: "hi", label: "high", min: 3, fmt: (v) => `${Math.round(v)}°` },
      { k: "lo", label: "low", min: 3, fmt: (v) => `${Math.round(v)}°` },
      { k: "qpf", label: "precip", min: 0.1, fmt: (v) => `${v.toFixed(2)}"` },
      { k: "pop", label: "max chance", min: 15, fmt: (v) => `${Math.round(v)}%` },
      { k: "sn", label: "snow", min: 0.5, fmt: (v) => `${v.toFixed(1)}"` },
      { k: "gust", label: "peak gust", min: 8, fmt: (v) => `${Math.round(v)} mph` },
    ]);
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
    const qpf = win("precipitation", "sum"), pop = win("precipitation_probability", "max"), gust = win("wind_gusts_10m", "max"), sn = win("snowfall", "sum");
    const tm = active("temperature_2m");
    const spreadNow = (() => { const v = tm.map((m) => data.models[m.id].h.temperature_2m[now]).filter((x) => x != null); return v.length > 1 ? [Math.min(...v), Math.max(...v)] : null; })();
    /* plain-language takeaway for the next 24 hours */
    const word = sn != null && sn >= 0.5 ? "SNOW LIKELY" : sn != null && sn >= 0.1 ? "SOME SNOW" :
      (pop != null && pop >= 60) || (qpf != null && qpf >= 0.25) ? "WET" : (pop != null && pop >= 30) || (qpf != null && qpf >= 0.05) ? "CHANCE OF PRECIP" : "MOSTLY DRY";
    O.headline({
      word, note: "Model blend · next 24 h",
      stats: [
        { num: `${f(hi, 0, "°")} / ${f(lo, 0, "°")}`, unit: "hi / lo" },
        { num: f(qpf, 2, '"'), unit: `precip · max ${f(pop, 0, "%")} chance` },
        { num: f(gust, 0, " mph"), unit: "peak gust" },
      ],
    });
    const today = data.rows && data.rows[0];
    $("tiles").innerHTML = [
      ["Model now", f(tNow, 0, "°F"), spreadNow ? `models ${spreadNow[0].toFixed(0)}–${spreadNow[1].toFixed(0)}° · not an observation` : "not an observation"],
      ["24 h high / low", `${f(hi, 0, "°")} / ${f(lo, 0, "°")}`, `${tm.length} models in blend`],
      ["24 h precip", f(qpf, 2, '"'), `max chance ${f(pop, 0, "%")}`],
      ["24 h snow", sn != null && sn >= 0.05 ? f(sn, 1, '"') : "—", "blended model snow"],
      ["Peak gust", f(gust, 0, " mph"), "blended, next 24 h"],
      ["Today's temp agreement", today ? today.ag.word : "—", today && today.ag.n > 1 ? `highs ${today.ag.lo.toFixed(0)}–${today.ag.hi.toFixed(0)}°` : "needs 2+ models"],
    ].map(([k, v, s]) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join("");
  }

  /* Hour range shown on the chart: a clicked day, or from now forward. */
  function viewRange() {
    if (viewDay) { const d = O.dayGroups(data.times).find((x) => x.k === viewDay); if (d) return [d.idx[0], d.idx[d.idx.length - 1] + 1]; }
    const s = Math.max(0, O.nowIndex(data.times, data.tz));
    return [s, range === "all" ? data.times.length : Math.min(data.times.length, s + +range)];
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    const [s, e] = viewRange(), times = data.times.slice(s, e), sl = (a) => a.slice(s, e);
    $("chartTitle").textContent = t.label + (viewDay ? ` · ${O.fmtDay(viewDay)}` : "");
    $("chartSub").textContent = t.accum ? `Running total from ${O.fmtWhen(data.times[s])} ${O.tzShort(data.tz)}. A model's line ends where its data ends.` : viewDay ? "Showing one day. Click the day again in the table to go back." : "";
    const ms = active(t.v), B = O.blendSeries(series(t.v, ms).map((x) => ({ w: x.w, data: sl(x.data) })), times.length);
    const labels = O.hourLabels(times), hours = times.map(O.hourOf), fg = O.css("--text");
    const ds = [];
    if (!t.accum && ms.length > 1) {
      ds.push({ label: "min", data: B.min, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true, hideTip: true, order: 5 });
      ds.push({ label: "spread", data: B.max, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), spanGaps: true, hideTip: true, order: 5 });
    }
    if (showLines() || ms.length === 1) ms.forEach((m) => {
      const raw = sl(data.models[m.id].h[t.v]);
      ds.push(O.modelLine(m.name, t.accum ? C.stats.cumulativeStrict(raw) : raw, O.modelColor(MODELS.indexOf(m))));
    });
    if (ms.length > 1 || t.accum) ds.push({ label: "BLEND", data: t.accum ? C.stats.cumulativeStrict(B.mean) : B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 1 });
    if (t.accum) ds.push({ type: "bar", label: "Blend per hour", data: B.mean, backgroundColor: O.css("--band"), yAxisID: "y2", order: 6, barPercentage: 1, categoryPercentage: 1, dec: 2 });
    const nowIdx = O.nowIndex(data.times, data.tz) - s;
    const base = O.chartBase({ labels, hours, nowIdx, unit: t.unit, dec: t.dec || 0, yTitle: t.accum ? `Accumulated (${t.unit})` : t.unit,
      y2Title: t.accum ? "Per hour (in)" : null, beginAtZero: t.accum || t.zero, yMin: t.min, yMax: t.max });
    base.options.plugins.tooltip.callbacks.footer = (items) => items.length ? `${B.count[items[0].dataIndex]} model${B.count[items[0].dataIndex] === 1 ? "" : "s"} at this hour` : "";
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    const nMin = Math.min(...B.count.filter((x) => x > 0)), nMax = Math.max(0, ...B.count);
    $("legend").innerHTML = (showLines() ? ms.map((m) => `<span><i class="sw" style="background:${O.modelColor(MODELS.indexOf(m))}"></i>${O.esc(m.name)}</span>`).join("") : "") +
      (ms.length > 1 || t.accum ? `<span><i class="sw" style="background:${fg};height:4px"></i>Weighted blend</span>` : "") +
      (!t.accum && ms.length > 1 ? `<span><i class="sw" style="background:var(--band);height:10px"></i>Model range (min–max)</span>` : "") +
      (ms.length ? `<span>${nMin === nMax ? `${nMax} models` : `${nMin}–${nMax} models, varies by hour`}</span>` : "<span>None of the checked models carry this field here.</span>");
  }

  render();
  run();
})();
