/* Weather threats, aviation phase 2: weather along the way and disruptions at either end. Pure (no DOM, no network);
   shared by the map, Event Planner and the Node tests.

   Sources (all official, all through the preview's same-origin functions):
   - Pilot reports (PIREPs): NOAA Aviation Weather Center Data API /api/data/pirep. Observations by pilots: turbulence
     and icing intensity, altitude, time, aircraft type. Reports of light or greater are kept; "smooth" reports are not.
   - Advisories: domestic SIGMETs (convective, turbulence, icing; /api/data/airsigmet), G-AIRMETs (turbulence high and
     low, icing, IFR, mountain obscuration, surface wind, low-level wind shear; /api/data/gairmet, snapshots at 0, 3, 6,
     9 and 12 hours) and Center Weather Advisories (/api/data/cwa). Official forecasts and advisories, not observations.
   - FAA National Airspace System status (nasstatus.faa.gov/api/airport-events and /api/operations-plan): ground stops,
     ground delay programs, arrival and departure delays, closures, with the FAA's stated cause and times.
   Gridded turbulence guidance (GTG) is not used: AWC's Data API does not publish it, and no supported machine-readable
   source was verified for this build. Model guidance is therefore absent, and the map says so.

   Route: an event may name an origin, a destination and an altitude band. The route is drawn as a straight line between
   the two airports and labelled an approximate route; real flights follow airways and ATC instructions. An advisory is a
   potential overlap when its area comes within ROUTE_MI of that line, its valid time overlaps the time in the air and its
   altitude range overlaps the band. Without a route, en-route hazards are regional context on the map only. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./threats-core.js"));
  else root.ThreatsEnroute = factory(root.ThreatsCore);
})(typeof globalThis !== "undefined" ? globalThis : this, function (T) {
  "use strict";
  const ROUTE_MI = 25, ROUTE_KM = ROUTE_MI * T.KM_PER_MI, PIREP_ROUTE_MIN = 90, GAIRMET_HALF_MS = 90 * 60e3;
  const iso = (v) => (v == null || v === "" ? null : new Date(typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : v).toISOString());
  const num = (v) => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);
  const ftText = (ft) => (ft == null ? "?" : ft === 0 ? "the surface" : ft >= 18000 ? "FL" + String(Math.round(ft / 100)).padStart(3, "0") : Math.round(ft).toLocaleString("en-US") + " ft");
  const bandText = (lo, hi) => (lo == null && hi == null ? "altitude not stated" : (lo == null || lo === 0 ? "surface" : ftText(lo)) + " to " + (hi == null ? "an unstated top" : ftText(hi)));

  /* ---------- pilot reports ---------- */
  const INTEN = { NEG: 0, SMTH: 0, SMOOTH: 0, NIL: 0, TRC: 0.5, TRACE: 0.5, LGT: 1, "LGT-MOD": 1.5, MOD: 2, "MOD-SEV": 2.5, SEV: 3, HVY: 3, "SEV-EXTM": 3.5, EXTM: 4 };
  const INTEN_WORD = { 0.5: "trace", 1: "light", 1.5: "light to moderate", 2: "moderate", 2.5: "moderate to severe", 3: "severe", 3.5: "severe to extreme", 4: "extreme" };
  const rankOf = (s) => { const k = String(s || "").toUpperCase().trim(); return k in INTEN ? INTEN[k] : null; };
  function layer(int, bas, top, type, freq) {
    const r = rankOf(int); if (r == null || r < 1) return null;
    let b = num(bas) != null ? num(bas) * 100 : null, t = num(top) != null ? num(top) * 100 : null;
    if (b != null && t != null && b > t) [b, t] = [t, b]; // some reports give the layer top first ("200-150")
    return { int: String(int).toUpperCase(), rank: r, word: INTEN_WORD[r], baseFt: b, topFt: t, type: type || null, freq: freq || null };
  }
  function parsePIREP(list) {
    if (!Array.isArray(list)) throw Error("unrecognized PIREP answer");
    const out = [];
    for (const r of list) {
      if (!Number.isFinite(+r.lat) || !Number.isFinite(+r.lon) || !r.obsTime) continue;
      const turb = [layer(r.tbInt1, r.tbBas1, r.tbTop1, r.tbType1, r.tbFreq1), layer(r.tbInt2, r.tbBas2, r.tbTop2, r.tbType2, r.tbFreq2)].filter(Boolean);
      const ice = [layer(r.icgInt1, r.icgBas1, r.icgTop1, r.icgType1), layer(r.icgInt2, r.icgBas2, r.icgTop2, r.icgType2)].filter(Boolean);
      if (!turb.length && !ice.length) continue;
      const fl = num(r.fltLvl), during = r.fltLvlType === "DURD" ? "descent" : r.fltLvlType === "DURC" ? "climb" : null;
      const altFt = fl != null && fl > 0 ? fl * 100 : null, all = [...turb, ...ice];
      const lo = Math.min(...all.map((x) => (x.baseFt != null ? x.baseFt : altFt != null ? altFt : Infinity))), hi = Math.max(...all.map((x) => (x.topFt != null ? x.topFt : altFt != null ? altFt : -Infinity)));
      let lowFt = Number.isFinite(lo) ? lo : null, highFt = Number.isFinite(hi) ? hi : null;
      if (lowFt == null) lowFt = highFt; if (highFt == null) highFt = lowFt; // one bound given: the report is at that altitude
      const observed = iso(r.obsTime), rank = Math.max(...all.map((x) => x.rank));
      const hazard = turb.length && ice.length ? "turbulence and icing" : turb.length ? "turbulence" : "icing";
      out.push({ id: "pirep-" + r.obsTime + "-" + (+r.lat).toFixed(3) + "-" + (+r.lon).toFixed(3) + "-" + (r.acType || ""), kind: "pirep", family: "aviation", sourceId: "enroute", layerKind: "observation",
        observed, issued: observed, point: [+r.lon, +r.lat], geometry: null, altFt, during, lowFt, highFt,
        turb, ice, hazard, rank, urgent: /urgent|UUA/i.test(r.pirepType || "") || / UUA /.test(" " + (r.rawOb || "") + " "), acType: r.acType || null, raw: r.rawOb || "",
        office: "Pilot report via NOAA Aviation Weather Center", event: "Pilot report", title: "Pilot report: " + (INTEN_WORD[rank] || "") + " " + hazard,
        source: { name: "Aviation Weather Center pilot reports", url: "https://aviationweather.gov/data/pirep/" } });
    }
    return out;
  }
  /* what a report says, in plain words: "moderate turbulence at 6,000 ft" */
  function pirepText(p) {
    const at = p.lowFt != null && p.highFt != null && p.lowFt !== p.highFt ? "between " + ftText(p.lowFt) + " and " + ftText(p.highFt) : p.lowFt != null ? "at " + ftText(p.lowFt) + (p.during ? " (during " + p.during + ")" : "") : p.altFt != null ? "at " + ftText(p.altFt) : p.during ? "during " + p.during + " (altitude not given)" : "altitude not given";
    const top = (l) => l.slice().sort((a, b) => b.rank - a.rank).slice(0, 1); // the strongest layer of each
    const what = [...top(p.turb).map((x) => x.word + " turbulence" + (x.type ? " (" + x.type.toLowerCase() + ")" : "")), ...top(p.ice).map((x) => x.word + " icing" + (x.type ? " (" + x.type.toLowerCase() + ")" : ""))];
    return what.join(" and ") + " " + at;
  }

  /* ---------- advisories ---------- */
  const ring = (coords) => { const r = (coords || []).map((c) => [+c.lon, +c.lat]).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])); if (r.length >= 3 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0].slice()); return r; };
  const HAZ = { // family (map color and legend), plain word
    CONVECTIVE: ["convective", "thunderstorms"], TS: ["convective", "thunderstorms"], TURB: ["turbulence", "turbulence"], "TURB-HI": ["turbulence", "high-altitude turbulence"], "TURB-LO": ["turbulence", "low-altitude turbulence"],
    ICE: ["icing", "icing"], IFR: ["low", "low clouds or visibility (IFR)"], MT_OBSC: ["low", "mountains obscured"], "MTN OBSCN": ["low", "mountains obscured"], SFC_WND: ["wind", "strong surface winds"], LLWS: ["wind", "low-level wind shear"],
    ASH: ["ash", "volcanic ash"], VA: ["ash", "volcanic ash"], PCPN: ["convective", "heavy precipitation"],
  };
  const SURFACE = new Set(["IFR", "MT_OBSC", "MTN OBSCN", "SFC_WND", "LLWS"]); // surface-based: the airports' own TAFs cover them; not matched to a cruise band
  const hazOf = (h) => HAZ[String(h || "").toUpperCase()] || ["other", String(h || "hazard").toLowerCase()];
  /* G-AIRMET altitudes are hundreds of feet, "SFC" or "FZL" (the freezing level, whose own range comes in fzlbase/fzltop) */
  const hund = (v) => (v == null || v === "" ? null : String(v).toUpperCase() === "SFC" ? 0 : /^\d+$/.test(String(v)) ? +v * 100 : null);
  function parseAirSigmet(list) {
    if (!Array.isArray(list)) throw Error("unrecognized SIGMET answer");
    return list.map((s) => {
      const r = ring(s.coords), outlook = /OUTLOOK/i.test(s.airSigmetType || ""), [fam, word] = hazOf(s.hazard);
      const type = String(s.airSigmetType || "SIGMET").toUpperCase(), conv = String(s.hazard).toUpperCase() === "CONVECTIVE";
      const name = (conv ? "Convective SIGMET" : type === "AIRMET" ? "AIRMET" : "SIGMET") + (outlook ? " outlook" : "") + (s.seriesId ? " " + s.seriesId : "");
      return { id: "sigmet-" + (s.icaoId || "") + "-" + (s.seriesId || "") + "-" + s.validTimeFrom + "-" + s.hazard, kind: "sigmet", family: "aviation", sourceId: "enroute", layerKind: outlook ? "outlook" : "advisory",
        hazard: String(s.hazard || "").toUpperCase(), hazardFamily: fam, hazardWord: word, severity: s.severity || null, name, outlook,
        issued: iso(s.creationTime || s.receiptTime), validStart: iso(s.validTimeFrom), validEnd: iso(s.validTimeTo), baseFt: num(s.altitudeLow1) != null ? num(s.altitudeLow1) : 0, topFt: num(s.altitudeHi1),
        surface: SURFACE.has(String(s.hazard).toUpperCase()), geometry: r.length >= 4 ? { type: "Polygon", coordinates: [r] } : null, raw: s.rawAirSigmet || "", movement: s.movementDir != null ? { dir: s.movementDir, kt: s.movementSpd } : null,
        office: "NOAA Aviation Weather Center", event: name, title: name + ": " + word, source: { name: "Aviation Weather Center SIGMETs", url: "https://aviationweather.gov/gfa/#sigmet" } };
    }).filter((p) => p.geometry && p.validStart && p.validEnd);
  }
  function parseGAirmet(lists) {
    const out = [];
    for (const list of lists) {
      if (!Array.isArray(list)) throw Error("unrecognized G-AIRMET answer");
      for (const g of list) {
        const hz = String(g.hazard || "").toUpperCase(); if (/FZLVL/.test(hz)) continue; // freezing-level contours are lines of altitude, not hazard areas
        const r = ring(g.coords); if (r.length < 4) continue;
        const [fam, word] = hazOf(hz), at = Date.parse(g.validTime), issued = iso(g.issueTime), expires = iso(g.expireTime);
        const base = String(g.base || "").toUpperCase() === "FZL" ? hund(g.fzlbase) : hund(g.base), top = hund(g.top);
        out.push({ id: "gairmet-" + g.product + "-" + g.tag + "-" + hz + "-" + g.forecastHour + "-" + g.issueTime, group: "gairmet-" + g.product + "-" + g.tag + "-" + hz + "-" + g.issueTime, kind: "gairmet", family: "aviation", sourceId: "enroute", layerKind: "advisory",
          hazard: hz, hazardFamily: fam, hazardWord: word, severity: g.severity || null, product: String(g.product || "").toUpperCase(), tag: g.tag, forecastHour: +g.forecastHour || 0, dueTo: g.due_to || null,
          issued, validTime: new Date(at).toISOString(), validStart: new Date(Math.max(at - GAIRMET_HALF_MS, Date.parse(issued) || -Infinity)).toISOString(), validEnd: new Date(at + GAIRMET_HALF_MS).toISOString(), expires, // expireTime is when the next issuance replaces this one; each snapshot keeps its own time
          baseFt: SURFACE.has(hz) ? 0 : base, topFt: SURFACE.has(hz) ? null : top, freezingLevel: String(g.base || "").toUpperCase() === "FZL", surface: SURFACE.has(hz),
          geometry: { type: "Polygon", coordinates: [r] }, office: "NOAA Aviation Weather Center", event: "G-AIRMET", name: "G-AIRMET " + String(g.product || "").charAt(0) + String(g.product || "").slice(1).toLowerCase() + " " + g.tag,
          title: "G-AIRMET: " + (g.severity === "MOD" ? "moderate " : "") + word, source: { name: "Aviation Weather Center G-AIRMETs", url: "https://aviationweather.gov/gfa/#gairmet" } });
      }
    }
    return out;
  }
  /* CWA altitudes: base/top when given (feet), otherwise from the text ("FL290 TO FL390", "TOPS TO FL410", "BLW FL180") */
  function cwaAlt(c) {
    let lo = num(c.base), hi = num(c.top); const t = String(c.rawText || "").toUpperCase();
    if (lo == null && hi == null) {
      let m;
      if ((m = /FL(\d{3})\s*(?:TO|-)\s*FL(\d{3})/.exec(t))) { lo = +m[1] * 100; hi = +m[2] * 100; }
      else if ((m = /(?:BLW|BLO|BELOW)\s*FL(\d{3})/.exec(t))) { lo = 0; hi = +m[1] * 100; }
      else if ((m = /TOPS?\s*(?:EST\s*)?(?:TO\s*)?FL(\d{3})/.exec(t))) { lo = 0; hi = +m[1] * 100; }
    }
    return { lo, hi };
  }
  function parseCWA(list) {
    if (list == null || list === "") return []; // AWC answers 204 (no content) when none are in effect
    if (!Array.isArray(list)) throw Error("unrecognized CWA answer");
    return list.map((c) => {
      const r = ring(c.coords), hz = String(c.hazard || "").toUpperCase(), [fam, word] = hazOf(hz), a = cwaAlt(c);
      return { id: "cwa-" + c.cwsu + "-" + c.seriesId + "-" + c.validTimeFrom, kind: "cwa", family: "aviation", sourceId: "enroute", layerKind: "advisory", hazard: hz, hazardFamily: fam, hazardWord: word, qualifier: c.qualifier || null,
        issued: iso(c.receiptTime), validStart: iso(c.validTimeFrom), validEnd: iso(c.validTimeTo), baseFt: a.lo, topFt: a.hi, surface: SURFACE.has(hz),
        geometry: r.length >= 4 ? { type: "Polygon", coordinates: [r] } : null, raw: c.rawText || "", name: "Center Weather Advisory " + c.cwsu + " " + c.seriesId, office: "NWS Center Weather Service Unit, " + (c.name || c.cwsu),
        event: "Center Weather Advisory", title: "Center Weather Advisory: " + word, source: { name: "Aviation Weather Center CWAs", url: "https://aviationweather.gov/gfa/#cwa" } };
    }).filter((p) => p.geometry && p.validStart && p.validEnd);
  }

  /* ---------- FAA airport status ---------- */
  /* ICAO to the FAA's three-letter airport ID: KEWR -> EWR, PHNL -> HNL, PANC -> ANC; others are compared as given */
  const faaId = (icao) => { const s = String(icao || "").toUpperCase(); return /^K[A-Z0-9]{3}$/.test(s) || /^P[AHG][A-Z0-9]{2}$/.test(s) ? s.slice(1) : s; };
  const WX_RE = /(ceil|\bcigs?\b|visib|\bvis\b|fog|\bwind|thunder|\bts\b|storm|snow|\bice\b|icing|rain|weather|\bwx\b|lightning|low clouds|hail|freez|deic|hurricane|tropical)/i;
  const PLAIN = [[/^TM Initiatives:?\s*/i, "\u0001"], [/\bMIT\b/g, "miles-in-trail spacing"], [/\bESP\b/g, "en route spacing"], [/\bDSP\b/g, "departure spacing"], [/\bWX\b/g, "weather"], [/\bVOL\b/g, "traffic volume"], [/\bEQ\b/g, "equipment"], [/\bRWY\b/g, "runway"], [/:/g, ", "]];
  /* FAA cause codes in words; facility IDs (ZJX, N90) keep their capitals, other capitalized words are lowered */
  const plainCause = (c) => {
    let s = String(c || "").trim(); if (!s) return "cause not stated"; if (/^[a-z ]+$/.test(s)) return s;
    s = s.replace(/^OTHER:\s*/i, "");
    for (const [re, w] of PLAIN) s = s.replace(re, w);
    return s.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s+/g, " ").replace(/^\u0001,?\s*/, "traffic management: ").trim()
      .split(" ").map((w) => (/^[A-Z][A-Z0-9]{2},?$/.test(w) && /[0-9]|^Z/.test(w) ? w : w.toLowerCase())).join(" ");
  };
  const minutes = (v) => { if (v == null || v === "") return null; if (Number.isFinite(+v)) return +v; const h = /(\d+)\s*hour/.exec(v), m = /(\d+)\s*minute/.exec(v); return h || m ? (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) : null; };
  const durText = (m) => (m == null ? null : m < 60 ? m + " min" : Math.floor(m / 60) + " hr" + (m % 60 ? " " + (m % 60) + " min" : ""));
  const TYPE_WORD = { groundStop: "Ground stop", groundDelay: "Ground delay program", arrivalDelay: "Arrival delays", departureDelay: "Departure delays", airportClosure: "Airport closure", freeForm: "Airport notice", deicing: "Deicing", planned: "Planned initiative" };
  function parseFAA(events, plan, fetchedAt) {
    if (!Array.isArray(events)) throw Error("unrecognized FAA airport status answer");
    const out = [], at = Date.parse(fetchedAt);
    for (const a of events) {
      const id = String(a.airportId || "").toUpperCase(); if (!id) continue;
      const pt = Number.isFinite(+a.longitude) && Number.isFinite(+a.latitude) ? [+a.longitude, +a.latitude] : null;
      for (const type of ["groundStop", "groundDelay", "arrivalDelay", "departureDelay", "airportClosure", "freeForm", "deicing"]) {
        const x = a[type]; if (!x || typeof x !== "object") continue;
        const ad = x.arrivalDeparture || {}, cause = x.impactingCondition || x.reason || (type === "freeForm" ? x.text : null) || (type === "deicing" ? "deicing" : null);
        const start = iso(x.startTime || null), end = iso(x.endTime || x.programExpirationTime || null), updated = iso(x.updatedAt || x.updateTime || x.sourceTimeStamp || x.createdAt || null);
        const avg = minutes(x.avgDelay != null ? x.avgDelay : x.averageDelay), max = minutes(x.maxDelay != null ? x.maxDelay : ad.max), min = minutes(ad.min);
        const notice = type === "freeForm", closure = type === "airportClosure" || (notice && /\bAD AP CLSD\b(?! TO )/.test(x.simpleText || ""));
        out.push({ id: "faa-" + type + "-" + id + "-" + (x.id || start || updated || ""), kind: "faa", family: "aviation", sourceId: "faa", type: closure && notice ? "airportClosure" : type, typeWord: TYPE_WORD[closure && notice ? "airportClosure" : type],
          airportFaa: id, airportName: a.airportLongName || id, point: pt, geometry: null, cause: cause || null, causeText: notice ? "FAA notice (NOTAM)" : plainCause(cause), weather: !notice && WX_RE.test(String(cause || "")),
          start, end, updated, issued: updated || fetchedAt, avgMin: avg, maxMin: max, minMin: min, trend: ad.trend || x.trend || null, scope: ad.type || null,
          notice: notice && !closure, text: notice ? x.simpleText || x.text || "" : null, advisoryUrl: x.advisoryUrl || null, planned: !!(start && Date.parse(start) > at),
          office: "FAA Air Traffic Control System Command Center", event: TYPE_WORD[type], title: TYPE_WORD[type] + " at " + id, source: { name: "FAA National Airspace System status", url: "https://nasstatus.faa.gov/" } });
      }
    }
    /* the day's operations plan lists planned initiatives ("terminalPlanned"); the shape is lenient, the advisory link is FAA's */
    for (const it of (plan && Array.isArray(plan.terminalPlanned) ? plan.terminalPlanned : [])) {
      const txt = typeof it === "string" ? it : Object.values(it || {}).filter((v) => typeof v === "string").join(" ");
      const ids = [...new Set((txt.toUpperCase().match(/\b[A-Z][A-Z0-9]{2}\b/g) || []))];
      for (const id of ids) out.push({ id: "faa-planned-" + id + "-" + txt.length + "-" + txt.slice(0, 20), kind: "faa", family: "aviation", sourceId: "faa", type: "planned", typeWord: TYPE_WORD.planned, airportFaa: id, airportName: id, point: null, geometry: null,
        cause: txt, causeText: plainCause(txt), weather: WX_RE.test(txt), start: null, end: null, updated: fetchedAt, issued: fetchedAt, planned: true, possible: true, text: txt, advisoryUrl: plan.link || null,
        office: "FAA Air Traffic Control System Command Center", event: "Operations plan", title: "Planned at " + id, source: { name: "FAA operations plan", url: plan.link || "https://nasstatus.faa.gov/" } });
    }
    return out;
  }
  /* one sentence a person can act on: "ground delay program for low ceilings, average delay 1 hr 45 min (up to 5 hr 55 min)" */
  function faaText(d) {
    if (d.notice) return "FAA notice: " + d.text;
    const what = d.typeWord.charAt(0).toLowerCase() + d.typeWord.slice(1) + (d.cause ? " for " + d.causeText : "");
    const delay = d.type === "groundDelay" ? (d.avgMin != null ? ", average delay " + durText(d.avgMin) : "") + (d.maxMin != null ? " (up to " + durText(d.maxMin) + ")" : "")
      : d.type === "arrivalDelay" || d.type === "departureDelay" ? (d.minMin != null && d.maxMin != null ? ", " + durText(d.minMin) + " to " + durText(d.maxMin) : d.avgMin != null ? ", about " + durText(d.avgMin) : "") + (d.trend ? " and " + String(d.trend).toLowerCase() : "") : "";
    return what + delay;
  }

  /* ---------- the approximate route ---------- */
  function routeSamples(a, b, stepKm) {
    const P = (p) => p, dKm = T.pointDistance(a, b).km, n = Math.max(2, Math.ceil(dKm / (stepKm || 15)) + 1), out = [];
    for (let i = 0; i < n; i++) { const f = i / (n - 1); out.push(P([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])); }
    return out;
  }
  const routeGeometry = (r) => (r && r.oPt && r.dPt ? { type: "LineString", coordinates: [r.oPt, r.dPt] } : null);
  /* the route's nearest approach to an area (0 inside); null when it stays farther than ROUTE_MI */
  function nearRoute(samples, geometry, pt) {
    let best = Infinity;
    for (const s of samples) {
      if (pt) { best = Math.min(best, T.pointDistance(s, pt).km); continue; }
      if (T.contains(geometry, s)) return 0;
      const e = T.nearestEdge(geometry, s); if (e) best = Math.min(best, e.km);
    }
    return best <= ROUTE_KM ? best : null;
  }
  const altOverlap = (lo1, hi1, lo2, hi2) => (lo1 == null ? 0 : lo1) <= (hi2 == null ? Infinity : hi2) && (lo2 == null ? 0 : lo2) <= (hi1 == null ? Infinity : hi1);
  /* advisories and pilot reports that may meet the route: { advisories: [{ p, km, startMs, endMs, altStated }], reports: [...] } */
  function routeOverlap(route, products, now) {
    if (!route || !route.oPt || !route.dPt) return { advisories: [], reports: [] };
    const S = routeSamples(route.oPt, route.dPt), lo = route.lowFt, hi = route.highFt, t0 = route.startMs, t1 = route.endMs;
    const advisories = [], reports = [], groups = new Map();
    for (const p of products) {
      if (p.kind === "sigmet" || p.kind === "gairmet" || p.kind === "cwa") {
        if (p.surface) continue; // surface-based (IFR, obscured mountains, surface wind, wind shear): the airports' TAFs and the map cover them
        const s = Date.parse(p.validStart), e = Date.parse(p.validEnd); if (!(s < t1 && e > t0) || !(e > now)) continue;
        const altStated = p.baseFt != null || p.topFt != null; if (altStated && !altOverlap(p.baseFt, p.topFt, lo, hi)) continue;
        const km = nearRoute(S, p.geometry); if (km == null) continue;
        const k = p.group || p.id, g = groups.get(k);
        if (g) { g.startMs = Math.min(g.startMs, s); g.endMs = Math.max(g.endMs, e); g.km = Math.min(g.km, km); g.snapshots.push(p); g.lowFt = Math.min(g.lowFt, p.baseFt == null ? 0 : p.baseFt); g.highFt = Math.max(g.highFt, p.topFt == null ? Infinity : p.topFt); }
        else { const x = { p, km, startMs: s, endMs: e, altStated, snapshots: [p], lowFt: p.baseFt == null ? 0 : p.baseFt, highFt: p.topFt == null ? Infinity : p.topFt }; groups.set(k, x); advisories.push(x); }
      } else if (p.kind === "pirep") {
        const age = now - Date.parse(p.observed); if (age < 0 || age > PIREP_ROUTE_MIN * 60e3 || p.rank < 2 || !(t1 > now)) continue;
        const known = p.lowFt != null || p.highFt != null; if (known && !altOverlap(p.lowFt, p.highFt, lo, hi)) continue;
        const km = nearRoute(S, null, p.point); if (km == null) continue;
        reports.push({ p, km, ageMin: Math.round(age / 60e3), altStated: known });
      }
    }
    const sev = (x) => (x.p.hazardFamily === "convective" ? 0 : x.p.kind === "sigmet" ? 1 : x.p.kind === "cwa" ? 2 : 3);
    advisories.sort((a, b) => sev(a) - sev(b) || a.startMs - b.startMs);
    reports.sort((a, b) => b.p.rank - a.p.rank || a.ageMin - b.ageMin);
    return { advisories, reports };
  }
  /* map filters: an altitude band (ft) and a time (ms) */
  const inBand = (p, lo, hi) => (lo == null && hi == null) || (p.kind === "pirep" ? (p.lowFt == null && p.highFt == null) || altOverlap(p.lowFt, p.highFt, lo, hi) : p.surface ? (lo == null || lo < 3000) : altOverlap(p.baseFt, p.topFt, lo, hi));
  const validAt = (p, ms) => p.kind === "pirep" || (Date.parse(p.validStart) <= ms && Date.parse(p.validEnd) > ms);

  return { ROUTE_MI, ROUTE_KM, PIREP_ROUTE_MIN, INTEN_WORD, parsePIREP, pirepText, parseAirSigmet, parseGAirmet, parseCWA, cwaAlt, faaId, parseFAA, faaText, plainCause, durText,
    routeSamples, routeGeometry, routeOverlap, nearRoute, altOverlap, inBand, validAt, ftText, bandText, hazOf };
});
