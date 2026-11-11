/* Shared hourly forecast: the data behind the grid, on deterministic synthetic guidance (no network).
   Ordinary, overnight, multi-day, DST fall-back, overlapping concerns and missing guidance. */
"use strict";
const assert = require("assert");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const C = require("../assets/ops-core.js"), T = require("../assets/model-trends.js"), S = require("../assets/beta-story.js"), M = require("../assets/hourly-model.js");
const H = 3600e3, NY = "America/New_York";

/* synthetic guidance: one source, hourly from t0 for n hours; f(i, ms) gives that hour's values */
function guidance(t0, hours, f) {
  const ms = Array.from({ length: hours }, (_, i) => t0 + i * H), h = { temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], wind_speed_10m: [], wind_gusts_10m: [], snowfall: [], weather_code: [] };
  ms.forEach((m, i) => { const v = f(i, m); Object.keys(h).forEach((k) => h[k].push(v[k] === undefined ? null : v[k])); });
  return { ms, times: ms.map((m) => C.time.toLocal(m, NY)), tz: NY, models: { gfs_seamless: { h, d: {} } } };
}
const calm = () => ({ temperature_2m: 50, apparent_temperature: 48, precipitation_probability: 5, precipitation: 0, wind_speed_10m: 6, wind_gusts_10m: 12, snowfall: 0 });
const ws = { gfs_seamless: 1 };

/* ---------- ordinary: values per hour are windowRow over that hour ---------- */
{
  const t0 = Date.parse("2026-11-20T12:00:00Z"), B = guidance(t0, 30, (i) => ({ ...calm(), temperature_2m: 40 + i, precipitation_probability: 10 * (i % 10), precipitation: i === 5 ? 0.12 : 0, wind_speed_10m: 5 + i, wind_gusts_10m: 15 + i }));
  const span = M.blendSpan(t0 + 20 * 60e3, 24), hrs = M.blendHours(C, B, ws, {}, span);
  eq([span.length, span[0], span[23]], [24, t0, t0 + 23 * H], "next 24 hours start at the current hour");
  const r = C.blend.windowRow(B, ws, [5], [5], {});
  eq([hrs[5].temp, hrs[5].feel, hrs[5].pop, hrs[5].qpf, hrs[5].gust, hrs[5].wind], [r.hi, r.feel, r.pop, r.qpf, r.gust, 10], "an hour's values are the blend's own windowRow for that hour (wind is sustained wind)");
  eq([hrs[5].state, hrs[5].n, hrs[5].contrib], ["ok", 1, ["gfs_seamless"]], "covered hour, with the sources that contributed");
  eq(hrs[5].chance, null, "no ensemble loaded: the ensemble threshold probability is missing, not zero");
  eq(M.blendSpan(t0, 48).length, 48, "48 hours"); eq(M.blendSpan(t0, 72).length, 72, "72 hours");
  eq(M.blendSpan(t0, 24, { s: t0 + 3 * H + 30 * 60e3, e: t0 + 6 * H }).length, 3, "a custom window covers every hour it touches");
  const beyond = M.blendHours(C, B, ws, {}, M.blendSpan(t0, 72));
  eq([beyond[29].state, beyond[30].state, beyond[71].state], ["ok", "beyond", "beyond"], "hours past the loaded guidance are 'beyond', not blank or zero");
  const ax = M.axis(C, span, NY);
  eq([ax[0].local, ax[0].hourText, ax[0].showZone, ax[0].zone], ["2026-11-20T07:00", "7 AM", true, "EST"], "axis: local labels, zone on the first hour");
  const mid = ax.findIndex((a) => a.hour === 0);
  eq([ax[mid].newDay, ax[mid].hourText, ax[mid].date], [true, "12 AM", "2026-11-21"], "midnight starts a new local day");
}

/* ---------- missing data: a source gap inside the loaded hours ---------- */
{
  const t0 = Date.parse("2026-11-20T12:00:00Z"), B = guidance(t0, 10, (i) => (i === 4 ? {} : { ...calm(), precipitation_probability: i === 6 ? null : 20 }));
  const hrs = M.blendHours(C, B, ws, {}, M.spanHours(t0, t0 + 10 * H));
  eq(hrs[4].state, "nodata", "an hour where no source has a value is 'nodata'");
  eq([hrs[4].temp, hrs[4].pop], [null, null], "missing values stay null, never zero");
  eq([hrs[6].state, hrs[6].pop, hrs[6].temp], ["ok", null, 50], "one missing field leaves that field null and the rest intact");
}

/* ---------- DST fall-back: both 1 AM hours, each labelled with its zone ---------- */
{
  const t0 = Date.parse("2026-11-01T03:00:00Z"); // 11 PM EDT Oct 31
  const ax = M.axis(C, M.spanHours(t0, t0 + 6 * H), NY);
  eq(ax.map((a) => `${a.hourText} ${a.showZone ? a.zone : ""}`.trim()), ["11 PM EDT", "12 AM", "1 AM EDT", "1 AM EST", "2 AM", "3 AM"], "fall back: two 1 AM hours, labelled EDT and EST (the zone change happens at the second one)");
  eq(ax.filter((a) => a.repeated).length, 2, "both occurrences flagged as a repeated local time");
  eq(new Set(ax.map((a) => a.ms)).size, 6, "six distinct hours (real instants), no merged hour");
  const sp = M.axis(C, M.spanHours(Date.parse("2027-03-14T05:00:00Z"), Date.parse("2027-03-14T09:00:00Z")), NY);
  eq(sp.map((a) => a.hourText), ["12 AM", "1 AM", "3 AM", "4 AM"], "spring forward: the skipped 2 AM hour does not appear");
}

/* ---------- event concerns from the briefing engine: overnight, overlapping, multi-day, missing ---------- */
const ctxFor = (B, thunderAt) => { const ctx = S.context({ C, T, B, ws, rules: null, now: B.ms[0] - 2 * H }); ctx.th = thunderAt ? { at: thunderAt, perModel: () => null, ids: [] } : null; return ctx; };
{
  /* overnight event 8 PM - 1 AM with a 7:30 gates time; rain and gusts overlap 10 PM - midnight; thunder at 11 PM */
  const t0 = Date.parse("2026-11-20T18:00:00Z"); // 1 PM EST
  const B = guidance(t0, 20, (i, m) => { const hr = +C.time.toLocal(m, NY).slice(11, 13); const wet = hr >= 22 || hr === 0;
    return { ...calm(), precipitation_probability: wet ? 80 : 10, precipitation: wet ? 0.3 : 0, wind_gusts_10m: wet ? 38 : 12, wind_speed_10m: wet ? 20 : 6 }; });
  const tAt = (m) => (C.time.toLocal(m, NY).slice(11, 13) === "23" ? "prepare" : "normal");
  const ctx = ctxFor(B, tAt), ev = { name: "Synthetic late show", loc: { name: "X", lat: 39.1, lon: -84.5 }, tz: NY, times: { setup: "2026-11-20T16:00", gates: "2026-11-20T19:30", start: "2026-11-20T20:00", end: "2026-11-21T01:00", teardown: "2026-11-21T02:30" } };
  const b = S.eventBrief(ctx, ev, { gust: 25 }), span = M.eventSpan(b), hrs = M.blendHours(C, B, ws, ctx.opts, span, ctx.th), ax = M.axis(C, span, NY);
  eq([ax[0].hourText, ax[ax.length - 1].hourText, span.length], ["4 PM", "2 AM", 11], "setup 4 PM through teardown 2:30 AM: 11 whole hours, across midnight");
  const cov = M.phaseCover(span, b.phases), g = ax.findIndex((a) => a.hourText === "7 PM");
  eq(cov[g].map((p) => [p.key, p.from, p.to]), [["setup", 0, 30], ["gates", 30, 60]], "the 7 PM hour: setup ends and gates starts at :30");
  const last = cov[cov.length - 1]; eq(last.map((p) => [p.key, p.from, p.to]), [["teardown", 0, 30]], "teardown ends at 2:30, half the last hour");
  const con = M.eventConcerns(S, C, b, hrs, { gust: 25 });
  eq(con.rows.map((r) => r.key), ["lightning", "wind", "rain"], "overlapping concerns each get their own row, in the engine's order");
  const ev10 = ax.findIndex((a) => a.hourText === "10 PM"), p = b.phases.find((x) => x.key === "event");
  eq(con.rows.find((r) => r.key === "rain").cells[ev10], { state: "concern", tier: S.LEVEL_TIER[p.levels.rain], level: p.levels.rain, word: S.LEVEL_WORD[p.levels.rain], why: `Rain meets its hourly rule; Event rated ${S.LEVEL_WORD[p.levels.rain].toLowerCase()}`, source: "phase" }, "rain at 10 PM carries the event phase's own level");
  eq(con.rows.find((r) => r.key === "wind").cells[ev10].tier, S.LEVEL_TIER[p.levels.wind], "wind at 10 PM carries the phase's wind level");
  const l11 = con.rows.find((r) => r.key === "lightning").cells[ax.findIndex((a) => a.hourText === "11 PM")];
  eq([l11.state, l11.tier, l11.source], ["concern", "prepare", "hour"], "lightning uses the Thunder page's tier for that hour");
  eq(con.rows.find((r) => r.key === "rain").cells[0].state, "clear", "a dry 4 PM hour: no concern");
  eq([con.summary[ev10].count, con.summary[ev10].keys.sort()], [2, ["rain", "wind"]], "summary counts overlapping concerns");
  ok(con.summary[ax.findIndex((a) => a.hourText === "11 PM")].count === 3, "11 PM: lightning, wind and rain overlap");
  const tiers = new Set(con.rows.flatMap((r) => r.cells.filter((c) => c.state === "concern").map((c) => c.tier)));
  ok([...tiers].every((t) => ["monitor", "prepare", "action"].includes(t)), "only the engine's tiers appear (monitor/prepare/action)");
}
{
  /* a flagged hour in a phase the engine rates Low stays unshaded, and says so */
  const t0 = Date.parse("2026-11-20T18:00:00Z");
  const B = guidance(t0, 12, (i, m) => ({ ...calm(), precipitation_probability: C.time.toLocal(m, NY).slice(11, 13) === "15" ? 45 : 5 }));
  const ctx = ctxFor(B, () => "normal"), ev = { name: "Synthetic fair", loc: { name: "X", lat: 39.1, lon: -84.5 }, tz: NY, times: { start: "2026-11-20T14:00", end: "2026-11-20T18:00" } };
  const b = S.eventBrief(ctx, ev, { gust: 25 }), span = M.eventSpan(b), con = M.eventConcerns(S, C, b, M.blendHours(C, B, ws, ctx.opts, span, ctx.th), { gust: 25 });
  const rain = con.rows.find((r) => r.key === "rain"), at3 = M.axis(C, span, NY).findIndex((a) => a.hourText === "3 PM");
  eq([b.phases[0].levels.rain, rain.cells[at3].state, rain.cells[at3].tier], [0, "flag", undefined], "45% PoP meets rain's hourly rule but the phase rates Low: flagged, no colour, no invented level");
  eq(con.summary[at3].state, "flag", "summary keeps it unshaded");
}
{
  /* multi-day event partly beyond the guidance; thunder missing for some hours */
  const t0 = Date.parse("2026-11-20T15:00:00Z");
  const B = guidance(t0, 30, () => calm());
  const ctx = ctxFor(B, (m) => (m < t0 + 5 * H ? "normal" : null)), ev = { name: "Synthetic three-day fair", loc: { name: "X", lat: 39.1, lon: -84.5 }, tz: NY, times: { setup: "2026-11-20T08:00", start: "2026-11-20T10:00", end: "2026-11-22T18:00", teardown: "2026-11-22T20:00" } };
  const b = S.eventBrief(ctx, ev, { gust: 25 }), span = M.eventSpan(b), hrs = M.blendHours(C, B, ws, ctx.opts, span, ctx.th), ax = M.axis(C, span, NY);
  eq([span.length, ax.filter((a) => a.newDay).map((a) => a.date)], [60, ["2026-11-20", "2026-11-21", "2026-11-22"]], "multi-day: 8 AM Fri to 8 PM Sun is 60 hours across three local days");
  const con = M.eventConcerns(S, C, b, hrs, { gust: 25 });
  eq(con.rows.length, 0, "calm guidance: no hazard rows");
  eq([con.summary[2].state, con.summary[10].state, con.summary[40].state], ["clear", "partial", "missing"], "covered with thunder: no concern; covered without thunder: partial; beyond the guidance: missing");
  ok(con.summary.filter((c) => c.state === "missing").every((c) => /Beyond the hourly guidance/.test(c.why)), "missing hours say why");
  ok(!con.summary.some((c) => c.state === "clear" && hrs[con.summary.indexOf(c)].state !== "ok"), "no hour without guidance is ever shown as 'no concern'");
}
console.log(`ok - ${n} hourly model checks passed`);
