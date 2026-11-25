/* Rainfall overlays: NOAA MRMS (rain that has fallen) and WPC QPF (rain still to come) adapters.
   Real responses saved 2026-11-25 ~03:15Z in tests/fixtures/threats/rain/ (catalog, legends, point values at CVG).
   Run: node tests/threats-rain.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const F = require("../assets/threats-feeds.js");
const J = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "threats", "rain", f), "utf8"));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

ok("MRMS catalog: each window's CONUS end time (UTC), other regions kept", () => {
  const c = F.parseMrmsCatalog(J("mrms-catalog.json"));
  assert.deepStrictEqual(Object.keys(c).sort((a, b) => a - b), ["1", "24", "72"]); // 3/6/12/48 h exist but aren't offered
  assert.strictEqual(c[1].end, "2026-11-25T03:00:00.000Z"); assert.strictEqual(c[24].end, "2026-11-25T02:00:00.000Z"); // longer windows lag an hour
  assert.strictEqual(c[72].end, "2026-11-25T02:00:00.000Z"); assert.ok(c[24].regions.alaska && c[24].regions.hawaii && c[24].regions.carib);
});
ok("MRMS catalog: a service error or an empty list throws (never 'no rain')", () => {
  assert.throws(() => F.parseMrmsCatalog({ status: "error", messages: ["Could not access any server machines."] }), /Could not access/);
  assert.throws(() => F.parseMrmsCatalog({ features: [] }), /no rainfall windows/);
  assert.throws(() => F.parseMrmsCatalog({ error: { code: 500, message: "Error performing query" } }), /Error performing query \(500\)/);
});
ok("MRMS point: millimetres converted to inches; 0.00 in at CVG from the CONUS 24 h item; negative values mean no estimate", () => {
  const p = F.parseMrmsPoint(J("mrms-identify-cvg-24hr.json"));
  assert.strictEqual(p.inches, 0); assert.strictEqual(p.noEstimate, false); assert.strictEqual(p.item, "conus_QPE_24H"); assert.strictEqual(p.end, "2026-11-25T02:00:00.000Z");
  assert.strictEqual(F.parseMrmsPoint({ value: "-3", catalogItems: { features: [] } }).noEstimate, true);
  assert.strictEqual(F.parseMrmsPoint({ value: "NoData" }).noEstimate, true);
  // raw values are millimetres (NOAA's rendering classes them as value / 25.4 inches): CVG airport 72 h 5.9 -> 0.23 in (0.24 in measured)
  assert.strictEqual(F.parseMrmsPoint({ value: "5.9" }).inches, 0.23); assert.strictEqual(F.parseMrmsPoint({ value: "25.4" }).inches, 1); assert.strictEqual(F.parseMrmsPoint({ value: "5.9" }).mm, 5.9);
});
ok("WPC point: nested thresholds give a range; outside every area is under 0.01 in", () => {
  assert.deepStrictEqual(F.parseWpcPoint(J("wpc-point-cvg-9.json")), { low: 1.5, high: 1.75, issued: "2026-11-24T22:25:19Z", start: "2026-11-25T00:00:00Z", end: "2026-11-28T00:00:00Z", none: false });
  assert.deepStrictEqual([2, 3].map((l) => { const x = F.parseWpcPoint(J("wpc-point-cvg-" + l + ".json")); return [x.low, x.high]; }), [[1, 1.25], [0.25, 0.5]]);
  const d1 = F.parseWpcPoint(J("wpc-point-cvg-1.json")); assert.strictEqual(d1.none, true); assert.strictEqual(d1.high, 0.01);
  assert.strictEqual(F.parseWpcPoint({ features: [{ attributes: { qpf: 20, issue_time: "2026-11-24 22:02:54", start_time: "2026-11-25 00:00:00", end_time: "2026-11-26 00:00:00" } }] }).high, null); // top class: "at least"
  assert.throws(() => F.parseWpcPoint({ error: { code: 400, message: "Invalid query" } }), /Invalid query/);
});
ok("WPC times are UTC strings turned into ISO; anything else is null", () => {
  assert.strictEqual(F.wpcIso("2026-11-24 22:02:54"), "2026-11-24T22:02:54Z"); assert.strictEqual(F.wpcIso(""), null); assert.strictEqual(F.wpcIso("11/24/26"), null);
  assert.throws(() => F.parseWpcMeta({ features: [{ attributes: { issue_time: "x" } }] }), /forecast times missing/);
  assert.deepStrictEqual(F.parseWpcMeta({ features: [{ attributes: { issue_time: "2026-11-24 22:02:54", start_time: "2026-11-25 00:00:00", end_time: "2026-11-26 00:00:00" } }] }), { issued: "2026-11-24T22:02:54Z", start: "2026-11-25T00:00:00Z", end: "2026-11-26T00:00:00Z" });
});
ok("Legends: NOAA's own swatches, inches stripped, zero class dropped; each MRMS window has its own scale", () => {
  const l1 = F.parseLegend(J("mrms-legend-1hr.json")), l24 = F.parseLegend(J("mrms-legend-24hr.json")), l72 = F.parseLegend(J("mrms-legend-72hr.json"));
  assert.strictEqual(l24.length, 24); assert.strictEqual(l1[l1.length - 1].label, "Above 8.00"); assert.strictEqual(l24[l24.length - 1].label, "Above 24.00"); assert.strictEqual(l72[l72.length - 1].label, "Above 40.00");
  assert.ok(l24.every((x) => /^data:image\/png;base64,/.test(x.img)));
  const w = F.parseLegend(J("wpc-legend.json"), 9); assert.strictEqual(w[0].label, "20.00"); assert.strictEqual(w[w.length - 1].label, "0.01"); assert.ok(!w.some((x) => x.label === "0"));
  assert.throws(() => F.parseLegend({ layers: [] }, 9), /no legend/);
});
ok("URLs: only the chosen window or period; a new window end or issuance makes a new tile URL", () => {
  assert.ok(/rft_24hr/.test(decodeURIComponent(F.MRMS_TILE_URL(24, 1)))); assert.ok(/_QPE_72H/.test(decodeURIComponent(F.MRMS_TILE_URL(72, 1))));
  assert.notStrictEqual(F.MRMS_TILE_URL(24, 1), F.MRMS_TILE_URL(24, 2)); assert.ok(/\{bbox-epsg-3857\}/.test(F.MRMS_TILE_URL(24, 1)));
  assert.ok(/layers=show:9&/.test(F.WPC_TILE_URL("1-3", 5))); assert.ok(/layers=show:2&/.test(F.WPC_TILE_URL("2", 5))); assert.ok(/\/3\/query\?/.test(F.WPC_POINT_URL("3", 39.1, -84.5)));
  assert.ok(F.MRMS_SVC.startsWith("https://mapservices.weather.noaa.gov/") && F.WPC_QPF_SVC.startsWith("https://mapservices.weather.noaa.gov/"));
});
console.log(n + " passed");
