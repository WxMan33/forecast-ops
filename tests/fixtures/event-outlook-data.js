/* Synthetic guidance for the Early weather outlook: the Thanksgiving Day Race, Thu Nov 26 2026, at Paycor Stadium,
   Cincinnati (setup 5:00, gates 6:30, start 7:30, end 10:30, teardown noon, venue time). Invented weather; not a forecast.
   The page clock is set by the check. ?cov= sets how far the HOURLY guidance reaches:
     none     ends Wed Nov 25 (the race is outside hourly coverage)
     partial  ends Thu Nov 26 8:00 AM (setup, gates and the start are covered; the rest is not)
     full     ends Fri Nov 27 (the whole race is covered)
     beyond   used with a clock more than 10 days before the race
   The 10-day daily outlook (BetaUI.outlook) is computed with the site's own blend.dailyRows from synthetic 10-day
   guidance: a cold front on Thanksgiving turns rain to snow. */
(function () {
  const C = OpsCore, S = BetaStory, H = 3600e3, tz = "America/New_York", q = new URLSearchParams(location.search), cov = q.get("cov") || "none";
  const now = Date.now(), local = (ms) => C.time.toLocal(ms, tz), at = (s) => C.time.toUtc(s, tz);
  const day0 = at(local(now).slice(0, 10) + "T00:00");
  const hourlyEnd = cov === "partial" ? at("2026-11-26T08:00") : cov === "full" ? at("2026-11-27T12:00") : at("2026-11-25T23:00");
  const series = (ms) => { const h = {};
    ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "snowfall"].forEach((k) => (h[k] = []));
    ms.forEach((m) => { const l = local(m), d = l.slice(0, 10), hr = +l.slice(11, 13), turkey = d === "2026-11-26", wed = d === "2026-11-25";
      const temp = turkey ? 38 - hr * 0.5 : wed ? 44 + 6 * Math.sin(((hr - 9) / 14) * Math.PI) : 48 + 8 * Math.sin(((hr - 9) / 14) * Math.PI);
      const wet = turkey && hr >= 3 && hr <= 15, snowy = turkey && hr >= 9, qpf = wet ? 0.03 : 0;
      const v = { temperature_2m: temp, apparent_temperature: temp - 6, precipitation_probability: wet ? 60 : wed && hr > 18 ? 35 : 10, precipitation: qpf, wind_speed_10m: 10, wind_gusts_10m: wet ? 24 : 15, snowfall: snowy ? qpf * 7 : 0 };
      Object.keys(h).forEach((k) => h[k].push(v[k])); });
    return h; };
  const ids = ["gfs_seamless", "ecmwf_ifs025", "ncep_nbm_conus"], ws = Object.fromEntries(ids.map((id) => [id, 1]));
  const axis = (end) => { const out = []; for (let m = day0; m < end; m += H) out.push(m); return out; };
  const msH = axis(hourlyEnd), hH = series(msH);
  const B = { ms: msH, times: msH.map(local), tz, models: Object.fromEntries(ids.map((id) => [id, { h: hH, d: {} }])), viewedAt: now };
  const NW = { ok: false, reason: "not used in this fixture" };
  const ctx = S.context({ C, T: ModelTrends, B, ws, rules: null, nws: NW, now });
  ctx.th = { at: () => "normal", perModel: () => null, ids: [] };
  const ev = { n: "Thanksgiving Day Race", v: { name: "Paycor Stadium, Cincinnati, OH", lat: 39.0955, lon: -84.5161 }, z: tz,
    t: { setup: "2026-11-26T05:00", gates: "2026-11-26T06:30", start: "2026-11-26T07:30", end: "2026-11-26T10:30", teardown: "2026-11-26T12:00" }, g: 25 };
  if (!q.get("e")) { q.set("e", JSON.stringify(ev)); history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash); }
  window.__outlookCalls = 0;
  BetaUI.load = async () => ({ ctx, NW, RB: { ws, rules: null }, problems: [], feeds: { used: ["GFS", "ECMWF IFS", "NBM"], missing: [] }, market: { tuned: false }, recipe: "Default blend recipe", verified: "Synthetic: not a forecast." });
  /* the daily outlook over 10 days, by the site's own daily calculation */
  BetaUI.outlook = async (where, opt) => {
    window.__outlookCalls++;
    const ms10 = axis(day0 + 10 * 24 * H), h10 = series(ms10), B10 = { ms: ms10, times: ms10.map(local), tz, models: Object.fromEntries(ids.map((id) => [id, { h: h10, d: {} }])) };
    return { rows: C.blend.dailyRows(B10, opt.ws, { rules: opt.rules }), tz, days: 10 };
  };
  BetaUI.alerts = async () => [];
  BetaUI.mapPanel = (el) => { el.innerHTML = '<p class="bx-note">Forecast radar omitted from this sample.</p>'; };
})();
