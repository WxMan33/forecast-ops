/* Matched-calendar-period precipitation/snow records from ACIS. Pure helpers; no station assumptions.
   Yearly reductions request missing-day counts. Incomplete periods never compete for a record. */
(function (root) {
  'use strict';
  const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00Z').toISOString().slice(0, 10) === d;
  function periods(A, date, cutoff, status) {
    const y = +date.slice(0, 4), season = A.metSeason(date), month = date.slice(0, 8) + '01';
    const snowStart = `${+date.slice(5, 7) >= 7 ? y : y - 1}-07-01`;
    const end = status === 'future' ? null : cutoff && cutoff < date ? cutoff : date;
    return [['pcpn-mtd', 'pcpn', month], ['pcpn-std', 'pcpn', season.start], ['pcpn-ytd', 'pcpn', `${y}-01-01`],
      ['snow-mtd', 'snow', month], ['snow-std', 'snow', season.start], ['snow-season', 'snow', snowStart]]
      .map(([id, name, from]) => ({ id, name, from, to: end && end >= from ? end : date }));
  }
  function requests(A, { date, cutoff, status, sid, firstYear }) {
    const groups = new Map();
    for (const p of periods(A, date, cutoff, status)) {
      if (!groups.has(p.to)) groups.set(p.to, []);
      groups.get(p.to).push({ ...p, firstYear: +firstYear });
    }
    return [...groups].map(([to, specs]) => {
      // Include only earlier period-ending years. Cross-year seasons need a previous calendar year.
      let first = +firstYear;
      const last = +to.slice(0, 4) - 1, md = to.slice(5);
      while (first <= last && !valid(`${first}-${md}`)) first++;
      let final = last; while (final >= first && !valid(`${final}-${md}`)) final--;
      const body = { sid, sdate: `${first}-${md}`, edate: `${final}-${md}`, meta: ['name'], elems: specs.map(p => ({ name: p.name,
        interval: [1, 0, 0], duration: 'std', season_start: p.from.slice(5), maxmissing: 0, reduce: { reduce: 'sum', add: 'mcnt' } })) };
      return { specs, body, empty: first > final };
    });
  }
  function maximum(A, rows, spec) {
    const usable = [], seen = new Set(); let excluded = 0;
    for (const row of rows || []) {
      const d = String(row[0]), year = +d.slice(0, 4), start = `${year - (+spec.from.slice(0,4) < +spec.to.slice(0,4) ? 1 : 0)}-${spec.from.slice(5)}`;
      if (!valid(d) || d.slice(5) !== spec.to.slice(5) || year >= +spec.to.slice(0,4) || !valid(start) || +start.slice(0,4) < (spec.firstYear || 0) || seen.has(year)) continue;
      seen.add(year);
      const raw = row[1], x = Array.isArray(raw) ? A.val(raw[0]) : { missing: true };
      const count = Array.isArray(raw) && raw.length > 1 && /^(0|[1-9]\d*)$/.test(String(raw[1])) ? +raw[1] : null;
      if (x.missing || x.v < 0 || count !== 0) { excluded++; continue; }
      usable.push({ year, value: x.v, trace: !!x.trace });
    }
    if (!usable.length) return { value: null, reason: 'No complete historical periods available', n: 0, excluded };
    const value = Math.max(...usable.map(x => x.value));
    const trace = value === 0 && usable.some(x => x.trace), ties = usable.filter(x => x.value === value && (!trace || x.trace));
    usable.sort((a,b) => a.year-b.year); ties.sort((a,b) => a.year-b.year);
    return { value, trace, years: ties.map(x => x.year), crossYear: spec.from.slice(0,4) !== spec.to.slice(0,4),
      n: usable.length, from: usable[0].year, to: usable[usable.length-1].year, excluded, fromMD: spec.from.slice(5), toMD: spec.to.slice(5) };
  }
  function collect(A, request, response) {
    return Object.fromEntries(request.specs.map((p, i) => [p.id, response && response.error
      ? { value: null, reason: `Record lookup unavailable (${response.error})` }
      : maximum(A, (response && response.data || []).map(row => [row[0], row[i+1]]), p)]));
  }
  function snowDepth(A, rows, date) {
    return maximum(A, (rows || []).map(row => [row[0], [row[5], 0]]), { from: date, to: date });
  }
  const api = { periods, requests, maximum, collect, snowDepth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimatePeriodRecords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
