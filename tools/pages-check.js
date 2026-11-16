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
  /* live venue search through LocationIQ (only once a token is configured for this origin) */
  { const c2 = await browser.newContext({ ...devices["iPhone 13"] }); await c2.route(/script\.google\.com\/macros/, (r) => r.abort());
    const q = await c2.newPage(), errs = [], liq = [], liqRes = []; q.on("pageerror", (e) => errs.push(e.message)); q.on("request", (r) => { if (/locationiq\.com/.test(r.url())) liq.push(r.url()); });
    /* LocationIQ's own answer (status and message), with the token redacted */
    q.on("response", async (r) => { if (!/locationiq\.com/.test(r.url())) return; let body = ""; try { body = (await r.text()).slice(0, 80); } catch (e) { /* ignore */ } liqRes.push(`HTTP ${r.status()} ${r.status() >= 400 ? body.replace(/pk\.[0-9a-f]+/g, "pk.[REDACTED]") : ""}`.trim()); });
    await q.goto(base + "event-beta.html#upcoming", { waitUntil: "domcontentloaded", timeout: 60000 }); await q.waitForSelector("#upView:not([hidden]) #vnAdd", { timeout: 60000 });
    const prov = await q.evaluate(() => window.VenueSearch.provider());
    /* opening the calendar picker (sample calendar, unfamiliar locations) sends no geocoding request */
    let geoReq = 0; q.on("request", (r) => { if (/locationiq\.com|nominatim\.openstreetmap\.org|geocoding-api\.open-meteo\.com/.test(r.url())) geoReq++; });
    await q.click("#upImport"); await q.click("#ciSample"); await q.waitForSelector("#ciNext"); await q.click("#ciNext");
    await q.waitForFunction(() => document.getElementById("editForm").dataset.resolved === "true", null, { timeout: 30000 }); await q.waitForTimeout(2500);
    const rows = await q.evaluate(() => [...document.querySelectorAll(".ci-ev")].map((r) => r.dataset.match).join(","));
    report(geoReq === 0 && /review/.test(rows), "Cloudflare Pages: opening the calendar picker makes zero geocoding requests", `${geoReq} geocoding requests · rows ${rows}`);
    await q.evaluate(() => document.getElementById("editDlg").close()); geoReq = 0;
    if (prov !== "locationiq") report(true, "Cloudflare Pages: LocationIQ venue search", "token not configured yet; the reviewed public search is in use");
    else {
      const out2 = [];
      for (const [query, want] of [["Northwest Stadium, Landover", "found"], ["Paycor Stadium", "found"], ["6295 Kellogg Ave, Cincinnati, OH 45230", "found"], ["Memorial Stadium", "several"]]) {
        await q.click("#vnAdd"); await q.waitForSelector("#vCity .vs-q");
        await q.fill("#vCity .vs-q", query); await q.click("#vCity .vs-go");
        await q.waitForFunction(() => !/Searching/.test(document.querySelector("#vCity .vs-msg").textContent), null, { timeout: 30000 });
        const r = await q.evaluate(() => ({ hits: [...document.querySelectorAll("#vCity .vs-hit")].map((b) => b.innerText.replace(/\s+/g, " ")), msg: document.querySelector("#vCity .vs-msg").textContent, attr: document.querySelector("#vCity .vs-foot").innerText }));
        out2.push({ query, want, ...r, http: liqRes[liqRes.length - 1] || "no response" }); await q.keyboard.press("Escape").catch(() => {}); await q.evaluate(() => document.getElementById("editDlg").close());
      }
      const okAll = out2.every((r) => /Search by LocationIQ\.com/.test(r.attr) && (r.want === "found" ? r.hits.length >= 1 : r.hits.length >= 2)) && out2.every((r) => /^HTTP 200/.test(r.http)) && liq.length >= 4 && !errs.length;
      report(okAll, "Cloudflare Pages: LocationIQ venue search (venue name, full street address, ambiguous name)", out2.map((r) => `${r.query} → ${r.http} → ${r.hits.length} result(s)${r.hits.length ? ": " + r.hits.slice(0, 3).map((h) => h.slice(0, 50)).join(" / ") : ` ("${r.msg.slice(0, 60)}")`}`).join(" | ") + ` · ${liq.length} LocationIQ requests${errs.length ? " · errors: " + errs.join("; ") : ""}`);
    }
    await c2.close(); }
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
