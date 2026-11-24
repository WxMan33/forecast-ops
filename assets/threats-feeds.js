/* Weather threats: live feed adapters. Pure parsing and state; the page supplies fetch().
   Runs in the browser (window.ThreatsFeeds) and in Node for the lifecycle tests.

   NWS alerts (api.weather.gov/alerts/active)
     One product = one VTEC event: office.phenomenon.significance.ETN (+ year), e.g. KILN.TO.W.0071.2026.
     Each CAP message carries parameters.VTEC; `references[]` lists the messages it replaces.
     Action codes: NEW, CON, EXT, EXA, EXB (active); CAN cancelled; EXP expired; UPG upgraded (replaced by another product).
     Newest `sent` wins; an older or already-seen message is ignored (duplicates, out-of-order).
     A successful fetch is the complete active set: a product it no longer lists is ended ("no longer listed").
     A failed fetch changes nothing: products stay as last known until their published end, then become "lapsed"
     (ended by the clock, status unknown), never "cancelled".
   SPC outlooks (dayNotlk_cat.nolyr.geojson): LABEL, VALID_ISO, EXPIRE_ISO, ISSUE_ISO.
   SPC MDs: list page (current MDs are image-map areas) + each md####.html text with "Valid DDHHMMZ - DDHHMMZ" and LAT...LON. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./threats-core.js"));
  else root.ThreatsFeeds = factory(root.ThreatsCore);
})(typeof globalThis !== "undefined" ? globalThis : this, function (T) {
  "use strict";

  const WINTER_EVENTS = ["Winter Storm Warning", "Winter Storm Watch", "Blizzard Warning", "Ice Storm Warning", "Lake Effect Snow Warning", "Winter Weather Advisory"];
  const FIRE_EVENTS = ["Red Flag Warning", "Fire Weather Watch"];
  /* tropical (issued in NWS Tropical Cyclone Watch/Warning products, coordinated with NHC) and coastal hazards */
  const TROPICAL_EVENTS = ["Hurricane Warning", "Hurricane Watch", "Tropical Storm Warning", "Tropical Storm Watch", "Storm Surge Warning", "Storm Surge Watch"];
  /* added 2026-11-24 for the 7-day dashboard and the map's Heat & cold and Wind & visibility layers; Flooding gains river/areal products */
  const HEAT_EVENTS = ["Extreme Heat Warning", "Extreme Heat Watch", "Heat Advisory", "Excessive Heat Warning", "Excessive Heat Watch", "Extreme Cold Warning", "Extreme Cold Watch", "Cold Weather Advisory", "Wind Chill Warning", "Wind Chill Watch", "Wind Chill Advisory", "Freeze Warning", "Freeze Watch", "Frost Advisory"];
  const WIND_EVENTS = ["High Wind Warning", "High Wind Watch", "Wind Advisory", "Extreme Wind Warning", "Dust Storm Warning", "Blowing Dust Advisory", "Lake Wind Advisory", "Dense Fog Advisory", "Dense Smoke Advisory"];
  const FLOOD_EVENTS = ["Flood Warning", "Flood Watch", "Flood Advisory"];
  const COASTAL_EVENTS = ["Coastal Flood Warning", "Coastal Flood Watch", "Coastal Flood Advisory", "High Surf Warning", "High Surf Advisory", "Rip Current Statement", "Beach Hazards Statement"];
  const EVENTS = ["Tornado Warning", "Severe Thunderstorm Warning", "Tornado Watch", "Severe Thunderstorm Watch", "Flash Flood Warning", ...FLOOD_EVENTS, ...WINTER_EVENTS, ...FIRE_EVENTS, ...TROPICAL_EVENTS, ...COASTAL_EVENTS, ...HEAT_EVENTS, ...WIND_EVENTS];
  /* hazard family per NWS VTEC phenomenon: the map's layers and Event Planner's sections group by this */
  const HAZARD = { XH: "heat", HT: "heat", EH: "heat", EC: "heat", CW: "heat", WC: "heat", FZ: "heat", FR: "heat", HW: "wind", WI: "wind", EW: "wind", DS: "wind", DU: "wind", LW: "wind", FG: "wind", SM: "wind", FL: "flood", FA: "flood", HU: "tropical", TR: "tropical", SS: "tropical", CF: "coastal", SU: "coastal", RP: "coastal", BH: "coastal", FW: "fire", TO: "severe", SV: "severe", FF: "flood", WS: "winter", BZ: "winter", IS: "winter", LE: "winter", WW: "winter" };
  const EVENT_PHEN = { "Hurricane Warning": "HU", "Hurricane Watch": "HU", "Tropical Storm Warning": "TR", "Tropical Storm Watch": "TR", "Storm Surge Warning": "SS", "Storm Surge Watch": "SS",
    "Coastal Flood Warning": "CF", "Coastal Flood Watch": "CF", "Coastal Flood Advisory": "CF", "High Surf Warning": "SU", "High Surf Advisory": "SU", "Rip Current Statement": "RP", "Beach Hazards Statement": "BH",
    "Red Flag Warning": "FW", "Fire Weather Watch": "FW", "Tornado Warning": "TO", "Tornado Watch": "TO", "Severe Thunderstorm Warning": "SV", "Severe Thunderstorm Watch": "SV", "Flash Flood Warning": "FF",
    "Winter Storm Warning": "WS", "Winter Storm Watch": "WS", "Blizzard Warning": "BZ", "Ice Storm Warning": "IS", "Lake Effect Snow Warning": "LE", "Winter Weather Advisory": "WW",
    "Extreme Heat Warning": "XH", "Extreme Heat Watch": "XH", "Heat Advisory": "HT", "Excessive Heat Warning": "EH", "Excessive Heat Watch": "EH", "Extreme Cold Warning": "EC", "Extreme Cold Watch": "EC", "Cold Weather Advisory": "CW",
    "Wind Chill Warning": "WC", "Wind Chill Watch": "WC", "Wind Chill Advisory": "WC", "Freeze Warning": "FZ", "Freeze Watch": "FZ", "Frost Advisory": "FR",
    "High Wind Warning": "HW", "High Wind Watch": "HW", "Wind Advisory": "WI", "Extreme Wind Warning": "EW", "Dust Storm Warning": "DS", "Blowing Dust Advisory": "DU", "Lake Wind Advisory": "LW", "Dense Fog Advisory": "FG", "Dense Smoke Advisory": "SM",
    // one event name, two VTEC phenomena: river (FL) or areal (FA) flooding; a Flood Watch can also carry FF
    "Flood Warning": ["FL", "FA"], "Flood Watch": ["FA", "FF"], "Flood Advisory": ["FA", "FL"] };
  const ALERTS_URL = "https://api.weather.gov/alerts/active?event=" + EVENTS.map(encodeURIComponent).join(",");
  const OUTLOOK_URL = (day) => "https://www.spc.noaa.gov/products/outlook/day" + day + "otlk_cat.nolyr.geojson";
  const MD_LIST_URL = "https://www.spc.noaa.gov/products/md/";
  const MD_URL = (n) => "https://www.spc.noaa.gov/products/md/md" + String(n).padStart(4, "0") + ".html";
  const MD_SERVICE_URL = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query?where=1%3D1&outFields=*&f=geojson";
  const ACTIVE_ACTIONS = new Set(["NEW", "CON", "EXT", "EXA", "EXB", "COR"]);
  const iso = (s) => (s ? new Date(s).toISOString() : null);
  const first = (v) => (Array.isArray(v) ? v[0] : v);

  /* ---------- VTEC ---------- */
  // /O.NEW.KILN.TO.W.0071.261120T2031Z-261120T2115Z/
  function parseVTEC(s) {
    const m = /\/([OTEX])\.([A-Z]{3})\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\.(\d{6}T\d{4}Z)-(\d{6}T\d{4}Z)\//.exec(s || "");
    if (!m) return null;
    const t = (x) => (x === "000000T0000Z" ? null : "20" + x.slice(0, 2) + "-" + x.slice(2, 4) + "-" + x.slice(4, 6) + "T" + x.slice(7, 9) + ":" + x.slice(9, 11) + ":00Z");
    return { product: m[1], action: m[2], office: m[3], phen: m[4], sig: m[5], etn: m[6], begin: t(m[7]), end: t(m[8]) };
  }
  const KIND = { W: "warning", A: "watch", Y: "advisory", S: "statement" };
  const EVENT_NAME = { "HU.W": "Hurricane Warning", "HU.A": "Hurricane Watch", "TR.W": "Tropical Storm Warning", "TR.A": "Tropical Storm Watch", "SS.W": "Storm Surge Warning", "SS.A": "Storm Surge Watch",
    "CF.W": "Coastal Flood Warning", "CF.A": "Coastal Flood Watch", "CF.Y": "Coastal Flood Advisory", "SU.W": "High Surf Warning", "SU.Y": "High Surf Advisory", "RP.S": "Rip Current Statement", "BH.S": "Beach Hazards Statement"};
  function vtecFor(props) {
    const all = (props.parameters && props.parameters.VTEC || []).map(parseVTEC).filter(Boolean);
    const want = [].concat(EVENT_PHEN[props.event] || []);
    return all.find((v) => want.includes(v.phen) && KIND[v.sig]) || null;
  }
  const keyOf = (v, sent) => v.office + "." + v.phen + "." + v.sig + "." + v.etn + "." + (v.begin || sent || "").slice(0, 4);

  /* ---------- geometry helpers ---------- */
  function labelPoint(g) {
    let best = null, bestA = -1;
    for (const rings of T.polygonsOf(g)) {
      const r = rings[0]; if (!r || r.length < 4) continue;
      let a = 0, cx = 0, cy = 0;
      for (let i = 1; i < r.length; i++) { const f = r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; a += f; cx += (r[i - 1][0] + r[i][0]) * f; cy += (r[i - 1][1] + r[i][1]) * f; }
      if (Math.abs(a) > bestA && a) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; if (!T.contains({ type: "Polygon", coordinates: rings }, best)) best = r[0]; }
    }
    return best;
  }
  function mergeGeometries(list) {
    const polys = [];
    for (const g of list) polys.push(...T.polygonsOf(g));
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }

  /* Union of zone shapes that share boundaries exactly (NWS county and marine zones do): every edge used by two
     neighbouring shapes is interior and is dropped; the remaining edges are chained back into rings. Rings that run
     the same way as the input outer rings are outer boundaries; the others are holes, each placed in the smallest outer
     ring that contains it. Separate areas stay separate. Returns null if the edges do not close (then draw the zones
     as they are). */
  function dissolve(geoms) {
    const P = (x) => x[0].toFixed(6) + "," + x[1].toFixed(6), count = new Map(), directed = [];
    let outerSign = 0;
    for (const g of geoms) for (const rings of T.polygonsOf(g)) rings.forEach((ring, k) => {
      const a = ringArea(ring); if (!k) outerSign += Math.sign(a);
      for (let i = 1; i < ring.length; i++) {
        const s = P(ring[i - 1]), e = P(ring[i]); if (s === e) continue;
        const key = s < e ? s + "|" + e : e + "|" + s; count.set(key, (count.get(key) || 0) + 1);
        directed.push({ s, e, key, p: ring[i - 1] });
      }
    });
    const keep = directed.filter((d) => count.get(d.key) === 1), from = new Map();
    for (const d of keep) { if (!from.has(d.s)) from.set(d.s, []); from.get(d.s).push(d); }
    const used = new Set(), rings = [];
    for (const d0 of keep) {
      if (used.has(d0)) continue;
      const ring = []; let d = d0, guard = 0;
      while (d && !used.has(d) && guard++ < 1e6) { used.add(d); ring.push(d.p); const next = (from.get(d.e) || []).find((x) => !used.has(x)); if (d.e === d0.s) { d = null; break; } d = next; }
      if (d !== null || ring.length < 3) return null;   // an open chain: give up rather than draw a wrong outline
      ring.push(ring[0]); rings.push(ring);
    }
    const sign = Math.sign(outerSign) || 1, outers = [], holes = [];
    for (const r of rings) { const a = ringArea(r); if (Math.abs(a) < 1e-10) continue; (Math.sign(a) === sign ? outers : holes).push(r); }  // drop zero-area scraps
    const polys = outers.map((r) => [r]);
    for (const h of holes) {
      const host = polys.filter((pp) => T.contains({ type: "Polygon", coordinates: [pp[0]] }, h[0])).sort((x, y) => Math.abs(ringArea(x[0])) - Math.abs(ringArea(y[0])))[0];
      if (host) host.push(h); else return null;
    }
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  function ringArea(r) { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return a / 2; }

  /* ---------- NWS alert -> product ---------- */
  function hazardText(p) {
    const P = p.parameters || {}, out = [];
    if (P.flashFloodDetection) out.push("Flash flooding " + first(P.flashFloodDetection).toLowerCase());
    if (P.flashFloodDamageThreat) out.push("damage threat " + first(P.flashFloodDamageThreat).toLowerCase());
    if (P.tornadoDetection) out.push("Tornado " + first(P.tornadoDetection).toLowerCase());
    if (P.tornadoDamageThreat) out.push("tornado damage threat " + first(P.tornadoDamageThreat).toLowerCase());
    if (P.maxWindGust) out.push("wind " + first(P.maxWindGust).replace(/MPH/i, "mph"));
    if (P.maxHailSize) out.push("hail " + first(P.maxHailSize) + " in");
    if (P.thunderstormDamageThreat) out.push("damage threat " + first(P.thunderstormDamageThreat).toLowerCase());
    return out.join(" · ");
  }
  function plainHeadline(p) {
    const d = (p.description || "").replace(/\s+/g, " ");
    const m = /\* ?(At \d{1,4} ?[AP]M [A-Z]{3,4},[^.]+\.)/.exec(d) || /(At \d{1,4} ?[AP]M [A-Z]{3,4},[^.]+\.)/.exec(d);
    if (m) return m[1].trim();
    const h = first((p.parameters || {}).NWSheadline);
    return h ? h.charAt(0) + h.slice(1).toLowerCase() : p.headline || "";
  }
  function normalizeAlert(f) {
    const p = f.properties || {}, v = vtecFor(p);
    if (!v || !KIND[v.sig]) return null;
    const kind = KIND[v.sig], ends = p.ends || first((p.parameters || {}).eventEndingTime) || p.expires;
    const title = kind === "watch" && (v.phen === "TO" || v.phen === "SV") ? p.event + " " + Number(v.etn) : p.event; // SPC-numbered convective watches only
    return {
      id: keyOf(v, p.sent), messageId: p.id, kind, family: HAZARD[v.phen] || "severe", sourceId: "nws-alerts", event: p.event, title, action: v.action, vtec: v,
      headline: plainHeadline(p), hazard: hazardText(p), area: p.areaDesc || "", office: p.senderName || "NWS",
      issued: iso(p.onset || p.effective || p.sent), sent: iso(p.sent), updated: iso(p.sent), expires: iso(ends), messageExpires: iso(p.expires),
      geometry: f.geometry || null, geometrySource: f.geometry ? "polygon" : "counties", zones: p.affectedZones || [], ugc: (p.geocode || {}).UGC || [],
      references: (p.references || []).map((r) => ({ id: r.identifier, url: r["@id"], sent: iso(r.sent) })),
      source: { name: "NWS alerts (api.weather.gov)", url: p["@id"] || "https://api.weather.gov/alerts/" + encodeURIComponent(p.id || "") },
      bulletin: [p.headline, p.description, p.instruction ? "PRECAUTIONARY/PREPAREDNESS ACTIONS...\n" + p.instruction : ""].filter(Boolean).join("\n\n"),
      label: f.geometry ? labelPoint(f.geometry) : null, messageType: p.messageType,
      // tropical watches and warnings run "until further notice" (VTEC end 000000T0000Z); the message expiry is only when the
      // next update is due, so it is not presented as the end of the hazard
      openEnded: !v.end && !p.ends && !first((p.parameters || {}).eventEndingTime), windWindow: windWindow(p.description),
    };
  }
  function windWindow(d) { const m = /Window for Tropical Storm force winds:\s*([\s\S]*?)(?:\n\s*\n|\n\s*-\s|$)/.exec(d || ""); return m ? m[1].replace(/\s+/g, " ").trim() : null; }

  /* NWS's own placement of a point (api.weather.gov/points/{lat},{lon}): its land forecast zone, county and fire weather
     zone. Over the water NWS gives only a marine zone (e.g. AMZ454) and no county: then `land` is empty. */
  const MARINE_ZONE = /^(AM|AN|GM|PZ|PK|PH|PM|PS|LM|LE|LH|LO|LS|SL)Z\d{3}$/;
  function pointZones(j) {
    const P = j && j.properties; if (!P) throw Error("unrecognized NWS points answer");
    const all = [P.forecastZone, P.county, P.fireWeatherZone].filter(Boolean), code = (u) => u.split("/").pop();
    return { land: all.filter((u) => !MARINE_ZONE.test(code(u))), marine: all.map(code).find((c) => MARINE_ZONE.test(c)) || null, city: (P.relativeLocation && P.relativeLocation.properties || {}).city || null };
  }

  /* ---------- NWS Tropical Cyclone Watch/Warning product (TCV), as archived text -> NWS alert shape ----------
     The NWS API keeps about 7 days; archived tropical watches and warnings come from the official TCV texts (as kept by
     the Iowa Environmental Mesonet's NWS text archive). Each segment: UGC line (zones + purge time), VTEC lines, area
     name, headline, details. One alert feature per segment and VTEC line, as CAP would carry them. */
  function tcvToAlerts(text, productId) {
    const sentM = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)-/.exec(productId || ""), office = /National Weather Service ([^\n]+?)\s{2,}[A-Z]{2}\d{6}/.exec(text) || /National Weather Service ([^\n]+)/.exec(text);
    if (!sentM || !/TCV[A-Z]{3}/.test(text)) throw Error("unrecognized TCV product");
    const sent = new Date(Date.UTC(+sentM[1], +sentM[2] - 1, +sentM[3], +sentM[4], +sentM[5])).toISOString(), storm = (/^\s*(.+?) Local Watch\/Warning Statement/m.exec(text) || [])[1] || null;
    const out = [];
    for (const seg of text.split(/\n\$\$/)) {
      const u = /^\s*((?:[A-Z]{2}[CZ]\d{3}|\d{3})(?:[->](?:[A-Z]{2}[CZ])?\d{3})*-(\d{2})(\d{2})(\d{2})-)\s*$/m.exec(seg);
      if (!u) continue;
      const ugc = parseUGC(u[1]).filter((z) => z[2] === "Z" && !/^(AM|AN|GM|PZ|PK|PH|PM|PS|LM|LE|LH|LO|LS|SL)Z/.test(z)); // land zones only
      if (!ugc.length) continue;
      let pd = new Date(Date.UTC(+sentM[1], +sentM[2] - 1, +u[2], +u[3], +u[4])); if (pd < new Date(sent) - 864e5 * 2) pd = new Date(Date.UTC(+sentM[1], +sentM[2], +u[2], +u[3], +u[4]));
      const vtecs = seg.match(/\/[OTEX]\.[A-Z]{3}\.[A-Z]{4}\.[A-Z]{2}\.[A-Z]\.\d{4}\.\d{6}T\d{4}Z-\d{6}T\d{4}Z\//g) || [];
      const area = ((/\d{4}Z\/\s*\n([^\n]+?)-?\s*\n/.exec(seg.slice(seg.lastIndexOf("Z/") - 30)) || [])[1] || "").replace(/-$/, "");
      const heads = (seg.match(/^\.\.\.[^\n]+\.\.\.$/gm) || []).join(" ");
      for (const line of vtecs) {
        const v = parseVTEC(line), name = EVENT_NAME[v.phen + "." + v.sig]; if (!name || !TROPICAL_EVENTS.includes(name)) continue;
        const ended = ["CAN", "EXP", "UPG"].includes(v.action);
        out.push({ type: "Feature", geometry: null, properties: { id: "urn:tcv:" + productId + ":" + ugc[0] + ":" + v.phen + v.sig, "@id": "https://mesonet.agron.iastate.edu/p.php?pid=" + productId,
          event: name, messageType: ended ? "Cancel" : v.action === "NEW" ? "Alert" : "Update", status: "Actual", sent, effective: sent, onset: v.begin || sent, ends: v.end, expires: ended ? sent : pd.toISOString(),
          senderName: "NWS " + (office ? office[1].trim() : ""), headline: (storm ? storm + " " : "") + heads.replace(/\.\.\./g, " ").replace(/\s+/g, " ").trim(), areaDesc: area,
          description: seg.trim().slice(0, 4000), affectedZones: ugc.map(zoneUrl), geocode: { UGC: ugc }, references: [], parameters: { VTEC: [line] } } });
      }
    }
    return out;
  }

  /* ---------- NWS alert store ---------- */
  function createAlertStore() {
    const byKey = new Map(), seen = new Set();
    const st = { lastOk: null, lastTry: null, lastError: null, state: "never", ignored: [] };
    /* zone-based alerts (no polygon): one record per zone, so segments of one event with different zones, end times or
       actions (e.g. UPG for two zones, CON for the rest) are each kept; products() groups them back for display */
    const explode = (msg) => (!msg.geometry && msg.zones && msg.zones.length ? msg.zones.map((z) => ({ ...msg, id: msg.id + "|" + z.split("/").pop(), baseId: msg.id, zones: [z], messageId: msg.messageId + "|" + z.split("/").pop() })) : [{ ...msg, baseId: msg.id }]);
    function take(msg) {
      if (seen.has(msg.messageId)) { st.ignored.push({ id: msg.messageId, why: "duplicate" }); return; }
      seen.add(msg.messageId);
      const cur = byKey.get(msg.id);
      if (cur && Date.parse(msg.sent) < Date.parse(cur.sent)) { st.ignored.push({ id: msg.messageId, why: "older than " + cur.messageId }); return; }
      if (cur && msg.sent === cur.sent) {
        // two segments of one statement (e.g. CAN for some counties, CON for the rest): the continuing part wins
        if (!ACTIVE_ACTIONS.has(msg.action) && ACTIVE_ACTIONS.has(cur.action)) return;
        if (ACTIVE_ACTIONS.has(msg.action) && ACTIVE_ACTIONS.has(cur.action) && cur.geometry && msg.geometry) msg.geometry = mergeGeometries([cur.geometry, msg.geometry]);
      }
      const prev = cur && cur.sent !== msg.sent ? strip(cur) : cur ? cur.previous : null;
      // an update keeps the event's original issue time; its own send time is the "updated" time
      const issued = cur && cur.issued && Date.parse(cur.issued) < Date.parse(msg.issued) ? cur.issued : msg.issued;
      byKey.set(msg.id, { ...msg, issued, previous: prev || null, ended: null, endedBy: null, zoneState: cur && !msg.geometry ? cur.zoneState : null, firstSeen: cur ? cur.firstSeen : msg.sent });
    }
    const strip = (p) => ({ id: p.id, messageId: p.messageId, event: p.event, issued: p.issued, updated: p.updated, expires: p.expires, hazard: p.hazard, geometry: p.geometry, action: p.action });
    function ingest(collection, fetchedAt) {
      // an answer older than one already confirmed (e.g. a stale cached copy) adds nothing and confirms nothing
      if (st.lastOk && Date.parse(fetchedAt) < Date.parse(st.lastOk)) { st.ignored.push({ id: "response at " + fetchedAt, why: "older than the last confirmed check" }); return st; }
      st.lastTry = fetchedAt;
      if (!collection || !Array.isArray(collection.features)) return fail(fetchedAt, "unrecognized response");
      // a severe message we cannot read, or a paged answer, means we do not have the complete active set
      const ours = collection.features.filter((f) => f && f.properties && EVENTS.includes(f.properties.event));
      const parsed = ours.map(normalizeAlert), bad = parsed.filter((m) => !m).length + collection.features.filter((f) => !f || !f.properties).length;
      const paged = !!(collection.pagination && collection.pagination.next);
      const msgs = parsed.filter(Boolean).flatMap(explode).sort((a, b) => Date.parse(a.sent) - Date.parse(b.sent));
      const listed = new Set(msgs.map((m) => m.id));
      msgs.forEach(take);
      for (const p of byKey.values()) {
        if (p.ended) continue;
        if (!ACTIVE_ACTIONS.has(p.action)) { p.ended = p.sent; p.endedBy = p.action === "CAN" ? "cancelled" : p.action === "UPG" ? "upgraded" : "expired"; }
        else if (!listed.has(p.id) && !bad && !paged) { p.ended = fetchedAt; p.endedBy = "no longer listed"; }
      }
      if (bad || paged) return fail(fetchedAt, bad ? bad + " unreadable alert message(s) in the response" : "response was paged; the active list may be incomplete");
      st.lastOk = fetchedAt; st.state = "ok"; st.lastError = null;
      return st;
    }
    function fail(at, why) { st.lastTry = at; st.lastError = why || "request failed"; st.state = st.lastOk ? "failed" : "failed"; return st; }
    /* status of each product at `now`: active, ended (by the source, with how), or lapsed (end time passed while unconfirmed) */
    function products(now) {
      const out = [];
      for (const p of records(now)) out.push(p);
      // regroup per-zone records: same event, same message and end time, same status → one product
      const groups = new Map(), single = [];
      for (const p of out) { if (!p.baseId || p.baseId === p.id) { single.push(p); continue; } const k = p.baseId + "|" + p.messageId.split("|")[0] + "|" + p.expires + "|" + p.status; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      const perBase = {}; for (const g of groups.values()) perBase[g[0].baseId] = (perBase[g[0].baseId] || 0) + 1;
      for (const g of groups.values()) {
        const a = g[0], zones = g.map((x) => x.zones[0]).sort();
        single.push({ ...a, id: perBase[a.baseId] > 1 ? a.baseId + "#" + zones[0].split("/").pop() : a.baseId, zones, ugc: zones.map((z) => z.split("/").pop()), messageId: a.messageId.split("|")[0], geometry: null, geometrySource: "counties" });
      }
      return single;
    }
    function records(now) {
      const out = [];
      for (const p of byKey.values()) {
        const end = Date.parse(p.expires), endedOK = p.ended && Date.parse(p.ended) <= Date.parse(st.lastOk || 0);
        let status = "active";
        if (p.ended) status = "ended";
        else if (end <= now) status = st.state === "ok" && Date.parse(st.lastOk) >= end ? "ended" : "lapsed";
        out.push({ ...p, status, endedBy: p.endedBy || (status === "ended" ? "expired" : null), endedConfirmed: !!endedOK });
      }
      return out;
    }
    const sourceInfo = () => ({ state: st.state === "never" ? "failed" : st.state, lastOk: st.lastOk, lastTry: st.lastTry, error: st.lastError });
    return { ingest, fail, products, sourceInfo, get: (k) => byKey.get(k), _st: st };
  }

  /* County-only alerts: resolve listed zones to shapes. `incomplete` stays true while any listed zone has no shape,
     so the venue relation can be "unknown" rather than "outside". */
  async function resolveZones(product, getZone) {
    const urls = product.zones || [];
    return zoneShape(urls, await Promise.all(urls.map((u) => getZone(u).then((g) => g, () => null))));
  }
  /* the drawn area of a county-based alert from its listed zones (results[i] = shape of urls[i], or null) */
  /* land forecast zones start with a state or territory code (UTZ110); marine zones do not (AMZ550, PZZ135, LMZ740) */
  const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split(" "));
  const zoneKind = (u) => (/\/zones\/county\//.test(u) ? "county" : /\/zones\/fire\//.test(u) ? "fire" : STATES.has(u.split("/").pop().slice(0, 2)) ? "zone" : "marine");
  function zoneShape(urls, results) {
    const ok = results.filter(Boolean), kinds = urls.map(zoneKind);
    const tally = (k, only) => urls.filter((u, i) => kinds[i] === k && (!only || results[i])).length;
    // one outline only when every listed zone is drawn; with gaps, the zones stay as they are so the gaps show
    const complete = ok.length === urls.length && urls.length > 0, merged = complete ? dissolve(ok) : null;
    return { geometry: merged || mergeGeometries(ok), dissolved: !!merged, incomplete: !complete, resolved: ok.length, listed: urls.length,
      counties: { listed: tally("county"), drawn: tally("county", true) }, zones: { listed: tally("zone"), drawn: tally("zone", true) }, fire: { listed: tally("fire"), drawn: tally("fire", true) }, marine: { listed: tally("marine"), drawn: tally("marine", true) } };
  }

  /* ---------- UGC lists and SPC watch outline updates (WOU) ---------- */
  /* "NJC005-007-015>019-130000-" -> NJC005, NJC007, NJC015 … NJC019 (the trailing DDHHMM is the purge time) */
  function parseUGC(line) {
    const out = []; let prefix = null;
    for (const part of line.replace(/\s+/g, "").split("-")) {
      let m;
      if ((m = /^([A-Z]{2}[CZ])(\d{3})(?:>(\d{3}))?$/.exec(part))) prefix = m[1];
      else if (!(m = /^()(\d{3})(?:>(\d{3}))?$/.exec(part)) || !prefix) continue;
      const a = +m[2], b = m[3] ? +m[3] : a;
      for (let n = a; n <= b; n++) out.push(prefix + String(n).padStart(3, "0"));
    }
    return out;
  }
  const zoneUrl = (u) => "https://api.weather.gov/zones/" + (u[2] === "C" ? "county" : "forecast") + "/" + u;
  /* An official SPC WOU, converted to the NWS alert shape the adapter reads: county-based, no polygon. Used for archived
     watches the NWS API no longer serves (it keeps about 7 days). */
  function wouToAlert(text) {
    const n = /(TORNADO|SEVERE THUNDERSTORM) WATCH (\d+) IS IN EFFECT/.exec(text), v = /\/O\.[A-Z]{3}\.KWNS\.(?:TO|SV)\.A\.\d{4}\.\d{6}T\d{4}Z-\d{6}T\d{4}Z\//.exec(text);
    const hdr = /WOUS\d\d KWNS (\d{2})(\d{2})(\d{2})/.exec(text);
    if (!n || !v || !hdr) throw Error("unrecognized WOU");
    const vt = parseVTEC(v[0]), ugc = [];
    for (const m of text.matchAll(/^\s*((?:[A-Z]{2}[CZ]\d{3}|\d{3}|>\d{3})(?:[->](?:[A-Z]{2}[CZ])?\d{3})*-\d{6}-)\s*$/gm)) ugc.push(...parseUGC(m[1]));
    const begin = vt.begin, end = vt.end, sent = vt.begin;
    const event = n[1] === "TORNADO" ? "Tornado Watch" : "Severe Thunderstorm Watch";
    const areas = [...text.matchAll(/\.\s+([A-Z ]+?) (?:COUNTIES|PARISHES) INCLUDED ARE/g)].map((m) => m[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));
    return { type: "Feature", geometry: null, properties: { id: "urn:spc:wou:" + n[2] + ":" + sent, "@id": "https://www.spc.noaa.gov/products/watch/ww" + n[2].padStart(4, "0") + ".html",
      event, messageType: "Alert", sent, effective: begin, onset: begin, expires: end, ends: end, senderName: "NWS Storm Prediction Center",
      headline: event + " " + n[2] + " in effect until " + end, areaDesc: ugc.filter((u) => u[2] === "C").length + " counties in " + areas.join(", ") + (ugc.some((u) => u[2] === "Z") ? ", plus adjacent coastal waters" : ""),
      description: text.trim(), affectedZones: ugc.map(zoneUrl), geocode: { UGC: ugc }, references: [], parameters: { VTEC: [v[0]] } } };
  }

  /* ---------- WPC Excessive Rainfall Outlook ---------- */
  /* WPC's own GeoJSON (Day N, latest issuance): one feature per category, nested; times in UTC ("2026-11-20 15:35:00").
     The NOAA map service mirror has the same fields in lower case but was seen empty while WPC had areas, so an empty
     mirror answer is never read as "no areas". */
  const ERO_CATS = ["MRGL", "SLGT", "MDT", "HIGH"];
  const ERO_NAME = { MRGL: "Marginal", SLGT: "Slight", MDT: "Moderate", HIGH: "High" };
  const ERO_PCT = { MRGL: "at least 5%", SLGT: "at least 15%", MDT: "at least 40%", HIGH: "at least 70%" };
  const WPC_ERO_URL = (day) => "https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day" + day + "_Latest.geojson";
  const MAPSVC_ERO_URL = (day) => "https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer/" + (day - 1) + "/query?where=1%3D1&outFields=*&f=geojson";
  const utc = (s) => (s && /^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s) ? new Date(s.replace(" ", "T") + (s.length === 16 ? ":00" : "") + "Z").toISOString() : null);
  function eroCat(outlook) { const m = /^(Marginal|Slight|Moderate|High)\b/i.exec(outlook || ""); return m ? { marginal: "MRGL", slight: "SLGT", moderate: "MDT", high: "HIGH" }[m[1].toLowerCase()] : null; }
  function parseERO(gj, day, via) {
    if (!gj || !Array.isArray(gj.features)) throw Error("unrecognized excessive rainfall answer");
    const out = []; let meta = null;
    for (const f of gj.features) {
      const P = {}; for (const [k, v] of Object.entries(f.properties || {})) P[k.toLowerCase()] = v;
      const cat = eroCat(P.outlook);
      /* a quiet day: WPC sends one placeholder ("None Expected", a point) with the issue and valid times: confirmed no areas */
      if (/^none\b/i.test(P.outlook || "")) { const issued = utc(P.issue_time), start = utc(P.start_time), end = utc(P.end_time); if (!issued || !start || !end) throw Error("excessive rainfall times missing"); meta = meta || { issued, validStart: start, validEnd: end }; continue; }
      if (!cat || !f.geometry) throw Error("unrecognized excessive rainfall category: " + (P.outlook || "none"));
      const issued = utc(P.issue_time), start = utc(P.start_time), end = utc(P.end_time);
      if (!issued || !start || !end) throw Error("excessive rainfall times missing");
      meta = meta || { issued, validStart: start, validEnd: end };
      out.push({ id: "wpc-ero-d" + day + "-" + cat + "-" + issued, kind: "outlook", family: "flood", sourceId: "wpc-ero", program: "ero", day, category: cat,
        event: "Excessive Rainfall Outlook", title: "Day " + day + " Excessive Rainfall Outlook", issued, validStart: start, validEnd: end,
        geometry: f.geometry, label: labelPoint(f.geometry), office: "NWS Weather Prediction Center",
        headline: ERO_NAME[cat] + " risk of rainfall exceeding flash flood guidance (" + ERO_PCT[cat] + " within 25 miles of a point)",
        source: { name: via === "mapservice" ? "WPC Excessive Rainfall Outlook (NOAA map service mirror)" : "WPC Excessive Rainfall Outlook", url: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php" } });
    }
    return { products: out, issued: meta && meta.issued, validStart: meta && meta.validStart, validEnd: meta && meta.validEnd, empty: !out.length, via };
  }
  /* last good issuance per day. Empty from WPC itself = confirmed no areas; empty from the mirror = unconfirmed. */
  function createEROStore(day) {
    let good = null; const st = { state: "never", lastOk: null, lastTry: null, error: null, via: null, unconfirmedEmpty: false };
    return {
      ingest(gj, at, via) {
        st.lastTry = at;
        try {
          const o = parseERO(gj, day, via);
          if (o.empty && via === "mapservice") { st.state = "failed"; st.error = "the NOAA map service mirror answered with no areas, which it also does while WPC has areas"; st.unconfirmedEmpty = true; return; }
          if (good && o.issued && good.issued && Date.parse(o.issued) < Date.parse(good.issued)) return; // never step back to an older issuance
          good = o; st.state = "ok"; st.lastOk = at; st.error = null; st.via = via; st.unconfirmedEmpty = false;
        } catch (e) { st.state = "failed"; st.error = e.message; }
      },
      fail(at, why) { st.lastTry = at; st.state = "failed"; st.error = why || "request failed"; },
      current(now) { if (!good) return { products: [], status: "none" }; const expired = good.validEnd && Date.parse(good.validEnd) <= now; return { ...good, products: expired ? [] : good.products, status: expired ? "expired" : "current" }; },
      sourceInfo: () => ({ state: st.state === "never" ? "failed" : st.state, lastOk: st.lastOk, lastTry: st.lastTry, error: st.error, via: st.via }),
    };
  }

  /* ---------- WPC probabilistic Winter Storm Severity Index (WSSI-P), Overall index ----------
     NOAA map service outlooks/wpc_wssi_p: one layer per impact level, each feature one probability band (5..95%) for one
     rolling 24-hour window (validstart/validend, every 6 hours out to hour 168). At every point checked the levels are
     cumulative (P(winter weather area) >= P(minor) >= P(moderate) ...), so a level's probability reads "at least this level".
     The service's inittime field does not line up with fcsthr, so only validstart/validend and the file time are used. */
  const WSSI_LEVELS = ["WWA", "MINOR", "MODERATE", "MAJOR", "EXTREME"];
  const WSSI_LAYER = { WWA: 10, MINOR: 1, MODERATE: 2, MAJOR: 3, EXTREME: 4 };
  const WSSI_NAME = { WWA: "winter weather", MINOR: "Minor", MODERATE: "Moderate", MAJOR: "Major", EXTREME: "Extreme" };
  // WPC's own definitions of the levels (service description)
  const WSSI_MEANING = { WWA: "Expect winter weather and winter driving conditions.", MINOR: "Expect a few inconveniences to daily life; winter driving conditions.", MODERATE: "Expect disruptions to daily life; hazardous driving conditions; closures and disruptions to infrastructure may occur.", MAJOR: "Expect considerable disruptions to daily life; dangerous or impossible driving conditions; widespread closures may occur.", EXTREME: "Expect substantial disruptions to daily life; extremely dangerous or impossible driving; extensive closures; life-saving actions may be needed." };
  const WSSIP_URL = (level, query) => "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi_p/MapServer/" + WSSI_LAYER[level] + "/query?" + query;
  const zTime = (s) => { const m = /^(\d\d)Z (\d{4})\/(\d\d)\/(\d\d)$/.exec(s || ""); return m ? new Date(Date.UTC(+m[2], +m[3] - 1, +m[4], +m[1])).toISOString() : null; };
  const levelOf = (x) => ({ wwa: "WWA", minor: "MINOR", moderate: "MODERATE", major: "MAJOR", extreme: "EXTREME" })[String(x || "").toLowerCase()] || (WSSI_LEVELS.includes(x) ? x : null);
  /* features from a geojson answer (with shapes) or a json point answer (attributes only; `point` is the venue the
     service matched) */
  function parseWSSIP(answer, point, levelHint) {
    if (!answer || !Array.isArray(answer.features)) throw Error("unrecognized WSSI-P answer");
    return answer.features.map((f) => {
      const P = f.properties || f.attributes || {}, level = levelOf(P.level) || levelOf(P.impact) || levelHint, start = zTime(P.validstart), end = zTime(P.validend), prob = Number(P.prob);
      if (!level || !start || !end || !(prob > 0 && prob <= 100)) throw Error("unrecognized WSSI-P feature");
      const issued = P.idp_filedate ? new Date(P.idp_filedate).toISOString() : null;
      return { id: "wpc-wssip-" + level + "-" + start + "-" + prob + (point ? "@" + point.map((v) => v.toFixed(3)).join(",") : ""), kind: "outlook", program: "wssip", family: "winter", sourceId: "wpc-wssi-p",
        category: level, prob, validStart: start, validEnd: end, issued, fcsthr: P.fcsthr, geometry: f.geometry || null, pointHit: point || null,
        event: "Winter Storm Severity Index (probabilistic)", title: "WPC WSSI-P", office: "NWS Weather Prediction Center",
        headline: prob + "% chance of at least " + WSSI_NAME[level] + (level === "WWA" ? "" : " winter storm impacts") + " in the 24 hours",
        source: { name: "WPC probabilistic Winter Storm Severity Index (WSSI-P)", url: "https://www.wpc.ncep.noaa.gov/wwd/wssi/prob_wssi.php" } };
    });
  }

  /* ---------- SPC Fire Weather Outlooks ----------
     Days 1-2 (products/fire_wx/dayNfw_{windrh,dryt}.lyr.geojson): categories, which are bands (a point is in one):
       wind/RH  ELEV Elevated, CRIT Critical, EXTM Extremely Critical; dry thunderstorms  IDRT isolated (elevated risk),
       SDRT scattered (critical risk). SPC: "verified based on meteorological conditions (e.g., dry thunderstorm occurrence,
       wind speed, RH), not whether wildfire ignitions occur"; receptive fuels must be present for any area.
     Days 3-8 (products/exper/fire_wx/dayNfw_{windrh,dryt}prob.lyr.geojson, issued ~22Z, each 12Z-12Z): the forecaster's
       probability of critical fire weather conditions (or dry thunderstorms) within 12 miles of a point (40%, 70%).
       SPC's archive keeps Days 3-8 only as categorical Critical areas (points text), captured as LABEL "CRIT".
     "No Areas", "Predictability Too Low" and "Potential Too Low" are confirmed answers with no area (kept as the phrase). */
  const FIRE_CATS = ["ELEV", "CRIT", "EXTM"], DRYT_CATS = ["IDRT", "SDRT"], FIRE38_CATS = ["P40", "CRIT", "P70"];
  const FIRE_NAME = { ELEV: "Elevated", CRIT: "Critical", EXTM: "Extremely Critical", IDRT: "Isolated dry thunderstorms", SDRT: "Scattered dry thunderstorms", P40: "40%", P70: "70%" };
  const FIRE_MEANING = { ELEV: "Elevated fire weather risk from wind and low relative humidity.", CRIT: "Critical fire weather risk from wind and low relative humidity.", EXTM: "Extremely critical fire weather risk from wind and low relative humidity.",
    IDRT: "Elevated risk from isolated dry thunderstorms (lightning with little rain).", SDRT: "Critical risk from scattered dry thunderstorms (lightning with little rain).",
    P40: "SPC's probability of critical fire weather conditions within 12 miles of a point during the period.", P70: "SPC's probability of critical fire weather conditions within 12 miles of a point during the period." };
  const NO_AREA = /^(no areas|probability too low|predictability too low|potential too low)$/i;
  const SPC_FIRE_URL = (day, part) => day <= 2 ? "https://www.spc.noaa.gov/products/fire_wx/day" + day + "fw_" + part + ".lyr.geojson" : "https://www.spc.noaa.gov/products/exper/fire_wx/day" + day + "fw_" + part + "prob.lyr.geojson";
  const spcTime = (iso, raw) => { if (iso) { const d = new Date(iso); if (!isNaN(d)) return d.toISOString(); } const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(raw || ""); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString() : null; };
  function fireCategory(label, day, part) {
    const L = String(label || "").trim().toUpperCase();
    if (day <= 2) return (part === "dryt" ? DRYT_CATS : FIRE_CATS).includes(L) ? L : null;
    if (L === "CRIT") return "CRIT";
    const m = /^(0?\.\d+|\d+)\s*%?$/.exec(L); if (!m) return null;
    const v = +m[1] < 1 ? Math.round(+m[1] * 100) : +m[1];
    return v === 40 || v === 70 ? "P" + v : null;
  }
  function parseFireOutlook(gj, day, part) {
    if (!gj || !Array.isArray(gj.features)) throw Error("unrecognized SPC fire outlook answer");
    const out = []; let meta = null, phrase = null;
    for (const f of gj.features) {
      const P = f.properties || {}, d = +P.DAY || day, label = String(P.LABEL || "").trim();
      const issued = spcTime(P.ISSUE_ISO, P.ISSUE), start = spcTime(P.VALID_ISO, P.VALID), end = spcTime(P.EXPIRE_ISO, P.EXPIRE);
      if (!start || !end) throw Error("SPC fire outlook times missing");
      meta = meta || { issued, validStart: start, validEnd: end };
      const hasShape = f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");
      if (NO_AREA.test(label) || !hasShape) { phrase = phrase || label || "No Areas"; continue; }
      const cat = fireCategory(label, d, part);
      if (!cat) throw Error("unrecognized SPC fire outlook category: " + label);
      const prog = "spcfire-" + part;
      out.push({ id: "spc-fire-d" + d + "-" + part + "-" + cat + "-" + issued, kind: "outlook", family: "fire", sourceId: "spc-fire", program: prog, part, day: d, category: cat,
        event: "Fire Weather Outlook", title: "Day " + d + " Fire Weather Outlook", issued, validStart: start, validEnd: end, geometry: f.geometry, label: labelPoint(f.geometry),
        office: "NWS Storm Prediction Center", headline: P.LABEL2 || FIRE_NAME[cat], forecaster: P.FORECASTER || null,
        source: { name: "SPC Fire Weather Outlook", url: d <= 2 ? "https://www.spc.noaa.gov/products/fire_wx/fwdy" + d + ".html" : "https://www.spc.noaa.gov/products/exper/fire_wx/" } });
    }
    return { products: out, issued: meta && meta.issued, validStart: meta && meta.validStart, validEnd: meta && meta.validEnd, empty: !out.length, phrase };
  }
  /* last good issuance per day and part; an empty answer from SPC itself is a confirmed "no areas" */
  function createFireStore(day, part) {
    let good = null; const st = { state: "never", lastOk: null, lastTry: null, error: null };
    return {
      ingest(gj, at) {
        st.lastTry = at;
        try { const o = parseFireOutlook(gj, day, part); if (good && o.issued && good.issued && Date.parse(o.issued) < Date.parse(good.issued)) return; good = o; st.state = "ok"; st.lastOk = at; st.error = null; }
        catch (e) { st.state = "failed"; st.error = e.message; }
      },
      fail(at, why) { st.lastTry = at; st.state = "failed"; st.error = why || "request failed"; },
      current(now) { if (!good) return { products: [], status: "none" }; const expired = good.validEnd && Date.parse(good.validEnd) <= now; return { ...good, products: expired ? [] : good.products, status: expired ? "expired" : "current" }; },
      sourceInfo: () => ({ state: st.state === "never" ? "failed" : st.state, pending: st.state === "never", lastOk: st.lastOk, lastTry: st.lastTry, error: st.error }),
    };
  }

  /* ---------- NIFC WFIGS: current wildland fire incidents and perimeters ----------
     Incident Locations Current: IRWIN records categorized Wildfire (WF), Incident Complex (CX) or Prescribed Fire (RX) that
     have "not been declared contained, controlled, nor out"; records fall off after 3 days without an update (under 10
     acres), 8 days (10-100) or 14 days (over 100). Perimeters Current: the subset with an approved public perimeter.
     Data refresh every 5 minutes. Size and containment are as reported for the incident; a perimeter can be older than
     the incident record, so both times are kept. NIFC: these data "are not legal documents". */
  const NIFC = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/";
  const NIFC_INC_FIELDS = "IrwinID,UniqueFireIdentifier,IncidentName,IncidentTypeCategory,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,ContainmentDateTime,ControlDateTime,FireOutDateTime,POOState,POOCounty,POOProtectingUnit,IncidentManagementOrganization,TotalIncidentPersonnel,FireCause";
  const NIFC_PER_FIELDS = "attr_IrwinID,poly_IncidentName,poly_GISAcres,poly_PolygonDateTime,poly_DateCurrent,poly_MapMethod,attr_IncidentTypeCategory,attr_PercentContained,attr_ModifiedOnDateTime_dt";
  const NIFC_INC_URL = NIFC + "WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=" + encodeURIComponent("IncidentTypeCategory IN ('WF','CX','RX')") + "&outFields=" + NIFC_INC_FIELDS + "&outSR=4326&resultRecordCount=4000&f=geojson";
  const NIFC_PER_URL = NIFC + "WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=" + NIFC_PER_FIELDS + "&outSR=4326&maxAllowableOffset=0.002&geometryPrecision=4&resultRecordCount=2000&f=geojson";
  const INCIDENT_TYPE = { WF: "Wildfire", CX: "Wildfire complex", RX: "Prescribed fire" };
  const msIso = (v) => (v == null || v === "" ? null : new Date(typeof v === "number" ? v : Date.parse(v)).toISOString());
  const guid = (s) => String(s || "").replace(/[{}]/g, "").toUpperCase();
  function parseNIFC(incidents, perimeters) {
    if (!incidents || !Array.isArray(incidents.features)) throw Error("unrecognized NIFC incident answer");
    if (incidents.properties && incidents.properties.exceededTransferLimit) throw Error("NIFC incident answer is incomplete (transfer limit)");
    const per = new Map();
    if (perimeters) {
      if (!Array.isArray(perimeters.features)) throw Error("unrecognized NIFC perimeter answer");
      if (perimeters.properties && perimeters.properties.exceededTransferLimit) throw Error("NIFC perimeter answer is incomplete (transfer limit)");
      for (const f of perimeters.features) { const P = f.properties || {}; if (f.geometry && P.attr_IrwinID) per.set(guid(P.attr_IrwinID), { geometry: f.geometry, acres: P.poly_GISAcres, date: msIso(P.poly_DateCurrent || P.poly_PolygonDateTime), method: P.poly_MapMethod }); }
    }
    const out = [];
    for (const f of incidents.features) {
      const P = f.properties || {}, cat = P.IncidentTypeCategory, c = f.geometry && f.geometry.coordinates;
      if (!INCIDENT_TYPE[cat] || !c || !Number.isFinite(c[0]) || P.FireOutDateTime) continue;
      const id = guid(P.IrwinID), pr = per.get(id), name = String(P.IncidentName || "Unnamed").trim();
      out.push({ id: "nifc-" + id, irwinId: id, kind: "incident", family: "fire", sourceId: "nifc-wfigs", program: "wfigs", category: cat,
        event: INCIDENT_TYPE[cat], title: name, name, acres: P.IncidentSize == null ? null : +P.IncidentSize, contained: P.PercentContained == null ? null : +P.PercentContained,
        discovered: msIso(P.FireDiscoveryDateTime), updated: msIso(P.ModifiedOnDateTime_dt), issued: msIso(P.FireDiscoveryDateTime), uniqueId: P.UniqueFireIdentifier || null,
        state: String(P.POOState || "").replace(/^US-/, ""), county: P.POOCounty || null, unit: P.POOProtectingUnit || null, imt: P.IncidentManagementOrganization || null,
        point: [c[0], c[1]], geometry: pr ? pr.geometry : null, perimeter: pr ? { acres: pr.acres, date: pr.date, method: pr.method } : null,
        label: pr ? labelPoint(pr.geometry) : [c[0], c[1]], office: "National Interagency Fire Center (WFIGS)",
        source: { name: "NIFC WFIGS current incidents", url: "https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-incident-locations/about" } });
    }
    return out;
  }

  /* ---------- smoke and air quality ----------
     Three kinds, kept apart:
     - OBSERVED SMOKE ALOFT: NOAA NESDIS Hazard Mapping System (HMS) smoke analysis. Analysts outline smoke seen in
       satellite imagery (GOES-East/West, polar orbiters) with a density (Light, Medium, Heavy) and the satellite window
       ("Start Time: 2026195 1500UTC"). It is smoke anywhere in the air column: it says nothing about the ground.
     - SURFACE OBSERVATIONS: EPA AirNow, latest hourly AQI per monitor (preliminary, not validated) and per reporting area.
     - FORECASTS: AirNow reporting-area AQI forecasts by state/local agencies (a calendar day, category and sometimes a
       value); NOAA NAQFC near-surface smoke guidance (model, hourly, 48 h).
     Only HMS and NAQFC "smoke" name smoke; AirNow PM2.5 is fine particles, whatever the cause. */
  const HMS_DENSITY = ["Light", "Medium", "Heavy"];
  const jdayIso = (s) => { const m = /^(\d{4})(\d{3}) (\d\d)(\d\d)UTC$/.exec(String(s || "").trim()); if (!m) return null; const d = new Date(Date.UTC(+m[1], 0, 1, +m[3], +m[4])); d.setUTCDate(+m[2]); return d.toISOString(); };
  /* HMS smoke KML -> one product per polygon. Placemarks carry "Start Time", "End Time", "Density", "Satellite". */
  function parseHMS(kml, dayIso) {
    if (typeof kml !== "string" || !/<kml[\s>]/.test(kml)) throw Error("unrecognized HMS smoke answer");
    const out = [];
    (kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || []).forEach((pm, i) => {
      const get = (k) => { const m = new RegExp(k + ":\\s*([^<]+)").exec(pm); return m ? m[1].trim() : null; };
      const start = jdayIso(get("Start Time")), end = jdayIso(get("End Time")), density = get("Density"), sat = get("Satellite");
      if (!start || !end || !HMS_DENSITY.includes(density)) throw Error("unrecognized HMS smoke polygon");
      const polys = (pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/g) || []).map((c) => [c.replace(/<\/?coordinates>/g, "").trim().split(/\s+/).map((t) => t.split(",").slice(0, 2).map(Number))]).filter((r) => r[0].length >= 4);
      if (!polys.length) return;
      const geometry = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
      out.push({ id: "hms-" + (dayIso || start.slice(0, 10)) + "-" + i, kind: "smoke", program: "hms", family: "smoke", sourceId: "noaa-hms", category: density, density,
        satellite: sat, obsStart: start, obsEnd: end, issued: end, validStart: start, validEnd: end, geometry, label: labelPoint(geometry),
        event: "Smoke detected by satellite", title: density + " smoke (satellite)", office: "NOAA NESDIS Hazard Mapping System",
        source: { name: "NOAA HMS smoke analysis", url: "https://www.ospo.noaa.gov/products/land/hms.html" } });
    });
    return out;
  }
  const HMS_URL = (ymd) => "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/" + ymd.slice(0, 4) + "/" + ymd.slice(4, 6) + "/hms_smoke" + ymd + ".kml";

  /* AQI categories (EPA). AirNow's monitor layer gives the AQI per pollutant for the latest hour. */
  const AQI_CATS = [[50, "Good"], [100, "Moderate"], [150, "Unhealthy for Sensitive Groups"], [200, "Unhealthy"], [300, "Very Unhealthy"], [Infinity, "Hazardous"]];
  const aqiCat = (v) => (v == null || !(v >= 0) ? null : AQI_CATS.find(([hi]) => v <= hi)[1]);
  const AQI_CAT_ORDER = ["Good", "Moderate", "Unhealthy for Sensitive Groups", "Unhealthy", "Very Unhealthy", "Hazardous"];
  const AIRNOW_MON = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Air%20Now%20Current%20Monitor%20Data%20Public/FeatureServer/0/query";
  const AIRNOW_MON_FIELDS = "AQSID,SiteName,StateName,DataSource,ReportingArea_PipeDelimited,ValidTime,LocalTimeString,GMTOffset,PM25,PM25_AQI,PM10_AQI,OZONE_AQI,Status,MonitorType";
  const AIRNOW_MON_URL = (lat, lon, miles) => AIRNOW_MON + "?geometry=" + lon + "," + lat + "&geometryType=esriGeometryPoint&inSR=4326&distance=" + miles + "&units=esriSRUnit_StatuteMile&spatialRel=esriSpatialRelIntersects&outFields=" + AIRNOW_MON_FIELDS + "&outSR=4326&f=geojson";
  const AIRNOW_MON_ALL_URL = AIRNOW_MON + "?where=" + encodeURIComponent("CountryCode='US' AND Status='Active'") + "&outFields=" + AIRNOW_MON_FIELDS + "&outSR=4326&resultRecordCount=5000&f=geojson";
  function parseAirNowMonitors(gj) {
    if (!gj || !Array.isArray(gj.features)) throw Error("unrecognized AirNow monitor answer");
    if (gj.properties && gj.properties.exceededTransferLimit) throw Error("AirNow monitor answer is incomplete (transfer limit)");
    const out = [];
    for (const f of gj.features) {
      const P = f.properties || f.attributes || {}, c = f.geometry && f.geometry.coordinates;
      if (!c || P.Status === "Inactive") continue;
      const vals = [["PM2.5", P.PM25_AQI], ["PM10", P.PM10_AQI], ["Ozone", P.OZONE_AQI]].filter(([, v]) => v != null && v !== "" && +v >= 0).map(([k, v]) => [k, +v]);
      if (!vals.length) continue;
      const top = vals.reduce((a, b) => (b[1] > a[1] ? b : a)), at = P.ValidTime ? new Date(+P.ValidTime).toISOString() : null;
      if (!at) continue;
      out.push({ id: "airnow-" + P.AQSID, kind: "aqobs", program: "airnow", family: "smoke", sourceId: "airnow-obs", site: P.SiteName, aqsid: P.AQSID, state: P.StateName,
        area: P.ReportingArea_PipeDelimited || null, agency: P.DataSource || null, observed: at, issued: at, aqi: top[1], pollutant: top[0], category: aqiCat(top[1]),
        values: Object.fromEntries(vals), pm25: P.PM25 == null || P.PM25 === "" ? null : +P.PM25, point: [c[0], c[1]], geometry: null, label: [c[0], c[1]],
        event: "Air quality observation", title: P.SiteName, office: P.DataSource || "AirNow",
        source: { name: "EPA AirNow (preliminary data)", url: "https://www.airnow.gov/" } });
    }
    return out;
  }

  /* AirNow reportingarea.dat: IssueDate|ValidDate|ValidTime|TimeZone|Sequence|DataType|Primary|ReportingArea|State|Lat|Lon|
     Parameter|AQIValue|AQICategory|ActionDay|Discussion|ForecastSource. DataType F = forecast for ValidDate, O = latest
     hourly observation (ValidTime, local), Y = yesterday's daily value. */
  const TZ_OFF = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10, AST: -4, ADT: -3, GMT: 0, UTC: 0 };
  const mdy = (s) => { const m = /^(\d\d)\/(\d\d)\/(\d\d)$/.exec(String(s || "").trim()); return m ? "20" + m[3] + "-" + m[1] + "-" + m[2] : null; };
  function parseReportingArea(text) {
    if (typeof text !== "string") throw Error("unrecognized AirNow reporting area answer");
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const c = line.split("|"); if (c.length < 15) throw Error("unrecognized AirNow reporting area row");
      const [issue, valid, vtime, tz, , type, primary, area, st, lat, lon, param, aqi, cat, action, disc, src] = c;
      if (!["F", "O", "Y"].includes(type)) continue;
      const vd = mdy(valid), off = TZ_OFF[(tz || "").trim()];
      let observed = null;
      if (type === "O" && vd && vtime && off != null) { const [h, mi] = vtime.split(":").map(Number); observed = new Date(Date.parse(vd + "T00:00:00Z") + ((h - off) * 60 + (mi || 0)) * 60e3).toISOString(); }
      rows.push({ issueDate: mdy(issue), validDate: vd, type, primary: primary === "Y", area: area.trim(), state: st.trim(), lat: +lat, lon: +lon, tz: (tz || "").trim(), tzOffset: off,
        parameter: param.trim(), aqi: aqi === "" ? null : +aqi, category: (cat || "").trim() || null, actionDay: /^yes$/i.test((action || "").trim()), discussion: (disc || "").trim() || null, agency: (src || "").trim() || null, observed });
    }
    return rows;
  }
  /* forecast rows for one reporting area -> one product per valid date (the most severe pollutant) */
  function aqForecastProducts(rows) {
    const byDay = new Map();
    for (const r of rows.filter((x) => x.type === "F" && x.validDate && x.category && AQI_CAT_ORDER.includes(x.category))) {
      const k = r.area + "|" + r.state + "|" + r.validDate, cur = byDay.get(k);
      if (!cur || AQI_CAT_ORDER.indexOf(r.category) > AQI_CAT_ORDER.indexOf(cur.category) || (r.category === cur.category && (r.aqi || 0) > (cur.aqi || 0))) byDay.set(k, r);
    }
    return [...byDay.values()].map((r) => {
      const off = r.tzOffset == null ? 0 : r.tzOffset, start = new Date(Date.parse(r.validDate + "T00:00:00Z") - off * 3600e3).toISOString(), end = new Date(Date.parse(start) + 864e5).toISOString();
      return { id: "aqf-" + r.state + "-" + r.area.replace(/\W+/g, "") + "-" + r.validDate, kind: "aqfcst", program: "airnow-forecast", family: "smoke", sourceId: "airnow-fcst",
        area: r.area, state: r.state, validDate: r.validDate, validStart: start, validEnd: end, issued: r.issueDate, category: r.category, aqi: r.aqi, pollutant: r.parameter.replace("OZONE", "Ozone"),
        actionDay: r.actionDay, discussion: r.discussion, agency: r.agency, point: [r.lon, r.lat], geometry: null, event: "Air quality forecast", title: r.area + " AQI forecast", office: r.agency || "AirNow",
        source: { name: "AirNow reporting area forecast", url: "https://www.airnow.gov/" } };
    });
  }
  const AIRNOW_AREA_URL = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/AirNow_National_Air_Quality_Index_(AQI)_Forecast/FeatureServer/0/query";
  const AIRNOW_AREA_AT = (lat, lon) => AIRNOW_AREA_URL + "?geometry=" + lon + "," + lat + "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=RAName,RACode,RAAgency&returnGeometry=false&f=json";

  /* NOAA NAQFC near-surface smoke guidance: NOT USED (NAQFC_ENABLED false) until NOAA's documentation confirms the field and
     unit. The service text says "micrograms per cubic feet"; sample magnitudes (multiples of 1e-9) suggest kg/m³, but that is
     not verified. Kept here, off: no fetch, no Planner item, no concentration shown, no source line. */
  const NAQFC_ENABLED = false;
  /* NOAA NAQFC near-surface smoke guidance at a point: hourly samples (getSamples) from the time-enabled image service.
     Unit: the service answers in kg/m³ (GRIB's unit for mass density). Its description says "micrograms per cubic feet",
     but every value is an exact multiple of 1e-9 (1 µg/m³), its legend has classes 1..150, and its stated maximum is
     1.06e-7 (106 µg/m³): ×1e9 gives µg/m³ (checked 2026-11-21 under live HMS plumes: 1-4 µg/m³). */
  const NAQFC_SMOKE = "https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer";
  const NAQFC_SMOKE_AT = (lat, lon) => NAQFC_SMOKE + "/getSamples?geometry=" + encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } })) + "&geometryType=esriGeometryPoint&returnFirstValueOnly=false&outFields=*&f=json";
  function parseNAQFC(j, point) {
    if (!j || !Array.isArray(j.samples)) throw Error("unrecognized NOAA smoke forecast answer");
    const hours = j.samples.map((s) => ({ t: new Date(+s.attributes.idp_validtime).toISOString(), v: Math.max(0, Math.round((+s.value || 0) * 1e9 * 10) / 10), run: new Date(+s.attributes.idp_issueddate).toISOString(), fh: +s.attributes.idp_fcst_hour }))
      .filter((h) => Number.isFinite(Date.parse(h.t))).sort((a, b) => (a.t < b.t ? -1 : 1));
    if (!hours.length) throw Error("NOAA smoke forecast has no hours");
    const run = hours.map((h) => h.run).sort().pop(), mine = hours.filter((h) => h.run === run);
    return { id: "naqfc-smoke-" + run + "@" + point.join(","), kind: "smokefcst", program: "naqfc", family: "smoke", sourceId: "noaa-naqfc-smoke", run, issued: run, hours: mine,
      validStart: new Date(Date.parse(mine[0].t) - 3600e3).toISOString(), validEnd: mine[mine.length - 1].t, point, pointHit: point, geometry: null,
      event: "Near-surface smoke forecast", title: "NOAA smoke forecast", office: "NOAA National Air Quality Forecast Capability",
      source: { name: "NOAA NAQFC smoke guidance (model)", url: "https://airquality.weather.gov/" } };
  }

  /* WSSI-P point answers per level, combined. A level that still fails after its retry is reported as unavailable; the
     levels that answered are kept as published. Nothing is inferred for a missing level. If no level answered, this throws
     (the source stays unconfirmed). */
  function combineWSSI(results) {
    const unavailable = [], got = [];
    results.forEach((r, i) => { if (Array.isArray(r)) got.push(...r); else unavailable.push(WSSI_LEVELS[i]); });
    if (unavailable.length === results.length) throw Error("WSSI-P: no level answered");
    return { products: got, unavailable };
  }

  /* ---------- NHC / CPHC (NOAA map service tropical/NHC_tropical_weather_summary) ----------
     Regional context on the map, never a venue item by itself:
       layer 3  Seven-Day Potential Development Region (Graphical Tropical Weather Outlook): prob2day/prob7day, risk Low/Medium/High
       layer 5  Forecast Points, 6 Forecast Track, 7 Forecast Cone, 8 Watch-Warning (coastal segments, TCWW HWR/HWA/TWR/TWA)
     The cone is NHC's probable track of the storm's CENTER (about two-thirds of the time); impacts reach well outside it.
     Venue-specific: layers 30/31/32 Probabilistic Winds (34/50/64 kt): the chance of sustained winds of at least that
     speed at a point during the 5-day forecast period (cumulative). */
  const NHC = "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/";
  const NHC_LAYER = { two: 3, points: 5, track: 6, cone: 7, watchwarning: 8 }, NHC_WSP = { 34: 30, 50: 31, 64: 32 };
  const NHC_URL = (layer) => NHC + NHC_LAYER[layer] + "/query?where=1%3D1&outFields=*&outSR=4326&maxAllowableOffset=0.01&f=geojson";
  const NHC_WSP_AT = (kt, lat, lon) => NHC + NHC_WSP[kt] + "/query?geometry=" + lon + "," + lat + "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=percentage,idp_source,idp_filedate&returnGeometry=false&f=json";
  const TCWW = { HWR: "Hurricane Warning", HWA: "Hurricane Watch", TWR: "Tropical Storm Warning", TWA: "Tropical Storm Watch" };
  const advTime = (s) => { const m = /(\d{3,4}) (AM|PM) ([A-Z]{3}) \w{3} (\w{3}) (\d{1,2}) (\d{4})/.exec(s || ""); if (!m) return null; const off = { EDT: 4, EST: 5, CDT: 5, CST: 6, MDT: 6, MST: 7, PDT: 7, PST: 8, HST: 10, AST: 4, ADT: 3 }[m[3]]; if (off == null) return null; const hm = m[1].padStart(4, "0"), h = (+hm.slice(0, 2) % 12) + (m[2] === "PM" ? 12 : 0); return new Date(Date.parse(m[6] + " " + m[4] + " " + m[5] + " 00:00:00 UTC") + ((h + off) * 60 + +hm.slice(2)) * 60e3).toISOString(); };
  function parseNHC(gj, layerHint) {
    if (!gj || !Array.isArray(gj.features)) throw Error("unrecognized NHC answer");
    const out = [];
    gj.features.forEach((f, i) => {
      const P = {}; for (const [k, v] of Object.entries(f.properties || f.attributes || {})) P[k.toLowerCase()] = v;
      const layer = P.layer || layerHint, g = f.geometry; if (!g) return;
      const issued = advTime(P.advdate) || (P.idp_filedate ? new Date(+P.idp_filedate).toISOString() : null);
      const storm = P.stormname ? String(P.stormname).replace(/^(Tropical Storm|Hurricane|Tropical Depression|Potential Tropical Cyclone|Post-Tropical Cyclone) /i, "") : null;
      const base = { family: "tropical", sourceId: "nhc", office: "NOAA National Hurricane Center", issued, storm, advisory: P.advisnum || null, stormType: P.stormtype || null, geometry: g, label: g.type === "Point" ? g.coordinates : g.type === "Polygon" || g.type === "MultiPolygon" ? labelPoint(g) : null,
        source: { name: "NHC (NOAA map service)", url: "https://www.nhc.noaa.gov/" } };
      if (layer === "two") out.push({ ...base, id: "nhc-two-" + i + "-" + (P.idp_source || ""), kind: "tcoutlook", program: "nhc-two", category: String(P.risk7day || "").replace(/^\w/, (c) => c.toUpperCase()), prob2: P.prob2day, prob7: P.prob7day, basin: P.basin, event: "Tropical Weather Outlook area", title: "7-day formation chance " + (P.prob7day || "?") });
      else if (["cone", "track", "points", "watchwarning"].includes(layer)) out.push({ ...base, id: "nhc-" + layer + "-" + (P.stormnum || storm) + "-" + (P.advisnum || "") + "-" + i, kind: "tctrack", program: "nhc-" + layer, part: layer, category: layer === "watchwarning" ? TCWW[P.tcww] || P.tcww : P.stormtype,
        tau: P.tau, validLabel: P.fldatelbl || P.datelbl || null, maxwind: P.maxwind, event: layer === "cone" ? "Forecast cone" : layer === "watchwarning" ? (TCWW[P.tcww] || "Watch/warning") + " (coastal segment)" : "Forecast " + layer, title: (storm || "Storm") + " · advisory " + (P.advisnum || "") });
    });
    return out;
  }
  /* wind speed probabilities at a point: the highest band containing the venue, per threshold */
  function parseNHCWsp(answers, point) {
    const out = [];
    for (const [kt, j] of Object.entries(answers)) {
      if (!j || !Array.isArray(j.features)) throw Error("unrecognized NHC wind probability answer");
      // bands as published: "5-10%", "20-30%", ">90%" -> the band's lower bound ("at least"), band text kept for display
      const vals = j.features.map((f) => { const raw = String((f.attributes || f.properties || {}).percentage || "").trim(), m = /^(?:<|>)?\s*(\d+(?:\.\d+)?)/.exec(raw); return { pct: m ? +m[1] : NaN, band: raw, src: (f.attributes || {}).idp_source, at: (f.attributes || {}).idp_filedate }; }).filter((x) => x.pct >= 0);
      if (!vals.length) continue;
      const top = vals.reduce((a, b) => (b.pct > a.pct ? b : a));
      out.push({ id: "nhc-wsp-" + kt + "@" + point.join(","), kind: "tcwind", program: "nhc-wsp", family: "tropical", sourceId: "nhc", kt: +kt, pct: top.pct, band: top.band, pointHit: point, geometry: null,
        issued: top.at ? new Date(+top.at).toISOString() : null, event: "Wind speed probability", title: kt + " kt winds", office: "NOAA National Hurricane Center", source: { name: "NHC wind speed probabilities", url: "https://www.nhc.noaa.gov/" } });
    }
    return out;
  }

  /* ---------- aviation: NOAA Aviation Weather Center (aviationweather.gov Data API) ----------
     METAR: the airport's latest routine/special observation (report time, wind, visibility, ceiling, weather, AWC's flight
     category). TAF: the terminal forecast for 5 statute miles around the airport, normally 24 or 30 hours, issued at
     00/06/12/18Z and amended as needed; base period and FM/BECMG/TEMPO/PROB change groups, each with its own times.
     Flight category from ceiling (lowest BKN/OVC layer or vertical visibility) and visibility, FAA definitions:
       LIFR ceiling < 500 ft or visibility < 1 mi; IFR 500 to < 1,000 ft or 1 to < 3 mi; MVFR 1,000-3,000 ft or 3-5 mi; VFR above. */
  const AWC = "https://aviationweather.gov/api/data/";
  const AWC_URL = (kind, ids) => AWC + kind + "?ids=" + ids.join(",") + "&format=json";
  const FLT_ORDER = ["VFR", "MVFR", "IFR", "LIFR"];
  const visNum = (v) => (v == null || v === "" ? null : typeof v === "number" ? v : /\+$/.test(String(v)) ? parseFloat(v) + 0.01 : parseFloat(String(v).replace(/[^\d.\/ ]/g, "")));
  function ceilingOf(clouds, vertVis) {
    const layers = (clouds || []).filter((c) => /^(BKN|OVC|OVX)$/.test(c.cover) && c.base != null).map((c) => +c.base);
    if (vertVis != null && vertVis !== "") layers.push(+vertVis);
    return layers.length ? Math.min(...layers) : null;
  }
  function fltCat(ceil, vis) {
    const c = ceil == null ? Infinity : ceil, v = vis == null ? Infinity : vis;
    if (c < 500 || v < 1) return "LIFR"; if (c < 1000 || v < 3) return "IFR"; if (c <= 3000 || v <= 5) return "MVFR"; return "VFR";
  }
  const CONCERN_WX = /(^|\s|[-+])(TS|FZ|SN|PL|GR|FC|SS|DS|\+RA|\+SHRA)/;
  function concernOf(cat, gust, wind, wx) {
    const out = [];
    if (cat === "IFR" || cat === "LIFR") out.push(cat);
    if (gust >= 30 || wind >= 25) out.push("wind " + (wind || "") + (gust ? "G" + gust : "") + " kt");
    if (wx && CONCERN_WX.test(" " + wx)) out.push(wx);
    return out;
  }
  function parseMETAR(list) {
    if (!Array.isArray(list)) throw Error("unrecognized METAR answer");
    return list.map((m) => {
      const ceil = ceilingOf(m.clouds, m.vertVis), vis = visNum(m.visib), cat = FLT_ORDER.includes(m.fltCat) ? m.fltCat : fltCat(ceil, vis);
      const observed = m.obsTime ? new Date(m.obsTime * 1000).toISOString() : m.reportTime ? new Date(m.reportTime).toISOString() : null;
      return { id: "metar-" + m.icaoId + "-" + observed, kind: "metar", family: "aviation", sourceId: "awc", airport: m.icaoId, airportName: m.name || m.icaoId, observed, issued: observed,
        category: cat, ceiling: ceil, visibility: vis, visText: m.visib, wind: m.wspd, gust: m.wgst || null, wdir: m.wdir, wx: m.wxString || null, raw: m.rawOb, point: [m.lon, m.lat], geometry: null,
        concerns: concernOf(cat, m.wgst || 0, m.wspd || 0, m.wxString), office: "NOAA Aviation Weather Center", event: "METAR", title: m.icaoId + " observation",
        source: { name: "Aviation Weather Center METAR", url: "https://aviationweather.gov/data/metar/?ids=" + m.icaoId } };
    });
  }
  function parseTAF(list) {
    if (!Array.isArray(list)) throw Error("unrecognized TAF answer");
    return list.map((t) => {
      const periods = (t.fcsts || []).map((f) => {
        const ceil = ceilingOf(f.clouds, f.vertVis), vis = visNum(f.visib), cat = ceil == null && vis == null ? null : fltCat(ceil, vis);
        return { from: new Date(f.timeFrom * 1000).toISOString(), to: new Date(f.timeTo * 1000).toISOString(), change: f.fcstChange || "BASE", prob: f.probability || null,
          category: cat, ceiling: ceil, visibility: vis, visText: f.visib, wind: f.wspd, gust: f.wgst || null, wdir: f.wdir, wx: f.wxString || null, concerns: concernOf(cat, f.wgst || 0, f.wspd || 0, f.wxString) };
      });
      const issued = t.issueTime ? new Date(t.issueTime).toISOString() : null;
      return { id: "taf-" + t.icaoId + "-" + issued, kind: "taf", family: "aviation", sourceId: "awc", airport: t.icaoId, airportName: t.name || t.icaoId, issued, amended: /AMD/.test(t.remarks || t.rawTAF || ""),
        validStart: new Date(t.validTimeFrom * 1000).toISOString(), validEnd: new Date(t.validTimeTo * 1000).toISOString(), periods, raw: t.rawTAF, point: [t.lon, t.lat], geometry: null,
        office: "NOAA Aviation Weather Center", event: "TAF", title: t.icaoId + " terminal forecast", source: { name: "Aviation Weather Center TAF", url: "https://aviationweather.gov/data/taf/?ids=" + t.icaoId } };
    });
  }

  /* ---------- source registry: who issues what, for which area ----------
     Coverage is explicit so a venue outside a provider's area reads "not covered by this source", never "nothing".
     New regions and providers are new entries here; Event Planner reads products and source states only. */
  const BOX = { conus: [[-125, 24.3, -66.8, 49.5]], us: [[-125, 24.3, -66.8, 49.5], [-180, 51, -129, 71.5], [172, 51, 180, 53], [-160.5, 18.8, -154.5, 22.4], [-67.4, 17.6, -64.5, 18.6], [144.5, 13.1, 146.2, 20.6], [-171, -14.6, -168, -11]] };
  const SOURCES = [
    { id: "nws-alerts", name: "NWS warnings, watches and advisories", provider: "NOAA National Weather Service", region: "United States", boxes: BOX.us, hazards: ["severe", "flood", "winter", "fire", "tropical", "coastal"], url: "https://www.weather.gov/" },
    { id: "spc-fire", name: "SPC fire weather outlooks", provider: "NOAA Storm Prediction Center", region: "Contiguous U.S.", boxes: BOX.conus, hazards: ["fire"], url: "https://www.spc.noaa.gov/products/fire_wx/" },
    { id: "noaa-hms", name: "NOAA satellite smoke analysis (HMS)", provider: "NOAA NESDIS", region: "North America", boxes: [[-170, 14, -50, 72]], hazards: ["smoke"], url: "https://www.ospo.noaa.gov/products/land/hms.html" },
    { id: "airnow-obs", name: "AirNow air quality observations", provider: "EPA AirNow and state/local agencies", region: "United States", boxes: BOX.us, hazards: ["smoke"], url: "https://www.airnow.gov/" },
    { id: "airnow-fcst", name: "AirNow air quality forecasts", provider: "State and local air agencies via AirNow", region: "United States", boxes: BOX.us, hazards: ["smoke"], url: "https://www.airnow.gov/" },
    NAQFC_ENABLED && { id: "noaa-naqfc-smoke", name: "NOAA smoke forecast guidance (NAQFC)", provider: "NOAA National Weather Service", region: "Contiguous U.S.", boxes: BOX.conus, hazards: ["smoke"], url: "https://airquality.weather.gov/" },
    { id: "awc", name: "Aviation Weather Center (METAR and TAF)", provider: "NOAA Aviation Weather Center", region: "Airports with METAR/TAF", boxes: [[-180, -90, 180, 90]], hazards: ["aviation"], url: "https://aviationweather.gov/" },
    { id: "awc-enroute", name: "Aviation Weather Center en route (pilot reports, SIGMETs, G-AIRMETs, CWAs)", provider: "NOAA Aviation Weather Center", region: "Contiguous U.S. airspace", boxes: [[-180, -90, 180, 90]], hazards: ["aviation"], url: "https://aviationweather.gov/gfa/" },
    { id: "faa-nas", name: "FAA airport status (delays, ground stops, closures)", provider: "FAA Air Traffic Control System Command Center", region: "U.S. airports", boxes: [[-180, -90, 180, 90]], hazards: ["aviation"], url: "https://nasstatus.faa.gov/" },
    { id: "nhc", name: "NHC tropical outlooks and storm products", provider: "NOAA National Hurricane Center", region: "Atlantic and Pacific basins", boxes: [[-180, 0, -10, 60]], hazards: ["tropical"], url: "https://www.nhc.noaa.gov/" },
    { id: "nifc-wfigs", name: "NIFC wildfire incidents (WFIGS)", provider: "National Interagency Fire Center", region: "United States", boxes: BOX.us, hazards: ["fire"], url: "https://data-nifc.opendata.arcgis.com/" },
    { id: "spc-md", name: "SPC Mesoscale Discussions", provider: "NOAA Storm Prediction Center", region: "Contiguous U.S.", boxes: BOX.conus, hazards: ["severe"], url: "https://www.spc.noaa.gov/products/md/" },
    { id: "spc-outlook", name: "SPC convective outlooks", provider: "NOAA Storm Prediction Center", region: "Contiguous U.S.", boxes: BOX.conus, hazards: ["severe"], url: "https://www.spc.noaa.gov/products/outlook/" },
    { id: "wpc-wssi-p", name: "WPC winter storm severity outlook (WSSI-P)", provider: "NOAA Weather Prediction Center", region: "Contiguous U.S.", boxes: BOX.conus, hazards: ["winter"], url: "https://www.wpc.ncep.noaa.gov/wwd/wssi/prob_wssi.php" },
    { id: "wpc-ero", name: "WPC Excessive Rainfall Outlook", provider: "NOAA Weather Prediction Center", region: "Contiguous U.S.", boxes: BOX.conus, hazards: ["flood"], url: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php" },
  ].filter(Boolean);
  const covers = (src, lat, lon) => src.boxes.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);

  /* ---------- SPC outlooks ---------- */
  const CATS = ["TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];
  function parseOutlook(gj, day) {
    if (!gj || !Array.isArray(gj.features)) throw Error("unrecognized outlook response");
    const out = [];
    for (const f of gj.features) {
      const p = f.properties || {}, cat = p.LABEL;
      if (!CATS.includes(cat) || !f.geometry) continue;
      out.push({ id: "spc-d" + day + "-" + cat + "-" + p.ISSUE, kind: "outlook", family: "severe", sourceId: "spc-outlook", program: "spc", day, category: cat, event: "Day " + day + " Convective Outlook", title: "Day " + day + " outlook",
        issued: iso(p.ISSUE_ISO), validStart: iso(p.VALID_ISO), validEnd: iso(p.EXPIRE_ISO), geometry: f.geometry, label: labelPoint(f.geometry),
        office: "NWS Storm Prediction Center" + (p.FORECASTER ? " · " + p.FORECASTER : ""), source: { name: "SPC convective outlook", url: "https://www.spc.noaa.gov/products/outlook/day" + day + "otlk.html" } });
    }
    const meta = gj.features[0] && gj.features[0].properties;
    return { products: out, issued: meta ? iso(meta.ISSUE_ISO) : null, validStart: meta ? iso(meta.VALID_ISO) : null, validEnd: meta ? iso(meta.EXPIRE_ISO) : null, empty: !gj.features.length };
  }
  /* last good issuance per day; an issuance past its valid end is "expired" (waiting for the next), never drawn as current */
  function createOutlookStore(day) {
    let good = null, prevIssue = null; const st = { state: "never", lastOk: null, lastTry: null, error: null };
    return {
      ingest(gj, at) {
        st.lastTry = at;
        try { const o = parseOutlook(gj, day); if (good && o.issued !== good.issued) prevIssue = good; good = o; st.state = "ok"; st.lastOk = at; st.error = null; }
        catch (e) { st.state = "failed"; st.error = e.message; }
      },
      fail(at, why) { st.lastTry = at; st.state = "failed"; st.error = why || "request failed"; },
      current(now) { if (!good) return { products: [], status: "none" }; const expired = good.validEnd && Date.parse(good.validEnd) <= now; return { ...good, products: expired ? [] : good.products, status: expired ? "expired" : "current", previous: prevIssue }; },
      sourceInfo: () => ({ state: st.state === "never" ? "failed" : st.state, lastOk: st.lastOk, lastTry: st.lastTry, error: st.error }),
    };
  }

  /* ---------- SPC Mesoscale Discussions ---------- */
  /* list page: {state: "empty" | "list" | "unrecognized", numbers, updated} */
  function parseMDList(html) {
    if (typeof html !== "string" || !/Current Mesoscale Discussions/i.test(html)) return { state: "unrecognized", numbers: [] };
    const upd = /Updated:(?:&nbsp;|\s)+([A-Z][a-z]{2} [A-Z][a-z]{2} +\d+ \d\d:\d\d:\d\d UTC \d{4})/.exec(html);
    const mapBlock = /<map name="mdimgmap">([\s\S]*?)<\/map>/i.exec(html);
    const numbers = mapBlock ? [...new Set([...mapBlock[1].matchAll(/md(\d{4})\.html/gi)].map((m) => +m[1]))] : [];
    if (numbers.length) return { state: "list", numbers, updated: upd ? upd[1] : null };
    if (/No Mesoscale Discussions are currently in effect/i.test(html)) return { state: "empty", numbers: [], updated: upd ? upd[1] : null };
    return { state: "unrecognized", numbers: [] };
  }
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  /* LAT...LON 8-digit pairs: 37301946 -> 37.30N, 119.46W (a longitude field under 50 is past 100 degrees) */
  function parseLatLon(text) {
    const m = /LAT\.\.\.LON((?:\s+\d{8})+)/.exec(text); if (!m) return null;
    const pts = m[1].trim().split(/\s+/).map((s) => { const lat = +s.slice(0, 4) / 100; let lon = +s.slice(4) / 100; if (lon < 50) lon += 100; return [-Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]; });
    if (pts.length < 3) return null;
    const a = pts[0], b = pts[pts.length - 1]; if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a);
    return { type: "Polygon", coordinates: [pts] };
  }
  function parseMD(htmlOrText, number) {
    const pre = /<pre>([\s\S]*?)<\/pre>/i.exec(htmlOrText);
    const text = (pre ? pre[1] : htmlOrText).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<");
    const n = /Mesoscale Discussion (\d+)/.exec(text), when = /(\d{3,4}) (AM|PM) ([A-Z]{3}) [A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/.exec(text);
    const valid = /Valid (\d{2})(\d{2})(\d{2})Z - (\d{2})(\d{2})(\d{2})Z/.exec(text), geometry = parseLatLon(text);
    if (!n || !valid || !when || !geometry) throw Error("unrecognized MD text" + (number ? " (MD " + number + ")" : ""));
    const year = +when[6], month = MONTHS[when[4]], issueDay = +when[5];
    const at = (d, h, mi) => { let mo = month, y = year; if (d < issueDay - 15) { mo++; if (mo > 11) { mo = 0; y++; } } return new Date(Date.UTC(y, mo, d, h, mi)).toISOString(); };
    const field = (re) => { const m = re.exec(text); return m ? m[1].replace(/\s+/g, " ").trim() : ""; };
    const concerning = field(/Concerning\.\.\.(.+?)\n\s*\n/s) || field(/Concerning\.\.\.([^\n]+)/);
    const summary = field(/SUMMARY\.\.\.(.+?)\n\s*\n/s);
    return { id: "spc-md-" + n[1], kind: "md", family: "severe", sourceId: "spc-md", event: "Mesoscale Discussion", title: "Mesoscale Discussion (MD) " + n[1], number: +n[1],
      headline: summary, hazard: "Concerning " + concerning.replace(/\.\.\./g, " · ").toLowerCase(), concerning,
      area: field(/Areas affected\.\.\.([^\n]+)/), office: "NWS Storm Prediction Center",
      issued: at(+valid[1], +valid[2], +valid[3]), updated: at(+valid[1], +valid[2], +valid[3]), validStart: at(+valid[1], +valid[2], +valid[3]), expires: at(+valid[4], +valid[5], +valid[6]),
      geometry, label: labelPoint(geometry), source: { name: "SPC Mesoscale Discussions", url: MD_URL(n[1]) }, bulletin: text.trim(),
      severe: !/winter|snow|freezing|heavy rain|blizzard|ice/i.test(concerning) || /watch|severe|tornado/i.test(concerning) };
  }
  /* NOAA map service: the known "NoArea" placeholder means none */
  function parseMDService(gj) {
    if (!gj || !Array.isArray(gj.features)) return { state: "unrecognized", features: [] };
    const real = gj.features.filter((f) => !(f.properties && /^NoArea$/i.test(f.properties.name || "")));
    if (!real.length) return { state: "empty", features: [], placeholder: gj.features.length > 0 };
    if (real.some((f) => !f.geometry || !T.polygonsOf(f.geometry).length)) return { state: "unrecognized", features: [] };
    return { state: "list", features: real };
  }
  /* MD products from the map service alone (used only when SPC's text pages are not reachable). The service's fields
     while an MD is active have not been seen; anything not found is left unavailable, never guessed. */
  function mdFromService(f, now) {
    const P = f.properties || {}, text = [P.name, P.popupinfo, P.folderpath].filter(Boolean).join(" ");
    const num = /(?:MD|MCD|Discussion)\D{0,3}(\d{3,4})/i.exec(text) || /\b(\d{4})\b/.exec(P.name || "");
    const valid = /Valid (\d{2})(\d{2})(\d{2})Z\s*-\s*(\d{2})(\d{2})(\d{2})Z/.exec(text);
    let start = null, end = null;
    if (valid) { const d = new Date(now), y = d.getUTCFullYear(), mo = d.getUTCMonth(), at = (dd, h, mi) => { let t = Date.UTC(y, mo, dd, h, mi); if (t - now > 15 * 86400e3) t = Date.UTC(y, mo - 1, dd, h, mi); return new Date(t).toISOString(); }; start = at(+valid[1], +valid[2], +valid[3]); end = at(+valid[4], +valid[5], +valid[6]); }
    const n = num ? +num[1] : null;
    return { id: "spc-md-svc-" + (n || P.objectid || f.id), kind: "md", family: "severe", sourceId: "spc-md", event: "Mesoscale Discussion", title: "Mesoscale Discussion (MD)" + (n ? " " + n : ""), number: n,
      headline: "", hazard: "", area: "Unavailable from the map service", office: "NWS Storm Prediction Center", issued: start, updated: start, validStart: start, expires: end, validUnknown: !valid,
      geometry: f.geometry, label: labelPoint(f.geometry), detailsUnavailable: true, viaService: true,
      source: { name: "NOAA map service (SPC MDs)", url: n ? MD_URL(n) : MD_LIST_URL }, bulletin: "", severe: !/winter|snow|freezing|blizzard/i.test(text) };
  }

  /* ---------- NOAA river gauges (National Water Prediction Service): observed and forecast stage and flood category ----------
     Categories: no_flooding, action, minor, moderate, major. "not_defined" (no flood stages set), "obs_not_current",
     "fcst_not_current" and "out_of_service" are reported as such, never as no flooding. -999 means no value. */
  const GAUGES_URL = (b) => "https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=" + b[0] + "&bbox.ymin=" + b[1] + "&bbox.xmax=" + b[2] + "&bbox.ymax=" + b[3] + "&srid=EPSG_4326";
  const GAUGE_CATS = ["no_flooding", "action", "minor", "moderate", "major"];
  const GAUGE_WORD = { no_flooding: "Below flood stage", action: "Action stage", minor: "Minor flooding", moderate: "Moderate flooding", major: "Major flooding", not_defined: "No flood stages defined", obs_not_current: "Observation not current", fcst_not_current: "No current forecast", out_of_service: "Out of service" };
  function parseGauges(j) {
    const list = Array.isArray(j) ? j : j && Array.isArray(j.gauges) ? j.gauges : null; if (!list) throw Error("unrecognized NWPS gauge answer");
    const part = (x) => !x ? null : { value: x.primary === -999 || x.primary == null ? null : +x.primary, unit: x.primaryUnit || "", flow: x.secondary === -999 || x.secondary == null ? null : +x.secondary, flowUnit: x.secondaryUnit || "", category: x.floodCategory || "not_defined", time: x.validTime && !/^0001/.test(x.validTime) ? new Date(x.validTime).toISOString() : null };
    return list.filter((g) => g && g.lid && isFinite(+g.latitude) && isFinite(+g.longitude)).map((g) => {
      const obs = part(g.status && g.status.observed), fcst = part(g.status && g.status.forecast), rank = (c) => GAUGE_CATS.indexOf(c);
      const worst = [obs, fcst].filter((x) => x && rank(x.category) >= 0).sort((a, b) => rank(b.category) - rank(a.category))[0] || null;
      return { id: "gauge-" + g.lid, kind: "gauge", family: "flood", sourceId: "nwps", lid: g.lid, name: g.name, wfo: g.wfo && g.wfo.abbreviation, state: g.state && g.state.abbreviation, point: [+g.longitude, +g.latitude], geometry: null, label: [+g.longitude, +g.latitude],
        obs, fcst, category: worst ? worst.category : (obs && obs.category) || "not_defined", rank: worst ? rank(worst.category) : -1, title: g.name, event: "River gauge",
        source: { name: "NOAA National Water Prediction Service", url: "https://water.noaa.gov/gauges/" + String(g.lid).toLowerCase() } };
    });
  }

  /* ---------- SPC Days 4-8 severe probability (any severe, within 25 miles): 15% or 30% areas, or a statement for the day ----------
     With no area, SPC's one feature says why: "Potential Too Low" (no area expected: quiet) or "Predictability Too Low" (SPC
     can't say yet: unknown, never quiet). */
  const DAY48_URL = (d) => "https://www.spc.noaa.gov/products/exper/day4-8/day" + d + "prob.nolyr.geojson";
  function parseDay48(gj, day) {
    if (!gj || !Array.isArray(gj.features) || !gj.features.length) throw Error("unrecognized SPC Day 4-8 answer");
    const P0 = gj.features[0].properties || {}, start = P0.VALID_ISO ? new Date(P0.VALID_ISO).toISOString() : null, end = P0.EXPIRE_ISO ? new Date(P0.EXPIRE_ISO).toISOString() : null;
    const issued = P0.ISSUE_ISO ? new Date(P0.ISSUE_ISO).toISOString() : P0.ISSUE ? new Date(Date.UTC(+P0.ISSUE.slice(0, 4), +P0.ISSUE.slice(4, 6) - 1, +P0.ISSUE.slice(6, 8), +P0.ISSUE.slice(8, 10), +P0.ISSUE.slice(10, 12))).toISOString() : null;
    if (!start || !end) throw Error("SPC Day 4-8 valid times missing");
    const products = gj.features.filter((f) => +(f.properties || {}).DN > 0 && f.geometry && /Polygon/.test(f.geometry.type)).map((f) => ({ id: "spc-d" + day + "-" + f.properties.DN + "-" + start, kind: "outlook", program: "spc48", family: "severe", day, prob: +f.properties.DN,
      category: f.properties.DN + "%", geometry: f.geometry, validStart: start, validEnd: end, issued, title: "Day " + day + " severe probability " + f.properties.DN + "%", source: { name: "SPC Day 4-8 outlook", url: "https://www.spc.noaa.gov/products/exper/day4-8/" } }));
    const label = String(P0.LABEL || "");
    return { day, products, validStart: start, validEnd: end, issued, status: products.length ? "areas" : /predictability/i.test(label) ? "predictability-too-low" : /potential/i.test(label) ? "potential-too-low" : "none", label };
  }

  /* ---------- SPC storm reports (preliminary, filtered): tornado, wind and hail reports for a convective day (12Z to 12Z) ----------
     One CSV with three sections, each led by its own header (Time,F_Scale / Time,Speed / Time,Size,...). Time is HHMM UTC: from
     1200 it is on the day's date, before 1200 on the next. Speed in mph, Size in hundredths of an inch, "UNK" when not given.
     Comments are not quoted and may hold commas: the first seven fields, then the rest of the line. */
  const REPORTS_URL = (which) => "https://www.spc.noaa.gov/climo/reports/" + which + "_filtered.csv"; // which: today | yesterday | YYMMDD_rpts
  function parseStormReports(csv, dayIso) {
    if (typeof csv !== "string" || !/^Time,/.test(csv.trim())) throw Error("unrecognized SPC storm report file");
    const d0 = Date.parse(dayIso.slice(0, 10) + "T00:00:00Z"); if (!isFinite(d0)) throw Error("bad report day");
    const out = []; let type = null;
    for (const line of csv.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const h = /^Time,(F_Scale|Speed|Size),/.exec(line); if (h) { type = { F_Scale: "tornado", Speed: "wind", Size: "hail" }[h[1]]; continue; }
      if (!type) throw Error("storm report before a section header");
      const f = line.split(","), [tm, mag, loc, county, st, la, lo] = f, comments = f.slice(7).join(",").trim();
      const lat = +la, lon = +lo, hh = +String(tm).slice(0, 2), mm = +String(tm).slice(2, 4);
      if (!/^\d{4}$/.test(tm) || !isFinite(lat) || !isFinite(lon) || hh > 23 || mm > 59) continue; // a malformed line is skipped, never guessed
      const t = new Date(d0 + (hh < 12 ? 864e5 : 0) + hh * 3600e3 + mm * 60e3).toISOString();
      const m = mag === "UNK" || mag === "" ? null : type === "hail" ? +mag / 100 : type === "wind" ? +mag : mag;
      const magText = type === "tornado" ? (m ? m : "rating not given") : type === "hail" ? (m ? m.toFixed(2) + " in" : "size not given") : (m ? m + " mph" : "speed not given");
      const office = (/\(([A-Z]{3})\)\s*$/.exec(comments) || [])[1] || null;
      out.push({ id: "lsr-" + type + "-" + t + "-" + lat + "," + lon, kind: "lsr", family: "severe", sourceId: "spc-reports", program: "spc-reports", type, magnitude: m, magText,
        event: { tornado: "Tornado report", wind: "Wind damage report", hail: "Hail report" }[type], title: { tornado: "Tornado", wind: "Wind damage", hail: "Hail" }[type] + (type === "tornado" ? "" : " · " + magText) + " · " + loc + ", " + st,
        observed: t, issued: t, location: loc, county, state: st, comments, office, point: [lon, lat], geometry: null, label: [lon, lat],
        source: { name: "SPC storm reports (preliminary)", url: "https://www.spc.noaa.gov/climo/reports/" } });
    }
    return out;
  }

  /* ---------- the venue's next hours: the NWS forecast grid (api.weather.gov /gridpoints) ----------
     Each element is a list of { validTime: "start/ISO-duration", value } in its own unit (uom). Hourly rows from the current
     hour: wind and gusts in mph, temperature, heat index and feels-like in °F, rain chance in %. A missing value stays null
     (heat index is only forecast when warm), never zero. */
  const RADAR_SVC = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer";
  const RADAR_TIME_URL = RADAR_SVC + "/2/query?where=" + encodeURIComponent("name LIKE 'CONUS%'") + "&outFields=name,idp_validtime&returnGeometry=false&f=json";
  const RADAR_TILE_URL = RADAR_SVC + "/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image";
  function parseRadarTime(j) {
    const f = j && Array.isArray(j.features) ? j.features.map((x) => x.attributes || {}).filter((a) => /^CONUS/.test(a.name || "") && a.idp_validtime) : null;
    if (!f) throw Error("unrecognized radar answer"); if (!f.length) throw Error("no CONUS radar image listed");
    return new Date(Math.max(...f.map((a) => +a.idp_validtime))).toISOString();
  }
  const durMs = (d) => { const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d || ""); return m ? ((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600e3 + (+m[3] || 0) * 60e3 : 0; };
  const CONV = { "wmoUnit:km_h-1": (v) => v * 0.621371, "wmoUnit:m_s-1": (v) => v * 2.23694, "wmoUnit:degC": (v) => v * 9 / 5 + 32, "wmoUnit:degF": (v) => v, "wmoUnit:percent": (v) => v };
  function gridSeries(el) {
    if (!el || !Array.isArray(el.values)) return null; const cv = CONV[el.uom] || ((v) => v);
    return el.values.map((x) => { const [s, d] = String(x.validTime).split("/"), t0 = Date.parse(s); return { t0, t1: t0 + durMs(d), v: x.value == null ? null : cv(x.value) }; }).filter((x) => isFinite(x.t0) && x.t1 > x.t0);
  }
  function parseGrid(gj, nowMs, hours = 12) {
    const P = gj && gj.properties; if (!P || !P.updateTime || !P.windGust) throw Error("unrecognized NWS forecast grid");
    const el = { gust: gridSeries(P.windGust), wind: gridSeries(P.windSpeed), temp: gridSeries(P.temperature), heat: gridSeries(P.heatIndex), feels: gridSeries(P.apparentTemperature), pop: gridSeries(P.probabilityOfPrecipitation) };
    const at = (k, t) => { const l = el[k]; if (!l) return null; const x = l.find((y) => t >= y.t0 && t < y.t1); return x && x.v != null ? Math.round(x.v) : null; };
    const h0 = Math.floor(nowMs / 3600e3) * 3600e3, rows = [];
    for (let i = 0; i < hours; i++) { const t = h0 + i * 3600e3; rows.push({ t: new Date(t).toISOString(), gust: at("gust", t), wind: at("wind", t), temp: at("temp", t), heat: at("heat", t), feels: at("feels", t), pop: at("pop", t) }); }
    const peak = (k) => rows.reduce((b, r) => (r[k] != null && (!b || r[k] > b[k]) ? r : b), null);
    const covered = rows.filter((r) => r.gust != null || r.temp != null).length;
    return { updated: new Date(P.updateTime).toISOString(), rows, covered, peakGust: peak("gust"), peakHeat: peak("heat"), peakFeels: peak("feels"), peakPop: peak("pop"), lowFeels: rows.reduce((b, r) => (r.feels != null && (!b || r.feels < b.feels) ? r : b), null) };
  }

  return { GAUGES_URL, GAUGE_CATS, GAUGE_WORD, parseGauges, DAY48_URL, parseDay48, REPORTS_URL, parseStormReports, RADAR_TIME_URL, RADAR_TILE_URL, parseRadarTime, parseGrid, EVENTS, ALERTS_URL, OUTLOOK_URL, MD_LIST_URL, MD_URL, MD_SERVICE_URL, parseVTEC, normalizeAlert, createAlertStore, resolveZones,
    parseOutlook, createOutlookStore, parseMDList, parseMD, parseLatLon, parseMDService, mdFromService, parseUGC, wouToAlert, labelPoint, mergeGeometries, dissolve, zoneShape,
    HAZARD, WINTER_EVENTS, FIRE_EVENTS, TROPICAL_EVENTS, COASTAL_EVENTS, EVENT_NAME, tcvToAlerts, pointZones, NAQFC_ENABLED, AWC_URL, FLT_ORDER, fltCat, parseMETAR, parseTAF, NHC_URL, NHC_WSP_AT, parseNHC, parseNHCWsp, TCWW, FIRE_CATS, DRYT_CATS, FIRE38_CATS, FIRE_NAME, FIRE_MEANING, SPC_FIRE_URL, parseFireOutlook, createFireStore,
    NIFC_INC_URL, NIFC_PER_URL, INCIDENT_TYPE, parseNIFC, zTime,
    HMS_DENSITY, HMS_URL, parseHMS, AQI_CATS, AQI_CAT_ORDER, aqiCat, AIRNOW_MON_URL, AIRNOW_MON_ALL_URL, parseAirNowMonitors, parseReportingArea, aqForecastProducts, AIRNOW_AREA_AT, NAQFC_SMOKE_AT, parseNAQFC, WSSI_LEVELS, WSSI_NAME, WSSI_MEANING, WSSIP_URL, parseWSSIP, combineWSSI, ERO_CATS, ERO_NAME, ERO_PCT, WPC_ERO_URL, MAPSVC_ERO_URL, parseERO, createEROStore, SOURCES, covers };
});
