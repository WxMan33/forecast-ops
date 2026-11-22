/* Forecast Ops FAA status forwarder: a Cloudflare Pages Function (branch preview only).
   The FAA's National Airspace System status (nasstatus.faa.gov) sends no CORS header, so browsers cannot read it directly.
   This forwards only the two requests Weather Threats needs, with the repo's identifying User-Agent:
     GET /api/faa/airport-events   -> https://nasstatus.faa.gov/api/airport-events    (ground stops, ground delay programs,
                                                                                         arrival/departure delays, closures; a list)
     GET /api/faa/operations-plan  -> https://nasstatus.faa.gov/api/operations-plan   (the day's planned initiatives; an object)
   Freshness: cached 1 minute; X-Upstream-Fetched-At carries when the FAA answered (a cache hit keeps the original time).
   Failures (upstream error, timeout, a body of the wrong shape) are 502 and never cached. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const UPSTREAM = "https://nasstatus.faa.gov/api/";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_MS = 60e3, memory = new Map(), SHAPE = { "airport-events": Array.isArray, "operations-plan": (j) => !!j && typeof j === "object" && !Array.isArray(j) };
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent, X-Cache-Max-Age";
function cors(request) { const o = request.headers.get("Origin"); return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" }; }
const json = (status, obj, head) => new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } });
export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {};
  const url = new URL(request.url), now = t.NOW ? t.NOW() : Date.now(), base = t.UPSTREAM || UPSTREAM;
  const head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const m = /^\/api\/faa\/(airport-events|operations-plan)$/.exec(url.pathname);
  if (!m || [...url.searchParams.keys()].length) return json(404, { error: "not a Weather Threats FAA request" }, head);
  const kind = m[1], key = base + kind, hit = memory.get(key);
  if (hit && now - hit.at < TTL_MS) return send(hit, "HIT", head);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000);
  let res, body;
  try { res = await fetch(key, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: ctl.signal }); body = await res.text(); }
  catch (e) { return json(502, { error: ctl.signal.aborted ? "FAA did not answer in time" : "FAA request failed" }, head); }
  finally { clearTimeout(timer); }
  if (!res.ok) return json(502, { error: "FAA answered HTTP " + res.status }, { ...head, "X-Upstream-Status": String(res.status) });
  let j; try { j = JSON.parse(body); } catch (e) { return json(502, { error: "FAA answer was not JSON" }, head); }
  if (!SHAPE[kind](j)) return json(502, { error: "FAA answer was not the expected shape" }, head);
  const rec = { body, at: t.NOW ? t.NOW() : Date.now() }; memory.set(key, rec);
  return send(rec, "MISS", { ...head, "X-Upstream-Status": String(res.status) });
}
function send(rec, cache, head) {
  return new Response(rec.body, { status: 200, headers: { ...head, "Content-Type": "application/json", "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Cache-Max-Age": String(TTL_MS / 1000), "X-Upstream-User-Agent": USER_AGENT } });
}
export async function onRequest(context) { return handle(context.request, context.env || {}); }
