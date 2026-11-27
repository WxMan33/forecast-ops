#!/usr/bin/env node
/* Forecast record potential on Model Blend (desktop and 375 × 667, light and dark), offline. Every value is synthetic:
   the forecast comes from tests/fixtures/source-sim.js, NWS snowfall is added in 6-hour intervals that line up with the
   local day, and the daily records (RCC-ACIS interval queries) are written per date to sit at, just above or below the
   simulated values. Checks the card's sentences, numbers and spread, that it hides on a market with no candidates, that
   switching markets never shows one market's candidates under another, and that model snowfall is never compared.
   Usage: node tools/record-potential-check.js [out-dir] [--print] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const sim = require('../tests/fixtures/source-sim.js');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(require('node:os').tmpdir(), 'record-potential'));
fs.mkdirSync(out, { recursive: true });
const PRINT = process.argv.includes('--print'), NOW = Date.parse('2026-11-11T13:30:00Z'), H = 3600e3, DAY0 = Date.parse('2026-11-11T05:00:00Z');
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const CORS = { 'Access-Control-Allow-Origin': '*' };
const CVG = { lat: 39.1005, lon: -84.5017, name: 'Sawyer Point, Cincinnati, OH' }, CMH = { lat: 39.9612, lon: -82.9988, name: 'Columbus, OH' };
const q = (p) => `lat=${p.lat}&lon=${p.lon}&name=${encodeURIComponent(p.name)}`;
/* synthetic daily records by station and MM-DD: { maxt, lowMax, mint, highMin, pcpn, snow }; anything not listed is far away */
const FAR = { maxt: 99, lowMax: -10, mint: -20, highMin: 90, pcpn: 9.99, snow: 30 };
let RECS = {};
function history(sid, md, since, last) {
  /* the 8th year carries the high-side records (record high, record warm low, precipitation, snowfall), the 12th the
     low-side ones (record cold high, record low); every other year sits between the extremes */
  const r = { ...FAR, ...((RECS[sid] || {})[md] || {}) }, rows = [], midT = Math.round((r.maxt + r.lowMax) / 2), midN = Math.round((r.mint + r.highMin) / 2);
  for (let y = since; y <= last; y++) {
    const i = y - since, top = i === 7, low = i === 11;
    rows.push([`${y}-${md}`, String(top ? r.maxt : low ? r.lowMax : midT), String(top ? r.highMin : low ? r.mint : midN), (top ? r.pcpn : r.pcpn * 0.3).toFixed(2), (top ? r.snow : r.snow * 0.3).toFixed(1)]);
  }
  return rows;
}
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const f = path.resolve(root, rel || 'index.html');
  try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });
const META = [['CINCINNATI/NORTHERN KENTUCKY INTERNATIONAL AIRPORT', '93814', 'CVG', -84.67, 39.04], ['COLUMBUS JOHN GLENN COLUMBUS INTERNATIONAL AIRPORT', '14821', 'CMH', -82.88, 39.99]]
  .map(([name, wban, faa, lon, lat]) => ({ name, sids: [wban + ' 1', faa + ' 3', faa + 'thr 9'], ll: [lon, lat], valid_daterange: [['1947-01-01', '2026-11-10']] }));
async function route(ctx, base, { snowCmh = true } = {}) {
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url()), json = (b, status = 200) => r.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.origin === base) return r.continue();
    if (u.hostname === 'data.rcc-acis.org') {
      const body = r.request().postDataJSON() || {};
      if (u.pathname.endsWith('/StnMeta')) return body.sids ? json({ meta: String(body.sids).split(',').map((s) => ({ name: `${s.replace(/thr$/, '')} AREA`, sids: [s + ' 9'], valid_daterange: [['1871-01-01', '2026-11-10']] })) }) : json({ meta: META });
      if ((body.elems || []).some((e) => e && e.interval)) { const md = String(body.edate).slice(5), since = +String(body.sdate).slice(0, 4), last = +String(body.edate).slice(0, 4);
        return json({ meta: { name: `${body.sid} AREA`, valid_daterange: [] }, data: history(String(body.sid).replace(/thr$/, ''), md, since, last) }); }
      /* recent observations and normals, so the station counts as a working climate site */
      const data = []; for (let d = new Date((body.sdate || '2026-11-01') + 'T12:00Z'); d <= new Date((body.edate || '2026-11-10') + 'T12:00Z'); d.setUTCDate(d.getUTCDate() + 1)) data.push([d.toISOString().slice(0, 10), '60', '56']);
      return json({ meta: { valid_daterange: [['1947-01-01', '2026-11-10']], tzo: -5 }, data });
    }
    if (u.hostname === 'api.weather.gov' && u.pathname.startsWith('/products')) return json({ '@graph': [{ id: 'cli', issuingOffice: 'KILN', issuanceTime: '2026-11-11T06:00:00Z' }] });
    if (u.hostname === 'geocoding-api.open-meteo.com') return json({ results: [] });
    if (/^(api|ensemble-api)\.open-meteo\.com$|^api\.weather\.gov$/.test(u.hostname)) {
      const a = await sim.answer(u.href, {}, NOW, []).catch(() => null);
      if (!a || a.hang) return r.fulfill({ status: 503, headers: CORS, body: '' });
      let bodyText = a.body;
      /* NWS gridded snowfall for Columbus: Nov 14 in four 6-hour intervals inside the local day (synthetic, 4.4 in) */
      if (snowCmh && u.hostname === 'api.weather.gov' && /\/gridpoints\/ILN\/cmh$/.test(u.pathname)) { const j = JSON.parse(a.body), d = DAY0 + 3 * 24 * H;
        j.properties.snowfallAmount = { uom: 'wmoUnit:mm', values: [0, 1, 2, 3].map((k) => ({ validTime: `${new Date(d + k * 6 * H).toISOString()}/PT6H`, value: 27.94 })) };
        bodyText = JSON.stringify(j); }
      return r.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: bodyText });
    }
    return r.fulfill({ status: 503, headers: CORS, body: '' });
  });
}
async function open(b, base, place, { vp = { width: 1366, height: 900 }, theme = 'light', snowCmh = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/New_York' }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message)); await p.clock.install({ time: new Date(NOW) });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); }, theme);
  await route(ctx, base, { snowCmh }); await p.goto(`${base}/blend.html?${q(place)}`);
  await p.waitForFunction(() => document.querySelectorAll('#daily tr[data-k]').length >= 5, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500); await p.waitForFunction(() => document.getElementById('recordPotential').dataset.items !== undefined, null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(1500); return { ctx, p, errors };
}
const rowsOf = (p) => p.evaluate(() => [...document.querySelectorAll('#daily tr[data-k]')].map((tr) => { const c = [...tr.children].map((td) => td.innerText.replace(/\s+/g, ' ').trim()); return { k: tr.dataset.k, lo: c[1], hi: c[2], qpf: c[3] }; }));
const cardOf = (p) => p.evaluate(() => { const h = document.getElementById('recordPotential'), main = document.querySelector('#daily');
  return { hidden: h.hidden, text: h.innerText.replace(/\s+/g, ' '), items: [...h.querySelectorAll('.rp-item')].map((e) => ({ key: e.dataset.key, state: e.dataset.state, kind: e.dataset.kind, sentence: e.querySelector('.rp-sentence').textContent.replace(/\s+/g, ' ').trim(), nums: e.querySelector('.rp-nums').textContent.replace(/\s+/g, ' ').trim(), note: (e.querySelector('.rp-note') || {}).textContent || '' })),
    above: !!main && h.getBoundingClientRect().top < main.getBoundingClientRect().top, hs: document.documentElement.scrollWidth > innerWidth + 1 }; });
(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`, b = await chromium.launch();
  try {
    if (PRINT) { for (const pl of [CVG, CMH]) { const { ctx, p } = await open(b, base, pl); console.log(pl.name, JSON.stringify(await rowsOf(p))); await ctx.close(); } }
    else {
    /* the records: Columbus Nov 12 high record 1°F above its blend high; Nov 13 warm-low record equal to its blend low;
       Nov 13 precipitation record equal to its blend total; Nov 14 snowfall record 4.0 in (NWS 4.4 in, model snow far
       below); Cincinnati: nothing near. The blend values these are set from are read from the page first. */
    { const { ctx, p } = await open(b, base, CMH); const rows = await rowsOf(p); await ctx.close();
      const num = (s) => parseFloat(String(s).replace(/[^\d.-]+/g, ' ').trim().split(' ')[0]);
      const at = (k) => rows.find((r) => r.k === k) || {};
      RECS = { CMH: { '11-12': { maxt: num(at('2026-11-12').hi) + 1 }, '11-13': { highMin: num(at('2026-11-13').lo), pcpn: num(at('2026-11-13').qpf) }, '11-14': { snow: 4.0 } } };
      console.log(`(synthetic) Columbus blend: Nov 12 high ${at('2026-11-12').hi}; Nov 13 low ${at('2026-11-13').lo}, precip ${at('2026-11-13').qpf}. Records set: ${JSON.stringify(RECS.CMH)}`); }
    for (const [dev, vp] of [['desktop', { width: 1366, height: 900 }], ['phone', { width: 375, height: 667 }]]) for (const theme of ['light', 'dark']) {
      const L = `${dev} ${theme}:`, { ctx, p, errors } = await open(b, base, CMH, { vp, theme }), c = await cardOf(p), by = (k) => c.items.find((i) => i.key === k) || {};
      check(!c.hidden && c.above && /Forecast record potential/i.test(c.text), `${L} the card shows near the top of Blend, above the daily table`);
      check(by('2026-11-12-highMax').state === 'near' && by('2026-11-12-highMax').sentence === "Near record Thursday's forecast high is within 1°F of the record high." && /Record \d+°F \(\d{4}\)/.test(by('2026-11-12-highMax').nums) && /Gap 1°F short/.test(by('2026-11-12-highMax').nums) && /Guidance range \d+–\d+°F/.test(by('2026-11-12-highMax').note), `${L} Thursday: within 1°F of the record high, with blend, record, year, gap and guidance range (${by('2026-11-12-highMax').sentence})`);
      check(by('2026-11-13-highMin').state === 'tie' && by('2026-11-13-highMin').sentence === "Would tie The current blend would tie Friday's record warm low.", `${L} Friday: the blend low ties the record warm low (${by('2026-11-13-highMin').sentence})`);
      check(by('2026-11-13-pcpn').state === 'tie' && by('2026-11-13-pcpn').sentence === "Would tie The current blend would tie Friday's daily precipitation record." && /Record 0\.\d\d in \(\d{4}\)/.test(by('2026-11-13-pcpn').nums), `${L} Friday: the blend total ties the daily precipitation record (${by('2026-11-13-pcpn').nums})`);
      check(by('2026-11-14-snow').state === 'break' && by('2026-11-14-snow').sentence === "Would break NWS's snowfall forecast would break Saturday's daily snowfall record." && /NWS snowfall forecast 4\.4 in/.test(by('2026-11-14-snow').nums), `${L} Saturday: NWS's 4.4 in snowfall forecast would break the 4.0 in record`);
      check(!c.items.some((i) => i.key.startsWith('2026-11-11')) && c.items.length === 4 && !/—/.test(c.text) && !c.hs && !errors.length, `${L} nothing for today (a partial day) or anything else; no em dashes, no sideways scroll, no page errors (${c.items.map((i) => i.key).join(', ')}) ${errors.join('; ')}`);
      await p.locator('#recordPotential').screenshot({ path: path.join(out, `record-potential-${dev}-${theme}.png`) });
      if (dev === 'desktop' && theme === 'light') await p.screenshot({ path: path.join(out, 'record-potential-page-top.png') });
      await ctx.close();
    }
    /* model snowfall alone is never compared: without NWS snowfall, the 4.0 in record has no candidate even though the
       records are the same */
    { const { ctx, p } = await open(b, base, CMH, { snowCmh: false }), c = await cardOf(p);
      check(!c.items.some((i) => i.kind === 'snow'), `no NWS snowfall: no snowfall candidate from model snow (${c.items.map((i) => i.key).join(', ')})`); await ctx.close(); }
    /* Cincinnati: nothing near any record, so no card; switching markets clears and redraws */
    { const { ctx, p, errors } = await open(b, base, CVG), c0 = await cardOf(p);
      check(c0.hidden && !c0.text, 'Cincinnati (no record within reach): the card is hidden');
      const mid = await p.evaluate((pl) => { Ops.setLocation(pl); const h = document.getElementById('recordPotential'); return { hidden: h.hidden, text: h.innerText }; }, CMH);
      await p.waitForFunction(() => document.querySelectorAll('#recordPotential .rp-item').length === 4, null, { timeout: 30000 }).catch(() => {}); const c1 = await cardOf(p);
      check(mid.hidden && !c1.hidden && c1.items.length === 4, `switch Cincinnati to Columbus: Columbus's four candidates appear (${c1.items.length})`);
      const mid2 = await p.evaluate((pl) => { Ops.setLocation(pl); const h = document.getElementById('recordPotential'); return { hidden: h.hidden, text: h.innerText }; }, CVG);
      await p.waitForTimeout(6000); const c2 = await cardOf(p);
      check(mid2.hidden && !mid2.text.trim() && c2.hidden && !errors.length, `switch back to Cincinnati: the card clears at once and stays hidden; no page errors ${errors.join('; ')}`); await ctx.close(); }
    }
  } catch (e) { console.log('FAIL ' + (e.stack || e)); failed++; }
  await b.close(); server.close();
  if (!PRINT) { console.log(failed ? `${failed} record potential checks failed` : 'all record potential checks passed'); process.exit(failed ? 1 : 0); }
})();
