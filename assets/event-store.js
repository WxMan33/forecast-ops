/* Event Manager beta: upcoming events and saved venues, stored in this browser.
   The records are structured so a calendar import can feed the same list later:
     venue  { id, name, city, lat, lon, tz, defaults: { setup, gates, teardown, gust } }
            setup/gates: minutes before the event starts; teardown: minutes after it ends; gust: tent limit (mph)
     event  { id, name, venueId, loc: { name, lat, lon }, tz, times: { setup, gates, start, end, teardown },
              gust, overrides: ["gates", …], source: { kind: "manual" | "calendar", calendarId?, eventId?, etag? },
              created, updated }
   Times are the venue's local wall clock ("YYYY-MM-DDTHH:MM"), as Core.event expects. A calendar event without a
   recognised venue has loc.lat/lon = null and shows "Venue needs confirmation".
   Pure helpers (applyDefaults, overridesOf, offsetsOf, statusOf, order, fromCalendar) run in Node for tests. */
(function (root) {
  "use strict";
  const EV_KEY = "beta_events_v2", VN_KEY = "beta_venues_v1", LAST_KEY = "beta_event_last", OLD_KEY = "beta_event_v1";
  const PHASE_KEYS = ["setup", "gates", "teardown"];
  const STD = { setup: 240, gates: 90, teardown: 120, gust: 25 }; // until a venue has its own defaults
  const fin = (x) => typeof x === "number" && isFinite(x);
  const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  /* ---- wall-clock arithmetic on local "YYYY-MM-DDTHH:MM" strings (what a planner means by "90 minutes before") ---- */
  const toMin = (s) => Date.parse(s + ":00Z") / 60e3;
  const fromMin = (m) => new Date(m * 60e3).toISOString().slice(0, 16);
  const addMin = (s, n) => fromMin(toMin(s) + n);
  const diffMin = (a, b) => toMin(a) - toMin(b);

  /* event times from a venue's defaults: date + start/end ("HH:MM"); an end before the start is the next day */
  function applyDefaults(defs, date, start, end) {
    const d = { ...STD, ...(defs || {}) }, s = `${date}T${start}`;
    let e = `${date}T${end}`; if (end <= start) e = addMin(e, 1440);
    const t = { start: s, end: e };
    if (d.setup != null) t.setup = addMin(s, -d.setup);
    if (d.gates != null) t.gates = addMin(s, -d.gates);
    if (d.teardown != null) t.teardown = addMin(e, d.teardown);
    return t;
  }
  /* a venue's offsets read back from an event's times (to save an event's schedule as the venue default) */
  function offsetsOf(times) {
    const o = {};
    if (times.setup) o.setup = diffMin(times.start, times.setup);
    if (times.gates) o.gates = diffMin(times.start, times.gates);
    if (times.teardown) o.teardown = diffMin(times.teardown, times.end);
    return o;
  }
  /* which phases differ from the venue's defaults for this event */
  function overridesOf(times, defs) {
    if (!defs) return [];
    const want = applyDefaults(defs, times.start.slice(0, 10), times.start.slice(11, 16), times.end.slice(11, 16));
    return PHASE_KEYS.filter((k) => (times[k] || null) !== (want[k] || null));
  }

  /* ---- one status per event, from the briefing (BetaStory.eventBrief + readiness), or from what is known without it ----
     ranks: weather concern first, then everything else by start time; past events go to their own list */
  const STATUS = {
    concern: { label: "Weather concern", rank: 0 },
    venue: { label: "Venue needs confirmation", rank: 1 },
    ready: { label: "Briefing ready", rank: 1 },
    partial: { label: "Briefing partly ready", rank: 1 },
    waiting: { label: "Waiting for guidance", rank: 1 },
    unknown: { label: "Couldn't check", rank: 1 },
    past: { label: "Done", rank: 2 },
  };
  function statusOf(ev, { brief = null, ready = null, decision = null, failed = false, endMs = null, now = Date.now(), readyAtText = null } = {}) {
    const mk = (key, text, extra) => ({ key, label: STATUS[key].label, rank: STATUS[key].rank, text, ...extra });
    if (endMs != null && endMs <= now) return mk("past", "This event has ended.");
    if (!ev.loc || !fin(ev.loc.lat) || !fin(ev.loc.lon)) return mk("venue", "Pick the venue to get a site-specific forecast.");
    if (failed) return mk("unknown", "Guidance didn't load. Open the event to try again.");
    if (!brief || !ready) return mk("waiting", readyAtText ? `Briefing expected around ${readyAtText}.` : "The briefing fills in about a week ahead.");
    if (ready.state === "past") return mk("past", "This event has ended.");
    if (brief.top && ready.state !== "pending") return mk("concern", decision || `${brief.top.label} during the event.`, { tier: brief.top.tier });
    if (ready.state === "ready") return mk("ready", "Forecast covers setup through teardown.");
    if (ready.state === "partial") return mk("partial", ready.line + (readyAtText ? ` · full briefing around ${readyAtText}` : ""));
    return mk("waiting", readyAtText ? `Briefing expected around ${readyAtText}.` : "Hourly guidance doesn't reach this event yet.");
  }
  /* list order: needs a weather decision first, then by start; past separately, most recent first */
  function order(items) {
    const live = items.filter((x) => x.status.key !== "past").sort((a, b) => a.status.rank - b.status.rank || a.startMs - b.startMs);
    const past = items.filter((x) => x.status.key === "past").sort((a, b) => b.startMs - a.startMs);
    return { live, past };
  }

  /* ---- venue matching for calendar locations ----
     One answer per location: a single clear match (by remembered alias, venue name or street address), "ambiguous"
     (several venues fit) or "unknown" (blank or nothing fits). Saved venues come first; built-in venues cover the
     local stadiums so a first import at Paycor Stadium needs no confirmation. */
  const BUILTIN = [
    { id: "bi_paycor", name: "Paycor Stadium", city: "Cincinnati, OH", lat: 39.0955, lon: -84.5161, tz: "America/New_York", address: "1 Paycor Stadium, Cincinnati, OH 45202", aliases: ["paul brown stadium"], builtin: true },
    { id: "bi_tql", name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5222, tz: "America/New_York", address: "1501 Central Pkwy W, Cincinnati, OH 45214", aliases: [], builtin: true },
    { id: "bi_gabp", name: "Great American Ball Park", city: "Cincinnati, OH", lat: 39.0975, lon: -84.5066, tz: "America/New_York", address: "100 Joe Nuxhall Way, Cincinnati, OH 45202", aliases: ["great american ballpark", "gabp"], builtin: true },
  ];
  const norm = (t) => String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(street|st|parkway|pkwy|west|w|east|e|north|n|south|s|avenue|ave|road|rd|drive|dr|boulevard|blvd)\b/g, (m) => ({ street: "st", parkway: "pkwy", west: "w", east: "e", north: "n", south: "s", avenue: "ave", road: "rd", drive: "dr", boulevard: "blvd" }[m] || m)).replace(/\s+/g, " ").trim();
  const has = (hay, needle) => !!needle && needle.length >= 4 && (" " + hay + " ").includes(" " + needle + " ");
  const streetOf = (addr) => norm(String(addr || "").split(",")[0]); // "1501 central pkwy w"
  function matchVenue(location, venues) {
    const loc = norm(location); if (!loc) return { status: "unknown", reason: "no location" };
    const pool = [...venues, ...BUILTIN.filter((b) => !venues.some((v) => norm(v.name) === norm(b.name)))].map((v) => ({ ...v, defaults: { ...STD, ...(v.defaults || {}) } }));
    const by = (pred) => pool.filter(pred);
    let hit = by((v) => (v.aliases || []).some((a) => norm(a) === loc));
    if (hit.length === 1) return { status: "matched", venue: hit[0], via: "remembered" };
    hit = by((v) => has(loc, norm(v.name)) || (v.aliases || []).some((a) => has(loc, norm(a))));
    if (hit.length === 1) return { status: "matched", venue: hit[0], via: "name" };
    if (hit.length > 1) return { status: "ambiguous", candidates: hit };
    hit = by((v) => v.address && has(loc, streetOf(v.address)));
    if (hit.length === 1) return { status: "matched", venue: hit[0], via: "address" };
    if (hit.length > 1) return { status: "ambiguous", candidates: hit };
    return { status: "unknown", reason: "no saved or built-in venue fits" };
  }
  /* the venue's local wall clock for an instant: "YYYY-MM-DDTHH:MM" */
  const wallAt = (iso, tz) => new Date(iso).toLocaleString("sv-SE", { timeZone: tz, hourCycle: "h23" }).slice(0, 16).replace(" ", "T");

  /* ---- a calendar event (Google Calendar API shape) mapped onto the same record ----
     The calendar's own start/end instants are kept on the record (source.start/end), so venue-local times are always
     computed from them, whenever the venue (and so the time zone) is known or changes. calTz: the calendar's time zone. */
  function fromCalendar(g, venues, calendarId, calTz) {
    const s = g.start && g.start.dateTime, e = g.end && g.end.dateTime;
    if (!s || !e) return null; // all-day items are not events with a schedule
    const location = String(g.location || "").trim(), m = matchVenue(location, venues), v = m.status === "matched" ? m.venue : null;
    const tz = (v && v.tz) || g.start.timeZone || calTz || null;
    const start = tz ? wallAt(s, tz) : null, end = tz ? wallAt(e, tz) : null;
    const times = v ? applyDefaults(v.defaults, start.slice(0, 10), start.slice(11, 16), end.slice(11, 16)) : start ? { start, end } : { start: wallAt(s, "UTC"), end: wallAt(e, "UTC") };
    return { id: `cal_${g.id}`, name: String(g.summary || "Calendar event").slice(0, 80), venueId: v ? v.id : null,
      loc: v ? { name: v.name, lat: v.lat, lon: v.lon } : { name: location || "Venue not set", lat: null, lon: null }, tz,
      times, gust: v && v.defaults && v.defaults.gust ? v.defaults.gust : STD.gust, overrides: [],
      match: { status: m.status, via: m.via || null, candidates: (m.candidates || []).map((c) => c.id) },
      source: { kind: "calendar", calendarId: calendarId || null, eventId: g.id, etag: g.etag || null, start: s, end: e, location, calTz: calTz || null },
      created: Date.now(), updated: Date.now() };
  }

  /* ---- merge imported calendar records into the list ----
     New events are added. An event imported before (same calendar event ID) is updated in place: name and
     start/end follow the calendar; a confirmed venue and the planner's per-event times are kept (an override
     keeps its offset from the start, so "gates 2 h before" survives a kickoff change). Pure: list in, list out. */
  function mergeImported(list, recs, venueOf) {
    const out = list.slice(), now = Date.now(); let added = 0, updated = 0, unchanged = 0, relocated = 0;
    recs.forEach((r) => {
      const i = out.findIndex((x) => x.id === r.id);
      if (i < 0) { out.push({ ...r, created: now, updated: now }); added++; return; }
      const old = out[i], os = old.source || {}, rs = r.source || {};
      /* a venue the planner confirmed stays only while the calendar location is the same; a new location is resolved */
      const sameLoc = os.location == null || norm(os.location) === norm(rs.location);
      const keepVenue = sameLoc && (old.venueId || (old.loc && fin(old.loc.lat)));
      const venue = keepVenue && old.venueId && venueOf ? venueOf(old.venueId) : null;
      const tz = keepVenue ? old.tz : r.tz;
      const start = rs.start && tz ? wallAt(rs.start, tz) : r.times.start, end = rs.end && tz ? wallAt(rs.end, tz) : r.times.end;
      let times;
      if (keepVenue && old.times.start === start && old.times.end === end) times = old.times;
      else {
        const v = keepVenue ? venue : r.venueId && venueOf ? venueOf(r.venueId) : null;
        times = v ? applyDefaults(v.defaults, start.slice(0, 10), start.slice(11, 16), end.slice(11, 16)) : { ...r.times, start, end };
        (old.overrides || []).forEach((k) => { if (!times.start || !old.times[k]) return; if (k === "teardown") times.teardown = addMin(end, diffMin(old.times.teardown, old.times.end)); else times[k] = addMin(start, diffMin(old.times[k], old.times.start)); });
      }
      const next = { ...old, name: r.name, times, tz, venueId: keepVenue ? old.venueId : r.venueId, loc: keepVenue ? old.loc : r.loc,
        match: keepVenue ? old.match : r.match, source: { ...os, ...rs }, updated: now };
      if (!sameLoc) relocated++;
      if (JSON.stringify({ ...next, updated: 0 }) === JSON.stringify({ ...old, updated: 0 })) unchanged++; else { out[i] = next; updated++; }
    });
    return { list: out, added, updated, unchanged, relocated };
  }
  /* remember a calendar location as an alias of the venue the planner matched it to (saved venues only) */
  function rememberAlias(venue, location) {
    const a = String(location || "").trim(); if (!a || !venue) return venue;
    const base = getVenue(venue.id) || venue, aliases = base.aliases || [];
    if (aliases.some((x) => norm(x) === norm(a)) || norm(a) === norm(base.name)) return saveVenue({ ...base, builtin: undefined });
    return saveVenue({ ...base, builtin: undefined, aliases: [...aliases, a] });
  }
  /* confirm an imported event's venue: it takes the venue's place and defaults (the calendar's start/end stay) */
  function confirmVenue(ev, v) {
    v = { ...v, defaults: { ...STD, ...(v.defaults || {}) } };
    /* times come from the calendar's original instants in the venue's time zone (never relabel another zone's clock) */
    const src = ev.source || {}, start = src.start ? wallAt(src.start, v.tz) : ev.times.start, end = src.end ? wallAt(src.end, v.tz) : ev.times.end;
    const t = applyDefaults(v.defaults, start.slice(0, 10), start.slice(11, 16), end.slice(11, 16));
    return { ...ev, venueId: v.id, loc: { name: v.name, lat: v.lat, lon: v.lon }, tz: v.tz, times: t, gust: (v.defaults && v.defaults.gust) || ev.gust, overrides: [], match: { status: "matched", via: "confirmed", candidates: [] } };
  }

  /* ---- browser storage ---- */
  function ls() { try { return root.localStorage; } catch (e) { return null; } }
  const read = (k, d) => { try { const v = JSON.parse(ls().getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { ls().setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const events = () => read(EV_KEY, []).filter((x) => x && x.id && x.times);
  const venues = () => read(VN_KEY, []).filter((x) => x && x.id && x.name);
  function saveEvent(ev) {
    const list = events(), now = Date.now(), rec = { overrides: [], source: { kind: "manual" }, created: now, ...ev, id: ev.id && ev.id.startsWith("ev_") || (ev.source && ev.source.kind === "calendar") ? ev.id : newId("ev"), updated: now };
    const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec);
    write(EV_KEY, list); return rec;
  }
  const getEvent = (id) => events().find((x) => x.id === id) || null;
  const removeEvent = (id) => write(EV_KEY, events().filter((x) => x.id !== id));
  function saveVenue(v) {
    const list = venues(), rec = { ...v, id: v.id || newId("vn"), defaults: { ...STD, ...(v.defaults || {}) } };
    const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec);
    write(VN_KEY, list); return rec;
  }
  const getVenue = (id) => venues().find((x) => x.id === id) || (BUILTIN.find((b) => b.id === id) ? { ...BUILTIN.find((b) => b.id === id), defaults: { ...STD } } : null);
  /* removing a venue keeps its events (they carry their own coordinates); they just lose the link to defaults */
  function removeVenue(id) { write(VN_KEY, venues().filter((x) => x.id !== id)); write(EV_KEY, events().map((e) => (e.venueId === id ? { ...e, venueId: null } : e))); }
  const last = () => read(LAST_KEY, null), setLast = (id) => write(LAST_KEY, id);
  /* the earlier single saved event becomes the first item in the list */
  function migrate() {
    const old = read(OLD_KEY, null); if (!old || !old.times) return;
    if (!events().length) { const rec = saveEvent({ ...old, id: null }); setLast(rec.id); }
    try { ls().removeItem(OLD_KEY); } catch (e) { /* ignore */ }
  }

  function importEvents(recs) {
    /* a built-in venue used by an import becomes a saved venue (its defaults can then be edited) */
    recs.forEach((x) => { if (x.venueId && !venues().some((v) => v.id === x.venueId)) { const b = getVenue(x.venueId); if (b) saveVenue({ ...b, builtin: undefined }); } });
    const r = mergeImported(events(), recs, getVenue); write(EV_KEY, r.list); return r;
  }

  const api = { wallAt, BUILTIN, matchVenue, rememberAlias, norm, mergeImported, confirmVenue, importEvents, STD, STATUS, applyDefaults, offsetsOf, overridesOf, statusOf, order, fromCalendar, addMin, diffMin,
    events, venues, saveEvent, getEvent, removeEvent, saveVenue, getVenue, removeVenue, last, setLast, migrate, EV_KEY, VN_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
