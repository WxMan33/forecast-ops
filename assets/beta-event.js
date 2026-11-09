/* Event Manager beta: a phone-first briefing for one outdoor event. Opens on a sample event with no account
   or calendar connection; edits stay in this browser. Calculations: BetaStory over the Model Blend data,
   recipe and event phase windows (Core.event), so values match Model Blend's event table. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, S = window.BetaStory, U = window.BetaUI, $ = O.$, esc = O.esc, H = 3600e3;
  const { fmt, deg, inch, mph, fin } = U;
  const KEY = "beta_event_v1", TZ = "America/New_York";
  const VENUES = [S.SAMPLE_VENUE, { name: "TQL Stadium, Cincinnati, OH", lat: 39.1111, lon: -84.5223 }, { name: "Great American Ball Park, Cincinnati, OH", lat: 39.0975, lon: -84.5066 },
    { name: "Paycor Stadium, Cincinnati, OH", lat: 39.0955, lon: -84.5161 }, { name: "Kings Island, Mason, OH", lat: 39.3448, lon: -84.2687 }, { name: "CVG airport, Hebron, KY", lat: 39.0446, lon: -84.6723 }];
  const head = U.header({ audience: "Event manager", other: { self: "event-beta.html", href: "meteorologist-beta.html", label: "Meteorologist view" } });
  document.title = "Event briefing beta · Forecast Ops";
  const saved = () => { const e = O.store.get(KEY, null); return e && !C.event.validate(e).length ? e : null; };
  let ev = saved() || S.sampleEvent(C, Date.now(), TZ), gen = 0, lastRes = null;
  const isSample = () => !!ev.sample;

  head.onRefresh(() => run());
  $("editBtn").addEventListener("click", openEditor); $("editBtn2").addEventListener("click", openEditor);
  $("resetBtn").addEventListener("click", () => { try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } ev = S.sampleEvent(C, Date.now(), TZ); run(); });
  $("printBtn").addEventListener("click", () => window.print());

  async function run() {
    const g = ++gen, where = { lat: ev.loc.lat, lon: ev.loc.lon };
    header();
    $("verdict").innerHTML = '<div class="bx-loading">Reading the guidance…</div>';
    ["phases", "changes", "checks", "timeline", "detail"].forEach((id) => { $(id).innerHTML = ""; });
    $("mapFull").href = U.map($("map"), { view: "venue", field: "refc", place: { ...ev.loc } });
    U.alerts(where).then((a) => { if (g !== gen) return; $("alerts").innerHTML = a.slice(0, 2).map((x) => `<div class="bx-alert" role="alert"><span>⚠</span><span>${esc(x.event)} in effect${x.ends ? ` until ${esc(fmt.time(Date.parse(x.ends), ev.tz))}` : ""}</span><a href="https://forecast.weather.gov/MapClick.php?lat=${ev.loc.lat}&lon=${ev.loc.lon}" target="_blank" rel="noopener">NWS ↗</a></div>`).join(""); });
    const endMs = Math.max(...C.event.windows(ev).map((w) => w.endMs)), days = isSample() ? 5 : Math.min(7, Math.max(3, Math.ceil((endMs - Date.now()) / 864e5) + 1));
    const res = await U.load(where, { days });
    if (g !== gen) return;
    if (res.empty) { $("verdict").innerHTML = '<div class="bx-err">Weather guidance could not be loaded. Try ↻ in a minute.</div>'; return; }
    lastRes = res; render(res);
  }

  function header() {
    const w = C.event.windows(ev), ph = Object.fromEntries(w.map((x) => [x.key, x])), main = ph.event || ph.all, tz = ev.tz;
    $("sample").hidden = !isSample(); $("resetBtn").hidden = isSample();
    $("evVenue").textContent = `Venue · ${ev.loc.name}`;
    $("evName").textContent = ev.name;
    $("evWhen").textContent = main ? `${fmt.day(main.startMs, tz)} · ${fmt.clock(main.startMs, tz)} – ${fmt.clock(main.endMs, tz)} ${fmt.zone(main.startMs, tz)}` : "";
    $("evPhasesLine").textContent = [ph.setup && `Setup from ${fmt.time(ph.setup.startMs, tz)}`, ph.gates && `gates ${fmt.clock(ph.gates.startMs, tz)}`, ph.teardown && `teardown until ${fmt.time(ph.teardown.endMs, tz)}`].filter(Boolean).join(" · ");
  }

  const meter = (lvl) => { const n = { high: 3, medium: 2, low: 1 }[lvl] || 0; return `<span class="bx-meter" aria-hidden="true">${[1, 2, 3].map((k) => `<i class="${k <= n ? "on" : ""}"></i>`).join("")}</span>`; };
  const phaseList = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`).toLowerCase();

  function render(res) {
    const ctx = res.ctx, tz = ev.tz, now = ctx.now, thr = { gust: ev.gust || 25 };
    if (isSample() && !ev.picked) { ev = { ...S.pickSample(ctx, C, TZ), picked: true }; header(); }
    head.setUpdated(ctx.B.viewedAt);
    const b = S.eventBrief(ctx, ev, thr);
    if (b.error) { $("verdict").innerHTML = `<div class="bx-err">${esc(b.error)}</div>`; return; }
    const top = b.top;
    /* ---- verdict ---- */
    if (b.coverage === "past") $("verdict").innerHTML = `<div class="bx-verdict" style="--tier:var(--nodata)"><span class="bx-kicker">Event</span><div class="hz"><span class="bx-hero" style="font-size:var(--bx-big)">This event has ended</span></div><p class="bx-sub">Edit the event to brief a future date.</p></div>`;
    else if (!b.phases.some((p) => p.r)) $("verdict").innerHTML = `<div class="bx-verdict" style="--tier:var(--nodata)"><span class="bx-kicker">Biggest weather concern</span><div class="hz"><span class="bx-hero" style="font-size:var(--bx-big)">Too early to say</span></div><p class="bx-sub">The event is beyond the hourly guidance used here. The briefing fills in about a week ahead.</p></div>`;
    else if (top) {
      const also = b.concerns.slice(1).map((c) => `${c.label} (${c.word.toLowerCase()})`);
      $("verdict").innerHTML = `<div class="bx-verdict" style="--tier:var(--${top.tier})"><span class="bx-kicker">Biggest weather concern</span>
        <div class="hz"><span class="bx-hero">${esc(top.label)}</span><span class="bx-chip">${esc(top.word)}</span></div>
        <p class="bx-sub" style="margin-top:6px">${esc(top.why)}.</p>
        <div class="bx-facts">
          <div class="bx-fact"><span class="bx-kicker">When it matters</span><div class="v">${top.from != null ? esc(fmt.span(top.from, top.to, tz)) : "No specific hours stand out"}</div><span class="bx-note">${top.phases.length ? "During " + esc(phaseList(top.phases)) : ""}${top.from != null ? ` · starts ${esc(fmt.rel(top.from, now))}` : ""}</span></div>
          <div class="bx-fact"><span class="bx-kicker">How certain is the timing</span><div class="v">${meter(top.certainty.level)}${esc(top.certainty.word.split(" — ")[0])}</div><span class="bx-note">${esc(top.certainty.word.split(" — ")[1] || "")}</span></div>
        </div>${also.length ? `<p class="bx-note" style="margin:14px 0 0">Also watch: ${esc(also.join(", "))}.</p>` : ""}</div>`;
    } else {
      const d = S.disagreement(ctx, b.all.startMs, b.all.endMs), live = b.phases.filter((p) => p.r);
      const lo = Math.min(...live.map((p) => p.r.lo).filter(fin)), hi = Math.max(...live.map((p) => p.r.hi).filter(fin)), gust = Math.max(...live.map((p) => p.r.gust).filter(fin));
      $("verdict").innerHTML = `<div class="bx-verdict" style="--tier:var(--normal)"><span class="bx-kicker">Biggest weather concern</span><div class="hz"><span class="bx-hero" style="font-size:var(--bx-big)">None standing out</span><span class="bx-chip">Low</span></div>
        <p class="bx-sub" style="margin-top:6px">No phase reaches a planning threshold for rain, wind, lightning, heat, cold or snow.</p>
        <div class="bx-facts"><div class="bx-fact"><span class="bx-kicker">Expected</span><div class="v">${fin(lo) ? `${Math.round(lo)}–${Math.round(hi)}°` : "—"} · gusts to ${mph(gust)}</div><span class="bx-note">Across setup through teardown</span></div>
        <div class="bx-fact"><span class="bx-kicker">How sure</span><div class="v">${meter(d && d.overall === "agree" ? "high" : d && d.overall === "some" ? "medium" : "low")}${esc(d && d.overall ? S.AGREE_WORD[d.overall] : "Limited guidance")}</div><span class="bx-note">A quiet forecast can still change; see when to check again.</span></div></div></div>`;
    }
    /* ---- phases ---- */
    $("phasesValid").innerHTML = `Times in <b>${esc(fmt.zone(b.all.startMs, tz))}</b>`;
    $("phases").innerHTML = b.phases.map((p) => {
      const r = p.r, lvl = p.level, tier = S.LEVEL_TIER[lvl];
      const status = p.cov.status === "past" ? "Done" : !r ? "Beyond guidance" : lvl ? `${S.HAZARDS[p.top].label}: ${S.LEVEL_WORD[lvl]}` : "No concern";
      const rain = !r ? "—" : r.chanceV != null ? `${Math.round(r.chanceV * 100)}%` : fin(r.pop) ? `${Math.round(r.pop)}%` : "—";
      const lt = !r || !r.thunder || r.thunder === "nodata" ? "—" : r.thunder === "normal" ? "Low" : C.TIERS[r.thunder].word.charAt(0) + C.TIERS[r.thunder].word.slice(1).toLowerCase();
      return `<div class="bx-phase ${p.cov.status === "past" ? "past" : ""}"><div><div class="nm">${esc(p.label)}</div><div class="tm">${esc(fmt.span(p.startMs, p.endMs, tz))}</div><div style="margin-top:6px"><span class="bx-chip" style="--tier:var(--${p.cov.status === "past" || !r ? "nodata" : tier})">${esc(status)}</span></div></div>
        <div class="tp">${r && fin(r.lo) ? (Math.round(r.lo) === Math.round(r.hi) ? `${Math.round(r.hi)}°` : `${Math.round(r.lo)}–${Math.round(r.hi)}°`) : "—"}</div>
        <div class="ph-meta"><div class="mt"><span>${r && r.chanceV == null && fin(r.pop) ? "Peak hourly precip chance" : "Precip chance"}</span> <b>${esc(rain)}</b></div><div class="mt"><span>Gusts</span> <b>${esc(r ? mph(r.gust) : "—")}</b></div><div class="mt"><span>Thunder signal</span> <b>${esc(lt)}</b></div></div></div>`;
    }).join("");
    /* ---- what could change, when to check ---- */
    $("changes").innerHTML = S.planChanges(b, (ms) => fmt.time(ms, tz)).map((t) => `<li>${esc(t)}</li>`).join("");
    const checks = S.checkAgain(ctx, b, U.NAMES);
    $("checks").innerHTML = checks.length ? checks.map((c) => `<li><span class="bx-time">${esc(fmt.time(c.at, tz))}<span class="rel">${esc(fmt.rel(c.at, now))}</span></span><div><b>${esc(c.what)}</b></div><div class="bx-note">${esc(c.why)}</div></li>`).join("") : '<li><b>Now</b><div class="bx-note">The event is close: use radar, lightning detection and NWS warnings.</div></li>';
    /* ---- hour by hour ---- */
    const s = Math.max(Math.floor(now / H) * H, b.all.startMs - 2 * H), e = b.all.endMs + H, hours = S.hourly(ctx, s, e);
    $("hourlyValid").innerHTML = `<b>${esc(fmt.span(s, e, tz))}</b> · ${esc(fmt.zone(s, tz))}`;
    const fills = { setup: "color-mix(in srgb, var(--accent) 8%, transparent)", gates: "color-mix(in srgb, var(--accent) 14%, transparent)", event: "color-mix(in srgb, var(--accent) 20%, transparent)", teardown: "color-mix(in srgb, var(--accent) 8%, transparent)" };
    U.timeline($("timeline"), hours, { tz, now, bands: b.phases.map((p) => ({ s: p.startMs, e: p.endMs, label: p.label.toUpperCase(), fill: fills[p.key] })), gustLine: thr.gust, height: innerWidth < 560 ? 280 : 300 });
    /* ---- supporting detail ---- */
    const ages = S.guidanceAge(ctx, U.NAMES), wording = (ctx.nws && ctx.nws.hourly ? ctx.nws.hourly : []).filter((h) => h.s < b.all.endMs && h.e > b.all.startMs).map((h) => h.short).filter(Boolean);
    const words = [...new Set(wording)];
    const mq = new URLSearchParams({ lat: ev.loc.lat, lon: ev.loc.lon, name: ev.loc.name });
    $("detail").innerHTML = `<h2 class="bx-h2" style="margin-bottom:8px">Supporting detail</h2>
      <details><summary>All concerns by level</summary>${b.concerns.length ? `<ul class="bx-list">${b.concerns.map((c) => `<li><b>${esc(c.label)} · ${esc(c.word)}</b><div class="bx-note">${esc(c.why)}. ${c.from != null ? "Most likely " + esc(fmt.span(c.from, c.to, tz)) + "." : ""} Timing: ${esc(c.certainty.word)}.</div></li>`).join("")}</ul>` : '<p class="bx-note">No hazard reaches a planning threshold.</p>'}</details>
      <details><summary>NWS forecast wording for the event</summary><p>${words.length ? esc(words.slice(0, 6).join(" → ")) : "NWS hourly wording unavailable."}</p></details>
      <details><summary>How this briefing is built</summary><p class="bx-note">Values are the Forecast Ops model blend (recipe: ${esc(lastRes.recipe)}), the same calculation as Model Blend's event table. Phase precipitation chance is the weighted ensemble estimate for at least 0.01″ during the phase. When unavailable, the peak hourly precipitation chance is shown if available. Thunder signal comes from the Thunder page and describes forecast potential. Planning levels use display thresholds: gusts ${thr.gust}/35/45 mph; rain chance 20/50/70%; snow 0.05/0.3/1″; heat 90/95°; feels-like 32/20°. They are not calibrated probabilities. Timing certainty compares when each model source first shows the hazard.</p></details>
      <details><summary>Sources and how recent they are</summary><table class="bx-age"><tbody>${ages.map((a) => `<tr><td>${esc(a.name)}</td><td class="n ${a.late ? "bx-late" : ""}">${a.unknown ? "run time unknown" : esc(fmt.age(a.ageH)) + " old" + (a.late ? " · late" : "")}</td></tr>`).join("")}</tbody></table></details>
      <p style="margin-top:14px"><a class="bx-btn" href="meteorologist-beta.html?${mq}">Meteorologist view of this venue →</a></p>`;
    $("foot").innerHTML = `<span>Model guidance only — not an official forecast or warning. Follow NWS warnings and your venue's lightning policy.</span><span>Data: Open-Meteo (CC BY 4.0), NWS, NOAA HRRR. ${res.problems.length ? `Partial data: ${esc(res.problems.slice(0, 3).join("; "))}.` : ""}</span><span>Beta build for colleague testing. Your edited event is stored only in this browser.</span>`;
  }

  /* ---------- editor: no account; stored in this browser only ---------- */
  function openEditor() {
    const t = ev.times, d = (x) => (x ? x.slice(0, 10) : ""), tm = (x) => (x ? x.slice(11, 16) : "");
    const vi = Math.max(0, VENUES.findIndex((v) => Math.abs(v.lat - ev.loc.lat) < 1e-3 && Math.abs(v.lon - ev.loc.lon) < 1e-3));
    $("editForm").innerHTML = `<h2 class="bx-h2" id="editTitle">Edit event</h2>
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
