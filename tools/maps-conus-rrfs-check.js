#!/usr/bin/env node
/* Browser check of RRFS in the CONUS viewer against a locally built data site (HRRR + RRFS, tiles or packed):
   the model menu switches HRRR -> RRFS keeping the view and valid time (same grid, so the same cell); header, credit,
   readout and PNG name say RRFS; snowfall labels say RRFS, not HRRR; freezing rain is not offered; precipitation type
   exists at F00; labels equal the native RRFS cells; the comparison shows the same window in two RRFS runs.
   Usage: node tools/maps-conus-rrfs-check.js DATA_SITE_DIR [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), { chromium } = require('playwright');
const K = require('../assets/maps-conus-core.js');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-rrfs')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html'), h = cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' } : {};
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h).end(); return; }
  const size = fs.statSync(file).size, m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
  if (m) { const a = +m[1], b = Math.min(+m[2], size - 1); res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1, 'Content-Type': 'application/octet-stream' }); fs.createReadStream(file, { start: a, end: b }).pipe(res); return; }
  res.writeHead(200, { ...h, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const f2 = (h) => String(h).padStart(2, '0');

(async () => {
  const idx = JSON.parse(fs.readFileSync(path.join(dataRoot, 'data/conus/rrfs/index.json'), 'utf8')), runs = idx.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle));
  const mans = new Map(runs.map((r) => [r.id, JSON.parse(fs.readFileSync(path.join(dataRoot, r.path, 'manifest.json'), 'utf8'))]));
  const pts = (r, field, fh) => { const u8 = zlib.gunzipSync(fs.readFileSync(path.join(dataRoot, r.path, field, `p${f2(fh)}.bin.gz`))); return new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1); };
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const settled = (p) => p.waitForFunction(() => window.__conus && window.__conus.man && window.__conus.draw && window.__conus.draw.length && window.MapsConus.api.labels().chosen.length > 0, null, { timeout: 120000 }).then(() => p.waitForTimeout(1500));
  const S = (p) => p.evaluate(() => window.MapsConus.api.state()), L = (p) => p.evaluate(() => window.MapsConus.api.labels());
  const exact = (L1, s) => { const r = runs.find((x) => x.id === s.run), m = mans.get(r.id), sc = m.fields[s.field].scale, p = pts(r, s.field, s.fh); return L1.shown.filter((o) => Math.round(o.value / sc) !== p[o.k]); };
  try {
    for (const [dev, device] of [['desktop', DESK], ['phone', PHONE]]) {
      const ctx = await browser.newContext({ ...device, acceptDownloads: true }), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      const url = (q) => `${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&${q}`;
      /* HRRR -> RRFS: same view, same valid time (a run that has it), temperature kept */
      const r0 = runs[0], v6 = new Date(Date.parse(r0.cycle) + 6 * 3600e3).toISOString().replace('.000Z', 'Z');
      await p.goto(url(`field=t2m&map=39.10,-84.51,7.3&valid=${v6}`)); await settled(p); const hs = await S(p);
      await Promise.all([p.waitForNavigation(), p.selectOption('#modelSel', 'rrfs')]); await settled(p);
      const rs = await S(p), info = await p.evaluate(() => document.querySelector('#mapInfo').innerText), q = new URL(p.url()).searchParams;
      check(rs.field === 't2m' && rs.valid[rs.fh] === hs.valid[hs.fh] && /RRFS 3 km/.test(info) && q.get('model') === 'rrfs' && q.get('map') === new URL(p.url()).searchParams.get('map'),
        `${dev}: model menu HRRR -> RRFS keeps the valid time (${hs.valid[hs.fh]} → RRFS ${rs.run} F${f2(rs.fh)}) and the view; header "${info.split('\n')[0]}"`);
      let l = await L(p), bad = exact(l, rs);
      check(l.shown.length > 0 && !bad.length, `${dev}: RRFS temperature labels at Cincinnati: ${l.shown.length}, all equal to their native cells (e.g. ${l.shown.slice(0, 4).map((o) => (o.name ? o.name + ' ' : '') + o.text).join(', ')})`);
      const menu = await p.evaluate(() => [...document.querySelectorAll('#fieldSel option')].filter((o) => !o.disabled).map((o) => [o.value, o.textContent]));
      const keys = menu.map(([k]) => k);
      check(!keys.includes('frzr_run') && keys.includes('ptype') && keys.includes('asnow6') && menu.filter(([k]) => /asnow/.test(k)).every(([, t]) => /RRFS/.test(t) && !/HRRR/.test(t)),
        `${dev}: field menu for RRFS: no freezing rain; snowfall entries say RRFS (${menu.filter(([k]) => /asnow/.test(k)).map(([, t]) => t).join('; ')})`);
      await p.mouse.click(device.viewport.width / 2, device.viewport.height / 2 + (dev === 'phone' ? 60 : 0)); await p.waitForTimeout(1500);
      const ro = await p.evaluate(() => document.querySelector('#inspect').innerText);
      check(/RRFS native cell \d+, \d+ \(3 km\)/.test(ro), `${dev}: readout names the RRFS cell ("${(ro.match(/RRFS native cell[^·]*/) || [''])[0].trim()}")`);
      /* precipitation type at F00 */
      await p.goto(url(`model=rrfs&run=${r0.id}&field=ptype&fh=0&map=39.10,-84.51,4.5`)); await settled(p); const pt = await S(p);
      check(pt.fh === 0 && pt.hourState === 'ok' && pt.draw > 0, `${dev}: RRFS precipitation type is drawn at F00 (HRRR has none at its analysis hour)`);
      /* PNG */
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#pngBtn')]);
      check(/^forecast-ops-rrfs-ptype-\d{10}z-f00\.png$/.test(dl.suggestedFilename()), `${dev}: PNG ${dl.suggestedFilename()}`);
      check(!errors.length, `${dev}: no script errors ${errors.join('; ')}`); await ctx.close();
    }
    /* comparison: same 6-h window in two RRFS runs */
    if (runs.length >= 2) {
      const [ra, rb] = runs, ends = []; for (let h = 7; h <= ra.hours[ra.hours.length - 1]; h++) { const t = Date.parse(ra.cycle) + h * 3600e3; if (new Date(t).getUTCHours() % 6 === 0) ends.push(t); }
      const end = ends.find((t) => (t - Date.parse(rb.cycle)) / 3600e3 - 6 >= 0 && rb.hours.includes((t - Date.parse(rb.cycle)) / 3600e3));
      const ctx = await browser.newContext(DESK), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      await p.goto(`${base}/maps.html?domain=conus&compare=1&model=rrfs&a=${ra.id}&b=${rb.id}&field=apcp6&valid=${new Date(end).toISOString()}&data=${encodeURIComponent(DATA)}&map=39.10,-84.51,5.5`);
      const frames = () => p.frames().filter((f) => f.url().includes('embed=1'));
      for (let k = 0; k < 160; k++) { const fs2 = frames(); if (fs2.length === 2 && (await Promise.all(fs2.map((f) => f.evaluate(() => !!(window.MapsConus && window.MapsConus.api.ready() && window.MapsConus.api.labels().chosen.length)).catch(() => false)))).every(Boolean)) break; await p.waitForTimeout(500); }
      await p.waitForTimeout(3000);
      const [A, B] = frames(), la = await L(A), lb = await L(B), sa = await S(A), sb = await S(B), note = await p.$eval('#cmpNote', (e) => e.innerText), page = await p.evaluate(() => document.body.innerText);
      check(sa.valid[sa.fh] === sb.valid[sb.fh] && la.chosen.join() === lb.chosen.join() && /Like for like: both panels show the 6 h ending/.test(note) && /RRFS 3 km · cycle comparison/.test(page) && /NOAA\/NCEP RRFS/.test(page),
        `RRFS compare: ${ra.id} F${f2(sa.fh)} vs ${rb.id} F${f2(sb.fh)}, 6-h precipitation over the same window, same ${la.chosen.length} points; "${note.slice(0, 70)}…"`);
      await p.screenshot({ path: path.join(out, 'rrfs-compare.png') });
      check(!errors.length, `RRFS compare: no script errors ${errors.join('; ')}`); await ctx.close();
    }
  } catch (e) { check(false, 'crashed: ' + (e.stack || e.message)); }
  await browser.close(); site.close(); data.close();
  console.log(failed ? `${failed} check(s) failed` : 'all RRFS checks passed'); process.exit(failed ? 1 : 0);
})();
