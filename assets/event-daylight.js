/* Event Manager daylight: sunrise and sunset at the venue for each venue-local date the event touches, and one short
   note when daylight matters to the schedule. Calculated locally with the Almanac's NOAA Solar Calculator algorithm
   (AlmanacCore.noaaSun), rounded to the minute the way NOAA's table and the Almanac round them. No network.
   Browser: window.EventDaylight; Node: require(). */
(function (root) {
  "use strict";
  const MAX_DAYS = 3; // a longer event lists its first and last dates
  const PHASE_WORD = { setup: "Setup", gates: "Gates", event: "The event", teardown: "Teardown" };
  const lower = (k) => (k === "event" ? "the event" : PHASE_WORD[k] ? PHASE_WORD[k].toLowerCase() : k);
  const addDays = (ymd, n) => new Date(Date.parse(ymd + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  /* the Almanac's clock: "7:34 AM", venue-local */
  function hm(C, ms, tz) { const s = C.time.toLocal(ms, tz); let h = +s.slice(11, 13); const m = s.slice(14, 16), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${m} ${ap}`; }
  function dayLabel(ymd) { return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); }
  /* sun for one venue-local date, exactly as the Almanac asks for it (offset at local noon handles DST change days) */
  function sunOn(A, C, ymd, lat, lon, tz) {
    const s = A.noaaSun(ymd, lat, lon, C.time.offsetMin(C.time.toUtc(`${ymd}T12:00`, tz), tz));
    return { date: ymd, rise: s.rise == null ? null : A.roundMin(s.rise), set: s.set == null ? null : A.roundMin(s.set), zone: C.time.abbr(C.time.toUtc(`${ymd}T12:00`, tz), tz) };
  }
  /* windows: C.event.windows(ev) (phases plus "all"); returns { days, shown, zone, note, notes } */
  function compute({ A, C, windows, lat, lon, tz }) {
    const phases = windows.filter((w) => w.key !== "all"), all = windows.find((w) => w.key === "all");
    if (!all || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const first = C.time.toLocal(all.startMs, tz).slice(0, 10);
    let last = C.time.toLocal(all.endMs - 1, tz).slice(0, 10); // an end at midnight belongs to the day before
    if (last < first) last = first;
    const days = []; for (let d = first; d <= last && days.length < 8; d = addDays(d, 1)) days.push(sunOn(A, C, d, lat, lon, tz));
    const shown = days.length > MAX_DAYS ? [days[0], days[days.length - 1]] : days;
    /* every sunrise and sunset from the evening before to the morning after, for the schedule notes */
    const around = [sunOn(A, C, addDays(first, -1), lat, lon, tz), ...days, sunOn(A, C, addDays(last, 1), lat, lon, tz)];
    const marks = []; around.forEach((d) => { if (d.rise != null) marks.push({ kind: "rise", ms: d.rise }); if (d.set != null) marks.push({ kind: "set", ms: d.set }); });
    marks.sort((a, b) => a.ms - b.ms);
    const dark = (ms) => { const prev = marks.filter((m) => m.ms <= ms).pop(); return prev ? prev.kind === "set" : false; };
    const notes = [];
    /* the event begins in darkness: before sunrise (early morning) or after sunset (evening) */
    if (dark(all.startMs)) {
      const prev = marks.filter((m) => m.ms <= all.startMs).pop(), next = marks.find((m) => m.ms > all.startMs);
      const evening = C.time.toLocal(prev.ms, tz).slice(0, 10) === C.time.toLocal(all.startMs, tz).slice(0, 10);
      const p0 = phases[0], w = PHASE_WORD[p0.key] || p0.label;
      if (!next || next.ms >= all.endMs) notes.push({ ms: all.startMs, kind: "allDark", text: evening ? `The whole event is after sunset (${hm(C, prev.ms, tz)}).` : `The whole event is before sunrise (${hm(C, next.ms, tz)}).` });
      else notes.push({ ms: all.startMs, kind: evening ? "afterSet" : "beforeRise", text: evening ? `${w} starts after sunset (${hm(C, prev.ms, tz)}).` : `${w} starts before sunrise (${hm(C, next.ms, tz)}).` });
    }
    /* a sunrise or sunset inside a phase; a phase that already spans a whole night (multi-day events) isn't flagged */
    marks.filter((m) => m.ms > all.startMs && m.ms < all.endMs).forEach((m) => {
      const p = phases.find((x) => m.ms >= x.startMs && m.ms < x.endMs); if (!p || p.endMs - p.startMs > 18 * 3600e3) return;
      if (m.kind === "set") notes.push({ ms: m.ms, kind: "set", text: `Sunset during ${lower(p.key)} (${hm(C, m.ms, tz)}).` });
      else if (!notes.some((n) => n.kind === "beforeRise")) notes.push({ ms: m.ms, kind: "rise", text: `Sunrise during ${lower(p.key)} (${hm(C, m.ms, tz)}).` });
    });
    notes.sort((a, b) => a.ms - b.ms);
    const zones = [...new Set(shown.map((d) => d.zone))];
    /* one short note; an overnight event that crosses both sunset and sunrise gets both in that one line */
    const note = notes.length ? notes.slice(0, 2).map((n, i) => (i ? n.text.charAt(0).toLowerCase() + n.text.slice(1) : n.text)).join(" Then ").replace(/\.\sThen /, "; then ") : "";
    return { days, shown, skipped: days.length - shown.length, zone: zones.join("/"), zones, note, notes, hm: (ms) => (ms == null ? "—" : hm(C, ms, tz)), dayLabel };
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  /* the screen row: Daylight · date · Sunrise time · Sunset time · zone; dates labelled whenever there is more than one */
  function rowHtml(D) {
    if (!D) return "";
    const one = (d) => `<span class="ev-dl-day"><span class="ev-dl-date">${esc(dayLabel(d.date))}</span><span class="ev-dl-t"><span class="k">Sunrise</span> <b data-sunrise="${d.date}">${esc(D.hm(d.rise))}</b></span><span class="ev-dl-t"><span class="k">Sunset</span> <b data-sunset="${d.date}">${esc(D.hm(d.set))}</b></span>${D.zones.length > 1 ? `<span class="ev-dl-zone bx-note">${esc(d.zone)}</span>` : ""}</span>`;
    const days = D.shown.map(one), gap = D.skipped ? `<span class="ev-dl-more bx-note">${D.skipped} more day${D.skipped > 1 ? "s" : ""}</span>` : "";
    if (gap) days.splice(1, 0, gap);
    return `<div class="ev-daylight" data-days="${D.days.length}"><span class="ev-dl-kick">Daylight</span>${days.join("")}${D.zones.length > 1 ? "" : `<span class="ev-dl-zone bx-note">times ${esc(D.zone)}</span>`}</div>${D.note ? `<p class="ev-dl-note" data-daylight-note>${esc(D.note)}</p>` : ""}`;
  }
  /* page 1 of the printout: one compact line */
  function printLine(D) {
    if (!D) return "";
    const many = D.zones.length > 1, days = D.shown.map((d) => `${dayLabel(d.date)}: Sunrise ${D.hm(d.rise)} · Sunset ${D.hm(d.set)}${many ? ` ${d.zone}` : ""}`).join(D.skipped ? " … " : "; ");
    return `<p class="pv-daylight" data-daylight><b>Daylight</b> ${esc(days)}${many ? "" : ` ${esc(D.zone)}`}${D.note ? `<span class="pv-daylight-note"> · ${esc(D.note)}</span>` : ""}</p>`;
  }
  /* one line for Hour by hour and the TV image: "Sunrise 7:33 AM · Sunset 5:17 PM EST"; dated when the event spans
     more than one venue-local date (each date's zone when a daylight-saving change falls inside) */
  function lineParts(D) {
    if (!D) return [];
    const many = D.zones.length > 1, dated = D.days.length > 1;
    return D.shown.map((d, i) => ({ date: dated ? dayLabel(d.date) : "", rise: D.hm(d.rise), set: D.hm(d.set), zone: many || i === D.shown.length - 1 ? (many ? d.zone : D.zone) : "", gap: D.skipped && i === 0 ? `${D.skipped} more day${D.skipped > 1 ? "s" : ""}` : "" }));
  }
  function lineText(D) {
    return lineParts(D).map((x) => `${x.date ? `${x.date}: ` : ""}Sunrise ${x.rise} · Sunset ${x.set}${x.zone ? ` ${x.zone}` : ""}${x.gap ? ` … ${x.gap} …` : ""}`).join(D && D.skipped ? " " : "; ");
  }
  function lineHtml(D) {
    const parts = lineParts(D); if (!parts.length) return "";
    return `<p class="ev-dl-line" data-daylight-line>${parts.map((x) => `<span class="ev-dl-seg">${x.date ? `<span class="ev-dl-date">${esc(x.date)}:</span> ` : ""}Sunrise <b>${esc(x.rise)}</b> · Sunset <b>${esc(x.set)}</b>${x.zone ? ` <span class="ev-dl-zone">${esc(x.zone)}</span>` : ""}</span>${x.gap ? `<span class="bx-note"> · ${esc(x.gap)} · </span>` : ""}`).join(D.skipped ? "" : '<span class="ev-dl-sep">; </span>')}</p>`;
  }
  const API = { compute, rowHtml, printLine, lineText, lineHtml, sunOn, hm, dayLabel, MAX_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.EventDaylight = API;
})(typeof self !== "undefined" ? self : globalThis);
