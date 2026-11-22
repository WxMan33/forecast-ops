#!/usr/bin/env node
/* Browser check of the same-window precipitation and snowfall fields (computed in the viewer from a run's own run totals)
   against a locally built HRRR data site:
   - a window that starts at the run's start equals the pipeline's published run-total tiles byte for byte, at every level
     (an independent oracle for the tile assembly and the coarse-level rule, which the pipeline builds in Python);
   - a later window equals end - start of the published native tiles, and its coarse levels equal this check's own block
     maximum rounded half to even; label values equal the same difference at the label points;
   - hours that are not window ends, and windows that start before a run, say why and draw nothing;
   - the comparison shows the same window in both runs, says it is like for like, labels the same points, and its slider
     and Play stop only at window ends.
   Usage: node tools/maps-conus-window-check.js DATA_SITE_DIR [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), crypto = require('node:crypto'), { chromium } = require('playwright');
const K = require('../assets/maps-conus-core.js');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-window')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html'), h = cors ? { 'Access-Control-Allow-Origin': '*' } : {};
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h).end(); return; }
  res.writeHead(200, { ...h, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const f2 = (h) => String(h).padStart(2, '0'), sha = (v) => crypto.createHash('sha256').update(Buffer.from(v.buffer, v.byteOffset, v.byteLength)).digest('hex');
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

(async () => {
  const idx = JSON.parse(fs.readFileSync(path.join(dataRoot, 'data/conus/index.json'), 'utf8')), runs = idx.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle));
  const mans = new Map(runs.map((r) => [r.id, JSON.parse(fs.readFileSync(path.join(dataRoot, r.path, 'manifest.json'), 'utf8'))]));
  /* the long run (e.g. 12Z, 48 h) and a later run that shares a 6-h window with it */
  const long = runs.find((r) => r.hours.length > 24), late = runs.find((r) => r !== long && Date.parse(r.cycle) > Date.parse(long.cycle) && r.hours.length >= 12);
  if (!long || !late) { console.log('need a 48-h run and a later run with 12+ hours'); process.exit(2); }
  const field = 'asnow_run', H = 3600e3, mL = mans.get(long.id);
  const hourAt = (r, ms) => (ms - Date.parse(r.cycle)) / H;
  /* a 6-h window ending at 00/06/12/18Z inside both runs, starting after the later run's start */
  let endMs = null; for (let h = 7; h <= late.hours[late.hours.length - 1]; h++) { const t = Date.parse(late.cycle) + h * H; if (new Date(t).getUTCHours() % 6 === 0 && h - 6 > 0 && long.hours.includes(hourAt(long, t)) && hourAt(long, t) - 6 > 0) { endMs = t; break; } }
  const native = (r, fh, tx, ty) => { const m = mans.get(r.id), d = K.tileDims(m, 0, tx, ty); return K.decodeTile(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dataRoot, r.path, field, `f${f2(fh)}`, `L0_${tx}_${ty}.bin.gz`)))), d.ny, d.nx); };
  const published = (r, fh, L, tx, ty) => { const m = mans.get(r.id), d = K.tileDims(m, L, tx, ty); return K.decodeTile(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dataRoot, r.path, field, `f${f2(fh)}`, `L${L}_${tx}_${ty}.bin.gz`)))), d.ny, d.nx).values; };
  /* this check's own reference for a later window: difference of the published native tiles, then block max, half-even */
  const refTile = (r, fh, w, L, tx, ty) => {
    const m = mans.get(r.id), T = m.tile, s = 2 ** L, g = m.grid, i0 = tx * T * s, j0 = ty * T * s, W = Math.min(T * s, g.nx - i0), Hh = Math.min(T * s, g.ny - j0), step = m.fields[field].displayStep;
    const q = new Int16Array(W * Hh).fill(K.MISS);
    for (let b = Math.floor(j0 / T); b <= Math.floor((j0 + Hh - 1) / T); b++) for (let a = Math.floor(i0 / T); a <= Math.floor((i0 + W - 1) / T); a++) {
      const e = native(r, fh, a, b), st = fh - w > 0 ? native(r, fh - w, a, b) : null;
      for (let j = 0; j < e.ny; j++) for (let i = 0; i < e.nx; i++) { const x = e.values[j * e.nx + i], y = st ? st.values[j * e.nx + i] : 0; let d = (x === K.MISS || y === K.MISS) ? K.MISS : x - y; if (d !== K.MISS && d < 0) d = d >= -5 ? 0 : K.MISS; q[(b * T - j0 + j) * W + (a * T - i0 + i)] = d; } }
    if (L === 0) return q;
    const NX = Math.ceil(W / s), NY = Math.ceil(Hh / s), o = new Int16Array(NX * NY);
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let mx = K.MISS; for (let j = y * s; j < Math.min(Hh, y * s + s); j++) for (let i = x * s; i < Math.min(W, x * s + s); i++) mx = Math.max(mx, q[j * W + i]);
      if (mx !== K.MISS) { const v = mx / step, f = Math.floor(v), rr = v - f; mx = rr > 0.5 ? f + 1 : rr < 0.5 ? f : (f % 2 ? f + 1 : f); } o[y * NX + x] = mx; }
    return o;
  };
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext(DESK), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
    const open = async (q) => { await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&${q}`); await p.waitForFunction(() => window.__conus && window.__conus.man && window.MapsConus.api.state() && (window.__conus.draw || []).length >= 0, null, { timeout: 90000 }); await p.waitForTimeout(2500); };
    const S = () => p.evaluate(() => window.MapsConus.api.state()), info = () => p.evaluate(() => document.querySelector('#mapInfo').innerText + ' ' + ((document.querySelector('#mapNote') || {}).innerText || ''));
    const hash = (fh, L, tx, ty) => p.evaluate(([a, b, c, d]) => window.MapsConus.api.tileHash(a, b, c, d), [fh, L, tx, ty]);

    /* 1. a 12-h window from the run's start equals the published run total at every level */
    const h12 = mL.hours.find((h) => h >= 12 && new Date(Date.parse(mL.cycle) + h * H).getUTCHours() % 12 === 0 && h - 12 === 0);
    await open(`run=${long.id}&field=asnow12&fh=${h12}&map=39.1,-84.5,4`);
    let same = 0, total = 0; const bad = [];
    for (const L of [2, 1, 0]) { const lv = mL.levels.find((l) => l.level === L), list = []; for (let ty = 0; ty < lv.tilesY; ty++) for (let tx = 0; tx < lv.tilesX; tx++) list.push([tx, ty]);
      for (const [tx, ty] of (L === 0 ? list.filter((_, n) => n % 5 === 0) : list)) { total++; const got = await hash(h12, L, tx, ty), want = sha(published(long, h12, L, tx, ty)); if (got.hash === want) same++; else bad.push(`L${L}_${tx}_${ty}`); } }
    check(same === total, `${long.id} 12-h snowfall ending F${f2(h12)} (window = run start to F${f2(h12)}) equals the pipeline's published run-total tiles byte for byte: ${same}/${total} tiles (L2, L1 all; L0 every 5th)${bad.length ? ' — differ: ' + bad.slice(0, 5).join(', ') : ''}`);

    /* 2. a later 6-h window: end - start of the native tiles, coarse levels by block max half-even; labels the same difference */
    const hA = hourAt(long, endMs); await open(`run=${long.id}&field=asnow6&fh=${hA}&map=47.4,-117.6,6.1`);
    let ok2 = 0, n2 = 0; const bad2 = [];
    for (const L of [2, 1, 0]) { const lv = mL.levels.find((l) => l.level === L), list = []; for (let ty = 0; ty < lv.tilesY; ty++) for (let tx = 0; tx < lv.tilesX; tx++) list.push([tx, ty]);
      for (const [tx, ty] of (L === 0 ? list.filter((_, n) => n % 4 === 0) : list)) { n2++; const got = await hash(hA, L, tx, ty), want = sha(refTile(long, hA, 6, L, tx, ty)); if (got.hash === want) ok2++; else bad2.push(`L${L}_${tx}_${ty}`); } }
    check(ok2 === n2, `${long.id} 6-h snowfall ending F${f2(hA)} (${new Date(endMs).toISOString().slice(0, 13)}Z) = F${f2(hA)} − F${f2(hA - 6)} per native cell, coarse levels block max rounded half to even: ${ok2}/${n2} tiles match${bad2.length ? ' — differ: ' + bad2.slice(0, 5).join(', ') : ''}`);
    const pts = (r, fh) => { const u8 = zlib.gunzipSync(fs.readFileSync(path.join(dataRoot, r.path, field, `p${f2(fh)}.bin.gz`))); return new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1); };
    const pe = pts(long, hA), ps = pts(long, hA - 6), lab = await p.evaluate(() => window.MapsConus.api.labels()), sc = mL.fields[field].scale;
    const wrong = lab.shown.filter((o) => { const d = pe[o.k] - ps[o.k]; return Math.round(o.value / sc) !== (d < 0 && d >= -5 ? 0 : d); });
    check(lab.shown.length > 0 && !wrong.length, `label values are the same difference at the label points: ${lab.shown.length} shown, ${wrong.length} wrong (e.g. ${lab.shown.slice(0, 4).map((o) => (o.name ? o.name + ' ' : '') + o.text).join(', ')})`);
    const cap = await info();
    check(/Accumulated over the 6 h from .+ to .+/.test(cap), `caption names the window ("${(cap.match(/Accumulated over the 6 h[^\n]*/) || [''])[0]}")`);
    await p.screenshot({ path: path.join(out, 'asnow6-single.png') });

    /* 3. not a window end; window before the run */
    await open(`run=${long.id}&field=asnow6&fh=${hA - 1}&map=47.4,-117.6,6.1`); let s3 = await S(), n3 = await info();
    check(s3.fh === hA && /6-h snowfall is for 6-h windows ending 00, 06, 12 and 18Z: showing F/.test(n3) || (s3.hourState === 'na' && /windows end at 00, 06, 12 and 18Z/.test(n3)), `opening 6-h snowfall at a non-window hour: "${n3.split('\n').pop().slice(0, 110)}"`);
    const early = late.hours.find((h) => new Date(Date.parse(late.cycle) + h * H).getUTCHours() % 12 === 0 && h < 12 && h > 0);
    if (early != null) { await open(`run=${late.id}&field=t2m&fh=${early}`); await p.selectOption('#fieldSel', 'asnow12').catch(() => {}); await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&run=${late.id}&field=asnow12&fh=${early}`); await p.waitForTimeout(4000);
      const st = await S(), t = await info();
      check(st.hourState === 'na' && /starts at .+ after the window began/.test(t) && st.draw === 0, `${late.id} F${f2(early)} 12-h snowfall: run starts after the window began, said on the map, nothing drawn ("${t.split('\n').pop().slice(0, 120)}")`); }

    /* 4. comparison over the same window */
    await p.goto(`${base}/maps.html?domain=conus&compare=1&a=${late.id}&b=${long.id}&field=asnow6&valid=${new Date(endMs).toISOString()}&data=${encodeURIComponent(DATA)}&map=47.4,-117.6,6.1`);
    const frames = () => p.frames().filter((f) => f.url().includes('embed=1'));
    for (let k = 0; k < 120; k++) { const fs2 = frames(); if (fs2.length === 2 && (await Promise.all(fs2.map((f) => f.evaluate(() => !!(window.MapsConus && window.MapsConus.api.ready() && window.MapsConus.api.labels().chosen.length)).catch(() => false)))).every(Boolean)) break; await p.waitForTimeout(500); }
    await p.waitForTimeout(3000);
    const [A, B] = frames(), la = await A.evaluate(() => window.MapsConus.api.labels()), lb = await B.evaluate(() => window.MapsConus.api.labels()), sa = await A.evaluate(() => window.MapsConus.api.state()), sb = await B.evaluate(() => window.MapsConus.api.state());
    const note = await p.$eval('#cmpNote', (e) => e.innerText);
    const pa = pts(late, sa.fh), pa0 = pts(late, sa.fh - 6), sameA = la.shown.every((o) => { const d = pa[o.k] - pa0[o.k]; return Math.round(o.value / sc) === (d < 0 && d >= -5 ? 0 : d); });
    check(sa.valid[sa.fh] === sb.valid[sb.fh] && /Like for like: both panels show the 6 h ending/.test(note) && la.chosen.join() === lb.chosen.join() && sameA,
      `compare ${late.id} F${f2(sa.fh)} vs ${long.id} F${f2(sb.fh)}: the same 6 h in both, "${note.slice(0, 80)}…", same ${la.chosen.length} label points, A's values = its own window difference`);
    const diffs = la.shown.map((o) => [o.name || 'grid', o.text, (lb.shown.find((x) => x.k === o.k) || {}).text || '—']).slice(0, 5);
    console.log('     e.g. A vs B: ' + diffs.map(([n, a, b]) => `${n} ${a} / ${b}`).join(', '));
    await p.screenshot({ path: path.join(out, 'asnow6-compare.png') });
    const seen = new Set(); await p.click('#cmpPlay'); for (let k = 0; k < 10; k++) { await p.waitForTimeout(900); seen.add(await A.evaluate(() => { const s = window.MapsConus.api.state(); return s.fh == null ? 'gap' : new Date(Date.parse(s.valid[s.fh])).getUTCHours(); }).catch(() => 'x')); } await p.click('#cmpPlay');
    check([...seen].every((h) => h === 'gap' || h % 6 === 0) && seen.size >= 2, `compare Play stops only at window ends (UTC hours seen: ${[...seen].join(', ')})`);
    check(!errors.length, `no script errors ${errors.join('; ')}`); await ctx.close();
  } catch (e) { check(false, 'crashed: ' + (e.stack || e.message)); }
  await browser.close(); site.close(); data.close();
  console.log(failed ? `${failed} check(s) failed` : 'all same-window checks passed'); process.exit(failed ? 1 : 0);
})();
