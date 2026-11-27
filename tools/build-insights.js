#!/usr/bin/env node
/* Weather Records & Milestones: build the small precomputed pack a market's Overview and Almanac read, so neither page
   downloads a climate archive.

     node tools/build-insights.js [market-id ...] [--through YYYY-MM-DD] [--days 7]

   For each market in feeds/insights/markets.json it reads the full daily record once from RCC-ACIS (StnData, the
   market's official record: a threaded city record or a station), the 1991-2020 daily normals for the current month
   from the market's observing station, and each day's status from NCEI's quality-controlled archive (GHCN-Daily:
   present = "final"; otherwise "preliminary", the daily climate report / CF6 value carried by ACIS). It runs
   RecordsEngine.findings for the last N complete days and writes feeds/insights/<id>.json (a few KB) and
   feeds/insights/index.json. Times: a day is complete once the local date has passed in the market's time zone.
   Requires network access to data.rcc-acis.org and www.ncei.noaa.gov. Never writes model or forecast values. */
"use strict";
const fs = require("node:fs"), path = require("node:path");
const E = require("../assets/records-engine.js");
const root = path.resolve(__dirname, ".."), dir = path.join(root, "feeds/insights");
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ids = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const MARKETS = JSON.parse(fs.readFileSync(path.join(dir, "markets.json"), "utf8")).markets;
const post = async (url, body) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
const localDate = (tz, ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

async function build(m) {
  const through = opt("--through", E.addDays(localDate(m.tz), -1)), days = +opt("--days", 7);
  const recRes = await post("https://data.rcc-acis.org/StnData", { sid: m.record.sid, sdate: "por", edate: through, elems: ["pcpn", "snow", "maxt", "mint"], meta: ["name", "valid_daterange"] });
  if (recRes.error) throw new Error(`ACIS ${m.record.sid}: ${recRes.error}`);
  const rows = recRes.data, S = { pcpn: E.series(rows, 1), snow: E.series(rows, 2), maxt: E.series(rows, 3), mint: E.series(rows, 4) };
  const month0 = `${through.slice(0, 7)}-01`, monthEnd = E.addDays(E.addDays(`${through.slice(0, 7)}-28`, 4).slice(0, 7) + "-01", -1);
  const nor = await post("https://data.rcc-acis.org/StnData", { sid: m.normals.sid, sdate: month0, edate: monthEnd, elems: [{ name: "pcpn", normal: "1" }] }).catch(() => null);
  const ndaily = nor && nor.data ? nor.data.map((r) => [r[0], parseFloat(r[1])]).filter((r) => isFinite(r[1])) : [];
  /* final vs preliminary: is the day in NCEI's GHCN-Daily archive yet? */
  let finalThrough = null;
  if (m.ghcnd) { try {
    const u = `https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=${m.ghcnd}&startDate=${E.addDays(through, -days - 40)}&endDate=${through}&dataTypes=PRCP&format=json`;
    const j = await (await fetch(u)).json(); finalThrough = j.map((x) => x.DATE).sort().pop() || null; } catch (e) { finalThrough = null; } }
  const market = { id: m.id, name: m.name, country: m.country, region: m.region, tz: m.tz, lat: m.lat, lon: m.lon, radiusKm: m.radiusKm, units: m.units,
    record: { ...m.record, name: recRes.meta.name, por: recRes.meta.valid_daterange[0] }, normals: { sid: m.normals.sid, label: "1991-2020" } };
  const mon = ndaily.reduce((a, r) => a + r[1], 0);
  const normalsFor = (d) => (d.slice(0, 7) === through.slice(0, 7) && ndaily.length ? { month: +mon.toFixed(2), toDate: +ndaily.filter((r) => r[0] <= d).reduce((a, r) => a + r[1], 0).toFixed(2) } : null);
  const sources = [`RCC-ACIS StnData ${m.record.sid} (${recRes.meta.name}), retrieved ${new Date().toISOString().slice(0, 10)}`, m.ghcnd ? `NCEI GHCN-Daily ${m.ghcnd} (final through ${finalThrough || "unknown"})` : null, `1991-2020 normals, ACIS ${m.normals.sid}`].filter(Boolean);
  const out = E.pack({ market, S, through, days, finalThrough, normalsFor, thresholds: m.thresholds || { pcpn: 2 }, sources });
  /* write the new file only once it is complete (temp file, then rename): a failed refresh leaves the last good pack */
  const tmp = path.join(dir, `.${m.id}.json.tmp`); fs.writeFileSync(tmp, JSON.stringify(out, null, 1) + "\n"); fs.renameSync(tmp, path.join(dir, `${m.id}.json`));
  return { id: m.id, name: m.name, record: market.record.name, lat: m.lat, lon: m.lon, radiusKm: m.radiusKm, through, finalThrough, generated: out.generated, days: Object.keys(out.days) };
}
(async () => {
  const todo = MARKETS.filter((m) => !ids.length || ids.includes(m.id)), index = [];
  let failed = 0;
  for (const m of todo) { try { const r = await build(m); index.push(r); console.log(`${m.id}: through ${r.through}; final through ${r.finalThrough || "unknown"}; days with findings: ${r.days.join(", ") || "none"}`); }
    catch (e) { failed++; console.error(`${m.id}: refresh failed (${e.message || e}); its last pack stays in place`); } }
  const prev = fs.existsSync(path.join(dir, "index.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")).markets : [];
  const merged = [...prev.filter((p) => !index.some((x) => x.id === p.id)), ...index];
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ schema: 1, generated: new Date().toISOString(), markets: merged }, null, 1) + "\n");
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
