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
console.log(`ok - ${n} beta story checks passed`);
