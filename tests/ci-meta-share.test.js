/* CI metadata sharing (tools/ci-meta-share.js), offline: the app's real ops-data.js in a local page, the provider simulated.
   A later browser must be served from the app's own cache with the ORIGINAL retrieval time; sharing ends 15 minutes after
   that retrieval; failures and other URLs are never shared; a browser without attach() is never intercepted. */
'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), { chromium } = require('playwright');
const { createMetaShare, META_RE } = require('../tools/ci-meta-share.js');
const root = path.resolve(__dirname, '..');
let n = 0, fails = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL ' + m); } };
const META = 'https://api.open-meteo.com/data/ncep_gfs013/static/meta.json', BAD = 'https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json';
(async () => {
  const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x');
    if (u.pathname === '/') { r.setHeader('Content-Type', 'text/html'); return r.end('<!doctype html><script src="/assets/ops-core.js"></script><script src="/assets/ops-data.js"></script>'); }
    try { r.setHeader('Content-Type', 'application/javascript'); r.end(fs.readFileSync(path.join(root, u.pathname))); } catch (e) { r.writeHead(404); r.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  let offset = 0, upstreamCalls = []; const clockNow = () => Date.now() + offset;
  /* the simulated provider: metadata answers 200 JSON; BAD answers 500 */
  const fakeResp = (status, body) => ({ status: () => status, body: async () => Buffer.from(body), headers: () => ({}) });
  const share = createMetaShare({ now: clockNow, upstream: async (r) => { upstreamCalls.push(r.request().url()); return r.request().url() === BAD ? fakeResp(500, '{"error":true}') : fakeResp(200, JSON.stringify({ last_run_initialisation_time: 1794880000, update_interval_seconds: 3600 })); } });
  const browser = await chromium.launch();
  /* fulfil({response}) needs a real APIResponse; give the page a fulfilled answer from a fallback route registered first */
  /* a browser without attach() reaches this simulated provider directly (the stand-in for the network) */
  const direct = (r) => r.fulfill({ status: r.request().url() === BAD ? 500 : 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: r.request().url() === BAD ? '{"error":true}' : '{"last_run_initialisation_time":1794880000}' });
  const page = async (attach) => { const ctx = await browser.newContext(); if (attach) await share.attach(ctx); else await ctx.route(META_RE, direct);
    const p = await ctx.newPage(); await p.clock.install({ time: new Date(clockNow()) }); const seen = []; p.on('request', (q) => { if (META_RE.test(q.url())) seen.push(q.url()); }); await p.goto(base); return { ctx, p, seen }; };
  const get = (p, url) => p.evaluate((u) => window.OpsData.getJSON(u, 15).then((j) => ({ from: j.__fromCache, at: j.__retrievedAt, err: !!j.error })), url);
  try {
    let a = await page(true); const r1 = await get(a.p, META), rBad = await get(a.p, BAD); await a.ctx.close();
    ok(r1.from === false && upstreamCalls.filter((u) => u === META).length === 1, 'the first browser gets the metadata from the provider');
    const first = r1.at;
    offset += 5 * 60e3;
    let b = await page(true); const r2 = await get(b.p, META), r2bad = await get(b.p, BAD);
    ok(r2.from === true && Math.abs(Date.parse(r2.at) - Date.parse(first)) < 2000, `a later browser is served from the app's own cache with the original retrieval time (${r2.at}; first ${first})`);
    ok(!b.seen.includes(META) && upstreamCalls.filter((u) => u === META).length === 1, 'no request leaves the later browser for the shared metadata');
    ok(rBad.err && r2bad.err && b.seen.includes(BAD), 'a failed metadata answer is never shared: the later browser asks again');
    await b.ctx.close();
    offset += 11 * 60e3; // 16 minutes after the original retrieval
    let c = await page(true); const r3 = await get(c.p, META); await c.ctx.close();
    ok(r3.from === false && upstreamCalls.filter((u) => u === META).length === 2, 'sharing ends 15 minutes after the original retrieval: the provider is asked again');
    let d = await page(false); await get(d.p, META); const direct = d.seen.slice(); await d.ctx.close();
    ok(direct.includes(META), 'a browser opened without attach() (the direct-browser check) sends its own request');
    ok(!META_RE.test('https://api.open-meteo.com/v1/forecast?latitude=1') && !META_RE.test('https://ensemble-api.open-meteo.com/v1/ensemble?x=1') && !META_RE.test('https://api.open-meteo.com/data/x/static/other.json'), 'only model metadata URLs are matched');
  } finally { await browser.close(); srv.close(); }
  console.log(fails ? `${fails} of ${n} CI metadata sharing checks failed` : `ok - ${n} CI metadata sharing checks passed`);
  process.exit(fails ? 1 : 0);
})();
