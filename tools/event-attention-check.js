#!/usr/bin/env node
/* Offline check of the Event Manager attention tracks and the two-page US Letter printout.
   Synthetic fixture only (tests/fixtures/event-polish-data.js); engines, layout and printing are real.
   Writes each scenario's PDF, plus grayscale PNGs of both pages, to the directory given (default: <tmp>/event-attention).
   Usage: node tools/event-attention-check.js [output-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-attention')); fs.mkdirSync(out, { recursive: true });
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/event-polish-data.js'), 'utf8');
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html'); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
let browser, failed = 0;
const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const hourOf = ms => +new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
const SCENARIOS = ['base', 'quiet', 'setuprain', 'gusty', 'phaseonly', 'storm', 'gaps', 'overnight', 'long', 'laterain', 'area', 'longnws', 'long+longnws'];
const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port; browser = await chromium.launch();
  for (const sc of SCENARIOS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 960 }, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message)); await p.clock.install({ time: new Date('2026-11-11T20:30:00Z') });
    await p.addInitScript(() => { localStorage.setItem('ops_theme', JSON.stringify('light')); localStorage.setItem('beta_analytics_optout', '1'); window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.origin !== base) return r.fulfill({ status: 200, body: '', contentType: u.pathname.endsWith('.js') ? 'application/javascript' : 'text/plain' }); if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: fixture + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
    await p.goto(base + '/event-beta.html' + (sc === 'base' ? '' : '?' + sc.split('+').map(k => k + '=1').join('&'))); await p.waitForFunction(() => document.body.dataset.loaded, { timeout: 15000 });
    if (sc === 'base') {
      const top = await p.evaluate(() => { const b = document.getElementById('printTop'), r = b.getBoundingClientRect(); return { text: b.innerText, disabled: b.disabled, inView: r.top >= 0 && r.bottom <= innerHeight, beforeDecision: !!(b.compareDocumentPosition(document.getElementById('decision')) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
      check(/Print \/ PDF/.test(top.text) && !top.disabled && top.inView && top.beforeDecision, 'top Print / PDF button is enabled, above the decision and in the first screen ' + JSON.stringify(top));
      await p.locator('#printTop').click();
      check(await p.evaluate(() => window.__printed === 1 && document.querySelectorAll('#printView .pv-page').length === 2), 'top Print button builds the two-page printout and opens printing');
      await p.setViewportSize({ width: 390, height: 664 });
      check(await p.evaluate(() => { const r = document.getElementById('printTop').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth + 1; }), 'top Print button is in the first phone screen without side scrolling');
      await p.setViewportSize({ width: 1280, height: 960 });
    }
    const L = sc + ':', file = sc.replace(/\+/g, '-');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), L + ' no horizontal page overflow on screen');
    await p.emulateMedia({ media: 'print' }); await p.setViewportSize({ width: Math.round(7.4 * 96), height: 1056 }); await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const pdfPath = path.join(out, `attention-${file}.pdf`);
    const pdf = await p.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length; check(pages === 2, L + ' prints exactly two US Letter pages (got ' + pages + ')');
    /* what actually landed on each PDF page (the DOM measurement alone missed a three-page PDF) */
    const pageText = n => execFileSync('pdftotext', ['-layout', '-f', String(n), '-l', String(n), pdfPath, '-'], { encoding: 'utf8' });
    if (pages >= 2) { const t1 = pageText(1), t2 = pageText(2);
      check(/Needs attention/.test(t1) && /Which part needs attention/.test(t1) && /Next check/.test(t1) && /Official NWS forecast/.test(t1) && /When to check again/.test(t1) && /1 ?\/ ?2/.test(t1), L + ' PDF page 1 holds the decision, tracks, NWS block, check-ins and its own footer');
      check(/Hour by hour/.test(t2) && /HOUR \/ PHASE/i.test(t2) && /2 ?\/ ?2/.test(t2) && !/Official NWS forecast/.test(t2), L + ' PDF page 2 holds the hourly detail and nothing from page 1'); }
    try { execFileSync('pdftoppm', ['-r', '70', '-gray', '-png', pdfPath, path.join(out, `attention-${file}`)]); } catch (e) { console.log('note: grayscale render skipped (' + e.message + ')'); }
    /* clipping: nothing on a page extends past its sides, and page-one content ends above its footer */
    const clip = await p.evaluate(() => [...document.querySelectorAll('.pv-page')].map(pg => { const r = pg.getBoundingClientRect(), f = pg.querySelector('.pv-footer').getBoundingClientRect();
      const kids = [...pg.querySelectorAll('*')].filter(e => !e.closest('.pv-footer') && e.getClientRects().length);
      const wide = kids.filter(e => { const b = e.getBoundingClientRect(); return b.right > r.right + 1 || b.left < r.left - 1; }).map(e => e.className || e.tagName);
      const bottom = Math.max(...kids.map(e => e.getBoundingClientRect().bottom));
      const cut = [...pg.querySelectorAll('td,th,dd,li,.at-list span,.pv-hours-window')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className || e.tagName);
      return { wide: wide.slice(0, 4), cut: cut.slice(0, 4), room: f.top - bottom }; }));
    clip.forEach((c, i) => { check(!c.wide.length && !c.cut.length, `${L} page ${i + 1} has no clipped or overflowing elements ${JSON.stringify(c.wide.concat(c.cut))}`); check(c.room >= 0, `${L} page ${i + 1} content ends above the footer (${Math.round(c.room)} px to spare)`); });
    const p1 = await p.locator('.pv-p1').innerText(), p2 = await p.locator('.pv-p2').innerText(), keys = await p.locator('.pv-keys').innerText();
    check(/Needs attention/.test(keys) && /Next check/.test(keys) && p1.indexOf('Needs attention') < p1.indexOf('Which part needs attention'), L + ' page 1 leads with the decision, the main window and the next check');
    check(await p.locator('#pvTracks .at-main').count() === 1 && /Event/.test(await p.locator('#pvTracks .at-main').innerText()), L + ' main event is singled out on the schedule track');
    check(/forecast potential/i.test(p1) && /not detected/.test(p1 + p2), L + ' lightning is labelled forecast potential, not detection');
    check(/Hours shown:/.test(p2), L + ' page 2 states which hours it shows');
    /* grayscale: value, rule hit, missing and background stay distinguishable without colour */
    const sw = await p.evaluate(() => { const g = s => getComputedStyle(document.querySelector('#pvTracks ' + s)).backgroundColor; return { val: g('.at-key .k-val'), hit: g('.at-key .k-hit'), bg: getComputedStyle(document.querySelector('#pvTracks .at-track')).backgroundColor, gapImg: getComputedStyle(document.querySelector('#pvTracks .at-key .k-gap')).backgroundImage }; });
    check(contrast(sw.val, sw.hit) >= 3 && contrast(sw.val, sw.bg) >= 2 && /repeating-linear-gradient/.test(sw.gapImg), L + ' grayscale-safe: hit vs value ' + contrast(sw.val, sw.hit).toFixed(1) + ':1, value vs track ' + contrast(sw.val, sw.bg).toFixed(1) + ':1, missing is hatched');
    const hits = track => p.evaluate(t => [...document.querySelectorAll(`#pvTracks [data-track=${t}] .at-hit`)].map(e => +e.dataset.ms), track);
    const items = await p.evaluate(() => [...document.querySelectorAll('.pv-p1 .at-list li[data-key]')].map(e => ({ key: e.dataset.key, text: e.innerText })));
    if (sc === 'quiet') {
      check((await hits('rain')).length === 0 && (await hits('wind')).length === 0 && (await hits('lightning')).length === 0, L + ' quiet event shows no rule hits on any track');
      check(/Nothing in the schedule needs weather attention/.test(keys) && await p.locator('.pv-p1 .at-none').count() === 1, L + ' quiet event says so plainly on page 1');
    }
    if (sc === 'setuprain') {
      const h = await hits('rain'); check(h.length === 4 && h.every(m => hourOf(m) >= 12 && hourOf(m) < 16), L + ' rain hits mark only the setup hours (' + h.map(hourOf) + ')');
      check(items[0] && items[0].key === 'rain' && /Setup · Thu 12 PM–4 PM/.test(items[0].text) && !/Event/.test(items[0].text), L + ' first window is rain during setup: ' + (items[0] && items[0].text.replace(/\n/g, ' ')));
      check(/Rain/.test(keys) && /Setup/.test(keys), L + ' Needs attention names rain during setup');
    }
    if (sc === 'gusty') {
      const h = await hits('wind'); check(h.length === 3 && h.every(m => hourOf(m) >= 18 && hourOf(m) < 21), L + ' gust hits are the three hours at or above the 25 mph limit (' + h.map(hourOf) + ')');
      check(await p.locator('#pvTracks [data-track=wind] .at-limit').count() === 1 && /25 mph limit/.test(await p.locator('#pvTracks [data-track=wind] > b').innerText()), L + ' venue limit line is drawn on the gust track and named');
      const w = items.find(x => x.key === 'wind'); check(!!w && /Gusts reach your 25 mph limit/.test(w.text) && /up to 33 mph/.test(w.text) && /Event · /.test(w.text), L + ' window list names the limit crossing: ' + (w && w.text.replace(/\n/g, ' ')));
      check(await p.locator('.pv-hours td[data-over]').count() === 3, L + ' page 2 marks the same three gust hours as at or above the limit');
    }
    if (sc === 'phaseonly') {
      check((await hits('rain')).length === 0 && items.some(x => x.key === 'rain' && /Setup · exact time uncertain/.test(x.text)), L + ' setup rated for rain with no qualifying hour names the phase, not an hour');
      check(/exact time uncertain/.test(keys) && /Setup/.test(keys), L + ' Needs attention names the phase and leaves timing uncertain');
    }
    if (sc === 'storm') {
      const h = await hits('lightning'); check(h.length === 2 && h.every(m => hourOf(m) >= 19 && hourOf(m) < 21), L + ' lightning potential marks the raised hours (' + h.map(hourOf) + ')');
      check(items.some(x => x.key === 'lightning' && /a forecast, not detected lightning/.test(x.text)), L + ' lightning window says forecast, not detected');
    }
    if (sc === 'gaps') {
      const g = await p.evaluate(() => ['rain', 'wind', 'lightning'].map(t => document.querySelectorAll(`#pvTracks [data-track=${t}] .at-gap`).length));
      check(g.every(n => n >= 1), L + ' missing guidance is hatched on every track (' + g + ')');
      check(await p.evaluate(() => [...document.querySelectorAll('#pvTracks .at-gap')].every(e => !e.classList.contains('at-hit') && e.dataset.v === undefined)), L + ' missing hours carry no value and no rule hit');
    }
    if (sc === 'overnight') {
      check(await p.locator('#pvTracks .at-midnight').count() >= 1, L + ' overnight event marks midnight on the tracks');
      check(/Nov 12/.test(p2) && /Nov 13/.test(p2), L + ' page 2 names both dates');
      const h = await hits('rain'); check(h.length === 2 && h.every(m => hourOf(m) >= 1 && hourOf(m) < 3), L + ' after-midnight rain is placed in the event (' + h.map(hourOf) + ')');
    }
    if (/longnws/.test(sc)) {
      const nws = await p.locator('.pv-nws').innerText(), items = await p.locator('.pv-nws li').count();
      check(items >= 1 && items <= 2, L + ' printed NWS block shows at most two periods (' + items + ')');
      check(/^Thursday:/.test(nws.trim()), L + ' the period overlapping the main event leads, with its label');
      check(/thunder/i.test(await p.locator('.pv-next').innerText()), L + ' a thunder mention in an official period survives shortening');
      check(/on-screen briefing/.test(await p.locator('.pv-next').innerText()), L + ' shortened NWS wording points to the on-screen briefing');
    }
    if (sc === 'base') check(!/on-screen briefing for the full/.test(await p.locator('.pv-next').innerText()), L + ' short NWS wording prints in full with no pointer');
    if (sc === 'long') {
      check(/First 24 hours only/.test(p2) && await p.locator('#pvTracks .at-p2row').count() === 1, L + ' multi-day event labels the page 2 hours, in text and on the graphic');
    }
    if (sc === 'laterain') {
      const r = await p.locator('.pv-hours-window').getAttribute('data-page-hours'), [a] = r.split('-').map(Number);
      check(a > 0 && /24 of \d+ planning hours/.test(p2) && /chosen to include the first concern/.test(p2) && /open the briefing for the rest/.test(p2), L + ' page 2 moves to the main window when it falls after the first 24 hours (from hour ' + a + ')');
      const rows = await p.evaluate(() => [...document.querySelectorAll('.pv-hours tbody tr')].map(e => +e.dataset.ms)), w = await hits('rain');
      check(w.length > 0 && rows.includes(w[0]), L + ' the first rain hour is on page 2');
    }
    if (sc === 'area') {
      check(/City-area forecast for planning/.test(p1) && /City-area forecast at/.test(p2) && /\(area forecast\)/.test(p1), L + ' city-area forecast is labelled on both pages');
    }
    check(errors.length === 0, L + ' no script errors ' + errors.join('; '));
    await ctx.close();
  }
})().catch(e => { failed++; console.error(e); }).finally(async () => { if (browser) await browser.close(); server.close(); console.log(failed ? failed + ' attention checks failed' : 'all attention checks passed'); process.exitCode = failed ? 1 : 0; });
