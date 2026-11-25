/* Shared-beta smoke test for the Threats map (raw.githack.com, branch beta-previews), desktop and phone:
     deployed build: the asset versions githack serves match the commit's own;
     CVG forecast highlights: a lead, a highlight block naming the NWS forecast, the alert status separate, no alert words;
     both rainfall modes: rain that has fallen and rain still to come each draw with their times (or say not responding);
     Active now vs Upcoming: nothing that starts later is drawn on Active now; upcoming alerts are listed when there are any;
     Event Manager: a View on map link opens the intended layer, venue and item.
   raw.githack shows its own "External Content Notice" first; the check clicks "Open the page", as a visitor does.
   Usage: node tools/beta-threats-smoke.js https://raw.githack.com/WxMan33/forecast-ops/beta-previews/ [outDir] [expected threats.js stamp] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2], OUT = path.resolve(process.argv[3] || "docs/threats/beta-smoke"), STAMP = process.argv[4] || null;
if (!BASE) { console.error("usage: node tools/beta-threats-smoke.js <base URL ending in /> [outDir] [stamp]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const CVG = "lat=39.0446&lon=-84.6723&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky");
const E = (name, lat, lon, t) => encodeURIComponent(JSON.stringify({ n: name, v: { name, lat, lon }, z: "America/New_York", t, g: 25 }));
const FRI = { setup: "2026-11-20T09:00", gates: "2026-11-20T11:00", start: "2026-11-20T12:30", end: "2026-11-20T16:00", teardown: "2026-11-20T18:00" };

async function go(p, url) { await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (/External Content Notice/.test(await p.title())) { await p.getByText("Open the page", { exact: false }).first().click(); await p.waitForLoadState("domcontentloaded"); } }
const ready = (p) => p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.map, null, { timeout: 60000 });

(async () => {
  const b = await chromium.launch();
  for (const phone of [false, true]) { const d = phone ? "phone" : "desktop", mk = async () => { const ctx = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message)); return { ctx, p, errs }; };
    // 1. CVG forecast highlights (and the deployed build)
    { const { ctx, p, errs } = await mk(); await go(p, BASE + "threats.html?" + CVG); await ready(p);
      await p.waitForFunction(() => window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(3500);
      const s = await p.evaluate(() => { const head = document.querySelector(".px-olhead"), w = /\b(warning|watch|advisory)\b/i;
        return { stamp: ([...document.scripts].map((x) => x.src).find((x) => /threats\.js\?v=/.test(x)) || "").split("v=")[1], lead: head && head.dataset.lead, big: head && head.querySelector(".px-big").textContent, hl: !!document.querySelector(".px-hl"),
          items: [...document.querySelectorAll(".px-hlitem")].map((x) => x.innerText.replace(/\s+/g, " ")), hlState: (document.querySelector("[data-hl-state]") || { dataset: {} }).dataset.hlState || null,
          status: ((document.querySelector(".px-alert-none") || document.querySelector(".px-sitealerts .px-h")) || {}).textContent || "", sum: document.getElementById("txLayersSum").textContent, badge: document.getElementById("txBadge").textContent,
          alertWords: head && head.dataset.lead === "highlights" ? [head.querySelector(".px-big").textContent, ...[...document.querySelectorAll(".px-hlitem b, .px-olhl")].map((x) => x.textContent)].filter((x) => w.test(x)) : [] }; });
      await p.screenshot({ path: path.join(OUT, `cvg-${d}.png`) });
      if (!phone) check(`deployed build: githack serves threats.js?v=${s.stamp}${STAMP ? " (commit's own: " + STAMP + ")" : ""}`, s.stamp && (!STAMP || s.stamp === STAMP), { s });
      check(`(${d}) CVG forecast highlights: lead '${s.big}' (${s.lead}); ${s.items.length} highlight(s)${s.items[0] ? ": '" + s.items[0].slice(0, 90) + "'" : " (" + s.hlState + ")"}; alert status '${s.status.slice(0, 60)}'; '${s.sum}'`,
        s.hl && (s.items.length ? s.items.every((x) => /NWS forecast \(/.test(x)) : ["none", "missing", "partial"].includes(s.hlState)) && /\S/.test(s.status) && !s.alertWords.length && /^Auto · /.test(s.sum) && s.badge === "LIVE PREVIEW" && !errs.length, { s, errs });
      await ctx.close(); }
    // 2. both rainfall modes
    for (const mode of ["obs24", "fcst"]) { const { ctx, p, errs } = await mk(); await go(p, BASE + "threats.html?" + CVG + "&layers=flood&rain=" + mode + "&view=active&scope=venue"); await ready(p);
      const k = mode === "fcst" ? "fcst" : "obs"; await p.waitForFunction((k) => { const r = window.__threats.rain[k]; return r && (r.meta || r.err); }, k, { timeout: 45000 }).catch(() => {}); await p.waitForTimeout(2500);
      const r = await p.evaluate((k) => { const T = window.__threats, m = T.map, id = k === "obs" ? "rain-obs" : "rain-fcst", row = document.querySelector(`[data-src="${id}"]`);
        return { drawn: !!(m.getLayer(id) && m.getLayoutProperty(id, "visibility") === "visible"), row: row ? row.innerText.replace(/\s+/g, " ") : "", cls: row ? row.className : "", err: T.rain[k].err }; }, k);
      await p.screenshot({ path: path.join(OUT, `rain-${mode}-${d}.png`) });
      check(`(${d}) rainfall · ${k === "obs" ? "rain that has fallen" : "rain still to come"}: ${r.drawn ? "drawn" : "not drawn"}; row '${r.row}'`, (r.drawn && (k === "obs" ? /hours ending \w{3}, /.test(r.row) : /Days 1–3: .+ · issued /.test(r.row))) || (!r.drawn && /Not responding · not drawn/.test(r.row)), { r, errs });
      await ctx.close(); }
    // 3. Active now vs Upcoming (national, every alert layer)
    { const { ctx, p, errs } = await mk(); await go(p, BASE + "threats.html?layers=severe,flood,winter,heat,wind,fire,tropical,coastal&scope=national&view=active"); await ready(p); await p.waitForTimeout(9000);
      const a = await p.evaluate(() => { const T = window.__threats, now = Date.parse(T.data.clock), f = T.map.getSource("active")._data.features || [];
        const up = T.data.products.filter((x) => ["warning", "watch", "advisory", "statement"].includes(x.kind) && Date.parse(x.issued) > now && Date.parse(x.expires) > now);
        return { drawnLater: f.filter((x) => x.properties.later).length, upcoming: up.length, listed: !!document.querySelector("[data-upcoming]"), sample: up.slice(0, 2).map((x) => x.event + " from " + x.issued) }; });
      check(`(${d}) Active now draws nothing that starts later (${a.drawnLater}); ${a.upcoming} upcoming alert(s) live${a.upcoming ? ", listed under Upcoming alerts: " + a.listed + " (" + a.sample.join("; ") + ")" : ""}`, a.drawnLater === 0 && (!a.upcoming || a.listed) && !errs.length, { a, errs });
      await ctx.close(); }
    // 4. Event Manager: a View on map link
    { const { ctx, p, errs } = await mk(); await go(p, BASE + "event-beta.html?threats=archive-flood-day&e=" + E("Daytona International Speedway", 29.1852, -81.0705, FRI));
      await p.waitForFunction(() => window.EventThreatsLast, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(3000);
      const link = await p.evaluate(() => { const a = document.querySelector("#secThreats a[data-map]"); return a ? { href: a.href, text: (a.closest("li") || a).innerText.replace(/\s+/g, " ").slice(0, 80) } : null; });
      await p.screenshot({ path: path.join(OUT, `event-${d}.png`) }); await ctx.close();
      if (!link) { check(`(${d}) Event Manager shows a View on map link`, false, { errs }); continue; }
      const q = new URL(link.href).searchParams, m2 = await mk(); await go(m2.p, link.href); await ready(m2.p); await m2.p.waitForTimeout(3500);
      const s = await m2.p.evaluate(() => { const T = window.__threats; return { layers: Object.keys(T.S.layers).filter((k) => T.S.layers[k]), sel: T.S.sel, view: T.S.view, auto: T.S.auto, venue: T.venue && T.venue.name }; });
      await m2.p.screenshot({ path: path.join(OUT, `event-viewonmap-${d}.png`) });
      check(`(${d}) Event Manager '${link.text.slice(0, 50)}' View on map → layers ${s.layers.join(",")}, view ${s.view}, selected ${s.sel === q.get("sel") ? "as linked" : s.sel}, venue ${s.venue}; Manual`,
        s.layers.join(",") === q.get("layers") && s.sel === q.get("sel") && s.view === q.get("view") && !s.auto && /Daytona/.test(s.venue || "") && !errs.length && !m2.errs.length, { s, q: Object.fromEntries(q), errs: [...errs, ...m2.errs] });
      await m2.ctx.close(); }
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, "beta-smoke.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
