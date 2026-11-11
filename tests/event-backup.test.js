/* Backup and restore of saved events and venues: versioned, credential-free, validated before anything is written,
   merged without silently overwriting. Synthetic records only. */
"use strict";
const assert = require("assert");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
let mem = {}, failWrites = false, blocked = false;
global.localStorage = {
  getItem: (k) => { if (blocked) throw new Error("SecurityError"); return k in mem ? mem[k] : null; },
  setItem: (k, v) => { if (blocked) throw new Error("SecurityError"); if (failWrites && k !== "beta_storage_probe") { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};
const E = require("../assets/event-store.js");
const NY = "America/New_York";

/* a planner's browser: a venue with its own defaults and a remembered alias, a manual event with an override,
   a multi-day calendar event, plus unrelated storage (a sign-in token and analytics IDs) that must never be exported */
const vn = E.saveVenue({ name: "Synthetic Field", city: "Testville, OH", address: "200 Example Ave, Testville, OH", lat: 39.25, lon: -84.45, tz: NY, aliases: ["Synthetic Field, Main Gate"], defaults: { setup: 300, gates: 75, teardown: 150, gust: 28 } });
const t1 = E.schedule(vn.defaults, { start: "2026-12-05T19:00", end: "2026-12-05T21:00", tz: NY }).times;
const manual = E.saveEvent({ name: "Synthetic Match", venueId: vn.id, loc: { name: vn.name, lat: vn.lat, lon: vn.lon }, tz: NY, times: { ...t1, gates: "2026-12-05T17:00" }, gust: 28, overrides: ["gates"] });
E.importEvents([E.fromCalendar({ id: "multi", summary: "Synthetic Fair", location: "Synthetic Field, Main Gate", start: { dateTime: "2026-12-10T14:00:00Z" }, end: { dateTime: "2026-12-12T23:00:00Z" } }, E.venues(), "cal-synthetic", NY)]);
mem.fo_bid = "synthetic-browser-id"; mem.ops_token = "synthetic-secret-token"; mem.fo_analytics_endpoint_test = "https://example.org/collect";
/* an extra field sneaking onto a stored record must not ride along either */
mem[E.EV_KEY] = JSON.stringify(JSON.parse(mem[E.EV_KEY]).map((e, i) => (i === 0 ? { ...e, access_token: "synthetic-access-token", apiKey: "pk.0123456789abcdef0123456789abcdef" } : e)));
const savedEvents = E.events().map((e) => { const { access_token, apiKey, ...rest } = e; return rest; }), savedVenues = E.venues();

/* ---- export ---- */
const B = E.backup(Date.parse("2026-11-11T12:00:00Z"));
const text = JSON.stringify(B);
eq([B.kind, B.version, B.exportedAt, B.counts], ["forecast-ops-event-backup", 1, "2026-11-11T12:00:00.000Z", { events: 2, venues: 1, aliases: 1 }], "export: versioned, dated, counted");
ok(!/token|secret|apiKey|access_token|pk\.[0-9a-f]{20,}|synthetic-browser-id|example\.org\/collect/i.test(text), "export: no tokens, API keys, analytics IDs or endpoints");
eq(Object.keys(B).sort(), ["app", "counts", "events", "exportedAt", "kind", "venues", "version"], "export: only the documented top-level fields");
const fair = B.events.find((e) => e.source.eventId === "multi");
eq([fair.times.end, fair.source.start, fair.source.end, fair.source.calendarId], ["2026-12-12T18:00", "2026-12-10T14:00:00Z", "2026-12-12T23:00:00Z", "cal-synthetic"], "export: multi-day times and the calendar's instants and IDs are kept");
eq(B.venues[0].defaults, { setup: 300, gates: 75, teardown: 150, gust: 28 }, "export: venue defaults");
eq(B.venues[0].aliases, ["Synthetic Field, Main Gate"], "export: remembered alias");

/* ---- round trip into an empty browser ---- */
const keep = { ...mem }; mem = {};
let R = E.readBackup(text); ok(R.ok, "restore: the exported file validates");
let P = E.planRestore(R); eq(P.summary, { events: { add: 2, same: 0, conflict: 0 }, venues: { add: 1, same: 0, conflict: 0, aliases: 0 } }, "restore into an empty browser: everything is new");
E.applyRestore(P);
eq(E.venues(), savedVenues, "round trip: venues come back exactly (defaults and aliases)");
eq(E.events(), savedEvents, "round trip: events come back exactly (overrides, multi-day times, sources, ids)");
eq(E.getEvent(manual.id).overrides, ["gates"], "round trip: the event override survives");
eq(E.overridesOf(E.getEvent(manual.id).times, E.getVenue(vn.id).defaults, NY), ["gates"], "round trip: the override still reads as an override against the restored venue defaults");
ok(!("ops_token" in mem) && !("fo_bid" in mem), "restore writes only events and venues");
/* re-import after restore: matched by calendar and event id, not duplicated, alias still recognised */
const again = E.importEvents([E.fromCalendar({ id: "multi", summary: "Synthetic Fair", location: "Synthetic Field, Main Gate", start: { dateTime: "2026-12-10T14:00:00Z" }, end: { dateTime: "2026-12-12T23:00:00Z" } }, E.venues(), "cal-synthetic", NY)]);
eq([again.added, again.unchanged, E.events().length], [0, 1, 2], "after restore: a calendar re-import matches the restored event (no duplicate)");

/* ---- restoring the same file again: duplicates are skipped ---- */
P = E.planRestore(E.readBackup(text)); eq(P.summary, { events: { add: 0, same: 2, conflict: 0 }, venues: { add: 0, same: 1, conflict: 0, aliases: 0 } }, "same backup twice: nothing new, nothing duplicated");
E.applyRestore(P); eq(E.events().length, 2, "same backup twice: still two events");

/* ---- conflicts: never silently overwritten ---- */
E.saveEvent({ ...E.getEvent(manual.id), name: "Synthetic Match (moved)", times: { ...E.getEvent(manual.id).times, gates: "2026-12-05T16:30" } });
E.saveVenue({ ...E.getVenue(vn.id), defaults: { ...E.getVenue(vn.id).defaults, gates: 60 }, aliases: ["Synthetic Field West Lot"] });
const newVenue = { id: "vn_synthetic_new", name: "Synthetic Hall", city: "Example City, KY", address: "", lat: 38.9, lon: -84.6, tz: NY, aliases: [], defaults: { setup: 120, gates: 60, teardown: 60, gust: 25 } };
const file2 = JSON.stringify({ ...B, venues: [...B.venues, newVenue] });
P = E.planRestore(E.readBackup(file2));
eq(P.summary, { events: { add: 0, same: 1, conflict: 1 }, venues: { add: 1, same: 0, conflict: 1, aliases: 0 } }, "differences are reported as conflicts");
let res = E.applyRestore(P); // default: keep mine
eq([E.getEvent(manual.id).name, E.getEvent(manual.id).times.gates, E.getVenue(vn.id).defaults.gates], ["Synthetic Match (moved)", "2026-12-05T16:30", 60], "default restore keeps the records changed here");
eq(E.getVenue(vn.id).aliases.sort(), ["Synthetic Field West Lot", "Synthetic Field, Main Gate"], "remembered aliases from both are kept");
ok(E.getVenue("vn_synthetic_new"), "new venue from the backup is added");
eq(res.replaced, 0, "nothing replaced unless asked");
P = E.planRestore(E.readBackup(file2)); res = E.applyRestore(P, { replace: true });
eq([E.getEvent(manual.id).name, E.getEvent(manual.id).times.gates, E.getVenue(vn.id).defaults.gates, res.replaced], ["Synthetic Match", "2026-12-05T17:00", 75, 2], "replace: the backup's versions, only when chosen");
eq(E.getVenue(vn.id).aliases.sort(), ["Synthetic Field West Lot", "Synthetic Field, Main Gate"], "replace keeps aliases from both");

/* ---- an id clash with a different event gets its own id; a same-name venue elsewhere stays separate ---- */
const clash = { ...B.events[0], id: manual.id, source: { kind: "calendar", calendarId: "cal-other", eventId: "x1", etag: null, start: "2026-12-20T00:00:00Z", end: "2026-12-20T02:00:00Z", location: "", calTz: NY }, name: "Synthetic Other" };
P = E.planRestore(E.readBackup(JSON.stringify({ ...B, events: [clash], venues: [] })));
eq([P.summary.events.add, P.events[0].rec.id], [1, `${manual.id}_r1`], "a different event with a clashing id is added under a new id");

/* ---- malformed files: refused before anything is written ---- */
const snap = JSON.stringify(mem);
const bad = [
  ["{not json", /valid JSON/], [JSON.stringify([1, 2]), /isn't a Forecast Ops backup/], [JSON.stringify({ kind: "other", version: 1, events: [], venues: [] }), /isn't a Forecast Ops event backup/],
  [JSON.stringify({ ...B, version: 2 }), /newer Forecast Ops/], [JSON.stringify({ ...B, version: "1" }), /valid version/], [JSON.stringify({ ...B, events: null }), /missing its events/],
  [JSON.stringify({ ...B, events: [{ ...B.events[0], times: { start: "2026-12-05 19:00", end: "2026-12-05T21:00" } }] }), /valid date and time/],
  [JSON.stringify({ ...B, events: [{ ...B.events[0], times: { start: "2026-12-05T21:00", end: "2026-12-05T19:00" }, source: { kind: "manual" } }] }), /ends before it starts/],
  [JSON.stringify({ ...B, venues: [{ ...B.venues[0], lat: 120 }] }), /valid coordinates/], [JSON.stringify({ ...B, venues: [{ ...B.venues[0], tz: "Mars/Olympus" }] }), /valid time zone/],
  [JSON.stringify({ ...B, events: [B.events[0], B.events[0]] }), /repeats the id/], [JSON.stringify({ ...B, events: [{ ...fair, source: { ...fair.source, eventId: null } }] }), /without its calendar and event IDs/],
];
bad.forEach(([f, re]) => { const r = E.readBackup(f); ok(!r.ok && r.errors.some((e) => re.test(e)), `malformed file refused: ${re}`); });
eq(JSON.stringify(mem), snap, "malformed files change nothing");

/* ---- storage failures are raised, and leave the saved lists as they were ---- */
failWrites = true;
assert.throws(() => E.applyRestore(E.planRestore(E.readBackup(JSON.stringify({ ...B, events: [{ ...B.events[0], id: "ev_synthetic_extra", source: { kind: "manual" } }] })))), /ran out of storage space/); n++;
failWrites = false; eq(JSON.stringify(mem), snap, "a failed write leaves events and venues unchanged");
blocked = true; assert.throws(() => E.applyRestore(P), /isn't letting the page save/); n++; ok(E.storageOk() === false, "blocked storage is detected"); blocked = false;

console.log(`ok - ${n} backup and restore checks passed`);
