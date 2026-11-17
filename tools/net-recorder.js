/* Records weather-data requests (Open-Meteo, NWS, RCC-ACIS) that fail or answer 4xx/5xx on the pages a browser check opens.
   Only host and path are kept (query strings, which can carry keys, are dropped; a pk. token in a path is masked), plus the
   model name, the HTTP status or the browser's failure text, and when. Shared by tools/beta-preview-check.js and its
   self-test (tools/net-recorder-check.js). */
"use strict";
const DATA_HOSTS = /(^|\.)(api\.open-meteo\.com|ensemble-api\.open-meteo\.com|api\.weather\.gov|data\.rcc-acis\.org)$/;
function createRecorder(now = () => Date.now()) {
  const rows = [];
  const record = (url, what) => {
    let u; try { u = new URL(url); } catch (e) { return; }
    if (!DATA_HOSTS.test(u.hostname)) return;
    const model = (u.searchParams.get("models") || "").replace(/[^a-z0-9_,.-]/gi, "").slice(0, 80);
    rows.push({ at: now(), where: `${u.hostname}${u.pathname}`.replace(/pk\.[0-9a-z]+/gi, "pk.[REDACTED]").replace(/-?\d{1,3}\.\d+,-?\d{1,3}\.\d+/g, "{point}").replace(/gridpoints\/[A-Z]{3}\/\d+,\d+/g, "gridpoints/{grid}"), model, what }); // never a location (a venue's exact point)
  };
  /* request volume: every weather-data request (not only failures), keyed without its query values' secrets.
     Exact duplicates are the same endpoint, model and query asked again within one run. */
  const sent = [];
  /* a request's identity: method, host, path, query (keys and tokens left out) and, for a POST (RCC-ACIS), a hash of its
     body, so different station queries to one endpoint are not repeats. The body itself is never kept or printed. */
  const bodyTag = (r) => { const b = r.postData && r.postData(); return b ? `#body:${require("crypto").createHash("sha1").update(b).digest("hex").slice(0, 12)}` : ""; };
  const keyOf = (u, r) => { const q = [...u.searchParams.entries()].filter(([k]) => !/key|token/i.test(k)).sort().map(([k, v]) => `${k}=${v}`).join("&"); return `${r ? r.method() + " " : ""}${u.hostname}${u.pathname}?${q}`.replace(/pk\.[0-9a-z]+/gi, "pk.[REDACTED]") + (r ? bodyTag(r) : ""); };
  /* requests in flight per host, and the most at once */
  const inflight = {}, done = (r) => { const x = sent.find((y) => y.req === r); if (x && !x.done) { x.done = true; inflight[x.host]--; } };
  const watch = (page) => {
    page.on("requestfailed", (r) => { record(r.url(), `failed: ${(r.failure() && r.failure().errorText) || "unknown"}`); done(r); });
    page.on("requestfinished", done);
    page.on("response", (r) => { if (r.status() >= 400) record(r.url(), `HTTP ${r.status()}`); const x = sent.find((y) => y.req === r.request()); if (!x) return; x.status = r.status();
      /* Open-Meteo reports what each request cost against its per-minute budget; answers reused from this run's own cache cost nothing */
      const h = r.headers(); if (h["x-forecast-ops-reused"]) { x.reused = true; return; }
      /* a 429: which limit, from what the browser already received (no extra request) */
      if (x.status === 429) { x.limit = { retryAfter: h["retry-after"] || null, remaining: h["x-ratelimit-remaining"] || null, window: h["x-ratelimit-window"] || null, reason: null };
        r.text().then((t) => { let why = null; try { why = JSON.parse(t).reason; } catch (e) { why = t; } x.limit.reason = String(why || "").replace(/\s+/g, " ").slice(0, 100) || null; }).catch(() => {}); } const c = parseFloat(h["x-ratelimit-cost"]), left = parseFloat(h["x-ratelimit-remaining"]); if (Number.isFinite(c)) { x.cost = c; x.budget = parseFloat(h["x-ratelimit-limit"]); } if (Number.isFinite(left)) x.left = left; });
    page.on("request", (r) => { let u; try { u = new URL(r.url()); } catch (e) { return; } if (!DATA_HOSTS.test(u.hostname) || r.method() === "OPTIONS") return;
      inflight[u.hostname] = (inflight[u.hostname] || 0) + 1;
      sent.push({ at: now(), req: r, host: u.hostname, inflight: inflight[u.hostname], endpoint: `${u.hostname}${u.pathname.replace(/\/-?\d+(\.\d+)?,-?\d+(\.\d+)?/, "/{point}").replace(/\/products\/[0-9a-f-]{36}/, "/products/{id}").replace(/gridpoints\/[A-Z]{3}\/\d+,\d+/, "gridpoints/{grid}")}`, model: (u.searchParams.get("models") || "").slice(0, 60), key: keyOf(u, r), status: null }); });
  };
  /* "N requests (open-meteo forecast N, ...) · M exact repeats · 429 ×K · busiest minute N" for requests since ms */
  const volume = (ms = 0, { detail = false } = {}) => {
    const xs = sent.filter((x) => x.at >= ms); if (!xs.length) return { total: 0, line: "0 weather-data requests" };
    const count = (f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
    const byKey = count((x) => x.key), repeats = Object.values(byKey).reduce((a, n) => a + n - 1, 0);
    const byEndpoint = Object.entries(count((x) => x.endpoint)).sort((a, b) => b[1] - a[1]);
    const perMin = Object.values(count((x) => Math.floor(x.at / 60e3))), r429 = xs.filter((x) => x.status === 429).length;
    const om = xs.filter((x) => /open-meteo\.com$/.test(x.host)).length;
    const costs = xs.filter((x) => Number.isFinite(x.cost)), costMin = costs.length ? Object.values(costs.reduce((m, x) => { const k = Math.floor(x.at / 60e3); m[k] = (m[k] || 0) + x.cost; return m; }, {})) : [];
    const reused = xs.filter((x) => x.reused).length, lows = xs.filter((x) => Number.isFinite(x.left)).map((x) => x.left);
    const budget = costs.length ? ` · Open-Meteo cost ${Math.round(costs.reduce((a, x) => a + x.cost, 0))} units (peak ${Math.round(Math.max(...costMin))} in a minute of ${costs[0].budget || "?"} allowed; lowest remaining ${lows.length ? Math.round(Math.min(...lows)) : "?"})` : "";
    const line = `${xs.length} weather-data requests (Open-Meteo ${om}${reused ? `, ${reused} answered from this run's live cache` : ""}) · ${repeats} exact repeats · HTTP 429 ×${r429} · busiest minute ${Math.max(...perMin)}${budget}`;
    const top = detail ? byEndpoint.slice(0, 8).map(([k, n]) => `${k} ×${n}`) : [];
    /* printed keys never show a location (a venue's exact point) or a body: coordinates in paths and queries become {point} */
    const redact = (k) => k.replace(/latitude=[^&#]*&longitude=[^&#]*&?/g, "{point}&").replace(/(latitude|longitude|lat|lon|point)=[^&#]*/gi, "$1={point}").replace(/-?\d{1,3}\.\d+,-?\d{1,3}\.\d+/g, "{point}").replace(/gridpoints\/[A-Z]{3}\/\d+,\d+/g, "gridpoints/{grid}");
    const dup = detail ? Object.entries(byKey).filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${redact(k).slice(0, 140)} ×${n}`) : [];
    /* what reached the network (not this run's cache), by kind; the most requests in flight to one host at once; and
       each 429's limit as the provider stated it */
    const net = xs.filter((x) => !x.reused), kind = (x) => /static\/meta\.json$/.test(x.endpoint) ? "Open-Meteo metadata" : /open-meteo\.com\/v1\//.test(x.endpoint) ? "Open-Meteo forecast/ensemble" : /open-meteo/.test(x.host) ? "Open-Meteo other" : /weather\.gov/.test(x.host) ? "NWS" : /rcc-acis/.test(x.host) ? "RCC-ACIS" : x.host;
    const byKind = count((x) => (x.reused ? "run cache" : kind(x)));
    const peak = {}; xs.forEach((x) => { const k = /open-meteo/.test(x.host) ? "Open-Meteo" : x.host; peak[k] = Math.max(peak[k] || 0, x.inflight || 0); });
    const lim = xs.filter((x) => x.limit), limBy = {};
    lim.forEach((x) => { const k = `${x.limit.reason || "no reason given"} · Retry-After ${x.limit.retryAfter || "none"} · window ${x.limit.window || "?"}`; const g = (limBy[k] = limBy[k] || { n: 0, inflight: [], remaining: [] }); g.n++; g.inflight.push(x.inflight || 0); if (x.limit.remaining != null) g.remaining.push(+x.limit.remaining); });
    const limits = Object.entries(limBy).sort((a, b) => b[1].n - a[1].n).map(([k, g]) => `${k} ×${g.n} (Open-Meteo requests in flight ${Math.min(...g.inflight)}–${Math.max(...g.inflight)}${g.remaining.length ? `; remaining ${Math.min(...g.remaining)}–${Math.max(...g.remaining)}` : ""})`);
    const breakdown = `reached the network ${net.length} (${Object.entries(byKind).filter(([k]) => k !== "run cache").sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}) · run cache ${byKind["run cache"] || 0} · peak in flight ${Object.entries(peak).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(", ")}`;
    return { total: xs.length, openMeteo: om, repeats, r429, busiestMinute: Math.max(...perMin), line, top, dup, breakdown, limits, network: net.length, byKind, peak };
  };
  /* grouped lines: "host/path [model] → what ×n (first–last Z)" */
  const since = (ms) => {
    const by = {};
    rows.filter((x) => x.at >= ms).forEach((x) => { const k = `${x.where}${x.model ? ` [${x.model}]` : ""} → ${x.what}`; by[k] = by[k] || { n: 0, first: x.at, last: x.at }; by[k].n++; by[k].last = x.at; });
    return Object.entries(by).map(([k, v]) => `${k} ×${v.n} (${new Date(v.first).toISOString().slice(11, 19)}–${new Date(v.last).toISOString().slice(11, 19)}Z)`);
  };
  return { record, watch, since, rows, volume };
}
module.exports = { createRecorder, DATA_HOSTS };
