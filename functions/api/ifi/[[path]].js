/* Forecast Ops In-Flight Icing forwarder: a Cloudflare Pages Function (branch preview only).
   NOAA NCEP's In-Flight Icing (IFI) files (NOMADS, DAFS: dafs.tCCz.ifi.3km.conus.fFFF.grib2, forecast hours 1-18, about
   30-36 MB each) come without a CORS header, so this forwards only what the map needs: the latest cycle, and ONE GRIB2 record
   (one field, one height, one forecast hour, about 0.1-0.5 MB) read by byte range using the file's own .idx.
     GET /api/ifi/latest                                          -> { cycle, hours: [1..18], sizes }   (cached 5 minutes)
     GET /api/ifi/record?cycle=YYYYMMDDHH&fh=1-18&ft=F&field=prob|sev
        prob: "Icing probability" (GRIB2 0/19/233, ICPRB, non-dimensional)
        sev:  "Icing Severity" (GRIB2 0/19/37, ICESEV, NCEP Table 4.228: 0 none, 1 trace, 2 light, 3 moderate, 4 severe)
   F is a height in feet MSL, 500 to 30,000 in 500 ft steps (the file's 60 heights, 152.4 to 9,144 m). A record that does not
   start with GRIB and end with 7777, or a short read, is 502. Identifying User-Agent. */
export const USER_AGENT = "(forecast-ops, github.com/WxMan33/forecast-ops)";
const BASE = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/dafs/prod/";
const ORIGINS = [/^https:\/\/wxman33\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)?forecast-ops-beta\.pages\.dev$/, /^https:\/\/raw\.githack\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// idx labels: metres with up to one decimal, as wgrib2 prints them ("152.4", "762", "9144")
const label = (ft) => String(Math.round(ft * 0.3048 * 10) / 10);
const FIELDS = { prob: (l) => l[3] === "ICPRB", sev: (l) => l[3] === "ICESEV" || /parmcat=19 parm=37$/.test(l[3]) };
const EXPOSE = "X-Upstream-Fetched-At, X-Upstream-Status, X-Forecast-Ops-Cache, X-Upstream-User-Agent, X-IFI-Cycle, X-IFI-Record, X-IFI-File-Bytes";
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
    if (url.pathname === "/api/ifi/latest" && !keys.length) {
      if (mem.latest && now - mem.latest.at < 300e3) return json(200, mem.latest.body, { ...head, "X-Forecast-Ops-Cache": "HIT", "X-Upstream-Fetched-At": new Date(mem.latest.at).toISOString() });
      let found = null;
      for (const day of [ymd(now), ymd(now - 864e5)]) {
        const r = await up(base + "dafs." + day + "/", t); if (r.status === 404) continue; if (!r.ok) return json(502, { error: "NOMADS answered HTTP " + r.status }, { ...head, "X-Upstream-Status": String(r.status) });
        const html = await r.text(), files = {};
        for (const m of html.matchAll(/dafs\.t(\d{2})z\.ifi\.3km\.conus\.f(\d{3})\.grib2"[^\n]*?(\d+(?:\.\d+)?[KMG])\s/g)) { const cc = m[1]; (files[cc] = files[cc] || {})[+m[2]] = m[3]; }
        // a cycle counts once its idx is listed too; the newest cycle with every hour 0-18, and the newest with any
        const idx = new Set([...html.matchAll(/dafs\.t(\d{2})z\.ifi\.3km\.conus\.f(\d{3})\.grib2\.idx"/g)].map((m) => m[1] + "|" + +m[2]));
        const cycles = Object.keys(files).sort().reverse().map((cc) => ({ cycle: day + cc, hours: Object.keys(files[cc]).map(Number).filter((h) => idx.has(cc + "|" + h)).sort((a, b) => a - b), sizes: files[cc] }));
        const full = cycles.find((c) => c.hours.length === 18 && c.hours[0] === 1);
        if (full) { found = { cycle: full.cycle, hours: full.hours, sizes: full.sizes, newest: cycles[0].cycle, newestHours: cycles[0].hours }; break; }
      }
      if (!found) return json(502, { error: "no complete IFI cycle found on NOMADS for today or yesterday" }, head);
      mem.latest = { at: t.NOW ? t.NOW() : Date.now(), body: found };
      return json(200, found, { ...head, "X-Forecast-Ops-Cache": "MISS", "X-Upstream-Fetched-At": new Date(mem.latest.at).toISOString() });
    }
    if (url.pathname === "/api/ifi/record" && keys.every((k) => ["cycle", "fh", "ft", "field"].includes(k)) && keys.length === 4) {
      const cyc = q.get("cycle"), fh = q.get("fh"), ft = q.get("ft"), field = q.get("field");
      if (!/^\d{10}$/.test(cyc) || !/^\d{1,2}$/.test(fh) || +fh < 1 || +fh > 18 || !/^\d{3,5}$/.test(ft) || +ft % 500 || +ft < 500 || +ft > 30000 || !Object.prototype.hasOwnProperty.call(FIELDS, field)) return json(404, { error: "not a Weather Threats IFI request" }, head);
      const m = label(+ft);
      const cMs = Date.UTC(+cyc.slice(0, 4), +cyc.slice(4, 6) - 1, +cyc.slice(6, 8), +cyc.slice(8, 10)); if (!(now - cMs < 2 * 864e5 && cMs - now < 3600e3)) return json(404, { error: "cycle outside the last two days" }, head);
      const file = base + "dafs." + cyc.slice(0, 8) + "/dafs.t" + cyc.slice(8, 10) + "z.ifi.3km.conus.f" + String(+fh).padStart(3, "0") + ".grib2", rkey = file + "|" + field + "|" + m;
      const hit = mem.rec.get(rkey); if (hit && now - hit.at < 1800e3) return send(hit, "HIT", head);
      let ix = mem.idx.get(file);
      if (!ix || now - ix.at > 3600e3) { const r = await up(file + ".idx", t); if (!r.ok) return json(r.status === 404 ? 404 : 502, { error: "NOMADS idx answered HTTP " + r.status }, { ...head, "X-Upstream-Status": String(r.status) }); ix = { at: now, lines: (await r.text()).trim().split("\n").map((l) => l.split(":")) }; mem.idx.set(file, ix); }
      const k = ix.lines.findIndex((l) => FIELDS[field](l) && l[4] === m + " m above mean sea level"); if (k < 0) return json(502, { error: field + " at " + m + " m not in the file's index" }, head);
      const start = +ix.lines[k][1], end = k + 1 < ix.lines.length ? +ix.lines[k + 1][1] - 1 : null; // the file's last record (severity at 30,000 ft) has no next offset: read to the end and trust the GRIB length field
      const r = await up(file, t, { headers: { Range: "bytes=" + start + "-" + (end == null ? "" : end) } });
      if (r.status !== 206) return json(502, { error: "NOMADS range read answered HTTP " + r.status }, { ...head, "X-Upstream-Status": String(r.status) });
      const buf = new Uint8Array(await r.arrayBuffer()), total = /\/(\d+)$/.exec(r.headers.get("content-range") || "");
      const glen = buf.length >= 16 ? Number(new DataView(buf.buffer, buf.byteOffset, 16).getBigUint64(8)) : -1;
      const ok = (end == null || buf.length === end - start + 1) && glen === buf.length && String.fromCharCode(...buf.slice(0, 4)) === "GRIB" && String.fromCharCode(...buf.slice(-4)) === "7777";
      if (!ok) return json(502, { error: "the byte range was not one whole GRIB2 record" }, head);
      const rec = { body: buf, at: t.NOW ? t.NOW() : Date.now(), cycle: cyc, record: ix.lines[k].slice(0, 7).join(":"), fileBytes: total ? total[1] : "" };
      mem.rec.set(rkey, rec); if (mem.rec.size > 24) mem.rec.delete(mem.rec.keys().next().value);
      return send(rec, "MISS", head);
    }
    return json(404, { error: "not a Weather Threats IFI request" }, head);
  } catch (e) { return json(502, { error: e.name === "AbortError" ? "NOMADS did not answer in time" : "NOMADS request failed" }, head); }
}
function send(rec, cache, head) {
  return new Response(rec.body, { status: 200, headers: { ...head, "Content-Type": "application/octet-stream", "X-Upstream-Fetched-At": new Date(rec.at).toISOString(), "X-Forecast-Ops-Cache": cache, "X-Upstream-User-Agent": USER_AGENT, "X-IFI-Cycle": rec.cycle, "X-IFI-Record": rec.record, "X-IFI-File-Bytes": rec.fileBytes } });
}
export async function onRequest(context) { return handle(context.request, context.env || {}); }
