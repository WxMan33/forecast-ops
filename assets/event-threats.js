/* Event Manager: "Weather threats" for the open event. The products, source states and matcher are the Weather Threats
   map's own (ThreatsLive, ThreatsMatch), so the map and the planner agree about what covers the venue and when.
   This file knows nothing about any one feed: it lists what the matcher returns for the event's location and schedule.
     update(ev)  re-match for the event on screen (venue, date or schedule changed)
   Data: live official feeds (NWS through the same-origin function on Pages previews), or an archived official sample with
   ?threats=archive-flood-day | archive-flood-night | archive-winter-advisory | archive-winter-warning | archive-winter-outlook
   (labelled as such). Families shown: flooding and winter weather. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, T = window.ThreatsCore, M = window.ThreatsMatch, Live = window.ThreatsLive, esc = O.esc, $ = O.$;
  const Q = new URLSearchParams(location.search);
  const ARCHIVE = /^archive-(flood-(day|afternoon|outage|night)|winter-(advisory|warning|outlook)|fire-(day4|day2|day1|watch|warning|incidents)|smoke-(chicago|metlife|forecast-0714|forecast-0715))$/.test(Q.get("threats") || "") ? Q.get("threats") : null;
  // live: every family in this slice; an archived sample only has its own hazard's products, so it is checked for that one
  const FAMILIES = ARCHIVE ? [ARCHIVE.split("-")[1]] : ["flood", "winter", "fire", "smoke"];
  const F = window.ThreatsFeeds, pct = (n) => (n >= 5 ? n + "%" : "under 5%");
  let ev = null, data = null, ready = false, open = new Set(), archived = null;

  const fmt = (iso, tz) => new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const mapLink = (it) => {
    const p = it.product, u = new URL("threats.html", location.href), q = u.searchParams;
    q.set("lat", ev.loc.lat); q.set("lon", ev.loc.lon); q.set("name", ev.loc.name); q.set("tz", ev.tz); q.set("scope", "venue");
    if (it.family === "smoke") { q.set("view", "active"); q.set("layers", "smoke"); if (p.kind === "smoke" || p.kind === "aqobs") q.set("sel", p.id); }
    else if (p.kind === "incident") { q.set("view", "active"); q.set("layers", "fire"); q.set("sel", p.id); }
    else if (/^spcfire-/.test(p.program || "")) { q.set("view", "fire"); q.set("fday", p.day); q.set("layers", "fire"); q.set("sel", p.id); }
    else if (p.program === "wssip") { q.set("view", "winter"); q.set("wwin", p.validStart); q.set("wlevel", p.category); q.set("layers", it.family); }
    else { q.set("view", p.kind === "outlook" ? "day" + p.day : "active"); q.set("layers", it.family); q.set("sel", p.id); }
    if (ARCHIVE) q.set("scenario", ARCHIVE);
    if (Live.NWS.mode === "function" && !Q.get("nwsBase")) q.set("nws", "function");
    return u.toString();
  };
  function snapshot() {
    if (ARCHIVE) return archived ? { ...archived } : { products: [], sources: {}, loading: true, clock: new Date().toISOString() };
    return Live.snapshot();
  }
  function render() {
    const box = $("threats"); if (!box || !ev) return;
    if (!ev.loc || !Number.isFinite(+ev.loc.lat)) { box.innerHTML = '<p class="bx-note">Pick the venue to check weather threats.</p>'; return; }
    data = snapshot(); const now = Date.parse(data.clock);
    if (data.loading || !ready) { box.innerHTML = '<p class="bx-note">Checking official flood, winter and fire weather alerts and outlooks, wildfire incidents, smoke and air quality…</p>'; return; }
    const state = Live.registryState(data, now);
    const r = M.forEvent({ products: data.products, state, event: { lat: +ev.loc.lat, lon: +ev.loc.lon, name: ev.loc.name, tz: ev.tz, windows: C.event.windows(ev) }, now, families: FAMILIES });
    const tz = ev.tz;
    const items = r.items.map((it) => {
      const p = it.product, id = esc(it.id), isOpen = open.has(it.id), src = state[p.sourceId] || {};
      const wsp = p.program === "wssip", started = p.kind !== "outlook" && Date.parse(p.issued) > now;
      const inc = p.kind === "incident", fo = /^spcfire-/.test(p.program || ""), acres = (v) => Math.round(v).toLocaleString("en-US") + " acres";
      const sm = it.family === "smoke", obsT = (iso) => esc(fmt(iso, tz));
      const rows = sm && p.kind === "smoke" ? [
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">HMS smoke analysis</a>`],
        ["Observed", obsT(p.obsStart) + " → " + obsT(p.obsEnd) + " (" + esc(p.satellite || "satellite") + " imagery)"],
        ["Density", esc(p.density) + " (analyst's estimate of how thick the smoke looks from space)"],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Venue", "Inside the outlined smoke area"],
        ["What it means", "Smoke somewhere in the air column above the venue. Satellite smoke does not measure air quality at the ground; see the AirNow reading for that. A current observation, not a forecast."],
      ] : sm && p.kind === "aqobs" ? [
        ["Source", `EPA AirNow · ${esc(p.agency || "")} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">AirNow</a>`],
        ["Monitor", esc(p.site + (p.area ? " · " + p.area.split("|")[0] + " reporting area" : "") + " · " + window.ThreatsCore.distanceText(it.distanceKm) + " from the venue")],
        ["Observed", obsT(p.observed) + " (hourly reading)"],
        ["Reading", esc("AQI " + p.aqi + " " + p.category + " (" + p.pollutant + ")") + (p.pm25 != null ? esc(" · PM2.5 " + p.pm25 + " µg/m³") : "") + esc(" · all: " + Object.entries(p.values).map(([k, v]) => k + " " + v).join(", "))],
        ["Monitors within 15 mi", esc(String(it.monitors))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Note", "Preliminary data, not fully validated (AirNow). Fine particles (PM2.5) have many sources; this reading alone does not say the cause."],
      ] : sm && p.kind === "aqfcst" ? [
        ["Source", `${esc(p.agency || "State or local air agency")} via <a href="${esc(p.source.url)}" target="_blank" rel="noopener">AirNow</a>`],
        ["Forecast for", esc(p.validDate + " (" + p.area + ", " + p.state + " reporting area)")],
        ["Issued", esc(p.issued || "not stated")],
        ["Forecast", esc(p.category + (p.aqi != null ? " · AQI " + p.aqi : " (category only)") + " · " + p.pollutant + (p.actionDay ? " · Air quality action day" : ""))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) : "not yet"],
        ["Details", esc(p.discussion || "A forecast for the whole day; it does not time anything within it.")],
      ] : sm && p.kind === "smokefcst" ? [
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">NOAA air quality guidance</a>`],
        ["Model run", esc(new Date(p.run).toISOString().slice(0, 16).replace("T", " ") + "Z")],
        ["Hours with smoke", esc(it.phases.join(", ") + " · highest " + it.peak.v.toFixed(1) + " at " + fmt(new Date(Date.parse(it.peak.t) - 3600e3).toISOString(), tz))],
        ["Units", "As published by NOAA's service, which labels the values \u201cmicrograms per cubic feet\u201d; being confirmed with NOAA. Shown here only to compare hours."],
        ["Covers through", esc(fmt(p.validEnd, tz)) + " (48-hour guidance)"],
        ["What it means", "Model guidance for smoke from fires near the ground, not an official forecast or a measurement."],
      ] : inc ? [
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">WFIGS current incidents</a>${p.uniqueId ? " · " + esc(p.uniqueId) : ""}`],
        ["Type", esc(p.event + (p.imt ? " · " + p.imt : ""))],
        ["Size", p.acres != null ? esc(acres(p.acres)) + " (as reported for the incident)" : "not reported"],
        ["Containment", p.contained != null ? esc(p.contained + "%") : "not reported"],
        ["Discovered", p.discovered ? esc(fmt(p.discovered, tz)) : "not reported"],
        ["Updated", p.updated ? esc(fmt(p.updated, tz)) + " (NIFC incident record)" : "unknown"],
        ["Perimeter", p.perimeter ? "Mapped " + (p.perimeter.date ? esc(fmt(p.perimeter.date, tz)) : "date not given") + (p.perimeter.acres ? " · " + esc(acres(p.perimeter.acres)) : "") + (p.perimeter.method ? " · " + esc(p.perimeter.method) : "") : "No mapped perimeter; distance is to the reported location"],
        ["Venue", esc(it.inside ? "Inside the mapped perimeter" : window.ThreatsCore.distanceText(it.distanceKm) + " " + it.relation.dir + " of the venue to the " + (it.pointOnly ? "reported location" : "perimeter edge"))],
        ["Location", esc([p.county, p.state].filter(Boolean).join(", ") + (p.unit ? " · " + p.unit : ""))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Details", "Incidents stay in NIFC's current list until declared contained, controlled or out, or until they go 3 to 14 days without an update (by size). NIFC: the data \u201care not legal documents\u201d. Follow local officials for evacuations and closures."],
      ] : fo ? [
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">SPC Day ${esc(p.day)} fire weather outlook</a>${p.forecaster ? " · forecaster " + esc(p.forecaster) : ""}`],
        ["Issued", esc(fmt(p.issued, tz))],
        ["Valid", esc(fmt(p.validStart, tz)) + " → " + esc(fmt(p.validEnd, tz))],
        ["Category", esc(p.day >= 3 ? (p.category === "CRIT" ? "Critical area (Day 3-8 categorical outlook)" : F.FIRE_NAME[p.category] + " probability of critical conditions within 12 miles") : F.FIRE_NAME[p.category] + (p.part === "dryt" ? "" : " (wind and relative humidity)"))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Venue", "Inside the highest " + (p.part === "dryt" ? "dry thunderstorm" : "fire weather") + " category that reaches the venue"],
        ["Details", esc((F.FIRE_MEANING[p.category] || "Critical fire weather conditions.") + " SPC verifies these by the weather (wind, humidity, dry thunderstorms), not by whether fires start; receptive fuels must be present.")],
      ] : wsp ? [
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">WSSI-P (official product)</a>`],
        ["Issued", p.issued ? "WPC file " + esc(fmt(p.issued, tz)) : "not stated by the source"],
        ["Valid", "24 hours, " + esc(fmt(p.validStart, tz)) + " → " + esc(fmt(p.validEnd, tz))],
        ["Chances at the venue", it.levels.map(([L, v]) => esc((L === "WWA" ? "Winter weather (any)" : F.WSSI_NAME[L]) + " " + pct(v) + ((src.inferred || []).includes(L) ? " (inferred: the service didn't answer for this level; the level below has no area here)" : ""))).join(" · ")],
        ["Overlaps", esc(it.phases.join(", "))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Covers through", src.reachEnd ? esc(fmt(src.reachEnd, tz)) + " (the last 24-hour window WPC has published)" : "unknown"],
        ["Venue", esc(p.pointHit ? "Probabilities at the venue pin (WPC map service point query)" : "Inside WPC's " + p.prob + "% area for at least " + F.WSSI_NAME[p.category] + (p.category === "WWA" ? "" : " impacts"))],
        ["Details", esc(F.WSSI_MEANING[p.category] + " WSSI-P gives the chance of reaching each impact level somewhere in the 24 hours; it does not time anything within them.")],
      ] : [
        ["Source", `${esc(p.office || "")}${p.source && p.source.url ? ` · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">official product</a>` : ""}`],
        ["Issued", esc(fmt(p.kind === "outlook" ? p.issued : p.firstSeen || p.issued, tz)) + (p.updated && p.updated !== (p.firstSeen || p.issued) && p.kind !== "outlook" ? " · updated " + esc(fmt(p.updated, tz)) : "")],
        [p.kind === "outlook" ? "Valid" : "In effect", p.kind === "outlook" ? esc(fmt(p.validStart, tz)) + " → " + esc(fmt(p.validEnd, tz)) : (started ? "from " + esc(fmt(p.issued, tz)) + " " : "") + "until " + esc(fmt(p.expires, tz))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Venue", esc(it.relation.kind === "unknown" ? "Unknown: the area isn't fully drawn" : p.kind === "outlook" ? "Inside the highest category that reaches the venue (" + (F.ERO_NAME[p.category] || p.category) + ")" : "Inside the " + p.kind + " area" + (p.geometrySource === "counties" ? " (drawn from the NWS " + ((p.zones || []).some((u) => /\/zones\/fire\//.test(u)) ? "fire weather" : "forecast") + " zones it lists: " + (p.zones || []).map((u) => u.split("/").pop()).join(", ") + ")" : ""))],
        ["Details", esc(p.headline || p.hazard || "")],
      ];
      return `<li class="et-item" data-family="${esc(it.family)}" data-kind="${esc(it.kind)}">
        <div class="et-main"><b class="et-head">${esc(it.headline)}</b><span class="et-line">${esc(it.line)}</span>
          <span class="et-actions"><button type="button" class="bx-link et-more" data-id="${id}" aria-expanded="${isOpen}">More info</button> · <a class="bx-link" href="${esc(mapLink(it))}" data-map="${id}">View on map</a></span></div>
        <dl class="et-detail" ${isOpen ? "" : "hidden"}>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></li>`;
    }).join("");
    const statuses = r.statuses.map((s) => `<li class="${s.ok ? "" : "et-warn"}"><b>${esc(s.name)}</b> · ${esc(s.text)}</li>`).join("");
    const label = ARCHIVE ? `<p class="et-sample"><span class="bx-label">Archived sample</span> ${esc(data.archive ? data.archive.label : "")}. Real official products replayed at that time; not live.</p>` : "";
    const notes = (r.notes || []).map((n) => `<p class="et-note" data-note="${esc(n.id)}">${esc(n.text)}</p>`).join("");
    box.innerHTML = `${label}${notes}<p class="et-summary${r.items.length ? " has" : r.confirmed ? "" : " warn"}" data-confirmed="${r.confirmed}">${esc(r.summary)}</p>
      ${items ? `<ul class="et-list">${items}</ul>` : ""}
      <details class="bx-more et-sources"><summary>Sources checked for this event</summary><ul>${statuses}</ul>
      <p class="bx-note">Matched to the venue pin and the event's own schedule (${esc(tz)}). Official warnings and outlooks only; daily outlooks flag a period and do not time anything within it. Delivery by email, text or push is not part of this preview.</p></details>`;
    box.dataset.items = String(r.items.length); box.dataset.confirmed = String(r.confirmed);
    window.EventThreatsLast = r; // read by the preview checks
  }
  function wssiCheck() { if (!ARCHIVE && ready && ev && ev.loc && Number.isFinite(+ev.loc.lat)) Live.wssiFor(+ev.loc.lat, +ev.loc.lon); }
  function aqCheck() { if (!ARCHIVE && ready && ev && ev.loc && Number.isFinite(+ev.loc.lat) && Live.aqFor) Live.aqFor(+ev.loc.lat, +ev.loc.lon); }
  function update(next) { ev = next; wssiCheck(); aqCheck(); render(); }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".et-more"); if (!b) return;
    const id = b.dataset.id; if (open.has(id)) open.delete(id); else open.add(id); render();
  });

  async function start() {
    if (ARCHIVE) { try { archived = await Live.archiveSnapshot(ARCHIVE); } catch (e) { archived = { products: [], sources: {}, clock: new Date().toISOString(), loadError: e.message }; } ready = true; render(); return; }
    await Live.start({ only: ["alerts", "ero", "fire", "nifc", "hms"] }); ready = true; wssiCheck(); aqCheck(); render();
    Live.onUpdate(() => render());
    setInterval(() => { if (!document.hidden) render(); }, 30e3);
  }
  window.EventThreats = { update, render, current: () => ev };
  start();
})();
