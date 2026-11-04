/* Model maps viewer (v1): HRRR on its native Lambert grid for the Tri-State. Data packages are built by
   WxMan33/forecast-ops-maps and published on GitHub Pages; this page only reads and draws them. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, MC = window.MapsCore, esc = O.esc;
  const Q = new URLSearchParams(location.search);
  const DATA = (Q.get("data") || "https://wxman33.github.io/forecast-ops-maps/data").replace(/\/$/, ""); // ?data= for local tests (read before the shell rewrites the URL)
  O.shell("maps", "Model maps", { forecastPoint: false });
  const TZ = "America/New_York";
  const st = { index: null, run: null, man: null, fields: {}, h: 0, field: O.store.get("maps_field", "t2m"), win: O.store.get("maps_win", "1"), sel: null, play: null, loaded: 0, bounds: null, proj: null, lat: null };
  const fmtLocal = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const fmtUTC = (iso) => `${iso.slice(5, 10).replace("-", "/")} ${iso.slice(11, 13)}Z`;
  const MB = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

  async function getJSON(url) { const r = await fetchT(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
  function fetchT(url, ms = 30000) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal, cache: "no-cache" }).finally(() => clearTimeout(t)); }
  async function getGz(url) {
    if (typeof DecompressionStream !== "function") throw new Error("this browser cannot decompress the map data (DecompressionStream unsupported)");
    const r = await fetchT(url, 60000); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }

  /* ---------- loading ---------- */
  async function init() {
    $("fieldTabs").querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { st.field = b.dataset.f; O.store.set("maps_field", st.field); syncControls(); draw(); }));
    $("winSel").value = st.win; $("winSel").addEventListener("change", () => { st.win = $("winSel").value; O.store.set("maps_win", st.win); draw(); });
    $("hourSl").addEventListener("input", () => { st.h = +$("hourSl").value; draw(); });
    $("prevH").addEventListener("click", () => step(-1)); $("nextH").addEventListener("click", () => step(1));
    $("playBtn").addEventListener("click", togglePlay);
    $("runSel").addEventListener("change", () => loadRun($("runSel").value));
    $("placeSel").addEventListener("change", () => { const p = places().find((x) => x.name === $("placeSel").value); if (p) selectLatLon(p.lat, p.lon, p.name); });
    wireCanvas(); window.addEventListener("resize", () => draw()); window.addEventListener("ops:theme", () => draw());
    try { st.bounds = await getJSON("assets/maps/tristate-boundaries.json"); } catch (e) { st.bounds = null; }
    try { st.index = await getJSON(`${DATA}/index.json`); }
    catch (e) { $("mapStatus").innerHTML = `<span class="state err">Map data unavailable (${esc(e.message)}). Nothing is shown rather than old or partial data.</span>`; return; }
    const runs = st.index.runs || [];
    if (!runs.length) { $("mapStatus").innerHTML = '<span class="state unavail">No published runs yet.</span>'; return; }
    $("runSel").innerHTML = runs.map((r) => `<option value="${esc(r.id)}">${esc(fmtUTC(r.cycle))} · ${r.hoursExpected} h${r.role.includes("extended") ? " (48-h run)" : ""}${r.role.startsWith("latest") ? " · newest" : ""}${Object.keys(r.missing || {}).length ? " · hours missing" : ""}</option>`).join("");
    await loadRun(runs[0].id);
  }
  async function loadRun(id) {
    stopPlay();
    const r = st.index.runs.find((x) => x.id === id); st.run = r; st.fields = {}; st.loaded = 0;
    $("mapStatus").textContent = `Loading ${fmtUTC(r.cycle)} run…`;
    try {
      st.man = await getJSON(`${DATA.replace(/\/data$/, "")}/${r.path}/manifest.json`.replace("//data", "/data"));
      const g = st.man.grid, nh = st.man.hours.length, base = `${DATA.replace(/\/data$/, "")}/${r.path}`;
      st.proj = MC.projector(g);
      const ll = await getGz(`${base}/${g.latlon.file}`); st.lat = new Float32Array(ll); st.loaded += g.latlon.gzipBytes;
      await Promise.all(Object.entries(st.man.fields).map(async ([f, spec]) => { const b = await getGz(`${base}/${spec.file}`); st.fields[f] = MC.field(spec, b, nh, g.ny, g.nx); st.loaded += spec.gzipBytes; }));
    } catch (e) { $("mapStatus").innerHTML = `<span class="state err">This run could not be loaded (${esc(e.message)}).</span>`; st.man = null; draw(); return; }
    $("hourSl").max = String(st.man.hours.length - 1); st.h = Math.min(st.h, st.man.hours.length - 1); $("hourSl").value = String(st.h);
    if (!$("placeSel").options.length || $("placeSel").options.length === 1) $("placeSel").innerHTML = '<option value="">Click or tap the map, or choose…</option>' + places().map((p) => `<option>${esc(p.name)}</option>`).join("");
    status(); syncControls(); draw();
  }
  function places() {
    const pts = ((st.man && st.man.grid.checkpoints && st.man.grid.checkpoints.points) || []).filter((p) => !/corner/i.test(p.name)).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
    const L = O.location; if (L && st.proj && st.proj.nearest(+L.lat, +L.lon) && !pts.some((p) => Math.abs(p.lat - L.lat) < 0.01 && Math.abs(p.lon - L.lon) < 0.01)) pts.unshift({ name: `${L.name} (forecast point)`, lat: +L.lat, lon: +L.lon });
    return pts;
  }

  /* ---------- status: staleness, missing hours, bytes ---------- */
  function status() {
    const r = st.run, m = st.man, now = Date.now(), newest = st.index.runs[0];
    const ageH = (now - Date.parse(newest.cycle)) / 3600e3, genH = (now - Date.parse(st.index.generatedAt)) / 3600e3;
    const stale = ageH > 4 || genH > 3;
    const miss = Object.entries(m.fields).filter(([, v]) => v.missingHours.length).map(([f, v]) => `${m.fields[f].label}: f${v.missingHours.map((h) => String(h).padStart(2, "0")).join(", f")}`);
    $("mapStatus").innerHTML = `${stale ? `<span class="state unavail">Stale: newest run is ${ageH.toFixed(1)} h old; last update ${genH.toFixed(1)} h ago</span> ` : `<span class="msg">Newest run ${ageH.toFixed(1)} h old · updated ${genH < 1 ? `${Math.round(genH * 60)} min` : `${genH.toFixed(1)} h`} ago</span>`}`
      + (miss.length ? `<div class="state partial">Missing forecast hours (left blank): ${esc(miss.join("; "))}</div>` : "")
      + (st.index.failures && st.index.failures.length ? `<div class="msg">Last update could not process: ${esc(st.index.failures.map((f) => f.id).join(", "))}; the previous copies are shown.</div>` : "");
    $("runInfo").innerHTML = `Run ${esc(fmtUTC(m.cycle))} (${esc(r.role)}), ${m.hours.length} forecast hours · processed ${esc(fmtUTC(m.processedAt))}. `
      + `Downloaded from NOAA: <b>${MB(m.gribBytesDownloaded)}</b> of GRIB2 messages (byte ranges of ${new Set(m.sources.map((s) => s.fh)).size} hourly files). `
      + `Loaded by this page: <b>${MB(st.loaded)}</b> compressed (${MB(m.browserPayloadBytes)} package). Grid: ${m.grid.nx}×${m.grid.ny} native cells of ${m.grid.DxInMetres / 1000} km; georeference check ${m.grid.georefMaxErrorCells} cells.`;
  }
  function syncControls() {
    $("fieldTabs").querySelectorAll("[data-f]").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.f === st.field)); b.setAttribute("aria-selected", String(b.dataset.f === st.field)); });
    $("winWrap").hidden = st.field !== "precip";
  }

  /* ---------- values ---------- */
  function valueAt(i, j) {
    const h = st.h;
    if (st.field === "t2m") return { v: st.fields.t2m.at(h, i, j), units: "°F", dec: 0 };
    if (st.field === "refc") { const v = st.fields.refc.at(h, i, j); return { v, units: "dBZ", dec: 0, label: v != null && v < 5 ? "no echo" : null }; }
    const w = st.win === "run" ? "run" : +st.win, p = MC.precip(st.man, st.fields, h, w, i, j);
    return { v: MC.mmToIn(p.mm), units: "in", dec: 2, why: p.why, from: p.from, to: p.to };
  }
  const scaleOf = () => (st.field === "precip" ? "precip" : st.field);
  function windowText() {
    if (st.field !== "precip") return "";
    const H = st.man.hours[st.h], cyc = Date.parse(st.man.cycle), w = st.win === "run" ? H : +st.win;
    if (H === 0 || H - w < 0) return "";
    const a = new Date(cyc + (H - w) * 3600e3).toISOString(), b = st.man.valid[st.h];
    return `${st.win === "run" ? "since run start" : `${w}-h total`}: ${fmtUTC(a)}–${fmtUTC(b)} (${new Date(a).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric" })}–${new Date(b).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", timeZoneName: "short" })})`;
  }

  /* ---------- drawing ---------- */
  function draw() {
    const cv = $("mapCv"); if (!st.man) { cv.width = 0; return; }
    const g = st.man.grid, nx = g.nx, ny = g.ny, H = st.man.hours[st.h];
    $("validTxt").innerHTML = `<b>${esc(fmtLocal(st.man.valid[st.h]))}</b> · ${esc(fmtUTC(st.man.valid[st.h]))} · F${String(H).padStart(2, "0")}${st.field === "precip" && windowText() ? `<div class="msg">${esc(windowText())}</div>` : ""}`;
    const W = Math.round(Math.min(cv.parentElement.clientWidth, (Math.max(320, window.innerHeight * 0.78) * nx) / ny)), Hh = Math.round((W * ny) / nx), dpr = window.devicePixelRatio || 1;
    cv.style.width = W + "px"; cv.style.margin = "0 auto"; cv.style.height = Hh + "px"; cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.body), bg = css.getPropertyValue("--bg").trim() || "#111", fg = css.getPropertyValue("--text").trim() || "#eee", mu = css.getPropertyValue("--muted").trim() || "#999";
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, Hh);
    /* field image: one pixel per native cell, scaled without smoothing (north up = j increasing) */
    const img = new ImageData(nx, ny), sc = scaleOf(); let any = false, why = null;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const r = valueAt(i, j); if (r.v != null) any = true; else if (!why && r.why) why = r.why;
      const c = MC.color(sc, r.v); if (!c) continue; const o = ((ny - 1 - j) * nx + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c[3];
    }
    const off = document.createElement("canvas"); off.width = nx; off.height = ny; off.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 0, 0, W, Hh);
    const sx = W / nx, sy = Hh / ny, px = (lat, lon) => { const [fi, fj] = st.proj.toCell(lat, lon); return [(fi + 0.5) * sx, (ny - 1 - fj + 0.5) * sy]; };
    if (st.bounds) {
      const stroke = (lines, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; lines.forEach((ln) => { ctx.beginPath(); ln.forEach(([lo, la], k) => { const [x, y] = px(la, lo); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); }); };
      ctx.globalAlpha = 0.55; stroke(st.bounds.counties, mu, 0.6); ctx.globalAlpha = 0.95; stroke(st.bounds.states, fg, 1.4); ctx.globalAlpha = 1;
    }
    ctx.font = "600 11px system-ui, sans-serif"; ctx.textBaseline = "middle";
    const drawn = [];
    places().forEach((p) => { const [x, y] = px(p.lat, p.lon); if (drawn.some(([a, b]) => Math.hypot(a - x, b - y) < 26)) return; drawn.push([x, y]); ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill(); ctx.strokeStyle = bg; ctx.lineWidth = 3; const t = p.name.replace(/ \(.*\)$/, "").replace(" airport", "").split(",")[0]; ctx.strokeText(t, x + 5, y); ctx.fillText(t, x + 5, y); });
    if (st.sel) { const [i, j] = st.sel; ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.strokeRect(i * sx - 1, (ny - 1 - j) * sy - 1, sx + 2, sy + 2); }
    const fieldMissing = st.field !== "precip" && !st.fields[st.field].present(H);
    const note = fieldMissing ? `No ${st.man.fields[st.field].label.toLowerCase()} for F${String(H).padStart(2, "0")}: missing from this run (left blank).` : !any && st.field === "precip" && why ? `Precipitation for this window is unavailable: ${why}.` : null;
    $("mapNote").hidden = !note; $("mapNote").textContent = note || "";
    cv.setAttribute("aria-label", `${st.man.fields[st.field === "precip" ? "apcp_hour" : st.field].label.replace("Precipitation, previous hour", "Precipitation")}, HRRR run ${fmtUTC(st.man.cycle)}, valid ${fmtLocal(st.man.valid[st.h])}. Use the place list or arrow keys to read values.`);
    legend(); inspect();
  }
  function legend() {
    const sc = MC.SCALES[scaleOf()], stops = sc.stops;
    const sw = st.field === "t2m"
      ? `<div class="lgbar" style="background:linear-gradient(to right,${stops.map(([t, c]) => `rgb(${c.join(",")}) ${((t - stops[0][0]) / (stops[stops.length - 1][0] - stops[0][0]) * 100).toFixed(1)}%`).join(",")})"></div><div class="lgticks">${stops.filter((s, k) => k % 2 === 0 || s[0] === 32).map(([t]) => `<span style="left:${((t - stops[0][0]) / (stops[stops.length - 1][0] - stops[0][0]) * 100).toFixed(1)}%">${t}</span>`).join("")}</div>`
      : stops.map(([t, c], k) => `<span class="lg"><i style="background:rgb(${c.join(",")})"></i>${t}${stops[k + 1] ? "" : "+"}</span>`).join("");
    const title = st.field === "t2m" ? "2-m temperature, °F" : st.field === "refc" ? "Simulated composite reflectivity, dBZ (model, not radar)" : `Precipitation (liquid equivalent), inches · ${st.win === "run" ? "since run start" : `${st.win}-h total ending at valid time`}`;
    $("legend").innerHTML = `<div class="lgt">${esc(title)}</div><div class="lgs">${sw}</div>${st.field !== "t2m" ? `<div class="msg">Below ${stops[0][0]} ${sc.units}: no colour.</div>` : '<div class="msg">Freezing (32°F) is a colour boundary.</div>'}`;
  }
  function inspect() {
    if (!st.sel || !st.man) return;
    const [i, j] = st.sel, g = st.man.grid, per = g.nx * g.ny, la = st.lat[j * g.nx + i], lo = st.lat[per + j * g.nx + i], r = valueAt(i, j);
    const val = r.v == null ? `<span class="unavail">unavailable</span>${r.why ? ` (${esc(r.why)})` : ""}` : r.label ? `<b>${esc(r.label)}</b> <span class="msg">(model value ${r.v.toFixed(r.dec)} ${esc(r.units)})</span>` : `<b>${r.v.toFixed(r.dec)} ${esc(r.units)}</b>`;
    const fld = st.field === "t2m" ? "2-m temperature" : st.field === "refc" ? "Simulated reflectivity" : `Precipitation, ${st.win === "run" ? "since run start" : `${st.win} h`}`;
    $("inspect").innerHTML = `<div class="inspect-v">${esc(fld)}: ${val}</div><div class="msg">${st.selName ? esc(st.selName) + " · " : ""}grid cell ${i},${j} centred at ${la.toFixed(4)}, ${lo.toFixed(4)} (from the GRIB coordinates)${st.selDist != null ? ` · ${st.selDist.toFixed(1)} km from the point chosen` : ""} · valid ${esc(fmtLocal(st.man.valid[st.h]))}${windowText() ? " · " + esc(windowText()) : ""}</div>`;
  }
  const hav = (a, b, c, d) => { const R = 6371.2, t = (x) => (x * Math.PI) / 180, dl = t(c - a), dn = t(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function selectLatLon(lat, lon, name) {
    const c = st.proj && st.proj.nearest(lat, lon); if (!c) { $("inspect").innerHTML = '<p class="msg">That point is outside the map area.</p>'; return; }
    st.sel = c; st.selName = name || null; const g = st.man.grid, per = g.nx * g.ny; st.selDist = hav(lat, lon, st.lat[c[1] * g.nx + c[0]], st.lat[per + c[1] * g.nx + c[0]]); draw();
  }
  function wireCanvas() {
    const cv = $("mapCv");
    cv.addEventListener("click", (e) => {
      if (!st.man) return; const r = cv.getBoundingClientRect(), g = st.man.grid;
      const i = Math.floor(((e.clientX - r.left) / r.width) * g.nx), j = g.ny - 1 - Math.floor(((e.clientY - r.top) / r.height) * g.ny);
      if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return; st.sel = [i, j]; st.selName = null; st.selDist = null; $("placeSel").value = ""; draw();
    });
    cv.addEventListener("keydown", (e) => {
      if (!st.man) return; const g = st.man.grid, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (d) { e.preventDefault(); const s = st.sel || [Math.floor(g.nx / 2), Math.floor(g.ny / 2)]; st.sel = [Math.max(0, Math.min(g.nx - 1, s[0] + d[0] * (e.shiftKey ? 5 : 1))), Math.max(0, Math.min(g.ny - 1, s[1] + d[1] * (e.shiftKey ? 5 : 1)))]; st.selName = null; st.selDist = null; draw(); }
      else if (e.key === "Enter" && !st.sel) { st.sel = [Math.floor(g.nx / 2), Math.floor(g.ny / 2)]; draw(); }
      else if (e.key === "[" || e.key === ",") step(-1); else if (e.key === "]" || e.key === ".") step(1);
    });
  }
  function step(d) { if (!st.man) return; st.h = (st.h + d + st.man.hours.length) % st.man.hours.length; $("hourSl").value = String(st.h); draw(); }
  function togglePlay() { if (st.play) stopPlay(); else { st.play = setInterval(() => step(1), 650); $("playBtn").textContent = "PAUSE"; $("playBtn").setAttribute("aria-pressed", "true"); } }
  function stopPlay() { if (st.play) clearInterval(st.play); st.play = null; $("playBtn").textContent = "PLAY"; $("playBtn").setAttribute("aria-pressed", "false"); }
  init();
})();
