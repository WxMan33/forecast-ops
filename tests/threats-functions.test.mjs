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
console.log(n + " passed");
