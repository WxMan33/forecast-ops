#!/usr/bin/env node
/* One-off capture of a fully real "card shows" case for Forecast record potential (Model Blend).
   1. Screen markets: NWS point forecast highs/lows for the coming days against each station's official threaded daily
      records (RCC-ACIS). This only finds candidates; it never decides anything.
   2. For the closest candidates, load blend.html (this checkout) with live data in a browser and record every response.
      The Model Blend value decides whether the card should appear; the card is read as shown.
   3. For each forecast day, read the official record for the same local date and measurement directly from RCC-ACIS and
      report the blend value, the record value and the card's wording side by side. Nothing is edited.
   Output: <out>/summary.json, <out>/<id>.json.gz (replayable recording), <out>/<id>.png. Usage: node tools/blend-real-capture.js <out> */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || '/tmp/capture'); fs.mkdirSync(out, { recursive: true });
const R = require('../assets/record-watch.js');
const MARKETS = { LAS: [36.072, -115.163, 'Las Vegas Harry Reid Airport, NV'], LAX: [33.938, -118.389, 'Los Angeles International Airport, CA'], MIA: [25.788, -80.317, 'Miami International Airport, FL'],
  OKC: [35.389, -97.601, 'Oklahoma City Will Rogers Airport, OK'], PHX: [33.434, -112.008, 'Phoenix Sky Harbor Airport, AZ'], ELP: [31.807, -106.376, 'El Paso International Airport, TX'],
  SAN: [32.734, -117.183, 'San Diego Lindbergh Field, CA'], TUS: [32.131, -110.955, 'Tucson International Airport, AZ'], DFW: [32.898, -97.019, 'Dallas/Fort Worth Airport, TX'],
  IAH: [29.98, -95.36, 'Houston Bush Airport, TX'], MSY: [29.993, -90.251, 'New Orleans Airport, LA'], TPA: [27.962, -82.540, 'Tampa International Airport, FL'],
  ABQ: [35.042, -106.609, 'Albuquerque Sunport, NM'], SLC: [40.788, -111.969, 'Salt Lake City Airport, UT'], DEN: [39.8561, -104.6737, 'Denver International Airport, CO'],
  SEA: [47.449, -122.309, 'Seattle-Tacoma Airport, WA'], SFO: [37.619, -122.375, 'San Francisco Airport, CA'], ATL: [33.630, -84.442, 'Atlanta Airport, GA'],
  BOS: [42.361, -71.010, 'Boston Logan Airport, MA'], MSP: [44.883, -93.229, 'Minneapolis-St Paul Airport, MN'], ORD: [41.995, -87.934, "Chicago O'Hare Airport, IL"] };
const UA = { 'user-agent': 'forecast-ops-check' };
const j = async (u, o = {}) => { for (let i = 0; i < 4; i++) { try { const r = await fetch(u, { ...o, headers: { ...UA, accept: 'application/geo+json, application/json', ...(o.headers || {}) } }); if (r.ok) return r.json(); if (r.status !== 429 && r.status < 500) return null; } catch (e) { /* retry */ } await new Promise((z) => setTimeout(z, 3000 * (i + 1))); } return null; };
const acis = (body) => j('https://data.rcc-acis.org/StnData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function recordsFor(sid, date) { const r = await acis({ sid, sdate: '1850-' + date.slice(5), edate: (+date.slice(0, 4) - 1) + '-' + date.slice(5), elems: [{ name: 'maxt', interval: [1, 0, 0] }, { name: 'mint', interval: [1, 0, 0] }, { name: 'pcpn', interval: [1, 0, 0] }, { name: 'snow', interval: [1, 0, 0] }] });
  return r && r.data ? R.records(r.data, date) : null; }
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const f = path.resolve(root, rel || 'index.html');
  try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });
(async () => {
  const today = new Date().toISOString().slice(0, 10), summary = { capturedAt: new Date().toISOString(), screen: [], blend: [] };
  /* 1. candidates from NWS vs official records */
  for (const [id, [lat, lon]] of Object.entries(MARKETS)) {
    const pt = await j(`https://api.weather.gov/points/${lat},${lon}`), fc = pt && await j(pt.properties.forecast); if (!fc) { summary.screen.push({ id, error: 'no NWS forecast' }); continue; }
    const byDay = {}; fc.properties.periods.forEach((p) => { const d = p.startTime.slice(0, 10); (byDay[d] = byDay[d] || {})[p.isDaytime ? 'hi' : 'lo'] = p.temperature; });
    let best = null;
    for (const [d, v] of Object.entries(byDay)) { if (d <= today) continue; const rec = await recordsFor(id + 'thr', d); if (!rec || !rec.highMax) continue;
      const gaps = [['hi', 'highMax', 1], ['hi', 'lowMax', -1], ['lo', 'lowMin', -1], ['lo', 'highMin', 1]].filter(([k]) => v[k] != null).map(([k, key, dir]) => ({ d, key, nws: v[k], record: rec[key].value, margin: (v[k] - rec[key].value) * dir }));
      gaps.forEach((g) => { if (!best || g.margin > best.margin) best = g; }); }
    summary.screen.push({ id, tz: pt.properties.timeZone, best }); console.log('screen', id, JSON.stringify(best));
  }
  const ranked = summary.screen.filter((s) => s.best && s.best.margin >= -3).sort((a, b) => b.best.margin - a.best.margin).slice(0, 6);
  console.log('candidates:', ranked.map((s) => `${s.id} ${s.best.d} ${s.best.key} NWS ${s.best.nws} vs ${s.best.record}`).join('; ') || 'none');
  /* 2. live Model Blend for each candidate, recording every response */
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`, b = await chromium.launch();
  for (const s of ranked) {
    const [lat, lon, name] = MARKETS[s.id], query = `lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`, rec = [];
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: s.tz || 'America/New_York' });
    await ctx.route('**/*', async (rt) => { const q = rt.request(), u = new URL(q.url()); if (u.origin === base) return rt.continue(); if (/fonts\.g/.test(u.hostname)) return rt.fulfill({ status: 503, body: '' });
      try { const h = { ...UA, accept: q.headers()['accept'] || '*/*' }; if (q.headers()['content-type']) h['content-type'] = q.headers()['content-type'];
        let r; for (let i = 0; i < 5; i++) { r = await fetch(q.url(), { method: q.method(), headers: h, body: q.postData() || undefined }); if (r.status !== 429) break; await new Promise((z) => setTimeout(z, 10000 * (i + 1))); }
        const text = Buffer.from(await r.arrayBuffer()).toString(), type = r.headers.get('content-type') || 'application/json';
        if (r.status === 200) rec.push({ method: q.method(), url: q.url(), body: q.postData() || null, type, text });
        await rt.fulfill({ status: r.status, headers: { 'content-type': type, 'access-control-allow-origin': '*' }, body: text }); } catch (e) { await rt.fulfill({ status: 503, body: '' }).catch(() => {}); } });
    const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${base}/blend.html?${query}`);
    await p.waitForFunction(() => document.querySelectorAll('#daily tr[data-k]').length >= 3 && /Record watch:/.test(document.getElementById('dailyNote').textContent), null, { timeout: 240000 }).catch(() => {});
    await p.waitForFunction(() => !/Record watch:/.test(document.getElementById('dailyNote').textContent) || document.getElementById('recordPotential').dataset.items !== undefined, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(20000);
    const page = await p.evaluate(() => { const h = document.getElementById('recordPotential'), note = document.getElementById('dailyNote').textContent;
      return { hidden: h.hidden, items: [...h.querySelectorAll('.rp-item')].map((e) => ({ key: e.dataset.key, state: e.dataset.state, sentence: e.querySelector('.rp-sentence').textContent.replace(/\s+/g, ' ').trim(), nums: e.querySelector('.rp-nums').textContent.replace(/\s+/g, ' ').trim(), note: (e.querySelector('.rp-note') || {}).textContent || '' })),
        station: (note.match(/Record watch:.*?record in the ([^.]*?)\. Tap/) || [])[1] || null, unavailable: (note.match(/Record checks unavailable for [^;]*/) || [null])[0],
        rows: [...document.querySelectorAll('#daily tr[data-k]')].map((tr) => { const c = [...tr.children].map((td) => td.innerText.replace(/\s+/g, ' ').trim()); return { k: tr.dataset.k, lo: c[1], hi: c[2], qpf: c[3] }; }) }; });
    /* 3. the official record for the same local date and measurement, straight from RCC-ACIS */
    const sid = page.station && (page.station.match(/\(([A-Z0-9]+)\)/) || [])[1];
    const days = []; for (const r of page.rows) { if (r.k <= today || !sid) continue; const rr = await recordsFor(sid, r.k); if (!rr) continue;
      days.push({ date: r.k, blendHi: parseInt(r.hi, 10), blendLo: parseInt(r.lo, 10), blendQpf: parseFloat(r.qpf), recordHigh: rr.highMax && rr.highMax.value, recordHighYears: rr.highMax && rr.highMax.years, recordColdHigh: rr.lowMax && rr.lowMax.value, recordLow: rr.lowMin && rr.lowMin.value, recordWarmLow: rr.highMin && rr.highMin.value, recordWarmLowYears: rr.highMin && rr.highMin.years, recordPcpn: rr.pcpn && rr.pcpn.value }); }
    const entry = { id: s.id, query, tz: s.tz, nwsCandidate: s.best, station: page.station, recordChecksUnavailable: page.unavailable, cardHidden: page.hidden, card: page.items, days, errors, responses: rec.length };
    summary.blend.push(entry); console.log('BLEND', JSON.stringify(entry));
    fs.writeFileSync(path.join(out, `${s.id}.json.gz`), zlib.gzipSync(JSON.stringify({ recordedAt: summary.capturedAt, query, tz: s.tz, requests: rec }), { level: 9 }));
    await p.screenshot({ path: path.join(out, `${s.id}.png`), fullPage: false }); if (!page.hidden) await p.locator('#recordPotential').screenshot({ path: path.join(out, `${s.id}-card.png`) });
    await ctx.close();
    if (summary.blend.filter((x) => !x.cardHidden).length >= 2) break;
  }
  await b.close(); server.close(); fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log('SUMMARY', JSON.stringify(summary.blend.map((x) => ({ id: x.id, station: x.station, shown: !x.cardHidden, card: x.card.map((c) => c.sentence + ' | ' + c.nums) }))));
})().catch((e) => { console.error(e); process.exit(1); });
