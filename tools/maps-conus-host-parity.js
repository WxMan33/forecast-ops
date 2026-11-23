#!/usr/bin/env node
/* Hosted parity check: the same viewer, pointed at two data hosts (GitHub Pages one-file-per-tile, and the R2 packed
   layout read with HTTP range requests), must show the same numbers. For one run both hosts publish it compares the
   SHA-256 of display tiles (all three levels, several fields and hours), the Values labels, the click readout, the loop,
   and a same-window cycle comparison; and it records requests, bytes and HTTP status per host.
   Usage: node tools/maps-conus-host-parity.js VIEWER_URL HOST_A_DATA HOST_B_DATA RUN COMPARE_A COMPARE_B [out-dir]
   e.g.   node tools/maps-conus-host-parity.js https://raw.githack.com/WxMan33/forecast-ops/claude/conus-model-maps/maps.html \
            https://wxman33.github.io/forecast-ops-maps/data https://pub-….r2.dev/data 2026112218 2026112222 2026112218 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), { chromium } = require('playwright');
const [VIEWER, HA, HB, RUN, CA, CB] = process.argv.slice(2), out = path.resolve(process.argv[8] || path.join(require('node:os').tmpdir(), 'maps-parity')); fs.mkdirSync(out, { recursive: true });
if (!CB) { console.log('usage: VIEWER_URL HOST_A_DATA HOST_B_DATA RUN COMPARE_A COMPARE_B [out-dir]'); process.exit(2); }
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const FIELDS = ['t2m', 'apcp_run', 'asnow_run', 'refc'], HOURS = [6, 30];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const go = async (p, url) => { await p.goto(url); const b = p.locator('text=Open the page'); if (await b.count()) await Promise.all([p.waitForNavigation(), b.click()]); };
  const settle = (p) => p.waitForFunction(() => window.__conus && window.__conus.draw && window.__conus.draw.length && window.MapsConus.api.labels().shown.length > 0, null, { timeout: 120000 }).then(() => p.waitForTimeout(2500));
  async function single(host, device, tag) {
    const ctx = await browser.newContext(device), p = await ctx.newPage(), errs = [], net = { n: 0, s206: 0, s200: 0, bytes: 0, other: [] };
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('response', async (r) => { if (!r.url().startsWith(host.replace(/\/data$/, ''))) return; net.n++; const s = r.status(); if (s === 206) net.s206++; else if (s === 200) net.s200++; else net.other.push(`${s} ${r.url().slice(-60)}`);
      const len = +(r.headers()['content-length'] || 0); net.bytes += len; });
    await go(p, `${VIEWER}?domain=conus&data=${encodeURIComponent(host)}&run=${RUN}&fh=6&field=t2m&map=39.10,-84.51,7.3`); await settle(p);
    const first = { ...net }, r = { tag };
    r.labels = await p.evaluate(() => window.MapsConus.api.labels().shown.map((o) => `${o.k}:${o.text}`).join(','));
    await p.mouse.click(device.viewport.width / 2, device.viewport.height / 2 + (device.isMobile ? 60 : 0)); await p.waitForTimeout(2500);
    r.readout = (await p.evaluate(() => document.querySelector('#inspect').innerText)).split('\n')[0];
    /* the loop: frames from this host, steady labels */
    const seen = new Set(); await p.click('#playBtn'); for (let k = 0; k < 10; k++) { await p.waitForTimeout(800); seen.add(await p.evaluate(() => window.MapsConus.api.state().fh)); } await p.click('#playBtn');
    r.loop = seen.size; await p.waitForTimeout(8000);   /* let the loop prefetch finish */
    r.net = { first, after: { ...net } };
    /* tile hashes */
    r.hash = {};
    for (const f of FIELDS) { await p.evaluate((f) => window.MapsConus.api.setField(f), f);
      for (const fh of HOURS) for (const [L, tx, ty] of [[2, 0, 0], [2, 1, 0], [2, 1, 1], [1, 2, 1], [1, 3, 1], [0, 6, 2], [0, 6, 3], [0, 3, 2]]) {
        try { r.hash[`${f}|${fh}|L${L}_${tx}_${ty}`] = (await p.evaluate(([fh, L, tx, ty]) => window.MapsConus.api.tileHash(fh, L, tx, ty), [fh, L, tx, ty])).hash; }
        catch (e) { r.hash[`${f}|${fh}|L${L}_${tx}_${ty}`] = 'ERR ' + e.message.slice(0, 60); } } }
    await p.evaluate(() => window.MapsConus.api.setField('asnow6'));
    for (const [L, tx, ty] of [[2, 0, 0], [2, 1, 0], [1, 1, 0], [0, 1, 1]]) r.hash[`asnow6|12|L${L}_${tx}_${ty}`] = (await p.evaluate(([L, tx, ty]) => window.MapsConus.api.tileHash(12, L, tx, ty), [L, tx, ty])).hash;
    await p.screenshot({ path: path.join(out, `${tag}.png`) });
    r.errs = errs; await ctx.close(); return r;
  }
  async function compare(host, tag) {
    const ctx = await browser.newContext(DESK), p = await ctx.newPage(), errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await go(p, `${VIEWER}?domain=conus&compare=1&a=${CA}&b=${CB}&field=asnow6&valid=2026-11-23T06:00:00Z&data=${encodeURIComponent(host)}&map=47.40,-117.60,6.10`);
    const frames = () => p.frames().filter((f) => f.url().includes('embed=1'));
    for (let k = 0; k < 200; k++) { const fs2 = frames(); if (fs2.length === 2 && (await Promise.all(fs2.map((f) => f.evaluate(() => !!(window.MapsConus && window.MapsConus.api.ready() && window.MapsConus.api.labels().chosen.length)).catch(() => false)))).every(Boolean)) break; await p.waitForTimeout(500); }
    await p.waitForTimeout(4000);
    const res = []; for (const f of frames()) res.push(await f.evaluate(() => { const s = window.MapsConus.api.state(); return `${s.run} F${s.fh} ${window.MapsConus.api.labels().shown.map((o) => `${o.k}:${o.text}`).join(',')}`; }));
    const note = await p.$eval('#cmpNote', (e) => e.innerText); await p.screenshot({ path: path.join(out, `${tag}.png`) }); await ctx.close();
    return { res, note, errs };
  }
  try {
    for (const [dev, device] of [['desktop', DESK], ['phone', PHONE]]) {
      const a = await single(HA, device, `${dev}-A`), b = await single(HB, device, `${dev}-B`);
      const keys = Object.keys(a.hash), diff = keys.filter((k) => a.hash[k] !== b.hash[k]), errs = keys.filter((k) => /^ERR/.test(a.hash[k]) || /^ERR/.test(b.hash[k]));
      check(!diff.length && !errs.length, `${dev}: ${keys.length} display tiles identical on both hosts (${FIELDS.join(', ')} at F${HOURS.join('/F')}, L2/L1/L0; plus 6-h snowfall ending F12)${diff.length ? ' — differ: ' + diff.slice(0, 4).join('; ') : ''}`);
      check(a.labels === b.labels && a.labels.length > 0, `${dev}: the same ${a.labels.split(',').length} Values labels at the Cincinnati zoom`);
      check(a.readout === b.readout && /:/.test(a.readout), `${dev}: the same click readout ("${a.readout}")`);
      check(a.loop >= 3 && b.loop >= 3, `${dev}: the loop plays on both (${a.loop} and ${b.loop} hours seen)`);
      const nb = b.net, na = a.net;
      check(!nb.after.other.length && nb.after.s206 > 0, `${dev}: R2 answered ${nb.after.n} requests (${nb.after.s206} × 206 Partial Content, ${nb.after.s200} × 200 for index, manifests and label points), no errors`);
      console.log(`     ${dev} first view: A ${na.first.n} requests, ${(na.first.bytes / 1e6).toFixed(2)} MB; B ${nb.first.n} requests, ${(nb.first.bytes / 1e6).toFixed(2)} MB`);
      console.log(`     ${dev} after the loop prefetch: A ${na.after.n} requests, ${(na.after.bytes / 1e6).toFixed(2)} MB; B ${nb.after.n} requests, ${(nb.after.bytes / 1e6).toFixed(2)} MB`);
      check(!a.errs.length && !b.errs.length, `${dev}: no script errors ${[...a.errs, ...b.errs].join('; ')}`);
    }
    const ca = await compare(HA, 'compare-A'), cb = await compare(HB, 'compare-B');
    check(ca.res.length === 2 && JSON.stringify(ca.res) === JSON.stringify(cb.res) && ca.note === cb.note && /Like for like/.test(cb.note),
      `same-window snowfall compare (${CA} vs ${CB}, 6 h ending 06Z): both panels identical on both hosts — "${cb.note.slice(0, 70)}…"`);
    check(!ca.errs.length && !cb.errs.length, `compare: no script errors ${[...ca.errs, ...cb.errs].join('; ')}`);
  } catch (e) { check(false, 'crashed: ' + (e.stack || e.message)); }
  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : 'hosts match');
  process.exit(failed ? 1 : 0);
})();
