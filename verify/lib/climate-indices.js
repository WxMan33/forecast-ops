/* Climate-pattern indices archived AS PUBLISHED (climidx-v1), so a future seasonal or ENSO comparison can use
   only values that were public when each forecast was issued.
   - Once per UTC day, during the observation job; one attempt per index; a 429 or 403 stops further requests
     to that host for the day. Failures are logged and never affect observations or scoring.
   - Every retrieval is logged with its time, HTTP status, the server's Last-Modified header (labelled as the
     server's modification time, NOT an official issue time) and the SHA-256 of the body.
   - The body is saved as received whenever it differs from the last saved copy, so each published version
     is kept; revisions (e.g. ONI updates of earlier seasons) appear as new versions, never as edits.
   - The latest row is parsed only for display. A format the parser does not recognise is "unparsed"; the raw
     file still counts as the evidence. Nothing here relates these indices to forecast skill. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js");
const VERSION = "climidx-v1";
const INDICES = [
  { id: "enso-oni", label: "Oceanic Niño Index (ONI)", url: "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt", format: "seasonal", publisher: "NOAA CPC" },
  { id: "enso-roni", label: "Relative Oceanic Niño Index (RONI)", url: "https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt", format: "seasonal", publisher: "NOAA CPC" },
  { id: "ao", label: "Arctic Oscillation (daily)", url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.cdas.z1000.19500101_current.csv", format: "daily-csv", publisher: "NOAA CPC" },
  { id: "nao", label: "North Atlantic Oscillation (daily)", url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.cdas.z500.19500101_current.csv", format: "daily-csv", publisher: "NOAA CPC" },
  { id: "pna", label: "Pacific–North American pattern (daily)", url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.pna.cdas.z500.19500101_current.csv", format: "daily-csv", publisher: "NOAA CPC" },
  { id: "mjo-rmm", label: "Madden–Julian Oscillation RMM (daily)", url: "https://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt", format: "rmm", publisher: "Bureau of Meteorology" },
];

/* Latest row, tolerant of headers and blank lines. Returns null when the format is not recognised. */
function latest(format, text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].split(/[\s,]+/);
    if (format === "seasonal" && /^[A-Z]{3}$/.test(t[0]) && /^\d{4}$/.test(t[1]) && t.length >= 3 && isFinite(+t[t.length - 1])) return { period: `${t[0]} ${t[1]}`, value: +t[t.length - 1], valueField: "last column (anomaly)" };
    if (format === "daily-csv" && t.length >= 4 && /^\d{4}$/.test(t[0]) && isFinite(+t[3]) && t[3] !== "") return { date: `${t[0]}-${String(t[1]).padStart(2, "0")}-${String(t[2]).padStart(2, "0")}`, value: +t[3] };
    if (format === "rmm" && t.length >= 7 && /^\d{4}$/.test(t[0]) && isFinite(+t[3]) && Math.abs(+t[3]) < 1e3) return { date: `${t[0]}-${String(t[1]).padStart(2, "0")}-${String(t[2]).padStart(2, "0")}`, rmm1: +t[3], rmm2: +t[4], phase: +t[5], amplitude: +t[6] };
  }
  return null;
}

async function run(DATA, nowMs, { fetchRaw = U.fetchRaw, list = INDICES } = {}) {
  const day = U.iso(nowMs).slice(0, 10), logFile = path.join(DATA, "climate", "retrievals", `${day.slice(0, 7)}.jsonl`);
  const prior = U.readJSONLDir(path.join(DATA, "climate", "retrievals"));
  const done = new Set(prior.filter((r) => r.at.slice(0, 10) === day && r.httpStatus === 200).map((r) => r.id));
  const lastSaved = {}; prior.filter((r) => r.file).forEach((r) => (lastSaved[r.id] = r));
  const blockedHosts = new Set(prior.filter((r) => r.at.slice(0, 10) === day && (r.httpStatus === 429 || r.httpStatus === 403)).map((r) => new URL(r.url).host));
  const out = [];
  for (const ix of list) {
    if (done.has(ix.id)) { out.push({ id: ix.id, status: "already retrieved today" }); continue; }
    const host = new URL(ix.url).host;
    if (blockedHosts.has(host)) { out.push({ id: ix.id, status: `skipped: ${host} refused or rate-limited today` }); continue; }
    const r = await fetchRaw(ix.url, { tries: 1, timeoutMs: 30000, accept: "text/plain,text/csv,*/*" });
    const rec = { version: VERSION, id: ix.id, url: ix.url, publisher: ix.publisher, at: r.retrievedAt, httpStatus: r.status, serverLastModified: r.lastModified || null, serverDate: r.date || null, bytes: r.buf ? r.buf.length : 0, error: r.ok ? undefined : r.error || `HTTP ${r.status}` };
    if (r.status === 429 || r.status === 403) blockedHosts.add(host);
    if (r.ok && r.buf.length) {
      rec.sha256 = U.sha256(r.buf);
      const prev = lastSaved[ix.id];
      if (!prev || prev.sha256 !== rec.sha256) { rec.file = U.saveRaw(DATA, `climate/raw/${ix.id}/${day}_${rec.sha256.slice(0, 12)}.txt`, r.buf); rec.newVersion = true; }
      else { rec.sameAs = prev.file.path; rec.newVersion = false; }
      const l = latest(ix.format, r.text); rec.latest = l; rec.parse = l ? "ok" : "unparsed (raw kept)";
      lastSaved[ix.id] = rec.file ? rec : { ...rec, file: prev.file };
    }
    U.appendJSONL(logFile, [rec]);
    out.push({ id: ix.id, status: r.ok ? (rec.newVersion ? "new version saved" : "unchanged") : `failed (${rec.error})`, httpStatus: r.status, latest: rec.latest || null });
  }
  return { version: VERSION, day, results: out };
}
/* Summary for reports: per index, the latest retrieval and the number of distinct published versions kept. */
function summary(DATA) {
  const rows = U.readJSONLDir(path.join(DATA, "climate", "retrievals")), by = {};
  rows.forEach((r) => { const x = (by[r.id] = by[r.id] || { retrievals: 0, ok: 0, versions: new Set(), last: null, lastOk: null }); x.retrievals++; if (r.httpStatus === 200) { x.ok++; if (r.sha256) x.versions.add(r.sha256); x.lastOk = r; } x.last = r; });
  return INDICES.map((ix) => { const x = by[ix.id]; return { id: ix.id, label: ix.label, publisher: ix.publisher, retrievals: x ? x.retrievals : 0, ok: x ? x.ok : 0, versions: x ? x.versions.size : 0,
    last: x && x.last ? { at: x.last.at, httpStatus: x.last.httpStatus, error: x.last.error } : null, latest: x && x.lastOk ? x.lastOk.latest : null, serverLastModified: x && x.lastOk ? x.lastOk.serverLastModified : null }; });
}
module.exports = { VERSION, INDICES, latest, run, summary };
