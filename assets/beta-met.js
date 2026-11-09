/* Meteorologist beta: forecast timeline and regional map up front, with valid times, guidance age and a
   quick read on model disagreement. Calculations: BetaStory over the Model Blend data and recipe. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, S = window.BetaStory, U = window.BetaUI, FC = window.ForecastClock, $ = O.$, esc = O.esc, H = 3600e3;
  const { fmt, deg, inch, mph, fin } = U;
  const PLACES = O.PRESETS.map(([name, lat, lon]) => ({ name, lat, lon }));
  const Q = new URLSearchParams(location.search);
  const fromQ = (() => { const lat = parseFloat(Q.get("lat")), lon = parseFloat(Q.get("lon")); return fin(lat) && fin(lon) ? { name: Q.get("name") || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon } : null; })();
  let place = fromQ || PLACES[0]; // CVG is the default for this beta
  const head = U.header({ audience: "Meteorologist", other: { self: "meteorologist-beta.html", href: "event-beta.html", label: "Event view" } });
  document.title = "Meteorologist beta · Forecast Ops";
  if (fromQ && !PLACES.some((p) => p.lat === fromQ.lat && p.lon === fromQ.lon)) PLACES.push(fromQ);
  $("placeSel").innerHTML = PLACES.map((p, i) => `<option value="${i}" ${p === place ? "selected" : ""}>${esc(p.name.split(",")[0])}</option>`).join("");
  $("placeSel").addEventListener("change", () => { place = PLACES[+$("placeSel").value]; const u = new URL(location.href); u.search = new URLSearchParams({ lat: place.lat, lon: place.lon, name: place.name }); history.replaceState(null, "", u); run(); });
  head.onRefresh(() => run(true));

  const TOOLS = [
    ["blend.html#forecastControls", "Model weights", "Recipe, per-period weights and each source's share"],
    ["blend.html", "Individual guidance", "Every model, NWS and ensemble side by side, with the daily table"],
    ["blend.html#modelTrendCard", "Run comparisons", "What changed between runs (shared CVG archive)"],
    ["severe.html", "Soundings", "Model soundings, hodographs and severe ingredients"],
    ["thunder.html", "Thunder", "Hourly instability and thunder signals by model"],
    ["winter.html", "Winter", "Ensemble snow totals, thresholds and precipitation type"],
  ];
  /* deeper tools open on the same point (the full workspace reads lat/lon/name from the link) */
  const drawTools = () => { const q = new URLSearchParams({ lat: place.lat, lon: place.lon, name: place.name }); $("tools").innerHTML = TOOLS.map(([h, b, s]) => { const [pg, hash] = h.split("#"); return `<a class="bx-tool" href="${pg}?${q}${hash ? "#" + hash : ""}"><b>${esc(b)} →</b><span>${esc(s)}</span></a>`; }).join(""); };

  let gen = 0;
  async function run(force) {
    const g = ++gen, where = { lat: place.lat, lon: place.lon };
    $("placeName").textContent = place.name.split(",")[0]; drawTools();
    $("placeSub").textContent = `${place.name.split(",").slice(1).join(",").trim() || "Custom point"} · ${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}`;
    $("periods").innerHTML = '<div class="bx-loading">Loading guidance…</div>'; $("agree").innerHTML = ""; $("timeline").innerHTML = ""; $("ages").innerHTML = ""; $("days").innerHTML = "";
    $("mapFull").href = U.map($("map"), { view: "tristate", field: "refc", place });
    U.alerts(where).then((a) => { if (g !== gen) return; $("alerts").innerHTML = a.slice(0, 3).map((x) => `<div class="bx-alert" role="alert"><span>⚠</span><span>${esc(x.event)}${x.ends ? ` · until ${esc(fmt.time(Date.parse(x.ends), "America/New_York"))}` : ""}</span><a href="https://forecast.weather.gov/MapClick.php?lat=${place.lat}&lon=${place.lon}" target="_blank" rel="noopener">NWS details ↗</a></div>`).join(""); });
    const res = await U.load(where, { days: Math.max(3, O.savedDays(C.config.blend)) });
    if (g !== gen) return;
    if (res.empty) { $("periods").innerHTML = '<div class="bx-err">Model guidance could not be loaded (Open-Meteo unreachable). Try ↻ in a minute.</div>'; return; }
    render(res);
  }

  function render(res) {
    const ctx = res.ctx, B = ctx.B, tz = B.tz, now = ctx.now, zone = fmt.zone(now, tz);
    head.setUpdated(B.viewedAt);
    /* periods: the overview's planning periods, aggregated exactly as the overview does */
    const plan = FC.periods(C, tz, now);
    const tiles = plan.primary.map((p) => ({ p, r: S.windowRow(ctx, p.s, p.e) }));
    $("periodsValid").innerHTML = `Times in <b>${esc(zone)}</b> · valid ${esc(fmt.span(plan.primary[0].s, plan.primary.at(-1).e, tz))}`;
    $("periods").innerHTML = tiles.map(({ p, r }) => {
      const ok = r && r.complete, v = ok ? (p.kind === "high" ? r.hi : r.lo) : null, rng = ok ? (p.kind === "high" ? r.hiR : r.loR) : null;
      return `<div class="bx-period"><div class="lbl">${esc(p.label)}</div><div class="val ${p.kind === "high" ? "hi" : "lo"}">${deg(v)}</div>
        <div class="kind">${p.kind === "high" ? "High" : "Low"}${rng && fin(rng[0]) && rng[1] - rng[0] >= 1 ? ` · guidance ${Math.round(rng[0])}–${Math.round(rng[1])}°` : ""}</div>
        <div class="facts"><span><b>${inch(ok ? r.qpf : null)}</b> precip${ok && r.chanceV != null ? (r.chanceV === 0 ? " · dry in every ensemble member" : ` · ${U.pct(r.chanceV * 100)} of members wet`) : ""}</span><span>Gusts <b>${mph(ok ? r.gust : null)}</b>${ok && r.thunder && C.TIERS[r.thunder] && r.thunder !== "normal" && r.thunder !== "nodata" ? ` · thunder ${esc(C.TIERS[r.thunder].word.toLowerCase())}` : ""}</span>
        <span class="bx-note">${esc(fmt.span(p.s, p.e, tz))}</span>${ok ? "" : '<span class="bx-note">Incomplete hourly coverage</span>'}</div></div>`;
    }).join("");
    /* disagreement over the next 24 hours */
    const s0 = Math.floor(now / H) * H, d = S.disagreement(ctx, s0, s0 + 24 * H);
    $("agreeValid").innerHTML = `Next 24 h · <b>${esc(fmt.span(s0, s0 + 24 * H, tz))}</b>`;
    if (d) {
      const row = (lvl, title, text) => `<div class="bx-agree-row"><span class="bx-dot ${lvl || ""}"></span><div><b>${esc(title)}: ${esc(lvl ? S.AGREE_WORD[lvl] : "Not enough data")}</b><span class="bx-note">${text}</span></div></div>`;
      const tempTxt = fin(d.temp.p10) ? `Highs ${Math.round(d.temp.p10)}–${Math.round(d.temp.p90)}° across guidance (10th–90th percentile, weighted); ${d.temp.n} sources span ${Math.round(d.temp.range ?? 0)}°.` : "—";
      const pTxt = `${d.precip.wet} of ${d.precip.of} sources have measurable precipitation (≥0.01″ in an hour)${d.precip.qpfR && fin(d.precip.qpfR[0]) ? `; totals ${d.precip.qpfR[0].toFixed(2)}–${d.precip.qpfR[1].toFixed(2)}″` : ""}.`;
      const tTxt = d.precip.wet === 0 ? "No source shows precipitation starting, so there is no start time to compare." : d.timing.n >= 2 ? `First precipitation ${esc(fmt.time(d.timing.first, tz))} – ${esc(fmt.time(d.timing.last, tz))} across ${d.timing.n} sources (${Math.round(d.timing.spreadH)} h spread).` : d.timing.active ? `${d.timing.active} sources already have precipitation under way.` : "Fewer than two sources show a distinct start time.";
      $("agree").innerHTML = `<p class="bx-overall">${esc(d.overall ? S.AGREE_WORD[d.overall] : "Limited guidance")}</p><div class="bx-agree">${row(d.temp.level, "Temperature", esc(tempTxt))}${row(d.precip.level, "Precipitation", esc(pTxt))}${d.precip.wet === 0 ? `<div class="bx-agree-row"><span class="bx-dot"></span><div><b>Timing: nothing to time</b><span class="bx-note">${tTxt}</span></div></div>` : row(d.timing.level, "Timing", tTxt)}</div>
        <p class="bx-note" style="margin-top:12px">Spread among guidance, not a calibrated probability. Blend recipe: ${esc(res.recipe)}.</p>`;
    }
    /* timeline: 72 hours from the current hour */
    const hrs = S.hourly(ctx, s0, s0 + 72 * H);
    $("tlValid").innerHTML = `Hourly, <b>${esc(fmt.span(s0, s0 + 72 * H, tz))}</b> · ${esc(zone)} · tap or hover for values`;
    U.timeline($("timeline"), hrs, { tz, now });
    /* guidance age */
    const ages = S.guidanceAge(ctx, U.NAMES);
    $("ages").innerHTML = ages.length ? `<table class="bx-age"><thead><tr><th>Source</th><th>Run</th><th class="n">Age</th></tr></thead><tbody>${ages.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.nws ? "updated" : a.unknown ? "—" : esc(fmt.utc(a.init))}</td><td class="n ${a.late ? "bx-late" : ""}">${a.unknown ? '<span class="bx-note">run time unknown</span>' : esc(fmt.age(a.ageH)) + (a.late ? " · late" : "")}</td></tr>`).join("")}</tbody></table>
      <p class="bx-note">Run initialisation time from each provider's metadata (NWS: last grid update). "Late" means older than the source's usual cycle plus its typical delay. "Run time unknown": the provider's run metadata has stopped updating; the forecast values themselves still load.</p>` : '<p class="bx-note">Run metadata unavailable.</p>';
    /* days */
    const rows = C.blend.dailyRows(B, ctx.ws, ctx.opts).slice(0, 7);
    $("days").innerHTML = rows.map((r) => `<div class="bx-day"><div class="d">${esc(new Date(C.time.toUtc(r.k + "T12:00", tz)).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", day: "numeric" }))}</div><div class="t"><span class="lo">${deg(r.lo)}</span> / <span class="hi">${deg(r.hi)}</span></div><div class="x">${inch(r.qpf)} · gust ${mph(r.gust)}</div><div class="x">${esc(r.ag.word.toLowerCase())} on the high${r.hours < 24 ? " · partial day" : ""}</div></div>`).join("");
    $("foot").innerHTML = `<span>Model guidance only — not an official forecast or warning. Check NWS products for watches and warnings.</span><span>Data: Open-Meteo (CC BY 4.0), NWS, NOAA HRRR. ${res.problems.length ? `Partial data: ${esc(res.problems.slice(0, 4).join("; "))}.` : "All requested sources returned data."}</span><span>Beta build for colleague testing. Same blend, timing and aggregation code as Model Blend and the decision briefing.</span>`;
  }
  run();
})();
