/* Daily Almanac. No forecasts on this page (they live on Overview and Model Blend).
   Sun: NOAA Solar Calculator algorithm, computed here (matches NOAA's yearly table to the minute).
   Moon: USNO Astronomical Applications API (retrieved). Climate: RCC-ACIS web services at the climate station
   for the selected point (ClimateStation: nearest official NWS climate site in the point's office area) —
   records from its threaded city record where one exists, normals and observations from the station.
   Each card loads on its own; an unavailable source never breaks the others. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core, A = window.AlmanacCore, esc = O.esc;
  const DATE_PARAM = new URLSearchParams(location.search).get("date"); // read before the shell rewrites the query
  O.shell("almanac", "Almanac", { forecastPoint: false });
  /* the climate reference for this sheet, set from the selected point's climate station on every render */
  const CINCY = { noaa: { name: "Cincinnati (NOAA table point)", lat: 39.124556, lon: -84.50386 } };
  let CLIM = { tz: "America/New_York", recordsSid: "CVGthr", recordsName: "Cincinnati Area threaded record", obsSid: "CVG", obsName: "Cincinnati/Northern Kentucky International Airport", firstYear: 1871, office: "ILN", cincy: true, threaded: true, missing: [], station: null };
  const fromStation = (r) => { const st = r.station; if (!st) return null;
    return { tz: CLIM.tz, obsSid: st.faa, obsName: st.name, recordsSid: st.thr ? st.thr.sid : st.faa, recordsName: st.thr ? st.thr.name : `${st.name} station record`, threaded: !!st.thr,
      firstYear: (st.thr && st.thr.since) || st.since || 1900, office: st.office, cincy: st.faa === "CVG", missing: r.missing || [], station: st, alternatives: r.alternatives || [], pointOffice: r.pointOffice, override: r.override }; };
  /* provenance for the Source details panel, filled as each request completes */
  const prov = {};
  const note = (k, v) => { prov[k] = v; if (!$("srcPanel").hidden) renderSources(); };

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
  /* every request is bounded: after TIMEOUT_MS it resolves to an error so no card can stay "Loading" */
  const TIMEOUT_MS = 15000;
  const getJ = (url, opt = {}) => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const { timeoutMs = TIMEOUT_MS, ...init } = opt;
    const to = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    return fetch(url, ctl ? { ...init, signal: ctl.signal } : init)
      .then((r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
      .catch((e) => ({ error: e && e.name === "AbortError" ? `no response after ${timeoutMs / 1000} s` : String((e && e.message) || e) }))
      .finally(() => to && clearTimeout(to));
  };
  const acis = (body) => getJ("https://data.rcc-acis.org/StnData", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((j) => (j && j.error ? { error: typeof j.error === "string" ? j.error : "ACIS error" } : j));
  const H = 3600e3, D = 86400e3;

  /* ---------- state and header ---------- */
  const todayIn = (tz) => C.time.toLocal(Date.now(), tz).slice(0, 10);
  let sel = /^\d{4}-\d{2}-\d{2}$/.test(DATE_PARAM || "") ? DATE_PARAM : todayIn(CLIM.tz);
  let astro = O.store.get("alm_astro3", "loc"), run = 0; // astronomy follows the selected point by default
  const keepDate = () => { const u = new URL(location.href); u.searchParams.set("date", sel); history.replaceState(null, "", u); };
  const setDate = (d) => { sel = d; $("almDate").value = d; keepDate(); render(); };
  $("astroPoint").value = astro;
  $("almDate").value = sel;
  $("almDate").addEventListener("change", () => $("almDate").value && setDate($("almDate").value));
  $("todayBtn").addEventListener("click", () => setDate(todayIn(CLIM.tz)));
  $("prevDay").addEventListener("click", () => setDate(A.addDays(sel, -1)));
  $("nextDay").addEventListener("click", () => setDate(A.addDays(sel, 1)));
  $("astroPoint").addEventListener("change", () => { astro = $("astroPoint").value; O.store.set("alm_astro3", astro); render(); });
  $("climStn").addEventListener("change", () => { window.ClimateStation.setOverride(O.location, $("climStn").value === "auto" ? null : $("climStn").value); render(); });
  $("srcBtn").addEventListener("click", () => { const p = $("srcPanel"); p.hidden = !p.hidden; $("srcBtn").setAttribute("aria-expanded", String(!p.hidden)); if (!p.hidden) renderSources(); });

  const fmtDate = (d, opt = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...opt });
  const hm = (ms, tz) => { const s = C.time.toLocal(ms, tz); let h = +s.slice(11, 13); const m = s.slice(14, 16), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${m} ${ap}`; };
  const clock = (ms, tz) => `${hm(ms, tz)} ${C.time.abbr(ms, tz)}`;
  const stampTxt = (r) => (r ? `${new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${r.cached ? " (from this browser's cache)" : ""}` : "—");

  async function tzOf(lat, lon) {
    const r = await cached(`tz:${lat.toFixed(3)},${lon.toFixed(3)}`, 30 * D, () => getJ(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&daily=temperature_2m_max`).then((j) => (j && j.timezone ? { tz: j.timezone } : { error: "no timezone" })));
    return r.v && r.v.tz ? r.v.tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  const fetchJSON = (url, opt) => getJ(url, opt);
  async function render() {
    const my = ++run, loc = O.location;
    ["climCard", "factCard"].forEach((id) => { $(id).innerHTML = `<div class="section-title">${id === "climCard" ? "Daily climate" : "Weather numbers"}</div><div class="state loading">Finding the climate station for ${esc(loc.name.split(",")[0])}…</div>`; });
    $("climName").textContent = "…"; $("climMeta").textContent = "";
    const tzP = await tzOf(+loc.lat, +loc.lon);
    if (my !== run) return;
    const res = await window.ClimateStation.forPoint(loc, { fetchJSON }).catch((e) => ({ station: null, alternatives: [], missing: [`Climate station lookup failed (${(e && e.message) || e}).`] }));
    if (my !== run) return; // a slow answer for an earlier point never replaces the current one
    const next = fromStation(res);
    CLIM = next ? { ...next, tz: tzP } : { ...CLIM, cincy: false, tz: tzP }; // no station: never fall back to Cincinnati history
    stationHeader(res, loc, next);
    renderWeatherHistory(sel);
    $("skyCard").closest(".astronomy-section").hidden = !(next && next.cincy);
    const pt = astro === "stn" && next ? { name: `${next.obsName} (${next.obsSid})`, lat: next.station.ll[1], lon: next.station.ll[0] } : astro === "noaa" && next && next.cincy ? CINCY.noaa : { name: loc.name, lat: +loc.lat, lon: +loc.lon };
    const tzA = tzP;
    const today = todayIn(CLIM.tz), future = sel > today;
    $("sheetTitle").textContent = fmtDate(sel, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    $("astroName").textContent = pt.name;
    note("astro", { name: pt.name, lat: pt.lat, lon: pt.lon, tz: tzA });
    const fail = (id, title) => (e) => { if (my === run) $(id).innerHTML = `<div class="section-title">${title}</div><div class="state err">This section couldn't be shown (${esc(String((e && e.message) || e))}). Other sections are unaffected; reload to try again.</div>`; };
    sunCard(my, pt, tzA).catch(fail("sunCard", "Sun and moon"));
    if (next && next.cincy) skywatch.load(sel).catch(fail("skyCard", "Cincinnati skywatch"));
    if (!next) { ["climCard", "factCard"].forEach((id) => { $(id).innerHTML = `<div class="section-title">${id === "climCard" ? "Daily climate" : "Weather numbers"}</div><div class="state unavail">No official climate station could be verified for this point (${esc((res.missing || []).join(" ") || "unknown reason")}). Sun and moon remain available.</div>`; }); return; }
    climate(my, today, future).catch((e) => { fail("climCard", "Daily climate")(e); fail("factCard", "Weather numbers")(e); });
  }

  /* climate station: shown prominently, changeable to another verified station */
  function stationHeader(res, loc, c) {
    if (!c) {
      $("climName").textContent = "No verified station"; $("climMeta").textContent = (res.missing || []).join(" "); $("climStn").innerHTML = ""; $("climStn").hidden = true;
      if (res.error) { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.style.cursor = "pointer"; b.id = "climRetry"; b.textContent = "Try again"; b.addEventListener("click", () => render()); $("climMeta").append(" ", b); }
      return;
    }
    $("climName").textContent = `${c.obsName} · ${c.obsSid}`;
    $("climMeta").textContent = `NWS ${c.office} climate site, ${Math.round(c.station.km)} km from ${loc.name.split(",")[0]} · records: ${c.threaded ? `${c.recordsName} (${c.recordsSid}) since ${c.firstYear}` : `station record since ${c.firstYear}`}${c.office !== res.pointOffice ? ` · outside the point's NWS ${res.pointOffice} area` : ""}${c.missing.length ? " · " + c.missing.join(" ") : ""}`;
    const alts = res.alternatives || [];
    $("climStn").hidden = alts.length < 2;
    $("climStn").innerHTML = `<option value="auto">Nearest official site (default)</option>` + alts.map((a) => `<option value="${esc(a.faa)}" ${res.override && a.faa === c.obsSid ? "selected" : ""}>${esc(a.faa)} · ${esc(a.name)} · NWS ${esc(a.office)} · ${Math.round(a.km)} km${a.thr ? " · city record" : ""}</option>`).join("");
    const noaaOpt = $("astroPoint").querySelector('option[value="noaa"]'); if (noaaOpt) noaaOpt.hidden = !c.cincy;
    if (astro === "noaa" && !c.cincy) { astro = "loc"; $("astroPoint").value = "loc"; }
  }

  function renderWeatherHistory(date) {
    const card = $("weatherHistoryCard");
    const monthDay = date.slice(5);
    if (!CLIM.cincy) { card.hidden = true; return; } // local history stories are Cincinnati's; other markets have none yet
    const events = (window.CincinnatiWeatherHistory ?? [])
      .filter((event) => event.date.slice(5) === monthDay);
    if (!events.length) {
      const record = (window.CincinnatiDailyClimateHistory ?? [])
        .find(([observed]) => observed.slice(5) === monthDay);
      if (record) events.push(climateHistoryEntry(record));
    }
    card.hidden = events.length === 0;
    $("weatherHistoryEntries").innerHTML = events.map((event) => `
      <article class="weather-history-entry">
        <div class="kick">${esc(event.date.slice(0, 4))} · ${esc(event.place)}</div>
        <h3>${esc(event.title)}</h3>
        <p>${esc(event.summary)}</p>
        <a href="${esc(event.url)}">${esc(event.source)}</a>${event.archive
          ? ` <span aria-hidden="true">·</span> <a href="${esc(event.archive.url)}">${esc(event.archive.label)}</a>`
          : ""}
      </article>`).join("");
  }

  function climateHistoryEntry([date, metric, value, count]) {
    const temperature = `${value}°F`;
    const [title, observation, recordName] = {
      hot: [`A high of ${temperature}`, `Cincinnati reached ${temperature}`, "highest daily high"],
      cold: [`A low of ${temperature}`, `Cincinnati fell to ${temperature}`, "lowest daily low"],
      warmNight: [`A low of ${temperature}`, `Cincinnati’s temperature stayed at or above ${temperature}`, "highest daily low"],
      coldDay: [`A high of just ${temperature}`, `Cincinnati’s temperature only reached ${temperature}`, "lowest daily high"],
      precip: [`${value.toFixed(2)} inches of precipitation`, `Cincinnati measured ${value.toFixed(2)} inches of liquid-equivalent precipitation`, "largest daily precipitation total"],
      snow: [`${value.toFixed(1)} inches of snow`, `Cincinnati measured ${value.toFixed(1)} inches of snow`, "largest daily snowfall total"],
    }[metric];
    const day = fmtDate(date, { month: "short", day: "numeric" });
    const rank = count > 1 ? "tied for the" : "the";
    const params = new URLSearchParams({ sid: CLIM.recordsSid, sdate: date, edate: date, elems: "maxt,mint,pcpn,snow" });
    return {
      date,
      title,
      place: "Cincinnati climate record",
      summary: `${observation}, ${rank} ${recordName} for ${day} in the Cincinnati record through 2025.`,
      url: `https://data.rcc-acis.org/StnData?${params}`,
      source: "RCC-ACIS daily observation",
    };
  }

  /* ---------- sun and moon ---------- */
  /* simple moon symbol from illumination (0-100) and waxing/waning; lit side right when waxing */
  function moonSvg(illum, waxing, size = 46) {
    const r = size / 2 - 2, c = size / 2, k = 1 - (2 * Math.max(0, Math.min(100, illum))) / 100; // terminator x-scale: 1 new .. -1 full
    const lit = waxing ? 1 : -1, rx = Math.abs(k) * r;
    const sweepOuter = waxing ? 1 : 0, sweepInner = (k > 0) === waxing ? 0 : 1;
    const d = `M ${c} ${c - r} A ${r} ${r} 0 0 ${sweepOuter} ${c} ${c + r} A ${rx} ${r} 0 0 ${sweepInner} ${c} ${c - r} Z`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Moon ${Math.round(illum)}% illuminated"><circle cx="${c}" cy="${c}" r="${r}" fill="var(--raised)" stroke="var(--line)"/>${illum > 0.5 ? `<path d="${d}" fill="var(--text)" opacity=".85"/>` : ""}</svg>`;
  }
  async function usnoDay(d, pt, tz) {
    const jan = C.time.offsetMin(Date.parse(d.slice(0, 4) + "-01-15T12:00:00Z"), tz), jul = C.time.offsetMin(Date.parse(d.slice(0, 4) + "-07-15T12:00:00Z"), tz);
    const std = Math.min(jan, jul) / 60, usDst = jan !== jul && /^America\//.test(tz);
    const url = `https://aa.usno.navy.mil/api/rstt/oneday?date=${d}&coords=${pt.lat.toFixed(4)},${pt.lon.toFixed(4)}&tz=${std}&dst=${usDst}`;
    return cached(`usno:${d}:${pt.lat.toFixed(4)},${pt.lon.toFixed(4)}:${std}:${usDst}`, 30 * D, () => getJ(url));
  }
  const sunFor = (d, pt, tz) => A.noaaSun(d, pt.lat, pt.lon, C.time.offsetMin(C.time.toUtc(`${d}T12:00`, tz), tz));
  async function sunCard(my, pt, tz) {
    const el = $("sunCard");
    const s = sunFor(sel, pt, tz), p = sunFor(A.addDays(sel, -1), pt, tz);
    /* the sun is calculated locally, so it is drawn immediately; the moon fills in when USNO answers (or fails) */
    draw(null, null, true);
    const [a, ph] = await Promise.all([usnoDay(sel, pt, tz), cached(`usnoph:${sel}`, 30 * D, () => getJ(`https://aa.usno.navy.mil/api/moon/phases/date?date=${A.addDays(sel, -1)}&nump=5`))]);
    if (my !== run) return;
    draw(a, ph, false);
    function draw(a, ph, pending) {
    const m = a && a.v && !a.v.error ? A.parseOneDay(a.v) : null;
    if (!pending) note("usno", { at: a, error: a.v && a.v.error, api: m && m.apiversion });
    const t = (ms) => (ms == null ? "—" : hm(A.roundMin(ms), tz));
    const ch = s.daylightSec != null && p.daylightSec != null ? s.daylightSec - p.daylightSec : null;
    const np = ph && ph.v && !ph.v.error ? A.nextPhase(ph.v, C.time.toUtc(`${sel}T00:00`, tz)) : null;
    const waxing = m && m.phase ? /Waxing|First Quarter|New/.test(m.phase) : true;
    const zone = C.time.abbr(s.set || s.rise || Date.now(), tz);
    const uid = "sunDet";
    el.innerHTML = `<div class="section-title">Sun and moon</div>
      <div class="sunrow">
        <div class="mtile"><span class="k">Sunrise</span><span class="v big">${t(s.rise)}</span></div>
        <div class="mtile"><span class="k">Sunset</span><span class="v big">${t(s.set)}</span></div>
      </div>
      <div class="dayrow"><div><span class="kick">Daylight</span><div class="v">${A.fmtHMS(s.daylightSec)}</div></div>
        <span class="chg" title="Change from ${esc(fmtDate(A.addDays(sel, -1), { month: "short", day: "numeric" }))}, min:sec">${ch == null ? "—" : `${A.fmtDelta(ch)} ${ch < 0 ? "shorter" : ch > 0 ? "longer" : ""}`}</span></div>
      <div class="msg">vs ${esc(fmtDate(A.addDays(sel, -1), { weekday: "short", month: "short", day: "numeric" }))} · times ${esc(zone)}</div>
      <div class="moonrow">${m ? moonSvg(m.illumination || 0, waxing) : ""}
        <div>${m ? `<div class="ph">${esc(m.phase || "—")}</div><div class="s">${m.illumination != null ? `${m.illumination}% illuminated` : ""}</div>` : (pending ? `<div class="state loading">Loading moon data (USNO)…</div>` : `<div class="state unavail">Moon data (USNO) unavailable right now${a && a.v && a.v.error ? ` (${esc(a.v.error)})` : ""}. Sun times above are calculated here and unaffected.</div>`)}
          ${np ? `<div class="s">Next: <b style="color:var(--text)">${esc(np.phase)}</b> ${esc(fmtDate(C.time.toLocal(np.ms, tz).slice(0, 10), { weekday: "short", month: "short", day: "numeric" }))}, ${clock(np.ms, tz)}</div>` : ""}</div></div>
      <div class="cardfoot"><button class="infobtn" type="button" aria-expanded="false" aria-controls="${uid}">ⓘ Twilight, solar noon, moonrise</button></div>
      <div class="infopanel" id="${uid}" hidden>
        <dl class="kv">
          <dt>Civil twilight begins</dt><dd>${t(s.civilBegin)}</dd><dt>Solar noon</dt><dd>${t(s.noon)}</dd><dt>Civil twilight ends</dt><dd>${t(s.civilEnd)}</dd>
          <dt>Moonrise</dt><dd>${m ? m.moon.rise ? hm(m.moon.rise.ms, tz) : "none this date" : "unavailable"}</dd><dt>Moonset</dt><dd>${m ? m.moon.set ? hm(m.moon.set.ms, tz) : "none this date" : "unavailable"}</dd>
        </dl>
        <p>Sun times are <b>calculated</b> with the NOAA Solar Calculator algorithm and shown to the minute exactly as NOAA's table rounds them; daylight and its change use the unrounded times. Moon phase, illumination, moonrise and moonset are <b>retrieved</b> from the U.S. Naval Observatory.</p>
      </div>`;
    el.querySelector(".infobtn").addEventListener("click", (e) => { const pn = $(uid); pn.hidden = !pn.hidden; e.currentTarget.setAttribute("aria-expanded", String(!pn.hidden)); });
    }
  }

  /* ---------- daily climate ---------- */
  let climData = null;
  async function climate(my, today, future) {
    const el = $("climCard");
    const thru = future ? null : A.addDays(sel, -1); // "yesterday" relative to the sheet date
    const anchor = thru || sel, y = +anchor.slice(0, 4);
    const seasonStart = `${+anchor.slice(5, 7) >= 7 ? y : y - 1}-07-01`, yearStart = `${y}-01-01`;
    const met = A.metSeason(anchor);
    const nStart = [seasonStart, yearStart, met.start].sort()[0], nEnd = [sel, anchor].sort().pop();
    const reportDate = thru || sel, md = reportDate.slice(5), recThru = +reportDate.slice(0, 4) - 1;
    const previousStart = window.ClimateReport.previousYear(nStart);
    const obsStart = [A.addDays(nStart, -150), previousStart || nStart].sort()[0];
    const recentObs = thru && thru >= A.addDays(today, -45);
    const [nor, obs, rec, rk] = await Promise.all([
      cached(`acisN:${CLIM.obsSid}:${nStart}:${nEnd}`, 30 * D, () => acis({ sid: CLIM.obsSid, sdate: nStart, edate: nEnd, elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, normal: "1" })), meta: ["name"] })),
      thru ? cached(`acisO:${CLIM.obsSid}:${obsStart}:${thru}`, recentObs ? H : 7 * D, () => acis({ sid: CLIM.obsSid, sdate: obsStart, edate: thru, elems: ["maxt", "mint", "pcpn", "snow", "snwd"], meta: ["name", "valid_daterange"] })) : Promise.resolve(null),
      cached(`acisR:${CLIM.recordsSid}:${md}:${recThru}`, 7 * D, () => (md === "02-29"
        ? acis({ sid: CLIM.recordsSid, sdate: `${CLIM.firstYear}-01-01`, edate: `${recThru}-12-31`, elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, interval: "dly", duration: "dly", groupby: ["year", "02-28", "03-01"] })), meta: ["name", "valid_daterange"] })
        : acis({ sid: CLIM.recordsSid, sdate: `${CLIM.firstYear}-${md}`, edate: `${recThru}-${md}`, elems: ["maxt", "mint", "pcpn", "snow"].map((name) => ({ name, interval: [1, 0, 0] })), meta: ["name", "valid_daterange"] }))),
      thru ? cached(`acisRank3:${CLIM.recordsSid}:${thru}`, 6 * H, () => acis({ sid: CLIM.recordsSid, sdate: `${CLIM.firstYear + 1}-${thru.slice(5)}`, edate: thru, elems: [
        { name: "pcpn", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "sum", add: "mcnt" } },
        { name: "pcpn", interval: [1, 0, 0], duration: "std", season_start: met.startMD, reduce: { reduce: "sum", add: "mcnt" } },
        { name: "avgt", interval: [1, 0, 0], duration: "std", season_start: met.startMD, reduce: { reduce: "mean", add: "mcnt" } },
        { name: "avgt", interval: [1, 0, 0], duration: "mtd", reduce: { reduce: "mean", add: "mcnt" } }], meta: ["name"] })) : Promise.resolve(null),
    ]);
    if (my !== run) return;
    note("acis", { normals: nor, obs, records: rec, ranks: rk, recThru, thru, reportDate });
    /* leap day: the middle value of Feb 28 - Mar 1, in leap years only (ACIS's yearly step would substitute Feb 28 in 1900) */
    let recRows = rec.v && rec.v.data ? rec.v.data : null;
    if (recRows && md === "02-29") { const leap = (yy) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0; recRows = recRows.filter((r) => leap(+r[0])).map((r) => [`${r[0]}-02-29`, ...r.slice(1).map((x) => x[1])]); }
    const R = recRows ? A.records(recRows) : null;
    const nRows = nor.v && nor.v.data ? nor.v.data : [];
    const oRows = obs && obs.v && obs.v.data ? obs.v.data : [];
    const col = (k) => (rk && rk.v && rk.v.data ? rk.v.data.map((r) => [r[0], r[k]]) : null);
    const obsErr = obs && obs.v && obs.v.error ? obs.v.error : null;
    climData = { R, nRows, oRows, thru, sel, reportDate, met, obsErr, rankMonthP: col(1), rankSeasonP: col(2), rankSeasonT: col(3), rankMonthT: col(4) };
    renderClimateSheet(el, { reportDate, thru, today, nRows, oRows, R, recThru, errors: [nor, rec, obs].filter(x => x?.v?.error).map(x => x.v.error) });
    facts();
  }
  function renderClimateSheet(el, d) {
    const report = window.ClimateReport.build(A, { date: d.reportDate, observations: d.oRows, normals: d.nRows, records: d.R, observed: !!d.thru });
    const short = date => fmtDate(date, { month: "short", day: "numeric", year: "numeric" });
    const fmt = (x, digits, signed = false) => {
      if (!x || x.value == null) return `<span class="climo-missing"${x?.reason ? ` title="${esc(x.reason)}"` : ""}>—</span>`;
      if (x.trace) return '<span title="Trace: below a measurable amount">Trace</span>';
      return Number(x.value).toFixed(digits);
    };
    const number = (x, digits, signed = false) => {
      if (!x || x.value == null || x.trace) return fmt(x, digits, signed);
      return (signed && x.value > 0 ? "+" : x.value < 0 ? "−" : "") + Math.abs(x.value).toFixed(digits);
    };
    const row = r => `<tr data-climo-row="${r.id}"><th scope="row">${esc(r.label)}${r.from ? `<small>${esc(short(r.from))}–${esc(short(r.to))}</small>` : ""}</th><td class="climo-observed" data-label="Observed">${number(r.observed, r.decimals)}${r.observed.reason ? `<small>${esc(r.observed.reason)}</small>` : ""}</td><td data-label="Record">${number(r.record, r.decimals)}${r.record?.years?.length ? `<small>${esc(r.record.years.join(", "))}</small>` : ""}</td><td data-label="Normal">${number(r.normal, r.decimals)}</td><td data-label="Departure" class="${r.departure?.value > 0 ? "climo-above" : r.departure?.value < 0 ? "climo-below" : ""}">${number(r.departure, r.decimals, true)}</td><td data-label="Last year">${number(r.lastYear, r.decimals)}${r.lastYear?.reason ? `<small>${esc(r.lastYear.reason)}</small>` : ""}</td></tr>`;
    el.innerHTML = `<div class="climo-title"><div><span class="kick">${esc(CLIM.obsName)} · ${esc(CLIM.obsSid)} observations</span><h2>Climate report · ${esc(short(d.reportDate))}</h2></div><span class="climo-tag">${d.thru ? d.thru >= A.addDays(d.today, -45) ? "Preliminary observations" : "Observed" : "Reference only"}</span></div>
      <p class="climo-context">${d.thru ? `Yesterday relative to the sheet date. Daily normals and records below apply to <b>${esc(short(d.reportDate))}</b>.` : "This climate day has not been observed. Normals and records are shown where available."}</p>
      <div class="climo-periods"><span>Normal period <b>1991–2020</b></span><span>${CLIM.threaded ? "City record" : "Station record"} <b>${CLIM.firstYear}–${d.recThru}</b></span><span>Last year <b>${report.previousDate ? esc(short(report.previousDate)) : "No matching date"}</b></span></div>
      ${d.errors.length ? `<div class="state partial">Some climate data is unavailable (${esc(d.errors[0])}). Available values remain visible.</div>` : ""}
      <div class="climo-table-wrap"><table class="climo-table"><caption class="sr-only">Climate values for ${esc(short(d.reportDate))}. Temperature, precipitation and snowfall, with historical comparisons.</caption><thead><tr><th scope="col">Weather item</th><th scope="col">Observed</th><th scope="col">Record<small>value · year(s)</small></th><th scope="col">Normal</th><th scope="col">Departure<small>from normal</small></th><th scope="col">Last year<small>same dates</small></th></tr></thead>${report.sections.map(section => `<tbody><tr class="climo-group"><th colspan="6" scope="rowgroup">${esc(section.label)} <span>${esc(section.unit)}</span></th></tr>${section.rows.map(row).join("")}</tbody>`).join("")}</table></div>
      <p class="climo-foot">Observations and normals: ${esc(CLIM.obsSid)} via RCC-ACIS. Records: ${esc(CLIM.recordsName)} (${esc(CLIM.recordsSid)}), through ${d.recThru}.${CLIM.threaded ? "" : " No threaded city record exists for this site, so records cover the station's own period."} Totals use the printed date ranges; season-to-date uses meteorological seasons. Trace is not measurable; — means unavailable or not applicable. Missing days prevent a total or departure. Daily high/low occurrence times are not supplied by this feed. Last year compares the same calendar dates; leap-year day counts can differ.</p>`;
  }

  /* ---------- weather numbers: four summary cards + operational row ---------- */
  function facts() {
    const el = $("factCard"), d = climData; if (!d) return;
    const hiT = +O.store.get("alm_hiT", 80), loT = +O.store.get("alm_loT", 32);
    if (d.obsErr) { el.innerHTML = `<div class="section-title">Weather numbers</div><div class="state unavail">Unavailable right now: the observation request failed (${esc(d.obsErr)}). Reload to try again.</div>`; return; }
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
    const recH = d.R && d.R.highMax, selObs = d.oRows.find((r) => r[0] === d.reportDate), obsHi = selObs ? A.val(selObs[1]) : null;
    const recLine = !recH ? null : obsHi && !obsHi.missing ? { k: "Observed high vs record", v: `${obsHi.v}° vs ${recH.value}°`, s: `${Math.abs(obsHi.v - recH.value)}° ${obsHi.v >= recH.value ? "above" : "below"} the record (${recH.years.join(", ")})` }
      : null;
    const tile = (k, v, s2) => `<div class="optile"><span class="k">${k}</span><span class="v">${v}</span>${s2 ? `<span class="s">${s2}</span>` : ""}</div>`;
    el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><div class="section-title" style="margin:0;flex:none">Weather numbers</div>
        <button class="infobtn" type="button" id="wnHow" aria-expanded="false" aria-controls="wnHowPanel">ⓘ How these are calculated</button></div>
      <div class="infopanel" id="wnHowPanel" hidden>
        <p><b>Observed values</b> come from ${esc(CLIM.obsName)} (${esc(CLIM.obsSid)}), observed through ${esc(fmtDate(d.thru, { month: "long", day: "numeric", year: "numeric" }))}. Recent days are preliminary and can be corrected. <b>Normals</b> are NCEI 1991–2020 daily normals for ${esc(CLIM.obsSid)}. <b>Rankings</b> use the ${esc(CLIM.recordsName)}${CLIM.threaded ? ` (the official city record joined across sites since ${CLIM.firstYear})` : ` (this station's own record since ${CLIM.firstYear})`} for exactly the same elapsed dates in every year; meteorological winter runs Dec 1 to Feb 28/29 and crosses the calendar year. A year counts only if it has no missing days in that span. Ranks are competition ranks: tied years share a rank, and the opposite extreme is counted separately from the values, not by reversing the rank.</p>
        <p>Missing observations or normals are reported, never filled: an incomplete period shows no departure and no rank. Every complete, ranked card has a standing badge. Badge colors identify warm, cold, wet or dry rankings, including early periods under 7 days; these early snapshots keep their short-period label. Strong emphasis requires a top-10 rank that is also in the top 10% of usable years; the top third gets lighter emphasis. Trace precipitation is recorded but not measurable.</p></div>
      <div class="wngrid">${cards.join("")}</div>
      <div class="oprow">
        ${tile("Without measurable precip", `${ds.atLeast ? "≥ " : ""}${ds.days} day${ds.days === 1 ? "" : "s"}`, ds.endedBy === "measurable" ? `since ${ds.amount.toFixed(2)}″ on ${short(ds.at)}${traceSince ? ` · ${traceSince} day${traceSince > 1 ? "s" : ""} with a trace` : ""}` : ds.endedBy === "missing" ? `count stops at a missing day (${short(ds.at)})` : `data window starts ${short(ds.from)}`)}
        ${tile(`Highs ≥ <input class="input mono thr" id="hiT" value="${hiT}" aria-label="High threshold in °F">°F`, `Month ${hm.n} · Year ${hy.n}`, hm.missing + hy.missing ? `${hm.missing + hy.missing} missing days not counted` : "month to date · year to date")}
        ${tile(`Lows ≤ <input class="input mono thr" id="loT" value="${loT}" aria-label="Low threshold in °F">°F`, `Month ${lm.n} · Year ${ly.n}`, lm.missing + ly.missing ? `${lm.missing + ly.missing} missing days not counted` : "month to date · year to date")}
        ${recLine ? tile(recLine.k, recLine.v, recLine.s) : ""}
      </div>
      <div class="src">${esc(CLIM.obsSid)} observations through ${esc(short(d.thru))}; rankings: ${esc(CLIM.recordsName)}. ${!recLine && recH ? `The observed-vs-record comparison appears once ${esc(short(d.sel))} has been observed.` : ""}</div>`;
    $("wnHow").addEventListener("click", (e) => { const pn = $("wnHowPanel"); pn.hidden = !pn.hidden; e.currentTarget.setAttribute("aria-expanded", String(!pn.hidden)); });
    el.querySelectorAll(".wninfo").forEach((b) => b.addEventListener("click", () => { const pn = $(b.getAttribute("aria-controls")); pn.hidden = !pn.hidden; b.setAttribute("aria-expanded", String(!pn.hidden)); }));
    ["hiT", "loT"].forEach((k) => { const inp = $(k); if (inp) inp.addEventListener("change", () => { const n = parseFloat(inp.value); if (isFinite(n)) { O.store.set("alm_" + k, n); facts(); } }); });
  }
  /* one summary card */
  function card(o) {
    const r = o.rank, L = o.lead, shortP = o.days < 7;
    const head = !L ? null : `${A.ordinal(L.rank)}${L.tied ? " (tie)" : ""} ${o.words[L.side]}`;
    const level = !L || shortP ? "typical" : L.level;
    const rankLine = !r ? "Ranking unavailable" : !r.available ? `Not ranked: ${r.why}` : o.incomplete ? "Not ranked: incomplete period" : `${r.n} usable years (${r.from}–${r.to})`;
    const det = `${o.id}Det`;
    return `<article class="wncard ${level}">
      <div class="wnhead"><span class="wnper">${esc(o.period)}</span><span class="wnkind">${esc(o.kind)}</span></div>
      ${head && !o.incomplete ? `<div class="wnbadge standing ${level === "strong" ? "emph" : level === "notable" ? "noteworthy" : "quiet"} ${L.side === "high" ? (o.kind === "Temperature" ? "warm" : "wet") : (o.kind === "Temperature" ? "cold" : "dry")}">${esc(head)}</div>` : ""}
      <div class="wnbig">${o.primary}<small>${esc(o.primaryNote)}</small></div>
      ${o.incomplete ? `<div class="wndep unavail">Incomplete: ${esc(o.incomplete)}. No departure or rank.</div>` : o.dep ? `<div class="wndep ${o.dep.cls}">${esc(o.dep.txt)}</div>` : ""}
      ${o.support ? `<div class="wnsup">${esc(o.support)}</div>` : ""}
      <div class="wnrank${level === "notable" && !o.incomplete ? " notable" : ""}">${esc(rankLine)}${shortP && L && !o.incomplete ? ` · early ${o.days}-day snapshot` : ""}</div>
      <button class="wninfo" type="button" aria-expanded="false" aria-controls="${det}">ⓘ Details</button>
      <div class="wndet" id="${det}" hidden><dl class="kv">
        <dt>Period</dt><dd>${esc(o.period.split(" · ")[1])} (${o.days} days)</dd>
        <dt>Observed at</dt><dd>${esc(CLIM.obsName)} (${esc(CLIM.obsSid)})</dd>
        <dt>Ranked in</dt><dd>${esc(CLIM.recordsName)}</dd>
        ${r && r.available ? `<dt>${esc(o.words.high[0].toUpperCase() + o.words.high.slice(1))} rank</dt><dd>${A.ordinal(r.high.rank)} of ${r.n}</dd><dt>${esc(o.words.low[0].toUpperCase() + o.words.low.slice(1))} rank</dt><dd>${A.ordinal(r.low.rank)} of ${r.n}</dd>
          <dt>Value used for ranking</dt><dd>${r.value}${o.kind === "Temperature" ? "°F" : "″"}</dd><dt>Tied years</dt><dd>${r.ties.length ? esc(r.ties.join(", ")) : "none"}</dd>` : ""}
        ${r ? `<dt>Excluded years</dt><dd>${r.excludedCount ? `${r.excludedCount} (missing days)` : "none"}</dd>` : ""}
      </dl><p class="msg" style="margin-top:6px">${esc(o.method)}</p></div>
    </article>`;
  }


  /* ---------- source details (provenance, IDs, retrieval times) ---------- */
  function renderSources() {
    const a = prov.astro || {}, u = prov.usno || {}, c = prov.acis || {};
    $("srcPanel").innerHTML = `<dl class="kv">
      <dt>Sun times</dt><dd>Calculated: NOAA Solar Calculator algorithm at ${a.lat != null ? `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}` : "—"} (${esc(a.tz || "")})</dd>
      <dt>Moon</dt><dd>Retrieved: USNO API ${esc(u.api || "")}${u.error ? ` · unavailable (${esc(u.error)})` : ""} · ${esc(stampTxt(u.at))}</dd>
      <dt>Climate station</dt><dd>${esc(CLIM.obsName)} (${esc(CLIM.obsSid)}), NWS ${esc(CLIM.office || "—")} climate reporting site${CLIM.override ? " (chosen by you)" : " (nearest official site in the point's NWS office area)"}</dd>
      <dt>Records</dt><dd>${esc(CLIM.recordsName)}, RCC-ACIS "${esc(CLIM.recordsSid)}", through ${c.recThru || "—"} · ${esc(stampTxt(c.records))}${CLIM.threaded ? "" : " · no threaded city record for this site"}</dd>
      <dt>Normals</dt><dd>${esc(CLIM.obsSid)} (RCC-ACIS), NCEI 1991–2020 daily normals · ${esc(stampTxt(c.normals))}</dd>
      <dt>Observations</dt><dd>${esc(CLIM.obsSid)} through ${c.thru || "—"}; recent days preliminary · ${esc(stampTxt(c.obs))}</dd>
      <dt>Rankings</dt><dd>${esc(CLIM.recordsName)}, same elapsed dates each year · ${esc(stampTxt(c.ranks))}</dd>
    </dl>
    <p>Daylight is the difference of two real instants, so daylight-saving changes never add or remove an hour. T = trace (not measurable); missing values are never counted as zero. No precipitation or snowfall normal is published for Feb 29. timeanddate.com and NOAA's own table are comparison references only.</p>`;
  }

  /* printing: include expandable details */
  window.addEventListener("beforeprint", () => document.querySelectorAll(".almanac .infopanel").forEach((d) => { d.dataset.wasHidden = d.hidden ? "1" : ""; d.hidden = false; }));
  window.addEventListener("afterprint", () => document.querySelectorAll(".almanac .infopanel").forEach((d) => { d.hidden = d.dataset.wasHidden === "1"; }));
  const skywatch = window.Skywatch.mount({ O, getJSON: getJ });
  keepDate();
  render();
})();
