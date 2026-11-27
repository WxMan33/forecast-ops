#!/usr/bin/env node
/* Forecast record potential against a REAL recorded Model Blend load (CVG, recorded 2026-11-27: NWS, RCC-ACIS records,
   the site's trend feeds; tests/fixtures/blend/cvg-real-20261127.json.gz), replayed offline with the page clock at the
   recording time. Checks, after both the forecast and the climate records have loaded:
   1. all real: no forecast day is near a record (nearest: Nov 28 low 34°F vs warm low 55°F; Nov 29 0.51 in vs 0.86 in),
      so the card stays hidden while Record watch is active for CVGthr with no failed record checks;
   2. the same real forecast with ONE edited input, labelled: the Nov 29 record history is lowered so the record high sits
      1°F above the real blend high for that day; the card must then show exactly that candidate.
   Usage: node tools/record-potential-replay-check.js [out-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'record-potential-replay')); fs.mkdirSync(out, { recursive: true });
const F = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'tests/fixtures/blend/cvg-real-20261127.json.gz'))));
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const f = path.resolve(root, rel || 'index.html');
  try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });
/* edit: one date's record history, every year's high capped so the record high is `top` (in its first year) */
const editHigh = (text, top) => { const j = JSON.parse(text); j.data = j.data.map((r, i) => { const v = parseFloat(r[1]); return isFinite(v) ? [r[0], String(i === 0 ? top : Math.min(v, top - 3)), ...r.slice(2)] : r; }); return JSON.stringify(j); };
async function open(b, base, { vp = { width: 1366, height: 900 }, theme = 'light', edit = null } = {}) {
  const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message)); await p.clock.install({ time: new Date(Date.parse(F.recordedAt) - 600e3) });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); }, theme);
  await ctx.route('**/*', (rt) => { const q = rt.request(), u = new URL(q.url()); if (u.origin === base) return rt.continue();
    const hit = F.requests.find((x) => x.method === q.method() && x.url === q.url() && (x.body || '') === (q.postData() || ''));
    if (!hit) return rt.fulfill({ status: 503, body: '' });
    const body = edit && /StnData/.test(u.pathname) && /interval/.test(hit.body || '') && JSON.parse(hit.body).edate.slice(5) === edit.md ? editHigh(hit.text, edit.top) : hit.text;
    return rt.fulfill({ status: 200, headers: { 'content-type': hit.type, 'access-control-allow-origin': '*' }, body }); });
  await p.goto(`${base}/blend.html?${F.query}`);
  /* both inputs loaded: the daily table, and Record watch active (its note names the station) */
  await p.waitForFunction(() => document.querySelectorAll('#daily tr[data-k]').length >= 3 && /Record watch:/.test(document.getElementById('dailyNote').textContent), null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(4000); return { ctx, p, errors };
}
const state = (p) => p.evaluate(() => { const h = document.getElementById('recordPotential'), note = document.getElementById('dailyNote').textContent;
  return { hidden: h.hidden, items: [...h.querySelectorAll('.rp-item')].map((e) => ({ key: e.dataset.key, state: e.dataset.state, sentence: e.querySelector('.rp-sentence').textContent.replace(/\s+/g, ' ').trim(), nums: e.querySelector('.rp-nums').textContent.replace(/\s+/g, ' ').trim(), note: (e.querySelector('.rp-note') || {}).textContent || '' })),
    watch: /Record watch:[^.]*CVGthr/.test(note), unavailable: /Record checks unavailable/.test(note),
    hi: Object.fromEntries([...document.querySelectorAll('#daily tr[data-k]')].map((tr) => [tr.dataset.k, parseInt(tr.children[2].innerText, 10)])), hs: document.documentElement.scrollWidth > innerWidth + 1 }; });
(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`, b = await chromium.launch();
  try {
    let hi29;
    { const { ctx, p, errors } = await open(b, base), s = await state(p); hi29 = s.hi['2026-11-29'];
      check(s.watch && !s.unavailable && Number.isFinite(hi29), `real CVG forecast and records loaded: Record watch active for CVGthr, no failed record checks (Nov 29 blend high ${hi29}°F)`);
      check(s.hidden && !s.items.length && !errors.length, `real data: no forecast day near a record, so the card stays hidden ${errors.join('; ')}`);
      await ctx.close(); }
    for (const [dev, vp] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 375, height: 667 }]]) for (const theme of ['light', 'dark']) {
      const { ctx, p, errors } = await open(b, base, { vp, theme, edit: { md: '11-29', top: hi29 + 1 } }), s = await state(p), it = s.items[0] || {};
      check(!s.hidden && s.items.length === 1 && it.key === '2026-11-29-highMax' && it.state === 'near' && it.sentence === "Near record Sunday's forecast high is within 1°F of the record high." && it.nums.includes(`Blend ${hi29}°F`) && it.nums.includes(`Record ${hi29 + 1}°F`) && /^Guidance (range|around)/.test(it.note) && !s.hs && !errors.length,
        `${dev} ${theme}: real forecast, Nov 29 record history edited (labelled) to ${hi29 + 1}°F: the card shows exactly that candidate (${it.sentence} | ${it.nums} | ${it.note})`);
      await p.locator('#recordPotential').screenshot({ path: path.join(out, `replay-show-${dev}-${theme}.png`) }); await ctx.close(); }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await b.close(); server.close();
  console.log(failed ? `${failed} replay checks failed` : 'all replay checks passed'); process.exit(failed ? 1 : 0);
})();
