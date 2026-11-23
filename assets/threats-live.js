/* Weather threats: live feed orchestration for the branch preview (browser only).
   Polls the official feeds straight from the browser, as the rest of Forecast Ops does for NWS:
     NWS alerts every 60 s, SPC MDs every 60 s, SPC outlooks every 10 min, our research model every 10 min.
   Every request and its outcome is kept in `diag` so the preview can show what was actually fetched. */
(function () {
  "use strict";
  const F = window.ThreatsFeeds, D = window.SevereDailyCore;
  const MODEL_BASE = "https://raw.githubusercontent.com/WxMan33/forecast-ops/main/assets/severe-daily/"; // the Severe viewer's published feed
  const alerts = F.createAlertStore(), outlooks = { 1: F.createOutlookStore(1), 2: F.createOutlookStore(2), 3: F.createOutlookStore(3) };
  const ero = { 1: F.createEROStore(1), 2: F.createEROStore(2), 3: F.createEROStore(3) };
  /* SPC fire weather outlooks: wind/RH and dry thunderstorm parts for Days 1-8 (Days 3-8 probabilistic) */
  const FIRE_DAYS = [1, 2, 3, 4, 5, 6, 7, 8], FIRE_PARTS = ["windrh", "dryt"];
  const fire = {}; for (const d of FIRE_DAYS) fire[d] = { windrh: F.createFireStore(d, "windrh"), dryt: F.createFireStore(d, "dryt") };
  /* NIFC WFIGS current incidents (with perimeters where published) */
  const nifc = { state: "never", lastOk: null, error: null, products: [] };
  /* smoke and air quality: HMS for everyone (map and Planner); the venue's monitors, forecast area and NOAA smoke guidance
     per venue (like WSSI-P); all monitors for the map */
  const hms = { state: "never", lastOk: null, error: null, products: [], days: [] };
  const aq = { key: null, obs: { state: "never" }, fcst: { state: "never" }, naqfc: { state: "never" }, products: [] };
  const monAll = { state: "never", lastOk: null, error: null, products: [] };
  /* NHC (regional context) and the venue's NHC wind speed probabilities */
  const nhc = { state: "never", lastOk: null, error: null, products: [] }, tcw = { key: null, state: "never", lastOk: null, error: null, products: [] };
  const smokeUrl = (p) => NWS.base.replace(/\/api\/nws$/, "/api/smoke") + p;
  const md = { state: "never", lastOk: null, lastTry: null, error: null, products: [], service: null, list: null };
  const model = { state: "never", error: null, index: null, registry: null, grid: null, hidden: null, hull: null, runs: {} };
  const zoneGeo = new Map(), zonePending = new Map(), refDone = new Set(), mdText = new Map();
  const diag = { requests: [] };
  /* NWS route. Default: the browser calls api.weather.gov directly (no app identifier possible). ?nws=function sends
     NWS requests through the Forecast Ops Pages Function on the same host (identifying User-Agent, 30 s cache);
     ?nwsBase=<url> points at a function on another compatible host. */
  /* Cloudflare Pages previews of this branch carry the functions, so they use them by default (?nws=direct overrides) */
  const NWS = (() => { try { const q = new URLSearchParams(location.search); if (q.get("nwsBase")) return { mode: "function", base: q.get("nwsBase").replace(/\/$/, "") }; if (q.get("nws") === "function" || (q.get("nws") !== "direct" && /\.forecast-ops-beta\.pages\.dev$/.test(location.hostname))) return { mode: "function", base: new URL("api/nws", location.href).href }; } catch (e) { /* default */ } return { mode: "direct", base: "https://api.weather.gov" }; })();
  const nwsUrl = (u) => NWS.mode === "direct" ? u : u.replace(/^https:\/\/api\.weather\.gov/, NWS.base);
  /* WPC has no CORS header: through the function, WPC's own file; directly, the NOAA map service mirror (whose empty
     answers stay unconfirmed, see ThreatsFeeds.createEROStore) */
  const wpcUrl = (day) => NWS.mode === "function" ? NWS.base.replace(/\/api\/nws$/, "/api/wpc") + "/ero/day" + day : F.MAPSVC_ERO_URL(day);
  const listeners = [];
  const nowIso = () => new Date().toISOString();

  async function get(url, as, meta) {
    const t0 = Date.now(), c = new AbortController(), timer = setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch(url, { signal: c.signal, cache: "no-store", headers: as === "json" ? { Accept: "application/geo+json, application/json" } : {} });
      const up = r.headers.get("X-Upstream-Fetched-At"), cache = r.headers.get("X-Forecast-Ops-Cache");
      diag.requests.push({ url, status: r.status, ms: Date.now() - t0, at: nowIso(), upstreamAt: up, cache }); if (diag.requests.length > 200) diag.requests.shift();
      if (!r.ok) throw Error("HTTP " + r.status);
      if (meta) { meta.upstreamAt = up; meta.cache = cache; }
      return as === "json" ? await r.json() : await r.text();
    } catch (e) {
      if (!/HTTP/.test(e.message)) diag.requests.push({ url, error: e.name === "AbortError" ? "timeout" : e.message, at: nowIso() });
      throw e.name === "AbortError" ? Error("timeout") : e;
    } finally { clearTimeout(timer); }
  }

  /* county-only alerts: shapes from the listed zones (cached for the session) */
  function zone(url) {
    if (zoneGeo.has(url)) return Promise.resolve(zoneGeo.get(url));
    if (!zonePending.has(url)) zonePending.set(url, get(nwsUrl(url), "json").then((z) => { if (!z.geometry) throw Error("zone has no shape"); zoneGeo.set(url, z.geometry); return z.geometry; }).finally(() => zonePending.delete(url)));
    return zonePending.get(url);
  }
  /* county/zone-based products get their drawn area from the zone shapes fetched so far (attached per snapshot) */
  function withZones(p) {
    if (p.geometrySource !== "counties" || !p.zones || !p.zones.length) return p;
    const z = F.zoneShape(p.zones, p.zones.map((u) => zoneGeo.get(u) || null));
    return { ...p, geometry: z.geometry, geometryIncomplete: z.incomplete, zoneInfo: z, label: z.geometry ? F.labelPoint(z.geometry) : null };
  }
  function applyZones() { /* shapes are attached in snapshot(); kept for callers */ }
  async function resolvePending() {
    const want = [];
    for (const p of alerts.products(Date.now())) if (p.geometrySource === "counties" && p.status === "active") for (const u of p.zones) if (!zoneGeo.has(u)) want.push(u);
    if (!want.length) return false;
    await Promise.allSettled([...new Set(want)].slice(0, 300).map(zone)); return true;
  }
  /* "What changed" on first load: fetch the message an update replaced (same VTEC event) */
  async function fetchPrevious() {
    let changed = false;
    for (const p of alerts.products(Date.now())) {
      if (p.status !== "active" || p.previous || !p.references.length || refDone.has(p.messageId)) continue;
      refDone.add(p.messageId);
      const ref = p.references.slice().sort((a, b) => Date.parse(b.sent) - Date.parse(a.sent))[0];
      try {
        const old = F.normalizeAlert(await get(nwsUrl(ref.url), "json"));
        if (old && old.id === p.id) { alerts.get(p.id).previous = { id: old.id, messageId: old.messageId, event: old.event, issued: old.issued, updated: old.updated, expires: old.expires, hazard: old.hazard, geometry: old.geometry }; changed = true; }
      } catch (e) { /* no comparison: the row stays hidden */ }
    }
    return changed;
  }
  /* "last confirmed" is the time NWS actually answered: the browser's clock when it calls NWS directly, or the
     function's X-Upstream-Fetched-At (a cache hit keeps the original time, so it is never a fresh confirmation) */
  async function refreshAlerts() {
    const tried = nowIso(), meta = {};
    try {
      const body = await get(nwsUrl(F.ALERTS_URL), "json", meta);
      let at = tried;
      if (NWS.mode === "function") { if (!meta.upstreamAt || !isFinite(Date.parse(meta.upstreamAt))) throw Error("function answer without its upstream time"); at = new Date(meta.upstreamAt).toISOString(); }
      alerts.ingest(body, at);
    } catch (e) { alerts.fail(tried, e.message); }
    applyZones(); emit();
    const a = await resolvePending(), b = await fetchPrevious(); if (a || b) emit();
  }

  /* MDs: SPC's list and text pages are the full source. When they cannot be reached (SPC refuses automated browsers,
     for example), the NOAA map service decides: its NoArea placeholder confirms none; shapes are drawn with details
     marked unavailable; anything else leaves MD status unknown. The service may lag SPC by up to 15 minutes (NOAA's own note). */
  async function refreshMD() {
    const at = nowIso(); md.lastTry = at; let spcError = null;
    try {
      const list = F.parseMDList(await get(F.MD_LIST_URL, "text")); md.list = list.state;
      if (list.state === "unrecognized") throw Error("unrecognized MD list page");
      const products = [];
      for (const n of list.numbers) {
        if (!mdText.has(n)) mdText.set(n, await get(F.MD_URL(n), "text"));
        const p = F.parseMD(mdText.get(n), n);            // throws on unrecognized text: the whole refresh counts as failed
        if (p.severe) products.push(p);
      }
      md.products = products; md.state = "ok"; md.lastOk = at; md.error = null; md.via = "spc";
    } catch (e) { spcError = e.message; }
    let svc = null;
    try { svc = F.parseMDService(await get(F.MD_SERVICE_URL, "json")); md.service = { state: svc.state, count: svc.features.length, placeholder: !!svc.placeholder, at }; }
    catch (e) { md.service = { state: "failed", error: e.message, at }; }
    if (spcError) {
      if (svc && svc.state === "empty") { md.products = []; md.state = "ok"; md.lastOk = at; md.via = "service"; md.error = null; }
      else if (svc && svc.state === "list") { md.products = svc.features.map((f) => F.mdFromService(f, Date.now())).filter((p) => p.severe); md.state = "ok"; md.lastOk = at; md.via = "service"; md.error = null; }
      else { md.state = "failed"; md.error = "SPC: " + spcError + "; NOAA map service: " + (md.service.error || md.service.state); }
    }
    emit();
  }
  /* WPC WSSI-P at one venue: one point query per impact level on the NOAA map service (attributes only). Kept per
     venue for 10 minutes; a failed level makes the whole answer unconfirmed (status unknown), never "none". */
  const wssi = { state: "never", lastOk: null, error: null, products: [], key: null, reachEnd: null, issued: null };
  let wssiPending = null;
  function wssiFor(lat, lon) {
    const key = lat.toFixed(3) + "," + lon.toFixed(3);
    if (wssi.key === key && wssi.lastOk && Date.now() - Date.parse(wssi.lastOk) < 10 * 60e3) return Promise.resolve();
    if (wssiPending && wssiPending.key === key) return wssiPending.p;
    const q = "geometry=" + lon + "," + lat + "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=prob,impact,fcsthr,validstart,validend,idp_filedate&returnGeometry=false&f=json";
    const p = (async () => {
      const at = nowIso();
      try {
        const one = async (L) => { const j = await get(F.WSSIP_URL(L, q), "json"); if (j.error) throw Error("WSSI-P " + L + ": " + (j.error.message || "error")); return F.parseWSSIP(j, [+lon.toFixed(3), +lat.toFixed(3)], L); };
        const res = await Promise.all(F.WSSI_LEVELS.map((L) => one(L).catch(() => one(L)).catch((e) => ({ failed: e.message })))); // one retry per level
        /* A level that still fails after its retry is reported as unavailable; the levels that answered are kept. */
        const { products: all, unavailable } = F.combineWSSI(res);
        Object.assign(wssi, { state: "ok", lastOk: at, error: null, unavailable, products: all, key, reachEnd: all.map((x) => x.validEnd).sort().pop() || null, issued: all.map((x) => x.issued).filter(Boolean).sort().pop() || null });
      } catch (e) { Object.assign(wssi, { state: "failed", error: e.message, key }); if (wssi.key !== key) wssi.products = []; }
      finally { wssiPending = null; emit(); }
    })();
    wssiPending = { key, p }; return p;
  }
  /* the map's WSSI-P layer: the windows published now (one cheap distinct query), and the shapes of one level for one
     window on demand. Kept for 10 minutes. */
  const zOf = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, "0"); return p(d.getUTCHours()) + "Z " + d.getUTCFullYear() + "/" + p(d.getUTCMonth() + 1) + "/" + p(d.getUTCDate()); };
  const wssiAreaCache = new Map();
  function wssiArea(level, startIso) {
    const k = level + "|" + startIso, c = wssiAreaCache.get(k);
    if (c && (c.pending || Date.now() - c.at < 10 * 60e3)) return c.pending || Promise.resolve(c.products);
    const q = "where=" + encodeURIComponent("validstart='" + zOf(startIso) + "'") + "&outFields=prob,impact,fcsthr,validstart,validend,idp_filedate&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&f=geojson";
    const pending = get(F.WSSIP_URL(level, q), "json").then((j) => { const ps = F.parseWSSIP(j, null, level); wssiAreaCache.set(k, { at: Date.now(), products: ps }); emit(); return ps; })
      .catch((e) => { wssiAreaCache.delete(k); throw e; });
    wssiAreaCache.set(k, { pending }); return pending;
  }
  let wssiWins = null;
  function wssiWindows() {
    if (wssiWins && (wssiWins.pending || Date.now() - wssiWins.at < 10 * 60e3)) return wssiWins.pending || Promise.resolve(wssiWins.list);
    const q = "where=1%3D1&outFields=validstart,validend,idp_filedate&returnDistinctValues=true&returnGeometry=false&f=json";
    const pending = get(F.WSSIP_URL("WWA", q), "json").then((j) => {
      if (!j || !Array.isArray(j.features)) throw Error("unrecognized WSSI-P answer");
      const seen = new Map(); for (const f of j.features) { const a = f.attributes || {}, s = F.zTime(a.validstart), e = F.zTime(a.validend); if (s && e) seen.set(s, { start: s, end: e, issued: a.idp_filedate ? new Date(a.idp_filedate).toISOString() : null }); }
      const list = [...seen.values()].sort((x, y) => (x.start < y.start ? -1 : 1)); wssiWins = { at: Date.now(), list }; emit(); return list;
    }).catch((e) => { wssiWins = null; throw e; });
    wssiWins = { pending }; return pending;
  }
  async function refreshOutlooks() {
    await Promise.all([1, 2, 3].map(async (d) => { const at = nowIso(); try { outlooks[d].ingest(await get(F.OUTLOOK_URL(d), "json"), at); } catch (e) { outlooks[d].fail(at, e.message); } }));
    emit();
  }
  async function refreshERO() {
    await Promise.all([1, 2, 3].map(async (d) => {
      const tried = nowIso(), meta = {};
      try {
        const body = await get(wpcUrl(d), "json", meta);
        let at = tried;
        if (NWS.mode === "function") { if (!meta.upstreamAt) throw Error("function answer without its upstream time"); at = new Date(meta.upstreamAt).toISOString(); }
        ero[d].ingest(body, at, NWS.mode === "function" ? "wpc" : "mapservice");
      } catch (e) { ero[d].fail(tried, e.message); }
    }));
    emit();
  }

  async function refreshFire() {
    await Promise.all(FIRE_DAYS.flatMap((d) => FIRE_PARTS.map(async (part) => {
      const at = nowIso();
      try { fire[d][part].ingest(await get(F.SPC_FIRE_URL(d, part), "json"), at); } catch (e) { fire[d][part].fail(at, e.message); }
    })));
    emit();
  }
  async function refreshNIFC() {
    const at = nowIso();
    try {
      const [inc, per] = await Promise.all([get(F.NIFC_INC_URL, "json"), get(F.NIFC_PER_URL, "json")]);
      nifc.products = F.parseNIFC(inc, per); Object.assign(nifc, { state: "ok", lastOk: at, error: null });
    } catch (e) { Object.assign(nifc, { state: "failed", error: e.message }); }
    emit();
  }
  /* HMS: today's and yesterday's UTC files (the matcher keeps windows that ended within 24 hours). Only through the
     same-origin function: NOAA's file has no CORS header. */
  async function refreshHMS() {
    const at = nowIso();
    if (NWS.mode !== "function") { Object.assign(hms, { state: "failed", error: "needs the preview's same-origin function (NOAA's HMS file has no CORS header)" }); emit(); return; }
    try {
      const days = [0, 1].map((k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10).replace(/-/g, ""));
      const got = await Promise.all(days.map(async (d) => { try { return F.parseHMS(await get(smokeUrl("/hms/" + d), "text"), d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6)); } catch (e) { if (/HTTP 404/.test(e.message) && d === days[0]) return []; throw e; } }));
      Object.assign(hms, { state: "ok", lastOk: at, error: null, products: got.flat(), days });
    } catch (e) { Object.assign(hms, { state: "failed", error: e.message }); }
    emit();
  }
  async function refreshNHC() {
    const at = nowIso();
    try { const parts = await Promise.all(["two", "cone", "track", "points", "watchwarning"].map(async (L) => F.parseNHC(await get(F.NHC_URL(L), "json"), L))); Object.assign(nhc, { state: "ok", lastOk: at, error: null, products: parts.flat() }); }
    catch (e) { Object.assign(nhc, { state: "failed", error: e.message }); }
    emit();
  }
  /* wind speed probabilities at the venue: only asked while NHC has a storm (a forecast cone) */
  async function tropicalFor(lat, lon) {
    const key = lat.toFixed(3) + "," + lon.toFixed(3), at = nowIso();
    if (nhc.state !== "ok") return;
    if (tcw.key === key && tcw.lastOk && Date.parse(tcw.lastOk) >= Date.parse(nhc.lastOk) && Date.now() - Date.parse(tcw.lastOk) < 10 * 60e3) return; // asked since NHC last answered
    if (!nhc.products.some((p) => p.part === "cone")) { Object.assign(tcw, { key, state: "ok", lastOk: at, error: null, products: [] }); emit(); return; }
    try { const ans = {}; for (const kt of [34, 50, 64]) ans[kt] = await get(F.NHC_WSP_AT(kt, lat, lon), "json"); Object.assign(tcw, { key, state: "ok", lastOk: at, error: null, products: F.parseNHCWsp(ans, [+lon.toFixed(3), +lat.toFixed(3)]) }); }
    catch (e) { Object.assign(tcw, { key, state: "failed", error: e.message }); }
    emit();
  }
  /* aviation: METAR and TAF for the airports an event uses, through the same-origin function (AWC has no CORS header) */
  const av = { key: null, state: "never", lastOk: null, error: null, products: [] };
  let avPending = null;
  function airportsFor(ids) {
    const list = [...new Set((ids || []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z][A-Z0-9]{3}$/.test(x)))].sort().slice(0, 4), key = list.join(",");
    if (!list.length) { Object.assign(av, { key: "", state: "never", products: [] }); return Promise.resolve(); }
    if (av.key === key && av.lastOk && Date.now() - Date.parse(av.lastOk) < 2 * 60e3) return Promise.resolve();
    if (avPending && avPending.key === key) return avPending.p;
    if (av.state === "never" || av.key !== key) Object.assign(av, { key, state: av.key === key ? av.state : "pending" }); // "checking", not "not part of this sample"
    if (NWS.mode !== "function") { Object.assign(av, { key, state: "failed", error: "needs the preview's same-origin function (the Aviation Weather Center sends no CORS header)", products: [] }); emit(); return Promise.resolve(); }
    const base = NWS.base.replace(/\/api\/nws$/, "/api/awc"), at = nowIso();
    const p = Promise.all([get(base + "/metar?ids=" + key, "json"), get(base + "/taf?ids=" + key, "json")])
      .then(([m, t]) => { Object.assign(av, { key, state: "ok", lastOk: at, error: null, products: [...F.parseMETAR(m), ...F.parseTAF(t)] }); })
      .catch((e) => { Object.assign(av, { key, state: "failed", error: e.message }); if (av.key !== key) av.products = []; })
      .finally(() => { avPending = null; emit(); });
    avPending = { key, p }; return p;
  }
  /* aviation, en route: pilot reports for the boxes asked (AWC returns at most 400 per box), and the national SIGMETs,
     G-AIRMET snapshots (0, 3, 6, 9, 12 h) and CWAs; kept 2 minutes. FAA airport status for everyone; kept 1 minute.
     Asked for only by the map's Aviation layer and by Planner events with airports or a route. */
  const E = window.ThreatsEnroute;
  const enr = { key: null, state: "never", lastOk: null, error: null, products: [], partial: [] }, faa = { state: "never", lastOk: null, error: null, products: [] };
  let enrPending = null, faaPending = null;
  function enrouteFor(boxes) {
    const list = (boxes || []).filter((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)).slice(0, 4).map((b) => b.map((x) => Math.round(x * 10) / 10)), key = JSON.stringify(list);
    if (!E) return Promise.resolve();
    if (enr.lastOk && Date.now() - Date.parse(enr.lastOk) < 2 * 60e3 && (enr.key === key || !list.length)) return Promise.resolve();
    if (enrPending && enrPending.key === key) return enrPending.p;
    if (NWS.mode !== "function") { Object.assign(enr, { key, state: "failed", error: "needs the preview's same-origin function (the Aviation Weather Center sends no CORS header)" }); emit(); return Promise.resolve(); }
    if (enr.state === "never") enr.state = "pending";
    const base = NWS.base.replace(/\/api\/nws$/, "/api/awc"), at = nowIso(), parts = [];
    const one = (name, fn) => fn().then((v) => v, (e) => { parts.push(name + ": " + e.message); return null; });
    const p = Promise.all([
      one("SIGMETs", async () => E.parseAirSigmet(await get(base + "/airsigmet", "json"))),
      one("G-AIRMETs", async () => E.parseGAirmet(await Promise.all([0, 3, 6, 9, 12].map((f) => get(base + "/gairmet?fore=" + f, "json"))))),
      one("CWAs", async () => E.parseCWA(await get(base + "/cwa", "json"))),
      one("pilot reports", async () => (await Promise.all(list.map((b) => get(base + "/pirep?bbox=" + b.join(",") + "&age=2", "json")))).flatMap(E.parsePIREP)),
    ]).then(([sg, ga, cw, pr]) => {
      const got = [sg, ga, cw, pr];
      if (got.every((x) => x == null)) { Object.assign(enr, { key, state: "failed", error: parts.join("; ") }); return; }
      const seen = new Set(), prs = (pr || []).filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
      Object.assign(enr, { key, state: "ok", lastOk: at, error: parts.length ? parts.join("; ") : null, partial: parts, products: [...(sg || []), ...(ga || []), ...(cw || []), ...prs] });
    }).finally(() => { enrPending = null; emit(); });
    enrPending = { key, p }; return p;
  }
  function faaFor() {
    if (!E) return Promise.resolve();
    if (faa.lastOk && Date.now() - Date.parse(faa.lastOk) < 60e3) return Promise.resolve();
    if (faaPending) return faaPending;
    if (NWS.mode !== "function") { Object.assign(faa, { state: "failed", error: "needs the preview's same-origin function (the FAA status service sends no CORS header)" }); emit(); return Promise.resolve(); }
    if (faa.state === "never") faa.state = "pending";
    const base = NWS.base.replace(/\/api\/nws$/, "/api/faa"), at = nowIso();
    faaPending = Promise.all([get(base + "/airport-events", "json"), get(base + "/operations-plan", "json").catch(() => null)])
      .then(([ev, plan]) => { Object.assign(faa, { state: "ok", lastOk: at, error: plan ? null : "operations plan not available", products: E.parseFAA(ev, plan, at) }); })
      .catch((e) => { Object.assign(faa, { state: "failed", error: e.message }); })
      .finally(() => { faaPending = null; emit(); });
    return faaPending;
  }
  /* NWS's own placement of a venue (forecast zone, county, fire weather zone; over the water only a marine zone).
     Cached per venue; a failed lookup leaves the venue without placement (the drawn zone outlines then decide). */
  const points = new Map();
  function pointZones(lat, lon) {
    const key = (+lat).toFixed(4) + "," + (+lon).toFixed(4), c = points.get(key);
    if (c) return c.zones || null;
    points.set(key, { pending: true });
    get(nwsUrl("https://api.weather.gov/points/" + key), "json").then((j) => { points.set(key, { zones: F.pointZones(j) }); emit(); }).catch(() => points.set(key, { failed: true }));
    return null;
  }
  async function refreshMonitorsAll() {
    const at = nowIso();
    try { monAll.products = F.parseAirNowMonitors(await get(F.AIRNOW_MON_ALL_URL, "json")); Object.assign(monAll, { state: "ok", lastOk: at, error: null }); }
    catch (e) { Object.assign(monAll, { state: "failed", error: e.message }); }
    emit();
  }
  /* the venue: monitors within 25 miles, its AirNow forecast area (polygon lookup, then that area's rows), NOAA smoke
     guidance at the point. Each part has its own state; a slow part never holds up the others. Kept 10 minutes. */
  let aqPending = null;
  function aqFor(lat, lon) {
    const key = lat.toFixed(3) + "," + lon.toFixed(3);
    if (aq.key === key && aq.at && Date.now() - aq.at < 10 * 60e3) return Promise.resolve();
    if (aqPending && aqPending.key === key) return aqPending.p;
    if (aq.key !== key) Object.assign(aq, { key, obs: { state: "never" }, fcst: { state: "never" }, naqfc: { state: "never" }, products: [], at: null });
    const parts = { obs: [], fcst: [], naqfc: [] }, done = () => { aq.products = [...parts.obs, ...parts.fcst, ...parts.naqfc]; emit(); };
    const run = async (name, fn) => { const at = nowIso(); try { parts[name] = await fn(); aq[name] = { state: "ok", lastOk: at, error: null }; } catch (e) { aq[name] = { state: "failed", lastOk: aq[name].lastOk || null, error: e.message }; } done(); };
    const p = Promise.allSettled([
      run("obs", async () => F.parseAirNowMonitors(await get(F.AIRNOW_MON_URL(lat, lon, 25), "json"))),
      run("fcst", async () => {
        const a = await get(F.AIRNOW_AREA_AT(lat, lon), "json"); if (!a || !Array.isArray(a.features)) throw Error("unrecognized AirNow area answer");
        const ra = a.features[0] && a.features[0].attributes; if (!ra) return []; // outside every AirNow forecast area
        const area = ra.RAName, st = String(ra.RACode || "").slice(0, 2).toUpperCase();
        const text = NWS.mode === "function" ? await get(smokeUrl("/airnow-area?area=" + encodeURIComponent(area) + "&state=" + st), "text") : (await get("https://files.airnowtech.org/airnow/today/reportingarea.dat", "text")).split("\n").filter((l) => { const c = l.split("|"); return c[7] === area && c[8] === st; }).join("\n");
        return F.aqForecastProducts(F.parseReportingArea(text)).map((x) => ({ ...x, forVenue: true }));
      }),
      F.NAQFC_ENABLED && run("naqfc", async () => [F.parseNAQFC(await get(F.NAQFC_SMOKE_AT(lat, lon), "json"), [+lon.toFixed(3), +lat.toFixed(3)])]),
    ]).then(() => { aq.at = Date.now(); aqPending = null; });
    aqPending = { key, p }; return p;
  }
  const aqSrc = (s, n) => s.state === "never" ? { state: "pending", lastOk: null, count: 0 } : { state: s.state === "ok" ? "ok" : "failed", lastOk: s.lastOk || null, count: n, error: s.error };

  /* one source state per fire outlook day: worst of its two parts; reach = the end of the latest day answered */
  function fireSources(now) {
    const out = {};
    for (const d of FIRE_DAYS) {
      const a = fire[d].windrh, b = fire[d].dryt, ia = a.sourceInfo(), ib = b.sourceInfo(), ca = a.current(now), cb = b.current(now);
      const ok = ia.state === "ok" && ib.state === "ok";
      if (ia.pending || ib.pending) { out["fire" + d] = { state: "pending", lastOk: null, count: 0 }; continue; }
      out["fire" + d] = { state: ok ? "ok" : "failed", lastOk: ok ? [ia.lastOk, ib.lastOk].sort()[0] : (ia.lastOk && ib.lastOk ? [ia.lastOk, ib.lastOk].sort()[0] : null), count: ca.products.length + cb.products.length,
        error: ia.error || ib.error, outlook: ca.status === "expired" || cb.status === "expired" ? "expired" : ca.status, validEnd: ca.validEnd || cb.validEnd, issued: ca.issued || cb.issued, phrase: ca.phrase || null };
    }
    return out;
  }

  /* our research model: the same published files and validation as the Severe viewer */
  async function sha256(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  async function checked(path, hash) { const t = await get(MODEL_BASE + path + (hash ? "?v=" + hash.slice(0, 10) : ""), "text"); if (hash && (await sha256(t)) !== hash) throw Error("checksum changed for " + path); return JSON.parse(t); }
  async function refreshModel() {
    try {
      const index = D.validateIndex(await checked("index.json")), registry = D.validateRegistry(await checked("models.json"));
      if (!model.grid || model.index.grid.sha256 !== index.grid.sha256) {
        model.grid = D.validateGrid((await checked(index.grid.file, index.grid.sha256)).coordinates);
        const mask = await checked("display-mask.json"); model.hidden = D.validateMask(mask, index.grid.sha256, model.grid.length);
        model.hull = window.d3 ? d3.Delaunay.from(model.grid).hullPolygon() : null;
      }
      model.index = index; model.registry = registry;
      for (const day of [1, 2]) {
        const run = index.runs.find((r) => r.day === day), now = Date.now();
        if (!run) { model.runs[day] = { reason: "No Day " + day + " run published" }; continue; }
        const fresh = D.freshness(run, now);
        if (fresh === "expired" || fresh === "unavailable") { model.runs[day] = { run, reason: "Day " + day + " run " + fresh }; continue; }
        if (!registry.models[run.model_sha256]) { model.runs[day] = { run, reason: "Run made by a model with no published development results" }; continue; }
        const prev = model.runs[day];
        if (prev && prev.run && prev.run.sha256 === run.sha256 && prev.values) continue;
        const raw = D.validateCase(await checked(run.file, run.sha256), run, model.grid.length);
        model.runs[day] = { run, values: D.applyMask(raw, model.hidden), version: registry.models[run.model_sha256].version };
      }
      model.state = "ok"; model.error = null;
    } catch (e) { model.state = "failed"; model.error = e.message; }
    emit();
  }

  let emitTimer = null;
  function emit() { clearTimeout(emitTimer); emitTimer = setTimeout(() => listeners.forEach((f) => f()), 50); }

  /* what the page draws, at `now` */
  function snapshotRaw(now = Date.now()) {
    const ps = alerts.products(now), ai = alerts.sourceInfo();
    const mdList = md.products.filter((p) => p.expires == null || Date.parse(p.expires) > now);
    const o = { 1: outlooks[1].current(now), 2: outlooks[2].current(now), 3: outlooks[3].current(now) };
    const e = { 1: ero[1].current(now), 2: ero[2].current(now), 3: ero[3].current(now) };
    const wsp = wssi.products.filter((p) => Date.parse(p.validEnd) > now);
    const fireP = FIRE_DAYS.flatMap((d) => FIRE_PARTS.flatMap((part) => fire[d][part].current(now).products));
    const products = [...ps.filter((p) => p.status === "active" || p.status === "lapsed").map(withZones), ...wsp, ...mdList, ...o[1].products, ...o[2].products, ...o[3].products, ...e[1].products, ...e[2].products, ...e[3].products, ...fireP, ...nifc.products, ...hms.products, ...aq.products, ...nhc.products, ...tcw.products, ...av.products, ...enr.products, ...faa.products];
    const src = (info, count, extra) => ({ state: info.state === "ok" ? "ok" : "failed", lastOk: info.lastOk, count, error: info.error, ...extra });
    return {
      live: true, clock: new Date(now).toISOString(), products,
      ended: ps.filter((p) => p.status === "ended" && now - Date.parse(p.ended || p.expires) < 30 * 60e3),
      sources: {
        alerts: src(ai, ps.filter((p) => p.status === "active").length),
        md: src({ state: md.state === "ok" ? "ok" : "failed", lastOk: md.lastOk, error: md.error }, mdList.length, { service: md.service, list: md.list, via: md.via }),
        day1: src(outlooks[1].sourceInfo(), o[1].products.length, { outlook: o[1].status, validEnd: o[1].validEnd }),
        day2: src(outlooks[2].sourceInfo(), o[2].products.length, { outlook: o[2].status, validEnd: o[2].validEnd }),
        day3: src(outlooks[3].sourceInfo(), o[3].products.length, { outlook: o[3].status, validEnd: o[3].validEnd }),
        ero1: src(ero[1].sourceInfo(), e[1].products.length, { outlook: e[1].status, validEnd: e[1].validEnd, issued: e[1].issued, via: ero[1].sourceInfo().via }),
        ero2: src(ero[2].sourceInfo(), e[2].products.length, { outlook: e[2].status, validEnd: e[2].validEnd, issued: e[2].issued, via: ero[2].sourceInfo().via }),
        wssip: wssi.state === "never" || (wssiPending && !wssi.lastOk) ? { state: "pending", lastOk: null, count: 0 } : src({ state: wssi.state === "ok" ? "ok" : "failed", lastOk: wssi.lastOk, error: wssi.error }, wsp.length, { validEnd: wssi.reachEnd, issued: wssi.issued, unavailable: wssi.unavailable || [] }),
        ...fireSources(now),
        awc: av.state === "never" ? { state: av.key ? "pending" : "na", lastOk: null, count: 0 } : { state: av.state, lastOk: av.lastOk, count: av.products.length, error: av.error },
        enroute: enr.state === "never" || enr.state === "pending" ? { state: "pending", lastOk: null, count: 0 } : { state: enr.state, lastOk: enr.lastOk, count: enr.products.length, error: enr.error, partial: enr.partial },
        faa: faa.state === "never" || faa.state === "pending" ? { state: "pending", lastOk: null, count: 0 } : { state: faa.state, lastOk: faa.lastOk, count: faa.products.length, error: faa.error },
        nhc: nhc.state === "never" ? { state: "pending", lastOk: null, count: 0 } : { state: nhc.state, lastOk: nhc.lastOk, count: nhc.products.length, error: nhc.error || tcw.error, storms: nhc.products.filter((p) => p.part === "cone").length },
        hms: hms.state === "never" ? { state: "pending", lastOk: null, count: 0 } : { state: hms.state, lastOk: hms.lastOk, count: hms.products.length, error: hms.error },
        aqobs: aqSrc(aq.obs, aq.products.filter((p) => p.kind === "aqobs").length), aqfcst: aqSrc(aq.fcst, aq.products.filter((p) => p.kind === "aqfcst").length), naqfc: F.NAQFC_ENABLED ? aqSrc(aq.naqfc, aq.products.filter((p) => p.kind === "smokefcst").length) : { state: "na" },
        monitors: monAll.state === "never" ? { state: "pending", lastOk: null, count: 0 } : { state: monAll.state, lastOk: monAll.lastOk, count: monAll.products.length, error: monAll.error },
        nifc: nifc.state === "never" ? { state: "pending", lastOk: null, count: 0 } : src({ state: nifc.state, lastOk: nifc.lastOk, error: nifc.error }, nifc.products.length),
        ero3: src(ero[3].sourceInfo(), e[3].products.length, { outlook: e[3].status, validEnd: e[3].validEnd, issued: e[3].issued, via: ero[3].sourceInfo().via }),
      },
      model,
    };
  }
  function snapshot(now = Date.now()) { const d = snapshotRaw(now); if (mapFeeds) for (const k of Object.keys(d.sources)) { const f = SRC_FEED(k); if (FEEDS[f] && !mapFeeds.has(f)) d.sources[k] = { state: "off", lastOk: null, count: 0 }; } return d; }

  let started = null;
  /* only: limit to some feeds (Event Manager asks for ["alerts", "ero"]) */
  function start(opts = {}) {
    if (started) return started;
    const want = (k) => !opts.only || opts.only.includes(k);
    // fire outlooks (16 files) and NIFC (a large answer) load in the background: their sources read "Loading" until then
    if (want("fire")) refreshFire(); if (want("nifc")) refreshNIFC(); if (want("hms")) refreshHMS(); if (want("monitors")) refreshMonitorsAll(); if (want("nhc")) refreshNHC();
    setInterval(() => { if (!document.hidden && want("nhc")) refreshNHC(); }, 10 * 60e3);
    setInterval(() => { if (!document.hidden) { if (want("hms")) refreshHMS(); if (want("monitors")) refreshMonitorsAll(); } }, 10 * 60e3);
    started = Promise.allSettled([want("alerts") && refreshAlerts(), want("md") && refreshMD(), want("spc") && refreshOutlooks(), want("ero") && refreshERO()]);
    setInterval(() => { if (!document.hidden && want("nifc")) refreshNIFC(); }, 5 * 60e3); // NIFC refreshes from IRWIN every 5 minutes
    setInterval(() => { if (!document.hidden) { if (want("alerts")) refreshAlerts(); if (want("md")) refreshMD(); } }, 60e3);
    setInterval(() => { if (!document.hidden) { if (want("spc")) refreshOutlooks(); if (want("ero")) refreshERO(); if (want("fire")) refreshFire(); } }, 10 * 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshAlerts(); refreshMD(); } });
    return started;
  }
  /* the map: each layer's feeds load when it is turned on and stop refreshing when it is off (Event Manager keeps start()) */
  let mapFeeds = null; const feedTimers = {}, feedAt = {}, QUICK = new Set(["alerts", "md", "spc", "ero"]);
  const FEEDS = { alerts: [() => refreshAlerts(), 60e3], md: [() => refreshMD(), 60e3], spc: [() => refreshOutlooks(), 10 * 60e3], ero: [() => refreshERO(), 10 * 60e3], fire: [() => refreshFire(), 10 * 60e3], nifc: [() => refreshNIFC(), 5 * 60e3], hms: [() => refreshHMS(), 10 * 60e3], monitors: [() => refreshMonitorsAll(), 10 * 60e3], nhc: [() => refreshNHC(), 10 * 60e3] };
  function setFeeds(keys) {
    const want = new Set((keys || []).filter((k) => FEEDS[k])), first = [];
    if (!mapFeeds) { mapFeeds = new Set(); document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (mapFeeds.has("alerts")) refreshAlerts(); if (mapFeeds.has("md")) refreshMD(); } }); }
    for (const k of Object.keys(FEEDS)) {
      /* turned on: fetch now unless fetched within its refresh interval (a quick off-and-on doesn't download again); the map waits
         only for the quick feeds; fire outlooks, NIFC, HMS, monitors and NHC load in the background and read "Loading" meanwhile */
      if (want.has(k) && !mapFeeds.has(k)) { const run = () => { feedAt[k] = Date.now(); return FEEDS[k][0](); };
        if (!(Date.now() - (feedAt[k] || 0) < FEEDS[k][1])) { const r = run(); if (QUICK.has(k)) first.push(r); }
        feedTimers[k] = setInterval(() => { if (!document.hidden) run(); }, FEEDS[k][1]); }
      if (!want.has(k) && mapFeeds.has(k)) { clearInterval(feedTimers[k]); delete feedTimers[k]; }
    }
    mapFeeds = want; return Promise.allSettled(first);
  }
  const SRC_FEED = (k) => (/^day\d$/.test(k) ? "spc" : /^ero\d$/.test(k) ? "ero" : /^fire\d$/.test(k) ? "fire" : k);
  let modelStarted = null;
  function startModel() { if (!modelStarted) { modelStarted = refreshModel(); setInterval(refreshModel, 10 * 60e3); } return modelStarted; }

  /* ---------- archived official samples, replayed through the same adapter (not live observations) ---------- */
  const ARCHIVES = {
    "archive-lox": { kind: "nws", file: "tests/fixtures/threats/nws-archive-klox-sv-w-0015.json", label: "NWS Los Angeles severe thunderstorm warning 0015, Nov 19, 2026" },
    "archive-mtr": { kind: "nws", file: "tests/fixtures/threats/nws-archive-kmtr-to-w-0003.json", label: "NWS San Francisco tornado warning 0003, Nov 16, 2026" },
    "archive-ww705": { kind: "wou", file: "tests/fixtures/threats/spc-wou0705.txt", label: "SPC Tornado Watch 705 (official WOU), Nov 12, 2026" },
    // NWS Flash Flood Warnings and WPC Excessive Rainfall Outlooks from Nov 20, replayed at a fixed time
    "archive-flood-day": { kind: "mix", clock: "2026-11-20T17:35:00Z", nws: ["tests/fixtures/threats/nws-archive-kmlb-ff-w-0036.json", "tests/fixtures/threats/nws-archive-kjax-ff-w-0054.json"], ero: [1, 2, 3].map((d) => "tests/fixtures/threats/wpc-ero-day" + d + "-20261120.geojson"), label: "NWS Flash Flood Warnings and WPC Excessive Rainfall Outlooks, Florida, Nov 20, 2026 at 12:35 p.m. EST" },
    "archive-flood-afternoon": { kind: "mix", clock: "2026-11-20T19:20:00Z", nws: ["tests/fixtures/threats/nws-archive-kmlb-ff-w-0036.json", "tests/fixtures/threats/nws-archive-kjax-ff-w-0054.json"], ero: [1, 2, 3].map((d) => "tests/fixtures/threats/wpc-ero-day" + d + "-20261120.geojson"), label: "NWS Flash Flood Warnings and WPC Excessive Rainfall Outlooks, Florida, Nov 20, 2026 at 2:20 p.m. EST (after the Flagler warning was cut back)" },
    "archive-flood-outage": { kind: "mix", clock: "2026-11-20T19:40:00Z", alertsFailAfter: "2026-11-20T18:00:00Z", nws: ["tests/fixtures/threats/nws-archive-kmlb-ff-w-0036.json", "tests/fixtures/threats/nws-archive-kjax-ff-w-0054.json"], ero: [1, 2, 3].map((d) => "tests/fixtures/threats/wpc-ero-day" + d + "-20261120.geojson"), label: "NWS Flash Flood Warnings and WPC outlooks, Florida, Nov 20, 2026: NWS answered until 1:00 p.m. EST, then not (outage replay); now 2:40 p.m." },
    // NWS Salt Lake City winter alerts (Nov 18–20) and WPC WSSI-P captured from the NOAA map service on Nov 20, 21:23Z
    "archive-winter-advisory": { kind: "mix", clock: "2026-11-18T23:00:00Z", nws: ["tests/fixtures/threats/nws-archive-kslc-ww-y-0018.json", "tests/fixtures/threats/nws-archive-kslc-ws-w-0003.json"], ero: [], wssip: ["tests/fixtures/threats/wpc-wssi-p-overall-wasatch-20261120.json", "tests/fixtures/threats/wpc-wssi-p-overall-cascades-20261120.json"], zones: "tests/fixtures/threats/nws-zones-utah-20261120.json", label: "NWS Salt Lake City winter alerts, Nov 18, 2026 at 4:00 p.m. MST" },
    "archive-winter-warning": { kind: "mix", clock: "2026-11-19T17:00:00Z", nws: ["tests/fixtures/threats/nws-archive-kslc-ww-y-0018.json", "tests/fixtures/threats/nws-archive-kslc-ws-w-0003.json"], ero: [], wssip: ["tests/fixtures/threats/wpc-wssi-p-overall-wasatch-20261120.json", "tests/fixtures/threats/wpc-wssi-p-overall-cascades-20261120.json"], zones: "tests/fixtures/threats/nws-zones-utah-20261120.json", label: "NWS Salt Lake City winter alerts, Nov 19, 2026 at 10:00 a.m. MST (after the upgrade to a Winter Storm Warning)" },
    "archive-winter-outlook": { kind: "mix", clock: "2026-11-20T21:30:00Z", nws: ["tests/fixtures/threats/nws-archive-kslc-ww-y-0018.json", "tests/fixtures/threats/nws-archive-kslc-ws-w-0003.json"], ero: [], wssip: ["tests/fixtures/threats/wpc-wssi-p-overall-wasatch-20261120.json", "tests/fixtures/threats/wpc-wssi-p-overall-cascades-20261120.json"], zones: "tests/fixtures/threats/nws-zones-utah-20261120.json", label: "WPC WSSI-P (captured Nov 20, 2026 21:23Z, Wasatch and Cascades) with NWS Salt Lake City alerts at 2:30 p.m. MST" },
    // SPC Fire Weather Outlooks from SPC's archive (Day 1-2 shapefiles, Day 3-8 points) and NWS Denver/Boulder fire weather
    // alerts (Nov 17-18); NIFC WFIGS incidents as captured 2026-11-21 01:0xZ
    "archive-fire-day4": { kind: "mix", clock: "2026-07-29T22:30:00Z", nws: [], ero: [], fire: [["spc-fire-day38-20260729.geojson", 3, "windrh"]], label: "SPC Day 3-8 fire weather outlook issued Jul 29, 2026 (Day 4 = Sat Aug 1)" },
    "archive-fire-day2": { kind: "mix", clock: "2026-07-31T21:00:00Z", nws: [], ero: [], fire: [["spc-fire-day2-20260731-2000-windrh.geojson", 2, "windrh"], ["spc-fire-day2-20260731-2000-dryt.geojson", 2, "dryt"], ["spc-fire-day38-20260731.geojson", 3, "windrh"]], label: "SPC Day 2 and Day 3-8 fire weather outlooks issued Jul 31, 2026" },
    "archive-fire-day1": { kind: "mix", clock: "2026-08-01T17:30:00Z", nws: [], ero: [], fire: [["spc-fire-day1-20260801-1700-windrh.geojson", 1, "windrh"], ["spc-fire-day1-20260801-1700-dryt.geojson", 1, "dryt"]], label: "SPC Day 1 fire weather outlook, Aug 1, 2026 1700Z update" },
    "archive-fire-watch": { kind: "mix", clock: "2026-11-17T20:00:00Z", nws: ["tests/fixtures/threats/nws-archive-kbou-fw-a-0044.json", "tests/fixtures/threats/nws-archive-kbou-fw-w-0057.json"], zones: "tests/fixtures/threats/nws-zones-colorado-fire-20261121.json", ero: [], fire: [["spc-fire-day1-20261117-1700-windrh.geojson", 1, "windrh"], ["spc-fire-day2-20261117-2000-windrh.geojson", 2, "windrh"], ["spc-fire-day2-20261117-2000-dryt.geojson", 2, "dryt"]], label: "NWS Denver/Boulder fire weather alerts, Nov 17, 2026 at 1:00 p.m. MST" },
    "archive-fire-warning": { kind: "mix", clock: "2026-11-18T07:00:00Z", nws: ["tests/fixtures/threats/nws-archive-kbou-fw-a-0044.json", "tests/fixtures/threats/nws-archive-kbou-fw-w-0057.json"], zones: "tests/fixtures/threats/nws-zones-colorado-fire-20261121.json", ero: [], fire: [["spc-fire-day2-20261117-2000-windrh.geojson", 2, "windrh"], ["spc-fire-day2-20261117-2000-dryt.geojson", 2, "dryt"]], label: "NWS Denver/Boulder, Nov 18, 2026 at midnight MST (after the upgrade to a Red Flag Warning)" },
    "archive-fire-incidents": { kind: "mix", clock: "2026-11-21T01:30:00Z", nws: [], ero: [], nifc: ["tests/fixtures/threats/nifc-wfigs-20261121-incidents.geojson", "tests/fixtures/threats/nifc-wfigs-20261121-perimeters.geojson"], label: "NIFC WFIGS current wildfire incidents and perimeters, captured Nov 21, 2026 01:0x UTC" },
    // NOAA HMS smoke (archived daily KML) and AirNow archived hourly monitor AQI (HourlyAQObs) and reporting-area files
    "archive-smoke-chicago": { kind: "mix", clock: "2026-07-16T22:30:00Z", nws: [], ero: [], hms: ["tests/fixtures/threats/hms-smoke-20260716-east.kml"], mons: ["tests/fixtures/threats/airnow-monitors-2026071622-chicago.geojson"], ra: ["tests/fixtures/threats/airnow-ra-20260716.dat"], label: "Smoke and air quality, Chicago, Jul 16, 2026 at 5:30 p.m. CDT (NOAA HMS and AirNow archives)" },
    "archive-smoke-metlife": { kind: "mix", clock: "2026-07-14T21:30:00Z", nws: [], ero: [], hms: ["tests/fixtures/threats/hms-smoke-20260714-east.kml"], mons: ["tests/fixtures/threats/airnow-monitors-2026071421-nyc.geojson"], ra: ["tests/fixtures/threats/airnow-ra-20260714.dat"], label: "Smoke overhead, New York area, Jul 14, 2026 at 5:30 p.m. EDT (NOAA HMS and AirNow archives)" },
    "archive-smoke-forecast-0714": { kind: "mix", clock: "2026-07-14T22:00:00Z", nws: [], ero: [], ra: ["tests/fixtures/threats/airnow-ra-20260714.dat"], label: "AirNow forecasts issued Jul 14, 2026 (Philadelphia, New York, Chicago)" },
    "archive-smoke-forecast-0715": { kind: "mix", clock: "2026-07-15T22:00:00Z", nws: [], ero: [], ra: ["tests/fixtures/threats/airnow-ra-20260715.dat"], label: "AirNow forecasts issued Jul 15, 2026 (Philadelphia, New York, Chicago)" },
    // Hurricane Isaias (AL092026): NWS Mobile TCV texts (IEM archive of the official products) and NHC advisory GIS; NWS
    // Jacksonville coastal products captured live on 2026-11-21
    "archive-tropical-watch": { kind: "mix", clock: "2026-10-07T17:00:00Z", nws: [], tcv: ["tests/fixtures/threats/tcv-kmob-al092026/202610071609-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610072103-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610080253-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610081156-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610090257-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610091500-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610091802-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610092353-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610100602-KMOB-WTUS84-TCVMOB.txt"], zones: "tests/fixtures/threats/nws-zones-gulf-al092026.json", nhc: ["tests/fixtures/threats/nhc-al092026-adv004.geojson"], ero: [], label: "Hurricane Isaias, NWS Mobile and NHC, Oct 7, 2026 at noon CDT (advisory 4)" },
    "archive-tropical-warning": { kind: "mix", clock: "2026-10-08T05:00:00Z", nws: [], tcv: ["tests/fixtures/threats/tcv-kmob-al092026/202610071609-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610072103-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610080253-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610081156-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610090257-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610091500-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610091802-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610092353-KMOB-WTUS84-TCVMOB.txt", "tests/fixtures/threats/tcv-kmob-al092026/202610100602-KMOB-WTUS84-TCVMOB.txt"], zones: "tests/fixtures/threats/nws-zones-gulf-al092026.json", nhc: ["tests/fixtures/threats/nhc-al092026-adv006.geojson"], ero: [], label: "Hurricane Isaias, Oct 8, 2026 at midnight CDT (after the upgrade to warnings; advisory 6)" },
    "archive-coastal-flagler": { kind: "mix", clock: "2026-11-21T18:30:00Z", points: "tests/fixtures/threats/nws-points-coastal-20261122.json", nws: ["tests/fixtures/threats/nws-live-kjax-coastal-20261121.json"], zones: "tests/fixtures/threats/nws-zones-kjax-coastal-20261121.json", ero: [], label: "NWS Jacksonville coastal flood, high surf and rip current products, Nov 21, 2026 at 1:30 p.m. EST (captured live)" },
    // NOAA Aviation Weather Center METARs and TAFs for O'Hare, Midway and Milwaukee, captured live 2026-11-22 16:3xZ
    "archive-aviation-enroute": { kind: "mix", clock: "2026-11-22T21:19:00Z", nws: [], ero: [], awc: ["tests/fixtures/threats/awc-metar-kord-kewr-klga-kjfk-20261122T2119Z.json", "tests/fixtures/threats/awc-taf-kord-kewr-klga-kjfk-20261122T2119Z.json"],
      enroute: { pirep: "tests/fixtures/threats/awc-pirep-conus-turb-ice-20261122T2119Z.json", airsigmet: "tests/fixtures/threats/awc-airsigmet-20261122T2119Z.json", cwa: "tests/fixtures/threats/awc-cwa-20261122T2119Z.json", gairmet: [0, 3, 6, 9, 12].map((f) => "tests/fixtures/threats/awc-gairmet-f" + f + "-20261122T2119Z.json") },
      faa: ["tests/fixtures/threats/faa-airport-events-20261122T2119Z.json", "tests/fixtures/threats/faa-operations-plan-20261122T2119Z.json"],
      label: "Aviation Weather Center METARs, TAFs, pilot reports, SIGMETs, G-AIRMETs and CWAs, and FAA airport status, Nov 22, 2026 at 4:19 p.m. EST (captured live)" },
    "archive-aviation-chicago": { kind: "mix", clock: "2026-11-22T16:35:00Z", nws: [], ero: [], awc: ["tests/fixtures/threats/awc-metar-kord-kmke-kmdw-20261122.json", "tests/fixtures/threats/awc-taf-kord-kmke-kmdw-20261122.json"], label: "Aviation Weather Center METARs and TAFs for KORD, KMDW and KMKE, Nov 22, 2026 at 10:35 a.m. CST (captured live)" },
    "archive-flood-night": { kind: "mix", clock: "2026-11-20T20:30:00Z", nws: ["tests/fixtures/threats/nws-archive-kmlb-ff-w-0036.json", "tests/fixtures/threats/nws-archive-kjax-ff-w-0054.json"], ero: [1, 2, 3].map((d) => "tests/fixtures/threats/wpc-ero-day" + d + "-20261120.geojson"), label: "NWS Flash Flood Warnings and WPC Excessive Rainfall Outlooks, Florida, Nov 20, 2026 at 3:30 p.m. EST" },
  };
  const archiveCache = new Map();
  async function archiveMessages(name) {
    const a = ARCHIVES[name];
    if (!archiveCache.has(name)) archiveCache.set(name, (async () => {
      const r = await fetch(a.file, { cache: "no-store" }); if (!r.ok) throw Error("archive file " + r.status);
      return a.kind === "wou" ? [F.wouToAlert(await r.text())] : (await r.json()).features;
    })().catch((e) => { archiveCache.delete(name); throw e; }));
    return archiveCache.get(name);
  }
  /* replay messages 1..step; the clock is one minute after the last message; county shapes come live from api.weather.gov */
  async function mixSnapshot(name) {
    const a = ARCHIVES[name], clock = Date.parse(a.clock), getJ = async (f) => { const r = await fetch(f, { cache: "no-store" }); if (!r.ok) throw Error("archive file " + r.status); return r.json(); };
    // alertsFailAfter: NWS answered until then and not afterwards (an archived outage)
    const lastAnswer = a.alertsFailAfter ? Date.parse(a.alertsFailAfter) : clock;
    const tcvF = (await Promise.all((a.tcv || []).map(async (f) => { const r = await fetch(f, { cache: "no-store" }); if (!r.ok) throw Error("archive file " + r.status); return F.tcvToAlerts(await r.text(), f.split("/").pop().replace(".txt", "")); }))).flat();
    const msgs = [...(await Promise.all(a.nws.map(getJ))).flatMap((j) => j.features), ...tcvF].filter((f) => Date.parse(f.properties.sent) + 30e3 <= lastAnswer).sort((x, y) => Date.parse(x.properties.sent) - Date.parse(y.properties.sent));
    const store = F.createAlertStore();
    msgs.forEach((f, i) => store.ingest({ type: "FeatureCollection", features: msgs.slice(0, i + 1) }, new Date(Date.parse(f.properties.sent) + 30e3).toISOString()));
    if (!a.alertsFailAfter && msgs.length) store.ingest({ type: "FeatureCollection", features: msgs }, new Date(clock).toISOString()); // NWS answered at the replay time
    if (a.alertsFailAfter) { store.ingest({ type: "FeatureCollection", features: msgs }, a.alertsFailAfter); store.fail(new Date(clock).toISOString(), "archived outage: NWS did not answer after " + a.alertsFailAfter); }
    const eros = (await Promise.all(a.ero.map(getJ))).map((j, i) => F.parseERO(j, i + 1, "wpc")).filter((o) => Date.parse(o.issued) <= clock && Date.parse(o.validEnd) > clock);
    // zone-based alerts: draw them from their forecast zones (fetched from NWS, through the function on Pages previews)
    const rawPs = store.products(clock), want = [...new Set(rawPs.filter((p) => p.geometrySource === "counties").flatMap((p) => p.zones))];
    // archived zone shapes (captured from api.weather.gov) keep the replay independent of today's NWS answers
    if (a.zones) { const zf = (await getJ(a.zones)).zones; for (const [u, z] of Object.entries(zf)) if (z && z.geometry && !zoneGeo.has(u)) zoneGeo.set(u, z.geometry); }
    await Promise.allSettled(want.map(zone));
    const ps = rawPs.map(withZones), si = store.sourceInfo(), na = { state: "na", lastOk: null, count: 0 };
    const fireOs = await Promise.all((a.fire || []).map(async ([f, d, part]) => F.parseFireOutlook(await getJ("tests/fixtures/threats/" + f), d, part)));
    const fireP = fireOs.flatMap((o) => o.products).filter((p) => Date.parse(p.issued) <= clock && Date.parse(p.validEnd) > clock);
    const fireSrc = {}; for (const [i, [, d]] of (a.fire || []).entries()) { const o = fireOs[i]; for (const dd of new Set([d, ...o.products.map((p) => p.day)])) { if (!(Date.parse(o.issued) <= clock)) continue; const k = "fire" + dd, n = fireP.filter((p) => p.day === dd).length; fireSrc[k] = { state: "ok", lastOk: a.clock, count: n, outlook: "current", validEnd: o.products.filter((p) => p.day === dd).map((p) => p.validEnd)[0] || (dd === d ? o.validEnd : null), issued: o.issued }; } }
    if (fireSrc.fire3 && (a.fire || []).some(([, d]) => d === 3)) for (let dd = 4; dd <= 8; dd++) if (!fireSrc["fire" + dd]) { const o = fireOs[(a.fire || []).findIndex(([, d]) => d === 3)]; fireSrc["fire" + dd] = { state: "ok", lastOk: a.clock, count: 0, outlook: "current", validEnd: new Date(Date.parse(o.validStart) + (dd - 2) * 864e5).toISOString(), issued: o.issued }; }
    const getT = async (f) => { const r = await fetch(f, { cache: "no-store" }); if (!r.ok) throw Error("archive file " + r.status); return r.text(); };
    const hmsP = (await Promise.all((a.hms || []).map(async (f) => F.parseHMS(await getT(f))))).flat().filter((p) => Date.parse(p.obsEnd) <= clock);
    const monP = (await Promise.all((a.mons || []).map(async (f) => F.parseAirNowMonitors(await getJ(f))))).flat().filter((p) => Date.parse(p.observed) <= clock);
    const raP = (await Promise.all((a.ra || []).map(async (f) => F.aqForecastProducts(F.parseReportingArea(await getT(f)).filter((r) => r.issueDate <= a.clock.slice(0, 10)))))).flat();
    const awcP = a.awc ? [...F.parseMETAR(await getJ(a.awc[0])), ...F.parseTAF(await getJ(a.awc[1]))].filter((p) => Date.parse(p.issued) <= clock) : [];
    const EN = window.ThreatsEnroute, enP = a.enroute && EN ? [...EN.parsePIREP(await getJ(a.enroute.pirep)), ...EN.parseAirSigmet(await getJ(a.enroute.airsigmet)), ...EN.parseCWA(await getJ(a.enroute.cwa)), ...EN.parseGAirmet(await Promise.all(a.enroute.gairmet.map(getJ)))].filter((p) => !p.issued || Date.parse(p.issued) <= clock) : [];
    const faaP = a.faa && EN ? EN.parseFAA(await getJ(a.faa[0]), await getJ(a.faa[1]), a.clock) : [];
    const nhcP = (await Promise.all((a.nhc || []).map(async (f) => F.parseNHC(await getJ(f))))).flat().filter((p) => !p.issued || Date.parse(p.issued) <= clock);
    const nifcP = a.nifc ? F.parseNIFC(await getJ(a.nifc[0]), await getJ(a.nifc[1])) : [];
    const wsp = (await Promise.all((a.wssip || []).map(getJ))).flatMap((j) => F.parseWSSIP(j)).filter((p) => (!p.issued || Date.parse(p.issued) <= clock) && Date.parse(p.validEnd) > clock);
    const eroSrc = (d) => { const o = eros.find((x) => x.products[0] && x.products[0].day === d); return o ? { state: "ok", lastOk: a.clock, count: o.products.length, outlook: "current", validEnd: o.validEnd, issued: o.issued, via: "wpc" } : na; };
    const pointsA = a.points ? Object.fromEntries(Object.entries((await getJ(a.points)).points).map(([k, v]) => { const [la, lo] = k.split(",").map(Number); return [la.toFixed(4) + "," + lo.toFixed(4), F.pointZones({ properties: v })]; })) : null;
    return { live: false, points: pointsA, archive: { name, label: a.label, step: 1, steps: 1, messages: [] }, clock: a.clock,
      products: [...ps.filter((p) => p.status === "active" || p.status === "lapsed"), ...eros.flatMap((o) => o.products), ...wsp, ...fireP, ...nifcP, ...hmsP, ...monP, ...raP, ...nhcP, ...awcP, ...enP, ...faaP], ended: ps.filter((p) => p.status === "ended"),
      sources: { alerts: !a.nws.length && !(a.tcv || []).length ? { state: "na" } : { state: a.alertsFailAfter ? "failed" : "ok", lastOk: si.lastOk, count: ps.filter((p) => p.status === "active").length, error: si.error }, md: na, day1: na, day2: na, day3: na, ero1: eroSrc(1), ero2: eroSrc(2), ero3: eroSrc(3),
        hms: a.hms ? { state: "ok", lastOk: a.clock, count: hmsP.length } : { state: "na" }, nhc: a.nhc ? { state: "ok", lastOk: a.clock, count: nhcP.length } : { state: "na" }, awc: a.awc ? { state: "ok", lastOk: a.clock, count: awcP.length } : { state: "na" }, enroute: a.enroute ? { state: "ok", lastOk: a.clock, count: enP.length } : { state: "na" }, faa: a.faa ? { state: "ok", lastOk: a.clock, count: faaP.length } : { state: "na" }, aqobs: a.mons ? { state: "ok", lastOk: a.clock, count: monP.length } : { state: "na" },
        aqfcst: a.ra ? { state: "ok", lastOk: a.clock, count: raP.length } : { state: "na" }, naqfc: { state: "na" }, monitors: a.mons ? { state: "ok", lastOk: a.clock, count: monP.length } : { state: "na" },
        ...fireSrc, nifc: a.nifc ? { state: "ok", lastOk: a.clock, count: nifcP.length } : { state: "na" },
        wssip: (a.wssip || []).length ? (wsp.length ? { state: "ok", lastOk: a.clock, count: wsp.length, validEnd: wsp.map((x) => x.validEnd).sort().pop(), issued: wsp[0].issued } : { state: "na" }) : { state: "na" } } };
  }
  async function archiveSnapshot(name, step) {
    if (ARCHIVES[name].kind === "mix") return mixSnapshot(name);
    const msgs = await archiveMessages(name), n = Math.max(1, Math.min(step || msgs.length, msgs.length));
    const store = F.createAlertStore();
    for (let i = 0; i < n; i++) store.ingest({ type: "FeatureCollection", features: msgs.slice(0, i + 1) }, new Date(Date.parse(msgs[i].properties.sent) + 30e3).toISOString()); // cumulative, like a real answer
    const clock = Date.parse(msgs[n - 1].properties.sent) + 60e3;
    const ps = store.products(clock);
    for (const p of ps) if (p.geometrySource === "counties") {
      const r = await F.resolveZones(p, zone), rec = store.get(p.id);
      Object.assign(rec, { geometry: r.geometry, geometryIncomplete: r.incomplete, zoneInfo: r, label: r.geometry ? F.labelPoint(r.geometry) : null });
    }
    const out = store.products(clock), si = store.sourceInfo();
    const na = { state: "na", lastOk: null, count: 0 };
    return { live: false, archive: { name, label: ARCHIVES[name].label, step: n, steps: msgs.length, messages: msgs.map((m) => ({ sent: m.properties.sent, action: (F.parseVTEC((m.properties.parameters.VTEC || [])[0]) || {}).action })) },
      clock: new Date(clock).toISOString(), products: out.filter((p) => p.status === "active"), ended: out.filter((p) => p.status === "ended"),
      sources: { alerts: { state: "ok", lastOk: si.lastOk, count: out.filter((p) => p.status === "active").length }, md: na, day1: na, day2: na, day3: na, ero1: na, ero2: na, ero3: na } };
  }

  /* the snapshot's per-feed states, keyed by the source registry (ThreatsFeeds.SOURCES) for the shared matcher */
  const STALE = { enroute: 20, faa: 10, awc: 20, nhc: 60, hms: 180, aqobs: 120, aqfcst: 180, naqfc: 360, monitors: 120, nifc: 20, fire1: 60, fire2: 60, fire3: 180, fire4: 180, fire5: 180, fire6: 180, fire7: 180, fire8: 180, wssip: 60, alerts: 10, md: 15, day1: 60, day2: 60, day3: 60, ero1: 60, ero2: 60, ero3: 60 };
  function registryState(d, now) {
    const one = (k) => { const x = d.sources[k]; if (!x) return { kind: "unavailable" }; if (x.state === "na") return { kind: "na" }; if (d.loading || x.state === "pending") return { kind: "loading" }; return { ...window.ThreatsCore.sourceState(x, now, STALE[k]), lastOk: x.lastOk }; };
    const worst = (keys) => { const s = keys.map(one).filter((x) => x.kind !== "na"); if (!s.length) return { kind: "na" }; const order = ["unavailable", "stale", "loading", "na", "empty", "current"]; const w = s.reduce((a, b) => (order.indexOf(b.kind) < order.indexOf(a.kind) ? b : a)); const oks = s.filter((x) => x.lastOk).map((x) => Date.parse(x.lastOk)); return { ...w, lastOk: oks.length ? new Date(Math.min(...oks)).toISOString() : w.lastOk }; };
    const reach = (keys) => keys.map((k) => d.sources[k] && d.sources[k].validEnd).filter(Boolean).sort().pop() || null;
    const fireKeys = Object.keys(d.sources).filter((k) => /^fire\d$/.test(k));
    return { "spc-fire": fireKeys.length ? { ...worst(fireKeys), reachEnd: reach(fireKeys), reach: ((ks) => ks.length ? (ks.length === 1 ? "Day " : "Days ") + ks.map((k) => k.slice(4)).join(", ") : "")(fireKeys.filter((k) => d.sources[k].issued && d.sources[k].state !== "na")) } : d.live ? { kind: "unavailable" } : { kind: "na" },
      "nifc-wfigs": d.sources.nifc ? one("nifc") : d.live ? { kind: "unavailable" } : { kind: "na" },
      "awc": d.sources.awc ? one("awc") : d.live ? { kind: "unavailable" } : { kind: "na" },
      "awc-enroute": d.sources.enroute ? { ...one("enroute"), partial: d.sources.enroute.partial || [] } : d.live ? { kind: "unavailable" } : { kind: "na" },
      "faa-nas": d.sources.faa ? one("faa") : d.live ? { kind: "unavailable" } : { kind: "na" },
      "nhc": d.sources.nhc ? one("nhc") : d.live ? { kind: "unavailable" } : { kind: "na" },
      "noaa-hms": d.sources.hms ? one("hms") : d.live ? { kind: "unavailable" } : { kind: "na" },
      "airnow-obs": d.sources.aqobs ? one("aqobs") : d.live ? { kind: "unavailable" } : { kind: "na" },
      "airnow-fcst": d.sources.aqfcst ? one("aqfcst") : d.live ? { kind: "unavailable" } : { kind: "na" },
      "noaa-naqfc-smoke": { kind: "na" }, // not used until NOAA documents the field and unit
      "nws-alerts": one("alerts"), "spc-md": one("md"), "wpc-wssi-p": d.sources.wssip ? { ...one("wssip"), reachEnd: d.sources.wssip.validEnd || null, unavailable: d.sources.wssip.unavailable || [], reach: d.sources.wssip.issued ? "file " + window.ThreatsCore.fmtZ(d.sources.wssip.issued) : "" } : { kind: "unavailable" }, "spc-outlook": { ...worst(["day1", "day2", "day3"]), reachEnd: reach(["day1", "day2", "day3"]) },
      "wpc-ero": { ...worst(["ero1", "ero2", "ero3"]), reachEnd: reach(["ero1", "ero2", "ero3"]), reach: ["ero1", "ero2", "ero3"].map((k, i) => d.sources[k] && d.sources[k].issued ? "Day " + (i + 1) + " issued " + window.ThreatsCore.fmtZ(d.sources[k].issued) : "").filter(Boolean).join(", ") } };
  }

  window.ThreatsLive = { archiveSnapshot, ARCHIVES, NWS, refresh: refreshAlerts, registryState, aqFor, tropicalFor, pointZones, airportsFor, enrouteFor, faaFor, setFeeds, mapFeeds: () => (mapFeeds ? [...mapFeeds] : null), monitorsAll: () => monAll.products, wssiFor, wssiArea, wssiWindows, start, startModel, snapshot, onUpdate: (f) => listeners.push(f), diag, _stores: { alerts, outlooks, md, model } };
})();
