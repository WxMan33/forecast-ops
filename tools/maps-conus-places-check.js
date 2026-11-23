#!/usr/bin/env node
/* Browser check of the CONUS "Places" values default against a locally built data site (HRRR, optionally NBM):
   - Places (default): only named towns and cities carry values, each the model's native cell at that place (checked
     against the published L0 tile, decoded here); no bare grid numbers; labels clear of each other and of the controls;
   - Places + grid: the sparse grid comes back beside the same places; Off: no plots, county lines and place names stay;
     the choice is kept in the link;
   - a dry or missing value keeps the town's name (no "0.00");
   - label anchors and placements do not move while the loop plays; both comparison panels label the same places the same
     way and one Values menu drives both; the PNG carries every plotted label. Desktop and phone; HRRR and NBM.
   Usage: node tools/maps-conus-places-check.js DATA_SITE_DIR [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), { chromium } = require('playwright');
const K = require('../assets/maps-conus-core.js');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-places')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf', '.gz': 'application/gzip' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html'), h = cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' } : {};
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h).end(); return; }
  res.writeHead(200, { ...h, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const DESK = { viewport: { width: 1690, height: 756 }, deviceScaleFactor: 1.184 }, PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const f2 = (h) => String(h).padStart(2, '0'), VIEW = '&map=38.81,-84.41,7.1';

(async () => {
  const models = [['hrrr', 'data/conus/index.json'], ['nbm', 'data/conus/nbm/index.json']].filter(([, p]) => fs.existsSync(path.join(dataRoot, p)));
  const runsOf = (p) => JSON.parse(fs.readFileSync(path.join(dataRoot, p), 'utf8')).runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle));
  const mans = new Map(), man = (r) => { if (!mans.has(r.id + r.path)) mans.set(r.id + r.path, JSON.parse(fs.readFileSync(path.join(dataRoot, r.path, 'manifest.json'), 'utf8'))); return mans.get(r.id + r.path); };
  /* the native value of cell (i, j) from the published L0 tile, decoded here: the truth every plot must equal */
  const native = (r, field, fh, i, j) => { const m = man(r), T = m.tile, tx = Math.floor(i / T), ty = Math.floor(j / T), d = K.tileDims(m, 0, tx, ty), rec = m.fields[field].hours[String(fh)], name = K.tileName(0, tx, ty);
    let gz; if (rec.pack) { const [off, len] = K.packIndex(m, rec)[name], fd = fs.openSync(path.join(dataRoot, r.path, rec.pack.file), 'r'); gz = Buffer.alloc(len); fs.readSync(fd, gz, 0, len, off); fs.closeSync(fd); }
    else gz = fs.readFileSync(path.join(dataRoot, r.path, field, `f${f2(fh)}`, name));
    const t = K.decodeTile(new Uint8Array(zlib.gunzipSync(gz)), d.ny, d.nx), v = t.values[(j - ty * T) * t.nx + (i - tx * T)]; return v === K.MISS ? null : v * m.fields[field].scale; };
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const settled = (p) => p.waitForFunction(() => window.__conus && window.__conus.draw && window.__conus.draw.length && window.__conus.want && window.__conus.labelsShown && window.__conus.labelSet && window.MapsConus.api.ready(), null, { timeout: 120000 }).then(() => p.waitForTimeout(2500));
  const plots = (p) => p.evaluate(() => { const st = window.__conus; return { mode: st.vmode, shown: st.labelsShown.map((o) => ({ ...o })), set: st.labelSet.list.map((o) => ({ k: o.k, name: o.name || null, anchor: o.anchor, cell: o.cell || null, x: o.x, y: o.y })), url: location.search,
    s: window.MapsConus.api.state(), counties: st.map.queryRenderedFeatures({ layers: ['counties'] }).length, names: [...new Set(st.map.queryRenderedFeatures({ layers: ['places'] }).map((f) => f.properties.name))],
    blocked: ['#mapInfo', '#legend', '#mapCtl .ctlrow', '.maplibregl-ctrl-bottom-right', '#timeline'].flatMap((q) => [...document.querySelectorAll(q)]).filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(), b = st.map.getContainer().getBoundingClientRect(); return [r.left - b.left, r.top - b.top, r.right - b.left, r.bottom - b.top]; }) }; });
  /* the cell each plot reads: a town's own nearest cell, or a published place's cell, or a lattice cell */
  const cellOf = (r, o) => { if (o.cell) return o.cell; const P = man(r).points, n = P.places.length; if (o.k < n) return [P.places[o.k][4], P.places[o.k][5]]; const q = o.k - n; return [P.lattice.i0 + (q % P.lattice.nx) * P.lattice.every, P.lattice.j0 + Math.floor(q / P.lattice.nx) * P.lattice.every]; };
  try {
    for (const [model, idxPath] of models) {
      const runs = runsOf(idxPath), r = runs.find((x) => x.hours.includes(6)), F = model === 'nbm' ? 't2m' : 't2m', mq = model === 'hrrr' ? '' : `&model=${model}`;
      for (const [dev, device] of model === 'hrrr' ? [['desktop', DESK], ['phone', PHONE]] : [['desktop', DESK]]) {
        const ctx = await browser.newContext({ ...device, acceptDownloads: true }), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
        await ctx.route('**/*', (rt) => (new URL(rt.request().url()).hostname === '127.0.0.1' ? rt.continue() : rt.fulfill({ status: 204, body: '' })));
        const open = async (q) => { await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}${mq}&run=${r.id}&fh=6${q}`); await settled(p); return plots(p); };
        await p.evaluate(() => { try { localStorage.removeItem('conus_vmode'); localStorage.removeItem('conus_values'); } catch (e) { /* */ } }).catch(() => {});
        /* Places by default */
        const V = dev === 'phone' ? '&map=39.05,-84.45,7.1' : VIEW;   /* a phone shows less map: centre on Cincinnati */
        let L = await open(`&field=${F}${V}`), tag = `${model} ${dev}`;
        const bare = L.shown.filter((o) => !o.name), pairs = L.shown.filter((o) => o.name && o.text);
        const wrong = pairs.filter((o) => { const [i, j] = cellOf(r, L.set.find((x) => x.k === o.k)), v = native(r, F, 6, i, j); return v == null || Math.round(v) !== Math.round(o.value) || String(Math.round(v)) !== o.text; });
        check(L.mode === 'places' && !/values=/.test(L.url) && !bare.length && pairs.length >= (dev === 'phone' ? 4 : 15) && !wrong.length,
          `${tag}: Places is the default — ${pairs.length} town-and-value pairs, no bare numbers, every value the native cell at the place (e.g. ${pairs.slice(0, 5).map((o) => `${o.name} ${o.text}`).join(', ')})${wrong.length ? ' — wrong: ' + wrong.slice(0, 3).map((o) => o.name).join(', ') : ''}`);
        if (dev === 'desktop' && model === 'hrrr') await p.screenshot({ path: path.join(out, 'places-desktop.png') });
        /* clear of each other and of the controls (boxes as the chooser measured them; the rendered layer must hold the same plots) */
        const rend = await p.evaluate(() => window.__conus.map.queryRenderedFeatures({ layers: ['vals'] }).length);
        const outside = L.set.filter((o) => L.blocked.some(([a, b, c, d]) => o.x > a && o.x < c && o.y > b && o.y < d));
        check(rend >= L.shown.length * 0.9 && !outside.length && L.counties > 0, `${tag}: ${rend} plots drawn for ${L.shown.length} chosen, none anchored under a control, county lines drawn (${L.counties})${outside.length ? ' — under a control: ' + outside.map((o) => `${o.name || o.k}@${Math.round(o.x)},${Math.round(o.y)}`).join(', ') + ' blocked ' + JSON.stringify(L.blocked.map((b) => b.map(Math.round))) : ''}`);
        /* steady through the loop */
        const sig = (x) => x.set.map((o) => `${o.k}@${o.anchor}`).join();
        const s0 = sig(L); let same = true; await p.click('#playBtn'); for (let k = 0; k < 6; k++) { await p.waitForTimeout(800); if (sig(await plots(p)) !== s0) same = false; } await p.click('#playBtn');
        check(same, `${tag}: places and label anchors do not move while the loop plays`);
        /* Places + grid, then Off */
        await p.selectOption('#valSel', 'grid'); await p.waitForTimeout(1500); const G = await plots(p);
        const gb = G.shown.filter((o) => !o.name), placesKept = pairs.filter((o) => G.shown.some((x) => x.k === o.k)).length;
        check(G.mode === 'grid' && /values=grid/.test(G.url) && gb.length > 0 && placesKept >= 1, `${tag}: Places + grid adds ${gb.length} grid values beside ${G.shown.filter((o) => o.name).length} places; link values=grid`);
        await p.selectOption('#valSel', 'off'); await p.waitForTimeout(1500); const O = await plots(p);
        check(O.mode === 'off' && /values=0/.test(O.url) && O.shown.length === 0 && O.counties > 0 && O.names.length > 0, `${tag}: Off removes every plot; county lines and ${O.names.length} place names stay; link values=0`);
        await p.selectOption('#valSel', 'places'); await p.waitForTimeout(1500);
        /* dry precipitation keeps names */
        if (model === 'hrrr') {
          const dryH = r.hours.find((h) => h >= 1 && man(r).fields.apcp1h && man(r).fields.apcp1h.hours[String(h)] && !man(r).fields.apcp1h.hours[String(h)].notApplicable) || 1;
          await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&run=${r.id}&fh=${dryH}&field=apcp1h${V}`); await settled(p); const D = await plots(p);
          const dry = D.shown.filter((o) => o.name && o.blank), zeros = D.shown.filter((o) => /^0\.00$/.test(o.text)), drawn = await p.evaluate(() => window.__conus.map.queryRenderedFeatures({ layers: ['vals'] }).filter((f) => f.properties.city === 2).map((f) => f.properties.n));
          check(dry.length > 0 && !zeros.length && dry.every((o) => drawn.includes(o.name)), `${tag}: dry 1-h precipitation (F${f2(dryH)}) keeps ${dry.length} town names with no "0.00" (e.g. ${dry.slice(0, 4).map((o) => o.name).join(', ')}); ${D.shown.filter((o) => o.text).length} wet values shown`);
        }
        /* PNG: every plotted label is in the image */
        await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}${mq}&run=${r.id}&fh=6&field=${F}${V}`); await settled(p);
        const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#pngBtn')]); const png = path.join(out, `${model}-${dev}-places.png`); await dl.saveAs(png);
        const meta = await p.evaluate(() => window.__lastPng);
        check(meta.labels.length > 0 && meta.labels.every((o) => o.name), `${tag}: PNG carries ${meta.labels.length} plots, all named places (${meta.labels.slice(0, 4).map((o) => `${o.name} ${o.text}`).join(', ')})`);
        check(!errors.length, `${tag}: no script errors ${errors.join('; ')}`); await ctx.close();
      }
    }
    /* Compare: same places, same anchors, one menu for both panels */
    { const runs = runsOf('data/conus/index.json'), [ra, rb] = runs;
      const ctx = await browser.newContext(DESK), p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (rt) => (new URL(rt.request().url()).hostname === '127.0.0.1' ? rt.continue() : rt.fulfill({ status: 204, body: '' })));
      await p.goto(`${base}/maps.html?domain=conus&compare=1&a=${ra.id}&b=${rb.id}&field=t2m&data=${encodeURIComponent(DATA)}${VIEW}`);
      const frames = () => p.frames().filter((f) => f.url().includes('embed=1'));
      const ready = async () => { for (let k = 0; k < 160; k++) { const fs2 = frames(); if (fs2.length === 2 && (await Promise.all(fs2.map((f) => f.evaluate(() => !!(window.MapsConus && window.MapsConus.api.ready() && window.__conus.labelSet)).catch(() => false)))).every(Boolean)) break; await p.waitForTimeout(500); } await p.waitForTimeout(3000); };
      await ready();
      const sig = async () => Promise.all(frames().map((f) => f.evaluate(() => ({ mode: window.__conus.vmode, s: window.__conus.labelSet.list.map((o) => `${o.k}@${o.anchor}`).join(), n: window.__conus.labelsShown.filter((o) => o.name && o.text).length, bare: window.__conus.labelsShown.filter((o) => !o.name).length }))));
      let [a, b] = await sig();
      check(a.mode === 'places' && b.mode === 'places' && a.s === b.s && a.n > 0 && !a.bare && !b.bare, `compare: both panels label the same ${a.s.split(',').length} places with the same anchors (A ${a.n}, B ${b.n} values), no bare numbers`);
      await p.selectOption('#cmpVals', 'grid'); await p.waitForTimeout(2500); [a, b] = await sig();
      check(a.mode === 'grid' && b.mode === 'grid' && a.s === b.s && a.bare > 0 && /values=grid/.test(p.url()), `compare: one Values menu switches both panels to Places + grid (same points, ${a.bare} grid values each); link values=grid`);
      await p.screenshot({ path: path.join(out, 'compare-places.png') });
      check(!errors.length, `compare: no script errors ${errors.join('; ')}`); await ctx.close(); }
  } catch (e) { check(false, 'crashed: ' + (e.stack || e.message)); }
  await browser.close(); site.close(); data.close();
  console.log(failed ? `${failed} check(s) failed` : 'all Places checks passed'); process.exit(failed ? 1 : 0);
})();
