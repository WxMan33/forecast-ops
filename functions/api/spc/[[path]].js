/* Forecast Ops SPC storm-report forwarder: a Cloudflare Pages Function (branch preview only).
   SPC's report files answer automated browsers inconsistently, so the page reads them through here, identified as Forecast Ops:
     GET /api/spc/reports/today        -> https://www.spc.noaa.gov/climo/reports/today_filtered.csv
     GET /api/spc/reports/yesterday    -> https://www.spc.noaa.gov/climo/reports/yesterday_filtered.csv
   Nothing else is forwarded (404). Freshness: cached 2 minutes; every answer carries X-Upstream-Fetched-At (a cache hit keeps the
   original time). Failures are never cached: an upstream error, timeout or a body that is not SPC's report CSV returns 502 with a
   JSON reason. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const SPC = "https://www.spc.noaa.gov";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_MS = 120e3, memory = new Map();
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent";
function cors(request) { const o = request.headers.get("Origin"); return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" }; }
const json = (status, obj, head) => new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } });

export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {};
  const url = new URL(request.url), head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const m = /^\/api\/spc\/reports\/(today|yesterday)$/.exec(url.pathname);
  if (!m || [...url.searchParams.keys()].length) return json(404, { error: "not a Weather Threats SPC request" }, head);
  const key = (t.UPSTREAM || SPC) + "/climo/reports/" + m[1] + "_filtered.csv", now = t.NOW ? t.NOW() : Date.now(), hit = memory.get(key);
  let rec = hit && now - hit.at < TTL_MS ? hit : null, cache = rec ? "HIT" : "MISS";
  if (!rec) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000); let res, body;
    try { res = await fetch(key, { headers: { "User-Agent": USER_AGENT }, signal: ctl.signal }); body = await res.text(); }
    catch (e) { return json(502, { error: "SPC " + (ctl.signal.aborted ? "did not answer in time" : "request failed") }, head); }
    finally { clearTimeout(timer); }
    if (!res.ok) return json(502, { error: "SPC answered HTTP " + res.status }, { ...head, "X-Upstream-Status": String(res.status) });
    if (!/^Time,(F_Scale|Speed|Size),/.test(body.trim())) return json(502, { error: "SPC answer was not the storm report CSV" }, head);
    rec = { body, at: now }; memory.set(key, rec);
  }
  return new Response(rec.body, { status: 200, headers: { ...head, "Content-Type": "text/csv; charset=utf-8", "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Upstream-User-Agent": USER_AGENT } });
}
export async function onRequest(context) { return handle(context.request, context.env || {}); }
