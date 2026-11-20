#!/usr/bin/env node
/* Offline check of the Event Manager Daylight row: the Thanksgiving Day Race at TQL Stadium (review schedule) while
   the forecast is pending or unavailable; an event that crosses sunset with a full briefing (row, page 1 of the
   two-page PDF, TV PNG); an overnight event; a daylight-saving change date. Synthetic weather
   (tests/fixtures/event-winter-data.js); real page; sun times from the Almanac's NOAA calculation.
   Usage: node tools/event-daylight-check.js [screenshot-dir]   (needs pdftotext) */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-daylight')); fs.mkdirSync(out, { recursive: true });
const FIX = fs.readFileSync(path.join(root, 'tests/fixtures/event-winter-data.js'), 'utf8');
const A = require('../assets/almanac-core.js'), Cc = require('../assets/ops-core.js'), DL = require('../assets/event-daylight.js');
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res); });
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
const NY = 'America/New_York', TQL = { name: 'TQL Stadium, Cincinnati, OH', lat: 39.1113, lon: -84.5222 };
const dayNY = (d) => new Date(Date.now() + d * 864e5).toLocaleDateString('en-CA', { timeZone: NY });
const ev = (id, name, times, extra = {}) => ({ id, name, venueId: null, loc: TQL, tz: NY, times, gust: 25, overrides: [], source: { kind: 'manual' }, created: 1, updated: 1, ...extra });
const RACE = ev('ev_dl_race', 'Thanksgiving Day Race', { setup: '2026-11-26T05:00', gates: '2026-11-26T06:30', start: '2026-11-26T07:30', end: '2026-11-26T10:30', teardown: '2026-11-26T12:00' });
const t1 = dayNY(1), DUSK = ev('ev_dl_dusk', 'Synthetic Evening Match', { setup: `${t1}T13:00`, gates: `${t1}T15:30`, start: `${t1}T17:00`, end: `${t1}T19:00`, teardown: `${t1}T21:00` });
const NIGHT = ev('ev_dl_night', 'Synthetic Overnight Shift', { setup: '2026-12-31T18:00', start: '2026-12-31T21:00', end: '2027-01-01T01:00', teardown: '2027-01-01T08:30' });
const DST = ev('ev_dl_dst', 'Synthetic Spring Race', { setup: '2027-03-14T06:00', start: '2027-03-14T08:00', end: '2027-03-14T11:00', teardown: '2027-03-14T12:00' });
const expect = (e) => DL.compute({ A, C: Cc, windows: Cc.event.windows(e), lat: e.loc.lat, lon: e.loc.lon, tz: e.tz });

async function open(browser, device, e, { fixture = false } = {}) {
  const ctx = await browser.newContext({ ...device, timezoneId: NY, acceptDownloads: true }), errors = [];
  await ctx.addInitScript((s) => { localStorage.setItem('beta_analytics_optout', '1'); localStorage.setItem('ops_theme', JSON.stringify('light')); localStorage.setItem('beta_events_v2', s); }, JSON.stringify([e]));
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname !== '127.0.0.1') return r.fulfill({ status: 503, body: '' });
    if (fixture && u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: FIX + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  const p = await ctx.newPage(); p.on('pageerror', (x) => errors.push(x.message));
  return { ctx, p, errors };
}
const row = (p) => p.evaluate(() => { const el = document.querySelector('#daylight .ev-daylight'), sec = document.getElementById('secTimeline'), r = el && el.getBoundingClientRect();
  return { shown: !!el && !sec.hidden && r.height > 0, text: el ? el.innerText.replace(/\s+/g, ' ').trim() : '', note: (document.querySelector('#daylight [data-daylight-note]') || {}).textContent || '',
    dates: [...document.querySelectorAll('#daylight .ev-dl-date')].map((x) => x.textContent), rise: [...document.querySelectorAll('#daylight [data-sunrise]')].map((x) => x.textContent), set: [...document.querySelectorAll('#daylight [data-sunset]')].map((x) => x.textContent),
    fits: !el || el.scrollWidth <= el.clientWidth + 1, above: el && document.getElementById('schedule').getBoundingClientRect().top >= r.top, decision: document.getElementById('decision').innerText }; });

(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    /* 1. the review case: shown at once, before (and without) any forecast */
    const xr = expect(RACE);
    for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
      const { ctx, p, errors } = await open(browser, device, RACE); await p.goto(`${base}/event-beta.html?ev=${RACE.id}`); await p.waitForFunction(() => document.querySelector('#daylight .ev-daylight'), null, { timeout: 15000 });
      const f = await row(p);
      check(f.shown && f.dates.join() === 'Thu, Nov 26' && f.rise.join() === '7:33 AM' && f.set.join() === '5:17 PM' && /times EST/.test(f.text) && f.fits, `${dev} race: "${f.text}" beside the Event schedule, with no forecast yet ("${f.decision.slice(0, 40)}")`);
      check(f.note === xr.note && f.note === 'Setup starts before sunrise (7:33 AM).' && f.above, `${dev} race: one note: "${f.note}"`);
      await p.locator('#secTimeline').screenshot({ path: path.join(out, `daylight-race-${dev}.png`) });
      if (dev === 'phone') await p.screenshot({ path: path.join(out, 'daylight-race-phone-page.png') });
      check(!errors.length, `${dev} race: no script errors ${errors.join('; ')}`); await ctx.close();
    }
    /* 2. crosses sunset, full synthetic briefing: row, PDF page 1, TV PNG */
    { const xd = expect(DUSK), { ctx, p, errors } = await open(browser, DESK, DUSK, { fixture: true });
      await p.goto(`${base}/event-beta.html?ev=${DUSK.id}`); await p.waitForFunction(() => document.body.dataset.loaded && !document.getElementById('shareImage').disabled, null, { timeout: 20000 }); await p.waitForTimeout(500);
      const f = await row(p);
      check(f.shown && /^Sunset during (setup|gates|the event)/.test(f.note) && f.note === xd.note && f.set.join() === xd.hm(xd.days[0].set), `crosses sunset: "${f.text}" · "${f.note}" (ready briefing)`);
      await p.locator('#secTimeline').screenshot({ path: path.join(out, 'daylight-dusk-desktop.png') });
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#shareMenu > summary').then(() => p.click('#shareImage'))]);
      const png = path.join(out, 'daylight-dusk-tv.png'); await dl.saveAs(png);
      const tv = await p.evaluate(() => { const c = window.EventTvExport.draw(document.createElement('canvas'), window.__lastHourly); return { at: c.daylight, min: c.minFontPx, w: c.width, h: c.height, note: window.__lastHourly.daylight }; });
      const plain = await p.evaluate(() => { const c = window.EventTvExport.draw(document.createElement('canvas'), { ...window.__lastHourly, daylight: '' }); return { at: c.daylight, min: c.minFontPx }; });
      check(tv.w === 1920 && tv.h === 1080 && tv.note === xd.note && ['header', 'footer'].includes(tv.at) && tv.min === plain.min && plain.at === 'none', `TV PNG: daylight note drawn in the ${tv.at}, smallest text ${tv.min}px as without it (${plain.min}px); 1920 × 1080`);
      const long = await p.evaluate(() => window.EventTvExport.draw(document.createElement('canvas'), { ...window.__lastHourly, takeaway: 'W'.repeat(80), daylight: 'Sunset during the event (5:20 PM). '.repeat(4) }).daylight);
      check(long === 'omitted', `TV PNG: a note that doesn't fit is left out rather than shrinking anything (${long})`);
      await p.emulateMedia({ media: 'print' }); await p.setViewportSize({ width: Math.round(7.4 * 96), height: 1056 }); await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      const pdfPath = path.join(out, 'daylight-dusk-briefing.pdf'); await p.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
      const pages = +execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)[1], p1 = execFileSync('pdftotext', ['-layout', '-f', '1', '-l', '1', pdfPath, '-'], { encoding: 'utf8' }), p2 = execFileSync('pdftotext', ['-layout', '-f', '2', '-l', '2', pdfPath, '-'], { encoding: 'utf8' });
      const line = (p1.split('\n').find((l) => /Daylight/.test(l)) || '').trim();
      check(pages === 2 && /Daylight/.test(p1) && p1.includes(`Sunset ${xd.hm(xd.days[0].set)}`) && p1.includes(xd.note.replace(/\.$/, '')) && !/Daylight/.test(p2), `PDF: still two pages; page 1 has "${line}"`);
      check(!errors.length, `crosses sunset: no script errors ${errors.join('; ')}`); await ctx.close(); }
    /* 3. overnight and 4. a daylight-saving change date (both pending: no forecast reaches them) */
    for (const [what, e] of [['overnight', NIGHT], ['spring-forward date', DST]]) {
      const x = expect(e), { ctx, p, errors } = await open(browser, PHONE, e); await p.goto(`${base}/event-beta.html?ev=${e.id}`); await p.waitForFunction(() => document.querySelector('#daylight .ev-daylight'), null, { timeout: 15000 });
      const f = await row(p);
      check(f.shown && JSON.stringify(f.rise) === JSON.stringify(x.shown.map((d) => x.hm(d.rise))) && JSON.stringify(f.set) === JSON.stringify(x.shown.map((d) => x.hm(d.set))) && f.dates.length === x.shown.length && f.note === x.note && f.fits,
        `${what}: "${f.text}"${f.note ? ` · "${f.note}"` : ''}`);
      if (what === 'overnight') check(f.dates.join() === 'Thu, Dec 31,Fri, Jan 1' && /after sunset/.test(f.note) && /sunrise during teardown/.test(f.note), 'overnight: both dates labelled; sunset before the start and sunrise during teardown in one note');
      else check(/times EDT/.test(f.text) && f.rise.join() === '7:51 AM', 'spring-forward date (Mar 14, 2027): EDT, sunrise 7:51 AM');
      await p.locator('#secTimeline').screenshot({ path: path.join(out, `daylight-${what.split(' ')[0]}-phone.png`) });
      check(!errors.length, `${what}: no script errors ${errors.join('; ')}`); await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all daylight checks passed'); process.exit(failed ? 1 : 0);
})();
