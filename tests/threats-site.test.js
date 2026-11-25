/* Site assessment pieces: NWS impact tags (from a real saved Tornado Warning) and NWPS flood stages (saved CCNO1 detail).
   Run: node tests/threats-site.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const F = require("../assets/threats-feeds.js");
const FX = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "threats", f), "utf8"));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const tor = FX("nws-archive-kmtr-to-w-0003.json"), f0 = tor.features ? tor.features[0] : tor;
ok("impact: a plain radar-indicated Tornado Warning carries no tag", () => assert.strictEqual(F.impactOf(f0.properties), null));
ok("impact: NWS damage-threat tags map to their official names; catastrophic is an emergency", () => {
  const P = (x) => ({ ...f0.properties, parameters: { ...f0.properties.parameters, ...x } });
  assert.deepStrictEqual(F.impactOf(P({ tornadoDamageThreat: ["CATASTROPHIC"] })), { tag: "Tornado Emergency", level: 5 });
  assert.deepStrictEqual(F.impactOf(P({ tornadoDamageThreat: ["CONSIDERABLE"] })), { tag: "Considerable tornado damage threat", level: 4 });
  assert.deepStrictEqual(F.impactOf({ parameters: { flashFloodDamageThreat: ["CATASTROPHIC"] } }), { tag: "Flash Flood Emergency", level: 5 });
  assert.deepStrictEqual(F.impactOf({ parameters: { thunderstormDamageThreat: ["DESTRUCTIVE"] } }), { tag: "Destructive", level: 4 });
  assert.deepStrictEqual(F.impactOf({ parameters: { thunderstormDamageThreat: ["CONSIDERABLE"] } }), { tag: "Considerable", level: 3 });
  assert.deepStrictEqual(F.impactOf({ headline: "TORNADO EMERGENCY for Moore", parameters: {} }), { tag: "Tornado Emergency", level: 5 });
});
ok("normalized alerts keep the impact", () => { const p = F.normalizeAlert({ ...f0, properties: { ...f0.properties, parameters: { ...f0.properties.parameters, tornadoDamageThreat: ["CATASTROPHIC"] } } }); assert.strictEqual(p.impact.tag, "Tornado Emergency"); });
ok("NWPS flood stages from a gauge's detail (Ohio River at Cincinnati)", () => {
  assert.deepStrictEqual(F.parseGaugeDetail(FX("nwps-gauge-ccno1-20261125.json")), { units: "ft", action: 40, minor: 52, moderate: 56, major: 65 });
  assert.deepStrictEqual(F.parseGaugeDetail({ flood: { stageUnits: "ft", categories: { action: { stage: -9999 }, minor: { stage: 12 } } } }), { units: "ft", action: null, minor: 12, moderate: null, major: null });
  assert.throws(() => F.parseGaugeDetail({}), /no flood categories/);
});
console.log(n + " passed");
