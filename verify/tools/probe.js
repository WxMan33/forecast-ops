// One-off inventory of verification sources (needs internet; run in GitHub Actions).
// Writes a compact JSON report to argv[2]. Reads only public pages; checks robots.txt first.
const fs = require("fs");
const OUT = process.argv[2] || "probe.json";
const UA = "forecast-ops-verify/0.1 (+https://github.com/WxMan33/forecast-ops)";
const rep = { at: new Date().toISOString(), items: {} };
const put = (k, v) => { rep.items[k] = v; console.log("==", k, JSON.stringify(v).slice(0, 600)); };
async function get(url, opt = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "follow", ...opt, headers: { "User-Agent": UA, Accept: opt.accept || "*/*", ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, url: r.url, type: r.headers.get("content-type"), len: buf.length, ms: Date.now() - t0, headers: Object.fromEntries([...r.headers].filter(([k]) => /server|cache|age|date|last-mod|cf-|x-cache|akamai/.test(k))), text: buf.toString("utf8"), buf };
  } catch (e) { return { error: String(e && e.message || e), ms: Date.now() - t0 }; }
}
const json = (r) => { try { return JSON.parse(r.text); } catch (e) { return null; } };
const robotsCache = {};
async function robots(origin) {
  if (robotsCache[origin]) return robotsCache[origin];
  const r = await get(origin + "/robots.txt");
  return (robotsCache[origin] = { status: r.status, text: (r.text || "").slice(0, 4000) });
}
(async () => {
  /* ---------- CVG station metadata ---------- */
  const st = await get("https://api.weather.gov/stations/KCVG", { accept: "application/geo+json" });
  const sj = json(st) || {};
  put("nws-station-KCVG", { status: st.status, coords: sj.geometry && sj.geometry.coordinates, elevation: sj.properties && sj.properties.elevation, name: sj.properties && sj.properties.name, tz: sj.properties && sj.properties.timeZone, forecast: sj.properties && sj.properties.forecast, county: sj.properties && sj.properties.county });
  const [lon, lat] = (sj.geometry && sj.geometry.coordinates) || [-84.6722, 39.0444];
  const pt = await get(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { accept: "application/geo+json" });
  const pj = json(pt) || {}; const pp = pj.properties || {};
  put("nws-point-CVG", { status: pt.status, office: pp.gridId, x: pp.gridX, y: pp.gridY, tz: pp.timeZone, rel: pp.relativeLocation && pp.relativeLocation.properties, stations: pp.observationStations });
  const obs = await get("https://api.weather.gov/stations/KCVG/observations?limit=3", { accept: "application/geo+json" });
  const oj = json(obs) || {};
  put("nws-obs-KCVG", { status: obs.status, n: (oj.features || []).length, sample: (oj.features || []).slice(0, 2).map((f) => ({ t: f.properties.timestamp, temp: f.properties.temperature, raw: f.properties.rawMessage, max24: f.properties.maxTemperatureLast24Hours, p1: f.properties.precipitationLastHour, p6: f.properties.precipitationLast6Hours })) });
  /* ---------- CLI / CF6 products ---------- */
  for (const t of ["CLI", "CF6"]) {
    const l = await get(`https://api.weather.gov/products/types/${t}/locations/CVG`, { accept: "application/ld+json" });
    const lj = json(l) || {}; const g = lj["@graph"] || [];
    let first = null;
    if (g[0]) { const p = await get(g[0]["@id"], { accept: "application/ld+json" }); const pj2 = json(p) || {}; first = { id: pj2.id, issuanceTime: pj2.issuanceTime, wmo: pj2.wmoCollectiveId, office: pj2.issuingOffice, text: (pj2.productText || "").slice(0, 3500) }; }
    put(`nws-${t}-CVG`, { status: l.status, count: g.length, latest: g.slice(0, 6).map((x) => [x.issuanceTime, x.id]), first });
  }
  /* ---------- IEM ASOS archive ---------- */
  const d0 = new Date(Date.now() - 2 * 86400e3);
  const iem = await get(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=CVG&data=metar&year1=${d0.getUTCFullYear()}&month1=${d0.getUTCMonth() + 1}&day1=${d0.getUTCDate()}&year2=2030&month2=1&day2=1&tz=Etc/UTC&format=onlycomma&latlon=yes&elev=yes&missing=M&trace=T&direct=no&report_type=3&report_type=4`);
  put("iem-asos-CVG", { status: iem.status, type: iem.type, lines: (iem.text || "").split("\n").length, head: (iem.text || "").split("\n").slice(0, 4), tail: (iem.text || "").split("\n").slice(-4) });
  const iemMeta = await get("https://mesonet.agron.iastate.edu/api/1/station/CVG.json?network=KY_ASOS");
  put("iem-meta-CVG", { status: iemMeta.status, body: (iemMeta.text || "").slice(0, 1500) });
  /* ---------- ACIS ---------- */
  const acisBody = JSON.stringify({ sid: "CVG", sdate: new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10), edate: new Date().toISOString().slice(0, 10), elems: [{ name: "maxt" }, { name: "mint" }, { name: "pcpn" }, { name: "snow" }, { name: "snwd" }], meta: ["name", "sids", "ll", "elev", "valid_daterange", "uid"] });
  const acis = await get("https://data.rcc-acis.org/StnData", { method: "POST", body: acisBody, headers: { "Content-Type": "application/json" } });
  put("acis-CVG", { status: acis.status, body: (acis.text || "").slice(0, 2500) });
  /* ---------- NCEI GHCN-Daily access ---------- */
  const gh = await get("https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=USW00093814&startDate=" + new Date(Date.now() - 40 * 86400e3).toISOString().slice(0, 10) + "&endDate=" + new Date().toISOString().slice(0, 10) + "&dataTypes=TMAX,TMIN,PRCP,SNOW&format=json&units=standard&includeAttributes=true");
  put("ncei-ghcnd-CVG", { status: gh.status, body: (gh.text || "").slice(0, 1200), n: (json(gh) || []).length });
  /* ---------- Open-Meteo model metadata ---------- */
  for (const m of ["ecmwf_ifs025", "ecmwf_ifs025_ensemble", "ncep_gefs025", "ncep_gefs05", "gfs_global", "ncep_nbm_conus", "ncep_hrrr_conus", "ecmwf_aifs025_single", "dwd_icon", "cmc_gem_gdps", "ukmo_global_deterministic_10km", "ncep_nam_conus"]) {
    const r = await get(`https://api.open-meteo.com/data/${m}/static/meta.json`);
    put(`om-meta-${m}`, { status: r.status, body: (r.text || "").slice(0, 400) });
  }
  const ens = await get(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&models=ecmwf_ifs025,gfs025&forecast_days=16&timezone=GMT`);
  const ej = json(ens) || {};
  put("om-ens-horizon", { status: ens.status, n: ej.hourly && ej.hourly.time.length, keys: ej.hourly && Object.keys(ej.hourly).length, last: ej.hourly && ej.hourly.time.slice(-1), lastNonNull: ej.hourly && Object.fromEntries(Object.keys(ej.hourly).filter((k) => /member01$|^temperature_2m_(ecmwf|gfs)/.test(k)).map((k) => [k, ej.hourly.time[ej.hourly[k].map((x, i) => (x == null ? -1 : i)).filter((i) => i >= 0).pop()]])) });
  /* ---------- Cincinnati TV ---------- */
  const TV = {
    wlwt: ["https://www.wlwt.com", ["/weather", "/weather/7-day-forecast", "/weather/cincinnati"]],
    wcpo: ["https://www.wcpo.com", ["/weather", "/weather/forecast", "/weather/7-day-forecast"]],
    wkrc: ["https://local12.com", ["/weather", "/weather/7-day-forecast", "/weather/forecast"]],
    wxix: ["https://www.fox19.com", ["/weather/", "/weather/forecast/", "/weather/7-day-forecast/"]],
  };
  for (const [k, [origin, paths]] of Object.entries(TV)) {
    const rb = await robots(origin);
    const pages = [];
    for (const p of paths) {
      const r = await get(origin + p, { accept: "text/html" });
      const t = r.text || "";
      const imgs = [...t.matchAll(/(?:src|data-src|content|href)="([^"]+\.(?:jpe?g|png|webp|gif)[^"]*)"/gi)].map((m) => m[1]).filter((u) => /7|day|forecast|extended|weather|wx/i.test(u)).slice(0, 25);
      const scripts = [...t.matchAll(/<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].slice(0, 300)).slice(0, 5);
      const kw = [];
      for (const re of [/7[- ]day/gi, /extended/gi, /"high(?:Temp)?"\s*:/gi, /"low(?:Temp)?"\s*:/gi, /precip(?:itation)?(?:Chance|Probability)/gi, /forecastdata|weather[-_]?api|wsi|twc|weather\.com|accuweather|baron|dtn|weatherflow/gi]) {
        const m = [...t.matchAll(re)].slice(0, 3).map((x) => t.slice(Math.max(0, x.index - 160), x.index + 220).replace(/\s+/g, " "));
        if (m.length) kw.push({ re: String(re), n: [...t.matchAll(re)].length, ctx: m });
      }
      pages.push({ p, status: r.status, final: r.url, type: r.type, len: r.len, headers: r.headers, error: r.error, title: (t.match(/<title[^>]*>([^<]*)/i) || [])[1], imgs, scripts, kw, challenge: /captcha|cf-chl|challenge-platform|Access Denied|perimeterx|px-captcha/i.test(t) });
    }
    put(`tv-${k}`, { robots: rb, pages });
  }
  fs.writeFileSync(OUT, JSON.stringify(rep, (k, v) => (k === "buf" ? undefined : v), 1));
})();
