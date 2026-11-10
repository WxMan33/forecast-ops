/* Shared UI for the beta pages. The organizing idea: one selected time (the time bus) drives the map and the
   timeline; the map toolbar and valid-time readout are shared by both betas (and meant for Lightning Ops).
   Data loading requests exactly what Model Blend and the overview request (same specs, recipe and caches). */
(function (root) {
  "use strict";
  const O = root.Ops, C = O.Core, CFG = C.config, S = root.BetaStory, H = 3600e3;
  const esc = O.esc, fin = (x) => typeof x === "number" && Number.isFinite(x);
  const NAMES = Object.fromEntries([...CFG.blend.models, ...CFG.blend.extra, ...CFG.thunder.models].map((m) => [m.id, m.name.replace(/ \(\d+ members\)$/, "")]));

  /* ---------- time: weekday + clock + zone, with a relative hint ---------- */
  const fmt = {
    time(ms, tz) { return new Date(ms).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: new Date(ms).getUTCMinutes() ? "2-digit" : undefined }); },
    clock(ms, tz) { return new Date(ms).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: new Date(ms).getUTCMinutes() ? "2-digit" : undefined }); },
    day(ms, tz) { return new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }); },
    zone(ms, tz) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop(); },
    rel(ms, now = Date.now()) { const d = (ms - now) / H, a = Math.abs(d); const t = a < 1 ? `${Math.max(1, Math.round(a * 60))} min` : a < 36 ? `${Math.round(a)} h` : `${Math.round(a / 24)} days`; return d >= 0 ? `in ${t}` : `${t} ago`; },
    span(s, e, tz) { const sd = C.time.toLocal(s, tz).slice(0, 10), ed = C.time.toLocal(e - 1, tz).slice(0, 10); return sd === ed ? `${fmt.time(s, tz)} – ${fmt.clock(e, tz)}` : `${fmt.time(s, tz)} – ${fmt.time(e, tz)}`; },
    utc(ms) { const d = new Date(ms).toISOString(); return `${d.slice(11, 13)}Z ${d.slice(5, 10).replace("-", "/")}`; },
    age(h) { return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`; },
  };
  /* the one valid-time treatment used everywhere: Wed 8 PM EST · in 2 days */
  const vt = (ms, tz, now = Date.now()) => (fin(ms) ? `<span class="bx-vt"><b>${esc(fmt.time(ms, tz))}</b><i>${esc(fmt.zone(ms, tz))}</i><em>${esc(fmt.rel(ms, now))}</em></span>` : "—");
  const st = (tier, text, extra = "") => `<span class="bx-st${tier ? "" : " quiet"}" style="--tier:var(--${tier || "nodata"})"${extra}>${esc(text)}</span>`;
  const deg = (x) => (fin(x) ? `${Math.round(x)}°` : "—");
  const inch = (x) => (fin(x) ? `${x < 0.005 ? "0" : x.toFixed(2)}″` : "—");
  const pct = S.formatPrecipPercent;
  const mph = (x) => (fin(x) ? `${Math.round(x)} mph` : "—");

  /* ---------- the selected time: one value, many views ---------- */
  function timeBus(initial = null) {
    let ms = initial, src = null; const fns = [];
    return { get: () => ms, source: () => src, set(v, from) { if (!fin(v) || v === ms) return; ms = v; src = from || null; fns.forEach((f) => f(ms, src)); }, on(f) { fns.push(f); } };
  }

  /* ---------- header: brand, page context, theme ---------- */
  function header({ audience, other, ctx = "" }) {
    const el = document.createElement("header"); el.className = "bx-head";
    el.innerHTML = `<div class="bx-head-in"><a class="bx-brand" href="${esc(other.self)}"><span class="bx-mark" aria-hidden="true">F</span><b>Forecast Ops</b><span class="tag">${esc(audience)} beta</span></a>
      <div class="bx-ctx" id="bxCtx">${ctx}</div><span class="bx-upd" id="bxUpd"></span>
      <button class="bx-btn" type="button" id="bxRefresh" title="Reload guidance" aria-label="Reload guidance">↻</button>
      <button class="bx-btn" type="button" id="bxTheme" aria-label="Switch light or dark">Light</button>
      <a class="bx-btn" href="${esc(other.href)}">${esc(other.label)}</a></div>`;
    document.body.prepend(el);
    const apply = (t) => { document.documentElement.setAttribute("data-theme", t); O.$("bxTheme").textContent = t === "dark" ? "Light" : "Dark"; window.dispatchEvent(new CustomEvent("ops:theme")); };
    apply(O.store.get("ops_theme", "dark"));
    O.$("bxTheme").addEventListener("click", () => { const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; O.store.set("ops_theme", t); apply(t); });
    return { setUpdated(ms) { O.$("bxUpd").textContent = ms ? `Loaded ${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""; }, onRefresh(f) { O.$("bxRefresh").addEventListener("click", f); } };
  }

  /* ---------- data: the same requests and recipe as Model Blend / overview ---------- */
  async function load(where, { days = 7, thunder = true } = {}) {
    const RB = O.blendRecipe();
    const [B, NW, BE, TH, META] = await Promise.all([
      O.Data.loadModels(CFG.blend, { ...where, days }),
      O.Data.loadNWS(where),
      O.Data.loadEnsemble(CFG.blendEns, { ...where, days }).catch(() => ({ empty: true })),
      thunder ? O.Data.loadModels(CFG.thunder, { ...where, days: Math.max(3, O.savedDays(CFG.thunder)) }).catch(() => ({ empty: true })) : Promise.resolve(null),
      O.Data.loadModelMeta(CFG.metaIds).catch(() => ({})),
    ]);
    if (B.empty) return { empty: true, problems: B.problems || [] };
    C.blend.addSources(B, BE, NW && NW.ok ? C.nws.onAxis(NW, B.ms) : null);
    B.viewedAt = Date.now();
    const ws = {}; Object.keys(RB.ws).forEach((id) => { if (B.models[id] && RB.ws[id] > 0) ws[id] = RB.ws[id]; });
    const ctx = S.context({ C, T: root.ModelTrends, B, ws, rules: RB.rules, TH, thWs: O.savedWeights(CFG.thunder), meta: META, nws: NW, now: Date.now() });
    const problems = [...(B.problems || []), ...(NW && !NW.ok ? [`NWS: ${NW.reason}`] : [])];
    return { ctx, RB, NW, problems, recipe: C.blend.PRESETS[RB.preset] ? C.blend.PRESETS[RB.preset].label : RB.preset };
  }
  async function alerts(where) {
    try {
      const r = await fetch(`https://api.weather.gov/alerts/active?point=${(+where.lat).toFixed(4)},${(+where.lon).toFixed(4)}`, { headers: { Accept: "application/geo+json" } });
      if (!r.ok) return [];
      const j = await r.json(); return (j.features || []).map((f) => ({ event: f.properties.event, headline: f.properties.headline, ends: f.properties.ends || f.properties.expires, url: f.properties["@id"] }));
    } catch (e) { return []; }
  }

  /* ---------- timeline chart (SVG), driven by and driving the selected time ---------- */
  function timeline(host, hours, { tz, now = Date.now(), bands = [], gustLine = null, height = null, bus = null, mark = null } = {}) {
    host.classList.add("bx-chart");
    let sel = null;
    const draw = () => {
      const W = Math.max(260, host.clientWidth), small = W < 520, Ht = height || (small ? 230 : 250);
      if (!hours.length) { host.innerHTML = '<p class="bx-note">No hourly guidance for this window.</p>'; return; }
      const t0 = hours[0].ms, t1 = hours[hours.length - 1].ms + H, L = 30, R = 6, top = 22;
      const x = (ms) => L + ((ms - t0) / (t1 - t0)) * (W - L - R);
      const lanes = { temp: [top, top + Ht * 0.44], pcp: [top + Ht * 0.52, top + Ht * 0.74], gust: [top + Ht * 0.8, top + Ht * 0.96] };
      const tv = hours.flatMap((h) => [h.temp, h.tempR && h.tempR[0], h.tempR && h.tempR[1]]).filter(fin);
      const tmin = Math.floor(Math.min(...tv) - 2), tmax = Math.ceil(Math.max(...tv) + 2), ty = (v) => lanes.temp[1] - ((v - tmin) / Math.max(1, tmax - tmin)) * (lanes.temp[1] - lanes.temp[0]);
      const qmax = Math.max(0.1, ...hours.map((h) => h.qpf || 0)), qy = (v) => lanes.pcp[1] - (v / qmax) * (lanes.pcp[1] - lanes.pcp[0]);
      const gmax = Math.max(40, ...hours.map((h) => h.gust || 0)), gy = (v) => lanes.gust[1] - (v / gmax) * (lanes.gust[1] - lanes.gust[0]);
      const bw = Math.max(1, (W - L - R) / hours.length - (hours.length > 60 ? 0.4 : 1.2)), bottom = top + Ht * 0.96;
      let svg = "";
      bands.forEach((b) => { const a = x(Math.max(b.s, t0)), c = x(Math.min(b.e, t1)); if (c <= a) return; const fits = c - a >= b.label.length * 7 + 8;
        svg += `<rect x="${a}" y="${top - 2}" width="${c - a}" height="${bottom - top + 2}" fill="${b.fill || "var(--band)"}"/>${fits ? `<text x="${a + 4}" y="${bottom - 4}" class="lane">${esc(b.label)}</text>` : ""}`; });
      if (mark && mark.s != null) { const a = x(Math.max(mark.s, t0)), c = x(Math.min(mark.e, t1)); if (c > a) svg += `<rect x="${a}" y="${lanes.pcp[0] - 2}" width="${c - a}" height="${lanes.pcp[1] - lanes.pcp[0] + 2}" fill="color-mix(in srgb, var(--${mark.tier}) 18%, transparent)"/>`; }
      hours.forEach((h) => { const lw = C.time.toLocal(h.ms, tz), hr = +lw.slice(11, 13), px = x(h.ms);
        if (hr === 0 || h.ms === t0) svg += `<line x1="${px}" x2="${px}" y1="${top - 14}" y2="${bottom}" stroke="var(--line)" stroke-width="${hr === 0 ? 1 : 0}"/><text x="${px + 4}" y="${top - 6}" class="day">${esc(new Date(h.ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", day: "numeric" }))}</text>`;
        const step = small ? 12 : hours.length > 48 ? 6 : 3;
        if (hr % step === 0 && hr !== 0) svg += `<text x="${px}" y="${bottom + 14}" text-anchor="middle">${hr === 12 ? "Noon" : `${hr % 12 || 12} ${hr < 12 ? "AM" : "PM"}`}</text>`; });
      const band = hours.filter((h) => h.tempR && fin(h.tempR[0]) && fin(h.tempR[1]));
      if (band.length) svg += `<path d="M${band.map((h) => `${x(h.ms + H / 2)},${ty(h.tempR[1])}`).join("L")}L${band.slice().reverse().map((h) => `${x(h.ms + H / 2)},${ty(h.tempR[0])}`).join("L")}Z" fill="color-mix(in srgb, var(--warm) 20%, transparent)"/>`;
      const tl = hours.filter((h) => fin(h.temp));
      svg += `<path d="M${tl.map((h) => `${x(h.ms + H / 2)},${ty(h.temp)}`).join("L")}" fill="none" stroke="var(--warm)" stroke-width="2.2" stroke-linejoin="round"/>`;
      const hiH = tl.reduce((a, b) => (b.temp > a.temp ? b : a), tl[0]), loH = tl.reduce((a, b) => (b.temp < a.temp ? b : a), tl[0]);
      [[hiH, -7], [loH, 15]].forEach(([h, dy]) => { if (h) svg += `<text x="${x(h.ms + H / 2)}" y="${ty(h.temp) + dy}" text-anchor="middle" class="tval">${Math.round(h.temp)}°</text>`; });
      svg += `<text x="0" y="${lanes.temp[0] + 4}" class="lane">TEMP</text><text x="0" y="${lanes.temp[1]}">${tmin}°</text>`;
      hours.forEach((h) => { const px = x(h.ms);
        if (fin(h.pop) && h.pop > 0) svg += `<rect x="${px}" y="${lanes.pcp[1] - (h.pop / 100) * (lanes.pcp[1] - lanes.pcp[0])}" width="${bw}" height="${(h.pop / 100) * (lanes.pcp[1] - lanes.pcp[0])}" fill="color-mix(in srgb, var(--accent) 14%, transparent)"/>`;
        if (fin(h.qpf) && h.qpf >= 0.005) svg += `<rect x="${px}" y="${qy(h.qpf)}" width="${bw}" height="${lanes.pcp[1] - qy(h.qpf)}" fill="var(--accent)"/>`;
        if (h.thunder && ["monitor", "prepare", "action"].includes(h.thunder)) svg += `<rect x="${px}" y="${lanes.pcp[0] - 6}" width="${bw}" height="4" fill="var(--${h.thunder})"/>`; });
      svg += `<line x1="${L}" x2="${W - R}" y1="${lanes.pcp[1]}" y2="${lanes.pcp[1]}" stroke="var(--line)"/><text x="0" y="${lanes.pcp[0] + 4}" class="lane">RAIN</text><text x="0" y="${lanes.pcp[0] + 16}">${qmax.toFixed(2)}″</text>`;
      const gl = hours.filter((h) => fin(h.gust));
      if (gustLine) svg += `<line x1="${L}" x2="${W - R}" y1="${gy(gustLine)}" y2="${gy(gustLine)}" stroke="var(--muted)" stroke-dasharray="3 4"/><text x="${W - R}" y="${gy(gustLine) - 3}" text-anchor="end">${gustLine} mph limit</text>`;
      if (gl.length) svg += `<path d="M${gl.map((h) => `${x(h.ms + H / 2)},${gy(h.gust)}`).join("L")}" fill="none" stroke="var(--muted)" stroke-width="1.6"/>`;
      svg += `<line x1="${L}" x2="${W - R}" y1="${lanes.gust[1]}" y2="${lanes.gust[1]}" stroke="var(--line)"/><text x="0" y="${lanes.gust[0] + 4}" class="lane">GUST</text>`;
      if (now > t0 && now < t1) svg += `<line x1="${x(now)}" x2="${x(now)}" y1="${top - 14}" y2="${bottom}" stroke="var(--muted)" stroke-dasharray="2 3"/><text x="${x(now) + 3}" y="${bottom - 3}" class="lane">NOW</text>`;
      host.innerHTML = `<svg viewBox="0 0 ${W} ${Ht + 40}" height="${Ht + 40}" role="img" aria-label="Hourly forecast chart; tap to select a time">${svg}<g id="bxSel" opacity="0"><line y1="${top - 14}" y2="${bottom}" stroke="var(--accent)" stroke-width="2"/><rect y="${top - 16}" width="8" height="8" rx="2" fill="var(--accent)"/></g></svg>
        <div class="bx-key"><span><i style="background:var(--warm)"></i>Blend temperature (shaded: guidance range)</span><span><i style="background:var(--accent)"></i>Hourly precipitation (faint: chance)</span><span><i style="background:var(--muted)"></i>Gust</span><span><i style="background:var(--monitor)"></i>Thunder signal</span></div><div class="bx-tip" hidden></div>`;
      const svgEl = host.querySelector("svg"), tip = host.querySelector(".bx-tip"), g = host.querySelector("#bxSel");
      const hourAt = (cx) => { const r = svgEl.getBoundingClientRect(), vx = ((cx - r.left) / r.width) * W, ms = t0 + ((vx - L) / (W - L - R)) * (t1 - t0); return hours[Math.max(0, Math.min(hours.length - 1, Math.floor((ms - t0) / H)))]; };
      const place = (ms) => { host.dataset.selected = fin(ms) ? ms : ""; if (!fin(ms) || ms < t0 || ms > t1) { g.setAttribute("opacity", "0"); return; } const px = x(ms); g.setAttribute("opacity", "1"); g.querySelector("line").setAttribute("x1", px); g.querySelector("line").setAttribute("x2", px); g.querySelector("rect").setAttribute("x", px - 4); };
      const show = (cx) => { const h = hourAt(cx); if (!h) return; const r = svgEl.getBoundingClientRect();
        tip.innerHTML = `<b>${esc(fmt.time(h.ms, tz))} ${esc(fmt.zone(h.ms, tz))}</b>${deg(h.temp)}${h.tempR && fin(h.tempR[0]) ? ` <span class="bx-note">(${Math.round(h.tempR[0])}–${Math.round(h.tempR[1])}°)</span>` : ""}<br>Precip ${inch(h.qpf)} · chance ${pct(h.pop)}<br>Gust ${mph(h.gust)}${h.thunder && !["normal", "nodata"].includes(h.thunder) ? `<br>Thunder signal: ${esc(C.TIERS[h.thunder].word.toLowerCase())}` : ""}`;
        tip.hidden = false; const px = (x(h.ms) / W) * r.width; tip.style.left = `${Math.min(r.width - 180, Math.max(0, px + 12))}px`; tip.style.top = "26px"; };
      svgEl.addEventListener("pointermove", (e) => show(e.clientX));
      svgEl.addEventListener("pointerleave", () => { tip.hidden = true; });
      svgEl.addEventListener("click", (e) => { const h = hourAt(e.clientX); if (h && bus) bus.set(h.ms, "timeline"); });
      place(sel);
      host._place = place;
    };
    draw();
    if (bus) bus.on((ms) => { sel = ms; if (host._place) host._place(ms); });
    sel = bus ? bus.get() : null; if (host._place) host._place(sel);
    let t = null; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(draw, 120); }).observe(host);
    window.addEventListener("ops:theme", draw);
  }

  /* ---------- the HRRR map with the shared toolbar (layer, run, step/play, valid time) ---------- */
  const MAP_FIELDS = ["refc", "refd1km", "precip", "t2m", "d2m", "gust", "w10m", "cloud"];
  function mapPanel(host, { view = "tristate", field = "refc", place = null, bus, tz = "America/New_York", now = Date.now(), want = null, autoRun = false } = {}) {
    const q = new URLSearchParams({ embed: "1", view, field }); if (place) { q.set("lat", place.lat); q.set("lon", place.lon); q.set("name", place.name); }
    const full = new URLSearchParams({ view, field }); if (place) { full.set("lat", place.lat); full.set("lon", place.lon); full.set("name", place.name); }
    host.classList.add("bx-mapwrap");
    host.innerHTML = `<div class="bx-mappanel"><div class="bx-maptool" role="toolbar" aria-label="Map controls">
        <label class="sr-only" for="mpField">Layer</label><select class="bx-sel" id="mpField" disabled><option>Loading map…</option></select>
        <label class="sr-only" for="mpRun">Model run</label><select class="bx-sel" id="mpRun" disabled></select>
        <span class="grp"><button type="button" id="mpBack" aria-label="Previous hour" disabled>‹</button><button type="button" id="mpPlay" aria-pressed="false" disabled>Play</button><button type="button" id="mpNext" aria-label="Next hour" disabled>›</button></span>
        <span class="vt" id="mpVt" aria-live="polite"></span><a class="bx-btn" href="maps.html?${full}" title="Open the full map page">Full map ↗</a></div>
      <div class="bx-mapnote" id="mpNote" hidden></div>
      <div class="bx-mapframe"><iframe title="HRRR regional model map" src="maps.html?${q}"></iframe><div class="bx-mapflag" id="mpFlag" hidden></div></div></div>`;
    const $ = (id) => host.querySelector("#" + id), frame = host.querySelector("iframe");
    let M = null, last = null, wanted = want;
    const runLabel = (r) => `HRRR ${String(new Date(r.cycle).getUTCHours()).padStart(2, "0")}Z · ${r.hours} h`;
    const render = (s) => {
      last = s; if (!s || !s.runs.length) return;
      const fsel = $("mpField"), rsel = $("mpRun");
      const fl = MAP_FIELDS.map((k) => s.fields.find((f) => f.key === k)).filter((f) => f && f.ok);
      if (fsel.dataset.sig !== fl.map((f) => f.key).join()) { fsel.innerHTML = fl.map((f) => `<option value="${f.key}">${esc(f.label)}</option>`).join(""); fsel.dataset.sig = fl.map((f) => f.key).join(); }
      fsel.value = s.field; if (rsel.options.length !== s.runs.length) rsel.innerHTML = s.runs.map((r) => `<option value="${esc(r.id)}">${esc(runLabel(r))}</option>`).join(""); rsel.value = s.run || "";
      [fsel, rsel, $("mpBack"), $("mpPlay"), $("mpNext")].forEach((b) => { b.disabled = !s.ready && !s.playing; });
      $("mpPlay").textContent = s.playing ? "Pause" : "Play"; $("mpPlay").setAttribute("aria-pressed", String(s.playing));
      host.dataset.mapValid = s.validMs || ""; host.dataset.ready = String(!!s.ready);
      $("mpVt").innerHTML = s.validMs ? `${vt(s.validMs, tz, now)} <span class="run">· F${String(s.fh).padStart(2, "0")} of ${esc(runLabel(s.runs.find((r) => r.id === s.run) || s.runs[0]))}</span>` : "";
      /* the map leads only while playing (or before anything is selected); otherwise it follows the selected time */
      if (s.ready && s.validMs && bus) { if (s.playing || bus.get() == null) bus.set(s.validMs, "map"); else if (M) M.setTime(bus.get()); }
      rangeNote();
    };
    /* when the selected time is outside this run's hours, say so on and beside the map; never let another hour
       pass for the selected time. With autoRun, first switch to the newest published run that reaches it. */
    const covering = (s, ms) => s.runs.filter((r) => r.cycle <= ms + 30 * 60e3 && r.cycle + r.hours * H >= ms - 30 * 60e3).sort((a, b) => b.cycle - a.cycle)[0] || null;
    let switched = null;
    const rangeNote = () => { const s = last, n = $("mpNote"), flag = $("mpFlag"); if (!s || !s.valid.length || !bus || bus.get() == null) { n.hidden = true; flag.hidden = true; host.dataset.range = ""; return; }
      const ms = bus.get(), a = s.valid[0], b = s.valid[s.valid.length - 1], cur = s.runs.find((r) => r.id === s.run);
      const out = ms > b + 30 * 60e3 ? "beyond" : ms < a - 30 * 60e3 ? "before" : "in";
      const endOf = (r) => r.cycle + r.hours * H, furthest = s.runs.slice().sort((x, y) => endOf(y) - endOf(x) || y.cycle - x.cycle)[0];
      if (out !== "in" && autoRun && M && s.ready) {
        /* the newest run that reaches the selected time; failing that, the run that reaches furthest toward it */
        const r = covering(s, ms) || (out === "beyond" ? furthest : null);
        if (r && r.id !== s.run && switched !== r.id + ms) { switched = r.id + ms; M.setRun(r.id); n.hidden = false; n.innerHTML = `Switching to ${esc(runLabel(r))}, the HRRR run that ${covering(s, ms) ? "reaches" : "gets closest to"} ${esc(fmt.time(ms, tz))}…`; return; } }
      host.dataset.range = out;
      const later = furthest && cur && endOf(furthest) > endOf(cur) + 30 * 60e3 ? furthest : null;
      if (out === "beyond") { n.hidden = false; n.innerHTML = later
          ? `<b>This run ends ${esc(fmt.time(b, tz))} ${esc(fmt.zone(b, tz))}.</b> The selected time, ${esc(fmt.time(ms, tz))}, is beyond it, so the map is frozen on its last hour. ${esc(runLabel(later))} reaches ${esc(fmt.time(endOf(later), tz))}.`
          : `<b>HRRR coverage ends ${esc(fmt.time(b, tz))} ${esc(fmt.zone(b, tz))}.</b> The selected time, ${esc(fmt.time(ms, tz))}, is beyond every published run, so the map is frozen on its last hour. Use the timeline and briefing for that time.`; }
      else if (out === "before") { n.hidden = false; n.innerHTML = `<b>This run starts ${esc(fmt.time(a, tz))} ${esc(fmt.zone(a, tz))}.</b> The map shows its first hour, not ${esc(fmt.time(ms, tz))}.`; }
      else if (switched && cur && switched.startsWith(cur.id)) { n.hidden = false; n.innerHTML = `Showing ${esc(runLabel(cur))}, the newest run that reaches ${esc(fmt.time(ms, tz))}.`; }
      else n.hidden = true;
      flag.hidden = out === "in"; flag.innerHTML = out === "in" ? "" : `${out === "beyond" ? "Last HRRR hour" : "First HRRR hour"} · ${esc(fmt.time(out === "beyond" ? b : a, tz))}<span>not the selected time</span>`;
      $("mpVt").classList.toggle("oor", out !== "in"); };
    const attach = () => { const w = frame.contentWindow; if (!w || !w.MapEmbed) return false; M = w.MapEmbed; M.on(render);
      if (wanted != null && bus) bus.set(wanted, "page"); wanted = null; if (bus && bus.get() != null) M.setTime(bus.get()); return true; };
    const poll = setInterval(() => { if (attach()) clearInterval(poll); }, 300); setTimeout(() => clearInterval(poll), 60000);
    $("mpField").addEventListener("change", (e) => M && M.setField(e.target.value));
    $("mpRun").addEventListener("change", (e) => M && M.setRun(e.target.value));
    /* stepping moves the selected time; the map (and the chart) follow it, so nothing can snap back */
    const stepBy = (d) => { if (!M) return; M.stop(); const s0 = M.state(); if (!s0.valid.length) return; const n = s0.valid.length, k = (s0.h + d + n) % n;
      if (bus) bus.set(s0.valid[k], "step"); else M.step(d); };
    $("mpBack").addEventListener("click", () => stepBy(-1));
    $("mpNext").addEventListener("click", () => stepBy(1));
    $("mpPlay").addEventListener("click", () => { if (!M) return; if (M.state().playing) M.stop(); else M.play(); });
    if (bus) bus.on((ms, src) => { if (M && src !== "map") { const r = M.setTime(ms); if (r && r.validMs && r.inRange === false) rangeNote(); } rangeNote(); });
    return { want(ms) { if (M && bus) bus.set(ms, "page"); else wanted = ms; } };
  }

  root.BetaUI = { NAMES, fmt, vt, st, deg, inch, pct, mph, fin, timeBus, header, load, alerts, timeline, mapPanel };
})(typeof globalThis !== "undefined" ? globalThis : this);
