'use strict';
/* Missing, failed and partial sources: the loader's account of what was used and why something is missing.
   Every response is synthetic; fetch is replaced for the duration of each test. */
const A = require('node:assert/strict');
const Data = require('../assets/ops-data.js'), Core = require('../assets/ops-core.js');
const { snapshot } = require('../assets/event-briefing-history.js');
const BUI = require('../assets/event-briefing-ui.js');
const sim = require('./fixtures/source-sim.js');
let n = 0;
const tests = [];
const test = (name, f) => tests.push([name, f]);
const NOW = Date.parse('2026-11-11T20:30:00Z'), H = 3600e3;
const spec = { id: 'blend', base: 'https://api.open-meteo.com/v1/forecast', params: { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' }, days: 2, require: ['temperature_2m'],
  models: [{ id: 'gfs_seamless', name: 'GFS' }, { id: 'ecmwf_ifs025', name: 'ECMWF IFS' }, { id: 'gfs_hrrr', name: 'HRRR (48 h)' }], hourly: ['temperature_2m', 'precipitation_probability'], daily: [] };
const where = { lat: sim.VENUES.cmh.lat, lon: sim.VENUES.cmh.lon };
/* rules per model: {status, retryAfter, abort, body, hoursAvailable, nullFrom} */
function withFetch(rules, f) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url), r = rules[u.searchParams.get('models')] || rules['*'] || {};
    if (r.abort) { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; }
    if (r.status) return new Response(r.body ?? JSON.stringify({ error: true, reason: 'Synthetic failure' }), { status: r.status, headers: r.retryAfter != null ? { 'Retry-After': String(r.retryAfter) } : {} });
    return new Response(JSON.stringify(sim.forecast(u, r)), { status: 200 });
  };
  return Promise.resolve(f()).finally(() => { globalThis.fetch = prev; });
}

test('one rate-limited model is named with its HTTP status; the others load', () => withFetch({ gfs_seamless: { status: 429 } }, async () => {
  const B = await Data.loadModels(spec, where);
  A.equal(B.status.gfs_seamless, 'failed'); A.equal(B.status.ecmwf_ifs025, 'ok'); A.ok(B.models.ecmwf_ifs025 && !B.models.gfs_seamless);
  A.ok(B.problems.includes('GFS: request failed (HTTP 429)'), B.problems.join('; '));
}));
test('an HTTP 500 with a non-JSON body is recorded as HTTP 500, not as a missing variable', () => withFetch({ ecmwf_ifs025: { status: 500, body: '<html>oops</html>' } }, async () => {
  const B = await Data.loadModels(spec, where);
  A.ok(B.problems.includes('ECMWF IFS: request failed (HTTP 500)'), B.problems.join('; '));
}));
test('a timeout is recorded as a timeout', () => withFetch({ gfs_hrrr: { abort: true } }, async () => {
  const B = await Data.loadModels(spec, where);
  A.ok(B.problems.includes('HRRR (48 h): request failed (timed out)'), B.problems.join('; '));
}));
test('Retry-After in seconds is kept per model and for an all-failed load', () => withFetch({ '*': { status: 429, retryAfter: 45 } }, async () => {
  const B = await Data.loadModels(spec, where);
  A.equal(B.empty, true); A.equal(B.failures.gfs_seamless.retryAfter, 45); A.equal(B.retryAfter, 45);
}));
test('Retry-After as an HTTP date is converted to seconds and bounded', () => withFetch({ '*': { status: 503, retryAfter: new Date(Date.now() + 90e3).toUTCString() } }, async () => {
  const B = await Data.loadModels(spec, where);
  A.ok(B.retryAfter >= 85 && B.retryAfter <= 91, String(B.retryAfter));
}));
test('a nonsense Retry-After is ignored rather than trusted', () => withFetch({ '*': { status: 429, retryAfter: 'soon' } }, async () => {
  const B = await Data.loadModels(spec, where); A.equal(B.retryAfter, null);
}));
test('a failed request is never cached and the next request recovers', async () => {
  await withFetch({ '*': { status: 500 } }, async () => { A.equal((await Data.loadModels(spec, where)).empty, true); });
  await withFetch({}, async () => { const B = await Data.loadModels(spec, where); A.equal(Object.keys(B.models).length, 3); A.deepEqual(B.problems, []); });
});
test('null hours and a shorter horizon stay missing (never zero) on the shared axis', () => withFetch({ gfs_seamless: { nullFrom: [5, 8] }, gfs_hrrr: { hoursAvailable: 10 } }, async () => {
  const B = await Data.loadModels(spec, where);
  A.equal(B.models.gfs_seamless.h.precipitation_probability[6], null);
  A.equal(B.models.gfs_hrrr.h.precipitation_probability[20], null);
  A.ok(Number.isFinite(B.models.ecmwf_ifs025.h.precipitation_probability[6]));
}));
test('a failed ensemble is named with its status too', () => withFetch({ '*': { status: 502 } }, async () => {
  const E = await Data.loadEnsemble({ id: 'blendEns', base: 'https://ensemble-api.open-meteo.com/v1/ensemble', params: spec.params, days: 2, require: ['temperature_2m'], models: [{ id: 'gfs025', name: 'GEFS', source: 'gefs' }], hourly: ['temperature_2m'] }, where);
  A.ok(E.problems.includes('GEFS: unavailable (HTTP 502)'), E.problems.join('; '));
}));

/* the event's own hours decide what "available" means */
const B2 = { ms: Array.from({ length: 48 }, (_, i) => NOW + i * H), models: { gfs: { h: { temperature_2m: Array(48).fill(50) } }, hrrr: { h: { temperature_2m: Array.from({ length: 48 }, (_, i) => (i < 10 ? 50 : null)) } } } };
const feeds = { used: ['GFS', 'HRRR (48 h)'], usedIds: ['gfs', 'hrrr'], missing: [{ id: 'nbm', name: 'NBM', why: 'request failed (HTTP 500)' }] };
test('a source whose forecast ends before the event is not counted as available for it', () => {
  const f = BUI.eventFeeds(feeds, B2, NOW + 20 * H, NOW + 30 * H), c = BUI.coverage({ feeds: f });
  A.deepEqual(f.used, ['GFS']); A.equal(c.text, '1 of 3 model sources available');
  A.match(c.detail, /Unavailable: NBM\./); A.match(c.detail, /does not reach the event hours yet: HRRR \(48 h\)/);
});
test('a source covering any event hour is counted', () => {
  const f = BUI.eventFeeds(feeds, B2, NOW + 8 * H, NOW + 30 * H); A.deepEqual(f.used, ['GFS', 'HRRR (48 h)']);
});
test('without source ids the published counts are left as they are', () => {
  const f = BUI.eventFeeds({ used: ['GFS'], missing: [] }, B2, NOW, NOW + H); A.deepEqual(f.used, ['GFS']);
});

/* "Since your last briefing": a failed model is a coverage change, never a weight change */
test('a failed model leaves the recipe unchanged so the comparison reports a coverage change', () => {
  const ev = { loc: { lat: 39, lon: -84 }, tz: 'America/New_York', gust: 25 }, b = { all: { startMs: 10 * H, endMs: 20 * H }, phases: [] }, V = { rows: [], hrs: [] };
  const res = (ws, used) => ({ RB: { ws: { gfs: 1, ifs: 1.25 }, rules: null }, ctx: { now: H, B: { models: {} }, ws, rules: null }, feeds: { used }, alertsAvailable: false, alerts: [] });
  const a = snapshot(ev, b, V, res({ gfs: 1, ifs: 1.25 }, ['GFS', 'IFS'])), c = snapshot(ev, b, V, res({ ifs: 1.25 }, ['IFS']));
  A.equal(a.recipe, c.recipe); A.notDeepEqual(a.feeds, c.feeds);
});
test('a changed weight is still a recipe change', () => {
  const ev = { loc: { lat: 39, lon: -84 }, tz: 'America/New_York', gust: 25 }, b = { all: { startMs: 10 * H, endMs: 20 * H }, phases: [] }, V = { rows: [], hrs: [] };
  const res = (w) => ({ RB: { ws: { gfs: w, ifs: 1.25 }, rules: null }, ctx: { now: H, B: { models: {} }, ws: { gfs: w, ifs: 1.25 }, rules: null }, feeds: { used: ['GFS'] }, alertsAvailable: false, alerts: [] });
  A.notEqual(snapshot(ev, b, V, res(1)).recipe, snapshot(ev, b, V, res(2)).recipe);
});

(async () => {
  for (const [name, f] of tests) { try { await f(); n++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ' — ' + String(e.message || e).split('\n')[0]); process.exitCode = 1; } }
  console.log(process.exitCode ? 'source failure checks failed' : `ok - ${n} source failure checks passed`);
})();
