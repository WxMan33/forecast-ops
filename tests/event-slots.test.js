"use strict";
/* Planner-defined schedules (event.slots): the data model, the main-slot rule, gaps between slots, the slot names in the
   briefing's words, share links and backups, and calendar imports. Weather here is SYNTHETIC (invented hourly values
   for a test venue), run through the real engines: Core.event, BetaStory, HourlyModel, HourlyViews, EventLead and the
   briefing presentation. Not a forecast. */
const assert = require("node:assert/strict");
const C = require("../assets/ops-core.js"), S = require("../assets/beta-story.js"), T = require("../assets/model-trends.js");
const M = require("../assets/hourly-model.js"), HV = require("../assets/hourly-views.js"), L = require("../assets/event-lead.js");
const U = require("../assets/event-briefing-ui.js"), E = require("../assets/event-store.js"), D = require("../assets/event-daylight.js"), A = require("../assets/almanac-core.js");
let n = 0; const check = (name, f) => { f(); n++; console.log("PASS " + name); };
const H = 3600e3, tz = "America/New_York", day = "2026-12-05", loc = { name: "Test garden (synthetic)", lat: 39.1, lon: -84.5 };
const at = (hhmm, d = day) => C.time.toUtc(`${d}T${hhmm}`, tz);

/* the owner's examples */
const reception = { id: "ev_rec", name: "Outdoor reception", loc, tz, times: { start: `${day}T17:00`, end: `${day}T22:00` }, slots: [{ id: "a", name: "Reception", start: `${day}T17:00`, end: `${day}T22:00` }] };
const wedding = { id: "ev_wed", name: "Wedding", loc, tz, times: { start: `${day}T13:00`, end: `${day}T22:00` }, slots: E.templateSlots("wedding", day) };
const overnight = { id: "ev_night", name: "Night market", loc, tz, times: { start: `${day}T21:00`, end: "2026-12-06T03:00" }, slots: [{ id: "n", name: "Night market", start: `${day}T21:00`, end: "2026-12-06T03:00" }] };
const stadium = { id: "ev_old", name: "FC Cincinnati vs. Columbus", loc, tz, times: { setup: `${day}T12:00`, gates: `${day}T16:30`, start: `${day}T17:00`, end: `${day}T22:00`, teardown: "2026-12-06T00:00" } };

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
const run = (ev, ctx = data()) => { const b = S.eventBrief(ctx, ev), V = HV.eventView({ C, S, M, ctx, brief: b, thr: { gust: 25 }, tz, now: ctx.now }); return { b, V, ctx }; };

check("data model: slots become windows in time order, named as typed; the main slot carries the event key", () => {
  const w = C.event.windows(wedding);
  assert.deepEqual(w.map((x) => [x.key === "event" ? "event" : "slot", x.label, x.startLocal.slice(11), x.endLocal.slice(11)]),
    [["slot", "Vendor setup", "13:00", "15:00"], ["event", "Outdoor ceremony", "16:00", "16:30"], ["slot", "Reception", "17:00", "22:00"], ["slot", "Whole event", "13:00", "22:00"]]);
  const all = w.find((x) => x.key === "all");
  assert.equal(all.spans.length, 3, "three spans: the gaps 3–4 PM and 4:30–5 PM are not event time");
  assert.deepEqual(C.event.validate(wedding), []);
  assert.deepEqual(C.event.windows(reception).map((x) => x.label), ["Reception", "Whole event"]);
  const o = C.event.windows(overnight); assert.equal(o[0].hours, 6); assert.equal(o[0].endLocal, "2026-12-06T03:00");
});
check("main slot rule: marked main, else the slot named Event, else the longest non-setup slot, else the first", () => {
  const s = (name, a, b, main) => ({ name, start: `${day}T${a}`, end: `${day}T${b}`, ...(main ? { main: true } : {}) });
  assert.equal(C.event.mainOf([s("Vendor setup", "13:00", "15:00"), s("Outdoor ceremony", "16:00", "16:30", true), s("Reception", "17:00", "22:00")]), 1);
  assert.equal(C.event.mainOf([s("Load-in", "08:00", "18:00"), s("Event", "19:00", "20:00"), s("Teardown", "20:00", "23:00")]), 1);
  assert.equal(C.event.mainOf([s("Vendor setup", "08:00", "15:00"), s("Ceremony", "16:00", "16:30"), s("Reception", "17:00", "22:00")]), 2, "longest slot that isn't setup work");
  assert.equal(C.event.mainOf([s("Setup", "08:00", "15:00"), s("Teardown", "16:00", "17:00")]), 0, "only side slots: the first");
});
check("validation: end after start, at least a name, nonexistent times refused; overlaps are a warning, gaps are fine", () => {
  const bad = { ...wedding, slots: [{ id: "x", name: "Reception", start: `${day}T22:00`, end: `${day}T22:00` }] };
  assert.match(C.event.validate(bad).join(" "), /Reception must end after it starts/);
  assert.match(C.event.validate({ ...wedding, slots: [{ id: "x", name: " ", start: `${day}T17:00`, end: `${day}T18:00` }] }).join(" "), /needs a name/);
  assert.match(C.event.validate({ ...wedding, slots: [{ id: "x", name: "Brunch", start: "2027-03-14T02:30", end: "2027-03-14T05:00" }] }).join(" "), /doesn't exist that day/);
  const ov = { ...wedding, slots: [{ id: "a", name: "Ceremony", start: `${day}T16:00`, end: `${day}T17:30` }, { id: "b", name: "Reception", start: `${day}T17:00`, end: `${day}T22:00` }] };
  assert.deepEqual(C.event.validate(ov), []); assert.deepEqual(C.event.warnings(ov), ["Ceremony and Reception overlap."]);
  assert.deepEqual(C.event.warnings(wedding), []);
});
check("existing stadium events: read exactly as before; as slots they are Setup, Gates, Event, Teardown and save back to the same times", () => {
  const w = C.event.windows(stadium);
  assert.deepEqual(w.map((x) => x.key), ["setup", "gates", "event", "teardown", "all"]);
  assert.equal(w.find((x) => x.key === "all").spans.length, 1);
  const sl = C.event.slotsOf(stadium); assert.deepEqual(sl.map((x) => x.name), ["Setup", "Gates", "Event", "Teardown"]);
  assert.deepEqual(C.event.legacyTimes(sl), stadium.times, "unchanged slots save as the same fixed parts");
  assert.equal(C.event.legacyTimes([{ ...sl[0], name: "Load-in" }, ...sl.slice(1)]), null, "a renamed part is a slot schedule");
  assert.deepEqual(C.event.legacyTimes([{ name: "Event", start: `${day}T19:30`, end: `${day}T21:30` }]), { start: `${day}T19:30`, end: `${day}T21:30` }, "one window named Event is today's start/end-only event");
  const { b } = run(stadium); assert.equal(b.spans, null, "no gaps: nothing filtered");
});
/* a wedding with a longer break before the reception (4:30–7 PM): the 6 PM hour lies wholly between slots */
const longBreak = { ...wedding, id: "ev_break", slots: wedding.slots.map((x) => (x.name === "Reception" ? { ...x, start: `${day}T19:00` } : x)) };
check("gaps: an hour wholly between slots is left out of the totals, concerns and timing; short gaps hold no whole hour", () => {
  const ctx0 = data(), { b, V } = run(longBreak, ctx0), hh = (m) => C.time.toLocal(m, tz).slice(11, 13);
  assert.deepEqual(V.span.map(hh), ["13", "14", "15", "16", "17", "18", "19", "20", "21"], "the grid and charts show every hour of the span");
  assert.ok(!b.hours.map((h) => hh(h.ms)).includes("18"), "the 6 PM hour is not an event hour"); assert.ok(b.hours.map((h) => hh(h.ms)).includes("17"), "the 5 PM hour still reads the end of the ceremony's hour");
  assert.equal(V.totals.hours, 8);
  const sum = V.hrs.filter((h) => hh(h.ms) !== "18").reduce((t, h) => t + h.qpf, 0);
  assert.ok(Math.abs(V.totals.qpf - sum) < 1e-9, `total ${V.totals.qpf} = the sum of the hourly amounts outside the gap (${sum})`);
  const whole = run({ ...stadium, times: { start: `${day}T13:00`, end: `${day}T22:00` } }, ctx0).V.totals.qpf;
  assert.ok(Math.abs(whole - V.totals.qpf - 0.05) < 1e-9, `one window over the same hours adds exactly the gap hour (${whole} vs ${V.totals.qpf})`);
  assert.equal(V.rows.find((r) => r.key === "phase").cells[V.span.indexOf(at("18:00"))].text, "Between slots");
  /* the owner's wedding: the 3–4 PM and 4:30–5 PM gaps are shorter than two hours, so every hourly value touches a slot
     (the 3 PM column's amount is 2–3 PM rain, during vendor setup; the 4 PM column is the ceremony's hour) */
  const w = run(wedding, ctx0); assert.equal(w.V.totals.hours, 9); assert.equal(w.V.rows.find((r) => r.key === "phase").cells.filter((c) => c.text === "Between slots").length, 0);
});
check("gaps: the per-hour calculation and thresholds are the same with and without slots", () => {
  const a = run(wedding).V, z = run({ ...stadium, times: { start: `${day}T13:00`, end: `${day}T22:00` } }).V;
  a.span.forEach((ms, i) => { const j = z.span.indexOf(ms); if (j < 0) return; ["temp", "pop", "qpf", "gust"].forEach((k) => assert.equal(a.hrs[i][k], z.hrs[j][k], `${k} at ${C.time.toLocal(ms, tz)}`)); });
  assert.equal(S.HAZARDS.rain.level({ chanceV: 0.5, qpf: 0 }), 2);
});
check("names in the briefing: the lead, the decision and the plan lines use the slot names", () => {
  const { b } = run(wedding);
  assert.equal(b.top.key, "rain"); assert.deepEqual(b.top.phases, ["Vendor setup", "Outdoor ceremony", "Reception"]);
  assert.equal(U.headline(b, S.decision(b).text), "Plan for rain through the 4 PM Outdoor ceremony.");
  const late = run({ ...wedding, slots: wedding.slots.map((x) => (x.name === "Vendor setup" ? { ...x, start: `${day}T10:00`, end: `${day}T12:00` } : x)) }).b;
  assert.match(U.headline(late, S.decision(late).text), /through the 4 PM Outdoor ceremony\.$/);
  const rec = run({ ...wedding, slots: [{ ...wedding.slots[1], start: `${day}T11:00`, end: `${day}T11:30` }, wedding.slots[2]] }).b;
  assert.match(U.headline(rec, S.decision(rec).text), /through the 5 PM Reception\.$/, "the affected slot leads when the main slot is dry");
  assert.match(S.decision(b).text, /Outdoor ceremony/);
  assert.equal(S.partPhrase("Reception"), "the Reception"); assert.equal(S.partPhrase("Event"), "the event"); assert.equal(S.partPhrase("Setup"), "setup"); assert.equal(S.partPhrase("Saturday"), "Saturday");
});
check("single window: the Reception is named, 5–10 PM; no gap wording", () => {
  const { b, V } = run(reception);
  assert.equal(b.phases.length, 1); assert.equal(b.spans, null);
  assert.match(U.headline(b, S.decision(b).text), /Reception/);
  assert.equal(V.rows.find((r) => r.key === "phase").cells.filter((c) => c.text === "Between slots").length, 0);
});
check("overnight slot: 9 PM to 3 AM is one window across midnight", () => {
  const ctx = data(at("06:00")), { b, V } = run(overnight, ctx);
  assert.equal(V.span.length, 6); assert.equal(C.time.toLocal(V.span[5], tz), "2026-12-06T02:00");
  assert.equal(b.spans, null);
  assert.equal(S.readiness(b, ctx).line, "The Night market covered");
});
check("why this is flagged: totals over gaps name the slot hours they cover", () => {
  const { b, V, ctx } = run(wedding), A2 = U.attention({ b, V, S, thr: { gust: 25 } });
  const o = { b, A: A2, R: S.readiness(b, ctx), S, V, ctx, feeds: { used: ["GFS", "ECMWF IFS", "NBM"], missing: [] }, alerts: [], alertsAvailable: true, tz, now: ctx.now, limit: 25, names: {} };
  const LM = L.model(o), W = L.why(o, LM), spread = W.rows.find((r) => r[0] === "Model spread")[1];
  assert.match(spread, /Totals cover your slots: 1–3 PM, 4–4:30 PM, 5–10 PM; hours wholly between them are not counted\./);
  assert.ok(A2.hours.filter((x) => x.rain.signal).every((x) => C.event.inSpans(b.spans, x.ms)), "no attention hour in a gap");
  assert.match(L.leadHtml(LM, { tz, lat: 39, lon: -84 }), /Vendor setup through Reception/);
});
const leadOf = (ev, ctx) => { const { b, V } = run(ev, ctx), A2 = U.attention({ b, V, S, thr: { gust: 25 } });
  const o = { b, A: A2, R: S.readiness(b, ctx), S, V, ctx, feeds: { used: ["GFS", "ECMWF IFS", "NBM"], missing: [] }, alerts: [], alertsAvailable: true, tz, now: ctx.now, limit: 25, names: {} };
  const LM = L.model(o); return { b, V, A2, LM, W: L.why(o, LM), head: U.headline(b, S.decision(b).text) }; };
check("owner case 1: a shower at the Outdoor ceremony (the 4 and 5 PM hours); the headline, lead and plan lines name that slot", () => {
  /* a shower in the 4 PM and 5 PM hours of the hourly grid (synthetic): the ceremony's own rating sees the 4–5 PM amount */
  const ctx = data(at("06:00"), (hr) => hr === 16 || hr === 17), r = leadOf(wedding, ctx);
  assert.equal(r.b.top.key, "rain"); assert.ok(r.b.phases.find((p) => p.label === "Outdoor ceremony").levels.rain >= 1, "the ceremony is rated for rain");
  assert.equal(r.b.top.phases[0], "Outdoor ceremony"); assert.ok(!r.b.top.phases.includes("Vendor setup"));
  assert.equal(r.head, "Watch for rain through the 4 PM Outdoor ceremony.");
  assert.match(L.leadHtml(r.LM, { tz, lat: 39, lon: -84 }), /Outdoor ceremony 4–4:30 PM/);
  assert.match(S.decision(r.b).text, /Outdoor ceremony/);
  const lines = U.planLines(r.A2, r.b, { state: "ok", base: "Low" }, tz, (v) => `${Math.round(v)}%`).map((x) => x.text).join(" ");
  assert.match(lines, /the Outdoor ceremony/); assert.doesNotMatch(lines, /Vendor setup/);
});
check("owner case 2: rain only in an hour between slots (6 PM, before a 7 PM reception): no slot is affected, the totals leave it out, the grid still shows it", () => {
  const ctx = data(at("06:00"), (hr) => hr === 18), r = leadOf(longBreak, ctx);
  assert.equal(r.b.top, null, "no concern: the only wet hour is between slots");
  assert.ok(r.b.phases.every((p) => !p.levels.rain), "no slot rated for rain");
  assert.equal(r.V.totals.qpf, 0, "the gap hour's rain is not in the total");
  const i = r.V.span.indexOf(at("18:00")); assert.ok(Math.abs(r.V.hrs[i].qpf - 0.05) < 1e-9, "the hourly grid and charts still show it"); assert.equal(r.V.rows.find((x) => x.key === "phase").cells[i].text, "Between slots");
  const all = run({ ...stadium, times: { start: `${day}T13:00`, end: `${day}T22:00` } }, ctx);
  assert.ok(all.V.totals.qpf > 0.04, "the same hours as one window would count it (same per-hour values)");
  assert.match(r.W.rows.find((x) => x[0] === "Model spread")[1], /Totals cover your slots: 1–3 PM, 4–4:30 PM, 7–10 PM; hours wholly between them are not counted\./);
  assert.ok(r.A2.hours.every((x) => !x.rain.signal), "no attention-track hour");
});
check("daylight notes name the slot", () => {
  const Dl = D.compute({ A, C, windows: C.event.windows(reception), lat: loc.lat, lon: loc.lon, tz });
  assert.equal(Dl.note, "Sunset during the Reception (5:15 PM).");
  const Dn = D.compute({ A, C, windows: C.event.windows(overnight), lat: loc.lat, lon: loc.lon, tz }); assert.match(Dn.note, /after sunset/);
  const Dw = D.compute({ A, C, windows: C.event.windows(wedding), lat: loc.lat, lon: loc.lon, tz });
  assert.match(Dw.note, /Sunset during the Reception|Sunset during the Outdoor ceremony/);
});
check("share links: old links open as before; new links carry the slots; an old page reads a new link as one window", () => {
  const old = JSON.stringify({ n: stadium.name, v: loc, z: tz, t: stadium.times, g: 25 });
  const o = S.eventFromParam(old, C); assert.deepEqual(o.times, stadium.times); assert.equal(o.slots, undefined);
  assert.equal(S.eventToParam(o), old, "an old event makes the same link as before");
  const p = S.eventToParam(wedding), x = JSON.parse(p);
  assert.deepEqual(x.t, { start: `${day}T13:00`, end: `${day}T22:00` }); assert.equal(x.s.length, 3); assert.deepEqual(x.s[1], ["Outdoor ceremony", `${day}T16:00`, `${day}T16:30`, { m: 1 }]);
  const back = S.eventFromParam(p, C);
  assert.deepEqual(back.slots.map((s) => [s.name, s.start, s.end, !!s.main]), wedding.slots.map((s) => [s.name, s.start, s.end, !!s.main]));
  assert.deepEqual(C.event.windows(back).map((w) => w.label), C.event.windows(wedding).map((w) => w.label));
  /* a page from before slots ignores "s": the same link is one window from the first slot's start to the last slot's end */
  const { s: _s, ...asOld } = x, oldView = S.eventFromParam(JSON.stringify(asOld), C);
  assert.deepEqual(C.event.windows(oldView).map((w) => [w.label, w.startLocal, w.endLocal]).slice(0, 1), [["Event", `${day}T13:00`, `${day}T22:00`]]);
  assert.equal(S.eventFromParam(JSON.stringify({ ...x, s: [["Bad", `${day}T18:00`, `${day}T17:00`]] }), C), null, "an invalid slot is refused like any invalid link");
});
check("backup: events with and without slots round-trip exactly", () => {
  const file = { kind: E.BACKUP_KIND, version: E.BACKUP_VERSION, venues: [], events: [
    { ...stadium, source: { kind: "manual" }, overrides: [], gust: 25, venueId: null, created: 1, updated: 2 },
    { ...wedding, source: { kind: "manual" }, overrides: [], gust: 25, venueId: null, created: 1, updated: 2 }] };
  const r = E.readBackup(JSON.stringify(file)); assert.equal(r.ok, true, r.errors.join(" "));
  assert.equal(r.events[0].slots, undefined); assert.deepEqual(r.events[0].times, stadium.times);
  assert.deepEqual(r.events[1].slots, wedding.slots.map((x) => E.cleanSlot(x)));
  assert.deepEqual(E.readBackup(JSON.stringify({ ...file, events: r.events })).events, r.events, "a second round trip changes nothing");
  const bad = E.readBackup(JSON.stringify({ ...file, events: [{ ...file.events[1], slots: [{ id: "a", name: "", start: "x", end: "y" }] }] }));
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /time slot/);
});
check("calendar import: an event without a known venue is one Event slot; several import together", () => {
  const g = (id, s, e, location = "Somewhere new") => ({ id, summary: `Party ${id}`, location, start: { dateTime: s, timeZone: tz }, end: { dateTime: e, timeZone: tz } });
  const r1 = E.fromCalendar(g("a", "2026-12-05T17:00:00-05:00", "2026-12-05T22:00:00-05:00"), [], "cal", tz);
  assert.deepEqual(C.event.slotsOf(r1).map((x) => [x.name, x.start, x.end]), [["Event", `${day}T17:00`, `${day}T22:00`]]);
  const r2 = E.fromCalendar(g("b", "2026-12-06T21:00:00-05:00", "2026-12-07T03:00:00-05:00"), [], "cal", tz);
  const m = E.mergeImported([], [r1, r2]); assert.equal(m.added, 2); assert.equal(C.event.windows(m.list[1])[0].hours, 6);
  /* a calendar event the planner split into slots: a new calendar start moves every slot with it */
  const mine = { ...m.list[0], slots: [{ id: "x", name: "Dinner", start: `${day}T17:00`, end: `${day}T19:00` }, { id: "y", name: "Dancing", start: `${day}T19:30`, end: `${day}T22:00` }] };
  const moved = E.mergeImported([mine], [E.fromCalendar(g("a", "2026-12-05T18:00:00-05:00", "2026-12-05T23:00:00-05:00"), [], "cal", tz)]).list[0];
  assert.deepEqual(moved.slots.map((x) => [x.start, x.end]), [[`${day}T18:00`, `${day}T20:00`], [`${day}T20:30`, `${day}T23:00`]]);
  assert.deepEqual(moved.times, { start: `${day}T18:00`, end: `${day}T23:00` });
});
check("templates: single window, the stadium schedule from venue defaults, and a wedding example", () => {
  assert.deepEqual(E.TEMPLATES.map((x) => x.id), ["single", "stadium", "wedding"]);
  assert.deepEqual(E.templateSlots("single", day).map((x) => [x.name, x.start, x.end]), [["Event", `${day}T19:30`, `${day}T21:30`]]);
  assert.deepEqual(E.templateSlots("wedding", day).map((x) => [x.name, x.start.slice(11), x.end.slice(11), !!x.main]), [["Vendor setup", "13:00", "15:00", false], ["Outdoor ceremony", "16:00", "16:30", true], ["Reception", "17:00", "22:00", false]]);
  assert.equal(E.templateSlots("stadium", day), null, "the stadium template is the fixed-part form");
});
console.log(`${n} checks passed`);
