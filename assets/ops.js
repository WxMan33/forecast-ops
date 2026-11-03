/* Forecast Ops — shared page shell: header, nav, location, alerts, fetching and UI helpers.
   Forecast math lives in ops-core.js (window.OpsCore), which every page loads first. */
(function () {
  "use strict";
  const Core = window.OpsCore, Data = window.OpsData;

  /* ======================= EDIT ME ======================= */
  const BRAND = {
    name: "FORECAST OPS",          // shown in the tab title and footer
    owner: "WxMan33",              // shown in the footer
    contact: "",                   // optional, e.g. "mailto:you@example.com"
  };
  /* Built-in quick picks: [name, lat, lon]. Locations you save with ★ are added on top of these. */
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
    crosshair: '<circle cx="12" cy="12" r="9"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2 1.2-6.8-5-4.9 6.9-1Z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    print: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
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

  /* ---------- signal tiers: fixed Heads-Up colors, guidance wording ---------- */
  const COLOR = { nodata: "var(--nodata)", normal: "var(--normal)", monitor: "var(--monitor)", prepare: "var(--prepare)", action: "var(--action)" };
  const TIER = {};
  Object.keys(Core.TIERS).forEach((k) => (TIER[k] = { ...Core.TIERS[k], color: COLOR[k] }));
  const maxTier = Core.maxTier;
  /* Signal badge. a: tier key or an assessment {tier, limited, missing}. Limited data adds a hatched tag. */
  const badge = (a, text) => {
    const t = typeof a === "string" ? a : a.tier, lim = typeof a === "object" && a.limited && t !== "nodata";
    return `<span class="badge" style="--b:${TIER[t].color}">${esc(text || TIER[t].word)}</span>` +
      (lim ? ` <span class="ltd" title="Limited data${a.missing && a.missing.length ? ": missing " + esc(a.missing.join(", ")) : ""}">LTD</span>` : "");
  };

  /* ---------- shell ---------- */
  const PAGES = [
    { href: "index.html", id: "home", label: "OVERVIEW", icon: "grid" },
    { href: "blend.html", id: "blend", label: "MODEL BLEND", icon: "layers" },
    { href: "thunder.html", id: "thunder", label: "THUNDER", icon: "zap" },
    { href: "severe.html", id: "severe", label: "SEVERE", icon: "tornado" },
    { href: "winter.html", id: "winter", label: "WINTER", icon: "snow" },
    { href: "almanac.html", id: "almanac", label: "ALMANAC", icon: "sun" },
  ];

  /* opts: { subtitle, forecastPoint (default true): show the forecast point and its NWS alerts } */
  const SUBTITLES = { home: "Next three days at a glance", blend: "Weighted guidance from models, ensembles and NWS", thunder: "Hour-by-hour thunder signal", severe: "Severe-weather environment by hour", winter: "Snow odds, precipitation type and profiles", almanac: "Sun, moon and Cincinnati daily climate" };
  function shell(pageId, title, opts = {}) {
    const fp = opts.forecastPoint !== false, sub = opts.subtitle || SUBTITLES[pageId] || "";
    document.title = `${title} · ${BRAND.name}`;
    const header = document.createElement("header");
    header.className = "statusbar";
    header.innerHTML = `
      ${fp ? `<div class="site-id">${icon("pin", 18)}
        <div style="min-width:0"><div class="kicker">Forecast point</div><div class="site-name" id="siteName">—</div><div class="site-sub" id="siteSub"></div></div>
      </div>
      <div class="vsep"></div>` : ""}
      <div class="headline" id="headline"><div><span class="hl-word" style="color:var(--muted)">${esc(title.toUpperCase())}</span>${sub ? `<div class="page-sub">${esc(sub)}</div>` : ""}</div></div>
      <div class="utility">
        <span class="chip" id="dataChip">IDLE</span>
        <button class="chip noprint" id="printBtn" type="button" style="cursor:pointer" aria-label="Print or save as PDF">${icon("print", 13)}</button>
        <button class="chip noprint" id="themeBtn" type="button" style="cursor:pointer" aria-label="Toggle dark/light mode"></button>
      </div>`;
    const nav = document.createElement("nav");
    nav.className = "navbar";
    nav.setAttribute("aria-label", "Tools");
    nav.innerHTML = PAGES.map((p) =>
      `<a href="${p.href}"${p.id === pageId ? ' aria-current="page"' : ""}>${icon(p.icon)}${p.label}</a>`).join("");
    const alerts = document.createElement("div");
    alerts.id = "alerts";
    alerts.className = "alerts";
    alerts.hidden = true;
    document.body.prepend(header, nav, alerts);

    const foot = document.createElement("footer");
    foot.className = "foot";
    foot.innerHTML = `${esc(BRAND.name)} · built by ${BRAND.contact ? `<a href="${esc(BRAND.contact)}">${esc(BRAND.owner)}</a>` : esc(BRAND.owner)} ·
      <a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (CC BY 4.0) ·
      alerts from <a href="https://www.weather.gov/" target="_blank" rel="noopener">NWS</a> ·
      Model guidance only. Not an official forecast or warning. NWS is one weighted source in MODEL BLEND; elsewhere NWS values are labelled NWS and shown alongside. ·
      <a href="verify.html">CVG verification</a> · <a href="#" id="verifyExport">export forecast &amp; observation logs</a>`;
    document.body.append(foot);

    $("themeBtn").addEventListener("click", () => { const t = theme() === "dark" ? "light" : "dark"; store.set("ops_theme", t); applyTheme(t); });
    $("printBtn").addEventListener("click", () => window.print());
    $("verifyExport").addEventListener("click", (e) => { e.preventDefault(); exportVerify(); });
    applyTheme(theme());
    if (fp) { showLocation(); loadAlerts(); locListeners.push(() => loadAlerts()); }
    /* event slots on every page: editor under Location, results at the top of the main column */
    const side = document.querySelector(".side"), main = document.querySelector(".main");
    /* the event slot stays hidden until a page actually uses it (eventCard), so no empty panel shows */
    if (side) { const c = document.createElement("section"); c.className = "card tight"; c.id = "evCard"; c.hidden = true; const lc = $("locCard"); lc && lc.nextSibling ? side.insertBefore(c, lc.nextSibling) : side.appendChild(c); }
    if (main) { const c = document.createElement("section"); c.className = "card"; c.id = "eventCard"; c.hidden = true; main.prepend(c); }
  }

  /* Data chip: what loaded, and whether anything is missing. */
  function setChip(text, kind, title) {
    const c = $("dataChip"); if (!c) return;
    c.className = "chip" + (kind ? " " + kind : "");
    c.textContent = text;
    if (title) c.title = title; else c.removeAttribute("title");
  }
  /* Standard chip after a fetch: "GUIDANCE · 2:15P" or "PARTIAL · 2:15P" with the reasons on hover. */
  function dataStatus(problems) {
    const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(" ", "").toUpperCase();
    if (problems.length) setChip(`PARTIAL DATA · ${t}`, "warn", problems.join("\n"));
    else setChip(`GUIDANCE LOADED · ${t}`, "live", "All requested models returned data.");
  }

  /* Headline in the status bar: a tier word with its color, an optional note, plus big stats. */
  function headline({ tier, word, note, stats = [] }) {
    const h = $("headline"); if (!h) return;
    const t = TIER[tier] || null;
    h.className = "headline" + (t ? " tier" : "");
    h.style.setProperty("--tier", t ? t.color : "");
    h.innerHTML =
      `<div class="hl-label">${t ? '<span class="dot"></span>' : ""}<div><span class="hl-word">${esc(word || (t ? t.word : ""))}</span>${note ? `<div class="hl-note">${esc(note)}</div>` : ""}</div></div>` +
      stats.map((s) => `<div class="vsep" style="height:30px"></div><div class="hl-stat"${s.title ? ` title="${esc(s.title)}"` : ""}><span class="hl-num"${s.color ? ` style="color:${s.color}"` : ""}>${esc(s.num)}</span><span class="hl-unit">${esc(s.unit || "")}</span></div>`).join("");
  }

  /* ---------- location (URL first, so a shared link opens the same point) ---------- */
  const DEFAULT_LOC = { name: PRESETS[0][0], lat: PRESETS[0][1], lon: PRESETS[0][2] };
  function fromUrl() {
    try {
      const q = new URLSearchParams(location.search), lat = parseFloat(q.get("lat")), lon = parseFloat(q.get("lon"));
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { name: q.get("name") || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon };
    } catch (e) { /* ignore */ }
    return null;
  }
  let loc = fromUrl() || store.get("ops_loc", DEFAULT_LOC);
  store.set("ops_loc", loc);
  const locListeners = [];
  const shareUrl = (page) => { const u = new URL(page || location.href, location.href); u.search = new URLSearchParams({ lat: loc.lat, lon: loc.lon, name: loc.name }).toString(); return u.toString(); };
  function showLocation() {
    const n = $("siteName"); if (!n) return;
    const parts = loc.name.split(", "), head = parts[0], rest = parts.slice(1).join(", ");
    n.textContent = head.toUpperCase();
    $("siteSub").textContent = rest || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`;
    n.parentElement.title = `${loc.name} (${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)})`;
    try { history.replaceState(null, "", shareUrl()); } catch (e) { /* file:// may refuse */ }
  }
  function setLocation(next) {
    loc = { name: next.name, lat: +(+next.lat).toFixed(4), lon: +(+next.lon).toFixed(4) };
    store.set("ops_loc", loc);
    showLocation();
    locListeners.forEach((f) => f(loc));
  }
  const saved = () => store.get("ops_saved", []);
  const isSaved = () => saved().some((s) => s.lat === loc.lat && s.lon === loc.lon);

  /* Location card. onChange fires whenever the point changes. */
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
          <select class="input" id="locPreset"></select>
        </div>
        <div class="row">
          <button class="btn ghost sm icon" id="locSave" type="button"></button>
          <button class="btn ghost sm icon" id="locShare" type="button">${icon("link", 13)} COPY LINK</button>
        </div>
        <details class="fold-inline">
          <summary>Coordinates &amp; GPS</summary>
          <div class="stack" style="margin-top:8px">
            <div class="row">
              <div><label class="field-label" for="locLat">Lat</label><input class="input mono" id="locLat" type="number" step="0.0001"></div>
              <div><label class="field-label" for="locLon">Lon</label><input class="input mono" id="locLon" type="number" step="0.0001"></div>
            </div>
            <div class="row">
              <button class="btn ghost sm icon" id="locGo" type="button">${icon("crosshair", 13)} USE LAT/LON</button>
              <button class="btn ghost sm icon" id="locMe" type="button">${icon("pin", 13)} MY LOCATION</button>
            </div>
          </div>
        </details>
        <p class="msg" id="locMsg"></p>
      </div>`;
    const fill = () => {
      $("locLat").value = loc.lat; $("locLon").value = loc.lon;
      const sv = saved();
      $("locPreset").innerHTML = `<option value="">Choose…</option>` +
        (sv.length ? `<optgroup label="Saved">${sv.map((p, i) => `<option value="s${i}">${esc(p.name)}</option>`).join("")}</optgroup>` : "") +
        `<optgroup label="Built in">${PRESETS.map((p, i) => `<option value="p${i}">${esc(p[0])}</option>`).join("")}</optgroup>`;
      $("locSave").innerHTML = isSaved() ? `${icon("star", 13)} SAVED · REMOVE` : `${icon("star", 13)} SAVE`;
    };
    fill();
    locListeners.push(fill);
    $("locPreset").addEventListener("change", (e) => {
      const v = e.target.value; if (!v) return;
      const p = v[0] === "s" ? saved()[+v.slice(1)] : (() => { const x = PRESETS[+v.slice(1)]; return { name: x[0], lat: x[1], lon: x[2] }; })();
      if (p) setLocation(p);
    });
    $("locSave").addEventListener("click", () => {
      const sv = saved();
      if (isSaved()) store.set("ops_saved", sv.filter((s) => !(s.lat === loc.lat && s.lon === loc.lon)));
      else {
        const name = prompt("Name this location", loc.name);
        if (name === null) return;
        sv.unshift({ name: name.trim() || loc.name, lat: loc.lat, lon: loc.lon });
        store.set("ops_saved", sv.slice(0, 30));
        if (name.trim() && name.trim() !== loc.name) { setLocation({ ...loc, name: name.trim() }); return; }
      }
      fill();
    });
    $("locShare").addEventListener("click", async () => {
      const url = shareUrl();
      try { await navigator.clipboard.writeText(url); $("locMsg").textContent = "Link copied. It opens this page at this location."; }
      catch (e) { $("locMsg").innerHTML = `Copy this link: <span class="mono" style="word-break:break-all">${esc(url)}</span>`; }
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

  /* ---------- NWS alerts for the point (US only; quietly absent elsewhere) ---------- */
  async function loadAlerts() {
    const box = $("alerts"); if (!box) return;
    try {
      const j = await getJSON(`https://api.weather.gov/alerts/active?point=${loc.lat},${loc.lon}`, 5);
      const f = (j.features || []).map((x) => x.properties).filter(Boolean);
      if (!f.length) { box.hidden = true; box.innerHTML = ""; return; }
      const rank = (p) => (/Warning/.test(p.event) ? 3 : /Watch/.test(p.event) ? 2 : /Advisory/.test(p.event) ? 1 : 0);
      f.sort((a, b) => rank(b) - rank(a));
      const col = (p) => ["var(--muted)", "var(--monitor)", "var(--prepare)", "var(--action)"][rank(p)];
      const until = (p) => { const e = p.ends || p.expires; if (!e) return ""; const d = new Date(e); return ` until ${d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`; };
      box.innerHTML = `<div class="alerts-inner">${icon("alert", 15)}<span class="kicker" style="color:var(--text)">NWS ACTIVE</span>` +
        f.map((p, i) => `<button type="button" class="alert-pill" data-i="${i}" style="--a:${col(p)}">${esc(p.event)}<span class="msg">${esc(until(p))}</span></button>`).join("") +
        `</div><div class="alert-detail" id="alertDetail" hidden></div>`;
      box.hidden = false;
      box.querySelectorAll(".alert-pill").forEach((b) => b.addEventListener("click", () => {
        const p = f[b.dataset.i], d = $("alertDetail"), same = d.dataset.i === b.dataset.i && !d.hidden;
        d.hidden = same; d.dataset.i = b.dataset.i;
        d.innerHTML = `<b>${esc(p.headline || p.event)}</b><p>${esc((p.description || "").slice(0, 1200))}</p>${p.instruction ? `<p><b>Instructions:</b> ${esc(p.instruction.slice(0, 600))}</p>` : ""}<p class="msg">${esc(p.senderName || "")} · <a href="https://alerts.weather.gov/" target="_blank" rel="noopener">alerts.weather.gov</a></p>`;
      }));
    } catch (e) { box.hidden = true; }
  }

  /* ---------- fetching: shared loader in ops-data.js ---------- */
  const getJSON = Data.getJSON;
  const hasData = Core.stats.hasData;

  /* The weights a tool page is using, read from its saved picker state (or the defaults).
     The overview uses this so its numbers match each tool exactly. */
  function savedWeights(spec) {
    const st = store.get(`ops_${spec.id}_models`, {}), w = {};
    spec.models.forEach((m) => { const x = st[m.id]; const on = x ? x.on : m.on !== false, wt = x ? x.w : m.w; if (on && wt > 0) w[m.id] = wt; });
    return w;
  }
  /* The blend recipe exactly as MODEL BLEND uses it: chosen preset, its weights over every source
     (models, ensembles, NWS) and its per-variable rules. Shared so the overview matches the tool page. */
  function blendRecipe() {
    const spec = Core.config.blend, preset = Core.blend.PRESETS[store.get("ops_blend_preset", "preferred")] ? store.get("ops_blend_preset", "preferred") : "preferred";
    const custom = savedWeights({ id: spec.id, models: [...spec.extra, ...spec.models] });
    return { preset, ws: Core.blend.presetWeights(preset, spec, custom), rules: Core.blend.presetRules(preset) };
  }
  const savedDays = (spec) => store.get(`ops_${spec.id}_days`, spec.days);

  /* ---------- time ---------- */
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
  /* Labels from true local times. A repeated fall-back hour gets its zone abbreviation ("1a EDT", "1a EST"). */
  const hourLabels = (times, ms, tz) => {
    const seen = {}; times.forEach((t) => (seen[t] = (seen[t] || 0) + 1));
    return times.map((t, i) => `${WD[dayDate(dayOf(t)).getDay()]} ${fmtHour(hourOf(t))}${seen[t] > 1 && ms && tz ? " " + Core.time.abbr(ms[i], tz) : ""}`);
  };
  /* Index of the current hour on a loaded axis, from real instants. */
  const nowIdx = (d) => { const now = Date.now(), m = (d && d.ms) || []; let idx = -1; m.forEach((x, i) => { if (x <= now) idx = i; }); return idx; };
  const dayGroups = Core.time.dayGroups;

  /* ---------- model colors: distinct from the status palette ---------- */
  const MODEL_COLORS = ["#60A5FA", "#F472B6", "#34D399", "#C084FC", "#FBBF24", "#22D3EE", "#FB7185", "#A3E635", "#F59E0B", "#818CF8", "#2DD4BF", "#E879F9"];
  const MODEL_COLORS_LIGHT = ["#2563EB", "#DB2777", "#059669", "#7C3AED", "#B45309", "#0891B2", "#E11D48", "#4D7C0F", "#C2410C", "#4F46E5", "#0F766E", "#A21CAF"];
  const modelColor = (i) => (theme() === "light" ? MODEL_COLORS_LIGHT : MODEL_COLORS)[i % MODEL_COLORS.length];

  /* Model checklist with weight sliders, folded away by default. */
  function modelPicker(container, key, models, onChange, opts = {}) {
    const savedW = store.get(key, {});
    const st = {};
    models.forEach((m) => (st[m.id] = { on: savedW[m.id] ? savedW[m.id].on : m.on !== false, w: savedW[m.id] ? savedW[m.id].w : m.w }));
    const status = {};
    container.innerHTML = `<details class="fold" id="fold_${key}"${store.get("ops_fold_" + key, false) ? " open" : ""}>
      <summary><span class="section-title" style="margin:0">${esc(opts.title || "Models & weights")}</span><span class="msg" id="sum_${key}"></span></summary>
      <div class="models" id="list_${key}" style="margin-top:10px"></div>
      <div class="row" style="margin-top:10px"><button class="btn ghost sm" type="button" id="reset_${key}">RESET WEIGHTS</button></div></details>`;
    $(`fold_${key}`).addEventListener("toggle", (e) => store.set("ops_fold_" + key, e.target.open));
    const list = $(`list_${key}`);
    function summary() {
      const on = models.filter((m) => st[m.id].on && st[m.id].w > 0 && status[m.id] !== "none").length;
      const nod = models.filter((m) => status[m.id] === "none").length;
      $(`sum_${key}`).textContent = `${on} in use${nod ? ` · ${nod} no data` : ""}`;
    }
    function draw() {
      list.innerHTML = models.map((m, i) => {
        const s = st[m.id], nod = status[m.id] === "none";
        return `<div class="model${s.on ? "" : " off"}${nod ? " nodata" : ""}" title="${nod ? "No data for this point" : esc(m.note || "")}">
          <input type="checkbox" id="mp_${key}_${m.id}" ${s.on ? "checked" : ""} ${nod ? "disabled" : ""}>
          <label for="mp_${key}_${m.id}"><span class="sw" style="background:${modelColor(i)}"></span>${esc(m.name)}${nod ? ' <span class="msg">· no data</span>' : ""}</label>
          <span class="w">×${s.w.toFixed(2)}</span>
          <input type="range" min="0" max="${opts.max || 3}" step="0.25" value="${s.w}" aria-label="${esc(m.name)} weight" ${nod ? "disabled" : ""}>
        </div>`;
      }).join("");
      list.querySelectorAll(".model").forEach((el, i) => {
        const id = models[i].id;
        el.querySelector("input[type=checkbox]").addEventListener("change", (e) => { st[id].on = e.target.checked; el.classList.toggle("off", !e.target.checked); save(); });
        el.querySelector("input[type=range]").addEventListener("input", (e) => { st[id].w = +e.target.value; el.querySelector(".w").textContent = "×" + st[id].w.toFixed(2); save(); });
      });
      summary();
    }
    function save() { store.set(key, st); summary(); onChange && onChange(); }
    draw();
    $(`reset_${key}`).addEventListener("click", () => { models.forEach((m) => (st[m.id] = { on: m.on !== false, w: m.w })); store.set(key, st); draw(); onChange && onChange(); });
    return {
      /* {id: weight} for models in use that returned data */
      weights() { const w = {}; models.forEach((m) => { if (st[m.id].on && st[m.id].w > 0 && status[m.id] !== "none") w[m.id] = st[m.id].w; }); return w; },
      on: (id) => st[id] && st[id].on && st[id].w > 0 && status[id] !== "none",
      w: (id) => (st[id] ? st[id].w : 0),
      setStatus(id, s) { status[id] = s; },
      redraw: draw,
    };
  }

  /* Show/hide individual model lines on charts (the blend and spread always show). */
  function linesToggle(el, key, onChange) {
    let on = store.get(key, true);
    const draw = () => { el.innerHTML = `<button type="button" class="tab" aria-pressed="${on}">${on ? "MODEL LINES: ON" : "MODEL LINES: OFF"}</button>`; el.firstChild.addEventListener("click", () => { on = !on; store.set(key, on); draw(); onChange(); }); };
    draw();
    return () => on;
  }

  /* ---------- Chart.js helpers ---------- */
  function chartBase({ labels, hours, nowIdx, unit, dec = 0, yTitle, y2Title, beginAtZero, yMin, yMax, selIdx, bands = [] }) {
    const muted = css("--muted"), line = css("--line"), mono = css("--font-mono");
    const marks = {
      id: "marks",
      afterDatasetsDraw(c) {
        const { top, bottom } = c.chartArea, g = c.ctx;
        const vline = (i, color, dash, text) => {
          if (i == null || i < 0 || i > labels.length - 1) return;
          const x = c.scales.x.getPixelForValue(i);
          g.save(); g.strokeStyle = color; g.setLineDash(dash); g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.setLineDash([]);
          if (text) { g.fillStyle = color; g.font = "800 10px " + mono; g.fillText(text, x + 4, top + 11); }
          g.restore();
        };
        /* event phases: shaded spans with their names along the top */
        bands.forEach((b, k) => {
          const x0 = c.scales.x.getPixelForValue(Math.max(0, b.i0)) - 2, x1 = c.scales.x.getPixelForValue(Math.min(labels.length - 1, b.i1)) + 2;
          if (x1 < c.chartArea.left || x0 > c.chartArea.right) return;
          g.save(); g.fillStyle = k % 2 ? "rgba(253,230,138,.10)" : "rgba(253,230,138,.17)"; g.fillRect(x0, top, x1 - x0, bottom - top);
          g.font = "800 9.5px " + mono; const lab = b.label.toUpperCase();
          if (g.measureText(lab).width + 6 <= x1 - x0) { g.fillStyle = css("--muted"); g.fillText(lab, x0 + 3, bottom - 4); } g.restore();
        });
        vline(nowIdx, css("--accent"), [4, 4], "NOW");
        if (selIdx != null && selIdx !== nowIdx) vline(selIdx, css("--text"), [2, 3], "");
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
          titleFont: { family: mono }, bodyFont: { family: mono, size: 11.5 },
          filter: (it) => !it.dataset.hideTip,
          itemSort: (a, b) => (b.parsed.y ?? -1e9) - (a.parsed.y ?? -1e9),
          callbacks: { label: (it) => `${it.dataset.label}: ${it.parsed.y == null ? "—" : it.parsed.y.toFixed(it.dataset.dec ?? dec)}${it.dataset.sfx ?? sfx}` },
        },
      },
      scales: {
        x: {
          ticks: {
            color: muted, autoSkip: false, maxRotation: 0, font: { family: mono, size: 11 },
            callback(v, i) {
              const days = Math.max(1, Math.round(hours.length / 24)), every = Math.max(1, Math.ceil((days * 48) / (this.chart.width || 800)));
              if (hours[i] === 0) { const di = hours.slice(0, i).filter((h) => h === 0).length; return di % every === 0 ? labels[i].split(" ")[0] : ""; }
              return hours[i] === 12 && every === 1 && days <= 7 ? "12p" : "";
            },
          },
          grid: { color: (ctx) => (hours[ctx.index] === 0 ? line : "transparent"), drawTicks: false },
        },
        y: {
          /* precision keeps tick steps at the displayed resolution, so a flat 0-1 axis never repeats "1, 1, 1" */
          ticks: { color: muted, font: { family: mono, size: 11 }, precision: dec, callback: (v) => (+v).toFixed(dec && Math.abs(v) < 10 ? dec : 0) + sfx },
          grid: { color: line }, beginAtZero: !!beginAtZero, min: yMin, max: yMax,
          title: { display: !!yTitle, text: yTitle, color: muted, font: { size: 11.5 } },
        },
      },
    };
    if (y2Title) options.scales.y2 = { position: "right", beginAtZero: true, grid: { display: false }, ticks: { color: muted, font: { family: mono, size: 10.5 } }, title: { display: true, text: y2Title, color: muted, font: { size: 11.5 } } };
    return { options, plugins: [marks] };
  }
  /* Individual model line: faded so the blend stays dominant. */
  const modelLine = (label, data, color, extra = {}) => ({ label, data, borderColor: color + "B3", borderWidth: 1.25, pointRadius: 0, tension: 0.25, spanGaps: true, order: 3, ...extra });

  /* ---------- hourly tier strip: labelled, with NOW and a selectable hour ---------- */
  function tierStrip(el, times, rows, { nowIdx = -1, sel = null, onPick, bands = [] } = {}) {
    const n = times.length;
    const tpl = `grid-template-columns:140px repeat(${n},minmax(5px,1fr))`;
    const dayRow = `<div class="strip-row" style="${tpl}"><div></div>${times.map((t, i) => `<div class="strip-lab day">${hourOf(t) === 0 || i === 0 ? fmtDay(dayOf(t)).slice(0, 3) : ""}</div>`).join("")}</div>`;
    const hrRow = `<div class="strip-row" style="${tpl}"><div></div>${times.map((t, i) => `<div class="strip-lab${i === nowIdx ? " now" : ""}">${i === nowIdx ? "NOW" : hourOf(t) % 6 === 0 && hourOf(t) !== 0 ? fmtHour(hourOf(t)) : ""}</div>`).join("")}</div>`;
    const body = rows.map((r) => `<div class="strip-row" style="${tpl}"><div class="strip-name${r.bold ? " bold" : ""}"><span class="sw" style="background:${r.color}"></span>${esc(r.name)}</div>` +
      times.map((t, i) => { const a = r.tiers[i] || { tier: "nodata" }, tr = typeof a === "string" ? a : a.tier, lim = typeof a === "object" && a.limited && tr !== "nodata";
        const base = tr === "nodata" ? "var(--raised)" : tr === "normal" ? "color-mix(in srgb, var(--normal) 30%, transparent)" : TIER[tr].color;
        const bg = lim ? `repeating-linear-gradient(45deg, var(--bg) 0 1.5px, transparent 1.5px 5px), ${base}` : base;
        return `<div class="strip-cell${hourOf(t) === 0 ? " d0" : ""}${i === nowIdx ? " now" : ""}${i === sel ? " sel" : ""}" data-i="${i}" style="background:${bg}" title="${esc(r.name)} · ${fmtWhen(t)} · ${TIER[tr].word}${lim ? ` · limited data (missing ${esc(a.missing.join(", "))})` : ""}"></div>`; }).join("") + `</div>`).join("");
    const ph = times.map((_, i) => { const b = bands.find((x) => i >= x.i0 && i <= x.i1); return b ? b.label : ""; });
    const evRow = bands.length ? `<div class="strip-row" style="${tpl}"><div class="strip-name bold" style="color:var(--ev)">EVENT</div>${times.map((_, i) => `<div class="strip-ev${ph[i] ? " on" : ""}" title="${esc(ph[i])}">${ph[i] && ph[i] !== ph[i - 1] ? esc(ph[i].toUpperCase()) : ""}</div>`).join("")}</div>` : "";
    el.innerHTML = `<div class="tablewrap strip-scroll" tabindex="0" aria-label="Hourly signal. Click an hour, or use the arrow keys, for details."><div class="strip">${dayRow}${hrRow}${evRow}${body}</div></div>`;
    const sc = el.firstChild;
    if (onPick) {
      sc.addEventListener("click", (e) => { const c = e.target.closest("[data-i]"); if (c) onPick(+c.dataset.i); });
      sc.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault(); onPick(Math.min(n - 1, Math.max(0, (sel == null ? Math.max(0, nowIdx) : sel) + (e.key === "ArrowRight" ? 1 : -1))));
      });
    }
    /* keep the selected (or current) hour in view */
    const target = sc.querySelector(".strip-cell.sel") || sc.querySelector(".strip-cell.now");
    if (target && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, target.offsetLeft - sc.clientWidth / 3);
  }

  /* ---------- "since your last check" ----------
     Keeps two snapshots per page+location: the latest and the one before it. A new load only
     pushes the old one back once it's at least 30 minutes old, so refreshing doesn't wipe out
     the comparison. snap: {cfg, rows: {key: {label, win, contrib[], ...fields}}} */
  function trackChanges(page, snap) {
    const k = `ops_snap2_${page}_${loc.lat},${loc.lon}`, s = store.get(k, {}), now = Date.now();
    if (s.cur && now - s.cur.at >= 30 * 60e3) s.prev = s.cur;
    s.cur = { at: now, ...snap };
    store.set(k, s);
    return { prev: s.prev || null, cur: s.cur };
  }
  /* spec: [{k, label, fmt(v), min (numeric threshold), tier: true}] */
  function renderChanges(el, pair, spec, names = {}) {
    if (!el) return;
    if (!pair || !pair.prev) { el.hidden = true; return; }
    const res = Core.changes.diff(pair.prev, pair.cur, spec), nm = (id) => names[id] || id;
    const when = new Date(pair.prev.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    const notes = [];
    if (res.cfgChanged) notes.push("Your model selection or weights changed since then, so some differences come from that.");
    res.contribChanged.forEach((c) => notes.push(`${c.label}: ${[c.added.length ? "now includes " + c.added.map(nm).join(", ") : "", c.removed.length ? "no longer includes " + c.removed.map(nm).join(", ") : ""].filter(Boolean).join("; ")}.`));
    if (res.skipped.length) notes.push(`Not compared because the valid window differs: ${res.skipped.join(", ")}.`);
    const line = (it) => `<span class="change ${it.up ? "up" : "down"}">${it.up ? "▲" : "▼"} ${esc(`${it.label} · ${it.field} ${it.from} → ${it.to}`)}</span>`;
    el.hidden = false;
    el.innerHTML = `<div class="section-title">Since your last check <span class="msg" style="text-transform:none;letter-spacing:0">(${esc(when)} · same valid windows only)</span></div>` +
      (res.items.length ? `<div class="changes">${res.items.slice(0, 16).map(line).join("")}</div>` : `<p class="msg">${res.affected.length ? "No forecast changes on rows with the same settings and models." : "No meaningful changes."}</p>`) +
      (res.affected.length ? `<div class="affected"><div class="kicker" style="margin:10px 0 6px">Recipe changed: settings or contributing models differ, so these are not forecast changes</div><div class="changes">${res.affected.slice(0, 12).map(line).join("")}</div></div>` : "") +
      (notes.length ? `<ul class="change-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "");
  }

  /* ======================= events ======================= */
  const EV = Core.event;
  const evListeners = [];
  const events = () => store.get("ops_events", []);
  const activeEvent = () => { const id = store.get("ops_event_active", null); return events().find((e) => e.id === id) || null; };
  function setActiveEvent(id, moveLocation = true) {
    store.set("ops_event_active", id);
    const ev = activeEvent();
    if (ev && moveLocation && (Math.abs(ev.loc.lat - loc.lat) > 0.005 || Math.abs(ev.loc.lon - loc.lon) > 0.005)) setLocation(ev.loc); // reloads the page's data
    evListeners.forEach((f) => f(ev));
  }
  const onEvent = (f) => evListeners.push(f);
  /* "SAT NOV 7 6:30p" from a local wall-clock string */
  const fmtLocal = (l, withDay = true) => { const h = +l.slice(11, 13), m = l.slice(14, 16); const t = `${h % 12 === 0 ? 12 : h % 12}${m !== "00" ? ":" + m : ""}${h < 12 ? "a" : "p"}`; return withDay ? `${fmtDay(l.slice(0, 10))} ${t}` : t; };
  const fmtSpan = (w) => `${fmtLocal(w.startLocal)} – ${fmtLocal(w.endLocal, w.endLocal.slice(0, 10) !== w.startLocal.slice(0, 10))}`;
  const zoneAbbr = (ms, tz) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName").value; } catch (e) { return tz; } };

  /* The location's IANA time zone, from Open-Meteo (cached for a day). */
  async function zoneFor(lat, lon) {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1&timezone=auto`, 1440);
    if (j.error || !j.timezone) throw new Error("Couldn't look up the time zone.");
    return j.timezone;
  }

  /* Event card: pick, create, edit, delete. Saved events keep their ID across edits. */
  function eventCard(container) {
    if (!container) return;
    container.hidden = false;
    let editing = null;
    const draw = () => {
      const list = events(), ev = activeEvent();
      if (editing) { drawEditor(); return; }
      container.innerHTML = `<div class="section-title">Event</div>
        <div class="stack">
          <select class="input" id="evSel"><option value="">No event (general forecast)</option>${list.map((e) => `<option value="${e.id}"${ev && ev.id === e.id ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select>
          ${ev ? `<div class="msg">${esc(ev.loc.name)} · times in ${esc(zoneAbbr(EV.windows(ev)[0] ? EV.windows(ev)[0].startMs : Date.now(), ev.tz))}<br>${EV.windows(ev).filter((w) => w.key !== "all").map((w) => `<b style="color:var(--text)">${esc(w.label)}</b> ${esc(fmtSpan(w))}`).join("<br>")}</div>` : '<p class="msg">Save an event to see setup, gates, the event itself and teardown on every page.</p>'}
          <div class="row">
            <button class="btn ghost sm" id="evNew" type="button">+ NEW</button>
            ${ev ? '<button class="btn ghost sm" id="evEdit" type="button">EDIT</button><button class="btn ghost sm" id="evDel" type="button">DELETE</button>' : ""}
          </div>
        </div>`;
      $("evSel").addEventListener("change", (e) => setActiveEvent(e.target.value || null));
      $("evNew").addEventListener("click", () => {
        const d = new Date(Date.now() + 86400e3), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        editing = { id: null, name: "", loc: { ...loc }, times: { setup: `${day}T15:00`, gates: `${day}T17:30`, start: `${day}T19:00`, end: `${day}T21:30`, teardown: `${day}T23:00` } };
        draw();
      });
      if (ev) {
        $("evEdit").addEventListener("click", () => { editing = JSON.parse(JSON.stringify(ev)); draw(); });
        $("evDel").addEventListener("click", () => { if (!confirm(`Delete "${ev.name}"?`)) return; store.set("ops_events", events().filter((e) => e.id !== ev.id)); setActiveEvent(null, false); draw(); });
      }
    };
    const drawEditor = () => {
      const e = editing, f = (k, label, req) => `<div><label class="field-label" for="ev_${k}">${label}${req ? "" : ' <span style="font-weight:400;text-transform:none">(optional)</span>'}</label><input class="input mono" type="datetime-local" id="ev_${k}" value="${esc(e.times[k] || "")}"></div>`;
      container.innerHTML = `<div class="section-title">${e.id ? "Edit event" : "New event"}</div>
        <div class="stack">
          <div><label class="field-label" for="ev_name">Name</label><input class="input" id="ev_name" value="${esc(e.name)}" placeholder="e.g. FC Cincinnati vs. Columbus"></div>
          <div class="msg">Location: <b style="color:var(--text)">${esc(e.loc.name)}</b>. Times are local to the location.${e.id ? "" : " To use another place, pick it above first."}</div>
          ${f("setup", "Setup starts")}${f("gates", "Gates open")}${f("start", "Event starts", true)}${f("end", "Event ends", true)}${f("teardown", "Teardown ends")}
          <p class="msg err" id="evErr"></p>
          <div class="row"><button class="btn sm" id="evSave" type="button">SAVE EVENT</button><button class="btn ghost sm" id="evCancel" type="button">CANCEL</button></div>
        </div>`;
      $("evCancel").addEventListener("click", () => { editing = null; draw(); });
      $("evSave").addEventListener("click", async () => {
        const times = {}; ["setup", "gates", "start", "end", "teardown"].forEach((k) => { const v = $("ev_" + k).value; if (v) times[k] = v.slice(0, 16); });
        const next = { ...e, name: $("ev_name").value.trim() || "Untitled event", times, fold: {} };
        document.querySelectorAll("[data-fold]").forEach((el) => { if (el.value !== "") next.fold[el.dataset.fold] = +el.value; });
        $("evErr").textContent = "Looking up the location's time zone…";
        try { next.tz = await zoneFor(next.loc.lat, next.loc.lon); } catch (err) { $("evErr").textContent = err.message; return; }
        /* a repeated fall-back time needs an explicit choice: offer both occurrences with their zone */
        Object.keys(times).forEach((k) => {
          const c = Core.time.classify(times[k], next.tz);
          const box = $("ev_" + k).parentElement; let sel = box.querySelector("[data-fold]");
          if (c.kind === "ambiguous" && !sel) {
            box.insertAdjacentHTML("beforeend", `<select class="input" data-fold="${k}" style="margin-top:4px"><option value="">This time happens twice. Which one?</option>${c.options.map((m, i) => `<option value="${i}">${esc(times[k].slice(11))} ${esc(Core.time.abbr(m, next.tz))} (${i ? "second" : "first"})</option>`).join("")}</select>`);
          } else if (c.kind !== "ambiguous" && sel) { sel.remove(); delete next.fold[k]; }
        });
        const errs = EV.validate(next);
        if (errs.length) { $("evErr").textContent = errs.join(" "); return; }
        if (!next.id) next.id = EV.newId();
        store.set("ops_events", [next, ...events().filter((x) => x.id !== next.id)].slice(0, 50));
        editing = null;
        setActiveEvent(next.id);
        draw();
      });
    };
    onEvent(() => draw());
    draw();
  }

  /* Phase windows of the active event on a page's data axis. null without an event. */
  function eventContext(data) {
    const ev = activeEvent();
    if (!ev) return null;
    if (Math.abs(ev.loc.lat - loc.lat) > 0.02 || Math.abs(ev.loc.lon - loc.lon) > 0.02) return { ev, mismatch: true };
    if (!data || !data.times || !data.times.length) return { ev, wins: [], inst: { ms: [] } };
    const inst = { ms: data.ms || [], consistent: data.consistent }, now = Date.now();
    const wins = EV.windows(ev).map((w) => ({ ...w, L: EV.locate(w, inst), cov: EV.coverage(w, inst, now) }));
    return { ev, inst, wins };
  }
  /* Shaded phase spans for charts/strips, in index space starting at s. */
  const eventBands = (ctx, s = 0) => (!ctx || !ctx.wins ? [] : ctx.wins.filter((w) => w.key !== "all" && w.L.idx.length).map((w) => ({ i0: w.L.idx[0] - s, i1: w.L.idx[w.L.idx.length - 1] - s, label: w.label })));
  const covBadge = (c) => c.status === "full" ? '<span class="cov full">FULL</span>' : c.status === "partial" ? `<span class="cov part" title="Data covers ${c.have} of ${c.need} hours">PARTIAL ${c.have}/${c.need} h</span>` : c.status === "past" ? '<span class="cov past">PAST</span>' : '<span class="cov none">NOT IN RANGE YET</span>';

  /* Standard event table: Phase, local time, coverage, then the page's own columns.
     cols: [{label, cell(win) -> html}]. A cell only renders for fully covered windows. */
  function eventTable(el, ctx, cols, { title = "Event windows", note = "" } = {}) {
    if (!el) return;
    if (!ctx) { el.hidden = true; return; }
    el.hidden = false;
    if (ctx.mismatch) {
      el.innerHTML = `<div class="section-title">${esc(title)}</div><p class="msg">The active event, <b>${esc(ctx.ev.name)}</b>, is at ${esc(ctx.ev.loc.name)}. <button class="btn ghost sm" id="evGo" type="button">GO TO EVENT LOCATION</button></p>`;
      $("evGo").addEventListener("click", () => setLocation(ctx.ev.loc));
      return;
    }
    const first = ctx.wins[0], zone = first ? zoneAbbr(first.startMs, ctx.ev.tz) : "";
    el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline;margin-bottom:6px"><div class="section-title" style="margin:0">${esc(title)} · ${esc(ctx.ev.name)}</div><span class="msg">times ${esc(zone)} · hourly model resolution</span></div>` +
      (note ? `<p class="section-sub">${note}</p>` : "") +
      (ctx.inst && ctx.inst.ms.length && !ctx.inst.consistent ? '<p class="msg" style="margin-bottom:8px">A daylight-saving change falls inside this forecast. All times shown are true local time; the provider labelled its data with a single offset, which is converted here.</p>' : "") +
      `<div class="tablewrap"><table class="evtable"><thead><tr><th>Phase</th><th>Local time</th><th>Coverage</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>` +
      ctx.wins.map((w) => { const a1 = zoneAbbr(w.startMs, ctx.ev.tz), a2 = zoneAbbr(w.endMs, ctx.ev.tz); return `<tr class="${w.key === "all" ? "evall" : ""}"><td class="display" style="font-size:12px">${esc(w.label)}</td><td class="num">${esc(fmtSpan(w))}${a1 !== a2 ? ` <span class="msg">(${esc(a1)} → ${esc(a2)})</span>` : ""}</td><td>${covBadge(w.cov)}</td>` +
        cols.map((c) => `<td class="num">${w.cov.status === "full" ? c.cell(w) : '<span class="msg">—</span>'}</td>`).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }

  /* ======================= verification log ======================= */
  /* Forecast records kept in this browser (newest 1500) so sources and blends can later be scored
     against observations. Export from the footer. */
  function logVerify(records) {
    if (!records || !records.length) return;
    const all = store.get("ops_verify", []);
    const key = (r) => `${r.source}|${r.kind}|${r.window && r.window.key}|${r.retrievedAt && r.retrievedAt.slice(0, 13)}`;
    const have = new Set(all.map(key));
    records.forEach((r) => { if (!have.has(key(r))) all.push(r); });
    store.set("ops_verify", all.slice(-1500));
  }
  /* Append to a capped log without ever dropping data silently: if browser storage is full, the oldest
     records are trimmed and the caller is told how many, so the page can say "export soon". */
  function appendLog(key, records, cap, keyOf) {
    if (!records || !records.length) return { ok: true, added: 0, dropped: 0 };
    let all = store.get(key, []);
    const have = new Set(all.map(keyOf)); let added = 0;
    records.forEach((r) => { if (!have.has(keyOf(r))) { all.push(r); added++; } });
    let dropped = Math.max(0, all.length - cap); all = all.slice(-cap);
    for (let tries = 0; tries < 6; tries++) {
      try { localStorage.setItem(key, JSON.stringify(all)); return { ok: true, added, dropped, size: all.length }; }
      catch (e) { const cut = Math.max(1, Math.ceil(all.length * 0.2)); all = all.slice(cut); dropped += cut; }
    }
    return { ok: false, added: 0, dropped, size: all.length };
  }
  const LOG_KEYS = { forecasts: "ops_verify", ptype: "ops_verify_ptype", observations: "ops_obs" };
  /* One export with every log, kept as separate arrays: forecasts and observations never mix. */
  function exportVerify() {
    const out = { exportedAt: new Date().toISOString(), note: "Forecast records and observations are separate. Agreement between sources (including NWS) is a comparison, not verification.",
      methods: { [Core.winter.METHOD_ID]: Core.winter.METHOD }, forecastRecords: store.get(LOG_KEYS.forecasts, []), ptypeRecords: store.get(LOG_KEYS.ptype, []), observations: store.get(LOG_KEYS.observations, []) };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `forecast-ops-log-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  }

  /* Observation log: what actually happened, recorded separately from every forecast. */
  const OBS_TYPES = [["snow", "Snow"], ["rain", "Rain"], ["sleet", "Sleet / ice pellets"], ["freezing_rain", "Freezing rain"], ["freezing_drizzle", "Freezing drizzle"], ["drizzle", "Drizzle"], ["graupel", "Graupel"], ["none", "No precipitation"]];
  const OBS_SOURCES = ["My own observation", "Trained spotter", "ASOS / METAR", "mPING", "Social media / other", "Unknown"];
  function obsCard(container) {
    if (!container) return;
    const draw = () => {
      const list = store.get(LOG_KEYS.observations, []).filter((o) => Math.abs(o.location.lat - loc.lat) < 0.3 && Math.abs(o.location.lon - loc.lon) < 0.3).slice(-8).reverse();
      const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
      container.innerHTML = `<div class="section-title">Observation log</div>
        <p class="section-sub">Record what actually fell, including mixes and uncertain reports. Stored separately from forecasts and exported with them. NWS wording is a forecast, not an observation.</p>
        <div class="stack">
          <div class="row"><div><label class="field-label" for="obsTime">Observed at (your clock)</label><input class="input mono" type="datetime-local" id="obsTime" value="${now}"></div>
          <div><label class="field-label" for="obsSrc">Source</label><select class="input" id="obsSrc">${OBS_SOURCES.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div></div>
          <div><span class="field-label">Types seen (choose every one that applies)</span><div class="row" style="gap:6px;flex-wrap:wrap">${OBS_TYPES.map(([k, l]) => `<label class="chk"><input type="checkbox" value="${k}"> ${esc(l)}</label>`).join("")}</div></div>
          <div class="row"><div><label class="field-label" for="obsCert">Certainty</label><select class="input" id="obsCert"><option value="certain">Certain</option><option value="probable">Probable</option><option value="uncertain">Uncertain</option></select></div>
          <div><label class="field-label" for="obsInt">Intensity (optional)</label><select class="input" id="obsInt"><option value="">—</option><option>light</option><option>moderate</option><option>heavy</option></select></div></div>
          <div><label class="field-label" for="obsNote">Notes (accumulation, road state, timing…)</label><input class="input" id="obsNote" placeholder="e.g. sleet mixing in at 7:40, 0.5&quot; on grass"></div>
          <div class="row"><button class="btn sm" id="obsSave" type="button">SAVE OBSERVATION</button><button class="btn ghost sm" id="obsExport" type="button">EXPORT ALL LOGS</button></div>
          <p class="msg" id="obsMsg"></p>
          ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Observed</th><th style="text-align:left">Types</th><th>Certainty</th><th style="text-align:left">Source</th><th></th></tr></thead><tbody>${list.map((o) => `<tr><td class="num">${esc(new Date(o.validUtc).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</td><td style="text-align:left">${esc(o.types.join(", ").replace(/_/g, " "))}${o.intensity ? ` <span class="msg">(${esc(o.intensity)})</span>` : ""}</td><td>${esc(o.certainty)}</td><td style="text-align:left">${esc(o.source)}</td><td><button class="btn ghost sm" data-del="${esc(o.id)}" type="button">×</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="msg">No observations saved for this location yet.</p>'}
        </div>`;
      $("obsExport").addEventListener("click", exportVerify);
      $("obsSave").addEventListener("click", () => {
        const types = [...container.querySelectorAll(".chk input:checked")].map((x) => x.value);
        if (!types.length) { $("obsMsg").textContent = "Choose at least one type (or 'No precipitation')."; return; }
        const t = $("obsTime").value; if (!t) { $("obsMsg").textContent = "Enter when it was observed."; return; }
        const rec = { schema: 1, kind: "observation", id: "ob_" + Date.now().toString(36), validUtc: new Date(t).toISOString(), recordedAt: new Date().toISOString(),
          location: { lat: loc.lat, lon: loc.lon, name: loc.name }, types, mixed: types.filter((x) => x !== "none").length > 1, certainty: $("obsCert").value,
          intensity: $("obsInt").value || null, source: $("obsSrc").value, notes: $("obsNote").value.trim() };
        const r = appendLog(LOG_KEYS.observations, [rec], 5000, (x) => x.id);
        $("obsMsg").textContent = r.ok ? "Saved." : "Browser storage is full: export your logs, then clear old forecast records.";
        if (r.ok) draw();
      });
      container.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { if (!confirm("Delete this observation?")) return; store.set(LOG_KEYS.observations, store.get(LOG_KEYS.observations, []).filter((o) => o.id !== b.dataset.del)); draw(); }));
    };
    locListeners.push(draw);
    draw();
  }

  window.Ops = {
    Core, BRAND, PRESETS, TIER, maxTier, badge, $, esc, store, css, icon,
    shell, setChip, dataStatus, headline, locationCard, get location() { return loc; }, setLocation, shareUrl,
    Data, getJSON, hasData, savedWeights, savedDays, align: Core.stats.align,
    nowIndex, hourOf, dayOf, fmtDay, fmtHour, fmtWhen, tzShort, hourLabels, dayGroups,
    blendSeries: Core.stats.blendSeries, weightedQuantile: Core.stats.weightedQuantile,
    modelColor, modelPicker, linesToggle, chartBase, modelLine, tierStrip, trackChanges, renderChanges,
    events, activeEvent, setActiveEvent, onEvent, eventCard, eventContext, eventBands, eventTable, fmtLocal, fmtSpan,
    nowIdx, logVerify, exportVerify, blendRecipe, appendLog, LOG_KEYS, obsCard,
  };
})();
