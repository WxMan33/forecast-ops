/* Upcoming events and saved venues: defaults, overrides, status order, calendar mapping, storage (synthetic data). */
"use strict";
const assert = require("assert");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const mem = {}; global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const E = require("../assets/event-store.js");

/* defaults: setup 4 h and gates 90 min before the start, teardown 2 h after the end */
const tql = { setup: 240, gates: 90, teardown: 120, gust: 30 };
eq(E.applyDefaults(tql, "2026-11-28", "19:30", "21:30"), { start: "2026-11-28T19:30", end: "2026-11-28T21:30", setup: "2026-11-28T15:30", gates: "2026-11-28T18:00", teardown: "2026-11-28T23:30" }, "venue defaults fill setup, gates and teardown");
eq(E.applyDefaults(tql, "2026-11-28", "22:00", "00:30").teardown, "2026-11-29T02:30", "an end before the start is the next day; teardown follows it");
eq(E.applyDefaults({ ...tql, setup: 600 }, "2026-11-28", "07:00", "09:00").setup, "2026-11-27T21:00", "setup can start the evening before");
eq(E.offsetsOf({ setup: "2026-11-28T15:30", gates: "2026-11-28T18:00", start: "2026-11-28T19:30", end: "2026-11-28T21:30", teardown: "2026-11-28T23:30" }), { setup: 240, gates: 90, teardown: 120 }, "an event's schedule reads back as venue offsets");
const t2 = { ...E.applyDefaults(tql, "2026-12-05", "19:30", "21:30"), gates: "2026-12-05T17:30" };
eq(E.overridesOf(t2, tql), ["gates"], "a per-event gates time is an override; the rest follow the venue");
eq(E.overridesOf(E.applyDefaults(tql, "2026-12-05", "19:30", "21:30"), tql), [], "no overrides when the event uses the defaults");

/* status and order: weather concern first, the rest by start time, past separately */
const ev = (id, lat = 39.1) => ({ id, loc: { name: "TQL Stadium", lat, lon: -84.5 } });
const st = (o) => E.statusOf(ev("a"), o);
eq(st({ brief: { top: { label: "Rain", tier: "watch" } }, ready: { state: "ready" }, decision: "Rain likely during gates." }).key, "concern", "a hazard in covered hours is a weather concern");
eq(st({ brief: { top: null }, ready: { state: "ready" } }).text, "Forecast covers setup through teardown.", "covered and quiet: briefing ready");
eq(st({ brief: { top: null }, ready: { state: "partial", line: "Setup and gates covered · the event and teardown pending" }, readyAtText: "Sat, about 2 PM" }).text, "Setup and gates covered · the event and teardown pending · full briefing around Sat, about 2 PM", "partly covered says what is covered and when the rest is due");
eq(st({ readyAtText: "Nov 28" }).key, "waiting", "beyond the guidance: waiting");
eq(E.statusOf(ev("b", null), {}).key, "venue", "a calendar event without a recognised venue needs confirmation");
eq(st({ endMs: 1, now: 2 }).key, "past", "ended events are past");
const items = [
  { id: "late", startMs: 300, status: st({ brief: { top: null }, ready: { state: "ready" } }) },
  { id: "soon", startMs: 100, status: st({ readyAtText: "x" }) },
  { id: "rain", startMs: 200, status: st({ brief: { top: { label: "Rain" } }, ready: { state: "partial", line: "" } }) },
  { id: "old", startMs: 50, status: st({ endMs: 1, now: 2 }) },
];
const o = E.order(items);
eq([o.live.map((x) => x.id), o.past.map((x) => x.id)], [["rain", "soon", "late"], ["old"]], "needs a weather decision first, then by start time; past separately");

/* storage: two matches at one venue, defaults reused, one per-event override, both back after a reload */
const v = E.saveVenue({ name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5222, tz: "America/New_York", defaults: tql });
const a = E.saveEvent({ name: "Match 1", venueId: v.id, loc: { name: v.name, lat: v.lat, lon: v.lon }, tz: v.tz, times: E.applyDefaults(v.defaults, "2026-11-28", "19:30", "21:30"), gust: 30 });
const b = E.saveEvent({ name: "Match 2", venueId: v.id, loc: { name: v.name, lat: v.lat, lon: v.lon }, tz: v.tz, times: t2, gust: 30, overrides: E.overridesOf(t2, v.defaults) });
delete require.cache[require.resolve("../assets/event-store.js")]; const E2 = require("../assets/event-store.js");
eq(E2.events().map((x) => [x.name, x.times.gates, x.overrides]), [["Match 1", "2026-11-28T18:00", []], ["Match 2", "2026-12-05T17:30", ["gates"]]], "both events survive a reload with their own gates time");
ok(a.id !== b.id && /^ev_/.test(a.id) && E2.getEvent(b.id).source.kind === "manual", "events get their own ids and a source");
E2.saveEvent({ ...E2.getEvent(a.id), name: "Match 1 (moved)" }); eq(E2.events().length, 2, "editing keeps one record");
E2.removeVenue(v.id); eq([E2.venues().length, E2.events().every((x) => x.venueId === null && x.loc.lat === 39.1111)], [0, true], "removing a venue keeps its events and their coordinates");
E2.removeEvent(a.id); eq(E2.events().map((x) => x.name), ["Match 2"], "remove an event");
mem.beta_event_v1 = JSON.stringify({ id: "beta", name: "Old single event", loc: { name: "X", lat: 1, lon: 2 }, tz: "UTC", times: { start: "2026-12-01T10:00", end: "2026-12-01T12:00" } });
E2.removeEvent(b.id); E2.migrate(); eq([E2.events().map((x) => x.name), mem.beta_event_v1, E2.last() === E2.events()[0].id], [["Old single event"], undefined, true], "the earlier single saved event moves into the list");

/* calendar: the same record shape; venue matched by name, else needs confirmation */
const venues = [{ id: "vn_t", name: "TQL Stadium", lat: 39.1111, lon: -84.5222, tz: "America/New_York", defaults: tql }];
const g = E.fromCalendar({ id: "abc", etag: "e1", summary: "FC Cincinnati vs. Test FC", location: "TQL Stadium, 1501 Central Pkwy, Cincinnati, OH", start: { dateTime: "2026-11-28T19:30:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-11-28T21:30:00-05:00" } }, venues, "primary");
eq([g.venueId, g.times.gates, g.times.teardown, g.source], ["vn_t", "2026-11-28T18:00", "2026-11-28T23:30", { kind: "calendar", calendarId: "primary", eventId: "abc", etag: "e1" }], "a calendar event at a saved venue gets that venue's defaults");
const u = E.fromCalendar({ id: "x", summary: "Away match", location: "Somewhere Field", start: { dateTime: "2026-12-01T18:00:00-06:00", timeZone: "America/Chicago" }, end: { dateTime: "2026-12-01T20:00:00-06:00" } }, venues);
eq([u.loc.lat, E.statusOf(u, {}).key, u.times.start], [null, "venue", "2026-12-01T18:00"], "unknown location: venue needs confirmation, times kept in the event's zone");
eq(E.fromCalendar({ id: "d", summary: "Holiday", start: { date: "2026-12-25" }, end: { date: "2026-12-26" } }, venues), null, "all-day items are skipped");
console.log(`ok - ${n} event store checks passed`);
