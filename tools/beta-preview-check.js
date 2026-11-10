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
    await p.locator(".bx-mapframe iframe").scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForFunction(() => { const f = document.querySelector(".bx-mapframe iframe"); return f && f.contentWindow && f.contentWindow.MapEmbed && f.contentWindow.MapEmbed.state().ready; }, null, { timeout: 60000 }).catch(() => errors.push("map did not load"));
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(5000);
    const info = await p.evaluate(() => ({ title: document.title, h1: (document.querySelector("h1") || {}).textContent || "", guard: !!document.getElementById("loadGuard"), err: !!document.querySelector(".bx-err"),
      hscroll: document.documentElement.scrollWidth > innerWidth + 1, verifyLinks: document.querySelectorAll('a[href*="verify"]').length, signin: /sign in|log in/i.test(document.body.innerText) }));
    const fresh = !stamp || (await p.content()).includes(stamp); // after any host notice
    const ok = status === 200 && !info.guard && !info.err && !info.hscroll && !info.verifyLinks && !info.signin && fresh && !errors.length;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${tag} ${dev}: HTTP ${status}${notice ? ", host notice clicked through" : ", no host notice"}, "${info.h1}"${fresh ? "" : " (preview host still serving an older build)"}${errors.length ? " errors: " + errors.join("; ") : ""}${info.hscroll ? " horizontal scroll" : ""}${info.verifyLinks ? " verification link present" : ""}`);
    /* the first screen as a colleague sees it, then the whole page */
    await p.screenshot({ path: `${out}/${tag}-${dev}.png` });
    await p.screenshot({ path: `${out}/${tag}-${dev}-full.png`, fullPage: true });
    await ctx.close();
  }

  /* ---------- scenario checks (the three things to verify before sharing) ---------- */
  const open = async (opts, page, init) => {
    const ctx = await browser.newContext(opts); if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + page, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (await p.getByText("Open the page", { exact: true }).count()) { await p.getByText("Open the page", { exact: true }).first().click(); await p.waitForLoadState("domcontentloaded"); }
    await p.waitForFunction(() => document.querySelector("#timeline svg"), null, { timeout: 90000 });
    await p.locator(".bx-mapframe iframe").scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForFunction(() => { const m = document.querySelector(".bx-mapwrap"); return m && m.dataset.ready === "true" && m.dataset.mapValid; }, null, { timeout: 90000 });
    await p.waitForTimeout(1500); return { ctx, p, errors };
  };
  const times = (p) => p.evaluate(() => { const m = document.querySelector(".bx-mapwrap"), t = document.getElementById("timeline");
    return { page: +document.body.dataset.selected, chart: +t.dataset.selected, map: +m.dataset.mapValid, range: m.dataset.range, flag: document.getElementById("mpFlag").hidden ? null : document.getElementById("mpFlag").innerText.replace(/\s+/g, " "), note: document.getElementById("mpNote").hidden ? null : document.getElementById("mpNote").innerText.replace(/\s+/g, " ") }; });
  const iso = (ms) => (ms ? new Date(ms).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—");
  const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`); };
  const same = (t) => t.page === t.chart && (t.range !== "in" || t.page === t.map);

  /* 1. meteorologist desktop: hour click, map step and playback keep chart and map on one valid time */
  { const { ctx, p, errors } = await open(DEVICES[0][1], "meteorologist-beta.html");
    const box = await p.locator("#timeline svg").boundingBox();
    await p.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3); await p.waitForTimeout(1500);
    let t = await times(p); report(same(t) && t.range === "in", "met: click an hour", `page ${iso(t.page)} · chart ${iso(t.chart)} · map ${iso(t.map)} (${t.range})`);
    const before = t.page; await p.click("#mpNext"); await p.waitForTimeout(1500);
    t = await times(p); report(same(t) && t.page === before + 3600e3, "met: step the map one hour", `page ${iso(t.page)} · chart ${iso(t.chart)} · map ${iso(t.map)}`);
    await p.click("#mpPlay"); await p.waitForTimeout(2600); const mid = await times(p); await p.click("#mpPlay"); await p.waitForTimeout(1200);
    t = await times(p); report(same(t) && mid.page > before + 3600e3 && t.page >= mid.page, "met: play then pause", `advanced to ${iso(mid.page)}; paused at page ${iso(t.page)} · chart ${iso(t.chart)} · map ${iso(t.map)}`);
    report(!errors.length, "met: no script errors", errors.join("; ") || "none"); await ctx.close(); }

  /* 2. event phone first screen: what, when, when to check; strip fits; rain chances in 5-point steps */
  { const { ctx, p, errors } = await open(DEVICES[1][1], "event-beta.html");
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(500);
    const r = await p.evaluate(() => { const vh = innerHeight, b = (el) => el && el.getBoundingClientRect(), keys = [...document.querySelectorAll("#keys dt")].map((d) => d.textContent);
      const dd = [...document.querySelectorAll("#keys dd")], bar = document.querySelector(".sch-bar"), ticks = [...document.querySelectorAll(".sch-ticks span")].map((x) => b(x));
      const pcts = [...document.querySelectorAll("#keys, #phases")].flatMap((el) => [...el.innerText.matchAll(/(\d{1,3})%/g)].map((m) => +m[1]));
      return { decision: document.getElementById("decision").innerText, keys, nextBottom: dd.length ? b(dd[dd.length - 1]).bottom : 9999, vh,
        barFits: bar && bar.scrollWidth <= bar.clientWidth + 1 && b(bar).right <= innerWidth + 0.5 && b(bar).left >= 0, ticksFit: ticks.every((t) => t.left >= -0.5 && t.right <= innerWidth + 0.5), pcts }; });
    report(/^(Plan for|Watch for|Expect|No weather concern)/.test(r.decision), "event: decision sentence first", JSON.stringify(r.decision));
    report(r.keys.length === 3 && r.keys[2] === "Next check" && r.nextBottom <= r.vh, "event: what / when / next check on the first screen", `${r.keys.join(" · ")}; last line ends at ${Math.round(r.nextBottom)} of ${r.vh} px`);
    report(r.barFits && r.ticksFit, "event: phase strip fits the phone width", `bar ${r.barFits ? "fits" : "overflows"}, labels ${r.ticksFit ? "fit" : "overflow"}`);
    report(r.pcts.length > 0 && r.pcts.every((x) => x % 5 === 0), "event: precipitation chances in 5-point steps", r.pcts.join("%, ") + "%");
    await p.screenshot({ path: `${out}/check-event-first-screen.png` });
    report(!errors.length, "event: no script errors", errors.join("; ") || "none"); await ctx.close(); }

  /* 3. out-of-range event: an event six days out, beyond every HRRR run */
  { const day = new Date(Date.now() + 6 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const ev = { id: "beta", name: "Out-of-range test", loc: { name: "Sawyer Point, Cincinnati, OH", lat: 39.0966, lon: -84.4996 }, tz: "America/New_York", times: { start: `${day}T17:00`, end: `${day}T22:00` }, gust: 25 };
    const { ctx, p, errors } = await open(DEVICES[1][1], "event-beta.html", `try { localStorage.setItem("beta_event_v1", ${JSON.stringify(JSON.stringify(ev))}); } catch (e) {}`);
    const t = await times(p);
    report(t.range === "beyond" && t.map < t.page && /Last HRRR hour/.test(t.flag || "") && /coverage ends/.test(t.note || ""), "event: out-of-range map is labelled", `selected ${iso(t.page)} · map ${iso(t.map)} · flag "${t.flag}" · note "${(t.note || "").slice(0, 110)}…"`);
    await p.locator(".bx-mapwrap").screenshot({ path: `${out}/check-out-of-range-map.png` });
    report(!errors.length, "out-of-range: no script errors", errors.join("; ") || "none"); await ctx.close(); }


  /* ---------- markets: Cincinnati, Indianapolis, Denver (city search, NWS office, local time, links, map gating) ---------- */
  const go = async (opts, url, init) => {
    const ctx = await browser.newContext(opts); if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (await p.getByText("Open the page", { exact: true }).count()) { await p.getByText("Open the page", { exact: true }).first().click(); await p.waitForLoadState("domcontentloaded"); }
    return { ctx, p, errors };
  };
  const loaded = (p, name) => p.waitForFunction((n) => (document.body.dataset.loaded || "").startsWith(n), name, { timeout: 120000 }).then(() => p.waitForTimeout(1200));
  const ds = (p) => p.evaluate(() => ({ ...document.body.dataset, nws: (document.getElementById("nws") || document.getElementById("nwsEv") || {}).innerText || "", blend: (document.getElementById("blendLine") || {}).innerText || "",
    map: document.getElementById("map").innerText, mapFrame: !!document.querySelector("#map iframe"), timeline: !!document.querySelector("#timeline svg"), when: (document.getElementById("evWhen") || {}).innerText || "" }));
  const pickCity = async (p, query, label) => {
    await p.click(".bx-head .bx-ppin"); await p.keyboard.type(query);
    await p.waitForFunction((l) => [...document.querySelectorAll(".bx-head .bx-ppres button")].some((b) => b.innerText.startsWith(l)), label, { timeout: 30000 });
    return async () => p.evaluate((l) => [...document.querySelectorAll(".bx-head .bx-ppres button")].find((b) => b.innerText.startsWith(l)).dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), label); };

  /* Cincinnati: CVG default */
  { const { ctx, p, errors } = await go(DEVICES[0][1], base + "meteorologist-beta.html"); await loaded(p, "CVG"); const d = await ds(p);
    report(d.office === "ILN" && d.tz === "America/New_York" && d.market === "tuned" && d.mapFrame && /ILN office/i.test(d.nws) && /Cincinnati-tuned/.test(d.blend), "Cincinnati: CVG default, NWS ILN, Eastern time, tuned blend, map", `office ${d.office} · ${d.tz} · ${d.market} · map ${d.mapFrame}`);
    /* Indianapolis by city search, then a copied link reopened in a fresh browser */
    const choose = await pickCity(p, "Indianapolis", "Indianapolis, IN");
    await p.screenshot({ path: `${out}/city-search.png` });
    await choose(); await loaded(p, "Indianapolis"); const i = await ds(p);
    report(i.office === "IND" && /^America\/Indiana\/Indianapolis$/.test(i.tz) && i.market === "default" && /unverified for this market/.test(i.blend) && /IND office/i.test(i.nws) && i.mapFrame && i.timeline,
      "Indianapolis: city search, NWS IND, Indiana time, default blend labelled unverified, map (inside HRRR domain)", `office ${i.office} · ${i.tz} · ${i.market} · map ${i.mapFrame} · ${i.blend.slice(0, 120)}`);
    await p.click(".bx-head .bx-ppcopy"); const link = await p.evaluate(() => document.querySelector(".bx-head #picker").dataset.link);
    report(!errors.length, "Cincinnati → Indianapolis: no script errors", errors.join("; ") || "none"); await ctx.close();
    const fresh = await go(DEVICES[0][1], link); await loaded(fresh.p, "Indianapolis"); const f = await ds(fresh.p);
    report(f.office === "IND" && f.loaded.startsWith("Indianapolis"), "Indianapolis link reopened in a fresh browser", `${link.replace(/^.*\?/, "?")} → ${f.loaded}, office ${f.office}`); await fresh.ctx.close(); }

  /* Denver, meteorologist: NWS BOU, Mountain time, no map, timeline complete */
  { const { ctx, p, errors } = await go(DEVICES[0][1], base + "meteorologist-beta.html?lat=39.7392&lon=-104.9903&name=Denver%2C%20CO"); await loaded(p, "Denver"); const d = await ds(p);
    report(d.office === "BOU" && d.tz === "America/Denver" && !d.mapFrame && /HRRR map available for Cincinnati Tri-State only/.test(d.map) && d.timeline && /unverified/.test(d.blend), "Denver: NWS BOU, Mountain time, out-of-region map message, timeline usable", `office ${d.office} · ${d.tz} · map "${d.map.split("\n")[0]}"`);
    await p.screenshot({ path: `${out}/denver-meteorologist-desktop.png` });
    report(!errors.length, "Denver meteorologist: no script errors", errors.join("; ") || "none"); await ctx.close(); }

  /* Denver event crossing midnight, planned from a browser on Eastern time */
  { const day = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Denver" }), next = new Date(Date.parse(day + "T12:00Z") + 864e5).toISOString().slice(0, 10);
    const ev = { n: "Late show", v: { name: "Red Rocks Amphitheatre", lat: 39.6654, lon: -105.2057 }, z: "America/Denver", t: { setup: `${day}T17:00`, start: `${day}T20:00`, end: `${next}T01:00`, teardown: `${next}T02:30` }, g: 25 };
    const { ctx, p, errors } = await go({ ...DEVICES[1][1], timezoneId: "America/New_York" }, base + "event-beta.html?e=" + encodeURIComponent(JSON.stringify(ev))); await loaded(p, "Red Rocks"); const d = await ds(p);
    const phases = await p.evaluate(() => document.getElementById("phases").innerText);
    report(/8 PM–1 AM MST/.test(d.when) && /Teardown\s+\S+ 1 AM – 2:30 AM/.test(phases) && d.tz === "America/Denver", "Denver overnight event keeps the venue clock (planner on Eastern time)", `${d.when} | ${phases.split("\n").filter((x) => /Event|Teardown/.test(x)).slice(0, 2).join(" | ")}`);
    report(d.office === "BOU" && !d.mapFrame && /Cincinnati Tri-State only/.test(d.map) && d.timeline && (await p.evaluate(() => document.getElementById("decision").innerText)).length > 10, "Denver event: NWS BOU, map message, briefing and timeline usable", `office ${d.office} · decision "${await p.evaluate(() => document.getElementById("decision").innerText)}"`);
    await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: `${out}/denver-event-phone.png` });
    report(!errors.length, "Denver event: no script errors", errors.join("; ") || "none"); await ctx.close(); }

  /* a slow answer for the previous city never overwrites the new one */
  { const { ctx, p, errors } = await go(DEVICES[0][1], base + "meteorologist-beta.html"); await loaded(p, "CVG");
    await ctx.route(/api\.open-meteo\.com\/v1\/forecast.*latitude=39\.76/, async (r) => { await new Promise((ok) => setTimeout(ok, 12000)); r.continue().catch(() => {}); });
    const indy = await pickCity(p, "Indianapolis", "Indianapolis, IN"); await indy(); await p.waitForTimeout(400);
    await p.fill(".bx-head .bx-ppin", ""); const den = await pickCity(p, "Denver", "Denver, CO"); await den(); await loaded(p, "Denver");
    await p.waitForTimeout(15000); const d = await ds(p);
    report(d.loaded.startsWith("Denver") && d.office === "BOU" && d.tz === "America/Denver", "slow Indianapolis response does not overwrite Denver", `after 15 s: ${d.loaded} · ${d.office} · ${d.tz}`);
    report(!errors.length, "city switch: no script errors", errors.join("; ") || "none"); await ctx.close(); }

  /* analytics blocked, or opted out: the betas work and nothing is sent when opted out */
  for (const [mode, init] of [["blocked", 'localStorage.setItem("fo_analytics_endpoint_test","https://collector.invalid/exec")'], ["opted out", 'localStorage.setItem("fo_analytics_endpoint_test","https://collector.invalid/exec");localStorage.setItem("fo_analytics_optout","1")']]) {
    for (const page of ["meteorologist-beta.html", "event-beta.html"]) {
      const ctx = await browser.newContext(DEVICES[1][1]); await ctx.addInitScript(`try{${init}}catch(e){}`); let sent = 0;
      await ctx.route(/collector\.invalid/, (r) => { sent++; r.abort(); });
      const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + page, { waitUntil: "domcontentloaded" }); if (await p.getByText("Open the page", { exact: true }).count()) await p.getByText("Open the page", { exact: true }).first().click();
      await loaded(p, page.startsWith("met") ? "CVG" : "Sawyer"); await p.click("#timeline svg", { position: { x: 120, y: 60 } }).catch(() => {}); await p.evaluate(() => window.BetaAnalytics && window.BetaAnalytics.flush()); await p.waitForTimeout(800);
      const notice = await p.evaluate(() => (document.getElementById("bxPrivacy") || {}).innerText || "");
      report(!errors.length && (mode === "blocked" ? /Turn off/.test(notice) : sent === 0 && /off in this browser/.test(notice)), `analytics ${mode}: ${page.split("-")[0]} works signed out`, `${sent} collector requests${mode === "blocked" ? " (all blocked)" : ""} · notice "${notice.slice(0, 60)}"`);
      await ctx.close(); } }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
