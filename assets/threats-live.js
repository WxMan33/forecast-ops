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
        /* A level that still fails is bounded by the level below it: the chance of at least Extreme can't exceed the chance
           of at least Major. So when the lower level answered with no area at the venue, the failed level is under 5% there
           too (marked as inferred). Otherwise the answer is incomplete and the source stays unconfirmed. */
        const inferred = [];
        res.forEach((r, i) => { if (!r.failed) return; const below = res[i - 1]; if (i > 0 && Array.isArray(below) && below.length === 0) { res[i] = []; inferred.push(F.WSSI_LEVELS[i]); } else throw Error(r.failed); });
        const all = res.flat();
        Object.assign(wssi, { state: "ok", lastOk: at, error: null, inferred, products: all, key, reachEnd: all.map((x) => x.validEnd).sort().pop() || null, issued: all.map((x) => x.issued).filter(Boolean).sort().pop() || null });
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
  function snapshot(now = Date.now()) {
    const ps = alerts.products(now), ai = alerts.sourceInfo();
    const mdList = md.products.filter((p) => p.expires == null || Date.parse(p.expires) > now);
    const o = { 1: outlooks[1].current(now), 2: outlooks[2].current(now), 3: outlooks[3].current(now) };
    const e = { 1: ero[1].current(now), 2: ero[2].current(now), 3: ero[3].current(now) };
    const wsp = wssi.products.filter((p) => Date.parse(p.validEnd) > now);
    const products = [...ps.filter((p) => p.status === "active" || p.status === "lapsed").map(withZones), ...wsp, ...mdList, ...o[1].products, ...o[2].products, ...o[3].products, ...e[1].products, ...e[2].products, ...e[3].products];
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
        wssip: wssi.state === "never" || (wssiPending && !wssi.lastOk) ? { state: "pending", lastOk: null, count: 0 } : src({ state: wssi.state === "ok" ? "ok" : "failed", lastOk: wssi.lastOk, error: wssi.error }, wsp.length, { validEnd: wssi.reachEnd, issued: wssi.issued, inferred: wssi.inferred || [] }),
        ero3: src(ero[3].sourceInfo(), e[3].products.length, { outlook: e[3].status, validEnd: e[3].validEnd, issued: e[3].issued, via: ero[3].sourceInfo().via }),
      },
      model,
    };
  }

  let started = null;
  /* only: limit to some feeds (Event Manager asks for ["alerts", "ero"]) */
  function start(opts = {}) {
    if (started) return started;
    const want = (k) => !opts.only || opts.only.includes(k);
    started = Promise.allSettled([want("alerts") && refreshAlerts(), want("md") && refreshMD(), want("spc") && refreshOutlooks(), want("ero") && refreshERO()]);
    setInterval(() => { if (!document.hidden) { if (want("alerts")) refreshAlerts(); if (want("md")) refreshMD(); } }, 60e3);
    setInterval(() => { if (!document.hidden) { if (want("spc")) refreshOutlooks(); if (want("ero")) refreshERO(); } }, 10 * 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshAlerts(); refreshMD(); } });
    return started;
  }
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
    const msgs = (await Promise.all(a.nws.map(getJ))).flatMap((j) => j.features).filter((f) => Date.parse(f.properties.sent) + 30e3 <= lastAnswer).sort((x, y) => Date.parse(x.properties.sent) - Date.parse(y.properties.sent));
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
    const wsp = (await Promise.all((a.wssip || []).map(getJ))).flatMap((j) => F.parseWSSIP(j)).filter((p) => (!p.issued || Date.parse(p.issued) <= clock) && Date.parse(p.validEnd) > clock);
    const eroSrc = (d) => { const o = eros.find((x) => x.products[0] && x.products[0].day === d); return o ? { state: "ok", lastOk: a.clock, count: o.products.length, outlook: "current", validEnd: o.validEnd, issued: o.issued, via: "wpc" } : na; };
    return { live: false, archive: { name, label: a.label, step: 1, steps: 1, messages: [] }, clock: a.clock,
      products: [...ps.filter((p) => p.status === "active" || p.status === "lapsed"), ...eros.flatMap((o) => o.products), ...wsp], ended: ps.filter((p) => p.status === "ended"),
      sources: { alerts: { state: a.alertsFailAfter ? "failed" : "ok", lastOk: si.lastOk, count: ps.filter((p) => p.status === "active").length, error: si.error }, md: na, day1: na, day2: na, day3: na, ero1: eroSrc(1), ero2: eroSrc(2), ero3: eroSrc(3),
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
  const STALE = { wssip: 60, alerts: 10, md: 15, day1: 60, day2: 60, day3: 60, ero1: 60, ero2: 60, ero3: 60 };
  function registryState(d, now) {
    const one = (k) => { const x = d.sources[k]; if (!x) return { kind: "unavailable" }; if (x.state === "na") return { kind: "na" }; if (d.loading || x.state === "pending") return { kind: "loading" }; return { ...window.ThreatsCore.sourceState(x, now, STALE[k]), lastOk: x.lastOk }; };
    const worst = (keys) => { const s = keys.map(one).filter((x) => x.kind !== "na"); if (!s.length) return { kind: "na" }; const order = ["unavailable", "stale", "loading", "na", "empty", "current"]; const w = s.reduce((a, b) => (order.indexOf(b.kind) < order.indexOf(a.kind) ? b : a)); const oks = s.filter((x) => x.lastOk).map((x) => Date.parse(x.lastOk)); return { ...w, lastOk: oks.length ? new Date(Math.min(...oks)).toISOString() : w.lastOk }; };
    const reach = (keys) => keys.map((k) => d.sources[k] && d.sources[k].validEnd).filter(Boolean).sort().pop() || null;
    return { "nws-alerts": one("alerts"), "spc-md": one("md"), "wpc-wssi-p": d.sources.wssip ? { ...one("wssip"), reachEnd: d.sources.wssip.validEnd || null, inferred: d.sources.wssip.inferred || [], reach: d.sources.wssip.issued ? "file " + window.ThreatsCore.fmtZ(d.sources.wssip.issued) : "" } : { kind: "unavailable" }, "spc-outlook": { ...worst(["day1", "day2", "day3"]), reachEnd: reach(["day1", "day2", "day3"]) },
      "wpc-ero": { ...worst(["ero1", "ero2", "ero3"]), reachEnd: reach(["ero1", "ero2", "ero3"]), reach: ["ero1", "ero2", "ero3"].map((k, i) => d.sources[k] && d.sources[k].issued ? "Day " + (i + 1) + " issued " + window.ThreatsCore.fmtZ(d.sources[k].issued) : "").filter(Boolean).join(", ") } };
  }

  window.ThreatsLive = { archiveSnapshot, ARCHIVES, NWS, refresh: refreshAlerts, registryState, wssiFor, wssiArea, wssiWindows, start, startModel, snapshot, onUpdate: (f) => listeners.push(f), diag, _stores: { alerts, outlooks, md, model } };
})();
