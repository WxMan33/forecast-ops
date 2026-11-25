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
  let lastView = null, chartController = null, dashController = null, updatedMs = null, lastHourly = null, hourlyJumped = false;
  /* a local event address (?ev=…) opened in a browser that doesn't have that event: say so; never show another event */
  let missingId = Q.get("ev") && !storedOk(Q.get("ev")) && !linkEvent ? Q.get("ev") : null;
  let ev = storedOk(Q.get("ev")) || linkEvent || (linkCity || missingId ? null : storedOk(E.last())) || null, tzFromPick = false, pickSeq = 0, gen = 0, lastRes = null, bus = null, pendingCity = linkCity;
  if (!ev) ev = sampleAt(linkCity && linkCity.tz ? linkCity : null);
  const isSample = () => !!ev.sample, isStored = () => !!(ev.id && E.getEvent(ev.id));
  /* a saved event opened again in a later session (approximate, per browser) */
  if (!linkEvent && !linkCity && !isSample()) { const last = O.store.get(SEEN, null); let sess = null; try { sess = sessionStorage.getItem("beta_sess_seen"); sessionStorage.setItem("beta_sess_seen", "1"); } catch (e) { /* no storage */ }
    if (last && !sess) U.track("event_revisited"); }
  const link = () => { const u = new URL(location.href); u.hash = ""; u.search = isSample() ? new URLSearchParams({ lat: ev.loc.lat, lon: ev.loc.lon, name: ev.loc.name, tz: ev.tz }) : new URLSearchParams({ e: S.eventToParam(ev) });
    const x = !isSample() && window.EventThreats && window.EventThreats.shareParams ? window.EventThreats.shareParams(ev) : null; if (x) Object.entries(x).forEach(([k, v]) => u.searchParams.set(k, v)); // weather threats: airports travel beside the event, never inside e
    return u.toString(); };
  /* Print / PDF sits in the toolbar with the other page controls (before Feedback); live once a briefing is ready */
  const PRINT_ICON = '<svg class="bx-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6V1.5h8V6M4 12H2.5A1 1 0 0 1 1.5 11V7a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H12M4 9.5h8v5H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const head = U.header({ audience: "Event", other: { self: "event-beta.html", href: "meteorologist-beta.html", label: "Met" }, ctx: `<div id="picker" class="bx-ctx" style="flex:1 1 auto"></div>`,
    actions: `<button class="bx-btn bx-print" type="button" id="printTop" disabled title="Available once the briefing loads">${PRINT_ICON}<span>Print / PDF</span></button>` });
  document.title = "Event Manager · Forecast Ops";
  const picker = U.placePicker($("picker"), { current: { name: ev.loc.name }, link, label: "Venue city",
    async onPick(p) { const my = ++pickSeq; const tz = p.tz || await O.zoneFor(p.lat, p.lon).catch(() => null); if (my !== pickSeq) return; // a later pick wins, even over a slow time-zone lookup
      /* no time zone (lookup failed): still switch city, and take the zone from that city's forecast response */
      if (!tz) { U.track("city_selected", { market: S.market(p.lat, p.lon).tuned ? "cincinnati" : "elsewhere" }); if (isSample()) pendingCity = { ...p, tz: null }; else { ev = { ...ev, loc: { name: p.name, lat: p.lat, lon: p.lon } }; tzFromPick = true; } return run(); }
      U.track("city_selected", { market: S.market(p.lat, p.lon).tuned ? "cincinnati" : "elsewhere" });
      if (isSample()) ev = sampleAt({ ...p, tz }); else ev = { ...ev, loc: { name: p.name, lat: p.lat, lon: p.lon }, tz };
      run(); } });
  head.onRefresh(() => run());
  /* on a phone the toolbar shows Print and Feedback as icons: keep their names for screen readers and a tooltip */
  const fbName = () => { const f = document.getElementById("bxFeedback"); if (f && !f.title) { f.title = "Feedback"; f.setAttribute("aria-label", "Feedback"); } };
  fbName(); addEventListener("load", fbName); setTimeout(fbName, 1500);
  { const pc = $("picker").querySelector(".bx-ppcopy"); if (pc) pc.title = "Copy a link to this event (also under Share)"; }
  $("editBtn").addEventListener("click", () => UP.editEvent(ev, { title: isStored() ? "Edit event" : "Save as your event", onSaved: (rec) => { ev = rec; E.setLast(rec.id); O.store.set(SEEN, Date.now()); history.replaceState(null, "", `?ev=${encodeURIComponent(rec.id)}`); upCount(); run(); } }));
  $("resetBtn").addEventListener("click", () => { E.setLast(null); history.replaceState(null, "", location.pathname); ev = sampleAt(null);
    if (missingId) { missingId = null; delete document.body.dataset.missing; const pc = $("picker").querySelector(".bx-ppcopy"); if (pc) pc.hidden = false; $("editBtn").hidden = false; $("shareMenu").hidden = false; $("resetBtn").textContent = "Use sample event"; $("secDetails") && ($("secDetails").hidden = false); briefStarted = true; }
    run(); });
  /* two views on one page: the briefing (main screen) and Upcoming events (#upcoming) */
  let briefStarted = false;
  function upCount() { const n = E.events().length; $("upLink").textContent = n ? `Upcoming events (${n})` : "Upcoming events"; }
  function view() {
    const up = location.hash === "#upcoming"; document.body.dataset.view = up ? "upcoming" : "brief"; $("briefView").hidden = up; $("upView").hidden = !up;
    if (up) { U.track("upcoming_opened"); UP.render($("upView"), { onOpen: (id) => { location.href = `${location.pathname}?ev=${encodeURIComponent(id)}`; } }); window.scrollTo(0, 0); }
    else { upCount(); if (missingId) { notSaved(); return; } if (!briefStarted) { briefStarted = true; run(); } }
  }
  function notSaved() {
    document.body.dataset.missing = "1"; document.body.dataset.readiness = "missing";
    $("sampleTag").hidden = true; $("editBtn").hidden = true; $("shareMenu").hidden = true; $("resetBtn").hidden = false; $("resetBtn").textContent = "Open the sample event instead";
    $("evName").textContent = "Event not found"; $("evVenue").textContent = ""; $("evWhen").textContent = "";
    $("decision").textContent = "This event isn’t saved in this browser";
    $("keys").innerHTML = ""; picker.setCurrent({ name: "No event open" }); const pc = $("picker").querySelector(".bx-ppcopy"); if (pc) pc.hidden = true;
    $("coverage").className = "bx-pending ev-missing"; $("coverage").hidden = false;
    $("coverage").innerHTML = `<p>Saved events live only in the browser where they were saved, so this address doesn't open them anywhere else.</p>
      <p class="bx-note">Ask the person who sent it for the <b>Share</b> link (Share → Copy event link), which opens the event on any device, or import their workspace file under <a href="#upcoming">Upcoming events</a> → Workspace → Import workspace.</p>`;
    $("secTimeline").hidden = true; $("secDetails") && ($("secDetails").hidden = true);
  }
  window.addEventListener("hashchange", view);
  if (isSample()) U.track("sample_opened");

  /* one recovery of rate-limited sources per briefing load; a new load (venue, schedule or ↻) cancels it */
  let recovery = null;
  async function run({ auto = false } = {}) {
    const g = ++gen, t0 = Date.now();
    if (recovery) { recovery.ctl.abort(); recovery = null; }
    coverageNote(null);
    delete document.body.dataset.firstUsable;
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
    $("briefUpdate").hidden = true; $("opsHandoff").hidden = true; $("secTimeline").hidden = true; $("gapFlag").hidden = true; printReady(false);
    /* nothing from the previous briefing (another venue, or guidance that has since failed) may stay on screen or in print */
    lastRes = null; lastView = null;
    if (chartController) { chartController.destroy(); chartController = null; }
    if (dashController) { dashController.destroy(); dashController = null; } $("evDash").hidden = true;
    lastHourly = null; ["shareImage", "tvExport"].forEach((id) => { $(id).disabled = true; $(id).title = "Available once the hourly forecast covers this event"; });
    if ($("map")._dispose) $("map")._dispose();
    ["alerts", "leadBody", "leadAfter", "evDash", "evCharts", "evGrid", "evGridDetail", "evGridLegend", "nwsEv", "blendLine", "hourlyValid", "map", "printView"].forEach((id) => { const el = $(id); if (el) el.innerHTML = ""; });
    head.setUpdated(null);
    $("decision").textContent = "Reading the guidance…"; $("coverage").hidden = true; document.body.dataset.readiness = ""; ["sourceCoverage", "keys", "schedule", "daylight", "hourlyDaylight", "detailBody", "phases", "changes", "checks", "timeline"].forEach((id) => { $(id).innerHTML = ""; });
    /* the schedule and daylight need no forecast: shown now, while the briefing loads, is pending or fails */
    showSchedule(C.event.windows(ev).filter((w) => w.key !== "all"));
    const alertsPromise = U.alerts(where);
    alertsPromise.then((a) => { if (g !== gen) return; alertsCheckedAt = Date.now(); officialBlock(a); });
    const endMs = Math.max(...C.event.windows(ev).map((w) => w.endMs)), days = 7; // the same forecast length Overview and Model Blend request, so this tab's answers for them are reused (briefing values are identical)
    const res = await U.load(where, { days });
    if (g !== gen) return;
    if (res.empty) {
      U.track("load_failed", { what: "models" });
      /* the guidance service is occasionally busy for a minute: try once more on our own before asking */
      /* one automatic retry, after 20 s or the provider's Retry-After if longer; a wait over two minutes is left to the planner */
      /* refused for rate limiting (HTTP 429): those requests are retried one at a time instead, never also reloaded whole */
      const limited = U.rateLimited(res.parts, where);
      if (!retried && !auto && limited.length) { retried = true; $("decision").textContent = "Guidance is slow to answer…"; const first = limited[0].retryAfter != null ? limited[0].retryAfter : U.RETRY.defaultMs / 1000;
        $("keys").innerHTML = `<p class="bx-note">The forecast service is limiting requests. Trying ${limited.length} source${limited.length > 1 ? "s" : ""} again one at a time, the first in ${Math.ceil(first)} seconds${limited[0].retryAfter != null ? " as the service asked" : ""}.</p>`; startRecovery(g, where, res, alertsPromise, t0, { fromEmpty: true }); return; }
      const wait = Math.max(20, fin(res.retryAfter) ? res.retryAfter : 0);
      if (!retried && wait <= 120) { retried = true; $("decision").textContent = "Guidance is slow to answer…"; $("keys").innerHTML = `<p class="bx-note">Trying again in ${wait} seconds.</p>`; setTimeout(() => { if (g === gen) run({ auto: true }); }, wait * 1000); return; }
      $("decision").textContent = "Weather guidance could not be loaded."; $("keys").innerHTML = `<p class="bx-note">${wait > 120 ? `The guidance service asked us to wait about ${Math.ceil(wait / 60)} minutes. Try ↻ after ${esc(fmt.clock(Date.now() + wait * 1000, ev.tz))}.` : "Try ↻ in a minute."}</p>`; retried = false; return;
    }
    retried = false;
    if (!res.NW || !res.NW.ok) U.track("load_failed", { what: "nws" });
    if (tzFromData) { ev = sampleAt({ ...tzFromData, tz: res.ctx.B.tz }); context(); document.body.dataset.tz = ev.tz; }
    if (!(await show(g, res, alertsPromise, t0))) return;
    /* the briefing and Print are ready; only now are refused sources tried again (never after an automatic whole reload,
       which already asked every source a second time) */
    if (!auto && U.rateLimited(res.parts, where).length) startRecovery(g, where, res, alertsPromise, t0);
  }
  /* put a usable result on screen and in print; false when a newer load has taken over */
  async function show(g, res, alertsPromise, t0, opts = {}) {
    if (tzFromPick) { tzFromPick = false; ev = { ...ev, tz: res.ctx.B.tz }; if (isStored()) ev = E.saveEvent(ev); context(); document.body.dataset.tz = ev.tz; }
    res.alerts = await alertsPromise; res.alertsAvailable = res.alerts.available !== false;
    if (g !== gen) return false;
    lastRes = res; render(res, opts);
    document.body.dataset.loaded = ev.loc.name; document.body.dataset.office = res.NW && res.NW.ok ? res.NW.office : "";
    if (!document.body.dataset.firstUsable) document.body.dataset.firstUsable = String(Date.now() - t0);
    return true;
  }
  /* ---- retry only the sources refused with HTTP 429; announce what came back as a coverage change ---- */
  function startRecovery(g, where, res, alertsPromise, t0, { fromEmpty = false } = {}) {
    const ctl = new AbortController(), log = [], total = U.rateLimited(res.parts, where).length;
    recovery = { ctl, g, log };
    document.body.dataset.recovery = "running";
    window.EventRecoveryLog = log; // read by the offline checks: which requests were retried, when, and how they ended
    const sources = () => lastRes && lastRes.feeds ? `${lastRes.feeds.used.length} of ${lastRes.feeds.used.length + lastRes.feeds.missing.length}` : "no";
    const pending = () => total - log.filter((x) => x.outcome).length;
    coverageNote(`Trying ${total} rate-limited source${total > 1 ? "s" : ""} again, one at a time. The forecast shown uses ${sources()} sources until then.`, "running");
    U.recover(where, res, { signal: ctl.signal,
      onAttempt: (x) => { if (g !== gen) return; if (!log.includes(x)) log.push(x);
        if (x.outcome !== "recovered") coverageNote(`${x.name} was still unavailable on its retry (${x.outcome}).${pending() ? ` Trying ${pending()} more, one at a time.` : ""}`, pending() ? "running" : "done"); },
      onUpdate: async (next, x) => {
        if (g !== gen || ctl.signal.aborted) return; // a late answer for a venue or schedule that is no longer shown
        const before = $("decision").textContent, hadBriefing = !!lastView;
        if (!(await show(g, next, alertsPromise, t0, { recovered: true }))) return;
        const after = $("decision").textContent;
        coverageNote(`Coverage update: ${x.name} answered on its retry. The briefing now uses ${sources()} sources. ${!hadBriefing ? "" : before === after ? "The forecast decision did not change." : `With it, the forecast changed: “${after}”`}${pending() ? ` Trying ${pending()} more, one at a time.` : ""}`, pending() ? "running" : "done");
      } })
      .then((out) => {
        if (g !== gen || out.cancelled) return;
        recovery = null; document.body.dataset.recovery = "done";
        if (fromEmpty && !lastView) { retried = false; $("decision").textContent = "Weather guidance could not be loaded."; $("keys").innerHTML = '<p class="bx-note">The forecast service kept limiting requests. Try ↻ in a minute.</p>'; coverageNote(null); }
      });
  }
  function coverageNote(text, state) {
    const host = $("coverageUpdate"); if (!host) return;
    host.hidden = !text; host.textContent = text || ""; host.dataset.state = state || "";
    if (!text) delete document.body.dataset.recovery;
  }
  /* the same event (venue, schedule) keeps its selected hour across refreshes; anything else starts at the focus hour */
  let selKey = null;
  const selectionKey = () => JSON.stringify([ev.id || ev.name, ev.loc.lat, ev.loc.lon, ev.tz, ev.times]);
  function context() {
    const w = C.event.windows(ev), ph = Object.fromEntries(w.map((x) => [x.key, x])), main = ph.event || ph.all, tz = ev.tz;
    $("sampleTag").hidden = !isSample(); $("resetBtn").hidden = isSample();
    $("evName").textContent = ev.name.replace(/ \(sample\)$/, "");
    $("evVenue").textContent = ev.loc.name;
    $("evWhen").textContent = main ? `${BUI.dateSpan(main.startMs, main.endMs, tz)}${ph.setup ? ` · setup from ${fmt.clock(ph.setup.startMs, tz)}` : ""}` : "";
    if (window.EventThreats) window.EventThreats.update(ev); // weather threats follow the venue and schedule on screen
  }

  /* the event schedule, once: each part with its venue-local times. The weather for these times is in the briefing above
     and hour by hour under Forecast details. */
  function schedule(b) { return BUI.scheduleHtml(b.phases, ev.tz); }
  /* sunrise and sunset at the venue (the Almanac's NOAA calculation), with one note when daylight matters */
  function daylight() { return window.EventDaylight && window.AlmanacCore ? window.EventDaylight.compute({ A: window.AlmanacCore, C, windows: C.event.windows(ev), lat: ev.loc.lat, lon: ev.loc.lon, tz: ev.tz }) : null; }
  function showSchedule(phases) {
    if (!phases.length) return;
    const D = daylight(); $("daylight").innerHTML = window.EventDaylight ? window.EventDaylight.rowHtml(D) : ""; $("hourlyDaylight").innerHTML = window.EventDaylight ? window.EventDaylight.lineHtml(D) : ""; document.body.dataset.daylight = D ? (D.note ? "note" : "times") : "";
    $("schedule").innerHTML = BUI.scheduleHtml(phases, ev.tz); $("secTimeline").hidden = false;
  }
  function renderSupport(res,b,now=Date.now()) {
    const open=$("sourceCoverage").querySelector('details')?.open;
    res.support=window.ForecastSupport.analyze({C,B:res.ctx.B,requested:res.RB?.ws||res.ctx.ws,rules:res.ctx.rules,
      start:Math.max(b.all.startMs,Math.floor(now/3600e3)*3600e3),end:b.all.endMs,now,names:U.NAMES,meta:res.ctx.meta||{},nws:res.NW});
    $("sourceCoverage").innerHTML=BUI.sourceHtml({...res,feeds:res.eventFeeds||res.feeds})+window.ForecastSupport.html(res.support);
    if(open)$("sourceCoverage").querySelector('details').open=true;
  }
  // Refresh ages without making provider requests or resetting the selected forecast hour.
  const refreshSupport=()=>{if(!document.hidden&&lastRes&&lastView)renderSupport(lastRes,lastView.b);};
  setInterval(refreshSupport,60000);
  document.addEventListener('visibilitychange',refreshSupport);
  /* ---- official alerts: their own block after the forecast concern; "none" only when the check succeeded ---- */
  let alertsCheckedAt = null, lastLead = null;
  const LEAD = window.EventLead;
  function officialBlock(a, L) {
    const lead = L || { official: LEAD.official(a, a.available !== false) };
    $("alerts").innerHTML = LEAD.officialHtml(lead, { tz: ev.tz, lat: ev.loc.lat, lon: ev.loc.lon, checkedAt: alertsCheckedAt });
  }
  /* the last hour the HRRR (the forecast radar's model) has guidance for, from the loaded data */
  function hrrrEnd(B) { const h = B.models.gfs_hrrr && B.models.gfs_hrrr.h, a = h && (h.precipitation || h.precipitation_probability); if (!a) return null;
    for (let i = a.length - 1; i >= 0; i--) if (fin(a[i])) return B.ms[i]; return null; }
  /* the lead: one concern, its timing and phases, what it means, what would change the plan, evidence, why it is flagged */
  function renderLead(res, { b, A, R, V, top, limited }) {
    const ctx = res.ctx, feeds = res.eventFeeds || res.feeds;
    const o = { b, A, R, S, V, ctx, feeds, alerts: res.alerts, alertsAvailable: res.alertsAvailable, tz: ev.tz, now: ctx.now, limit: ev.gust || 25, recipe: res.recipe,
      names: U.NAMES, checkedAt: alertsCheckedAt, update: lastView && lastView.update, mapOk: !!S.market(ev.loc.lat, ev.loc.lon).map, hrrrEnd: hrrrEnd(ctx.B) };
    const L = LEAD.model(o), W = LEAD.why(o, L); lastLead = { L, W, o }; lastView.lead = lastLead;
    document.body.dataset.leadKind = L.kind; document.body.dataset.official = L.official.state + (L.official.urgent.length ? "-urgent" : "");
    $("leadBody").innerHTML = LEAD.leadHtml(L, { tz: ev.tz, lat: ev.loc.lat, lon: ev.loc.lon });
    $("leadAfter").innerHTML = LEAD.afterHtml(L, W);
    officialBlock(res.alerts, L);
    const why = $("whyFlagged"); if (why) why.addEventListener("toggle", () => { if (why.open) U.track("why_flagged_opened"); });
  }
  /* evidence links: the hourly charts and the forecast radar open at the concern's hour (the shared time bus) */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-evidence]"); if (!a) return; e.preventDefault();
    const ms = +a.dataset.at; if (bus && fin(ms)) bus.set(ms, "lead");
    if (a.dataset.evidence === "charts") { const d = $("secHourly"); d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); d.querySelector("summary").focus({ preventScroll: true }); }
    else { const m = $("secMap"); m.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  function render(res, { recovered = false } = {}) {
    const ctx = res.ctx, tz = ev.tz, now = ctx.now, thr = { gust: ev.gust || 25 };
    if (isSample() && !ev.picked) { const v = ev.loc.name === S.SAMPLE_VENUE.name ? null : ev.loc; ev = { ...S.pickSample(ctx, C, ev.tz, [1, 2, 3], v), picked: true }; context(); }
    /* guidance reused from this tab's short cache keeps its original retrieval time and is labelled as a saved copy
       (a copy under a minute old is simply current) */
    const got = Object.keys(ctx.ws).map((id) => ctx.B.models[id]).filter(Boolean), oldest = Math.min(...got.map((m) => Date.parse(m.retrievedAt)).filter(fin));
    const saved = got.some((m) => m.fromCache && ctx.B.viewedAt - Date.parse(m.retrievedAt) > 60e3);
    head.setUpdated(saved && fin(oldest) ? oldest : ctx.B.viewedAt, { saved: saved && fin(oldest) }); updatedMs = saved && fin(oldest) ? oldest : ctx.B.viewedAt;
    const b = S.eventBrief(ctx, ev, thr);
    if (b.error) { $("decision").textContent = b.error; return; }
    const top = b.top, checks = S.checkAgain(ctx, b, U.NAMES), next = checks[0];
    /* one set of hourly values for everything below: the grid, the phase summaries and the printout */
    const V = window.HourlyViews.eventView({ C, S, M: window.HourlyModel, ctx, brief: b, thr, tz, now });
    const PS = window.HourlyModel.phaseSummaries(S, b, V.hrs, V.cover), live = PS.filter((p) => p.covered);
    const peak = live.filter((p) => p.peakPop).reduce((a, p) => (!a || p.peakPop.v > a.v ? p.peakPop : a), null);
    const lightAll = lightningOf(PS), nwsTh = window.HourlyModel.nwsThunder(ctx.nws, b.all.startMs, b.all.endMs);
    const A = BUI.attention({ b, V, S, thr }); // the same hourly values and venue limit feed the screen tracks and the printout
    const prevUpdate = lastView && lastView.update;
    lastView = { b, V, PS, peak, lightAll, nwsTh, R: null, checks, top, A, daylight: daylight() };
    if (recovered && prevUpdate) lastView.update = prevUpdate; // a late source is a coverage change, not a new visit
    /* ---- the decision, then the three facts that support it ---- */
    /* ---- how much of the event the guidance reaches: pending, partly covered or ready ---- */
    const R = S.readiness(b, ctx); document.body.dataset.readiness = R.state; lastView.R = R;
    /* missing or thin guidance for the event hours (EventLead.gaps): never read as "no concern" anywhere below */
    const G = LEAD.gaps({ b, V, R, feeds: BUI.eventFeeds(res.feeds, ctx.B, b.all.startMs, b.all.endMs), alertsAvailable: res.alertsAvailable, now, tz });
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
      $("coverage").className = "bx-cover"; $("coverage").hidden = R.state === "ready"; // full coverage is routine; a gap is stated here
      $("coverage").innerHTML = R.state === "ready" ? `<b>Forecast covers ${esc(R.names[0])} through ${esc(R.names[R.names.length - 1])}.</b>`
        : `<b>${esc(R.line)}</b><span class="bx-note"> · full briefing around ${esc(around(R.readyAt))}</span>${remind}`;
      const d = S.decision(b), text = !top && R.state === "partial" ? `No weather concern so far for ${R.inRange}.` : d.text;
      const displayText = BUI.headline(b, text, { limited: G.limited, incomplete: G.incomplete, partial: R.state === "partial" });
      /* the hazard word is highlighted wherever the headline puts it ("Rain likely…", "Plan for rain…") */
      const hz = top ? new RegExp(esc(top.noun).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
      $("decision").innerHTML = top ? esc(displayText).replace(hz, (m) => `<span class="hz" style="--tier:var(--${top.tier})">${m}</span>`) : esc(displayText);
      $("keys").innerHTML = callouts({ A, PS, live, peak, lightAll, next, R, tz, now, gapText: G.incompleteRain, gapAll: G.incomplete });
    }
    $("coverage").querySelectorAll("[data-remind]").forEach((a) => a.addEventListener("click", () => U.track("reminder_exported", { via: a.dataset.remind })));
    earlyOutlook(res, R, around);
    /* counted for this event's hours: a source whose forecast ends before the event is named, not counted */
    res.eventFeeds = BUI.eventFeeds(res.feeds, ctx.B, b.all.startMs, b.all.endMs);
    renderSupport(res,b,now);
    if (!recovered) briefingUpdate(ev, b, V, res); // a source answering late is a coverage change, not a new visit to compare
    monitoringHandoff(ev, b, now);
    gapFlag(res);
    if (R.state !== "pending") renderLead(res, { b, A, R, V, top }); else { ["leadBody", "leadAfter"].forEach((id) => { $(id).innerHTML = ""; }); officialBlock(res.alerts); }
    $("secTimeline").hidden = false;
    showSchedule(b.phases);
    if (R.state === "pending") { detail(b, ctx, thr); return; } // nothing at event time yet: schedule and sources only
    /* ---- phases: from the same hours as the grid ---- */
    $("phases").innerHTML = b.phases.map((p, i) => {
      const P = PS[i], past = p.cov.status === "past";
      const gap = G.missingHours.some((ms) => ms + H > p.startMs && ms < p.endMs); // a part with hours that have no guidance is not "no concern"
      if (!past && !P.covered && gap) return `<div class="bx-phase pending" data-phase="${esc(p.key)}"><div><div class="nm">${esc(p.label)} <span class="tm">${esc(fmt.span(p.startMs, p.endMs, tz))}</span></div><div style="margin-top:3px;font-size:13.5px">${st("monitor", "Guidance incomplete")} <span class="bx-note">no forecast data for these hours (missing, not zero)</span></div></div></div>`;
      if (!past && !P.covered) return `<div class="bx-phase pending"><div><div class="nm">${esc(p.label)} <span class="tm">${esc(fmt.span(p.startMs, p.endMs, tz))}</span></div><div style="margin-top:3px;font-size:13.5px">${st(null, "Pending")} <span class="bx-note">in range around ${esc(around(Math.max(now, p.startMs - R.lead)))}</span></div></div></div>`;
      const lvl = p.level, status = past ? st(null, "Done") : lvl ? st(S.LEVEL_TIER[lvl], `${S.HAZARDS[p.top].label}: ${S.LEVEL_WORD[lvl].toLowerCase()}`) : gap ? st("monitor", "Guidance incomplete") : st(null, "No concern found");
      const temp = P.temp ? (Math.round(P.temp.lo) === Math.round(P.temp.hi) ? `${Math.round(P.temp.hi)}°` : `${Math.round(P.temp.lo)}–${Math.round(P.temp.hi)}°`) : "—";
      const L = P.lightning, lw = L.state === "limited" ? `${L.word} · limited guidance` : L.word;
      return `<div class="bx-phase ${past ? "past" : ""}" data-phase="${esc(p.key)}"><div><div class="nm">${esc(p.label)} <span class="tm">${esc(fmt.span(p.startMs, p.endMs, tz))}</span></div><div style="margin-top:3px;font-size:13.5px">${status}</div></div><div class="tp">${temp}</div>
        <div class="mt"><span>Peak hourly rain chance: <b data-peak>${esc(P.peakPop ? U.pct(P.peakPop.v) : "—")}</b>${P.peakPop ? ` <span class="bx-note">${esc(BUI.hourWindow(P.peakPop.at, tz))}</span>` : ""}</span><span>Lightning potential: <b data-light>${esc(lw)}</b></span><span>Gusts to <b>${esc(P.gust ? mph(P.gust.v) : "—")}</b></span></div></div>`;
    }).join("");
    $("nwsEv").innerHTML = U.nwsBlock(res, tz, { from: b.all.startMs, to: b.all.endMs, max: 3 }) + thunderNote(nwsTh, lightAll, tz);
    $("blendLine").innerHTML = `<b>Model blend:</b> ${esc(U.blendLine(res))}. ${esc(res.verified)}`;
    $("changes").innerHTML = S.planChanges(b, (ms) => fmt.time(ms, tz)).map((t) => `<li>${esc(t)}</li>`).join("");
    $("checksNote").textContent = next ? `next ${fmt.time(next.at, tz)}` : "";
    $("checks").innerHTML = checks.length ? checks.map((c) => `<li><div class="when">${esc(fmt.time(c.at, tz))}<em>${esc(fmt.rel(c.at, now))}</em></div><div><b>${esc(c.what)}</b><div class="bx-note">${esc(c.why)}</div></div></li>`).join("") : '<li><div class="when">Now</div><div>Use radar, lightning detection and NWS warnings.</div></li>';
    /* ---- one selected time for the map and the hour-by-hour chart: the concern's start, or the event start ---- */
    const evStart = (b.phases.find((p) => p.key === "event") || b.phases[0]).startMs, focus = top && top.from != null ? top.from : evStart;
    const key = selectionKey(), prev = bus && selKey === key ? bus.get() : null;
    const keep = fin(prev) && prev >= b.all.startMs - 2 * H && prev < b.all.endMs + H ? prev : null;
    bus = U.timeBus(keep ?? focus); selKey = key;
    bus.on((ms) => { document.body.dataset.selected = ms; }); document.body.dataset.selected = bus.get();
    if (S.market(ev.loc.lat, ev.loc.lon).map) U.mapPanel($("map"), { view: "venue", field: "refc", place: { ...ev.loc }, bus, tz, now, autoRun: true, parts: b.phases.map((p) => ({ key: p.key, label: p.label, startMs: p.startMs, endMs: p.endMs })) }); else U.mapUnavailable($("map"), ev.loc);
    const s = Math.max(Math.floor(now / H) * H, b.all.startMs - 2 * H), e = b.all.endMs + H, hours = S.hourly(ctx, s, e);
    $("hourlyValid").innerHTML = `${esc(fmt.span(V.span[0], V.span[V.span.length - 1] + H, tz))} ${esc(fmt.zone(V.span[0], tz))} · tap an hour`;
    U.timeline($("timeline"), hours, { tz, now, bus, gustLine: thr.gust, mark: top && top.from != null ? { s: top.from, e: top.to, tier: top.tier } : null,
      bands: b.phases.map((p) => ({ s: p.startMs, e: p.endMs, label: p.label.toUpperCase(), fill: p.key === "event" ? "color-mix(in srgb, var(--text) 7%, transparent)" : "transparent" })) });
    hourGrid(V, now, res);
    winterRead(V);
    detail(b, ctx, thr);
    printView(res);
  }
  /* ---- the briefing's callouts: rain, lightning potential, and the third concern (gusts against the venue limit unless
     another hazard ranks higher), then the next check. Values come from the briefing engine and the attention model. ---- */
  function callouts({ A, PS, live, peak, lightAll, next, R, tz, now, gapText = "", gapAll = "" }) {
    /* the lead above already gives the primary concern's hours; its callout keeps only where in the schedule it falls */
    const item = (k) => A.items.find((x) => x.key === k), when = (it) => { const f = BUI.focusOf(it, A.phases), lead = A.items[0] === it && f.text;
      return [f.text, f.from != null && !lead ? fmt.span(f.from, f.to, tz) : ""].filter(Boolean).join(" · "); };
    const tierCls = (it) => it && it.tier ? ` class="ev-c" data-tier="${esc(it.tier)}" style="--tier:var(--${esc(it.tier)})"` : ' class="ev-c"';
    const dt = (label, it) => `<dt${it && it.tier ? ` data-tier="${esc(it.tier)}" style="--tier:var(--${esc(it.tier)})"` : ""}>${esc(label)}</dt>`;
    const rain = item("rain"), light = item("lightning"), wind = item("wind");
    /* each number and each label has its own job: the value line is the forecast number; the planning impact (the tier
       word and its practical line, EventLead.IMPLICATION) sits on its own line, so "Likely disruptive · up to 90%" can't
       read as a 90% chance of disruption. The primary concern's hours are in the lead line above. */
    const primary = A.items[0], impact = (it) => { const line = it && it.word && LEAD.IMPLICATION[it.key] ? LEAD.IMPLICATION[it.key][it.level] : "";
      return it && it.word ? `<span class="bx-note ev-impact" data-impact><b>${esc(it.word)}.</b> ${esc(line || "")}</span>` : ""; };
    const sub = (it) => (it === primary && it.word ? impact(it) : `<span class="bx-note">${it && it.word ? `<b>${esc(it.word)}.</b> ` : ""}${esc(when(it))}</span>`);
    /* the rain number is the highest single-hour chance of rain (HourlyModel.phaseSummaries peakPop), so it says so */
    const rainDd = rain ? `<dd${tierCls(rain)}>Up to ${esc(U.pct(peak ? peak.v : (rain.peak && rain.peak.v)))} in the likeliest hour${sub(rain)}</dd>`
      : peak && gapText ? `<dd class="ev-c" data-incomplete>Up to ${esc(U.pct(peak.v))} in hours with guidance<span class="bx-note">${esc(gapText)}.</span></dd>`
      : peak ? `<dd class="ev-c">Peak hourly ${esc(U.pct(peak.v))}<span class="bx-note">${esc(fmt.day(peak.at, tz))}, ${esc(BUI.hourWindow(peak.at, tz))} · no rain concern for the plan</span></dd>`
      : `<dd class="ev-c">${live.length ? "Unavailable" : "Not in range yet"}<span class="bx-note">${live.length ? "No hourly rain chance came back for these hours (not zero). Try ↻ later." : ""}</span></dd>`;
    const lnote = gapAll && lightAll.limited && lightAll.base === "Low" ? "Low is not zero; some hours have no data." : lightAll.note; // shorter when the lead already names the missing hours
    const lightDd = light && light === primary && light.word ? `<dd${tierCls(light)}>${esc(lightAll.word)} potential${impact(light)}</dd>`
      : `<dd${tierCls(light)}>${esc(lightAll.word)}<span class="bx-note">${light ? `${esc(when(light))}. ` : ""}${esc(lnote)}</span></dd>`;
    /* third: another hazard the engine ranks above wind (heat, snow, cold), else gusts against the venue's own limit */
    const other = A.items.find((x) => !["rain", "lightning", "wind"].includes(x.key) && (!wind || x.level > wind.level));
    let third;
    if (other) third = `${dt(other.label, other)}<dd${tierCls(other)}>${esc(when(other) || other.label)}${other === primary ? impact(other) : `<span class="bx-note"><b>${esc(other.word || "")}.</b></span>`}</dd>`;
    else {
      const g = live.filter((p) => p.gust), gmax = g.length ? Math.max(...g.map((p) => p.gust.v)) : null;
      third = wind && wind.windows.length ? `${dt("Gusts", wind)}<dd${tierCls(wind)}><b>Reach your ${A.limit} mph limit</b> · up to ${esc(mph(Math.max(...wind.windows.map((w) => w.peak ? w.peak.v : 0))))}${wind === primary && wind.word ? impact(wind) : `<span class="bx-note">${esc(when(wind))}</span>`}</dd>`
        : `${dt("Gusts", wind)}<dd${tierCls(wind)}>${fin(gmax) ? `Up to ${esc(mph(gmax))}` : "Unavailable"}<span class="bx-note">${fin(gmax) ? `${gapAll ? `Below your ${A.limit} mph limit; hours missing` : `Below your ${A.limit} mph venue limit`}` : "No gust guidance for these hours (not zero)"}</span></dd>`;
    }
    const nextDd = next ? `${vt(next.at, tz, now)}<span class="bx-note">${esc(next.what)}</span>` : "Now: use radar, lightning detection and NWS warnings.";
    return `${dt("Rain chance", rain)}${rainDd}${dt("Lightning potential", light)}${lightDd}${third}<dt>Next check</dt><dd class="ev-next">${nextDd}</dd>`;
  }
  /* a material gap in the guidance belongs next to the decision; routine counts stay under Sources */
  function gapFlag(res) {
    const f = res.eventFeeds || res.feeds, host = $("gapFlag"); if (!f || !host) return;
    const total = f.used.length + f.missing.length, material = total && f.used.length / total < 0.7;
    host.hidden = !material;
    if (material) host.innerHTML = `<span class="ev-kind" data-kind="missing">Missing guidance</span> Limited guidance: ${esc(f.used.length)} of ${esc(total)} model sources reach these hours (missing ${esc(f.missing.slice(0, 3).map((m) => `${m.name}${m.why ? ` (${m.why})` : ""}`).join(", "))}${f.missing.length > 3 ? " and more" : ""}). Treat timing as rough.`;
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
  /* ---- winter: what could stick, for events with snow or near-freezing precipitation ----
     The Winter page's own read (OpsCore.winter.stickRead) over the event's hours, from the same inputs that page uses:
     snow ensembles (the Winter page's saved weights, else its defaults) and the deterministic models' type, wet-bulb and
     ground temperature. Loaded only when the event's blend has snow, or precipitation at 35°F or colder. */
  let winterGen = 0;
  async function winterRead(V) {
    const my = ++winterGen, box = $("evWinter"), W = C.winter;
    const wintry = window.EventHourlyCharts.wintry(V); // the same test the dashboard's snow tile uses
    if (lastView) lastView.winter = null;
    if (!wintry || !box) { if (box) { box.hidden = true; box.innerHTML = ""; } return; }
    box.hidden = false; box.innerHTML = '<p class="bx-note">Winter: checking what could stick at the venue…</p>';
    const where = { lat: ev.loc.lat, lon: ev.loc.lon }, ES = C.config.winter, DS = C.config.winterDet;
    let E = null, D = null;
    try { [E, D] = await Promise.all([O.Data.loadEnsemble(ES, where), O.Data.loadModels(DS, { ...where, days: 5 })]); } catch (e) { E = E || { empty: true }; }
    if (my !== winterGen) return;
    const sv = O.store.get("ops_winter_models", {}) || {}, wOf = (m) => (sv[m.id] ? (sv[m.id].on ? sv[m.id].w : 0) : m.on === false ? 0 : m.w);
    const members = (k) => (!E || E.empty ? [] : ES.models.flatMap((m) => { const arrs = (E.ens[m.id] && E.ens[m.id][k]) || [], w = wOf(m); return w > 0 && arrs.length ? arrs.map((a) => ({ e: m, w: w / arrs.length, a })) : []; }));
    const snow = members("snowfall"), temp = members("temperature_2m");
    const s = E && !E.empty ? E.ms.indexOf(V.span[0]) : -1, eEnd = E && !E.empty ? E.ms.indexOf(V.span[V.span.length - 1]) : -1;
    let det = null;
    if (D && !D.empty) { det = { ms: D.ms, rows: {} }; Object.keys(D.models).forEach((id) => { const md = D.models[id]; det.rows[id] = W.series(md.h, D.times.length, md.elev); }); }
    const link = `winter.html?lat=${encodeURIComponent(ev.loc.lat)}&lon=${encodeURIComponent(ev.loc.lon)}&name=${encodeURIComponent(ev.loc.name)}`;
    if (s < 0 || eEnd < 0 || !snow.length) {
      box.innerHTML = `<div class="ev-wbox"><b>Winter: what could stick</b><p class="bx-note">The winter guidance didn't load or doesn't reach these hours yet, so sticking can't be judged here. <a href="${esc(link)}">Open Winter</a> for the latest.</p></div>`;
      return;
    }
    const R = W.stickRead(W.readHours({ ms: E.ms, snow, temp, det, ids: DS.models.map((m) => m.id), s, e: eEnd + 1, lead: 12 }), W.windowStats(snow, s, eEnd + 1));
    if (lastView) lastView.winter = R;
    const word = { favored: "Favored", possible: "Possible", unlikely: "Unlikely", none: "No snow" }, tierOf = { favored: "prepare", possible: "monitor", unlikely: "normal", none: "nodata" };
    const at = (ms) => U.fmt.clock ? U.fmt.clock(ms, ev.tz) : new Date(ms).toLocaleTimeString("en-US", { timeZone: ev.tz, hour: "numeric", minute: "2-digit" });
    const lvl = (k) => `<span class="evc-tbadge" style="--tier:var(--${tierOf[k] || "nodata"})">${esc(word[k] || k)}</span>`;
    const A = R.amount, inch = (x) => (fin(x) ? x.toFixed(1) : "—");
    box.innerHTML = `<div class="ev-wbox" data-winter="${esc(R.status)}"><b>Winter: what could stick</b>${R.status === "snow" ? `
      <div class="ev-wrow"><span>Grass &amp; elevated surfaces</span>${lvl(R.grass.level)}<span>Paved roads &amp; sidewalks</span>${lvl(R.paved.level)}</div>
      ${R.ranges.length ? `<p><b>When:</b> ${R.ranges.map((r) => `${esc(at(r.s))}–${esc(at(r.e + H))}`).join(", ")}</p>` : ""}
      ${R.callouts.length ? `<ul>${R.callouts.map((c) => `<li><b>${esc(at(c.ms))}</b> · ${esc(c.text)}</li>`).join("")}</ul>` : ""}
      ${A ? `<p class="bx-note">Snowfall potential: typical ${inch(A.p50)} in., higher outcome ${inch(A.p90)} in. (modeled snowfall before melting, ${esc(A.conf)} confidence). Bridges and untreated roads are not assessed.</p>` : ""}
      ${R.conflict ? `<p class="bx-note"><b>Conflicting guidance:</b> ${esc(R.conflict)}.</p>` : ""}`
      : R.status === "dry" ? '<p class="bx-note">Little or no snow in the winter guidance for these hours; nothing expected to stick.</p>'
      : '<p class="bx-note">Not enough winter guidance to judge what could stick.</p>'}
      <p class="bx-note"><a href="${esc(link)}">Open Winter</a> for the full read, odds and timing.</p></div>`;
  }
  function hourGrid(V, now, res) {
    const G = window.HourlyGrid;
    /* NWS hourly weather wording by hour, as a second opinion on precipitation type in the chart */
    let nwsTypes = []; try { const ax = res && res.NW && res.NW.ok ? window.OpsCore.nws.onAxis(res.NW, V.span) : null; nwsTypes = (ax && ax.ptype) || []; } catch (e) { nwsTypes = []; }
    if (chartController) chartController.destroy();
    const showHour = (ms) => { const i = V.span.indexOf(ms), d = $("evGridDetail"); if (i < 0) { d.hidden = true; return; } d.hidden = false; d.innerHTML = V.detail(i); };
    const pick = (ms) => (fin(ms) ? Math.min(V.span[V.span.length - 1], Math.max(V.span[0], Math.floor(ms / H) * H)) : V.span[0]);
    const sel0 = pick(bus && bus.get());
    const grid = G.render($("evGrid"), { axis: V.axis, rows: V.rows, selected: sel0, now, label: "Event hour by hour", caption: "Event weather hour by hour, setup through teardown",
      onSelect: (ms) => { if (bus) bus.set(ms, "grid"); showHour(ms); } });
    $("evGridLegend").innerHTML = `<p class="bx-note">Swipe for more hours · tap an hour for details.</p><details class="bx-more"><summary>How to read these hours</summary>${G.legend(V.legend)}<p class="bx-note">${esc(V.note)}</p><p class="bx-note">Follow NWS warnings and your venue's lightning policy for live decisions.</p></details>`;
    chartController = window.EventHourlyCharts.render($("evCharts"), { view: V, selected: sel0, tz: ev.tz, gustLimit: ev.gust || 25, nwsTypes, onSelect: ms => { if (bus) bus.set(ms, "variable-charts"); showHour(ms); } });
    /* the dashboard under the callouts: the same view, the same selected hour */
    if (dashController) dashController.destroy();
    $("evDash").hidden = false;
    dashController = window.EventHourlyCharts.dashboard($("evDash"), { view: V, tz: ev.tz, gustLimit: ev.gust || 25, selected: sel0, gapText: lastLead && lastLead.L.gaps.incomplete,
      onSelect: (ms) => { if (bus) bus.set(ms, "dashboard"); showHour(ms); }, onOpenHourly: () => $("hourlyLink").click() });
    showHour(sel0);
    lastHourly = { V, nwsTypes }; ["shareImage", "tvExport"].forEach((id) => { $(id).disabled = false; $(id).title = "Save a 1920 × 1080 image of these hours for a TV display"; });
    /* a display link (…#hourly) opens straight to these charts */
    if (location.hash === "#hourly" && !hourlyJumped) { hourlyJumped = true; const d = $("secHourly"); d.open = true;
      /* alerts, the map and late sources can still grow the page above; keep the section in place until the viewer acts */
      let user = false; const stop = () => { user = true; }; ["wheel", "touchstart", "keydown", "mousedown"].forEach((t) => addEventListener(t, stop, { once: true, passive: true }));
      [0, 400, 1200, 2500, 5000].forEach((ms) => setTimeout(() => { if (!user) d.scrollIntoView({ block: "start" }); }, ms)); }
    if (bus) bus.on((ms) => { const hm = Math.floor(ms / H) * H; if (V.span.includes(hm)) { grid.setSelected(hm); chartController.setSelected(hm); if (dashController) dashController.setSelected(hm); showHour(hm); } });
  }
  function briefingUpdate(event, b, V, res) {
    const host = $("briefUpdate"); host.hidden = true;
    if (!isStored() || isSample()) return;
    const history = window.EventBriefingHistory;
    const current = history.snapshot(event, b, V, res);
    let delta; try { delta = history.visit(localStorage, event.id, current); } catch { delta = { state: "first", stored: false, items: [] }; }
    lastView.update = delta;
    if (delta.state === "first" && delta.stored) return;
    const note = delta.state === "recipe-changed" ? "Your blend recipe changed. Weather trends start fresh with these weights." : delta.state === "sources-changed" ? "Model source coverage changed. Weather trends are not compared across different contributors or missing hours."
      : delta.state === "event-changed" ? "Your venue, schedule or gust limit changed. This briefing starts a new comparison."
      : delta.state === "no-overlap" ? "There is not enough matching future guidance to compare yet."
      : !delta.stored ? "This browser could not save the briefing. Changes cannot be remembered reliably."
      : delta.items.length ? "" : "No meaningful change in the matching event hours since your last briefing.";
    const better = delta.items.filter((x) => x.trend === "better").length, allBetter = better > 0 && better === delta.items.length;
    host.className = !delta.items.length ? "brief-update quiet" : allBetter ? "brief-update has-changes is-better" : "brief-update has-changes";
    host.hidden = !delta.items.length; // routine notes (no change, recipe or source changes) are not briefing news
    const tag = (x) => x.kind === "alert" ? "New alert" : x.trend === "better" ? "Better" : x.trend === "timing" ? "Timing" : "Worse";
    host.innerHTML = `${delta.items.length ? `<h2>${allBetter ? "Improved since your last briefing" : "Since your last briefing"}</h2><ul>`+delta.items.map(x=>`<li class="is-${x.trend||'alert'}"><b>${tag(x)}:</b> ${esc(x.text)}</li>`).join("")+'</ul>' : ''}${note ? `<p>${esc(note)}</p>` : ''}${delta.previousAt ? `<small>Compared with ${esc(BUI.date(delta.previousAt,event.tz))}, ${esc(fmt.clock(delta.previousAt,event.tz))} ${esc(fmt.zone(delta.previousAt,event.tz))}. Saved only in this browser.</small>` : ''}`;
  }
  function monitoringHandoff(event, b, now) {
    if (event.loc.approximate) { $("opsHandoff").hidden = true; return; }
    const K = window.EventOpsHandoff, host = $("opsHandoff"), data = K.payload(event,b,now), day = K.eventDay(event,b,now);
    let address = null; try { address = K.baseAddress(localStorage.getItem(K.KEY) || ""); } catch {}
    host.hidden = false; host.className = `ops-handoff${day ? " is-event-day" : ""}`;
    const url = address ? K.link(address,data) : null;
    host.innerHTML = `<h2>${day ? "Event day: switch to live monitoring" : "Ready for event day"}</h2><p>Use OPE for live radar and lightning monitoring. The forecast below is for planning; your venue’s lightning policy governs stop and resume decisions.</p><div class="ops-actions">${url ? `<a class="bx-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open venue in OPE ↗</a>` : ''}<button type="button" class="bx-btn" data-copy-venue>Copy venue &amp; coordinates</button></div><details class="bx-more" ${!address ? '' : ''}><summary>${address ? "OPE connection" : "Connect your OPE address"}</summary><p class="bx-note">OPE must be running with the Forecast Ops handoff update. This opens a venue review, not an automatic change to the monitored site.</p><label class="bx-note">OPE address <input type="url" data-ops-address placeholder="http://localhost:3000" value="${esc(address||'')}" /></label><button type="button" class="bx-btn" data-save-ops>Save address</button><p class="bx-note" data-ops-note aria-live="polite"></p></details><textarea data-copy-fallback hidden readonly aria-label="Venue details to copy"></textarea>`;
    if (!day) { const sec = $("secChecks"); sec.append(host); } else { $("briefUpdate").after(host); }
    host.querySelector("[data-save-ops]").onclick = () => { const v = K.baseAddress(host.querySelector("[data-ops-address]").value); const note = host.querySelector("[data-ops-note]"); if (!v) { note.textContent = "Use an HTTPS address, or HTTP localhost for your local OPE. Do not include a token, query string or password."; return; } try { localStorage.setItem(K.KEY,v); monitoringHandoff(event,b,now); } catch { note.textContent = "This browser could not save the address."; } };
    host.querySelector("[data-copy-venue]").onclick = async () => { const text = K.venueText(data), button = host.querySelector("[data-copy-venue]"); try { await navigator.clipboard.writeText(text); button.textContent = "Venue copied"; } catch { const box = host.querySelector("[data-copy-fallback]"); box.hidden = false; box.value = text; box.select(); } };
  }
  /* Early weather outlook (event-outlook.js): the daily Forecast Blend for the event dates the hourly briefing doesn't
     reach yet. Loaded only then, separately from the briefing; nothing hourly is inferred from it. */
  function earlyOutlook(res, R, around) {
    const host = $("outlook"), my = gen; host.innerHTML = ""; host.hidden = true; delete document.body.dataset.outlook;
    if (!R || (R.state !== "pending" && R.state !== "partial")) return;
    const ctx = res.ctx, tz = ev.tz, now = ctx.now, ms = ctx.B.ms, hourlyEndMs = ms.length ? ms[ms.length - 1] + H : now, windows = C.event.windows(ev);
    const f = { dayName: (k) => new Date(k + "T12:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }), when: (t) => `${around(t)} ${fmt.zone(t, tz)}` };
    const remind = R.state === "pending" && R.readyAt ? remindHtml(R.readyAt, "Add a calendar reminder") : "";
    const show = (rows) => {
      if (my !== gen) return;
      const m = window.EventOutlook.build({ windows, rows, hourlyEndMs, R, day: (t) => C.time.toLocal(t, tz).slice(0, 10), now });
      host.innerHTML = window.EventOutlook.html(m, f, remind); host.hidden = !host.innerHTML; document.body.dataset.outlook = m.state;
      if (R.state === "pending" && host.innerHTML) { $("coverage").hidden = true; $("coverage").innerHTML = ""; } // the outlook carries the timing and the one reminder
      host.querySelectorAll("[data-remind]").forEach((a) => a.addEventListener("click", () => U.track("reminder_exported", { via: a.dataset.remind })));
    };
    const start = Math.min(...windows.map((w) => w.startMs));
    if (start >= now + (window.EventOutlook.OUTLOOK_DAYS - 1) * 864e5) { show([]); return; } // past the daily outlook: no request
    host.hidden = false; host.innerHTML = '<p class="bx-note">Loading the early outlook…</p>';
    U.outlook({ lat: ev.loc.lat, lon: ev.loc.lon }, { ws: (res.RB || {}).ws || ctx.ws, rules: (res.RB || {}).rules || ctx.rules, NW: res.NW })
      .then((r) => show(r.empty ? null : r.rows), () => show(null));
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
    $("sourcesNote").textContent = lastRes && (lastRes.eventFeeds || lastRes.feeds) ? `${(lastRes.eventFeeds || lastRes.feeds).used.length} of ${(lastRes.eventFeeds || lastRes.feeds).used.length + (lastRes.eventFeeds || lastRes.feeds).missing.length} sources` : "";
    $("detailBody").innerHTML = `
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
    renderSupport(res, lastView.b);
    host.innerHTML = BUI.printMarkup({ ev, res: { ...res, feeds: res.eventFeeds || res.feeds }, view: lastView, S, U });
    printReady(true);
  }
  /* the top Print button is live only once a full briefing exists to print */
  function printReady(on) { const b = $("printTop"); if (!b) return; b.disabled = !on; b.title = on ? "Print or save the two-page briefing" : "Available once the briefing loads"; }
  /* TV displays: a 1920 x 1080 image of the hourly charts, or a link that opens them (no sign-in; the event is in the link) */
  /* ---- sharing: one set of actions, from the Share menu or from Hour by hour ---- */
  async function exportImage(themeSel, msg) {
    if (!lastHourly) { msg.textContent = "The image is available once the hourly forecast covers this event."; return; }
    const when = (ms) => (fin(ms) ? `${new Date(ms).toLocaleString("en-US", { timeZone: ev.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${fmt.zone(ms, ev.tz)}` : "—");
    const now = Date.now(), l = C.time.toLocal(now, ev.tz); // file name: the export time, venue-local
    try {
      const data = { title: $("evName").textContent, venue: $("evVenue").textContent, when: $("evWhen").textContent, takeaway: $("decision").textContent,
        daylight: lastView && lastView.daylight && lastView.daylight.note ? lastView.daylight.note : "",
        daylightLine: lastView && lastView.daylight && window.EventDaylight ? window.EventDaylight.lineText(lastView.daylight) : "",
        updated: when(updatedMs), zone: fmt.zone(lastHourly.V.span[0], ev.tz), view: lastHourly.V, nwsTypes: lastHourly.nwsTypes, gustLimit: ev.gust || 25,
        stamp: `${l.slice(0, 10)}-${l.slice(11, 13)}${l.slice(14, 16)}`,
        /* Match page theme (default), or an explicit Light / Dark PNG without switching the site */
        theme: themeSel.value === "match" ? (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark") : themeSel.value };
      window.__lastHourly = data; // read-only test hook
      const r = await window.EventTvExport.exportPng(data);
      msg.textContent = `Saved ${r.name} (1920 × 1080, ${data.theme}): the forecast as of ${data.updated}.`;
    } catch (e) { msg.textContent = `Couldn't make the image (${e.message}).`; }
  }
  async function copyLink(kind, msg) {
    const url = link() + (kind === "hourly" ? "#hourly" : "");
    const said = kind === "hourly" ? "Hourly display link copied. It opens Hour by hour on any device, with the forecast loaded when it's opened." : "Event link copied. It opens this event on any device, with the forecast loaded when it's opened.";
    try { await navigator.clipboard.writeText(url); msg.textContent = said; } catch (e) { msg.textContent = "Copy this link: " + url; }
    U.track("link_copied");
  }
  $("shareEvent").addEventListener("click", () => copyLink("event", $("shareMsg")));
  $("shareHourly").addEventListener("click", () => copyLink("hourly", $("shareMsg")));
  $("shareImage").addEventListener("click", () => exportImage($("shareTheme"), $("shareMsg")));
  $("tvExport").addEventListener("click", () => exportImage($("tvTheme"), $("hourlyShareMsg")));
  $("hourlyCopy").addEventListener("click", () => copyLink("hourly", $("hourlyShareMsg")));
  $("shareMenu").addEventListener("toggle", () => { if ($("shareMenu").open) $("shareMsg").textContent = ""; });
  /* a tap outside closes the menu; the page's own clicks (the image download) don't */
  document.addEventListener("click", (e) => { if (e.isTrusted && $("shareMenu").open && !$("shareMenu").contains(e.target)) $("shareMenu").open = false; });
  $("hourlyLink").addEventListener("click", (e) => { e.preventDefault(); const d = $("secHourly"); d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); d.querySelector("summary").focus({ preventScroll: true }); });
  $("printTop").addEventListener("click", () => { if (!lastRes) return; printView(lastRes); window.print(); });
  window.addEventListener("beforeprint", () => printView(lastRes));

  view();
})();
