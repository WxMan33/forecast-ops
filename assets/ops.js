/* Forecast Ops — shared shell, location, data and math helpers.
   Plain browser JavaScript, no build step. Every page loads this file first. */
(function () {
  "use strict";

  /* ======================= EDIT ME ======================= */
  const BRAND = {
    name: "FORECAST OPS",          // shown in the tab title and footer
    owner: "WxMan33",              // shown in the footer
    contact: "",                   // optional, e.g. "mailto:you@example.com"
  };
  /* Quick-pick locations. Add or remove freely: [name, lat, lon]. */
  const PRESETS = [
    ["TQL Stadium, Cincinnati, OH", 39.11113, -84.52229],
    ["Dayton, OH", 39.7589, -84.1916],
    ["Columbus, OH", 39.9612, -82.9988],
    ["Indianapolis, IN", 39.7684, -86.1581],
    ["Louisville, KY", 38.2527, -85.7585],
    ["Lexington, KY", 38.0406, -84.5037],
  ];
  /* ======================================================= */

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- icons (lucide-style strokes, same family as the app) ---------- */
  const ICON = {
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
    tornado: '<path d="M21 4H3"/><path d="M18 8H6"/><path d="M19 12H9"/><path d="M16 16h-6"/><path d="M11 20H9"/>',
    snow: '<path d="M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2M4 9l2 3-2 3M20 9l-2 3 2 3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    crosshair: '<circle cx="12" cy="12" r="9"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  };
  const icon = (name, size = 15) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    const b = $("themeBtn");
    if (b) b.innerHTML = t === "dark" ? `${icon("sun", 13)} LIGHT` : `${icon("moon", 13)} DARK`;
    window.dispatchEvent(new CustomEvent("ops:theme"));
  }
  const theme = () => document.documentElement.getAttribute("data-theme") || "dark";
  document.documentElement.setAttribute("data-theme", store.get("ops_theme", "dark"));

  /* ---------- status tiers (fixed colors, same as the app) ---------- */
  const TIER = {
    nodata: { rank: -1, word: "NO DATA", color: "var(--nodata)" },
    normal: { rank: 0, word: "NORMAL", color: "var(--normal)" },
    monitor: { rank: 1, word: "MONITOR", color: "var(--monitor)" },
    prepare: { rank: 2, word: "PREPARE", color: "var(--prepare)" },
    action: { rank: 3, word: "ACT", color: "var(--action)" },
  };
  const maxTier = (list) => list.reduce((a, b) => (TIER[b].rank > TIER[a].rank ? b : a), "nodata");

  /* ---------- shell ---------- */
  const PAGES = [
    { href: "index.html", id: "home", label: "OVERVIEW", icon: "grid" },
    { href: "blend.html", id: "blend", label: "MODEL BLEND", icon: "layers" },
    { href: "thunder.html", id: "thunder", label: "THUNDER", icon: "zap" },
    { href: "severe.html", id: "severe", label: "SEVERE", icon: "tornado" },
    { href: "winter.html", id: "winter", label: "WINTER", icon: "snow" },
  ];

  function shell(pageId, title) {
    document.title = `${title} · ${BRAND.name}`;
    const header = document.createElement("header");
    header.className = "statusbar";
    header.innerHTML = `
      <div class="site-id">${icon("pin", 18)}
        <div style="min-width:0"><div class="kicker">Forecast point</div><div class="site-name" id="siteName">—</div></div>
      </div>
      <div class="vsep"></div>
      <div class="headline" id="headline"><span class="hl-word" style="color:var(--muted)">${esc(title.toUpperCase())}</span></div>
      <div class="utility">
        <span class="chip" id="dataChip">IDLE</span>
        <button class="chip" id="themeBtn" type="button" style="cursor:pointer" aria-label="Toggle dark/light mode"></button>
      </div>`;
    const nav = document.createElement("nav");
    nav.className = "navbar";
    nav.setAttribute("aria-label", "Tools");
    nav.innerHTML = PAGES.map((p) =>
      `<a href="${p.href}"${p.id === pageId ? ' aria-current="page"' : ""}>${icon(p.icon)}${p.label}</a>`).join("");
    document.body.prepend(header, nav);

    const foot = document.createElement("footer");
    foot.className = "foot";
    foot.innerHTML = `${esc(BRAND.name)} · built by ${BRAND.contact ? `<a href="${esc(BRAND.contact)}">${esc(BRAND.owner)}</a>` : esc(BRAND.owner)} ·
      <a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (CC BY 4.0) ·
      Model guidance only. Not an official forecast or warning.`;
    document.body.append(foot);

    $("themeBtn").addEventListener("click", () => { const t = theme() === "dark" ? "light" : "dark"; store.set("ops_theme", t); applyTheme(t); });
    applyTheme(theme());
    showLocation();
  }

  function setChip(text, kind) {
    const c = $("dataChip"); if (!c) return;
    c.className = "chip" + (kind ? " " + kind : "");
    c.textContent = text;
  }

  /* Headline in the status bar: a tier word with its color, plus up to two big stats. */
  function headline({ tier, word, stats = [] }) {
    const h = $("headline"); if (!h) return;
    const t = TIER[tier] || null;
    h.className = "headline" + (t ? " tier" : "");
    h.style.setProperty("--tier", t ? t.color : "");
    h.innerHTML =
      `<div class="hl-label">${t ? '<span class="dot"></span>' : ""}<span class="hl-word">${esc(word || (t ? t.word : ""))}</span></div>` +
      stats.map((s) => `<div class="vsep" style="height:30px"></div><div class="hl-stat"${s.title ? ` title="${esc(s.title)}"` : ""}><span class="hl-num"${s.color ? ` style="color:${s.color}"` : ""}>${esc(s.num)}</span><span class="hl-unit">${esc(s.unit || "")}</span></div>`).join("");
  }

  /* ---------- location ---------- */
  const DEFAULT_LOC = { name: PRESETS[0][0], lat: PRESETS[0][1], lon: PRESETS[0][2] };
  let loc = store.get("ops_loc", DEFAULT_LOC);
  const locListeners = [];
  function showLocation() { const n = $("siteName"); if (n) { n.textContent = loc.name.toUpperCase(); n.title = `${loc.name} (${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)})`; } }
  function setLocation(next) {
    loc = { name: next.name, lat: +(+next.lat).toFixed(4), lon: +(+next.lon).toFixed(4) };
    store.set("ops_loc", loc);
    showLocation();
    locListeners.forEach((f) => f(loc));
  }

  /* Location card for the left column. onChange fires whenever the point changes. */
  function locationCard(container, onChange) {
    if (onChange) locListeners.push(onChange);
    container.innerHTML = `
      <div class="section-title">Location</div>
      <div class="stack">
        <div>
          <label class="field-label" for="locSearch">Search a place</label>
          <input class="input" id="locSearch" type="search" placeholder="City, town or ZIP" autocomplete="off">
          <div class="results" id="locResults"></div>
        </div>
        <div>
          <label class="field-label" for="locPreset">Quick pick</label>
          <select class="input" id="locPreset"><option value="">Choose…</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])}</option>`).join("")}</select>
        </div>
        <div class="row">
          <div><label class="field-label" for="locLat">Lat</label><input class="input mono" id="locLat" type="number" step="0.0001"></div>
          <div><label class="field-label" for="locLon">Lon</label><input class="input mono" id="locLon" type="number" step="0.0001"></div>
        </div>
        <div class="row">
          <button class="btn ghost sm icon" id="locGo" type="button">${icon("crosshair", 13)} USE LAT/LON</button>
          <button class="btn ghost sm icon" id="locMe" type="button">${icon("pin", 13)} MY LOCATION</button>
        </div>
        <p class="msg" id="locMsg"></p>
      </div>`;
    const fill = () => { $("locLat").value = loc.lat; $("locLon").value = loc.lon; };
    fill();
    locListeners.push(fill);
    $("locPreset").addEventListener("change", (e) => {
      const p = PRESETS[e.target.value]; if (!p) return;
      setLocation({ name: p[0], lat: p[1], lon: p[2] }); e.target.value = "";
    });
    $("locGo").addEventListener("click", () => {
      const lat = +$("locLat").value, lon = +$("locLon").value;
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { $("locMsg").textContent = "Enter a valid latitude and longitude."; return; }
      setLocation({ name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon });
    });
    $("locMe").addEventListener("click", () => {
      if (!navigator.geolocation) { $("locMsg").textContent = "This browser can't share its location."; return; }
      $("locMsg").textContent = "Asking the browser for your location…";
      navigator.geolocation.getCurrentPosition(
        (p) => { $("locMsg").textContent = ""; setLocation({ name: "My location", lat: p.coords.latitude, lon: p.coords.longitude }); },
        () => { $("locMsg").textContent = "Location permission was declined or unavailable."; },
        { timeout: 10000 });
    });
    let timer = null;
    $("locSearch").addEventListener("input", (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      if (q.length < 2) { $("locResults").innerHTML = ""; return; }
      timer = setTimeout(async () => {
        try {
          const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`, 0);
          const r = j.results || [];
          $("locResults").innerHTML = r.length ? r.map((x, i) =>
            `<button type="button" data-i="${i}">${esc(x.name)} <small>${esc([x.admin1, x.country_code].filter(Boolean).join(", "))}</small></button>`).join("")
            : '<p class="msg">No matches.</p>';
          $("locResults").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
            const x = r[b.dataset.i];
            setLocation({ name: [x.name, x.admin1 && x.country_code === "US" ? stateAbbr(x.admin1) : x.country_code].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude });
            $("locResults").innerHTML = ""; $("locSearch").value = "";
          }));
        } catch (err) { $("locResults").innerHTML = '<p class="msg err">Place search is unavailable right now.</p>'; }
      }, 300);
    });
  }
  const STATES = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC" };
  const stateAbbr = (s) => STATES[s] || s;

  /* ---------- fetching (with a short session cache so tab-hopping is instant) ---------- */
  async function getJSON(url, cacheMin = 15) {
    const key = "ops_c:" + url;
    if (cacheMin) {
      try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.at < cacheMin * 60e3) return c.json; } catch (e) { /* no cache */ }
    }
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    let res;
    try { res = await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(to); }
    const json = await res.json().catch(() => ({ error: true, reason: `HTTP ${res.status}` }));
    if (!res.ok && !json.error) { json.error = true; json.reason = `HTTP ${res.status}`; }
    if (cacheMin && !json.error) { try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), json })); } catch (e) { /* full */ } }
    return json;
  }

  /* One model, one request. If Open-Meteo rejects a variable for this model, drop it and retry,
     so one unsupported field never sinks the whole model. */
  async function fetchModel(base, params, model, hourly, daily) {
    let hv = hourly.slice(), dv = (daily || []).slice();
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = new URLSearchParams({ ...params, latitude: loc.lat, longitude: loc.lon, timezone: "auto", models: model });
      if (hv.length) p.set("hourly", hv.join(","));
      if (dv.length) p.set("daily", dv.join(","));
      const json = await getJSON(`${base}?${p.toString().replace(/%2C/g, ",")}`);
      if (!json.error) return json;
      const why = String(json.reason || "");
      /* A missing pressure level ("... 975hPa ...") takes out every variable on that level at once. */
      const levels = [...why.matchAll(/(\d{3,4})\s*hPa/gi)].map((m) => `_${m[1]}hPa`);
      const bad = [...hv, ...dv].filter((v) => why.includes(v) || levels.some((l) => v.endsWith(l)));
      if (!bad.length) throw new Error(why || "Request failed");
      hv = hv.filter((v) => !bad.includes(v)); dv = dv.filter((v) => !bad.includes(v));
    }
    throw new Error("Too many unsupported variables");
  }

  /* Pull named arrays out of a response, tolerating model-suffixed keys. */
  function pick(block, names) {
    const out = {};
    if (!block) return out;
    const keys = Object.keys(block);
    for (const n of names) {
      const k = keys.find((k) => k === n) || keys.find((k) => k.startsWith(n + "_") && !/_member\d+/.test(k));
      if (k) out[n] = block[k];
    }
    return out;
  }
  const hasData = (a) => Array.isArray(a) && a.some((x) => x != null);

  /* ---------- time ---------- */
  /* Times from Open-Meteo with timezone=auto are local wall-clock strings: "2026-11-02T14:00". */
  function nowLocalString(tz) {
    try {
      const o = {};
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date()).forEach((x) => (o[x.type] = x.value));
      return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
    } catch (e) { return new Date().toISOString().slice(0, 16); }
  }
  const nowIndex = (times, tz) => { const n = nowLocalString(tz); let idx = -1; times.forEach((t, i) => { if (t <= n) idx = i; }); return idx; };
  const hourOf = (t) => +t.slice(11, 13);
  const dayOf = (t) => t.slice(0, 10);
  const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const MO = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dayDate = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  const fmtDay = (k) => { const d = dayDate(k); return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`; };
  const fmtHour = (h) => (h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : h - 12 + "p");
  const fmtWhen = (t) => `${WD[dayDate(dayOf(t)).getDay()]} ${fmtHour(hourOf(t))}`;
  const tzShort = (tz) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value; } catch (e) { return tz || ""; } };

  /* ---------- math ---------- */
  /* Weighted mean/min/max across series at each index. series: [{w, data[]}] */
  function blendSeries(series, n) {
    const mean = [], min = [], max = [];
    for (let i = 0; i < n; i++) {
      let s = 0, w = 0, lo = Infinity, hi = -Infinity;
      for (const x of series) { const v = x.data[i]; if (v == null) continue; s += x.w * v; w += x.w; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      mean.push(w ? s / w : null); min.push(w ? lo : null); max.push(w ? hi : null);
    }
    return { mean, min, max };
  }
  const cumulative = (a) => { let t = 0; return a.map((x) => (t += x == null ? 0 : x)); };
  function weightedQuantile(vals, ws, q) {
    const idx = vals.map((v, i) => i).filter((i) => vals[i] != null).sort((a, b) => vals[a] - vals[b]);
    const tot = idx.reduce((s, i) => s + ws[i], 0); if (!tot) return null;
    let acc = 0;
    for (const i of idx) { acc += ws[i]; if (acc / tot >= q) return vals[i]; }
    return vals[idx[idx.length - 1]];
  }
  /* Align a model's series onto the master time axis by timestamp. */
  function align(masterTimes, times, arr) {
    if (!arr) return masterTimes.map(() => null);
    const at = new Map(times.map((t, i) => [t, i]));
    return masterTimes.map((t) => { const i = at.get(t); return i == null ? null : arr[i]; });
  }

  /* ---------- model colors: distinct from the status palette ---------- */
  const MODEL_COLORS = ["#60A5FA", "#F472B6", "#34D399", "#C084FC", "#FBBF24", "#22D3EE", "#FB7185", "#A3E635", "#F59E0B", "#818CF8", "#2DD4BF", "#E879F9"];
  const MODEL_COLORS_LIGHT = ["#2563EB", "#DB2777", "#059669", "#7C3AED", "#B45309", "#0891B2", "#E11D48", "#4D7C0F", "#C2410C", "#4F46E5", "#0F766E", "#A21CAF"];
  const modelColor = (i) => (theme() === "light" ? MODEL_COLORS_LIGHT : MODEL_COLORS)[i % MODEL_COLORS.length];

  /* Model checklist with weight sliders. models: [{id, name, w, on}] -> state persisted under key. */
  function modelPicker(container, key, models, onChange, opts = {}) {
    const saved = store.get(key, {});
    const st = {};
    models.forEach((m) => (st[m.id] = { on: saved[m.id] ? saved[m.id].on : m.on !== false, w: saved[m.id] ? saved[m.id].w : m.w }));
    const status = {};
    function draw() {
      container.innerHTML = models.map((m, i) => {
        const s = st[m.id], nod = status[m.id] === "none";
        return `<div class="model${s.on ? "" : " off"}${nod ? " nodata" : ""}" title="${nod ? "No data for this point" : esc(m.note || "")}">
          <input type="checkbox" id="mp_${key}_${m.id}" ${s.on ? "checked" : ""} ${nod ? "disabled" : ""}>
          <label for="mp_${key}_${m.id}"><span class="sw" style="background:${modelColor(i)}"></span>${esc(m.name)}${nod ? ' <span class="msg">· no data</span>' : ""}</label>
          <span class="w">×${s.w.toFixed(2)}</span>
          <input type="range" min="0" max="${opts.max || 3}" step="0.25" value="${s.w}" aria-label="${esc(m.name)} weight" ${nod ? "disabled" : ""}>
        </div>`;
      }).join("");
      container.querySelectorAll(".model").forEach((el, i) => {
        const id = models[i].id;
        el.querySelector("input[type=checkbox]").addEventListener("change", (e) => { st[id].on = e.target.checked; el.classList.toggle("off", !e.target.checked); save(); });
        el.querySelector("input[type=range]").addEventListener("input", (e) => { st[id].w = +e.target.value; el.querySelector(".w").textContent = "×" + st[id].w.toFixed(2); save(); });
      });
    }
    function save() { store.set(key, st); onChange && onChange(); }
    draw();
    return {
      on: (id) => st[id] && st[id].on && st[id].w > 0 && status[id] !== "none",
      w: (id) => (st[id] ? st[id].w : 0),
      setStatus(id, s) { status[id] = s; },
      redraw: draw,
      reset() { models.forEach((m) => (st[m.id] = { on: m.on !== false, w: m.w })); store.set(key, st); draw(); onChange && onChange(); },
    };
  }

  /* ---------- Chart.js helpers ---------- */
  function chartBase({ labels, hours, nowIdx, unit, dec = 0, yTitle, y2Title, beginAtZero, yMin, yMax }) {
    const muted = css("--muted"), line = css("--line"), mono = css("--font-mono");
    const nowLine = {
      id: "nowLine",
      afterDatasetsDraw(c) {
        if (nowIdx < 0 || nowIdx >= labels.length - 1) return;
        const x = c.scales.x.getPixelForValue(nowIdx), { top, bottom } = c.chartArea, g = c.ctx;
        g.save(); g.strokeStyle = css("--accent"); g.setLineDash([4, 4]); g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.setLineDash([]);
        g.fillStyle = css("--accent"); g.font = "800 10px " + mono; g.fillText("NOW", x + 4, top + 11); g.restore();
      },
    };
    const sfx = unit === "°F" ? "°" : unit === "in" ? '"' : unit === "%" ? "%" : unit ? " " + unit : "";
    const options = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--raised"), titleColor: css("--text"), bodyColor: css("--text"), borderColor: line, borderWidth: 1,
          titleFont: { family: mono }, bodyFont: { family: mono, size: 11 },
          filter: (it) => !it.dataset.hideTip,
          itemSort: (a, b) => (b.parsed.y ?? -1e9) - (a.parsed.y ?? -1e9),
          callbacks: { label: (it) => `${it.dataset.label}: ${it.parsed.y == null ? "—" : it.parsed.y.toFixed(it.dataset.dec ?? dec)}${it.dataset.sfx ?? sfx}` },
        },
      },
      scales: {
        x: {
          ticks: {
            color: muted, autoSkip: false, maxRotation: 0, font: { family: mono, size: 10 },
            callback(v, i) {
              const days = Math.max(1, Math.round(hours.length / 24)), every = Math.max(1, Math.ceil((days * 48) / (this.chart.width || 800)));
              if (hours[i] === 0) { const di = hours.slice(0, i).filter((h) => h === 0).length; return di % every === 0 ? labels[i].split(" ")[0] : ""; }
              return hours[i] === 12 && every === 1 && days <= 7 ? "12p" : "";
            },
          },
          grid: { color: (ctx) => (hours[ctx.index] === 0 ? line : "transparent"), drawTicks: false },
        },
        y: {
          ticks: { color: muted, font: { family: mono, size: 10.5 }, callback: (v) => (+v).toFixed(dec && Math.abs(v) < 10 ? dec : 0) + sfx },
          grid: { color: line }, beginAtZero: !!beginAtZero, min: yMin, max: yMax,
          title: { display: !!yTitle, text: yTitle, color: muted, font: { size: 11 } },
        },
      },
    };
    if (y2Title) options.scales.y2 = { position: "right", beginAtZero: true, grid: { display: false }, ticks: { color: muted, font: { family: mono, size: 10 } }, title: { display: true, text: y2Title, color: muted, font: { size: 11 } } };
    return { options, plugins: [nowLine] };
  }
  const hourLabels = (times) => times.map((t) => `${WD[dayDate(dayOf(t)).getDay()]} ${fmtHour(hourOf(t))}`);

  /* Day-grouped hourly status strip: one row per series of tiers. rows: [{name, color, tiers[]}] */
  function tierStrip(times, rows, step = 1) {
    const cols = []; for (let i = 0; i < times.length; i += step) cols.push(i);
    const tpl = `grid-template-columns:150px repeat(${cols.length},minmax(4px,1fr))`;
    const head = `<div class="strip-row" style="${tpl}"><div></div>${cols.map((i) => `<div class="strip-lab">${hourOf(times[i]) < step ? fmtDay(dayOf(times[i])).slice(0, 3) : ""}</div>`).join("")}</div>`;
    const body = rows.map((r) => `<div class="strip-row" style="${tpl}"><div class="field-label" style="margin:0;display:flex;gap:6px;align-items:center;${r.bold ? "color:var(--text)" : ""}"><span class="sw" style="background:${r.color}"></span>${esc(r.name)}</div>` +
      cols.map((i) => { let t = "nodata"; for (let k = i; k < Math.min(i + step, times.length); k++) if (r.tiers[k] && TIER[r.tiers[k]].rank > TIER[t].rank) t = r.tiers[k];
        return `<div class="strip-cell" style="background:${t === "nodata" ? "var(--raised)" : t === "normal" ? "color-mix(in srgb, var(--normal) 30%, transparent)" : TIER[t].color};${hourOf(times[i]) < step ? "box-shadow:inset 2px 0 0 var(--bg)" : ""}" title="${esc(r.name)} · ${fmtWhen(times[i])} · ${TIER[t].word}"></div>`; }).join("") + `</div>`).join("");
    return `<div class="tablewrap"><div class="strip">${head}${body}</div></div>`;
  }

  window.Ops = {
    BRAND, PRESETS, TIER, maxTier, $, esc, store, css, icon,
    shell, setChip, headline, locationCard, get location() { return loc; }, setLocation,
    getJSON, fetchModel, pick, hasData, align,
    nowIndex, hourOf, dayOf, fmtDay, fmtHour, fmtWhen, tzShort, hourLabels,
    blendSeries, cumulative, weightedQuantile, modelColor, modelPicker, chartBase, tierStrip,
  };
})();
