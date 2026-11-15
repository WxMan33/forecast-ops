'use strict';
/* The shared forecast cache (OpsData.getJSON): exact keys, original retrieval times, bounded expiry, room made only from
   forecast entries when browser storage is full, one request for identical requests in flight, failures never cached. */
const A = require('node:assert/strict');
let n = 0; const tests = []; const test = (name, f) => tests.push([name, f]);
/* a sessionStorage with a size limit, like a browser's */
function storage(limit = 1e9) {
  const m = new Map(); const size = () => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { const old = m.get(k); m.set(k, String(v)); if (size() > limit) { if (old == null) m.delete(k); else m.set(k, old); const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } },
    removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, keys: () => [...m.keys()], _m: m };
}
const fresh = () => { delete require.cache[require.resolve('../assets/ops-data.js')]; return require('../assets/ops-data.js'); };
const U = (q) => `https://api.open-meteo.com/v1/forecast?latitude=39.1&longitude=-84.5&hourly=temperature_2m&models=${q}`;
let calls = [], answer = () => ({ status: 200, body: { hourly: { time: ['2026-11-11T00:00'], temperature_2m: [50] } } });
globalThis.fetch = async (url) => { calls.push(url); const a = answer(url); await new Promise((r) => setTimeout(r, 20)); return new Response(JSON.stringify(a.body), { status: a.status }); };
const setup = (limit) => { calls = []; answer = () => ({ status: 200, body: { hourly: { time: ['2026-11-11T00:00'], temperature_2m: [50] } } }); globalThis.sessionStorage = storage(limit); return fresh(); };

test('an identical request within the expiry is answered from the cache, with its original retrieval time', async () => {
  const D = setup(); const a = await D.getJSON(U('gfs_seamless')); const t0 = Date.now;
  Date.now = () => t0() + 5 * 60e3;
  try { const b = await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 1); A.equal(b.__fromCache, true); A.equal(b.__retrievedAt, a.__retrievedAt); } finally { Date.now = t0; }
});
test('keys are exact: another model, location or window is its own request', async () => {
  const D = setup(); await D.getJSON(U('gfs_seamless')); await D.getJSON(U('ecmwf_ifs025')); await D.getJSON(U('gfs_seamless').replace('39.1', '39.2')); await D.getJSON(U('gfs_seamless') + '&forecast_days=5');
  A.equal(calls.length, 4);
});
test('after expiry the provider is asked again and the expired copy is removed', async () => {
  const D = setup(); await D.getJSON(U('gfs_seamless')); const t0 = Date.now;
  Date.now = () => t0() + 16 * 60e3;
  try { const b = await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 2); A.equal(b.__fromCache, false); } finally { Date.now = t0; }
});
test('a failed refresh after expiry is a failure, never the old copy presented as current, and is not cached', async () => {
  const D = setup(); await D.getJSON(U('gfs_seamless')); const t0 = Date.now;
  Date.now = () => t0() + 16 * 60e3; answer = () => ({ status: 503, body: { error: true, reason: 'down' } });
  try {
    const b = await D.getJSON(U('gfs_seamless')); A.equal(b.error, true); A.equal(b.httpStatus, 503);
    answer = () => ({ status: 200, body: { hourly: { time: ['2026-11-11T00:00'], temperature_2m: [51] } } });
    const c = await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 3, 'the failure was not cached'); A.equal(c.hourly.temperature_2m[0], 51, 'recovered with the new answer');
  } finally { Date.now = t0; }
});
test('identical requests in flight share one provider request; each caller gets its own copy', async () => {
  const D = setup(); const [a, b] = await Promise.all([D.getJSON(U('gfs_seamless')), D.getJSON(U('gfs_seamless'))]);
  A.equal(calls.length, 1); A.notEqual(a, b); a.hourly.temperature_2m[0] = 99; A.equal(b.hourly.temperature_2m[0], 50); A.equal(a.__retrievedAt, b.__retrievedAt);
});
test('a failure in flight reaches every caller and is not cached', async () => {
  const D = setup(); answer = () => ({ status: 429, body: { error: true, reason: 'limit' } });
  const [a, b] = await Promise.all([D.getJSON(U('gfs_seamless')), D.getJSON(U('gfs_seamless'))]);
  A.equal(calls.length, 1); A.equal(a.httpStatus, 429); A.equal(b.httpStatus, 429);
  answer = () => ({ status: 200, body: { hourly: { time: ['t'], temperature_2m: [52] } } }); await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 2);
});
test('missing values stay missing through the cache', async () => {
  const D = setup(); answer = () => ({ status: 200, body: { hourly: { time: ['a', 'b'], temperature_2m: [null, 50] } } });
  await D.getJSON(U('gfs_seamless')); const b = await D.getJSON(U('gfs_seamless')); A.deepEqual(b.hourly.temperature_2m, [null, 50]);
});
test('when storage is full, expired forecast entries make room first; other saved data is never removed', async () => {
  const D = setup(6000); const s = globalThis.sessionStorage, t0 = Date.now;
  s.setItem('beta_events_v2', 'x'.repeat(500)); // the planner's own data
  answer = () => ({ status: 200, body: { pad: 'y'.repeat(900) } });
  for (let i = 0; i < 4; i++) await D.getJSON(U('m' + i));
  Date.now = () => t0() + 20 * 60e3; // those four are now expired
  try {
    for (let i = 4; i < 8; i++) await D.getJSON(U('m' + i));
    const keys = s.keys(); A.ok(keys.includes('beta_events_v2')); A.ok([4, 5, 6, 7].every((i) => keys.some((k) => k.endsWith('models=m' + i))), 'the new answers were stored');
    A.ok(![0, 1, 2, 3].every((i) => keys.some((k) => k.endsWith('models=m' + i))), 'expired entries were removed to make room');
  } finally { Date.now = t0; }
});
test('when storage is full of current entries, the oldest forecast entries give way', async () => {
  const D = setup(6000); const s = globalThis.sessionStorage;
  answer = () => ({ status: 200, body: { pad: 'y'.repeat(900) } });
  for (let i = 0; i < 9; i++) await D.getJSON(U('m' + i));
  const keys = s.keys(); A.ok(keys.some((k) => k.endsWith('models=m8')), 'the newest answer was stored'); A.ok(!keys.some((k) => k.endsWith('models=m0')), 'the oldest gave way');
});
test('a request that opts out of caching is never cached or shared', async () => {
  const D = setup(); await Promise.all([D.getJSON(U('gfs_seamless'), 0), D.getJSON(U('gfs_seamless'), 0)]); A.equal(calls.length, 2);
});
(async () => {
  for (const [name, f] of tests) { try { await f(); n++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ' — ' + String(e.message || e).split('\n')[0]); process.exitCode = 1; } }
  console.log(process.exitCode ? 'forecast cache checks failed' : `ok - ${n} forecast cache checks passed`);
})();
