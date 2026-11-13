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
eq([g.venueId, g.times.gates, g.times.teardown, (({ kind, calendarId, eventId, etag }) => ({ kind, calendarId, eventId, etag }))(g.source)], ["vn_t", "2026-11-28T18:00", "2026-11-28T23:30", { kind: "calendar", calendarId: "primary", eventId: "abc", etag: "e1" }], "a calendar event at a saved venue gets that venue's defaults");
const u = E.fromCalendar({ id: "x", summary: "Away match", location: "Somewhere Field", start: { dateTime: "2026-12-01T18:00:00-06:00", timeZone: "America/Chicago" }, end: { dateTime: "2026-12-01T20:00:00-06:00" } }, venues);
eq([u.loc.lat, E.statusOf(u, {}).key, u.times.start], [null, "venue", "2026-12-01T18:00"], "unknown location: venue needs confirmation, times kept in the event's zone");
eq(E.fromCalendar({ id: "d", summary: "Holiday", start: { date: "2026-12-25" }, end: { date: "2026-12-26" } }, venues), null, "all-day items are skipped");


/* ---------- venue matching, remembered locations, original instants (Bengals at Paycor regression) ---------- */
{
  for (const k of Object.keys(mem)) delete mem[k];
  delete require.cache[require.resolve("../assets/event-store.js")]; const S = require("../assets/event-store.js");
  /* the reported case: a Sunday 8:20 PM EST game the calendar returns in UTC with no event time zone */
  const sun = { id: "bengals", summary: "Bengals vs. Test", location: "Somewhere unfamiliar", start: { dateTime: "2026-11-16T01:20:00Z" }, end: { dateTime: "2026-11-16T04:30:00Z" } };
  const u = S.fromCalendar(sun, [], "c", "America/New_York");
  eq([u.tz, u.times.start, u.venueId], ["America/New_York", "2026-11-15T20:20", null], "unmatched event: times in the calendar's time zone (Sunday 8:20 PM), not the UTC clock");
  const noTz = S.fromCalendar(sun, [], "c", null);
  const fixed = S.confirmVenue(noTz, S.getVenue("bi_paycor"));
  eq([fixed.tz, fixed.times.start, fixed.times.end], ["America/New_York", "2026-11-15T20:20", "2026-11-15T23:30"], "confirming a venue converts the calendar's original instants (the bug relabelled 01:20 UTC as 1:20 AM EST)");
  ok(S.wallAt("2026-07-05T00:20:00Z", "America/New_York") === "2026-07-04T20:20", "daylight time handled (EDT)");
  /* matching: name, street address, built-ins, remembered aliases, ambiguous, unknown */
  const g = (id, location, iso = "2026-11-22T18:00:00Z") => ({ id, summary: id, location, start: { dateTime: iso }, end: { dateTime: "2026-11-22T21:00:00Z" } });
  eq([S.matchVenue("Paycor Stadium", []).status, S.matchVenue("Paycor Stadium", []).venue.id, S.matchVenue("Paycor Stadium", []).via], ["matched", "bi_paycor", "name"], "built-in venue by name");
  eq(S.matchVenue("1501 Central Parkway West, Cincinnati, OH 45214", []).venue.id, "bi_tql", "built-in venue by full street address (Parkway West = Pkwy W)");
  eq(S.matchVenue("Paul Brown Stadium, Cincinnati", []).venue.id, "bi_paycor", "built-in venue by a known alias");
  eq([S.matchVenue("", []).status, S.matchVenue("Somewhere Field, Dayton, OH", []).status], ["unknown", "unknown"], "blank or unfamiliar locations are unknown");
  eq(S.matchVenue("TQL Stadium / Paycor Stadium watch party", []).status, "ambiguous", "two venues in one location is ambiguous");
  ok(S.matchVenue("Stadium", []).status === "unknown", "a generic word does not match a venue");
  /* two separate imports at Paycor: neither needs confirmation once the venue is saved */
  let r1 = S.importEvents([S.fromCalendar(g("p1", "Paycor Stadium"), S.venues(), "c", "America/New_York")]);
  const pv = S.venues().find((v) => v.name === "Paycor Stadium");
  const r2 = S.importEvents([S.fromCalendar(g("p2", "Paycor Stadium, 1 Paycor Stadium, Cincinnati, OH 45202", "2026-11-29T18:00:00Z"), S.venues(), "c", "America/New_York")]);
  eq([r1.added, r2.added, !!pv, S.events().map((e) => [e.id, e.venueId, e.times.start])], [1, 1, true, [["cal_p1", "bi_paycor", "2026-11-22T13:00"], ["cal_p2", "bi_paycor", "2026-11-29T13:00"]]], "two Paycor imports (name, then full address) both match the saved venue; times at the venue");
  /* a location confirmed by hand is remembered */
  const odd = g("x1", "Riverfront Lot C, 120 Mehring Way");
  const r0 = S.fromCalendar(odd, S.venues(), "c", "America/New_York");
  eq(r0.match.status, "unknown", "an unfamiliar location asks once");
  S.rememberAlias(pv, odd.location);
  const again = S.fromCalendar(g("x2", "Riverfront Lot C, 120 Mehring Way"), S.venues(), "c", "America/New_York");
  eq([again.venueId, again.match.via], ["bi_paycor", "remembered"], "after a manual match, the same calendar location matches automatically");
  /* a calendar event that changes location is matched again, not kept at the old venue */
  const moved = S.fromCalendar({ ...g("p1", "TQL Stadium"), etag: "2" }, S.venues(), "c", "America/New_York");
  const mr = S.mergeImported(S.events(), [moved], S.getVenue), e1 = mr.list.find((e) => e.id === "cal_p1");
  eq([mr.relocated, e1.venueId, e1.loc.name], [1, "bi_tql", "TQL Stadium"], "a new calendar location is resolved again instead of silently keeping the old venue");
  const same = S.mergeImported(S.events(), [S.fromCalendar(g("p2", "Paycor Stadium, 1 Paycor Stadium, Cincinnati, OH 45202", "2026-11-29T18:00:00Z"), S.venues(), "c", "America/New_York")], S.getVenue);
  eq([same.relocated, same.unchanged], [0, 1], "same location: venue kept, nothing changes");
}
/* ---------- calendar import: merge, confirm venue, sample provider, origin gate ---------- */
{
  const CI = require("../assets/calendar-import.js");
  const tqlV = { id: "vn_t", name: "TQL Stadium", lat: 39.1111, lon: -84.5222, tz: "America/New_York", defaults: tql };
  const colV = { id: "vn_c", name: "Lower.com Field", lat: 39.968, lon: -83.017, tz: "America/New_York", defaults: { setup: 180, gates: 60, teardown: 90, gust: 25 } };
  const g1 = { id: "a1", etag: "1", summary: "Home match", location: "TQL Stadium, Cincinnati, OH", start: { dateTime: "2026-11-28T19:30:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-11-28T21:30:00-05:00" } };
  const g2 = { id: "a2", etag: "1", summary: "Away match", location: "Lower.com Field, Columbus, OH", start: { dateTime: "2026-12-05T19:30:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-12-05T21:30:00-05:00" } };
  let r = E.mergeImported([], [E.fromCalendar(g1, [tqlV], "c"), E.fromCalendar(g2, [tqlV], "c")], () => tqlV);
  eq([r.added, r.list.map((x) => [x.venueId, x.times.gates || "-"])], [2, [["vn_t", "2026-11-28T18:00"], [null, "-"]]], "import: saved venue matched with its defaults; unfamiliar location waits for a venue");
  const again = E.mergeImported(r.list, [E.fromCalendar(g1, [tqlV], "c"), E.fromCalendar(g2, [tqlV], "c")], () => tqlV);
  eq([again.added, again.updated, again.unchanged, again.list.length], [0, 0, 2, 2], "re-importing the same events changes nothing and adds no duplicates");
  /* planner moves gates to 2 h before for the home match; the calendar later moves kickoff to 8 PM */
  const own = r.list.map((x) => (x.id === "cal_a1" ? { ...x, times: { ...x.times, gates: "2026-11-28T17:30" }, overrides: ["gates"] } : x));
  const moved = { ...g1, etag: "2", start: { ...g1.start, dateTime: "2026-11-28T20:00:00-05:00" }, end: { dateTime: "2026-11-28T22:00:00-05:00" } };
  const m = E.mergeImported(own, [E.fromCalendar(moved, [tqlV], "c")], (id) => (id === "vn_t" ? tqlV : null)), h = m.list.find((x) => x.id === "cal_a1");
  eq([m.updated, h.times.start, h.times.gates, h.times.setup, h.overrides, h.source.etag], [1, "2026-11-28T20:00", "2026-11-28T18:00", "2026-11-28T16:00", ["gates"], "2"], "a calendar time change updates the event; the planner's gates override keeps its offset; other times follow the venue");
  const c = E.confirmVenue(r.list.find((x) => x.id === "cal_a2"), colV);
  eq([c.venueId, c.loc.lat, c.times.gates, E.statusOf(c, {}).key], ["vn_c", 39.968, "2026-12-05T18:30", "waiting"], "confirming an unfamiliar location applies that venue; the event can now be briefed");
  const kept = E.mergeImported([c], [E.fromCalendar({ ...g2, etag: "2", summary: "Away match (moved)" }, [tqlV], "c")], (id) => (id === "vn_c" ? colV : null)).list[0];
  eq([kept.venueId, kept.name, kept.times.gates], ["vn_c", "Away match (moved)", "2026-12-05T18:30"], "a confirmed venue survives re-import; the name follows the calendar");
  const sp = CI.sampleProvider(Date.UTC(2026, 10, 10, 12));
  const run = async () => { const cals = await sp.listCalendars(), evs = await sp.listEvents(cals[0].id, { timeMin: new Date(Date.UTC(2026, 10, 10, 12)).toISOString(), timeMax: new Date(Date.UTC(2026, 10, 10, 12) + 90 * 864e5).toISOString() });
    const recs = evs.map((x) => E.fromCalendar(x, [tqlV], "sample")).filter(Boolean);
    eq([cals.length, evs.length, recs.length, recs.filter((x) => x.venueId).length], [2, 5, 4, 3], "sample calendar: 5 items, the all-day one skipped, 3 at the saved venue");
    ok(/Sample FC/.test(recs[0].name) && recs[0].times.start.endsWith("T19:30"), "sample events keep the venue's local start time");
    console.log(`ok - ${n} event store checks passed`); };
  const loc = (origin) => ({ origin, hostname: new URL(origin).hostname });
  global.BETA_CALENDAR = { clientId: "x.apps.googleusercontent.com", origins: ["https://beta.example.org"] };
  eq([CI.googleAvailable(loc("https://beta.example.org")), CI.googleAvailable(loc("https://raw.githack.com")), CI.googleAvailable(loc("https://other.example.org"))], [true, false, false], "Google sign-in only on the configured beta origin, never on the preview host");
  global.BETA_CALENDAR = { clientId: "", origins: ["https://beta.example.org"] }; eq(CI.googleAvailable(loc("https://beta.example.org")), false, "no client ID: no Google sign-in");
  ok(CI.SCOPES.split(" ").sort().join(" ") === "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly", "only the two read-only scopes are requested");
  run().catch((e) => { console.error(e); process.exit(1); });
}
