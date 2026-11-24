/* Weather Threats: the venue's next 7 days, from official sources, as one row per local day.
   Pure logic (no fetching): ThreatsOutlook.build(input) -> { headline, alerts, days, sources }.
   Levels: 0 information, 1 low, 2 moderate, 3 high, 4 extreme. They order and colour what is shown; each item still names its
   source's own wording (SPC category, WPC risk, NWS product), and a source that did not answer makes that part "not confirmed",
   never quiet. SPC Days 6-8 often say "predictability too low": that is shown as unknown, not as no risk. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./threats-core.js"));
  else root.ThreatsOutlook = factory(root.ThreatsCore);
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";
  const SPC_LEVEL = { TSTM: 0, MRGL: 1, SLGT: 2, ENH: 3, MDT: 4, HIGH: 4 }, SPC_NAME = { TSTM: "General thunderstorms", MRGL: "Marginal risk (1 of 5)", SLGT: "Slight risk (2 of 5)", ENH: "Enhanced risk (3 of 5)", MDT: "Moderate risk (4 of 5)", HIGH: "High risk (5 of 5)" };
  const ERO_LEVEL = { MRGL: 1, SLGT: 2, MDT: 3, HIGH: 4 }, ERO_NAME = { MRGL: "Marginal (1 of 4)", SLGT: "Slight (2 of 4)", MDT: "Moderate (3 of 4)", HIGH: "High (4 of 4)" };
  const FIRE_LEVEL = { ELEV: 1, CRIT: 2, EXTM: 3, IDRT: 1, SDRT: 2, P40: 1, P70: 2 }, FIRE_NAME = { ELEV: "Elevated", CRIT: "Critical", EXTM: "Extremely critical", IDRT: "Isolated dry thunderstorms", SDRT: "Scattered dry thunderstorms", P40: "40% chance of critical conditions", P70: "70% chance of critical conditions" };
  const WSSI_LEVELS = ["WWA", "MINOR", "MODERATE", "MAJOR", "EXTREME"], WSSI_NAME = { WWA: "winter weather", MINOR: "Minor", MODERATE: "Moderate", MAJOR: "Major", EXTREME: "Extreme" }, WSSI_LEVEL = { WWA: 0, MINOR: 1, MODERATE: 2, MAJOR: 3, EXTREME: 4 };
  const AQ_LEVEL = { "Unhealthy for Sensitive Groups": 1, Unhealthy: 2, "Very Unhealthy": 3, Hazardous: 4 };
  /* NWS alerts by kind: warnings 3 (tornado, extreme wind 4), watches 2, advisories 1, statements 0 */
  const alertLevel = (ev) => /^(Tornado|Extreme Wind|Hurricane|Storm Surge) Warning/.test(ev) ? 4 : / Warning$/.test(ev) ? 3 : / Watch$/.test(ev) ? 2 : / Advisory$/.test(ev) ? 1 : 0;
  /* the local calendar date (YYYY-MM-DD) of an instant in the venue's zone */
  // one formatter per zone (making a new one per call took over a second on a busy day)
  const fmts = new Map(), localDate = (ms, tz) => { let f = fmts.get(tz); if (!f) { f = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); fmts.set(tz, f); } return f.format(new Date(ms)); };
  const dayLabel = (date, i, tz) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  function build(inp) {
    const tz = inp.tz, now = inp.now, pt = [inp.venue.lon, inp.venue.lat], nDays = inp.days || 7;
    const dates = []; for (let i = 0; i < nDays; i++) dates.push(localDate(now + i * 864e5, tz));
    const days = dates.map((date, i) => ({ date, label: dayLabel(date, i, tz), items: [], unknown: [], limits: [] }));
    const at = (ms) => days.find((d) => d.date === localDate(ms, tz));
    const put = (ms, item) => { const d = at(ms); if (d) d.items.push(item); };
    const unknownOn = (ms, why) => { const d = at(ms); if (d && !d.unknown.includes(why)) d.unknown.push(why); };
    /* a known limit of a source (SPC can't say yet for Days 6-8): shown, but not a failure */
    const limitOn = (ms, why) => { const d = at(ms); if (d && !d.limits.includes(why)) d.limits.push(why); };
    const inside = (g) => g && T.contains(g, pt);
    /* approaching: the highest area within 100 miles that is higher than the venue's own (distance and direction from the venue) */
    const NEAR_KM = 161, nearHigher = (ps, levelOf, atLevel) => { let best = null; for (const p of ps) { if (!p.geometry || inside(p.geometry)) continue; const lv = levelOf(p); if (!(lv > atLevel)) continue; const r = T.relation({ kind: "outlook", geometry: p.geometry }, inp.venue, NEAR_KM); if (r.kind === "near" && (!best || lv > best.lv || (lv === best.lv && r.km < best.r.km))) best = { p, lv, r }; } return best; };
    const nearText = (b) => Math.max(1, Math.round(T.miles(b.r.km))) + " mi " + b.r.dir;
    /* a convective day's afternoon (12Z start + 6 h) decides which local day it belongs to */
    const mid = (p) => Date.parse(p.validStart) + 6 * 3600e3;

    // SPC Days 1-3: the highest category over the venue
    for (const d of [1, 2, 3]) {
      const st = (inp.states.spc || {})[d], ps = (inp.spc || []).filter((p) => p.day === d);
      if (st !== "ok") { const ref = ps[0] || null; if (ref) unknownOn(mid(ref), "SPC Day " + d + " outlook not confirmed"); else if (inp.spcDayStart && inp.spcDayStart[d]) unknownOn(mid({ validStart: inp.spcDayStart[d] }), "SPC Day " + d + " outlook not confirmed"); continue; }
      const top = T.outlookAt(ps, pt); if (top) put(mid(top), { key: "severe", level: SPC_LEVEL[top.category] || 0, text: top.category === "TSTM" ? "Thunderstorms possible" : "Severe storms: " + SPC_NAME[top.category], source: "SPC Day " + d, link: "day" + d });
      const nb = nearHigher(ps.filter((p) => p.category !== "TSTM"), (p) => SPC_LEVEL[p.category] || 0, top ? SPC_LEVEL[top.category] || 0 : 0);
      if (nb) put(mid(nb.p), { key: "severe", level: Math.max(0, nb.lv - 1), text: "Nearby: " + SPC_NAME[nb.p.category] + ", " + nearText(nb), source: "SPC Day " + d, link: "day" + d, near: true });
    }
    // SPC Days 4-8: 15% / 30% areas; "predictability too low" is unknown
    for (const o of inp.spc48 || []) {
      if (o.failed) { if (o.validStart) unknownOn(mid(o), "SPC Day " + o.day + " outlook not confirmed"); continue; }
      const hit = o.products.filter((p) => inside(p.geometry)).sort((a, b) => b.prob - a.prob)[0];
      if (hit) put(mid(o), { key: "severe", level: hit.prob >= 30 ? 3 : 2, text: "Severe storms: " + hit.prob + "% chance within 25 miles", source: "SPC Day " + o.day, link: null });
      const nb = nearHigher(o.products, (p) => (p.prob >= 30 ? 3 : 2), hit ? (hit.prob >= 30 ? 3 : 2) : 0);
      if (nb) put(mid(o), { key: "severe", level: Math.max(0, nb.lv - 1), text: "Nearby: " + nb.p.prob + "% severe area, " + nearText(nb), source: "SPC Day " + o.day, link: null, near: true });
      else if (o.status === "predictability-too-low") limitOn(mid(o), "SPC can't say yet for severe storms (Day " + o.day + ": predictability too low)");
    }
    // WPC excessive rainfall Days 1-5
    for (const o of inp.ero || []) {
      if (o.failed) { if (o.validStart) unknownOn(mid(o), "WPC Day " + o.day + " rainfall outlook not confirmed"); continue; }
      const hit = (o.products || []).filter((p) => inside(p.geometry)).sort((a, b) => (ERO_LEVEL[b.category] || 0) - (ERO_LEVEL[a.category] || 0))[0];
      if (hit) put(mid(o), { key: "rain", level: ERO_LEVEL[hit.category] || 1, text: "Excessive rainfall: " + ERO_NAME[hit.category], source: "WPC Day " + o.day, link: o.day <= 3 ? "day" + o.day : null });
      const nb = nearHigher(o.products || [], (p) => ERO_LEVEL[p.category] || 0, hit ? ERO_LEVEL[hit.category] || 0 : 0);
      if (nb && o.validStart) put(mid(o), { key: "rain", level: Math.max(0, nb.lv - 1), text: "Nearby: excessive rainfall " + ERO_NAME[nb.p.category] + ", " + nearText(nb), source: "WPC Day " + o.day, link: o.day <= 3 ? "day" + o.day : null, near: true });
    }
    // SPC fire weather Days 1-8 (the highest of the day's parts)
    if (inp.states.fire === "ok") {
      const byDay = new Map(); for (const p of inp.fire || []) if (inside(p.geometry)) { const k = p.day, cur = byDay.get(k); if (!cur || (FIRE_LEVEL[p.category] || 0) > (FIRE_LEVEL[cur.category] || 0)) byDay.set(k, p); }
      for (const p of byDay.values()) put(mid(p), { key: "fire", level: FIRE_LEVEL[p.category] || 1, text: "Fire weather: " + (FIRE_NAME[p.category] || p.category), source: "SPC fire Day " + p.day, link: "fire" });
    } else if (inp.states.fire && inp.states.fire !== "off") unknownOn(now, "SPC fire weather outlooks not confirmed");
    // WPC WSSI-P (winter): the highest impact level with at least a 30% chance, per window
    if (inp.states.wssi === "ok") for (const w of inp.wssi || []) {
      let top = null; for (const L of WSSI_LEVELS) if ((w.levels[L] || 0) >= 30) top = L;
      if (top && top !== "WWA") put(Date.parse(w.start) + 6 * 3600e3, { key: "winter", level: WSSI_LEVEL[top], text: "Winter storm impacts: " + w.levels[top] + "% chance of " + WSSI_NAME[top] + " or worse", source: "WPC WSSI-P", link: "winter" });
      else if (top === "WWA") put(Date.parse(w.start) + 6 * 3600e3, { key: "winter", level: 0, text: "Winter weather possible (" + w.levels.WWA + "%)", source: "WPC WSSI-P", link: "winter" });
    } else if (inp.states.wssi === "failed") unknownOn(now, "WPC winter outlook not confirmed");
    // NHC: the venue inside a forecast cone, or inside a 7-day formation area
    for (const p of inp.nhc || []) if (inside(p.geometry)) {
      if (p.kind === "tctrack" && p.part === "cone") put(now, { key: "tropical", level: 3, text: "Inside the forecast cone of " + (p.name || "a tropical system"), source: "NHC", link: "active" });
      else if (p.kind === "tcoutlook") put(now, { key: "tropical", level: (p.prob7 || 0) >= 60 ? 2 : 1, text: "In NHC's 7-day formation area (" + (p.prob7 || "?") + " chance)", source: "NHC", link: "active" });
    }
    // the NWS forecast grid: gusts, heat index, wind chill / feels-like, rain chance, per local day
    if (inp.grid && inp.grid.rows) {
      const by = new Map(); for (const r of inp.grid.rows) { const k = localDate(Date.parse(r.t), tz); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
      for (const d of days) { const rs = by.get(d.date); if (!rs || !rs.length) continue; const max = (k) => rs.reduce((m, r) => (r[k] != null && (m == null || r[k] > m) ? r[k] : m), null), min = (k) => rs.reduce((m, r) => (r[k] != null && (m == null || r[k] < m) ? r[k] : m), null);
        const g = max("gust"), h = max("heat"), c = min("feels"), pop = max("pop");
        if (g != null && g >= 25) d.items.push({ key: "wind", level: g >= 58 ? 3 : g >= 40 ? 2 : g >= 30 ? 1 : 0, text: "Gusts to " + g + " mph", source: "NWS forecast", link: null });
        if (h != null && h >= 90) d.items.push({ key: "heat", level: h >= 125 ? 3 : h >= 103 ? 2 : 1, text: "Heat index to " + h + "°F", source: "NWS forecast", link: null });
        if (c != null && c <= 20) d.items.push({ key: "cold", level: c <= -30 ? 3 : c <= -15 ? 2 : c <= 10 ? 1 : 0, text: "Feels like " + c + "°F", source: "NWS forecast", link: null });
        if (pop != null && pop >= 40) d.items.push({ key: "precip", level: 0, text: "Rain or snow chance " + pop + "%", source: "NWS forecast", link: null }); }
    } else if (inp.states.grid === "failed") unknownOn(now, "NWS forecast for the venue not confirmed");
    // NOAA river gauges within 25 miles: forecast (or observed) at or above action stage, on the day it is expected
    const GL = { action: 0, minor: 1, moderate: 2, major: 3 }, GW = { action: "action stage", minor: "minor flooding", moderate: "moderate flooding", major: "major flooding" };
    for (const g of inp.gauges || []) {
      const d = T.pointDistance(pt, g.point); if (T.miles(d.km) > 25) continue;
      if (g.obs && GL[g.obs.category] != null && g.obs.category !== "action") put(now, { key: "river", level: GL[g.obs.category], text: g.name + ": " + GW[g.obs.category] + " now (" + g.obs.value + " " + g.obs.unit + ")", source: "NOAA river gauge", link: null });
      if (g.fcst && GL[g.fcst.category] != null && g.fcst.time) put(Date.parse(g.fcst.time), { key: "river", level: GL[g.fcst.category], text: g.name + ": forecast " + GW[g.fcst.category] + " (" + g.fcst.value + " " + g.fcst.unit + ")", source: "NOAA river forecast", link: null });
    }
    if (inp.states.gauges === "failed") unknownOn(now, "NOAA river gauges not confirmed");
    // AirNow forecast for the venue's reporting area
    for (const p of inp.aq || []) { const lv = AQ_LEVEL[p.category]; if (lv) put(Date.parse(p.validDate + "T18:00:00Z"), { key: "air", level: lv, text: "Air quality: " + p.category + (p.aqi ? " (AQI " + p.aqi + ")" : "") + (p.pollutant ? ", " + p.pollutant : ""), source: "AirNow forecast", link: null }); }
    // NWS alerts covering the venue: listed on top, and on each day they cover
    const alerts = (inp.alerts || []).map((a) => ({ event: a.event, level: alertLevel(a.event), headline: a.headline || "", start: Date.parse(a.onset || a.effective), end: Date.parse(a.ends || a.expires), sender: a.senderName || "" }))
      .filter((a) => isFinite(a.end) && a.end > now).sort((a, b) => b.level - a.level || a.start - b.start);
    for (const a of alerts) for (const d of days) { const d0 = Date.parse(new Date(d.date + "T00:00:00Z").toISOString()), s = localDate(Math.max(a.start, now), tz), e = localDate(a.end - 1, tz); if (d.date >= s && d.date <= e) d.items.push({ key: "alert", level: a.level, text: a.event, source: "NWS", link: "active" }); }
    if (inp.states.alerts === "failed") unknownOn(now, "NWS alerts for the venue not confirmed");
    for (const d of days) d.items.sort((a, b) => b.level - a.level);
    // the headline: the highest level ahead (earliest on a tie)
    let best = null; days.forEach((d, i) => d.items.forEach((it) => { if (it.level >= 1 && (!best || it.level > best.it.level)) best = { it, d, i }; }));
    const unknownAll = [...new Set(days.flatMap((d) => d.unknown))];
    const headline = best ? { level: best.it.level, text: best.it.text, when: best.d.label, source: best.it.source }
      : { level: 0, text: unknownAll.length ? "No significant threat in the sources that answered" : "No significant threats in the next " + nDays + " days", when: null, source: null };
    return { headline, alerts, days, unknown: unknownAll };
  }
  return { build, alertLevel, localDate };
});
