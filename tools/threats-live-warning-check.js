#!/usr/bin/env node
/* First active-weather verification, run against the live feeds (docs/threats/ACTIVE-WEATHER-CHECKLIST.md, sections 1-3).
   Runs only what is active right now and says what it skipped:
     1. a live tornado or severe thunderstorm WARNING: source JSON saved; desktop national view (drawn, first in "Most urgent
        now"); venue inside the polygon and venue just outside it (desktop and phone with the sheet closed); the detail (headline,
        expiration matching the source, relationship, official bulletin text, source link); then, for WATCH_MIN minutes, the open
        page is watched for an update ("What changed") or the end ("cancelled by NWS" / "no longer listed"), nothing left drawn;
     2. a live tornado or severe thunderstorm WATCH: geometry, affectedZones kinds, messages per office; drawn as one outline with
        "Area drawn from N counties"; a venue just outside;
     3. an active SPC Mesoscale Discussion in the NOAA map service: service response saved; the MD row says how it was checked;
        the outline is drawn; the detail has the number and a bulletin link.
   Evidence (all labelled LIVE) goes to docs/threats/live-checks/<UTC date>/.
     node tools/threats-live-warning-check.js https://<host> [WATCH_MIN=20]
   Exit: 0 all checks run passed; 1 a check failed; 3 nothing active (no checks run). */
"use strict";
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const T = require("../assets/threats-core.js");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), WATCH_MIN = +(process.argv[3] || 20);
if (!HOST) { console.error("usage: threats-live-warning-check.js https://<host> [WATCH_MIN]"); process.exit(2); }
const UA = { "User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)", Accept: "application/geo+json" };
const NOW = new Date(), STAMP = NOW.toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z", OUT = path.resolve("docs/threats/live-checks", NOW.toISOString().slice(0, 10));
const results = [], check = (name, cond, detail) => { results.push({ check: name, pass: !!cond, detail }); console.log((cond ? "pass " : "FAIL ") + name + (cond ? "" : " :: " + JSON.stringify(detail).slice(0, 700))); };
const TAG = () => (DRY ? "DRYRUN" : "LIVE");
const save = (name, obj) => { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, `${TAG()}-${STAMP}-${name}`); fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj, null, 1)); return path.relative(process.cwd(), f); };
const getJSON = async (u, h = UA) => { const r = await fetch(u, { headers: h }); if (!r.ok) throw Error(u + " HTTP " + r.status); return r.json(); };
/* LIVE_EVENTS / LIVE_LAYER: a dry run of the same checks on another live warning type (e.g. "Coastal Flood Warning" / coastal),
   to prove the tool while no severe warning is active; its evidence is labelled DRYRUN, never LIVE */
/* LIVE_REPLAY=archive-lox: the same checks on a saved warning (the alert's last message from the sample's fixture, the page on
   that archived sample, its clock at the message time); labelled DRYRUN. Proves the tool, never the live feed. */
const REPLAY = process.env.LIVE_REPLAY || "", REPLAY_FILE = { "archive-lox": "tests/fixtures/threats/nws-archive-klox-sv-w-0015.json" }[REPLAY];
const EVENTS = (process.env.LIVE_EVENTS || "Tornado Warning,Severe Thunderstorm Warning,Tornado Watch,Severe Thunderstorm Watch").split(","), LAYER = process.env.LIVE_LAYER || "severe", DRY = !!(process.env.LIVE_EVENTS || REPLAY);
const ALERTS = "https://api.weather.gov/alerts/active?event=" + EVENTS.map(encodeURIComponent).join(",");
const MDSVC = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query?where=1%3D1&outFields=*&f=geojson";
/* a point inside a polygon, and one just outside it (about 4-8 miles, toward the nearest open side) */
function insidePoint(g) { const b = T.bbox(g); for (let n = 8; n <= 64; n *= 2) for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) { const q = [b[0] + (b[2] - b[0]) * i / n, b[1] + (b[3] - b[1]) * j / n]; if (T.contains(g, q)) return q; } return null; }
function outsidePoint(g) { const b = T.bbox(g), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  for (const mi of [5, 8, 3, 11]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) {
    // walk from the centre outward until outside, then mi further
    let q = c.slice(), k = 0; while (T.contains(g, q) && k++ < 400) q = [q[0] + dx * 0.01, q[1] + dy * 0.01];
    const deg = mi / 69; q = [q[0] + dx * deg / Math.cos(q[1] * Math.PI / 180), q[1] + dy * deg];
    if (!T.contains(g, q)) return q; }
  return null; }
const DEV = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
(async () => {
  const alerts = REPLAY ? (() => { const all = JSON.parse(fs.readFileSync(REPLAY_FILE, "utf8")).features, last = all.filter((f) => f.geometry).pop(); return { type: "FeatureCollection", features: [last] }; })() : await getJSON(ALERTS),
    md = REPLAY ? { features: [] } : await getJSON(MDSVC, {}).catch((e) => ({ error: e.message }));
  const warns = alerts.features.filter((f) => /Warning$/.test(f.properties.event) && f.geometry), watches = alerts.features.filter((f) => /Watch$/.test(f.properties.event));
  const mds = (md.features || []).filter((f) => f.properties && !/noarea/i.test(f.properties.name || ""));
  console.log(`${TAG()} ${NOW.toISOString()}: ${warns.length} warning(s) with polygons, ${watches.length} watch message(s), ${mds.length} MD(s)`);
  if (!warns.length && !watches.length && !mds.length) { console.log("nothing active: no checks run"); process.exit(3); }
  const src = save("alerts.json", alerts); if (mds.length) save("md-service.json", md);
  const b = await chromium.launch(), out = { host: HOST, at: NOW.toISOString(), source: src, warning: null, watch: null, md: null };
  const open = async (o, q) => { const ctx = await b.newContext(o), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(HOST + "/threats?" + q + (REPLAY ? "&scenario=" + REPLAY : ""), { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__threats && window.__threats.ready && (window.__threats.S.scenario !== "live" || window.__threats.liveReady) && !window.__threats.data.loading, null, { timeout: 90000 }); await p.waitForTimeout(4000);
    return { ctx, p, errs }; };
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${TAG()}-${STAMP}-${name}.png`) });

  /* 1. a warning */
  if (warns.length) {
    const w = warns.find((f) => f.properties.event === "Tornado Warning") || warns[0], P = w.properties, id = P.id;
    const vtec = ((P.parameters || {}).VTEC || [])[0] || "", key = vtec.split(".").slice(2, 6).join(".") + ".", inP = insidePoint(w.geometry), outP = outsidePoint(w.geometry);
    out.warning = { id, key, event: P.event, sender: P.senderName, expires: P.expires, ends: P.ends, vtec, inside: inP, outside: outP };
    console.log(`warning: ${P.event} ${vtec} ${P.areaDesc} until ${P.expires}`);
    // national view, desktop
    { const { ctx, p, errs } = await open(DEV.desktop, "layers=" + LAYER + "&scope=national&view=active");
      const r = await p.evaluate((key) => { const T = window.__threats, prods = T.data.products, mine = prods.find((x) => x.kind === "warning" && String(x.id).startsWith(key)) || null;
        const drawn = new Set((T.map.getSource("active")._data.features || []).map((f) => f.properties.id)), first = document.querySelector("#txPanelBody .px-group .tx-item");
        return { found: mine && mine.id, drawn: mine ? drawn.has(mine.id) : false, firstId: first && first.dataset.id, firstText: first && first.innerText.replace(/\s+/g, " ").slice(0, 120), warnings: prods.filter((x) => x.kind === "warning").length }; }, key);
      await shot(p, "1-national-desktop"); out.warning.national = r;
      check(`LIVE WARNING national (desktop): ${P.event} drawn; first item in Most urgent now is a warning (${r.firstText})`, r.found && r.drawn && r.firstId && /Warning/.test(r.firstText || "") && !errs.length, { r, errs });
      await ctx.close(); }
    // venue inside and just outside, desktop and phone (sheet closed)
    for (const [where, pt] of [["inside", inP], ["outside", outP]]) { if (!pt) { check(`LIVE WARNING venue ${where}: no test point found`, false, null); continue; }
      for (const [d, o] of Object.entries(DEV)) { const q = `layers=${LAYER}&scope=venue&lat=${pt[1].toFixed(4)}&lon=${pt[0].toFixed(4)}&name=LIVE%20test%20(${where})&sheet=${d === "phone" ? "peek" : "open"}`;
        const { ctx, p, errs } = await open(o, q);
        const r = await p.evaluate(() => ({ brief: (document.querySelector(".px-brief") || {}).innerText || "", peek: [1, 2, 3].map((i) => document.getElementById("txPeek" + i).textContent).join(" | ") }));
        await shot(p, `1-venue-${where}-${d}`); (out.warning.venue = out.warning.venue || {})[where + "-" + d] = r;
        const txt = d === "phone" ? r.peek : r.brief;
        check(`LIVE WARNING venue ${where} (${d}): ${where === "inside" ? "'In effect at the venue'" : "'N miles <dir> · the venue is outside the warning area'"} (${txt.replace(/\s+/g, " ").slice(0, 140)})`,
          (where === "inside" ? /In effect at the venue|at LIVE test/i.test(txt) && new RegExp(P.event).test(txt) : /miles? (north|south|east|west|northeast|northwest|southeast|southwest)[^·]*· the venue is outside the warning area|outside the warning/i.test(txt)) && !errs.length, { r, errs });
        if (where === "inside" && d === "desktop") {
          // the detail: headline, expiration (same as the source), relationship, bulletin text, source link
          const det = await p.evaluate((key) => { const T = window.__threats, x = T.data.products.find((y) => y.kind === "warning" && String(y.id).startsWith(key)); T.S.sel = x.id; T.drawAll();
            const body = document.getElementById("txPanelBody"); return { id: x.id, expires: x.expires, text: body.innerText.replace(/\s+/g, " "), links: [...body.querySelectorAll("a[href]")].map((a) => a.href), bulletin: !!body.querySelector(".px-bulletin pre") && body.querySelector(".px-bulletin pre").textContent.length }; }, key);
          await p.locator("#txPanelBody .px-bulletin summary").first().click().catch(() => {}); await shot(p, "1-detail-desktop"); out.warning.detail = { ...det, text: det.text.slice(0, 600) };
          check(`LIVE WARNING detail: headline, expiration equal to the source's (${P.expires}), relationship, official bulletin text (${det.bulletin} chars), source link`,
            Date.parse(det.expires) === Date.parse(P.expires) && /In effect at the venue/i.test(det.text) && det.bulletin > 100 && det.links.some((h) => /weather\.gov|alerts/.test(h)) && new RegExp(P.event).test(det.text), det);
          // watch the open page for an update or the end
          if (WATCH_MIN > 0) { const until = Date.now() + WATCH_MIN * 60e3, seen = []; let last = null;
            while (Date.now() < until) { await p.waitForTimeout(60e3);
              const s = await p.evaluate((key) => { const T = window.__threats, x = T.data.products.find((y) => y.kind === "warning" && String(y.id).startsWith(key)); T.S.sel = null; T.drawAll();
                return { present: !!x, expires: x && x.expires, changed: !!(x && x.previous), notices: [...document.querySelectorAll(".px-notice")].map((n) => n.innerText.replace(/\s+/g, " ")).filter((t) => /cancelled|no longer listed|expired|upgraded/i.test(t)), drawn: (T.map.getSource("active")._data.features || []).filter((f) => f.properties.kind === "warning").length }; }, key);
              const k = JSON.stringify([s.present, s.expires, s.changed, s.notices]); if (k !== last) { seen.push({ at: new Date().toISOString(), ...s }); last = k; console.log("  watch:", JSON.stringify(s).slice(0, 300)); if (!s.present) { await shot(p, "1-ended-desktop"); break; } if (s.changed) await shot(p, "1-updated-desktop"); } }
            out.warning.watched = { minutes: WATCH_MIN, states: seen };
            const ended = seen.find((x) => !x.present), upd = seen.find((x) => x.changed);
            if (ended) check(`LIVE WARNING ended while open: the venue says '${(ended.notices[0] || "").slice(0, 80)}'; the warning is no longer drawn`, ended.notices.some((t) => /cancelled by NWS|no longer listed|expired/i.test(t)), ended);
            if (upd) check(`LIVE WARNING updated while open: 'What changed' available (new expiration ${upd.expires})`, upd.changed, upd);
            if (!ended && !upd) console.log(`  (no update or end within ${WATCH_MIN} min: those two checklist items stay open)`); }
        }
        await ctx.close(); } }
  } else console.log("section 1 skipped: no tornado or severe thunderstorm warning with a polygon is active");

  /* 2. a watch */
  if (watches.length) {
    const byEvent = {}; for (const f of watches) { const v = (((f.properties.parameters || {}).VTEC || [])[0] || "").split(".").slice(2, 6).join("."); (byEvent[v] = byEvent[v] || []).push(f); }
    const [v, msgs] = Object.entries(byEvent)[0], zones = [...new Set(msgs.flatMap((f) => f.properties.affectedZones || []))];
    out.watch = { vtec: v, messages: msgs.length, offices: [...new Set(msgs.map((f) => f.properties.senderName))], geometryNull: msgs.every((f) => !f.geometry), zoneKinds: zones.reduce((o, z) => { const k = /\/county\//.test(z) ? "county" : /\/forecast\//.test(z) ? "forecast" : "other"; o[k] = (o[k] || 0) + 1; return o; }, {}) };
    console.log("watch:", JSON.stringify(out.watch));
    const { ctx, p, errs } = await open(DEV.desktop, "layers=" + LAYER + "&scope=national&view=active"); await p.waitForTimeout(8000);
    const r = await p.evaluate(() => { const T = window.__threats, ws = T.data.products.filter((x) => x.kind === "watch"), drawn = new Set((T.map.getSource("active")._data.features || []).map((f) => f.properties.id)); const w = ws[0]; if (!w) return { n: 0 }; T.S.sel = w.id; T.drawAll(); return { n: ws.length, drawn: drawn.has(w.id), title: w.title, area: (document.getElementById("txPanelBody").innerText.match(/(Incomplete area|Area drawn from)[^\n]*/) || [""])[0] }; });
    await shot(p, "2-watch-desktop"); out.watch.map = r;
    check(`LIVE WATCH: ${r.title || "?"} drawn as one outline; '${r.area}'`, r.n >= 1 && r.drawn && /Area drawn from|Incomplete area/.test(r.area) && !errs.length, { r, errs }); await ctx.close();
  } else console.log("section 2 skipped: no tornado or severe thunderstorm watch is active");

  /* 3. an MD in the NOAA map service */
  if (mds.length) {
    out.md = { service: mds.map((f) => ({ name: f.properties.name, popupinfo: f.properties.popupinfo, folderpath: f.properties.folderpath, idp_filedate: f.properties.idp_filedate })) };
    const { ctx, p, errs } = await open(DEV.desktop, "layers=" + LAYER + "&scope=national&view=active");
    const r = await p.evaluate(() => { const T = window.__threats, m = T.data.products.filter((x) => x.kind === "md"), drawn = new Set((T.map.getSource("active")._data.features || []).map((f) => f.properties.id)), row = [...document.querySelectorAll(".px-src")].map((x) => x.innerText.replace(/\s+/g, " ")).find((t) => /Mesoscale/.test(t));
      const x = m[0]; if (x) { T.S.sel = x.id; T.drawAll(); } const body = document.getElementById("txPanelBody"); return { n: m.length, drawn: x ? drawn.has(x.id) : false, row, number: x && x.number, links: [...body.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => /spc\.noaa\.gov/.test(h)) }; });
    await shot(p, "3-md-desktop"); out.md.map = r;
    check(`LIVE MD: row says how it was checked ('${r.row}'); outline drawn; detail has number ${r.number} and an SPC bulletin link`, r.n >= 1 && r.drawn && /Checked/.test(r.row || "") && r.links.length > 0 && !errs.length, { r, errs }); await ctx.close();
  } else console.log("section 3 skipped: no active MD in the NOAA map service");

  save("results.json", { ...out, results }); await b.close();
  const failed = results.filter((x) => !x.pass).length; console.log(`${results.length - failed} of ${results.length} passed · evidence in ${path.relative(process.cwd(), OUT)}`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
