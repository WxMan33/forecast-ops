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
    const want = [/^api\.open-meteo\.com\/v1\/forecast \[gfs_seamless\] → failed: net::ERR_FAILED ×1 \(\d\d:\d\d:\d\dZ?–\d\d:\d\d:\d\dZ\)$/, /^api\.weather\.gov\/points\/39\.1,-84\.5 → HTTP 503 ×1 \(/];
    const problems = [];
    if (lines.length !== 2) problems.push(`expected 2 recorded requests, got ${lines.length}`);
    want.forEach((re, i) => { if (!lines.some((l) => re.test(l))) problems.push(`missing diagnostic ${i + 1} (${re})`); });
    if (/pk\.[0-9a-f]{8}|apikey|key=|\?/.test(text)) problems.push("a query string or key leaked into the diagnostics");
    return { problems, lines };
  } finally { await browser.close(); }
};
Promise.race([run(), new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${LIMIT / 1000} s`)), LIMIT))])
  .then(({ problems, lines }) => {
    lines.forEach((l) => console.log(`  recorded: ${l}`));
    if (problems.length) { problems.forEach((x) => console.log(`FAIL ${x}`)); process.exit(1); }
    console.log("ok - network recorder: blocked request and HTTP 503 recorded, redacted, nothing else"); process.exit(0);
  })
  .catch((e) => { console.log(`FAIL network recorder self-test: ${e.message}`); process.exit(1); });
