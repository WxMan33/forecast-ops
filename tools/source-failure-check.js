#!/usr/bin/env node
/* Offline reliability check: Event Manager and Model Blend against a simulated weather-data network.
   One model, several and all failing (HTTP 429/500, timeouts), recovery, partial/null hours and shorter
   horizons, cached guidance then a failed refresh, NWS forecast or alerts down, and venue switches while
   requests are pending. Pages and engines are the real ones; only the network answers are synthetic.
   Usage: node tools/source-failure-check.js [screenshot-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const sim = require('../tests/fixtures/source-sim.js');
const root = path.resolve(__dirname, '..'), shots = process.argv[2] || null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const NOW = Date.parse('2026-11-11T20:30:00Z'), H = 3600e3;
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'index.html'); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
let failed = 0, browser;
const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After' };
const GEO = { results: [{ name: 'Columbus', latitude: sim.VENUES.cmh.lat, longitude: sim.VENUES.cmh.lon, country_code: 'US', admin1: 'Ohio', timezone: 'America/New_York', population: 900000 }] };
const EVENT = { id: 'ev_sim', name: 'Synthetic Riverfront Night', loc: { name: sim.VENUES.cvg.name, lat: sim.VENUES.cvg.lat, lon: sim.VENUES.cvg.lon }, tz: 'America/New_York',
  times: { setup: '2026-11-12T12:00', gates: '2026-11-12T16:30', start: '2026-11-12T17:00', end: '2026-11-12T22:00', teardown: '2026-11-13T00:00' }, gust: 25 };

async function open(base, { phone = false, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: phone ? 390 : 1280, height: phone ? 760 : 960 }, timezoneId: 'America/New_York' });
  const state = { scenario: {}, log: [], errors: [] };
  await ctx.route('**/*', async (r) => {
    const url = r.request().url(), u = new URL(url);
    if (u.origin === base) return r.continue();
    if (u.hostname === 'geocoding-api.open-meteo.com') return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(GEO) });
    if (/^(api|ensemble-api)\.open-meteo\.com$|^api\.weather\.gov$/.test(u.hostname)) {
      const a = await sim.answer(url, state.scenario, NOW, state.log).catch(() => null);
      if (!a) return r.fulfill({ status: 404, headers: CORS, body: '' });
      if (a.hang) return; // never answers: the page's own timeout has to cope
      return r.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: a.body }).catch(() => {});
    }
    return r.fulfill({ status: 200, headers: CORS, body: '', contentType: u.pathname.endsWith('.js') ? 'application/javascript' : 'text/plain' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => state.errors.push(e.message));
  await p.clock.install({ time: new Date(NOW) });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('fo_analytics_optout', '1'); }, theme);
  return { ctx, p, state };
}
const text = (p, sel) => p.evaluate((q) => document.querySelector(q)?.textContent || '', sel).catch(() => '');
const settled = (p, ms = 30000) => p.waitForFunction(() => { const d = document.getElementById('decision')?.textContent || ''; return document.body.dataset.loaded || /could not be loaded|slow to answer|ended|pending|needs confirmation/i.test(d); }, null, { timeout: ms });
const requests = (st, host) => st.log.filter((x) => !host || x.host === host).length;

async function eventChecks(base) {
  const { ctx, p, state } = await open(base);
  await p.goto(base + '/event-beta.html'); await settled(p);
  await p.evaluate((e) => window.EventStore.saveEvent(e), EVENT);
  await p.goto(base + '/event-beta.html?ev=ev_sim'); await settled(p);
  const all = (await text(p, '#sourceCoverage')).match(/(\d+) of (\d+)/);
  check(all && all[1] === all[2], 'event: all simulated sources answer and all are counted (' + (all && all[0]) + ')');
  const total = all ? +all[2] : 0;
  check(await p.locator('#sourceCoverage [data-support]').count()===1, 'event: shared guidance support panel renders');

  /* ---- one model rate-limited ---- */
  state.scenario = { forecast: { gfs_seamless: { status: 429 } } };
  await p.goto(base + '/event-beta.html?ev=ev_sim'); await p.evaluate(() => sessionStorage.clear()); await p.reload(); await settled(p);
  let cov = await text(p, '#sourceCoverage'), line = await text(p, '#blendLine');
  check(await p.locator('#sourceCoverage [data-support]').getAttribute('data-support')==='Limited coverage','event: rate limit leaves support limited, not improving weather');
  check(cov.includes(`${total - 1} of ${total}`) && /GFS/.test(cov), 'event: one rate-limited model is excluded from the count and named');
  check(/GFS \(request failed[^)]*429/.test(line), 'event: the blend line records the provider status for the missing model (HTTP 429)');

  /* ---- several missing: two HTTP 500s and an ensemble timeout ---- */
  state.scenario = { forecast: { ecmwf_ifs025: { status: 500 }, ncep_nbm_conus: { status: 500 } }, ensemble: { gfs025: { hang: true } } };
  await p.evaluate(() => sessionStorage.clear()); await p.reload(); await settled(p, 45000);
  cov = await text(p, '#sourceCoverage'); line = await text(p, '#blendLine');
  check(cov.includes(`${total - 3} of ${total}`) && /ECMWF IFS/.test(cov) && /NBM/.test(cov) && /GEFS/.test(cov), 'event: several missing sources are excluded and each is named (' + (cov.match(/\d+ of \d+/) || [''])[0] + ')');
  check(/ECMWF IFS \(request failed[^)]*500/.test(line) && /NBM \(request failed[^)]*500/.test(line), 'event: HTTP 500 failures are recorded per model');

  /* ---- everything fails: never an all-clear, never the previous briefing ---- */
  state.scenario = {}; await p.evaluate(() => sessionStorage.clear()); await p.reload(); await settled(p);
  const before = await text(p, '#evCharts');
  check(before.length > 0, 'event: baseline hourly charts are drawn');
  state.scenario = { forecast: { '*': { status: 500 } } };
  await p.evaluate(() => sessionStorage.clear()); await p.locator('#bxRefresh').click(); await settled(p);
  let dec = await text(p, '#decision');
  check(!/No weather concern|all clear/i.test(dec) && /slow to answer|could not be loaded/i.test(dec), 'event: all models failing never reads as an all-clear (' + dec + ')');
  check(!(await text(p, '#evCharts')).trim() && !(await text(p, '#nwsEv')).trim() && !(await p.locator('#printView').innerHTML()).trim(), 'event: the previous briefing\'s charts, NWS block and printout are cleared while guidance is unavailable');
  await p.clock.fastForward(21000); await settled(p);
  await p.waitForFunction(() => /could not be loaded/i.test(document.getElementById('decision').textContent), null, { timeout: 15000 }).catch(() => {});
  dec = await text(p, '#decision');
  check(/could not be loaded/i.test(dec), 'event: one bounded automatic retry, then a plain failure');
  const n0 = requests(state, 'api.open-meteo.com'); await p.clock.fastForward(180000); await p.waitForTimeout(500);
  check(requests(state, 'api.open-meteo.com') === n0, 'event: no further automatic retries after the bounded one');

  /* ---- provider retry guidance: Retry-After 45 s is respected, not the fixed 20 s ---- */
  state.scenario = { forecast: { '*': { status: 429, retryAfter: 45 } } };
  await p.evaluate(() => sessionStorage.clear()); await p.locator('#bxRefresh').click(); await settled(p);
  const n1 = requests(state, 'api.open-meteo.com');
  await p.clock.fastForward(25000); await p.waitForTimeout(500);
  check(requests(state, 'api.open-meteo.com') === n1, 'event: no automatic retry before the provider\'s Retry-After (45 s)');
  check(/45 seconds|in 45/.test(await text(p, '#keys')), 'event: the wait follows the provider\'s guidance (' + (await text(p, '#keys')) + ')');
  state.scenario = {};
  await p.clock.fastForward(21000); await settled(p);
  await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 }).catch(() => {});
  check(requests(state, 'api.open-meteo.com') > n1 && !!(await p.evaluate(() => document.body.dataset.loaded)), 'event: retries after Retry-After and recovers');

  /* ---- recovery keeps the selected hour and clears obsolete errors ---- */
  const hour = Date.parse('2026-11-12T23:00:00Z');
  await p.locator(`#evCharts [data-variable=pop] [data-hour="${hour}"]`).click();
  check(await p.evaluate((h) => +document.body.dataset.selected === h, hour), 'event: an hour can be selected');
  state.scenario = { forecast: { '*': { status: 500 } } }; await p.evaluate(() => sessionStorage.clear()); await p.locator('#bxRefresh').click(); await settled(p);
  state.scenario = {}; await p.evaluate(() => sessionStorage.clear()); await p.locator('#bxRefresh').click(); await settled(p);
  await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 }).catch(() => {});
  dec = await text(p, '#decision');
  check(!/slow to answer|could not be loaded/i.test(dec) && !/Try/.test(await text(p, '#keys')), 'event: recovery clears the obsolete failure message');
  check(await p.evaluate((h) => +document.body.dataset.selected === h && document.querySelector('#evCharts [aria-pressed=true]')?.dataset.hour === String(h), hour), 'event: recovery keeps the selected event hour');
  check(/Synthetic Riverfront Night/.test(await text(p, '#evName')), 'event: recovery keeps the selected event');

  /* ---- cached guidance keeps its original time; a failed refresh after it expires is not shown as fresh ---- */
  state.scenario = {}; await p.evaluate(() => sessionStorage.clear()); await p.locator('#bxRefresh').click(); await settled(p);
  const firstAt = await p.evaluate(() => Date.now());
  await p.clock.fastForward(10 * 60e3); state.scenario = { forecast: { '*': { status: 500 } } };
  await p.locator('#bxRefresh').click(); await settled(p);
  const upd = await text(p, '#bxUpd'), stamp = new Date(firstAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  check(await p.evaluate(() => !!document.body.dataset.loaded), 'event: guidance still within its cache window is reused when a refresh fails');
  check(upd.includes(stamp) && /saved|cached/i.test(upd), `event: reused guidance shows its original retrieval time and says it is a saved copy (${upd})`);
  await p.clock.fastForward(10 * 60e3); await p.locator('#bxRefresh').click(); await settled(p);
  dec = await text(p, '#decision');
  check(/slow to answer|could not be loaded/i.test(dec), 'event: expired cache plus a failed refresh is reported as unavailable, not as current guidance');
  state.scenario = {}; await p.clock.fastForward(21000); await settled(p);
  await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 }).catch(() => {});
  check(!!(await p.evaluate(() => document.body.dataset.loaded)) && !/saved/i.test(await text(p, '#bxUpd')), 'event: recovery replaces the failure with fresh guidance');

  /* ---- NWS forecast and alerts down, models fine ---- */
  state.scenario = { nws: { status: 503 }, alerts: { status: 500 } };
  await p.evaluate(() => { sessionStorage.clear(); Object.keys(localStorage).filter((k) => k.startsWith('ops_nwspt')).forEach((k) => localStorage.removeItem(k)); });
  await p.locator('#bxRefresh').click(); await settled(p);
  check(/Official NWS forecast unavailable/.test(await text(p, '#nwsEv')), 'event: NWS forecast outage is stated in the NWS section');
  check(/NWS point forecast/.test(await text(p, '#sourceCoverage')), 'event: the NWS point forecast is not counted as an available source');
  check(/alerts could not be checked/i.test(await text(p, '#alerts')), 'event: an alert-check failure is stated, never shown as "no alerts"');
  check(await p.evaluate(() => !!document.body.dataset.loaded), 'event: model guidance still produces a briefing without NWS');
  await p.evaluate(() => scrollTo(0, 0));
  if (shots) await p.screenshot({ path: path.join(shots, 'source-failure-nws-down-desktop-light.png') });
  await p.setViewportSize({ width: 390, height: 760 }); await p.locator('#bxTheme').click(); await p.evaluate(() => scrollTo(0, 0));
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'event: phone layout with the alert notice has no horizontal overflow');
  if (shots) await p.screenshot({ path: path.join(shots, 'source-failure-nws-down-phone-dark.png') });
  await p.locator('#bxTheme').click(); await p.setViewportSize({ width: 1280, height: 960 });
  state.scenario = {}; await p.evaluate(() => sessionStorage.clear()); await p.locator('#bxRefresh').click(); await settled(p);
  check(!/could not be checked/i.test(await text(p, '#alerts')), 'event: recovered alert check clears the warning');

  /* ---- partial hours and a shorter horizon: missing never becomes zero; every view agrees ---- */
  const gapFrom = 24 + 17, gapTo = 24 + 20; // Nov 12, 5 PM to 8 PM local: the event phase
  state.scenario = { forecast: { '*': { nullFrom: [gapFrom, gapTo], nullVars: ['precipitation_probability'] }, gfs_hrrr: { hoursAvailable: 30 } }, ensemble: { '*': { nullFrom: [gapFrom, gapTo] } } };
  await p.evaluate(() => sessionStorage.clear()); await p.locator('#bxRefresh').click(); await settled(p);
  const gapHour = sim.DAY0 + (gapFrom + 1) * H;
  await p.locator(`#evCharts [data-variable=pop] [data-hour="${gapHour}"]`).click();
  check((await text(p, '#evCharts [data-value=pop]')).trim() === '—', 'event: an hour with no rain-chance guidance shows — on the chart, not 0%');
  check(!/\b0%/.test(await text(p, '#evGridDetail')), 'event: selected-hour details never turn the missing chance into 0%');
  const agree = await p.evaluate(() => { const card = [...document.querySelectorAll('#phases [data-peak]')].map((e) => e.textContent.trim()); window.dispatchEvent(new Event('beforeprint')); const pr = [...document.querySelectorAll('#printView .pv-phases [data-peak]')].map((e) => e.textContent.trim()); return { card, pr }; });
  check(agree.card.length > 0 && JSON.stringify(agree.card) === JSON.stringify(agree.pr), 'event: phase cards and printout show the same peak rain chances (' + agree.card.join(',') + ' / ' + agree.pr.join(',') + ')');
  const reach = await text(p, '#sourceCoverage');
  check(/HRRR/.test(reach) && /reach|event hours/i.test(reach), 'event: a model whose horizon ends before the event is not counted as contributing (' + reach + ')');
  await ctx.close();
}

async function historyChecks(base) {
  /* "Since your last briefing" never reads a lost source as better weather */
  const { ctx, p, state } = await open(base);
  await p.goto(base + '/event-beta.html'); await settled(p);
  await p.evaluate((e) => window.EventStore.saveEvent(e), { ...EVENT, loc: { name: sim.VENUES.cmh.name, lat: sim.VENUES.cmh.lat, lon: sim.VENUES.cmh.lon }, gust: 25 });
  await p.goto(base + '/event-beta.html?ev=ev_sim'); await settled(p);
  await p.clock.fastForward(2 * H);
  // the wet, windy contributors fail; what is left is drier and calmer only because it is different guidance
  state.scenario = { forecast: { ecmwf_ifs025: { status: 500 }, gfs_seamless: { status: 429 }, ncep_nbm_conus: { hang: true } } };
  await p.evaluate(() => sessionStorage.clear()); await p.reload(); await settled(p, 45000);
  const t = await text(p, '#briefUpdate');
  check(!/Improved|Better:|no longer|fell from|below your/i.test(t), 'history: losing sources never reads as improving weather (' + t.replace(/\s+/g, ' ').slice(0, 120) + ')');
  check(/source coverage changed/i.test(t), 'history: the summary says source coverage changed');
  await ctx.close();
}

async function raceChecks(base) {
  /* Event Manager: a slow answer for the previous venue cannot replace the new one */
  { const { ctx, p, state } = await open(base);
    state.scenario = { delay: { cvg: 3500 }, alerts: (u, v) => v === 'cvg' ? { features: [{ id: 'a1', properties: { event: 'Wind Advisory', headline: 'Synthetic', onset: '2026-11-11T18:00:00Z', ends: '2026-11-13T06:00:00Z', status: 'Actual', messageType: 'Alert', '@id': 'a1' } }] } : {} };
    await p.goto(base + '/event-beta.html'); await settled(p, 30000);
    check(/Wind Advisory/.test(await text(p, '#alerts')), 'race: the first venue\'s alert is shown for it');
    state.scenario = { delay: { cvg: 4000, cmh: 1500 }, alerts: state.scenario.alerts };
    await p.locator('#bxRefresh').click(); await p.waitForTimeout(200);
    const inp = p.locator('#picker input'); await inp.fill('Columbus'); await p.locator('#picker [role=option]:has-text("Columbus")').first().click({ timeout: 5000 });
    await p.waitForTimeout(400);
    check(!/Wind Advisory/.test(await text(p, '#alerts')), 'race: the previous venue\'s alert disappears as soon as the venue changes');
    await p.waitForFunction(() => /Columbus/.test(document.body.dataset.loaded || ''), null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const s = await p.evaluate(() => ({ loaded: document.body.dataset.loaded, place: document.body.dataset.place, office: document.body.dataset.office, name: document.getElementById('evVenue').textContent }));
    check(/Columbus/.test(s.loaded) && /Columbus/.test(s.place) && /Columbus/.test(s.name), 'race: the newer venue stays selected after the slow answer for the old one arrives (' + JSON.stringify(s) + ')');
    check(!/Wind Advisory/.test(await text(p, '#alerts')), 'race: a late alert answer for the old venue is not shown for the new one');
    check(state.errors.length === 0, 'race: no script errors ' + state.errors.join('; '));
    await ctx.close(); }
  /* Model Blend: the same */
  { const { ctx, p, state } = await open(base);
    state.scenario = { delay: { cvg: 2500 } };
    await p.goto(base + '/blend.html');
    await p.waitForTimeout(300);
    await p.locator('#locPreset').selectOption({ label: 'Columbus, OH' }).catch(async () => { const v = await p.locator('#locPreset option', { hasText: 'Columbus' }).first().getAttribute('value'); await p.locator('#locPreset').selectOption(v); });
    await p.waitForFunction(() => /grid 82,70/.test(document.getElementById('runMsg')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
    // the old point's answers (each delayed, several in sequence) land well after the new point's; wait them out
    await p.waitForFunction(() => !document.getElementById('runBtn').disabled, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(12000);
    const old = state.log.filter((x) => x.venue === 'cvg').length;
    const m = await text(p, '#runMsg');
    check(old > 0, 'race: the old point was still being requested when the new one was chosen (' + old + ' requests)');
    check(/grid 82,70/.test(m) && !/grid 36,37/.test(m), 'race: Model Blend keeps the newly selected location when the old request finishes later (' + m.slice(-60) + ')');
    check(state.errors.length === 0, 'blend: no script errors ' + state.errors.join('; '));
    await ctx.close(); }
}

async function blendChecks(base) {
  for (const [label, scenario] of [['one model 429', { forecast: { gfs_seamless: { status: 429 } } }], ['all models 500', { forecast: { '*': { status: 500 } }, ensemble: { '*': { status: 500 } } }], ['NWS down', { nws: { status: 503 }, alerts: { status: 500 } }]]) {
    const { ctx, p, state } = await open(base); state.scenario = scenario;
    await p.goto(base + '/blend.html');
    await p.waitForFunction(() => !document.getElementById('runBtn')?.disabled && /models|Couldn't/.test(document.getElementById('runMsg')?.textContent || ''), null, { timeout: 40000 }).catch(() => {});
    const m = await text(p, '#runMsg');
    if (label === 'one model 429') check(/GFS: request failed \(HTTP 429\)/.test(m), 'blend: a rate-limited model is named with its HTTP status (' + m.slice(0, 160) + ')');
    if (label === 'all models 500') { check(/Couldn't reach/.test(m), 'blend: all models failing says so'); check(!/No (additional )?flags|all clear/i.test(await text(p, '#next48HeadsUp')), 'blend: no all-clear while every model is down'); }
    if (label === 'NWS down') { check(/NWS unavailable/.test(m), 'blend: NWS outage is named while models load'); check(/NWS alert check unavailable/.test(await text(p, '#next48HeadsUp')), 'blend: alert-check failure is stated'); }
    if(label!=='all models 500'){
      check(await p.locator('#guidanceSupport [data-support]').count()===1, `blend (${label}): shared coverage and agreement panel renders`);
    }
    check(state.errors.length === 0, `blend (${label}): no script errors ` + state.errors.join('; '));
    await ctx.close();
  }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
  const only = process.env.ONLY;
  for (const [k, f] of [['event', eventChecks], ['history', historyChecks], ['race', raceChecks], ['blend', blendChecks]]) {
    if (only && only !== k) continue;
    try { await f(base); } catch (e) { failed++; console.log('FAIL ' + k + ' threw: ' + String(e.message || e).split('\n')[0]); }
  }
})().catch((e) => { failed++; console.error(e); }).finally(async () => { if (browser) await browser.close(); server.close(); console.log(failed ? `${failed} source-failure checks failed` : 'all source-failure checks passed'); process.exitCode = failed ? 1 : 0; });
