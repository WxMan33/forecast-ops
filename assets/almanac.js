/* Daily Almanac: a printable forecast sheet. Sources, all official and documented:
   - Sun and moon: USNO Astronomical Applications API (rstt/oneday, moon/phases), one point per sheet.
   - Climate: RCC-ACIS web services. Records: "Cincinnati Area" threaded record (ACIS CVGthr).
     Normals and observations: Cincinnati/Northern Kentucky Intl Airport (CVG), NCEI 1991-2020 normals.
   - Forecast: the site's existing NWS loader (api.weather.gov) for the forecast location.
   Each card loads independently; a failing source shows as unavailable without breaking the others. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core, A = window.AlmanacCore, esc = O.esc;
  const DATE_PARAM = new URLSearchParams(location.search).get("date"); // read before the shell rewrites the query
  O.shell("almanac", "Almanac");
  const CLIM = {
    tz: "America/New_York", recordsSid: "CVGthr", recordsName: "Cincinnati Area threaded record (ACIS CVGthr)",
    obsSid: "CVG", obsName: "Cincinnati/N. Kentucky Intl Airport (CVG, ACIS uid 8337)", normalsName: "CVG, NCEI 1991–2020 daily normals",
    cvg: { name: "CVG climate site", lat: 39.04456, lon: -84.67229 }, firstYear: 1871,
    noaa: { name: "Cincinnati (NOAA solar table point)", lat: 39.124556, lon: -84.50386 },
  };

  /* ---------- small cache (localStorage, per item age) ---------- */
  const cget = (k, maxMs) => { try { const c = JSON.parse(localStorage.getItem("alm:" + k)); if (c && Date.now() - c.at < maxMs) return c; } catch (e) { /* none */ } return null; };
  const cset = (k, v) => {
    const put = () => localStorage.setItem("alm:" + k, JSON.stringify({ at: Date.now(), v }));
    try { put(); } catch (e) { try { Object.keys(localStorage).filter((x) => x.startsWith("alm:")).slice(0, 60).forEach((x) => localStorage.removeItem(x)); put(); } catch (e2) { /* storage unavailable */ } }
  };
  async function cached(k, maxMs, fn) {
    const c = cget(k, maxMs); if (c) return { v: c.v, at: c.at, cached: true };
    const v = await fn(); if (v && !v.error) cset(k, v); return { v, at: Date.now(), cached: false };
  }
  const getJ = (url, opt) => fetch(url, opt).then((r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` })).catch((e) => ({ error: String(e.message || e) }));
  const acis = (body) => getJ("https://data.rcc-acis.org/StnData", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((j) => (j && j.error ? { error: typeof j.error === "string" ? j.error : "ACIS error" } : j));
  const H = 3600e3, D = 86400e3;

  /* ---------- state ---------- */
  const todayIn = (tz) => C.time.toLocal(Date.now(), tz).slice(0, 10);
  let sel = /^\d{4}-\d{2}-\d{2}$/.test(DATE_PARAM || "") ? DATE_PARAM : todayIn(CLIM.tz);
  const keepDate = () => { const u = new URL(location.href); u.searchParams.set("date", sel); history.replaceState(null, "", u); };
  let astro = O.store.get("alm_astro2", "noaa"), run = 0;
  $("astroPoint").value = astro;
  const setDate = (d) => { sel = d; $("almDate").value = d; keepDate(); render(); };
  $("almDate").value = sel;
  $("almDate").addEventListener("change", () => $("almDate").value && setDate($("almDate").value));
  $("todayBtn").addEventListener("click", () => setDate(todayIn(CLIM.tz)));
  $("prevDay").addEventListener("click", () => setDate(A.addDays(sel, -1)));
  $("nextDay").addEventListener("click", () => setDate(A.addDays(sel, 1)));
  $("astroPoint").addEventListener("change", () => { astro = $("astroPoint").value; O.store.set("alm_astro2", astro); render(); });
  O.locationCard($("locCard"), () => render());

  const fmtDate = (d, opt = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...opt });
  const clock = (ms, tz) => { const s = C.time.toLocal(ms, tz); let h = +s.slice(11, 13); const m = s.slice(14, 16), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${m} ${ap} ${C.time.abbr(ms, tz)}`; };
  const stamp = (at, cachedFlag) => `retrieved ${new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${cachedFlag ? " (cached)" : ""}`;
  const pr = (x, d = 2) => (x == null ? "—" : x.toFixed(d));

  /* time zone and standard offset of a point (Open-Meteo's timezone lookup, cached) */
  async function tzOf(lat, lon) {
    const r = await cached(`tz:${lat.toFixed(3)},${lon.toFixed(3)}`, 30 * D, () => getJ(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&daily=temperature_2m_max`).then((j) => (j && j.timezone ? { tz: j.timezone } : { error: "no timezone" })));
    return r.v && r.v.tz ? r.v.tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  async function render() {
    const my = ++run, loc = O.location;
    const pt = astro === "cvg" ? CLIM.cvg : astro === "noaa" ? CLIM.noaa : { name: loc.name, lat: +loc.lat, lon: +loc.lon };
    const tzA = await tzOf(pt.lat, pt.lon);
    if (my !== run) return;
    const today = todayIn(CLIM.tz), future = sel > today;
    $("sheetTitle").textContent = `Daily Almanac · ${fmtDate(sel, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`;
    $("sheetStamp").textContent = `Prepared ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
    $("locLine").innerHTML = `<span>Astronomy: <b>${esc(pt.name)}</b> (${pt.lat.toFixed(4)}, ${pt.lon.toFixed(4)}; ${esc(tzA)})</span>` +
      `<span>Climate: <b>Cincinnati</b> — records ${esc(CLIM.recordsName)}; normals and observations ${esc(CLIM.obsName)}</span>` +
      `<span>Forecast: <b>${esc(loc.name)}</b> (${(+loc.lat).toFixed(4)}, ${(+loc.lon).toFixed(4)})</span>`;
    loadNotes();
    renderSources(tzA);
    sunCard(my, pt, tzA);
    climate(my, today, future);
    forecastCard(my, loc);
  }

  /* ---------- sun and moon ---------- */
  async function usnoDay(d, pt, tz) {
    const jan = C.time.offsetMin(Date.parse(d.slice(0, 4) + "-01-15T12:00:00Z"), tz), jul = C.time.offsetMin(Date.parse(d.slice(0, 4) + "-07-15T12:00:00Z"), tz);
    const std = Math.min(jan, jul) / 60, usDst = jan !== jul && /^America\//.test(tz);
    /* every USNO time carries ST/DT; instants are exact either way. Outside US DST rules ask for standard time and convert. */
    const url = `https://aa.usno.navy.mil/api/rstt/oneday?date=${d}&coords=${pt.lat.toFixed(4)},${pt.lon.toFixed(4)}&tz=${std}&dst=${usDst}`;
    return cached(`usno:${d}:${pt.lat.toFixed(4)},${pt.lon.toFixed(4)}:${std}:${usDst}`, 30 * D, () => getJ(url));
  }
  /* Sun: NOAA Solar Calculator algorithm (matches NOAA's yearly table to the minute; instants carry seconds).
     Moon: USNO (phase, illumination, moonrise/set). One point for everything. */
  const sunFor = (d, pt, tz) => A.noaaSun(d, pt.lat, pt.lon, C.time.offsetMin(C.time.toUtc(`${d}T12:00`, tz), tz));
  async function sunCard(my, pt, tz) {
    const el = $("sunCard");
    const s = sunFor(sel, pt, tz), p = sunFor(A.addDays(sel, -1), pt, tz);
    const [a, ph] = await Promise.all([usnoDay(sel, pt, tz), cached(`usnoph:${sel}`, 30 * D, () => getJ(`https://aa.usno.navy.mil/api/moon/phases/date?date=${A.addDays(sel, -1)}&nump=5`))]);
    if (my !== run) return;
    const m = a.v && !a.v.error ? A.parseOneDay(a.v) : null;
    const tm = (ms) => (ms == null ? '<span class="unavail">none this date</span>' : clock(A.roundMin(ms), tz));
    const tmu = (x) => (x ? clock(x.ms, tz) : '<span class="unavail">none this date</span>');
    const ch = s.daylightSec != null && p.daylightSec != null ? s.daylightSec - p.daylightSec : null;
    const startMs = C.time.toUtc(`${sel}T00:00`, tz), np = ph.v && !ph.v.error ? A.nextPhase(ph.v, startMs) : null;
    el.innerHTML = `<div class="section-title">Sun and moon</div>
      <div class="big2"><div><span class="k">Sunrise</span><span class="v">${tm(s.rise)}</span></div><div><span class="k">Sunset</span><span class="v">${tm(s.set)}</span></div></div>
      <dl class="kv">
        <dt>Total daylight<small>sunset − sunrise, unrounded instants</small></dt><dd>${A.fmtHMS(s.daylightSec)}</dd>
        <dt>Change since ${esc(fmtDate(A.addDays(sel, -1), { month: "short", day: "numeric" }))}<small>same point and method (min:sec)</small></dt><dd>${A.fmtDelta(ch)}</dd>
        <dt>Moon<small>USNO</small></dt><dd>${m ? `${esc(m.phase || "—")}${m.illumination != null ? `, ${m.illumination}% lit` : ""}` : '<span class="unavail">USNO unavailable</span>'}</dd>
        <dt>Next primary phase</dt><dd>${np ? `${esc(np.phase)} · ${esc(fmtDate(C.time.toLocal(np.ms, tz).slice(0, 10), { weekday: "short", month: "short", day: "numeric" }))} ${clock(np.ms, tz)}` : '<span class="unavail">unavailable</span>'}</dd>
      </dl>
      <details class="fold" style="margin-top:8px"><summary><span class="msg">Twilight, solar noon, moonrise and moonset</span></summary>
        <dl class="kv" style="margin-top:6px">
          <dt>Civil twilight begins</dt><dd>${tm(s.civilBegin)}</dd><dt>Solar noon</dt><dd>${tm(s.noon)}</dd><dt>Civil twilight ends</dt><dd>${tm(s.civilEnd)}</dd>
          <dt>Moonrise<small>USNO</small></dt><dd>${m ? tmu(m.moon.rise) : "—"}</dd><dt>Moon transit</dt><dd>${m ? tmu(m.moon.transit) : "—"}</dd><dt>Moonset</dt><dd>${m ? tmu(m.moon.set) : "—"}</dd>
        </dl><p class="msg" style="margin-top:4px">Moon events listed for this calendar date only; "none" means it doesn't occur that date.</p></details>
      <div class="src">Sun: NOAA Solar Calculator algorithm (gml.noaa.gov/grad/solcalc) at ${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}; times shown to the minute exactly as NOAA's table rounds them; daylight from unrounded instants. Moon: USNO API${m ? ` ${esc(m.apiversion || "")}` : ""} · ${stamp(a.at, a.cached)}</div>`;
  }

  /* ---------- climate ---------- */
  let climData = null;
  async function climate(my, today, future) {
    const el = $("climCard"), fl = $("factCard");
    const thru = future ? null : A.addDays(sel, -1); // "yesterday" relative to the sheet date
    const anchor = thru || sel, y = +anchor.slice(0, 4);
    const seasonStart = `${+anchor.slice(5, 7) >= 7 ? y : y - 1}-07-01`, yearStart = `${y}-01-01`, monthStart = anchor.slice(0, 8) + "01";
    const met = A.metSeason(anchor);
    const nStart = [seasonStart, yearStart, met.start].sort()[0], nEnd = [sel, anchor].sort().pop();
    const md = sel.slice(5), recThru = +sel.slice(0, 4) - 1;
    const recentObs = thru && thru >= A.addDays(today, -45);
    const [nor, obs, rec, rk] = await Promise.all([
      cached(`acisN:${nStart}:${nEnd}`, 30 * D, () => acis({ sid: CLIM.obsSid, sdate: nStart, edate: nEnd, elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, normal: "1" })), meta: ["name"] })),
      thru ? cached(`acisO:${A.addDays(nStart, -150)}:${thru}`, recentObs ? H : 7 * D, () => acis({ sid: CLIM.obsSid, sdate: A.addDays(nStart, -150), edate: thru, elems: ["maxt", "mint", "pcpn", "snow", "snwd"], meta: ["name", "valid_daterange"] })) : Promise.resolve(null),
      cached(`acisR:${md}:${recThru}`, 7 * D, () => (md === "02-29"
        ? acis({ sid: CLIM.recordsSid, sdate: `${CLIM.firstYear}-01-01`, edate: `${recThru}-12-31`, elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, interval: "dly", duration: "dly", groupby: ["year", "02-28", "03-01"] })), meta: ["name", "valid_daterange"] })
        : acis({ sid: CLIM.recordsSid, sdate: `${CLIM.firstYear}-${md}`, edate: `${recThru}-${md}`, elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, interval: [1, 0, 0] })), meta: ["name", "valid_daterange"] }))),
      thru ? cached(`acisRank3:${thru}`, 6 * H, () => acis({ sid: CLIM.recordsSid, sdate: `${CLIM.firstYear + 1}-${thru.slice(5)}`, edate: thru, elems: [
        { name: "pcpn", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "sum", add: "mcnt" } },
        { name: "pcpn", interval: [1, 0, 0], duration: "std", season_start: met.startMD, reduce: { reduce: "sum", add: "mcnt" } },
        { name: "avgt", interval: [1, 0, 0], duration: "std", season_start: met.startMD, reduce: { reduce: "mean", add: "mcnt" } },
        { name: "avgt", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "mean", add: "mcnt" } }], meta: ["name"] })) : Promise.resolve(null),
    ]);
    if (my !== run) return;
    /* leap day: the middle value of Feb 28 - Mar 1, in leap years only (ACIS's yearly step would substitute Feb 28 in 1900) */
    let recRows = rec.v && rec.v.data ? rec.v.data : null;
    if (recRows && md === "02-29") { const leap = (yy) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0; recRows = recRows.filter((r) => leap(+r[0])).map((r) => [`${r[0]}-02-29`, ...r.slice(1).map((x) => x[1])]); }
    const R = recRows ? A.records(recRows) : null;
    const nRows = nor.v && nor.v.data ? nor.v.data : [], nMap = new Map(nRows.map((r) => [r[0], r]));
    const oRows = obs && obs.v && obs.v.data ? obs.v.data : [];
    const col = (k) => (rk && rk.v && rk.v.data ? rk.v.data.map((r) => [r[0], r[k]]) : null);
    climData = { R, nRows, oRows, thru, sel, met, rankMonthP: col(1), rankSeasonP: col(2), rankSeasonT: col(3), rankMonthT: col(4) };
    const nd = nMap.get(sel), yd = thru ? oRows.find((r) => r[0] === thru) : null;
    const v = (s, d, u = "") => { const x = A.val(s); return x.missing ? '<span class="unavail" title="missing: not reported or not yet available">M</span>' : (x.trace ? "T" : d != null ? x.v.toFixed(d) : String(x.v)) + u; };
    const recTxt = (r, u = "°") => (!r ? '<span class="unavail">—</span>' : `${r.trace ? "T" : r.value}${u} <small>${r.years.length > 1 ? `tie: ${r.years.join(", ")}` : r.years[0]}</small>`);
    const acc = (from, col, d) => {
      if (!thru) return '<span class="unavail">future date: not yet observed</span>';
      const a = A.accumulate(oRows, nRows, from, thru, col);
      const tot = a.complete ? (a.traceOnly ? "T" : a.total.toFixed(d)) : `<span class="unavail">incomplete (${a.missing.length} day${a.missing.length > 1 ? "s" : ""} missing)</span>`;
      return `${tot}${a.normal != null ? ` <small>normal ${a.normal.toFixed(d)}${a.normalMissing.length ? ` (no normal for ${a.normalMissing.length} day${a.normalMissing.length > 1 ? "s" : ""})` : ""}${a.departure != null ? ` · ${a.departure >= 0 ? "+" : "−"}${Math.abs(a.departure).toFixed(d)}` : ""}</small>` : ""}`;
    };
    const thruTxt = thru ? fmtDate(thru, { month: "short", day: "numeric", year: "numeric" }) : "";
    el.innerHTML = `<div class="section-title">Daily climate · Cincinnati</div>
      <dl class="kv">
        <dt>Normal high / low<small>${esc(CLIM.normalsName)}</small></dt><dd>${nd ? `${v(nd[1], null, "°")} / ${v(nd[2], null, "°")}` : '<span class="unavail">unavailable</span>'}</dd>
        <dt>Record high<small>${R && R.highMax ? `${esc(CLIM.recordsName)}, ${R.highMax.from}–${R.highMax.to}${R.highMax.missingYears ? `; ${R.highMax.missingYears} yrs missing` : ""}` : ""}</small></dt><dd>${recTxt(R && R.highMax)}</dd>
        <dt>Record low</dt><dd>${recTxt(R && R.lowMin)}</dd>
        <dt>Record precipitation / snowfall<small>snowfall record ${R && R.snow ? `${R.snow.from}–${R.snow.to}` : ""}</small></dt><dd>${R && R.precip ? `${R.precip.trace ? "T" : R.precip.value.toFixed(2)}″ <small>${R.precip.years.join(", ")}</small>` : "—"} / ${R && R.snow ? `${R.snow.value.toFixed(1)}″ <small>${R.snow.value === 0 ? "none recorded" : R.snow.years.join(", ")}</small>` : "—"}</dd>
        ${thru ? `<dt>Observed ${esc(fmtDate(thru, { weekday: "short", month: "short", day: "numeric" }))} high / low<small>${esc(CLIM.obsName)}${thru >= A.addDays(today, -45) ? "; preliminary, may be revised" : ""}</small></dt><dd>${yd ? `${v(yd[1], null, "°")} / ${v(yd[2], null, "°")}` : '<span class="unavail">not yet reported</span>'}</dd>
        <dt>Observed precip / snowfall</dt><dd>${yd ? `${v(yd[3], 2, "″")} / ${v(yd[4], 1, "″")}` : '<span class="unavail">not yet reported</span>'}</dd>
        <dt>Month-to-date precip<small>${esc(fmtDate(thru.slice(0, 8) + "01", { month: "short", day: "numeric" }))}–${esc(thruTxt)}; normal over the same dates</small></dt><dd>${acc(thru.slice(0, 8) + "01", 3, 2)}</dd>
        <dt>Month-to-date snowfall</dt><dd>${acc(thru.slice(0, 8) + "01", 4, 1)}</dd>
        <dt>Year-to-date precip<small>Jan 1–${esc(thruTxt)}</small></dt><dd>${acc(thru.slice(0, 4) + "-01-01", 3, 2)}</dd>
        <dt>Season-to-date snowfall<small>Jul 1–${esc(thruTxt)}</small></dt><dd>${acc(seasonStart, 4, 1)}</dd>` : `<dt>Observations</dt><dd><span class="unavail">future date: not yet observed</span></dd>`}
      </dl>
      <div class="src">RCC-ACIS StnData · normals ${stamp(nor.at, nor.cached)} · records ${stamp(rec.at, rec.cached)}${obs ? ` · observations ${stamp(obs.at, obs.cached)}` : ""}${nor.v && nor.v.error ? ` · normals unavailable (${esc(nor.v.error)})` : ""}${rec.v && rec.v.error ? ` · records unavailable (${esc(rec.v.error)})` : ""}${obs && obs.v && obs.v.error ? ` · observations unavailable (${esc(obs.v.error)})` : ""}. T = trace (counted as 0, not measurable); M = missing (never counted as 0). Records run through ${recThru}.</div>`;
    facts();
  }

  /* ---------- weather numbers: four summary cards + operational row ---------- */
  let fcPeriods = null; // NWS periods for the forecast-vs-record line (set by the forecast card)
  function facts() {
    const el = $("factCard"), d = climData; if (!d) return;
    const hiT = +O.store.get("alm_hiT", 80), loT = +O.store.get("alm_loT", 32);
    if (!d.thru || !d.oRows.length) { el.innerHTML = `<div class="section-title">Weather numbers</div><p class="msg unavail">These need observations before the sheet date.</p>`; return; }
    const y = +d.thru.slice(0, 4), short = (x) => fmtDate(x, { month: "short", day: "numeric" });
    const sgn = (x, dd, unit) => `${Math.abs(x).toFixed(dd)}${unit}`;
    const periods = [
      { key: "month", label: `${fmtDate(d.thru, { month: "long" })} to date`, from: d.thru.slice(0, 8) + "01", rankT: d.rankMonthT, rankP: d.rankMonthP },
      { key: "season", label: `${d.met.name.split(" ")[0]} to date`, sub: d.met.name.replace(/^\w+ /, ""), from: d.met.start, rankT: d.rankSeasonT, rankP: d.rankSeasonP },
    ];
    const cards = [];
    periods.forEach((p) => {
      const days = A.dayDiff(p.from, d.thru) + 1, span = `${short(p.from)}–${short(d.thru)}`;
      const t = A.meanTemps(d.oRows, d.nRows, p.from, d.thru), pr = A.accumulate(d.oRows, d.nRows, p.from, d.thru, 3);
      /* temperature */
      const rt = p.rankT ? A.rankBoth(p.rankT, y) : null, lt = t.complete ? A.leadRank(rt, t.departure) : null;
      cards.push(card({ id: `${p.key}T`, period: `${p.label} · ${span}`, kind: "Temperature", days, rank: rt, lead: lt, words: { high: "warmest", low: "coldest" },
        primary: t.mean != null ? `${t.mean.toFixed(1)}°F` : "—", primaryNote: "mean temperature",
        dep: t.complete ? { v: t.departure, txt: t.departure === 0 ? "at normal" : `${sgn(t.departure, 1, "°F")} ${t.departure > 0 ? "above" : "below"} normal`, cls: t.departure > 0 ? "warm" : t.departure < 0 ? "cold" : "" } : null,
        support: t.meanHigh != null ? `Mean high ${t.meanHigh.toFixed(1)}° · mean low ${t.meanLow.toFixed(1)}°${t.normalMean != null && !t.normalMissing.length ? ` · normal ${t.normalMean.toFixed(1)}°` : ""}` : "",
        incomplete: !t.complete ? `${t.missing.length ? `${t.missing.length} of ${days} days missing` : ""}${t.normalMissing.length ? `${t.missing.length ? "; " : ""}no normal for ${t.normalMissing.length} days` : ""}` : null,
        method: "Mean temperature = average of the daily (high + low) / 2 over the same elapsed dates. Departure uses NCEI 1991–2020 daily normals for exactly those dates." }));
      /* precipitation */
      const rp = p.rankP ? A.rankBoth(p.rankP, y) : null, lp = pr.complete ? A.leadRank(rp, pr.departure) : null;
      const pct = pr.complete && pr.normal ? Math.round((pr.total / pr.normal) * 100) : null;
      cards.push(card({ id: `${p.key}P`, period: `${p.label} · ${span}`, kind: "Precipitation", days, rank: rp, lead: lp, words: { high: "wettest", low: "driest" },
        primary: !pr.complete ? "—" : pr.traceOnly ? "Trace" : `${pr.total.toFixed(2)}″`, primaryNote: "total",
        dep: pr.complete && pr.departure != null ? { v: pr.departure, txt: pr.departure === 0 ? "at normal" : `${sgn(pr.departure, 2, "″")} ${pr.departure > 0 ? "above" : "below"} normal`, cls: pr.departure > 0 ? "wet" : pr.departure < 0 ? "dry" : "" } : null,
        support: pr.normal != null && !pr.normalMissing.length ? `Normal ${pr.normal.toFixed(2)}″${pct != null ? ` · ${pct}% of normal` : ""}` : "",
        incomplete: !pr.complete ? `${pr.missing.length} of ${days} days missing` : pr.normalMissing.length ? `no normal for ${pr.normalMissing.length} days` : null,
        method: "Total of daily precipitation; a trace counts as 0 (not measurable). Normal = sum of NCEI 1991–2020 daily normals over the same dates." }));
    });
    /* operational row */
    const ds = A.dryStreak(d.oRows, d.thru), m0 = d.thru.slice(0, 8) + "01", y0 = d.thru.slice(0, 4) + "-01-01";
    const cnt = (from, col, test) => A.countDays(d.oRows, from, d.thru, col, test);
    const hm = cnt(m0, 1, (x) => x >= hiT), hy = cnt(y0, 1, (x) => x >= hiT), lm = cnt(m0, 2, (x) => x <= loT), ly = cnt(y0, 2, (x) => x <= loT);
    const traceSince = (() => { if (ds.endedBy !== "measurable" && !ds.atLeast) return 0; let n = 0; d.oRows.forEach((r) => { if (r[0] > ds.at && r[0] <= d.thru && A.val(r[3]).trace) n++; }); return n; })();
    /* record comparison: observed (if the sheet date is observed) or a labelled NWS forecast */
    const recH = d.R && d.R.highMax, selObs = d.oRows.find((r) => r[0] === d.sel), obsHi = selObs ? A.val(selObs[1]) : null;
    const fcHi = fcPeriods ? fcPeriods.find((x) => x.isDaytime && x.temp != null && C.time.toLocal(x.s, CLIM.tz).slice(0, 10) === d.sel) : null;
    const recLine = !recH ? null : obsHi && !obsHi.missing ? { k: "Observed high vs record", v: `${obsHi.v}° vs ${recH.value}°`, s: `${Math.abs(obsHi.v - recH.value)}° ${obsHi.v >= recH.value ? "above" : "below"} the record (${recH.years.join(", ")})` }
      : fcHi ? { k: "NWS forecast high vs record", v: `${Math.round(fcHi.temp)}° vs ${recH.value}°`, s: `forecast, not an observation · record ${recH.years.join(", ")}` } : null;
    const tile = (k, v, s2) => `<div class="optile"><span class="k">${k}</span><span class="v">${v}</span>${s2 ? `<span class="s">${s2}</span>` : ""}</div>`;
    el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><div class="section-title" style="margin:0">Weather numbers · Cincinnati</div>
        <button class="btn ghost sm" type="button" id="wnHow" aria-expanded="false" aria-controls="wnHowPanel">ⓘ HOW THESE ARE CALCULATED</button></div>
      <div class="infopanel" id="wnHowPanel" hidden>
        <p><b>Observed values</b> come from the Cincinnati/Northern Kentucky airport (CVG), observed through ${esc(fmtDate(d.thru, { month: "long", day: "numeric", year: "numeric" }))}. Recent days are preliminary and can be corrected. <b>Normals</b> are NCEI 1991–2020 daily normals for CVG. <b>Rankings</b> use the Cincinnati threaded record (the official city record joined across sites since 1871) for exactly the same elapsed dates in every year; meteorological winter runs Dec 1 to Feb 28/29 and crosses the calendar year. A year counts only if it has no missing days in that span. Ranks are competition ranks: tied years share a rank, and the opposite extreme is counted separately from the values, not by reversing the rank.</p>
        <p>Missing observations or normals are reported, never filled: an incomplete period shows no departure and no rank. Ranks over fewer than 7 days are shown but not highlighted. Trace precipitation is recorded but not measurable.</p></div>
      <div class="wngrid">${cards.join("")}</div>
      <div class="oprow">
        ${tile("Without measurable precip", `${ds.atLeast ? "≥ " : ""}${ds.days} day${ds.days === 1 ? "" : "s"}`, ds.endedBy === "measurable" ? `since ${ds.amount.toFixed(2)}″ on ${short(ds.at)}${traceSince ? ` · ${traceSince} day${traceSince > 1 ? "s" : ""} with a trace` : ""}` : ds.endedBy === "missing" ? `count stops at a missing day (${short(ds.at)})` : `data window starts ${short(ds.from)}`)}
        ${tile(`Highs ≥ <input class="input mono thr" id="hiT" value="${hiT}" aria-label="High threshold in °F">°F`, `Month ${hm.n} · Year ${hy.n}`, hm.missing + hy.missing ? `${hm.missing + hy.missing} missing days not counted` : "month to date · year to date")}
        ${tile(`Lows ≤ <input class="input mono thr" id="loT" value="${loT}" aria-label="Low threshold in °F">°F`, `Month ${lm.n} · Year ${ly.n}`, lm.missing + ly.missing ? `${lm.missing + ly.missing} missing days not counted` : "month to date · year to date")}
        ${recLine ? tile(recLine.k, recLine.v, recLine.s) : ""}
      </div>
      <div class="src">CVG observations through ${esc(short(d.thru))}; rankings: Cincinnati threaded record. ${!recLine && recH ? `Record comparison appears once ${esc(short(d.sel))} is observed or has an NWS forecast high.` : ""}</div>`;
    $("wnHow").addEventListener("click", (e) => { const pn = $("wnHowPanel"); pn.hidden = !pn.hidden; e.currentTarget.setAttribute("aria-expanded", String(!pn.hidden)); });
    el.querySelectorAll(".wninfo").forEach((b) => b.addEventListener("click", () => { const pn = $(b.getAttribute("aria-controls")); pn.hidden = !pn.hidden; b.setAttribute("aria-expanded", String(!pn.hidden)); }));
    ["hiT", "loT"].forEach((k) => { const inp = $(k); if (inp) inp.addEventListener("change", () => { const n = parseFloat(inp.value); if (isFinite(n)) { O.store.set("alm_" + k, n); facts(); } }); });
  }
  /* one summary card */
  function card(o) {
    const r = o.rank, L = o.lead, shortP = o.days < 7;
    const head = !L ? null : `${A.ordinal(L.rank)}${L.tied ? " (tie)" : ""} ${o.words[L.side]}`;
    const level = !L || shortP ? "typical" : L.level;
    const rankLine = !r ? "Ranking unavailable" : !r.available ? `Not ranked: ${r.why}` : o.incomplete ? "Not ranked: incomplete period" : `${head} of ${r.n} usable years (${r.from}–${r.to})`;
    const det = `${o.id}Det`;
    return `<article class="wncard ${level}">
      <div class="wnhead"><span class="wnper">${esc(o.period)}</span><span class="wnkind">${esc(o.kind)}</span></div>
      ${level === "strong" && head && !o.incomplete ? `<div class="wnbadge ${L.side === "high" ? (o.kind === "Temperature" ? "warm" : "wet") : (o.kind === "Temperature" ? "cold" : "dry")}">${esc(head)}</div>` : ""}
      <div class="wnbig">${o.primary}<small>${esc(o.primaryNote)}</small></div>
      ${o.incomplete ? `<div class="wndep unavail">Incomplete: ${esc(o.incomplete)}. No departure or rank.</div>` : o.dep ? `<div class="wndep ${o.dep.cls}">${esc(o.dep.txt)}</div>` : ""}
      ${o.support ? `<div class="wnsup">${esc(o.support)}</div>` : ""}
      <div class="wnrank${level === "notable" && !o.incomplete ? " notable" : ""}">${esc(rankLine)}${shortP && L && !o.incomplete ? " · short period, not highlighted" : ""}</div>
      <button class="wninfo" type="button" aria-expanded="false" aria-controls="${det}">ⓘ Details</button>
      <div class="wndet" id="${det}" hidden><dl class="kv">
        <dt>Period</dt><dd>${esc(o.period.split(" · ")[1])} (${o.days} days)</dd>
        <dt>Observed at</dt><dd>CVG airport</dd>
        <dt>Ranked in</dt><dd>Cincinnati threaded record</dd>
        ${r && r.available ? `<dt>${esc(o.words.high[0].toUpperCase() + o.words.high.slice(1))} rank</dt><dd>${A.ordinal(r.high.rank)} of ${r.n}</dd><dt>${esc(o.words.low[0].toUpperCase() + o.words.low.slice(1))} rank</dt><dd>${A.ordinal(r.low.rank)} of ${r.n}</dd>
          <dt>Value used for ranking</dt><dd>${r.value}${o.kind === "Temperature" ? "°F" : "″"}</dd><dt>Tied years</dt><dd>${r.ties.length ? esc(r.ties.join(", ")) : "none"}</dd>` : ""}
        ${r ? `<dt>Excluded years</dt><dd>${r.excludedCount ? `${r.excludedCount} (missing days)` : "none"}</dd>` : ""}
      </dl><p class="msg" style="margin-top:6px">${esc(o.method)}</p></div>
    </article>`;
  }

  /* ---------- forecast (existing NWS loader) ---------- */
  async function forecastCard(my, loc) {
    const el = $("fcCard");
    const N = await O.Data.loadNWS({ lat: loc.lat, lon: loc.lon });
    if (my !== run) return;
    if (!N || !N.ok) { el.innerHTML = `<div class="section-title">Forecast</div><p class="msg unavail">NWS forecast unavailable: ${esc((N && N.reason) || "no data")}.</p>`; return; }
    const tz = N.tz || CLIM.tz, dayOf = (ms) => C.time.toLocal(ms, tz).slice(0, 10);
    fcPeriods = N.periods || null; if (climData) facts();
    const pers = (N.periods || []).filter((p) => dayOf(p.s) === sel || (dayOf(p.s) === A.addDays(sel, 1) && p.isDaytime));
    const raw = (((N.parts.hourly || {}).properties || {}).periods || []);
    const g = N.parts.grid && N.parts.grid.properties, gust = g && g.windGust ? (ms) => C.nws.stateAt(g.windGust, [ms])[0] : () => null;
    const blocks = [["Morning", 6, 12], ["Afternoon", 12, 18], ["Evening", 18, 24]].map(([name, a, b]) => {
      const s = C.time.toUtc(`${sel}T${String(a).padStart(2, "0")}:00`, tz), e = b === 24 ? C.time.toUtc(`${A.addDays(sel, 1)}T00:00`, tz) : C.time.toUtc(`${sel}T${b}:00`, tz);
      const hs = raw.filter((p) => { const t = Date.parse(p.startTime); return t >= s && t < e; });
      if (!hs.length) return null;
      const temps = hs.map((p) => p.temperature).filter((x) => x != null), winds = hs.map((p) => (String(p.windSpeed || "").match(/\d+/g) || []).map(Number)).flat();
      const gs = hs.map((p) => gust(Date.parse(p.startTime))).filter((x) => x != null);
      const wx = Object.entries(hs.reduce((m, p) => ((m[p.shortForecast] = (m[p.shortForecast] || 0) + 1), m), {})).sort((x, y) => y[1] - x[1])[0][0];
      return { name, s, e, t: [Math.min(...temps), Math.max(...temps)], w: winds.length ? Math.max(...winds) : null, dir: hs[0].windDirection, g: gs.length ? Math.round(Math.max(...gs)) : null, wx, n: hs.length };
    }).filter(Boolean);
    el.innerHTML = `<div class="section-title">Forecast · ${esc(loc.name)}</div>
      ${pers.length ? pers.map((p) => `<div class="fcrow"><b>${esc(p.name)}</b><span>${p.temp != null ? `${p.isDaytime ? "High" : "Low"} ${Math.round(p.temp)}° · ` : ""}${p.pop != null ? `${p.pop}% · ` : ""}${esc(p.wind)} ${esc(p.dir)} · ${esc(p.short)}</span></div>`).join("") : '<p class="msg unavail">No NWS forecast periods for this date (forecasts are not archived here; future dates beyond about 7 days are not forecast).</p>'}
      ${blocks.length ? `<div class="fcrow" style="margin-top:6px"><b class="msg">Part of day</b><span class="msg">temperature · wind · gust · weather (NWS hourly)</span></div>` + blocks.map((x) => `<div class="fcrow"><b>${x.name}</b><span>${x.t[0] === x.t[1] ? `${x.t[0]}°` : `${x.t[0]}–${x.t[1]}°`} · ${x.w != null ? `${esc(x.dir)} ${x.w} mph` : "—"}${x.g != null ? ` · gusts ${x.g}` : ""} · ${esc(x.wx)}<small class="msg"> (${clock(x.s, tz)}–${clock(x.e, tz)}${x.n < 6 ? `, ${x.n} h available` : ""})</small></span></div>`).join("") : ""}
      <div class="src">NWS ${esc(N.office)} grid ${N.gridX},${N.gridY} · periods updated ${N.status.updated.forecast ? clock(N.status.updated.forecast, tz) : "—"} · hourly updated ${N.status.updated.hourly ? clock(N.status.updated.hourly, tz) : "—"}. Valid windows shown with each value.</div>`;
  }

  /* ---------- notes (this browser only; never mixed with sourced values) ---------- */
  const noteKey = () => `alm_notes:${(+O.location.lat).toFixed(3)},${(+O.location.lon).toFixed(3)}:${sel}`;
  function loadNotes() {
    const n = O.store.get(noteKey(), null);
    $("notes").value = n ? n.text : ""; $("printNotes").textContent = n ? n.text : "";
    $("notesState").textContent = n ? `saved ${new Date(n.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
  }
  let nt = null;
  $("notes").addEventListener("input", () => { clearTimeout(nt); nt = setTimeout(() => { const text = $("notes").value; if (text.trim()) O.store.set(noteKey(), { text, at: Date.now() }); else { try { localStorage.removeItem(noteKey()); } catch (e) { /* ignore */ } } loadNotes(); }, 400); });

  function renderSources(tz) {
    $("sourcesNote").innerHTML = `
      <div><b>Sun:</b> the NOAA Solar Calculator algorithm (the equations behind gml.noaa.gov/grad/solcalc and its yearly tables), computed in the browser for one point: by default NOAA's Cincinnati table point (39.124556, −84.50386). Sunrise and sunset are the sun's upper limb with standard refraction; they are shown to the minute exactly as NOAA's table rounds them (checked against every day of the 2026 table). Daylight and its day-to-day change use the unrounded instants, so they are given to the second, and daylight-saving changes never add or remove an hour. <b>Moon:</b> USNO Astronomical Applications API for the same point. timeanddate.com is a comparison reference only (no data feed is used).</div>
      <div><b>Records:</b> RCC-ACIS "Cincinnati Area" threaded record (CVGthr): the official historical city record joined across sites since 1871 (temperature from 1872, snowfall from 1893). Records on this sheet run through the year before the sheet date; ties list every year.</div>
      <div><b>Normals and observations:</b> CVG airport (Cincinnati/Northern Kentucky International, ACIS uid 8337, data since 1947). Normals are NCEI 1991–2020 daily normals. No precipitation or snowfall normal is published for Feb 29, and the sheet says so instead of using 0. Recent observations are preliminary and change when ACIS applies corrections. Each accumulation shows its start and "through" dates, and observed and normal totals cover exactly the same dates.</div>
      <div><b>Forecast:</b> National Weather Service point forecast for the forecast location (the site's NWS loader). Climate values are never relabelled as the forecast location's own.</div>`;
  }
  /* printing: include the sources section expanded */
  window.addEventListener("beforeprint", () => document.querySelectorAll(".almanac details").forEach((d) => { d.dataset.wasOpen = d.open ? "1" : ""; d.open = true; }));
  window.addEventListener("afterprint", () => document.querySelectorAll(".almanac details").forEach((d) => { d.open = d.dataset.wasOpen === "1"; }));
  keepDate();
  render();
})();
