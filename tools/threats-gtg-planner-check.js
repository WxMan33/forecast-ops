#!/usr/bin/env node
/* Event Planner "Modeled turbulence along your route" (NOAA GTG) on a deployment, with a pinned recent cycle so the cases
   repeat: Cincinnati (KCVG) to Newark (KEWR), cycle 2026-11-23 00Z (NOMADS keeps about two days; pass another with
   --cycle and matching times once it has gone).
     node tools/threats-gtg-planner-check.js https://<host> [OUT_DIR]
   Cases: 6,000-12,000 ft, in the air 7-8 a.m. EST (a finding, with a time); FL240-FL360 (none: altitude changes it);
   10-11 a.m. (none: the window changes it); noon-3 p.m. (past the cycle's 18 hours: incomplete, said); no times of its own
   (a potential overlap, no time); each finding's View on map opens that height, hour, cycle and spot. */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/gtg-planner-check");
const CYC = (process.argv.find((a) => a.startsWith("--cycle=")) || "--cycle=2026112300").slice(8), DAY = CYC.slice(0, 4) + "-" + CYC.slice(4, 6) + "-" + CYC.slice(6, 8);
if (!HOST) { console.error("usage: threats-gtg-planner-check.js https://<host> [OUT_DIR] [--cycle=YYYYMMDDHH]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 500))); };
const EV = encodeURIComponent(JSON.stringify({ n: "Jets vs. Bills", v: { name: "MetLife Stadium", lat: 40.8135, lon: -74.0745 }, z: "America/New_York", t: { gates: DAY + "T11:30", start: DAY + "T13:00", end: DAY + "T16:30" }, g: 25 }));
const AIR = (a) => encodeURIComponent(JSON.stringify([{ i: "KEWR", r: "p", a, d: null }]));
const RT = (lo, hi, w) => encodeURIComponent(JSON.stringify({ o: "KCVG", d: "KEWR", lo, hi, w, c: undefined }));
(async () => {
  const b = await chromium.launch(), out = { host: HOST, cycle: CYC, at: new Date().toISOString(), cases: {} };
  for (const phone of [false, true]) {
    const tag = phone ? "phone" : "desktop";
    const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1100 } });
    async function planner(name, rt, air) {
      const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(HOST + "/event-beta?gtgcyc=" + CYC + "&air=" + air + "&rt=" + rt + "&e=" + EV, { waitUntil: "domcontentloaded" });
      await p.waitForSelector("[data-gtg-check]", { timeout: 120000 }); const btn = await p.locator("[data-gtg-check]").innerText();
      await p.click("[data-gtg-check]"); await p.waitForSelector(".et-gtg[data-gtg-complete], [data-gtg-state=failed]", { timeout: 180000 });
      const r = await p.evaluate(() => { const g = document.querySelector(".et-gtg"); return { btnText: null, complete: g.dataset.gtgComplete, meta: (g.querySelector(".et-gtgmeta") || {}).textContent || "",
        heads: [...g.querySelectorAll(".et-gtgitem .et-head")].map((x) => x.textContent), lines: [...g.querySelectorAll(".et-gtgitem .et-line")].map((x) => x.textContent), none: [...g.querySelectorAll("[data-kind=gtg-none]")].map((x) => x.textContent),
        gaps: [...g.querySelectorAll("[data-kind=gtg-gap]")].map((x) => x.textContent), maps: [...g.querySelectorAll("[data-gtg-map]")].map((a) => a.href), badge: (g.querySelector(".et-badge") || {}).textContent, routeHeads: [...document.querySelectorAll("#etRouteHead ~ .et-route > .et-list .et-head")].map((x) => x.textContent),
        hs: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
      r.btnText = btn; r.errors = errs; out.cases[tag + " " + name] = r; return { p, r };
    }
    const base = await planner("6,000-12,000 ft, 7-8 a.m.", RT(6000, 12000, [DAY + "T07:00", DAY + "T08:00"]), AIR([DAY + "T08:00", DAY + "T08:45"]));
    check(`(${tag}) BASE: a modeled finding along the route with an estimated time, the cycle, valid time and height; labelled model guidance, apart from advisories`, base.r.heads.length >= 1 && /^Moderate turbulence modeled \d+(–\d+)? miles from .+, around \d{1,2}:\d{2} a\.m\.(–\d{1,2}:\d{2} a\.m\.)?, at [\d,]+ ft(, [\d,]+ ft)* · GTG model guidance$/.test(base.r.heads[0]) && /NOAA GTG cycle 00Z/.test(base.r.lines[0]) && /valid 7 a\.m\./.test(base.r.lines[0]) && base.r.badge === "Model guidance · NOAA GTG" && /pinned for this check/.test(base.r.meta) && base.r.complete === "true" && /^Check modeled turbulence \(about \d+ MB\)$/.test(base.r.btnText) && !base.r.hs && !base.r.errors.length, base.r);
    // the finding's View on map: that height, hour, cycle and spot; the map reads the same value there
    { const href = base.r.maps[0], u = new URL(href), q = await ctx.newPage(), errs = []; q.on("pageerror", (e) => errs.push(e.message));
      await q.goto(href.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" });
      await q.waitForFunction(() => window.__threats && window.__threats.ready && ["ok", "failed"].includes(window.__threats.gtg.state), null, { timeout: 120000 }); await q.waitForTimeout(1500);
      const f = u.searchParams.get("focus").split(",").map(Number), m = await q.evaluate((f) => { const T = window.__threats, g = T.gtg; return { state: g.state, key: g.key, cyc: g.dec && g.dec.refTime, level: g.dec && g.dec.product.level, fh: g.dec && g.dec.product.forecast, at: g.at(f[0], f[1]), inView: T.map.getBounds().contains(f), cls: T.S.gtg.cls }; }, f);
      const peak = Number(/peak EDR ([\d.]+)/.exec(base.r.lines[0])[1]);
      check(`(${tag}) the finding's View on map opens GTG at its height, hour and pinned cycle, centred on the spot, reading the same value there`, m.state === "ok" && m.cyc === new Date(Date.UTC(+CYC.slice(0, 4), +CYC.slice(4, 6) - 1, +CYC.slice(6, 8), +CYC.slice(8))).toISOString() && m.fh === +u.searchParams.get("gfh") && m.inView && m.at && Math.abs(m.at.value - peak) < 0.006 && !errs.length, { m, peak, errs });
      await q.screenshot({ path: path.join(OUT, `map-finding-${tag}.png`) }); await q.close(); }
    await base.p.locator(".et-gtg").scrollIntoViewIfNeeded(); await base.p.locator(".et-more").filter({ hasText: "More info" }).last().click().catch(() => {});
    await base.p.locator("#secThreats").screenshot({ path: path.join(OUT, `planner-${tag}.png`) }).catch(() => base.p.screenshot({ path: path.join(OUT, `planner-${tag}.png`), fullPage: true })); await base.p.close();
    const alt = await planner("FL240-FL360, 7-8 a.m.", RT(24000, 36000, [DAY + "T07:00", DAY + "T08:00"]), AIR([DAY + "T08:00", DAY + "T08:45"]));
    check(`(${tag}) ALTITUDE changes the result: FL240-FL360 on the same flight has no moderate turbulence modeled; checked heights named`, !alt.r.heads.length && /^No modeled turbulence found at the sampled heights and times \(moderate or worse for medium aircraft\): FL240, FL280, FL320 and FL360 at 7 a\.m\. and 8 a\.m\.( Light turbulence along about \d+% of the route\.)?$/.test(alt.r.none[0] || "") && /FL240, FL280, FL320, FL360/.test(alt.r.meta) && alt.r.complete === "true", alt.r); await alt.p.close();
    const later = await planner("6,000-12,000 ft, 10-11 a.m.", RT(6000, 12000, [DAY + "T10:00", DAY + "T11:00"]), AIR([DAY + "T11:00", DAY + "T11:45"]));
    check(`(${tag}) FLIGHT WINDOW changes the result: the same band 10-11 a.m. has none`, !later.r.heads.length && /^No modeled turbulence found at the sampled heights and times \(moderate or worse for medium aircraft\): 6,000 ft, 8,000 ft, 10,000 ft and 12,000 ft at 10 a\.m\. and 11 a\.m\.( Light turbulence along about \d+% of the route\.)?$/.test(later.r.none[0] || "") && /model hours 10 a\.m\., 11 a\.m\./.test(later.r.meta) && later.r.complete === "true", later.r); await later.p.close();
    const past = await planner("6,000-12,000 ft, noon-3 p.m.", RT(6000, 12000, [DAY + "T12:00", DAY + "T15:00"]), AIR([DAY + "T15:00", DAY + "T15:30"]));
    check(`(${tag}) INCOMPLETE COVERAGE: a flight past the cycle's last hour (1 p.m. EST) says which part has no forecast; not complete`, past.r.complete === "false" && (!past.r.none.length || /^No modeled turbulence found at the sampled heights and times that could be checked/.test(past.r.none[0])) && past.r.gaps.some((t) => /^No GTG forecast for \d+–\d+ miles from .+ \(about 1:\d{2} p\.m\. on\): cycle 00Z Nov \d+ reaches 1 p\.m\.$/.test(t) && !/\.\.$/.test(t)), past.r); await past.p.close();
    const loose = await planner("no times of its own (arrival window)", RT(6000, 12000, null), AIR([DAY + "T07:00", DAY + "T08:00"]));
    check(`(${tag}) NO TIMES IN THE AIR: findings are a potential overlap during the arrival window, with valid times but no encounter time`, loose.r.heads.length >= 1 && loose.r.heads.every((h) => /^Potential overlap: moderate turbulence modeled .+ valid .+ · GTG model guidance$/.test(h) && !/around/.test(h)) && /potential overlaps during your arrival at KEWR window/.test(loose.r.meta) && /When you would be there isn't known/.test(loose.r.lines[0]), loose.r);
    await loose.p.close(); await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "gtg-planner-check.json"), JSON.stringify({ ...out, results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
