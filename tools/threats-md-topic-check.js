/* MDs from the NOAA map service, which gives an outline, a number and "Active Till hhmm UTC", but no topic or issue time.
   TEST REPLAY of the live answer saved 2026-11-25 22:29Z (MD 2465, a heavy-snow MD per SPC's own page), desktop and phone:
     the outline is drawn and labelled "MD 2465 · TOPIC UNAVAILABLE"; the detail says Topic unavailable, Issued "Unavailable from the
     map service" (never a 1970 date), Valid "Until <time> (0300Z) · start unavailable", and links the SPC bulletin.
   A venue inside MD 2465's outline (37.946, -90.536):
     fresh visit (Auto): the MD is not one of the site's alerts, doesn't make Auto turn on Severe storms, and is not in the lead
       or the alert strip;
     Severe storms on by hand: the MD is found and listed as a discussion that includes the venue; the headline doesn't call it a
       warning and doesn't also say no MD covers the venue.
   Usage: node tools/threats-md-topic-check.js https://<host> [outDir] */
"use strict";
/* raw.githack shows its "External Content Notice" first: click "Open the page", as a visitor does */
const passNotice = async (pg) => { if (/External Content Notice/.test(await pg.title().catch(() => ""))) { await pg.getByText("Open the page", { exact: false }).first().click(); await pg.waitForLoadState("domcontentloaded"); } };
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/md-topic-check");
if (!HOST) { console.error("usage: node tools/threats-md-topic-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
/* the saved answer, with its "Active Till" moved to 3 hours from now so the replayed MD is current whenever the check runs */
const till = new Date(Date.now() + 3 * 3600e3), HHMM = String(till.getUTCHours()).padStart(2, "0") + String(till.getUTCMinutes()).padStart(2, "0");
const FIX = fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "threats", "spc-md-service-2465-20261125.json"), "utf8").replace(/Active Till \d{4} UTC/, "Active Till " + HHMM + " UTC");
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 1200))); };

(async () => {
  const b = await chromium.launch();
  for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
    const ctx = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(), errs = []; let served = 0;
    p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/spc_mesoscale_discussion\/MapServer\/0\/query/, (r) => { served++; r.fulfill({ status: 200, headers: { "content-type": "application/geo+json", "access-control-allow-origin": "*" }, body: FIX }); });
    await p.route(/spc\.noaa\.gov\/products\/md\//, (r) => r.abort()); // SPC's text unreachable, as from a browser: the map service is used
    await p.goto(HOST + "/threats.html?layers=severe&scope=national&view=active&testreplay=md-topic", { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
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
        && new RegExp("^Until .* " + HHMM + "Z · start unavailable from the map service$").test(det.valid) && det.link,
      { det, md });
    check(`(${d}) no script errors; the replay is marked TEST REPLAY`, !errs.length && (await p.evaluate(() => document.getElementById("txBadge").textContent)) === "TEST REPLAY", { errs });
    await ctx.close();

    /* a venue inside the MD */
    const IN = "lat=37.946&lon=-90.536&name=" + encodeURIComponent("Ste. Genevieve test site");
    const visit = async (q) => { const c = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } }), pg = await c.newPage(), e = [];
      pg.on("pageerror", (x) => e.push(x.message));
      await pg.route(/spc_mesoscale_discussion\/MapServer\/0\/query/, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/geo+json", "access-control-allow-origin": "*" }, body: FIX }));
      await pg.route(/spc\.noaa\.gov\/products\/md\//, (r) => r.abort());
      await pg.goto(HOST + "/threats.html?" + IN + q + "&testreplay=md-topic", { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(pg);
      await pg.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.liveReady, null, { timeout: 90000 }).catch(() => {});
      return { c, pg, e }; };
    const siteRead = (pg) => pg.evaluate(() => { const T = window.__threats, A = T.siteAssess(), head = document.querySelector(".px-olhead"), strip = document.querySelector(".px-sitealerts"), brief = document.querySelector(".px-brief");
      return { auto: T.S.auto, sum: document.getElementById("txLayersSum").textContent, need: A && A.need, cause: A && A.cause, atKinds: A ? A.at.map((x) => x.p.kind + ":" + x.p.event) : null,
        mdLoaded: T.data.products.filter((x) => x.kind === "md").map((x) => x.title), lead: head ? head.innerText.replace(/\s+/g, " ") : "", strip: strip ? strip.innerText.replace(/\s+/g, " ") : "",
        brief: brief ? brief.innerText.replace(/\s+/g, " ") : "", peek: document.getElementById("txPeek1").textContent + " / " + document.getElementById("txPeek2").textContent }; });
    { const { c, pg, e } = await visit(""); await pg.waitForFunction(() => window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {}); await pg.waitForTimeout(4000);
      const s1 = await siteRead(pg); await pg.screenshot({ path: path.join(OUT, `md-inside-auto-${d}.png`) });
      const mdWord = /Mesoscale|\bMD \d/;
      check(`(${d}) venue inside MD 2465, fresh visit: '${s1.sum}'; site alerts [${(s1.atKinds || []).join(", ") || "none"}]; severe need ${s1.need && s1.need.severe} (${JSON.stringify(s1.cause && s1.cause.severe) || "-"}); lead '${s1.lead.slice(0, 80)}'`,
        s1.auto && s1.atKinds && !s1.atKinds.some((k) => /^md:/.test(k)) && (!s1.need.severe || !mdWord.test(JSON.stringify(s1.cause.severe || ""))) && (s1.need.severe || !/Severe storms/.test(s1.sum))
          && !mdWord.test(s1.lead) && !mdWord.test(s1.strip) && !mdWord.test(s1.peek) && !e.length, { s1, e });
      await c.close(); }
    { const { c, pg, e } = await visit("&layers=severe&view=active&scope=venue"); await pg.waitForFunction(() => window.__threats.data.products.some((x) => x.kind === "md"), null, { timeout: 60000 }).catch(() => {}); await pg.waitForTimeout(3000);
      if (phone) { await pg.locator("#txPeek").click().catch(() => {}); await pg.waitForTimeout(800); }
      const s2 = await siteRead(pg); await pg.screenshot({ path: path.join(OUT, `md-inside-manual-${d}.png`) });
      const hidden = (s2.atKinds || []).filter((k) => /^warning:/.test(k) && !/Tornado|Severe Thunderstorm/.test(k));
      check(`(${d}) a warning on a hidden layer covers the test site (${hidden.join(", ") || "none live now"}), while only Severe storms is on`, hidden.length > 0, { s2 });
      check(`(${d}) Severe storms on by hand: MD found (${s2.mdLoaded.join(", ")}); venue block '${s2.brief.slice(0, 230)}'; still not a site alert; severe need ${s2.need && s2.need.severe}`,
        s2.mdLoaded.length > 0 && /^AT .*? No active severe storm alerts at the venue /.test(s2.brief) && /Mesoscale Discussion 2465 \(topic unavailable\): discussion area includes the venue/.test(s2.brief) && !/no SPC Mesoscale Discussion covers it/.test(s2.brief)
          && !/MD 2465.* in effect at the venue/i.test(s2.brief) && s2.atKinds && !s2.atKinds.some((k) => /^md:/.test(k)) && (!s2.need.severe || !/Mesoscale|\bMD \d/.test(JSON.stringify(s2.cause.severe || ""))) && !e.length, { s2, e });
      await c.close(); }
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, "md-topic-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
