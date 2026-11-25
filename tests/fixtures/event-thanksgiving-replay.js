/* REPLAY SAMPLE, not a forecast. The Thanksgiving Day Race at TQL Stadium, Cincinnati, Thu Nov 26 2026: public 9:00 AM
   start, with SAMPLE crew times (setup 5:00, gates 6:30, end 10:30, teardown noon: placeholders, not confirmed race-day
   times). Synthetic guidance in the shape of the Thanksgiving run: a band of heavy rain through the morning, heaviest during
   lineup and around the 9 AM start, with the
   models differing by a few hours on when it starts. The official-alert set is EMPTY (no NWS alerts, and the Weather
   threats matcher finds nothing at the venue), which is the case where an empty alert list must not read as "no threats".
   The real engines and the full Event Manager page render it; the replay clock is Wed Nov 25 2026, 2:30 PM EST.
     ?tg=replay   (default) heavy morning rain, empty official alerts
     ?tg=quiet    the same race on a dry, calm morning; official alerts empty
     ?tg=warning  the replay with an URGENT official warning active at the venue (a synthetic Flash Flood Warning, not a
                  real product): the warning has to be on the first phone screen with the forecast concern
     ?tg=missing  only 3 of 9 model sources answer (no ensembles)
     &alerts=fail (any mode) the NWS alert check fails, so "no alerts" must not be claimed and two race hours have no forecast data at all
   The event travels in the link (?e=), so nothing is read from or saved to this browser's events. */
(function () {
  const C = OpsCore, S = BetaStory, H = 3600e3, tz = "America/New_York", q = new URLSearchParams(location.search), mode = q.get("tg") || "replay", wx = mode === "warning" ? "replay" : mode;
  const now = Date.parse("2026-11-25T19:30:00Z"), local = (ms) => C.time.toLocal(ms, tz), at = (s) => C.time.toUtc(s, tz);
  const t0 = at("2026-11-25T00:00"), ms = Array.from({ length: 96 }, (_, i) => t0 + i * H);
  /* each model's own wet hours on race morning (local hour, inclusive) and hourly rate: the onset spread is the point */
  const WET = { gfs_hrrr: [6, 12, 0.2], ncep_nbm_conus: [7, 12, 0.16], gfs_seamless: [7, 13, 0.18], icon_seamless: [8, 13, 0.14], gem_seamless: [8, 12, 0.12], ecmwf_ifs025: [9, 14, 0.15], ncep_rrfs_conus: [7, 12, 0.19] };
  const all = Object.keys(WET), present = mode === "missing" ? ["gfs_seamless", "icon_seamless", "gem_seamless"] : all;
  const series = (id) => { const h = {}, [w0, w1, rate] = WET[id];
    ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "snowfall"].forEach((k) => (h[k] = []));
    ms.forEach((m) => { const l = local(m), race = l.slice(0, 10) === "2026-11-26", hr = +l.slice(11, 13);
      const temp = 44 + 5 * Math.max(0, Math.sin(((hr - 8) / 12) * Math.PI)) + (id === "ecmwf_ifs025" ? 1 : 0);
      const wet = wx === "replay" && race && hr >= w0 && hr <= w1, soon = wx === "replay" && race && hr >= w0 - 2 && hr < w0;
      const peak = wet ? rate * (hr === 8 ? 2.2 : hr === 9 ? 1.6 : 1) : 0; // heaviest through lineup and the 9 AM start
      let v = { temperature_2m: temp, apparent_temperature: temp - 4, precipitation_probability: wet ? 90 : soon ? 45 : mode === "quiet" ? 5 : 12, precipitation: wet ? +peak.toFixed(3) : 0,
        wind_speed_10m: wet ? 12 : 8, wind_gusts_10m: wet ? 21 : mode === "quiet" ? 11 : 15, snowfall: 0 };
      /* missing guidance: no source has the 9 and 10 AM race hours */
      if (mode === "missing" && race && (hr === 9 || hr === 10)) v = Object.fromEntries(Object.keys(v).map((k) => [k, null]));
      Object.keys(h).forEach((k) => h[k].push(v[k])); });
    return h; };
  const models = Object.fromEntries(present.map((id) => [id, { h: series(id), d: {}, retrievedAt: new Date(now - 4 * 60e3).toISOString() }]));
  /* two ensembles (10 members each), shaped as BlendCore.addSources builds them: in the replay most members are wet
     through race morning, each with its own onset and rate (the ensemble share is part of the briefing's rain rating) */
  const ENS = { gefs: { name: "GEFS", wet: 9, lag: 1 }, ecmwf_ens: { name: "ECMWF ENS", wet: 10, lag: 2 } };
  const ensPresent = mode === "missing" ? [] : Object.keys(ENS);
  ensPresent.forEach((id) => {
    const members = Array.from({ length: 10 }, (_, k) => { const h = { temperature_2m: [], precipitation: [], snowfall: [] };
      ms.forEach((m) => { const l = local(m), race = l.slice(0, 10) === "2026-11-26", hr = +l.slice(11, 13), w0 = 6 + ((k + ENS[id].lag) % 4), wet = wx === "replay" && race && k < ENS[id].wet && hr >= w0 && hr <= w0 + 5;
        h.temperature_2m.push(44 + 5 * Math.max(0, Math.sin(((hr - 8) / 12) * Math.PI)) + (k % 3) - 1); h.precipitation.push(wet ? +(0.08 + 0.02 * (k % 5)).toFixed(3) : 0); h.snowfall.push(0); });
      return { h }; });
    const h = {}; ["temperature_2m", "precipitation", "snowfall"].forEach((v) => (h[v] = ms.map((_, i) => members.reduce((t, mb) => t + mb.h[v][i], 0) / members.length)));
    models[id] = { kind: "ens", h, members, n: members.length, retrievedAt: new Date(now - 4 * 60e3).toISOString() };
  });
  const B = { ms, times: ms.map(local), tz, models, viewedAt: now };
  /* run metadata as Open-Meteo reports it (initialisation, availability, update interval): source timing in the briefing */
  const run = (init, availMin, every) => ({ lastRunInit: init, lastRunAvailable: new Date(Date.parse(init) + availMin * 60e3).toISOString(), updateIntervalH: every });
  const META = { gfs_seamless: run("2026-11-25T12:00:00Z", 230, 6), ecmwf_ifs025: run("2026-11-25T12:00:00Z", 400, 6), ncep_nbm_conus: run("2026-11-25T17:00:00Z", 95, 1),
    gfs_hrrr: run("2026-11-25T18:00:00Z", 75, 1), icon_seamless: run("2026-11-25T12:00:00Z", 260, 6), gem_seamless: run("2026-11-25T12:00:00Z", 280, 12), ncep_rrfs_conus: run("2026-11-25T17:00:00Z", 110, 1) };
  const meta = Object.fromEntries(Object.entries(META).filter(([id]) => present.includes(id)));
  const NW = { ok: true, office: "ILN", gridX: 35, gridY: 38, hourly: [],
    periods: wx === "replay" ? [{ s: at("2026-11-26T06:00"), e: at("2026-11-26T18:00"), name: "Thanksgiving Day", short: "Rain, heavy at times in the morning. High near 49.", temp: 49, pop: 100 },
      { s: at("2026-11-26T18:00"), e: at("2026-11-27T06:00"), name: "Thursday Night", short: "Showers ending early, then mostly cloudy.", temp: 38, pop: 30 }]
      : [{ s: at("2026-11-26T06:00"), e: at("2026-11-26T18:00"), name: "Thanksgiving Day", short: mode === "quiet" ? "Mostly sunny. High near 49." : "Partly sunny. High near 49.", temp: 49, pop: 5 },
        { s: at("2026-11-26T18:00"), e: at("2026-11-27T06:00"), name: "Thursday Night", short: "Mostly clear.", temp: 34, pop: 5 }] };
  const ws = Object.fromEntries([...present, ...ensPresent].map((id) => [id, 1]));
  const ctx = S.context({ C, T: ModelTrends, B, ws, rules: null, meta, nws: NW, now });
  ctx.th = { at: (m) => (m >= t0 && m < t0 + 96 * H ? "normal" : "nodata"), perModel: () => null, ids: [] };
  const NAME = { gefs: "GEFS", ecmwf_ens: "ECMWF ENS", gfs_seamless: "GFS", ecmwf_ifs025: "ECMWF IFS", ncep_nbm_conus: "NBM", gfs_hrrr: "HRRR (48 h)", icon_seamless: "ICON", gem_seamless: "GEM", ncep_rrfs_conus: "RRFS 3 km" };
  const WHY = { ecmwf_ifs025: "request failed (HTTP 502)", ncep_nbm_conus: "no data returned", gfs_hrrr: "request failed (timeout)", ncep_rrfs_conus: "no data returned", gefs: "ensemble unavailable", ecmwf_ens: "ensemble unavailable" };
  const ids = [...present, ...ensPresent], allIds = [...all, ...Object.keys(ENS)];
  const feeds = { usedIds: ids, used: ids.map((id) => NAME[id]), missing: allIds.filter((id) => !ids.includes(id)).map((id) => ({ id, name: NAME[id], why: WHY[id] })) };
  /* the real event name; the on-screen banner (below) labels every variant as a sample */
  const ev = { n: "Thanksgiving Day Race",
    v: { name: "TQL Stadium, Cincinnati, OH", lat: 39.1113, lon: -84.5222 }, z: tz,
    t: { setup: "2026-11-26T05:00", gates: "2026-11-26T06:30", start: "2026-11-26T09:00", end: "2026-11-26T10:30", teardown: "2026-11-26T12:00" }, g: 25 };
  if (!q.get("e")) { q.set("e", JSON.stringify(ev)); history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash); }
  BetaUI.load = async () => ({ ctx, NW, RB: { ws, rules: null }, problems: feeds.missing.map((m) => `${m.name}: ${m.why}`), feeds, market: { tuned: true }, recipe: "Cincinnati-tuned blend",
    verified: "Replay sample with synthetic guidance: not a forecast." });
  /* the official-alert set for the replay is empty: no NWS alerts at the venue ... */
  BetaUI.alerts = async () => { const a = mode === "warning" ? [{ event: "Flash Flood Warning", headline: "Flash Flood Warning (synthetic replay sample)", starts: new Date(now - 30 * 60e3).toISOString(), ends: at("2026-11-26T13:00") && new Date(at("2026-11-26T13:00")).toISOString(), url: "sample" }] : [];
    a.available = q.get("alerts") !== "fail"; return a.available ? a : Object.assign([], { available: false }); };
  BetaUI.mapPanel = (el) => { el.innerHTML = '<p class="bx-note">Forecast radar imagery is omitted from this replay sample.</p>'; };
  /* ... and the Weather threats list matches nothing. The section's own engine (ThreatsMatch) still runs; the replay
     supplies an empty product set with every source answering, so it shows its confirmed "none" state. */
  const L = window.ThreatsLive, M = window.ThreatsMatch, clock = new Date(now).toISOString();
  if (L && M) {
    Object.assign(L, { start: async () => {}, onUpdate: () => {}, snapshot: () => ({ live: true, clock, products: [], ended: [], sources: {} }), pointZones: () => null,
      wssiFor: () => {}, aqFor: () => {}, tropicalFor: () => {}, airportsFor: () => {}, faaFor: () => {}, enrouteFor: () => {} });
    const forEvent = M.forEvent;
    M.forEvent = (o) => { const r = forEvent(o), statuses = r.statuses.map((s) => ({ ...s, ok: true, text: "Checked " + new Date(now).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) + " (replay: none active)" }));
      const words = (r.venueSummary.match(/no (.*) threats found/) || [])[1];
      return { ...r, items: [], statuses, confirmed: true, venueConfirmed: true, venueSummary: words ? `No ${words} threats apply to the venue and event times.` : r.venueSummary }; };
  }
  document.addEventListener("DOMContentLoaded", () => { const b = document.createElement("p"); b.className = "ev-sample-banner"; b.setAttribute("role", "note");
    b.textContent = mode === "warning" ? "Sample · synthetic Flash Flood Warning, not a real alert" : mode === "replay" ? "Replay sample · synthetic guidance, not a forecast" : mode === "quiet" ? "Sample · quiet morning, synthetic, not a forecast" : "Sample · missing guidance, synthetic, not a forecast";
    const host = document.getElementById("briefView"); if (host) host.prepend(b); });
})();
