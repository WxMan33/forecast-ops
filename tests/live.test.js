// Live check against real Open-Meteo responses, using the exact config, loader and math the site uses.
// Run with: node tests/live.test.js   (Node 18+, needs internet). GitHub Actions runs it daily.
// Writes a capture of key numbers to tests/out/live-summary.json for inspection.
const fs = require("fs");
const path = require("path");
const C = require("../assets/ops-core.js");
const D = require("../assets/ops-data.js");

const PLACES = [
  { name: "TQL Stadium, Cincinnati, OH", lat: 39.11113, lon: -84.52229 },
  { name: "Denver, CO (high terrain)", lat: 39.7392, lon: -104.9903 },
];
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  FAIL " + msg); } };
const finite = (a) => a.filter((x) => x != null && isFinite(x));
/* range checks require real values: an empty or all-null series fails instead of passing vacuously */
const between = (a, lo, hi) => finite(a).length > 0 && finite(a).every((x) => x >= lo && x <= hi);
/* Fields each model is expected to deliver, with explicit, documented exceptions. */
const EXPECT = {
  blend: ["temperature_2m", "dew_point_2m", "precipitation", "wind_speed_10m", "wind_gusts_10m", "cloud_cover"],
  thunder: ["cape", "weather_code", "wind_speed_10m"],
  severe: ["temperature_2m", "dew_point_2m", "cape", "wind_speed_10m", "geopotential_height_500hPa", "temperature_500hPa", "temperature_700hPa", "wind_speed_500hPa"],
};
const EXCEPT = {
  /* Found in real responses (Nov 2026). Each one is handled on the site, not hidden. */
  /* NAM on Open-Meteo has no pressure-level data at all: Severe shows it as limited data. */
  "severe:ncep_nam_conus": ["wind_speed_500hPa", "geopotential_height_500hPa", "temperature_500hPa", "temperature_700hPa"],
  /* ECMWF AIFS has no wind gusts: the blend averages gusts from the models that have them. */
  "blend:ecmwf_aifs025_single": ["wind_gusts_10m"],
  "blend:jma_seamless": ["wind_gusts_10m"],
};
function usable(group, data) {
  Object.keys(data.models).forEach((id) => {
    const skip = EXCEPT[`${group}:${id}`] || [];
    EXPECT[group].forEach((v) => {
      if (skip.includes(v)) return;
      const n = finite(data.models[id].h[v] || []).length;
      ok(n >= 24, `${group} ${id}: ${v} has usable values (${n} of ${data.times.length} hours)`);
    });
  });
}
const range = (a) => { const v = finite(a); return v.length ? `${Math.min(...v).toFixed(2)}..${Math.max(...v).toFixed(2)} (${v.length} values)` : "no values"; };
const hourly = (times) => times.every((t, i) => i === 0 || Date.parse(t + "Z") - Date.parse(times[i - 1] + "Z") === 3600e3);

(async () => {
  const out = { at: new Date().toISOString(), places: [] };
  for (const P of PLACES) {
    console.log(`\n== ${P.name}`);
    const where = { lat: P.lat, lon: P.lon };
    const rec = { place: P.name };

    /* blend */
    const B = await D.loadModels(C.config.blend, { ...where, days: 3 });
    const bOk = Object.keys(B.models);
    console.log(`  blend: ${bOk.length} models ok · problems: ${B.problems.join(" | ") || "none"}`);
    ok(bOk.length >= 4, "blend: at least 4 models return data");
    ok(hourly(B.times), "blend: hourly time axis with no gaps");
    bOk.forEach((id) => ok(between(B.models[id].h.temperature_2m, -60, 125), `blend ${id}: temperatures in °F range`));
    bOk.filter((id) => !(EXCEPT[`blend:${id}`] || []).includes("wind_gusts_10m")).forEach((id) => ok(between(B.models[id].h.wind_gusts_10m || [], 0, 200), `blend ${id}: gusts in mph range`));
    usable("blend", B);
    const rows = C.blend.dailyRows(B, C.config.defaultWeights(C.config.blend));
    ok(rows.length >= 3, "blend: at least 3 daily rows");
    ok(rows.every((r) => r.hi == null || r.lo == null || r.hi >= r.lo), "blend: daily high >= low");
    /* our hourly-derived highs should agree with Open-Meteo's own daily max where both exist */
    bOk.forEach((id) => {
      const md = B.models[id];
      C.time.dayGroups(B.times).filter((d) => d.idx.length === 24 && C.stats.complete(md.h.temperature_2m, d.idx)).forEach((d) => {
        const j = B.dtimes.indexOf(d.k), own = j >= 0 && md.d.temperature_2m_max ? md.d.temperature_2m_max[j] : null;
        const hmax = Math.max(...d.idx.map((i) => md.h.temperature_2m[i]));
        /* the model's own daily max can sit above every hourly sample (true max between output times) */
        if (own != null) ok(own >= hmax - 1.5 && own <= hmax + 4, `blend ${id} ${d.k}: daily max matches hourly max (daily ${own}, hourly ${hmax}, ${B.tz})`);
      });
    });
    rec.blend = { models: bOk, problems: B.problems, rows: rows.map((r) => ({ k: r.k, hi: r.hi, lo: r.lo, qpf: r.qpf, contrib: r.contrib })) };

    /* thunder */
    const T = await D.loadModels(C.config.thunder, { ...where, days: 3 });
    const tws = C.config.defaultWeights(C.config.thunder);
    console.log(`  thunder: ${Object.keys(T.models).length} models ok · problems: ${T.problems.join(" | ") || "none"}`);
    ok(Object.keys(T.models).length >= 3, "thunder: at least 3 models");
    usable("thunder", T);
    const TH = C.thunder.hourly(T, tws);
    ok(TH.assess.length === T.times.length, "thunder: one assessment per hour");
    ok(between(TH.cape.mean, -50, 8000), `thunder: CAPE in J/kg range (blend ${range(TH.cape.mean)}; ${TH.ids.map((id) => `${id} ${range(T.models[id].h.cape)}`).join("; ")})`);
    ok(TH.assess.every((a) => C.TIERS[a.tier] && typeof a.limited === "boolean"), "thunder: assessments well formed");
    rec.thunder = { models: TH.ids, limitedHours: TH.assess.filter((a) => a.limited).length, worst: C.maxTier(TH.assess.map((a) => a.tier)) };

    /* severe */
    const Sv = await D.loadModels(C.config.severe, { ...where, days: 2 });
    const sIds = Object.keys(Sv.models);
    console.log(`  severe: ${sIds.length} models ok · problems: ${Sv.problems.join(" | ") || "none"}`);
    rec.severe = {};
    usable("severe", Sv);
    sIds.forEach((id) => {
      const md = Sv.models[id], ser = C.severe.series(md.h, Sv.times.length, md.elev);
      const bs6 = finite(ser.bs6), srh1 = finite(ser.srh1);
      console.log(`    ${id}: elev ${md.elev} m · bs6 ${bs6.length}/${Sv.times.length} h (max ${bs6.length ? Math.max(...bs6).toFixed(0) : "—"} kt) · srh1 max ${srh1.length ? Math.max(...srh1).toFixed(0) : "—"}`);
      const noWinds = (EXCEPT[`severe:${id}`] || []).includes("wind_speed_500hPa"), noUpper = (EXCEPT[`severe:${id}`] || []).includes("temperature_500hPa");
      if (!noWinds) {
        ok(between(md.h.wind_speed_500hPa || [], 0, 250), `severe ${id}: 500 hPa wind in knots range`);
        ok(between(ser.bs6, 0, 200), `severe ${id}: 0–6 km shear plausible`);
        ok(between(ser.srh1, -800, 1500) && between(ser.srh3, -1000, 2000), `severe ${id}: SRH plausible`);
      } else ok(!finite(ser.bs6).length, `severe ${id}: listed as windless, and indeed produces no shear (else update EXCEPT)`);
      ok(between(ser.lcl, 0, 6000), `severe ${id}: LCL plausible`);
      const i7 = md.h.temperature_700hPa ? md.h.temperature_700hPa.findIndex((x) => x != null) : -1;
      if (!noUpper) ok(between(md.h.geopotential_height_500hPa || [], 4500, 6300), `severe ${id}: 500 hPa height in meters (${range(md.h.geopotential_height_500hPa || [])})`);
      if (!noUpper) ok(between(ser.lr75, 2, 11), `severe ${id}: 700–500 lapse rate plausible (lr75 ${range(ser.lr75)}; sample hour ${i7}: T700 ${md.h.temperature_700hPa && md.h.temperature_700hPa[i7]}, T500 ${md.h.temperature_500hPa && md.h.temperature_500hPa[i7]}, z700 ${md.h.geopotential_height_700hPa && md.h.geopotential_height_700hPa[i7]}, z500 ${md.h.geopotential_height_500hPa && md.h.geopotential_height_500hPa[i7]}, T2m ${md.h.temperature_2m[i7]})`);
      rec.severe[id] = { elev: md.elev, bs6Hours: bs6.length, srh1Max: srh1.length ? Math.max(...srh1) : null };
    });
    ok(sIds.some((id) => finite(Sv.models[id].h.wind_speed_500hPa || []).length), "severe: at least one model has upper-air winds");

    /* winter ensembles */
    const W = await D.loadEnsemble(C.config.winter, where);
    const counts = Object.fromEntries(Object.keys(W.ens).map((id) => [id, W.ens[id].snowfall.length]));
    console.log(`  winter: members ${JSON.stringify(counts)} · problems: ${W.problems.join(" | ") || "none"}`);
    ok((counts.gfs025 || 0) >= 20, "winter: GEFS returns 20+ members");
    ok((counts.ecmwf_ifs025 || 0) >= 40, "winter: ECMWF ENS returns 40+ members");
    ok(hourly(W.times), "winter: hourly time axis with no gaps");
    const mem = C.winter.members(W, C.config.defaultWeights(C.config.winter));
    ok(mem.every((m) => between(m.a, 0, 10)), "winter: hourly snowfall in inches range");
    const st = C.winter.windowStats(mem, 0, Math.min(72, W.times.length));
    console.log(`  winter 72 h: ${st.used}/${st.total} complete members · ${st.partial} partial · P(1"+) ${st.P[1] == null ? "—" : Math.round(st.P[1] * 100) + "%"}`);
    ok(st.used > 0, "winter: some members cover the first 72 h completely");
    rec.winter = { counts, used: st.used, partial: st.partial, total: st.total, P1: st.P[1], p50: st.p50 };

    out.places.push(rec);
  }
  /* Time changes: Open-Meteo labels a response with ONE fixed offset. The event code relies on this
     (instants = label - utc_offset_seconds), so check it across the most recent DST change any of
     these zones had within the API's ~90-day history. */
  {
    const zones = [["America/New_York", 39.11, -84.52], ["Europe/Berlin", 52.52, 13.4], ["Australia/Sydney", -33.87, 151.21], ["America/Santiago", -33.45, -70.67]];
    let found = null;
    for (const [tz, lat, lon] of zones) {
      for (let d = 2; d <= 85 && !found; d++) {
        const a = Date.now() - d * 86400e3, b = a + 86400e3;
        if (C.time.offsetMin(a, tz) !== C.time.offsetMin(b, tz)) found = { tz, lat, lon, day: new Date(a).toISOString().slice(0, 10), day2: new Date(b + 86400e3).toISOString().slice(0, 10) };
      }
      if (found) break;
    }
    if (!found) console.log("\nDST check skipped: no time change in the last 85 days in the probe zones");
    else {
      const j = await D.getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${found.lat}&longitude=${found.lon}&hourly=temperature_2m&models=gfs_seamless&timezone=${encodeURIComponent(found.tz)}&start_date=${found.day}&end_date=${found.day2}`, 0);
      if (j.error) ok(false, `DST check request: ${j.reason}`);
      else {
        const t = j.hourly.time, inst = C.time.instants(t, found.tz, j.utc_offset_seconds);
        const steps = inst.ms.every((m, i) => i === 0 || m - inst.ms[i - 1] === 3600e3);
        console.log(`\nDST check ${found.tz} ${found.day}..${found.day2}: ${t.length} labels, offset ${j.utc_offset_seconds}s, duplicates ${t.length - new Set(t).size}, labels match true local time: ${inst.consistent}`);
        ok(t.length === new Set(t).size && steps && t.length % 24 === 0, "DST: labels are a single fixed offset (no repeated or skipped hours), as the event code assumes");
        ok(!inst.consistent, "DST: across a time change the labels differ from true local time, and instants() detects it");
      }
    }
  }

  fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "out", "live-summary.json"), JSON.stringify(out, null, 2));
  console.log(`\n${checks - fails}/${checks} live checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
