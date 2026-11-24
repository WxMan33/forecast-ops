/* Weather threats live adapters: NWS warning lifecycle, county-only coverage, SPC outlooks and MDs.
   Real captured responses live in tests/fixtures/threats/ (fetched 2026-11-19/20). Lifecycle sequences are
   synthetic messages cloned from the real NWS message shape; watch handling is fixture-tested only.
   Run: node tests/threats-feeds.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const T = require("../assets/threats-core.js"), F = require("../assets/threats-feeds.js");
const FX = (f) => path.join(__dirname, "fixtures", "threats", f);
let n = 0; const ok = (name, fn) => { const r = fn(); if (r && r.then) return r.then(() => { n++; console.log("ok -", name); }); n++; console.log("ok -", name); };

const real = JSON.parse(fs.readFileSync(FX("nws-svr-tor-warnings-20261119.json"), "utf8"));
const template = real.features.find((f) => f.properties.messageType === "Alert");
const VENUE = { name: "TQL Stadium", lat: 39.1111, lon: -84.5223 };
const poly = (...p) => ({ type: "Polygon", coordinates: [[...p, p[0]]] });
const BIG = poly([-84.86, 38.98], [-84.68, 38.92], [-84.30, 39.20], [-84.42, 39.31]);      // covers the venue
const SHRUNK = poly([-84.50, 39.17], [-84.40, 39.12], [-84.28, 39.22], [-84.38, 39.30]);   // moved northeast, off the venue
const vt = (action, end, etn = "0071", phen = "TO", sig = "W") => `/O.${action}.KILN.${phen}.${sig}.${etn}.261120T2031Z-${end}/`;
let seq = 0;
function msg({ action = "NEW", sent, ends, geometry = BIG, event = "Tornado Warning", etn, phen, sig, mt, id, zones }) {
  const f = JSON.parse(JSON.stringify(template));
  const p = f.properties;
  p.id = id || "urn:test:" + (++seq); p["@id"] = "https://api.weather.gov/alerts/" + p.id;
  p.event = event; p.sent = p.effective = p.onset = sent; p.expires = p.ends = ends; p.senderName = "NWS Wilmington OH";
  p.messageType = mt || (action === "NEW" ? "Alert" : action === "CAN" ? "Cancel" : "Update");
  const z = ends.replace(/[-:]/g, "").slice(2, 13).replace(/(\d{6})T(\d{4})/, "$1T$2") + "Z";
  p.parameters = { ...p.parameters, VTEC: [vt(action, z.slice(0, 11) + "Z", etn, phen, sig)], eventEndingTime: [ends] };
  p.affectedZones = zones || ["https://api.weather.gov/zones/county/OHC061"];
  f.geometry = geometry;
  return f;
}
const coll = (...features) => ({ type: "FeatureCollection", features });
const at = (s) => Date.parse(s);

ok("VTEC parse (real message) and product key", () => {
  const v = F.parseVTEC("/O.EXP.KHNX.SV.W.0018.000000T0000Z-261119T2230Z/");
  assert.deepStrictEqual([v.action, v.office, v.phen, v.sig, v.etn, v.begin, v.end], ["EXP", "KHNX", "SV", "W", "0018", null, "2026-11-19T22:30:00Z"]);
  const p = F.normalizeAlert(real.features.find((f) => f.properties.messageType === "Cancel"));
  assert.strictEqual(p.action, "CAN"); assert.match(p.id, /^KHNX\.SV\.W\.\d{4}\.2026$/);
});
ok("real sample: every message normalizes; all warnings have polygons; updates reference earlier messages", () => {
  const all = real.features.map(F.normalizeAlert);
  assert.ok(all.every(Boolean)); assert.ok(all.every((p) => p.geometry && p.kind === "warning"));
  assert.ok(all.filter((p) => p.messageType !== "Alert").every((p) => p.references.length >= 1));
});
ok("new issuance -> active, covers the venue", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  const [p] = s.products(at("2026-11-20T20:33:00Z"));
  assert.strictEqual(p.status, "active"); assert.strictEqual(p.id, "KILN.TO.W.0071.2026"); assert.strictEqual(T.relation(p, VENUE).kind, "covers");
});
ok("update shrinks the polygon away from the venue -> near, with What changed", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  s.ingest(coll(msg({ action: "CON", sent: "2026-11-20T20:52:00Z", ends: "2026-11-20T21:15:00Z", geometry: SHRUNK })), "2026-11-20T20:53:00Z");
  const [p] = s.products(at("2026-11-20T20:54:00Z"));
  assert.strictEqual(p.status, "active"); assert.strictEqual(T.relation(p, VENUE).kind, "near");
  const c = T.changes(p, (x) => x);
  assert.ok(c.lines.some((l) => /Area reduced/.test(l)) && c.lines.some((l) => /Expiration unchanged/.test(l)));
});
ok("extension -> later end time, reported as extended", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  s.ingest(coll(msg({ action: "EXT", sent: "2026-11-20T21:05:00Z", ends: "2026-11-20T21:45:00Z" })), "2026-11-20T21:06:00Z");
  const [p] = s.products(at("2026-11-20T21:20:00Z"));
  assert.strictEqual(p.status, "active"); assert.strictEqual(p.expires, "2026-11-20T21:45:00.000Z");
  assert.ok(T.changes(p, (x) => x).lines.some((l) => /extended/.test(l)));
});
ok("cancellation -> ended, cancelled (confirmed by the source)", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  s.ingest(coll(msg({ action: "CAN", sent: "2026-11-20T20:58:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:59:00Z");
  const [p] = s.products(at("2026-11-20T21:00:00Z"));
  assert.strictEqual(p.status, "ended"); assert.strictEqual(p.endedBy, "cancelled"); assert.ok(p.endedConfirmed);
});
ok("duplicate and out-of-order messages are ignored", () => {
  const s = F.createAlertStore();
  const a = msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z", id: "urn:A" });
  const b = msg({ action: "CON", sent: "2026-11-20T20:52:00Z", ends: "2026-11-20T21:15:00Z", geometry: SHRUNK, id: "urn:B" });
  s.ingest(coll(b), "2026-11-20T20:53:00Z");                // newer arrives first
  s.ingest(coll(a, b, b), "2026-11-20T20:54:00Z");          // older one late, plus duplicates
  const [p] = s.products(at("2026-11-20T20:55:00Z"));
  assert.strictEqual(p.messageId, "urn:B"); assert.strictEqual(T.relation(p, VENUE).kind, "near");
  assert.ok(s._st.ignored.some((x) => x.why === "duplicate") && s._st.ignored.some((x) => /older/.test(x.why)));
});
ok("two segments of one statement (CAN some counties, CON the rest): continuing part stays active", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  s.ingest(coll(msg({ action: "CAN", sent: "2026-11-20T20:52:00Z", ends: "2026-11-20T21:15:00Z", geometry: null }), msg({ action: "CON", sent: "2026-11-20T20:52:00Z", ends: "2026-11-20T21:15:00Z", geometry: SHRUNK })), "2026-11-20T20:53:00Z");
  const [p] = s.products(at("2026-11-20T20:54:00Z"));
  assert.strictEqual(p.status, "active"); assert.strictEqual(p.action, "CON");
});
ok("expiration during a failed refresh -> lapsed (not cancelled); recovery confirms the end", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:41:00Z");
  s.fail("2026-11-20T21:00:00Z", "HTTP 503");
  assert.strictEqual(s.products(at("2026-11-20T21:05:00Z"))[0].status, "active");  // last known, before its end
  assert.strictEqual(s.sourceInfo().state, "failed"); assert.strictEqual(s.sourceInfo().lastOk, "2026-11-20T20:41:00Z");
  s.fail("2026-11-20T21:20:00Z", "timeout");
  const lapsed = s.products(at("2026-11-20T21:20:00Z"))[0];
  assert.strictEqual(lapsed.status, "lapsed"); assert.strictEqual(lapsed.endedBy, null);
  assert.ok(T.expiredUnconfirmed(lapsed, { state: "failed", lastOk: "2026-11-20T20:41:00Z" }, at("2026-11-20T21:20:00Z")));
  s.ingest(coll(), "2026-11-20T21:22:00Z");                 // source back, product not listed
  assert.strictEqual(s.products(at("2026-11-20T21:22:00Z"))[0].status, "ended");
});
ok("a confirmed empty answer ends products it no longer lists", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  s.ingest(coll(), "2026-11-20T20:40:00Z");
  const [p] = s.products(at("2026-11-20T20:41:00Z"));
  assert.strictEqual(p.status, "ended"); assert.strictEqual(p.endedBy, "no longer listed");
  assert.strictEqual(s.sourceInfo().state, "ok");
});
ok("an answer older than the last confirmed check (stale cache) cannot end products or move the confirmation back", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:40:00Z");
  s.ingest(coll(), "2026-11-20T20:39:30Z");
  assert.strictEqual(s.products(at("2026-11-20T20:41:00Z"))[0].status, "active"); assert.strictEqual(s.sourceInfo().lastOk, "2026-11-20T20:40:00Z");
});
ok("unrecognized response counts as a failure, not as empty", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  s.ingest({ title: "Service unavailable" }, "2026-11-20T20:40:00Z");
  assert.strictEqual(s.sourceInfo().state, "failed"); assert.strictEqual(s.products(at("2026-11-20T20:41:00Z"))[0].status, "active");
});

/* ---------- ARCHIVED official payloads (not live observations) ---------- */
const arch = (f) => JSON.parse(fs.readFileSync(FX(f), "utf8")).features;
const SOFI = { name: "SoFi Stadium", lat: 33.9535, lon: -118.3392 }, LBCC = { name: "Long Beach Convention Center", lat: 33.7642, lon: -118.1893 };
ok("ARCHIVED NWS LOX severe thunderstorm warning 0015 (NEW, CON, CON): the last update moves the polygon off SoFi Stadium", () => {
  const ch = arch("nws-archive-klox-sv-w-0015.json"), s = F.createAlertStore(), seen = [];
  ch.forEach((f) => { const t = new Date(Date.parse(f.properties.sent) + 30e3).toISOString(); s.ingest(coll(f), t); const [p] = s.products(Date.parse(t)); seen.push([p.status, T.relation(p, SOFI).kind, T.relation(p, LBCC).kind]); });
  assert.deepStrictEqual(seen, [["active", "covers", "covers"], ["active", "covers", "covers"], ["active", "near", "covers"]]);
  const [p] = s.products(Date.parse("2026-11-19T17:38:00Z")), r = T.relation(p, SOFI);
  assert.strictEqual(p.id, "KLOX.SV.W.0015.2026"); assert.ok(r.km > 12 && r.km < 13, "7.7 mi: " + r.km);
  assert.match(T.relationText(r, p), /^8 miles southeast of the venue · the venue is outside the warning area$/);
  assert.ok(T.changes(p, (x) => x).lines.some((l) => /Area reduced by about 47%/.test(l)), JSON.stringify(T.changes(p, (x) => x)));
});
ok("ARCHIVED NWS MTR tornado warning 0003 (NEW, CON, CAN): ends as cancelled by the source", () => {
  const ch = arch("nws-archive-kmtr-to-w-0003.json"), s = F.createAlertStore();
  ch.forEach((f) => s.ingest(coll(f), new Date(Date.parse(f.properties.sent) + 30e3).toISOString()));
  const [p] = s.products(Date.parse("2026-11-16T21:23:00Z"));
  assert.strictEqual(p.status, "ended"); assert.strictEqual(p.endedBy, "cancelled"); assert.strictEqual(p.event, "Tornado Warning");
});
ok("ARCHIVED SPC Tornado Watch 705 (official WOU, converted to the alert shape): county-based, real county list", () => {
  const p = F.normalizeAlert(F.wouToAlert(fs.readFileSync(FX("spc-wou0705.txt"), "utf8")));
  assert.strictEqual(p.title, "Tornado Watch 705"); assert.strictEqual(p.id, "KWNS.TO.A.0705.2026"); assert.strictEqual(p.geometry, null);
  assert.strictEqual(p.zones.length, 23); assert.ok(p.zones.includes("https://api.weather.gov/zones/county/PAC101") && p.zones.includes("https://api.weather.gov/zones/forecast/ANZ430"));
  assert.strictEqual(p.issued, "2026-11-12T17:50:00.000Z"); assert.strictEqual(p.expires, "2026-11-13T00:00:00.000Z");
});
const watchCases = [ok("ARCHIVED Watch 705 + real Philadelphia county shape: Lincoln Financial Field covered; Trenton unknown while Mercer is unresolved", async () => {
  const p = F.normalizeAlert(F.wouToAlert(fs.readFileSync(FX("spc-wou0705.txt"), "utf8")));
  const phl = JSON.parse(fs.readFileSync(FX("nws-zone-PAC101.json"), "utf8")).geometry;
  const r = await F.resolveZones(p, (u) => /PAC101/.test(u) ? Promise.resolve(phl) : Promise.reject(Error("not fetched in this test")));
  const q = { ...p, geometry: r.geometry, geometryIncomplete: r.incomplete };
  assert.strictEqual(T.relation(q, { lat: 39.9008, lon: -75.1675 }).kind, "covers");
  assert.strictEqual(T.relation(q, { lat: 40.2207, lon: -74.7569 }).kind, "unknown");
})];

/* ---------- zone union (watch outline) ---------- */
const sq = (x, y, w = 1, h = 1) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
ok("zone union: shared edges drop out; separate areas and holes are kept", () => {
  const two = F.dissolve([{ type: "Polygon", coordinates: [sq(0, 0)] }, { type: "Polygon", coordinates: [sq(1, 0)] }]);
  assert.strictEqual(two.coordinates.length, 1); assert.strictEqual(two.coordinates[0].length, 1); assert.strictEqual(Math.round(T.areaKm2(two)), Math.round(T.areaKm2({ type: "Polygon", coordinates: [sq(0, 0, 2, 1)] })));
  const apart = F.dissolve([{ type: "Polygon", coordinates: [sq(0, 0)] }, { type: "Polygon", coordinates: [sq(5, 0)] }]);
  assert.strictEqual(apart.coordinates.length, 2);
  // a ring of 8 squares around an empty middle: the middle is a hole, not covered
  const ring = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) ring.push({ type: "Polygon", coordinates: [sq(i, j)] });
  const donut = F.dissolve(ring);
  assert.strictEqual(donut.coordinates.length, 1); assert.strictEqual(donut.coordinates[0].length, 2);
  assert.strictEqual(T.contains(donut, [1.5, 1.5]), false); assert.strictEqual(T.contains(donut, [0.5, 0.5]), true);
});
ok("zone shape: merged only when every listed zone is drawn; counties and marine zones counted separately", () => {
  const urls = ["https://api.weather.gov/zones/county/AAC001", "https://api.weather.gov/zones/county/AAC003", "https://api.weather.gov/zones/forecast/ANZ430"];
  const full = F.zoneShape(urls, [{ type: "Polygon", coordinates: [sq(0, 0)] }, { type: "Polygon", coordinates: [sq(1, 0)] }, { type: "Polygon", coordinates: [sq(2, 0)] }]);
  assert.ok(full.dissolved && !full.incomplete); assert.deepStrictEqual([full.counties, full.marine], [{ listed: 2, drawn: 2 }, { listed: 1, drawn: 1 }]); assert.strictEqual(full.geometry.coordinates.length, 1);
  const gap = F.zoneShape(urls, [{ type: "Polygon", coordinates: [sq(0, 0)] }, null, { type: "Polygon", coordinates: [sq(2, 0)] }]);
  assert.ok(!gap.dissolved && gap.incomplete); assert.deepStrictEqual(gap.counties, { listed: 2, drawn: 1 }); assert.strictEqual(gap.geometry.coordinates.length, 2);
  assert.strictEqual(T.relation({ geometry: gap.geometry, geometryIncomplete: true }, { lat: 0.5, lon: 1.5 }).kind, "unknown");
  assert.strictEqual(T.relation({ geometry: gap.geometry, geometryIncomplete: true }, { lat: 0.5, lon: 0.5 }).kind, "covers");
});

/* ---------- incomplete, failed or malformed answers never mean "none active" ---------- */
ok("a response with an unreadable severe message keeps the last known products and is not 'none active'", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  const broken = msg({ sent: "2026-11-20T20:40:00Z", ends: "2026-11-20T21:30:00Z", etn: "0072" }); broken.properties.parameters.VTEC = ["garbled"];
  s.ingest(coll(broken), "2026-11-20T20:41:00Z");
  assert.strictEqual(s.products(at("2026-11-20T20:42:00Z"))[0].status, "active");
  assert.strictEqual(s.sourceInfo().state, "failed"); assert.strictEqual(s.sourceInfo().lastOk, "2026-11-20T20:32:00Z");
});
ok("a paged (possibly partial) response or null entries do not end products", () => {
  const s = F.createAlertStore();
  s.ingest(coll(msg({ sent: "2026-11-20T20:31:00Z", ends: "2026-11-20T21:15:00Z" })), "2026-11-20T20:32:00Z");
  s.ingest({ type: "FeatureCollection", features: [], pagination: { next: "https://api.weather.gov/alerts?cursor=x" } }, "2026-11-20T20:40:00Z");
  assert.strictEqual(s.products(at("2026-11-20T20:41:00Z"))[0].status, "active"); assert.strictEqual(s.sourceInfo().state, "failed");
  s.ingest({ type: "FeatureCollection", features: [null] }, "2026-11-20T20:45:00Z");
  assert.strictEqual(s.products(at("2026-11-20T20:46:00Z"))[0].status, "active");
  s.ingest("<html>502 Bad Gateway</html>", "2026-11-20T20:50:00Z");
  assert.strictEqual(s.products(at("2026-11-20T20:51:00Z"))[0].status, "active");
});
ok("NOAA MD service (FIXTURE: active field contents never observed): geometry drawn, missing validity left unavailable", () => {
  const f = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-90, 35], [-88, 35], [-88, 37], [-90, 37], [-90, 35]]] }, properties: { objectid: 2, name: "MD 2459", popupinfo: null } };
  const r = F.parseMDService({ features: [f] }); assert.strictEqual(r.state, "list");
  const p = F.mdFromService(r.features[0], Date.parse("2026-11-20T20:00:00Z"));
  assert.strictEqual(p.number, 2459); assert.strictEqual(p.expires, null); assert.strictEqual(p.validUnknown, true); assert.strictEqual(p.source.url, F.MD_URL(2459));
  const q = F.mdFromService({ ...f, properties: { name: "x", popupinfo: "Valid 202022Z - 202215Z" } }, Date.parse("2026-11-20T21:00:00Z"));
  assert.strictEqual(q.expires, "2026-11-20T22:15:00.000Z"); assert.strictEqual(q.number, null); assert.strictEqual(q.source.url, F.MD_LIST_URL);
  assert.strictEqual(F.parseMDService({ features: [{ properties: { name: "MD 1" }, geometry: null }] }).state, "unrecognized");
});

/* ---------- watches and county-only coverage (FIXTURE-TESTED: no live watch sample yet) ---------- */
const zoneShape = JSON.parse(fs.readFileSync(FX("nws-zone-OHC061.json"), "utf8")).geometry;  // real Hamilton County OH shape
const watchFixture = () => msg({ event: "Tornado Watch", phen: "TO", sig: "A", etn: "0612", sent: "2026-11-20T18:55:00Z", ends: "2026-11-21T02:00:00Z", geometry: null,
  zones: ["https://api.weather.gov/zones/county/OHC061", "https://api.weather.gov/zones/county/KYC117"] });
ok("watch fixture: county-only, titled with its number", () => {
  const p = F.normalizeAlert(watchFixture());
  assert.strictEqual(p.kind, "watch"); assert.strictEqual(p.title, "Tornado Watch 612"); assert.strictEqual(p.geometry, null); assert.strictEqual(p.geometrySource, "counties");
  assert.strictEqual(T.relation(p, VENUE).kind, "unknown");
});
const resolvedCases = [
  ok("county shapes resolve -> drawn from counties; venue inside a resolved county is covered", async () => {
    const p = F.normalizeAlert(watchFixture());
    const r = await F.resolveZones(p, (u) => /OHC061/.test(u) ? Promise.resolve(zoneShape) : Promise.reject(Error("404")));
    assert.strictEqual(r.incomplete, true); assert.strictEqual(r.resolved, 1);
    const q = { ...p, geometry: r.geometry, geometryIncomplete: r.incomplete };
    assert.strictEqual(T.relation(q, VENUE).kind, "covers");
    // a venue outside the drawn county stays unknown while another listed county is unresolved
    const covington = { lat: 39.0837, lon: -84.5086 };  // Kenton County KY (KYC117, the unresolved one)
    const rel = T.relation(q, covington);
    assert.strictEqual(rel.kind, "unknown"); assert.match(T.relationText(rel, q), /could not be drawn/);
  }),
  ok("all counties resolved -> a normal inside/outside answer", async () => {
    const p = F.normalizeAlert(watchFixture());
    const r = await F.resolveZones(p, () => Promise.resolve(zoneShape));
    assert.strictEqual(r.incomplete, false);
    assert.strictEqual(T.relation({ ...p, geometry: r.geometry, geometryIncomplete: false }, { lat: 39.76, lon: -84.19 }).kind, "outside");
  }),
];

/* ---------- SPC outlooks (real Day 1 sample) ---------- */
const d1 = JSON.parse(fs.readFileSync(FX("spc-day1-cat-20261120.geojson"), "utf8"));
ok("SPC Day 1: categories, issue and valid times from the feed", () => {
  const o = F.parseOutlook(d1, 1);
  assert.deepStrictEqual(o.products.map((p) => p.category), ["TSTM", "MRGL"]);
  assert.strictEqual(o.issued, "2026-11-20T16:24:00.000Z"); assert.strictEqual(o.validStart, "2026-11-20T16:30:00.000Z"); assert.strictEqual(o.validEnd, "2026-11-21T12:00:00.000Z");
});
ok("SPC outlook rollover: past its valid end the old issuance is not drawn; a failed fetch keeps the last good one", () => {
  const s = F.createOutlookStore(1);
  s.ingest(d1, "2026-11-20T19:00:00Z");
  assert.strictEqual(s.current(at("2026-11-20T20:00:00Z")).status, "current");
  s.fail("2026-11-20T20:10:00Z", "HTTP 500");
  assert.strictEqual(s.current(at("2026-11-20T20:10:00Z")).products.length, 2); assert.strictEqual(s.sourceInfo().state, "failed");
  const late = s.current(at("2026-11-21T12:05:00Z"));
  assert.strictEqual(late.status, "expired"); assert.strictEqual(late.products.length, 0);
  s.ingest({ nope: 1 }, "2026-11-21T12:10:00Z"); assert.strictEqual(s.sourceInfo().state, "failed");
});

/* ---------- SPC MDs (real list page and MD text; active list is a fixture) ---------- */
const listEmpty = fs.readFileSync(FX("spc-md-list-empty-20261120.html"), "utf8");
ok("MD list: real 'none in effect' page is a confirmed empty (the 'most recent' link is not active)", () => {
  const r = F.parseMDList(listEmpty); assert.strictEqual(r.state, "empty"); assert.deepStrictEqual(r.numbers, []);
});
ok("MD list: active entries are read from the current-MD image map (FIXTURE: active markup not yet seen live)", () => {
  const html = listEmpty.replace('<map name="mdimgmap">\n </map>', '<map name="mdimgmap"><area shape="poly" coords="1,2,3" href="/products/md/md2459.html" title="MD 2459"></map>').replace(/<center>No Mesoscale[^<]*<\/center>/, "");
  const r = F.parseMDList(html); assert.strictEqual(r.state, "list"); assert.deepStrictEqual(r.numbers, [2459]);
});
ok("MD list: anything else is unrecognized, never empty", () => {
  assert.strictEqual(F.parseMDList("<html>maintenance</html>").state, "unrecognized");
  assert.strictEqual(F.parseMDList(null).state, "unrecognized");
});
ok("MD text: real MD 2458 -> valid window and polygon", () => {
  const p = F.parseMD(fs.readFileSync(FX("spc-md2458.html"), "utf8"), 2458);
  assert.strictEqual(p.number, 2458); assert.strictEqual(p.validStart, "2026-11-19T18:41:00.000Z"); assert.strictEqual(p.expires, "2026-11-19T21:45:00.000Z");
  assert.deepStrictEqual(p.geometry.coordinates[0][0], [-119.46, 37.3]); assert.match(p.area, /San Joaquin/); assert.ok(p.severe);
  assert.throws(() => F.parseMD("<pre>Mesoscale Discussion 1</pre>"), /unrecognized/);
});
ok("NOAA MD service: the real NoArea placeholder is empty; other shapes are unrecognized or listed", () => {
  const r = F.parseMDService(JSON.parse(fs.readFileSync(FX("noaa-md-service-noarea.json"), "utf8")));
  assert.strictEqual(r.state, "empty"); assert.strictEqual(r.placeholder, true);
  assert.strictEqual(F.parseMDService({ error: { code: 500 } }).state, "unrecognized");
});

/* ---------- FIRE adapters ---------- */
ok("SPC fire outlook: archived Day 2 bands parse to ELEV/CRIT/EXTM with SPC's times; 'No Areas' is a confirmed empty answer; unknown labels are rejected", () => {
  const j = (f) => JSON.parse(fs.readFileSync(FX(f), "utf8"));
  const o = F.parseFireOutlook(j("spc-fire-day2-20260731-2000-windrh.geojson"), 2, "windrh");
  assert.deepStrictEqual(o.products.map((p) => p.category), ["ELEV", "CRIT", "EXTM"]);
  assert.strictEqual(o.validStart, "2026-08-01T12:00:00.000Z"); assert.strictEqual(o.issued, "2026-07-31T20:02:00.000Z");
  const e = F.parseFireOutlook(j("spc-fire-day2-20260730-2000-dryt.geojson"), 2, "dryt"); assert.ok(e.empty); assert.strictEqual(e.phrase, "No Areas");
  const bad = j("spc-fire-day2-20260731-2000-windrh.geojson"); bad.features[0].properties.LABEL = "MDT";
  assert.throws(() => F.parseFireOutlook(bad, 2, "windrh"), /unrecognized SPC fire outlook category: MDT/);
  const prob = { type: "FeatureCollection", features: [{ type: "Feature", geometry: bad.features[1].geometry, properties: { LABEL: "0.40", VALID: "202608031200", EXPIRE: "202608041200", ISSUE: "202607312150" } }] };
  assert.deepStrictEqual(F.parseFireOutlook(prob, 3, "windrh").products.map((p) => [p.day, p.category]), [[3, "P40"]]);
});
ok("SPC fire store: an older issuance never replaces a newer one; a failure keeps the last good answer", () => {
  const j = (f) => JSON.parse(fs.readFileSync(FX(f), "utf8")), s = F.createFireStore(1, "windrh");
  s.ingest(j("spc-fire-day1-20260801-1700-windrh.geojson"), "2026-08-01T17:10:00Z"); s.ingest(j("spc-fire-day1-20260801-1200-windrh.geojson"), "2026-08-01T17:20:00Z");
  assert.strictEqual(s.current(Date.parse("2026-08-01T18:00:00Z")).issued, "2026-08-01T17:00:00.000Z");
  s.fail("2026-08-01T17:30:00Z", "HTTP 503"); assert.strictEqual(s.current(Date.parse("2026-08-01T18:00:00Z")).products.length, 3); assert.strictEqual(s.sourceInfo().state, "failed");
});
ok("NIFC: incidents joined to perimeters by IRWIN ID; declared-out records dropped; a truncated answer is an error", () => {
  const j = (f) => JSON.parse(fs.readFileSync(FX(f), "utf8")), inc = j("nifc-wfigs-20261121-incidents.geojson"), per = j("nifc-wfigs-20261121-perimeters.geojson");
  const all = F.parseNIFC(inc, per); assert.strictEqual(all.length, inc.features.length); assert.strictEqual(all.filter((p) => p.geometry).length, 57);
  const out = JSON.parse(JSON.stringify(inc)); out.features[0].properties.FireOutDateTime = 1795000000000; assert.strictEqual(F.parseNIFC(out, null).length, inc.features.length - 1);
  assert.throws(() => F.parseNIFC({ ...inc, properties: { exceededTransferLimit: true } }, per), /incomplete/);
  assert.throws(() => F.parseNIFC({ error: { code: 400 } }, per), /unrecognized/);
});
ok("NWS fire weather alerts: Red Flag Warning and Fire Weather Watch are fire-family products from fire weather zones", () => {
  const msgs = JSON.parse(fs.readFileSync(FX("nws-archive-kbou-fw-w-0057.json"), "utf8")).features, s = F.createAlertStore();
  s.ingest({ type: "FeatureCollection", features: msgs.slice(0, 1) }, "2026-11-17T19:47:00Z");
  const p = s.products(Date.parse("2026-11-17T20:00:00Z"))[0];
  assert.deepStrictEqual([p.family, p.kind, p.event, p.geometrySource, p.zones[0]], ["fire", "warning", "Red Flag Warning", "counties", "https://api.weather.gov/zones/fire/COZ216"]);
  assert.strictEqual(F.zoneShape(["https://api.weather.gov/zones/fire/COZ216"], [null]).fire.listed, 1);
});

/* ---------- SMOKE AND AIR QUALITY adapters ---------- */
ok("HMS: polygons with density, satellite and the satellite window (Julian day + UTC); non-KML or bad density is an error", () => {
  const ps = F.parseHMS(fs.readFileSync(FX("hms-smoke-20260716-east.kml"), "utf8"));
  assert.ok(ps.length > 0 && ps.every((p) => ["Light", "Medium", "Heavy"].includes(p.density) && /^2026-07-16T/.test(p.obsStart) && p.geometry));
  assert.throws(() => F.parseHMS("<html>busy</html>"), /unrecognized HMS/);
  assert.throws(() => F.parseHMS("<kml><Placemark><description>Start Time: 2026197 1200UTC<br>End Time: 2026197 1500UTC<br>Density: Thick</description><coordinates>0,0 1,0 1,1 0,0</coordinates></Placemark></kml>"), /unrecognized HMS smoke polygon/);
});
ok("AirNow reporting areas: forecast rows become one product per valid day (local midnight to midnight); hourly observations carry their UTC time", () => {
  const rows = F.parseReportingArea(fs.readFileSync(FX("airnow-ra-20260716.dat"), "utf8"));
  const o = rows.find((r) => r.area === "Chicago" && r.type === "O"); assert.strictEqual(o.observed, "2026-07-17T04:00:00.000Z"); assert.strictEqual(o.category, "Hazardous");
  const f = F.aqForecastProducts(rows.filter((r) => r.area === "Philadelphia"));
  assert.deepStrictEqual(f.slice(0, 2).map((p) => [p.validDate, p.validStart, p.category, p.aqi]), [["2026-07-16", "2026-07-16T04:00:00.000Z", "Unhealthy", 180], ["2026-07-17", "2026-07-17T04:00:00.000Z", "Very Unhealthy", 210]]);
  assert.throws(() => F.parseReportingArea("a|b|c"), /unrecognized AirNow reporting area row/);
});
ok("AirNow monitors: the highest pollutant AQI per site with its hour; inactive sites and sites without readings are skipped; truncated answers are errors", () => {
  const gj = JSON.parse(fs.readFileSync(FX("airnow-monitors-2026071622-chicago.geojson"), "utf8")), ps = F.parseAirNowMonitors(gj);
  assert.ok(ps.length > 5 && ps.every((p) => p.observed === "2026-07-16T22:00:00.000Z" && p.category === F.aqiCat(p.aqi)));
  assert.ok(ps.some((p) => p.category === "Hazardous" && p.pollutant === "PM2.5"));
  assert.throws(() => F.parseAirNowMonitors({ ...gj, properties: { exceededTransferLimit: true } }), /incomplete/);
});
ok("NAQFC smoke: samples from the latest model run, sorted by valid hour", () => {
  const s = (t, run, v) => ({ value: String(v), attributes: { idp_validtime: Date.parse(t), idp_issueddate: Date.parse(run), idp_fcst_hour: 1 } });
  const p = F.parseNAQFC({ samples: [s("2026-11-21T05:00:00Z", "2026-11-20T06:00:00Z", 2e-9), s("2026-11-21T04:00:00Z", "2026-11-20T12:00:00Z", 1e-9), s("2026-11-21T05:00:00Z", "2026-11-20T12:00:00Z", 3e-9)] }, [-104.99, 39.74]);
  assert.strictEqual(p.run, "2026-11-20T12:00:00.000Z"); assert.deepStrictEqual(p.hours.map((h) => h.v), [1, 3]); // service kg/m³ -> µg/m³
  assert.throws(() => F.parseNAQFC({ error: {} }, [0, 0]), /unrecognized NOAA smoke/);
});

ok("WSSI-P levels: a level that still fails is reported unavailable and the answered levels are kept; nothing is inferred; no level at all is an error", () => {
  const r = F.combineWSSI([[{ id: "a" }], [{ id: "b" }], [], [], { failed: "timeout" }]); assert.deepStrictEqual(r.unavailable, ["EXTREME"]); assert.deepStrictEqual(r.products.map((p) => p.id), ["a", "b"]);
  assert.deepStrictEqual(F.combineWSSI([[], [], { failed: "x" }, { failed: "y" }, []]).unavailable, ["MODERATE", "MAJOR"]);
  assert.throws(() => F.combineWSSI([1, 2, 3, 4, 5].map(() => ({ failed: "HTTP 504" }))), /no level answered/);
});

/* ---------- TROPICAL AND COASTAL adapters ---------- */
ok("TCV (archived NWS Mobile, Isaias): one alert per land-zone segment and VTEC line, open-ended, purge time as message expiry, wind window kept; marine zones left out", () => {
  const f = "202610071609-KMOB-WTUS84-TCVMOB", a = F.tcvToAlerts(fs.readFileSync(FX("tcv-kmob-al092026/" + f + ".txt"), "utf8"), f);
  assert.ok(a.length > 5 && a.every((x) => x.properties.geocode.UGC.every((u) => !/^GMZ/.test(u))));
  const p = a.find((x) => x.properties.geocode.UGC[0] === "ALZ266" && x.properties.event === "Hurricane Watch").properties;
  assert.deepStrictEqual([p.sent, p.ends, p.expires, p.areaDesc, p.messageType], ["2026-10-07T16:09:00.000Z", null, "2026-10-08T00:15:00.000Z", "Baldwin Coastal", "Alert"]);
  const n = F.normalizeAlert({ geometry: null, properties: p }); assert.deepStrictEqual([n.family, n.kind, n.openEnded, n.windWindow], ["tropical", "watch", true, "Friday afternoon until early Saturday morning"]);
  assert.throws(() => F.tcvToAlerts("not a product", f), /unrecognized TCV/);
});
ok("Coastal alerts: Rip Current Statement is a coastal 'statement'; Coastal Flood Warning keeps its real end time (not open-ended)", () => {
  const fsr = JSON.parse(fs.readFileSync(FX("nws-live-kjax-coastal-20261121.json"), "utf8")).features;
  const rp = F.normalizeAlert(fsr.find((x) => x.properties.event === "Rip Current Statement")), cf = F.normalizeAlert(fsr.find((x) => x.properties.event === "Coastal Flood Warning"));
  assert.deepStrictEqual([rp.family, rp.kind, cf.family, cf.kind, cf.openEnded, cf.expires], ["coastal", "statement", "coastal", "warning", false, "2026-11-23T10:00:00.000Z"]);
});
ok("NHC: advisory time from ADVDATE; outlook areas and wind probabilities in the live service's shape", () => {
  const two = F.parseNHC({ features: [{ geometry: { type: "Polygon", coordinates: [[[-60, 20], [-55, 20], [-55, 25], [-60, 20]]] }, properties: { basin: "Atlantic", prob2day: "10%", risk2day: "Low", prob7day: "10%", risk7day: "Low", idp_filedate: 1795283273000 } }] }, "two");
  assert.deepStrictEqual([two[0].kind, two[0].category, two[0].prob7], ["tcoutlook", "Low", "10%"]);
  const w = F.parseNHCWsp({ 34: { features: [{ attributes: { percentage: "20-30%", idp_filedate: 1795283273000 } }, { attributes: { percentage: "10-20%" } }] }, 50: { features: [] } }, [-87.56, 30.297]);
  assert.deepStrictEqual(w.map((x) => [x.kt, x.pct, x.band]), [[34, 20, "20-30%"]]); // 50 kt: no band at the venue
  assert.strictEqual(F.parseNHCWsp({ 64: { features: [{ attributes: { percentage: ">90%" } }] } }, [0, 0])[0].pct, 90);
  assert.throws(() => F.parseNHC({ error: {} }), /unrecognized NHC/);
});

ok("ERO: a quiet day's 'None Expected' placeholder (WPC Day 1, 2026-11-23) is confirmed none, with its issue and valid times", () => {
  const r = F.parseERO(JSON.parse(fs.readFileSync(FX("wpc-ero-day1-none-expected.json"), "utf8")), 1, "wpc");
  assert.strictEqual(r.products.length, 0); assert.strictEqual(r.empty, true);
  assert.strictEqual(r.issued, "2026-11-23T15:50:00.000Z"); assert.strictEqual(r.validStart, "2026-11-23T16:00:00.000Z"); assert.strictEqual(r.validEnd, "2026-11-24T12:00:00.000Z");
  assert.throws(() => F.parseERO({ features: [{ properties: { OUTLOOK: "Extreme" }, geometry: null }] }, 1, "wpc"), /unrecognized excessive rainfall category/);
});

ok("VENUE FORECAST: the NWS grid for TQL Stadium (ILN 35,38, updated 2026-11-23 21:00Z) gives 12 hourly rows in mph, °F and %; heat index stays null when not forecast", () => {
  const g = JSON.parse(fs.readFileSync(FX("nws-gridpoints-ILN-35-38.json"), "utf8")), r = F.parseGrid(g, Date.parse("2026-11-23T21:20:00Z"), 12);
  assert.strictEqual(r.updated, "2026-11-23T21:00:36.000Z"); assert.strictEqual(r.rows.length, 12); assert.strictEqual(r.rows[0].t, "2026-11-23T21:00:00.000Z"); assert.strictEqual(r.covered, 12);
  const raw = (el, t) => { const x = g.properties[el].values.find((v) => { const [s, d] = v.validTime.split("/"); const h = /PT?(?:(\d+)D)?T?(?:(\d+)H)?/.exec(d); const t0 = Date.parse(s); return Date.parse(t) >= t0 && Date.parse(t) < t0 + ((+h[1] || 0) * 24 + (+h[2] || 0)) * 3600e3; }); return x && x.value; };
  for (const row of [r.rows[0], r.rows[5], r.rows[11]]) {
    assert.strictEqual(row.gust, Math.round(raw("windGust", row.t) * 0.621371), "gust " + row.t);
    assert.strictEqual(row.temp, Math.round(raw("temperature", row.t) * 9 / 5 + 32), "temp " + row.t);
    assert.strictEqual(row.pop, Math.round(raw("probabilityOfPrecipitation", row.t)), "pop " + row.t);
  }
  assert.ok(r.rows.every((x) => x.heat === null)); assert.strictEqual(r.peakHeat, null); assert.ok(r.peakGust && r.peakGust.gust >= r.rows[0].gust);
  assert.throws(() => F.parseGrid({ properties: { updateTime: "x" } }, Date.now()), /unrecognized NWS forecast grid/);
});
ok("RADAR: the newest CONUS MRMS image time from the map service's footprint layer", () => {
  const j = JSON.parse(fs.readFileSync(FX("radar-mrms-footprint.json"), "utf8")), iso = F.parseRadarTime(j);
  assert.ok(/^2026-11-23T2\d:\d\d:\d\d\.000Z$/.test(iso), iso);
  assert.throws(() => F.parseRadarTime({ error: { code: 500 } }), /unrecognized radar answer/); assert.throws(() => F.parseRadarTime({ features: [] }), /no CONUS radar image/);
  assert.ok(F.RADAR_TILE_URL.includes("{bbox-epsg-3857}") && F.RADAR_TILE_URL.startsWith("https://mapservices.weather.noaa.gov/"));
});

ok("STORM REPORTS: SPC's filtered reports for Nov 12, 2026 (Delaware tornadoes): three sections, UTC times, magnitudes in their units, comments with commas kept", () => {
  const r = F.parseStormReports(fs.readFileSync(FX("spc-reports-261112-filtered.csv"), "utf8"), "2026-11-12");
  const by = r.reduce((o, x) => ((o[x.type] = (o[x.type] || 0) + 1), o), {}); assert.deepStrictEqual(by, { tornado: 3, wind: 2, hail: 22 });
  const t = r.find((x) => x.type === "tornado"); assert.strictEqual(t.observed, "2026-11-12T18:05:00.000Z"); assert.deepStrictEqual(t.point, [-75.7, 39.64]); assert.strictEqual(t.magText, "rating not given"); assert.strictEqual(t.office, "PHI");
  assert.ok(t.comments.startsWith("On the afternoon of November 12th... an EF-1 tornado"), t.comments);
  const h = r.find((x) => x.location === "1 NE Burlington Twp"); assert.strictEqual(h.magnitude, 1.75); assert.strictEqual(h.title, "Hail · 1.75 in · 1 NE Burlington Twp, NJ");
  assert.strictEqual(F.parseStormReports("Time,F_Scale,Location,County,State,Lat,Lon,Comments\n0130,EF2,Somewhere,Some,KS,38.1,-97.2,(ICT)\n", "2026-11-12")[0].observed, "2026-11-13T01:30:00.000Z"); // before 12Z: the next date
  assert.deepStrictEqual(F.parseStormReports("Time,F_Scale,Location,County,State,Lat,Lon,Comments\nTime,Speed,Location,County,State,Lat,Lon,Comments\nTime,Size,Location,County,State,Lat,Lon,Comments\n", "2026-11-23"), []); // a quiet day
  assert.throws(() => F.parseStormReports("<html>not found</html>", "2026-11-12"), /unrecognized SPC storm report file/);
});

ok("RIVER GAUGES: NWPS gauges around Cincinnati (Nov 24): stage, flow and category observed and forecast; no flood stages or no current forecast are named, never 'no flooding'", () => {
  const r = F.parseGauges(JSON.parse(fs.readFileSync(FX("nwps-gauges-cincinnati-20261124.json"), "utf8")));
  assert.strictEqual(r.length, 26); const c = r.find((g) => g.lid === "CCNO1");
  assert.strictEqual(c.name, "Ohio River at Cincinnati"); assert.deepStrictEqual(c.point, [-84.5104983, 39.0945044]); assert.strictEqual(c.obs.value, 26.93); assert.strictEqual(c.obs.unit, "ft"); assert.strictEqual(c.obs.category, "no_flooding"); assert.strictEqual(c.category, "no_flooding");
  assert.strictEqual(c.source.url, "https://water.noaa.gov/gauges/ccno1");
  const h = r.find((g) => g.lid === "BHDO1"); assert.strictEqual(h.obs.flow, null); assert.strictEqual(h.fcst.time, null); assert.strictEqual(h.category, "not_defined"); assert.strictEqual(h.rank, -1);
  const f = F.parseGauges({ gauges: [{ lid: "X1", name: "Test", latitude: 39, longitude: -84, status: { observed: { primary: 20, primaryUnit: "ft", floodCategory: "action", validTime: "2026-11-24T15:00:00Z" }, forecast: { primary: 31, primaryUnit: "ft", floodCategory: "moderate", validTime: "2026-11-26T06:00:00Z" } } }] })[0];
  assert.strictEqual(f.category, "moderate"); assert.strictEqual(f.rank, 3); // the worse of observed and forecast
  assert.throws(() => F.parseGauges({ error: "x" }), /unrecognized NWPS gauge answer/);
});

Promise.all([...resolvedCases, ...watchCases]).then(() => console.log(n + " passed")).catch((e) => { console.error(e); process.exit(1); });
