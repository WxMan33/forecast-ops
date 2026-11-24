/* The Pages Functions (functions/api/nws, functions/api/wpc) with a mocked upstream: allowed routes only, identifying
   User-Agent, cache hits keep the original upstream time, failures are 502 and never cached.
   Run: node tests/threats-functions.test.mjs */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nws = await import(pathToFileURL(path.join(ROOT, "functions/api/nws/[[path]].js")).href);
const wpc = await import(pathToFileURL(path.join(ROOT, "functions/api/wpc/[[path]].js")).href);
const smoke = await import(pathToFileURL(path.join(ROOT, "functions/api/smoke/[[path]].js")).href);
const awc = await import(pathToFileURL(path.join(ROOT, "functions/api/awc/[[path]].js")).href);
const faa = await import(pathToFileURL(path.join(ROOT, "functions/api/faa/[[path]].js")).href);
const ifif = await import(pathToFileURL(path.join(ROOT, "functions/api/ifi/[[path]].js")).href);
const gtgf = await import(pathToFileURL(path.join(ROOT, "functions/api/gtg/[[path]].js")).href);
const spcf = await import(pathToFileURL(path.join(ROOT, "functions/api/spc/[[path]].js")).href);
import fs from "node:fs";
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log("ok -", name); };
let clock = Date.parse("2026-11-20T20:00:00Z"), answer = () => new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), { status: 200 }); const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), ua: new Headers(init.headers).get("user-agent") }); return answer(String(url)); };
const env = { __harness: true, NOW: () => clock, UPSTREAM: "https://upstream.test", TIMEOUT_MS: 500 };
const get = (h, p, origin = "https://claude-threats-planner-flood.forecast-ops-beta.pages.dev") => h.handle(new Request("https://x.test" + p, { headers: { Origin: origin } }), env);

await ok("NWS: Flash Flood Warning, winter and fire weather alerts and fire weather zones are allowed; other events and paths are not forwarded", async () => {
  assert.strictEqual((await get(nws, "/api/nws/alerts/active?event=Flash%20Flood%20Warning")).status, 200);
  assert.strictEqual((await get(nws, "/api/nws/alerts/active?event=Flood%20Warning")).status, 404);
  assert.strictEqual((await get(nws, "/api/nws/alerts/active?event=Flash%20Flood%20Warning&area=FL")).status, 404);
  assert.strictEqual((await get(nws, "/api/nws/points/29,-81")).status, 404);
  for (const ev of ["Winter Storm Warning", "Winter Storm Watch", "Blizzard Warning", "Ice Storm Warning", "Lake Effect Snow Warning", "Winter Weather Advisory"]) assert.strictEqual((await get(nws, "/api/nws/alerts/active?event=" + encodeURIComponent(ev))).status, 200, ev);
  assert.strictEqual((await get(nws, "/api/nws/alerts/active?event=Wind%20Chill%20Advisory")).status, 404);
  for (const ev of ["Hurricane Warning", "Storm Surge Watch", "Coastal Flood Advisory", "Rip Current Statement", "Beach Hazards Statement", "High Surf Warning"]) assert.strictEqual((await get(nws, "/api/nws/alerts/active?event=" + encodeURIComponent(ev))).status, 200, ev);
  for (const ev of ["Red Flag Warning", "Fire Weather Watch"]) assert.strictEqual((await get(nws, "/api/nws/alerts/active?event=" + encodeURIComponent(ev))).status, 200, ev);
  answer = () => new Response(JSON.stringify({ type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: {} }));
  assert.strictEqual((await get(nws, "/api/nws/zones/fire/COZ238")).status, 200); assert.strictEqual((await get(nws, "/api/nws/zones/fire/COC038")).status, 404);
  answer = () => new Response(JSON.stringify({ properties: { forecastZone: "https://api.weather.gov/zones/forecast/AMZ454" } }));
  assert.strictEqual((await get(nws, "/api/nws/points/29.4802,-81.1065")).status, 200);
  for (const bad of ["/api/nws/points/29.48021,-81.1", "/api/nws/points/abc,1", "/api/nws/points/29.4,-81.1?x=1"]) assert.strictEqual((await get(nws, bad)).status, 404, bad);
  // the venue's forecast grid: one office and cell, no query; a grid without wind gusts is refused
  answer = () => new Response(JSON.stringify({ properties: { updateTime: "2026-11-23T20:00:00+00:00", windGust: { uom: "wmoUnit:km_h-1", values: [] } } }));
  assert.strictEqual((await get(nws, "/api/nws/gridpoints/ILN/30,40")).status, 200);
  for (const bad of ["/api/nws/gridpoints/ILN/30,40/forecast", "/api/nws/gridpoints/iln/30,40", "/api/nws/gridpoints/ILN/30,40?units=si", "/api/nws/gridpoints/ILNX/1,2"]) assert.strictEqual((await get(nws, bad)).status, 404, bad);
  answer = () => new Response(JSON.stringify({ properties: { updateTime: "2026-11-23T20:00:00+00:00" } }));
  assert.strictEqual((await get(nws, "/api/nws/gridpoints/ILN/31,40")).status, 502);
  answer = () => new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), { status: 200 });
  assert.ok(sent.every((s) => s.ua === "(forecast-ops, github.com/WxMan33/forecast-ops)"));
});
await ok("WPC: only day 1–5 ERO files; identifying User-Agent; CORS for the preview origin only", async () => {
  sent.length = 0;
  const r = await get(wpc, "/api/wpc/ero/day1");
  assert.strictEqual(r.status, 200); assert.strictEqual(sent[0].url, "https://upstream.test/exper/eromap/geojson/Day1_Latest.geojson");
  assert.strictEqual(sent[0].ua, "(forecast-ops, github.com/WxMan33/forecast-ops)");
  assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), "https://claude-threats-planner-flood.forecast-ops-beta.pages.dev");
  assert.strictEqual((await get(wpc, "/api/wpc/ero/day1", "https://evil.example")).headers.get("Access-Control-Allow-Origin"), null);
  for (const bad of ["/api/wpc/ero/day6", "/api/wpc/ero/day1?x=1", "/api/wpc/qpf/day1"]) assert.strictEqual((await get(wpc, bad)).status, 404, bad);
});
await ok("WPC: a cache hit keeps the original upstream time; after 5 minutes the next answer is fresh", async () => {
  clock = Date.parse("2026-11-20T21:00:00Z"); sent.length = 0;
  const a = await get(wpc, "/api/wpc/ero/day2"); clock += 60e3;
  const b = await get(wpc, "/api/wpc/ero/day2"); clock += 300e3;
  const c = await get(wpc, "/api/wpc/ero/day2");
  assert.deepStrictEqual([a, b, c].map((r) => r.headers.get("X-Forecast-Ops-Cache")), ["MISS", "HIT", "MISS"]);
  assert.strictEqual(b.headers.get("X-Upstream-Fetched-At"), a.headers.get("X-Upstream-Fetched-At"));
  assert.ok(Date.parse(c.headers.get("X-Upstream-Fetched-At")) > Date.parse(a.headers.get("X-Upstream-Fetched-At")));
  assert.strictEqual(sent.length, 2);
});
await ok("WPC and NWS: errors, non-JSON and missing features are 502 and never cached", async () => {
  clock = Date.parse("2026-11-20T22:00:00Z");
  for (const [mk, why] of [[() => new Response("busy", { status: 503 }), "HTTP 503"], [() => new Response("<html>"), "not JSON"], [() => new Response("{}"), "without features"]]) {
    answer = mk; const r = await get(wpc, "/api/wpc/ero/day3"); assert.strictEqual(r.status, 502); assert.match(await r.text(), new RegExp(why));
    const r2 = await get(nws, "/api/nws/alerts/active?event=Flash%20Flood%20Warning"); clock += 31e3;
    assert.strictEqual(r2.status, 502, "nws " + why);
  }
  answer = () => new Response(JSON.stringify({ type: "FeatureCollection", features: [] }));
  assert.strictEqual((await get(wpc, "/api/wpc/ero/day3")).headers.get("X-Forecast-Ops-Cache"), "MISS"); // the failures were not cached
});
await ok("test hooks are ignored without the harness flag", async () => {
  sent.length = 0;
  await wpc.handle(new Request("https://x.test/api/wpc/ero/day4"), { UPSTREAM: "https://evil.example", NOW: () => 0 });
  assert.strictEqual(sent[0].url, "https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day4_Latest.geojson");
});
await ok("SMOKE: HMS KML for recent UTC days only; AirNow reporting area rows for one area; identifying User-Agent; bad bodies are 502 and not cached", async () => {
  clock = Date.parse("2026-11-21T03:00:00Z"); sent.length = 0;
  const env2 = { ...env, UPSTREAM_HMS: "https://hms.test", UPSTREAM_AIRNOW: "https://airnow.test" }, g = (p) => smoke.handle(new Request("https://x.test" + p, { headers: { Origin: "https://claude-threats-planner-flood.forecast-ops-beta.pages.dev" } }), env2);
  answer = (u) => /hms/.test(u) ? new Response("<?xml version='1.0'?><kml><Document></Document></kml>", { headers: { "Last-Modified": "Sat, 21 Nov 2026 01:12:22 GMT" } }) : new Response("11/20/26|11/21/26||CST|0|F|Y|Chicago|IL|41.8|-87.6|PM2.5||Good|No||Illinois EPA\n11/20/26|11/21/26||EST|0|F|Y|Albany|NY|42.6|-73.7|PM2.5||Good|No||NYSDEC\n");
  const h = await g("/api/smoke/hms/20261120");
  assert.strictEqual(h.status, 200); assert.strictEqual(sent[0].url, "https://hms.test/pub/FIRE/web/HMS/Smoke_Polygons/KML/2026/11/hms_smoke20261120.kml"); assert.strictEqual(sent[0].ua, "(forecast-ops, github.com/WxMan33/forecast-ops)");
  assert.strictEqual(h.headers.get("X-Upstream-Last-Modified"), "Sat, 21 Nov 2026 01:12:22 GMT");
  assert.strictEqual((await g("/api/smoke/hms/20261101")).status, 404);
  const a = await g("/api/smoke/airnow-area?area=Chicago&state=IL"); assert.strictEqual(a.status, 200); assert.strictEqual((await a.text()).trim().split("\n").length, 1);
  for (const bad of ["/api/smoke/airnow-area?area=Chicago", "/api/smoke/airnow-area?area=%3Cx%3E&state=IL", "/api/smoke/other"]) assert.strictEqual((await g(bad)).status, 404, bad);
  clock += 700e3; answer = () => new Response("<html>busy</html>");
  assert.strictEqual((await g("/api/smoke/hms/20261121")).status, 502);
  answer = () => new Response("nope", { status: 404 }); assert.strictEqual((await g("/api/smoke/hms/20261121")).status, 404);
});
await ok("AVIATION: METAR/TAF for 1-4 ICAO ids only; identifying User-Agent; cache keeps the upstream time; non-list answers are 502", async () => {
  clock = Date.parse("2026-11-22T16:00:00Z"); sent.length = 0; answer = () => new Response("[]");
  const e2 = { ...env, UPSTREAM: "https://awc.test/" }, g = (p) => awc.handle(new Request("https://x.test" + p, { headers: { Origin: "https://claude-threats-planner-flood.forecast-ops-beta.pages.dev" } }), e2);
  const a = await g("/api/awc/taf?ids=kord,KMDW"); assert.strictEqual(a.status, 200); assert.strictEqual(sent[0].url, "https://awc.test/taf?ids=KMDW,KORD&format=json"); assert.strictEqual(sent[0].ua, "(forecast-ops, github.com/WxMan33/forecast-ops)");
  clock += 60e3; const b2 = await g("/api/awc/taf?ids=KMDW,KORD"); assert.strictEqual(b2.headers.get("X-Forecast-Ops-Cache"), "HIT"); assert.strictEqual(b2.headers.get("X-Upstream-Fetched-At"), a.headers.get("X-Upstream-Fetched-At"));
  for (const bad of ["/api/awc/metar", "/api/awc/metar?ids=K1,K2,K3,K4,K5", "/api/awc/metar?ids=KORD&format=xml", "/api/awc/pirep?ids=KORD", "/api/awc/metar?ids=KO%20RD"]) assert.strictEqual((await g(bad)).status, 404, bad);
  answer = () => new Response("{\"error\":1}"); assert.strictEqual((await g("/api/awc/metar?ids=KJFK")).status, 502);
});
await ok("AVIATION en route: pilot reports (bbox and age 1-3 h), SIGMETs, G-AIRMET forecast hours 0-12 and CWAs only; AWC's 204 becomes an empty list", async () => {
  clock = Date.parse("2026-11-22T21:00:00Z"); sent.length = 0; answer = () => new Response("[]");
  const e2 = { ...env, UPSTREAM: "https://awc.test/" }, g = (p) => awc.handle(new Request("https://x.test" + p, { headers: { Origin: "https://claude-threats-em-combined.forecast-ops-beta.pages.dev" } }), e2);
  const a = await g("/api/awc/pirep?bbox=24,-126,50,-66&age=3"); assert.strictEqual(a.status, 200); assert.strictEqual(sent[0].url, "https://awc.test/pirep?format=json&age=3&bbox=24,-126,50,-66");
  assert.strictEqual(a.headers.get("Access-Control-Allow-Origin"), "https://claude-threats-em-combined.forecast-ops-beta.pages.dev");
  for (const f of ["0", "3", "6", "9", "12"]) assert.strictEqual((await g("/api/awc/gairmet?fore=" + f)).status, 200, f);
  assert.strictEqual((await g("/api/awc/airsigmet")).status, 200);
  answer = () => new Response(null, { status: 204 }); const c = await g("/api/awc/cwa"); assert.strictEqual(c.status, 200); assert.strictEqual(await c.text(), "[]");
  for (const bad of ["/api/awc/pirep", "/api/awc/pirep?bbox=24,-126,50&age=2", "/api/awc/pirep?bbox=50,-126,24,-66&age=2", "/api/awc/pirep?bbox=24,-126,50,-66&age=12", "/api/awc/pirep?bbox=24,-126,50,-66&id=KORD", "/api/awc/gairmet?fore=4", "/api/awc/airsigmet?hazard=turb", "/api/awc/cwa?date=20261120_2000", "/api/awc/isigmet"]) assert.strictEqual((await g(bad)).status, 404, bad);
});
await ok("FAA: airport events (a list) and the operations plan (an object) only; identifying User-Agent; cache keeps the FAA's time; wrong shapes are 502", async () => {
  clock = Date.parse("2026-11-22T21:00:00Z"); sent.length = 0; answer = (u) => new Response(/operations-plan/.test(u) ? "{\"terminalPlanned\":[]}" : "[]");
  const e2 = { ...env, UPSTREAM: "https://faa.test/" }, g = (p) => faa.handle(new Request("https://x.test" + p, { headers: { Origin: "https://claude-threats-em-combined.forecast-ops-beta.pages.dev" } }), e2);
  const a = await g("/api/faa/airport-events"); assert.strictEqual(a.status, 200); assert.strictEqual(sent[0].url, "https://faa.test/airport-events"); assert.strictEqual(sent[0].ua, "(forecast-ops, github.com/WxMan33/forecast-ops)");
  clock += 30e3; const b = await g("/api/faa/airport-events"); assert.strictEqual(b.headers.get("X-Forecast-Ops-Cache"), "HIT"); assert.strictEqual(b.headers.get("X-Upstream-Fetched-At"), a.headers.get("X-Upstream-Fetched-At"));
  assert.strictEqual((await g("/api/faa/operations-plan")).status, 200);
  for (const bad of ["/api/faa/airport-status-information", "/api/faa/airport-events?airport=EWR", "/api/faa/"]) assert.strictEqual((await g(bad)).status, 404, bad);
  clock += 120e3; answer = () => new Response("{}"); assert.strictEqual((await g("/api/faa/airport-events")).status, 502);
  answer = () => new Response("down", { status: 503 }); assert.strictEqual((await g("/api/faa/operations-plan?x=1")).status, 404); clock += 120e3; assert.strictEqual((await g("/api/faa/operations-plan")).status, 502);
});
await ok("GTG: the latest complete cycle from the NOMADS listing; one EDPARM record by byte range, whole and checked; other heights, hours, old cycles and paths refused", async () => {
  clock = Date.parse("2026-11-22T23:20:00Z"); sent.length = 0;
  const rec = fs.readFileSync(path.join(ROOT, "tests/fixtures/threats/gtg-edparm-10668m-2026112222-f000.grib2")), pad = 1000, file = Buffer.concat([Buffer.alloc(pad), rec, Buffer.from("GRIBxxxx")]);
  const listing = Array.from({ length: 19 }, (_, f) => `<a href="dafs.t21z.gtg.3km.conus.f${String(f).padStart(3, "0")}.grib2">x</a> 22-Nov-2026 22:27  164M \n<a href="dafs.t21z.gtg.3km.conus.f${String(f).padStart(3, "0")}.grib2.idx">x</a>\n`).join("") + '<a href="dafs.t22z.gtg.3km.conus.f000.grib2">x</a> 22-Nov-2026 22:53  145M \n';
  const idx = `36:0:d=2026112221:EDPARM:10363 m above mean sea level:anl:\n37:${pad}:d=2026112221:EDPARM:10668 m above mean sea level:anl:\n38:${pad + rec.length}:d=2026112221:EDPARM:10972 m above mean sea level:anl:\n`;
  answer = (u) => /dafs\.20261122\/$/.test(u) ? new Response(listing) : /\.idx$/.test(u) ? new Response(idx) : /\/$/.test(u) ? new Response("", { status: 404 }) : null;
  globalThis.fetch = async (url, init) => { const u = String(url), h = new Headers(init.headers); sent.push({ url: u, ua: h.get("user-agent"), range: h.get("range") });
    const a = answer(u); if (a) return a; const [x, y] = h.get("range").slice(6).split("-").map(Number); return new Response(file.subarray(x, y + 1), { status: 206, headers: { "Content-Range": `bytes ${x}-${y}/${file.length}` } }); };
  const e2 = { ...env, UPSTREAM: "https://nomads.test/" }, g = (p) => gtgf.handle(new Request("https://x.test" + p, { headers: { Origin: "https://claude-threats-em-combined.forecast-ops-beta.pages.dev" } }), e2);
  const l = await g("/api/gtg/latest"); assert.strictEqual(l.status, 200); const lj = await l.json(); assert.strictEqual(lj.cycle, "2026112221"); assert.strictEqual(lj.hours.length, 19); assert.strictEqual(lj.newest, "2026112222");
  const r = await g("/api/gtg/record?cycle=2026112221&fh=0&m=10668"); assert.strictEqual(r.status, 200); assert(Buffer.from(await r.arrayBuffer()).equals(rec)); assert.strictEqual(sent.at(-1).range, `bytes=${pad}-${pad + rec.length - 1}`); assert.strictEqual(sent.at(-1).ua, "(forecast-ops, github.com/WxMan33/forecast-ops)");
  assert.strictEqual(r.headers.get("X-GTG-File-Bytes"), String(file.length)); assert(/EDPARM:10668 m above mean sea level/.test(r.headers.get("X-GTG-Record")));
  for (const bad of ["/api/gtg/record?cycle=2026112221&fh=19&m=10668", "/api/gtg/record?cycle=2026112221&fh=0&m=10000", "/api/gtg/record?cycle=2026111021&fh=0&m=10668", "/api/gtg/record?cycle=2026112221&fh=0", "/api/gtg/latest?x=1", "/api/gtg/file"]) assert.strictEqual((await g(bad)).status, 404, bad);
  assert.strictEqual((await g("/api/gtg/record?cycle=2026112221&fh=1&m=10972")).status, 502, "a range that is not one whole record");
});
await ok("IFI: the latest cycle with hours 1-18; probability and severity records by byte range (the file's last record too); other fields, heights and hours refused", async () => {
  clock = Date.parse("2026-11-23T03:20:00Z"); sent.length = 0;
  const p = fs.readFileSync(path.join(ROOT, "tests/fixtures/threats/ifi/ifi-2026112301-f003-prob-5000ft.grib2")), v = fs.readFileSync(path.join(ROOT, "tests/fixtures/threats/ifi/ifi-2026112301-f003-sev-5000ft.grib2")), pad = 500, file = Buffer.concat([Buffer.alloc(pad), p, v]);
  const listing = Array.from({ length: 18 }, (_, k) => `<a href="dafs.t01z.ifi.3km.conus.f${String(k + 1).padStart(3, "0")}.grib2">x</a> 23-Nov-2026 01:58  33M \n<a href="dafs.t01z.ifi.3km.conus.f${String(k + 1).padStart(3, "0")}.grib2.idx">x</a>\n`).join("");
  const idx = `9:0:d=2026112301:ICPRB:1219.2 m above mean sea level:3 hour fcst:\n10:${pad}:d=2026112301:ICPRB:1524 m above mean sea level:3 hour fcst:\n130:${pad + p.length}:d=2026112301:var discipline=0 master_table=2 parmcat=19 parm=37:1524 m above mean sea level:3 hour fcst:\n`;
  globalThis.fetch = async (url, init) => { const u = String(url), h = new Headers(init.headers); sent.push({ url: u, ua: h.get("user-agent"), range: h.get("range") });
    if (/dafs\.20261123\/$/.test(u)) return new Response(listing); if (/\/$/.test(u)) return new Response("", { status: 404 }); if (/\.idx$/.test(u)) return new Response(idx);
    const [a, b0] = h.get("range").slice(6).split("-"), b = b0 === "" ? file.length - 1 : +b0; return new Response(file.subarray(+a, b + 1), { status: 206, headers: { "Content-Range": `bytes ${a}-${b}/${file.length}` } }); };
  const e2 = { ...env, UPSTREAM: "https://nomads.test/" }, g = (q) => ifif.handle(new Request("https://x.test" + q), e2);
  const l = await (await g("/api/ifi/latest")).json(); assert.strictEqual(l.cycle, "2026112301"); assert.deepStrictEqual(l.hours, Array.from({ length: 18 }, (_, k) => k + 1));
  const rp = await g("/api/ifi/record?cycle=2026112301&fh=3&ft=5000&field=prob"); assert.strictEqual(rp.status, 200); assert(Buffer.from(await rp.arrayBuffer()).equals(p)); assert.strictEqual(sent.at(-1).range, `bytes=${pad}-${pad + p.length - 1}`);
  const rs = await g("/api/ifi/record?cycle=2026112301&fh=3&ft=5000&field=sev"); assert.strictEqual(rs.status, 200); assert(Buffer.from(await rs.arrayBuffer()).equals(v)); assert.strictEqual(sent.at(-1).range, `bytes=${pad + p.length}-`, "the last record: read to the end, checked by its GRIB length");
  for (const bad of ["/api/ifi/record?cycle=2026112301&fh=0&ft=5000&field=prob", "/api/ifi/record?cycle=2026112301&fh=3&ft=5250&field=prob", "/api/ifi/record?cycle=2026112301&fh=3&ft=31000&field=prob", "/api/ifi/record?cycle=2026112301&fh=3&ft=5000&field=sld", "/api/ifi/record?cycle=2026112301&fh=3&ft=5000&field=toString", "/api/ifi/latest?x=1"]) assert.strictEqual((await g(bad)).status, 404, bad);
});
await ok("SPC: only today's and yesterday's filtered storm reports; identifying User-Agent; 2-minute cache keeps the upstream time; a non-CSV answer is 502 and not cached", async () => {
  sent.length = 0; const csv = "Time,F_Scale,Location,County,State,Lat,Lon,Comments\nTime,Speed,Location,County,State,Lat,Lon,Comments\nTime,Size,Location,County,State,Lat,Lon,Comments\n";
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), ua: new Headers(init.headers).get("user-agent") }); return answer(String(url)); }; // earlier tests replaced the mock
  answer = () => new Response(csv, { status: 200 });
  const r1 = await get(spcf, "/api/spc/reports/today"); assert.strictEqual(r1.status, 200); assert.strictEqual(await r1.text(), csv); assert.strictEqual(sent.at(-1).url, "https://upstream.test/climo/reports/today_filtered.csv");
  assert.strictEqual(sent.at(-1).ua, "(forecast-ops, github.com/WxMan33/forecast-ops)"); const at = r1.headers.get("X-Upstream-Fetched-At");
  clock += 60e3; const r2 = await get(spcf, "/api/spc/reports/today"); assert.strictEqual(r2.headers.get("X-Forecast-Ops-Cache"), "HIT"); assert.strictEqual(r2.headers.get("X-Upstream-Fetched-At"), at); assert.strictEqual(sent.length, 1);
  assert.ok(/forecast-ops-beta\.pages\.dev/.test(r1.headers.get("Access-Control-Allow-Origin") || ""));
  for (const bad of ["/api/spc/reports/261112_rpts", "/api/spc/reports/today?x=1", "/api/spc/products/md/", "/api/spc/reports/today.csv"]) assert.strictEqual((await get(spcf, bad)).status, 404, bad);
  answer = () => new Response("<html>Forbidden</html>", { status: 200 }); const r3 = await get(spcf, "/api/spc/reports/yesterday"); assert.strictEqual(r3.status, 502);
  answer = () => new Response(csv, { status: 200 }); const r4 = await get(spcf, "/api/spc/reports/yesterday"); assert.strictEqual(r4.status, 200); // the failure was not cached
  answer = () => new Response("x", { status: 503 }); clock += 300e3; const r5 = await get(spcf, "/api/spc/reports/today"); assert.strictEqual(r5.status, 502);
});
console.log(n + " passed");
