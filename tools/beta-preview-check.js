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
/* weather-data requests that failed or answered with an error, from every page the check opens (see tools/net-recorder.js) */
const NETREC = require("./net-recorder.js").createRecorder(), watchNet = NETREC.watch, netSince = NETREC.since;
let lastReport = Date.now();
const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) { const n = netSince(lastReport - 5 * 60e3); console.log(n.length ? `  data requests that failed around this check:\n    ${n.join("\n    ")}` : "  data requests that failed around this check: none recorded"); }
  lastReport = Date.now(); };
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—");

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  /* open a page as a signed-out colleague; raw.githack.com shows a one-time notice that they click through */
  const go = async (opts, url, init) => {
    const ctx = await browser.newContext(opts); if (init) await ctx.addInitScript(init);
    await ctx.route(/script\.google\.com\/macros/, (r) => r.abort()); // automated checks never reach the real usage collector
    await ctx.route(/nominatim\.openstreetmap\.org\/search/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(GEO[new URL(r.request().url()).searchParams.get("q")] || []) })); // captured real responses
    const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message)); watchNet(p);
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
    await p.evaluate(() => { document.getElementById("chartMore").open = true; }); await p.waitForTimeout(800); // the chart is a secondary view under "Chart view"
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
    report(/^(Plan for|Have a rain plan|Watch for|Expect|No weather concern)/.test(r.decision) && r.keys[r.keys.length - 1] === "Next check" && r.keys.includes("Rain chance") && r.keys.includes("Lightning potential") && r.nextBottom <= r.vh, "event phone: decision, window, timing and next check on the first screen", `"${r.decision}" · ${r.keys.join(" · ")} · ends at ${Math.round(r.nextBottom)} of ${r.vh} px`);
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
    report(/8 PM/.test(d.when) && /1 AM MST/.test(d.when) && (d.when.match(/2026|2027/g) || []).length >= 2 && /Teardown\s+\S+ 1 AM – 2:30 AM/.test(d.phases) && d.tz === "America/Denver", "Denver overnight event keeps the venue clock (planner on Eastern time)", `${d.when} | ${d.phases.split("\n").filter((x) => /^(Event|Teardown)/.test(x)).join(" | ")}`);
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
  /* ---------- 14. multi-day calendar event through import, edit, re-import, refresh; backup export and restore ---------- */
  await section('14. multi-day import and backup round trip (phone)', async () => {
    const tqlV = { id: "vn_check", name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5222, tz: "America/New_York", aliases: ["TQL Stadium, 1501 Central Pkwy W, Cincinnati, OH 45214"], defaults: { setup: 270, gates: 90, teardown: 120, gust: 30 } };
    const { ctx, p, errors } = await go({ ...PHONE, acceptDownloads: true }, base + "event-beta.html#upcoming", `if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("beta_venues_v1", ${JSON.stringify(JSON.stringify([tqlV]))}); }`); // seeded once, so emptying the browser below sticks
    await until(p, () => document.querySelector("#upView:not([hidden]) #upImport"), null, 30000);
    /* a three-day synthetic fair at TQL, 10 AM day 1 to 6 PM day 3 (Eastern), in place of the sample matches */
    await p.evaluate(() => { const CI = window.CalendarImport, orig = CI.__orig || CI.sampleProvider; CI.__orig = orig;
      const day = new Date(Date.now() + 5 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" }), s = window.Ops.Core.time.toUtc(`${day}T10:00`, "America/New_York"), e = s + 56 * 3600e3;
      CI.sampleProvider = () => { const sp = orig(); return { ...sp, listEvents: async (id) => (id !== "sample-matches" ? [] : [{ id: "fair", etag: '"fair-1"', status: "confirmed", summary: "Synthetic three-day fair", location: "TQL Stadium, 1501 Central Pkwy W, Cincinnati, OH 45214", start: { dateTime: new Date(s).toISOString(), timeZone: "America/New_York" }, end: { dateTime: new Date(e).toISOString(), timeZone: "America/New_York" } }]) }; }; });
    const importFair = async () => {
      await p.click("#upImport"); await until(p, () => document.getElementById("ciSample"), null, 10000); await p.click("#ciSample");
      await until(p, () => document.getElementById("ciNext"), null, 10000); await p.click("#ciNext"); await until(p, () => document.getElementById("ciImport"), null, 10000);
      await until(p, () => document.getElementById("editForm").dataset.resolved === "true", null, 30000);
      const row = await p.evaluate(() => document.querySelector(".ci-ev").innerText.replace(/\s+/g, " "));
      await p.evaluate(() => { const c = document.querySelector(".ci-ev [data-pick]"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
      await p.click("#ciImport"); await until(p, () => !document.getElementById("editDlg").open, null, 10000);
      return { row, note: await p.evaluate(() => document.getElementById("upNote").innerText.trim()) };
    };
    const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem("beta_events_v2") || "[]"));
    const first = await importFair(), ev1 = (await saved())[0];
    const listText = await p.evaluate(() => (document.querySelector('.up-ev[data-id="cal_fair"]') || {}).innerText || "");
    const d0 = ev1 && ev1.times.start.slice(0, 10), d2 = ev1 && ev1.times.end.slice(0, 10);
    const span = ev1 ? Math.round((Date.parse(d2 + "T12:00Z") - Date.parse(d0 + "T12:00Z")) / 864e5) : null;
    /* edit: the end date is shown, a custom gates time saves, the end date stays */
    await p.click('.up-ev[data-id="cal_fair"] [data-edit]'); await until(p, () => document.getElementById("editDlg").open, null, 10000);
    const form = await p.evaluate(() => ({ s: document.getElementById("fDate").value, e: document.getElementById("fEndDate").value, end: document.getElementById("fEnd").value, tear: document.getElementById("fTear").value }));
    await p.evaluate(() => { const el = document.getElementById("fGates"); el.value = "07:30"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await p.click("#fSave"); await until(p, () => !document.getElementById("editDlg").open, null, 30000);
    const ev2 = (await saved())[0];
    const again = await importFair();
    await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector("#upView .up-ev"), null, 30000);
    const ev3 = await saved();
    report(ev1 && span === 2 && ev1.times.start.slice(11) === "10:00" && ev1.times.end.slice(11) === "18:00" && ev1.times.teardown === `${d2}T20:00` && ev1.times.gates === `${d0}T08:30`
      && /–\w{3}, \w{3} \d+ /.test(first.row) && new RegExp(`${new Date(Date.parse(d2 + "T12:00Z")).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`).test(listText)
      && form.s === d0 && form.e === d2 && form.end === "18:00" && form.tear === "20:00"
      && ev2.times.end === ev1.times.end && ev2.times.gates === `${d0}T07:30` && (ev2.overrides || []).join() === "gates"
      && /0 added · 0 updated · 1 unchanged/.test(again.note) && ev3.length === 1 && JSON.stringify(ev3[0].times) === JSON.stringify(ev2.times) && !errors.length,
      "multi-day calendar event: real end date through import, list, edit (custom gates), re-import and refresh; teardown from the end, setup/gates from the start",
      `import row "${first.row.slice(0, 90)}" · stored ${ev1 && ev1.times.start}→${ev1 && ev1.times.end} (${span} days), gates ${ev1 && ev1.times.gates.slice(11)}, teardown ${ev1 && ev1.times.teardown} · editor ${form.s}..${form.e} ${form.end} · after edit gates ${ev2 && ev2.times.gates.slice(11)} (${ev2 && (ev2.overrides || []).join()}) end ${ev2 && ev2.times.end} · re-import "${again.note.slice(0, 70)}" · after refresh ${ev3.length} event, times kept ${ev3[0] && JSON.stringify(ev3[0].times) === JSON.stringify(ev2.times)}${errors.length ? " · " + errors.join("; ") : ""}`);

    /* backup: export, empty the browser, restore, restore again (duplicates skipped), a damaged file (nothing changed) */
    const beforeEv = await saved(), beforeVn = await p.evaluate(() => JSON.parse(localStorage.getItem("beta_venues_v1") || "[]"));
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click("#upExport")]);
    const file = `${out}/../backup-check.json`; await dl.saveAs(file); const text = require("fs").readFileSync(file, "utf8"); require("fs").unlinkSync(file);
    const B = JSON.parse(text), exportNote = await p.evaluate(() => document.getElementById("upNote").innerText.trim());
    await p.evaluate(() => { localStorage.removeItem("beta_events_v2"); localStorage.removeItem("beta_venues_v1"); });
    await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector("#upView:not([hidden]) #upRestore"), null, 30000);
    const emptied = (await saved()).length;
    await p.setInputFiles("#upRestoreFile", { name: "forecast-ops-events.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await until(p, () => document.getElementById("editDlg").open && document.getElementById("rsSummary"), null, 10000);
    const summary = await p.evaluate(() => document.getElementById("rsSummary").innerText.replace(/\s+/g, " "));
    await p.screenshot({ path: `${out}/backup-restore-phone.png` });
    await p.click("#rsGo"); await until(p, () => !document.getElementById("editDlg").open, null, 10000);
    const restoredNote = await p.evaluate(() => document.getElementById("upNote").innerText.trim());
    const afterEv = await saved(), afterVn = await p.evaluate(() => JSON.parse(localStorage.getItem("beta_venues_v1") || "[]"));
    await p.setInputFiles("#upRestoreFile", { name: "again.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await until(p, () => document.getElementById("editDlg").open, null, 10000);
    const dup = await p.evaluate(() => document.getElementById("editForm").innerText.replace(/\s+/g, " "));
    await p.evaluate(() => document.getElementById("editDlg").close());
    const snap = await p.evaluate(() => localStorage.getItem("beta_events_v2") + localStorage.getItem("beta_venues_v1"));
    await p.setInputFiles("#upRestoreFile", { name: "damaged.json", mimeType: "application/json", buffer: Buffer.from(text.slice(0, 200)) });
    await until(p, () => !document.getElementById("upBackupErr").hidden, null, 10000);
    const bad = await p.evaluate(() => document.getElementById("upBackupErr").innerText.replace(/\s+/g, " "));
    const snap2 = await p.evaluate(() => localStorage.getItem("beta_events_v2") + localStorage.getItem("beta_venues_v1"));
    const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => ((o[k] = canon(x[k])), o), {}) : x), same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b)); // key order aside
    report(B.kind === "forecast-ops-event-backup" && B.version === 1 && B.counts.events === 1 && B.counts.venues === 1 && B.counts.aliases === 1 && !/pk\.[0-9a-f]{20,}|access_token|fo_bid|token/i.test(text)
      && /Backup exported: 1 event · 1 venue · 1 remembered calendar location/.test(exportNote) && emptied === 0 && /Events: 1 new/.test(summary) && /Venues: 1 new/.test(summary)
      && same(afterEv, beforeEv) && same(afterVn, beforeVn) && /Backup restored: 1 event and 1 venue added/.test(restoredNote)
      && /Everything in this backup is already saved here/.test(dup) && /can't be restored/.test(bad) && /valid JSON/.test(bad) && snap === snap2 && !errors.length,
      "backup: export (no credentials), restore into an empty browser, restore again (duplicates skipped), damaged file refused with nothing changed",
      `file v${B.version}: ${B.counts.events} event, ${B.counts.venues} venue, ${B.counts.aliases} alias · "${exportNote.slice(0, 60)}" · emptied ${emptied} · restore "${summary.slice(0, 80)}" → "${restoredNote.slice(0, 70)}" · records identical ${same(afterEv, beforeEv) && same(afterVn, beforeVn)} (custom gates ${afterEv[0] && afterEv[0].times.gates.slice(11)}, venue gates ${afterVn[0] && afterVn[0].defaults.gates} min) · again: "${dup.match(/Everything[^.]*\./) || dup.slice(0, 60)}" · damaged: "${bad.slice(0, 70)}", storage unchanged ${snap === snap2}${errors.length ? " · " + errors.join("; ") : ""}`);
    await ctx.close();
  });
  /* ---------- 15. editing an imported fall-back event keeps which 1:30 AM it is ---------- */
  await section('15. fall-back event edit (phone)', async () => {
    const tqlV = { id: "vn_check", name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5222, tz: "America/New_York", aliases: [], defaults: { setup: 270, gates: 90, teardown: 120, gust: 30 } };
    const { ctx, p, errors } = await go(PHONE, base + "event-beta.html#upcoming", `if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("beta_venues_v1", ${JSON.stringify(JSON.stringify([tqlV]))}); }`);
    await until(p, () => document.querySelector("#upView:not([hidden]) #upImport"), null, 30000);
    /* Nov 7 2027 (clocks fall back at 2 AM): one event ends at the second 1:30 AM (EST), one at the first (EDT) */
    await p.evaluate(() => { const E = window.EventStore, V = E.venues();
      E.importEvents([E.fromCalendar({ id: "fb2", summary: "Synthetic late show (EST end)", location: "TQL Stadium", start: { dateTime: "2027-11-07T02:00:00Z" }, end: { dateTime: "2027-11-07T06:30:00Z" } }, V, "cal-fb", "America/New_York"),
        E.fromCalendar({ id: "fb1", summary: "Synthetic late show (EDT end)", location: "TQL Stadium", start: { dateTime: "2027-11-07T02:00:00Z" }, end: { dateTime: "2027-11-07T05:30:00Z" } }, V, "cal-fb", "America/New_York")]); });
    await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector('.up-ev[data-id="cal_fb2"] [data-edit]'), null, 30000);
    const get = () => p.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem("beta_events_v2")).map((e) => [e.id, { times: e.times, fold: e.fold || {}, own: (e.overrides || []).join(), end: window.EventStore.msOf(e, "end"), tear: window.EventStore.msOf(e, "teardown") }])));
    const before = await get();
    const edit = async (id, gates) => {
      await p.click(`.up-ev[data-id="${id}"] [data-edit]`); await until(p, () => document.getElementById("editDlg").open, null, 10000);
      const shown = await p.evaluate(() => ({ s: document.getElementById("fDate").value, e: document.getElementById("fEndDate").value, end: document.getElementById("fEnd").value, tear: document.getElementById("fTear").value }));
      if (gates) await p.evaluate((g) => { const el = document.getElementById("fGates"); el.value = g; el.dispatchEvent(new Event("input", { bubbles: true })); }, gates);
      await p.click("#fSave"); await until(p, () => !document.getElementById("editDlg").open, null, 15000);
      const err = await p.evaluate(() => (document.getElementById("editDlg").open ? document.getElementById("fErr").innerText : ""));
      return { shown, err };
    };
    const e2 = await edit("cal_fb2", null), e1 = await edit("cal_fb1", null);
    const mid = await get();
    const e2g = await edit("cal_fb2", "19:45");
    await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector(".up-ev"), null, 30000);
    const after = await get();
    const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => ((o[k] = canon(x[k])), o), {}) : x), same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    const H = 3600e3, b2 = before.cal_fb2, b1 = before.cal_fb1, a2 = after.cal_fb2, m1 = mid.cal_fb1, m2 = mid.cal_fb2;
    report(b2.fold.end === 1 && b1.fold.end === 0 && b2.end === Date.parse("2027-11-07T06:30:00Z") && b1.end === Date.parse("2027-11-07T05:30:00Z")
      && !e2.err && !e1.err && e2.shown.e === "2027-11-07" && e2.shown.end === "01:30"
      && same(m2, b2) && same(m1, b1)
      && a2.fold.end === 1 && a2.end === b2.end && a2.tear - a2.end === 2 * H && a2.own === "gates" && a2.times.gates === "2027-11-06T19:45" && !e2g.err && !errors.length,
      "fall-back event: saving an imported event unchanged keeps which 1:30 AM it ends at (EST vs EDT); a gates edit keeps it too, after a refresh",
      `EST end: fold ${b2.fold.end} → unchanged save ${m2.fold.end} → gates edit + refresh ${a2.fold.end}, end ${new Date(a2.end).toISOString().slice(11, 16)}Z, teardown +${(a2.tear - a2.end) / H} h, gates ${a2.times.gates.slice(11)} (${a2.own}) · EDT end: fold ${b1.fold.end} → ${m1.fold.end}, end ${new Date(m1.end).toISOString().slice(11, 16)}Z · editor showed ${e2.shown.s}..${e2.shown.e} ends ${e2.shown.end}, teardown ${e2.shown.tear}${e2.err || e1.err || e2g.err ? " · errors: " + [e2.err, e1.err, e2g.err].join(" ") : ""}${errors.length ? " · " + errors.join("; ") : ""}`);
    await ctx.close();
  });
  /* ---------- 16. shared hourly forecast on the live pages: Event Manager (setup → teardown) and Model Blend ---------- */
  await section('16. hourly forecast grids (Event Manager and Model Blend)', async () => {
    const themed = (t) => `localStorage.setItem("ops_theme", ${JSON.stringify(JSON.stringify(t))})`;
    for (const [dev, devName] of [[PHONE, "phone"], [DESK, "desktop"]]) for (const theme of ["dark", "light"]) {
      /* Event Manager: the sample event's grid follows the briefing's phases and the shared selected time */
      { const { ctx, p, errors } = await go(dev, base + "event-beta.html", themed(theme));
        const ready = await until(p, () => document.querySelector("#evGrid .hg-t") && document.body.dataset.readiness, null, 150000);
        const g = ready ? await p.evaluate(() => {
          const cols = [...document.querySelectorAll("#evGrid .hg-hb")].map((b) => b.innerText.replace(/\s+/g, " ").trim());
          const rows = [...document.querySelectorAll("#evGrid tr.hg-row")].map((tr) => tr.dataset.row);
          const phase = [...document.querySelectorAll('#evGrid tr[data-row="phase"] td')].map((td) => td.innerText.trim());
          const tiers = [...document.querySelectorAll("#evGrid td.hg-s-concern")].map((td) => [...td.classList].find((c) => c.startsWith("hg-t-")));
          const unlabeled = [...document.querySelectorAll("#evGrid td.hg-s-concern")].filter((td) => !td.innerText.trim()).length;
          const missingAsClear = [...document.querySelectorAll('#evGrid tr[data-row="temp"] td')].map((td, i) => td.classList.contains("hg-s-missing") && document.querySelectorAll('#evGrid tr[data-row="concern"] td')[i].classList.contains("hg-s-clear")).filter(Boolean).length;
          return { cols, rows, phase, tiers, unlabeled, missingAsClear, state: document.body.dataset.readiness, hscroll: document.documentElement.scrollWidth > innerWidth + 1 }; }) : null;
        /* grid → shared time → timeline, then timeline-side change → grid */
        let sync = null;
        if (g && g.cols.length > 3) {
          await p.click("#evGrid .hg-hb >> nth=2"); await p.waitForTimeout(300);
          const a = await p.evaluate(() => ({ grid: +document.querySelector('#evGrid .hg-hb[aria-pressed="true"]').dataset.ms, bus: +document.body.dataset.selected, line: +document.getElementById("timeline").dataset.selected }));
          await p.click("#evGrid .hg-hb >> nth=1"); await p.waitForTimeout(300);
          const b2 = await p.evaluate(() => ({ grid: +document.querySelector('#evGrid .hg-hb[aria-pressed="true"]').dataset.ms, bus: +document.body.dataset.selected, detail: document.getElementById("evGridDetail").innerText.split("\n")[0] }));
          sync = { a, b: b2, ok: a.grid === a.bus && a.bus === a.line && b2.grid === b2.bus && b2.grid !== a.grid };
        }
        const ok = g && g.state !== "pending" && g.rows[0] === "phase" && g.rows[1] === "concern" && ["lightning", "temp", "feel", "pop", "qpf", "wind", "gust"].every((k) => g.rows.includes(k)) && !g.rows.includes("chance")
          && /Setup/.test(g.phase[0]) && /Teardown/.test(g.phase[g.phase.length - 1]) && g.tiers.every((t) => ["hg-t-monitor", "hg-t-prepare", "hg-t-action"].includes(t)) && !g.unlabeled && !g.missingAsClear
          && sync && sync.ok && !g.hscroll && !errors.length;
        report(ok, `event hourly grid (${devName}, ${theme}): setup through teardown, concerns from the briefing engine with text, values per hour; selecting an hour moves the shared time, the timeline and the detail`,
          g ? `${g.cols.length} hours ${g.cols[0]} → ${g.cols[g.cols.length - 1]} · phases ${g.phase[0]} … ${g.phase[g.phase.length - 1]} · rows ${g.rows.join(",")} · coloured ${g.tiers.length} (${[...new Set(g.tiers)].join(",") || "none"}), unlabeled ${g.unlabeled}, missing-as-clear ${g.missingAsClear} · sync ${sync && sync.ok} ("${sync && sync.b.detail}")${errors.length ? " · " + errors.join("; ") : ""}` : "grid did not appear");
        if (ok) { const el = await p.$("#secHourly"); await el.screenshot({ path: `${out}/hourly-event-${devName}-${theme}.png` }); }
        await ctx.close(); }
      /* Model Blend: 24/48/72 hours, a custom window, an hour's sources */
      { const { ctx, p, errors } = await go(dev, base + "blend.html", themed(theme) + ';localStorage.setItem("ops_blend_hg_range", "\\"24\\"")');
        const ready = await until(p, () => document.querySelector("#hgGrid .hg-t"), null, 150000);
        const count = () => p.evaluate(() => document.querySelectorAll("#hgGrid .hg-hb").length);
        const n = {}; if (ready) for (const [lbl, k] of [["24 H", 24], ["48 H", 48], ["72 H", 72]]) { await p.click(`#hgRange .tab:text-is("${lbl}")`); await p.waitForTimeout(200); n[k] = await count(); }
        let custom = null;
        if (ready) { await p.click('#hgRange .tab:text-is("CUSTOM")'); await p.waitForSelector("#hgCustom:not([hidden])");
          const from = await p.inputValue("#hgFrom"); const to = await p.evaluate((f) => { const d = new Date(f + ":00Z"); d.setUTCHours(d.getUTCHours() + 6); return d.toISOString().slice(0, 16); }, from);
          await p.fill("#hgTo", to); await p.click("#hgApply"); await p.waitForTimeout(250); custom = { from, to, n: await count() };
          await p.fill("#hgTo", from); await p.click("#hgApply"); custom.err = await p.evaluate(() => document.getElementById("hgErr").innerText); custom.after = await count();
          await p.click('#hgRange .tab:text-is("48 H")'); await p.waitForTimeout(200); }
        const d = ready ? await p.evaluate(() => { document.querySelectorAll("#hgGrid .hg-hb")[3].click(); const t = document.getElementById("hgDetail").innerText;
          return { labels: [...document.querySelectorAll("#hgGrid tr.hg-row th")].map((th) => th.childNodes[0].textContent.trim()), detail: t, hscroll: document.documentElement.scrollWidth > innerWidth + 1, chart: !!document.querySelector("#chart"), daily: document.querySelectorAll("#daily tbody tr").length }; }) : null;
        const want = ["Temperature", "Feels like", "Precip chance", "Ensemble ≥0.01″", "Precip amount", "Wind", "Gusts"];
        const ok = d && n[24] === 24 && n[48] === 48 && n[72] === 72 && custom && custom.n === 6 && /after the start/.test(custom.err) && custom.after === 6 && JSON.stringify(d.labels) === JSON.stringify(want)
          && /source \(\d+\)/i.test(d.detail) && /hourly PoP/.test(d.detail) && d.chart && d.daily > 0 && !d.hscroll && !errors.length;
        report(ok, `Model Blend hourly forecast (${devName}, ${theme}): next 24/48/72 hours and a custom window; local time, temperature, feels like, hourly PoP apart from the ensemble threshold, amount, wind, gusts; an hour lists its sources; chart and daily table still there`,
          d ? `hours ${n[24]}/${n[48]}/${n[72]} · custom ${custom.from}→${custom.to}: ${custom.n} hours; reversed window "${custom.err}" (kept ${custom.after}) · rows ${d.labels.join(" | ")} · detail "${d.detail.split("\n").filter(Boolean).slice(0, 2).join(" / ").slice(0, 150)}"${errors.length ? " · " + errors.join("; ") : ""}` : "grid did not appear");
        if (ok) { const el = await p.$("#hourlyCard"); await el.screenshot({ path: `${out}/hourly-blend-${devName}-${theme}.png` }); }
        await ctx.close(); }
    }
  });
  /* ---------- 17. simple briefing: site rain chance agrees everywhere; lightning words; printout; schedule presets ---------- */
  await section('17. event briefing: rain chance agreement, lightning wording, two-page printout, schedule presets', async () => {
    const pctVal = (t) => (/^<5%$/.test(t) ? 2.5 : /^(\d+)%$/.test(t) ? +RegExp.$1 : null);
    { const { ctx, p, errors } = await go(PHONE, base + "event-beta.html");
      const ready = await until(p, () => document.querySelector("#evGrid .hg-t") && document.querySelector("#printView .pv-p2") && document.body.dataset.readiness && document.body.dataset.readiness !== "pending", null, 150000);
      const r = ready ? await p.evaluate(() => {
        const phaseCells = [...document.querySelectorAll('#evGrid tr[data-row="phase"] td .hg-v')].map((td) => td.innerText.trim());
        const pops = [...document.querySelectorAll('#evGrid tr[data-row="pop"] td .hg-v')].map((td) => td.innerText.trim());
        const cards = [...document.querySelectorAll(".bx-phase[data-phase]")].map((c) => ({ key: c.dataset.phase, label: c.querySelector(".nm").childNodes[0].textContent.trim(), peak: c.querySelector("[data-peak]").innerText.trim(), light: c.querySelector("[data-light]").innerText.trim() }));
        const printPeaks = Object.fromEntries([...document.querySelectorAll("#printView tr[data-phase]")].map((tr) => [tr.dataset.phase, tr.querySelector("[data-peak]").innerText.trim().split(" ")[0]]));
        const printPops = [...document.querySelectorAll("#printView td[data-pop]")].map((td) => td.innerText.trim());
        const keys = document.getElementById("keys").innerText;
        return { phaseCells, pops, cards, printPeaks, printPops, keys, ensembleInDetails: !!document.querySelector("#detail #ensDetail"), ensembleInGrid: !!document.querySelector('#evGrid tr[data-row="chance"]'),
          chartTucked: !document.getElementById("chartMore").open, perPhaseTables: document.querySelectorAll(".bx-phd").length, jargon: /hourly rule|phase level/i.test(document.getElementById("briefView").innerText) }; }) : null;
      /* each card's peak = the highest hourly rain chance among the grid hours that overlap that phase; the printout says the same */
      const peaks = r ? r.cards.map((c) => { const vals = r.phaseCells.map((t, i) => (t.split(" → ").some((x) => x.startsWith(c.label)) ? r.pops[i] : null)).filter((x) => x && x !== "—");
        const max = vals.reduce((a, v) => (a == null || pctVal(v) > pctVal(a) ? v : a), null); return { ...c, gridMax: max || "—", print: r.printPeaks[c.key] }; }) : [];
      const agree = peaks.length && peaks.every((c) => c.peak === c.gridMax && c.print === c.peak);
      const printAgree = r && r.printPops.length === Math.min(24, r.pops.length) && r.printPops.every((v, i) => v === r.pops[i]);
      const lightOk = r && r.cards.every((c) => /^(Low|Moderate|High|Unavailable)( · limited guidance)?$/.test(c.light)) && /Lightning potential\s*(Low|Moderate|High|Unavailable|Not available yet)/.test(r.keys) && (!/Lightning potential\s*Low/.test(r.keys) || /Low is not zero/.test(r.keys));
      report(ready && agree && printAgree && lightOk && r.ensembleInDetails && !r.ensembleInGrid && r.chartTucked && !r.perPhaseTables && !r.jargon && !errors.length,
        "event briefing: each phase's peak hourly rain chance equals the highest hourly value in the grid for that phase, and the printout shows the same numbers; lightning in plain words (Low says it isn't zero); ensemble share only in Details; one hourly display; no internal jargon",
        r ? `${peaks.map((c) => `${c.label}: card ${c.peak} / grid max ${c.gridMax} / print ${c.print} · lightning ${c.light}`).join(" | ")} · print hours match ${printAgree} · ensemble in Details ${r.ensembleInDetails}, in grid ${r.ensembleInGrid} · chart tucked ${r.chartTucked} · jargon ${r.jargon}${errors.length ? " · " + errors.join("; ") : ""}` : "briefing did not load");
      if (ready) {
        await p.screenshot({ path: `${out}/event-brief-phone-top.png` });
        await p.evaluate(() => document.getElementById("secPhases").scrollIntoView()); await p.screenshot({ path: `${out}/event-brief-phone-phases.png` });
        await p.evaluate(() => document.getElementById("secHourly").scrollIntoView()); await p.screenshot({ path: `${out}/event-brief-phone-hourly.png` });
        /* the printout: a real PDF on US Letter, two pages for this single-day event, no controls or map */
        await p.emulateMedia({ media: "print" });
        const shown = await p.evaluate(() => ({ pv: getComputedStyle(document.getElementById("printView")).display, briefShown: document.getElementById("briefView").checkVisibility(), brief: document.getElementById("briefView").checkVisibility() ? "shown" : "hidden", iframes: [...document.querySelectorAll("#printView iframe, #printView button, #printView details, #printView input")].length,
          text: document.getElementById("printView").innerText, fontPt: parseFloat(getComputedStyle(document.querySelector("#printView .pv-t")).fontSize) * 0.75 }));
        const pdf = await p.pdf({ path: `${out}/event-briefing.pdf`, format: "Letter", preferCSSPageSize: true });
        const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
        await p.emulateMedia({ media: "screen" });
        const must = ["Issued", "Times are the venue's local time", "Peak hourly rain chance", "Official NWS forecast", "When to check again", "Hour by hour", "Open-Meteo", "National Weather Service"];
        report(pages === 2 && shown.pv === "block" && !shown.briefShown && !shown.iframes && must.every((m) => shown.text.includes(m)) && shown.fontPt >= 9,
          "printout: a two-page US Letter PDF for the single-day sample event, with issue time, time zone, phase summaries, NWS, next check, hourly table and attribution; no controls or map; table text 9 pt or larger",
          `${pages} pages · print view ${shown.pv}, screen view ${shown.brief} · controls/iframes ${shown.iframes} · table ${shown.fontPt.toFixed(1)} pt · missing: ${must.filter((m) => !shown.text.includes(m)).join(", ") || "none"}`);
      }
      await ctx.close(); }
    /* a three-day event prints a summary and says which hours the hourly table covers */
    { const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const ev3 = { id: "ev_check3day", name: "Three-day fair (check)", venueId: null, loc: { name: "Sawyer Point, Cincinnati, OH", lat: 39.0966, lon: -84.4996 }, tz: "America/New_York",
        times: { setup: `${day(1)}T08:00`, start: `${day(1)}T10:00`, end: `${day(3)}T18:00`, teardown: `${day(3)}T20:00` }, gust: 25, overrides: [], source: { kind: "manual" } };
      const { ctx, p, errors } = await go(PHONE, base + "event-beta.html?ev=ev_check3day", `if (!sessionStorage.getItem("seeded3")) { sessionStorage.setItem("seeded3", "1"); localStorage.setItem("beta_events_v2", ${JSON.stringify(JSON.stringify([ev3]))}); }`);
      const ready = await until(p, () => document.querySelector("#printView .pv-p2"), null, 150000);
      const m = ready ? await p.evaluate(() => ({ head: document.querySelector("#printView .pv-p2 .pv-hours-window").innerText, rows: document.querySelectorAll("#printView .pv-hours tbody tr").length, phases: document.querySelectorAll("#printView tr[data-phase]").length })) : null;
      let pages = null; if (ready) { await p.emulateMedia({ media: "print" }); const pdf = await p.pdf({ path: `${out}/event-briefing-3day.pdf`, format: "Letter", preferCSSPageSize: true }); pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length; }
      report(m && m.rows === 24 && /first 24 hours/i.test(m.head) && /open the briefing for the rest/.test(m.head) && m.phases >= 3 && pages === 2 && !errors.length,
        "long multi-day event: the printout keeps the full phase summary and states the hourly window it includes (first 24 hours) instead of silently cutting",
        m ? `${m.phases} phases summarised · ${m.rows} hourly rows · "${m.head.replace(/\s+/g, " ").slice(0, 160)}" · ${pages} PDF pages` : "briefing did not load");
      await ctx.close(); }
    /* schedule presets: a Practice preset at a saved venue; one event uses it and changes its own teardown; the preset stays */
    { const tqlV = { id: "vn_check", name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5222, tz: "America/New_York", defaults: { setup: 270, gates: 90, teardown: 120, gust: 30 } };
      const { ctx, p, errors } = await go(PHONE, base + "event-beta.html#upcoming", `if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("beta_venues_v1", ${JSON.stringify(JSON.stringify([tqlV]))}); }`);
      await until(p, () => document.querySelector('#upView:not([hidden]) .up-vn[data-id="vn_check"] [data-vedit]'), null, 30000);
      await p.click('.up-vn[data-id="vn_check"] [data-vedit]'); await until(p, () => document.getElementById("vAddPreset"), null, 10000);
      await p.click("#vAddPreset"); await p.fill(".vp-row .vp-name", "Practice"); await p.fill(".vp-row .vp-setup", "1"); await p.fill(".vp-row .vp-tear", "30");
      await p.click("#vSave"); await until(p, () => !document.getElementById("editDlg").open, null, 30000);
      const venue1 = await p.evaluate(() => JSON.parse(localStorage.getItem("beta_venues_v1"))[0]);
      await p.click("#upAdd"); await until(p, () => document.getElementById("fPreset"), null, 10000);
      await p.selectOption("#fVenueSel", "vn_check"); const pid = venue1.presets && venue1.presets[0] && venue1.presets[0].id;
      await p.selectOption("#fPreset", pid); await p.fill("#fName", "Practice (check)"); await p.fill("#fStart", "17:00"); await p.fill("#fEnd", "19:00");
      await p.evaluate(() => ["fStart", "fEnd"].forEach((id) => document.getElementById(id).dispatchEvent(new Event("change", { bubbles: true }))));
      const filled = await p.evaluate(() => ({ setup: document.getElementById("fSetup").value, gates: document.getElementById("fGates").value, tear: document.getElementById("fTear").value, note: document.getElementById("fDefNote").innerText }));
      await p.evaluate(() => { const el = document.getElementById("fTear"); el.value = "20:00"; el.dispatchEvent(new Event("input", { bubbles: true })); });
      await p.click("#fSave"); await until(p, () => !document.getElementById("editDlg").open, null, 30000);
      await p.reload({ waitUntil: "domcontentloaded" }); await until(p, () => document.querySelector("#upView .up-ev"), null, 30000);
      const after = await p.evaluate(() => ({ ev: JSON.parse(localStorage.getItem("beta_events_v2")).find((e) => e.name === "Practice (check)"), venue: JSON.parse(localStorage.getItem("beta_venues_v1"))[0] }));
      const e = after.ev || {};
      report(pid && venue1.presets.length === 1 && venue1.presets[0].gates == null && filled.setup === "16:00" && filled.gates === "" && filled.tear === "19:30" && /Practice preset/.test(filled.note)
        && e.preset === pid && JSON.stringify(e.overrides) === '["teardown"]' && e.times && e.times.teardown.endsWith("20:00") && !e.times.gates && JSON.stringify(after.venue.presets) === JSON.stringify(venue1.presets) && !errors.length,
        "schedule presets: a Practice preset (setup 1 h, no gates, teardown 30 min) fills a new event; changing that event's teardown is its own override; the saved preset is unchanged after a refresh",
        `preset ${venue1.presets ? JSON.stringify(venue1.presets.map((x) => [x.name, x.setup, x.gates, x.teardown])) : "none"} · filled setup ${filled.setup}, gates "${filled.gates}", teardown ${filled.tear} · saved preset ${e.preset === pid}, overrides ${JSON.stringify(e.overrides)}, teardown ${e.times && e.times.teardown} · preset unchanged ${JSON.stringify(after.venue.presets) === JSON.stringify(venue1.presets)}${errors.length ? " · " + errors.join("; ") : ""}`);
      await p.screenshot({ path: `${out}/event-presets-phone.png` });
      await ctx.close(); }
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
  { const n = netSince(0); console.log(`weather-data requests that failed during the whole run: ${n.length ? "\n  " + n.join("\n  ") : "none"}`); }
  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})();
