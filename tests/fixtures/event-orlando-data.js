/* Synthetic guidance for the Event Manager design case: an evening match at Inter&Co Stadium, Orlando.
   Sanitized: real venue and schedule shape, invented weather. The real engines and page render it.
   Not a forecast. ?orl=quiet gives a quiet match; ?orl=partial cuts the guidance off during the match.
   The event travels in the link (?e=), so nothing is read from or saved to this browser's events. */
(function () {
  const C = OpsCore, S = BetaStory, H = 3600e3, tz = "America/New_York", q = new URLSearchParams(location.search), mode = q.get("orl") || "storm";
  const now = Date.now(), local = (ms) => C.time.toLocal(ms, tz), day0 = local(now).slice(0, 10);
  const t0 = C.time.fromLocal ? C.time.fromLocal(day0 + "T00:00", tz) : Math.floor(now / H) * H - (+local(now).slice(11, 13)) * H;
  const tomorrow = local(t0 + 30 * H).slice(0, 10), hours = mode === "partial" ? 24 + 19 : 96;
  const ms = Array.from({ length: hours }, (_, i) => t0 + i * H), h = {};
  ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "snowfall"].forEach((k) => (h[k] = []));
  const thunder = {};
  ms.forEach((m, i) => {
    const d = local(m).slice(0, 10), hr = +local(m).slice(11, 13), ev = d === tomorrow, inWin = ev && hr >= 12;
    const temp = 74 + 13 * Math.max(0, Math.sin(((hr - 9) / 14) * Math.PI));
    let pop = 15, qpf = 0, gust = 14 + (hr >= 11 && hr <= 18 ? 3 : 0), th = "normal";
    if (mode === "storm" && inWin) {
      pop = hr < 17 ? 55 : hr < 20 ? 60 : 45; qpf = hr < 17 ? 0.04 : hr < 20 ? 0.05 : 0.02;
      if (hr >= 13 && hr <= 16) gust = [27, 28, 27, 26][hr - 13];
      th = hr >= 13 && hr <= 17 ? "monitor" : "normal";
    } else if (mode === "quiet" && inWin) { pop = 5; gust = 12; }
    else if (mode === "partial" && inWin) { pop = hr < 17 ? 35 : 20; qpf = hr < 17 ? 0.015 : 0; }
    thunder[m] = th;
    const v = { temperature_2m: temp, apparent_temperature: temp + (temp > 80 ? 7 : 2), precipitation_probability: pop, precipitation: qpf, wind_speed_10m: 9, wind_gusts_10m: gust, snowfall: 0 };
    Object.keys(h).forEach((k) => h[k].push(v[k]));
  });
  const ids = ["gfs_seamless", "ecmwf_ifs025", "ncep_nbm_conus", "gfs_hrrr"], models = Object.fromEntries(ids.map((id) => [id, { h, d: {} }]));
  const B = { ms, times: ms.map(local), tz, models, viewedAt: now };
  const NW = { ok: true, office: "MLB", gridX: 26, gridY: 68, hourly: [],
    periods: mode === "quiet" ? [{ s: t0 + 30 * H, e: t0 + 42 * H, name: "Tomorrow", short: "Mostly sunny", temp: 86, pop: 5 }, { s: t0 + 42 * H, e: t0 + 54 * H, name: "Tomorrow night", short: "Mostly clear", temp: 73, pop: 5 }]
      : [{ s: t0 + 30 * H, e: t0 + 42 * H, name: "Tomorrow", short: "Showers and thunderstorms likely, mainly after 1pm. Gusty winds.", temp: 87, pop: 60 },
         { s: t0 + 42 * H, e: t0 + 54 * H, name: "Tomorrow night", short: "Chance of showers before midnight", temp: 74, pop: 45 }] };
  const ctx = S.context({ C, T: ModelTrends, B, ws: Object.fromEntries(ids.map((id) => [id, 1])), rules: null, nws: NW, now });
  ctx.th = { at: (m) => thunder[Math.floor(m / H) * H] || "nodata", perModel: () => null, ids: [] };
  const ev = { n: "Orlando City vs. visiting club (sample)", v: { name: "Inter&Co Stadium, Orlando, FL", lat: 28.5411, lon: -81.3893 }, z: tz,
    t: { setup: `${tomorrow}T13:00`, gates: `${tomorrow}T17:00`, start: `${tomorrow}T19:30`, end: `${tomorrow}T21:30`, teardown: `${tomorrow}T23:30` }, g: 25 };
  if (!q.get("e")) { q.set("e", JSON.stringify(ev)); history.replaceState(null, "", location.pathname + "?" + q.toString()); }
  BetaUI.load = async () => ({ ctx, NW, RB: {}, problems: [], feeds: { used: ["GFS", "ECMWF IFS", "NBM", "HRRR", "ECMWF AIFS", "GEFS", "ECMWF ENS", "RRFS 3 km", "NWS point forecast"], missing: [{ name: "RRFS ensemble", why: "sample" }] }, market: { tuned: false }, recipe: "Default blend recipe", verified: "Design sample with synthetic weather: not a forecast." });
  BetaUI.alerts = async () => [];
  BetaUI.mapPanel = (el) => { el.innerHTML = '<p class="bx-note">Radar map omitted from this design sample.</p>'; };
  /* label the page plainly as a sample wherever it is opened */
  document.addEventListener("DOMContentLoaded", () => { const b = document.createElement("p"); b.className = "ev-sample-banner"; b.setAttribute("role", "note");
    b.textContent = "Design sample · synthetic weather, not a forecast"; const host = document.getElementById("briefView"); if (host) host.prepend(b); });
})();
