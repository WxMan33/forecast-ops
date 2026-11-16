/* Temperature skill by condition: matched cases split by target-basis, issue-basis and observed-basis
   classes (lib/context.js). Descriptive only. Every cell shows its cases, distinct dates and 7-day blocks;
   cells with few dates are flagged, and no cell ranks members below MIN_RANK_DATES. Pairwise verdicts
   remain the job of the matched comparisons in lib/score.js (30+ dates and a block-bootstrap interval).
   Observed-basis classes describe the weather that happened. They help explain errors but can never select
   weights at issue time; only target- and issue-basis classes can feed an experimental recipe. */
"use strict";
const CX = require("./context.js");
const VERSION = "stratify-v1";
const MIN_RANK_DATES = 10; // below this, a cell shows counts and errors but no ordering
const SMALL_DATES = 30;    // below this, a cell is a small sample: descriptive only
const PRESENT_SHARE = 0.8; // a member joins a target/lead cell when it has at least this share of the cell's cases
const SETS = {
  blends: ["baseline-v1", "brad-default-2026-11-03-v2", "brad-scoped-default-2026-11-04-v2", "brad-scoped-temp-2026-11-05-v3", "equal-raw-v1", "ecmwf-ens-only", "gefs-only", "nbm-only", "nws-only"],
  sources: ["ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless", "icon_seamless", "gem_seamless", "ukmo_seamless", "jma_seamless", "meteofrance_seamless", "ncep_nbm_conus", "gfs_hrrr", "ncep_rrfs_conus", "ecmwf_ens", "gefs", "rrfs_ens", "nws", "nws-official"],
};
const block = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / (7 * 86400e3));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const flagFor = (dates) => (dates < MIN_RANK_DATES ? "too few dates to compare" : dates < SMALL_DATES ? "small sample: descriptive only" : "descriptive (verdicts only in matched comparisons)");

/* Dimensions: [id, basis, label, fn(case) -> class or null when not applicable] */
function dims(issue, observed, loc) {
  const imp = (c) => { const x = issue[c.captureId]; return x && x.implied.byTarget[c.target] && x.implied.byTarget[c.target][c.date]; };
  const obs = (c) => observed[c.date];
  const isMax = (c) => /^tmax/.test(c.target);
  return [
    ["all", "target", "All cases", () => "all"],
    ["season", "target", "Season of the valid date", (c) => CX.season(c.date)],
    ["month", "target", "Month of the valid date", (c) => c.date.slice(0, 7)],
    ["slot", "target", "Capture slot", (c) => c.slot],
    ["dayNight", "target", "Local standard hour 7a–7p vs night (hourly)", (c) => (c.valid ? CX.dayNight(Date.parse(c.valid), loc) : null)],
    ["forecastChange", "issue", `Forecast's own change from the previous day (${CX.REF_RECIPE}, ±${CX.CHANGE_F} °F)`, (c) => { const x = imp(c); return x ? x.changeClass : null; }],
    ["ensSpread", "issue", `ECMWF ENS 10–90 % width (< ${CX.SPREAD_F[0]}, ${CX.SPREAD_F[0]}–${CX.SPREAD_F[1]}, > ${CX.SPREAD_F[1]} °F)`, (c) => { const x = imp(c); return x ? x.spreadClass : null; }],
    ["availability", "issue", "Sources available at issue", (c) => { const x = issue[c.captureId]; return x ? (x.availability.missing.length ? "some missing" : "all available") : null; }],
    ["observedChange", "observed", `Observed change from the previous day (±${CX.CHANGE_F} °F)`, (c) => { const o = obs(c); return o ? (isMax(c) ? o.tmaxClass : o.tminClass) : null; }],
    ["wet", "observed", "Observed climate-day precipitation", (c) => { const o = obs(c); return o && o.wet != null ? (o.wet ? "wet" : "dry") : null; }],
    ["night", "observed", "Observed night (METAR sky and wind)", (c) => { const o = obs(c); if (!o) return null; return c.target === "tmin_night" ? o.nightAfter.cls : c.target === "tmin_clim" ? o.nightBefore.cls : null; }],
  ];
}

/* Daily temperature cases (primary pairs) and hourly cases (primary hourly pairs) in one shape. */
function caseList(res, loc) {
  const lstDate = (iso) => new Date(Date.parse(iso) + loc.lstOffsetMin * 60e3).toISOString().slice(0, 10);
  const daily = res.pairs.filter((p) => p.cls === "primary" && CX.TEMP_TARGETS.includes(p.target)).map((p) => ({ key: `${p.captureId}|${p.date}`, captureId: p.captureId, slot: p.slot, target: p.target, date: p.date, band: CX.leadBand(p.lead), id: p.id, v: p.v, o: p.o }));
  const hourly = (res.hourlyPairs || []).filter((p) => p.cls === "primary").map((p) => ({ key: `${p.captureId}|${p.valid}`, captureId: p.captureId, slot: p.slot, target: "temp_hourly", valid: p.valid, date: lstDate(p.valid), band: CX.hourBand(p.leadHours), id: p.id.replace(/^blend:/, ""), v: p.v, o: p.o }));
  return { daily, hourly };
}

function cellStats(rows, members, dateOf) {
  const dates = new Set(rows.map(dateOf)), out = { cases: rows.length, dates: dates.size, blocks7d: new Set([...dates].map(block)).size };
  out.flag = flagFor(out.dates);
  /* cases whose issue context was assembled after the capture (from issue-time evidence only): labelled, never hidden */
  out.retrospectiveContextCases = rows.filter((r) => r.__retro).length;
  out.members = Object.fromEntries(members.map((m) => { const e = rows.map((r) => r.v[m] - r.o); return [m, { mae: r2(mean(e.map(Math.abs))), bias: r2(mean(e)), within2: r2(mean(e.map((x) => (Math.abs(x) <= 2 ? 1 : 0)))) }]; }));
  if (out.dates >= MIN_RANK_DATES) out.lowestMAE = members.slice().sort((a, b) => out.members[a].mae - out.members[b].mae)[0];
  return out;
}

function stratify(res, issue, observed, loc) {
  const { daily, hourly } = caseList(res, loc), D = dims(issue, observed, loc), tables = [];
  const run = (cases, kind) => {
    const byCell = new Map();
    cases.forEach((c) => { const k = `${c.target}|${c.band}`; (byCell.get(k) || byCell.set(k, []).get(k)).push(c); });
    byCell.forEach((cs, k) => {
      const [target, band] = k.split("|");
      Object.entries(SETS).forEach(([setId, ids]) => {
        /* rows keyed by capture and valid date/hour */
        const rows = new Map();
        cs.filter((c) => ids.includes(c.id)).forEach((c) => { const r = rows.get(c.key) || rows.set(c.key, { ...c, v: {}, __retro: !!(issue[c.captureId] && issue[c.captureId].builtAfterCapture) }).get(c.key); r.v[c.id] = c.v; });
        const all = [...rows.values()]; if (!all.length) return;
        const members = ids.filter((m) => all.filter((r) => r.v[m] != null).length >= PRESENT_SHARE * all.length);
        if (members.length < 2) return;
        const matched = all.filter((r) => members.every((m) => r.v[m] != null));
        const dateOf = (r) => r.date;
        D.forEach(([dim, basis, label, fn]) => {
          const groups = new Map();
          matched.forEach((r) => { const cl = fn(r); if (cl == null) return; (groups.get(cl) || groups.set(cl, []).get(cl)).push(r); });
          if (!groups.size || (dim === "all" ? false : groups.size === 1 && [...groups.keys()][0] === "unknown")) return;
          groups.forEach((g, cl) => tables.push({ kind, set: setId, target, band, dim, basis, dimLabel: label, cls: cl, membersUsed: members, membersLeftOut: ids.filter((m) => !members.includes(m) && all.some((r) => r.v[m] != null)), ...cellStats(g, members, dateOf) }));
        });
      });
    });
  };
  run(daily, "daily"); run(hourly, "hourly");
  return tables;
}

/* Forecast class at issue vs observed class afterward, for the reference recipe (distinct capture-date cases). */
function regimeAgreement(res, issue, observed) {
  const out = {};
  res.pairs.filter((p) => p.cls === "primary" && p.id === CX.REF_RECIPE && CX.TEMP_TARGETS.includes(p.target)).forEach((p) => {
    const x = issue[p.captureId], f = x && x.implied.byTarget[p.target] && x.implied.byTarget[p.target][p.date], o = observed[p.date];
    if (!f || !o) return;
    const oc = /^tmax/.test(p.target) ? o.tmaxClass : o.tminClass, k = `${p.target}|${CX.leadBand(p.lead)}`;
    const t = (out[k] = out[k] || { target: p.target, band: CX.leadBand(p.lead), cells: {}, dates: new Set() });
    const c = `${f.changeClass} → ${oc}`; t.cells[c] = (t.cells[c] || 0) + 1; t.dates.add(p.date);
  });
  return Object.values(out).map((t) => ({ ...t, dates: t.dates.size, flag: flagFor(t.dates.size) }));
}

module.exports = { VERSION, SETS, MIN_RANK_DATES, SMALL_DATES, PRESENT_SHARE, stratify, regimeAgreement, caseList, flagFor };
