/* Scheduled editions and the one-capture-per-edition rule.
   An EDITION is (location, local date, slot), e.g. CVG 2026-11-04 midday. Only scheduled and backup
   triggers produce edition captures; manual captures are pilot evidence and never enter primary
   scorecards.
   COLLECTION WINDOW: an edition is a collection window, not a pre-target cutoff. Its target T is the
   window's START (the collector waits for T, so nothing is retrieved before it); a source retrieval is
   ON TIME if T <= retrieval <= T + onTimeMaxMin (15 min). Data a provider publishes inside that window
   can therefore be included; every pair keeps its actual retrieval time and delay so this is visible.
   A retrieval before T (clock skew) is "early" and not eligible.
   SELECTION RULE (per edition and per source/product): among captures of that edition in which the
   source succeeded, take the earliest on-time retrieval; if none is on time, take the earliest
   retrieval at/after T and label it by its own lateness. Exactly one capture per source per edition is ever scored, so retries and backup
   triggers cannot multiply a forecast's influence. Blends use the same rule on the capture's last
   retrieval time (a blend is only as timely as its latest input). */
"use strict";
const SCHED = require("../config/schedule.js");
const VERSION = "editions-v1";
const isEdition = (cap) => cap && cap.slot !== "manual" && (cap.trigger === "scheduled" || cap.trigger === "backup");
const editionId = (cap) => cap.edition || cap.captureId;
function lateness(retrievedIso, targetIso) {
  if (!retrievedIso || !targetIso) return { status: "unknown", delayMin: null };
  const d = (Date.parse(retrievedIso) - Date.parse(targetIso)) / 60e3;
  return { status: d < 0 ? "early" : d <= SCHED.onTimeMaxMin ? "on_time" : d <= SCHED.lateMaxMin ? "late" : "off_schedule", delayMin: Math.round(d * 10) / 10 };
}
/* items: [{edition, key (source/product id), captureId, retrievedAt, target}] -> Map key "edition|key|captureId" -> {selected, timeliness} */
function select(items) {
  const groups = new Map(), out = new Map();
  items.forEach((it) => { const g = `${it.edition}|${it.key}`; (groups.get(g) || groups.set(g, []).get(g)).push({ ...it, tl: lateness(it.retrievedAt, it.target) }); });
  groups.forEach((list) => {
    const ok = list.filter((x) => x.retrievedAt).sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt));
    const pick = ok.find((x) => x.tl.status === "on_time") || ok.find((x) => x.tl.status !== "early") || null;
    list.forEach((x) => out.set(`${x.edition}|${x.key}|${x.captureId}`, { selected: pick === x, timeliness: x.tl, alternatives: list.length - 1 }));
  });
  return out;
}
/* Edition health: what the collector EXECUTED vs whether the edition was CAPTURED within the window. */
function health(caps, runs, slotsExpected) {
  return slotsExpected.map((s) => {
    const mine = caps.filter((c) => isEdition(c) && editionId(c) === s.id);
    const execs = runs.filter((r) => r.job === "collect" && (r.captureId === s.id || (r.outcome === "not-due" && r.slotNear === s.id)));
    const per = {}; mine.forEach((c) => Object.values(c.sources || {}).forEach((x) => { if (x.status !== "ok") return; const tl = lateness(x.retrievedAt, c.slotTarget).status; if (!per[x.id] || per[x.id] !== "on_time") per[x.id] = tl; }));
    const st = Object.values(per), allSrc = mine.length ? Object.keys(mine[0].sources || {}).length : 0;
    const edition = !mine.length ? (s.future ? "pending" : "missed")
      : !st.length ? "failed"
      : st.every((x) => x === "on_time") && st.length === allSrc ? "captured_on_time"
      : st.some((x) => x === "on_time") ? "captured_partly_on_time"
      : st.some((x) => x === "late") ? "captured_late" : "captured_off_schedule";
    return { id: s.id, target: s.target, edition, attempts: mine.length, collectorRuns: execs.length, sourcesOnTime: st.filter((x) => x === "on_time").length, sourcesCaptured: st.length, sourcesExpected: allSrc,
      firstStart: mine.length ? mine.map((c) => c.startedAt).sort()[0] : null };
  });
}
module.exports = { VERSION, isEdition, editionId, lateness, select, health };
