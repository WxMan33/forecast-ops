/* Weather threats: pure helpers shared by the page and the Node tests. No DOM, no network.

   Products are normalized records, whichever feed they come from:
     { id, kind: "warning" | "watch" | "md" | "outlook", event, title, headline, area,
       issued, updated, expires | validStart/validEnd (ISO), geometry (GeoJSON Polygon/MultiPolygon or null),
       category (outlooks: TSTM MRGL SLGT ENH MDT HIGH), day (outlooks), previous (an earlier version of the
       same product, when the feed gave us one), source: { name, url }, bulletin }

   Ordering is a fixed product hierarchy (warning > watch > MD > outlook, tornado before severe thunderstorm),
   not a score: products of different kinds are never combined into one number. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ThreatsCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KM_PER_MI = 1.609344;
  const NEAR_KM = 15 * KM_PER_MI; // "nearby" = within 15 miles of the venue, outside the product

  /* ---------- geometry (lon/lat degrees; distances on a local equirectangular plane, fine at venue scale) ---------- */
  const polygonsOf = (g) => !g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function contains(geometry, pt) {
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return false; // no location (e.g. zone shapes not loaded yet): not inside
    return polygonsOf(geometry).some((rings) => rings.length && inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
  }
  function project(origin) {
    const kx = 111.32 * Math.cos((origin[1] * Math.PI) / 180), ky = 110.574;
    return (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky];
  }
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    const q = [a[0] + t * dx, a[1] + t * dy];
    return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
  }
  /* distance (km) from a point to a product's boundary, and the compass direction from the point to that edge */
  function nearestEdge(geometry, pt) {
    const P = project(pt), o = [0, 0];
    let best = null;
    for (const rings of polygonsOf(geometry)) for (const ring of rings) {
      const r = ring.map(P);
      for (let i = 1; i < r.length; i++) { const s = segDist(o, r[i - 1], r[i]); if (!best || s.d < best.d) best = s; }
    }
    if (!best) return null;
    return { km: best.d, dir: compass(Math.atan2(best.q[0], best.q[1])) };
  }
  /* distance (km) and compass direction from the venue to a point (a reported fire location) */
  function pointDistance(venuePt, pt) { const q = project(venuePt)(pt); return { km: Math.hypot(q[0], q[1]), dir: compass(Math.atan2(q[0], q[1])) }; }
  function compass(rad) {
    const names = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
    return names[((Math.round(((rad * 180) / Math.PI) / 45) % 8) + 8) % 8];
  }
  /* bounding boxes are cached per geometry and per ring: the national grouping compares every pair of areas */
  const bbCache = new WeakMap();
  function ringBox(ring) { let b = bbCache.get(ring); if (b) return b; let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; } b = [w, s, e, n]; bbCache.set(ring, b); return b; }
  function bbox(geometry) {
    if (geometry && typeof geometry === "object" && bbCache.has(geometry)) return bbCache.get(geometry);
    const r = bboxRaw(geometry); if (geometry && typeof geometry === "object") bbCache.set(geometry, r); return r;
  }
  function bboxRaw(geometry) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const rings of polygonsOf(geometry)) for (const [x, y] of rings[0] || []) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    return isFinite(w) ? [w, s, e, n] : null;
  }
  const bboxOverlap = (a, b) => a && b && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  function segmentsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  }
  /* do two product areas share any ground? (vertex inside the other, or crossing edges) */
  function overlaps(g1, g2) {
    if (!bboxOverlap(bbox(g1), bbox(g2))) return false;
    const P1 = polygonsOf(g1), P2 = polygonsOf(g2);
    for (const r1 of P1) for (const r2 of P2) {
      const a = r1[0], b = r2[0];
      if (!a || !b || !bboxOverlap(ringBox(a), ringBox(b))) continue; // these two rings can't share ground
      /* any shared ground lies inside both rings' boxes: only points and edges inside that common box can count (the same answer
         as testing every one, much less work for large detailed outlines that only meet at an edge) */
      const ba = ringBox(a), bb = ringBox(b), x = [Math.max(ba[0], bb[0]), Math.max(ba[1], bb[1]), Math.min(ba[2], bb[2]), Math.min(ba[3], bb[3])];
      const inX = (p) => p[0] >= x[0] && p[0] <= x[2] && p[1] >= x[1] && p[1] <= x[3];
      if (a.some((p) => inX(p) && inRing(p, b)) || b.some((p) => inX(p) && inRing(p, a))) return true;
      const segs = (r) => { const out = []; for (let i = 1; i < r.length; i++) { const p = r[i - 1], q = r[i]; if (Math.max(p[0], q[0]) >= x[0] && Math.min(p[0], q[0]) <= x[2] && Math.max(p[1], q[1]) >= x[1] && Math.min(p[1], q[1]) <= x[3]) out.push([p, q]); } return out; };
      const sa = segs(a), sb = segs(b);
      for (const [p, q] of sa) { const w = Math.min(p[0], q[0]), e = Math.max(p[0], q[0]), s = Math.min(p[1], q[1]), n = Math.max(p[1], q[1]);
        for (const [r, t] of sb) if (Math.max(r[0], t[0]) >= w && Math.min(r[0], t[0]) <= e && Math.max(r[1], t[1]) >= s && Math.min(r[1], t[1]) <= n && segmentsCross(p, q, r, t)) return true; }
    }
    return false;
  }
  /* planar area in km² around the product's own centre (for "area reduced by 30%") */
  function areaKm2(geometry) {
    const b = bbox(geometry); if (!b) return 0;
    const P = project([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    let total = 0;
    for (const rings of polygonsOf(geometry)) rings.forEach((ring, k) => {
      const r = ring.map(P); let a = 0;
      for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
      total += (k ? -1 : 1) * Math.abs(a / 2);
    });
    return total;
  }

  /* ---------- venue relationship ---------- */
  /* covers: the venue is inside the drawn area. near: outside, within NEAR_KM of its edge. unknown: the feed gave no
     area (for example a zone-only alert); never shown as "does not affect". */
  function relation(product, venue, nearKm = NEAR_KM) {
    if (!venue) return { kind: "none" };
    const pt = [venue.lon, venue.lat];
    if (!product.geometry || !polygonsOf(product.geometry).length) return { kind: "unknown" };
    const inside = contains(product.geometry, pt);
    // county-only product with counties still unresolved: a venue outside the drawn part could still be covered
    if (!inside && product.geometryIncomplete) return { kind: "unknown", partial: true };
    if (inside) {
      const e = nearestEdge(product.geometry, pt);
      return { kind: "covers", edgeKm: e ? e.km : null };
    }
    const e = nearestEdge(product.geometry, pt);
    if (e && e.km <= nearKm) return { kind: "near", km: e.km, dir: e.dir };
    return { kind: "outside", km: e ? e.km : null, dir: e ? e.dir : null };
  }
  const miles = (km) => km / KM_PER_MI;
  function distanceText(km) { const mi = Math.round(miles(km)); return miles(km) < 1 ? "less than 1 mile" : mi + (mi === 1 ? " mile" : " miles"); }
  /* plain-language relationship. Warnings and watches are "in effect" at a venue; an MD is a discussion area,
     not something in effect; an outlook is a forecast risk area. */
  function relationText(rel, product) {
    const kind = product ? product.kind : null;
    const noun = kind === "warning" ? "warning" : kind === "watch" ? "watch" : kind === "md" ? "discussion" : kind === "outlook" ? "risk" : "product";
    switch (rel.kind) {
      case "covers":
        if (kind === "md") return "Discussion area includes the venue";
        if (kind === "outlook") return "The venue is in this risk area";
        return kind ? "In effect at the venue" : "Covers the venue";
      case "near":
        if (kind === "md") return "Discussion area " + distanceText(rel.km) + " " + rel.dir + " of the venue";
        return capital(distanceText(rel.km)) + " " + rel.dir + " of the venue · the venue is outside the " + noun + " area";
      case "outside": return rel.km == null ? "Does not include the venue" : "Does not include the venue (" + Math.round(miles(rel.km)) + " mi " + rel.dir + ")";
      case "unknown": return rel.partial ? "Unknown: some listed counties could not be drawn · check the county list" : "Area not drawn by the source · check the listed counties";
      default: return "No venue selected";
    }
  }
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  /* A product whose published expiration passed while its source could not be confirmed: never shown as active,
     and never described as cancelled or cleared either. */
  function expiredUnconfirmed(p, src, now) {
    if (!src || src.state !== "failed" || !p.expires) return false;
    const end = Date.parse(p.expires);
    return end <= now && (!src.lastOk || Date.parse(src.lastOk) < end);
  }

  /* ---------- ordering ---------- */
  const OUTLOOK = ["TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];
  const OUTLOOK_NAME = { TSTM: "General thunderstorms", MRGL: "Marginal", SLGT: "Slight", ENH: "Enhanced", MDT: "Moderate", HIGH: "High" };
  const OUTLOOK_LEVEL = { TSTM: null, MRGL: 1, SLGT: 2, ENH: 3, MDT: 4, HIGH: 5 };
  const outlookLabel = (c) => OUTLOOK_LEVEL[c] ? OUTLOOK_NAME[c] + " risk (" + OUTLOOK_LEVEL[c] + " of 5)" : OUTLOOK_NAME[c];
  const KIND_ORDER = { warning: 0, watch: 1, md: 2, outlook: 3 };
  function rank(p) {
    const tor = /tornado/i.test(p.event || "") ? 0 : 1;
    const outlook = p.kind === "outlook" ? 10 - OUTLOOK.indexOf(p.category) : 0;
    return [KIND_ORDER[p.kind] ?? 9, p.kind === "outlook" ? outlook : tor, -(Date.parse(p.updated || p.issued) || 0)];
  }
  function compare(a, b) { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }
  const sort = (list) => list.slice().sort(compare);

  /* ---------- grouping: active products whose areas touch become one "area" in the overview ---------- */
  /* pairCache (optional Map): whether two areas overlap doesn't depend on what else is shown, so a caller that regroups as layers
     change keeps the answers, keyed by each product's id and outline signature */
  const geoSig = (p) => { const c = p.geometry && p.geometry.coordinates; return p.id + "|" + (p.updated || p.issued || "") + "|" + (c ? p.geometry.type + c.length + ":" + (c[0] || []).length : "-"); };
  function group(products, places = [], pairCache = null) {
    const list = sort(products.filter((p) => p.kind !== "outlook")), sig = pairCache ? list.map(geoSig) : null;
    const parent = list.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const touch = (i, j) => { if (!pairCache) return overlaps(list[i].geometry, list[j].geometry); const k = sig[i] < sig[j] ? sig[i] + "~" + sig[j] : sig[j] + "~" + sig[i]; let v = pairCache.get(k); if (v === undefined) { v = overlaps(list[i].geometry, list[j].geometry); pairCache.set(k, v); } return v; };
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (find(i) !== find(j) && list[i].geometry && list[j].geometry && touch(i, j)) parent[find(j)] = find(i);
    }
    const groups = new Map();
    list.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
    return [...groups.values()].map((items) => {
      const lead = items[0], b = bbox(lead.geometry);
      const c = b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
      return { id: "g-" + lead.id, items, lead, centre: c, name: c ? placeName(c, places) : "Area not drawn" };
    }).sort((a, b) => compare(a.lead, b.lead));
  }
  function placeName(c, places) {
    let best = null;
    for (const p of places) { const d = Math.hypot((p.lon - c[0]) * Math.cos((c[1] * Math.PI) / 180), p.lat - c[1]); if (!best || d < best.d) best = { d, p }; }
    return best ? "Near " + best.p.name : "Area " + c[1].toFixed(1) + "°, " + c[0].toFixed(1) + "°";
  }
  /* highest outlook category at a point (outlook products for one day) */
  function outlookAt(outlooks, pt) {
    let best = null;
    for (const o of outlooks) if (contains(o.geometry, pt) && (!best || OUTLOOK.indexOf(o.category) > OUTLOOK.indexOf(best.category))) best = o;
    return best;
  }
  const highestOutlook = (outlooks) => outlooks.reduce((b, o) => (!b || OUTLOOK.indexOf(o.category) > OUTLOOK.indexOf(b.category) ? o : b), null);

  /* ---------- what changed: only between two versions of the same product ---------- */
  function changes(product, fmt) {
    const prev = product.previous;
    if (!prev || prev.id !== product.id) return null;
    const out = [];
    const endOf = (p) => p.expires || p.validEnd;
    if (prev.event !== product.event) out.push("Upgraded from " + prev.event + " to " + product.event);
    if (endOf(prev) !== endOf(product)) out.push("Expiration " + (Date.parse(endOf(product)) > Date.parse(endOf(prev)) ? "extended" : "moved earlier") + " to " + fmt(endOf(product)) + " (was " + fmt(endOf(prev)) + ")");
    else out.push("Expiration unchanged (" + fmt(endOf(product)) + ")");
    if (prev.geometry && product.geometry) {
      const a = areaKm2(prev.geometry), b = areaKm2(product.geometry), pc = a ? Math.round(((b - a) / a) * 100) : 0;
      if (Math.abs(pc) >= 5) out.push("Area " + (pc < 0 ? "reduced" : "enlarged") + " by about " + Math.abs(pc) + "%" + (product.changeNote ? " · " + product.changeNote : ""));
      else out.push("Area unchanged");
    }
    if (prev.hazard && product.hazard && prev.hazard !== product.hazard) out.push("Hazard: " + product.hazard + " (was " + prev.hazard + ")");
    return { since: prev.updated || prev.issued, lines: out };
  }

  /* ---------- source status: a successful empty answer is not the same as missing, stale or failed data ---------- */
  function sourceState(src, now, staleMin = 10) {
    if (!src || src.state === "failed" && !src.lastOk) return { kind: "unavailable", text: "Unavailable" };
    const ageMin = src.lastOk ? (now - Date.parse(src.lastOk)) / 60e3 : Infinity;
    if (src.state === "failed") return { kind: "stale", text: "Refresh failed · last confirmed " + Math.round(ageMin) + " min ago", ageMin };
    if (ageMin > staleMin) return { kind: "stale", text: "Last confirmed " + Math.round(ageMin) + " min ago", ageMin };
    return { kind: src.count ? "current" : "empty", text: src.count ? "Current" : "Current · none active", ageMin };
  }

  /* ---------- time ---------- */
  function fmtTime(iso, tz, opts = {}) {
    const d = new Date(iso);
    const t = d.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    if (!opts.day) return t;
    return d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }) + ", " + t;
  }
  const fmtZ = (iso) => { const d = new Date(iso); return String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z"; };
  function untilText(iso, now) {
    const m = Math.round((Date.parse(iso) - now) / 60e3);
    if (m <= 0) return "expired";
    return m < 60 ? m + " min left" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min left";
  }

  return { NEAR_KM, KM_PER_MI, OUTLOOK, OUTLOOK_NAME, OUTLOOK_LEVEL, outlookLabel, contains, nearestEdge, pointDistance, bbox, overlaps, areaKm2,
    relation, relationText, distanceText, expiredUnconfirmed, miles, rank, compare, sort, group, placeName, outlookAt, highestOutlook, changes, sourceState,
    fmtTime, fmtZ, untilText, polygonsOf, bboxOverlap };
});
