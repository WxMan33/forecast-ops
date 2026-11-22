/* Forecast Ops aviation forwarder: a Cloudflare Pages Function (branch preview only).
   NOAA's Aviation Weather Center Data API answers without a CORS header, so browsers cannot read it directly. This forwards
   only the requests Weather Threats needs, with the repo's identifying User-Agent:
     GET /api/awc/metar?ids=KORD[,KMDW…]   -> https://aviationweather.gov/api/data/metar?ids=…&format=json  (1-4 ICAO ids)
     GET /api/awc/taf?ids=KORD[,KMDW…]     -> https://aviationweather.gov/api/data/taf?ids=…&format=json
     GET /api/awc/pirep?bbox=S,W,N,E&age=H -> …/pirep?format=json&age=H&bbox=…   (pilot reports; age 1-3 hours; AWC returns at most 400)
     GET /api/awc/airsigmet                -> …/airsigmet?format=json             (domestic SIGMETs)
     GET /api/awc/gairmet?fore=0|3|6|9|12  -> …/gairmet?format=json&fore=…        (G-AIRMET snapshot for that forecast hour)
     GET /api/awc/cwa                      -> …/cwa?format=json                   (Center Weather Advisories; AWC's 204 becomes [])
   Freshness: METAR, PIREP, SIGMET and CWA cached 2 minutes, TAF and G-AIRMET 5 minutes; X-Upstream-Fetched-At carries when AWC
   answered (a cache hit keeps the original time). Failures (upstream error, timeout, a body that is not a JSON list) are 502
   and never cached. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const UPSTREAM = "https://aviationweather.gov/api/data/";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_MS = { metar: 120e3, taf: 300e3, pirep: 120e3, airsigmet: 120e3, gairmet: 300e3, cwa: 120e3 }, memory = new Map();
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent, X-Cache-Max-Age";
function cors(request) { const o = request.headers.get("Origin"); return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" }; }
const json = (status, obj, head) => new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } });
/* the only upstream URLs this forwards; anything else is 404 */
function upstreamKey(url, base) {
  const m = /^\/api\/awc\/(metar|taf|pirep|airsigmet|gairmet|cwa)$/.exec(url.pathname); if (!m) return null;
  const kind = m[1], q = url.searchParams, keys = [...q.keys()], only = (...a) => keys.every((k) => a.includes(k));
  if (kind === "metar" || kind === "taf") {
    const ids = (q.get("ids") || "").toUpperCase().split(",").filter(Boolean);
    if (!only("ids") || !ids.length || ids.length > 4 || ids.some((i) => !/^[A-Z][A-Z0-9]{3}$/.test(i))) return null;
    return base + kind + "?ids=" + [...new Set(ids)].sort().join(",") + "&format=json";
  }
  if (kind === "pirep") {
    const b = (q.get("bbox") || "").split(",").map(Number), age = +(q.get("age") || 2);
    if (!only("bbox", "age") || b.length !== 4 || b.some((x) => !Number.isFinite(x)) || b[0] < -90 || b[2] > 90 || b[0] >= b[2] || b[1] < -180 || b[3] > 180 || b[1] >= b[3] || !(age >= 1 && age <= 3)) return null;
    return base + "pirep?format=json&age=" + age + "&bbox=" + b.map((x) => Math.round(x * 10) / 10).join(",");
  }
  if (kind === "gairmet") { const f = q.get("fore") || "0"; if (!only("fore") || !["0", "3", "6", "9", "12"].includes(f)) return null; return base + "gairmet?format=json&fore=" + f; }
  if (!only()) return null;
  return base + kind + "?format=json";
}
export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {};
  const url = new URL(request.url), now = t.NOW ? t.NOW() : Date.now(), base = t.UPSTREAM || UPSTREAM;
  const head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const key = upstreamKey(url, base); if (!key) return json(404, { error: "not a Weather Threats aviation request" }, head);
  const kind = /\/api\/awc\/([a-z]+)$/.exec(url.pathname)[1], hit = memory.get(key);
  if (hit && now - hit.at < TTL_MS[kind]) return send(hit, "HIT", kind, head);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000);
  let res, body;
  try { res = await fetch(key, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: ctl.signal }); body = await res.text(); }
  catch (e) { return json(502, { error: ctl.signal.aborted ? "AWC did not answer in time" : "AWC request failed" }, head); }
  finally { clearTimeout(timer); }
  if (res.status === 204) body = "[]"; // no products in effect
  if (!res.ok) return json(502, { error: "AWC answered HTTP " + res.status }, { ...head, "X-Upstream-Status": String(res.status) });
  let j; try { j = JSON.parse(body); } catch (e) { return json(502, { error: "AWC answer was not JSON" }, head); }
  if (!Array.isArray(j)) return json(502, { error: "AWC answer was not a list" }, head);
  const rec = { body, at: t.NOW ? t.NOW() : Date.now() }; memory.set(key, rec);
  return send(rec, "MISS", kind, { ...head, "X-Upstream-Status": String(res.status) });
}
function send(rec, cache, kind, head) {
  return new Response(rec.body, { status: 200, headers: { ...head, "Content-Type": "application/json", "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Cache-Max-Age": String(TTL_MS[kind] / 1000), "X-Upstream-User-Agent": USER_AGENT } });
}
export async function onRequest(context) { return handle(context.request, context.env || {}); }
