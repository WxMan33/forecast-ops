/* Weather threats page (preview). Official products and our research model on one map:
   warnings > watches > Mesoscale Discussions > outlooks, each with its own line style, label and legend.
   This preview runs on DEMO fixtures only (assets/threats-demo.js); live feeds come after the layout is approved. */
(function () {
  "use strict";
  const O = window.Ops, T = window.ThreatsCore, Demo = window.ThreatsDemo, G = window.SevereResearchContours, Live = window.ThreatsLive;
  const $ = (id) => document.getElementById(id), esc = O.esc;
  O.shell("threats", "Weather threats", { forecastPoint: false, subtitle: "Preview · severe weather" });

  const CITIES = [["Seattle", 47.61, -122.33], ["Portland", 45.52, -122.68], ["San Francisco", 37.77, -122.42], ["Los Angeles", 34.05, -118.24], ["Las Vegas", 36.17, -115.14], ["Phoenix", 33.45, -112.07], ["Salt Lake City", 40.76, -111.89], ["Denver", 39.74, -104.99], ["Albuquerque", 35.08, -106.65], ["Dallas", 32.78, -96.80], ["Houston", 29.76, -95.37], ["San Antonio", 29.42, -98.49], ["Oklahoma City", 35.47, -97.52], ["Kansas City", 39.10, -94.58], ["Omaha", 41.26, -95.93], ["Des Moines", 41.59, -93.62], ["Minneapolis", 44.98, -93.27], ["Chicago", 41.88, -87.63], ["St. Louis", 38.63, -90.20], ["Memphis", 35.15, -90.05], ["Tupelo", 34.26, -88.70], ["New Orleans", 29.95, -90.07], ["Nashville", 36.16, -86.78], ["Huntsville", 34.73, -86.59], ["Louisville", 38.25, -85.76], ["Indianapolis", 39.77, -86.16], ["Cincinnati", 39.10, -84.51], ["Columbus", 39.96, -83.00], ["Dayton", 39.76, -84.19], ["Lexington", 38.04, -84.50], ["Detroit", 42.33, -83.05], ["Cleveland", 41.50, -81.69], ["Pittsburgh", 40.44, -80.00], ["Charleston WV", 38.35, -81.63], ["Atlanta", 33.75, -84.39], ["Birmingham", 33.52, -86.80], ["Jackson", 32.30, -90.18], ["Charlotte", 35.23, -80.84], ["Raleigh", 35.78, -78.64], ["Washington", 38.90, -77.04], ["Philadelphia", 39.95, -75.17], ["New York", 40.71, -74.01], ["Boston", 42.36, -71.06], ["Jacksonville", 30.33, -81.66], ["Tampa", 27.95, -82.46], ["Miami", 25.76, -80.19]];
  const ST = { Cincinnati: "OH", Louisville: "KY", Dayton: "OH", Tupelo: "MS", Huntsville: "AL", Birmingham: "AL", Dallas: "TX", "Des Moines": "IA", Memphis: "TN", Nashville: "TN", "Oklahoma City": "OK" };
  const PLACES = CITIES.map(([name, lat, lon]) => ({ name: name + (ST[name] ? ", " + ST[name] : ""), lat, lon }));
  const CONUS = [[-124.8, 24.6], [-66.9, 49.4]];
  const ERO_COLOR = { MRGL: "#8BD28B", SLGT: "#F2D45C", MDT: "#EE7466", HIGH: "#D36AD6" }; // WPC's own colour order
  const FX = window.ThreatsFeeds;
  /* outlook names: SPC "Enhanced risk (3 of 5)"; WPC "High excessive rainfall risk (4 of 4)" */
  const olabel = (p) => p.program === "ero" ? FX.ERO_NAME[p.category] + " excessive rainfall risk (" + (FX.ERO_CATS.indexOf(p.category) + 1) + " of 4)" : T.outlookLabel(p.category);
  const OUTLOOK_COLOR = { TSTM: "#C1E9C1", MRGL: "#66A366", SLGT: "#F6E05E", ENH: "#FFA05C", MDT: "#E06666", HIGH: "#EE99EE" };
  const SCOPE_NOTE = "This page covers NWS tornado and severe thunderstorm warnings and watches, SPC Mesoscale Discussions and SPC severe outlooks in the contiguous U.S.";
  const empty = { type: "FeatureCollection", features: [] };

  const S = { layers: { severe: true, flood: true }, scenario: "live", venueKey: "inside", liveVenue: "fp", entryVenue: null, view: "active", scope: "national", sel: null, hover: null, point: null, model: false, hazard: "tornado", ctx: true, sheet: "open" };
  let data, now, venue, map, ready = false, liveReady = false, meshes = new Map(), tzCache = {}, marker, grid = null, mesh = null, mask = null, gridLoading = null, hull = null;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const light = () => document.documentElement.getAttribute("data-theme") === "light";

  /* ---------- colors: NWS-style product colors, darkened in light mode so lines keep contrast ---------- */
  function pal() {
    const L = light();
    return { land: L ? "#f1f2ee" : "#151a22", line: L ? "#4a525e" : "#aeb6c2", water: L ? "#dfe9f5" : "#18293a", text: L ? "#172438" : "#e7ecf3", halo: L ? "#ffffff" : "#0d1117", muted: L ? "#5b6472" : "#8a94a6",
      ffw: L ? "#0B7A4B" : "#2FD08A", torW: L ? "#C8102E" : "#FF4040", svrW: L ? "#B85400" : "#FFA024", torA: L ? "#8F7200" : "#FFE14D", svrA: L ? "#A23A68" : "#F28DB8", md: L ? "#1D5FD1" : "#5FB0FF" };
  }
  const isTor = (p) => /tornado/i.test(p.event || "");
  function colorOf(p) {
    const c = pal();
    if (p.kind === "warning") return p.family === "flood" ? c.ffw : isTor(p) ? c.torW : c.svrW;
    if (p.kind === "outlook" && p.program === "ero") return ERO_COLOR[p.category];
    if (p.kind === "watch") return isTor(p) ? c.torA : c.svrA;
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
  const SRC_OF = (p) => p.kind === "warning" || p.kind === "watch" ? "alerts" : p.kind === "md" ? "md" : (p.program === "ero" ? "ero" : "day") + p.day;
  // minutes since the last successful check before a source counts as stale (outlooks change a few times a day)
  const STALE_MIN = { alerts: 10, md: 15, day1: 60, day2: 60, day3: 60, ero1: 60, ero2: 60, ero3: 60 };
  const SRC_NAME = { alerts: "NWS warnings and watches", md: "SPC Mesoscale Discussions", day1: "SPC Day 1 outlook", day2: "SPC Day 2 outlook", day3: "SPC Day 3 outlook", ero1: "WPC excessive rainfall · Day 1", ero2: "WPC excessive rainfall · Day 2", ero3: "WPC excessive rainfall · Day 3" };
  const isLive = () => S.scenario === "live";
  const isArchive = () => /^archive-/.test(S.scenario);
  const official = () => isLive() || isArchive();
  /* archived official samples: real venues chosen to show each sample's behaviour */
  const ARCHIVE_VENUES = {
    "archive-lox": [{ id: "sofi", name: "SoFi Stadium", city: "Inglewood, CA", lat: 33.9535, lon: -118.3392, tz: "America/Los_Angeles", label: "SoFi Stadium (the last update moves off it)" }, { id: "lbcc", name: "Long Beach Convention Center", city: "Long Beach, CA", lat: 33.7642, lon: -118.1893, tz: "America/Los_Angeles", label: "Long Beach Convention Center (stays covered)" }],
    "archive-mtr": [{ id: "boardwalk", name: "Santa Cruz Beach Boardwalk", city: "Santa Cruz, CA", lat: 36.9643, lon: -122.0177, tz: "America/Los_Angeles", label: "Santa Cruz Beach Boardwalk" }],
    "archive-ww705": [{ id: "linc", name: "Lincoln Financial Field", city: "Philadelphia, PA", lat: 39.9008, lon: -75.1675, tz: "America/New_York", label: "Lincoln Financial Field (inside)" }, { id: "cure", name: "CURE Insurance Arena", city: "Trenton, NJ", lat: 40.2207, lon: -74.7569, tz: "America/New_York", label: "CURE Insurance Arena, Trenton (inside)" }, { id: "metlife", name: "MetLife Stadium", city: "East Rutherford, NJ", lat: 40.8135, lon: -74.0745, tz: "America/New_York", label: "MetLife Stadium (outside the watch)" }],
  };
  const FLOOD_VENUES = [{ id: "daytona", name: "Daytona International Speedway", city: "Daytona Beach, FL", lat: 29.1852, lon: -81.0705, tz: "America/New_York", label: "Daytona International Speedway" }, { id: "fairgrounds", name: "Flagler County Fairgrounds", city: "Bunnell, FL", lat: 29.4447, lon: -81.2896, tz: "America/New_York", label: "Flagler County Fairgrounds" }, { id: "atlanta", name: "Mercedes-Benz Stadium", city: "Atlanta, GA", lat: 33.7554, lon: -84.4008, tz: "America/New_York", label: "Mercedes-Benz Stadium, Atlanta (outside)" }];
  ARCHIVE_VENUES["archive-flood-day"] = FLOOD_VENUES; ARCHIVE_VENUES["archive-flood-afternoon"] = FLOOD_VENUES; ARCHIVE_VENUES["archive-flood-night"] = FLOOD_VENUES;
  const archiveData = new Map();
  function loadArchive() {
    const key = S.scenario + "|" + S.step;
    if (archiveData.has(key)) return archiveData.get(key);
    archiveData.set(key, null);
    Live.archiveSnapshot(S.scenario, S.step).then((d) => { archiveData.set(key, d); if (S.scenario + "|" + S.step === key) { load(); renderBar(); drawAll(); fitArchive(); } })
      .catch((e) => { archiveData.set(key, { error: e.message }); load(); drawAll(); });
    return null;
  }
  /* live venues: the Forecast Ops point, its built-in places and Event Manager's saved venues */
  function liveVenues() {
    const L = O.location, split = (n) => { const i = n.indexOf(", "); return i > 0 ? [n.slice(0, i), n.slice(i + 2)] : [n, ""]; };
    const list = [{ id: "fp", label: "Forecast point: " + L.name, name: split(L.name)[0], city: split(L.name)[1], lat: +L.lat, lon: +L.lon }];
    (O.PRESETS || []).forEach((x, i) => list.push({ id: "p" + i, label: x[0], name: split(x[0])[0], city: split(x[0])[1], lat: x[1], lon: x[2] }));
    try { (JSON.parse(localStorage.getItem("beta_venues_v1") || "[]") || []).forEach((v) => { if (v && isFinite(+v.lat) && isFinite(+v.lon) && v.lat !== null) list.push({ id: "ev-" + v.id, label: "Event venue: " + v.name, name: v.name, city: v.city || "", lat: +v.lat, lon: +v.lon, tz: v.tz }); }); } catch (e) { /* no storage */ }
    return list;
  }
  function withTz(v) {
    const k = v.lat.toFixed(3) + "," + v.lon.toFixed(3);
    if (!v.tz && !tzCache[k]) { tzCache[k] = "pending"; O.zoneFor(v.lat, v.lon).then((z) => { tzCache[k] = z; load(); drawAll(); }).catch(() => { tzCache[k] = "America/New_York"; }); }
    return { ...v, tz: v.tz || (tzCache[k] && tzCache[k] !== "pending" ? tzCache[k] : "America/New_York") };
  }
  function load() {
    if (isArchive()) {
      const a = loadArchive(), list = ARCHIVE_VENUES[S.scenario];
      venue = list.find((v) => v.id === S.archiveVenue) || list[0];
      data = a && !a.error ? { ...a } : { clock: new Date().toISOString(), products: [], sources: { alerts: { state: "failed", lastOk: null }, md: { state: "na" }, day1: { state: "na" }, day2: { state: "na" } }, loading: !a, loadError: a && a.error };
      now = Date.parse(data.clock);
    } else if (isLive()) {
      data = Live.snapshot(); data.loading = !liveReady; now = Date.parse(data.clock);
      venue = withTz(S.entryVenue || liveVenues().find((v) => v.id === S.liveVenue) || liveVenues()[0]);
    } else { data = Demo.scenario(S.scenario); now = Date.parse(data.clock); venue = S.entryVenue || data.venues[S.venueKey]; }
    data.state = {}; for (const k of Object.keys(data.sources)) data.state[k] = data.sources[k].state === "na" ? { kind: "na", text: "Not part of this sample" } : data.loading ? { kind: "loading", text: "Loading" } : isArchive() ? { kind: data.sources[k].count ? "current" : "empty", text: "Archived" } : T.sourceState(data.sources[k], now, STALE_MIN[k]);
  }
  const tz = () => venue.tz;
  const t = (iso, day) => T.fmtTime(iso, tz(), { day });
  const shown = (p) => S.layers[p.family || "severe"] !== false;
  const active = () => data.products.filter((p) => p.kind !== "outlook" && shown(p) && (Date.parse(p.expires) > now || (p.kind === "md" && p.expires == null)));
  // reached its published expiration while the source was down: not active, and not described as cleared
  const lapsed = () => data.products.filter((p) => p.kind !== "outlook" && T.expiredUnconfirmed(p, data.sources[SRC_OF(p)], now));
  const outlooks = (day) => data.products.filter((p) => p.kind === "outlook" && p.program !== "ero" && p.day === day);
  const eroOut = (day) => data.products.filter((p) => p.kind === "outlook" && p.program === "ero" && p.day === day);
  const byId = (id) => data.products.find((p) => p.id === id);
  const rel = (p) => T.relation(p, venue);
  const relText = (p) => T.relationText(rel(p), p);
  const unconfirmed = (p) => data.state[SRC_OF(p)].kind === "stale" ? data.sources[SRC_OF(p)].lastOk : null;
  const endOf = (p) => p.expires || p.validEnd;
  const viewDay = () => ({ day1: 1, day2: 2, day3: 3 })[S.view] || null;
  const shortTitle = (p) => p.kind === "watch" ? p.event : p.kind === "md" ? "Mesoscale Discussion " + p.title.replace(/\D+/g, "") : p.title;
  const venueCovers = () => T.sort(active().filter((p) => rel(p).kind === "covers"));
  const venueNear = () => T.sort(active().filter((p) => rel(p).kind === "near"));
  const known = (k) => ["current", "empty", "na"].includes(data.state[k].kind);
  const activeKnown = () => known("alerts") && known("md");
  /* when only one source is unconfirmed, say exactly which part is known */
  function quietText() {
    if (activeKnown()) return { big: "Nothing active at the venue", sub: "No tornado or severe thunderstorm warning or watch is in effect at the venue." };
    if (known("alerts")) return { big: "No warning or watch at the venue", sub: "NWS checked " + t(data.sources.alerts.lastOk) + ". SPC Mesoscale Discussion status is unknown: that source is not responding." };
    return { big: "Venue status not confirmed", sub: "No product covers the venue in the data we have, but NWS warnings and watches are not confirmed (see below)." };
  }
  const SRC_LINK = { ero1: FX.SOURCES.find((x) => x.id === "wpc-ero").url, ero2: FX.SOURCES.find((x) => x.id === "wpc-ero").url, ero3: FX.SOURCES.find((x) => x.id === "wpc-ero").url, day3: "https://www.spc.noaa.gov/products/outlook/day3otlk.html", alerts: "https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch,Severe%20Thunderstorm%20Watch", md: "https://www.spc.noaa.gov/products/md/", day1: "https://www.spc.noaa.gov/products/outlook/day1otlk.html", day2: "https://www.spc.noaa.gov/products/outlook/day2otlk.html" };

  /* ---------- map ---------- */
  async function getJSON(path) { const r = await fetch(path); if (!r.ok) throw Error(path + " " + r.status); return r.json(); }
  async function createMap() {
    const [states, lakes] = await Promise.all([getJSON("assets/severe-research/states.json"), getJSON("assets/severe-research/lakes.json")]);
    const p = pal();
    map = new maplibregl.Map({ container: "txMap", bounds: CONUS, fitBoundsOptions: { padding: pad() }, minZoom: 1.5, maxZoom: 11, renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, attributionControl: false,
      style: { version: 8, glyphs: new URL("assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf", location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}"), sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": p.land } }] } });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "US Census / us-atlas · Natural Earth" }), "bottom-left");
    map.on("load", () => {
      const src = (id, d) => map.addSource(id, { type: "geojson", data: d || empty });
      src("states", states); src("lakes", lakes);
      ["outlook", "ero", "active", "hl", "labels", "ring", "m-fill", "m-lines", "m-outside", "m-hull", "cities", "pt"].forEach((id) => src(id));
      map.addImage("hatch", hatch(), { pixelRatio: 2 });
      const L = (o) => map.addLayer(o);
      L({ id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": p.water } });
      L({ id: "outlook-fill", type: "fill", source: "outlook", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.55 } });
      L({ id: "m-fill", type: "fill", source: "m-fill", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 } });
      L({ id: "m-lines", type: "line", source: "m-lines", paint: { "line-color": "#222", "line-width": 0.7, "line-opacity": 0.6 } });
      L({ id: "m-outside", type: "fill", source: "m-outside", paint: { "fill-pattern": "hatch", "fill-opacity": 0.3 } });
      L({ id: "m-hull", type: "line", source: "m-hull", paint: { "line-color": p.muted, "line-width": 1.2, "line-dasharray": [4, 3] } });
      L({ id: "states", type: "line", source: "states", paint: { "line-color": p.line, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.4], "line-opacity": 0.8 } });
      L({ id: "outlook-line", type: "line", source: "outlook", paint: { "line-color": ["get", "edge"], "line-width": ["get", "w"], "line-opacity": 0.95 } });
      L({ id: "ero-fill", type: "fill", source: "ero", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } });
      L({ id: "ero-line", type: "line", source: "ero", paint: { "line-color": ["get", "edge"], "line-width": ["get", "w"], "line-dasharray": [2.5, 1.2], "line-opacity": 0.95 } });
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
      // at national zoom a county-sized warning is a few pixels wide: a marker keeps it findable.
      // Tornado: larger, with a ring; severe thunderstorm: smaller, solid. The shape differs, not only the color.
      L({ id: "warn-dot", type: "circle", source: "labels", maxzoom: 6.5, filter: ["==", ["get", "kind"], "warning"], paint: { "circle-radius": ["case", ["get", "tor"], 9.5, 6.5], "circle-color": ["get", "color"], "circle-stroke-color": p.halo, "circle-stroke-width": 2.5 } });
      L({ id: "warn-dot-core", type: "circle", source: "labels", maxzoom: 6.5, filter: ["all", ["==", ["get", "kind"], "warning"], ["get", "tor"]], paint: { "circle-radius": 3.2, "circle-color": p.halo } });
      // watch and MD names repeat along their own edges, so they stay readable at any zoom
      L({ id: "edge-labels", type: "symbol", source: "active", filter: ["in", ["get", "kind"], ["literal", ["watch", "md"]]], layout: { "symbol-placement": "line", "symbol-spacing": 340, "text-field": ["get", "text"], "text-font": ["Open Sans Semibold"], "text-size": 11.5, "text-offset": [0, -0.9], "text-letter-spacing": 0.05 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2 } });
      L({ id: "labels", type: "symbol", source: "labels", filter: ["!=", ["get", "kind"], "warning"], layout: { "text-field": ["get", "text"], "text-font": ["Open Sans Semibold"], "text-size": ["get", "size"], "text-padding": 4, "symbol-sort-key": ["get", "rank"], "text-max-width": 9 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2 } });
      // warning labels avoid each other; tornado warnings win the space. Markers above are always drawn.
      L({ id: "warn-labels", type: "symbol", source: "labels", minzoom: 3.2, filter: ["==", ["get", "kind"], "warning"], layout: { "text-field": ["get", "text"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 7, 13], "text-padding": 3, "symbol-sort-key": ["get", "rank"], "text-variable-anchor": ["bottom", "left", "right", "top"], "text-radial-offset": 1.15, "text-max-width": 20, "text-letter-spacing": 0.04 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2.4 } });
      ready = true; drawAll();
    });
    map.on("click", (e) => { S.point = [e.lngLat.lng, e.lngLat.lat]; S.sel = null; openSheet(); drawAll(); });
    const hits = ["warn-fill", "watch-fill", "outlook-fill", "warn-dot"];
    map.on("mousemove", (e) => { if (!ready) return; const f = map.queryRenderedFeatures(e.point, { layers: hits.filter((l) => map.getLayer(l)) }); map.getCanvas().style.cursor = f.length ? "pointer" : ""; });
  }
  function hatch() {
    const n = 24, c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d");
    g.strokeStyle = light() ? "rgba(60,66,76,.5)" : "rgba(200,206,216,.45)"; g.lineWidth = 1.2;
    g.beginPath(); for (let k = -n; k <= n; k += 12) { g.moveTo(k, n); g.lineTo(k + n, 0); } g.stroke();
    return g.getImageData(0, 0, n, n);
  }
  function pad() {
    if (!phone()) return { top: 110, bottom: 40, left: 30, right: 30 };
    const sh = $("txPanel").getBoundingClientRect().height || 110, top = $("txTop") ? $("txTop").getBoundingClientRect().height + 16 : 90;
    return { top, bottom: Math.min(sh + 12, 460), left: 12, right: 12 };
  }
  const feature = (p, props) => ({ type: "Feature", properties: { id: p.id, ...props }, geometry: p.geometry });
  function ring(c, km) {
    const pts = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push([c[0] + (km / (111.32 * Math.cos((c[1] * Math.PI) / 180))) * Math.sin(a), c[1] + (km / 110.574) * Math.cos(a)]); }
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } };
  }

  function drawMap() {
    if (!ready) return;
    const c = pal(), day = viewDay(), focus = S.sel || S.hover;
    // Active now: everything. Day 1: current warnings as outlines, labelled Active now. Day 2: no current geometry.
    const act = day === 2 ? [] : active().filter((p) => p.geometry && (!day || p.kind === "warning"));
    map.getSource("active").setData({ type: "FeatureCollection", features: act.map((p) => feature(p, { kind: p.kind, color: colorOf(p), op: unconfirmed(p) ? 0.6 : 1, fill: day ? 0 : unconfirmed(p) ? 0.16 : 0.3, day: day || 0, text: labelText(p), tc: c.text, hc: c.halo })) });
    // outlooks: filled in their own day view (outline only when our model is on); outlines as context in Active now
    const ol = !S.layers.severe ? [] : day ? outlooks(day) : S.ctx ? outlooks(1) : [];
    // WPC excessive rainfall in the day views: filled when it is the only outlook layer on, dashed outlines over SPC otherwise
    const el = day && S.layers.flood ? eroOut(day) : [], eroFill = !S.layers.severe && !S.model;
    map.getSource("ero").setData({ type: "FeatureCollection", features: el.map((p) => feature(p, { color: ERO_COLOR[p.category], edge: eroFill ? shade(ERO_COLOR[p.category]) : ERO_COLOR[p.category], fill: eroFill ? 0.5 : 0, w: eroFill ? 1.2 : 2.8 })) });
    const filled = day && !S.model && S.layers.severe;
    map.getSource("outlook").setData({ type: "FeatureCollection", features: ol.map((p) => feature(p, { color: OUTLOOK_COLOR[p.category], edge: filled ? shade(OUTLOOK_COLOR[p.category]) : OUTLOOK_COLOR[p.category], w: filled ? 1 : day ? 2.6 : 1.4 })) });
    map.setLayoutProperty("outlook-fill", "visibility", filled ? "visible" : "none");
    map.setPaintProperty("warn-line", "line-dasharray", day === 1 ? [2, 1] : [1, 0]); // Day 1: current warnings dashed, "Active now"
    map.setPaintProperty("outlook-line", "line-opacity", day ? 0.95 : 0.7);
    const labels = [];
    for (const p of act) if (p.kind === "warning") labels.push({ p, text: (day ? "ACTIVE NOW · " : "") + labelText(p), size: 13, rank: isTor(p) ? 0 : 1, tc: c.halo, hc: colorOf(p) });
    for (const p of ol) if (p.category !== "TSTM" || day) labels.push({ p, text: p.category, size: day ? 12 : 10, rank: 5, tc: c.text, hc: c.halo });
    for (const p of el) labels.push({ p, text: "ERO " + p.category, size: 11.5, rank: 4, tc: c.text, hc: c.halo });
    map.getSource("labels").setData({ type: "FeatureCollection", features: labels.filter((l) => l.p.label).map((l) => ({ type: "Feature", properties: { kind: l.p.kind, tor: isTor(l.p), color: colorOf(l.p), text: l.text, size: l.size, rank: l.rank, tc: l.tc, hc: l.hc }, geometry: { type: "Point", coordinates: l.p.label } })) });
    const fp = focus && byId(focus);
    map.getSource("hl").setData(fp && fp.geometry && !(day === 2 && fp.kind !== "outlook") ? { type: "FeatureCollection", features: [feature(fp, {})] } : empty);
    map.getSource("ring").setData(S.scope === "venue" ? { type: "FeatureCollection", features: [ring([venue.lon, venue.lat], T.NEAR_KM)] } : empty);
    map.getSource("pt").setData(S.point ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: S.point } } : empty);
    if (!marker) {
      const el = document.createElement("button"); el.type = "button"; el.className = "tx-pin"; el.innerHTML = '<span class="tx-pin-dot"></span><span class="tx-pin-label"></span>';
      el.addEventListener("click", (e) => { e.stopPropagation(); setScope("venue", true); });
      marker = new maplibregl.Marker({ element: el, anchor: "top", offset: [0, -9] }).setLngLat([venue.lon, venue.lat]).addTo(map);
    }
    // city names within 12 km of the venue would sit under its pin label
    map.getSource("cities").setData({ type: "FeatureCollection", features: CITIES.filter(([, lat, lon]) => Math.hypot((lon - venue.lon) * 85, (lat - venue.lat) * 111) > 12).map(([name, lat, lon], i) => ({ type: "Feature", properties: { name, rank: i }, geometry: { type: "Point", coordinates: [lon, lat] } })) });
    marker.setLngLat([venue.lon, venue.lat]); marker.getElement().querySelector(".tx-pin-label").textContent = venue.name;
    marker.getElement().setAttribute("aria-label", "Open venue view: " + venue.name);
    drawModel();
  }
  function shade(hex) { const n = parseInt(hex.slice(1), 16), f = 0.62; return "rgb(" + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f)).join(",") + ")"; }
  function labelText(p) {
    const u = (unconfirmed(p) ? " (last known)" : "") + (p.geometryIncomplete && p.zoneInfo && p.zoneInfo.counties ? " (area incomplete)" : "");
    if (p.kind === "warning") return p.event.toUpperCase() + u;
    if (p.kind === "watch") return p.title.toUpperCase() + u;
    if (p.kind === "md") return "MD " + p.title.replace(/\D+/g, "") + u;
    return p.category;
  }

  /* ---------- our research model (demo values on the real research grid) ---------- */
  async function loadGrid() {
    if (grid) return;
    if (!gridLoading) gridLoading = Promise.all([getJSON("assets/severe-daily/grid.json"), getJSON("assets/severe-daily/display-mask.json")]).then(([g, m]) => {
      grid = g.coordinates; mask = new Set(m.hidden); mesh = G.mesh(grid); hull = d3.Delaunay.from(grid).hullPolygon();
    }).catch((e) => { gridLoading = null; throw e; });
    return gridLoading;
  }
  /* the model field for a day: live = the Severe viewer's published, checksummed daily run; demo = invented values.
     null values are "no guidance" (masked), never zero. */
  function modelField(day) {
    if (isLive()) {
      const m = data.model;
      if (!m || m.state === "never") return { reason: "Loading our research model…" };
      if (m.state !== "ok") return { reason: "Research model unavailable (" + m.error + ")" };
      const r = m.runs[day];
      if (!r || !r.values) return { reason: r ? r.reason : "No Day " + day + " run" };
      return { grid: m.grid, hull: m.hull, values: r.values[S.hazard], run: r.run, version: r.version };
    }
    if (!grid) return { reason: "Loading our research model…" };
    return { grid, hull, values: Demo.modelValues(grid, day, S.hazard).map((v, i) => (mask.has(i) ? null : v)), demo: true };
  }
  const meshFor = (g) => { if (!meshes.has(g)) meshes.set(g, G.mesh(g)); return meshes.get(g); };
  function drawModel() {
    if (!ready) return;
    const day = viewDay(), f = day && S.model ? modelField(day) : null;
    if (!f || !f.values) { ["m-fill", "m-lines", "m-outside", "m-hull"].forEach((s) => map.getSource(s).setData(empty)); return; }
    const m = meshFor(f.grid);
    map.getSource("m-fill").setData(G.contours(m, f.values));
    map.getSource("m-lines").setData(G.isolines(m, f.values));
    if (f.hull) {
      map.getSource("m-outside").setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-140, 10], [-50, 10], [-50, 62], [-140, 62], [-140, 10]], f.hull.slice().reverse()] } });
      map.getSource("m-hull").setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: f.hull } });
    }
  }
  function modelAtVenue(day) {
    const f = modelField(day); if (!f.values) return { reason: f.reason };
    let best = -1, bd = Infinity;
    f.grid.forEach(([x, y], i) => { const d = Math.hypot((x - venue.lon) * Math.cos((venue.lat * Math.PI) / 180), y - venue.lat); if (d < bd) { bd = d; best = i; } });
    if (bd * 111 > 20 || f.values[best] == null) return { none: true, f };
    return { p: f.values[best], f };
  }

  /* ---------- panel ---------- */
  const lastKnown = (u) => `<span class="tx-flag">LAST CONFIRMED ${esc(t(u).toUpperCase())} · SOURCE NOT RESPONDING</span>`;
  function item(p, opts = {}) {
    const r = rel(p), u = unconfirmed(p);
    const when = p.kind === "outlook" ? "Day " + p.day + " · until " + t(p.validEnd, true) : p.expires == null ? "Valid time unavailable (NOAA map service)" : (u ? "Published expiration " : "Until ") + t(p.expires) + (u ? "" : " · " + T.untilText(p.expires, now));
    const title = p.kind === "outlook" ? olabel(p) : p.title;
    const showRel = opts.rel !== false && p.kind !== "outlook" && r.kind !== "none";
    return `<button type="button" class="tx-item${S.hover === p.id ? " hl" : ""}" data-id="${esc(p.id)}" style="--tx-c:${colorOf(p)}">${swatch(p)}<span>`
      + `<span class="tx-kind k-${p.kind}">${KIND_WORD[p.kind]}</span><b>${esc(title)}</b>`
      + `<span class="tx-meta">${esc(when)}</span>`
      + (showRel ? `<span class="tx-rel ${r.kind}">${esc(u ? "Last known: " + relText(p).charAt(0).toLowerCase() + relText(p).slice(1) : relText(p))}</span>` : "")
      + (p.geometrySource === "counties" ? `<span class="tx-meta">${esc(countyText(p))}</span>` : "")
      + (u ? lastKnown(u) : "") + (opts.tag ? `<span class="tx-tag">${esc(opts.tag)}</span>` : "")
      + `</span></button>`;
  }
  /* "20 counties and 3 marine zones"; with gaps, "18 of 20 counties and 3 of 3 marine zones" */
  function zoneCount(z, drawn) {
    const part = (n, d, one, many) => (n ? (drawn ? d + " of " : "") + n + " " + (n === 1 ? one : many) : "");
    return [part(z.counties.listed, z.counties.drawn, "county", "counties"), part(z.marine.listed, z.marine.drawn, "marine zone", "marine zones")].filter(Boolean).join(" and ");
  }
  const countyText = (p) => !p.zoneInfo || !p.zoneInfo.counties ? "Area: listed counties and marine zones (shapes loading)" : p.geometryIncomplete ? "Incomplete area: drawn from " + zoneCount(p.zoneInfo, true) : "Area drawn from " + zoneCount(p.zoneInfo, false);
  function sources() {
    const vd = viewDay() || 1;
    const rows = ["alerts", "md", "day" + vd, "ero" + vd].filter((k) => data.sources[k] && data.state[k]).map((k) => {
      const s = data.state[k], src = data.sources[k];
      const right = s.kind === "na" ? "Not part of this archived sample" : isArchive() ? "Archived official messages, replayed" : k === "md" && src.via === "service" && s.kind !== "stale" ? "Checked " + t(src.lastOk) + " via NOAA map service" + (s.kind === "empty" ? " · none active" : "") : s.kind === "loading" ? "Loading…" : s.kind === "unavailable" ? "Not responding · status unknown" : s.kind === "stale" ? "Last confirmed " + t(src.lastOk) : "Checked " + t(src.lastOk) + (k.startsWith("day") ? (src.outlook === "expired" ? " · expired, awaiting next issuance" : "") : s.kind === "empty" ? " · none active" : "");
      const name = official() && s.kind !== "na" ? `<a href="${esc(SRC_LINK[k])}" target="_blank" rel="noopener">${esc(SRC_NAME[k])}</a>` : esc(SRC_NAME[k]);
      return `<div class="px-src ${s.kind}"${src.error ? ` title="${esc(src.error)}"` : ""}><span><b>${name}</b></span><span>${esc(right)}</span></div>`;
    }).join("");
    const foot = isArchive() ? `Archived sample: ${esc(data.archive ? data.archive.label : "")}. Official messages replayed through the same adapter the live preview uses; the clock is set to the message time. Not a live observation. Times in ${esc(venue.tz)}.` : isLive() ? `Live official feeds, fetched by your browser. Alerts and MDs refresh every minute, outlooks every 10 minutes. Times in ${esc(venue.tz)}. A failed refresh never clears a product.` : `Demo clock ${esc(t(data.clock, true))}. A failed refresh never clears a product.`;
    return `<div class="px-sources" aria-label="Source status">${rows}<div class="lg-note">${foot}</div></div>`;
  }
  function notices() {
    const out = [];
    for (const k of ["alerts", "md"]) {
      const s = data.state[k];
      if (s.kind === "unavailable") out.push(`<div class="px-notice"><b>${esc(SRC_NAME[k])}: status unknown.</b> The source has not responded since this page opened, so we can't say whether any are active. Other sources are still shown.</div>`);
      else if (s.kind === "stale") out.push(`<div class="px-notice"><b>${esc(SRC_NAME[k])}: last confirmed ${esc(t(data.sources[k].lastOk))}.</b> The source is not responding. Products from the last good check stay on the map as "last known" until their published expiration.</div>`);
    }
    for (const p of data.ended || []) { const r = rel(p); if (!["covers", "near"].includes(r.kind)) continue;
      out.push(`<div class="px-notice info"><b>${esc(p.title)} ${p.endedBy === "cancelled" ? "cancelled by NWS" : p.endedBy === "no longer listed" ? "no longer listed by NWS" : p.endedBy === "upgraded" ? "replaced by a new product" : "ended"} at ${esc(t(p.ended || p.expires))}.</b> It ${r.kind === "covers" ? "covered" : "was near"} the venue.</div>`); }
    for (const o of [1, 2]) if (data.sources["day" + o].outlook === "expired") out.push(`<div class="px-notice"><b>SPC Day ${o} outlook expired at ${esc(t(data.sources["day" + o].validEnd))}.</b> It is no longer drawn; waiting for SPC's next issuance.</div>`);
    for (const p of lapsed()) out.push(`<div class="px-notice"><b>${esc(p.title)} reached its published expiration (${esc(t(p.expires))}).</b> It is no longer shown as active. We could not confirm it with NWS after ${esc(t(data.sources[SRC_OF(p)].lastOk))}, so current status, including any new warning, is unknown.</div>`);
    return out.join("");
  }

  /* Venue status lines, most urgent first: what is in effect AT the venue, then warnings nearby (with distance,
     direction and an explicit "the venue is outside"). MDs are mentioned, never presented as in effect. */
  function statusLines() {
    const covers = venueCovers(), near = venueNear().filter((p) => p.kind === "warning"), lines = [];
    for (const p of covers.filter((x) => x.kind === "warning" || x.kind === "watch")) {
      const u = unconfirmed(p);
      lines.push({ p, at: true, head: u ? `Last known: ${p.event} at the venue` : `${p.event} in effect at the venue`,
        sub: u ? `Last confirmed ${t(u)} · published expiration ${t(p.expires)}` : `Until ${t(p.expires)} · ${T.untilText(p.expires, now)}` });
    }
    for (const p of near) {
      const r = rel(p), u = unconfirmed(p);
      lines.push({ p, at: false, head: `${u ? "Last known: " : ""}${p.event} ${T.distanceText(r.km)} ${r.dir} of the venue`,
        sub: `The venue is outside the warning area · ${u ? "published expiration " : "until "}${t(p.expires)}` });
    }
    return lines;
  }
  function statusHTML(big) {
    const lines = statusLines(), mds = venueCovers().filter((p) => p.kind === "md");
    const lead = lines[0], hot = lines.find((l) => l.p.kind === "warning");
    let h = `<div class="px-brief${hot ? " hot" : ""}" style="--tx-c:${hot ? colorOf(hot.p) : "var(--line)"}"><div class="px-where">At ${esc(venue.name)}${venue.city ? " · " + esc(venue.city) : ""}</div>`;
    if (!lines.length) {
      const q = quietText(); h += `<div class="px-big">${esc(q.big)}</div><div class="px-sub">${esc(q.sub)}</div>`;
    }
    lines.forEach((l, i) => {
      const first = i === 0 && big && l.at && l.p.kind === "warning";
      h += `<button type="button" class="px-stat${l.p.kind === "warning" ? " w" : ""}${l.at ? "" : " near"}${first ? " big" : ""}" data-id="${esc(l.p.id)}" style="--tx-c:${colorOf(l.p)}">${swatch(l.p, 26)}<span><span class="px-stat-h">${esc(l.head)}</span><span class="px-stat-s">${esc(l.sub)}</span></span></button>`;
    });
    if (mds.length) h += `<div class="px-also">${mds.map((p) => esc(shortTitle(p)) + ": discussion area includes the venue").join(" · ")}</div>`;
    return h + `</div>`;
  }

  function laterButtons(pt) {
    return `<div class="px-later">` + [1, 2].map((d) => {
      const o = pt ? T.outlookAt(outlooks(d), pt) : T.highestOutlook(outlooks(d));
      const what = o ? `<span class="px-oc" style="background:${OUTLOOK_COLOR[o.category]}"></span>${esc(T.outlookLabel(o.category))}` : "No severe or thunder area";
      return `<button type="button" data-view-go="day${d}"><span><b>Day ${d}</b> · ${what}</span><span>${esc(o ? t(o.validStart, true).replace(/,.*$/, "") : "")} →</span></button>`;
    }).join("") + `</div>`;
  }
  function venueStrip() {
    const l = statusLines()[0];
    const text = l ? `<b>${esc(l.head)}</b> · ${esc(l.sub)}` : esc(quietText().big);
    return `<button type="button" class="px-strip${l && l.p.kind === "warning" ? " hot" : ""}" data-scope-go="venue" style="--tx-c:${l ? colorOf(l.p) : "var(--line)"}"><span class="px-where">At ${esc(venue.name)}</span><span class="px-strip-t">${text}</span><span class="px-strip-go">Venue view →</span></button>`;
  }
  function nationalActive() {
    const groups = T.group(active(), PLACES);
    let h = venueStrip() + notices() + `<div class="px-h"><span>Most urgent now</span><span>${groups.reduce((n, g) => n + g.items.length, 0)} active</span></div>`;
    if (!groups.length) h += `<p class="px-empty">${activeKnown() ? "No active tornado or severe thunderstorm warnings or watches, and no SPC Mesoscale Discussions, in the contiguous U.S." : (known("alerts") ? "No active tornado or severe thunderstorm warnings or watches in the contiguous U.S. (NWS checked " + esc(t(data.sources.alerts.lastOk)) + "). SPC Mesoscale Discussion status is unknown." : "None in the data we have, but NWS warnings and watches are not confirmed (see below).")}</p><p class="lg-note">${esc(SCOPE_NOTE)} Flood, winter and other hazards are not shown here yet.</p>`;
    for (const g of groups) {
      const o = T.outlookAt(outlooks(1), g.lead.label || g.centre);
      const counts = ["warning", "watch", "md"].map((k) => [k, g.items.filter((p) => p.kind === k).length]).filter(([, n]) => n).map(([k, n]) => n + " " + ({ warning: "warning", watch: "watch", md: "MD" }[k]) + (n > 1 ? (k === "watch" ? "es" : "s") : "")).join(" · ");
      h += `<div class="px-group"><div class="px-group-h">${esc(g.name)}<span>${esc(counts)}</span></div>${g.items.map((p) => item(p, { rel: false })).join("")}${o ? `<div class="px-group-f">Inside the Day 1 ${esc(T.outlookLabel(o.category).toLowerCase())} area</div>` : ""}</div>`;
    }
    h += `<div class="px-h">Forecast for later</div>` + laterButtons(null);
    return h;
  }
  function venueActive() {
    const list = T.sort(active()), covers = venueCovers(), near = venueNear(), unknown = list.filter((p) => rel(p).kind === "unknown");
    let h = statusHTML(true) + notices();
    if (covers.length) h += `<div class="px-h">At the venue</div>` + covers.map((p) => item(p)).join("");
    if (near.length) h += `<div class="px-h"><span>Nearby · the venue is outside these</span><span>within ${Math.round(T.miles(T.NEAR_KM))} mi</span></div>` + near.map((p) => item(p)).join("");
    if (unknown.length) h += `<div class="px-h">Area not drawn</div>` + unknown.map((p) => item(p)).join("");
    if (!covers.length && !near.length && activeKnown()) h += `<p class="lg-note">${esc(SCOPE_NOTE)}</p>`;
    h += `<div class="px-h">Later at the venue</div>` + laterButtons([venue.lon, venue.lat]);
    const elsewhere = list.filter((p) => !["covers", "near"].includes(rel(p).kind)).length;
    if (elsewhere) h += `<button type="button" class="px-link px-back" data-scope-go="national">See ${elsewhere} more active elsewhere →</button>`;
    return h;
  }
  /* outlook categories nest: the venue's headline is its highest category; lower ones sit in the details */
  const nestedBelow = (ol, at) => at ? ol.filter((o) => T.OUTLOOK.indexOf(o.category) < T.OUTLOOK.indexOf(at.category) && T.contains(o.geometry, [venue.lon, venue.lat])) : [];
  function dayPanel(day) {
    const ol = outlooks(day), top = T.highestOutlook(ol), st = data.state["day" + day];
    const at = T.outlookAt(ol, [venue.lon, venue.lat]), lower = nestedBelow(ol, at);
    let h = "";
    const sev = S.layers.severe;
    if (S.scope === "venue" && sev) {
      h += `<div class="px-brief"><div class="px-where">Day ${day} at ${esc(venue.name)} · highest SPC category</div><div class="px-big">${at ? esc(T.outlookLabel(at.category)) : "No severe risk area"}</div>`
        + `<div class="px-sub">${top ? "Valid " + esc(t(top.validStart, true)) + " → " + esc(t(top.validEnd, true)) : ""}</div>`;
      if (lower.length) h += `<div class="px-also">The venue is also inside the surrounding lower areas (${lower.map((o) => esc(T.OUTLOOK_NAME[o.category].toLowerCase())).join(", ")}). Details below.</div>`;
      if (S.model) {
        const m = modelAtVenue(day), hz = S.hazard === "wind" ? "severe wind" : S.hazard === "hail" ? "severe hail" : "tornado";
        h += m.reason ? `<div class="px-also">Our research model: ${esc(m.reason)}</div>`
          : `<div class="px-also">Our research model, ${esc(hz)} within 25 mi: <b style="color:var(--text)">${m.none ? "no guidance here (outside its coverage)" : m.p < 0.001 ? "below 0.1%" : (m.p * 100).toFixed(m.p < 0.1 ? 1 : 0) + "%"}</b> · experimental${m.f.demo ? ", demo values" : ""}${m.f.run ? `<br>Model window ${esc(t(m.f.run.valid_start, true))} → ${esc(t(m.f.run.valid_end, true))} · run ${esc(T.fmtZ(m.f.run.model_init_time))} · ${esc(m.f.version || "")}` : ""}</div>`;
      }
      h += `</div>`;
    } else if (S.scope !== "venue") {
      h += venueStrip();
      if (sev) h += `<div class="px-brief"><div class="px-where">Day ${day} · national</div><div class="px-big">${top ? "Highest: " + esc(T.OUTLOOK_NAME[top.category]) : "No severe risk"}</div><div class="px-sub">${top && T.OUTLOOK_LEVEL[top.category] ? esc(T.outlookLabel(top.category)) + " · " + esc(T.placeName(top.label, PLACES)) : top ? "General thunderstorms only" : ""}</div></div>`;
    }
    if (sev && st && (st.kind === "unavailable" || st.kind === "stale")) h += `<div class="px-notice"><b>${esc(SRC_NAME["day" + day])}</b> ${st.kind === "stale" ? "last confirmed " + esc(t(data.sources["day" + day].lastOk)) : "not responding"}.</div>`;
    const sorted = ol.slice().sort((a, b) => T.OUTLOOK.indexOf(b.category) - T.OUTLOOK.indexOf(a.category));
    if (S.layers.flood) {
      const eo = eroOut(day), eat = T.outlookAt(eo, [venue.lon, venue.lat]), es = data.state["ero" + day];
      h += `<div class="px-h"><span>Excessive rainfall · WPC</span><span>${eo[0] ? "issued " + esc(T.fmtZ(eo[0].issued)) : ""}</span></div>`;
      if (S.scope === "venue") h += `<p class="px-empty" style="padding-top:0">${eat ? `At the venue: <b style="color:var(--text)">${esc(olabel(eat))}</b> for the period ${esc(t(eat.validStart, true))} → ${esc(t(eat.validEnd, true))}. A risk for the whole period, not timing within it.` : es && ["current", "empty"].includes(es.kind) ? "No excessive rainfall area at the venue." : "Not confirmed: the WPC source is unavailable or its answer could not be confirmed."}</p>`;
      h += eo.length ? eo.slice().sort((a, b) => FX.ERO_CATS.indexOf(b.category) - FX.ERO_CATS.indexOf(a.category)).map((p) => item(p, { tag: S.scope === "venue" && eat && p.id === eat.id ? "Highest category at the venue" : "" })).join("") : `<p class="px-empty">${es && es.kind === "empty" ? "No excessive rainfall areas." : es && es.kind === "current" ? "" : "WPC outlook not confirmed (see sources below)."}</p>`;
      if (sev) h += `<div class="px-h">Severe storms · SPC</div>`;
    }
    if (sev) h += `<div class="px-h">Outlook areas</div>` + (sorted.length ? sorted.map((p) => item(p, { tag: S.scope === "venue" && at && p.id === at.id ? "Highest category at the venue" : "" })).join("") : `<p class="px-empty">No outlook areas.</p>`);
    const actW = active().filter((p) => p.kind === "warning");
    if (actW.length) h += `<div class="px-h">Active now</div><button type="button" class="tx-item" data-view-go="active" style="--tx-c:${colorOf(actW[0])}">${swatch(actW[0])}<span><b>${actW.length} active warning${actW.length > 1 ? "s" : ""}</b><span class="tx-meta">${day === 1 ? "Shown as dashed outlines, labelled Active now · " : "Not drawn on the Day 2 map · "}open Active now →</span></span></button>`;
    h += `<a class="px-link" href="severe.html#severe-daily">Open the regional Severe viewer →</a>`;
    return h;
  }
  function pointPanel() {
    const pt = S.point, day = viewDay();
    const list = T.sort((day ? [...(S.layers.severe ? outlooks(day) : []), ...(S.layers.flood ? eroOut(day) : [])] : [...active(), ...(S.layers.severe ? outlooks(1) : [])]).filter((p) => p.geometry && T.contains(p.geometry, pt)));
    let h = `<button type="button" class="px-back" data-back>← ${S.scope === "venue" ? "Venue" : "All threats"}</button>`;
    h += `<div class="px-h"><span>At this spot</span><span>${pt[1].toFixed(2)}°, ${pt[0].toFixed(2)}°</span></div>`;
    h += list.length ? list.map((p) => item(p, { rel: false })).join("") : `<p class="px-empty">No ${day ? "Day " + day + " outlook area" : "active product or Day 1 outlook area"} covers this spot.</p>`;
    return h;
  }
  function outlookVenueText(p) {
    const ol = (p.program === "ero" ? eroOut : outlooks)(p.day), at = T.outlookAt(ol, [venue.lon, venue.lat]);
    if (!T.contains(p.geometry, [venue.lon, venue.lat])) return relText(p);
    if (at && at.id === p.id) return "The venue is in this area; it is the highest category there";
    return "The venue is in a higher category of the same outlook (" + olabel(at) + ")";
  }
  function detail(p) {
    const ch = T.changes(p, (iso) => t(iso)), u = unconfirmed(p);
    const rows = [];
    if (p.hazard) rows.push(["Hazard", esc(p.hazard)]);
    rows.push(["Area", esc(p.kind === "outlook" ? olabel(p) + " area" : p.area)]);
    if (p.geometrySource === "counties") rows.push(["Area shape", esc(countyText(p)) + (p.geometryIncomplete ? "<br>Venue relationship is unknown where counties are missing." : "")]);
    rows.push(["Issued", esc(t(p.issued, true)) + ` <span class="mono" style="color:var(--muted)">${esc(T.fmtZ(p.issued))}</span>`]);
    if (p.updated && p.updated !== p.issued) rows.push(["Updated", esc(t(p.updated, true))]);
    if (p.detailsUnavailable) rows.push(["Details", "Unavailable: SPC's text page could not be reached, so this MD comes from the NOAA map service, which gives its outline" + (p.number ? " and number" : "") + " only. Use the SPC link below for the full discussion."]);
    if (p.kind === "md" && p.expires == null) rows.push(["Valid", "Unavailable"]);
    else if (p.kind === "outlook" || p.kind === "md") rows.push(["Valid", esc(t(p.validStart, true)) + " → " + esc(t(endOf(p), true)) + ` <span class="mono" style="color:var(--muted)">${esc(T.fmtZ(p.validStart))}–${esc(T.fmtZ(endOf(p)))}</span>`]);
    else rows.push([u ? "Published expiration" : "Expires", `<b>${esc(t(p.expires, true))}</b>${u ? "" : " · " + esc(T.untilText(p.expires, now))}`]);
    rows.push(["Venue", `<b>${esc(p.kind === "outlook" ? outlookVenueText(p) : relText(p))}</b> <span style="color:var(--muted)">(${esc(venue.name)})</span>`]);
    if (ch) rows.push(["What changed", `<span style="color:var(--muted)">Since ${esc(t(ch.since))}:</span><ul>${ch.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`]);
    if (p.viaService) rows.push(["Official bulletin", `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${p.number ? "SPC Mesoscale Discussion " + p.number : "SPC Mesoscale Discussions page"}</a>`]);
    if (u) rows.push(["Status", `${lastKnown(u)}<br>Shown as last known until its published expiration or a successful refresh.`]);
    rows.push(["Issued by", esc(p.office)]);
    rows.push(["Source", official() ? `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a>` : esc(p.source.name) + ` <span style="color:var(--muted)">· demo product, no live link</span>`]);
    const bulletin = p.bulletin || (isLive() && p.kind === "outlook" ? "SPC Day " + p.day + " Convective Outlook\nIssued " + T.fmtZ(p.issued) + " · valid " + T.fmtZ(p.validStart) + "–" + T.fmtZ(p.validEnd) + "\n\nRead the forecaster discussion: " + p.source.url : p.kind === "outlook" ? "Day " + p.day + " Convective Outlook\nNWS Storm Prediction Center Norman OK\n\n(DEMO: the outlook discussion text appears here in the beta.)" : p.event + "\n" + p.office + "\n\n(DEMO: the full bulletin text appears here in the beta.)");
    return `<button type="button" class="px-back" data-back>← Back</button>`
      + `<div style="--tx-c:${colorOf(p)}">${swatch(p, 40)} <span class="tx-kind k-${p.kind}">${KIND_WORD[p.kind]}</span></div>`
      + `<div class="px-title">${esc(p.kind === "outlook" ? (p.program === "ero" ? "WPC Day " : "SPC Day ") + p.day + " · " + olabel(p) : p.title)}</div>`
      + (p.headline ? `<p class="px-headline">${esc(p.headline)}</p>` : "")
      + `<dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`
      + (p.viaService ? "" : `<details class="px-bulletin"><summary>${p.kind === "outlook" ? "Read the outlook discussion" : "Read the official bulletin"}</summary><pre>${esc(bulletin)}</pre><div class="lg-note">${official() ? (p.kind === "outlook" ? "Full discussion on the SPC page linked above." : "Official text as received from " + (p.kind === "md" ? "SPC" : "NWS") + ".") : esc(Demo.BULLETIN_NOTE)}</div></details>`);
  }
  /* collapsed phone sheet: two lines so a warning's expiration always survives */
  function peek() {
    if (S.sel) { const p = byId(S.sel); return p ? [p.kind === "outlook" ? "Day " + p.day + " · " + olabel(p) : p.title, "Tap for details"] : ["", ""]; }
    if (viewDay()) { const o = T.outlookAt(outlooks(viewDay()), [venue.lon, venue.lat]); return ["Day " + viewDay() + " at " + venue.name, o ? "Highest: " + T.outlookLabel(o.category) : "No severe risk area"]; }
    const L = statusLines();
    if (!L.length) { const q = quietText(); return [q.big.replace("at the venue", "at " + venue.name), lapsed().length ? "A warning reached its expiration · NWS status unknown" : activeKnown() ? "NWS checked " + t(data.sources.alerts.lastOk) : known("alerts") ? "NWS checked " + t(data.sources.alerts.lastOk) + " · MD status unknown" : "NWS warnings not confirmed"]; }
    // line 1: what applies at the venue; line 2: its expiration (always kept); line 3: a nearby warning, if any
    const a = L[0], b = L.find((l, i) => i > 0 && l.p.kind === "warning");
    return [a.head.replace("at the venue", "at " + venue.name), a.sub, b ? b.head + (b.at ? "" : " · venue outside it") : ""];
  }
  function renderPanel() {
    const body = $("txPanelBody"), p = S.sel && byId(S.sel), keep = body.scrollTop, focusId = document.activeElement && body.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    if (data.loadError) { body.innerHTML = `<p class="px-empty">Could not load this archived sample (${esc(data.loadError)}).</p>`; return; }
    if (data.loading) { body.innerHTML = `<p class="px-empty">Loading official feeds: NWS warnings and watches, SPC Mesoscale Discussions and SPC outlooks…</p>` + sources(); $("txPeek1").textContent = "Loading official feeds…"; $("txPeek2").textContent = ""; return; }
    body.innerHTML = (p ? detail(p) : S.point ? pointPanel() : viewDay() ? dayPanel(viewDay()) : S.scope === "venue" ? venueActive() : nationalActive()) + sources();
    document.querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === S.scope)));
    $("scopeVenue").textContent = "Venue · " + venue.name;
    body.scrollTop = keep; if (focusId) { const el = body.querySelector(`[data-id="${CSS.escape(focusId)}"]`); if (el) el.focus({ preventScroll: true }); }
    const [a, b, c] = peek(), L = !S.sel && !viewDay() ? statusLines() : [];
    $("txPeek1").textContent = a; $("txPeek2").textContent = b; $("txPeek3").textContent = c || ""; $("txPeek3").hidden = !c; { const nw = L.find((l, i) => i > 0 && l.p.kind === "warning"); $("txPeek3").style.setProperty("--tx-near", nw ? colorOf(nw.p) : "transparent"); }
    $("txPeek").style.setProperty("--peek-c", L[0] && L[0].p.kind === "warning" ? colorOf(L[0].p) : L[0] ? colorOf(L[0].p) : "transparent");
  }

  /* ---------- top-of-map: valid time, model control, chips; legend ---------- */
  function renderTop() {
    document.querySelectorAll(".tx-tb").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === S.view)));
    document.querySelectorAll(".tx-lb").forEach((b) => b.setAttribute("aria-pressed", String(!!S.layers[b.dataset.layer])));
    const day = viewDay();
    if (!day) $("txValid").innerHTML = `<b>Active now</b> · as of ${esc(t(data.clock, true))}`;
    else {
      const o = outlooks(day)[0] || eroOut(day)[0];
      $("txValid").innerHTML = o ? `<b>Day ${day}</b> · ${esc(t(o.validStart, true))} → ${esc(t(o.validEnd, true))}<span class="z">${esc(T.fmtZ(o.validStart))}–${esc(T.fmtZ(o.validEnd))} · issued ${esc(T.fmtZ(o.issued))}</span>` : `<b>Day ${day}</b> · no outlook loaded`;
    }
    $("txModel").hidden = !day; $("modelChk").checked = S.model; $("modelHz").hidden = !S.model;
    document.querySelectorAll(".tx-hb").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hz === S.hazard)));
    const chips = [];
    const actW = active().filter((p) => p.kind === "warning");
    if (day && actW.length) chips.push(`<button type="button" class="tx-chip" data-view-go="active"><span class="k" style="color:${colorOf(actW[0])}">●</span>${actW.length} active warning${actW.length > 1 ? "s" : ""} · back to Active now</button>`);
    const bad = Object.keys(data.state).filter((k) => ["stale", "unavailable"].includes(data.state[k].kind));
    if (bad.length) chips.push(`<button type="button" class="tx-chip warn" data-sources>⚠ ${bad.length} source${bad.length > 1 ? "s" : ""} not responding</button>`);
    $("txChips").innerHTML = chips.join("");
    renderLegend();
  }
  function lgLine(p, text) { return `<div class="lg-row">${swatch(p, 28)}<span>${text}</span></div>`; }
  function renderLegend() {
    const day = viewDay(), fake = (kind, event) => ({ kind, event, category: event });
    let h = "";
    const dot = (tor) => `<svg width="28" height="20" aria-hidden="true"><circle cx="14" cy="10" r="${tor ? 7.5 : 5.5}" fill="${colorOf(fake("warning", tor ? "Tornado" : "Severe"))}" stroke="${pal().halo}" stroke-width="2"/>${tor ? `<circle cx="14" cy="10" r="2.6" fill="${pal().halo}"/>` : ""}</svg>`;
    if (!day) h += `<div><div class="lg-h">Active now · most urgent first</div>${lgLine(fake("warning", "Tornado"), "<b>Warning</b> · solid, filled")}${lgLine(fake("watch", "Tornado"), "<b>Watch</b> · dashed")}${lgLine(fake("md", ""), "<b>Mesoscale Discussion (MD)</b> · dotted")}<div class="lg-row">${dot(true)}<span>Tornado warning, zoomed out</span></div><div class="lg-row">${dot(false)}<span>Severe thunderstorm warning, zoomed out</span></div><div class="lg-note">Red, yellow: tornado · orange, pink: severe thunderstorm</div></div>`;
    else if (day === 1) h += `<div><div class="lg-h">Active now</div>${lgLine(fake("warning", "Tornado"), "Current warnings, dashed outline")}</div>`;
    if (day || S.ctx) h += `<div><div class="lg-h">SPC Day ${day || 1} outlook${day ? "" : " · outlines"}</div><div class="lg-bands">${T.OUTLOOK.map((c) => `<span class="lg-band" title="${esc(T.outlookLabel(c))}"><i style="background:${OUTLOOK_COLOR[c]}"></i>${c}${T.OUTLOOK_LEVEL[c] ? `<small>${T.OUTLOOK_LEVEL[c]}</small>` : ""}</span>`).join("")}</div><div class="lg-note">Risk level 1–5 · TSTM: thunderstorms, no severe risk</div></div>`;
    if (S.layers.flood) {
      if (!day) h += `<div><div class="lg-h">Flooding · active now</div>${lgLine({ kind: "warning", family: "flood", event: "Flash Flood Warning" }, "<b>Flash Flood Warning</b> · solid, filled")}</div>`;
      else h += `<div><div class="lg-h">WPC excessive rainfall · Day ${day}${S.layers.severe ? " · dashed" : ""}</div><div class="lg-bands">${FX.ERO_CATS.map((c, i) => `<span class="lg-band" title="${esc(FX.ERO_NAME[c])}"><i style="background:${ERO_COLOR[c]}"></i>${c}<small>${i + 1}</small></span>`).join("")}</div><div class="lg-note">Chance rainfall exceeds flash flood guidance within 25 mi: 1 at least 5% · 2 15% · 3 40% · 4 70%</div></div>`;
    }
    if (!day) h += `<label class="lg-toggle"><input type="checkbox" id="ctxChk"${S.ctx ? " checked" : ""}> Day 1 outlook outlines</label>`;
    if (day && S.model) h += `<div><div class="lg-h">Our research model · ${esc(S.hazard)} within 25 mi</div><div class="lg-bands">${G.BANDS.map(([, c, l]) => `<span class="lg-band"><i style="background:${c}"></i>${l}</span>`).join("")}</div><div class="lg-note">Experimental Forecast Ops guidance, not an official forecast${isLive() ? "" : ". Demo values"}. Uncolored: below 0.1% (low). Light hatching: no model guidance (outside its grid or over water), not a low value.</div>${(() => { const f = modelField(day); return f.values ? "" : `<div class="lg-note"><b>${esc(f.reason)}</b></div>`; })()}</div>`;
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
  const venueCamera = () => ({ center: [venue.lon, venue.lat], zoom: phone() ? 7.4 : 8, padding: pad() });
  function setScope(scope, move) {
    S.scope = scope; S.sel = null; S.point = null;
    drawAll();
    if (move && map) {
      if (scope === "venue") map.flyTo({ ...venueCamera(), duration: 600 });
      else map.fitBounds(CONUS, { padding: pad(), duration: 600 });
    }
  }
  function startModel() {
    if (!S.model || !viewDay()) return;
    if (isLive()) Live.startModel().then(() => { load(); drawAll(); });
    else loadGrid().then(drawAll).catch(() => { $("txValid").insertAdjacentHTML("beforeend", " · research model unavailable"); });
  }
  function setView(v) { S.view = v; S.sel = null; S.point = null; startModel(); drawAll(); }
  function setSheet(state) {
    S.sheet = state; $("txPanel").dataset.sheet = state;
    $("txSheetBtn").setAttribute("aria-expanded", String(state === "open")); $("txSheetBtn").textContent = state === "open" ? "Close" : "Details";
    sheetVar();
    // keep the venue pin above the sheet
    if (map && S.scope === "venue" && phone()) requestAnimationFrame(() => map.easeTo({ center: [venue.lon, venue.lat], padding: pad(), duration: 300 }));
  }
  function openSheet() { if (phone() && S.sheet !== "open") setSheet("open"); }
  function sheetVar() { const h = phone() ? $("txPanel").getBoundingClientRect().height : 0; $("tx").style.setProperty("--sheet-h", h + "px"); }

  $("txPanel").addEventListener("click", (e) => {
    const it = e.target.closest("[data-id]"), sg = e.target.closest("[data-scope-go]"), vg = e.target.closest("[data-view-go]"), back = e.target.closest("[data-back]");
    if (it) { S.sel = it.dataset.id; S.hover = null; openSheet(); drawAll(); fitProduct(byId(S.sel)); $("txPanelBody").scrollTop = 0; $("txPanelBody").focus({ preventScroll: true }); return; }
    if (sg) { openSheet(); return setScope(sg.dataset.scopeGo, true); }
    if (vg) return setView(vg.dataset.viewGo);
    if (back) { if (S.sel) S.sel = null; else S.point = null; drawAll(); }
  });
  const hoverOn = (e) => { const it = e.target.closest("[data-id]"); const id = it ? it.dataset.id : null; if (id !== S.hover) { S.hover = id; drawMap(); } };
  $("txPanel").addEventListener("mouseover", hoverOn); $("txPanel").addEventListener("focusin", hoverOn);
  $("txPanel").addEventListener("mouseleave", () => { if (S.hover) { S.hover = null; drawMap(); } });
  document.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.scope, true)));
  document.querySelectorAll(".tx-tb").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  document.querySelectorAll(".tx-lb").forEach((b) => b.addEventListener("click", () => { S.layers[b.dataset.layer] = !S.layers[b.dataset.layer]; if (!S.layers.severe && !S.layers.flood) S.layers[b.dataset.layer === "severe" ? "flood" : "severe"] = true; S.sel = null; drawAll(); }));
  $("modelChk").addEventListener("change", () => { S.model = $("modelChk").checked; startModel(); drawAll(); });
  document.querySelectorAll(".tx-hb").forEach((b) => b.addEventListener("click", () => { S.hazard = b.dataset.hz; drawAll(); }));
  $("txChips").addEventListener("click", (e) => { const v = e.target.closest("[data-view-go]"); if (v) setView(v.dataset.viewGo); if (e.target.closest("[data-sources]")) { S.sel = null; S.point = null; openSheet(); drawAll(); const s = document.querySelector(".px-sources"); if (s) s.scrollIntoView({ block: "nearest" }); } });
  $("txSheetBtn").addEventListener("click", () => setSheet(S.sheet === "open" ? "peek" : "open"));
  $("txPeek").addEventListener("click", () => setSheet("open"));
  /* top bar: live preview vs fictional demo, and the matching venue choices */
  function renderBar() {
    const live = isLive(), arc = isArchive();
    $("txBadge").textContent = live ? "LIVE PREVIEW" : arc ? "ARCHIVED SAMPLE" : "DEMO DATA"; $("txBadge").classList.toggle("live", live); $("txBadge").classList.toggle("arc", arc);
    $("txDemo").classList.toggle("live", live); $("txDemo").classList.toggle("arc", arc);
    $("txBarText").textContent = live ? "Branch preview of official NWS and SPC feeds. Not for operational decisions." : arc ? "Real official messages replayed through the live adapter, at their own time. Not a live observation." : "Fictional products for layout review. Nothing here was issued by NWS or SPC.";
    $("stepField").hidden = !arc || !(data && data.archive && data.archive.messages.length);
    if (arc && data && data.archive) { $("demoStep").innerHTML = data.archive.messages.map((m, i) => `<option value="${i + 1}">Msg ${i + 1}/${data.archive.steps} · ${esc(m.action || "")} · ${esc(T.fmtTime(m.sent, venue.tz))}</option>`).join(""); $("demoStep").value = String(data.archive.step); }
    const opts = arc ? ARCHIVE_VENUES[S.scenario].map((v) => ({ id: v.id, label: v.label })) : live ? [...(S.entryVenue ? [{ id: "entry", label: "Linked venue: " + S.entryVenue.name }] : []), ...liveVenues()] : [{ id: "inside", label: "Inside the warning" }, { id: "edge", label: "Near the warning edge" }, { id: "outside", label: "Outside the warning" }];
    $("demoVenue").innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");
    $("demoVenue").value = arc ? (S.archiveVenue || ARCHIVE_VENUES[S.scenario][0].id) : live ? (S.entryVenue ? "entry" : S.liveVenue) : S.venueKey;
    $("demoScenario").value = S.scenario;
    const sub = document.querySelector(".statusbar .page-sub"); if (sub) sub.textContent = live ? "Preview · severe weather · live official feeds" : arc ? "Preview · severe weather · archived official sample" : "Preview · severe weather · demo data";
    O.setChip(live ? "LIVE PREVIEW" : arc ? "ARCHIVED SAMPLE" : "DEMO DATA", live ? "live" : "warn", live ? "Official feeds, branch preview" : "Fictional products for layout review");
  }
  $("demoScenario").addEventListener("change", () => {
    S.scenario = $("demoScenario").value; S.sel = null; S.point = null; S.step = null; S.archiveVenue = null;
    if (isLive()) Live.start().then(() => { liveReady = true; load(); drawAll(); });
    renderBar(); load(); startModel(); drawAll();
  });
  $("demoVenue").addEventListener("change", () => {
    const v = $("demoVenue").value;
    if (isArchive()) S.archiveVenue = v; else if (isLive()) { if (v !== "entry") { S.entryVenue = null; S.liveVenue = v; } } else { S.venueKey = v; S.entryVenue = null; }
    S.sel = null; S.point = null; load(); renderBar(); drawAll(); if (S.scope === "venue" && map) map.easeTo({ center: [venue.lon, venue.lat], padding: pad(), duration: 400 });
  });
  $("demoStep").addEventListener("change", () => { S.step = +$("demoStep").value; S.sel = null; S.point = null; load(); renderBar(); drawAll(); });
  function fitArchive() {
    if (!map || !ready || !isArchive() || S.fitted === S.scenario) return; S.fitted = S.scenario;
    if (S.scope === "venue") { map.jumpTo(venueCamera()); return; }
    const p = data.products.find((x) => x.geometry); if (p) { const b = T.bbox(p.geometry); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 8.5, duration: 0 }); }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (S.sel || S.point) { S.sel = null; S.point = null; drawAll(); $("txPanelBody").focus({ preventScroll: true }); }
    else if (phone() && S.sheet === "open") setSheet("peek");
  });
  window.addEventListener("ops:theme", () => {
    if (!ready) return; const c = pal();
    map.setPaintProperty("bg", "background-color", c.land); map.setPaintProperty("lakes", "fill-color", c.water); map.setPaintProperty("states", "line-color", c.line);
    map.setPaintProperty("cities", "text-color", c.muted); map.setPaintProperty("cities", "text-halo-color", c.halo); map.setPaintProperty("warn-case", "line-color", c.halo);
    map.setPaintProperty("ring", "line-color", c.text); map.setPaintProperty("hl", "line-color", c.text); map.setPaintProperty("m-hull", "line-color", c.muted); map.setPaintProperty("pt", "circle-stroke-color", c.text);
    map.setPaintProperty("warn-dot", "circle-stroke-color", c.halo); map.setPaintProperty("warn-dot-core", "circle-color", c.halo);
    map.removeImage("hatch"); map.addImage("hatch", hatch(), { pixelRatio: 2 });
    drawAll();
  });

  /* phone: this page only gets a compact header; the tool navigation sits behind a Menu button */
  (function compactHeader() {
    const util = document.querySelector(".statusbar .utility"), nav = document.querySelector(".navbar");
    if (!util || !nav) return;
    nav.id = nav.id || "txNav";
    const b = document.createElement("button"); b.type = "button"; b.className = "chip noprint tx-menu"; b.id = "txMenuBtn"; b.textContent = "MENU";
    b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", nav.id);
    b.addEventListener("click", () => { const open = !document.body.classList.contains("tx-nav-open"); document.body.classList.toggle("tx-nav-open", open); b.setAttribute("aria-expanded", String(open)); measure(); });
    util.prepend(b);
  })();
  function measure() { const top = $("tx").getBoundingClientRect().top + window.scrollY; document.body.style.setProperty("--tx-top", Math.round(top) + "px"); if (map) map.resize(); sheetVar(); }
  window.addEventListener("resize", measure);

  /* Entry context. Direct entry opens National. A link that names a venue (a future Event Manager link:
     ?lat=..&lon=..&name=..[&tz=..]) opens Venue centred there. Review links: ?scenario= ?venue= ?view= ?scope= ?model=1 ?sel= ?sheet= */
  try {
    const q = new URLSearchParams(location.search);
    if (["live", "overlap", "multi", "quiet", "unavailable", "outage-expired", "archive-lox", "archive-mtr", "archive-ww705", "archive-flood-day", "archive-flood-afternoon", "archive-flood-night"].includes(q.get("scenario"))) S.scenario = q.get("scenario");
    if (["inside", "edge", "outside"].includes(q.get("venue"))) S.venueKey = q.get("venue");
    const lat = parseFloat(q.get("lat")), lon = parseFloat(q.get("lon"));
    if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      S.entryVenue = { id: "entry", name: ((n) => n.length <= 80 ? n : n.slice(0, 79).replace(/\s+\S*$/, "") + "…")((q.get("name") || "Event venue").trim()), city: q.get("city") || "", lat, lon, tz: q.get("tz") || "America/New_York" };
      S.scope = "venue";
    }
    if (["active", "day1", "day2", "day3"].includes(q.get("view"))) S.view = q.get("view");
    if (q.get("layers")) { const L = q.get("layers").split(","); S.layers = { severe: L.includes("severe"), flood: L.includes("flood") }; }
    if (["national", "venue"].includes(q.get("scope"))) S.scope = q.get("scope");
    if (q.get("model") === "1") S.model = true;
    if (["tornado", "wind", "hail"].includes(q.get("hazard"))) S.hazard = q.get("hazard");
    if (q.get("sel")) S.sel = q.get("sel");
    if (q.get("step")) S.step = +q.get("step") || null;
    if (q.get("avenue")) S.archiveVenue = q.get("avenue");
    S.sheet = q.get("sheet") === "open" ? "open" : q.get("sheet") === "peek" ? "peek" : null;
  } catch (e) { /* no URL state */ }
  renderBar();
  if (!phone()) $("txLegend").open = false; // desktop: legend starts collapsed so it never covers the map
  load(); measure(); renderTop(); renderPanel();
  if (isLive()) Live.start().then(() => { liveReady = true; load(); drawAll(); });
  // live: redraw on every feed update, and every 30 s so countdowns, expirations and staleness stay true
  Live.onUpdate(() => { if (isLive() && liveReady) { load(); drawAll(); } });
  setInterval(() => { if (isLive() && liveReady) { load(); drawAll(); } }, 30e3);
  startModel();
  setSheet(phone() ? (S.sheet || "peek") : "open");
  createMap().then(() => {
    map.once("load", () => {
      if (S.sel && byId(S.sel) && byId(S.sel).geometry) { const b = T.bbox(byId(S.sel).geometry); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 9, duration: 0 }); }
      else if (isArchive()) fitArchive();
      else if (S.scope === "venue") map.jumpTo(venueCamera());
      else map.fitBounds(CONUS, { padding: pad(), duration: 0 });
    });
  }).catch((e) => { $("txMap").innerHTML = `<p class="msg" style="padding:20px">The map could not load (${esc(e.message)}). The threat list still works.</p>`; });
  window.__threats = { S, drawAll, get map() { return map; }, get ready() { return ready; }, get liveReady() { return liveReady; }, get data() { return data; }, diag: Live.diag };
})();
