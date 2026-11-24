/* Weather threats page (preview). Official products and our research model on one map:
   warnings > watches > Mesoscale Discussions > outlooks, each with its own line style, label and legend.
   This preview runs on DEMO fixtures only (assets/threats-demo.js); live feeds come after the layout is approved. */
(function () {
  "use strict";
  const O = window.Ops, T = window.ThreatsCore, Demo = window.ThreatsDemo, G = window.SevereResearchContours, Live = window.ThreatsLive;
  const $ = (id) => document.getElementById(id), esc = O.esc;
  O.shell("threats", "Weather threats", { forecastPoint: false, subtitle: "Preview · weather threats" });

  const CITIES = [["Seattle", 47.61, -122.33], ["Portland", 45.52, -122.68], ["San Francisco", 37.77, -122.42], ["Los Angeles", 34.05, -118.24], ["Las Vegas", 36.17, -115.14], ["Phoenix", 33.45, -112.07], ["Salt Lake City", 40.76, -111.89], ["Denver", 39.74, -104.99], ["Albuquerque", 35.08, -106.65], ["Dallas", 32.78, -96.80], ["Houston", 29.76, -95.37], ["San Antonio", 29.42, -98.49], ["Oklahoma City", 35.47, -97.52], ["Kansas City", 39.10, -94.58], ["Omaha", 41.26, -95.93], ["Des Moines", 41.59, -93.62], ["Minneapolis", 44.98, -93.27], ["Chicago", 41.88, -87.63], ["St. Louis", 38.63, -90.20], ["Memphis", 35.15, -90.05], ["Tupelo", 34.26, -88.70], ["New Orleans", 29.95, -90.07], ["Nashville", 36.16, -86.78], ["Huntsville", 34.73, -86.59], ["Louisville", 38.25, -85.76], ["Indianapolis", 39.77, -86.16], ["Cincinnati", 39.10, -84.51], ["Columbus", 39.96, -83.00], ["Dayton", 39.76, -84.19], ["Lexington", 38.04, -84.50], ["Detroit", 42.33, -83.05], ["Cleveland", 41.50, -81.69], ["Pittsburgh", 40.44, -80.00], ["Charleston WV", 38.35, -81.63], ["Atlanta", 33.75, -84.39], ["Birmingham", 33.52, -86.80], ["Jackson", 32.30, -90.18], ["Charlotte", 35.23, -80.84], ["Raleigh", 35.78, -78.64], ["Washington", 38.90, -77.04], ["Philadelphia", 39.95, -75.17], ["New York", 40.71, -74.01], ["Boston", 42.36, -71.06], ["Jacksonville", 30.33, -81.66], ["Tampa", 27.95, -82.46], ["Miami", 25.76, -80.19]];
  const ST = { Cincinnati: "OH", Louisville: "KY", Dayton: "OH", Tupelo: "MS", Huntsville: "AL", Birmingham: "AL", Dallas: "TX", "Des Moines": "IA", Memphis: "TN", Nashville: "TN", "Oklahoma City": "OK" };
  const PLACES = CITIES.map(([name, lat, lon]) => ({ name: name + (ST[name] ? ", " + ST[name] : ""), lat, lon }));
  const CONUS = [[-124.8, 24.6], [-66.9, 49.4]];
  const ERO_COLOR = { MRGL: "#8BD28B", SLGT: "#F2D45C", MDT: "#EE7466", HIGH: "#D36AD6" }; // WPC's own colour order
  const FX = window.ThreatsFeeds;
  /* outlook names: SPC "Enhanced risk (3 of 5)"; WPC "High excessive rainfall risk (4 of 4)" */
  const olabel = (p) => /^spcfire-/.test(p.program || "") ? (p.day >= 3 ? (p.category === "CRIT" ? "Critical fire weather area" : FX.FIRE_NAME[p.category] + " chance of critical " + (p.part === "dryt" ? "dry thunderstorms" : "fire weather")) : FX.FIRE_NAME[p.category] + (p.part === "dryt" ? "" : " fire weather")) : p.program === "ero" ? FX.ERO_NAME[p.category] + " excessive rainfall risk (" + (FX.ERO_CATS.indexOf(p.category) + 1) + " of 4)" : T.outlookLabel(p.category);
  const OUTLOOK_COLOR = { TSTM: "#C1E9C1", MRGL: "#66A366", SLGT: "#F6E05E", ENH: "#FFA05C", MDT: "#E06666", HIGH: "#EE99EE" };
  const SCOPE_NOTE = "This page covers NWS warnings, watches and advisories for the hazards on in Layers, with SPC and WPC outlooks and the other sources listed below.";
  /* WPC WSSI-P: probability of at least the chosen impact level in a 24-hour window (5–95%) */
  const WSSI_PROBS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95];
  const WSSI_COLOR = { 5: "#E3EEF9", 10: "#C6DBEF", 20: "#9ECAE1", 30: "#6BAED6", 40: "#4292C6", 50: "#2171B5", 60: "#6A51A3", 70: "#807DBA", 80: "#9E3E9E", 90: "#C51B8A", 95: "#7A0177" };
  const wssiColor = (p) => WSSI_COLOR[WSSI_PROBS.filter((x) => x <= p).pop() || 5];
  /* SPC fire weather outlook colours (SPC's own order: elevated tan, critical red, extremely critical magenta; dry
     thunderstorms brown/red) and NIFC incident colours */
  const FIRE_COLOR = { ELEV: "#E8A33D", CRIT: "#E0412C", EXTM: "#C2178F", IDRT: "#A87A4B", SDRT: "#D2402A", P40: "#E8A33D", P70: "#E0412C" };
  /* NWS hazard colours for tropical and coastal products; NHC graphics */
  const TROP_COLOR = { "Hurricane Warning": "#DC143C", "Hurricane Watch": "#FF00FF", "Tropical Storm Warning": "#B22222", "Tropical Storm Watch": "#F08080", "Storm Surge Warning": "#B524F7", "Storm Surge Watch": "#DB7FF7" };
  const COAST_COLOR = { "Coastal Flood Warning": "#228B22", "Coastal Flood Watch": "#66CDAA", "Coastal Flood Advisory": "#7CFC00", "High Surf Warning": "#228B22", "High Surf Advisory": "#BA55D3", "Rip Current Statement": "#40E0D0", "Beach Hazards Statement": "#40E0D0" };
  const FLT_COLOR = { VFR: "#3fb950", MVFR: "#4c8dff", IFR: "#f85149", LIFR: "#d24ce0" }; // AWC's own flight-category colours
  const TWO_COLOR = { Low: "#F2D45C", Medium: "#F59E3B", High: "#E5484D" };
  const HMS_FILL = { Light: ["#B9B2A6", 0.22], Medium: ["#8E8576", 0.32], Heavy: ["#5F5547", 0.45] };
  const AQI_COLOR = { Good: "#00E400", Moderate: "#FFFF00", "Unhealthy for Sensitive Groups": "#FF7E00", Unhealthy: "#FF0000", "Very Unhealthy": "#8F3F97", Hazardous: "#7E0023" }; // EPA's AQI colours
  const INC_COLOR = { WF: "#FF5A1F", CX: "#FF5A1F", RX: "#9C8F80" };
  const WLEVEL_LABEL = { WWA: "Any winter weather", MINOR: "Minor", MODERATE: "Moderate", MAJOR: "Major", EXTREME: "Extreme" };
  const empty = { type: "FeatureCollection", features: [] };

  const S = { air: [], ap: null, layers: { severe: false, flood: false, winter: false, heat: false, wind: false, fire: false, smoke: false, tropical: false, coastal: false, aviation: false }, en: { on: false, at: 0, alt: null, age: 2 }, av: { apt: true, pireps: true, adv: true }, gtg: { on: false, fh: 0, ft: 30000, cls: "medium" }, ifi: { on: false, field: "prob", src: null, cyc: null }, route: null, fit: null, rx: false, fday: 1, wlevel: "MINOR", wwin: null, radar: false, pin: true, counties: true, scenario: "live", venueKey: "inside", liveVenue: "fp", entryVenue: null, view: "active", scope: "national", sel: null, hover: null, point: null, model: false, hazard: "tornado", ctx: true, sheet: "open" };
  let framedAp = false, framedSel = false, mapLoaded = false; // Planner airport "View on map": framed once
  let data, now, venue, map, ready = false, liveReady = false, meshes = new Map(), tzCache = {}, marker, grid = null, mesh = null, mask = null, gridLoading = null, hull = null;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const light = () => document.documentElement.getAttribute("data-theme") === "light";

  /* ---------- colors: NWS-style product colors, darkened in light mode so lines keep contrast ---------- */
  function pal() {
    const L = light();
    return { land: L ? "#f1f2ee" : "#151a22", line: L ? "#4a525e" : "#aeb6c2", water: L ? "#dfe9f5" : "#18293a", text: L ? "#172438" : "#e7ecf3", halo: L ? "#ffffff" : "#0d1117", muted: L ? "#5b6472" : "#8a94a6",
      ffw: L ? "#0B7A4B" : "#2FD08A", wsw: L ? "#C2187A" : "#FF69B4", bzw: L ? "#C23A00" : "#FF6A33", isw: L ? "#7A0F86" : "#D36AE0", lew: L ? "#00706F" : "#22C7C7", wsa: L ? "#2F5F9E" : "#7FB2E5", wwy: L ? "#5141B8" : "#A497FF", rfw: L ? "#C2186B" : "#FF3D9A", fww: L ? "#8A5A00" : "#F5C97A", torW: L ? "#C8102E" : "#FF4040", svrW: L ? "#B85400" : "#FFA024", torA: L ? "#8F7200" : "#FFE14D", svrA: L ? "#A23A68" : "#F28DB8", md: L ? "#1D5FD1" : "#5FB0FF" };
  }
  const isTor = (p) => /tornado/i.test(p.event || "");
  const LSR_COLOR = { tornado: "#e0262b", wind: "#2f6fe0", hail: "#2fa84f" };
  /* NOAA river gauges by flood category (NWPS colours); grey when no stages are set or the data isn't current */
  const GAUGE_COLOR = { no_flooding: "#3aa757", action: "#ffd400", minor: "#ff8c00", moderate: "#e0262b", major: "#b000b5" };
  function colorOf(p) {
    const c = pal();
    if (p.kind === "lsr") return LSR_COLOR[p.type] || "#888";
    if (p.kind === "gauge") return GAUGE_COLOR[p.category] || "#8a8f98";
    if (p.family === "tropical" && TROP_COLOR[p.event]) return TROP_COLOR[p.event];
    if (p.family === "coastal" && COAST_COLOR[p.event]) return COAST_COLOR[p.event];
    if (p.family === "heat") return /Heat/.test(p.event) ? (/Warning/.test(p.event) ? "#c8102e" : /Watch/.test(p.event) ? "#a0522d" : "#ff7f50") : /Freeze|Frost/.test(p.event) ? (/Warning/.test(p.event) ? "#483d8b" : "#6495ed") : /Warning/.test(p.event) ? "#0050b3" : /Watch/.test(p.event) ? "#5f9ea0" : "#7fa7d6";
    if (p.family === "wind") return /Fog|Smoke/.test(p.event) ? "#8a8f98" : /Dust/.test(p.event) ? "#bd8b3a" : /Extreme Wind/.test(p.event) ? "#ff0090" : /Warning/.test(p.event) ? "#b8860b" : /Watch/.test(p.event) ? "#a08850" : "#d2b48c";
    if (p.kind === "metar" || p.kind === "taf") return FLT_COLOR[p.category || (p.periods && p.periods[0] && p.periods[0].category)] || "#9aa3ad";
    if (p.kind === "tcoutlook") return TWO_COLOR[p.category] || TWO_COLOR.Low;
    if (p.kind === "tctrack") return p.part === "watchwarning" ? TROP_COLOR[p.category] || "#DC143C" : light() ? "#333" : "#f2f2f2";
    if (p.kind === "smoke") return HMS_FILL[p.density][0];
    if (p.kind === "aqobs" || p.kind === "aqfcst") return AQI_COLOR[p.category] || "#999";
    if (p.kind === "smokefcst") return "#8E8576";
    if (p.kind === "incident") return INC_COLOR[p.category] || INC_COLOR.WF;
    if (p.program && /^spcfire-/.test(p.program)) return FIRE_COLOR[p.category];
    if (p.family === "fire") return p.kind === "watch" ? c.fww : c.rfw;
    if (p.family === "winter") return /blizzard/i.test(p.event) ? c.bzw : /ice storm/i.test(p.event) ? c.isw : /lake effect/i.test(p.event) ? c.lew : p.kind === "watch" ? c.wsa : p.kind === "advisory" ? c.wwy : c.wsw;
    if (p.kind === "warning") return p.family === "flood" ? c.ffw : isTor(p) ? c.torW : c.svrW;
    if (p.kind === "outlook" && p.program === "ero") return ERO_COLOR[p.category];
    if (p.kind === "watch") return isTor(p) ? c.torA : c.svrA;
    if (p.kind === "md") return c.md;
    return OUTLOOK_COLOR[p.category];
  }
  const KIND_WORD = { metar: "METAR", taf: "TAF", statement: "STATEMENT", tcoutlook: "NHC OUTLOOK", tctrack: "NHC", incident: "WILDFIRE", warning: "WARNING", watch: "WATCH", advisory: "ADVISORY", md: "MD", outlook: "OUTLOOK" };
  /* a small line sample matching the map style, so the list and the map read the same way without color */
  function swatch(p, w = 30) {
    const c = colorOf(p);
    if (p.kind === "gauge") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><circle cx="${w / 2}" cy="8" r="5" fill="${GAUGE_COLOR[p.category] ? c : "none"}" stroke="${GAUGE_COLOR[p.category] ? "#fff" : "#8a8f98"}" stroke-width="1.4"/></svg>`;
    if (p.kind === "lsr") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true">${p.type === "tornado" ? `<path d="M${w / 2} 2 L${w / 2 + 6} 14 L${w / 2 - 6} 14 Z" fill="${c}" stroke="#111" stroke-width="1"/>` : `<circle cx="${w / 2}" cy="8" r="5" fill="${c}" stroke="#111" stroke-width="1"/>`}</svg>`;
    if (p.kind === "warning") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="3"/></svg>`;
    if (p.kind === "incident") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="2"/><circle cx="${w / 2}" cy="8" r="3.4" fill="${c}" stroke="${pal().halo}" stroke-width="1.2"/></svg>`;
    if (p.kind === "advisory" || p.kind === "statement") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="2"/></svg>`;
    if (p.kind === "watch") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="2.2" stroke-dasharray="5 3"/></svg>`;
    if (p.kind === "md") return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="none" stroke="${c}" stroke-width="2.6" stroke-dasharray=".1 4.2" stroke-linecap="round"/></svg>`;
    return `<svg class="tx-sw" width="${w}" height="16" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="12" rx="2" fill="${c}" fill-opacity=".75" stroke="${c}" stroke-width="1"/></svg>`;
  }

  /* ---------- data ---------- */
  const SRC_OF = (p) => p.kind === "gauge" ? "gauges" : p.kind === "lsr" ? "reports" : ["warning", "watch", "advisory", "statement"].includes(p.kind) ? "alerts" : ["tcoutlook", "tctrack", "tcwind"].includes(p.kind) ? "nhc" : p.kind === "metar" || p.kind === "taf" ? "awc" : ["pirep", "sigmet", "gairmet", "cwa"].includes(p.kind) ? "enroute" : p.kind === "faa" ? "faa" : p.kind === "incident" ? "nifc" : p.kind === "smoke" ? "hms" : p.kind === "aqobs" ? "aqobs" : p.kind === "aqfcst" ? "aqfcst" : p.kind === "smokefcst" ? "naqfc" : p.kind === "md" ? "md" : p.program === "wssip" ? "wssip" : /^spcfire-/.test(p.program || "") ? "fire" + p.day : (p.program === "ero" ? "ero" : "day") + p.day;
  // minutes since the last successful check before a source counts as stale (outlooks change a few times a day)
  const STALE_MIN = { gauges: 60, reports: 20, awc: 20, nhc: 60, hms: 180, aqobs: 120, aqfcst: 180, naqfc: 360, monitors: 120, nifc: 20, fire1: 60, fire2: 60, fire3: 180, fire4: 180, fire5: 180, fire6: 180, fire7: 180, fire8: 180, wssip: 60, alerts: 10, md: 15, day1: 60, day2: 60, day3: 60, ero1: 60, ero2: 60, ero3: 60 };
  const SRC_NAME = { gauges: "NOAA river gauges (in view)", reports: "SPC storm reports (preliminary, last 24 h)", enroute: "Aviation Weather Center en route (pilot reports, SIGMETs, G-AIRMETs, CWAs)", faa: "FAA airport status", awc: "Aviation Weather Center (METAR, TAF)", nhc: "NHC tropical outlooks and storms", hms: "NOAA satellite smoke (HMS)", aqobs: "AirNow observations near the venue", aqfcst: "AirNow forecast (venue's area)", naqfc: "NOAA smoke guidance (NAQFC)", monitors: "AirNow monitors (map)", nifc: "NIFC wildfire incidents (WFIGS)", fire1: "SPC fire weather · Day 1", fire2: "SPC fire weather · Day 2", fire3: "SPC fire weather · Day 3", fire4: "SPC fire weather · Day 4", fire5: "SPC fire weather · Day 5", fire6: "SPC fire weather · Day 6", fire7: "SPC fire weather · Day 7", fire8: "SPC fire weather · Day 8", wssip: "WPC winter storm severity (WSSI-P)", alerts: "NWS warnings, watches and advisories", md: "SPC Mesoscale Discussions", day1: "SPC Day 1 outlook", day2: "SPC Day 2 outlook", day3: "SPC Day 3 outlook", ero1: "WPC excessive rainfall · Day 1", ero2: "WPC excessive rainfall · Day 2", ero3: "WPC excessive rainfall · Day 3" };
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
  const WINTER_VENUES = [{ id: "snowbird", name: "Snowbird", city: "Little Cottonwood Canyon, UT", lat: 40.5813, lon: -111.6556, tz: "America/Denver", label: "Snowbird (Wasatch Mountains zone)" }, { id: "parkcity", name: "Park City Mountain", city: "Park City, UT", lat: 40.6514, lon: -111.508, tz: "America/Denver", label: "Park City Mountain (Wasatch Back zone)" }, { id: "crystal", name: "Crystal Mountain", city: "Enumclaw, WA", lat: 46.935, lon: -121.475, tz: "America/Los_Angeles", label: "Crystal Mountain, WA (Cascades)" }];
  const FIRE_OUTLOOK_VENUES = [{ id: "moseslake", name: "Grant County Fairgrounds", city: "Moses Lake, WA", lat: 47.1166, lon: -119.2783, tz: "America/Los_Angeles", label: "Grant County Fairgrounds, Moses Lake" }, { id: "spokane", name: "Spokane Arena", city: "Spokane, WA", lat: 47.665, lon: -117.4235, tz: "America/Los_Angeles", label: "Spokane Arena" }, { id: "missoula", name: "Caras Park", city: "Missoula, MT", lat: 46.8721, lon: -113.994, tz: "America/Denver", label: "Caras Park, Missoula" }];
  const RFW_VENUES = [{ id: "canvas", name: "Canvas Stadium", city: "Fort Collins, CO", lat: 40.5718, lon: -105.0897, tz: "America/Denver", label: "Canvas Stadium, Fort Collins (watch, then warning)" }, { id: "folsom", name: "Folsom Field", city: "Boulder, CO", lat: 40.0092, lon: -105.2669, tz: "America/Denver", label: "Folsom Field, Boulder" }, { id: "empower", name: "Empower Field at Mile High", city: "Denver, CO", lat: 39.7439, lon: -105.0201, tz: "America/Denver", label: "Empower Field, Denver (watch cancelled)" }];
  const INC_VENUES = [{ id: "lakepueblo", name: "Lake Pueblo State Park", city: "Pueblo, CO", lat: 38.2655, lon: -104.7246, tz: "America/Denver", label: "Lake Pueblo State Park (Aspen Acres within 15 mi)" }, { id: "fairco", name: "Colorado State Fairgrounds", city: "Pueblo, CO", lat: 38.2611, lon: -104.6189, tz: "America/Denver", label: "Colorado State Fairgrounds (17 mi)" }];
  ["archive-fire-day4", "archive-fire-day2", "archive-fire-day1"].forEach((k) => { ARCHIVE_VENUES[k] = FIRE_OUTLOOK_VENUES; });
  ["archive-fire-watch", "archive-fire-warning"].forEach((k) => { ARCHIVE_VENUES[k] = RFW_VENUES; });
  ARCHIVE_VENUES["archive-fire-incidents"] = INC_VENUES;
  const SMOKE_VENUES = [{ id: "soldier", name: "Soldier Field", city: "Chicago, IL", lat: 41.8623, lon: -87.6167, tz: "America/Chicago", label: "Soldier Field, Chicago" }, { id: "metlife", name: "MetLife Stadium", city: "East Rutherford, NJ", lat: 40.8135, lon: -74.0745, tz: "America/New_York", label: "MetLife Stadium, New York area" }, { id: "linc", name: "Lincoln Financial Field", city: "Philadelphia, PA", lat: 39.9008, lon: -75.1675, tz: "America/New_York", label: "Lincoln Financial Field, Philadelphia" }];
  const TROP_VENUES = [{ id: "wharf", name: "The Wharf, Orange Beach", city: "Orange Beach, AL", lat: 30.297, lon: -87.56, tz: "America/Chicago", label: "The Wharf, Orange Beach (Baldwin Coastal)" }, { id: "bayminette", name: "Bay Minette", city: "Bay Minette, AL", lat: 30.8829, lon: -87.7731, tz: "America/Chicago", label: "Bay Minette (Baldwin Inland)" }];
  ["archive-tropical-watch", "archive-tropical-warning"].forEach((k) => { ARCHIVE_VENUES[k] = TROP_VENUES; });
  ARCHIVE_VENUES["archive-reports-delaware"] = [{ id: "linc", name: "Lincoln Financial Field", city: "Philadelphia, PA", lat: 39.9008, lon: -75.1675, tz: "America/New_York", label: "Lincoln Financial Field (reports nearby)" }, { id: "nwk", name: "Delaware Stadium", city: "Newark, DE", lat: 39.6618, lon: -75.7474, tz: "America/New_York", label: "Delaware Stadium, Newark (a tornado 2 mi away)" }];
  ARCHIVE_VENUES["archive-aviation-enroute"] = [{ id: "ml", name: "MetLife Stadium", city: "East Rutherford, NJ", lat: 40.8135, lon: -74.0745, tz: "America/New_York", label: "MetLife Stadium, East Rutherford" }];
  ARCHIVE_VENUES["archive-aviation-chicago"] = [{ id: "uc", name: "United Center", city: "Chicago, IL", lat: 41.8807, lon: -87.6742, tz: "America/Chicago", label: "United Center, Chicago" }];
  ARCHIVE_VENUES["archive-coastal-flagler"] = [{ id: "flaglerpier", name: "Flagler Beach Pier", city: "Flagler Beach, FL", lat: 29.4802, lon: -81.1065, tz: "America/New_York", label: "Flagler Beach Pier (Coastal Flagler shoreline)" }, { id: "jaxbeach", name: "Jacksonville Beach Pier", city: "Jacksonville Beach, FL", lat: 30.2858, lon: -81.3889, tz: "America/New_York", label: "Jacksonville Beach Pier (Coastal Duval)" }];
  ["archive-smoke-chicago", "archive-smoke-metlife", "archive-smoke-forecast-0714", "archive-smoke-forecast-0715"].forEach((k) => { ARCHIVE_VENUES[k] = SMOKE_VENUES; });
  ["archive-winter-advisory", "archive-winter-warning", "archive-winter-outlook"].forEach((k) => { ARCHIVE_VENUES[k] = WINTER_VENUES; });
  ARCHIVE_VENUES["archive-flood-day"] = FLOOD_VENUES; ARCHIVE_VENUES["archive-flood-afternoon"] = FLOOD_VENUES; ARCHIVE_VENUES["archive-flood-outage"] = FLOOD_VENUES; ARCHIVE_VENUES["archive-flood-night"] = FLOOD_VENUES;
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
    // the venue's own zone: from the NWS point record (through /api/nws), else Open-Meteo, else Eastern
    if (!v.tz && !tzCache[k]) { tzCache[k] = "pending"; (Live.pointTz ? Live.pointTz(v.lat, v.lon) : Promise.reject()).catch(() => O.zoneFor(v.lat, v.lon)).then((z) => { tzCache[k] = z; load(); drawAll(); }).catch(() => { tzCache[k] = "America/New_York"; }); }
    return { ...v, tz: v.tz || (tzCache[k] && tzCache[k] !== "pending" ? tzCache[k] : "America/New_York") };
  }
  function load() {
    if (isArchive()) {
      const a = loadArchive(), list = ARCHIVE_VENUES[S.scenario];
      // a link from Event Planner names its venue: use the matching sample venue, or that venue itself
      const ent = S.entryVenue && !S.archiveVenue ? list.find((v) => Math.hypot(v.lat - S.entryVenue.lat, v.lon - S.entryVenue.lon) < 0.01) : null;
      venue = ent || list.find((v) => v.id === S.archiveVenue) || (S.entryVenue && !S.archiveVenue ? withTz(S.entryVenue) : list[0]);
      data = a && !a.error ? { ...a } : { clock: new Date().toISOString(), products: [], sources: { alerts: { state: "failed", lastOk: null }, md: { state: "na" }, day1: { state: "na" }, day2: { state: "na" } }, loading: !a, loadError: a && a.error };
      now = Date.parse(data.clock);
    } else if (isLive()) {
      data = Live.snapshot(); data.loading = !liveReady; now = Date.parse(data.clock);
      venue = withTz(S.entryVenue || liveVenues().find((v) => v.id === S.liveVenue) || liveVenues()[0]);
    } else { data = Demo.scenario(S.scenario); now = Date.parse(data.clock); venue = S.entryVenue ? withTz(S.entryVenue) : data.venues[S.venueKey]; }
    data.state = {}; for (const k of Object.keys(data.sources)) data.state[k] = data.sources[k].state === "off" ? { kind: "off", text: "Layer off" } : data.sources[k].state === "pending" ? { kind: "loading", text: "Loading" } : data.sources[k].state === "na" ? { kind: "na", text: "Not part of this sample" } : data.loading ? { kind: "loading", text: "Loading" } : isArchive() ? { kind: data.sources[k].count ? "current" : "empty", text: "Archived" } : T.sourceState(data.sources[k], now, STALE_MIN[k]);
  }
  const tz = () => venue.tz;
  /* a time zone as people say it: "Eastern Time (EST)", never the database name (America/New_York) */
  /* spanDays: a period that may cross a clock change shows both abbreviations ("Eastern Time (EST/EDT)") */
  const tzName = (z, spanDays = 0) => { try { const part = (o, d) => new Intl.DateTimeFormat("en-US", { timeZone: z, ...o }).formatToParts(d).find((x) => x.type === "timeZoneName").value, now = new Date();
    const long = part({ timeZoneName: "longGeneric" }, now), abbrs = [...new Set([now, new Date(now.getTime() + spanDays * 864e5)].map((d) => part({ timeZoneName: "short" }, d)))];
    return abbrs.some((a) => /^GMT/.test(a)) || long === abbrs[0] ? long : long + " (" + abbrs.join("/") + ")"; } catch (e) { return z; } };
  const t = (iso, day) => T.fmtTime(iso, tz(), { day });
  const shown = (p) => S.layers[p.family || "severe"] !== false;
  const active = () => data.products.filter((p) => p.kind !== "outlook" && p.family !== "aviation" && shown(p) && (Date.parse(p.expires) > now || (p.kind === "md" && p.expires == null)));
  // reached its published expiration while the source was down: not active, and not described as cleared
  const lapsed = () => data.products.filter((p) => p.kind !== "outlook" && T.expiredUnconfirmed(p, data.sources[SRC_OF(p)], now));
  /* SPC convective outlooks only (live program "spc"; demo fixtures carry no program). Every other outlook program (WPC
     rainfall, WSSI-P, SPC fire weather) has its own selector: a fire weather area here once broke the Day 1 map. */
  const isConvective = (p) => p.kind === "outlook" && (!p.program || p.program === "spc");
  const outlooks = (day) => data.products.filter((p) => isConvective(p) && p.day === day);
  const eroOut = (day) => data.products.filter((p) => p.kind === "outlook" && p.program === "ero" && p.day === day);
  const byId = (id) => data.products.find((p) => p.id === id);
  /* a product's relation to the venue, kept per outline and venue (outlines are stable objects between redraws) */
  const relCache = new WeakMap();
  const rel = (p) => { const g = p.geometry; if (!g || typeof g !== "object") return T.relation(p, venue); const vk = venue.lat + "," + venue.lon + "|" + p.kind, c = relCache.get(g);
    if (c && c.vk === vk) return c.r; const r = T.relation(p, venue); relCache.set(g, { vk, r }); return r; };
  const relText = (p) => T.relationText(rel(p), p);
  const unconfirmed = (p) => data.state[SRC_OF(p)].kind === "stale" ? data.sources[SRC_OF(p)].lastOk : null;
  const endOf = (p) => p.expires || p.validEnd;
  const viewDay = () => ({ day1: 1, day2: 2, day3: 3 })[S.view] || null;
  const winterView = () => S.view === "winter";
  const outlookView = () => S.view === "outlook" && isLive();
  const fireView = () => S.view === "fire";
  /* NIFC incidents (prescribed fires only when asked for) and SPC fire outlook areas for one day */
  /* fully contained fires (100%, still listed by NIFC until declared out) are hidden unless asked for, or linked to */
  const incidents = () => !S.layers.fire ? [] : data.products.filter((p) => p.kind === "incident" && (p.category !== "RX" || S.rx) && (p.contained !== 100 || S.ctn || p.id === S.sel));
  const fireOut = (d) => data.products.filter((p) => p.kind === "outlook" && /^spcfire-/.test(p.program || "") && p.day === d);
  const incRel = (p) => p.geometry ? T.relation(p, venue) : (() => { const d = T.pointDistance([venue.lon, venue.lat], p.point); return d.km <= T.NEAR_KM ? { kind: "near", km: d.km, dir: d.dir, point: true } : { kind: "outside", km: d.km, dir: d.dir, point: true }; })();
  const acresTxt = (v) => (v == null ? "size not reported" : Math.round(v).toLocaleString("en-US") + " acres");
  const incFacts = (p) => acresTxt(p.acres) + " · " + (p.contained != null ? p.contained + "% contained" : "containment not reported");
  const nearbyIncidents = () => incidents().filter((p) => p.category !== "RX").map((p) => ({ p, r: incRel(p) })).filter((x) => x.r.kind === "covers" || x.r.kind === "near").sort((a, b) => (a.r.km || 0) - (b.r.km || 0));
  function incItem(p, r) {
    const where = r ? (r.kind === "covers" ? "Perimeter includes the venue" : T.distanceText(r.km) + " " + r.dir + " of the venue" + (r.point ? " (reported location)" : " (perimeter edge)")) : (p.county ? p.county + ", " : "") + p.state;
    return `<button type="button" class="tx-item${S.hover === p.id ? " hl" : ""}" data-id="${esc(p.id)}" style="--tx-c:${colorOf(p)}">${swatch(p)}<span><span class="tx-kind k-incident">${esc(p.category === "RX" ? "PRESCRIBED" : "WILDFIRE")}</span><b>${esc(p.name)}</b>`
      + `<span class="tx-meta">${esc(incFacts(p))}</span><span class="tx-rel ${r ? r.kind : ""}">${esc(where)}</span><span class="tx-meta">NIFC updated ${esc(p.updated ? t(p.updated, true) : "unknown")}${p.geometry ? "" : " · no mapped perimeter"}</span></span></button>`;
  }
  function gaugeDetail(p) {
    const W = FX.GAUGE_WORD, d = T.pointDistance([venue.lon, venue.lat], p.point), stage = (x) => !x || x.value == null ? "not reported" : x.value + " " + x.unit + (x.flow != null ? " · " + x.flow + " " + x.flowUnit : "");
    const rows = [["Now", esc(stage(p.obs)) + (p.obs ? " · <b>" + esc(W[p.obs.category] || p.obs.category) + "</b>" + (p.obs.time ? ` <span style="color:var(--muted)">(${esc(t(p.obs.time, true))})</span>` : "") : "")],
      ["Forecast", p.fcst && p.fcst.time ? esc(stage(p.fcst)) + " · <b>" + esc(W[p.fcst.category] || p.fcst.category) + "</b>" + ` <span style="color:var(--muted)">(${esc(t(p.fcst.time, true))})</span>` : esc(W[(p.fcst || {}).category] || "No current forecast")],
      ["Venue", `<b>${esc(T.distanceText(d.km) + " " + d.dir)}</b> <span style="color:var(--muted)">of ${esc(venue.name)}</span>`], ["Gauge", esc(p.lid + (p.wfo ? " · NWS " + p.wfo : "") + (p.state ? " · " + p.state : ""))],
      ["Source", official() ? `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}: hydrograph</a>` : esc(p.source.name)]];
    return `<button type="button" class="px-back" data-back>← Back</button><div style="--tx-c:${colorOf(p)}">${swatch(p, 40)} <span class="tx-kind">RIVER GAUGE</span></div><div class="px-title">${esc(p.name)}</div><p class="px-headline">${esc(W[p.category] || p.category)}${p.rank >= 0 && p.fcst && p.fcst.category === p.category && p.fcst.time ? " (forecast)" : ""}</p><dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`
      + `<p class="lg-note">Flood categories are the gauge's own stages set by NWS. "No flood stages defined" and "no current forecast" are not the same as no flooding.</p>`;
  }
  function lsrDetail(p) {
    const d = T.pointDistance([venue.lon, venue.lat], p.point), rows = [["Report", esc(p.event + (p.type === "tornado" ? "" : " · " + p.magText))], ["Time", esc(t(p.observed, true)) + ` <span style="color:var(--muted)">(${esc(T.fmtZ(p.observed))})</span>`],
      ["Where", esc(p.location + " · " + p.county + " County, " + p.state)], ["Venue", `<b>${esc(T.distanceText(d.km) + " " + d.dir)}</b> <span style="color:var(--muted)">of ${esc(venue.name)}</span>`],
      ["Reported via", esc(p.office ? "NWS " + p.office : "NWS")], ["Source", official() ? `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a>` : esc(p.source.name)]];
    return `<button type="button" class="px-back" data-back>← Back</button><div style="--tx-c:${colorOf(p)}">${swatch(p, 40)} <span class="tx-kind">STORM REPORT</span></div><div class="px-title">${esc(p.title)}</div>`
      + `<dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` + (p.comments ? `<p class="px-headline">${esc(p.comments)}</p>` : "")
      + `<p class="lg-note">A preliminary report, not a confirmed survey: it can be revised, and a single storm can produce several reports.</p>`;
  }
  function incidentDetail(p) {
    const r = incRel(p), rows = [["Type", esc(p.event + (p.imt ? " · " + p.imt : ""))], ["Size", esc(acresTxt(p.acres)) + " (as reported for the incident)"], ["Containment", esc(p.contained != null ? p.contained + "%" : "not reported")],
      ["Discovered", p.discovered ? esc(t(p.discovered, true)) : "not reported"], ["Updated", p.updated ? esc(t(p.updated, true)) + " (NIFC incident record)" : "unknown"],
      ["Perimeter", p.perimeter ? "Mapped " + (p.perimeter.date ? esc(t(p.perimeter.date, true)) : "") + (p.perimeter.acres ? " · " + esc(acresTxt(p.perimeter.acres)) : "") + (p.perimeter.method ? " · " + esc(p.perimeter.method) : "") : "No mapped perimeter; the dot is the reported location"],
      ["Venue", `<b>${esc(r.kind === "covers" ? "Inside the mapped perimeter" : T.distanceText(r.km) + " " + r.dir + " of the venue")}</b> <span style="color:var(--muted)">(${esc(venue.name)})</span>`],
      ["Location", esc([p.county, p.state].filter(Boolean).join(", ") + (p.unit ? " · " + p.unit : ""))], ["Incident ID", esc(p.uniqueId || p.irwinId)],
      ["Source", official() ? `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a>` : esc(p.source.name)]];
    return `<button type="button" class="px-back" data-back>← Back</button><div style="--tx-c:${colorOf(p)}">${swatch(p, 40)} <span class="tx-kind k-incident">${esc(p.category === "RX" ? "PRESCRIBED FIRE" : "WILDFIRE")}</span></div>`
      + `<div class="px-title">${esc(p.name)}</div><p class="px-headline">${esc(incFacts(p))}</p><dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`
      + `<p class="lg-note">Incidents stay in NIFC's current list until declared contained, controlled or out, or until they go 3 to 14 days without an update (by size). Follow local officials for evacuations and closures.</p>`;
  }
  /* ---------- aviation: the event's airports (from ?air=, or every airport in an archived sample) ---------- */
  const avProducts = () => !S.layers.aviation || !S.av.apt ? [] : data.products.filter((p) => (p.kind === "metar" || p.kind === "taf") && (!S.air.length || S.air.includes(p.airport)));
  const zt = (iso) => { const d = new Date(iso); return String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z"; };
  function airportsSection() {
    if (!S.layers.aviation) return "";
    const ps = avProducts(), ids = S.air.length ? S.air : [...new Set(ps.map((p) => p.airport))], st = data.state.awc;
    if (!ids.length) return "";
    let h = `<div class="px-h"><span>Airports · Aviation Weather Center</span><span>METAR and TAF</span></div>`;
    if (st && ["unavailable", "stale"].includes(st.kind)) h += `<p class="px-empty">Airport weather not confirmed${data.sources.awc && data.sources.awc.error ? " (" + esc(data.sources.awc.error) + ")" : ""}.</p>`;
    for (const id of ids) {
      const m = ps.filter((p) => p.kind === "metar" && p.airport === id).sort((a, b) => (a.observed < b.observed ? 1 : -1))[0], t = ps.filter((p) => p.kind === "taf" && p.airport === id).sort((a, b) => (a.issued < b.issued ? 1 : -1))[0];
      h += `<button type="button" class="tx-item${S.ap === id ? " hl" : ""}" data-id="${esc((t || m || { id: "" }).id)}" style="--tx-c:${m ? FLT_COLOR[m.category] : "var(--line)"}"><svg class="tx-sw" width="30" height="16" aria-hidden="true"><circle cx="15" cy="8" r="6" fill="${m ? FLT_COLOR[m.category] : "#9aa3ad"}" stroke="#222"/></svg><span><span class="tx-kind k-av">${esc(id)}</span><b>${esc(m ? m.category + " now" : "No METAR")}</b>`
        + `<span class="tx-meta">${m ? "Observed " + esc(t0(m.observed)) + (m.ceiling != null ? " · ceiling " + m.ceiling + " ft" : "") + (m.wx ? " · " + esc(m.wx) : "") : ""}</span>`
        + `<span class="tx-meta">${t ? "TAF " + esc(zt(t.issued)) + (t.amended ? " AMD" : "") + ": " + esc(t.periods.filter((pd) => Date.parse(pd.to) > now).slice(0, 4).map((pd) => (pd.change === "BASE" ? "" : pd.change + " ") + t0(pd.from) + " " + (pd.category || "")).join(" · ")) : "No TAF for this airport"}</span></span></button>`;
    }
    return h + `<p class="lg-note">Airport conditions are for the airport (TAF: within 5 statute miles), not the venue.</p>`;
  }
  const t0 = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: tz(), weekday: "short", hour: "numeric", minute: "2-digit" });
  function avDetail(p) {
    const rows = p.kind === "metar" ? [["Observed", esc(t(p.observed, true)) + ` <span class="mono">${esc(zt(p.observed))}</span>`], ["Flight category", esc(p.category)], ["Conditions", esc((p.ceiling != null ? "ceiling " + p.ceiling + " ft · " : "") + (p.visText ? "visibility " + p.visText + " mi · " : "") + (p.wind != null ? "wind " + p.wind + (p.gust ? "G" + p.gust : "") + " kt" : "") + (p.wx ? " · " + p.wx : ""))], ["Raw", `<span class="mono">${esc(p.raw)}</span>`]]
      : [["Issued", esc(t(p.issued, true)) + ` <span class="mono">${esc(zt(p.issued))}${p.amended ? " AMD" : ""}</span>`], ["Valid", esc(t(p.validStart, true) + " → " + t(p.validEnd, true))], ["Periods", p.periods.map((pd) => esc((pd.change === "BASE" ? "Base" : pd.change) + (pd.prob ? " " + pd.prob + "%" : "") + " " + t0(pd.from) + "–" + t0(pd.to) + ": " + (pd.category || "") + (pd.ceiling != null ? ", ceiling " + pd.ceiling + " ft" : "") + (pd.wind ? ", wind " + pd.wind + (pd.gust ? "G" + pd.gust : "") + " kt" : "") + (pd.wx ? ", " + pd.wx : ""))).join("<br>")], ["Raw", `<span class="mono">${esc(p.raw)}</span>`]];
    return `<button type="button" class="px-back" data-back>← Back</button><div style="--tx-c:${colorOf(p)}"><span class="tx-kind k-av">${esc(p.airport)} ${esc(p.kind.toUpperCase())}</span></div><div class="px-title">${esc(p.airportName || p.airport)}</div><dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}<dt>Source</dt><dd><a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a></dd></dl><p class="lg-note">Airport weather, not the venue. Flight category from ceiling and visibility (FAA definitions).</p>`;
  }

  /* ---------- aviation en route: pilot reports (observations), advisories (SIGMET, CWA, G-AIRMET), FAA airport status ---------- */
  const EN = window.ThreatsEnroute;
  const EN_COLOR = { turbulence: "#E07B00", icing: "#2B7BD6", convective: "#D62728", low: "#8C8C8C", wind: "#8E44AD", ash: "#6B4F2A", other: "#777777" };
  const PIREP_COLOR = (r) => (r >= 3 ? "#7A0F0F" : r >= 2.5 ? "#B42318" : r >= 2 ? "#E5484D" : r >= 1.5 ? "#F2994A" : "#F2C94C");
  const EN_ALT = [[null, "All altitudes"], [[0, 10000], "Below 10,000 ft"], [[10000, 18000], "10,000 ft–FL180"], [[18000, 29000], "FL180–FL290"], [[29000, 60000], "Above FL290"]];
  const enOn = () => !!(EN && S.layers.aviation && (S.en.on || S.air.length || S.route || /^archive-aviation/.test(S.scenario)));
  const enTime = () => { const c = Date.parse(data.clock); if (S.en.atIso && !S.en.atFixed) { S.en.at = Math.max(0, Math.min(12, Math.round((Date.parse(S.en.atIso) - c) / 3 / 3600e3) * 3)); S.en.atFixed = true; } return c + S.en.at * 3600e3; };
  const enAll = () => (data.products || []).filter((x) => x.kind === "pirep" || x.kind === "sigmet" || x.kind === "gairmet" || x.kind === "cwa");
  function enShown() {
    if (!enOn()) return [];
    const tMs = enTime(), c = Date.parse(data.clock), [lo, hi] = S.en.alt || [null, null];
    return enAll().filter((x) => (x.kind === "pirep" ? S.av.pireps : S.av.adv)).filter((x) => (x.kind === "pirep" ? S.en.at === 0 && c - Date.parse(x.observed) <= S.en.age * 3600e3 && c >= Date.parse(x.observed) : EN.validAt(x, tMs)) && EN.inBand(x, lo, hi));
  }
  const routeEnds = () => { if (!S.route) return null; const pt = (id) => { const x = (data.products || []).find((q) => (q.kind === "metar" || q.kind === "taf") && q.airport === id && Array.isArray(q.point)); return x ? x.point : null; }; const o = pt(S.route.o), d = pt(S.route.d); return o && d ? { o, d } : null; };
  const faaShown = () => { const ids = S.air.map((x) => EN.faaId(x)); return (data.products || []).filter((x) => x.kind === "faa" && ids.includes(x.airportFaa) && !(x.end && Date.parse(x.end) <= Date.parse(data.clock))); };
  /* Aviation's own controls, one row: what it shows (the same switches as in Layers) */
  function avControls() {
    const on = { apt: S.av.apt, pireps: S.av.pireps && enOn(), adv: S.av.adv && enOn(), gtg: S.gtg.on, ifi: S.ifi.on }, L = { apt: "Airport weather", pireps: "Pilot reports", adv: "Advisories", gtg: "Turbulence guidance", ifi: "Icing guidance" };
    return `<div class="px-h"><span>Aviation shows</span><span>also in Layers</span></div><div class="tx-filters tx-avctl" role="group" aria-label="What Aviation shows">${Object.keys(L).map((k) => `<button type="button" class="tx-fb" data-avt="${k}" aria-pressed="${!!on[k]}">${on[k] ? "✓ " : ""}${esc(L[k])}</button>`).join("")}</div>`;
  }
  /* list rows for aviation reports and advisories (the En route section and At this spot) */
  const advItem = (x) => `<button type="button" class="tx-item" data-id="${esc(x.id)}" style="--tx-c:${EN_COLOR[x.hazardFamily] || EN_COLOR.other}"><svg class="tx-sw" width="30" height="16" aria-hidden="true"><rect x="3" y="3" width="24" height="10" fill="${EN_COLOR[x.hazardFamily] || EN_COLOR.other}" fill-opacity=".25" stroke="${EN_COLOR[x.hazardFamily] || EN_COLOR.other}" stroke-width="2"${x.kind === "gairmet" ? ' stroke-dasharray="4 2"' : ""}/></svg><span><span class="tx-kind k-av">${esc(x.kind === "gairmet" ? "G-AIRMET" : x.kind === "cwa" ? "CWA" : "SIGMET")}</span><b>${esc((x.severity === "MOD" ? "Moderate " : x.severity === "SEV" ? "Severe " : "") + x.hazardWord)}</b><span class="tx-meta">${esc(x.baseFt == null && x.topFt == null ? (x.surface ? "near the surface" : "altitude not stated") : EN.bandText(x.baseFt, x.topFt))} · ${esc(x.kind === "gairmet" ? "snapshot " + t(x.validTime) : "until " + t(x.validEnd))}</span></span></button>`;
  const pirepItem = (x) => `<button type="button" class="tx-item" data-id="${esc(x.id)}" style="--tx-c:${PIREP_COLOR(x.rank)}"><svg class="tx-sw" width="30" height="16" aria-hidden="true"><circle cx="15" cy="8" r="6" fill="${x.turb.length ? PIREP_COLOR(x.rank) : "none"}" stroke="${x.turb.length ? "#111" : PIREP_COLOR(x.rank)}" stroke-width="${x.turb.length ? 1 : 3}"/></svg><span><span class="tx-kind k-av">PILOT REPORT</span><b>${esc(EN.pirepText(x))}</b><span class="tx-meta">${esc(t(x.observed) + (x.acType ? " · " + x.acType : ""))}</span></span></button>`;
  function enrouteSection() {
    if (!S.layers.aviation || !EN) return "";
    if (!enOn()) return `<div class="px-h"><span>Aviation en route</span></div><button type="button" class="px-link" data-en-on="1">Show pilot reports and en-route advisories (SIGMETs, G-AIRMETs, CWAs) →</button>`;
    const st = data.state.enroute, list = enShown(), adv = list.filter((x) => x.kind !== "pirep"), rp = list.filter((x) => x.kind === "pirep"), strong = rp.filter((x) => x.rank >= 2).sort((a, b) => b.rank - a.rank);
    const tMs = enTime(), btn = (attr, val, on, label) => `<button type="button" class="tx-fb" data-${attr}="${esc(String(val))}" aria-pressed="${on}">${esc(label)}</button>`;
    let h = `<div class="px-h"><span>${S.route ? "En route · approximate route " + esc(S.route.o + " → " + S.route.d) : "En route · regional context"}</span><span>${esc(t(new Date(tMs).toISOString()))}</span></div>`;
    if (st && ["unavailable", "stale"].includes(st.kind)) h += `<p class="px-empty">En-route advisories and pilot reports not confirmed${data.sources.enroute && data.sources.enroute.error ? " (" + esc(data.sources.enroute.error) + ")" : ""}.</p>`;
    else if (!st || st.kind === "loading") h += `<p class="px-empty">Loading pilot reports and advisories…</p>`;
    h += `<div class="tx-filters" role="group" aria-label="Time"><span class="tx-fl">Time</span>${[0, 3, 6, 9, 12].map((n) => btn("en-at", n, S.en.at === n, n ? "+" + n + " h" : "Now")).join("")}</div>`;
    h += `<div class="tx-filters" role="group" aria-label="Altitude"><span class="tx-fl">Altitude</span>${EN_ALT.map(([b, label]) => btn("en-alt", b ? b.join("-") : "all", JSON.stringify(S.en.alt) === JSON.stringify(b), label)).join("")}${S.route ? btn("en-alt", S.route.lo + "-" + S.route.hi, JSON.stringify(S.en.alt) === JSON.stringify([S.route.lo, S.route.hi]), "Your band " + EN.bandText(S.route.lo, S.route.hi)) : ""}</div>`;
    h += `<div class="tx-filters" role="group" aria-label="Report age"><span class="tx-fl">Pilot reports</span>${(isArchive() ? [1, 2, 3] : [1, 2]).map((n) => btn("en-age", n, S.en.age === n, "last " + n + " h")).join("")}</div>`;
    h += `<p class="lg-note" data-en-counts>${S.en.at ? "Pilot reports are past observations and show at Now only. " : esc(rp.length + " pilot report" + (rp.length === 1 ? "" : "s") + " of turbulence or icing (" + strong.length + " moderate or worse). ")}${esc(adv.length + " advisor" + (adv.length === 1 ? "y" : "ies") + " in effect at that time.")}</p>`;
    const order = { convective: 0, turbulence: 1, icing: 2, ash: 3, wind: 4, low: 5, other: 6 };
    if (adv.length) h += adv.slice().sort((a, b) => (order[a.hazardFamily] ?? 9) - (order[b.hazardFamily] ?? 9)).slice(0, 10).map(advItem).join("") + (adv.length > 10 ? `<p class="lg-note">${adv.length - 10} more on the map.</p>` : "");
    if (strong.length && S.en.at === 0) h += strong.slice(0, 6).map(pirepItem).join("");
    h += `<div class="lg-note en-legend"><b>Pilot reports</b> are observations (dots: turbulence; rings: icing; darker is stronger). <b>Advisories</b> are official: SIGMETs and CWAs solid, G-AIRMETs dashed (a forecast snapshot every 3 hours). <b>Model guidance</b>: NOAA's Graphical Turbulence Guidance (GTG), a violet fill, below when turned on; never mixed with the reports or advisories.${S.route ? " The route is a straight line between the airports, not a flight plan." : ""}</div>`;
    h += gtgSection();
    const fs = faaShown();
    if (S.air.length) {
      h += `<div class="px-h"><span>Flight disruptions · FAA</span><span>${esc(S.air.join(", "))}</span></div>`;
      const fst = data.state.faa;
      if (!fst || fst.kind === "loading") h += `<p class="px-empty">Checking FAA airport status…</p>`;
      else if (["unavailable", "stale"].includes(fst.kind)) h += `<p class="px-empty">FAA airport status not confirmed.</p>`;
      else if (!fs.length) h += `<p class="px-empty">No FAA-reported delays, ground stops or closures at ${esc(S.air.join(", "))}.</p>`;
      h += fs.map((x) => `<button type="button" class="tx-item" data-id="${esc(x.id)}" style="--tx-c:${x.weather ? "#D62728" : "#9aa3ad"}"><span><span class="tx-kind k-av">FAA ${esc(x.airportFaa)}${x.planned ? " · PLANNED" : ""}</span><b>${esc(x.typeWord)}</b><span class="tx-meta">${esc(x.notice ? x.text.slice(0, 90) : EN.faaText(x))}</span><span class="tx-meta">${esc((x.weather ? "Weather-related · " : "") + (x.planned && x.start ? "from " + t(x.start) : "active") + (x.end ? " until " + t(x.end) : ""))}</span></span></button>`).join("");
    }
    return h;
  }
  function enDetail(p) {
    const rows = p.kind === "pirep" ? [["Report", esc(EN.pirepText(p) + (p.urgent ? " · urgent" : ""))], ["Observed", esc(t(p.observed, true)) + ` <span class="mono">${esc(zt(p.observed))}</span>`], ["Aircraft", esc(p.acType || "not given")], ["Raw", `<span class="mono">${esc(p.raw)}</span>`]]
      : p.kind === "faa" ? [["Airport", esc(p.airportName + " (" + p.airportFaa + ")")], ["Status", esc(p.notice ? "Notice" : p.planned ? "Planned" : "Active")], ["FAA's stated cause", esc((p.cause || "not stated") + (p.weather ? " · weather-related" : ""))], ["Times", esc((p.start ? t(p.start, true) : "start not given") + " → " + (p.end ? t(p.end, true) : "no end time given"))], ...(p.notice ? [["Notice", `<span class="mono">${esc(p.text)}</span>`]] : [["Delays", esc(EN.faaText(p))]]), ["Updated", p.updated ? esc(t(p.updated, true)) : "not stated"], ...(p.advisoryUrl ? [["FAA advisory", `<a href="${esc(p.advisoryUrl)}" target="_blank" rel="noopener">ATCSCC advisory</a>`]] : [])]
      : [["Hazard", esc((p.severity ? p.severity + " " : "") + p.hazardWord + (p.dueTo ? " · " + p.dueTo : "") + (p.qualifier ? " · " + p.qualifier : ""))], ["Altitude", esc(p.baseFt == null && p.topFt == null ? (p.surface ? "near the surface" : "not stated") : EN.bandText(p.baseFt, p.topFt) + (p.freezingLevel ? " (from the freezing level)" : ""))],
        [p.kind === "gairmet" ? "Snapshot" : "Valid", esc(p.kind === "gairmet" ? t(p.validTime, true) + " (+" + p.forecastHour + " h; read as 90 minutes either side)" : t(p.validStart, true) + " → " + t(p.validEnd, true))], ["Issued", p.issued ? esc(t(p.issued, true)) : "not stated"], ...(p.raw ? [["Raw", `<span class="mono">${esc(p.raw)}</span>`]] : [])];
    const kindLabel = p.kind === "pirep" ? "PILOT REPORT · OBSERVATION" : p.kind === "faa" ? "FAA AIRPORT STATUS" : p.kind === "gairmet" ? "G-AIRMET · FORECAST ADVISORY" : p.kind === "cwa" ? "CENTER WEATHER ADVISORY" : (p.outlook ? "CONVECTIVE SIGMET OUTLOOK" : "SIGMET · ADVISORY");
    const note = p.kind === "pirep" ? "A pilot's observation at that place, altitude and time; turbulence depends on the aircraft. Not a forecast." : p.kind === "faa" ? "As reported by the FAA; check with the airline for a specific flight." : "An official advisory for an area of airspace, not a forecast for any one flight.";
    return `<button type="button" class="px-back" data-back>← Back</button><div><span class="tx-kind k-av">${esc(kindLabel)}</span></div><div class="px-title">${esc(p.kind === "faa" ? p.typeWord + " · " + p.airportFaa : p.title)}</div><dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}<dt>Source</dt><dd><a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a> · ${esc(p.office)}</dd></dl><p class="lg-note">${esc(note)}</p>`;
  }

  /* ---------- aviation model guidance: NOAA NCEP Graphical Turbulence Guidance (GTG), one height and forecast hour ---------- */
  const GT = window.ThreatsGTG, BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const gtg = { latest: null, latestAt: 0, state: "off", error: null, key: null, dec: null, P: null, cache: new Map(), drawn: null, pending: null };
  const gtgBase = () => (Live.NWS.base || "").replace(/\/api\/nws$/, "/api/gtg");
  const gtgHeight = () => GT.HEIGHTS.find((h) => h.ft === S.gtg.ft) || GT.HEIGHTS.find((h) => h.ft === 30000);
  async function gtgGet(u, as) { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) { let m = "HTTP " + r.status; try { m = (await r.json()).error || m; } catch (x) { /* not JSON */ } throw Error(m); } return { body: as === "json" ? await r.json() : new Uint8Array(await r.arrayBuffer()), headers: r.headers }; }
  function ensureGtg() {
    if (!GT || !map || !ready) return;
    const fix = S.gtg.src === "fixture", on = S.gtg.on && enOn() && (fix || (!isArchive() && Live.NWS.mode === "function"));
    map.setLayoutProperty("gtg-img", "visibility", on && gtg.state === "ok" ? "visible" : "none");
    if (!S.gtg.on || !enOn()) return;
    if (!fix && (isArchive() || Live.NWS.mode !== "function")) { gtg.state = "na"; return; }
    const h = gtgHeight(), want = S.gtg.fh + "|" + h.m + "|" + S.gtg.cls;
    if (gtg.pending === want || (gtg.drawn === want + "|" + (gtg.latest && gtg.latest.cycle) && Date.now() - gtg.latestAt < 15 * 60e3)) return;
    gtg.pending = want; gtg.state = "loading"; gtg.error = null;
    (async () => {
      if (fix) { if (!gtg.latest || !gtg.latest.fixture) { const r = await fetch("tests/fixtures/threats/gtg/manifest.json", { cache: "no-store" }); if (!r.ok) throw Error("saved records: HTTP " + r.status); const m = await r.json(); gtg.latest = { cycle: m.cycle, records: m.records, hours: Array.from({ length: 19 }, (_, k) => k), pinned: true, fixture: true }; } gtg.latestAt = Date.now(); }
      else if (S.gtg.cyc) { gtg.latest = { cycle: S.gtg.cyc, hours: Array.from({ length: 19 }, (_, k) => k), pinned: true }; gtg.latestAt = Date.now(); }
      else if (!gtg.latest || Date.now() - gtg.latestAt > 15 * 60e3) { gtg.latest = (await gtgGet(gtgBase() + "/latest", "json")).body; gtg.latestAt = Date.now(); }
      const cyc = gtg.latest.cycle, rk = cyc + "|" + S.gtg.fh + "|" + h.m; let dec = gtg.cache.get(rk);
      if (!dec) { if (fix && !gtg.latest.records[S.gtg.fh + "|" + h.m]) throw Error("not in this replay (it has " + Object.keys(gtg.latest.records).map((x) => { const [a, m] = x.split("|"); const hh = GT.HEIGHTS.find((q) => q.m === +m); return (hh ? GT.levelLabel(hh.ft) : m + " m") + " +" + a + " h"; }).join(", ") + ")");
        const r = fix ? await (async () => { const q = await fetch("tests/fixtures/threats/gtg/" + gtg.latest.records[S.gtg.fh + "|" + h.m], { cache: "no-store" }); if (!q.ok) throw Error("saved record HTTP " + q.status); return { body: new Uint8Array(await q.arrayBuffer()), headers: new Headers() }; })() : await gtgGet(gtgBase() + "/record?cycle=" + cyc + "&fh=" + S.gtg.fh + "&m=" + h.m, "bin"); dec = GT.decode(r.body); dec.bytes = r.body.length; dec.record = r.headers.get("X-GTG-Record"); dec.fileBytes = +r.headers.get("X-GTG-File-Bytes") || null; dec.fetchedAt = r.headers.get("X-Upstream-Fetched-At");
        if (dec.product.category !== 19 || dec.product.number !== 30 || Math.round(dec.product.level) !== h.m) throw Error("unexpected record (" + dec.product.category + "/" + dec.product.number + " at " + dec.product.level + " m)");
        gtg.cache.set(rk, dec); if (gtg.cache.size > 6) gtg.cache.delete(gtg.cache.keys().next().value); }
      const img = GT.render(dec, { width: 1100, cls: S.gtg.cls }), cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; cv.getContext("2d").putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
      map.getSource("gtg").updateImage({ url: cv.toDataURL("image/png"), coordinates: img.coordinates });
      Object.assign(gtg, { dec, P: GT.projection(dec.grid), key: rk, state: "ok", drawn: want + "|" + cyc });
    })().catch((e) => { gtg.state = "failed"; gtg.error = e.message; }).finally(() => { gtg.pending = null; stage("panel", renderPanel); stage("legend", renderLegend); if (map) map.setLayoutProperty("gtg-img", "visibility", S.gtg.on && gtg.state === "ok" ? "visible" : "none"); });
  }
  const gtgAt = (pt) => { if (!gtg.dec || !pt) return null; const v = GT.valueAt(gtg.dec, pt[0], pt[1], gtg.P); return v.inside ? { ...v, cat: GT.category(v.value, S.gtg.cls) } : null; };
  const gtgWord = (x) => (!x ? "outside the GTG grid" : x.value == null ? "no value (masked)" : "EDR " + x.value.toFixed(2) + " · " + (x.cat ? GT.CAT_WORD[x.cat] : "below light") + " for " + S.gtg.cls + " aircraft");
  /* ---------- modeled icing: NOAA NCEP In-Flight Icing (IFI), probability or severity, one height and hour ----------
     The altitude and valid-time controls are shared with GTG: the valid time is the base cycle (GTG's when turbulence is
     on, else IFI's) plus the hour chosen; IFI then reads its own forecast hour for that time, which may not exist (IFI starts
     at +1 h and stops at 30,000 ft): then nothing is drawn and the panel says why. */
  const IF = window.ThreatsIFI, IFI_FIX = "tests/fixtures/threats/ifi/";
  const ifi = { latest: null, latestAt: 0, state: "off", error: null, key: null, dec: null, mask: null, P: null, cache: new Map(), drawn: null, pending: null, reason: null };
  const mgBaseCycle = () => (S.gtg.on && gtg.latest ? gtg.latest.cycle : ifi.latest ? ifi.latest.cycle : gtg.latest ? gtg.latest.cycle : null);
  const mgValidMs = () => { const c = mgBaseCycle(); return c ? gtgCycleMs(c) + S.gtg.fh * 3600e3 : null; };
  async function ifiRecord(cyc, fh, ft, field) {
    const k = cyc + "|" + fh + "|" + ft + "|" + field; if (ifi.cache.has(k)) return ifi.cache.get(k);
    let body, headers = new Headers();
    if (S.ifi.src === "fixture") { const f = ifi.latest.records[fh + "|" + ft + "|" + field]; if (!f) throw Error("not in this replay (it has " + Object.keys(ifi.latest.records).map((x) => { const [a, b, c] = x.split("|"); return c + " " + IF.levelLabel(+b) + " +" + a + " h"; }).join(", ") + ")"); const r = await fetch(IFI_FIX + f, { cache: "no-store" }); if (!r.ok) throw Error("fixture HTTP " + r.status); body = new Uint8Array(await r.arrayBuffer()); }
    else { const r = await gtgGet(gtgBase().replace(/\/api\/gtg$/, "/api/ifi") + "/record?cycle=" + cyc + "&fh=" + fh + "&ft=" + ft + "&field=" + field, "bin"); body = r.body; headers = r.headers; }
    const dec = GT.decode(body); IF.check(dec, field, ft, fh); dec.bytes = body.length; dec.fileBytes = +headers.get("X-IFI-File-Bytes") || null;
    ifi.cache.set(k, dec); if (ifi.cache.size > 8) ifi.cache.delete(ifi.cache.keys().next().value); return dec;
  }
  function ensureIfi() {
    if (!IF || !GT || !map || !ready) return;
    const live = !isArchive() && Live.NWS.mode === "function", usable = S.ifi.on && enOn() && (S.ifi.src === "fixture" || live);
    map.setLayoutProperty("ifi-img", "visibility", usable && ifi.state === "ok" ? "visible" : "none");
    if (!S.ifi.on || !enOn()) return;
    if (!usable) { ifi.state = "na"; return; }
    const before = ifi.state + "|" + ifi.key + "|" + ifi.reason;
    (async () => {
      if (S.ifi.src === "fixture") { if (!ifi.latest) { const r = await fetch(IFI_FIX + "manifest.json", { cache: "no-store" }); if (!r.ok) throw Error("fixture manifest HTTP " + r.status); const m = await r.json(); ifi.latest = { cycle: m.cycle, records: m.records, label: m.label, pinned: true, fixture: true }; ifi.latestAt = Date.now(); } }
      else if (S.ifi.cyc) { if (!ifi.latest) ifi.latest = { cycle: S.ifi.cyc, pinned: true }; }
      else if (!ifi.latest || Date.now() - ifi.latestAt > 15 * 60e3) { ifi.latest = (await gtgGet(gtgBase().replace(/\/api\/gtg$/, "/api/ifi") + "/latest", "json")).body; ifi.latestAt = Date.now(); }
      const v = mgValidMs(), cyc = ifi.latest.cycle, fh = Math.round((v - gtgCycleMs(cyc)) / 3600e3), ft = S.gtg.ft, field = S.ifi.field, want = cyc + "|" + fh + "|" + ft + "|" + field;
      if (ifi.pending === want || ifi.drawn === want) return;
      if (ft > IF.TOP_FT || fh < IF.FIRST_FH || fh > IF.LAST_FH || Math.abs(v - gtgCycleMs(cyc) - fh * 3600e3) > 60e3) {
        Object.assign(ifi, { state: "unavailable", drawn: null, key: want, dec: null, reason: ft > IF.TOP_FT ? "IFI stops at 30,000 ft (FL300)" : "IFI cycle " + T.fmtZ(new Date(gtgCycleMs(cyc)).toISOString()) + " has no forecast for that time (it covers +1 to +18 h)" });
        return; }
      ifi.pending = want; ifi.state = "loading"; ifi.error = null;
      try {
        const dec = await ifiRecord(cyc, fh, ft, field), mask = field === "sev" ? await ifiRecord(cyc, fh, ft, "prob") : null;
        const img = IF.render(dec, field, { width: 1100, mask }), cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; cv.getContext("2d").putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
        map.getSource("ifi").updateImage({ url: cv.toDataURL("image/png"), coordinates: img.coordinates });
        Object.assign(ifi, { dec, mask, P: GT.projection(dec.grid), key: want, state: "ok", drawn: want, reason: null });
      } catch (e) { Object.assign(ifi, { state: "unavailable", error: e.message, reason: e.message, dec: null, drawn: null, key: want }); }
      finally { ifi.pending = null; }
    })().catch((e) => { Object.assign(ifi, { state: "unavailable", reason: e.message, dec: null, drawn: null }); })
      .finally(() => { if (map) map.setLayoutProperty("ifi-img", "visibility", S.ifi.on && ifi.state === "ok" ? "visible" : "none"); if (ifi.state + "|" + ifi.key + "|" + ifi.reason !== before) { stage("panel", renderPanel); stage("legend", renderLegend); } });
  }
  const ifiAt = (pt) => (ifi.dec && pt ? IF.valueAt(ifi.dec, S.ifi.field, pt[0], pt[1], ifi.mask, ifi.P) : null);
  function ifiBlock() {
    let h = `<div class="px-h"><span>Model guidance · NOAA IFI</span><span>icing forecast</span></div>`;
    if (isArchive()) return h + `<p class="px-empty">Live only: IFI guidance is not part of this archived replay.</p>`;
    if (!S.ifi.on) return h + `<button type="button" class="px-link" data-ifi-on="1">Show forecast icing guidance (one height and hour, about 0.5 MB) →</button>`;
    h += `<div class="tx-filters"><span class="tx-fl">Icing field</span>${Object.entries(IF.FIELDS).map(([k, f]) => `<button type="button" class="tx-fb" data-ifi-field="${k}" aria-pressed="${S.ifi.field === k}">${esc(f.label)}</button>`).join("")}</div>`;
    const sw = (c) => `<span class="gtg-sw" style="background:rgba(${c.slice(0, 3).join(",")},${(c[3] / 255).toFixed(2)})"></span>`;
    h += `<div class="lg-row gtg-legend ifi-legend">${S.ifi.field === "prob" ? IF.PROB_BINS.map(([, l], i) => sw(IF.PROB_COLORS[i]) + `<span>${esc(l)}</span>`).join("") : [1, 2, 3, 4].map((c) => sw(IF.SEV_COLORS[c]) + `<span>${esc(IF.SEV_WORD[c])}</span>`).join("")}</div>`;
    if (ifi.state === "loading") h += `<p class="px-empty">Loading IFI ${esc(IF.FIELDS[S.ifi.field].label.toLowerCase())}…</p>`;
    else if (ifi.state === "unavailable" || ifi.state === "na") h += `<p class="px-empty" data-ifi-unavailable>Icing guidance not shown: ${esc(ifi.state === "na" ? "needs the preview's same-origin function" : ifi.reason || "record unavailable")}. Nothing is drawn rather than another height, hour or an old field.</p>`;
    else if (ifi.state === "ok" && ifi.dec) {
      const d = ifi.dec, L = ifi.latest, at = ifiAt([venue.lon, venue.lat]);
      h += `<p class="lg-note" data-ifi-status>${esc(IF.FIELDS[S.ifi.field].label)} (${esc(IF.FIELDS[S.ifi.field].grib)}) · cycle ${esc(T.fmtZ(d.refTime))}${L.fixture ? " (saved official records)" : L.pinned ? " (pinned)" : ""}, valid ${esc(t(d.validTime, true))} (+${d.product.forecast} h) · ${esc(IF.levelLabel(S.gtg.ft))} (${d.product.level.toLocaleString("en-US")} m MSL) · record ${(d.bytes / 1048576).toFixed(2)} MB${d.fileBytes ? " of a " + (d.fileBytes / 1048576).toFixed(0) + " MB file" : ""}</p>`;
      h += `<p class="lg-note" data-ifi-venue>At ${esc(venue.name)}: ${esc(!at || !at.inside ? "outside the IFI grid" : at.text)}.</p>`;
    }
    h += `<div class="lg-note"><b>Model guidance</b>: NOAA's In-Flight Icing forecast, ${S.ifi.field === "prob" ? "icing probability as NOAA publishes it (0–1, non-dimensional)" : "icing severity in NOAA's categories (Table 4.228: none, trace, light, moderate, severe); cells below the ground have no value"}. Cyan fill, apart from turbulence guidance (violet), icing advisories (blue outlines) and pilot reports (rings).</div>`;
    return h;
  }
  function gtgSection() {
    if (!GT || !enOn()) return "";
    const L = gtg.latest, hh = gtgHeight(), base = mgBaseCycle();
    let h = "";
    if ((!isArchive() || S.gtg.src === "fixture" || S.ifi.src === "fixture") && (S.gtg.on || S.ifi.on)) { // shared by turbulence and icing
      h += `<div class="px-h"><span>Model guidance · height and time</span><span>${base ? "base cycle " + esc(T.fmtZ(new Date(gtgCycleMs(base)).toISOString())) : ""}</span></div>`;
      h += `<div class="tx-filters"><span class="tx-fl">Altitude</span><select class="input tx-sel" data-gtg-ft aria-label="Model guidance altitude">${GT.HEIGHTS.filter((x) => x.ft >= 1000).map((x) => `<option value="${x.ft}"${x.ft === hh.ft ? " selected" : ""}>${esc(GT.levelLabel(x.ft))} MSL</option>`).join("")}</select></div>`;
      h += `<div class="tx-filters"><span class="tx-fl">Valid</span><select class="input tx-sel" data-gtg-fh aria-label="Model guidance valid time">${Array.from({ length: 19 }, (_, f) => `<option value="${f}"${f === S.gtg.fh ? " selected" : ""}>${base ? esc(t(new Date(gtgCycleMs(base) + f * 3600e3).toISOString())) + " · " : ""}+${f} h</option>`).join("")}</select></div>`;
    }
    h += `<div class="px-h"><span>Model guidance · NOAA GTG</span><span>turbulence forecast</span></div>`;
    if (isArchive() && S.gtg.src !== "fixture") return h + `<p class="px-empty">Live only: GTG guidance is not part of this archived replay.</p>` + (IF ? ifiBlock() : "");
    if (!S.gtg.on) return h + `<button type="button" class="px-link" data-gtg-on="1">Show forecast turbulence guidance (one height and hour, about 1 MB) →</button>` + (IF ? ifiBlock() : "");
    h += `<div class="tx-filters"><span class="tx-fl">Aircraft</span>${["light", "medium", "heavy"].map((c) => `<button type="button" class="tx-fb" data-gtg-cls="${c}" aria-pressed="${S.gtg.cls === c}">${c}</button>`).join("")}</div>`;
    const th = GT.CLASSES[S.gtg.cls].t;
    h += `<div class="lg-row gtg-legend">${[1, 2, 3, 4].map((c) => `<span class="gtg-sw" style="background:rgba(${GT.PALETTE[c].slice(0, 3).join(",")},${(GT.PALETTE[c][3] / 255).toFixed(2)})"></span><span>${esc(GT.CAT_WORD[c])} ≥ ${th[c - 1].toFixed(2)}</span>`).join("")}</div>`;
    if (gtg.state === "loading") h += `<p class="px-empty">Loading GTG ${esc(GT.levelLabel(hh.ft))}, +${S.gtg.fh} h…</p>`;
    else if (gtg.state === "failed") h += `<p class="px-empty">GTG guidance not available (${esc(gtg.error || "unknown")}). Nothing is shown rather than an old field.</p>`;
    else if (gtg.state === "ok" && gtg.dec) {
      const d = gtg.dec, at = gtgAt([venue.lon, venue.lat]);
      h += `<p class="lg-note" data-gtg-status>Cycle ${esc(T.fmtZ(d.refTime))}${L && L.fixture ? " (saved official records)" : L && L.pinned ? " (pinned)" : ""}, valid ${esc(t(d.validTime, true))} (+${d.product.forecast} h) · EDR at ${esc(GT.levelLabel(hh.ft))} (${d.product.level.toLocaleString("en-US")} m MSL) · record ${(d.bytes / 1048576).toFixed(1)} MB of a ${d.fileBytes ? (d.fileBytes / 1048576).toFixed(0) + " MB" : ""} file</p>`;
      h += `<p class="lg-note" data-gtg-venue>At ${esc(venue.name)}: ${esc(gtgWord(at))}.</p>`;
    }
    h += `<div class="lg-note"><b>Model guidance</b>, not an observation or an advisory: GTG forecasts eddy dissipation rate (EDR, m<sup>2/3</sup> s<sup>-1</sup>) on a 3 km grid. Categories use AWC's EDR thresholds for the chosen aircraft class; what a flight feels depends on the aircraft. Tap the map for the value at a spot.</div>`;
    return h + (IF ? ifiBlock() : "");
  }
  const gtgCycleMs = (c) => Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8), +c.slice(8, 10));

  /* ---------- tropical (NHC context) ---------- */
  const nhcShown = () => !S.layers.tropical ? [] : data.products.filter((p) => p.kind === "tcoutlook" || p.kind === "tctrack");
  function tropicsSection() {
    if (!S.layers.tropical) return "";
    const ps = nhcShown(), cones = ps.filter((p) => p.part === "cone"), two = ps.filter((p) => p.kind === "tcoutlook"), st = data.state.nhc;
    let h = `<div class="px-h"><span>Tropics · NHC</span><span>regional context</span></div>`;
    if (!st || st.kind === "na") return h + `<p class="px-empty">NHC products are not part of this sample.</p>`;
    if (st.kind === "loading") return h + `<p class="px-empty">Loading NHC…</p>`;
    if (["unavailable", "stale"].includes(st.kind)) h += `<p class="px-empty">NHC not confirmed${data.sources.nhc && data.sources.nhc.error ? " (" + esc(data.sources.nhc.error) + ")" : ""}.</p>`;
    h += cones.length ? cones.map((p) => `<button type="button" class="tx-item" data-id="${esc(p.id)}" style="--tx-c:${colorOf(p)}"><span class="tx-kind k-nhc">NHC</span><span><b>${esc((p.stormType === "HU" ? "Hurricane " : p.stormType === "TS" ? "Tropical Storm " : "") + (p.storm || "Storm"))}</b><span class="tx-meta">Forecast cone · advisory ${esc(p.advisory || "")}${p.issued ? " · " + esc(t(p.issued, true)) : ""}</span><span class="tx-meta">The cone is the likely path of the storm's center; impacts reach well outside it. Use the NWS watches and warnings for the venue.</span></span></button>`).join("")
      : `<p class="px-empty">${["current", "empty"].includes(st.kind) ? "No active tropical cyclones in NHC's products." : ""}</p>`;
    if (two.length) h += two.map((p) => `<button type="button" class="tx-item" data-id="${esc(p.id)}" style="--tx-c:${colorOf(p)}"><span class="tx-kind k-nhc">OUTLOOK</span><span><b>${esc(p.basin || "")} area · ${esc(p.category)} chance of formation</b><span class="tx-meta">7 days ${esc(p.prob7 || "?")} · 2 days ${esc(p.prob2 || "?")}${p.issued ? " · " + esc(t(p.issued, true)) : ""}</span><span class="tx-meta">Graphical Tropical Weather Outlook: where a tropical cyclone could form, not a forecast of impacts</span></span></button>`).join("");
    return h;
  }
  function nhcDetail(p) {
    const rows = p.kind === "tcoutlook" ? [["Chance of formation", esc("2 days " + (p.prob2 || "?") + " · 7 days " + (p.prob7 || "?") + " (" + p.category + ")")], ["Basin", esc(p.basin || "")], ["Issued", p.issued ? esc(t(p.issued, true)) : ""], ["What it means", "Where NHC expects a tropical cyclone could form. It is not a forecast of where impacts will occur."]]
      : [["Storm", esc((p.storm || "") + (p.stormType ? " (" + p.stormType + ")" : ""))], ["Advisory", esc((p.advisory || "") + (p.issued ? " · " + t(p.issued, true) : ""))], ["Shown", esc(p.event + (p.validLabel ? " · " + p.validLabel : ""))], ["What it means", p.part === "cone" ? "The probable track of the storm's center (about two-thirds of the time). Hazards such as surge, wind and rain often extend well outside the cone." : p.part === "watchwarning" ? "The coastal segment under this NHC watch or warning. Planner uses the NWS products issued for each zone." : "NHC forecast for the storm's center."]];
    return `<button type="button" class="px-back" data-back>← Back</button><div style="--tx-c:${colorOf(p)}"><span class="tx-kind k-nhc">${esc(KIND_WORD[p.kind])}</span></div><div class="px-title">${esc(p.kind === "tcoutlook" ? "Tropical Weather Outlook area" : (p.storm || "Storm") + " · " + p.event)}</div><dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}<dt>Source</dt><dd><a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a></dd></dl>`;
  }

  /* ---------- smoke and air quality ---------- */
  const hmsShown = () => !S.layers.smoke ? [] : data.products.filter((p) => p.kind === "smoke" && Date.parse(p.obsEnd) <= now && now - Date.parse(p.obsEnd) < 24 * 3600e3);
  const monitorsShown = () => !S.layers.smoke ? [] : (isLive() && Live.monitorsAll ? Live.monitorsAll() : data.products.filter((p) => p.kind === "aqobs")).filter((p) => now - Date.parse(p.observed) <= 3 * 3600e3);
  const smokeAtVenue = () => { const at = hmsShown().filter((p) => T.contains(p.geometry, [venue.lon, venue.lat])); if (!at.length) return null; const latest = at.map((p) => p.obsEnd).sort().pop(); return at.filter((p) => p.obsEnd === latest).sort((a, b) => FX.HMS_DENSITY.indexOf(b.density) - FX.HMS_DENSITY.indexOf(a.density))[0]; };
  const nearMonitors = () => { const ids = new Set(), list = []; for (const p of [...monitorsShown(), ...data.products.filter((x) => x.kind === "aqobs")]) { if (ids.has(p.id)) continue; ids.add(p.id); const d = T.pointDistance([venue.lon, venue.lat], p.point); if (d.km <= T.NEAR_KM && now - Date.parse(p.observed) <= 3 * 3600e3) list.push({ p, d }); } return list.sort((a, b) => a.d.km - b.d.km); };
  function aqItem(p, d) {
    return `<button type="button" class="tx-item${S.hover === p.id ? " hl" : ""}" data-id="${esc(p.id)}" style="--tx-c:${colorOf(p)}"><svg class="tx-sw" width="30" height="16" aria-hidden="true"><circle cx="15" cy="8" r="6" fill="${colorOf(p)}" stroke="${pal().halo}" stroke-width="1.5"/></svg><span><span class="tx-kind k-aq">AIR NOW</span><b>AQI ${esc(p.aqi)} · ${esc(p.category)}</b>`
      + `<span class="tx-meta">${esc(p.pollutant)} at ${esc(p.site)}${d ? " · " + esc(T.distanceText(d.km) + " " + d.dir) : ""}</span><span class="tx-meta">Observed ${esc(t(p.observed, true))} · AirNow, preliminary</span></span></button>`;
  }
  function smokeSection(venueScope) {
    if (!S.layers.smoke) return "";
    const sm = smokeAtVenue(), near = nearMonitors(), fc = data.products.filter((p) => p.kind === "aqfcst" && (p.forVenue || T.pointDistance([venue.lon, venue.lat], p.point).km <= 80) && Date.parse(p.validEnd) > now), st = data.state;
    let h = `<div class="px-h"><span>Smoke and air quality</span><span>observed vs forecast</span></div>`;
    h += sm ? `<button type="button" class="tx-item" data-id="${esc(sm.id)}" style="--tx-c:${colorOf(sm)}">${swatch({ kind: "outlook", category: "x" }).replace(/fill="[^"]*"/, `fill="${colorOf(sm)}"`)}<span><span class="tx-kind k-aq">SATELLITE</span><b>Smoke detected over the area · ${esc(sm.density)}</b><span class="tx-meta">${esc(sm.satellite || "")} ${esc(t(sm.obsStart, true))} → ${esc(t(sm.obsEnd))}</span><span class="tx-meta">Smoke in the air column overhead; not a ground reading</span></span></button>`
      : `<p class="px-empty">${st.hms && ["current", "empty"].includes(st.hms.kind) ? "No smoke outlined over the venue in NOAA's satellite analysis (last 24 hours)." : st.hms && st.hms.kind === "na" ? "Satellite smoke is not part of this sample." : "Satellite smoke not confirmed" + (data.sources.hms && data.sources.hms.error ? " (" + esc(data.sources.hms.error) + ")" : "") + "."}</p>`;
    h += near.length ? near.slice(0, 3).map((x) => aqItem(x.p, x.d)).join("") : `<p class="px-empty">${st.aqobs && st.aqobs.kind === "na" ? "Surface readings are not part of this sample." : st.aqobs && st.aqobs.kind === "loading" ? "Loading AirNow readings…" : "No AirNow monitor reading within 15 miles in the last 3 hours: surface air quality isn't reported for this venue."}</p>`;
    if (fc.length) h += `<div class="px-also">AirNow forecast (${esc(fc[0].area)}): ${fc.sort((a, b) => (a.validDate < b.validDate ? -1 : 1)).map((p) => esc(new Date(p.validStart).toLocaleDateString("en-US", { timeZone: tz(), weekday: "short" }) + " " + p.category + (p.aqi != null ? " " + p.aqi : "") + " (" + p.pollutant + ")")).join(" · ")}</div>`;
    return h;
  }
  function smokeDetail(p) {
    const r = p.kind === "aqobs" ? T.pointDistance([venue.lon, venue.lat], p.point) : null;
    const rows = p.kind === "smoke" ? [["Observed", esc(t(p.obsStart, true)) + " → " + esc(t(p.obsEnd, true)) + ` <span class="mono" style="color:var(--muted)">${esc(T.fmtZ(p.obsStart))}–${esc(T.fmtZ(p.obsEnd))}</span>`], ["Satellite", esc(p.satellite || "")], ["Density", esc(p.density)], ["Venue", `<b>${esc(T.contains(p.geometry, [venue.lon, venue.lat]) ? "Over the venue" : relText(p))}</b>`], ["What it means", "Smoke anywhere in the air column, outlined by NOAA analysts from satellite imagery. It does not measure air quality at the ground."], ["Source", `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a>`]]
      : [["Reading", esc("AQI " + p.aqi + " " + p.category + " (" + p.pollutant + ")") + (p.pm25 != null ? esc(" · PM2.5 " + p.pm25 + " µg/m³") : "")], ["All pollutants", esc(Object.entries(p.values).map(([k, v]) => k + " " + v).join(", "))], ["Observed", esc(t(p.observed, true)) + " (hourly)"], ["Monitor", esc(p.site + (p.aqsid ? " · " + p.aqsid : ""))], ["Reporting area", esc((p.area || "").split("|")[0] || "not given")], ["Venue", `<b>${esc(T.distanceText(r.km) + " " + r.dir + " of the venue")}</b>`], ["Agency", esc(p.agency || "")], ["Note", "Preliminary AirNow data, not fully validated."], ["Source", `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a>`]];
    return `<button type="button" class="px-back" data-back>← Back</button><div style="--tx-c:${colorOf(p)}"><span class="tx-kind k-aq">${p.kind === "smoke" ? "SATELLITE SMOKE" : "AIR QUALITY"}</span></div><div class="px-title">${esc(p.kind === "smoke" ? p.density + " smoke detected" : p.site)}</div><dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }
  const FDAY_NAME = (d) => { const o = fireOut(d)[0], st = data.sources["fire" + d]; const v = o ? o.validStart : null; return v ? new Date(v).toLocaleDateString("en-US", { timeZone: tz(), weekday: "short", month: "short", day: "numeric" }) : "Day " + d; };
  function fireAt(d) { const pt = [venue.lon, venue.lat], ins = fireOut(d).filter((p) => T.contains(p.geometry, pt)); const pick = (part, order) => ins.filter((p) => p.part === part).sort((a, b) => order.indexOf(b.category) - order.indexOf(a.category))[0]; return { windrh: pick("windrh", d >= 3 ? FX.FIRE38_CATS : FX.FIRE_CATS), dryt: pick("dryt", d >= 3 ? FX.FIRE38_CATS : FX.DRYT_CATS) }; }
  const fireCatText = (p) => !p ? "" : p.day >= 3 ? (p.category === "CRIT" ? "Critical area" : FX.FIRE_NAME[p.category] + " chance of critical " + (p.part === "dryt" ? "dry thunderstorms" : "conditions")) : FX.FIRE_NAME[p.category] + (p.part === "dryt" ? "" : " (wind and humidity)");
  function firePanel() {
    const d = S.fday, st = data.state["fire" + d], src = data.sources["fire" + d], at = fireAt(d), ol = fireOut(d);
    let h = S.scope !== "venue" ? venueStrip() : "";
    h += `<div class="px-wlevels" role="group" aria-label="Outlook day">${[1, 2, 3, 4, 5, 6, 7, 8].map((x) => `<button type="button" data-fday="${x}" aria-pressed="${x === d}">${x <= 2 ? "Day " + x : "D" + x}</button>`).join("")}</div>`;
    const top = at.windrh || at.dryt;
    h += `<div class="px-brief"><div class="px-where">Fire weather at ${esc(venue.name)} · SPC Day ${d} · ${esc(FDAY_NAME(d))}</div><div class="px-big">${top ? esc([at.windrh && fireCatText(at.windrh), at.dryt && fireCatText(at.dryt)].filter(Boolean).join(" · ")) : st && ["current", "empty"].includes(st.kind) ? "No fire weather area at the venue" : st && st.kind === "na" ? "Not part of this sample" : st && st.kind === "loading" ? "Loading…" : "Not confirmed"}</div>`
      + `<div class="px-sub">${ol[0] ? "Valid " + esc(t(ol[0].validStart, true)) + " → " + esc(t(ol[0].validEnd, true)) : src && src.phrase ? "SPC: " + esc(src.phrase) : ""}</div>`
      + (top ? `<div class="px-also">${esc(FX.FIRE_MEANING[top.category] || "")} It rates the weather and fuels for the whole period, not whether a fire starts.</div>` : "") + `</div>`;
    h += `<div class="px-h"><span>Outlook areas · Day ${d}</span><span>${ol[0] ? "issued " + esc(T.fmtZ(ol[0].issued)) : ""}</span></div>` + (ol.length ? ol.slice().sort((a, b) => FX.FIRE_CATS.concat(FX.FIRE38_CATS).indexOf(b.category) - FX.FIRE_CATS.concat(FX.FIRE38_CATS).indexOf(a.category)).map((p) => item(p)).join("") : `<p class="px-empty">${st && st.kind === "na" ? "Not part of this archived sample." : src && src.phrase ? "SPC: " + esc(src.phrase) + "." : "No areas."}</p>`);
    if (d >= 3) h += `<p class="lg-note">Days 3–8: SPC's probability of critical fire weather conditions (or dry thunderstorms) within 12 miles of a point, 40% or 70%.</p>`;
    const near = nearbyIncidents();
    h += `<div class="px-h"><span>Wildfires near the venue</span><span>within ${Math.round(T.miles(T.NEAR_KM))} mi</span></div>` + (near.length ? near.map((x) => incItem(x.p, x.r)).join("") : `<p class="px-empty">${data.state.nifc && ["current", "empty"].includes(data.state.nifc.kind) ? "No active wildfire within 15 miles." : "NIFC incidents not confirmed."}</p>`);
    const fa = active().filter((p) => p.family === "fire" && rel(p).kind === "covers");
    if (fa.length) h += `<div class="px-h">Fire weather alerts in effect at the venue</div>` + fa.map((p) => item(p)).join("");
    return h;
  }

  /* ---------- WPC WSSI-P (winter view): windows, the chosen level's areas, and the chances at the venue ----------
     Archived samples carry the shapes; live, the windows, one level's shapes and the venue's point values come from the
     NOAA map service on demand (ThreatsLive.wssiWindows / wssiArea / wssiFor). */
  const W = { wins: null, area: new Map(), err: null, asked: new Set() };
  const wssiProducts = () => data.products.filter((p) => p.program === "wssip");
  function wssiWins() {
    if (!isLive()) { const m = new Map(); for (const p of wssiProducts()) m.set(p.validStart, { start: p.validStart, end: p.validEnd, issued: p.issued }); return [...m.values()].sort((a, b) => (a.start < b.start ? -1 : 1)); }
    return (W.wins || []).filter((w) => Date.parse(w.end) > now);
  }
  const curWin = () => { const ws = wssiWins(); return ws.find((w) => w.start === S.wwin) || ws[0] || null; };
  function wssiAreas() {
    const w = curWin(); if (!w) return [];
    if (!isLive()) return wssiProducts().filter((p) => p.geometry && p.category === S.wlevel && p.validStart === w.start);
    return W.area.get(S.wlevel + "|" + w.start) || [];
  }
  /* chances at the venue for every window: {start: {WWA: 95, MINOR: 60, ...}} */
  function venueWssi() {
    const out = new Map(), pt = [venue.lon, venue.lat];
    for (const p of wssiProducts()) {
      const hit = p.pointHit ? Math.abs(p.pointHit[0] - venue.lon) < 1e-3 && Math.abs(p.pointHit[1] - venue.lat) < 1e-3 : p.geometry && T.contains(p.geometry, pt);
      if (!hit) continue;
      if (!out.has(p.validStart)) out.set(p.validStart, {}); const o = out.get(p.validStart); o[p.category] = Math.max(o[p.category] || 0, p.prob);
    }
    return out;
  }
  function ensureWssi() {
    if (!isLive() || !winterView()) return;
    const once = (k, fn) => { if (W.asked.has(k)) return; W.asked.add(k); fn().then(() => { load(); drawAll(); }).catch((e) => { W.err = e.message; W.asked.delete(k); drawAll(); }); };
    once("wins", () => Live.wssiWindows().then((l) => { W.wins = l; W.err = null; }));
    const w = curWin(); if (w) once(S.wlevel + "|" + w.start, () => Live.wssiArea(S.wlevel, w.start).then((ps) => { W.area.set(S.wlevel + "|" + w.start, ps); }));
    once("pt|" + venue.lat.toFixed(3) + "," + venue.lon.toFixed(3), () => Live.wssiFor(venue.lat, venue.lon));
  }
  const pctTxt = (v) => (v >= 5 ? v + "%" : "under 5%");
  const winSpan = (w) => t(w.start, true) + " → " + t(w.end, true);
  const winShort = (w) => new Date(w.start).toLocaleString("en-US", { timeZone: tz(), weekday: "short", hour: "numeric" }) + " → " + new Date(w.end).toLocaleString("en-US", { timeZone: tz(), weekday: "short", hour: "numeric" });
  function topLevel(o) { let lv = null; for (const L of FX.WSSI_LEVELS) if (o && o[L] >= 30) lv = L; return lv; }
  function winterPanel() {
    const ws = wssiWins(), w = curWin(), vw = venueWssi(), st = data.state.wssip;
    let h = S.scope !== "venue" ? venueStrip() : "";
    if (!ws.length) {
      h += `<div class="px-brief"><div class="px-where">Winter outlook · WPC WSSI-P</div><div class="px-big">${st && st.kind === "loading" || (isLive() && !W.wins && !W.err) ? "Loading…" : W.err || (st && ["unavailable", "stale"].includes(st.kind)) ? "Not confirmed" : "No winter outlook in this sample"}</div><div class="px-sub">${esc(W.err ? "The NOAA map service did not answer (" + W.err + ")." : isArchive() && !wssiProducts().length ? "WSSI-P was not captured for this time; it is shown in the Nov 20 archived sample." : "")}</div></div>`;
      return h;
    }
    const o = vw.get(w.start) || {}, lv = topLevel(o);
    h += `<div class="px-brief"><div class="px-where">Winter outlook at ${esc(venue.name)} · WPC WSSI-P</div>`
      + `<div class="px-big">${lv ? esc(pctTxt(o[lv]) + " chance of at least " + (lv === "WWA" ? "winter weather" : WLEVEL_LABEL[lv] + " impacts")) : o.WWA ? esc(pctTxt(o.WWA) + " chance of winter weather") : "Under 5% for winter weather"}</div>`
      + `<div class="px-sub">24 hours ${esc(winSpan(w))}</div>`
      + `<div class="px-wlv">${FX.WSSI_LEVELS.map((L) => `<span><b>${esc(L === "WWA" ? "Winter weather" : WLEVEL_LABEL[L])}</b> ${esc(((data.sources.wssip || {}).unavailable || []).includes(L) ? "unavailable" : pctTxt(o[L] || 0))}</span>`).join("")}</div></div>`;
    h += `<label class="px-wsel"><span>24-hour window</span><select id="wssiWin">${ws.map((x) => `<option value="${esc(x.start)}"${x.start === w.start ? " selected" : ""}>${esc(winShort(x))}</option>`).join("")}</select></label>`;
    h += `<div class="px-wlevels" role="group" aria-label="Impact level drawn on the map">${FX.WSSI_LEVELS.map((L) => `<button type="button" data-wlevel="${L}" aria-pressed="${L === S.wlevel}">${esc(L === "WWA" ? "Any" : WLEVEL_LABEL[L])}</button>`).join("")}</div>`;
    h += `<p class="lg-note">Map: chance of at least <b>${esc(S.wlevel === "WWA" ? "winter weather" : WLEVEL_LABEL[S.wlevel] + " impacts")}</b> in this window. ${esc(FX.WSSI_MEANING[S.wlevel])}</p>`;
    h += `<div class="px-h"><span>Next 7 days at the venue</span><span>highest level with at least a 30% chance</span></div><div class="px-wdays">`
      + ws.filter((x) => +new Date(x.start).getUTCHours() % 12 === 0).map((x) => { const v = vw.get(x.start) || {}, l = topLevel(v); return `<button type="button" data-wwin="${esc(x.start)}" aria-pressed="${x.start === w.start}"><span>${esc(winShort(x))}</span><b>${l ? esc((l === "WWA" ? "Winter weather" : WLEVEL_LABEL[l]) + " " + v[l] + "%") : v.WWA ? "Winter weather " + esc(pctTxt(v.WWA)) : "Under 30%"}</b></button>`; }).join("") + `</div>`;
    const last = ws[ws.length - 1];
    h += `<p class="lg-note">WPC publishes rolling 24-hour windows every 6 hours out to Day 7; the last one ends ${esc(t(last.end, true))}. Issued ${esc(T.fmtZ(w.issued || ""))}. A chance for the whole 24 hours, not timing within it. <a href="${esc(SRC_LINK.wssip)}" target="_blank" rel="noopener">WPC WSSI-P</a></p>`;
    const wa = active().filter((p) => p.family === "winter" && rel(p).kind === "covers");
    if (wa.length) h += `<div class="px-h">Winter alerts in effect at the venue</div>` + wa.map((p) => item(p)).join("");
    return h;
  }
  const shortTitle = (p) => p.kind === "watch" ? p.event : p.kind === "md" ? "Mesoscale Discussion " + p.title.replace(/\D+/g, "") : p.title;
  const venueCovers = () => T.sort(active().filter((p) => rel(p).kind === "covers"));
  const venueNear = () => T.sort(active().filter((p) => rel(p).kind === "near"));
  const known = (k) => ["current", "empty", "na", "off"].includes(data.state[k].kind);
  const srcOn = (k) => data.state[k] && data.state[k].kind !== "off";
  /* the hazards whose NWS warnings, watches and advisories are loaded now, in words ("severe storm and winter") */
  const ALERT_WORD = { heat: "heat or cold", wind: "wind or visibility", severe: "severe storm", flood: "flood", winter: "winter", fire: "fire weather", tropical: "tropical", coastal: "coastal" };
  const alertWords = () => { const w = Object.keys(ALERT_WORD).filter((k) => S.layers[k]).map((k) => ALERT_WORD[k]); return w.length <= 2 ? w.join(" or ") : w.slice(0, -1).join(", ") + " or " + w[w.length - 1]; };
  const activeKnown = () => known("alerts") && known("md");
  /* when only one source is unconfirmed, say exactly which part is known */
  function quietText() {
    if (!srcOn("alerts")) return { big: "No warning layer on", sub: "The layers on now don't include NWS warnings and watches. Turn on Severe storms, Flooding, Winter, Fire, Tropical or Coastal to check the venue." };
    if (activeKnown()) return { big: "Nothing active at the venue", sub: "No " + alertWords() + " warning, watch or advisory is in effect at the venue" + (srcOn("md") ? ", and no SPC Mesoscale Discussion covers it." : ".") };
    if (known("alerts")) return { big: "No warning or watch at the venue", sub: "NWS checked " + t(data.sources.alerts.lastOk) + ". SPC Mesoscale Discussion status is unknown: that source is not responding." };
    return { big: "Venue status not confirmed", sub: "No product covers the venue in the data we have, but NWS warnings and watches are not confirmed (see below)." };
  }
  const SRC_LINK = { gauges: "https://water.noaa.gov/", reports: "https://www.spc.noaa.gov/climo/reports/", enroute: "https://aviationweather.gov/gfa/", faa: "https://nasstatus.faa.gov/", awc: "https://aviationweather.gov/", nhc: "https://www.nhc.noaa.gov/", hms: "https://www.ospo.noaa.gov/products/land/hms.html", aqobs: "https://www.airnow.gov/", aqfcst: "https://www.airnow.gov/", naqfc: "https://airquality.weather.gov/", monitors: "https://www.airnow.gov/", nifc: "https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-incident-locations/about", fire1: "https://www.spc.noaa.gov/products/fire_wx/fwdy1.html", fire2: "https://www.spc.noaa.gov/products/fire_wx/fwdy2.html", fire3: "https://www.spc.noaa.gov/products/exper/fire_wx/", fire4: "https://www.spc.noaa.gov/products/exper/fire_wx/", fire5: "https://www.spc.noaa.gov/products/exper/fire_wx/", fire6: "https://www.spc.noaa.gov/products/exper/fire_wx/", fire7: "https://www.spc.noaa.gov/products/exper/fire_wx/", fire8: "https://www.spc.noaa.gov/products/exper/fire_wx/", wssip: "https://www.wpc.ncep.noaa.gov/wwd/wssi/prob_wssi.php", ero1: FX.SOURCES.find((x) => x.id === "wpc-ero").url, ero2: FX.SOURCES.find((x) => x.id === "wpc-ero").url, ero3: FX.SOURCES.find((x) => x.id === "wpc-ero").url, day3: "https://www.spc.noaa.gov/products/outlook/day3otlk.html", alerts: "https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch,Severe%20Thunderstorm%20Watch", md: "https://www.spc.noaa.gov/products/md/", day1: "https://www.spc.noaa.gov/products/outlook/day1otlk.html", day2: "https://www.spc.noaa.gov/products/outlook/day2otlk.html" };

  /* ---------- map ---------- */
  async function getJSON(path) { const r = await fetch(path); if (!r.ok) throw Error(path + " " + r.status); return r.json(); }
  /* ---------- basemap: CARTO Voyager (light) or Dark Matter (dark), the vector street map Heads-Up uses (OpenStreetMap data:
     streets, towns, counties, water). If CARTO doesn't answer in 6 s, the simple outline map (states, lakes, major cities). ---------- */
  const CARTO = { light: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json", dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" };
  let carto = false, FONT = ["Open Sans Semibold"], OUR = [], attrib = null, cartoRetry = null;
  /* the fallback map is up: try CARTO again; on success swap to it, keeping our sources and layers (labels move to CARTO's fonts) */
  async function retryCarto() {
    if (carto || !map || !ready) return; const next = await cartoStyle(light() ? "light" : "dark"); if (!next || carto) return;
    clearInterval(cartoRetry); cartoRetry = null; carto = true; FONT = ["Montserrat SemiBold"];
    const prev = map.getStyle(), keepSrc = Object.fromEntries(Object.entries(prev.sources).filter(([k]) => !next.sources[k]));
    const ours = prev.layers.filter((l) => (OUR.includes(l.id) || l.id === "radar") && !["lakes", "states", "cities"].includes(l.id))
      .map((l) => (l.type === "symbol" && l.layout && l.layout["text-font"] ? { ...l, layout: { ...l.layout, "text-font": FONT } } : l));
    map.once("style.load", () => { baseLines(); orderOverBase(); themePaints(pal()); map.setMaxZoom(14); radar.tiles = null;
      if (attrib) map.removeControl(attrib); attrib = new maplibregl.AttributionControl({ compact: true }); map.addControl(attrib, "bottom-left"); drawAll(); });
    map.setStyle(next, { diff: false, transformStyle: () => ({ ...next, sources: { ...next.sources, ...keepSrc }, layers: [...next.layers, ...ours] }) });
  }
  async function cartoStyle(theme) {
    const c = new AbortController(), timer = setTimeout(() => c.abort(), 6000);
    try { const r = await fetch(CARTO[theme], { signal: c.signal }); if (!r.ok) throw Error("HTTP " + r.status); const j = await r.json(); if (!j.layers || !j.sources) throw Error("not a style"); return j; }
    catch (e) { return null; } finally { clearTimeout(timer); }
  }
  /* river gauges for the map's view, at regional zoom with Flooding on (queried by area, kept 15 minutes per area) */
  let gaugeTimer = null;
  function ensureGauges() {
    if (!map || !mapLoaded || !isLive() || !Live.gaugesIn || !S.layers.flood || viewDay() > 1 || winterView() || fireView() || map.getZoom() < 6) return;
    clearTimeout(gaugeTimer); gaugeTimer = setTimeout(() => { const b = map.getBounds(), r = (v) => Math.round(v * 2) / 2; // half-degree steps, so small pans reuse the answer
      Live.gaugesIn([r(b.getWest()) - 0.5, r(b.getSouth()) - 0.5, r(b.getEast()) + 0.5, r(b.getNorth()) + 0.5]).then(() => { load(); drawAll(); }, () => drawAll()); }, 400);
  }
  /* county lines and names: fetched once, on the first zoom in to regional level with County lines on */
  let countiesAsked = false;
  function ensureCounties() {
    if (!map || !mapLoaded || !map.getLayer("cnty-lines")) return; const vis = S.counties ? "visible" : "none";
    for (const id of ["cnty-lines", "cnty-labels"]) if (map.getLayoutProperty(id, "visibility") !== vis) map.setLayoutProperty(id, "visibility", vis);
    if (!S.counties || countiesAsked || map.getZoom() < 4.3) return; countiesAsked = true;
    Promise.all([getJSON("assets/geo/county-lines.json"), getJSON("assets/geo/county-labels.json")]).then(([l, n]) => { map.getSource("cnty-lines").setData(l); map.getSource("cnty-labels").setData(n); }).catch(() => { countiesAsked = false; });
  }
  /* our hazard fills and lines go under the basemap's labels (towns and streets stay readable); our own labels stay on top */
  function orderOverBase() {
    const st = map.getStyle(), ours = new Set(OUR), firstLabel = st.layers.find((l) => l.type === "symbol" && !ours.has(l.id));
    if (!firstLabel) return; for (const l of st.layers) if (ours.has(l.id) && (l.type !== "symbol" || l.id === "cnty-labels") && l.id !== "hu-state") map.moveLayer(l.id, firstLabel.id); // county names yield to town names
  }
  /* clearer state lines and county lines from zoom 6 (the basemap's own county lines start at zoom 9) */
  function baseLines() {
    const src = Object.keys(map.getStyle().sources).find((k) => map.getStyle().sources[k].type === "vector"); if (!src) return;
    const lt = light(), first = map.getStyle().layers.find((l) => l.type === "symbol");
    for (const [id, kd, mz, col, w] of [["hu-state", 4, 3, lt ? "rgba(70,78,90,.75)" : "rgba(200,206,216,.6)", [3, 0.8, 8, 1.8]]])
      if (!map.getLayer(id)) map.addLayer({ id, type: "line", source: src, "source-layer": "boundaries", minzoom: mz, filter: ["==", ["get", "kind_detail"], kd], paint: { "line-color": col, "line-width": ["interpolate", ["linear"], ["zoom"], w[0], w[1], w[2], w[3]] } }, first && first.id);
  }
  async function createMap() {
    const [states, lakes, base] = await Promise.all([getJSON("assets/severe-research/states.json"), getJSON("assets/severe-research/lakes.json"), cartoStyle(light() ? "light" : "dark")]);
    const p = pal(); carto = !!base; if (carto) FONT = ["Montserrat SemiBold"];
    map = new maplibregl.Map({ container: "txMap", bounds: CONUS, fitBoundsOptions: { padding: pad() }, minZoom: 1.5, maxZoom: carto ? 14 : 11, renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, attributionControl: false,
      style: base || { version: 8, glyphs: new URL("assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf", location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}"), sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": p.land } }] } });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    attrib = new maplibregl.AttributionControl({ compact: true, customAttribution: carto ? "" : "US Census / us-atlas · Natural Earth" }); map.addControl(attrib, "bottom-left");
    if (!carto) cartoRetry = setInterval(retryCarto, 5 * 60e3); // as in OPE: CARTO is tried again every 5 minutes while the fallback is up
    map.on("load", () => {
      const src = (id, d) => map.addSource(id, { type: "geojson", data: d || empty });
      src("states", states); src("lakes", lakes); src("cnty-lines"); src("cnty-labels");
      ["outlook", "ero", "wssi", "enr", "avroute", "pirep", "apt", "two", "tcone", "tline", "tpts", "hms", "aqmon", "fireo", "inc", "inc-pt", "lsr", "gauge", "active", "hl", "labels", "ring", "m-fill", "m-lines", "m-outside", "m-hull", "cities", "pt"].forEach((id) => src(id));
      map.addImage("hatch", hatch(), { pixelRatio: 2 });
      const L = (o) => { OUR.push(o.id); map.addLayer(o); };
      L({ id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": p.water } });
      /* county lines (US Census, us-atlas 10m; inside each state) from regional zoom, names from zoom 7.5: our own files, loaded on first zoom-in */
      L({ id: "cnty-lines", type: "line", source: "cnty-lines", minzoom: 4.5, paint: { "line-color": p.muted, "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.5, 0.18, 7, 0.4, 10, 0.55], "line-width": ["interpolate", ["linear"], ["zoom"], 4.5, 0.4, 8, 0.8, 11, 1.2] } });
      L({ id: "outlook-fill", type: "fill", source: "outlook", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.55 } });
      L({ id: "m-fill", type: "fill", source: "m-fill", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 } });
      L({ id: "m-lines", type: "line", source: "m-lines", paint: { "line-color": "#222", "line-width": 0.7, "line-opacity": 0.6 } });
      L({ id: "m-outside", type: "fill", source: "m-outside", paint: { "fill-pattern": "hatch", "fill-opacity": 0.3 } });
      L({ id: "m-hull", type: "line", source: "m-hull", paint: { "line-color": p.muted, "line-width": 1.2, "line-dasharray": [4, 3] } });
      L({ id: "states", type: "line", source: "states", paint: { "line-color": p.line, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.4], "line-opacity": 0.8 } });
      L({ id: "outlook-line", type: "line", source: "outlook", paint: { "line-color": ["get", "edge"], "line-width": ["get", "w"], "line-opacity": 0.95 } });
      L({ id: "ero-fill", type: "fill", source: "ero", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } });
      L({ id: "ero-line", type: "line", source: "ero", paint: { "line-color": ["get", "edge"], "line-width": ["get", "w"], "line-dasharray": [2.5, 1.2], "line-opacity": 0.95 } });
      L({ id: "wssi-fill", type: "fill", source: "wssi", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 } });
      L({ id: "wssi-line", type: "line", source: "wssi", paint: { "line-color": ["get", "color"], "line-width": 0.8, "line-opacity": 0.9 } });
      L({ id: "two-fill", type: "fill", source: "two", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 } });
      L({ id: "two-line", type: "line", source: "two", paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 1.5] } });
      L({ id: "tcone-fill", type: "fill", source: "tcone", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 } });
      L({ id: "tcone-line", type: "line", source: "tcone", paint: { "line-color": ["get", "color"], "line-width": 1.4 } });
      L({ id: "tline", type: "line", source: "tline", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["get", "w"] } });
      L({ id: "tpts", type: "circle", source: "tpts", paint: { "circle-radius": 5.5, "circle-color": ["get", "color"], "circle-stroke-color": "#000", "circle-stroke-width": 1 } });
      L({ id: "hms-fill", type: "fill", source: "hms", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "op"] } });
      L({ id: "hms-line", type: "line", source: "hms", paint: { "line-color": ["get", "color"], "line-width": 0.8, "line-opacity": 0.8 } });
      L({ id: "fireo-fill", type: "fill", source: "fireo", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } });
      L({ id: "fireo-line", type: "line", source: "fireo", paint: { "line-color": ["get", "color"], "line-width": 2.2, "line-opacity": 0.95 } });
      L({ id: "inc-fill", type: "fill", source: "inc", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.28 } });
      L({ id: "inc-line", type: "line", source: "inc", paint: { "line-color": ["get", "color"], "line-width": 1.6 } });
      // aviation en route: advisories (SIGMET and CWA solid, G-AIRMET dashed: a forecast snapshot), the approximate route, pilot reports
      // GTG model guidance: a raster under everything aviation (advisories are outlines, pilot reports dots and rings)
      map.addSource("gtg", { type: "image", url: BLANK_PNG, coordinates: [[-125, 50], [-66, 50], [-66, 24], [-125, 24]] });
      L({ id: "gtg-img", type: "raster", source: "gtg", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85, "raster-resampling": "nearest", "raster-fade-duration": 0 } });
      map.addSource("ifi", { type: "image", url: BLANK_PNG, coordinates: [[-125, 50], [-66, 50], [-66, 24], [-125, 24]] });
      L({ id: "ifi-img", type: "raster", source: "ifi", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85, "raster-resampling": "nearest", "raster-fade-duration": 0 } });
      L({ id: "enr-fill", type: "fill", source: "enr", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } });
      L({ id: "enr-line", type: "line", source: "enr", filter: ["!=", ["get", "kind"], "gairmet"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2.2, "line-opacity": 0.95 } });
      L({ id: "enr-line-fc", type: "line", source: "enr", filter: ["==", ["get", "kind"], "gairmet"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 1.8, "line-dasharray": [3, 2], "line-opacity": 0.95 } });
      L({ id: "route-case", type: "line", source: "avroute", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round" }, paint: { "line-color": p.halo, "line-width": 6, "line-opacity": 0.8 } });
      L({ id: "route-line", type: "line", source: "avroute", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "butt" }, paint: { "line-color": p.text, "line-width": 3, "line-dasharray": [3, 2], "line-opacity": 1 } });
      L({ id: "route-label", type: "symbol", source: "avroute", filter: ["==", ["geometry-type"], "LineString"], layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": FONT, "text-size": 11.5, "text-offset": [0, -0.9] }, paint: { "text-color": p.text, "text-halo-color": p.halo, "text-halo-width": 2 } });
      L({ id: "pirep-turb", type: "circle", source: "pirep", filter: ["==", ["get", "ice"], false], paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "color"], "circle-stroke-color": "#111", "circle-stroke-width": 1 } });
      L({ id: "pirep-ice", type: "circle", source: "pirep", filter: ["==", ["get", "ice"], true], paint: { "circle-radius": ["get", "r"], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 } });
      L({ id: "hl", type: "line", source: "hl", layout: { "line-join": "round" }, paint: { "line-color": p.text, "line-width": 9, "line-opacity": 0.55, "line-blur": 1 } });
      L({ id: "watch-fill", type: "fill", source: "active", filter: ["==", ["get", "kind"], "watch"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } });
      L({ id: "watch-line", type: "line", source: "active", filter: ["==", ["get", "kind"], "watch"], paint: { "line-color": ["get", "color"], "line-width": 2.6, "line-dasharray": [3, 2], "line-opacity": ["get", "op"] } });
      L({ id: "md-line", type: "line", source: "active", filter: ["==", ["get", "kind"], "md"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3.2, "line-dasharray": [0.1, 2.2], "line-opacity": ["get", "op"] } });
      L({ id: "adv-fill", type: "fill", source: "active", filter: ["in", ["get", "kind"], ["literal", ["advisory", "statement"]]], paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", ["get", "fill"], 0.6] } });
      L({ id: "adv-line", type: "line", source: "active", filter: ["in", ["get", "kind"], ["literal", ["advisory", "statement"]]], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": ["get", "op"] } });
      L({ id: "warn-fill", type: "fill", source: "active", filter: ["==", ["get", "kind"], "warning"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } });
      L({ id: "warn-case", type: "line", source: "active", filter: ["==", ["get", "kind"], "warning"], layout: { "line-join": "round" }, paint: { "line-color": p.halo, "line-width": 6, "line-opacity": 0.85 } });
      L({ id: "warn-line", type: "line", source: "active", filter: ["==", ["get", "kind"], "warning"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3.4 } });
      L({ id: "aqmon", type: "circle", source: "aqmon", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.2, 8, 6.5], "circle-color": ["get", "color"], "circle-stroke-color": "#222", "circle-stroke-width": 0.8, "circle-opacity": 0.95 } });
      // SPC storm reports: tornado red, wind blue, hail green; small dots, a white edge
      // NOAA river gauges (Flooding, regional zoom): filled by flood category, a grey ring when no category applies
      L({ id: "gauge", type: "circle", source: "gauge", minzoom: 5.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["match", ["get", "rank"], -1, 3, 4.5], 10, ["match", ["get", "rank"], -1, 5, 7.5]], "circle-color": ["get", "color"], "circle-opacity": ["match", ["get", "rank"], -1, 0, 0.95], "circle-stroke-color": ["match", ["get", "rank"], -1, "#8a8f98", "#fff"], "circle-stroke-width": ["match", ["get", "rank"], -1, 1.4, 1] } });
      L({ id: "lsr", type: "circle", source: "lsr", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, ["match", ["get", "type"], "tornado", 4.5, 3.2], 8, ["match", ["get", "type"], "tornado", 7, 5.5]], "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1, "circle-opacity": 0.95 } });
      L({ id: "inc-pt", type: "circle", source: "inc-pt", paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "color"], "circle-stroke-color": p.halo, "circle-stroke-width": 1.4, "circle-opacity": 0.92 } });
      L({ id: "apt", type: "circle", source: "apt", paint: { "circle-radius": 9, "circle-color": ["get", "color"], "circle-stroke-color": "#111", "circle-stroke-width": 2 } });
      L({ id: "apt-label", type: "symbol", source: "apt", layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": p.text, "text-halo-color": p.halo, "text-halo-width": 2 } });
      L({ id: "ring", type: "line", source: "ring", paint: { "line-color": p.text, "line-width": 1.2, "line-dasharray": [2, 3], "line-opacity": 0.7 } });
      L({ id: "pt", type: "circle", source: "pt", paint: { "circle-radius": 6, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": p.text, "circle-stroke-width": 2 } });
      L({ id: "cities", type: "symbol", source: "cities", layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 13], "text-padding": 6, "symbol-sort-key": ["get", "rank"] }, paint: { "text-color": p.muted, "text-halo-color": p.halo, "text-halo-width": 1.4 } });
      // at national zoom a county-sized warning is a few pixels wide: a marker keeps it findable.
      // Tornado: larger, with a ring; severe thunderstorm: smaller, solid. The shape differs, not only the color.
      L({ id: "warn-dot", type: "circle", source: "labels", maxzoom: 6.5, filter: ["==", ["get", "kind"], "warning"], paint: { "circle-radius": ["case", ["get", "tor"], 9.5, 6.5], "circle-color": ["get", "color"], "circle-stroke-color": p.halo, "circle-stroke-width": 2.5 } });
      L({ id: "warn-dot-core", type: "circle", source: "labels", maxzoom: 6.5, filter: ["all", ["==", ["get", "kind"], "warning"], ["get", "tor"]], paint: { "circle-radius": 3.2, "circle-color": p.halo } });
      // watch and MD names repeat along their own edges, so they stay readable at any zoom
      L({ id: "edge-labels", type: "symbol", source: "active", filter: ["in", ["get", "kind"], ["literal", ["watch", "md"]]], layout: { "symbol-placement": "line", "symbol-spacing": 340, "text-field": ["get", "text"], "text-font": FONT, "text-size": 11.5, "text-offset": [0, -0.9], "text-letter-spacing": 0.05 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2 } });
      L({ id: "labels", type: "symbol", source: "labels", filter: ["!=", ["get", "kind"], "warning"], layout: { "text-field": ["get", "text"], "text-font": FONT, "text-size": ["get", "size"], "text-padding": 4, "symbol-sort-key": ["get", "rank"], "text-max-width": 9 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2 } });
      // warning labels avoid each other; tornado warnings win the space. Markers above are always drawn.
      L({ id: "warn-labels", type: "symbol", source: "labels", minzoom: 3.2, filter: ["==", ["get", "kind"], "warning"], layout: { "text-field": ["get", "text"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 7, 13], "text-padding": 3, "symbol-sort-key": ["get", "rank"], "text-variable-anchor": ["bottom", "left", "right", "top"], "text-radial-offset": 1.15, "text-max-width": 20, "text-letter-spacing": 0.04 },
        paint: { "text-color": ["get", "tc"], "text-halo-color": ["get", "hc"], "text-halo-width": 2.4 } });
      L({ id: "cnty-labels", type: "symbol", source: "cnty-labels", minzoom: 7.5, layout: { "text-field": ["get", "n"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 7.5, 10, 11, 12], "text-transform": "uppercase", "text-letter-spacing": 0.08, "text-max-width": 8, "symbol-sort-key": 1 }, paint: { "text-color": p.muted, "text-halo-color": p.halo, "text-halo-width": 1.4, "text-opacity": 0.85 } });
      if (carto) { for (const id of ["lakes", "states", "cities"]) map.setLayoutProperty(id, "visibility", "none"); baseLines(); orderOverBase(); }
      map.on("moveend", ensureCounties); map.on("moveend", ensureGauges); // the street map has its own water, borders and places
      ready = true; drawAll();
    });
    map.on("click", (e) => {
      /* a dot (fire incident, air-quality monitor, airport, storm point, pilot report) or an advisory: its own detail. Dots are
         small, so the hit area is padded (a finger on a phone); areas go to "At this spot", which lists everything covering it */
      const dots = ["pirep-turb", "pirep-ice", "lsr", "gauge", "inc-pt", "aqmon", "apt", "tpts"].filter((l) => map.getLayer(l)), r = phone() ? 12 : 6;
      const f = dots.length ? map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: dots }) : [], g = map.getLayer("enr-fill") ? map.queryRenderedFeatures(e.point, { layers: ["enr-fill"] }) : [];
      const dist = (x) => { const q = map.project(x.geometry.coordinates); return Math.hypot(q.x - e.point.x, q.y - e.point.y); };
      const ids = [...new Set([...f.slice().sort((a, b) => dist(a) - dist(b)), ...g].map((x) => x.properties.id))].filter((id) => byId(id)), pt = [e.lngLat.lng, e.lngLat.lat];
      /* exactly one thing here (one dot or one advisory, and no other area): open it. Several overlap (reports on top of
         advisories, advisories on top of each other, a dot inside a warning): list them all to choose from */
      const areas = spotAreas(pt).filter((p) => !ids.includes(p.id));
      if (ids.length === 1 && !areas.length) { S.sel = ids[0]; S.point = null; S.pointHits = null; openSheet(); drawAll(); return; }
      S.point = pt; S.pointHits = ids; S.sel = null; openSheet(); drawAll(); });
    const hits = ["gauge", "lsr", "pirep-turb", "pirep-ice", "enr-fill", "apt", "tpts", "tcone-fill", "two-fill", "aqmon", "hms-fill", "inc-pt", "inc-fill", "fireo-fill", "warn-fill", "adv-fill", "watch-fill", "outlook-fill", "wssi-fill", "warn-dot"];
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
    const c = pal(), wv = winterView(), fv = fireView(), day = wv || fv ? 1 : viewDay(), focus = S.sel || S.hover;
    // Active now: everything. Day 1: current warnings as outlines, labelled Active now. Day 2: no current geometry.
    // Winter outlook: current winter warnings and advisories as outlines over the WSSI-P areas.
    const act = day === 2 || day === 3 ? [] : active().filter((p) => p.geometry && (!day || p.kind === "warning" || (wv && p.family === "winter") || (fv && p.family === "fire")) && (!wv || p.family === "winter") && (!fv || p.family === "fire"));
    map.getSource("active").setData({ type: "FeatureCollection", features: act.map((p) => feature(p, { kind: p.kind, color: colorOf(p), op: unconfirmed(p) ? 0.6 : 1, fill: day ? 0 : unconfirmed(p) ? 0.16 : 0.3, day: day || 0, text: labelText(p), tc: c.text, hc: c.halo })) });
    { const ap = avProducts(), ids = [...new Set(ap.map((p) => p.airport))];
      map.getSource("apt").setData({ type: "FeatureCollection", features: ids.map((id) => { const m = ap.filter((p) => p.kind === "metar" && p.airport === id).sort((a, b) => (a.observed < b.observed ? 1 : -1))[0], any = m || ap.find((p) => p.airport === id); return { type: "Feature", properties: { id: (m || any).id, color: m ? FLT_COLOR[m.category] : "#9aa3ad", label: id + (m ? " · " + m.category : "") }, geometry: { type: "Point", coordinates: any.point } }; }) }); }
    { const en = day === 2 || day === 3 || wv || fv ? [] : enShown(), adv = en.filter((x) => x.kind !== "pirep"), rp = en.filter((x) => x.kind === "pirep");
      map.getSource("enr").setData({ type: "FeatureCollection", features: adv.map((x) => feature(x, { kind: x.kind, color: EN_COLOR[x.hazardFamily] || EN_COLOR.other, fill: focus === x.id ? 0.32 : 0.12 })) });
      map.getSource("pirep").setData({ type: "FeatureCollection", features: rp.map((x) => ({ type: "Feature", properties: { id: x.id, color: PIREP_COLOR(x.rank), r: x.rank >= 2 ? 6.5 : 4.5, ice: !x.turb.length }, geometry: { type: "Point", coordinates: x.point } })) });
      const rr = routeEnds(); map.getSource("avroute").setData({ type: "FeatureCollection", features: rr ? [{ type: "Feature", properties: { label: "Approximate route " + S.route.o + " to " + S.route.d }, geometry: { type: "LineString", coordinates: [rr.o, rr.d] } }] : [] }); }
    const ns = day === 2 || day === 3 || wv || fv ? [] : nhcShown(), tcol = light() ? "#333" : "#f2f2f2";
    map.getSource("two").setData({ type: "FeatureCollection", features: ns.filter((p) => p.kind === "tcoutlook" && p.geometry).map((p) => feature(p, { color: colorOf(p) })) });
    map.getSource("tcone").setData({ type: "FeatureCollection", features: ns.filter((p) => p.part === "cone").map((p) => feature(p, { color: tcol })) });
    map.getSource("tline").setData({ type: "FeatureCollection", features: ns.filter((p) => p.part === "track" || p.part === "watchwarning").map((p) => feature(p, { color: colorOf(p), w: p.part === "track" ? 2 : 5 })) });
    map.getSource("tpts").setData({ type: "FeatureCollection", features: ns.filter((p) => p.part === "points").map((p) => feature(p, { color: p.category === "HU" || p.category === "MH" ? "#DC143C" : p.category === "TS" ? "#F59E3B" : "#9AA3AD" })) });
    const hs = day === 2 || day === 3 || wv || fv ? [] : hmsShown(), ms = day === 2 || day === 3 || wv || fv ? [] : monitorsShown();
    map.getSource("hms").setData({ type: "FeatureCollection", features: hs.slice().sort((a, b) => FX.HMS_DENSITY.indexOf(a.density) - FX.HMS_DENSITY.indexOf(b.density)).map((p) => feature(p, { color: HMS_FILL[p.density][0], op: HMS_FILL[p.density][1] })) });
    map.getSource("aqmon").setData({ type: "FeatureCollection", features: ms.map((p) => ({ type: "Feature", properties: { id: p.id, color: AQI_COLOR[p.category] }, geometry: { type: "Point", coordinates: p.point } })) });
    const fo = fv ? fireOut(S.fday) : [];
    map.getSource("fireo").setData({ type: "FeatureCollection", features: fo.slice().sort((a, b) => (a.part === "dryt") - (b.part === "dryt")).map((p) => feature(p, { color: FIRE_COLOR[p.category], fill: p.part === "dryt" ? 0.15 : 0.42 })) });
    const inc = day === 2 || day === 3 ? [] : incidents();
    map.getSource("inc").setData({ type: "FeatureCollection", features: inc.filter((p) => p.geometry).map((p) => feature(p, { color: colorOf(p) })) });
    { const ls = day === 2 || day === 3 || winterView() || fireView() || !S.layers.severe ? [] : data.products.filter((p) => p.kind === "lsr"); map.getSource("lsr").setData({ type: "FeatureCollection", features: ls.map((p) => ({ type: "Feature", properties: { id: p.id, type: p.type, color: LSR_COLOR[p.type] }, geometry: { type: "Point", coordinates: p.point } })) }); }
    { const gs = day === 2 || day === 3 || winterView() || fireView() || !S.layers.flood ? [] : data.products.filter((p) => p.kind === "gauge"); map.getSource("gauge").setData({ type: "FeatureCollection", features: gs.map((p) => ({ type: "Feature", properties: { id: p.id, rank: p.rank, color: GAUGE_COLOR[p.category] || "#8a8f98" }, geometry: { type: "Point", coordinates: p.point } })) }); }
    map.getSource("inc-pt").setData({ type: "FeatureCollection", features: inc.map((p) => ({ type: "Feature", properties: { id: p.id, color: colorOf(p), r: p.acres >= 10000 ? 8 : p.acres >= 1000 ? 6.5 : p.acres >= 100 ? 5 : 3.6 }, geometry: { type: "Point", coordinates: p.point } })) });
    const wa = wv ? wssiAreas() : [];
    map.getSource("wssi").setData({ type: "FeatureCollection", features: wa.filter((p) => p.geometry).sort((a, b) => a.prob - b.prob).map((p) => feature(p, { color: wssiColor(p.prob) })) });
    // outlooks: filled in their own day view (outline only when our model is on); outlines as context in Active now
    const ol = !S.layers.severe || wv || fv ? [] : day ? outlooks(day) : S.ctx ? outlooks(1) : [];
    // WPC excessive rainfall in the day views: filled when it is the only outlook layer on, dashed outlines over SPC otherwise
    const el = day && !wv && !fv && S.layers.flood ? eroOut(day) : [], eroFill = !S.layers.severe && !S.model;
    map.getSource("ero").setData({ type: "FeatureCollection", features: el.map((p) => feature(p, { color: ERO_COLOR[p.category], edge: eroFill ? shade(ERO_COLOR[p.category]) : ERO_COLOR[p.category], fill: eroFill ? 0.5 : 0, w: eroFill ? 1.2 : 2.8 })) });
    const filled = day && !wv && !fv && !S.model && S.layers.severe;
    map.getSource("outlook").setData({ type: "FeatureCollection", features: ol.map((p) => feature(p, { color: OUTLOOK_COLOR[p.category], edge: filled ? shade(OUTLOOK_COLOR[p.category]) : OUTLOOK_COLOR[p.category], w: filled ? 1 : day ? 2.6 : 1.4 })) });
    map.setLayoutProperty("outlook-fill", "visibility", filled ? "visible" : "none");
    map.setPaintProperty("warn-line", "line-dasharray", day === 1 ? [2, 1] : [1, 0]); // Day 1: current warnings dashed, "Active now"
    map.setPaintProperty("outlook-line", "line-opacity", day ? 0.95 : 0.7);
    const labels = [];
    for (const p of act) if (p.kind === "warning" || p.kind === "advisory") labels.push({ p, text: (day ? "ACTIVE NOW · " : "") + labelText(p), size: 13, rank: isTor(p) ? 0 : 1, tc: c.halo, hc: colorOf(p) });
    for (const p of ol) if (p.category !== "TSTM" || day) labels.push({ p, text: p.category, size: day ? 12 : 10, rank: 5, tc: c.text, hc: c.halo });
    for (const p of fo) if (p.label) labels.push({ p, text: p.day >= 3 ? (p.category === "CRIT" ? "CRITICAL" : FX.FIRE_NAME[p.category]) : p.category, size: 11.5, rank: 4, tc: c.text, hc: c.halo });
    for (const p of inc) if (p.acres >= 1000 || p.geometry) labels.push({ p, text: p.name + " · " + Math.round(p.acres || 0).toLocaleString("en-US") + " ac", size: 11, rank: 6, tc: c.text, hc: c.halo });
    for (const p of el) labels.push({ p, text: "ERO " + p.category, size: 11.5, rank: 4, tc: c.text, hc: c.halo });
    map.getSource("labels").setData({ type: "FeatureCollection", features: labels.filter((l) => l.p.label).map((l) => ({ type: "Feature", properties: { kind: l.p.kind === "incident" ? "inc" : l.p.kind, tor: isTor(l.p), color: colorOf(l.p), text: l.text, size: l.size, rank: l.rank, tc: l.tc, hc: l.hc }, geometry: { type: "Point", coordinates: l.p.label } })) });
    const fp = focus && byId(focus);
    map.getSource("hl").setData(fp && fp.geometry && !(day === 2 && fp.kind !== "outlook") ? { type: "FeatureCollection", features: [feature(fp, {})] } : empty);
    map.getSource("ring").setData(S.scope === "venue" && S.pin ? { type: "FeatureCollection", features: [ring([venue.lon, venue.lat], T.NEAR_KM)] } : empty);
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
    marker.getElement().style.display = S.pin ? "" : "none"; // "Venue marker" off in Layers: just the map
    drawModel();
  }
  function shade(hex) { if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return "#888888"; const n = parseInt(hex.slice(1), 16), f = 0.62; return "rgb(" + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f)).join(",") + ")"; }
  function labelText(p) {
    const u = (unconfirmed(p) ? " (last known)" : "") + (p.geometryIncomplete && p.zoneInfo && p.zoneInfo.counties ? " (area incomplete)" : "");
    if (p.kind === "warning") return p.event.toUpperCase() + u;
    if (p.kind === "watch" || p.kind === "advisory") return (p.kind === "advisory" ? p.event : p.title).toUpperCase() + u;
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
    return [part(z.counties.listed, z.counties.drawn, "county", "counties"), part((z.zones || {}).listed, (z.zones || {}).drawn, "NWS forecast zone", "NWS forecast zones"), part(z.marine.listed, z.marine.drawn, "marine zone", "marine zones")].filter(Boolean).join(" and ");
  }
  const countyText = (p) => !p.zoneInfo || !p.zoneInfo.counties ? "Area: listed counties and marine zones (shapes loading)" : p.geometryIncomplete ? "Incomplete area: drawn from " + zoneCount(p.zoneInfo, true) : "Area drawn from " + zoneCount(p.zoneInfo, false);
  /* how often what is on now refreshes (only feeds that are loaded) */
  function refreshNote() {
    const on = (Live.mapFeeds && Live.mapFeeds()) || [], parts = [];
    const fast = ["alerts", "md"].filter((k) => on.includes(k)).map((k) => (k === "alerts" ? "warnings" : "MDs")), slow = ["spc", "ero", "fire"].some((k) => on.includes(k));
    if (fast.length) parts.push(fast.join(" and ") + " every minute"); if (slow) parts.push("outlooks every 10 minutes"); if (on.includes("nifc")) parts.push("wildfires every 5 minutes");
    if (on.includes("hms") || on.includes("monitors")) parts.push("smoke and air quality every 10 minutes"); if (on.includes("nhc")) parts.push("NHC every 10 minutes");
    if (S.radar && isLive()) parts.push("radar every 5 minutes");
    return parts.length ? ". Refreshes: " + parts.join(", ") : "";
  }
  function sources() {
    const vd = viewDay() || 1;
    const rows = (winterView() ? ["alerts", "wssip"] : fireView() ? ["alerts", "fire" + S.fday, "nifc"] : ["alerts", ...(S.layers.severe ? ["md", "day" + vd, ...(!viewDay() || viewDay() === 1 ? ["reports"] : [])] : []), ...(S.layers.flood ? ["ero" + vd, ...(!viewDay() || viewDay() === 1 ? ["gauges"] : [])] : []), ...(S.layers.fire ? ["nifc"] : []), ...(S.layers.smoke ? ["hms", "aqobs", "aqfcst", ...(FX.NAQFC_ENABLED ? ["naqfc"] : []), ...(isLive() ? ["monitors"] : [])] : []), ...(S.layers.tropical ? ["nhc"] : []), ...(S.layers.aviation && (S.air.length || avProducts().length) ? ["awc"] : []), ...(enOn() ? ["enroute"] : []), ...(S.layers.aviation && (S.air.length || S.route) ? ["faa"] : [])]).filter((k) => data.sources[k] && data.state[k] && data.state[k].kind !== "off").map((k) => {
      const s = data.state[k], src = data.sources[k];
      const right = s.kind === "na" ? "Not part of this archived sample" : isArchive() ? "Archived official messages, replayed" : k === "md" && src.via === "service" && s.kind !== "stale" ? "Checked " + t(src.lastOk) + " via NOAA map service" + (s.kind === "empty" ? " · none active" : "") : s.kind === "loading" ? "Loading…" : s.kind === "unavailable" ? "Not responding · status unknown" : s.kind === "stale" ? "Last confirmed " + t(src.lastOk) : "Checked " + t(src.lastOk) + (k.startsWith("day") ? (src.outlook === "expired" ? " · expired, awaiting next issuance" : "") : s.kind === "empty" ? " · none active" : "");
      const name = official() && s.kind !== "na" ? `<a href="${esc(SRC_LINK[k])}" target="_blank" rel="noopener">${esc(SRC_NAME[k])}</a>` : esc(SRC_NAME[k]);
      return `<div class="px-src ${s.kind}"${src.error ? ` title="${esc(src.error)}"` : ""}><span><b>${name}</b></span><span>${esc(right)}</span></div>`;
    }).join("");
    const foot = isArchive() ? `Archived sample: ${esc(data.archive ? data.archive.label : "")}. Official messages replayed through the same adapter the live preview uses; the clock is set to the message time. Not a live observation. Times in ${esc(tzName(venue.tz))}.` : isLive() ? `Live official feeds, fetched by your browser${refreshNote()}. Times in ${esc(tzName(venue.tz))}. A failed refresh never clears a product.` : `Demo clock ${esc(t(data.clock, true))}. A failed refresh never clears a product.`;
    return `<div class="px-sources" aria-label="Source status">${rows}${radarRow()}<div class="lg-note">${foot}</div></div>`;
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
    for (const p of covers.filter((x) => ["warning", "watch", "advisory"].includes(x.kind))) {
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
    if (!S.pin) return "";
    const l = statusLines()[0];
    const text = l ? `<b>${esc(l.head)}</b> · ${esc(l.sub)}` : esc(quietText().big);
    return `<button type="button" class="px-strip${l && l.p.kind === "warning" ? " hot" : ""}" data-scope-go="venue" style="--tx-c:${l ? colorOf(l.p) : "var(--line)"}"><span class="px-where">At ${esc(venue.name)}</span><span class="px-strip-t">${text}</span><span class="px-strip-go">Venue view →</span></button>`;
  }
  /* only Aviation on: lead with it, and say the other hazards are off (instead of an empty warnings list) */
  const avOnly = () => S.layers.aviation && !["severe", "flood", "winter", "fire", "smoke", "tropical", "coastal"].some((k) => S.layers[k]);
  /* Aviation-only view: lead with what Aviation shows at the venue, part by part, available or not (and why) */
  function avSummary() {
    const d = viewDay(), early = d === 2 || d === 3 || winterView() || fireView(), en = enShown(), rp = en.filter((x) => x.kind === "pirep"), ad = en.filter((x) => x.kind !== "pirep"), est = data.state.enroute;
    const ids = S.air.length ? S.air : [...new Set(avProducts().map((x) => x.airport))], awc = data.state.awc;
    const enWhy = () => (early ? "shown on Active now and Day 1 only" : !enOn() ? "off" : !est || est.kind === "loading" ? "loading…" : ["unavailable", "stale"].includes(est.kind) ? "not available (Aviation Weather Center not answering)" : null);
    const mg = (on, st, err, what) => (!on ? "off" : st === "loading" ? "loading…" : st === "ok" ? what : "not available" + (err ? ": " + err : ""));
    const rows = [
      ["Airport weather", !S.av.apt ? "off" : !ids.length ? "no airports on this map (they come from an event's airports or a shared link)" : awc && ["unavailable", "stale"].includes(awc.kind) ? ids.join(", ") + ": not confirmed (Aviation Weather Center not answering)" : ids.join(", ") + ": METAR and TAF"],
      ["Pilot reports", !S.av.pireps ? "off" : enWhy() || (S.en.at ? "past observations: shown at Now only" : "National: " + rp.length + " in the last " + S.en.age + " h (" + rp.filter((x) => x.rank >= 2).length + " moderate or worse)")],
      ["Advisories", !S.av.adv ? "off" : enWhy() || "National: " + ad.length + " in effect" + (S.en.at ? " at +" + S.en.at + " h" : " now")],
      ["Turbulence guidance", mg(S.gtg.on, gtg.state, gtg.error, gtg.dec ? GT.levelLabel(gtgHeight().ft) + ", valid " + t(gtg.dec.validTime) : "")],
      ["Icing guidance", mg(S.ifi.on, ifi.state, ifi.reason, ifi.dec ? IF.levelLabel(S.gtg.ft) + ", valid " + t(ifi.dec.validTime) : "")],
    ];
    /* the venue's own part (its airports' weather) apart from the national counts, so these never read as the venue's */
    const nat = [S.av.pireps && enOn() && !early ? (enWhy() ? "pilot reports " + enWhy().replace(/…$/, "") : rp.length + " pilot report" + (rp.length === 1 ? "" : "s")) : null, S.av.adv && enOn() && !early ? (enWhy() ? "advisories " + enWhy().replace(/…$/, "") : ad.length + " advisor" + (ad.length === 1 ? "y" : "ies")) : null].filter(Boolean);
    const head = "Aviation at " + venue.name, n = [ids.length && S.av.apt ? "airport weather: " + ids.join(", ") : null, nat.length ? "National · " + nat.join(" · ") : null, S.gtg.on ? "turbulence " + (gtg.state === "ok" ? "on" : gtg.state) : null, S.ifi.on ? "icing " + (ifi.state === "ok" ? "on" : ifi.state) : null].filter(Boolean);
    return { head, sub: n.join(" · ") || "nothing turned on yet: choose in Aviation shows", rows };
  }
  function avSummaryCard() {
    const a = avSummary(), un = (v) => /^(off|loading|not |no airports|shown on|past obs)/.test(v);
    return `<div class="px-status av-status" data-av-summary><div class="px-status-l">${esc(viewName())} · ${esc(S.scope === "venue" ? "venue" : "national map")}</div><div class="px-status-h">${esc(a.head)}</div><dl class="px-rows av-rows">${a.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${un(v) ? "av-un" : ""}">${esc(v)}</dd>`).join("")}</dl></div>`;
  }
  const avOnlyNote = () => `<div class="px-h">Other hazards</div><p class="px-empty">Only Aviation is on. Turn on warnings and other hazards in Layers.</p>`;
  /* the national grouping only changes when the active products (or their drawn outlines) change: reuse it between redraws */
  let groupMemo = { key: null, groups: null }; const pairCache = new Map();
  function groupsNow() {
    const list = active(), key = list.map((p) => p.id + "|" + (p.updated || p.issued || "") + "|" + (p.geometry ? p.geometry.type + (p.geometry.coordinates || []).length + ":" + ((p.geometry.coordinates || [])[0] || []).length + (p.geometryIncomplete ? "i" : "") : 0)).join(",");
    if (groupMemo.key !== key) { if (pairCache.size > 400000) pairCache.clear(); groupMemo = { key, groups: T.group(list, PLACES, pairCache) }; }
    return groupMemo.groups;
  }
  /* storm reports in the last 24 h: near the venue (within 25 mi), and a national count */
  const reportsShown = () => !S.layers.severe || viewDay() > 1 || winterView() || fireView() ? [] : data.products.filter((p) => p.kind === "lsr");
  function reportsSection(venueOnly) {
    const all = reportsShown(); if (!all.length && !(S.layers.severe && data.state.reports)) return "";
    const st = data.state.reports, by = (k) => all.filter((p) => p.type === k).length;
    if (venueOnly) { const near = all.map((p) => ({ p, d: T.pointDistance([venue.lon, venue.lat], p.point) })).filter((x) => T.miles(x.d.km) <= 25).sort((a, b) => (a.p.observed < b.p.observed ? 1 : -1));
      if (!near.length) return ""; return `<div class="px-h" data-reports="venue"><span>Storm reports within 25 mi · last 24 h</span><span>${near.length}</span></div>` + near.slice(0, 6).map((x) => spotItem(x.p)).join(""); }
    if (!all.length) return st && ["current", "empty"].includes(st.kind) ? `<div class="px-h" data-reports="national"><span>Storm reports · last 24 h</span><span>none</span></div>` : "";
    const top = all.slice().sort((a, b) => ({ tornado: 0, hail: 1, wind: 2 }[a.type] - { tornado: 0, hail: 1, wind: 2 }[b.type]) || (b.magnitude || 0) - (a.magnitude || 0)).slice(0, 4);
    return `<div class="px-h" data-reports="national"><span>Storm reports · last 24 h</span><span>${by("tornado")} tornado · ${by("wind")} wind · ${by("hail")} hail</span></div>` + top.map(spotItem).join("");
  }
  function nationalActive() {
    if (avOnly()) return avSummaryCard() + notices() + avControls() + airportsSection() + enrouteSection() + avOnlyNote();
    const groups = groupsNow();
    let h = venueStrip() + notices() + `<div class="px-h"><span>Most urgent now</span><span>${groups.reduce((n, g) => n + g.items.length, 0)} active</span></div>`;
    if (!groups.length) h += `<p class="px-empty">${!srcOn("alerts") ? "The layers on now don't include NWS warnings and watches." : activeKnown() ? "No active " + alertWords() + " warnings, watches or advisories" + (srcOn("md") ? ", and no SPC Mesoscale Discussions," : "") + " in the U.S." : (known("alerts") ? "No active " + alertWords() + " warnings, watches or advisories in the U.S. (NWS checked " + esc(t(data.sources.alerts.lastOk)) + "). SPC Mesoscale Discussion status is unknown." : "None in the data we have, but NWS warnings and watches are not confirmed (see below).")}</p><p class="lg-note">${esc(SCOPE_NOTE)}</p>`;
    for (const g of groups) {
      const gp = g.lead.label || g.centre, o = gp ? T.outlookAt(outlooks(1), gp) : null; // zone-based alerts have no location until their zone shapes load
      const counts = ["warning", "watch", "md"].map((k) => [k, g.items.filter((p) => p.kind === k).length]).filter(([, n]) => n).map(([k, n]) => n + " " + ({ warning: "warning", watch: "watch", md: "MD" }[k]) + (n > 1 ? (k === "watch" ? "es" : "s") : "")).join(" · ");
      h += `<div class="px-group"><div class="px-group-h">${esc(g.name)}<span>${esc(counts)}</span></div>${g.items.map((p) => item(p, { rel: false })).join("")}${o ? `<div class="px-group-f">Inside the Day 1 ${esc(T.outlookLabel(o.category).toLowerCase())} area</div>` : ""}</div>`;
    }
    h += reportsSection(false) + (S.layers.aviation ? avControls() : "") + airportsSection() + enrouteSection() + tropicsSection();
    if (S.layers.smoke) { const bad = monitorsShown().filter((p) => FX.AQI_CAT_ORDER.indexOf(p.category) >= 2).sort((a, b) => b.aqi - a.aqi); h += `<div class="px-h"><span>Air quality now · AirNow</span><span>${bad.length} monitor${bad.length === 1 ? "" : "s"} at USG or worse</span></div>` + (bad.length ? bad.slice(0, 5).map((p) => aqItem(p, null)).join("") : `<p class="px-empty">${data.state.monitors && ["current", "empty"].includes(data.state.monitors.kind) ? "No U.S. monitor at Unhealthy for Sensitive Groups or worse in the last 3 hours." : "AirNow monitors not confirmed."}</p>`) + `<p class="lg-note">${hmsShown().length} smoke areas in NOAA's satellite analysis (last 24 h). Satellite smoke is overhead smoke, not a ground reading.</p>`; }
    if (S.layers.fire) { const wf = incidents().filter((p) => p.category !== "RX"); if (wf.length) h += `<div class="px-h"><span>Largest active wildfires · NIFC</span><span>${wf.length} current</span></div>` + wf.slice().sort((a, b) => (b.acres || 0) - (a.acres || 0)).slice(0, 5).map((p) => incItem(p, null)).join(""); }
    h += `<div class="px-h">Forecast for later</div>` + laterButtons(null);
    return h;
  }
  function venueActive() {
    if (avOnly()) return avSummaryCard() + notices() + avControls() + airportsSection() + enrouteSection() + avOnlyNote();
    const list = T.sort(active()), covers = venueCovers(), near = venueNear(), unknown = list.filter((p) => rel(p).kind === "unknown");
    let h = statusHTML(true) + notices() + venueFcSection();
    if (covers.length) h += `<div class="px-h">At the venue</div>` + covers.map((p) => item(p)).join("");
    if (near.length) h += `<div class="px-h"><span>Nearby · the venue is outside these</span><span>within ${Math.round(T.miles(T.NEAR_KM))} mi</span></div>` + near.map((p) => item(p)).join("");
    if (unknown.length) h += `<div class="px-h">Area not drawn</div>` + unknown.map((p) => item(p)).join("");
    if (!covers.length && !near.length && activeKnown()) h += `<p class="lg-note">${esc(SCOPE_NOTE)}</p>`;
    h += reportsSection(true);
    if (S.layers.flood) { const near = data.products.filter((p) => p.kind === "gauge" && p.rank >= 1 && T.miles(T.pointDistance([venue.lon, venue.lat], p.point).km) <= 25); if (near.length) h += `<div class="px-h" data-gauges="venue"><span>River gauges within 25 mi · at or above action stage</span><span>${near.length}</span></div>` + near.sort((a, b) => b.rank - a.rank).slice(0, 6).map(spotItem).join(""); }
    h += (S.layers.aviation ? avControls() : "") + airportsSection() + enrouteSection() + smokeSection(true) + tropicsSection();
    if (S.layers.fire) { const near = nearbyIncidents(); if (near.length) h += `<div class="px-h"><span>Wildfires near the venue · NIFC</span><span>within ${Math.round(T.miles(T.NEAR_KM))} mi</span></div>` + near.map((x) => incItem(x.p, x.r)).join(""); }
    h += `<div class="px-h">Later at the venue</div>` + laterButtons([venue.lon, venue.lat]);
    const elsewhere = list.filter((p) => !["covers", "near"].includes(rel(p).kind)).length;
    if (elsewhere) h += `<button type="button" class="px-link px-back" data-scope-go="national">See ${elsewhere} more active elsewhere →</button>`;
    return h;
  }
  /* outlook categories nest: the venue's headline is its highest category; lower ones sit in the details */
  const nestedBelow = (ol, at) => at ? ol.filter((o) => T.OUTLOOK.indexOf(o.category) < T.OUTLOOK.indexOf(at.category) && T.contains(o.geometry, [venue.lon, venue.lat])) : [];
  /* an SPC day with no confirmed answer: never "no risk" (null when the outlook is confirmed) */
  const olUnknown = (day) => { const st = data.state["day" + day]; if (!st || ["current", "empty", "na"].includes(st.kind) || (st.kind === "stale" && outlooks(day).length)) return null;
    return st.kind === "loading" ? "Loading the SPC Day " + day + " outlook…" : st.kind === "stale" ? "Risk unknown · SPC Day " + day + " outlook last confirmed " + t(data.sources["day" + day].lastOk) : "Risk unknown · SPC Day " + day + " outlook not responding"; };
  function dayPanel(day) {
    const ol = outlooks(day), top = T.highestOutlook(ol), st = data.state["day" + day], unk = olUnknown(day);
    const at = T.outlookAt(ol, [venue.lon, venue.lat]), lower = nestedBelow(ol, at);
    let h = "";
    const sev = S.layers.severe;
    if (S.scope === "venue" && sev) {
      h += `<div class="px-brief"><div class="px-where">Day ${day} at ${esc(venue.name)} · highest SPC category</div><div class="px-big">${at ? esc(T.outlookLabel(at.category)) : unk ? esc(unk) : "No severe risk area"}</div>`
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
      if (sev) h += `<div class="px-brief"><div class="px-where">Day ${day} · national</div><div class="px-big">${top ? "Highest: " + esc(T.OUTLOOK_NAME[top.category]) : unk ? esc(unk) : "No severe risk"}</div><div class="px-sub">${top && T.OUTLOOK_LEVEL[top.category] ? esc(T.outlookLabel(top.category)) + " · " + esc(T.placeName(top.label, PLACES)) : top ? "General thunderstorms only" : ""}</div></div>`;
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
    if (sev) h += `<div class="px-h">Outlook areas</div>` + (sorted.length ? sorted.map((p) => item(p, { tag: S.scope === "venue" && at && p.id === at.id ? "Highest category at the venue" : "" })).join("") : `<p class="px-empty">${unk ? esc(unk) + "." : "No outlook areas."}</p>`);
    const actW = active().filter((p) => p.kind === "warning");
    if (actW.length) h += `<div class="px-h">Active now</div><button type="button" class="tx-item" data-view-go="active" style="--tx-c:${colorOf(actW[0])}">${swatch(actW[0])}<span><b>${actW.length} active warning${actW.length > 1 ? "s" : ""}</b><span class="tx-meta">${day === 1 ? "Shown as dashed outlines, labelled Active now · " : "Not drawn on the Day 2 map · "}open Active now →</span></span></button>`;
    h += `<a class="px-link" href="severe.html#severe-daily">Open the regional Severe viewer →</a>`;
    return h;
  }
  /* At this spot: a row for each kind, with the facts that kind has (not an expiration it doesn't have) */
  function spotItem(p) {
    if (["sigmet", "gairmet", "cwa"].includes(p.kind)) return advItem(p);
    if (p.kind === "pirep") return pirepItem(p);
    const row = (kind, title, meta) => `<button type="button" class="tx-item" data-id="${esc(p.id)}" style="--tx-c:${colorOf(p)}">${swatch(p)}<span><span class="tx-kind">${esc(kind)}</span><b>${esc(title)}</b><span class="tx-meta">${esc(meta)}</span></span></button>`;
    if (p.kind === "incident") return row(p.category === "RX" ? "PRESCRIBED FIRE" : "WILDFIRE", p.name || p.title, incFacts(p));
    if (p.kind === "gauge") return row("RIVER GAUGE", p.name, (FX.GAUGE_WORD[p.category] || p.category) + (p.obs && p.obs.value != null ? " · " + p.obs.value + " " + p.obs.unit + " now" : ""));
    if (p.kind === "lsr") return row("STORM REPORT", p.title, t(p.observed, true) + (p.comments ? " · " + p.comments.slice(0, 80) + (p.comments.length > 80 ? "…" : "") : ""));
    if (p.kind === "smoke") return row("SATELLITE SMOKE", (p.category || "") + " smoke detected", "Observed " + t(p.obsStart) + " → " + t(p.obsEnd) + (p.satellite ? " · " + p.satellite : ""));
    if (p.kind === "aqobs") return row("AIR QUALITY", p.site || "AirNow monitor", "AQI " + p.aqi + " · " + (p.category || "") + " · observed " + t(p.observed));
    if (p.kind === "metar" || p.kind === "taf") return row(p.kind === "metar" ? "METAR" : "TAF", (p.airport || "") + (p.category ? " · " + p.category : ""), (p.kind === "metar" ? "Observed " : "Issued ") + t(p.observed || p.issued));
    return item(p, { rel: false });
  }
  function spotAreas(pt) {
    const day = viewDay();
    // SPC severe-weather outlooks nest (each category inside the lower ones): only the highest covering the spot, once per day shown
    const spcTop = (d) => { const o = S.layers.severe ? T.outlookAt(outlooks(d), pt) : null; return o ? [o] : []; };
    const areas = day === 2 || day === 3 ? [] : [...(S.layers.smoke ? hmsShown() : []), ...incidents().filter((p) => p.geometry)];
    return T.sort([...(day ? [...spcTop(day), ...(S.layers.flood ? eroOut(day) : [])] : [...active(), ...spcTop(1)]), ...areas].filter((p) => p.geometry && T.contains(p.geometry, pt)));
  }
  function pointPanel() {
    const pt = S.point, day = viewDay();
    // SPC severe-weather outlooks nest (each category inside the lower ones): only the highest covering the spot, once per day shown
    const list = spotAreas(pt);
    let h = `<button type="button" class="px-back" data-back>← ${S.scope === "venue" ? "Venue" : "All threats"}</button>`;
    h += `<div class="px-h"><span>At this spot</span><span>${pt[1].toFixed(2)}°, ${pt[0].toFixed(2)}°</span></div>`;
    if (S.ifi.on && ifi.state === "ok") { const a = ifiAt(pt); h += `<p class="lg-note" data-ifi-point>IFI model guidance at ${esc(IF.levelLabel(S.gtg.ft))}, valid ${esc(t(ifi.dec.validTime))}: ${esc(!a || !a.inside ? "outside the IFI grid" : a.text)}.</p>`; }
    if (S.gtg.on && gtg.state === "ok") h += `<p class="lg-note" data-gtg-point>GTG model guidance at ${esc(GT.levelLabel(gtgHeight().ft))}, valid ${esc(t(gtg.dec.validTime))}: ${esc(gtgWord(gtgAt(pt)))}.</p>`;
    const under = (S.pointHits || []).map(byId).filter(Boolean), seen = new Set(under.map((p) => p.id)), rest = list.filter((p) => !seen.has(p.id));
    if (under.length) h += `<div class="px-h" data-spot="under"><span>Under your ${phone() ? "tap" : "click"}</span><span>${under.length}</span></div>` + under.map(spotItem).join("");
    if (under.length && rest.length) h += `<div class="px-h"><span>Areas covering this spot</span><span>${rest.length}</span></div>`;
    h += rest.length ? rest.map(spotItem).join("") : under.length ? "" : `<p class="px-empty">No ${day ? "Day " + day + " outlook area" : "active product or Day 1 outlook area"} covers this spot.</p>`;
    return h;
  }
  function outlookVenueText(p) {
    if (/^spcfire-/.test(p.program || "")) { const a = fireAt(p.day)[p.part]; return !T.contains(p.geometry, [venue.lon, venue.lat]) ? relText(p) : a && a.id === p.id ? "The venue is in this area; it is the highest category there" : "The venue is in a higher category of the same outlook (" + olabel(a) + ")"; }
    const ol = (p.program === "ero" ? eroOut : outlooks)(p.day), at = T.outlookAt(ol, [venue.lon, venue.lat]);
    if (!T.contains(p.geometry, [venue.lon, venue.lat])) return relText(p);
    if (at && at.id === p.id) return "The venue is in this area; it is the highest category there";
    return "The venue is in a higher category of the same outlook (" + olabel(at) + ")";
  }
  const prevAsked = new Set();
  function detail(p) {
    // "what changed" needs the message this update replaced: fetched once, now that someone is reading this alert
    if (isLive() && Live.previousFor && !p.previous && (p.references || []).length && !prevAsked.has(p.id)) { prevAsked.add(p.id); Live.previousFor(p.id); }
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
    const bulletin = p.bulletin || (/^spcfire-/.test(p.program || "") ? "SPC Day " + p.day + " Fire Weather Outlook\nNWS Storm Prediction Center" + (p.forecaster ? " · " + p.forecaster : "") + "\nIssued " + T.fmtZ(p.issued) + " · valid " + T.fmtZ(p.validStart) + "–" + T.fmtZ(p.validEnd) + "\n\n" + olabel(p) + ". " + (FX.FIRE_MEANING[p.category] || "") + "\n\nRead SPC's discussion: " + p.source.url : p.program === "ero" ? "WPC Day " + p.day + " Excessive Rainfall Outlook\nNWS Weather Prediction Center\nIssued " + T.fmtZ(p.issued) + " · valid " + T.fmtZ(p.validStart) + "–" + T.fmtZ(p.validEnd) + "\n\n" + olabel(p) + ": " + (p.headline || "") + "\n\nRead WPC's discussion: " + p.source.url : isLive() && p.kind === "outlook" ? "SPC Day " + p.day + " Convective Outlook\nIssued " + T.fmtZ(p.issued) + " · valid " + T.fmtZ(p.validStart) + "–" + T.fmtZ(p.validEnd) + "\n\nRead the forecaster discussion: " + p.source.url : p.kind === "outlook" ? "Day " + p.day + " Convective Outlook\nNWS Storm Prediction Center Norman OK\n\n(DEMO: the outlook discussion text appears here in the beta.)" : p.event + "\n" + p.office + "\n\n(DEMO: the full bulletin text appears here in the beta.)");
    return `<button type="button" class="px-back" data-back>← Back</button>`
      + `<div style="--tx-c:${colorOf(p)}">${swatch(p, 40)} <span class="tx-kind k-${p.kind}">${KIND_WORD[p.kind]}</span></div>`
      + `<div class="px-title">${esc(p.kind === "outlook" ? (p.program === "ero" ? "WPC Day " : "SPC Day ") + p.day + " · " + olabel(p) : p.title)}</div>`
      + (p.headline ? `<p class="px-headline">${esc(p.headline)}</p>` : "")
      + `<dl class="px-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`
      + (p.viaService ? "" : `<details class="px-bulletin"><summary>${p.kind === "outlook" ? "Read the outlook discussion" : "Read the official bulletin"}</summary><pre>${esc(bulletin)}</pre><div class="lg-note">${official() ? (p.kind === "outlook" ? "Full discussion on the " + (p.program === "ero" ? "WPC" : "SPC") + " page linked above." : "Official text as received from " + (p.kind === "md" ? "SPC" : "NWS") + ".") : esc(Demo.BULLETIN_NOTE)}</div></details>`);
  }
  /* collapsed phone sheet: two lines so a warning's expiration always survives */
  function peek() {
    if (avOnly() && !S.sel && !S.point) { const a = avSummary(); return [a.head, a.sub]; }
    if (!S.pin && !S.sel && !S.point && !viewDay() && !winterView() && !fireView()) { const n = active().length; return ["National map", n ? n + " active · tap for the list" : srcOn("alerts") ? "Nothing active for the layers on" : "Open Layers to add warnings"]; }
    if (S.sel) { const p = byId(S.sel); return p ? [p.kind === "outlook" ? "Day " + p.day + " · " + olabel(p) : p.title, "Tap for details"] : ["", ""]; }
    if (fireView()) { const a = fireAt(S.fday), top = a.windrh || a.dryt; return ["Fire weather at " + venue.name + " · " + FDAY_NAME(S.fday), top ? fireCatText(top) : "No fire weather area at the venue"]; }
    if (winterView()) { const w = curWin(), o = w ? venueWssi().get(w.start) || {} : {}, lv = topLevel(o); return ["Winter outlook at " + venue.name, w ? winShort(w) + " · " + (lv ? pctTxt(o[lv]) + " at least " + (lv === "WWA" ? "winter weather" : WLEVEL_LABEL[lv]) : "under 30% for any level") : "Loading"]; }
    if (viewDay()) { const o = T.outlookAt(outlooks(viewDay()), [venue.lon, venue.lat]); return ["Day " + viewDay() + " at " + venue.name, o ? "Highest: " + T.outlookLabel(o.category) : olUnknown(viewDay()) || "No severe risk area"]; }
    const L = statusLines();
    if (!L.length) { const q = quietText(); return [q.big.replace("at the venue", "at " + venue.name), lapsed().length ? "A warning reached its expiration · NWS status unknown" : !srcOn("alerts") ? "Open Layers to add warnings" : activeKnown() ? "NWS checked " + t(data.sources.alerts.lastOk) : known("alerts") ? "NWS checked " + t(data.sources.alerts.lastOk) + " · MD status unknown" : "NWS warnings not confirmed"]; }
    // line 1: what applies at the venue; line 2: its expiration (always kept); line 3: a nearby warning, if any
    const a = L[0], b = L.find((l, i) => i > 0 && l.p.kind === "warning");
    return [a.head.replace("at the venue", "at " + venue.name), a.sub, b ? b.head + (b.at ? "" : " · venue outside it") : ""];
  }
  function renderPanel() {
    const body = $("txPanelBody"), p = S.sel && byId(S.sel), keep = body.scrollTop, focusId = document.activeElement && body.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    if (data.loadError) { body.innerHTML = `<p class="px-empty">Could not load this archived sample (${esc(data.loadError)}).</p>`; return; }
    if (outlookView() && !p && !S.point) {
      body.innerHTML = outlookPanel(); document.querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === S.scope)));
      $("scopeVenue").innerHTML = `Venue<span class="tx-sbv"> · ${esc(venue.name)}</span>`;
      const r = vo.data && OL ? OL.build({ ...vo.data, now: Date.now(), tz: tz(), venue, days: 7 }).headline : null;
      $("txPeek1").textContent = r ? (r.level ? r.text : "Next 7 days: " + r.text.charAt(0).toLowerCase() + r.text.slice(1)) : "Next 7 days at " + venue.name; $("txPeek2").textContent = r && r.level ? r.when + " · " + r.source : vo.state === "loading" ? "Loading…" : "Tap for the day-by-day outlook";
      $("txPeek3").textContent = ""; $("txPeek3").hidden = true; $("txPeek").style.setProperty("--peek-c", r && r.level ? LEVEL_COLOR[r.level] : "transparent"); return;
    }
    if (!anyLayer() && !p) { // nothing selected: the basemap and venue only, and nothing downloaded
      body.innerHTML = `<div class="px-nolayer" data-kind="no-layers"><p class="px-empty"><b>No threat layers selected.</b> Select a layer to see official warnings, outlooks and reports. Nothing is downloaded until you do.</p>`
        + `<div class="px-presets"><button type="button" class="tx-fb tx-done" data-preset="venue">Warnings at my venue</button><button type="button" class="tx-fb" data-preset="all">Everything</button><button type="button" class="tx-fb" data-open-layers>Choose layers</button></div>`
        + `<p class="lg-note">Warnings at my venue: severe storms, flooding, winter, heat and cold, wind and visibility, and coastal warnings and outlooks, centred on ${esc(venue.name)}. Everything: all ${LAYER_KEYS.length} hazards (more to download).</p></div>` + venueFcSection() + (S.radar && isLive() ? `<div class="px-sources">${radarRow()}</div>` : "");
      $("scopeVenue").innerHTML = `Venue<span class="tx-sbv"> · ${esc(venue.name)}</span>`; $("scopeVenue").setAttribute("aria-label", "Venue: " + venue.name); $("scopeVenue").title = "Venue: " + venue.name;
      document.querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === S.scope)));
      $("txPeek1").textContent = "No threat layers selected"; $("txPeek2").textContent = "Tap for Warnings at my venue, Everything, or Layers"; $("txPeek3").textContent = ""; $("txPeek3").hidden = true; $("txPeek").style.setProperty("--peek-c", "transparent"); return;
    }
    if (data.loading) { body.innerHTML = `<p class="px-empty">Loading official feeds for the selected layers…</p>` + sources(); $("txPeek1").textContent = "Loading official feeds…"; $("txPeek2").textContent = ""; return; }
    body.innerHTML = (p ? (p.kind === "gauge" ? gaugeDetail(p) : p.kind === "lsr" ? lsrDetail(p) : p.kind === "incident" ? incidentDetail(p) : p.kind === "smoke" || p.kind === "aqobs" ? smokeDetail(p) : p.kind === "tcoutlook" || p.kind === "tctrack" ? nhcDetail(p) : p.kind === "metar" || p.kind === "taf" ? avDetail(p) : ["pirep", "sigmet", "gairmet", "cwa", "faa"].includes(p.kind) ? enDetail(p) : detail(p)) : S.point && !winterView() && !fireView() ? pointPanel() : winterView() ? winterPanel() : fireView() ? firePanel() : viewDay() ? dayPanel(viewDay()) : S.scope === "venue" ? venueActive() : nationalActive()) + sources();
    document.querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === S.scope)));
    $("scopeVenue").innerHTML = `Venue<span class="tx-sbv"> · ${esc(venue.name)}</span>`; $("scopeVenue").setAttribute("aria-label", "Venue: " + venue.name); $("scopeVenue").title = "Venue: " + venue.name;
    body.scrollTop = keep; if (focusId) { const el = body.querySelector(`[data-id="${CSS.escape(focusId)}"]`); if (el) el.focus({ preventScroll: true }); }
    const [a, b, c] = peek(), L = !S.sel && !viewDay() ? statusLines() : [];
    $("txPeek1").textContent = a; $("txPeek2").textContent = b; $("txPeek3").textContent = c || ""; $("txPeek3").hidden = !c; { const nw = L.find((l, i) => i > 0 && l.p.kind === "warning"); $("txPeek3").style.setProperty("--tx-near", nw ? colorOf(nw.p) : "transparent"); }
    $("txPeek").style.setProperty("--peek-c", L[0] && L[0].p.kind === "warning" ? colorOf(L[0].p) : L[0] ? colorOf(L[0].p) : "transparent");
  }

  /* ---------- top-of-map: valid time, model control, chips; legend ---------- */
  function renderTop() {
    document.querySelectorAll(".tx-tb").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === S.view)));
    syncLayers();
    const day = viewDay();
    document.querySelectorAll('.tx-tb[data-view="winter"]').forEach((b) => { b.hidden = !S.layers.winter; });
    document.querySelectorAll('.tx-tb[data-view="outlook"]').forEach((b) => { b.hidden = !isLive(); }); // the 7-day dashboard is live only
    document.querySelectorAll('.tx-tb[data-view="fire"]').forEach((b) => { b.hidden = !S.layers.fire; });
    if (fireView()) { const o = fireOut(S.fday)[0], src = data.sources["fire" + S.fday]; $("txValid").innerHTML = `<b>Fire · SPC Day ${S.fday}</b> · ${o ? esc(t(o.validStart, true)) + " → " + esc(t(o.validEnd, true)) + `<span class="z">${esc(T.fmtZ(o.validStart))}–${esc(T.fmtZ(o.validEnd))} · issued ${esc(T.fmtZ(o.issued))}</span>` : src && src.validEnd ? "no areas" + (src.phrase ? " (" + esc(src.phrase) + ")" : "") : "no outlook loaded"}`; }
    else if (winterView()) { const w = curWin(); $("txValid").innerHTML = w ? `<b>Winter · WPC WSSI-P</b> · ${esc(winSpan(w))}<span class="z">${esc(T.fmtZ(w.start))}–${esc(T.fmtZ(w.end))}${w.issued ? " · issued " + esc(T.fmtZ(w.issued)) : ""}</span>` : `<b>Winter · WPC WSSI-P</b> · no outlook loaded`; }
    else if (outlookView()) $("txValid").innerHTML = `<b>Next 7 days</b> · at ${esc(venue.name)}${vo.data ? " · updated " + esc(t(vo.data.at, true)) : ""}`;
    else if (!day) $("txValid").innerHTML = `<b>Active now</b> · as of ${esc(t(data.clock, true))}`;
    else {
      const o = outlooks(day)[0] || eroOut(day)[0];
      $("txValid").innerHTML = o ? `<b>Day ${day}</b> · ${esc(t(o.validStart, true))} → ${esc(t(o.validEnd, true))}<span class="z">${esc(T.fmtZ(o.validStart))}–${esc(T.fmtZ(o.validEnd))} · issued ${esc(T.fmtZ(o.issued))}</span>` : `<b>Day ${day}</b> · no outlook loaded`;
    }
    $("txModel").hidden = !day || winterView() || fireView(); $("modelChk").checked = S.model; $("modelHz").hidden = !S.model;
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
    if ((S.layers.heat || S.layers.wind) && !winterView() && !fireView() && !day) h += `<div><div class="lg-h">Heat, cold, wind and visibility · active now</div>${S.layers.heat ? lgLine({ kind: "warning", family: "heat", event: "Extreme Heat Warning" }, "<b>Extreme Heat Warning</b>") + lgLine({ kind: "advisory", family: "heat", event: "Heat Advisory" }, "Heat Advisory") + lgLine({ kind: "warning", family: "heat", event: "Extreme Cold Warning" }, "<b>Extreme Cold Warning</b> · wind chill") + lgLine({ kind: "warning", family: "heat", event: "Freeze Warning" }, "Freeze Warning / Frost Advisory") : ""}${S.layers.wind ? lgLine({ kind: "warning", family: "wind", event: "High Wind Warning" }, "<b>High Wind Warning</b>") + lgLine({ kind: "advisory", family: "wind", event: "Wind Advisory" }, "Wind Advisory") + lgLine({ kind: "advisory", family: "wind", event: "Dense Fog Advisory" }, "Dense Fog / Smoke Advisory") : ""}</div>`;
    if (S.layers.winter && !winterView() && !day) h += `<div><div class="lg-h">Winter · active now</div>${lgLine({ kind: "warning", family: "winter", event: "Winter Storm Warning" }, "<b>Winter Storm Warning</b>")}${lgLine({ kind: "warning", family: "winter", event: "Blizzard Warning" }, "Blizzard · ice storm · lake-effect snow warnings")}${lgLine({ kind: "watch", family: "winter", event: "Winter Storm Watch" }, "<b>Winter Storm Watch</b> · dashed")}${lgLine({ kind: "advisory", family: "winter", event: "Winter Weather Advisory" }, "<b>Winter Weather Advisory</b> · thin outline")}<div class="lg-note">Most winter alerts are issued for NWS forecast zones; the area is drawn from those zones.</div></div>`;
    if ((S.layers.tropical || S.layers.coastal) && !winterView() && !fireView() && !viewDay()) h += `<div><div class="lg-h">Tropical and coastal</div>${S.layers.tropical ? lgLine({ kind: "warning", family: "tropical", event: "Hurricane Warning" }, "<b>Hurricane / Tropical Storm / Storm Surge</b> warnings and watches (NWS)") + `<div class="lg-row"><svg width="28" height="16" aria-hidden="true"><rect x="2" y="2" width="24" height="12" fill="#f2f2f2" fill-opacity=".2" stroke="#f2f2f2"/></svg><span>NHC forecast cone: likely path of the center, not the impact area</span></div><div class="lg-bands">${Object.entries(TWO_COLOR).map(([k, c]) => `<span class="lg-band"><i style="background:${c}"></i>${k}</span>`).join("")}</div><div class="lg-note">NHC outlook areas: chance of formation (7 days)</div>` : ""}${S.layers.coastal ? lgLine({ kind: "warning", family: "coastal", event: "Coastal Flood Warning" }, "<b>Coastal flood, high surf, rip current</b> (NWS zones)") : ""}</div>`;
    if (S.layers.smoke && !winterView() && !fireView() && !viewDay()) h += `<div><div class="lg-h">Smoke and air quality</div><div class="lg-bands">${FX.HMS_DENSITY.map((d) => `<span class="lg-band"><i style="background:${HMS_FILL[d][0]};opacity:${0.4 + HMS_FILL[d][1]}"></i>${d}</span>`).join("")}</div><div class="lg-note">NOAA satellite smoke (overhead, not at the ground), last 24 hours.</div><div class="lg-bands">${Object.entries(AQI_COLOR).map(([k, c]) => `<span class="lg-band" title="${esc(k)}"><i style="background:${c}"></i>${esc(k === "Unhealthy for Sensitive Groups" ? "USG" : k)}</span>`).join("")}</div><div class="lg-note">AirNow monitors: latest hourly AQI (preliminary).</div></div>`;
    if (S.layers.flood && (!day || day === 1) && !winterView() && !fireView()) h += `<div><div class="lg-h">River gauges · NOAA (regional zoom)</div>${["no_flooding", "action", "minor", "moderate", "major"].map((c) => lgLine({ kind: "gauge", category: c }, FX.GAUGE_WORD[c])).join("")}${lgLine({ kind: "gauge", category: "not_defined" }, "No stages defined / no current data")}</div>`;
    if (S.layers.severe && (!day || day === 1) && !winterView() && !fireView()) h += `<div><div class="lg-h">Storm reports · last 24 h (SPC, preliminary)</div>${["tornado", "wind", "hail"].map((k) => lgLine({ kind: "lsr", type: k }, { tornado: "Tornado", wind: "Wind damage", hail: "Hail" }[k])).join("")}</div>`;
    if (S.radar && isLive()) h += `<div><div class="lg-h">Radar · NOAA MRMS</div><div class="lg-radar" aria-hidden="true"></div><div class="lg-note">Light rain or snow → heavy rain and hail (base reflectivity), under the hazards${radar.valid ? " · image " + esc(t(radar.valid)) : ""}</div></div>`;
    if (S.layers.fire && !winterView()) h += `<div><div class="lg-h">Fire</div>${lgLine({ kind: "warning", family: "fire", event: "Red Flag Warning" }, "<b>Red Flag Warning</b>")}${lgLine({ kind: "watch", family: "fire", event: "Fire Weather Watch" }, "<b>Fire Weather Watch</b> · dashed")}${lgLine({ kind: "incident", category: "WF" }, "<b>Wildfire</b> (NIFC): perimeter where mapped, dot sized by acres")}<label class="lg-toggle"><input type="checkbox" id="rxChk"${S.rx ? " checked" : ""}> Prescribed fires</label><label class="lg-toggle"><input type="checkbox" id="ctnChk"${S.ctn ? " checked" : ""}> Fully contained fires</label>${fireView() ? `<div class="lg-bands">${(S.fday >= 3 ? ["P40", "P70"] : ["ELEV", "CRIT", "EXTM", "IDRT", "SDRT"]).map((c) => `<span class="lg-band" title="${esc(FX.FIRE_NAME[c])}"><i style="background:${FIRE_COLOR[c]}"></i>${c === "P40" ? "40%" : c === "P70" ? "70%" : c}</span>`).join("")}</div><div class="lg-note">${S.fday >= 3 ? "Probability of critical fire weather within 12 miles of a point." : "ELEV elevated · CRIT critical · EXTM extremely critical (wind and humidity) · IDRT/SDRT isolated/scattered dry thunderstorms."}</div>` : ""}</div>`;
    if (winterView()) h += `<div><div class="lg-h">WPC WSSI-P · chance of at least ${esc(S.wlevel === "WWA" ? "winter weather" : WLEVEL_LABEL[S.wlevel])}</div><div class="lg-bands">${WSSI_PROBS.map((v) => `<span class="lg-band"><i style="background:${WSSI_COLOR[v]}"></i>${v}%</span>`).join("")}</div><div class="lg-note">24-hour window. Levels: Minor, Moderate, Major, Extreme winter storm impacts (WPC definitions).</div></div>`;
    if (!day && !winterView()) h += `<label class="lg-toggle"><input type="checkbox" id="ctxChk"${S.ctx ? " checked" : ""}> Day 1 outlook outlines</label>`;
    if (day && S.model) h += `<div><div class="lg-h">Our research model · ${esc(S.hazard)} within 25 mi</div><div class="lg-bands">${G.BANDS.map(([, c, l]) => `<span class="lg-band"><i style="background:${c}"></i>${l}</span>`).join("")}</div><div class="lg-note">Experimental Forecast Ops guidance, not an official forecast${isLive() ? "" : ". Demo values"}. Uncolored: below 0.1% (low). Light hatching: no model guidance (outside its grid or over water), not a low value.</div>${(() => { const f = modelField(day); return f.values ? "" : `<div class="lg-note"><b>${esc(f.reason)}</b></div>`; })()}</div>`;
    // aviation: only the parts actually drawn
    if (S.layers.aviation) {
      const ap = avProducts().length, en = enShown(), rp = en.some((x) => x.kind === "pirep"), ad = en.some((x) => x.kind !== "pirep"), gt = S.gtg.on && gtg.state === "ok", ic = S.ifi.on && ifi.state === "ok";
      const dotc = (c, ring) => `<svg width="18" height="14" aria-hidden="true"><circle cx="9" cy="7" r="5" fill="${ring ? "none" : c}" stroke="${ring ? c : "#111"}" stroke-width="${ring ? 2.5 : 1}"/></svg>`;
      const sw = (c) => `<span class="gtg-sw" style="background:rgba(${c.slice(0, 3).join(",")},${(c[3] / 255).toFixed(2)})"></span>`;
      const rows = [ap ? `<div class="lg-row lg-tight">${["VFR", "MVFR", "IFR", "LIFR"].map((k) => dotc(FLT_COLOR[k]) + `<span>${k}</span>`).join("")}</div>` : "", rp ? `<div class="lg-row lg-tight">${dotc("#E5484D")}<span>pilot report, turbulence</span>${dotc("#E5484D", true)}<span>icing</span></div>` : "",
        ad ? `<div class="lg-row lg-tight"><svg width="24" height="12" aria-hidden="true"><rect x="2" y="2" width="20" height="8" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>SIGMET, CWA</span><svg width="24" height="12" aria-hidden="true"><rect x="2" y="2" width="20" height="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/></svg><span>G-AIRMET</span></div>` : "",
        gt ? `<div class="lg-row lg-tight">${[1, 2, 3, 4].map((c) => sw(GT.PALETTE[c])).join("")}<span>turbulence guidance (GTG), light to extreme</span></div>` : "", ic ? `<div class="lg-row lg-tight">${(S.ifi.field === "prob" ? IF.PROB_COLORS : [1, 2, 3, 4].map((c) => IF.SEV_COLORS[c])).map(sw).join("")}<span>icing guidance (IFI), ${S.ifi.field === "prob" ? "probability 5% to 60%+" : "trace to severe"}</span></div>` : ""].filter(Boolean).join("");
      if (rows) h += `<div><div class="lg-h">Aviation</div>${rows}</div>`;
    }
    if (S.scope === "venue") h += `<div class="lg-row"><svg width="28" height="10" aria-hidden="true"><line x1="1" y1="5" x2="27" y2="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/></svg><span>${Math.round(T.miles(T.NEAR_KM))}-mile "nearby" ring</span></div>`;
    $("txLegendBody").innerHTML = h;
    const rx = $("rxChk"); if (rx) rx.addEventListener("change", () => { S.rx = rx.checked; drawAll(); });
    const ctn = $("ctnChk"); if (ctn) ctn.addEventListener("change", () => { S.ctn = ctn.checked; drawAll(); });
    const cc = $("ctxChk"); if (cc) cc.addEventListener("change", () => { S.ctx = cc.checked; drawAll(); });
  }

  const aqAsked = new Set();
  function ensureAq() { if (!isLive() || !S.layers.smoke || !Live.aqFor || !venue) return; const k = venue.lat.toFixed(3) + "," + venue.lon.toFixed(3); if (aqAsked.has(k)) return; aqAsked.add(k); Live.aqFor(venue.lat, venue.lon).then(() => { load(); drawAll(); }); }
  let avAsked = "";
  const EN_BOXES = [[24, -126, 50, -104], [24, -104, 50, -87], [24, -87, 50, -66]]; // CONUS in three boxes (AWC returns at most 400 reports per box)
  function ensureEn() { if (!isLive() || !enOn()) return; if (Live.enrouteFor) Live.enrouteFor(EN_BOXES); if (Live.faaFor && (S.air.length || S.route)) Live.faaFor(); }
  function ensureAv() { if (!isLive() || !S.layers.aviation || !Live.airportsFor || !S.air.length) return; const k = S.air.join(","), st = (Live.snapshot().sources || {}).awc; if (avAsked === k && !(st && st.state === "failed")) return; /* a failed answer is asked again on the next redraw (about every 30 s) */ avAsked = k; Live.airportsFor(S.air).then(() => { load(); drawAll(); }); }
  function ensureTc() { if (isLive() && S.layers.tropical && Live.tropicalFor && venue && data.sources.nhc && data.sources.nhc.state === "ok") Live.tropicalFor(venue.lat, venue.lon); }
  /* each stage on its own: a record one stage can't handle is reported (window.__threats.errors, console) and the other
     stages, layers and controls keep working, instead of one exception freezing the whole page */
  const drawErrors = [];
  function stage(name, fn) { try { fn(); } catch (e) { drawErrors.push({ stage: name, message: e.message, stack: e.stack, at: new Date().toISOString() }); if (drawErrors.length > 50) drawErrors.shift(); console.error("Weather threats: " + name + " failed", e); } }
  /* each layer's official feeds: loaded when the layer is turned on, no longer refreshed when it is off (nothing loads with none) */
  const LAYER_FEEDS = { heat: ["alerts"], wind: ["alerts"], severe: ["alerts", "md", "spc", "reports"], flood: ["alerts", "ero"], winter: ["alerts"], fire: ["alerts", "fire", "nifc"], smoke: ["hms", "monitors"], tropical: ["alerts", "nhc"], coastal: ["alerts"], aviation: [] };
  let feedKey = null, zoneFamKey = null;
  const anyLayer = () => Object.keys(LAYER_FEEDS).some((k) => S.layers[k]);
  function syncFeeds() {
    const keys = isLive() ? [...new Set(Object.keys(LAYER_FEEDS).filter((k) => S.layers[k]).flatMap((k) => LAYER_FEEDS[k]))].sort() : [], k = keys.join(",");
    if (Live.setZoneFamilies) { const zf = isLive() ? Object.keys(LAYER_FEEDS).filter((x) => S.layers[x] && LAYER_FEEDS[x].includes("alerts")).join(",") : ""; if (zf !== zoneFamKey) { zoneFamKey = zf; Live.setZoneFamilies(zf ? zf.split(",") : []); } } // zone outlines for the hazards shown only
    if (k === feedKey || !Live.setFeeds) return; feedKey = k;
    const p = Live.setFeeds(keys); if (isLive()) load();
    p.then(() => { if (feedKey === k && isLive()) { liveReady = true; load(); drawAll(); } });
  }
  /* ---------- radar (live only, off by default): NOAA MRMS base reflectivity under the hazards; the image time is read from the
     service every 5 minutes while radar is on, and the tiles are re-requested only when a newer image is listed ---------- */
  const radar = { state: "off", valid: null, lastOk: null, error: null, timer: null, tiles: null };
  const radarAgeMin = () => (radar.valid ? Math.round((Date.now() - Date.parse(radar.valid)) / 60e3) : null);
  const radarText = () => "NOAA MRMS radar image " + t(radar.valid) + " (" + radarAgeMin() + " min old" + (radarAgeMin() > 20 ? ", delayed" : "") + ")";
  function radarTick() {
    if (document.hidden && radar.lastOk) return;
    Live.radarTime().then((v) => { radar.valid = v; radar.lastOk = new Date().toISOString(); radar.state = "ok"; radar.error = null; })
      .catch((e) => { radar.state = radar.lastOk ? "stale" : "failed"; radar.error = e.message; })
      .finally(() => { if (S.radar) drawAll(); });
  }
  function ensureRadar() {
    if (!map || !mapLoaded) return;
    const on = S.radar && isLive() && !!Live.radarTime;
    if (!on) { if (radar.timer) { clearInterval(radar.timer); radar.timer = null; } radar.state = "off"; if (map.getLayer("radar")) map.setLayoutProperty("radar", "visibility", "none"); return; }
    if (!radar.timer) { radar.state = radar.lastOk ? radar.state : "loading"; radarTick(); radar.timer = setInterval(radarTick, 5 * 60e3); }
    if (!radar.valid) return;
    const url = Live.RADAR_TILE_URL + "&t=" + Date.parse(radar.valid); // a new image time is a new URL; the same one is reused from the cache
    if (!map.getSource("radar")) { map.addSource("radar", { type: "raster", tiles: [url], tileSize: 256, attribution: "NOAA MRMS radar" }); map.addLayer({ id: "radar", type: "raster", source: "radar", paint: { "raster-opacity": 0.6, "raster-fade-duration": 0 } }, map.getLayer("outlook-fill") ? "outlook-fill" : undefined); }
    else if (radar.tiles !== url) map.getSource("radar").setTiles([url]);
    radar.tiles = url; map.setLayoutProperty("radar", "visibility", "visible");
  }
  const radarRow = () => !(S.radar && isLive()) ? "" : `<div class="px-src ${radar.state === "ok" ? (radarAgeMin() > 20 ? "stale" : "current") : radar.state === "stale" ? "stale" : radar.state === "failed" ? "unavailable" : "loading"}" data-src="radar"><span><b><a href="https://mrms.nssl.noaa.gov/" target="_blank" rel="noopener">NOAA MRMS radar</a></b></span><span>${radar.state === "ok" ? esc("Image " + t(radar.valid) + " · " + radarAgeMin() + " min old" + (radarAgeMin() > 20 ? " (delayed)" : "")) : radar.state === "stale" ? esc("Last image " + t(radar.valid) + " · not responding") : radar.state === "failed" ? "Not responding" : "Loading…"}</span></div>`;

  /* ---------- the venue's next 12 hours (NWS forecast grid), on request: gusts, heat index or feels-like, rain chance ---------- */
  let vfc = { key: null, state: "idle" };
  function venueFcSection() {
    if (!isLive() || !venue) return "";
    const k = (+venue.lat).toFixed(4) + "," + (+venue.lon).toFixed(4); if (vfc.key !== k) vfc = { key: k, state: "idle" };
    let h = `<div class="px-h" data-vfc-sec><span>Next 12 hours at ${esc(venue.name)}</span><span>NWS forecast</span></div>`;
    if (vfc.state === "idle") return h + `<button type="button" class="tx-fb" data-vfc>Show wind gusts, heat and rain chance</button>`;
    if (vfc.state === "loading") return h + `<p class="px-empty">Loading the NWS hourly forecast…</p>`;
    if (vfc.state === "failed") return h + `<p class="px-empty" data-vfc-state="failed">The NWS forecast didn't answer (${esc(vfc.err)}). <button type="button" class="tx-fb" data-vfc>Try again</button></p>`;
    const d = vfc.data, hr = (r) => T.fmtTime(r.t, tz()).replace(/:00(?= )/, "").replace(/ [A-Z]{2,4}T$/, "");
    const lines = [d.peakGust ? "Peak gust " + d.peakGust.gust + " mph around " + hr(d.peakGust) : null,
      d.peakPop ? (d.peakPop.pop ? "Highest rain chance " + d.peakPop.pop + "% around " + hr(d.peakPop) : "No rain chance above 0%") : null,
      d.peakHeat ? "Heat index up to " + d.peakHeat.heat + "°F around " + hr(d.peakHeat) : d.lowFeels && d.lowFeels.feels <= 40 ? "Feels like as low as " + d.lowFeels.feels + "°F around " + hr(d.lowFeels) : null].filter(Boolean);
    h += `<div class="px-vfc" data-vfc-state="ok"><p class="px-vfcsum">${lines.map(esc).join(" · ")}</p><div class="px-vfcgrid" role="table" aria-label="Hourly forecast at ${esc(venue.name)}"><div role="row" class="px-vfch"><span role="columnheader">Time</span><span role="columnheader">Gust</span><span role="columnheader">${d.peakHeat ? "Heat index" : "Feels like"}</span><span role="columnheader">Rain</span></div>`
      + d.rows.map((r) => `<div role="row"><span role="cell">${esc(hr(r))}</span><span role="cell">${r.gust == null ? "–" : r.gust + " mph"}</span><span role="cell">${(d.peakHeat ? r.heat : r.feels) == null ? "–" : (d.peakHeat ? r.heat : r.feels) + "°F"}</span><span role="cell">${r.pop == null ? "–" : r.pop + "%"}</span></div>`).join("") + `</div>`;
    h += `<p class="lg-note">NWS forecast grid ${esc(d.office)} ${esc(d.grid)}, updated ${esc(t(d.updated))}${d.covered < d.rows.length ? "; " + (d.rows.length - d.covered) + " hours not in the grid" : ""}. A forecast, not an observation; a gust is the highest expected in that hour.</p></div>`;
    return h;
  }
  function loadVfc() {
    if (!Live.venueForecast || vfc.state === "loading") return; vfc.state = "loading"; renderPanel(); const k = vfc.key;
    Live.venueForecast(venue.lat, venue.lon).then((d) => { if (vfc.key === k) { vfc.state = "ok"; vfc.data = d; } }).catch((e) => { if (vfc.key === k) { vfc.state = "failed"; vfc.err = e.message; } }).finally(() => renderPanel());
  }
  /* ---------- the venue's next 7 days: a dashboard of approaching threats (ThreatsOutlook), loaded when shown ---------- */
  const OL = window.ThreatsOutlook, LEVEL_WORD = ["", "Low", "Moderate", "High", "Extreme"], LEVEL_COLOR = ["var(--muted)", "#d9a400", "#e8742a", "#d7263d", "#a3159c"];
  let vo = { key: null, state: "idle", data: null, err: null };
  function loadOutlook(force) {
    if (!OL || !Live.outlookFor || !venue) return; const k = (+venue.lat).toFixed(4) + "," + (+venue.lon).toFixed(4);
    if (!force && vo.key === k && (vo.state === "loading" || (vo.state === "ok" && Date.now() - Date.parse(vo.data.at) < 10 * 60e3))) return;
    vo = { key: k, state: "loading", data: vo.key === k ? vo.data : null, err: null };
    Live.outlookFor(venue.lat, venue.lon).then((d) => { if (vo.key === k) { vo.state = "ok"; vo.data = d; } }).catch((e) => { if (vo.key === k) { vo.state = "failed"; vo.err = e.message; } }).finally(() => drawAll());
  }
  const OL_ICON = { river: "🌊", severe: "⛈", rain: "🌧", winter: "❄", fire: "🔥", tropical: "🌀", wind: "💨", heat: "🌡", cold: "🥶", precip: "☂", air: "😷", alert: "⚠" };
  function outlookPanel() {
    loadOutlook(false);
    if (!vo.data) return vo.state === "failed" ? `<p class="px-empty">The 7-day outlook didn't load (${esc(vo.err)}). <button type="button" class="tx-fb" data-ol-refresh>Try again</button></p>` : `<p class="px-empty" data-ol-state="loading">Loading the next 7 days at ${esc(venue.name)}: NWS alerts and forecast, SPC, WPC, NHC and AirNow outlooks…</p>`;
    const r = OL.build({ ...vo.data, now: Date.now(), tz: tz(), venue, days: 7 }), hl = r.headline;
    let h = `<div class="px-olhead" data-ol-state="ok" style="--ol-c:${LEVEL_COLOR[hl.level]}"><div class="px-where">Next 7 days at ${esc(venue.name)}${venue.city ? " · " + esc(venue.city) : ""}</div>`
      + `<div class="px-big">${hl.level ? esc(hl.text) : esc(hl.text)}</div><div class="px-sub">${hl.level ? esc(hl.when + " · " + hl.source + " · " + LEVEL_WORD[hl.level] + " concern") : r.unknown.length ? "Not confirmed: " + esc(r.unknown.join("; ")) : "From NWS, SPC, WPC, NHC and AirNow"}</div></div>`;
    if (r.alerts.length) h += `<div class="px-h"><span>NWS alerts at the venue</span><span>${r.alerts.length}</span></div>` + r.alerts.map((a) => `<div class="px-olalert" style="--ol-c:${LEVEL_COLOR[Math.max(a.level, 1)]}"><b>${esc(a.event)}</b><span>${esc(a.start > Date.now() ? "from " + t(new Date(a.start).toISOString(), true) + " " : "now ")}until ${esc(t(new Date(a.end).toISOString(), true))}</span></div>`).join("");
    h += `<div class="px-h"><span>Day by day</span><span>${esc(tzName(tz(), 7))}</span></div><div class="px-oldays">`;
    for (const d of r.days) {
      const top = d.items.reduce((m, x) => Math.max(m, x.level), 0), sig = d.items.filter((x) => x.level >= 1), info = d.items.filter((x) => x.level < 1);
      h += `<div class="px-olday" data-ol-day="${d.date}" style="--ol-c:${LEVEL_COLOR[top]}"><div class="px-olday-h"><b>${esc(d.label)}</b>${top ? `<span class="px-ollv">${LEVEL_WORD[top]}</span>` : ""}</div>`
        + (sig.length ? sig.map((x) => `<button type="button" class="px-olchip" data-ol-go="${esc(x.link || "")}" data-ol-key="${x.key}" style="--ol-c:${LEVEL_COLOR[x.level]}"><span aria-hidden="true">${OL_ICON[x.key] || "•"}</span> ${esc(x.text)} <small>${esc(x.source)}</small></button>`).join("") : `<div class="px-olquiet">${d.unknown.length ? "No threat in the sources that answered" : "No threats expected"}</div>`)
        + (info.length ? `<div class="px-olinfo">${info.map((x) => esc(x.text)).join(" · ")}</div>` : "")
        + (d.unknown.length ? `<div class="px-olunk">Not confirmed: ${d.unknown.map(esc).join("; ")}</div>` : "") + (d.limits.length ? `<div class="px-olinfo">${d.limits.map(esc).join("; ")}</div>` : "") + `</div>`;
    }
    h += `</div>`;
    const gi = vo.data.gridInfo;
    h += `<p class="lg-note">Official sources for the venue's point: NWS alerts and forecast grid${gi ? " (" + esc(gi.office + " " + gi.cell) + ", updated " + esc(t(gi.updated)) + ")" : ""}, SPC severe Days 1–8 and fire Days 1–8, WPC excessive rainfall Days 1–5 and winter WSSI-P, NHC, AirNow. Levels order what is shown; each line keeps the source's own wording. Updated ${esc(t(vo.data.at))} · <button type="button" class="px-link" data-ol-refresh>Refresh</button></p>`;
    h += `<div class="px-h">Show on the map</div><div class="px-presets"><button type="button" class="tx-fb tx-done" data-preset="venue">Warnings at my venue</button><button type="button" class="tx-fb" data-preset="all">Everything</button><button type="button" class="tx-fb" data-open-layers>Choose layers</button></div>`;
    return h + venueFcSection();
  }
  /* a dashboard line opens the map where its source is: the view and the layer it needs */
  function outlookGo(link, key) {
    const layer = { severe: "severe", rain: "flood", winter: "winter", fire: "fire", tropical: "tropical", alert: null }[key];
    if (layer) S.layers[layer] = true; else if (key === "alert") ["severe", "flood", "winter", "heat", "wind", "fire", "tropical", "coastal"].forEach((k) => (S.layers[k] = true));
    S.scope = "venue"; setView(link === "winter" ? "winter" : link === "fire" ? "fire" : /^day\d$/.test(link) ? link : "active");
  }

  /* one-tap starting points in the no-layers prompt */
  const PRESETS = { venue: { layers: ["severe", "flood", "winter", "heat", "wind", "coastal"], scope: "venue" }, all: { layers: Object.keys(LAYER_FEEDS) } };
  function applyPreset(k) {
    const pr = PRESETS[k]; if (!pr) return; Object.keys(S.layers).forEach((x) => (S.layers[x] = pr.layers.includes(x)));
    S.sel = null; S.point = null; if (pr.scope) setScope(pr.scope, true); drawAll();
  }

  function drawAll() { stage("layer feeds", syncFeeds); stage("radar", ensureRadar); stage("counties", ensureCounties); stage("gauges", ensureGauges); stage("feeds", ensureWssi); stage("air quality", ensureAq); stage("tropical", ensureTc); stage("aviation", ensureAv); stage("en route", ensureEn); stage("gtg", ensureGtg); stage("ifi", ensureIfi); stage("top bar", renderTop); stage("panel", renderPanel); stage("map", drawMap); stage("sheet", sheetVar); if ((S.ap || S.fit === "route") && !framedAp && map && mapLoaded) stage("airport view", () => frameAirport(0)); if (S.sel && !framedSel && map && mapLoaded) stage("selection view", frameSelection); }
  /* a Planner "View on map" for an advisory or a pilot report: frame it once its data has loaded */
  function frameSelection() {
    const p = byId(S.sel); if (!p || !["pirep", "sigmet", "gairmet", "cwa"].includes(p.kind)) return;
    if (p.geometry) { const b = T.bbox(p.geometry); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 8, duration: 0 }); } else if (p.point) map.jumpTo({ center: p.point, zoom: 7.5 });
    framedSel = true; framedAp = true; S.fitted = S.scenario;
  }

  /* ---------- actions ---------- */
  function fitProduct(p) {
    if (!map || !p.geometry) return;
    const b = T.bbox(p.geometry); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 9, duration: 500 });
  }
  const venueCamera = () => ({ center: [venue.lon, venue.lat], zoom: phone() ? 7.4 : 8, padding: pad() });
  function setScope(scope, move) {
    S.scope = scope; S.sel = null; S.point = null; if (scope === "venue") S.pin = true; // the venue view is about the venue: show it
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
    const wl = e.target.closest("[data-wlevel]"), ww = e.target.closest("[data-wwin]");
    if (wl) { S.wlevel = wl.dataset.wlevel; drawAll(); return; }
    const fd = e.target.closest("[data-fday]"); if (fd) { S.fday = +fd.dataset.fday; S.sel = null; drawAll(); return; }
    if (ww) { S.wwin = ww.dataset.wwin; drawAll(); return; }
    const ea = e.target.closest("[data-en-at]"), el = e.target.closest("[data-en-alt]"), eg = e.target.closest("[data-en-age]"), eo = e.target.closest("[data-en-on]");
    if (ea) { S.en.at = +ea.dataset.enAt; S.en.atFixed = true; drawAll(); return; }
    if (el) { const v = el.dataset.enAlt; S.en.alt = v === "all" ? null : v.split("-").map(Number); drawAll(); return; }
    if (eg) { S.en.age = +eg.dataset.enAge; drawAll(); return; }
    if (eo) { S.en.on = true; drawAll(); return; }
    const avt = e.target.closest("[data-avt]");
    if (avt) { const k = avt.dataset.avt, v = avt.getAttribute("aria-pressed") !== "true";
      if (k === "gtg") S.gtg.on = v; else if (k === "ifi") { S.ifi.on = v; renderBar(); } else S.av[k] = v;
      if (v && k !== "apt") S.en.on = true; S.sel = null; drawAll(); const nb = document.querySelector(`[data-avt="${k}"]`); if (nb) nb.focus(); return; }
    const go = e.target.closest("[data-gtg-on]"), gc = e.target.closest("[data-gtg-cls]");
    if (go) { S.gtg.on = true; drawAll(); return; }
    const io = e.target.closest("[data-ifi-on]"), ifd = e.target.closest("[data-ifi-field]");
    if (io) { S.ifi.on = true; renderBar(); drawAll(); return; }
    if (ifd) { S.ifi.field = ifd.dataset.ifiField; drawAll(); return; }
    if (gc) { S.gtg.cls = gc.dataset.gtgCls; drawAll(); return; }
    const it = e.target.closest("[data-id]"), sg = e.target.closest("[data-scope-go]"), vg = e.target.closest("[data-view-go]"), back = e.target.closest("[data-back]");
    if (it) { S.sel = it.dataset.id; S.hover = null; openSheet(); drawAll(); fitProduct(byId(S.sel)); $("txPanelBody").scrollTop = 0; $("txPanelBody").focus({ preventScroll: true }); return; }
    if (sg) { openSheet(); return setScope(sg.dataset.scopeGo, true); }
    if (vg) return setView(vg.dataset.viewGo);
    if (back) { if (S.sel) S.sel = null; else S.point = null; drawAll(); }
  });
  const hoverOn = (e) => { const it = e.target.closest("[data-id]"); const id = it ? it.dataset.id : null; if (id !== S.hover) { S.hover = id; stage("map", drawMap); } };
  $("txPanel").addEventListener("change", (e) => { if (e.target.id === "wssiWin") { S.wwin = e.target.value; drawAll(); } if (e.target.matches("[data-gtg-ft]")) { S.gtg.ft = +e.target.value; drawAll(); } if (e.target.matches("[data-gtg-fh]")) { S.gtg.fh = +e.target.value; drawAll(); } });
  $("txPanel").addEventListener("mouseover", hoverOn); $("txPanel").addEventListener("focusin", hoverOn);
  $("txPanel").addEventListener("mouseleave", () => { if (S.hover) { S.hover = null; stage("map", drawMap); } });
  document.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.scope, true)));
  document.querySelectorAll(".tx-tb").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  /* ---------- Layers picker: hazards (several at once) and what Aviation shows; opening it downloads nothing ---------- */
  const LAYER_NAME = { severe: "Severe storms", flood: "Flooding", winter: "Winter", heat: "Heat & cold", wind: "Wind & visibility", fire: "Fire", smoke: "Smoke & air", tropical: "Tropical", coastal: "Coastal", aviation: "Aviation" };
  const LAYER_KEYS = Object.keys(LAYER_NAME);
  /* why a layer isn't drawn at the selected time (null: it is) */
  function layerNote(k) {
    const d = viewDay(), wv = winterView(), fv = fireView();
    if (wv && k !== "winter") return "not in the Winter view (winter only)";
    if (fv && k !== "fire") return "not in the Fire view (fire only)";
    if (d === 2 || d === 3) {
      if (["smoke", "tropical", "coastal", "heat", "wind"].includes(k)) return "current conditions only: shown on Active now and Day 1";
      if (k === "winter") return "Day " + d + " has no winter layer: use Winter · 7 days";
      if (k === "fire") return "Day " + d + " has no fire layer: use Fire · 8 days";
      if (k === "aviation") return "reports and advisories show on Active now and Day 1; airport weather and model guidance stay";
    }
    return null;
  }
  const layersSummary = () => { const r = S.radar && isLive(), h = hazardSummary(); return h === "None selected" ? (r ? "Radar only" : h) : h + (r ? " + Radar" : ""); };
  const hazardSummary = () => { const on = LAYER_KEYS.filter((k) => S.layers[k]); return !on.length ? "None selected" : on.length === LAYER_KEYS.length ? "All " + LAYER_KEYS.length : on.length <= 2 ? on.map((k) => LAYER_NAME[k]).join(", ") : LAYER_NAME[on[0]] + ", " + LAYER_NAME[on[1]] + " +" + (on.length - 2); };
  const viewName = () => (outlookView() ? "Next 7 days" : winterView() ? "Winter · 7 days" : fireView() ? "Fire · 8 days" : viewDay() ? "Day " + viewDay() : "Active now");
  function syncLayers() {
    const pop = $("txLayersPop"); if (!pop) return;
    pop.querySelectorAll("input[data-layer]").forEach((i) => { i.checked = !!S.layers[i.dataset.layer]; const n = pop.querySelector(`[data-note="${i.dataset.layer}"]`), why = S.layers[i.dataset.layer] && layerNote(i.dataset.layer); n.textContent = why ? "Not drawn now: " + why : ""; n.hidden = !why; });
    const av = { apt: S.av.apt, pireps: S.av.pireps && enOn(), adv: S.av.adv && enOn(), gtg: S.gtg.on, ifi: S.ifi.on };
    pop.querySelectorAll("input[data-av]").forEach((i) => { i.checked = !!av[i.dataset.av]; i.disabled = !S.layers.aviation; });
    $("txAvSub").classList.toggle("off", !S.layers.aviation);
    { const pi = pop.querySelector("input[data-pin]"); if (pi) pi.checked = !!S.pin; const ci = pop.querySelector("input[data-counties]"); if (ci) ci.checked = !!S.counties; }
    { const ri = pop.querySelector("input[data-radar]"); ri.checked = !!S.radar && isLive(); ri.disabled = !isLive();
      $("txRadarNote").textContent = !isLive() ? "Live only: current radar doesn't belong on a demo or a replay" : S.radar && radar.valid ? radarText() : "NOAA MRMS base reflectivity · refreshed every 5 minutes while on · about 0.3 MB per view"; }
    $("txLayersSum").textContent = layersSummary(); $("txLayersBtn").setAttribute("aria-label", "Layers: " + layersSummary() + " on. Open to change");
    // the panel's state line: time and layers stay in view while the details scroll; layers not drawn now, briefly why
    const missing = LAYER_KEYS.filter((k) => S.layers[k] && layerNote(k) && !(k === "aviation" && viewDay())) /* aviation is partly drawn in Day 2/3: the picker says which part */, cur = missing.filter((k) => ["smoke", "tropical", "coastal", "heat", "wind"].includes(k)), own = missing.filter((k) => !["smoke", "tropical", "coastal", "heat", "wind"].includes(k));
    const why = missing.length ? `<span class="tx-psnote">Not drawn in ${esc(viewName())}: ${[cur.length ? cur.map((k) => LAYER_NAME[k]).join(", ") + " (current only)" : "", own.length ? own.map((k) => LAYER_NAME[k]).join(", ") + (winterView() || fireView() ? " (this view shows " + (winterView() ? "winter" : "fire") + " only)" : " (see Layers)") : ""].filter(Boolean).map(esc).join("; ")}</span>` : "";
    $("txPState").innerHTML = `<span class="tx-psv"><b>${esc(viewName())}</b>${data && data.clock && !viewDay() && !winterView() && !fireView() ? " · as of " + esc(t(data.clock)) : ""}</span><span class="tx-psl">Layers: ${esc(layersSummary())}</span>${S.scope === "venue" && venue ? `<span class="tx-psl tx-psvenue">Venue: ${esc(venue.name)}</span>` : ""}${why}`;
  }
  /* the picker scrolls on small screens: show "More below" until its end is in view */
  const popMore = () => { const pop = $("txLayersPop"); if (!pop || pop.hidden) return; pop.classList.toggle("more", pop.scrollTop + pop.clientHeight < pop.scrollHeight - 8); };
  $("txLayersPop").addEventListener("scroll", popMore, { passive: true });
  /* a press on a row focuses it, and the browser then scrolls it clear of the pinned buttons (scroll-padding): the row moved
     between press and release and the click was lost (the last rows: Radar, Icing guidance). Hold the position while pressed;
     a touch drag cancels the press, so scrolling by finger still works */
  { const pop = $("txLayersPop"); let pressTop = null;
    pop.addEventListener("mousedown", (e) => { if (e.target.closest(".tx-lt")) e.preventDefault(); }); // no focus scroll from a press; the click still toggles
    pop.addEventListener("pointerdown", () => { pressTop = pop.scrollTop; }, true);
    pop.addEventListener("scroll", () => { if (pressTop != null && pop.scrollTop !== pressTop) pop.scrollTop = pressTop; });
    for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, () => { setTimeout(() => { pressTop = null; }, 0); }, true); } window.addEventListener("resize", popMore);
  // keyboard: a focused control is scrolled clear of the pinned actions
  $("txLayersPop").addEventListener("focusin", (e) => { const l = e.target.closest(".tx-lt"); if (l && e.target.matches(":focus-visible")) l.scrollIntoView({ block: "nearest" }); popMore(); }); // keyboard only: a pointer press must not move the row it is pressing
  const popOpen = (open) => { const pop = $("txLayersPop"), btn = $("txLayersBtn"); pop.hidden = !open; btn.setAttribute("aria-expanded", String(open)); if (open) { syncLayers(); pop.scrollTop = 0; const f = pop.querySelector("input:not([disabled])"); if (f) f.focus(); requestAnimationFrame(popMore); } };
  $("txLayersBtn").addEventListener("click", () => popOpen($("txLayersPop").hidden));
  $("txPanelBody").addEventListener("click", (e) => { if (e.target.closest("[data-open-layers]")) { e.stopPropagation(); popOpen(true); }
    const pr = e.target.closest("[data-preset]"); if (pr) applyPreset(pr.dataset.preset);
    if (e.target.closest("[data-vfc]")) loadVfc();
    if (e.target.closest("[data-ol-refresh]")) loadOutlook(true);
    const og = e.target.closest("[data-ol-go]"); if (og && og.dataset.olGo) outlookGo(og.dataset.olGo, og.dataset.olKey); });
  $("txLayersPop").addEventListener("change", (e) => {
    const i = e.target; if (!i.matches("input")) return;
    if (i.dataset.layer) { S.layers[i.dataset.layer] = i.checked; if ((!S.layers.winter && winterView()) || (!S.layers.fire && fireView())) S.view = "active"; }
    else if (i.hasAttribute("data-radar")) S.radar = i.checked;
    else if (i.hasAttribute("data-counties")) { S.counties = i.checked; try { localStorage.setItem("threats_counties", S.counties ? "1" : "0"); } catch (e) { /* not remembered */ } }
    else if (i.hasAttribute("data-pin")) { S.pin = i.checked; try { localStorage.setItem("threats_pin", S.pin ? "1" : "0"); } catch (e) { /* not remembered */ } if (!S.pin && S.scope === "venue") { S.scope = "national"; renderTop(); } }
    else if (i.dataset.av === "apt") S.av.apt = i.checked;
    else if (i.dataset.av === "pireps" || i.dataset.av === "adv") { S.av[i.dataset.av] = i.checked; if (i.checked) S.en.on = true; }
    else if (i.dataset.av === "gtg") { S.gtg.on = i.checked; if (i.checked) S.en.on = true; }
    else if (i.dataset.av === "ifi") { S.ifi.on = i.checked; if (i.checked) S.en.on = true; renderBar(); }
    S.sel = null; drawAll();
  });
  $("txLayersPop").addEventListener("click", (e) => {
    if (e.target.closest("[data-layers-close]")) { popOpen(false); $("txLayersBtn").focus(); return; }
    if (e.target.closest("[data-layers-all]")) { LAYER_KEYS.forEach((k) => (S.layers[k] = true)); Object.assign(S.av, { apt: true, pireps: true, adv: true }); S.sel = null; drawAll(); return; }
    if (e.target.closest("[data-layers-reset]")) { LAYER_KEYS.forEach((k) => (S.layers[k] = false)); S.radar = false; Object.assign(S.av, { apt: true, pireps: true, adv: true }); S.gtg.on = false; S.ifi.on = false; if (winterView() || fireView()) S.view = "active"; renderBar(); S.sel = null; drawAll(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("txLayersPop").hidden) { popOpen(false); $("txLayersBtn").focus(); e.preventDefault(); } }, true);
  document.addEventListener("pointerdown", (e) => { if (!$("txLayersPop").hidden && !$("txLyr").contains(e.target)) popOpen(false); });
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
    // the icing overlay's saved records are official NOAA guidance even on a demo page: say so in the banner
    const saved = [S.gtg.on && S.gtg.src === "fixture" ? "turbulence" : null, S.ifi.on && S.ifi.src === "fixture" ? "icing" : null].filter(Boolean);
    const ifiNote = saved.length ? " The " + saved.join(" and ") + " overlay" + (saved.length > 1 ? "s are" : " is") + " different: saved official NOAA guidance (" + saved.map((x) => (x === "turbulence" ? "GTG" : "IFI")).join(", ") + "; the cycle is on the status line), not demo data." : "";
    $("txBarText").textContent = (live ? "Branch preview of official NWS and SPC feeds. Not for operational decisions." : arc ? "Real official messages replayed through the live adapter, at their own time. Not a live observation." : "Fictional products for layout review. Nothing here was issued by NWS or SPC.") + ifiNote;
    $("stepField").hidden = !arc || !(data && data.archive && data.archive.messages.length);
    if (arc && data && data.archive) { $("demoStep").innerHTML = data.archive.messages.map((m, i) => `<option value="${i + 1}">Msg ${i + 1}/${data.archive.steps} · ${esc(m.action || "")} · ${esc(T.fmtTime(m.sent, venue.tz))}</option>`).join(""); $("demoStep").value = String(data.archive.step); }
    const opts = arc ? ARCHIVE_VENUES[S.scenario].map((v) => ({ id: v.id, label: v.label })) : live ? [...(S.entryVenue ? [{ id: "entry", label: "Linked venue: " + S.entryVenue.name }] : []), ...liveVenues()] : [{ id: "inside", label: "Inside the warning" }, { id: "edge", label: "Near the warning edge" }, { id: "outside", label: "Outside the warning" }];
    $("demoVenue").innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");
    $("demoVenue").value = arc ? (S.archiveVenue || (venue && ARCHIVE_VENUES[S.scenario].some((x) => x.id === venue.id) ? venue.id : ARCHIVE_VENUES[S.scenario][0].id)) : live ? (S.entryVenue ? "entry" : S.liveVenue) : S.venueKey;
    $("demoScenario").value = S.scenario;
    const sub = document.querySelector(".statusbar .page-sub"); if (sub) sub.textContent = live ? "Preview · weather threats · live official feeds" : arc ? "Preview · weather threats · archived official sample" : "Preview · weather threats · demo data";
    O.setChip(live ? "LIVE PREVIEW" : arc ? "ARCHIVED SAMPLE" : "DEMO DATA", live ? "live" : "warn", live ? "Official feeds, branch preview" : "Fictional products for layout review");
  }
  $("demoScenario").addEventListener("change", () => {
    S.scenario = $("demoScenario").value; S.sel = null; S.point = null; S.step = null; S.archiveVenue = null;
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
    if (e.key !== "Escape" || e.defaultPrevented) return; // the Layers picker handled it
    if (S.sel || S.point) { S.sel = null; S.point = null; drawAll(); $("txPanelBody").focus({ preventScroll: true }); }
    else if (phone() && S.sheet === "open") setSheet("peek");
  });
  /* our own lines and dots follow the page theme (both basemaps) */
  function themePaints(c) {
    const set = (id, k, v) => { if (map.getLayer(id)) map.setPaintProperty(id, k, v); };
    set("warn-case", "line-color", c.halo); set("ring", "line-color", c.text); set("hl", "line-color", c.text); set("m-hull", "line-color", c.muted); set("pt", "circle-stroke-color", c.text);
    set("warn-dot", "circle-stroke-color", c.halo); set("warn-dot-core", "circle-color", c.halo);
    set("cnty-lines", "line-color", c.muted); set("cnty-labels", "text-color", c.muted); set("cnty-labels", "text-halo-color", c.halo);
    if (map.hasImage("hatch")) map.removeImage("hatch"); map.addImage("hatch", hatch(), { pixelRatio: 2 });
  }
  window.addEventListener("ops:theme", async () => {
    if (!ready) return; const c = pal();
    if (carto) { // swap the street map's light/dark style, keeping our sources and layers
      const next = await cartoStyle(light() ? "light" : "dark"); if (!next) { themePaints(c); drawAll(); return; }
      const prev = map.getStyle(), ours = prev.layers.filter((l) => OUR.includes(l.id) || l.id === "radar"), keepSrc = Object.fromEntries(Object.entries(prev.sources).filter(([k]) => !next.sources[k]));
      map.once("style.load", () => { baseLines(); orderOverBase(); themePaints(pal()); radar.tiles = null; drawAll(); }); // hatch is re-added in themePaints
      map.setStyle(next, { diff: false, transformStyle: () => ({ ...next, sources: { ...next.sources, ...keepSrc }, layers: [...next.layers, ...ours] }) }); // a full reload, so style.load runs
      return; }
    map.setPaintProperty("bg", "background-color", c.land); map.setPaintProperty("lakes", "fill-color", c.water); map.setPaintProperty("states", "line-color", c.line);
    map.setPaintProperty("cities", "text-color", c.muted); map.setPaintProperty("cities", "text-halo-color", c.halo);
    themePaints(c); drawAll();
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
    if (["live", "overlap", "multi", "quiet", "unavailable", "outage-expired", "archive-lox", "archive-reports-delaware", "archive-mtr", "archive-ww705", "archive-flood-day", "archive-flood-afternoon", "archive-flood-outage", "archive-flood-night", "archive-winter-advisory", "archive-winter-warning", "archive-winter-outlook", "archive-fire-day4", "archive-fire-day2", "archive-fire-day1", "archive-fire-watch", "archive-fire-warning", "archive-fire-incidents", "archive-smoke-chicago", "archive-smoke-metlife", "archive-smoke-forecast-0714", "archive-smoke-forecast-0715", "archive-tropical-watch", "archive-tropical-warning", "archive-coastal-flagler", "archive-aviation-chicago", "archive-aviation-enroute"].includes(q.get("scenario"))) S.scenario = q.get("scenario");
    if (["inside", "edge", "outside"].includes(q.get("venue"))) S.venueKey = q.get("venue");
    const lat = parseFloat(q.get("lat")), lon = parseFloat(q.get("lon"));
    if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      S.entryVenue = { id: "entry", name: ((n) => n.length <= 80 ? n : n.slice(0, 79).replace(/\s+\S*$/, "") + "…")((q.get("name") || "Event venue").trim()), city: q.get("city") || "", lat, lon, tz: q.get("tz") || null /* no tz= in the link: looked up from the venue's position (withTz) */ };
      S.scope = "venue";
    }
    if (["outlook", "active", "day1", "day2", "day3", "winter", "fire"].includes(q.get("view"))) S.view = q.get("view");
    // a fresh live visit (no view, layers, selection or aviation in the link) opens on the venue's next 7 days
    else if (S.scenario === "live" && !q.get("layers") && !q.get("sel") && !q.get("air") && !q.get("rt") && !q.get("gtg") && !q.get("ifi") && !q.get("focus")) S.view = "outlook";
    if (q.get("air")) S.air = q.get("air").toUpperCase().split(",").filter((x) => /^[A-Z][A-Z0-9]{3}$/.test(x)).slice(0, 4);
    if (/^[A-Z][A-Z0-9]{3}$/i.test(q.get("ap") || "")) S.ap = q.get("ap").toUpperCase();
    try { const r = JSON.parse(q.get("rt") || "null"); if (r && /^[A-Z][A-Z0-9]{3}$/i.test(r.o || "") && /^[A-Z][A-Z0-9]{3}$/i.test(r.d || "") && Number.isInteger(r.lo) && Number.isInteger(r.hi) && r.hi > r.lo) S.route = { o: r.o.toUpperCase(), d: r.d.toUpperCase(), lo: r.lo, hi: r.hi }; } catch (x) { /* ignored */ }
    { const m = /^(\d{1,5})-(\d{1,5})$/.exec(q.get("alt") || ""); if (m && +m[2] > +m[1]) S.en.alt = [+m[1], +m[2]]; }
    if (q.get("at") && !isNaN(Date.parse(q.get("at")))) S.en.atIso = new Date(q.get("at")).toISOString();
    if (["1", "2", "3"].includes(q.get("age"))) S.en.age = +q.get("age");
    if (q.get("fit") === "route") S.fit = "route";
    if (q.get("gtg") === "1") { S.gtg.on = true; S.en.on = true; }
    if (/^\d{1,2}$/.test(q.get("gfh") || "") && +q.get("gfh") <= 18) S.gtg.fh = +q.get("gfh");
    if (/^\d{3,5}$/.test(q.get("gft") || "") && window.ThreatsGTG && window.ThreatsGTG.HEIGHTS.some((h) => h.ft === +q.get("gft"))) S.gtg.ft = +q.get("gft");
    if (["light", "medium", "heavy"].includes(q.get("gcls"))) S.gtg.cls = q.get("gcls");
    if (q.get("ifi") === "1") { S.ifi.on = true; S.en.on = true; }
    if (["prob", "sev"].includes(q.get("ifield"))) S.ifi.field = q.get("ifield");
    if (q.get("ifisrc") === "fixture") S.ifi.src = "fixture"; // the official records saved in tests/fixtures/threats/ifi (labelled replay)
    if (/^\d{10}$/.test(q.get("icyc") || "")) S.ifi.cyc = q.get("icyc");
    if (/^\d{10}$/.test(q.get("gcyc") || "")) S.gtg.cyc = q.get("gcyc");
    if (q.get("gtgsrc") === "fixture") S.gtg.src = "fixture"; // the saved official GTG records (tests/fixtures/threats/gtg) // a pinned cycle (Planner findings link to the cycle they used)
    { const f = (q.get("focus") || "").split(",").map(Number); if (f.length === 2 && f.every(Number.isFinite) && Math.abs(f[0]) <= 180 && Math.abs(f[1]) <= 90) S.focus = f; }
    if (S.route) S.air = [...new Set([...S.air, S.route.o, S.route.d])].slice(0, 4);
    if (+q.get("fday") >= 1 && +q.get("fday") <= 8) S.fday = +q.get("fday");
    if (q.get("rx") === "1") S.rx = true;
    if (q.get("ctn") === "1") S.ctn = true;
    if (q.get("radar") === "1") S.radar = true;
    try { if (localStorage.getItem("threats_pin") === "0") S.pin = false; } catch (e) { /* no storage: marker shown */ }
    try { if (localStorage.getItem("threats_counties") === "0") S.counties = false; } catch (e) { /* no storage: shown */ }
    if (q.get("counties") === "0") S.counties = false; else if (q.get("counties") === "1") S.counties = true;
    if (q.get("pin") === "0") S.pin = false; else if (q.get("pin") === "1" || q.get("scope") === "venue") S.pin = true;
    if (q.get("layers")) { const L = q.get("layers").split(","); if (L.includes("aviation")) S.en.on = true; Object.keys(S.layers).forEach((k) => (S.layers[k] = L.includes(k))); } // keeps the picker's order
    else if (S.scenario !== "live") Object.keys(S.layers).forEach((k) => (S.layers[k] = true)); // demo and archived samples: their shared selection is every layer
    else if (S.gtg.on || S.ifi.on || q.get("air") || q.get("rt") || q.get("alt")) S.layers.aviation = true; // a live link naming aviation content and no layers
    /* a fresh live visit: radar and the current NWS warnings, watches and advisories (with storm reports and MDs); fire, smoke and
       aviation stay off until chosen. ?layers=none opens with nothing, ?radar=0 without radar */
    else { ["severe", "flood", "winter", "heat", "wind", "tropical", "coastal"].forEach((k) => (S.layers[k] = true)); if (q.get("radar") !== "0") S.radar = true; }
    if (S.view === "winter") S.layers.winter = true;
    if (S.view === "fire") S.layers.fire = true;
    if (FX.WSSI_LEVELS.includes(q.get("wlevel"))) S.wlevel = q.get("wlevel");
    if (q.get("wwin") && !isNaN(Date.parse(q.get("wwin")))) S.wwin = new Date(q.get("wwin")).toISOString();
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
  load(); measure(); stage("top bar", renderTop); stage("panel", renderPanel);
  stage("layer feeds", syncFeeds); // live: only the selected layers' feeds (none on a fresh visit)
  // live: redraw on every feed update, and every 30 s so countdowns, expirations and staleness stay true
  Live.onUpdate(() => { if (isLive() && liveReady) { load(); drawAll(); } });
  setInterval(() => { if (isLive() && liveReady) { load(); drawAll(); } }, 30e3);
  startModel();
  setSheet(phone() ? (S.sheet || "peek") : "open");
  /* Planner's airport "View on map": frame the selected airport together with the venue (both stay in view) */

  function frameAirport(duration) {
    if (map && S.fit === "route") { const rr = routeEnds(); if (!rr) return false; const xs = [rr.o[0], rr.d[0]], ys = [rr.o[1], rr.d[1]]; map.fitBounds([[Math.min(...xs) - 0.3, Math.min(...ys) - 0.3], [Math.max(...xs) + 0.3, Math.max(...ys) + 0.3]], { padding: pad(), maxZoom: 9, duration }); framedAp = true; return true; }
    if (!map || !S.ap) return false;
    const p = (data.products || []).find((x) => x.family === "aviation" && x.airport === S.ap && Array.isArray(x.point)); if (!p) return false;
    const pts = [p.point]; if (S.scope === "venue" && venue && Number.isFinite(+venue.lon)) pts.push([+venue.lon, +venue.lat]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), m = 0.05;
    map.fitBounds([[Math.min(...xs) - m, Math.min(...ys) - m], [Math.max(...xs) + m, Math.max(...ys) + m]], { padding: pad(), maxZoom: 10, duration });
    framedAp = true; return true;
  }
  createMap().then(() => {
    map.once("load", () => {
      mapLoaded = true;
      if (S.focus) { map.jumpTo({ center: S.focus, zoom: 6.5 }); framedAp = true; framedSel = true; S.fitted = S.scenario; return; } // a Planner GTG finding: its spot
      if ((S.ap || S.fit === "route") && frameAirport(0)) return; // otherwise drawAll frames it once the airport's report has loaded
      if (S.sel && byId(S.sel) && byId(S.sel).geometry) { const b = T.bbox(byId(S.sel).geometry); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 9, duration: 0 }); }
      else if (isArchive()) fitArchive();
      else if (S.scope === "venue") map.jumpTo(venueCamera());
      else map.fitBounds(CONUS, { padding: pad(), duration: 0 });
    });
  }).catch((e) => { $("txMap").innerHTML = `<p class="msg" style="padding:20px">The map could not load (${esc(e.message)}). The threat list still works.</p>`; });
  window.__threats = { S, drawAll, radar, get outlook() { return vo; }, get basemap() { return carto ? "carto" : "fallback"; }, retryCarto, get venue() { return venue; }, get vfc() { return vfc; }, ifi: { get state() { return ifi.state; }, get reason() { return ifi.reason; }, get key() { return ifi.key; }, get latest() { return ifi.latest; }, get dec() { return ifi.dec; }, at: (lon, lat) => ifiAt([lon, lat]) }, gtg: { get state() { return gtg.state; }, get error() { return gtg.error; }, get key() { return gtg.key; }, get latest() { return gtg.latest; }, get dec() { return gtg.dec; }, at: (lon, lat) => gtgAt([lon, lat]) }, frameAirport, get map() { return map; }, get ready() { return ready; }, get liveReady() { return liveReady; }, get data() { return data; }, errors: drawErrors, diag: Live.diag };
})();
