#!/usr/bin/env node
/* Browser check of the shared hourly grid on deterministic fixtures (tests/fixtures/hourly/harness.html): no network.
   Cases: ordinary, overnight, overlapping concerns, multi-day partly beyond the guidance, DST fall-back, missing data;
   the Event Manager view and the Model Blend view; desktop and phone; dark and light.
   Usage: node tools/hourly-grid-check.js <base URL of the repository root, ending in /> <screenshot dir> */
"use strict";
const { chromium, devices } = require("playwright");
const [base, out] = process.argv.slice(2);
const DESK = { viewport: { width: 1280, height: 900 } }, PHONE = { ...devices["iPhone 13"] };
let failed = 0;
const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`); };
(async () => {
  const browser = await chromium.launch();
  const open = async (dev, query) => {
    const ctx = await browser.newContext(dev), p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort()); // fixtures only: nothing leaves the machine
    await p.goto(`${base}tests/fixtures/hourly/harness.html?${query}`, { waitUntil: "load" });
    await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
    return { ctx, p, errors };
  };
  /* what the grid shows, read back from the DOM */
  const read = (p) => p.evaluate(() => {
    const hours = [...document.querySelectorAll(".hg-hb")].map((b) => b.innerText.replace(/\s+/g, " ").trim());
    const days = [...document.querySelectorAll(".hg-day")].map((d) => d.innerText.trim());
    const rows = Object.fromEntries([...document.querySelectorAll("tr.hg-row")].map((tr) => [tr.dataset.row, [...tr.querySelectorAll("td")].map((td) => ({ text: td.querySelector(".hg-v").innerText.trim(), state: [...td.classList].find((c) => c.startsWith("hg-s-")).slice(5), tier: ([...td.classList].find((c) => c.startsWith("hg-t-")) || "").slice(5) || null }))]));
    const labels = [...document.querySelectorAll("tr.hg-row th")].map((th) => th.childNodes[0].textContent.trim());
    return { hours, days, rows, labels, detail: document.getElementById("detail").innerText };
  });

  for (const [theme, dev, devName] of [["dark", DESK, "desktop"], ["light", DESK, "desktop"], ["dark", PHONE, "phone"], ["light", PHONE, "phone"]]) {
    const shots = devName === "phone" ? ["overlap", "dst"] : ["overlap", "multiday"];
    /* ---------- ordinary ---------- */
    { const { ctx, p, errors } = await open(dev, `case=ordinary&theme=${theme}`), g = await read(p);
      report(g.hours[0] === "3 PM EST" && g.hours[g.hours.length - 1] === "9 PM" && g.hours.length === 7 && !Object.keys(g.rows).some((k) => k.startsWith("hz-"))
        && g.rows.concern.every((c) => c.state === "clear" && c.text === "–") && g.rows.phase[3].text === "Setup → Gates :30" && !errors.length,
        `ordinary event (${devName}, ${theme}): setup 3 PM to teardown 10 PM is 7 hours; no concern rows; every hour "no concern identified"; gates at 6:30 shown inside the 6 PM hour`,
        `hours ${g.hours.join(", ")} · phase@6PM "${g.rows.phase[3].text}" · concern row ${[...new Set(g.rows.concern.map((c) => c.state))].join("/")}${errors.length ? " · " + errors.join("; ") : ""}`);
      await ctx.close(); }
    /* ---------- overnight ---------- */
    { const { ctx, p, errors } = await open(dev, `case=overnight&theme=${theme}`), g = await read(p);
      const mid = g.hours.indexOf("12 AM");
      report(g.days.length === 2 && mid > 0 && g.rows.phase[g.rows.phase.length - 1].text === "Teardown to :30" && g.rows.phase[3].text === "Setup → Gates :30" && !errors.length,
        `overnight event (${devName}, ${theme}): two local dates, midnight starts the second; gates at :30 and teardown ending at 2:30 sit inside their hours`,
        `days ${g.days.join(" | ")} · 12 AM at column ${mid} · last phase cell "${g.rows.phase[g.rows.phase.length - 1].text}"${errors.length ? " · " + errors.join("; ") : ""}`);
      await ctx.close(); }
    /* ---------- overlapping concerns: tiers come only from the engine ---------- */
    { const { ctx, p, errors } = await open(dev, `case=overlap&theme=${theme}`), g = await read(p);
      const engine = await p.evaluate(() => { const b = window.__brief, S = window.BetaStory, v = window.__view;
        return v.con.rows.filter((r) => r.key !== "lightning").flatMap((r) => r.cells.map((c, i) => { if (c.state !== "concern") return null;
          const ms = v.span[i], lvl = Math.max(0, ...b.phases.filter((ph) => ph.r && ph.startMs < ms + 3600e3 && ph.endMs > ms).map((ph) => ph.levels[r.key] || 0));
          return { want: S.LEVEL_TIER[lvl], got: c.tier }; }).filter(Boolean)); });
      const at = (h) => g.hours.findIndex((x) => x.startsWith(h));
      const concernRows = ["lightning", "wind", "rain"].filter((k) => g.rows[`hz-${k}`]);
      const tiersUsed = new Set(Object.values(g.rows).flat().map((c) => c.tier).filter(Boolean));
      report(concernRows.length === 3 && g.rows.concern[at("11 PM")].text.endsWith("×3") && g.rows["hz-lightning"][at("11 PM")].tier === "prepare" && g.rows["hz-lightning"][at("10 PM")].tier === "monitor" && Object.keys(g.rows).filter((k) => k.startsWith("hz-")).length === 3
        && engine.length > 0 && engine.every((x) => x.want === x.got) && [...tiersUsed].every((t) => ["monitor", "prepare", "action"].includes(t)) && !errors.length,
        `overlapping concerns (${devName}, ${theme}): lightning, wind and rain each get a row; 11 PM shows all three; every coloured hour matches the engine's phase level (lightning: the hour's thunder tier)`,
        `rows ${concernRows.join(", ")} · 11 PM summary "${g.rows.concern[at("11 PM")].text}" · ${engine.length} coloured hours checked against the engine, ${engine.filter((x) => x.want !== x.got).length} mismatches · tiers ${[...tiersUsed].join(", ")}${errors.length ? " · " + errors.join("; ") : ""}`);
      /* selecting an hour shows its details */
      await p.click(`.hg-hb >> nth=${at("11 PM")}`); const d = await p.evaluate(() => ({ t: document.getElementById("detail").innerText, pressed: [...document.querySelectorAll('.hg-hb[aria-pressed="true"]')].map((b) => b.innerText.replace(/\s+/g, " ")) }));
      report(/11 PM/.test(d.t) && /Lightning/.test(d.t) && /Wind/.test(d.t) && /Rain/.test(d.t) && d.pressed.length === 1 && /11 PM/.test(d.pressed[0]),
        `selecting an hour (${devName}, ${theme}) reveals that hour's concerns and why`, `"${d.t.split("\n").slice(0, 2).join(" / ").slice(0, 160)}"`);
      if (shots.includes("overlap")) await p.screenshot({ path: `${out}/hourly-event-overlap-${devName}-${theme}.png`, fullPage: true });
      /* phone: sticky labels, sideways scrolling, no page overflow */
      if (devName === "phone") {
        const m = await p.evaluate(() => { const sc = document.querySelector(".hg-scroll"); sc.scrollLeft = 400; const lab = document.querySelector("tr.hg-row th").getBoundingClientRect(), box = sc.getBoundingClientRect();
          return { scrolls: sc.scrollWidth > sc.clientWidth, labLeft: Math.round(lab.left - box.left), pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, moved: sc.scrollLeft }; });
        report(m.scrolls && m.moved > 0 && Math.abs(m.labLeft) <= 2 && !m.pageOverflow, `phone (${theme}): hours scroll sideways inside the grid; row labels stay put; the page itself never scrolls sideways`,
          `grid scrolls ${m.scrolls} (scrolled ${m.moved}px) · label offset ${m.labLeft}px · page overflow ${m.pageOverflow}`);
      }
      await ctx.close(); }
    /* ---------- multi-day, partly beyond the guidance ---------- */
    { const { ctx, p, errors } = await open(dev, `case=multiday&theme=${theme}`), g = await read(p);
      const beyond = g.rows.concern.filter((c) => c.state === "missing"), wrong = g.rows.concern.filter((c, i) => c.state === "clear" && g.rows.temp[i].state === "missing");
      const partial = g.rows.concern.filter((c) => c.state === "partial");
      report(g.days.length === 3 && g.hours.length === 60 && beyond.length > 0 && beyond.every((c) => c.text === "n/a") && !wrong.length && partial.length > 0 && partial.every((c) => c.text === "None*") && g.rows.temp.filter((c) => c.state === "missing").every((c) => c.text === "—") && !errors.length,
        `multi-day event (${devName}, ${theme}): 60 hours over three dates; hours beyond the guidance read n/a (never "no concern"); hours without thunder guidance read None*`,
        `${g.days.join(" | ")} · ${beyond.length} beyond · ${partial.length} partial · ${wrong.length} missing hours shown as clear${errors.length ? " · " + errors.join("; ") : ""}`);
      if (shots.includes("multiday")) await p.screenshot({ path: `${out}/hourly-event-multiday-${devName}-${theme}.png` });
      await ctx.close(); }
    /* ---------- DST fall-back ---------- */
    { const { ctx, p, errors } = await open(dev, `case=dst&theme=${theme}`), g = await read(p);
      const ones = g.hours.filter((h) => h.startsWith("1 AM"));
      report(ones.length === 2 && ones[0] === "1 AM EDT" && ones[1] === "1 AM EST" && g.hours.length === 7 && g.rows.phase[g.hours.indexOf("1 AM EST")].text === "Event → Teardown :30" && !errors.length,
        `fall-back night (${devName}, ${theme}): both 1 AM hours appear, labelled EDT and EST; the event ends at the second 1:30`,
        `hours ${g.hours.join(", ")} · 1 AM EST phase "${g.rows.phase[g.hours.indexOf("1 AM EST")] && g.rows.phase[g.hours.indexOf("1 AM EST")].text}"${errors.length ? " · " + errors.join("; ") : ""}`);
      if (shots.includes("dst")) await p.screenshot({ path: `${out}/hourly-event-dst-${devName}-${theme}.png` });
      await ctx.close(); }
    /* ---------- missing data ---------- */
    { const { ctx, p, errors } = await open(dev, `case=missing&theme=${theme}`), g = await read(p);
      const i8 = g.hours.indexOf("8 PM"), i9 = g.hours.indexOf("9 PM");
      const valueRows = ["temp", "feel", "pop", "chance", "qpf", "wind", "gust"];
      report(valueRows.every((k) => g.rows[k][i8].state === "missing" && g.rows[k][i8].text === "—") && g.rows.concern[i8].text === "n/a" && g.rows.pop[i9].state === "missing" && g.rows.temp[i9].state === "ok"
        && g.rows.concern[i9].text === "None*" && g.rows.chance.every((c) => c.state === "missing") && !errors.length,
        `missing data (${devName}, ${theme}): a source gap reads — and n/a (never 0 or "no concern"); one missing field stays missing while the rest show; no ensemble means the ensemble row is missing`,
        `8 PM ${valueRows.map((k) => g.rows[k][i8].text).join(" ")} / concern ${g.rows.concern[i8].text} · 9 PM PoP ${g.rows.pop[i9].text}, temp ${g.rows.temp[i9].text}, concern ${g.rows.concern[i9].text}${errors.length ? " · " + errors.join("; ") : ""}`);
      await ctx.close(); }
    /* ---------- Model Blend view: 24/48/72 hours ---------- */
    for (const hrs of [24, 48, 72]) {
      const { ctx, p, errors } = await open(dev, `case=multiday&view=blend&hours=${hrs}&theme=${theme}&sel=5`), g = await read(p);
      const want = ["Temperature", "Feels like", "Precip chance", "Ensemble ≥0.01″", "Precip amount", "Wind", "Gusts"];
      const ok = g.hours.length === hrs && JSON.stringify(g.labels) === JSON.stringify(want) && /Source \(1\)/i.test(g.detail) && /GFS \(synthetic\)/.test(g.detail) && /hourly PoP/.test(g.detail)
        && g.rows.temp.slice(40).every((c) => c.state === "missing") && !errors.length;
      report(ok, `Model Blend view, next ${hrs} h (${devName}, ${theme}): local time, temperature, feels like, hourly PoP, ensemble threshold probability, amount, wind and gusts; the selected hour lists its sources`,
        `${g.hours.length} hours · rows ${g.labels.join(" | ")} · detail "${g.detail.split("\n")[0]}"${errors.length ? " · " + errors.join("; ") : ""}`);
      if (hrs === 48 && devName === "desktop") await p.screenshot({ path: `${out}/hourly-blend-fixture-${devName}-${theme}.png` });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : "all hourly grid checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
