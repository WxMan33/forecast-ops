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
      check(/What to plan for/.test(t1) && /Event schedule/.test(t1) && /Next weather check/.test(t1) && /Official NWS forecast/.test(t1) && /1 ?\/ ?2/.test(t1), L + ' PDF page 1 holds the headline, what to plan for, the schedule, the next check, NWS wording and its own footer');
      check(/Hours shown/.test(t2) && /Local time/.test(t2) && /Lightning/.test(t2) && /2 ?\/ ?2/.test(t2) && !/What to plan for/.test(t2), L + ' PDF page 2 holds the hourly table and nothing from page 1'); }
    try { execFileSync('pdftoppm', ['-r', '70', '-gray', '-png', pdfPath, path.join(out, `attention-${file}`)]); } catch (e) { console.log('note: grayscale render skipped (' + e.message + ')'); }
    /* clipping: nothing on a page extends past its sides, and page-one content ends above its footer */
    const clip = await p.evaluate(() => [...document.querySelectorAll('.pv-page')].map(pg => { const r = pg.getBoundingClientRect(), f = pg.querySelector('.pv-footer').getBoundingClientRect();
      const kids = [...pg.querySelectorAll('*')].filter(e => !e.closest('.pv-footer') && e.getClientRects().length);
      const wide = kids.filter(e => { const b = e.getBoundingClientRect(); return b.right > r.right + 1 || b.left < r.left - 1; }).map(e => e.className || e.tagName);
      const bottom = Math.max(...kids.map(e => e.getBoundingClientRect().bottom));
      const cut = [...pg.querySelectorAll('td,th,dd,li,.pv-hours-window')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className || e.tagName);
      return { wide: wide.slice(0, 4), cut: cut.slice(0, 4), room: f.top - bottom }; }));
    clip.forEach((c, i) => { check(!c.wide.length && !c.cut.length, `${L} page ${i + 1} has no clipped or overflowing elements ${JSON.stringify(c.wide.concat(c.cut))}`); check(c.room >= 0, `${L} page ${i + 1} content ends above the footer (${Math.round(c.room)} px to spare)`); });
    const p1 = await p.locator('.pv-p1').innerText(), p2 = await p.locator('.pv-p2').innerText();
    const plan = await p.evaluate(() => [...document.querySelectorAll('.pv-plan li[data-key]')].map((e) => ({ key: e.dataset.key, text: e.innerText })));
    const line = (k) => (plan.find((x) => x.key === k) || {}).text || '';
    /* the lead (headline, timing, what would change, next weather check) comes first; then what to plan for and the schedule */
    check(p1.indexOf('Next weather check') > 0 && p1.indexOf('Next weather check') < p1.indexOf('What to plan for') && p1.indexOf('What to plan for') < p1.indexOf('Event schedule'), L + ' page 1 reads lead (headline → what would change → next weather check) → what to plan for → schedule');
    check(await p.locator('.pv-p1 .pv-sched li').count() === 4 && await p.locator('#printView .at, #printView .pv-keys, #printView .pv-phases').count() === 0, L + ' one four-part schedule; no bar chart, key facts list or phase table');
    check(/not detected lightning/.test(p1) && /not detected lightning/.test(p2), L + ' lightning is labelled a forecast, not detection, on both pages');
    check(!/model sources|ensemble|Guidance support|\d+\.\d{3,}/i.test(p1 + p2), L + ' model counts, ensemble names, diagnostics and coordinates stay on the website');
    check(/Hours shown:/.test(p2), L + ' page 2 states which hours it shows');
    /* black-and-white: no fills behind text, dark text, and labels that work without colour */
    const bw = await p.evaluate(() => { const els = [...document.querySelectorAll('#printView .pv-page *')], lum = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return m.length >= 3 ? (m.length > 3 && m[3] === 0 ? 1 : (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255) : 1; };
      return { fills: els.filter((e) => { const bg = getComputedStyle(e).backgroundColor; return !/rgba\(0, 0, 0, 0\)|transparent/.test(bg) && lum(bg) < 0.97; }).length, lightText: els.filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && lum(getComputedStyle(e).color) > 0.5).length }; });
    check(bw.fills === 0 && bw.lightText === 0, L + ` black-and-white safe: no shaded fills (${bw.fills}), no pale text (${bw.lightText})`);
    if (sc === 'quiet') {
      check(/^No weather concern/.test(plan[0] && plan[0].text) && await p.locator('.pv-hours td[data-over]').count() === 0, L + ' quiet event says so plainly on page 1: ' + (plan[0] && plan[0].text));
    }
    if (sc === 'setuprain') {
      check(/^Plan for rain during setup \(12–4 PM\)/.test(line('rain')) && !/event/i.test(line('rain')), L + ' rain line names setup and its hours: ' + line('rain'));
    }
    if (sc === 'gusty') {
      check(/^Gusts may reach the venue’s 25 mph limit during event \(6–9 PM\); up to 33 mph\./.test(line('wind')), L + ' gust line names the limit crossing and its hours: ' + line('wind'));
      check(await p.locator('.pv-hours td[data-over]').count() === 3 && (await p.locator('.pv-hours td[data-over] small').allInnerTexts()).every((t) => t === 'Reaches 25 mph venue limit'), L + ' page 2 marks the same three gust hours "Reaches 25 mph venue limit"');
    }
    if (sc === 'phaseonly') {
      check(/rain during setup; exact time uncertain/.test(line('rain')), L + ' setup rated for rain with no qualifying hour names the phase and leaves timing uncertain: ' + line('rain'));
    }
    if (sc === 'storm') {
      check(/^Moderate lightning potential during event \(7–9 PM\)\. This is a forecast, not detected lightning\./.test(line('lightning')), L + ' lightning line says when, and that it is a forecast: ' + line('lightning'));
    }
    if (sc === 'gaps') {
      check(await p.locator('.pv-hours tr[data-ms="' + Date.parse('2026-11-12T19:00Z') + '"] .pv-nd').count() === 5, L + ' a missing hour reads "no data" in every value column (temp, rain chance, rain amount, gusts, lightning)');
    }
    if (sc === 'overnight') {
      check(/Thu, Nov 12/.test(p2) && /Fri, Nov 13/.test(p2), L + ' page 2 labels both dates');
      check(/during late event \(Fri 1–3 AM\)/.test(line('rain')) && /Fri 3–5 AM/.test(p1), L + ' after-midnight rain and the overnight schedule keep their day: ' + line('rain'));
    }
    if (/longnws/.test(sc)) {
      const nws = await p.locator('.pv-nws').innerText(), items = await p.locator('.pv-nws li').count();
      check(items >= 1 && items <= 2, L + ' printed NWS block shows at most two periods (' + items + ')');
      check(/^Thursday:/.test(nws.trim()), L + ' the period overlapping the main event leads, with its label');
      check(/thunder/i.test(nws), L + ' a thunder mention in an official period survives shortening');
      check(/full wording on the website/.test(p1), L + ' shortened NWS wording points to the website for the full text');
    }
    if (sc === 'base') check(!/full wording on the website/.test(p1), L + ' short NWS wording prints in full with no pointer');
    if (sc === 'long') {
      check(/First 24 hours only/.test(p2) && /open the briefing for the rest/.test(p2), L + ' multi-day event labels the page 2 hours and where the rest is');
    }
    if (sc === 'laterain') {
      const r = await p.locator('.pv-hours-window').getAttribute('data-page-hours'), [a] = r.split('-').map(Number);
      check(a > 0 && /24 of \d+ planning hours/.test(p2) && /chosen to include the first concern/.test(p2) && /open the briefing for the rest/.test(p2), L + ' page 2 moves to the main window when it falls after the first 24 hours (from hour ' + a + ')');
      const rows = await p.evaluate(() => [...document.querySelectorAll('.pv-hours tbody tr')].map(e => e.querySelector('[data-pop]').textContent));
      check(rows.includes('80%'), L + ' the 80% rain hours of window 1 are on page 2');
    }
    if (sc === 'area') {
      check(/City-area forecast for planning/.test(p1) && /City-area forecast, not site-specific/.test(p2) && /\(area forecast\)/.test(p1), L + ' city-area forecast is labelled on both pages');
    }
    check(errors.length === 0, L + ' no script errors ' + errors.join('; '));
    await ctx.close();
  }
})().catch(e => { failed++; console.error(e); }).finally(async () => { if (browser) await browser.close(); server.close(); console.log(failed ? failed + ' attention checks failed' : 'all attention checks passed'); process.exitCode = failed ? 1 : 0; });
