/* Event Manager beta: Upcoming events and saved venues (stored in this browser via EventStore).
   - Upcoming: one row per event with venue, local time and one briefing status; events that need a weather
     decision first, then by start time; open, edit or remove in one tap.
   - Saved venues: name, coordinates and default setup / gates / teardown offsets (and the tent gust limit),
     applied to new events at that venue; any event can override a time for itself.
   Statuses reuse the briefing's own calculation (BetaStory.eventBrief + readiness), one guidance load per venue. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, S = window.BetaStory, U = window.BetaUI, E = window.EventStore, $ = O.$, esc = O.esc, H = 3600e3;
  const { fmt, st, fin } = U;
  const myTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } })();
  const hm = (s) => (s ? s.slice(11, 16) : "");
  const nextDay = (d, n) => new Date(Date.parse(d + "T12:00Z") + n * 864e5).toISOString().slice(0, 10);
  const winOf = (ev) => { try { const w = C.event.windows(ev), all = w.find((x) => x.key === "all"), main = w.find((x) => x.key === "event") || all; return { all, main }; } catch (e) { return null; } };
  const offText = (d) => { const h = (m) => (m % 60 ? `${Math.floor(m / 60) ? Math.floor(m / 60) + " h " : ""}${m % 60} min` : `${m / 60} h`); return `Setup ${h(d.setup)} before · gates ${h(d.gates)} before · teardown ${h(d.teardown)} after · gust limit ${d.gust} mph`; };

  /* ---------------- event editor (new, existing, or a sample/shared event saved as new) ---------------- */
  function editEvent(target, { onSaved, title } = {}) {
    U.track("custom_event_started");
    const stored = target && target.id && E.getEvent(target.id) ? E.getEvent(target.id) : null, saved = E.venues(), vns = [...saved, ...E.BUILTIN.filter((b) => !saved.some((v) => E.norm(v.name) === E.norm(b.name)))];
    const base = stored || target || null;
    let venue = base && base.venueId ? E.getVenue(base.venueId) : !base ? vns[0] || null : null;
    let city = base && !venue ? { name: base.loc.name, lat: base.loc.lat, lon: base.loc.lon, tz: base.tz } : { name: "", lat: null, lon: null, tz: null };
    /* an event's own times stay its own: overrides at a saved venue, every time when it has no saved venue */
    const dirty = new Set(stored ? (venue ? stored.overrides || [] : ["setup", "gates", "teardown"].filter((k) => stored.times[k])) : []);
    const t = base ? base.times : {};
    const defDate = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const opt = (v) => `<option value="${esc(v.id)}" ${venue && venue.id === v.id ? "selected" : ""}>${esc(v.name)}</option>`;
    $("editForm").innerHTML = `<h2 id="editTitle">${esc(title || (stored ? "Edit event" : "Add event"))}</h2>
      <label>Event name<input id="fName" maxlength="80" value="${esc(base && !base.sample ? base.name : "")}" placeholder="${esc(base ? base.name : "e.g. FC Cincinnati vs. Columbus")}"></label>
      <label>Venue<select id="fVenueSel">${vns.map(opt).join("")}<option value="" ${venue ? "" : "selected"}>${base && !venue && !base.sample && fin(base.loc.lat) ? "This event's venue (not saved)" : "New venue…"}</option></select></label>
      <div id="fNewVenue" class="bx-subform">
        <label>Venue name<input id="fVenue" maxlength="80" value="${esc(base && !venue && !base.sample ? (fin(base.loc.lat) ? base.loc.name : String(base.loc.name || "").split(",")[0].replace(/^Venue not set$/, "")) : "")}" placeholder="e.g. TQL Stadium"></label>
        <div><span class="bx-cap" style="display:block;margin-bottom:4px">Venue city</span><div id="fCity" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"></div></div>
        <details><summary class="bx-note">Exact coordinates (optional)</summary><div class="two" style="margin-top:8px"><label>Latitude<input id="fLat" inputmode="decimal" value="${fin(city.lat) ? city.lat : ""}"></label><label>Longitude<input id="fLon" inputmode="decimal" value="${fin(city.lon) ? city.lon : ""}"></label></div></details>
        <label class="bx-check"><input type="checkbox" id="fSaveVenue" ${base && !base.sample && !venue && fin(base.loc.lat) ? "" : "checked"}> Save this venue and its schedule for future events</label>
      </div>
      <label>Date<input type="date" id="fDate" value="${esc(t.start ? t.start.slice(0, 10) : defDate)}"></label>
      <div class="two"><label>Event starts<input type="time" id="fStart" value="${esc(hm(t.start) || "19:30")}" required></label><label>Event ends<input type="time" id="fEnd" value="${esc(hm(t.end) || "21:30")}" required></label></div>
      <fieldset class="bx-sched-f"><legend>Schedule</legend>
        <div class="two"><label>Setup starts<input type="time" id="fSetup" data-k="setup"></label><label>Gates open<input type="time" id="fGates" data-k="gates"></label></div>
        <div class="two"><label>Teardown ends<input type="time" id="fTear" data-k="teardown"></label><label>Gust limit (mph)<input type="number" id="fGust" min="10" max="60"></label></div>
        <p class="bx-note" id="fDefNote" style="margin:0"></p>
        <label class="bx-check" id="fMakeDefBox"><input type="checkbox" id="fMakeDef"> <span id="fMakeDefTxt">Make this schedule the venue default</span></label>
      </fieldset>
      <p class="bx-note" style="margin:0" id="fTzNote"></p>
      <p class="err" id="fErr" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="bx-btn" value="cancel" formnovalidate>Cancel</button><button class="bx-btn primary" id="fSave" value="save">Save event</button></div>`;
    const F = { setup: $("fSetup"), gates: $("fGates"), teardown: $("fTear") };
    /* defaults → the schedule fields the planner hasn't changed for this event */
    const defs = () => (venue ? venue.defaults : E.STD);
    function fill(first) {
      const d = $("fDate").value, s = $("fStart").value, e = $("fEnd").value; if (!d || !s || !e) return;
      const want = E.applyDefaults(defs(), d, s, e);
      Object.entries(F).forEach(([k, el]) => { if (first && base && base.times && (stored ? true : !base.sample)) { el.value = hm(base.times[k]); } else if (!dirty.has(k)) el.value = hm(want[k]); el.classList.toggle("own", dirty.has(k)); });
      if (first) $("fGust").value = base && base.gust && !base.sample ? base.gust : defs().gust;
      const name = venue ? venue.name : $("fVenue").value.trim() || "this venue";
      $("fDefNote").innerHTML = venue
        ? `From ${esc(venue.name)} defaults (${esc(offText(venue.defaults))}). A time changed here applies to this event only.${dirty.size ? ` <b>Changed for this event: ${esc([...dirty].join(", "))}.</b> <button type="button" class="bx-link" id="fUseDef">Use defaults</button>` : ""}`
        : `Standard offsets until the venue has its own: setup 4 h and gates 90 min before the start, teardown 2 h after the end.`;
      $("fMakeDefBox").hidden = !venue; $("fMakeDefTxt").textContent = `Make this schedule the default for ${name}`;
      const ud = $("fUseDef"); if (ud) ud.addEventListener("click", () => { dirty.clear(); fill(false); });
      $("fNewVenue").hidden = !!venue;
      tzNote();
    }
    Object.entries(F).forEach(([k, el]) => el.addEventListener("input", () => { dirty.add(k); el.classList.add("own"); fill(false); }));
    ["fDate", "fStart", "fEnd"].forEach((id) => $(id).addEventListener("change", () => fill(false)));
    /* a calendar event's date and times come from the calendar's own instants, shown in the chosen venue's time zone */
    const src = base && base.source && base.source.start ? base.source : null;
    const fromSource = (tz) => { if (!src || !tz) return; const s = E.wallAt(src.start, tz), e = E.wallAt(src.end, tz); $("fDate").value = s.slice(0, 10); $("fStart").value = s.slice(11, 16); $("fEnd").value = e.slice(11, 16); };
    $("fVenueSel").addEventListener("change", () => { venue = E.getVenue($("fVenueSel").value); dirty.clear(); if (venue) fromSource(venue.tz); fill(false); $("fGust").value = defs().gust; });
    $("fVenue").addEventListener("input", () => fill(false));
    function tzNote() { const z = venue ? venue.tz : city.tz; $("fTzNote").textContent = `Times are local to the venue (${z ? `${z}, ${fmt.zone(Date.now(), z)}` : "time zone found on save"}), wherever you are. An end or teardown earlier than the start is read as after midnight; a setup later than the start, as the day before.`; }
    U.placePicker($("fCity"), { current: city.name ? city : null, link: () => location.href, label: "Search a U.S. city",
      onPick(p) { city = p; $("fLat").value = p.lat; $("fLon").value = p.lon; if (!$("fVenue").value.trim()) $("fVenue").placeholder = p.name; fromSource(p.tz); fill(false); tzNote(); } });
    const cp = $("fCity").querySelector(".bx-ppcopy"); if (cp) cp.remove();
    fill(true);
    $("editDlg").showModal();
    $("fSave").addEventListener("click", async (ev0) => {
      ev0.preventDefault();
      const err = (m) => { $("fErr").textContent = m; $("fErr").hidden = false; };
      const date = $("fDate").value, s = $("fStart").value, e = $("fEnd").value;
      if (!date || !s || !e) return err("Date, start and end are required.");
      const end = `${e <= s ? nextDay(date, 1) : date}T${e}`;
      const before = (v) => (!v ? null : `${v > s ? nextDay(date, -1) : date}T${v}`), tear = (v) => (!v ? null : `${v < end.slice(11, 16) ? nextDay(end.slice(0, 10), 1) : end.slice(0, 10)}T${v}`);
      const times = { setup: before(F.setup.value), gates: before(F.gates.value), start: `${date}T${s}`, end, teardown: tear(F.teardown.value) };
      Object.keys(times).forEach((k) => { if (!times[k]) delete times[k]; });
      let loc, tz, venueId = venue ? venue.id : null;
      if (venue) { loc = { name: venue.name, lat: venue.lat, lon: venue.lon }; tz = venue.tz; }
      else {
        const lat = parseFloat($("fLat").value), lon = parseFloat($("fLon").value), vname = $("fVenue").value.trim() || city.name;
        if (!vname) return err("Name the venue.");
        if (!fin(lat) || !fin(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return err("Search the venue's city, or enter coordinates in decimal degrees (e.g. 39.1111 and -84.5222).");
        tz = city.tz; if (!tz || Math.abs(lat - city.lat) > 0.05 || Math.abs(lon - city.lon) > 0.05) tz = await O.zoneFor(lat, lon).catch(() => null) || await new Promise((ok) => setTimeout(ok, 1500)).then(() => O.zoneFor(lat, lon)).catch(() => null);
        if (!tz) return err("Couldn't look up the venue's time zone. Try again.");
        loc = { name: vname, lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
      }
      const gust = Math.min(60, Math.max(10, +$("fGust").value || 25));
      const draft = { name: $("fName").value.trim() || (base && !base.sample ? base.name : "My event"), loc, tz, times, gust };
      const errs = C.event.validate(draft); if (errs.length) return err(errs.join(" "));
      if (!venue && $("fSaveVenue").checked) { venue = E.saveVenue({ name: loc.name, city: city.name || "", lat: loc.lat, lon: loc.lon, tz, defaults: { ...E.offsetsOf(times), gust } }); venueId = venue.id; U.track("venue_saved"); }
      else if (venue && $("fMakeDef").checked) { venue = E.saveVenue({ ...venue, defaults: { ...venue.defaults, ...E.offsetsOf(times), gust } }); U.track("venue_saved"); }
      if (venue && venue.builtin) { venue = E.saveVenue({ ...venue, builtin: undefined }); venueId = venue.id; } // a built-in venue becomes a saved one
      /* confirming a calendar event's venue by hand: remember its calendar location for future imports */
      if (venue && src && src.location && (!stored || stored.venueId !== venue.id)) venue = E.rememberAlias(venue, src.location);
      const rec = E.saveEvent({ ...(stored || {}), ...draft, id: stored ? stored.id : null, venueId, overrides: venue ? E.overridesOf(times, venue.defaults) : [], source: (stored && stored.source) || { kind: "manual" } });
      U.track("event_saved", { market: S.market(loc.lat, loc.lon).tuned ? "cincinnati" : "elsewhere" });
      $("editDlg").close(); if (onSaved) onSaved(rec);
    });
  }

  /* ---------------- venue editor ---------------- */
  function editVenue(v, { onSaved } = {}) {
    const d = { ...E.STD, ...((v && v.defaults) || {}) };
    let city = v ? { name: v.city || v.name, lat: v.lat, lon: v.lon, tz: v.tz } : { name: "", lat: null, lon: null, tz: null };
    $("editForm").innerHTML = `<h2 id="editTitle">${v ? "Edit venue" : "Add venue"}</h2>
      <label>Venue name<input id="vName" maxlength="80" value="${esc(v ? v.name : "")}" placeholder="e.g. TQL Stadium"></label>
      <div><span class="bx-cap" style="display:block;margin-bottom:4px">City</span><div id="vCity" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"></div></div>
      <details ${v ? "open" : ""}><summary class="bx-note">Exact coordinates</summary><div class="two" style="margin-top:8px"><label>Latitude<input id="vLat" inputmode="decimal" value="${v ? v.lat : ""}"></label><label>Longitude<input id="vLon" inputmode="decimal" value="${v ? v.lon : ""}"></label></div></details>
      <fieldset class="bx-sched-f"><legend>Default schedule</legend>
        <div class="two"><label>Setup starts (hours before)<input type="number" id="vSetup" min="0" max="48" step="0.25" value="${d.setup / 60}"></label><label>Gates open (minutes before)<input type="number" id="vGates" min="0" max="600" step="5" value="${d.gates}"></label></div>
        <div class="two"><label>Teardown ends (minutes after)<input type="number" id="vTear" min="0" max="1440" step="15" value="${d.teardown}"></label><label>Gust limit (mph)<input type="number" id="vGust" min="10" max="60" value="${d.gust}"></label></div>
        <p class="bx-note" style="margin:0">Applied to new events at this venue. Existing events keep their times.</p></fieldset>
      <p class="err" id="vErr" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="bx-btn" value="cancel" formnovalidate>Cancel</button><button class="bx-btn primary" id="vSave" value="save">Save venue</button></div>`;
    U.placePicker($("vCity"), { current: city.name ? city : null, link: () => location.href, label: "Search a U.S. city", onPick(p) { city = p; $("vLat").value = p.lat; $("vLon").value = p.lon; if (!$("vName").value.trim()) $("vName").placeholder = p.name; } });
    const cp = $("vCity").querySelector(".bx-ppcopy"); if (cp) cp.remove();
    $("editDlg").showModal();
    $("vSave").addEventListener("click", async (e) => {
      e.preventDefault(); const err = (m) => { $("vErr").textContent = m; $("vErr").hidden = false; };
      const name = $("vName").value.trim(), lat = parseFloat($("vLat").value), lon = parseFloat($("vLon").value);
      if (!name) return err("Name the venue.");
      if (!fin(lat) || !fin(lon)) return err("Search the city, or enter coordinates in decimal degrees.");
      let tz = city.tz; if (!tz || Math.abs(lat - city.lat) > 0.05 || Math.abs(lon - city.lon) > 0.05) tz = await O.zoneFor(lat, lon).catch(() => null) || await new Promise((ok) => setTimeout(ok, 1500)).then(() => O.zoneFor(lat, lon)).catch(() => null);
      if (!tz) return err("Couldn't look up the venue's time zone. Try again.");
      const num = (id, dflt) => (fin(parseFloat($(id).value)) ? parseFloat($(id).value) : dflt);
      const rec = E.saveVenue({ ...(v || {}), name, city: city.name || "", lat: +lat.toFixed(4), lon: +lon.toFixed(4), tz,
        defaults: { setup: Math.round(num("vSetup", 4) * 60), gates: Math.round(num("vGates", 90)), teardown: Math.round(num("vTear", 120)), gust: Math.min(60, Math.max(10, num("vGust", 25))) } });
      U.track("venue_saved"); $("editDlg").close(); if (onSaved) onSaved(rec);
    });
  }

  /* ---------------- Upcoming view ---------------- */
  let gen = 0;
  function render(host, { onOpen } = {}) {
    const my = ++gen, now = Date.now(), list = E.events(), vns = E.venues();
    host.innerHTML = `<div class="up-head"><h1 class="up-title">Upcoming events</h1><div class="up-act"><button class="bx-btn" type="button" id="upImport">Import from calendar</button><button class="bx-btn primary" type="button" id="upAdd">+ Add event</button></div></div><div id="upNote" class="bx-note" hidden></div>
      <div id="upList" class="up-list"></div><details id="upPast" class="up-past" hidden><summary></summary><div class="up-list"></div></details>
      <section class="bx-sec"><div class="bx-bh"><h2>Saved venues</h2><button class="bx-btn" type="button" id="vnAdd">+ Add venue</button></div><div id="vnList" class="up-list" style="margin-top:8px"></div></section>
      <p class="bx-note" style="margin-top:18px">Events and venues are stored only in this browser. Calendar imports land in this same list.</p>`;
    $("upAdd").addEventListener("click", () => editEvent(null, { onSaved: () => render(host, { onOpen }) }));
    $("upImport").addEventListener("click", () => window.CalendarImport.open({ onDone: (r) => { render(host, { onOpen }); const need = E.events().filter((x) => !fin(x.loc.lat)).length;
      const n = $("upNote"); n.hidden = false; n.innerHTML = `<b>Import complete:</b> ${r.added} added · ${r.updated} updated${r.unchanged ? ` · ${r.unchanged} unchanged` : ""} · ${need} ${need === 1 ? "needs" : "need"} venue confirmation${need ? " (use Edit to pick a saved venue or search its city)" : ""}.${r.relocated ? ` ${r.relocated} changed location in the calendar and ${r.relocated === 1 ? "was" : "were"} matched again.` : ""}${r.remembered ? ` Remembered ${r.remembered} calendar ${r.remembered === 1 ? "location" : "locations"} for next time.` : ""}`; } }));
    $("vnAdd").addEventListener("click", () => editVenue(null, { onSaved: () => render(host, { onOpen }) }));
    $("vnList").innerHTML = vns.length ? vns.map((v) => `<article class="up-vn" data-id="${esc(v.id)}"><div><b>${esc(v.name)}</b><div class="bx-note">${esc(v.city || `${v.lat}, ${v.lon}`)} · ${esc(fmt.zone(now, v.tz))}</div><div class="bx-note">${esc(offText(v.defaults))}</div></div>
      <div class="up-act"><button class="bx-btn" type="button" data-vedit>Edit</button><button class="bx-btn" type="button" data-vremove>Remove</button></div></article>`).join("") : '<p class="bx-note">No saved venues yet. Save one with its setup, gates and teardown times, and new events there start from them.</p>';
    $("vnList").querySelectorAll(".up-vn").forEach((row) => {
      const v = E.getVenue(row.dataset.id);
      row.querySelector("[data-vedit]").addEventListener("click", () => editVenue(v, { onSaved: () => render(host, { onOpen }) }));
      row.querySelector("[data-vremove]").addEventListener("click", () => { if (confirm(`Remove ${v.name}? Its events stay, with their own times.`)) { E.removeVenue(v.id); render(host, { onOpen }); } });
    });
    /* rows: first with what is known without guidance, then with each venue's briefing status */
    const rows = list.map((ev) => { const w = winOf(ev); return { ev, w, startMs: w ? w.main.startMs : Infinity, endMs: w ? w.all.endMs : null }; });
    let lead = 6 * 864e5; // typical reach of the guidance used here; replaced by the real one once a venue loads
    const aroundTxt = (ms, tz) => `${fmt.day(ms, tz)}`;
    const base = (r) => E.statusOf(r.ev, { endMs: r.endMs, now, readyAtText: r.w && r.ev.tz ? aroundTxt(Math.max(now, r.endMs - lead), r.ev.tz) : null });
    rows.forEach((r) => { r.status = base(r); });
    const draw = () => {
      if (my !== gen) return;
      const o = E.order(rows), row = (r) => {
        const ev = r.ev, tz = ev.tz, s = r.status, w = r.w;
        const when = w && tz ? `${fmt.day(w.main.startMs, tz)} · ${fmt.clock(w.main.startMs, tz)}–${fmt.clock(w.main.endMs, tz)} ${fmt.zone(w.main.startMs, tz)}` : "Time not set";
        const mine = w && tz && myTz && fmt.zone(w.main.startMs, myTz) !== fmt.zone(w.main.startMs, tz) ? ` <span class="bx-note">(${esc(fmt.clock(w.main.startMs, myTz))} ${esc(fmt.zone(w.main.startMs, myTz))} your time)</span>` : "";
        const own = (ev.overrides || []).length ? `<span class="bx-note"> · ${esc(ev.overrides.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(", "))} set for this event</span>` : "";
        const chip = st(s.key === "concern" ? s.tier || "watch" : s.key === "ready" ? "normal" : null, s.label);
        return `<article class="up-ev ${esc(s.key)}" data-id="${esc(ev.id)}" data-status="${esc(s.key)}"${s.key === "concern" ? ` style="--tier:var(--${esc(s.tier || "watch")})"` : ""}><a class="up-open" href="?ev=${encodeURIComponent(ev.id)}">
          <div class="up-name">${esc(ev.name)}</div><div class="up-when">${esc(ev.loc.name)} · ${esc(when)}${mine}${own}</div>
          <div class="up-status">${chip}<span>${esc(s.text)}</span></div></a>
          <div class="up-act"><button class="bx-btn" type="button" data-edit>Edit</button><button class="bx-btn" type="button" data-remove>Remove</button></div></article>`;
      };
      $("upList").innerHTML = o.live.length ? o.live.map(row).join("") : `<div class="up-empty"><p><b>No upcoming events yet.</b></p><p class="bx-note">Add your next event, or save a venue first so its setup, gates and teardown times fill in for you.</p></div>`;
      const past = $("upPast"); past.hidden = !o.past.length; past.querySelector("summary").textContent = `Past events (${o.past.length})`; past.querySelector(".up-list").innerHTML = o.past.map(row).join("");
      host.querySelectorAll(".up-ev").forEach((el) => {
        const id = el.dataset.id;
        el.querySelector(".up-open").addEventListener("click", (e) => { if (onOpen) { e.preventDefault(); onOpen(id); } });
        el.querySelector("[data-edit]").addEventListener("click", () => editEvent(E.getEvent(id), { onSaved: () => render(host, { onOpen }) }));
        el.querySelector("[data-remove]").addEventListener("click", () => { const x = E.getEvent(id); if (x && confirm(`Remove ${x.name}?`)) { E.removeEvent(id); U.track("event_removed"); render(host, { onOpen }); } });
      });
      host.dataset.ready = rows.every((r) => !r.pending) ? "true" : "false";
    };
    /* guidance: one load per venue for events within reach (8 days); everything else is already known */
    const need = rows.filter((r) => r.status.key === "waiting" && r.w && r.startMs - now < 8 * 864e5);
    const byVenue = new Map(); need.forEach((r) => { r.pending = true; r.status = { ...r.status, label: "Checking", text: "Checking the guidance for this venue…" }; const k = `${r.ev.loc.lat.toFixed(3)},${r.ev.loc.lon.toFixed(3)}`; if (!byVenue.has(k)) byVenue.set(k, []); byVenue.get(k).push(r); });
    draw();
    (async () => {
      for (const group of byVenue.values()) {
        const ev0 = group[0].ev, get = () => U.load({ lat: ev0.loc.lat, lon: ev0.loc.lon }, { days: 7 }).catch(() => ({ empty: true }));
        let res = await get();
        /* the guidance service is occasionally busy: one quiet retry before showing "Couldn't check" */
        if ((res.empty || !res.ctx) && my === gen) { await new Promise((ok) => setTimeout(ok, 15000)); if (my !== gen) return; res = await get(); }
        if (my !== gen) return;
        if (res.ctx && res.ctx.B && res.ctx.B.ms.length) lead = Math.max(0, res.ctx.B.ms[res.ctx.B.ms.length - 1] - res.ctx.now);
        group.forEach((r) => {
          r.pending = false;
          if (res.empty || !res.ctx) { r.status = E.statusOf(r.ev, { failed: true, endMs: r.endMs, now }); return; }
          const b = S.eventBrief(res.ctx, r.ev, { gust: r.ev.gust || 25 }); if (b.error) { r.status = E.statusOf(r.ev, { failed: true, endMs: r.endMs, now }); return; }
          const R = S.readiness(b, res.ctx), around = R.readyAt ? `${fmt.day(Math.ceil(R.readyAt / H) * H, r.ev.tz)}, about ${fmt.clock(Math.ceil(R.readyAt / H) * H, r.ev.tz)}` : null;
          r.status = E.statusOf(r.ev, { brief: b, ready: R, decision: b.top ? S.decision(b).text : null, endMs: r.endMs, now, readyAtText: around });
        });
        rows.filter((r) => r.status.key === "waiting" && !r.pending && !need.includes(r)).forEach((r) => { r.status = base(r); });
        draw();
      }
      if (my === gen) { host.dataset.ready = "true"; }
    })();
  }

  window.BetaUpcoming = { editEvent, editVenue, render };
})();
