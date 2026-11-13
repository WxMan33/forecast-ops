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
    rows.push({ at: now(), where: `${u.hostname}${u.pathname}`.replace(/pk\.[0-9a-z]+/gi, "pk.[REDACTED]"), model, what });
  };
  const watch = (page) => {
    page.on("requestfailed", (r) => record(r.url(), `failed: ${(r.failure() && r.failure().errorText) || "unknown"}`));
    page.on("response", (r) => { if (r.status() >= 400) record(r.url(), `HTTP ${r.status()}`); });
  };
  /* grouped lines: "host/path [model] → what ×n (first–last Z)" */
  const since = (ms) => {
    const by = {};
    rows.filter((x) => x.at >= ms).forEach((x) => { const k = `${x.where}${x.model ? ` [${x.model}]` : ""} → ${x.what}`; by[k] = by[k] || { n: 0, first: x.at, last: x.at }; by[k].n++; by[k].last = x.at; });
    return Object.entries(by).map(([k, v]) => `${k} ×${v.n} (${new Date(v.first).toISOString().slice(11, 19)}–${new Date(v.last).toISOString().slice(11, 19)}Z)`);
  };
  return { record, watch, since, rows };
}
module.exports = { createRecorder, DATA_HOSTS };
