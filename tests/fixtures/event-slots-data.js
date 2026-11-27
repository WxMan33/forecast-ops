/* SYNTHETIC guidance for planner-defined schedules (tools/event-slots-check.js): a garden venue near Cincinnati with
   invented weather. Not a forecast. The event travels in the link (?e=); ?wx= picks the weather:
     ceremony  rain falling 4–5 PM tomorrow (the hourly amount labelled 5 PM): the wedding's Outdoor ceremony
     gap       rain falling 3–4 PM tomorrow only (labelled 4 PM), between the wedding's Vendor setup (1–3 PM) and its
               Outdoor ceremony (4–4:30 PM)
   Hourly amounts, chance and gusts are for the hour ending at their label (Core.event.KIND).
     evening   rain 6–9 PM tomorrow (the single-window Reception)
     night     gusty after 10 PM tomorrow into the early morning (the overnight event)
     festival  a shower Saturday 2–4 PM; the guidance ends Saturday night, so a Sunday slot has none yet
     dry       quiet throughout */
(function () {
  const C = OpsCore, S = BetaStory, H = 3600e3, tz = "America/New_York", q = new URLSearchParams(location.search), wx = q.get("wx") || "ceremony";
  const now = Date.now(), local = (ms) => C.time.toLocal(ms, tz), day0 = local(now).slice(0, 10);
  const t0 = C.time.toUtc(day0 + "T00:00", tz), tomorrow = local(t0 + 30 * H).slice(0, 10), after = local(t0 + 54 * H).slice(0, 10);
  const ms = Array.from({ length: 96 }, (_, i) => t0 + i * H), h = {};
  ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "snowfall"].forEach((k) => (h[k] = []));
  ms.forEach((m) => {
    const d = local(m).slice(0, 10), hr = +local(m).slice(11, 13), tm = d === tomorrow, nx = d === after;
    const temp = 58 + 9 * Math.max(0, Math.sin(((hr - 9) / 14) * Math.PI));
    let pop = 10, qpf = 0, gust = 12;
    if (wx === "ceremony" && tm && hr === 17) { pop = 70; qpf = 0.12; }
    if (wx === "gap" && tm && hr === 16) { pop = 65; qpf = 0.12; }
    if (wx === "evening" && tm && hr >= 19 && hr <= 21) { pop = 65; qpf = 0.08; }
    if (wx === "night" && ((tm && hr >= 22) || (nx && hr <= 2))) gust = 31;
    if (wx === "festival" && local(m).slice(0, 10) === local(t0 + 78 * H).slice(0, 10) && hr >= 14 && hr <= 15) { pop = 60; qpf = 0.1; }
    const v = { temperature_2m: temp, apparent_temperature: temp - 2, precipitation_probability: pop, precipitation: qpf, wind_speed_10m: 8, wind_gusts_10m: gust, snowfall: 0 };
    Object.keys(h).forEach((k) => h[k].push(v[k]));
  });
  const ids = ["gfs_seamless", "ecmwf_ifs025", "ncep_nbm_conus", "gfs_hrrr"], models = Object.fromEntries(ids.map((id) => [id, { h, d: {} }]));
  const B = { ms, times: ms.map(local), tz, models, viewedAt: now };
  const NW = { ok: true, office: "ILN", gridX: 36, gridY: 38, hourly: [], periods: [{ s: t0 + 30 * H, e: t0 + 42 * H, name: "Tomorrow", short: wx === "dry" ? "Mostly sunny" : "Chance of showers", temp: 67, pop: wx === "dry" ? 5 : 50 },
    { s: t0 + 42 * H, e: t0 + 54 * H, name: "Tomorrow night", short: "Mostly cloudy", temp: 52, pop: 20 }] };
  const ctx = S.context({ C, T: ModelTrends, B, ws: Object.fromEntries(ids.map((id) => [id, 1])), rules: null, nws: NW, now });
  ctx.th = { at: () => "normal", perModel: () => null, ids: [] };
  window.SLOTS_FIXTURE = { tomorrow, after };
  BetaUI.load = async () => ({ ctx, NW, RB: {}, problems: [], feeds: { used: ["GFS", "ECMWF IFS", "NBM", "HRRR"], missing: [] }, market: { tuned: false }, recipe: "Default blend recipe", verified: "Synthetic weather for a schedule check: not a forecast." });
  /* &alerts=warn: an URGENT official warning active at the venue (a synthetic Flash Flood Warning, not a real product), to
     check that it stays on the first phone screen with the day picker above the briefing */
  BetaUI.alerts = async () => (new URLSearchParams(location.search).get("alerts") === "warn"
    ? [{ event: "Flash Flood Warning", headline: "Flash Flood Warning (synthetic sample, not a real alert)", starts: new Date(now - 30 * 60e3).toISOString(), ends: new Date(now + 6 * 3600e3).toISOString(), url: "sample" }] : []);
  BetaUI.mapPanel = (el) => { el.innerHTML = '<p class="bx-note">Forecast radar omitted from this synthetic check.</p>'; };
  document.addEventListener("DOMContentLoaded", () => { const b = document.createElement("p"); b.className = "ev-sample-banner"; b.setAttribute("role", "note");
    b.textContent = "Schedule check · synthetic weather, not a forecast"; const host = document.getElementById("briefView"); const up = document.getElementById("upLink"); if (up) { const row = document.createElement("div"); row.className = "ev-sample-row"; up.before(row); row.append(up, b); } else if (host) host.prepend(b); });
})();
