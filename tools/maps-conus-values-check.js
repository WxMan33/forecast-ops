#!/usr/bin/env node
/* Browser check of the CONUS Values overlay against a locally built data site: every label shown equals the native
   (L0) tile value of the cell it names, formatted as documented; national / regional / local density; dry zeros and
   missing cells left blank; labels steady through the loop; clear of the controls; off when switched off (also in the
   PNG and the link); the same points labelled in both comparison panels. Phone and desktop.
   Usage: node tools/maps-conus-values-check.js DATA_SITE_DIR [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), { chromium } = require('playwright');
const K = require('../assets/maps-conus-core.js');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-values')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html'), h = cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length' } : {};
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h).end(); return; }
  res.writeHead(200, { ...h, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const FMT = { t2m: (v) => String(Math.round(v)), d2m: (v) => String(Math.round(v)), gust: (v) => String(Math.round(v)), apcp1h: (v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v))),
  apcp_run: (v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v))), asnow1h: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))), asnow_run: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))), frzr_run: (v) => v.toFixed(2) };
const MIN = { apcp1h: 0.01, apcp_run: 0.01, asnow1h: 0.1, asnow_run: 0.1, frzr_run: 0.01 };

(async () => {
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`;
  const index = JSON.parse(fs.readFileSync(path.join(dataRoot, 'data/conus/index.json'), 'utf8')), runs = index.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle));
  const run = runs.find((r) => r.hours.includes(6)), man = JSON.parse(fs.readFileSync(path.join(dataRoot, run.path, 'manifest.json'), 'utf8'));
  const L0 = man.levels.find((l) => l.level === 0), tileCache = new Map();
  /* the native value of cell (i, j) from the published L0 tile: the truth every label must equal */
  const native = (field, fh, i, j) => { const T = man.tile, tx = Math.floor(i / T), ty = Math.floor(j / T), k = `${field}|${fh}|${tx}|${ty}`;
    if (!tileCache.has(k)) { const d = K.tileDims(man, 0, tx, ty), raw = zlib.gunzipSync(fs.readFileSync(path.join(dataRoot, run.path, field, `f${String(fh).padStart(2, '0')}`, `L0_${tx}_${ty}.bin.gz`))); tileCache.set(k, K.decodeTile(new Uint8Array(raw), d.ny, d.nx)); }
    const t = tileCache.get(k), v = t.values[(j - ty * T) * t.nx + (i - tx * T)]; return v === K.MISS ? null : v * man.fields[field].scale; };
  const cellOf = (k) => { const P = man.points, n = P.places.length; if (k < n) return [P.places[k][4], P.places[k][5]]; const q = k - n, a = q % P.lattice.nx, b = Math.floor(q / P.lattice.nx); return [P.lattice.i0 + a * P.lattice.every, P.lattice.j0 + b * P.lattice.every]; };
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ready = (p) => p.waitForFunction(() => window.__conus && window.__conus.draw && window.__conus.draw.length && window.__conus.shown && window.__conus.want && (window.__conus.want.L === window.__conus.want.coarse || window.__conus.shown.fine >= window.__conus.shown.of), null, { timeout: 90000 }).then(() => p.waitForTimeout(2500));
  const labels = (p) => p.evaluate(() => window.MapsConus.api.labels());
  try {
    for (const [dev, device] of [['desktop', DESK], ['phone', PHONE]]) {
      const ctx = await browser.newContext({ ...device, acceptDownloads: true }), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      const go = async (field, map = '', extra = '') => { await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&run=${run.id}&fh=6&field=${field}${map}${extra}`); await ready(p); return labels(p); };
      const verify = (field, L) => { const bad = []; L.shown.forEach((x) => { const [i, j] = cellOf(x.k), v = native(field, 6, i, j); if (v == null || FMT[field](v) !== x.text || (MIN[field] && v < MIN[field])) bad.push(`${x.name || 'grid'}@${i},${j} shown ${x.text} native ${v}`); }); return bad; };
      /* national temperature: a handful of major cities, exact */
      let L = await go('t2m'); let bad = verify('t2m', L); const nat = L.shown.filter((x) => x.name).map((x) => `${x.name} ${x.text}`);
      check(L.tier === 'national' && L.shown.length >= (dev === 'phone' ? 4 : 6) && L.shown.length <= (dev === 'phone' ? 7 : 14) && L.shown.every((x) => x.name) && !bad.length, `${dev} national temperature: ${L.shown.length} major cities, all equal to their native cells (${nat.join(', ')})${bad.length ? ' BAD ' + bad.join('; ') : ''}`);
      const clear = await p.evaluate(() => { const box = window.__conus.map.getContainer().getBoundingClientRect(), r = (q) => { const e = document.querySelector(q); if (!e || e.offsetParent === null) return null; const b = e.getBoundingClientRect(); return [b.left - box.left, b.top - box.top, b.right - box.left, b.bottom - box.top]; };
        const rects = ['#mapInfo', '#legend', '#mapCtl', '.maplibregl-ctrl-bottom-right', '#timeline'].map(r).filter(Boolean), pts = window.MapsConus.api.labels().shown;
        return pts.filter((x) => rects.some(([a, b, c, d]) => x.x >= a && x.x <= c && x.y >= b && x.y <= d)).length; });
      check(clear === 0, `${dev}: no label sits on the info box, legend, controls or timeline (${clear} overlapping)`);
      await p.screenshot({ path: path.join(out, `values-national-${dev}.png`) });
      /* Cincinnati zoom: more cities and a sparse grid, exact */
      L = await go('t2m', '&map=39.10,-84.51,7.3'); bad = verify('t2m', L);
      check(L.tier === 'local' && L.shown.some((x) => x.name === 'Cincinnati') && L.shown.filter((x) => !x.name).length >= (dev === 'phone' ? 3 : 6) && !bad.length, `${dev} Cincinnati zoom: ${L.shown.filter((x) => x.name).length} towns + ${L.shown.filter((x) => !x.name).length} grid values, all exact${bad.length ? ' BAD ' + bad.join('; ') : ''}`);
      await p.screenshot({ path: path.join(out, `values-cincinnati-${dev}.png`) });
      /* precipitation and snow: sensible precision, dry zeros left off */
      for (const f of ['apcp_run', 'asnow_run', 'apcp1h']) {
        L = await go(f, '&map=44.0,-95.0,5.0'); bad = verify(f, L);
        const dry = L.chosen.length - L.shown.length;
        check(L.tier === 'regional' && !bad.length && L.shown.every((x) => x.value >= MIN[f]), `${dev} ${f} regional: ${L.shown.length} values shown, ${dry} dry or missing points left blank, all exact${L.shown.length ? ` (e.g. ${L.shown.slice(0, 3).map((x) => x.text).join(', ')})` : ''}${bad.length ? ' BAD ' + bad.join('; ') : ''}`);
      }
      /* the loop: same points every frame */
      L = await go('t2m', '&map=39.10,-84.51,7.3'); const chosen0 = L.chosen.join(); await p.click('#playBtn'); await p.waitForFunction(() => window.__conus.man.hours[window.__conus.h] !== 6, null, { timeout: 60000 }).catch(() => {});
      const seen = new Set(); for (let k = 0; k < 8; k++) { await p.waitForTimeout(700); const l = await labels(p); seen.add(l.chosen.join()); }
      await p.click('#playBtn'); const moved = await p.evaluate(() => window.__conus.man.hours[window.__conus.h]);
      check(seen.size === 1 && [...seen][0] === chosen0 && moved !== 6, `${dev}: labels stay on the same ${L.chosen.length} points through the loop (now F${String(moved).padStart(2, '0')})`);
      /* switching off: no labels, kept in the link and in the PNG */
      await p.click('#valBtn'); await p.waitForTimeout(800); const off = await labels(p), link = await p.evaluate(() => location.search);
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#pngBtn')]); const pngOff = path.join(out, `values-off-${dev}.png`); await dl.saveAs(pngOff);
      const offInPng = await p.evaluate(() => (window.MapsConus.api.labels().shown || []).length);
      check(off.shown.length === 0 && /values=0/.test(link) && offInPng === 0, `${dev}: Values off removes every label, is kept in the link (values=0) and the PNG has none`);
      await p.click('#valBtn'); await p.waitForTimeout(1200);
      const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#pngBtn')]); const pngOn = path.join(out, `values-on-${dev}.png`); await dl2.saveAs(pngOn);
      check(fs.statSync(pngOn).size > fs.statSync(pngOff).size, `${dev}: the PNG carries the labels when Values is on (${Math.round(fs.statSync(pngOn).size / 1024)} KB vs ${Math.round(fs.statSync(pngOff).size / 1024)} KB without)`);
      /* every label the export placed is really in the image: the area around it differs from the Values-off PNG */
      const meta = await p.evaluate(() => window.__lastPng), uri = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
      const diffs = await p.evaluate(async ([a, b, labs]) => {
        const img = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g; };
        const ga = await img(a), gb = await img(b);
        return labs.map((o) => { const x0 = Math.max(0, o.x - 24), y0 = Math.max(0, o.y - 6), w = 48, h = 26, A = ga.getImageData(x0, y0, w, h).data, B = gb.getImageData(x0, y0, w, h).data;
          let n = 0; for (let q = 0; q < A.length; q += 4) if (Math.abs(A[q] - B[q]) + Math.abs(A[q + 1] - B[q + 1]) + Math.abs(A[q + 2] - B[q + 2]) > 90) n++; return n; });
      }, [uri(pngOn), uri(pngOff), meta.labels]);
      const missing = meta.labels.filter((o, k) => diffs[k] < 12);
      check(meta.labels.length >= 3 && meta.labels.some((o) => o.name) && !missing.length, `${dev}: the PNG shows all ${meta.labels.length} labels the export placed (${meta.labels.filter((o) => o.name).length} cities)${missing.length ? `; not visible: ${missing.map((o) => (o.name || '') + ' ' + o.text).join(', ')}` : ''}`);
      check(!errors.length, `${dev}: no script errors ${errors.join('; ')}`); await ctx.close();
    }
    /* comparison: both panels label the same points */
    { const ctx = await browser.newContext(DESK), p = await ctx.newPage();
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      await p.goto(`${base}/maps.html?domain=conus&compare=1&field=t2m&data=${encodeURIComponent(DATA)}&map=39.10,-84.51,6.6`);
      await p.waitForFunction(() => window.__cmp && ['A', 'B'].every((k) => { const a = window.__cmp.panel(k); const s = a && a.state(); return s && (s.hourState !== 'ok' || s.draw > 0); }), null, { timeout: 90000 }); await p.waitForTimeout(4000);
      const both = await p.evaluate(() => ['A', 'B'].map((k) => window.__cmp.panel(k).labels()));
      const same = both[0].chosen.join() === both[1].chosen.join(), diff = both[0].shown.filter((x, n) => both[1].shown[n] && x.k === both[1].shown[n].k && x.text !== both[1].shown[n].text).length;
      check(same && both[0].chosen.length > 3, `compare: both panels label the same ${both[0].chosen.length} points (${diff} of them differ between the runs)`);
      await p.screenshot({ path: path.join(out, 'values-compare.png') }); await ctx.close(); }
  } finally { await browser.close(); site.close(); data.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all Values checks passed'); process.exit(failed ? 1 : 0);
})();
