#!/usr/bin/env node
/* Stale-response races on Thunder, Severe and Winter (simulated network; no request reaches a provider).
   Oracle: after switching from location A to location B inside the page, everything the page shows must equal what a
   fresh load of B shows under the same network answers: forecast cards, tables, chart data, source labels, status
   chip, errors and loading text. Clock times are normalised; the location card itself is excluded.
   Cases: slow A then fast B; B fails while A answers late; B still loading after A was shown (nothing of A may remain);
   rapid settings changes (forecast length) where the earlier request is the slowest; partial guidance at B.
   Usage: node tools/location-race-check.js [page-filter] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const sim = require('../tests/fixtures/source-sim.js');
const root = path.resolve(__dirname, '..'), only = process.argv[2] || null;
const NOW = Date.parse('2026-11-11T13:30:00Z');
const A = { name: 'CVG airport, Cincinnati/Northern Kentucky', lat: 39.04456, lon: -84.67229 }, B = { name: 'Columbus, OH', lat: 39.9612, lon: -82.9988 };
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const f = path.resolve(root, rel || 'index.html'); if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });
const CORS = { 'Access-Control-Allow-Origin': '*' };
let failed = 0, browser, base;
const check = (ok, name, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : ' — ' + detail)); if (!ok) failed++; };
const hangAt = (venue) => (u, v) => (v === venue ? { hang: true } : {});
const failAt = (venue) => (u, v) => (v === venue ? { status: 500 } : {});

async function open(page, { at = A, days = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
  const st = { scenario: {}, log: [], pending: 0 };
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.origin === base) return r.continue();
    if (/^(api|ensemble-api)\.open-meteo\.com$|^api\.weather\.gov$/.test(u.hostname)) {
      st.pending++;
      const a = await sim.answer(u.href, st.scenario, NOW, st.log).catch(() => null).finally(() => { st.pending--; });
      if (!a) return r.fulfill({ status: 404, headers: CORS, body: '' }).catch(() => {});
      if (a.hang) return; // never answers: the page's own timeout applies
      return r.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: a.body }).catch(() => {});
    }
    return r.fulfill({ status: 503, headers: CORS, body: '' });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await p.clock.install({ time: new Date(NOW) });
  await p.addInitScript(([key, d]) => { localStorage.setItem('fo_analytics_optout', '1'); localStorage.setItem('ops_theme', JSON.stringify('light')); if (d) localStorage.setItem(key, JSON.stringify(d)); }, [`ops_${page.replace('.html', '')}_days`, days]);
  return { ctx, p, st, errors, url: (loc) => `${base}/${page}?lat=${loc.lat}&lon=${loc.lon}&name=${encodeURIComponent(loc.name)}` };
}
/* everything the page shows except the location card and alerts: text with clock times normalised, plus chart data */
const snap = (p) => p.evaluate(() => {
  const c = document.body.cloneNode(true);
  c.querySelectorAll('#locCard, #alerts, script, style, #severe-research, #srMap').forEach((e) => e.remove());
  const text = c.innerText.replace(/\b\d{1,2}:\d{2}\s?(AM|PM|A|P)?\b/gi, 'T').replace(/\s+/g, ' ').trim();
  const charts = [...document.querySelectorAll('canvas')].map((cv) => { const ch = window.Chart && Chart.getChart(cv); return ch ? JSON.stringify({ labels: ch.data.labels, sets: ch.data.datasets.map((d) => [d.label, d.data]) }) : null; }).filter(Boolean);
  return { text, charts: charts.join('|'), chip: (document.getElementById('dataChip') || {}).textContent || '', msg: (document.getElementById('runMsg') || {}).textContent || '' };
});
/* wait until no simulated request is pending (hanging ones excepted), then let rendering finish */
async function settle(o, ms = 1500) { const t0 = Date.now(); while (Date.now() - t0 < 30000) { await o.p.waitForTimeout(200); if (o.st.pending === 0 || o.st.scenario.hanging) break; } await o.p.waitForTimeout(ms); }
const switchTo = (o, loc) => o.p.locator('#locPreset').selectOption({ label: loc.name });
const diff = (a, b) => { if (a.text !== b.text) { let i = 0; while (i < a.text.length && a.text[i] === b.text[i]) i++; return `text differs at ${i}: page «${a.text.slice(Math.max(0, i - 40), i + 80)}» vs fresh «${b.text.slice(Math.max(0, i - 40), i + 80)}»`; } if (a.charts !== b.charts) return 'chart data differs'; if (a.chip.replace(/\d{1,2}:\d{2}\s?[AP]?M?/i, 'T') !== b.chip.replace(/\d{1,2}:\d{2}\s?[AP]?M?/i, 'T')) return `chip "${a.chip}" vs "${b.chip}"`; return ''; };

/* the reference: a fresh page opened directly at `loc` under `scenario` */
async function fresh(page, loc, scenario, { days = null, hanging = false } = {}) {
  const o = await open(page, { days }); o.st.scenario = { ...scenario, hanging };
  await o.p.goto(o.url(loc)); await settle(o, hanging ? 2500 : 1500);
  const s = await snap(o.p); await o.ctx.close(); return s;
}

async function pageChecks(page) {
  const label = page.replace('.html', '');
  /* 1. slow A, then fast B: B stays */
  { const o = await open(page); o.st.scenario = { delay: { cvg: 3000 } };
    await o.p.goto(o.url(A)); await o.p.waitForTimeout(300); await switchTo(o, B);
    await settle(o, 4500); // well past A's delayed answers
    const t = await snap(o.p), r = await fresh(page, B, {});
    const d = diff(t, r); check(!d && !o.errors.length, `${label}: slow A then fast B — the page shows only B`, d || o.errors.join('; '));
    await o.ctx.close(); }
  /* 2. B fails, A answers late: no A weather under B */
  { const o = await open(page); o.st.scenario = { delay: { cvg: 3000 }, forecast: { '*': failAt('cmh') }, ensemble: { '*': failAt('cmh') }, nws: failAt('cmh') };
    await o.p.goto(o.url(A)); await o.p.waitForTimeout(300); await switchTo(o, B);
    await settle(o, 4500);
    const t = await snap(o.p), r = await fresh(page, B, { forecast: { '*': failAt('cmh') }, ensemble: { '*': failAt('cmh') }, nws: failAt('cmh') });
    const d = diff(t, r); check(!d && !o.errors.length, `${label}: B fails and A answers late — B's failure is shown, nothing of A`, d || o.errors.join('; '));
    await o.ctx.close(); }
  /* 3. A shown, then B still loading: nothing of A remains, loading state as on a fresh B load */
  { const o = await open(page); o.st.scenario = {};
    await o.p.goto(o.url(A)); await settle(o);
    const shownA = await snap(o.p);
    o.st.scenario = { forecast: { '*': hangAt('cmh') }, ensemble: { '*': hangAt('cmh') }, nws: hangAt('cmh'), hanging: true };
    await switchTo(o, B); await o.p.waitForTimeout(2500);
    const t = await snap(o.p), r = await fresh(page, B, { forecast: { '*': hangAt('cmh') }, ensemble: { '*': hangAt('cmh') }, nws: hangAt('cmh') }, { hanging: true });
    const d = diff(t, r); check(!d && shownA.text !== t.text, `${label}: while B loads, A's guidance is gone and the page shows B's loading state`, d);
    await o.ctx.close(); }
  /* 4. partial guidance at B: the same partial picture as a fresh B load */
  { const partial = { forecast: { gfs_seamless: (u, v) => (v === 'cmh' ? { status: 429 } : {}), ecmwf_ifs025: (u, v) => (v === 'cmh' ? { nullFrom: [20, 40] } : {}), gfs_hrrr: (u, v) => (v === 'cmh' ? { hoursAvailable: 18 } : {}) }, ensemble: { gfs025: (u, v) => (v === 'cmh' ? { status: 500 } : {}) } };
    const o = await open(page); o.st.scenario = { ...partial, delay: { cvg: 2500 } };
    await o.p.goto(o.url(A)); await o.p.waitForTimeout(300); await switchTo(o, B);
    await settle(o, 4000);
    const t = await snap(o.p), r = await fresh(page, B, partial);
    const d = diff(t, r); check(!d, `${label}: partial guidance at B (a 429, null hours, a short horizon) matches a fresh B load`, d);
    await o.ctx.close(); }
  /* 5. rapid settings changes: the slowest (earliest) request must not win */
  if (page !== 'winter.html') {
    const o = await open(page, { days: 3 }); o.st.scenario = { delay: (u) => ({ 3: 2500, 5: 1200, 2: 0 })[u.searchParams.get('forecast_days')] || 0 };
    await o.p.goto(o.url(A)); await o.p.waitForTimeout(300);
    await o.p.locator('#days').selectOption('5'); await o.p.waitForTimeout(100); await o.p.locator('#days').selectOption('2');
    await settle(o, 3500);
    const t = await snap(o.p), r = await fresh(page, A, {}, { days: 2 });
    const d = diff(t, r); check(!d, `${label}: forecast length changed twice quickly — only the last choice is shown`, d);
    await o.ctx.close();
  } else {
    const o = await open(page); o.st.scenario = { delay: { cvg: 2500 } };
    await o.p.goto(o.url(A)); await o.p.waitForTimeout(300);
    await switchTo(o, B); await o.p.waitForTimeout(100); await switchTo(o, A); // A → B → A: the second A request is the newest
    o.st.scenario = { delay: { cvg: 0 } };
    await settle(o, 4000);
    const t = await snap(o.p), r = await fresh(page, A, {});
    const d = diff(t, r); check(!d, `${label}: rapid A → B → A switching — the page shows A from the newest request only`, d);
    await o.ctx.close();
  }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
  try { for (const page of ['thunder.html', 'severe.html', 'winter.html'].filter((x) => !only || x.includes(only))) await pageChecks(page).catch((e) => { failed++; console.log(`FAIL ${page} threw: ${String(e.message || e).split('\n')[0]}`); }); }
  finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} location race checks failed` : 'all location race checks passed');
  process.exitCode = failed ? 1 : 0;
})();
