// Captures real provider responses into tests/fixtures/ for repeatable regression tests,
// and inventories which Open-Meteo models actually deliver the winter fields.
// Run by .github/workflows/capture.yml (needs internet). Node 18+.
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "fixtures");
fs.mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "(forecast-ops test capture, github.com/WxMan33/forecast-ops)", Accept: "application/geo+json" };
const save = (name, obj) => { fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj)); console.log("saved", name, Math.round(JSON.stringify(obj).length / 1024) + " KB"); };
const get = async (url, headers = {}) => { const r = await fetch(url, { headers }); const j = await r.json().catch(() => ({})); return { status: r.status, headers: Object.fromEntries([...r.headers].filter(([k]) => /date|expires|last-modified|cache-control/.test(k))), json: j }; };

const PLACES = { cincinnati: [39.1111, -84.5223], denver: [39.7392, -104.9903] };
(async () => {
  const meta = { capturedAt: new Date().toISOString() };
  /* ---------- NWS ---------- */
  for (const [k, [lat, lon]] of Object.entries(PLACES)) {
    const p = await get(`https://api.weather.gov/points/${lat},${lon}`, UA);
    save(`nws-${k}-points.json`, p);
    const pr = p.json.properties || {};
    for (const [name, url] of [["forecast", pr.forecast], ["hourly", pr.forecastHourly], ["grid", pr.forecastGridData]]) {
      if (!url) continue;
      const r = await get(url + (name === "grid" ? "" : "?units=us"), UA);
      save(`nws-${k}-${name}.json`, r);
    }
  }
  /* ---------- Open-Meteo: winter field inventory ---------- */
  const FIELDS = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "wet_bulb_temperature_2m", "precipitation", "rain", "showers", "snowfall",
    "freezing_level_height", "weather_code", "snow_depth", "soil_temperature_0cm", "surface_pressure",
    ...[1000, 975, 950, 925, 900, 850, 800, 700, 600, 500].flatMap((p) => [`temperature_${p}hPa`, `geopotential_height_${p}hPa`, `relative_humidity_${p}hPa`])];
  const MODELS = ["ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless", "ncep_nbm_conus", "gfs_hrrr", "ncep_nam_conus", "icon_seamless", "gem_seamless", "ukmo_seamless"];
  const inv = {};
  const [lat, lon] = PLACES.cincinnati;
  for (const m of MODELS) {
    let hv = FIELDS.slice(), j = null;
    for (let a = 0; a < 10; a++) {
      j = (await get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=3&temperature_unit=celsius&precipitation_unit=mm&models=${m}&hourly=${hv.join(",")}`)).json;
      if (!j.error) break;
      const why = String(j.reason || ""), lv = [...why.matchAll(/(\d{3,4})\s*hPa/g)].map((x) => `_${x[1]}hPa`);
      const bad = hv.filter((v) => why.includes(v) || lv.some((l) => v.endsWith(l)));
      if (!bad.length) break;
      hv = hv.filter((v) => !bad.includes(v));
    }
    inv[m] = {};
    FIELDS.forEach((f) => { const a = j && j.hourly && j.hourly[f]; inv[m][f] = a ? a.filter((x) => x != null).length + "/" + a.length : "rejected"; });
    if (m === "gfs_seamless") save("om-cincinnati-gfs-winter.json", j);
  }
  const ENS = ["gfs025", "ecmwf_ifs025", "icon_seamless", "gem_global"];
  const EFIELDS = ["temperature_2m", "dew_point_2m", "precipitation", "rain", "snowfall", "weather_code", "freezing_level_height", "temperature_850hPa", "temperature_925hPa"];
  for (const m of ENS) {
    let hv = EFIELDS.slice(), j = null;
    for (let a = 0; a < 6; a++) {
      j = (await get(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=2&models=${m}&hourly=${hv.join(",")}`)).json;
      if (!j.error) break;
      const why = String(j.reason || ""), bad = hv.filter((v) => why.includes(v));
      if (!bad.length) break;
      hv = hv.filter((v) => !bad.includes(v));
    }
    inv["ens:" + m] = {};
    EFIELDS.forEach((f) => { const keys = Object.keys((j && j.hourly) || {}).filter((k) => k === f || k.startsWith(f + "_member")); const n = keys.reduce((s, k) => s + j.hourly[k].filter((x) => x != null).length, 0); inv["ens:" + m][f] = keys.length ? `${keys.length} members, ${n} values` : "rejected"; });
  }
  save("om-inventory.json", inv);
  /* ---------- Open-Meteo timestamp metadata ---------- */
  const tz = await get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&models=gfs_seamless&timezone=America%2FNew_York&start_date=2026-10-31&end_date=2026-11-02`);
  save("om-dst-newyork.json", tz.json);
  const blend = await get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=3&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&models=gfs_seamless&hourly=temperature_2m,precipitation,snowfall,wind_gusts_10m&daily=temperature_2m_max,temperature_2m_min`);
  save("om-cincinnati-gfs-blend.json", blend.json);
  meta.files = fs.readdirSync(OUT);
  save("capture-meta.json", meta);
  console.log(JSON.stringify(inv, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
