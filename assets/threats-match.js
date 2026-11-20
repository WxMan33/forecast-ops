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
  const FAMILY_WORD = { flood: "flooding", severe: "severe storms" };
  const list = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
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
    const items = [], fam = (p) => families.includes(family(p));
    if (!all) return { items, statuses: [], summary: "Add the event's times to check weather threats." };

    /* warnings (and any other product with its own expiry) */
    for (const p of products) {
      if (!fam(p) || p.kind !== "warning") continue;
      const end = Date.parse(p.expires), start = Date.parse(p.issued || p.sent);
      if (!(end > now)) continue;                                  // ended or lapsed: never presented as in effect
      const ph = overlaps(start, end, phases);
      if (!ph.length) continue;
      const rel = T.relation(p, venue);
      if (rel.kind !== "covers" && rel.kind !== "unknown") continue;
      const words = ph.map((x) => PHASE_WORD[x.key] || x.label.toLowerCase());
      items.push({ id: p.id, productId: p.id, family: family(p), kind: "warning", rank: 0, product: p, phases: ph.map((x) => x.key),
        headline: p.event + " until " + clock(end, tz) + (day(end, tz) !== day(now, tz) ? " " + day(end, tz) : ""),
        line: rel.kind === "covers" ? "Covers the venue during " + list(words) + "." : "Area not fully drawn: the warning lists counties that could include the venue during " + list(words) + ".",
        relation: rel, window: { startMs: start, endMs: end } });
    }

    /* outlooks: one item per program, day and issuance, at the highest category containing the venue */
    const groups = new Map();
    for (const p of products) {
      if (!fam(p) || p.kind !== "outlook") continue;
      const k = (p.program || p.sourceId) + "|" + p.day + "|" + p.issued;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    for (const g of groups.values()) {
      const a = g[0], s = Date.parse(a.validStart), e = Date.parse(a.validEnd);
      const ph = overlaps(s, e, phases);
      if (!ph.length) continue;
      const order = a.program === "ero" ? F.ERO_CATS : T.OUTLOOK, inside = g.filter((p) => T.contains(p.geometry, [venue.lon, venue.lat]));
      if (a.program === "spc") { const i = inside.filter((p) => p.category !== "TSTM"); if (!i.length) continue; inside.splice(0, inside.length, ...i); }
      if (!inside.length) continue;
      const top = inside.reduce((x, y) => (order.indexOf(y.category) > order.indexOf(x.category) ? y : x));
      const words = ph.map((x) => PHASE_WORD[x.key] || x.label.toLowerCase());
      const name = a.program === "ero" ? F.ERO_NAME[top.category] + " (" + F.ERO_PCT[top.category] + ")" : T.outlookLabel(top.category);
      const what = a.program === "ero" ? "Excessive rainfall risk" : "Severe storm risk";
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
      const covered = F.covers(src, venue.lat, venue.lon), st = state[src.id];
      let text, ok = false;
      if (!covered) text = "The venue is outside this source's area (" + src.region + "). Not covered here yet.";
      else if (!st || st.kind === "loading") text = "Loading…";
      else if (st.kind === "na") text = "Not part of this sample.";
      else if (st.kind === "unavailable") text = "Not responding · status unknown. We can't rule anything out from this source.";
      else if (st.kind === "stale") text = "Not confirmed since " + (st.lastOk ? clock(Date.parse(st.lastOk), tz) : "this page opened") + ". Showing last known products only.";
      else { ok = true; text = "Checked " + clock(Date.parse(st.lastOk), tz) + (st.reach ? " · " + st.reach : ""); }
      if (ok && st.reachEnd && Date.parse(st.reachEnd) < all.endMs) { ok = false; { const r = Date.parse(st.reachEnd); text += " · Your event runs past the outlooks issued so far (they end " + day(r, tz).slice(0, 3) + " " + clock(r, tz) + ")."; } }
      statuses.push({ id: src.id, name: src.name, provider: src.provider, ok, covered, text, lastOk: st && st.lastOk, url: src.url });
    }
    const confirmed = statuses.length && statuses.every((s) => s.ok);
    const fams = list(families.map((f) => FAMILY_WORD[f] || f));
    const summary = items.length ? items.length + " weather threat" + (items.length > 1 ? "s" : "") + " for this event"
      : confirmed ? "No " + fams + " threats apply to this event's location and times."
        : "Not fully confirmed: no " + fams + " threats found in the data we have, but a source is unavailable, stale or doesn't cover this venue or date.";
    return { items, statuses, summary, confirmed, families };
  }

  return { forEvent, eventPhases, PHASE_WORD };
});
