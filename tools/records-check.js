#!/usr/bin/env node
/* Weather Records & Milestones on Overview and Almanac (desktop and 375 × 667, light and dark), offline: every outside
   request is refused, so the sections run only from feeds/insights (the committed Cincinnati and Denver packs, built from
   real RCC-ACIS / NCEI data; Nov 26 2026 preliminary) and must leave the rest of the page working. Also: switching places
   never leaves one market's facts under another's name, a stale pack says so, and a missing pack hides the section.
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
const DEN = 'lat=39.8561&lon=-104.6737&name=Denver+International+Airport%2C+CO', COL = 'lat=39.9612&lon=-82.9988&name=Columbus%2C+OH';
const PLACES = { cvg: { name: 'CVG airport, Cincinnati/Northern Kentucky', lat: 39.0446, lon: -84.6723 }, den: { name: 'Denver International Airport, CO', lat: 39.8561, lon: -104.6737 }, col: { name: 'Columbus, OH', lat: 39.9612, lon: -82.9988 } };
const CIN_WORDS = /Cincinnati|CVG|Thanksgiving/, DEN_WORDS = /Denver/, COL_WORDS = /Columbus|CMH/;
const COL1953 = `${COL}&date=1953-09-02#insights`;
/* a place without a pack: real RCC-ACIS and api.weather.gov answers for Columbus on Sep 2 1953, recorded once and replayed
   (matched by method, URL and body), so the Almanac's station-history fallback runs offline */
const FIX = JSON.parse(fs.readFileSync(path.join(here, 'tests/fixtures/records/columbus-1953-almanac.json'), 'utf8')).requests;
const replay = async (r, u) => { const q = r.request(), hit = FIX.find((x) => x.method === q.method() && x.url === q.url() && (x.body || '') === (q.postData() || ''));
  if (!hit) return false; await r.fulfill({ status: 200, contentType: hit.type || 'application/json', headers: { 'access-control-allow-origin': '*' }, body: hit.text }); return true; };
async function open(b, srv, page, { clock, vp = { width: 1366, height: 900 }, theme = 'light', route = null }) {
  const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/New_York', permissions: ['clipboard-read', 'clipboard-write'] }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message)); await p.clock.install({ time: new Date(clock) });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); }, theme);
  await ctx.route('**/*', async (r) => { const u = new URL(r.request().url()); if (route && (await route(r, u))) return; if (u.origin !== srv.base) return r.fulfill({ status: 503, body: '' }); return r.continue(); });
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
        check(!c.hidden && c.items.join() === 'rec-pcpn,hol-US-thanksgiving,freq-US-thanksgiving' && /Yesterday · Cincinnati Area official record/.test(c.text) && /Preliminary observation/i.test(c.text), `${L} Overview shows three timely highlights, labelled preliminary (${c.items.join(', ')})`);
        check(c.links.length === 3 && c.links.every((h) => /^almanac\.html\?.*date=2026-11-26.*#insights$/.test(h)), `${L} each highlight links to its Almanac detail for Nov 26`);
        check(!/—/.test(c.text) && !c.hs && !errors.length, `${L} Overview: no em dashes, no sideways scroll, no page errors ${errors.join('; ')}`);
        await p.locator('#recordsCard').screenshot({ path: path.join(out, `overview-${dev}-${theme}.png`) }); await ctx.close(); }
      /* Almanac: every finding with evidence and Copy fact */
      { const { ctx, p, errors } = await open(b, srv, `almanac.html?${CVG}&date=2026-11-26#insights`, { clock: '2026-11-27T15:00:00Z', vp, theme }), c = await card(p, 'insightsCard');
        check(!c.hidden && c.items.length === 5 && /Historical Insights & Fun Facts/.test(c.text) && /1871 to 2025/.test(c.text) && /155 prior years with an observation, none missing/.test(c.text) && /observed record only once NCEI's quality-controlled archive has the same value for that date and measurement \(archive through 2026-11-15\)/.test(c.text), `${L} Almanac lists 5 findings with source, range, sample and status`);
        if (dev === 'desktop') { await p.locator('#insightsCard [data-copy]').first().click(); await p.waitForTimeout(200);
          const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => '')); check(clip === "Cincinnati's 2.16 in of rain on November 26, 2026 broke the Nov 26 record of 1.49 in set in 1946 (preliminary data).", `${L} Copy fact copies a stand-alone sentence (${clip})`); }
        check(!/—/.test(c.text) && !c.hs && !errors.length, `${L} Almanac: no em dashes, no sideways scroll, no page errors ${errors.join('; ')}`);
        await p.locator('#insightsCard').screenshot({ path: path.join(out, `almanac-${dev}-${theme}.png`) }); await ctx.close(); }
    }
    /* an ordinary day: Overview hides the section */
    { const { ctx, p } = await open(b, srv, `index.html?${CVG}`, { clock: '2026-11-22T15:00:00Z' }), c = await card(p, 'recordsCard'); check(c.hidden, 'ordinary day (Nov 22): Overview hides Weather Records & Milestones'); await ctx.close(); }
    /* Denver, the second test market (its own threaded record, Mountain time): Oct 6 2026 set a record warm low and tied the record high */
    for (const [dev, vp] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 375, height: 667 }]]) for (const theme of ['light', 'dark']) {
      const L = `Denver ${dev} ${theme}:`;
      { const { ctx, p, errors } = await open(b, srv, `index.html?${DEN}`, { clock: '2026-10-07T15:00:00Z', vp, theme }), c = await card(p, 'recordsCard');
        check(!c.hidden && c.items.join() === 'rec-hiMin,rec-hiMax' && /Yesterday · Denver Area official record/.test(c.text) && /Observed record/i.test(c.text) && !CIN_WORDS.test(c.text), `${L} Overview shows Denver's Oct 6 records, labelled final, nothing from Cincinnati (${c.items.join(', ')})`);
        check(c.links.every((h) => /date=2026-10-06.*#insights$/.test(h)) && !/—/.test(c.text) && !c.hs && !errors.length, `${L} Overview links to Almanac Oct 6; no em dashes, sideways scroll or page errors ${errors.join('; ')}`);
        await p.locator('#recordsCard').screenshot({ path: path.join(out, `denver-overview-${dev}-${theme}.png`) }); await ctx.close(); }
      { const { ctx, p, errors } = await open(b, srv, `almanac.html?${DEN}&date=2026-10-06#insights`, { clock: '2026-10-07T15:00:00Z', vp, theme }), c = await card(p, 'insightsCard');
        check(!c.hidden && c.items.join() === 'rec-hiMin,rec-hiMax' && /59°F/.test(c.text) && /tying 1975 and 2020|1975 and 2020/.test(c.text) && /Denver records pack: Denver Area \(official city record, DENthr\)/.test(c.text) && /findings for the 60 days through 2026-11-26\. A finding is an observed record only once/.test(c.text) && !CIN_WORDS.test(c.text), `${L} Almanac lists Denver's Oct 6 findings with the pack's coverage line`);
        check(!/—/.test(c.text) && !c.hs && !errors.length, `${L} Almanac: no em dashes, sideways scroll or page errors ${errors.join('; ')}`);
        await p.locator('#insightsCard').screenshot({ path: path.join(out, `denver-almanac-${dev}-${theme}.png`) }); await ctx.close(); }
    }
    /* switching places on Overview without a reload: the section clears at once (even while the next pack is still
       loading), then shows only the new market's facts, or nothing for a place no pack covers */
    { let slow = true; const { ctx, p, errors } = await open(b, srv, `index.html?${CVG}`, { clock: '2026-11-27T15:00:00Z', route: async (r, u) => { if (slow && u.pathname.endsWith('/den.json')) { await new Promise((z) => setTimeout(z, 1500)); } return false; } });
      const c0 = await card(p, 'recordsCard'); check(!c0.hidden && CIN_WORDS.test(c0.text), 'switch: Overview starts on Cincinnati with its Thanksgiving records');
      const mid = await p.evaluate((pl) => { Ops.setLocation(pl); const h = document.getElementById('recordsCard'); return { hidden: h.hidden, text: h.innerText }; }, PLACES.den);
      check(mid.hidden && !mid.text.trim(), 'switch: Cincinnati to Denver clears the section at once, before the Denver pack arrives');
      await p.waitForTimeout(2500); const c1 = await card(p, 'recordsCard');
      check(c1.hidden && !CIN_WORDS.test(c1.text), 'switch: Denver on Nov 27 (no Denver records Nov 26 or 27): section hidden, no Cincinnati facts');
      await p.evaluate((pl) => Ops.setLocation(pl), PLACES.cvg); await p.waitForTimeout(1500); const c2 = await card(p, 'recordsCard');
      check(!c2.hidden && c2.items.join() === 'rec-pcpn,hol-US-thanksgiving,freq-US-thanksgiving', 'switch: back to Cincinnati shows its highlights again');
      await p.evaluate((pl) => Ops.setLocation(pl), PLACES.col); await p.waitForTimeout(1500); const c3 = await card(p, 'recordsCard');
      check(c3.hidden && !CIN_WORDS.test(c3.text) && !errors.length, `switch: Columbus (no pack; 130 km from CVG, outside its 60 km radius): section hidden, no Cincinnati facts ${errors.join('; ')}`); slow = false; await ctx.close(); }
    { const { ctx, p, errors } = await open(b, srv, `index.html?${DEN}`, { clock: '2026-10-07T15:00:00Z' }), c0 = await card(p, 'recordsCard');
      await p.evaluate((pl) => Ops.setLocation(pl), PLACES.col); await p.waitForTimeout(1500); const c1 = await card(p, 'recordsCard');
      await p.evaluate((pl) => Ops.setLocation(pl), PLACES.cvg); await p.waitForTimeout(1500); const c2 = await card(p, 'recordsCard');
      check(!c0.hidden && DEN_WORDS.test(c0.text) && c1.hidden && !DEN_WORDS.test(c1.text) && c2.hidden && !DEN_WORDS.test(c2.text) && !errors.length, 'switch: Denver (Oct 7) to Columbus to Cincinnati: Denver facts never carry over; Cincinnati has none for Oct 6-7, so hidden');
      await ctx.close(); }
    /* Almanac, moving between places in one tab (the session cache is shared): each place gets only its own facts */
    { const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.clock.install({ time: new Date('2026-11-27T15:00:00Z') }); await ctx.route('**/*', (r) => (new URL(r.request().url()).origin !== srv.base ? r.fulfill({ status: 503, body: '' }) : r.continue()));
      const at = async (q) => { await p.goto(`${srv.base}/almanac.html?${q}`); await p.waitForTimeout(2500); return card(p, 'insightsCard'); };
      const a = await at(`${CVG}&date=2026-11-26`), d1 = await at(`${DEN}&date=2026-11-26`), d2 = await at(`${DEN}&date=2026-10-06`), c = await at(`${COL}&date=2026-10-06`), z = await at(`${CVG}&date=2026-10-06`);
      check(!a.hidden && CIN_WORDS.test(a.text), 'Almanac switch: Cincinnati Nov 26 shows its findings');
      check(d1.hidden && !CIN_WORDS.test(d1.text), 'Almanac switch: Denver Nov 26 (no Denver finding that day): hidden, no Cincinnati facts');
      check(!d2.hidden && DEN_WORDS.test(d2.text) && !CIN_WORDS.test(d2.text), 'Almanac switch: Denver Oct 6 shows Denver findings only');
      check(c.hidden && !DEN_WORDS.test(c.text) && !CIN_WORDS.test(c.text), 'Almanac switch: Columbus Oct 6 (no pack, station history unavailable offline): hidden, nothing from Denver or Cincinnati');
      check(z.hidden && !DEN_WORDS.test(z.text) && !errors.length, `Almanac switch: Cincinnati Oct 6 (no finding): hidden, no Denver facts ${errors.join('; ')}`); await ctx.close(); }
    /* Columbus, no pack: its own station's daily record from 1953, still standing, with its station and source, and the
       status "Archive confirmation unavailable" (never "Observed record" by age, never "Preliminary observation") */
    for (const [dev, vp, theme] of [['desktop', { width: 1366, height: 900 }, 'light'], ['phone', { width: 375, height: 667 }, 'dark']]) {
      const { ctx, p, errors } = await open(b, srv, `almanac.html?${COL1953}`, { clock: '2026-11-27T15:00:00Z', vp, theme, route: replay });
      await p.waitForFunction(() => document.getElementById('insightsCard').dataset.records === '1953-09-02', null, { timeout: 15000 }).catch(() => {});
      const c = await card(p, 'insightsCard'), chips = await p.$$eval('#insightsCard .rec-status', (a) => a.map((e) => e.dataset.status + ':' + e.textContent));
      check(!c.hidden && c.items.includes('rec-hiMax') && /100°F broke the Sep 2 record of 94°F set in 1913/.test(c.text) && /Columbus Area threaded record \(official city record, CMHthr\)/.test(c.text) && /Range 1878 to 1952/.test(c.text), `Columbus ${dev} ${theme}: the 1953 record high shows with its station, source and range`);
      check(chips.length >= 2 && chips.every((x) => x === 'unconfirmed:Archive confirmation unavailable') && !/Preliminary|Observed record/i.test(c.text) && /not checked against the archive/.test(c.text), `Columbus ${dev} ${theme}: badge and legend say Archive confirmation unavailable only (${[...new Set(chips)].join(', ')})`);
      check(/\(archive confirmation unavailable\)\./.test(await p.textContent('#insightsCard .rec-copytext')) && /this preview has packs for Cincinnati .* and Denver/.test(c.text) && !c.hs && !errors.length, `Columbus ${dev} ${theme}: Copy fact matches the label; the note names the preview's packs; no sideways scroll or page errors ${errors.join('; ')}`);
      await p.locator('#insightsCard').screenshot({ path: path.join(out, `columbus-1953-almanac-${dev}-${theme}.png`) }); await ctx.close(); }
    /* one tab: Columbus, Cincinnati, Denver, Columbus. Each shows only its own facts and its own status labels */
    { const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.clock.install({ time: new Date('2026-11-27T15:00:00Z') });
      await ctx.route('**/*', async (r) => { const u = new URL(r.request().url()); if (await replay(r, u)) return; return u.origin !== srv.base ? r.fulfill({ status: 503, body: '' }) : r.continue(); });
      const at = async (q, date) => { await p.goto(`${srv.base}/almanac.html?${q}`); await p.waitForFunction((d) => document.getElementById('insightsCard').dataset.records === d, date, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500);
        return { ...(await card(p, 'insightsCard')), chips: await p.$$eval('#insightsCard .rec-fact .rec-status', (a) => [...new Set(a.map((e) => e.dataset.status))]) }; };
      const c1 = await at(COL1953, '1953-09-02'), cv = await at(`${CVG}&date=2026-11-26`, '2026-11-26'), dn = await at(`${DEN}&date=2026-10-06`, '2026-10-06'), c2 = await at(COL1953, '1953-09-02');
      check(!c1.hidden && COL_WORDS.test(c1.text) && c1.chips.join() === 'unconfirmed', 'Columbus/Cincinnati/Denver switch: Columbus 1953 first, Archive confirmation unavailable');
      check(!cv.hidden && !COL_WORDS.test(cv.text) && cv.chips.join() === 'preliminary' && !/Archive confirmation unavailable/.test(cv.text), 'Columbus/Cincinnati/Denver switch: Cincinnati Nov 26 shows only its own findings, Preliminary observation, nothing from Columbus');
      check(!dn.hidden && !COL_WORDS.test(dn.text) && !CIN_WORDS.test(dn.text) && dn.chips.join() === 'final' && !/Archive confirmation unavailable|Preliminary/.test(dn.text), 'Columbus/Cincinnati/Denver switch: Denver Oct 6 shows only its own archive-confirmed findings (Observed record)');
      check(!c2.hidden && c2.items.join() === c1.items.join() && !CIN_WORDS.test(c2.text.split('Daily records only for this place')[0]) && !DEN_WORDS.test(c2.text.split('Daily records only for this place')[0]) && c2.text.includes('Daily records only for this place') && c2.chips.join() === 'unconfirmed' && !errors.length, `Columbus/Cincinnati/Denver switch: back to Columbus, the same 1953 finding and label, no Cincinnati or Denver facts ${errors.join('; ')}`);
      await ctx.close(); }
    /* a stale pack (the refresh has been failing): the findings stay, with how old they are */
    { const old = (u) => { const j = JSON.parse(fs.readFileSync(path.join(here, u.pathname.slice(1)), 'utf8')); j.generated = '2026-11-24T12:00:00Z'; return JSON.stringify(j); };
      const { ctx, p, errors } = await open(b, srv, `almanac.html?${CVG}&date=2026-11-26#insights`, { clock: '2026-11-27T15:00:00Z', route: async (r, u) => (u.pathname.endsWith('/cvg.json') ? (await r.fulfill({ status: 200, contentType: 'application/json', body: old(u) }), true) : false) });
      const c = await card(p, 'insightsCard');
      check(!c.hidden && /Refreshed Nov 24, 7:00 AM\. This refresh is 75 hours old, so newer observations or revisions aren't reflected yet\./.test(c.text) && !errors.length, `stale pack (refreshed 75 h ago): Almanac keeps the findings and says how old they are`);
      await p.locator('#insightsCard .rec-cov').screenshot({ path: path.join(out, 'almanac-stale-note.png') }); await ctx.close(); }
    /* the pack unavailable: both pages keep working */
    for (const page of [`index.html?${CVG}`, `almanac.html?${CVG}&date=2026-11-26`]) { const { ctx, p, errors } = await open(b, bare, page, { clock: '2026-11-27T15:00:00Z' });
      const id = page.startsWith('index') ? 'recordsCard' : 'insightsCard', c = await card(p, id), rest = await p.evaluate(() => document.querySelectorAll('.card').length);
      check(c.hidden && !errors.length && rest > 3, `records pack unavailable (${page.split('?')[0]}): section hidden, ${rest} other cards render, no page errors ${errors.join('; ')}`); await ctx.close(); }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await b.close(); srv.s.close(); bare.s.close();
  console.log(failed ? `${failed} records checks failed` : 'all records checks passed'); process.exit(failed ? 1 : 0);
})();
