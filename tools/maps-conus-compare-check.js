#!/usr/bin/env node
/* Browser check of the HRRR cycle comparison (maps.html?domain=conus&compare=1) against a locally built data site:
   defaults (newest vs previous run, same field and valid time), per-panel init / forecast hour, run-total windows
   flagged as not like for like, 1-h fields like for like, a valid time one run lacks, pan and point kept in step,
   phone A/B toggle, the way in from the single-run view, and the single-run view unchanged.
   Usage: node tools/maps-conus-compare-check.js DATA_SITE_DIR [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), dataRoot = path.resolve(process.argv[2] || ''), out = path.resolve(process.argv[3] || path.join(require('node:os').tmpdir(), 'maps-compare')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.pbf': 'application/x-protobuf' };
const serve = (dir, cors) => http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), file = path.resolve(dir, rel || 'index.html');
  const h = cors ? { 'Access-Control-Allow-Origin': '*' } : {};
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h).end(); return; }
  res.writeHead(200, { ...h, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
});
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const fr = (p, k) => p.frame({ url: new RegExp(`panel=${k}`) });

(async () => {
  const site = serve(root, false), data = serve(dataRoot, true);
  await Promise.all([site, data].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const base = `http://127.0.0.1:${site.address().port}`, DATA = `http://127.0.0.1:${data.address().port}/data`;
  const index = JSON.parse(fs.readFileSync(path.join(dataRoot, 'data/conus/index.json'), 'utf8')), runs = index.runs.slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const settle = (p) => p.waitForFunction(() => window.__cmp && ['A', 'B'].every((k) => { const a = window.__cmp.panel(k); const s = a && a.state(); return s && (s.hourState !== 'ok' || (s.draw > 0 && s.shown && s.shown.coarse > 0)); }), null, { timeout: 90000 }).then(() => p.waitForTimeout(1200));
  const S = (p) => p.evaluate(() => ({ A: window.__cmp.panel('A').state(), B: window.__cmp.panel('B').state(), note: document.getElementById('cmpNote').innerText.replace(/\s+/g, ' '), like: document.getElementById('cmpNote').dataset.likeForLike, valid: document.getElementById('cmpValid').innerText, url: location.search }));
  const head = (p, k) => fr(p, k).evaluate(() => document.getElementById('mapInfo').innerText.replace(/\s+/g, ' '));
  try {
    for (const [dev, device] of [['desktop', DESK], ['phone', PHONE]]) {
      const ctx = await browser.newContext(device), p = await ctx.newPage(), errors = [];
      p.on('pageerror', (e) => errors.push(e.message)); ctx.on('page', (x) => x.on('pageerror', (e) => errors.push(e.message)));
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      await p.goto(`${base}/maps.html?domain=conus&compare=1&field=asnow_run&data=${encodeURIComponent(DATA)}`);
      await settle(p); let s = await S(p);
      const wide = { ...(await p.evaluate(() => ({ sw: document.documentElement.scrollWidth }))), w: device.viewport.width };
      check(wide.sw <= wide.w + 1, `${dev}: no sideways scrolling (page ${wide.sw} px wide, screen ${wide.w} px)`);
      const shells = await p.evaluate(() => document.querySelectorAll('header').length);
      check(shells === 1, `${dev}: one site header and navigation (${shells})`);
      check(s.A.run === runs[0].id && s.B.run === runs[1].id && s.A.field === 'asnow_run' && s.B.field === 'asnow_run', `${dev}: defaults to the newest (${s.A.run}) and previous (${s.B.run}) runs, same field`);
      const vA = s.A.valid[s.A.fh], vB = s.B.valid[s.B.fh];
      check(vA === vB && s.A.fh !== s.B.fh, `${dev}: both panels at the same valid time ${vA} (A F${String(s.A.fh).padStart(2, '0')}, B F${String(s.B.fh).padStart(2, '0')})`);
      const shownHead = await Promise.all(['A', 'B'].map((k) => fr(p, k).evaluate(() => { const r = document.getElementById('mapInfo').getBoundingClientRect(); return r.width > 50 && r.height > 20; })));
      check(shownHead.every(Boolean) && /Data: NOAA\/NCEP HRRR/.test(await p.locator('.cmp-credit').innerText()), `${dev}: both panel headers are visible on the map, and the page carries the source credit`);
      const badge = await Promise.all(['A', 'B'].map((k) => fr(p, k).evaluate(() => getComputedStyle(document.querySelector('#mapInfo b.panel')).backgroundColor)));
      check(badge[0] !== badge[1] && /196, 96, 44/.test(badge[1]), `${dev}: panel labels match their controls (A ${badge[0]}, B ${badge[1]})`);
      const hA = await head(p, 'A'), hB = await head(p, 'B');
      check(/^A /.test(hA) && /Init \d\dZ/.test(hA) && /F\d\d/.test(hA) && /^B /.test(hB) && /Init \d\dZ/.test(hB) && hA.match(/Init (\d\dZ)/)[1] !== hB.match(/Init (\d\dZ)/)[1], `${dev}: each panel names its run and forecast hour ("${hA.slice(0, 70)}" | "${hB.slice(0, 70)}")`);
      check(s.like === 'false' && /Not like for like/.test(s.note) && /A totals \d+ h/.test(s.note) && /B totals \d+ h/.test(s.note) && /Accumulated from the run start/.test(hA) && /Accumulated from the run start/.test(hB), `${dev}: run totals flagged with both windows: "${s.note.slice(0, 150)}…"`);
      if (dev === 'desktop') await p.screenshot({ path: path.join(out, `compare-asnow_run-${dev}.png`) });
      /* 1-h field: like for like */
      await p.selectOption('#cmpField', 'apcp1h'); await settle(p); s = await S(p);
      check(s.A.field === 'apcp1h' && s.B.field === 'apcp1h' && s.like === 'true' && /Like for like: both panels show the hour ending/.test(s.note), `${dev}: 1-h precipitation is like for like ("${s.note.slice(0, 90)}")`);
      /* a valid time only B has */
      const onlyB = Object.values(s.B.valid).find((v) => !Object.values(s.A.valid).includes(v));
      await p.evaluate((v) => { const st = window.__cmp.st, i = st.times.indexOf(Date.parse(v)); const sl = document.getElementById('cmpSl'); sl.value = String(i); sl.dispatchEvent(new Event('input')); }, onlyB); await p.waitForTimeout(1500);
      s = await S(p); const gapNote = await fr(p, 'A').evaluate(() => document.getElementById('mapNote').textContent);
      check(s.A.hourState === 'no-valid' && s.A.draw === 0 && /has no forecast hour valid at/.test(gapNote) && /A<\/b>|A \(/.test(await p.evaluate(() => document.getElementById('cmpNote').innerHTML)) && /A — · B F\d\d/.test(s.valid), `${dev}: at ${onlyB} run A has no hour: nothing drawn, and both the panel and the page say so ("${gapNote.slice(0, 80)}…")`);
      /* Play advances both panels together, always at the same valid time */
      { const before = await S(p); await p.click('#cmpPlay'); await p.waitForFunction((v0) => { const st = window.__cmp.st; return st.valid !== v0; }, Date.parse(before.A.valid[before.A.fh] || before.B.valid[before.B.fh]), { timeout: 20000 }).catch(() => {});
        await p.waitForTimeout(1500); await p.click('#cmpPlay'); await p.waitForTimeout(800);
        const after = await S(p), vA = after.A.fh != null ? after.A.valid[after.A.fh] : null, vB = after.B.fh != null ? after.B.valid[after.B.fh] : null, page = await p.evaluate(() => window.__cmp.st.valid);
        const moved = page !== Date.parse(before.B.valid[before.B.fh]);
        check(moved && (vA == null || Date.parse(vA) === page) && (vB == null || Date.parse(vB) === page) && (vA || vB), `${dev}: Play advances both maps together (now A ${vA || 'no hour'}, B ${vB || 'no hour'}, page ${new Date(page).toISOString()})`); }
      /* back to a shared time; pan and point stay in step */
      await p.click('#cmpNext'); await p.click('#cmpNext'); await settle(p);
      await fr(p, 'A').evaluate(() => window.__conus.map.jumpTo({ center: [-93.3, 44.9], zoom: 6.5 })); await p.waitForTimeout(1500);
      const cB = await fr(p, 'B').evaluate(() => { const c = window.__conus.map.getCenter(); return [c.lng, c.lat, window.__conus.map.getZoom()]; });
      check(Math.abs(cB[0] + 93.3) < 1e-3 && Math.abs(cB[1] - 44.9) < 1e-3 && Math.abs(cB[2] - 6.5) < 1e-3 && new URLSearchParams(await p.evaluate(() => location.search)).get('map') === '44.900,-93.300,6.50', `${dev}: panning A moves B to the same place and zoom; the link keeps it`);
      await fr(p, 'A').evaluate(() => window.MapsConus.api.point(44.88, -93.22)); await p.evaluate(() => window.__cmp.panel('B').point(44.88, -93.22)); await p.waitForTimeout(2500);
      const rA = await fr(p, 'A').evaluate(() => document.getElementById('inspect').innerText.replace(/\s+/g, ' ')), rB = await fr(p, 'B').evaluate(() => document.getElementById('inspect').innerText.replace(/\s+/g, ' '));
      check(/1-h precipitation: /.test(rA) && /1-h precipitation: /.test(rB) && /cell/.test(rA), `${dev}: the same point read in both runs ("${rA.slice(0, 60)}" | "${rB.slice(0, 60)}")`);
      if (dev === 'phone') {   /* A/B toggle: one panel at a time, both kept loaded */
        const vis = () => p.evaluate(() => ['A', 'B'].map((k) => getComputedStyle(document.querySelector(`.cmp-p[data-p="${k}"]`)).visibility));
        const before = await vis(); await p.screenshot({ path: path.join(out, 'compare-phone-A.png') });
        await p.click('#abB'); await p.waitForTimeout(1500); const after = await vis(), bdraw = (await S(p)).B.draw;
        await p.screenshot({ path: path.join(out, 'compare-phone-B.png') });
        check(before.join() === 'visible,hidden' && after.join() === 'hidden,visible' && bdraw > 0 && /B \d\dZ F\d\d/.test(await p.locator('#abB').innerText()), `${dev}: A/B toggle shows one panel at a time (${before.join('/')} → ${after.join('/')}), B drawn after switching`);
      }
      check(!errors.length, `${dev}: no script errors ${errors.join('; ')}`); await ctx.close();
    }
    /* index states: zero runs, failed fetch, one run, and a shared link whose run rotated out */
    { const os = require('node:os'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-idx-'));
      const variant = (name, idx) => { const d = path.join(tmp, name, 'data', 'conus'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify(idx));
        if (!fs.existsSync(path.join(d, 'hrrr'))) fs.symlinkSync(path.join(dataRoot, 'data/conus/hrrr'), path.join(d, 'hrrr')); return path.join(tmp, name); };
      const fail = [{ id: runs[1].id, error: 'HTTP Error 429: Unknown Error' }];
      const roots = { zero: variant('zero', { ...index, runs: [], failures: fail }), one: variant('one', { ...index, runs: [runs[0]], failures: fail }), all: variant('all', index) };
      const srv = {}; for (const [k, dir] of Object.entries(roots)) { srv[k] = serve(dir, true); await new Promise((ok) => srv[k].listen(0, '127.0.0.1', ok)); }
      const urlOf = (k, extra = '') => `${base}/maps.html?domain=conus&compare=1&field=apcp1h${extra}&data=${encodeURIComponent(k === 'broken' ? `http://127.0.0.1:9/data` : `http://127.0.0.1:${srv[k].address().port}/data`)}`;
      const ctx = await browser.newContext(PHONE), errors = [];
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      const look = async (u) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(u); await p.waitForFunction(() => window.__cmp && window.__cmp.st.mode, null, { timeout: 60000 }); await p.waitForTimeout(2500);
        const r = await p.evaluate(() => ({ mode: window.__cmp.st.mode, status: (document.getElementById('cmpStatus').hidden ? '' : document.getElementById('cmpStatus').innerText).replace(/\s+/g, ' '), play: document.getElementById('cmpPlay').disabled, panels: document.getElementById('cmpPanels').hidden,
          field: document.getElementById('cmpField').options.length, b: document.getElementById('cmpB').disabled, A: window.__cmp.panel('A') && window.__cmp.panel('A').state(), sw: document.documentElement.scrollWidth })); return { p, r }; };
      for (const [k, what] of [['zero', 'zero runs'], ['broken', 'the run list fails to load']]) {
        const { p, r } = await look(urlOf(k)); await p.screenshot({ path: path.join(out, `compare-state-${k}.png`) });
        const said = k === 'zero' ? /No HRRR runs are published right now: the \d\dZ .* run didn't publish in the latest build \(HTTP Error 429\)/.test(r.status) : /could not be loaded/.test(r.status);
        check(r.mode === 'none' && said && r.play && r.panels && r.sw <= 391, `${what}: "${r.status.slice(0, 120)}"; Play and every control disabled, no blank maps`); await p.close(); }
      { const { p, r } = await look(urlOf('one')); await p.screenshot({ path: path.join(out, 'compare-state-one.png') });
        const t0 = r.A && r.A.fh; await p.click('#cmpNext'); await p.waitForTimeout(1500); const t1 = await p.evaluate(() => window.__cmp.panel('A').state().fh);
        check(r.mode === 'single' && /Comparison needs two runs\. Only the \d\dZ .* run is published right now; the \d\dZ .* run didn't publish/.test(r.status) && !r.play && r.b && r.field > 0 && r.A && r.A.draw >= 0 && t1 !== t0 && r.sw <= 391,
          `one run: shown on its own with the reason ("${r.status.slice(0, 150)}…"), field menu filled, B disabled, Play and stepping work (F${t0} → F${t1})`); await p.close(); }
      { const gone = '2026010100', { p, r } = await look(urlOf('all', `&a=${gone}&b=${runs[1].id}`)); const st = await p.evaluate(() => ({ a: window.__cmp.st.run.A.id, b: window.__cmp.st.run.B.id }));
        check(r.mode === 'pair' && st.a !== st.b && st.b === runs[1].id && st.a === runs[0].id && /The 00Z .* run in this link is no longer published \(HRRR runs rotate out\); A shows the \d\dZ .* run instead/.test(r.status),
          `shared link after a run rotated out: "${r.status.slice(0, 140)}" (A ${st.a}, B ${st.b})`); await p.close(); }
      { const { p, r } = await look(urlOf('all', `&a=2026010100&b=2026010200`)); const st = await p.evaluate(() => ({ a: window.__cmp.st.run.A.id, b: window.__cmp.st.run.B.id }));
        check(r.mode === 'pair' && st.a === runs[0].id && st.b === runs[1].id && (r.status.match(/no longer published/g) || []).length === 2, `both runs in a link rotated out: the two newest published runs, distinct (${st.a} vs ${st.b}), each substitution stated`); await p.close(); }
      check(!errors.length, `index states: no script errors ${errors.join('; ')}`);
      await ctx.close(); Object.values(srv).forEach((x) => x.close()); }
    /* the way in from the single-run view, and the single-run view itself is unchanged */
    { const ctx = await browser.newContext(DESK), p = await ctx.newPage();
      await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 204, body: '' })));
      await p.goto(`${base}/maps.html?domain=conus&run=${runs[0].id}&fh=4&field=refc&data=${encodeURIComponent(DATA)}`);
      await p.waitForFunction(() => window.__conus && window.__conus.draw && window.__conus.draw.length, null, { timeout: 60000 });
      const single = await p.evaluate(() => ({ timeline: !document.getElementById('timeline').hidden && getComputedStyle(document.getElementById('timeline')).display !== 'none', cmp: !document.getElementById('cmpBtn').hidden, frames: document.querySelectorAll('iframe').length }));
      await Promise.all([p.waitForNavigation(), p.click('#cmpBtn')]); await settle(p); const s = await S(p);
      check(single.timeline && single.cmp && single.frames === 0 && s.A.run === runs[0].id && s.A.field === 'refc' && s.A.fh === 4 && s.B.run === runs[1].id, `single-run view keeps its own timeline; COMPARE opens ${s.A.run} F04 vs ${s.B.run}, reflectivity, same valid time`);
      await p.screenshot({ path: path.join(out, 'compare-refc-desktop.png') }); await ctx.close(); }
  } finally { await browser.close(); site.close(); data.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all cycle comparison checks passed'); process.exit(failed ? 1 : 0);
})();
