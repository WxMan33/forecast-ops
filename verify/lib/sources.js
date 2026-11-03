/* Raw collection of forecast sources for one location. Each source is fetched independently;
   a failure is recorded and never stops the others. Only raw responses are saved here;
   normalization runs later from the saved evidence (and can be re-run). */
"use strict";
const U = require("./util.js");
const C = U.Core;

const OM = "https://api.open-meteo.com/v1/forecast", OME = "https://ensemble-api.open-meteo.com/v1/ensemble";
const UNITS = { temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch", timezone: "GMT" };
const DET_VARS = ["temperature_2m", "precipitation", "snowfall", "precipitation_probability"];
const ENS_VARS = ["temperature_2m", "precipitation", "snowfall"];
/* Open-Meteo model metadata endpoints (latest run initialisation as reported at retrieval).
   Seamless products blend several runs; the listed component is the global one. */
const META = { ecmwf_ifs025: "ecmwf_ifs025", ecmwf_aifs025_single: "ecmwf_aifs025_single", gfs_seamless: "ncep_gfs013", ncep_nbm_conus: "ncep_nbm_conus", gfs_hrrr: "ncep_hrrr_conus",
  ncep_nam_conus: "ncep_nam_conus", icon_seamless: "dwd_icon", gem_seamless: "cmc_gem_gdps", ukmo_seamless: "ukmo_global_deterministic_10km", ecmwf_ens: "ecmwf_ifs025_ensemble", gefs: "ncep_gefs025" };
const SEAMLESS = new Set(["gfs_seamless", "icon_seamless", "gem_seamless", "ukmo_seamless"]);

/* Source list: the blend page's deterministic models (shared config), both ensembles and NWS. */
function sourceList() {
  const det = C.config.blend.models.map((m) => ({ id: m.id, name: m.name, kind: "det" }));
  const ens = C.config.blendEns.models.map((m) => ({ id: m.source, name: m.name, kind: "ens", omId: m.id }));
  return [...det, ...ens, { id: "nws", name: "NWS point forecast", kind: "nws" }];
}

async function fetchMeta(id) {
  const m = META[id]; if (!m) return null;
  const r = await U.fetchRaw(`https://api.open-meteo.com/data/${m}/static/meta.json`, { tries: 2, timeoutMs: 20000 });
  const j = r.ok ? U.parseJSON(r.text) : null;
  if (!j) return { metaId: m, error: r.error || `HTTP ${r.status}` };
  const init = j.last_run_initialisation_time, avail = j.last_run_availability_time;
  const ageH = init ? (Date.now() - init * 1000) / 3600e3 : null;
  return { metaId: m, metaUrl: `https://api.open-meteo.com/data/${m}/static/meta.json`, lastRunInit: init ? U.iso(init * 1000) : null, lastRunAvailable: avail ? U.iso(avail * 1000) : null, seamless: SEAMLESS.has(id) || undefined,
    implausible: ageH != null && ageH > 72 ? `reported run is ${Math.round(ageH)} h old` : undefined };
}
/* Model-cycle provenance. Provider-reported values are kept exactly as reported and labelled with
   where they came from; nothing is inferred (inferred stays null); missing or implausible stays
   "unknown" for analysis while the reported value is still preserved. */
function cycleOf(kind, rec) {
  if (kind === "nws") return { reported: rec.issuedAt || null, reportedBy: "NWS gridpoint response field properties.updateTime (forecast update time, not a model run)", inferred: null, status: rec.issuedAt ? "provider-reported" : "unknown" };
  const m = rec.meta || {};
  if (!m.lastRunInit) return { reported: null, reportedBy: m.metaUrl || "no metadata endpoint", inferred: null, status: "unknown", note: m.error || "provider reported no run time" };
  return { reported: m.lastRunInit, reportedBy: `${m.metaUrl} last_run_initialisation_time (the latest run Open-Meteo reported as available at retrieval; the forecast response itself does not state its run${m.seamless ? "; seamless product combines several models, value is for its global component" : ""})`,
    inferred: null, status: m.implausible ? "provider-reported-implausible" : "provider-reported", note: m.implausible || undefined };
}

/* Collect every source's raw response into dataRoot/rel. Returns per-source outcome records. */
async function collect(loc, dataRoot, rel, { days = 16 } = {}) {
  const out = {};
  const save = (name, r) => U.saveRaw(dataRoot, `${rel}/${name}`, r.buf);
  const q = (o) => new URLSearchParams(o).toString().replace(/%2C/g, ",");
  const jobs = sourceList().map(async (s) => {
    const rec = { id: s.id, kind: s.kind, status: "failed", files: {} };
    try {
      if (s.kind === "det" || s.kind === "ens") {
        const url = s.kind === "det"
          ? `${OM}?${q({ latitude: loc.lat, longitude: loc.lon, ...UNITS, forecast_days: days, models: s.id, hourly: DET_VARS.join(",") })}`
          : `${OME}?${q({ latitude: loc.lat, longitude: loc.lon, ...UNITS, forecast_days: Math.min(days, 16), models: s.omId, hourly: ENS_VARS.join(",") })}`;
        const r = await U.fetchRaw(url, { accept: "application/json" });
        rec.request = url; rec.retrievedAt = r.retrievedAt; rec.httpStatus = r.status; rec.attempts = r.attempts;
        if (r.buf.length) rec.files.response = save(`${s.id}.json`, r);
        const j = r.ok ? U.parseJSON(r.text) : null;
        if (!j || j.error) { rec.error = (j && j.reason) || r.error || `HTTP ${r.status}`; }
        else {
          const tv = j.hourly && j.hourly.temperature_2m !== undefined ? j.hourly.temperature_2m : Object.entries(j.hourly || {}).find(([k]) => k.startsWith("temperature_2m"))?.[1];
          const last = tv ? tv.map((x, i) => (x == null ? -1 : i)).filter((i) => i >= 0).pop() : -1;
          rec.status = last >= 0 ? "ok" : "empty";
          rec.horizonEnd = last >= 0 ? j.hourly.time[last] + "Z" : null;
          if (s.kind === "ens") rec.members = Object.keys(j.hourly).filter((k) => k.startsWith("temperature_2m")).length;
        }
        rec.meta = await fetchMeta(s.id);
        rec.cycle = cycleOf(s.kind, rec);
      } else {
        /* NWS: the forecast for the observing site's own grid point */
        const H = { accept: "application/geo+json" };
        const pt = await U.fetchRaw(`https://api.weather.gov/points/${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`, H);
        rec.files.points = save("nws-points.json", pt);
        const pp = (U.parseJSON(pt.text) || {}).properties || {};
        rec.grid = pp.gridId ? `${pp.gridId}/${pp.gridX},${pp.gridY}` : null;
        if (loc.nws && rec.grid && rec.grid !== `${loc.nws.office}/${loc.nws.gridX},${loc.nws.gridY}`) rec.gridChanged = true;
        const parts = { forecast: pp.forecast && pp.forecast + "?units=us", hourly: pp.forecastHourly && pp.forecastHourly + "?units=us", grid: pp.forecastGridData };
        rec.parts = {};
        for (const [k, url] of Object.entries(parts)) {
          if (!url) { rec.parts[k] = { status: "failed", error: "no URL from points" }; continue; }
          const r = await U.fetchRaw(url, H);
          const j = U.parseJSON(r.text) || {}, p = j.properties || {};
          rec.files[k] = save(`nws-${k}.json`, r);
          rec.parts[k] = { status: r.ok && p.updateTime ? "ok" : "failed", httpStatus: r.status, retrievedAt: r.retrievedAt, updateTime: p.updateTime || null, generatedAt: p.generatedAt || null, validTimes: p.validTimes || null, error: r.ok ? undefined : r.error || `HTTP ${r.status}` };
        }
        rec.retrievedAt = Object.values(rec.parts).map((p) => p.retrievedAt).filter(Boolean).sort().pop() || null;
        const ok = Object.values(rec.parts).filter((p) => p.status === "ok").length;
        rec.status = ok === 3 ? "ok" : ok ? "partial" : "failed";
        rec.issuedAt = rec.parts.grid && rec.parts.grid.updateTime;
        rec.cycle = cycleOf("nws", rec);
      }
    } catch (e) { rec.error = String((e && e.message) || e); }
    out[s.id] = rec;
  });
  await Promise.all(jobs);
  return out;
}
module.exports = { sourceList, collect, cycleOf, DET_VARS, ENS_VARS, META };
