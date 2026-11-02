/* Forecast Ops — shared page shell: header, nav, location, alerts, fetching and UI helpers.
   Forecast math lives in ops-core.js (window.OpsCore), which every page loads first. */
(function () {
  "use strict";
  const Core = window.OpsCore;

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
  const COLOR = { nodata: "var(--nodata)", limited: "var(--nodata)", normal: "var(--normal)", monitor: "var(--monitor)", prepare: "var(--prepare)", action: "var(--action)" };
  const TIER = {};
  Object.keys(Core.TIERS).forEach((k) => (TIER[k] = { ...Core.TIERS[k], color: COLOR[k] }));
  const maxTier = Core.maxTier;
  const badge = (t, text) => `<span class="badge${t === "limited" ? " dashed" : ""}" style="--b:${TIER[t].color}">${esc(text || TIER[t].word)}</span>`;

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
        <div style="min-width:0"><div class="kicker">Forecast point</div><div class="site-name" id="siteName">—</div><div class="site-sub" id="siteSub"></div></div>
      </div>
      <div class="vsep"></div>
      <div class="headline" id="headline"><span class="hl-word" style="color:var(--muted)">${esc(title.toUpperCase())}</span></div>
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
      Model guidance only. Not an official forecast or warning.`;
    document.body.append(foot);

    $("themeBtn").addEventListener("click", () => { const t = theme() === "dark" ? "light" : "dark"; store.set("ops_theme", t); applyTheme(t); });
    $("printBtn").addEventListener("click", () => window.print());
    applyTheme(theme());
    showLocation();
    loadAlerts();
    locListeners.push(() => loadAlerts());
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
    h.className = "headline" + (t ? " tier" : "") + (tier === "limited" ? " dashed" : "");
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

  /* One model, one request. If Open-Meteo rejects a variable (or a whole pressure level) for this
     model, drop it and retry, so one unsupported field never sinks the whole model. */
  async function fetchModel(base, params, model, hourly, daily) {
    let hv = hourly.slice(), dv = (daily || []).slice();
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = new URLSearchParams({ ...params, latitude: loc.lat, longitude: loc.lon, timezone: "auto", models: model });
      if (hv.length) p.set("hourly", hv.join(","));
      if (dv.length) p.set("daily", dv.join(","));
      const json = await getJSON(`${base}?${p.toString().replace(/%2C/g, ",")}`);
      if (!json.error) return json;
      const why = String(json.reason || "");
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
  const hourLabels = (times) => times.map((t) => `${WD[dayDate(dayOf(t)).getDay()]} ${fmtHour(hourOf(t))}`);
  /* Group hour indices by calendar day, optionally only within [s, e). */
  function dayGroups(times, s = 0, e = times.length) {
    const out = [];
    for (let i = s; i < e; i++) { const k = dayOf(times[i]); if (!out.length || out[out.length - 1].k !== k) out.push({ k, idx: [] }); out[out.length - 1].idx.push(i); }
    return out;
  }

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
  function chartBase({ labels, hours, nowIdx, unit, dec = 0, yTitle, y2Title, beginAtZero, yMin, yMax, selIdx }) {
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
          ticks: { color: muted, font: { family: mono, size: 11 }, callback: (v) => (+v).toFixed(dec && Math.abs(v) < 10 ? dec : 0) + sfx },
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
  function tierStrip(el, times, rows, { nowIdx = -1, sel = null, onPick } = {}) {
    const n = times.length;
    const tpl = `grid-template-columns:140px repeat(${n},minmax(5px,1fr))`;
    const dayRow = `<div class="strip-row" style="${tpl}"><div></div>${times.map((t, i) => `<div class="strip-lab day">${hourOf(t) === 0 || i === 0 ? fmtDay(dayOf(t)).slice(0, 3) : ""}</div>`).join("")}</div>`;
    const hrRow = `<div class="strip-row" style="${tpl}"><div></div>${times.map((t, i) => `<div class="strip-lab${i === nowIdx ? " now" : ""}">${i === nowIdx ? "NOW" : hourOf(t) % 6 === 0 && hourOf(t) !== 0 ? fmtHour(hourOf(t)) : ""}</div>`).join("")}</div>`;
    const body = rows.map((r) => `<div class="strip-row" style="${tpl}"><div class="strip-name${r.bold ? " bold" : ""}"><span class="sw" style="background:${r.color}"></span>${esc(r.name)}</div>` +
      times.map((t, i) => { const tr = r.tiers[i] || "nodata";
        const bg = tr === "nodata" ? "var(--raised)" : tr === "limited" ? "repeating-linear-gradient(45deg,var(--nodata) 0 2px,transparent 2px 5px)" : tr === "normal" ? "color-mix(in srgb, var(--normal) 30%, transparent)" : TIER[tr].color;
        return `<div class="strip-cell${hourOf(t) === 0 ? " d0" : ""}${i === nowIdx ? " now" : ""}${i === sel ? " sel" : ""}" data-i="${i}" style="background:${bg}" title="${esc(r.name)} · ${fmtWhen(t)} · ${TIER[tr].word}"></div>`; }).join("") + `</div>`).join("");
    el.innerHTML = `<div class="tablewrap strip-scroll" tabindex="0" aria-label="Hourly signal. Click an hour, or use the arrow keys, for details."><div class="strip">${dayRow}${hrRow}${body}</div></div>`;
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
     Keeps two snapshots per page+location: the latest and the one before it. A new load
     only pushes the old one back once it's at least 30 minutes old, so refreshing doesn't
     wipe out the comparison. */
  function trackChanges(page, summary) {
    const k = `ops_snap_${page}_${loc.lat},${loc.lon}`, s = store.get(k, {}), now = Date.now();
    if (s.cur && now - s.cur.at >= 30 * 60e3) s.prev = s.cur;
    s.cur = { at: now, summary };
    store.set(k, s);
    return s.prev || null;
  }
  /* spec: [{k, label, fmt(v), min (numeric threshold), tier: true}] */
  function renderChanges(el, prev, cur, spec, unitLabel = "") {
    if (!el) return;
    if (!prev) { el.hidden = true; return; }
    const when = new Date(prev.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    const items = [];
    Object.keys(cur).forEach((rk) => {
      const a = prev.summary[rk], b = cur[rk]; if (!a) return;
      spec.forEach((f) => {
        const x = a[f.k], y = b[f.k]; if (x == null || y == null) return;
        if (f.tier) { if (x !== y && TIER[x] && TIER[y]) items.push({ up: TIER[y].rank > TIER[x].rank, text: `${b.label} · ${f.label} ${TIER[x].word} → ${TIER[y].word}` }); return; }
        const d = y - x; if (Math.abs(d) < f.min) return;
        items.push({ up: d > 0, text: `${b.label} · ${f.label} ${f.fmt(x)} → ${f.fmt(y)}` });
      });
    });
    el.hidden = false;
    el.innerHTML = `<div class="section-title">Since your last check <span class="msg" style="text-transform:none;letter-spacing:0">(${esc(when)}${unitLabel ? " · " + esc(unitLabel) : ""})</span></div>` +
      (items.length ? `<div class="changes">${items.slice(0, 14).map((it) => `<span class="change ${it.up ? "up" : "down"}">${it.up ? "▲" : "▼"} ${esc(it.text)}</span>`).join("")}</div>`
        : '<p class="msg">No meaningful changes.</p>');
  }

  window.Ops = {
    Core, BRAND, PRESETS, TIER, maxTier, badge, $, esc, store, css, icon,
    shell, setChip, dataStatus, headline, locationCard, get location() { return loc; }, setLocation, shareUrl,
    getJSON, fetchModel, pick, hasData, align: Core.stats.align,
    nowIndex, hourOf, dayOf, fmtDay, fmtHour, fmtWhen, tzShort, hourLabels, dayGroups,
    blendSeries: Core.stats.blendSeries, weightedQuantile: Core.stats.weightedQuantile,
    modelColor, modelPicker, linesToggle, chartBase, modelLine, tierStrip, trackChanges, renderChanges,
  };
})();
