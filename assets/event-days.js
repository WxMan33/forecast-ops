/* Multi-day events, one day at a time (Event Manager).
   An event whose schedule touches more than one local date is briefed per day: the planner picks a day and the whole
   briefing (lead, callouts, At a glance, hour by hour, next check, printout) is computed for that day's scheduled time
   only, by the same engines, from the same loaded guidance. Nothing here changes a value, weight or threshold.

   Which day a part of the schedule belongs to:
   - a slot of 24 hours or less is kept whole (a 9 PM to 3 AM night market is one piece); a longer slot (an older
     stadium-style "Event 10 AM Fri to 6 PM Sun") is split at each local midnight, keeping the slot's name;
   - pieces then group into days in time order: a piece joins the current day when it follows within 6 hours and the
     day stays within 24 hours (an overnight show whose teardown starts after midnight is one day); a new day starts
     after overnight downtime (a gap of 6 hours or more into a later date) or when a long event passes 24 hours. Two
     sessions on the same date always share that day. A day is named by the date it starts.
   Overnight downtime between one day's last slot and the next day's first is not scheduled time, so it is in no
   day's totals (the slot model already leaves gaps out of the totals).

   Default day: the next scheduled day, i.e. the first day whose scheduled time has not all passed; once every day has
   passed, the last day. */
(function (root) {
  "use strict";
  const H = 3600e3;
  const nextDate = (d) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
  const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

  /* the schedule as dated pieces: [{ date, s, e, name, id, main, fold?, split }] in time order */
  function pieces(C, ev) {
    if (!ev || !ev.tz) return [];
    const slots = C.event.slotsOf(ev); if (!slots.length) return [];
    const out = [];
    C.event.slotList({ ...ev, slots }).forEach((x) => {
      if (!(x.endMs > x.startMs)) return;
      const base = { name: String(x.name || "Event").trim() || "Event", id: String(x.id || `slot${x.i}`), main: !!x.main };
      if (x.endMs - x.startMs <= 24 * H) { out.push({ ...base, date: C.time.toLocal(x.startMs, ev.tz).slice(0, 10), s: x.startMs, e: x.endMs, fold: x.fold, split: false }); return; }
      let s = x.startMs;
      while (s < x.endMs) {
        const d = C.time.toLocal(s, ev.tz).slice(0, 10), mid = C.time.toUtc(`${nextDate(d)}T00:00`, ev.tz), e = Math.min(x.endMs, mid > s ? mid : x.endMs);
        out.push({ ...base, id: `${base.id}-${d}`, date: d, s, e, split: true }); s = e;
      }
    });
    return out.sort((a, b) => a.s - b.s || a.e - b.e);
  }
  /* the days of the schedule: [{ date, label, startMs, endMs, pieces }] */
  const GAP = 6 * H, SPAN = 24 * H;
  function days(C, ev) {
    const groups = [];
    pieces(C, ev).forEach((p) => {
      const g = groups[groups.length - 1];
      const joins = g && (p.date === g.date || (p.s - g.endMs < GAP && Math.max(g.endMs, p.e) - g.startMs <= SPAN));
      if (joins) { g.pieces.push(p); g.endMs = Math.max(g.endMs, p.e); return; }
      const same = groups.find((x) => x.date === p.date); // a later piece dated to a day already open (rare): that day
      if (same) { same.pieces.push(p); same.endMs = Math.max(same.endMs, p.e); return; }
      groups.push({ date: p.date, startMs: p.s, endMs: p.e, pieces: [p] });
    });
    return groups.map((g) => ({ date: g.date, label: dayLabel(g.date), startMs: g.startMs, endMs: g.endMs, pieces: g.pieces }));
  }
  const isMultiDay = (C, ev) => days(C, ev).length > 1;
  /* the next scheduled day: the first with time still ahead; after the last day, the last */
  function defaultDay(list, now) { if (!list.length) return null; const d = list.find((x) => x.endMs > now); return (d || list[list.length - 1]).date; }
  /* the planner's event reduced to one day's scheduled time, as planner-defined slots (names kept). The id stays the
     event's own (saving and sharing use the full event); dayKey identifies this day for briefing history. */
  function dayEvent(C, ev, date) {
    const list = days(C, ev), i = list.findIndex((x) => x.date === date); if (i < 0) return null;
    const d = list[i], loc = (ms) => C.time.toLocal(ms, ev.tz).slice(0, 16);
    const slots = d.pieces.map((p) => ({ id: p.id, name: p.name, start: loc(p.s), end: loc(p.e), ...(p.main ? { main: true } : {}), ...(!p.split && p.fold && Object.keys(p.fold).length ? { fold: p.fold } : {}) }));
    const out = { ...ev, slots, times: { start: slots[0].start, end: slots.reduce((m, x) => (x.end > m ? x.end : m), slots[0].end) }, day: { date, label: d.label, index: i, count: list.length } };
    delete out.fold;
    out.dayKey = `${ev.id || "event"}@${date}`;
    return out;
  }
  /* one line per day for the picker, from the same briefing engine: what that day's concern is (and when, and which
     slots), or that there is none, or how much of the day the hourly guidance reaches. Never "no concern" for hours
     without guidance. */
  function status(C, S, ctx, ev, date, thr, tz) {
    const de = dayEvent(C, ev, date); if (!de) return null;
    const b = S.eventBrief(ctx, de, thr); if (b.error) return { date, state: "error", text: b.error };
    const R = S.readiness(b, ctx), top = b.top;
    const clock = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: tz || ev.tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms)).replace(":00", "");
    const span = (a, z) => { const x = clock(a), y = clock(z), ax = x.split(" "), ay = y.split(" "); return ax[1] && ax[1] === ay[1] ? `${ax[0]}–${y}` : `${x}–${y}`; };
    if (R.state === "past") return { date, state: "past", text: "Done", tier: null };
    if (R.state === "pending") return { date, state: "pending", text: "Not in the hourly forecast yet", tier: null, cover: "none" };
    const cover = R.state === "partial" ? "part" : "all";
    if (top) return { date, state: "concern", tier: top.tier, cover, text: `${top.label}: ${top.word.toLowerCase()}${top.from != null ? ` ${span(top.from, top.to)}` : ""}`, slots: top.phases.slice(), key: top.key };
    return { date, state: "clear", tier: null, cover, text: cover === "part" ? "No concern in the hours covered so far" : "No concern found" };
  }
  const api = { pieces, days, isMultiDay, defaultDay, dayEvent, status, dayLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventDays = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
