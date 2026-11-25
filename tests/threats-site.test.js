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

const OL = require("../assets/threats-outlook.js");
ok("fire weather at the site from the NWS grid: dry and gusty hours, a higher concern at 15% and 35 mph, and low humidity alone as information", () => {
  const now = Date.parse("2026-11-25T15:00:00Z"), venue = { lat: 34.05, lon: -118.25 }, tz = "America/Los_Angeles";
  const rows = []; for (let i = 0; i < 72; i++) { const t = new Date(now + i * 3600e3).toISOString(), d = Math.floor(i / 24);
    rows.push({ t, gust: d === 0 && i >= 2 && i < 5 ? 40 : d === 1 && i >= 26 && i < 28 ? 28 : 10, rh: d === 0 && i >= 2 && i < 5 ? 12 : d === 1 && i >= 26 && i < 28 ? 22 : d === 2 && i === 50 ? 28 : 60, temp: 70, feels: 70, heat: null, pop: 0, wind: 5 }); }
  const r = OL.build({ tz, now, venue, days: 3, states: { spc: {}, grid: "ok" }, grid: { rows } }), it = (d) => r.days[d].items.filter((x) => x.key === "dry");
  assert.strictEqual(it(0)[0].level, 2); assert.ok(/Dry and gusty: humidity 12% with gusts to 40 mph \(3 h\)/.test(it(0)[0].text), it(0)[0].text);
  assert.strictEqual(it(1)[0].level, 1); assert.ok(/humidity 22% with gusts to 28 mph \(2 h\)/.test(it(1)[0].text));
  assert.strictEqual(it(2)[0].level, 0); assert.strictEqual(it(2)[0].text, "Humidity as low as 28%"); assert.strictEqual(it(0)[0].link, "fire");
});

const REPLAY = require("../tools/lib/grid-replay.js"), FG = require("../assets/threats-feeds.js");
const GRID = FX("nws-gridpoints-ILN-35-38-20261125.json"), NOW = Date.parse("2026-11-25T15:00:00Z"), TZ = "America/New_York", CVG = { lat: 39.04, lon: -84.67 };
const hl = (name, opt) => OL.highlights(FG.parseGrid(REPLAY.scenario(GRID, name, NOW), NOW, 168), TZ, NOW, opt);
ok("highlights, CVG replay: heavy rain across midnight (rolling 24 h), Friday-morning wintry mix, lingering rain covering commutes", () => {
  const h = hl("heavy"), k = (x) => h.list.find((y) => y.kind === x);
  assert.deepStrictEqual(h.list.map((x) => x.short).slice(0, 2), ["Heavy rain Thursday", "Wintry mix possible Friday morning"]);
  assert.ok(/^Heavy rain: about 1\.3 in from Thu 1 PM – Fri 7 AM; heaviest Thu 7 PM – Fri 1 AM \(about 0\.6 in\)$/.test(k("rain").text), k("rain").text);
  assert.ok(/^Wintry mix possible Fri 6 AM – 11 AM: rain, snow; snow about 0\.2 in$/.test(k("winter").text), k("winter").text);
  assert.ok(/^Rain likely for about 17 hours, Thu 10 AM – Fri 3 AM \(about 1\.\d in\); covers the Thu evening commute$/.test(k("linger").text), k("linger").text);
  assert.ok(h.notes.some((n) => /^Rain amounts forecast through /.test(n)));
});
ok("highlights: the heavy-rain threshold is configurable; below it, no heavy-rain highlight", () => {
  assert.ok(!hl("heavy", { rainIn: 1.5 }).list.some((x) => x.kind === "rain")); assert.ok(hl("heavy", { rainIn: 0.5 }).list.some((x) => x.kind === "rain"));
});
ok("highlights: a hot day (heat index 100°F at 2 PM Thursday), a quiet forecast, and missing data", () => {
  const hot = hl("hot"); assert.deepStrictEqual(hot.list.map((x) => x.text), ["Heat index to 100°F around Thu 2 PM"]);
  assert.strictEqual(hl("hot", { heatF: 101 }).list.length, 0);
  const q = hl("quiet"); assert.strictEqual(q.list.length, 0); assert.strictEqual(q.missing, false);
  const m = OL.highlights(null, TZ, NOW, {}); assert.strictEqual(m.missing, true); assert.strictEqual(m.list.length, 0);
  const b = OL.build({ tz: TZ, now: NOW, venue: CVG, days: 7, states: { spc: {}, grid: "failed" }, grid: null }); assert.strictEqual(b.highlights.missing, true);
});
ok("highlights land in the day cards on their own day (heavy rain on Thursday, the mix on Friday)", () => {
  const b = OL.build({ tz: TZ, now: NOW, venue: CVG, days: 7, states: { spc: {}, grid: "ok" }, grid: FG.parseGrid(REPLAY.scenario(GRID, "heavy", NOW), NOW, 168) });
  const d = (lab) => b.days.find((x) => x.date === lab).items.filter((i) => i.highlight).map((i) => i.key);
  assert.deepStrictEqual(d("2026-11-26").sort(), ["hl-linger", "hl-rain"]); assert.deepStrictEqual(d("2026-11-27"), ["hl-winter"]);
});
console.log(n + " passed");
