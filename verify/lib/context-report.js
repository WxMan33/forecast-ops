/* Context layer in the scoring run: stores each capture's issue context once, rebuilds observed classes,
   splits temperature skill by condition, runs the experimental-weight protocol, and writes
   reports/CONTEXT.md and reports/context.json. Originals (raw, normalized, obs) are only read. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js");
const OBS = require("./obs.js");
const CX = require("./context.js");
const ST = require("./stratify.js");
const EX = require("./experiments.js");
const BLENDS = require("../config/blends.js");
const VERSION = "context-report-v1";

const ctxRel = (loc, cap) => `context/${loc.id}/${cap.localDate.slice(0, 4)}/${cap.captureId}.${CX.VERSION}.json`;
const recipesById = () => Object.fromEntries(BLENDS.recipes.concat(BLENDS.candidates || []).map((r) => [r.id, r]));

/* Write the issue context for one capture if it does not exist yet. Never rewrites an existing file. */
function storeIssueContext(DATA, loc, cap, bundle, obsRows, nowMs) {
  const rel = ctxRel(loc, cap), full = path.join(DATA, rel);
  if (fs.existsSync(full)) return { path: rel, existed: true, ctx: JSON.parse(fs.readFileSync(full, "utf8")) };
  const ctx = CX.issueContext(cap, bundle, obsRows, loc, recipesById(), forecastContext(DATA, cap));
  const last = bundle.retrieval && bundle.retrieval.last;
  ctx.builtAt = U.iso(nowMs);
  /* built later than the capture (backfill): every input is still issue-time evidence (the capture, its bundle,
     observation rows with firstSeenAt <= last retrieval), and the file says it was assembled afterward */
  ctx.builtAfterCapture = !!(last && nowMs - Date.parse(last) > 3600e3);
  U.mkdirp(path.dirname(full)); fs.writeFileSync(full, JSON.stringify(ctx));
  return { path: rel, existed: false, ctx };
}

/* The capture's own raw context responses (lib/context-vars.js) and its saved NWS grid, as hourly series. */
function forecastContext(DATA, cap) {
  const CV = require("./context-vars.js"), raw = (f) => { try { return U.parseJSON(U.loadRaw(DATA, f.path).toString()); } catch (e) { return null; } };
  const models = {};
  Object.entries((cap.contextVars && cap.contextVars.sources) || {}).forEach(([id, r]) => {
    const j = (r.status === "ok" || r.status === "partial") && r.file ? raw(r.file) : null;
    models[id] = { status: r.status, retrievedAt: r.retrievedAt || null, series: j && !j.error ? CV.seriesOM(j) : null };
  });
  const n = cap.sources && cap.sources.nws, g = n && n.files && n.files.grid && n.parts && n.parts.grid && n.parts.grid.status === "ok" ? raw(n.files.grid) : null;
  return { models, nws: g ? { series: CV.seriesNWS(g), retrievedAt: n.parts.grid.retrievedAt } : null, requested: !!cap.contextVars };
}

function loadBundle(DATA, rel) { try { return JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA, rel))).toString()); } catch (e) { return null; } }

function build(DATA, loc, res, nowMs, normVersion) {
  const caps = U.readJSONL(path.join(DATA, "captures", `${loc.id}.jsonl`));
  const obsRows = U.readJSONLDir(path.join(DATA, "obs", loc.id));
  const issue = {}, stored = { new: 0, existing: 0, noBundle: 0 };
  caps.forEach((cap) => {
    const rel = `normalized/${loc.id}/${cap.localDate.slice(0, 4)}/${cap.captureId}.${normVersion}.json.gz`;
    const b = fs.existsSync(path.join(DATA, rel)) ? loadBundle(DATA, rel) : null;
    if (!b || b.error) { stored.noBundle++; return; }
    const s = storeIssueContext(DATA, loc, cap, b, obsRows, nowMs); issue[cap.captureId] = s.ctx; s.existed ? stored.existing++ : stored.new++;
  });
  const best = OBS.best(obsRows), hourlyRows = obsRows.filter((r) => r.target === "temp_hourly");
  const observed = CX.observedContext(best, hourlyRows, loc);
  const tables = ST.stratify(res, issue, observed, loc), agreement = ST.regimeAgreement(res, issue, observed);
  const experiments = EX.runAll(DATA, require("../config/experiments.js"), res.pairs, issue, nowMs);
  const audit = auditArchive(caps, issue, res, obsRows, loc, nowMs);
  audit.capability = capability(caps, DATA);
  audit.contextAvailability = ctxAvailability(issue);
  audit.nightAgreement = nightAgreement(issue, observed);
  const out = { version: VERSION, contextVersion: CX.VERSION, observedVersion: CX.OBSERVED_VERSION, stratifyVersion: ST.VERSION, experimentsVersion: EX.VERSION, at: U.iso(nowMs), loc: loc.id,
    thresholds: { changeF: CX.CHANGE_F, spreadF: CX.SPREAD_F, minRankDates: ST.MIN_RANK_DATES, smallDates: ST.SMALL_DATES, presentShare: ST.PRESENT_SHARE }, stored, audit, observed, tables, agreement, experiments,
    climatePatterns: CX.CLIMATE_PATTERNS.map((p) => ({ ...p, status: "not collected" })), modelVersions: CX.MODEL_VERSIONS, gaps: gaps(audit) };
  U.mkdirp(path.join(DATA, "reports"));
  fs.writeFileSync(path.join(DATA, "reports", "context.json"), JSON.stringify(out));
  fs.writeFileSync(path.join(DATA, "reports", "CONTEXT.md"), markdown(out, loc));
  return out;
}

function auditArchive(caps, issue, res, obsRows, loc, nowMs) {
  const sched = caps.filter((c) => c.edition), manual = caps.filter((c) => !c.edition);
  const temp = res.pairs.filter((p) => p.cls === "primary" && CX.TEMP_TARGETS.includes(p.target));
  const tDates = new Set(temp.map((p) => p.date)), hourly = (res.hourlyPairs || []).filter((p) => p.cls === "primary");
  const cyc = {}; Object.values(issue).forEach((x) => Object.entries(x.sources).forEach(([id, s]) => { const k = s.cycle.status; (cyc[id] = cyc[id] || {})[k] = (cyc[id][k] || 0) + 1; }));
  const avail = Object.values(issue).filter((x) => x.edition), full = avail.filter((x) => !x.availability.missing.length).length;
  const hrs = obsRows.filter((r) => r.target === "temp_hourly").map((r) => r.time).sort((a, b) => a - b);
  let missingHours = 0; if (hrs.length) { const set = new Set(hrs); for (let t = hrs[0]; t <= hrs[hrs.length - 1]; t += 3600e3) if (!set.has(t)) missingHours++; }
  const byTarget = {}; temp.forEach((p) => { const b = (byTarget[p.target] = byTarget[p.target] || { dates: new Set(), bands: {} }); b.dates.add(p.date); (b.bands[CX.leadBand(p.lead)] = b.bands[CX.leadBand(p.lead)] || new Set()).add(p.date); });
  return {
    captures: caps.length, scheduled: sched.length, manual: manual.length,
    firstCapture: caps.map((c) => c.startedAt).sort()[0] || null, lastCapture: caps.map((c) => c.startedAt).sort().pop() || null,
    tempPrimaryPairs: temp.length, tempVerifyingDates: tDates.size, firstVerifyingDate: [...tDates].sort()[0] || null, lastVerifyingDate: [...tDates].sort().pop() || null,
    seasonsCovered: [...new Set([...tDates].map(CX.season))], monthsCovered: [...new Set([...tDates].map((d) => d.slice(0, 7)))].sort(),
    byTarget: Object.fromEntries(Object.entries(byTarget).map(([t, b]) => [t, { dates: b.dates.size, bands: Object.fromEntries(Object.entries(b.bands).map(([k, s]) => [k, s.size])) }])),
    hourlyPrimaryPairs: hourly.length, hourlyObsHours: hrs.length, hourlyObsMissingHours: missingHours, hourlyObsFrom: hrs.length ? U.iso(hrs[0]) : null,
    editionsWithEveryScheduledSource: `${full} of ${avail.length}`, cycleStatus: cyc,
    issueContexts: Object.keys(issue).length, backfilled: Object.values(issue).filter((x) => x.builtAfterCapture).length,
    retrospectiveCaptures: Object.values(issue).filter((x) => x.builtAfterCapture).map((x) => x.captureId).sort(),
    leadCoverage: leadCoverage(caps, issue, res, loc),
  };
}

/* Which sources and recipes reach each lead band, per target, from scheduled captures (primary pairs), and how
   far each source's horizon reaches. Overnight lows (tmin_night, 7p–7a) and climate-day minimums (tmin_clim)
   stay separate targets. */
function leadCoverage(caps, issue, res, loc) {
  const BANDS = ["d1-2", "d3-4", "d5-7", "d8-10", "d11+"], out = { bands: BANDS, targets: {}, horizon: {} };
  res.pairs.filter((p) => p.cls === "primary" && CX.TEMP_TARGETS.includes(p.target)).forEach((p) => {
    const b = CX.leadBand(p.lead); if (!BANDS.includes(b)) return;
    const t = (out.targets[p.target] = out.targets[p.target] || {}), x = ((t[p.id] = t[p.id] || { track: p.track }), t[p.id]);
    const c = (x[b] = x[b] || { pairs: 0, dates: new Set() }); c.pairs++; c.dates.add(p.date);
  });
  Object.values(out.targets).forEach((t) => Object.values(t).forEach((x) => BANDS.forEach((b) => { if (x[b]) x[b] = { pairs: x[b].pairs, dates: x[b].dates.size }; })));
  /* horizon: hours from the last retrieval to the source's last forecast hour, over scheduled captures */
  Object.values(issue).filter((x) => x.edition).forEach((x) => { const last = x.retrieval && Date.parse(x.retrieval.last);
    Object.entries(x.sources).forEach(([id, s]) => { if (!s.horizonEnd || !last) return; (out.horizon[id] = out.horizon[id] || []).push((Date.parse(s.horizonEnd) - last) / 3600e3); }); });
  Object.keys(out.horizon).forEach((id) => { const a = out.horizon[id].sort((p, q) => p - q); out.horizon[id] = { captures: a.length, minH: Math.round(a[0]), medianH: Math.round(a[Math.floor(a.length / 2)]), reachesDay10: a.filter((h) => h >= 10 * 24).length }; });
  return out;
}

/* Capability per source for the optional context variables, from what the collector actually received:
   status counts, units, and how far each variable reached (hours after retrieval), over scheduled captures. */
function capability(caps, DATA) {
  const CV = require("./context-vars.js"), out = {};
  caps.filter((c) => c.edition && c.contextVars).forEach((c) => Object.entries(c.contextVars.sources || {}).forEach(([id, r]) => {
    const x = (out[id] = out[id] || { requested: 0, status: {}, vars: {} }); x.requested++; x.status[r.status] = (x.status[r.status] || 0) + 1;
    CV.VARS.forEach((v) => { const f = r.fields && r.fields[v], y = (x.vars[v] = x.vars[v] || { present: 0, units: new Set(), reachH: [] }); if (!f) return;
      if (f.present && f.nonNull) { y.present++; if (f.unit) y.units.add(f.unit); if (f.lastNonNull && r.retrievedAt) y.reachH.push((Date.parse(f.lastNonNull) - Date.parse(r.retrievedAt)) / 3600e3); } });
  }));
  /* NWS from the saved grids (no extra request): units as the grid states them */
  const nws = { requested: 0, status: {}, vars: {}, note: "from the gridpoint response every capture already saves" };
  caps.filter((c) => c.edition && c.sources && c.sources.nws && c.sources.nws.parts && c.sources.nws.parts.grid).slice(-6).forEach((c) => {
    const n = c.sources.nws, ok = n.parts.grid.status === "ok"; nws.requested++; nws.status[ok ? "ok" : "failed"] = (nws.status[ok ? "ok" : "failed"] || 0) + 1; if (!ok) return;
    let g = null; try { g = U.parseJSON(U.loadRaw(DATA, n.files.grid.path).toString()); } catch (e) { return; }
    const p = (g && g.properties) || {};
    [["cloud_cover", "skyCover"], ["wind_speed_10m", "windSpeed"], ["wind_direction_10m", "windDirection"], ["dew_point_2m", "dewpoint"]].forEach(([v, f]) => {
      const y = (nws.vars[v] = nws.vars[v] || { present: 0, units: new Set(), reachH: [] }), vals = p[f] && p[f].values; if (!vals || !vals.length) return;
      y.present++; if (p[f].uom) y.units.add(p[f].uom);
      const last = vals[vals.length - 1].validTime.split("/"), mm = /P(?:(\d+)D)?T?(?:(\d+)H)?/.exec(last[1] || "") || [], end = Date.parse(last[0]) + ((+(mm[1] || 0)) * 24 + (+(mm[2] || 0))) * 3600e3;
      y.reachH.push((end - Date.parse(n.parts.grid.retrievedAt)) / 3600e3); });
  });
  if (nws.requested) out.nws = nws;
  Object.values(out).forEach((x) => Object.values(x.vars).forEach((y) => { const a = y.reachH.sort((p, q) => p - q); y.units = [...y.units]; y.reachMedianH = a.length ? Math.round(a[Math.floor(a.length / 2)]) : null; y.reachMinH = a.length ? Math.round(a[0]) : null; delete y.reachH; }));
  return out;
}
/* Per source, variable and lead day 1–10: in how many scheduled captures every hour of that local day was present. */
function ctxAvailability(issue) {
  const out = {};
  Object.values(issue).filter((x) => x.edition && x.contextAvailability).forEach((x) => Object.entries(x.contextAvailability.sources || {}).forEach(([id, vars]) => Object.entries(vars).forEach(([k, arr]) => {
    const y = (((out[id] = out[id] || {})[k] = out[id][k] || { captures: 0, notCollected: 0, byLead: Array(10).fill(0) }));
    if (!arr) { y.notCollected++; return; } y.captures++; arr.forEach((ok, i) => { if (ok) y.byLead[i]++; });
  })));
  return out;
}
/* Forecast night class at issue (NWS grid, model consensus) vs the observed night afterward. */
function nightAgreement(issue, observed) {
  const out = { nws: {}, consensus: {} };
  Object.values(issue).filter((x) => x.edition && x.forecastNight && x.forecastNight.nights).forEach((x) => Object.entries(x.forecastNight.nights).forEach(([d, n]) => {
    const o = observed[d] && observed[d].nightAfter && observed[d].nightAfter.cls; if (!o || o === "unknown") return;
    const lead = Math.round((Date.parse(d) - Date.parse(x.captureId.slice(0, 10))) / 86400e3), band = CX.leadBand(lead);
    [["nws", n.nws && n.nws.cls], ["consensus", n.consensus && n.consensus.cls]].forEach(([k, f]) => { if (!f || /unknown|not /.test(f)) return;
      const t = (out[k][band] = out[k][band] || { cells: {}, dates: new Set(), retrospective: 0, cases: 0 }); const c = `${f} → ${o}`; t.cells[c] = (t.cells[c] || 0) + 1; t.dates.add(d); t.cases++; if (x.builtAfterCapture) t.retrospective++; });
  }));
  Object.values(out).forEach((m) => Object.values(m).forEach((t) => { t.dates = t.dates.size; t.flag = ST.flagFor(t.dates); }));
  return out;
}

/* Context-layer health for STATUS.md: failures are shown, never hidden, and never stop collection or scoring. */
function statusSection(caps, result, error) {
  const L = ["", "## Context layer", ""];
  if (error) L.push(`**Context report FAILED this run** (collection and scoring continued): ${String(error).split("\n")[0].slice(0, 300)}`, "");
  const capFail = caps.filter((c) => c.context && c.context.error), noCtx = caps.filter((c) => c.edition && !(c.context && c.context.path));
  const lastCv = caps.filter((c) => c.contextVars).pop();
  if (lastCv) { const st = {}; Object.values(lastCv.contextVars.sources || {}).forEach((r) => (st[r.status] = (st[r.status] || 0) + 1));
    L.push(`Forecast cloud/wind/dewpoint (optional; never blocks collection), latest capture ${lastCv.captureId}: ${lastCv.contextVars.error ? `FAILED (${lastCv.contextVars.error})` : Object.entries(st).map(([k, n]) => `${k} ${n}`).join(", ")}${Object.values(lastCv.contextVars.sources || {}).some((r) => r.missing && r.missing.length) ? ` · missing fields: ${Object.entries(lastCv.contextVars.sources).filter(([, r]) => r.missing && r.missing.length).map(([id, r]) => `${id} ${r.missing.join("/")}`).join("; ")}` : ""}`, ""); }
  if (capFail.length) L.push(`Issue context failed at capture for ${capFail.length}: ${capFail.slice(-5).map((c) => `${c.captureId} (${c.context.error.slice(0, 120)})`).join("; ")}`, "");
  if (result) {
    const a = result.audit;
    L.push(`- Issue contexts: ${a.issueContexts} (${result.stored.new} new this run). ${a.backfilled} were assembled after their capture from issue-time evidence and are labelled retrospective; ${noCtx.length} scheduled captures predate capture-time context.`,
      `- Condition cells: ${result.tables.length}. Experiments: ${result.experiments.map((e) => `${e.id} ${e.status}`).join("; ")}.`, `- Details: reports/CONTEXT.md`);
  } else if (!error) L.push("- Not run.");
  return L.join("\n") + "\n";
}

/* Prioritized collection gaps. Static judgments, with this run's numbers where they apply. */
function gaps(a) {
  return [
    { priority: 1, gap: "Sample length", now: `${a.tempVerifyingDates} verifying dates (${a.firstVerifyingDate} to ${a.lastVerifyingDate}), seasons: ${a.seasonsCovered.join(", ") || "none"}`, need: "30+ distinct dates per condition before any cell can rank sources; 60 training plus 60 later dates before an experimental fit can be judged; a full year before season-by-season comparisons", action: "Keep both daily captures running without gaps. Nothing to change; time is the constraint." },
    { priority: 2, gap: "Forecast cloud cover, wind and dewpoint at issue (next collection priority)", now: "Model requests save hourly temperature, precipitation and snowfall only. NWS grids already include sky cover, wind and dewpoint", need: "Classifying clear/calm and windy nights from what the forecast said before the night, to investigate the warm lows on radiational nights and cold lows on windy nights that the observed classes show", action: "Add cloud_cover, wind_speed_10m, wind_direction_10m and dew_point_2m to the deterministic-model requests after each model is confirmed to accept them. A 2026-11-15 check confirmed 6 of 11 (RRFS, JMA, GFS, GEM, Météo-France, UKMO); ECMWF IFS, AIFS, NBM, HRRR and ICON were not checked because Open-Meteo's daily limit for that machine was reached. Then add issue-basis night classes from both models and NWS grids. Ensemble requests stay as they are (cost). Sea-level pressure and 850 hPa temperature follow later." },
    { priority: 3, gap: "Climate-pattern indices as published", now: "Not collected", need: "ENSO (ONI), AO, NAO, PNA and MJO values stored as published, with publication times and revisions, so a future analysis uses only values public at issue", action: "Start a daily snapshot of NOAA CPC index pages now: as-published values cannot be reconstructed later. Analyse only after several seasons per phase; no relationships are inferred before then." },
    { priority: 4, gap: "Confirmed model cycle per response", now: `Open-Meteo responses do not state their run; the archive keeps the latest run reported by model metadata (status "provider-reported"), never a confirmed cycle`, need: "The run behind each forecast, to compare like cycles and to measure model latency", action: "Evaluate Open-Meteo's single-run API (requests naming an explicit initialisation time) for the deterministic models, as a parallel capture before replacing anything." },
    { priority: 5, gap: "Model versions", now: "No provider reports a model version; the version registry (lib/context.js MODEL_VERSIONS) is empty", need: "Dated upgrade entries (e.g. GFS, ECMWF IFS cycle, NBM version) so comparisons can be split at an upgrade", action: "Enter upgrades from official notices with their source and effective date; never guessed." },
    { priority: 6, gap: "Observed pattern classes", now: "Derived afterward: day-to-day change, wet/dry, night sky and wind from METAR", need: "Frontal passage, cold-air damming and snow cover, which strongly affect temperature errors", action: "Derive frontal passages from METAR wind shifts and pressure tendency (all saved in raw METARs). Snow depth is in GHCN-Daily; add it to the observation parser." },
    { priority: 7, gap: "One location", now: "CVG only", need: "Pattern-dependent skill does not transfer between climates", action: "Add sites only after CVG's pipeline has a full season; score them relative to local benchmarks." },
    { priority: 8, gap: "Hourly observation continuity", now: `${a.hourlyObsHours} hourly observations from ${a.hourlyObsFrom || "—"}, ${a.hourlyObsMissingHours} missing hours inside that span`, need: "Every hour, for day/night error splits", action: "The observation fetch already re-reads 10 days, so short outages refill; missing hours stay missing (never interpolated)." },
  ];
}

/* ---------- markdown ---------- */
const f1 = (x) => (x == null ? "—" : (Math.round(x * 10) / 10).toFixed(1));
const sgn = (x) => (x == null ? "—" : (x > 0 ? "+" : "") + f1(x));
const KEY = { blends: ["baseline-v1", "brad-default-2026-11-03-v2", "brad-scoped-temp-2026-11-05-v3", "nbm-only", "nws-only"], sources: ["nws", "ncep_nbm_conus", "ecmwf_ens", "ecmwf_ifs025", "gfs_seamless"] };
const SHORT = { "baseline-v1": "Baseline v1", "brad-custom-2026-11-03-v1": "Custom v1", "brad-default-2026-11-03-v2": "Default v2", "brad-scoped-default-2026-11-04-v2": "Scoped v2", "brad-scoped-temp-2026-11-05-v3": "Temp-tuned v3", "equal-raw-v1": "Equal raw", "ecmwf-ens-only": "ECMWF ENS only", "gefs-only": "GEFS only", "nbm-only": "NBM only", "nws-only": "NWS only",
  nws: "NWS", "nws-official": "NWS official", ncep_nbm_conus: "NBM", ecmwf_ens: "ECMWF ENS", gefs: "GEFS", ecmwf_ifs025: "ECMWF IFS", ecmwf_aifs025_single: "AIFS", gfs_seamless: "GFS", icon_seamless: "ICON", gem_seamless: "GEM", ukmo_seamless: "UKMO", jma_seamless: "JMA", meteofrance_seamless: "Météo-France", gfs_hrrr: "HRRR", ncep_rrfs_conus: "RRFS", rrfs_ens: "RRFS ens", ncep_nam_conus: "NAM" };
const nm = (id) => SHORT[id] || id;
const TLABEL = { tmax_clim: "Daily high (climate day)", tmin_clim: "Daily low (climate day)", tmax_day: "Daytime high 7a–7p", tmin_night: "Overnight low 7p–7a", temp_hourly: "Hourly temperature" };
const BAND_ORDER = ["d0", "0-12 h", "12-24 h", "24-48 h", "48-72 h", "3-7 d", "7-10 d", "10 d+", "d1-2", "d3-4", "d5-7", "d8-10", "d11+"];

function markdown(o, loc) {
  const a = o.audit, L = [];
  L.push(`# Temperature verification by condition · ${loc.id}`, "", `Updated ${o.at} (private, internal; generated by verify/lib/context-report.js · ${o.contextVersion}, ${o.observedVersion}, ${o.stratifyVersion})`, "");
  L.push("**Read this first.** Every number below is descriptive. The archive is short, so most cells are flagged as too few dates or a small sample. Cells below " + o.thresholds.minRankDates + " distinct dates never name a lowest error. Verdicts (better or worse than Baseline v1) come only from the matched comparisons in SCORECARD.md, which need 30+ dates and a block-bootstrap interval. No production weights change from this report.", "");
  L.push("## What each case carries", "", "| Basis | When it is known | Contents |", "|---|---|---|",
    "| target | Before issue | Valid date, month, season, lead, capture slot, local day/night hour |",
    "| issue | At retrieval, stored once per capture in `context/` and never rewritten | Source status and HTTP code, retrieval times, provider-reported cycle and its status, NWS grid update time, recipe weights requested and actually used, missing sources, code and normalizer versions, the forecast's own change from the previous day and ECMWF ENS spread, the latest climate-day observation the archive had ingested before retrieval |",
    "| observed | Afterward, rebuilt every run because observations are revised | Observed change from the previous day, wet/dry, night sky and wind from METAR |", "",
    `Observed classes explain errors. They are never allowed to choose weights at issue time; the experiment runner refuses them. Thresholds were fixed by definition before looking at errors: change ±${o.thresholds.changeF} °F; ECMWF ENS 10–90 % width < ${o.thresholds.spreadF[0]}, ${o.thresholds.spreadF[0]}–${o.thresholds.spreadF[1]}, > ${o.thresholds.spreadF[1]} °F; a night is radiational when two thirds of its routine reports are clear or few with wind ≤ 5 kt.`, "");
  L.push("## Archive audit", "",
    `- Captures: ${a.captures} (${a.scheduled} scheduled, ${a.manual} manual pilot), ${a.firstCapture} to ${a.lastCapture}.`,
    `- Issue contexts stored: ${a.issueContexts} (${o.stored.new} new this run). **Retrospective:** ${a.backfilled} were assembled after their capture, from that capture, its bundle and observations already ingested at its retrieval; issue-basis rows say how many of their cases rely on them${a.retrospectiveCaptures.length ? ` (${a.retrospectiveCaptures[0]} to ${a.retrospectiveCaptures[a.retrospectiveCaptures.length - 1]})` : ""}.`,
    `- Scheduled editions with every source on time: ${a.editionsWithEveryScheduledSource}.`,
    `- Primary temperature pairs: ${a.tempPrimaryPairs} on ${a.tempVerifyingDates} verifying dates (${a.firstVerifyingDate} to ${a.lastVerifyingDate}); months ${a.monthsCovered.join(", ")}; seasons ${a.seasonsCovered.join(", ")}.`,
    `- Hourly temperature pairs: ${a.hourlyPrimaryPairs}; ${a.hourlyObsHours} hourly observations since ${a.hourlyObsFrom}, ${a.hourlyObsMissingHours} missing hours.`, "",
    "| Target | Verifying dates | By lead band (dates) |", "|---|---|---|",
    ...Object.entries(a.byTarget).map(([t, b]) => `| ${TLABEL[t] || t} | ${b.dates} | ${BAND_ORDER.filter((k) => b.bands[k]).map((k) => `${k}: ${b.bands[k]}`).join(" · ")} |`), "",
    "Provider-reported cycle status by source (captures): " + Object.entries(a.cycleStatus).map(([id, c]) => `${nm(id)} ${Object.entries(c).map(([k, n]) => `${k} ${n}`).join("/")}`).join("; ") + ".", "");
  const lc = a.leadCoverage;
  if (lc) {
    L.push("## Coverage by lead, through days 8–10", "", "Primary (scheduled, on-time) pairs and distinct verifying dates per lead band. Overnight lows (7p–7a) and climate-day minimums are separate targets and are never pooled.", "");
    Object.keys(lc.targets).sort((x, y) => CX.TEMP_TARGETS.indexOf(x) - CX.TEMP_TARGETS.indexOf(y)).forEach((t) => {
      const rows = Object.entries(lc.targets[t]).sort((x, y) => (x[1].track + x[0]).localeCompare(y[1].track + y[0]));
      L.push(`### ${TLABEL[t]}`, "", `| Source or recipe | ${lc.bands.join(" | ")} |`, `|---|${lc.bands.map(() => "---|").join("")}`,
        ...rows.map(([id, x]) => `| ${nm(id)}${x.track === "blend" ? " (recipe)" : x.track === "tv" ? " (TV pilot, private)" : ""} | ${lc.bands.map((b) => (x[b] ? `${x[b].pairs} / ${x[b].dates} d` : "—")).join(" | ")} |`));
      const m = o.tables.filter((c) => c.kind === "daily" && c.target === t && c.band === "d8-10" && c.dim === "all");
      m.forEach((c) => L.push("", `Days 8–10 matched ${c.set}: ${c.cases} cases on ${c.dates} dates, members ${c.membersUsed.map(nm).join(", ")}${c.membersLeftOut.length ? `; left out for short coverage: ${c.membersLeftOut.map(nm).join(", ")}` : ""}.`));
      if (!m.length) L.push("", "Days 8–10: no matched set (fewer than two members with enough cases).");
      L.push("");
    });
    L.push("Source horizon from the last retrieval (scheduled captures): " + Object.entries(lc.horizon).sort((x, y) => y[1].medianH - x[1].medianH).map(([id, h]) => `${nm(id)} median ${h.medianH} h (min ${h.minH}), reaches day 10 in ${h.reachesDay10}/${h.captures}`).join("; ") + ".", "");
  }
  /* forecast context variables: capability, per-lead availability, forecast vs observed nights */
  const VN = { cloud_cover: "Cloud cover", wind_speed_10m: "Wind 10 m", wind_direction_10m: "Wind direction", dew_point_2m: "Dewpoint" }, KN = { temp: "Temperature", cloud: "Cloud cover", wind: "Wind 10 m", dir: "Wind direction", dew: "Dewpoint" };
  L.push("## Forecast cloud cover, wind and dewpoint (issue-time context)", "", "Collected by a separate, optional request per deterministic model (one attempt each; the first HTTP 429 stops the rest for that capture), saved as received; NWS values come from the grid each capture already saves. The primary temperature and precipitation requests are unchanged. A variable shows as not available when our collection did not receive it, which says nothing about whether the provider can produce it.", "");
  const cap = a.capability || {};
  if (!Object.keys(cap).length) L.push("No capture has requested these variables yet.", "");
  else {
    L.push("### Capability as received", "", "| Source | Requests (status) | " + Object.values(VN).join(" | ") + " |", "|---|---|" + Object.keys(VN).map(() => "---|").join(""),
      ...Object.entries(cap).map(([id, x]) => `| ${nm(id)} | ${x.requested}${x.note ? " grids" : ""} (${Object.entries(x.status).map(([k, n]) => `${k} ${n}`).join(", ")}) | ${Object.keys(VN).map((v) => { const y = x.vars[v]; return !y || !y.present ? "not available in our current collection" : `${y.units.join("/") || "unit not stated"} · to ${y.reachMedianH} h (min ${y.reachMinH})`; }).join(" | ")} |`), "");
  }
  const av = a.contextAvailability || {};
  if (Object.keys(av).length) {
    const leads = Array.from({ length: 10 }, (_, k) => k + 1);
    L.push("### Availability by lead day (every hour of the local day present; scheduled captures)", "", "Each cell: captures with the whole day present / captures where the variable was collected. Leads 8, 9 and 10 are separate columns. † not available in our current collection (not a statement that the model never reaches that lead).", "",
      `| Source | Variable | ${leads.map((l) => `d${l}`).join(" | ")} | Not collected |`, `|---|---|${leads.map(() => "---|").join("")}---|`);
    Object.entries(av).sort((x, y) => x[0].localeCompare(y[0])).forEach(([id, vars]) => ["temp", "cloud", "wind", "dew"].forEach((k) => { const y = vars[k]; if (!y) return;
      L.push(`| ${nm(id)} | ${KN[k]} | ${y.byLead.map((n) => (y.captures ? (n ? `${n}/${y.captures}` : `0/${y.captures} †`) : "—")).join(" | ")} | ${y.notCollected} |`); }));
    L.push("");
  }
  const na = a.nightAgreement || {};
  L.push("### Forecast night at issue vs observed night", "", "Forecast classes (forecast-night-v1, fixed before any errors were examined): clear/calm when two thirds of the night's hours have cloud cover ≤ 25 % and wind ≤ 6 mph; windy when mean wind ≥ 12 mph; cloudy when two thirds have cloud cover ≥ 63 %; otherwise mixed; any missing hour is unknown. Observed classes come from METAR afterward and are kept separate.", "",
    "| Forecast by | Lead | Dates | Forecast → observed (cases) | Flag |", "|---|---|---|---|---|");
  ["nws", "consensus"].forEach((k) => BAND_ORDER.forEach((b) => { const t = (na[k] || {})[b]; if (t) L.push(`| ${k === "nws" ? "NWS grid" : "Model consensus"} | ${b} | ${t.dates} | ${Object.entries(t.cells).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c}: ${n}`).join("; ")} | ${t.flag}${t.retrospective ? ` · ${t.retrospective} of ${t.cases} from retrospective issue context` : ""} |`); }));
  if (!Object.keys(na.nws || {}).length && !Object.keys(na.consensus || {}).length) L.push("| — | — | 0 | no forecast nights with observations yet | — |");
  L.push("");
  const sec = (kind, title) => {
    L.push(`## ${title}`, "");
    const ts = o.tables.filter((t) => t.kind === kind);
    [...new Set(ts.map((t) => t.target))].forEach((target) => BAND_ORDER.forEach((band) => ["blends", "sources"].forEach((set) => {
      const cell = ts.filter((t) => t.target === target && t.band === band && t.set === set); if (!cell.length) return;
      const keys = KEY[set].filter((k) => cell[0].membersUsed.includes(k));
      L.push(`### ${TLABEL[target] || target} · ${band} · ${set === "blends" ? "OPE recipes and benchmarks" : "individual sources"}`, "",
        `Matched cases (every member listed has the value): ${cell[0].membersUsed.map(nm).join(", ")}${cell[0].membersLeftOut.length ? `. Left out for short coverage: ${cell[0].membersLeftOut.map(nm).join(", ")}` : ""}. MAE °F (bias).`, "",
        `| Condition | Basis | Cases | Dates | ${keys.map(nm).join(" | ")} | Lowest MAE | Flag |`, `|---|---|---|---|${keys.map(() => "---|").join("")}---|---|`);
      const allN = (cell.find((c) => c.dim === "all") || {}).cases;
      /* a dimension with one class covering every case repeats the All row; it stays in context.json */
      const redundant = new Set([...new Set(cell.map((c) => c.dim))].filter((d) => d !== "all" && cell.filter((c) => c.dim === d).length === 1 && cell.find((c) => c.dim === d).cases === allN));
      cell.filter((c) => !redundant.has(c.dim)).forEach((c) => L.push(`| ${c.dim === "all" ? "**All**" : `${c.dim}: ${c.cls}`} | ${c.basis} | ${c.cases} | ${c.dates} | ${keys.map((k) => `${f1(c.members[k].mae)} (${sgn(c.members[k].bias)})`).join(" | ")} | ${c.lowestMAE ? `${nm(c.lowestMAE)} ${f1(c.members[c.lowestMAE].mae)}` : "—"} | ${c.flag}${c.basis === "issue" && c.retrospectiveContextCases ? ` · ${c.retrospectiveContextCases} of ${c.cases} cases from retrospective issue context` : ""} |`));
      L.push("");
    })));
  };
  sec("daily", "Daily highs and lows by condition");
  sec("hourly", "Hourly temperature: daytime vs overnight");
  L.push("## Forecast change at issue vs observed change", "", `Reference recipe ${CX.REF_RECIPE}: how often a forecast warmup or cooldown (issue basis) matched the observed change (observed basis). Counts are capture-date cases.`, "",
    "| Target | Lead | Dates | Forecast → observed (cases) | Flag |", "|---|---|---|---|---|",
    ...o.agreement.slice().sort((x, y) => x.target.localeCompare(y.target) || BAND_ORDER.indexOf(x.band) - BAND_ORDER.indexOf(y.band)).map((t) => `| ${TLABEL[t.target]} | ${t.band} | ${t.dates} | ${Object.entries(t.cells).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}: ${n}`).join("; ")} | ${t.flag} |`), "");
  L.push("## Experimental weights (never defaults)", "", "Each experiment is fitted once, on earlier dates, after its training cases reach the required distinct dates; it is then judged only on cases from later captures beyond an embargo. Promotion still needs the rules in verify/README.md and a recorded decision.", "",
    "| Experiment | Status | Detail |", "|---|---|---|",
    ...o.experiments.map((e) => `| ${e.label || e.id} | ${e.status} | ${e.have ? e.have.map((h) => `${h.cls}: ${h.dates} of ${e.need} dates${h.dates ? "" : " (absent)"}`).join("; ") + (e.casesOutsideClasses ? `; ${e.casesOutsideClasses} cases outside the named classes` : "") + `. Fallback meanwhile: ${e.fallback}` : e.results ? Object.entries(e.results).map(([k, r]) => `${k}: ${r.status}${r.evalDates != null ? ` (${r.evalDates} dates)` : ""}`).join("; ") : e.fittedAt ? `fitted ${e.fittedAt}` : ""} |`), "");
  L.push("## Climate patterns (reserved)", "", "Not collected. Each index, when collected, is stored as published with its publication time, so an analysis uses only values public at issue. With fewer than several seasons per phase, no relationship between these patterns and forecast skill is inferred.", "",
    "| Pattern | Cadence | Source | Status |", "|---|---|---|---|", ...o.climatePatterns.map((p) => `| ${p.label} | ${p.cadence} | ${p.source} | ${p.status} |`), "");
  L.push("## Collection gaps, in priority order", "", "| # | Gap | Now | Needed for | Next step |", "|---|---|---|---|---|", ...o.gaps.map((g) => `| ${g.priority} | ${g.gap} | ${g.now} | ${g.need} | ${g.action} |`), "");
  return L.join("\n");
}
module.exports = { VERSION, build, storeIssueContext, forecastContext, capability, ctxAvailability, nightAgreement, auditArchive, leadCoverage, statusSection, gaps, markdown, ctxRel };
