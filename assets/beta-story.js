/* Beta weather story: one shared reading of the guidance for the Meteorologist and Event Manager betas.
   Nothing here is a new forecast method. Values come from the same loaders, blend recipe and
   C.blend.windowRow aggregation as Model Blend and the decision briefing; precipitation timing uses
   ModelTrends.timing (the briefing's per-model windows); thunder uses C.thunder.hourly (Thunder page).
   The functions below only select, rank and word those values. Pure: no DOM, Node-testable. */
(function (root) {
  "use strict";
  const H = 3600e3;
  const fin = (x) => typeof x === "number" && Number.isFinite(x);
  /* 5-point steps; a small but real chance (under 2.5%) reads "<5%", never 0% */
  const formatPrecipPercent = (x) => { if (!fin(x)) return "—"; const r = Math.round(x / 5) * 5; return r === 0 && x > 0 ? "<5%" : `${r}%`; };
  /* lightning potential in plain words, from the Thunder page's own tiers (thresholds unchanged):
     LOW -> Low (not zero), MARGINAL and ELEVATED -> Moderate, HIGH -> High; no data -> Unavailable */
  const LIGHTNING_WORD = { normal: "Low", monitor: "Moderate", prepare: "Moderate", action: "High" };
  const lightningWord = (tier) => LIGHTNING_WORD[tier] || "Unavailable";
  const RANK = { nodata: -1, normal: 0, monitor: 1, prepare: 2, action: 3 };

  /* Hazard rules. Thresholds are display defaults for planning conversations, not calibrated
     probabilities; each level says why it was reached. Level: 0 none, 1 watch, 2 plan for it, 3 likely disruptive. */
  const HAZARDS = {
    lightning: { label: "Lightning", noun: "thunderstorms", order: 0,
      level: (r) => Math.max(0, RANK[r.thunder] ?? 0),
      hour: (h) => (RANK[h.thunder] ?? 0) >= 1,
      why: (r) => `Thunder signal ${({ 1: "marginal", 2: "elevated", 3: "high" })[RANK[r.thunder]] || "low"} in model guidance` },
    wind: { label: "Wind", noun: "gusty wind", order: 1,
      level: (r) => (!fin(r.gust) ? 0 : r.gust >= 45 ? 3 : r.gust >= 35 ? 2 : r.gust >= 25 ? 1 : 0),
      hour: (h, t) => fin(h.gust) && h.gust >= (t.gust || 25),
      why: (r) => `Peak gust near ${Math.round(r.gust)} mph` },
    rain: { label: "Rain", noun: "rain", order: 2,
      level: (r) => { const c = r.chanceV, q = r.qpf ?? 0; if (fin(c) && c >= 0.7 && q >= 0.25) return 3; if ((fin(c) && c >= 0.5) || q >= 0.1) return 2; if ((fin(c) && c >= 0.2) || q >= 0.02) return 1; return 0; },
      hour: (h) => (fin(h.qpf) && h.qpf >= 0.01) || (fin(h.pop) && h.pop >= 40),
      why: (r) => `Rain in the forecast${fin(r.qpf) && r.qpf >= 0.005 ? `, about ${r.qpf.toFixed(2)}″ in total` : ""}` },
    snow: { label: "Snow", noun: "snow", order: 3,
      level: (r) => (!fin(r.sn) ? 0 : r.sn >= 1 ? 3 : r.sn >= 0.3 ? 2 : r.sn >= 0.05 ? 1 : 0),
      hour: (h) => fin(h.sn) && h.sn >= 0.05,
      why: (r) => `Model snowfall about ${r.sn.toFixed(1)}″ (ground accumulation may differ)` },
    heat: { label: "Heat", noun: "heat", order: 4,
      level: (r) => (!fin(r.hi) ? 0 : r.hi >= 95 ? 2 : r.hi >= 90 ? 1 : 0),
      hour: (h) => fin(h.temp) && h.temp >= 90,
      why: (r) => `High near ${Math.round(r.hi)}°` },
    cold: { label: "Cold", noun: "cold", order: 5,
      level: (r) => (!fin(r.feel) ? 0 : r.feel <= 20 ? 2 : r.feel <= 32 ? 1 : 0),
      hour: (h) => fin(h.feel) && h.feel <= 32,
      why: (r) => `Feels like ${Math.round(r.feel)}° at the coldest` },
  };
  const LEVEL_WORD = ["Low", "Watch", "Plan for it", "Likely disruptive"];
  const LEVEL_TIER = ["normal", "monitor", "prepare", "action"];

  /* ---------- context: one loaded data set, the blend recipe and thunder ---------- */
  function context({ C, T, B, ws, rules, TH = null, thWs = null, meta = {}, nws = null, now = Date.now() }) {
    const opts = { rules };
    const ix = new Map(B.ms.map((m, i) => [m, i]));
    let th = null;
    if (TH && !TH.empty && thWs) {
      const r = C.thunder.hourly(TH, thWs), tix = new Map(TH.ms.map((m, i) => [m, i]));
      th = { r, at: (ms) => { const k = tix.get(ms); return k == null ? null : r.assess[k].tier; }, perModel: (id, ms) => { const k = tix.get(ms); return k == null || !r.perModel[id] ? null : r.perModel[id][k].tier; }, ids: r.ids };
    }
    return { C, T, B, ws, rules, opts, ix, th, meta, nws, now, tz: B.tz };
  }
  /* blend values for [s, e): the same call Model Blend's event table and the briefing make */
  function windowRow(ctx, s, e) {
    const { C, B } = ctx, idx = [], acc = [];
    B.ms.forEach((m, i) => { if (m >= s && m < e) idx.push(i); if (m > s && m <= e) acc.push(i); });
    if (!idx.length) return null;
    const r = C.blend.windowRow(B, ctx.ws, idx, acc, ctx.opts);
    const tiers = ctx.th ? idx.map((i) => ctx.th.at(B.ms[i])).filter(Boolean) : [];
    const thunder = tiers.length ? tiers.reduce((a, b) => ((RANK[b] ?? -1) > (RANK[a] ?? -1) ? b : a), "nodata") : null;
    const complete = idx.length === Math.round((e - s) / H);
    return { ...r, s, e, idx, acc, thunder, chanceV: r.chance ? r.chance.v / 100 : null, complete };
  }
  /* an event phase located exactly as Model Blend's event table locates it (Core.event.locate), so short
     phases such as a 30-minute gates window still get the hour that covers them */
  function phaseRow(ctx, w) {
    const { C, B } = ctx, L = C.event.locate(w, { ms: B.ms });
    if (!L.idx.length && !L.acc.length) return null;
    const idx = L.idx.length ? L.idx : L.acc, r = C.blend.windowRow(B, ctx.ws, idx, L.acc, ctx.opts);
    /* a planner's slot: precipitation chance and gusts are hour-ending values (Core.event.KIND), so they come from the
       hours whose hour overlaps the slot, the same hours as its rain amount; the fixed parts are read as before */
    if (w.slot && L.acc.length) { const q = C.blend.windowRow(B, ctx.ws, L.acc, L.acc, ctx.opts); r.pop = q.pop; r.gust = q.gust; }
    const tiers = ctx.th ? idx.map((i) => ctx.th.at(B.ms[i])).filter(Boolean) : [];
    const thunder = tiers.length ? tiers.reduce((a, b) => ((RANK[b] ?? -1) > (RANK[a] ?? -1) ? b : a), "nodata") : null;
    return { ...r, s: w.startMs, e: w.endMs, idx, acc: L.acc, thunder, chanceV: r.chance ? r.chance.v / 100 : null, complete: L.acc.length >= L.need };
  }
  /* hour-by-hour blend over [s, e): every value is windowRow over that single hour */
  function hourly(ctx, s, e) {
    const out = [];
    ctx.B.ms.forEach((m, i) => {
      if (m < s || m >= e) return;
      const r = ctx.C.blend.windowRow(ctx.B, ctx.ws, [i], [i], ctx.opts);
      out.push({ ms: m, i, temp: r.hi, tempR: r.hiR, qpf: r.qpf, pop: r.pop, chance: r.chance ? r.chance.v / 100 : null, gust: r.gust, sn: r.sn, feel: r.feel, n: r.contrib.length, thunder: ctx.th ? ctx.th.at(m) : null });
    });
    return out;
  }

  /* ---------- model disagreement over [s, e) ---------- */
  const PRECIP_SOURCES = (B) => Object.entries(B.models).filter(([id, m]) => m.kind !== "nws");
  function precipTiming(ctx, s, e) {
    const rows = PRECIP_SOURCES(ctx.B).map(([id, md]) => ({ id, ...ctx.T.timing(md, ctx.B.ms, s, e) }));
    const usable = rows.filter((t) => t.status !== "limited" && t.status !== "intervals");
    const wet = usable.filter((t) => t.status === "wet" || (t.status === "ensemble" && !t.partial && t.wet >= t.members / 2));
    const onsets = wet.filter((t) => !t.onsetClipped && fin(t.onset)).map((t) => t.onset);
    const active = wet.filter((t) => t.onsetClipped).length;
    return { rows, usable: usable.length, wet: wet.length, onsets, active, spreadH: onsets.length > 1 ? (Math.max(...onsets) - Math.min(...onsets)) / H : 0,
      first: onsets.length ? Math.min(...onsets) : null, last: onsets.length ? Math.max(...onsets) : null };
  }
  /* precipitation timing over an event with gaps between its slots: each source's timing is read slot span by slot
     span (the same ModelTrends.timing call), and its onset is the first span where it is wet; a source dry in every span
     keeps its first usable answer. Hours in the gaps are never read. One span: exactly precipTiming. */
  function precipTimingIn(ctx, spans, s, e) {
    const parts = spans.map((x) => ({ s: Math.max(x.s, s), e: Math.min(x.e, e) })).filter((x) => x.e > x.s);
    if (parts.length <= 1) return precipTiming(ctx, parts.length ? parts[0].s : s, parts.length ? parts[0].e : e);
    const wetLike = (t) => t.status === "wet" || (t.status === "ensemble" && !t.partial && t.wet >= t.members / 2);
    const rows = PRECIP_SOURCES(ctx.B).map(([id, md]) => { const per = parts.map((x) => ctx.T.timing(md, ctx.B.ms, x.s, x.e));
      const pick = per.find(wetLike) || per.find((t) => t.status !== "limited" && t.status !== "intervals") || per[0]; return { id, ...pick }; });
    const usable = rows.filter((t) => t.status !== "limited" && t.status !== "intervals");
    const wet = usable.filter(wetLike);
    const onsets = wet.filter((t) => !t.onsetClipped && fin(t.onset)).map((t) => t.onset);
    const active = wet.filter((t) => t.onsetClipped).length;
    return { rows, usable: usable.length, wet: wet.length, onsets, active, spreadH: onsets.length > 1 ? (Math.max(...onsets) - Math.min(...onsets)) / H : 0,
      first: onsets.length ? Math.min(...onsets) : null, last: onsets.length ? Math.max(...onsets) : null };
  }
  function disagreement(ctx, s, e) {
    const r = windowRow(ctx, s, e); if (!r) return null;
    const hiSpread = fin(r.hiR[0]) && fin(r.hiR[1]) ? r.hiR[1] - r.hiR[0] : null;
    const temp = { word: r.ag.word, range: r.ag.range ?? null, p10: r.hiR[0], p90: r.hiR[1], spread: hiSpread, n: r.ag.n,
      level: hiSpread == null ? null : hiSpread <= 3 ? "agree" : hiSpread <= 6 ? "some" : "split" };
    const pt = precipTiming(ctx, s, e);
    const precip = { wet: pt.wet, of: pt.usable, qpfR: r.qpfR, chance: r.chanceV,
      level: !pt.usable ? null : pt.wet === 0 || pt.wet === pt.usable ? "agree" : Math.min(pt.wet, pt.usable - pt.wet) / pt.usable <= 0.25 ? "some" : "split" };
    const timing = { spreadH: pt.spreadH, n: pt.onsets.length, first: pt.first, last: pt.last, active: pt.active,
      level: pt.onsets.length < 2 ? null : pt.spreadH <= 2 ? "agree" : pt.spreadH <= 5 ? "some" : "split" };
    const worst = ["split", "some", "agree"].find((l) => [temp.level, precip.level, timing.level].includes(l)) || null;
    return { row: r, temp, precip, timing, overall: worst };
  }
  const AGREE_WORD = { agree: "Models agree", some: "Some disagreement", split: "Models split" };

  /* ---------- guidance age (Open-Meteo run metadata, same source as Model Blend's run cells) ---------- */
  function guidanceAge(ctx, names = {}) {
    const out = [];
    Object.entries(ctx.meta || {}).forEach(([id, m]) => {
      if (!ctx.B.models[id] || !m || m.error || !m.lastRunInit) return;
      const init = Date.parse(m.lastRunInit), age = (ctx.now - init) / H, every = m.updateIntervalH || null;
      const expect = every ? every + (every <= 1 ? 2.5 : 7) : null; // run interval plus typical availability delay
      const unknown = every != null && age > Math.max(72, every * 6); // provider metadata not updating; the data itself may be current
      out.push({ id, name: names[id] || id, init, ageH: age, every, available: m.lastRunAvailable ? Date.parse(m.lastRunAvailable) : null, late: !unknown && expect != null && age > expect + 1, unknown });
    });
    if (ctx.nws && ctx.nws.ok && ctx.nws.status && ctx.nws.status.ageH) {
      const a = ctx.nws.status.ageH.grid ?? ctx.nws.status.ageH.forecast;
      if (fin(a)) out.push({ id: "nws", name: names.nws || "NWS point forecast", init: ctx.now - a * H, ageH: a, every: null, late: !!(ctx.nws.status.stale && (ctx.nws.status.stale.grid || ctx.nws.status.stale.forecast)), nws: true });
    }
    return out.sort((a, b) => a.ageH - b.ageH);
  }
  /* next times a major global model and the hourly HRRR are expected to publish, from their own metadata */
  function nextUpdates(ctx, names = {}) {
    const pick = ["ecmwf_ifs025", "gfs_seamless", "gfs_hrrr"], out = [];
    pick.forEach((id) => { const m = (ctx.meta || {})[id]; if (!m || m.error || !m.lastRunAvailable || !m.updateIntervalH) return;
      let t = Date.parse(m.lastRunAvailable); while (t <= ctx.now) t += m.updateIntervalH * H;
      out.push({ id, name: names[id] || id, at: t, every: m.updateIntervalH }); });
    return out.sort((a, b) => a.at - b.at);
  }

  /* ---------- event briefing ---------- */
  /* per-source first hour meeting a hazard's hourly rule inside [s, e): the timing spread across guidance */
  function hazardTiming(ctx, key, s, e, thr, spans = null) {
    /* planner-defined slots (spans): each hour is read by its own interval (Core.event.KIND); a value outside every slot
       is not event time, and an hour-ending value's first time is the start of its hour */
    const kind = ctx.C.event.HAZARD_KIND[key], out = (m) => !!spans && !ctx.C.event.covers(spans, m, kind), sh = spans && kind === "end" ? H : 0;
    if (key === "rain") { const p = spans ? precipTimingIn(ctx, spans, s, e) : precipTiming(ctx, s, e); return { first: p.first, last: p.last, spreadH: p.spreadH, show: p.wet + 0, of: p.usable, active: p.active }; }
    const firsts = []; let of = 0;
    if (key === "lightning") {
      if (!ctx.th) return { show: 0, of: 0, spreadH: 0, first: null };
      ctx.th.ids.forEach((id) => { let any = false, hit = null; ctx.B.ms.forEach((m) => { if (m < s || m >= e || out(m)) return; const t = ctx.th.perModel(id, m); if (t && t !== "nodata") any = true; if (hit == null && (RANK[t] ?? 0) >= 1) hit = m - sh; }); if (any) of++; if (hit != null) firsts.push(hit); });
    } else {
      const v = { wind: "wind_gusts_10m", heat: "temperature_2m", cold: "apparent_temperature", snow: "snowfall" }[key];
      const test = { wind: (x) => x >= (thr.gust || 25), heat: (x) => x >= 90, cold: (x) => x <= 32, snow: (x) => x >= 0.05 }[key];
      PRECIP_SOURCES(ctx.B).forEach(([id, md]) => { const a = md.h && md.h[v]; if (!a) return; let any = false, hit = null; ctx.B.ms.forEach((m, i) => { if (m < s || m >= e || out(m) || !fin(a[i])) return; any = true; if (hit == null && test(a[i])) hit = m - sh; }); if (any) of++; if (hit != null) firsts.push(hit); });
    }
    return { show: firsts.length, of, first: firsts.length ? Math.min(...firsts) : null, last: firsts.length ? Math.max(...firsts) : null, spreadH: firsts.length > 1 ? (Math.max(...firsts) - Math.min(...firsts)) / H : 0 };
  }
  function certainty(t) {
    if (!t || !t.of) return { level: null, word: "Not enough guidance to judge timing" };
    if (t.show / t.of < 0.5) return { level: "low", word: `Low: only ${t.show} of ${t.of} model sources show it` };
    if (t.spreadH <= 2) return { level: "high", word: "Fairly consistent: sources within about 2 hours" };
    if (t.spreadH <= 5) return { level: "medium", word: `Could shift: sources differ by about ${Math.round(t.spreadH)} hours` };
    return { level: "low", word: `Uncertain: sources differ by about ${Math.round(t.spreadH)} hours` };
  }
  /* ev: {name, loc, tz, times} as in Core.event; thr: {gust} */
  function eventBrief(ctx, ev, thr = { gust: 25 }) {
    const { C } = ctx, wins = C.event.windows(ev), phases = wins.filter((w) => w.key !== "all"), all = wins.find((w) => w.key === "all");
    if (!all) return { error: "The event needs a start and an end." };
    const inst = { ms: ctx.B.ms };
    const rows = phases.map((w) => { const cov = C.event.coverage(w, inst, ctx.now), r = cov.status === "past" || cov.status === "beyond" ? null : phaseRow(ctx, w);
      const levels = r ? Object.fromEntries(Object.entries(HAZARDS).map(([k, h]) => [k, h.level(r)])) : {};
      const top = r ? Object.keys(HAZARDS).filter((k) => levels[k] > 0).sort((a, b) => levels[b] - levels[a] || HAZARDS[a].order - HAZARDS[b].order)[0] || null : null;
      return { ...w, cov, r, levels, top, level: top ? levels[top] : 0 }; });
    const live = rows.filter((p) => p.r);
    const overall = {};
    Object.keys(HAZARDS).forEach((k) => { overall[k] = Math.max(0, ...live.map((p) => p.levels[k] || 0)); });
    const ranked = Object.keys(HAZARDS).filter((k) => overall[k] > 0).sort((a, b) => overall[b] - overall[a] || HAZARDS[a].order - HAZARDS[b].order);
    const span = { s: Math.max(all.startMs, Math.floor(ctx.now / H) * H), e: all.endMs };
    /* the hours the event uses: with slots and gaps between them, hours wholly inside a gap are left out of the
       concerns, their timing and every total (each hour's own values and the thresholds are unchanged) */
    /* planner-defined slots: every hour from the first start to the hour ending at the last end, each value kept only
       where its own interval meets a slot (Core.event.KIND): rain labelled 4 PM fell 3–4 PM, so it counts only if a slot
       is on between 3 and 4 PM. Values and thresholds are unchanged. The fixed parts read exactly as before. */
    const custom = C.event.hasSlots(ev), spans = custom ? all.spans : null;
    const hours = span.e > span.s ? (custom ? hourly(ctx, span.s, span.e + H).filter((h) => C.event.covers(spans, h.ms, "end") || C.event.covers(spans, h.ms, "at")) : hourly(ctx, span.s, span.e)) : [];
    const concerns = ranked.map((k) => {
      const kind = C.event.HAZARD_KIND[k], hz = HAZARDS[k], hits = hours.filter((h) => hz.hour(h, thr) && (!custom || C.event.covers(spans, h.ms, kind))), worst = live.filter((p) => p.levels[k] === overall[k]);
      const phasesHit = live.filter((p) => hits.some((h) => (custom ? C.event.holding([p], h.ms, kind).length > 0 : h.ms >= p.startMs && h.ms < p.endMs))).map((p) => p.label);
      const t = hazardTiming(ctx, k, span.s, custom ? span.e + H : span.e, thr, spans);
      const sh = custom && kind === "end" ? H : 0; // an hour-ending value's hour starts an hour before its label
      return { key: k, label: hz.label, noun: hz.noun, level: overall[k], word: LEVEL_WORD[overall[k]], tier: LEVEL_TIER[overall[k]],
        why: hz.why(worst[0].r), from: hits.length ? hits[0].ms - sh : null, to: hits.length ? hits[hits.length - 1].ms + H - sh : null, phases: phasesHit.length ? phasesHit : worst.map((p) => p.label),
        timing: t, certainty: certainty(t) };
    });
    const coverage = rows.some((p) => p.cov.status === "beyond") ? "beyond" : rows.some((p) => p.cov.status === "partial") ? "partial" : rows.every((p) => p.cov.status === "past") ? "past" : "full";
    return { ev, phases: rows, all, hours, concerns, top: concerns[0] || null, coverage, thresholds: thr, spans, custom };
  }
  /* What could change the plan: plain consequences of the spread in guidance, never invented events */
  function planChanges(brief, fmt) {
    const out = [];
    brief.concerns.forEach((c) => {
      const t = c.timing;
      if (c.key === "rain" && t.of && t.show / t.of < 0.5) out.push(`Rain is in only ${t.show} of ${t.of} model sources. If more sources pick it up, plan for wet setup and covered areas.`);
      if (c.key === "rain" && t.first != null && t.spreadH > 2) out.push(`If rain arrives at the early end (${fmt(t.first)}) instead of ${fmt(t.last)}, it reaches ${phaseAt(brief, t.first) || "the event"}.`);
      if (c.key === "wind") out.push(`Gusts are expected to reach about ${Math.round(brief.phases.reduce((m, p) => Math.max(m, p.r && fin(p.r.gust) ? p.r.gust : 0), 0))} mph. Tents, banners and stage rigging have their own limits; check them against your equipment.`);
      if (c.key === "lightning") out.push("Forecast thunder is not detected lightning. Your venue's lightning policy (for example, pausing when lightning is within about 10 miles) governs on the day.");
      if (c.key === "heat") out.push("Plan shade, water and cooling for staff and guests; the hottest hours are noted above.");
      if (c.key === "cold") out.push("Wind chill will make it feel colder than the temperature; plan warming areas for long shifts.");
      if (c.key === "snow") out.push("Model snowfall is not ground accumulation; road and surface impacts depend on temperatures at the time.");
    });
    if (brief.coverage === "beyond") out.push("Part of the event is beyond the hourly guidance. The briefing will fill in as the date gets closer.");
    if (!brief.concerns.length && brief.coverage === "full") out.push("No phase reaches a planning threshold right now. A new signal in the next model update would change that.");
    return out;
  }
  function phaseAt(brief, ms) { const p = brief.phases.find((x) => ms >= x.startMs && ms < x.endMs); return p ? (p.key === "event" && p.label === "Event" ? "the event itself" : partPhrase(p.label)) : null; }
  /* the fixed parts are named as before ("setup", "the event"); a planner's own slot by its name ("the Outdoor ceremony") */
  const LEGACY = ["Setup", "Gates", "Event", "Teardown"];
  const partWord = (l) => (LEGACY.includes(l) ? String(l).toLowerCase() : String(l || ""));
  const partPhrase = (l) => (l === "Event" ? "the event" : LEGACY.includes(l) ? l.toLowerCase() : /^(the|a|an|our|my|day\b|mon|tue|wed|thu|fri|sat|sun)/i.test(String(l).trim()) ? String(l).trim() : `the ${String(l).trim()}`);
  /* The operational check: 30 minutes before gates open when the schedule has a Gates time (a "gates" part, or a slot
     named Gates), otherwise 30 minutes before the main slot or the event start, named as the planner named it ("Before
     Outdoor ceremony"). It depends on the schedule and the clock only, never on model metadata, so two people opening the
     same event with the same schedule see the same check even when their browsers hold different forecast updates. In a
     multi-day briefing the brief is the selected day's, so the check is that day's.
     -> { state: "upcoming" | "now" | "underway", at, opensMs, what, opens, gates } or null without a schedule.
     "now": the checkpoint has passed and gates (or the start) are still ahead: check now. */
  const OP_LEAD = 30 * 60e3;
  function opCheck(ctx, brief) {
    const ph = brief.phases || [], gates = ph.find((p) => p.key === "gates" || /^gates?$/i.test(String(p.label || "").trim()));
    const main = ph.find((p) => p.key === "event") || ph[0] || brief.all; if (!main || !Number.isFinite(main.startMs)) return null;
    const anchor = gates || main, opensMs = anchor.startMs, at = opensMs - OP_LEAD, plain = !gates && String(main.label || "Event").trim() === "Event";
    const what = gates ? "Before gates open" : plain ? "Before the event starts" : `Before ${String(main.label).trim()}`;
    const opens = gates ? "Gates open" : plain ? "The event starts" : `${String(main.label).trim()} starts`;
    const state = ctx.now < at ? "upcoming" : ctx.now < opensMs ? "now" : "underway";
    return { state, at, opensMs, what, opens, gates: !!gates, why: "Re-check radar, lightning and NWS alerts before guests arrive." };
  }
  /* the next model publication (from each model's own metadata, so it can differ between browsers); shown on its own */
  function nextModelUpdate(ctx, names, beforeMs = Infinity) { return nextUpdates(ctx, names).filter((u) => u.at < beforeMs)[0] || null; }
  /* When to check again: real next model publication times plus fixed lead-time checkpoints */
  function checkAgain(ctx, brief, names) {
    const start = brief.phases.length ? brief.phases[0].startMs : brief.all.startMs, out = [];
    const ups = nextUpdates(ctx, names).filter((u) => u.at < start);
    const major = ups.filter((u) => u.id !== "gfs_hrrr")[0];
    if (major) out.push({ at: major.at, what: `Next ${major.name} run expected`, why: "A new global model run can shift timing and amounts." });
    [[48, "Two days out", "Hourly high-resolution models start covering the event."], [24, "Day before", "Confirm staffing and any weather contingencies."], [6, "Morning of", "Last model-based check before setup."]].forEach(([h, what, why]) => { const at = start - h * H; if (at > ctx.now) out.push({ at, what, why }); });
    const radar = start - H; if (radar > ctx.now) out.push({ at: radar, what: "Switch to radar and lightning detection", why: "From here, observed weather matters more than model guidance." });
    const op = opCheck(ctx, brief); if (op && op.state === "upcoming") out.push({ at: op.at, what: op.what, why: op.why, op: true });
    return out.sort((a, b) => a.at - b.at).slice(0, 5);
  }

  /* ---------- sample event: opens with no account or calendar connection ---------- */
  const SAMPLE_VENUE = { name: "Sawyer Point, Cincinnati, OH", lat: 39.0966, lon: -84.4996 };
  function sampleEvent(C, now = Date.now(), tz = "America/New_York", offset = 1, venue = null) {
    const add = (d, n) => new Date(Date.parse(d + "T12:00Z") + n * 86400e3).toISOString().slice(0, 10);
    const today = C.time.toLocal(now, tz).slice(0, 10), day = add(today, offset), v = venue || SAMPLE_VENUE;
    return { id: "sample", sample: true, offset, name: venue ? "Outdoor concert (sample)" : "Riverfront Music Night (sample)", loc: { name: v.name, lat: +v.lat, lon: +v.lon }, tz,
      times: { setup: `${day}T12:00`, gates: `${day}T16:30`, start: `${day}T17:00`, end: `${day}T22:00`, teardown: `${add(day, 1)}T00:00` } };
  }

  function pickSample(ctx, C, tz, offsets = [1, 2, 3], venue = null) {
    const cands = offsets.map((o) => { const ev = sampleEvent(C, ctx.now, tz, o, venue), b = eventBrief(ctx, ev); return { ev, score: b.top ? b.top.level * 10 + b.concerns.length : 0, full: b.coverage === "full" }; }).filter((c) => c.full);
    if (!cands.length) return sampleEvent(C, ctx.now, tz, 1, venue);
    return cands.reduce((a, b) => (b.score > a.score ? b : a)).ev;
  }

  /* ---------- market: where the Cincinnati-tuned blend and the HRRR map apply ---------- */
  /* The tuned recipe was set and is being verified at CVG: it applies inside the Cincinnati DMA (county outline
     bounds). The HRRR map package covers the Tri-State crop only. Everywhere else: default recipe, no map. */
  const CINCY_DMA = { w: -85.45, e: -83.27, s: 38.34, n: 39.59 }, HRRR_BOX = { w: -86.6, e: -82.4, s: 37.6, n: 40.7 };
  const inBox = (b, lat, lon) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
  function market(lat, lon) { return { tuned: inBox(CINCY_DMA, +lat, +lon), map: inBox(HRRR_BOX, +lat, +lon) }; }

  /* event <-> link: an event can travel in a URL so a colleague opens the same briefing */
  /* A share link carries the event only: name, venue name and point, time zone, its times, the gust limit, and (when a
     time happens twice on a fall-back night) which occurrence is meant, so the link keeps the exact times. Nothing else
     from the workspace travels. Links made before "f" existed still open (first occurrence, as before). */
  function eventToParam(ev) {
    const f = Object.fromEntries(Object.entries(ev.fold || {}).filter(([k, x]) => ev.times && ev.times[k] && (x === 0 || x === 1)));
    /* planner-defined slots travel as s: [[name, start, end, flags?], …] (flags: 1 = main slot; fold as {s:1,e:1});
       t keeps the outer start and end, so a page from before slots opens the link as one window over the same hours */
    const sl = ev.slots && ev.slots.length ? ev.slots.map((x) => { const fl = {}; if (x.main === true) fl.m = 1; if (x.fold && x.fold.start === 1) fl.s = 1; if (x.fold && x.fold.end === 1) fl.e = 1;
      return Object.keys(fl).length ? [x.name, x.start, x.end, fl] : [x.name, x.start, x.end]; }) : null;
    return JSON.stringify({ n: ev.name, v: ev.loc, z: ev.tz, t: ev.times, g: ev.gust || 25, ...(Object.keys(f).length ? { f } : {}), ...(sl ? { s: sl } : {}) });
  }
  function eventFromParam(str, C) {
    try { const x = JSON.parse(str); const ev = { id: "link", name: String(x.n || "Shared event").slice(0, 80), loc: { name: String(x.v.name || "Venue").slice(0, 80), lat: +x.v.lat, lon: +x.v.lon }, tz: x.z, times: x.t, gust: +x.g || 25 };
      if (x.v.approximate === true) ev.loc.approximate = true;
      if (x.f && typeof x.f === "object") { const f = Object.fromEntries(Object.entries(x.f).filter(([k, v]) => ev.times && ev.times[k] && (v === 0 || v === 1))); if (Object.keys(f).length) ev.fold = f; }
      if (Array.isArray(x.s) && x.s.length) {
        ev.slots = x.s.slice(0, 24).map((r, i) => { const fl = (Array.isArray(r) && r[3] && typeof r[3] === "object") ? r[3] : {}, fold = {};
          if (fl.s === 1) fold.start = 1; if (fl.e === 1) fold.end = 1;
          return { id: `s${i + 1}`, name: String((Array.isArray(r) && r[0]) || "Event").slice(0, 40), start: Array.isArray(r) ? r[1] : null, end: Array.isArray(r) ? r[2] : null, ...(fl.m === 1 ? { main: true } : {}), ...(Object.keys(fold).length ? { fold } : {}) }; });
        if (!C.event.validate(ev).length) ev.times = C.event.outerTimes(ev.slots, ev.tz);
      }
      return C.event.validate(ev).length ? null : ev; } catch (e) { return null; }
  }

  /* ---------- strongest signal first (meteorologist workspace) ---------- */
  const TIER_RANK = { action: 3, prepare: 2, monitor: 1, normal: 0, nodata: -1 };
  const AGREE_TIER = { split: "prepare", some: "monitor", agree: "normal" };
  function signals(ctx, s, e, fmt) {
    const d = disagreement(ctx, s, e), out = []; if (!d) return out;
    const hrs = hourly(ctx, s, e);
    if (d.timing.n >= 2) { const sp = Math.round(d.timing.spreadH);
      out.push({ key: "timing", tier: AGREE_TIER[d.timing.level], at: d.timing.first, title: sp >= 1 ? `Rain onset differs by ${sp} hour${sp === 1 ? "" : "s"}` : "Rain onset agrees within an hour",
        detail: `First rain ${fmt(d.timing.first)} – ${fmt(d.timing.last)} across ${d.timing.n} sources` }); }
    if (d.precip.of) out.push({ key: "precip", tier: AGREE_TIER[d.precip.level],
      title: d.precip.wet === 0 ? "No source shows rain" : d.precip.wet === d.precip.of ? `All ${d.precip.of} sources show rain` : `${d.precip.wet} of ${d.precip.of} sources show rain`,
      detail: `Measurable (≥0.01″ in an hour)${d.precip.qpfR && fin(d.precip.qpfR[1]) && d.precip.qpfR[1] >= 0.01 ? `; totals ${d.precip.qpfR[0].toFixed(2)}–${d.precip.qpfR[1].toFixed(2)}″` : ""}` });
    if (fin(d.temp.spread)) { const sp = Math.round(d.temp.spread);
      out.push({ key: "temp", tier: AGREE_TIER[d.temp.level], title: d.temp.level === "agree" ? `Highs agree within ${Math.max(1, sp)}°` : `Highs differ by ${Math.max(1, sp)}°`, detail: `${Math.round(d.temp.p10)}–${Math.round(d.temp.p90)}° across guidance (10th–90th percentile, weighted)` }); }
    const th = hrs.filter((h) => (RANK[h.thunder] ?? 0) >= 1);
    if (th.length) { const top = th.reduce((a, b) => ((RANK[b.thunder] ?? 0) > (RANK[a.thunder] ?? 0) ? b : a));
      out.push({ key: "thunder", tier: top.thunder, at: th[0].ms, title: `Thunder signal ${fmt(th[0].ms)}${th.length > 1 ? ` – ${fmt(th[th.length - 1].ms + H)}` : ""}`, detail: `Peak signal ${({ 1: "marginal", 2: "elevated", 3: "high" })[RANK[top.thunder]]} at ${fmt(top.ms)}; forecast potential, not detected lightning` }); }
    const g = hrs.filter((h) => fin(h.gust)).reduce((a, b) => (!a || b.gust > a.gust ? b : a), null);
    if (g && g.gust >= 25) out.push({ key: "gust", tier: g.gust >= 35 ? "prepare" : "monitor", at: g.ms, title: `Gusts to ${Math.round(g.gust)} mph`, detail: `Peak blended gust ${fmt(g.ms)}` });
    return out.sort((a, b) => (TIER_RANK[b.tier] ?? -1) - (TIER_RANK[a.tier] ?? -1));
  }

  /* ---------- the event decision in one sentence ---------- */
  const VERB = ["", "Watch for", "Plan for", "Expect"];
  function decision(brief) {
    const top = brief.top;
    if (!top) return { tier: "normal", text: "No weather concern for this event right now." };
    const evp = brief.phases.find((p) => p.key === "event"), phs = top.phases;
    let where;
    if (evp && phs.includes(evp.label) && top.from != null) {
      const dur = evp.endMs - evp.startMs, f = (top.from - evp.startMs) / dur, t = (top.to - evp.startMs) / dur, the = partPhrase(evp.label);
      where = f <= 0 && t >= 1 ? `throughout ${the}` : t >= 1 ? (f < 0.35 ? `for most of ${the}` : `late in ${the}`) : f >= 0.5 ? `late in ${the}` : t <= 0.5 ? `early in ${the}` : `during ${the}`;
    } else where = phs.length ? `during ${phs.map((x) => (LEGACY.includes(x) ? x.toLowerCase() : partPhrase(x))).join(" and ")}` : "during the event";
    return { tier: top.tier, text: `${VERB[top.level]} ${top.noun} ${where}.` };
  }

  /* How much of the event the hourly guidance covers, and when it will cover the rest.
     The guidance used here reaches `lead` hours ahead of now; that horizon moves forward with every run, so a phase
     comes into range about `lead` before it starts, and the whole briefing is ready `lead` before teardown ends. */
  const listWords = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  function readiness(brief, ctx) {
    const now = ctx.now, ms = (ctx.B && ctx.B.ms) || [], last = ms.length ? ms[ms.length - 1] : now, lead = Math.max(0, last - now);
    const name = (p) => (p.key === "event" && (!p.slot || p.label === "Event") ? "the event" : p.slot ? partPhrase(p.label) : p.label.toLowerCase());
    const live = brief.phases.filter((p) => p.cov.status !== "past");
    const covered = live.filter((p) => p.cov.status === "full"), partly = live.filter((p) => p.cov.status === "partial"), pending = live.filter((p) => p.cov.status === "beyond");
    const state = !live.length ? "past" : pending.length === live.length ? "pending" : partly.length || pending.length ? "partial" : "ready";
    const end = brief.all.endMs, start = live.length ? live[0].startMs : brief.all.startMs;
    const firstAt = state === "pending" ? Math.max(now, start - lead) : null, readyAt = state === "pending" || state === "partial" ? Math.max(now, end - lead) : null;
    const bits = [];
    if (covered.length) bits.push(`${cap(listWords(covered.map(name)))} covered`);
    if (partly.length) bits.push(`${bits.length ? listWords(partly.map(name)) : cap(listWords(partly.map(name)))} partly covered`);
    if (pending.length && state !== "pending") bits.push(`${listWords(pending.map(name))} pending`);
    return { state, lead, firstAt, readyAt, covered: covered.map((p) => p.key), partly: partly.map((p) => p.key), pending: pending.map((p) => p.key), line: bits.join(" · "), names: live.map(name), all: listWords(live.map(name)), inRange: listWords([...covered, ...partly].map(name)) };
  }
  /* a reminder the planner can put in their own calendar: no account and nothing stored on a server */
  function reminder(ev, atMs, url) {
    const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const title = `Weather briefing ready: ${ev.name}`, body = `The Forecast Ops briefing for ${ev.name} (${ev.loc.name}) should now cover the whole event. Open it: ${url}`;
    const g = new URL("https://calendar.google.com/calendar/render");
    g.search = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${z(atMs)}/${z(atMs + 15 * 60e3)}`, details: body }).toString();
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Forecast Ops//Event beta//EN", "BEGIN:VEVENT", `UID:${z(atMs)}-${Math.abs(hash(url))}@forecast-ops`, `DTSTAMP:${z(Date.now())}`,
      `DTSTART:${z(atMs)}`, `DTEND:${z(atMs + 15 * 60e3)}`, `SUMMARY:${icsText(title)}`, `DESCRIPTION:${icsText(body)}`, `URL:${url}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(title)}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    return { google: g.toString(), ics };
  }
  const icsText = (t) => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const hash = (t) => [...String(t)].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);

  const api = { opCheck, nextModelUpdate, OP_LEAD, partWord, partPhrase, precipTimingIn, lightningWord, LIGHTNING_WORD, market, eventToParam, eventFromParam, CINCY_DMA, HRRR_BOX, signals, decision, formatPrecipPercent, pickSample, phaseRow, HAZARDS, LEVEL_WORD, LEVEL_TIER, AGREE_WORD, context, windowRow, hourly, precipTiming, disagreement, guidanceAge, nextUpdates, hazardTiming, certainty, eventBrief, planChanges, checkAgain, sampleEvent, SAMPLE_VENUE, readiness, reminder, listWords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetaStory = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
