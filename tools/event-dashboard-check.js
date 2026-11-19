#!/usr/bin/env node
/* Offline check of the Event Manager dashboard layout: briefing → timeline → details.
   Design case: tests/fixtures/event-orlando-data.js (synthetic Orlando match), plus a quiet match, a partly covered
   match, and the existing Cincinnati overnight and missing-hour fixtures. Real engines and page; data is synthetic.
   Usage: node tools/event-dashboard-check.js [screenshot-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { execFileSync } = require('node:child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-dashboard')); fs.mkdirSync(out, { recursive: true });
const ORL = fs.readFileSync(path.join(root, 'tests/fixtures/event-orlando-data.js'), 'utf8'), CIN = fs.readFileSync(path.join(root, 'tests/fixtures/event-polish-data.js'), 'utf8');
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html'); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
let failed = 0, browser = null; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 2 }, DESK = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

async function open(browser, base, { fixture, query = '', device = PHONE, theme = 'light', clock = null }) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')));
  if (clock) await p.clock.install({ time: new Date(clock) });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); window.print = () => {}; }, theme);
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== base) return r.fulfill({ status: 200, body: '' }); if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: fixture + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  await p.goto(`${base}/event-beta.html${query}`);
  const ok = await p.waitForFunction(() => document.body.dataset.loaded || document.body.dataset.readiness === 'pending', null, { timeout: 20000 }).then(() => true, () => false);
  if (!ok) throw new Error(`page did not load: decision "${await p.locator('#decision').innerText().catch(() => '?')}" errors ${errors.join('; ')}`);
  await p.waitForTimeout(300);
  return { ctx, p, errors };
}
const firstScreen = (p) => p.evaluate(() => { const vh = innerHeight, dd = [...document.querySelectorAll('#keys dd')], last = dd[dd.length - 1], r = (e) => e && e.getBoundingClientRect();
  return { decision: document.getElementById('decision').innerText, keys: [...document.querySelectorAll('#keys dt')].map((d) => d.textContent), callouts: [...document.querySelectorAll('#keys dd')].map((d) => d.innerText.replace(/\s+/g, ' ')),
    decisionBottom: r(document.getElementById('decision')).bottom, nextBottom: last ? r(last).bottom : 9999, vh, hscroll: document.documentElement.scrollWidth > innerWidth + 1,
    printTop: r(document.getElementById('printTop')).bottom <= vh && !document.getElementById('printTop').disabled }; });

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port; browser = await chromium.launch();
  /* ---- Orlando design case: phone and desktop, both themes ---- */
  for (const theme of ['light', 'dark']) for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
    const L = `orlando ${dev} ${theme}:`, { ctx, p, errors } = await open(browser, base, { fixture: ORL, device, theme });
    const f = await firstScreen(p);
    if (dev === 'phone') {
      check(f.nextBottom <= f.vh, `${L} decision, callouts and next check fit the first 390×664 screen (next check ends at ${Math.round(f.nextBottom)} px)`);
      check(f.printTop, `${L} Print / PDF is on the first screen and ready`);
    }
    check(!f.hscroll, `${L} no sideways page scroll`);
    if (theme === 'light' && dev === 'phone') {
      console.log('   decision: ' + f.decision.replace(/\n/g, ' ')); f.keys.forEach((k, i) => console.log(`   ${k}: ${f.callouts[i]}`));
      check(/rain/i.test(f.decision), `${L} the decision is about rain`);
      check(f.keys.join('|') === 'Rain chance|Lightning potential|Gusts|Next check', `${L} three callouts then the next check (${f.keys.join(', ')})`);
      check(/Across the planning window/.test(f.callouts[0]), `${L} rain affects the planning window`);
      check(/^(Moderate|High)/.test(f.callouts[1]) && /(Mainly|During) setup/.test(f.callouts[1]) && /not detected/.test(f.callouts[1]), `${L} lightning potential is mainly a setup concern, labelled as forecast potential`);
      check(/Reach your 25 mph limit/.test(f.callouts[2]) && /(Mainly|During) setup/.test(f.callouts[2]), `${L} gusts reach the 25 mph venue limit, mainly during setup`);
      check(f.callouts[3].length > 0, `${L} next check with its reason: ${f.callouts[3]}`);
      /* one schedule: the timeline's schedule row is the only phase strip on the page */
      const strips = await p.evaluate(() => ({ bars: document.querySelectorAll('#briefView .sch-bar, #briefView .sch-visual').length, axes: document.querySelectorAll('#briefView .at-axis, #briefView .sch-ticks').length, rows: [...document.querySelectorAll('#screenTracks [data-track]')].map((r) => r.dataset.track) }));
      check(strips.bars === 1 && strips.axes === 1 && strips.rows.join(',') === 'schedule,rain,wind,lightning', `${L} one schedule strip and one time axis in the timeline (${JSON.stringify(strips)})`);
      /* hourly selection */
      const btns = p.locator('#screenTracks .at-hb'); const n = await btns.count();
      await btns.nth(Math.floor(n * 0.2)).click(); await p.waitForTimeout(150);
      const a = await p.evaluate(() => ({ ro: document.getElementById('hourReadout').innerText, sel: +document.body.dataset.selected, pressed: +(document.querySelector('#screenTracks .at-hb[aria-pressed="true"]') || {}).dataset?.hour }));
      check(n > 6 && a.sel === a.pressed && /Rain chance/.test(a.ro) && /Temperature/.test(a.ro) && /Gusts/.test(a.ro) && /Lightning potential/.test(a.ro), `${L} tapping an hour shows its rain chance, temperature, gusts and lightning potential (${a.ro.split('\n')[0]})`);
      await p.locator('#secHourly > summary').click(); await p.waitForTimeout(400);
      const g = await p.evaluate(() => +document.querySelector('#evGrid .hg-hb[aria-pressed="true"]').dataset.ms);
      check(g === a.sel, `${L} the hourly table follows the same selected hour`);
      await p.locator('#secHourly > summary').click();
      const groups = await p.evaluate(() => [...document.querySelectorAll('#secDetails details.ev-group')].map((d) => `${d.querySelector('summary b').textContent}${d.open ? ' (open)' : ''}`));
      check(groups.length >= 4 && groups.every((x) => !/open/.test(x)), `${L} details grouped and closed by default: ${groups.join(' · ')}`);
    }
    await p.evaluate(() => scrollTo(0, 0));
    await p.screenshot({ path: path.join(out, `orlando-${dev}-${theme}.png`) });
    if (dev === 'phone' && theme === 'light') { await p.screenshot({ path: path.join(out, `orlando-phone-light-full.png`), fullPage: true });
      await p.locator('#secTimeline').screenshot({ path: path.join(out, 'orlando-timeline-phone.png') }); }
    if (dev === 'desktop' && theme === 'light') {
      await p.emulateMedia({ media: 'print' }); await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      const pdfPath = path.join(out, 'orlando-briefing.pdf'), pdf = await p.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
      const t = (n) => execFileSync('pdftotext', ['-layout', '-f', String(n), '-l', String(n), pdfPath, '-'], { encoding: 'utf8' });
      check(pages === 2 && /Which part needs attention/.test(t(1)) && /Hour by hour/.test(t(2)), `${L} PDF exports as two pages (got ${pages}), briefing then hourly detail`);
      try { execFileSync('pdftoppm', ['-r', '70', '-png', pdfPath, path.join(out, 'orlando-briefing')]); } catch {}
    }
    check(errors.length === 0, `${L} no script errors ${errors.join('; ')}`);
    await ctx.close();
  }
  /* ---- other cases: quiet, partly covered, and the Cincinnati overnight and missing-hour fixtures ---- */
  const cases = [['orlando quiet', { fixture: ORL, query: '?orl=quiet' }], ['orlando partly covered', { fixture: ORL, query: '?orl=partial' }],
    ['cincinnati overnight', { fixture: CIN, query: '?overnight=1', clock: '2026-11-11T20:30:00Z' }], ['cincinnati missing hour', { fixture: CIN, query: '?gaps=1', clock: '2026-11-11T20:30:00Z' }]];
  for (const [name, o] of cases) for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
    const L = `${name} ${dev}:`, { ctx, p, errors } = await open(browser, base, { ...o, device });
    const f = await firstScreen(p);
    if (dev === 'phone') check(f.nextBottom <= f.vh || /partly/.test(name), `${L} decision and next check on the first screen (${Math.round(f.nextBottom)} px)`);
    check(f.keys[f.keys.length - 1] === 'Next check' && f.keys.includes('Rain chance') && f.keys.includes('Lightning potential'), `${L} callouts end with the next check (${f.keys.join(', ')})`);
    check(!f.hscroll, `${L} no sideways page scroll`);
    if (name === 'orlando quiet') check(/No weather concern/.test(f.decision) && /below your 25 mph/i.test(f.callouts[2]) && !(await p.locator('#keys dd[data-tier]').count()), `${L} quiet: no concern, nothing highlighted (${f.decision})`);
    if (name === 'orlando partly covered') check(/partly covered|pending/i.test(await p.locator('#coverage').innerText()), `${L} partial coverage is stated next to the decision: ${(await p.locator('#coverage').innerText()).replace(/\s+/g, ' ').slice(0, 120)}`);
    if (name === 'cincinnati missing hour') { const gaps = await p.locator('#screenTracks .at-gap').count(); const btn = p.locator('#screenTracks .at-hb[data-hour="' + Date.parse('2026-11-12T19:00Z') + '"]'); await btn.click(); const ro = await p.locator('#hourReadout').innerText();
      check(gaps >= 3 && /no data|missing guidance/i.test(ro) && !/\b0%/.test(ro), `${L} missing hour stays missing in the timeline and the read-out (${ro.replace(/\s+/g, ' ').slice(0, 90)})`); }
    if (name === 'cincinnati overnight') check((await p.locator('#screenTracks .at-midnight').count()) >= 1, `${L} overnight timeline marks midnight on the one axis`);
    await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(out, `${name.replace(/\s+/g, '-')}-${dev}.png`) });
    check(errors.length === 0, `${L} no script errors ${errors.join('; ')}`);
    await ctx.close();
  }
})().catch((e) => { failed++; console.error(e); }).finally(async () => { if (browser) await browser.close().catch(() => {}); server.close(); console.log(failed ? `${failed} dashboard checks failed` : 'all dashboard checks passed'); process.exitCode = failed ? 1 : 0; });
