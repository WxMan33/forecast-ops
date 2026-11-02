/* Thunder: hour-by-hour model thunder signal on the Heads-Up color scale. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core;
  O.shell("thunder", "Thunder");

  /* Models, variables and request settings are shared with the overview: OpsCore.config.thunder */
  const SPEC = C.config.thunder, MODELS = SPEC.models;
  const NAMES = Object.fromEntries(MODELS.map((m) => [m.id, m.name]));
  const TABS = [
    { id: "cape", label: "CAPE", v: "cape", unit: "J/kg", zero: true, sub: "Convective available potential energy. Above about 1000 J/kg is enough for robust storms if something sets them off." },
    { id: "li", label: "Lifted index", v: "lifted_index", unit: "°C", dec: 0, sub: "Negative means unstable. −3 to −6 is moderately unstable, below −6 strongly unstable." },
    { id: "cin", label: "CIN", v: "convective_inhibition", unit: "J/kg", zero: true, sub: "The cap. Larger values hold storms back until it erodes or is broken." },
    { id: "shear", label: "Deep-layer shear", v: "shear", unit: "kt", zero: true, sub: "Vector wind difference, 10 m to 500 hPa, as a stand-in for 0–6 km shear. About 30 kt or more favors organized storms. SEVERE has the full profile." },
    { id: "pop", label: "Precip chance", v: "precipitation_probability", unit: "%", min: 0, max: 100, sub: "Model precipitation probability, where the model provides it." },
    { id: "nwst", label: "NWS thunder chance", v: "thunder", unit: "%", min: 0, max: 100, nwsOnly: true, sub: "NWS gridded probability of thunder for each hour, from the forecast office. Shown separately; it is not part of the model signal above." },
    { id: "ltg", label: "Lightning potential", v: "lightning_potential", unit: "J/kg", zero: true, sub: "ICON's lightning potential index. Only ICON carries it, so other models show nothing here." },
  ];
  const CODE = (c) => (c == null ? "—" : c >= 95 ? "THUNDER" : c >= 71 && c <= 86 && !(c >= 80 && c <= 82) ? "SNOW" : c >= 51 ? "RAIN" : c === 45 || c === 48 ? "FOG" : "DRY");

  let data = null, chart = null, sel = null, fresh = false, tab = O.store.get("ops_thunder_tab", "cape");
  const picker = O.modelPicker($("models"), "ops_thunder_models", MODELS, render);
  const showLines = O.linesToggle($("linesBtn"), "ops_thunder_lines", () => renderChart());
  O.locationCard($("locCard"), () => run());
  O.eventCard($("evCard"));
  O.onEvent(() => render());
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

  async function run() {
    $("runBtn").disabled = true; O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${MODELS.length} models…`;
    const [res, nw] = await Promise.all([O.Data.loadModels(SPEC, { lat: O.location.lat, lon: O.location.lon, days: +$("days").value }), O.Data.loadNWS({ lat: O.location.lat, lon: O.location.lon })]);
    $("runBtn").disabled = false;
    MODELS.forEach((m) => picker.setStatus(m.id, res.status[m.id] === "ok" ? "ok" : "none"));
    picker.redraw();
    if (res.empty) {
      data = null; O.setChip("NO DATA", "err"); O.headline({ tier: "nodata" });
      $("runMsg").className = "msg err"; $("runMsg").textContent = "Couldn't reach Open-Meteo. Check your connection and try again.";
      render(); return;
    }
    data = res;
    data.nws = nw; data.nwsAxis = nw && nw.ok ? C.nws.onAxis(nw, data.ms) : null;
    O.dataStatus([...res.problems, ...(nw && nw.ok ? [] : [`NWS: ${nw ? nw.reason : "unavailable"}`])]);
    $("runMsg").textContent = `${Object.keys(res.models).length} models loaded` + (res.problems.length ? ` · ${res.problems.join(" · ")}` : "") + ` · times in ${O.tzShort(data.tz)}`;
    sel = null; fresh = true;
    render();
  }

  const active = (v) => (data ? MODELS.filter((m) => data.models[m.id] && picker.on(m.id) && O.hasData(data.models[m.id].h[v])) : []);
  const blend = (v) => { const ms = active(v); return O.blendSeries(ms.map((m) => ({ w: picker.w(m.id), data: data.models[m.id].h[v] })), data.times.length); };

  /* Same hourly aggregation the overview uses. */
  function compute() {
    const H = C.thunder.hourly(data, picker.weights());
    return { ...H, tiers: H.assess, perModel: H.ids.map((id) => ({ m: MODELS.find((x) => x.id === id), tiers: H.perModel[id] })) };
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
    const ctx = O.eventContext(data); data.ctx = ctx;
    const inP = (w) => w.L.idx;
    O.eventTable($("eventCard"), ctx, [
      { label: "Signal", cell: (w) => { const a = inP(w).map((i) => Cx.tiers[i]), lim = a.filter((x) => x.limited && x.tier !== "nodata"); return O.badge({ tier: O.maxTier(a.map((x) => x.tier)), limited: lim.length > 0, missing: [...new Set(lim.flatMap((x) => x.missing))] }); } },
      { label: "First marginal+", cell: (w) => { const i = inP(w).find((k) => O.TIER[Cx.tiers[k].tier].rank >= 1); return i == null ? "—" : O.fmtLocal(O.Core.time.toLocal(ctx.inst.ms[i], ctx.ev.tz), false); } },
      { label: "Thunder share max", cell: (w) => { const v = inP(w).map((i) => Cx.frac[i]).filter((x) => x != null); return v.length ? Math.round(Math.max(...v) * 100) + "%" : "—"; } },
      { label: "CAPE max (any model)", cell: (w) => { const v = inP(w).map((i) => Cx.cape.max[i]).filter((x) => x != null); return v.length ? Math.round(Math.max(...v)).toLocaleString() : "—"; } },
      { label: "Precip chance max", cell: (w) => { const v = inP(w).map((i) => Cx.pop.mean[i]).filter((x) => x != null); return v.length ? Math.round(Math.max(...v)) + "%" : "—"; } },
      ...(data.nwsAxis ? [{ label: "NWS thunder chance (hourly)", cell: (w) => { const v = inP(w).map((i) => data.nwsAxis.thunder[i]); return v.some((x) => x == null) ? "—" : `<span title="Range of NWS hourly thunder probabilities in this phase; not a probability for the whole phase.">${Math.min(...v)}–${Math.max(...v)}%</span>`; } }] : []),
    ], { note: "Model thunder signal during each phase. Detected lightning and clearance decisions stay in Heads-Up." });
    const now = Math.max(0, O.nowIdx(data)), end = Math.min(data.times.length, now + 24);
    const next = Cx.tiers.slice(now, end).map((a) => a.tier), worst = O.maxTier(next), firstIdx = next.findIndex((t) => t === worst);
    const ltd = Cx.tiers.slice(now, end).filter((a) => a.limited && a.tier !== "nodata").length;
    if (sel == null) sel = O.TIER[worst].rank >= 1 ? now + firstIdx : now;
    drawStrip(Cx);

    const capeWin = Cx.cape.max.slice(now, end).filter((x) => x != null), peak = capeWin.length ? Math.max(...capeWin) : null;
    const frWin = Cx.frac.slice(now, end).filter((x) => x != null), frMax = frWin.length ? Math.max(...frWin) : null;
    O.headline({
      tier: worst, note: `Model thunder signal · next 24 h${ltd ? ` · limited data ${ltd} h` : ""}`,
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
      const t = O.maxTier(d.idx.map((i) => Cx.tiers[i].tier));
      const hot = d.idx.filter((i) => O.TIER[Cx.tiers[i].tier].rank >= 2);
      const lim = d.idx.filter((i) => Cx.tiers[i].limited && Cx.tiers[i].tier !== "nodata");
      const miss = [...new Set(lim.flatMap((i) => Cx.tiers[i].missing))];
      return { d, t, hot, lim, miss, win: C.time.windowKey(data.times, d.idx), fr: mx(Cx.frac, d.idx), capeB: mx(Cx.cape.mean, d.idx), capeX: mx(Cx.cape.max, d.idx), li: mn(Cx.li.mean, d.idx), sh: mx(Cx.sh.mean, d.idx) };
    });
    $("daily").innerHTML = `<thead><tr><th>Day</th><th>Signal</th><th>Elevated+ hours</th><th>Window</th><th>Blend CAPE max</th><th>Any-model CAPE max</th><th>Min LI</th><th>Max shear</th><th>Thunder share max</th></tr></thead><tbody>` +
      dayRows.map((r) => {
        const win = r.hot.length ? `${O.fmtHour(O.hourOf(data.times[r.hot[0]]))}–${O.fmtHour((O.hourOf(data.times[r.hot[r.hot.length - 1]]) + 1) % 24)}` : "—";
        return `<tr><td class="display" style="font-size:12px">${O.fmtDay(r.d.k)}</td><td>${O.badge({ tier: r.t, limited: r.lim.length > 0, missing: r.miss })}</td>` +
          `<td class="num">${r.hot.length}</td><td class="num">${win}</td><td class="num">${f(r.capeB, 0)}</td><td class="num">${f(r.capeX, 0)}</td>` +
          `<td class="num">${f(r.li, 1)}</td><td class="num">${f(r.sh, 0, " kt")}</td><td class="num">${r.fr == null ? "—" : Math.round(r.fr * 100) + "%"}</td></tr>`;
      }).join("") + "</tbody>";

    if (fresh) {
      const snap = { cfg: C.config.fingerprint(picker.weights()), rows: {} };
      dayRows.forEach((r) => (snap.rows[r.d.k] = { label: O.fmtDay(r.d.k), win: r.win, contrib: Cx.ids, t: r.t, fr: r.fr == null ? null : r.fr * 100, cape: r.capeX }));
      data.snapPair = O.trackChanges("thunder", snap); fresh = false;
    }
    O.renderChanges($("changes"), data.snapPair, [
      { k: "t", label: "signal", tier: true },
      { k: "fr", label: "thunder share", min: 20, fmt: (v) => `${Math.round(v)}%` },
      { k: "cape", label: "peak CAPE", min: 500, fmt: (v) => `${Math.round(v)}` },
    ], NAMES);
    renderChart();
  }

  function drawStrip(Cx) {
    const rows = [{ name: "BLEND", color: O.css("--text"), tiers: Cx.tiers, bold: true }]
      .concat(Cx.perModel.map((p) => ({ name: p.m.name, color: O.modelColor(MODELS.indexOf(p.m)), tiers: p.tiers })));
    O.tierStrip($("strip"), data.times, rows, { nowIdx: O.nowIdx(data), sel, bands: O.eventBands(data.ctx), onPick: (i) => { sel = i; drawStrip(data.C); renderChart(); $("strip").querySelector(".strip-scroll").focus(); } });
    drawDetail(Cx);
  }

  function drawDetail(Cx) {
    const i = sel, t = Cx.tiers[i];
    const ms = Cx.perModel.map((p) => p.m);
    $("detail").innerHTML = `<div class="detail">
      <div class="detail-head"><span class="when">${O.fmtDay(O.dayOf(data.times[i]))} · ${O.fmtHour(O.hourOf(data.times[i]))} ${O.tzShort(data.tz)}</span>${O.badge(t)}</div>
      <div class="tiles">
        <div class="tile"><span class="k">Thunder share</span><span class="v">${Cx.frac[i] == null ? "—" : Math.round(Cx.frac[i] * 100) + "%"}</span><span class="s">of model weight</span></div>
        <div class="tile"><span class="k">CAPE blend</span><span class="v">${f(Cx.cape.mean[i], 0)}</span><span class="s">range ${f(Cx.cape.min[i], 0)}–${f(Cx.cape.max[i], 0)} J/kg</span></div>
        <div class="tile"><span class="k">Precip chance</span><span class="v">${f(Cx.pop.mean[i], 0, "%")}</span><span class="s">blend</span></div>
        <div class="tile"><span class="k">Lifted index</span><span class="v">${f(Cx.li.mean[i], 1)}</span><span class="s">°C, blend</span></div>
        <div class="tile"><span class="k">Deep shear</span><span class="v">${f(Cx.sh.mean[i], 0, " kt")}</span><span class="s">10 m–500 hPa</span></div>
        <div class="tile nwscol"><span class="k"><span class="src-nws">NWS</span> thunder chance</span><span class="v">${data.nwsAxis && data.nwsAxis.thunder[i] != null ? data.nwsAxis.thunder[i] + "%" : "—"}</span><span class="s">this hour, NWS grid</span></div>
      </div>
      <div class="tablewrap"><table><thead><tr><th>Model</th><th>Weather</th><th>CAPE</th><th>Precip chance</th><th>Signal</th></tr></thead><tbody>${ms.map((m) => {
        const a = data.models[m.id].h, c = a.weather_code ? a.weather_code[i] : null, p = Cx.perModel.find((x) => x.m === m);
        return `<tr><td><span class="sw" style="background:${O.modelColor(MODELS.indexOf(m))};margin-right:6px"></span>${O.esc(m.name)}</td><td class="num"${c >= 95 ? ' style="color:var(--prepare);font-weight:800"' : ""}>${CODE(c)}</td><td class="num">${f(a.cape ? a.cape[i] : null, 0)}</td><td class="num">${f(a.precipitation_probability ? a.precipitation_probability[i] : null, 0, "%")}</td><td>${O.badge(p.tiers[i])}</td></tr>`;
      }).join("")}</tbody></table></div></div>`;
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    $("chartTitle").textContent = t.label; $("chartSub").textContent = t.sub;
    const ms = t.nwsOnly ? [] : active(t.v), B = blend(t.nwsOnly ? "__none" : t.v), labels = O.hourLabels(data.times, data.ms, data.tz), hours = data.times.map(O.hourOf), fg = O.css("--text");
    const ds = [];
    if (ms.length > 1) {
      ds.push({ label: "min", data: B.min, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true, hideTip: true, order: 5 });
      ds.push({ label: "spread", data: B.max, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), spanGaps: true, hideTip: true, order: 5 });
    }
    if (showLines() || ms.length === 1) ms.forEach((m) => ds.push(O.modelLine(m.name, data.models[m.id].h[t.v], O.modelColor(MODELS.indexOf(m)))));
    if (ms.length > 1) ds.push({ label: "BLEND", data: B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 1 });
    if (t.nwsOnly) {
      const v = data.nwsAxis ? data.nwsAxis[t.v] : null;
      if (v && v.some((x) => x != null)) ds.push({ label: "NWS thunder chance", data: v, borderColor: O.css("--ev"), backgroundColor: "rgba(253,230,138,.18)", fill: true, borderWidth: 2.5, borderDash: [7, 4], pointRadius: 0, stepped: "before", spanGaps: false, order: 0 });
    }
    const base = O.chartBase({ labels, hours, nowIdx: O.nowIdx(data), selIdx: sel, bands: O.eventBands(data.ctx), unit: t.unit, dec: t.dec || 0, yTitle: t.unit, beginAtZero: t.zero, yMin: t.min, yMax: t.max });
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    $("legend").innerHTML = (showLines() ? ms.map((m) => `<span><i class="sw" style="background:${O.modelColor(MODELS.indexOf(m))}"></i>${O.esc(m.name)}</span>`).join("") : "") +
      (ms.length > 1 ? `<span><i class="sw" style="background:${fg};height:4px"></i>Weighted blend</span><span><i class="sw" style="background:var(--band);height:10px"></i>Model range</span>` : "") +
      (t.nwsOnly ? (data.nwsAxis ? `<span><span class="src-nws">NWS</span> hourly thunder probability (separate source)</span>` : "<span>NWS unavailable for this point.</span>") : !ms.length ? "<span>None of the checked models carry this field here.</span>" : "") + `<span>Dotted line: selected hour</span>`;
  }

  render();
  run();
})();
