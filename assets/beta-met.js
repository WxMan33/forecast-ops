/* Meteorologist beta: a workspace. The map sits beside the timeline and one selected time drives both;
   signals are listed strongest first; models, runs and soundings are one click away in the tool rail.
   Calculations: BetaStory over the Model Blend data and recipe. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, S = window.BetaStory, U = window.BetaUI, FC = window.ForecastClock, $ = O.$, esc = O.esc, H = 3600e3;
  const { fmt, vt, st, deg, inch, mph, fin } = U;
  const PLACES = O.PRESETS.map(([name, lat, lon]) => ({ name, lat, lon }));
  const Q = new URLSearchParams(location.search);
  const fromQ = (() => { const lat = parseFloat(Q.get("lat")), lon = parseFloat(Q.get("lon")); return fin(lat) && fin(lon) ? { name: Q.get("name") || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon } : null; })();
  if (fromQ && !PLACES.some((p) => p.lat === fromQ.lat && p.lon === fromQ.lon)) PLACES.push(fromQ);
  let place = fromQ ? PLACES.find((p) => p.lat === fromQ.lat && p.lon === fromQ.lon) : PLACES[0]; // CVG by default
  const TZ = "America/New_York";
  const head = U.header({ audience: "Meteorologist", other: { self: "meteorologist-beta.html", href: "event-beta.html", label: "Event" },
    ctx: `<label class="sr-only" for="placeSel">Forecast point</label><select class="bx-sel" id="placeSel"></select><span id="selVt" class="bx-note"></span>` });
  document.title = "Meteorologist beta · Forecast Ops";
  $("placeSel").innerHTML = PLACES.map((p, i) => `<option value="${i}" ${p === place ? "selected" : ""}>${esc(p.name.split(",")[0])}</option>`).join("");
  $("placeSel").addEventListener("change", () => { place = PLACES[+$("placeSel").value]; const u = new URL(location.href); u.search = new URLSearchParams({ lat: place.lat, lon: place.lon, name: place.name }); history.replaceState(null, "", u); run(); });
  head.onRefresh(() => run());

  /* one selected time for the whole workspace */
  const bus = U.timeBus(Math.floor(Date.now() / H) * H);
  const showSel = () => { $("selVt").innerHTML = bus.get() ? `Selected ${vt(bus.get(), TZ)}` : ""; };
  bus.on(showSel); showSel();
  bus.on((ms) => { document.body.dataset.selected = ms; }); document.body.dataset.selected = bus.get();

  /* phone: Map | Timeline */
  document.querySelectorAll(".bx-tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { $("work").dataset.tab = b.dataset.tab; document.querySelectorAll(".bx-tabs [data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b))); }));

  const RAIL = [["Workspace", null], ["Models", "blend.html"], ["Weights", "blend.html#forecastControls"], ["Runs", "blend.html#modelTrendCard"], ["Soundings", "severe.html"], ["Thunder", "thunder.html"], ["Winter", "winter.html"], ["Full map", "maps.html"]];
  const drawRail = () => { const q = new URLSearchParams({ lat: place.lat, lon: place.lon, name: place.name });
    $("rail").innerHTML = RAIL.map(([t, h]) => { if (!h) return `<a href="#" aria-current="page">${t}</a>`; const [pg, hash] = h.split("#"); return `<a href="${pg}?${q}${hash ? "#" + hash : ""}">${t}</a>`; }).join(""); };

  let gen = 0, mapMade = null;
  async function run() {
    const g = ++gen, where = { lat: place.lat, lon: place.lon };
    drawRail(); $("pageTitle").textContent = `${place.name.split(",")[0]} forecast workspace`;
    $("strip").innerHTML = '<div class="bx-loading">Loading guidance…</div>'; ["timeline", "signals", "ages", "days"].forEach((id) => { $(id).innerHTML = ""; });
    if (mapMade !== place) { U.mapPanel($("map"), { view: "tristate", field: "refc", place, bus, tz: TZ }); mapMade = place; }
    U.alerts(where).then((a) => { if (g !== gen) return; $("alerts").innerHTML = a.slice(0, 3).map((x) => `<div class="bx-alert" role="alert">${st("action", x.event)}${x.ends ? `<span class="bx-note">until ${esc(fmt.time(Date.parse(x.ends), TZ))}</span>` : ""}<a href="https://forecast.weather.gov/MapClick.php?lat=${place.lat}&lon=${place.lon}" target="_blank" rel="noopener">NWS ↗</a></div>`).join(""); });
    const res = await U.load(where, { days: Math.max(3, O.savedDays(C.config.blend)) });
    if (g !== gen) return;
    if (res.empty) { $("strip").innerHTML = '<div class="bx-err">Model guidance could not be loaded (Open-Meteo unreachable). Try ↻ in a minute.</div>'; return; }
    render(res);
  }

  function render(res) {
    const ctx = res.ctx, B = ctx.B, tz = B.tz, now = ctx.now, s0 = Math.floor(now / H) * H;
    head.setUpdated(B.viewedAt);
    /* number strip: the overview's planning periods (same aggregation), then the 48-hour totals */
    const plan = FC.periods(C, tz, now).primary.slice(0, 3);
    const cells = plan.map((p) => { const r = S.windowRow(ctx, p.s, p.e), ok = r && r.complete, v = ok ? (p.kind === "high" ? r.hi : r.lo) : null;
      return `<div><div class="bx-cap">${esc(p.label)} · ${p.kind === "high" ? "high" : "low"}</div><div class="n ${p.kind === "high" ? "hi" : "lo"}">${deg(v)}</div><div class="s">${esc(fmt.span(p.s, p.e, tz))}${ok && r.qpf >= 0.01 ? ` · ${inch(r.qpf)}` : ""}</div></div>`; });
    const w48 = S.windowRow(ctx, s0, s0 + 48 * H);
    cells.push(`<div><div class="bx-cap">Next 48 h · precip</div><div class="n">${inch(w48 && w48.qpf)}</div><div class="s">Peak gust ${mph(w48 && w48.gust)}${w48 && w48.chanceV != null ? ` · ${U.pct(w48.chanceV * 100)} of members wet` : ""}</div></div>`);
    $("strip").innerHTML = cells.join("");
    /* timeline (72 h) and signals (48 h), both on the selected time */
    const hrs = S.hourly(ctx, s0, s0 + 72 * H);
    $("tlValid").innerHTML = `${esc(fmt.span(s0, s0 + 72 * H, tz))} ${esc(fmt.zone(s0, tz))} · tap to select a time`;
    U.timeline($("timeline"), hrs, { tz, now, bus });
    const sig = S.signals(ctx, s0, s0 + 48 * H, (ms) => fmt.time(ms, tz));
    $("signals").innerHTML = sig.map((x, i) => `<li class="${i ? "" : "first"}"${x.at ? ` data-at="${x.at}" style="cursor:pointer" title="Select this time"` : ""}>${st(x.tier === "normal" ? null : x.tier, x.title)}<div class="d">${esc(x.detail)}</div></li>`).join("") + `<li class="bx-note">Spread among guidance, not a calibrated probability. Blend recipe: ${esc(res.recipe)}.</li>`;
    $("signals").querySelectorAll("[data-at]").forEach((li) => li.addEventListener("click", () => bus.set(+li.dataset.at, "signal")));
    /* days and guidance age */
    const rows = C.blend.dailyRows(B, ctx.ws, ctx.opts).slice(0, 7);
    $("days").innerHTML = rows.map((r) => `<div class="bx-day"><div class="d">${esc(new Date(C.time.toUtc(r.k + "T12:00", tz)).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", day: "numeric" }))}</div><div class="t"><span class="lo">${deg(r.lo)}</span> <span class="hi">${deg(r.hi)}</span></div><div class="x">${inch(r.qpf)} · ${mph(r.gust)}</div><div class="x">${esc(r.ag.word.toLowerCase())}${r.hours < 24 ? " · partial" : ""}</div></div>`).join("");
    const ages = S.guidanceAge(ctx, U.NAMES);
    $("ages").innerHTML = ages.length ? `<table class="bx-age"><thead><tr><th>Source</th><th>Run</th><th class="n">Age</th></tr></thead><tbody>${ages.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.nws ? "updated" : a.unknown ? "—" : esc(fmt.utc(a.init))}</td><td class="n ${a.late ? "bx-late" : ""}">${a.unknown ? '<span class="bx-note">unknown</span>' : esc(fmt.age(a.ageH)) + (a.late ? " · late" : "")}</td></tr>`).join("")}</tbody></table>
      <p class="bx-note" style="margin:6px 0 0">Run times from provider metadata (NWS: last grid update). Late: older than the usual cycle plus typical delay. Unknown: the provider's run metadata has stopped updating.</p>` : '<p class="bx-note">Run metadata unavailable.</p>';
    $("foot").innerHTML = `<span>Model guidance only — not an official forecast or warning.</span><span>Data: Open-Meteo (CC BY 4.0), NWS, NOAA HRRR. ${res.problems.length ? `Partial data: ${esc(res.problems.slice(0, 4).join("; "))}.` : "All requested sources returned data."}</span><span>Beta for colleague testing; same blend, timing and aggregation code as Model Blend and the decision briefing.</span>`;
  }
  run();
})();
