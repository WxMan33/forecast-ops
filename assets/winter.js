/* Winter: ensemble snowfall odds and plume for one point. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$;
  O.shell("winter", "Winter");

  /* Ensemble API model ids. */
  const ENS = [
    { id: "gfs025", name: "GEFS (GFS ens.)", w: 1 },
    { id: "ecmwf_ifs025", name: "ECMWF ENS", w: 1.25 },
    { id: "icon_seamless", name: "ICON EPS", w: 0.75 },
    { id: "gem_global", name: "GEM ENS", w: 0.75 },
  ];
  const HOURLY = ["snowfall", "temperature_2m", "precipitation"];
  const THRESH = [0.1, 1, 2, 4, 6, 8, 12];
  const TABS = [
    { id: "plume", label: "Accumulation plume", sub: "Every member's running snowfall total from the start of the window. Thick lines are the weighted 10th, 50th and 90th percentiles." },
    { id: "rate", label: "Snow per hour", sub: "Weighted median and 90th percentile of hourly snowfall across all members." },
    { id: "temp", label: "Temperature", sub: "Weighted 10th, 50th and 90th percentile 2 m temperature across members. The dashed line is 32°F." },
  ];

  let data = null, chart = null, tab = O.store.get("ops_winter_tab", "plume");
  const picker = O.modelPicker($("models"), "ops_winter_models", ENS, render);
  $("resetW").addEventListener("click", () => picker.reset());
  O.locationCard($("locCard"), () => run());
  $("runBtn").addEventListener("click", () => run());
  $("win").value = String(O.store.get("ops_winter_win", 72));
  $("win").addEventListener("change", () => { O.store.set("ops_winter_win", +$("win").value); render(); });
  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label; b.setAttribute("aria-selected", t.id === tab);
    b.addEventListener("click", () => { tab = t.id; O.store.set("ops_winter_tab", tab); document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === b)); renderChart(); });
    $("tabs").appendChild(b);
  });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });

  /* Control + member arrays for one variable, whatever the key suffix style. */
  function members(block, v) {
    const out = [];
    for (const k of Object.keys(block || {})) {
      if ((k === v || k.startsWith(v + "_")) && Array.isArray(block[k])) out.push({ key: k, arr: block[k] });
    }
    return out.filter((x) => O.hasData(x.arr));
  }

  async function run() {
    $("runBtn").disabled = true; O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${ENS.length} ensembles…`;
    const params = { forecast_days: 7, temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" };
    const res = await Promise.allSettled(ENS.map((e) => O.fetchModel("https://ensemble-api.open-meteo.com/v1/ensemble", params, e.id, HOURLY)));
    $("runBtn").disabled = false;
    let master = null; const ok = [], failed = [];
    res.forEach((r, i) => {
      const e = ENS[i];
      if (r.status !== "fulfilled") { failed.push(e.name); picker.setStatus(e.id, "none"); return; }
      const sn = members(r.value.hourly, "snowfall");
      if (!sn.length) { failed.push(e.name); picker.setStatus(e.id, "none"); return; }
      picker.setStatus(e.id, "ok");
      if (!master || r.value.hourly.time.length > master.hourly.time.length) master = r.value;
      ok.push({ e, j: r.value, sn, tm: members(r.value.hourly, "temperature_2m") });
    });
    picker.redraw();
    if (!ok.length) {
      data = null; O.setChip("NO DATA", "err"); O.headline({ tier: "nodata" });
      $("runMsg").className = "msg err"; $("runMsg").textContent = "Couldn't reach the Open-Meteo ensemble API. Check your connection and try again.";
      render(); return;
    }
    const times = master.hourly.time;
    data = { times, tz: master.timezone, ens: {} };
    ok.forEach(({ e, j, sn, tm }) => {
      data.ens[e.id] = { snow: sn.map((x) => O.align(times, j.hourly.time, x.arr)), temp: tm.map((x) => O.align(times, j.hourly.time, x.arr)) };
    });
    O.setChip("LIVE · OPEN-METEO ENS", "live");
    $("runMsg").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ` +
      ok.map((o) => `${o.e.name} ${o.sn.length}`).join(", ") + " members" + (failed.length ? ` · unavailable: ${failed.join(", ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    render();
  }

  /* Flatten checked ensembles into weighted members. */
  function pool(kind) {
    const out = [];
    ENS.forEach((e, ei) => {
      const d = data.ens[e.id]; if (!d || !picker.on(e.id)) return;
      const arrs = d[kind]; if (!arrs.length) return;
      arrs.forEach((a) => out.push({ e, ei, w: picker.w(e.id) / arrs.length, a }));
    });
    return out;
  }
  const windowIdx = () => { const s = Math.max(0, O.nowIndex(data.times, data.tz) + 1), e = Math.min(data.times.length, s + +$("win").value); return { s, e }; };
  const total = (a, s, e) => { let t = 0, n = 0; for (let i = s; i < e; i++) if (a[i] != null) { t += a[i]; n++; } return n ? t : null; };
  const prob = (mem, vals, th) => { let w = 0, hit = 0; mem.forEach((m, i) => { if (vals[i] == null) return; w += m.w; if (vals[i] >= th) hit += m.w; }); return w ? hit / w : null; };
  const pct = (p) => (p == null ? "—" : Math.round(p * 100) + "%");
  const inch = (x) => (x == null ? "—" : (x < 1 ? x.toFixed(1) : x.toFixed(x < 10 ? 1 : 0)) + '"');

  function tierFor(p) {
    const p01 = p[0.1] || 0, p1 = p[1] || 0, p4 = p[4] || 0;
    if (p4 >= 0.5) return "action";
    if (p1 >= 0.4 || p4 >= 0.2) return "prepare";
    if (p1 >= 0.1 || p01 >= 0.3) return "monitor";
    return "normal";
  }

  function render() {
    if (!data) {
      $("odds").innerHTML = '<tbody><tr><td class="msg">No ensemble loaded yet.</td></tr></tbody>';
      $("daily").innerHTML = ""; if (chart) { chart.destroy(); chart = null; } $("legend").innerHTML = ""; return;
    }
    const mem = pool("snow"), { s, e } = windowIdx();
    if (!mem.length) { $("odds").innerHTML = '<tbody><tr><td class="msg">Check at least one ensemble.</td></tr></tbody>'; O.headline({ tier: "nodata" }); renderChart(); return; }
    const tot = mem.map((m) => total(m.a, s, e));
    const P = {}; THRESH.forEach((t) => (P[t] = prob(mem, tot, t)));
    const ws = mem.map((m) => m.w);
    const q = (x) => O.weightedQuantile(tot, ws, x);
    const tier = tierFor(P);
    $("oddsSub").textContent = `${O.fmtWhen(data.times[s])} to ${O.fmtWhen(data.times[e - 1])}, ${mem.length} members. Median ${inch(q(0.5))}, 10–90% range ${inch(q(0.1))} to ${inch(q(0.9))}.`;
    O.headline({
      tier, word: O.TIER[tier].word,
      stats: [
        { num: pct(P[1]), unit: 'chance of 1"+' },
        { num: inch(q(0.5)), unit: `median, next ${$("win").selectedOptions[0].text}` },
      ],
    });

    /* odds table: blend + each ensemble */
    const ens = ENS.filter((x) => data.ens[x.id] && picker.on(x.id));
    const per = ens.map((x) => { const mm = mem.filter((m) => m.e === x), tt = mm.map((m) => total(m.a, s, e)); return { x, f: (th) => prob(mm, tt, th) }; });
    const bar = (p) => `<div style="height:6px;border-radius:3px;background:var(--snow-stick);width:${Math.round((p || 0) * 100)}%;min-width:${p ? 2 : 0}px"></div>`;
    $("odds").innerHTML = `<thead><tr><th>Total</th><th>Blend</th><th style="width:28%"></th>${per.map((p) => `<th>${O.esc(p.x.name)}</th>`).join("")}</tr></thead><tbody>` +
      THRESH.map((t) => `<tr><td class="num">${t === 0.1 ? 'Any (0.1"+)' : t + '"+'}</td><td class="num" style="font-weight:800">${pct(P[t])}</td><td>${bar(P[t])}</td>${per.map((p) => `<td class="num">${pct(p.f(t))}</td>`).join("")}</tr>`).join("") + "</tbody>";

    /* daily table */
    const days = [];
    data.times.forEach((t, i) => { if (i < s) return; const k = O.dayOf(t); if (!days.length || days[days.length - 1].k !== k) days.push({ k, idx: [] }); days[days.length - 1].idx.push(i); });
    const tm = pool("temp");
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>Median snow</th><th>90th pct</th><th>Any snow</th><th>1"+</th><th>Median low</th><th>Median high</th></tr></thead><tbody>` +
      days.filter((d) => d.idx.length >= 6).map((d) => {
        const dt = mem.map((m) => total(m.a, d.idx[0], d.idx[d.idx.length - 1] + 1));
        const lows = tm.map((m) => { const v = d.idx.map((i) => m.a[i]).filter((x) => x != null); return v.length ? Math.min(...v) : null; });
        const highs = tm.map((m) => { const v = d.idx.map((i) => m.a[i]).filter((x) => x != null); return v.length ? Math.max(...v) : null; });
        const tw = tm.map((m) => m.w), lo = O.weightedQuantile(lows, tw, 0.5), hi = O.weightedQuantile(highs, tw, 0.5);
        return `<tr><td class="display" style="font-size:12px">${O.fmtDay(d.k)}${d.idx.length < 24 ? ' <span class="msg">· partial</span>' : ""}</td><td class="num">${inch(O.weightedQuantile(dt, ws, 0.5))}</td><td class="num">${inch(O.weightedQuantile(dt, ws, 0.9))}</td>` +
          `<td class="num">${pct(prob(mem, dt, 0.1))}</td><td class="num">${pct(prob(mem, dt, 1))}</td><td class="num"><span class="lo">${lo == null ? "—" : Math.round(lo) + "°"}</span></td><td class="num"><span class="hi">${hi == null ? "—" : Math.round(hi) + "°"}</span></td></tr>`;
      }).join("") + "</tbody>";
    renderChart();
  }

  function quantileSeries(mem, arrs, s, e, qs) {
    const ws = mem.map((m) => m.w);
    return qs.map((qq) => { const out = []; for (let i = s; i < e; i++) out.push(O.weightedQuantile(arrs.map((a) => a[i - s]), ws, qq)); return out; });
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    $("chartTitle").textContent = t.label; $("chartSub").textContent = t.sub;
    const { s, e } = windowIdx(), times = data.times.slice(s, e), labels = O.hourLabels(times), hours = times.map(O.hourOf), fg = O.css("--text");
    const ds = []; let base;
    const ens = ENS.filter((x) => data.ens[x.id] && picker.on(x.id));
    if (t.id === "plume" || t.id === "rate") {
      const mem = pool("snow");
      const cum = mem.map((m) => { let c = 0; return m.a.slice(s, e).map((x) => (c += x == null ? 0 : x)); });
      const raw = mem.map((m) => m.a.slice(s, e));
      if (t.id === "plume") {
        mem.forEach((m, i) => ds.push({ label: `${m.e.name}`, data: cum[i], borderColor: O.modelColor(m.ei) + "55", borderWidth: 1, pointRadius: 0, hideTip: true, order: 4 }));
        const [p10, p50, p90] = quantileSeries(mem, cum, s, e, [0.1, 0.5, 0.9]);
        ds.push({ label: "90th pct", data: p90, borderColor: fg, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, order: 1, dec: 1 });
        ds.push({ label: "Median", data: p50, borderColor: fg, borderWidth: 3.5, pointRadius: 0, order: 1, dec: 1 });
        ds.push({ label: "10th pct", data: p10, borderColor: fg, borderWidth: 2, borderDash: [2, 3], pointRadius: 0, order: 1, dec: 1 });
        base = O.chartBase({ labels, hours, nowIdx: -1, unit: "in", dec: 1, yTitle: "Snow since window start (in)", beginAtZero: true });
      } else {
        const [p50, p90] = quantileSeries(mem, raw, s, e, [0.5, 0.9]);
        ds.push({ type: "bar", label: "90th pct", data: p90, backgroundColor: O.css("--snow") + "88", order: 2, barPercentage: 1, categoryPercentage: 1, dec: 2, grouped: false });
        ds.push({ type: "bar", label: "Median", data: p50, backgroundColor: O.css("--snow-stick"), order: 1, barPercentage: 1, categoryPercentage: 1, dec: 2, grouped: false });
        base = O.chartBase({ labels, hours, nowIdx: -1, unit: "in", dec: 2, yTitle: "Snow per hour (in)", beginAtZero: true });
      }
      $("legend").innerHTML = ens.map((x) => `<span><i class="sw" style="background:${O.modelColor(ENS.indexOf(x))}"></i>${O.esc(x.name)} members</span>`).join("") +
        (t.id === "plume" ? `<span><i class="sw" style="background:${fg};height:4px"></i>Median</span><span>Dashed: 10th / 90th pct</span>` : `<span><i class="sw" style="background:var(--snow-stick);height:10px"></i>Median</span><span><i class="sw" style="background:var(--snow);height:10px"></i>90th pct</span>`);
    } else {
      const mem = pool("temp"), raw = mem.map((m) => m.a.slice(s, e));
      const [p10, p50, p90] = quantileSeries(mem, raw, s, e, [0.1, 0.5, 0.9]);
      ds.push({ label: "10th pct", data: p10, borderWidth: 0, pointRadius: 0, fill: false, order: 3 });
      ds.push({ label: "90th pct", data: p90, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), order: 3 });
      ds.push({ label: "Median", data: p50, borderColor: fg, borderWidth: 3, pointRadius: 0, tension: 0.25, order: 1 });
      ds.push({ label: "32°F", data: times.map(() => 32), borderColor: O.css("--cold"), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, hideTip: true, order: 2 });
      base = O.chartBase({ labels, hours, nowIdx: -1, unit: "°F", yTitle: "°F" });
      $("legend").innerHTML = `<span><i class="sw" style="background:${fg};height:4px"></i>Median</span><span><i class="sw" style="background:var(--band);height:10px"></i>10–90% range</span><span><i class="sw" style="background:var(--cold)"></i>Freezing</span>`;
    }
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
  }

  render();
  run();
})();
