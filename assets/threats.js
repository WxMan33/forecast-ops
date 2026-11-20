/* Weather threats page (preview). Official products and our research model on one map:
   warnings > watches > Mesoscale Discussions > outlooks, each with its own line style, label and legend.
   This preview runs on DEMO fixtures only (assets/threats-demo.js); live feeds come after the layout is approved. */
(function () {
  "use strict";
  const O = window.Ops, T = window.ThreatsCore, Demo = window.ThreatsDemo, G = window.SevereResearchContours;
  const $ = (id) => document.getElementById(id), esc = O.esc;
  O.shell("threats", "Weather threats", { forecastPoint: false, subtitle: "Preview · severe weather · demo data" });
  O.setChip("DEMO DATA", "warn", "Fictional products for layout review");

  const CITIES = [["Seattle", 47.61, -122.33], ["Portland", 45.52, -122.68], ["San Francisco", 37.77, -122.42], ["Los Angeles", 34.05, -118.24], ["Las Vegas", 36.17, -115.14], ["Phoenix", 33.45, -112.07], ["Salt Lake City", 40.76, -111.89], ["Denver", 39.74, -104.99], ["Albuquerque", 35.08, -106.65], ["Dallas", 32.78, -96.80], ["Houston", 29.76, -95.37], ["San Antonio", 29.42, -98.49], ["Oklahoma City", 35.47, -97.52], ["Kansas City", 39.10, -94.58], ["Omaha", 41.26, -95.93], ["Minneapolis", 44.98, -93.27], ["Chicago", 41.88, -87.63], ["St. Louis", 38.63, -90.20], ["Memphis", 35.15, -90.05], ["New Orleans", 29.95, -90.07], ["Nashville", 36.16, -86.78], ["Louisville", 38.25, -85.76], ["Indianapolis", 39.77, -86.16], ["Cincinnati", 39.10, -84.51], ["Columbus", 39.96, -83.00], ["Dayton", 39.76, -84.19], ["Lexington", 38.04, -84.50], ["Detroit", 42.33, -83.05], ["Cleveland", 41.50, -81.69], ["Pittsburgh", 40.44, -80.00], ["Charleston WV", 38.35, -81.63], ["Atlanta", 33.75, -84.39], ["Birmingham", 33.52, -86.80], ["Jackson", 32.30, -90.18], ["Charlotte", 35.23, -80.84], ["Raleigh", 35.78, -78.64], ["Washington", 38.90, -77.04], ["Philadelphia", 39.95, -75.17], ["New York", 40.71, -74.01], ["Boston", 42.36, -71.06], ["Jacksonville", 30.33, -81.66], ["Tampa", 27.95, -82.46], ["Miami", 25.76, -80.19]];
  const PLACES = CITIES.map(([name, lat, lon]) => ({ name: name + ({ Cincinnati: ", OH", Louisville: ", KY", Dayton: ", OH" }[name] || ""), lat, lon }));
  const CONUS = [[-125, 24.5], [-66.5, 49.5]];
  const OUTLOOK_COLOR = { TSTM: "#C1E9C1", MRGL: "#66A366", SLGT: "#F6E05E", ENH: "#FFA05C", MDT: "#E06666", HIGH: "#EE99EE" };
  const empty = { type: "FeatureCollection", features: [] };

  const S = { scenario: "overlap", venueKey: "inside", view: "active", scope: "national", sel: null, hover: null, point: null, model: false, hazard: "tornado", ctx: true, sheet: "open" };
  let data, now, venue, map, ready = false, marker, grid = null, mesh = null, mask = null, gridLoading = null, hull = null;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const light = () => document.documentElement.getAttribute("data-theme") === "light";

  /* ---------- colors: NWS-style product colors, darkened in light mode so lines keep contrast ---------- */
  function pal() {
    const L = light();
    return { land: L ? "#f1f2ee" : "#151a22", line: L ? "#4a525e" : "#aeb6c2", water: L ? "#dfe9f5" : "#18293a", text: L ? "#172438" : "#e7ecf3", halo: L ? "#ffffff" : "#0d1117", muted: L ? "#5b6472" : "#8a94a6",
      torW: L ? "#C8102E" : "#FF4040", svrW: L ? "#B85400" : "#FFA024", torA: L ? "#8F7200" : "#FFE14D", svrA: L ? "#A23A68" : "#F28DB8", md: L ? "#1D5FD1" : "#5FB0FF" };
  }
  function colorOf(p) {
    const c = pal(), tor = /tornado/i.test(p.event);
    if (p.kind === "warning") return tor ? c.torW : c.svrW;
    if (p.kind === "watch") return tor ? c.torA : c.svrA;
    if (p.kind === "md") return c.md;
    return OUTLOOK_COLOR[p.category];
  }
  const KIND_WORD = { warning: "WARNING", watch: "WATCH", md: "MD", outlook: "OUTLOOK" };
  /* a small line sample matching the map style, so the list and the map read the same way without color */
  function swatch(p, w = 30) {
    const c = colorOf(p);
    if (p.kind === "warning") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="3"/></svg>`;
    if (p.kind === "watch") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="2.2" stroke-dasharray="5 3"/></svg>`;
    if (p.kind === "md") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="none" stroke="${c}" stroke-width="2.6" stroke-dasharray=".1 4.2" stroke-linecap="round"/></svg>`;
    return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".75" stroke="${c}" stroke-width="1"/></svg>`;
  }

  /* ---------- data ---------- */
  const SRC_OF = (p) => p.kind === "warning" || p.kind === "watch" ? "alerts" : p.kind === "md" ? "md" : "day" + p.day;
  // minutes since the last successful check before a source counts as stale (outlooks change a few times a day)
  const STALE_MIN = { alerts: 10, md: 15, day1: 60, day2: 60 };
  const SRC_NAME = { alerts: "NWS warnings and watches", md: "SPC Mesoscale Discussions", day1: "SPC Day 1 outlook", day2: "SPC Day 2 outlook" };
  function load() {
    data = Demo.scenario(S.scenario); now = Date.parse(data.clock); venue = data.venues[S.venueKey];
    data.state = {}; for (const k of Object.keys(data.sources)) data.state[k] = T.sourceState(data.sources[k], now, STALE_MIN[k]);
  }
  const tz = () => venue.tz;
  const t = (iso, day) => T.fmtTime(iso, tz(), { day });
  const active = () => data.products.filter((p) => p.kind !== "outlook" && Date.parse(p.expires) > now);
  const outlooks = (day) => data.products.filter((p) => p.kind === "outlook" && p.day === day);
  const byId = (id) => data.products.find((p) => p.id === id);
  const rel = (p) => T.relation(p, venue);
  const unconfirmed = (p) => data.state[SRC_OF(p)].kind === "stale" ? data.sources[SRC_OF(p)].lastOk : null;
  const endOf = (p) => p.expires || p.validEnd;
  const viewDay = () => (S.view === "day1" ? 1 : S.view === "day2" ? 2 : null);

  /* ---------- map ---------- */
  async function getJSON(path) { const r = await fetch(path); if (!r.ok) throw Error(path + " " + r.status); return r.json(); }
  async function createMap() {
    const [states, lakes] = await Promise.all([getJSON("assets/severe-research/states.json"), getJSON("assets/severe-research/lakes.json")]);
    const p = pal();
    map = new maplibregl.Map({ container: "txMap", bounds: CONUS, fitBoundsOptions: { padding: pad() }, minZoom: 2.5, maxZoom: 11, renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, attributionControl: false,
      style: { version: 8, glyphs: new URL("assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf", location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}"), sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": p.land } }] } });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "DEMO products · US Census / us-atlas · Natural Earth" }), "bottom-left");
    map.on("load", () => {
      const src = (id, d) => map.addSource(id, { type: "geojson", data: d || empty });
      src("states", states); src("lakes", lakes);
      ["outlook", "active", "hl", "labels", "ring", "m-fill", "m-lines", "m-outside", "m-hull", "cities", "pt"].forEach((id) => src(id));
      map.addImage("hatch", hatch(), { pixelRatio: 2 });
      const L = (o) => map.addLayer(o);
      L({ id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": p.water } });
      L({ id: "outlook-fill", type: "fill", source: "outlook", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.55 } });
      L({ id: "m-fill", type: "fill", source: "m-fill", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 } });
      L({ id: "m-lines", type: "line", source: "m-lines", paint: { "line-color": "#222", "line-width": 0.7, "line-opacity": 0.6 } });
      L({ id: "m-outside", type: "fill", source: "m-outside", paint: { "fill-pattern": "hatch", "fill-opacity": 0.45 } });
      L({ id: "m-hull", type: "line", source: "m-hull", paint: { "line-color": p.muted, "line-width": 1.5, "line-dasharray": [4, 3] } });
      L({ id: "states", type: "line", source: "states", paint: { "line-color": p.line, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.4], "line-opacity": 0.8 } });
      L({ id: "outlook-line", type: "line", source: "outlook", paint: { "line-color": ["get", "edge"], "line-width": ["get", "w"], "line-opacity": 0.95 } });
      L({ id: "hl", type: "line", source: "hl", layout: { "line-join": "round" }, paint: { "line-color": p.text, "line-width": 9, "line-opacity": 0.55, "line-blur": 1 } });
      L({ id: "watch-fill", type: "fill", source: "active", filter: ["==", ["get", "kind"], "watch"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } });
      L({ id: "watch-line", type: "line", source: "active", filter: ["==", ["get", "kind"], "watch"], paint: { "line-color": ["get", "color"], "line-width": 2.6, "line-dasharray": [3, 2], "line-opacity": ["get", "op"] } });
      L({ id: "md-line", type: "line", source: "active", filter: ["==", ["get", "kind"], "md"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3.2, "line-dasharray": [0.1, 2.2], "line-opacity": ["get", "op"] } });
      L({ id: "warn-fill", type: "fill", source: "active", filter: ["==", ["get", "kind"], "warning"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } });
      L({ id: "warn-case", type: "line", source: "active", filter: ["==", ["get", "kind"], "warning"], layout: { "line-join": "round" }, paint: { "line-color": p.halo, "line-width": 6, "line-opacity": 0.85 } });
      L({ id: "warn-line", type: "line", source: "active", filter: ["==", ["get", "kind"], "warning"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3.4 } });
      L({ id: "ring", type: "line", source: "ring", paint: { "line-color": p.text, "line-width": 1.2, "line-dasharray": [2, 3], "line-opacity": 0.7 } });
      L({ id: "pt", type: "circle", source: "pt", paint: { "circle-radius": 6, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": p.text, "circle-stroke-width": 2 } });
      L({ id: "cities", type: "symbol", source: "cities", layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 13], "text-padding": 6, "symbol-sort-key": ["get", "rank"] }, paint: { "text-color": p.muted, "text-halo-color": p.halo, "text-halo-width": 1.4 } });
      // at national zoom a county-sized warning is a few pixels wide: a marker keeps it findable
      L({ id: "warn-dot", type: "circle", source: "labels", maxzoom: 6.5, filter: ["==", ["get", "kind"], "warning"], paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": p.halo, "circle-stroke-width": 2.5 } });
      // watch and MD names repeat along their own edges, so they stay readable at any zoom
      L({ id: "edge-labels", type: "symbol", source: "active", filter: ["in", ["get", "kind"], ["literal", ["watch", "md"]]], layout: { "symbol-placement": "line", "symbol-spacing": 340, "text-field": ["get", "text"], "text-font": ["Open Sans Semibold"], "text-size": 11.5, "text-offset": [0, -0.9], "text-letter-spacing": 0.05 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2 } });
      L({ id: "labels", type: "symbol", source: "labels", filter: ["!=", ["get", "kind"], "warning"], layout: { "text-field": ["get", "text"], "text-font": ["Open Sans Semibold"], "text-size": ["get", "size"], "text-padding": 4, "symbol-sort-key": ["get", "rank"], "text-max-width": 9 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2 } });
      L({ id: "warn-labels", type: "symbol", source: "labels", filter: ["==", ["get", "kind"], "warning"], layout: { "text-field": ["get", "text"], "text-font": ["Open Sans Semibold"], "text-size": 13, "text-padding": 2, "text-allow-overlap": true, "text-variable-anchor": ["bottom", "left", "right", "top"], "text-radial-offset": 1.1, "text-max-width": 20, "text-letter-spacing": 0.04 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2.4 } });
      ready = true; drawAll();
    });
    map.on("click", (e) => { S.point = [e.lngLat.lng, e.lngLat.lat]; S.sel = null; openSheet(); drawAll(); });
    const hits = ["warn-fill", "watch-fill", "outlook-fill", "warn-dot"];
    map.on("mousemove", (e) => { if (!ready) return; const f = map.queryRenderedFeatures(e.point, { layers: hits.filter((l) => map.getLayer(l)) }); map.getCanvas().style.cursor = f.length ? "pointer" : ""; });
  }
  function hatch() {
    const n = 16, c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d");
    g.strokeStyle = light() ? "rgba(60,66,76,.45)" : "rgba(200,206,216,.35)"; g.lineWidth = 2;
    g.beginPath(); for (let k = -n; k <= n; k += 8) { g.moveTo(k, n); g.lineTo(k + n, 0); } g.stroke();
    return g.getImageData(0, 0, n, n);
  }
  function pad() {
    if (!phone()) return { top: 110, bottom: 40, left: 30, right: 30 };
    const sh = $("txPanel").getBoundingClientRect().height || 64;
    return { top: 90, bottom: Math.min(sh + 10, 420), left: 16, right: 16 };
  }
  const feature = (p, props) => ({ type: "Feature", properties: { id: p.id, ...props }, geometry: p.geometry });
  function ring(c, km) {
    const pts = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push([c[0] + (km / (111.32 * Math.cos((c[1] * Math.PI) / 180))) * Math.sin(a), c[1] + (km / 110.574) * Math.cos(a)]); }
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } };
  }

  function drawMap() {
    if (!ready) return;
    const c = pal(), day = viewDay(), focus = S.sel || S.hover;
    // active products: full style in Active now; in Day 1/2 only warnings stay, as outlines
    const act = active().filter((p) => p.geometry && (!day || p.kind === "warning"));
    map.getSource("active").setData({ type: "FeatureCollection", features: act.map((p) => feature(p, { kind: p.kind, color: colorOf(p), op: unconfirmed(p) ? 0.6 : 1, fill: day ? 0 : unconfirmed(p) ? 0.16 : 0.3, text: labelText(p), tc: c.text, hc: c.halo })) });
    // outlooks: filled in their own day view (outline only when our model is on); outlines as context in Active now
    const ol = day ? outlooks(day) : S.ctx ? outlooks(1) : [];
    const filled = day && !S.model;
    map.getSource("outlook").setData({ type: "FeatureCollection", features: ol.map((p) => feature(p, { color: OUTLOOK_COLOR[p.category], edge: filled ? shade(OUTLOOK_COLOR[p.category]) : OUTLOOK_COLOR[p.category], w: filled ? 1 : day ? 2.6 : 1.4 })) });
    map.setLayoutProperty("outlook-fill", "visibility", filled ? "visible" : "none");
    map.setPaintProperty("outlook-line", "line-opacity", day ? 0.95 : 0.7);
    // labels
    const labels = [];
    for (const p of act) if (p.kind === "warning") labels.push({ p, text: labelText(p), size: p.kind === "warning" ? 13 : 11.5, rank: p.kind === "warning" ? 0 : p.kind === "watch" ? 1 : 2, tc: p.kind === "warning" ? c.halo : c.text, hc: p.kind === "warning" ? colorOf(p) : c.halo, off: p.kind === "warning" ? 1.1 : 0 });
    for (const p of ol) if (p.category !== "TSTM" || day) labels.push({ p, text: day ? p.category : p.category, size: day ? 12 : 10, rank: 5, tc: c.text, hc: c.halo, off: 0 });
    map.getSource("labels").setData({ type: "FeatureCollection", features: labels.filter((l) => l.p.label).map((l) => ({ type: "Feature", properties: { kind: l.p.kind, color: colorOf(l.p), text: l.text, size: l.size, rank: l.rank, tc: l.tc, hc: l.hc, off: l.off }, geometry: { type: "Point", coordinates: l.p.label } })) });
    // highlight
    const fp = focus && byId(focus);
    map.getSource("hl").setData(fp && fp.geometry ? { type: "FeatureCollection", features: [feature(fp, {})] } : empty);
    map.getSource("ring").setData(S.scope === "venue" ? { type: "FeatureCollection", features: [ring([venue.lon, venue.lat], T.NEAR_KM)] } : empty);
    map.getSource("pt").setData(S.point ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: S.point } } : empty);
    // venue marker
    if (!marker) {
      const el = document.createElement("div"); el.className = "tx-pin"; el.innerHTML = '<div class="tx-pin-dot"></div><div class="tx-pin-label"></div>';
      el.addEventListener("click", (e) => { e.stopPropagation(); setScope("venue", true); });
      marker = new maplibregl.Marker({ element: el, anchor: "top", offset: [0, -9] }).setLngLat([venue.lon, venue.lat]).addTo(map);
    }
    // city names within 12 km of the venue would sit under its pin label
    map.getSource("cities").setData({ type: "FeatureCollection", features: CITIES.filter(([, lat, lon]) => Math.hypot((lon - venue.lon) * 85, (lat - venue.lat) * 111) > 12).map(([name, lat, lon], i) => ({ type: "Feature", properties: { name, rank: i }, geometry: { type: "Point", coordinates: [lon, lat] } })) });
    marker.setLngLat([venue.lon, venue.lat]); marker.getElement().querySelector(".tx-pin-label").textContent = venue.name;
    marker.getElement().setAttribute("aria-label", "Venue: " + venue.name);
    drawModel();
  }
  function shade(hex) { const n = parseInt(hex.slice(1), 16), f = 0.62; return "rgb(" + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f)).join(",") + ")"; }
  function labelText(p) {
    const u = unconfirmed(p) ? " (unconfirmed)" : "";
    if (p.kind === "warning") return p.event.toUpperCase() + u;
    if (p.kind === "watch") return p.title.toUpperCase() + u;
    if (p.kind === "md") return "MD " + p.title.replace(/\D+/g, "") + u;
    return p.category;
  }

  /* ---------- our research model (demo values on the real research grid) ---------- */
  async function loadGrid() {
    if (grid) return;
    if (!gridLoading) gridLoading = Promise.all([getJSON("assets/severe-daily/grid.json"), getJSON("assets/severe-daily/display-mask.json")]).then(([g, m]) => {
      grid = g.coordinates; mask = new Set(m.hidden); mesh = G.mesh(grid);
      const h = d3.Delaunay.from(grid).hullPolygon(); hull = h;
    }).catch((e) => { gridLoading = null; throw e; });
    return gridLoading;
  }
  function drawModel() {
    if (!ready) return;
    const day = viewDay(), on = day && S.model && grid;
    if (!on) { ["m-fill", "m-lines", "m-outside", "m-hull"].forEach((s) => map.getSource(s).setData(empty)); return; }
    const values = Demo.modelValues(grid, day, S.hazard).map((v, i) => (mask.has(i) ? null : v));
    map.getSource("m-fill").setData(G.contours(mesh, values));
    map.getSource("m-lines").setData(G.isolines(mesh, values));
    const outer = [[-140, 10], [-50, 10], [-50, 62], [-140, 62], [-140, 10]];
    const hole = hull.slice().reverse();
    map.getSource("m-outside").setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [outer, hole] } });
    map.getSource("m-hull").setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: hull } });
  }
  function modelAtVenue(day) {
    if (!grid) return null;
    let best = -1, bd = Infinity;
    grid.forEach(([x, y], i) => { const d = Math.hypot((x - venue.lon) * Math.cos((venue.lat * Math.PI) / 180), y - venue.lat); if (d < bd) { bd = d; best = i; } });
    if (bd * 111 > 20 || mask.has(best)) return { none: true };
    return { p: Demo.modelValues([grid[best]], day, S.hazard)[0] };
  }

  /* ---------- panel ---------- */
  function item(p, opts = {}) {
    const r = rel(p), u = unconfirmed(p);
    const when = p.kind === "outlook" ? "Day " + p.day + " · until " + t(p.validEnd, true) : "Until " + t(p.expires) + " · " + T.untilText(p.expires, now);
    const title = p.kind === "outlook" ? T.outlookLabel(p.category) : p.title;
    const showRel = opts.rel !== false && r.kind !== "none";
    return `<button type="button" class="tx-item${S.hover === p.id ? " hl" : ""}" data-id="${esc(p.id)}" style="--tx-c:${colorOf(p)}">${swatch(p)}<span>`
      + `<span class="tx-kind k-${p.kind}">${KIND_WORD[p.kind]}</span><b>${esc(title)}</b>`
      + `<span class="tx-meta">${esc(when)}</span>`
      + (showRel ? `<span class="tx-rel ${r.kind}">${esc(T.relationText(r))}</span>` : "")
      + (u ? `<span class="tx-flag">NOT CONFIRMED SINCE ${esc(t(u).toUpperCase())} · REFRESH FAILED</span>` : "")
      + `</span></button>`;
  }
  function sources() {
    const rows = ["alerts", "md", "day1", "day2"].map((k) => {
      const s = data.state[k], src = data.sources[k];
      const right = s.kind === "unavailable" ? "Unavailable · status unknown" : s.kind === "stale" ? "Not confirmed since " + t(src.lastOk) : "Checked " + t(src.lastOk) + (k.startsWith("day") ? "" : s.kind === "empty" ? " · none active" : "");
      return `<div class="px-src ${s.kind}"><span><b>${esc(SRC_NAME[k])}</b></span><span>${esc(right)}</span></div>`;
    }).join("");
    return `<div class="px-sources" aria-label="Source status">${rows}<div class="lg-note">Demo clock ${esc(t(data.clock, true))}. A failed refresh never clears a product.</div></div>`;
  }
  function notices() {
    const out = [];
    for (const k of ["alerts", "md"]) {
      const s = data.state[k];
      if (s.kind === "unavailable") out.push(`<div class="px-notice"><b>${esc(SRC_NAME[k])} unavailable.</b> We could not reach the source, so we can't say whether any are active. Other sources are still shown.</div>`);
      else if (s.kind === "stale") out.push(`<div class="px-notice"><b>${esc(SRC_NAME[k])} not confirmed since ${esc(t(data.sources[k].lastOk))}.</b> The last good copy stays on the map, marked unconfirmed, until a refresh succeeds.</div>`);
    }
    return out.join("");
  }
  const activeKnown = () => data.state.alerts.kind !== "unavailable" && data.state.md.kind !== "unavailable" && data.state.alerts.kind !== "stale" && data.state.md.kind !== "stale";

  function venueStrip() {
    // compact venue line on the national view: the venue is never more than one glance away
    const covers = T.sort(active().filter((p) => rel(p).kind === "covers"));
    const lead = covers[0];
    const text = lead ? `<b>${esc(lead.title)}</b> until ${esc(t(lead.expires))}${covers.length > 1 ? ` · +${covers.length - 1} more` : ""}` : activeKnown() ? "Nothing active at the venue" : "Venue status not fully confirmed";
    return `<button type="button" class="px-strip${lead ? " hot" : ""}" data-scope-go="venue" style="--tx-c:${lead ? colorOf(lead) : "var(--line)"}"><span class="px-where">At ${esc(venue.name)}</span><span class="px-strip-t">${text}</span><span class="px-strip-go">Venue view →</span></button>`;
  }
  function laterButtons(pt) {
    return `<div class="px-later">` + [1, 2].map((d) => {
      const o = pt ? T.outlookAt(outlooks(d), pt) : T.highestOutlook(outlooks(d));
      const what = o ? `<span class="px-oc" style="background:${OUTLOOK_COLOR[o.category]}"></span>${esc(T.outlookLabel(o.category))}` : "No severe or thunder area";
      return `<button type="button" data-view-go="day${d}"><span><b>Day ${d}</b> · ${what}</span><span>${esc(o ? t(o.validStart, true).replace(/,.*$/, "") : "")} →</span></button>`;
    }).join("") + `</div>`;
  }

  function nationalActive() {
    const groups = T.group(active(), PLACES);
    let h = venueStrip() + notices() + `<div class="px-h"><span>Most urgent now</span><span>${groups.reduce((n, g) => n + g.items.length, 0)} active</span></div>`;
    if (!groups.length) h += `<p class="px-empty">${activeKnown() ? "No active severe warnings, watches or Mesoscale Discussions in the U.S. right now." : "None received, but at least one source is unavailable or stale (see below)."}</p>`;
    for (const g of groups) {
      const o = g.centre && T.outlookAt(outlooks(1), g.lead.label || g.centre);
      const counts = ["warning", "watch", "md"].map((k) => [k, g.items.filter((p) => p.kind === k).length]).filter(([, n]) => n).map(([k, n]) => n + " " + ({ warning: "warning", watch: "watch", md: "MD" }[k]) + (n > 1 ? (k === "watch" ? "es" : "s") : "")).join(" · ");
      h += `<div class="px-group"><div class="px-group-h">${esc(g.name)}<span>${esc(counts)}</span></div>${g.items.map((p) => item(p, { rel: false })).join("")}${o ? `<div class="px-group-f">Inside the Day 1 ${esc(T.outlookLabel(o.category).toLowerCase())} area</div>` : ""}</div>`;
    }
    h += `<div class="px-h">Forecast for later</div>` + laterButtons(null);
    return h;
  }
  function venueActive() {
    const list = T.sort(active()), covers = list.filter((p) => rel(p).kind === "covers"), near = list.filter((p) => rel(p).kind === "near"), unknown = list.filter((p) => rel(p).kind === "unknown");
    const lead = covers[0], where = `At ${esc(venue.name)} · ${esc(venue.city)}`;
    let h = "";
    if (lead) {
      const also = covers.slice(1).map((p) => esc(p.kind === "md" ? "MD " + p.title.replace(/\D+/g, "") : p.title) + " until " + esc(t(p.expires))).join(" · ");
      const nearW = near.filter((p) => p.kind === "warning")[0];
      h += `<div class="px-brief hot" style="--tx-c:${colorOf(lead)}"><div class="px-where">${where}</div><div class="px-big">${esc(lead.title)}</div>`
        + `<div class="px-sub">In effect until <b>${esc(t(lead.expires))}</b> · ${esc(T.untilText(lead.expires, now))}</div>`
        + (also ? `<div class="px-also">Also: ${also}</div>` : "")
        + (nearW ? `<div class="px-also"><b style="color:var(--text)">${esc(nearW.title)}</b> ${esc(T.relationText(rel(nearW)).replace(" · does not cover it", ""))}. It does not cover the venue.</div>` : "")
        + (unconfirmed(lead) ? `<div class="tx-flag">NOT CONFIRMED SINCE ${esc(t(unconfirmed(lead)).toUpperCase())} · REFRESH FAILED</div>` : "") + `</div>`;
    } else {
      const nearW = near[0];
      h += `<div class="px-brief"><div class="px-where">${where}</div><div class="px-big">${activeKnown() ? "Nothing active here" : "Not fully confirmed"}</div>`
        + `<div class="px-sub">${activeKnown() ? "No severe warning, watch or MD covers the venue." : "No product covers the venue in the data we have, but a source is unavailable or stale."}</div>`
        + (nearW ? `<div class="px-also"><b style="color:var(--text)">${esc(nearW.title)}</b> ${esc(T.relationText(rel(nearW)).replace(" · does not cover it", ""))}.</div>` : "") + `</div>`;
    }
    h += notices();
    if (covers.length) h += `<div class="px-h">Covers the venue</div>` + covers.map((p) => item(p, { rel: false })).join("");
    if (near.length) h += `<div class="px-h"><span>Nearby · does not cover the venue</span><span>within ${Math.round(T.miles(T.NEAR_KM))} mi</span></div>` + near.map((p) => item(p)).join("");
    if (unknown.length) h += `<div class="px-h">Area not drawn</div>` + unknown.map((p) => item(p)).join("");
    h += `<div class="px-h">Later at the venue</div>` + laterButtons([venue.lon, venue.lat]);
    const elsewhere = list.filter((p) => !["covers", "near"].includes(rel(p).kind)).length;
    if (elsewhere) h += `<button type="button" class="px-link px-back" data-scope-go="national">See ${elsewhere} more active elsewhere →</button>`;
    return h;
  }
  function dayPanel(day) {
    const ol = T.sort(outlooks(day)), top = T.highestOutlook(ol), st = data.state["day" + day];
    const pt = [venue.lon, venue.lat], at = T.outlookAt(ol, pt);
    let h = "";
    if (S.scope === "venue") {
      h += `<div class="px-brief"><div class="px-where">Day ${day} at ${esc(venue.name)}</div><div class="px-big">${at ? esc(T.outlookLabel(at.category)) : "No severe risk area"}</div>`
        + `<div class="px-sub">${top ? "Valid " + esc(t(top.validStart, true)) + " → " + esc(t(top.validEnd, true)) : ""}</div>`;
      if (S.model) { const m = modelAtVenue(day); h += m ? `<div class="px-also">Our research model, ${esc(S.hazard === "wind" ? "severe wind" : S.hazard === "hail" ? "severe hail" : "tornado")} within 25 mi: <b style="color:var(--text)">${m.none ? "no guidance here" : (m.p * 100).toFixed(m.p < 0.1 ? 1 : 0) + "%"}</b> · experimental, demo values</div>` : `<div class="px-also">Loading research model…</div>`; }
      h += `</div>`;
    } else {
      h += venueStrip();
      h += `<div class="px-brief"><div class="px-where">Day ${day} · national</div><div class="px-big">${top ? "Highest: " + esc(T.OUTLOOK_NAME[top.category]) : "No severe risk"}</div><div class="px-sub">${top && T.OUTLOOK_LEVEL[top.category] ? esc(T.outlookLabel(top.category)) + " · " + esc(T.placeName(top.label, PLACES)) : top ? "General thunderstorms only" : ""}</div></div>`;
    }
    if (st.kind === "unavailable" || st.kind === "stale") h += `<div class="px-notice"><b>${esc(SRC_NAME["day" + day])}</b> ${st.kind === "stale" ? "not confirmed since " + esc(t(data.sources["day" + day].lastOk)) : "unavailable"}.</div>`;
    h += `<div class="px-h">Outlook areas</div>` + (ol.length ? ol.slice().reverse().sort((a, b) => T.OUTLOOK.indexOf(b.category) - T.OUTLOOK.indexOf(a.category)).map((p) => item(p)).join("") : `<p class="px-empty">No outlook areas.</p>`);
    const actW = active().filter((p) => p.kind === "warning");
    if (actW.length) h += `<div class="px-h">Active now</div><button type="button" class="tx-item" data-view-go="active" style="--tx-c:${colorOf(actW[0])}">${swatch(actW[0])}<span><b>${actW.length} active warning${actW.length > 1 ? "s" : ""}</b><span class="tx-meta">Shown as outlines on this map · open Active now →</span></span></button>`;
    h += `<a class="px-link" href="severe.html#severe-daily">Open the regional Severe viewer →</a>`;
    return h;
  }
  function pointPanel() {
    const pt = S.point, day = viewDay();
    const list = T.sort((day ? outlooks(day) : [...active(), ...outlooks(1)]).filter((p) => p.geometry && T.contains(p.geometry, pt)));
    let h = `<button type="button" class="px-back" data-back>← ${S.scope === "venue" ? "Venue" : "All threats"}</button>`;
    h += `<div class="px-h"><span>At this spot</span><span>${pt[1].toFixed(2)}°, ${pt[0].toFixed(2)}°</span></div>`;
    h += list.length ? list.map((p) => item(p, { rel: false })).join("") : `<p class="px-empty">No ${day ? "Day " + day + " outlook area" : "active product or Day 1 outlook area"} covers this spot.</p>`;
    return h;
  }
  function detail(p) {
    const r = rel(p), ch = T.changes(p, (iso) => t(iso)), u = unconfirmed(p);
    const rows = [];
    if (p.hazard) rows.push(["Hazard", esc(p.hazard)]);
    rows.push(["Area", esc(p.kind === "outlook" ? T.outlookLabel(p.category) + " area" : p.area)]);
    rows.push(["Issued", esc(t(p.issued, true)) + ` <span class="z mono" style="color:var(--muted)">${esc(T.fmtZ(p.issued))}</span>`]);
    if (p.updated && p.updated !== p.issued) rows.push(["Updated", esc(t(p.updated, true))]);
    if (p.kind === "outlook" || p.kind === "md") rows.push(["Valid", esc(t(p.validStart, true)) + " → " + esc(t(endOf(p), true)) + ` <span class="mono" style="color:var(--muted)">${esc(T.fmtZ(p.validStart))}–${esc(T.fmtZ(endOf(p)))}</span>`]);
    else rows.push(["Expires", `<b>${esc(t(p.expires, true))}</b> · ${esc(T.untilText(p.expires, now))}`]);
    rows.push(["Venue", `<b>${esc(T.relationText(r))}</b> <span style="color:var(--muted)">(${esc(venue.name)})</span>`]);
    if (ch) rows.push(["What changed", `<span style="color:var(--muted)">Since ${esc(t(ch.since))}:</span><ul>${ch.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`]);
    if (u) rows.push(["Status", `<span class="tx-flag">NOT CONFIRMED SINCE ${esc(t(u).toUpperCase())}</span><br>The source's last refresh failed; still shown until it is confirmed or expires.`]);
    rows.push(["Issued by", esc(p.office)]);
    rows.push(["Source", esc(p.source.name) + ` <span style="color:var(--muted)">· demo product, no live link</span>`]);
    const bulletin = p.bulletin || ("Day " + p.day + " Convective Outlook\nNWS Storm Prediction Center Norman OK\n\n(DEMO: the outlook discussion text appears here in the beta.)");
    return `<button type="button" class="px-back" data-back>← Back</button>`
      + `<div style="--tx-c:${colorOf(p)}">${swatch(p, 40)} <span class="tx-kind k-${p.kind}">${KIND_WORD[p.kind]}</span></div>`
      + `<div class="px-title">${esc(p.kind === "outlook" ? "Day " + p.day + " outlook · " + T.outlookLabel(p.category) : p.title)}</div>`
      + (p.headline ? `<p class="px-headline">${esc(p.headline)}</p>` : "")
      + `<dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`
      + `<details class="px-bulletin"><summary>${p.kind === "outlook" ? "Read the outlook discussion" : "Read the official bulletin"}</summary><pre>${esc(bulletin)}</pre><div class="lg-note">${esc(Demo.BULLETIN_NOTE)}</div></details>`;
  }
  function peekText() {
    const covers = T.sort(active().filter((p) => rel(p).kind === "covers"));
    if (S.sel) { const p = byId(S.sel); return p ? (p.kind === "outlook" ? "Day " + p.day + " · " + T.outlookLabel(p.category) : p.title) : ""; }
    if (viewDay()) { const o = T.outlookAt(outlooks(viewDay()), [venue.lon, venue.lat]); return "Day " + viewDay() + " at " + venue.name + ": " + (o ? T.OUTLOOK_NAME[o.category] : "no severe risk"); }
    return covers[0] ? covers[0].title + " at " + venue.name + " · until " + t(covers[0].expires) : (activeKnown() ? "Nothing active at " + venue.name : "Not fully confirmed at " + venue.name);
  }
  function peekColor() {
    const covers = T.sort(active().filter((p) => rel(p).kind === "covers"));
    return !S.sel && !viewDay() && covers[0] && covers[0].kind === "warning" ? colorOf(covers[0]) : "";
  }
  function renderPanel() {
    const body = $("txPanelBody"), p = S.sel && byId(S.sel);
    body.innerHTML = (p ? detail(p) : S.point ? pointPanel() : viewDay() ? dayPanel(viewDay()) : S.scope === "venue" ? venueActive() : nationalActive()) + sources();
    document.querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === S.scope)));
    $("scopeVenue").textContent = "Venue · " + venue.name;
    $("txPeek").textContent = peekText(); $("txHandle").style.setProperty("--peek-c", peekColor() || "transparent");
  }

  /* ---------- top-of-map: valid time, model control, chips; legend ---------- */
  function renderTop() {
    document.querySelectorAll(".tx-tb").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === S.view)));
    const day = viewDay();
    if (!day) $("txValid").innerHTML = `<b>Active now</b> · as of ${esc(t(data.clock, true))}`;
    else {
      const o = outlooks(day)[0];
      $("txValid").innerHTML = o ? `<b>Day ${day}</b> · ${esc(t(o.validStart, true))} → ${esc(t(o.validEnd, true))}<span class="z">${esc(T.fmtZ(o.validStart))}–${esc(T.fmtZ(o.validEnd))} · issued ${esc(T.fmtZ(o.issued))}</span>` : `<b>Day ${day}</b> · no outlook loaded`;
    }
    $("txModel").hidden = !day; $("modelChk").checked = S.model; $("modelHz").hidden = !S.model;
    document.querySelectorAll(".tx-hb").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hz === S.hazard)));
    const chips = [];
    const actW = active().filter((p) => p.kind === "warning");
    if (day && actW.length) chips.push(`<button type="button" class="tx-chip" data-view-go="active"><span class="k" style="color:${colorOf(actW[0])}">●</span>${actW.length} active warning${actW.length > 1 ? "s" : ""} · view Active now</button>`);
    const bad = Object.keys(data.state).filter((k) => ["stale", "unavailable"].includes(data.state[k].kind));
    if (bad.length) chips.push(`<button type="button" class="tx-chip warn" data-sources>⚠ ${bad.length} source${bad.length > 1 ? "s" : ""} not current</button>`);
    $("txChips").innerHTML = chips.join("");
    renderLegend();
  }
  function lgLine(p, text) { return `<div class="lg-row">${swatch(p, 28)}<span>${text}</span></div>`; }
  function renderLegend() {
    const day = viewDay(), fake = (kind, event) => ({ kind, event, category: event });
    let h = "";
    if (!day) h += `<div><div class="lg-h">Active now · most urgent first</div>${lgLine(fake("warning", "Tornado"), "<b>Warning</b> · solid, filled")}${lgLine(fake("watch", "Tornado"), "<b>Watch</b> · dashed")}${lgLine(fake("md", ""), "<b>Mesoscale Discussion (MD)</b> · dotted")}<div class="lg-note">Red, yellow: tornado · orange, pink: severe thunderstorm</div></div>`;
    else h += `<div><div class="lg-h">Active now</div>${lgLine(fake("warning", "Tornado"), "Warnings shown as outlines")}</div>`;
    if (day || S.ctx) h += `<div><div class="lg-h">SPC Day ${day || 1} outlook${day ? "" : " · outlines"}</div><div class="lg-bands">${T.OUTLOOK.map((c) => `<span class="lg-band" title="${esc(T.outlookLabel(c))}"><i style="background:${OUTLOOK_COLOR[c]}"></i>${c}${T.OUTLOOK_LEVEL[c] ? `<small>${T.OUTLOOK_LEVEL[c]}</small>` : ""}</span>`).join("")}</div><div class="lg-note">Risk level 1–5 · TSTM: thunderstorms, no severe risk</div></div>`;
    if (!day) h += `<label class="lg-toggle"><input type="checkbox" id="ctxChk"${S.ctx ? " checked" : ""}> Day 1 outlook outlines</label>`;
    if (day && S.model) h += `<div><div class="lg-h">Our research model · ${esc(S.hazard)} within 25 mi</div><div class="lg-bands">${G.BANDS.map(([, c, l]) => `<span class="lg-band"><i style="background:${c}"></i>${l}</span>`).join("")}</div><div class="lg-note">Experimental Forecast Ops guidance, not an official forecast. Demo values. Hatched: no model guidance (outside the regional grid or over water).</div></div>`;
    if (S.scope === "venue") h += `<div class="lg-row"><svg width="28" height="10" aria-hidden="true"><line x1="1" y1="5" x2="27" y2="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/></svg><span>${Math.round(T.miles(T.NEAR_KM))}-mile "nearby" ring</span></div>`;
    $("txLegendBody").innerHTML = h;
    const cc = $("ctxChk"); if (cc) cc.addEventListener("change", () => { S.ctx = cc.checked; drawAll(); });
  }

  function drawAll() { renderTop(); renderPanel(); drawMap(); sheetVar(); }

  /* ---------- actions ---------- */
  function fitProduct(p) {
    if (!map || !p.geometry) return;
    const b = T.bbox(p.geometry); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 9, duration: 500 });
  }
  function setScope(scope, move) {
    S.scope = scope; S.sel = null; S.point = null;
    if (move && map) {
      if (scope === "venue") map.flyTo({ center: [venue.lon, venue.lat], zoom: phone() ? 7.2 : 8, padding: pad(), duration: 600 });
      else map.fitBounds(CONUS, { padding: pad(), duration: 600 });
    }
    openSheet(); drawAll();
  }
  function setView(v) {
    S.view = v; S.sel = null; S.point = null;
    if (viewDay() && S.model) loadGrid().then(drawAll).catch(() => {});
    drawAll();
  }
  function openSheet() { if (phone()) { S.sheet = "open"; $("txPanel").dataset.sheet = "open"; $("txHandle").setAttribute("aria-expanded", "true"); $("txHandleAct").textContent = "Close"; } }
  function toggleSheet() {
    S.sheet = S.sheet === "open" ? "peek" : "open";
    if (map && S.scope === "venue") requestAnimationFrame(() => map.easeTo({ center: [venue.lon, venue.lat], padding: pad(), duration: 300 })); $("txPanel").dataset.sheet = S.sheet;
    $("txHandle").setAttribute("aria-expanded", String(S.sheet === "open")); $("txHandleAct").textContent = S.sheet === "open" ? "Close" : "Details"; sheetVar();
  }
  function sheetVar() { const h = phone() ? $("txPanel").getBoundingClientRect().height : 0; $("tx").style.setProperty("--sheet-h", h + "px"); }

  $("txPanel").addEventListener("click", (e) => {
    const it = e.target.closest("[data-id]"), sg = e.target.closest("[data-scope-go]"), vg = e.target.closest("[data-view-go]"), back = e.target.closest("[data-back]");
    if (it) { S.sel = it.dataset.id; S.hover = null; drawAll(); fitProduct(byId(S.sel)); $("txPanelBody").scrollTop = 0; $("txPanelBody").focus({ preventScroll: true }); return; }
    if (sg) return setScope(sg.dataset.scopeGo, true);
    if (vg) return setView(vg.dataset.viewGo);
    if (back) { if (S.sel) S.sel = null; else S.point = null; drawAll(); }
  });
  const hoverOn = (e) => { const it = e.target.closest("[data-id]"); const id = it ? it.dataset.id : null; if (id !== S.hover) { S.hover = id; drawMap(); } };
  $("txPanel").addEventListener("mouseover", hoverOn); $("txPanel").addEventListener("focusin", hoverOn);
  $("txPanel").addEventListener("mouseleave", () => { if (S.hover) { S.hover = null; drawMap(); } });
  document.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.scope, true)));
  document.querySelectorAll(".tx-tb").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $("modelChk").addEventListener("change", () => { S.model = $("modelChk").checked; if (S.model) loadGrid().then(drawAll).catch(() => { $("txValid").insertAdjacentHTML("beforeend", " · research model unavailable"); }); drawAll(); });
  document.querySelectorAll(".tx-hb").forEach((b) => b.addEventListener("click", () => { S.hazard = b.dataset.hz; drawAll(); }));
  $("txChips").addEventListener("click", (e) => { const v = e.target.closest("[data-view-go]"); if (v) setView(v.dataset.viewGo); if (e.target.closest("[data-sources]")) { S.sel = null; S.point = null; openSheet(); drawAll(); const s = document.querySelector(".px-sources"); if (s) s.scrollIntoView({ block: "nearest" }); } });
  $("txHandle").addEventListener("click", toggleSheet);
  $("demoScenario").addEventListener("change", () => { S.scenario = $("demoScenario").value; S.sel = null; S.point = null; load(); drawAll(); });
  $("demoVenue").addEventListener("change", () => { S.venueKey = $("demoVenue").value; S.sel = null; S.point = null; load(); drawAll(); if (S.scope === "venue" && map) map.easeTo({ center: [venue.lon, venue.lat], duration: 400 }); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (S.sel || S.point) { S.sel = null; S.point = null; drawAll(); $("txPanelBody").focus({ preventScroll: true }); }
    else if (phone() && S.sheet === "open") toggleSheet();
  });
  window.addEventListener("ops:theme", () => {
    if (!ready) return; const c = pal();
    map.setPaintProperty("bg", "background-color", c.land); map.setPaintProperty("lakes", "fill-color", c.water); map.setPaintProperty("states", "line-color", c.line);
    map.setPaintProperty("cities", "text-color", c.muted); map.setPaintProperty("cities", "text-halo-color", c.halo); map.setPaintProperty("warn-case", "line-color", c.halo);
    map.setPaintProperty("ring", "line-color", c.text); map.setPaintProperty("hl", "line-color", c.text); map.setPaintProperty("m-hull", "line-color", c.muted); map.setPaintProperty("pt", "circle-stroke-color", c.text);
    map.setPaintProperty("warn-dot", "circle-stroke-color", c.halo);
    map.removeImage("hatch"); map.addImage("hatch", hatch(), { pixelRatio: 2 });
    drawAll();
  });
  function measure() { const top = $("tx").getBoundingClientRect().top + window.scrollY; document.body.style.setProperty("--tx-top", Math.round(top) + "px"); if (map) map.resize(); sheetVar(); }
  window.addEventListener("resize", measure);

  /* URL state for review links: ?scenario=quiet&venue=edge&view=day1&scope=venue&model=1 */
  try {
    const q = new URLSearchParams(location.search);
    if (["overlap", "quiet", "unavailable"].includes(q.get("scenario"))) S.scenario = q.get("scenario");
    if (["inside", "edge", "outside"].includes(q.get("venue"))) S.venueKey = q.get("venue");
    if (["active", "day1", "day2"].includes(q.get("view"))) S.view = q.get("view");
    if (["national", "venue"].includes(q.get("scope"))) S.scope = q.get("scope");
    if (q.get("model") === "1") S.model = true;
    if (["tornado", "wind", "hail"].includes(q.get("hazard"))) S.hazard = q.get("hazard");
    if (q.get("sel")) S.sel = q.get("sel");
    if (q.get("sheet") === "peek") S.sheet = "peek";
  } catch (e) { /* no URL state */ }
  $("demoScenario").value = S.scenario; $("demoVenue").value = S.venueKey;
  if (phone() && !new URLSearchParams(location.search).has("sheet")) S.sheet = "peek";
  if (S.sheet === "peek" && phone()) { S.sheet = "open"; toggleSheet(); }
  if (phone()) $("txLegend").open = false;
  load(); measure(); renderTop(); renderPanel(); sheetVar();
  if (S.model && viewDay()) loadGrid().then(drawAll).catch(() => {});
  createMap().then(() => {
    map.once("load", () => {
      if (S.scope === "venue") map.jumpTo({ center: [venue.lon, venue.lat], zoom: phone() ? 7.2 : 8, padding: pad() });
      else if (S.sel && byId(S.sel)) { const b = T.bbox(byId(S.sel).geometry); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 9, duration: 0 }); }
      else map.fitBounds(CONUS, { padding: pad(), duration: 0 });
    });
  }).catch((e) => { $("txMap").innerHTML = `<p class="msg" style="padding:20px">The map could not load (${esc(e.message)}). The threat list still works.</p>`; });
  window.__threats = { S, drawAll, get map() { return map; }, get ready() { return ready; } };
})();
