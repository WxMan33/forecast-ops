#!/usr/bin/env node
/* Signed-out check of the public beta preview links, plus screenshots for review.
   Each page opens in a fresh browser context (no cookies, no storage, no GitHub session) on desktop and phone.
   Usage: node tools/beta-preview-check.js <base URL ending in /> <screenshot dir> [expected asset stamp] */
"use strict";
const { chromium, devices } = require("playwright");
const [base, out, stamp] = process.argv.slice(2);
const PAGES = [["meteorologist", "meteorologist-beta.html"], ["event", "event-beta.html"]];
const DEVICES = [["desktop", { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 }], ["phone", { ...devices["iPhone 13"] }]];
(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  let failed = 0;
  for (const [tag, page] of PAGES) for (const [dev, opts] of DEVICES) {
    const ctx = await browser.newContext(opts), p = await ctx.newPage(), errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const res = await p.goto(base + page, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = res ? res.status() : 0;
    /* raw.githack.com shows a one-time "One more step" notice before serving third-party HTML;
       a colleague clicks "Open the page" once. Do the same, and report that it was shown. */
    const notice = await p.getByText("Open the page", { exact: true }).count();
    if (notice) { await p.getByText("Open the page", { exact: true }).first().click(); await p.waitForLoadState("domcontentloaded"); }
    await p.waitForFunction(() => document.querySelector("#timeline svg") || document.querySelector(".bx-err"), null, { timeout: 90000 }).catch(() => errors.push("content did not finish loading"));
    await p.locator(".bx-map iframe").scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForFunction(() => { const f = document.querySelector(".bx-map iframe"); return f && f.contentDocument && f.contentDocument.querySelector(".maplibregl-canvas"); }, null, { timeout: 60000 }).catch(() => errors.push("map did not load"));
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(5000);
    const info = await p.evaluate(() => ({ title: document.title, h1: document.querySelector("h1").innerText, guard: !!document.getElementById("loadGuard"), err: !!document.querySelector(".bx-err"),
      hscroll: document.documentElement.scrollWidth > innerWidth + 1, verifyLinks: document.querySelectorAll('a[href*="verify"]').length, signin: /sign in|log in/i.test(document.body.innerText) }));
    const fresh = !stamp || (await p.content()).includes(stamp); // after any host notice
    const ok = status === 200 && !info.guard && !info.err && !info.hscroll && !info.verifyLinks && !info.signin && fresh && !errors.length;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${tag} ${dev}: HTTP ${status}${notice ? ", host notice clicked through" : ", no host notice"}, "${info.h1}"${fresh ? "" : " (preview host still serving an older build)"}${errors.length ? " errors: " + errors.join("; ") : ""}${info.hscroll ? " horizontal scroll" : ""}${info.verifyLinks ? " verification link present" : ""}`);
    await p.screenshot({ path: `${out}/${tag}-${dev}.png`, fullPage: dev === "phone" });
    if (dev === "desktop") await p.screenshot({ path: `${out}/${tag}-${dev}-full.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
