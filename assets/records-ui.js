/* Weather Records & Milestones on the page: Overview's compact highlights and Almanac's "Historical Insights & Fun Facts".
   Reads the market's small precomputed pack (feeds/insights/<id>.json, built by tools/build-insights.js); never a climate
   archive. Without a pack for the selected place, Overview shows nothing and Almanac can still judge daily records from
   the calendar-day history it already loaded (RecordsEngine, scope "calendarDay"). Any failure leaves the section hidden
   and the rest of the page as it was. Browser: window.RecordsUI. */
(function (root) {
  "use strict";
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const BASE = "feeds/insights/", TTL = 15 * 60e3;
  const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  async function getJSON(url) {
    const key = `ins:${url}`;
    try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.at < TTL) return c.v; } catch (e) { /* no storage */ }
    const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const v = await r.json();
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch (e) { /* full or blocked */ }
    return v;
  }
  /* the pack for a place: the nearest market whose radius covers it */
  async function packFor(lat, lon) {
    if (!isFinite(+lat) || !isFinite(+lon)) return null;
    try { const idx = await getJSON(`${BASE}index.json`); const m = (idx.markets || []).map((x) => ({ ...x, d: km(+lat, +lon, x.lat, x.lon) })).filter((x) => x.d <= (x.radiusKm || 50)).sort((a, b) => a.d - b.d)[0];
      return m ? await getJSON(`${BASE}${m.id}.json`) : null; } catch (e) { return null; }
  }
  const localDate = (tz, ms) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
  const chip = (it) => `<span class="rec-status" data-status="${esc(it.status)}">${esc(it.label)}</span>`;
  const firstSentence = (t) => (String(t).match(/^.*?[.!?](\s|$)/) || [t])[0].trim();
  const almanacHref = (pack, loc, date) => `almanac.html?${new URLSearchParams({ lat: loc.lat, lon: loc.lon, name: loc.name || pack.market.name, date })}#insights`;

  /* Overview: up to three highlights from yesterday or today (market time); hidden on ordinary days */
  async function overview(host, { lat, lon, name, now = Date.now() } = {}) {
    if (!host) return null; const my = (host._seq = (host._seq || 0) + 1);
    const pack = await packFor(lat, lon); if (my !== host._seq) return null;
    const today = pack ? localDate(pack.market.tz, now) : null, days = pack ? [today, addDays(today, -1)].filter((d) => pack.days && pack.days[d]) : [];
    const d = days[0], day = d ? pack.days[d] : null, hl = day ? day.highlights.map((id) => day.items.find((i) => i.id === id)).filter(Boolean).slice(0, 3) : [];
    if (!hl.length) { host.hidden = true; host.innerHTML = ""; host.dataset.records = "none"; return null; }
    const when = d === today ? "Today" : "Yesterday", loc = { lat, lon, name };
    host.innerHTML = `<div class="rec-ov-h"><h2 class="group-title">Weather Records &amp; Milestones</h2><span class="msg">${esc(when)} · ${esc(pack.market.record.name)} record</span></div>` +
      `<ul class="rec-ov-list">${hl.map((it) => `<li class="rec-ov-item" data-id="${esc(it.id)}">${chip(it)}<b>${esc(it.head)}</b><span class="rec-ov-body">${esc(it.short || firstSentence(it.body))}</span><a class="rec-ov-more" href="${esc(almanacHref(pack, loc, d))}">Details and sources in Almanac →</a></li>`).join("")}</ul>`;
    host.hidden = false; host.dataset.records = d; return { date: d, items: hl };
  }

  /* Almanac: every finding for the selected date with its evidence and a stand-alone Copy fact */
  function factHtml(it, i) {
    return `<li class="rec-fact" data-id="${esc(it.id)}"><div class="rec-fact-h">${chip(it)}<b>${esc(it.head)}</b></div><p>${esc(it.body)}</p>` +
      `<p class="rec-ev"><b>Source</b> ${esc(it.evidence.source)} · <b>Range</b> ${esc(it.evidence.range)} · <b>Sample</b> ${esc(it.evidence.sample)}</p>` +
      `<div class="rec-copy"><q class="rec-copytext" id="recCopy${i}">${esc(it.copyFact)}</q><button class="btn ghost sm" type="button" data-copy="recCopy${i}">Copy fact</button><span class="rec-copied" role="status" aria-live="polite"></span></div></li>`;
  }
  async function almanac(host, { lat, lon, date, calendarDay = null } = {}) {
    if (!host) return null; const my = (host._seq = (host._seq || 0) + 1);
    const pack = await packFor(lat, lon); if (my !== host._seq) return null;
    let items = [], note = "", src = "";
    if (pack && pack.days && pack.days[date]) { items = pack.days[date].items; src = pack.sources.join(" · "); }
    else if (calendarDay && root.RecordsEngine) {
      const E = root.RecordsEngine; try {
        const f = E.findings({ market: calendarDay.market, date, S: calendarDay.S, status: () => calendarDay.status || "preliminary", scope: "calendarDay" });
        items = f.items; note = pack ? "" : "Daily records only for this place: holiday rankings, historical frequency and longer context come from a records pack, which this market doesn't have yet.";
      } catch (e) { items = []; } }
    if (!items.length) { host.hidden = true; host.innerHTML = ""; host.dataset.records = "none"; return null; }
    host.innerHTML = `<div class="section-title" id="insights">Historical Insights &amp; Fun Facts</div>` +
      `<p class="msg rec-legend"><span class="rec-status" data-status="final">Observed record</span> quality-controlled data · <span class="rec-status" data-status="preliminary">Preliminary observation</span> the daily climate report, before final review · records never use forecasts</p>` +
      `<ul class="rec-facts">${items.map(factHtml).join("")}</ul>${note ? `<p class="msg">${esc(note)}</p>` : ""}${src ? `<p class="msg rec-src">Data: ${esc(src)}</p>` : ""}`;
    host.hidden = false; host.dataset.records = date;
    host.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      const t = document.getElementById(b.dataset.copy).textContent, out = b.nextElementSibling;
      try { await navigator.clipboard.writeText(t); out.textContent = "Copied"; } catch (e) { const r = document.createRange(); r.selectNodeContents(document.getElementById(b.dataset.copy)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); out.textContent = "Selected: press Ctrl+C or ⌘C"; }
      setTimeout(() => { out.textContent = ""; }, 2500); }));
    if (location.hash === "#insights") host.scrollIntoView({ block: "start" });
    return { date, items };
  }
  root.RecordsUI = { packFor, overview, almanac };
})(typeof globalThis !== "undefined" ? globalThis : this);
