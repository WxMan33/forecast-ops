#!/usr/bin/env node
/* Event Manager's "Next check": the operational check before gates (or the main slot / start), and the next model update
   on its own line. Weather is SYNTHETIC (tests/fixtures/event-slots-data.js), run through the real engines; schedules
   are invented. At 375 × 667 and on desktop.
   Cases: Bill's event (gates 4:30 PM, show 5 PM) with and without an active warning; the same event in two browsers
   holding different model run times (&meta=a|b); the missed checkpoint (4:10 PM, gates still closed: Check now); a
   single-window reception; a wedding's custom Outdoor ceremony slot; a multi-day festival, day by day.
   Usage: node tools/event-checkin-check.js [out-dir] [--before]   (--before: captures only, for the pre-fix build) */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const args = process.argv.slice(2), BEFORE = args.includes('--before'), out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(require('node:os').tmpdir(), 'event-checkin')); fs.mkdirSync(out, { recursive: true });
const here = path.resolve(__dirname, '..');
let failed = 0; const check = (ok, name) => { if (BEFORE) { console.log('INFO ' + name); return; } console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 }, DESK = { viewport: { width: 1280, height: 900 } };
const serve = (root) => new Promise((ok) => { const s = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
  s.listen(0, '127.0.0.1', () => ok({ s, base: 'http://127.0.0.1:' + s.address().port, root })); });
async function open(browser, srv, { query, device = PHONE, clock }) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message)); await p.clock.install({ time: new Date(clock) });
  await p.addInitScript(() => { localStorage.setItem('ops_theme', JSON.stringify('light')); localStorage.setItem('beta_analytics_optout', '1'); window.print = () => {}; });
  const fx = fs.readFileSync(path.join(here, 'tests/fixtures/event-slots-data.js'), 'utf8');
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== srv.base) return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: fx + '\n' + fs.readFileSync(path.join(srv.root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  await p.goto(`${srv.base}/event-beta.html${query}`);
  await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 25000 }); await p.waitForTimeout(600);
  return { ctx, p, errors };
}
const read = (p) => p.evaluate(() => { const dd = [...document.querySelectorAll('#keys dd')], last = dd[dd.length - 1], r = (e) => e && e.getBoundingClientRect(), alert = document.querySelector('.bx-alert, #alerts .bx-alert, [data-alert]');
  return { next: last ? last.innerText.replace(/\s+/g, ' ').trim() : '', op: (document.querySelector('#keys [data-op-check]') || {}).textContent || '', model: (() => { const m = document.querySelector('#modelNext'); return m && !m.hidden ? m.textContent : ''; })(),
    checkNow: !!document.querySelector('#keys [data-op-check="now"]'), nextBottom: last ? Math.round(r(last).bottom) : null, vh: innerHeight, hs: document.documentElement.scrollWidth > innerWidth + 1,
    alert: alert ? { text: alert.innerText.replace(/\s+/g, ' ').trim().slice(0, 80), top: Math.round(r(alert).top), bottom: Math.round(r(alert).bottom) } : null,
    checks: (document.getElementById('checks') || {}).textContent || '', print: (document.querySelector('.pv-nextcheck, .pv-lead-next') || {}).textContent || '' }; });
const E = (o) => '?e=' + encodeURIComponent(JSON.stringify({ v: { name: 'Riverfront park (synthetic), Cincinnati, OH', lat: 39.1, lon: -84.5 }, z: 'America/New_York', g: 25, ...o }));
const shot = async (p, name) => { await p.locator('#keys').screenshot({ path: path.join(out, `${name}-keys.png`) }).catch(() => {}); await p.screenshot({ path: path.join(out, `${name}-screen.png`) }); };
(async () => {
  const browser = await chromium.launch(), srv = await serve(here), CLOCK = '2026-11-25T14:00:00Z', D = '2026-11-26';
  const bill = E({ n: "Bill's riverfront show", t: { setup: `${D}T12:00`, gates: `${D}T16:30`, start: `${D}T17:00`, end: `${D}T22:00` } });
  try {
    for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
      /* Bill: gates 4:30 PM, show 5 PM -> 4:00 PM "Before gates open at 4:30 PM"; model update on its own line */
      { const { ctx, p, errors } = await open(browser, srv, { query: bill + '&wx=ceremony&meta=a', device, clock: CLOCK }), x = await read(p);
        check(/^Thu,? 4 PM EST in \d+ h/.test(x.next) && x.op === 'Before gates open at 4:30 PM' && /^Next model update: [A-Z][^(]+, [A-Z][a-z]{2},? \d/.test(x.model) && !/Before gates \/ start/.test(x.next + x.checks), `Bill ${dev}: Next check 4:00 PM, Before gates open at 4:30 PM; model update separate (${x.next})`);
        if (dev === 'phone') check(x.nextBottom <= x.vh && !x.hs, `Bill phone: Next check fits the first 375 × 667 screen (the model update is on its own line below) (bottom ${x.nextBottom} of ${x.vh})`);
        check(!errors.length, `Bill ${dev}: no page errors ${errors.join('; ')}`);
        await shot(p, `bill-${dev}`); await ctx.close(); }
      /* the same event and schedule in a browser with other model run times: same operational check, different model line */
      { const a = await open(browser, srv, { query: bill + '&wx=ceremony&meta=a', device, clock: CLOCK }), xa = await read(a.p); await a.ctx.close();
        const b = await open(browser, srv, { query: bill + '&wx=ceremony&meta=b', device, clock: CLOCK }), xb = await read(b.p); await b.ctx.close();
        check(xa.op === xb.op && xa.next === xb.next && xa.model !== xb.model, `Bill and Michael ${dev}: same operational check (${xa.op}); model update differs (${xa.model} | ${xb.model})`); }
      /* an active warning stays visible with the new wording */
      { const { ctx, p } = await open(browser, srv, { query: bill + '&wx=ceremony&meta=a&alerts=warn', device, clock: CLOCK }), x = await read(p);
        check(x.alert && x.alert.top >= 0 && x.alert.bottom <= x.vh && /Flash Flood Warning/.test(x.alert.text) && x.op === 'Before gates open at 4:30 PM', `Bill ${dev} with an active warning: the warning stays on the first screen (${x.alert && x.alert.bottom} of ${x.vh}) and Next check reads the same`);
        /* with a warning, Next check was already below the first phone screen before this change (715 px on beta at
           e0f9268); the warning has priority. Guard: the new model line adds at most one line (about 40 px). */
        if (dev === 'phone') check(x.nextBottom <= 715 + 40 && !x.hs, `Bill phone with a warning: Next check at ${x.nextBottom} px (715 before this change; at most one line more), no sideways scroll`);
        await shot(p, `bill-warning-${dev}`); await ctx.close(); }
      /* missed checkpoint: 4:10 PM on the day, gates still closed -> Check now */
      { const today = E({ n: "Bill's riverfront show", t: { setup: `2026-11-26T12:00`, gates: `2026-11-26T16:30`, start: `2026-11-26T17:00`, end: `2026-11-26T22:00` } });
        const { ctx, p, errors } = await open(browser, srv, { query: today + '&wx=dry&meta=a', device, clock: '2026-11-26T21:10:00Z' }), x = await read(p);
        check(x.checkNow && x.next === 'Check now Before gates open at 4:30 PM' && /^Next model update/.test(x.model) && !errors.length, `missed checkpoint ${dev} (4:10 PM, gates closed): ${x.next}`);
        /* on the event day the briefing above is longer and Next check was already below the first screen (884 px
           before this change). Guard: at most one line more. */
        if (dev === 'phone') check(x.nextBottom <= 884 + 40 && !x.hs, `missed checkpoint phone: Next check at ${x.nextBottom} px (884 before this change), no sideways scroll`);
        await shot(p, `missed-${dev}`); await ctx.close(); }
      /* a page left open: 3:59 PM -> 4:00 PM switches to Check now without a reload or a weather request; the selected
         forecast hour and the warning stay put; when the tab comes back after gates open, live monitoring replaces it */
      { const today = E({ n: "Bill's riverfront show", t: { setup: `2026-11-26T12:00`, gates: `2026-11-26T16:30`, start: `2026-11-26T17:00`, end: `2026-11-26T22:00` } });
        const { ctx, p, errors } = await open(browser, srv, { query: today + '&wx=dry&meta=a&alerts=warn', device, clock: '2026-11-26T20:59:00Z' });
        await p.evaluate(() => { window.__loads = 0; const o = BetaUI.load; BetaUI.load = async (...a) => { window.__loads++; return o(...a); }; window.__warn = document.querySelector('.bx-alert'); window.__lead = document.getElementById('decision'); });
        const sel0 = await p.evaluate(() => document.body.dataset.selected), x0 = await read(p);
        check(/^Thu,? 4 PM EST in 1 min Before gates open at 4:30 PM$/.test(x0.next), `left open ${dev}, 3:59 PM: ${x0.next}`);
        await p.clock.runFor(70e3); await p.waitForTimeout(300);
        const x1 = await read(p), same = await p.evaluate((s0) => ({ loads: window.__loads, sel: document.body.dataset.selected === s0, warn: !!window.__warn && window.__warn.isConnected && window.__warn === document.querySelector('.bx-alert'), lead: window.__lead === document.getElementById('decision') }), sel0);
        check(x1.checkNow && x1.next === 'Check now Before gates open at 4:30 PM', `left open ${dev}, 4:00:10 PM: switched to "${x1.next}"`);
        check(same.loads === 0 && same.sel && same.warn && same.lead && !errors.length, `left open ${dev}: no reload or weather request (${same.loads} loads), the selected forecast hour, the warning and the lead are the same elements ${errors.join('; ')}`);
        /* event day with a warning: the warning-first layout; Next check was at 981 px on beta at e0f9268 and must not move lower */
        if (dev === 'phone') check(x1.alert && x1.alert.bottom <= x1.vh && x1.nextBottom <= 981 && !x1.hs, `left open phone: the warning stays on the first screen (${x1.alert && x1.alert.bottom} px); Next check at ${x1.nextBottom} px (981 on beta)`);
        await shot(p, `left-open-checknow-${dev}`);
        /* the tab is hidden across the gate time and shown again at 4:35 PM */
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await p.clock.runFor(35 * 60e3);
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(300);
        const x2 = await read(p), loads2 = await p.evaluate(() => window.__loads);
        check(!x2.checkNow && x2.next === 'Now: use radar, lightning detection and NWS warnings.' && !/Before gates open/.test(x2.next), `tab shown again after gates open ${dev}: the pre-gates message is gone (${x2.next})`);
        check(loads2 === 0, `tab shown again ${dev}: still no weather request (${loads2})`);
        await ctx.close(); }
      /* the tab comes back into view past the checkpoint: Check now */
      { const today = E({ n: "Bill's riverfront show", t: { setup: `2026-11-26T12:00`, gates: `2026-11-26T16:30`, start: `2026-11-26T17:00`, end: `2026-11-26T22:00` } });
        const { ctx, p } = await open(browser, srv, { query: today + '&wx=dry&meta=a', device, clock: '2026-11-26T20:30:00Z' }), x0 = await read(p);
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await p.clock.runFor(40 * 60e3);
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(300);
        const x1 = await read(p);
        check(/Before gates open at 4:30 PM/.test(x0.next) && !x0.checkNow && x1.checkNow, `tab hidden 3:30 to 4:10 PM ${dev}: shown again it reads Check now (${x0.next} -> ${x1.next})`);
        await ctx.close(); }
      /* single-window reception, no gates */
      { const { ctx, p } = await open(browser, srv, { query: E({ n: 'Smith reception', t: { start: `${D}T18:00`, end: `${D}T22:00` }, s: [['Reception', `${D}T18:00`, `${D}T22:00`]] }) + '&wx=evening&meta=a', device, clock: CLOCK }), x = await read(p);
        check(/^Thu,? 5:30 PM EST/.test(x.next) && x.op === 'Before Reception at 6 PM', `single-window reception ${dev}: ${x.next}`); await shot(p, `reception-${dev}`); await ctx.close(); }
      /* custom ceremony slot */
      { const w = E({ n: 'Garden wedding', t: { start: `${D}T13:00`, end: `${D}T22:00` }, s: [['Vendor setup', `${D}T13:00`, `${D}T15:00`], ['Outdoor ceremony', `${D}T16:00`, `${D}T16:30`, { m: 1 }], ['Reception', `${D}T17:00`, `${D}T22:00`]] });
        const { ctx, p } = await open(browser, srv, { query: w + '&wx=ceremony&meta=a', device, clock: CLOCK }), x = await read(p);
        check(/^Thu,? 3:30 PM EST/.test(x.next) && x.op === 'Before Outdoor ceremony at 4 PM', `custom ceremony slot ${dev}: ${x.next}`); await shot(p, `ceremony-${dev}`); await ctx.close(); }
      /* multi-day festival: each day's own schedule */
      { const fest = E({ n: 'Riverside weekend festival', t: { start: '2026-11-27T17:00', end: '2026-11-29T18:00' }, s: [['Friday set', '2026-11-27T17:00', '2026-11-27T23:00'], ['Main day', '2026-11-28T10:00', '2026-11-28T23:00', { m: 1 }], ['Closing day', '2026-11-29T10:00', '2026-11-29T18:00']] });
        const { ctx, p } = await open(browser, srv, { query: fest + '&wx=festival&meta=a', device, clock: CLOCK }), seen = {};
        for (const d of ['2026-11-27', '2026-11-28']) { if (!BEFORE) { await p.click(`#dayPick [data-day="${d}"]`).catch(() => {}); await p.waitForFunction((d) => document.body.dataset.day === d && document.body.dataset.loaded, d, { timeout: 25000 }).catch(() => {}); await p.waitForTimeout(500); }
          seen[d] = await read(p); }
        check(/^Fri,? 4:30 PM EST/.test(seen['2026-11-27'].next) && seen['2026-11-27'].op === 'Before Friday set at 5 PM', `multi-day ${dev}, Friday: ${seen['2026-11-27'].next}`);
        check(/^Sat,? 9:30 AM EST/.test(seen['2026-11-28'].next) && seen['2026-11-28'].op === 'Before Main day at 10 AM', `multi-day ${dev}, Saturday: ${seen['2026-11-28'].next}`);
        await shot(p, `festival-sat-${dev}`); await ctx.close(); }
    }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await browser.close(); srv.s.close();
  if (!BEFORE) { console.log(failed ? `${failed} check-in checks failed` : 'all check-in checks passed'); process.exit(failed ? 1 : 0); }
})();
