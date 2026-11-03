/* Observation ingestion for one location. Parsers are pure (tested with captured text); fetchers save
   raw evidence. Every parsed value carries its source, product/issuance, status and flags:
     METAR (IEM archive)  hourly temperature; 6-h max/min and 6-h precipitation groups   status: preliminary
     CLI  (NWS daily climate report)  complete-day max/min/precip/snow (partial-day reports kept, unused)   preliminary / corrected (CCA)
     CF6  (NWS preliminary monthly)    daily max/min/precip/snow   preliminary
     ACIS (RCC-ACIS)                   daily max/min/precip/snow   revised (tracks later edits)
     GHCN-Daily (NCEI)                 daily TMAX/TMIN/PRCP/SNOW with QC flags   final
   Climate-day values use local STANDARD time days. Traces are 0 with a "trace" flag. Missing stays missing. */
"use strict";
const U = require("./util.js");
const TG = require("./targets.js");
const VERSION = "obs-v1";
const c2f = (c) => (c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10);

/* ---------- METAR ---------- */
function parseMetar(text, validIso) {
  const out = { raw: text, t: Date.parse(validIso.replace(" ", "T") + "Z"), flags: [] };
  const m = text.split(" RMK ");
  const body = " " + m[0] + " ", rmk = m[1] ? " " + m[1] + " " : " ";
  if (/\sCOR\s/.test(body)) out.cor = true;
  const tg = /\sT([01])(\d{3})([01])(\d{3})\s/.exec(rmk);
  if (tg) { out.tempC = (tg[1] === "1" ? -1 : 1) * +tg[2] / 10; out.tempPrecise = true; }
  else { const t = /\s(M?\d{2})\/(M?\d{2})?\s/.exec(body); if (t) { out.tempC = +t[1].replace("M", "-"); out.tempPrecise = false; } }
  const g6 = (re) => { const x = re.exec(rmk); return x ? (x[1] === "1" ? -1 : 1) * +x[2] / 10 : null; };
  out.max6C = g6(/\s1([01])(\d{3})\s/); out.min6C = g6(/\s2([01])(\d{3})\s/);
  const g24 = /\s4([01])(\d{3})([01])(\d{3})\s/.exec(rmk);
  if (g24) { out.max24C = (g24[1] === "1" ? -1 : 1) * +g24[2] / 10; out.min24C = (g24[3] === "1" ? -1 : 1) * +g24[4] / 10; }
  const p6 = /\s6(\d{4}|\/{4})\s/.exec(rmk);
  if (p6) { if (p6[1] === "////") out.p6 = { indeterminate: true }; else out.p6 = { inch: +p6[1] / 100, trace: p6[1] === "0000" }; }
  const p1 = /\sP(\d{4})\s/.exec(rmk); if (p1) out.p1 = { inch: +p1[1] / 100, trace: p1[1] === "0000" };
  if (/\sPNO\s/.test(rmk)) out.flags.push("PNO");
  if (/\$\s*$/.test(text.trim())) out.flags.push("maintenance");
  return out;
}
/* IEM onlycomma: station,valid,lon,lat,elevation,metar */
function parseIEM(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean); if (!lines.length || !/^station,/.test(lines[0])) return [];
  const hdr = lines[0].split(","), iv = hdr.indexOf("valid"), im = hdr.indexOf("metar");
  const reps = lines.slice(1).map((l) => { const p = l.split(","); return parseMetar(p.slice(im).join(","), p[iv]); }).filter((r) => isFinite(r.t));
  /* corrected reports replace the original with the same time */
  const byT = new Map(); reps.forEach((r) => { const k = r.t; if (!byT.has(k) || r.cor) byT.set(k, r); });
  return [...byT.values()].sort((a, b) => a.t - b.t);
}
/* Routine report at or within 15 minutes before instant t (CVG routine reports are at :52). */
const routineBefore = (reps, t) => reps.filter((r) => r.t <= t && r.t > t - require("./timing.js").MATCH_TOLERANCE_MIN * 60e3).pop() || null;
/* Derived METAR targets for a list of local-standard dates. */
function metarTargets(reps, loc, dates) {
  const out = [], H = 3600e3, push = (target, date, value, flags, extra) => out.push({ target, date, value, flags, src: "METAR", status: "preliminary", ...extra });
  dates.forEach((d) => {
    const ds = TG.dayStartUtc(d, loc.lstOffsetMin);
    const g = (t) => routineBefore(reps, t);
    /* daytime 12Z-00Z: 6-h maxima ending at 18Z and 00Z */
    const a = g(ds + 13 * H), b = g(ds + 19 * H);
    if (a && b && a.max6C != null && b.max6C != null) push("tmax_day", d, c2f(Math.max(a.max6C, b.max6C)), [], { reports: [a.raw, b.raw] });
    const c = g(ds + 25 * H), e = g(ds + 31 * H);
    if (c && e && c.min6C != null && e.min6C != null) push("tmin_night", d, c2f(Math.min(c.min6C, e.min6C)), ["window 7p-7a LST"], { reports: [c.raw, e.raw] });
    /* 12-h precipitation from the two 6-h groups; an absent group in a present routine report is 0 */
    [["precip_day12", "pop01_day12", a, b], ["precip_night12", "pop01_night12", c, e]].forEach(([pk, qk, x, y]) => {
      if (!x || !y) return;
      if ([x, y].some((r) => r.flags.includes("PNO") || (r.p6 && r.p6.indeterminate))) return; // unknown amount: unscored
      const amt = [x, y].reduce((s, r) => s + (r.p6 ? r.p6.inch : 0), 0), trace = amt === 0 && [x, y].some((r) => r.p6 && r.p6.trace);
      push(pk, d, Math.round(amt * 100) / 100, trace ? ["trace"] : [], { reports: [x.raw, y.raw] });
      push(qk, d, amt >= 0.01 ? 1 : 0, trace ? ["trace"] : [], {});
    });
  });
  return out;
}
/* Hourly temperatures at each valid top of hour (UTC ms) from routine reports. */
function metarHourly(reps, fromMs, toMs) {
  const out = [];
  for (let t = Math.ceil(fromMs / 3600e3) * 3600e3; t <= toMs; t += 3600e3) {
    const r = routineBefore(reps, t); if (!r || r.tempC == null) continue;
    out.push({ target: "temp_hourly", time: t, value: c2f(r.tempC), flags: r.tempPrecise ? [] : ["whole-degree C"], src: "METAR", status: "preliminary", obsAt: r.t, report: r.raw });
  }
  return out;
}

/* ---------- CLI ---------- */
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
function parseCLI(text, meta = {}) {
  const t = text.replace(/\r/g, "");
  const hd = /CLIMATE SUMMARY FOR ([A-Z]+) (\d{1,2}) (\d{4})/.exec(t);
  if (!hd) return { ok: false, why: "no summary header" };
  const date = `${hd[3]}-${String(MONTHS.indexOf(hd[1]) + 1).padStart(2, "0")}-${hd[2].padStart(2, "0")}`;
  const partial = /VALID (?:TODAY )?AS OF (\d{4}) ([AP]M)/.exec(t);
  const complete = !partial || (partial[1] === "1159" && partial[2] === "PM");
  const corrected = /^\s*\S+\s+\S+\s+\d{6}\s+CC[A-Z]\s*$/m.test(t) || /CORRECTED/.test(t);
  const sect = (name) => { const i = t.indexOf(name); return i < 0 ? "" : t.slice(i, i + 900); };
  const val = (s, label) => { const x = new RegExp(`^\\s*${label}\\s+(MM|M|T|-?\\d+(?:\\.\\d+)?)(R?)`, "m").exec(s); return x ? x[1] : null; };
  const temp = sect("TEMPERATURE (F)"), pr = sect("PRECIPITATION (IN)"), sn = sect("SNOWFALL (IN)");
  const num = (x, kind) => (x == null || x === "MM" || x === "M" ? { value: null, flags: ["missing"] } : x === "T" ? { value: 0, flags: ["trace"] } : { value: +x, flags: [] });
  const vals = { tmax_clim: num(val(temp, "MAXIMUM")), tmin_clim: num(val(temp, "MINIMUM")), precip_clim: num(val(pr, "TODAY")), snow_clim: num(val(sn, "TODAY")) };
  return { ok: true, date, complete, corrected, validAsOf: partial ? `${partial[1]} ${partial[2]}` : "end of day", vals, issuedAt: meta.issuanceTime || null, productId: meta.id || null };
}
function cliTargets(p) {
  if (!p.ok || !p.complete) return [];
  const out = [];
  Object.entries(p.vals).forEach(([target, x]) => { if (x.value == null) return; out.push({ target, date: p.date, value: x.value, flags: x.flags, src: "CLI", status: p.corrected ? "corrected" : "preliminary", productId: p.productId, issuedAt: p.issuedAt }); });
  /* pop01_clim from the climate-day precipitation (trace is not measurable) */
  const pc = p.vals.precip_clim; if (pc.value != null) out.push({ target: "pop01_clim", date: p.date, value: pc.value >= 0.01 ? 1 : 0, flags: pc.flags, src: "CLI", status: p.corrected ? "corrected" : "preliminary", productId: p.productId, issuedAt: p.issuedAt });
  return out;
}
/* ---------- CF6 ---------- */
function parseCF6(text, meta = {}) {
  const t = text.replace(/\r/g, "");
  const mo = /MONTH:\s+([A-Z]+)/.exec(t), yr = /YEAR:\s+(\d{4})/.exec(t);
  if (!mo || !yr) return [];
  const m = String(MONTHS.indexOf(mo[1]) + 1).padStart(2, "0"), out = [];
  t.split("\n").forEach((line) => {
    const x = /^\s{0,2}(\d{1,2})\s+(-?\d+|M)\s+(-?\d+|M)\s+(-?\d+|M)\s+(-?\d+|M)\s+(\d+|M)\s+(\d+|M)\s+(\d+\.\d+|T|M)\s+(\d+\.\d+|T|M)\s/.exec(line);
    if (!x) return;
    const date = `${yr[1]}-${m}-${x[1].padStart(2, "0")}`, st = { src: "CF6", status: "preliminary", productId: meta.id || null, issuedAt: meta.issuanceTime || null };
    const add = (target, s, isNum) => { if (s === "M") return; out.push({ target, date, value: s === "T" ? 0 : +s, flags: s === "T" ? ["trace"] : [], ...st }); };
    add("tmax_clim", x[2]); add("tmin_clim", x[3]); add("precip_clim", x[8]); add("snow_clim", x[9]);
    if (x[8] !== "M") out.push({ target: "pop01_clim", date, value: x[8] !== "T" && +x[8] >= 0.01 ? 1 : 0, flags: x[8] === "T" ? ["trace"] : [], ...st });
  });
  return out;
}
/* ---------- ACIS ---------- */
function parseACIS(json) {
  const out = [];
  ((json && json.data) || []).forEach(([date, mx, mn, pc, sn]) => {
    const add = (target, s) => {
      if (s == null || s === "M" || s === "S" || s === "") return;
      const acc = /A$/.test(s); const v = s.replace(/A$/, "");
      if (v === "T") out.push({ target, date, value: 0, flags: ["trace"], src: "ACIS", status: "revised" });
      else if (isFinite(+v)) out.push({ target, date, value: +v, flags: acc ? ["accumulated"] : [], src: "ACIS", status: "revised" });
    };
    add("tmax_clim", mx); add("tmin_clim", mn); add("precip_clim", pc); add("snow_clim", sn);
    if (pc && pc !== "M" && pc !== "S" && !/A$/.test(pc)) out.push({ target: "pop01_clim", date, value: pc !== "T" && +pc >= 0.01 ? 1 : 0, flags: pc === "T" ? ["trace"] : [], src: "ACIS", status: "revised" });
  });
  return out;
}
/* ---------- GHCN-Daily (NCEI access service, standard units) ---------- */
function parseGHCND(arr) {
  const out = [], map = { TMAX: "tmax_clim", TMIN: "tmin_clim", PRCP: "precip_clim", SNOW: "snow_clim" };
  (arr || []).forEach((r) => Object.entries(map).forEach(([k, target]) => {
    if (r[k] == null || r[k] === "") return;
    const [mflag, qflag] = String(r[k + "_ATTRIBUTES"] || "").split(",");
    const flags = []; if (mflag === "T") flags.push("trace"); if (qflag) flags.push("qc:" + qflag);
    out.push({ target, date: r.DATE, value: +r[k], flags, src: "GHCND", status: qflag ? "qc-failed" : "final" });
    if (k === "PRCP" && !qflag) out.push({ target: "pop01_clim", date: r.DATE, value: +r[k] >= 0.01 ? 1 : 0, flags, src: "GHCND", status: "final" });
  }));
  return out;
}

/* Best available value per (target, date): final > revised > corrected > preliminary; newest within a
   tier; QC-failed values are never used. Returns Map key "target|date" -> {value, src, status, history}. */
const RANK = { final: 4, revised: 3, corrected: 2, preliminary: 1 };
const SRC_RANK = { GHCND: 4, ACIS: 3, CLI: 2, CF6: 1.5, METAR: 1 };
function best(rows) {
  const by = new Map();
  rows.forEach((r) => { if (!(r.status in RANK)) return; const k = `${r.target}|${r.date || r.time}`; (by.get(k) || by.set(k, []).get(k)).push(r); });
  const out = new Map();
  by.forEach((list, k) => {
    const s = list.slice().sort((a, b) => RANK[b.status] - RANK[a.status] || SRC_RANK[b.src] - SRC_RANK[a.src] || String(b.seenAt || b.issuedAt || "").localeCompare(String(a.seenAt || a.issuedAt || "")));
    const top = s[0], vals = [...new Set(list.map((x) => x.value))];
    out.set(k, { value: top.value, src: top.src, status: top.status, flags: top.flags || [], revised: vals.length > 1, versions: list.length, obsAt: top.obsAt, seenAt: top.seenAt, productId: top.productId, sha: top.sha, report: top.report });
  });
  return out;
}

/* ---------- fetch (needs internet) ---------- */
async function fetchAll(loc, dataRoot, nowMs, { days = 10 } = {}) {
  const rel = `obs-raw/${loc.id}/${new Date(nowMs).toISOString().slice(0, 10)}/${new Date(nowMs).toISOString().slice(11, 16).replace(":", "")}`;
  const res = { rows: [], outcomes: {} };
  const save = (name, r) => U.saveRaw(dataRoot, `${rel}/${name}`, r.buf);
  const from = new Date(nowMs - days * 86400e3), to = new Date(nowMs + 86400e3), ymd = (d) => d.toISOString().slice(0, 10);
  const lstDates = Array.from({ length: days + 1 }, (_, k) => new Date(nowMs + loc.lstOffsetMin * 60e3 - (days - k) * 86400e3).toISOString().slice(0, 10));
  /* METAR */
  try {
    const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${loc.ids.iem}&data=metar&year1=${from.getUTCFullYear()}&month1=${from.getUTCMonth() + 1}&day1=${from.getUTCDate()}&year2=${to.getUTCFullYear()}&month2=${to.getUTCMonth() + 1}&day2=${to.getUTCDate()}&tz=Etc/UTC&format=onlycomma&latlon=no&elev=no&missing=M&trace=T&direct=no&report_type=3&report_type=4`;
    const r = await U.fetchRaw(url); const file = save("iem-metar.csv", r);
    const reps = r.ok ? parseIEM(r.text) : [];
    res.outcomes.METAR = { status: reps.length ? "ok" : "failed", httpStatus: r.status, reports: reps.length, file, error: r.ok ? undefined : r.text.slice(0, 200) || r.error };
    res.rows.push(...metarTargets(reps, loc, lstDates).map((x) => ({ ...x, seenAt: r.retrievedAt, sha: file.sha256 })));
    res.rows.push(...metarHourly(reps, nowMs - days * 86400e3, nowMs).map((x) => ({ ...x, seenAt: r.retrievedAt, sha: file.sha256 })));
  } catch (e) { res.outcomes.METAR = { status: "failed", error: String(e.message || e) }; }
  /* CLI and CF6 product lists, every product text saved by id */
  for (const [type, parse] of [["CLI", (txt, m) => cliTargets(parseCLI(txt, m))], ["CF6", parseCF6]]) {
    try {
      const l = await U.fetchRaw(`https://api.weather.gov/products/types/${type}/locations/${loc.ids.cliSite}`, { accept: "application/ld+json" });
      const g = ((U.parseJSON(l.text) || {})["@graph"] || []).slice(0, type === "CLI" ? 24 : 4);
      let n = 0, partial = 0;
      for (const it of g) {
        const p = await U.fetchRaw(it["@id"], { accept: "application/ld+json" }); const j = U.parseJSON(p.text); if (!j) continue;
        const file = U.saveRaw(dataRoot, `obs-raw/${loc.id}/products/${type}/${j.id}.txt`, Buffer.from(j.productText || ""));
        const rows = parse(j.productText || "", { id: j.id, issuanceTime: j.issuanceTime });
        if (type === "CLI" && !parseCLI(j.productText || "").complete) partial++;
        res.rows.push(...rows.map((x) => ({ ...x, seenAt: p.retrievedAt, sha: file.sha256 }))); n++;
      }
      res.outcomes[type] = { status: n ? "ok" : "failed", products: n, partialDay: partial || undefined, httpStatus: l.status };
    } catch (e) { res.outcomes[type] = { status: "failed", error: String(e.message || e) }; }
  }
  /* ACIS (revisions) */
  try {
    const body = JSON.stringify({ sid: loc.ids.faa, sdate: ymd(new Date(nowMs - 45 * 86400e3)), edate: ymd(new Date(nowMs)), elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name })) });
    const r = await U.fetchRaw("https://data.rcc-acis.org/StnData", { method: "POST", body, headers: { "Content-Type": "application/json" }, accept: "application/json" });
    const file = save("acis.json", r); const rows = parseACIS(U.parseJSON(r.text));
    res.rows.push(...rows.map((x) => ({ ...x, seenAt: r.retrievedAt, sha: file.sha256 })));
    res.outcomes.ACIS = { status: rows.length ? "ok" : "failed", values: rows.length, httpStatus: r.status };
  } catch (e) { res.outcomes.ACIS = { status: "failed", error: String(e.message || e) }; }
  /* GHCN-Daily (final; arrives days to weeks later) */
  try {
    const url = `https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=${loc.ids.ghcnd}&startDate=${ymd(new Date(nowMs - 60 * 86400e3))}&endDate=${ymd(new Date(nowMs))}&dataTypes=TMAX,TMIN,PRCP,SNOW&format=json&units=standard&includeAttributes=true`;
    const r = await U.fetchRaw(url, { accept: "application/json" }); const file = save("ghcnd.json", r); const rows = parseGHCND(U.parseJSON(r.text));
    res.rows.push(...rows.map((x) => ({ ...x, seenAt: r.retrievedAt, sha: file.sha256 })));
    res.outcomes.GHCND = { status: r.ok ? "ok" : "failed", values: rows.length, httpStatus: r.status };
  } catch (e) { res.outcomes.GHCND = { status: "failed", error: String(e.message || e) }; }
  return res;
}
module.exports = { VERSION, parseMetar, parseIEM, metarTargets, metarHourly, routineBefore, parseCLI, cliTargets, parseCF6, parseACIS, parseGHCND, best, fetchAll, c2f };
