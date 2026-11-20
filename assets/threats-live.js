/* Weather threats: live feed orchestration for the branch preview (browser only).
   Polls the official feeds straight from the browser, as the rest of Forecast Ops does for NWS:
     NWS alerts every 60 s, SPC MDs every 60 s, SPC outlooks every 10 min, our research model every 10 min.
   Every request and its outcome is kept in `diag` so the preview can show what was actually fetched. */
(function () {
  "use strict";
  const F = window.ThreatsFeeds, D = window.SevereDailyCore;
  const MODEL_BASE = "https://raw.githubusercontent.com/WxMan33/forecast-ops/main/assets/severe-daily/"; // the Severe viewer's published feed
  const alerts = F.createAlertStore(), outlooks = { 1: F.createOutlookStore(1), 2: F.createOutlookStore(2) };
  const md = { state: "never", lastOk: null, lastTry: null, error: null, products: [], service: null, list: null };
  const model = { state: "never", error: null, index: null, registry: null, grid: null, hidden: null, hull: null, runs: {} };
  const zoneGeo = new Map(), zonePending = new Map(), refDone = new Set(), mdText = new Map();
  const diag = { requests: [] };
  const listeners = [];
  const nowIso = () => new Date().toISOString();

  async function get(url, as) {
    const t0 = Date.now(), c = new AbortController(), timer = setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch(url, { signal: c.signal, cache: "no-store", headers: as === "json" ? { Accept: "application/geo+json, application/json" } : {} });
      diag.requests.push({ url, status: r.status, ms: Date.now() - t0, at: nowIso() }); if (diag.requests.length > 200) diag.requests.shift();
      if (!r.ok) throw Error("HTTP " + r.status);
      return as === "json" ? await r.json() : await r.text();
    } catch (e) {
      if (!/HTTP/.test(e.message)) diag.requests.push({ url, error: e.name === "AbortError" ? "timeout" : e.message, at: nowIso() });
      throw e.name === "AbortError" ? Error("timeout") : e;
    } finally { clearTimeout(timer); }
  }

  /* county-only alerts: shapes from the listed zones (cached for the session) */
  function zone(url) {
    if (zoneGeo.has(url)) return Promise.resolve(zoneGeo.get(url));
    if (!zonePending.has(url)) zonePending.set(url, get(url, "json").then((z) => { if (!z.geometry) throw Error("zone has no shape"); zoneGeo.set(url, z.geometry); return z.geometry; }).finally(() => zonePending.delete(url)));
    return zonePending.get(url);
  }
  function applyZones() {
    for (const p of alerts.products(Date.now())) {
      if (p.geometrySource !== "counties" || p.status !== "active") continue;
      const rec = alerts.get(p.id), got = p.zones.map((u) => zoneGeo.get(u)).filter(Boolean);
      rec.geometry = F.mergeGeometries(got); rec.geometryIncomplete = got.length < p.zones.length; rec.zoneInfo = { resolved: got.length, listed: p.zones.length };
      rec.label = rec.geometry ? F.labelPoint(rec.geometry) : null;
    }
  }
  async function resolvePending() {
    const want = [];
    for (const p of alerts.products(Date.now())) if (p.geometrySource === "counties" && p.status === "active") for (const u of p.zones) if (!zoneGeo.has(u)) want.push(u);
    if (!want.length) return false;
    await Promise.allSettled([...new Set(want)].slice(0, 80).map(zone)); applyZones(); return true;
  }
  /* "What changed" on first load: fetch the message an update replaced (same VTEC event) */
  async function fetchPrevious() {
    let changed = false;
    for (const p of alerts.products(Date.now())) {
      if (p.status !== "active" || p.previous || !p.references.length || refDone.has(p.messageId)) continue;
      refDone.add(p.messageId);
      const ref = p.references.slice().sort((a, b) => Date.parse(b.sent) - Date.parse(a.sent))[0];
      try {
        const old = F.normalizeAlert(await get(ref.url, "json"));
        if (old && old.id === p.id) { alerts.get(p.id).previous = { id: old.id, messageId: old.messageId, event: old.event, issued: old.issued, updated: old.updated, expires: old.expires, hazard: old.hazard, geometry: old.geometry }; changed = true; }
      } catch (e) { /* no comparison: the row stays hidden */ }
    }
    return changed;
  }
  async function refreshAlerts() {
    const at = nowIso();
    try { alerts.ingest(await get(F.ALERTS_URL, "json"), at); } catch (e) { alerts.fail(at, e.message); }
    applyZones(); emit();
    const a = await resolvePending(), b = await fetchPrevious(); if (a || b) emit();
  }

  async function refreshMD() {
    const at = nowIso(); md.lastTry = at;
    try {
      const list = F.parseMDList(await get(F.MD_LIST_URL, "text")); md.list = list.state;
      if (list.state === "unrecognized") throw Error("unrecognized MD list page");
      const products = [];
      for (const n of list.numbers) {
        if (!mdText.has(n)) mdText.set(n, await get(F.MD_URL(n), "text"));
        const p = F.parseMD(mdText.get(n), n);            // throws on unrecognized text: the whole refresh counts as failed
        if (p.severe) products.push(p);
      }
      md.products = products; md.state = "ok"; md.lastOk = at; md.error = null;
    } catch (e) { md.state = "failed"; md.error = e.message; }
    emit();
    try { const s = F.parseMDService(await get(F.MD_SERVICE_URL, "json")); md.service = { state: s.state, count: s.features.length, placeholder: !!s.placeholder, at }; }
    catch (e) { md.service = { state: "failed", error: e.message, at }; }
  }
  async function refreshOutlooks() {
    await Promise.all([1, 2].map(async (d) => { const at = nowIso(); try { outlooks[d].ingest(await get(F.OUTLOOK_URL(d), "json"), at); } catch (e) { outlooks[d].fail(at, e.message); } }));
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
    const mdList = md.products.filter((p) => Date.parse(p.expires) > now);
    const o = { 1: outlooks[1].current(now), 2: outlooks[2].current(now) };
    const products = [...ps.filter((p) => p.status === "active" || p.status === "lapsed"), ...mdList, ...o[1].products, ...o[2].products];
    const src = (info, count, extra) => ({ state: info.state === "ok" ? "ok" : "failed", lastOk: info.lastOk, count, error: info.error, ...extra });
    return {
      live: true, clock: new Date(now).toISOString(), products,
      ended: ps.filter((p) => p.status === "ended" && now - Date.parse(p.ended || p.expires) < 30 * 60e3),
      sources: {
        alerts: src(ai, ps.filter((p) => p.status === "active").length),
        md: src({ state: md.state === "ok" ? "ok" : "failed", lastOk: md.lastOk, error: md.error }, mdList.length, { service: md.service, list: md.list }),
        day1: src(outlooks[1].sourceInfo(), o[1].products.length, { outlook: o[1].status, validEnd: o[1].validEnd }),
        day2: src(outlooks[2].sourceInfo(), o[2].products.length, { outlook: o[2].status, validEnd: o[2].validEnd }),
      },
      model,
    };
  }

  let started = null;
  function start() {
    if (started) return started;
    started = Promise.allSettled([refreshAlerts(), refreshMD(), refreshOutlooks()]);
    setInterval(() => { if (!document.hidden) { refreshAlerts(); refreshMD(); } }, 60e3);
    setInterval(() => { if (!document.hidden) refreshOutlooks(); }, 10 * 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshAlerts(); refreshMD(); } });
    return started;
  }
  let modelStarted = null;
  function startModel() { if (!modelStarted) { modelStarted = refreshModel(); setInterval(refreshModel, 10 * 60e3); } return modelStarted; }

  window.ThreatsLive = { start, startModel, snapshot, onUpdate: (f) => listeners.push(f), diag, _stores: { alerts, outlooks, md, model } };
})();
