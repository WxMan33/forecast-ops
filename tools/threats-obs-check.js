/* Observed reports (NWS Local Storm Reports via Iowa Environmental Mesonet) on a hosted Threats page.
     live, desktop and phone: the toggle loads IEM's 24-hour feed; reports are drawn by kind; the legend and the source row say
       "Preliminary" and give the count and check time; a report opens with its type, observed time, place, reporter, office,
       remarks and the bulletin link; the toggle is remembered; nothing is requested while it is off.
     empty feed (a successful answer with no reports): "no reports in the last 24 h", not "not responding".
     outage (IEM failing): "Not responding", never "no reports".
     winter (TEST REPLAY): a snow, a freezing rain and a sleet report near CVG are drawn white / pink and open with their details.
     duplicates (TEST REPLAY): an SPC tornado report and the same LSR (same place, 5 minutes apart) draw once, as the observed report.
   Usage: node tools/threats-obs-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/obs-check");
if (!HOST) { console.error("usage: node tools/threats-obs-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const passNotice = async (p) => { if (/External Content Notice/.test(await p.title().catch(() => ""))) { await p.getByText("Open the page", { exact: false }).first().click(); await p.waitForLoadState("domcontentloaded"); } };
const CVG = "lat=39.0446&lon=-84.6723&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky");
const IEM = /mesonet\.agron\.iastate\.edu\/geojson\/lsr\.geojson/;
const DESKTOP = { viewport: { width: 1440, height: 900 } }, PHONE = { ...devices["iPhone 13"] };
const feat = (o) => ({ type: "Feature", properties: { wfo: "ILN", type: "S", magf: null, magnitude: null, unit: "", qualifier: "M", county: "Boone", state: "KY", st: "KY", source: "Trained Spotter", remark: "", city: "Hebron", product_id: "202611271700-KILN-NWUS51-LSRILN", ...o }, geometry: { type: "Point", coordinates: [o.lon, o.lat] } });

async function open(b, opt, { obs = true, route = null, query = "", theme = "dark" } = {}) {
  const ctx = await b.newContext(opt), p = await ctx.newPage(), errs = [], reqs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("request", (r) => { if (IEM.test(r.url())) reqs.push(r.url()); });
  await p.addInitScript(([o, th]) => { try { if (sessionStorage.getItem("__obscheck")) return; sessionStorage.setItem("__obscheck", "1"); localStorage.setItem("ops_theme", JSON.stringify(th)); localStorage.setItem("threats_obs", o ? "1" : "0"); } catch (e) {} }, [obs, theme]);
  if (route) await route(p);
  await p.goto(HOST + "/threats.html?" + CVG + "&view=active&scope=national" + query, { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
  await p.waitForFunction((o) => window.__threats && window.__threats.ready && (!o || (window.__threats.data.sources.obs && ["ok", "failed"].includes(window.__threats.data.sources.obs.state))), obs, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(2500);
  return { ctx, p, errs, reqs };
}
const read = (p) => p.evaluate(() => { const T = window.__threats, src = T.data.sources.obs || {}, st = T.data.state.obs || {}, d = T.map.getSource("obs") && T.map.getSource("obs")._data, lsr = T.map.getSource("lsr") && T.map.getSource("lsr")._data;
  const row = [...document.querySelectorAll(".px-src")].map((e) => e.textContent).find((x) => /Observed reports/.test(x)) || null, lg = document.querySelector("[data-lg=obs]");
  const ids = T.map.getStyle().layers.map((l) => l.id);
  return { src: { state: src.state, count: src.count, other: src.other, error: src.error }, kind: st.kind, drawn: d && d.features ? d.features.length : null, cats: d && d.features ? d.features.reduce((a, f) => ((a[f.properties.cat] = (a[f.properties.cat] || 0) + 1), a), {}) : {}, colors: d && d.features ? Object.fromEntries(d.features.map((f) => [f.properties.cat, f.properties.color])) : {},
    spcDrawn: lsr && lsr.features ? lsr.features.length : null, row, legend: lg ? lg.textContent : null, toggle: (document.querySelector("input[data-obs]") || {}).checked,
    order: { obs: ids.indexOf("obs"), warn: ids.indexOf("warn-fill"), radar: ids.indexOf("radar") } }; });
async function openReport(p, match) {
  const id = await p.evaluate((m) => { const d = window.__threats.map.getSource("obs")._data; const f = d.features.find((x) => new RegExp(m).test(x.properties.cat + " " + x.properties.id)); return f ? f.properties.id : null; }, match);
  if (!id) return null;
  await p.evaluate((id) => { window.__threats.S.sel = id; window.__threats.drawAll(); }, id); await p.waitForTimeout(800);
  return p.evaluate(() => { const panel = document.querySelector(".tx-panel, #txPanel, .px") || document.body; const k = [...document.querySelectorAll(".tx-kind")].map((e) => e.textContent); const dl = [...document.querySelectorAll(".px-rows dt")].map((e) => e.textContent);
    return { kind: k.find((x) => /LOCAL STORM REPORT/.test(x)) || null, title: (document.querySelector(".px-title") || {}).textContent, fields: dl, link: (document.querySelector('.px-rows a[href*="p.php?pid="]') || {}).href || null, note: [...document.querySelectorAll(".lg-note")].map((e) => e.textContent).find((x) => /Preliminary/.test(x)) || null }; });
}

(async () => {
  const b = await chromium.launch();
  /* ---- live, desktop ---- */
  { const { ctx, p, errs, reqs } = await open(b, DESKTOP); const s = await read(p);
    check(`(desktop, live) IEM feed: ${s.src.state}, ${s.src.count} reports in 24 h drawn ${s.drawn} (${JSON.stringify(s.cats)}); not drawn: ${JSON.stringify(s.src.other)}; ${reqs.length} request(s)`, s.src.state === "ok" && s.drawn === s.src.count && reqs.length >= 1 && /hours=24/.test(reqs[0]), { s, reqs });
    check(`(desktop, live) source row '${s.row}'`, /Observed reports/.test(s.row || "") && /preliminary/i.test(s.row || "") && (s.src.count ? new RegExp(s.src.count + " reports? in the last 24 h") : /no reports in the last 24 h/).test(s.row || ""), { row: s.row });
    check(`(desktop, live) legend: '${(s.legend || "").slice(0, 160)}'`, /Observed reports/.test(s.legend || "") && /preliminary/.test(s.legend || "") && /Snow/.test(s.legend || "") && /freezing rain/i.test(s.legend || ""), { legend: s.legend });
    check(`(desktop, live) layer order: observed reports (${s.order.obs}) above the hazard fills (${s.order.warn})`, s.order.obs > s.order.warn && s.order.warn >= 0, s.order);
    const d = await openReport(p, s.cats.snow ? "snow" : s.cats.fzra ? "fzra" : ".");
    check(`(desktop, live) a report opens: '${d && d.kind}', '${d && d.title}', fields ${d && d.fields.join("/")}, bulletin ${d && d.link ? "linked" : "missing"}`, d && d.kind === "PRELIMINARY NWS LOCAL STORM REPORT" && ["Report", "Observed", "Where", "Reported by", "Issued by", "Bulletin"].every((f) => d.fields.includes(f)) && d.link && d.note, { d });
    await p.screenshot({ path: path.join(OUT, "live-desktop-detail.png") });
    await p.evaluate(() => { window.__threats.S.sel = null; window.__threats.drawAll(); window.__threats.map.jumpTo({ center: [-80, 41], zoom: 4.6 }); }); await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(OUT, "live-desktop-northeast.png") });
    /* the toggle is remembered, and while off nothing is requested */
    await p.reload({ waitUntil: "domcontentloaded" }); await passNotice(p); await p.waitForFunction(() => window.__threats && window.__threats.ready, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(2500);
    const r = await read(p), pill = await p.evaluate(() => (document.querySelector("#txLayersBtn") || {}).textContent || "");
    check(`(desktop) after a reload the toggle is still on (${r.toggle}), reports are drawn (${r.drawn}), and the Layers button says so ('${pill.trim()}')`, r.toggle === true && r.drawn > 0 && /Reports/.test(pill), { r, pill });
    check("(desktop) no script errors", !errs.length, { errs }); await ctx.close(); }
  { const { ctx, p, errs, reqs } = await open(b, DESKTOP, { obs: false }); const s = await read(p);
    check(`(desktop) toggle off: no IEM requests (${reqs.length}), nothing drawn (${s.drawn}), no source row`, reqs.length === 0 && !s.drawn && !s.row && !errs.length, { s, reqs, errs }); await ctx.close(); }
  /* ---- live, phone ---- */
  { const { ctx, p, errs } = await open(b, PHONE, { theme: "light" }); const s = await read(p);
    await p.evaluate(() => window.__threats.map.jumpTo({ center: [-76, 42.5], zoom: 5 })); await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, "live-phone-light.png") });
    const d = await openReport(p, "."); await p.screenshot({ path: path.join(OUT, "live-phone-detail.png") });
    check(`(phone, light, live) ${s.drawn} reports drawn; a report opens ('${d && d.title}')`, s.src.state === "ok" && s.drawn === s.src.count && d && d.kind && !errs.length, { s, d, errs }); await ctx.close(); }
  /* ---- empty feed ---- */
  { const { ctx, p, errs } = await open(b, PHONE, { route: (p) => p.route(IEM, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: '{"type":"FeatureCollection","features":[]}' })), query: "&testreplay=obs-empty" });
    await p.waitForFunction(() => window.__threats.data.state.obs && window.__threats.data.state.obs.kind !== "loading", null, { timeout: 60000 }).catch(() => {});
    const s = await read(p); await p.screenshot({ path: path.join(OUT, "empty-phone.png") });
    check(`(phone) empty feed: state ${s.src.state}, '${s.row}'`, s.src.state === "ok" && s.drawn === 0 && /no reports in the last 24 h/.test(s.row || "") && !/Not responding/.test(s.row || "") && !errs.length, { s, errs }); await ctx.close(); }
  /* ---- outage ---- */
  { const { ctx, p, errs } = await open(b, DESKTOP, { route: (p) => p.route(IEM, (r) => r.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, body: "Service Unavailable" })), query: "&testreplay=obs-outage" });
    const s = await read(p); await p.screenshot({ path: path.join(OUT, "outage-desktop.png") });
    check(`(desktop) outage: state ${s.src.state}, kind ${s.kind}, '${s.row}'`, s.src.state === "failed" && /Not responding/.test(s.row || "") && !/no reports/.test(s.row || "") && !errs.length, { s, errs }); await ctx.close(); }
  /* ---- winter (TEST REPLAY) ---- */
  { const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString().replace(/\.\d+Z$/, "Z");
    const fc = { type: "FeatureCollection", features: [
      feat({ typetext: "SNOW", magf: 3.5, magnitude: "3.5", unit: "INCH", city: "Hebron", lat: 39.07, lon: -84.70, valid: iso(40), remark: "Storm total so far." }),
      feat({ typetext: "FREEZING RAIN", magf: 0.15, magnitude: "0.15", unit: "INCH", qualifier: "E", city: "Florence", lat: 38.99, lon: -84.63, valid: iso(25), remark: "Glaze on trees and power lines." }),
      feat({ typetext: "SLEET", magf: 0.5, magnitude: "0.5", unit: "INCH", city: "Burlington", lat: 39.03, lon: -84.72, valid: iso(15), remark: "" }),
      feat({ typetext: "NON-TSTM WND GST", magf: 38, magnitude: "38", unit: "MPH", city: "Erlanger", lat: 39.02, lon: -84.60, valid: iso(10) }) ] };
    const { ctx, p, errs } = await open(b, PHONE, { route: (p) => p.route(IEM, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(fc) })), query: "&testreplay=obs-winter" });
    await p.evaluate(() => window.__threats.map.jumpTo({ center: [-84.67, 39.03], zoom: 9.5 })); await p.waitForTimeout(2500); const s = await read(p); await p.screenshot({ path: path.join(OUT, "winter-phone.png") });
    const sn = await openReport(p, "snow"); await p.screenshot({ path: path.join(OUT, "winter-phone-snow.png") }); const fz = await openReport(p, "FREEZING RAIN"); await p.screenshot({ path: path.join(OUT, "winter-phone-freezing-rain.png") });
    check(`(phone) winter TEST REPLAY: drawn ${JSON.stringify(s.cats)} in ${JSON.stringify(s.colors)}; the non-thunderstorm gust is counted, not drawn (${JSON.stringify(s.src.other)}); snow '${sn && sn.title}'; freezing rain '${fz && fz.title}'`,
      s.cats.snow === 1 && s.cats.fzra === 1 && s.cats.sleet === 1 && s.drawn === 3 && s.colors.sleet === "#9b5de5" && s.colors.fzra === "#ff4fa3" && /Sleet or wintry mix/.test(s.legend || "") && /Freezing rain or ice/.test(s.legend || "") && s.src.other && s.src.other["NON-TSTM WND GST"] === 1 && /Snow · 3\.5 in \(measured\) · Hebron, KY/.test(sn && sn.title || "") && /Freezing rain · 0\.15 in \(estimated\) · Florence, KY/.test(fz && fz.title || "") && !errs.length, { s, sn, fz, errs });
    await ctx.close(); }
  /* ---- duplicates (TEST REPLAY): the SPC tornado report and the same LSR ---- */
  { const now = new Date(), d0 = new Date(now - (now.getUTCHours() < 12 ? 864e5 : 0)), hh = String(now.getUTCHours()).padStart(2, "0"), mm = String(Math.max(0, now.getUTCMinutes() - 20)).padStart(2, "0");
    const csv = `Time,F_Scale,Location,County,State,Lat,Lon,Comments\n${hh}${mm},UNK,2 N Hebron,Boone,KY,39.09,-84.70,Brief tornado touchdown. (ILN)\nTime,Speed,Location,County,State,Lat,Lon,Comments\n${hh}${mm},65,5 S Union,Boone,KY,38.88,-84.68,Trees down. (ILN)\nTime,Size,Location,County,State,Lat,Lon,Comments\n`;
    const lsrT = new Date(Date.parse(d0.toISOString().slice(0, 10) + "T00:00:00Z") + (+hh < 12 && now.getUTCHours() < 12 ? 864e5 : 0) + (+hh) * 3600e3 + (+mm) * 60e3 + 5 * 60e3).toISOString().replace(/\.\d+Z$/, "Z");
    const fc = { type: "FeatureCollection", features: [feat({ typetext: "TORNADO", city: "2 N Hebron", lat: 39.09, lon: -84.70, valid: lsrT, remark: "Brief tornado touchdown." })] };
    const { ctx, p, errs } = await open(b, DESKTOP, { route: async (p) => { await p.route(IEM, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(fc) }));
      await p.route(/\/api\/spc\/reports\/today|climo\/reports\/today_filtered\.csv/, (r) => r.fulfill({ status: 200, headers: { "content-type": "text/csv", "access-control-allow-origin": "*", "X-Upstream-Fetched-At": new Date().toISOString(), "Access-Control-Expose-Headers": "X-Upstream-Fetched-At" }, body: csv }));
      await p.route(/\/api\/spc\/reports\/yesterday|climo\/reports\/yesterday_filtered\.csv/, (r) => r.fulfill({ status: 200, headers: { "content-type": "text/csv", "access-control-allow-origin": "*", "X-Upstream-Fetched-At": new Date().toISOString(), "Access-Control-Expose-Headers": "X-Upstream-Fetched-At" }, body: "Time,F_Scale,Location,County,State,Lat,Lon,Comments\nTime,Speed,Location,County,State,Lat,Lon,Comments\nTime,Size,Location,County,State,Lat,Lon,Comments\n" })); }, query: "&testreplay=obs-duplicates" });
    await p.evaluate(() => { const T = window.__threats; T.S.layers.severe = true; T.S.auto = false; T.drawAll(); }); await p.waitForTimeout(6000);
    const s = await read(p), spc = await p.evaluate(() => window.__threats.data.products.filter((x) => x.kind === "lsr").map((x) => x.type));
    check(`(desktop) duplicates TEST REPLAY: SPC reports loaded ${JSON.stringify(spc)}; drawn SPC ${s.spcDrawn} (the wind report only), observed ${s.drawn} (the tornado)`, spc.includes("tornado") && s.spcDrawn === spc.length - 1 && s.drawn === 1 && !errs.length, { s, spc, errs });
    await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, "obs-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
