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
    return { kind: "google", label: "Google Calendar",
      async listCalendars() { const j = await get("/users/me/calendarList", { minAccessRole: "reader", fields: "items(id,summary,primary,timeZone)" }); return j.items || []; },
      async listEvents(id, { timeMin, timeMax }) { const j = await get(`/calendars/${encodeURIComponent(id)}/events`, { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250", fields: "items(id,etag,status,summary,location,start,end)" }); return (j.items || []).filter((e) => e.status !== "cancelled"); },
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
      $("ciSample").addEventListener("click", () => start(sampleProvider()));
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
      const venues = E.venues(), have = new Set(E.events().map((x) => x.id));
      const recs = items.map((g) => ({ g, r: E.fromCalendar(g, venues, provider.kind === "sample" ? `sample:${cal.id}` : cal.id) })).filter((x) => x.r);
      const skipped = items.length - recs.length;
      const when = (r) => { if (!r.tz) return `${r.times.start.replace("T", " ")}`; const s = Date.parse(r.times.start + ":00Z"); const h12 = (t) => { const h = +t.slice(11, 13), m = t.slice(14, 16); return `${h % 12 || 12}${m === "00" ? "" : ":" + m} ${h < 12 ? "AM" : "PM"}`; }; return `${new Date(s).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })} · ${h12(r.times.start)}–${h12(r.times.end)} ${fmt.zone(s, r.tz)}`; };
      const venueSel = (r, i) => r.venueId ? `<span class="bx-st" style="--tier:var(--normal)">${esc(r.loc.name)}</span>`
        : `<select data-venue="${i}" aria-label="Venue for this event"><option value="">Confirm the venue later</option>${venues.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")}</select>`;
      form.innerHTML = `<h2 id="editTitle">Choose events to import</h2>
        <p class="bx-note" style="margin:0">${esc(cal.summary || "Calendar")} · next 90 days${skipped ? ` · ${skipped} all-day ${skipped === 1 ? "item" : "items"} skipped` : ""}. Events at a saved venue get that venue's setup, gates and teardown times. Unfamiliar locations need a venue before a site-specific briefing.</p>
        <div class="ci-list">${recs.map(({ g, r }, i) => `<div class="ci-ev"><label class="bx-check"><input type="checkbox" data-pick="${i}" ${r.venueId ? "checked" : ""}> <span><b>${esc(r.name)}</b>${have.has(r.id) ? ' <span class="bx-note">· already imported (will update)</span>' : ""}<span class="bx-note" style="display:block">${esc(when(r))}${g.location ? "" : " · no location in the calendar"}</span></span></label>
          <div class="ci-venue">${r.venueId ? "Venue: " : `<span class="bx-note">${esc(g.location || "No location")}</span> `}${venueSel(r, i)}</div></div>`).join("") || '<p class="bx-note">No upcoming timed events in the next 90 days.</p>'}</div>
        <p class="err" id="ciErr" hidden></p>${foot('<button class="bx-btn" value="cancel" formnovalidate>Cancel</button><button type="button" class="bx-btn primary" id="ciImport">Import selected</button>')}`;
      const count = () => { const n = form.querySelectorAll("[data-pick]:checked").length; $("ciImport").textContent = n ? `Import ${n} ${n === 1 ? "event" : "events"}` : "Import selected"; $("ciImport").disabled = !n; };
      form.querySelectorAll("[data-pick]").forEach((c) => c.addEventListener("change", count));
      form.querySelectorAll("[data-venue]").forEach((s) => s.addEventListener("change", () => { const c = form.querySelector(`[data-pick="${s.dataset.venue}"]`); if (s.value && c) { c.checked = true; count(); } }));
      count();
      $("ciImport").addEventListener("click", () => {
        const picked = [...form.querySelectorAll("[data-pick]:checked")].map((c) => { const i = +c.dataset.pick; let r = recs[i].r; const s = form.querySelector(`[data-venue="${i}"]`); if (s && s.value) r = E.confirmVenue(r, E.getVenue(s.value)); return r; });
        const res = E.importEvents(picked);
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
