/* Beta weather story (assets/beta-story.js): synthetic guidance only. Checks that the betas reuse the
   Model Blend aggregation, locate short phases like Model Blend's event table, rank concerns, judge timing
   from per-source spread and never invent check times. */
"use strict";
const assert = require("assert");
const C = require("../assets/ops-core.js"), T = require("../assets/model-trends.js"), S = require("../assets/beta-story.js");
let n = 0; const ok = (c, m) => { assert(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const H = 3600e3, TZ = "America/New_York";
/* 96 h from 2026-11-10 05Z (00 EST) */
const t0 = Date.UTC(2026, 10, 10, 5), ms = Array.from({ length: 96 }, (_, i) => t0 + i * H);
const times = ms.map((m) => C.time.toLocal(m, TZ));
const wet = (from, to, amt) => ms.map((m) => (m > from && m <= to ? amt : 0));
const det = (rainFrom, rainTo, gust = 12) => ({ h: { temperature_2m: ms.map((_, i) => 50 + 10 * Math.sin(i / 24 * 2 * Math.PI)), precipitation: wet(rainFrom, rainTo, 0.05), precipitation_probability: ms.map((m) => (m > rainFrom && m <= rainTo ? 70 : 5)),
  wind_gusts_10m: ms.map(() => gust), apparent_temperature: ms.map(() => 45), snowfall: ms.map(() => 0) }, d: {} });
/* day 2 (Nov 11) evening: three sources start rain at 17, 18 and 20 EST */
const at = (d, h) => C.time.toUtc(`2026-11-1${d}T${String(h).padStart(2, "0")}:00`, TZ);
const B = { times, ms, tz: TZ, dtimes: [], models: { a: det(at(1, 17), at(1, 22)), b: det(at(1, 18), at(1, 23)), c: det(at(1, 20), at(1, 23), 30) } };
const ws = { a: 1, b: 1, c: 1 }, now = at(0, 10);
const meta = { a: { lastRunInit: new Date(now - 5 * H).toISOString(), lastRunAvailable: new Date(now - H).toISOString(), updateIntervalH: 6 }, b: { lastRunInit: new Date(now - 5000 * H).toISOString(), updateIntervalH: 6 } };
const ctx = S.context({ C, T, B, ws, rules: null, meta, now });

/* the beta value for a window is Model Blend's windowRow for the same hours */
const idx = [], acc = []; ms.forEach((m, i) => { if (m >= at(1, 12) && m < at(1, 18)) idx.push(i); if (m > at(1, 12) && m <= at(1, 18)) acc.push(i); });
eq(S.windowRow(ctx, at(1, 12), at(1, 18)).qpf, C.blend.windowRow(B, ws, idx, acc, {}).qpf, "window value equals Model Blend's aggregation");
const ensB = { ...B, models: { e: { kind: "ens", members: [det(at(1, 12), at(1, 18)), det(0, 0)] } } };
const ensCtx = S.context({ C, T, B: ensB, ws: { e: 1 }, rules: null, now });
eq(S.windowRow(ensCtx, at(1, 12), at(1, 18)).chanceV, 0.5, "50 percent ensemble chance is a fraction in the beta story");
/* a 30-minute gates window still has values (Model Blend event-table locate), not "beyond guidance" */
const ev = { id: "t", name: "Test", loc: { lat: 39.1, lon: -84.5 }, tz: TZ, times: { setup: "2026-11-11T12:00", gates: "2026-11-11T16:30", start: "2026-11-11T17:00", end: "2026-11-11T22:00", teardown: "2026-11-12T00:00" } };
eq(C.event.validate(ev), [], "sample-shaped event is valid");
const b = S.eventBrief(ctx, ev, { gust: 25 });
ok(b.phases.find((p) => p.key === "gates").r, "30-minute gates phase gets the covering hour");
eq(b.phases.map((p) => p.label), ["Setup", "Gates", "Event", "Teardown"], "phases in order");
/* concerns: rain during event and teardown; wind from one source only stays below the blend threshold */
eq(b.top && b.top.key, "rain", "rain is the biggest concern");
ok(b.top.phases.includes("Event"), "rain matters during the event");
ok(b.top.from >= at(1, 17) && b.top.from <= at(1, 18), "rain starts near 5–6 PM in the blend");
eq(Math.round(b.top.timing.spreadH), 3, "timing spread = first-hour spread across sources (17 → 20 EST)");
eq(b.top.certainty.level, "medium", "a 3-hour spread is 'could shift'");
ok(!b.concerns.some((c) => c.key === "wind"), "a single gusty source does not make the blended gust a concern");
/* certainty wording */
eq(S.certainty({ show: 1, of: 4, spreadH: 0 }).level, "low", "only a minority of sources: low");
eq(S.certainty({ show: 4, of: 4, spreadH: 1 }).level, "high", "sources within 2 h: fairly consistent");
eq(S.certainty({ show: 4, of: 4, spreadH: 8 }).level, "low", "8 h apart: uncertain");
/* what could change: the early end of the spread is named, nothing invented */
const changes = S.planChanges(b, (m) => C.time.toLocal(m, TZ));
ok(changes.some((t) => /early end/.test(t)), "early-arrival consequence listed");
/* guidance age: a source whose metadata stopped updating is 'unknown', not 'late' */
const ages = S.guidanceAge(ctx, {});
eq(ages.find((a) => a.id === "a").late, false, "a 5-h-old 6-hourly run is on time");
eq(ages.find((a) => a.id === "b").unknown, true, "metadata thousands of hours old is reported as unknown");
eq(ages.find((a) => a.id === "b").late, false, "…and not as a late run");
/* check-again: model publication time comes from metadata; lead-time checkpoints only in the future */
const checks = S.checkAgain(ctx, b, {});
ok(checks.every((c) => c.at > now), "every check time is in the future");
ok(checks.every((c, i) => !i || checks[i - 1].at <= c.at), "check times are in order");
/* sample event opens without any account or saved data; the picker prefers the active evening */
const s1 = S.sampleEvent(C, now, TZ, 1); eq(C.event.validate(s1), [], "sample event is valid");
eq(s1.times.start.slice(0, 10), "2026-11-11", "sample defaults to tomorrow");
eq(S.pickSample(ctx, C, TZ).times.start.slice(0, 10), "2026-11-11", "picker chooses the evening with rain");
/* disagreement: the quick read reports split timing */
const d = S.disagreement(ctx, at(1, 12), at(2, 0));
eq(d.precip.wet, 3, "all three sources wet"); eq(d.timing.level, "some", "3-hour onset spread is 'some disagreement'");
/* strongest signal first; decision sentence */
const sig = S.signals(ctx, at(1, 12), at(2, 0), (m) => C.time.toLocal(m, TZ).slice(11, 16));
eq(sig[0].key, "timing", "the 3-hour onset spread is the strongest signal");
eq(sig[0].title, "Rain onset differs by 3 hours", "plain-language strongest signal");
ok(sig.some((x) => x.title === "All 3 sources show rain"), "precipitation agreement worded by count");
eq(S.decision(b).text, "Plan for rain for most of the event.", "decision: rain from 6 PM through the end of a 5–10 PM event covers most of it");
const late = { ...b, top: { ...b.top, from: at(1, 20), to: at(2, 0) } };
eq(S.decision(late).text, "Plan for rain late in the event.", "decision: rain from 8 PM in a 5–10 PM event is late");
const setupOnly = { ...b, top: { ...b.top, level: 1, phases: ["Setup"], from: at(1, 13), to: at(1, 15) } };
eq(S.decision(setupOnly).text, "Watch for rain during setup.", "decision: a watch-level setup-only concern");
eq(S.decision({ top: null, phases: [] }).text, "No weather concern for this event right now.", "quiet decision");
/* markets: tuned blend inside the Cincinnati DMA; HRRR map inside the Tri-State crop */
eq(S.market(39.0446, -84.6723), { tuned: true, map: true }, "CVG: tuned blend and map");
eq(S.market(39.7684, -86.1581), { tuned: false, map: true }, "Indianapolis: default blend, inside the map");
eq(S.market(39.7392, -104.9903), { tuned: false, map: false }, "Denver: default blend, no map");
/* a Denver event crossing midnight keeps the venue's clock */
const den = { id: "d", name: "Late show", loc: { name: "Red Rocks", lat: 39.6654, lon: -105.2057 }, tz: "America/Denver", times: { setup: "2026-11-12T17:00", start: "2026-11-12T20:00", end: "2026-11-13T01:00", teardown: "2026-11-13T02:30" } };
eq(C.event.validate(den), [], "overnight Denver event is valid");
const dw = C.event.windows(den), dEv = dw.find((w) => w.key === "event");
eq(dEv.startMs, Date.UTC(2026, 10, 13, 3), "8 PM MST is 03Z");
eq(dEv.endMs, Date.UTC(2026, 10, 13, 8), "1 AM MST the next day is 08Z");
eq(dw.find((w) => w.key === "teardown").endLocal.slice(0, 16), "2026-11-13T02:30", "teardown ends 2:30 AM local, after midnight");
/* events travel in links */
const back = S.eventFromParam(S.eventToParam(den), C);
eq([back.tz, back.times.end, back.loc.name], ["America/Denver", "2026-11-13T01:00", "Red Rocks"], "event survives a link round trip");
eq(S.eventFromParam("{not json", C), null, "a broken link is ignored");
const s2 = S.sampleEvent(C, now, "America/Denver", 1, { name: "Denver, CO", lat: 39.74, lon: -104.98 });
eq([s2.loc.name, s2.tz, C.event.validate(s2).length], ["Denver, CO", "America/Denver", 0], "sample event at another city uses its venue and time zone");

/* ---------- readiness: pending, partly covered and ready events (guidance reaches 85 h ahead here) ---------- */
{
  const lead = ms[ms.length - 1] - now, mkEv = (day, t) => ({ id: "r", name: "Match, Test; FC", loc: { name: "TQL Stadium", lat: 39.11, lon: -84.52 }, tz: TZ, times: t });
  const far = mkEv(0, { setup: "2026-11-20T15:00", gates: "2026-11-20T18:00", start: "2026-11-20T19:30", end: "2026-11-20T21:30", teardown: "2026-11-20T23:30" });
  const bf = S.eventBrief(ctx, far), rf = S.readiness(bf, ctx);
  eq(rf.state, "pending", "an event weeks out is pending");
  eq([rf.firstAt, rf.readyAt], [C.time.toUtc("2026-11-20T15:00", TZ) - lead, C.time.toUtc("2026-11-20T23:30", TZ) - lead], "reminder times follow the guidance's actual reach: setup and teardown come into range one lead time before they happen");
  eq(rf.all, "setup, gates, the event and teardown", "pending message names every phase");
  ok(!S.planChanges(bf, String).some((x) => /planning threshold/.test(x)), "no 'no phase reaches a planning threshold' while coverage is missing");
  const edge = mkEv(0, { setup: "2026-11-13T18:00", gates: "2026-11-13T21:00", start: "2026-11-13T22:00", end: "2026-11-13T23:30", teardown: "2026-11-14T01:00" });
  const be = S.eventBrief(ctx, edge), re = S.readiness(be, ctx);
  eq([re.state, re.covered, re.partly, re.pending], ["partial", ["setup", "gates"], ["event"], ["teardown"]], "an event at the edge of the guidance is partly covered, phase by phase");
  eq(re.line, "Setup and gates covered · the event partly covered · teardown pending", "coverage says exactly what the guidance reaches");
  eq(re.readyAt, C.time.toUtc("2026-11-14T01:00", TZ) - lead, "full briefing expected when guidance reaches the end of teardown");
  const near = mkEv(0, { setup: "2026-11-11T15:00", gates: "2026-11-11T18:00", start: "2026-11-11T19:30", end: "2026-11-11T21:30", teardown: "2026-11-11T23:30" });
  const rn = S.readiness(S.eventBrief(ctx, near), ctx);
  eq([rn.state, rn.readyAt, rn.line], ["ready", null, "Setup, gates, the event and teardown covered"], "a covered event is ready, with no reminder");
  const rem = S.reminder(far, rf.readyAt, "https://example.test/event-beta.html?e=1");
  ok(/BEGIN:VALARM/.test(rem.ics) && /SUMMARY:Weather briefing ready: Match\\, Test\\; FC/.test(rem.ics) && /URL:https:\/\/example\.test/.test(rem.ics), "calendar reminder: alarm, escaped title, link back");
  ok(new URL(rem.google).searchParams.get("dates").startsWith(new Date(rf.readyAt).toISOString().replace(/[-:]/g, "").slice(0, 13)), "Google Calendar reminder at the ready time");
}
console.log(`ok - ${n} beta story checks passed`);
