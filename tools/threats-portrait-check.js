/* Threats page layout on phones and desktop: is the rest of Forecast Ops reachable, and how much map is left?
   For each size (360 and 390 portrait, a landscape phone, desktop) it measures and screenshots, on the live page at CVG:
     site nav: how many of the other pages' links are visible and tappable without opening anything first;
     map: the share of the map area not covered by controls, the header, the demo bar or the collapsed sheet (a 24x40 grid of
       points, each tested with elementFromPoint);
     controls: each overlay's height;
     sheet: tapping the collapsed sheet opens it and its toggle closes it again (phones);
     no horizontal page scroll; no script errors.
   Usage: node tools/threats-portrait-check.js <base URL ending in /> [outDir] [--before]
   With --before it only measures and screenshots (the starting point); otherwise it also checks the targets:
     all site-nav links reachable without opening a menu; at least 60% of the map uncovered in portrait; the sheet opens and closes. */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2], OUT = path.resolve(process.argv[3] || "docs/threats/portrait-check"), BEFORE = process.argv.includes("--before");
/* --scenario quiet | overlap: sample data instead of live feeds (overlap has warnings in effect at the venue); --nav: also the
   navigation run from the CVG Model Blend link */
const SCEN = (process.argv.find((a) => a.startsWith("--scenario=")) || "").split("=")[1] || null, NAV = process.argv.includes("--nav");
const TAG = (BEFORE ? "before" : "after") + (SCEN ? "-" + SCEN : "");
if (!BASE) { console.error("usage: node tools/threats-portrait-check.js <base URL ending in /> [outDir] [--before]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const CVG = "lat=39.0446&lon=-84.6723&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky");
const SIZES = [
  ["360-portrait", { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true],
  ["375-portrait", { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true],
  ["390-portrait", { ...devices["iPhone 13"] }, true],
  ["landscape", { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, false],
  ["desktop", { viewport: { width: 1440, height: 900 } }, false],
];
const passNotice = async (p) => { if (/External Content Notice/.test(await p.title().catch(() => ""))) { await p.getByText("Open the page", { exact: false }).first().click(); await p.waitForLoadState("domcontentloaded"); } };

(async () => {
  const b = await chromium.launch(), summary = {};
  for (const [name, ctxOpt, portrait] of SIZES) {
    const ctx = await b.newContext(ctxOpt), p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "threats.html?" + (SCEN ? "scenario=" + SCEN + (SCEN === "overlap" ? "&view=active" : "") : CVG), { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
    await p.waitForFunction((scen) => window.__threats && window.__threats.ready && (scen || (window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state))), SCEN, { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(3500);
    const m = await p.evaluate(() => {
      const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.top < innerHeight; };
      const others = [...document.querySelectorAll(".navbar a[href]")].filter((a) => !/threats\.html/.test(a.getAttribute("href")));
      const shown = others.filter((a) => { if (!vis(a)) return false; const r = a.getBoundingClientRect(), x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = r.top + r.height / 2, hit = document.elementFromPoint(x, y); return hit && (hit === a || a.contains(hit)); });
      const map = document.querySelector(".tx-mapwrap").getBoundingClientRect(), top = Math.max(map.top, 0), bottom = Math.min(map.bottom, innerHeight);
      let free = 0, total = 0; for (let i = 0; i < 24; i++) for (let j = 0; j < 40; j++) { const x = map.left + (i + 0.5) * map.width / 24, y = top + (j + 0.5) * (bottom - top) / 40; total++; const hit = document.elementFromPoint(x, y); if (hit && hit.tagName === "CANVAS") free++; }
      const h = (sel) => { const e = document.querySelector(sel); return vis(e) ? Math.round(e.getBoundingClientRect().height) : 0; };
      return { navTotal: others.length, navShown: shown.length, navLabels: shown.map((a) => a.textContent.trim()), mapFree: Math.round(100 * free / total), screenMapFree: Math.round(100 * free / total * (bottom - top) / innerHeight),
        heights: { header: h(".statusbar"), nav: h(".navbar"), demo: h("#txDemo"), top: h("#txTop"), valid: h("#txValid"), chips: h("#txChips"), legend: h("#txLegend"), sheet: h("#txPanel") },
        peek1: (document.getElementById("txPeek1") || {}).textContent || "", peekPanel: (document.getElementById("txPanel") || {}).dataset ? document.getElementById("txPanel").dataset.sheet : null,
        menuBtn: !!document.querySelector(".tx-menu") && vis(document.querySelector(".tx-menu")), hscroll: document.documentElement.scrollWidth > innerWidth + 1, sheet: (document.getElementById("txPanel") || {}).dataset ? document.getElementById("txPanel").dataset.sheet : null };
    });
    await p.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`) });
    let sheetOk = null;
    if (portrait) {
      await p.locator("#txPeek").click().catch(() => {}); await p.waitForTimeout(700);
      const opened = await p.evaluate(() => document.getElementById("txPanel").dataset.sheet);
      await p.screenshot({ path: path.join(OUT, `${TAG}-${name}-sheet-open.png`) });
      await p.locator("#txSheetBtn").click().catch(() => {}); await p.waitForTimeout(700);
      const closed = await p.evaluate(() => document.getElementById("txPanel").dataset.sheet);
      sheetOk = { start: m.sheet, opened, closed, ok: m.sheet === "peek" && opened !== "peek" && closed === "peek" };
    }
    summary[name] = { ...m, sheetOk, errs };
    console.log(`${name}${SCEN ? " [" + SCEN + "]" : ""}: collapsed sheet '${m.peek1.slice(0, 70)}'; site nav ${m.navShown}/${m.navTotal} reachable without opening anything (${m.navLabels.join(", ") || "none"}); map ${m.mapFree}% of its area uncovered (${m.screenMapFree}% of the screen); heights ${JSON.stringify(m.heights)}${sheetOk ? "; sheet " + sheetOk.start + " → " + sheetOk.opened + " → " + sheetOk.closed : ""}`);
    if (!BEFORE) {
      check(`(${name}) every other page is reachable from Threats without opening a menu or going back (${m.navShown}/${m.navTotal})`, m.navTotal >= 7 && m.navShown === m.navTotal, { m });
      if (portrait) {
        check(`(${name}) at least 60% of the map is uncovered (${m.mapFree}%)`, m.mapFree >= 60, { m });
        if (SCEN === "overlap") check(`(${name}) an active warning leads the collapsed sheet: '${m.peek1.slice(0, 80)}'`, /Warning/.test(m.peek1), { m });
        check(`(${name}) the bottom sheet opens and closes as before (${sheetOk.start} → ${sheetOk.opened} → ${sheetOk.closed})`, sheetOk.ok, { sheetOk });
      }
      check(`(${name}) no horizontal page scroll; no script errors`, !m.hscroll && !errs.length, { hscroll: m.hscroll, errs });
    }
    await ctx.close();
  }
  if (NAV) for (const [name, ctxOpt] of SIZES.filter((x) => x[2])) {
    /* from the CVG Model Blend link, tap Threats, then each of the other pages, without Back; the location is carried where the page supports it */
    const ctx = await b.newContext(ctxOpt), p = await ctx.newPage(), seen = [];
    await p.goto(BASE + "blend.html?lat=39.04456&lon=-84.67229&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky"), { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
    await p.waitForSelector('.navbar a[data-nav="threats"]', { timeout: 30000 }); await p.waitForTimeout(1500);
    await p.locator('.navbar a[data-nav="threats"]').first().tap().catch(() => p.locator('.navbar a[data-nav="threats"]').first().click());
    await p.waitForURL(/\/threats(\.html)?(\?|$)/, { timeout: 30000, waitUntil: "domcontentloaded" }); /* Cloudflare Pages serves threats.html at /threats */ await p.waitForSelector(".navbar a[data-nav]", { timeout: 30000 }); await p.waitForTimeout(2500);
    seen.push({ page: "threats", url: p.url() });
    await p.screenshot({ path: path.join(OUT, `${TAG}-nav-from-blend-${name}.png`) });
    for (const id of ["home", "blend", "maps", "events"]) {
      const a = p.locator(`.navbar a[data-nav="${id}"]`).first(); const visible = await a.isVisible().catch(() => false);
      const href = visible ? await a.getAttribute("href") : null; seen.push({ page: id, visible, href });
      check(`(${name}) from Threats (reached from the CVG Model Blend link), ${id} is one tap away without Back: ${visible ? "shown" : "NOT shown"}; link ${href}`, visible && !!href, { seen });
    }
    const thr = new URL(seen[0].url), carried = (h) => /lat=39\.04/.test(h || "") && /lon=-84\.67/.test(h || "");
    check(`(${name}) the CVG location is kept: Threats ${carried(thr.search) ? "opened at CVG" : "NOT at CVG"}; Overview ${carried(seen[1].href) ? "carries it" : "doesn't"}, Model Blend ${carried(seen[2].href) ? "carries it" : "doesn't"}; Maps and Events open their own views (by design: Tri-State HRRR map, events carry their venue)`,
      carried(thr.search) && carried(seen[1].href) && carried(seen[2].href), { seen });
    await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, `${TAG}-portrait-check.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), summary, results }, null, 1));
  if (!BEFORE) { console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0); }
})().catch((e) => { console.error(e); process.exit(1); });
