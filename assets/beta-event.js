/* Event Manager beta: decision first. The weather takeaway leads; the schedule (setup → gates → event →
   teardown) is the graphic, with the affected window marked; the map and detail sit below.
   Opens on a sample event with no account or calendar; edits stay in this browser.
   Calculations: BetaStory over the Model Blend data, recipe and Core.event phase windows. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, S = window.BetaStory, U = window.BetaUI, $ = O.$, esc = O.esc, H = 3600e3;
  const { fmt, vt, st, deg, inch, mph, fin } = U;
  const KEY = "beta_event_v1", TZ = "America/New_York";
  const VENUES = [S.SAMPLE_VENUE, { name: "TQL Stadium, Cincinnati, OH", lat: 39.1111, lon: -84.5223 }, { name: "Great American Ball Park, Cincinnati, OH", lat: 39.0975, lon: -84.5066 },
    { name: "Paycor Stadium, Cincinnati, OH", lat: 39.0955, lon: -84.5161 }, { name: "Kings Island, Mason, OH", lat: 39.3448, lon: -84.2687 }, { name: "CVG airport, Hebron, KY", lat: 39.0446, lon: -84.6723 }];
  const head = U.header({ audience: "Event", other: { self: "event-beta.html", href: "meteorologist-beta.html", label: "Met" } });
  document.title = "Event briefing beta · Forecast Ops";
  const saved = () => { const e = O.store.get(KEY, null); return e && !C.event.validate(e).length ? e : null; };
  let ev = saved() || S.sampleEvent(C, Date.now(), TZ), gen = 0, lastRes = null, bus = null;
  const isSample = () => !!ev.sample;
  head.onRefresh(() => run());
  $("editBtn").addEventListener("click", openEditor);
  $("resetBtn").addEventListener("click", () => { try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } ev = S.sampleEvent(C, Date.now(), TZ); run(); });

  async function run() {
    const g = ++gen, where = { lat: ev.loc.lat, lon: ev.loc.lon };
    context();
    $("decision").textContent = "Reading the guidance…"; ["keys", "schedule", "phases", "changes", "checks", "timeline", "detail"].forEach((id) => { $(id).innerHTML = ""; });
    U.alerts(where).then((a) => { if (g !== gen) return; $("alerts").innerHTML = a.slice(0, 2).map((x) => `<div class="bx-alert" role="alert">${st("action", x.event + " in effect")}${x.ends ? `<span class="bx-note">until ${esc(fmt.time(Date.parse(x.ends), ev.tz))}</span>` : ""}<a href="https://forecast.weather.gov/MapClick.php?lat=${ev.loc.lat}&lon=${ev.loc.lon}" target="_blank" rel="noopener">NWS ↗</a></div>`).join(""); });
    const endMs = Math.max(...C.event.windows(ev).map((w) => w.endMs)), days = isSample() ? 5 : Math.min(7, Math.max(3, Math.ceil((endMs - Date.now()) / 864e5) + 1));
    const res = await U.load(where, { days });
    if (g !== gen) return;
    if (res.empty) { $("decision").textContent = "Weather guidance could not be loaded."; $("keys").innerHTML = '<p class="bx-note">Try ↻ in a minute.</p>'; return; }
    lastRes = res; render(res);
  }
  function context() {
    const w = C.event.windows(ev), ph = Object.fromEntries(w.map((x) => [x.key, x])), main = ph.event || ph.all, tz = ev.tz;
    $("sampleTag").hidden = !isSample(); $("resetBtn").hidden = isSample();
    $("evName").textContent = ev.name.replace(/ \(sample\)$/, "");
    $("evVenue").textContent = `· ${ev.loc.name.split(",")[0]}`;
    $("evWhen").textContent = main ? `${fmt.day(main.startMs, tz)} · ${fmt.clock(main.startMs, tz)}–${fmt.clock(main.endMs, tz)} ${fmt.zone(main.startMs, tz)}${ph.setup ? ` · setup from ${fmt.clock(ph.setup.startMs, tz)}` : ""}` : "";
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
    return `<div class="sch-bar">${segs}${over}</div><div class="sch-ticks">${ticks}</div><div class="sch-legend">${legend}</div>`;
  }

  function render(res) {
    const ctx = res.ctx, tz = ev.tz, now = ctx.now, thr = { gust: ev.gust || 25 };
    if (isSample() && !ev.picked) { ev = { ...S.pickSample(ctx, C, TZ), picked: true }; context(); }
    head.setUpdated(ctx.B.viewedAt);
    const b = S.eventBrief(ctx, ev, thr);
    if (b.error) { $("decision").textContent = b.error; return; }
    const top = b.top, checks = S.checkAgain(ctx, b, U.NAMES), next = checks[0];
    /* ---- the decision, then the three facts that support it ---- */
    if (b.coverage === "past") { $("decision").textContent = "This event has ended."; $("keys").innerHTML = '<dt>Next</dt><dd>Edit the event to brief a future date.</dd>'; return; }
    if (!b.phases.some((p) => p.r)) { $("decision").textContent = "Too early to brief this event."; $("keys").innerHTML = `<dt>Why</dt><dd>It is beyond the hourly guidance used here.<span class="bx-note">The briefing fills in about a week ahead.</span></dd>`; }
    else {
      const d = S.decision(b);
      $("decision").innerHTML = top ? esc(d.text).replace(esc(top.noun), `<span class="hz" style="--tier:var(--${top.tier})">${esc(top.noun)}</span>`) : esc(d.text);
      const nextDd = next ? `${vt(next.at, tz, now)}<span class="bx-note">${esc(next.what)}</span>` : "Now: use radar, lightning detection and NWS warnings.";
      if (top) {
        const [cw, cd] = top.certainty.word.split(" — ");
        $("keys").innerHTML = `<dt>Likely window</dt><dd>${top.from != null ? esc(fmt.span(top.from, top.to, tz)) : "No specific hours stand out"}<span class="bx-note">${esc(top.why)}</span></dd>
          <dt>Timing</dt><dd>${esc(cw)}<span class="bx-note">${esc(cd || "")}</span></dd><dt>Next check</dt><dd>${nextDd}</dd>`;
      } else {
        const live = b.phases.filter((p) => p.r), lo = Math.min(...live.map((p) => p.r.lo).filter(fin)), hi = Math.max(...live.map((p) => p.r.hi).filter(fin)), gust = Math.max(...live.map((p) => p.r.gust).filter(fin));
        const dd = S.disagreement(ctx, b.all.startMs, b.all.endMs);
        $("keys").innerHTML = `<dt>Expected</dt><dd>${fin(lo) ? `${Math.round(lo)}–${Math.round(hi)}°` : "—"}, gusts to ${mph(gust)}<span class="bx-note">Setup through teardown</span></dd>
          <dt>Guidance</dt><dd>${esc(dd && dd.overall ? S.AGREE_WORD[dd.overall] : "Limited")}<span class="bx-note">A quiet forecast can still change.</span></dd><dt>Next check</dt><dd>${nextDd}</dd>`;
      }
    }
    $("schedule").innerHTML = schedule(b, now);
    /* ---- phases ---- */
    $("phases").innerHTML = b.phases.map((p) => {
      const r = p.r, lvl = p.level, past = p.cov.status === "past";
      const status = past ? st(null, "Done") : !r ? st(null, "Beyond guidance") : lvl ? st(S.LEVEL_TIER[lvl], `${S.HAZARDS[p.top].label}: ${S.LEVEL_WORD[lvl].toLowerCase()}`) : st(null, "No concern");
      const rain = !r ? "—" : U.pct(r.chanceV != null ? r.chanceV * 100 : r.pop), rainLbl = r && r.chanceV == null && fin(r.pop) ? "Peak hourly precip chance" : "Precip chance";
      const th = !r || !r.thunder || r.thunder === "nodata" ? "—" : r.thunder === "normal" ? "low" : C.TIERS[r.thunder].word.toLowerCase();
      const temp = r && fin(r.lo) ? (Math.round(r.lo) === Math.round(r.hi) ? `${Math.round(r.hi)}°` : `${Math.round(r.lo)}–${Math.round(r.hi)}°`) : "—";
      return `<div class="bx-phase ${past ? "past" : ""}"><div><div class="nm">${esc(p.label)} <span class="tm">${esc(fmt.span(p.startMs, p.endMs, tz))}</span></div><div style="margin-top:3px;font-size:13.5px">${status}</div></div><div class="tp">${temp}</div>
        <div class="mt"><span>${rainLbl} <b>${esc(rain)}</b></span><span>Gusts <b>${esc(r ? mph(r.gust) : "—")}</b></span><span>Thunder signal <b>${esc(th)}</b></span></div></div>`;
    }).join("");
    $("changes").innerHTML = S.planChanges(b, (ms) => fmt.time(ms, tz)).map((t) => `<li>${esc(t)}</li>`).join("");
    $("checks").innerHTML = checks.length ? checks.map((c) => `<li><div class="when">${esc(fmt.time(c.at, tz))}<em>${esc(fmt.rel(c.at, now))}</em></div><div><b>${esc(c.what)}</b><div class="bx-note">${esc(c.why)}</div></div></li>`).join("") : '<li><div class="when">Now</div><div>Use radar, lightning detection and NWS warnings.</div></li>';
    /* ---- one selected time for the map and the hour-by-hour chart: the concern's start, or the event start ---- */
    const evStart = (b.phases.find((p) => p.key === "event") || b.phases[0]).startMs, focus = top && top.from != null ? top.from : evStart;
    bus = U.timeBus(focus);
    bus.on((ms) => { document.body.dataset.selected = ms; }); document.body.dataset.selected = focus;
    U.mapPanel($("map"), { view: "venue", field: "refc", place: { ...ev.loc }, bus, tz, now, autoRun: true });
    const s = Math.max(Math.floor(now / H) * H, b.all.startMs - 2 * H), e = b.all.endMs + H, hours = S.hourly(ctx, s, e);
    $("hourlyValid").innerHTML = `${esc(fmt.span(s, e, tz))} ${esc(fmt.zone(s, tz))} · tap to select`;
    U.timeline($("timeline"), hours, { tz, now, bus, gustLine: thr.gust, mark: top && top.from != null ? { s: top.from, e: top.to, tier: top.tier } : null,
      bands: b.phases.map((p) => ({ s: p.startMs, e: p.endMs, label: p.label.toUpperCase(), fill: p.key === "event" ? "color-mix(in srgb, var(--text) 7%, transparent)" : "transparent" })) });
    /* ---- supporting detail ---- */
    const ages = S.guidanceAge(ctx, U.NAMES), words = [...new Set((ctx.nws && ctx.nws.hourly ? ctx.nws.hourly : []).filter((h) => h.s < b.all.endMs && h.e > b.all.startMs).map((h) => h.short).filter(Boolean))];
    const mq = new URLSearchParams({ lat: ev.loc.lat, lon: ev.loc.lon, name: ev.loc.name });
    $("detail").innerHTML = `<h2>Detail</h2>
      <details><summary>All concerns</summary>${b.concerns.length ? `<ul class="bx-list" style="margin-top:8px">${b.concerns.map((c) => `<li><b>${esc(c.label)}: ${esc(c.word.toLowerCase())}</b> — ${esc(c.why)}. ${c.from != null ? "Most likely " + esc(fmt.span(c.from, c.to, tz)) + ". " : ""}Timing: ${esc(c.certainty.word)}.</li>`).join("")}</ul>` : '<p class="bx-note">No hazard reaches a planning threshold.</p>'}</details>
      <details><summary>NWS forecast wording</summary><p>${words.length ? esc(words.slice(0, 6).join(" → ")) : "NWS hourly wording unavailable."}</p></details>
      <details><summary>How this briefing is built</summary><p class="bx-note">Values are the Forecast Ops model blend (recipe: ${esc(lastRes.recipe)}), the same calculation as Model Blend's event table. Phase precipitation chance is the weighted ensemble estimate for at least 0.01″ during the phase; when unavailable, the peak hourly precipitation chance is shown. The thunder signal comes from the Thunder page and describes forecast potential, not detected lightning. Planning levels use display thresholds: gusts ${thr.gust}/35/45 mph; rain chance 20/50/70%; snow 0.05/0.3/1″; heat 90/95°; feels-like 32/20°. They are not calibrated probabilities. Timing certainty compares when each model source first shows the hazard.</p></details>
      <details><summary>Sources and how recent they are</summary><table class="bx-age"><tbody>${ages.map((a) => `<tr><td>${esc(a.name)}</td><td class="n ${a.late ? "bx-late" : ""}">${a.unknown ? "run time unknown" : esc(fmt.age(a.ageH)) + " old" + (a.late ? " · late" : "")}</td></tr>`).join("")}</tbody></table></details>
      <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="bx-btn" href="meteorologist-beta.html?${mq}">Meteorologist view of this venue</a><button class="bx-btn" type="button" id="printBtn">Print / PDF</button></p>`;
    $("printBtn").addEventListener("click", () => window.print());
    $("foot").innerHTML = `<span>Model guidance only — not an official forecast or warning. Follow NWS warnings and your venue's lightning policy.</span><span>Data: Open-Meteo (CC BY 4.0), NWS, NOAA HRRR. ${res.problems.length ? `Partial data: ${esc(res.problems.slice(0, 3).join("; "))}.` : ""}</span><span>Beta for colleague testing. Your edited event is stored only in this browser.</span>`;
  }

  /* ---------- editor: no account; stored in this browser only ---------- */
  function openEditor() {
    const t = ev.times, d = (x) => (x ? x.slice(0, 10) : ""), tm = (x) => (x ? x.slice(11, 16) : "");
    const vi = Math.max(0, VENUES.findIndex((v) => Math.abs(v.lat - ev.loc.lat) < 1e-3 && Math.abs(v.lon - ev.loc.lon) < 1e-3));
    $("editForm").innerHTML = `<h2 id="editTitle">Edit event</h2>
      <label>Event name<input id="fName" value="${esc(ev.sample ? "" : ev.name)}" placeholder="${esc(ev.name)}"></label>
      <label>Venue<select id="fVenue">${VENUES.map((v, i) => `<option value="${i}" ${i === vi ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
      <label>Date<input type="date" id="fDate" value="${d(t.start)}"></label>
      <div class="two"><label>Setup starts<input type="time" id="fSetup" value="${tm(t.setup)}"></label><label>Gates open<input type="time" id="fGates" value="${tm(t.gates)}"></label></div>
      <div class="two"><label>Event starts<input type="time" id="fStart" value="${tm(t.start)}" required></label><label>Event ends<input type="time" id="fEnd" value="${tm(t.end)}" required></label></div>
      <div class="two"><label>Teardown ends<input type="time" id="fTear" value="${tm(t.teardown)}"></label><label>Gust limit (mph)<input type="number" id="fGust" min="10" max="60" value="${ev.gust || 25}"></label></div>
      <p class="bx-note" style="margin:0">Times are Eastern. An end or teardown time earlier than the start is read as after midnight. Setup, gates and teardown are optional.</p>
      <p class="err" id="fErr" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="bx-btn" value="cancel" formnovalidate>Cancel</button><button class="bx-btn primary" id="fSave" value="save">Save event</button></div>`;
    $("editDlg").showModal();
    $("fSave").addEventListener("click", (e) => {
      e.preventDefault();
      const date = $("fDate").value, add = (x, n) => new Date(Date.parse(x + "T12:00Z") + n * 864e5).toISOString().slice(0, 10);
      const st = $("fStart").value, at = (v, after) => (!v ? null : `${v < st && after ? add(date, 1) : date}T${v}`);
      const times = { setup: at($("fSetup").value, false), gates: at($("fGates").value, false), start: date && st ? `${date}T${st}` : null, end: at($("fEnd").value, true), teardown: at($("fTear").value, true) };
      Object.keys(times).forEach((k) => { if (!times[k]) delete times[k]; });
      const v = VENUES[+$("fVenue").value], next = { id: "beta", name: $("fName").value.trim() || "My event", loc: { ...v }, tz: TZ, times, gust: Math.min(60, Math.max(10, +$("fGust").value || 25)) };
      const errs = C.event.validate(next);
      if (errs.length) { $("fErr").textContent = errs.join(" "); $("fErr").hidden = false; return; }
      ev = next; O.store.set(KEY, ev); $("editDlg").close(); run();
    });
  }
  run();
})();
