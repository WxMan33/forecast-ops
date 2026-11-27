#!/usr/bin/env node
/* Event Planner "Modeled turbulence along your route" (NOAA GTG) on a deployment.
   Replay (default; repeatable): the saved official records (tests/fixtures/threats/gtg, cycle 2026-11-23 00Z, replay clock
   02Z), Cincinnati (KCVG) to Newark (KEWR), event at MetLife Stadium (America/New_York):
     10,000 ft, in the air 6:45-7:25 a.m.   a moderate finding about 260-272 miles out, with an approximate time
     FL320, same flight                      none (altitude changes it)
     10,000 ft, 9:45-10:25 a.m.              different findings (the flight window changes it)
     12,000 ft (not saved)                   a visible coverage gap, not complete, no quiet "none"
     10,000 ft, 1:45-2:45 p.m.               past the cycle's last hour (1 p.m.): no forecast, said
     no times of its own                     a potential overlap, no encounter time
   and each finding's View on map opens the same saved record (height, hour, spot) and reads the same value.
   Live (--live): the newest complete cycle through /api/gtg for a flight starting soon; the result is complete or states its
   gaps, and a finding's map link (if any) opens that cycle.
     node tools/threats-gtg-planner-check.js https://<host> [OUT_DIR] [--live] */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2), LIVE = args.includes("--live"), pos = args.filter((a) => !a.startsWith("--"));
const HOST = (pos[0] || "").replace(/\/$/, ""), OUT = path.resolve(pos[1] || "docs/threats/gtg-planner-check");
if (!HOST) { console.error("usage: threats-gtg-planner-check.js https://<host> [OUT_DIR] [--live]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(__dirname, ".."), KEY = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/threats/gtg/gtg-fixture.eccodes.json"), "utf8"));
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 600))); };
const EV = (day) => encodeURIComponent(JSON.stringify({ n: "Jets vs. Bills", v: { name: "MetLife Stadium", lat: 40.8135, lon: -74.0745 }, z: "America/New_York", t: { gates: day + "T11:30", start: day + "T13:00", end: day + "T16:30" }, g: 25 }));
const AIR = (a) => encodeURIComponent(JSON.stringify([{ i: "KEWR", r: "p", a, d: null }]));
const RT = (lo, hi, w) => encodeURIComponent(JSON.stringify({ o: "KCVG", d: "KEWR", lo, hi, w }));
(async () => {
  const b = await chromium.launch(), out = { host: HOST, mode: LIVE ? "live" : "replay", at: new Date().toISOString(), cases: {} };
  for (const phone of [false, true]) {
    const tag = phone ? "phone" : "desktop";
    const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1100 } });
    async function planner(name, q) {
      const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(HOST + "/event-beta?" + q, { waitUntil: "domcontentloaded" });
      await p.waitForSelector("[data-gtg-check]", { timeout: 120000 }); const btn = (await p.locator("[data-gtg-check]").innerText()).replace(/\s+/g, " ").trim();
      await p.click("[data-gtg-check]"); await p.waitForSelector(".et-gtg[data-gtg-complete], [data-gtg-state=failed]", { timeout: 180000 });
      const r = await p.evaluate(() => { const g = document.querySelector(".et-gtg"); return { complete: g.dataset.gtgComplete, meta: (g.querySelector(".et-gtgmeta") || {}).textContent || "",
        heads: [...g.querySelectorAll(".et-gtgitem .et-head")].map((x) => x.textContent), lines: [...g.querySelectorAll(".et-gtgitem .et-line")].map((x) => x.textContent), none: [...g.querySelectorAll("[data-kind=gtg-none]")].map((x) => x.textContent),
        gaps: [...g.querySelectorAll("[data-kind=gtg-gap]")].map((x) => x.textContent), maps: [...g.querySelectorAll("[data-gtg-map]")].map((a) => a.href), badge: (g.querySelector(".et-badge") || {}).textContent, hs: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
      r.btn = btn; r.errors = errs; out.cases[tag + " " + name] = r; return { p, r };
    }
    const mapCheck = async (href) => { const q = await ctx.newPage(), errs = []; q.on("pageerror", (e) => errs.push(e.message));
      await q.goto(href.replace(/^https?:\/\/[^/]+/, HOST).replace("/threats.html", "/threats"), { waitUntil: "domcontentloaded" });
      await q.waitForFunction(() => window.__threats && window.__threats.ready && ["ok", "failed"].includes(window.__threats.gtg.state), null, { timeout: 120000 }); await q.waitForSelector("[data-gtg-status]", { timeout: 90000 }).catch(() => {}); await q.waitForTimeout(800);
      const u = new URL(href), f = u.searchParams.get("focus").split(",").map(Number);
      const m = await q.evaluate((f) => { const T = window.__threats, g = T.gtg; return { state: g.state, key: g.key, ref: g.dec && g.dec.refTime, level: g.dec && g.dec.product.level, fh: g.dec && g.dec.product.forecast, at: g.at(f[0], f[1]), inView: T.map.getBounds().contains(f), status: (document.querySelector("[data-gtg-status]") || {}).textContent || "" }; }, f);
      await q.screenshot({ path: path.join(OUT, `map-finding-${LIVE ? "live-" : ""}${tag}.png`) }); await q.close(); return { m, errs, u }; };
    if (!LIVE) {
      const DAY = "2026-11-23", base = await planner("10,000 ft, 6:45-7:25 a.m.", "gtgsrc=fixture&air=" + AIR([DAY + "T07:25", DAY + "T08:00"]) + "&rt=" + RT(10000, 10900, [DAY + "T06:45", DAY + "T07:25"]) + "&e=" + EV(DAY));
      check(`(${tag}) REPLAY base: a moderate finding about 260-272 miles out at 10,000 ft with an approximate time; saved official records on their replay clock; complete`, base.r.heads.length === 1 && /^Moderate turbulence modeled 260–272 miles from .+, around \d{1,2}:\d{2} a\.m\.(–\d{1,2}:\d{2} a\.m\.)?, at 10,000 ft · GTG model guidance$/.test(base.r.heads[0]) && /peak EDR 0\.24 at 10,000 ft/.test(base.r.lines[0]) && /Cycle 00Z Nov 23 \(saved official NOAA records; replay clock/.test(base.r.meta) && base.r.complete === "true" && /^Check turbulence \(about \d+ MB\)$/.test(base.r.btn) && !base.r.hs && !base.r.errors.length, base.r);
      { const { m, errs } = await mapCheck(base.r.maps[0]), pk = KEY.records["12|3048"].routePeak;
        check(`(${tag}) REPLAY View on map: the same saved record (00Z, +12 h, 10,000 ft = 3,048 m), centred on the spot, reading the finding's peak there: cell (${pk.i}, ${pk.j}) = ${pk.value.toFixed(3)} by ecCodes`, m.state === "ok" && m.key === "2026112300|12|3048" && m.ref === "2026-11-23T00:00:00.000Z" && m.level === 3048 && m.fh === 12 && m.inView && m.at && m.at.i === pk.i && m.at.j === pk.j && Math.abs(m.at.value - pk.value) < 1e-6 && /peak EDR 0\.24 /.test(base.r.lines[0]) && /\(saved official records\)/.test(m.status) && !errs.length, { m, pk, errs }); }
      await base.p.locator(".et-gtg").scrollIntoViewIfNeeded(); await base.p.locator(".et-mc").screenshot({ path: path.join(OUT, `planner-replay-${tag}.png`) }).catch(() => {}); await base.p.close();
      const alt = await planner("FL320", "gtgsrc=fixture&air=" + AIR([DAY + "T07:25", DAY + "T08:00"]) + "&rt=" + RT(32000, 32900, [DAY + "T06:45", DAY + "T07:25"]) + "&e=" + EV(DAY));
      check(`(${tag}) REPLAY altitude changes it: FL320 on the same flight has no finding; the quiet line names FL320 at 7 a.m. and the threshold`, !alt.r.heads.length && /^No modeled turbulence found at the sampled heights and times \(moderate or worse for medium aircraft\): FL320 at 7 a\.m\.( Light turbulence along about \d+% of the route\.)?$/.test(alt.r.none[0] || "") && alt.r.complete === "true", alt.r); await alt.p.close();
      const later = await planner("10,000 ft, 9:45-10:25 a.m.", "gtgsrc=fixture&air=" + AIR([DAY + "T10:25", DAY + "T11:00"]) + "&rt=" + RT(10000, 10900, [DAY + "T09:45", DAY + "T10:25"]) + "&e=" + EV(DAY));
      check(`(${tag}) REPLAY flight window changes it: at 9:45-10:25 a.m. the findings differ (valid 10 a.m.)`, later.r.heads.length >= 1 && JSON.stringify(later.r.heads) !== JSON.stringify(base.r.heads) && later.r.lines.every((l) => /valid 10 a\.m\./.test(l)) && later.r.complete === "true", later.r); await later.p.close();
      const miss = await planner("12,000 ft (not saved)", "gtgsrc=fixture&air=" + AIR([DAY + "T07:25", DAY + "T08:00"]) + "&rt=" + RT(12000, 12900, [DAY + "T06:45", DAY + "T07:25"]) + "&e=" + EV(DAY));
      check(`(${tag}) REPLAY missing coverage: 12,000 ft isn't saved: a visible gap, not complete, no quiet 'none'`, miss.r.complete === "false" && miss.r.gaps.includes("Couldn't read 12,000 ft at 7 a.m. (not in the saved records): those heights and hours are unknown.") && !miss.r.none.length && !miss.r.heads.length, miss.r); await miss.p.close();
      const past = await planner("10,000 ft, 1:45-2:45 p.m.", "gtgsrc=fixture&air=" + AIR([DAY + "T14:45", DAY + "T15:15"]) + "&rt=" + RT(10000, 10900, [DAY + "T13:45", DAY + "T14:45"]) + "&e=" + EV(DAY));
      check(`(${tag}) REPLAY past the cycle's last hour: 'No GTG forecast for 0–569 miles … cycle 00Z Nov 23 reaches 1 p.m.'; not complete`, past.r.complete === "false" && past.r.gaps.some((t) => /^No GTG forecast for 0–569 miles from .+ \(about 1:45 p\.m\. on\): cycle 00Z Nov 23 reaches 1 p\.m\.$/.test(t)) && !past.r.none.length, past.r); await past.p.close();
      const loose = await planner("no times of its own", "gtgsrc=fixture&air=" + AIR([DAY + "T06:45", DAY + "T07:25"]) + "&rt=" + RT(10000, 10900, null) + "&e=" + EV(DAY));
      check(`(${tag}) REPLAY no times in the air: a potential overlap valid 7 a.m., no encounter time`, loose.r.heads.length === 1 && /^Potential overlap: moderate turbulence modeled 260–272 miles from .+ at 10,000 ft, valid 7 a\.m\. · GTG model guidance$/.test(loose.r.heads[0]) && /When you would be there isn't known/.test(loose.r.lines[0]), loose.r); await loose.p.close();
    } else {
      const loc = (ms) => new Date(ms).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16).replace(" ", "T"), now = Date.now(), DAY = loc(now).slice(0, 10);
      const live = await planner("live: FL300-FL360 in the next hours", "air=" + AIR([loc(now + 3 * 3600e3), loc(now + 3.5 * 3600e3)]) + "&rt=" + RT(30000, 36000, [loc(now + 90 * 60e3), loc(now + 3 * 3600e3)]) + "&e=" + EV(DAY));
      const cyc = (/Cycle (\d\d)Z/.exec(live.r.meta) || [])[1];
      check(`(${tag}) LIVE: the newest complete cycle through /api/gtg: heights FL300-FL360 and model hours named; findings or a quiet line naming what was sampled; complete, or every gap stated`, !!cyc && !/pinned|saved/.test(live.r.meta) && /heights checked FL300, FL320, FL340, FL360/.test(live.r.meta) && (live.r.heads.length || /^No modeled turbulence found at the sampled heights and times/.test(live.r.none[0] || "")) && (live.r.complete === "true" || live.r.gaps.length > 0) && !live.r.errors.length, live.r);
      if (live.r.maps.length) { const { m, errs, u } = await mapCheck(live.r.maps[0]), peak = Number(/peak EDR ([\d.]+)/.exec(live.r.lines[0])[1]);
        check(`(${tag}) LIVE View on map: the finding's cycle (pinned), height and hour, reading the same value there`, m.state === "ok" && u.searchParams.get("gcyc") && m.ref && m.ref.slice(11, 13) === cyc && m.at && Math.abs(m.at.value - peak) < 0.006 && !errs.length, { m, peak, errs }); }
      await live.p.close();
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, `gtg-planner-check${LIVE ? "-live" : ""}.json`), JSON.stringify({ ...out, results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
