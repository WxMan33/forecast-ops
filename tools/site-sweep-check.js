#!/usr/bin/env node
/* Whole-site layout sweep against a simulated network: every page on a phone and a desktop, light and dark.
   Reports horizontal page overflow (and the elements causing it), clipped controls, hourly headers that wrap, and
   layout shift after the page has settled. Weather data are synthetic (tests/fixtures/source-sim.js plus ACIS/CLI
   stubs); no request reaches a provider. Usage: node tools/site-sweep-check.js [screenshot-dir] [page-filter] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const sim = require('../tests/fixtures/source-sim.js');
const root = path.resolve(__dirname, '..'), shots = process.argv[2] || null, only = process.argv[3] || null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const NOW = Date.parse('2026-11-11T13:30:00Z'); // 8:30 AM EST: the start of a working day
const CLI = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/almanac/nws-cli-cvg-20261110.json'), 'utf8'));
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const f = path.resolve(root, rel || 'index.html'); if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : f.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });
const CORS = { 'Access-Control-Allow-Origin': '*' };
const PAGES = ['index.html', 'blend.html', 'thunder.html', 'severe.html', 'winter.html', 'almanac.html', 'maps.html', 'meteorologist-beta.html', 'event-beta.html', 'event-beta.html#upcoming'];
let failed = 0; const results = [];
const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };

async function route(ctx, base) {
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url()), json = (b, status = 200) => r.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.origin === base) return r.continue();
    if (u.hostname === 'data.rcc-acis.org') {
      const q = r.request().postDataJSON() || {};
      /* several candidate stations with real-length names, so the station picker appears as it does live */
      if (u.pathname.endsWith('/StnMeta')) return json({ meta: [['CINCINNATI/NORTHERN KENTUCKY INTERNATIONAL AIRPORT', '93814', 'CVG', -84.67, 39.04], ['CINCINNATI MUNICIPAL AIRPORT LUNKEN FIELD', '93812', 'LUK', -84.42, 39.10], ['DAYTON JAMES M COX DAYTON INTERNATIONAL AIRPORT', '93815', 'DAY', -84.22, 39.91], ['COLUMBUS JOHN GLENN COLUMBUS INTERNATIONAL AIRPORT', '14821', 'CMH', -82.88, 39.99]].map(([name, wban, faa, lon, lat]) => ({ name, sids: [wban + ' 1', faa + ' 3'], ll: [lon, lat], valid_daterange: [['1947-01-01', '2026-11-10']] })) });
      if ((q.elems || []).some((e) => e && e.duration)) return json({ data: [] });
      if ((q.elems || []).some((e) => e && e.interval)) return json({ data: [['2025-11-11', '75', '20', '0.50', '1.0']] });
      const normal = (q.elems || []).some((e) => e && e.normal), data = [];
      for (let d = new Date((q.sdate || '2026-11-01') + 'T12:00Z'); d <= new Date((q.edate || '2026-11-10') + 'T12:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10); data.push([day, ...(normal ? ['56', '37', '0.10', '0.0'] : day >= '2026-11-11' ? ['M', 'M', 'M', 'M', 'M'] : ['60', '40', '0.00', '0.0', '0'])]);
      }
      return json({ data, meta: { valid_daterange: [['1947-01-01', '2026-11-10']] } });
    }
    if (u.hostname === 'api.weather.gov' && u.pathname.startsWith('/products')) {
      if (u.pathname.includes('/locations/') || u.searchParams.get('type') === 'CLI') return json({ '@graph': [{ id: CLI.id, issuingOffice: 'KILN', issuanceTime: CLI.issuanceTime }] });
      return json(CLI);
    }
    if (u.hostname === 'geocoding-api.open-meteo.com') return json({ results: [] });
    if (/^(api|ensemble-api)\.open-meteo\.com$|^api\.weather\.gov$/.test(u.hostname)) {
      const a = await sim.answer(u.href, {}, NOW, []).catch(() => null);
      if (!a || a.hang) return r.fulfill({ status: 503, headers: CORS, body: '' });
      return r.fulfill({ status: a.status, headers: { ...CORS, ...(a.headers || {}) }, contentType: 'application/json', body: a.body });
    }
    return r.fulfill({ status: 503, headers: CORS, body: '' });
  });
}

/* W = the device width: a mobile browser zooms out to fit wide content, so innerWidth itself can grow to match it */
async function measure(p, W) {
  return p.evaluate((W) => {
    const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const clipped = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox !== 'visible') return true; } return false; };
    const name = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`;
    const over = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > W + 1 && !clipped(e) && getComputedStyle(e).position !== 'fixed');
    const top = over.filter((e) => !over.includes(e.parentElement)).slice(0, 5).map((e) => `${name(e)}→${Math.round(e.getBoundingClientRect().right)}`);
    const controls = [...document.querySelectorAll('button, a.btn, a.bx-btn, [role=tab], select, label.chip')].filter(vis);
    const cut = controls.filter((e) => e.tagName !== 'SELECT' && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible').slice(0, 5).map((e) => `${name(e)} "${e.textContent.trim().slice(0, 24)}"`);
    const cutBy = (e) => { const b = e.getBoundingClientRect(); for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === 'hidden' || ox === 'clip') { const r = a.getBoundingClientRect(); return b.right > r.right + 1 || b.left < r.left - 1; } if (ox === 'auto' || ox === 'scroll') return false; } return false; };
    const offscreen = controls.filter((e) => { const b = e.getBoundingClientRect(); return ((b.left < -1 || b.right > W + 1) && !clipped(e)) || cutBy(e); }).slice(0, 5).map(name);
    const heads = [...document.querySelectorAll('.hg-hours .hg-hb')].filter(vis);
    const tall = heads.filter((b) => b.getBoundingClientRect().height > parseFloat(getComputedStyle(b).lineHeight || '16') * 1.7 + 8).length;
    return { overflow: Math.max(document.documentElement.scrollWidth, ...over.map((e) => Math.round(e.getBoundingClientRect().right))) - W, top, cut, offscreen, heads: heads.length, wrappedHeads: tall, cls: +(window.__cls || 0).toFixed(3), lateShift: +(window.__late || 0).toFixed(3) };
  }, W);
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const page of PAGES.filter((x) => !only || x.includes(only))) for (const phone of [true, false]) for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, timezoneId: 'America/New_York', isMobile: phone, hasTouch: phone });
      await route(ctx, base);
      const p = await ctx.newPage(), errors = [];
      p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
      await p.clock.install({ time: new Date(NOW) });
      await p.addInitScript((t) => {
        localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('fo_analytics_optout', '1');
        window.__cls = 0; window.__late = 0; window.__settled = false;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; if (window.__settled) window.__late += e.value; } }).observe({ type: 'layout-shift', buffered: true });
      }, theme);
      const label = `${page} ${phone ? 'phone' : 'desktop'} ${theme}`;
      await p.goto(`${base}/${page.replace('#', '?lat=39.1005&lon=-84.5017&name=Sawyer%20Point#')}${page.includes('?') || page.includes('#') ? '' : '?lat=39.1005&lon=-84.5017&name=Sawyer%20Point'}`);
      await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(1500);
      await p.evaluate(() => { window.__settled = true; });
      await p.waitForTimeout(1500); // anything moving now moved after the page looked finished
      const m = await measure(p, phone ? 390 : 1280); m.errors = errors; results.push({ label, ...m });
      if (!results.selfTested) { // the sweep must be able to see what it reports on: a wide element and a cut button
        results.selfTested = true;
        await p.evaluate(() => { const d = document.createElement('div'); d.id = 'sweepProbe'; d.style.cssText = 'width:' + (innerWidth + 300) + 'px;height:4px'; d.innerHTML = '<div style="width:60px;overflow:hidden"><button style="width:200px;white-space:nowrap">Wide probe button</button></div>'; document.body.append(d); });
        const probe = await measure(p, phone ? 390 : 1280); await p.evaluate(() => document.getElementById('sweepProbe').remove());
        check(probe.overflow > 1 && probe.offscreen.length > 0, `self-test: the sweep detects page overflow and a clipped control (+${probe.overflow}px, ${probe.offscreen.join(', ')})`);
      }
      /* the Next 48 hours status changes after load (records and NWS alerts are checked late); every wording it can take must
         keep the section the same height, or the hourly table below jumps (CI caught a 26 px shift on slow runners) */
      if (await p.locator('#next48HeadsUp .heads-up-status').count()) {
        const hs = await p.evaluate(() => { const st = document.querySelector('#next48HeadsUp .heads-up-status'), sec = document.getElementById('next48HeadsUp'), was = st.textContent, out = [];
          const base = 'No additional flags in available guidance.';
          for (const t of [base, base + ' Checking records…', base + ' Checking records… Checking NWS alerts…', base + ' Record checks incomplete.', base + ' Record checks incomplete. NWS alert check unavailable.', 'Model guidance unavailable. Record checks incomplete.']) { st.textContent = t; out.push([t, Math.round(sec.getBoundingClientRect().height)]); }
          st.textContent = was; return out; });
        const hset = new Set(hs.map((x) => x[1]));
        check(hset.size === 1, `${label}: the Next 48 hours status keeps the same height whatever it says${hset.size === 1 ? '' : ` (${JSON.stringify(hs)})`}`);
      }
      /* paging the hourly table and the variable charts: the page around them must not jump */
      for (const [open, next, what] of [['#hourlyTable, #hgWrap, details:has(#hgGrid)', '[data-hg-next]', 'hourly table'], [null, '#evCharts [data-move="1"]', 'variable charts']]) {
        if (open) await p.evaluate((q) => document.querySelectorAll(q).forEach((d) => { if (d.tagName === 'DETAILS') d.open = true; }), open);
        const btn = p.locator(next).first();
        if (!(await btn.count()) || !(await btn.isVisible().catch(() => false)) || !(await btn.isEnabled().catch(() => false))) continue;
        const pos = () => p.evaluate(([q, W]) => { const b = document.querySelector(q), host = b.closest('section, .card, details, .bx-sec') || b.parentElement; let after = host.nextElementSibling; while (after && !after.getBoundingClientRect().height) after = after.nextElementSibling; return { nav: Math.round(b.getBoundingClientRect().top + scrollY), after: after ? Math.round(after.getBoundingClientRect().top + scrollY) : null, sw: document.documentElement.scrollWidth - W, wide: [...host.querySelectorAll('table')].some((t) => t.getBoundingClientRect().width > t.parentElement.getBoundingClientRect().width + 1) }; }, [next, phone ? 390 : 1280]);
        /* when the page around the pager moves, say what moved: every element above the pager whose height changed */
        const heights = () => p.evaluate((q) => { const b = document.querySelector(q), y = b.getBoundingClientRect().top, out = {}; let i = 0;
          for (const e of document.querySelectorAll('body *')) { i++; const r = e.getBoundingClientRect(); if (!r.height || r.bottom > y + 1 || !(e.id || (typeof e.className === 'string' && e.className))) continue;
            out[e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + '@' + i] = [Math.round(r.height), (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70)]; }
          return out; }, next);
        const h0 = await heights();
        const a = await pos(); const moves = [];
        for (let i = 0; i < 3 && (await btn.isEnabled().catch(() => false)); i++) { await btn.click(); await p.waitForTimeout(150); const b = await pos(); moves.push(b); }
        const jump = moves.some((b) => Math.abs(b.nav - a.nav) > 2 || (a.after != null && Math.abs(b.after - a.after) > 2)), wide = [a, ...moves].some((b) => b.sw > 1 || b.wide);
        let grew = '';
        if (jump) { const h1 = await heights(); grew = ' grew: ' + JSON.stringify(Object.keys(h1).filter((k) => !h0[k] || h0[k][0] !== h1[k][0]).map((k) => [k, h0[k] || null, h1[k]])).slice(0, 2500); }
        check(!jump && !wide, `${label}: paging the ${what} keeps the layout still and inside the page${jump || wide ? ` (${JSON.stringify([a, ...moves])})${grew}` : ''}`);
      }
      check(m.overflow <= 1, `${label}: no horizontal page overflow${m.overflow > 1 ? ` (+${m.overflow}px: ${m.top.join(', ')})` : ''}`);
      check(!m.cut.length && !m.offscreen.length, `${label}: controls are not clipped or off screen${m.cut.length || m.offscreen.length ? ` (${[...m.cut, ...m.offscreen].join('; ')})` : ''}`);
      if (m.heads) check(!m.wrappedHeads, `${label}: hourly headers stay on one line (${m.wrappedHeads} of ${m.heads} wrap)`);
      check(m.lateShift < 0.05, `${label}: no layout jump after the page settles (late shift ${m.lateShift}, total ${m.cls})`);
      check(!errors.length, `${label}: no script errors ${errors.join('; ')}`);
      if (shots) await p.screenshot({ path: path.join(shots, `${page.replace(/[#.]/g, '_')}-${phone ? 'phone' : 'desktop'}-${theme}.png`) });
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} site sweep checks failed` : 'all site sweep checks passed');
  process.exitCode = failed ? 1 : 0;
})();
