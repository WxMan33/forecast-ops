#!/usr/bin/env node
/* End-to-end freshness check for the NWS forwarding function, through the page's own adapter.
   A scripted mock of api.weather.gov feeds the Pages Function (run by tools/nws-function-harness.mjs); the real Weather
   Threats page loads with ?nws=function. The page clock and the function clock move together. Steps: normal refresh, cache hit,
   upstream error, non-JSON body, paged list, timeout, recovery, expiration during a failure, confirmed empty.
   The mock records the User-Agent it receives. Synthetic warning built from a real NWS message: labelled FIXTURE.
     node tools/threats-function-check.mjs [OUT_DIR]   (needs Playwright) */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // resolved like the repo's other Playwright tools
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "docs/threats/function-check"));
fs.mkdirSync(OUT, { recursive: true });
const T0 = Date.parse("2026-11-20T20:30:00Z"), MIN = 60e3, T1 = T0 + 31e3; // T1: past the page-load fetch's 30 s cache
const iso = (t) => new Date(t).toISOString();

/* a real NWS message reshaped into a tornado warning over CVG, valid T0 .. T0+20 min */
const real = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/threats/nws-svr-tor-warnings-20261119.json"), "utf8")).features.find((f) => f.properties.messageType === "Alert");
function warning() {
  const f = JSON.parse(JSON.stringify(real)), p = f.properties, end = iso(T0 + 20 * MIN);
  Object.assign(p, { id: "urn:fixture:tor:1", event: "Tornado Warning", sent: iso(T0 - 2 * MIN), effective: iso(T0 - 2 * MIN), onset: iso(T0 - 2 * MIN), expires: end, ends: end, senderName: "NWS Wilmington OH", messageType: "Alert", areaDesc: "Boone, KY (FIXTURE)" });
  p.parameters = { ...p.parameters, VTEC: ["/O.NEW.KILN.TO.W.0099.261120T2028Z-261120T2050Z/"], eventEndingTime: [end] };
  f.geometry = { type: "Polygon", coordinates: [[[-84.85, 38.95], [-84.50, 38.95], [-84.50, 39.15], [-84.85, 39.15], [-84.85, 38.95]]] };
  return f;
}
let mode = "ok"; const seen = [];
const mock = http.createServer((req, res) => {
  seen.push({ at: new Date().toISOString(), mode, path: req.url, userAgent: req.headers["user-agent"] });
  const send = (code, body, type = "application/geo+json") => { res.writeHead(code, { "Content-Type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  if (mode === "ok") return send(200, { type: "FeatureCollection", features: [warning()] });
  if (mode === "ok-changed") return send(200, { type: "FeatureCollection", features: [] });          // would end the warning if it were fetched
  if (mode === "empty") return send(200, { type: "FeatureCollection", features: [] });
  if (mode === "error") return send(503, "Service Unavailable", "text/plain");
  if (mode === "html") return send(200, "<html><body>maintenance</body></html>", "text/html");
  if (mode === "paged") return send(200, { type: "FeatureCollection", features: [], pagination: { next: "https://api.weather.gov/alerts/active?cursor=x" } });
  if (mode === "slow") { setTimeout(() => send(200, { type: "FeatureCollection", features: [warning()] }), 4000); return; }
}).listen(8833);
const harness = spawn(process.execPath, [path.join(ROOT, "tools/nws-function-harness.mjs"), "8823", "--upstream", "http://localhost:8833"], { env: { ...process.env, NWS_TIMEOUT_MS: "1500", NODE_USE_ENV_PROXY: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => harness.stdout.once("data", r));
const setClock = (t) => fetch("http://localhost:8823/__harness/clock?t=" + t);

const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.clock.install({ time: T0 }); await setClock(T0);
await page.goto("http://localhost:8823/threats.html?nws=function&scope=venue", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__threats && window.__threats.liveReady, null, { timeout: 30000 });
await page.clock.runFor(500);

const results = [];
async function step(name, t, m, expect, shot) {
  mode = m; await setClock(t); await page.clock.setSystemTime(t);
  const before = seen.length;
  await page.evaluate(() => window.ThreatsLive.refresh()); await page.clock.runFor(300);
  const s = await page.evaluate(() => { const d = window.__threats.data, last = window.ThreatsLive.diag.requests.filter((r) => /\/api\/nws\/alerts\/active/.test(r.url)).pop();
    return { lastOk: d.sources.alerts.lastOk, shown: d.state.alerts.kind, active: d.products.filter((p) => p.kind === "warning" && Date.parse(p.expires) > Date.parse(d.clock)).length,
      venue: [...document.querySelectorAll(".px-brief .px-big, .px-brief .px-stat-h")].map((e) => e.textContent), notices: [...document.querySelectorAll(".px-notice")].map((e) => e.textContent.slice(0, 120)),
      functionStatus: last && last.status, cache: last && last.cache, upstreamAt: last && last.upstreamAt }; });
  const upstreamCalls = seen.length - before, problems = expect(s, upstreamCalls);
  results.push({ step: name, pageClock: iso(t), upstreamMode: m, upstreamCalls, ...s, pass: !problems.length, problems });
  if (shot) await page.screenshot({ path: path.join(OUT, shot + ".png") });
  console.log((problems.length ? "FAIL " : "pass ") + name + (problems.length ? " :: " + problems.join("; ") : ""));
}
const want = (cond, msg) => (cond ? [] : [msg]);
await step("1 normal refresh: fresh confirmation", T1, "ok", (s, n) => [...want(s.lastOk === iso(T1), "lastOk " + s.lastOk), ...want(s.cache === "MISS", "cache " + s.cache), ...want(n === 1, "upstream calls " + n), ...want(/Tornado Warning in effect/.test(s.venue[0] || ""), "venue " + s.venue)], "FIXTURE-function-1-normal");
await step("2 cache hit within 30 s: not a new confirmation", T1 + 20e3, "ok-changed", (s, n) => [...want(s.cache === "HIT", "cache " + s.cache), ...want(n === 0, "upstream called"), ...want(s.lastOk === iso(T1), "lastOk moved to " + s.lastOk), ...want(s.active === 1, "warning ended by a cached copy")]);
await step("3 upstream HTTP 503: last known, not cleared", T0 + 5 * MIN, "error", (s) => [...want(s.functionStatus === 502, "function " + s.functionStatus), ...want(s.lastOk === iso(T1), "lastOk " + s.lastOk), ...want(s.shown === "stale", "shown " + s.shown), ...want(s.active === 1, "cleared"), ...want(/^Last known: Tornado Warning/.test(s.venue[0] || ""), "venue " + s.venue)], "FIXTURE-function-3-failed");
await step("4 upstream HTML (malformed): failure, not empty", T0 + 6 * MIN, "html", (s) => [...want(s.functionStatus === 502, "function " + s.functionStatus), ...want(s.active === 1, "cleared"), ...want(s.lastOk === iso(T1), "lastOk " + s.lastOk)]);
await step("5 paged list (possibly incomplete): failure, not empty", T0 + 7 * MIN, "paged", (s) => [...want(s.functionStatus === 502, "function " + s.functionStatus), ...want(s.active === 1, "cleared")]);
await step("6 upstream timeout: failure", T0 + 8 * MIN, "slow", (s) => [...want(s.functionStatus === 502, "function " + s.functionStatus), ...want(s.active === 1, "cleared"), ...want(s.lastOk === iso(T1), "lastOk " + s.lastOk)]);
await step("7 recovery: fresh confirmation again", T0 + 9 * MIN, "ok", (s, n) => [...want(s.cache === "MISS" && n === 1, "cache " + s.cache + " calls " + n), ...want(s.lastOk === iso(T0 + 9 * MIN), "lastOk " + s.lastOk), ...want(s.shown === "current", "shown " + s.shown), ...want(/in effect/.test(s.venue[0] || ""), "venue " + s.venue)], "FIXTURE-function-7-recovered");
await step("8a failure begins before the warning's end", T0 + 12 * MIN, "error", (s) => [...want(s.active === 1, "cleared"), ...want(s.lastOk === iso(T0 + 9 * MIN), "lastOk " + s.lastOk)]);
await step("8b expiration during the failure: no longer active, status unknown", T0 + 25 * MIN, "error", (s) => [...want(s.active === 0, "still shown active"), ...want(s.notices.some((x) => /reached its published expiration/.test(x)), "no expiration notice"), ...want(s.shown === "stale", "shown " + s.shown), ...want(s.lastOk === iso(T0 + 9 * MIN), "lastOk " + s.lastOk)], "FIXTURE-function-8-expired-during-failure");
await step("9 confirmed empty after recovery", T0 + 26 * MIN, "empty", (s) => [...want(s.active === 0, "active"), ...want(s.shown === "empty", "shown " + s.shown), ...want(s.lastOk === iso(T0 + 26 * MIN), "lastOk " + s.lastOk)]);

const report = { note: "FIXTURE: synthetic tornado warning (built from a real NWS message) served by a mock api.weather.gov through the Pages Function harness; page clock and function clock moved together.",
  steps: results, upstreamIdentitySeenByMock: [...new Set(seen.map((x) => x.userAgent))], upstreamRequests: seen.length, pageErrors: errors };
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
console.log("upstream User-Agent seen by the mock:", report.upstreamIdentitySeenByMock.join(" | "), "· page errors:", errors.length);
await browser.close(); harness.kill(); mock.close();
process.exit(results.every((r) => r.pass) && !errors.length ? 0 : 1);
