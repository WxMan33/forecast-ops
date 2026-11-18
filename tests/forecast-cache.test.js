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
globalThis.fetch = async (url) => { calls.push(url); const a = answer(url); await new Promise((r) => setTimeout(r, 20)); return new Response(JSON.stringify(a.body), { status: a.status, headers: a.headers || {} }); };
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
/* ---------- the provider's Retry-After, for the exact request it answered ---------- */
const limited = (ra) => ({ status: 429, headers: ra == null ? {} : { 'Retry-After': String(ra) }, body: { error: true, reason: 'Minutely API request limit exceeded. Please try again in one minute.' } });
test('after a 429 with Retry-After, the same request is not sent again until the wait has passed', async () => {
  const D = setup(); answer = () => limited(60); const t0 = Date.now, start = t0();
  const a = await D.getJSON(U('gfs_seamless')); A.equal(a.httpStatus, 429); A.equal(a.retryAfter, 60); A.equal(calls.length, 1);
  Date.now = () => start + 20e3; answer = () => ({ status: 200, body: { hourly: { time: ['2026-11-11T00:00'], temperature_2m: [52] } } });
  try {
    const b = await D.getJSON(U('gfs_seamless'));
    A.equal(calls.length, 1, 'not sent during the wait'); A.equal(b.error, true); A.equal(b.httpStatus, 429); A.equal(b.__notSent, true);
    A.ok(b.retryAfter > 0 && b.retryAfter <= 41, `seconds still to wait (${b.retryAfter})`); A.equal(b.__retrievedAt, a.__retrievedAt, 'the original retrieval time of the 429');
    A.equal(b.reason, a.reason, "the provider's own reason is kept");
    Date.now = () => start + 61e3;
    const c = await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 2, 'sent again once the wait has passed'); A.equal(c.hourly.temperature_2m[0], 52); A.equal(c.__notSent, undefined);
  } finally { Date.now = t0; }
});
test('the wait applies to the exact request only: another model, location or window is still sent', async () => {
  const D = setup(); answer = () => limited(120); await D.getJSON(U('gfs_seamless'));
  answer = () => ({ status: 200, body: { hourly: { time: ['2026-11-11T00:00'], temperature_2m: [50] } } });
  await D.getJSON(U('ecmwf_ifs025')); await D.getJSON(U('gfs_seamless').replace('39.1', '39.2')); await D.getJSON(U('gfs_seamless') + '&forecast_days=5');
  A.equal(calls.length, 4); const again = await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 4); A.equal(again.__notSent, true);
});
test('without a readable Retry-After nothing is waited for; a 503 with Retry-After is honoured; other failures are not', async () => {
  let D = setup(); answer = () => limited(null); await D.getJSON(U('gfs_seamless')); await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 2, 'no invented wait');
  D = setup(); answer = () => ({ status: 503, headers: { 'Retry-After': '30' }, body: { error: true, reason: 'busy' } }); await D.getJSON(U('gfs_seamless')); const b = await D.getJSON(U('gfs_seamless'));
  A.equal(calls.length, 1); A.equal(b.httpStatus, 503); A.equal(b.__notSent, true);
  D = setup(); answer = () => ({ status: 400, headers: { 'Retry-After': '30' }, body: { error: true, reason: 'bad variable' } }); await D.getJSON(U('gfs_seamless')); await D.getJSON(U('gfs_seamless'));
  A.equal(calls.length, 2, 'a 400 is not a wait');
});
test('a remembered wait never displaces or counts as a forecast cache entry, and the failure itself is never cached', async () => {
  const D = setup(); answer = () => limited(60); await D.getJSON(U('gfs_seamless'));
  const keys = globalThis.sessionStorage.keys(); A.ok(keys.some((k) => k.startsWith('ops_w:GET https://api.open-meteo.com/')) && !keys.some((k) => k.startsWith('ops_c:')), 'only the wait is stored, under its own prefix, keyed by method and exact URL');
});
test('a request that opts out of caching is still held back by its remembered wait, and still never cached', async () => {
  const D = setup(); answer = () => limited(60); await D.getJSON(U('gfs_seamless'), 0); const b = await D.getJSON(U('gfs_seamless'), 0);
  A.equal(calls.length, 1); A.equal(b.__notSent, true); A.ok(!globalThis.sessionStorage.keys().some((k) => k.startsWith('ops_c:')));
});
test('Retry-After as an HTTP date is honoured; missing, invalid, negative or absurd values mean no wait', async () => {
  const t0 = Date.now, start = t0(); Date.now = () => start;
  try {
    let D = setup(); answer = () => limited(new Date(start + 90e3).toUTCString()); const a = await D.getJSON(U('gfs_seamless'));
    A.ok(a.retryAfter >= 89 && a.retryAfter <= 90, `HTTP date read as seconds (${a.retryAfter})`); const b = await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 1); A.equal(b.__notSent, true);
    for (const bad of ['soon', '-5', '1e9', '', 'Tue, 99 Foo 2026']) { D = setup(); answer = () => limited(bad); await D.getJSON(U('gfs_seamless')); await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 2, `no wait for Retry-After "${bad}"`); }
  } finally { Date.now = t0; }
});
test('a reload of the tab (a new page, same session storage) cannot send the request early; afterwards it recovers', async () => {
  const D = setup(); answer = () => limited(60); const t0 = Date.now; const a = await D.getJSON(U('gfs_seamless'));
  const got = Date.parse(a.__retrievedAt), reloaded = fresh(); Date.now = () => got + 30e3;
  try { const b = await reloaded.getJSON(U('gfs_seamless')); A.equal(calls.length, 1); A.equal(b.__retrievedAt, a.__retrievedAt); A.ok(b.retryAfter <= 31 && b.retryAfter >= 29, `remaining ${b.retryAfter}`);
    Date.now = () => got + 60e3; answer = () => ({ status: 200, body: { hourly: { time: ['2026-11-11T00:00'], temperature_2m: [53] } } });
    const c = await reloaded.getJSON(U('gfs_seamless')); A.equal(calls.length, 2); A.equal(c.hourly.temperature_2m[0], 53);
    A.ok(!globalThis.sessionStorage.keys().some((k) => k.startsWith('ops_w:')), 'the expired wait is removed');
  } finally { Date.now = t0; }
});
test("an automatic retry timed from the failure's own Retry-After is never early", async () => {
  /* Event Manager retries after max(20 s, retryAfter) from when its load returned; the wait ends retryAfter after the 429 arrived */
  const D = setup(); answer = () => limited(45); const t0 = Date.now; const a = await D.getJSON(U('gfs_seamless'));
  const retryAt = Date.parse(a.__retrievedAt) + Math.max(20, a.retryAfter) * 1e3; Date.now = () => retryAt; // timed from when the load returned, as Event Manager does
  answer = () => ({ status: 200, body: { hourly: { time: ['2026-11-11T00:00'], temperature_2m: [54] } } });
  try { const b = await D.getJSON(U('gfs_seamless')); A.equal(calls.length, 2, 'the retry is sent'); A.equal(b.hourly.temperature_2m[0], 54); } finally { Date.now = t0; }
  const E = setup(); answer = () => limited(45); const e1 = await E.getJSON(U('gfs_seamless')); const s2 = Date.parse(e1.__retrievedAt); Date.now = () => s2 + 20e3;
  try { const early = await E.getJSON(U('gfs_seamless')); A.equal(calls.length, 1, 'a retry at 20 s, inside a 45 s wait, is not sent'); A.equal(early.__notSent, true); A.ok(early.retryAfter >= 24 && early.retryAfter <= 26); } finally { Date.now = t0; }
});
test('Open-Meteo hosts share six slots through response-body reads, including shared queued calls', async () => {
  const D = setup(), previousFetch = globalThis.fetch;
  const started = [], bodies = new Map();
  const forecast = Array.from({ length: 6 }, (_, i) => U('bounded-' + i));
  const ensemble = 'https://ensemble-api.open-meteo.com/v1/ensemble?models=gfs025';
  const meta = 'https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json';
  const nws = 'https://api.weather.gov/points/39.1,-84.5';
  globalThis.fetch = async (url) => {
    started.push(url);
    return { ok: true, status: 200, json: () => new Promise((resolve, reject) => bodies.set(url, { resolve, reject })) };
  };
  const drain = () => new Promise(resolve => setImmediate(resolve));
  try {
    const group = forecast.map(url => D.getJSON(url));
    const one = D.getJSON(ensemble), two = D.getJSON(ensemble), third = D.getJSON(meta), independent = D.getJSON(nws);
    await drain();
    A.deepEqual(started.filter(url => url !== nws), forecast);
    A.ok(started.includes(nws), 'NWS does not wait for a model slot');
    bodies.get(nws).resolve({ ok: true }); await independent;
    bodies.get(forecast[0]).reject(new Error('invalid JSON'));
    await drain();
    A.equal(started.at(-1), ensemble);
    A.ok(!started.includes(meta));
    bodies.get(forecast[1]).resolve({ ok: true }); await drain();
    A.equal(started.at(-1), meta);
    for (const url of [...forecast.slice(2), ensemble, meta]) bodies.get(url).resolve({ ok: true });
    const [a, b] = await Promise.all([one, two]);
    A.notEqual(a, b); A.equal(started.filter(url => url === ensemble).length, 1);
    A.equal((await Promise.all(group))[0].error, true); await third;
  } finally { globalThis.fetch = previousFetch; }
});
test('queued work expires without a provider request and active aborts release slots', async () => {
  const D = setup(), previousFetch = globalThis.fetch, previousTimer = globalThis.setTimeout;
  const started = [], expire = [];
  globalThis.setTimeout = (callback, ms) => {
    if (ms !== 20000) return previousTimer(callback, ms);
    expire.push(callback);
    return null;
  };
  globalThis.fetch = (url, { signal }) => new Promise((resolve, reject) => {
    started.push(url);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    if (url.endsWith('recovery')) resolve(new Response('{}'));
  });
  try {
    const requests = Array.from({ length: 7 }, (_, i) => D.getJSON(U('timeout-' + i)));
    const all = Promise.allSettled(requests);
    await new Promise(resolve => setImmediate(resolve));
    expire[6]();
    expire.slice(0, 6).forEach(abort => abort());
    const result = await all;
    A.equal(started.length, 6);
    A.match(result[6].reason.message, /waiting for an Open-Meteo request slot/);
    A.ok(result.every(r => r.status === 'rejected' && r.reason.timeout));
    A.equal((await D.getJSON(U('recovery'))).error, undefined);
  } finally { globalThis.fetch = previousFetch; globalThis.setTimeout = previousTimer; }
});
test('queued uncached requests check for Retry-After again before sending', async () => {
  const D = setup(), previousFetch = globalThis.fetch, finishes = [];
  globalThis.fetch = () => new Promise(resolve => finishes.push(resolve));
  try {
    const url = U('queue-wait');
    const active = Array.from({ length: 6 }, (_, i) => D.getJSON(i ? U('occupy-' + i) : url, 0));
    const queued = D.getJSON(url, 0);
    await new Promise(resolve => setImmediate(resolve));
    A.equal(finishes.length, 6);
    finishes[0](new Response('{"error":true}', { status: 429, headers: { 'Retry-After': '30' } }));
    await new Promise(resolve => setImmediate(resolve));
    if (finishes[6]) finishes[6](new Response('{}'));
    for (const finish of finishes.slice(1, 6)) finish(new Response('{}'));
    const first = (await Promise.all(active))[0], later = await queued;
    A.equal(finishes.length, 6);
    A.equal(later.__notSent, true); A.equal(later.__retrievedAt, first.__retrievedAt);
  } finally { globalThis.fetch = previousFetch; }
});
(async () => {
  for (const [name, f] of tests) { try { await f(); n++; console.log('PASS ' + name); } catch (e) { console.log("FAIL " + name + " — " + String(e.message || e).replace(/\n+/g, " ").slice(0, 300)); process.exitCode = 1; } }
  console.log(process.exitCode ? 'forecast cache checks failed' : `ok - ${n} forecast cache checks passed`);
})();
