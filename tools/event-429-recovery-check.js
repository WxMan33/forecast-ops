#!/usr/bin/env node
/* Offline check of Event Manager's HTTP 429 recovery. Open-Meteo, NWS and geocoding are mocked; the page, its loader,
   forecast cache and Retry-After cooldown are real. Timers run on Playwright's fake clock, so waits are exact.
   Usage: node tools/event-429-recovery-check.js [results.json] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), outFile = process.argv[2] || null;
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html'); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
let failed = 0; const results = {};
const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const T0 = Date.parse('2026-11-19T15:00:00Z'), TZ = 'America/New_York';
const PAYCOR = { name: 'Paycor Stadium, Cincinnati, OH', lat: 39.0955, lon: -84.5161 }, MIAMI = { name: 'Miami, FL (area forecast)', lat: 25.77417, lon: -80.19362 };
const EVENT = (v) => JSON.stringify({ n: 'Outdoor concert', v, z: TZ, t: { setup: '2026-11-20T12:00', gates: '2026-11-20T16:30', start: '2026-11-20T17:00', end: '2026-11-20T22:00', teardown: '2026-11-21T00:00' }, g: 25 });

/* synthetic answers: quiet weather everywhere, except a model can be scripted "wet" (to change the forecast) */
const BASE = { temperature_2m: 52, dew_point_2m: 40, apparent_temperature: 50, precipitation_probability: 10, precipitation: 0, snowfall: 0, wind_speed_10m: 8, wind_direction_10m: 200, wind_gusts_10m: 14, cloud_cover: 50, visibility: 20000, weather_code: 2,
  cape: 50, lifted_index: 3, convective_inhibition: 0, wind_speed_500hPa: 35, wind_direction_500hPa: 250, lightning_potential: 0 };
const WET = { precipitation_probability: 90, precipitation: 0.3, weather_code: 63 };
const UNITS = { temperature_2m: '°F', dew_point_2m: '°F', apparent_temperature: '°F', precipitation: 'inch', snowfall: 'inch', wind_speed_10m: 'mp/h', wind_gusts_10m: 'mp/h', visibility: 'm', precipitation_probability: '%' };
const pad = (n) => String(n).padStart(2, '0');
function timesFor(days) { const out = []; for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) { const t = new Date(Date.UTC(2026, 10, 19 + d, h)); out.push(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(h)}:00`); } return out; }
function forecastBody(u, wet) {
  const days = +u.searchParams.get('forecast_days') || 7, time = timesFor(days), hourly = { time }, units = {};
  (u.searchParams.get('hourly') || '').split(',').filter(Boolean).forEach((v) => { hourly[v] = time.map(() => (wet && v in WET ? WET[v] : BASE[v] ?? 0)); if (UNITS[v]) units[v] = UNITS[v]; });
  const dvars = (u.searchParams.get('daily') || '').split(',').filter(Boolean), dtime = time.filter((t, i) => i % 24 === 0).map((t) => t.slice(0, 10)), daily = { time: dtime };
  dvars.forEach((v) => (daily[v] = dtime.map(() => (/max/.test(v) ? 56 : /min/.test(v) ? 44 : 0))));
  return { latitude: +u.searchParams.get('latitude'), longitude: +u.searchParams.get('longitude'), elevation: 150, timezone: TZ, timezone_abbreviation: 'EST', utc_offset_seconds: -18000, hourly_units: units, hourly, ...(dvars.length ? { daily } : {}) };
}
function ensembleBody(u) {
  const days = +u.searchParams.get('forecast_days') || 7, time = timesFor(days), hourly = { time };
  (u.searchParams.get('hourly') || '').split(',').filter(Boolean).forEach((v) => { hourly[v] = time.map(() => BASE[v] ?? 0); for (let m = 1; m <= 5; m++) hourly[`${v}_member${pad(m)}`] = time.map(() => BASE[v] ?? 0); });
  return { latitude: +u.searchParams.get('latitude'), longitude: +u.searchParams.get('longitude'), timezone: TZ, utc_offset_seconds: -18000, hourly_units: { temperature_2m: '°F', precipitation: 'inch', snowfall: 'inch' }, hourly };
}

/* scenario: rules[model] = { refuse: n (first n answers are 429), retryAfter, wet, delayMs (real time, for the late-answer case) } */
async function scenario(browser, base, name, { rules = {}, ensRules = {}, steps }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: TZ }), p = await ctx.newPage(), errors = [], log = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.install({ time: new Date(T0) });
  await p.addInitScript(() => { localStorage.setItem('beta_analytics_optout', '1'); window.print = () => {}; });
  const seen = {}; let inflight = 0, peakRetryOverlap = 0;
  const pageNow = () => p.evaluate(() => Date.now()).catch(() => null);
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.hostname === 'api.open-meteo.com' && u.pathname === '/v1/forecast' || u.hostname === 'ensemble-api.open-meteo.com') {
      const ens = u.hostname.startsWith('ensemble'), model = u.searchParams.get('models'), venue = Math.abs(+u.searchParams.get('latitude') - MIAMI.lat) < 0.5 ? 'miami' : 'paycor';
      const key = `${ens ? 'ens' : 'model'}:${model}:${venue}:${(u.searchParams.get('hourly') || '').slice(0, 30)}`, n = (seen[key] = (seen[key] || 0) + 1);
      const rule = venue === 'paycor' ? (ens ? ensRules : rules)[model] : null, spec = rule && (rule.forSpec ? rule.forSpec === (u.searchParams.get('hourly') || '').split(',')[0] : true) ? rule : null;
      const at = await pageNow(); const refused = !!(spec && n <= (spec.refuse ?? 0));
      log.push({ kind: ens ? 'ens' : 'model', model, venue, n, at: at && at - T0, status: refused ? 429 : 200, spec: (u.searchParams.get('hourly') || '').split(',')[0] });
      inflight++; peakRetryOverlap = Math.max(peakRetryOverlap, n > 1 ? inflight : 0);
      if (spec && spec.delayMs && n > 1) await new Promise((r) => setTimeout(r, spec.delayMs));
      inflight--;
      if (refused) return route.fulfill({ status: 429, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After', ...(spec.retryAfter != null ? { 'Retry-After': String(spec.retryAfter) } : {}) }, contentType: 'application/json', body: JSON.stringify({ error: true, reason: 'Too many concurrent requests' }) });
      return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(ens ? ensembleBody(u) : forecastBody(u, spec && spec.wet)) });
    }
    if (u.hostname === 'nominatim.openstreetmap.org') return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: [{ category: 'boundary', type: 'administrative', addresstype: 'city', name: 'Miami', display_name: 'Miami, Florida, United States', lat: String(MIAMI.lat), lon: String(MIAMI.lon), address: { city: 'Miami', state: 'Florida' } }] });
    if (u.hostname === 'api.open-meteo.com') return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: '{"error":true,"reason":"not found"}' });
    if (u.hostname === 'api.weather.gov') return route.fulfill({ status: 500, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 200, body: '' });
  });
  /* advance the page clock in small steps so answers can arrive between timers */
  const advance = async (ms) => { for (let t = 0; t < ms; t += 250) { await p.clock.runFor(250); await p.waitForTimeout(15); } };
  const until = async (fn, ms = 120000) => { for (let t = 0; t < ms; t += 250) { if (await p.evaluate(fn).catch(() => false)) return true; await p.clock.runFor(250); await p.waitForTimeout(15); } return false; };
  const state = () => p.evaluate(() => ({ decision: document.getElementById('decision').textContent, loaded: document.body.dataset.loaded || '', recovery: document.body.dataset.recovery || '', firstUsable: +document.body.dataset.firstUsable || null,
    print: !document.getElementById('printTop').disabled, cov: (document.querySelector('#sourceCoverage .brief-source b') || {}).textContent || '', note: document.getElementById('coverageUpdate').hidden ? '' : document.getElementById('coverageUpdate').textContent,
    printCov: (document.querySelector('#printView .pv-p1 .brief-source b') || {}).textContent || '', selected: document.body.dataset.selected || '', venue: document.getElementById('evVenue').textContent, update: document.getElementById('briefUpdate').hidden ? '' : document.getElementById('briefUpdate').innerText,
    attempts: (window.EventRecoveryLog || []).map((x) => ({ id: x.id, kind: x.kind, waitMs: x.waitMs, retryAfter: x.retryAfter, outcome: x.outcome, at: x.at })) }));
  await p.goto(`${base}/event-beta.html?e=${encodeURIComponent(EVENT(PAYCOR))}`);
  const S = { p, state, advance, until, log, seen, check: (ok, msg) => check(ok, `${name}: ${msg}`) };
  await steps(S);
  const final = await state();
  S.check(errors.length === 0, 'no script errors ' + errors.join('; '));
  results[name] = { requests: log, attempts: final.attempts, firstUsableMs: final.firstUsable, finalCoverage: final.cov, finalNote: final.note, peakRetryOverlap };
  await ctx.close();
  return { log, final, peakRetryOverlap };
}
const sentFor = (log, model, kind = 'model', venue = 'paycor', spec = null) => log.filter((x) => x.model === model && x.kind === kind && x.venue === venue && (!spec || x.spec === spec));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch();
  const BLEND = 'temperature_2m';

  /* 1. partial recovery: three sources refused once; one with Retry-After 2 s and wet weather, one without Retry-After, one ensemble */
  await scenario(browser, base, 'partial recovery', { rules: { ecmwf_ifs025: { refuse: 1, retryAfter: 2, wet: true, forSpec: BLEND }, gfs_seamless: { refuse: 1, forSpec: BLEND } }, ensRules: { gfs025: { refuse: 1, retryAfter: 1 } },
    steps: async ({ p, state, until, advance, log, check }) => {
      check(await until(() => !!document.body.dataset.loaded, 15000), 'a usable briefing appears before any retry');
      const first = await state();
      check(first.print && /6 of 10/.test(first.cov) && first.attempts.every((x) => !x.at), `Print is ready on the first briefing with 6 of 10 sources (3 refused, NWS down in this mock) and no retry sent yet (${first.cov}, first usable after ${first.firstUsable} ms)`);
      await p.locator('#evCharts [data-variable=pop] [data-hour]').nth(2).click(); const chosen = (await state()).selected;
      await until(() => document.body.dataset.recovery === 'done', 60000); const s = await state();
      const retried = log.filter((x) => x.n > 1 && x.venue === 'paycor');
      check(retried.length === 3 && ['model:ecmwf_ifs025', 'model:gfs_seamless', 'ens:gfs025'].every((k) => retried.some((x) => `${x.kind}:${x.model}` === k)), 'only the three refused requests were sent again: ' + retried.map((x) => `${x.kind}:${x.model}@${x.at}ms`).join(', '));
      check(['ecmwf_ifs025', 'gfs_seamless'].every((m) => sentFor(log, m, 'model', 'paycor', BLEND).length === 2) && sentFor(log, 'gfs025', 'ens').length === 2, 'each refused request was retried exactly once');
      const at = retried.map((x) => x.at).sort((a, b) => a - b);
      check(at[0] >= 2000 && at[1] - at[0] >= 8000 && at[2] - at[1] >= 1000, `retries are one at a time and honor Retry-After 2 s, the 8 s default, then Retry-After 1 s (sent at ${at.join(', ')} ms)`);
      check(/9 of 10/.test(s.cov) && /9 of 10/.test(s.printCov), `coverage and the printout both reach 9 of 10 (all but the mocked NWS outage) (${s.cov} / print ${s.printCov})`);
      check(/Plan for rain|rain/i.test(s.decision) && !/rain/i.test(first.decision), `the recovered source changed the forecast (“${first.decision}” → “${s.decision}”)`);
      const notes = s.attempts.map((x) => x.outcome);
      check(notes.every((o) => o === 'recovered') && /^Coverage update: GEFS answered on its retry\. The briefing now uses 9 of 10 sources\./.test(s.note), 'the last note is a coverage update, apart from the weather: ' + s.note);
      check(s.selected === chosen, `the planner's selected hour is kept across recoveries (${chosen})`);
      check(!/sources-changed|Model source coverage changed/.test(s.update), 'a late source is not reported as a change since the last briefing');
    } });

  /* the forecast-change wording, captured when the wet source arrives */
  await scenario(browser, base, 'coverage vs weather wording', { rules: { ecmwf_ifs025: { refuse: 1, retryAfter: 2, wet: true, forSpec: BLEND }, gfs_seamless: { refuse: 1, retryAfter: 3, forSpec: BLEND } },
    steps: async ({ until, state, check }) => {
      await until(() => /ECMWF IFS answered/.test(document.getElementById('coverageUpdate').textContent), 30000); const a = await state();
      check(/^Coverage update: ECMWF IFS answered on its retry\. The briefing now uses 8 of 10 sources\. With it, the forecast changed: “/.test(a.note), 'a source that changes the weather is named as a coverage update and the forecast change is stated separately: ' + a.note);
      await until(() => /GFS answered/.test(document.getElementById('coverageUpdate').textContent), 30000); const b = await state();
      check(/^Coverage update: GFS answered on its retry\. The briefing now uses 9 of 10 sources\. The forecast decision did not change\./.test(b.note), 'a source that does not change the weather says so: ' + b.note);
    } });

  /* 2. recovery from zero sources: every deterministic model refused once, no Retry-After */
  /* every model the blend requests is refused, so the first load has no deterministic guidance at all; only the six the
     recipe uses are worth a retry (the five off-by-default models are not asked again) */
  const ids = ['ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_seamless', 'ncep_nbm_conus', 'gfs_hrrr', 'ncep_rrfs_conus'], unused = ['icon_seamless', 'gem_seamless', 'ukmo_seamless', 'meteofrance_seamless', 'jma_seamless'];
  await scenario(browser, base, 'recovery from zero sources', { rules: Object.fromEntries([...ids, ...unused].map((id) => [id, { refuse: 1, forSpec: BLEND }])),
    steps: async ({ p, until, state, log, check }) => {
      await until(() => /slow to answer/.test(document.getElementById('decision').textContent), 15000);
      check(/limiting requests/.test(await p.locator('#keys').innerText()), 'the wait says the service is limiting requests, not a full reload in 20 s');
      check(await until(() => !!document.body.dataset.loaded, 30000), 'the briefing appears once the first source answers its retry');
      const s1 = await state();
      check(s1.print && /\b4 of 10\b/.test(s1.cov), `Print is ready on the first recovered briefing (${s1.cov}, after ${s1.firstUsable} ms)`);
      await until(() => document.body.dataset.recovery === 'done', 90000); const s = await state();
      check(ids.every((id) => sentFor(log, id, 'model', 'paycor', BLEND).length === 2), 'each refused model was asked exactly twice: no whole-page reload on top of the targeted retries');
      check(unused.every((id) => sentFor(log, id, 'model', 'paycor', BLEND).length === 1), 'models the recipe does not use are not retried');
      check(s.firstUsable >= 8000, `the first usable briefing waits for the first retry (${s.firstUsable} ms), it does not appear from unused models`);
      const at = log.filter((x) => x.n > 1 && x.spec === BLEND).map((x) => x.at).sort((a, b) => a - b);
      check(at.every((t, i) => !i || t - at[i - 1] >= 8000), `retries are spaced by the 8 s default (${at.join(', ')} ms)`);
      check(/9 of 10/.test(s.cov) && /9 of 10/.test(s.printCov), `coverage and print end at 9 of 10 (${s.cov})`);
    } });

  /* 3. persistent 429s: two models never answer; one gives Retry-After 3 s */
  await scenario(browser, base, 'persistent 429s', { rules: { ecmwf_ifs025: { refuse: 99, retryAfter: 3, forSpec: BLEND }, gfs_seamless: { refuse: 99, forSpec: BLEND } },
    steps: async ({ until, advance, state, log, check }) => {
      await until(() => document.body.dataset.recovery === 'done', 60000); const s = await state();
      const before = log.length; await advance(180000);
      check(sentFor(log, 'ecmwf_ifs025', 'model', 'paycor', BLEND).length === 2 && sentFor(log, 'gfs_seamless', 'model', 'paycor', BLEND).length === 2 && log.length === before, 'each refused request is retried once and never again (3 more minutes, no new requests)');
      check(/7 of 10/.test(s.cov) && s.print && /GFS was still unavailable on its retry \(HTTP 429\)\./.test(s.note), `the briefing stays usable at 7 of 10 and says which source is still out: ${s.note}`);
      check(s.attempts.every((x) => x.outcome === 'HTTP 429'), 'both outcomes recorded as HTTP 429');
    } });

  /* 4. Retry-After beyond the cap is not waited for */
  await scenario(browser, base, 'long Retry-After', { rules: { ncep_nbm_conus: { refuse: 1, retryAfter: 600, forSpec: BLEND } },
    steps: async ({ until, advance, state, log, check }) => {
      await until(() => document.body.dataset.recovery === 'done', 20000); await advance(30000); const s = await state();
      check(sentFor(log, 'ncep_nbm_conus', 'model', 'paycor', BLEND).length === 1 && /skipped: Retry-After too long/.test(s.attempts[0] && s.attempts[0].outcome), 'a 10-minute Retry-After is honored by not retrying within the page');
    } });

  /* 5. venue switch while a retry's answer is still on its way */
  await scenario(browser, base, 'venue switch', { rules: { gfs_seamless: { refuse: 1, forSpec: BLEND, delayMs: 2500 } },
    steps: async ({ p, until, advance, state, log, check }) => {
      await until(() => !!document.body.dataset.loaded, 15000);
      await until(() => (window.EventRecoveryLog || []).length > 0 || false, 1000).catch(() => {});
      /* let the 8 s wait pass so the retry request is sent; its answer is held for 2.5 s (real time) */
      for (let t = 0; t < 40 && !log.some((x) => x.model === 'gfs_seamless' && x.n === 2); t++) { await p.clock.runFor(250); await p.waitForTimeout(15); }
      check(log.some((x) => x.model === 'gfs_seamless' && x.n === 2), 'the retry was sent before the venue changed');
      await p.locator('#editBtn').click(); await p.locator('#fCity .vs-q').fill('miami, fl'); await p.locator('#fCity .vs-go').click();
      await p.locator('#fCity .vs-hit', { hasText: 'Use Miami for planning' }).click(); await p.locator('#fSave').click();
      await until(() => /Miami/.test(document.body.dataset.loaded || ''), 20000);
      await p.waitForTimeout(3000); await advance(20000); const s = await state();
      check(/Miami/.test(s.venue) && /9 of 10/.test(s.cov) && !s.note && !/Coverage update/.test(s.note), `the late Paycor answer is discarded: Miami shows its own 9 of 10 and no coverage note (${s.cov})`);
      check(!log.some((x) => x.venue === 'miami' && x.n > 1), 'nothing for Miami was retried');
    } });

  if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
})().catch((e) => { failed++; console.error(e); }).finally(async () => { server.close(); console.log(failed ? `${failed} recovery checks failed` : 'all recovery checks passed'); process.exitCode = failed ? 1 : 0; process.exit(); });
