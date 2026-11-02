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
    const where = { lat: O.location.lat, lon: O.location.lon };
    const [res, dt, nw] = await Promise.all([O.Data.loadEnsemble(SPEC, where), O.Data.loadModels(C.config.winterDet, { ...where, days: 5 }), O.Data.loadNWS(where)]);
    prepDet(dt, nw);
    $("runBtn").disabled = false;
    ENS.forEach((e) => picker.setStatus(e.id, res.status[e.id] === "ok" ? "ok" : "none"));
    picker.redraw();
    if (res.empty) {
      data = null; O.setChip("NO DATA", "err"); O.headline({ tier: "nodata" });
      $("runMsg").className = "msg err"; $("runMsg").textContent = "Couldn't reach the Open-Meteo ensemble API. Check your connection and try again.";
      render(); return;
    }
    data = res;
    O.dataStatus([...res.problems, ...(det ? det.problems.map((x) => `Profiles · ${x}`) : ["Profiles: deterministic models unavailable"]), ...(nwsW && nwsW.ok ? [] : [`NWS: ${nwsW ? nwsW.reason : "unavailable"}`])]);
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
    const s = Math.max(0, O.nowIdx(data) + 1), e = Math.min(data.times.length, s + (+$("win").value || 72)); return { s, e };
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
      { label: "Model precip types", cell: (w) => {
        if (!det) return "—";
        const ii = det.ms.map((m, i) => (m >= w.startMs && m <= w.endMs ? i : -1)).filter((i) => i >= 0), cnt = {};
        Object.keys(det.rows).forEach((id) => { const ts = new Set(ii.map((i) => det.rows[id][i]).filter((r) => r.wet).map((r) => r.codeType || r.split).filter((t) => t && t !== "none")); ts.forEach((t) => (cnt[t] = (cnt[t] || 0) + 1)); });
        const k = Object.keys(cnt); return k.length ? `<span title="Number of models showing each type at least once in this phase. Not a probability.">${k.map((t) => `${TYPE[t][0]} ${cnt[t]}`).join(" · ")}</span>` : '<span class="msg">no precip</span>';
      } },
      { label: "NWS snow · ice", cell: (w) => {
        const A = det && det.nwsAxis; if (!A) return "—";
        const r = (t, d) => (!t.covers ? "n/c" : t.exact ? t.lower.toFixed(d) + '"' : `${t.lower.toFixed(d)}–${t.upper.toFixed(d)}"`);
        return `${r(C.nws.totalOver(A.snow, w.startMs, w.endMs), 1)} · ${r(C.nws.totalOver(A.ice, w.startMs, w.endMs), 2)}`;
      } },
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
    renderDiag(data.ms[s], data.ms[e - 1]);
  }

  function quantileSeries(mem, arrs, n, qs) {
    const ws = mem.map((m) => m.w);
    return qs.map((qq) => { const out = []; for (let i = 0; i < n; i++) out.push(O.weightedQuantile(arrs.map((a) => a[i]), ws, qq)); return out; });
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    $("chartTitle").textContent = t.label; $("chartSub").textContent = t.sub;
    const { s, e } = windowIdx(), times = data.times.slice(s, e), n = times.length, labels = O.hourLabels(times, data.ms.slice(s, e), data.tz), hours = times.map(O.hourOf), fg = O.css("--text");
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

  /* ===================== precipitation type, profiles, amounts ===================== */
  const DET = C.config.winterDet.models, DNAMES = Object.fromEntries(DET.map((m) => [m.id, m.name]));
  const TYPE = { rain: ["RAIN", "#2DD4BF"], snow: ["SNOW", "#60A5FA"], freezing: ["FZRA", "#F472B6"], sleet: ["SLEET", "#FB923C"], mix: ["MIX", "#A78BFA"], none: ["DRY", null] };
  const T_TABS = [
    { id: "sfc", label: "Surface T / Td / wet-bulb", sub: "Blended across deterministic models (equal weight). Wet-bulb near or below 32°F with precipitation favors snow or sleet reaching the ground; dew point well below air temperature means evaporative cooling is possible." },
    { id: "lvl", label: "925 / 850 hPa", sub: "Each model's temperature at 925 and 850 hPa (solid / dashed). Above 0 °C (dotted line) aloft over a sub-freezing surface signals a melting layer." },
    { id: "nose", label: "Warm nose", sub: "Each model's warmest temperature more than 300 m above ground (below 500 hPa). Above 0 °C means a melting layer exists aloft." },
  ];
  let det = null, nwsW = null, tChart = null, selH = null, tTab = O.store.get("ops_winter_ttab", "sfc");
  T_TABS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab"); b.textContent = t.label; b.setAttribute("aria-selected", t.id === tTab);
    b.addEventListener("click", () => { tTab = t.id; O.store.set("ops_winter_ttab", tTab); document.querySelectorAll("#tTabs .tab").forEach((x) => x.setAttribute("aria-selected", x === b)); if (data) renderDiag(...lastWin); });
    $("tTabs").appendChild(b);
  });
  let lastWin = [0, 0];

  /* Per-model hourly diagnostics, computed once per load. */
  let diagLogged = false;
  function prepDet(dt, nw) {
    nwsW = nw; diagLogged = false;
    if (!dt || dt.empty) { det = null; return; }
    det = dt;
    det.rows = {};
    Object.keys(det.models).forEach((id) => { const md = det.models[id]; det.rows[id] = W.series(md.h, det.times.length, md.elev); });
    det.nwsAxis = nw && nw.ok ? C.nws.onAxis(nw, det.ms) : null;
  }

  function renderDiag(msStart, msEnd) {
    lastWin = [msStart, msEnd];
    if (!det) { $("ptCard").innerHTML = '<div class="section-title">Precipitation type &amp; transitions</div><p class="msg">Deterministic models are unavailable, so precipitation type and profiles can\'t be shown. Ensemble snow odds above are unaffected.</p>'; $("amtCard").innerHTML = ""; return; }
    const idx = det.ms.map((m, i) => (m >= msStart && m <= msEnd ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) { $("ptCard").innerHTML = '<div class="section-title">Precipitation type &amp; transitions</div><p class="msg">The deterministic models don\'t reach this window (they run 2–5 days).</p>'; $("amtCard").innerHTML = ""; return; }
    const s = idx[0], e = idx[idx.length - 1] + 1, ids = DET.map((m) => m.id).filter((id) => det.models[id]);
    if (selH == null || selH < s || selH >= e) selH = (() => { for (const id of ids) { const k = det.rows[id].findIndex((r, i) => i >= s && i < e && r.wet); if (k >= 0) return k; } return s; })();
    renderPtype(ids, s, e);
    if (!diagLogged) { logPtype(ids, s, e); diagLogged = true; }
    renderAmounts(ids, s, e);
    renderTemps(ids, s, e);
  }

  /* timeline rows: model type, NWS wording type, experimental profile type */
  function renderPtype(ids, s, e) {
    const times = det.times.slice(s, e), n = times.length, A = det.nwsAxis;
    const tpl = `grid-template-columns:150px repeat(${n},minmax(5px,1fr))`;
    const cell = (t, i, title) => { const c = t && TYPE[t] ? TYPE[t][1] : null; return `<div class="strip-cell${O.hourOf(times[i]) === 0 ? " d0" : ""}${s + i === selH ? " sel" : ""}" data-i="${s + i}" style="background:${c || "var(--raised)"}" title="${O.esc(title)}"></div>`; };
    const lab = (t) => (t ? TYPE[t][0] : "no precip");
    const head = `<div class="strip-row" style="${tpl}"><div></div>${times.map((t, i) => `<div class="strip-lab day">${O.hourOf(t) === 0 || i === 0 ? O.fmtDay(O.dayOf(t)).slice(0, 3) : ""}</div>`).join("")}</div>` +
      `<div class="strip-row" style="${tpl}"><div></div>${times.map((t) => `<div class="strip-lab">${O.hourOf(t) % 6 === 0 && O.hourOf(t) ? O.fmtHour(O.hourOf(t)) : ""}</div>`).join("")}</div>`;
    const grp = (title) => `<div class="strip-row" style="grid-template-columns:1fr"><div class="kicker" style="margin-top:6px">${title}</div></div>`;
    const modelRows = ids.map((id) => `<div class="strip-row" style="${tpl}"><div class="strip-name">${O.esc(DNAMES[id])}</div>${times.map((t, i) => { const r = det.rows[id][s + i]; const ty = r.wet ? r.codeType || r.split : null; return cell(ty === "none" ? null : ty, i, `${DNAMES[id]} · ${O.fmtWhen(t)} · ${lab(ty === "none" ? null : ty)}${r.wet ? ` · ${r.precipIn.toFixed(2)}"/h` : ""}`); }).join("")}</div>`).join("");
    const nwsRow = A ? `<div class="strip-row" style="${tpl}"><div class="strip-name bold" style="color:var(--ev)">NWS wording</div>${times.map((t, i) => { const ty = A.ptype[s + i]; const w = A.weather[s + i]; return cell(ty, i, `NWS · ${O.fmtWhen(t)} · ${w && w.length ? w.map((c) => `${c.coverage || ""} ${c.intensity || ""} ${c.weather}`.trim()).join(", ").replace(/_/g, " ") : "none"}`); }).join("")}</div>` : "";
    const profIds = ids.filter((id) => det.rows[id].some((r) => r.bour));
    const profRows = profIds.map((id) => `<div class="strip-row" style="${tpl}"><div class="strip-name">${O.esc(DNAMES[id])}${(() => { const g = Math.max(0, ...det.rows[id].map((r) => (r.covP && r.covP.lowGap) || 0)); return g > W.COVERAGE.coarseGap ? ` <span class="ltd" title="Largest gap between levels overlapping the lowest 3 km: ${Math.round(g)} m. Provisional threshold ${W.COVERAGE.coarseGap} m.">COARSE ${(g / 1000).toFixed(1)} km</span>` : ""; })()}</div>${times.map((t, i) => { const r = det.rows[id][s + i]; const ty = r.bour ? r.bour.type : null;
      return cell(ty, i, `${DNAMES[id]} profile · ${O.fmtWhen(t)} · ${ty ? `${lab(ty)}${r.bour.detail ? ` (${r.bour.detail})` : ""} · PA ${r.bour.PA.toFixed(1)}, NA ${r.bour.NA.toFixed(1)}, surface ${r.bour.sfcWarm.toFixed(1)} J/kg${r.covP && r.covP.lowGapSpan ? ` · largest gap ${Math.round(r.covP.lowGap)} m (${Math.round(r.covP.lowGapSpan[0])}–${Math.round(r.covP.lowGapSpan[1])} m)` : ""}` : r.wet ? `fails coverage checks: ${(r.bour && r.bour.unavailable ? r.bour.unavailable : (r.covP && r.covP.why) || ["no profile"]).join("; ")}` : "no precip"}`); }).join("")}</div>`).join("");
    /* transitions per model, by model type; and the spread of each transition across models */
    const tr = ids.map((id) => { const types = det.rows[id].map((r) => (r.wet ? r.codeType || r.split : null)); return { id, first: types.findIndex((x, i) => i >= s && i < e && x && x !== "none"), list: W.transitions(types, s, e) }; });
    const byKind = {};
    tr.forEach((m) => m.list.forEach((x) => { const k = `${TYPE[x.from][0]} → ${TYPE[x.to][0]}`; (byKind[k] = byKind[k] || []).push({ id: m.id, ms: det.ms[x.i] }); }));
    const loc = (ms) => O.fmtLocal(C.time.toLocal(ms, det.tz));
    const nwsTr = A ? (() => { const types = A.ptype.map((x) => x || null); return W.transitions(types, s, e).map((x) => `${TYPE[x.from][0]} → ${TYPE[x.to][0]} ${loc(det.ms[x.i])}`); })() : [];
    $("ptCard").innerHTML = `<div class="section-title">Precipitation type &amp; transitions</div>
      <p class="section-sub">Hours with precipitation (≥ 0.1 mm/h) only. Model type is each model's own weather code; the profile rows are an experimental reading of each model's temperature profile (Bourgouin method, see "Precip type methods"). <b>Click an hour</b> for the profiles. Counts of models are not probabilities.</p>
      <div class="tablewrap strip-scroll" id="ptStrip"><div class="strip">${head}${grp("Model weather code")}${modelRows}${nwsRow ? grp("NWS (official wording; can include sleet)") + nwsRow : ""}${profRows ? grp("Profile type · experimental") + profRows : ""}</div></div>
      <div class="legend">${Object.entries(TYPE).filter(([k]) => k !== "none").map(([k, [w, c]]) => `<span><i class="sw" style="background:${c};height:10px"></i>${w}</span>`).join("")}<span><i class="sw" style="background:var(--raised);height:10px;border:1px solid var(--line)"></i>No precip / not available</span></div>
      <div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Model</th><th style="text-align:left">Type changes (model weather code)</th></tr></thead><tbody>${tr.map((m) => `<tr><td>${O.esc(DNAMES[m.id])}</td><td style="text-align:left;white-space:normal">${m.first < 0 ? '<span class="msg">no precipitation in window</span>' : m.list.length ? m.list.map((x) => `${TYPE[x.from][0]} → ${TYPE[x.to][0]} <span class="mono">${loc(det.ms[x.i])}</span>`).join(" · ") : `${TYPE[(det.rows[m.id][m.first].codeType || det.rows[m.id][m.first].split)][0]} throughout`}</td></tr>`).join("")}
      ${A ? `<tr class="nwscol"><td><span class="src-nws">NWS</span></td><td style="text-align:left;white-space:normal">${nwsTr.length ? O.esc(nwsTr.join(" · ")) : '<span class="msg">no type change in NWS wording</span>'}</td></tr>` : ""}</tbody></table></div>
      ${Object.keys(byKind).length ? `<p class="msg" style="margin-top:8px">Transition timing across models: ${Object.entries(byKind).map(([k, v]) => { const t = v.map((x) => x.ms).sort((a, b) => a - b); return `<b style="color:var(--text)">${O.esc(k)}</b> ${loc(t[0])}${t.length > 1 ? ` – ${loc(t[t.length - 1])}` : ""} (${v.length} model${v.length > 1 ? "s" : ""})`; }).join(" · ")}.</p>` : ""}
      <div id="profPanel"></div>`;
    $("ptStrip").addEventListener("click", (ev) => { const c = ev.target.closest("[data-i]"); if (!c) return; selH = +c.dataset.i; renderPtype(ids, s, e); });
    renderProfile(ids);
  }

  /* temperature profiles of every model at the selected hour */
  function renderProfile(ids) {
    const i = selH, Z = 300, H = 280, top = 4000, fg = O.css("--text"), line = O.css("--line"), muted = O.css("--muted"), mono = O.css("--font-mono");
    const profs = ids.map((id) => ({ id, pts: W.profile(det.models[id].h, i, det.models[id].elev), r: det.rows[id][i] })).filter((p) => p.pts.length >= 3);
    const tmin = Math.min(-15, ...profs.flatMap((p) => p.pts.filter((q) => q.z <= top).map((q) => q.t))), tmax = Math.max(8, ...profs.flatMap((p) => p.pts.filter((q) => q.z <= top).map((q) => q.t)));
    const X = (t) => 36 + ((t - tmin) / (tmax - tmin)) * (Z - 46), Y = (z) => H - 22 - (Math.min(z, top) / top) * (H - 34);
    let svg = `<svg viewBox="0 0 ${Z} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${mono}">`;
    for (let z = 0; z <= top; z += 1000) svg += `<line x1="36" x2="${Z - 10}" y1="${Y(z)}" y2="${Y(z)}" stroke="${line}"/><text x="4" y="${Y(z) + 3}" font-size="9" fill="${muted}">${z / 1000}km</text>`;
    for (let t = Math.ceil(tmin / 5) * 5; t <= tmax; t += 5) svg += `<text x="${X(t) - 6}" y="${H - 6}" font-size="9" fill="${muted}">${t}°</text>`;
    svg += `<line x1="${X(0)}" x2="${X(0)}" y1="${Y(top)}" y2="${Y(0)}" stroke="#60A5FA" stroke-dasharray="4 3" stroke-width="1.5"/>`;
    profs.forEach((p) => { const k = ids.indexOf(p.id); svg += `<polyline points="${p.pts.filter((q) => q.z <= top + 400).map((q) => `${X(q.t).toFixed(1)},${Y(q.z).toFixed(1)}`).join(" ")}" fill="none" stroke="${O.modelColor(k)}" stroke-width="2"/>`; });
    svg += `<text x="40" y="12" font-size="9" fill="${muted}">°C vs height above ground · 0 °C dashed</text></svg>`;
    const f1 = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
    $("profPanel").innerHTML = `<div class="detail"><div class="detail-head"><span class="when">${O.fmtDay(O.dayOf(det.times[i]))} · ${O.fmtHour(O.hourOf(det.times[i]))} ${C.time.abbr(det.ms[i], det.tz)}</span><span class="msg">temperature profiles, deterministic models</span></div>
      <div class="hodo-wrap"><div class="hodo" style="aspect-ratio:auto;height:${H}px">${svg}</div>
      <div class="tablewrap"><table><thead><tr><th>Model</th><th>Sfc T</th><th>Wet-bulb</th><th>Dew pt</th><th>Warm nose</th><th>Warm layer</th><th>Cold layer</th><th>Model type</th><th>Profile type</th><th>Kuchera</th></tr></thead><tbody>${ids.map((id, k) => { const r = det.rows[id][i], st = r.st || {};
        return `<tr><td><span class="sw" style="background:${O.modelColor(k)};margin-right:6px"></span>${O.esc(DNAMES[id])}</td><td class="num">${f1(r.t2F, 0, "°")}</td><td class="num">${f1(r.twF, 0, "°")}</td><td class="num">${f1(r.tdF, 0, "°")}</td>` +
          `<td class="num">${st.maxAloftT == null ? "—" : `${st.maxAloftT.toFixed(1)}°C`}</td><td class="num">${st.warmDepth == null ? "—" : `${Math.round(st.warmDepth)} m`}</td><td class="num">${st.coldDepth == null ? "—" : `${Math.round(st.coldDepth)} m`}</td>` +
          `<td>${r.wet && r.codeType && r.codeType !== "none" ? `<span class="pt" style="--c:${TYPE[r.codeType][1]}">${TYPE[r.codeType][0]}</span>` : '<span class="msg">no precip</span>'}</td><td>${r.bour && r.bour.type ? `<span class="pt" style="--c:${TYPE[r.bour.type][1]}" title="${O.esc(r.bour.detail || "")}">${TYPE[r.bour.type][0]}</span>${r.bour.coarse ? ` <span class="ltd" title="Largest gap overlapping the lowest 3 km (provisional threshold ${W.COVERAGE.coarseGap} m)">COARSE ${Math.round(r.covP.lowGap)} m</span>` : ""}` : `<span class="msg" title="${O.esc(((r.covP && r.covP.why) || []).join("; "))}">${r.covP && !r.covP.pass && r.covP.why.length ? "fails checks" : "—"}</span>`}</td><td class="num">${r.kuchera == null ? `<span class="msg" title="${O.esc(((r.covK && r.covK.why) || []).join("; ") || "needs a profile that passes the Kuchera coverage checks")}">—</span>` : `${r.kuchera.toFixed(0)}:1${r.covK && r.covK.coarse ? ` <span class="ltd" title="Largest low-level gap ${Math.round(r.covK.lowGap)} m">COARSE</span>` : ""}`}</td></tr>`; }).join("")}</tbody></table></div></div>
      <p class="msg">Warm nose: warmest temperature more than 300 m above ground. Warm layer: depth of the above-freezing layer aloft. Cold layer: depth of the sub-freezing layer beneath it. Models without levels (NBM, NAM) show surface values only.</p></div>`;
  }

  /* Record, per hour with precipitation, what each source says about type, for later review of where
     model codes, NWS wording and the experimental profile reading agree or diverge. */
  function logPtype(ids, s, e) {
    const at = new Date().toISOString(), loc = { lat: O.location.lat, lon: O.location.lon, name: O.location.name }, recs = [], A = det.nwsAxis;
    for (let i = s; i < e; i++) {
      const vals = {};
      ids.forEach((id) => { const r = det.rows[id][i]; if (r.wet) { vals[`code:${id}`] = r.codeType || null; if (r.bour) vals[`profile:${id}`] = r.bour.type ? `${r.bour.type}${r.bour.detail ? ` (${r.bour.detail})` : ""}` : "fails checks"; } });
      if (A && A.ptype[i]) vals.nws = A.ptype[i];
      if (!Object.keys(vals).length) continue;
      recs.push(C.verify.record({ kind: "ptype-hour", source: "winter-compare", location: loc, retrievedAt: at,
        cycle: nwsW && nwsW.ok && nwsW.status.updated.grid ? new Date(nwsW.status.updated.grid).toISOString() : null,
        window: { key: new Date(det.ms[i]).toISOString(), tz: det.tz }, contributors: ids, values: vals }));
    }
    O.logVerify(recs);
  }

  /* snow amounts kept distinct: as reported, water, 10:1, Kuchera; NWS separately */
  function renderAmounts(ids, s, e) {
    const A = det.nwsAxis, msS = det.ms[s] - 3600e3, msE = det.ms[e - 1];
    const f2 = (x, d = 1) => (x == null ? "—" : x.toFixed(d) + '"');
    const rows = ids.map((id) => {
      const t = W.scenarioTotals(det.rows[id], s, e);
      if (t) { const snowRows = det.rows[id].slice(s, e).filter((r) => r.swe > 0); t.coarse = snowRows.some((r) => r.covK && r.covK.coarse); const bad = snowRows.find((r) => r.covK && !r.covK.pass); t.kWhy = bad ? bad.covK.why.join("; ") : ""; }
      return { id, t };
    });
    const ns = A ? C.nws.totalOver(A.snow, msS, msE) : null, ni = A ? C.nws.totalOver(A.ice, msS, msE) : null;
    const rng = (t, d) => (!t || !t.covers ? '<span class="msg">not covered</span>' : t.exact ? `${t.lower.toFixed(d)}"` : `${t.lower.toFixed(d)}–${t.upper.toFixed(d)}"`);
    $("amtCard").innerHTML = `<div class="section-title">Snow amounts: kept separate on purpose</div>
      <p class="section-sub">${O.fmtWhen(det.times[s])} to ${O.fmtWhen(det.times[e - 1])}, deterministic models. <b>As reported</b> is the model's snowfall at Open-Meteo's fixed 7:1 depth-to-water ratio. <b>10:1</b> and <b>Kuchera</b> (experimental) re-scale the same snow water; neither turns the model's rain into snow. None of these is ground or road accumulation: melting, compaction and warm pavement are not modelled.</p>
      <div class="tablewrap"><table><thead><tr><th>Source</th><th>As reported (7:1)</th><th>Snow water</th><th>10:1</th><th>Kuchera (exp.)</th><th>Snow hours on warm ground</th></tr></thead><tbody>
      ${rows.map(({ id, t }) => `<tr><td>${O.esc(DNAMES[id])}</td>${t ? `<td class="num">${f2(t.reported)}</td><td class="num">${f2(t.swe, 2)}</td><td class="num">${f2(t.ten)}</td><td class="num">${t.kuchera != null ? `${f2(t.kuchera)}${t.coarse ? ' <span class="ltd" title="Some snow hours used profiles with a gap over ${W.COVERAGE.coarseGap} m overlapping the lowest 3 km (provisional threshold)">COARSE</span>' : ""}` : `<span class="msg" title="${O.esc(t.kWhy || "")}">${t.kWhy ? "fails coverage checks" : "no profile"}</span>`}</td><td class="num">${t.warmHours || "—"}</td>` : '<td colspan="5" class="msg" style="text-align:left">data doesn\'t cover the whole window</td>'}</tr>`).join("")}
      ${A ? `<tr class="nwscol"><td><span class="src-nws">NWS</span> snowfall / ice</td><td class="num" colspan="2">snow ${rng(ns, 1)}</td><td class="num" colspan="3">ice accretion ${rng(ni, 2)}</td></tr>` : ""}
      </tbody></table></div>
      <p class="msg">Kuchera is shown only when the profile passes its own coverage checks (surface, first level within 1500 m, through 500 hPa, no gap over 1800 m). Passing does not mean every warm layer was resolved. COARSE marks a gap over 1000 m overlapping the lowest 3 km (provisional threshold), where a warm layer could be smoothed out. Warm-ground hours: hours with model snow while the 2 m temperature is above 33°F or the model's 0 cm soil temperature is above freezing (soil temperature only from ECMWF, ICON and UKMO). Expect less accumulation in those hours. NWS amounts are its own interval totals: a range when an interval straddles the window edge. For snow odds and the spread of totals, use the ensemble table above.</p>`;
  }

  /* surface / level / warm-nose charts */
  function renderTemps(ids, s, e) {
    const t = T_TABS.find((x) => x.id === tTab) || T_TABS[0];
    $("tTitle").textContent = t.label; $("tSub").textContent = t.sub;
    const times = det.times.slice(s, e), labels = O.hourLabels(times, det.ms.slice(s, e), det.tz), hours = times.map(O.hourOf), fg = O.css("--text");
    const ds = []; let unit = "°F";
    const sl = (a) => a.slice(s, e);
    if (t.id === "sfc") {
      const B = (k) => O.blendSeries(ids.map((id) => ({ w: 1, data: det.rows[id].map((r) => r[k]) })), det.times.length).mean;
      ds.push({ label: "Temperature", data: sl(B("t2F")), borderColor: O.css("--warm"), borderWidth: 2.5, pointRadius: 0, tension: 0.2 });
      ds.push({ label: "Wet-bulb", data: sl(B("twF")), borderColor: fg, borderWidth: 2.5, pointRadius: 0, tension: 0.2 });
      ds.push({ label: "Dew point", data: sl(B("tdF")), borderColor: O.css("--cold"), borderWidth: 2, pointRadius: 0, tension: 0.2 });
      if (det.nwsAxis) ds.push({ label: "NWS temperature", data: sl(det.nwsAxis.temperature_2m), borderColor: O.css("--ev"), borderWidth: 2, borderDash: [7, 4], pointRadius: 0 });
      ds.push({ label: "32°F", data: times.map(() => 32), borderColor: "#60A5FA", borderWidth: 1.25, borderDash: [3, 3], pointRadius: 0, hideTip: true });
    } else if (t.id === "lvl") {
      unit = "°C";
      ids.forEach((id, k) => { const h = det.models[id].h; if (O.hasData(h.temperature_925hPa)) ds.push(O.modelLine(`${DNAMES[id]} 925`, sl(h.temperature_925hPa), O.modelColor(k))); if (O.hasData(h.temperature_850hPa)) ds.push(O.modelLine(`${DNAMES[id]} 850`, sl(h.temperature_850hPa), O.modelColor(k), { borderDash: [5, 3] })); });
      ds.push({ label: "0 °C", data: times.map(() => 0), borderColor: "#60A5FA", borderWidth: 1.25, borderDash: [3, 3], pointRadius: 0, hideTip: true });
    } else {
      unit = "°C";
      ids.forEach((id, k) => { const v = sl(det.rows[id].map((r) => (r.st ? r.st.maxAloftT : null))); if (v.some((x) => x != null)) ds.push(O.modelLine(DNAMES[id], v, O.modelColor(k))); });
      ds.push({ label: "0 °C", data: times.map(() => 0), borderColor: "#60A5FA", borderWidth: 1.25, borderDash: [3, 3], pointRadius: 0, hideTip: true });
    }
    const base = O.chartBase({ labels, hours, nowIdx: O.nowIdx(det) - s, selIdx: selH - s, unit, dec: unit === "°C" ? 1 : 0, yTitle: unit });
    if (tChart) tChart.destroy();
    tChart = new Chart($("tChart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    $("tLegend").innerHTML = ds.filter((d) => !d.hideTip).slice(0, 14).map((d) => `<span><i class="sw" style="background:${d.borderColor}"></i>${O.esc(d.label)}</span>`).join("") + (t.id === "sfc" ? "<span>Equal-weight blend of deterministic models</span>" : "");
  }

  render();
  run();
})();
