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
eq([B.kind, B.version, B.exportedAt, B.counts], ["forecast-ops-event-backup", 2, "2026-11-11T12:00:00.000Z", { events: 2, venues: 1, aliases: 1, preferences: [] }], "export: versioned (workspace v2), dated, counted; no preference group when none is set here");
ok(!/token|secret|apiKey|access_token|pk\.[0-9a-f]{20,}|synthetic-browser-id|example\.org\/collect/i.test(text), "export: no tokens, API keys, analytics IDs or endpoints");
eq(Object.keys(B).sort(), ["app", "counts", "events", "exportedAt", "kind", "preferences", "venues", "version"], "export: only the documented top-level fields (preferences added in version 2)");
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
  [JSON.stringify({ ...B, version: 3 }), /newer Forecast Ops/], [JSON.stringify({ ...B, version: "1" }), /valid version/], [JSON.stringify({ ...B, events: null }), /missing its events/],
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

/* ---- workspace v2: preferences travel by group; importing them is opt-in; replace-all; all or nothing ---- */
{
  const J = (v) => JSON.stringify(v);
  const MODELS = { gfs_seamless: { on: true, w: 0.5 }, ecmwf_ifs025: { on: false, w: 1.25 } }, PROF = { near: MODELS, far: { gfs_seamless: { on: true, w: 1 } }, nearTemp: MODELS };
  const sender = { ops_blend_preset: J("custom"), ops_blend_models: J(MODELS), ops_blend_period_weights_v1: J(PROF), ops_blend_weight_scope: J("nearTemp"), ops_thunder_models: J(MODELS),
    ops_near48_default_v1: "true", ops_scoped_default_version: J("scoped-2026-11"), ops_blend_cfg_v: "3", ops_theme: J("dark"), forecast_ops_monitoring_address_v1: "https://ope.example.test" };
  const keep = { ...mem }; Object.assign(mem, sender);
  const W = E.backup(Date.parse("2026-11-20T15:00:00Z")), Wops = E.backup(Date.now(), { forecast: true, display: true, monitoring: true });
  eq(W.counts.preferences, ["forecast", "display"], "workspace: forecast preferences and theme travel by default");
  ok(!("monitoring" in W.preferences) && !/ope\.example/.test(JSON.stringify(W)), "workspace: the OPE monitoring address is left out by default");
  eq(Wops.preferences.monitoring, { forecast_ops_monitoring_address_v1: "https://ope.example.test" }, "workspace: the OPE address only when the exporter includes it");
  eq([W.preferences.forecast.ops_blend_preset, W.preferences.forecast.ops_blend_period_weights_v1.near, W.preferences.display.ops_theme], ["custom", MODELS, "dark"], "workspace: values as the sender stores them");
  ok(!/token|secret|apiKey|synthetic-browser-id/.test(JSON.stringify(W)), "workspace: still no tokens, keys or browser IDs");
  /* the recipient: a different browser with its own settings and one overlapping event */
  mem = { ops_theme: J("light"), ops_blend_preset: J("near48") };
  const R = E.readBackup(JSON.stringify(Wops)); ok(R.ok && R.version === 2 && Object.keys(R.preferences).join() === "forecast,display,monitoring", "v2 file reads, with its preference groups");
  let res = E.applyRestore(E.planRestore(R), { preferences: R.preferences });
  eq([res.events.add, res.preferences, JSON.parse(mem.ops_theme), JSON.parse(mem.ops_blend_preset), mem.ops_blend_models], [2, [], "light", "near48", undefined], "merge: records added; preferences untouched unless chosen");
  mem = { ops_theme: J("light"), ops_blend_preset: J("near48"), ops_blend_weight_scope: J("far") };
  res = E.applyRestore(E.planRestore(R), { preferences: R.preferences, prefs: { forecast: true } });
  eq([res.preferences, JSON.parse(mem.ops_blend_preset), JSON.parse(mem.ops_blend_weight_scope), JSON.parse(mem.ops_scoped_default_version), JSON.parse(mem.ops_theme), mem.forecast_ops_monitoring_address_v1],
    [["forecast"], "custom", "nearTemp", "scoped-2026-11", "light", undefined], "opt in to forecast only: recipe, weights and markers as the sender's; theme and OPE address unchanged");
  /* a v1 file still imports (no preferences); newer versions and bad preference values are refused whole */
  const V1 = { ...W, version: 1 }; delete V1.preferences; const r1 = E.readBackup(JSON.stringify(V1));
  eq([r1.ok, r1.version, r1.preferences], [true, 1, {}], "a version 1 backup still imports, with no preferences");
  eq(E.readBackup(JSON.stringify({ ...W, version: 3 })).ok, false, "a newer version is refused");
  const bad = E.readBackup(JSON.stringify({ ...W, preferences: { forecast: { ops_blend_models: { x: { on: "yes", w: 1 } } } } }));
  ok(!bad.ok && /Forecast preferences/.test(bad.errors.join(" ")), "a bad preference value refuses the whole file: " + bad.errors[0]);
  ok(E.readBackup(JSON.stringify({ ...W, preferences: { forecast: { unknown_key: 1 }, other: { x: 1 } } })).ok, "unknown preference keys and groups are ignored, not written");
  /* replace everything: the file's records take the place of what's here */
  mem = {}; E.saveEvent({ name: "Only here", loc: { name: "X", lat: 39, lon: -84 }, tz: NY, times: { start: "2026-12-20T19:00", end: "2026-12-20T21:00" } });
  const all = E.applyRestore(E.planRestore(R, { events: [], venues: [] }), { replaceAll: true, preferences: R.preferences });
  eq([E.events().length, E.events().some((e) => e.name === "Only here"), all.replaceAll], [2, false, true], "replace all: only the file's events remain");
  /* a refused write puts every key back, preferences included */
  mem = { ops_theme: J("light"), ops_blend_preset: J("near48") }; const before = JSON.stringify(mem); failWrites = true;
  assert.throws(() => E.applyRestore(E.planRestore(R), { preferences: R.preferences, prefs: { forecast: true, display: true } }), /nothing was changed/); n++;
  failWrites = false; eq(JSON.stringify(mem), before, "a refused write leaves events, venues and preferences exactly as they were");
  mem = keep;
}

console.log(`ok - ${n} backup and restore checks passed`);
