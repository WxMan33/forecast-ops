'use strict';
/* Blended wind direction (OpsCore.blend.windDirection) and the hourly wind cell (HourlyViews): vector combination at the
   blend weights, never a plain average of angles; missing direction is never north; calm and cancelled winds labelled. */
const A = require('node:assert/strict');
const C = require('../assets/ops-core.js'), B = C.blend;
globalThis.window = globalThis; require('../assets/hourly-views.js'); const V = globalThis.HourlyViews;
let n = 0; const t = (name, f) => { f(); n++; console.log('PASS ' + name); };
const det = (s, d) => ({ kind: 'det', h: { wind_speed_10m: s, wind_direction_10m: d } }), one = () => 1;
t('350° and 10° combine to north, not south', () => { A.equal(Math.round(B.windDirection({ models: { a: det([10], [350]), b: det([10], [10]) } }, ['a', 'b'], one, [0]).deg) % 360, 0); });
t('blend weights apply: a 3:1 weight pulls toward the heavier source', () => {
  const r = B.windDirection({ models: { a: det([10], [270]), b: det([10], [0]) } }, ['a', 'b'], (id) => (id === 'a' ? 3 : 1), [0]);
  A.ok(r.deg > 270 && r.deg < 315, `${r.deg}`); });
t('a stronger wind counts more than a light one', () => { const r = B.windDirection({ models: { a: det([20], [270]), b: det([2], [0]) } }, ['a', 'b'], one, [0]); A.ok(r.deg > 270 && r.deg < 290, `${r.deg}`); });
t('a source without direction is skipped; with no direction anywhere the result is none, never north', () => {
  A.equal(Math.round(B.windDirection({ models: { a: det([10], [null]), b: det([10], [90]) } }, ['a', 'b'], one, [0]).deg), 90);
  const none = B.windDirection({ models: { a: det([10], [null]) } }, ['a'], one, [0]); A.equal(none.deg, null); A.equal(none.calm, false); });
t('zero-weight sources do not count', () => { A.equal(Math.round(B.windDirection({ models: { a: det([10], [180]), b: det([10], [0]) } }, ['a', 'b'], (id) => (id === 'a' ? 0 : 1), [0]).deg), 0); });
t('all calm reads calm; exactly opposing winds read variable', () => {
  A.equal(B.windDirection({ models: { a: det([0], [90]) } }, ['a'], one, [0]).calm, true);
  const e = { kind: 'ens', members: [{ h: { wind_speed_10m: [10], wind_direction_10m: [270] } }, { h: { wind_speed_10m: [10], wind_direction_10m: [90] } }] };
  const r = B.windDirection({ models: { e } }, ['e'], one, [0]); A.equal(r.deg, null); A.equal(r.variable, true); });
t('the wind row: "NW 12", speed alone when direction is missing, Calm, VRB; mph in the label; gusts separate', () => {
  const hrs = [{ ms: 0, state: 'ok', wind: 12.4, windDir: 315 }, { ms: 1, state: 'ok', wind: 7, windDir: null }, { ms: 2, state: 'ok', wind: 0, windCalm: true }, { ms: 3, state: 'ok', wind: 5, windVariable: true }, { ms: 4, state: 'ok', wind: 9, windDir: 359 }, { ms: 5, state: 'missing' }];
  const rows = V.valueRows(hrs, null), w = rows.find((r) => r.key === 'wind'), g = rows.find((r) => r.key === 'gust');
  A.deepEqual(w.cells.map((c) => c.text), ['NW 12', '7', 'Calm', 'VRB 5', 'N 9', '—']);
  A.equal(w.cells[1].wind.dir, null); A.match(w.cells[1].why, /Direction not in the guidance/);
  A.match(w.sub, /mph/); A.ok(g && g.label === 'Gusts');
});
console.log(`ok - ${n} wind direction checks passed`);
