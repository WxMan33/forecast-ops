#!/usr/bin/env node
/* Offline check of the Event Manager "Early weather outlook" on the Thanksgiving Day Race review case
   (tests/fixtures/event-outlook-data.js): no hourly coverage, partial coverage, full coverage, and beyond the
   10-day daily outlook. Real page and engines; synthetic data; fixed clocks. Phone and desktop screenshots.
   Usage: node tools/event-outlook-check.js [screenshot-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-outlook')); fs.mkdirSync(out, { recursive: true });
const FIX = fs.readFileSync(path.join(root, 'tests/fixtures/event-outlook-data.js'), 'utf8');
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res); });
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

async function open(browser, base, cov, clock, device) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.install({ time: new Date(clock) });
  await p.addInitScript(() => { localStorage.setItem('ops_theme', JSON.stringify('light')); localStorage.setItem('beta_analytics_optout', '1'); });
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== base) return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: FIX + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  await p.goto(`${base}/event-beta.html?cov=${cov}`);
  await p.waitForFunction(() => document.body.dataset.readiness && document.body.dataset.readiness !== '', null, { timeout: 20000 });
  await p.waitForTimeout(600);
  return { ctx, p, errors };
}
const facts = (p) => p.evaluate(() => {
  const o = document.getElementById('outlook'), t = (sel) => [...document.querySelectorAll(sel)].map((e) => (e.innerText ?? e.textContent).replace(/\s+/g, ' ').trim());
  return { readiness: document.body.dataset.readiness, outlook: document.body.dataset.outlook || null, shown: !o.hidden && !!o.innerText.trim(), text: o.innerText.replace(/\s+/g, ' '),
    days: t('#outlook .ev-ol-day'), pops: t('#outlook [data-ol-pop]'), types: [...document.querySelectorAll('#outlook [data-ol-type]')].map((e) => e.dataset.olType),
    remind: !!document.querySelector('#outlook [data-remind], #coverage:not([hidden]) [data-remind]'), reminders: document.querySelectorAll('[data-remind]').length, coverage: document.getElementById('coverage').hidden ? '' : document.getElementById('coverage').innerText.replace(/\s+/g, ' '),
    decision: document.getElementById('decision').innerText, charts: document.querySelectorAll('#evCharts .evc-card').length, beyondLabels: t('#evCharts [data-beyond]'),
    gaps: document.querySelectorAll('#evCharts .evc-gap').length, calls: window.__outlookCalls };
});

(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
      /* 1. no hourly coverage (one week out): the outlook stands in for the pending briefing */
      let { ctx, p, errors } = await open(browser, base, 'none', '2026-11-18T23:00:00Z', device), f = await facts(p); // 7 days of hourly guidance, as the page loads
      check(f.readiness === 'pending' && f.outlook === 'outlook' && f.shown && f.days.length === 1 && /Thu, Nov 26/.test(f.days[0]), `${dev} none: pending briefing shows the early outlook for Thu, Nov 26 (${f.outlook})`);
      check(/A lot can change this far out/.test(f.text) && /High \/ low \d+° \/ \d+°/.test(f.days[0]) && /^\d+%$/.test(f.pops[0]) && /whole day, midnight to midnight/.test(f.text), `${dev} none: high/low and the day's precipitation chance, with the period labelled (${f.days[0].slice(0, 120)})`);
      check(f.types[0] === 'mix', `${dev} none: likely type from the day's own snowfall vs precipitation: ${f.types[0]}`);
      check(f.reminders === 2, `${dev} none: one reminder (Google + .ics), not two (${f.reminders} links)`);
      check(/reach setup around Thu, Nov 19, about 2 AM EST/.test(f.text) && /whole event around Thu, Nov 19, about 9 AM EST/.test(f.text) && /whole event around/.test(f.text) && f.remind, `${dev} none: venue-local times for setup and the whole event; calendar reminder kept`);
      check(!/7:30/.test(f.text) && f.charts === 0, `${dev} none: nothing claims start-time weather; no hourly charts`);
      await p.screenshot({ path: path.join(out, `outlook-none-${dev}.png`), fullPage: dev === 'phone' });
      check(!errors.length, `${dev} none: no script errors ${errors.join('; ')}`); await ctx.close();
      /* 2. partial coverage: hourly guidance to 8 AM on race day */
      ({ ctx, p, errors } = await open(browser, base, 'partial', '2026-11-19T15:00:00Z', device)); f = await facts(p);
      await p.evaluate(() => { document.getElementById('secHourly').open = true; }); await p.waitForTimeout(300); const f2 = await facts(p);
      check(f.readiness === 'partial' && f.outlook === 'outlook' && f.shown && /rest of the event should come into hourly range around/.test(f.text) && /Hours already in range are in Hour by hour/.test(f.text), `${dev} partial: outlook for the uncovered part, with when the rest comes into range`);
      check(f2.charts === 4 && f2.beyondLabels.length >= 1, `${dev} partial: hourly charts keep the covered hours; uncovered hours are blank and labelled (${f2.beyondLabels[0] || ''})`);
      check(/partly covered|pending/.test(f.coverage), `${dev} partial: the coverage line still says what is covered (${f.coverage.slice(0, 90)})`);
      await p.screenshot({ path: path.join(out, `outlook-partial-${dev}.png`), fullPage: dev === 'phone' });
      check(!errors.length, `${dev} partial: no script errors ${errors.join('; ')}`); await ctx.close();
      /* 3. full coverage: no outlook, no extra request */
      ({ ctx, p, errors } = await open(browser, base, 'full', '2026-11-19T15:00:00Z', device)); f = await facts(p);
      check(f.readiness === 'ready' && !f.shown && !f.outlook && f.calls === 0, `${dev} full: the full hourly briefing, no outlook, no outlook request (${f.calls})`);
      check(!errors.length, `${dev} full: no script errors ${errors.join('; ')}`); await ctx.close();
      /* 4. beyond the 10-day daily outlook: no numbers, when the outlook and briefing start, reminder kept */
      ({ ctx, p, errors } = await open(browser, base, 'none', '2026-11-08T15:00:00Z', device)); f = await facts(p);
      check(f.readiness === 'pending' && f.outlook === 'beyond' && f.shown && f.pops.length === 0 && /past the 10-day outlook/.test(f.text) && /A lot can change this far out/.test(f.text), `${dev} beyond: no numbers; says it is past the 10-day outlook`);
      check(/daily outlook should start covering it around Tue, Nov 17/.test(f.text) && /reach setup around/.test(f.text) && f.remind && f.calls === 0, `${dev} beyond: when the outlook (Nov 17) and the hourly briefing start; reminder kept; no request (${f.calls})`);
      await p.screenshot({ path: path.join(out, `outlook-beyond-${dev}.png`), fullPage: dev === 'phone' });
      check(!errors.length, `${dev} beyond: no script errors ${errors.join('; ')}`); await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all early outlook checks passed'); process.exit(failed ? 1 : 0);
})();
