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
  /* a new place clears the section at once, before anything loads, so one market's facts never sit under another's name */
  function forPlace(host, lat, lon) { const key = `${(+lat).toFixed(3)},${(+lon).toFixed(3)}`; if (host.dataset.place !== key) { host.hidden = true; host.innerHTML = ""; host.dataset.records = "loading"; host.dataset.place = key; } }
  const STALE_MS = 36 * 3600e3; // the refresh runs several times a day; a pack older than this is flagged
  const fmtStamp = (iso, tz) => new Date(iso).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  async function coverage() { try { const idx = await getJSON(`${BASE}index.json`); return (idx.markets || []).map((m) => `${m.name} (${m.record || "official record"}, through ${m.through})`); } catch (e) { return []; } }
  const localDate = (tz, ms) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
  const chip = (it) => `<span class="rec-status" data-status="${esc(it.status)}">${esc(it.label)}</span>`;
  /* the legend lists only the statuses on screen */
  const LEGEND = [["final", "Observed record", "confirmed against NCEI's quality-controlled archive"], ["preliminary", "Preliminary observation", "a provisional report, such as the daily climate report, not yet confirmed"], ["unconfirmed", "Archive confirmation unavailable", "the station's historical observation, not checked against the archive"]];
  const legend = (items) => LEGEND.filter(([k]) => items.some((i) => i.status === k)).map(([k, l, t]) => `<span class="rec-status" data-status="${k}">${l}</span> ${t}`).join(" · ");
  const firstSentence = (t) => (String(t).match(/^.*?[.!?](\s|$)/) || [t])[0].trim();
  const almanacHref = (pack, loc, date) => `almanac.html?${new URLSearchParams({ lat: loc.lat, lon: loc.lon, name: loc.name || pack.market.name, date })}#insights`;

  /* Overview: up to three highlights from yesterday or today (market time); hidden on ordinary days */
  async function overview(host, { lat, lon, name, now = Date.now() } = {}) {
    if (!host) return null; forPlace(host, lat, lon); const my = (host._seq = (host._seq || 0) + 1);
    const pack = await packFor(lat, lon); if (my !== host._seq) return null;
    const today = pack ? localDate(pack.market.tz, now) : null, days = pack ? [today, addDays(today, -1)].filter((d) => pack.days && pack.days[d]) : [];
    const d = days[0], day = d ? pack.days[d] : null, hl = day ? day.highlights.map((id) => day.items.find((i) => i.id === id)).filter(Boolean).slice(0, 3) : [];
    if (!hl.length) { host.hidden = true; host.innerHTML = ""; host.dataset.records = "none"; return null; }
    const when = d === today ? "Today" : "Yesterday", loc = { lat, lon, name };
    host.innerHTML = `<div class="rec-ov-h"><h2 class="group-title">Weather Records &amp; Milestones</h2><span class="msg">${esc(when)} · ${esc(pack.market.record.name.startsWith(pack.market.name) ? "" : `${pack.market.name}: `)}${esc(pack.market.record.name)} official record</span></div>` +
      `<ul class="rec-ov-list">${hl.map((it) => `<li class="rec-ov-item" data-id="${esc(it.id)}">${chip(it)}<b>${esc(it.head)}</b><span class="rec-ov-body">${esc(it.short || firstSentence(it.body))}</span><a class="rec-ov-more" href="${esc(almanacHref(pack, loc, d))}">Details and sources in Almanac →</a></li>`).join("")}</ul>`;
    host.hidden = false; host.dataset.records = d; return { date: d, items: hl };
  }

  /* Almanac: every finding for the selected date with its evidence and a stand-alone Copy fact */
  function factHtml(it, i) {
    return `<li class="rec-fact" data-id="${esc(it.id)}"><div class="rec-fact-h">${chip(it)}<b>${esc(it.head)}</b></div><p>${esc(it.body)}</p>` +
      `<p class="rec-ev"><b>Source</b> ${esc(it.evidence.source)} · <b>Range</b> ${esc(it.evidence.range)} · <b>Sample</b> ${esc(it.evidence.sample)}</p>` +
      `<div class="rec-copy"><q class="rec-copytext" id="recCopy${i}">${esc(it.copyFact)}</q><button class="btn ghost sm" type="button" data-copy="recCopy${i}">Copy fact</button><span class="rec-copied" role="status" aria-live="polite"></span></div></li>`;
  }
  async function almanac(host, { lat, lon, date, calendarDay = null, now = Date.now() } = {}) {
    if (!host) return null; forPlace(host, lat, lon); const my = (host._seq = (host._seq || 0) + 1);
    const pack = await packFor(lat, lon); if (my !== host._seq) return null;
    let items = [], note = "", src = "", cov = "";
    if (pack) { const t = pack.market.tz, age = now - Date.parse(pack.generated);
      cov = `${pack.market.name} records pack: ${pack.market.record.name} (${pack.market.record.kind === "threaded" ? "official city record" : "station record"}, ${pack.market.record.sid}), findings for the ${pack.windowDays || 7} days through ${pack.through}. A finding is an observed record only once NCEI's quality-controlled archive has the same value for that date and measurement (archive through ${pack.finalThrough || "unknown"}); otherwise it is preliminary. Refreshed ${fmtStamp(pack.generated, t)}.` +
        (age > STALE_MS ? ` This refresh is ${Math.round(age / 3600e3)} hours old, so newer observations or revisions aren't reflected yet.` : ""); }
    if (pack && pack.days && pack.days[date]) { items = pack.days[date].items; src = pack.sources.join(" · "); }
    else if (calendarDay && root.RecordsEngine) {
      const E = root.RecordsEngine; try {
        const f = E.findings({ market: calendarDay.market, date, S: calendarDay.S, status: () => calendarDay.status || "unconfirmed", scope: "calendarDay" });
        items = f.items; if (!pack) { const c = await coverage(); if (my !== host._seq) return null; note = `Daily records only for this place, from its climate station's history. These values haven't been checked against NCEI's quality-controlled archive, so they're marked Archive confirmation unavailable. Holiday rankings, historical frequency and longer context need a records pack; this preview has packs for ${c.join(" and ") || "no markets"}.`; }
      } catch (e) { items = []; } }
    if (!items.length) { host.hidden = true; host.innerHTML = ""; host.dataset.records = "none"; return null; }
    host.innerHTML = `<div class="section-title" id="insights">Historical Insights &amp; Fun Facts</div>` +
      `<p class="msg rec-legend">${legend(items)} · records never use forecasts</p>` +
      `<ul class="rec-facts">${items.map(factHtml).join("")}</ul>${note ? `<p class="msg rec-cov" data-coverage="station">${esc(note)}</p>` : ""}${cov ? `<p class="msg rec-cov" data-coverage="pack">${esc(cov)}</p>` : ""}${src ? `<p class="msg rec-src">Data: ${esc(src)}</p>` : ""}`;
    host.hidden = false; host.dataset.records = date;
    host.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      const t = document.getElementById(b.dataset.copy).textContent, out = b.nextElementSibling;
      try { await navigator.clipboard.writeText(t); out.textContent = "Copied"; } catch (e) { const r = document.createRange(); r.selectNodeContents(document.getElementById(b.dataset.copy)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); out.textContent = "Selected: press Ctrl+C or ⌘C"; }
      setTimeout(() => { out.textContent = ""; }, 2500); }));
    if (location.hash === "#insights") host.scrollIntoView({ block: "start" });
    return { date, items };
  }

  /* Record Spotlight (Almanac, above the climate table): what the selected date broke or tied, in words, with the observed
     value, the previous record and year, and the status; on today's sheet, a record set yesterday, with its date and a
     link to that row of yesterday's climate table. Uses the same findings as the section below (records pack, or the
     station-history fallback), so market selection and archive-confirmation rules are the same. Ranks that didn't break
     or tie a record, holiday rankings and context never lead here; a holiday ranking can follow as its own line. */
  const sDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const an = (n) => (/^(8|11|18)$/.test(String(n)) || /^8\d$/.test(String(n)) || /^8\d\d$/.test(String(n)) ? "an" : "a");
  const RECWORD = { pcpn: "rainfall record", snow: "snowfall record", hiMax: "record high", loMin: "record low", hiMin: "record warm low", loMax: "record cold high" };
  const isRecord = (it) => it.fact && (it.fact.outcome === "new" || it.fact.outcome === "tie");
  async function itemsFor(pack, date, calendarDay) {
    if (pack && pack.days && pack.days[date]) return pack.days[date].items;
    if (pack && date >= addDays(pack.through, -(pack.windowDays || 7) + 1) && date <= pack.through) return []; // the pack looked at this day and found nothing
    if (calendarDay && root.RecordsEngine) { try { return root.RecordsEngine.findings({ market: calendarDay.market, date, S: calendarDay.S, status: () => calendarDay.status || "unconfirmed", scope: "calendarDay" }).items; } catch (e) { return []; } }
    return [];
  }
  const badgeText = (f) => (f.outcome === "tie" ? "Tied record" : "New record") + (f.el === "hiMin" ? " warm low" : f.el === "loMax" ? " cold high" : "");
  async function spotlight(host, { lat, lon, date, today, calendarDay = null, where = "", rowHref = null } = {}) {
    if (!host) return null; forPlace(host, lat, lon); const my = (host._seq = (host._seq || 0) + 1);
    const pack = await packFor(lat, lon); if (my !== host._seq) return null;
    const stn = (pack && pack.market.normals && pack.market.normals.sid) || where || "";
    const at = stn ? ` at ${stn}` : "";
    let html = "", marks = [];
    const sel = (await itemsFor(pack, date, calendarDay)).filter(isRecord);
    if (sel.length) {
      const all = pack && pack.days && pack.days[date] ? pack.days[date].items : [], hol = all.find((i) => /^hol-/.test(i.id));
      marks = sel.map((it) => ({ row: it.fact.row, text: badgeText(it.fact), status: it.status }));
      html = sel.slice(0, 3).map((it, k) => { const f = it.fact;
        const head = f.outcome === "new" ? `New ${sDay(date)} ${RECWORD[f.el]}` : `Tied the ${sDay(date)} ${RECWORD[f.el]}`;
        const line = f.outcome === "new" ? `<b>${esc(f.v)}</b>${esc(at)}, beating the previous record of <b>${esc(f.pv)}</b> set in ${esc(f.yrs)}.` : `<b>${esc(f.v)}</b>${esc(at)}, tying the record set in ${esc(f.yrs)}.`;
        return `<div class="spot-item${k ? " spot-more" : ""}" data-id="${esc(it.id)}"><h2 class="spot-h">${esc(head)} ${chip(it)}</h2><p class="spot-line">${line}</p>` +
          `<a class="spot-link" href="#climo-${esc(f.row)}" data-row="${esc(f.row)}">Find it in the climate table ↓</a></div>`; }).join("") +
        (hol ? `<p class="spot-aside" data-id="${esc(hol.id)}"><b>Holiday ranking</b> ${chip(hol)} ${esc(hol.head.replace(/ on record$/, ""))} in the ${esc(pack.market.record.name)} record, ranked against each year's own holiday date. This is a separate comparison from the calendar-day record above.</p>` : "");
    } else if (today && date === today && pack) {
      const y = addDays(today, -1), yi = ((pack.days && pack.days[y] && pack.days[y].items) || []).filter(isRecord);
      if (yi.length) { const it = yi.slice().sort((a, b) => b.score - a.score)[0], f = it.fact, more = yi.length - 1;
        const head = f.outcome === "new" ? `Yesterday broke ${f.age >= 2 ? `${an(f.age)} ${f.age}-year-old` : "a"} ${RECWORD[f.el]}` : `Yesterday tied the ${sDay(y)} ${RECWORD[f.el]}`;
        const href = rowHref ? rowHref(y, f.row) : `#climo-${f.row}`;
        html = `<div class="spot-item" data-id="${esc(it.id)}" data-date="${esc(y)}"><h2 class="spot-h">${esc(head)} ${chip(it)}</h2><p class="spot-line"><b>${esc(f.v)}</b>${esc(at)} on ${esc(sDay(y))}${more ? `, and ${more} more record${more > 1 ? "s" : ""} that day` : ""}. <a class="spot-link" href="${esc(href)}">View yesterday's climate report →</a></p></div>`; }
    }
    if (!html) { host.hidden = true; host.innerHTML = ""; host.dataset.records = "none"; return { date, marks: [] }; }
    host.innerHTML = `<div class="spot-kick"><span class="spot-star" aria-hidden="true">★</span> Record Spotlight</div>${html}`;
    host.hidden = false; host.dataset.records = date;
    host.querySelectorAll("a[data-row]").forEach((a) => a.addEventListener("click", (e) => { const r = document.getElementById(`climo-${a.dataset.row}`); if (r) { e.preventDefault(); r.scrollIntoView({ block: "center" }); history.replaceState(null, "", `${location.pathname}${location.search}#climo-${a.dataset.row}`); } }));
    return { date, marks };
  }
  /* the climate table's rows for a record: a text badge beside the row's name (readable without colour) */
  function markRows(table, marks) {
    if (!table) return; table.querySelectorAll(".rec-badge").forEach((b) => b.remove()); table.querySelectorAll("tr.rec-row").forEach((r) => r.classList.remove("rec-row"));
    (marks || []).forEach((m) => { const tr = table.querySelector(`tr[data-climo-row="${m.row}"]`); if (!tr) return; tr.classList.add("rec-row"); const th = tr.querySelector("th"); if (!th) return; const sm = th.querySelector("small"), badge = `<span class="rec-badge" data-status="${esc(m.status)}">${esc(m.text)}</span>`;
      if (sm) sm.insertAdjacentHTML("beforebegin", badge); else th.insertAdjacentHTML("beforeend", badge); });
  }
  root.RecordsUI = { packFor, overview, almanac, spotlight, markRows };
})(typeof globalThis !== "undefined" ? globalThis : this);
