/* Climate-sheet presentation model. Observations/normals: CVG; records: city threaded series.
   Missing/accumulated amounts stay unavailable. Calendar-date comparisons never invent Feb 29. */
(function (root) {
  'use strict';
  function previousYear(date) {
    const next = (+date.slice(0, 4) - 1) + date.slice(4);
    return new Date(next + 'T12:00:00Z').toISOString().slice(0, 10) === next ? next : null;
  }
  /* status: "observed" (a past date), "today" (in progress: reported values are preliminary, the rest pending) or
     "future" (reference values only). cutoff: the last date included in observed totals (<= date); when it is earlier
     than date the totals are labelled with it and never shown as complete for the selected date. */
  function build(A, { date, observations = [], normals = [], records = null, observed = true, status = null, cutoff = null, pending = false }) {
    status = status || (observed ? "observed" : "future");
    observed = status !== "future";
    const end = status === "future" ? null : (cutoff && cutoff < date ? cutoff : date);
    const om = new Map(observations.map(r => [r[0], r]));
    const nm = new Map(normals.map(r => [r[0], r]));
    const prior = previousYear(date), daily = om.get(date), normal = nm.get(date), last = prior && om.get(prior);
    const value = raw => { const x = A.val(raw); return { value: x.missing ? null : x.v, trace: !!x.trace }; };
    const missing = reason => ({ value: null, reason });
    const average = row => { const hi = value(row?.[1]), lo = value(row?.[2]); return hi.value == null || lo.value == null ? missing('High or low missing') : { value: (hi.value + lo.value) / 2 }; };
    const record = key => records?.[key] ? { value: records[key].value, years: records[key].value === 0 && ['precip','snow'].includes(key) ? [] : records[key].years, trace: !!records[key].trace } : null;
    const departure = (o, n) => o.value != null && n.value != null ? { value: +(o.value - n.value).toFixed(4) } : null;
    const notYet = status === 'future' ? 'Pending: future date' : 'Pending: not reported yet';
    const dayValue = (col) => { if (!observed) return missing(notYet); const v = value(daily?.[col]); return v.value == null && !v.trace && (status === 'today' || pending) ? missing(notYet) : v; };
    const dayRow = (id, label, col, recKey, unit, decimals) => {
      const o = dayValue(col);
      const n = value(normal?.[col]);
      return { id, label, unit, decimals, observed: o, normal: n, departure: departure(o, n), record: record(recKey), lastYear: value(last?.[col]) };
    };
    const maxt = dayRow('maxt', 'Maximum', 1, 'highMax', '°F', 0), mint = dayRow('mint', 'Minimum', 2, 'lowMin', '°F', 0);
    const hiV = dayValue(1), loV = dayValue(2);
    const avg = !observed ? missing(notYet) : hiV.value != null && loV.value != null ? { value: (hiV.value + loV.value) / 2 } : missing(hiV.reason?.startsWith('Pending') || loV.reason?.startsWith('Pending') ? notYet : 'High or low missing'), navg = average(normal);
    const temp = [maxt, mint, { id: 'avgt', label: 'Average', unit: '°F', decimals: 1, observed: avg, normal: navg, departure: departure(avg, navg), record: null, lastYear: average(last) }];
    const month = date.slice(0, 8) + '01', season = A.metSeason(date), y = +date.slice(0, 4);
    const snowStart = `${+date.slice(5, 7) >= 7 ? y : y - 1}-07-01`;
    const short = d => new Date(d + 'T12:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    function totalRow(id, label, start, col, decimals) {
      /* observed totals run through the cutoff; normals and last year cover the same span, so departures compare like with like */
      const to = end && end >= start ? end : null;
      const span = to || date;
      const a = A.accumulate(observations, normals, start, span, col);
      const o = !observed ? missing(notYet) : !to ? missing(`Pending: no complete day since ${short(start)}`) : a.complete ? { value: a.total, trace: !!a.traceOnly } : missing(`${a.missing.length} of ${a.days} days missing`);
      const n = !a.normalMissing.length && a.normal != null ? { value: a.normal } : missing(`${a.normalMissing.length} days without normals`);
      const ps = previousYear(start), pe = previousYear(span);
      const p = ps && pe ? A.accumulate(observations, [], ps, pe, col) : null;
      const ly = p?.complete ? { value: p.total, trace: !!p.traceOnly } : missing(p ? `${p.missing.length} of ${p.days} days missing` : 'No matching calendar date last year');
      return { id, label, from: start, to: span, partial: !!to && to < date, unit: 'in', decimals, observed: o, normal: n, departure: departure(o, n), lastYear: ly, record: null };
    }
    const since = start => 'Since ' + new Date(start + 'T12:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    const precip = [dayRow('pcpn', 'Daily total', 3, 'precip', 'in', 2), totalRow('pcpn-mtd', 'Month to date', month, 3, 2), totalRow('pcpn-std', since(season.start), season.start, 3, 2), totalRow('pcpn-ytd', 'Since Jan 1', `${y}-01-01`, 3, 2)];
    const snow = [dayRow('snow', 'Daily total', 4, 'snow', 'in', 1), totalRow('snow-mtd', 'Month to date', month, 4, 1), totalRow('snow-std', since(season.start), season.start, 4, 1), totalRow('snow-season', since(snowStart), snowStart, 4, 1), { id: 'snwd', label: 'Snow depth', unit: 'in', decimals: 0, observed: dayValue(5), normal: null, departure: null, record: null, lastYear: value(last?.[5]) }];
    return { date, status, cutoff: end, previousDate: prior, season, observed, sections: [{ id: 'temperature', label: 'Temperature', unit: '°F', rows: temp }, { id: 'precipitation', label: 'Precipitation', unit: 'inches', rows: precip }, { id: 'snowfall', label: 'Snowfall', unit: 'inches', rows: snow }] };
  }
  const api = { previousYear, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimateReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
