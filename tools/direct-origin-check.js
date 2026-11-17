#!/usr/bin/env node
/* The browser's own path from a deployed page to the weather providers, with no caching or interception: from a page on
   the site's real origin, fetch one Open-Meteo forecast, one Open-Meteo ensemble and one NWS point directly.
   A browser failure alone cannot say whether the provider refused this origin (CORS) or did not answer at all, so each
   failure is classified by asking the same URL from the runner with the same Origin header:
     - the runner gets an answer that allows this origin  → the browser path failed: FAIL
     - the runner gets no answer either                   → provider did not answer the runner: reported as unverified (warning)
   Every request that does not pass also prints its evidence: the page's own view (time, result, duration), the browser
   network layer's view (status and headers received if any, redirects, Chrome's error text, connection timing), the
   page's own Open-Meteo requests in flight at that moment, and the runner's separate request (time, status, headers).
   The runner's request is later and travels a different network stack, so its success never proves the browser's
   request could have succeeded, and never by itself establishes a CORS failure.
   Usage: node tools/direct-origin-check.js <site-base-url> [page]   e.g. https://wxman33.github.io/forecast-ops/ index.html */
'use strict';
const { chromium } = require('playwright');
const REQUESTS = [
  ['Open-Meteo forecast', 'https://api.open-meteo.com/v1/forecast?latitude=39.04&longitude=-84.67&hourly=temperature_2m&forecast_days=1&models=gfs_seamless'],
  ['Open-Meteo ensemble', 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=39.04&longitude=-84.67&hourly=temperature_2m&forecast_days=1&models=gfs025'],
  ['NWS point', 'https://api.weather.gov/points/39.0446,-84.6723'],
];
/* Network evidence for one request, from the browser's network layer (not the page's JavaScript, which sees only
   "Failed to fetch" for any network-level error): when it started, how long it took, the status and headers the
   network layer received if any, redirects, and Chrome's error text. */
const PICK = ['access-control-allow-origin', 'content-type', 'content-length', 'retry-after', 'date', 'server', 'location', 'cache-control', 'age', 'x-cache', 'cf-ray', 'cf-cache-status', 'via'];
const pick = (h) => Object.fromEntries(PICK.filter((k) => h && h[k] != null).map((k) => [k, String(h[k]).slice(0, 120)]));
function netWatch(page, wanted, ownPattern) {
  const entries = [], pend = [];
  const isOM = (u) => ownPattern.test(u);
  const find = (q) => entries.find((e) => e.q === q);
  const onReq = (q) => { const u = q.url(); if (!wanted.has(u) && !isOM(u)) return; const f = q.redirectedFrom();
    entries.push({ q, url: u, wanted: wanted.has(u), startedAt: new Date().toISOString(), t: Date.now(), method: q.method(), redirectedFrom: f ? f.url() : null }); };
  const onResp = (res) => { const e = find(res.request()); if (!e) return; e.status = res.status(); pend.push(res.allHeaders().then((h) => { e.headers = pick(h); }).catch(() => {})); };
  const onDone = (q, failed) => { const e = find(q); if (!e) return; e.ms = Date.now() - e.t; if (failed) e.failure = (q.failure() && q.failure().errorText) || 'failed'; try { const tm = q.timing(); e.timing = { dns: Math.round(tm.domainLookupEnd - tm.domainLookupStart), connect: Math.round(tm.connectEnd - tm.connectStart), tls: tm.secureConnectionStart >= 0 ? Math.round(tm.connectEnd - tm.secureConnectionStart) : null, firstByte: tm.responseStart >= 0 ? Math.round(tm.responseStart) : null }; } catch (x) { /* none */ } };
  const fin = (q) => onDone(q, false), fail = (q) => onDone(q, true);
  page.on('request', onReq); page.on('response', onResp); page.on('requestfinished', fin); page.on('requestfailed', fail);
  /* Chrome's DevTools protocol sees what the page events hide: the status and headers of a response that was then
     blocked (no 'response' event fires for it), and Chrome's own reason (CORS error, blocked reason). Chromium only. */
  const cdp = { byId: new Map() }; let session = null;
  const ready = (async () => { try { session = await page.context().newCDPSession(page); await session.send('Network.enable');
    session.on('Network.requestWillBeSent', (e) => { if (wanted.has(e.request.url) || isOM(e.request.url)) cdp.byId.set(e.requestId, { url: e.request.url }); });
    session.on('Network.responseReceivedExtraInfo', (e) => { const x = cdp.byId.get(e.requestId); if (x) { x.statusCode = e.statusCode; x.headers = pick(Object.fromEntries(Object.entries(e.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))); } });
    session.on('Network.responseReceived', (e) => { const x = cdp.byId.get(e.requestId); if (x && x.statusCode == null) x.statusCode = e.response.status; });
    session.on('Network.loadingFailed', (e) => { const x = cdp.byId.get(e.requestId); if (x) { x.errorText = e.errorText; x.corsError = e.corsErrorStatus ? e.corsErrorStatus.corsError : null; x.blockedReason = e.blockedReason || null; } });
  } catch (x) { cdp.unavailable = String((x && x.message) || x); } })();
  return { entries, cdp, ready, async stop() { await Promise.all(pend); page.off('request', onReq); page.off('response', onResp); page.off('requestfinished', fin); page.off('requestfailed', fail); if (session) await session.detach().catch(() => {}); } };
}
const netText = (e) => e ? `${e.startedAt} ${e.method}${e.redirectedFrom ? ` (redirected from ${e.redirectedFrom})` : ''} → ${e.status != null ? `HTTP ${e.status}` : 'no response'}${e.failure ? `, ${e.failure}` : ''}${e.ms != null ? ` after ${e.ms} ms` : ''}${e.timing ? ` (dns ${e.timing.dns} ms, connect ${e.timing.connect} ms, tls ${e.timing.tls} ms, first byte ${e.timing.firstByte} ms)` : ''}${e.headers && Object.keys(e.headers).length ? ` headers ${JSON.stringify(e.headers)}` : e.status != null ? ' (no headers read)' : ''}` : 'no request seen by the browser network layer';
/* run inside an existing page (shared with the beta check); returns {origin, results:[{name, status, ok, json, error, verdict, detail, diag}]} */
async function directCheck(page, { requests = REQUESTS, ownPattern = /^https:\/\/(api|ensemble-api)\.open-meteo\.com\// } = {}) { // options exist for the offline test only
  const origin = await page.evaluate(() => location.origin);
  const watch = netWatch(page, new Set(requests.map((r) => r[1])), ownPattern); await watch.ready;
  const browserSide = await page.evaluate(async (reqs) => Promise.all(reqs.map(([name, url]) => { const t = performance.now(), at = new Date().toISOString();
    return fetch(url, name.startsWith('NWS') ? { headers: { Accept: 'application/geo+json' } } : {})
      .then(async (x) => ({ name, url, at, status: x.status, ok: x.ok, redirected: x.redirected, finalUrl: x.url, json: await x.json().then((j) => !!j && typeof j === 'object').catch(() => false), jsMs: Math.round(performance.now() - t) }))
      .catch((e) => ({ name, url, at, status: 0, ok: false, error: String(e.message || e), jsMs: Math.round(performance.now() - t) })); })), requests);
  await watch.stop();
  for (const r of browserSide) {
    const mine = watch.entries.filter((e) => e.url === r.url || (e.redirectedFrom && e.redirectedFrom === r.url));
    const proto = [...watch.cdp.byId.values()].filter((x) => x.url === r.url);
    const protoText = proto.map((x) => `${x.statusCode != null ? `HTTP ${x.statusCode} received` : 'no response received'}${x.errorText ? `, ${x.errorText}` : ''}${x.corsError ? `, CORS error ${x.corsError}` : ''}${x.blockedReason ? `, blocked: ${x.blockedReason}` : ''}${x.headers && Object.keys(x.headers).length ? ` headers ${JSON.stringify(x.headers)}` : ''}`);
    r.diag = { browserProtocol: watch.cdp.unavailable ? [`unavailable (${watch.cdp.unavailable})`] : protoText.length ? protoText : ['no request seen'], browserJs: `${r.at} → ${r.status ? `HTTP ${r.status}${r.redirected ? `, redirected to ${r.finalUrl}` : ''}` : `error "${r.error}"`} after ${r.jsMs} ms`, browserNet: mine.length ? mine.map(netText) : [netText(null)] };
    if (r.ok && r.json) { r.verdict = 'pass'; continue; }
    /* the page's own Open-Meteo requests in flight around this one (the page starts its own guidance at load) */
    const t0 = Date.parse(r.at), t1 = t0 + r.jsMs, around = watch.entries.filter((e) => !e.wanted && e.t <= t1 && e.t + (e.ms || 0) >= t0);
    const st = {}; around.forEach((e) => { const k = e.status != null ? `HTTP ${e.status}` : e.failure || 'pending'; st[k] = (st[k] || 0) + 1; });
    r.diag.pageOwnOpenMeteo = around.length ? `${around.length} of the page's own Open-Meteo requests overlapped (${Object.entries(st).map(([k, n]) => `${k} ×${n}`).join(', ')})` : 'none of the page\'s own Open-Meteo requests overlapped';
    /* the same URL from the runner, presenting this origin: a separate request at a later time through a different
       network stack, so it shows what the provider answered then, not why the browser's request failed */
    let probe; const pAt = new Date().toISOString(), pT = Date.now();
    try {
      const res = await fetch(r.url, { headers: { Origin: origin, ...(r.name.startsWith('NWS') ? { Accept: 'application/geo+json', 'User-Agent': '(forecast-ops direct-origin check)' } : {}) }, signal: AbortSignal.timeout(20000) });
      probe = { status: res.status, allow: res.headers.get('access-control-allow-origin'), redirected: res.redirected, finalUrl: res.url, headers: pick(Object.fromEntries(res.headers)) };
      await res.arrayBuffer().catch(() => {});
    } catch (e) { probe = { error: String(e.message || e) }; }
    r.diag.runner = `${pAt} (${Math.round((pT - t0) / 1000)} s after the browser's request) → ${probe.error ? `error "${probe.error}"` : `HTTP ${probe.status}${probe.redirected ? `, redirected to ${probe.finalUrl}` : ''} after ${Date.now() - pT} ms headers ${JSON.stringify(probe.headers)}`}`;
    const pr = proto.find((x) => x.statusCode != null), prFail = proto.find((x) => x.errorText);
    const netNote = pr ? `; the browser received HTTP ${pr.statusCode} ${pr.headers && pr.headers['access-control-allow-origin'] ? `with allow-origin ${pr.headers['access-control-allow-origin']}` : 'without an Access-Control-Allow-Origin header'}${pr.corsError || (prFail && prFail.corsError) ? `, and Chrome blocked it (CORS error ${pr.corsError || prFail.corsError})` : ''}, so the page could not read it`
      : prFail ? `; the browser received no response (${prFail.errorText}${prFail.corsError ? `, CORS error ${prFail.corsError}` : ''})`
      : mine.find((e) => e.failure) ? `; the browser's network layer reported ${mine.find((e) => e.failure).failure} with no response` : '';
    if (probe.error) { r.verdict = 'unverified'; r.detail = `the provider did not answer the runner either (${probe.error})${netNote}`; }
    else if (r.status > 0 && !r.ok) { r.verdict = r.status === 429 || r.status >= 500 ? 'unverified' : 'fail'; r.detail = `HTTP ${r.status} to the browser; runner got HTTP ${probe.status}`; }
    else if (probe.status < 400 && (probe.allow === '*' || probe.allow === origin)) { r.verdict = 'fail'; r.detail = `the browser's request failed${netNote}; a later runner request got HTTP ${probe.status} with allow-origin ${probe.allow}, which does not show the browser's request could have succeeded (cause unresolved)`; }
    else if (probe.status < 400) { r.verdict = 'fail'; r.detail = `the provider answers but does not allow ${origin} (allow-origin ${probe.allow || 'missing'})${netNote}`; }
    else { r.verdict = 'unverified'; r.detail = `runner got HTTP ${probe.status}${netNote}`; }
  }
  return { origin, results: browserSide };
}
const diagLines = (r) => (r.diag && r.verdict !== 'pass' ? [`  browser (page JS): ${r.diag.browserJs}`, ...r.diag.browserNet.map((x) => `  browser (network): ${x}`), ...(r.diag.browserProtocol || []).map((x) => `  browser (DevTools protocol): ${x}`), r.diag.pageOwnOpenMeteo ? `  page's own requests: ${r.diag.pageOwnOpenMeteo}` : null, r.diag.runner ? `  runner: ${r.diag.runner}` : null].filter(Boolean) : []);
const line = (r) => `${r.name} ${r.status || 'no answer'}${r.error ? ` (${r.error})` : ''}${r.json ? ' JSON' : ''}${r.detail ? ` — ${r.detail}` : ''}`;
module.exports = { REQUESTS, directCheck, line, diagLines };
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
      diagLines(r).forEach((x) => console.log(x));
    }
    const v = results.filter((r) => r.verdict === 'unverified').length;
    console.log(code ? 'direct browser path failed' : v ? `direct browser path: ${results.length - v} verified, ${v} unverified because the provider did not answer the runner` : 'direct browser path verified for every provider');
  } finally { await browser.close(); }
  process.exit(code);
})();
