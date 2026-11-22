#!/usr/bin/env node
/* Weather Threats on a Cloudflare Pages deployment, with NWS requests through the same-origin function (?nws=function).
   Checks: every NWS request from the browser goes to <host>/api/nws (none straight to api.weather.gov); the page's
   "last confirmed" equals the function's X-Upstream-Fetched-At; a cache hit keeps it; the next real refresh (after the
   30 s cache) advances it. Also asks the function for a county and a marine zone.
     node tools/threats-cf-function-check.js https://<branch>.forecast-ops-beta.pages.dev [OUT_JSON] */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = process.argv[3] || "docs/threats/cloudflare-check.json";
if (!HOST) { console.error("usage: threats-cf-function-check.js https://<host>"); process.exit(2); }

(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const nws = [], errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("requestfinished", async (r) => { const u = r.url(); if (!/api\.weather\.gov|\/api\/nws\//.test(u)) return; const res = await r.response(), h = res ? await res.allHeaders() : {};
    nws.push({ url: u, viaFunction: u.startsWith(HOST + "/api/nws/"), status: res && res.status(), cache: h["x-forecast-ops-cache"] || null, upstreamAt: h["x-upstream-fetched-at"] || null, upstreamUserAgent: h["x-upstream-user-agent"] || null }); });
  await p.goto(HOST + "/threats?nws=function&scope=venue", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__threats && window.__threats.liveReady, null, { timeout: 45000 });
  await p.waitForTimeout(1500);
  const read = () => p.evaluate(() => ({ lastOk: window.__threats.data.sources.alerts.lastOk, shown: window.__threats.data.state.alerts.kind, mode: window.ThreatsLive.NWS.mode, base: window.ThreatsLive.NWS.base,
    venue: [...document.querySelectorAll(".px-brief .px-big, .px-brief .px-stat-h")].map((e) => e.textContent), activeWarnings: window.__threats.data.products.filter((x) => x.kind === "warning" && Date.parse(x.expires) > Date.now()).map((x) => x.title + " · " + x.area) }));
  const lastAlerts = () => nws.filter((r) => /alerts\/active/.test(r.url)).pop();
  const steps = [];
  const s1 = await read(), a1 = lastAlerts(); steps.push({ step: "page load", ...s1, response: a1 });
  await p.evaluate(() => window.ThreatsLive.refresh()); await p.waitForTimeout(800);
  const s2 = await read(), a2 = lastAlerts(); steps.push({ step: "refresh within 30 s", ...s2, response: a2 });
  await p.waitForTimeout(32000);
  await p.evaluate(() => window.ThreatsLive.refresh()); await p.waitForTimeout(800);
  const s3 = await read(), a3 = lastAlerts(); steps.push({ step: "refresh after the 30 s cache", ...s3, response: a3 });
  const zones = await p.evaluate(async (h) => Promise.all(["/api/nws/zones/county/PAC101", "/api/nws/zones/forecast/ANZ430"].map(async (z) => { const r = await fetch(h + z); const j = await r.json(); return { zone: z, status: r.status, cache: r.headers.get("X-Forecast-Ops-Cache"), upstreamAt: r.headers.get("X-Upstream-Fetched-At"), shape: j.geometry && j.geometry.type }; })), HOST);
  await p.screenshot({ path: OUT.replace(/\.json$/, "-venue.png") });

  const checks = {
    "browser NWS requests all go to the same-origin function": nws.length > 0 && nws.every((r) => r.viaFunction),
    "no direct api.weather.gov request from the browser": !nws.some((r) => /api\.weather\.gov/.test(r.url)),
    "page last-confirmed = function upstream time (load)": !!a1 && s1.lastOk === new Date(a1.upstreamAt).toISOString(),
    "refresh within 30 s: function cache HIT and last-confirmed unchanged": !!a2 && a2.cache === "HIT" && s2.lastOk === s1.lastOk,
    "refresh after 30 s: fresh upstream time and last-confirmed advanced": !!a3 && Date.parse(s3.lastOk) > Date.parse(s1.lastOk) && s3.lastOk === new Date(a3.upstreamAt).toISOString(),
    "function reports the identifying User-Agent": nws.filter((r) => r.status === 200).every((r) => r.upstreamUserAgent === "(forecast-ops, github.com/WxMan33/forecast-ops)"),
    "county and marine zone shapes through the function": zones.every((z) => z.status === 200 && z.shape),
    "no page errors": !errors.length,
  };
  const report = { host: HOST, at: new Date().toISOString(), checks, steps, zones, nwsRequests: nws, pageErrors: errors };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  for (const [k, v] of Object.entries(checks)) console.log((v ? "pass " : "FAIL ") + k);
  console.log("cache on refresh within 30 s:", a2 && a2.cache, "| last confirmed:", s1.lastOk, "->", s2.lastOk, "->", s3.lastOk, "| active warnings:", s3.activeWarnings.length);
  await b.close(); process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
