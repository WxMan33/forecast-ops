#!/usr/bin/env node
/* The browser's own path from a deployed page to the weather providers, with no caching or interception: from a page on
   the site's real origin, fetch one Open-Meteo forecast, one Open-Meteo ensemble and one NWS point directly.
   A browser failure alone cannot say whether the provider refused this origin (CORS) or did not answer at all, so each
   failure is classified by asking the same URL from the runner with the same Origin header:
     - the runner gets an answer that allows this origin  → the browser path failed: FAIL
     - the runner gets no answer either                   → provider did not answer the runner: reported as unverified (warning)
   Usage: node tools/direct-origin-check.js <site-base-url> [page]   e.g. https://wxman33.github.io/forecast-ops/ index.html */
'use strict';
const { chromium } = require('playwright');
const REQUESTS = [
  ['Open-Meteo forecast', 'https://api.open-meteo.com/v1/forecast?latitude=39.04&longitude=-84.67&hourly=temperature_2m&forecast_days=1&models=gfs_seamless'],
  ['Open-Meteo ensemble', 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=39.04&longitude=-84.67&hourly=temperature_2m&forecast_days=1&models=gfs025'],
  ['NWS point', 'https://api.weather.gov/points/39.0446,-84.6723'],
];
/* run inside an existing page (shared with the beta check); returns {origin, results:[{name, status, ok, json, error, verdict, detail}]} */
async function directCheck(page) {
  const origin = await page.evaluate(() => location.origin);
  const browserSide = await page.evaluate(async (reqs) => Promise.all(reqs.map(([name, url]) => fetch(url, name.startsWith('NWS') ? { headers: { Accept: 'application/geo+json' } } : {})
    .then(async (x) => ({ name, url, status: x.status, ok: x.ok, json: await x.json().then((j) => !!j && typeof j === 'object').catch(() => false) }))
    .catch((e) => ({ name, url, status: 0, ok: false, error: String(e.message || e) })))), REQUESTS);
  for (const r of browserSide) {
    if (r.ok && r.json) { r.verdict = 'pass'; continue; }
    /* classify: the same request from the runner, presenting this origin */
    let probe; try {
      const res = await fetch(r.url, { headers: { Origin: origin, ...(r.name.startsWith('NWS') ? { Accept: 'application/geo+json', 'User-Agent': '(forecast-ops direct-origin check)' } : {}) }, signal: AbortSignal.timeout(20000) });
      probe = { status: res.status, allow: res.headers.get('access-control-allow-origin') };
    } catch (e) { probe = { error: String(e.message || e) }; }
    if (probe.error) { r.verdict = 'unverified'; r.detail = `the provider did not answer the runner either (${probe.error})`; }
    else if (r.status > 0 && !r.ok) { r.verdict = r.status === 429 || r.status >= 500 ? 'unverified' : 'fail'; r.detail = `HTTP ${r.status} to the browser; runner got HTTP ${probe.status}`; }
    else if (probe.status < 400 && (probe.allow === '*' || probe.allow === origin)) { r.verdict = 'fail'; r.detail = `the browser could not read an answer the provider gives this origin (runner: HTTP ${probe.status}, allow-origin ${probe.allow})`; }
    else if (probe.status < 400) { r.verdict = 'fail'; r.detail = `the provider answers but does not allow ${origin} (allow-origin ${probe.allow || 'missing'})`; }
    else { r.verdict = 'unverified'; r.detail = `runner got HTTP ${probe.status}`; }
  }
  return { origin, results: browserSide };
}
const line = (r) => `${r.name} ${r.status || 'no answer'}${r.error ? ` (${r.error})` : ''}${r.json ? ' JSON' : ''}${r.detail ? ` — ${r.detail}` : ''}`;
module.exports = { directCheck, line };
if (require.main === module) (async () => {
  const base = (process.argv[2] || '').replace(/\/?$/, '/'), page = process.argv[3] || 'index.html';
  if (!/^https?:\/\//.test(base)) { console.log('usage: node tools/direct-origin-check.js <site-base-url> [page]'); process.exit(2); }
  const browser = await chromium.launch(); let code = 0;
  try {
    const ctx = await browser.newContext(), p = await ctx.newPage();
    await ctx.route(/script\.google\.com\/macros/, (r) => r.abort()); // never reach the usage collector
    const res = await p.goto(base + page, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!res || !res.ok()) { console.log(`FAIL the page ${base + page} did not load (HTTP ${res ? res.status() : 'none'})`); process.exit(1); }
    const { origin, results } = await directCheck(p);
    for (const r of results) {
      if (r.verdict === 'pass') console.log(`PASS ${origin}: ${line(r)}`);
      else if (r.verdict === 'unverified') console.log(`::warning::Unverified from ${origin}: ${line(r)}`);
      else { console.log(`FAIL ${origin}: ${line(r)}`); code = 1; }
    }
    const v = results.filter((r) => r.verdict === 'unverified').length;
    console.log(code ? 'direct browser path failed' : v ? `direct browser path: ${results.length - v} verified, ${v} unverified because the provider did not answer the runner` : 'direct browser path verified for every provider');
  } finally { await browser.close(); }
  process.exit(code);
})();
