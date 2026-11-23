/* Synthetic guidance for the Hour by hour charts: an evening match at TQL Stadium, Cincinnati, with invented weather.
   Not a forecast. ?wx= selects the case:
     transition (default)  rain at setup, a rain/snow mix around gates, snow during the match
     allrain               a mild, all-rain evening
     gaps                  the transition with two hours of guidance missing (19:00 and 20:00 local)
     unc                   the transition, with NWS hourly wording saying rain for two of the blend's snow hours
   The real engines and page render it; the event travels in the link (?e=), nothing is stored. */
(function () {
  const C = OpsCore, S = BetaStory, H = 3600e3, tz = "America/New_York", q = new URLSearchParams(location.search), mode = q.get("wx") || "transition";
  const now = Date.now(), local = (ms) => C.time.toLocal(ms, tz), day0 = local(now).slice(0, 10);
  const t0 = C.time.fromLocal ? C.time.fromLocal(day0 + "T00:00", tz) : Math.floor(now / H) * H - (+local(now).slice(11, 13)) * H;
  const tomorrow = local(t0 + 30 * H).slice(0, 10);
  const ms = Array.from({ length: 96 }, (_, i) => t0 + i * H), h = {};
  ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "snowfall"].forEach((k) => (h[k] = []));
  ms.forEach((m) => {
    const d = local(m).slice(0, 10), hr = +local(m).slice(11, 13), inWin = d === tomorrow && hr >= 12;
    let temp = 40 - (inWin ? (hr - 12) * 1.2 : 0), pop = 10, qpf = 0, snowFrac = 0, gust = 18;
    if (inWin) {
      pop = hr < 14 ? 55 : hr < 22 ? 80 : 60; qpf = hr < 14 ? 0.02 : 0.05; gust = 22 + (hr >= 18 && hr <= 21 ? 6 : 0);
      if (mode !== "allrain") snowFrac = hr < 17 ? 0 : hr < 20 ? 0.5 : 1; // rain → mix → snow
      else temp = 50 - (hr - 12) * 0.6;
    }
    if (mode === "gaps" && d === tomorrow && (hr === 19 || hr === 20)) { Object.keys(h).forEach((k) => h[k].push(null)); return; }
    /* US units as the page loads them: precipitation in inches, snowfall in inches at Open-Meteo's 7:1 (7 cm per 10 mm) */
    const v = { temperature_2m: temp, apparent_temperature: temp - 7, precipitation_probability: pop, precipitation: qpf, wind_speed_10m: 12, wind_gusts_10m: gust, snowfall: qpf * snowFrac * 7 };
    Object.keys(h).forEach((k) => h[k].push(v[k]));
  });
  const ids = ["gfs_seamless", "ecmwf_ifs025", "ncep_nbm_conus", "gfs_hrrr"], models = Object.fromEntries(ids.map((id) => [id, { h, d: {} }]));
  const B = { ms, times: ms.map(local), tz, models, viewedAt: now };
  /* NWS grid weather wording: agrees with the blend, except in "unc" where it says rain for two snow hours */
  const at = (hr) => C.time.fromLocal ? C.time.fromLocal(`${tomorrow}T${String(hr).padStart(2, "0")}:00`, tz) : t0 + (24 + hr) * H;
  const wx = [];
  for (let hr = 12; hr < 24; hr++) {
    const kind = mode === "allrain" ? "rain" : hr < 17 ? "rain" : hr < 20 ? "mix" : mode === "unc" && (hr === 21 || hr === 22) ? "rain" : "snow";
    const value = kind === "mix" ? [{ weather: "rain" }, { weather: "snow" }] : [{ weather: kind }];
    wx.push({ validTime: `${new Date(at(hr)).toISOString().replace(".000Z", "+00:00")}/PT1H`, value });
  }
  const NW = { ok: true, office: "ILN", gridX: 37, gridY: 42, hourly: [], parts: { grid: { properties: { weather: { values: wx } } } },
    periods: [{ s: t0 + 30 * H, e: t0 + 42 * H, name: "Tomorrow", short: mode === "allrain" ? "Rain likely" : "Rain, then rain and snow, then snow", temp: 40, pop: 80 }] };
  const ctx = S.context({ C, T: ModelTrends, B, ws: Object.fromEntries(ids.map((id) => [id, 1])), rules: null, nws: NW, now });
  ctx.th = { at: (m) => "normal", perModel: () => null, ids: [] };
  const ev = { n: "FC Cincinnati evening match (winter sample)", v: { name: "TQL Stadium, Cincinnati, OH", lat: 39.1113, lon: -84.5222 }, z: tz,
    t: { setup: `${tomorrow}T13:00`, gates: `${tomorrow}T17:00`, start: `${tomorrow}T19:30`, end: `${tomorrow}T21:30`, teardown: `${tomorrow}T23:30` }, g: 25 };
  if (!q.get("e") && !q.get("ev")) { q.set("e", JSON.stringify(ev)); history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash); } // a local ?ev= address is left as it is
  BetaUI.load = async () => ({ ctx, NW, RB: {}, problems: [], feeds: { used: ["GFS", "ECMWF IFS", "NBM", "HRRR", "NWS point forecast"], missing: [] }, market: { tuned: false }, recipe: "Default blend recipe", verified: "Design sample with synthetic weather: not a forecast." });
  BetaUI.alerts = async () => [];
  BetaUI.mapPanel = (el) => { el.innerHTML = '<p class="bx-note">Radar map omitted from this design sample.</p>'; };
})();
