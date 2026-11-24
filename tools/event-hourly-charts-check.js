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
    /* ---- "At a glance" dashboard under the callouts: tiles, the flagged-hours window, tap to select ---- */
    const dashFacts = (p) => p.evaluate(() => {
      const d = document.getElementById('evDash'), H = 3600e3, r = (e) => e.getBoundingClientRect();
      const tiles = Object.fromEntries([...d.querySelectorAll('.evd-tile')].map((t) => [t.dataset.tile, { value: t.querySelector('[data-value]').textContent, text: t.innerText.replace(/\s+/g, ' '), tier: t.dataset.tier || null, badge: (t.querySelector('[data-level]') || {}).textContent || null }]));
      const rowKey = { rain: 'hz-rain', wind: 'hz-wind', snow: 'hz-snow', lightning: 'lightning' };
      /* the concern hours the hourly table shows for each hazard vs the hours the window bar colours */
      const rows = [...d.querySelectorAll('.evd-row')].map((row) => { const k = row.dataset.hazard, tr = document.querySelector(`#evGrid tr[data-row="${rowKey[k] || 'hz-' + k}"]`);
        const want = tr ? [...tr.querySelectorAll('td.hg-s-concern')].map((td) => `${td.dataset.ms}:${[...td.classList].find((c) => /^hg-t-/.test(c)).slice(5)}`) : ['no row'];
        const got = [...row.querySelectorAll('.evd-fill')].flatMap((f) => { const out = []; for (let m = Math.floor(+f.dataset.from / H) * H; m < +f.dataset.to; m += H) out.push(`${m}:${f.dataset.tier}`); return out; });
        return { key: k, label: row.querySelector('.evd-rowlab').innerText.replace(/\s+/g, ' '), match: JSON.stringify(want) === JSON.stringify(got), want: want.length, got: got.length }; });
      const segs = [...d.querySelectorAll('.evd-seg')].map((b) => r(b)), cols = new Set([...d.querySelectorAll('.evd-tile')].map((t) => Math.round(r(t).top))).size;
      const firstRow = [...d.querySelectorAll('.evd-tile')].filter((t, i, a) => Math.round(r(t).top) === Math.round(r(a[0]).top)).length;
      const cs = getComputedStyle(d.querySelector('.evd'));
      return { visible: !d.hidden && r(d).height > 0, afterCallouts: !!(document.getElementById('keys').compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(d.compareDocumentPosition(document.getElementById('secTimeline')) & Node.DOCUMENT_POSITION_FOLLOWING),
        heading: (d.querySelector('h2') || {}).textContent, tiles, rows, none: (d.querySelector('[data-none]') || {}).textContent || null, gustLine: (d.querySelector('[data-gust-line]') || {}).textContent || null,
        types: [...d.querySelectorAll('.evd-chip')].map((c) => c.textContent.replace(/[^A-Za-z]/g, '')).join('>'), oldStrip: document.querySelectorAll('.evc-totals').length,
        valuePx: Math.min(...[...d.querySelectorAll('.evd-val b')].map((b) => parseFloat(getComputedStyle(b).fontSize))), chartValuePx: 22, firstRow, rowsOfTiles: cols,
        targets: segs.every((b) => b.width >= 43.5 && b.height >= 43.5), segsInside: segs.every((b) => b.left >= r(d).left - 1 && b.right <= r(d).right + 1),
        hscroll: document.documentElement.scrollWidth > innerWidth + 1, overflow: d.scrollWidth > d.clientWidth + 1, panel: cs.backgroundColor, text: getComputedStyle(d).color,
        labelsTouch: (() => { const ts = [...d.querySelectorAll('.evd-axis span:not([hidden])')].map(r); return ts.some((t, i) => i && t.left < ts[i - 1].right); })() };
    });
    FIX = FIXES.winter;
    for (const [fixName, wx, kind] of [['winter', 'heavy', 'rainy'], ['orlando', 'storm', 'windy'], ['winter', 'transition', 'wintry'], ['orlando', 'quiet', 'quiet']]) for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) for (const theme of ['light', 'dark']) {
      FIX = FIXES[fixName]; const L = `dashboard ${kind} ${dev} ${theme}:`;
      const { ctx, p, errors } = await open(browser, base, fixName === 'orlando' ? `x&orl=${wx}` : wx, device, theme);
      await p.evaluate(() => scrollTo(0, 0));
      const f = await dashFacts(p), T = f.tiles;
      check(f.visible && f.afterCallouts && f.heading === 'At a glance' && f.oldStrip === 0, `${L} "At a glance" card right after the callouts, before the schedule; the old totals strip is gone`);
      check(!f.hscroll && !f.overflow && f.segsInside, `${L} no sideways scroll at ${device.viewport.width} px`);
      check(f.firstRow === Math.min(dev === 'phone' ? 2 : 4, Object.keys(T).length), `${L} tiles ${dev === 'phone' ? 2 : 4} across (${f.firstRow} in the first row, ${Object.keys(T).length} tiles)`);
      check(f.valuePx >= 28, `${L} tile values are large (${f.valuePx} px)`);
      check(f.targets && !f.labelsTouch, `${L} window bars are at least 44 px touch targets; time labels never touch`);
      check(theme === 'dark' ? /rgb\((1[0-9]|2[0-9]|[0-9]),/.test(f.panel) && /rgb\(2[0-9]{2},/.test(f.text) : /rgb\(255, 255, 255\)/.test(f.panel) && /rgb\(([0-9]|1[0-9]|2[0-9]),/.test(f.text), `${L} ${theme} theme panel ${f.panel}, text ${f.text}`);
      check(Object.values(T).every((t) => !t.tier || (t.badge || /^(Moderate|High)$/.test(t.value))), `${L} every coloured tile also says its level in words`);
      if (kind === 'rainy') {
        check(T.rain && T.rain.value === '1.28' && /Models 0\.\d\d–1\.\d\d in/.test(T.rain.text) && T.rain.tier, `${L} rain total 1.28 in with the spread across sources, flagged (${T.rain && T.rain.text})`);
        check(T.rate && T.rate.value === '0.17' && /in\/hr/.test(T.rate.text) && /Around 5 PM/.test(T.rate.text), `${L} heaviest rain 0.17 in/hr around 5 PM (${T.rate && T.rate.text})`);
        check(!T.gust && /^Gusts up to 16 mph · below your 25 mph limit, not a concern$/.test(f.gustLine || ''), `${L} gusts not flagged: no tile, one muted line (${f.gustLine})`);
        check(T.snow && T.snow.value === '0.3' && /7:1, before melting/.test(T.snow.text), `${L} a mix hour makes the event wintry: snow tile 0.3 in (${T.snow && T.snow.text})`);
        check(f.types === 'Rain>Mix>Rain', `${L} precipitation type chips ${f.types}`);
        check(f.rows.some((r) => r.key === 'rain' && /^Rain: plan for it 1 PM–11:30 PM$/.test(r.label)), `${L} rain window labelled in plain words (${f.rows.map((r) => r.label).join(' | ')})`);
      }
      if (kind === 'windy') {
        check(T.gust && T.gust.value === '28' && /Around 2 PM/.test(T.gust.text) && T.gust.tier === 'monitor' && T.gust.badge === 'Watch', `${L} gusts flagged: Peak gusts tile 28 mph around 2 PM, Watch (${T.gust && T.gust.text})`);
        check(T.lightning && T.lightning.value === 'Moderate' && /not detected lightning/.test(T.lightning.text), `${L} lightning flagged: tile with its level word (${T.lightning && T.lightning.text})`);
        check(!T.snow && !f.gustLine, `${L} no snow tile (not wintry) and no duplicate gust line`);
      }
      if (kind === 'wintry') check(T.snow && T.snow.value === '1.9' && T.snow.tier === 'action' && T.snow.badge === 'Likely disruptive' && f.types === 'Rain>Mix>Snow', `${L} wintry: snow tile 1.9 in, Likely disruptive (${T.snow && T.snow.text}); types ${f.types}`);
      if (kind === 'quiet') check(f.none && /^No weather concerns flagged for your event window\./.test(f.none) && f.rows.length === 0 && !T.gust && !T.snow && !T.lightning && /below your 25 mph limit/.test(f.gustLine || ''), `${L} quiet: one calm line, no window rows, no hazard tiles (${f.none})`);
      if (kind !== 'quiet') check(f.rows.length > 0 && f.rows.every((r) => r.match), `${L} window bars cover exactly the concern hours and levels in the hourly table (${f.rows.map((r) => `${r.key} ${r.got}/${r.want}`).join(', ')})`);
      if (kind !== 'quiet' && theme === 'light') {
        /* tapping a bar selects that hour on the page's shared timeline: the charts follow */
        const seg = p.locator('#evDash .evd-seg').last(), box = await seg.boundingBox(); await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(200);
        const t = await p.evaluate(() => { const sel = +document.body.dataset.selected, seg = [...document.querySelectorAll('#evDash .evd-seg')].pop(), row = seg.closest('.evd-row');
          const hrs = [...row.querySelectorAll('.evd-fill')].flatMap((f) => { const o = []; for (let m = Math.floor(+f.dataset.from / 3600e3) * 3600e3; m < +f.dataset.to; m += 3600e3) o.push(m); return o; });
          return { sel, inRun: hrs.includes(sel), charts: [...document.querySelectorAll('#evCharts .evc-card')].map((c) => +(c.querySelector('[aria-pressed="true"]') || { dataset: {} }).dataset.hour), readout: document.querySelector('#evDash [data-sel]').innerText, cur: !document.querySelector('#evDash .evd-cur').hidden }; });
        check(t.inRun && t.charts.every((h) => h === t.sel) && t.cur && /^Selected/.test(t.readout), `${L} tapping a window bar selects one of its hours on the shared timeline; the charts follow (${t.readout.replace(/\s+/g, ' ')})`);
        /* keyboard: Enter selects the window's first hour (or, when an hour in it is already selected, steps to the next) */
        const run = await p.evaluate(() => { const b = document.querySelector('#evDash .evd-seg'), fs = [...b.closest('.evd-row').querySelectorAll('.evd-fill')], H = 3600e3, o = [];
          fs.forEach((f) => { for (let m = Math.floor(+f.dataset.from / H) * H; m < +f.dataset.to; m += H) o.push(m); }); const a = +b.dataset.a, z = +b.dataset.b; return o.slice(0, z - a + 1); });
        const before = +(await p.evaluate(() => document.body.dataset.selected)); await p.locator('#evDash .evd-seg').first().focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
        const k1 = +(await p.evaluate(() => document.body.dataset.selected)), want = run.includes(before) && before < run[run.length - 1] ? before + 3600e3 : run[0];
        await p.keyboard.press('Enter'); await p.waitForTimeout(150); const k2 = +(await p.evaluate(() => document.body.dataset.selected));
        check(k1 === want && (run.length === 1 ? k2 === run[0] : k2 === k1 + 3600e3 || (k1 === run[run.length - 1] && k2 === run[0])), `${L} keyboard: Enter on a window selects its first hour, then steps through it`);
      }
      await p.locator('#evDash').screenshot({ path: path.join(out, `dashboard-${kind}-${dev}-${theme}.png`) });
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
