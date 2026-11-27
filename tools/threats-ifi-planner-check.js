#!/usr/bin/env node
/* Event Planner "Modeled icing along your route" (NOAA IFI) on a deployment, from the saved official records
   (tests/fixtures/threats/ifi, cycle 2026-11-23 01Z, replay clock 02Z), so the case repeats after the live cycle is gone.
   Route: Atlanta (KATL) to St. Louis (KSTL), 483 miles; event at Busch Stadium (America/Chicago).
     node tools/threats-ifi-planner-check.js https://<host> [OUT_DIR]
   Cases: 15,000 ft, in the air 9:45-10:15 p.m. CST (probability and severity findings, approximate times, the other field at
   the same cell); 5,000 ft (none: altitude changes it); 12:45-1:15 a.m. (no probability finding: flight time changes it);
   10,000 ft (not in the saved records: a visible coverage gap, not complete); no times of its own (potential overlap); each
   finding's View on map opens that field, height, valid time and spot and reads the same value. */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/ifi-planner-check");
if (!HOST) { console.error("usage: threats-ifi-planner-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 600))); };
const EV = encodeURIComponent(JSON.stringify({ n: "Cardinals night game", v: { name: "Busch Stadium", lat: 38.6226, lon: -90.1928 }, z: "America/Chicago", t: { start: "2026-11-23T11:00", end: "2026-11-23T14:00" }, g: 25 }));
const AIR = (a) => encodeURIComponent(JSON.stringify([{ i: "KSTL", r: "p", a, d: null }]));
const RT = (lo, hi, w) => encodeURIComponent(JSON.stringify({ o: "KATL", d: "KSTL", lo, hi, w }));
const A1 = ["2026-11-22T21:45", "2026-11-22T22:15"], A2 = ["2026-11-23T00:45", "2026-11-23T01:15"];
(async () => {
  const b = await chromium.launch(), out = { host: HOST, at: new Date().toISOString(), cases: {} };
  for (const phone of [false, true]) {
    const tag = phone ? "phone" : "desktop";
    const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1100 } });
    async function planner(name, rt, air) {
      const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(HOST + "/event-beta?ifisrc=fixture&air=" + air + "&rt=" + rt + "&e=" + EV, { waitUntil: "domcontentloaded" });
      await p.waitForSelector("[data-ifi-check]", { timeout: 120000 }); const btn = await p.locator("[data-ifi-check]").innerText();
      await p.click("[data-ifi-check]"); await p.waitForSelector(".et-ifi[data-ifi-complete], [data-ifi-state=failed]", { timeout: 180000 });
      const r = await p.evaluate(() => { const g = document.querySelector(".et-ifi"), L = (k) => [...g.querySelectorAll(`[data-ifi-list=${k}] .et-head`)].map((x) => x.textContent), Q = (k) => [...g.querySelectorAll(`[data-ifi-list=${k}] .et-line`)].map((x) => x.textContent);
        return { complete: g.dataset.ifiComplete, meta: (g.querySelector(".et-ifimeta") || {}).textContent || "", prob: L("prob"), probLines: Q("prob"), sev: L("sev"), sevLines: Q("sev"),
          none: [...g.querySelectorAll("[data-kind=ifi-none]")].map((x) => x.textContent), gaps: [...g.querySelectorAll("[data-kind=ifi-gap]")].map((x) => x.textContent), maps: [...g.querySelectorAll("[data-ifi-map]")].map((a) => ({ k: a.dataset.ifiMap, href: a.href })),
          badge: (g.querySelector(".et-badge-ifi") || {}).textContent, gtgBadge: (document.querySelector(".et-mc > .et-mch .et-badge") || {}).textContent, turbBtn: !!document.querySelector(".et-mc [data-gtg-check]"), hs: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
      r.btn = btn; r.errors = errs; out.cases[tag + " " + name] = r; return { p, r };
    }
    const base = await planner("15,000 ft, 9:45-10:15 p.m.", RT(15000, 15900, A1), AIR(["2026-11-22T22:15", "2026-11-22T22:45"]));
    check(`(${tag}) BASE: icing probability and modeled severity listed separately, with approximate times, cycle, heights, thresholds; labelled IFI model guidance next to GTG`, base.r.prob.length >= 1 && base.r.sev.length >= 1 && base.r.prob.every((h) => /^Icing probability up to \d+% modeled (about \d+|\d+(–\d+)?) miles from .+, around \d{1,2}(:\d{2})? p\.m\.(–\d{1,2}(:\d{2})? p\.m\.)? \(approximate\), at 15,000 ft · IFI model guidance$/.test(h)) && base.r.sev.every((h) => /^Modeled (moderate|severe) icing .+ \(approximate\), at 15,000 ft · IFI model guidance$/.test(h)) && /Cycle 01Z Nov 23 \(saved official NOAA records; replay clock/.test(base.r.meta) && /thresholds: icing probability 40% or more; modeled severity moderate or worse/.test(base.r.meta) && /heights checked 15,000 ft/.test(base.r.meta) && base.r.badge === "Model guidance · NOAA IFI" && base.r.gtgBadge === "Model guidance · NOAA" && base.r.turbBtn === true && base.r.complete === "true" && /^Check icing \(about \d+ MB\)$/.test(base.r.btn) && !base.r.hs && !base.r.errors.length, base.r);
    check(`(${tag}) BASE: each finding says what the other field is at the same spot, height and valid time`, base.r.probLines.every((l) => /At the same spot, height and valid time, modeled severity is (none|trace|light|moderate|severe) \(code \d\)\./.test(l)) && base.r.sevLines.every((l) => /At the same spot, height and valid time, icing probability is \d+%\./.test(l)), { p: base.r.probLines[0], s: base.r.sevLines[0] });
    // View on map: the field, height, valid time and spot of each kind of finding, and the same value there
    for (const k of ["prob-0", "sev-0"]) {
      const m0 = base.r.maps.find((m) => m.k === k), u = new URL(m0.href), q = await ctx.newPage(), errs = []; q.on("pageerror", (e) => errs.push(e.message));
      await q.goto(m0.href.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" });
      await q.waitForFunction(() => window.__threats && window.__threats.ready && ["ok", "unavailable"].includes(window.__threats.ifi.state), null, { timeout: 120000 }); await q.waitForTimeout(1200);
      const f = u.searchParams.get("focus").split(",").map(Number), m = await q.evaluate((f) => { const T = window.__threats, I = T.ifi; return { state: I.state, key: I.key, field: T.S.ifi.field, level: I.dec && I.dec.product.level, fh: I.dec && I.dec.product.forecast, valid: I.dec && I.dec.validTime, at: I.at(f[0], f[1]), inView: T.map.getBounds().contains(f), banner: document.getElementById("txBarText").textContent }; }, f);
      const lines = k.startsWith("prob") ? base.r.probLines : base.r.sevLines, want = k.startsWith("prob") ? Number(/peak icing probability (\d+)%/.exec(lines[0])[1]) : /peak severity (\w+) \(code (\d)\)/.exec(lines[0])[2];
      const got = k.startsWith("prob") ? m.at && Math.round(m.at.value * 100) : m.at && String(m.at.code);
      check(`(${tag}) View on map (${k.startsWith("prob") ? "probability" : "severity"}): the same field, 15,000 ft, valid 04Z, centred on the spot, reading the finding's value there (${k.startsWith("prob") ? want + "%" : "code " + want}); readout in percent; banner names the saved NOAA guidance`,
        m.state === "ok" && m.field === u.searchParams.get("ifield") && m.level === 4572 && m.valid === "2026-11-23T04:00:00.000Z" && m.inView && String(got) === String(want) && (k.startsWith("sev") || /^icing probability \d+%$/.test(m.at.text)) && /saved official NOAA guidance \((GTG, )?IFI/.test(m.banner) && !errs.length, { m, want, got, errs });
      if (k === "prob-0") await q.screenshot({ path: path.join(OUT, `map-icing-finding-${tag}.png`) }); await q.close();
    }
    await base.p.locator(".et-ifi").scrollIntoViewIfNeeded(); await base.p.locator(".et-ifi .et-more").first().click().catch(() => {});
    await base.p.locator("#secThreats").screenshot({ path: path.join(OUT, `planner-icing-${tag}.png`) }).catch(() => base.p.screenshot({ path: path.join(OUT, `planner-icing-${tag}.png`), fullPage: true })); await base.p.close();
    const low = await planner("5,000 ft, 9:45-10:15 p.m.", RT(5000, 5900, A1), AIR(["2026-11-22T22:15", "2026-11-22T22:45"]));
    check(`(${tag}) ALTITUDE changes the result: 5,000 ft has no finding; both quiet lines name what was sampled and the threshold`, !low.r.prob.length && !low.r.sev.length && /^No icing probability of 40% or more found at the sampled heights and times: 5,000 ft at 10 p\.m\. \(highest \d+%\)\.$/.test(low.r.none[0] || "") && /^No modeled moderate or worse icing found at the sampled heights and times: 5,000 ft at 10 p\.m\. \(highest: \w+\)\.$/.test(low.r.none[1] || "") && low.r.complete === "true", low.r); await low.p.close();
    const late = await planner("15,000 ft, 12:45-1:15 a.m.", RT(15000, 15900, A2), AIR(["2026-11-23T01:15", "2026-11-23T01:45"]));
    check(`(${tag}) FLIGHT TIME changes the result: at 12:45-1:15 a.m. no probability finding, and the severity findings differ`, !late.r.prob.length && /^No icing probability of 40% or more found at the sampled heights and times: 15,000 ft at 1 a\.m\./.test(late.r.none[0] || "") && JSON.stringify(late.r.sev) !== JSON.stringify(base.r.sev) && late.r.complete === "true", late.r); await late.p.close();
    const gap = await planner("10,000 ft (not saved)", RT(10000, 10900, A1), AIR(["2026-11-22T22:15", "2026-11-22T22:45"]));
    check(`(${tag}) UNAVAILABLE RECORD stays visible as a coverage gap: 10,000 ft names both fields as unread; not complete; no quiet 'none'`, gap.r.complete === "false" && gap.r.gaps.some((t) => /^Couldn't read IFI icing probability and severity for 10,000 ft at 10 p\.m\. \(not in the saved records\): those heights and hours are unknown\.$/.test(t)) && !gap.r.none.length && !gap.r.prob.length && !gap.r.sev.length, gap.r); await gap.p.close();
    const loose = await planner("no times of its own (arrival window)", RT(15000, 15900, null), AIR(A1));
    check(`(${tag}) NO TIMES IN THE AIR: potential overlaps with valid times, no encounter time`, loose.r.prob.length >= 1 && loose.r.prob.concat(loose.r.sev).every((h) => /^Potential overlap: .+ valid 10 p\.m\. · IFI model guidance$/.test(h) && !/around/.test(h)) && /potential overlaps during your arrival at KSTL window/.test(loose.r.meta), loose.r);
    await loose.p.close(); await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "ifi-planner-check.json"), JSON.stringify({ ...out, results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
