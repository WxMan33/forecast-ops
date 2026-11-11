/* Hourly forecast model: the data behind the shared hourly grid (Model Blend and the Event Manager briefing).
   Nothing here is a new calculation or threshold. Values come from C.blend.windowRow over one hour (the same call the
   daily table, event table and briefing make); event concerns come from BetaStory's hazard rules and levels exactly as
   the briefing uses them; thunder uses the Thunder page's hourly tier. This file only arranges those values by hour and
   marks what is missing. Pure: no DOM, Node-testable. Presentation lives in hourly-grid.js. */
(function (root) {
  "use strict";
  const H = 3600e3;
  const fin = (x) => typeof x === "number" && Number.isFinite(x);

  /* every hour that touches [s, e): from the hour containing s to the hour containing the last instant before e */
  function spanHours(s, e) {
    const out = []; if (!(e > s)) return out;
    for (let m = Math.floor(s / H) * H; m < e; m += H) out.push(m);
    return out;
  }

  /* local labels for an hour axis. A local time that happens twice (fall back) or a zone change shows the zone, so the
     two 1 AM hours read "1 AM EDT" and "1 AM EST"; the first hour and every local midnight carry the date. */
  function zoneOf(ms, tz) {
    try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName").value; } catch (e) { return ""; }
  }
  function axis(C, msList, tz) {
    const local = msList.map((m) => C.time.toLocal(m, tz)), seen = {};
    local.forEach((l) => { seen[l] = (seen[l] || 0) + 1; });
    return msList.map((ms, i) => {
      const l = local[i], hr = +l.slice(11, 13), date = l.slice(0, 10), zone = zoneOf(ms, tz);
      const prevZone = i ? zoneOf(msList[i - 1], tz) : zone;
      const newDay = i === 0 || local[i - 1].slice(0, 10) !== date;
      return { ms, local: l, date, hour: hr, newDay, zone, repeated: seen[l] > 1, zoneChange: i > 0 && zone !== prevZone,
        hourText: hr === 0 ? "12 AM" : hr === 12 ? "Noon" : `${hr % 12} ${hr < 12 ? "AM" : "PM"}`,
        showZone: seen[l] > 1 || (i > 0 && zone !== prevZone) || i === 0 };
    });
  }

  /* blend values for one hour: windowRow over that hour, plus what is missing. state: "ok" | "beyond" (outside the loaded
     hours) | "nodata" (inside the hours, but no weighted source has a value). */
  function blendHour(C, B, ws, opts, ms, ix, th) {
    const i = ix ? ix.get(ms) : B.ms.indexOf(ms);
    if (i == null || i < 0) return { ms, state: "beyond", thunder: null };
    const r = C.blend.windowRow(B, ws, [i], [i], opts);
    const val = { temp: r.hi, tempR: r.hiR, feel: r.feel, pop: r.pop, qpf: r.qpf, sn: r.sn, wind: r.wind, gust: r.gust, chance: r.chance ? r.chance.v / 100 : null, chanceInfo: r.chance || null };
    const has = ["temp", "feel", "pop", "qpf", "wind", "gust"].some((k) => fin(val[k]));
    return { ms, i, state: has ? "ok" : "nodata", ...val, n: r.contrib.length, contrib: r.contrib, parts: r.parts, prorated: r.prorated, thunder: th ? th.at(ms) : null };
  }
  /* th: optional {at(ms) -> thunder tier} (BetaStory.context's thunder, the Thunder page's hourly assessment) */
  function blendHours(C, B, ws, opts, msList, th = null) {
    const ix = new Map(B.ms.map((m, i) => [m, i]));
    return msList.map((m) => blendHour(C, B, ws, opts, m, ix, th));
  }

  /* which phases each hour overlaps, and where inside the hour a phase starts or ends (a 7:30 gates time starts halfway
     through the 7 PM hour). phases: [{key, label, startMs, endMs}] */
  function phaseCover(msList, phases) {
    return msList.map((ms) => {
      const e = ms + H;
      return phases.filter((p) => p.startMs < e && p.endMs > ms).map((p) => {
        const a = Math.max(p.startMs, ms), b = Math.min(p.endMs, e);
        return { key: p.key, label: p.label, from: (a - ms) / 60e3, to: (b - ms) / 60e3, starts: p.startMs > ms && p.startMs < e, ends: p.endMs > ms && p.endMs < e, fraction: (b - a) / H };
      });
    });
  }

  /* event concerns by hour, from the briefing's own engine (BetaStory):
     - an hour is flagged for a hazard by that hazard's hourly rule (HAZARDS[k].hour, with the venue's gust limit);
     - its severity is the level the engine gave the phase(s) the hour falls in (HAZARDS[k].level on the phase row,
       worded with LEVEL_WORD and coloured by LEVEL_TIER); lightning uses the Thunder page's tier for that hour;
     - a flagged hour in a phase the engine rates Low stays unshaded and says so; no level is invented;
     - an hour without guidance (beyond the loaded hours, or no source) is "missing", never "no concern".
     Returns rows only for hazards the engine flags somewhere, plus a summary row. */
  function eventConcerns(S, C, brief, hours, thr) {
    const RANK = { nodata: -1, normal: 0, monitor: 1, prepare: 2, action: 3 };
    const covered = (h) => h.state === "ok";
    const phasesAt = (ms) => brief.phases.filter((p) => p.r && p.startMs < ms + H && p.endMs > ms);
    const rows = [];
    Object.entries(S.HAZARDS).sort((a, b) => a[1].order - b[1].order).forEach(([key, hz]) => {
      const cells = hours.map((h) => {
        if (!covered(h)) return { state: "missing", why: h.state === "beyond" ? "Beyond the hourly guidance" : "No guidance for this hour" };
        if (key === "lightning") {
          if (!h.thunder || h.thunder === "nodata") return { state: "missing", why: "Thunder guidance unavailable for this hour" };
          const r = RANK[h.thunder] ?? 0;
          return r >= 1 ? { state: "concern", tier: h.thunder, word: C.TIERS[h.thunder].word.charAt(0) + C.TIERS[h.thunder].word.slice(1).toLowerCase(), why: `Thunder signal ${C.TIERS[h.thunder].word.toLowerCase()} this hour (Thunder page tier)`, source: "hour" }
            : { state: "clear" };
        }
        if (!hz.hour(h, thr)) return { state: "clear" };
        const ph = phasesAt(h.ms), lvl = Math.max(0, ...ph.map((p) => p.levels[key] || 0));
        if (lvl >= 1) return { state: "concern", tier: S.LEVEL_TIER[lvl], level: lvl, word: S.LEVEL_WORD[lvl], why: `${hz.label} meets its hourly rule; ${ph.filter((p) => (p.levels[key] || 0) === lvl).map((p) => p.label).join(" and ")} rated ${S.LEVEL_WORD[lvl].toLowerCase()}`, source: "phase" };
        return { state: "flag", why: ph.length ? `${hz.label} meets its hourly rule; ${ph.map((p) => p.label).join(" and ")} rated low` : `${hz.label} meets its hourly rule outside the event's phases`, source: "rule" };
      });
      if (cells.some((c) => c.state === "concern" || c.state === "flag")) rows.push({ key, label: hz.label, cells });
    });
    /* summary: the strongest classification in each hour and how many hazards overlap; missing stays missing */
    const summary = hours.map((h, i) => {
      if (!covered(h)) return { state: "missing", why: h.state === "beyond" ? "Beyond the hourly guidance" : "No guidance for this hour" };
      const hits = rows.map((r) => ({ r, c: r.cells[i] })).filter((x) => x.c.state === "concern" || x.c.state === "flag");
      if (!hits.length) {
        const partial = rows.some((r) => r.cells[i].state === "missing") || (S.HAZARDS.lightning && (!h.thunder || h.thunder === "nodata"));
        return partial ? { state: "partial", why: "No concern identified in the guidance available; thunder guidance is missing for this hour" } : { state: "clear", why: "No concern identified" };
      }
      const worst = hits.filter((x) => x.c.state === "concern").sort((a, b) => (RANK[b.c.tier] ?? 0) - (RANK[a.c.tier] ?? 0))[0];
      return { state: worst ? "concern" : "flag", tier: worst ? worst.c.tier : null, word: worst ? worst.c.word : "Low", count: hits.length, keys: hits.map((x) => x.r.key),
        why: hits.map((x) => `${x.r.label}: ${x.c.word || "low"}`).join(" · ") };
    });
    return { rows, summary };
  }

  /* hours to show for an event: setup through teardown, aligned to whole hours */
  function eventSpan(brief) {
    const ph = brief.phases.length ? brief.phases : [brief.all];
    return spanHours(Math.min(...ph.map((p) => p.startMs)), Math.max(...ph.map((p) => p.endMs)));
  }
  /* a Blend window: next N hours from the current hour, or a custom [s, e) */
  function blendSpan(now, hoursAhead, custom) {
    if (custom && fin(custom.s) && fin(custom.e) && custom.e > custom.s) return spanHours(custom.s, custom.e);
    const s = Math.floor(now / H) * H; return spanHours(s, s + hoursAhead * H);
  }

  const api = { H, spanHours, axis, zoneOf, blendHour, blendHours, phaseCover, eventConcerns, eventSpan, blendSpan };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HourlyModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
