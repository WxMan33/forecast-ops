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
  const ARCHIVE = /^archive-(flood-(day|afternoon|outage|night)|winter-(advisory|warning|outlook)|fire-(day4|day2|day1|watch|warning|incidents)|smoke-(chicago|metlife|forecast-0714|forecast-0715)|tropical-(watch|warning)|coastal-flagler|aviation-(chicago|enroute))$/.test(Q.get("threats") || "") ? Q.get("threats") : null;
  // live: every family in this slice; an archived sample only has its own hazard's products, so it is checked for that one
  const FAMILIES = ARCHIVE ? [ARCHIVE.split("-")[1]] : ["flood", "winter", "fire", "smoke", "tropical", "coastal", "aviation"];
  /* Airports for the event (primary and optional alternate, each with its own arrival and departure window, in the event's
     local time). Kept with Weather Threats, not in Event Manager's event record: per event in this browser, or in a link as
     ?air=[{"i":"KORD","r":"p","a":["2026-11-22T10:45","2026-11-22T11:30"],"d":[...]}, …]. */
  const AIR_KEY = "threats_airports_v1";
  const evKey = (e) => (e.id && e.id !== "link" ? e.id : "link:" + (e.loc && e.loc.name) + "@" + (e.times && e.times.start));
  /* airports that arrived in a shared link (?air=) apply until the person saves their own; they are also kept with the
     event in this browser, so they survive a reload or saving the shared event to this browser's list */
  /* only well-formed entries count: a valid ICAO-style ID, role p or a, and windows as two local date-times; anything else
     in a link is ignored and the event opens with its defaults */
  const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, okWin = (w) => w == null || (Array.isArray(w) && w.length === 2 && w.every((x) => typeof x === "string" && DT.test(x)));
  const cleanAir = (a) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x.i === "string" && /^[A-Za-z][A-Za-z0-9]{3}$/.test(x.i) && (x.r === "p" || x.r === "a") && okWin(x.a) && okWin(x.d))
    .map((x) => ({ i: x.i.toUpperCase(), r: x.r, a: x.a || null, d: x.d || null })).filter((x, k, all) => all.findIndex((y) => y.r === x.r) === k).slice(0, 2);
  let linkAir = (() => { try { const a = cleanAir(JSON.parse(Q.get("air") || "null")); return a.length ? a : null; } catch (x) { return null; } })();
  let shareAir = true; // the sender can leave the airports (and the route) out of the links (Share menu)
  /* An optional route for the flight: origin, destination, an altitude band (ft) and the time in the air, local. Kept beside
     the airports, per event in this browser, or in a link as ?rt={"o":"KORD","d":"KEWR","lo":10000,"hi":16000,"w":[from,to]}.
     It is drawn as a straight line between the two airports and labelled an approximate route. */
  const RT_KEY = "threats_route_v1";
  const cleanRoute = (x) => { if (!x || typeof x !== "object") return null; const id = (v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9]{3}$/.test(v); const ft = (v) => Number.isInteger(v) && v >= 0 && v <= 60000;
    if (!id(x.o) || !id(x.d) || x.o.toUpperCase() === x.d.toUpperCase() || !ft(x.lo) || !ft(x.hi) || !(x.hi > x.lo) || !okWin(x.w)) return null; return { o: x.o.toUpperCase(), d: x.d.toUpperCase(), lo: x.lo, hi: x.hi, w: x.w || null }; };
  let linkRt = (() => { try { return cleanRoute(JSON.parse(Q.get("rt") || "null")); } catch (x) { return null; } })();
  function routeRaw(e) { if (linkRt) return linkRt; try { return cleanRoute((JSON.parse(localStorage.getItem(RT_KEY) || "{}") || {})[evKey(e)]); } catch (x) { return null; } }
  function saveRoute(e, r) { try { const all = JSON.parse(localStorage.getItem(RT_KEY) || "{}") || {}; if (r) all[evKey(e)] = r; else delete all[evKey(e)]; localStorage.setItem(RT_KEY, JSON.stringify(all)); } catch (x) { /* no storage */ } }
  /* the route's time in the air: its own, else the arrival window at its destination, else the departure window at its origin */
  function routeOf(e) {
    const r = routeRaw(e); if (!r) return null;
    const own = win(r.w, e.tz), aps = airportsOf(e), toAp = aps.find((a) => a.icao === r.d && a.arrive), fromAp = aps.find((a) => a.icao === r.o && a.depart);
    const w = own || (toAp && toAp.arrive) || (fromAp && fromAp.depart) || null;
    return { o: r.o, d: r.d, lowFt: r.lo, highFt: r.hi, startMs: w ? w.startMs : null, endMs: w ? w.endMs : null, timeSource: own ? "own" : toAp ? "arrival at " + r.d : fromAp ? "departure from " + r.o : null, raw: r };
  }
  function airportsRaw(e) {
    if (linkAir) return linkAir;
    try { return (JSON.parse(localStorage.getItem(AIR_KEY) || "{}") || {})[evKey(e)] || []; } catch (x) { return []; }
  }
  function saveAirports(e, list) { try { const all = JSON.parse(localStorage.getItem(AIR_KEY) || "{}") || {}; all[evKey(e)] = list; localStorage.setItem(AIR_KEY, JSON.stringify(all)); } catch (x) { /* no storage */ } }
  const win = (pair, tz) => { if (!pair || !pair[0] || !pair[1]) return null; const s = C.time.toUtc(pair[0], tz), en = C.time.toUtc(pair[1], tz); return Number.isFinite(s) && Number.isFinite(en) && en > s ? { startMs: s, endMs: en, local: pair } : null; };
  const airportsOf = (e) => airportsRaw(e).filter((x) => x && /^[A-Za-z][A-Za-z0-9]{3}$/.test(x.i || "")).slice(0, 2).map((x) => ({ icao: x.i.toUpperCase(), role: x.r === "a" ? "alternate" : "primary", arrive: win(x.a, e.tz), depart: win(x.d, e.tz), raw: x }));
  const F = window.ThreatsFeeds, EN = window.ThreatsEnroute, pct = (n) => (n >= 5 ? n + "%" : "under 5%");
  /* the airports to fetch reports for: the event's, then the route's ends (at most 4) */
  const airIds = (e) => { const r = routeRaw(e); return [...new Set([...airportsOf(e).map((a) => a.icao), ...(r ? [r.o, r.d] : [])])].slice(0, 4); };
  const routeBox = (rr) => { const xs = [rr.oPt[0], rr.dPt[0]], ys = [rr.oPt[1], rr.dPt[1]]; return [Math.max(-90, Math.min(...ys) - 1.5), Math.max(-180, Math.min(...xs) - 1.5), Math.min(90, Math.max(...ys) + 1.5), Math.min(180, Math.max(...xs) + 1.5)]; };
  let ev = null, data = null, ready = false, open = new Set(), archived = null;

  const fmt = (iso, tz) => new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const mapLink = (it) => {
    const p = it.product, u = new URL("threats.html", location.href), q = u.searchParams;
    q.set("lat", ev.loc.lat); q.set("lon", ev.loc.lon); q.set("name", ev.loc.name); q.set("tz", ev.tz); q.set("scope", "venue");
    if (it.family === "aviation") { q.set("view", "active"); q.set("layers", "aviation"); q.set("air", airIds(ev).join(",")); if (it.airport) q.set("ap", it.airport); if (p.id) q.set("sel", p.id);
      const rt = routeRaw(ev); if (rt) q.set("rt", JSON.stringify(rt));
      if (it.kind === "enroute" || it.kind === "pirep" || it.kind === "route") { const rr = routeOf(ev); if (rr) q.set("alt", rr.lowFt + "-" + rr.highFt); if (it.window && it.kind === "enroute") q.set("at", new Date(it.window.startMs).toISOString()); if (it.kind === "route") q.set("fit", "route"); } }
    else if (p.kind === "tcwind") { q.set("view", "active"); q.set("layers", "tropical"); }
    else if (it.family === "smoke") { q.set("view", "active"); q.set("layers", "smoke"); if (p.kind === "smoke" || p.kind === "aqobs") q.set("sel", p.id); }
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
    if (data.loading || !ready) { box.innerHTML = '<p class="bx-note">Checking official flood, winter, fire weather, tropical and coastal alerts and outlooks, wildfire incidents, smoke and air quality…</p>'; return; }
    const state = Live.registryState(data, now);
    const pk = (+ev.loc.lat).toFixed(4) + "," + (+ev.loc.lon).toFixed(4), zones = ARCHIVE ? (data.points && data.points[pk]) || null : Live.pointZones ? Live.pointZones(+ev.loc.lat, +ev.loc.lon) : null;
    const airports = airportsOf(ev), route = routeOf(ev);
    const r = M.forEvent({ products: data.products, state, event: { lat: +ev.loc.lat, lon: +ev.loc.lon, name: ev.loc.name, tz: ev.tz, windows: C.event.windows(ev), zones, airports, route }, now, families: FAMILIES });
    if (!ARCHIVE && r.route && r.route.oPt && r.route.dPt && Live.enrouteFor) Live.enrouteFor([routeBox(r.route)]); // cached; asks once both ends are placed
    const tz = ev.tz;
    const renderItem = (it) => {
      const p = it.product, id = esc(it.id), isOpen = open.has(it.id), src = state[p.sourceId] || {};
      const wsp = p.program === "wssip", started = p.kind !== "outlook" && Date.parse(p.issued) > now;
      const inc = p.kind === "incident", fo = /^spcfire-/.test(p.program || ""), acres = (v) => Math.round(v).toLocaleString("en-US") + " acres";
      const sm = it.family === "smoke", obsT = (iso) => esc(fmt(iso, tz));
      const zt = (iso) => { const d = new Date(iso); return String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z"; };
      const ftT = (v) => (EN ? EN.ftText(v) : v + " ft"), rr = routeOf(ev);
      const rows = it.kind === "faa" ? [
        ["Airport", esc(p.airportName + " (FAA " + p.airportFaa + ") · " + it.role + " airport")],
        ["What", esc(p.typeWord + (p.type === "groundDelay" ? " (flights to this airport are held at their departure airports)" : p.type === "groundStop" ? " (flights to this airport are held on the ground)" : ""))],
        ["Status", esc(it.status === "active" ? "Active" : it.status === "planned" ? "Planned (FAA)" : "Possible (FAA operations plan)")],
        ["FAA's stated cause", esc(p.cause || "not stated") + (p.weather ? " · weather-related" : " · not weather-related")],
        ["Times", esc((p.start ? fmt(p.start, tz) : "start not given") + " → " + (p.end ? fmt(p.end, tz) : "no end time given"))],
        ...(p.avgMin != null || p.maxMin != null || p.minMin != null ? [["Delays", esc([p.minMin != null ? "from " + EN.durText(p.minMin) : null, p.avgMin != null ? "average " + EN.durText(p.avgMin) : null, p.maxMin != null ? "up to " + EN.durText(p.maxMin) : null, p.trend ? String(p.trend).toLowerCase() : null].filter(Boolean).join(" · "))]] : []),
        ["Your windows", esc((it.windows || []).map(([k, w]) => k + " " + fmt(new Date(w.startMs).toISOString(), tz) + " → " + fmt(new Date(w.endMs).toISOString(), tz)).join("; ") || "none set")],
        ["Updated", p.updated ? esc(fmt(p.updated, tz)) : "not stated"],
        ["Source", `FAA Air Traffic Control System Command Center · <a href="https://nasstatus.faa.gov/" target="_blank" rel="noopener">NAS status</a>${p.advisoryUrl ? ` · <a href="${esc(p.advisoryUrl)}" target="_blank" rel="noopener">FAA advisory</a>` : ""}`],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) : "not yet"],
      ] : it.kind === "enroute" ? [
        ["Product", esc(p.kind === "gairmet" ? p.name + " (forecast advisory, snapshots every 3 hours)" : p.kind === "cwa" ? p.name + " (" + p.office + ")" : p.name)],
        ["Hazard", esc(((({ LGT: "light ", MOD: "moderate ", SEV: "severe " })[p.severity] || "") + p.hazardWord).replace(/^./, (c) => c.toUpperCase()) + (p.dueTo && p.dueTo !== p.hazard ? " · " + p.dueTo : "") + (p.qualifier ? " · " + p.qualifier : ""))],
        ["Altitude", esc(p.baseFt == null && p.topFt == null ? "not stated" : EN.bandText(p.baseFt, p.topFt) + (p.freezingLevel ? " (from the freezing level)" : ""))],
        ["Valid", p.kind === "gairmet" ? (it.snapshots || [p]).map((x) => esc("snapshot " + fmt(x.validTime, tz) + " (+" + x.forecastHour + " h)")).join("<br>") + "<br>Each snapshot is read as 90 minutes either side of its time." : esc(fmt(p.validStart, tz) + " → " + fmt(p.validEnd, tz))],
        ["Issued", p.issued ? esc(fmt(p.issued, tz)) : "not stated"],
        ["Your route", rr ? esc(rr.o + " → " + rr.d + " · " + EN.bandText(rr.lowFt, rr.highFt) + (rr.startMs ? " · in the air " + fmt(new Date(rr.startMs).toISOString(), tz) + " → " + fmt(new Date(rr.endMs).toISOString(), tz) + (rr.timeSource && rr.timeSource !== "own" ? " (from your " + rr.timeSource + ")" : "") : "")) : ""],
        ["Overlap", esc((it.km === 0 ? "The straight line between the airports crosses the area" : "The straight line passes within " + Math.max(1, Math.round(it.km / 1.609344)) + " miles of the area") + "; a potential overlap within " + EN.ROUTE_MI + " miles, not a forecast for your flight path.")],
        ...(p.raw ? [["Raw text", `<span class="mono">${esc(p.raw)}</span>`]] : []),
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a>`],
      ] : it.kind === "pirep" ? [
        ["Report", esc(EN.pirepText(p) + (p.urgent ? " · urgent pilot report" : ""))],
        ["Observed", esc(fmt(p.observed, tz))],
        ["Aircraft", esc(p.acType || "not given")],
        ["Distance", esc(Math.max(1, Math.round(it.km / 1.609344)) + " miles from the straight-line route")],
        ["Raw report", `<span class="mono">${esc(p.raw)}</span>`],
        ["What it means", "A pilot's observation at that place, altitude and time. Turbulence depends on the aircraft; a report is not a forecast."],
        ["Source", `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a>`],
      ] : it.family === "aviation" && p.kind === "taf" ? [
        ["Airport", esc(it.airport + " · " + (p.airportName || "") + " · " + it.role + " airport")],
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">TAF</a>`],
        ["Issued", esc(fmt(p.issued, tz) + " (" + zt(p.issued) + (p.amended ? ", amended" : "") + ")")],
        ["Valid", esc(fmt(p.validStart, tz) + " → " + fmt(p.validEnd, tz))],
        ["Your " + it.windowKind + " window", esc(airportsOf(ev).filter((a) => a.icao === it.airport).map((a) => a[it.windowKind === "arrival" ? "arrive" : "depart"]).filter(Boolean).map((w) => fmt(new Date(w.startMs).toISOString(), tz) + " → " + fmt(new Date(w.endMs).toISOString(), tz))[0] || "")],
        ["Overlapping periods", it.periods.map((pd) => esc((pd.change === "BASE" ? "Base" : pd.change) + (pd.prob ? " " + pd.prob + "%" : "") + " " + fmt(pd.from, tz) + " → " + fmt(pd.to, tz) + ": " + (pd.category || "") + (pd.ceiling != null ? ", ceiling " + pd.ceiling + " ft" : "") + (pd.visText ? ", visibility " + pd.visText + " mi" : "") + (pd.wind ? ", wind " + pd.wind + (pd.gust ? "G" + pd.gust : "") + " kt" : "") + (pd.wx ? ", " + pd.wx : ""))).join("<br>")],
        ["Flight category", "From the TAF's ceiling and visibility, FAA definitions (IFR: ceiling 500 to under 1,000 ft or visibility 1 to under 3 mi)"],
        ["Raw TAF", `<span class="mono">${esc(p.raw)}</span>`],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) : "not yet"],
      ] : it.family === "aviation" && p.kind === "metar" ? [
        ["Airport", esc(it.airport + " · " + (p.airportName || "") + " · " + it.role + " airport")],
        ["Observed", esc(fmt(p.observed, tz) + " (" + zt(p.observed) + ")")],
        ["Conditions", esc(p.category + (p.ceiling != null ? " · ceiling " + p.ceiling + " ft" : "") + (p.visText ? " · visibility " + p.visText + " mi" : "") + (p.wind != null ? " · wind " + p.wind + (p.gust ? "G" + p.gust : "") + " kt" : "") + (p.wx ? " · " + p.wx : ""))],
        ["Raw METAR", `<span class="mono">${esc(p.raw)}</span>`],
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">METAR</a>`],
      ] : p.kind === "tcwind" ? [
        ["Source", `${esc(p.office)} · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">wind speed probabilities</a>`],
        ["Advisory", p.issued ? esc(fmt(p.issued, tz)) : "not stated"],
        ["Chances at the venue", it.levels.map(([kt, v]) => esc((kt === 34 ? "39+ mph (34 kt)" : kt === 50 ? "58+ mph (50 kt)" : "74+ mph (64 kt)") + " " + v)).join(" · ")],
        ["Forecast window", it.window5 ? esc(fmt(new Date(it.window5.from).toISOString(), tz) + " → " + fmt(new Date(it.window5.to).toISOString(), tz)) + " (5 days from the advisory; cumulative, not timing)" : "the 5 days after the advisory"],
        ["Forecast cone", "Regional context on the map only. These probabilities apply at the venue whether or not it is inside the cone."],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) : "not yet"],
      ] : sm && p.kind === "smoke" ? [
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
        ["Hours with smoke", esc(it.phases.join(", ") + " · highest " + Math.round(it.peak.v) + " µg/m³ at " + fmt(new Date(Date.parse(it.peak.t) - 3600e3).toISOString(), tz))],
        ["Units", "µg/m³ of smoke near the ground. NOAA's service answers in kg/m³ (its description says \u201cper cubic feet\u201d); converted here. Listed at 9 µg/m³ or more, the top of EPA's \u201cGood\u201d PM2.5 range, from smoke alone."],
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
        ["Chances at the venue", it.levels.map(([L, v]) => esc((L === "WWA" ? "Winter weather (any)" : F.WSSI_NAME[L]) + (v == null ? " unavailable (NOAA's service did not answer for this level)" : " " + pct(v)))).join(" · ")],
        ["Overlaps", esc(it.phases.join(", "))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Covers through", src.reachEnd ? esc(fmt(src.reachEnd, tz)) + " (the last 24-hour window WPC has published)" : "unknown"],
        ["Venue", esc(p.pointHit ? "Probabilities at the venue pin (WPC map service point query)" : "Inside WPC's " + p.prob + "% area for at least " + F.WSSI_NAME[p.category] + (p.category === "WWA" ? "" : " impacts"))],
        ["Details", esc(F.WSSI_MEANING[p.category] + " WSSI-P gives the chance of reaching each impact level somewhere in the 24 hours; it does not time anything within them.")],
      ] : [
        ["Source", `${esc(p.office || "")}${p.source && p.source.url ? ` · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">official product</a>` : ""}`],
        ["Issued", esc(fmt(p.kind === "outlook" ? p.issued : p.firstSeen || p.issued, tz)) + (p.updated && p.updated !== (p.firstSeen || p.issued) && p.kind !== "outlook" ? " · updated " + esc(fmt(p.updated, tz)) : "")],
        [p.kind === "outlook" ? "Valid" : "In effect", p.kind === "outlook" ? esc(fmt(p.validStart, tz)) + " → " + esc(fmt(p.validEnd, tz)) : (started ? "from " + esc(fmt(p.issued, tz)) + " " : "") + (p.openEnded ? "until further notice · next NWS update due by " + esc(fmt(p.expires, tz)) : "until " + esc(fmt(p.expires, tz)))],
        ...(p.windWindow ? [["Wind timing", esc("NWS window for tropical-storm-force winds: " + p.windWindow)]] : []),
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Venue", it.adjacent ? esc("Coastal alert for the adjacent shoreline: NWS places the venue in no land forecast zone (" + (zones && zones.marine || "over the water") + "); the alert was issued for the coastal zone " + window.ThreatsCore.distanceText(it.relation.km || 0) + " away") : esc(it.relation.kind === "unknown" ? "Unknown: the area isn't fully drawn" : p.kind === "outlook" ? "Inside the highest category that reaches the venue (" + (F.ERO_NAME[p.category] || p.category) + ")" : "Inside the " + p.kind + " area" + (p.geometrySource === "counties" ? " (drawn from the NWS " + ((p.zones || []).some((u) => /\/zones\/fire\//.test(u)) ? "fire weather" : "forecast") + " zones it lists: " + (p.zones || []).map((u) => u.split("/").pop()).join(", ") + ")" : ""))],
        ["Details", esc(p.headline || p.hazard || "")],
      ];
      return `<li class="et-item" data-family="${esc(it.family)}" data-kind="${esc(it.kind)}">
        <div class="et-main"><b class="et-head">${esc(it.headline)}</b><span class="et-line">${esc(it.line)}</span>
          <span class="et-actions"><button type="button" class="bx-link et-more" data-id="${id}" aria-expanded="${isOpen}">More info</button> · <a class="bx-link" href="${esc(mapLink(it))}" data-map="${id}">View on map</a></span></div>
        <dl class="et-detail" ${isOpen ? "" : "hidden"}>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></li>`;
    };
    const venueItems = r.items.filter((it) => it.family !== "aviation").map(renderItem).join("");
    const byId = new Map(r.items.map((it) => [it.id, it]));
    const okLine = (x) => `<li class="et-ok${x.unknown ? " et-unk" : ""}" data-kind="airport-plain">${esc(x.text)}</li>`;
    const apBlocks = (r.airports || []).map((a) => `<div class="et-ap" data-icao="${esc(a.icao)}"><h4 class="et-aph">${esc(a.name === a.icao ? a.icao : a.name + " (" + a.icao + ")")} · ${esc(a.role)} airport <a class="bx-link et-apmap" data-map-ap="${esc(a.icao)}" href="${esc(mapLink({ family: "aviation", airport: a.icao, product: {} }))}">View on map</a></h4><ul class="et-list">${
      [...a.windows, ...(a.now ? [a.now] : [])].map((x) => (x.concern && byId.get(x.itemId) ? renderItem(byId.get(x.itemId)) : okLine(x))).join("")}</ul></div>`).join("");
    const hasAir = FAMILIES.includes("aviation");
    /* flight disruptions (FAA) and the route: their own headings, apart from venue hazards and airport weather */
    const faaBlocks = (r.disruptions || []).map((a) => `<div class="et-ap et-faa" data-icao="${esc(a.icao)}"><h4 class="et-aph">${esc(a.name === a.icao ? a.icao : a.name + " (" + a.icao + ")")} · ${esc(a.role)}${/route/.test(a.role) ? "" : " airport"}</h4><ul class="et-list">${a.lines.map((x) => (x.concern && byId.get(x.itemId) ? renderItem(byId.get(x.itemId)) : okLine(x))).join("")}</ul></div>`).join("");
    const faaSec = !hasAir || !faaBlocks ? "" : `<h3 class="et-h" id="etFaaHead">Flight disruptions</h3>${faaBlocks}<p class="bx-note">FAA-reported ground stops, ground delay programs, delays and closures, with the FAA's stated cause. Active now unless marked planned.</p>`;
    const rs = r.route || {}, rtMap = rs.set ? mapLink({ family: "aviation", kind: "route", airport: rs.d, product: {}, window: null }) : mapLink({ family: "aviation", kind: "route", airport: (airports[0] || {}).icao, product: {} });
    const routeSec = !hasAir || (!rs.set && !apBlocks) ? "" : `<h3 class="et-h" id="etRouteHead">Along the route</h3>${rs.set ? `<div class="et-ap et-route" data-route="${esc(rs.o + "-" + rs.d)}"><h4 class="et-aph">Approximate route ${esc(rs.label)} · ${esc(rs.band)}${rs.window ? " · " + esc(rs.window) : ""} <a class="bx-link et-apmap" data-map-route="1" href="${esc(rtMap)}">View on map</a></h4><ul class="et-list">${rs.lines.map((x) => (x.concern && byId.get(x.itemId) ? renderItem(byId.get(x.itemId)) : okLine(x))).join("")}</ul></div><p class="bx-note et-approx">A straight line between the airports, not your flight plan: matches are potential overlaps within ${esc(String(rs.corridorMi))} miles of it, in your time${rs.timeSource && rs.timeSource !== "own" ? " (from your " + esc(rs.timeSource) + ")" : ""} and altitude band. Pilot reports are observations; SIGMETs, G-AIRMETs and CWAs are official advisories.</p>`
      : `<p class="bx-note et-noroute">No route set. En-route advisories and pilot reports are on the <a class="bx-link" data-map-route="0" href="${esc(rtMap)}">map</a> as regional context; add an origin, destination and altitude band below to check them along an approximate route.</p>`}`;
    const airSec = !hasAir ? "" : `<h3 class="et-h" id="etAirHead">Airport weather</h3>${apBlocks || '<p class="bx-note et-noair">No airports set for this event. Add a primary and an optional alternate airport with your flight times below.</p>'}${apBlocks && linkAir ? '<p class="bx-note et-linkair">Airports and flight times came with the shared link. Change them below to keep your own in this browser.</p>' : ""}${apBlocks ? '<p class="bx-note">Airport forecasts and observations from the NOAA Aviation Weather Center, for the airport, not the venue. Codes and the raw reports are under More info.</p>' : ""}`;
    const statuses = r.statuses.map((s) => `<li class="${s.ok ? "" : "et-warn"}"><b>${esc(s.name)}</b> · ${esc(s.text)}</li>`).join("");
    const label = ARCHIVE ? `<p class="et-sample"><span class="bx-label">Archived sample</span> ${esc(data.archive ? data.archive.label : "")}. Real official products replayed at that time; not live.</p>` : "";
    const notes = (r.notes || []).map((n) => `<p class="et-note" data-note="${esc(n.id)}">${esc(n.text)}</p>`).join("");
    const ap = airportsRaw(ev), slot = (k, r) => { const x = ap.find((y) => y.r === r) || {}; return `<fieldset class="et-airfs"><legend>${r === "p" ? "Primary airport" : "Alternate airport (optional)"}</legend>
        <label>ICAO <input name="${k}i" value="${esc(x.i || "")}" maxlength="4" placeholder="${r === "p" ? "KORD" : ""}" class="input"></label>
        <label>Arrive from <input type="datetime-local" name="${k}a0" value="${esc((x.a || [])[0] || "")}" class="input"></label><label>to <input type="datetime-local" name="${k}a1" value="${esc((x.a || [])[1] || "")}" class="input"></label>
        <label>Depart from <input type="datetime-local" name="${k}d0" value="${esc((x.d || [])[0] || "")}" class="input"></label><label>to <input type="datetime-local" name="${k}d1" value="${esc((x.d || [])[1] || "")}" class="input"></label></fieldset>`; };
    const rt = routeRaw(ev) || {}, rtSlot = `<fieldset class="et-airfs et-rtfs"><legend>Route (optional)</legend>
        <label>From <input name="ro" value="${esc(rt.o || "")}" maxlength="4" placeholder="KORD" class="input"></label><label>To <input name="rd" value="${esc(rt.d || "")}" maxlength="4" placeholder="KEWR" class="input"></label>
        <label>Lowest altitude (ft) <input type="number" name="rlo" value="${rt.lo != null ? esc(String(rt.lo)) : ""}" min="0" max="60000" step="500" placeholder="10000" class="input"></label><label>Highest (ft) <input type="number" name="rhi" value="${rt.hi != null ? esc(String(rt.hi)) : ""}" min="0" max="60000" step="500" placeholder="16000" class="input"></label>
        <label>In the air from <input type="datetime-local" name="rw0" value="${esc((rt.w || [])[0] || "")}" class="input"></label><label>to <input type="datetime-local" name="rw1" value="${esc((rt.w || [])[1] || "")}" class="input"></label>
        <p class="bx-note">Drawn as a straight line between the airports (an approximate route). Leave the times blank to use your arrival window at the destination.</p></fieldset>`;
    const airForm = `<details class="bx-more et-air"${ap.length ? "" : ""}><summary>Airports for this event${ap.length ? ": " + esc(ap.map((x) => x.i.toUpperCase()).join(", ")) : " (optional)"}${rt.o ? " · route " + esc(rt.o + " → " + rt.d) : ""}</summary><form class="et-airform">${slot("p", "p")}${slot("a", "a")}${rtSlot}<p class="et-rterr bx-note" hidden></p><button type="submit" class="btn">Save airports</button><p class="bx-note">Times in ${esc(tz)}. Checked against each airport's own METAR and TAF from the NOAA Aviation Weather Center.</p></form></details>`;
    const vCount = r.items.filter((it) => it.family !== "aviation").length, venueOnly = FAMILIES.some((f) => f !== "aviation");
    box.innerHTML = `${label}${notes}${venueOnly ? `<h3 class="et-h" id="etVenueHead">Venue hazards</h3><p class="et-summary${vCount ? " has" : r.venueConfirmed ? "" : " warn"}" data-confirmed="${r.venueConfirmed}">${esc(r.venueSummary)}</p>
      ${venueItems ? `<ul class="et-list">${venueItems}</ul>` : ""}` : `<p class="et-summary${r.items.length ? " has" : r.confirmed ? "" : " warn"}" data-confirmed="${r.confirmed}">${esc(r.summary)}</p>`}
      ${airSec}${faaSec}${routeSec}
      <details class="bx-more et-sources"><summary>Sources checked for this event</summary><ul>${statuses}</ul>
      <p class="bx-note">Matched to the venue pin and the event's own schedule (${esc(tz)}). Official warnings and outlooks only; daily outlooks flag a period and do not time anything within it. Delivery by email, text or push is not part of this preview.</p></details>`;
    // the airports form lives beside the list and is drawn only when the event changes (typing is never interrupted)
    let air = document.getElementById("threatsAir"); if (!air) { air = document.createElement("div"); air.id = "threatsAir"; box.after(air); }
    if (air.dataset.key !== evKey(ev) + "|" + JSON.stringify(ap) + "|" + JSON.stringify(rt)) { air.dataset.key = evKey(ev) + "|" + JSON.stringify(ap) + "|" + JSON.stringify(rt); air.innerHTML = airForm; }
    box.dataset.items = String(r.items.length); box.dataset.confirmed = String(r.confirmed);
    window.EventThreatsLast = r; // read by the preview checks
  }
  function wssiCheck() { if (!ARCHIVE && ready && ev && ev.loc && Number.isFinite(+ev.loc.lat)) Live.wssiFor(+ev.loc.lat, +ev.loc.lon); }
  function aqCheck() { if (!ARCHIVE && ready && ev && ev.loc && Number.isFinite(+ev.loc.lat) && Live.aqFor) Live.aqFor(+ev.loc.lat, +ev.loc.lon); }
  function tcCheck() { if (!ARCHIVE && ready && ev && ev.loc && Number.isFinite(+ev.loc.lat) && Live.tropicalFor) Live.tropicalFor(+ev.loc.lat, +ev.loc.lon); }
  function avCheck() { if (!ARCHIVE && ready && ev && Live.airportsFor) { const ids = airIds(ev); if (ids.length) { Live.airportsFor(ids); if (Live.faaFor) Live.faaFor(); } } }
  function update(next) { ev = next; if (!started) { started = true; start(); } if (linkAir) saveAirports(ev, linkAir); if (linkRt) saveRoute(ev, linkRt); wssiCheck(); aqCheck(); tcCheck(); avCheck(); render(); shareNote(); }
  /* sharing: Event Manager's link() asks for extra params; the airports (ICAO, role and flight windows) travel as ?air=,
     outside the event payload. The Share menu says what the link carries. */
  function shareParams(e) { const list = cleanAir(airportsRaw(e || ev)), rt = routeRaw(e || ev); if (!shareAir || (!list.length && !rt)) return null; const o = {}; if (list.length) o.air = JSON.stringify(list); if (rt) o.rt = JSON.stringify(rt); return o; }
  function shareNote() {
    const btn = document.getElementById("shareEvent"); if (!btn || !ev) return;
    let n = document.getElementById("shareAirNote"); if (!n) { n = document.createElement("p"); n.id = "shareAirNote"; n.className = "bx-note et-sharenote"; btn.parentElement.appendChild(n); }
    let t = document.getElementById("shareAirToggle"); if (!t) { t = document.createElement("label"); t.id = "shareAirToggle"; t.className = "bx-check et-sharetoggle"; t.innerHTML = '<input type="checkbox" id="shareAirInclude" checked> Include the airports and route in links'; n.after(t); t.querySelector("input").addEventListener("change", (e) => { shareAir = e.target.checked; shareNote(); }); }
    const list = cleanAir(airportsRaw(ev)), rt = routeRaw(ev), wk = (x) => [x.a ? "arrival" : null, x.d ? "departure" : null].filter(Boolean);
    t.hidden = ev.sample || (!list.length && !rt); t.querySelector("input").checked = shareAir;
    n.textContent = ev.sample ? "Weather threats: the sample event's link carries the city only, not airports." : list.length && !shareAir ? "Weather threats: airports left out. The event link and the hourly display link carry no airports, so the recipient sees no airport weather unless they add their own. Venue hazards are checked again when the link is opened." : list.length ? "Weather threats: the event link and the hourly display link include " + list.map((x) => x.i.toUpperCase() + " (" + (x.r === "a" ? "alternate" : "primary") + (wk(x).length ? ", " + wk(x).join(" and ") + " times" : ", no flight times") + ")").join(" and ") + (rt ? ", and the approximate route " + rt.o + " → " + rt.d + " (" + rt.lo.toLocaleString("en-US") + "–" + rt.hi.toLocaleString("en-US") + " ft" + (rt.w ? ", with its time in the air" : "") + ")" : "") + ", so the airport weather opens with them. Venue hazards, flight disruptions and advisories are checked again when the link is opened."
      : rt && shareAir ? "Weather threats: the event link and the hourly display link include the approximate route " + rt.o + " → " + rt.d + ". Venue hazards and advisories are checked again when the link is opened."
      : "Weather threats: no airports are set for this event, so the links carry none. Venue hazards are checked again when the link is opened.";
    n.dataset.airports = String(list.length);
  }
  document.addEventListener("submit", (e) => {
    const f = e.target.closest(".et-airform"); if (!f || !ev) return; e.preventDefault();
    const v = (n) => (f.elements[n] && f.elements[n].value || "").trim(), list = [];
    for (const [k, r] of [["p", "p"], ["a", "a"]]) if (v(k + "i")) list.push({ i: v(k + "i").toUpperCase(), r, a: v(k + "a0") && v(k + "a1") ? [v(k + "a0"), v(k + "a1")] : null, d: v(k + "d0") && v(k + "d1") ? [v(k + "d0"), v(k + "d1")] : null });
    const ro = v("ro").toUpperCase(), rd = v("rd").toUpperCase(), err = f.querySelector(".et-rterr");
    let rtNew = null;
    if (ro || rd) { rtNew = cleanRoute({ o: ro, d: rd, lo: v("rlo") === "" ? NaN : +v("rlo"), hi: v("rhi") === "" ? NaN : +v("rhi"), w: v("rw0") && v("rw1") ? [v("rw0"), v("rw1")] : null });
      if (!rtNew) { if (err) { err.hidden = false; err.textContent = "Route not saved: it needs two different airport codes and a lowest and highest altitude (0–60,000 ft, highest above lowest)."; } } }
    if (err && (rtNew || !(ro || rd))) err.hidden = true;
    linkAir = null; linkRt = null; saveAirports(ev, list); if (rtNew || !(ro || rd)) saveRoute(ev, rtNew); avCheck(); render(); shareNote();
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".et-more"); if (!b) return;
    const id = b.dataset.id; if (open.has(id)) open.delete(id); else open.add(id); render();
  });

  async function start() {
    if (ARCHIVE) { try { archived = await Live.archiveSnapshot(ARCHIVE); } catch (e) { archived = { products: [], sources: {}, clock: new Date().toISOString(), loadError: e.message }; } ready = true; render(); return; }
    await Live.start({ only: ["alerts", "ero", "fire", "nifc", "hms", "nhc"] }); ready = true; wssiCheck(); aqCheck(); avCheck(); render();
    Live.onUpdate(() => { tcCheck(); render(); }); // tcCheck: once NHC has answered, the venue's wind probabilities (cached)
    setInterval(() => { if (!document.hidden) { avCheck(); render(); } }, 30e3); // avCheck: refreshes airports older than 2 min, and retries a failed answer
  }
  /* started by the first event on screen: an event address this browser doesn't have ("Event not found") requests nothing */
  let started = false;
  window.EventThreats = { update, render, shareParams, current: () => ev };
})();
