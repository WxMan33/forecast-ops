/* State and county lines over heavy radar echoes, and warnings above radar, at CVG (TEST REPLAY), desktop and phone, dark and light.
   CVG had only light rain when this was written, so the check replays IEM's real current scan with a block of heavy echoes laid
   over the Ohio, Kentucky and Indiana state lines around CVG: stripes of 30, 35, 40, 45, 50, 55, 60, 65 and 70 dBZ, wide
   enough to cover county lines too. The page is marked TEST REPLAY. It records the layer order (boundaries and warnings above
   radar), the radar opacity, and screenshots at regional (z7.5) and county (z9) zoom for judging line readability.
   Usage: node tools/threats-radar-boundary-check.js https://<host> [outDir] */
"use strict";
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const RD = require("../assets/threats-radar.js");
const HOST = (process.argv[2] || "").replace(/\/$/, ""), OUT = path.resolve(process.argv[3] || "docs/threats/radar-boundary-check");
if (!HOST) { console.error("usage: node tools/threats-radar-boundary-check.js https://host [outDir]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const results = []; let fails = 0;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + JSON.stringify(detail).slice(0, 700))); };
const passNotice = async (p) => { if (/External Content Notice/.test(await p.title().catch(() => ""))) { await p.getByText("Open the page", { exact: false }).first().click(); await p.waitForLoadState("domcontentloaded"); } };
const CVG = [-84.6723, 39.0446];

/* the real scan with heavy stripes painted around CVG (lon -86.2..-83.2, lat 37.9..40.3), re-encoded as the same indexed PNG */
async function heavyScan() {
  const get = async (ext) => { const r = await fetch(RD.BASE + "." + ext); if (!r.ok) throw Error(ext + " " + r.status); return r; };
  const json = await (await get("json")).text(), wld = await (await get("wld")).text(), png = new Uint8Array(await (await get("png")).arrayBuffer());
  const g = await RD.decodeIndexedPng(png, async (z) => new Uint8Array(zlib.inflateSync(Buffer.from(z)))), w = RD.parseWorldFile(wld);
  const col = (lon) => Math.round((lon - w.firstLon) / w.dx), row = (lat) => Math.round((lat - w.firstLat) / w.dy), bands = [30, 35, 40, 45, 50, 55, 60, 65, 70];
  for (let y = row(40.3); y <= row(37.9); y++) for (let x = col(-86.2); x <= col(-83.2); x++) { const k = Math.floor((x - col(-86.2)) / 33) % bands.length; g.indices[y * g.width + x] = (bands[k] + 32) * 2; } // 0.33 degree stripes
  /* re-encode: the original chunks, with new pixel data (filter 0 rows) */
  const keep = [], dv = new DataView(png.buffer, png.byteOffset, png.byteLength); let idatAt = -1;
  for (let o = 8; o + 12 <= png.length;) { const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8)); if (type === "IDAT") { if (idatAt < 0) idatAt = keep.length; } else if (type !== "IEND") keep.push(Buffer.from(png.subarray(o, o + len + 12))); o += len + 12; }
  const raw = Buffer.alloc((g.width + 1) * g.height); for (let y = 0; y < g.height; y++) Buffer.from(g.indices.buffer, y * g.width, g.width).copy(raw, y * (g.width + 1) + 1);
  const crcT = []; for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[k] = c >>> 0; }
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); let x = 0xffffffff; for (const b of Buffer.concat([t, data])) x = crcT[(x ^ b) & 255] ^ (x >>> 8); c.writeUInt32BE((x ^ 0xffffffff) >>> 0); return Buffer.concat([len, t, data, c]); };
  keep.splice(idatAt, 0, chunk("IDAT", zlib.deflateSync(raw, { level: 6 })));
  return { json, wld, png: Buffer.concat([Buffer.from(png.subarray(0, 8)), ...keep, chunk("IEND", Buffer.alloc(0))]) };
}

(async () => {
  const scan = await heavyScan(), b = await chromium.launch();
  console.log(`replaying scan ${JSON.parse(scan.json).meta.start_valid} with heavy stripes at CVG (${(scan.png.length / 1048576).toFixed(2)} MB)`);
  for (const [dev, opt] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { ...devices["iPhone 13"] }]]) for (const theme of ["dark", "light"]) {
    const ctx = await b.newContext(opt), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript((th) => { try { localStorage.setItem("ops_theme", JSON.stringify(th)); localStorage.setItem("tx_radar_mode", "refl"); } catch (e) {} }, theme);
    await p.route(/mrms\/lcref\.png/, (r) => r.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: scan.png }));
    await p.route(/mrms\/lcref\.json/, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: scan.json }));
    await p.route(/mrms\/lcref\.wld/, (r) => r.fulfill({ status: 200, headers: { "content-type": "text/plain", "access-control-allow-origin": "*" }, body: scan.wld }));
    await p.goto(HOST + "/threats.html?lat=39.0446&lon=-84.6723&name=CVG&radar=1&view=active&scope=venue&testreplay=radar-heavy-echoes", { waitUntil: "domcontentloaded", timeout: 60000 }); await passNotice(p);
    await p.waitForFunction(() => window.__threats && window.__threats.radar && window.__threats.radar.via === "iem" && window.__threats.radar.state === "ok", null, { timeout: 120000 }).catch(() => {});
    const s = await p.evaluate(() => { const T = window.__threats, m = T.map, ids = m.getStyle().layers.map((l) => l.id), ri = ids.indexOf("radar"), act = m.getStyle().layers.filter((l) => l.source === "active").map((l) => l.id);
      const st = ids.includes("hu-state") ? "hu-state" : "states";
      return { ri, state: ids.indexOf(st), county: ids.indexOf("cnty-lines"), warningsAbove: act.length > 0 && act.every((id) => ids.indexOf(id) > ri), opacity: m.getPaintProperty("radar", "raster-opacity"), theme: document.documentElement.dataset.theme, badge: document.getElementById("txBadge").textContent }; });
    for (const z of [7.5, 9]) { await p.evaluate(([c, z]) => window.__threats.map.jumpTo({ center: c, zoom: z }), [CVG, z]); await p.waitForTimeout(4000);
      await p.screenshot({ path: path.join(OUT, `heavy-${dev}-${theme}-z${z}.png`) }); }
    check(`(${dev}, ${theme}) ${s.badge}: radar ${s.opacity * 100}%; state lines (layer ${s.state}) and county lines (layer ${s.county}) above radar (layer ${s.ri}); warnings above radar`, s.theme === theme && s.badge === "TEST REPLAY" && s.ri >= 0 && s.state > s.ri && s.county > s.ri && s.warningsAbove && !errs.length, { s, errs });
    await ctx.close(); }
  await b.close();
  fs.writeFileSync(path.join(OUT, "radar-boundary-check.json"), JSON.stringify({ host: HOST, at: new Date().toISOString(), results }, null, 1));
  console.log(`${results.length - fails} of ${results.length} passed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
