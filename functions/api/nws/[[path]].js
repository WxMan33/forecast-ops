/* Forecast Ops NWS forwarder: a Cloudflare Pages Function (branch preview; not deployed to the shared beta or production).

   Why: the NWS API asks every application to identify itself with a User-Agent, and browsers cannot set one. This
   forwards only the requests Weather Threats needs, adding the repo's identifying User-Agent (as assets/ops-data.js
   does for Node):
     GET /api/nws/alerts/active?event=<Tornado Warning|Severe Thunderstorm Warning|Tornado Watch|Severe Thunderstorm Watch|Flash Flood Warning>[,…]
     GET /api/nws/alerts/<urn:oid:… alert id>         (the earlier message an update replaced, for "What changed")
     GET /api/nws/points/<lat>,<lon>   (NWS's own zones for a venue: forecast zone, county, fire weather zone)
     GET /api/nws/gridpoints/<WFO>/<x>,<y>   (the venue's hourly forecast grid: wind gusts, heat index, rain chance)
     GET /api/nws/zones/county/<XXC###>, /api/nws/zones/forecast/<XXZ###>, /api/nws/zones/fire/<XXZ###>   (county, forecast,
         marine and fire weather zone shapes for zone-based alerts)

   Freshness: active alerts are cached for 30 s, zone shapes for 24 h. Every answer carries X-Upstream-Fetched-At, the
   time NWS actually answered (a cache hit keeps the original time), so the page never treats a cached copy as a new check.
   Failures are never cached and never answered from an old copy: an upstream error, timeout, non-JSON body, an alert list
   without `features`, or a paged (possibly incomplete) list returns 502 with a JSON reason. */

const UPSTREAM = "https://api.weather.gov";
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const EVENTS = new Set(["Tornado Warning", "Severe Thunderstorm Warning", "Tornado Watch", "Severe Thunderstorm Watch", "Flash Flood Warning",
  "Winter Storm Warning", "Winter Storm Watch", "Blizzard Warning", "Ice Storm Warning", "Lake Effect Snow Warning", "Winter Weather Advisory",
  "Red Flag Warning", "Fire Weather Watch",
  "Hurricane Warning", "Hurricane Watch", "Tropical Storm Warning", "Tropical Storm Watch", "Storm Surge Warning", "Storm Surge Watch",
  "Coastal Flood Warning", "Coastal Flood Watch", "Coastal Flood Advisory", "High Surf Warning", "High Surf Advisory", "Rip Current Statement", "Beach Hazards Statement"]);
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_S = { alerts: 30, alert: 3600, zone: 86400, point: 86400, grid: 900 };
const memory = new Map(); // per-isolate cache; the Cache API is used too where the platform provides it

function route(url) {
  const p = url.pathname.replace(/^\/api\/nws/, "");
  if (p === "/alerts/active") {
    const ev = (url.searchParams.get("event") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ev.length || ev.some((e) => !EVENTS.has(e)) || [...url.searchParams.keys()].some((k) => k !== "event")) return null;
    return { kind: "alerts", path: "/alerts/active?event=" + [...new Set(ev)].sort().map(encodeURIComponent).join(",") };
  }
  let m = /^\/alerts\/(urn:oid:[0-9a-zA-Z.]+)$/.exec(decodeURIComponent(p));
  if (m) return { kind: "alert", path: "/alerts/" + m[1] };
  m = /^\/points\/(-?\d{1,2}\.\d{1,4}),(-?\d{1,3}\.\d{1,4})$/.exec(p);
  if (m && [...url.searchParams.keys()].length === 0) return { kind: "point", path: "/points/" + m[1] + "," + m[2] };
  m = /^\/gridpoints\/([A-Z]{3})\/(\d{1,3}),(\d{1,3})$/.exec(p);
  if (m && [...url.searchParams.keys()].length === 0) return { kind: "grid", path: "/gridpoints/" + m[1] + "/" + m[2] + "," + m[3] };
  m = /^\/zones\/(county|forecast|fire)\/([A-Z]{2}[CZ]\d{3})$/.exec(p);
  if (m && (m[1] === "county") === (m[2][2] === "C")) return { kind: "zone", path: "/zones/" + m[1] + "/" + m[2] };
  return null;
}
function check(kind, j) {
  if (!j || typeof j !== "object") return "not a JSON object";
  if (kind === "alerts") { if (!Array.isArray(j.features)) return "alert list without features"; if (j.pagination && j.pagination.next) return "alert list is paged; it may be incomplete"; }
  if (kind === "alert" && !(j.properties && j.properties.id)) return "alert without properties";
  if (kind === "zone" && !(j.geometry && j.geometry.type)) return "zone without a shape";
  if (kind === "point" && !(j.properties && j.properties.forecastZone)) return "point without a forecast zone";
  if (kind === "grid" && !(j.properties && j.properties.updateTime && j.properties.windGust)) return "forecast grid without its update time or wind gusts";
  return null;
}
function cors(request) {
  const o = request.headers.get("Origin");
  return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" };
}
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent, X-Cache-Max-Age";

export async function handle(request, env = {}, waitUntil = () => {}) {
  // test hooks (upstream, clock, timeout) are honoured only from the local harness, which passes a boolean Pages cannot set
  const t = env.__harness === true ? env : {};
  const url = new URL(request.url), now = t.NOW ? t.NOW() : Date.now(), base = t.UPSTREAM || UPSTREAM;
  const head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const r = route(url);
  if (!r) return json(404, { error: "not a Weather Threats NWS request" }, head);
  const key = base + r.path, ttl = TTL_S[r.kind] * 1000;

  // fresh cached copy: answered with its original upstream time
  let hit = memory.get(key);
  if (!hit && typeof caches !== "undefined" && caches.default) {
    try { const c = await caches.default.match(new Request("https://cache.forecast-ops/" + encodeURIComponent(key))); if (c) hit = { body: await c.text(), at: +c.headers.get("X-At") }; } catch (e) { /* no cache here */ }
  }
  if (hit && now - hit.at < ttl) return send(hit.body, hit.at, "HIT", ttl, head);

  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000);
  let res, body;
  try {
    res = await fetch(key, { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" }, signal: ctl.signal });
    body = await res.text();
  } catch (e) {
    return json(502, { error: ctl.signal.aborted ? "NWS did not answer in time" : "NWS request failed", upstream: r.path }, head);
  } finally { clearTimeout(timer); }
  if (!res.ok) return json(502, { error: "NWS answered HTTP " + res.status, upstream: r.path }, { ...head, "X-Upstream-Status": String(res.status) });
  let parsed; try { parsed = JSON.parse(body); } catch (e) { return json(502, { error: "NWS answer was not JSON", upstream: r.path }, head); }
  const bad = check(r.kind, parsed);
  if (bad) return json(502, { error: bad, upstream: r.path }, head);

  const at = t.NOW ? t.NOW() : Date.now();
  memory.set(key, { body, at }); if (memory.size > 500) memory.delete(memory.keys().next().value);
  if (typeof caches !== "undefined" && caches.default) {
    try { waitUntil(caches.default.put(new Request("https://cache.forecast-ops/" + encodeURIComponent(key)), new Response(body, { headers: { "X-At": String(at), "Cache-Control": "max-age=" + TTL_S[r.kind] } }))); } catch (e) { /* no cache here */ }
  }
  return send(body, at, "MISS", ttl, { ...head, "X-Upstream-Status": String(res.status) });
}
function send(body, at, cache, ttl, head) {
  return new Response(body, { status: 200, headers: { ...head, "Content-Type": "application/geo+json", "X-Upstream-Fetched-At": new Date(at).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Cache-Max-Age": String(ttl / 1000), "X-Upstream-User-Agent": USER_AGENT } });
}
function json(status, obj, head) { return new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } }); }

export async function onRequest(context) { return handle(context.request, context.env || {}, (p) => context.waitUntil(p)); }
