'use strict';
/* Compare sources (assets/verify-compare.js compute), synthetic data only: matched cases across the selected sources,
   shared date range and exclusions; coverage with numerator and denominator; missed scheduled editions visible;
   targets kept distinct; edition, period and group filters. */
const A = require('node:assert/strict');
const V = require('../assets/verify-core.js'), C = require('../assets/verify-compare.js');
let n = 0; const t = (name, f) => { f(); n++; console.log('PASS ' + name); };
const caps = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'].map((d) => ({ captureId: `${d}_midday`, localDate: d, slot: 'midday', onTime: ['nws', 'gfs_seamless', 'blend:b1'], tv: { 'wkrc-7day': 'ok', 'wxix-extended-graphic': 'not-collected' } }));
caps.push({ captureId: '2026-11-05_evening', localDate: '2026-11-05', slot: 'evening', onTime: ['nws', 'gfs_seamless'], tv: {} });
caps[3].tv['wkrc-7day'] = 'not-collected'; // one capture where the TV product was not attempted
const targets = [{ id: 'tmax_clim', conv: 'climate-day-LST' }, { id: 'tmin_clim', conv: 'climate-day-LST' }, { id: 'tmin_night', conv: 'nws-night-12h' }];
const ids = ['nws', 'gfs_seamless', 'blend:b1', 'wkrc-7day'], tracks = { nws: 'source', gfs_seamless: 'source', 'blend:b1': 'blend', 'wkrc-7day': 'tv' };
const rows = [];
caps.forEach((c, ci) => { if (c.slot !== 'midday') { rows.push([0, ci, 0, 1, 20, 50, 49, 0], [1, ci, 0, 1, 20, 47, 49, 0]); return; }
  rows.push([0, ci, 0, 1, 20, 50 + (ci % 3), 50, 0]); // nws: errors 0,1,2,...
  if (ci !== 2) rows.push([1, ci, 0, 1, 20, 48, 50, 0]); // gfs missing for one capture
  rows.push([2, ci, 0, 1, 20, 51, 50, 0]);
  if (c.tv['wkrc-7day'] === 'ok' && ci !== 6) rows.push([3, ci, 0, 1, 18, 52, 50, 0]); // TV attempted but undelivered once (ci 6)
  rows.push([0, ci, 1, 1, 20, 30, 31, 0], [1, ci, 1, 1, 20, 29, 31, 0]); // climate-day low
  rows.push([0, ci, 2, 1, 20, 40, 42, 0], [3, ci, 2, 1, 18, 41, 42, 0]); // overnight low
});
rows.forEach((r) => { if (r[0] === 3) r[7] = 1; }); // TV products carry their extraction version, not the model normalizer's
const sc = { attempts: caps, targets, ids, tracks, norms: ['normalize-v4', 'tv:tv-extract-v3'], rows, minDates: 30, sourceLabels: {} };
const pairs = V.expandScorecard(sc);
const health = { slots: [...caps.filter((c) => c.slot === 'midday').map((c) => ({ id: c.captureId, status: 'on_time' })), { id: '2026-11-11_midday', status: 'missed' }, { id: '2026-11-04_evening', status: 'late' }, { id: '2026-11-09_evening', status: 'partial' }, { id: '2026-11-08_evening', status: 'mystery_state' }, { id: '2026-11-12_midday', status: 'pending' }] };
const base = { target: 'tmax_clim', lead: 1, slot: 'midday', period: 'all', groups: ['models', 'tv'], members: null };

t('expanded rows carry the verifying date (capture date + lead), edition and definition', () => {
  const p = pairs.find((x) => x.id === 'nws' && x.captureId === '2026-11-01_midday' && x.target === 'tmax_clim');
  A.equal(p.date, '2026-11-02'); A.equal(p.slot, 'midday'); A.equal(p.cls, 'primary'); A.equal(p.conv, 'climate-day-LST'); A.deepEqual(p.window, ['tmax_clim', '2026-11-02']);
});
t('default selection is the sources present in the most cases; each other source shows the matched cases it would leave', () => {
  const r = C.compute(sc, pairs, health, base);
  A.deepEqual(r.members.sort(), ['blend:b1', 'nws'], 'gfs (9 cases) and the TV product (8) are not in every case');
  const add = Object.fromEntries(r.adding.map((x) => [x.id, x.cases])); A.equal(add.gfs_seamless, 9); A.equal(add['wkrc-7day'], 8);
  A.equal(r.m.n, 10);
});
t('matched cases across the selected sources only: a case missing any selected source is excluded and counted', () => {
  const r = C.compute(sc, pairs, health, { ...base, members: ['nws', 'gfs_seamless', 'blend:b1', 'wkrc-7day'] });
  A.deepEqual(r.members.sort(), ['blend:b1', 'gfs_seamless', 'nws', 'wkrc-7day']);
  // 10 midday captures; gfs missing once (ci 2); TV missing at ci 3 (not attempted) and ci 6 (undelivered) -> 7 matched
  A.equal(r.m.n, 7); A.equal(r.m.dates, 7); A.equal(r.m.excluded.missingSource, 3);
  A.equal(r.m.onlyMissing['wkrc-7day'], 2); A.equal(r.m.onlyMissing.gfs_seamless, 1);
  A.equal(r.m.from, '2026-11-02'); A.equal(r.m.to, '2026-11-11');
  A.ok(r.m.scores.every((s) => s.n === 7), 'every source is scored on the same cases');
});
t('scores match a hand computation on the matched cases', () => {
  const r = C.compute(sc, pairs, health, { ...base, members: ['nws', 'gfs_seamless'] });
  A.equal(r.m.n, 9); const nws = r.m.scores.find((s) => s.id === 'nws');
  const errs = [0, 1, 3, 4, 5, 6, 7, 8, 9].map((ci) => ci % 3); // ci 2 excluded (gfs missing)
  A.equal(nws.mae, errs.reduce((a, b) => a + b, 0) / errs.length); A.equal(r.m.scores.find((s) => s.id === 'gfs_seamless').bias, -2);
});
t('coverage shows numerator and denominator; not attempted is counted, not dropped', () => {
  const r = C.compute(sc, pairs, health, { ...base, members: ['nws', 'gfs_seamless', 'wkrc-7day'] }), tv = r.cov['wkrc-7day'], g = r.cov.gfs_seamless;
  A.deepEqual(tv, { eligible: 10, attempted: 9, notAttempted: 1, delivered: 8 });
  A.deepEqual(g, { eligible: 10, attempted: 10, notAttempted: 0, delivered: 9 });
});
t('missed and late scheduled editions are visible, outside the coverage counts; pending is not counted', () => {
  const r = C.compute(sc, pairs, health, base);
  A.equal(r.sched.missed, 1); A.equal(r.sched.onTime, 10); A.equal(r.sched.late, 0, 'the late edition is evening, filtered by edition'); A.equal(r.sched.total, 11);
  const both = C.compute(sc, pairs, health, { ...base, slot: 'both' }); A.equal(both.sched.late, 1); A.equal(both.sched.total, 14);
  A.equal(both.sched.partial, 1, 'a partly captured edition is counted by name'); A.deepEqual(both.sched.others, { mystery_state: 1 }, 'an unknown status is listed by its own name');
});
t('targets stay distinct: climate-day low and the following overnight low never mix; TV has no climate-day low', () => {
  const lo = C.compute(sc, pairs, health, { ...base, target: 'tmin_clim' }), night = C.compute(sc, pairs, health, { ...base, target: 'tmin_night', members: ['nws', 'wkrc-7day'] });
  A.deepEqual(lo.available.sort(), ['gfs_seamless', 'nws']); A.deepEqual(night.available.sort(), ['nws', 'wkrc-7day']);
  A.equal(lo.m.scores.find((s) => s.id === 'nws').bias, -1); A.equal(night.m.scores.find((s) => s.id === 'nws').bias, -2);
});
t('edition, period and group filters', () => {
  const ev = C.compute(sc, pairs, health, { ...base, slot: 'evening' }); A.deepEqual(ev.available.sort(), ['gfs_seamless', 'nws']); A.equal(ev.m.n, 1);
  const wk = C.compute(sc, pairs, health, { ...base, period: 'week', members: ['nws', 'blend:b1'] }); A.equal(wk.period.start, '2026-11-05'); A.equal(wk.period.end, '2026-11-11'); A.equal(wk.m.n, 7); A.equal(wk.m.from, '2026-11-05');
  const noTv = C.compute(sc, pairs, health, { ...base, groups: ['models'], members: ['nws', 'gfs_seamless', 'blend:b1', 'wkrc-7day'] }); A.ok(!noTv.available.includes('wkrc-7day')); A.deepEqual(noTv.members.sort(), ['blend:b1', 'gfs_seamless', 'nws']); A.equal(noTv.m.n, 9);
  const tvOnly = C.compute(sc, pairs, health, { ...base, groups: ['tv'] }); A.deepEqual(tvOnly.members, ['wkrc-7day']); A.equal(tvOnly.m.n, 0); A.match(tvOnly.m.reason, /at least two/);
});
t('one method per kind: TV products match models; mixed TV extraction or model normalizer versions are excluded', () => {
  const tvVsModel = V.matched(pairs, { members: ['nws', 'wkrc-7day'], target: 'tmin_night', lead: 1, slot: 'midday' }); A.equal(tvVsModel.n, 10); A.equal(tvVsModel.excluded.methodMismatch, 0);
  const mk = (id, track, nv, v) => ({ track, id, captureId: 'c1', target: 'tmax_clim', date: '2026-11-02', lead: 1, slot: 'midday', cls: 'primary', conv: 'climate-day-LST', window: ['tmax_clim', '2026-11-02'], v, o: 50, normVersion: nv });
  const twoTv = V.matched([mk('a', 'tv', 'tv:tv-extract-v2', 51), mk('b', 'tv', 'tv:tv-extract-v3', 52)], { members: ['a', 'b'] });
  A.equal(twoTv.n, 0); A.equal(twoTv.excluded.methodMismatch, 1);
  const twoNorm = V.matched([mk('a', 'source', 'normalize-v3', 51), mk('b', 'source', 'normalize-v4', 52)], { members: ['a', 'b'] });
  A.equal(twoNorm.n, 0); A.equal(twoNorm.excluded.methodMismatch, 1, 'the single-normalizer rule for models is unchanged');
  const ok = V.matched([mk('a', 'source', 'normalize-v4', 51), mk('t', 'tv', 'tv:tv-extract-v3', 52)], { members: ['a', 't'] }); A.equal(ok.n, 1);
});
t('hourly cases share the valid UTC hour and calendar lead even with different retrieval offsets', () => {
  const hour = Date.parse('2026-11-03T01:00:00Z') / 3600e3;
  const h = {
    ...sc, targets: [{ id: 'temp_hourly', conv: 'valid-instant' }],
    rows: [[0, 1, 0, 0, 8, 51, 50, 0, hour], [1, 1, 0, 0, 7.9, 48, 50, 0, hour],
           [0, 1, 0, 0, 9, 70, 51, 0, hour + 1], [1, 1, 0, 1, 9.9, 80, 52, 0, hour + 2]],
  };
  const r = C.compute(h, V.expandScorecard(h), health, { ...base, target: 'temp_hourly', lead: 0, members: ['nws', 'gfs_seamless'] });
  A.equal(r.m.n, 1); A.equal(r.m.hours, 1); A.equal(r.m.from, '2026-11-02');
  A.equal(r.m.excluded.missingSource, 1); A.deepEqual(r.m.scores.map(s => s.bias), [1, -2]);
  A.equal(V.matched(V.expandScorecard(h), { members: ['nws', 'gfs_seamless'] }).n, 1);
});
t('failed requests count as attempts, on-time retries count once, and late recovery stays outside coverage', () => {
  const attempts = [
    { ...caps[0], edition: caps[0].captureId, eligible: true, sources: ['nws', 'gfs_seamless'] },
    { ...caps[0], captureId: caps[0].captureId + '_a2', edition: caps[0].captureId, eligible: true, sources: ['gfs_seamless'] },
    { ...caps[1], edition: caps[1].captureId, eligible: true, sources: ['nws'] },
    { ...caps[1], captureId: caps[1].captureId + '_a2', edition: caps[1].captureId, eligible: false, sources: ['gfs_seamless'] },
  ];
  A.deepEqual(V.coverage(attempts, [], { id: 'gfs_seamless', target: 'tmax_clim', lead: 1, track: 'source', verifiedDates: ['2026-11-02', '2026-11-03'] }),
    { eligible: 2, attempted: 1, notAttempted: 1, delivered: 0 });
});
t('collector projection retains an old capture, its real TV extraction version, and hourly valid times', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const U = require('../verify/lib/util'), D = require('../verify/lib/dashboard');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-scorecard-'));
  try {
    const captures = Array.from({ length: 42 }, (_, i) => {
      const localDate = U.addDays('2026-10-01', i), slotTarget = localDate + 'T17:00:00Z';
      return { localDate, captureId: localDate + '_midday', slot: 'midday', trigger: 'scheduled', slotTarget, startedAt: slotTarget, sources: { nws: { status: 'ok' } } };
    });
    U.appendJSONL(path.join(dir, 'captures', 'CVG.jsonl'), captures);
    const { captureId } = captures[0];
    const tv = [{ captureId, product: 'wcpo-9day-graphic', extraction: { version: 'graphic-fixture-v2' } }];
    const daily = [{ captureId, cls: 'primary', track: 'tv', id: tv[0].product, target: 'tmin_night', date: '2026-10-02', lead: 1, v: 35, o: 36 }];
    const hourly = [{ captureId, cls: 'primary', valid: '2026-10-02T01:00:00Z', id: 'nws', v: 50, o: 49, normVersion: 'normalize-v4' }];
    D.writeDashboard(dir, { id: 'CVG', lstOffsetMin: -300 }, { pairs: daily, hourlyPairs: hourly, tv }, Date.parse('2026-11-15T12:00:00Z'));
    const out = U.readJSON(path.join(dir, 'reports/dashboard/scorecard.json'));
    const [night, hour] = V.expandScorecard(out);
    A.equal(out.attempts.length, 42); A.equal(out.droppedInconsistent, 0);
    A.equal(night.normVersion, 'tv:graphic-fixture-v2'); A.equal(night.date, '2026-10-02');
    A.equal(hour.date, '2026-10-01'); A.equal(hour.valid, '2026-10-02T01:00:00.000Z');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
console.log(`ok - ${n} compare-sources checks passed`);
