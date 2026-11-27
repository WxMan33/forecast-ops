/* Precipitation type (MRMS PrecipFlag) on a hosted Threats page: live, throttled phones, fallback and a winter replay.
     live (desktop): the default mode is Precipitation type, read through the page's /api/mrms forwarder (NOAA sends no CORS
       header, so a direct read is also tried and must fail); scan age; coverage; only NOAA's documented codes in the grid;
       nearest-neighbour; 70% opacity; state and county lines and warnings above radar; legend: the categories, "No radar
       coverage", and the no sleet / freezing-rain note; switching to Reflectivity and back; the opacity slider in both modes;
       both remembered after a reload.
     phones at 360 and 390 px, 4x slower CPU and a throttled network: download size and time, decode time, tile times, and
       consecutive refreshes (each new scan downloaded once).
     fallback: the forwarder failing, and a scan 30 minutes old: "Precipitation type unavailable · showing reflectivity" and the
       Reflectivity 2026 legend with the reflectivity layer.
     winter replay (TEST REPLAY) at CVG: the real current PrecipFlag and lcref files with a rain-to-snow transition painted over
       Kentucky, Ohio and Indiana (warm rain, cool rain, then snow to the north, with a ragged edge), checked pixel by pixel on
       tiles the page drew, in both modes.
   Screenshots: desktop, 360 and 390 px, both modes, with the Layers panel open.
   Usage: node tools/threats-ptype-check.js https://<host> [outDir] [minutes of phone refreshes, default 5]
   ONLY=winter runs just the winter replay (and builds its files). */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const RD = require("../assets/threats-radar.js"), PFB = require("./precipflag-grib.js");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/ptype-check"), MIN = +(process.argv[4] || 5);
if (!HOST) { console.error("usage: node tools/threats-ptype-check.js https://host [outDir] [minutes]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 900))); };
const passNotice = async (p) => { if (/External Content Notice/.test(await p.title().catch(() => ""))) { await p.getByText("Open the page", { exact: false }).first().click(); await p.waitForLoadState("domcontentloaded"); } };
const CVG = "lat=39.0446&lon=-84.6723&name=" + encodeURIComponent("CVG airport, Cincinnati/Northern Kentucky");
const UA = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const PHONES = { "360": { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices["Galaxy S8"].userAgent }, "390": { ...devices["iPhone 13"] } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const inflate = async (z) => new Uint8Array(zlib.inflateSync(Buffer.from(z)));
const { execFileSync } = require("child_process");
const download = (u) => new Uint8Array(execFileSync("curl", ["-sSf", "--max-time", "60", "-A", UA, u], { maxBuffer: 64 * 1048576 }));

async function open(b, opt, { theme = "dark", slow = false, mode = null, op = null, route = null, query = "" } = {}) {
  const ctx = await b.newContext(opt), p = await ctx.newPage(), errs = [], reqs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("requestfinished", async (r) => { const u = r.url(); if (!/\/api\/mrms\/|mrms\/lcref|mapservices\.weather\.noaa\.gov\/.*radar/.test(u)) return; const s = await r.sizes().catch(() => null); reqs.push({ at: Date.now(), url: u.replace(/\?.*$/, ""), bytes: s ? s.responseBodySize : null }); });
  if (slow) { const cdp = await ctx.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8 * 5, uploadThroughput: 750e3 / 8 }); } // about 8 Mbps down, 150 ms
  await p.addInitScript(([th, mode, op]) => { try { if (sessionStorage.getItem("__ptcheck")) return; sessionStorage.setItem("__ptcheck", "1"); // first load only: a reload keeps what the page saved
    localStorage.setItem("ops_theme", JSON.stringify(th)); if (mode) localStorage.setItem("tx_radar_mode", mode); else localStorage.removeItem("tx_radar_mode"); if (op) localStorage.setItem("tx_radar_opacity", op); else localStorage.removeItem("tx_radar_opacity"); } catch (e) {} }, [theme, mode, op]);
  if (route) await route(p);
  await p.goto(HOST + "/threats.html?" + CVG + "&radar=1&view=active&scope=venue" + query, { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
  await p.waitForFunction(() => window.__threats && window.__threats.ready && window.__threats.radar && window.__threats.radar.state === "ok" && window.__threats.radar.via, null, { timeout: 150000 }).catch(() => {});
  await p.waitForTimeout(3000);
  return { ctx, p, errs, reqs };
}
const read = (p) => p.evaluate(() => { const T = window.__threats, m = T.map, st = m.getStyle(), ids = st.layers.map((l) => l.id), r = T.radar, ri = ids.indexOf("radar");
  const lines = ["hu-state", "cnty-lines"].filter((id) => ids.includes(id)), act = st.layers.filter((l) => l.source === "active").map((l) => l.id), gi = ids.indexOf("gauge");
  const ps = T.ptypeStats, lg = document.querySelector("[data-lg=ptype]"), lr = document.querySelector("[data-lg=radar]"), fb = document.querySelector("[data-ptype-fallback]");
  const med = (a) => (a && a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  return { mode: T.radarMode(), via: r.via, state: r.state, valid: r.valid, ptFallback: r.ptFallback, ptError: r.ptError, iemError: r.iemError || null,
    order: { radar: ri, lines: lines.map((id) => [id, ids.indexOf(id)]), linesAbove: ri >= 0 && lines.length === 2 && lines.every((id) => ids.indexOf(id) > ri), warnings: act.length, warningsAbove: act.every((id) => ids.indexOf(id) > ri), gauge: gi, gaugeAbove: gi < 0 || gi > ri },
    paint: m.getLayer("radar") && { opacity: m.getPaintProperty("radar", "raster-opacity"), resampling: m.getPaintProperty("radar", "raster-resampling") },
    pt: ps && { scan: ps.scan, pfScan: ps.pfScan, pfBytes: ps.pfBytes, bytes: ps.bytes, downloadMs: ps.downloadMs, decodeMs: ps.decodeMs, size: ps.size, codes: ps.codes, unknown: ps.unknown, loads: ps.loads, tiles: ps.tileMs.length, tileMed: med(ps.tileMs), tileMax: ps.tileMs.length ? Math.max(...ps.tileMs) : null, error: ps.error },
    legend: { rainBar: lg ? (lg.querySelector(".lg-r26") || { children: [] }).children.length : 0, snowBar: lg ? (lg.querySelector(".lg-snow") || { children: [] }).children.length : 0, ptype: !!lg, items: lg ? [...lg.querySelectorAll(".lg-pt span")].map((s) => s.textContent) : [], note: lg ? lg.querySelector(".lg-note").textContent : "", refl: !!(lr && lr.querySelector(".lg-r26")), fallback: fb ? fb.textContent : null },
    credit: (document.querySelector(".maplibregl-ctrl-attrib-inner") || {}).textContent || "", unknownLegend: (document.querySelector("[data-ptype-unknown]") || {}).textContent || null, ptLast: (document.querySelector("[data-ptype-last]") || {}).textContent || null,
    reflScan: T.radarStats && T.radarStats.scan, reflLegendScan: lr ? (lr.querySelector(".lg-note").textContent.match(/scan (.+)$/) || [])[1] || null : null, theme: document.documentElement.dataset.theme,
    row: (document.querySelector("[data-src=radar]") || {}).textContent || "", note: document.getElementById("txRadarNote").textContent,
    opShown: (document.querySelector("[data-radar-op-val]") || {}).textContent, modeChecked: (document.querySelector("[data-radar-mode]:checked") || {}).value, badge: (document.getElementById("txBadge") || {}).textContent };
});
/* the colour the page draws at a lon/lat: ask the page's own tile renderer (the ptype:// or lcref:// protocol) for the tile and read one pixel */
async function pixel(p, lon, lat, z = 7) {
  const n = 2 ** z, fx = (lon + 180) / 360 * n, s = Math.sin(lat * Math.PI / 180), fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const x = Math.floor(fx), y = Math.floor(fy), px = Math.floor((fx - x) * 256), py = Math.floor((fy - y) * 256);
  return p.evaluate(async ([z, x, y, px, py]) => { const r = window.__threats.radar, c = r.via === "ptype" ? r.pt : r.client, t = await c.tile({ url: (r.via === "ptype" ? "ptype" : "lcref") + `://${z}/${x}/${y}` });
    const bm = await createImageBitmap(new Blob([t.data], { type: "image/png" })), cv = new OffscreenCanvas(256, 256), g = cv.getContext("2d"); g.drawImage(bm, 0, 0); return [...g.getImageData(px, py, 1, 1).data]; }, [z, x, y, px, py]);
}
async function layersShot(p, file) { await p.locator("#txLayersBtn").click(); await p.waitForTimeout(500); await p.locator("#txRadarMode").scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300); await p.screenshot({ path: path.join(OUT, file) }); await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
async function pickMode(p, mode) { await p.locator("#txLayersBtn").click(); await p.waitForTimeout(400); await p.locator(`[data-radar-mode][value=${mode}] + span`).click(); await p.waitForTimeout(300); await p.keyboard.press("Escape");
  await p.waitForFunction((m) => { const r = window.__threats.radar; return r.state === "ok" && (m === "ptype" ? r.via === "ptype" : r.via === "iem"); }, mode, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(2500); }

/* the winter replay: real current files with a rain-to-snow transition over KY / OH / IN, scan time 2 minutes ago */
async function winterFiles() {
  const pfGz = download("https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz");
  const g = zlib.gunzipSync(pfGz), f = RD.parsePrecipFlag(new Uint8Array(g)), d = await RD.decodeIndexedPng(f.png, inflate), W = f.width;
  const col = (lon) => Math.round((lon - f.world.firstLon) / f.world.dx), row = (lat) => Math.round((lat - f.world.firstLat) / f.world.dy);
  const edge = (lon) => 39.35 + 0.25 * Math.sin(lon * 2.3) + 0.1 * Math.sin(lon * 7.1); // the rain/snow line, ragged
  const code = (lon, lat) => (lat >= edge(lon) ? 3 : lat >= edge(lon) - 0.45 ? 10 : lat >= 38.0 ? 1 : 6);
  const bytes = new Uint8Array(d.indices);
  for (let y = row(40.8); y <= row(37.6); y++) for (let x = col(-87.4); x <= col(-82.2); x++) { const lon = f.world.firstLon + x * f.world.dx, lat = f.world.firstLat + y * f.world.dy; bytes[y * W + x] = code(lon, lat) + 3; }
  for (let y = row(40.7); y <= row(40.4); y++) for (let x = col(-86.9); x <= col(-86.3); x++) bytes[y * W + x] = 50 + 3; // code 50: not in NOAA's table
  const scan = Math.floor((Date.now() - 2 * 60e3) / 60e3) * 60e3;
  const pf = zlib.gzipSync(PFB.replacePixels(g, bytes, scan));
  /* reflectivity to match: 32 dBZ in the convective rain, 25 in warm rain, 20 in cool rain, 15-25 dBZ snow */
  const base = RD.BASE, json = Buffer.from(download(base + ".json")).toString(), wld = Buffer.from(download(base + ".wld")).toString(), png = download(base + ".png");
  const lg = await RD.decodeIndexedPng(png, inflate), w = RD.parseWorldFile(wld), lc = (lon) => Math.round((lon - w.firstLon) / w.dx), lr = (lat) => Math.round((lat - w.firstLat) / w.dy);
  for (let y = lr(40.8); y <= lr(37.6); y++) for (let x = lc(-87.4); x <= lc(-82.2); x++) { const lon = w.firstLon + x * w.dx, lat = w.firstLat + y * w.dy, c = code(lon, lat), dbz = c === 6 ? 32 : c === 1 ? 25 : c === 10 ? 20 : 15 + 10 * ((x + y) % 7) / 7; lg.indices[y * lg.width + x] = Math.round((dbz + 32) * 2); }
  const keep = [], dv = new DataView(png.buffer, png.byteOffset, png.byteLength); let idatAt = -1;
  for (let o = 8; o + 12 <= png.length;) { const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8)); if (type === "IDAT") { if (idatAt < 0) idatAt = keep.length; } else if (type !== "IEND") keep.push(Buffer.from(png.subarray(o, o + len + 12))); o += len + 12; }
  const raw = Buffer.alloc((lg.width + 1) * lg.height); for (let y = 0; y < lg.height; y++) Buffer.from(lg.indices.buffer, y * lg.width, lg.width).copy(raw, y * (lg.width + 1) + 1);
  const crcT = []; for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[k] = c >>> 0; }
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); let x = 0xffffffff; for (const b of Buffer.concat([t, data])) x = crcT[(x ^ b) & 255] ^ (x >>> 8); c.writeUInt32BE((x ^ 0xffffffff) >>> 0); return Buffer.concat([len, t, data, c]); };
  keep.splice(idatAt, 0, chunk("IDAT", zlib.deflateSync(raw, { level: 6 })));
  const j = JSON.parse(json); j.meta.start_valid = j.meta.end_valid = new Date(scan).toISOString().replace(/\.000Z$/, "Z");
  return { scan, pf, lcref: { json: JSON.stringify(j), wld, png: Buffer.concat([Buffer.from(png.subarray(0, 8)), ...keep, chunk("IEND", Buffer.alloc(0))]) }, code, edge };
}
/* a PrecipFlag file for any minute (the replay's pixels, that minute's scan time), for routes that answer the page's /at/ asks */
let pfBase = null; const pfCache = new Map();
async function pfFor(stamp) {
  if (!pfCache.has(stamp)) { if (!pfBase) { const g = zlib.gunzipSync(download("https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz")); pfBase = { g, idx: (await RD.decodeIndexedPng(RD.parsePrecipFlag(new Uint8Array(g)).png, inflate)).indices }; }
    const t = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13)); pfCache.set(stamp, zlib.gzipSync(PFB.replacePixels(pfBase.g, pfBase.idx, t))); }
  return pfCache.get(stamp);
}
const ptRoute = (gz, scanIso) => async (p) => {
  await p.route(/\/api\/mrms\/precipflag\/at\//, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/gzip", "access-control-allow-origin": "*" }, body: Buffer.from(gz) }));
  await p.route(/\/api\/mrms\/precipflag\/time/, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ product: "PrecipFlag", scan: scanIso, fetchedAt: new Date().toISOString(), bytes: gz.length }) }));
  await p.route(/\/api\/mrms\/precipflag\/latest/, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/gzip", "access-control-allow-origin": "*" }, body: Buffer.from(gz) }));
};

(async () => {
  const b = await chromium.launch(), info = {};
  const ONLY = process.env.ONLY || "";
  /* ---- live, desktop ---- */
  if (!ONLY) { const { ctx, p, errs, reqs } = await open(b, DESKTOP);
    const direct = await p.evaluate(async () => { try { await fetch("https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz"); return "readable"; } catch (e) { return "blocked"; } });
    const s = await read(p); info.live = s; const age = s.pt && s.pt.scan ? Math.round((Date.now() - s.pt.scan) / 60e3) : null;
    const total = s.pt && s.pt.codes ? Object.values(s.pt.codes).reduce((a, x) => a + x, 0) : 0, cov = total ? 1 - (s.pt.codes["-3"] || 0) / total : 0;
    check(`(desktop) browser access: NOAA's file read directly is ${direct} (no CORS header); through /api/mrms the page shows precipitation type by default (mode ${s.mode}, via ${s.via})`, direct === "blocked" && s.mode === "ptype" && s.via === "ptype" && s.modeChecked === "ptype", { direct, s });
    check(`(desktop) scan ${s.pt && new Date(s.pt.scan).toISOString()} is ${age} min old; grid ${s.pt && s.pt.size}; reflectivity ${(s.pt.bytes / 1024).toFixed(0)} KB + type ${(s.pt.pfBytes / 1024).toFixed(0)} KB in ${s.pt.downloadMs} ms; decoded in ${s.pt.decodeMs} ms; type scan ${s.pt.pfScan && new Date(s.pt.pfScan).toISOString()} = radar scan`, age != null && age <= 15 && s.pt.size === "7000x3500" && s.pt.pfScan === s.pt.scan && s.pt.pfBytes < 600e3, { pt: s.pt });
    check(`(desktop) codes in the live grid: ${JSON.stringify(s.pt.codes)}; all documented (unknown: ${JSON.stringify(s.pt.unknown)}); radar coverage ${(cov * 100).toFixed(1)}% of the grid (the rest is outside coverage, hatched, not 'no precipitation')`, s.pt.unknown.length === 0 && s.pt.codes["-3"] > 0 && s.pt.codes["0"] > 0, { codes: s.pt.codes });
    check(`(desktop) style: opacity ${s.paint && s.paint.opacity}, ${s.paint && s.paint.resampling}; state and county lines ${JSON.stringify(s.order.lines)} and ${s.order.warnings} warning layers above radar (${s.order.radar}); gauges ${s.order.gauge < 0 ? "not loaded" : "layer " + s.order.gauge}`, s.paint.opacity === 0.7 && s.paint.resampling === "nearest" && s.order.linesAbove && s.order.warningsAbove && s.order.gaugeAbove, { s });
    check(`(desktop) legend: rain bar (Reflectivity 2026) ${s.legend.rainBar}, snow bar ${s.legend.snowBar}; ${s.legend.items.join(" / ")}; note '${s.legend.note.slice(0, 150)}'`, s.legend.ptype && s.legend.rainBar === 14 && s.legend.snowBar === 14 && s.legend.items.includes("No radar coverage") && !s.legend.items.some((x) => /stratiform|convective|tropical/i.test(x)) && /no sleet, freezing-rain or mixed category/.test(s.legend.note) && !s.legend.fallback, { legend: s.legend });
    await p.screenshot({ path: path.join(OUT, "live-desktop-ptype-cvg.png") });
    await p.evaluate(() => window.__threats.map.jumpTo({ center: [-74.2, 43.6], zoom: 6.3 })); await p.waitForTimeout(4000); await p.screenshot({ path: path.join(OUT, "live-desktop-ptype-northeast-rain-snow.png") });
    await layersShot(p, "live-desktop-ptype-layers.png");
    /* switch to Reflectivity; slider at 50% in reflectivity; back to precipitation type: still 50%; reload: mode and opacity kept */
    await pickMode(p, "refl"); const r1 = await read(p); await p.screenshot({ path: path.join(OUT, "live-desktop-refl-northeast.png") });
    await p.locator("#txLayersBtn").click(); await p.waitForTimeout(300); await p.locator("[data-radar-op]").fill("50"); await p.waitForTimeout(300); const r1b = await read(p); await p.screenshot({ path: path.join(OUT, "live-desktop-refl-layers-50.png") }); await p.keyboard.press("Escape");
    await pickMode(p, "ptype"); const r2 = await read(p);
    check(`(desktop) Reflectivity: via ${r1.via}, Reflectivity 2026 legend ${r1.legend.refl}; slider 50% → map ${r1b.paint.opacity}; back to Precipitation type: via ${r2.via}, map ${r2.paint.opacity}, shows ${r2.opShown}`, r1.via === "iem" && r1.legend.refl && !r1.legend.ptype && r1b.paint.opacity === 0.5 && r2.via === "ptype" && r2.paint.opacity === 0.5 && r2.opShown === "50%" && r2.legend.ptype, { r1, r1b, r2 });
    await pickMode(p, "refl"); await p.reload({ waitUntil: "domcontentloaded" }); await passNotice(p);
    await p.waitForFunction(() => window.__threats && window.__threats.radar && window.__threats.radar.state === "ok" && window.__threats.radar.via, null, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(2500);
    const r3 = await read(p); check(`(desktop) after a reload: mode ${r3.mode} (${r3.via}), opacity ${r3.paint && r3.paint.opacity} (${r3.opShown})`, r3.mode === "refl" && r3.via === "iem" && r3.paint.opacity === 0.5 && r3.opShown === "50%", { r3 });
    check("(desktop) no script errors", !errs.length, { errs }); fs.writeFileSync(path.join(OUT, "live-desktop-requests.json"), JSON.stringify(reqs, null, 1)); await ctx.close(); }

  /* ---- phones, 4x slower CPU, throttled network ---- */
  for (const w of ONLY ? [] : ["360", "390"]) {
    const { ctx, p, errs, reqs } = await open(b, PHONES[w], { slow: true }); const s = await read(p);
    await p.screenshot({ path: path.join(OUT, `live-${w}-ptype.png`) }); await layersShot(p, `live-${w}-ptype-layers.png`);
    await p.evaluate(() => window.__threats.map.jumpTo({ center: [-73.8, 43.8], zoom: 5.6 })); await p.waitForTimeout(4000); await p.screenshot({ path: path.join(OUT, `live-${w}-ptype-northeast-rain-snow.png`) });
    const scans = [{ scan: s.pt && s.pt.scan, bytes: s.pt && s.pt.bytes, downloadMs: s.pt && s.pt.downloadMs, decodeMs: s.pt && s.pt.decodeMs }];
    if (w === "390") { const t0 = Date.now(); while (Date.now() - t0 < MIN * 60e3) { await p.waitForTimeout(20e3); await p.evaluate(() => window.__threats.map.panBy([30, 0], { duration: 0 }));
      const x = await read(p); if (x.pt && x.pt.scan !== scans[scans.length - 1].scan) scans.push({ scan: x.pt.scan, bytes: x.pt.bytes, downloadMs: x.pt.downloadMs, decodeMs: x.pt.decodeMs }); } }
    const last = await read(p), gets = reqs.filter((r) => /precipflag\/at\//.test(r.url)), times = reqs.filter((r) => /lcref\.json$/.test(r.url)), lcref = reqs.filter((r) => /lcref\.png$/.test(r.url));
    console.log(`phone ${w}:`, JSON.stringify(scans.map((x) => ({ scan: x.scan && new Date(x.scan).toISOString().slice(11, 16) + "Z", KB: x.bytes && Math.round(x.bytes / 1024), downloadMs: x.downloadMs, decodeMs: x.decodeMs }))));
    check(`(${w} px, 4x slower CPU, ~8 Mbps / 150 ms) precipitation type via ${s.via}: ${scans.length} scan(s), ${lcref.length} reflectivity image(s) and ${gets.length} same-minute type file(s) (${gets.map((r) => Math.round((r.bytes || 0) / 1024) + " KB").join(", ")}), scan time read ${times.length} times; download ${scans.map((x) => x.downloadMs + " ms").join(", ")}; decode ${scans.map((x) => x.decodeMs + " ms").join(", ")}; tiles median ${Math.round(last.pt.tileMed)} ms, max ${Math.round(last.pt.tileMax)} ms (${last.pt.tiles})`,
      s.via === "ptype" && gets.length === scans.length && last.pt.loads === scans.length && (w !== "390" || scans.length >= 2) && lcref.length === scans.length && !errs.length, { scans, last: last.pt, errs, gets });
    await pickMode(p, "refl"); await p.screenshot({ path: path.join(OUT, `live-${w}-refl-northeast.png`) }); await layersShot(p, `live-${w}-refl-layers.png`);
    const r = await read(p); check(`(${w} px) Reflectivity: via ${r.via}, legend Reflectivity 2026 ${r.legend.refl}, opacity ${r.paint.opacity}; lines and warnings above radar`, r.via === "iem" && r.legend.refl && r.paint.opacity === 0.7 && r.order.linesAbove && r.order.warningsAbove, { r });
    info["phone" + w] = { scans, last: last.pt }; await ctx.close(); }

  /* ---- fallback: forwarder failing; scan 30 minutes old ---- */
  if (!ONLY) { const { ctx, p, errs } = await open(b, PHONES["390"], { route: async (p) => { await p.route(/\/api\/mrms\//, (r) => r.fulfill({ status: 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: '{"error":"MRMS did not answer in time"}' })); } });
    const s = await read(p); await p.screenshot({ path: path.join(OUT, "fallback-390-unavailable.png") }); await layersShot(p, "fallback-390-unavailable-layers.png");
    const reflIso = s.reflScan && new Date(s.reflScan).toISOString();
    check(`(390 px) forwarder failing, everything names the reflectivity on screen: map credit '${s.credit}'; legend '${s.legend.fallback}' + Reflectivity 2026 (scan ${s.reflLegendScan}); '${s.ptLast}'; source row '${s.row}'; Layers note '${s.note}'; the reflectivity scan shown is ${reflIso} = page scan ${s.valid}`,
      s.mode === "ptype" && s.ptFallback && s.via === "iem" && s.legend.fallback === "Precipitation type unavailable · showing reflectivity" && s.legend.refl && !s.legend.ptype && /^Reflectivity: MRMS via Iowa Environmental Mesonet \(precipitation type unavailable\)/.test(s.credit) && /^Precipitation type unavailable · showing reflectivity · MRMS lowest-elevation reflectivity, scan/.test(s.note) && /Precipitation type unavailable · showing reflectivity · MRMS reflectivity/.test(s.row) && reflIso === s.valid && s.reflLegendScan && !errs.length, { s, errs });
    await ctx.close(); }
  const W = await winterFiles();
  if (!ONLY) { const { ctx, p, errs } = await open(b, DESKTOP, { route: (p) => p.route(/\/api\/mrms\/precipflag\/at\//, (r) => r.fulfill({ status: 404, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: '{"error":"MRMS has no precipitation-type scan for this minute"}' })) });
    const s = await read(p); await p.screenshot({ path: path.join(OUT, "fallback-desktop-unaligned.png") });
    check(`(desktop) no precipitation-type scan for the radar's minute: legend '${s.legend.fallback}', reflectivity shown (${s.via}), reason '${s.ptError}'`, s.ptFallback && s.via === "iem" && s.legend.fallback === "Precipitation type unavailable · showing reflectivity" && s.legend.refl && /no precipitation-type scan for the radar scan/.test(s.ptError || "") && !errs.length, { s, errs });
    await ctx.close(); }

  /* ---- recovery: the forwarder fails for the first 3 minutes, then a fresh scan arrives; saved opacity 40% throughout ---- */
  if (!ONLY) { let failUntil = 0; const route = async (p) => { failUntil = Date.now() + 150e3;
      await p.route(/\/api\/mrms\/precipflag\/at\//, async (r) => { if (Date.now() < failUntil) return r.fulfill({ status: 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: '{"error":"MRMS did not answer in time"}' });
        const st = /at\/(\d{8}-\d{4})/.exec(r.request().url())[1]; r.fulfill({ status: 200, headers: { "content-type": "application/gzip", "access-control-allow-origin": "*" }, body: await pfFor(st) }); }); };
    const { ctx, p, errs } = await open(b, PHONES["390"], { op: "0.4", route, query: "&testreplay=radar-ptype-recovery" }); const a = await read(p); await p.screenshot({ path: path.join(OUT, "recovery-390-1-fallback.png") });
    await p.waitForFunction(() => window.__threats.radar.via === "ptype", null, { timeout: 240000 }).catch(() => {}); await p.waitForTimeout(3000);
    const z = await read(p); await p.evaluate(() => window.__threats.map.jumpTo({ center: [-84.7, 39.1], zoom: 6.6 })); await p.waitForTimeout(3000); await p.screenshot({ path: path.join(OUT, "recovery-390-2-ptype-back.png") });
    check(`(390 px) recovery without a reload: first ${a.via}${a.ptFallback ? " (fallback)" : ""} at ${a.paint && a.paint.opacity}, credit '${a.credit}'; when a fresh scan arrived: ${z.via}, fallback ${z.ptFallback}, opacity ${z.paint && z.paint.opacity} (${z.opShown}), legend ${z.legend.ptype ? "precipitation type" : "?"}, credit '${z.credit}'`,
      a.ptFallback && a.via === "iem" && a.paint.opacity === 0.4 && z.via === "ptype" && !z.ptFallback && z.paint.opacity === 0.4 && z.opShown === "40%" && z.legend.ptype && !z.legend.fallback && /^Precipitation type: NOAA MRMS PrecipFlag/.test(z.credit) && !/unavailable/.test(z.credit + z.row + z.note) && !errs.length, { a, z, errs });
    await ctx.close(); }

  /* ---- Reflectivity: IEM publishes a new scan while the page downloads its first one (seen once on 24ccf4e: NOAA fallback after
     a reload); the page must fetch the new scan, not fall back ---- */
  if (!ONLY) { const json = JSON.parse(Buffer.from(download(RD.BASE + ".json")).toString()), t0 = Date.parse(json.meta.start_valid); let n = 0;
    const route = async (p) => p.route(/mrms\/lcref\.json/, (r) => { n++; const j = JSON.parse(JSON.stringify(json)); if (n >= 2) j.meta.start_valid = j.meta.end_valid = new Date(t0 + 120e3).toISOString().replace(".000Z", "Z"); r.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(j) }); });
    const { ctx, p, errs } = await open(b, DESKTOP, { mode: "refl", route }); const s = await read(p), turn = await p.evaluate(() => window.__threats.radarStats && window.__threats.radarStats.turnovers);
    check(`(desktop) Reflectivity, a new IEM scan published mid-download on first load: drawn from ${s.via}, scan turnovers handled ${turn}, error ${s.iemError}`, s.via === "iem" && turn >= 1 && !s.iemError && !errs.length, { s, turn, errs });
    await ctx.close(); }

  /* ---- winter replay at CVG, both modes, desktop, 360 and 390, dark and light ---- */
  const probes = [[-84.6, 38.3, 1], [-84.6, W.edge(-84.6) - 0.25, 10], [-84.6, 40.2, 3], [-86.5, 37.8, 6], [-83.0, 40.5, 3]];
  /* what the replay painted: convective rain 32 dBZ, warm rain 25, cool rain 20, snow 15-25 (checker by pixel) */
  const dbzOf = { 6: 32, 1: 25, 10: 20 }, snowLut = RD.snowPalette(new Uint8Array(256).fill(255)), snowAt = (d) => { const k = Math.round((d + 32) * 2) * 4; return [snowLut[k], snowLut[k + 1], snowLut[k + 2], snowLut[k + 3]]; };
  const want = (c) => c === 3 ? [snowAt(15), snowAt(20), snowAt(25)] : [(({ r, g, b, a }) => [r, g, b, a])(RD.dbzToRgba(dbzOf[c]))];
  const near = (x, y) => x.every((v, k) => Math.abs(v - y[k]) <= 2);
  const replayRoute = async (p) => { await ptRoute(W.pf, new Date(W.scan).toISOString())(p);
    await p.route(/mrms\/lcref\.png/, (r) => r.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: W.lcref.png }));
    await p.route(/mrms\/lcref\.json/, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: W.lcref.json }));
    await p.route(/mrms\/lcref\.wld/, (r) => r.fulfill({ status: 200, headers: { "content-type": "text/plain", "access-control-allow-origin": "*" }, body: W.lcref.wld })); };
  for (const [dev, opt, theme] of [["desktop", DESKTOP, "dark"], ["desktop", DESKTOP, "light"], ["360", PHONES["360"], "dark"], ["390", PHONES["390"], "light"]]) {
    const { ctx, p, errs } = await open(b, opt, { theme, route: replayRoute, query: "&testreplay=radar-winter-rain-to-snow" });
    await p.evaluate(() => window.__threats.map.jumpTo({ center: [-84.7, 39.1], zoom: 6.6 })); await p.waitForTimeout(4000);
    const s = await read(p), got = []; for (const [lon, lat, c] of probes) got.push({ lon, lat, want: c, rgba: await pixel(p, lon, lat) });
    const okPx = got.every((g) => want(g.want).some((w) => near(g.rgba, w)));
    const uk = []; for (const [lon, lat] of [[-86.6, 40.55], [-86.55, 40.5], [-86.45, 40.6], [-86.4, 40.45]]) uk.push((await pixel(p, lon, lat, 9)).join());
    const ukOk = uk.every((c) => [RD.UNKNOWN[0].join(), RD.UNKNOWN[1].join()].includes(c)) && new Set(uk).size === 2;
    /* no coverage: the stripes over the Gulf, in this theme; contrast against the basemap's water at the layer's opacity */
    const nc = []; for (let i = 0; i < 24; i++) nc.push((await pixel(p, -89.5 + i * 0.013, 25.5, 9)).join());
    const stripe = RD.HATCH[theme], water = await p.evaluate(() => { const m = window.__threats.map, l = m.getStyle().layers.find((x) => /water/.test(x.id) && x.type === "fill"); const c = l && m.getPaintProperty(l.id, "fill-color"); return typeof c === "string" ? c : null; });
    const rgbOf = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || "") || null; if (m) return m[1].split(",").slice(0, 3).map(Number); const h = /^#([0-9a-f]{6})$/i.exec(c || ""); return h ? [0, 2, 4].map((k) => parseInt(h[1].slice(k, k + 2), 16)) : null; };
    const wrgb = rgbOf(water), a = stripe[3] / 255 * s.paint.opacity, mix = wrgb && wrgb.map((v, k) => v * (1 - a) + stripe[k] * a);
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = mix ? (Math.max(lum(mix), lum(wrgb)) + 0.05) / (Math.min(lum(mix), lum(wrgb)) + 0.05) : null;
    const near = (c, want) => { const v = c.split(",").map(Number); return v.every((x, k) => Math.abs(x - want[k]) <= 2); }; // PNG round trip: ±1
    const ncOk = nc.some((c) => near(c, stripe)) && nc.some((c) => c === "0,0,0,0");
    await p.screenshot({ path: path.join(OUT, `winter-${dev}-${theme}-ptype.png`) }); if (dev !== "desktop" || theme === "dark") await layersShot(p, `winter-${dev}-${theme}-ptype-layers.png`);
    check(`(${dev}, ${theme}) ${s.badge}: winter replay in precipitation type; probes ${got.map((g) => (g.want === 3 ? "snow" : "rain " + dbzOf[g.want] + " dBZ") + "→" + (want(g.want).some((w) => near(g.rgba, w)) ? "ok" : g.rgba.join())).join(", ")}; rain and snow bars in the legend; lines and warnings above radar`,
      s.badge === "TEST REPLAY" && s.via === "ptype" && okPx && s.legend.ptype && s.legend.rainBar === 14 && s.legend.snowBar === 14 && s.order.linesAbove && s.order.warningsAbove && !errs.length, { got, s, errs });
    check(`(${dev}, ${theme}) unknown code 50: drawn as the dark/light checker (${[...new Set(uk)].join(" | ")}), legend '${s.unknownLegend}'`, ukOk && /Code not in NOAA's table \(50\)/.test(s.unknownLegend || ""), { uk, s: s.legend });
    check(`(${dev}, ${theme}) no-coverage stripes ${stripe.slice(0, 3).join()} over the Gulf; on the basemap water ${water} at ${Math.round(s.paint.opacity * 100)}% the stripe/water contrast is ${ratio && ratio.toFixed(2)}:1`, ncOk && ratio >= 2.5, { nc, water, ratio });
    await pickMode(p, "refl"); await p.evaluate(() => window.__threats.map.jumpTo({ center: [-84.7, 39.1], zoom: 6.6 })); await p.waitForTimeout(3500);
    const r = await read(p), rp = await pixel(p, -84.6, 40.2), want = RD.dbzToRgba(Math.round(((15 + 0) + 32) * 2) * 0.5 - 32); // snow band: 15-25 dBZ
    await p.screenshot({ path: path.join(OUT, `winter-${dev}-${theme}-refl.png`) }); if (dev !== "desktop" || theme === "dark") await layersShot(p, `winter-${dev}-${theme}-refl-layers.png`);
    check(`(${dev}, ${theme}) winter replay in Reflectivity: via ${r.via}, Reflectivity 2026 legend ${r.legend.refl}; snow area drawn ${rp.join()} (a 15-25 dBZ band colour)`, r.via === "iem" && r.legend.refl && rp[3] > 0 && [15, 20].some((v) => { const c = RD.dbzToRgba(v); return Math.abs(c.r - rp[0]) <= 2 && Math.abs(c.g - rp[1]) <= 2 && Math.abs(c.b - rp[2]) <= 2; }) && !errs.length, { r, rp, want, errs });
    await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, "ptype-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results, info }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
