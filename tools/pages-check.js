#!/usr/bin/env node
/* Smoke check of the dedicated Google Calendar beta origin (Cloudflare Pages, beta-previews branch).
   Signed out and without signing in to Google: the event beta opens, Upcoming events offers "Connect Google
   Calendar" (live import enabled for this exact origin), the sample calendar is still there, the footer carries no
   verification links, and no script errors. Usage: node tools/pages-check.js https://forecast-ops-beta.pages.dev/ <dir> */
"use strict";
const { chromium, devices } = require("playwright");
const [base, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch(); let failed = 0;
  const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`); };
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.route(/script\.google\.com\/macros/, (r) => r.abort()); // never reach the real usage collector
  await ctx.route(/accounts\.google\.com/, (r) => r.abort()); // the check never starts a Google sign-in
  const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
  const res = await p.goto(base + "event-beta.html#upcoming", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForFunction(() => document.querySelector("#upView:not([hidden]) #upImport"), null, { timeout: 60000 });
  const info = await p.evaluate(() => ({ origin: location.origin, path: location.pathname, live: window.CalendarImport.googleAvailable(), aud: sessionStorage.getItem("fo_beta_aud"),
    verify: [...document.querySelectorAll("footer a, #foot a")].filter((a) => /verif/i.test(a.textContent + a.href)).length }));
  await p.click("#upImport"); await p.waitForSelector("#ciSample", { timeout: 15000 });
  const dlg = await p.evaluate(() => ({ google: !!document.getElementById("ciGoogle"), text: document.getElementById("editForm").innerText.replace(/\s+/g, " ") }));
  await p.screenshot({ path: `${out}/pages-calendar-connect-phone.png` });
  report(res && res.ok() && info.live && dlg.google && /read-only access/.test(dlg.text) && info.aud === "event" && !info.verify && !errors.length,
    "Cloudflare Pages: live Google Calendar import offered on the authorized origin (not signed in)",
    `${info.origin}${info.path} · HTTP ${res && res.status()} · Connect Google Calendar ${dlg.google} · sample calendar kept · analytics audience ${info.aud} · verification links ${info.verify}${errors.length ? " · errors: " + errors.join("; ") : ""}`);
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
