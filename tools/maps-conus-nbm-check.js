#!/usr/bin/env node
/* Browser check of the NBM model in the CONUS viewer against a locally built data site (HRRR + NBM):
   the model menu switches HRRR <-> NBM keeping the view and the valid time; NBM's header, credits, cell readout and PNG
   name say NBM; the field menu lists only what NBM publishes; temperature and PoP labels equal the native NBM cells
   (whole degrees, whole percent, 0% left blank); 6-h PoP opens on the window that contains the hour and the loop steps
   window to window; links carry the model; the cycle comparison labels the same points in both NBM panels.
   Usage: node tools/maps-conus-nbm-check.js DATA_SITE_DIR [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), { chromium } = require('playwright');
const K = require('../assets/maps-conus-core.js');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-nbm')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html'), h = cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length' } : {};
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h).end(); return; }
  res.writeHead(200, { ...h, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const FMT = { t2m: (v) => String(Math.round(v)), pop1h: (v) => `${Math.round(v)}%`, pop6h: (v) => `${Math.round(v)}%` }, MIN = { pop1h: 1, pop6h: 1 };
const f2 = (h) => String(h).padStart(2, '0');

(async () => {
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`;
  const nIdx = JSON.parse(fs.readFileSync(path.join(dataRoot, 'data/conus/nbm/index.json'), 'utf8')), runs = nIdx.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle));
  const run = runs[0], mans = new Map(runs.map((r) => [r.id, JSON.parse(fs.readFileSync(path.join(dataRoot, r.path, 'manifest.json'), 'utf8'))])), man = mans.get(run.id), tiles = new Map();
  let cur = run;   /* the run the page shows; labels are checked against its own files */
  const native = (field, fh, i, j) => { const man = mans.get(cur.id), T = man.tile, tx = Math.floor(i / T), ty = Math.floor(j / T), k = `${cur.id}|${field}|${fh}|${tx}|${ty}`;
    if (!tiles.has(k)) { const d = K.tileDims(man, 0, tx, ty), raw = zlib.gunzipSync(fs.readFileSync(path.join(dataRoot, cur.path, field, `f${f2(fh)}`, `L0_${tx}_${ty}.bin.gz`))); tiles.set(k, K.decodeTile(new Uint8Array(raw), d.ny, d.nx)); }
    const t = tiles.get(k), v = t.values[(j - ty * T) * t.nx + (i - tx * T)]; return v === K.MISS ? null : v * man.fields[field].scale; };
  const cellOf = (k) => { const P = man.points, n = P.places.length; if (k < n) return [P.places[k][4], P.places[k][5]]; const q = k - n; return [P.lattice.i0 + (q % P.lattice.nx) * P.lattice.every, P.lattice.j0 + Math.floor(q / P.lattice.nx) * P.lattice.every]; };
  const verify = (field, fh, L, id) => { cur = runs.find((r) => r.id === (id || run.id)); return L.shown.filter((x) => { const [i, j] = cellOf(x.k), v = native(field, fh, i, j); return v == null || FMT[field](v) !== x.text || (MIN[field] && v < MIN[field]); }); };
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const settled = (p) => p.waitForFunction(() => window.__conus && window.__conus.man && window.__conus.draw && window.__conus.draw.length && window.__conus.want && window.MapsConus.api.labels().chosen.length > 0, null, { timeout: 90000 }).then(() => p.waitForTimeout(1500));
  const L = (p) => p.evaluate(() => window.MapsConus.api.labels()), S = (p) => p.evaluate(() => window.MapsConus.api.state());
  try {
    for (const [dev, device] of [['desktop', DESK], ['phone', PHONE]]) {
      const ctx = await browser.newContext({ ...device, acceptDownloads: true }), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      const url = (q) => `${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&${q}`;
      /* HRRR -> NBM from the model menu: same view, same valid time, the field kept (temperature) */
      await p.goto(url('field=t2m&fh=6&map=39.10,-84.51,7.3')); await settled(p);
      const hv = await S(p), hValid = hv.valid[hv.fh];
      await Promise.all([p.waitForNavigation(), p.selectOption('#modelSel', 'nbm')]); await settled(p);
      const ns = await S(p), info = await p.evaluate(() => document.querySelector('#mapInfo').innerText), q = new URL(p.url()).searchParams, view = (q.get('map') || '').split(',').map(Number);
      const expect = runs.find((r) => r.hours.some((h) => Date.parse(r.cycle) + h * 3600e3 === Date.parse(hValid)));
      check(expect && ns.run === expect.id && ns.field === 't2m' && ns.valid[ns.fh] === hValid && /NBM 2\.5 km/.test(info) && Math.abs(view[0] - 39.1) < 0.05 && Math.abs(view[1] + 84.51) < 0.05 && q.get('model') === 'nbm',
        `${dev}: model menu HRRR -> NBM keeps the view and valid time (${hValid} = NBM ${ns.run} F${f2(ns.fh)}, the newest NBM run with that hour), header "${info.split('\n')[0]}", link has model=nbm`);
      /* the field menu lists only NBM's fields; others are queued */
      const menu = await p.evaluate(() => [...document.querySelectorAll('#fieldSel option')].map((o) => o.value || o.textContent));
      check(menu.filter((x) => !/Queued/.test(x)).sort().join() === 'pop1h,pop6h,t2m', `${dev}: field menu for NBM: ${menu.filter((x) => !/Queued/.test(x)).join(', ')} (the rest marked queued)`);
      /* temperature labels at the Cincinnati zoom: exact NBM cells */
      let l = await L(p), bad = verify('t2m', ns.fh, l, ns.run);
      check(l.shown.length >= (dev === 'phone' ? 4 : 12) && !bad.length, `${dev}: NBM temperature labels at Cincinnati: ${l.shown.length}, all equal to their native 2.5 km cells (e.g. ${l.shown.slice(0, 4).map((x) => (x.name ? x.name + ' ' : '') + x.text).join(', ')})`);
      if (dev === 'desktop') await p.screenshot({ path: path.join(out, 'nbm-cincinnati-t2m.png') });
      /* readout names the model and grid */
      await p.mouse.click(device.viewport.width / 2, device.viewport.height / 2 + (dev === 'phone' ? 60 : 0)); await p.waitForTimeout(1200);
      const ro = await p.evaluate(() => document.querySelector('#inspect').innerText);
      check(/NBM native cell \d+, \d+ \(2\.5 km\)/.test(ro), `${dev}: point readout names the NBM 2.5 km cell ("${(ro.match(/NBM native cell[^·]*/) || [''])[0].trim()}")`);
      /* 1-h PoP national: whole percent, 0% blank, exact */
      await p.goto(url(`model=nbm&field=pop1h&run=${run.id}&fh=6`)); await settled(p); l = await L(p); bad = verify('pop1h', 6, l);
      const blank = l.chosen.length - l.shown.length;
      const cap1 = await p.evaluate(() => document.querySelector('#mapInfo').innerText);
      check(/For the hour ending/.test(cap1) && !/Accumulated/.test(cap1), `${dev}: 1-h PoP caption says "For the hour ending", not "Accumulated"`);
      check(!bad.length && l.shown.every((x) => /^\d+%$/.test(x.text)), `${dev}: 1-h PoP labels: ${l.shown.length} shown (${blank} at 0% or missing left blank), all exact${l.shown.length ? ` (e.g. ${l.shown.slice(0, 4).map((x) => (x.name ? x.name + ' ' : '') + x.text).join(', ')})` : ''}`);
      if (dev === 'desktop') await p.screenshot({ path: path.join(out, 'nbm-national-pop1h.png') });
      /* 6-h PoP from an hour between windows: moved to the window containing it, said so; the loop steps window to window */
      const okH = man.hours.filter((h) => !man.fields.pop6h.hours[String(h)].notApplicable), from = man.hours.find((h) => !okH.includes(h) && h > okH[0] - 6 && h < okH[0]) || 1;
      await p.goto(url(`model=nbm&field=t2m&run=${run.id}&fh=${from}`)); await settled(p);
      await p.selectOption('#fieldSel', 'pop6h'); await p.waitForTimeout(1500);
      const s6 = await S(p), nt = await p.evaluate(() => (document.querySelector('#mapNote') || {}).innerText || '');
      check(s6.field === 'pop6h' && okH.includes(s6.fh) && s6.fh >= from && s6.fh - from < 6 && /window that includes/.test(nt), `${dev}: 6-h PoP from F${f2(from)} opens on F${f2(s6.fh)}, the window that contains it ("${nt.slice(0, 90)}…")`);
      const cap6 = await p.evaluate(() => document.querySelector('#mapInfo').innerText);
      check(/For the 6 h from .+ to .+/.test(cap6) && !/Accumulated/.test(cap6), `${dev}: 6-h PoP caption names the window, not a run total ("${(cap6.match(/For the 6 h[^\n]*/) || [''])[0]}")`);
      l = await L(p); bad = verify('pop6h', s6.fh, l); check(!bad.length, `${dev}: 6-h PoP labels at F${f2(s6.fh)}: ${l.shown.length} shown, all exact`);
      const seen = new Set(); await p.click('#playBtn'); for (let k = 0; k < 14; k++) { await p.waitForTimeout(600); seen.add((await S(p)).fh); } await p.click('#playBtn');
      check([...seen].every((h) => okH.includes(h)) && seen.size >= 2, `${dev}: the 6-h PoP loop visits only window hours (${[...seen].sort((a, b) => a - b).map((h) => 'F' + f2(h)).join(', ')}; windows ${okH.map((h) => 'F' + f2(h)).join(', ')})`);
      /* PNG: model in the name, NBM credit drawn under the map */
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#pngBtn')]); const png = path.join(out, `nbm-${dev}.png`); await dl.saveAs(png);
      check(/^forecast-ops-nbm-pop6h-\d{10}z-f\d\d\.png$/.test(dl.suggestedFilename()), `${dev}: PNG ${dl.suggestedFilename()}`);
      /* NBM -> HRRR: back to HRRR with the same view; a field HRRR lacks falls back to temperature */
      await Promise.all([p.waitForNavigation(), p.selectOption('#modelSel', 'hrrr')]); await settled(p);
      const hs = await S(p), hq = new URL(p.url()).searchParams;
      check(hs.field === 't2m' && !hq.get('model') && /HRRR 3 km/.test(await p.evaluate(() => document.querySelector('#mapInfo').innerText)), `${dev}: NBM -> HRRR from 6-h PoP opens HRRR temperature (HRRR has no PoP), link without model`);
      check(!errors.length, `${dev}: no script errors ${errors.join('; ')}`); await ctx.close();
    }
    /* NBM cycle comparison: both panels NBM, same label points */
    { const ctx = await browser.newContext(DESK), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      await p.goto(`${base}/maps.html?domain=conus&compare=1&model=nbm&field=pop6h&data=${encodeURIComponent(DATA)}&map=39.10,-84.51,6.6`);
      const frames = () => p.frames().filter((f) => f.url().includes('embed=1'));
      for (let k = 0; k < 120; k++) { const fs2 = frames(); if (fs2.length === 2 && (await Promise.all(fs2.map((f) => f.evaluate(() => !!(window.MapsConus && window.MapsConus.api.ready() && window.MapsConus.api.labels().chosen.length)).catch(() => false)))).every(Boolean)) break; await p.waitForTimeout(500); }
      await p.waitForTimeout(2500);
      const [A, B] = frames(), la = await L(A), lb = await L(B), sa = await S(A), sb = await S(B);
      const sub = await p.evaluate(() => document.body.innerText), share = new URL(p.url()).searchParams;
      check(A.url().includes('model=nbm') && B.url().includes('model=nbm') && sa.run !== sb.run && la.chosen.join() === lb.chosen.join() && sa.valid[sa.fh] === sb.valid[sb.fh] && share.get('model') === 'nbm' && /NBM 2\.5 km · cycle comparison/.test(sub) && /Like for like: both panels show the 6 h ending/.test(sub) && /National Blend of Models/.test(sub),
        `NBM compare: ${sa.run} vs ${sb.run}, ${sa.field} at ${sa.valid[sa.fh]}, both panels label the same ${la.chosen.length} points; page says NBM; link has model=nbm`);
      await p.screenshot({ path: path.join(out, 'nbm-compare-pop6h.png') });
      check(!errors.length, `NBM compare: no script errors ${errors.join('; ')}`); await ctx.close();
    }
  } catch (e) { check(false, 'crashed: ' + (e.stack || e.message)); }
  await browser.close(); site.close(); data.close();
  console.log(failed ? `${failed} check(s) failed` : 'all NBM checks passed'); process.exit(failed ? 1 : 0);
})();
