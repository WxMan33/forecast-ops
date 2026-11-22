#!/usr/bin/env node
/* Offline check of Event Manager sharing (Phase 1): a local event address opened in a browser without that event, the
   Share menu, and both copied links opened in a separate, clean browser (no storage, no sign-in). Synthetic weather
   (tests/fixtures/event-winter-data.js); real page. Usage: node tools/event-share-check.js [screenshot-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-share')); fs.mkdirSync(out, { recursive: true });
const FIX = fs.readFileSync(path.join(root, 'tests/fixtures/event-winter-data.js'), 'utf8');
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res); });
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
/* a saved event in the sender's browser; its start happens twice that night (clocks fall back) and the second is meant */
const SAVED = { id: 'ev_share_test', name: 'FC Cincinnati evening match', venueId: null, loc: { name: 'TQL Stadium, Cincinnati, OH', lat: 39.1113, lon: -84.5222 }, tz: 'America/New_York',
  times: { setup: '2027-11-07T00:30', start: '2027-11-07T01:30', end: '2027-11-07T03:00' }, fold: { start: 1 }, gust: 25, overrides: [], source: { kind: 'manual' }, created: 1, updated: 1 };

async function browserCtx(browser, device, { fixture = true, seed = null } = {}) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'America/New_York', permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true }), errors = [], external = [];
  await ctx.addInitScript((seed) => { localStorage.setItem('beta_analytics_optout', '1'); if (seed && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('beta_events_v2', seed); } }, seed ? JSON.stringify([seed]) : null);
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname !== '127.0.0.1') { external.push(u.hostname); return r.fulfill({ status: 200, body: '' }); }
    if (fixture && u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: FIX + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  return { ctx, errors, external };
}
const windowsOf = (p) => p.evaluate(() => { const C = window.Ops.Core, q = new URLSearchParams(location.search), id = q.get('ev');
  const ev = id ? window.EventStore.getEvent(id) : window.BetaStory.eventFromParam(q.get('e'), C); return ev ? C.event.windows(ev).map((w) => [w.key, w.startMs, w.endMs]) : null; });

(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
      /* 1. a local address in a browser that doesn't have the event: says so; no sample, no weather requests */
      { const { ctx, errors, external } = await browserCtx(browser, device, { fixture: false }), p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
        await p.goto(`${base}/event-beta.html?ev=ev_1732000000000_abc`); await p.waitForTimeout(1500);
        const f = await p.evaluate(() => ({ dec: document.getElementById('decision').innerText, name: document.getElementById('evName').innerText, keys: document.getElementById('coverage').innerText.replace(/\s+/g, ' '),
          missing: document.body.dataset.missing, share: document.getElementById('shareMenu').hidden, edit: document.getElementById('editBtn').hidden, sample: /Riverfront|sample/i.test(document.getElementById('evName').innerText), url: location.search }));
        check(/This event isn’t saved in this browser/.test(f.dec) && f.missing === '1' && !f.sample && f.name === 'Event not found', `${dev}: an unknown ?ev= address says "${f.dec}", not a different event`);
        check(/Share/.test(f.keys) && /Copy event link/.test(f.keys) && /Upcoming events/.test(f.keys) && /Workspace → Import workspace/.test(f.keys), `${dev}: tells the viewer to ask for the Share link or import a workspace backup`);
        check(f.share && f.edit && f.url === '?ev=ev_1732000000000_abc' && !external.some((h) => /open-meteo|weather\.gov/.test(h)), `${dev}: no Share or Edit for a missing event; no weather requested; address unchanged`);
        await p.screenshot({ path: path.join(out, `share-missing-${dev}.png`) });
        await p.click('#resetBtn'); await p.waitForTimeout(1500);
        check(/Open the sample event instead/.test('Open the sample event instead') && !(await p.evaluate(() => document.body.dataset.missing)), `${dev}: "Open the sample event instead" is a choice the viewer makes`);
        check(!errors.length, `${dev} missing: no script errors ${errors.join('; ')}`); await ctx.close(); }
      /* 2. the sender's saved event: short local address; Share menu explains links vs image; copy both links */
      const { ctx, errors } = await browserCtx(browser, device, { seed: SAVED }), p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${base}/event-beta.html?ev=${SAVED.id}`); await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 }); await p.waitForTimeout(500);
      const addr = await p.evaluate(() => location.search), sender = await windowsOf(p);
      check(addr === `?ev=${SAVED.id}`, `${dev}: opening a saved event keeps the short local address (${addr})`);
      await p.click('#shareMenu > summary'); await p.waitForTimeout(200);
      const menu = await p.evaluate(() => { const pop = document.querySelector('.ev-sharepop'), r = pop.getBoundingClientRect(); return { text: pop.innerText.replace(/\s+/g, ' '), fits: r.left >= 0 && r.right <= innerWidth + 1, buttons: [...pop.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
      check(JSON.stringify(menu.buttons) === JSON.stringify(['Copy event link', 'Copy hourly display link', 'Export hourly image']) && menu.fits, `${dev}: Share menu on the event header: ${menu.buttons.join(' · ')} (fits the screen: ${menu.fits})`);
      check(/weather loads when the link is opened/.test(menu.text) && /saved model weights can change the numbers/.test(menu.text) && /picture of your forecast as it is now/.test(menu.text) && /exactly the same thing/.test(menu.text), `${dev}: the menu says links load weather when opened (and may use the recipient's weights); the image is the sender's forecast now`);
      await p.screenshot({ path: path.join(out, `share-menu-${dev}.png`) });
      await p.click('#shareEvent'); const eventUrl = await p.evaluate(() => navigator.clipboard.readText()), msg1 = await p.locator('#shareMsg').innerText();
      await p.click('#shareHourly'); const hourlyUrl = await p.evaluate(() => navigator.clipboard.readText());
      const ep = JSON.parse(new URL(eventUrl).searchParams.get('e'));
      check(Object.keys(ep).sort().join(',') === 'f,g,n,t,v,z' && !/ev_share_test|venueId|source|created/.test(eventUrl) && /#hourly$/.test(hourlyUrl) && /copied/.test(msg1), `${dev}: the event link carries only name, venue, time zone, times, gust limit and the fall-back choice (${Object.keys(ep).join(', ')})`);
      check(await p.evaluate(() => location.search) === `?ev=${SAVED.id}`, `${dev}: copying a link doesn't change the address bar`);
      check(await p.evaluate(() => document.getElementById('shareImage').disabled), `${dev}: the image waits until the hourly forecast covers the event (this one is a year out)`);
      /* the image from the menu, for an event the hourly forecast covers: timestamped, the sender's forecast */
      { const q = await ctx.newPage(); q.on('pageerror', (e) => errors.push(e.message)); await q.goto(`${base}/event-beta.html?wx=transition`); await q.waitForFunction(() => document.body.dataset.loaded && !document.getElementById('shareImage').disabled, null, { timeout: 20000 });
        await q.click('#shareMenu > summary'); const [dl] = await Promise.all([q.waitForEvent('download', { timeout: 20000 }), q.click('#shareImage')]); await q.waitForFunction(() => document.getElementById('shareMsg').textContent.trim(), null, { timeout: 10000 }); const m = await q.locator('#shareMsg').innerText();
        check(/-hourly-(light|dark)-1920x1080-\d{4}-\d{2}-\d{2}-\d{4}\.png$/.test(dl.suggestedFilename()) && /the forecast as of/.test(m), `${dev}: Export hourly image from the menu: ${dl.suggestedFilename()} · "${m.slice(0, 90)}"`);
        /* the hourly display link for an event the hourly forecast covers, in a clean browser: opens at Hour by hour */
        await q.click('#shareMenu > summary').catch(() => {}); if (!(await q.evaluate(() => document.getElementById('shareMenu').open))) await q.click('#shareMenu > summary');
        await q.click('#shareHourly'); const hu = await q.evaluate(() => navigator.clipboard.readText()); await q.close();
        const r2 = await browserCtx(browser, device), h = await r2.ctx.newPage(); h.on('pageerror', (e) => r2.errors.push(e.message));
        await h.goto(hu); await h.waitForFunction(() => document.querySelector('#evCharts .evc-card'), null, { timeout: 20000 }); await h.waitForTimeout(1500);
        const hv = await h.evaluate(() => ({ open: document.getElementById('secHourly').open, top: Math.round(document.getElementById('secHourly').getBoundingClientRect().top), saved: localStorage.getItem('beta_events_v2') }));
        check(/#hourly$/.test(hu) && hv.open && hv.top < 200 && !hv.saved && !r2.errors.length, `${dev} recipient: the hourly display link opens straight to Hour by hour in a clean browser (${hv.top}px from the top)`);
        await h.screenshot({ path: path.join(out, `share-hourly-recipient-${dev}.png`) }); await r2.ctx.close(); }
      check(!errors.length, `${dev} sender: no script errors ${errors.join('; ')}`); await ctx.close();
      /* 3. the recipient: a separate, clean browser with nothing saved and no sign-in */
      for (const [kind, url] of [['event link', eventUrl], ['hourly display link', hourlyUrl]]) {
        const r = await browserCtx(browser, device), q = await r.ctx.newPage(); q.on('pageerror', (e) => r.errors.push(e.message));
        await q.goto(url); await q.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 }); await q.waitForTimeout(kind === 'hourly display link' ? 1500 : 400);
        const g = await q.evaluate(() => ({ name: document.getElementById('evName').innerText, saved: localStorage.getItem('beta_events_v2'), open: document.getElementById('secHourly').open, top: Math.round(document.getElementById('secHourly').getBoundingClientRect().top), missing: document.body.dataset.missing }));
        const got = await windowsOf(q);
        check(g.name === SAVED.name && !g.saved && !g.missing && JSON.stringify(got) === JSON.stringify(sender), `${dev} recipient, ${kind}: same event and exact times, including the second 1:30 AM on the fall-back night, with nothing saved there`);
        if (kind === 'hourly display link') check(!g.open, `${dev} recipient, hourly display link for an event a year out: the pending briefing (no hourly forecast yet)`);
        if (kind === 'event link') await q.screenshot({ path: path.join(out, `share-recipient-${dev}.png`) });
        check(!r.errors.length, `${dev} recipient ${kind}: no script errors ${r.errors.join('; ')}`); await r.ctx.close();
      }
    }
    /* 4. links made before this change still open */
    { const r = await browserCtx(browser, DESK), q = await r.ctx.newPage(); const old = { n: 'Older link', v: { name: 'TQL Stadium, Cincinnati, OH', lat: 39.1113, lon: -84.5222 }, z: 'America/New_York', t: { start: '2026-11-21T19:30', end: '2026-11-21T21:30' }, g: 25 };
      await q.goto(`${base}/event-beta.html?e=${encodeURIComponent(JSON.stringify(old))}`); await q.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 });
      check(await q.locator('#evName').innerText() === 'Older link', 'a share link made before this change still opens its event'); await r.ctx.close(); }
    /* 5. Weather threats airports (kept with the event in the sender's browser) travel beside the event as ?air=, outside e;
       the Share menu says so; a clean browser gets the same airports and flight windows; the same link without air opens unchanged */
    for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
      const AIRS = [{ i: 'KCVG', r: 'p', a: ['2027-11-06T22:00', '2027-11-06T23:00'], d: ['2027-11-07T10:00', '2027-11-07T11:00'] }, { i: 'KLUK', r: 'a', a: ['2027-11-06T22:30', '2027-11-06T23:30'], d: null }];
      const s = await browserCtx(browser, device, { seed: SAVED }); await s.ctx.addInitScript((a) => { if (!localStorage.getItem('threats_airports_v1')) localStorage.setItem('threats_airports_v1', JSON.stringify({ ev_share_test: a })); }, AIRS);
      const p = await s.ctx.newPage(); p.on('pageerror', (e) => s.errors.push(e.message));
      await p.goto(`${base}/event-beta.html?ev=${SAVED.id}`); await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 }); await p.waitForTimeout(500);
      await p.click('#shareMenu > summary'); await p.waitForTimeout(200);
      const note = await p.locator('#shareAirNote').innerText().catch(() => '');
      check(/the event link and the hourly display link include KCVG \(primary, arrival and departure times\) and KLUK \(alternate, arrival times\)/.test(note), `${dev}: the Share menu says the link includes the airports (${note.slice(0, 90)}…)`);
      await p.click('#shareEvent'); const url = await p.evaluate(() => navigator.clipboard.readText()), u = new URL(url), ep = JSON.parse(u.searchParams.get('e'));
      check(JSON.stringify(JSON.parse(u.searchParams.get('air'))) === JSON.stringify(AIRS) && Object.keys(ep).sort().join(',') === 'f,g,n,t,v,z' && [...u.searchParams.keys()].join(',') === 'e,air', `${dev}: the event link carries the airports as ?air=, and e keeps exactly f,g,n,t,v,z`);
      if (!(await p.evaluate(() => document.getElementById('shareMenu').open))) await p.click('#shareMenu > summary');
      await p.click('#shareHourly'); const hurl = await p.evaluate(() => navigator.clipboard.readText()), hu = new URL(hurl);
      check(/#hourly$/.test(hurl) && JSON.stringify(JSON.parse(hu.searchParams.get('air'))) === JSON.stringify(AIRS) && Object.keys(JSON.parse(hu.searchParams.get('e'))).sort().join(',') === 'f,g,n,t,v,z', `${dev}: the hourly display link carries the same airports`);
      /* the sender leaves the airports out: both links drop air; the menu says so */
      await p.uncheck('#shareAirInclude'); const offNote = await p.locator('#shareAirNote').innerText();
      await p.click('#shareEvent'); const offE = new URL(await p.evaluate(() => navigator.clipboard.readText()));
      if (!(await p.evaluate(() => document.getElementById('shareMenu').open))) await p.click('#shareMenu > summary');
      await p.click('#shareHourly'); const offH = new URL(await p.evaluate(() => navigator.clipboard.readText()));
      check(/airports left out/.test(offNote) && [...offE.searchParams.keys()].join(',') === 'e' && [...offH.searchParams.keys()].join(',') === 'e', `${dev}: unticking "Include the airports in links" drops them from both links (${offNote.slice(0, 60)}…)`);
      await p.check('#shareAirInclude');
      check(!s.errors.length, `${dev} sender with airports: no script errors ${s.errors.join('; ')}`); await s.ctx.close();
      /* the hourly display link with airports in a clean browser */
      { const r = await browserCtx(browser, device), q = await r.ctx.newPage(); q.on('pageerror', (e) => r.errors.push(e.message));
        await q.goto(hurl); await q.waitForFunction(() => document.body.dataset.loaded && document.querySelector('#threatsAir form'), null, { timeout: 20000 }); await q.waitForTimeout(400);
        const f = await q.evaluate(() => { const f = document.querySelector('#threatsAir form'); return [f.elements.pi.value, f.elements.ai.value].join('|'); });
        check(f === 'KCVG|KLUK' && !r.errors.length, `${dev} recipient, hourly display link: the airports arrive too (${f}) ${r.errors.join('; ')}`); await r.ctx.close(); }
      /* invalid or unknown airport IDs in a link: ignored, the event opens with the defaults */
      for (const [kind, bad] of [['malformed JSON', '{oops'], ['invalid IDs and roles', JSON.stringify([{ i: 'K1', r: 'p' }, { i: '<b>x', r: 'a' }, { i: 'KCVG', r: 'z' }, { i: 'KCVG', r: 'p', a: ['tomorrow', 'later'] }])], ['not a list', '42']]) {
        const b = new URL(url); b.searchParams.set('air', bad);
        const r = await browserCtx(browser, device), q = await r.ctx.newPage(); q.on('pageerror', (e) => r.errors.push(e.message));
        await q.goto(b.toString()); await q.waitForFunction(() => document.body.dataset.loaded && document.querySelector('#threatsAir form'), null, { timeout: 20000 }); await q.waitForTimeout(400);
        const g = await q.evaluate(() => ({ name: document.getElementById('evName').innerText, pi: document.querySelector('#threatsAir form').elements.pi.value, noAir: !!document.querySelector('.et-noair'), missing: document.body.dataset.missing }));
        check(g.name === SAVED.name && g.pi === '' && g.noAir && !g.missing && !r.errors.length, `${dev} recipient, ${kind} in ?air=: ignored; the event opens with no airports ${r.errors.join('; ')}`); await r.ctx.close();
      }
      /* a well-formed but unknown ID is kept and simply finds no airport reports (checked live on the preview) */
      let withGot = null; for (const [kind, link] of [['with air', url], ['without air', (() => { const b = new URL(url); b.searchParams.delete('air'); return b.toString(); })()]]) {
        const r = await browserCtx(browser, device), q = await r.ctx.newPage(); q.on('pageerror', (e) => r.errors.push(e.message));
        await q.goto(link); await q.waitForFunction(() => document.body.dataset.loaded && document.querySelector('#threatsAir form'), null, { timeout: 20000 }); await q.waitForTimeout(400);
        const g = await q.evaluate(() => { const f = document.querySelector('#threatsAir form'), v = (n) => f.elements[n].value; return { name: document.getElementById('evName').innerText, form: [v('pi'), v('pa0'), v('pa1'), v('pd0'), v('pd1'), v('ai'), v('aa0'), v('aa1'), v('ad0')].join('|'), linkNote: !!document.querySelector('.et-linkair'), noAir: !!document.querySelector('.et-noair'), saved: localStorage.getItem('beta_events_v2') }; });
        const got = await windowsOf(q); if (kind === 'with air') withGot = got;
        if (kind === 'with air') check(g.name === SAVED.name && g.form === 'KCVG|2027-11-06T22:00|2027-11-06T23:00|2027-11-07T10:00|2027-11-07T11:00|KLUK|2027-11-06T22:30|2027-11-06T23:30|' && !g.saved, `${dev} recipient: the same primary and alternate airports and flight windows arrive in a clean browser (${g.form})`);
        else check(g.name === SAVED.name && g.form.startsWith('|') && g.noAir && !!got && JSON.stringify(got) === JSON.stringify(withGot), `${dev} recipient: the same link without ?air= opens the event unchanged, with no airports`);
        check(!r.errors.length, `${dev} recipient ${kind}: no script errors ${r.errors.join('; ')}`); await r.ctx.close();
      }
    }
  } finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all sharing checks passed'); process.exit(failed ? 1 : 0);
})();
