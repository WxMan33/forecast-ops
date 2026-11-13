/* The Almanac's daily reporting flow, without network or page code (browser: window.ClimateDaily; Node: require).
   "Yesterday's weather" and "Today's climate update" come from NWS daily climate reports (CLI) for the selected
   climate station, with RCC-ACIS daily observations as the fallback. Rules:
   - A product's observation date is the date in its "CLIMATE SUMMARY FOR <date>" line, never its issue date.
     A report issued this morning normally describes yesterday.
   - A report "VALID (TODAY) AS OF <time>" before 11:59 PM is interim: the day was not over. Only a report without
     that line, or valid as of 11:59 PM, is a completed day. Interim values never enter complete-day totals.
   - Among reports for the same date and station, a completed day beats an interim one; within the same kind the
     latest issuance wins, so a correction (new issuance, often marked CC?) replaces the report it corrects.
   - NWS climate days run midnight to midnight local STANDARD time all year.
   - A failed refresh keeps the last valid reports with their own retrieval time; it is never "not reported yet". */
(function (root) {
  'use strict';
  const R = root.ClimateReport || (typeof require !== 'undefined' ? require('./climate-report.js') : null);
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
  const num = (s) => { if (s == null) return null; const t = String(s).replace(/R$/, ''); if (t === 'T') return { trace: true, value: 0 }; return /^-?\d+(\.\d+)?$/.test(t) ? { value: +t } : null; };

  /* the NORMAL and DEPARTURE columns for one line, read only when the line has the full column set */
  function columns(text, section, label) {
    const m = new RegExp(section + '[\\s\\S]*?\\n\\s*' + label + '\\s+([^\\n]*)').exec(text);
    if (!m) return null;
    const toks = m[1].trim().replace(/(\d{1,2}:\d{2})\s+(AM|PM)/g, 'TIME').split(/\s+/).filter((t) => t !== 'TIME');
    // value, record, record year, normal, departure, last year
    if (toks.length !== 6) return null;
    const normal = num(toks[3]), dep = num(toks[4]);
    return normal ? { normal: normal.value, departure: dep && !dep.trace ? dep.value : null } : null;
  }
  /* A CLI lists record highs, record lows and daily precip/snow maxima, not every kind of record. */
  function recordColumn(text, section, label) {
    const body = new RegExp(section + '\\s*\\n([\\s\\S]*?)(?=\\n[A-Z]|$)').exec(text);
    const line = body && new RegExp('^\\s*' + label + '\\s+(\\S+)\\s+(?:(?:\\d{1,2}:\\d{2})\\s+[AP]M\\s+)?(\\S+)\\s+(\\d{4})(?=\\s|$)', 'm').exec(body[1]);
    if (!line) return null;
    const observed = num(line[1]), record = num(line[2]);
    return observed && record ? { observed, record, year: +line[3], flagged: /R$/.test(line[1]) } : null;
  }
  function recordStatus(report) {
    if (!report || !report.records) return { text: 'Record comparison unavailable.', checked: 0, events: [] };
    const names = { maxt: 'Daily high', mint: 'Daily low', pcpn: 'Daily precipitation', snow: 'Daily snowfall' };
    const events = []; let checked = 0;
    for (const [key, r] of Object.entries(report.records)) {
      if (!r) continue;
      checked++;
      // A dry day tying a zero/trace maximum is not a meaningful precipitation record.
      if (['pcpn', 'snow'].includes(key) && (r.observed.trace || r.observed.value === 0)) continue;
      const diff = r.observed.value - r.record.value;
      const broken = key === 'mint' ? diff < 0 : diff > 0;
      const tied = diff === 0 && r.observed.trace === r.record.trace;
      if (broken || tied || r.flagged) events.push(`${names[key]} record ${broken ? 'broken' : tied ? 'tied' : 'reported by NWS'}${report.kind === 'interim' ? ' so far' : ''}${!r.flagged ? ` (previous record ${r.record.value}${key === 'maxt' || key === 'mint' ? '°F' : ' inches'} in ${r.year})` : ''}.`);
    }
    const prefix = report.kind === 'interim' ? 'Interim: ' : '';
    return { checked, events, text: prefix + (events.length ? events.join(' ') + (checked < 4 ? ' Other record comparisons unavailable.' : '') : checked === 4 ? 'No daily high, low, precipitation or snowfall record tied or broken in this report.' : 'Record comparison incomplete; no record conclusion for missing items.') };
  }
  function parse(product, station) {
    const base = R.parseCLI(product, station); if (!base) return null;
    const text = String(product.productText || '').replace(/\r/g, '');
    const wmo = /^[A-Z]{4}\d{2} [A-Z]{4} \d{6}(?: ([A-Z]{3}))?\s*$/m.exec(text);
    const corrected = !!(wmo && /^CC[A-Z]$/.test(wmo[1] || '')) || /\bCORRECTED\b/.test(text);
    const day = /\n\s*(TODAY|YESTERDAY)\s*\n/.exec(text);
    const T = 'TEMPERATURE \\(F\\)', P = 'PRECIPITATION \\(IN\\)', S = 'SNOWFALL \\(IN\\)', d = '(?:TODAY|YESTERDAY)';
    return { ...base, kind: base.complete ? 'final' : 'interim', corrected, issuedMs: Date.parse(base.issuedAt) || null, dayWord: day ? day[1] : null,
      records: { maxt: recordColumn(text, T, 'MAXIMUM'), mint: recordColumn(text, T, 'MINIMUM'), pcpn: recordColumn(text, P, d), snow: recordColumn(text, S, d) },
      normals: { maxt: columns(text, T, 'MAXIMUM'), mint: columns(text, T, 'MINIMUM'), pcpn: columns(text, P, d), snow: columns(text, S, d) } };
  }
  /* the report to use for one date: a completed day over an interim one, then the latest issuance */
  function choose(reports, date, station) {
    const xs = (reports || []).filter((r) => r && r.date === date && (!station || r.station === station));
    xs.sort((a, b) => (a.kind === b.kind ? (b.issuedMs || 0) - (a.issuedMs || 0) : a.kind === 'final' ? -1 : 1));
    return xs[0] || null;
  }

  /* one day's summary from an NWS report or an ACIS row; normals from the report, else from ACIS normals */
  function summary(date, { report = null, acisRow = null, normalRow = null, A }) {
    const val = (raw) => { const x = A.val(raw); return x.missing ? null : { value: x.v, trace: !!x.trace }; };
    const nrm = (col) => { const x = normalRow ? A.val(normalRow[col]) : { missing: true }; return x.missing ? null : x.v; };
    const acisComplete = !!acisRow && [1, 2].every((c) => !A.val(acisRow[c]).missing);
    const src = report && report.kind === 'final' ? 'nws' : acisComplete ? 'acis' : report ? 'nws' : acisRow ? 'acis' : null;
    const row = src === 'nws' ? report.row : src === 'acis' ? acisRow : null;
    const item = (id, col) => {
      const o = row ? val(row[col]) : null, c = src === 'nws' && report.normals ? report.normals[id] : null;
      const normal = c ? c.normal : nrm(col);
      /* the report's own departure when its normal is used; otherwise observed minus the ACIS normal (a trace counts as 0) */
      const departure = !o || normal == null ? null : c && c.departure != null ? c.departure : +((o.trace ? 0 : o.value) - normal).toFixed(2);
      return { observed: o, normal, departure, normalFrom: c ? 'NWS report' : normal != null ? 'NCEI 1991–2020 (ACIS)' : null };
    };
    return { date, source: src, kind: src === 'nws' ? report.kind : src === 'acis' ? (acisComplete ? 'final' : 'partial') : null,
      report: src === 'nws' ? report : null, items: { maxt: item('maxt', 1), mint: item('mint', 2), pcpn: item('pcpn', 3), snow: item('snow', 4) } };
  }

  /* everything the morning/evening view needs, for the location's today */
  function view({ today, reports = [], station, acisRows = [], normalRows = [], A, check = {} }) {
    const yesterday = addDays(today, -1), rowOf = (rows, d) => (rows || []).find((r) => r[0] === d) || null;
    const y = summary(yesterday, { report: choose(reports, yesterday, station), acisRow: rowOf(acisRows, yesterday), normalRow: rowOf(normalRows, yesterday), A });
    const t = choose(reports, today, station);
    const later = reports.find((r) => r && r.station === station && r.date > today) || null; // a report dated after "today": the viewer's clock or zone is off
    return { today, yesterday, y, t: t ? summary(today, { report: t, normalRow: rowOf(normalRows, today), A }) : null, check, later };
  }
  /* the one report that may extend complete-day totals for a date: completed days only */
  const forTotals = (reports, date, station) => { const r = choose(reports, date, station); return r && r.kind === 'final' ? r : null; };
  /* the status line under the section: checked, failed (keeping what we had) or not checked */
  function checkLine(check, fmtTime) {
    if (!check || !check.at) return 'NWS climate reports not checked yet.';
    if (check.error) return `Couldn't refresh NWS climate reports at ${fmtTime(check.at)} (${check.error}).${check.lastGoodAt ? ` Showing the reports retrieved at ${fmtTime(check.lastGoodAt)}.` : ' No earlier reports are saved in this browser.'}`;
    return `NWS climate reports checked at ${fmtTime(check.at)}.`;
  }
  const api = { parse, choose, summary, view, forTotals, checkLine, addDays, recordStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimateDaily = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
