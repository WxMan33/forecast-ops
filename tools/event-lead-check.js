#!/usr/bin/env node
/* Offline check of the Event Manager lead: one event concern first, official alerts and missing guidance apart, a
   "Why this is flagged" disclosure one tap away, evidence at the concern's hour, and the two-page US Letter printout.
   Fixture: tests/fixtures/event-thanksgiving-replay.js (a labelled REPLAY SAMPLE with synthetic guidance; engines,
   layout and printing are real). Cases: the Thanksgiving replay (heavy morning rain, empty official alerts), a quiet
   race morning, missing guidance, an urgent official warning, and a failed alert check.
   Writes phone/desktop screenshots, each case's PDF and PNGs of both printed pages to the directory given.
   Usage: node tools/event-lead-check.js [output-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-lead')); fs.mkdirSync(out, { recursive: true });
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/event-thanksgiving-replay.js'), 'utf8');
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html'); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
let browser, failed = 0;
const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { width: 390, height: 664 }, DESK = { width: 1280, height: 900 };
async function open(base, query, { device = PHONE, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: device, deviceScaleFactor: 2, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message)); await p.clock.install({ time: new Date('2026-11-25T19:30:00Z') });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); window.print = () => {}; }, theme);
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== base) return r.fulfill({ status: 200, body: '', contentType: u.pathname.endsWith('.js') ? 'application/javascript' : 'text/plain' });
    if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: fixture + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  await p.goto(base + '/event-beta.html' + query); await p.waitForFunction(() => document.body.dataset.loaded && document.body.dataset.leadKind, null, { timeout: 20000 }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const state = (p) => p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; }, t = (s) => (document.querySelector(s) || {}).innerText || '';
  const pos = (a, b) => { const x = document.querySelector(a), y = document.querySelector(b); return x && y ? !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) : null; };
  return { vh: innerHeight, kind: document.body.dataset.leadKind, decision: t('#decision'), when: t('[data-lead=when]'), change: t('[data-lead=change]'), alerts: t('#alerts'), gapFlag: document.getElementById('gapFlag').hidden ? '' : t('#gapFlag'),
    decisionBottom: (r('#decision') || {}).bottom, whenBottom: (r('[data-lead=when]') || {}).bottom, watch: t('[data-lead=watch]'), watchBottom: (r('[data-lead=watch]') || {}).bottom, urgentBottom: (r('[data-lead=urgent]') || {}).bottom, kindTag: t('[data-lead=when] .ev-kind'),
    leadBeforeAlerts: pos('#decision', '#alerts'), leadBeforeThreats: pos('#lead', '#secThreats'), whyOpen: document.getElementById('whyFlagged').open, hscroll: document.documentElement.scrollWidth > innerWidth + 1,
    evidence: [...document.querySelectorAll('[data-evidence]')].map((a) => ({ k: a.dataset.evidence, at: +a.dataset.at, text: a.innerText })), radarNote: t('[data-lead=radar-note]') }; });
async function print(p, file) {
  await p.emulateMedia({ media: 'print' }); await p.setViewportSize({ width: Math.round(7.4 * 96), height: 1056 }); await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const pdfPath = path.join(out, file + '.pdf'), pdf = await p.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, t = (n) => execFileSync('pdftotext', ['-layout', '-f', String(n), '-l', String(n), pdfPath, '-'], { encoding: 'utf8' });
  try { execFileSync('pdftoppm', ['-r', '80', '-png', pdfPath, path.join(out, file)]); } catch { /* images are a convenience */ }
  await p.emulateMedia({ media: 'screen' });
  return { pages, p1: pages ? t(1) : '', p2: pages > 1 ? t(2) : '' };
}
const CASES = [
  ['replay', '', 'Thanksgiving replay: heavy morning rain, no official alerts'],
  ['quiet', '?tg=quiet', 'quiet race morning'],
  ['missing', '?tg=missing', 'missing guidance'],
  ['warning', '?tg=warning', 'urgent official warning at the venue'],
  ['alertsfail', '?alerts=fail', 'replay with a failed alert check'],
];
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port; browser = await chromium.launch();
  for (const [name, query, label] of CASES) {
    const L = `${name}:`, { ctx, p, errors } = await open(base, query);
    const s = await state(p);
    console.log(`   ${label}\n   lead: ${s.decision} | ${s.when.replace(/\s+/g, ' ')}\n   official: ${s.alerts.replace(/\s+/g, ' ').slice(0, 160)}`);
    check(s.decisionBottom <= s.vh && s.whenBottom <= s.vh && s.watchBottom <= s.vh && /^Watch for: /.test(s.watch), `${L} the lead (headline, timing and phases, implication, one "Watch for" line) is on the first 390×664 phone screen (ends ${Math.round(s.watchBottom)} px): ${s.watch}`);
    check(s.leadBeforeAlerts && s.leadBeforeThreats, `${L} the event concern comes before the official-alert block and the official threats section`);
    check(!s.hscroll, `${L} no sideways page scroll`);
    if (name === 'replay' || name === 'warning' || name === 'alertsfail') {
      check(s.kind === 'forecast' && /^FORECAST CONCERN/i.test(s.kindTag), `${L} labelled as a forecast concern`);
      check(s.decision === 'Rain likely through the 9 AM race start.' && /Thu 6 AM–12 PM, setup through teardown\./.test(s.when), `${L} the headline leads with the affected part and its local time ("${s.decision}"), then the concern's hours and the parts it affects (${s.when.replace(/\s+/g, ' ')})`);
      const rainRow = (await p.locator('#keys dd').first().innerText()).replace(/\s+/g, ' ');
      check(rainRow === 'Up to 90% in the likeliest hour Likely disruptive. Plan for wet footing and keep check-in and equipment covered.', `${L} the Rain chance row keeps the number and the planning impact apart: ${rainRow}`);
      check(s.watch === 'Watch for: heavier rain during lineup and around the 9 AM start.', `${L} "Watch for" names the heavier rain during lineup and around the start (the heaviest hourly amounts fall there), with no implied delay or cancellation rule: ${s.watch}`);
      check(/9 AM event start/.test(s.change) && /sources now start it between/.test(s.change) && /likely disruptive by the briefing’s rain rule/.test(s.change) && !/cancel|postpone|delay/i.test(s.change), `${L} what would change the plan names a trigger tied to the race start and the briefing's own rain rule, with no implied venue policy`);
      check(s.evidence.length === 2 && s.evidence.every((e) => e.at === Date.parse('2026-11-26T11:00:00Z')) && /6 AM Thu/.test(s.evidence[0].text), `${L} hourly charts and forecast radar links open at the concern's hour (6 AM Thu)`);
    }
    if (name === 'replay') {
      check(/No active official alerts/.test(s.alerts) && /doesn’t mean no weather concern/.test(s.alerts) && !/no threats/i.test(s.alerts), `${L} the empty official-alert set reads as "No active official alerts", never as no threats: ${s.alerts.replace(/\s+/g, ' ')}`);
      /* one tap: the disclosure opens and carries the guidance, rule, spread, timing, coverage and trend */
      await p.locator('#whyFlagged > summary').click(); await p.waitForTimeout(150);
      const why = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#whyFlagged dd')].map((d) => [d.dataset.why, d.innerText])));
      check(await p.evaluate(() => document.getElementById('whyFlagged').open), `${L} "Why this is flagged" opens in one tap`);
      check(/Cincinnati-tuned blend of 9 sources/.test(why.guidance) && /likely disruptive/.test(why.guidance), `${L} why: the guidance behind the headline (${why.guidance.slice(0, 120)}…)`);
      check(/at least a 70% chance and 0\.25″/.test(why['against-the-rule']) && /Event likely disruptive \(\d+% chance, \d\.\d\d″\)/.test(why['against-the-rule']), `${L} why: the values against the briefing's rule, by part`);
      check(/sources range \d\.\d\d″–\d\.\d\d″ \(10th–90th percentile, weighted\)/.test(why['model-spread']) && /of \d+ sources show rain/.test(why['model-spread']), `${L} why: model spread (${why['model-spread'].slice(0, 140)}…)`);
      check(/GFS run 7 AM Wed/.test(why['source-timing']) && /Retrieved 2:3\d PM EST/.test(why['source-timing']) && /Next: /.test(why['source-timing']), `${L} why: run times, retrieval and next updates`);
      check(/9 of 9 model sources reach the event hours/.test(why.coverage) && /No coverage gaps/.test(why.coverage), `${L} why: coverage`);
      check(why.trend === 'No earlier briefing to compare yet.', `${L} why: no trend is claimed without a comparable earlier briefing`);
      check(/What would change/i.test(await p.locator('#whyFlagged').innerText()), `${L} why: what would change this assessment`);
      await p.evaluate(() => { document.getElementById('whyFlagged').scrollIntoView({ block: 'start' }); scrollBy(0, -170); }); await p.waitForTimeout(100); await p.screenshot({ path: path.join(out, `${name}-phone-why.png`) });
      /* evidence one tap away: the hourly charts open at the concern's hour */
      await p.locator('[data-evidence=charts]').click(); await p.waitForTimeout(700);
      const h = await p.evaluate(() => ({ open: document.getElementById('secHourly').open, sel: +document.body.dataset.selected, top: Math.round(document.getElementById('secHourly').getBoundingClientRect().top) }));
      check(h.open && h.sel === Date.parse('2026-11-26T11:00:00Z') && h.top < 200, `${L} "Hourly charts" opens Hour by hour with 6 AM Thu selected (${JSON.stringify(h)})`);
      await p.evaluate(() => scrollTo(0, 0)); await p.evaluate(() => { document.getElementById('whyFlagged').open = false; document.getElementById('secHourly').open = false; });
      await p.locator('[data-evidence=radar]').click(); await p.waitForTimeout(700);
      check(await p.evaluate(() => { const r = document.getElementById('secMap').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }) && await p.evaluate(() => +document.body.dataset.selected === Date.parse('2026-11-26T11:00:00Z')), `${L} "Forecast radar" brings the map up at the concern's hour`);
    }
    if (name === 'quiet') {
      check(!/incomplete|limited/i.test(s.decision + s.when + (await p.locator('#keys').innerText())) && /no rain concern for the plan/.test(await p.locator('#keys').innerText()), `${L} the quiet case stays distinct: no "incomplete" or "limited" wording anywhere in the lead or callouts`);
      check(s.kind === 'none' && s.decision === 'No weather concern for your event window.' && /Checked setup through teardown, 5 AM–12 PM: no weather change needed/.test(s.when) && s.watch === 'Watch for: any new rain, wind or thunder signal.', `${L} calm lead: "${s.decision}" ${s.when.replace(/\s+/g, ' ')}`);
      check(/No active official alerts/.test(s.alerts), `${L} official alerts shown as none, separately`);
      check(/No part of the event reaches a planning threshold/.test(s.change), `${L} what would change: a new signal in the next update`);
    }
    if (name === 'missing') {
      const INC = 'Forecast guidance is incomplete for the 9–11 AM race window', RINC = 'Rain guidance is incomplete for the 9–11 AM race window';
      check(s.kind === 'missing' && s.decision === INC + '.' && /Only 3 of 9 model sources reach these hours\./.test(s.when) && s.watch === 'Watch for: the missing hours filling in.', `${L} the lead says guidance is incomplete for the race window and why: ${s.decision} ${s.when.replace(/\s+/g, ' ')}`);
      /* nowhere on the page reads as "no rain concern" for the race window */
      const rows = await p.evaluate(() => ({ rain: [...document.querySelectorAll('#keys dd')][0].innerText, glance: (document.querySelector('#evDash [data-none]') || {}).innerText || '', event: (document.querySelector('#phases [data-phase=event]') || {}).textContent || '' }));
      check(rows.rain.includes(RINC) && !/no rain concern/i.test(rows.rain), `${L} the Rain chance row says the race window is incomplete, not "no rain concern": ${rows.rain.replace(/\s+/g, ' ')}`);
      check(rows.glance.includes(INC) && !/^No weather concerns flagged for your event window/.test(rows.glance), `${L} At a glance says the same: ${rows.glance.slice(0, 120)}`);
      check(/Guidance incomplete/.test(rows.event) && !/No concern found/.test(rows.event), `${L} By phase marks the race as guidance incomplete, not "No concern found"`);
      check(/^MISSING GUIDANCE/i.test(s.kindTag) && /Missing guidance/i.test(s.gapFlag) && /3 of 9/.test(s.gapFlag), `${L} labelled missing guidance, with its own block naming the sources`);
      check(/Forecast radar doesn’t reach 9 AM Thu yet; the charts use the model blend\./.test(s.radarNote), `${L} no HRRR for the race: the radar link says so (${s.radarNote})`);
      await p.locator('#whyFlagged > summary').click(); const cov = await p.locator('#whyFlagged [data-why=coverage]').innerText();
      check(/3 of 9 model sources/.test(cov) && /Coverage is thin/.test(cov) && /missing, not zero/.test(cov), `${L} why: coverage gaps said plainly (${cov.slice(0, 140)}…)`);
      await p.evaluate(() => { document.getElementById('whyFlagged').scrollIntoView({ block: 'start' }); scrollBy(0, -170); }); await p.waitForTimeout(100); await p.screenshot({ path: path.join(out, `${name}-phone-why.png`) }); await p.evaluate(() => { document.getElementById('whyFlagged').open = false; scrollTo(0, 0); });
    }
    if (name === 'quiet') { await p.locator('#whyFlagged > summary').click(); await p.evaluate(() => { document.getElementById('whyFlagged').scrollIntoView({ block: 'start' }); scrollBy(0, -170); }); await p.waitForTimeout(100); await p.screenshot({ path: path.join(out, `${name}-phone-why.png`) }); await p.evaluate(() => { document.getElementById('whyFlagged').open = false; scrollTo(0, 0); }); }
    if (name === 'warning') {
      check(s.urgentBottom > 0 && s.urgentBottom <= s.vh && await p.evaluate(() => document.getElementById('leadUrgent').getBoundingClientRect().bottom <= document.getElementById('decision').getBoundingClientRect().top) && /Flash Flood Warning in effect/.test(await p.locator('[data-lead=urgent]').innerText()), `${L} the urgent warning is on the first phone screen with the forecast concern (ends ${Math.round(s.urgentBottom)} px)`);
      check(/shown with the forecast concern above/.test(s.alerts), `${L} the official block points to the warning instead of repeating it`);
    }
    if (name === 'alertsfail') check(/Official alerts could not be checked \(2:3\d PM\)/.test(s.alerts) && /weather\.gov/.test(s.alerts) && /Missing guidance/i.test(s.alerts) && !/No active official alerts/.test(s.alerts), `${L} a failed alert check is missing guidance, never "none": ${s.alerts.replace(/\s+/g, ' ').slice(0, 120)}`);
    await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(out, `${name}-phone-light.png`) });
    if (name === 'replay') { await p.screenshot({ path: path.join(out, `${name}-phone-light-full.png`), fullPage: true }); }
    /* the two-page printout: page 1 leads with the concern, then official alerts, then missing guidance */
    const pr = await print(p, `${name}-print`), p1 = pr.p1.replace(/\s+/g, ' ');
    check(pr.pages === 2, `${L} prints exactly two US Letter pages (got ${pr.pages})`);
    const at = (re) => { const m = p1.search(re); return m < 0 ? Infinity : m; };
    check(at(/(FORECAST CONCERN|NO FORECAST CONCERN|MISSING GUIDANCE)/) < at(/Official NWS alert/i) && at(/What would change the plan/) < at(/Official NWS alert/i) && at(/Next weather check/) < at(/What to plan for/), `${L} page 1 leads with the concern, what would change and the next check, then official alerts`);
    check(p1.includes('Watch for: ' + s.watch.replace(/^Watch for: /, '')) && p1.includes(s.decision), `${L} page 1 carries the same headline and "Watch for" line as the phone`);
    check(/Why this is flagged/i.test(p1) && /(Newest model run|Model run times)/.test(p1) && /Coverage/.test(p1), `${L} page 1 carries a compact "Why this is flagged" summary`);
    if (name === 'replay' || name === 'quiet') check(/Official NWS alerts: none active for the site/.test(p1), `${L} page 1 states no active official alerts, separately`);
    if (name === 'missing') check(p1.includes('Forecast guidance is incomplete for the 9–11 AM race window; no weather concern in the hours that have guidance') && !/No weather concern for the event in the current forecast/.test(p1 + pr.p2.replace(/\s+/g, ' ')) && pr.p2.replace(/\s+/g, ' ').includes('Forecast guidance is incomplete for the 9–11 AM race window'), `${L} the printout's headline, "What to plan for" and page 2 "Watch for" say the race window is incomplete, never "No weather concern"`);
    if (name === 'missing') check(/Missing guidance: Only part of the usual forecast data reaches these hours/.test(p1) && /9–11 AM \(2 hours\) have no forecast data/.test(p1) && at(/Official NWS alert/i) < at(/Missing guidance:/), `${L} page 1 lists missing guidance after official alerts`);
    if (name === 'warning') check(/Official NWS alert in effect Flash Flood Warning until Thu 1 PM/i.test(p1), `${L} page 1 shows the warning in the official-alert box`);
    if (name === 'alertsfail') check(/Could not be checked when this was printed/.test(p1) && !/none active/.test(p1), `${L} page 1 never prints "none" when the alert check failed`);
    check(/Local time/.test(pr.p2), `${L} page 2 is the hour-by-hour table`);
    check(errors.length === 0, `${L} no script errors ${errors.join('; ')}`);
    await ctx.close();
  }
  /* a small phone (375×667, iPhone SE-like): the lead and "Watch for" (and an urgent warning) on the first screen */
  for (const [name, query] of CASES.slice(0, 4)) {
    const { ctx, p, errors } = await open(base, query, { device: { width: 375, height: 667 } }), s = await state(p);
    const bar = await p.evaluate(() => { const ids = ['printTop', 'bxFeedback', 'bxRefresh', 'bxTheme'], els = [...ids.map((i) => document.getElementById(i)), document.querySelector('.bx-head-in > a.bx-btn')].filter(Boolean);
      const r = els.map((e) => e.getBoundingClientRect()), dd = [...document.querySelectorAll('#keys dd')].pop();
      return { n: els.length, rows: new Set(r.map((x) => Math.round(x.top))).size, minH: Math.min(...r.map((x) => x.height)), minW: Math.min(...r.map((x) => x.width)), names: els.map((e) => e.getAttribute('aria-label') || e.title || e.innerText.trim()), next: dd ? dd.getBoundingClientRect().bottom : 9999 }; });
    check(bar.n === 5 && bar.rows === 1 && bar.minH >= 44 && bar.minW >= 44 && bar.names.every(Boolean), `${name} 375×667: Print, Feedback, refresh, Dark and Met on one row, each a ≥44 px target with a name (${JSON.stringify(bar)})`);
    if (name === 'replay' || name === 'quiet') check(bar.next <= 667, `${name} 375×667: Next check is on the first screen (ends ${Math.round(bar.next)} px)`);
    check(s.whenBottom <= s.vh && s.watchBottom <= s.vh && (name !== 'warning' || (s.urgentBottom > 0 && s.urgentBottom <= s.vh)) && !s.hscroll && !errors.length, `${name} 375×667: lead and "Watch for"${name === 'warning' ? ' and the urgent warning' : ''} on the first screen (watch ends ${Math.round(s.watchBottom)} px${name === 'warning' ? `, warning ends ${Math.round(s.urgentBottom)} px` : ''})`);
    await p.screenshot({ path: path.join(out, `${name}-phone375-light.png`) }); await ctx.close();
  }
  /* dark phone and desktop views of the replay */
  for (const [file, opt] of [['replay-phone-dark', { theme: 'dark' }], ['replay-desktop-light', { device: DESK }]]) {
    const { ctx, p, errors } = await open(base, '', opt), s = await state(p);
    check(!s.hscroll && errors.length === 0 && (opt.device ? true : s.whenBottom <= s.vh), `${file}: lead on the first screen, no sideways scroll, no script errors`);
    await p.screenshot({ path: path.join(out, file + '.png') }); await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failed ? `${failed} event lead checks failed` : 'all event lead checks passed'); process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await browser.close(); } catch {} server.close(); process.exit(1); });
