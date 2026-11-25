/* The site's alert cards on the exact multi-alert screen that must be clearest: a TEST REPLAY with a synthetic Tornado
   Emergency in effect at the site and a synthetic Severe Thunderstorm Warning starting later (both cloned from a saved real NWS
   Tornado Warning), plus whatever live alerts cover the spot. At 1440, 390 and 360 px: the page says TEST REPLAY; every card
   and heading is full width and readable (no one-word columns); nothing overlaps; the bulletin and map links can be tapped;
   upcoming alerts sit under their own heading; the collapsed phone sheet says "Covers this site · until …".
   Usage: node tools/threats-alertlayout-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/alertlayout-check");
if (!HOST) { console.error("usage: node tools/threats-alertlayout-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 1200))); };

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "threats", "nws-archive-kmtr-to-w-0003.json"), "utf8")), f0 = raw.features ? raw.features[0] : raw;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "+00:00"), vt = (ms) => new Date(ms).toISOString().slice(2, 16).replace(/[-:]/g, "") + "Z";
function synth(now, { event, phen, etn, start, end, extra = {} }) {
  const P = JSON.parse(JSON.stringify(f0.properties)); P.id = P.id + "-replay-" + etn; P["@id"] = "https://api.weather.gov/alerts/" + P.id; P.event = event;
  P.sent = P.effective = iso(now - 5 * 60e3); P.onset = iso(start); P.expires = P.ends = iso(end);
  P.parameters = { ...P.parameters, ...extra, eventEndingTime: [iso(end)], VTEC: ["/O.NEW.KMTR." + phen + ".W." + etn + "." + vt(start) + "-" + vt(end) + "/"] };
  P.headline = event + " (TEST REPLAY) issued by NWS San Francisco CA"; return { ...f0, id: P["@id"], properties: P };
}
const ring = f0.geometry.coordinates[0], cx = ring.reduce((a, c) => a + c[0], 0) / ring.length, cy = ring.reduce((a, c) => a + c[1], 0) / ring.length;
const QUERY = `lat=${cy.toFixed(4)}&lon=${cx.toFixed(4)}&name=${encodeURIComponent("Tornado Emergency replay site")}&testreplay=alert-layout-check`;

(async () => {
  const b = await chromium.launch();
  for (const [tag, ctxOpts] of [["desktop", { viewport: { width: 1440, height: 1000 } }], ["p390", { ...devices["iPhone 13"] }], ["p360", { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }]]) {
    const now = Date.now(), feats = [synth(now, { event: "Tornado Warning", phen: "TO", etn: "0903", start: now - 5 * 60e3, end: now + 45 * 60e3, extra: { tornadoDamageThreat: ["CATASTROPHIC"] } }),
      synth(now, { event: "Severe Thunderstorm Warning", phen: "SV", etn: "0904", start: now + 2 * 3600e3, end: now + 3 * 3600e3, extra: { thunderstormDamageThreat: ["CONSIDERABLE"] } })];
    const ctx = await b.newContext(ctxOpts), p = await ctx.newPage(), errs = []; let added = 0, failed = 0;
    p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/\/alerts\/active/, async (r) => { try { const get = () => fetch(r.request().url(), { headers: { Accept: "application/geo+json" } }); let res; try { res = await get(); } catch (e) { res = await get(); } const j = await res.json();
      if (Array.isArray(j.features)) { j.features.unshift(...feats); added++; } const h = {}; res.headers.forEach((v, k) => { if (!/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(k)) h[k] = v; });
      await r.fulfill({ status: res.status, headers: { ...h, "content-type": "application/geo+json", "access-control-allow-origin": "*", "access-control-expose-headers": h["access-control-expose-headers"] || "*" }, body: JSON.stringify(j) }); } catch (e) { failed++; await r.abort(); } });
    await p.goto(HOST + "/threats.html?" + QUERY, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {});
    await p.waitForFunction(() => document.querySelectorAll(".px-sitealerts .px-alert").length >= 2, null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(2500);
    const phone = tag !== "desktop";
    // the collapsed phone sheet first, as a person sees it
    let peek = null;
    if (phone) { peek = await p.evaluate(() => ({ vis: !!document.getElementById("txPeek") && getComputedStyle(document.getElementById("txPeek")).display !== "none", p1: document.getElementById("txPeek1").textContent, p2: document.getElementById("txPeek2").textContent }));
      await p.screenshot({ path: path.join(OUT, `collapsed-${tag}.png`) });
      if (!(await p.locator(".px-sitealerts").isVisible())) { await p.locator("#txPeek").click(); await p.waitForTimeout(900); } }
    const m = await p.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      const strip = document.querySelector(".px-sitealerts"); if (!strip) return null; strip.scrollIntoView({ block: "start" });
      const sw = strip.getBoundingClientRect().width, cards = [...strip.querySelectorAll(".px-alert")], heads = [...strip.querySelectorAll(".px-h")];
      const overlap = []; const all = [...heads, ...cards].map((el) => ({ el, r: el.getBoundingClientRect() }));
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const a = all[i].r, c = all[j].r, ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); if (ix > 1 && iy > 1) overlap.push([all[i].el.className, all[j].el.className, Math.round(ix), Math.round(iy)]); }
      const narrow = []; const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); const ys = new Set([...r.getClientRects()].map((q) => Math.round(q.top))); return ys.size; };
      for (const el of [...heads, ...cards, ...strip.querySelectorAll(".px-alert-h b, .px-alert-s")]) { const r = el.getBoundingClientRect(), parentW = (el.closest(".px-alert") || strip).getBoundingClientRect().width;
        if (el.matches(".px-h, .px-alert") && r.width < 0.9 * sw) narrow.push(["block", el.className, Math.round(r.width), Math.round(sw)]);
        if (el.matches(".px-alert-s") && r.width < 0.6 * parentW) narrow.push(["text", el.textContent.slice(0, 40), Math.round(r.width), Math.round(parentW)]);
        const words = el.textContent.trim().split(/\s+/).length, n = lines(el); if (words >= 4 && n >= words * 0.6) narrow.push(["one word per line", el.textContent.slice(0, 40), n + " lines", words + " words"]); }
      const links = []; for (const a of strip.querySelectorAll(".px-alert-a a, .px-alert-a button")) { a.scrollIntoView({ block: "center" }); const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        links.push({ text: a.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), hit: !!hit && (hit === a || a.contains(hit)) }); }
      strip.scrollIntoView({ block: "start" });
      return { sw: Math.round(sw), cards: cards.map((c) => ({ ...box(c), text: c.innerText.replace(/\s+/g, " ").slice(0, 120) })), heads: heads.map((h) => h.textContent.replace(/\s+/g, " ")), overlap, narrow, links,
        first: cards[0] ? cards[0].innerText.replace(/\s+/g, " ") : "", testNote: !!strip.querySelector(".px-testreplay"), hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    const bar = await p.evaluate(() => ({ badge: document.getElementById("txBadge").textContent, text: document.getElementById("txBarText").textContent, data: (document.querySelector('#demoScenario option[value="live"]') || {}).textContent }));
    await p.screenshot({ path: path.join(OUT, `alerts-${tag}.png`) });
    await p.locator(".px-sitealerts").screenshot({ path: path.join(OUT, `alerts-strip-${tag}.png`) }).catch(() => {});
    check(`(${tag}) TEST REPLAY is marked: badge '${bar.badge}', Data '${bar.data}', note in the alert list${phone ? ", collapsed sheet '" + (peek && peek.p1) + "'" : ""} (${added} answers carried the synthetic alerts, ${failed} failed)`,
      added > 0 && failed === 0 && bar.badge === "TEST REPLAY" && /TEST REPLAY/.test(bar.data) && /TEST REPLAY/.test(bar.text) && m && m.testNote && (!phone || /TEST REPLAY/.test(peek.p1)), { bar, peek, added, failed });
    check(`(${tag}) the Tornado Emergency leads under 'In effect at this site': '${m && m.first.slice(0, 150)}'`, m && /In effect at this site/i.test(m.heads[0] || "") && /Tornado Warning/.test(m.first) && /Tornado Emergency/i.test(m.first) && /Covers this site/.test(m.first) && /until /.test(m.first) && /NWS bulletin/.test(m.first), { m });
    check(`(${tag}) the later Severe Thunderstorm Warning sits under 'Upcoming alerts at this site' (headings: ${m && m.heads.join(" | ")})`, m && m.heads.some((h) => /Upcoming alerts at this site/i.test(h)) && m.cards.some((c) => /Severe Thunderstorm Warning/.test(c.text) && /from /.test(c.text)), { heads: m && m.heads });
    check(`(${tag}) ${m ? m.cards.length : 0} cards, ${m ? m.heads.length : 0} headings: none overlap, all full width (${m && m.sw}px), no one-word columns, no sideways scroll`, m && m.cards.length >= 2 && !m.overlap.length && !m.narrow.length && !m.hscroll, { overlap: m && m.overlap, narrow: m && m.narrow, cards: m && m.cards });
    check(`(${tag}) every 'NWS bulletin' and 'Show on map' link can be tapped (${m ? m.links.length : 0} links, at least 24 px tall and on top)`, m && m.links.length >= 4 && m.links.every((l) => l.hit && l.h >= 24 && l.w >= 40), { links: m && m.links });
    if (phone) check(`(${tag}) collapsed sheet: '${peek && peek.p1}' / '${peek && peek.p2}'`, peek && peek.vis && /Tornado Warning/.test(peek.p1) && /^Covers this site · until /.test(peek.p2) && !/Today · NWS/.test(peek.p2), { peek });
    // the Active now map: the warning that starts later is drawn dashed with a FROM label, not as if in effect
    await p.evaluate(() => { const T = window.__threats; T.S.view = "active"; T.S.sel = null; T.drawAll(); }); await p.waitForTimeout(2000);
    const an = await p.evaluate(() => { const T = window.__threats, m = T.map, f = (m.getSource("active")._data.features || []), L = (m.getSource("labels")._data.features || []);
      const sv = f.find((x) => /0904/.test(x.properties.id || "") || /Severe Thunderstorm Warning/.test(x.properties.text || "") && x.properties.later), to = f.find((x) => /0903/.test(x.properties.id || "") || /Tornado/.test(x.properties.text || ""));
      const svl = L.find((x) => /SEVERE THUNDERSTORM|Severe Thunderstorm/i.test(x.properties.text) && /^FROM /.test(x.properties.text)), tol = L.find((x) => /TORNADO/i.test(x.properties.text));
      const list = [...document.querySelectorAll("#txPanelBody *")].map((x) => x.textContent).find((x) => /Starts .* · until /.test(x)) || "";
      return { svLater: sv && sv.properties.later, svFill: sv && sv.properties.fill, toLater: to && to.properties.later, svLabel: svl && svl.properties.text, toLabel: tol && tol.properties.text, laterLayer: !!m.getLayer("later-line") && m.getLayoutProperty("later-line", "visibility") !== "none", list: list.slice(0, 120) }; });
    await p.screenshot({ path: path.join(OUT, `active-now-${tag}.png`) });
    check(`(${tag}) Active now: the upcoming warning is drawn dashed and faint with '${an.svLabel}'; the warning in effect is not ('${an.toLabel}'); lists say '${an.list.slice(0, 70)}'`,
      an.svLater === true && an.svFill < 0.1 && an.toLater !== true && /^FROM \d/.test(an.svLabel || "") && !/^FROM /.test(an.toLabel || "") && an.laterLayer && /Starts .* · until /.test(an.list), { an });
    check(`(${tag}) no page errors`, !errs.length, { errs });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, "alertlayout-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
