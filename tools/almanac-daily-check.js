#!/usr/bin/env node
/* Deterministic browser check of the Almanac's daily reporting flow. NWS climate reports, ACIS and the station are
   fixtures (report text adapted from a captured CVG product); the page, its refresh timer and its rendering are real.
   Morning with only yesterday's report, today's interim report arriving, a correction, a failed refresh and
   recovery, midnight rollover in an open tab, a location in another time zone, ACIS lag and a chosen historical date.
   Usage: node tools/almanac-daily-check.js [screenshot-dir] */
'use strict';
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), shots = process.argv[2] || null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const base = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/almanac/nws-cli-cvg-20261110.json'), 'utf8'));
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const MONTHS = 'JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER'.split(' ');
/* a CLI product for `date`: interim (valid as of 5 PM) or final (issued after midnight); high and its departure from 56 */
function product({ date, kind, issued, high, id, cor = false }) {
  const [y, m, d] = date.split('-').map(Number), label = `${MONTHS[m - 1]} ${d} ${y}`;
  let t = base.productText.replace('NOVEMBER 10 2026...', label + '...').replace(/MAXIMUM {9}72 {3}2:45 PM {2}80 {4}2020 {2}56 {5}16/, `MAXIMUM         ${high}   2:45 PM  80    2020  56     ${String(high - 56).padEnd(2)}`);
  if (kind === 'final') t = t.replace('VALID TODAY AS OF 0500 PM LOCAL TIME.\n', '').replace(/\n TODAY\s*\n/, '\n YESTERDAY\n').replace(/\n {2}TODAY /g, '\n  YESTERDAY ');
  if (cor) t = t.replace('CDUS41 KILN 102205', 'CDUS41 KILN 112230 CCA');
  return { ...base, id, '@id': 'https://api.weather.gov/products/' + id, issuanceTime: issued, productText: t };
}
const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); try { res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(fs.readFileSync(f)); } catch { res.writeHead(404).end(); } });

async function session(browser, { viewerTz = 'America/New_York', locTz = 'America/New_York', start, theme = 'light', phone = false, omDown = false }) {
  const ctx = await browser.newContext({ timezoneId: viewerTz, viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 1000 } });
  const st = { products: [], nwsDown: false, acisMissing: new Set(), calls: [] };
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url()), reply = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) });
    if (url.pathname.endsWith('/assets/climate-station.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: `window.ClimateStation={setOverride(){},forPoint:async()=>({pointOffice:'ILN',station:{faa:'CVG',name:'CVG airport',office:'ILN',ll:[-84.67,39.04],km:0,since:1900},alternatives:[],missing:[]})};` });
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'api.open-meteo.com') return omDown ? route.abort('failed') : reply({ timezone: locTz });
    if (url.hostname === 'api.weather.gov' && url.pathname.startsWith('/points/')) return reply({ properties: { gridId: 'ILN', timeZone: locTz } });
    if (url.hostname === 'api.weather.gov' && url.pathname.startsWith('/products/')) {
      st.calls.push(url.pathname);
      if (st.nwsDown) return reply({ title: 'Service Unavailable' }, 503);
      if (url.pathname.includes('/locations/')) return reply({ '@graph': st.products.map((p) => ({ id: p.id, issuingOffice: 'KILN', issuanceTime: p.issuanceTime })) });
      const p = st.products.find((x) => url.pathname.endsWith('/' + x.id)); return p ? reply(p) : reply({ title: 'Not Found' }, 404);
    }
    if (url.hostname === 'data.rcc-acis.org') {
      const q = route.request().postDataJSON();
      if (q.elems.some((e) => e.duration)) return reply({ data: [] });
      if (typeof q.elems[0] === 'object' && !q.elems[0].normal) return reply({ data: [['2025-11-10', '75', '20', '0.5', '0']] });
      const normal = !!q.elems[0].normal, data = [];
      for (let d = new Date(q.sdate + 'T12:00Z'); d <= new Date(q.edate + 'T12:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10);
        data.push([day, ...(normal ? ['56', '37', '0.10', '0.0'] : st.acisMissing.has(day) ? ['M', 'M', 'M', 'M', 'M'] : ['60', '40', '0.00', '0.0', '0'])]);
      }
      return reply({ data });
    }
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture: unavailable"}' });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.clock.install({ time: new Date(start) });
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); }, theme);
  return { ctx, p, st, errors };
}
const txt = (p, sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e) return ''; const c = e.cloneNode(true); c.querySelectorAll('dt,dd,small,h2 span').forEach((x) => x.prepend(' ')); return c.textContent.replace(/\s+/g, ' ').trim(); }, sel);
const until = (p, f, arg) => p.waitForFunction(f, arg, { timeout: 15000 }).then(() => true).catch(() => false);
/* move the page clock to `iso` and let the one-minute timer fire (a 5-minute check becomes due) */
/* (the jump makes a check due; the one-minute timer starts it; real time then lets the simulated responses arrive
   before fake time moves on, so the page's own 15 s request timeout is not tripped by the test clock) */
async function step(p, ms) { for (let t = 0; t < ms; t += 1000) { await p.clock.runFor(1000); await p.waitForTimeout(25); } await p.waitForTimeout(1500); }
async function advance(p, iso) { await p.clock.setSystemTime(new Date(iso)); await step(p, 61e3); }

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${server.address().port}/almanac.html?lat=39.04456&lon=-84.67229&name=CVG`;
  const browser = await chromium.launch();
  try {
    /* ---- morning: yesterday completed by NWS, ACIS still missing yesterday, nothing for today ---- */
    const s = await session(browser, { start: '2026-11-11T12:30:00Z', viewerTz: 'Asia/Tokyo' });
    const { p, st } = s;
    st.products = [product({ date: '2026-11-10', kind: 'interim', issued: '2026-11-10T22:05:00+00:00', high: 72, id: 'p1' }), product({ date: '2026-11-10', kind: 'final', issued: '2026-11-11T06:31:00+00:00', high: 73, id: 'p2' })];
    st.acisMissing = new Set(['2026-11-10', '2026-11-11']);
    await p.goto(site);
    check(await until(p, () => document.querySelector('#dailyCard [data-daily="yesterday"] [data-item="maxt"] dd')), 'morning: the daily reports section appears for today');
    check(/Wednesday, November 11, 2026/.test(await txt(p, '#sheetTitle')), 'morning: the sheet is the location\'s today (viewer in Tokyo)');
    check(!new URL(p.url()).searchParams.has('date'), 'morning: an unchosen "today" is not written into the address');
    let y = await txt(p, '#dailyCard [data-daily="yesterday"]');
    check(/Yesterday's weather Tue, Nov 10, 2026/.test(y) && /High 73°F \+17° vs normal 56°/.test(y) && /Low 39°F/.test(y) && /Precipitation 0\.00″/.test(y) && /Snowfall 0\.0″/.test(y), 'morning: yesterday\'s high, low, precipitation and snowfall with departures (' + y.slice(0, 160) + ')');
    check(/No daily high, low, precipitation or snowfall record tied or broken/.test(y), 'morning: yesterday explicitly reports the four listed record comparisons');
    check(/Completed day/.test(y) && /issued Nov 11, 1:31 AM EST/.test(y), 'morning: yesterday is a completed NWS report with its issue time, not today\'s');
    check(/No NWS climate report for today yet/.test(await txt(p, '#dailyCard [data-daily="today"]')), 'morning: no report for today is stated as not issued yet');
    check(await p.evaluate(() => document.querySelector('.climo-context')?.dataset.cutoff) === '2026-11-10', 'morning: totals run through yesterday from the NWS report without waiting for ACIS');
    check(/Wednesday/.test(await txt(p, '#sheetTitle')) && /Climate report · Nov 11, 2026/.test(await txt(p, '#climCard h2')), 'morning: today\'s normals and records stay on today\'s sheet');
    if (shots) { await p.evaluate(() => document.getElementById('dailyCard').scrollIntoView()); await p.screenshot({ path: path.join(shots, 'almanac-morning-desktop-light.png') }); }

    /* ---- today's interim report arrives in the afternoon ---- */
    st.products.push(product({ date: '2026-11-11', kind: 'interim', issued: '2026-11-11T22:05:00+00:00', high: 66, id: 'p3' }));
    await advance(p, '2026-11-11T22:10:00Z');
    let t = await txt(p, '#dailyCard [data-daily="today"]');
    check(/Interim · as of 5:00 PM/.test(t) && /High 66°F/.test(t) && /the day was not over/.test(t), 'evening: today\'s interim report is shown and labelled as interim (' + t.slice(0, 120) + ')');
    check(/High 73°F/.test(await txt(p, '#dailyCard [data-daily="yesterday"]')), 'evening: yesterday\'s summary stays available after today\'s report arrives');
    check(await p.evaluate(() => document.querySelector('.climo-context')?.dataset.cutoff) === '2026-11-10', 'evening: an interim report never extends complete-day totals');
    check(/^66$/.test(await txt(p, '[data-climo-row="maxt"] .climo-observed')), 'evening: today\'s sheet shows the interim high as preliminary');
    if (shots) { await p.evaluate(() => document.getElementById('dailyCard').scrollIntoView()); await p.screenshot({ path: path.join(shots, 'almanac-evening-desktop-light.png') }); }

    /* ---- a corrected report for yesterday ---- */
    st.products.push(product({ date: '2026-11-10', kind: 'final', issued: '2026-11-11T22:30:00+00:00', high: 74, id: 'p4', cor: true }));
    await advance(p, '2026-11-11T22:36:00Z');
    y = await txt(p, '#dailyCard [data-daily="yesterday"]');
    check(/High 74°F/.test(y) && /corrected report/.test(y), 'correction: the corrected report replaces the original');

    /* ---- failed refresh keeps the last valid reports; recovery clears the failure ---- */
    st.nwsDown = true; const before = st.calls.length;
    await advance(p, '2026-11-11T22:42:00Z');
    const line = await txt(p, '#dailyCard [data-check]');
    check(st.calls.length > before && /Couldn't refresh NWS climate reports/.test(line) && /Showing the reports retrieved at/.test(line), 'failed refresh: the failure and the age of what is shown are stated (' + line.slice(0, 140) + ')');
    check(/High 74°F/.test(await txt(p, '#dailyCard [data-daily="yesterday"]')) && /High 66°F/.test(await txt(p, '#dailyCard [data-daily="today"]')), 'failed refresh: the last valid reports remain');
    check(!/Not reported yet|No NWS climate report for today yet/.test(await txt(p, '#dailyCard')), 'failed refresh: "couldn\'t refresh" never becomes "not reported yet"');
    st.nwsDown = false;
    await advance(p, '2026-11-11T22:48:00Z');
    check(/checked at/.test(await txt(p, '#dailyCard [data-check]')) && (await p.evaluate(() => document.querySelector('#dailyCard [data-check]').dataset.check)) === 'ok', 'recovery: the refresh failure is cleared');
    const n0 = st.calls.filter((c) => c.includes('/locations/')).length;
    await step(p, 3 * 60e3);
    check(st.calls.filter((c) => c.includes('/locations/')).length === n0, 'cadence: no extra checks inside the 5-minute interval');

    /* ---- midnight rollover in an open tab ---- */
    await p.clock.setSystemTime(new Date('2026-11-12T05:02:00Z')); await step(p, 61e3);
    check(await until(p, () => /Thursday, November 12, 2026/.test(document.getElementById('sheetTitle').textContent)), 'rollover: an open tab moves to the new day at the location\'s midnight');
    await until(p, () => /Nov 11, 2026/.test(document.querySelector('#dailyCard [data-daily="yesterday"] h2')?.textContent || ''));
    y = await txt(p, '#dailyCard [data-daily="yesterday"]');
    check(/Wed, Nov 11, 2026/.test(y) && /Interim/.test(y) && !/Completed day/.test(y), 'rollover: before the completed report, yesterday is the interim report and says so (' + y.slice(0, 140) + ')');
    st.products.push(product({ date: '2026-11-11', kind: 'final', issued: '2026-11-12T06:20:00+00:00', high: 67, id: 'p5' }));
    await advance(p, '2026-11-12T06:25:00Z');
    y = await txt(p, '#dailyCard [data-daily="yesterday"]');
    check(/High 67°F/.test(y) && /Completed day/.test(y), 'rollover: the completed report replaces the interim one (' + y.slice(0, 200) + ' | ' + (await txt(p, '#dailyCard [data-check]')) + ' | calls ' + st.calls.slice(-4).join(',') + ')');
    if (shots) { await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => document.getElementById('dailyCard').scrollIntoView()); await p.screenshot({ path: path.join(shots, 'almanac-morning-phone-light.png') }); await p.setViewportSize({ width: 1280, height: 1000 }); }
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'layout: no horizontal overflow');

    /* ---- a chosen historical date stays put ---- */
    await p.locator('#prevDay').click();
    check(await until(p, () => /Wednesday, November 11, 2026/.test(document.getElementById('sheetTitle').textContent)), 'history: previous day opens');
    check(new URL(p.url()).searchParams.get('date') === '2026-11-11', 'history: a chosen date is kept in the address');
    check(await p.evaluate(() => document.getElementById('dailyCard').hidden), 'history: the morning section belongs to today only');
    await p.clock.setSystemTime(new Date('2026-11-13T06:00:00Z')); await step(p, 6 * 60e3);
    check(/Wednesday, November 11, 2026/.test(await txt(p, '#sheetTitle')), 'history: a chosen date never jumps to today, even after midnight');
    await p.locator('#todayBtn').click();
    check(await until(p, () => /Friday, November 13, 2026/.test(document.getElementById('sheetTitle').textContent)) && !new URL(p.url()).searchParams.has('date'), 'history: TODAY returns to following the location\'s day');
    check(s.errors.length === 0, 'no script errors ' + s.errors.join('; '));
    await s.ctx.close();

    /* ---- ACIS has yesterday, NWS has nothing; dark theme on a phone ---- */
    const a = await session(browser, { start: '2026-11-11T13:00:00Z', theme: 'dark', phone: true });
    await a.p.goto(site);
    await until(a.p, () => document.querySelector('#dailyCard [data-daily="yesterday"]'));
    y = await txt(a.p, '#dailyCard [data-daily="yesterday"]');
    check(/RCC-ACIS/.test(y) && /High 60°F/.test(y) && /\+4° vs normal 56°/.test(y), 'ACIS fallback: yesterday from ACIS with departures when NWS has no report (' + y.slice(0, 120) + ')');
    check(await a.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone dark: no horizontal overflow');
    if (shots) { await a.p.evaluate(() => document.getElementById('dailyCard').scrollIntoView()); await a.p.screenshot({ path: path.join(shots, 'almanac-morning-phone-dark.png') }); }
    await a.ctx.close();

    /* ---- a location in another time zone: its own today and yesterday ---- */
    const w = await session(browser, { start: '2026-11-11T07:30:00Z', locTz: 'America/Los_Angeles', viewerTz: 'Europe/London' });
    w.st.products = [product({ date: '2026-11-10', kind: 'interim', issued: '2026-11-10T22:05:00+00:00', high: 72, id: 'w1' })];
    await w.p.goto(site);
    await until(w.p, () => document.querySelector('#dailyCard [data-daily="today"] h2'));
    check(/Tuesday, November 10, 2026/.test(await txt(w.p, '#sheetTitle')), 'time zones: 11:30 PM in Los Angeles is still Nov 10 there (07:30 UTC Nov 11)');
    check(/Nov 10, 2026/.test(await txt(w.p, '#dailyCard [data-daily="today"] h2')) && /Interim/.test(await txt(w.p, '#dailyCard [data-daily="today"]')), 'time zones: the Nov 10 interim report is "today" at that location');
    check(/Mon, Nov 9, 2026/.test(await txt(w.p, '#dailyCard [data-daily="yesterday"] h2')), 'time zones: yesterday is Nov 9 at that location');
    await w.ctx.close();

    /* ---- the zone lookup fails: the NWS point's own zone is used, never a longitude guess (GMT-6 for Cincinnati) ---- */
    const z = await session(browser, { start: '2026-11-12T05:30:00Z', viewerTz: 'Asia/Tokyo', omDown: true });
    await z.p.goto(site);
    await until(z.p, () => document.querySelector('#dailyCard [data-daily="today"] h2'));
    check(/Thursday, November 12, 2026/.test(await txt(z.p, '#sheetTitle')), 'time zones: with the zone lookup down, 12:30 AM EST is Nov 12 (not Nov 11 from a longitude guess) — ' + (await txt(z.p, '#sheetTitle')));
    await z.ctx.close();
  } catch (e) { failed++; console.log('FAIL threw: ' + String(e.message || e).split('\n')[0]); }
  finally { await browser.close(); server.close(); }
  console.log(failed ? `${failed} almanac daily checks failed` : 'all almanac daily checks passed');
  process.exitCode = failed ? 1 : 0;
})();
