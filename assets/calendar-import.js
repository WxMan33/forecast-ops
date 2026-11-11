/* Event Manager beta: read-only calendar import into Upcoming events.
   Flow: connect (or open the sample calendar) → choose a calendar → tick the events to import → confirm or
   postpone unfamiliar locations → the selected events land in Upcoming events (EventStore), matched to saved
   venues. Nothing else is stored: not the calendar list, not unselected events, not the token.

   Two providers with one interface: { kind, listCalendars(), listEvents(calendarId, { timeMin, timeMax }) },
   both returning Google Calendar API shapes.
   - "sample": synthetic demo calendars (works anywhere, including the signed-out preview link).
   - "google": Google Identity Services token client with calendar.calendarlist.readonly and
     calendar.events.readonly. Enabled only when BETA_CALENDAR.clientId is set and this page's origin is listed in
     BETA_CALENDAR.origins (never on raw.githack.com). The access token lives in memory for this tab only.
   Analytics: only that the import was opened, which provider, and how many events were imported. */
(function (root) {
  "use strict";
  const SCOPES = "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly";
  const API = "https://www.googleapis.com/calendar/v3";
  const D = 864e5, H = 3600e3;

  /* ---------------- sample provider: synthetic calendars relative to today ---------------- */
  function sampleProvider(now = Date.now()) {
    const tzOff = (ms, tz) => { const p = new Date(ms).toLocaleString("en-US", { timeZone: tz, timeZoneName: "longOffset" }).split("GMT")[1] || "+00:00"; return p === "" ? "+00:00" : p.replace(/^([+-]\d{2})$/, "$1:00"); };
    const at = (days, hm, tz = "America/New_York") => { const day = new Date(now + days * D).toLocaleDateString("en-CA", { timeZone: tz }), ms = Date.parse(`${day}T${hm}:00Z`); return `${day}T${hm}:00${tzOff(ms, tz)}`; };
    const ev = (id, summary, location, d, s, e, tz) => ({ id, etag: `"${id}-1"`, status: "confirmed", summary, location, start: { dateTime: at(d, s, tz), timeZone: tz || "America/New_York" }, end: { dateTime: at(d, e, tz), timeZone: tz || "America/New_York" } });
    const cals = [
      { id: "sample-matches", summary: "Home matches (sample)", primary: false, timeZone: "America/New_York" },
      { id: "sample-ops", summary: "Venue operations (sample)", primary: true, timeZone: "America/New_York" },
    ];
    const events = {
      "sample-matches": [
        ev("m1", "Home match vs. Sample FC", "TQL Stadium, 1501 Central Pkwy W, Cincinnati, OH 45214", 3, "19:30", "21:30"),
        ev("m2", "Home match vs. Example United", "TQL Stadium, 1501 Central Pkwy W, Cincinnati, OH 45214", 10, "19:30", "21:30"),
        ev("m3", "Away match at Columbus", "Lower.com Field, Columbus, OH", 17, "19:30", "21:30"),
        ev("m4", "Home match vs. Test City", "TQL Stadium, 1501 Central Pkwy W, Cincinnati, OH 45214", 31, "16:00", "18:00"),
        { id: "m5", etag: '"m5-1"', status: "confirmed", summary: "Media day", start: { date: new Date(now + 5 * D).toISOString().slice(0, 10) }, end: { date: new Date(now + 6 * D).toISOString().slice(0, 10) } },
      ],
      "sample-ops": [
        ev("o1", "Riverfront concert load-in", "Sawyer Point, Cincinnati, OH", 6, "17:00", "22:00"),
        ev("o2", "Fan fest", "", 12, "12:00", "16:00"),
      ],
    };
    return { kind: "sample", label: "Sample calendar (demo data)",
      async listCalendars() { return cals; },
      async listEvents(id, { timeMin, timeMax } = {}) { return (events[id] || []).filter((e) => { const s = Date.parse(e.start.dateTime || e.start.date + "T12:00:00Z"); return (!timeMin || s >= Date.parse(timeMin)) && (!timeMax || s <= Date.parse(timeMax)); }); } };
  }

  /* ---------------- Google provider (Google Identity Services, token in memory) ---------------- */
  const CFG = () => root.BETA_CALENDAR || {};
  function googleAvailable(loc = root.location) {
    const c = CFG(); return !!(c.clientId && Array.isArray(c.origins) && loc && c.origins.includes(loc.origin) && loc.hostname !== "raw.githack.com");
  }
  let gisLoading = null;
  const loadGis = () => gisLoading || (gisLoading = new Promise((ok, no) => { if (root.google && root.google.accounts && root.google.accounts.oauth2) return ok(); const s = root.document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = () => ok(); s.onerror = () => { gisLoading = null; no(new Error("Google sign-in didn't load.")); }; root.document.head.append(s); }));
  function googleProvider() {
    let token = null, expires = 0; // memory only: gone when the tab closes
    async function auth() {
      if (token && Date.now() < expires - 60e3) return token;
      await loadGis();
      return new Promise((ok, no) => {
        const client = root.google.accounts.oauth2.initTokenClient({ client_id: CFG().clientId, scope: SCOPES, include_granted_scopes: false,
          callback: (r) => { if (r && r.access_token) { token = r.access_token; expires = Date.now() + (+r.expires_in || 3600) * 1000; ok(token); } else no(new Error((r && r.error) || "Calendar access was not granted.")); },
          error_callback: (e) => no(new Error((e && e.type === "popup_closed") ? "The Google window was closed." : "Calendar access was not granted.")) });
        client.requestAccessToken();
      });
    }
    async function get(path, params) {
      const t = await auth(), u = new URL(API + path); Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
      const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
      if (r.status === 401) { token = null; throw new Error("Google sign-in expired. Connect again."); }
      if (!r.ok) throw new Error(`Google Calendar answered HTTP ${r.status}.`);
      return r.json();
    }
    // Both endpoints paginate. A short (or empty) page can still have a next page.
    async function list(path, params) {
      const items = [], seen = new Set(); let pageToken = null;
      do {
        const j = await get(path, { ...params, ...(pageToken ? { pageToken } : {}) });
        items.push(...(j.items || []));
        pageToken = j.nextPageToken || null;
        if (pageToken && seen.has(pageToken)) throw new Error("Google Calendar repeated a results page. Try importing again.");
        if (pageToken) seen.add(pageToken);
      } while (pageToken);
      return items;
    }
    return { kind: "google", label: "Google Calendar",
      async listCalendars() { return list("/users/me/calendarList", { minAccessRole: "reader", fields: "nextPageToken,items(id,summary,primary,timeZone)" }); },
      async listEvents(id, { timeMin, timeMax }) { return (await list(`/calendars/${encodeURIComponent(id)}/events`, { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250", fields: "nextPageToken,items(id,etag,status,summary,location,start,end)" })).filter((e) => e.status !== "cancelled"); },
      disconnect() { if (token && root.google && root.google.accounts) root.google.accounts.oauth2.revoke(token, () => {}); token = null; expires = 0; } };
  }

  /* ---------------- import dialog ---------------- */
  function open({ onDone } = {}) {
    const O = root.Ops, E = root.EventStore, U = root.BetaUI, $ = O.$, esc = O.esc, fmt = U.fmt;
    const dlg = $("editDlg"), form = $("editForm");
    const live = googleAvailable();
    let provider = null, cal = null, items = [];
    U.track("calendar_import_opened");
    const foot = (btns) => `<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">${btns}</div>`;
    const err = (m) => { const e = $("ciErr"); if (e) { e.textContent = m; e.hidden = false; } };
    function step1() {
      form.innerHTML = `<h2 id="editTitle">Import from a calendar</h2>
        <p class="bx-note" style="margin:0">Read-only. You choose which events to import; only those are saved, in this browser. Calendar names and event details are never sent anywhere else.</p>
        <div class="ci-choices">
          ${live ? `<button type="button" class="bx-btn primary" id="ciGoogle">Connect Google Calendar</button><p class="bx-note" style="margin:0">Asks Google for read-only access to your calendar list and events. Access lasts for this tab only.</p>` : `<p class="bx-note" style="margin:0"><b>Google Calendar sign-in isn't available on this preview link.</b> It will be tested on a dedicated Forecast Ops beta address. Try the flow with demo data:</p>`}
          <button type="button" class="bx-btn ${live ? "" : "primary"}" id="ciSample">Open the sample calendar</button>
        </div>
        <p class="err" id="ciErr" hidden></p>${foot('<button class="bx-btn" value="cancel" formnovalidate>Cancel</button>')}`;
      $("ciSample").addEventListener("click", () => start((root.CalendarImport || api).sampleProvider())); // looked up at click time so checks can supply shifted sample data
      if (live) $("ciGoogle").addEventListener("click", () => start(googleProvider()));
    }
    async function start(p) {
      provider = p; U.track("calendar_import_started", { via: p.kind });
      form.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try { const cals = await p.listCalendars(); step2(cals); } catch (e) { form.querySelectorAll("button").forEach((b) => { b.disabled = false; }); err(e.message || String(e)); }
    }
    function step2(cals) {
      form.innerHTML = `<h2 id="editTitle">Choose a calendar</h2>${provider.kind === "sample" ? '<p class="bx-note" style="margin:0">Demo data, not a real calendar.</p>' : ""}
        <div class="ci-list">${cals.map((c, i) => `<label class="bx-check ci-row"><input type="radio" name="ciCal" value="${i}" ${i === 0 ? "checked" : ""}> ${esc(c.summary || "(untitled calendar)")}${c.primary ? ' <span class="bx-note">· primary</span>' : ""}</label>`).join("") || '<p class="bx-note">No calendars found.</p>'}</div>
        <p class="err" id="ciErr" hidden></p>${foot('<button class="bx-btn" value="cancel" formnovalidate>Cancel</button><button type="button" class="bx-btn primary" id="ciNext">Show upcoming events</button>')}`;
      $("ciNext").addEventListener("click", async () => {
        const i = +((form.querySelector('input[name="ciCal"]:checked') || {}).value || 0); cal = cals[i]; if (!cal) return;
        $("ciNext").disabled = true;
        try { const now = Date.now(); items = await provider.listEvents(cal.id, { timeMin: new Date(now).toISOString(), timeMax: new Date(now + 90 * D).toISOString() }); step3(); }
        catch (e) { $("ciNext").disabled = false; err(e.message || String(e)); }
      });
    }
    function step3() {
      const VS = root.VenueSearch, venues = E.venues(), have = new Set(E.events().map((x) => x.id));
      const pool = [...venues, ...E.BUILTIN.filter((b) => !venues.some((v) => E.norm(v.name) === E.norm(b.name)))];
      const calTz = cal.timeZone || null;
      const recs = items.map((g) => ({ g, r: E.fromCalendar(g, venues, provider.kind === "sample" ? `sample:${cal.id}` : cal.id, calTz) })).filter((x) => x.r);
      const skipped = items.length - recs.length;
      const h12 = (t) => { const h = +t.slice(11, 13), m = t.slice(14, 16); return `${h % 12 || 12}${m === "00" ? "" : ":" + m} ${h < 12 ? "AM" : "PM"}`; };
      const when = (r) => { if (!r.tz) return r.times.start.replace("T", " ") + " UTC"; const s = Date.parse(r.times.start + ":00Z"); return `${new Date(s).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })} · ${h12(r.times.start)}–${h12(r.times.end)} ${fmt.zone(Date.parse(r.source.start), r.tz)}`; };
      const VIA = { name: "matched by name", address: "matched by street address", remembered: "a location you confirmed before", manual: "chosen by you", found: "found on the map", pin: "dropped pin" };
      /* one venue state per row: saved venue, a place found on the map, still searching, or unconfirmed */
      /* unfamiliar locations start in review: nothing leaves the browser until the planner checks the text and searches */
      const state = recs.map(({ g, r }) => (r.venueId ? { kind: "saved", venue: E.getVenue(r.venueId), via: (r.match || {}).via, auto: r.venueId } : g.location ? { kind: "review", text: g.location } : { kind: "none", why: "blank" }));
      form.innerHTML = `<h2 id="editTitle">Choose events to import</h2>
        <p class="bx-note" style="margin:0">${esc(cal.summary || "Calendar")} · next 90 days${skipped ? ` · ${skipped} all-day ${skipped === 1 ? "item" : "items"} skipped` : ""}. Times are shown at the venue. Saved venues are matched automatically. For other locations, review the place or address before searching: remove anything private, like a home address or directions. The forecast uses the venue's exact point.</p>
        <div class="ci-list">${recs.map(({ r }, i) => `<div class="ci-ev" data-row="${i}"><label class="bx-check"><input type="checkbox" data-pick="${i}"> <span><b>${esc(r.name)}</b>${have.has(r.id) ? ' <span class="bx-note">· already imported (will update)</span>' : ""}<span class="bx-note" style="display:block" data-when>${esc(when(r))}</span></span></label>
          <div class="ci-venue" data-venue-box="${i}"></div></div>`).join("") || '<p class="bx-note">No upcoming timed events in the next 90 days.</p>'}</div>
        <p class="err" id="ciErr" hidden></p>${foot('<button class="bx-btn" value="cancel" formnovalidate>Cancel</button><button type="button" class="bx-btn primary" id="ciImport">Import selected</button>')}`;
      const count = () => { const n = form.querySelectorAll("[data-pick]:checked").length; $("ciImport").textContent = n ? `Import ${n} ${n === 1 ? "event" : "events"}` : "Import selected"; $("ciImport").disabled = !n; };
      const setPick = (i, on) => { const c = form.querySelector(`[data-pick="${i}"]`); if (c) { c.checked = on; count(); } };
      const savedSelect = (i) => `<select data-saved="${i}" aria-label="Saved venue"><option value="">Saved venues…</option>${pool.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.builtin ? " (built in)" : ""}</option>`).join("")}</select>`;
      function draw(i) {
        const box = form.querySelector(`[data-venue-box="${i}"]`), row = box.closest(".ci-ev"), st = state[i], loc = recs[i].g.location || "";
        const tools = `<div class="ci-tools"><button type="button" class="bx-link" data-again="${i}">Search again</button><button type="button" class="bx-link" data-pin="${i}">Drop a pin</button>${savedSelect(i)}</div>`;
        row.dataset.match = { saved: "matched", place: "found", searching: "searching", ambiguous: "ambiguous", none: "unknown", review: "review" }[st.kind];
        if (st.kind === "saved") box.innerHTML = `<span>Venue: <b>${esc(st.venue.name)}</b>${st.venue.address ? ` <span class="bx-note">· ${esc(st.venue.address)}</span>` : ""} <span class="bx-note">· ${esc(VIA[st.via] || "matched")}</span></span> <button type="button" class="bx-link" data-change="${i}">Change</button>`;
        else if (st.kind === "place") box.innerHTML = `<span>Venue: <b>${esc(st.place.name)}</b> <span class="bx-note">· ${esc(st.place.address || "")} · ${esc(VIA[st.via] || "found on the map")}</span></span> <button type="button" class="bx-link" data-change="${i}">Change</button>${st.via === "found" || st.via === "manual" ? `<span class="bx-note" style="flex-basis:100%">${VS.attribution()}</span>` : ""}`;
        else if (st.kind === "searching") box.innerHTML = `<span class="bx-note">Searching for “${esc(st.text || loc)}”…</span>`;
        else if (st.kind === "review") box.innerHTML = `<span class="bx-note" style="flex-basis:100%">Not a saved venue yet. Check the text (remove anything private), then search. Nothing is sent until you do.</span>
          <div class="vs-row" style="flex-basis:100%"><input type="search" class="vs-q" data-review="${i}" value="${esc(st.text)}" aria-label="Place or address to search"><button type="button" class="bx-btn" data-search="${i}">Search</button></div>${tools.replace(`<button type="button" class="bx-link" data-again="${i}">Search again</button>`, "")}`;
        else if (st.kind === "ambiguous") box.innerHTML = `<span class="bx-note" style="flex-basis:100%">“${esc(loc)}” matches several places. Choose one, or leave it to confirm later:</span>
          <div class="ci-cands">${st.candidates.map((c, k) => `<button type="button" class="vs-hit" data-cand="${i}:${k}"><b>${esc(c.name)}</b><span class="bx-note">${esc(c.address)}</span></button>`).join("")}</div>${tools}<span class="bx-note">${VS.attribution()}</span>`;
        else box.innerHTML = `<span class="bx-note" style="flex-basis:100%">${esc(st.why === "blank" ? "No location in the calendar." : st.why === "area" ? `“${loc}” only matches a city or area, not a venue. The venue stays unconfirmed.` : st.why === "street" ? `“${loc}” only matches a street, not a venue.` : st.why === "failed" ? "Venue search is unavailable right now." : `Couldn't find “${loc}” on the map.`)} Search again, drop a pin or choose a saved venue, or confirm it later.</span>${tools}`;
        box.querySelectorAll("[data-change]").forEach((b) => b.addEventListener("click", () => openSearch(i)));
        box.querySelectorAll("[data-again]").forEach((b) => b.addEventListener("click", () => { state[i] = { kind: "review", text: st.text || recs[i].g.location || "" }; draw(i); }));
        box.querySelectorAll("[data-search]").forEach((b) => b.addEventListener("click", () => runSearch(i, box.querySelector("[data-review]").value)));
        box.querySelectorAll("[data-review]").forEach((q) => { q.addEventListener("input", () => { state[i].text = q.value; }); q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(i, q.value); } }); });
        box.querySelectorAll("[data-pin]").forEach((b) => b.addEventListener("click", () => pinFor(i)));
        box.querySelectorAll("[data-saved]").forEach((s) => s.addEventListener("change", () => { if (!s.value) return; state[i] = { kind: "saved", venue: E.getVenue(s.value), via: "manual", auto: state[i].auto || null }; draw(i); setPick(i, true); }));
        box.querySelectorAll("[data-cand]").forEach((b) => b.addEventListener("click", () => { const [, k] = b.dataset.cand.split(":"); state[i] = { kind: "place", place: st.candidates[+k], via: "manual" }; draw(i); setPick(i, true); }));
      }
      function openSearch(i) {
        const box = form.querySelector(`[data-venue-box="${i}"]`), loc = recs[i].g.location || "", prev = state[i];
        box.innerHTML = `<div style="flex-basis:100%;display:grid;gap:6px"><div class="ci-tools">${savedSelect(i)}<button type="button" class="bx-link" data-keep="${i}">Keep ${prev.kind === "saved" || prev.kind === "place" ? "current venue" : "as is"}</button></div><div data-picker></div></div>`;
        box.querySelector("[data-keep]").addEventListener("click", () => draw(i));
        box.querySelector("[data-saved]").addEventListener("change", (e) => { if (!e.target.value) return; state[i] = { kind: "saved", venue: E.getVenue(e.target.value), via: "manual", auto: prev.auto || null }; draw(i); setPick(i, true); });
        VS.picker(box.querySelector("[data-picker]"), { initial: loc, onPick: (p) => { state[i] = { kind: "place", place: p, via: p.kind === "pin" ? "pin" : "manual" }; draw(i); setPick(i, true); } });
      }
      async function pinFor(i) { const p = await VS.pinDialog(null); if (p) { state[i] = { kind: "place", place: { name: recs[i].g.location ? recs[i].g.location.split(",")[0] : "Dropped pin", address: `Pin at ${p.lat}, ${p.lon}`, lat: p.lat, lon: p.lon, kind: "pin" }, via: "pin" }; draw(i); setPick(i, true); } }
      recs.forEach((_, i) => { draw(i); if (state[i].kind === "saved") setPick(i, true); });
      form.querySelectorAll("[data-pick]").forEach((c) => c.addEventListener("change", count));
      count();
      /* a search the planner started, with the text they reviewed; one clear place is selected automatically */
      async function runSearch(i, text) {
        text = String(text || "").trim(); if (!text) return;
        state[i] = { kind: "searching", text }; draw(i);
        let res; try { res = VS.decide(text, await VS.search(text)); } catch (e) { res = { status: "unknown", why: "failed" }; }
        if (!dlg.open) return;
        if (res.status === "found") state[i] = { kind: "place", place: res.place, via: "found" };
        else if (res.status === "ambiguous") state[i] = { kind: "ambiguous", candidates: res.candidates, text };
        else state[i] = { kind: "none", why: res.why, text };
        draw(i); if (state[i].kind === "place") setPick(i, true);
      }
      form.dataset.resolved = "true"; // nothing is looked up on opening
      $("ciImport").addEventListener("click", async () => {
        const btn = $("ciImport"); btn.disabled = true; btn.textContent = "Importing…";
        let remembered = 0; const picked = [];
        /* time zones for new places, all at once: the lookup service (up to 6 s), else the venue's state, else the calendar's */
        const rows = [...form.querySelectorAll("[data-pick]:checked")].map((c) => +c.dataset.pick);
        const zoneOf = new Map(await Promise.all(rows.filter((i) => state[i].kind === "place" && !E.venues().some((v) => VS.km(v, state[i].place) <= 0.15)).map(async (i) => {
          const p = state[i].place, quick = await Promise.race([O.zoneFor(p.lat, p.lon).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 6000))]);
          return [i, quick || VS.tzGuess(p) || calTz];
        })));
        for (const c of form.querySelectorAll("[data-pick]:checked")) {
          const i = +c.dataset.pick, { g } = recs[i], st = state[i]; let r = recs[i].r;
          if (st.kind === "saved") {
            if (st.venue.id !== st.auto) { let v = st.venue; if (g.location) { v = E.rememberAlias(v, g.location); remembered++; } r = E.confirmVenue(r, v); }
          } else if (st.kind === "place") {
            /* the place becomes a saved venue (or an existing one within 150 m), remembered for this calendar location */
            const p = st.place, near = E.venues().find((v) => VS.km(v, p) <= 0.15);
            let v = near;
            if (!v) { const tz = zoneOf.get(i) || VS.tzGuess(p) || calTz; if (!tz) { err(`Couldn't look up the time zone for ${p.name}. Try again.`); btn.disabled = false; count(); return; }
              v = E.saveVenue({ name: p.name, address: p.kind === "pin" ? "" : p.address, city: p.address || "", lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), tz, aliases: [] }); U.track("venue_saved"); }
            if (g.location) { v = E.rememberAlias(v, g.location); remembered++; }
            r = E.confirmVenue(r, v);
          } else r = { ...r, venueId: null, loc: { name: g.location || "Venue not set", lat: null, lon: null }, match: { status: "unknown", via: null, candidates: [] } };
          picked.push(r);
        }
        const res = E.importEvents(picked); res.remembered = remembered;
        U.track("calendar_events_imported", { via: provider.kind, n: Math.min(99, picked.length) });
        dlg.close(); if (onDone) onDone(res);
      });
    }
    step1();
    if (!dlg.open) dlg.showModal();
  }

  const api = { sampleProvider, googleAvailable, googleProvider, open, SCOPES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CalendarImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
