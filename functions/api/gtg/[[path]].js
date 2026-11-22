/* Forecast Ops GTG forwarder: a Cloudflare Pages Function (branch preview only).
   NOAA NCEP's Graphical Turbulence Guidance files (NOMADS, DAFS) are 145-170 MB each and NOMADS sends no CORS header, so
   this forwards only what the map needs: the latest cycle, and ONE GRIB2 record (one height, one forecast hour, about 1 MB)
   read by byte range using the file's own .idx. Identifying User-Agent.
     GET /api/gtg/latest                               -> { cycle, hours: [...], files }   (cached 5 minutes)
     GET /api/gtg/record?cycle=YYYYMMDDHH&fh=0-18&m=M   -> the EDPARM record at M metres above MSL (cached 30 minutes)
   M must be one of the file's 51 heights. A record that does not start with GRIB and end with 7777, or a short read, is 502. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const BASE = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/dafs/prod/";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const HEIGHTS = [30, ...Array.from({ length: 50 }, (_, k) => Math.floor((k + 1) * 1000 * 0.3048 + 1e-6))];
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent, X-GTG-Cycle, X-GTG-Record, X-GTG-File-Bytes";
const mem = { latest: null, idx: new Map(), rec: new Map() };
function cors(request) { const o = request.headers.get("Origin"); return o && ORIGINS.some((r) => r.test(o)) ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : { Vary: "Origin" }; }
const json = (status, obj, head) => new Response(JSON.stringify(obj), { status, headers: { ...head, "Content-Type": "application/json" } });
async function up(url, t, init = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), t.TIMEOUT_MS || 20000);
  try { return await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...(init.headers || {}) }, signal: ctl.signal }); } finally { clearTimeout(timer); }
}
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
export async function handle(request, env = {}) {
  const t = env.__harness === true ? env : {}, base = t.UPSTREAM || BASE, now = t.NOW ? t.NOW() : Date.now();
  const url = new URL(request.url), head = { ...cors(request), "Access-Control-Expose-Headers": EXPOSE, "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...head, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
  if (request.method !== "GET") return json(405, { error: "GET only" }, head);
  const q = url.searchParams, keys = [...q.keys()];
  try {
    if (url.pathname === "/api/gtg/latest" && !keys.length) {
      if (mem.latest && now - mem.latest.at < 300e3) return json(200, mem.latest.body, { ...head, "X-Forecast-Ops-Cache": "HIT", "X-Upstream-Fetched-At": new Date(mem.latest.at).toISOString() });
      let found = null;
      for (const day of [ymd(now), ymd(now - 864e5)]) {
        const r = await up(base + "dafs." + day + "/", t); if (r.status === 404) continue; if (!r.ok) return json(502, { error: "NOMADS answered HTTP " + r.status }, { ...head, "X-Upstream-Status": String(r.status) });
        const html = await r.text(), files = {};
        for (const m of html.matchAll(/dafs\.t(\d{2})z\.gtg\.3km\.conus\.f(\d{3})\.grib2"[^\n]*?(\d+(?:\.\d+)?[KMG])\s/g)) { const cc = m[1]; (files[cc] = files[cc] || {})[+m[2]] = m[3]; }
        // a cycle counts once its idx is listed too; the newest cycle with every hour 0-18, and the newest with any
        const idx = new Set([...html.matchAll(/dafs\.t(\d{2})z\.gtg\.3km\.conus\.f(\d{3})\.grib2\.idx"/g)].map((m) => m[1] + "|" + +m[2]));
        const cycles = Object.keys(files).sort().reverse().map((cc) => ({ cycle: day + cc, hours: Object.keys(files[cc]).map(Number).filter((h) => idx.has(cc + "|" + h)).sort((a, b) => a - b), sizes: files[cc] }));
        const full = cycles.find((c) => c.hours.length === 19);
        if (full) { found = { cycle: full.cycle, hours: full.hours, sizes: full.sizes, newest: cycles[0].cycle, newestHours: cycles[0].hours }; break; }
      }
      if (!found) return json(502, { error: "no complete GTG cycle found on NOMADS for today or yesterday" }, head);
      mem.latest = { at: t.NOW ? t.NOW() : Date.now(), body: found };
      return json(200, found, { ...head, "X-Forecast-Ops-Cache": "MISS", "X-Upstream-Fetched-At": new Date(mem.latest.at).toISOString() });
    }
    if (url.pathname === "/api/gtg/record" && keys.every((k) => ["cycle", "fh", "m"].includes(k)) && keys.length === 3) {
      const cyc = q.get("cycle"), fh = q.get("fh"), m = q.get("m");
      if (!/^\d{10}$/.test(cyc) || !/^\d{1,2}$/.test(fh) || +fh > 18 || !HEIGHTS.includes(+m) || String(+m) !== m) return json(404, { error: "not a Weather Threats GTG request" }, head);
      const cMs = Date.UTC(+cyc.slice(0, 4), +cyc.slice(4, 6) - 1, +cyc.slice(6, 8), +cyc.slice(8, 10)); if (!(now - cMs < 2 * 864e5 && cMs - now < 3600e3)) return json(404, { error: "cycle outside the last two days" }, head);
      const file = base + "dafs." + cyc.slice(0, 8) + "/dafs.t" + cyc.slice(8, 10) + "z.gtg.3km.conus.f" + String(+fh).padStart(3, "0") + ".grib2", rkey = file + "|" + m;
      const hit = mem.rec.get(rkey); if (hit && now - hit.at < 1800e3) return send(hit, "HIT", head);
      let ix = mem.idx.get(file);
      if (!ix || now - ix.at > 3600e3) { const r = await up(file + ".idx", t); if (!r.ok) return json(r.status === 404 ? 404 : 502, { error: "NOMADS idx answered HTTP " + r.status }, { ...head, "X-Upstream-Status": String(r.status) }); ix = { at: now, lines: (await r.text()).trim().split("\n").map((l) => l.split(":")) }; mem.idx.set(file, ix); }
      const k = ix.lines.findIndex((l) => l[3] === "EDPARM" && l[4] === m + " m above mean sea level"); if (k < 0) return json(502, { error: "EDPARM at " + m + " m not in the file's index" }, head);
      const start = +ix.lines[k][1], end = k + 1 < ix.lines.length ? +ix.lines[k + 1][1] - 1 : null; if (end == null) return json(502, { error: "last record: length unknown" }, head);
      const r = await up(file, t, { headers: { Range: "bytes=" + start + "-" + end } });
      if (r.status !== 206) return json(502, { error: "NOMADS range read answered HTTP " + r.status }, { ...head, "X-Upstream-Status": String(r.status) });
      const buf = new Uint8Array(await r.arrayBuffer()), total = /\/(\d+)$/.exec(r.headers.get("content-range") || "");
      const ok = buf.length === end - start + 1 && String.fromCharCode(...buf.slice(0, 4)) === "GRIB" && String.fromCharCode(...buf.slice(-4)) === "7777";
      if (!ok) return json(502, { error: "the byte range was not one whole GRIB2 record" }, head);
      const rec = { body: buf, at: t.NOW ? t.NOW() : Date.now(), cycle: cyc, record: ix.lines[k].slice(0, 7).join(":"), fileBytes: total ? total[1] : "" };
      mem.rec.set(rkey, rec); if (mem.rec.size > 24) mem.rec.delete(mem.rec.keys().next().value);
      return send(rec, "MISS", head);
    }
    return json(404, { error: "not a Weather Threats GTG request" }, head);
  } catch (e) { return json(502, { error: e.name === "AbortError" ? "NOMADS did not answer in time" : "NOMADS request failed" }, head); }
}
function send(rec, cache, head) {
  return new Response(rec.body, { status: 200, headers: { ...head, "Content-Type": "application/octet-stream", "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Upstream-User-Agent": USER_AGENT, "X-GTG-Cycle": rec.cycle, "X-GTG-Record": rec.record, "X-GTG-File-Bytes": rec.fileBytes } });
}
export async function onRequest(context) { return handle(context.request, context.env || {}); }
