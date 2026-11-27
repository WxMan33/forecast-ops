/* Forecast Ops MRMS precipitation-type forwarder: a Cloudflare Pages Function (branch preview only).
   NOAA's MRMS server sends no CORS header, so browsers can't read the PrecipFlag grid directly. The page reads it here:
     GET /api/mrms/precipflag/time    -> {"scan": "<ISO>", "fetchedAt": "<ISO>", "bytes": n}   (about 100 bytes; polled every 60 s)
     GET /api/mrms/precipflag/latest  -> https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz, unchanged
                                         (about 230 KB; downloaded by the page only when /time lists a new scan)
     GET /api/mrms/precipflag/at/YYYYMMDD-HHMM -> that scan's file (MRMS_PrecipFlag_00.00_YYYYMMDD-HHMM00.grib2.gz), so the page
                                         can pair precipitation type with the reflectivity scan of the same minute. A scan is
                                         immutable: kept an hour (per worker and in the data-centre cache); 404 if NOAA hasn't
                                         published it (or no longer keeps it, after about 27 hours).
   Nothing else is forwarded (404). Sharing: simultaneous requests in a worker join one read; the workers in one Cloudflare data
   centre share its Cache API copy (with staggered expiry, below); data centres don't share with each other. Every answer
   carries X-Upstream-Fetched-At and X-MRMS-Scan (a cache hit keeps the original times) and X-Forecast-Ops-Cache (MEMORY, JOINED,
   COLO or MISS). The body is checked before it is
   served: gzip, GRIB edition 2, NCEP MRMS (centre 161, discipline 209, category 6 parameter 0 = PrecipFlag), the 7000 x 3500
   0.01-degree CONUS grid, PNG packing (template 5.41). Anything else, an upstream error or a timeout returns 502 with a JSON
   reason and is never cached. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const MRMS = "https://mrms.ncep.noaa.gov";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_MS = 60e3, JITTER_MS = 15e3, MAX_BYTES = 8 * 1048576;
let memory = null;
const EXPOSE = "X-Upstream-Fetched-At, X-MRMS-Scan, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent";
function cors(request) { const o = request.headers.get("Origin"); return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" }; }
const json = (status, obj, head) => new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } });
async function gunzip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }

/* the scan time from a PrecipFlag GRIB2 message, after checking it is the product the page decodes; throws otherwise */
export function checkPrecipFlag(g) {
  const dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
  if (g.length < 200 || String.fromCharCode(g[0], g[1], g[2], g[3]) !== "GRIB" || g[7] !== 2) throw Error("not a GRIB2 message");
  if (g[6] !== 209) throw Error("not an MRMS (discipline 209) product");
  const sec = {};
  for (let o = 16; o + 5 <= g.length;) { if (g[o] === 55 && g[o + 1] === 55 && g[o + 2] === 55 && g[o + 3] === 55) break; const len = dv.getUint32(o); if (len < 5 || o + len > g.length) throw Error("truncated GRIB2"); sec[g[o + 4]] = o; o += len; }
  for (const n of [1, 3, 4, 5, 7]) if (sec[n] == null) throw Error("GRIB2 section " + n + " missing");
  const s1 = sec[1], s3 = sec[3], s4 = sec[4], s5 = sec[5];
  if (dv.getUint16(s1 + 5) !== 161) throw Error("not from NCEP MRMS (centre 161)");
  if (g[s4 + 9] !== 6 || g[s4 + 10] !== 0) throw Error("not PrecipFlag (category 6, parameter 0)");
  if (dv.getUint16(s3 + 12) !== 0 || dv.getUint32(s3 + 30) !== 7000 || dv.getUint32(s3 + 34) !== 3500) throw Error("unexpected MRMS grid");
  if (dv.getUint16(s5 + 9) !== 41) throw Error("unexpected GRIB2 packing (expected PNG, template 5.41)");
  const t = Date.UTC(dv.getUint16(s1 + 12), g[s1 + 14] - 1, g[s1 + 15], g[s1 + 16], g[s1 + 17], g[s1 + 18]);
  if (!Number.isFinite(t)) throw Error("missing scan time"); return t;
}

/* one PrecipFlag record shared, in order: this worker's memory; requests arriving while an upstream read is in flight join it
   (one read, however many arrive together at expiry); Cloudflare's data-centre cache (the Cache API: shared by every worker in
   that data centre, not between data centres); then NOAA. Only checked files are kept. */
let inflight = null;
const CACHE_KEY = "https://forecast-ops-cache.invalid/mrms/precipflag/latest";
/* each worker keeps its copy 60 s plus its own random 0-15 s: at expiry the workers in a data centre don't all miss at once,
   so the first to refresh stores the new file in the data-centre cache and the rest find it there instead of asking NOAA.
   A copy in the data-centre cache counts as current for 75 s. */
async function record(t, now) {
  if (memory && now - memory.at < memory.ttl) return { rec: memory, cache: "MEMORY" };
  if (inflight) return { rec: await inflight, cache: "JOINED" };
  let layer = "MISS"; const ttl = TTL_MS + Math.round((t.JITTER ? t.JITTER() : Math.random()) * JITTER_MS);
  inflight = (async () => {
    const store = t.CACHE !== undefined ? t.CACHE : (typeof caches !== "undefined" && caches.default) || null;
    if (store) { const hit = await store.match(CACHE_KEY).catch(() => null);
      if (hit) { const at = +hit.headers.get("x-fo-at"), scan = +hit.headers.get("x-fo-scan");
        if (now - at < TTL_MS + JITTER_MS && Number.isFinite(scan)) { layer = "COLO"; return (memory = { body: new Uint8Array(await hit.arrayBuffer()), at, scan, ttl: Math.max(ttl, now - at + 5e3) }); } } }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000); let res, body;
    try { res = await fetch((t.UPSTREAM || MRMS) + "/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz", { headers: { "User-Agent": USER_AGENT }, signal: ctl.signal }); body = new Uint8Array(await res.arrayBuffer()); }
    catch (e) { throw { status: 502, error: "MRMS " + (ctl.signal.aborted ? "did not answer in time" : "request failed") }; }
    finally { clearTimeout(timer); }
    if (!res.ok) throw { status: 502, error: "MRMS answered HTTP " + res.status, upstream: res.status };
    if (body.length > MAX_BYTES || body[0] !== 0x1f || body[1] !== 0x8b) throw { status: 502, error: "MRMS answer was not a gzip file" };
    let scan; try { scan = checkPrecipFlag(await gunzip(body)); } catch (e) { throw { status: 502, error: "MRMS answer was not PrecipFlag: " + e.message }; }
    const rec = (memory = { body, at: now, scan, ttl });
    if (store) await store.put(CACHE_KEY, new Response(body, { headers: { "Content-Type": "application/gzip", "Cache-Control": "public, max-age=" + Math.round((TTL_MS + JITTER_MS) / 1000), "x-fo-at": String(now), "x-fo-scan": String(scan) } })).catch(() => {});
    return rec;
  })().finally(() => { inflight = null; });
  return { rec: await inflight, cache: layer === "COLO" ? "COLO" : "MISS" };
}

/* one past scan, by its time (immutable once published) */
const atMem = new Map(), atFlight = new Map(), AT_TTL_MS = 3600e3;
async function recordAt(t, now, stamp) {
  const hit = atMem.get(stamp); if (hit && now - hit.at < AT_TTL_MS) return { rec: hit, cache: "MEMORY" };
  if (atFlight.has(stamp)) return { rec: await atFlight.get(stamp), cache: "JOINED" };
  let layer = "MISS"; const key = "https://forecast-ops-cache.invalid/mrms/precipflag/at/" + stamp;
  const p = (async () => {
    const store = t.CACHE !== undefined ? t.CACHE : (typeof caches !== "undefined" && caches.default) || null;
    if (store) { const h = await store.match(key).catch(() => null); if (h) { layer = "COLO"; const rec = { body: new Uint8Array(await h.arrayBuffer()), at: +h.headers.get("x-fo-at"), scan: +h.headers.get("x-fo-scan") }; atMem.set(stamp, rec); return rec; } }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000); let res, body;
    try { res = await fetch((t.UPSTREAM || MRMS) + "/2D/PrecipFlag/MRMS_PrecipFlag_00.00_" + stamp + "00.grib2.gz", { headers: { "User-Agent": USER_AGENT }, signal: ctl.signal }); body = new Uint8Array(await res.arrayBuffer()); }
    catch (e) { throw { status: 502, error: "MRMS " + (ctl.signal.aborted ? "did not answer in time" : "request failed") }; }
    finally { clearTimeout(timer); }
    if (res.status === 404) throw { status: 404, error: "MRMS has no precipitation-type scan for " + stamp, upstream: 404 };
    if (!res.ok) throw { status: 502, error: "MRMS answered HTTP " + res.status, upstream: res.status };
    if (body.length > MAX_BYTES || body[0] !== 0x1f || body[1] !== 0x8b) throw { status: 502, error: "MRMS answer was not a gzip file" };
    let scan; try { scan = checkPrecipFlag(await gunzip(body)); } catch (e) { throw { status: 502, error: "MRMS answer was not PrecipFlag: " + e.message }; }
    const want = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13));
    if (scan !== want) throw { status: 502, error: "MRMS file for " + stamp + " carries another scan time" };
    const rec = { body, at: now, scan }; atMem.set(stamp, rec); if (atMem.size > 12) atMem.delete(atMem.keys().next().value);
    if (store) await store.put(key, new Response(body, { headers: { "Content-Type": "application/gzip", "Cache-Control": "public, max-age=3600", "x-fo-at": String(now), "x-fo-scan": String(scan) } })).catch(() => {});
    return rec;
  })().finally(() => atFlight.delete(stamp));
  atFlight.set(stamp, p);
  return { rec: await p, cache: layer };
}

export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {};
  const url = new URL(request.url), head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const at = /^\/api\/mrms\/precipflag\/at\/(20\d{6}-[0-2]\d[0-5]\d)$/.exec(url.pathname);
  const m = at ? [null, "at"] : /^\/api\/mrms\/precipflag\/(time|latest)$/.exec(url.pathname);
  if (!m || [...url.searchParams.keys()].length) return json(404, { error: "not a Weather Threats MRMS request" }, head);
  let rec, cache;
  try { ({ rec, cache } = at ? await recordAt(t, t.NOW ? t.NOW() : Date.now(), at[1]) : await record(t, t.NOW ? t.NOW() : Date.now())); }
  catch (e) { return json(e.status || 502, { error: e.error || "MRMS request failed" }, e.upstream ? { ...head, "X-Upstream-Status": String(e.upstream) } : head); }
  const meta = { "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-MRMS-Scan": new Date(rec.scan).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Upstream-User-Agent": USER_AGENT };
  if (m[1] === "time") return json(200, { product: "PrecipFlag", scan: new Date(rec.scan).toISOString(), fetchedAt: new Date(rec.at).toISOString(), bytes: rec.body.length, cache }, { ...head, ...meta });
  return new Response(rec.body, { status: 200, headers: { ...head, ...meta, "Content-Type": "application/gzip" } });
}
export const _reset = () => { memory = null; inflight = null; atMem.clear(); atFlight.clear(); };
export async function onRequest(context) { return handle(context.request, context.env || {}); }
