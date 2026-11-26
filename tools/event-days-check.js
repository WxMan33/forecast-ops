#!/usr/bin/env node
/* Multi-day events, one day at a time (EventDays) on the Event Manager page, at 375 × 667 and on desktop.
   Weather is SYNTHETIC (tests/fixtures/event-slots-data.js, wx=festival: a shower Saturday 1 to 3 PM; the guidance ends
   Saturday night, so Sunday has none yet) run through the real engines. Not a forecast.
   Usage: node tools/event-days-check.js [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const args = process.argv.slice(2), ci = args.indexOf('--compare'), other = ci >= 0 ? path.resolve(args[ci + 1]) : null;
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && (ci < 0 || i !== ci + 1)) || path.join(require('node:os').tmpdir(), 'event-days')); fs.mkdirSync(out, { recursive: true });
const here = path.resolve(__dirname, '..');
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 };
const CLOCK = '2026-11-25T14:00:00Z', TOMORROW = '2026-11-26';
const serve = (root) => new Promise((ok) => { const s = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
  s.listen(0, '127.0.0.1', () => ok({ s, base: 'http://127.0.0.1:' + s.address().port, root })); });

async function open(browser, srv, { fixture, query = '', store = null, device = PHONE, clock = CLOCK }) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.install({ time: new Date(clock) });
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
const fest = '?wx=festival&e=' + encodeURIComponent(JSON.stringify({ n: 'Riverside weekend festival', v: { name: 'Riverfront park (synthetic), Cincinnati, OH', lat: 39.1, lon: -84.5 }, z: 'America/New_York',
  t: { start: '2026-11-27T17:00', end: '2026-11-29T18:00' }, g: 25, s: [['Friday set', '2026-11-27T17:00', '2026-11-27T23:00'], ['Main day', '2026-11-28T10:00', '2026-11-28T23:00', { m: 1 }], ['Closing day', '2026-11-29T10:00', '2026-11-29T18:00']] }));
const picker = (p) => p.evaluate(() => ({ on: document.body.dataset.day, head: (document.querySelector('#dayPick .ev-days-h') || {}).innerText || '', hidden: document.getElementById('dayPick').hidden,
  allLink: (document.querySelector('#dayPick .ev-days-h [data-day=all]') || {}).textContent || null, days: [...document.querySelectorAll('#dayPick .ev-day[data-day]')].map((b) => ({ day: b.dataset.day, on: b.getAttribute('aria-pressed') === 'true', state: b.dataset.state, tier: b.dataset.tier || null, text: b.innerText.replace(/\s+/g, ' ').trim() })),
  bottom: Math.round(document.getElementById('dayPick').getBoundingClientRect().bottom), search: location.search }));
const pick = async (p, d) => { await p.click(`#dayPick [data-day="${d}"]`); await p.waitForFunction((d) => document.body.dataset.day === d && document.body.dataset.loaded && document.body.dataset.leadKind, d, { timeout: 25000 }).catch(() => {});
  await p.waitForFunction((d) => document.body.dataset.day === d && document.body.dataset.loaded, d, { timeout: 25000 }); await p.waitForTimeout(400); };
(async () => {
  const browser = await chromium.launch(), srv = await serve(here);
  try {
    for (const [dev, device] of [['phone', PHONE], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
      const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: fest, device }), L = `festival (${dev}):`;
      await p.waitForFunction(() => document.body.dataset.leadKind, null, { timeout: 25000 }).catch(() => {});
      let k = await picker(p), x = await texts(p);
      check(!k.hidden && k.on === '2026-11-27' && /^Day 1 of 3/.test(k.head), `${L} opens on the next scheduled day, Friday (${k.on}; "${k.head}")`);
      check(k.days.map((d) => d.day).join() === '2026-11-27,2026-11-28,2026-11-29' && k.allLink === 'All days', `${L} one button per day, and All days beside "Day 1 of 3" (${k.days.map((d) => d.day).join(', ')}; ${k.allLink})`);
      const [fri, sat, sun] = k.days;
      check(/^Fri, Nov 27 5–11 PM No concern found$/.test(fri.text) && fri.on, `${L} Friday: its hours and no concern (${fri.text})`);
      check(/^Sat, Nov 28 10 AM–11 PM Rain: plan for it 1–3 PM$/.test(sat.text) && sat.state === 'concern' && !!sat.tier, `${L} Saturday: the concern with its level and hours, coloured by tier (${sat.text})`);
      check(/^Sun, Nov 29 10 AM–6 PM Not in the hourly forecast yet$/.test(sun.text) && sun.state === 'pending' && !/no concern/i.test(sun.text), `${L} Sunday: beyond the guidance, stated as such, never "no concern" (${sun.text})`);
      check(/Fri, Nov 27, 2026 · 5 PM – 11 PM EST/.test(x.when) && /No weather concern/.test(x.decision) && /Next check/.test(x.keys), `${L} Friday's briefing: its own window, decision and next check (${x.when} · ${x.decision})`);
      check(/Checked Friday set, 5–11 PM: no weather change needed/.test(x.lead) && !/Friday set through/.test(x.lead), `${L} one slot is named once in the lead (${x.lead.slice(0, 70)})`);
      check(x.glance === 'Friday set · 5–11 PM', `${L} At a glance headed by Friday's slot (${x.glance})`);
      if (dev === 'phone') { check(!x.hscroll, `${L} no sideways page scroll at 375 px`); await p.screenshot({ path: path.join(out, 'days-phone-friday.png') }); }

      await pick(p, '2026-11-28'); k = await picker(p); x = await texts(p);
      check(k.on === '2026-11-28' && /^Day 2 of 3/.test(k.head) && /day=2026-11-28/.test(k.search), `${L} choosing Saturday briefs Saturday and keeps it in the address (${k.search.slice(-15)})`);
      check(/the Main day/.test(x.decision) && /rain/i.test(x.decision) && /Sat 1–3 PM/.test(x.lead), `${L} Saturday: the concern, its hours and the affected slot (${x.decision} · ${x.lead.slice(0, 60)})`);
      check(/Next check/.test(x.keys), `${L} Saturday has its own next check`);
      const tile = await p.evaluate(() => (document.querySelector('[data-tile=rain]') || {}).innerText || '');
      check(/0\.20/.test(tile) && /Over the Main day/.test(tile), `${L} Saturday's rain total covers Saturday's slot only (${tile.replace(/\s+/g, ' ').slice(0, 60)})`);
      const span = await p.evaluate(() => { const c = [...document.querySelectorAll('#evGrid [data-ms], #evGrid th')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean); return { first: c[0] || '', all: c.join(' | ') }; });
      check(!/11 PM.*Fri|Fri.*1[01] PM/.test(span.all.slice(0, 40)) && !/\b(1|2|3|4|5|6|7|8) AM\b/.test(span.all.split('|').slice(0, 3).join(' ')), `${L} Saturday's hour by hour starts at Saturday's slot, not Friday night (${span.all.slice(0, 80)})`);
      if (dev === 'phone') { await p.screenshot({ path: path.join(out, 'days-phone-saturday.png') }); await p.locator('#dayPick').screenshot({ path: path.join(out, 'days-phone-picker.png') }); }
      if (dev === 'desktop') {
        const P = await pdf(p, path.join(out, 'days-saturday.pdf'));
        check(P.pages === 2, `${L} Saturday prints two US Letter pages (${P.pages})`);
        const title = await p.evaluate(() => (document.querySelector('#printView .pv-p1 .pv-title') || {}).textContent || '');
        check(title === 'Riverside weekend festival · Sat, Nov 28' && /Main day/.test(P.p1) && !/Friday set|Closing day/.test(P.p1), `${L} the printout is Saturday's: titled with the day (${title}), its slot only`);
        check(/Hours shown: Sat, Nov 28, 2026 · 10 AM – Sun, Nov 29, 2026 · 12 AM/.test(P.p2) && !/Fri, Nov 27/.test(P.p2) && (P.p2.match(/Sun, Nov 29/g) || []).length === 1, `${L} page 2's hours are Saturday's, 10 AM to midnight (the 11 PM hour ends at 12 AM)`);
      }

      await pick(p, '2026-11-29'); x = await texts(p);
      check(/pending/i.test(x.decision) && !/No weather concern/.test(x.decision), `${L} Sunday: briefing pending, never "no concern" (${x.decision})`);
      { const cov = await p.evaluate(() => { const c = document.getElementById('coverage'), o = document.getElementById('outlook'); return (c.hidden ? '' : c.innerText) + ' ' + (o.hidden ? '' : o.innerText); });
        /* the coverage note, or the early outlook that takes its place, says when hourly guidance reaches the day, naming its slot */
        check(/Hourly guidance (doesn’t reach this event yet|should reach the Closing day around)/.test(cov) && !/reach setup/.test(cov), `${L} Sunday: the coverage gap is stated, naming the day's slot (${cov.replace(/\s+/g, ' ').trim().slice(0, 140)})`); }

      await pick(p, 'all'); k = await picker(p); x = await texts(p);
      check(/^All 3 days/.test(k.head) && /day=all/.test(k.search) && !k.days.some((d) => d.on) && !k.allLink, `${L} All days: the whole event as one briefing, no single day selected (${k.head})`);
      check(/Fri, Nov 27, 2026/.test(x.when) && /Sun, Nov 29/.test(x.when), `${L} All days covers Friday through Sunday (${x.when})`);
      check(!errors.length, `${L} no page errors ${errors.join('; ')}`);
      await ctx.close();
    }
    /* an address with ?day= opens that day; a single-day event shows no picker */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: fest + '&day=2026-11-28' }); const k = await picker(p);
      check(k.on === '2026-11-28', `a link with day=2026-11-28 opens Saturday (${k.on})`); check(!errors.length, 'no page errors'); await ctx.close(); }
    { const one = '?wx=ceremony&e=' + encodeURIComponent(JSON.stringify({ n: 'Wedding', v: { name: 'Garden venue (synthetic), Cincinnati, OH', lat: 39.12, lon: -84.45 }, z: 'America/New_York', t: { start: '2026-11-26T13:00', end: '2026-11-26T22:00' }, g: 25,
        s: [['Vendor setup', '2026-11-26T13:00', '2026-11-26T15:00'], ['Outdoor ceremony', '2026-11-26T16:00', '2026-11-26T16:30', { m: 1 }], ['Reception', '2026-11-26T17:00', '2026-11-26T22:00']] }));
      const { ctx, p } = await open(browser, srv, { fixture: 'event-slots-data.js', query: one }); const k = await picker(p);
      check(k.hidden && !k.days.length && !k.on, 'a single-day event shows no day picker and is briefed as before'); await ctx.close(); }
    /* an older stadium-style event over three days (setup Thursday to teardown Saturday night): split by day */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-polish-data.js', query: '?long=1', device: { viewport: { width: 1280, height: 900 } }, clock: '2026-11-11T20:30:00Z' }); const k = await picker(p), x = await texts(p);
      check(k.days.length === 3 && k.on === k.days[0].day && /Setup|Gates|Event/.test(x.schedule) && !k.hidden, `three-day stadium-style event: three days, opening on the first (${k.days.map((d) => d.text.slice(0, 22)).join(' / ')}; schedule ${x.schedule.slice(0, 60)})`);
      check(!errors.length, `three-day stadium-style event: no page errors ${errors.join('; ')}`); await ctx.close(); }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await browser.close(); srv.s.close();
  console.log(failed ? `${failed} day checks failed` : 'all day checks passed'); process.exit(failed ? 1 : 0);
})();
