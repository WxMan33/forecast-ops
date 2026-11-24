/* Weather threats preview: DEMO fixtures only. Every product here is fictional, made for layout review. The
   shapes and times are realistic so the map can be judged, but none of these were issued by NWS or SPC.
   Scenarios: overlap (warning + watch + MD + Day 1 outlook near the venue), quiet, unavailable (one feed stale,
   one feed down). Venue positions move only the venue; the products stay put. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ThreatsDemo = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const CLOCK = "2026-11-20T20:58:00Z"; // Fri Nov 20, 3:58 PM EST
  const poly = (...pts) => ({ type: "Polygon", coordinates: [[...pts, pts[0]]] });

  const VENUES = {
    inside: { id: "tql", name: "TQL Stadium", city: "Cincinnati, OH", lat: 39.1111, lon: -84.5223, tz: "America/New_York", note: "Inside the warning" },
    edge: { id: "nku", name: "Truist Arena (NKU)", city: "Highland Heights, KY", lat: 39.0316, lon: -84.4652, tz: "America/New_York", note: "Just outside the warning edge" },
    outside: { id: "day", name: "Day Air Ballpark", city: "Dayton, OH", lat: 39.7640, lon: -84.1856, tz: "America/New_York", note: "Outside the warning, inside the watch" },
  };

  const BULLETIN_NOTE = "DEMO BULLETIN · fictional text written for this preview. In the beta this opens the official product.";

  const warning = {
    id: "demo-tor-iln-0071", kind: "warning", event: "Tornado Warning", title: "Tornado Warning",
    headline: "Radar-indicated rotation moving northeast at 45 mph toward downtown Cincinnati and Northern Kentucky.",
    hazard: "Tornado, radar indicated · hail up to 1 inch",
    area: "Hamilton County, OH · Boone, Kenton and Campbell Counties, KY",
    office: "NWS Wilmington OH (ILN)",
    issued: "2026-11-20T20:31:00Z", updated: "2026-11-20T20:52:00Z", expires: "2026-11-20T21:15:00Z",
    geometry: poly([-84.86, 38.98], [-84.68, 38.92], [-84.30, 39.20], [-84.42, 39.31]),
    changeNote: "southwest end trimmed behind the storm",
    previous: {
      id: "demo-tor-iln-0071", event: "Tornado Warning", issued: "2026-11-20T20:31:00Z", expires: "2026-11-20T21:15:00Z",
      hazard: "Tornado, radar indicated · hail up to 1 inch",
      geometry: poly([-85.02, 38.90], [-84.72, 38.82], [-84.28, 39.20], [-84.42, 39.34]),
    },
    label: [-84.40, 39.22],
    source: { name: "NWS alerts (api.weather.gov)", url: "https://api.weather.gov/alerts/active?area=OH" },
    bulletin: "BULLETIN - IMMEDIATE BROADCAST REQUESTED\nTornado Warning\nNational Weather Service Wilmington OH\n352 PM EST Fri Nov 20 2026\n\n...A TORNADO WARNING REMAINS IN EFFECT UNTIL 415 PM EST FOR HAMILTON COUNTY OHIO AND BOONE, KENTON AND CAMPBELL COUNTIES IN NORTHERN KENTUCKY...\n\nAt 351 PM EST, a severe thunderstorm capable of producing a tornado was located near Hebron, moving northeast at 45 mph.\n\nHAZARD...Tornado and quarter size hail.\nSOURCE...Radar indicated rotation.",
  };
  const watch = {
    id: "demo-ww-0612", kind: "watch", event: "Tornado Watch", title: "Tornado Watch 612",
    headline: "Conditions favor tornadoes and damaging wind gusts to 70 mph across southwest Ohio, southeast Indiana and northern Kentucky.",
    hazard: "A few tornadoes likely · scattered damaging winds to 70 mph · isolated hail to 1.5 inches",
    area: "42 counties in southeast Indiana, southwest and central Ohio, and northern Kentucky",
    office: "NWS Storm Prediction Center",
    issued: "2026-11-20T18:55:00Z", updated: "2026-11-20T18:55:00Z", expires: "2026-11-21T02:00:00Z",
    geometry: poly([-86.15, 38.30], [-83.55, 38.25], [-83.25, 40.05], [-85.90, 40.10]),
    label: [-85.55, 39.85],
    source: { name: "NWS alerts (api.weather.gov)", url: "https://api.weather.gov/alerts/active?event=Tornado%20Watch" },
    bulletin: "URGENT - IMMEDIATE BROADCAST REQUESTED\nTornado Watch Number 612\nNWS Storm Prediction Center Norman OK\n155 PM EST Fri Nov 20 2026\n\nThe NWS Storm Prediction Center has issued a\n* Tornado Watch for portions of\n  Southeast Indiana\n  Northern Kentucky\n  Southwest and Central Ohio\n* Effective this Friday afternoon and evening from 155 PM until 900 PM EST.\n\n* Primary threats include...\n  A few tornadoes likely with a couple intense tornadoes possible\n  Scattered damaging wind gusts to 70 mph likely\n  Isolated large hail events to 1.5 inches in diameter possible",
  };
  const md = {
    id: "demo-md-1945", kind: "md", event: "Mesoscale Discussion", title: "Mesoscale Discussion (MD) 1945",
    headline: "Tornado threat increasing near the Ohio River over the next 1–2 hours as storms cross a warm front.",
    hazard: "Concerning Tornado Watch 612 · probability of a new watch: 5%",
    area: "Southwest Ohio, southeast Indiana, northern Kentucky",
    office: "NWS Storm Prediction Center",
    issued: "2026-11-20T20:22:00Z", updated: "2026-11-20T20:22:00Z", validStart: "2026-11-20T20:22:00Z", expires: "2026-11-20T22:15:00Z",
    geometry: poly([-85.55, 38.62], [-84.05, 38.45], [-83.45, 39.45], [-85.15, 39.72]),
    label: [-84.05, 38.62],
    source: { name: "SPC Mesoscale Discussions", url: "https://www.spc.noaa.gov/products/md/" },
    bulletin: "Mesoscale Discussion 1945\nNWS Storm Prediction Center Norman OK\n0222 PM CST Fri Nov 20 2026\n\nAreas affected...Southwest Ohio...southeast Indiana...northern Kentucky\n\nConcerning...Tornado Watch 612...\n\nValid 202022Z - 202215Z\n\nThe severe weather threat for Tornado Watch 612 continues.\n\nSUMMARY...The tornado threat will increase near the Ohio River over the next 1-2 hours as supercells interact with a northward-moving warm front.",
  };

  const D1 = { issued: "2026-11-20T16:30:00Z", validStart: "2026-11-20T16:30:00Z", validEnd: "2026-11-21T12:00:00Z" };
  const D2 = { issued: "2026-11-20T17:30:00Z", validStart: "2026-11-21T12:00:00Z", validEnd: "2026-11-22T12:00:00Z" };
  const outlook = (day, t, category, geometry, label) => ({
    id: "demo-d" + day + "-" + category, kind: "outlook", day, category, event: "Day " + day + " Convective Outlook",
    title: "Day " + day + " outlook", ...t, geometry, label, office: "NWS Storm Prediction Center",
    source: { name: "SPC convective outlooks", url: "https://www.spc.noaa.gov/products/outlook/day" + day + "otlk.html" },
  });
  const DAY1 = [
    outlook(1, D1, "TSTM", poly([-95.5, 29.5], [-80.5, 29.0], [-75.5, 41.0], [-84.0, 44.5], [-93.5, 40.0]), [-92.0, 36.5]),
    outlook(1, D1, "MRGL", poly([-92.0, 31.0], [-83.0, 30.8], [-78.8, 39.8], [-83.4, 42.6], [-89.8, 39.6]), [-89.2, 34.0]),
    outlook(1, D1, "SLGT", poly([-89.2, 33.4], [-84.6, 33.2], [-81.0, 39.4], [-83.6, 41.6], [-87.9, 39.8]), [-86.6, 35.2]),
    outlook(1, D1, "ENH", poly([-87.3, 36.5], [-84.9, 36.4], [-82.6, 39.4], [-84.0, 40.5], [-86.4, 39.3]), [-85.9, 37.4]),
  ];
  const DAY2 = [
    outlook(2, D2, "TSTM", poly([-86.0, 29.5], [-77.0, 31.5], [-71.5, 41.5], [-79.0, 43.5], [-85.5, 36.5]), [-83.6, 32.0]),
    outlook(2, D2, "MRGL", poly([-83.6, 31.3], [-77.2, 33.6], [-75.2, 40.3], [-79.8, 41.0], [-83.4, 36.0]), [-81.4, 33.6]),
    outlook(2, D2, "SLGT", poly([-81.8, 33.4], [-77.8, 35.0], [-76.6, 38.9], [-79.8, 39.4], [-81.8, 36.2]), [-79.4, 36.2]),
  ];
  const QUIET_DAY1 = [outlook(1, D1, "TSTM", poly([-83.5, 25.0], [-80.0, 25.0], [-79.8, 28.8], [-82.8, 29.6]), [-81.6, 27.4])];
  const QUIET_DAY2 = [outlook(2, D2, "TSTM", poly([-124.8, 46.0], [-122.0, 46.0], [-121.8, 48.6], [-124.6, 48.4]), [-123.4, 47.2])];

  /* Several regions at once (marker visibility, label collisions, panel order vs map emphasis). A storm-shaped box
     around a centre, pointing northeast. */
  function box(lon, lat, len = 0.55, wid = 0.22, deg = 40) {
    const a = (deg * Math.PI) / 180, k = Math.cos((lat * Math.PI) / 180);
    const ux = Math.cos(a) / k, uy = Math.sin(a), vx = -Math.sin(a) / k, vy = Math.cos(a);
    const c = (s, t) => [+(lon + s * ux * len / 2 + t * vx * wid / 2).toFixed(3), +(lat + s * uy * len / 2 + t * vy * wid / 2).toFixed(3)];
    return poly(c(-1, -1), c(1, -1), c(1, 1), c(-1, 1));
  }
  const NWS = { name: "NWS alerts (api.weather.gov)", url: "https://api.weather.gov/alerts/active" };
  const extraWarning = (id, event, office, area, lon, lat, issued, expires, headline, hazard) => ({
    id, kind: "warning", event, title: event, headline, hazard, area, office, issued, updated: issued, expires,
    geometry: box(lon, lat), label: [lon, lat], source: NWS });
  const MULTI = [
    extraWarning("demo-tor-meg-0044", "Tornado Warning", "NWS Memphis TN (MEG)", "Lee and Pontotoc Counties, MS", -88.75, 34.24, "2026-11-20T20:44:00Z", "2026-11-20T21:30:00Z", "Radar-indicated rotation near Tupelo moving northeast at 40 mph.", "Tornado, radar indicated"),
    extraWarning("demo-tor-hun-0031", "Tornado Warning", "NWS Huntsville AL (HUN)", "Franklin and Colbert Counties, AL", -87.82, 34.55, "2026-11-20T20:50:00Z", "2026-11-20T21:45:00Z", "Radar-indicated rotation near Russellville moving northeast at 45 mph.", "Tornado, radar indicated"),
    extraWarning("demo-svr-bmx-0118", "Severe Thunderstorm Warning", "NWS Birmingham AL (BMX)", "Jefferson and Blount Counties, AL", -86.75, 33.62, "2026-11-20T20:40:00Z", "2026-11-20T21:30:00Z", "Storm with 60 mph wind gusts and quarter-size hail moving northeast at 35 mph.", "60 mph wind gusts · 1 inch hail"),
    extraWarning("demo-svr-fwd-0207", "Severe Thunderstorm Warning", "NWS Fort Worth TX (FWD)", "Collin and Denton Counties, TX", -96.80, 33.20, "2026-11-20T20:35:00Z", "2026-11-20T21:15:00Z", "Storm with 1.75 inch hail and 60 mph wind gusts moving east at 30 mph.", "1.75 inch hail · 60 mph wind gusts"),
    extraWarning("demo-svr-dmx-0089", "Severe Thunderstorm Warning", "NWS Des Moines IA (DMX)", "Polk and Jasper Counties, IA", -93.40, 41.65, "2026-11-20T20:48:00Z", "2026-11-20T21:30:00Z", "Line of storms with 60 mph wind gusts moving east at 50 mph.", "60 mph wind gusts"),
    { id: "demo-ww-0613", kind: "watch", event: "Tornado Watch", title: "Tornado Watch 613", headline: "Tornadoes and damaging winds possible across north Mississippi, north Alabama and southern middle Tennessee.",
      hazard: "A few tornadoes likely · damaging winds to 70 mph", area: "38 counties in Mississippi, Alabama and Tennessee", office: "NWS Storm Prediction Center",
      issued: "2026-11-20T19:30:00Z", updated: "2026-11-20T19:30:00Z", expires: "2026-11-21T03:00:00Z",
      geometry: poly([-89.6, 33.4], [-86.3, 33.9], [-86.0, 35.6], [-89.3, 35.2]), label: [-88.0, 35.3], source: NWS },
    { id: "demo-ww-0614", kind: "watch", event: "Severe Thunderstorm Watch", title: "Severe Thunderstorm Watch 614", headline: "Large hail and damaging winds possible across north Texas and southern Oklahoma.",
      hazard: "Scattered large hail to 2 inches · damaging winds to 65 mph", area: "31 counties in Texas and Oklahoma", office: "NWS Storm Prediction Center",
      issued: "2026-11-20T19:10:00Z", updated: "2026-11-20T19:10:00Z", expires: "2026-11-21T02:00:00Z",
      geometry: poly([-98.4, 32.3], [-95.6, 32.3], [-95.8, 34.6], [-98.3, 34.6]), label: [-97.0, 34.4], source: NWS },
  ];

  const ok = (count, ageMin = 2) => ({ state: "ok", lastOk: new Date(Date.parse(CLOCK) - ageMin * 60e3).toISOString(), count });

  function scenario(name) {
    const base = { clock: CLOCK, venues: VENUES };
    if (name === "quiet") return { ...base, name, products: [...QUIET_DAY1, ...QUIET_DAY2],
      sources: { alerts: ok(0), md: ok(0, 4), day1: ok(1, 3), day2: ok(1, 3) } };
    if (name === "multi") return { ...base, name, products: [warning, watch, md, ...MULTI, ...DAY1, ...DAY2],
      sources: { alerts: ok(9), md: ok(1, 4), day1: ok(4, 3), day2: ok(3, 3) } };
    // the same outage 22 minutes later: the warning's published expiration (4:15 PM) has passed with no confirmed update
    if (name === "outage-expired") return { ...base, clock: "2026-11-20T21:20:00Z", name, products: [warning, watch, ...DAY1, ...DAY2],
      sources: { alerts: { state: "failed", lastOk: "2026-11-20T20:41:00Z", count: 2 }, md: { state: "failed", lastOk: null },
        day1: { state: "ok", lastOk: "2026-11-20T21:17:00Z", count: 4 }, day2: { state: "ok", lastOk: "2026-11-20T21:17:00Z", count: 3 } } };
    if (name === "unavailable") return { ...base, name, products: [warning, watch, ...DAY1, ...DAY2],
      // NWS alerts: last good answer 17 minutes old, newer refreshes failed. The warning stays on the map, marked
      // unconfirmed; it is never treated as cleared. SPC MDs: no successful answer since the page opened.
      sources: { alerts: { state: "failed", lastOk: "2026-11-20T20:41:00Z", count: 2 }, md: { state: "failed", lastOk: null }, day1: ok(4, 3), day2: ok(3, 3) } };
    return { ...base, name: "overlap", products: [warning, watch, md, ...DAY1, ...DAY2],
      sources: { alerts: ok(2), md: ok(1, 4), day1: ok(4, 3), day2: ok(3, 3) } };
  }

  /* Demo values for the research-model layer, drawn on the real research grid so coverage and masking are real.
     The numbers are invented: a smooth bump near the demo storms (Day 1) and over the Appalachians (Day 2). */
  function modelValues(grid, day, hazard) {
    const centre = day === 1 ? [-85.2, 38.4] : [-79.6, 37.4];
    const peak = { tornado: day === 1 ? 0.11 : 0.04, wind: day === 1 ? 0.34 : 0.17, hail: day === 1 ? 0.16 : 0.07 }[hazard];
    const sx = { tornado: 2.0, wind: 3.4, hail: 2.6 }[hazard], sy = sx * 0.62, tilt = 0.6;
    return grid.map(([lon, lat]) => {
      const dx = lon - centre[0], dy = lat - centre[1];
      const u = dx * Math.cos(tilt) + dy * Math.sin(tilt), v = -dx * Math.sin(tilt) + dy * Math.cos(tilt);
      return peak * Math.exp(-(u * u) / (2 * sx * sx) - (v * v) / (2 * sy * sy));
    });
  }

  return { CLOCK, VENUES, BULLETIN_NOTE, scenario, modelValues };
});
