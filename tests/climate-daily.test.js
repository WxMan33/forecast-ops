'use strict';
/* Almanac daily reporting: which NWS climate report describes which day, interim versus completed, corrections,
   ACIS lag and failed refreshes. Products are variants of a captured CVG report; values are synthetic. */
const A = require('../assets/almanac-core.js'), D = require('../assets/climate-daily.js');
const eq = require('node:assert/strict').deepEqual, ok = require('node:assert/strict').ok;
let n = 0; const test = (name, f) => { f(); n++; console.log('PASS ' + name); };
const base = require('./fixtures/almanac/nws-cli-cvg-20261110.json');
/* afternoon (interim) report for Nov 10, issued 5:05 PM EST */
const interim = (date = 'NOVEMBER 10 2026', at = '2026-11-10T22:05:00+00:00', id = 'p-interim') => ({ ...base, id, issuanceTime: at, productText: base.productText.replace('NOVEMBER 10 2026...', date + '...') });
/* the completed-day report for Nov 10, issued the next morning: no "valid as of" line, YESTERDAY rows */
const final = (high = '73', at = '2026-11-11T06:31:00+00:00', id = 'p-final', extra = (t) => t) => ({ ...base, id, issuanceTime: at,
  productText: extra(base.productText.replace('VALID TODAY AS OF 0500 PM LOCAL TIME.\n', '').replace(/\n TODAY\s*\n/, '\n YESTERDAY\n').replace(/\n  TODAY /g, '\n  YESTERDAY ').replace('MAXIMUM         72', 'MAXIMUM         ' + high).replace('505 PM EST TUE NOV 10 2026', '131 AM EST WED NOV 11 2026')) });
const corrected = () => final('74', '2026-11-11T11:45:00+00:00', 'p-cor', (t) => t.replace('CDUS41 KILN 102205', 'CDUS41 KILN 111145 CCA'));
const P = (p) => D.parse(p, 'CVG');
const normals = [['2026-11-10', '56', '37', '0.10', '0.0'], ['2026-11-11', '55', '37', '0.11', '0.0']];

test('an afternoon report is interim and keeps its own reporting time', () => { const r = P(interim()); eq([r.date, r.kind, r.asOf], ['2026-11-10', 'interim', '5:00 PM local standard time']); });
test('a report issued the next morning describes the previous day, not its issue date', () => { const r = P(final()); eq([r.date, r.kind, r.dayWord], ['2026-11-10', 'final', 'YESTERDAY']); ok(r.issuedAt.startsWith('2026-11-11')); });
test('the report\'s own normal and departure are read for each item', () => { const r = P(interim()); eq(r.normals.maxt, { normal: 56, departure: 16 }); eq(r.normals.pcpn, { normal: 0.1, departure: -0.1 }); });
test('a corrected report is recognised', () => { eq([P(corrected()).corrected, P(final()).corrected], [true, false]); });
test('another station\'s report is never used', () => { eq(D.parse({ ...base, productText: base.productText.replace('CLICVG', 'CLIIND') }, 'CVG'), null); });

test('morning: yesterday\'s completed NWS report, no report for today yet', () => {
  const v = D.view({ today: '2026-11-11', reports: [P(interim()), P(final())], station: 'CVG', acisRows: [], normalRows: normals, A });
  eq([v.y.date, v.y.source, v.y.kind, v.y.items.maxt.observed.value, v.y.items.maxt.departure, v.t], ['2026-11-10', 'nws', 'final', 73, 16, null]);
});
test('morning before the final report: yesterday shows the interim report, labelled as interim', () => {
  const v = D.view({ today: '2026-11-11', reports: [P(interim())], station: 'CVG', acisRows: [], normalRows: normals, A });
  eq([v.y.source, v.y.kind, v.y.report.asOf], ['nws', 'interim', '5:00 PM local standard time']);
  eq(D.forTotals([P(interim())], '2026-11-10', 'CVG'), null, 'an interim report never extends totals');
});
test('today\'s interim report arrives: shown separately, yesterday unchanged', () => {
  const today = P(interim('NOVEMBER 11 2026', '2026-11-11T22:05:00+00:00', 'p-today'));
  const v = D.view({ today: '2026-11-11', reports: [P(final()), today], station: 'CVG', acisRows: [], normalRows: normals, A });
  eq([v.y.items.maxt.observed.value, v.y.kind, v.t.date, v.t.kind], [73, 'final', '2026-11-11', 'interim']);
});
test('a correction replaces the report it corrects', () => {
  const v = D.view({ today: '2026-11-11', reports: [P(final()), P(corrected())], station: 'CVG', acisRows: [], normalRows: normals, A });
  eq([v.y.items.maxt.observed.value, v.y.report.corrected], [74, true]);
});
test('a completed day beats a later interim reissue for the same date', () => {
  const late = P(interim('NOVEMBER 10 2026', '2026-11-11T12:00:00+00:00', 'p-late'));
  eq(D.choose([P(final()), late], '2026-11-10', 'CVG').kind, 'final');
});
test('ACIS lag: the NWS report is used without waiting; ACIS used when NWS has nothing', () => {
  const acis = [['2026-11-10', '70', '38', '0.00', '0.0', '0']];
  eq(D.view({ today: '2026-11-11', reports: [P(final())], station: 'CVG', acisRows: [], normalRows: normals, A }).y.source, 'nws');
  const v = D.view({ today: '2026-11-11', reports: [], station: 'CVG', acisRows: acis, normalRows: normals, A });
  eq([v.y.source, v.y.items.maxt.observed.value, v.y.items.maxt.departure, v.y.items.maxt.normalFrom], ['acis', 70, 14, 'NCEI 1991–2020 (ACIS)']);
  eq(D.forTotals([P(final())], '2026-11-10', 'CVG').row[1], '73', 'a completed NWS day may fill a lagging ACIS day');
});
test('a complete ACIS day is preferred to an NWS interim report for yesterday', () => {
  const v = D.view({ today: '2026-11-11', reports: [P(interim())], station: 'CVG', acisRows: [['2026-11-10', '74', '39', '0.02', '0.0', '0']], normalRows: normals, A });
  eq([v.y.source, v.y.kind, v.y.items.maxt.observed.value], ['acis', 'final', 74]);
});
test('nothing reported: values are missing, never zero', () => {
  const v = D.view({ today: '2026-11-11', reports: [], station: 'CVG', acisRows: [['2026-11-10', 'M', 'M', 'M', 'M', 'M']], normalRows: normals, A });
  eq([v.y.items.pcpn.observed, v.y.items.pcpn.departure], [null, null]);
});
test('a trace is reported as a trace, with its departure from normal', () => {
  const r = P({ ...final(), productText: final().productText.replace(/(PRECIPITATION \(IN\)\s*\n\s*YESTERDAY\s+)0\.00/, '$1T   ') });
  const v = D.view({ today: '2026-11-11', reports: [r], station: 'CVG', normalRows: normals, A });
  eq([v.y.items.pcpn.observed, v.y.items.pcpn.normal], [{ value: 0, trace: true }, 0.1]);
});
test('failed refresh: the status keeps the last good reports and never reads "not reported yet"', () => {
  const t = (ms) => new Date(ms).toISOString().slice(11, 16);
  const line = D.checkLine({ at: Date.parse('2026-11-11T13:10Z'), error: 'HTTP 503', lastGoodAt: Date.parse('2026-11-11T13:00Z') }, t);
  ok(/Couldn't refresh/.test(line) && /13:00/.test(line) && !/not reported/i.test(line), line);
  ok(/checked at 13:10/.test(D.checkLine({ at: Date.parse('2026-11-11T13:10Z') }, t)));
});
test('time zones: "yesterday" is relative to the location\'s today that the caller passes', () => {
  const v = D.view({ today: '2026-11-12', reports: [P(final())], station: 'CVG', A });
  eq([v.yesterday, v.y.source], ['2026-11-11', null], 'Nov 10 report is not yesterday when it is already Nov 12 at the location');
});
test('completed report record comparison checks all four listed extremes', () => {
  const r = P(final()); eq(D.recordStatus(r).checked, 4); eq(D.recordStatus(r).events, []);
});
test('a new high and a tied low are detected with the proper comparison direction', () => {
  const r = P(final('90')); r.records.mint.observed.value = r.records.mint.record.value;
  const x = D.recordStatus(r); ok(x.events.some(t => /high record broken/.test(t))); ok(x.events.some(t => /low record tied/.test(t)));
});
test('missing records never produce a no-record claim', () => {
  eq(D.recordStatus(null).text, 'Record comparison unavailable.');
  const r = P(final()); r.records.pcpn = null; ok(/incomplete/.test(D.recordStatus(r).text));
});
test('dry and trace days do not claim a tied precipitation maximum', () => {
  const r = P(final()); r.records.snow = { observed: { value: 0 }, record: { value: 0 }, year: 2025 }; eq(D.recordStatus(r).events, []);
});
console.log(`ok - ${n} daily climate report checks passed`);
