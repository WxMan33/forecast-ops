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

  /* ---- a calendar event (Google Calendar API shape) mapped onto the same record; venue matched by name ---- */
  function fromCalendar(g, venues, calendarId) {
    const s = g.start && (g.start.dateTime || g.start.date), e = g.end && (g.end.dateTime || g.end.date);
    if (!s || !e || !g.start.dateTime) return null; // all-day items are not events with a schedule
    const loc = String(g.location || "").trim(), v = venues.find((x) => loc && (loc.toLowerCase().includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(loc.split(",")[0].toLowerCase())));
    const tz = (v && v.tz) || g.start.timeZone || null;
    const wall = (iso) => (tz && root.Intl ? new Date(iso).toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16).replace(" ", "T") : iso.slice(0, 16));
    const start = wall(s), end = wall(e);
    const times = v ? applyDefaults(v.defaults, start.slice(0, 10), start.slice(11, 16), end.slice(11, 16)) : { start, end };
    return { id: `cal_${g.id}`, name: String(g.summary || "Calendar event").slice(0, 80), venueId: v ? v.id : null,
      loc: v ? { name: v.name, lat: v.lat, lon: v.lon } : { name: loc || "Venue not set", lat: null, lon: null }, tz,
      times, gust: v && v.defaults && v.defaults.gust ? v.defaults.gust : STD.gust, overrides: [],
      source: { kind: "calendar", calendarId: calendarId || null, eventId: g.id, etag: g.etag || null }, created: Date.now(), updated: Date.now() };
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
  const getVenue = (id) => venues().find((x) => x.id === id) || null;
  /* removing a venue keeps its events (they carry their own coordinates); they just lose the link to defaults */
  function removeVenue(id) { write(VN_KEY, venues().filter((x) => x.id !== id)); write(EV_KEY, events().map((e) => (e.venueId === id ? { ...e, venueId: null } : e))); }
  const last = () => read(LAST_KEY, null), setLast = (id) => write(LAST_KEY, id);
  /* the earlier single saved event becomes the first item in the list */
  function migrate() {
    const old = read(OLD_KEY, null); if (!old || !old.times) return;
    if (!events().length) { const rec = saveEvent({ ...old, id: null }); setLast(rec.id); }
    try { ls().removeItem(OLD_KEY); } catch (e) { /* ignore */ }
  }

  const api = { STD, STATUS, applyDefaults, offsetsOf, overridesOf, statusOf, order, fromCalendar, addMin, diffMin,
    events, venues, saveEvent, getEvent, removeEvent, saveVenue, getVenue, removeVenue, last, setLast, migrate, EV_KEY, VN_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
