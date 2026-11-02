/* Overview: a 3-day summary built from the same configuration, weights and aggregation as each
   tool page, so the numbers here match MODEL BLEND, THUNDER and WINTER for the same days. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core, CFG = C.config;
  O.shell("home", "Overview");
  document.title = O.BRAND.name;

  O.locationCard($("locCard"), () => run());
  O.eventCard($("evCard"));
  O.onEvent(() => run());
  const name = (spec) => Object.fromEntries(spec.models.map((m) => [m.id, m.name]));
  const NAMES = { ...name(CFG.blend), ...name(CFG.thunder), ...name(CFG.winter) };

  async function run() {
    O.setChip("FETCHING…");
    $("sumMsg").textContent = "Loading guidance…";
    const where = { lat: O.location.lat, lon: O.location.lon };
    const wsB = O.savedWeights(CFG.blend), wsT = O.savedWeights(CFG.thunder), wsW = O.savedWeights(CFG.winter);
    /* Request exactly what the tool pages request (same models, variables and days), so the
       browser cache is shared and nothing is computed differently. */
    const [B, T, W, NW] = await Promise.all([
      O.Data.loadModels(CFG.blend, { ...where, days: Math.max(3, O.savedDays(CFG.blend)) }),
      O.Data.loadModels(CFG.thunder, { ...where, days: Math.max(3, O.savedDays(CFG.thunder)) }),
      O.Data.loadEnsemble(CFG.winter, where),
      O.Data.loadNWS(where),
    ]);
    const nwsOk = NW && NW.ok;
    if (B.empty) {
      O.setChip("NO DATA", "err"); O.headline({ tier: "nodata", word: "NO DATA" });
      $("sumMsg").textContent = "Couldn't reach Open-Meteo."; $("days").innerHTML = ""; return;
    }
    const rows = C.blend.dailyRows(B, wsB).slice(0, 3);
    const TH = T.empty ? null : C.thunder.hourly(T, wsT);
    const mem = W.empty ? [] : C.winter.members(W, wsW, "snowfall");
    const wDays = mem.length ? Object.fromEntries(C.winter.dayRows(W.times, mem).map((r) => [r.k, r])) : {};
    const tDays = TH ? Object.fromEntries(C.time.dayGroups(T.times).map((d) => [d.k, d.idx])) : {};

    const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
    const pctTxt = (p) => (p == null ? "—" : p > 0 && p < 0.05 ? "<5%" : Math.round(p * 100) + "%");
    const cards = rows.map((r, n) => {
      const ti = tDays[r.k] || [], ta = ti.map((i) => TH.assess[i]);
      const t = ta.length ? O.maxTier(ta.map((a) => a.tier)) : "nodata";
      const lim = ta.filter((a) => a.limited && a.tier !== "nodata");
      const hot = ti.filter((i) => O.TIER[TH.assess[i].tier].rank >= 1);
      return { r, n, t, lim, miss: [...new Set(lim.flatMap((a) => a.missing))], hot, w: wDays[r.k] };
    });
    $("days").innerHTML = cards.map(({ r, n, t, lim, miss, hot, w }) => `<div class="daycard">
        <div class="r" style="align-items:center"><span class="d">${O.fmtDay(r.k)}${n === 0 ? ' <span class="msg">· today</span>' : ""}</span></div>
        <div class="t"><span class="hi">${f(r.hi, 0, "°")}</span> / <span class="lo">${f(r.lo, 0, "°")}</span></div>
        <div class="r"><span>Precip</span><b>${f(r.qpf, 2, '"')} · ${f(r.pop, 0, "%")}</b></div>
        <div class="r"><span>Peak gust</span><b>${f(r.gust, 0, " mph")}</b></div>
        <div class="r"><span>Snow (ens.)</span><b>${!w || !w.st.used ? "—" : `any ${pctTxt(w.st.P[0.1])} · 1"+ ${pctTxt(w.st.P[1])}`}</b></div>
        <div class="r" style="align-items:center"><span>Thunder</span><a href="thunder.html" style="text-decoration:none">${O.badge({ tier: t, limited: lim.length > 0, missing: miss })}</a></div>
        ${hot.length ? `<div class="msg">thunder signal ${O.fmtHour(O.hourOf(T.times[hot[0]]))}–${O.fmtHour((O.hourOf(T.times[hot[hot.length - 1]]) + 1) % 24)}</div>` : ""}
        ${nwsOk ? (() => { const on = (p) => C.time.toLocal(p.s, B.tz).slice(0, 10) === r.k, d = NW.periods.find((p) => p.isDaytime && on(p)), nt = NW.periods.find((p) => !p.isDaytime && on(p));
          return `<div class="r nwsrow"><span><span class="src-nws">NWS</span> day / night</span><b>${d ? `<span class="hi">${d.temp}°</span>` : "—"} / ${nt ? `<span class="lo">${nt.temp}°</span>` : "—"}</b></div>` +
            `<div class="r nwsrow"><span><span class="src-nws">NWS</span> chance</span><b>${d && d.pop != null ? d.pop + "%" : "—"} / ${nt && nt.pop != null ? nt.pop + "%" : "—"}</b></div>` +
            (d ? `<div class="msg" title="${O.esc(d.detailed)}">${O.esc(d.short)}</div>` : ""); })() : ""}
        <div class="msg">${r.contrib.length} models · ${w ? `${w.st.used}/${w.st.total} members` : "no ensemble"}</div>
      </div>`).join("");

    /* headline over the same three calendar days */
    const worst = O.maxTier(cards.map((c) => c.t));
    const qpf = rows.length && rows.every((r) => r.qpf != null) ? rows.reduce((s, r) => s + r.qpf, 0) : null;
    let p1 = null;
    if (mem.length && rows.length) {
      const idx = C.time.dayGroups(W.times).filter((d) => rows.some((r) => r.k === d.k)).flatMap((d) => d.idx);
      if (idx.length) p1 = C.winter.windowStats(mem, idx[0], idx[idx.length - 1] + 1).P[1];
    }
    O.headline({
      word: "NEXT 3 DAYS", note: "Calendar days · same models & weights as each tool",
      stats: [
        { num: f(qpf, 2, '"'), unit: "total precip" },
        { num: pctTxt(p1), unit: 'chance of 1"+ snow' },
        { num: O.TIER[worst].word, unit: "thunder signal", color: O.TIER[worst].rank >= 1 ? O.TIER[worst].color : undefined },
      ],
    });
    O.dataStatus([...(nwsOk ? (NW.errors || []).map((x) => `NWS ${x}`) : [`NWS: ${NW ? NW.reason : "unavailable"}`]), ...B.problems.map((p) => `Blend · ${p}`), ...T.problems.map((p) => `Thunder · ${p}`), ...W.problems.map((p) => `Winter · ${p}`)]);
    $("sumMsg").textContent = `${Object.keys(B.models).length} blend models · ${TH ? TH.ids.length : 0} thunder models · ${mem.length} ensemble members · ${O.tzShort(B.tz)}`;

    renderEventBriefing(B, T, W, TH, mem, wsB, wsT, wsW, nwsOk ? NW : null);

    const snap = { cfg: `${CFG.fingerprint(wsB)}|${CFG.fingerprint(wsT)}|${CFG.fingerprint(wsW)}`, rows: {} };
    cards.forEach(({ r, t, w }) => (snap.rows[r.k] = {
      label: O.fmtDay(r.k), win: r.win, contrib: [...r.contrib, ...(TH ? TH.ids.map((id) => "thunder:" + id) : []), ...(W.ens ? Object.keys(wsW).filter((id) => W.ens[id]).map((id) => "ens:" + id) : [])],
      hi: r.hi, lo: r.lo, qpf: r.qpf, pop: r.pop, gust: r.gust, p1: w && w.st.used ? w.st.P[1] * 100 : null, t }));
    const names = { ...NAMES };
    Object.keys(NAMES).forEach((id) => { names["thunder:" + id] = `${NAMES[id]} (thunder)`; names["ens:" + id] = NAMES[id]; });
    O.renderChanges($("changes"), O.trackChanges("overview", snap), [
      { k: "hi", label: "high", min: 3, fmt: (v) => `${Math.round(v)}°` },
      { k: "lo", label: "low", min: 3, fmt: (v) => `${Math.round(v)}°` },
      { k: "qpf", label: "precip", min: 0.1, fmt: (v) => `${v.toFixed(2)}"` },
      { k: "pop", label: "max chance", min: 15, fmt: (v) => `${Math.round(v)}%` },
      { k: "gust", label: "peak gust", min: 8, fmt: (v) => `${Math.round(v)} mph` },
      { k: "p1", label: '1"+ snow chance', min: 10, fmt: (v) => `${Math.round(v)}%` },
      { k: "t", label: "thunder", tier: true },
    ], names);
  }
  /* Event briefing: every phase of the active event, each source on its own time axis. */
  function renderEventBriefing(B, T, W, TH, mem, wsB, wsT, wsW, NW) {
    const cB = O.eventContext(B), cT = T.empty ? null : O.eventContext(T), cW = W.empty ? null : O.eventContext(W);
    const el = $("eventCard");
    if (!cB) { el.hidden = true; return; }
    const NA = NW && !cB.mismatch ? C.nws.onAxis(NW, B.ms) : null;
    const by = (ctx, key) => ctx && ctx.wins && ctx.wins.find((w) => w.key === key);
    const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
    const pctTxt = (p) => (p == null ? "—" : p > 0 && p < 0.05 ? "<5%" : Math.round(p * 100) + "%");
    const rows = {};
    const rowB = (w) => (rows["b" + w.key] = rows["b" + w.key] || C.blend.windowRow(B, wsB, w.L.idx, w.L.acc));
    const stW = (w) => { const x = by(cW, w.key); if (!x || x.cov.status !== "full" || !mem.length) return null; return (rows["w" + w.key] = rows["w" + w.key] || C.winter.windowStats(mem, x.L.acc[0], x.L.acc[x.L.acc.length - 1] + 1)); };
    const thW = (w) => { const x = by(cT, w.key); if (!x || x.cov.status !== "full" || !TH) return null; const a = x.L.idx.map((i) => TH.assess[i]); const lim = a.filter((y) => y.limited && y.tier !== "nodata"); return { tier: O.maxTier(a.map((y) => y.tier)), limited: lim.length > 0, missing: [...new Set(lim.flatMap((y) => y.missing))] }; };
    O.eventTable(el, cB, [
      { label: "Temp", cell: (w) => { const r = rowB(w); return r.lo == null ? "—" : `<span class="lo">${r.lo.toFixed(0)}°</span>–<span class="hi">${r.hi.toFixed(0)}°</span>`; } },
      { label: "Feels like", cell: (w) => f(rowB(w).feel, 0, "°") },
      { label: "Precip · chance", cell: (w) => `${f(rowB(w).qpf, 2, '"')} · ${f(rowB(w).pop, 0, "%")}` },
      { label: "Peak gust", cell: (w) => f(rowB(w).gust, 0, " mph") },
      { label: "Snow (ens.)", cell: (w) => { const st = stW(w); return !st || !st.used ? "—" : `any ${pctTxt(st.P[0.1])} · 1"+ ${pctTxt(st.P[1])}`; } },
      { label: "Thunder", cell: (w) => { const a = thW(w); return a ? O.badge(a) : "—"; } },
      { label: "Models · members", cell: (w) => { const st = stW(w); return `${rowB(w).contrib.length} · ${st ? `${st.used}/${st.total}` : "—"}`; } },
      ...(NA ? [
        { label: "NWS temp", cell: (w) => { const v = w.L.idx.map((i) => NA.temperature_2m[i]); return v.some((x) => x == null) ? "—" : `<span class="lo">${Math.min(...v).toFixed(0)}°</span>–<span class="hi">${Math.max(...v).toFixed(0)}°</span>`; } },
        { label: "NWS hourly PoP", cell: (w) => { const v = w.L.idx.map((i) => NA.precipitation_probability[i]); return v.some((x) => x == null) ? "—" : `${Math.min(...v)}–${Math.max(...v)}% <span class="msg">hourly</span>`; } },
        { label: "NWS precip", cell: (w) => { const t = C.nws.totalOver(NA.qpf, w.startMs, w.endMs); return !t.covers ? '<span class="msg">not covered</span>' : t.exact ? `${t.lower.toFixed(2)}"` : `${t.lower.toFixed(2)}–${t.upper.toFixed(2)}"`; } },
      ] : []),
    ], { title: "Event briefing", note: "Same models, weights and rules as the tool pages, over each phase's exact hours. A cell shows only when the phase is fully inside the forecast. NWS columns are NWS's own values for the same hours (precip from its interval totals: a range when an interval straddles the phase edge; hourly PoP is a range of hourly values, not a phase probability)." });

    if (cB.mismatch) return;
    /* track the same event windows across updates, keyed by event ID and exact window */
    const ev = cB.ev, snap = { cfg: `${CFG.fingerprint(wsB)}|${CFG.fingerprint(wsT)}|${CFG.fingerprint(wsW)}`, rows: {} };
    cB.wins.filter((w) => w.cov.status === "full").forEach((w) => {
      const r = rowB(w), st = stW(w), th = thW(w);
      snap.rows[w.key] = { label: w.label, win: C.event.windowKey(ev, w), contrib: [...r.contrib, ...(TH ? TH.ids.map((id) => "thunder:" + id) : [])],
        lo: r.lo, hi: r.hi, qpf: r.qpf, pop: r.pop, gust: r.gust, p1: st && st.used ? st.P[1] * 100 : null, t: th ? th.tier : null };
    });
    let box = $("evChanges");
    if (!box) { box = document.createElement("div"); box.id = "evChanges"; box.style.marginTop = "14px"; el.appendChild(box); }
    O.renderChanges(box, O.trackChanges("event_" + ev.id, snap), [
      { k: "lo", label: "low", min: 3, fmt: (v) => `${Math.round(v)}°` },
      { k: "hi", label: "high", min: 3, fmt: (v) => `${Math.round(v)}°` },
      { k: "qpf", label: "precip", min: 0.05, fmt: (v) => `${v.toFixed(2)}"` },
      { k: "pop", label: "max chance", min: 15, fmt: (v) => `${Math.round(v)}%` },
      { k: "gust", label: "peak gust", min: 8, fmt: (v) => `${Math.round(v)} mph` },
      { k: "p1", label: '1"+ snow chance', min: 10, fmt: (v) => `${Math.round(v)}%` },
      { k: "t", label: "thunder", tier: true },
    ], NAMES);
  }

  run();
})();
