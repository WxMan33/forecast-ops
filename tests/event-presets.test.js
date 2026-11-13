/* Named schedule presets (Practice, Match day) on a saved venue: an event picks one, a per-event change stays that
   event's override, the saved preset never changes, re-import and backup keep both. Synthetic data only. */
"use strict";
const assert = require("assert");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const mem = {}; global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const E = require("../assets/event-store.js");
const NY = "America/New_York";
const v = E.saveVenue({ name: "Synthetic Field", lat: 39.2, lon: -84.4, tz: NY, defaults: { setup: 240, gates: 90, teardown: 120, gust: 25 },
  presets: [{ id: "ps_practice", name: "Practice", setup: 60, gates: null, teardown: 30 }, { id: "ps_match", name: "Match day", setup: 300, gates: 120, teardown: 150 }] });
const saved = JSON.stringify(E.getVenue(v.id).presets);

/* defaults and presets */
eq(E.defsFor(v, null), { setup: 240, gates: 90, teardown: 120, gust: 25 }, "no preset: the venue's standard (outdoor event) schedule");
eq(E.defsFor(v, "ps_practice"), { setup: 60, gates: null, teardown: 30, gust: 25 }, "Practice preset: its own offsets, no gates, the venue's gust limit");
eq(E.defsFor(v, "ps_gone"), E.defsFor(v, null), "an unknown preset falls back to the standard schedule");
const pr = E.schedule(E.defsFor(v, "ps_practice"), { start: "2026-12-05T17:00", end: "2026-12-05T19:00", tz: NY }).times;
eq(pr, { start: "2026-12-05T17:00", end: "2026-12-05T19:00", setup: "2026-12-05T16:00", teardown: "2026-12-05T19:30" }, "Practice: setup 1 h before, no gates, teardown 30 min after");
const md = E.schedule(E.defsFor(v, "ps_match"), { start: "2026-12-06T19:30", end: "2026-12-06T21:30", tz: NY }).times;
eq([md.setup, md.gates, md.teardown], ["2026-12-06T14:30", "2026-12-06T17:30", "2026-12-07T00:00"], "Match day: its own setup, gates and teardown (teardown past midnight)");

/* one event overrides its preset; the preset stays as saved */
const ev = E.saveEvent({ name: "Synthetic practice", venueId: v.id, preset: "ps_practice", loc: { name: v.name, lat: v.lat, lon: v.lon }, tz: NY, times: { ...pr, teardown: "2026-12-05T20:00" }, gust: 25 });
const ov = E.overridesOf(E.getEvent(ev.id).times, E.defsFor(E.getVenue(v.id), "ps_practice"), NY);
E.saveEvent({ ...E.getEvent(ev.id), overrides: ov });
eq(ov, ["teardown"], "a later teardown for this practice only is that event's override");
eq(JSON.stringify(E.getVenue(v.id).presets), saved, "the saved Practice preset is unchanged");
eq(E.overridesOf(pr, E.defsFor(v, "ps_practice"), NY), [], "an event using the preset as-is has no overrides");
eq(E.overridesOf(pr, E.defsFor(v, null), NY).sort(), ["gates", "setup", "teardown"], "against the standard schedule the same times would all differ (presets are not guessed from times)");

/* a calendar event imported at the venue, switched to Match day, then the calendar moves kickoff */
const g = (s, e) => ({ id: "m1", summary: "Synthetic match", location: "Synthetic Field", start: { dateTime: s }, end: { dateTime: e } });
E.importEvents([E.fromCalendar(g("2026-12-13T00:30:00Z", "2026-12-13T02:30:00Z"), E.venues(), "cal", NY)]);
let m = E.events().find((x) => x.source && x.source.eventId === "m1");
eq([m.preset, m.times.setup], [undefined, "2026-12-12T15:30"], "imported: the venue's standard schedule (no preset guessed from the name)");
const mt = E.schedule(E.defsFor(v, "ps_match"), { start: m.times.start, end: m.times.end, tz: NY }).times;
E.saveEvent({ ...m, preset: "ps_match", times: { ...mt, gates: "2026-12-12T18:00" }, overrides: ["gates"] }); // match day, gates 1:30 before for this one
E.importEvents([E.fromCalendar(g("2026-12-13T01:00:00Z", "2026-12-13T03:00:00Z"), E.venues(), "cal", NY)]); // kickoff 30 min later
m = E.events().find((x) => x.source && x.source.eventId === "m1");
eq([m.preset, m.times.start, m.times.setup, m.times.gates, m.times.teardown], ["ps_match", "2026-12-12T20:00", "2026-12-12T15:00", "2026-12-12T18:30", "2026-12-13T00:30"],
  "re-import keeps the Match day preset (setup 5 h, teardown 2.5 h) and this event's own gates offset");
eq(JSON.stringify(E.getVenue(v.id).presets), saved, "re-import never changes the saved presets");
/* the event moves to a different venue: the old venue's preset no longer applies */
const other = E.saveVenue({ name: "Synthetic Hall", lat: 39.1, lon: -84.5, tz: NY, defaults: { setup: 120, gates: 30, teardown: 60, gust: 25 } });
const moved = E.confirmVenue(m, other);
eq([moved.preset, moved.times.setup], [null, "2026-12-12T18:00"], "confirming another venue drops the old venue's preset and uses the new venue's standard schedule");

/* backup keeps presets and the event's preset; a damaged preset is refused */
const B = E.backup();
const R = E.readBackup(JSON.stringify(B));
ok(R.ok, "backup with presets validates");
eq(R.venues.find((x) => x.id === v.id).presets, E.getVenue(v.id).presets, "backup keeps the venue's presets exactly");
eq(R.events.find((x) => x.id === ev.id).preset, "ps_practice", "backup keeps the event's preset");
const bad = E.readBackup(JSON.stringify({ ...B, venues: B.venues.map((x) => (x.id === v.id ? { ...x, presets: [{ id: "p", name: "", setup: 30 }] } : x)) }));
ok(!bad.ok && bad.errors.some((e) => /preset/.test(e)), "a preset without a name is refused before anything is written");
console.log(`ok - ${n} schedule preset checks passed`);
