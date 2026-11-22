#!/usr/bin/env node
/* Browser check of the CONUS Shading opacity slider against a locally built data site: 100% is the standard look and
   stays out of the link; moving the slider fades only the coloured forecast layer (the plain basemap shows through in
   proportion; value labels, names and legend unchanged); nothing is fetched while sliding; it holds during playback,
   reloads from a shared link, goes into the PNG, resets; one slider drives both comparison panels. Desktop and phone.
   Usage: node tools/maps-conus-shade-check.js DATA_SITE_DIR [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-shade')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html'), h = cors ? { 'Access-Control-Allow-Origin': '*' } : {};
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h).end(); return; }
  res.writeHead(200, { ...h, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAND = [0x15, 0x1a, 0x22];   /* dark-theme basemap land colour */

(async () => {
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`, dataPort = String(data.address().port);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const helper = await (await browser.newContext()).newPage();
  /* colour strength of the map (outside label boxes): mean distance of its pixels from the plain basemap colour */
  const bareShare = async (png, box, labels) => helper.evaluate(async ([uri, box, labels, LAND]) => {
    const i = new Image(); i.src = uri; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const k = i.width / box.vw, d = g.getImageData(0, 0, i.width, i.height).data; let n = 0, bare = 0;   /* bare = summed distance from the basemap colour */
    for (let y = box.y0; y < box.y1; y += 3) for (let x = box.x0; x < box.x1; x += 3) {
      if (labels.some(([lx, ly]) => Math.abs(x - lx) < 40 && Math.abs(y - ly) < 26)) continue;
      const o = (Math.round(y * k) * i.width + Math.round(x * k)) * 4; n++; bare += Math.abs(d[o] - LAND[0]) + Math.abs(d[o + 1] - LAND[1]) + Math.abs(d[o + 2] - LAND[2]); }
    return bare / n; }, ['data:image/png;base64,' + png.toString('base64'), box, labels, LAND]);
  try {
    for (const [dev, device] of [['desktop', DESK], ['phone', PHONE]]) {
      const ctx = await browser.newContext({ ...device, acceptDownloads: true }), p = await ctx.newPage(), errors = [], dataReq = [];
      p.on('pageerror', (e) => errors.push(e.message)); p.on('request', (r) => { const u = new URL(r.url()); if (u.port === dataPort) dataReq.push(u.pathname); });
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      const settled = () => p.waitForFunction(() => window.__conus && window.__conus.draw && window.__conus.draw.length && window.MapsConus.api.labels().shown.length > 0, null, { timeout: 90000 }).then(() => p.waitForTimeout(1500));
      const state = () => p.evaluate(() => ({ s: window.MapsConus.api.state(), l: window.MapsConus.api.labels(), url: location.search, legend: getComputedStyle(document.querySelector('#legend')).opacity }));
      const geom = () => p.evaluate(() => { const m = document.querySelector('#map').getBoundingClientRect(), r = (q) => { const e = document.querySelector(q); return e && e.offsetParent ? e.getBoundingClientRect() : null; };
        const top = Math.max(m.top, ...['#mapInfo', '#mapCtl'].map(r).filter(Boolean).map((b) => b.bottom)) + 8, bot = Math.min(m.bottom, ...['#legend', '.maplibregl-ctrl-bottom-right', '#timeline'].map(r).filter(Boolean).map((b) => b.top)) - 8;
        return { x0: Math.round(m.left + 10), x1: Math.round(m.right - 10), y0: Math.round(top), y1: Math.round(bot), vw: innerWidth }; });
      const shot = async (name) => { const b = await p.screenshot(); fs.writeFileSync(path.join(out, `${dev}-${name}.png`), b); return b; };
      const labelXY = (l) => l.shown.map((o) => [o.x, o.y]);
      const slide = async (v) => { await p.evaluate((v) => { const s = document.querySelector('#shadeSl'); s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); }, v); await p.waitForTimeout(700); };

      await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&field=t2m&fh=6&map=39.10,-84.51,7.3`); await settled();
      const vis = await p.evaluate(() => { const r = document.querySelector('#shadeCtl').getBoundingClientRect(); return { shown: r.width > 0 && r.height > 0, inside: r.left >= 0 && r.right <= innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, r: [r.left, r.right, r.width], sw: document.documentElement.scrollWidth }; });
      const s0 = await state(); const box = await geom(); const full = await bareShare(await shot('100'), box, labelXY(s0.l));
      check(s0.s.shade === 100 && !/shade=/.test(s0.url) && vis.shown && vis.inside && !vis.overflow && await p.$eval('#shadeReset', (b) => b.disabled),
        `${dev}: slider shown beside Values at 100% (standard look), reset disabled, link without shade, no page overflow ${JSON.stringify(vis)}`);
      dataReq.length = 0; await slide(40); const s40 = await state(); const mid = await bareShare(await shot('40'), box, labelXY(s40.l));
      await slide(0); const sz = await state(); const zero = await bareShare(await shot('0'), box, labelXY(sz.l));
      check(mid / full > 0.3 && mid / full < 0.55 && zero / full < 0.08, `${dev}: colour strength over the map: ${full.toFixed(0)} at 100%, ${mid.toFixed(0)} at 40% (${(100 * mid / full).toFixed(0)}% of full), ${zero.toFixed(1)} at 0% (plain basemap)`);
      check(JSON.stringify(sz.l.shown.map((o) => [o.k, o.text])) === JSON.stringify(s0.l.shown.map((o) => [o.k, o.text])) && sz.legend === '1' && s40.legend === '1',
        `${dev}: the same ${s0.l.shown.length} value labels at 100%, 40% and 0%, and the legend stays fully opaque`);
      check(dataReq.length === 0, `${dev}: no forecast data requested while sliding (${dataReq.length} requests)`);
      check(/shade=0/.test(sz.url) && !(await p.$eval('#shadeReset', (b) => b.disabled)), `${dev}: link carries shade=0, reset enabled`);
      /* playback */
      await slide(40); const seen = new Set([(await state()).s.fh]); await p.click('#playBtn'); for (let k = 0; k < 8; k++) { await p.waitForTimeout(700); seen.add((await state()).s.fh); }
      const sp = await state(); const during = await bareShare(await shot('40-playing'), box, labelXY(sp.l)); await p.click('#playBtn');
      check(seen.size >= 3 && sp.s.shade === 40 && during / full > 0.3 && during / full < 0.6, `${dev}: during playback (${seen.size} hours shown) the shading stays at 40% (strength ${(100 * during / full).toFixed(0)}% of full)`);
      /* PNG at 40% */
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#pngBtn')]); const pngF = path.join(out, `${dev}-png-40.png`); await dl.saveAs(pngF);
      const meta = await p.evaluate(() => window.__lastPng), pb = fs.readFileSync(pngF);
      const pngBare = await bareShare(pb, { x0: 0, x1: 1600, y0: meta.head + 4, y1: meta.head + meta.mapH - 4, vw: 1600 }, meta.labels.map((o) => [o.x, o.y]));
      check(meta.shade === 40 && pngBare / full > 0.3 && pngBare / full < 0.6 && meta.labels.length > 0, `${dev}: PNG made at 40% (colour strength ${(100 * pngBare / full).toFixed(0)}% of the on-screen full value, ${meta.labels.length} labels drawn, "Shading 40%" in its caption)`);
      /* shared link reopens at the same setting */
      const link = `${base}/maps.html${(await state()).url}`; const p2 = await ctx.newPage(); await p2.goto(link);
      await p2.waitForFunction(() => window.__conus && window.__conus.draw && window.__conus.draw.length, null, { timeout: 90000 });
      const r2 = await p2.evaluate(() => ({ sh: window.MapsConus.api.state().shade, sl: document.querySelector('#shadeSl').value, out: document.querySelector('#shadeOut').textContent })); await p2.close();
      check(r2.sh === 40 && r2.sl === '40' && r2.out === '40%', `${dev}: the shared link reopens at 40% (slider ${r2.sl}, readout ${r2.out})`);
      /* reset */
      await p.click('#shadeReset'); await p.waitForTimeout(600); const sr = await state();
      check(sr.s.shade === 100 && !/shade=/.test(sr.url) && await p.$eval('#shadeReset', (b) => b.disabled), `${dev}: RESET returns to 100% and drops shade from the link`);
      check(!errors.length, `${dev}: no script errors ${errors.join('; ')}`); await ctx.close();
    }
    /* comparison: one slider, both panels */
    { const ctx = await browser.newContext(DESK), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      await p.goto(`${base}/maps.html?domain=conus&compare=1&field=t2m&data=${encodeURIComponent(DATA)}&map=39.10,-84.51,6.6`);
      const frames = () => p.frames().filter((f) => f.url().includes('embed=1'));
      for (let k = 0; k < 120; k++) { const fs2 = frames(); if (fs2.length === 2 && (await Promise.all(fs2.map((f) => f.evaluate(() => !!(window.MapsConus && window.MapsConus.api.ready())).catch(() => false)))).every(Boolean)) break; await p.waitForTimeout(500); }
      await p.waitForTimeout(2000);
      const n = await p.$$eval('input[type=range]#cmpShade', (x) => x.length);
      await p.evaluate(() => { const s = document.querySelector('#cmpShade'); s.value = '30'; s.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(800);
      const [A, B] = frames(), a = await A.evaluate(() => window.MapsConus.api.state().shade), b = await B.evaluate(() => window.MapsConus.api.state().shade), url = new URL(p.url()).searchParams;
      const single = await p.$eval('#cmpSingle', (x) => x.getAttribute('href'));
      check(n === 1 && a === 30 && b === 30 && url.get('shade') === '30' && /shade=30/.test(single), `compare: one slider sets both panels to 30% (A ${a}%, B ${b}%), the link and the single-run link carry it`);
      await p.screenshot({ path: path.join(out, 'compare-30.png') });
      const p2 = await ctx.newPage(); await p2.goto(p.url()); for (let k = 0; k < 120; k++) { const fs2 = p2.frames().filter((f) => f.url().includes('embed=1')); if (fs2.length === 2 && (await Promise.all(fs2.map((f) => f.evaluate(() => !!(window.MapsConus && window.MapsConus.api.ready())).catch(() => false)))).every(Boolean)) break; await p2.waitForTimeout(500); }
      const both = await Promise.all(p2.frames().filter((f) => f.url().includes('embed=1')).map((f) => f.evaluate(() => window.MapsConus.api.state().shade)));
      check(both.length === 2 && both.every((x) => x === 30) && await p2.$eval('#cmpShadeOut', (o) => o.textContent) === '30%', `compare: the shared link reopens both panels at 30%`);
      check(!errors.length, `compare: no script errors ${errors.join('; ')}`); await ctx.close();
    }
  } catch (e) { check(false, 'crashed: ' + (e.stack || e.message)); }
  await browser.close(); site.close(); data.close();
  console.log(failed ? `${failed} check(s) failed` : 'all shading checks passed'); process.exit(failed ? 1 : 0);
})();
