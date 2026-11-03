/* Cincinnati TV pilot: collection and extraction. Every product saves its original evidence
   (content-addressed, hashed), records collection and freshness evidence, and extracts values with a
   confidence and a review status. Nothing is invented: words like "LIKELY" never become a probability,
   and a value the extractor is unsure of goes to the review queue instead of the scorecards. */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const U = require("./util.js");
const VERSION = "tv-extract-v1";
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const htmlUnescape = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/* Bracket-matched JSON value starting at the first "[" or "{" at/after index i. */
function sliceJSON(s, i) {
  const start = s.slice(i).search(/[[{]/); if (start < 0) return null;
  let k = i + start, depth = 0, inStr = false, esc = false;
  for (let j = k; j < s.length; j++) {
    const ch = s[j];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "[" || ch === "{") depth++; else if (ch === "]" || ch === "}") { depth--; if (!depth) return s.slice(k, j + 1); }
  }
  return null;
}
/* Find a JSON array/object after a key, whether the page embeds it plainly or as an escaped string. */
function findJSON(html, key) {
  let i = html.indexOf(`"${key}":`);
  if (i >= 0) { const raw = sliceJSON(html, i + key.length + 3); try { return JSON.parse(raw); } catch (e) { /* fall through */ } }
  i = html.indexOf(`\\"${key}\\":`);
  if (i >= 0) {
    const sub = html.slice(i + key.length + 5);
    const unesc = sub.slice(0, 400000).replace(/\\\\/g, "\u0000").replace(/\\"/g, '"').replace(/\u0000/g, "\\");
    const raw = sliceJSON(unesc, 0); try { return JSON.parse(raw); } catch (e) { return null; }
  }
  return null;
}
const lstDate = (ms, loc) => new Date(ms + loc.lstOffsetMin * 60e3).toISOString().slice(0, 10);

/* ---------- adapters: (input, ctx) -> {days:[...], meta, confidence, issues[]} ---------- */
const A = {};
/* WCPO website: data-props JSON of the WeatherFull component */
A.wcpoWeb = (html) => {
  const s = htmlUnescape(html), issues = [];
  const m = /data-component="WeatherFull" data-props="([\s\S]*?)"><div/.exec(html);
  let j = null; try { j = JSON.parse(htmlUnescape(m ? m[1] : "")); } catch (e) { j = null; }
  if (!j) { const d = findJSON(s, "days"); j = d ? { days: d } : null; }
  if (!j || !Array.isArray(j.days)) return { days: [], confidence: 0, issues: ["forecast JSON not found"] };
  const days = j.days.map((d) => {
    const [mm, dd, yy] = String(d.date).split("/"); const num = (x) => (x === "" || x == null || !isFinite(+x) ? null : +x);
    return { date: `${yy}-${mm}-${dd}`, dayName: d.day, hi: num(d.high), lo: num(d.low), pop: num(d.chanceOfPrecipitation), wx: d.wx, by: { hi: "product", lo: "product", pop: "product" } };
  });
  if (!days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))) issues.push("unparsed date");
  return { days, meta: { city: j.days[0] && j.days[0].city }, confidence: issues.length ? 0.5 : 0.98, issues };
};
/* Local 12: provider ("orig") and team ("modified") values per day */
A.wkrc = (html, ctx) => {
  const f = findJSON(html, "forecast") && findJSON(html, "weatherForecasts");
  const fc = findJSON(html, "weatherForecasts");
  if (!Array.isArray(fc)) return { days: [], confidence: 0, issues: ["weatherForecasts not found"] };
  const saved = /savedDateTimeISO8601\\?"\s*:\s*\\?"([^"\\]+)/.exec(html), zip = /externalServiceId\\?"\s*:\s*\\?"([^"\\]+)\\?",\\?"zipCode\\?"\s*:\s*\\?"(\d+)/.exec(html);
  const days = fc.map((d) => {
    const pick = (mod, orig) => (d[mod] != null ? { v: d[mod], by: "team" } : d[orig] != null ? { v: d[orig], by: "automated" } : { v: null, by: null });
    const hi = pick("modifiedHiTempF", "origHiTempF"), lo = pick("modifiedLoTempF", "origLoTempF"), pop = pick("modifiedPrecipChance", "origPrecipChance");
    return { date: lstDate(d.dateTime, ctx.loc), dayName: d.dayOfWeek, hi: hi.v, lo: lo.v, pop: pop.v == null ? null : +pop.v, wx: d.modifiedSkyText || d.origSkyText,
      by: { hi: hi.by, lo: lo.by, pop: pop.by }, provider: { hi: d.origHiTempF, lo: d.origLoTempF, pop: d.origPrecipChance } };
  });
  return { days, meta: { savedAt: saved ? saved[1] : null, providerLocation: zip ? zip[1] : null, zip: zip ? zip[2] : null }, confidence: 0.97, issues: [] };
};
/* FOX19: TWC daily-10day-custom in the page state */
A.wxix = (html, ctx) => {
  const df = findJSON(html, "dailyForecast");
  if (!Array.isArray(df)) return { days: [], confidence: 0, issues: ["dailyForecast not found"] };
  const loc = findJSON(html, "location") || {};
  const days = df.filter((d) => d.validTimeLocal).map((d) => {
    const dp = d.daypart || [], D = dp.find((x) => x.dayOrNight === "D"), N = dp.find((x) => x.dayOrNight === "N");
    return { date: d.validTimeLocal.slice(0, 10), dayName: d.dayOfWeek, hi: D && D.temperature != null ? D.temperature : d.temperatureMax != null ? d.temperatureMax : null,
      lo: N && N.temperature != null ? N.temperature : null, popDay: D ? D.precipChance : null, popNight: N ? N.precipChance : null, pop: null, by: { hi: "provider", lo: "provider", pop: "provider" } };
  });
  return { days, meta: { location: loc.city ? `${loc.city} ${loc.latitude},${loc.longitude}` : null }, confidence: 0.95, issues: [] };
};
/* WLWT story: keep text; pull only explicit numbers; always needs review before any scoring */
A.wlwtStory = (html) => {
  const mod = /"dateModified":\s*"([^"]+)"/.exec(html), by = /"author":\s*\[?\s*\{[^}]*"name":\s*"([^"]+)"/.exec(html);
  let t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
  t = htmlUnescape(t).replace(/\s+/g, " ");
  const a = t.indexOf("In-depth weather forecast"), body = t.slice(a, a + 4000).split("Make WLWT a preferred source")[0];
  const explicit = [...body.matchAll(/\b(high|low|highs|lows)\s+(?:of|near|around|in the)?\s*(\d{1,3})(?:°|\s*degrees)?\b/gi)].map((m) => m[0]);
  const pcts = [...body.matchAll(/\b(\d{1,3})\s?%\s*(?:chance|probability)/gi)].map((m) => m[0]);
  return { days: [], text: body.trim(), meta: { dateModified: mod ? mod[1] : null, byline: by ? by[1] : null, explicit, percents: pcts }, confidence: 0, issues: ["story text: values need manual review; vague wording (e.g. 'mid-70s') is not converted to numbers"] };
};
/* WCPO graphic: OCR words with positions (tesseract TSV) -> day columns, highs, between-column lows */
function parseGraphicTSV(tsv, ctx) {
  const issues = [];
  const words = tsv.split("\n").slice(1).map((l) => l.split("\t")).filter((p) => p.length >= 12 && p[11].trim()).map((p) => ({ x: +p[6], y: +p[7], w: +p[8], h: +p[9], conf: +p[10], text: p[11].trim() }));
  const day = words.filter((w) => DAYS.includes(w.text.toUpperCase().replace(/[^A-Z]/g, ""))).map((w) => ({ ...w, name: w.text.toUpperCase().replace(/[^A-Z]/g, ""), cx: w.x + w.w / 2 }));
  const dayRowY = day.length ? day.map((w) => w.y).sort((a, b) => a - b)[Math.floor(day.length / 2)] : 0;
  const cols = day.filter((w) => Math.abs(w.y - dayRowY) < 25).sort((a, b) => a.cx - b.cx);
  const nums = words.filter((w) => /^\d{1,3}°?$/.test(w.text.replace(/[^\d°]/g, "")) && w.y > dayRowY + 40).map((w) => ({ ...w, v: +w.text.replace(/\D/g, ""), cx: w.x + w.w / 2 }));
  if (!cols.length || !nums.length) return { days: [], confidence: 0, issues: ["day columns or temperatures not found"] };
  const ys = nums.map((n) => n.y).sort((a, b) => a - b), split = (() => { let best = 0, at = ys[0]; for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > best) { best = ys[i] - ys[i - 1]; at = (ys[i] + ys[i - 1]) / 2; } return best > 15 ? at : null; })();
  const highs = nums.filter((n) => split == null || n.y < split), lows = split == null ? [] : nums.filter((n) => n.y >= split);
  const spacing = cols.length > 1 ? (cols[cols.length - 1].cx - cols[0].cx) / (cols.length - 1) : 100;
  const out = cols.map((c) => ({ dayName: c.name, hi: null, lo: null, conf: [c.conf] }));
  highs.forEach((h) => { const k = cols.reduce((b, c, i) => (Math.abs(c.cx - h.cx) < Math.abs(cols[b].cx - h.cx) ? i : b), 0); if (Math.abs(cols[k].cx - h.cx) < spacing * 0.4) { if (out[k].hi != null) issues.push(`two highs under ${cols[k].name}`); out[k].hi = h.v; out[k].conf.push(h.conf); } else issues.push(`high ${h.v} not under a column`); });
  /* lows sit between columns: the low between columns i and i+1 is the night after day i */
  lows.forEach((l) => { const i = Math.floor((l.cx - cols[0].cx) / spacing + 1e-9); const frac = (l.cx - cols[0].cx) / spacing - i;
    if (i >= 0 && i < cols.length - 1 && frac > 0.2 && frac < 0.8) { if (out[i].lo != null) issues.push(`two lows after ${cols[i].name}`); out[i].lo = l.v; out[i].conf.push(l.conf); }
    else if (i >= 0 && i < cols.length && Math.abs(frac) <= 0.2) { issues.push(`low ${l.v} sits under a column, not between: layout changed?`); }
    else issues.push(`low ${l.v} outside the columns`); });
  /* weekday sequence check */
  cols.forEach((c, i) => { if (i && DAYS.indexOf(c.name) !== (DAYS.indexOf(cols[i - 1].name) + 1) % 7) issues.push(`day sequence break at ${c.name}`); });
  out.forEach((d, i) => { if (d.hi == null) issues.push(`no high for ${d.dayName} (${i + 1})`); if (i < out.length - 1 && d.lo == null) issues.push(`no low after ${d.dayName}`);
    if (d.hi != null && (d.hi < -30 || d.hi > 115)) issues.push(`implausible high ${d.hi}`); if (d.lo != null && d.hi != null && out[i + 1] && out[i + 1].hi != null && d.lo > Math.max(d.hi, out[i + 1].hi) + 2) issues.push(`low ${d.lo} above both neighbouring highs`);
    /* dropped or extra digits: a value far from its neighbours is suspect, not trusted */
    if (d.lo != null && d.hi != null && d.lo < d.hi - 35 && (!out[i + 1] || out[i + 1].hi == null || d.lo < out[i + 1].hi - 35)) issues.push(`low ${d.lo} far below the neighbouring highs: possible misread`);
    const nb = [out[i - 1], out[i + 1]].filter((x) => x && x.hi != null).map((x) => x.hi);
    if (d.hi != null && nb.length && nb.every((h) => Math.abs(h - d.hi) > 30)) issues.push(`high ${d.hi} far from its neighbours: possible misread`); });
  const minConf = Math.min(...out.flatMap((d) => d.conf)) / 100;
  return { days: out.map((d) => ({ dayName: d.dayName, hi: d.hi, lo: d.lo, pop: null, by: { hi: "product", lo: "product", pop: null }, ocrConf: Math.round(Math.min(...d.conf)) })), confidence: issues.length ? Math.min(0.5, minConf) : minConf, issues };
}
/* Assign calendar dates to a weekday sequence. anchor = local date the product was issued. */
function assignDates(days, anchorDate) {
  if (!days.length) return { ok: false, why: "no days" };
  const anchorDow = new Date(anchorDate + "T12:00:00Z").getUTCDay(), first = DAYS.indexOf(days[0].dayName);
  if (first < 0) return { ok: false, why: "unknown first weekday" };
  const off = (first - anchorDow + 7) % 7;
  if (off > 1) return { ok: false, why: `first column ${days[0].dayName} is ${off} days after the issue date ${anchorDate}: ambiguous or stale` };
  days.forEach((d, i) => (d.date = U.addDays(anchorDate, off + i)));
  return { ok: true, firstOffset: off };
}
A.wcpoGraphic = (buf, ctx) => {
  if (ctx.tsv == null) return { days: [], confidence: 0, issues: ["OCR unavailable on this runner: graphic saved, extraction pending"] };
  const r = parseGraphicTSV(ctx.tsv, ctx);
  const anchor = ctx.lastModified ? lstLocalDate(Date.parse(ctx.lastModified), ctx.loc) : ctx.captureLocalDate;
  const a = assignDates(r.days, anchor);
  if (!a.ok) { r.issues.push(a.why); r.confidence = 0; }
  return { ...r, meta: { dateAnchor: anchor, anchorFrom: ctx.lastModified ? "Last-Modified" : "capture date" } };
};
const lstLocalDate = (ms, loc) => U.localParts(ms, loc.tz).date; // civil local date of issuance

/* tesseract (installed by the workflow) -> TSV text */
function tesseractOCR(buf) {
  const tmp = path.join(require("os").tmpdir(), `ocr-${process.pid}-${Date.now()}.jpg`);
  fs.writeFileSync(tmp, buf);
  try { return cp.execFileSync("tesseract", [tmp, "stdout", "--psm", "11", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 }); }
  finally { fs.unlinkSync(tmp); }
}
const ocrAvailable = () => { try { cp.execFileSync("tesseract", ["--version"], { stdio: "ignore" }); return true; } catch (e) { return false; } };

/* Content-addressed evidence store: identical graphics are stored once. */
function saveEvidence(dataRoot, buf, ext) {
  const h = U.sha256(buf), rel = `evidence/${h.slice(0, 2)}/${h}.${ext}`, full = path.join(dataRoot, rel);
  if (!fs.existsSync(full)) { U.mkdirp(path.dirname(full)); fs.writeFileSync(full, buf); }
  return { sha256: h, path: rel, bytes: buf.length, type: ext };
}

/* Collect every enabled product. prev: last record per product (for unchanged/stale detection). */
async function collect(cfg, loc, dataRoot, cap, prev = {}) {
  const ocr = ocrAvailable() ? tesseractOCR : null, robots = {}, out = [];
  /* robots.txt convention (RFC 9309): 200 = rules apply; other 4xx = no rules; 5xx, 429 or network error = don't fetch */
  const robotsStatus = {};
  const allowed = async (u) => { const o = new URL(u); if (!(o.origin in robots)) { const r = await U.fetchRaw(o.origin + "/robots.txt", { tries: 2 }); robotsStatus[o.origin] = r.status;
      robots[o.origin] = r.status === 200 ? r.text : r.status >= 400 && r.status < 500 && r.status !== 429 ? "" : null; }
    return robots[o.origin] == null ? null : U.robotsAllows(robots[o.origin], o.pathname + o.search); };
  for (const p of cfg.products) {
    const rec = { schema: 1, kind: "tv-product", captureId: cap.captureId, slot: cap.slot, slotTarget: cap.slotTarget, timeliness: cap.timeliness, loc: loc.id, market: cfg.market,
      station: p.station, product: p.id, type: p.type, label: p.label, url: p.url, authorship: p.authorship, location: p.location, lows: p.lows, popPolicy: p.pop, extractVersion: VERSION };
    if (!p.collect) { out.push({ ...rec, status: "not-collected", reason: p.reason }); continue; }
    const ok = await allowed(p.url);
    rec.robots = { status: robotsStatus[new URL(p.url).origin], allowed: ok };
    if (ok === null) { out.push({ ...rec, status: "failed", error: `robots.txt unavailable (HTTP ${rec.robots.status}); not fetched` }); continue; }
    if (!ok) { out.push({ ...rec, status: "not-collected", reason: "robots.txt disallows this URL" }); continue; }
    const r = await U.fetchRaw(p.url, { accept: p.adapter === "wcpoGraphic" ? "image/*" : "text/html", tries: 2 });
    rec.retrievedAt = r.retrievedAt; rec.httpStatus = r.status; rec.lastModified = r.lastModified || null;
    if (!r.ok || !r.buf.length) { out.push({ ...rec, status: "failed", error: r.error || `HTTP ${r.status}` }); continue; }
    const ext = /png/.test(r.type) ? "png" : /jpe?g/.test(r.type) ? "jpg" : "html";
    rec.evidence = [saveEvidence(dataRoot, ext === "html" ? U.gz(r.buf) : r.buf, ext === "html" ? "html.gz" : ext)];
    rec.evidence[0].contentSha256 = U.sha256(r.buf);
    const pv = prev[p.id];
    if (pv && pv.evidence && pv.evidence[0] && pv.evidence[0].contentSha256 === rec.evidence[0].contentSha256) rec.unchangedSince = pv.unchangedSince || pv.retrievedAt;
    let ex, tsv = null;
    if (p.adapter === "wcpoGraphic" && ocr) { try { tsv = ocr(r.buf); rec.evidence.push({ ...saveEvidence(dataRoot, Buffer.from(tsv), "ocr.tsv"), role: "ocr output (tesseract --psm 11 tsv)" }); } catch (e) { tsv = null; } }
    try { ex = A[p.adapter](ext === "html" ? r.text : r.buf, { loc, tsv, lastModified: r.lastModified, captureLocalDate: cap.localDate }); }
    catch (e) { ex = { days: [], confidence: 0, issues: [`extractor error: ${e.message}`] }; }
    /* a bot-challenge page is recognised by challenge markers AND no extractable content; never bypassed */
    if (r.type.includes("html") && !(ex.days || []).length && !ex.text && /cf-chl|challenge-platform|px-captcha|captcha-delivery|Access Denied/i.test(r.text.slice(0, 50000))) { out.push({ ...rec, status: "blocked", error: "bot challenge page; not bypassed" }); continue; }
    rec.extraction = { version: VERSION, method: p.adapter === "wcpoGraphic" ? "ocr-tesseract" : p.adapter === "wlwtStory" ? "text" : "structured-json", confidence: Math.round((ex.confidence || 0) * 100) / 100, issues: ex.issues || [] };
    rec.meta = ex.meta || {}; if (ex.text) rec.text = ex.text;
    rec.days = (ex.days || []).filter((d) => d.date);
    /* freshness: issue time evidence, age, and whether the first day is already in the past */
    const issued = p.adapter === "wcpoGraphic" ? r.lastModified && U.iso(Date.parse(r.lastModified)) : rec.meta.savedAt || rec.meta.dateModified || null;
    rec.issuedAt = issued || null;
    const ageH = issued ? (Date.parse(rec.retrievedAt) - Date.parse(issued)) / 3600e3 : null;
    const firstDate = rec.days.length ? rec.days[0].date : null;
    rec.freshness = { ageH: ageH == null ? null : Math.round(ageH * 10) / 10, stale: (ageH != null && ageH > 30) || (firstDate != null && firstDate < U.addDays(cap.localDate, -1)), firstDate, evidence: p.issueEvidence };
    /* review: structured data with no issues is accepted; graphics, stories and anything odd go to review */
    const auto = rec.extraction.method === "structured-json" && !rec.extraction.issues.length && rec.days.length > 0 && !rec.freshness.stale;
    const ocrOk = rec.extraction.method === "ocr-tesseract" && !rec.extraction.issues.length && rec.extraction.confidence >= 0.85 && !rec.freshness.stale;
    rec.review = { status: auto || ocrOk ? "auto-accepted" : "needs-review", reason: auto || ocrOk ? null : rec.freshness.stale ? "stale" : rec.extraction.issues[0] || "low confidence" };
    rec.status = "ok";
    out.push(rec);
  }
  /* cross-check: the WCPO graphic against the WCPO website data for overlapping dates */
  const g = out.find((x) => x.product === "wcpo-9day-graphic" && x.days && x.days.length), w = out.find((x) => x.product === "wcpo-web-4day" && x.days && x.days.length);
  if (g && w) {
    const diffs = [];
    g.days.forEach((d) => { const o = w.days.find((x) => x.date === d.date); if (!o) return; if (o.hi != null && d.hi != null && o.hi !== d.hi) diffs.push(`${d.date} high ${d.hi} vs web ${o.hi}`); if (o.lo != null && d.lo != null && o.lo !== d.lo) diffs.push(`${d.date} low ${d.lo} vs web ${o.lo}`); });
    g.crossCheck = { with: "wcpo-web-4day", diffs, overlap: g.days.filter((d) => w.days.some((x) => x.date === d.date)).length };
    if (diffs.length && g.review.status === "auto-accepted") g.review = { status: "needs-review", reason: "graphic and website disagree" };
  }
  return out;
}
module.exports = { VERSION, collect, adapters: A, parseGraphicTSV, assignDates, findJSON, sliceJSON, saveEvidence };
