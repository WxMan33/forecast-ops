/* Winter: ensemble snowfall odds and plume for one point. Math in OpsCore.winter. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core, W = C.winter;
  O.shell("winter", "Winter");

  /* Ensembles and request settings are shared with the overview: OpsCore.config.winter */
  const SPEC = C.config.winter, ENS = SPEC.models;
  const NAMES = Object.fromEntries(ENS.map((m) => [m.id, m.name]));
  const TABS = [
    { id: "plume", label: "Accumulation plume", sub: "Every member's running snowfall total from the start of the window; a line stops where that member's data stops. Thick lines are the weighted 10th, 50th and 90th percentiles of members with data at that hour." },
    { id: "rate", label: "Snow per hour", sub: "Weighted median and 90th percentile of hourly snowfall across members." },
    { id: "temp", label: "Temperature", sub: "Weighted 10th, 50th and 90th percentile 2 m temperature across members. The dashed line is 32°F." },
  ];

  let data = null, chart = null, fresh = false, tab = O.store.get("ops_winter_tab", "plume");
  const picker = O.modelPicker($("models"), "ops_winter_models", ENS, render, { title: "Ensembles & weights" });
  O.locationCard($("locCard"), () => run());
  O.eventCard($("evCard"));
  O.onEvent(() => render());
  $("runBtn").addEventListener("click", () => run());
  $("win").insertAdjacentHTML("beforeend", '<option value="event">Active event</option>');
  $("win").value = String(O.store.get("ops_winter_win", 72));
  if (!$("win").value) $("win").value = "72";
  $("win").addEventListener("change", () => { O.store.set("ops_winter_win", $("win").value); render(); });
  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label; b.setAttribute("aria-selected", t.id === tab);
    b.addEventListener("click", () => { tab = t.id; O.store.set("ops_winter_tab", tab); document.querySelectorAll("#tabs .tab").forEach((x) => x.setAttribute("aria-selected", x === b)); renderChart(); });
    $("tabs").appendChild(b);
  });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });

  async function run() {
    $("runBtn").disabled = true; O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${ENS.length} ensembles…`;
    const res = await O.Data.loadEnsemble(SPEC, { lat: O.location.lat, lon: O.location.lon });
    $("runBtn").disabled = false;
    ENS.forEach((e) => picker.setStatus(e.id, res.status[e.id] === "ok" ? "ok" : "none"));
    picker.redraw();
    if (res.empty) {
      data = null; O.setChip("NO DATA", "err"); O.headline({ tier: "nodata" });
      $("runMsg").className = "msg err"; $("runMsg").textContent = "Couldn't reach the Open-Meteo ensemble API. Check your connection and try again.";
      render(); return;
    }
    data = res;
    $("runMsg").textContent = Object.keys(res.ens).map((id) => `${NAMES[id]} ${res.ens[id].snowfall.length}`).join(", ") + " members" + (res.problems.length ? ` · ${res.problems.join(" · ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    fresh = true;
    render();
  }

  /* Flatten checked ensembles into weighted members. */
  function pool(kind) {
    const out = [];
    ENS.forEach((e, ei) => {
      const d = data.ens[e.id]; if (!d || !picker.on(e.id)) return;
      const arrs = d[kind === "snow" ? "snowfall" : "temperature_2m"] || []; if (!arrs.length) return;
      arrs.forEach((a) => out.push({ e, ei, w: picker.w(e.id) / arrs.length, a }));
    });
    return out;
  }
  /* The window: N hours from now, or the active event's exact accumulation hours. */
  const windowIdx = () => {
    if ($("win").value === "event") {
      const w = data.ctx && data.ctx.wins && data.ctx.wins.find((x) => x.key === "all");
      if (w && w.L.acc.length) return { s: w.L.acc[0], e: w.L.acc[w.L.acc.length - 1] + 1, event: true };
    }
    const s = Math.max(0, O.nowIndex(data.times, data.tz) + 1), e = Math.min(data.times.length, s + (+$("win").value || 72)); return { s, e };
  };
  const pct = (p) => (p == null ? "—" : Math.round(p * 100) + "%");
  const inch = (x) => (x == null ? "—" : (x < 10 ? x.toFixed(1) : x.toFixed(0)) + '"');
  const winText = () => ($("win").value === "event" ? "event" : $("win").selectedOptions[0].text);

  function render() {
    if (!data) {
      $("odds").innerHTML = '<tbody><tr><td class="msg">No ensemble loaded yet.</td></tr></tbody>';
      $("daily").innerHTML = ""; if (chart) { chart.destroy(); chart = null; } $("legend").innerHTML = ""; return;
    }
    data.ctx = O.eventContext(data);
    const mem = pool("snow"), { s, e } = windowIdx();
    const short = $("win").value !== "event" && e - s < +$("win").value;
    /* event phases: odds over each phase's exact hours, from complete members only */
    const ph = (w) => (w._st = w._st || W.windowStats(mem, w.L.acc[0], w.L.acc[w.L.acc.length - 1] + 1));
    O.eventTable($("eventCard"), data.ctx, [
      { label: "Any snow", cell: (w) => pct(ph(w).P[0.1]) },
      { label: '1"+', cell: (w) => pct(ph(w).P[1]) },
      { label: '2"+', cell: (w) => pct(ph(w).P[2]) },
      { label: "Median", cell: (w) => inch(ph(w).p50) },
      { label: "10–90%", cell: (w) => `${inch(ph(w).p10)}–${inch(ph(w).p90)}` },
      { label: "Members", cell: (w) => `${ph(w).used}/${ph(w).total}` },
    ], { note: "Snow that falls during each phase, from members covering every hour of it." });
    if (!mem.length) { $("odds").innerHTML = '<tbody><tr><td class="msg">Check at least one ensemble.</td></tr></tbody>'; O.headline({ tier: "nodata" }); renderChart(); return; }
    const st = W.windowStats(mem, s, e);
    const tier = W.tier(st);
    const problems = [...data.problems];
    if (st.used < st.total) problems.push(`${st.total - st.used} of ${st.total} members don't cover every hour of the window and were left out of the odds`);
    if (short) problems.push(`Ensemble data ends before the full ${winText()} window`);
    O.dataStatus(problems);
    $("oddsSub").innerHTML = `${O.fmtWhen(data.times[s])} to ${O.fmtWhen(data.times[e - 1])} ${O.tzShort(data.tz)} · <b>${st.used} of ${st.total} members</b> cover every hour and decide the odds. Median ${inch(st.p50)}, 10–90% range ${inch(st.p10)} to ${inch(st.p90)}.` +
      (st.partial ? ` <span style="color:var(--monitor)">${st.partial} more ${st.partial === 1 ? "member has" : "members have"} gaps; ${st.partialAtLeast[1]} of them already reach at least 1" (lower bounds, not counted).</span>` : "") +
      (short ? ` <span style="color:var(--monitor)">Data ends before the end of the ${O.esc(winText())} window.</span>` : "");
    O.headline({
      tier, note: `Ensemble snow signal · next ${winText()}`,
      stats: [
        { num: pct(st.P[1]), unit: 'chance of 1"+' },
        { num: inch(st.p50), unit: "median total" },
        { num: `${st.used}/${st.total}`, unit: "members used" },
      ],
    });

    /* odds table: blend + each ensemble, with member coverage in the header */
    const per = ENS.filter((x) => data.ens[x.id] && picker.on(x.id)).map((x) => ({ x, st: W.windowStats(mem.filter((m) => m.e === x), s, e) }));
    const bar = (p) => `<div style="height:6px;border-radius:3px;background:var(--snow-stick);width:${Math.round((p || 0) * 100)}%;min-width:${p ? 2 : 0}px"></div>`;
    $("odds").innerHTML = `<thead><tr><th>Total</th><th>Blend</th><th style="width:26%"></th>${per.map((p) => `<th>${O.esc(p.x.name)}<br><span style="font-weight:600">${p.st.used}/${p.st.total} members</span></th>`).join("")}</tr></thead><tbody>` +
      W.THRESH.map((t) => `<tr><td class="num">${t === 0.1 ? 'Any (0.1"+)' : t + '"+'}</td><td class="num" style="font-weight:800">${pct(st.P[t])}</td><td>${bar(st.P[t])}</td>${per.map((p) => `<td class="num">${pct(p.st.P[t])}</td>`).join("")}</tr>`).join("") + "</tbody>";

    /* daily table: only the days inside the window, clipped to it */
    const ws = mem.map((m) => m.w), tm = pool("temp"), tw = tm.map((m) => m.w);
    $("dailyTitle").textContent = `Day by day, within the ${winText()} window`;
    const days = O.dayGroups(data.times, s, e);
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>Hours</th><th>Median snow</th><th>90th pct</th><th>Any snow</th><th>1"+</th><th>Members</th><th>Median low</th><th>Median high</th></tr></thead><tbody>` +
      days.map((d) => {
        const ds = W.windowStats(mem, d.idx[0], d.idx[d.idx.length - 1] + 1);
        const lows = tm.map((m) => { const v = d.idx.map((i) => m.a[i]).filter((x) => x != null); return v.length ? Math.min(...v) : null; });
        const highs = tm.map((m) => { const v = d.idx.map((i) => m.a[i]).filter((x) => x != null); return v.length ? Math.max(...v) : null; });
        const lo = O.weightedQuantile(lows, tw, 0.5), hi = O.weightedQuantile(highs, tw, 0.5), part = d.idx.length < 24;
        return `<tr><td class="display" style="font-size:12px">${O.fmtDay(d.k)}</td><td class="num">${part ? `${O.fmtHour(O.hourOf(data.times[d.idx[0]]))}–${O.fmtHour((O.hourOf(data.times[d.idx[d.idx.length - 1]]) + 1) % 24)}` : "all day"}</td>` +
          `<td class="num">${inch(ds.p50)}</td><td class="num">${inch(ds.p90)}</td><td class="num">${pct(ds.P[0.1])}</td><td class="num">${pct(ds.P[1])}</td><td class="num" title="${ds.partial ? `${ds.partial} members with gaps left out` : "all members complete"}">${ds.used}/${ds.total}</td>` +
          `<td class="num"><span class="lo">${lo == null ? "—" : Math.round(lo) + "°"}</span></td><td class="num"><span class="hi">${hi == null ? "—" : Math.round(hi) + "°"}</span></td></tr>`;
      }).join("") + "</tbody>";

    /* Compare full calendar days only: a sliding "next 72 hours" covers a different window every hour. */
    if (fresh) {
      const ws = picker.weights(), snap = { cfg: C.config.fingerprint(ws), rows: {} };
      W.dayRows(data.times, mem).filter((r) => r.hours === 24 && r.st.used).forEach((r) => (snap.rows[r.k] = {
        label: O.fmtDay(r.k), win: r.win, contrib: Object.keys(ws).filter((id) => data.ens[id]),
        t: W.tier(r.st), p01: r.st.P[0.1] * 100, p1: r.st.P[1] * 100, p4: r.st.P[4] * 100, p50: r.st.p50, p90: r.st.p90 }));
      data.snapPair = O.trackChanges("winter", snap); fresh = false;
    }
    O.renderChanges($("changes"), data.snapPair, [
      { k: "t", label: "signal", tier: true },
      { k: "p01", label: "any snow", min: 10, fmt: (v) => `${Math.round(v)}%` },
      { k: "p1", label: '1"+', min: 10, fmt: (v) => `${Math.round(v)}%` },
      { k: "p4", label: '4"+', min: 10, fmt: (v) => `${Math.round(v)}%` },
      { k: "p50", label: "median", min: 0.5, fmt: (v) => `${v.toFixed(1)}"` },
      { k: "p90", label: "90th pct", min: 1, fmt: (v) => `${v.toFixed(1)}"` },
    ], NAMES);
    renderChart();
  }

  function quantileSeries(mem, arrs, n, qs) {
    const ws = mem.map((m) => m.w);
    return qs.map((qq) => { const out = []; for (let i = 0; i < n; i++) out.push(O.weightedQuantile(arrs.map((a) => a[i]), ws, qq)); return out; });
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    $("chartTitle").textContent = t.label; $("chartSub").textContent = t.sub;
    const { s, e } = windowIdx(), times = data.times.slice(s, e), n = times.length, labels = O.hourLabels(times), hours = times.map(O.hourOf), fg = O.css("--text");
    const ds = []; let base;
    const ens = ENS.filter((x) => data.ens[x.id] && picker.on(x.id));
    if (t.id === "plume" || t.id === "rate") {
      const mem = pool("snow");
      const raw = mem.map((m) => m.a.slice(s, e));
      if (t.id === "plume") {
        const cum = raw.map(C.stats.cumulativeStrict);
        mem.forEach((m, i) => ds.push({ label: `${m.e.name}`, data: cum[i], borderColor: O.modelColor(m.ei) + "55", borderWidth: 1, pointRadius: 0, hideTip: true, spanGaps: false, order: 4 }));
        const [p10, p50, p90] = quantileSeries(mem, cum, n, [0.1, 0.5, 0.9]);
        ds.push({ label: "90th pct", data: p90, borderColor: fg, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, order: 1, dec: 1 });
        ds.push({ label: "Median", data: p50, borderColor: fg, borderWidth: 3.5, pointRadius: 0, order: 1, dec: 1 });
        ds.push({ label: "10th pct", data: p10, borderColor: fg, borderWidth: 2, borderDash: [2, 3], pointRadius: 0, order: 1, dec: 1 });
        base = O.chartBase({ labels, hours, nowIdx: -1, unit: "in", dec: 1, yTitle: "Snow since window start (in)", beginAtZero: true, bands: O.eventBands(data.ctx, s) });
      } else {
        const [p50, p90] = quantileSeries(mem, raw, n, [0.5, 0.9]);
        ds.push({ type: "bar", label: "90th pct", data: p90, backgroundColor: O.css("--snow") + "88", order: 2, barPercentage: 1, categoryPercentage: 1, dec: 2, grouped: false });
        ds.push({ type: "bar", label: "Median", data: p50, backgroundColor: O.css("--snow-stick"), order: 1, barPercentage: 1, categoryPercentage: 1, dec: 2, grouped: false });
        base = O.chartBase({ labels, hours, nowIdx: -1, unit: "in", dec: 2, yTitle: "Snow per hour (in)", beginAtZero: true, bands: O.eventBands(data.ctx, s) });
      }
      $("legend").innerHTML = ens.map((x) => `<span><i class="sw" style="background:${O.modelColor(ENS.indexOf(x))}"></i>${O.esc(x.name)} members</span>`).join("") +
        (t.id === "plume" ? `<span><i class="sw" style="background:${fg};height:4px"></i>Median</span><span>Dashed: 10th / 90th pct</span>` : `<span><i class="sw" style="background:var(--snow-stick);height:10px"></i>Median</span><span><i class="sw" style="background:var(--snow);height:10px"></i>90th pct</span>`);
    } else {
      const mem = pool("temp"), raw = mem.map((m) => m.a.slice(s, e));
      const [p10, p50, p90] = quantileSeries(mem, raw, n, [0.1, 0.5, 0.9]);
      ds.push({ label: "10th pct", data: p10, borderWidth: 0, pointRadius: 0, fill: false, order: 3 });
      ds.push({ label: "90th pct", data: p90, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), order: 3 });
      ds.push({ label: "Median", data: p50, borderColor: fg, borderWidth: 3, pointRadius: 0, tension: 0.25, order: 1 });
      ds.push({ label: "32°F", data: times.map(() => 32), borderColor: O.css("--cold"), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, hideTip: true, order: 2 });
      base = O.chartBase({ labels, hours, nowIdx: -1, unit: "°F", yTitle: "°F", bands: O.eventBands(data.ctx, s) });
      $("legend").innerHTML = `<span><i class="sw" style="background:${fg};height:4px"></i>Median</span><span><i class="sw" style="background:var(--band);height:10px"></i>10–90% range</span><span><i class="sw" style="background:var(--cold)"></i>Freezing</span>`;
    }
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
  }

  render();
  run();
})();
