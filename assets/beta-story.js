/* Beta weather story: one shared reading of the guidance for the Meteorologist and Event Manager betas.
   Nothing here is a new forecast method. Values come from the same loaders, blend recipe and
   C.blend.windowRow aggregation as Model Blend and the decision briefing; precipitation timing uses
   ModelTrends.timing (the briefing's per-model windows); thunder uses C.thunder.hourly (Thunder page).
   The functions below only select, rank and word those values. Pure: no DOM, Node-testable. */
(function (root) {
  "use strict";
  const H = 3600e3;
  const fin = (x) => typeof x === "number" && Number.isFinite(x);
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
      why: (r) => `${fin(r.chanceV) ? Math.round(r.chanceV * 100) + "% of ensemble members wet" : "Precipitation in guidance"}${fin(r.qpf) ? `, about ${r.qpf.toFixed(2)}″` : ""}` },
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
      out.push({ ms: m, i, temp: r.hi, tempR: r.hiR, qpf: r.qpf, pop: r.pop, chance: r.chance ? r.chance.v : null, gust: r.gust, sn: r.sn, feel: r.feel, n: r.contrib.length, thunder: ctx.th ? ctx.th.at(m) : null });
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
  function hazardTiming(ctx, key, s, e, thr) {
    if (key === "rain") { const p = precipTiming(ctx, s, e); return { first: p.first, last: p.last, spreadH: p.spreadH, show: p.wet + 0, of: p.usable, active: p.active }; }
    const firsts = []; let of = 0;
    if (key === "lightning") {
      if (!ctx.th) return { show: 0, of: 0, spreadH: 0, first: null };
      ctx.th.ids.forEach((id) => { let any = false, hit = null; ctx.B.ms.forEach((m) => { if (m < s || m >= e) return; const t = ctx.th.perModel(id, m); if (t && t !== "nodata") any = true; if (hit == null && (RANK[t] ?? 0) >= 1) hit = m; }); if (any) of++; if (hit != null) firsts.push(hit); });
    } else {
      const v = { wind: "wind_gusts_10m", heat: "temperature_2m", cold: "apparent_temperature", snow: "snowfall" }[key];
      const test = { wind: (x) => x >= (thr.gust || 25), heat: (x) => x >= 90, cold: (x) => x <= 32, snow: (x) => x >= 0.05 }[key];
      PRECIP_SOURCES(ctx.B).forEach(([id, md]) => { const a = md.h && md.h[v]; if (!a) return; let any = false, hit = null; ctx.B.ms.forEach((m, i) => { if (m < s || m >= e || !fin(a[i])) return; any = true; if (hit == null && test(a[i])) hit = m; }); if (any) of++; if (hit != null) firsts.push(hit); });
    }
    return { show: firsts.length, of, first: firsts.length ? Math.min(...firsts) : null, last: firsts.length ? Math.max(...firsts) : null, spreadH: firsts.length > 1 ? (Math.max(...firsts) - Math.min(...firsts)) / H : 0 };
  }
  function certainty(t) {
    if (!t || !t.of) return { level: null, word: "Not enough guidance to judge timing" };
    if (t.show / t.of < 0.5) return { level: "low", word: `Low — only ${t.show} of ${t.of} model sources show it` };
    if (t.spreadH <= 2) return { level: "high", word: "Fairly consistent — sources within about 2 hours" };
    if (t.spreadH <= 5) return { level: "medium", word: `Could shift — sources differ by about ${Math.round(t.spreadH)} hours` };
    return { level: "low", word: `Uncertain — sources differ by about ${Math.round(t.spreadH)} hours` };
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
    const hours = span.e > span.s ? hourly(ctx, span.s, span.e) : [];
    const concerns = ranked.map((k) => {
      const hz = HAZARDS[k], hits = hours.filter((h) => hz.hour(h, thr)), worst = live.filter((p) => p.levels[k] === overall[k]);
      const phasesHit = live.filter((p) => hits.some((h) => h.ms >= p.startMs && h.ms < p.endMs)).map((p) => p.label);
      const t = hazardTiming(ctx, k, span.s, span.e, thr);
      return { key: k, label: hz.label, noun: hz.noun, level: overall[k], word: LEVEL_WORD[overall[k]], tier: LEVEL_TIER[overall[k]],
        why: hz.why(worst[0].r), from: hits.length ? hits[0].ms : null, to: hits.length ? hits[hits.length - 1].ms + H : null, phases: phasesHit.length ? phasesHit : worst.map((p) => p.label),
        timing: t, certainty: certainty(t) };
    });
    const coverage = rows.some((p) => p.cov.status === "beyond") ? "beyond" : rows.some((p) => p.cov.status === "partial") ? "partial" : rows.every((p) => p.cov.status === "past") ? "past" : "full";
    return { ev, phases: rows, all, hours, concerns, top: concerns[0] || null, coverage, thresholds: thr };
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
    if (!brief.concerns.length) out.push("No phase reaches a planning threshold right now. A new signal in the next model update would change that.");
    return out;
  }
  function phaseAt(brief, ms) { const p = brief.phases.find((x) => ms >= x.startMs && ms < x.endMs); return p ? (p.key === "event" ? "the event itself" : p.label.toLowerCase()) : null; }
  /* When to check again: real next model publication times plus fixed lead-time checkpoints */
  function checkAgain(ctx, brief, names) {
    const start = brief.phases.length ? brief.phases[0].startMs : brief.all.startMs, evStart = (brief.phases.find((p) => p.key === "event") || brief.phases[0] || brief.all).startMs, out = [];
    const ups = nextUpdates(ctx, names).filter((u) => u.at < start);
    const major = ups.filter((u) => u.id !== "gfs_hrrr")[0];
    if (major) out.push({ at: major.at, what: `Next ${major.name} run expected`, why: "A new global model run can shift timing and amounts." });
    [[48, "Two days out", "Hourly high-resolution models start covering the event."], [24, "Day before", "Confirm staffing and any weather contingencies."], [6, "Morning of", "Last model-based check before setup."]].forEach(([h, what, why]) => { const at = start - h * H; if (at > ctx.now) out.push({ at, what, why }); });
    const radar = start - H; if (radar > ctx.now) out.push({ at: radar, what: "Switch to radar and lightning detection", why: "From here, observed weather matters more than model guidance." });
    if (evStart !== start && evStart > ctx.now) out.push({ at: evStart - 30 * 60e3, what: "Before gates / start", why: "Re-check radar and alerts before guests arrive." });
    return out.sort((a, b) => a.at - b.at).slice(0, 5);
  }

  /* ---------- sample event: opens with no account or calendar connection ---------- */
  const SAMPLE_VENUE = { name: "Sawyer Point, Cincinnati, OH", lat: 39.0966, lon: -84.4996 };
  function sampleEvent(C, now = Date.now(), tz = "America/New_York", offset = 1) {
    const add = (d, n) => new Date(Date.parse(d + "T12:00Z") + n * 86400e3).toISOString().slice(0, 10);
    const today = C.time.toLocal(now, tz).slice(0, 10), day = add(today, offset);
    return { id: "sample", sample: true, offset, name: "Riverfront Music Night (sample)", loc: { ...SAMPLE_VENUE }, tz,
      times: { setup: `${day}T12:00`, gates: `${day}T16:30`, start: `${day}T17:00`, end: `${day}T22:00`, teardown: `${add(day, 1)}T00:00` } };
  }

  function pickSample(ctx, C, tz, offsets = [1, 2, 3]) {
    const cands = offsets.map((o) => { const ev = sampleEvent(C, ctx.now, tz, o), b = eventBrief(ctx, ev); return { ev, score: b.top ? b.top.level * 10 + b.concerns.length : 0, full: b.coverage === "full" }; }).filter((c) => c.full);
    if (!cands.length) return sampleEvent(C, ctx.now, tz, 1);
    return cands.reduce((a, b) => (b.score > a.score ? b : a)).ev;
  }
  const api = { pickSample, phaseRow, HAZARDS, LEVEL_WORD, LEVEL_TIER, AGREE_WORD, context, windowRow, hourly, precipTiming, disagreement, guidanceAge, nextUpdates, hazardTiming, certainty, eventBrief, planChanges, checkAgain, sampleEvent, SAMPLE_VENUE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetaStory = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
