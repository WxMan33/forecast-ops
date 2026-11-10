#!/usr/bin/env node
/* Signed-out check of the public beta preview links, plus screenshots for review.
   Every scenario opens in a fresh browser context (no cookies, no storage, no GitHub session).
   Usage: node tools/beta-preview-check.js <base URL ending in /> <screenshot dir> [expected asset stamp] */
"use strict";
const { chromium, devices } = require("playwright");
const [base, out, stamp] = process.argv.slice(2);
const DESK = { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 }, PHONE = { ...devices["iPhone 13"] };
let failed = 0;
const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`); };
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—");

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  /* open a page as a signed-out colleague; raw.githack.com shows a one-time notice that they click through */
  const go = async (opts, url, init) => {
    const ctx = await browser.newContext(opts); if (init) await ctx.addInitScript(init);
    await ctx.route(/script\.google\.com\/macros/, (r) => r.abort()); // automated checks never reach the real usage collector
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
  await section('7. analytics blocked or opted out: the betas work; nothing i', async () => {
  for (const [mode, init] of [["blocked", 'localStorage.setItem("fo_analytics_endpoint_test","https://collector.invalid/exec")'], ["opted out", 'localStorage.setItem("fo_analytics_endpoint_test","https://collector.invalid/exec");localStorage.setItem("fo_analytics_optout","1")']]) {
    for (const page of ["meteorologist-beta.html", "event-beta.html"]) {
      const ctx = await browser.newContext(PHONE); await ctx.addInitScript(`try{${init}}catch(e){}`); let sent = 0; await ctx.route(/script\.google\.com\/macros/, (r) => { sent++; r.abort(); });
      await ctx.route(/collector\.invalid/, (r) => { sent++; r.abort(); });
      const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + page, { waitUntil: "domcontentloaded" }); if (await p.getByText("Open the page", { exact: true }).count()) await Promise.all([p.waitForNavigation().catch(() => {}), p.getByText("Open the page", { exact: true }).first().click()]);
      const ready = page.startsWith("met") ? await menuReady(p, "CVG") : await eventReady(p, "Sawyer");
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
