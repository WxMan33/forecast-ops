#!/usr/bin/env node
/* Weather Records & Milestones on Overview and Almanac (desktop and 375 × 667, light and dark), offline: every outside
   request is refused, so the sections run only from feeds/insights (the committed Cincinnati pack, built from real
   RCC-ACIS / NCEI data, Nov 26 2026 preliminary) and must leave the rest of the page working.
   Usage: node tools/records-check.js [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const here = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'records')); fs.mkdirSync(out, { recursive: true });
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const serve = (noPack) => new Promise((ok) => { const s = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const f = path.resolve(here, rel || 'index.html');
  if (noPack && rel.startsWith('feeds/insights/')) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });
  s.listen(0, '127.0.0.1', () => ok({ s, base: 'http://127.0.0.1:' + s.address().port })); });
const CVG = 'lat=39.0446&lon=-84.6723&name=CVG+airport%2C+Cincinnati%2FNorthern+Kentucky';
async function open(b, srv, page, { clock, vp = { width: 1366, height: 900 }, theme = 'light' }) {
  const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/New_York', permissions: ['clipboard-read', 'clipboard-write'] }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message)); await p.clock.install({ time: new Date(clock) });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); }, theme);
  await ctx.route('**/*', (r) => (new URL(r.request().url()).origin !== srv.base ? r.fulfill({ status: 503, body: '' }) : r.continue()));
  await p.goto(`${srv.base}/${page}`); await p.waitForTimeout(2500); return { ctx, p, errors };
}
const card = (p, id) => p.evaluate((id) => { const h = document.getElementById(id); return { hidden: h.hidden, text: h.innerText.replace(/\s+/g, ' '), items: [...h.querySelectorAll('[data-id]')].map((e) => e.dataset.id), links: [...h.querySelectorAll('a')].map((a) => a.getAttribute('href')), hs: document.documentElement.scrollWidth > innerWidth + 1, bottom: Math.round(h.getBoundingClientRect().bottom) }; }, id);
(async () => {
  const b = await chromium.launch(), srv = await serve(false), bare = await serve(true);
  try {
    for (const [dev, vp] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 375, height: 667 }]]) for (const theme of ['light', 'dark']) {
      const L = `${dev} ${theme}:`;
      /* Overview the day after: up to three highlights, each linking to its Almanac detail */
      { const { ctx, p, errors } = await open(b, srv, `index.html?${CVG}`, { clock: '2026-11-27T15:00:00Z', vp, theme }), c = await card(p, 'recordsCard');
        check(!c.hidden && c.items.join() === 'rec-pcpn,hol-US-thanksgiving,freq-US-thanksgiving' && /Yesterday/.test(c.text) && /Preliminary observation/i.test(c.text), `${L} Overview shows three timely highlights, labelled preliminary (${c.items.join(', ')})`);
        check(c.links.length === 3 && c.links.every((h) => /^almanac\.html\?.*date=2026-11-26.*#insights$/.test(h)), `${L} each highlight links to its Almanac detail for Nov 26`);
        check(!/—/.test(c.text) && !c.hs && !errors.length, `${L} Overview: no em dashes, no sideways scroll, no page errors ${errors.join('; ')}`);
        await p.locator('#recordsCard').screenshot({ path: path.join(out, `overview-${dev}-${theme}.png`) }); await ctx.close(); }
      /* Almanac: every finding with evidence and Copy fact */
      { const { ctx, p, errors } = await open(b, srv, `almanac.html?${CVG}&date=2026-11-26#insights`, { clock: '2026-11-27T15:00:00Z', vp, theme }), c = await card(p, 'insightsCard');
        check(!c.hidden && c.items.length === 5 && /Historical Insights & Fun Facts/.test(c.text) && /1871 to 2025/.test(c.text) && /155 prior years with an observation, none missing/.test(c.text) && /final through 2026-11-15/.test(c.text), `${L} Almanac lists 5 findings with source, range, sample and status`);
        if (dev === 'desktop') { await p.locator('#insightsCard [data-copy]').first().click(); await p.waitForTimeout(200);
          const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => '')); check(clip === "Cincinnati's 2.16 in of rain on November 26, 2026 broke the Nov 26 record of 1.49 in set in 1946 (preliminary data).", `${L} Copy fact copies a stand-alone sentence (${clip})`); }
        check(!/—/.test(c.text) && !c.hs && !errors.length, `${L} Almanac: no em dashes, no sideways scroll, no page errors ${errors.join('; ')}`);
        await p.locator('#insightsCard').screenshot({ path: path.join(out, `almanac-${dev}-${theme}.png`) }); await ctx.close(); }
    }
    /* an ordinary day: Overview hides the section */
    { const { ctx, p } = await open(b, srv, `index.html?${CVG}`, { clock: '2026-11-22T15:00:00Z' }), c = await card(p, 'recordsCard'); check(c.hidden, 'ordinary day (Nov 22): Overview hides Weather Records & Milestones'); await ctx.close(); }
    /* a place without a pack: no section on Overview; the rest of the page still renders */
    { const { ctx, p, errors } = await open(b, srv, 'index.html?lat=39.7392&lon=-104.9903&name=Denver%2C+CO', { clock: '2026-11-27T15:00:00Z' }), c = await card(p, 'recordsCard');
      check(c.hidden && !errors.length, 'Denver (no pack yet): Overview hides the section, no page errors'); await ctx.close(); }
    /* the pack unavailable: both pages keep working */
    for (const page of [`index.html?${CVG}`, `almanac.html?${CVG}&date=2026-11-26`]) { const { ctx, p, errors } = await open(b, bare, page, { clock: '2026-11-27T15:00:00Z' });
      const id = page.startsWith('index') ? 'recordsCard' : 'insightsCard', c = await card(p, id), rest = await p.evaluate(() => document.querySelectorAll('.card').length);
      check(c.hidden && !errors.length && rest > 3, `records pack unavailable (${page.split('?')[0]}): section hidden, ${rest} other cards render, no page errors ${errors.join('; ')}`); await ctx.close(); }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await b.close(); srv.s.close(); bare.s.close();
  console.log(failed ? `${failed} records checks failed` : 'all records checks passed'); process.exit(failed ? 1 : 0);
})();
