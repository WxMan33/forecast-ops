/* Climate-pattern indices archived AS PUBLISHED (climidx-v1), so a future seasonal or ENSO comparison can use
   only values that were public when each forecast was issued.
   - Once per UTC day, during the observation job; one attempt per index per day, whatever its outcome (v2;
     v1 retried after an ordinary failure); a 429 or 403 stops further requests to that host for the day. Failures are logged and never affect observations or scoring.
   - Every retrieval is logged with its time, HTTP status, the server's Last-Modified header (labelled as the
     server's modification time, NOT an official issue time) and the SHA-256 of the body.
   - The body is saved as received whenever it differs from the last saved copy, so each published version
     is kept; revisions (e.g. ONI updates of earlier seasons) appear as new versions, never as edits.
   - Three times are kept apart: the RETRIEVAL time (ours), the VALID period of the latest value (from the
     data), and the OFFICIAL publication time, which these files do not state and so stays null. The
     earliest PROVEN availability of a version is its first retrieval by us; Last-Modified is never used to
     backdate availability. availableAt() returns the version a capture at a given time could have used.
   - The latest row is parsed only for display. A format the parser does not recognise is "unparsed"; the raw
     file still counts as the evidence. Nothing here relates these indices to forecast skill.
   climidx-v2 (2026-11-17):
   - An index can be disabled. A disabled index is never requested; its earlier records (the BoM RMM HTTP 403
     of 2026-11-16) stay as they were and its values stay missing.
   - The MJO is archived as NOAA PSL's ROMI, a DIFFERENT index from the Wheeler-Hendon RMM, under its own id
     (mjo-romi), so the two definitions are never mixed. Its definition and comparability note travel with
     every record.
   - Rows with missing values are counted and never treated as zero; the latest value is the latest COMPLETE
     row. When a new version replaces an earlier one, the dates added and the earlier dates whose values changed
     are recorded (ROMI's running mean is tapered near the end, so its last days are revised later).
   - A response larger than MAX_BYTES is not stored. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js");
const VERSION = "climidx-v2";
const MAX_BYTES = 5e6;
const INDICES = [
  { id: "enso-oni", label: "Oceanic Niño Index (ONI)", url: "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt", format: "seasonal", publisher: "NOAA CPC" },
  { id: "enso-roni", label: "Relative Oceanic Niño Index (RONI)", url: "https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt", format: "seasonal", publisher: "NOAA CPC" },
  { id: "ao", label: "Arctic Oscillation (daily)", url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.cdas.z1000.19500101_current.csv", format: "daily-csv", publisher: "NOAA CPC" },
  { id: "nao", label: "North Atlantic Oscillation (daily)", url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.cdas.z500.19500101_current.csv", format: "daily-csv", publisher: "NOAA CPC" },
  { id: "pna", label: "Pacific–North American pattern (daily)", url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.pna.cdas.z500.19500101_current.csv", format: "daily-csv", publisher: "NOAA CPC" },
  { id: "mjo-rmm", label: "Madden–Julian Oscillation RMM (daily)", url: "https://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt", format: "rmm", publisher: "Bureau of Meteorology",
    definition: "All-season Real-time Multivariate MJO index (Wheeler and Hendon 2004): RMM1/RMM2 from combined EOFs of 15S-15N mean OLR, U850 and U200 anomalies; phase 1-8 and amplitude.",
    disabled: "BoM refused this automated request (HTTP 403, 2026-11-16). Not requested again: an approved access channel must be configured first. Its values stay missing." },
  { id: "mjo-romi", label: "Madden–Julian Oscillation ROMI (daily; not RMM)", url: "https://psl.noaa.gov/mjo/mjoindex/romi.cpcolr.1x.txt", format: "psl-pc", publisher: "NOAA PSL",
    definition: "Real-time OLR MJO Index (ROMI, Kiladis et al. 2014): projection of 9-day running-mean OLR anomalies (previous 40-day mean removed; CPC blended OLR) onto the daily spatial EOFs of 30-96 day eastward-filtered OLR. Columns: year, month, day, hour, PC1, PC2, amplitude. The running mean is tapered toward the latest date, so recent values are revised later.",
    comparability: "Not the Wheeler-Hendon RMM: OLR only (no winds), different EOFs and filtering, so amplitude and phase are not interchangeable with RMM. PSL notes that, for OMI, PC2 corresponds to RMM1 and -PC1 to RMM2. PSL publishes no phase for ROMI and none is derived here." },
];

const ymd = (t) => `${t[0]}-${String(t[1]).padStart(2, "0")}-${String(t[2]).padStart(2, "0")}`;
/* Daily rows of a daily index file: date -> values as text (compared exactly between versions), and the rows
   with a missing value (non-numeric or a fill value of 999 or more in magnitude). Seasonal files return null. */
function dailyRows(format, text) {
  if (!["psl-pc", "rmm", "daily-csv"].includes(format)) return null;
  const rows = new Map(), missing = [], cols = format === "psl-pc" ? [4, 5, 6] : format === "rmm" ? [3, 4, 6] : [3];
  String(text || "").split(/\r?\n/).forEach((l) => { const t = l.trim().split(/[\s,]+/); if (!/^\d{4}$/.test(t[0]) || t.length < 3 + cols.length) return;
    const d = ymd(t), v = cols.map((c) => t[c]); rows.set(d, v.join(" ")); if (v.some((x) => !isFinite(+x) || x === "" || Math.abs(+x) >= 999)) missing.push(d); });
  return { rows, missing };
}
/* What a new version changed relative to the previous one: dates added, and earlier dates whose values differ. */
function revision(prevText, text, format) {
  const a = dailyRows(format, prevText), b = dailyRows(format, text); if (!a || !b) return null;
  const added = [...b.rows.keys()].filter((d) => !a.rows.has(d)), changed = [...b.rows.keys()].filter((d) => a.rows.has(d) && a.rows.get(d) !== b.rows.get(d)), removed = [...a.rows.keys()].filter((d) => !b.rows.has(d));
  return { added: added.length, addedFrom: added[0] || null, addedTo: added[added.length - 1] || null, changed: changed.length, changedFrom: changed[0] || null, changedTo: changed[changed.length - 1] || null, removed: removed.length };
}
/* Latest row, tolerant of headers and blank lines. Returns null when the format is not recognised. */
function latest(format, text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].split(/[\s,]+/);
    if (format === "seasonal" && /^[A-Z]{3}$/.test(t[0]) && /^\d{4}$/.test(t[1]) && t.length >= 3 && isFinite(+t[t.length - 1])) return { period: `${t[0]} ${t[1]}`, value: +t[t.length - 1], valueField: "last column (anomaly)" };
    if (format === "daily-csv" && t.length >= 4 && /^\d{4}$/.test(t[0]) && isFinite(+t[3]) && t[3] !== "") return { date: `${t[0]}-${String(t[1]).padStart(2, "0")}-${String(t[2]).padStart(2, "0")}`, value: +t[3] };
    if (format === "psl-pc" && t.length >= 7 && /^\d{4}$/.test(t[0])) { const v = [t[4], t[5], t[6]].map(Number); if (v.every((x) => isFinite(x) && Math.abs(x) < 999)) return { date: ymd(t), pc1: v[0], pc2: v[1], amplitude: v[2], phase: null, phaseNote: "not published by PSL for ROMI; not derived" }; continue; }
    if (format === "rmm" && t.length >= 7 && /^\d{4}$/.test(t[0]) && isFinite(+t[3]) && Math.abs(+t[3]) < 1e3) return { date: `${t[0]}-${String(t[1]).padStart(2, "0")}-${String(t[2]).padStart(2, "0")}`, rmm1: +t[3], rmm2: +t[4], phase: +t[5], amplitude: +t[6] };
  }
  return null;
}

async function run(DATA, nowMs, { fetchRaw = U.fetchRaw, list = INDICES } = {}) {
  const day = U.iso(nowMs).slice(0, 10), logFile = path.join(DATA, "climate", "retrievals", `${day.slice(0, 7)}.jsonl`);
  const prior = U.readJSONLDir(path.join(DATA, "climate", "retrievals"));
  /* one attempt per index per UTC day, whatever its outcome: a failure waits for the next day, never a same-day retry */
  const tried = new Map(prior.filter((r) => r.at && r.at.slice(0, 10) === day).map((r) => [r.id, r]));
  const lastSaved = {}; prior.filter((r) => r.file).forEach((r) => (lastSaved[r.id] = r));
  const blockedHosts = new Set(prior.filter((r) => r.at.slice(0, 10) === day && (r.httpStatus === 429 || r.httpStatus === 403)).map((r) => new URL(r.url).host));
  const out = [];
  for (const ix of list) {
    if (ix.disabled) { out.push({ id: ix.id, status: `disabled: ${ix.disabled}` }); continue; } // never requested; earlier records stay
    if (tried.has(ix.id)) { const t = tried.get(ix.id); out.push({ id: ix.id, status: t.httpStatus === 200 && !t.error ? "already retrieved today" : `already attempted today (${t.error || `HTTP ${t.httpStatus}`}); next attempt tomorrow` }); continue; }
    const host = new URL(ix.url).host;
    if (blockedHosts.has(host)) { out.push({ id: ix.id, status: `skipped: ${host} refused or rate-limited today` }); continue; }
    const r = await fetchRaw(ix.url, { tries: 1, timeoutMs: 30000, accept: "text/plain,text/csv,*/*" });
    const rec = { version: VERSION, id: ix.id, url: ix.url, publisher: ix.publisher, definition: ix.definition || null, comparability: ix.comparability || null, at: r.retrievedAt, httpStatus: r.status, serverLastModified: r.lastModified || null, serverDate: r.date || null, bytes: r.buf ? r.buf.length : 0, error: r.ok ? undefined : r.error || `HTTP ${r.status}` };
    if (r.status === 429 || r.status === 403) blockedHosts.add(host);
    if (r.ok && r.buf && r.buf.length > MAX_BYTES) { rec.error = `response of ${r.buf.length} bytes exceeds the ${MAX_BYTES}-byte limit; not stored`; rec.sha256 = U.sha256(r.buf); }
    else if (r.ok && r.buf.length) {
      rec.sha256 = U.sha256(r.buf);
      const prev = lastSaved[ix.id];
      if (!prev || prev.sha256 !== rec.sha256) { rec.file = U.saveRaw(DATA, `climate/raw/${ix.id}/${day}_${rec.sha256.slice(0, 12)}.txt`, r.buf); rec.newVersion = true; rec.versionFirstRetrievedAt = rec.at;
        if (prev && prev.file) { let old = null; try { old = U.loadRaw(DATA, prev.file.path).toString("utf8"); } catch (e) { /* earlier copy unreadable */ } rec.revision = old == null ? { error: "previous version unreadable" } : revision(old, r.text, ix.format); } }
      else { rec.sameAs = prev.file.path; rec.newVersion = false; rec.versionFirstRetrievedAt = prev.versionFirstRetrievedAt || prev.at; }
      const l = latest(ix.format, r.text); rec.latest = l; rec.parse = l ? "ok" : "unparsed (raw kept)";
      const dr = dailyRows(ix.format, r.text); if (dr) { const ds = [...dr.rows.keys()].sort(); rec.rows = { count: dr.rows.size, first: ds[0] || null, last: ds[ds.length - 1] || null, missing: dr.missing.length, missingDates: dr.missing.slice(-10) }; }
      rec.validPeriod = l ? l.period || l.date : null;
      rec.officialPublication = null; rec.officialPublicationNote = "not stated by the file; earliest proven availability is versionFirstRetrievedAt";
      lastSaved[ix.id] = rec.file ? rec : { ...rec, file: prev.file };
    }
    U.appendJSONL(logFile, [rec]);
    out.push({ id: ix.id, status: rec.error ? `failed (${rec.error})` : rec.newVersion ? "new version saved" : "unchanged", httpStatus: r.status, latest: rec.latest || null });
  }
  return { version: VERSION, day, results: out };
}
/* The version a capture at time ms could have used: the latest version first retrieved at or before ms.
   Never earlier than our own first retrieval, whatever Last-Modified says. */
function availableAt(DATA, id, ms) {
  const rows = U.readJSONLDir(path.join(DATA, "climate", "retrievals")).filter((r) => r.id === id && r.httpStatus === 200 && r.newVersion && Date.parse(r.versionFirstRetrievedAt || r.at) <= ms);
  const r = rows.sort((a, b) => (a.versionFirstRetrievedAt || a.at).localeCompare(b.versionFirstRetrievedAt || b.at)).pop();
  return r ? { id, sha256: r.sha256, file: r.file, availableFrom: r.versionFirstRetrievedAt || r.at, validPeriod: r.validPeriod || null, latest: r.latest || null, serverLastModified: r.serverLastModified || null } : null;
}
/* Summary for reports: per index, the latest retrieval and the number of distinct published versions kept. */
function summary(DATA) {
  const rows = U.readJSONLDir(path.join(DATA, "climate", "retrievals")), by = {};
  rows.forEach((r) => { const x = (by[r.id] = by[r.id] || { retrievals: 0, ok: 0, versions: new Set(), last: null, lastOk: null }); x.retrievals++; if (r.httpStatus === 200) { x.ok++; if (r.sha256) x.versions.add(r.sha256); x.lastOk = r; } x.last = r; });
  return INDICES.map((ix) => { const x = by[ix.id]; return { id: ix.id, label: ix.label, publisher: ix.publisher, disabled: ix.disabled || null, comparability: ix.comparability || null, retrievals: x ? x.retrievals : 0, ok: x ? x.ok : 0, versions: x ? x.versions.size : 0,
    last: x && x.last ? { at: x.last.at, httpStatus: x.last.httpStatus, error: x.last.error } : null, latest: x && x.lastOk ? x.lastOk.latest : null, validPeriod: x && x.lastOk ? x.lastOk.validPeriod || null : null, provenAvailableFrom: x && x.lastOk ? x.lastOk.versionFirstRetrievedAt || x.lastOk.at : null, officialPublication: null, serverLastModified: x && x.lastOk ? x.lastOk.serverLastModified : null }; });
}
module.exports = { VERSION, MAX_BYTES, INDICES, latest, dailyRows, revision, run, summary, availableAt };
