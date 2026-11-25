/* Forecast highlights for the site, against a hosted page, desktop and phone:
     TEST REPLAY heavy: CVG's real NWS grid rewritten (tools/lib/grid-replay.js): heavy rain over 1 inch across midnight, a
       next-day morning wintry mix, lingering rain. Lead: "Heavy rain <day> · Wintry mix possible <day> morning"; the alert status
       stays separate; highlights carry amounts, site-local times and sources; Open rainfall map works; the map stays calm (no
       rainfall overlay until asked); the phone's collapsed line leads with the highlights.
     TEST REPLAY hot: "Heat index 100°F <day>".  TEST REPLAY quiet: nothing stands out, said plainly.
     missing data: the grid refused: "Forecast highlights not available", alerts still shown.
     TEST REPLAY partial: the grid served with rain amounts and weather types empty: "Not fully checked", naming what couldn't be
       checked; no "Nothing stands out" all-clear; the lead and today's card say not confirmed.
     TEST REPLAY partial-rain: six known hours (about 0.6 in) then no amounts while rain stays definite: the lingering rain is kept,
       heavy rain after the stop is "Not fully checked" (lead, phone line, Thursday's card).
     TEST REPLAY partial-heavy: six known hours at about 1.2 in, then none: heavy rain kept; the lead says the amounts stop there.
     TEST REPLAY heavy-alone: heavy rain without a lingering-rain stretch: its own window under the headline.
     Lead: one heavy-rain event named once, the whole rain window underneath; at 360 px the collapsed phone view shows both ends.
     live CVG: whatever the real forecast holds, every highlight names its source and the coverage note is there.
   Usage: node tools/threats-highlights-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const REPLAY = require("./lib/grid-replay.js");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/highlights-check");
if (!HOST) { console.error("usage: node tools/threats-highlights-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 1200))); };
const CVG = "lat=39.0446&lon=-84.6723&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky");
const GRID = /\/gridpoints\/[A-Z]{3}\/\d+,\d+(\?|$)/;
const wk = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date(ms));

const rewrite = (name, count) => async (p) => { await p.route(GRID, async (r) => {
  if (name === "missing") { count.n++; return r.abort(); }
  try { const res = await fetch(r.request().url(), { headers: { Accept: "application/geo+json" } }), j = await res.json(), g = REPLAY.scenario(j, name, Date.now()); count.n++;
    const h = {}; res.headers.forEach((v, k) => { if (!/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(k)) h[k] = v; });
    await r.fulfill({ status: res.status, headers: { ...h, "content-type": "application/geo+json", "access-control-allow-origin": "*", "access-control-expose-headers": h["access-control-expose-headers"] || "*" }, body: JSON.stringify(g) });
  } catch (e) { count.failed++; await r.abort(); } }); };
const read = (p) => p.evaluate(() => { const T = window.__threats, m = T.map, vis = (id) => !!(m.getLayer(id) && m.getLayoutProperty(id, "visibility") === "visible"), head = document.querySelector(".px-olhead");
  return { lead: head && head.dataset.lead, big: ((head && head.querySelector(".px-big")) || {}).textContent || "", sub: head ? [...head.querySelectorAll(".px-sub")].map((x) => x.textContent).join(" | ") : "", timing: ((head && head.querySelector("[data-hl-timing]")) || {}).textContent || "", leadUnc: ((head && head.querySelector("[data-hl-lead-unchecked]")) || {}).textContent || "", hlUnc: ((document.querySelector("[data-hl-unchecked]")) || {}).textContent || "",
    items: [...document.querySelectorAll(".px-hlitem")].map((x) => x.innerText.replace(/\s+/g, " ")), state: ((document.querySelector("[data-hl-state]") || {}).dataset || {}).hlState || null, notes: ((document.querySelector("[data-hl-notes]") || {}).textContent) || "",
    openRain: !!document.querySelector("[data-open-rain]"), empty: ((document.querySelector(".px-hl .px-empty") || {}).textContent) || "", unk: [...document.querySelectorAll(".px-olunk")].map((x) => x.textContent), status: ((document.querySelector(".px-alert-none") || document.querySelector(".px-sitealerts .px-h")) || {}).textContent || "",
    chips: [...document.querySelectorAll(".px-olhl")].map((x) => x.closest(".px-olday").dataset.olDay + " " + x.dataset.olKey), rainDrawn: vis("rain-obs") || vis("rain-fcst"), sum: document.getElementById("txLayersSum").textContent,
    peek1: document.getElementById("txPeek1").textContent, peek2: document.getElementById("txPeek2").textContent, peek3: document.getElementById("txPeek3").hidden ? "" : document.getElementById("txPeek3").textContent, badge: document.getElementById("txBadge").textContent, hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, errors: T.errors.map((e) => e.stage + ": " + e.message) }; });

(async () => {
  const b = await chromium.launch(), H = 3600e3, { day1, day2 } = REPLAY.anchors(Date.now()), D1 = wk(day1 + 12 * H), D2 = wk(day2 + 12 * H);
  for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
    for (const name of ["heavy", "hot", "quiet", "partial", "partial-rain", "partial-heavy", "heavy-alone", "missing", "live"]) {
      const count = { n: 0, failed: 0 }, ctx = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(), errs = [];
      p.on("pageerror", (e) => errs.push(e.message)); if (name !== "live") await rewrite(name, count)(p);
      await p.goto(HOST + "/threats.html?" + CVG + (name === "live" ? "" : "&testreplay=highlights-" + name), { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForFunction(() => window.__threats && window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(3500);
      const s = await read(p); await p.screenshot({ path: path.join(OUT, `${name}-${d}.png`) });
      if (phone) { await p.locator("#txPeek").click().catch(() => {}); await p.waitForTimeout(900); await p.locator(".px-hl").scrollIntoViewIfNeeded().catch(() => {}); await p.screenshot({ path: path.join(OUT, `${name}-${d}-open.png`) }); }
      // a forecast highlight is never worded as an alert: headline, highlight list, day-card chips and the phone's collapsed line
      const alertWords = await p.evaluate(() => { const w = /\b(warning|watch|advisory)\b/i, head = document.querySelector('.px-olhead[data-lead="highlights"]');
        return [...(head ? [head.querySelector(".px-big").textContent] : []), ...[...document.querySelectorAll(".px-hlitem b, .px-olhl")].map((x) => x.textContent), ...(head ? [document.getElementById("txPeek1").textContent, document.getElementById("txPeek2").textContent] : [])].filter((x) => w.test(x)); });
      check(`(${phone ? "phone" : "desktop"}) ${name}: no forecast highlight is worded as an alert (${alertWords.length} found)`, !alertWords.length, { alertWords });
      const base = !errs.length && !s.errors.length && !s.hscroll && (name === "live" || (s.badge === "TEST REPLAY" && count.n > 0 && count.failed === 0));
      if (name === "heavy") {
        check(`(${d}) HEAVY RAIN REPLAY: lead '${s.big}' (${s.lead}); underneath '${s.timing}'`, base && s.lead === "highlights" && s.big === `Heavy rain ${D1} · Wintry mix possible ${D2} morning` && s.timing === "Rain likely from Thu 10 AM through Fri 7 AM" && /not an alert or outlook/.test(s.sub) && !/Rain (for|likely) \d+ h/.test(s.big), { s, count, errs });
        check(`(${d}) the highlights carry amount, site-local timing and source: ${s.items.length} — '${(s.items[0] || "").slice(0, 160)}'`, s.items.length === 3 && /Heavy rain: about 1\.3 in from \w{3} 1 PM – \w{3} 7 AM; heaviest/.test(s.items[0]) && /NWS forecast \(rain amounts\)/.test(s.items[0])
          && s.items.some((x) => /Wintry mix possible \w{3} 6 AM – 11 AM: rain, snow; snow about 0\.2 in/.test(x)) && s.items.some((x) => /Rain likely for about 17 hours/.test(x)) && /Rain amounts forecast through/.test(s.notes), { items: s.items, notes: s.notes });
        check(`(${d}) the alert status stays separate ('${s.status.slice(0, 80)}'); the map stays calm (rainfall overlay ${s.rainDrawn ? "ON" : "off"}; '${s.sum}'); day chips ${s.chips.join(", ")}`, /No NWS (warning|alert)|In effect at this site/i.test(s.status) && !s.rainDrawn && s.chips.length >= 3, { s });
        if (phone) check(`(${d}) collapsed sheet leads with the highlights: '${s.peek1}' / '${s.peek2}' / '${s.peek3}'`, s.peek1 === `Heavy rain ${D1} · Wintry mix possible ${D2} morning` && s.peek2 === "Rain likely from Thu 10 AM through Fri 7 AM" && /Forecast highlights · NWS forecast · not an alert/.test(s.peek3), { s });
        await p.locator("[data-open-rain]").scrollIntoViewIfNeeded().catch(() => {}); await p.locator("[data-open-rain]").click(); await p.waitForTimeout(4000);
        const o = await p.evaluate(() => { const T = window.__threats, m = T.map; return { auto: T.S.auto, rain: T.S.rain, flood: T.S.layers.flood, view: T.S.view, drawn: !!(m.getLayer("rain-fcst") && m.getLayoutProperty("rain-fcst", "visibility") === "visible") }; });
        await p.screenshot({ path: path.join(OUT, `heavy-${d}-rainmap.png`) });
        check(`(${d}) Open rainfall map: rain still to come drawn (Days 1–3), Flooding on, Manual`, o.drawn && o.rain.fcst && o.rain.per === "1-3" && o.flood && !o.auto, { o });
      } else if (name === "hot") check(`(${d}) HOT DAY REPLAY: lead '${s.big}'; '${(s.items[0] || "").slice(0, 80)}'`, base && s.lead === "highlights" && s.big === `Heat index 100°F ${D1}` && /Heat index to 100°F around \w{3} 2 PM/.test(s.items[0] || "") && /NWS forecast \(heat index\)/.test(s.items[0] || ""), { s, count });
      else if (name === "quiet") check(`(${d}) QUIET REPLAY: lead '${s.big}' (${s.lead}); '${s.state}'`, base && s.lead !== "highlights" && s.state === "none" && !s.items.length && !s.openRain, { s, count });
      else if (name === "partial") check(`(${d}) PARTIAL GRID REPLAY: '${s.empty.slice(0, 150)}'; lead '${s.big}' / '${s.sub.slice(0, 90)}'; day cards '${s.unk[0] || "none"}'${phone ? "; collapsed '" + s.peek1 + "'" : ""}`,
        base && s.state === "partial" && /couldn't be checked: heavy rain \(no rain amounts\); wintry mix and long rain \(no precipitation types\)/.test(s.empty) && !/Nothing stands out in the NWS forecast/.test(s.empty) && !s.items.length
          && s.lead !== "highlights" && !/No significant threats in the next/.test(s.big + " " + s.peek1) && s.unk.some((x) => /came back incomplete/.test(x)), { s, count });
      else if (name === "partial-rain") check(`(${d}) PARTIAL RAIN AMOUNTS REPLAY: lead '${s.big}' / '${s.timing}' / '${s.leadUnc.slice(0, 110)}'; kept ${s.items.length}: '${(s.items[0] || "").slice(0, 70)}'; Thursday card '${(s.unk[0] || "").slice(0, 80)}'${phone ? "; phone '" + s.peek3 + "'" : ""}`,
        base && s.lead === "highlights" && s.big === `Rain likely ${D1}` && s.timing === "From Thu 10 AM through Fri 3 AM" && /^Not fully checked: heavy rain after Thu 7 PM \(rain amounts stop while rain is still forecast; about 0\.59 in before then\)/.test(s.leadUnc)
          && s.items.length === 1 && /Rain likely for about 17 hours/.test(s.items[0]) && /^Not fully checked: heavy rain after Thu 7 PM/.test(s.hlUnc) && s.unk.some((x) => /not checked: heavy rain after Thu 7 PM/.test(x))
          && (!phone || s.peek3 === "Not fully checked: heavy rain after Thu 7 PM"), { s, count });
      else if (name === "partial-heavy") check(`(${d}) PARTIAL HEAVY REPLAY: lead '${s.big}' / '${s.timing}'; '${(s.items[0] || "").slice(0, 140)}'`,
        base && s.lead === "highlights" && s.big === `Heavy rain ${D1}` && s.timing === "Rain likely from Thu 10 AM through Fri 3 AM · rain amounts stop Thu 7 PM, so the total may be higher" && /^🌧 Heavy rain: about 1\.2 in/.test(s.items[0] || "") && /the forecast amounts stop inside this window, so the total may be higher/.test(s.items[0] || "") && !s.leadUnc && (!phone || s.peek2 === "Rain likely from Thu 10 AM through Fri 3 AM · rain amounts stop Thu 7 PM"), { s, count });
      else if (name === "heavy-alone") check(`(${d}) HEAVY RAIN ALONE REPLAY: lead '${s.big}' / '${s.timing}'${phone ? "; phone '" + s.peek2 + "'" : ""}`,
        base && s.lead === "highlights" && s.big === `Heavy rain ${D1}` && s.timing === "Rain from Thu 1 PM through Fri 7 AM" && (!phone || s.peek2 === s.timing), { s, count });
      else if (name === "missing") check(`(${d}) MISSING DATA (grid refused): highlights say they're not available; the alert status still shows ('${s.status.slice(0, 60)}')`, base && s.state === "missing" && !s.items.length && /\S/.test(s.status), { s, count });
      else check(`(${d}) LIVE CVG: ${s.items.length} highlight(s) (${s.items.map((x) => x.slice(0, 50)).join(" | ") || "none"}); every one names its source; coverage note '${s.notes.slice(0, 60)}'`, base && s.items.every((x) => /NWS forecast \(/.test(x)) && (s.state === "none" || s.items.length > 0) && /forecast through|No rain amounts/.test(s.notes), { s });
      await ctx.close(); } }
  /* 360 px: the collapsed view shows both ends of the rain window, on its own line, not cut off */
  for (const name of ["heavy", "partial-rain", "partial-heavy"]) {
    const count = { n: 0, failed: 0 }, ctx = await b.newContext({ ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } }), p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); await rewrite(name, count)(p);
    await p.goto(HOST + "/threats.html?" + CVG + "&testreplay=highlights-" + name, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.__threats && window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(3500);
    const f = await p.evaluate(() => { const line = (id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { text: e.hidden ? "" : e.textContent, cut: e.scrollWidth > e.clientWidth + 1, right: Math.round(r.right), h: Math.round(r.height), visible: !e.hidden && r.width > 0 && r.bottom <= window.innerHeight }; };
      return { p1: line("txPeek1"), p2: line("txPeek2"), p3: line("txPeek3"), vw: window.innerWidth, hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    await p.screenshot({ path: path.join(OUT, `${name}-360-collapsed.png`) });
    const ends = f.p2.text.match(/(\w{3} \d+ [AP]M) through (\w{3} )?(\d+ [AP]M)/);
    check(`(360 px) ${name}: collapsed lines '${f.p1.text}' / '${f.p2.text}' / '${f.p3.text}'; rain window ${ends ? "both ends shown" : "NOT found"}, cut off: ${f.p1.cut || f.p2.cut || f.p3.cut}`,
      !errs.length && count.n > 0 && ends && !f.p2.cut && !f.p1.cut && !f.p3.cut && f.p2.visible && f.p2.right <= f.vw && !f.hscroll, { f, errs, count });
    await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, "highlights-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
