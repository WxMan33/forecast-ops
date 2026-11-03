/* Which capture slot a run belongs to, and how late it is. Pure functions (tested). */
"use strict";
const { Core, localParts, addDays } = require("./util.js");
const T = Core.time;

/* Target instant (UTC ms) of slot on local date d in tz. */
function targetMs(d, hm, tz) { return T.toUtc(`${d}T${hm}`, tz); }

/* Find the slot this run serves. Looks at targets on the local dates around now; picks the
   nearest one that started at most waitMax minutes in the future or lateMax in the past. */
function resolve(nowMs, tz, cfg) {
  const today = localParts(nowMs, tz).date, cands = [];
  [addDays(today, -1), today, addDays(today, 1)].forEach((d) => cfg.slots.forEach((s) => {
    const t = targetMs(d, s.local, tz); cands.push({ slot: s.id, localDate: d, target: t, delayMin: (nowMs - t) / 60e3 });
  }));
  const usable = cands.filter((c) => c.delayMin >= -cfg.waitBeforeTargetMaxMin && c.delayMin <= cfg.lateMaxMin).sort((a, b) => Math.abs(a.delayMin) - Math.abs(b.delayMin));
  if (!usable.length) {
    const prev = cands.filter((c) => c.delayMin > 0).sort((a, b) => a.delayMin - b.delayMin)[0];
    return { slot: null, reason: "no slot within window", nearestPast: prev || null };
  }
  const c = usable[0];
  return { ...c, captureId: `${c.localDate}_${c.slot}`, waitMs: c.delayMin < 0 ? -c.delayMin * 60e3 : 0 };
}
/* Timeliness of a capture that STARTED at startMs. */
function timeliness(startMs, target, cfg) {
  const d = (startMs - target) / 60e3;
  if (d < -1) return { status: "early", delayMin: d };
  if (d <= cfg.onTimeMaxMin) return { status: "on_time", delayMin: d };
  if (d <= cfg.lateMaxMin) return { status: "late", delayMin: d };
  return { status: "off_schedule", delayMin: d };
}
/* A slot already has a usable capture (failed attempts don't block a retry). */
/* scheduled trigger: skip if any usable capture exists; backup trigger: retry only if the edition is
   still incomplete (no capture with every source ok). Extra captures never add weight: scoring keeps
   one capture per edition and source (lib/editions.js). */
const editionOf = (c) => c.edition || c.captureId;
const alreadyCaptured = (caps, edition, trigger = "scheduled") => caps.some((c) => editionOf(c) === edition && (trigger === "backup" ? c.outcome === "ok" : c.outcome !== "failed"));
/* each attempt has its own capture id: the edition id for the first, then _a2, _a3 ... */
const attemptId = (caps, edition) => { const n = caps.filter((c) => editionOf(c) === edition).length; return n ? `${edition}_a${n + 1}` : edition; };
module.exports = { targetMs, resolve, timeliness, alreadyCaptured, attemptId, editionOf };
