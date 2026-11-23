#!/usr/bin/env node
/* "At this spot" on the Weather Threats map: SPC severe-weather outlooks nest, so a spot lists only the highest category that
   covers it, once per day shown; warnings, watches and MDs stay, and the map's outlook contours are unchanged.
   Overlapping threats demo: a click at TQL Stadium lists Day 1 · Enhanced risk (3 of 5) once with the Tornado Warning, Tornado
   Watch and Mesoscale Discussion; a click in a lower-risk area updates the panel to that area's own highest category.
     node tools/threats-point-check.js https://<host> [OUT_DIR] */
"use strict";
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/point-check");
if (!HOST) { console.error("usage: threats-point-check.js https://<host> [OUT_DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 600))); };
(async () => {
  const b = await chromium.launch();
  for (const [d, o] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 } }, p390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } })) {
    const ctx = await b.newContext(o), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(HOST + "/threats?scenario=overlap&scope=venue&view=active&sheet=open", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && !window.__threats.data.loading, null, { timeout: 90000 }); await p.waitForTimeout(1500);
    const contoursBefore = await p.evaluate(() => window.__threats.map.getSource("outlook")._data.features.length);
    // click the map at a lon/lat (the map's own click handler sets "At this spot")
    const clickAt = async (lon, lat) => { const xy = await p.evaluate(([lon, lat]) => { const m = window.__threats.map; m.jumpTo({ center: [lon, lat] }); const r = m.getCanvas().getBoundingClientRect(), q = m.project([lon, lat]); return [r.left + q.x, r.top + q.y]; }, [lon, lat]); await p.waitForTimeout(400); await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(700); };
    const read = () => p.evaluate(() => { const body = document.getElementById("txPanelBody"); return { spot: /At this spot/i.test(body.innerText), items: [...body.querySelectorAll(".tx-item")].map((x) => x.innerText.replace(/\s+/g, " ").trim()), point: window.__threats.S.point }; });
    const tql = await p.evaluate(() => { const ps = window.__threats.data.products, w = ps.find((x) => x.kind === "warning" && /Tornado/.test(x.event)); return { lon: -84.5222, lat: 39.1113, outlooks: ps.filter((x) => x.kind === "outlook" && x.day === 1 && x.program !== "ero" && !/^spcfire-/.test(x.program || "") && window.ThreatsCore.contains(x.geometry, [-84.5222, 39.1113])).map((x) => x.category), warn: !!w && window.ThreatsCore.contains(w.geometry, [-84.5222, 39.1113]) }; });
    /* TQL Stadium itself: the venue marker and its label sit on that spot in the page, so the map's own click handler is given the
       stadium's exact position (the same handler a click on the map runs); the lower-risk spot below is a real mouse click */
    await p.evaluate(([lon, lat]) => { const m = window.__threats.map; m.fire("click", { lngLat: { lng: lon, lat }, point: m.project([lon, lat]), originalEvent: {} }); }, [tql.lon, tql.lat]); await p.waitForTimeout(700); const a = await read();
    const outl = a.items.filter((x) => /Day 1/.test(x) && /risk/i.test(x));
    check(`(${d}) TQL Stadium: Day 1 · Enhanced risk (3 of 5) once (the spot is inside ${tql.outlooks.join(", ")}), with the Tornado Warning, Tornado Watch and Mesoscale Discussion`, a.spot && outl.length === 1 && /Enhanced risk \(3 of 5\)/.test(outl[0]) && a.items.some((x) => /Tornado Warning/.test(x)) && a.items.some((x) => /Tornado Watch/.test(x)) && a.items.some((x) => /Mesoscale Discussion/.test(x)), { a, tql });
    await p.screenshot({ path: path.join(OUT, `tql-${d}.png`) });
    // a lower-risk spot: inside a lower Day 1 category, outside Enhanced, outside every active product
    const low = await p.evaluate(() => { const T = window.ThreatsCore, ps = window.__threats.data.products, ol = ps.filter((x) => x.kind === "outlook" && x.day === 1 && x.program !== "ero" && !/^spcfire-/.test(x.program || "")), act = ps.filter((x) => x.kind !== "outlook" && x.geometry);
      for (const cat of ["SLGT", "MRGL"]) for (const poly of ol.filter((x) => x.category === cat)) { const bb = T.bbox(poly.geometry); for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) { const pt = [bb[0] + (bb[2] - bb[0]) * i / 30, bb[1] + (bb[3] - bb[1]) * j / 30]; const top = T.outlookAt(ol, pt);
        if (top && top.category === cat && !act.some((x) => T.contains(x.geometry, pt))) return { lon: pt[0], lat: pt[1], cat, inside: ol.filter((x) => T.contains(x.geometry, pt)).map((x) => x.category) }; } } return null; });
    await clickAt(low.lon, low.lat); const c = await read(), cOut = c.items.filter((x) => /Day 1/.test(x) && /risk/i.test(x));
    const word = { SLGT: "Slight risk \\(2 of 5\\)", MRGL: "Marginal risk \\(1 of 5\\)" }[low.cat];
    check(`(${d}) a lower-risk spot (${low.cat}, inside ${low.inside.join(", ")}): the panel updates to that one category, and no warning, watch or MD`, c.spot && cOut.length === 1 && new RegExp(word).test(cOut[0]) && !c.items.some((x) => /Warning|Watch|Mesoscale/.test(x)) && c.point && Math.abs(c.point[0] - low.lon) < 0.05, { c, low });
    await p.screenshot({ path: path.join(OUT, `lower-${d}.png`) });
    const contoursAfter = await p.evaluate(() => window.__threats.map.getSource("outlook")._data.features.length);
    check(`(${d}) the map's outlook contours are unchanged (${contoursBefore} areas drawn); no script errors`, contoursAfter === contoursBefore && contoursBefore > 1 && !errs.length && !(await p.evaluate(() => window.__threats.errors.length)), { contoursBefore, contoursAfter, errs });
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "point-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  await b.close(); const failed = results.filter((r) => !r.pass).length; console.log(`${results.length - failed} of ${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
