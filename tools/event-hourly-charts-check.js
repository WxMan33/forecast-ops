#!/usr/bin/env node
/* Offline check of the Event Manager "Hour by hour" charts (event-hourly-charts.js) on synthetic events
   (tests/fixtures/event-winter-data.js): all rain, a rain → mix → snow transition, missing hours, and NWS disagreeing
   with the blend on type. Real page and engines; data is synthetic. Phone and desktop; screenshots of each case.
   Usage: node tools/event-hourly-charts-check.js [screenshot-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-hourly-charts')); fs.mkdirSync(out, { recursive: true });
const FIXES = { winter: fs.readFileSync(path.join(root, 'tests/fixtures/event-winter-data.js'), 'utf8'), orlando: fs.readFileSync(path.join(root, 'tests/fixtures/event-orlando-data.js'), 'utf8') };
let FIX = FIXES.winter;
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res); });
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 2 }, DESK = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

async function open(browser, base, wx, device, theme) {
  const ctx = await browser.newContext({ ...device, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); window.print = () => {}; }, theme);
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== base) return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: FIX + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  await p.goto(`${base}/event-beta.html?wx=${wx}`);
  await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 20000 });
  await p.evaluate(() => { const d = document.getElementById('secHourly'); d.open = true; d.scrollIntoView(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const facts = (p) => p.evaluate(() => {
  const card = (k) => document.querySelector(`#evCharts [data-variable="${k}"]`), pop = card('pop');
  const fontPx = (sel) => { const e = document.querySelector(sel); return e ? parseFloat(getComputedStyle(e).fontSize) * (e.ownerSVGElement ? e.ownerSVGElement.getBoundingClientRect().width / e.ownerSVGElement.viewBox.baseVal.width : 1) : 0; };
  return {
    cards: document.querySelectorAll('#evCharts .evc-card').length,
    bars: pop.querySelectorAll('.evc-bar').length, dots: pop.querySelectorAll('.evc-dot').length, hours: pop.querySelectorAll('[data-hour]').length,
    gaps: pop.querySelectorAll('.evc-gap').length, gapCards: [...document.querySelectorAll('#evCharts .evc-card')].filter((c) => c.querySelector('.evc-gap')).length,
    segments: (pop.querySelector('.evc-line').getAttribute('d').match(/M/g) || []).length,
    gapInside: (() => { const hs = [...pop.querySelectorAll('[data-hour]')], miss = hs.map((g) => !pop.querySelector(`.evc-dot[cx="${g.querySelector('rect').getAttribute('x') * 1 + g.querySelector('rect').getAttribute('width') / 2}"]`)); const k = miss.indexOf(true); return k > 0 && miss.lastIndexOf(true) < miss.length - 1; })(),
    ticks: [...pop.querySelectorAll('.evc-axis')].map((t) => t.textContent).filter((t) => /%$/.test(t)),
    bands: [...pop.querySelectorAll('.evc-band')].map((b) => b.dataset.type), bandLabels: [...pop.querySelectorAll('[data-type-label]')].map((t) => t.dataset.typeLabel + ':' + t.textContent),
    summary: (pop.querySelector('[data-type-summary]') || {}).textContent || null, legend: pop.querySelector('.evc-legend').innerText.replace(/\s+/g, ' '),
    wash: document.querySelectorAll('#evCharts rect[opacity=".13"]').length, flags: [...document.querySelectorAll('#evCharts .evc-flag')].map((f) => f.textContent),
    unlabeledFlags: [...document.querySelectorAll('#evCharts .evc-flag')].filter((f) => !f.textContent.trim()).length,
    redOutsideFlags: [...document.querySelectorAll('#evCharts svg *')].filter((e) => !e.closest('.evc-flag-high') && /rgb\((2[0-5]\d|1[89]\d), ?([0-6]?\d), ?([0-6]?\d)\)/.test(getComputedStyle(e).fill)).length,
    hourPx: fontPx('#evCharts .evc-hour'), valuePx: parseFloat(getComputedStyle(document.querySelector('#evCharts .evc-val>b')).fontSize),
    lightningNote: card('lightning').querySelector('header').innerText, amount: (pop.querySelector('[data-amount]') || {}).textContent, chance: pop.querySelector('[data-value="pop"]').textContent,
    legends: [...document.querySelectorAll('#evCharts .evc-card')].every((c) => c.querySelector('.evc-legend')), oldNote: !!document.querySelector('#evCharts .evc-note'),
    fits: [...document.querySelectorAll('.evc-card')].every((e) => e.scrollWidth <= e.clientWidth + 1),
  };
});

(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) for (const [wx, theme] of [['allrain', 'light'], ['transition', 'light'], ['gaps', 'dark'], ['unc', 'light']]) {
      const L = `${dev} ${wx}:`, { ctx, p, errors } = await open(browser, base, wx, device, theme);
      if (dev === 'phone' && wx !== 'allrain') { await p.click('#evCharts [data-move="1"]'); await p.waitForTimeout(200); } // the phone shows 6 hours: page to the evening ones
      const f = await facts(p);
      check(f.cards === 4 && f.legends && !f.oldNote && f.fits, `${L} four charts, each with its own key; no shared footnote; no side scrolling`);
      check(f.bars === 0 && f.dots === f.hours - f.gaps && JSON.stringify(f.ticks) === '["0%","50%","100%"]', `${L} precipitation chance is a line with a dot per forecast hour on 0–100% (${f.dots} dots, ${f.hours} hours, ticks ${f.ticks.join(' ')})`);
      check(f.wash === 0 && f.unlabeledFlags === 0 && f.redOutsideFlags === 0, `${L} no unlabelled concern wash; flags labelled (${f.flags.join(' | ') || 'none'}); red only on labelled high-priority flags`);
      check(f.hourPx >= 13.5 && f.valuePx >= 22, `${L} readable: hour labels ${f.hourPx.toFixed(1)} px, selected values ${f.valuePx} px`);
      check(/not detected lightning or a warning/.test(f.lightningNote), `${L} lightning is labelled forecast potential, not detected lightning or a warning`);
      check(/^\d|—/.test(f.amount || '') && f.amount !== f.chance, `${L} selected amount shown separately from chance (chance ${f.chance}, amount ${f.amount})`);
      if (wx === 'allrain') check(f.bands.length === 0 && f.summary === 'Type: rain', `${L} all rain: no bands, just "${f.summary}"`);
      if (wx === 'transition') check(new Set(f.bands).size >= 2 && f.bands.every((b) => ['rain', 'mix', 'snow'].includes(b)) && f.bandLabels.some((l) => /Snow/.test(l)) && /Rain.*Mix.*Snow/.test(f.legend), `${L} type change: labelled bands ${[...new Set(f.bands)].join(', ')} (${f.bandLabels.join(' | ')})`);
      if (wx === 'gaps') check(f.gaps >= 1 && f.gapCards === 4 && (f.segments >= 2 || !f.gapInside), `${L} missing hours: gap in all four charts, chance line broken around them (${f.segments} segments${f.gapInside ? '' : ', gap at the window edge'}), not drawn as 0%`);
      if (wx === 'unc') check(f.bandLabels.some((l) => /^uncertain:/.test(l)) && !f.bands.includes('uncertain'), `${L} blend and NWS disagree: hours labelled "Type uncertain" and left unshaded (${f.bandLabels.join(' | ')})`);
      /* the shared hour selection still drives every chart */
      const hours = p.locator('#evCharts [data-variable=pop] [data-hour]'), n = await hours.count(); await hours.nth(Math.min(n - 1, 4)).click(); await p.waitForTimeout(150);
      const s = await p.evaluate(() => ({ sel: +document.body.dataset.selected, cols: [...document.querySelectorAll('#evCharts .evc-card')].map((c) => (c.querySelector('[aria-pressed="true"]') || {}).dataset?.hour) }));
      check(s.cols.every((h) => +h === s.sel), `${L} selecting an hour in one chart selects it in all four and on the page`);
      await p.locator('#evCharts').screenshot({ path: path.join(out, `hourly-${wx}-${dev}-${theme}.png`) });
      check(errors.length === 0, `${L} no script errors ${errors.join('; ')}`);
      await ctx.close();
    }
    /* ---- Export hourly image (1920 x 1080 PNG) and the hourly display link ---- */
    for (const [fixName, wx, expectLightning, expectType] of [['winter', 'transition', 'low-throughout', 'bands'], ['winter', 'allrain', 'low-throughout', 'rain'], ['winter', 'gaps', 'blocks', 'bands'], ['orlando', 'storm', 'blocks', 'rain']]) {
      FIX = FIXES[fixName]; const L = `export ${fixName} ${wx}:`;
      const { ctx, p, errors } = await open(browser, base, wx === 'storm' ? 'x&orl=storm' : wx, DESK, 'light');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#tvExport')]);
      const file = path.join(out, `tv-${fixName}-${wx}.png`); await dl.saveAs(file);
      const png = fs.readFileSync(file), w = png.readUInt32BE(16), h = png.readUInt32BE(20);
      const info = await p.evaluate(() => { const L = window.__lastHourly; const c = window.EventTvExport.draw(document.createElement('canvas'), L); return { min: c.minFontPx, lightning: c.lightning, type: c.typeMode, msg: document.getElementById('hourlyShareMsg').textContent }; });
      check(png.slice(1, 4).toString() === 'PNG' && w === 1920 && h === 1080 && /1920 × 1080/.test(info.msg), `${L} downloads a 1920 × 1080 PNG (${dl.suggestedFilename()}, ${Math.round(png.length / 1024)} KB)`);
      check(info.min >= 20, `${L} TV readability: smallest text ${info.min} px on a 1080-line image`);
      check(info.lightning === expectLightning && info.type === expectType, `${L} lightning ${info.lightning}, precipitation type ${info.type}`);
      check(errors.length === 0, `${L} no script errors ${errors.join('; ')}`);
      if (wx === 'transition') {
        /* theme choice: explicit Light / Dark, and Match page theme (this page is light) */
        for (const [choice, want] of [['dark', 'dark'], ['light', 'light'], ['match', 'light']]) {
          await p.selectOption('#tvTheme', choice);
          const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#tvExport')]);
          const f2 = path.join(out, `tv-${fixName}-${wx}-${choice}.png`); await d2.saveAs(f2);
          const px = await p.evaluate((t) => { const c = window.EventTvExport.draw(document.createElement('canvas'), { ...window.__lastHourly, theme: t }); return [...c.getContext('2d').getImageData(4, 4, 1, 1).data].slice(0, 3); }, want);
          const dark = px.reduce((a, b) => a + b, 0) / 3 < 40, png2 = fs.readFileSync(f2);
          check(new RegExp(`-${want}-1920x1080-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.png$`).test(d2.suggestedFilename()) && png2.readUInt32BE(16) === 1920 && png2.readUInt32BE(20) === 1080 && dark === (want === 'dark'),
            `${L} "${choice}" exports a ${want} 1920 × 1080 PNG (${d2.suggestedFilename()}, background rgb(${px.join(',')}))`);
        }
        /* the hourly display link: a signed-out browser (fresh context, no storage) opens straight to the charts */
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); await p.click('#hourlyCopy');
        const url = await p.evaluate(() => navigator.clipboard.readText()); await ctx.close();
        const ctx2 = await browser.newContext({ ...DESK, timezoneId: 'America/New_York' }), q = await ctx2.newPage(), errs2 = []; q.on('pageerror', (e) => errs2.push(e.message));
        await ctx2.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== base) return r.fulfill({ status: 200, body: '' });
          if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: FIX + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
        await q.goto(url); await q.waitForFunction(() => document.querySelector('#evCharts .evc-card'), null, { timeout: 20000 }); await q.waitForTimeout(500);
        const v = await q.evaluate(() => ({ open: document.getElementById('secHourly').open, top: Math.round(document.getElementById('secHourly').getBoundingClientRect().top), name: document.getElementById('evName').textContent, stored: Object.keys(localStorage).filter((k) => /beta_events/.test(k)).length }));
        check(/#hourly$/.test(url) && /[?&]e=/.test(url) && v.open && v.top < 200 && /FC Cincinnati/.test(v.name) && !errs2.length, `display link opens the hourly charts in a signed-out browser (section open, ${v.top}px from top, "${v.name}")`);
        await ctx2.close();
      } else await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all hourly chart checks passed'); process.exit(failed ? 1 : 0);
})();
