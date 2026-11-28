#!/usr/bin/env node
/* Event Manager in the normal Forecast Ops navigation (desktop and 375 × 667). Weather is SYNTHETIC
   (tests/fixtures/event-slots-data.js: an evening rain case at Paycor Stadium, and the same with a synthetic Flash Flood
   Warning), run through the real engines. Not a forecast. Usage: node tools/event-nav-check.js [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const args = process.argv.slice(2), ci = args.indexOf('--compare'), other = ci >= 0 ? path.resolve(args[ci + 1]) : null;
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && (ci < 0 || i !== ci + 1)) || path.join(require('node:os').tmpdir(), 'event-nav')); fs.mkdirSync(out, { recursive: true });
const here = path.resolve(__dirname, '..');
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 };
const CLOCK = '2026-11-25T14:00:00Z', TOMORROW = '2026-11-26';
const serve = (root) => new Promise((ok) => { const s = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
  s.listen(0, '127.0.0.1', () => ok({ s, base: 'http://127.0.0.1:' + s.address().port, root })); });

async function open(browser, srv, { fixture, query = '', store = null, device = PHONE }) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.install({ time: new Date(CLOCK) });
  await p.addInitScript((st) => { localStorage.setItem('ops_theme', JSON.stringify('light')); localStorage.setItem('beta_analytics_optout', '1'); window.print = () => {};
    if (st) { localStorage.setItem('beta_events_v2', JSON.stringify(st)); } }, store);
  const fx = fs.readFileSync(path.join(here, 'tests/fixtures', fixture), 'utf8');
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== srv.base) return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: fx + '\n' + fs.readFileSync(path.join(srv.root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  await p.goto(`${srv.base}/event-beta.html${query}`);
  const ok = await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 25000 }).then(() => true, () => false);
  if (!ok) throw new Error(`page did not load (${query}): ${errors.join('; ')}`);
  await p.waitForTimeout(400);
  return { ctx, p, errors };
}
/* everything a planner reads on the first screen and in the schedule, as text */
/* the official-alert card after a successful check with no active alerts (null when the page shows another state) */
const noneCard = (p) => p.evaluate(() => { const e = document.querySelector('p[data-official=none]'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; });
const POINTER = /^Official alert No active official alerts for your site right now( \(checked [^)]+\))?\. This doesn’t mean no weather concern: the forecast concern is above\. Outlooks and other official products ↓$/i;
const texts = (p) => p.evaluate(() => { const t = (s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, all = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }; // closed details: their text too
  const dd = [...document.querySelectorAll('#keys dd')], last = dd[dd.length - 1], r = (e) => e && e.getBoundingClientRect();
  return { name: t('#evName'), when: t('#evWhen'), decision: t('#decision'), lead: t('#leadBody'), keys: t('#keys'), after: t('#leadAfter'), schedule: t('#schedule'), glance: t('#evDash .evd-span'), phases: all('#phases'), dash: all('#evDash'),
    why: all('#whyFlagged'), checks: all('#checks'), changes: all('#changes'), decisionBottom: Math.round(r(document.getElementById('decision')).bottom), nextBottom: last ? Math.round(r(last).bottom) : null, vh: innerHeight,
    hscroll: document.documentElement.scrollWidth > innerWidth + 1 }; });
async function pdf(p, file) {
  await p.emulateMedia({ media: 'print' }); await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const buf = await p.pdf({ path: file, preferCSSPageSize: true, printBackground: true }), pages = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  const t = (n) => execFileSync('pdftotext', ['-layout', '-f', String(n), '-l', String(n), file, '-'], { encoding: 'utf8' });
  await p.emulateMedia({ media: 'screen' });
  return { pages, p1: pages ? t(1) : '', p2: pages > 1 ? t(2) : '' };
}
const PAYCOR = { name: 'Paycor Stadium, Cincinnati, OH', lat: 39.0955, lon: -84.5161 };
const ev = { n: 'Bengals home game', v: PAYCOR, z: 'America/New_York', t: { setup: `${TOMORROW}T17:00`, gates: `${TOMORROW}T18:30`, start: `${TOMORROW}T20:00`, end: `${TOMORROW}T22:30`, teardown: `${TOMORROW}T23:30` }, g: 25 };
const q = (w) => '?wx=evening' + (w ? '&alerts=warn' : '') + '&e=' + encodeURIComponent(JSON.stringify(ev));
const pointOf = (href) => { const u = new URL(href, 'http://x/'); return { page: u.pathname.slice(1), lat: +u.searchParams.get('lat'), lon: +u.searchParams.get('lon'), name: u.searchParams.get('name') }; };
const atVenue = (h) => { const p = pointOf(h); return Math.abs(p.lat - PAYCOR.lat) < 1e-4 && Math.abs(p.lon - PAYCOR.lon) < 1e-4 && p.name === PAYCOR.name; };
const POINT = ['index.html', 'threats.html', 'blend.html', 'severe.html', 'winter.html', 'almanac.html'];
(async () => {
  const browser = await chromium.launch(), srv = await serve(here);
  try {
    /* desktop: the standard tab row with Events current; the logo opens Overview; Meteorologist view is its own action */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: q(false), device: { viewport: { width: 1366, height: 900 } } });
      const n = await p.evaluate(() => { const vis = (e) => e && e.offsetParent !== null; return { logo: document.querySelector('.bx-brand').getAttribute('href'),
        tabs: [...document.querySelectorAll('.bx-sitenav a')].filter(vis).map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href'), cur: a.getAttribute('aria-current') })),
        met: [...document.querySelectorAll('.bx-head-in > a.bx-metview')].filter(vis).map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href') })), menu: vis(document.querySelector('.bx-sitemenu > summary')) }; });
      check(pointOf(n.logo).page === 'index.html' && atVenue(n.logo), `desktop: the Forecast Ops logo opens Overview on the venue (${n.logo})`);
      check(n.tabs.map((x) => x.t).join('|') === 'OVERVIEW|THREATS|MODEL BLEND|SEVERE|WINTER|ALMANAC|MAPS|EVENTS' && n.tabs.filter((x) => x.cur).map((x) => x.t).join() === 'EVENTS' && !n.menu, `desktop: the standard tab row, Events current (${n.tabs.map((x) => x.t + (x.cur ? '*' : '')).join(' ')})`);
      check(n.tabs.filter((x) => POINT.includes(pointOf(x.h).page)).every((x) => atVenue(x.h)) && n.tabs.find((x) => x.t === 'MAPS').h === 'maps.html' && n.tabs.find((x) => x.t === 'EVENTS').h === 'event-beta.html#upcoming', 'desktop: tools that take a forecast point open on the venue; Maps and Events unchanged');
      check(n.met.length === 1 && n.met[0].t === 'Meteorologist view' && pointOf(n.met[0].h).page === 'meteorologist-beta.html' && atVenue(n.met[0].h), `desktop: Meteorologist view is a separate, named action on the venue (${n.met.map((x) => x.t).join()})`);
      await p.screenshot({ path: path.join(out, 'nav-desktop.png') }); check(!errors.length, 'desktop: no page errors ' + errors.join('; ')); await ctx.close(); }
    /* phone: a labelled Forecast Ops menu with the same destinations, then Meteorologist view; rain case keeps Next check on screen */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: q(false) }); await p.waitForFunction(() => document.body.dataset.leadKind, null, { timeout: 25000 });
      const x = await texts(p), n = await p.evaluate(() => { const vis = (e) => e && e.offsetParent !== null, s = document.querySelector('.bx-sitemenu > summary');
        return { logo: document.querySelector('.bx-brand').getAttribute('href'), tabs: [...document.querySelectorAll('.bx-sitenav a')].filter(vis).length, summary: vis(s) ? s.getAttribute('aria-label') + '|' + s.innerText.replace(/\s+/g, ' ').trim() : null, metInHead: [...document.querySelectorAll('.bx-head-in > a.bx-metview')].filter(vis).length }; });
      check(n.summary === 'Forecast Ops menu|☰ Menu' && !n.tabs && !n.metInHead && atVenue(n.logo), `375×667: a labelled Forecast Ops menu instead of the tab row; the logo still opens Overview (${n.summary})`);
      check(x.nextBottom != null && x.nextBottom <= x.vh && !x.hscroll, `375×667 rain case: decision, callouts and next check on the first screen (next check ends at ${x.nextBottom} px)`);
      await p.click('.bx-sitemenu > summary'); await p.waitForTimeout(150);
      const m = await p.evaluate(() => [...document.querySelectorAll('.bx-sitemenu-pop a')].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href'), cur: a.getAttribute('aria-current'), b: Math.round(a.getBoundingClientRect().bottom), r: Math.round(a.getBoundingClientRect().right) })));
      check(m.map((a) => a.t).join('|') === 'OVERVIEW|THREATS|MODEL BLEND|SEVERE|WINTER|ALMANAC|MAPS|EVENTS|Meteorologist view' && m.find((a) => a.t === 'EVENTS').cur && m.every((a) => a.b <= 667 && a.r <= 375), `375×667 menu: the same destinations with Events current, then Meteorologist view, all on screen`);
      check(m.filter((a) => POINT.includes(pointOf(a.h).page) || a.t === 'Meteorologist view').every((a) => atVenue(a.h)), '375×667 menu: tools that take a forecast point open on the venue');
      await p.screenshot({ path: path.join(out, 'nav-phone-menu.png') });
      await p.keyboard.press('Escape'); check(!(await p.evaluate(() => document.getElementById('bxSiteMenu').open)), '375×667 menu: Escape closes it');
      check(!errors.length, '375×667: no page errors ' + errors.join('; ')); await ctx.close(); }
    /* phone with an active warning: the warning, its expiration and bulletin link stay on the first screen */
    { const { ctx, p } = await open(browser, srv, { fixture: 'event-slots-data.js', query: q(true) }); await p.waitForFunction(() => document.body.dataset.leadKind, null, { timeout: 25000 });
      const w = await p.evaluate(() => { const u = document.getElementById('leadUrgent'), a = u.querySelector('a'); return { t: u.innerText.replace(/\s+/g, ' '), b: Math.round(u.getBoundingClientRect().bottom), link: a ? Math.round(a.getBoundingClientRect().bottom) : null, href: a ? a.href : '' }; });
      check(/Flash Flood Warning in effect/.test(w.t) && /until/.test(w.t) && w.b <= 667 && w.link <= 667 && /weather\.gov/.test(w.href), `375×667 warning (synthetic): warning, expiration and bulletin link on the first screen (ends ${w.b} px)`); await ctx.close(); }
    /* the saved event is still there when returning through Events */
    { const rec = [{ id: 'ev_nav', name: 'Bengals home game', venueId: null, loc: PAYCOR, tz: 'America/New_York', times: ev.t, gust: 25, overrides: [], source: { kind: 'manual' }, created: 1, updated: 1 }];
      const { ctx, p } = await open(browser, srv, { fixture: 'event-slots-data.js', query: '?ev=ev_nav&wx=evening', store: rec });
      const href = await p.evaluate(() => document.querySelector('.bx-sitenav [data-nav=events], .bx-sitemenu [data-nav=events]').getAttribute('href'));
      await p.goto(`${srv.base}/${href}`); await p.waitForTimeout(800);
      const up = await p.evaluate(() => ({ view: document.body.dataset.view, text: (document.getElementById('upView') || {}).innerText || '' }));
      check(up.view === 'upcoming' && /Bengals home game/.test(up.text), `returning through Events opens Upcoming events with the saved event (${href})`); await ctx.close(); }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await browser.close(); srv.s.close();
  console.log(failed ? `${failed} navigation checks failed` : 'all navigation checks passed'); process.exit(failed ? 1 : 0);
})();
