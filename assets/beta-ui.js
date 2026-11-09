/* Shared UI for the beta pages: header, time labels, data loading, alerts, timeline chart and map embed.
   Data loading requests exactly what Model Blend and the overview request (same specs, recipe and caches). */
(function (root) {
  "use strict";
  const O = root.Ops, C = O.Core, CFG = C.config, S = root.BetaStory, H = 3600e3;
  const esc = O.esc, fin = (x) => typeof x === "number" && Number.isFinite(x);
  const NAMES = Object.fromEntries([...CFG.blend.models, ...CFG.blend.extra, ...CFG.thunder.models].map((m) => [m.id, m.name.replace(/ \(\d+ members\)$/, "")]));

  /* ---------- time labels: always weekday + clock time + zone, with a relative hint ---------- */
  const fmt = {
    time(ms, tz) { return new Date(ms).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: new Date(ms).getUTCMinutes() ? "2-digit" : undefined }); },
    clock(ms, tz) { return new Date(ms).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: new Date(ms).getUTCMinutes() ? "2-digit" : undefined }); },
    day(ms, tz) { return new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }); },
    dayShort(ms, tz) { return new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }); },
    zone(ms, tz) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop(); },
    rel(ms, now = Date.now()) { const d = (ms - now) / H, a = Math.abs(d); const t = a < 1 ? `${Math.max(1, Math.round(a * 60))} min` : a < 36 ? `${Math.round(a)} h` : `${Math.round(a / 24)} days`; return d >= 0 ? `in ${t}` : `${t} ago`; },
    span(s, e, tz) { const sd = C.time.toLocal(s, tz).slice(0, 10), ed = C.time.toLocal(e - 1, tz).slice(0, 10); return sd === ed ? `${fmt.time(s, tz)} – ${fmt.clock(e, tz)}` : `${fmt.time(s, tz)} – ${fmt.time(e, tz)}`; },
    utc(ms) { const d = new Date(ms).toISOString(); return `${d.slice(11, 13)}Z ${d.slice(5, 10).replace("-", "/")}`; },
    age(h) { return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`; },
  };
  const deg = (x) => (fin(x) ? `${Math.round(x)}°` : "—");
  const inch = (x) => (fin(x) ? `${x < 0.005 ? "0" : x.toFixed(2)}″` : "—");
  const pct = S.formatPrecipPercent;
  const mph = (x) => (fin(x) ? `${Math.round(x)} mph` : "—");

  /* ---------- header ---------- */
  function header({ audience, other }) {
    const el = document.createElement("header"); el.className = "bx-head";
    el.innerHTML = `<div class="bx-head-in"><a class="bx-brand" href="${esc(other.self)}"><span class="bx-mark" aria-hidden="true">F</span><b>Forecast Ops</b><span class="bx-tag"><span class="bx-long">${esc(audience)} </span>beta</span></a>
      <span class="bx-head-sp"></span><span class="bx-upd" id="bxUpd"></span>
      <button class="bx-btn icon" type="button" id="bxRefresh" title="Reload guidance">↻<span class="sr-only">Reload guidance</span></button>
      <button class="bx-btn" type="button" id="bxTheme" title="Switch light or dark">Light</button>
      <a class="bx-btn" href="${esc(other.href)}">${esc(other.label)}<span class="bx-long"> →</span></a></div>`;
    document.body.prepend(el);
    const apply = (t) => { document.documentElement.setAttribute("data-theme", t); const b = O.$("bxTheme"); if (b) b.textContent = t === "dark" ? "Light" : "Dark"; window.dispatchEvent(new CustomEvent("ops:theme")); };
    apply(O.store.get("ops_theme", "dark"));
    O.$("bxTheme").addEventListener("click", () => { const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; O.store.set("ops_theme", t); apply(t); });
    return { setUpdated(ms) { O.$("bxUpd").textContent = ms ? `Guidance loaded ${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""; }, onRefresh(f) { O.$("bxRefresh").addEventListener("click", f); } };
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

  /* ---------- timeline chart (SVG): temperature with guidance range, precipitation, gusts, thunder ---------- */
  function timeline(host, hours, { tz, now = Date.now(), bands = [], gustLine = null, height = null } = {}) {
    host.classList.add("bx-chart");
    const draw = () => {
      const W = Math.max(280, host.clientWidth - 24), small = W < 560, Ht = height || (small ? 300 : 340);
      if (!hours.length) { host.innerHTML = '<p class="bx-note">No hourly guidance for this window.</p>'; return; }
      const t0 = hours[0].ms, t1 = hours[hours.length - 1].ms + H, L = 34, R = 10, top = 30;
      const x = (ms) => L + ((ms - t0) / (t1 - t0)) * (W - L - R);
      const lanes = { temp: [top, top + Ht * 0.42], pcp: [top + Ht * 0.48, top + Ht * 0.7], gust: [top + Ht * 0.76, top + Ht * 0.94] };
      const tv = hours.flatMap((h) => [h.temp, h.tempR && h.tempR[0], h.tempR && h.tempR[1]]).filter(fin);
      const tmin = Math.floor(Math.min(...tv) - 2), tmax = Math.ceil(Math.max(...tv) + 2), ty = (v) => lanes.temp[1] - ((v - tmin) / Math.max(1, tmax - tmin)) * (lanes.temp[1] - lanes.temp[0]);
      const qmax = Math.max(0.1, ...hours.map((h) => h.qpf || 0)), qy = (v) => lanes.pcp[1] - (v / qmax) * (lanes.pcp[1] - lanes.pcp[0]);
      const gmax = Math.max(40, ...hours.map((h) => h.gust || 0)), gy = (v) => lanes.gust[1] - (v / gmax) * (lanes.gust[1] - lanes.gust[0]);
      const bw = Math.max(1, (W - L - R) / hours.length - (hours.length > 60 ? 0.5 : 1.5));
      const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      let svg = "";
      bands.forEach((b) => { const a = x(Math.max(b.s, t0)), c = x(Math.min(b.e, t1)); if (c <= a) return; const fits = c - a >= b.label.length * 7.5 + 8;
        svg += `<rect x="${a}" y="${top - 4}" width="${c - a}" height="${Ht * 0.94 + 4}" fill="${b.fill || "var(--band)"}" rx="4"/>${fits ? `<text x="${a + 4}" y="${top + Ht * 0.94 - 6}" class="lane" style="fill:var(--text)">${esc(b.label)}</text>` : ""}`; });
      /* day boundaries and hour labels in local time */
      hours.forEach((h) => { const lw = C.time.toLocal(h.ms, tz), hr = +lw.slice(11, 13), px = x(h.ms);
        if (hr === 0 || h.ms === t0) { svg += `<line x1="${px}" x2="${px}" y1="${top - 22}" y2="${top + Ht * 0.94}" stroke="var(--line)" stroke-width="${hr === 0 ? 1.2 : 0}"/><text x="${px + 4}" y="${top - 10}" class="day">${esc(new Date(h.ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", day: "numeric" }).toUpperCase())}</text>`; }
        const step = small ? 12 : hours.length > 48 ? 6 : 3;
        if (hr % step === 0 && hr !== 0) svg += `<text x="${px}" y="${top + Ht * 0.94 + 16}" text-anchor="middle">${hr === 12 ? "Noon" : `${hr % 12 || 12} ${hr < 12 ? "AM" : "PM"}`}</text>`; });
      /* temperature: weighted guidance range (10th–90th percentile across sources) and blend */
      const band = hours.filter((h) => h.tempR && fin(h.tempR[0]) && fin(h.tempR[1]));
      if (band.length) svg += `<path d="M${band.map((h) => `${x(h.ms + H / 2)},${ty(h.tempR[1])}`).join("L")}L${band.slice().reverse().map((h) => `${x(h.ms + H / 2)},${ty(h.tempR[0])}`).join("L")}Z" fill="color-mix(in srgb, var(--warm) 22%, transparent)"/>`;
      const tl = hours.filter((h) => fin(h.temp));
      svg += `<path d="M${tl.map((h) => `${x(h.ms + H / 2)},${ty(h.temp)}`).join("L")}" fill="none" stroke="var(--warm)" stroke-width="2.6" stroke-linejoin="round"/>`;
      const hiH = tl.reduce((a, b) => (b.temp > a.temp ? b : a), tl[0]), loH = tl.reduce((a, b) => (b.temp < a.temp ? b : a), tl[0]);
      [[hiH, -8], [loH, 18]].forEach(([h, dy]) => { if (h) svg += `<text x="${x(h.ms + H / 2)}" y="${ty(h.temp) + dy}" text-anchor="middle" class="tval">${Math.round(h.temp)}°</text>`; });
      svg += `<text x="0" y="${lanes.temp[0] + 4}" class="lane">TEMP</text><text x="0" y="${lanes.temp[0] + 18}">${tmax}°</text><text x="0" y="${lanes.temp[1]}">${tmin}°</text>`;
      /* precipitation: hourly amount bars; chance as a faint background bar */
      hours.forEach((h) => { const px = x(h.ms);
        if (fin(h.pop) && h.pop > 0) svg += `<rect x="${px}" y="${lanes.pcp[1] - (h.pop / 100) * (lanes.pcp[1] - lanes.pcp[0])}" width="${bw}" height="${(h.pop / 100) * (lanes.pcp[1] - lanes.pcp[0])}" fill="color-mix(in srgb, var(--accent) 16%, transparent)"/>`;
        if (fin(h.qpf) && h.qpf >= 0.005) svg += `<rect x="${px}" y="${qy(h.qpf)}" width="${bw}" height="${lanes.pcp[1] - qy(h.qpf)}" fill="var(--accent)" rx="1"/>`;
        if (h.thunder && ["monitor", "prepare", "action"].includes(h.thunder)) svg += `<rect x="${px}" y="${lanes.pcp[0] - 7}" width="${bw}" height="5" fill="var(--${h.thunder})" rx="1"/>`; });
      svg += `<line x1="${L}" x2="${W - R}" y1="${lanes.pcp[1]}" y2="${lanes.pcp[1]}" stroke="var(--line)"/><text x="0" y="${lanes.pcp[0] + 4}" class="lane">RAIN</text><text x="0" y="${lanes.pcp[0] + 18}">${qmax.toFixed(2)}″</text>`;
      /* gusts */
      const gl = hours.filter((h) => fin(h.gust));
      if (gustLine) svg += `<line x1="${L}" x2="${W - R}" y1="${gy(gustLine)}" y2="${gy(gustLine)}" stroke="var(--prepare)" stroke-dasharray="4 4"/><text x="${W - R}" y="${gy(gustLine) - 4}" text-anchor="end" style="fill:var(--prepare)">${gustLine} mph</text>`;
      if (gl.length) svg += `<path d="M${gl.map((h) => `${x(h.ms + H / 2)},${gy(h.gust)}`).join("L")}" fill="none" stroke="var(--muted)" stroke-width="2"/>`;
      svg += `<line x1="${L}" x2="${W - R}" y1="${lanes.gust[1]}" y2="${lanes.gust[1]}" stroke="var(--line)"/><text x="0" y="${lanes.gust[0] + 4}" class="lane">GUST</text><text x="0" y="${lanes.gust[0] + 18}">${gmax}</text>`;
      if (now > t0 && now < t1) svg += `<line x1="${x(now)}" x2="${x(now)}" y1="${top - 22}" y2="${top + Ht * 0.94}" stroke="var(--accent)" stroke-width="2"/><text x="${x(now) + 4}" y="${top + Ht * 0.94 - 4}" style="fill:var(--accent);font-weight:800">NOW</text>`;
      host.innerHTML = `<svg viewBox="0 0 ${W} ${Ht + 52}" height="${Ht + 52}" role="img" aria-label="Hourly forecast chart">${svg}<line id="bxGuide" x1="-10" x2="-10" y1="${top - 22}" y2="${top + Ht * 0.94}" stroke="var(--text)" stroke-width="1" opacity=".6"/></svg>
        <div class="bx-legend"><span><i style="background:var(--warm)"></i>Blend temperature, shaded: range across guidance</span><span><i style="background:var(--accent)"></i>Hourly precipitation (faint: chance)</span><span><i style="background:var(--muted)"></i>Peak gust</span><span><i style="background:var(--monitor)"></i>Thunder signal</span></div><div class="bx-tip" hidden></div>`;
      const svgEl = host.querySelector("svg"), tip = host.querySelector(".bx-tip"), guide = host.querySelector("#bxGuide");
      const show = (cx) => { const r = svgEl.getBoundingClientRect(), vx = ((cx - r.left) / r.width) * W, ms = t0 + ((vx - L) / (W - L - R)) * (t1 - t0); const h = hours[Math.max(0, Math.min(hours.length - 1, Math.floor((ms - t0) / H)))]; if (!h) return;
        guide.setAttribute("x1", x(h.ms + H / 2)); guide.setAttribute("x2", x(h.ms + H / 2));
        tip.innerHTML = `<b>${esc(fmt.time(h.ms, tz))} ${esc(fmt.zone(h.ms, tz))}</b>${deg(h.temp)}${h.tempR && fin(h.tempR[0]) ? ` <span class="bx-note">(${Math.round(h.tempR[0])}–${Math.round(h.tempR[1])}°)</span>` : ""}<br>Precip ${inch(h.qpf)} · chance ${pct(h.pop)}<br>Gust ${mph(h.gust)}${h.thunder && h.thunder !== "normal" && h.thunder !== "nodata" ? `<br>Thunder signal: ${esc(C.TIERS[h.thunder].word.toLowerCase())}` : ""}`;
        tip.hidden = false; const px = (x(h.ms) / W) * r.width; tip.style.left = `${Math.min(r.width - 190, Math.max(0, px + 14))}px`; tip.style.top = "36px"; };
      svgEl.addEventListener("pointermove", (e) => show(e.clientX));
      svgEl.addEventListener("pointerdown", (e) => show(e.clientX));
      svgEl.addEventListener("pointerleave", () => { tip.hidden = true; guide.setAttribute("x1", -10); guide.setAttribute("x2", -10); });
    };
    draw();
    let t = null; const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(draw, 120); }); ro.observe(host);
    window.addEventListener("ops:theme", draw);
  }

  /* ---------- the existing HRRR map, embedded ---------- */
  function map(host, { view = "tristate", field = "refc", place = null } = {}) {
    const q = new URLSearchParams({ embed: "1", view, field }); if (place) { q.set("lat", place.lat); q.set("lon", place.lon); q.set("name", place.name); }
    const full = new URLSearchParams({ view, field }); if (place) { full.set("lat", place.lat); full.set("lon", place.lon); full.set("name", place.name); }
    host.innerHTML = `<div class="bx-map"><iframe title="HRRR regional model map" loading="lazy" src="maps.html?${q}"></iframe></div>`;
    return `maps.html?${full}`;
  }

  root.BetaUI = { NAMES, fmt, deg, inch, pct, mph, header, load, alerts, timeline, map, fin };
})(typeof globalThis !== "undefined" ? globalThis : this);
