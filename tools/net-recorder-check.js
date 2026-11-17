#!/usr/bin/env node
/* Self-test of the browser check's network recorder, offline and bounded: a local page requests two weather-data URLs whose
   query strings carry a synthetic key; one is blocked (a failed request), one answers HTTP 503. The recorder must report
   exactly those two, by host, path and model, with no query string or key. Finishes in seconds or fails at 30 s. */
"use strict";
const { chromium } = require("playwright");
const { createRecorder } = require("./net-recorder.js");
const LIMIT = 30000, KEY = "pk.0123456789abcdef0123456789abcdef";
const run = async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext(), p = await ctx.newPage(), rec = createRecorder();
    rec.watch(p);
    await ctx.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => r.abort());
    await ctx.route(/api\.weather\.gov\/points/, (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await ctx.route(/^https:\/\/check\.local\/$/, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>net check</title>" }));
    await p.goto("https://check.local/");
    await p.evaluate(async (key) => {
      const get = (u) => fetch(u).then((r) => r.status, () => "failed");
      return Promise.all([get(`https://api.open-meteo.com/v1/forecast?latitude=39.1&longitude=-84.5&models=gfs_seamless&apikey=${key}`), get(`https://api.weather.gov/points/39.1,-84.5?key=${key}`)]);
    }, KEY);
    await p.waitForTimeout(300); // the failure and response events arrive after fetch settles
    const lines = rec.since(0), text = lines.join("\n");
    const want = [/^api\.open-meteo\.com\/v1\/forecast \[gfs_seamless\] → failed: net::ERR_FAILED ×1 \(\d\d:\d\d:\d\dZ?–\d\d:\d\d:\d\dZ\)$/, /^api\.weather\.gov\/points\/\{point\} → HTTP 503 ×1 \(/];
    const problems = [];
    if (lines.length !== 2) problems.push(`expected 2 recorded requests, got ${lines.length}`);
    want.forEach((re, i) => { if (!lines.some((l) => re.test(l))) problems.push(`missing diagnostic ${i + 1} (${re})`); });
    if (/pk\.[0-9a-f]{8}|apikey|key=|\?|39\.1|-84\.5/.test(text)) problems.push("a query string, key or location leaked into the diagnostics");
    /* request volume: the same blocked request asked again is one exact repeat; keys never appear in the summary */
    await p.evaluate((key) => fetch(`https://api.open-meteo.com/v1/forecast?latitude=39.1&longitude=-84.5&models=gfs_seamless&apikey=${key}`).catch(() => {}), KEY); await p.waitForTimeout(300);
    const v = rec.volume(0, { detail: true });
    if (v.total !== 3 || v.repeats !== 1 || v.openMeteo !== 2) problems.push(`volume: expected 3 requests, 1 exact repeat, 2 to Open-Meteo; got ${v.line}`);
    if (/pk\.[0-9a-f]{8}|apikey/.test(v.line + v.top.join() + v.dup.join())) problems.push("a key leaked into the volume summary");
    /* POST bodies are part of a request's identity; a 429's stated limit is kept; requests in flight at once are counted */
    await ctx.route(/data\.rcc-acis\.org\/StnData/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await ctx.route(/ensemble-api\.open-meteo\.com\/v1\/ensemble/, (r) => r.fulfill({ status: 429, headers: { "Retry-After": "57", "X-RateLimit-Window": "60", "X-RateLimit-Remaining": "0" }, contentType: "application/json", body: JSON.stringify({ error: true, reason: "Minutely API request limit exceeded. Please try again in one minute." }) }));
    await ctx.route(/api\.weather\.gov\/alerts/, (r) => setTimeout(() => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }), 300));
    const mark = Date.now();
    await p.evaluate(() => { const post = (b) => fetch("https://data.rcc-acis.org/StnData", { method: "POST", body: JSON.stringify(b) }).catch(() => {});
      return Promise.all([post({ sid: "CVG", elems: ["maxt"] }), post({ sid: "IND", elems: ["maxt"] }), post({ sid: "CVG", elems: ["maxt"] }),
        fetch("https://ensemble-api.open-meteo.com/v1/ensemble?latitude=39.1&longitude=-84.5&models=gfs025").catch(() => {}),
        ...[1, 2, 3].map((i) => fetch(`https://api.weather.gov/alerts/active?point=39.1,-84.5&i=${i}`).catch(() => {}))]); });
    await p.waitForTimeout(300);
    const w = rec.volume(mark, { detail: true });
    if (w.repeats !== 1) problems.push(`POST bodies: expected 1 exact repeat (the second identical CVG query), got ${w.repeats} (${w.line})`);
    if (!(w.limits.length === 1 && /Minutely API request limit exceeded/.test(w.limits[0]) && /Retry-After 57/.test(w.limits[0]) && /window 60/.test(w.limits[0]) && /remaining 0–0/.test(w.limits[0]))) problems.push(`429 limit not recorded as stated: ${JSON.stringify(w.limits)}`);
    if (!((w.peak["api.weather.gov"] || 0) >= 3)) problems.push(`peak in flight: expected at least 3 NWS requests at once, got ${JSON.stringify(w.peak)}`);
    if (!/reached the network 7 \(/.test(w.breakdown) || !/RCC-ACIS 3/.test(w.breakdown)) problems.push(`breakdown: ${w.breakdown}`);
    /* nothing printed names a location, a POST body or a key */
    await p.evaluate(() => Promise.all([1, 2, 3].map(() => fetch("https://api.weather.gov/points/39.05617,-84.41757").catch(() => {}))));
    await p.waitForTimeout(300);
    const all = rec.volume(0, { detail: true }), printed = [all.line, all.breakdown, ...all.top, ...all.dup, ...all.limits].join("\n");
    if (/39\.05617|-84\.41757|39\.1|-84\.5|"sid"|CVG|IND|apikey|pk\.[0-9a-f]{8}/.test(printed)) problems.push(`a location, body or key appears in the printed summary: ${printed.replace(/\n/g, " | ").slice(0, 400)}`);
    return { problems, lines };
  } finally { await browser.close(); }
};
Promise.race([run(), new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${LIMIT / 1000} s`)), LIMIT))])
  .then(({ problems, lines }) => {
    lines.forEach((l) => console.log(`  recorded: ${l}`));
    if (problems.length) { problems.forEach((x) => console.log(`FAIL ${x}`)); process.exit(1); }
    console.log("ok - network recorder: blocked request and HTTP 503 recorded, redacted, nothing else; request volume and exact repeats counted; POST bodies keep requests distinct; a 429's stated limit and requests in flight recorded"); process.exit(0);
  })
  .catch((e) => { console.log(`FAIL network recorder self-test: ${e.message}`); process.exit(1); });
