/* Forecast Ops smoke and air-quality forwarder: a Cloudflare Pages Function (branch preview only).
   Two official files the browser cannot use directly:
     GET /api/smoke/hms/<YYYYMMDD>            NOAA HMS smoke KML for that UTC day (no CORS header upstream). Only today and
                                              the two previous UTC days.
         -> https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/YYYY/MM/hms_smokeYYYYMMDD.kml
     GET /api/smoke/airnow-area?area=<name>&state=<ST>   the rows of AirNow's reportingarea.dat (2 MB, all areas) for one
                                              reporting area, as published (pipe-delimited text)
         -> https://files.airnowtech.org/airnow/today/reportingarea.dat
   Freshness: upstream files are cached 10 minutes; every answer carries X-Upstream-Fetched-At (a cache hit keeps the
   original time) and X-Upstream-Last-Modified. Failures are never cached: an upstream error, timeout or a body that is
   not KML / not the reporting-area format returns 502 with a JSON reason. HMS 404 (the day's file not published yet)
   returns 404 with a reason, so the page can fall back to the previous day. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const HMS = "https://satepsanone.nesdis.noaa.gov", AIRNOW = "https://files.airnowtech.org";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_MS = 600e3, memory = new Map();
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Last-Modified, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent, X-Cache-Max-Age";
function cors(request) { const o = request.headers.get("Origin"); return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" }; }
const json = (status, obj, head) => new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } });
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

async function upstream(key, t, check, name) {
  const hit = memory.get(key), now = t.NOW ? t.NOW() : Date.now();
  if (hit && now - hit.at < TTL_MS) return { rec: hit, cache: "HIT" };
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 20000);
  let res, body;
  try { res = await fetch(key, { headers: { "User-Agent": USER_AGENT }, signal: ctl.signal }); body = await res.text(); }
  catch (e) { return { error: [502, name + (ctl.signal.aborted ? " did not answer in time" : " request failed")] }; }
  finally { clearTimeout(timer); }
  if (res.status === 404) return { error: [404, name + " has not published this file"], status: 404 };
  if (!res.ok) return { error: [502, name + " answered HTTP " + res.status], status: res.status };
  const why = check(body); if (why) return { error: [502, name + " answer " + why] };
  const rec = { body, at: t.NOW ? t.NOW() : Date.now(), lastModified: res.headers.get("Last-Modified") || "" };
  memory.set(key, rec); return { rec, cache: "MISS", status: res.status };
}
export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {};
  const url = new URL(request.url), now = t.NOW ? t.NOW() : Date.now();
  const head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  let m = /^\/api\/smoke\/hms\/(\d{8})$/.exec(url.pathname);
  if (m && ![...url.searchParams.keys()].length) {
    const d = m[1];
    if (![0, 1, 2].map((k) => ymd(now - k * 864e5)).includes(d)) return json(404, { error: "only today and the two previous UTC days" }, head);
    const key = (t.UPSTREAM_HMS || HMS) + "/pub/FIRE/web/HMS/Smoke_Polygons/KML/" + d.slice(0, 4) + "/" + d.slice(4, 6) + "/hms_smoke" + d + ".kml";
    const r = await upstream(key, t, (b) => (/<kml[\s>]/.test(b) ? null : "was not KML"), "NOAA HMS");
    if (r.error) return json(r.error[0], { error: r.error[1] }, { ...head, ...(r.status ? { "X-Upstream-Status": String(r.status) } : {}) });
    return send(r.rec.body, r.rec, r.cache, { ...head, "Content-Type": "application/vnd.google-earth.kml+xml" });
  }
  if (url.pathname === "/api/smoke/airnow-area") {
    const area = url.searchParams.get("area") || "", st = url.searchParams.get("state") || "";
    if ([...url.searchParams.keys()].some((k) => k !== "area" && k !== "state") || !/^[A-Za-z0-9 .,'()\/&-]{1,80}$/.test(area) || !/^[A-Z]{2}$/.test(st)) return json(404, { error: "not a Weather Threats AirNow request" }, head);
    const key = (t.UPSTREAM_AIRNOW || AIRNOW) + "/airnow/today/reportingarea.dat";
    const r = await upstream(key, t, (b) => (b.split("\n", 2)[0].split("|").length >= 15 ? null : "was not the reporting-area format"), "AirNow");
    if (r.error) return json(r.error[0] === 404 ? 502 : r.error[0], { error: r.error[1] }, head);
    const rows = r.rec.body.split(/\r?\n/).filter((l) => { const c = l.split("|"); return c[7] === area && c[8] === st; });
    return send(rows.join("\n") + (rows.length ? "\n" : ""), r.rec, r.cache, { ...head, "Content-Type": "text/plain; charset=utf-8", "X-Rows": String(rows.length) });
  }
  return json(404, { error: "not a Weather Threats smoke request" }, head);
}
function send(body, rec, cache, head) {
  return new Response(body, { status: 200, headers: { ...head, "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-Upstream-Last-Modified": rec.lastModified, "X-Forecast-Ops-Cache": cache, "X-Cache-Max-Age": String(TTL_MS / 1000), "X-Upstream-User-Agent": USER_AGENT } });
}
export async function onRequest(context) { return handle(context.request, context.env || {}); }
