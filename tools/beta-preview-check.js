#!/usr/bin/env node
/* Signed-out check of the public beta preview links, plus screenshots for review.
   Every scenario opens in a fresh browser context (no cookies, no storage, no GitHub session).
   Usage: node tools/beta-preview-check.js <base URL ending in /> <screenshot dir> [expected asset stamp] */
"use strict";
const { chromium, devices } = require("playwright");
const [base, out, stamp] = process.argv.slice(2);
const DESK = { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 }, PHONE = { ...devices["iPhone 13"] };
let failed = 0;
const GEO = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "../tests/fixtures/nominatim/venues.json"), "utf8")).queries;
const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`); };
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—");

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  /* open a page as a signed-out colleague; raw.githack.com shows a one-time notice that they click through */
  const go = async (opts, url, init) => {
    const ctx = await browser.newContext(opts); if (init) await ctx.addInitScript(init);
    await ctx.route(/script\.google\.com\/macros/, (r) => r.abort()); // automated checks never reach the real usage collector
    await ctx.route(/nominatim\.openstreetmap\.org\/search/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(GEO[new URL(r.request().url()).searchParams.get("q")] || []) })); // captured real responses
    const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
    const res = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    let notice = 0;
    if (await p.getByText("Open the page", { exact: true }).count()) { notice = 1; await Promise.all([p.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), p.getByText("Open the page", { exact: true }).first().click()]); }
    await p.waitForFunction(() => document.body && document.querySelector(".workspace, .bx-brief"), null, { timeout: 60000 });
    return { ctx, p, errors, status: res ? res.status() : 0, notice };
  };
  const until = (p, fn, arg, ms = 120000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const menuReady = (p, name) => until(p, (n) => document.body && (document.body.dataset.place || "").startsWith(n) && document.body.dataset.station, name);
  const eventReady = (p, name) => until(p, (n) => document.body && (document.body.dataset.loaded || "").startsWith(n) && document.querySelector("#timeline svg"), name).then((x) => p.waitForTimeout(1200).then(() => x));
  const almanacReady = (p) => until(p, () => document.querySelector("#climCard .climo-title, #climCard .state.unavail, #climCard .state.err") && !/…/.test(document.getElementById("climName").innerText));
  const pickCity = async (p, query, label, scope = "") => {
    const has = () => until(p, ([l, s]) => [...document.querySelectorAll(`${s} .bx-ppres button`)].some((b) => b.innerText.startsWith(l)), [label, scope], 45000);
    for (let attempt = 0; attempt < 2; attempt++) { await p.click(`${scope} .bx-ppin`); await p.fill(`${scope} .bx-ppin`, ""); await p.keyboard.type(query, { delay: 30 }); if (await has()) break; }
    return () => p.evaluate(([l, s]) => { const b = [...document.querySelectorAll(`${s} .bx-ppres button`)].find((x) => x.innerText.startsWith(l)); if (!b) throw new Error(`city search showed no "${l}"`); b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); }, [label, scope]);
  };
  /* each scenario stands alone: a failure is reported and the rest still run */
  const section = async (name, fn) => { try { await fn(); } catch (e) { report(false, name, `stopped: ${String(e.message || e).split("\n")[0]}`); } };
  const pageOk = async (p, errors, status, notice, name) => {
    const info = await p.evaluate(() => ({ guard: !!document.getElementById("loadGuard"), hscroll: document.documentElement.scrollWidth > innerWidth + 1, verifyLinks: /githack\.com$/.test(location.hostname) ? document.querySelectorAll('a[href*="verify"]').length : 0, signin: /sign in|log in/i.test(document.body.innerText) }));
    const fresh = !stamp || /githack/.test(base) === false || (await p.content()).includes(stamp);
    report(status === 200 && !info.guard && !info.hscroll && !info.verifyLinks && !info.signin && fresh && !errors.length, name, `HTTP ${status}${notice ? ", host notice clicked through" : ""}${info.hscroll ? " · horizontal scroll" : ""}${info.verifyLinks ? " · verification link" : ""}${fresh ? "" : " · stale build"}${errors.length ? " · errors: " + errors.join("; ") : ""}`);
  };

  /* ---------- 1. meteorologist menu: CVG default; Charleston → Model Blend → MENU, desktop and phone ---------- */
  await section('1. meteorologist menu: CVG default; Charleston → Model Blend', async () => {
  for (const [dev, opts] of [["desktop", DESK], ["phone", PHONE]]) {
    const { ctx, p, errors, status, notice } = await go(opts, base + "meteorologist-beta.html");
    await menuReady(p, "CVG");
    const d0 = await p.evaluate(() => ({ ...document.body.dataset, lead: document.querySelector(".hubcard.lead h2").innerText, tools: [...document.querySelectorAll("#tools h2")].map((h) => h.innerText), nav: [...document.querySelectorAll(".navbar a")].map((a) => a.innerText.trim()) }));
    report(d0.place.startsWith("CVG") && d0.station === "CVG" && d0.lead === "Model Blend" && d0.tools.join("|") === "Thunder|Severe & Soundings|Winter|Almanac|Model Maps" && d0.nav[0] === "MENU",
      `menu ${dev}: CVG default, Model Blend first, tool cards, shared navigation`, `${d0.place} · climate ${d0.station} · lead ${d0.lead} · ${d0.tools.join(", ")} · nav ${d0.nav.slice(0, 3).join(", ")}…`);
    await pageOk(p, errors, status, notice, `menu ${dev}: loads signed out`);
    await p.screenshot({ path: `${out}/menu-cvg-${dev}.png` });
    const choose = await pickCity(p, "Charleston", "Charleston, WV");
    if (dev === "desktop") await p.screenshot({ path: `${out}/menu-city-search.png` });
    await choose(); await menuReady(p, "Charleston");
    const d1 = await p.evaluate(() => ({ ...document.body.dataset, href: document.querySelector(".lead-main").getAttribute("href") }));
    report(d1.station === "CRW" && /lat=38\.\d+&lon=-81\.\d+/.test(d1.href), `menu ${dev}: Charleston, WV selected; Model Blend link carries it`, `${d1.place} · climate ${d1.station} · ${d1.href}`);
    await p.screenshot({ path: `${out}/menu-charleston-${dev}.png`, fullPage: dev === "phone" });
    const link = await p.evaluate(() => { document.querySelector("#picker .bx-ppcopy").click(); return document.querySelector("#picker").dataset.link; });
    await Promise.all([p.waitForNavigation({ waitUntil: "domcontentloaded" }), p.click(".lead-main")]);
    await until(p, () => document.getElementById("siteName") && /CHARLESTON/.test(document.getElementById("siteName").innerText), null, 30000); await p.waitForTimeout(2500);
    const b = await p.evaluate(() => ({ site: document.getElementById("siteName").innerText, sub: document.getElementById("siteSub").innerText, menu: !!document.getElementById("betaMenuLink") }));
    report(/CHARLESTON/.test(b.site) && b.menu, `menu ${dev}: Model Blend opens for Charleston with a MENU link`, `${b.site} ${b.sub} · MENU ${b.menu}`);
    const nav = await p.evaluate(() => [...document.querySelectorAll(".navbar a[data-nav]")].map((a) => ({ id: a.dataset.nav, q: new URL(a.href).searchParams.get("name") })));
    const navOk = nav.length && nav.every((x) => (x.id === "maps" ? !x.q : x.q === "Charleston, WV"));
    report(navOk, `menu ${dev}: top navigation links carry Charleston (Maps stays Tri-State)`, nav.map((x) => `${x.id}:${x.q || "—"}`).join(" "));
    if (dev === "phone") await p.screenshot({ path: `${out}/blend-charleston-phone.png` });
    await Promise.all([p.waitForNavigation({ waitUntil: "domcontentloaded" }), p.click("#betaMenuLink")]); await menuReady(p, "Charleston");
    const d2 = await p.evaluate(() => ({ ...document.body.dataset, ph: document.querySelector(".bx-ppin").placeholder }));
    report(d2.place.startsWith("Charleston") && d2.ph.startsWith("Charleston"), `menu ${dev}: MENU returns with Charleston still selected`, `${d2.place} · search box shows ${d2.ph}`);
    report(!errors.length, `menu ${dev}: no script errors`, errors.join("; ") || "none"); await ctx.close();
    if (dev === "desktop") { const f = await go(DESK, link); await menuReady(f.p, "Charleston"); const x = await f.p.evaluate(() => document.body.dataset.place);
      report(x.startsWith("Charleston"), "menu: copied Charleston link reopens in a fresh browser", `${link.replace(/^.*\?/, "?")} → ${x}`); await f.ctx.close(); }
  }
  });

  /* ---------- 2. location handoffs from the menu (Charleston) ---------- */
  await section('2. location handoffs from the menu (Charleston)', async () => {
  { const url = base + "meteorologist-beta.html?lat=38.3498&lon=-81.6326&name=Charleston%2C%20WV";
    for (const [tool, label] of [["thunder", "Thunder"], ["soundings", "Severe & Soundings"], ["winter", "Winter"]]) {
      const { ctx, p, errors } = await go(DESK, url); await menuReady(p, "Charleston");
      await Promise.all([p.waitForNavigation({ waitUntil: "domcontentloaded" }), p.click(`#tools a[data-tool="${tool}"]`)]);
      await until(p, () => document.getElementById("siteName") && document.getElementById("siteName").innerText !== "—", null, 30000);
      const x = await p.evaluate(() => ({ site: document.getElementById("siteName").innerText, menu: !!document.getElementById("betaMenuLink"), q: location.search }));
      report(/CHARLESTON/.test(x.site) && x.menu && !errors.length, `handoff: ${label} opens for Charleston, MENU available`, `${x.site} · ${x.q}${errors.length ? " · " + errors.join("; ") : ""}`); await ctx.close(); }
    const { ctx, p, errors } = await go(DESK, url); await menuReady(p, "Charleston");
    await Promise.all([p.waitForNavigation({ waitUntil: "domcontentloaded" }), p.click('#tools a[data-tool="almanac"]')]); await almanacReady(p);
    const a = await p.evaluate(() => ({ astro: document.getElementById("astroName").innerText, clim: document.getElementById("climName").innerText }));
    report(/Charleston/.test(a.astro) && /CRW/.test(a.clim) && !errors.length, "handoff: Almanac opens for Charleston (sun and moon at the point, climate at CRW)", `${a.astro} · ${a.clim}`); await ctx.close(); }
  });

  /* ---------- 3. Almanac climate stations (live NWS + RCC-ACIS) ---------- */
  await section('3. Almanac climate stations (live NWS + RCC-ACIS)', async () => {
  for (const [name, lat, lon, want] of [["CVG airport, Cincinnati/Northern Kentucky", 39.04456, -84.67229, { stn: "CVG", rec: "CVGthr", office: "ILN" }], ["Indianapolis, IN", 39.7684, -86.1581, { stn: "IND", rec: "INDthr", office: "IND" }],
    ["Muncie, IN", 40.1934, -85.3864, { stn: "MIE", rec: null, office: "IND" }], ["Denver, CO", 39.7392, -104.9903, { stn: "DEN", rec: "DENthr", office: "BOU" }]]) {
    const { ctx, p, errors } = await go(DESK, `${base}almanac.html?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`); await almanacReady(p);
    const a = await p.evaluate(() => ({ astro: document.getElementById("astroName").innerText, clim: document.getElementById("climName").innerText, meta: document.getElementById("climMeta").innerText,
      title: (document.querySelector("#climCard .climo-title .kick") || {}).innerText || "", sheet: !!document.querySelector("#climCard .climo-title"), history: !document.getElementById("weatherHistoryCard").hidden }));
    const okRec = want.rec ? a.meta.includes(`(${want.rec})`) : /station record since \d{4}/.test(a.meta) && /no threaded city record/.test(a.meta);
    report(a.clim.endsWith("· " + want.stn) && a.meta.includes(`NWS ${want.office} climate site`) && okRec && a.astro === name && a.sheet && (want.stn === "CVG") === a.history && !errors.length,
      `almanac: ${name.split(",")[0]} → ${want.stn}${want.rec ? " / " + want.rec : " (no threaded record)"}, NWS ${want.office}, sun and moon at the point`, `${a.clim} · ${a.meta.slice(0, 150)} · astronomy "${a.astro}" · local history ${a.history ? "shown" : "hidden"}`);
    if (want.stn === "MIE") {
      await p.screenshot({ path: `${out}/almanac-muncie.png` });
      await p.selectOption("#climStn", "IND"); await until(p, () => /· IND$/.test(document.getElementById("climName").innerText) && document.querySelector("#climCard .climo-title") && /IND/.test(document.querySelector("#climCard .climo-title .kick").innerText));
      const o = await p.evaluate(() => ({ clim: document.getElementById("climName").innerText, astro: document.getElementById("astroName").innerText, q: new URLSearchParams(location.search).get("name") }));
      report(/IND$/.test(o.clim) && o.astro === "Muncie, IN" && o.q === "Muncie, IN", "almanac: changing the climate station keeps the forecast point", `climate ${o.clim} · point ${o.q} · astronomy ${o.astro}`);
    }
    await ctx.close(); }
  });

  /* ---------- 4. record watch on Model Blend follows the point's station ---------- */
  await section("4. record watch on Model Blend follows the point's station", async () => {
  { const { ctx, p, errors } = await go(DESK, `${base}blend.html?lat=39.7684&lon=-86.1581&name=Indianapolis%2C%20IN`);
    const ok = await until(p, () => /INDthr/.test((document.getElementById("dailyNote") || {}).textContent || ""), null, 150000);
    const note = await p.evaluate(() => ((document.getElementById("dailyNote") || {}).textContent || "").match(/Record watch:[^.]*\./));
    report(ok && !errors.length, "Model Blend: record watch uses the Indianapolis threaded record", note ? note[0] : "record-watch note not shown"); await ctx.close(); }
  });

  /* ---------- 5. event beta: page loads, Cincinnati map/timeline sync, first screen, out-of-range map ---------- */
  /* ---------- 3b. Almanac: the selected date drives the climate report (viewer in another time zone) ---------- */
  await section('3b. Almanac date agreement', async () => {
    const out3 = [];
    for (const [q, label] of [["lat=39.0446&lon=-84.6723&name=CVG%20airport%2C%20Cincinnati%2FNorthern%20Kentucky", "Cincinnati"], ["lat=39.7392&lon=-104.9903&name=Denver%2C%20CO", "Denver"]]) {
      for (const date of ["", "2026-01-01", "2024-02-29"]) {
        const { ctx, p, errors } = await go({ ...DESK, timezoneId: "Asia/Tokyo" }, base + `almanac.html?${q}${date ? `&date=${date}` : ""}`);
        await until(p, () => document.querySelector("#climCard .climo-title") && document.querySelector("#factCard .wngrid, #factCard .msg"), null, 120000);
        const r = await p.evaluate(() => ({ sel: document.getElementById("almDate").value, head: document.getElementById("sheetTitle").innerText, h2: (document.querySelector("#climCard h2") || {}).innerText || "", cutoff: (document.querySelector("#climCard .climo-context") || { dataset: {} }).dataset.cutoff, tag: (document.querySelector("#climCard .climo-tag") || {}).innerText }));
        const d = new Date(r.sel + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
        out3.push({ ok: r.h2.endsWith(d) && r.head.includes(new Date(r.sel + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" })) && r.cutoff <= r.sel && !errors.length, txt: `${label} ${date || "today"}: ${r.head} / ${r.h2} / ${r.tag} / totals through ${r.cutoff}` });
        await ctx.close();
      }
    }
    report(out3.every((x) => x.ok), "Almanac: heading, climate report date and totals cutoff agree (viewer in Tokyo; today, Jan 1, Feb 29; Cincinnati and Denver)", out3.map((x) => x.txt).join(" | "));
  });
  await section('5. event beta: page loads, Cincinnati map/timeline sync, fir', async () => {
  for (const [dev, opts] of [["desktop", DESK], ["phone", PHONE]]) {
    const { ctx, p, errors, status, notice } = await go(opts, base + "event-beta.html"); await eventReady(p, "Sawyer");
    await pageOk(p, errors, status, notice, `event ${dev}: loads signed out`);
    await p.screenshot({ path: `${out}/event-${dev}.png` }); await ctx.close(); }
  const times = (p) => p.evaluate(() => { const m = document.querySelector(".bx-mapwrap"), t = document.getElementById("timeline");
    return { page: +document.body.dataset.selected, chart: +t.dataset.selected, map: +m.dataset.mapValid, range: m.dataset.range, flag: document.getElementById("mpFlag") && !document.getElementById("mpFlag").hidden ? document.getElementById("mpFlag").innerText.replace(/\s+/g, " ") : null, note: document.getElementById("mpNote") && !document.getElementById("mpNote").hidden ? document.getElementById("mpNote").innerText.replace(/\s+/g, " ") : null }; });
  const same = (t) => t.page === t.chart && (t.range !== "in" || t.page === t.map);
  { const { ctx, p, errors } = await go(DESK, base + "event-beta.html");
    /* a burst of guidance requests from the CI machine is occasionally throttled upstream: say what the page showed, reload once */
    if (!(await eventReady(p, "Sawyer"))) { const shown = await p.evaluate(() => (document.getElementById("decision") || {}).textContent || "—"); console.log(`note: Cincinnati event not ready after 2 min (page showed "${shown.trim().slice(0, 80)}"); reloading once`); await p.reload({ waitUntil: "domcontentloaded" }); if (!(await eventReady(p, "Sawyer"))) throw new Error("Cincinnati event did not load after a reload"); }
    await p.locator(".bx-mapframe iframe").scrollIntoViewIfNeeded(); await until(p, () => { const m = document.querySelector(".bx-mapwrap"); return m && m.dataset.ready === "true" && m.dataset.mapValid; }, null, 90000);
    const box = await p.locator("#timeline svg").boundingBox(); await p.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.3); await p.waitForTimeout(1500);
    let t = await times(p); report(same(t), "Cincinnati event: click an hour keeps page, chart and map on one time", `page ${iso(t.page)} · chart ${iso(t.chart)} · map ${iso(t.map)} (${t.range})`);
    await p.click("#mpBack"); await p.waitForTimeout(1500); const before = (await times(p)).page; await p.click("#mpBack"); await p.waitForTimeout(1500);
    t = await times(p); report(same(t) && t.range === "in" && t.page === before - 3600e3, "Cincinnati event: step the map one hour", `page ${iso(t.page)} · chart ${iso(t.chart)} · map ${iso(t.map)}`);
    await p.click("#mpPlay"); await p.waitForTimeout(2600); const mid = await times(p); await p.click("#mpPlay"); await p.waitForTimeout(1200);
    t = await times(p); report(same(t) && t.page !== before - 3600e3 && t.range === "in", "Cincinnati event: play then pause", `paused at page ${iso(t.page)} · chart ${iso(t.chart)} · map ${iso(t.map)} (mid ${iso(mid.page)})`);
    report(!errors.length, "Cincinnati event: no script errors", errors.join("; ") || "none"); await ctx.close(); }
  { const { ctx, p, errors } = await go(PHONE, base + "event-beta.html"); await eventReady(p, "Sawyer");
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(500);
    const r = await p.evaluate(() => { const vh = innerHeight, b = (el) => el && el.getBoundingClientRect(), keys = [...document.querySelectorAll("#keys dt")].map((d) => d.textContent);
      const dd = [...document.querySelectorAll("#keys dd")], bar = document.querySelector(".sch-bar"), ticks = [...document.querySelectorAll(".sch-ticks span")].map((x) => b(x));
      const pcts = [...document.querySelectorAll("#keys, #phases")].flatMap((el) => [...el.innerText.matchAll(/(\d{1,3})%/g)].map((m) => +m[1]));
      return { decision: document.getElementById("decision").innerText, keys, nextBottom: dd.length ? b(dd[dd.length - 1]).bottom : 9999, vh, barFits: bar && bar.scrollWidth <= bar.clientWidth + 1 && b(bar).right <= innerWidth + 0.5 && b(bar).left >= 0, ticksFit: ticks.every((t) => t.left >= -0.5 && t.right <= innerWidth + 0.5), pcts }; });
    report(/^(Plan for|Watch for|Expect|No weather concern)/.test(r.decision) && r.keys.length === 3 && r.keys[2] === "Next check" && r.nextBottom <= r.vh, "event phone: decision, window, timing and next check on the first screen", `"${r.decision}" · ${r.keys.join(" · ")} · ends at ${Math.round(r.nextBottom)} of ${r.vh} px`);
    report(r.barFits && r.ticksFit, "event phone: phase strip fits the width", `bar ${r.barFits ? "fits" : "overflows"}, labels ${r.ticksFit ? "fit" : "overflow"}`);
    report(r.pcts.length > 0 && r.pcts.every((x) => x % 5 === 0), "event phone: precipitation chances in 5-point steps", r.pcts.join("%, ") + "%");
    await p.screenshot({ path: `${out}/check-event-first-screen.png` }); await ctx.close(); }
  { const day = new Date(Date.now() + 5 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // inside the briefing's guidance, beyond HRRR's
    const ev = { n: "Out-of-range test", v: { name: "Sawyer Point, Cincinnati, OH", lat: 39.0966, lon: -84.4996 }, z: "America/New_York", t: { start: `${day}T17:00`, end: `${day}T22:00` }, g: 25 };
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html?e=" + encodeURIComponent(JSON.stringify(ev))); await eventReady(p, "Sawyer");
    await p.locator(".bx-mapframe iframe").scrollIntoViewIfNeeded(); await until(p, () => { const m = document.querySelector(".bx-mapwrap"); return m && m.dataset.ready === "true" && m.dataset.range; }, null, 90000); await p.waitForTimeout(1500);
    const t = await times(p);
    report(t.range === "beyond" && t.map < t.page && /Last HRRR hour/.test(t.flag || "") && /coverage ends|This run ends/.test(t.note || "") && !errors.length, "event: out-of-range map is labelled", `selected ${iso(t.page)} · map ${iso(t.map)} · flag "${t.flag}"`);
    await p.locator(".bx-mapwrap").screenshot({ path: `${out}/check-out-of-range-map.png` }); await ctx.close(); }
  /* an event weeks out (e.g. imported from a calendar): a useful pending screen, not empty cards */
  { const day = new Date(Date.now() + 24 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const ev = { n: "FC Cincinnati home match (test)", v: { name: "TQL Stadium, Cincinnati, OH", lat: 39.1111, lon: -84.5222 }, z: "America/New_York", t: { setup: `${day}T15:00`, gates: `${day}T18:00`, start: `${day}T19:30`, end: `${day}T21:30`, teardown: `${day}T23:30` }, g: 25 };
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html?e=" + encodeURIComponent(JSON.stringify(ev)));
    await until(p, () => document.body.dataset.readiness, null, 90000); await p.waitForTimeout(800);
    const x = await p.evaluate(() => ({ state: document.body.dataset.readiness, dec: document.getElementById("decision").innerText, cov: document.getElementById("coverage").innerText,
      hidden: ["secPhases", "secMap", "secHourly", "secChanges", "secChecks"].every((i) => getComputedStyle(document.getElementById(i)).display === "none"), sched: !!document.querySelector(".sch-bar"),
      remind: [...document.querySelectorAll("[data-remind]")].map((a) => a.dataset.remind).join(","), threshold: /planning threshold/.test(document.body.innerText) }));
    report(x.state === "pending" && /Weather briefing pending/.test(x.dec) && /come into range/.test(x.cov) && /whole event by/.test(x.cov) && x.hidden && x.sched && x.remind === "google,ics" && !x.threshold && !errors.length,
      "event weeks out: pending briefing with schedule, coverage dates and a reminder; empty cards, chart and map collapsed", `${x.dec} · "${x.cov.split("\n")[1] || ""}" · reminders ${x.remind} · sections hidden ${x.hidden}`);
    await p.screenshot({ path: `${out}/event-pending-phone.png`, fullPage: true }); await ctx.close(); }
  });

  /* ---------- 6. event beta in other markets: Indianapolis search, Denver overnight event, slow-response race ---------- */
  await section('6. event beta in other markets: Indianapolis search, Denver ', async () => {
  { const { ctx, p, errors } = await go(DESK, base + "event-beta.html"); await eventReady(p, "Sawyer");
    const choose = await pickCity(p, "Indianapolis", "Indianapolis, IN", ".bx-head"); await choose(); await eventReady(p, "Indianapolis");
    const i = await p.evaluate(() => ({ ...document.body.dataset, nws: document.getElementById("nwsEv").innerText, blend: document.getElementById("blendLine").innerText, map: !!document.querySelector("#map iframe") }));
    report(i.office === "IND" && /^America\/Indiana\/Indianapolis$/.test(i.tz) && i.market === "default" && /unverified for this market/.test(i.blend) && /IND office/i.test(i.nws) && i.map && !errors.length,
      "event: Indianapolis by city search (NWS IND, Indiana time, default blend labelled unverified, map inside HRRR domain)", `office ${i.office} · ${i.tz} · ${i.blend.slice(0, 120)}`);
    await p.screenshot({ path: `${out}/event-indianapolis-desktop.png` }); await ctx.close(); }
  { const day = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Denver" }), next = new Date(Date.parse(day + "T12:00Z") + 864e5).toISOString().slice(0, 10);
    const ev = { n: "Late show", v: { name: "Red Rocks Amphitheatre", lat: 39.6654, lon: -105.2057 }, z: "America/Denver", t: { setup: `${day}T17:00`, start: `${day}T20:00`, end: `${next}T01:00`, teardown: `${next}T02:30` }, g: 25 };
    const { ctx, p, errors } = await go({ ...PHONE, timezoneId: "America/New_York" }, base + "event-beta.html?e=" + encodeURIComponent(JSON.stringify(ev))); await eventReady(p, "Red Rocks");
    const d = await p.evaluate(() => ({ ...document.body.dataset, when: document.getElementById("evWhen").innerText, phases: document.getElementById("phases").innerText, map: document.getElementById("map").innerText, frame: !!document.querySelector("#map iframe") }));
    report(/8 PM–1 AM MST/.test(d.when) && /Teardown\s+\S+ 1 AM – 2:30 AM/.test(d.phases) && d.tz === "America/Denver", "Denver overnight event keeps the venue clock (planner on Eastern time)", `${d.when} | ${d.phases.split("\n").filter((x) => /^(Event|Teardown)/.test(x)).join(" | ")}`);
    report(d.office === "BOU" && !d.frame && /HRRR map available for Cincinnati Tri-State only/.test(d.map) && !errors.length, "Denver event: NWS BOU, out-of-region map message, briefing usable", `office ${d.office} · map "${d.map.split("\n")[0]}"`);
    await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: `${out}/denver-event-phone.png` }); await ctx.close(); }
  { const { ctx, p, errors } = await go(DESK, base + "event-beta.html"); await eventReady(p, "Sawyer");
    await ctx.route(/api\.open-meteo\.com\/v1\/forecast.*latitude=39\.76/, async (r) => { await new Promise((ok) => setTimeout(ok, 12000)); r.continue().catch(() => {}); });
    const indy = await pickCity(p, "Indianapolis", "Indianapolis, IN", ".bx-head"); await indy(); await p.waitForTimeout(400);
    await p.fill(".bx-head .bx-ppin", ""); const den = await pickCity(p, "Denver", "Denver, CO", ".bx-head"); await den(); await eventReady(p, "Denver");
    await p.waitForTimeout(15000); const d = await p.evaluate(() => ({ ...document.body.dataset }));
    report(d.loaded.startsWith("Denver") && d.office === "BOU" && d.tz === "America/Denver" && !errors.length, "slow Indianapolis response never overwrites Denver", `after 15 s: ${d.loaded} · ${d.office} · ${d.tz}`); await ctx.close(); }
  });

  /* ---------- 7. analytics blocked or opted out: the betas work; nothing is sent when opted out ---------- */
  /* ---------- 8. Upcoming events and saved venues on a phone: two TQL matches, venue defaults, one gates override, refresh ---------- */
  await section('8. Upcoming events and saved venues (phone)', async () => {
    const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const d1 = day(2), d2 = day(16);
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html#upcoming");
    await until(p, () => document.querySelector("#upView:not([hidden]) #upAdd"), null, 30000);
    const setVal = (sel, v) => p.evaluate(([s, x]) => { const el = document.querySelector(s); el.value = x; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
    /* match 1: new venue TQL Stadium, its schedule saved as the venue default */
    await p.click("#upAdd"); await until(p, () => document.getElementById("editDlg").open, null, 10000);
    await p.fill("#fName", "FC Cincinnati vs. Test FC (check)"); await p.fill("#fVenue", "TQL Stadium");
    await p.fill("#fCity .vs-q", "TQL Stadium"); await p.click("#fCity .vs-go"); await until(p, () => document.querySelector("#fCity .vs-hit"), null, 20000); await p.click("#fCity .vs-hit");
    await setVal("#fDate", d1); await setVal("#fStart", "19:30"); await setVal("#fEnd", "21:30"); await setVal("#fSetup", "15:00"); await setVal("#fGates", "18:00"); await setVal("#fTear", "23:30"); await setVal("#fGust", "30");
    await p.click("#fSave"); await until(p, () => !document.getElementById("editDlg").open, null, 30000);
    /* match 2: the saved venue fills setup, gates and teardown; gates changed for this match only */
    await until(p, () => document.querySelectorAll(".up-ev").length === 1 && document.querySelectorAll(".up-vn").length === 1, null, 20000);
    await p.click("#upAdd"); await until(p, () => document.getElementById("editDlg").open, null, 10000);
    const sel = await p.evaluate(() => document.querySelector("#fVenueSel").selectedOptions[0].textContent);
    await p.fill("#fName", "FC Cincinnati vs. Second FC (check)"); await setVal("#fDate", d2); await setVal("#fStart", "19:30"); await setVal("#fEnd", "21:30");
    const filled = await p.evaluate(() => ["fSetup", "fGates", "fTear", "fGust"].map((i) => document.getElementById(i).value).join(" "));
    await setVal("#fGates", "17:30");
    const note = await p.evaluate(() => document.getElementById("fDefNote").innerText);
    await p.click("#fSave"); await until(p, () => !document.getElementById("editDlg").open, null, 30000);
    report(sel === "TQL Stadium" && filled === "15:00 18:00 23:30 30" && /Changed for this event: gates/.test(note), "upcoming phone: second match starts from TQL Stadium defaults; gates changed for that match only", `venue "${sel}" · filled ${filled} · "${note.split(".").slice(-3).join(".").trim().slice(0, 80)}"`);
    /* refresh: both matches back, with their own gates and a status each; then open each one */
    await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector("#upView").dataset.ready === "true", null, 150000);
    const rows = await p.evaluate(() => [...document.querySelectorAll("#upList .up-ev")].map((r) => ({ id: r.dataset.id, st: r.dataset.status, txt: r.innerText.replace(/\s+/g, " ") })));
    const ev = await p.evaluate(() => JSON.parse(localStorage.getItem("beta_events_v2")).map((e) => [e.name, e.times.setup.slice(11), e.times.gates.slice(11), e.times.teardown.slice(11), e.overrides.join(",") || "-"]));
    report(rows.length === 2 && ev.length === 2 && ev[0][2] === "18:00" && ev[1][2] === "17:30" && ev[1][4] === "gates" && ev[0][4] === "-" && rows.every((r) => r.st && r.st !== "unknown"),
      "upcoming phone: both matches reopen after refreshing, each with its own gates time and a briefing status", rows.map((r) => `${r.txt.slice(0, 120)} [${r.st}]`).join(" | "));
    await p.screenshot({ path: `${out}/upcoming-phone.png`, fullPage: true });
    const opened = [];
    for (const r of rows) {
      await Promise.all([p.waitForNavigation({ waitUntil: "domcontentloaded" }), p.click(`.up-ev[data-id="${r.id}"] .up-open`)]);
      await until(p, () => document.body.dataset.readiness, null, 150000); await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.body.dataset.readiness, null, 150000);
      opened.push(await p.evaluate(() => ({ name: document.getElementById("evName").innerText, when: document.getElementById("evWhen").innerText, state: document.body.dataset.readiness, q: location.search })));
      await p.goto(base + "event-beta.html#upcoming", { waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector("#upView .up-ev"), null, 30000);
    }
    report(opened.length === 2 && opened.every((o) => /\(check\)/.test(o.name) && /^\?ev=ev_/.test(o.q)) && opened.some((o) => /from 3 PM/.test(o.when)) && !errors.length,
      "upcoming phone: one tap opens each match's briefing, and a refresh keeps it", opened.map((o) => `${o.name} · ${o.when} · ${o.state}`).join(" | ") + (errors.length ? " · " + errors.join("; ") : ""));
    await ctx.close();
  });
  /* ---------- 9. calendar import with the sample calendar (phone): choose events, match saved venues, confirm an unfamiliar one ---------- */
  await section('9. calendar import with sample data (phone)', async () => {
    const venue = { id: "vn_check", name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5222, tz: "America/New_York", defaults: { setup: 270, gates: 90, teardown: 120, gust: 30 } };
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html#upcoming", `localStorage.setItem("beta_venues_v1", ${JSON.stringify(JSON.stringify([venue]))})`);
    const sent = []; await ctx.route(/script\.google\.com\/macros/, (r) => { sent.push(r.request().postData() || ""); r.abort(); });
    await ctx.route(/nominatim\.openstreetmap\.org\/search/, (r) => { const q = new URL(r.request().url()).searchParams.get("q"); r.fulfill({ contentType: "application/json", body: JSON.stringify(q === "ScottsMiracle-Gro Field" ? GEO["Lower.com Field, Columbus, OH"] : []) }); });
    await until(p, () => document.querySelector("#upView:not([hidden]) #upImport"), null, 30000);
    const live = await p.evaluate(() => !!document.getElementById("upImport") && window.CalendarImport.googleAvailable());
    await p.click("#upImport"); await until(p, () => document.getElementById("ciSample"), null, 10000);
    const gate = await p.evaluate(() => ({ google: !!document.getElementById("ciGoogle"), note: document.getElementById("editForm").innerText }));
    await p.click("#ciSample"); await until(p, () => document.getElementById("ciNext"), null, 10000);
    await p.click("#ciNext"); await until(p, () => document.getElementById("ciImport") && document.getElementById("editForm").dataset.resolved === "true", null, 30000);
    const listed = await p.evaluate(() => [...document.querySelectorAll(".ci-ev")].map((e) => ({ t: e.innerText.replace(/\s+/g, " "), on: e.querySelector("[data-pick]").checked, sel: !!e.querySelector("select:not([hidden])") })));
    await p.screenshot({ path: `${out}/calendar-import-phone.png`, fullPage: false });
    await p.evaluate(() => { const r = [...document.querySelectorAll(".ci-ev")].find((e) => /Columbus/.test(e.innerText)); const c = r.querySelector("[data-pick]"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.click("#ciImport"); await until(p, () => !document.getElementById("editDlg").open && document.querySelectorAll("#upList .up-ev").length === 4, null, 30000);
    await until(p, () => document.querySelector("#upView").dataset.ready === "true", null, 150000);
    const rows = await p.evaluate(() => [...document.querySelectorAll("#upList .up-ev")].map((r) => ({ id: r.dataset.id, st: r.dataset.status, t: r.innerText.replace(/\s+/g, " ") })));
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("beta_events_v2")).map((e) => [e.id, e.venueId, e.times.gates ? e.times.gates.slice(11) : "-", e.source.kind]));
    report(!live && !gate.google && /isn't available on this preview link/.test(gate.note) && listed.length === 4 && listed.filter((x) => x.on).length === 3 && listed.filter((x) => x.sel).length === 1
      && stored.length === 4 && stored.filter((x) => x[1] === "vn_check").length === 3 && stored.filter((x) => x[2] === "18:00").length === 2 && stored.some((x) => x[2] === "14:30") && rows.filter((r) => r.st === "venue").length === 1 && stored.every((x) => x[3] === "calendar"),
      "calendar import (sample): Google sign-in off on the preview link; 3 TQL events matched with venue defaults, the away match waits for a venue",
      `${listed.length} listed, ${listed.filter((x) => x.on).length} preselected · stored ${stored.map((x) => `${x[0]}:${x[1] || "no venue"}:${x[2]}`).join(" ")} · statuses ${rows.map((r) => r.st).join(",")}`);
    /* importing again adds nothing */
    await p.click("#upImport"); await p.click("#ciSample"); await until(p, () => document.getElementById("ciNext"), null, 10000); await p.click("#ciNext"); await until(p, () => document.getElementById("ciImport"), null, 10000);
    const marked = await p.evaluate(() => [...document.querySelectorAll(".ci-ev")].filter((e) => /already imported/.test(e.innerText)).length);
    await p.click("#ciImport"); await until(p, () => !document.getElementById("editDlg").open, null, 10000);
    const note = await p.evaluate(() => document.getElementById("upNote").innerText), count = await p.evaluate(() => JSON.parse(localStorage.getItem("beta_events_v2")).length);
    /* confirm the unfamiliar location: Edit, search its city, save it as a venue */
    const vid = rows.find((r) => r.st === "venue").id;
    await p.click(`.up-ev[data-id="${vid}"] [data-edit]`); await until(p, () => document.getElementById("editDlg").open, null, 10000);
    await p.fill("#fCity .vs-q", "ScottsMiracle-Gro Field"); await p.click("#fCity .vs-go"); await until(p, () => document.querySelector("#fCity .vs-hit"), null, 20000); await p.click("#fCity .vs-hit");
    await p.fill("#fVenue", "Lower.com Field"); await p.click("#fSave");
    if (!(await until(p, () => !document.getElementById("editDlg").open, null, 30000))) console.log(`note: editor still open: "${await p.evaluate(() => document.getElementById("fErr").innerText)}" · lat ${await p.inputValue("#fLat")}`);
    await until(p, () => document.querySelector("#upView").dataset.ready === "true", null, 150000);
    const after = await p.evaluate((id) => ({ st: document.querySelector(`.up-ev[data-id="${id}"]`).dataset.status, venues: JSON.parse(localStorage.getItem("beta_venues_v1")).map((v) => v.name) }), vid);
    await p.evaluate(() => window.BetaAnalytics && window.BetaAnalytics.flush()); await p.waitForTimeout(800);
    const leaked = sent.filter((b) => /Sample FC|Example United|Columbus|TQL|Home matches|Venue operations|1501 Central/.test(b));
    report(marked >= 3 && /0 added · 0 updated/.test(note) && count === 4 && after.st !== "venue" && after.venues.includes("Lower.com Field") && !leaked.length && !errors.length,
      "calendar import: re-import adds no duplicates; confirming the away venue enables its briefing; no calendar details in analytics",
      `re-import: "${note}" (${count} events) · away match now ${after.st} · venues ${after.venues.join(", ")} · analytics requests ${sent.length}, with calendar details ${leaked.length}${errors.length ? " · " + errors.join("; ") : ""}`);
    await ctx.close();
  });
  /* ---------- 10. calendar kickoff change: re-import updates in place, keeps the confirmed venue and the planner's gates offset ---------- */
  await section('10. calendar kickoff change and re-import (phone)', async () => {
    const tqlV = { id: "vn_check", name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5222, tz: "America/New_York", defaults: { setup: 270, gates: 90, teardown: 120, gust: 30 } };
    const colV = { id: "vn_col", name: "Columbus away venue", city: "Columbus, OH", lat: 39.9685, lon: -83.0171, tz: "America/New_York", defaults: { setup: 180, gates: 60, teardown: 90, gust: 25 } };
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html#upcoming", `localStorage.setItem("beta_venues_v1", ${JSON.stringify(JSON.stringify([tqlV, colV]))})`);
    await ctx.route(/nominatim\.openstreetmap\.org\/search/, (r) => r.fulfill({ contentType: "application/json", body: "[]" })); // the away venue isn't on the map
    const openSample = async (shift) => {
      if (shift) await p.evaluate(() => { const CI = window.CalendarImport, orig = CI.__orig || CI.sampleProvider; CI.__orig = orig;
        CI.sampleProvider = () => { const sp = orig(); return { ...sp, listEvents: async (id, o) => (await sp.listEvents(id, o)).map((e) => (e.id !== "m1" ? e : { ...e, etag: '"m1-2"',
          start: { ...e.start, dateTime: e.start.dateTime.replace("T19:30", "T20:15") }, end: { ...e.end, dateTime: e.end.dateTime.replace("T21:30", "T22:15") } })) }; }; });
      await p.click("#upImport"); await until(p, () => document.getElementById("ciSample"), null, 10000); await p.click("#ciSample");
      await until(p, () => document.getElementById("ciNext"), null, 10000); await p.click("#ciNext"); await until(p, () => document.getElementById("ciImport"), null, 10000);
    };
    const tick = (re, on) => p.evaluate(([r, v]) => { const row = [...document.querySelectorAll(".ci-ev")].find((e) => new RegExp(r).test(e.innerText)); const c = row.querySelector("[data-pick]"); c.checked = v; c.dispatchEvent(new Event("change", { bubbles: true })); }, [re, on]);
    const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem("beta_events_v2") || "[]").map((e) => ({ id: e.id, name: e.name, venue: e.venueId, start: e.times.start.slice(11), gates: e.times.gates ? e.times.gates.slice(11) : "-", setup: e.times.setup ? e.times.setup.slice(11) : "-", own: (e.overrides || []).join(","), etag: e.source.etag })));
    await until(p, () => document.querySelector("#upView:not([hidden]) #upImport"), null, 30000);
    /* first import: Sample FC (TQL) and the Columbus away match confirmed as Lower.com Field; Example United left unchecked */
    await openSample(false);
    await tick("Example United", false); await tick("Columbus", true);
    await until(p, () => document.getElementById("editForm").dataset.resolved === "true", null, 30000);
    await p.evaluate(() => { const row = [...document.querySelectorAll(".ci-ev")].find((e) => /Columbus/.test(e.innerText)); const s = row.querySelector("[data-saved]"); s.value = "vn_col"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await tick("Test City", false);
    await p.click("#ciImport"); await until(p, () => !document.getElementById("editDlg").open, null, 10000);
    const first = await stored(), note1 = await p.evaluate(() => document.getElementById("upNote").innerText);
    /* planner moves gates for Sample FC to 2 h before kickoff (17:30 for 19:30) */
    const m1 = first.find((e) => e.id === "cal_m1");
    await p.click(`.up-ev[data-id="cal_m1"] [data-edit]`); await until(p, () => document.getElementById("editDlg").open, null, 10000);
    await p.evaluate(() => { const el = document.getElementById("fGates"); el.value = "17:30"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await p.click("#fSave"); await until(p, () => !document.getElementById("editDlg").open, null, 30000);
    /* the calendar moves kickoff to 8:15 PM; re-import the same two events (Example United still unchecked) */
    await openSample(true);
    await tick("Example United", false); await tick("Test City", false); await tick("Columbus", true);
    await p.click("#ciImport"); await until(p, () => !document.getElementById("editDlg").open, null, 10000);
    const note2 = await p.evaluate(() => document.getElementById("upNote").innerText);
    await until(p, () => document.querySelector("#upView").dataset.ready === "true", null, 150000);
    await p.screenshot({ path: `${out}/calendar-reimport-phone.png`, fullPage: false });
    await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector("#upView .up-ev"), null, 30000);
    const after = await stored(), a1 = after.find((e) => e.id === "cal_m1"), a3 = after.find((e) => e.id === "cal_m3");
    const listIds = await p.evaluate(() => [...document.querySelectorAll(".up-ev")].map((r) => r.dataset.id));
    report(first.length === 2 && !first.some((e) => e.id === "cal_m2") && m1 && m1.gates === "18:00" && /2 added · 0 updated/.test(note1) && /0 need venue confirmation/.test(note1),
      "calendar import: only checked events are imported; unchecked Example United stays out; summary counts added, updated and venue confirmations",
      `imported ${first.map((e) => `${e.id}:${e.venue}`).join(" ")} · "${note1.trim()}"`);
    report(after.length === 2 && a1 && a1.start === "20:15" && a1.gates === "18:15" && a1.own === "gates" && a1.venue === "vn_check" && a1.setup === "15:45" && a1.etag === '"m1-2"'
      && a3 && a3.venue === "vn_col" && !listIds.includes("cal_m2") && /0 added · 1 updated/.test(note2) && !errors.length,
      "calendar kickoff change: re-import updates the match in place after a refresh, keeps its confirmed venue and the planner's 2 h gates offset",
      `"${note2.trim()}" · after refresh: Sample FC kickoff ${a1 && a1.start}, gates ${a1 && a1.gates} (${a1 && a1.own} kept), setup ${a1 && a1.setup}, venue ${a1 && a1.venue} · Columbus venue ${a3 && a3.venue} · ${after.length} events${errors.length ? " · " + errors.join("; ") : ""}`);
    await ctx.close();
  });
  /* ---------- 11. city search slow or unavailable: the picker says so and the quick picks still work ---------- */
  await section('11. city search unavailable (phone)', async () => {
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html");
    await eventReady(p, "Sawyer");
    let blocked = 0; await ctx.route(/geocoding-api\.open-meteo\.com/, (r) => { blocked++; r.abort(); });
    await p.click(".bx-head .bx-ppin"); await p.keyboard.type("Cincinnati", { delay: 30 });
    const said = await until(p, () => [...document.querySelectorAll(".bx-head .bx-ppres")].some((x) => !x.hidden && /City search is unavailable/.test(x.innerText)), null, 30000);
    const msg = await p.evaluate(() => (document.querySelector(".bx-head .bx-ppres") || {}).innerText || "");
    await p.fill(".bx-head .bx-ppin", ""); await p.click(".bx-head .bx-ppin");
    const quick = await until(p, () => [...document.querySelectorAll(".bx-head .bx-ppres button")].some((b) => b.innerText.startsWith("Indianapolis, IN")), null, 10000);
    await p.evaluate(() => [...document.querySelectorAll(".bx-head .bx-ppres button")].find((b) => b.innerText.startsWith("Indianapolis, IN")).dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    const loaded = await eventReady(p, "Indianapolis");
    const d = await p.evaluate(() => ({ tz: document.body.dataset.tz, office: document.body.dataset.office }));
    report(said && quick && loaded && blocked > 0 && d.tz === "America/Indiana/Indianapolis" && !errors.length,
      "city search unavailable: the picker says so, and a quick pick still loads the city on its own time zone",
      `${blocked} search requests blocked · "${msg.trim().slice(0, 60)}" · quick pick Indianapolis → ${d.tz}, NWS ${d.office || "—"}${errors.length ? " · " + errors.join("; ") : ""}`);
    await ctx.close();
  });
  /* ---------- 12. Paycor Stadium: two separate imports match automatically; Sunday-night times stay Sunday ---------- */
  await section('12. Paycor imports and calendar times (phone)', async () => {
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html#upcoming");
    await until(p, () => document.querySelector("#upView:not([hidden]) #upImport"), null, 30000);
    /* sample calendar replaced by two Bengals games as Google returns them from a UTC calendar: no event time zone */
    const feed = (events) => p.evaluate((evs) => { const CI = window.CalendarImport, orig = CI.__orig || CI.sampleProvider; CI.__orig = orig;
      CI.sampleProvider = () => ({ kind: "sample", label: "check", listCalendars: async () => [{ id: "bengals", summary: "Bengals (check)", timeZone: "America/New_York" }], listEvents: async () => evs }); }, events);
    const game = (id, location, start, end) => ({ id, etag: `"${id}"`, status: "confirmed", summary: `Bengals game ${id} (check)`, location, start: { dateTime: start }, end: { dateTime: end } });
    const nextSundayUtc = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7) + 1); return d.toISOString().slice(0, 10); })(); // Monday UTC = Sunday night EST
    const run = async (events, shot) => {
      await feed(events); await p.click("#upImport"); await p.click("#ciSample"); await until(p, () => document.getElementById("ciNext"), null, 10000); await p.click("#ciNext"); await until(p, () => document.getElementById("ciImport"), null, 10000);
      const rows = await p.evaluate(() => [...document.querySelectorAll(".ci-ev")].map((r) => ({ match: r.dataset.match, on: r.querySelector("[data-pick]").checked, ask: !!r.querySelector("select:not([hidden])"), when: r.querySelector("[data-when]").innerText, venue: (r.querySelector(".ci-venue b") || {}).innerText || "" })));
      if (shot) await p.screenshot({ path: `${out}/calendar-paycor-phone.png`, fullPage: false });
      await p.click("#ciImport"); await until(p, () => !document.getElementById("editDlg").open, null, 10000);
      return { rows, note: await p.evaluate(() => document.getElementById("upNote").innerText) };
    };
    const a = await run([game("g1", "Paycor Stadium", `${nextSundayUtc}T01:20:00Z`, `${nextSundayUtc}T04:30:00Z`)]);
    const sunday2 = new Date(Date.parse(`${nextSundayUtc}T12:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10); // the following Sunday, 1 PM EST
    const b = await run([game("g2", "1 Paycor Stadium, Cincinnati, OH 45202", `${sunday2}T18:00:00Z`, `${sunday2}T21:00:00Z`)], true);
    await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector("#upView .up-ev"), null, 30000);
    const st = await p.evaluate(() => ({ ev: JSON.parse(localStorage.getItem("beta_events_v2")).map((e) => ({ id: e.id, venue: e.venueId, start: e.times.start, tz: e.tz, src: e.source.start })), venues: JSON.parse(localStorage.getItem("beta_venues_v1") || "[]").map((v) => v.name),
      rows: [...document.querySelectorAll(".up-ev")].map((r) => r.querySelector(".up-when").innerText) }));
    const g1 = st.ev.find((e) => e.id === "cal_g1"), dayName = new Date(Date.parse(`${nextSundayUtc}T01:20:00Z`) - 5 * 36e5).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
    report(a.rows.length === 1 && a.rows[0].match === "matched" && a.rows[0].on && !a.rows[0].ask && /Paycor Stadium/.test(a.rows[0].venue) && /0 need venue confirmation/.test(a.note)
      && b.rows.length === 1 && b.rows[0].match === "matched" && !b.rows[0].ask && /Sun, .* 1 PM/.test(b.rows[0].when) && /0 need venue confirmation/.test(b.note) && st.venues.includes("Paycor Stadium") && !errors.length,
      "Paycor Stadium: two separate imports (name, then full street address) match the venue automatically; neither asks for confirmation",
      `import 1: ${a.rows.map((r) => `${r.venue} · ${r.when}`).join("")} · "${a.note.trim()}" | import 2: ${b.rows.map((r) => `${r.venue} · ${r.when}`).join("")} · "${b.note.trim()}" · saved venues ${st.venues.join(", ")}`);
    report(g1 && g1.tz === "America/New_York" && g1.start.endsWith("T20:20") && dayName === "Sun" && /Sun, .* 8:20 PM/.test(a.rows[0].when) && st.rows.some((t) => /Sun, .*8:20 PM/.test(t)),
      "calendar times: a Sunday 8:20 PM EST game returned in UTC (Monday 01:20Z) imports as Sunday 8:20 PM at the venue, before and after a refresh",
      `calendar ${g1 && g1.src} → venue ${g1 && g1.start} ${g1 && g1.tz} · list "${(st.rows[0] || "").slice(0, 70)}"`);
    await ctx.close();
  });
  /* ---------- 13. venue search on import: name, address-only, same name in two cities, city-only; exact coordinates ---------- */
  await section('13. venue search on calendar import (phone)', async () => {
    const FIX = require("path").join(__dirname, "../tests/fixtures/nominatim/venues.json"), fix = JSON.parse(require("fs").readFileSync(FIX, "utf8")).queries;
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html#upcoming");
    /* every geocoding host counts (public Nominatim, city search and common commercial geocoders) */
    let geo = 0; const GEOHOSTS = /nominatim\.openstreetmap\.org|geocoding-api\.open-meteo\.com|api\.geoapify\.com|geocode|api\.mapbox\.com\/search|maps\.googleapis\.com\/maps\/api\/(geocode|place)|locationiq|opencagedata/;
    await ctx.route(GEOHOSTS, (r) => { geo++; const q = new URL(r.request().url()).searchParams.get("q"); r.fulfill({ contentType: "application/json", body: JSON.stringify(fix[q] || []) }); });
    const tokenSeen = []; p.on("request", (r) => { const u = r.url(); if (/locationiq\.com/.test(u) || /pk\.[0-9a-f]{20,}/.test(u + (r.postData() || ""))) tokenSeen.push(u); });
    const fc = []; await ctx.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => { const u = new URL(r.request().url()); fc.push([+u.searchParams.get("latitude"), +u.searchParams.get("longitude")]); r.continue(); });
    await until(p, () => document.querySelector("#upView:not([hidden]) #upImport"), null, 30000);
    const day = (n, hm) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10) + `T${hm}:00Z`;
    const ev = (id, location, n) => ({ id, etag: `"${id}"`, status: "confirmed", summary: `${id} (check)`, location, start: { dateTime: day(n, "23:00") }, end: { dateTime: day(n + 1, "02:00") } });
    const events = [ev("Riverbend concert", "Riverbend Music Center", 2), ev("Kellogg Ave event", "6295 Kellogg Ave, Cincinnati, OH 45230", 3), ev("Memorial Stadium game", "Memorial Stadium", 4), ev("Downtown meetup", "Cincinnati, OH", 5)];
    await p.evaluate((evs) => { const CI = window.CalendarImport, orig = CI.__orig || CI.sampleProvider; CI.__orig = orig;
      CI.sampleProvider = () => ({ kind: "sample", label: "check", listCalendars: async () => [{ id: "venues", summary: "Venues (check)", timeZone: "America/New_York" }], listEvents: async () => evs }); }, events.map((e) => ({ ...e, id: e.id.replace(/\s/g, "_") })));
    const openImport = async () => { await p.click("#upImport"); await p.click("#ciSample"); await until(p, () => document.getElementById("ciNext"), null, 10000); await p.click("#ciNext"); await until(p, () => document.getElementById("ciImport") && document.getElementById("editForm").dataset.resolved === "true", null, 60000); };
    const rows = () => p.evaluate(() => [...document.querySelectorAll(".ci-ev")].map((r) => ({ match: r.dataset.match, on: r.querySelector("[data-pick]").checked, text: r.querySelector(".ci-venue").innerText.replace(/\s+/g, " ") })));
    await openImport();
    const opened = await rows(), geo0 = geo;
    await p.screenshot({ path: `${out}/venue-review-import-phone.png`, fullPage: false });
    report(geo0 === 0 && opened.every((r) => r.match === "review" && !r.on) && /Nothing is sent until you do/.test(opened[0].text),
      "venue privacy: opening the calendar picker sends zero geocoding requests; unfamiliar locations wait for the planner to review and search",
      `${geo0} geocoding requests on opening · rows ${opened.map((r) => r.match).join(",")}`);
    /* the planner reviews each location and searches; one clear place is selected automatically */
    for (let k = 0; k < 4; k++) { await p.click(`[data-search="${k}"]`); await until(p, (n) => document.querySelector(`.ci-ev[data-row="${n}"]`).dataset.match !== "searching", k, 20000); }
    const first = await rows(), geo1 = geo;
    await p.screenshot({ path: `${out}/venue-search-import-phone.png`, fullPage: false });
    const cands = await p.evaluate(() => [...document.querySelectorAll('.ci-ev[data-match="ambiguous"] .vs-hit')].map((b) => b.innerText.replace(/\s+/g, " ")));
    await p.evaluate(() => [...document.querySelectorAll('.ci-ev[data-match="ambiguous"] .vs-hit')].find((b) => /Lincoln, NE/.test(b.innerText)).click());
    await p.click("#ciImport");
    if (!(await until(p, () => !document.getElementById("editDlg").open, null, 60000))) throw new Error(`import didn't finish: "${await p.evaluate(() => (document.getElementById("ciErr") || {}).innerText || document.getElementById("ciImport").innerText)}"`);
    const note1 = await p.evaluate(() => document.getElementById("upNote").innerText);
    const stored = await p.evaluate(() => ({ ev: JSON.parse(localStorage.getItem("beta_events_v2")).map((e) => ({ id: e.id, lat: e.loc.lat, lon: e.loc.lon, name: e.loc.name, tz: e.tz })), vn: JSON.parse(localStorage.getItem("beta_venues_v1")).map((v) => ({ name: v.name, lat: v.lat, lon: v.lon, address: v.address, aliases: v.aliases })) }));
    const at = (id) => stored.ev.find((e) => e.id === `cal_${id.replace(/\s/g, "_")}`) || {};
    const rv = at("Riverbend concert"), kv = at("Kellogg Ave event"), mv = at("Memorial Stadium game");
    report(first.map((r) => r.match).join() === "found,found,ambiguous,unknown" && geo1 === 4 && first[0].on && first[1].on && !first[2].on && !first[3].on && /Riverbend Music Center/.test(first[0].text) && /6295 Kellogg Ave, Cincinnati, OH 45230/.test(first[1].text)
      && cands.length >= 4 && /only matches a city/.test(first[3].text) && !errors.length,
      "venue search: an unfamiliar venue by name and an address-only event are found automatically; a shared name lists real candidates with addresses; a city-only match stays unconfirmed",
      `${first.map((r) => `${r.match}${r.on ? "✓" : ""}: ${r.text.slice(0, 70)}`).join(" | ")} · candidates: ${cands.slice(0, 3).map((c) => c.slice(0, 45)).join(" / ")} · ${geo1} searches, one per reviewed location`);
    report(stored.ev.length === 3 && Math.abs(rv.lat - 39.0519) < 0.0002 && Math.abs(rv.lon + 84.4189) < 0.0002 && Math.abs(kv.lat - 39.0562) < 0.0002 && kv.name === "6295 Kellogg Ave" && Math.abs(mv.lat - 40.8207) < 0.0002 && Math.abs(mv.lon + 96.7048) < 0.0002 && mv.tz === "America/Chicago" && !stored.ev.some((e) => /Downtown/.test(e.id)) && /3 added/.test(note1),
      "venue search: imported events sit at the venues' exact points (Memorial Stadium, Lincoln, NE on Central time); the city-only event was not imported",
      `${stored.ev.map((e) => `${e.name} ${e.lat},${e.lon} ${e.tz}`).join(" | ")} · "${note1.trim().slice(0, 90)}"`);
    /* re-import: every location now matches a saved venue; nothing asks, nothing is searched again */
    await openImport();
    const second = await rows(), geo2 = geo - geo1;
    await p.click("#ciImport"); await until(p, () => !document.getElementById("editDlg").open, null, 30000);
    const note2 = await p.evaluate(() => document.getElementById("upNote").innerText), count2 = await p.evaluate(() => JSON.parse(localStorage.getItem("beta_events_v2")).length);
    report(second.slice(0, 3).every((r) => r.match === "matched" && r.on && /matched by name|matched by street address|confirmed before/.test(r.text)) && geo2 === 0 && second[3].match === "review" && count2 === 3 && /0 added/.test(note2),
      "venue search: re-importing updates the same events and recognises all three venues without asking or sending any lookup",
      `${second.slice(0, 3).map((r) => r.text.slice(0, 60)).join(" | ")} · ${geo2} geocoding requests on re-import · ${count2} events · "${note2.trim().slice(0, 80)}"`);
    /* the briefing's forecast request uses the venue's exact coordinates */
    fc.length = 0; await p.goto(base + `event-beta.html?ev=${encodeURIComponent("cal_Memorial_Stadium_game")}`, { waitUntil: "domcontentloaded" });
    await until(p, () => document.body.dataset.readiness, null, 150000);
    const used = fc.find(([la, lo]) => Math.abs(la - 40.8207) < 0.0003 && Math.abs(lo + 96.7048) < 0.0003);
    report(!tokenSeen.length, "Githack demo: venue searches use the public search; no request goes to LocationIQ or carries its token", `${tokenSeen.length} LocationIQ/token requests over ${geo} searches`);
    report(!!used && !fc.some(([la]) => Math.abs(la - 40.8136) < 0.001), "venue search: the briefing's forecast is requested at the venue's exact point, not the city centre", `forecast requests at ${[...new Set(fc.map((x) => x.join(",")))].slice(0, 3).join(" ; ")}`);
    await ctx.close();
  });
  await section('7. analytics blocked or opted out: the betas work; nothing i', async () => {
  for (const [mode, init] of [["blocked", 'localStorage.setItem("fo_analytics_endpoint_test","https://collector.invalid/exec")'], ["opted out", 'localStorage.setItem("fo_analytics_endpoint_test","https://collector.invalid/exec");localStorage.setItem("fo_analytics_optout","1")']]) {
    for (const page of ["meteorologist-beta.html", "event-beta.html"]) {
      const ctx = await browser.newContext(PHONE); await ctx.addInitScript(`try{${init}}catch(e){}`); let sent = 0; await ctx.route(/script\.google\.com\/macros/, (r) => { sent++; r.abort(); });
      await ctx.route(/collector\.invalid/, (r) => { sent++; r.abort(); });
      const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + page, { waitUntil: "domcontentloaded" }); if (await p.getByText("Open the page", { exact: true }).count()) await Promise.all([p.waitForNavigation().catch(() => {}), p.getByText("Open the page", { exact: true }).first().click()]);
      const wait = () => (page.startsWith("met") ? menuReady(p, "CVG") : eventReady(p, "Sawyer"));
      let ready = await wait();
      /* the weather data service is sometimes slow late in a run: note what the page showed and reload once */
      if (!ready) { const shown = await p.evaluate(() => ((document.getElementById("decision") || document.querySelector(".bx-brief, .workspace") || {}).innerText || "—").trim().slice(0, 80)); console.log(`note: ${page} not ready after 2 min (page showed "${shown}"); reloading once`); await p.reload({ waitUntil: "domcontentloaded" }); ready = await wait(); }
      if (page.startsWith("met")) await p.evaluate(() => window.BetaAnalytics && window.BetaAnalytics.track("tool_opened", { tool: "models" })); else await p.click("#timeline svg", { position: { x: 120, y: 60 } }).catch(() => {});
      await p.evaluate(() => window.BetaAnalytics && window.BetaAnalytics.flush()); await p.waitForTimeout(800);
      const notice = await p.evaluate(() => (document.getElementById("bxPrivacy") || {}).innerText || "");
      report(ready && !errors.length && (mode === "blocked" ? /Turn off/.test(notice) : sent === 0 && /off in this browser/.test(notice)), `analytics ${mode}: ${page.split("-")[0]} works signed out`, `${sent} collector requests${mode === "blocked" ? " (all blocked)" : ""} · notice "${notice.slice(0, 60)}"`);
      await ctx.close(); } }
  });

  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})();
