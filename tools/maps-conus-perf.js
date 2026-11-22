#!/usr/bin/env node
/* Phone performance of the CONUS model maps: cold load to first full-CONUS draw, zoom to a metro (native 3 km cells), and
   loop readiness (every hour of the view in memory), with bytes downloaded and map-data requests. iPhone 13 emulation on
   a throttled connection (default 9 Mbit/s down, 3 up, 60 ms). Usage:
   node tools/maps-conus-perf.js "<maps.html?domain=conus...>" [label] [--down 9] [--rtt 60] */
'use strict';
const { chromium, devices } = require('playwright');
const url = process.argv[2], label = process.argv[3] || 'view', arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage();
  await ctx.route(/script\.google\.com|fonts\.g/, (r) => r.abort());
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: arg('--rtt', 60), downloadThroughput: (arg('--down', 9) * 1e6) / 8, uploadThroughput: 3e6 / 8 });
  const ranged = { n206: 0, n200: 0 }; p.on('response', (r) => { if (/\.pack|\.bin\.gz/.test(r.url())) r.status() === 206 ? ranged.n206++ : ranged.n200++; });
  const S = () => p.evaluate(() => { const s = window.__conus; return s && s.man ? { bytes: s.loadedBytes, req: s.requests, shown: s.shown, draw: (s.draw || []).length, field: s.field, hours: s.man.hours.length, layout: s.man.layout } : null; });
  const t0 = Date.now(); await p.goto(url, { waitUntil: 'domcontentloaded' });
  if (await p.getByText('Open the page', { exact: true }).count()) await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), p.getByText('Open the page', { exact: true }).first().click()]); // raw.githack's one-time notice
  await p.waitForFunction(() => { const s = window.__conus; return s && s.shown && s.want && s.shown.coarse >= s.want.all.length; }, null, { timeout: 180000 });
  const cold = { ms: Date.now() - t0, ...(await S()) };
  /* zoom to Cincinnati at native resolution */
  const z0 = Date.now(), b0 = cold.bytes;
  await p.evaluate(() => window.__conus.map.jumpTo({ center: [-84.51, 39.10], zoom: 8.2 }));
  await p.waitForFunction(() => { const s = window.__conus; return s.want && s.want.L === 0 && s.shown && s.shown.fine >= s.shown.of; }, null, { timeout: 180000 });
  const zs = await S(), zoom = { ms: Date.now() - z0, bytes: zs.bytes - b0, req: zs.req - cold.req, level: 0 };
  /* loop readiness at the metro view: every hour of the run drawn from memory */
  const l0 = Date.now(), lb = zs.bytes; await p.click('#playBtn');
  await p.waitForFunction(() => /Loop ready for this view: (\d+) of \1 hours/.test(document.getElementById('runInfo').innerText), null, { timeout: 600000 });
  const ls = await S(), loop = { ms: Date.now() - l0, bytes: ls.bytes - lb, req: ls.req - zs.req, hours: ls.hours };
  await p.click('#playBtn');
  console.log(JSON.stringify({ label, url, network: { downMbps: arg('--down', 9), rttMs: arg('--rtt', 60) }, field: cold.field, layout: cold.layout,
    cold: { seconds: +(cold.ms / 1000).toFixed(1), MB: +(cold.bytes / 1e6).toFixed(2), requests: cold.req },
    zoomMetro: { seconds: +(zoom.ms / 1000).toFixed(1), MB: +(zoom.bytes / 1e6).toFixed(2), requests: zoom.req },
    loopAllHours: { hours: loop.hours, seconds: +(loop.ms / 1000).toFixed(1), MB: +(loop.bytes / 1e6).toFixed(2), requests: loop.req },
    responses: ranged }));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
