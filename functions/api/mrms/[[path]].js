/* Forecast Ops MRMS precipitation-type forwarder: a Cloudflare Pages Function (branch preview only).
   NOAA's MRMS server sends no CORS header, so browsers can't read the PrecipFlag grid directly. The page reads it here:
     GET /api/mrms/precipflag/time    -> {"scan": "<ISO>", "fetchedAt": "<ISO>", "bytes": n}   (about 100 bytes; polled every 60 s)
     GET /api/mrms/precipflag/latest  -> https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz, unchanged
                                         (about 230 KB; downloaded by the page only when /time lists a new scan)
   Nothing else is forwarded (404). Freshness: one upstream read per 60 s per worker, shared by every viewer; every answer
   carries X-Upstream-Fetched-At and X-MRMS-Scan (a cache hit keeps the original times). The body is checked before it is
   served: gzip, GRIB edition 2, NCEP MRMS (centre 161, discipline 209, category 6 parameter 0 = PrecipFlag), the 7000 x 3500
   0.01-degree CONUS grid, PNG packing (template 5.41). Anything else, an upstream error or a timeout returns 502 with a JSON
   reason and is never cached. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const MRMS = "https://mrms.ncep.noaa.gov";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const TTL_MS = 60e3, MAX_BYTES = 8 * 1048576;
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

export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {};
  const url = new URL(request.url), head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const m = /^\/api\/mrms\/precipflag\/(time|latest)$/.exec(url.pathname);
  if (!m || [...url.searchParams.keys()].length) return json(404, { error: "not a Weather Threats MRMS request" }, head);
  const now = t.NOW ? t.NOW() : Date.now();
  let rec = memory && now - memory.at < TTL_MS ? memory : null, cache = rec ? "HIT" : "MISS";
  if (!rec) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 15000); let res, body;
    try { res = await fetch((t.UPSTREAM || MRMS) + "/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz", { headers: { "User-Agent": USER_AGENT }, signal: ctl.signal }); body = new Uint8Array(await res.arrayBuffer()); }
    catch (e) { return json(502, { error: "MRMS " + (ctl.signal.aborted ? "did not answer in time" : "request failed") }, head); }
    finally { clearTimeout(timer); }
    if (!res.ok) return json(502, { error: "MRMS answered HTTP " + res.status }, { ...head, "X-Upstream-Status": String(res.status) });
    if (body.length > MAX_BYTES || body[0] !== 0x1f || body[1] !== 0x8b) return json(502, { error: "MRMS answer was not a gzip file" }, head);
    let scan; try { scan = checkPrecipFlag(await gunzip(body)); } catch (e) { return json(502, { error: "MRMS answer was not PrecipFlag: " + e.message }, head); }
    rec = memory = { body, at: now, scan };
  }
  const meta = { "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-MRMS-Scan": new Date(rec.scan).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Upstream-User-Agent": USER_AGENT };
  if (m[1] === "time") return json(200, { product: "PrecipFlag", scan: new Date(rec.scan).toISOString(), fetchedAt: new Date(rec.at).toISOString(), bytes: rec.body.length }, { ...head, ...meta });
  return new Response(rec.body, { status: 200, headers: { ...head, ...meta, "Content-Type": "application/gzip" } });
}
export const _reset = () => { memory = null; };
export async function onRequest(context) { return handle(context.request, context.env || {}); }
