'use strict';
const assert = require('node:assert/strict'), A = require('../assets/almanac-core.js'), R = require('../assets/climate-report.js');
let n = 0;
const eq = (a,b,m) => {assert.deepEqual(a,b,m);n++;};
const obs = [], normals = [];
for (const year of [2025,2026]) for (let d = `${year}-01-01`; d <= `${year}-11-03`; d=A.addDays(d,1)) {
  obs.push([d, year===2026?'78':'59', year===2026?'56':'35','0.10','0.0','0']);
  if(year===2026) normals.push([d,'59','39','0.20','0.1']);
}
const records={highMax:{value:81,years:[1946]},lowMin:{value:12,years:[1951]},precip:{value:2.26,years:[2011]},snow:{value:.5,years:[1966]}};
const report = R.build(A,{date:'2026-11-03',observations:obs,normals,records});
const row = id => report.sections.flatMap(s=>s.rows).find(r=>r.id===id);
eq(row('maxt').observed.value,78,'daily max uses report date');
eq(row('mint').observed.value,56,'daily min uses report date');
eq(row('maxt').normal.value,59,'normal is from the same date');
eq(row('maxt').departure.value,19,'daily departure');
eq(row('avgt').observed.value,67,'mean of high and low');
eq(row('avgt').normal.value,49,'mean normal');
eq(row('avgt').departure.value,18,'mean departure');
eq(row('maxt').lastYear.value,59,'same day last year');
eq(row('maxt').record.years,[1946],'record years retained');
eq(row('pcpn-mtd').observed.value,.3,'month total through report date');
eq(row('pcpn-mtd').lastYear.value,.3,'last year same elapsed dates');
eq(row('pcpn-mtd').normal.value,.6,'normal over same elapsed dates');
eq(row('pcpn-mtd').departure.value,-.3,'negative amount departure');
eq(row('pcpn-std').from,'2026-09-01','meteorological fall');
eq(row('snow-season').from,'2026-07-01','snowfall season starts July 1');
eq(row('snwd').normal,null,'snow depth normal not invented');
eq(row('avgt').record,null,'average-temperature record not inferred from separate extrema');
const gap=structuredClone(obs);gap.find(r=>r[0]==='2026-11-02')[3]='M';
const missing=R.build(A,{date:'2026-11-03',observations:gap,normals}).sections[1].rows[1];
eq(missing.observed.value,null,'missing day prevents period total');
eq(missing.departure,null,'missing total prevents departure');
eq(missing.normal.value,.6,'complete normal remains visible');
const ngap=structuredClone(normals);ngap.find(r=>r[0]==='2026-11-02')[3]='M';
eq(R.build(A,{date:'2026-11-03',observations:obs,normals:ngap}).sections[1].rows[1].departure,null,'missing normal prevents departure');
const trace=R.build(A,{date:'2026-11-03',observations:[['2026-11-03','M','56','T','T','M']],normals});
eq(trace.sections[1].rows[0].observed,{value:0,trace:true},'trace is retained');
eq(trace.sections[0].rows[2].observed.value,null,'missing high prevents mean');
eq(R.previousYear('2024-02-29'),null,'no invented Feb 29 in non-leap year');
eq(R.previousYear('2026-11-03'),'2025-11-03','calendar last-year mapping');
const winter=R.build(A,{date:'2026-01-02',observations:[],normals:[]});
eq(winter.sections[1].rows[2].from,'2025-12-01','winter crosses year boundary');
eq(winter.sections[2].rows[3].from,'2025-07-01','snow season crosses year boundary');
const future=R.build(A,{date:'2026-11-03',observations:obs,normals,observed:false});
eq(future.sections[0].rows[0].observed.value,null,'future reference does not invent observations');
eq(future.sections[1].rows[1].observed.value,null,'future reference cannot show a period total');
const accum=structuredClone(obs);accum.find(r=>r[0]==='2026-11-03')[3]='1.00A';
eq(R.build(A,{date:'2026-11-03',observations:accum,normals}).sections[1].rows[0].observed.value,null,'accumulated multi-day amount is not a daily value');

/* ---------- the selected date drives the sheet: past, today (in progress), future, boundaries ---------- */
{
  const series = [], norms = [];
  for (let d = '2025-01-01'; d <= '2026-03-05'; d = A.addDays(d, 1)) { series.push([d, '50', '30', '0.10', '0.0', '0']); norms.push([d, '45', '28', '0.12', '0.1']); }
  const r = (b) => (id) => b.sections.flatMap(x => x.rows).find(x => x.id === id);
  /* past date: that exact day, totals through it */
  const past = R.build(A, { date: '2026-03-04', observations: series, normals: norms, status: 'observed', cutoff: '2026-03-04' });
  eq([r(past)('maxt').observed.value, r(past)('pcpn-mtd').to, r(past)('pcpn-mtd').partial, r(past)('pcpn-mtd').observed.value], [50, '2026-03-04', false, 0.4], 'past date: its own observations; month total through that date');
  /* today in progress: today's values pending, totals labelled through yesterday with matching normals */
  const tod = series.filter(x => x[0] < '2026-03-05').concat([['2026-03-05', '52', 'M', 'M', 'M', 'M']]);
  const t = R.build(A, { date: '2026-03-05', observations: tod, normals: norms, status: 'today', cutoff: '2026-03-04' });
  eq([r(t)('maxt').observed.value, r(t)('mint').observed.reason, r(t)('avgt').observed.reason], [52, 'Pending: not reported yet', 'Pending: not reported yet'], "today: reported values shown, missing ones pending");
  eq([r(t)('pcpn-mtd').to, r(t)('pcpn-mtd').partial, r(t)('pcpn-mtd').observed.value, r(t)('pcpn-mtd').normal.value], ['2026-03-04', true, 0.4, 0.48], 'today: month total through yesterday, labelled partial, normal over the same days');
  eq(r(t)('maxt').normal.value, 45, "today: normals and records are today's");
  /* future: reference values; observations pending */
  const fut = R.build(A, { date: '2026-03-20', observations: series, normals: norms.concat([['2026-03-20', '55', '35', '0.13', '0.0']]), status: 'future' });
  eq([r(fut)('maxt').observed.reason, r(fut)('maxt').normal.value, r(fut)('pcpn-mtd').observed.reason, r(fut)('pcpn-mtd').to], ['Pending: future date', 55, 'Pending: future date', '2026-03-20'], 'future: normals shown, observations and totals pending');
  /* month / year boundary: Jan 1 today, cutoff Dec 31 - month and year totals have no complete day yet */
  const jan = R.build(A, { date: '2026-01-01', observations: series.filter(x => x[0] < '2026-01-01'), normals: norms, status: 'today', cutoff: '2025-12-31' });
  eq([r(jan)('pcpn-mtd').observed.reason, r(jan)('pcpn-ytd').observed.reason, r(jan)('pcpn-std').to, r(jan)('pcpn-std').partial], ['Pending: no complete day since Jan 1', 'Pending: no complete day since Jan 1', '2025-12-31', true], 'year boundary: Jan totals pending, winter season-to-date through Dec 31');
  /* past date whose newest day is not reported yet: totals stop at the last reported day and say so */
  const lag = R.build(A, { date: '2026-03-04', observations: series.filter(x => x[0] < '2026-03-04'), normals: norms, status: 'observed', cutoff: '2026-03-03', pending: true });
  eq([r(lag)('maxt').observed.reason, r(lag)('pcpn-mtd').to, r(lag)('pcpn-mtd').partial], ['Pending: not reported yet', '2026-03-03', true], 'recent day not in the feed yet: pending, totals through the last reported day');
  /* Feb 29: leap day uses its own normals; last year has no matching date */
  const leapObs = [], leapNorm = [];
  for (let d = '2027-02-01'; d <= '2028-03-01'; d = A.addDays(d, 1)) { leapObs.push([d, '40', '20', '0.05', '0.2', '1']); leapNorm.push([d, '41', '24', '0.10', '0.2']); }
  const leap = R.build(A, { date: '2028-02-29', observations: leapObs, normals: leapNorm, status: 'observed', cutoff: '2028-02-29' });
  eq([r(leap)('maxt').observed.value, leap.previousDate, r(leap)('maxt').lastYear.value, r(leap)('pcpn-mtd').to], [40, null, null, '2028-02-29'], 'Feb 29: its own day, no invented last-year date, month total through Feb 29');
}
console.log(`${n} climate-sheet checks pass`);
