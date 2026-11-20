/* Weather threats preview: venue relationship, ordering, grouping, change rows and source states.
   Run: node tests/threats-core.test.js */
"use strict";
const assert = require("assert");
const T = require("../assets/threats-core.js"), D = require("../assets/threats-demo.js");
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const s = D.scenario("overlap"), byKind = (k) => s.products.find((p) => p.kind === k);
const W = byKind("warning"), A = byKind("watch"), M = byKind("md");

ok("venue inside the warning is covered by warning, watch and MD", () => {
  for (const p of [W, A, M]) assert.strictEqual(T.relation(p, D.VENUES.inside).kind, "covers", p.id);
});
ok("venue near the warning edge is 'near', not covered, with distance and direction", () => {
  const r = T.relation(W, D.VENUES.edge);
  assert.strictEqual(r.kind, "near"); assert.ok(r.km > 0 && r.km < T.NEAR_KM); assert.ok(/north/.test(r.dir));
  assert.match(T.relationText(r, W), /^2 miles north\w* of the venue · the venue is outside the warning area$/);
});
ok("venue outside the warning stays inside the watch", () => {
  assert.strictEqual(T.relation(W, D.VENUES.outside).kind, "outside");
  assert.strictEqual(T.relation(A, D.VENUES.outside).kind, "covers");
});
ok("moving the venue never changes the products", () => {
  const before = JSON.stringify(s.products); for (const v of Object.values(D.VENUES)) s.products.forEach((p) => T.relation(p, v));
  assert.strictEqual(JSON.stringify(s.products), before);
});
ok("MD wording is a discussion area, not something in effect", () => {
  assert.strictEqual(T.relationText(T.relation(M, D.VENUES.inside), M), "Discussion area includes the venue");
  assert.strictEqual(T.relationText(T.relation(A, D.VENUES.inside), A), "In effect at the venue");
  assert.match(T.relationText(T.relation(M, D.VENUES.outside), M), /^Discussion area 13 miles south of the venue$/);
});
ok("a warning that reaches its expiration during an outage is flagged, not cleared", () => {
  const e = D.scenario("outage-expired"), w = e.products.find((p) => p.kind === "warning"), now = Date.parse(e.clock);
  assert.ok(Date.parse(w.expires) <= now);
  assert.strictEqual(T.expiredUnconfirmed(w, e.sources.alerts, now), true);
  assert.strictEqual(T.expiredUnconfirmed(w, { state: "ok", lastOk: e.clock }, now), false);
});
ok("several-regions fixture: tornado warnings lead, groups stay separate by region", () => {
  const m = D.scenario("multi"), g = T.group(m.products);
  assert.ok(g.length >= 4, "regions " + g.length);
  assert.ok(/Tornado Warning/.test(g[0].lead.event) && /Tornado Warning/.test(g[1].lead.event));
  assert.ok(m.products.filter((p) => p.kind === "warning").length >= 6);
});
ok("a product without geometry is 'unknown', never 'outside'", () => {
  const r = T.relation({ ...W, geometry: null }, D.VENUES.inside);
  assert.strictEqual(r.kind, "unknown"); assert.match(T.relationText(r), /not drawn/);
});
ok("ordering: warning > watch > MD > outlooks (highest category first); tornado before severe thunderstorm", () => {
  const sorted = T.sort([...s.products].reverse());
  assert.deepStrictEqual(sorted.slice(0, 3).map((p) => p.kind), ["warning", "watch", "md"]);
  assert.strictEqual(sorted[3].category, "ENH");
  const svr = { ...W, id: "svr", event: "Severe Thunderstorm Warning" };
  assert.deepStrictEqual(T.sort([svr, W]).map((p) => p.id), [W.id, "svr"]);
});
ok("overlapping warning, watch and MD form one group led by the warning", () => {
  const g = T.group(s.products, [{ name: "Cincinnati, OH", lat: 39.1, lon: -84.5 }, { name: "Dallas", lat: 32.8, lon: -96.8 }]);
  assert.strictEqual(g.length, 1); assert.strictEqual(g[0].lead.id, W.id); assert.strictEqual(g[0].items.length, 3); assert.strictEqual(g[0].name, "Near Cincinnati, OH");
});
ok("separate areas stay separate groups", () => {
  const far = { ...A, id: "far", geometry: { type: "Polygon", coordinates: [[[-100, 33], [-98, 33], [-98, 35], [-100, 35], [-100, 33]]] } };
  assert.strictEqual(T.group([W, far]).length, 2);
});
ok("outlook at the venue is the highest containing category", () => {
  const d1 = s.products.filter((p) => p.kind === "outlook" && p.day === 1);
  assert.strictEqual(T.outlookAt(d1, [D.VENUES.inside.lon, D.VENUES.inside.lat]).category, "ENH");
  assert.strictEqual(T.outlookAt(d1, [-120, 40]), null);
});
ok("'What changed' only with an earlier version of the same product", () => {
  const c = T.changes(W, (x) => x);
  assert.ok(c && c.lines.some((l) => /Area reduced/.test(l)) && c.lines.some((l) => /Expiration unchanged/.test(l)));
  assert.strictEqual(T.changes(A, (x) => x), null);
  assert.strictEqual(T.changes({ ...W, previous: { ...W.previous, id: "other" } }, (x) => x), null);
});
ok("source states: empty success, stale, failed with a last copy, never-reached", () => {
  const now = Date.parse(D.CLOCK);
  assert.strictEqual(T.sourceState({ state: "ok", lastOk: D.CLOCK, count: 0 }, now).kind, "empty");
  assert.strictEqual(T.sourceState({ state: "ok", lastOk: D.CLOCK, count: 2 }, now).kind, "current");
  assert.strictEqual(T.sourceState({ state: "ok", lastOk: "2026-11-20T20:30:00Z", count: 2 }, now, 10).kind, "stale");
  assert.strictEqual(T.sourceState({ state: "failed", lastOk: "2026-11-20T20:41:00Z", count: 2 }, now).kind, "stale");
  assert.strictEqual(T.sourceState({ state: "failed", lastOk: null }, now).kind, "unavailable");
});
ok("unavailable scenario keeps the last NWS products (not cleared) and has no MD source", () => {
  const u = D.scenario("unavailable");
  assert.ok(u.products.some((p) => p.kind === "warning"));
  assert.strictEqual(u.sources.md.lastOk, null);
});
ok("quiet scenario has no active products and successful empty checks", () => {
  const q = D.scenario("quiet");
  assert.strictEqual(q.products.filter((p) => p.kind !== "outlook").length, 0);
  assert.strictEqual(T.sourceState(q.sources.alerts, Date.parse(q.clock)).kind, "empty");
});
ok("times show in the venue zone, with UTC for SPC products", () => {
  assert.strictEqual(T.fmtTime(W.expires, "America/New_York"), "4:15 PM EST");
  assert.strictEqual(T.fmtZ("2026-11-20T16:30:00Z"), "1630Z");
  assert.strictEqual(T.untilText(W.expires, Date.parse(D.CLOCK)), "17 min left");
});
console.log(n + " passed");
