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
      thru ? cached(`acisRank2:${thru}`, 6 * H, () => acis({ sid: CLIM.recordsSid, sdate: `${CLIM.firstYear + 1}-${thru.slice(5)}`, edate: thru, elems: [
        { name: "pcpn", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "sum", add: "mcnt" } },
        { name: "pcpn", interval: [1, 0, 0], duration: "std", season_start: met.startMD, reduce: { reduce: "sum", add: "mcnt" } },
        { name: "avgt", interval: [1, 0, 0], duration: "std", season_start: met.startMD, reduce: { reduce: "mean", add: "mcnt" } }], meta: ["name"] })) : Promise.resolve(null),
    ]);
    if (my !== run) return;
    /* leap day: the middle value of Feb 28 - Mar 1, in leap years only (ACIS's yearly step would substitute Feb 28 in 1900) */
    let recRows = rec.v && rec.v.data ? rec.v.data : null;
    if (recRows && md === "02-29") { const leap = (yy) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0; recRows = recRows.filter((r) => leap(+r[0])).map((r) => [`${r[0]}-02-29`, ...r.slice(1).map((x) => x[1])]); }
    const R = recRows ? A.records(recRows) : null;
    const nRows = nor.v && nor.v.data ? nor.v.data : [], nMap = new Map(nRows.map((r) => [r[0], r]));
    const oRows = obs && obs.v && obs.v.data ? obs.v.data : [];
    const col = (k) => (rk && rk.v && rk.v.data ? rk.v.data.map((r) => [r[0], r[k]]) : null);
    climData = { R, nRows, oRows, thru, sel, met, rank: col(1), rankSeasonP: col(2), rankSeasonT: col(3) };
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

  /* ---------- weather numbers ---------- */
  function facts() {
    const el = $("factCard"), d = climData; if (!d) return;
    const hiT = +O.store.get("alm_hiT", 80), loT = +O.store.get("alm_loT", 32);
    let body = "";
    if (!d.thru || !d.oRows.length) body = '<p class="msg unavail">Needs observed data before the sheet date.</p>';
    else {
      const ds = A.dryStreak(d.oRows, d.thru), m0 = d.thru.slice(0, 8) + "01", y0 = d.thru.slice(0, 4) + "-01-01";
      const cH = (from) => A.countDays(d.oRows, from, d.thru, 1, (x) => x >= hiT), cL = (from) => A.countDays(d.oRows, from, d.thru, 2, (x) => x <= loT);
      const rk = d.rank ? A.rank(d.rank, +d.thru.slice(0, 4)) : null;
      const recHigh = d.R && d.R.highMax, selObs = d.oRows.find((r) => r[0] === d.sel);
      const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
      body = `<dl class="kv">
        <dt>Days without measurable precip<small>CVG, through ${esc(fmtDate(d.thru, { month: "short", day: "numeric" }))}; trace is not measurable</small></dt><dd>${ds.atLeast ? "at least " : ""}${ds.days}<small>${ds.endedBy === "measurable" ? `last ${ds.amount.toFixed(2)}″ on ${esc(fmtDate(ds.at, { month: "short", day: "numeric" }))}` : ds.endedBy === "missing" ? `stops at a missing day (${esc(ds.at)})` : `data window starts ${esc(ds.from)}`}</small></dd>
        <dt>Days with high ≥ <input class="input mono thr" id="hiT" value="${hiT}" aria-label="High threshold °F">°F<small>CVG; month / year to date</small></dt><dd>${(() => { const a = cH(m0), b = cH(y0); return `${a.n} / ${b.n}${a.missing || b.missing ? `<small>${a.missing + b.missing} missing days not counted</small>` : ""}`; })()}</dd>
        <dt>Days with low ≤ <input class="input mono thr" id="loT" value="${loT}" aria-label="Low threshold °F">°F</dt><dd>${(() => { const a = cL(m0), b = cL(y0); return `${a.n} / ${b.n}`; })()}</dd>
        <dt>Month-to-date precip rank<small>${esc(CLIM.recordsName)}; wettest = 1; same dates each year; years with missing days excluded</small></dt><dd>${!rk ? "—" : rk.available ? `${ordinal(rk.rank)} wettest of ${rk.of}${rk.ties.length ? `<small>tied with ${rk.ties.slice(0, 6).join(", ")}${rk.ties.length > 6 ? "…" : ""}</small>` : ""}<small>${rk.from}–${rk.to}${rk.excluded ? `; ${rk.excluded} yrs excluded` : ""}</small>` : `<span class="unavail">${esc(rk.why)}</span>`}</dd>
        ${(() => {
          const mt = d.met, ps = A.accumulate(d.oRows, d.nRows, mt.start, d.thru, 3), ts = A.meanTemps(d.oRows, d.nRows, mt.start, d.thru);
          const rp = d.rankSeasonP ? A.rank(d.rankSeasonP, +d.thru.slice(0, 4)) : null, rt = d.rankSeasonT ? A.rank(d.rankSeasonT, +d.thru.slice(0, 4)) : null;
          const rkTxt = (r, word) => (!r ? "" : r.available ? `<small>${ordinal(r.rank)} ${word} of ${r.of} (${r.from}–${r.to}${r.ties.length ? `; tied with ${r.ties.slice(0, 4).join(", ")}` : ""}${r.excluded ? `; ${r.excluded} yrs excluded` : ""})</small>` : `<small>rank unavailable: ${esc(r.why)}</small>`);
          const sgn = (x, dd) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dd)}`;
          return `<dt>${esc(mt.name)} to date: precip<small>CVG, ${esc(fmtDate(mt.start, { month: "short", day: "numeric" }))}–${esc(fmtDate(d.thru, { month: "short", day: "numeric", year: "numeric" }))}; normal over the same dates; rank from the threaded record</small></dt>
            <dd>${ps.complete ? (ps.traceOnly ? "T" : ps.total.toFixed(2) + "″") : `<span class="unavail">incomplete (${ps.missing.length} days missing)</span>`}${ps.normalMissing.length ? `<small class="unavail">no normal for ${ps.normalMissing.length} of ${ps.days} days: no departure</small>` : ps.normal != null ? `<small>normal ${ps.normal.toFixed(2)}″${ps.departure != null ? ` · ${sgn(ps.departure, 2)}″` : ""}</small>` : ""}${rkTxt(rp, "wettest")}</dd>
            <dt>${esc(mt.name)} to date: temperature<small>mean high / mean low, and mean (high+low)/2 vs normal</small></dt>
            <dd>${ts.meanHigh != null ? `${ts.meanHigh.toFixed(1)}° / ${ts.meanLow.toFixed(1)}°` : "—"}${ts.complete ? `<small>mean ${ts.mean.toFixed(1)}° vs normal ${ts.normalMean.toFixed(1)}° · ${sgn(ts.departure, 1)}°</small>` : `<small class="unavail">${ts.missing.length ? `${ts.missing.length} days missing` : ""}${ts.normalMissing.length ? ` no normal for ${ts.normalMissing.length} days` : ""}: no departure</small>`}${rkTxt(rt, "warmest")}</dd>`;
        })()}
        <dt>Observed high vs record<small>sheet date; record ${recHigh ? `${recHigh.from}–${recHigh.to}` : ""}</small></dt><dd>${selObs && recHigh && !A.val(selObs[1]).missing ? `${A.val(selObs[1]).v - recHigh.value >= 0 ? "+" : "−"}${Math.abs(A.val(selObs[1]).v - recHigh.value)}°F<small>${A.val(selObs[1]).v}° vs ${recHigh.value}° (${recHigh.years.join(", ")})</small>` : '<span class="unavail">sheet date not yet observed</span>'}</dd>
      </dl>`;
    }
    el.innerHTML = `<details class="fold" open><summary><span class="section-title" style="margin:0">Weather numbers</span></summary><div style="margin-top:8px">${body}</div>
      <div class="src">Computed in the browser from the ACIS data shown on this sheet. Every figure names its station, period and dates; missing days are reported, never filled.</div></details>`;
    ["hiT", "loT"].forEach((k) => { const i = $(k); if (i) i.addEventListener("change", () => { const n = parseFloat(i.value); if (isFinite(n)) { O.store.set("alm_" + k, n); facts(); } }); });
  }

  /* ---------- forecast (existing NWS loader) ---------- */
  async function forecastCard(my, loc) {
    const el = $("fcCard");
    const N = await O.Data.loadNWS({ lat: loc.lat, lon: loc.lon });
    if (my !== run) return;
    if (!N || !N.ok) { el.innerHTML = `<div class="section-title">Forecast</div><p class="msg unavail">NWS forecast unavailable: ${esc((N && N.reason) || "no data")}.</p>`; return; }
    const tz = N.tz || CLIM.tz, dayOf = (ms) => C.time.toLocal(ms, tz).slice(0, 10);
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
