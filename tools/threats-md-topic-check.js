/* MDs from the NOAA map service, which gives an outline, a number and "Active Till hhmm UTC", but no topic or issue time.
   TEST REPLAY of the live answer saved 2026-11-25 22:29Z (MD 2465, a heavy-snow MD per SPC's own page), desktop and phone:
     the outline is drawn and labelled "MD 2465 · TOPIC UNAVAILABLE"; the detail says Topic unavailable, Issued "Unavailable from the
     map service" (never a 1970 date), Valid "Until <time> (0300Z) · start unavailable", and links the SPC bulletin.
   Usage: node tools/threats-md-topic-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/md-topic-check");
if (!HOST) { console.error("usage: node tools/threats-md-topic-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const FIX = fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "threats", "spc-md-service-2465-20261125.json"), "utf8");
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 1200))); };

(async () => {
  const b = await chromium.launch();
  for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
    const ctx = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(), errs = []; let served = 0;
    p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/spc_mesoscale_discussion\/MapServer\/0\/query/, (r) => { served++; r.fulfill({ status: 200, headers: { "content-type": "application/geo+json", "access-control-allow-origin": "*" }, body: FIX }); });
    await p.route(/spc\.noaa\.gov\/products\/md\//, (r) => r.abort()); // SPC's text unreachable, as from a browser: the map service is used
    await p.goto(HOST + "/threats.html?layers=severe&scope=national&view=active&testreplay=md-topic", { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.data.products.some((x) => x.kind === "md"), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const md = await p.evaluate(() => { const T = window.__threats, x = T.data.products.find((y) => y.kind === "md"); if (!x) return null;
      const f = (T.map.getSource("active")._data.features || []).find((y) => y.properties.id === x.id); return { id: x.id, label: f && f.properties.text, drawn: !!f, expires: x.expires, issued: x.issued }; });
    if (!md) { check(`(${d}) the replayed MD loads`, false, { served, errs }); await ctx.close(); continue; }
    await p.evaluate((id) => { const T = window.__threats; T.S.sel = id; T.drawAll(); }, md.id); await p.waitForTimeout(1200);
    if (phone && !(await p.locator("#txPanelBody .px-kv, #txPanelBody table").first().isVisible().catch(() => false))) { await p.locator("#txPeek").click().catch(() => {}); await p.waitForTimeout(800); }
    const det = await p.evaluate(() => { const body = document.getElementById("txPanelBody"), rows = {}; body.querySelectorAll("tr, .px-row, dt").forEach(() => {});
      const txt = body.innerText.replace(/\s+/g, " "); const get = (k, next) => { const m = new RegExp(k + " (.*?) (" + next + ") ").exec(txt); return m ? m[1] : ""; };
      return { txt: txt.slice(0, 900), topic: get("Topic", "Area"), issued: get("Issued", "Details|Valid"), valid: get("Valid", "Venue"), link: !!body.querySelector('a[href*="spc.noaa.gov/products/md/md2465"]') }; });
    await p.screenshot({ path: path.join(OUT, `md-topic-${d}.png`) });
    check(`(${d}) map label '${md.label}' (outline drawn: ${md.drawn})`, md.drawn && /^MD 2465 · TOPIC UNAVAILABLE/.test(md.label || ""), { md });
    check(`(${d}) detail: Topic '${det.topic.slice(0, 70)}…'; Issued '${det.issued}'; Valid '${det.valid}'; SPC bulletin link ${det.link}`,
      /^Topic unavailable: the NOAA map service doesn't say/.test(det.topic) && det.issued === "Unavailable from the map service" && !/1969|1970|Dec 31/.test(det.txt)
        && /^Until .* 0300Z · start unavailable from the map service$/.test(det.valid) && det.link,
      { det, md });
    check(`(${d}) no script errors; the replay is marked TEST REPLAY`, !errs.length && (await p.evaluate(() => document.getElementById("txBadge").textContent)) === "TEST REPLAY", { errs });
    await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, "md-topic-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
