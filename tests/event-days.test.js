"use strict";
/* Multi-day events, one day at a time (EventDays). Weather here is SYNTHETIC (invented hourly values for a test venue),
   run through the real engines: Core.event, BetaStory, HourlyViews. Not a forecast. */
const assert = require("node:assert/strict");
const C = require("../assets/ops-core.js"), S = require("../assets/beta-story.js"), T = require("../assets/model-trends.js");
const M = require("../assets/hourly-model.js"), HV = require("../assets/hourly-views.js"), L = require("../assets/event-lead.js");
const U = require("../assets/event-briefing-ui.js"), E = require("../assets/event-store.js"), D = require("../assets/event-daylight.js"), A = require("../assets/almanac-core.js");
let n = 0; const check = (name, f) => { f(); n++; console.log("PASS " + name); };
const H = 3600e3, tz = "America/New_York", day = "2026-12-05", loc = { name: "Test garden (synthetic)", lat: 39.1, lon: -84.5 };
const at = (hhmm, d = day) => C.time.toUtc(`${d}T${hhmm}`, tz);

const DY = require("../assets/event-days.js");
/* synthetic guidance: dry until 1 PM, then 0.05″ and 60% every hour through 11 PM (the 3 PM hour included) */
function data(now = at("06:00"), wetAt = (hr) => hr >= 13) {
  const t0 = at("00:00"), ms = Array.from({ length: 48 }, (_, i) => t0 + i * H), h = {};
  ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "snowfall"].forEach((k) => (h[k] = []));
  ms.forEach((m) => { const hr = +C.time.toLocal(m, tz).slice(11, 13), d = C.time.toLocal(m, tz).slice(0, 10), wet = d === day && wetAt(hr);
    const v = { temperature_2m: 52, apparent_temperature: 50, precipitation_probability: wet ? 60 : 5, precipitation: wet ? 0.05 : 0, wind_speed_10m: 6, wind_gusts_10m: 12, snowfall: 0 };
    Object.keys(h).forEach((k) => h[k].push(v[k])); });
  const ids = ["gfs_seamless", "ecmwf_ifs025", "ncep_nbm_conus"], models = Object.fromEntries(ids.map((id) => [id, { h, d: {} }]));
  const B = { ms, times: ms.map((m) => C.time.toLocal(m, tz)), tz, models, viewedAt: now };
  const ctx = S.context({ C, T, B, ws: Object.fromEntries(ids.map((id) => [id, 1])), rules: null, nws: null, now });
  ctx.th = { at: () => "normal", perModel: () => null, ids: [] };
  return ctx;
}
const H2 = 3600e3;
/* a weekend festival: Saturday evening, all of Sunday, Monday afternoon. The guidance (48 hours from Saturday 00:00) ends
   Monday 00:00, so Monday has none yet. Rain from 1 PM Saturday onward (the harness's wet hours). */
const D2 = "2026-12-06", D3 = "2026-12-07";
const fest = { id: "ev_fest", name: "Riverside weekend festival", loc, tz, times: { start: `${day}T17:00`, end: `${D3}T18:00` },
  slots: [{ id: "f", name: "Friday-night set", start: `${day}T17:00`, end: `${day}T23:00` }, { id: "s", name: "Main day", start: `${D2}T10:00`, end: `${D2}T23:00`, main: true }, { id: "m", name: "Closing", start: `${D3}T12:00`, end: `${D3}T18:00` }] };
const legacy = { id: "ev_fair", name: "Three-day fair", loc, tz, times: { setup: `${day}T08:00`, start: `${day}T10:00`, end: `${D3}T18:00`, teardown: `${D3}T20:00` } };
const night = { id: "ev_n", name: "Night market", loc, tz, times: { start: `${day}T21:00`, end: `${D2}T03:00` }, slots: [{ id: "n", name: "Night market", start: `${day}T21:00`, end: `${D2}T03:00` }] };

check("days: each local date with scheduled time, in order; overnight downtime belongs to no day", () => {
  const d = DY.days(C, fest);
  assert.deepEqual(d.map((x) => [x.date, x.label, x.pieces.map((p) => p.name).join("|")]), [[day, "Sat, Dec 5", "Friday-night set"], [D2, "Sun, Dec 6", "Main day"], [D3, "Mon, Dec 7", "Closing"]]);
  assert.equal(DY.isMultiDay(C, fest), true);
  assert.equal(d[0].endMs, at("23:00")); assert.equal(d[1].startMs, at("10:00", D2), "Sunday starts at 10 AM: 11 PM to 10 AM is downtime");
});
check("a slot of 24 hours or less stays whole on the day it starts: 9 PM to 3 AM is one day", () => {
  assert.equal(DY.isMultiDay(C, night), false); assert.equal(DY.days(C, night)[0].pieces[0].e, at("03:00", D2));
});
check("an overnight show is one day: a teardown that starts after midnight stays with the evening it follows", () => {
  const late = { id: "ev_late", name: "Late show", loc, tz, times: { setup: `${day}T18:00`, gates: `${day}T20:00`, start: `${day}T21:00`, end: `${D2}T00:30`, teardown: `${D2}T02:00` } };
  const d = DY.days(C, late); assert.equal(d.length, 1); assert.equal(d[0].date, day); assert.deepEqual(d[0].pieces.map((p) => p.name), ["Setup", "Gates", "Event", "Teardown"]);
  assert.equal(DY.isMultiDay(C, late), false);
  const after = { ...late, times: { ...late.times, end: `${D2}T00:00`, teardown: `${D2}T01:30` } }; // teardown starting exactly at midnight
  assert.equal(DY.days(C, after).length, 1);
});
check("two sessions on one date share that day; the next date after a night off is a new day", () => {
  const two = { id: "ev_2", name: "Two sessions", loc, tz, times: { start: `${day}T09:00`, end: `${D2}T12:00` },
    slots: [{ id: "a", name: "Morning", start: `${day}T09:00`, end: `${day}T11:00` }, { id: "b", name: "Evening", start: `${day}T19:00`, end: `${day}T22:00` }, { id: "c", name: "Next morning", start: `${D2}T09:00`, end: `${D2}T12:00` }] };
  assert.deepEqual(DY.days(C, two).map((x) => [x.date, x.pieces.map((p) => p.name).join("|")]), [[day, "Morning|Evening"], [D2, "Next morning"]]);
});
check("an older stadium-style schedule over three days is split at local midnight, names kept", () => {
  const d = DY.days(C, legacy);
  assert.deepEqual(d.map((x) => [x.date, x.pieces.map((p) => `${p.name} ${C.time.toLocal(p.s, tz).slice(11)}-${C.time.toLocal(p.e, tz).slice(11)}`).join(", ")]),
    [[day, "Setup 08:00-10:00, Event 10:00-00:00"], [D2, "Event 00:00-00:00"], [D3, "Event 00:00-18:00, Teardown 18:00-20:00"]]);
});
check("default day: the next scheduled day; the current day while it runs; the last day once all have passed", () => {
  const d = DY.days(C, fest);
  assert.equal(DY.defaultDay(d, at("06:00")), day); assert.equal(DY.defaultDay(d, at("23:30")), D2, "after Saturday's set ends, Sunday is next");
  assert.equal(DY.defaultDay(d, at("15:00", D2)), D2); assert.equal(DY.defaultDay(d, at("20:00", D3)), D3);
});
check("day event: that day's slots only, under the event's own id and name; a separate key for briefing history", () => {
  const e = DY.dayEvent(C, fest, D2);
  assert.deepEqual(e.slots.map((x) => [x.name, x.start, x.end, !!x.main]), [["Main day", `${D2}T10:00`, `${D2}T23:00`, true]]);
  assert.equal(e.id, "ev_fest"); assert.equal(e.name, fest.name); assert.equal(e.dayKey, `ev_fest@${D2}`);
  assert.deepEqual(e.day, { date: D2, label: "Sun, Dec 6", index: 1, count: 3 }); assert.deepEqual(e.times, { start: `${D2}T10:00`, end: `${D2}T23:00` });
  assert.equal(DY.dayEvent(C, fest, "2026-12-09"), null);
  const L = DY.dayEvent(C, legacy, D2); assert.deepEqual(L.slots.map((x) => [x.name, x.start, x.end]), [["Event", `${D2}T00:00`, `${D3}T00:00`]]); assert.equal(L.fold, undefined);
});
check("a day's totals cover that day's slot hours only (Saturday 5 to 11 PM: six hours), not the night after", () => {
  const ctx = data(), e = DY.dayEvent(C, fest, day), b = S.eventBrief(ctx, e), V = HV.eventView({ C, S, M, ctx, brief: b, thr: { gust: 25 }, tz, now: ctx.now });
  assert.equal(V.totals.hours, 6); assert.ok(Math.abs(V.totals.qpf - 0.3) < 1e-9, `0.05 in an hour for six hours: ${V.totals.qpf}`);
  const whole = S.eventBrief(ctx, fest); assert.ok(whole.all.endMs > b.all.endMs);
});
check("day status: a concern names its hazard, level, hours and slots; a dry day says so; a day beyond the guidance says that, never \"no concern\"", () => {
  const ctx = data(), st = (d) => DY.status(C, S, ctx, fest, d, { gust: 25 }, tz);
  const sat = st(day), sun = st(D2), mon = st(D3);
  assert.equal(sat.state, "concern"); assert.match(sat.text, /^Rain: /); assert.match(sat.text, /5–11 PM$/); assert.deepEqual(sat.slots, ["Friday-night set"]);
  assert.equal(sun.state, "clear"); assert.equal(sun.text, "No concern found");
  assert.equal(mon.state, "pending"); assert.equal(mon.text, "Not in the hourly forecast yet"); assert.doesNotMatch(mon.text, /no concern/i);
});
check("single-day events are not multi-day; days of an event with no times are empty", () => {
  const one = { id: "x", name: "One", loc, tz, times: { start: `${day}T17:00`, end: `${day}T22:00` }, slots: [{ id: "a", name: "Reception", start: `${day}T17:00`, end: `${day}T22:00` }] };
  assert.equal(DY.isMultiDay(C, one), false); assert.deepEqual(DY.days(C, { id: "y", name: "None", loc, tz, times: {} }), []);
});
console.log(`${n} checks passed`);
