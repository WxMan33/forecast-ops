/* Event Manager: "Weather threats" for the open event. The products, source states and matcher are the Weather Threats
   map's own (ThreatsLive, ThreatsMatch), so the map and the planner agree about what covers the venue and when.
   This file knows nothing about any one feed: it lists what the matcher returns for the event's location and schedule.
     update(ev)  re-match for the event on screen (venue, date or schedule changed)
   Data: live official feeds (NWS through the same-origin function on Pages previews), or an archived official sample with
   ?threats=archive-flood-day | archive-flood-night (labelled as such). Families shown in this slice: flooding. */
(function () {
  "use strict";
  const O = window.Ops, C = O.Core, T = window.ThreatsCore, M = window.ThreatsMatch, Live = window.ThreatsLive, esc = O.esc, $ = O.$;
  const Q = new URLSearchParams(location.search);
  const ARCHIVE = /^archive-flood-(day|afternoon|night)$/.test(Q.get("threats") || "") ? Q.get("threats") : null;
  const FAMILIES = ["flood"];
  let ev = null, data = null, ready = false, open = new Set(), archived = null;

  const fmt = (iso, tz) => new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const mapLink = (it) => {
    const p = it.product, u = new URL("threats.html", location.href), q = u.searchParams;
    q.set("lat", ev.loc.lat); q.set("lon", ev.loc.lon); q.set("name", ev.loc.name); q.set("tz", ev.tz); q.set("scope", "venue");
    q.set("view", p.kind === "outlook" ? "day" + p.day : "active"); q.set("layers", it.family); q.set("sel", p.id);
    if (ARCHIVE) q.set("scenario", ARCHIVE);
    if (Live.NWS.mode === "function" && !Q.get("nwsBase")) q.set("nws", "function");
    return u.toString();
  };
  function snapshot() {
    if (ARCHIVE) return archived ? { ...archived } : { products: [], sources: {}, loading: true, clock: new Date().toISOString() };
    return Live.snapshot();
  }
  function render() {
    const box = $("threats"); if (!box || !ev) return;
    if (!ev.loc || !Number.isFinite(+ev.loc.lat)) { box.innerHTML = '<p class="bx-note">Pick the venue to check weather threats.</p>'; return; }
    data = snapshot(); const now = Date.parse(data.clock);
    if (data.loading || !ready) { box.innerHTML = '<p class="bx-note">Checking official flood warnings and rainfall outlooks…</p>'; return; }
    const state = Live.registryState(data, now);
    const r = M.forEvent({ products: data.products, state, event: { lat: +ev.loc.lat, lon: +ev.loc.lon, name: ev.loc.name, tz: ev.tz, windows: C.event.windows(ev) }, now, families: FAMILIES });
    const tz = ev.tz;
    const items = r.items.map((it) => {
      const p = it.product, id = esc(it.id), isOpen = open.has(it.id), src = state[p.sourceId] || {};
      const rows = [
        ["Source", `${esc(p.office || "")}${p.source && p.source.url ? ` · <a href="${esc(p.source.url)}" target="_blank" rel="noopener">official product</a>` : ""}`],
        ["Issued", esc(fmt(p.issued, tz)) + (p.updated && p.updated !== p.issued && p.kind !== "outlook" ? " · updated " + esc(fmt(p.updated, tz)) : "")],
        [p.kind === "outlook" ? "Valid" : "In effect", p.kind === "outlook" ? esc(fmt(p.validStart, tz)) + " → " + esc(fmt(p.validEnd, tz)) : "until " + esc(fmt(p.expires, tz))],
        ["Last checked", src.lastOk ? esc(fmt(src.lastOk, tz)) + (src.kind === "stale" ? " · not confirmed since then" : "") : "not yet"],
        ["Venue", esc(it.relation.kind === "unknown" ? "Unknown: the area isn't fully drawn" : p.kind === "outlook" ? "Inside the highest category that reaches the venue (" + (window.ThreatsFeeds.ERO_NAME[p.category] || p.category) + ")" : "Inside the warning area")],
        ["Details", esc(p.headline || p.hazard || "")],
      ];
      return `<li class="et-item" data-family="${esc(it.family)}" data-kind="${esc(it.kind)}">
        <div class="et-main"><b class="et-head">${esc(it.headline)}</b><span class="et-line">${esc(it.line)}</span>
          <span class="et-actions"><button type="button" class="bx-link et-more" data-id="${id}" aria-expanded="${isOpen}">More info</button> · <a class="bx-link" href="${esc(mapLink(it))}" data-map="${id}">View on map</a></span></div>
        <dl class="et-detail" ${isOpen ? "" : "hidden"}>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></li>`;
    }).join("");
    const statuses = r.statuses.map((s) => `<li class="${s.ok ? "" : "et-warn"}"><b>${esc(s.name)}</b> · ${esc(s.text)}</li>`).join("");
    const label = ARCHIVE ? `<p class="et-sample"><span class="bx-label">Archived sample</span> ${esc(data.archive ? data.archive.label : "")}. Real official products replayed at that time; not live.</p>` : "";
    box.innerHTML = `${label}<p class="et-summary${r.items.length ? " has" : r.confirmed ? "" : " warn"}" data-confirmed="${r.confirmed}">${esc(r.summary)}</p>
      ${items ? `<ul class="et-list">${items}</ul>` : ""}
      <details class="bx-more et-sources"><summary>Sources checked for this event</summary><ul>${statuses}</ul>
      <p class="bx-note">Matched to the venue pin and the event's own schedule (${esc(tz)}). Official warnings and outlooks only; daily outlooks flag a period and do not time anything within it. Delivery by email, text or push is not part of this preview.</p></details>`;
    box.dataset.items = String(r.items.length); box.dataset.confirmed = String(r.confirmed);
    window.EventThreatsLast = r; // read by the preview checks
  }
  function update(next) { ev = next; render(); }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".et-more"); if (!b) return;
    const id = b.dataset.id; if (open.has(id)) open.delete(id); else open.add(id); render();
  });

  async function start() {
    if (ARCHIVE) { try { archived = await Live.archiveSnapshot(ARCHIVE); } catch (e) { archived = { products: [], sources: {}, clock: new Date().toISOString(), loadError: e.message }; } ready = true; render(); return; }
    await Live.start({ only: ["alerts", "ero"] }); ready = true; render();
    Live.onUpdate(() => render());
    setInterval(() => { if (!document.hidden) render(); }, 30e3);
  }
  window.EventThreats = { update, render, current: () => ev };
  start();
})();
