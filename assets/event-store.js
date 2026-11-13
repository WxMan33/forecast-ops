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

  /* ---- real time in the venue's zone (offsets are elapsed time: "4 h before" means 4 real hours, across a time change) ---- */
  const wallAt = (iso, tz) => new Date(iso).toLocaleString("sv-SE", { timeZone: tz, hourCycle: "h23" }).slice(0, 16).replace(" ", "T");
  const wallMs = (ms, tz) => wallAt(new Date(ms).toISOString(), tz);
  /* the instants a venue-local "YYYY-MM-DDTHH:MM" names: none (skipped at spring forward), one, or two (fall back) */
  function instantsOf(local, tz) {
    const g = Date.parse(local + ":00Z"); if (!isFinite(g) || !tz) return [];
    const off = (p) => Date.parse(wallMs(p, tz) + ":00Z") - Math.floor(p / 60e3) * 60e3;
    return [...new Set([g - off(g - 12 * 3600e3), g - off(g + 12 * 3600e3)])].sort((a, b) => a - b).filter((m) => wallMs(m, tz) === local);
  }
  /* local time -> instant; fold picks the second of a repeated fall-back time (as Core.time.toUtc) */
  const localMs = (local, tz, fold = 0) => { const c = instantsOf(local, tz); return c.length ? c[Math.min(fold || 0, c.length - 1)] : null; };
  /* fold entries for the times that happen twice that night, from the instants they stand for */
  function foldsFor(times, ms, tz) {
    const f = {};
    Object.keys(times).forEach((k) => { if (ms[k] == null) return; const c = instantsOf(times[k], tz); if (c.length > 1) f[k] = c.indexOf(ms[k]) > 0 ? 1 : 0; });
    return f;
  }
  /* the instant an event's phase stands for (null without a time zone) */
  const msOf = (ev, k) => (ev && ev.times && ev.times[k] && ev.tz ? localMs(ev.times[k], ev.tz, (ev.fold || {})[k]) : null);

  /* ---- a full schedule from a venue's defaults: setup and gates before the start, teardown after the end ----
     start/end are full local "YYYY-MM-DDTHH:MM" (so an event can run past midnight or for several days). With a time
     zone the offsets are real elapsed time; startMs/endMs (a calendar's own instants) settle a repeated fall-back hour.
     Returns { times, fold }; fold lists the times that happen twice and which occurrence is meant. */
  function schedule(defs, { start, end, tz = null, startMs = null, endMs = null }) {
    const d = { ...STD, ...(defs || {}) }, times = { start, end };
    const sMs = startMs != null ? startMs : tz ? localMs(start, tz) : null, eMs = endMs != null ? endMs : tz ? localMs(end, tz) : null;
    const ms = { start: sMs, end: eMs };
    const at = (k, base, baseMs, n) => { if (baseMs != null) { ms[k] = baseMs + n * 60e3; times[k] = wallMs(ms[k], tz); } else times[k] = addMin(base, n); };
    if (d.setup != null) at("setup", start, sMs, -d.setup);
    if (d.gates != null) at("gates", start, sMs, -d.gates);
    if (d.teardown != null) at("teardown", end, eMs, d.teardown);
    return { times, fold: tz ? foldsFor(times, ms, tz) : {} };
  }
  /* the schedule for a calendar event at a venue: venue-local dates and times from the calendar's own instants */
  function scheduleAt(defs, startIso, endIso, tz) {
    return schedule(defs, { start: wallAt(startIso, tz), end: wallAt(endIso, tz), tz, startMs: Date.parse(startIso), endMs: Date.parse(endIso) });
  }
  /* ---- named schedule presets on a venue ----
     venue.presets: [{ id, name, setup, gates, teardown }] in minutes (setup/gates before the start, teardown after the end;
     null = that phase isn't used, e.g. a practice with no gates). The venue's own defaults stay the standard outdoor-event
     schedule. An event names the preset it uses (event.preset); a time changed for one event is that event's override and
     never changes the saved preset. */
  const presetsOf = (v) => (Array.isArray(v && v.presets) ? v.presets : []);
  function defsFor(v, presetId) {
    const base = { ...STD, ...((v && v.defaults) || {}) }, p = presetId ? presetsOf(v).find((x) => x.id === presetId) : null;
    return p ? { ...base, setup: p.setup ?? null, gates: p.gates ?? null, teardown: p.teardown ?? null } : base;
  }
  const newPresetId = () => newId("ps");

  /* event times from a venue's defaults: date + start/end ("HH:MM"); an end before the start is the next day.
     (Single-day shorthand kept for callers that have one date; multi-day events use schedule().) */
  function applyDefaults(defs, date, start, end) {
    let e = `${date}T${end}`; if (end <= start) e = addMin(e, 1440);
    return schedule(defs, { start: `${date}T${start}`, end: e }).times;
  }
  /* minutes between two of an event's times: elapsed when the time zone is known, wall clock otherwise */
  function gap(times, a, b, tz, fold) {
    if (tz) { const x = localMs(times[a], tz, (fold || {})[a]), y = localMs(times[b], tz, (fold || {})[b]); if (x != null && y != null) return (x - y) / 60e3; }
    return diffMin(times[a], times[b]);
  }
  /* a venue's offsets read back from an event's times (to save an event's schedule as the venue default) */
  function offsetsOf(times, tz = null, fold = null) {
    const o = {};
    if (times.setup) o.setup = gap(times, "start", "setup", tz, fold);
    if (times.gates) o.gates = gap(times, "start", "gates", tz, fold);
    if (times.teardown) o.teardown = gap(times, "teardown", "end", tz, fold);
    return o;
  }
  /* which phases differ from the venue's defaults for this event (the event's real start and end, any length) */
  function overridesOf(times, defs, tz = null, fold = null) {
    if (!defs) return [];
    const f = fold || {}, want = schedule(defs, { start: times.start, end: times.end, tz, startMs: tz ? localMs(times.start, tz, f.start) : null, endMs: tz ? localMs(times.end, tz, f.end) : null }).times;
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

  /* ---- a calendar event (Google Calendar API shape) mapped onto the same record ----
     The calendar's own start/end instants are kept on the record (source.start/end), so venue-local times are always
     computed from them, whenever the venue (and so the time zone) is known or changes. calTz: the calendar's time zone. */
  function fromCalendar(g, venues, calendarId, calTz) {
    const s = g.start && g.start.dateTime, e = g.end && g.end.dateTime;
    if (!s || !e) return null; // all-day items are not events with a schedule
    const location = String(g.location || "").trim(), m = matchVenue(location, venues), v = m.status === "matched" ? m.venue : null;
    const tz = (v && v.tz) || g.start.timeZone || calTz || null;
    /* with a venue: its full schedule; without: just the calendar's start and end (their real dates, any length) */
    const sch = v ? scheduleAt(v.defaults, s, e, tz) : tz ? { times: { start: wallAt(s, tz), end: wallAt(e, tz) }, fold: foldsFor({ start: wallAt(s, tz), end: wallAt(e, tz) }, { start: Date.parse(s), end: Date.parse(e) }, tz) } : { times: { start: wallAt(s, "UTC"), end: wallAt(e, "UTC") }, fold: {} };
    return { id: `cal_${g.id}`, name: String(g.summary || "Calendar event").slice(0, 80), venueId: v ? v.id : null,
      loc: v ? { name: v.name, lat: v.lat, lon: v.lon } : { name: location || "Venue not set", lat: null, lon: null }, tz,
      times: sch.times, fold: sch.fold, gust: v && v.defaults && v.defaults.gust ? v.defaults.gust : STD.gust, overrides: [],
      match: { status: m.status, via: m.via || null, candidates: (m.candidates || []).map((c) => c.id) },
      source: { kind: "calendar", calendarId: calendarId || null, eventId: g.id, etag: g.etag || null, start: s, end: e, location, calTz: calTz || null },
      created: Date.now(), updated: Date.now() };
  }

  /* ---- merge imported calendar records into the list ----
     New events are added. An event imported before (same calendar and event IDs) is updated in place: name and
     start/end follow the calendar; a confirmed venue and the planner's per-event times are kept (an override
     keeps its offset from the start, so "gates 2 h before" survives a kickoff change). Pure: list in, list out. */
  function mergeImported(list, recs, venueOf) {
    const out = list.slice(), now = Date.now(); let added = 0, updated = 0, unchanged = 0, relocated = 0;
    recs.forEach((r) => {
      // Google event IDs are unique within a calendar, not across calendars.
      // Match the source pair first; preserve existing local IDs and saved links.
      const rsKey = r.source || {};
      const keyed = (s) => s && s.kind === "calendar" && s.calendarId != null && s.eventId != null;
      const i = out.findIndex((x) => keyed(rsKey) && keyed(x.source)
        ? x.source.calendarId === rsKey.calendarId && x.source.eventId === rsKey.eventId
        : x.id === r.id && !keyed(rsKey) && !keyed(x.source));
      if (i < 0) {
        let id = r.id;
        if (out.some((x) => x.id === id)) {
          const base = `cal_source_${encodeURIComponent(JSON.stringify([rsKey.calendarId, rsKey.eventId]))}`;
          id = base; let n = 1;
          while (out.some((x) => x.id === id)) id = `${base}_${n++}`;
        }
        out.push({ ...r, id, created: now, updated: now }); added++; return;
      }
      const old = out[i], os = old.source || {}, rs = r.source || {};
      /* a venue the planner confirmed stays only while the calendar location is the same; a new location is resolved */
      const sameLoc = os.location == null || norm(os.location) === norm(rs.location);
      const keepVenue = sameLoc && (old.venueId || (old.loc && fin(old.loc.lat)));
      const venue = keepVenue && old.venueId && venueOf ? venueOf(old.venueId) : null;
      const tz = keepVenue ? old.tz : r.tz;
      const inst = rs.start && rs.end && tz, sMs = inst ? Date.parse(rs.start) : null, eMs = inst ? Date.parse(rs.end) : null;
      const start = inst ? wallAt(rs.start, tz) : r.times.start, end = inst ? wallAt(rs.end, tz) : r.times.end;
      let times, fold;
      if (keepVenue && old.times.start === start && old.times.end === end && (!inst || (msOf(old, "start") === sMs && msOf(old, "end") === eMs))) { times = old.times; fold = old.fold || {}; }
      else {
        const v = keepVenue ? venue : r.venueId && venueOf ? venueOf(r.venueId) : null;
        const ms = { start: sMs, end: eMs };
        const vd = v ? defsFor(v, keepVenue ? old.preset : null) : null;
        times = v ? schedule(vd, { start, end, tz, startMs: sMs, endMs: eMs }).times : { ...r.times, start, end };
        if (!v) ["setup", "gates", "teardown"].forEach((k) => { if (!keepVenue || !old.times[k]) return; const d = gap(old.times, k, k === "teardown" ? "end" : "start", old.tz, old.fold); ms[k] = (k === "teardown" ? eMs : sMs); if (ms[k] != null && tz) { ms[k] += d * 60e3; times[k] = wallMs(ms[k], tz); } else times[k] = addMin(k === "teardown" ? end : start, d); });
        /* the planner's own phase times keep their offset: setup/gates from the start, teardown from the end (real minutes) */
        (old.overrides || []).forEach((k) => { if (!times.start || !old.times[k]) return; const from = k === "teardown" ? "end" : "start", d = gap(old.times, k, from, old.tz, old.fold), base = k === "teardown" ? eMs : sMs;
          if (base != null && tz) { ms[k] = base + d * 60e3; times[k] = wallMs(ms[k], tz); } else times[k] = addMin(k === "teardown" ? end : start, d); });
        if (v && tz) { const full = schedule(vd, { start, end, tz, startMs: sMs, endMs: eMs }); PHASE_KEYS.forEach((k) => { if (ms[k] == null && full.times[k] === times[k]) ms[k] = localMs(times[k], tz, full.fold[k]); }); }
        fold = tz ? foldsFor(times, ms, tz) : {};
      }
      const next = { ...old, ...(!keepVenue && old.preset != null ? { preset: null } : {}), name: r.name, times, fold, tz, venueId: keepVenue ? old.venueId : r.venueId, loc: keepVenue ? old.loc : r.loc,
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
    const src = ev.source || {};
    const sch = src.start && src.end ? scheduleAt(v.defaults, src.start, src.end, v.tz) : schedule(v.defaults, { start: ev.times.start, end: ev.times.end, tz: v.tz });
    const { preset, ...rest } = ev; // a preset belongs to the old venue
    return { ...rest, ...(preset != null ? { preset: null } : {}), venueId: v.id, loc: { name: v.name, lat: v.lat, lon: v.lon }, tz: v.tz, times: sch.times, fold: sch.fold, gust: (v.defaults && v.defaults.gust) || ev.gust, overrides: [], match: { status: "matched", via: "confirmed", candidates: [] } };
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

  /* ---- backup and restore ----
     A backup is versioned JSON with the planning records only: saved events (with per-event times, overrides, venue
     confirmation and the calendar's source instants) and saved venues (with defaults and remembered location aliases).
     Records are rebuilt field by field on the way out and in, so nothing else (sign-in tokens, API keys, analytics IDs,
     cached lookups) can ride along. Restoring validates the whole file first, then merges: new records are added,
     identical ones skipped, and a record that differs from one saved here is kept as it is unless the planner chooses
     to replace it. */
  const BACKUP_KIND = "forecast-ops-event-backup", BACKUP_VERSION = 1;
  const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, ISO = (x) => typeof x === "string" && x.length <= 40 && isFinite(Date.parse(x));
  const str = (x, max = 200) => (typeof x === "string" ? x.slice(0, max) : null);
  const num = (x) => (fin(x) ? x : null);
  function cleanVenue(v) {
    const d = v.defaults || {}, out = { id: str(v.id, 120), name: str(v.name, 120), lat: num(v.lat), lon: num(v.lon), tz: str(v.tz, 64),
      aliases: Array.isArray(v.aliases) ? v.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => a.slice(0, 200)).slice(0, 50) : [],
      defaults: Object.fromEntries(["setup", "gates", "teardown", "gust"].filter((k) => fin(d[k])).map((k) => [k, d[k]])) };
    if (typeof v.city === "string") out.city = v.city.slice(0, 200); // optional fields stay optional (exact round trip)
    if (Array.isArray(v.presets)) out.presets = v.presets.filter((p) => p && typeof p === "object").slice(0, 20).map((p) => ({ id: str(p.id, 80), name: str(p.name, 60),
      setup: fin(p.setup) ? p.setup : null, gates: fin(p.gates) ? p.gates : null, teardown: fin(p.teardown) ? p.teardown : null }));
    if (typeof v.address === "string") out.address = v.address.slice(0, 200);
    return out;
  }
  function cleanEvent(e) {
    const t = e.times || {}, src = e.source || {}, m = e.match || {};
    const times = Object.fromEntries(["setup", "gates", "start", "end", "teardown"].filter((k) => typeof t[k] === "string").map((k) => [k, t[k]]));
    const fold = Object.fromEntries(Object.entries(e.fold || {}).filter(([k, x]) => k in times && (x === 0 || x === 1)));
    const source = src.kind === "calendar" ? { kind: "calendar", calendarId: str(src.calendarId, 300), eventId: str(src.eventId, 300), etag: str(src.etag, 120), start: ISO(src.start) ? src.start : null, end: ISO(src.end) ? src.end : null, location: str(src.location, 300) || "", calTz: str(src.calTz, 64) } : { kind: "manual" };
    const out = { id: str(e.id, 400), name: str(e.name, 80), venueId: str(e.venueId, 120), loc: { name: str(e.loc && e.loc.name, 200) || "", lat: num(e.loc && e.loc.lat), lon: num(e.loc && e.loc.lon) }, tz: str(e.tz, 64),
      times, gust: num(e.gust), overrides: Array.isArray(e.overrides) ? e.overrides.filter((k) => PHASE_KEYS.includes(k)) : [], source, created: num(e.created), updated: num(e.updated) };
    if (e.fold) out.fold = fold; // optional fields stay optional, so a record round-trips exactly
    if (e.preset !== undefined) out.preset = str(e.preset, 80);
    if (e.match) out.match = { status: str(m.status, 20) || "unknown", via: str(m.via, 20), candidates: Array.isArray(m.candidates) ? m.candidates.filter((x) => typeof x === "string").slice(0, 20) : [] };
    return out;
  }
  const storageOk = () => { try { const s = ls(); if (!s) return false; s.setItem("beta_storage_probe", "1"); s.removeItem("beta_storage_probe"); return true; } catch (e) { return false; } };
  function backup(now = Date.now()) {
    const vs = venues().map(cleanVenue), es = events().map(cleanEvent);
    return { kind: BACKUP_KIND, version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), app: "Forecast Ops Event Manager beta",
      counts: { events: es.length, venues: vs.length, aliases: vs.reduce((n, v) => n + v.aliases.length, 0) }, venues: vs, events: es };
  }
  const validZone = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; } };
  /* every problem in the file, or the cleaned records; nothing is written here */
  function readBackup(input) {
    let j = input;
    if (typeof input === "string") { if (input.length > 5e6) return { ok: false, errors: ["The file is larger than 5 MB, so it isn't a Forecast Ops backup."] }; try { j = JSON.parse(input); } catch (e) { return { ok: false, errors: ["The file isn't valid JSON (it may be damaged or a different kind of file)."] }; } }
    if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, errors: ["The file isn't a Forecast Ops backup."] };
    if (j.kind !== BACKUP_KIND) return { ok: false, errors: ["The file isn't a Forecast Ops event backup."] };
    if (!Number.isInteger(j.version) || j.version < 1) return { ok: false, errors: ["The backup has no valid version number."] };
    if (j.version > BACKUP_VERSION) return { ok: false, errors: [`The backup is version ${j.version}, from a newer Forecast Ops. This page reads version ${BACKUP_VERSION}.`] };
    if (!Array.isArray(j.events) || !Array.isArray(j.venues)) return { ok: false, errors: ["The backup is missing its events or venues list."] };
    if (j.events.length > 2000 || j.venues.length > 500) return { ok: false, errors: ["The backup holds more records than this beta supports (2,000 events, 500 venues)."] };
    const errors = [], vs = [], es = [], vIds = new Set(), eIds = new Set();
    j.venues.forEach((raw, i) => {
      const where = `Venue ${i + 1}${raw && typeof raw.name === "string" ? ` (${raw.name.slice(0, 40)})` : ""}`;
      if (!raw || typeof raw !== "object") return errors.push(`${where} isn't a record.`);
      const v = cleanVenue(raw);
      if (!v.id || !v.name) errors.push(`${where} has no id or name.`);
      else if (vIds.has(v.id)) errors.push(`${where} repeats the id of another venue.`);
      if (v.lat == null || v.lon == null || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180) errors.push(`${where} has no valid coordinates.`);
      if (!v.tz || !validZone(v.tz)) errors.push(`${where} has no valid time zone.`);
      if (["setup", "gates", "teardown"].some((k) => v.defaults[k] != null && (v.defaults[k] < 0 || v.defaults[k] > 7 * 1440))) errors.push(`${where} has an out-of-range default schedule.`);
      if ((v.presets || []).some((p) => !p.id || !p.name || ["setup", "gates", "teardown"].some((k) => p[k] != null && (p[k] < 0 || p[k] > 7 * 1440)))) errors.push(`${where} has a schedule preset without a name or with out-of-range times.`);
      vIds.add(v.id); vs.push(v);
    });
    j.events.forEach((raw, i) => {
      const where = `Event ${i + 1}${raw && typeof raw.name === "string" ? ` (${raw.name.slice(0, 40)})` : ""}`;
      if (!raw || typeof raw !== "object") return errors.push(`${where} isn't a record.`);
      const e = cleanEvent(raw);
      if (!e.id || !e.name) errors.push(`${where} has no id or name.`);
      else if (eIds.has(e.id)) errors.push(`${where} repeats the id of another event.`);
      if (!e.times.start || !e.times.end) errors.push(`${where} has no start or end.`);
      if (Object.values(e.times).some((x) => !LOCAL.test(x) || !isFinite(Date.parse(x + ":00Z")))) errors.push(`${where} has a time that isn't a valid date and time.`);
      else if (e.times.start && e.times.end && e.times.end <= e.times.start && !(e.tz && e.source.start && e.source.end && Date.parse(e.source.end) > Date.parse(e.source.start))) errors.push(`${where} ends before it starts.`);
      if (e.tz && !validZone(e.tz)) errors.push(`${where} has an unknown time zone.`);
      if ((e.loc.lat == null) !== (e.loc.lon == null) || (e.loc.lat != null && (Math.abs(e.loc.lat) > 90 || Math.abs(e.loc.lon) > 180))) errors.push(`${where} has invalid coordinates.`);
      if (e.source.kind === "calendar" && (!e.source.calendarId || !e.source.eventId)) errors.push(`${where} is a calendar event without its calendar and event IDs.`);
      eIds.add(e.id); es.push(e);
    });
    if (errors.length) return { ok: false, errors: errors.slice(0, 8).concat(errors.length > 8 ? [`…and ${errors.length - 8} more problems.`] : []) };
    return { ok: true, errors: [], version: j.version, exportedAt: ISO(j.exportedAt) ? j.exportedAt : null, venues: vs, events: es };
  }
  /* what restoring would do, against what is saved here now (pure) */
  function planRestore(file, cur = { events: events(), venues: venues() }) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const vById = new Map(cur.venues.map((v) => [v.id, v])), vMap = {}, venuesPlan = [];
    file.venues.forEach((v) => {
      const mine = vById.get(v.id) || cur.venues.find((x) => norm(x.name) === norm(v.name) && Math.abs(x.lat - v.lat) < 0.01 && Math.abs(x.lon - v.lon) < 0.01);
      if (!mine) { venuesPlan.push({ action: "add", rec: v }); vMap[v.id] = v.id; return; }
      vMap[v.id] = mine.id;
      const asMine = { ...v, id: mine.id }, mineC = cleanVenue(mine);
      /* a remembered alias is never lost: aliases from both are kept either way */
      const aliases = [...mineC.aliases, ...v.aliases.filter((a) => !mineC.aliases.some((x) => norm(x) === norm(a)))];
      if (same({ ...asMine, aliases: [] }, { ...mineC, aliases: [] })) venuesPlan.push({ action: aliases.length > mineC.aliases.length ? "aliases" : "same", rec: { ...mineC, aliases }, mine: mineC });
      else venuesPlan.push({ action: "conflict", rec: { ...asMine, aliases }, keep: { ...mineC, aliases }, mine: mineC, name: v.name });
    });
    const key = (e) => (e.source && e.source.kind === "calendar" ? JSON.stringify([e.source.calendarId, e.source.eventId]) : null);
    const eventsPlan = [], taken = new Set(cur.events.map((e) => e.id));
    file.events.forEach((e0) => {
      const e = { ...e0, venueId: e0.venueId && vMap[e0.venueId] ? vMap[e0.venueId] : e0.venueId };
      const mine = cur.events.find((x) => (key(e) && key(x) === key(e)) || (!key(e) && !key(x) && x.id === e.id));
      if (!mine) {
        let id = e.id; if (taken.has(id)) { let n = 1; while (taken.has(`${e.id}_r${n}`)) n++; id = `${e.id}_r${n}`; }
        taken.add(id); eventsPlan.push({ action: "add", rec: { ...e, id } }); return;
      }
      const mineC = cleanEvent(mine), asMine = { ...e, id: mine.id, created: mineC.created, updated: mineC.updated };
      eventsPlan.push(same(asMine, { ...mineC }) ? { action: "same", rec: mineC } : { action: "conflict", rec: asMine, keep: mineC, name: e.name });
    });
    const count = (list, a) => list.filter((x) => x.action === a).length;
    return { venues: venuesPlan, events: eventsPlan, summary: { events: { add: count(eventsPlan, "add"), same: count(eventsPlan, "same"), conflict: count(eventsPlan, "conflict") },
      venues: { add: count(venuesPlan, "add"), same: count(venuesPlan, "same") + count(venuesPlan, "aliases"), conflict: count(venuesPlan, "conflict"), aliases: count(venuesPlan, "aliases") } } };
  }
  /* write the plan: replace=false keeps every record that differs from the backup. All or nothing: if storage refuses
     either list, the earlier lists are put back and the error is raised. */
  function applyRestore(plan, { replace = false } = {}) {
    const s = ls(); if (!s || !storageOk()) throw new Error("This browser isn't letting the page save (private browsing or storage turned off), so nothing was restored.");
    const before = { ev: s.getItem(EV_KEY), vn: s.getItem(VN_KEY) };
    const vs = venues().slice(), es = events().slice(), now = Date.now(); let replaced = 0;
    plan.venues.forEach((p) => {
      const i = vs.findIndex((x) => x.id === p.rec.id);
      if (p.action === "add") vs.push({ ...p.rec, defaults: { ...STD, ...p.rec.defaults } });
      else if (p.action === "aliases" || (p.action === "conflict" && !replace)) { const r = p.action === "conflict" ? p.keep : p.rec; if (i >= 0) vs[i] = { ...vs[i], aliases: r.aliases }; }
      else if (p.action === "conflict" && replace) { if (i >= 0) { vs[i] = { ...p.rec, defaults: { ...STD, ...p.rec.defaults } }; replaced++; } }
    });
    plan.events.forEach((p) => {
      const i = es.findIndex((x) => x.id === p.rec.id);
      if (p.action === "add") es.push({ ...p.rec, created: p.rec.created || now, updated: p.rec.updated || now });
      else if (p.action === "conflict" && replace && i >= 0) { es[i] = { ...p.rec, updated: now }; replaced++; }
    });
    const ok = write(VN_KEY, vs) && write(EV_KEY, es);
    if (!ok) {
      try { before.vn == null ? s.removeItem(VN_KEY) : s.setItem(VN_KEY, before.vn); before.ev == null ? s.removeItem(EV_KEY) : s.setItem(EV_KEY, before.ev); } catch (e) { /* nothing more to do */ }
      throw new Error("The browser ran out of storage space while restoring, so nothing was changed.");
    }
    return { ...plan.summary, replaced };
  }

  const api = { presetsOf, defsFor, newPresetId, BACKUP_KIND, BACKUP_VERSION, backup, readBackup, planRestore, applyRestore, storageOk, wallAt, wallMs, localMs, instantsOf, foldsFor, schedule, scheduleAt, msOf, BUILTIN, matchVenue, rememberAlias, norm, mergeImported, confirmVenue, importEvents, STD, STATUS, applyDefaults, offsetsOf, overridesOf, statusOf, order, fromCalendar, addMin, diffMin,
    events, venues, saveEvent, getEvent, removeEvent, saveVenue, getVenue, removeVenue, last, setLast, migrate, EV_KEY, VN_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
