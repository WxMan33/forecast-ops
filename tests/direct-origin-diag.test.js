/* The direct-origin check's evidence and verdicts, offline: a local page on one origin and a simulated provider on
   another, where the test sets every response header (Playwright's own fulfil adds CORS headers, so it cannot simulate
   a provider reply without them). Verdicts must be unchanged by the diagnostics; the evidence must separate what the
   page saw, what the browser's network layer received, and the runner's later request. */
'use strict';
const http = require('node:http'), { chromium } = require('playwright');
const DC = require('../tools/direct-origin-check.js');
let n = 0, fails = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL ' + m); } };
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
(async () => {
  const pageSrv = await listen((q, r) => r.end('<!doctype html><title>t</title>'));
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const prov = await listen((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/ok') { r.writeHead(200, CORS); r.end('{"ok":1}'); }
    else if (u.pathname === '/429-no-cors') { setTimeout(() => { r.writeHead(429, { 'Retry-After': '60', 'Content-Type': 'application/json' }); r.end('{"error":true}'); }, +(u.searchParams.get('delay') || 0)); }
    else if (u.pathname === '/reset') q.socket.destroy();
    else if (u.pathname === '/own') setTimeout(() => { r.writeHead(429, { 'Content-Type': 'application/json' }); r.end('{}'); }, 600);
    else if (u.pathname === '/500') { r.writeHead(500, CORS); r.end('{}'); }
    else if (u.pathname === '/404') { r.writeHead(404, CORS); r.end('{}'); }
    else { r.writeHead(404); r.end(); }
  });
  const P = `http://127.0.0.1:${prov.address().port}`, own = new RegExp('^' + P.replace(/[.]/g, '\\.') + '/own');
  const reqs = (first) => [['Open-Meteo forecast', P + first], ['Open-Meteo ensemble', P + '/ok?e=1'], ['NWS point', P + '/ok?n=1']];
  const browser = await chromium.launch(), realFetch = global.fetch;
  const runner200 = async () => new Response('{}', { status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' } });
  const scenario = async (first, runner, before) => {
    const ctx = await browser.newContext(), p = await ctx.newPage(); await p.goto(`http://127.0.0.1:${pageSrv.address().port}/`);
    if (before) await before(p);
    global.fetch = runner; try { return await DC.directCheck(p, { requests: reqs(first), ownPattern: own }); } finally { global.fetch = realFetch; await ctx.close(); }
  };
  try {
    ok(DC.REQUESTS.length === 3 && DC.REQUESTS[0][1].startsWith('https://api.open-meteo.com/v1/forecast?'), 'the live check still asks the same three provider URLs by default');
    /* 1. every provider answers: pass, and the runner is not asked */
    let calls = 0, r = await scenario('/ok?f=1', async () => { calls++; return runner200(); });
    ok(r.results.every((x) => x.verdict === 'pass') && calls === 0, 'all answers readable: pass, and the runner is not asked');
    /* 2. a 429 without CORS headers: the page sees only "Failed to fetch"; the network layer saw the 429 */
    r = await scenario('/429-no-cors', runner200); let f = r.results[0];
    ok(f.verdict === 'fail' && f.status === 0 && /Failed to fetch/.test(f.error), 'unchanged verdict: the page saw no response and the runner later got 200 with allow-origin *: fail');
    ok(f.diag.browserNet.some((x) => /no response, net::ERR_FAILED/.test(x)), 'page-level network events show only net::ERR_FAILED for a blocked response');
    ok(f.diag.browserProtocol.some((x) => /HTTP 429 received/.test(x) && /CORS error MissingAllowOriginHeader/.test(x) && /retry-after/.test(x)) && /received HTTP 429 without an Access-Control-Allow-Origin header, and Chrome blocked it \(CORS error MissingAllowOriginHeader\)/.test(f.detail), "Chrome's protocol shows the blocked response's real status, headers and CORS reason; reported, not inferred");
    ok(/does not show the browser's request could have succeeded \(cause unresolved\)/.test(f.detail) && !/could not read an answer the provider gives this origin/.test(f.detail), 'a later runner success is not presented as proof of a CORS failure');
    ok(/s after the browser's request\) → HTTP 200/.test(f.diag.runner) && /→ error "Failed to fetch" after \d+ ms/.test(f.diag.browserJs), "the runner request's time offset, and the page's own result and duration, are recorded");
    /* 3. the connection is reset: Chrome's error text, no response */
    r = await scenario('/reset', runner200); f = r.results[0];
    ok(f.verdict === 'fail' && f.diag.browserNet.some((x) => /no response, net::ERR_/.test(x)) && /the browser received no response \(net::ERR_(?!FAILED)\w+\)/.test(f.detail) && !/CORS error/.test(f.detail), "a reset connection is reported with Chrome's specific error and no response, and no CORS error");
    /* 4. the runner gets no answer either: unverified (unchanged), with the browser's network error kept */
    r = await scenario('/reset', async () => { throw new Error('fetch failed'); }); f = r.results[0];
    ok(f.verdict === 'unverified' && /did not answer the runner either \(fetch failed\)/.test(f.detail) && /net::ERR_/.test(f.detail), 'no runner answer either: unverified, with the browser network error kept');
    /* 5. readable error statuses keep their verdicts */
    r = await scenario('/500', runner200); ok(r.results[0].verdict === 'unverified' && /HTTP 500 to the browser/.test(r.results[0].detail), 'a readable HTTP 500: unverified, as before');
    r = await scenario('/404', runner200); ok(r.results[0].verdict === 'fail' && /HTTP 404 to the browser/.test(r.results[0].detail), 'a readable HTTP 404: fail, as before');
    /* 6. the page's own overlapping provider requests are counted with their outcomes */
    r = await scenario('/429-no-cors?delay=300', runner200, (p) => p.evaluate((P) => { setTimeout(() => { for (let i = 0; i < 3; i++) fetch(`${P}/own?i=${i}`).catch(() => {}); }, 50); }, P));
    ok(/^3 of the page's own Open-Meteo requests overlapped \(pending ×3\)$/.test(r.results[0].diag.pageOwnOpenMeteo), "the page's own overlapping provider requests and their state (still in flight) are listed");
    ok(DC.diagLines({ verdict: 'pass', diag: { browserJs: 'x', browserNet: [] } }).length === 0 && DC.diagLines(f).length >= 3, 'diagnostics print only for requests that did not pass');
  } finally { await browser.close(); pageSrv.close(); prov.close(); }
  console.log(fails ? `${fails} of ${n} direct-origin diagnostic checks failed` : `ok - ${n} direct-origin diagnostic checks passed`);
  process.exit(fails ? 1 : 0);
})();
