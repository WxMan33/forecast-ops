#!/usr/bin/env node
/* Weather threats preview check: open the hosted (or local) preview as a signed-out visitor, wait for the live feeds,
   and record what the browser actually requested from NWS, SPC, NOAA and GitHub (status, User-Agent and Origin sent,
   CORS answer), the source states the page shows, and review screenshots.
     node tools/threats-preview-check.js [BASE_URL] [OUT_DIR]
   BASE_URL defaults to the raw.githack.com preview of this branch. The check uses Chromium's own headless identity and
   does not disguise it. SPC's MD pages refuse that identity (HTTP 403), so the MD feed shows as not responding here;
   verify MDs in an ordinary browser. */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2] || "https://raw.githack.com/WxMan33/forecast-ops/claude/beautiful-hawking-tnr183/threats.html";
const OUT = path.resolve(process.argv[3] || "docs/threats/screens/live");
const FEEDS = /api\.weather\.gov|spc\.noaa\.gov|mapservices\.weather\.noaa\.gov|raw\.githubusercontent\.com/;
fs.mkdirSync(OUT, { recursive: true });

async function open(browser, query, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.phone ? { width: opts.w || 390, height: opts.h || 844 } : { width: 1440, height: 900 }, deviceScaleFactor: opts.dsf || 1, isMobile: !!opts.phone, hasTouch: !!opts.phone });
  const p = await ctx.newPage(), errors = [], requests = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("requestfinished", async (r) => { if (!FEEDS.test(r.url())) return; const h = await r.allHeaders(), res = await r.response(), rh = res ? await res.allHeaders() : {};
    requests.push({ url: r.url(), status: res && res.status(), ua: h["user-agent"], origin: h.origin || null, acao: rh["access-control-allow-origin"] || null }); });
  p.on("requestfailed", (r) => { if (FEEDS.test(r.url())) requests.push({ url: r.url(), failed: r.failure().errorText }); });
  await p.goto(BASE + (query || ""), { waitUntil: "domcontentloaded", timeout: 60000 });
  let notice = false;
  if (await p.getByText("Open the page", { exact: true }).count()) { notice = true; await Promise.all([p.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), p.getByText("Open the page", { exact: true }).first().click()]); }
  await p.waitForFunction(() => window.__threats && window.__threats.ready, null, { timeout: 45000 });
  if (!opts.demo) await p.waitForFunction(() => window.__threats.liveReady, null, { timeout: 45000 });
  await p.waitForTimeout(opts.wait || 2500);
  return { p, ctx, errors, requests, notice };
}
const state = (p) => p.evaluate(() => { const d = window.__threats.data; return { clock: d.clock, live: !!d.live, products: d.products.map((x) => ({ kind: x.kind, title: x.category ? "Day " + x.day + " " + x.category : x.title, id: x.id, geometry: x.geometrySource || "polygon" })),
  sources: Object.fromEntries(Object.entries(d.sources).map(([k, v]) => [k, { shown: d.state[k].kind, lastOk: v.lastOk, count: v.count, error: v.error || null, outlook: v.outlook, list: v.list, service: v.service }])) }; });

(async () => {
  const browser = await chromium.launch(), report = { base: BASE, at: new Date().toISOString(), views: {} };
  const shoot = async (name, query, opts = {}) => {
    const v = await open(browser, query, opts);
    await v.p.screenshot({ path: path.join(OUT, name + ".png") });
    const hscroll = await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.views[name] = { query, notice: v.notice, hscroll, errors: v.errors, state: await state(v.p), requests: v.requests.map((r) => ({ ...r, url: r.url.length > 140 ? r.url.slice(0, 140) + "…" : r.url })) };
    console.log(name.padEnd(34), v.errors.length ? "ERR " + v.errors.join(" | ") : "ok", "hscroll=" + hscroll, v.notice ? "(host notice clicked)" : "");
    await v.ctx.close();
  };
  await shoot("live-national-desktop", "", { dsf: 2 });
  await shoot("live-venue-desktop", "?scope=venue", { dsf: 2 });
  await shoot("live-day1-model-desktop", "?view=day1&scope=venue&model=1", { dsf: 1.5, wait: 6000 });
  await shoot("live-national-phone", "", { phone: true, dsf: 2 });
  await shoot("live-venue-phone-open", "?scope=venue&sheet=open", { phone: true, dsf: 2 });
  await shoot("FIXTURE-outage-before-expiration", "?scenario=unavailable&scope=venue", { dsf: 2, demo: true });
  await shoot("FIXTURE-outage-after-expiration", "?scenario=outage-expired&scope=venue", { dsf: 2, demo: true });
  // a custom User-Agent from page script: what Chromium actually sends
  const v = await open(browser, "", {});
  await v.p.evaluate(() => fetch("https://api.weather.gov/alerts/active?area=OH", { headers: { "User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)" } }).then((r) => r.status, (e) => e.message));
  await v.p.waitForTimeout(1500);
  report.customUserAgentTest = v.requests.filter((r) => /area=OH/.test(r.url)).map((r) => ({ requested: "(forecast-ops, github.com/WxMan33/forecast-ops)", sent: r.ua, status: r.status }));
  await v.ctx.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  console.log("custom User-Agent test:", JSON.stringify(report.customUserAgentTest));
  console.log("report:", path.join(OUT, "report.json"));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
