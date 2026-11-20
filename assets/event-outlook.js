/* Event Manager "Early weather outlook": for an event the hourly guidance doesn't fully reach yet, the daily Forecast
   Blend's view of the event's dates. Same recipe and the same daily calculation as Model Blend's daily table
   (OpsCore blend.dailyRows over a 10-day load); nothing hourly is inferred: no start-time weather, no phase values.

   For each event date that is not fully inside the hourly range:
     high and low for the calendar day (venue-local midnight to midnight),
     the chance of precipitation for that same day, labelled with that period,
     the likely precipitation type only when the day's own guidance supports it (enough chance and liquid amount,
       and a clear snowfall-to-liquid share: >= 80% snow, <= 20% rain, otherwise a rain/snow mix);
   with "A lot can change this far out." and when hourly guidance should reach setup and the whole event.
   Dates past the daily outlook (10 days) get no numbers, only when the outlook and the briefing should start. */
(function (root) {
  "use strict";
  const H = 3600e3, D = 864e5, fin = Number.isFinite, OUTLOOK_DAYS = 10;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct5 = (v) => (fin(v) ? Math.max(0, Math.min(100, Math.round(v / 5) * 5)) : null);

  /* the likely type for one day, only when the guidance supports it */
  function dayType(r) {
    if (!fin(r.pop) && !fin(r.qpf)) return { kind: "unknown", text: "Precipitation type: not available" };
    const likely = (fin(r.pop) && r.pop >= 30) || (fin(r.qpf) && r.qpf >= 0.05);
    if (!likely) return { kind: "unlikely", text: "Precipitation unlikely" };
    if (!(fin(r.qpf) && r.qpf >= 0.01) || !fin(r.sn)) return { kind: "unclear", text: "Precipitation type: not clear yet" };
    const f = Math.min(1, Math.max(0, r.sn / (7 * r.qpf)));
    return f >= 0.8 ? { kind: "snow", text: "Likely type: snow" } : f <= 0.2 ? { kind: "rain", text: "Likely type: rain" } : { kind: "mix", text: "Likely type: rain/snow mix possible" };
  }

  /* The model for the page. windows: C.event.windows(ev); rows: blend.dailyRows on the 10-day load (or null when it
     failed); hourlyEndMs: first hour the hourly briefing does NOT cover; R: BetaStory.readiness; day(ms): venue-local
     YYYY-MM-DD; now. */
  function build({ windows, rows, hourlyEndMs, R, day, now, outlookEndMs }) {
    const all = windows.find((w) => w.key === "all") || { startMs: Math.min(...windows.map((w) => w.startMs)), endMs: Math.max(...windows.map((w) => w.endMs)) };
    const parts = windows.filter((w) => w.key !== "all" && w.endMs > now);
    if (!parts.length || !R || R.state === "ready" || R.state === "past") return { state: "none" };
    /* event dates whose hours are not all inside the hourly range */
    const dates = [];
    parts.forEach((p) => { for (let t = Math.max(p.startMs, hourlyEndMs); t < p.endMs; t += H) { const k = day(t); let d = dates.find((x) => x.k === k);
      if (!d) dates.push((d = { k, parts: [] })); if (!d.parts.includes(p.label)) d.parts.push(p.label); } });
    const byDay = new Map((rows || []).map((r) => [r.k, r]));
    const lastDaily = rows && rows.length ? rows[rows.length - 1].k : null;
    const days = dates.map((d) => { const r = byDay.get(d.k);
      if (!r) return { k: d.k, parts: d.parts, covered: false };
      return { k: d.k, parts: d.parts, covered: true, hi: fin(r.hi) ? Math.round(r.hi) : null, lo: fin(r.lo) ? Math.round(r.lo) : null, pop: pct5(r.pop), type: dayType(r) }; });
    const outlookAt = Math.max(now, all.startMs - (OUTLOOK_DAYS - 1) * D);
    /* past the daily outlook: the whole event starts after its last day (known from the rows, or by date when the
       outlook was not loaded because the event is too far out) */
    const beyond = days.every((d) => !d.covered) && (lastDaily ? dates.every((d) => d.k > lastDaily) : all.startMs >= now + (OUTLOOK_DAYS - 1) * D);
    const state = beyond ? "beyond" : rows == null || !rows.length ? "unavailable" : days.every((d) => !d.covered) ? "unavailable" : days.some((d) => !d.covered) ? "some" : "outlook";
    return { state, days, hourly: R.state, firstAt: R.firstAt, readyAt: R.readyAt, outlookAt: state === "beyond" ? outlookAt : null };
  }

  /* HTML for the model; f: { dayName(k), when(ms) } venue-local formatting; remind: the calendar reminder HTML */
  function html(m, f, remind = "") {
    if (m.state === "none") return "";
    const timing = m.hourly === "pending"
      ? `Hourly guidance should reach setup around <b>${esc(f.when(m.firstAt))}</b> and the whole event around <b>${esc(f.when(m.readyAt))}</b>.`
      : `The rest of the event should come into hourly range around <b>${esc(f.when(m.readyAt))}</b>.`;
    if (m.state === "beyond") return `<div class="ev-outlook" data-outlook="beyond"><h3>Early weather outlook</h3>
      <p class="ev-ol-lead">This event is past the 10-day outlook. A lot can change this far out.</p>
      <p class="bx-note">The daily outlook should start covering it around <b>${esc(f.when(m.outlookAt))}</b>. ${timing}</p>${remind}</div>`;
    if (m.state === "unavailable") return `<div class="ev-outlook" data-outlook="unavailable"><h3>Early weather outlook</h3>
      <p class="bx-note">The daily outlook could not be loaded just now. ${timing}</p>${remind}</div>`;
    const cards = m.days.map((d) => d.covered ? `<div class="ev-ol-day" data-day="${esc(d.k)}"><div class="ev-ol-date">${esc(f.dayName(d.k))}<span class="bx-note"> · ${esc(d.parts.join(", "))}</span></div>
        <dl class="ev-ol-vals"><div><dt>High / low</dt><dd><b>${d.hi == null ? "—" : d.hi + "°"}</b> / <b>${d.lo == null ? "—" : d.lo + "°"}</b></dd></div>
        <div><dt>Chance of precipitation</dt><dd><b data-ol-pop>${d.pop == null ? "—" : d.pop + "%"}</b></dd></div></dl>
        <p class="ev-ol-type" data-ol-type="${d.type.kind}">${esc(d.type.text)}</p>
        <p class="bx-note ev-ol-period">For the whole day, midnight to midnight venue time, not the event hours.</p></div>`
      : `<div class="ev-ol-day ev-ol-out" data-day="${esc(d.k)}"><div class="ev-ol-date">${esc(f.dayName(d.k))}<span class="bx-note"> · ${esc(d.parts.join(", "))}</span></div><p class="bx-note">Past the 10-day outlook: no numbers yet.</p></div>`).join("");
    return `<div class="ev-outlook" data-outlook="${m.state}"><h3>Early weather outlook</h3>
      <p class="ev-ol-lead">A lot can change this far out. These are daily figures from the Forecast Blend, not a forecast for the start time.</p>
      <div class="ev-ol-days">${cards}</div><p class="bx-note">${timing}${m.hourly === "partial" ? " Hours already in range are in Hour by hour below; the rest stay blank until then." : ""}</p>${remind}</div>`;
  }
  const api = { build, html, dayType, OUTLOOK_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventOutlook = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
