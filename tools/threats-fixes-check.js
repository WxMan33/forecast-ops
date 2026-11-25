#!/usr/bin/env node
/* Weather Threats map: the audit fixes and the three additions, on a deployment, desktop and a 390 px phone.
   Fixes: WPC rainfall "None Expected" reads none, not an outage; an unconfirmed SPC outlook says "Risk unknown"; fire
   incident and AirNow monitor dots open their details from a map click, smoke areas are listed in At this spot; the SPC
   Watch 705 replay loads; alerts no longer fetch every referenced earlier message on load (only when an alert is opened);
   zone outlines come from Cache Storage on the next visit; fully contained fires are hidden unless asked for.
   Additions: the no-layers prompt's presets; NOAA MRMS radar (live only, timestamped, stops when off); the venue's next
   12 hours from the NWS forecast grid, on request.
     node tools/threats-fixes-check.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/fixes-check");
if (!HOST) { console.error("usage: threats-fixes-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 700))); };
const FEEDS = [
  ["gauges", /api\.water\.noaa\.gov/],
  ["reports", /climo\/reports|\/api\/spc\/reports/],["alerts", /\/alerts\/active/], ["alerts-zones", /api\.weather\.gov\/zones|\/api\/nws\/zones/], ["alerts-refs", /(api\.weather\.gov|\/api\/nws)\/alerts\/urn/],
  ["md-page", /spc\.noaa\.gov\/products\/md/], ["md", /spc_mesoscale_discussion/], ["spc", /spc\.noaa\.gov\/products\/outlook/], ["fire", /fire_wx/], ["ero", /eromap|wpc_precip_hazards|\/api\/wpc\/ero/],
  ["nifc", /WFIGS|services3\.arcgis\.com/], ["hms", /satepsanone|\/api\/smoke/], ["airnow", /AirNow|airnowtech|Air%20Now/i], ["nhc", /tropical\/rest/], ["radar-time", /radar_base_reflectivity\/MapServer\/2\/query/],
  ["radar-tile", /radar_base_reflectivity\/MapServer\/export/], ["nws-point", /\/points\//], ["nws-grid", /\/gridpoints\//], ["awc", /aviationweather\.gov|\/api\/awc\//], ["nws-other", /api\.weather\.gov|\/api\/nws\//]];
const feedOf = (u) => { for (const [k, re] of FEEDS) if (re.test(u)) return k; return null; };
const tally = (l) => l.reduce((o, r) => ((o[r.feed] = (o[r.feed] || 0) + 1), o), {});
const DEV = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
(async () => {
  const b = await chromium.launch(), out = { host: HOST, at: new Date().toISOString(), devices: {} };
  for (const [d, o] of Object.entries(DEV)) {
    const ctx = await b.newContext(o), R = (out.devices[d] = {});
    const page = async (q, setup) => { const p = await ctx.newPage(), reqs = [], errs = []; p.on("pageerror", (e) => errs.push(e.message));
      p.on("request", (r) => { const f = feedOf(r.url()); if (f) reqs.push({ feed: f, url: r.url(), t: Date.now() }); });
      if (setup) await setup(p); await p.goto(HOST + "/threats" + q, { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => window.__threats && window.__threats.ready && (window.__threats.S.scenario !== "live" || window.__threats.liveReady) && !window.__threats.data.loading, null, { timeout: 90000 });
      return { p, reqs, errs }; };
    const since = (reqs, t0) => reqs.filter((r) => r.t >= t0);
    /* a control in the panel: on a phone the sheet may be collapsed, so open it first, as a person would by tapping it */
    const tap = async (p, sel) => { const l = p.locator(sel).first(); if (!(await l.isVisible()) && (await p.locator("#txPeek").isVisible())) { await p.locator("#txPeek").click(); await p.waitForTimeout(500); } await l.click(); };
    /* clicking the map at a lon/lat with the real pointer */
    const mapClick = async (p, pt) => { const xy = await p.evaluate((pt) => { const m = window.__threats.map; m.jumpTo({ center: pt, zoom: Math.max(m.getZoom(), 9) }); const r = m.getCanvas().getBoundingClientRect(), q = m.project(pt); return [r.left + q.x, r.top + q.y]; }, pt); await p.waitForTimeout(900);
      // on a phone the open sheet can cover the spot: collapse it first, as a person would
      if (!(await p.evaluate(([x, y]) => (document.elementFromPoint(x, y) || {}).tagName === "CANVAS", xy))) { if (await p.locator("#txSheetBtn").isVisible()) { await p.locator("#txSheetBtn").click(); await p.waitForTimeout(700); } }
      if (o.hasTouch) await p.touchscreen.tap(xy[0], xy[1]); else await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(900); };
    /* a dot opens directly when it is the only thing there; with something overlapping, it is listed under the click and its row opens it */
    const openDot = async (p, id, pt) => { await mapClick(p, pt); let how = "direct";
      if ((await p.evaluate(() => window.__threats.S.sel)) !== id) { const row = p.locator(`#txPanelBody [data-spot="under"] ~ [data-id="${id}"]`).first(); if (await row.count()) { await row.click(); await p.waitForTimeout(600); how = "listed"; } else how = "missing"; }
      return how; };

    /* PRESETS, from a fresh visit */
    { const { p, reqs, errs } = await page("?view=active&layers=none", null); await p.waitForTimeout(3000);
      const t0 = Date.now(); await tap(p, '[data-preset="venue"]'); await p.waitForFunction(() => window.__threats.liveReady && !window.__threats.data.loading, null, { timeout: 60000 }); await p.waitForTimeout(6000);
      const st = await p.evaluate(() => ({ layers: Object.keys(window.__threats.S.layers).filter((k) => window.__threats.S.layers[k]), scope: window.__threats.S.scope, feeds: window.ThreatsLive.mapFeeds(), sum: document.getElementById("txLayersSum").textContent.replace(/^Manual · /, "") }));
      const by = tally(since(reqs, t0)); R.presetVenue = { st, by };
      check(`(${d}) PRESET "Warnings at my venue": severe, flood, winter, heat & cold, wind & visibility, coastal; venue view; only alerts, MDs, SPC and WPC outlooks and SPC storm reports requested (${JSON.stringify(by)}); no earlier-message lookups on load`,
        JSON.stringify(st.layers) === '["severe","flood","winter","heat","wind","coastal"]' && st.scope === "venue" && JSON.stringify(st.feeds) === '["alerts","ero","md","reports","spc"]' && Object.keys(by).every((k) => ["alerts", "alerts-zones", "md-page", "md", "spc", "ero", "reports", "gauges"].includes(k)) && !by["alerts-refs"] && (by["md-page"] || 0) <= 1 && !errs.length, { st, by, errs });
      await p.screenshot({ path: path.join(OUT, `preset-venue-${d}.png`) });
      // WPC rainfall: confirmed (current or none), never "Not responding" when WPC answered
      const ero = await p.evaluate(() => { const T = window.__threats; T.S.view = "day1"; T.drawAll(); return { st: T.data.state.ero1 && T.data.state.ero1.kind, src: T.data.sources.ero1, rows: [...document.querySelectorAll(".px-src")].map((r) => r.innerText.replace(/\s+/g, " ")).filter((x) => /rainfall/i.test(x)), panel: document.getElementById("txPanelBody").innerText.replace(/\s+/g, " ").slice(0, 400) }; });
      R.ero1 = ero;
      check(`(${d}) WPC RAINFALL Day 1 (${ero.src && ero.src.state}; today ${ero.st}): a confirmed answer reads current or none, not 'Not responding'`, ["current", "empty"].includes(ero.st) && !ero.rows.some((x) => /Not responding/.test(x)), ero);
      // opening an alert that updates an earlier one fetches that one message, once
      const t1 = Date.now(), opened = await p.evaluate(() => { const T = window.__threats, a = T.data.products.find((x) => (x.references || []).length && x.kind !== "outlook"); if (!a) return null; T.S.view = "active"; T.S.sel = a.id; T.drawAll(); T.drawAll(); return a.id; });
      await p.waitForTimeout(3000); const refs = since(reqs, t1).filter((r) => r.feed === "alerts-refs").length; R.refsOnOpen = { opened, refs };
      check(`(${d}) WHAT CHANGED: the earlier message is fetched when its alert is opened (${refs} request${refs === 1 ? "" : "s"} for ${opened || "no alert with a reference today"})`, !opened || refs === 1, { opened, refs });
      await p.close(); }
    /* zone outlines: a second visit in the same browser reads them from Cache Storage */
    { const { p, reqs } = await page("?layers=coastal,winter"); await p.waitForTimeout(8000); const z = reqs.filter((r) => r.feed === "alerts-zones").length;
      const cached = await p.evaluate(async () => (await (await caches.open("forecast-ops-zones-v1")).keys()).length); await p.close();
      const again = await page("?layers=coastal,winter"); await again.p.waitForTimeout(8000); const z2 = again.reqs.filter((r) => r.feed === "alerts-zones").length; await again.p.close();
      R.zones = { first: z, cached, second: z2 };
      check(`(${d}) ZONE OUTLINES: first visit ${z} downloads, ${cached} kept in Cache Storage; next visit ${z2}`, cached > 0 && z2 < Math.max(1, z) / 4, R.zones); }
    /* SPC outlook failing: risk unknown, never "No severe risk" */
    { const { p } = await page("?layers=severe&view=day1&scope=venue", (p) => p.route(/spc\.noaa\.gov\/products\/outlook/, (r) => r.abort())); await p.waitForTimeout(4000);
      const r = await p.evaluate(() => ({ peek: document.getElementById("txPeek2").textContent, big: (document.querySelector(".px-brief .px-big") || {}).textContent, body: document.getElementById("txPanelBody").innerText }));
      R.spcUnknown = r;
      check(`(${d}) SPC OUTLOOK NOT RESPONDING: the venue brief and summary say 'Risk unknown' ('${r.big}'), never 'No severe risk area'`, /Risk unknown · SPC Day 1 outlook not responding/.test(r.big || "") && /Risk unknown/.test(r.peek) && !/No severe risk/.test(r.body + r.peek), r);
      await p.screenshot({ path: path.join(OUT, `spc-unknown-${d}.png`) }); await p.close(); }
    /* map clicks: fire incident dot, AirNow monitor dot, a smoke area; contained fires */
    { const { p, errs } = await page("?layers=fire,smoke&scope=national"); await p.waitForTimeout(15000);
      const pick = await p.evaluate(() => { const T = window.__threats, ids = (s) => new Set((T.map.getSource(s)._data.features || []).map((f) => f.properties.id)), inc = ids("inc-pt"), mon = ids("aqmon"), ps = T.data.products;
        const fire = ps.filter((x) => x.kind === "incident" && inc.has(x.id) && x.point).sort((a, b) => (b.acres || 0) - (a.acres || 0))[0], vt = window.__threats.venue, dist = (pt) => Math.hypot(pt[0] - vt.lon, pt[1] - vt.lat),
          m = ps.filter((x) => x.kind === "aqobs" && mon.has(x.id) && x.point).sort((a, b) => dist(b.point) - dist(a.point))[0]; // away from the venue marker
        const hidden = ps.filter((x) => x.kind === "incident" && x.contained === 100 && x.category !== "RX"), drawnContained = hidden.filter((x) => inc.has(x.id)).length;
        const hms = ps.find((x) => x.kind === "smoke" && x.geometry && Date.parse(x.obsEnd) <= Date.now()); let inside = null;
        if (hms) { const bb = window.ThreatsCore.bbox(hms.geometry); for (let i = 1; i < 25 && !inside; i++) for (let j = 1; j < 25 && !inside; j++) { const q = [bb[0] + (bb[2] - bb[0]) * i / 25, bb[1] + (bb[3] - bb[1]) * j / 25]; if (window.ThreatsCore.contains(hms.geometry, q)) inside = q; } }
        return { fire: fire && { id: fire.id, name: fire.name, pt: fire.point }, mon: m && { id: m.id, site: m.site, pt: m.point }, contained: hidden.length, drawnContained, hms: hms && { id: hms.id, pt: inside } }; });
      R.clicks = { pick };
      if (pick.fire) { const how = await openDot(p, pick.fire.id, pick.fire.pt); const s = await p.evaluate(() => ({ sel: window.__threats.S.sel, body: document.getElementById("txPanelBody").innerText.slice(0, 160) })); R.clicks.fire = s;
        s.how = how; check(`(${d}) CLICK a fire incident dot (${pick.fire.name}): its own details open (${how})`, s.sel === pick.fire.id && s.body.includes(pick.fire.name), s); await p.screenshot({ path: path.join(OUT, `click-fire-${d}.png`) }); }
      await p.evaluate(() => { window.__threats.S.sel = null; window.__threats.drawAll(); });
      if (pick.mon) { const how = await openDot(p, pick.mon.id, pick.mon.pt); const s = await p.evaluate(() => ({ sel: window.__threats.S.sel, body: document.getElementById("txPanelBody").innerText.slice(0, 200) })); R.clicks.mon = s;
        s.how = how; check(`(${d}) CLICK an AirNow monitor dot (${pick.mon.site}): its own details open (${how})`, s.sel === pick.mon.id, s); }
      await p.evaluate(() => { window.__threats.S.sel = null; window.__threats.drawAll(); });
      if (pick.hms && pick.hms.pt) { await p.evaluate((pt) => { const m = window.__threats.map; m.jumpTo({ center: pt }); m.fire("click", { lngLat: { lng: pt[0], lat: pt[1] }, point: m.project(pt), originalEvent: {} }); }, pick.hms.pt); await p.waitForTimeout(700);
        const s = await p.evaluate(() => document.getElementById("txPanelBody").innerText.replace(/\s+/g, " ").slice(0, 300)); R.clicks.hms = s;
        check(`(${d}) CLICK inside a satellite smoke area: At this spot lists it`, /At this spot/i.test(s) && /smoke/i.test(s), s); }
      check(`(${d}) FULLY CONTAINED FIRES hidden by default (${pick.contained} listed by NIFC, ${pick.drawnContained} drawn)`, pick.drawnContained === 0, pick);
      if (pick.contained) { await p.evaluate(() => { const c = document.getElementById("ctnChk"); if (c) { c.checked = true; c.dispatchEvent(new Event("change")); } else { window.__threats.S.ctn = true; window.__threats.drawAll(); } }); await p.waitForTimeout(800);
        const n = await p.evaluate(() => { const T = window.__threats, inc = new Set(T.map.getSource("inc-pt")._data.features.map((f) => f.properties.id)); return T.data.products.filter((x) => x.kind === "incident" && x.contained === 100 && inc.has(x.id)).length; });
        check(`(${d}) "Fully contained fires" in the legend shows them (${n} drawn)`, n > 0, { n }); }
      check(`(${d}) no script errors on the fire and smoke map`, !errs.length, errs); await p.close(); }
    /* overlapping aviation (pilot reports and advisories): a click lists everything there; each row opens its own details */
    { const { p, errs } = await page("?layers=aviation&scope=national"); await tap(p, "#txLayersBtn"); for (const k of ["pireps", "adv"]) await p.locator(`#txLayersPop input[data-av="${k}"]`).check(); await tap(p, "#txLayersPop [data-layers-close]");
      await p.waitForFunction(() => (window.__threats.map.getSource("pirep")._data.features || []).length > 5 && (window.__threats.map.getSource("enr")._data.features || []).length > 1, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(3000);
      const pick = await p.evaluate(() => { const T = window.__threats, C = window.ThreatsCore, adv = T.map.getSource("enr")._data.features.map((f) => T.data.products.find((x) => x.id === f.properties.id)).filter((x) => x && x.geometry);
        for (const f of T.map.getSource("pirep")._data.features) { const inside = adv.filter((a) => C.contains(a.geometry, f.geometry.coordinates)); if (inside.length) return { pirep: f.properties.id, pt: f.geometry.coordinates, advs: inside.map((a) => a.id) }; }
        for (const a of adv) { const bb = C.bbox(a.geometry); for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) { const q = [bb[0] + (bb[2] - bb[0]) * i / 20, bb[1] + (bb[3] - bb[1]) * j / 20]; const inside = adv.filter((x) => C.contains(x.geometry, q)); if (inside.length > 1) return { pirep: null, pt: q, advs: inside.map((x) => x.id) }; } } return null; });
      R.overlap = { pick };
      if (pick) { await mapClick(p, pick.pt); const want = [pick.pirep, ...pick.advs].filter(Boolean);
        const L = await p.evaluate(() => ({ under: !!document.querySelector('#txPanelBody [data-spot="under"]'), ids: [...document.querySelectorAll("#txPanelBody .tx-item[data-id]")].map((x) => x.dataset.id), rows: [...document.querySelectorAll("#txPanelBody .tx-item")].map((x) => x.innerText.replace(/\s+/g, " ").slice(0, 90)) }));
        let opened = 0; for (const id of want.slice(0, 3)) { await p.locator(`#txPanelBody [data-id="${id}"]`).first().click(); await p.waitForTimeout(500); if ((await p.evaluate(() => window.__threats.S.sel)) === id) opened++; await p.locator("#txPanelBody [data-back]").first().click(); await p.waitForTimeout(500); }
        const back = await p.evaluate(() => !!document.querySelector('#txPanelBody [data-spot="under"]')); R.overlap.L = L; R.overlap.opened = opened;
        check(`(${d}) OVERLAPPING AVIATION (${pick.pirep ? "a pilot report inside " : ""}${pick.advs.length} advisor${pick.advs.length > 1 ? "ies" : "y"}): the click lists all ${want.length} under it; each row opens its own details and Back returns to the list`,
          L.under && want.every((id) => L.ids.includes(id)) && opened === Math.min(3, want.length) && back && !errs.length, { pick, L, opened, back, errs });
        await mapClick(p, pick.pt); await p.screenshot({ path: path.join(OUT, `overlap-aviation-${d}.png`) }); }
      else check(`(${d}) OVERLAPPING AVIATION: no pilot report inside an advisory and no overlapping advisories right now (not tested)`, true, null);
      await p.close(); }
    /* VENUE MARKER off: just the map; remembered; the venue view brings it back */
    { const { p, errs } = await page("?layers=severe&scope=venue"); await tap(p, "#txLayersBtn"); await p.locator("#txLayersPop input[data-pin]").uncheck(); await tap(p, "#txLayersPop [data-layers-close]"); await p.waitForTimeout(800);
      const off = await p.evaluate(() => ({ pin: window.__threats.S.pin, scope: window.__threats.S.scope, marker: getComputedStyle(document.querySelector(".tx-pin")).display, ring: window.__threats.map.getSource("ring")._data.features ? window.__threats.map.getSource("ring")._data.features.length : 0, strip: !!document.querySelector(".px-strip"), peek: document.getElementById("txPeek1").textContent }));
      await p.screenshot({ path: path.join(OUT, `venue-marker-off-${d}.png`) }); await p.close();
      const again = await page("?layers=severe"); await again.p.waitForTimeout(800); const kept = await again.p.evaluate(() => ({ pin: window.__threats.S.pin, marker: getComputedStyle(document.querySelector(".tx-pin")).display }));
      await again.p.locator('[data-scope="venue"]').first().click(); await again.p.waitForTimeout(800); const back = await again.p.evaluate(() => ({ pin: window.__threats.S.pin, marker: getComputedStyle(document.querySelector(".tx-pin")).display }));
      await again.p.evaluate(() => { try { localStorage.removeItem("threats_pin"); } catch (e) {} }); await again.p.close();
      R.pin = { off, kept, back };
      check(`(${d}) VENUE MARKER off: pin, label and ring hidden, national map, no venue strip (summary '${off.peek}'); remembered on the next visit; choosing Venue shows it again`,
        off.pin === false && off.scope === "national" && off.marker === "none" && off.ring === 0 && !off.strip && off.peek === "National map" && kept.pin === false && kept.marker === "none" && back.pin === true && back.marker !== "none" && !errs.length, { ...R.pin, errs }); }
    /* BASEMAP FAILOVER (as in OPE): CARTO blocked -> built-in map with local labels; CARTO back -> the 5-minute retry swaps to it,
       keeping every overlay */
    { let block = true; const { p, errs } = await page("?layers=severe,coastal&radar=1", (p) => p.route(/cartocdn\.com/, (r) => (block ? r.abort() : r.continue())));
      await p.waitForTimeout(3000);
      const fb = await p.evaluate(() => { const m = window.__threats.map; return { basemap: window.__threats.basemap, cities: m.getLayer("cities") ? m.getLayoutProperty("cities", "visibility") !== "none" && m.queryRenderedFeatures({ layers: ["cities"] }).length : 0, states: !!m.getLayer("states"), warnLayers: !!m.getLayer("warn-fill"), maxZoom: m.getMaxZoom() }; });
      await p.screenshot({ path: path.join(OUT, `basemap-fallback-${d}.png`) });
      block = false; await p.evaluate(() => window.__threats.retryCarto()); await p.waitForFunction(() => window.__threats.basemap === "carto" && window.__threats.map.isStyleLoaded(), null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(4000);
      const up = await p.evaluate(() => { const m = window.__threats.map, L = m.getStyle().layers, i = (id) => L.findIndex((l) => l.id === id), firstCarto = L.findIndex((l) => l.type === "symbol" && !["route-label", "apt-label", "edge-labels", "labels", "warn-labels"].includes(l.id));
        return { basemap: window.__threats.basemap, vector: Object.values(m.getStyle().sources).some((s) => s.type === "vector"), warnBelowLabels: i("warn-fill") > -1 && i("warn-fill") < firstCarto, labelsOnTop: i("warn-labels") > firstCarto, font: m.getLayoutProperty("labels", "text-font"), county: !!m.getLayer("cnty-lines") && !!m.getLayer("hu-state"), radar: !!m.getLayer("radar"), noOldBase: !m.getLayer("cities") && !m.getLayer("bg"), maxZoom: m.getMaxZoom(), active: (m.getSource("active")._data.features || []).length, errors: window.__threats.errors }; });
      await p.screenshot({ path: path.join(OUT, `basemap-retried-${d}.png`) }); R.basemap = { fb, up };
      check(`(${d}) BASEMAP FAILOVER: CARTO blocked -> the built-in map with its own labels (${fb.cities} city labels), overlays work; CARTO back -> the retry swaps to it with every overlay kept (${up.active} warning/advisory shapes, radar ${up.radar}), hazards under its labels, our labels on top in its font, county lines, zoom 14`,
        fb.basemap === "fallback" && fb.cities > 0 && fb.states && fb.warnLayers && fb.maxZoom === 11 && up.basemap === "carto" && up.vector && up.warnBelowLabels && up.labelsOnTop && JSON.stringify(up.font) === '["Montserrat SemiBold"]' && up.county && up.radar && up.noOldBase && up.maxZoom === 14 && up.active > 0 && !up.errors.length && !errs.length, { ...R.basemap, errs });
      await p.close(); }
    /* COUNTY LINES (US Census, our own file): none downloaded at national zoom; lines from regional zoom, names zoomed in; the switch hides them */
    { const reqs = []; const { p, errs } = await page("?layers=severe", (p) => p.on("request", (r) => { if (/assets\/geo\/county-/.test(r.url())) reqs.push(r.url()); }));
      await p.waitForTimeout(2000); const national = reqs.length;
      await p.evaluate(() => window.__threats.map.jumpTo({ center: [-84.5, 39.2], zoom: 6 })); await p.waitForTimeout(4000);
      const z6 = await p.evaluate(() => ({ lines: window.__threats.map.queryRenderedFeatures({ layers: ["cnty-lines"] }).length, names: window.__threats.map.queryRenderedFeatures({ layers: ["cnty-labels"] }).length }));
      await p.evaluate(() => window.__threats.map.jumpTo({ center: [-84.5, 39.2], zoom: 9 })); await p.waitForTimeout(4000);
      const z9 = await p.evaluate(() => ({ lines: window.__threats.map.queryRenderedFeatures({ layers: ["cnty-lines"] }).length, names: window.__threats.map.queryRenderedFeatures({ layers: ["cnty-labels"] }).map((f) => f.properties.n) }));
      await p.screenshot({ path: path.join(OUT, `counties-z9-${d}.png`) });
      await tap(p, "#txLayersBtn"); await p.locator("#txLayersPop input[data-counties]").uncheck(); await tap(p, "#txLayersPop [data-layers-close]"); await p.waitForTimeout(800);
      const off = await p.evaluate(() => window.__threats.map.getLayoutProperty("cnty-lines", "visibility")); await p.evaluate(() => { try { localStorage.removeItem("threats_counties"); } catch (e) {} });
      R.counties = { national, z6, z9: { lines: z9.lines, names: z9.names.slice(0, 8) }, off, files: reqs.length };
      check(`(${d}) COUNTY LINES: nothing downloaded at national zoom (${national}); lines from regional zoom (zoom 6: ${z6.lines} segments, no names); names zoomed in (zoom 9: ${z9.names.slice(0, 4).join(", ")}…); off hides them`,
        national === 0 && z6.lines > 0 && z6.names === 0 && z9.lines > 0 && z9.names.includes("Hamilton") && off === "none" && reqs.length === 2 && !errs.length, { ...R.counties, errs }); await p.close(); }
    /* STORM REPORTS (replay of SPC's Nov 12 reports): drawn by type, a national count, near-venue list, a click opens the report */
    { const { p, errs } = await page("?scenario=archive-reports-delaware&layers=severe&scope=national"); await p.waitForTimeout(2500);
      const nat = await p.evaluate(() => ({ drawn: window.__threats.map.getSource("lsr")._data.features.length, types: window.__threats.map.getSource("lsr")._data.features.reduce((o, f) => ((o[f.properties.type] = (o[f.properties.type] || 0) + 1), o), {}), head: (document.querySelector('[data-reports="national"]') || {}).innerText, legend: /Storm reports · last 24 h/.test(document.getElementById("txLegend").textContent) }));
      const tor = await p.evaluate(() => window.__threats.data.products.find((x) => x.kind === "lsr" && x.type === "tornado" && /Woodshade/.test(x.location)));
      await mapClick(p, tor.point); let sel = await p.evaluate(() => window.__threats.S.sel); if (sel !== tor.id) { const row = p.locator(`#txPanelBody [data-id="${tor.id}"]`).first(); if (await row.count()) { await row.click(); await p.waitForTimeout(500); } sel = await p.evaluate(() => window.__threats.S.sel); }
      const det = await p.evaluate(() => document.getElementById("txPanelBody").innerText.replace(/\s+/g, " "));
      await p.screenshot({ path: path.join(OUT, `reports-detail-${d}.png`) }); await p.close();
      const v = await page("?scenario=archive-reports-delaware&layers=severe&scope=venue&avenue=nwk"); await v.p.waitForTimeout(2500);
      const ven = await v.p.evaluate(() => [...document.querySelectorAll('[data-reports="venue"] ~ .tx-item')].slice(0, 6).map((x) => x.innerText.replace(/\s+/g, " ").slice(0, 80)));
      await v.p.screenshot({ path: path.join(OUT, `reports-venue-${d}.png`) }); await v.p.close();
      R.reports = { nat, sel, det: det.slice(0, 200), ven };
      check(`(${d}) STORM REPORTS (replay, SPC Nov 12): ${nat.drawn} drawn (${JSON.stringify(nat.types)}); '${nat.head}'; legend; a tornado dot opens its report (time, place, comments, preliminary); Delaware Stadium lists reports within 25 mi`,
        nat.drawn === 27 && nat.types.tornado === 3 && /3 tornado · 2 wind · 22 hail/i.test(nat.head || "") && nat.legend && sel === tor.id && /Tornado · 1 SW Woodshade, DE/.test(det) && /1:05 PM EST/.test(det) && /EF-1 tornado/.test(det) && /preliminary report/i.test(det) && ven.length > 0 && ven.some((x) => /Tornado/.test(x)) && !errs.length && !v.errs.length, { ...R.reports, errs, verrs: v.errs }); }
    /* RIVER GAUGES (live, NOAA NWPS): loaded and drawn only where a Flood Warning is in effect in view. Around a spot with no flood
       warning: none queried or drawn and the source row says why; at a live Flood Warning (when one exists): gauges drawn and one opens */
    { const reqs = []; const { p, errs } = await page("?layers=flood&scope=national", (p) => p.on("request", (r) => { if (/api\.water\.noaa\.gov/.test(r.url())) reqs.push(r.url()); }));
      await p.waitForTimeout(2000); const national = reqs.length;
      const quiet = await p.evaluate(() => { const T = window.__threats, fw = T.data.products.filter((x) => x.sourceId === "nws-alerts" && /Flood Warning/.test(x.event || "") && x.geometry && Date.parse(x.expires) > Date.now()), fwNow = fw.filter((x) => !(Date.parse(x.issued) > Date.now())); /* the quiet spot keeps clear of every flood warning; the one tested is in effect now (one that starts later is upcoming, by design) */
        const far = (lon, lat) => fw.every((x) => { const b = window.ThreatsCore.bbox(x.geometry); return lon < b[0] - 4 || lon > b[2] + 4 || lat < b[1] - 3 || lat > b[3] + 3; });
        const spot = [[-84.51, 39.1], [-104.99, 39.74], [-112.07, 33.45], [-122.33, 47.6], [-71.06, 42.36], [-96.8, 32.78]].find(([lo, la]) => far(lo, la));
        const fwc = fwNow[0] && window.ThreatsCore.bbox(fwNow[0].geometry); return { spot, warn: fwc ? { at: [(fwc[0] + fwc[2]) / 2, (fwc[1] + fwc[3]) / 2], ev: fwNow[0].event, area: fwNow[0].areaDesc || "" } : null, n: fw.length }; });
      let q = { drawn: -1, row: "", queried: -1 };
      if (quiet.spot) { const before = reqs.length; await p.evaluate((c) => window.__threats.map.jumpTo({ center: c, zoom: 9 }), quiet.spot); await p.waitForTimeout(3500);
        q = await p.evaluate(() => ({ drawn: window.__threats.map.getSource("gauge")._data.features.length, row: [...document.querySelectorAll(".px-src")].map((x) => x.innerText.replace(/\s+/g, " ")).find((t) => /river gauges/i.test(t)) || "" })); q.queried = reqs.length - before; }
      let w = { drawn: 0, det: "", skipped: !quiet.warn };
      if (quiet.warn) { await p.evaluate((c) => window.__threats.map.jumpTo({ center: c, zoom: 8 }), quiet.warn.at);
        await p.waitForFunction(() => window.__threats.map.getSource("gauge")._data.features.length > 0, null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500);
        w.drawn = await p.evaluate(() => window.__threats.map.getSource("gauge")._data.features.length);
        const c = await p.evaluate(() => { const f = window.__threats.map.getSource("gauge")._data.features, ids = new Set(f.map((x) => x.properties.id)), b = window.__threats.map.getBounds();
          const x = window.__threats.data.products.find((y) => y.kind === "gauge" && ids.has(y.id) && b.contains(y.point)); return x && { id: x.id, pt: x.point }; });
        if (c) { await openDot(p, c.id, c.pt); w.det = await p.evaluate(() => document.getElementById("txPanelBody").innerText.replace(/\s+/g, " ")); } }
      const legend = await p.evaluate(() => /River gauges · NOAA/.test(document.getElementById("txLegend").textContent));
      await p.screenshot({ path: path.join(OUT, `gauges-${d}.png`) }); R.gauges = { national, quiet, q, w: { ...w, det: w.det.slice(0, 300) } };
      check(`(${d}) RIVER GAUGES (live NOAA): none queried at national zoom (${national}); with no flood warning near ${quiet.spot ? quiet.spot.join(",") : "(none quiet)"}: ${q.queried} queried, ${q.drawn} drawn, row '${q.row}'; ` + (quiet.warn ? `at a live ${quiet.warn.ev} (${quiet.warn.area.slice(0, 40)}): ${w.drawn} drawn, a gauge opens its stage and hydrograph link` : "no Flood Warning active anywhere: the drawn case is skipped") + `; legend`,
        national === 0 && (!quiet.spot || (q.queried === 0 && q.drawn === 0 && /no flood warning in view/i.test(q.row))) && (!quiet.warn || (w.drawn > 0 && /\d+(\.\d+)? ft|stage/i.test(w.det) && /hydrograph/.test(w.det))) && legend && !errs.length, { ...R.gauges, errs }); await p.close(); }
    /* the SPC Watch 705 replay */
    { const { p, errs } = await page("?scenario=archive-ww705&scope=venue"); await p.waitForTimeout(3000);
      const r = await p.evaluate(() => ({ n: window.__threats.data.products.length, watch: window.__threats.data.products.filter((x) => x.kind === "watch").map((x) => x.event), drawn: window.__threats.map.getSource("active")._data.features.length, err: window.__threats.data.loadError, panel: document.getElementById("txPanelBody").innerText.slice(0, 160) }));
      R.ww705 = r; check(`(${d}) REPLAY SPC Tornado Watch 705 loads and draws (${r.watch.join(", ")})`, !r.err && r.watch.includes("Tornado Watch") && r.drawn >= 1 && !errs.length, { r, errs }); await p.screenshot({ path: path.join(OUT, `replay-ww705-${d}.png`) }); await p.close(); }
    /* RADAR: from none; image time; tiles; off stops it; demo: live only */
    { const { p, reqs, errs } = await page("?view=active&layers=none"); await p.waitForTimeout(2000); const t0 = Date.now();
      await tap(p, "#txLayersBtn"); await p.locator("#txLayersPop input[data-radar]").check(); await tap(p, "#txLayersPop [data-layers-close]");
      await p.waitForFunction(() => window.__threats.radar.state === "ok" && window.__threats.map.getLayer("radar") && window.__threats.map.areTilesLoaded(), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(3000);
      const on = since(reqs, t0), by = tally(on), st = await p.evaluate(() => { const T = window.__threats, m = T.map; return { state: T.radar.state, valid: T.radar.valid, vis: m.getLayer("radar") && m.getLayoutProperty("radar", "visibility"), below: m.getStyle().layers.findIndex((l) => l.id === "radar") < m.getStyle().layers.findIndex((l) => l.id === "outlook-fill"), sum: document.getElementById("txLayersSum").textContent.replace(/^Manual · /, ""), row: (document.querySelector('[data-src="radar"]') || {}).innerText, feeds: window.ThreatsLive.mapFeeds() }; });
      R.radarOn = { by, st };
      check(`(${d}) RADAR on, with no hazard layer: 'Radar only'; image time read once (${by["radar-time"]}), ${by["radar-tile"] || 0} tiles; drawn under the hazards; status row '${st.row}'; no threat feed requested`,
        st.state === "ok" && st.vis === "visible" && st.below && st.sum === "Radar only" && by["radar-time"] === 1 && by["radar-tile"] > 0 && Object.keys(by).every((k) => /^radar/.test(k)) && /Image .* min old/.test(st.row || "") && !st.feeds.length && Date.now() - Date.parse(st.valid) < 60 * 60e3 && !errs.length, { by, st, errs });
      await p.screenshot({ path: path.join(OUT, `radar-${d}.png`) });
      await tap(p, "#txLayersBtn"); await p.locator("#txLayersPop input[data-radar]").uncheck(); await tap(p, "#txLayersPop [data-layers-close]"); const t1 = Date.now(); await p.waitForTimeout(8000);
      const off = since(reqs, t1), so = await p.evaluate(() => ({ state: window.__threats.radar.state, timer: !!window.__threats.radar.timer, vis: window.__threats.map.getLayoutProperty("radar", "visibility"), sum: document.getElementById("txLayersSum").textContent.replace(/^Manual · /, "") }));
      R.radarOff = { off: tally(off), so };
      check(`(${d}) RADAR off: hidden, its 5-minute refresh stopped, nothing more requested`, off.length === 0 && so.state === "off" && !so.timer && so.vis === "none" && so.sum === "None selected", { off: off.map((r) => r.url), so }); await p.close(); }
    { const { p } = await page("?scenario=overlap&radar=1"); await p.waitForTimeout(1500); const r = await p.evaluate(() => ({ dis: document.querySelector("#txLayersPop input[data-radar]").disabled, layer: !!window.__threats.map.getLayer("radar"), sum: document.getElementById("txLayersSum").textContent.replace(/^Manual · /, "") }));
      check(`(${d}) RADAR is live only: unavailable on a demo or replay (summary '${r.sum}')`, r.dis && !r.layer && !/Radar/.test(r.sum), r); await p.close(); }
    /* VENUE FORECAST, on request, with no layer on */
    { const { p, reqs, errs } = await page("?view=active&layers=none&scope=venue&lat=39.1113&lon=-84.5222&name=TQL%20Stadium&tz=America%2FNew_York"); await p.waitForTimeout(2000);
      const before = reqs.length, t0 = Date.now(); await tap(p, "[data-vfc]"); await p.waitForSelector('[data-vfc-state="ok"], [data-vfc-state="failed"]', { timeout: 60000 });
      const r = await p.evaluate(() => { const g = document.querySelector(".px-vfc"); return { state: g && g.dataset.vfcState, sum: (document.querySelector(".px-vfcsum") || {}).textContent, rows: document.querySelectorAll(".px-vfcgrid [role=row]").length - 1, foot: ((g && g.querySelector(".lg-note")) || {}).textContent, hs: document.documentElement.scrollWidth > window.innerWidth + 1, data: window.__threats.vfc.data && { office: window.__threats.vfc.data.office, peakGust: window.__threats.vfc.data.peakGust } }; });
      const by = tally(since(reqs, t0)); await p.evaluate(() => window.__threats.drawAll()); await p.waitForTimeout(1000); const again = tally(since(reqs, t0)); R.vfc = { r, by, before };
      check(`(${d}) VENUE FORECAST: nothing requested until asked (${before}); then the NWS point and grid once each (${JSON.stringify(by)}); 12 hourly rows; summary '${r.sum}'; forecast office and update time named; no horizontal scroll`,
        before <= 1 && r.state === "ok" && r.rows === 12 && by["nws-point"] === 1 && by["nws-grid"] === 1 && Object.keys(by).length === 2 && JSON.stringify(again) === JSON.stringify(by) && /Peak gust \d+ mph around/.test(r.sum) && /NWS forecast grid ILN 35,38, updated/.test(r.foot) && !r.hs && !errs.length, { r, by, again, errs });
      await p.locator(".px-vfc").scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(OUT, `venue-forecast-${d}.png`) }); await p.close(); }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "fixes-check.json"), JSON.stringify({ ...out, results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
