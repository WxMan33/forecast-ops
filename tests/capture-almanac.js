// Captures real USNO and RCC-ACIS responses for the Daily Almanac regression tests (needs internet).
// Saves full responses plus CORS headers, so the browser-side design can rely only on what the
// services actually allow. Run by .github/workflows/capture.yml.
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "fixtures", "almanac"); fs.mkdirSync(OUT, { recursive: true });
const UA = "forecast-ops almanac capture (github.com/WxMan33/forecast-ops)";
const save = (name, obj) => { fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj)); console.log("saved", name, Math.round(JSON.stringify(obj).length / 1024) + " KB", obj.status); };
async function get(url, opt = {}) {
  try {
    const r = await fetch(url, { ...opt, headers: { "User-Agent": UA, Origin: "https://wxman33.github.io", ...(opt.headers || {}) } });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { url, status: r.status, cors: r.headers.get("access-control-allow-origin"), date: r.headers.get("date"), json, text: json ? undefined : text.slice(0, 2000) };
  } catch (e) { return { url, error: String(e.message || e) }; }
}
const acis = (body) => get("https://data.rcc-acis.org/StnData", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
(async () => {
  /* USNO: one consistent point for each test; NOAA reference point downtown and the CVG site */
  const pts = { downtown: "39.124556,-84.50386", cvg: "39.04456,-84.67229" };
  for (const d of ["2026-11-03", "2026-11-02", "2026-11-01", "2026-10-31", "2026-03-07", "2026-03-08", "2026-03-09", "2028-02-28", "2028-02-29", "2028-03-01", "2026-06-20", "2026-06-21"]) {
    save(`usno-downtown-${d}.json`, await get(`https://aa.usno.navy.mil/api/rstt/oneday?date=${d}&coords=${pts.downtown}&tz=-5&dst=true`));
  }
  save("usno-cvg-2026-11-03.json", await get(`https://aa.usno.navy.mil/api/rstt/oneday?date=2026-11-03&coords=${pts.cvg}&tz=-5&dst=true`));
  save("usno-moonphases-2026-11-01.json", await get("https://aa.usno.navy.mil/api/moon/phases/date?date=2026-11-01&nump=8"));
  /* ACIS station metadata: threaded Cincinnati record vs CVG airport */
  for (const sid of ["CVGthr", "CVG"]) save(`acis-meta-${sid}.json`, await acis({ sid, meta: ["name", "sids", "ll", "elev", "valid_daterange", "uid"], elems: ["maxt", "mint", "pcpn", "snow"], sdate: "2026-11-01", edate: "2026-11-01" }));
  /* daily records: every year's value on one calendar day (yearly interval stepping back from edate) */
  for (const md of ["2025-11-03", "2024-02-29", "2025-03-01"]) save(`acis-records-CVGthr-${md}.json`, await acis({ sid: "CVGthr", sdate: "por", edate: md, elems: [{ name: "maxt", interval: [1, 0, 0] }, { name: "mint", interval: [1, 0, 0] }, { name: "pcpn", interval: [1, 0, 0] }, { name: "snow", interval: [1, 0, 0] }], meta: ["name", "valid_daterange"] }));
  /* normals (1991-2020 daily normals) for CVG for whole months incl. February of a leap year */
  for (const [s, e] of [["2026-11-01", "2026-11-30"], ["2028-02-01", "2028-02-29"], ["2026-07-01", "2026-07-31"]]) save(`acis-normals-CVG-${s.slice(0, 7)}.json`, await acis({ sid: "CVG", sdate: s, edate: e, elems: [{ name: "maxt", normal: "1" }, { name: "mint", normal: "1" }, { name: "pcpn", normal: "1" }, { name: "snow", normal: "1" }], meta: ["name"] }));
  save("acis-normals-CVGthr-2026-11.json", await acis({ sid: "CVGthr", sdate: "2026-11-01", edate: "2026-11-05", elems: [{ name: "maxt", normal: "1" }, { name: "pcpn", normal: "1" }], meta: ["name"] }));
  /* observations, recent and a past winter (traces, missing, snow) */
  save("acis-obs-CVG-recent.json", await acis({ sid: "CVG", sdate: "2026-07-01", edate: "2026-11-03", elems: ["maxt", "mint", "pcpn", "snow", "snwd"], meta: ["name"] }));
  save("acis-obs-CVG-2025-winter.json", await acis({ sid: "CVG", sdate: "2024-12-01", edate: "2025-03-31", elems: ["maxt", "mint", "pcpn", "snow", "snwd"], meta: ["name"] }));
  save("acis-obs-CVGthr-recent.json", await acis({ sid: "CVGthr", sdate: "2026-10-01", edate: "2026-11-03", elems: ["maxt", "mint", "pcpn", "snow"], meta: ["name"] }));
  /* month-to-date and season-to-date totals each year (for rankings), with missing counts */
  save("acis-mtd-CVGthr-2026-11-02.json", await acis({ sid: "CVGthr", sdate: "por", edate: "2026-11-02", elems: [{ name: "pcpn", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "sum", add: "mcnt" } }, { name: "maxt", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "mean", add: "mcnt" } }], meta: ["name"] }));
  save("acis-std-CVGthr-2026-02-15.json", await acis({ sid: "CVGthr", sdate: "por", edate: "2026-02-15", elems: [{ name: "snow", interval: [1, 0, 0], duration: "std", season_start: "07-01", reduce: { reduce: "sum", add: "mcnt" } }], meta: ["name"] }));
  /* v2: records anchored to the calendar day (yearly step from the first year), groupby form, leap day */
  for (const md of ["11-03", "03-01", "02-28", "07-04", "11-02", "12-25", "01-19"]) save(`acis-records2-CVGthr-${md}.json`, await acis({ sid: "CVGthr", sdate: `1871-${md}`, edate: `2025-${md}`, elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, interval: [1, 0, 0] })), meta: ["name"] }));
  for (const md of ["02-29", "11-03"]) save(`acis-groupby-CVGthr-${md}.json`, await acis({ sid: "CVGthr", sdate: "por", edate: "2025-12-31", elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, interval: "dly", duration: "dly", groupby: ["year", md, md] })), meta: ["name"] }));
  save("acis-mtd2-CVGthr-11-02.json", await acis({ sid: "CVGthr", sdate: "1871-11-02", edate: "2026-11-02", elems: [{ name: "pcpn", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "sum", add: "mcnt" } }, { name: "snow", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "sum", add: "mcnt" } }], meta: ["name"] }));
  save("acis-std2-CVGthr-02-15.json", await acis({ sid: "CVGthr", sdate: "1893-02-15", edate: "2026-02-15", elems: [{ name: "snow", interval: [1, 0, 0], duration: "std", season_start: "07-01", reduce: { reduce: "sum", add: "mcnt" } }], meta: ["name"] }));
  save("acis-obs-CVG-2024-02.json", await acis({ sid: "CVG", sdate: "2024-02-01", edate: "2024-03-02", elems: ["maxt", "mint", "pcpn", "snow", "snwd"], meta: ["name"] }));
  /* v3: leap-day record forms */
  const E = ["maxt", "mint", "pcpn", "snow"];
  save("acis-leap-A-int4.json", await acis({ sid: "CVGthr", sdate: "1872-02-29", edate: "2024-02-29", elems: E.map((name) => ({ name, interval: [4, 0, 0] })) }));
  save("acis-leap-B-int1.json", await acis({ sid: "CVGthr", sdate: "1872-02-29", edate: "2024-02-29", elems: E.map((name) => ({ name, interval: [1, 0, 0] })) }));
  save("acis-leap-C-groupby3.json", await acis({ sid: "CVGthr", sdate: "1872-01-01", edate: "2025-12-31", elems: E.map((name) => ({ name, interval: "dly", duration: "dly", groupby: ["year", "02-28", "03-01"] })) }));
  /* NOAA GML solar calculator table at the user's reference point (comparison only) */
  const t = await get("https://gml.noaa.gov/grad/solcalc/table.php?lat=39.124556&lon=-84.50386&year=2026");
  save("noaa-solcalc-2026.json", { ...t, text: undefined, html: t.text === undefined ? null : undefined });
  try { const r = await fetch("https://gml.noaa.gov/grad/solcalc/table.php?lat=39.124556&lon=-84.50386&year=2026", { headers: { "User-Agent": UA } }); fs.writeFileSync(path.join(OUT, "noaa-solcalc-2026.html"), await r.text()); } catch (e) { /* recorded above */ }
  /* timeanddate.com: comparison reference only (no runtime use). robots.txt is checked with the same
     parser as the TV collector (wildcards included): URLs with "?" are disallowed there, so only the
     plain city page (current month) is fetched, and only if allowed. */
  try {
    const U = require("../verify/lib/util.js");
    const rb = await fetch("https://www.timeanddate.com/robots.txt", { headers: { "User-Agent": UA } }); const txt = rb.ok ? await rb.text() : "";
    const ok = rb.ok && U.robotsAllows(txt, "/sun/usa/cincinnati");
    fs.writeFileSync(path.join(OUT, "timeanddate-robots.json"), JSON.stringify({ status: rb.status, plainPageAllowed: ok, queryPagesAllowed: U.robotsAllows(txt, "/sun/usa/cincinnati?month=11&year=2026") }));
    /* 2026-11-03: the allowed page answers automated requests with a Cloudflare challenge; challenges are
       never bypassed, so nothing is saved. Compare by hand in a browser instead. */
    if (ok) { const r = await fetch("https://www.timeanddate.com/sun/usa/cincinnati", { headers: { "User-Agent": UA } }); const h = await r.text(); const challenged = /Just a moment|cf-chl|challenge-platform/i.test(h);
      fs.writeFileSync(path.join(OUT, "timeanddate-robots.json"), JSON.stringify({ status: rb.status, plainPageAllowed: ok, queryPagesAllowed: false, plainPageStatus: r.status, botChallenge: challenged }));
      if (!challenged) fs.writeFileSync(path.join(OUT, "timeanddate-cincinnati-current.html"), h); }
  } catch (e) { console.log("timeanddate capture failed", e.message); }
  fs.writeFileSync(path.join(OUT, "capture-meta.json"), JSON.stringify({ capturedAt: new Date().toISOString() }));
})();
