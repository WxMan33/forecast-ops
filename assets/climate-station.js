/* Climate station for a forecast point: the second value of the location tracker.
   The forecast point drives forecasts, alerts, briefings and astronomy; the climate station drives Almanac
   observations, normals and records, and Model Blend's record-watch flags.
   Default = the nearest official NWS daily climate reporting site (it issues a CLI product) served by the same
   NWS forecast office as the point, with usable recent daily observations and normals in RCC-ACIS.
   Records: the station's threaded city record (ThreadEx, e.g. INDthr) when one exists, labelled separately;
   otherwise the station's own period of record, with the missing threaded record stated.
   Everything is verified from live sources (NWS API, RCC-ACIS); nothing is assumed from a hand-made table. */
(function (root) {
  "use strict";
  const PRIMARY_KM = 50, VER = "v1", D = 864e5, ACIS = "https://data.rcc-acis.org", NWS = "https://api.weather.gov";
  const km = (a, b, c, d) => { const R = 6371, t = (x) => (x * Math.PI) / 180, h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const keyOf = (p) => `${(+p.lat).toFixed(2)},${(+p.lon).toFixed(2)}`;
  const office = (issuing) => (issuing ? String(issuing).replace(/^K/, "") : null);
  const titleCase = (s) => String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bIntl\b/g, "Intl").replace(/\bAp\b/g, "Airport");

  /* pure: rank verified candidates. candidates: [{faa, name, ll:[lon,lat], km, office, cli, obsOk, normalsOk, thr}] */
  function choose(pointOffice, candidates) {
    const usable = candidates.filter((c) => c.cli && c.obsOk && c.normalsOk);
    const inArea = usable.filter((c) => c.office === pointOffice).sort((a, b) => a.km - b.km);
    const outside = usable.filter((c) => c.office !== pointOffice).sort((a, b) => a.km - b.km);
    /* a market's primary climate site (one with a threaded city record, e.g. IND, DEN) wins within PRIMARY_KM;
       farther away, the nearest official reporting site in the office area (e.g. MIE for Muncie) is closer to home */
    const primary = inArea.find((c) => c.thr && c.km <= PRIMARY_KM);
    const station = primary || inArea[0] || outside[0] || null;
    const missing = [];
    if (!inArea.length) missing.push(outside.length ? `No usable official climate station found in the NWS ${pointOffice || "?"} area nearby; using the nearest one outside it.` : "No usable official climate station found near this point.");
    if (station && !station.thr) missing.push(`${station.faa} has no threaded city record in RCC-ACIS; records use this station's own period of record.`);
    return { station, alternatives: [...inArea, ...outside].slice(0, 8), inArea: inArea.length, missing };
  }

  /* live resolution (browser); fetchJSON(url, opts) -> json or {error} */
  async function resolve(pt, { fetchJSON, now = Date.now() }) {
    const lat = +pt.lat, lon = +pt.lon;
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const post = (path, body) => fetchJSON(ACIS + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const nws = (url) => fetchJSON(url, { headers: { Accept: "application/geo+json" } });
    const [pp, meta] = await Promise.all([
      nws(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`),
      post("/StnMeta", { bbox: [lon - 3.2, lat - 2.4, lon + 3.2, lat + 2.4], meta: "name,sids,ll,valid_daterange", elems: "maxt", sdate: day(now - 12 * D), edate: day(now) }),
    ]);
    const pointOffice = pp && pp.properties ? pp.properties.gridId : null;
    if (!meta || !meta.meta) return { pointOffice, station: null, alternatives: [], missing: ["RCC-ACIS station search is unavailable right now."], error: true };
    /* first-order / ASOS sites: a WBAN id (type 1) and an FAA id (type 3) */
    const sites = meta.meta.filter((s) => s.ll && s.sids.some((x) => / 1$/.test(x)) && s.sids.some((x) => / 3$/.test(x)))
      .map((s) => ({ faa: s.sids.find((x) => / 3$/.test(x)).split(" ")[0], name: titleCase(s.name), ll: s.ll, km: km(lat, lon, s.ll[1], s.ll[0]) }))
      .sort((a, b) => a.km - b.km).slice(0, 12);
    /* official daily climate reporting site: NWS issues a CLI product for it; its issuing office */
    await Promise.all(sites.map(async (s) => { const j = await nws(`${NWS}/products?type=CLI&location=${encodeURIComponent(s.faa)}&limit=1`); const g = j && j["@graph"] && j["@graph"][0]; s.cli = !!g; s.office = g ? office(g.issuingOffice) : null; }));
    const cli = sites.filter((s) => s.cli).slice(0, 6);
    /* threaded city records and usable recent observations + normals */
    const thr = cli.length ? await post("/StnMeta", { sids: cli.map((s) => s.faa + "thr").join(","), meta: "name,sids,valid_daterange", elems: "maxt" }) : { meta: [] };
    const thrBy = new Map(((thr && thr.meta) || []).map((t) => [t.sids[0].split(" ")[0].replace(/thr$/, ""), t]));
    await Promise.all(cli.map(async (s) => {
      const t = thrBy.get(s.faa); s.thr = t ? { sid: s.faa + "thr", name: `${titleCase(t.name)} threaded record`, since: t.valid_daterange && t.valid_daterange[0] ? +t.valid_daterange[0][0].slice(0, 4) : null } : null;
      const d = await post("/StnData", { sid: s.faa, sdate: day(now - 10 * D), edate: day(now - D), elems: [{ name: "maxt" }, { name: "maxt", normal: "1" }], meta: ["valid_daterange", "tzo"] });
      const rows = (d && d.data) || []; s.obsOk = rows.filter((r) => r[1] !== "M" && r[1] != null).length >= 5; s.normalsOk = rows.filter((r) => r[2] !== "M" && r[2] != null).length >= 5;
      s.since = d && d.meta && d.meta.valid_daterange && d.meta.valid_daterange[0] && d.meta.valid_daterange[0][0] ? +d.meta.valid_daterange[0][0].slice(0, 4) : null;
    }));
    return { pointOffice, ...choose(pointOffice, cli), checked: sites.length };
  }

  /* cached, with a per-point override; the override must be one of the verified alternatives */
  function store() { try { return root.localStorage; } catch (e) { return null; } }
  const read = (k) => { try { return JSON.parse(store().getItem(k)); } catch (e) { return null; } };
  const write = (k, v) => { try { store().setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  async function forPoint(pt, opts) {
    const k = `climstn:${VER}:${keyOf(pt)}`; let r = read(k);
    if (!r || Date.now() - r.at > 14 * D) { const v = await resolve(pt, opts); r = { at: Date.now(), v }; if (!v.error) write(k, r); }
    const ovr = read(`climstn:ovr:${keyOf(pt)}`), v = r.v, alt = ovr && v.alternatives.find((a) => a.faa === ovr);
    if (!alt) return { ...v, override: false };
    /* notes describe the station in use, not the default one */
    const missing = [...(alt.office !== v.pointOffice ? [`${alt.faa} is outside the point's NWS ${v.pointOffice || "?"} area.`] : []), ...(alt.thr ? [] : [`${alt.faa} has no threaded city record in RCC-ACIS; records use this station's own period of record.`])];
    return { ...v, station: alt, override: true, missing };
  }
  function setOverride(pt, faa) { const k = `climstn:ovr:${keyOf(pt)}`; if (faa) write(k, faa); else { try { store().removeItem(k); } catch (e) { /* ignore */ } } }

  const api = { PRIMARY_KM, choose, resolve, forPoint, setOverride, keyOf, km, VER };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ClimateStation = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
