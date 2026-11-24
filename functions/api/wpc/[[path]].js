/* Forecast Ops WPC forwarder: a Cloudflare Pages Function (branch preview only).
   WPC publishes its Excessive Rainfall Outlook as GeoJSON but without a CORS header, so browsers cannot read it directly.
   This forwards exactly those files, adding the repo's identifying User-Agent:
     GET /api/wpc/ero/day<1-5>   ->  https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day<N>_Latest.geojson
   Freshness: cached up to 5 minutes; every answer carries X-Upstream-Fetched-At (when WPC answered; a cache hit keeps the
   original time) and X-Upstream-Last-Modified (WPC's own file time). Failures are never cached or answered from an old copy:
   an upstream error, timeout, non-JSON body or a body without `features` returns 502. */
const UPSTREAM = "https://www.wpc.ncep.noaa.gov";
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_MS = 300e3, memory = new Map();
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Last-Modified, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent, X-Cache-Max-Age";
function cors(request) { const o = request.headers.get("Origin"); return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" }; }
const json = (status, obj, head) => new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } });

export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {}; // test hooks (upstream, clock, timeout) only from the local harness
  const url = new URL(request.url), now = t.NOW ? t.NOW() : Date.now(), base = t.UPSTREAM || UPSTREAM;
  const head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const m = /^\/api\/wpc\/ero\/day([1-5])$/.exec(url.pathname);
  if (!m || [...url.searchParams.keys()].length) return json(404, { error: "not a Weather Threats WPC request" }, head);
  const key = base + "/exper/eromap/geojson/Day" + m[1] + "_Latest.geojson";
  const hit = memory.get(key);
  if (hit && now - hit.at < TTL_MS) return send(hit, "HIT", head);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000);
  let res, body;
  try { res = await fetch(key, { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json, application/json" }, signal: ctl.signal }); body = await res.text(); }
  catch (e) { return json(502, { error: ctl.signal.aborted ? "WPC did not answer in time" : "WPC request failed" }, head); }
  finally { clearTimeout(timer); }
  if (!res.ok) return json(502, { error: "WPC answered HTTP " + res.status }, { ...head, "X-Upstream-Status": String(res.status) });
  let j; try { j = JSON.parse(body); } catch (e) { return json(502, { error: "WPC answer was not JSON" }, head); }
  if (!j || !Array.isArray(j.features)) return json(502, { error: "WPC answer without features" }, head);
  const rec = { body, at: t.NOW ? t.NOW() : Date.now(), lastModified: res.headers.get("Last-Modified") || "" };
  memory.set(key, rec);
  return send(rec, "MISS", { ...head, "X-Upstream-Status": String(res.status) });
}
function send(rec, cache, head) {
  return new Response(rec.body, { status: 200, headers: { ...head, "Content-Type": "application/geo+json", "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-Upstream-Last-Modified": rec.lastModified, "X-Forecast-Ops-Cache": cache, "X-Cache-Max-Age": String(TTL_MS / 1000), "X-Upstream-User-Agent": USER_AGENT } });
}
export async function onRequest(context) { return handle(context.request, context.env || {}); }
