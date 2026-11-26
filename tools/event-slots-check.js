#!/usr/bin/env node
/* Offline check of planner-defined schedules (event slots) on the Event Manager page, with SYNTHETIC weather
   (tests/fixtures/event-slots-data.js and, for the stadium cases, tests/fixtures/event-orlando-data.js). Real engines
   and page. Cases: a single window (Reception 5–10 PM), a wedding with gaps (Vendor setup 1–3 PM, Outdoor ceremony
   4–4:30 PM, Reception 5–10 PM) with a shower at the ceremony and with rain only in a gap, an overnight event
   (9 PM–3 AM), the editor on a phone (add, rename, remove, templates, save and reopen), and an existing stadium event
   as an old share link and as an old stored record. Each case: phone 375×667 first screen and the two-page PDF.
   Usage: node tools/event-slots-check.js [out-dir] [--compare <other-checkout>]
     --compare: also open the stadium cases from another checkout (e.g. the current beta) and require the same
     briefing text (decision, lead, callouts, schedule, printout) and the same first-screen pixels. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const args = process.argv.slice(2), ci = args.indexOf('--compare'), other = ci >= 0 ? path.resolve(args[ci + 1]) : null;
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && (ci < 0 || i !== ci + 1)) || path.join(require('node:os').tmpdir(), 'event-slots')); fs.mkdirSync(out, { recursive: true });
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
const texts = (p) => p.evaluate(() => { const t = (s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, all = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }; // closed details: their text too
  const dd = [...document.querySelectorAll('#keys dd')], last = dd[dd.length - 1], r = (e) => e && e.getBoundingClientRect();
  return { name: t('#evName'), when: t('#evWhen'), decision: t('#decision'), lead: t('#leadBody'), keys: t('#keys'), after: t('#leadAfter'), schedule: t('#schedule'), glance: t('#evDash .evd-span'), phases: all('#phases'), dash: all('#evDash'),
    why: all('#whyFlagged'), checks: all('#checks'), changes: all('#changes'), alerts: t('#alerts'), decisionBottom: Math.round(r(document.getElementById('decision')).bottom), nextBottom: last ? Math.round(r(last).bottom) : null, vh: innerHeight,
    hscroll: document.documentElement.scrollWidth > innerWidth + 1 }; });
async function pdf(p, file) {
  await p.emulateMedia({ media: 'print' }); await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const buf = await p.pdf({ path: file, preferCSSPageSize: true, printBackground: true }), pages = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  const t = (n) => execFileSync('pdftotext', ['-layout', '-f', String(n), '-l', String(n), file, '-'], { encoding: 'utf8' });
  await p.emulateMedia({ media: 'screen' });
  return { pages, p1: pages ? t(1) : '', p2: pages > 1 ? t(2) : '' };
}
const link = (name, slots) => '?e=' + encodeURIComponent(JSON.stringify({ n: name, v: { name: 'Garden venue (synthetic), Cincinnati, OH', lat: 39.12, lon: -84.45 }, z: 'America/New_York',
  t: { start: slots[0][1], end: slots.reduce((m, x) => (x[2] > m ? x[2] : m), slots[0][2]) }, g: 25, s: slots }));
const D = TOMORROW, D2 = '2026-11-27';
const WEDDING = [['Vendor setup', `${D}T13:00`, `${D}T15:00`], ['Outdoor ceremony', `${D}T16:00`, `${D}T16:30`, { m: 1 }], ['Reception', `${D}T17:00`, `${D}T22:00`]];
const OVERLAP = [['Ceremony', `${D}T16:00`, `${D}T17:30`, { m: 1 }], ['Reception', `${D}T17:00`, `${D}T22:00`]];
/* the hourly image (TV export), drawn from the page's own view, saved as a PNG */
const tvShot = async (p, file) => { await p.evaluate(() => { document.getElementById('secHourly').open = true; });
  await Promise.all([p.waitForEvent('download', { timeout: 20000 }).catch(() => null), p.click('#tvExport')]).catch(() => null);
  const url = await p.evaluate(() => { const c = window.EventTvExport.draw(document.createElement('canvas'), window.__lastHourly); return c.toDataURL('image/png'); }).catch(() => null);
  if (url) fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); return !!url; };
const RECEPTION = [['Reception', `${D}T17:00`, `${D}T22:00`]], NIGHT = [['Night market', `${D}T21:00`, `${D2}T03:00`]];

(async () => {
  const srv = await serve(here), browser = await chromium.launch();
  try {
    /* ---- single window: Reception 5–10 PM, rain 6–9 PM ---- */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: link('Outdoor reception', RECEPTION) + '&wx=evening' }); const x = await texts(p), L = 'single window:';
      console.log('   decision: ' + x.decision); console.log('   lead: ' + x.lead);
      check(/Reception/.test(x.decision) && /rain/i.test(x.decision), `${L} the decision names the Reception (${x.decision})`);
      check(x.schedule === 'Reception 5–10 PM', `${L} the schedule is one slot (${x.schedule})`);
      check(x.glance === 'Reception · 5–10 PM', `${L} At a glance is headed with the slot and its saved times (${x.glance})`);
      check(/Reception 5–10 PM/.test(x.lead) || /Reception/.test(x.lead), `${L} the lead names the slot`);
      check(!/Between slots/.test(x.dash) && !/Totals cover your slots/.test(x.why), `${L} no gap wording for one window`);
      check(x.nextBottom != null && x.nextBottom <= x.vh && !x.hscroll, `${L} decision, callouts and next check on the first 375×667 screen (next check ends at ${x.nextBottom} px; decision at ${x.decisionBottom})`);
      await p.screenshot({ path: path.join(out, 'single-window-phone-first-screen.png') });
      const P = await pdf(p, path.join(out, 'single-window.pdf'));
      check(P.pages === 2 && /Reception/.test(P.p1) && /Local time/.test(P.p2), `${L} two-page PDF that names the Reception (${P.pages} pages)`);
      check(!errors.length, `${L} no page errors ${errors.join('; ')}`); await ctx.close(); }

    /* ---- owner case 1: wedding with a shower at the Outdoor ceremony ---- */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: link('Wedding', WEDDING) + '&wx=ceremony' }); const x = await texts(p), L = 'wedding, shower at the ceremony:';
      console.log('   decision: ' + x.decision); console.log('   lead: ' + x.lead); console.log('   keys: ' + x.keys);
      check(/the 4 PM Outdoor ceremony/.test(x.decision), `${L} the headline names the 4 PM Outdoor ceremony (${x.decision})`);
      check(/Outdoor ceremony 4–4:30 PM/.test(x.lead), `${L} the lead lists the Outdoor ceremony and its time`);
      check(/^OFFICIAL ALERT No active official alerts for your site right now \(checked \d{1,2}(:\d\d)? [AP]M\)\. This doesn’t mean no weather concern: the forecast concern is above\./.test(x.alerts), `${L} the official-alert card keeps its pointer to the forecast concern (${x.alerts})`);
      await p.locator('#alerts').screenshot({ path: path.join(out, 'wedding-alerts.png') }).catch(() => {});
      check(x.schedule === 'Vendor setup 1–3 PM Outdoor ceremony 4–4:30 PM Reception 5–10 PM', `${L} the schedule lists the three slots (${x.schedule})`);
      check(x.glance === 'Your slots · 1–10 PM', `${L} At a glance is headed with the saved slot times, not the stadium wording (${x.glance})`);
      const lanes = await p.evaluate(() => [...document.querySelectorAll('#evDash .evd-part')].map((e) => e.getAttribute('title')));
      check(lanes.length === 3 && /^Vendor setup/.test(lanes[0]) && /^Outdoor ceremony/.test(lanes[1]) && /^Reception/.test(lanes[2]), `${L} the timeline ("When conditions could affect the event") lanes use the slot names (${lanes.join(' · ')})`);
      check(/Outdoor ceremony/.test(x.phases) && /Vendor setup/.test(x.phases) && /Reception/.test(x.phases), `${L} By phase lists the slots by name`);
      check(/Totals cover your slots: 1–3 PM, 4–4:30 PM, 5–10 PM/.test(x.why) && /Hourly data: 4–5 PM counted with the Outdoor ceremony; the forecast can’t separate parts of an hour/.test(x.why), `${L} Why this is flagged says which hours the totals cover and that 4–5 PM counts with the ceremony`);
      check(await tvShot(p, path.join(out, 'wedding-tv-export.png')), `${L} hourly image (TV) exported with the slot names`);
      check(x.nextBottom != null && x.nextBottom <= x.vh && !x.hscroll, `${L} decision, callouts and next check on the first 375×667 screen (next check ends at ${x.nextBottom} px; decision at ${x.decisionBottom})`);
      await p.screenshot({ path: path.join(out, 'wedding-phone-first-screen.png') });
      await p.locator('#evDash').screenshot({ path: path.join(out, 'wedding-timeline.png') }).catch(() => {});
      const P = await pdf(p, path.join(out, 'wedding.pdf'));
      check(P.pages === 2 && /4 PM Outdoor ceremony/.test(P.p1) && /Outdoor ceremony/.test(P.p1) && /Vendor setup/.test(P.p1), `${L} PDF page 1 says the same (${P.pages} pages)`);
      check(/Outdoor ceremony/.test(P.p2), `${L} PDF page 2's hour table names the slots`);
      try { execFileSync('pdftoppm', ['-r', '80', '-png', '-f', '1', '-l', '1', path.join(out, 'wedding.pdf'), path.join(out, 'wedding-pdf')]); } catch {}
      fs.writeFileSync(path.join(out, 'wedding-pdf.txt'), P.p1 + '\n\f\n' + P.p2);
      check(!errors.length, `${L} no page errors ${errors.join('; ')}`); await ctx.close(); }

    /* ---- owner case 2: rain falling 3–4 PM only (labelled 4 PM), between Vendor setup and the Outdoor ceremony ---- */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: link('Wedding', WEDDING) + '&wx=gap' }); const x = await texts(p), L = 'wedding, rain only in a gap:';
      console.log('   decision: ' + x.decision); console.log('   why: ' + x.why.slice(0, 400));
      check(!/rain/i.test(x.decision) || /No weather concern/i.test(x.decision), `${L} no rain concern for any slot (${x.decision})`);
      check(!/Rain:/.test(x.phases), `${L} no slot is rated for rain`);
      check(/^OFFICIAL ALERT No active official alerts for your site right now \(checked \d{1,2}(:\d\d)? [AP]M\)\.$/.test(x.alerts), `${L} with no forecast concern the official-alert card ends after the check, with no pointer to a concern (${x.alerts})`);
      await p.locator('#alerts').screenshot({ path: path.join(out, 'wedding-gap-alerts.png') }).catch(() => {});
      check(x.glance === 'Your slots · 1–10 PM' && /Your slots only, not the gaps between them/.test(x.dash), `${L} At a glance: saved slot times in the header; the totals still say they cover the slots only (${x.glance})`);
      check(/Totals cover your slots: 1–3 PM, 4–4:30 PM, 5–10 PM; rain that falls between them is not counted/.test(x.why), `${L} Why this is flagged states the hours the totals cover`);
      const tile = await p.evaluate(() => { const t = document.querySelector('[data-tile=rain] [data-value]'); return t ? t.textContent : null; });
      check(tile === '0.00' || tile === '0', `${L} the rain total over the slots is 0 (tile ${tile})`);
      await p.screenshot({ path: path.join(out, 'wedding-gap-phone-first-screen.png') });
      /* the gap hour's rain is still in the hour-by-hour charts and grid, shaded and labelled as between slots */
      const g = await p.evaluate(async () => { const h = document.getElementById('secHourly'); h.open = true; await new Promise((r) => setTimeout(r, 300));
        const hour = document.querySelector('#evCharts [data-variable=pop] [data-hour]'), cols = [...document.querySelectorAll('#evCharts [data-variable=pop] [data-hour]')].map((x) => +x.dataset.hour);
        return { cols, between: document.querySelectorAll('#evCharts [data-variable=pop] .evc-between').length, label: !!document.querySelector('#evCharts .evc-betweentext'),
          grid: [...document.querySelectorAll('#evGrid th, #evGrid td')].some((c) => /Between slots/.test(c.textContent)) }; });
      const at4 = Date.parse(`${D}T16:00:00-05:00`);
      await p.locator(`#evCharts [data-variable=pop] [data-hour="${at4}"]`).first().click().catch(() => {}); await p.waitForTimeout(250);
      const sel = await p.evaluate(() => ({ chance: (document.querySelector('#evCharts [data-value=pop]') || {}).textContent, amount: (document.querySelector('#evCharts [data-amount]') || {}).parentElement.textContent,
        detail: (document.getElementById('evGridDetail') || {}).textContent || '', dash: document.getElementById('evDash').textContent }));
      check(/Rain 3–4 PM/.test(sel.amount), `${L} the chart labels the rain interval (${sel.amount})`);
      const flags = await p.evaluate(() => [...document.querySelectorAll('#evDash .evd-row')].map((r) => r.dataset.hazard));
      check(!flags.includes('rain'), `${L} the hazard timeline (At a glance) has no rain row (${flags.join(', ') || 'none'})`);
      await p.locator('#evGrid').first().scrollIntoViewIfNeeded().catch(() => {});
      const gd = await p.evaluate((ms) => { const c = document.querySelector(`#evGrid button[data-ms="${ms}"]`); if (c) c.click(); return (document.getElementById('evGridDetail') || {}).textContent || ''; }, at4);
      check(/3–4 PM \(the hour ending 4 PM\), between slots/.test(gd), `${L} the hour detail names the rain's hour (${gd.replace(/\s+/g, ' ').slice(0, 160)})`);
      check(await tvShot(p, path.join(out, 'wedding-gap-tv-export.png')), `${L} hourly image (TV) exported with the gap hour shaded`);      check(g.between >= 1 && g.label && g.grid, `${L} the hourly charts and grid still show the gap hours, shaded (with a "Between slots" title) and labelled in the grid (${JSON.stringify({ between: g.between, label: g.label, grid: g.grid })})`);
      check(/65%/.test(sel.chance || '') && /0\.12/.test(sel.amount || ''), `${L} the 3–4 PM rain is visible in the hourly chart (column 4 PM, "Rain 3–4 PM") (${sel.chance}, ${sel.amount})`);
      await p.locator('#evCharts [data-variable=pop]').first().scrollIntoViewIfNeeded(); await p.locator('#evCharts [data-variable=pop]').first().screenshot({ path: path.join(out, 'wedding-gap-hourly-chart.png') }).catch((e) => console.log('   (chart capture: ' + e.message.split('\n')[0] + ')'));
      check(!errors.length, `${L} no page errors ${errors.join('; ')}`); await ctx.close(); }

    /* ---- overlapping slots: an hour both slots share is counted once ---- */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: link('Ceremony and reception', OVERLAP) + '&wx=evening' }), L = 'overlapping slots:';
      const tile = await p.evaluate(() => { const t = document.querySelector('[data-tile=rain] [data-value]'); return t ? t.textContent : null; });
      check(tile === '0.24', `${L} the rain total counts each hour once (6–9 PM, 3 × 0.08 in): ${tile}`);
      check(!errors.length, `${L} no page errors ${errors.join('; ')}`); await ctx.close(); }

    /* ---- overnight: 9 PM to 3 AM ---- */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: link('Night market', NIGHT) + '&wx=night' }); const x = await texts(p), L = 'overnight:';
      console.log('   decision: ' + x.decision);
      check(/^Night market 9 PM.*3 AM$/.test(x.schedule), `${L} one slot across midnight (${x.schedule})`);
      check(/gust/i.test(x.decision) || /wind/i.test(x.decision) || /Night market/.test(x.lead), `${L} the briefing reads the night hours (${x.decision})`);
      const P = await pdf(p, path.join(out, 'overnight.pdf'));
      check(P.pages === 2 && /Night market/.test(P.p1), `${L} two-page PDF (${P.pages} pages)`);
      await p.screenshot({ path: path.join(out, 'overnight-phone-first-screen.png') });
      check(!errors.length, `${L} no page errors ${errors.join('; ')}`); await ctx.close(); }

    /* ---- the editor on a phone: templates, add, rename, remove, save and reopen ---- */
    { const { ctx, p, errors } = await open(browser, srv, { fixture: 'event-slots-data.js', query: link('Wedding', WEDDING) + '&wx=dry' }), L = 'editor:';
      await p.locator('#editBtn').click(); await p.waitForSelector('#fSlots .ev-slot');
      const st = await p.evaluate(() => ({ tpl: document.getElementById('fTpl').value, rows: [...document.querySelectorAll('#fSlots .ev-slot')].map((li) => li.querySelector('[data-f=name]').value),
        small: [...document.querySelectorAll('#fSlots input, #fSlots button, #fAddSlot')].filter((e) => e.getBoundingClientRect().height < 44 && e.type !== 'radio').length,
        labelled: [...document.querySelectorAll('#fSlots input')].every((e) => e.closest('label')), legacyHidden: document.getElementById('fLegacy').hidden }));
      check(st.tpl === 'slots' && st.rows.join('|') === 'Vendor setup|Outdoor ceremony|Reception' && st.legacyHidden, `${L} a shared slot event opens with its own slots (${st.rows.join(', ')})`);
      check(st.small === 0 && st.labelled, `${L} every slot control is labelled and at least 44 px tall (${st.small} smaller)`);
      await p.locator('#fSlots .ev-slot').first().screenshot({ path: path.join(out, 'editor-slot-row.png') }).catch(() => {});
      await p.screenshot({ path: path.join(out, 'editor-phone.png') });
      await p.locator('#fAddSlot').click();
      await p.locator('#fSlots .ev-slot').last().locator('[data-f=name]').fill('Late-night snack');
      const added = await p.evaluate(() => [...document.querySelectorAll('#fSlots .ev-slot')].map((li) => `${li.querySelector('[data-f=name]').value} ${li.querySelector('[data-f=start]').value}-${li.querySelector('[data-f=end]').value}`));
      check(added.length === 4 && /^Late-night snack 22:00-23:00$/.test(added[3]), `${L} Add slot starts after the last one (${added.join(', ')})`);
      await p.locator('#fSlots .ev-slot').first().locator('[data-f=name]').fill('Vendor load-in');
      await p.locator('#fSlots [data-x]').nth(3).click();
      const n3 = await p.locator('#fSlots .ev-slot').count(); check(n3 === 3, `${L} Remove takes a slot away (${n3} left)`);
      /* a time typed out of order moves the slot into place; an overlap is a warning, not a block */
      await p.locator('#fSlots .ev-slot').nth(2).locator('[data-f=start]').fill('12:00'); await p.locator('#fSlots .ev-slot').nth(2).locator('[data-f=start]').dispatchEvent('change');
      const re = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#fSlots .ev-slot [data-f=name]')].map((e) => e.value), note: document.getElementById('fSlotNote').textContent }));
      check(re.rows[0] === 'Reception' && /overlap/.test(re.note), `${L} slots reorder by time and overlaps are flagged (${re.rows.join(', ')} · ${re.note})`);
      await p.locator('#fSlots .ev-slot').first().locator('[data-f=start]').fill('17:00'); await p.locator('#fSlots .ev-slot').first().locator('[data-f=start]').dispatchEvent('change');
      await p.selectOption('#fTpl', 'stadium'); const leg = await p.evaluate(() => ({ legacy: !document.getElementById('fLegacy').hidden, setup: !!document.getElementById('fSetup').value, start: document.getElementById('fStart').value }));
      check(leg.legacy && leg.setup && leg.start === '16:00', `${L} the stadium template shows Setup, Gates, Event and Teardown from the main slot (${JSON.stringify(leg)})`);
      await p.selectOption('#fTpl', 'single'); const one = await p.locator('#fSlots .ev-slot').count(); check(one === 1, `${L} Single window is one editable Event slot`);
      await p.selectOption('#fTpl', 'wedding'); const wed = await p.evaluate(() => [...document.querySelectorAll('#fSlots .ev-slot [data-f=name]')].map((e) => e.value).join('|'));
      check(wed === 'Vendor setup|Outdoor ceremony|Reception', `${L} the wedding example template (${wed})`);
      await p.locator('#fSlots .ev-slot').first().locator('[data-f=name]').fill('Vendor load-in');
      await p.locator('#fSave').click(); await p.waitForFunction(() => !document.getElementById('editDlg').open, null, { timeout: 15000 });
      await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 15000 }); await p.waitForTimeout(400);
      const saved = await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('beta_events_v2') || '[]'); return { url: location.search, n: l.length, slots: l[0] && l[0].slots ? l[0].slots.map((x) => x.name) : null, times: l[0] && l[0].times, sch: document.getElementById('schedule').innerText.replace(/\s+/g, ' ') }; });
      check(/^\?ev=/.test(saved.url) && saved.slots && saved.slots.join('|') === 'Vendor load-in|Outdoor ceremony|Reception' && saved.times.start.endsWith('T13:00') && saved.times.end.endsWith('T22:00'), `${L} saved with its slots and their outer start and end (${JSON.stringify(saved.slots)} ${JSON.stringify(saved.times)})`);
      check(/Vendor load-in 1–3 PM/.test(saved.sch), `${L} the page shows the saved schedule (${saved.sch})`);
      await p.reload(); await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 15000 });
      const again = await p.evaluate(() => document.getElementById('schedule').innerText.replace(/\s+/g, ' '));
      check(again === saved.sch, `${L} reopening the saved event shows the same slots`);
      check(!errors.length, `${L} no page errors ${errors.join('; ')}`); await ctx.close(); }

    /* ---- existing stadium events: an old share link and an old stored record, against another checkout ---- */
    const OLD = { n: 'Orlando City vs. visiting club (sample)', v: { name: 'Inter&Co Stadium, Orlando, FL', lat: 28.5411, lon: -81.3893 }, z: 'America/New_York',
      t: { setup: `${D}T13:00`, gates: `${D}T17:00`, start: `${D}T19:30`, end: `${D}T21:30`, teardown: `${D}T23:30` }, g: 25 };
    const REC = [{ id: 'ev_oldstadium', name: OLD.n.replace(' (sample)', ''), venueId: null, loc: OLD.v, tz: OLD.z, times: OLD.t, gust: 25, overrides: [], source: { kind: 'manual' }, created: 1, updated: 1 }];
    const stadium = async (s, tag) => {
      const res = {};
      for (const [k, opt] of [['link', { query: '?e=' + encodeURIComponent(JSON.stringify(OLD)) }], ['stored', { query: '?ev=ev_oldstadium', store: REC }]]) {
        const { ctx, p, errors } = await open(browser, s, { fixture: 'event-orlando-data.js', ...opt });
        const x = await texts(p); delete x.checks; // the check-in list carries the live clock
        check(/^OFFICIAL ALERT No active official alerts for your site right now \(checked \d{1,2}(:\d\d)? [AP]M\)\. This doesn’t mean no weather concern: the forecast concern is above\./.test(x.alerts), `stadium ${k} (${tag}): the official-alert card keeps its pointer to the forecast concern (${x.alerts})`);
        await p.locator('#alerts').screenshot({ path: path.join(out, `stadium-${k}-${tag}-alerts.png`) }).catch(() => {});
        await p.screenshot({ path: path.join(out, `stadium-${k}-${tag}.png`) });
        const P = await pdf(p, path.join(out, `stadium-${k}-${tag}.pdf`));
        res[k] = { ...x, pdf1: P.p1.replace(/Issued[^\n]*/g, ''), pages: P.pages, errors, shot: fs.readFileSync(path.join(out, `stadium-${k}-${tag}.png`)) };
        await ctx.close();
      }
      return res;
    };
    const mine = await stadium(srv, 'this');
    ['link', 'stored'].forEach((k) => { const x = mine[k];
      check(x.schedule === 'Setup 1–5 PM Gates 5–7:30 PM Event 7:30–9:30 PM Teardown 9:30–11:30 PM' && x.pages === 2 && !x.errors.length, `stadium ${k}: the fixed parts as before (${x.schedule}); two-page PDF`);
      fs.writeFileSync(path.join(out, `stadium-${k}-this.txt`), ['decision', 'when', 'lead', 'keys', 'after', 'schedule', 'phases', 'dash', 'changes', 'pdf1'].map((f) => `## ${f}\n${x[f]}`).join('\n\n')); });
    if (other) {
      const o = await serve(other), theirs = await stadium(o, 'other');
      ['link', 'stored'].forEach((k) => {
        const a = mine[k], b = theirs[k], fields = ['name', 'when', 'decision', 'lead', 'keys', 'after', 'schedule', 'phases', 'dash', 'why', 'changes', 'pdf1', 'decisionBottom', 'nextBottom'];
        const diff = fields.filter((f) => a[f] !== b[f]);
        fs.writeFileSync(path.join(out, `stadium-${k}-other.txt`), ['decision', 'when', 'lead', 'keys', 'after', 'schedule', 'phases', 'dash', 'changes', 'pdf1'].map((f) => `## ${f}\n${b[f]}`).join('\n\n'));
        check(!diff.length, `stadium ${k}: same briefing text and positions as ${path.basename(other)} (${diff.length ? 'differs: ' + diff.join(', ') : 'decision, lead, callouts, schedule, By phase, timeline, why, PDF page 1 identical; next check ends at ' + a.nextBottom + ' px'})`);
        check(a.shot.equals(b.shot), `stadium ${k}: first-screen 375×667 screenshot identical byte for byte`);
      });
      o.s.close();
    }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await browser.close(); srv.s.close();
  console.log(failed ? `${failed} check(s) failed` : 'all slot checks passed'); process.exit(failed ? 1 : 0);
})();
