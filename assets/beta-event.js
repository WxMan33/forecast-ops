/* Event Manager beta: decision first. The weather takeaway leads; the schedule (setup → gates → event →
   teardown) is the graphic, with the affected window marked; the map and detail sit below.
   Opens on a sample event with no account or calendar; edits stay in this browser.
   Calculations: BetaStory over the Model Blend data, recipe and Core.event phase windows. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, S = window.BetaStory, U = window.BetaUI, $ = O.$, esc = O.esc, H = 3600e3;
  const { fmt, vt, st, deg, inch, mph, fin } = U;
  const BUI = window.EventBriefingUI;
  const E = window.EventStore, UP = window.BetaUpcoming, SEEN = "beta_event_seen_v1";
  const Q = new URLSearchParams(location.search);
  E.migrate(); // the earlier single saved event becomes the first item in Upcoming events
  /* ?ev=<id> opens an event from Upcoming (and survives a refresh); otherwise the last one opened */
  const storedOk = (id) => { const x = id ? E.getEvent(id) : null; return x && (!C.event.validate(x).length || !fin(x.loc.lat)) ? x : null; };
  /* a link can carry a whole event (?e=…) or just a city (?lat=&lon=&name=&tz=) for a sample there */
  const linkEvent = Q.get("e") ? S.eventFromParam(Q.get("e"), C) : null;
  const linkCity = (() => { const lat = parseFloat(Q.get("lat")), lon = parseFloat(Q.get("lon")); return fin(lat) && fin(lon) ? { name: Q.get("name") || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, tz: Q.get("tz") || null } : null; })();
  const sampleAt = (city) => S.sampleEvent(C, Date.now(), (city && city.tz) || "America/New_York", 1, city || null);
  let retried = false;
  let lastView = null, chartController = null;
  let ev = storedOk(Q.get("ev")) || linkEvent || (linkCity ? null : storedOk(E.last())) || null, tzFromPick = false, pickSeq = 0, gen = 0, lastRes = null, bus = null, pendingCity = linkCity;
  if (!ev) ev = sampleAt(linkCity && linkCity.tz ? linkCity : null);
  const isSample = () => !!ev.sample, isStored = () => !!(ev.id && E.getEvent(ev.id));
  /* a saved event opened again in a later session (approximate, per browser) */
  if (!linkEvent && !linkCity && !isSample()) { const last = O.store.get(SEEN, null); let sess = null; try { sess = sessionStorage.getItem("beta_sess_seen"); sessionStorage.setItem("beta_sess_seen", "1"); } catch (e) { /* no storage */ }
    if (last && !sess) U.track("event_revisited"); }
  const link = () => { const u = new URL(location.href); u.hash = ""; u.search = isSample() ? new URLSearchParams({ lat: ev.loc.lat, lon: ev.loc.lon, name: ev.loc.name, tz: ev.tz }) : new URLSearchParams({ e: S.eventToParam(ev) }); return u.toString(); };
  const head = U.header({ audience: "Event", other: { self: "event-beta.html", href: "meteorologist-beta.html", label: "Met" }, ctx: `<div id="picker" class="bx-ctx" style="flex:1 1 auto"></div>` });
  document.title = "Event briefing beta · Forecast Ops";
  const picker = U.placePicker($("picker"), { current: { name: ev.loc.name }, link, label: "Venue city",
    async onPick(p) { const my = ++pickSeq; const tz = p.tz || await O.zoneFor(p.lat, p.lon).catch(() => null); if (my !== pickSeq) return; // a later pick wins, even over a slow time-zone lookup
      /* no time zone (lookup failed): still switch city, and take the zone from that city's forecast response */
      if (!tz) { U.track("city_selected", { market: S.market(p.lat, p.lon).tuned ? "cincinnati" : "elsewhere" }); if (isSample()) pendingCity = { ...p, tz: null }; else { ev = { ...ev, loc: { name: p.name, lat: p.lat, lon: p.lon } }; tzFromPick = true; } return run(); }
      U.track("city_selected", { market: S.market(p.lat, p.lon).tuned ? "cincinnati" : "elsewhere" });
      if (isSample()) ev = sampleAt({ ...p, tz }); else ev = { ...ev, loc: { name: p.name, lat: p.lat, lon: p.lon }, tz };
      run(); } });
  head.onRefresh(() => run());
  $("editBtn").addEventListener("click", () => UP.editEvent(ev, { title: isStored() ? "Edit event" : "Save as your event", onSaved: (rec) => { ev = rec; E.setLast(rec.id); O.store.set(SEEN, Date.now()); history.replaceState(null, "", `?ev=${encodeURIComponent(rec.id)}`); upCount(); run(); } }));
  $("resetBtn").addEventListener("click", () => { E.setLast(null); history.replaceState(null, "", location.pathname); ev = sampleAt(null); run(); });
  /* two views on one page: the briefing (main screen) and Upcoming events (#upcoming) */
  let briefStarted = false;
  function upCount() { const n = E.events().length; $("upLink").textContent = n ? `Upcoming events (${n})` : "Upcoming events"; }
  function view() {
    const up = location.hash === "#upcoming"; document.body.dataset.view = up ? "upcoming" : "brief"; $("briefView").hidden = up; $("upView").hidden = !up;
    if (up) { U.track("upcoming_opened"); UP.render($("upView"), { onOpen: (id) => { location.href = `${location.pathname}?ev=${encodeURIComponent(id)}`; } }); window.scrollTo(0, 0); }
    else { upCount(); if (!briefStarted) { briefStarted = true; run(); } }
  }
  window.addEventListener("hashchange", view);
  if (isSample()) U.track("sample_opened");

  async function run() {
    const g = ++gen;
    /* a city link without a time zone: look it up; failing that, take it from the forecast response for that point */
    let tzFromData = null;
    if (pendingCity && !pendingCity.tz) { const tz = await O.zoneFor(pendingCity.lat, pendingCity.lon).catch(() => null); if (g !== gen) return;
      if (tz) ev = sampleAt({ ...pendingCity, tz }); else { tzFromData = pendingCity; ev = { ...sampleAt(null), loc: { name: pendingCity.name, lat: pendingCity.lat, lon: pendingCity.lon } }; } }
    pendingCity = null;
    if (isStored()) E.setLast(ev.id);
    if (!fin(ev.loc.lat) || !fin(ev.loc.lon)) { context(); $("decision").textContent = "Venue needs confirmation"; $("keys").innerHTML = '<dt>Next</dt><dd>Pick the venue to get a site-specific forecast.<span class="bx-note">Use Edit to choose a saved venue or search its city.</span></dd>'; return; }
    const where = { lat: ev.loc.lat, lon: ev.loc.lon }, mk = S.market(ev.loc.lat, ev.loc.lon);
    picker.setCurrent({ name: ev.loc.name }); document.body.dataset.place = ev.loc.name; document.body.dataset.loaded = ""; document.body.dataset.office = ""; document.body.dataset.tz = ev.tz; document.body.dataset.market = mk.tuned ? "tuned" : "default";
    context();
    $("decision").textContent = "Reading the guidance…"; $("coverage").hidden = true; document.body.dataset.readiness = ""; ["sourceCoverage", "keys", "schedule", "phases", "changes", "checks", "timeline", "detail"].forEach((id) => { $(id).innerHTML = ""; });
    U.alerts(where).then((a) => { if (g !== gen) return; $("alerts").innerHTML = a.slice(0, 2).map((x) => `<div class="bx-alert" role="alert">${st("action", x.event + " in effect")}${x.ends ? `<span class="bx-note">until ${esc(fmt.time(Date.parse(x.ends), ev.tz))}</span>` : ""}<a href="https://forecast.weather.gov/MapClick.php?lat=${ev.loc.lat}&lon=${ev.loc.lon}" target="_blank" rel="noopener">NWS ↗</a></div>`).join(""); });
    const endMs = Math.max(...C.event.windows(ev).map((w) => w.endMs)), days = isSample() ? 5 : Math.min(7, Math.max(3, Math.ceil((endMs - Date.now()) / 864e5) + 1));
    const res = await U.load(where, { days });
    if (g !== gen) return;
    if (res.empty) {
      U.track("load_failed", { what: "models" });
      /* the guidance service is occasionally busy for a minute: try once more on our own before asking */
      if (!retried) { retried = true; $("decision").textContent = "Guidance is slow to answer…"; $("keys").innerHTML = '<p class="bx-note">Trying again in 20 seconds.</p>'; setTimeout(() => { if (g === gen) run(); }, 20000); return; }
      $("decision").textContent = "Weather guidance could not be loaded."; $("keys").innerHTML = '<p class="bx-note">Try ↻ in a minute.</p>'; retried = false; return;
    }
    retried = false;
    if (!res.NW || !res.NW.ok) U.track("load_failed", { what: "nws" });
    if (tzFromData) { ev = sampleAt({ ...tzFromData, tz: res.ctx.B.tz }); context(); document.body.dataset.tz = ev.tz; }
    if (tzFromPick) { tzFromPick = false; ev = { ...ev, tz: res.ctx.B.tz }; if (isStored()) ev = E.saveEvent(ev); context(); document.body.dataset.tz = ev.tz; }
    lastRes = res; render(res);
    document.body.dataset.loaded = ev.loc.name; document.body.dataset.office = res.NW && res.NW.ok ? res.NW.office : "";
  }
  function context() {
    const w = C.event.windows(ev), ph = Object.fromEntries(w.map((x) => [x.key, x])), main = ph.event || ph.all, tz = ev.tz;
    $("sampleTag").hidden = !isSample(); $("resetBtn").hidden = isSample();
    $("evName").textContent = ev.name.replace(/ \(sample\)$/, "");
    $("evVenue").textContent = `· ${ev.loc.name}`;
    $("evWhen").textContent = main ? `${BUI.dateSpan(main.startMs, main.endMs, tz)}${ph.setup ? ` · setup from ${fmt.clock(ph.setup.startMs, tz)}` : ""}` : "";
  }

  /* the schedule is the graphic: phases to scale, the affected window marked, possible start range dashed */
  function schedule(b, now) {
    const P = b.phases; if (!P.length) return "";
    const s = P[0].startMs, e = P[P.length - 1].endMs, tz = ev.tz, at = (ms) => Math.max(0, Math.min(100, ((ms - s) / (e - s)) * 100));
    const segs = P.map((p) => { const w = at(p.endMs) - at(p.startMs); return `<div class="sch-seg ${p.key === "event" ? "ev" : ""} ${w < 11 ? "narrow" : ""}" style="flex:${p.endMs - p.startMs}" title="${esc(p.label)} ${esc(fmt.span(p.startMs, p.endMs, tz))}"><span>${esc(p.label)}</span></div>`; }).join("");
    const t = b.top; let over = "", legend = "";
    if (t && t.from != null) {
      over += `<div class="sch-hz" style="--tier:var(--${t.tier});left:${at(t.from)}%;width:${Math.max(1.2, at(t.to) - at(t.from))}%"></div>`;
      legend += `<span><i style="background:color-mix(in srgb, var(--${t.tier}) 42%, transparent);border:1px solid var(--${t.tier})"></i>${esc(t.label)} most likely</span>`;
      const tm = t.timing; if (tm && tm.first != null && tm.last != null && tm.last > tm.first) { over += `<div class="sch-rng" style="--tier:var(--${t.tier});left:${at(tm.first)}%;width:${at(tm.last) - at(tm.first)}%"></div>`; legend += `<span><i style="background:repeating-linear-gradient(90deg, var(--${t.tier}) 0 3px, transparent 3px 5px)"></i>Possible start, across sources</span>`; }
    }
    if (now > s && now < e) { over += `<div class="sch-now" style="left:${at(now)}%" title="Now"></div>`; legend += `<span><i style="background:var(--accent);width:2px"></i>Now</span>`; }
    const marks = [...P.map((p) => p.startMs), e]; let lastPct = -99; const ticks = marks.map((ms, i) => { const p = at(ms), end = i === marks.length - 1; if (!end && p - lastPct < 10) return ""; if (end && p - lastPct < 8) return ""; lastPct = p; return `<span class="${end ? "end" : ""}" style="left:${p}%">${esc(fmt.clock(ms, tz))}</span>`; }).join("");
    return `<div class="sch-visual" aria-hidden="true"><div class="sch-bar">${segs}${over}</div><div class="sch-ticks">${ticks}</div></div><ol class="sch-labels">${P.map((p,i) => `<li><span class="sch-number">${i+1}</span><div><b>${esc(p.label)}</b><span>${esc(fmt.clock(p.startMs,tz))}–${esc(fmt.clock(p.endMs,tz))}</span></div></li>`).join("")}</ol><div class="sch-legend">${legend}</div>`;
  }

  function render(res) {
    const ctx = res.ctx, tz = ev.tz, now = ctx.now, thr = { gust: ev.gust || 25 };
    if (isSample() && !ev.picked) { const v = ev.loc.name === S.SAMPLE_VENUE.name ? null : ev.loc; ev = { ...S.pickSample(ctx, C, ev.tz, [1, 2, 3], v), picked: true }; context(); }
    head.setUpdated(ctx.B.viewedAt);
    const b = S.eventBrief(ctx, ev, thr);
    if (b.error) { $("decision").textContent = b.error; return; }
    const top = b.top, checks = S.checkAgain(ctx, b, U.NAMES), next = checks[0];
    /* one set of hourly values for everything below: the grid, the phase summaries and the printout */
    const V = window.HourlyViews.eventView({ C, S, M: window.HourlyModel, ctx, brief: b, thr, tz, now });
    const PS = window.HourlyModel.phaseSummaries(S, b, V.hrs, V.cover), live = PS.filter((p) => p.covered);
    const peak = live.filter((p) => p.peakPop).reduce((a, p) => (!a || p.peakPop.v > a.v ? p.peakPop : a), null);
    const lightAll = lightningOf(PS), nwsTh = window.HourlyModel.nwsThunder(ctx.nws, b.all.startMs, b.all.endMs);
    lastView = { b, V, PS, peak, lightAll, nwsTh, R: null, checks, top };
    /* ---- the decision, then the three facts that support it ---- */
    /* ---- how much of the event the guidance reaches: pending, partly covered or ready ---- */
    const R = S.readiness(b, ctx); document.body.dataset.readiness = R.state; lastView.R = R;
    if (R.state === "past") { $("decision").textContent = "This event has ended."; $("keys").innerHTML = '<dt>Next</dt><dd>Edit the event to brief a future date.</dd>'; $("coverage").hidden = true; return; }
    const around = (ms) => { const h = Math.ceil(ms / H) * H; return `${fmt.day(h, tz)}, about ${fmt.clock(h, tz)}`; };
    const remind = R.readyAt ? remindHtml(R.readyAt, "Add a calendar reminder") : "";
    if (R.state === "pending") {
      $("decision").textContent = "Weather briefing pending";
      $("keys").innerHTML = "";
      $("coverage").className = "bx-pending"; $("coverage").hidden = false;
      $("coverage").innerHTML = `Hourly guidance doesn’t reach this event yet. We’ll flag when ${esc(R.all)} come into range.
        <span class="bx-note" style="display:block;margin-top:6px">Guidance here reaches about ${Math.round(R.lead / 864e5)} days ahead: it should start covering ${esc(R.names[0])} around ${esc(around(R.firstAt))} and the whole event by ${esc(around(R.readyAt))}.</span>${remind}`;
    } else {
      $("coverage").className = "bx-cover"; $("coverage").hidden = false;
      $("coverage").innerHTML = R.state === "ready" ? `<b>Forecast covers ${esc(R.names[0])} through ${esc(R.names[R.names.length - 1])}.</b>`
        : `<b>${esc(R.line)}</b><span class="bx-note"> · full briefing around ${esc(around(R.readyAt))}</span>${remind}`;
      const d = S.decision(b), text = !top && R.state === "partial" ? `No weather concern so far for ${R.inRange}.` : d.text;
      const displayText = BUI.headline(b, text);
      $("decision").innerHTML = top ? esc(displayText).replace(esc(top.noun), `<span class="hz" style="--tier:var(--${top.tier})">${esc(top.noun)}</span>`) : esc(displayText);
      const nextDd = next ? `${vt(next.at, tz, now)}<span class="bx-note">${esc(next.what)}</span>` : "Now: use radar, lightning detection and NWS warnings.";
      const rainDd = `<dt>Rain chance</dt><dd>${peak ? `Peak hourly ${esc(U.pct(peak.v))}<span class="bx-note">${esc(fmt.day(peak.at,tz))}, ${esc(BUI.hourWindow(peak.at,tz))} · across the planning window</span>` : live.length ? `Unavailable<span class="bx-note">The sources that give an hourly rain chance didn't return it for these hours. Try ↻ later.</span>` : "Not in range yet"}</dd>`;
      const lightDd = `<dt>Lightning potential</dt><dd>${esc(lightAll.word)}<span class="bx-note">${esc(lightAll.note)}</span></dd>`;
      if (top) {
        const [cw] = top.certainty.word.split(" — ");
        $("keys").innerHTML = `<dt>Timing</dt><dd>${top.from != null ? esc(fmt.span(top.from, top.to, tz)) : `During ${esc(S.listWords(top.phases.map((x) => x.toLowerCase())))}`}<span class="bx-note">${top.from == null ? "Hourly timing uncertain · " : ""}${esc(top.why)} · timing ${esc(cw.toLowerCase())}</span></dd>
          ${rainDd}${lightDd}<dt>Next check</dt><dd>${nextDd}</dd>`;
      } else {
        const t = live.filter((p) => p.temp), lo = t.length ? Math.min(...t.map((p) => p.temp.lo)) : null, hi = t.length ? Math.max(...t.map((p) => p.temp.hi)) : null, g = live.filter((p) => p.gust), gust = g.length ? Math.max(...g.map((p) => p.gust.v)) : null;
        $("keys").innerHTML = `<dt>Expected</dt><dd>${fin(lo) ? (Math.round(lo) === Math.round(hi) ? `${Math.round(hi)}°` : `${Math.round(lo)}–${Math.round(hi)}°`) : "—"}, gusts to ${mph(gust)}<span class="bx-note">${R.state === "partial" ? esc(S.listWords(live.map((p) => p.label.toLowerCase()))) + " so far" : "Setup through teardown"}</span></dd>
          ${rainDd}${lightDd}<dt>Next check</dt><dd>${nextDd}</dd>`;
      }
    }
    $("coverage").querySelectorAll("[data-remind]").forEach((a) => a.addEventListener("click", () => U.track("reminder_exported", { via: a.dataset.remind })));
    $("sourceCoverage").innerHTML = BUI.sourceHtml(res);
    $("schedule").innerHTML = schedule(b, now);
    if (R.state === "pending") { detail(b, ctx, thr); return; } // nothing at event time yet: schedule and sources only
    /* ---- phases: from the same hours as the grid ---- */
    $("phases").innerHTML = b.phases.map((p, i) => {
      const P = PS[i], past = p.cov.status === "past";
      if (!past && !P.covered) return `<div class="bx-phase pending"><div><div class="nm">${esc(p.label)} <span class="tm">${esc(fmt.span(p.startMs, p.endMs, tz))}</span></div><div style="margin-top:3px;font-size:13.5px">${st(null, "Pending")} <span class="bx-note">in range around ${esc(around(Math.max(now, p.startMs - R.lead)))}</span></div></div></div>`;
      const lvl = p.level, status = past ? st(null, "Done") : lvl ? st(S.LEVEL_TIER[lvl], `${S.HAZARDS[p.top].label}: ${S.LEVEL_WORD[lvl].toLowerCase()}`) : st(null, "No concern found");
      const temp = P.temp ? (Math.round(P.temp.lo) === Math.round(P.temp.hi) ? `${Math.round(P.temp.hi)}°` : `${Math.round(P.temp.lo)}–${Math.round(P.temp.hi)}°`) : "—";
      const L = P.lightning, lw = L.state === "limited" ? `${L.word} · limited guidance` : L.word;
      return `<div class="bx-phase ${past ? "past" : ""}" data-phase="${esc(p.key)}"><div><div class="nm">${esc(p.label)} <span class="tm">${esc(fmt.span(p.startMs, p.endMs, tz))}</span></div><div style="margin-top:3px;font-size:13.5px">${status}</div></div><div class="tp">${temp}</div>
        <div class="mt"><span>Peak hourly rain chance: <b data-peak>${esc(P.peakPop ? U.pct(P.peakPop.v) : "—")}</b>${P.peakPop ? ` <span class="bx-note">${esc(BUI.hourWindow(P.peakPop.at, tz))}</span>` : ""}</span><span>Lightning potential: <b data-light>${esc(lw)}</b></span><span>Gusts to <b>${esc(P.gust ? mph(P.gust.v) : "—")}</b></span></div></div>`;
    }).join("");
    $("nwsEv").innerHTML = U.nwsBlock(res, tz, { from: b.all.startMs, to: b.all.endMs, max: 3 }) + thunderNote(nwsTh, lightAll, tz);
    $("blendLine").innerHTML = `<b>Model blend:</b> ${esc(U.blendLine(res))}. ${esc(res.verified)}`;
    $("changes").innerHTML = S.planChanges(b, (ms) => fmt.time(ms, tz)).map((t) => `<li>${esc(t)}</li>`).join("");
    $("checks").innerHTML = checks.length ? checks.map((c) => `<li><div class="when">${esc(fmt.time(c.at, tz))}<em>${esc(fmt.rel(c.at, now))}</em></div><div><b>${esc(c.what)}</b><div class="bx-note">${esc(c.why)}</div></div></li>`).join("") : '<li><div class="when">Now</div><div>Use radar, lightning detection and NWS warnings.</div></li>';
    /* ---- one selected time for the map and the hour-by-hour chart: the concern's start, or the event start ---- */
    const evStart = (b.phases.find((p) => p.key === "event") || b.phases[0]).startMs, focus = top && top.from != null ? top.from : evStart;
    bus = U.timeBus(focus);
    bus.on((ms) => { document.body.dataset.selected = ms; }); document.body.dataset.selected = focus;
    if (S.market(ev.loc.lat, ev.loc.lon).map) U.mapPanel($("map"), { view: "venue", field: "refc", place: { ...ev.loc }, bus, tz: "America/New_York", now, autoRun: true }); else U.mapUnavailable($("map"), ev.loc);
    const s = Math.max(Math.floor(now / H) * H, b.all.startMs - 2 * H), e = b.all.endMs + H, hours = S.hourly(ctx, s, e);
    $("hourlyValid").innerHTML = `${esc(fmt.span(V.span[0], V.span[V.span.length - 1] + H, tz))} ${esc(fmt.zone(V.span[0], tz))} · tap an hour`;
    U.timeline($("timeline"), hours, { tz, now, bus, gustLine: thr.gust, mark: top && top.from != null ? { s: top.from, e: top.to, tier: top.tier } : null,
      bands: b.phases.map((p) => ({ s: p.startMs, e: p.endMs, label: p.label.toUpperCase(), fill: p.key === "event" ? "color-mix(in srgb, var(--text) 7%, transparent)" : "transparent" })) });
    hourGrid(V, now);
    detail(b, ctx, thr);
    printView(res);
  }
  /* lightning potential across the event: the strongest hourly tier, said plainly; missing guidance never reads Low */
  function lightningOf(PS) {
    const live = PS.filter((p) => p.covered), withL = live.filter((p) => p.lightning.state !== "missing");
    const RANK = { Low: 0, Moderate: 1, High: 2 };
    if (!withL.length) return { word: live.length ? "Unavailable" : "Not available yet", note: "No lightning guidance reaches these hours. Use lightning detection and NWS forecasts.", state: "missing" };
    const w = withL.reduce((a, p) => (RANK[p.lightning.word] > RANK[a] ? p.lightning.word : a), "Low"), limited = withL.length < live.length || withL.some((p) => p.lightning.state === "limited");
    return { word: limited ? `${w} · limited guidance` : w, base: w, limited, state: limited ? "limited" : "ok",
      note: `${w === "Low" ? "Low is not zero. " : ""}${limited ? "Some hours have no lightning guidance." : "Forecast potential, not detected lightning."}` };
  }
  /* NWS thunderstorm wording during the event, and one line when it differs from the model signal */
  function thunderNote(nwsTh, L, tz) {
    if (!nwsTh.length && !(L && (L.base === "Moderate" || L.base === "High"))) return "";
    const words = [...new Set(nwsTh.map((h) => h.short))].slice(0, 3).join("; ");
    const span = nwsTh.length ? `${fmt.time(nwsTh[0].s, tz)} – ${fmt.clock(nwsTh[nwsTh.length - 1].e, tz)}` : "";
    const diff = nwsTh.length && L && L.base === "Low" ? "The NWS mentions thunderstorms while the model signal is low; treat thunderstorms as possible."
      : !nwsTh.length && L && (L.base === "Moderate" || L.base === "High") ? "The models show lightning potential that the NWS forecast doesn't mention for these hours; check for updates."
      : !nwsTh.length ? "" : "";
    return `<div class="bx-thunder" data-nws-thunder>${nwsTh.length ? `<b>NWS thunderstorm wording:</b> ${esc(words)} <span class="bx-note">(${esc(span)})</span>` : "<b>NWS:</b> no thunderstorms in the hourly wording for the event."}${diff ? `<span class="bx-note" style="display:block">${esc(diff)}</span>` : ""}</div>`;
  }
  /* ---- hour-by-hour grid: setup through teardown, the briefing engine's concerns per hour, the blend's values ---- */
  function hourGrid(V, now) {
    const G = window.HourlyGrid;
    if (chartController) chartController.destroy();
    const showHour = (ms) => { const i = V.span.indexOf(ms), d = $("evGridDetail"); if (i < 0) { d.hidden = true; return; } d.hidden = false; d.innerHTML = V.detail(i); };
    const pick = (ms) => (fin(ms) ? Math.min(V.span[V.span.length - 1], Math.max(V.span[0], Math.floor(ms / H) * H)) : V.span[0]);
    const sel0 = pick(bus && bus.get());
    const grid = G.render($("evGrid"), { axis: V.axis, rows: V.rows, selected: sel0, now, label: "Event hour by hour", caption: "Event weather hour by hour, setup through teardown",
      onSelect: (ms) => { if (bus) bus.set(ms, "grid"); showHour(ms); } });
    $("evGridLegend").innerHTML = `<p class="bx-note">Swipe for more hours · tap an hour for details.</p><details class="bx-more"><summary>How to read these hours</summary>${G.legend(V.legend)}<p class="bx-note">${esc(V.note)}</p><p class="bx-note">Follow NWS warnings and your venue's lightning policy for live decisions.</p></details>`;
    chartController = window.EventHourlyCharts.render($("evCharts"), { view: V, selected: sel0, tz: ev.tz, gustLimit: ev.gust || 25, onSelect: ms => { if (bus) bus.set(ms, "variable-charts"); showHour(ms); } });
    showHour(sel0);
    if (bus) bus.on((ms) => { const hm = Math.floor(ms / H) * H; if (V.span.includes(hm)) { grid.setSelected(hm); chartController.setSelected(hm); showHour(hm); } });
  }
  function remindHtml(atMs, label) {
    const r = S.reminder(ev, atMs, link()), ics = "data:text/calendar;charset=utf-8," + encodeURIComponent(r.ics);
    const h = Math.ceil(atMs / H) * H, when = `${fmt.day(h, ev.tz)}, about ${fmt.clock(h, ev.tz)} ${fmt.zone(h, ev.tz)}`;
    return `<details class="bx-remind"><summary class="bx-btn">${esc(label)}</summary><div class="opts"><p class="bx-note" style="margin:0;flex-basis:100%">Set for ${esc(when)}, the estimated time the full briefing will be ready. It links back to this event.</p><a class="bx-btn" data-remind="google" href="${esc(r.google)}" target="_blank" rel="noopener">Google Calendar</a><a class="bx-btn" data-remind="ics" href="${ics}" download="weather-briefing-reminder.ics">Apple / Outlook (.ics)</a></div></details>`;
  }
  /* ---- supporting detail ---- */
  function detail(b, ctx, thr) {
    const tz = ev.tz;
    const ages = S.guidanceAge(ctx, U.NAMES), words = [...new Set((ctx.nws && ctx.nws.hourly ? ctx.nws.hourly : []).filter((h) => h.s < b.all.endMs && h.e > b.all.startMs).map((h) => h.short).filter(Boolean))];
    const mq = new URLSearchParams({ lat: ev.loc.lat, lon: ev.loc.lon, name: ev.loc.name });
    $("detail").innerHTML = `<h2>Detail</h2>
      <details><summary>All concerns</summary>${b.concerns.length ? `<ul class="bx-list" style="margin-top:8px">${b.concerns.map((c) => `<li><b>${esc(c.label)}: ${esc(c.word.toLowerCase())}</b> — ${esc(c.why)}. ${c.from != null ? "Most likely " + esc(fmt.span(c.from, c.to, tz)) + ". " : ""}Timing: ${esc(c.certainty.word)}.</li>`).join("")}</ul>` : (b.coverage === "full" ? '<p class="bx-note">No hazard reaches a planning threshold.</p>' : '<p class="bx-note">Concerns are listed once the guidance reaches every phase.</p>')}</details>
      <details><summary>NWS forecast wording</summary><p>${words.length ? esc(words.slice(0, 6).join(" → ")) : "NWS hourly wording unavailable."}</p></details>
      ${lastView ? `<details id="ensDetail"><summary>Rain across ensemble members (a different measure)</summary><p class="bx-note">The share of ensemble model runs with at least 0.01″ of rain at some point during each part of the event. It is not the hourly rain chance shown above, and it usually differs from it.</p><table class="bx-age"><tbody>${lastView.PS.map((P) => `<tr><td>${esc(P.label)}</td><td class="n">${P.ensemble != null ? esc(U.pct(P.ensemble * 100)) + " of members" : "not available"}</td></tr>`).join("")}</tbody></table></details>` : ""}
      <details><summary>Why the numbers can differ</summary><p class="bx-note">Rain chance is the blended hourly chance of rain at the venue's exact location; each part of the event shows its highest single hour, which is not the chance of rain sometime during that part. The rating in the headline (watch, plan for it, likely disruptive) weighs all the guidance for each part, including the ensemble share and how much rain falls, so a part can be rated “plan for it” with a modest hourly chance, or the reverse. The NWS forecast is issued separately and is shown alongside, not mixed in.</p></details>
      <details><summary>How this briefing is built</summary><p class="bx-note">Values are the Forecast Ops model blend (${esc(lastRes.recipe)}${lastRes.market.tuned ? "" : ", unverified for this market"}) at the venue's coordinates, the same calculation as Model Blend. Lightning potential uses the Thunder page's tiers: Low (its LOW tier — not zero), Moderate (MARGINAL or ELEVATED), High (HIGH); hours without thunder guidance read Unavailable. It describes forecast potential, not detected lightning. Ratings use display thresholds: gusts ${thr.gust}/35/45 mph; rain 20/50/70% of ensemble members or 0.02/0.1/0.25″; snow 0.05/0.3/1″; heat 90/95°; feels-like 32/20°. They are not calibrated probabilities. Timing compares when each model source first shows the hazard.</p></details>
      <details><summary>Sources and how recent they are</summary><table class="bx-age"><tbody>${ages.map((a) => `<tr><td>${esc(a.name)}</td><td class="n ${a.late ? "bx-late" : ""}">${a.unknown ? "run time unknown" : esc(fmt.age(a.ageH)) + " old" + (a.late ? " · late" : "")}</td></tr>`).join("")}</tbody></table></details>
      <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="bx-btn" href="meteorologist-beta.html?${mq}">Meteorologist view of this venue</a><button class="bx-btn" type="button" id="printBtn">Print / PDF</button></p>`;
    $("printBtn").addEventListener("click", () => { printView(lastRes); window.print(); });
    $("foot").innerHTML = `<span>Model guidance only — not an official forecast or warning. Follow NWS warnings and your venue's lightning policy.</span><span>Data: Open-Meteo (CC BY 4.0), NWS, NOAA HRRR. ${lastRes.problems.length ? `Partial data: ${esc(lastRes.problems.slice(0, 3).join("; "))}.` : ""}</span><span>Beta for colleague testing. Your events and venues are stored only in this browser.</span>`;
  }

  /* ---- printout: two US Letter pages for a typical single-day event, built from the same values as the screen ---- */
  function printView(res) {
    const host = $("printView"); if (!host || !lastView || !res) return;
    host.innerHTML = BUI.printMarkup({ ev, res, view: lastView, S, U });
  }
  window.addEventListener("beforeprint", () => printView(lastRes));

  view();
})();
