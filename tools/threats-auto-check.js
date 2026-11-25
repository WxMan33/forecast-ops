/* Auto for the site, the active-alert strip, Flooding as a group, decluttered labels and rapid site changes, against a hosted page.
   Cases (desktop and phone where it matters):
     quiet CVG; WPC-only rainfall risk (NWS flood alerts removed from the feed, site inside a live WPC area); SPC-only risk (same,
     severe); active flooding at a live NWS flood warning (strip, rain that has fallen, gauges); a river gauge near a site at or
     forecast to reach action stage with no warning (when one exists live); a critical-alert replay (a saved NWS Tornado Warning,
     times moved to now and marked catastrophic = Tornado Emergency: synthetic, labelled); A -> B -> A site changes with B's
     answers held back and arriving last; Return to Auto; links that name layers stay manual.
   Usage: node tools/threats-auto-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/auto-check");
if (!HOST) { console.error("usage: node tools/threats-auto-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const site = (name, lat, lon) => `lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}&name=${encodeURIComponent(name)}`;
const CVG = site("CVG airport, Cincinnati/Northern Kentucky", 39.0446, -84.6723), DEN = site("Denver, CO", 39.7392, -104.9903);
const ALERTS = /\/alerts\/active/; // NWS alerts, national list and point check (through /api/nws or api.weather.gov)

async function open(b, phone, query, setup) {
  const ctx = await b.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); if (setup) await setup(p);
  await p.goto(HOST + "/threats.html" + (query ? "?" + query : ""), { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.map, null, { timeout: 60000 });
  return { ctx, p, errs };
}
const settle = async (p, ms = 3000) => { await p.waitForFunction(() => window.__threats.outlook && ["ok", "failed"].includes(window.__threats.outlook.state), null, { timeout: 120000 }).catch(() => {}); await p.waitForTimeout(ms); };
const st = (p) => p.evaluate(() => { const T = window.__threats, S = T.S, m = T.map, vis = (id) => !!(m.getLayer(id) && m.getLayoutProperty(id, "visibility") === "visible");
  const strip = document.querySelector(".px-strip"), sec = (re) => [...document.querySelectorAll(".px-strip .px-h")].find((h) => re.test(h.textContent));
  const labels = (m.getSource("labels") && m.getSource("labels")._data && m.getSource("labels")._data.features) || [];
  return { alertsState: (T.data.sources.alerts || {}).state, auto: S.auto, scope: S.scope, view: S.view, need: S.autoNeed, rain: S.rain, layers: Object.keys(S.layers).filter((k) => S.layers[k]), radar: S.radar, zoom: +m.getZoom().toFixed(2), venue: T.venue && { name: T.venue.name, lat: T.venue.lat, lon: T.venue.lon },
    sum: (document.getElementById("txLayersSum") || {}).textContent || "", valid: (document.getElementById("txValid") || {}).textContent || "", strip: strip ? strip.innerText.replace(/\s+/g, " ") : "",
    atSite: !!sec(/In effect at this site/), nearby: !!sec(/Nearby/), head: ((document.querySelector(".px-olhead .px-where") || {}).textContent || ""), quiet: [...document.querySelectorAll(".px-olquiet")].map((x) => x.textContent),
    gaugesDrawn: (m.getSource("gauge") && m.getSource("gauge")._data.features.length) || 0, siteGauges: [...document.querySelectorAll("[data-gauge]")].map((x) => x.innerText.replace(/\s+/g, " ").slice(0, 500)),
    rainObs: vis("rain-obs"), rainFcst: vis("rain-fcst"), labelsUrgent: labels.filter((f) => f.properties.lk === "urgent").length, labelsAll: labels.length, oKey: T.outlook && T.outlook.key, oOffice: T.outlook && T.outlook.data && T.outlook.data.gridInfo && T.outlook.data.gridInfo.office, errors: T.errors.map((e) => e.stage + ": " + e.message) }; });
/* rewrite NWS alerts answers (national list and point check). The answer is fetched by Node (the test browser's own request
   context can't reach the preview here), and every rewrite is counted, so a silent pass-through can't count as a pass. */
const tally = { dropped: 0, added: 0, rewrites: 0, failed: 0 };
const rewriteAlerts = (fn) => async (p) => { await p.route(ALERTS, async (r) => {
  try { const q = r.request(), get = () => fetch(q.url(), { headers: { Accept: "application/geo+json" } }); let res; try { res = await get(); } catch (e) { res = await get(); } const j = await res.json(); // one retry for a dropped fetch
    if (Array.isArray(j.features)) { fn(j); tally.rewrites++; }
    // keep the forwarder's own headers (the page requires X-Upstream-Fetched-At from /api/nws and refuses an answer without it)
    const h = {}; res.headers.forEach((v, k) => { if (!/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(k)) h[k] = v; });
    await r.fulfill({ status: res.status, headers: { ...h, "content-type": "application/geo+json", "access-control-allow-origin": "*", "access-control-expose-headers": h["access-control-expose-headers"] || "*" }, body: JSON.stringify(j) });
  } catch (e) { tally.failed++; await r.abort(); } }); };
const dropFamily = (re) => rewriteAlerts((j) => { const n0 = j.features.length; j.features = j.features.filter((f) => !re.test((f.properties || {}).event || "")); tally.dropped += n0 - j.features.length; });

(async () => {
  const b = await chromium.launch();
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + ".png") });

  /* 1. quiet CVG: a fresh visit opens on the site in Auto, strip and wording */
  for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
    const v = await open(b, phone, CVG); await settle(v.p); const s = await st(v.p); await shot(v.p, `after-fresh-cvg-${d}`);
    check(`(${d}) QUIET CVG: fresh visit opens on the site (scope ${s.scope}, zoom ${s.zoom}) in Auto; summary '${s.sum}'; strip '${s.strip.slice(0, 120)}'; time label '${s.valid.slice(0, 120)}'`,
      s.auto && s.scope === "venue" && s.zoom >= 6.5 && /^Auto · /.test(s.sum) && /In effect at this site|No NWS warning, watch or advisory in effect at this site/.test(s.strip) && /map: alerts in effect now/.test(s.valid) && s.radar
      && (s.quiet.length === 0 || s.quiet.every((q) => /No significant hazards identified|Not fully checked/.test(q))) && !s.quiet.some((q) => /No threats expected/.test(q)) && !v.errs.length && !s.errors.length, { s, errs: v.errs });
    if (!phone) { await v.p.click("[data-scope=\"national\"]"); await v.p.waitForTimeout(2500); const n = await st(v.p); await shot(v.p, "after-national-desktop");
      check(`(${d}) National one tap away: scope ${n.scope}, ${n.labelsUrgent} urgent labels of ${n.labelsAll} (advisory text waits for zoom)`, n.scope === "national" && n.auto, { n }); }
    await v.ctx.close(); }

  /* 2. forecast-only triggers: a site inside a live forecast area, with that family's NWS alerts removed from every answer */
  const probe = await open(b, false, "layers=severe,flood&scope=national&view=day1"); await probe.p.waitForTimeout(9000);
  const areas = await probe.p.evaluate(() => { const T = window.ThreatsCore, ps = window.__threats.data.products;
    const pick = (f) => { const p = ps.filter((x) => x.kind === "outlook" && x.geometry && f(x) && x.day <= 3).sort((a, b) => T.areaKm2 ? T.areaKm2(b.geometry) - T.areaKm2(a.geometry) : 0)[0]; if (!p) return null;
      const b = T.bbox(p.geometry); for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) { const pt = [b[0] + (b[2] - b[0]) * i / 30, b[1] + (b[3] - b[1]) * j / 30]; if (T.contains(p.geometry, pt) && pt[0] > -125 && pt[0] < -66 && pt[1] > 24 && pt[1] < 50) return { lat: pt[1], lon: pt[0], what: (p.program || "") + " Day " + p.day + " " + p.category }; } return null; };
    return { ero: pick((x) => x.family === "flood"), spc: pick((x) => x.program === "spc" && ["MRGL", "SLGT", "ENH", "MDT", "HIGH"].includes(x.category)) }; });
  await probe.ctx.close();
  for (const [label, a, re, need, extra] of [["WPC-only rainfall risk", areas.ero, /Flood|Hydrologic/i, "flood", (s) => s.rain.fcst && !s.rain.obs && s.rainFcst],
                                             ["SPC-only severe risk", areas.spc, /Tornado|Severe Thunderstorm/i, "severe", () => true]]) {
    if (!a) { check(`${label}: no live area right now (case not run)`, true, {}); continue; }
    for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
      const t0 = { ...tally }; const v = await open(b, phone, site(label + " test site", a.lat, a.lon), dropFamily(re)); await settle(v.p, 4500); const s = await st(v.p); await shot(v.p, `after-${need}-only-${d}`);
      const cause = await v.p.evaluate((k) => { const A = window.__threats.siteAssess ? window.__threats.siteAssess() : null; return A && A.cause[k] ? A.cause[k] : null; }, need);
      check(`(${d}) ${label.toUpperCase()} (${a.what} at ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}; ${tally.rewrites - t0.rewrites} alert answers rewritten, ${tally.dropped - t0.dropped} ${need} alerts removed, ${tally.failed - t0.failed} failed): Auto needs ${need} from the forecast only (cause: ${JSON.stringify(cause)}; summary '${s.sum}')`,
        tally.rewrites > t0.rewrites && tally.failed === t0.failed && s.alertsState === "ok" && s.auto && s.need && s.need[need] && cause && cause.every((c) => !/ at the site$| mi [NSEW]{1,3}$/.test(c)) && extra(s) && new RegExp({ flood: "Flooding", severe: "Severe storms" }[need]).test(s.sum) && !v.errs.length, { a, s, cause });
      await v.ctx.close(); } }

  /* 3. active flooding: a live NWS flood warning covering a site (strip, rain that has fallen, gauges in view) */
  { const pr = await open(b, false, "layers=flood&scope=national&view=active"); await pr.p.waitForTimeout(8000);
    const fw = await pr.p.evaluate(() => { const T = window.ThreatsCore, p = window.__threats.data.products.find((x) => x.sourceId === "nws-alerts" && /Flood Warning/.test(x.event || "") && x.geometry && Date.parse(x.expires) > Date.now()); if (!p) return null;
      const b = T.bbox(p.geometry); for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) { const pt = [b[0] + (b[2] - b[0]) * i / 30, b[1] + (b[3] - b[1]) * j / 30]; if (T.contains(p.geometry, pt)) return { lat: pt[1], lon: pt[0], ev: p.event }; } return null; });
    await pr.ctx.close();
    if (!fw) check("ACTIVE FLOODING: no live flood warning with a polygon right now (case not run)", true, {});
    else for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
      const v = await open(b, phone, site("Flood warning test site", fw.lat, fw.lon)); await settle(v.p, 3000);
      await v.p.waitForFunction(() => { const m = window.__threats.map; return m.getLayer("rain-obs") && m.getLayoutProperty("rain-obs", "visibility") === "visible"; }, null, { timeout: 30000 }).catch(() => {}); const s = await st(v.p); await shot(v.p, `after-active-flood-${d}`);
      check(`(${d}) ACTIVE FLOODING at a live ${fw.ev}: strip lists it in effect at the site; Auto · Flooding; rain that has fallen drawn; ${s.gaugesDrawn} gauges drawn`, s.auto && s.atSite && /Flood Warning/.test(s.strip) && s.need.flood && /Flooding/.test(s.sum) && s.rain.obs && s.rainObs && !v.errs.length, { fw, s });
      await v.ctx.close(); } }

  /* 4. a river at or forecast to reach action stage near a site with no flood warning (live, when one exists) */
  { const pr = await open(b, false, "layers=flood&scope=national&view=active"); await pr.p.waitForTimeout(6000);
    const g = await pr.p.evaluate(async () => { const r = await fetch("https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=-125&bbox.ymin=24&bbox.xmax=-66&bbox.ymax=50&srid=EPSG_4326").then((x) => x.json()).catch(() => null); if (!r) return { err: true };
      const T = window.ThreatsCore, warn = window.__threats.data.products.filter((x) => x.sourceId === "nws-alerts" && /Flood Warning/.test(x.event || "") && x.geometry);
      const list = (r.gauges || r || []).filter((x) => x.status && ["action", "minor", "moderate", "major"].some((c) => (x.status.observed || {}).floodCategory === c || (x.status.forecast || {}).floodCategory === c));
      const free = list.find((x) => warn.every((w) => { const b = T.bbox(w.geometry); return x.longitude < b[0] - 1.5 || x.longitude > b[2] + 1.5 || x.latitude < b[1] - 1.5 || x.latitude > b[3] + 1.5; }));
      return { n: list.length, g: free ? { lid: free.lid, name: free.name, lat: +free.latitude, lon: +free.longitude, obs: (free.status.observed || {}).floodCategory, fc: (free.status.forecast || {}).floodCategory } : null }; });
    await pr.ctx.close();
    if (!g || g.err || !g.g) check(`RIVER NEAR A SITE WITHOUT A WARNING: ${g && g.err ? "NWPS list didn't answer" : "no gauge at action stage or higher away from flood warnings right now (" + (g ? g.n : 0) + " at action+)"} (case not run)`, true, { g });
    else { const v = await open(b, false, site("River gauge test site", g.g.lat + 0.03, g.g.lon + 0.03)); await settle(v.p, 6000); await v.p.evaluate(() => { const T = window.__threats; T.S.view = "active"; T.drawAll(); }); await v.p.waitForTimeout(4000); const s = await st(v.p); await shot(v.p, "after-river-gauge-desktop");
      check(`RIVER NEAR A SITE WITHOUT A WARNING: ${g.g.name} (${g.g.lid}; now ${g.g.obs}, forecast ${g.g.fc}): drawn (${s.gaugesDrawn}) and listed with stage, forecast and flood stages: '${(s.siteGauges[0] || "").slice(0, 180)}'`,
        s.gaugesDrawn >= 1 && s.siteGauges.length >= 1 && /now [\d.]+ ft/.test(s.siteGauges[0]) && /forecast/.test(s.siteGauges[0]) && /(flood stage|action) [\d.]+/.test(s.siteGauges[0]) && s.need.flood && !v.errs.length, { g, s });
      await v.ctx.close(); } }

  /* 5. critical-alert replay: a saved NWS Tornado Warning moved to now and marked catastrophic (Tornado Emergency) at the site */
  { const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "threats", "nws-archive-kmtr-to-w-0003.json"), "utf8")), f0 = raw.features ? raw.features[0] : raw;
    const now = Date.now(), iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "+00:00"), vt = (ms) => new Date(ms).toISOString().slice(2, 16).replace(/[-:]/g, "").replace("T", "T") + "Z";
    const P = JSON.parse(JSON.stringify(f0.properties)); P.id = P.id + "-replay"; P["@id"] = "https://api.weather.gov/alerts/" + P.id; P.sent = P.effective = P.onset = iso(now - 5 * 60e3); P.expires = P.ends = iso(now + 40 * 60e3);
    P.parameters = { ...P.parameters, tornadoDamageThreat: ["CATASTROPHIC"], eventEndingTime: [iso(now + 40 * 60e3)], VTEC: ["/O.NEW.KMTR.TO.W.0903." + vt(now - 5 * 60e3) + "-" + vt(now + 40 * 60e3) + "/"] };
    P.headline = "Tornado Warning issued (TORNADO EMERGENCY replay) by NWS San Francisco CA";
    const feat = { ...f0, id: P["@id"], properties: P };
    const ring = f0.geometry.coordinates[0], cx = ring.reduce((a, c) => a + c[0], 0) / ring.length, cy = ring.reduce((a, c) => a + c[1], 0) / ring.length;
    for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
      const t0 = { ...tally }; const v = await open(b, phone, site("Tornado Emergency replay site", cy, cx), rewriteAlerts((j) => { j.features.unshift(feat); tally.added++; }));
      await settle(v.p, 4000); const s = await st(v.p); await shot(v.p, `after-critical-replay-${d}`);
      const first = await v.p.evaluate(() => { const a = document.querySelector(".px-strip .px-alert"); return a ? a.innerText.replace(/\s+/g, " ") : ""; });
      check(`(${d}) CRITICAL-ALERT REPLAY (synthetic: saved KMTR Tornado Warning moved to now, catastrophic tag; added to ${tally.added - t0.added} answers): first in the strip '${first.slice(0, 160)}'; urgent labels ${s.labelsUrgent}; rewrite failures ${tally.failed - t0.failed}`,
        tally.added > t0.added && tally.failed === t0.failed && s.alertsState === "ok" && s.atSite && /\(its NWS zone\)|Covers the site ·/.test(first) && /Tornado Warning/.test(first) && /Tornado Emergency/i.test(first) && /until /.test(first) && /NWS bulletin/.test(first) && s.need.severe && s.labelsUrgent >= 1 && !v.errs.length && !s.errors.length, { s, first, errs: v.errs });
      await v.ctx.close(); } }

  /* 6. A -> B -> A with B's answers held back and arriving last: the panel, outlook and layers stay A's; B's late answer is filed as B's */
  for (const phone of [false, true]) { const d = phone ? "phone" : "desktop";
    let releaseB; const holdB = new Promise((ok) => (releaseB = ok));
    const v = await open(b, phone, CVG, async (p) => { await p.route(/39\.7392|-104\.99/, async (r) => { await holdB; await r.continue().catch(() => {}); }); }); // every request naming B's point waits
    await settle(v.p, 2000);
    await v.p.evaluate(() => window.__threats.setVenue({ name: "Denver, CO", lat: 39.7392, lon: -104.9903 })); await v.p.waitForTimeout(700);
    await v.p.evaluate(() => window.__threats.setVenue({ name: "CVG airport, Cincinnati/Northern Kentucky", lat: 39.0446, lon: -84.6723 })); await settle(v.p, 1500);
    releaseB(); await v.p.waitForTimeout(9000); // B's answers arrive now, after A is back
    const s1 = await st(v.p);
    check(`(${d}) A → B → A, B answering last: still A (venue ${s1.venue && s1.venue.name}, outlook ${s1.oKey}, NWS office ${s1.oOffice}); header '${s1.head.slice(0, 60)}'`,
      /CVG/.test(s1.venue.name) && s1.oKey === "39.0446,-84.6723" && s1.oOffice === "ILN" && /CVG/.test(s1.head) && !v.errs.length && !s1.errors.length, { s1 });
    await v.p.evaluate(() => window.__threats.setVenue({ name: "Denver, CO", lat: 39.7392, lon: -104.9903 })); await settle(v.p, 3000); const s2 = await st(v.p);
    check(`(${d}) then B: B's own answer (outlook ${s2.oKey}, NWS office ${s2.oOffice}); header '${s2.head.slice(0, 60)}'`, s2.oKey === "39.7392,-104.9903" && s2.oOffice === "BOU" && /Denver/.test(s2.head), { s2 });
    await v.ctx.close(); }

  /* 7. Manual, links and Return to Auto */
  { const v = await open(b, false, CVG + "&layers=flood,severe&view=active"); await settle(v.p, 2000); const s = await st(v.p);
    check(`A link naming layers stays Manual (summary '${s.sum}'; layers ${s.layers.join(",")})`, !s.auto && /^Manual · /.test(s.sum) && s.layers.join(",") === "severe,flood", { s });
    await v.p.click("#txLayersBtn"); await v.p.waitForTimeout(300); const btn = await v.p.$("[data-return-auto]");
    if (btn) { await btn.click(); await settle(v.p, 2500); } const a = await st(v.p);
    check(`Return to Auto: the picker offers it in Manual; after it, '${a.sum}', scope ${a.scope}`, !!btn && a.auto && /^Auto · /.test(a.sum) && a.scope === "venue" && a.layers.includes("winter"), { a });
    await v.ctx.close(); }

  await b.close();
  fs.writeFileSync(path.join(OUT, "auto-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
