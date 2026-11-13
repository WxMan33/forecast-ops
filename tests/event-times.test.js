/* Calendar events of any length in the venue's time zone: multi-day, overnight and across clock changes, through
   import, venue confirmation, re-import, editing and a reload. Synthetic events and venues only. */
"use strict";
const assert = require("assert");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const mem = {}; global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const E = require("../assets/event-store.js");
const C = require("../assets/ops-core.js");
const NY = "America/New_York", DEN = "America/Denver";
const venue = E.saveVenue({ name: "Synthetic Fairgrounds", city: "Testville, OH", address: "100 Example Rd, Testville, OH", lat: 39.2, lon: -84.4, tz: NY, defaults: { setup: 240, gates: 90, teardown: 120, gust: 25 } });
const g = (id, s, e, extra = {}) => ({ id, summary: "Synthetic " + id, location: "Synthetic Fairgrounds", start: { dateTime: s }, end: { dateTime: e }, ...extra });
const real = (ev, k) => E.msOf(ev, k); // instant a phase stands for
const H = 3600e3;
const valid = (ev, m) => eq(C.event.validate(ev), [], m + ": the event validates");

/* 1. more than 24 hours: a three-day festival keeps its real end date; teardown follows the end, setup/gates the start */
const fest = E.fromCalendar(g("fest", "2026-11-20T14:00:00Z", "2026-11-22T23:00:00Z"), E.venues(), "cal-a", NY);
eq(fest.times, { start: "2026-11-20T09:00", end: "2026-11-22T18:00", setup: "2026-11-20T05:00", gates: "2026-11-20T07:30", teardown: "2026-11-22T20:00" }, "3-day event: end on its own date, phases from start and end");
eq([real(fest, "start"), real(fest, "end")], [Date.parse("2026-11-20T14:00:00Z"), Date.parse("2026-11-22T23:00:00Z")], "3-day event: local times stand for the calendar's own instants");
valid(fest, "3-day event");
eq(E.overridesOf(fest.times, venue.defaults, NY, fest.fold), [], "3-day event: an imported schedule is not mistaken for per-event overrides");

/* 2. overnight: 10 PM to 4 AM ends the next morning */
const night = E.fromCalendar(g("night", "2026-11-20T03:00:00Z", "2026-11-20T09:00:00Z"), E.venues(), "cal-a", NY);
eq([night.times.start, night.times.end, night.times.teardown], ["2026-11-19T22:00", "2026-11-20T04:00", "2026-11-20T06:00"], "overnight: ends and tears down the next morning");
valid(night, "overnight");

/* 3. fall back (Nov 1 2026, 2 AM EDT -> 1 AM EST): ends at the second 1:30 AM; offsets are real elapsed time */
const fb = E.fromCalendar(g("fallback", "2026-11-01T02:00:00Z", "2026-11-01T06:30:00Z"), E.venues(), "cal-a", NY);
eq([fb.times.start, fb.times.end, fb.fold], ["2026-10-31T22:00", "2026-11-01T01:30", { end: 1 }], "fall back: 1:30 AM is the second one (EST), recorded as such");
valid(fb, "fall back");
eq(real(fb, "end") - real(fb, "start"), 4.5 * H, "fall back: the event lasts its real 4.5 hours");
eq((real(fb, "teardown") - real(fb, "end")) / 60e3, 120, "fall back: teardown is 2 real hours after the end");
const W = Object.fromEntries(C.event.windows(fb).map((w) => [w.key, w]));
eq([W.event.hours, W.teardown.hours, W.all.hours], [4.5, 2, 10.5], "fall back: the briefing windows cover the real event, teardown and whole-event hours");
/* setup across the change: an event starting at 3 AM EST on fall-back day, setup 4 real hours before = 12:00 AM EDT */
const early = E.fromCalendar(g("early", "2026-11-01T08:00:00Z", "2026-11-01T10:00:00Z"), E.venues(), "cal-a", NY);
eq([early.times.start, early.times.setup, early.times.gates], ["2026-11-01T03:00", "2026-11-01T00:00", "2026-11-01T01:30"], "fall back: setup and gates are real minutes before the start");
eq([(real(early, "start") - real(early, "setup")) / 60e3, (real(early, "start") - real(early, "gates")) / 60e3, early.fold], [240, 90, { gates: 1 }], "fall back: 4 h / 90 min before; gates at the second 1:30 AM");
valid(early, "fall back setup");

/* 4. spring forward (Mar 14 2027, 2 AM EST -> 3 AM EDT): no phase lands in the skipped hour */
const sf = E.fromCalendar(g("spring", "2027-03-14T08:00:00Z", "2027-03-14T11:00:00Z"), E.venues(), "cal-a", NY);
eq([sf.times.setup, sf.times.gates, sf.times.start], ["2027-03-13T23:00", "2027-03-14T01:30", "2027-03-14T04:00"], "spring forward: offsets are real minutes; none in the skipped 2 AM hour");
valid(sf, "spring forward");

/* 5. single-day events keep working, exactly as before */
const day = E.fromCalendar(g("day", "2026-11-28T00:30:00Z", "2026-11-28T02:30:00Z"), E.venues(), "cal-a", NY);
eq(day.times, E.applyDefaults(venue.defaults, "2026-11-27", "19:30", "21:30"), "single-day: same schedule as the date-and-times form");
eq(day.fold, {}, "single-day: no fold");

/* 6. venue confirmation: unknown location, then confirmed at a venue in another zone; real dates from the instants */
const loose = E.fromCalendar({ ...g("loose", "2026-11-20T14:00:00Z", "2026-11-22T23:00:00Z"), location: "Somewhere new" }, E.venues(), "cal-a", NY);
eq([loose.venueId, loose.times.start, loose.times.end], [null, "2026-11-20T09:00", "2026-11-22T18:00"], "unknown venue: start and end keep their real dates");
const den = E.saveVenue({ name: "Synthetic Mesa Grounds", lat: 39.7, lon: -105, tz: DEN, defaults: { setup: 180, gates: 60, teardown: 90, gust: 25 } });
const conf = E.confirmVenue(loose, den);
eq(conf.times, { start: "2026-11-20T07:00", end: "2026-11-22T16:00", setup: "2026-11-20T04:00", gates: "2026-11-20T06:00", teardown: "2026-11-22T17:30" }, "confirmed in Denver: multi-day dates in the venue's zone, phases from start/end");
valid(conf, "confirmed");

/* 7. import, a per-event change, re-import with a moved end (and a moved start), refresh */
let r = E.importEvents([fest]); eq([r.added, E.events().length], [1, 1], "import adds the festival");
const savedId = E.events()[0].id;
const edited = { ...E.events()[0], times: { ...E.events()[0].times, gates: "2026-11-20T06:00", teardown: "2026-11-22T21:00" } };
edited.overrides = E.overridesOf(edited.times, venue.defaults, NY, edited.fold);
eq(edited.overrides, ["gates", "teardown"], "edit: changed gates and teardown are per-event overrides");
E.saveEvent(edited);
/* the calendar extends the festival by a day and starts an hour later */
const moved = E.fromCalendar(g("fest", "2026-11-20T15:00:00Z", "2026-11-23T23:00:00Z"), E.venues(), "cal-a", NY);
r = E.importEvents([moved]); eq([r.added, r.updated, E.events().length], [0, 1, 1], "re-import updates in place, no duplicate");
let after = E.events()[0];
eq(after.id, savedId, "re-import keeps the saved link (same id)");
eq([after.times.start, after.times.end], ["2026-11-20T10:00", "2026-11-23T18:00"], "re-import: new real start and end dates");
eq([after.times.gates, after.times.teardown, after.times.setup], ["2026-11-20T07:00", "2026-11-23T21:00", "2026-11-20T06:00"], "re-import: custom gates stay 4 h before the start, custom teardown 3 h after the end, setup follows the default");
/* the same calendar data again changes nothing */
r = E.importEvents([moved]); eq([r.added, r.updated, r.unchanged], [0, 0, 1], "re-importing the same data changes nothing");
/* a reload (fresh module, same storage) shows the same event */
delete require.cache[require.resolve("../assets/event-store.js")]; const E2 = require("../assets/event-store.js");
eq(E2.events()[0], after, "refresh: the multi-day event comes back exactly");
eq(E2.getEvent(savedId).times.end, "2026-11-23T18:00", "refresh: the saved link opens the multi-day event");

/* 8. re-import across fall back keeps the fold and the real offsets */
E.importEvents([fb]); const fbSaved = E.events().find((x) => x.source.eventId === "fallback");
E.saveEvent({ ...fbSaved, times: { ...fbSaved.times, teardown: "2026-11-01T02:30" }, overrides: ["teardown"] });
const fbMoved = E.fromCalendar(g("fallback", "2026-11-01T02:00:00Z", "2026-11-01T05:30:00Z"), E.venues(), "cal-a", NY); // now ends at the first 1:30 (EDT)
E.importEvents([fbMoved]); const fb2 = E.events().find((x) => x.source.eventId === "fallback");
eq([fb2.times.end, fb2.fold.end], ["2026-11-01T01:30", 0], "fall back re-import: the end is now the first 1:30 AM");
eq((E.msOf(fb2, "teardown") - E.msOf(fb2, "end")) / 60e3, 60, "fall back re-import: custom teardown keeps its real 1 h after the end");
valid(fb2, "fall back re-import");

/* 9. a calendar event at a place that isn't a saved venue keeps its own phase times when the calendar moves it */
const own = E.fromCalendar({ ...g("own", "2026-12-05T15:00:00Z", "2026-12-05T18:00:00Z"), location: "Synthetic Park" }, E.venues(), "cal-b", NY);
E.importEvents([own]); const o1 = E.events().find((x) => x.source.eventId === "own");
E.saveEvent({ ...o1, loc: { name: "Synthetic Park", lat: 39.3, lon: -84.3 }, times: { ...o1.times, setup: "2026-12-05T08:00", teardown: "2026-12-05T15:00" } });
E.importEvents([E.fromCalendar({ ...g("own", "2026-12-06T15:00:00Z", "2026-12-06T18:00:00Z"), location: "Synthetic Park" }, E.venues(), "cal-b", NY)]);
const o2 = E.events().find((x) => x.source.eventId === "own");
eq([o2.times.start, o2.times.setup, o2.times.teardown], ["2026-12-06T10:00", "2026-12-06T08:00", "2026-12-06T15:00"], "custom place: setup and teardown move with the event");

console.log(`ok - ${n} event time checks passed`);
