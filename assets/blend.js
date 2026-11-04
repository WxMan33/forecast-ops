/* Model Blend: weighted point forecast from deterministic models, ensembles (ECMWF ENS, GEFS) and the
   NWS point forecast, each with its own adjustable weight; source comparison shows what drives it. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core, N = C.nws;
  const initialBrief = new URLSearchParams(location.search).get("view") === "brief";
  O.shell("blend", "Model Blend");
  const focus = window.ForecastFocus.mount({ O, C, initialBrief });

  /* Models, variables and request settings are shared with the overview: OpsCore.config.blend */
  const SPEC = C.config.blend, MODELS = SPEC.models, SOURCES = [...SPEC.extra, ...MODELS];
  const TABS = [
    { id: "temp", label: "Temperature", v: "temperature_2m", unit: "°F", nws: true },
    { id: "dew", label: "Dew point", v: "dew_point_2m", unit: "°F", nws: true },
    { id: "feel", label: "Feels like", v: "apparent_temperature", unit: "°F", nws: true },
    { id: "pop", label: "Precip chance", v: "precipitation_probability", unit: "%", min: 0, max: 100, nws: true },
    { id: "qpf", label: "Precip (accum.)", v: "precipitation", unit: "in", accum: true, dec: 2, nwsAcc: "qpf" },
    { id: "snow", label: "Snow (accum.)", v: "snowfall", unit: "in", accum: true, dec: 1, nwsAcc: "snow" },
    { id: "wind", label: "Wind", v: "wind_speed_10m", unit: "mph", zero: true, nws: true },
    { id: "gust", label: "Gusts", v: "wind_gusts_10m", unit: "mph", zero: true, nws: true },
    { id: "cloud", label: "Cloud cover", v: "cloud_cover", unit: "%", min: 0, max: 100, nws: true },
  ];
  const NAMES = Object.fromEntries(SOURCES.map((m) => [m.id, m.name]));
  const RANGES = [["event", "EVENT"], ["48", "48 H"], ["72", "72 H"], ["168", "7 D"], ["all", "ALL"]];
  const NWS_COLOR = () => (O.css("--ev") || "#FDE68A");

  /* Settings migration: existing saved weights become the "Custom weights" preset, untouched. */
  if (O.store.get("ops_blend_cfg_v", 1) < 2) {
    const had = O.store.get("ops_blend_models", null);
    O.store.set("ops_blend_cfg_v", 2);
    if (had) O.store.set("ops_blend_migrated", new Date().toISOString());
  }
  /* v3: ensembles and NWS join the blend; the stated preference becomes the default view once. */
  if (O.store.get("ops_blend_cfg_v", 1) < 3) { O.store.set("ops_blend_cfg_v", 3); O.store.set("ops_blend_preset", "preferred"); O.store.set("ops_blend_v3", new Date().toISOString()); }
  let preset = O.store.get("ops_blend_preset", "preferred");
  if (!C.blend.PRESETS[preset]) preset = "preferred";

  let data = null, nws = null, chart = null, viewDay = null, fresh = false;
  let tab = O.store.get("ops_blend_tab", "temp"), range = O.store.get("ops_blend_range", "168");

  const picker = O.modelPicker($("models"), "ops_blend_models", SOURCES, render, { title: "Custom weights", max: 5 });
  const showLines = O.linesToggle($("linesBtn"), "ops_blend_lines", () => renderChart());
  O.locationCard($("locCard"), () => run());
  O.eventCard($("evCard"));
  O.onEvent(() => render());
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
  mkTabs($("presetTabs"), Object.entries(C.blend.PRESETS).map(([k, p]) => [k, p.label.toUpperCase()]), preset, (id) => { preset = id; O.store.set("ops_blend_preset", id); fresh = true; render(); });
  window.addEventListener("ops:theme", () => { picker.redraw(); render(); });

  async function run() {
    $("runBtn").disabled = true;
    O.setChip("FETCHING…");
    $("runMsg").className = "msg"; $("runMsg").textContent = `Requesting ${MODELS.length} models, ECMWF ENS, GEFS, RRFS ensemble and the NWS point forecast…`;
    const where = { lat: O.location.lat, lon: O.location.lon }, days = +$("days").value;
    const [res, nw, en] = await Promise.all([O.Data.loadModels(SPEC, { ...where, days }), O.Data.loadNWS(where),
      O.Data.loadEnsemble(C.config.blendEns, { ...where, days }).catch(() => ({ empty: true, problems: ["ensembles unavailable"], status: {} }))]);
    $("runBtn").disabled = false;
    if (!res.empty) C.blend.addSources(res, en, nw && nw.ok ? N.onAxis(nw, res.ms) : null);
    SOURCES.forEach((m) => picker.setStatus(m.id, !res.empty && res.models[m.id] ? "ok" : "none"));
    picker.redraw();
    nws = nw;
    if (res.empty) {
      data = null;
      O.setChip("NO DATA", "err");
      $("runMsg").className = "msg err";
      $("runMsg").textContent = "Couldn't reach Open-Meteo. Check your connection and try again.";
      O.headline({ tier: "nodata", word: "NO DATA" });
      render();
      return;
    }
    data = res;
    data.viewedAt = Date.now();
    data.nwsAxis = nws && nws.ok ? N.onAxis(nws, data.ms) : null;
    const ensProb = C.config.blendEns.models.filter((m) => !data.models[m.source]).map((m) => `${m.name}: unavailable`);
    O.dataStatus([...res.problems, ...ensProb, ...(nws && !nws.ok ? [`NWS: ${nws.reason}`] : nws && nws.errors && nws.errors.length ? nws.errors.map((x) => `NWS ${x}`) : [])]);
    const ensTxt = C.config.blendEns.models.filter((m) => data.models[m.source]).map((m) => `${m.name} ${data.models[m.source].n}`).join(", ");
    $("runMsg").textContent = `${MODELS.filter((m) => res.models[m.id]).length} models` + (ensTxt ? ` · ensembles ${ensTxt} members` : " · ensembles unavailable") + (res.problems.length ? ` · ${res.problems.join(" · ")}` : "") +
      ` · NWS ${nws && nws.ok ? `${nws.office} grid ${nws.gridX},${nws.gridY}` : "unavailable"} · times in ${O.tzShort(data.tz)}`;
    const native = Object.entries(data.models).filter(([,m]) => m.provenance && m.provenance.provider === "NOAA native GRIB2");
    if (native.length) $("runMsg").textContent += ` · RRFS: NOAA native CVG grid, ${native[0][1].provenance.cycle.slice(0,16).replace("T"," ")} UTC; temperature/precip/snow only; no elevation adjustment`;
    fresh = true; meta = null; loadMeta();
    render();
  }

  /* ---------- source contributions by forecast day (point blend transparency) ---------- */
  let meta = null, covVar = O.store.get("ops_cov_var", "hi"), covMode = O.store.get("ops_cov_mode", "share");
  async function loadMeta() {
    const ids = Object.fromEntries(Object.entries(C.config.metaIds).filter(([id]) => data && data.models[id] && !(data.models[id].provenance && data.models[id].provenance.provider === "NOAA native GRIB2")));
    try { meta = await O.Data.loadModelMeta(ids); } catch (e) { meta = {}; }
    if (data) renderCoverage();
  }
  const SEAMLESS = new Set(["gfs_seamless", "icon_seamless", "gem_seamless", "ukmo_seamless", "meteofrance_seamless", "jma_seamless"]);
  const utc = (iso) => (iso ? `${iso.slice(5, 10).replace("-", "/")} ${iso.slice(11, 13)}Z` : "—");
  function runCell(id) {
    const md = data.models[id];
    if (!md) return '<span class="msg">—</span>';
    if (md.provenance && md.provenance.provider === "NOAA native GRIB2")
      return `<b>${utc(md.provenance.cycle)}</b> <span class="cyc conf">confirmed</span><div class="msg">NOAA GRIB2 init; feed built ${utc(md.provenance.generatedAt)}</div>`;
    if (id === "nws") { const u = nws && nws.status && nws.status.updated && nws.status.updated.grid; return u ? `updated ${O.esc(local(u))} <span class="cyc conf">from NWS</span><div class="msg">issuance, not a model run</div>` : '<span class="msg">update time unavailable</span>'; }
    const m = meta && meta[id];
    if (!meta) return '<span class="msg">checking…</span>';
    if (!m || m.error) return '<span class="msg">no run information</span>';
    return `${utc(m.lastRunInit)} <span class="cyc rep">provider-reported</span>${SEAMLESS.has(id) ? '<div class="msg">seamless: combines runs</div>' : ""}`;
  }
  function renderCoverage() {
    const el = $("covCard"); if (!el) return;
    if (!data) { el.innerHTML = ""; return; }
    const req = C.blend.presetWeights(preset, SPEC, picker.weights());
    const cov = C.blend.coverage(data, req, W(), OPTS());
    const V = C.blend.VARS.find((v) => v.key === covVar) || C.blend.VARS[1];
    const ids = SOURCES.map((m) => m.id).filter((id) => C.blend.w(req, R(), id, V.hv) > 0);
    const unit = V.key === "qpf" ? '"' : "°", dec = V.key === "qpf" ? 2 : 1;
    const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toFixed(dec) + unit;
    const REASON = { unavailable: "unavailable", "beyond-horizon": "past horizon", partial: "partial", "no-data": "no data", excluded: "not used" };
    const cell = (day, id) => {
      const v = day.vars[V.key], c = v.contributors.find((x) => x.id === id), miss = v.missing.find((x) => x.id === id);
      const left = day.changes[V.key] && day.changes[V.key].left.includes(id), joined = day.changes[V.key] && day.changes[V.key].joined.includes(id);
      if (c) {
        const main = covMode === "effect" ? (c.effect == null ? '<span class="msg">n/a</span>' : sgn(c.effect)) : `${Math.round(c.share * 100)}%`;
        const tip = `${NAMES[id] || id}: ${(c.share * 100).toFixed(1)}% of the ${V.label.toLowerCase()} weight; its own value ${c.v.toFixed(dec)}${unit}` + (c.effect != null ? `; blend ${sgn(c.effect)} versus the same blend without it (${c.withoutValue.toFixed(dec)}${unit})` : c.onlySource ? "; only source, no comparison possible" : "");
        return `<td class="num${joined ? " cjoin" : ""}" title="${O.esc(tip)}">${main}${c.prorated ? "*" : ""}${c.members ? `<div class="msg">${c.members.usable}/${c.members.total} mem</div>` : ""}${joined ? '<div class="msg">joined</div>' : ""}</td>`;
      }
      if (miss) return `<td class="num cmiss${left ? " cleft" : ""}" title="${O.esc(`${NAMES[id] || id}: ${miss.detail}`)}"><span class="msg">${REASON[miss.reason] || miss.reason}${miss.reason === "partial" && miss.hours ? ` ${miss.hours}/${miss.of} h` : ""}</span>${left ? '<div class="cl">left</div>' : ""}</td>`;
      return '<td class="num"><span class="msg">—</span></td>';
    };
    const chg = (day) => { const c = day.changes[V.key]; if (!c) return '<span class="msg">first day</span>';
      if (!c.changed) return c.shifts.length ? '<span class="msg">same sources</span>' : '<span class="msg">no change</span>';
      return [c.left.length ? `left: ${c.left.map((id) => O.esc(NAMES[id] || id)).join(", ")}` : "", c.joined.length ? `joined: ${c.joined.map((id) => O.esc(NAMES[id] || id)).join(", ")}` : ""].filter(Boolean).join("; ") + (c.shifts.length ? '<div class="msg">other shares rescaled</div>' : ""); };
    const fmtH = (x) => (x ? O.esc(local(x)) : "—");
    el.innerHTML = `<div class="section-title" id="covTitle">Source contributions by day</div>
      <p class="section-sub">Which sources make up each day's blend at this point, using the same calculation as the daily table (${O.esc(C.blend.PRESETS[preset].label)}). This describes the point blend only, not coverage across an area.</p>
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
        <div class="tabs" role="group" aria-label="Variable" style="margin:0">${C.blend.VARS.map((v) => `<button type="button" class="tab" data-cv="${v.key}" aria-pressed="${v.key === covVar}" aria-selected="${v.key === covVar}">${v.label}s</button>`).join("").replace("Precips", "Precipitation")}</div>
        <div class="tabs" role="group" aria-label="Cell value" style="margin:0"><button type="button" class="tab" data-cm="share" aria-pressed="${covMode === "share"}" aria-selected="${covMode === "share"}">Share of weight</button><button type="button" class="tab" data-cm="effect" aria-pressed="${covMode === "effect"}" aria-selected="${covMode === "effect"}">Effect on blend</button></div>
      </div>
      <div class="tablewrap"><table class="covtab"><caption class="sr-only">${V.label} contributions by source and day</caption>
        <thead><tr><th scope="col" style="text-align:left">Source</th>${cov.days.map((d) => `<th scope="col">${O.esc(O.fmtDay(d.k))}</th>`).join("")}</tr></thead>
        <tbody>${ids.map((id) => `<tr><th scope="row" style="text-align:left;font-weight:600">${O.esc(NAMES[id] || id)}</th>${cov.days.map((d) => cell(d, id)).join("")}</tr>`).join("")}
          <tr class="covsum"><th scope="row" style="text-align:left">Blend ${V.label.toLowerCase()}</th>${cov.days.map((d) => `<td class="num"><b>${d.vars[V.key].value == null ? "—" : d.vars[V.key].value.toFixed(dec) + unit}</b><div class="msg">${d.vars[V.key].contributors.length} sources</div></td>`).join("")}</tr>
          <tr><th scope="row" style="text-align:left">Change from previous day</th>${cov.days.map((d) => `<td class="covchg">${chg(d)}</td>`).join("")}</tr></tbody></table></div>
      <p class="msg" style="margin-top:6px"><b>Share of weight</b>: each source's part of this variable's total weight among sources with a complete day (preset rules applied). <b>Effect on blend</b>: the displayed blend minus the same blend recomputed without that source for that day, all else fixed. A source that left the blend has no value that day, so no effect is calculated or claimed for it; the shares of the remaining sources are rescaled. <b>Partial</b>: some hours or members missing, so the day is not used (no partial highs, lows or totals). Ensembles show usable/total members. * NWS total prorated across interval edges.</p>
      <details class="fold" style="margin-top:8px"><summary>Retrieval, model runs and forecast horizons</summary>
        <div class="tablewrap"><table class="provtab"><thead><tr><th style="text-align:left">Source</th><th>Retrieved</th><th style="text-align:left">Run</th><th>Temperature to</th><th>Precipitation to</th><th>Members</th></tr></thead><tbody>
        ${ids.map((id) => { const md = data.models[id], h = cov.horizons[id] || {};
          return `<tr><td style="text-align:left">${O.esc(NAMES[id] || id)}</td><td class="num">${md && md.retrievedAt ? `${O.esc(local(Date.parse(md.retrievedAt)))}${md.fromCache ? '<div class="msg">from this browser\'s cache</div>' : ""}` : '<span class="msg">—</span>'}</td><td style="text-align:left">${md ? runCell(id) : '<span class="msg">unavailable this run</span>'}</td><td class="num">${fmtH(h.temperature)}</td><td class="num">${id === "nws" ? '<span class="msg">intervals</span>' : fmtH(h.precipitation)}</td><td class="num">${md && md.kind === "ens" ? md.members.length : "—"}</td></tr>`; }).join("")}
        </tbody></table></div>
        <p class="msg"><span class="cyc conf">confirmed</span> = stated by the data itself (NOAA GRIB2 initialization; NWS update time). <span class="cyc rep">provider-reported</span> = the latest run Open-Meteo's metadata reports when checked; Open-Meteo responses do not say which run produced them, so the forecast may come from that run or an earlier one. Horizon = last hour with a value.</p>
      </details>`;
    el.querySelectorAll("[data-cv]").forEach((b) => b.addEventListener("click", () => { covVar = b.dataset.cv; O.store.set("ops_cov_var", covVar); renderCoverage(); }));
    el.querySelectorAll("[data-cm]").forEach((b) => b.addEventListener("click", () => { covMode = b.dataset.cm; O.store.set("ops_cov_mode", covMode); renderCoverage(); }));
  }

  /* Current weights: the chosen preset applied to sources that returned data; rules = per-variable factors. */
  const W = () => {
    const base = C.blend.presetWeights(preset, SPEC, picker.weights()), w = {};
    Object.keys(base).forEach((id) => { if (data && data.models[id] && base[id] > 0) w[id] = base[id]; });
    return w;
  };
  const R = () => C.blend.presetRules(preset);
  const OPTS = () => ({ rules: R() });
  const wv = (id, v) => C.blend.w(W(), R(), id, v);
  const active = (v) => (data ? SOURCES.filter((m) => wv(m.id, v) > 0 && data.models[m.id] && O.hasData(data.models[m.id].h[v])) : []);
  const series = (v, ms) => ms.map((m) => ({ w: wv(m.id, v), data: data.models[m.id].h[v] }));
  const colorOf = (m) => O.modelColor(SOURCES.indexOf(m));

  const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
  const meter = (lvl) => `<span class="meter" aria-hidden="true">${[1, 2, 3].map((k) => `<i class="${k <= lvl ? "on" : ""}"></i>`).join("")}</span>`;
  const tz = () => data.tz;
  const local = (ms) => O.fmtLocal(C.time.toLocal(ms, tz()));
  const nwsTag = '<span class="src-nws">NWS</span>';

  function render() {
    renderRecipe();
    if (!data) {
      $("daily").innerHTML = '<tbody><tr><td class="msg">No forecast loaded yet.</td></tr></tbody>';
      if (chart) { chart.destroy(); chart = null; }
      $("legend").innerHTML = "";
      focus.clear();
      return;
    }
    renderDaily();
    renderNow();
    renderNWS();
    renderScenarios();
    renderEvent();
    renderDrivers();
    renderCoverage();
    renderChart();
    focus.update(data, { record: fresh, names: NAMES, rows: data.rows });
    if (fresh) { logRecords(); fresh = false; }
  }

  function renderRecipe() {
    const p = C.blend.PRESETS[preset], w = data ? W() : null, rules = R();
    const mig = O.store.get("ops_blend_migrated", null), v3 = O.store.get("ops_blend_v3", null);
    const tw = (id) => { const t = C.blend.w(w, rules, id, "temperature_2m"); return t !== w[id] ? ` (temps ×${t})` : ""; };
    $("recipeNote").innerHTML = `${O.esc(p.note)}${w ? ` In use: ${Object.keys(w).map((id) => `${O.esc(NAMES[id])} ×${w[id]}${tw(id)}`).join(", ") || "none"}.` : ""}` +
      (preset !== "custom" ? ' <span class="msg">The Custom weights list below edits your own preset.</span>' : "") +
      (mig ? ` <span class="msg">Your weights saved before presets existed were kept as Custom weights.</span>` : "") +
      (v3 ? ` <span class="msg">Ensembles and NWS are now blend sources; this page switched once to "Your preferred weighting".</span>` : "") +
      (w ? (() => { const sh = (v) => { const x = C.blend.shares(w, rules, v), top = x.slice(0, 2); return `${top.map((p) => `${O.esc(NAMES[p.id])} ${Math.round(p.share * 100)}%`).join(", ")}, everything else ${Math.round(100 * (1 - top.reduce((t, p) => t + p.share, 0)))}%`; };
        return ` <b>Effective shares with every loaded source present</b>: temperatures ${sh("temperature_2m")}; precip ${sh("precipitation")}. Shares rise for the remaining sources when short-range models drop out; see "What's driving the blend" for each day.`; })() : "") +
      ` <span class="msg">Each ensemble's weight is shared by its members. NWS precip uses its interval totals; NWS hourly chance is not mixed with model chances (different threshold and period).</span>`;
  }

  /* Event windows: the same aggregation as the daily table, over each phase's exact hours, plus NWS. */
  function renderEvent() {
    const ctx = O.eventContext(data); data.ctx = ctx;
    const ws = W(), row = (w) => (w._r = w._r || C.blend.windowRow(data, ws, w.L.idx, w.L.acc, OPTS()));
    const A = data.nwsAxis;
    const nwsCols = A ? [
      { label: "NWS temp", cell: (w) => { const v = w.L.idx.map((i) => A.temperature_2m[i]); return v.some((x) => x == null) ? "—" : `<span class="lo">${Math.min(...v).toFixed(0)}°</span>–<span class="hi">${Math.max(...v).toFixed(0)}°</span>`; } },
      { label: "NWS hourly PoP", cell: (w) => { const v = w.L.idx.map((i) => A.precipitation_probability[i]); return v.some((x) => x == null) ? "—" : `<span title="Range of NWS hourly probabilities in this phase. Not a probability for the whole phase.">${Math.min(...v)}–${Math.max(...v)}% <span class="msg">hourly</span></span>`; } },
      { label: "NWS precip", cell: (w) => qpfText(N.totalOver(A.qpf, w.startMs, w.endMs)) },
      { label: "NWS wording", cell: (w) => O.esc(wording(w.startMs, w.endMs)) },
    ] : [];
    O.eventTable($("eventCard"), ctx, [
      { label: "Temp", cell: (w) => { const r = row(w); return r.lo == null ? "—" : `<span class="lo">${r.lo.toFixed(0)}°</span>–<span class="hi">${r.hi.toFixed(0)}°</span>`; } },
      { label: "Feels like (min)", cell: (w) => f(row(w).feel, 0, "°") },
      { label: "Precip", cell: (w) => { const r = row(w); return `${f(r.qpf, 2, '"')}${r.qpfBounds ? ` <span class="msg" title="NWS intervals cross this phase's edges. Its share was prorated assuming a uniform rate; with NWS at its lower or upper bound the blend is this range.">(${r.qpfBounds[0].toFixed(2)}–${r.qpfBounds[1].toFixed(2)})</span>` : ""}`; } },
      { label: "Max hourly chance", cell: (w) => f(row(w).pop, 0, "%") },
      { label: "Snow", cell: (w) => { const v = row(w).sn; return v != null && v >= 0.05 ? f(v, 1, '"') : "—"; } },
      { label: "Peak gust", cell: (w) => f(row(w).gust, 0, " mph") },
      { label: "Temp agreement", cell: (w) => { const a = row(w).ag; return `${meter(a.level)}${a.word}`; } },
      { label: "Chance ≥0.01\" (ens.)", cell: (w) => { const c = row(w).chance; return c ? `<span title="Share of ${c.members} ECMWF ENS / GEFS members with at least 0.01 in. over this phase, weighted by system">${c.v.toFixed(0)}%</span>` : "—"; } },
      { label: "Sources", cell: (w) => `<span title="${O.esc(row(w).contrib.map((id) => NAMES[id]).join(", "))}">${row(w).contrib.length}</span>` },
      ...nwsCols,
    ], { note: `Blend: ${O.esc(C.blend.PRESETS[preset].label)}. A source counts for a phase only if it has every hour of it (an ensemble member likewise). NWS is inside the blend at its weight; the NWS columns are NWS values alone for the same hours; NWS precip is from its interval totals (a range when an interval straddles the phase edge).` });
  }
  /* NWS interval total text: exact, a range when intervals straddle the window, or unavailable */
  const qpfText = (t, dec = 2) => (!t || !t.covers ? '<span class="msg">not covered</span>' : t.exact ? `${t.lower.toFixed(dec)}"` : `<span title="NWS reports precip in multi-hour intervals that cross this window's edge. The window total lies between these.">${t.lower.toFixed(dec)}–${t.upper.toFixed(dec)}"</span>`);
  /* distinct NWS hourly wording during [s, e) */
  const wording = (s, e) => { if (!nws || !nws.hourly || !nws.hourly.length) return "—"; const w = [...new Set(nws.hourly.filter((h) => h.s < e && h.e > s).map((h) => h.short).filter(Boolean))]; return w.length ? w.slice(0, 3).join(" → ") : "—"; };

  /* NWS day/night periods on a calendar day: daytime period starting that day, night period starting that evening. */
  const nwsDayNight = (k) => {
    if (!nws || !nws.periods || !nws.periods.length) return {};
    const on = (p) => C.time.toLocal(p.s, tz()).slice(0, 10) === k;
    return { day: nws.periods.find((p) => p.isDaytime && on(p)), night: nws.periods.find((p) => !p.isDaytime && on(p)) };
  };

  function renderDaily() {
    if (!data) return;
    const rows = C.blend.dailyRows(data, W(), OPTS());
    data.rows = rows;
    const hasN = nws && nws.periods && nws.periods.length;
    /* Columns. tier: 1 always shown; 2 moves into the day's details when the table is narrow (< 880 px);
       3 also moves there on phone widths (< 600 px). Breakpoints follow the table's own width. */
    const COLS = [
      { l: ["Day"], def: "Calendar day (midnight to midnight local time). Click a row to zoom the chart and see that day's source breakdown.", tier: 1, cell: (r) => `<td class="display day"><button type="button" class="detbtn" aria-expanded="false" aria-label="Show details for ${O.fmtDay(r.k)}">▸</button>${O.fmtDay(r.k)}</td>` },
      { l: ["Low"], def: "Blended daily low for the calendar day (midnight to midnight), usually the morning low. Small numbers: weighted guidance spread (10th–90th percentile across all sources; not a calibrated probability).", tier: 1, cell: (r) => `<td class="num"><span class="lo">${f(r.lo, 0, "°")}</span>${rng(r.loR, 0, r.ensR.lo)}</td>`, txt: (r) => f(r.lo, 0, "°") },
      { l: ["High"], def: "Blended daily high for the calendar day. Small numbers: weighted guidance spread (10th–90th percentile across all sources; not a calibrated probability). Hover a range for the ensembles-only range.", tier: 1, cell: (r) => `<td class="num"><span class="hi">${f(r.hi, 0, "°")}</span>${rng(r.hiR, 0, r.ensR.hi)}</td>`, txt: (r) => f(r.hi, 0, "°") },
      { l: ["Precip"], def: "Blended liquid-equivalent precipitation for the calendar day, with its guidance spread. * = NWS share prorated across its interval edges (hover for the blend at NWS's lower and upper bounds).", tier: 1,
        cell: (r) => `<td class="num">${f(r.qpf, 2, '"')}${r.prorated ? ` <span class="msg" title="NWS precip intervals cross this day's edges; its share was prorated assuming a uniform rate. With NWS at its lower or upper bound the blend would be ${r.qpfBounds ? `${r.qpfBounds[0].toFixed(2)}–${r.qpfBounds[1].toFixed(2)}"` : "unchanged"}.">*</span>` : ""}${rng(r.qpfR, 2, r.ensR.qpf)}</td>`, txt: (r) => f(r.qpf, 2, '"') + (r.prorated ? " *" : "") },
      { l: ["Snow"], def: "Blended snowfall (model snow at Open-Meteo's 7:1 ratio; not ground accumulation). Shown from 0.05\".", tier: 3, cell: (r) => `<td class="num">${r.sn != null && r.sn >= 0.05 ? f(r.sn, 1, '"') : "—"}</td>`, txt: (r) => (r.sn != null && r.sn >= 0.05 ? f(r.sn, 1, '"') : "—") },
      { l: ["Ens. chance", "≥0.01″"], def: "Ensemble threshold chance: the weighted share of ECMWF ENS and GEFS members with at least 0.01 in. over this calendar day. Not the same as the maximum hourly PoP.", tier: 1,
        cell: (r) => `<td class="num">${r.chance ? `<span title="Share of ${r.chance.members} ensemble members with 0.01 in. or more this calendar day, weighted by system">${r.chance.v.toFixed(0)}%</span>` : "—"}</td>`, txt: (r) => (r.chance ? `${r.chance.v.toFixed(0)}% (${r.chance.members} members)` : "—") },
      { l: ["Max hourly", "PoP"], def: "Highest hourly precipitation probability from the deterministic models during the day (blended). An hourly figure, not a chance for the whole day, and not comparable to the ensemble threshold chance.", tier: 3, cell: (r) => `<td class="num">${f(r.pop, 0, "%")}</td>`, txt: (r) => f(r.pop, 0, "%") },
      { l: ["Peak", "gust"], def: "Blended highest hourly wind gust during the day.", tier: 3, cell: (r) => `<td class="num">${f(r.gust, 0, " mph")}</td>`, txt: (r) => f(r.gust, 0, " mph") },
      { l: ["Source", "highs"], def: "Range of the individual sources' daily highs (ensembles as their members' mean high).", tier: 2, cell: (r) => `<td class="num">${agTxt(r)}</td>`, txt: agTxt },
      { l: ["Temp", "agreement"], def: "How close the sources' daily highs are: TIGHT ≤ 3°F apart, FAIR ≤ 6°F, WIDE more. Says nothing about rain or timing.", tier: 2,
        cell: (r) => `<td title="${r.contrib.length} sources with a complete day: ${r.contrib.map((id) => NAMES[id]).join(", ")}">${meter(r.ag.level)}<span class="msg" style="color:var(--text);font-weight:700">${r.ag.word}</span></td>`, txt: (r) => `${r.ag.word} (${r.contrib.length} sources)` },
      ...(hasN ? [
        { l: [`${nwsTag} day`, "high"], def: "NWS official daytime period high (usually 6 AM–6 PM), not a calendar-day high; it can differ from the blend's midnight-to-midnight high.", tier: 2, nws: true,
          cell: (r) => { const dn = nwsDayNight(r.k); return `<td class="num nwscol" title="${dn.day ? O.esc(`${dn.day.name}: ${local(dn.day.s)}–${local(dn.day.e)}`) : "No NWS daytime period starts this day"}">${dn.day ? `<span class="hi">${dn.day.temp}°</span>` : "—"}</td>`; }, txt: (r) => { const dn = nwsDayNight(r.k); return dn.day ? `${dn.day.temp}° (${dn.day.name})` : "—"; } },
        { l: [`${nwsTag} night`, "low"], def: "NWS official night period low (usually 6 PM–6 AM, starting this evening).", tier: 2, nws: true,
          cell: (r) => { const dn = nwsDayNight(r.k); return `<td class="num nwscol" title="${dn.night ? O.esc(`${dn.night.name}: ${local(dn.night.s)}–${local(dn.night.e)}`) : "No NWS night period starts this day"}">${dn.night ? `<span class="lo">${dn.night.temp}°</span>` : "—"}</td>`; }, txt: (r) => { const dn = nwsDayNight(r.k); return dn.night ? `${dn.night.temp}° (${dn.night.name})` : "—"; } },
      ] : []),
    ];
    const tcls = (c) => `t${c.tier}${c.nws ? " nwscol" : ""}`;
    $("daily").innerHTML = `<thead><tr>${COLS.map((c, i) => `<th class="${tcls(c)}" scope="col"><button type="button" class="thd" data-i="${i}" aria-describedby="thd${i}">${c.l.map((x, k) => (k ? "<br>" : "") + (/<span/.test(x) ? x : O.esc(x))).join("")}</button><span class="sr" id="thd${i}">${O.esc(c.def)}</span></th>`).join("")}</tr></thead><tbody>` +
      rows.map((r) => `<tr data-k="${r.k}" class="${viewDay === r.k ? "sel" : ""}" tabindex="0">${COLS.map((c) => c.cell(r).replace(/^<td( class="([^"]*)")?/, (m, a, cl) => `<td class="${[cl || "", tcls(c)].join(" ").trim()}"`)).join("")}</tr>` +
        `<tr class="detrow" data-for="${r.k}" hidden><td colspan="${COLS.length}"><dl class="detlist">${COLS.filter((c) => c.tier > 1).map((c) => `<div class="${tcls(c)}d"><dt>${c.l.join(" ").replace(/<[^>]+>/g, "")}</dt><dd>${c.txt(r)}</dd></div>`).join("")}</dl></td></tr>`).join("") + "</tbody>";
    wireHeaders(COLS);
    $("dailyNote").innerHTML = `Small numbers under each value: <b>weighted guidance spread</b>, the 10th–90th percentile across all sources (ensemble members share their system's weight; NWS, NBM and each model count once). It mixes ensembles with single forecasts, so it is not a calibrated probability; hover for the ensembles-only range. Ensemble highs and lows are each member's own daily extreme, then combined. NWS enters highs and lows through its hourly temperatures over the calendar day, not its official day-high / night-low. * NWS precip prorated across interval edges (hover for the blend at NWS's lower and upper bounds). Click a day for its source breakdown. ` + (hasN ? `${nwsTag} columns are the official day (usually 6a–6p) and night (6p–6a) periods, not calendar days, so they can differ from the blend's midnight-to-midnight high and low. See <b>NWS vs blend</b> for a same-hours comparison.` : "");
    $("daily").querySelectorAll("tr[data-k]").forEach((tr) => {
      const pickDay = () => { viewDay = viewDay === tr.dataset.k ? null : tr.dataset.k; renderDaily(); renderChart(); };
      const det = tr.querySelector(".detbtn");
      det.addEventListener("click", (e) => { e.stopPropagation(); const row = $("daily").querySelector(`tr.detrow[data-for="${tr.dataset.k}"]`); row.hidden = !row.hidden; det.setAttribute("aria-expanded", String(!row.hidden)); det.textContent = row.hidden ? "▸" : "▾"; });
      tr.addEventListener("click", pickDay);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickDay(); } });
    });
    if (fresh) {
      const snap = { cfg: `${preset}|${C.config.fingerprint(W())}`, rows: {} };
      rows.forEach((r) => (snap.rows[r.k] = { label: O.fmtDay(r.k), win: r.win, contrib: r.contrib, hi: r.hi, lo: r.lo, qpf: r.qpf, pop: r.pop, sn: r.sn, gust: r.gust }));
      data.snapPair = O.trackChanges("blend", snap);
    }

  }

  const agTxt = (r) => (r.ag.lo == null ? "—" : r.ag.n > 1 ? `${r.ag.lo.toFixed(0)}–${r.ag.hi.toFixed(0)}°` : `${r.ag.lo.toFixed(0)}°`);
  /* Column definitions on hover, keyboard focus and tap (one shared popover). */
  function wireHeaders(COLS) {
    const pop = $("thPop");
    const show = (b) => { const c = COLS[+b.dataset.i]; pop.textContent = c.def; pop.hidden = false; const r = b.getBoundingClientRect(), host = pop.offsetParent ? pop.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
      pop.style.left = `${Math.max(0, Math.min(r.left - host.left, (pop.offsetParent ? pop.offsetParent.clientWidth : innerWidth) - 290))}px`; pop.style.top = `${r.bottom - host.top + 4}px`; b.setAttribute("aria-expanded", "true"); };
    const hide = (b) => { pop.hidden = true; if (b) b.setAttribute("aria-expanded", "false"); };
    $("daily").querySelectorAll(".thd").forEach((b) => {
      b.setAttribute("aria-expanded", "false");
      b.addEventListener("mouseenter", () => show(b)); b.addEventListener("mouseleave", () => hide(b));
      let shownAt = 0;
      b.addEventListener("focus", () => { show(b); shownAt = Date.now(); }); b.addEventListener("blur", () => hide(b));
      /* a tap fires focus then click: keep it open; a later click on an open definition closes it */
      b.addEventListener("click", (e) => { e.stopPropagation(); if (pop.hidden) { show(b); shownAt = Date.now(); } else if (Date.now() - shownAt > 400) hide(b); });
      b.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(b); });
    });
  }
  /* Expand table: give the main column the full width (sidebars hide); remembered per browser. */
  const applyWide = (on) => { document.body.classList.toggle("wide-main", on); $("wideBtn").setAttribute("aria-pressed", String(on)); $("wideBtn").textContent = on ? "SHOW SIDEBAR" : "EXPAND TABLE"; };
  applyWide(O.store.get("ops_blend_wide", false));
  $("wideBtn").addEventListener("click", () => { const on = !document.body.classList.contains("wide-main"); O.store.set("ops_blend_wide", on); applyWide(on); renderChart(); });

  const rng = (a, d = 0, ens) => (a && a[0] != null && a[1] != null && a[1] - a[0] >= (d ? 0.005 : 0.5) ? `<div class="msg" style="font-size:10.5px" title="Weighted guidance spread (10th–90th percentile across all sources; ensemble members share their system's weight). Not a calibrated probability.${ens ? ` Ensembles alone: ${ens[0].toFixed(d)}–${ens[1].toFixed(d)}.` : ""}">${a[0].toFixed(d)}–${a[1].toFixed(d)}</div>` : "");

  const sp = (a, d) => (a && a[0] != null ? `${a[0].toFixed(d)}–${a[1].toFixed(d)}` : "—");
  /* Source comparison for the selected day (or the first day): what is driving the blend. */
  function renderDrivers() {
    const el = $("driverCard"); if (!el) return;
    const r = (data.rows || []).find((x) => x.k === viewDay) || (data.rows || [])[0];
    if (!r) { el.innerHTML = ""; return; }
    const ids = [...new Set([...r.parts.hi, ...r.parts.lo, ...r.parts.qpf].map((p) => p.id))].sort((a, b) => SOURCES.findIndex((m) => m.id === a) - SOURCES.findIndex((m) => m.id === b));
    const get = (k, id) => r.parts[k].find((p) => p.id === id);
    const cell = (k, id, d, u) => { const p = get(k, id); return p ? `${p.v.toFixed(d)}${u}${p.prorated ? "*" : ""} <span class="msg">${Math.round(p.share * 100)}%</span>` : '<span class="msg">—</span>'; };
    el.innerHTML = `<div class="section-title">What's driving the blend · ${O.fmtDay(r.k)}</div>
      <p class="section-sub">Each source's own value for this calendar day and its share of the weight for that variable (${O.esc(C.blend.PRESETS[preset].label)}). Ensembles show the mean of their members' own highs, lows and totals.</p>
      <div class="tablewrap"><table><thead><tr><th style="text-align:left">Source</th><th>High · share</th><th>Low · share</th><th>Precip · share</th><th>Members</th></tr></thead><tbody>
      ${ids.map((id) => { const p = get("hi", id) || get("qpf", id) || get("lo", id); return `<tr><td style="text-align:left">${O.esc(NAMES[id] || id)}</td><td class="num">${cell("hi", id, 0, "°")}</td><td class="num">${cell("lo", id, 0, "°")}</td><td class="num">${cell("qpf", id, 2, '"')}</td><td class="num">${p && p.n > 1 ? p.n : "—"}</td></tr>`; }).join("")}
      <tr><td style="text-align:left" class="msg">Weighted guidance spread (10–90%)</td><td class="num msg">${sp(r.hiR, 0)}</td><td class="num msg">${sp(r.loR, 0)}</td><td class="num msg">${sp(r.qpfR, 2)}</td><td></td></tr>
      <tr><td style="text-align:left" class="msg">Ensembles only (10–90%)</td><td class="num msg">${sp(r.ensR.hi, 0)}</td><td class="num msg">${sp(r.ensR.lo, 0)}</td><td class="num msg">${sp(r.ensR.qpf, 2)}</td><td></td></tr>
      <tr><td style="text-align:left"><b>Blend</b></td><td class="num"><b>${f(r.hi, 0, "°")}</b></td><td class="num"><b>${f(r.lo, 0, "°")}</b></td><td class="num"><b>${f(r.qpf, 2, '"')}</b>${r.qpfBounds ? `<div class="msg" style="font-size:10.5px">${r.qpfBounds[0].toFixed(2)}–${r.qpfBounds[1].toFixed(2)} with NWS at its bounds</div>` : ""}</td><td></td></tr></tbody></table></div>
      <p class="msg">* NWS total prorated assuming a uniform rate inside intervals that cross the day's edges.</p>`;
  }

  /* NWS vs blend over each official NWS period's own hours. */
  function renderNWS() {
    const el = $("nwsCard");
    if (!nws || !nws.ok) { el.innerHTML = `<div class="section-title">NWS vs blend</div><p class="msg">${O.esc(nws ? nws.reason : "Loading…")}. The model blend above is unaffected.</p>`; return; }
    const A = data.nwsAxis, ws = W(), meaningful = [];
    const st = nws.status, upd = st.updated.forecast ? `${local(st.updated.forecast)} ${C.time.abbr(st.updated.forecast, tz())}` : "—";
    const rows = nws.periods.slice(0, 10).map((p) => {
      const idx = data.ms.map((m, i) => (m >= p.s && m < p.e ? i : -1)).filter((i) => i >= 0);
      const acc = data.ms.map((m, i) => (m > p.s && m <= p.e ? i : -1)).filter((i) => i >= 0);
      const covered = idx.length > 0 && data.ms[idx[0]] <= p.s + 3599e3 && data.ms[idx[idx.length - 1]] >= p.e - 3600e3;
      const r = covered ? C.blend.windowRow(data, ws, idx, acc, OPTS()) : null;
      const bT = r ? (p.isDaytime ? r.hi : r.lo) : null, d = bT != null && p.temp != null ? p.temp - bT : null;
      const nq = A ? N.totalOver(A.qpf, p.s, p.e) : null, bq = r ? r.qpf : null;
      const qOff = nq && nq.covers && bq != null ? (bq < nq.lower - 0.1 ? bq - nq.lower : bq > nq.upper + 0.1 ? bq - nq.upper : 0) : null;
      if (d != null && Math.abs(d) >= 4) meaningful.push(`${p.name}: NWS ${p.isDaytime ? "high" : "low"} ${p.temp}° vs blend ${bT.toFixed(0)}° over the same hours (${d > 0 ? "+" : ""}${d.toFixed(0)}°)`);
      if (qOff) meaningful.push(`${p.name}: blend precip ${bq.toFixed(2)}" vs NWS ${nq.exact ? nq.lower.toFixed(2) : `${nq.lower.toFixed(2)}–${nq.upper.toFixed(2)}`}"`);
      return `<tr><td class="display" style="font-size:12px">${O.esc(p.name)}</td><td class="num">${local(p.s)}–${O.fmtLocal(C.time.toLocal(p.e, tz()), false)}</td>` +
        `<td class="num nwscol"><span class="${p.isDaytime ? "hi" : "lo"}">${p.temp}°</span></td><td class="num">${bT == null ? "—" : `${bT.toFixed(0)}°`}</td><td class="num${d != null && Math.abs(d) >= 4 ? " diff" : ""}">${d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(0)}°`}</td>` +
        `<td class="num nwscol">${p.pop == null ? "—" : p.pop + "%"}</td><td class="num nwscol">${nq ? qpfText(nq) : "—"}</td><td class="num">${f(bq, 2, '"')}</td>` +
        `<td style="white-space:normal;min-width:180px;text-align:left" title="${O.esc(p.detailed)}">${O.esc(p.short)}</td></tr>`;
    }).join("");
    el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline;margin-bottom:6px"><div class="section-title" style="margin:0">${nwsTag} NWS vs blend</div><span class="msg">NWS ${O.esc(nws.office)} · forecast updated ${upd}</span></div>` +
      `<p class="section-sub">Each row is an official NWS day or night period. The blend column is ${O.esc(C.blend.PRESETS[preset].label.toLowerCase())} over exactly that period's hours (high for day, low for night)${ws.nws ? `, and includes NWS at ×${ws.nws}, so differences are smaller than NWS vs the other sources` : ""}. NWS chance is the official period probability; the blend has no comparable period probability, so none is shown.</p>` +
      (meaningful.length ? `<div class="changes" style="margin-bottom:10px">${meaningful.slice(0, 8).map((x) => `<span class="change diffchip">${O.esc(x)}</span>`).join("")}</div>` : '<p class="msg" style="margin-bottom:8px">No meaningful differences (temps within 4°F; precip inside the NWS range ±0.10").</p>') +
      `<div class="tablewrap"><table><thead><tr><th>Period</th><th>Local time</th><th class="nwscol">NWS temp</th><th>Blend, same hours</th><th>Δ NWS−blend</th><th class="nwscol">NWS chance</th><th class="nwscol">NWS precip</th><th>Blend precip</th><th style="text-align:left">NWS wording</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /* Precipitation timing scenarios over the chart window: different storm timings kept apart. */
  function renderScenarios() {
    const [s, e] = viewRange(), P = C.blend.precipScenarios(data, W(), s, e, { minAmt: 0.01 });
    const nm = (ids) => ids.map((id) => NAMES[id]).join(", ");
    const span = (a) => (a[0] === a[1] ? local(a[0]) : `${local(a[0])} – ${local(a[1])}`);
    $("scenCard").innerHTML = `<div class="section-title">Precip timing scenarios</div>` +
      `<p class="section-sub">${O.fmtWhen(data.times[s])} to ${O.fmtWhen(data.times[e - 1])}. Models are grouped by when their precipitation starts (0.01"/h or more), so early and late timings stay separate instead of averaging into a long, light event. Totals are each model's own.</p>` +
      (P.scenarios.length ? `<div class="tablewrap"><table><thead><tr><th>Scenario</th><th>Models</th><th>Starts</th><th>Ends</th><th>Total</th></tr></thead><tbody>${P.scenarios.map((sc, k) => `<tr><td class="display" style="font-size:12px">${String.fromCharCode(65 + k)}</td><td style="text-align:left">${O.esc(nm(sc.ids))}</td><td class="num">${span(sc.onset)}</td><td class="num">${span(sc.end)}</td><td class="num">${sc.total[0].toFixed(2)}–${sc.total[1].toFixed(2)}"</td></tr>`).join("")}</tbody></table></div>` : '<p class="msg">No model has measurable precipitation in this window.</p>') +
      (P.dry.length ? `<p class="msg" style="margin-top:6px">Dry in this window: ${O.esc(nm(P.dry))}.</p>` : "") +
      (P.incomplete.length ? `<p class="msg">Left out (data doesn't cover the whole window): ${O.esc(nm(P.incomplete))}.</p>` : "");
  }

  function renderNow() {
    const now = Math.max(0, O.nowIdx(data)), end = Math.min(data.times.length, now + 24);
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
    const word = sn != null && sn >= 0.5 ? "SNOW LIKELY" : sn != null && sn >= 0.1 ? "SOME SNOW" :
      (pop != null && pop >= 60) || (qpf != null && qpf >= 0.25) ? "WET" : (pop != null && pop >= 30) || (qpf != null && qpf >= 0.05) ? "CHANCE OF PRECIP" : "MOSTLY DRY";
    O.headline({
      word, note: `${C.blend.PRESETS[preset].label} · next 24 h`,
      stats: [
        { num: `${f(lo, 0, "°")} / ${f(hi, 0, "°")}`, unit: "lo / hi" },
        { num: f(qpf, 2, '"'), unit: `precip · max hourly ${f(pop, 0, "%")}` },
        { num: f(gust, 0, " mph"), unit: "peak gust" },
      ],
    });
    const today = data.rows && data.rows[0];
    $("tiles").innerHTML = [
      ["Blend now", f(tNow, 0, "°F"), spreadNow ? `sources ${spreadNow[0].toFixed(0)}–${spreadNow[1].toFixed(0)}° · not an observation` : "not an observation"],
      ["24 h low / high", `${f(lo, 0, "°")} / ${f(hi, 0, "°")}`, `${tm.length} sources in blend`],
      ["24 h precip", f(qpf, 2, '"'), `max hourly chance ${f(pop, 0, "%")}`],
      ["24 h snow", sn != null && sn >= 0.05 ? f(sn, 1, '"') : "—", "blended snow"],
      ["Peak gust", f(gust, 0, " mph"), "blended, next 24 h"],
      ["Today's temp agreement", today ? today.ag.word : "—", today && today.ag.n > 1 ? `highs ${today.ag.lo.toFixed(0)}–${today.ag.hi.toFixed(0)}°` : "needs 2+ models"],
    ].map(([k, v, s]) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join("");
  }

  function viewRange() {
    if (range === "event" && !viewDay) {
      const w = data.ctx && data.ctx.wins && data.ctx.wins.find((x) => x.key === "all");
      if (w && w.L.idx.length) return [Math.max(0, w.L.idx[0] - 3), Math.min(data.times.length, w.L.idx[w.L.idx.length - 1] + 4)];
    }
    if (viewDay) { const d = O.dayGroups(data.times).find((x) => x.k === viewDay); if (d) return [d.idx[0], d.idx[d.idx.length - 1] + 1]; }
    const s = Math.max(0, O.nowIdx(data));
    return [s, range === "all" ? data.times.length : Math.min(data.times.length, s + (range === "event" ? 48 : +range))];
  }

  function renderChart() {
    if (!data) return;
    const t = TABS.find((x) => x.id === tab) || TABS[0];
    const [s, e] = viewRange(), times = data.times.slice(s, e), sl = (a) => a.slice(s, e);
    $("chartTitle").textContent = t.label + (viewDay ? ` · ${O.fmtDay(viewDay)}` : "");
    $("chartSub").textContent = t.accum ? `Running total from ${O.fmtWhen(data.times[s])} ${O.tzShort(data.tz)}. A model's line ends where its data ends. NWS reports precip and snow as multi-hour interval totals; its line is drawn only at interval ends.` : viewDay ? "Showing one day. Click the day again in the table to go back." : "";
    const ms = active(t.v), B = O.blendSeries(series(t.v, ms).map((x) => ({ w: x.w, data: sl(x.data) })), times.length);
    const labels = O.hourLabels(times, data.ms.slice(s, e), data.tz), hours = times.map(O.hourOf), fg = O.css("--text");
    const ds = [];
    if (!t.accum && ms.length > 1) {
      ds.push({ label: "min", data: B.min, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true, hideTip: true, order: 5 });
      ds.push({ label: "spread", data: B.max, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: O.css("--band"), spanGaps: true, hideTip: true, order: 5 });
    }
    if (showLines() || ms.length === 1) ms.forEach((m) => {
      const raw = sl(data.models[m.id].h[t.v]);
      ds.push(O.modelLine(m.kind === "ens" ? `${m.name} (member mean)` : m.name, t.accum ? C.stats.cumulativeStrict(raw) : raw, colorOf(m)));
    });
    if (ms.length > 1 || t.accum) ds.push({ label: preset === "nbm" ? "NBM" : "BLEND", data: t.accum ? C.stats.cumulativeStrict(B.mean) : B.mean, borderColor: fg, borderWidth: 3.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 1 });
    if (t.accum) ds.push({ type: "bar", label: "Blend per hour", data: B.mean, backgroundColor: O.css("--band"), yAxisID: "y2", order: 6, barPercentage: 1, categoryPercentage: 1, dec: 2 });
    /* NWS: its own dashed line, never part of the blend */
    let nwsNote = "", nwsStart = null;
    const A = data.nwsAxis;
    if (A && t.nws && A[t.v]) {
      const v = sl(A[t.v]);
      if (v.some((x) => x != null)) { ds.push({ label: "NWS (grid)", data: v, borderColor: NWS_COLOR(), borderWidth: 2.5, borderDash: [7, 4], pointRadius: 0, stepped: false, spanGaps: false, order: 0 }); nwsNote = "NWS"; }
    } else if (A && t.nwsAcc) {
      /* cumulative interval totals from the window start, plotted only at interval ends */
      /* starts at the first NWS interval boundary inside the view; stops at the first gap or missing value */
      const ivs = A[t.nwsAcc].filter((x) => x.s >= data.ms[s]).sort((a, b) => a.s - b.s);
      const pts = sl(data.ms).map(() => null); let acc = 0, okRun = true, prevEnd = ivs.length ? ivs[0].s : null;
      const i0 = prevEnd == null ? -1 : data.ms.indexOf(prevEnd) - s;
      if (i0 >= 0 && i0 < pts.length) pts[i0] = 0;
      ivs.forEach((x) => { if (!okRun || x.s !== prevEnd || x.v == null) { okRun = false; return; } acc += x.v; prevEnd = x.e; const i = data.ms.indexOf(x.e) - s; if (i >= 0 && i < pts.length) pts[i] = acc; });
      if (i0 >= 0) nwsStart = data.ms[s + i0];
      if (pts.filter((x) => x != null).length > 1) { ds.push({ label: "NWS (interval totals)", data: pts, borderColor: NWS_COLOR(), backgroundColor: NWS_COLOR(), borderWidth: 2.5, borderDash: [7, 4], pointRadius: 4, pointStyle: "rectRot", spanGaps: true, order: 0, dec: 2 }); nwsNote = "NWS"; }
    }
    if (nwsStart != null && t.accum) $("chartSub").textContent += ` NWS running total starts at its first interval boundary, ${local(nwsStart)}.`;
    const nowIdx = O.nowIdx(data) - s;
    const base = O.chartBase({ labels, hours, nowIdx, unit: t.unit, dec: t.dec || 0, yTitle: t.accum ? `Accumulated (${t.unit})` : t.unit,
      y2Title: t.accum ? "Per hour (in)" : null, beginAtZero: t.accum || t.zero, yMin: t.min, yMax: t.max, bands: O.eventBands(data.ctx, s) });
    base.options.plugins.tooltip.callbacks.footer = (items) => items.length ? `${B.count[items[0].dataIndex]} source${B.count[items[0].dataIndex] === 1 ? "" : "s"} in the blend at this hour` : "";
    if (chart) chart.destroy();
    chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: base.options, plugins: base.plugins });
    const nMin = Math.min(...B.count.filter((x) => x > 0)), nMax = Math.max(0, ...B.count);
    $("legend").innerHTML = (showLines() ? ms.map((m) => `<span><i class="sw" style="background:${colorOf(m)}"></i>${O.esc(m.name)}</span>`).join("") : "") +
      (ms.length > 1 || t.accum ? `<span><i class="sw" style="background:${fg};height:4px"></i>${O.esc(C.blend.PRESETS[preset].label)}</span>` : "") +
      (!t.accum && ms.length > 1 ? `<span><i class="sw" style="background:var(--band);height:10px"></i>Source range (min–max; ensembles as member means)</span>` : "") +
      (nwsNote ? `<span><i class="sw" style="background:repeating-linear-gradient(90deg,${NWS_COLOR()} 0 6px,transparent 6px 9px);height:3px"></i>NWS ${wv("nws", t.v) > 0 ? (t.accum ? "(interval totals; in daily and phase totals, not the hourly line)" : `(in blend ×${wv("nws", t.v)})`) : "(comparison only for this field)"}</span>` : (data.nwsAxis ? "" : "<span>NWS unavailable</span>")) +
      (ms.length ? `<span>${nMin === nMax ? `${nMax} sources` : `${nMin}–${nMax} sources, varies by hour`}</span>` : "<span>None of the checked sources carry this field here.</span>");
  }

  /* Verification records: what each source said for each window, for later scoring. */
  function logRecords() {
    const at = new Date().toISOString(), loc = { lat: O.location.lat, lon: O.location.lon, name: O.location.name }, recs = [];
    const presets = ["preferred", "custom", "equal", "nbm"];
    presets.forEach((p) => {
      const base = C.blend.presetWeights(p, SPEC, picker.weights()), ws = {}; Object.keys(base).forEach((id) => { if (data.models[id]) ws[id] = base[id]; });
      if (!Object.keys(ws).length) return;
      const rules = C.blend.presetRules(p);
      C.blend.dailyRows(data, ws, { rules }).forEach((r) => recs.push(C.verify.record({ kind: "calendar-day", source: `blend:${p}`, location: loc, retrievedAt: at, cycle: null,
        window: { key: r.win, tz: data.tz }, contributors: r.contrib, weights: rules ? { ...ws, rules } : ws,
        values: { hi: r.hi, lo: r.lo, qpf: r.qpf, snow: r.sn, gust: r.gust, hiP10P90: r.hiR, loP10P90: r.loR, chance01: r.chance ? r.chance.v : null, nwsPrecipProrated: r.prorated,
          parts: { hi: r.parts.hi.map((x) => [x.id, x.v, x.w]), lo: r.parts.lo.map((x) => [x.id, x.v, x.w]), qpf: r.parts.qpf.map((x) => [x.id, x.v, x.w]) } } })));
    });
    if (nws && nws.ok) nws.periods.forEach((p) => recs.push(C.verify.record({ kind: p.isDaytime ? "nws-day" : "nws-night", source: "nws", location: loc, retrievedAt: at,
      cycle: nws.status.updated.forecast ? new Date(nws.status.updated.forecast).toISOString() : null, window: { key: `${p.startTime}/${p.endTime}` }, contributors: [`NWS ${nws.office}`],
      values: { temp: p.temp, pop: p.pop, short: p.short } })));
    O.logVerify(recs);
  }

  render();
  run();
})();

