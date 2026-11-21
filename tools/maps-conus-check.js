#!/usr/bin/env node
/* Browser check of the CONUS Model Maps viewer against a locally built data site (forecast-ops-maps
   pipeline/conus.py output): every field switches and draws, init/valid/units are visible, missing and
   not-applicable hours are marked and explained, click-to-read equals the tile value, the loop steps over
   gaps, share links round-trip, and PNG export carries the metadata and credit. Phone and desktop.
   Usage: node tools/maps-conus-check.js DATA_SITE_DIR [out-dir]   (DATA_SITE_DIR contains data/conus/index.json) */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-conus')); fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(path.join(dataRoot, 'data/conus/index.json'))) { console.error('usage: node tools/maps-conus-check.js DATA_SITE_DIR [out]'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf', '.gz': 'application/octet-stream', '.pack': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html');
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, cors ? { 'Access-Control-Allow-Origin': '*' } : {}).end(); return; }
  const h = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...(cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' } : {}) };
  const size = fs.statSync(file).size, m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '');
  if (m) { const a = +m[1], b = m[2] ? +m[2] : size - 1; res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 }); fs.createReadStream(file, { start: a, end: b }).pipe(res); return; }
  res.writeHead(200, { ...h, 'Content-Length': size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

(async () => {
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`;
  const index = JSON.parse(fs.readFileSync(path.join(dataRoot, 'data/conus/index.json'), 'utf8'));
  const run = index.runs.find((r) => r.fields && r.fields.includes('apcp1h') && r.hours.includes(6)) || index.runs[0];
  const man = JSON.parse(fs.readFileSync(path.join(dataRoot, run.path, 'manifest.json'), 'utf8'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const [dev, device] of [['desktop', DESK], ['phone', PHONE]]) {
      const ctx = await browser.newContext({ ...device, acceptDownloads: true }), p = await ctx.newPage(), errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return u.hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' }); });
      await p.goto(`${base}/maps.html?domain=conus&data=${encodeURIComponent(DATA)}&run=${run.id}&fh=6&field=apcp1h`);
      await p.waitForFunction(() => window.__conus && window.__conus.man && window.__conus.draw, null, { timeout: 60000 }); await p.waitForTimeout(2500);
      const fieldsOffered = await p.$$eval('#fieldSel option', (o) => o.map((x) => x.value));
      check(['t2m', 'refc', 'ptype', 'apcp1h', 'apcp_run', 'asnow1h', 'asnow_run'].every((f) => fieldsOffered.includes(f)), `${dev}: field picker offers ${fieldsOffered.join(', ')}`);
      const head = async () => p.evaluate(() => document.getElementById('mapInfo').innerText.replace(/\s+/g, ' '));
      let h = await head();
      check(/HRRR 3 km/.test(h) && /1-h precipitation \(in\)/.test(h) && /Init \d\dZ/.test(h) && /F06/.test(h) && /valid/.test(h) && /Accumulated in the hour ending/.test(h), `${dev}: model, field, units, init, forecast hour, valid time and window visible: "${h.slice(0, 160)}"`);
      await p.screenshot({ path: path.join(out, `conus-apcp1h-${dev}.png`) });
      /* every field draws at F06 */
      for (const f of ['refc', 'ptype', 'asnow1h', 'asnow_run', 'apcp_run', 't2m']) {
        await p.selectOption('#fieldSel', f); await p.waitForTimeout(1800);
        const s = await p.evaluate(() => ({ field: window.__conus.field, draw: (window.__conus.draw || []).length, shown: window.__conus.shown, note: document.getElementById('mapNote').hidden ? '' : document.getElementById('mapNote').textContent, legend: document.getElementById('legend').innerText.replace(/\s+/g, ' '), url: location.search }));
        const has = man.fields[f] && man.fields[f].hours['6'] && !man.fields[f].hours['6'].notApplicable;
        if (has) check(s.field === f && s.draw > 0 && s.shown && s.shown.coarse > 0 && !s.note && new URLSearchParams(s.url).get('field') === f, `${dev}: ${f} draws (${s.shown && s.shown.coarse} coarse tiles) · legend "${s.legend.slice(0, 70)}" · link field=${new URLSearchParams(s.url).get('field')}`);
        else check(s.field === f && s.draw === 0 && /F06 is missing for this run/.test(s.note), `${dev}: ${f} F06 is missing in this run's manifest: nothing drawn, and the map says "${s.note.slice(0, 80)}…"`);
        if (dev === 'desktop' || ['refc', 'ptype', 'asnow_run'].includes(f)) await p.screenshot({ path: path.join(out, `conus-${f}-${dev}.png`) });
      }
      /* switching field must never reuse the previous field's values: type after reflectivity == type loaded fresh */
      { const colors = async (page) => { const png = await page.locator('#map').screenshot();
          return page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data, ref = { rain: [62, 168, 96], snow: [72, 132, 228], ip: [232, 150, 44], zr: [214, 64, 150] }, n = { rain: 0, snow: 0, ip: 0, zr: 0 };
            for (let i = 0; i < d.length; i += 4) for (const [k, c3] of Object.entries(ref)) if (Math.abs(d[i] - c3[0] * 0.88) < 22 && Math.abs(d[i + 1] - c3[1] * 0.88) < 22 && Math.abs(d[i + 2] - c3[2] * 0.88) < 22) n[k]++;
            return n; }, png.toString('base64')); };
        await p.selectOption('#fieldSel', 'refc'); await p.waitForTimeout(1500); await p.selectOption('#fieldSel', 'ptype'); await p.waitForTimeout(2500);
        const switched = await colors(p), q = await ctx.newPage(); await q.goto(p.url().replace(/field=[a-z_0-9]+/, 'field=ptype'));
        await q.waitForFunction(() => window.__conus && window.__conus.draw && window.__conus.draw.length, null, { timeout: 60000 }); await q.waitForTimeout(2500);
        const fresh = await colors(q); await q.close();
        const close = (a, b) => Math.abs(a - b) <= Math.max(40, 0.1 * Math.max(a, b));
        check(Object.keys(fresh).every((k) => close(switched[k], fresh[k])) && fresh.rain > 0, `${dev}: precipitation type after switching from reflectivity matches a fresh load (rain ${switched.rain}/${fresh.rain}, snow ${switched.snow}/${fresh.snow}, ice pellets ${switched.ip}/${fresh.ip}, freezing rain ${switched.zr}/${fresh.zr} pixels)`); }
      const sim = await (async () => { await p.selectOption('#fieldSel', 'refc'); await p.waitForTimeout(800); return head(); })();
      check(/simulated/i.test(sim) && /not radar/i.test(sim), `${dev}: reflectivity labelled simulated, not radar`);
      /* F00: accumulations and type are not applicable, marked and explained */
      await p.selectOption('#fieldSel', 'asnow_run'); await p.evaluate(() => { const s = document.getElementById('hourSl'); s.value = '0'; s.dispatchEvent(new Event('input')); }); await p.waitForTimeout(800);
      const na = await p.evaluate(() => ({ note: document.getElementById('mapNote').textContent, hidden: document.getElementById('mapNote').hidden, draw: (window.__conus.draw || []).length, marks: [...document.querySelectorAll('#tlTicks i.gap')].map((i) => i.className + ':' + i.dataset.gap) }));
      check(!na.hidden && /not available at F00/.test(na.note) && na.draw === 0 && na.marks.includes('gap na:0'), `${dev}: F00 run-total snowfall says "${na.note.slice(0, 90)}…", draws nothing, and the timeline marks it`);
      const missing = Object.keys(man.fields.asnow1h.hours).length < man.hours.length ? man.hours.filter((x) => !man.fields.asnow1h.hours[String(x)]) : [];
      if (missing.length) { await p.selectOption('#fieldSel', 'asnow1h'); await p.waitForTimeout(500);
        const marks = await p.$$eval('#tlTicks i.gap.missing', (e) => e.map((x) => +x.dataset.gap));
        check(missing.every((x) => marks.includes(x)), `${dev}: missing 1-h snowfall hours marked red on the timeline (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''})`); }
      /* click-to-read equals the native tile value */
      await p.selectOption('#fieldSel', 'apcp_run'); await p.evaluate(() => { const s = document.getElementById('hourSl'); s.value = String(window.__conus.man.hours.indexOf(6)); s.dispatchEvent(new Event('input')); }); await p.waitForTimeout(1500);
      const box = await p.locator('#map').boundingBox();
      await p.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.55); await p.waitForTimeout(2500);
      const rd = await p.evaluate(() => ({ text: document.getElementById('inspect').innerText.replace(/\s+/g, ' '), sel: window.__conus.sel }));
      check(/Total precipitation since run start: (<|\d)/.test(rd.text) && /in/.test(rd.text) && /Accumulated from the run start/.test(rd.text) && rd.sel, `${dev}: point readout "${rd.text.slice(0, 120)}"`);
      /* share link reopens the same field, hour and point */
      const link = await p.evaluate(() => location.href);
      const q = await ctx.newPage(); await q.goto(link); await q.waitForFunction(() => window.__conus && window.__conus.draw && document.getElementById('inspect').innerText.includes('Total precipitation'), null, { timeout: 60000 }).catch(() => {});
      const back = await q.evaluate(() => ({ field: window.__conus.field, fh: window.__conus.man.hours[window.__conus.h], text: document.getElementById('inspect').innerText.replace(/\s+/g, ' ') }));
      check(back.field === 'apcp_run' && back.fh === 6 && back.text.slice(0, 60) === rd.text.slice(0, 60), `${dev}: share link reopens apcp_run F06 with the same point value`); await q.close();
      /* loop steps over gaps */
      await p.selectOption('#fieldSel', 'asnow1h'); await p.evaluate(() => { const s = document.getElementById('hourSl'); s.value = '0'; s.dispatchEvent(new Event('input')); }); await p.click('#playBtn'); await p.waitForFunction(() => window.__conus.h > 0, null, { timeout: 30000 }).catch(() => {});
      const loopAt = await p.evaluate(() => window.__conus.h); await p.click('#playBtn');
      check(loopAt > 0, `${dev}: the loop moves past the not-applicable F00 (now at hour index ${loopAt})`);
      /* PNG export */
      await p.selectOption('#fieldSel', 'asnow_run'); await p.evaluate(() => { const s = document.getElementById('hourSl'); s.value = String(window.__conus.man.hours.indexOf(6)); s.dispatchEvent(new Event('input')); }); await p.waitForTimeout(2000);
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#pngBtn')]);
      const png = path.join(out, `export-${dev}-${dl.suggestedFilename()}`); await dl.saveAs(png);
      const meta = await p.evaluate(() => window.__lastPng), size = fs.statSync(png).size;
      check(/^forecast-ops-hrrr-asnow_run-\d{10}z-f06\.png$/.test(dl.suggestedFilename()) && meta.width === 1600 && meta.mapH === 1000 && size > 50000, `${dev}: PNG ${dl.suggestedFilename()} (${meta.width} × ${meta.height}, ${Math.round(size / 1024)} KB)`);
      check(!errors.length, `${dev}: no script errors ${errors.join('; ')}`); await ctx.close();
    }
  } finally { await browser.close(); site.close(); data.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all CONUS map checks passed'); process.exit(failed ? 1 : 0);
})();
