/* Weather threats ↔ events: one matcher shared by the map and Event Planner, so both agree about coverage.
   Input: normalized products and source states (the same records the map draws) and an event (location, time zone,
   phases as real instants). Output: items that apply to the event, and a status per source, so "nothing applies" is said
   only when every source was actually confirmed.

   Rules
   - Geography: the product's own footprint must cover the venue (T.relation "covers"). A county-based area with zones
     still missing gives "unknown", which is kept as an item: the missing part could cover the venue.
   - Time: the product's own window must overlap the event's schedule. Warnings: issued/onset … expires. Outlooks: their
     valid period. Comparisons use real instants; display uses the event's time zone (so overnight events work).
   - Outlooks: nested categories become one item per issuance and period, at the highest category containing the venue.
     A daily outlook flags the day; it does not time anything within it, and the wording says so.
   - Sources: a source that failed, is stale or has not answered can never contribute "nothing applies".
   Adding a hazard or provider means new products/sources with a `family`; this file and Event Planner stay unchanged. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./threats-core.js"), require("./threats-feeds.js"));
  else root.ThreatsMatch = factory(root.ThreatsCore, root.ThreatsFeeds);
})(typeof globalThis !== "undefined" ? globalThis : this, function (T, F) {
  "use strict";
  const PHASE_WORD = { setup: "setup", gates: "gates", event: "the event", teardown: "teardown" };
  const FAMILY_WORD = { flood: "flooding", severe: "severe storms", winter: "winter weather", fire: "fire weather or wildfire", smoke: "smoke or air quality", tropical: "tropical", coastal: "coastal", aviation: "airport weather" };
  const AQ_KM = 15 * T.KM_PER_MI, AQ_ITEM = 2;               // monitors within 15 miles; items from "Unhealthy for Sensitive Groups" up
  const HMS_RANK = { Light: 0, Medium: 1, Heavy: 2 }, NAQFC_MIN = 9; // NAQFC µg/m³: smoke alone above the top of the EPA "Good" PM2.5 range (9.0 µg/m³, 2024 standard)
  const INCIDENT_KM = 15 * T.KM_PER_MI; // a wildfire is listed when its perimeter, or its reported point, is within 15 miles
  const ALERT_RANK = { warning: 0, watch: 0.3, advisory: 0.4, statement: 0.45 };
  const list = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
  const when = (ms, tz0) => new Date(ms).toLocaleString("en-US", { timeZone: tz0, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).replace(":00", "");
  const day = (ms, tz) => new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
  const clock = (ms, tz) => new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).replace(":00", "").replace("AM", "a.m.").replace("PM", "p.m.");
  const span = (a, b, tz) => { const sameDay = day(a, tz) === day(b, tz); return day(a, tz).slice(0, 3) + " " + clock(a, tz) + " – " + (sameDay ? "" : day(b, tz).slice(0, 3) + " ") + clock(b, tz); };
  const overlaps = (s, e, phases) => phases.filter((p) => p.startMs < e && p.endMs > s);
  const family = (p) => p.family || "severe";

  /* phases from Core.event.windows(ev): setup, gates, event, teardown (the "all" window is the whole schedule) */
  function eventPhases(windows) {
    const ps = windows.filter((w) => w.key !== "all" && Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs > w.startMs);
    const all = windows.find((w) => w.key === "all") || (ps.length ? { startMs: Math.min(...ps.map((p) => p.startMs)), endMs: Math.max(...ps.map((p) => p.endMs)) } : null);
    return { phases: ps, all };
  }

  function forEvent({ products, sources, state, event, now = Date.now(), families = ["flood"] }) {
    const venue = { lat: event.lat, lon: event.lon }, tz = event.tz, { phases, all } = eventPhases(event.windows);
    const items = [], notes = [], fam = (p) => families.includes(family(p));
    if (!all) return { items, statuses: [], summary: "Add the event's times to check weather threats." };

    /* warnings (and any other product with its own expiry) */
    for (const p of products) {
      if (!fam(p) || !(p.kind in ALERT_RANK)) continue;
      const end = Date.parse(p.expires), start = Date.parse(p.issued || p.sent);
      if (!(end > now)) {                                          // ended or lapsed: never presented as in effect
        // reached its published end while its source could not be confirmed: say so, without calling it cancelled
        const st = state[p.sourceId] || {};
        if ((st.kind === "stale" || st.kind === "unavailable") && T.expiredUnconfirmed(p, { state: "failed", lastOk: st.lastOk || null }, now) && overlaps(start, end, phases).length && ["covers", "unknown"].includes(T.relation(p, venue).kind))
          notes.push({ id: p.id, product: p, text: p.event + " reached its published expiration (" + clock(end, tz) + ") while the source could not be reached. It is no longer shown as active; its current status is unknown." });
        continue;
      }
      // tropical watches/warnings run until further notice: they cover every phase from their start on
      const ph = overlaps(start, p.openEnded ? Infinity : end, phases);
      if (!ph.length) continue;
      /* Zone-based alerts use NWS's own placement of the venue when known (event.zones: the forecast, county and fire
         weather zones api.weather.gov/points gives for the venue): the alert covers the venue when it lists one of them.
         A venue NWS places in no land zone (over the water, e.g. a pier: marine zone only) within 1.5 miles of a coastal or
         tropical alert's zone is flagged "for the adjacent shoreline"; a venue NWS places in a different land zone is not
         covered, however close. Without NWS's placement, the drawn zone outline decides. */
      let rel = T.relation(p, venue), shore = false, official = false;
      const vz = event.zones && Array.isArray(event.zones.land) ? event.zones : null;
      if (vz && p.geometrySource === "counties" && (p.zones || []).length) {
        if ((p.zones || []).some((u) => vz.land.includes(u))) { rel = { kind: "covers" }; official = true; }
        else if (!vz.land.length && rel.kind !== "unknown" && (rel.kind === "covers" || (rel.kind === "near" && rel.km <= 1.5 * T.KM_PER_MI)) && ["coastal", "tropical"].includes(family(p))) { rel = { kind: "adjacent", km: rel.km || 0, dir: rel.dir }; shore = true; }
        else continue;
      }
      if (rel.kind !== "covers" && rel.kind !== "unknown" && !shore) continue;
      const words = ph.map((x) => PHASE_WORD[x.key] || x.label.toLowerCase());
      const until = p.openEnded ? "further notice" : clock(end, tz) + (day(end, tz) !== day(now, tz) ? " " + day(end, tz) : "");
      const winter = ["winter", "fire", "tropical", "coastal"].includes(family(p)), fire = ["fire", "tropical", "coastal"].includes(family(p));
      const from = fire && start > now ? "from " + clock(start, tz) + (day(start, tz) !== day(now, tz) ? " " + day(start, tz) : "") + " " : "";
      items.push({ id: p.id, productId: p.id, family: family(p), kind: p.kind, rank: ALERT_RANK[p.kind], product: p, phases: ph.map((x) => x.key),
        headline: shore ? "Coastal alert for the adjacent shoreline: " + p.event : winter ? p.event + " during " + list(words) : p.event + " until " + until,
        adjacent: shore, officialPlacement: official,
        line: shore ? "Issued for " + (p.area || "the coastal zone") + "; NWS places the venue in no land forecast zone (" + (vz.marine || "over the water") + "), " + (rel.km ? T.distanceText(rel.km) + " from that zone" : "at its edge") + ". It covers the shoreline next to the venue, not the venue's own zone. In effect " + from + "until " + until + " during " + list(words) + "." + (p.windWindow ? " NWS window for tropical-storm-force winds: " + p.windWindow + "." : "")
          : rel.kind !== "covers" ? "Area not fully drawn: the " + p.kind + " lists zones that could include the venue during " + list(words) + "."
          : winter ? "In effect at the venue " + from + "until " + until + (p.geometrySource === "counties" ? " (issued for the " + ((p.zones || []).some((u) => /\/zones\/fire\//.test(u)) ? "fire weather" : "forecast") + " zone that includes the venue" + (official ? ", as NWS places it" : "") + ")." : ".") + (p.windWindow ? " NWS window for tropical-storm-force winds: " + p.windWindow + "." : "") + (p.openEnded ? " Updated with each NHC advisory." : "") : "Covers the venue during " + list(words) + ".",
        relation: rel, window: { startMs: start, endMs: p.openEnded ? Math.max(end, all.endMs) : end } });
    }

    /* WPC WSSI-P (winter, probabilistic): per rolling 24-hour window, the probability at the venue of at least each impact
       level. One item: the most significant window overlapping the event. "Likely" only at 60% or more. */
    const wss = products.filter((p) => fam(p) && p.program === "wssip");
    const wUnavail = ((state["wpc-wssi-p"] || {}).unavailable) || []; // levels NOAA's service did not answer for (after a retry)
    if (wss.length) {
      const at = (p) => (p.pointHit ? Math.abs(p.pointHit[0] - venue.lon) < 1e-3 && Math.abs(p.pointHit[1] - venue.lat) < 1e-3 : p.geometry && T.contains(p.geometry, [venue.lon, venue.lat]));
      const wins = new Map();
      for (const p of wss) { if (!at(p)) continue; const k = p.validStart; if (!wins.has(k)) wins.set(k, {}); const w = wins.get(k); if (!w[p.category] || p.prob > w[p.category].prob) w[p.category] = p; }
      let best = null;
      for (const [k, w] of wins) {
        const any = Object.values(w)[0], s = Date.parse(any.validStart), e = Date.parse(any.validEnd), ph = overlaps(s, e, phases);
        if (!ph.length) continue;
        let lv = null;
        for (const L of F.WSSI_LEVELS) if (w[L] && w[L].prob >= 30) lv = L;            // most severe level with at least a 30% chance
        if (!lv && w.WWA && w.WWA.prob >= 10) lv = "WWA";
        if (!lv) continue;
        const score = F.WSSI_LEVELS.indexOf(lv) * 1000 + w[lv].prob;
        if (!best || score > best.score) best = { score, lv, w, s, e, ph };
      }
      if (best) {
        const p = best.w[best.lv], words = best.ph.map((x) => PHASE_WORD[x.key] || x.label.toLowerCase());
        const phrase = { WWA: "Winter weather", MINOR: "Minor winter impacts", MODERATE: "Moderate winter impacts", MAJOR: "Major winter impacts", EXTREME: "Extreme winter impacts" }[best.lv];
        const word = p.prob >= 60 ? "likely" : p.prob >= 30 ? "possible" : null, dname = day(Math.max(best.s, all.startMs), tz);
        items.push({ id: p.id, productId: p.id, family: "winter", kind: "outlook", rank: 1 + (5 - F.WSSI_LEVELS.indexOf(best.lv)) / 10, product: p, phases: best.ph.map((x) => x.key),
          levels: F.WSSI_LEVELS.map((L) => [L, wUnavail.includes(L) ? null : best.w[L] ? best.w[L].prob : 0]), unavailable: wUnavail,
          headline: (word ? phrase + " " + word + " " + dname : "Low chance of " + phrase.toLowerCase() + " " + dname) + " · " + p.prob + "% chance of at least " + F.WSSI_NAME[best.lv] + (best.lv === "WWA" ? "" : " impacts"),
          line: "WPC's winter storm severity outlook (WSSI-P) for the 24 hours " + span(best.s, best.e, tz) + " includes the venue and overlaps " + list(words) + ". " + F.WSSI_MEANING[best.lv] + " A chance for the whole 24 hours, not timing within it.",
          relation: { kind: "covers" }, window: { startMs: best.s, endMs: best.e } });
      }
    }

    /* wildfire incidents (NIFC): no valid window, so they apply while the event is still ahead or under way. Listed when
       the perimeter includes the venue or is within 15 miles, or, without a perimeter, the reported point is within 15
       miles. Prescribed fires are left out of Planner. */
    if (all.endMs > now) for (const p of products) {
      if (!fam(p) || p.kind !== "incident" || p.category === "RX") continue;
      let at = null;
      if (p.geometry) { const r = T.relation(p, venue, INCIDENT_KM); if (r.kind === "covers") at = { km: 0, inside: true }; else if (r.kind === "near") at = { km: r.km, dir: r.dir }; }
      else { const d = T.pointDistance([venue.lon, venue.lat], p.point); if (d.km <= INCIDENT_KM) at = { km: d.km, dir: d.dir, pointOnly: true }; }
      if (!at) continue;
      const facts = [p.acres != null ? Math.round(p.acres).toLocaleString("en-US") + " acres" : "size not reported", p.contained != null ? p.contained + "% contained" : "containment not reported"].join(" · ");
      const where = at.inside ? "Wildfire perimeter includes the venue" : (p.category === "CX" ? "Wildfire complex " : "Wildfire ") + T.distanceText(at.km) + " " + at.dir + (at.pointOnly ? " (reported location; no mapped perimeter)" : "");
      const upd = p.updated ? new Date(p.updated).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown";
      items.push({ id: p.id, productId: p.id, family: "fire", kind: "incident", rank: at.inside ? 0.2 : 0.5 + Math.min(at.km, 30) / 100, product: p, phases: phases.filter((x) => x.endMs > now).map((x) => x.key),
        distanceKm: at.km, inside: !!at.inside, pointOnly: !!at.pointOnly,
        headline: where + ": " + p.name + " · " + facts,
        line: "Active incident reported to NIFC (updated " + upd + "). Incidents have no end time; size, containment and spread can change before the event.",
        relation: at.inside ? { kind: "covers" } : { kind: "near", km: at.km, dir: at.dir }, window: { startMs: now, endMs: all.endMs } });
    }

    /* SMOKE AND AIR QUALITY. Current observations (satellite smoke, monitors) are conditions now, shown beside an event
       that is still ahead or under way, with their own time. Forecasts are matched to the event's own days or hours. */
    const smokeNotes = {};
    if (families.includes("smoke") && all.endMs > now) {
      const tnow = (iso) => clock(Date.parse(iso), tz) + (day(Date.parse(iso), tz) !== day(now, tz) ? " " + day(Date.parse(iso), tz) : "");
      const ahead = all.startMs > now ? (" Your event starts " + day(all.startMs, tz) + " " + clock(all.startMs, tz) + ".").replace(/\.\.$/, ".") : "";
      // satellite smoke: the latest analysis window (ended within 24 h) whose polygon includes the venue, densest first
      const hms = products.filter((p) => p.kind === "smoke" && Date.parse(p.obsEnd) <= now && now - Date.parse(p.obsEnd) < 24 * 3600e3 && T.contains(p.geometry, [venue.lon, venue.lat]));
      if (hms.length) {
        const latest = hms.map((p) => p.obsEnd).sort().pop(), win = hms.filter((p) => p.obsEnd === latest), top = win.reduce((a, b) => (HMS_RANK[b.density] > HMS_RANK[a.density] ? b : a));
        items.push({ id: top.id, productId: top.id, family: "smoke", kind: "smoke", rank: 0.6 + (2 - HMS_RANK[top.density]) / 100, product: top, phases: [],
          headline: "Smoke detected over the area · " + top.density + " (satellite, " + tnow(top.obsStart) + "–" + clock(Date.parse(top.obsEnd), tz) + ")",
          line: "NOAA's satellite smoke analysis outlined " + top.density.toLowerCase() + " smoke over the venue in " + (top.satellite || "satellite") + " imagery. It is smoke in the air column overhead; it does not say what the air is like at the ground." + ahead,
          relation: { kind: "covers" }, window: { startMs: Date.parse(top.obsStart), endMs: Date.parse(top.obsEnd) } });
      }
      // surface monitors within 15 miles, latest reading no older than 3 hours
      const mons = products.filter((p) => p.kind === "aqobs" && now - Date.parse(p.observed) <= 3 * 3600e3 && Date.parse(p.observed) <= now + 3600e3).map((p) => ({ p, d: T.pointDistance([venue.lon, venue.lat], p.point) })).filter((x) => x.d.km <= AQ_KM).sort((a, b) => a.d.km - b.d.km);
      const near = mons[0], worst = mons.slice().sort((a, b) => b.p.aqi - a.p.aqi)[0];
      smokeNotes["airnow-obs"] = near ? "nearest monitor " + near.p.site + " (" + T.distanceText(near.d.km) + " " + near.d.dir + "): AQI " + near.p.aqi + " " + near.p.category + " (" + near.p.pollutant + ") for " + tnow(near.p.observed) : null;
      smokeNotes.noMonitor = !near;
      if (worst && F.AQI_CAT_ORDER.indexOf(worst.p.category) >= AQ_ITEM) {
        const w = worst.p;
        items.push({ id: w.id, productId: w.id, family: "smoke", kind: "aqobs", rank: 0.55 - F.AQI_CAT_ORDER.indexOf(w.category) / 100, product: w, phases: [], distanceKm: worst.d.km, monitors: mons.length,
          headline: "Air quality now: " + w.category + " (AQI " + w.aqi + ", " + w.pollutant + ") at " + w.site + ", " + T.distanceText(worst.d.km) + " " + worst.d.dir,
          line: "AirNow monitor reading for " + tnow(w.observed) + (w.area ? " (" + w.area.split("|")[0] + " reporting area" + (w.agency ? ", " + w.agency : "") + ")" : "") + ". Preliminary data; current conditions, not a forecast." + ahead,
          relation: { kind: "near", km: worst.d.km, dir: worst.d.dir }, window: { startMs: Date.parse(w.observed) - 3600e3, endMs: Date.parse(w.observed) } });
      }
    }
    if (families.includes("smoke")) {
      // AirNow reporting-area forecasts: the venue's area (from the live area lookup) or the nearest area point within 50 miles
      const fc = products.filter((p) => p.kind === "aqfcst");
      const areaOf = fc.some((p) => p.forVenue) ? fc.filter((p) => p.forVenue) : (() => { const ds = fc.map((p) => ({ p, km: T.pointDistance([venue.lon, venue.lat], p.point).km })).filter((x) => x.km <= 50 * T.KM_PER_MI).sort((a, b) => a.km - b.km); return ds.length ? fc.filter((p) => p.area === ds[0].p.area && p.state === ds[0].p.state) : []; })();
      smokeNotes.fcArea = areaOf[0] ? areaOf[0].area : null;
      smokeNotes.fcReach = areaOf.map((p) => p.validEnd).sort().pop() || null;
      for (const p of areaOf) {
        const s = Date.parse(p.validStart), e = Date.parse(p.validEnd), ph = overlaps(s, e, phases);
        if (!ph.length || e <= now || F.AQI_CAT_ORDER.indexOf(p.category) < AQ_ITEM) continue;
        const words = ph.map((x) => PHASE_WORD[x.key] || x.label.toLowerCase());
        items.push({ id: p.id, productId: p.id, family: "smoke", kind: "aqfcst", rank: 1.05 - F.AQI_CAT_ORDER.indexOf(p.category) / 100, product: p, phases: ph.map((x) => x.key),
          headline: "Air quality forecast " + day(s + 12 * 3600e3, tz) + ": " + p.category + " (" + (p.aqi != null ? "AQI " + p.aqi + ", " : "") + p.pollutant + ")",
          line: p.area + " reporting area forecast" + (p.agency ? " by " + p.agency : "") + ", issued " + new Date(p.issued + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ". A forecast for the whole day (" + list(words) + (words.length > 1 ? " fall" : " falls") + " on it), not timing within it." + (p.actionDay ? " Air quality action day." : ""),
          relation: { kind: "covers" }, window: { startMs: s, endMs: e } });
      }
      // NOAA NAQFC near-surface smoke: hours that fall in the event's phases
      const nq = F.NAQFC_ENABLED && products.find((p) => p.kind === "smokefcst" && p.pointHit && Math.abs(p.pointHit[0] - venue.lon) < 1e-3 && Math.abs(p.pointHit[1] - venue.lat) < 1e-3);
      if (nq) {
        smokeNotes.nqReach = nq.validEnd;
        const hit = phases.map((x) => ({ x, hrs: nq.hours.filter((h) => { const t = Date.parse(h.t); return t > x.startMs && t - 3600e3 < x.endMs && t > now; }) })).filter((y) => y.hrs.some((h) => h.v >= NAQFC_MIN));
        if (hit.length) {
          const hrs = hit.flatMap((y) => y.hrs).filter((h) => h.v >= NAQFC_MIN), peak = hrs.reduce((a, b) => (b.v > a.v ? b : a));
          items.push({ id: nq.id, productId: nq.id, family: "smoke", kind: "smokefcst", rank: 1.2, product: nq, phases: hit.map((y) => y.x.key), peak,
            headline: "Smoke in NOAA's forecast during " + list(hit.map((y) => PHASE_WORD[y.x.key] || y.x.label.toLowerCase())),
            line: "NOAA's near-surface smoke guidance (model run " + new Date(nq.run).toISOString().slice(11, 13) + "Z " + day(Date.parse(nq.run), "UTC").slice(0, 3) + ") shows near-surface smoke of 9 µg/m³ or more at the venue in " + hrs.length + " hour" + (hrs.length > 1 ? "s" : "") + " of those phases, up to " + Math.round(peak.v) + " µg/m³ around " + clock(Date.parse(peak.t) - 3600e3, tz) + ". Model guidance, not an air quality reading.",
            relation: { kind: "covers" }, window: { startMs: Date.parse(hrs[0].t) - 3600e3, endMs: Date.parse(hrs[hrs.length - 1].t) } });
        }
      }
    }

    /* NHC wind speed probabilities at the venue: cumulative chance over the 5 days after the advisory. Listed from 10% for
       tropical-storm-force (34 kt) winds when the event starts inside those 5 days; no phase wording (not timing). */
    if (families.includes("tropical")) {
      const ws = products.filter((p) => p.kind === "tcwind" && p.pointHit && Math.abs(p.pointHit[0] - venue.lon) < 1e-3 && Math.abs(p.pointHit[1] - venue.lat) < 1e-3);
      const by = Object.fromEntries(ws.map((p) => [p.kt, p])), t34 = by[34];
      const issued = t34 && t34.issued ? Date.parse(t34.issued) : null, until = issued ? issued + 120 * 3600e3 : null;
      if (t34 && t34.pct >= 10 && all.endMs > now && (!until || all.startMs < until)) {
        const pc = (kt) => (by[kt] ? (by[kt].band && /-/.test(by[kt].band) ? by[kt].band : by[kt].pct < 5 ? "under 5%" : Math.round(by[kt].pct) + "%") : "under 5%");
        items.push({ id: t34.id, productId: t34.id, family: "tropical", kind: "tcwind", rank: 0.35, product: t34, phases: [], levels: [[34, pc(34)], [50, pc(50)], [64, pc(64)]],
          headline: (t34.band && /-/.test(t34.band) ? t34.band : Math.round(t34.pct) + "%") + " chance of tropical-storm-force winds (39+ mph, 34 kt) at the venue" + (until ? " through " + day(until, tz) : ""),
          window5: issued ? { from: issued, to: until } : null,
          line: "NHC wind speed probabilities, forecast window " + (issued ? when(issued, tz) + " – " + when(until, tz) : "the 5 days after the advisory") + ": 39+ mph (34 kt) " + pc(34) + ", 58+ mph (50 kt) " + pc(50) + ", 74+ mph (64 kt) " + pc(64) + ". The chance of those winds at some time in that window, not timing; it applies whether or not the venue is inside the forecast cone. NWS watches and warnings for the venue give the timing.",
          relation: { kind: "covers" }, window: { startMs: now, endMs: until || all.endMs } });
      }
    }

    /* AVIATION: each airport the event uses (event.airports: icao, role primary/alternate, arrive/depart windows as instants)
       against its own TAF periods (base, FM, TEMPO, PROB, each with its own times) and its latest METAR. A concern is IFR or
       LIFR, gusts of 30 kt or more (or 25 kt sustained), thunderstorms or freezing/frozen precipitation. Each item names the
       airport, the window and when the product was issued or observed. */
    const avNotes = [];
    if (families.includes("aviation") && Array.isArray(event.airports) && event.airports.length) {
      const fmtW = (w) => day(w.startMs, tz).slice(0, 3) + " " + clock(w.startMs, tz) + "–" + clock(w.endMs, tz);
      const z = (iso) => { const d = new Date(iso); return String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z"; };
      for (const ap of event.airports) {
        const taf = products.filter((p) => p.kind === "taf" && p.airport === ap.icao).sort((a, b) => (a.issued < b.issued ? 1 : -1))[0];
        const met = products.filter((p) => p.kind === "metar" && p.airport === ap.icao).sort((a, b) => (a.observed < b.observed ? 1 : -1))[0];
        const role = ap.role === "alternate" ? "alternate" : "primary";
        const notes = [];
        if (met) notes.push(ap.icao + " METAR " + z(met.observed) + " " + met.category); else notes.push(ap.icao + " METAR not available");
        if (taf) notes.push("TAF " + z(taf.issued) + (taf.amended ? " AMD" : "") + " valid to " + day(Date.parse(taf.validEnd), tz).slice(0, 3) + " " + clock(Date.parse(taf.validEnd), tz)); else notes.push("no TAF (" + ap.icao + " may not issue one)");
        let gap = !taf;
        for (const [wk, w] of [["arrival", ap.arrive], ["departure", ap.depart]]) {
          if (!w || !(w.endMs > now)) continue;
          if (taf && Date.parse(taf.validEnd) < w.endMs) { gap = true; notes.push("the " + wk + " window runs past the TAF (ends " + clock(Date.parse(taf.validEnd), tz) + ")"); }
          if (!taf) continue;
          const hits = taf.periods.filter((pd) => Date.parse(pd.from) < w.endMs && Date.parse(pd.to) > w.startMs && pd.concerns.length);
          if (!hits.length) continue;
          const sev = (pd) => (pd.category === "LIFR" ? 3 : pd.category === "IFR" ? 2 : 1) + (pd.change === "TEMPO" || pd.prob ? 0 : 0.5);
          const top = hits.reduce((a, b) => (sev(b) > sev(a) ? b : a));
          const how = top.prob ? top.prob + "% chance of " : top.change === "TEMPO" ? "temporarily " : "";
          const what = top.concerns.join(", ");
          const detail = [top.ceiling != null ? "ceiling " + top.ceiling.toLocaleString("en-US") + " ft" : null, top.visibility != null && top.visibility < 6 ? "visibility " + top.visText + " mi" : null, top.wx].filter(Boolean).join(", ");
          items.push({ id: taf.id + "|" + wk + "|" + role, productId: taf.id, family: "aviation", kind: "taf", rank: 0.7 + (3 - sev(top)) / 100, product: taf, phases: [], airport: ap.icao, role, windowKind: wk, period: top, periods: hits,
            headline: ap.icao + " " + wk + " (" + fmtW(w) + "): " + how + what + " forecast",
            line: (role === "alternate" ? "Alternate" : "Primary") + " airport " + (taf.airportName || ap.icao) + ". TAF issued " + z(taf.issued) + (taf.amended ? " (amended)" : "") + "; the " + (top.change === "BASE" ? "forecast" : top.change === "FM" ? "FM " + clock(Date.parse(top.from), tz) + " period" : top.change + " " + clock(Date.parse(top.from), tz) + "–" + clock(Date.parse(top.to), tz) + " period") + " (" + detail + ") overlaps your " + wk + " window. Terminal forecast for the airport, not the venue.",
            relation: { kind: "airport" }, window: { startMs: Math.max(w.startMs, Date.parse(top.from)), endMs: Math.min(w.endMs, Date.parse(top.to)) } });
        }
        const lastWin = Math.max(ap.arrive ? ap.arrive.endMs : 0, ap.depart ? ap.depart.endMs : 0);
        if (met && met.concerns.length && lastWin > now && now - Date.parse(met.observed) < 3 * 3600e3)
          items.push({ id: met.id + "|" + role, productId: met.id, family: "aviation", kind: "metar", rank: 0.65, product: met, phases: [], airport: ap.icao, role,
            headline: ap.icao + " now: " + met.concerns.join(", ") + " (observed " + clock(Date.parse(met.observed), tz) + ")",
            line: (role === "alternate" ? "Alternate" : "Primary") + " airport " + (met.airportName || ap.icao) + " METAR " + z(met.observed) + ": " + met.raw + ". Current conditions, not a forecast for your flight window.",
            relation: { kind: "airport" }, window: { startMs: Date.parse(met.observed) - 3600e3, endMs: Date.parse(met.observed) } });
        avNotes.push({ icao: ap.icao, text: notes.join(" · "), ok: !gap && !!met });
      }
    }

    /* outlooks: one item per program, day and issuance, at the highest category containing the venue */
    const groups = new Map();
    for (const p of products) {
      if (!fam(p) || p.kind !== "outlook" || p.program === "wssip") continue;
      const k = (p.program || p.sourceId) + "|" + p.day + "|" + p.issued;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    for (const g of groups.values()) {
      const a = g[0], s = Date.parse(a.validStart), e = Date.parse(a.validEnd);
      const ph = overlaps(s, e, phases);
      if (!ph.length) continue;
      const fireO = /^spcfire-/.test(a.program || ""), dryt = a.part === "dryt";
      const order = a.program === "ero" ? F.ERO_CATS : fireO ? (a.day >= 3 ? F.FIRE38_CATS : dryt ? F.DRYT_CATS : F.FIRE_CATS) : T.OUTLOOK, inside = g.filter((p) => T.contains(p.geometry, [venue.lon, venue.lat]));
      if (a.program === "spc") { const i = inside.filter((p) => p.category !== "TSTM"); if (!i.length) continue; inside.splice(0, inside.length, ...i); }
      if (!inside.length) continue;
      const top = inside.reduce((x, y) => (order.indexOf(y.category) > order.indexOf(x.category) ? y : x));
      const words = ph.map((x) => PHASE_WORD[x.key] || x.label.toLowerCase());
      const name = a.program === "ero" ? F.ERO_NAME[top.category] + " (" + F.ERO_PCT[top.category] + ")" : T.outlookLabel(top.category);
      const what = a.program === "ero" ? "Excessive rainfall risk" : "Severe storm risk", dname = day(Math.max(s, all.startMs), tz);
      if (fireO) {
        const c = top.category, p38 = c === "P40" || c === "P70";
        const head = a.day >= 3 ? (p38 ? c.slice(1) + "% chance of critical " + (dryt ? "dry thunderstorms " : "fire weather ") + dname : "Critical " + (dryt ? "dry thunderstorm" : "fire weather") + " area " + dname + " (Day " + a.day + " outlook)")
          : dryt ? "Dry thunderstorm risk " + dname + " · " + F.FIRE_NAME[c] : F.FIRE_NAME[c] + " fire weather risk " + dname;
        items.push({ id: top.id, productId: top.id, family: "fire", kind: "outlook", rank: 1 + (order.length - order.indexOf(c)) / 10, product: top, phases: ph.map((x) => x.key), lower: [],
          headline: head,
          line: "The SPC Day " + a.day + " fire weather outlook includes the venue and its period (" + span(s, e, tz) + ") overlaps " + list(words) + ". " + (p38 ? F.FIRE_MEANING[c] : F.FIRE_MEANING[c] || "") + " It rates the weather and fuels for the whole period, not timing within it, and not whether a fire starts.",
          relation: { kind: "covers" }, window: { startMs: s, endMs: e } });
        continue;
      }
      items.push({ id: top.id, productId: top.id, family: family(top), kind: "outlook", rank: 1 + (order.length - order.indexOf(top.category)) / 10, product: top, phases: ph.map((x) => x.key),
        lower: inside.filter((p) => p !== top).map((p) => p.category),
        headline: what + " " + day(Math.max(s, all.startMs), tz) + " · " + name,
        line: "The " + (a.program === "ero" ? "WPC" : "SPC") + " Day " + a.day + " outlook includes the venue and its period (" + span(s, e, tz) + ") overlaps " + list(words) + ". It is a risk for the whole period, not timing within it.",
        relation: { kind: "covers" }, window: { startMs: s, endMs: e } });
    }
    items.sort((x, y) => x.rank - y.rank || x.window.startMs - y.window.startMs);

    /* what each source could say about this event */
    const statuses = [];
    for (const src of (F.SOURCES || []).filter((x) => x.hazards.some((h) => families.includes(h)))) {
      const covered = F.covers(src, venue.lat, venue.lon), st = state[src.id] ? { ...state[src.id] } : undefined;
      let text, ok = false;
      if (!covered) text = "The venue is outside this source's area (" + src.region + "). Not covered here yet.";
      else if (!st || st.kind === "loading") text = "Loading…";
      else if (st.kind === "na") text = "Not part of this sample.";
      else if (st.kind === "unavailable") text = "Not responding · status unknown. We can't rule anything out from this source.";
      else if (st.kind === "stale") text = ("Not confirmed since " + (st.lastOk ? clock(Date.parse(st.lastOk), tz) : "this page opened") + ".").replace(/\.\.$/, ".") + " Showing last known products only.";
      else { ok = true; text = "Checked " + clock(Date.parse(st.lastOk), tz) + (st.reach ? " · " + st.reach : ""); }
      if (src.id === "awc") { if (!avNotes.length) continue; if (ok) { text += " · " + avNotes.map((x) => x.text).join(" | "); if (avNotes.some((x) => !x.ok)) ok = false; } }
      if (src.id === "wpc-wssi-p" && ok && (st.unavailable || []).length) text += " · " + st.unavailable.map((L) => F.WSSI_NAME[L] === "winter weather" ? "Winter weather" : F.WSSI_NAME[L]).join(", ") + " unavailable";
      if (src.id === "airnow-obs" && ok) { if (smokeNotes.noMonitor) { ok = false; text = "No AirNow monitor reading within 15 miles in the last 3 hours: surface air quality isn't reported for this venue."; } else if (smokeNotes["airnow-obs"]) text += " · " + smokeNotes["airnow-obs"]; }
      if (src.id === "airnow-fcst" && ok) { if (!smokeNotes.fcArea) { ok = false; text = "No AirNow forecast area for this venue."; } else { text += " · " + smokeNotes.fcArea + " reporting area"; st.reachEnd = smokeNotes.fcReach; } }
      if (src.id === "noaa-naqfc-smoke" && ok && smokeNotes.nqReach) st.reachEnd = smokeNotes.nqReach;
      if (ok && st.reachEnd && Date.parse(st.reachEnd) < all.endMs) { ok = false; { const r = Date.parse(st.reachEnd); text += " · Your event runs past the outlooks issued so far (they end " + day(r, tz).slice(0, 3) + " " + clock(r, tz) + ")."; } }
      statuses.push({ id: src.id, name: src.name, provider: src.provider, ok, covered, text, lastOk: st && st.lastOk, url: src.url });
    }
    const confirmed = statuses.length && statuses.every((s) => s.ok);
    const fams = list(families.map((f) => FAMILY_WORD[f] || f));
    const summary = items.length ? items.length + " weather threat" + (items.length > 1 ? "s" : "") + " for this event"
      : confirmed ? "No " + fams + " threats apply to this event's location and times."
        : "Not fully confirmed: no " + fams + " threats found in the data we have, but a source is unavailable, stale or doesn't cover this venue or date.";
    return { items, notes, statuses, summary, confirmed, families };
  }

  return { forEvent, eventPhases, PHASE_WORD };
});
