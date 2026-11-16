#!/usr/bin/env node
/* How many forecast requests reach the provider when one person moves between pages (simulated network, no real
   provider). One browser tab walks Overview → Model Blend → Event Manager → Thunder → Severe → Winter → Model Blend →
   Overview at one location. Reports provider requests per page, identical repeats of a request already answered
   earlier in the walk, and browser-storage writes that failed. Usage: node tools/navigation-cache-check.js [--json] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const sim = require('../tests/fixtures/source-sim.js');
const root = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-11-11T13:30:00Z');
const LOC = 'lat=39.1005&lon=-84.5017&name=Sawyer%20Point%2C%20Cincinnati%2C%20OH';
const WALK = ['index.html', 'blend.html', 'event-beta.html', 'thunder.html', 'severe.html', 'winter.html', 'blend.html', 'index.html'];
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const f = path.resolve(root, rel || 'index.html'); if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });
const CORS = { 'Access-Control-Allow-Origin': '*' };

async function walk({ browser, base, scenario = {}, pages = WALK, between = null, clockAt = NOW }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
  const st = { scenario, log: [], page: null, perPage: {}, seen: new Map(), repeats: 0, inflightDup: 0, pending: new Map(), delivered: new Set(), repeated: [] };
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.origin === base) return r.continue();
    if (/^(api|ensemble-api)\.open-meteo\.com$/.test(u.hostname) && /^\/v1\/(forecast|ensemble)$/.test(u.pathname)) {
      const key = u.href, pg = st.perPage[st.page] = st.perPage[st.page] || { requests: 0, repeats: 0 };
      pg.requests++;
      if (st.seen.has(key)) { pg.repeats++; st.repeats++; st.repeated.push(`${st.page}: ${u.searchParams.get('models') || '?'} d${u.searchParams.get('forecast_days') || '?'} (first answer ${st.delivered.has(key) ? 'reached the page' : 'never reached the page'})`); }
      if (st.pending.get(key)) st.inflightDup++;
      st.pending.set(key, (st.pending.get(key) || 0) + 1);
      const a = await sim.answer(u.href, st.scenario, NOW, st.log).catch(() => null);
      st.pending.set(key, st.pending.get(key) - 1);
      if (a && a.status === 200) st.seen.set(key, true);
      if (!a || a.hang) return r.fulfill({ status: 503, headers: CORS, body: '' }).catch(() => {});
      return r.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: a.body }).catch(() => {});
    }
    if (/^(api|ensemble-api)\.open-meteo\.com$|^api\.weather\.gov$/.test(u.hostname)) {
      const a = await sim.answer(u.href, st.scenario, NOW, st.log).catch(() => null);
      if (!a || a.hang) return r.fulfill({ status: 503, headers: CORS, body: '' }).catch(() => {});
      return r.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: a.body }).catch(() => {});
    }
    return r.fulfill({ status: 503, headers: CORS, body: '' });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('requestfinished', (q) => { const u = q.url(); if (/open-meteo\.com\/v1\/(forecast|ensemble)\?/.test(u)) st.delivered.add(u); });
  p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await p.clock.install({ time: new Date(clockAt) });
  await p.addInitScript(() => {
    localStorage.setItem('fo_analytics_optout', '1');
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { try { return set.call(this, k, v); } catch (e) { const n = +(sessionStorage.getItem.call(this === sessionStorage ? localStorage : localStorage, '__failedWrites') || 0); set.call(localStorage, '__failedWrites', String(n + 1)); throw e; } };
  });
  const shown = [];
  for (let i = 0; i < pages.length; i++) {
    st.page = `${i + 1}. ${pages[i]}`;
    if (between) await between(i, st, p);
    await p.goto(`${base}/${pages[i]}?${LOC}`);
    await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    /* settle: a person stays on the page until its guidance has arrived; leave only once no provider request is
       still being answered (regional requests can start after the main guidance), at most 10 s */
    for (let k = 0; k < 20 && [...st.pending.values()].some((n) => n > 0); k++) await p.waitForTimeout(500);
    await p.waitForTimeout(800);
    shown.push(await p.evaluate(() => ({ chip: (document.getElementById('dataChip') || {}).textContent || '', msg: (document.getElementById('runMsg') || {}).textContent || '', decision: (document.getElementById('decision') || {}).textContent || '' })));
  }
  const failedWrites = +(await p.evaluate(() => localStorage.getItem('__failedWrites') || 0));
  const stored = await p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('ops_c:')).reduce((a, k) => a + k.length + sessionStorage.getItem(k).length, 0));
  await ctx.close();
  const total = Object.values(st.perPage).reduce((a, x) => a + x.requests, 0);
  return { total, repeated: st.repeated, repeats: st.repeats, inflightDup: st.inflightDup, perPage: st.perPage, failedWrites, storedChars: stored, errors, shown };
}

module.exports = { walk, WALK };
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
if (require.main === module) (async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    /* 1. the walk: one tab, one location */
    const r = await walk({ browser, base, scenario: { ensemble: { '*': { realMembers: true } } } });
    Object.entries(r.perPage).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${String(v.requests).padStart(4)} provider forecast/ensemble requests`));
    console.log(`  walk total ${r.total} (before this change: 60) · repeats ${r.repeats} · failed storage writes ${r.failedWrites}`);
    r.repeated.forEach((x) => console.log(`    repeated: ${x}`));
    check(r.total <= 46 && r.repeats === 0 && !r.errors.length, `walk: ${r.total} provider requests for 8 page views, none repeating an answered request (was 60)`);
    const ev = Object.entries(r.perPage).find(([k]) => k.includes('event-beta'));
    check(ev && ev[1].requests <= 1, `walk: Event Manager after Model Blend reuses its answers (${ev ? ev[1].requests : 0} request, its time-zone lookup)`);
    check(r.shown.every((x) => !/Couldn't|NO DATA|could not be loaded/i.test(x.msg + x.chip + x.decision)), 'walk: every page shows loaded guidance');
    /* 2-4. expiry, a failed refresh after expiry, recovery — in one tab */
    let expiryReq = 0, failedShown = '', recovered = 0, recoveredMsg = '';
    await walk({ browser, base, pages: ['blend.html', 'blend.html', 'blend.html', 'blend.html'], between: async (i, st, p) => {
      if (i === 1) { await p.clock.fastForward(16 * 60e3); st.mark = Object.values(st.perPage).reduce((a, x) => a + x.requests, 0); }
      if (i === 2) { expiryReq = Object.values(st.perPage).reduce((a, x) => a + x.requests, 0) - st.mark; await p.clock.fastForward(16 * 60e3); st.scenario = { forecast: { '*': { status: 500 } }, ensemble: { '*': { status: 500 } } }; }
      if (i === 3) { failedShown = await p.evaluate(() => document.getElementById('runMsg').textContent); st.scenario = {}; st.mark2 = Object.values(st.perPage).reduce((a, x) => a + x.requests, 0); }
    } }).then((w) => { recovered = w.total - (w.perPage['1. blend.html'] ? 0 : 0); recoveredMsg = w.shown[3].msg; });
    check(expiryReq > 0, `expiry: after 16 minutes the same page asks the provider again (${expiryReq} requests)`);
    check(/error for every model \(HTTP 500\)/.test(failedShown) && !/models ·/.test(failedShown), `failed refresh after expiry: the failure is shown, not the expired copy ("${failedShown.slice(0, 80)}")`);
    check(/\d+ models/.test(recoveredMsg) && !/error/i.test(recoveredMsg), `recovery: the next load shows fresh guidance ("${recoveredMsg.slice(0, 60)}")`);
    /* 5. a location change: only the new location is requested, nothing reused from the old one */
    {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); const seen = []; let firstDone = false;
      await ctx.route('**/*', async (rt) => { const u = new URL(rt.request().url()); if (u.origin === base) return rt.continue(); if (/^(api|ensemble-api)\.open-meteo\.com$|^api\.weather\.gov$/.test(u.hostname)) { const fr = rt.request().frame(), from = fr ? fr.url() : ''; /* only requests the Columbus page itself starts: the previous page's late requests are abandoned with it */
        if (firstDone && /lat=39\.9612/.test(from) && /forecast|ensemble/.test(u.pathname) && u.searchParams.get('latitude')) seen.push(u.searchParams.get('latitude') + ' ' + (u.searchParams.get('models') || '') + ' d' + u.searchParams.get('forecast_days')); const a = await sim.answer(u.href, {}, NOW, []).catch(() => null); if (!a || a.hang) return rt.fulfill({ status: 503, headers: CORS, body: '' }); return rt.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: a.body }); } return rt.fulfill({ status: 503, headers: CORS, body: '' }); });
      await p.clock.install({ time: new Date(NOW) });
      await p.goto(`${base}/blend.html?${LOC}`); await p.waitForLoadState('networkidle').catch(() => {}); firstDone = true;
      await p.goto(`${base}/blend.html?lat=39.9612&lon=-82.9988&name=Columbus%2C%20OH`); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(500);
      const msg = await p.evaluate(() => document.getElementById('runMsg').textContent);
      /* single-point requests are at the new point; regional ones (broadcast rain chance) are centred on it */
      check(seen.length > 0 && seen.every((x) => x.split(' ')[0].split(',').every((la) => Math.abs(+la - 39.9612) <= 1)) && /grid 82,70/.test(msg), `location change: every request the new page makes is for the new location, and the page shows it (${seen.length} requests; ${msg.match(/grid \d+,\d+/) || '—'})${seen.filter((x) => !x.split(' ')[0].split(',').every((la) => Math.abs(+la - 39.9612) <= 1)).map((x) => ' · elsewhere: ' + x).join('')}`);
      await ctx.close(); }
    /* 6. storage pressure: real-size ensembles at many locations, then a return to the last one costs nothing */
    { const locs = [[39.1005, -84.5017], [39.96, -83.0], [39.76, -84.19], [38.25, -85.76], [39.77, -86.16], [41.5, -81.7], [40.44, -80.0], [42.33, -83.05]];
      const ctx = await browser.newContext(); const p = await ctx.newPage(); let count = 0, counting = false;
      await ctx.route('**/*', async (rt) => { const u = new URL(rt.request().url()); if (u.origin === base) return rt.continue(); if (/^(api|ensemble-api)\.open-meteo\.com$|^api\.weather\.gov$/.test(u.hostname)) { if (counting && /\/v1\/(forecast|ensemble)$/.test(u.pathname)) count++; const a = await sim.answer(u.href, { ensemble: { '*': { realMembers: true } } }, NOW, []).catch(() => null); if (!a || a.hang) return rt.fulfill({ status: 503, headers: CORS, body: '' }); return rt.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: a.body }); } return rt.fulfill({ status: 503, headers: CORS, body: '' }); });
      await p.clock.install({ time: new Date(NOW) });
      for (const [i, [la, lo]] of locs.entries()) for (const pg of ['blend.html', 'event-beta.html', 'winter.html']) { await p.goto(`${base}/${pg}?lat=${la}&lon=${lo}&name=P${i}`); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1500); } // regional requests start after the main guidance
      counting = true; const [la, lo] = locs[locs.length - 1];
      await p.goto(`${base}/blend.html?lat=${la}&lon=${lo}&name=P7`); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(500);
      const kchars = await p.evaluate(() => Math.round(Object.keys(sessionStorage).reduce((a, k) => a + k.length + sessionStorage.getItem(k).length, 0) / 1024));
      check(count === 0, `storage pressure: after 8 locations (${kchars} k characters cached) a return to the last one needs no provider request (${count})`);
      await ctx.close(); }
  } finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} navigation cache checks failed` : 'all navigation cache checks passed');
  process.exitCode = failed ? 1 : 0;
})();
