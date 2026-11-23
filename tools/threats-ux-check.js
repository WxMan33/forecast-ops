#!/usr/bin/env node
/* Weather Threats map and Planner layout on a deployment: desktop, 390 px and 360 px phones.
   Views: a busy national warning view (demo "multi"), a venue view with several hazards (demo "overlap"), Aviation with both
   model overlays (live GTG and IFI). Checks: every layer reachable in the Layers picker without a clipped row; opening it
   downloads nothing; keyboard (focus in, Space toggles, Escape closes and returns focus); time and layers stay in sight while
   the details scroll; no page overflow; links restore layers, venue, airport, altitude, valid time and replay; Planner's model
   checks sit in one area with two actions. Screenshots go to OUT_DIR.
     node tools/threats-ux-check.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/ux-check");
if (!HOST) { console.error("usage: threats-ux-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 500))); };
const DEV = { desktop: { viewport: { width: 1440, height: 900 } }, p390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, p360: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const ready = (p) => p.waitForFunction(() => window.__threats && window.__threats.ready && !(window.__threats.data || {}).loading, null, { timeout: 90000 });
(async () => {
  const b = await chromium.launch();
  for (const [d, o] of Object.entries(DEV)) {
    const ctx = await b.newContext(o), errs = [];
    const open = async (q) => { const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message)); await p.goto(HOST + "/threats?" + q, { waitUntil: "domcontentloaded" }); await ready(p); await p.waitForTimeout(1500); return p; };
    const layout = (p) => p.evaluate(() => { const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1; };
      return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1, layersBtn: vis(document.getElementById("txLayersBtn")), time: vis(document.querySelector(".tx-time")), scope: vis(document.querySelector(".tx-scope")), pstate: vis(document.getElementById("txPState")), pstateText: document.getElementById("txPState").textContent, sum: document.getElementById("txLayersSum").textContent, stageErrors: window.__threats.errors.length }; });
    /* 1. busy national warning view */
    let p = await open("scenario=multi&scope=national&view=active&sheet=open"), L = await layout(p);
    await p.screenshot({ path: path.join(OUT, `national-${d}.png`) });
    await p.evaluate(() => { const b = document.getElementById("txPanelBody"); b.scrollTop = b.scrollHeight; }); await p.waitForTimeout(300); const L2 = await layout(p);
    check(`(${d}) busy national view: Time, Layers, Map area and the state line in view, no page overflow; after scrolling the details, Map area and the state line still in view`, !L.overflow && L.layersBtn && L.time && L.scope && L.pstate && /^Active now · as of .+Layers: All 8/.test(L.pstateText) && L2.scope && L2.pstate && !L.stageErrors, { L, L2 });
    // the picker: every layer reachable, no downloads, keyboard
    const reqs = []; p.on("request", (r) => reqs.push(r.url())); await p.waitForTimeout(1500); const before = reqs.length;
    await p.focus("#txLayersBtn"); await p.keyboard.press("Enter"); await p.waitForTimeout(1200);
    const pk = await p.evaluate(() => { const pop = document.getElementById("txLayersPop"), r = pop.getBoundingClientRect(); return { open: !pop.hidden, expanded: document.getElementById("txLayersBtn").getAttribute("aria-expanded"), inView: r.left >= 0 && r.right <= window.innerWidth + 0.5, focus: document.activeElement.dataset.layer || null,
      layers: [...pop.querySelectorAll("input[data-layer]")].map((i) => { const b = i.closest("label").getBoundingClientRect(); return { k: i.dataset.layer, ok: b.width > 0 && b.left >= 0 && b.right <= window.innerWidth + 0.5 }; }), av: pop.querySelectorAll("input[data-av]").length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    const downloads = reqs.slice(before).filter((u) => !/^data:/.test(u));
    check(`(${d}) Layers picker: opens from the keyboard, all 8 hazards and 5 Aviation parts within the screen, focus moves in, and opening downloads nothing`, pk.open && pk.expanded === "true" && pk.inView && pk.layers.length === 8 && pk.layers.every((x) => x.ok) && pk.av === 5 && pk.focus === "severe" && !pk.overflow && downloads.length === 0, { pk, downloads });
    await p.screenshot({ path: path.join(OUT, `picker-${d}.png`) });
    await p.keyboard.press("Space"); await p.waitForTimeout(300); await p.keyboard.press("Tab"); await p.keyboard.press("Space"); await p.waitForTimeout(300);
    const kb = await p.evaluate(() => ({ severe: window.__threats.S.layers.severe, flood: window.__threats.S.layers.flood, sum: document.getElementById("txLayersSum").textContent }));
    await p.keyboard.press("Escape"); await p.waitForTimeout(200); const ec = await p.evaluate(() => ({ open: !document.getElementById("txLayersPop").hidden, focus: document.activeElement.id }));
    check(`(${d}) keyboard: Space turns layers off, the summary names what is still on; Escape closes and returns focus to Layers`, kb.severe === false && kb.flood === false && kb.sum === "Winter, Fire +4" && !ec.open && ec.focus === "txLayersBtn", { kb, ec });
    await p.click("#txLayersBtn"); await p.click("[data-layers-reset]"); await p.waitForTimeout(300); const rs = await p.evaluate(() => ({ all: Object.values(window.__threats.S.layers).every(Boolean), sum: document.getElementById("txLayersSum").textContent, gtg: window.__threats.S.gtg.on, ifi: window.__threats.S.ifi.on }));
    check(`(${d}) Reset to default: all 8 hazards on, model overlays off`, rs.all && rs.sum === "All 8" && !rs.gtg && !rs.ifi, rs);
    await p.click("[data-layers-close]"); await p.click('.tx-tb[data-view="day2"]'); await p.waitForTimeout(500);
    const d2 = await p.evaluate(() => document.getElementById("txPState").textContent);
    check(`(${d}) a layer not drawn at the selected time says why in one short line`, /^Day 2.*Not drawn in Day 2: Smoke & air, Tropical, Coastal \(current only\); Winter, Fire \(see Layers\)$/.test(d2), d2);
    await p.close();
    /* 2. venue with several hazards selected (from the link) */
    p = await open("scenario=overlap&scope=venue&view=active&layers=severe,flood,winter,tropical&sheet=open"); L = await layout(p);
    const lv = await p.evaluate(() => ({ layers: Object.entries(window.__threats.S.layers).filter(([, v]) => v).map(([k]) => k).join(","), boxes: (document.getElementById("txLayersBtn").click(), [...document.querySelectorAll("#txLayersPop input[data-layer]")].filter((i) => i.checked).map((i) => i.dataset.layer).join(",")) }));
    await p.keyboard.press("Escape");
    check(`(${d}) venue view, several hazards from the link: the picker and the summary show exactly them; Map area names the venue`, lv.layers === "severe,flood,winter,tropical" && lv.boxes === lv.layers && L.sum === "Severe storms, Flooding +2" && (await p.locator("#scopeVenue").innerText()).startsWith("Venue") && !L.overflow, { lv, L });
    await p.screenshot({ path: path.join(OUT, `venue-${d}.png`) }); await p.close();
    /* 3. Aviation, both model overlays (live) */
    p = await open("layers=aviation&gtg=1&ifi=1&gft=10000&gfh=3&scope=national&view=active&sheet=open");
    await p.waitForFunction(() => ["ok", "failed"].includes(window.__threats.gtg.state) && ["ok", "unavailable"].includes(window.__threats.ifi.state), null, { timeout: 150000 }).catch(() => {}); await p.waitForTimeout(1500);
    const av = await p.evaluate(() => ({ gtg: window.__threats.gtg.state, ifi: window.__threats.ifi.state, ft: document.querySelectorAll("[data-gtg-ft]").length, fh: document.querySelectorAll("[data-gtg-fh]").length, ftVal: (document.querySelector("[data-gtg-ft]") || {}).value, fhVal: (document.querySelector("[data-gtg-fh]") || {}).value,
      avctl: [...document.querySelectorAll("[data-avt]")].map((x) => x.dataset.avt + ":" + x.getAttribute("aria-pressed")).join(","), legend: (document.getElementById("txLegendBody") || {}).textContent || "", overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }));
    check(`(${d}) Aviation with both overlays: one shared altitude and valid-time control (10,000 ft, +3 h), Aviation's own switches show what is on, legend lists turbulence and icing guidance`, av.gtg === "ok" && av.ifi === "ok" && av.ft === 1 && av.fh === 1 && av.ftVal === "10000" && av.fhVal === "3" && /gtg:true/.test(av.avctl) && /ifi:true/.test(av.avctl) && /turbulence guidance \(GTG\)/.test(av.legend) && /icing guidance \(IFI\)/.test(av.legend) && !av.overflow, av);
    if (d === "desktop") await p.evaluate(() => { const l = document.getElementById("txLegend"); if (l) l.open = true; });
    await p.screenshot({ path: path.join(OUT, `aviation-${d}.png`) }); await p.close();
    /* 3b. the picker's end: a cue while more is below; Icing guidance reachable by touch and by keyboard, clear of the pinned actions */
    { const q = await open("scenario=overlap&scope=venue&view=active");
      await q.click("#txLayersBtn"); await q.waitForTimeout(400);
      const st = await q.evaluate(() => { const pop = document.getElementById("txLayersPop"); return { scrolls: pop.scrollHeight > pop.clientHeight + 8, more: pop.classList.contains("more"), cue: getComputedStyle(document.getElementById("txLyrMore")).display !== "none" }; });
      // keyboard: Tab from the first box until Icing guidance has focus; it must be inside the picker's visible area, above the pinned actions
      let tabs = 0; while (tabs < 20 && !(await q.evaluate(() => document.activeElement && document.activeElement.dataset.av === "ifi"))) { await q.keyboard.press("Tab"); tabs++; }
      const kv = await q.evaluate(() => { const pop = document.getElementById("txLayersPop"), pr = pop.getBoundingClientRect(), a = document.querySelector("#txLayersPop .tx-lyract").getBoundingClientRect(), l = document.activeElement.closest("label").getBoundingClientRect(); return { focus: document.activeElement.dataset.av, visible: l.top >= pr.top - 1 && l.bottom <= a.top + 1, more: pop.classList.contains("more") }; });
      // touch: close and reopen, scroll to the end, tap Icing guidance
      await q.keyboard.press("Escape"); await q.click("#txLayersBtn"); await q.waitForTimeout(300);
      await q.evaluate(() => { const pop = document.getElementById("txLayersPop"); pop.scrollTop = pop.scrollHeight; pop.dispatchEvent(new Event("scroll")); }); await q.waitForTimeout(300);
      const endMore = await q.evaluate(() => document.getElementById("txLayersPop").classList.contains("more"));
      { const lab = q.locator('#txLayersPop label:has(input[data-av="ifi"])'); if (o.hasTouch) await lab.tap(); else await lab.click(); } await q.waitForTimeout(500);
      const tapped = await q.evaluate(() => window.__threats.S.ifi.on);
      await q.screenshot({ path: path.join(OUT, `picker-end-${d}.png`) });
      check(`(${d}) picker end: ${st.scrolls ? "it scrolls, a 'More below' cue shows until the end, " : "everything fits, "}Icing guidance reached by keyboard (${tabs} Tabs) and visible above the pinned actions, and by touch at the end`, (!st.scrolls || (st.more && st.cue && !endMore)) && kv.focus === "ifi" && kv.visible && tapped, { st, tabs, kv, endMore, tapped });
      await q.close(); }
    /* 3c. Aviation only: the panel and the phone header lead with "Aviation at <venue>" and what is available or not */
    { const q = await open("layers=aviation&scope=national&view=active&sheet=" + (d === "desktop" ? "open" : "peek"));
      await q.waitForTimeout(1500);
      const a = await q.evaluate(() => { const body = document.getElementById("txPanelBody"), first = body.firstElementChild; return { first: first && first.dataset.avSummary !== undefined, head: (document.querySelector("[data-av-summary] .px-status-h") || {}).textContent, rows: [...document.querySelectorAll("[data-av-summary] dt")].map((x) => x.textContent), peek: document.getElementById("txPeek1").textContent, peek2: document.getElementById("txPeek2").textContent, ready: (window.__threats.data.state.enroute || {}).kind === "current", nothing: /Nothing active/.test(document.getElementById("txPeek1").textContent + (first ? first.textContent : "")) }; });
      check(`(${d}) Aviation only: the panel${d === "desktop" ? "" : " and the phone's sheet header"} lead with "Aviation at <venue>" and list airport weather, pilot reports, advisories, turbulence and icing guidance as available or not`, a.first && /^Aviation at /.test(a.head) && /^Aviation at /.test(a.peek) && !a.nothing && a.rows.join("|") === "Airport weather|Pilot reports|Advisories|Turbulence guidance|Icing guidance" && a.peek2.length > 0 && !/\b0 (pilot reports|advisories)\b/.test(a.peek2) || (a.ready && a.first && /^Aviation at /.test(a.peek)), a);
      await q.screenshot({ path: path.join(OUT, `aviation-only-${d}.png`) }); await q.close(); }
    /* 4. links restore: venue, airport, altitude and time, replay */
    p = await open("lat=39.1113&lon=-84.5222&name=TQL%20Stadium&tz=America%2FNew_York&scope=venue&layers=flood,smoke");
    const v = await p.evaluate(() => ({ scope: window.__threats.S.scope, venue: document.getElementById("scopeVenue").textContent, sum: document.getElementById("txLayersSum").textContent })); await p.close();
    p = await open("layers=aviation&air=KORD,KMDW&ap=KMDW&scope=venue&lat=41.8807&lon=-87.6742&name=United%20Center&tz=America%2FChicago");
    const a = await p.evaluate(() => ({ air: window.__threats.S.air.join(","), ap: window.__threats.S.ap, sum: document.getElementById("txLayersSum").textContent })); await p.close();
    p = await open("scenario=quiet&layers=aviation&ifi=1&ifisrc=fixture&ifield=sev&gft=15000&gfh=6&scope=national");
    await p.waitForFunction(() => ["ok", "unavailable"].includes(window.__threats.ifi.state), null, { timeout: 90000 }).catch(() => {});
    const f = await p.evaluate(() => ({ key: window.__threats.ifi.key, field: window.__threats.S.ifi.field, ft: (document.querySelector("[data-gtg-ft]") || {}).value, fh: (document.querySelector("[data-gtg-fh]") || {}).value, banner: document.getElementById("txBarText").textContent, ifiBox: (document.getElementById("txLayersBtn").click(), document.querySelector('#txLayersPop input[data-av="ifi"]').checked) })); await p.close();
    p = await open("scenario=archive-aviation-enroute&scope=venue&layers=aviation&view=active");
    const r = await p.evaluate(() => ({ scenario: window.__threats.S.scenario, venue: document.getElementById("scopeVenue").textContent })); await p.close();
    check(`(${d}) links restore: venue and layers; airports and the selected airport; icing field, altitude, valid time and the saved-records replay (banner says so); an archived replay`,
      v.scope === "venue" && /TQL Stadium/.test(v.venue) && v.sum === "Flooding, Smoke & air" && a.air === "KORD,KMDW" && a.ap === "KMDW" && a.sum === "Aviation" && f.key === "2026112301|6|15000|sev" && f.field === "sev" && f.ft === "15000" && f.fh === "6" && f.ifiBox && /saved official NOAA In-Flight Icing guidance/.test(f.banner) && r.scenario === "archive-aviation-enroute" && /MetLife/.test(r.venue), { v, a, f, r });
    check(`(${d}) no script errors in any view`, !errs.length, errs);
    /* 5. Planner: the route's model checks in one area, two actions, results and gaps under their own headings */
    { const q = await ctx.newPage(), perr = []; q.on("pageerror", (e) => perr.push(e.message));
      const EV = encodeURIComponent(JSON.stringify({ n: "Cardinals night game", v: { name: "Busch Stadium", lat: 38.6226, lon: -90.1928 }, z: "America/Chicago", t: { start: "2026-11-23T11:00", end: "2026-11-23T14:00" }, g: 25 }));
      const RT = encodeURIComponent(JSON.stringify({ o: "KATL", d: "KSTL", lo: 15000, hi: 15900, w: ["2026-11-22T21:45", "2026-11-22T22:15"] })), AIR = encodeURIComponent(JSON.stringify([{ i: "KSTL", r: "p", a: ["2026-11-22T22:15", "2026-11-22T22:45"], d: null }]));
      await q.goto(HOST + "/event-beta?ifisrc=fixture&gtgcyc=2026112300&air=" + AIR + "&rt=" + RT + "&e=" + EV, { waitUntil: "domcontentloaded" });
      await q.waitForSelector(".et-mc [data-gtg-check]", { timeout: 120000 });
      const pre = await q.evaluate(() => ({ heads: [...document.querySelectorAll(".et-mc .et-mch")].length, btns: [...document.querySelectorAll(".et-mc .et-mcact button")].map((x) => x.textContent.replace(/\s+/g, " ").trim()) }));
      await q.click("[data-ifi-check]"); await q.click("[data-gtg-check]");
      await q.waitForSelector(".et-mc .et-ifi[data-ifi-complete]", { timeout: 180000 }); await q.waitForSelector(".et-mc .et-gtg[data-gtg-complete], .et-mc [data-gtg-state=failed]", { timeout: 180000 });
      const post = await q.evaluate(() => ({ done: [...document.querySelectorAll(".et-mcdone")].map((x) => x.textContent), gtgHead: !!document.querySelector(".et-mc .et-gtg .et-gtgh"), ifiHead: !!document.querySelector(".et-mc .et-ifi .et-ifih"), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }));
      check(`(${d}) Planner: one 'Model checks along the route' area with 'Check turbulence' and 'Check icing'; both on demand; each result under its own heading`, pre.heads === 1 && /^Check turbulence \(about \d+ MB\)$/.test(pre.btns[0]) && /^Check icing \(about \d+ MB\)$/.test(pre.btns[1]) && post.done.length === 2 && post.gtgHead && post.ifiHead && !post.overflow && !perr.length, { pre, post, perr });
      await q.locator(".et-mc").scrollIntoViewIfNeeded(); await q.locator(".et-mc").screenshot({ path: path.join(OUT, `planner-modelchecks-${d}.png`) }).catch(() => {}); await q.close(); }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "ux-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
