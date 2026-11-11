/* Climate station choice (assets/climate-station.js): the rule, on synthetic candidates. Live station IDs are
   checked by the signed-out preview check against NWS and RCC-ACIS. */
"use strict";
const assert = require("assert"), CS = require("../assets/climate-station.js");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const c = (faa, office, km, thr = false, extra = {}) => ({ faa, name: faa, office, km, cli: true, obsOk: true, normalsOk: true, thr: thr ? { sid: faa + "thr", name: faa + " threaded record", since: 1871 } : null, ...extra });
/* Carmel: Eagle Creek (EYE) is nearer, but Indianapolis (IND, threaded city record) is within 50 km */
eq(CS.choose("IND", [c("EYE", "IND", 23), c("IND", "IND", 31, true), c("MIE", "IND", 70)]).station.faa, "IND", "the market's primary site wins within 50 km");
/* Muncie: its own reporting site, not Fort Wayne (nearer but another office) and not Indianapolis (92 km) */
const m = CS.choose("IND", [c("MIE", "IND", 5), c("FWA", "IWX", 88, true), c("IND", "IND", 92, true)]);
eq(m.station.faa, "MIE", "beyond 50 km the nearest site in the office area");
ok(/no threaded city record/.test(m.missing.join(" ")), "a missing threaded record is stated");
eq(CS.choose("IND", [c("FWA", "IWX", 20, true), c("IND", "IND", 60, true)]).station.faa, "IND", "a nearer site in another office is not used");
/* nothing usable in the office area: nearest outside, and say so */
const o = CS.choose("XYZ", [c("AAA", "ABC", 40, true), c("BBB", "DEF", 80, true)]);
eq(o.station.faa, "AAA", "fallback: nearest usable site outside the area"); ok(/outside it/.test(o.missing.join(" ")), "…with the reason");
/* unusable data is skipped */
eq(CS.choose("IND", [c("EYE", "IND", 5, false, { normalsOk: false }), c("IND", "IND", 60, true)]).station.faa, "IND", "a site without normals is skipped");
eq(CS.choose("IND", [c("EYE", "IND", 5, false, { cli: false }), c("IND", "IND", 60, true)]).station.faa, "IND", "a site without an NWS daily climate report is skipped");
eq(CS.choose("IND", []).station, null, "nothing found: no station, never a guess");
eq(CS.keyOf({ lat: 39.97841, lon: -86.11801 }), "39.98,-86.12", "cache key from the point");
console.log(`ok - ${n} climate station checks passed`);
