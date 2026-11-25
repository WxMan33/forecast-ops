"use strict";
/* Event Manager lead (assets/event-lead.js): the tier rules written out in words must say exactly what the briefing's own
   hazard rules (BetaStory.HAZARDS) do; official alerts, missing guidance and forecast concerns stay apart. */
const assert = require("node:assert/strict"), L = require("../assets/event-lead.js"), S = require("../assets/beta-story.js"), U = require("../assets/event-briefing-ui.js");
let n = 0; const check = (name, f) => { f(); n++; console.log("PASS " + name); };
const lv = (k, r) => S.HAZARDS[k].level(r);

check("rain rule words match the rain tiers at their boundaries", () => {
  assert.match(L.TIER_RULE.rain[1], /20% chance or 0\.02″/); assert.match(L.TIER_RULE.rain[2], /50% chance or 0\.10″/); assert.match(L.TIER_RULE.rain[3], /70% chance and 0\.25″/);
  assert.equal(lv("rain", { chanceV: 0.2, qpf: 0 }), 1); assert.equal(lv("rain", { chanceV: 0.19, qpf: 0.02 }), 1); assert.equal(lv("rain", { chanceV: 0.19, qpf: 0.019 }), 0);
  assert.equal(lv("rain", { chanceV: 0.5, qpf: 0 }), 2); assert.equal(lv("rain", { chanceV: 0.1, qpf: 0.1 }), 2);
  assert.equal(lv("rain", { chanceV: 0.7, qpf: 0.25 }), 3); assert.equal(lv("rain", { chanceV: 0.69, qpf: 0.3 }), 2); assert.equal(lv("rain", { chanceV: 0.9, qpf: 0.24 }), 2);
});
check("wind, snow, heat and cold rule words match their tiers", () => {
  [[24.9, 0], [25, 1], [35, 2], [45, 3]].forEach(([g, l]) => assert.equal(lv("wind", { gust: g }), l));
  assert.match(L.TIER_RULE.wind[1], /25 mph/); assert.match(L.TIER_RULE.wind[2], /35 mph/); assert.match(L.TIER_RULE.wind[3], /45 mph/);
  [[0.049, 0], [0.05, 1], [0.3, 2], [1, 3]].forEach(([x, l]) => assert.equal(lv("snow", { sn: x }), l));
  assert.match(L.TIER_RULE.snow[1], /0\.05″/); assert.match(L.TIER_RULE.snow[2], /0\.3″/); assert.match(L.TIER_RULE.snow[3], /1″/);
  [[89, 0], [90, 1], [95, 2]].forEach(([x, l]) => assert.equal(lv("heat", { hi: x }), l)); assert.match(L.TIER_RULE.heat[1], /90°/); assert.match(L.TIER_RULE.heat[2], /95°/);
  [[33, 0], [32, 1], [20, 2]].forEach(([x, l]) => assert.equal(lv("cold", { feel: x }), l)); assert.match(L.TIER_RULE.cold[1], /32°/); assert.match(L.TIER_RULE.cold[2], /20°/);
  ["rain", "wind", "lightning", "snow", "heat", "cold"].forEach((k) => assert.equal(L.TIER_RULE[k].length, L.IMPLICATION[k].length, k + ": a rule and an implication per level"));
});
check("official alerts: none only after a successful check; warnings are urgent", () => {
  const ok = Object.assign([], { available: true }), off = Object.assign([], { available: false });
  assert.equal(L.official(ok, true).state, "none"); assert.equal(L.official(off, false).state, "unchecked");
  const a = L.official([{ event: "Flash Flood Warning" }, { event: "Wind Advisory" }, { event: "Winter Storm Watch" }], true);
  assert.equal(a.state, "active"); assert.deepEqual(a.urgent.map((x) => x.event), ["Flash Flood Warning"]); assert.deepEqual(a.other.map((x) => x.event), ["Wind Advisory", "Winter Storm Watch"]);
  const none = L.officialHtml({ official: L.official(ok, true) }, { tz: "America/New_York", lat: 39, lon: -84, checkedAt: Date.parse("2026-11-25T19:30Z") });
  assert.match(none, /No active official alerts/); assert.match(none, /doesn’t mean no weather concern/); assert.doesNotMatch(none, /No threats/i);
  const un = L.officialHtml({ official: L.official(off, false) }, { tz: "America/New_York", lat: 39, lon: -84, checkedAt: Date.parse("2026-11-25T19:30Z") });
  assert.match(un, /could not be checked \(2:30 PM\)/); assert.match(un, /Missing guidance/); assert.doesNotMatch(un, /No active official alerts/);
});
const H = 3600e3, t0 = Date.parse("2026-11-26T10:00Z"), tz = "America/New_York";
const phases = [["setup", "Setup", 0, 1.5], ["gates", "Gates", 1.5, 4], ["event", "Event", 4, 5.5], ["teardown", "Teardown", 5.5, 7]].map(([key, label, a, b]) => ({ key, label, startMs: t0 + a * H, endMs: t0 + b * H, r: {}, levels: {} }));
const b = { phases, all: { startMs: t0, endMs: t0 + 7 * H }, coverage: "full", top: null, concerns: [] };
const V = (missing = []) => ({ span: Array.from({ length: 7 }, (_, i) => t0 + i * H), hrs: Array.from({ length: 7 }, (_, i) => ({ ms: t0 + i * H, state: missing.includes(i) ? "nodata" : "ok", pop: missing.includes(i) ? null : 5, qpf: missing.includes(i) ? null : 0 })) });
check("missing guidance: thin sources and missing event hours limit confidence; full coverage does not", () => {
  const full = L.gaps({ b, V: V(), R: { state: "ready" }, feeds: { used: ["GFS", "ECMWF IFS", "NBM"], missing: [] }, now: t0 - 20 * H, tz });
  assert.equal(full.limited, false); assert.equal(full.short, "");
  const thin = L.gaps({ b, V: V([4, 5]), R: { state: "ready" }, feeds: { used: ["GFS"], missing: [{ name: "HRRR" }, { name: "NBM" }] }, now: t0 - 20 * H, tz });
  assert.equal(thin.limited, true); assert.equal(thin.thin, true); assert.equal(thin.missingHours.length, 2);
  assert.match(thin.short, /only 1 of 3 model sources/); assert.match(thin.short, /HRRR and NBM/); assert.match(thin.short, /2 event hours \(9–11 AM\) have no forecast data/);
});
check("headline: a quiet event says so for the event window; missing guidance is never an all-clear", () => {
  assert.equal(U.headline(b, "No weather concern for this event right now."), "No weather concern for your event window.");
  assert.equal(U.headline(b, "x", { limited: true }), "No concern found, but confidence is limited.");
  assert.equal(U.headline({ ...b, coverage: "partial" }, "No weather concern so far for setup.", { partial: true }), "No weather concern so far for setup.");
});
check("evidence: the forecast radar says plainly when it does not reach the concern's hour", () => {
  const at9 = Date.parse("2026-11-26T14:00Z");
  assert.equal(L.evidence({ tz, mapOk: true, hrrrEnd: at9 + H }, at9).radar.ok, true);
  assert.equal(L.evidence({ tz, mapOk: true, hrrrEnd: at9 - H }, at9).radar.note, "Forecast radar doesn’t reach 9 AM Thu yet; the charts use the model blend.");
  assert.match(L.evidence({ tz, mapOk: false, hrrrEnd: null }, at9).radar.note, /isn’t available for this venue/);
});
check("what would change: a quiet event names the next update, a missing-guidance event names what is missing", () => {
  const Sx = { ...S, nextUpdates: () => [{ name: "HRRR", at: t0 - 18 * H }], precipTiming: () => ({ rows: [] }) };
  const q = L.changes({ b, S: Sx, tz, ctx: {}, now: t0 - 20 * H }, { top: null, hit: [], evp: phases[2], G: { limited: false } });
  assert.match(q[0], /No part of the event reaches a planning threshold/); assert.match(q[0], /HRRR about/);
  const m = L.changes({ b, S: Sx, tz, ctx: {}, now: t0 - 20 * H }, { top: null, hit: [], evp: phases[2], G: { limited: true, thin: true, missing: [{ name: "HRRR" }, { name: "NBM" }], missingHours: [t0 + 4 * H], partial: null } });
  assert.match(m[0], /If HRRR and NBM answer/); assert.match(m[1], /no forecast data yet/);
  const w = L.changes({ b: { ...b, phases: phases.map((p, i) => ({ ...p, r: { gust: i === 0 ? 31 : 18 } })) }, S: Sx, tz, ctx: {}, now: t0 - 20 * H, limit: 30 }, { top: { key: "wind", label: "Wind", word: "Watch", level: 1, noun: "gusty wind", timing: {} }, hit: [phases[0]], evp: phases[2], G: { limited: false } });
  assert.match(w[0], /Your event’s gust limit is 30 mph and gusts reach up to 31 mph during setup/); assert.doesNotMatch(w.join(" "), /cancel|delay|postpone/i);
});
check("headline leads with the affected part and its local time; the verb follows the engine level", () => {
  const ev = { name: "Thanksgiving Day Race", tz }, B = (top) => ({ ...b, ev, top });
  assert.equal(U.headline(B({ key: "rain", noun: "rain", level: 3, from: t0 + H, to: t0 + 7 * H, phases: ["Gates", "Event"] }), "x"), "Rain likely through the 9 AM race start.");
  assert.equal(U.headline(B({ key: "rain", noun: "rain", level: 2, from: t0 + 4.5 * H, to: t0 + 6 * H, phases: ["Event"] }), "x"), "Plan for rain during the race, from 9:30 AM.");
  assert.equal(U.headline(B({ key: "wind", noun: "gusty wind", level: 1, from: t0, to: t0 + 2 * H, phases: ["Setup"] }), "x"), "Watch for gusty wind before the 9 AM race start.");
  assert.equal(U.headline({ ...B({ key: "rain", noun: "rain", level: 1, from: t0 + 6 * H, to: t0 + 7 * H }), ev: { name: "Riverfront Music Night", tz } }, "x"), "Watch for rain after the event, from 11 AM.");
  assert.equal(L.eventWord("Orlando City vs. visiting club"), "event"); assert.equal(L.eventWord("Thanksgiving Day Race"), "race");
});
check("missing race hours: forecast guidance when every variable is missing, rain guidance for the rain row", () => {
  const bb = { ...b, ev: { name: "Thanksgiving Day Race" } };
  const g = L.gaps({ b: bb, V: V([4, 5]), R: { state: "ready" }, feeds: { used: ["GFS", "NBM", "ECMWF IFS"], missing: [] }, now: t0 - 20 * H, tz });
  assert.equal(g.incomplete, "Forecast guidance is incomplete for the 9–11 AM race window");
  assert.equal(g.incompleteRain, "Rain guidance is incomplete for the 9–11 AM race window");
  assert.equal(U.headline(b, "No weather concern for this event right now.", { limited: true, incomplete: g.incomplete }), "Forecast guidance is incomplete for the 9–11 AM race window.");
  const lines = U.planLines({ items: [] }, b, { state: "ok", base: "Low" }, tz, (v) => v + "%", g.incomplete);
  assert.equal(lines[0].text, "Forecast guidance is incomplete for the 9–11 AM race window; no weather concern in the hours that have guidance.");
  /* only rain missing (other values present): rain wording everywhere */
  const Vr = V(); Vr.hrs = Vr.hrs.map((h, i) => (i === 4 ? { ...h, pop: null, qpf: null, gust: 12 } : { ...h, pop: 5, qpf: 0 }));
  const r = L.gaps({ b: bb, V: Vr, R: { state: "ready" }, feeds: { used: ["GFS"], missing: [] }, now: t0 - 20 * H, tz });
  assert.equal(r.incomplete, "Rain guidance is incomplete for the 9–10 AM race window"); assert.equal(r.incompleteRain, r.incomplete);
});
check("Watch for heavier rain: only when the heaviest hourly amounts fall in gates/lineup or within an hour of the start", () => {
  const bb = { ...b, ev: { name: "Thanksgiving Day Race", tz } }, Vq = (q) => ({ span: V().span, hrs: V().hrs.map((h, i) => ({ ...h, qpf: q[i] })) });
  assert.equal(L.heavier({ b: bb, V: Vq([0, 0.1, 0.12, 0.2, 0.2, 0.1, 0]), tz }), "heavier rain during lineup and around the 9 AM start.");
  assert.equal(L.heavier({ b: bb, V: Vq([0, 0.1, 0.25, 0.1, 0.1, 0.1, 0]), tz }), "heavier rain during lineup (6:30–9 AM).");
  assert.equal(L.heavier({ b: { ...bb, ev: { name: "Riverfront Music Night", tz } }, V: Vq([0, 0.1, 0.25, 0.1, 0.1, 0.1, 0]), tz }), "heavier rain during gates (6:30–9 AM).");
  assert.equal(L.heavier({ b: bb, V: Vq([0.3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]), tz }), null);
  assert.equal(L.heavier({ b: bb, V: Vq([0, 0, 0, 0, 0, 0, 0]), tz }), null);
});
check("Watch for: the organizer's gust limit when it applies; otherwise what to watch, never a policy", () => {
  const ph = phases.map((p, i) => ({ ...p, r: { gust: i === 0 ? 31 : 18 } }));
  assert.equal(L.watchFor({ b: { ...b, phases: ph }, tz, limit: 30 }, { top: { key: "wind", noun: "gusty wind" }, hit: [ph[0]], G: {} }), "gusts at or above your 30 mph limit during setup (now up to 31 mph).");
  assert.equal(L.watchFor({ b, tz }, { top: { key: "rain", noun: "rain", from: Date.parse("2026-11-26T11:00Z") }, hit: [], G: {} }), "the rain arriving earlier or later than 6 AM.");
  assert.equal(L.watchFor({ b, tz }, { top: null, hit: [], G: { limited: false } }), "any new rain, wind or thunder signal.");
  assert.equal(L.watchFor({ b, tz }, { top: null, hit: [], G: { limited: true, incomplete: "x" } }), "the gap filling in.");
});
console.log(`${n} event lead checks passed`);
