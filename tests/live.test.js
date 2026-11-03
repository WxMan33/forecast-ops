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
/* hourly axis check on real instants (labels are true local time, which can repeat at a time change) */
const hourly = (d) => d.ms && d.ms.length > 0 && d.ms.every((m, i) => i === 0 || m - d.ms[i - 1] === 3600e3);
/* A provider being down is not a calculation failure: report it separately and skip that block. */
let skips = 0;
const providerDown = (what, cond, why) => { if (!cond) return false; skips++; console.log(`  SKIP provider unavailable: ${what}${why ? ` (${why})` : ""}`); console.log(`::warning::Provider unavailable during live test: ${what}`); return true; };

(async () => {
  const out = { at: new Date().toISOString(), places: [] };
  for (const P of PLACES) {
    console.log(`\n== ${P.name}`);
    const where = { lat: P.lat, lon: P.lon };
    const rec = { place: P.name };

    /* blend */
    const B = await D.loadModels(C.config.blend, { ...where, days: 3 });
    if (providerDown(`Open-Meteo forecast at ${P.name}`, B.empty)) continue;
    const bOk = Object.keys(B.models);
    console.log(`  blend: ${bOk.length} models ok · problems: ${B.problems.join(" | ") || "none"}`);
    ok(bOk.length >= 4, "blend: at least 4 models return data");
    ok(hourly(B), "blend: hourly time axis with no gaps");
    ok(B.times.every((t, i) => t === C.time.toLocal(B.ms[i], B.tz)), "blend: shown labels are true local time from real instants");
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
    /* ensembles inside the blend: members load, align to the model axis and give member-first highs */
    const BE = await D.loadEnsemble(C.config.blendEns, { ...where, days: 3 });
    if (!providerDown(`Open-Meteo ensemble (blend) at ${P.name}`, BE.empty)) {
      C.blend.addSources(B, BE, null);
      C.config.blendEns.models.forEach((m) => { const md = B.models[m.source]; if (!md && m.optional) { console.warn(`OPTIONAL SOURCE UNAVAILABLE: ${m.name} (RRFS feed returned no usable members; not counted as a successful live check)`); return; } ok(md && md.n >= (m.minMembers || 20), `blend ${m.source}: ensemble members load (${md ? md.n : 0})`); });
      const er = C.blend.dailyRows(B, { ecmwf_ens: 1, gefs: 1 });
      ok(er.some((r) => r.hi != null && r.chance), "blend ensembles: daily highs and member chance of precip computed");
      ok(er.every((r) => r.hi == null || r.hiR[0] <= r.hiR[1]), "blend ensembles: 10th percentile high <= 90th");
    }
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
    ok(hourly(W), "winter: hourly time axis with no gaps");
    const mem = C.winter.members(W, C.config.defaultWeights(C.config.winter));
    ok(mem.every((m) => between(m.a, 0, 10)), "winter: hourly snowfall in inches range");
    const st = C.winter.windowStats(mem, 0, Math.min(72, W.times.length));
    console.log(`  winter 72 h: ${st.used}/${st.total} complete members · ${st.partial} partial · P(1"+) ${st.P[1] == null ? "—" : Math.round(st.P[1] * 100) + "%"}`);
    ok(st.used > 0, "winter: some members cover the first 72 h completely");
    rec.winter = { counts, used: st.used, partial: st.partial, total: st.total, P1: st.P[1], p50: st.p50 };

    /* ---------- NWS point forecast through the site's loader ---------- */
    const NW = await D.loadNWS(where);
    if (!providerDown(`NWS at ${P.name}`, !NW.ok, NW.reason)) {
      const Pd = NW.periods, A = C.nws.onAxis(NW, B.ms);
      console.log(`  nws: ${NW.office} ${NW.gridX},${NW.gridY} · ${Pd.length} periods · ${NW.hourly.length} hourly · grid ${NW.status.ageH.grid == null ? "—" : NW.status.ageH.grid.toFixed(1) + " h old"} · errors: ${NW.errors.join("; ") || "none"}`);
      ok(Pd.length >= 12 && Pd.every((p, i) => i === 0 || p.isDaytime !== Pd[i - 1].isDaytime), "nws: day/night periods alternate");
      ok(Pd.every((p, i) => i === 0 || p.s === Pd[i - 1].e), "nws: periods are contiguous");
      ok(Pd.every((p) => p.temp > -60 && p.temp < 130) && Pd.every((p) => p.pop == null || (p.pop >= 0 && p.pop <= 100)), "nws: period temps in °F, PoP a percent or null");
      if (A) {
        const gT = C.nws.stateAt(NW.parts.grid.properties.temperature, NW.hourly.map((h) => h.s));
        const d = NW.hourly.map((h, i) => (h.temp != null && gT[i] != null ? Math.abs(h.temp - gT[i]) : null)).filter((x) => x != null);
        ok(d.length > 48 && Math.max(...d) <= 1, `nws: grid temperature matches the official hourly forecast (max diff ${d.length ? Math.max(...d).toFixed(2) : "—"} °F)`);
        ok(finite(A.temperature_2m).length >= 48, `nws: grid covers at least 48 h of the model axis (${finite(A.temperature_2m).length} h)`);
        ok(A.qpf.length > 0 && A.qpf.every((x) => x.e > x.s && (x.v == null || (x.v >= 0 && x.v < 10))), "nws: QPF intervals in inches, positive durations");
        const all = C.nws.totalOver(A.qpf, A.qpf[0].s, A.qpf[A.qpf.length - 1].e);
        ok(!all.covers || Math.abs(all.lower - A.qpf.reduce((t, x) => t + (x.v || 0), 0)) < 1e-9, "nws: interval totals are not duplicated");
        ok(finite(A.wind_gusts_10m).every((x) => x < 150), "nws: gusts converted to mph");
      } else ok(false, "nws: grid data present when the point forecast loads");
      rec.nws = { office: NW.office, periods: Pd.length, errors: NW.errors };
    }

    /* ---------- winter profiles on real data ---------- */
    const WD = await D.loadModels(C.config.winterDet, { ...where, days: 2 });
    if (!providerDown(`Open-Meteo winter fields at ${P.name}`, WD.empty)) {
      /* levels below ground are excluded, so high terrain (Denver ~835 hPa at the surface) has fewer points */
      const high = (WD.models.gfs_seamless || Object.values(WD.models)[0]).elev > 1000;
      const prof = high ? { gfs_seamless: 4, ecmwf_ifs025: 3, icon_seamless: 4 } : { gfs_seamless: 8, ecmwf_ifs025: 4, icon_seamless: 8 };
      Object.keys(prof).filter((id) => WD.models[id]).forEach((id) => {
        const md = WD.models[id], rows = C.winter.series(md.h, WD.times.length, md.elev);
        const npts = WD.times.map((_, i) => C.winter.profile(md.h, i, md.elev).length);
        ok(Math.min(...npts) >= prof[id], `winter ${id}: profile has ${prof[id]}+ points every hour (min ${Math.min(...npts)})`);
        ok(rows.every((r) => r.twF == null || (r.tdF - 0.6 <= r.twF && r.twF <= r.t2F + 0.6)) && rows.some((r) => r.twF != null), `winter ${id}: wet-bulb present and between dew point and temperature`);
        ok(rows.every((r) => !r.bour || ["snow", "rain", "mix", "freezing", "sleet"].includes(r.bour.type) || (r.bour.type === null && Array.isArray(r.bour.unavailable) && r.bour.unavailable.length)), `winter ${id}: profile type from the known set, or explicitly unavailable with a coverage reason`);
      });
      ["ncep_nbm_conus"].filter((id) => WD.models[id]).forEach((id) => ok(WD.times.every((_, i) => C.winter.profile(WD.models[id].h, i, WD.models[id].elev).length <= 1), `winter ${id}: no profile, as documented`));
    }

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
  console.log(`\n${checks - fails}/${checks} live checks passed${skips ? ` · ${skips} block(s) skipped because a provider was unavailable` : ""}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

