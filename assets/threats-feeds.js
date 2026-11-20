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

  const EVENTS = ["Tornado Warning", "Severe Thunderstorm Warning", "Tornado Watch", "Severe Thunderstorm Watch"];
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
  const KIND = { W: "warning", A: "watch" };
  function vtecFor(props) {
    const all = (props.parameters && props.parameters.VTEC || []).map(parseVTEC).filter(Boolean);
    const want = /tornado/i.test(props.event) ? "TO" : "SV";
    return all.find((v) => v.phen === want && KIND[v.sig]) || all[0] || null;
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
    const title = kind === "watch" ? p.event + " " + Number(v.etn) : p.event;
    return {
      id: keyOf(v, p.sent), messageId: p.id, kind, event: p.event, title, action: v.action, vtec: v,
      headline: plainHeadline(p), hazard: hazardText(p), area: p.areaDesc || "", office: p.senderName || "NWS",
      issued: iso(p.onset || p.effective || p.sent), sent: iso(p.sent), updated: iso(p.sent), expires: iso(ends), messageExpires: iso(p.expires),
      geometry: f.geometry || null, geometrySource: f.geometry ? "polygon" : "counties", zones: p.affectedZones || [], ugc: (p.geocode || {}).UGC || [],
      references: (p.references || []).map((r) => ({ id: r.identifier, url: r["@id"], sent: iso(r.sent) })),
      source: { name: "NWS alerts (api.weather.gov)", url: p["@id"] || "https://api.weather.gov/alerts/" + encodeURIComponent(p.id || "") },
      bulletin: [p.headline, p.description, p.instruction ? "PRECAUTIONARY/PREPAREDNESS ACTIONS...\n" + p.instruction : ""].filter(Boolean).join("\n\n"),
      label: f.geometry ? labelPoint(f.geometry) : null, messageType: p.messageType,
    };
  }

  /* ---------- NWS alert store ---------- */
  function createAlertStore() {
    const byKey = new Map(), seen = new Set();
    const st = { lastOk: null, lastTry: null, lastError: null, state: "never", ignored: [] };
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
      byKey.set(msg.id, { ...msg, previous: prev || null, ended: null, endedBy: null, zoneState: cur && !msg.geometry ? cur.zoneState : null, firstSeen: cur ? cur.firstSeen : msg.sent });
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
      const msgs = parsed.filter(Boolean).sort((a, b) => Date.parse(a.sent) - Date.parse(b.sent));
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
  function zoneShape(urls, results) {
    const ok = results.filter(Boolean), kinds = urls.map((u) => (/\/zones\/county\//.test(u) ? "county" : "marine"));
    const tally = (k, only) => urls.filter((u, i) => kinds[i] === k && (!only || results[i])).length;
    // one outline only when every listed zone is drawn; with gaps, the zones stay as they are so the gaps show
    const complete = ok.length === urls.length && urls.length > 0, merged = complete ? dissolve(ok) : null;
    return { geometry: merged || mergeGeometries(ok), dissolved: !!merged, incomplete: !complete, resolved: ok.length, listed: urls.length,
      counties: { listed: tally("county"), drawn: tally("county", true) }, marine: { listed: tally("marine"), drawn: tally("marine", true) } };
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

  /* ---------- SPC outlooks ---------- */
  const CATS = ["TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];
  function parseOutlook(gj, day) {
    if (!gj || !Array.isArray(gj.features)) throw Error("unrecognized outlook response");
    const out = [];
    for (const f of gj.features) {
      const p = f.properties || {}, cat = p.LABEL;
      if (!CATS.includes(cat) || !f.geometry) continue;
      out.push({ id: "spc-d" + day + "-" + cat + "-" + p.ISSUE, kind: "outlook", day, category: cat, event: "Day " + day + " Convective Outlook", title: "Day " + day + " outlook",
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
    return { id: "spc-md-" + n[1], kind: "md", event: "Mesoscale Discussion", title: "Mesoscale Discussion (MD) " + n[1], number: +n[1],
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
    return { id: "spc-md-svc-" + (n || P.objectid || f.id), kind: "md", event: "Mesoscale Discussion", title: "Mesoscale Discussion (MD)" + (n ? " " + n : ""), number: n,
      headline: "", hazard: "", area: "Unavailable from the map service", office: "NWS Storm Prediction Center", issued: start, updated: start, validStart: start, expires: end, validUnknown: !valid,
      geometry: f.geometry, label: labelPoint(f.geometry), detailsUnavailable: true, viaService: true,
      source: { name: "NOAA map service (SPC MDs)", url: n ? MD_URL(n) : MD_LIST_URL }, bulletin: "", severe: !/winter|snow|freezing|blizzard/i.test(text) };
  }

  return { EVENTS, ALERTS_URL, OUTLOOK_URL, MD_LIST_URL, MD_URL, MD_SERVICE_URL, parseVTEC, normalizeAlert, createAlertStore, resolveZones,
    parseOutlook, createOutlookStore, parseMDList, parseMD, parseLatLon, parseMDService, mdFromService, parseUGC, wouToAlert, labelPoint, mergeGeometries, dissolve, zoneShape };
});
