/* Overview: a 3-day summary for the forecast point, built from a light version of each tool. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, C = O.Core;
  O.shell("home", "Overview");
  document.title = O.BRAND.name;

  const MODELS = [
    { id: "ecmwf_ifs025", name: "ECMWF IFS", w: 1.25 },
    { id: "gfs_seamless", name: "GFS", w: 1 },
    { id: "ncep_nbm_conus", name: "NBM", w: 1.25 },
    { id: "gfs_hrrr", name: "HRRR", w: 1 },
    { id: "icon_seamless", name: "ICON", w: 1 },
    { id: "gem_seamless", name: "GEM", w: 1 },
  ];
  const HOURLY = ["temperature_2m", "precipitation", "precipitation_probability", "snowfall", "wind_gusts_10m", "cape", "weather_code"];
  const ENS = [{ id: "gfs025", name: "GEFS", w: 1 }, { id: "ecmwf_ifs025", name: "ECMWF ENS", w: 1.25 }];

  let fresh = false, prevSnap = null;
  O.locationCard($("locCard"), () => run());

  async function run() {
    fresh = true;
    O.setChip("FETCHING…");
    $("sumMsg").textContent = "Loading guidance…";
    const det = Promise.allSettled(MODELS.map((m) => O.fetchModel("https://api.open-meteo.com/v1/forecast",
      { forecast_days: 4, temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" }, m.id, HOURLY)));
    const ens = Promise.allSettled(ENS.map((e) => O.fetchModel("https://ensemble-api.open-meteo.com/v1/ensemble",
      { forecast_days: 4, precipitation_unit: "inch" }, e.id, ["snowfall"])));
    const [dr, er] = await Promise.all([det, ens]);
    const problems = [];
    const ok = [];
    dr.forEach((r, i) => {
      const m = MODELS[i];
      if (r.status !== "fulfilled") { problems.push(`${m.name}: request failed`); return; }
      const h = O.pick(r.value.hourly, HOURLY);
      if (!O.hasData(h.temperature_2m)) { problems.push(`${m.name}: no coverage here`); return; }
      ok.push({ m, j: r.value, h });
    });
    if (!ok.length) {
      O.setChip("NO DATA", "err"); O.headline({ tier: "nodata", word: "NO DATA" });
      $("sumMsg").textContent = "Couldn't reach Open-Meteo.";
      $("days").innerHTML = ""; return;
    }
    const master = ok.reduce((a, b) => (b.j.hourly.time.length > a.j.hourly.time.length ? b : a)).j;
    const times = master.hourly.time, tz = master.timezone;
    const A = (v) => ok.map(({ m, j, h }) => ({ m, w: m.w, data: O.align(times, j.hourly.time, h[v]) })).filter((x) => O.hasData(x.data));
    const B = (v) => O.blendSeries(A(v), times.length);

    /* ensemble snow members on the same time axis */
    const mem = [];
    er.forEach((r, i) => {
      const e = ENS[i];
      if (r.status !== "fulfilled") { problems.push(`${e.name}: unavailable`); return; }
      const keys = Object.keys(r.value.hourly || {}).filter((k) => k === "snowfall" || k.startsWith("snowfall_"));
      const arrs = keys.map((k) => O.align(times, r.value.hourly.time, r.value.hourly[k])).filter(O.hasData);
      arrs.forEach((a) => mem.push({ w: e.w / arrs.length, a }));
    });

    const T = B("temperature_2m"), P = B("precipitation"), POP = B("precipitation_probability"), SN = B("snowfall"), G = B("wind_gusts_10m"), CAPE = B("cape");
    const wc = A("weather_code");
    const tiers = times.map((_, i) => C.thunder.tier(C.stats.weightedShare(wc.map((x) => x.data[i]), wc.map((x) => x.w), C.thunder.isThunderCode), CAPE.mean[i], POP.mean[i]));

    const now = Math.max(0, O.nowIndex(times, tz));
    const days = O.dayGroups(times, now).filter((d) => d.idx.length >= 3).slice(0, 3);
    const sum = (a, idx) => { const v = idx.map((i) => a[i]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) : null; };
    const mx = (a, idx) => { const v = idx.map((i) => a[i]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const mn = (a, idx) => { const v = idx.map((i) => a[i]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
    const f = (x, d = 0, u = "") => (x == null ? "—" : x.toFixed(d) + u);
    const rows = days.map((d) => {
      const s = d.idx[0], e = d.idx[d.idx.length - 1] + 1;
      const ws = mem.length ? C.winter.windowStats(mem, s, e) : null;
      const hot = d.idx.filter((i) => C.TIERS[tiers[i]].rank >= 1);
      return { d, part: d.idx.length < 24, hi: mx(T.mean, d.idx), lo: mn(T.mean, d.idx), qpf: sum(P.mean, d.idx), pop: mx(POP.mean, d.idx), sn: sum(SN.mean, d.idx),
        gust: mx(G.mean, d.idx), t: O.maxTier(d.idx.map((i) => tiers[i])), hot, p1: ws ? ws.P[1] : null, p01: ws ? ws.P[0.1] : null };
    });
    const pctTxt = (p) => (p == null ? "—" : Math.round(p * 100) + "%");
    $("days").innerHTML = rows.map((r) => `<div class="daycard">
        <div class="r" style="align-items:center"><span class="d">${O.fmtDay(r.d.k)}${r.part ? ' <span class="msg">· rest of day</span>' : ""}</span></div>
        <div class="t"><span class="hi">${f(r.hi, 0, "°")}</span> / <span class="lo">${f(r.lo, 0, "°")}</span></div>
        <div class="r"><span>Precip</span><b>${f(r.qpf, 2, '"')} · ${f(r.pop, 0, "%")}</b></div>
        <div class="r"><span>Peak gust</span><b>${f(r.gust, 0, " mph")}</b></div>
        <div class="r"><span>Snow (ens.)</span><b>${r.p01 == null ? "—" : r.p01 < 0.05 ? "none" : `any ${pctTxt(r.p01)} · 1"+ ${pctTxt(r.p1)}`}</b></div>
        <div class="r" style="align-items:center"><span>Thunder</span><a href="thunder.html" style="text-decoration:none">${O.badge(r.t)}</a></div>
        ${r.hot.length ? `<div class="msg">thunder signal ${O.fmtHour(O.hourOf(times[r.hot[0]]))}–${O.fmtHour((O.hourOf(times[r.hot[r.hot.length - 1]]) + 1) % 24)}</div>` : ""}
      </div>`).join("");

    const all = days.flatMap((d) => d.idx);
    const worst = O.maxTier(all.map((i) => tiers[i]));
    const p1All = mem.length && all.length ? C.winter.windowStats(mem, all[0], all[all.length - 1] + 1).P[1] : null;
    O.headline({
      word: "NEXT 3 DAYS", note: "Quick model summary",
      stats: [
        { num: f(sum(P.mean, all), 2, '"'), unit: "total precip" },
        { num: pctTxt(p1All), unit: 'chance of 1"+ snow' },
        { num: O.TIER[worst].word, unit: "thunder signal", color: O.TIER[worst].rank >= 1 ? O.TIER[worst].color : undefined },
      ],
    });
    O.dataStatus(problems);
    $("sumMsg").textContent = `${ok.length} models · ${mem.length} ensemble members · ${O.tzShort(tz)}`;

    if (fresh) {
      const snap = {}; rows.forEach((r) => (snap[r.d.k] = { label: O.fmtDay(r.d.k), hi: r.hi, lo: r.lo, qpf: r.qpf, pop: r.pop, gust: r.gust, p1: r.p1 == null ? null : r.p1 * 100, t: r.t }));
      prevSnap = O.trackChanges("overview", snap); fresh = false;
      O.renderChanges($("changes"), prevSnap, snap, [
        { k: "hi", label: "high", min: 3, fmt: (v) => `${Math.round(v)}°` },
        { k: "lo", label: "low", min: 3, fmt: (v) => `${Math.round(v)}°` },
        { k: "qpf", label: "precip", min: 0.1, fmt: (v) => `${v.toFixed(2)}"` },
        { k: "pop", label: "max chance", min: 15, fmt: (v) => `${Math.round(v)}%` },
        { k: "gust", label: "peak gust", min: 8, fmt: (v) => `${Math.round(v)} mph` },
        { k: "p1", label: '1"+ snow chance', min: 10, fmt: (v) => `${Math.round(v)}%` },
        { k: "t", label: "thunder", tier: true },
      ]);
    }
  }
  run();
})();
