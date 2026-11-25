/* Fire weather at the site (first step of the Fire Weather and Smoke group): the site's gusts and minimum humidity from the NWS
   forecast grid, alongside the alerts and SPC fire outlooks. Desktop and phone:
     live, quiet CVG: the Fire view lists 3 days of gusts and minimum humidity, labelled as the NWS forecast; no dry-and-gusty flag
       unless the grid really says so; Auto adds no fire layer from a quiet grid.
     TEST REPLAY: the site's real NWS grid with the next hours made dry (12%) and gusty (40 mph): the 7-day card shows
       "Dry and gusty", Auto turns on Fire weather with that cause, the Fire view flags the day; the page says TEST REPLAY.
   Usage: node tools/threats-fire-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/fire-check");
if (!HOST) { console.error("usage: node tools/threats-fire-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 1000))); };
const CVG = "lat=39.0446&lon=-84.6723&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky");

/* the site's own grid answer, with the coming hours set dry and gusty (fetched by Node; the forwarder's headers kept) */
const dryGrid = (count) => async (p) => { await p.route(/\/gridpoints\/[A-Z]{3}\/\d+,\d+(\?|$)/, async (r) => {
  try { const res = await fetch(r.request().url(), { headers: { Accept: "application/geo+json" } }), j = await res.json(), P = j.properties, h0 = Date.now() + 3600e3;
    if (P && P.relativeHumidity && P.windGust) { const span = (k, v) => { const t0 = new Date(Math.floor(h0 / 3600e3) * 3600e3).toISOString().replace(/\.\d+Z$/, "+00:00"); P[k].values = [{ validTime: t0 + "/PT4H", value: v }, ...P[k].values.filter((x) => Date.parse(x.validTime.split("/")[0]) >= h0 + 4 * 3600e3)]; };
      span("relativeHumidity", 12); span("windGust", P.windGust.uom === "wmoUnit:km_h-1" ? 64.4 : 40); count.n++; }
    const h = {}; res.headers.forEach((v, k) => { if (!/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(k)) h[k] = v; });
    await r.fulfill({ status: res.status, headers: { ...h, "content-type": "application/geo+json", "access-control-allow-origin": "*", "access-control-expose-headers": h["access-control-expose-headers"] || "*" }, body: JSON.stringify(j) });
  } catch (e) { count.failed++; await r.abort(); } }); };

(async () => {
  const b = await chromium.launch();
  for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
    for (const [label, q, setup] of [["LIVE quiet CVG", CVG, null], ["TEST REPLAY dry and gusty", CVG + "&testreplay=fire-check", "dry"]]) {
      const count = { n: 0, failed: 0 };
      const ctx = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(), errs = [];
      p.on("pageerror", (e) => errs.push(e.message)); if (setup) await dryGrid(count)(p);
      await p.goto(HOST + "/threats.html?" + q, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForFunction(() => window.__threats && window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(3000);
      const dash = await p.evaluate(() => { const A = window.__threats.siteAssess(), T = window.__threats;
        return { chips: [...document.querySelectorAll('.px-olchip[data-ol-key="dry"]')].map((x) => x.innerText.replace(/\s+/g, " ")), info: [...document.querySelectorAll(".px-olinfo")].map((x) => x.textContent).filter((x) => /Humidity/.test(x)),
          auto: T.S.auto, fire: !!(A && A.need.fire), cause: A && A.cause.fire, sum: document.getElementById("txLayersSum").textContent, badge: document.getElementById("txBadge").textContent }; });
      if (!phone) await p.screenshot({ path: path.join(OUT, `${setup ? "replay" : "live"}-dashboard-${d}.png`) });
      await p.evaluate(() => { const T = window.__threats; T.S.layers.fire = true; T.S.view = "fire"; T.drawAll(); }); await p.waitForTimeout(2500);
      if (phone && !(await p.locator("[data-firewx]").first().isVisible().catch(() => false))) { await p.locator("#txPeek").click().catch(() => {}); await p.waitForTimeout(800); }
      const fv = await p.evaluate(() => { const rows = [...document.querySelectorAll("[data-firewx]")]; const h = [...document.querySelectorAll(".px-h")].find((x) => /Wind and humidity at/.test(x.textContent));
        if (rows[0]) rows[0].scrollIntoView({ block: "center" });
        return { head: h ? h.textContent.replace(/\s+/g, " ") : "", rows: rows.map((r) => ({ text: r.innerText.replace(/\s+/g, " "), dry: r.classList.contains("dry"), w: Math.round(r.getBoundingClientRect().width) })), note: [...document.querySelectorAll(".lg-note")].some((x) => /Not an official fire weather product/.test(x.textContent)),
          alertsOrOutlook: [...document.querySelectorAll(".px-h")].some((x) => /Outlook areas · Day/.test(x.textContent)), hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
      await p.screenshot({ path: path.join(OUT, `${setup ? "replay" : "live"}-fireview-${d}.png`) });
      if (!setup) {
        check(`(${d}) ${label}: Fire view lists ${fv.rows.length} days of gusts and minimum humidity under '${fv.head}', next to the SPC outlook; first '${(fv.rows[0] || {}).text}'`,
          fv.rows.length === 3 && /Wind and humidity at .*NWS forecast/.test(fv.head) && fv.rows.every((r) => /Gusts (to \d+ mph|–)/.test(r.text) && /Humidity (as low as \d+%|–)/.test(r.text)) && fv.note && fv.alertsOrOutlook && !fv.hscroll && !errs.length, { fv, errs });
        check(`(${d}) ${label}: a quiet grid adds no fire layer (fire need ${dash.fire}, cause ${JSON.stringify(dash.cause)}); dry-and-gusty only where the grid says so (${fv.rows.filter((r) => r.dry).length} flagged days, ${dash.chips.length} chips)`,
          dash.auto && (dash.fire ? !!dash.cause : !/Fire weather/.test(dash.sum)) && fv.rows.filter((r) => r.dry).length === dash.chips.filter((c) => /Dry and gusty/.test(c)).length, { dash, fv });
      } else {
        check(`(${d}) ${label} (grid answers rewritten: ${count.n}, failed ${count.failed}): badge '${dash.badge}'; 7-day card '${dash.chips[0] || "none"}'; Auto '${dash.sum}' because ${JSON.stringify(dash.cause)}`,
          count.n > 0 && count.failed === 0 && dash.badge === "TEST REPLAY" && dash.chips.some((c) => /Dry and gusty: humidity 12% with gusts to 40 mph/.test(c)) && dash.fire && (dash.cause || []).some((c) => /Dry and gusty/.test(c)) && /Fire weather/.test(dash.sum) && !errs.length, { dash, count, errs });
        check(`(${d}) ${label}: the Fire view flags the day: '${(fv.rows.find((r) => r.dry) || {}).text}'`, fv.rows.some((r) => r.dry && /Dry and gusty for \d+ h \(15% or less with gusts of 35 mph or more\)/.test(r.text) && /Humidity as low as 12%/.test(r.text)) && !fv.hscroll, { fv });
      }
      await ctx.close(); } }
  await b.close();
  fs.writeFileSync(path.join(OUT, "fire-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
