/* Aviation phase 2: pilot reports, SIGMETs, G-AIRMETs, CWAs and FAA airport status, against the official capture of
   Nov 22, 2026 at 21:19Z (tests/fixtures/threats/*-20261122T2119Z.json), and the matcher's disruptions and route items.
   Run: node tests/threats-enroute.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const E = require("../assets/threats-enroute.js"), F = require("../assets/threats-feeds.js"), M = require("../assets/threats-match.js");
const X = path.join(__dirname, "fixtures/threats"), T = "20261122T2119Z", J = (f) => JSON.parse(fs.readFileSync(path.join(X, f), "utf8"));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const CLOCK = "2026-11-22T21:19:00Z", NOW = Date.parse(CLOCK), tz = "America/New_York", ms = (l) => Date.parse(l + ":00-05:00");
const pireps = E.parsePIREP(J("awc-pirep-conus-turb-ice-" + T + ".json")), sigmets = E.parseAirSigmet(J("awc-airsigmet-" + T + ".json")), cwas = E.parseCWA(J("awc-cwa-" + T + ".json"));
const gairmets = E.parseGAirmet([0, 3, 6, 9, 12].map((f) => J("awc-gairmet-f" + f + "-" + T + ".json"))), faa = E.parseFAA(J("faa-airport-events-" + T + ".json"), J("faa-operations-plan-" + T + ".json"), CLOCK);
const airports = [...F.parseMETAR(J("awc-metar-kord-kewr-klga-kjfk-" + T + ".json")), ...F.parseTAF(J("awc-taf-kord-kewr-klga-kjfk-" + T + ".json"))];
const ALL = [...airports, ...pireps, ...sigmets, ...cwas, ...gairmets, ...faa];
const STATE = { awc: { kind: "current", lastOk: CLOCK }, "awc-enroute": { kind: "current", lastOk: CLOCK, partial: [] }, "faa-nas": { kind: "current", lastOk: CLOCK } };
const METLIFE = { lat: 40.8135, lon: -74.0745, name: "MetLife Stadium", tz, windows: [{ phase: "event", startMs: ms("2026-11-22T20:15"), endMs: ms("2026-11-22T23:30") }] };
const EWR = { icao: "KEWR", role: "primary", arrive: { startMs: ms("2026-11-22T18:00"), endMs: ms("2026-11-22T19:00") }, depart: { startMs: ms("2026-11-23T09:00"), endMs: ms("2026-11-23T10:00") } };
const ROUTE = { o: "KORD", d: "KEWR", lowFt: 10000, highFt: 16000, startMs: ms("2026-11-22T16:30"), endMs: ms("2026-11-22T18:30") };
const match = (event, products = ALL, state = STATE) => M.forEvent({ products, state, event: { ...METLIFE, ...event }, now: NOW, families: ["aviation"] });

ok("PIREPs: turbulence and icing of light or more, with intensity, altitude, time and aircraft; smooth reports dropped", () => {
  assert(pireps.length > 50 && pireps.every((p) => p.rank >= 1 && p.kind === "pirep" && p.layerKind === "observation"));
  const jfk = pireps.find((p) => /^JFK UA \/OV JFK 220005\/TM 2012/.test(p.raw));
  assert(jfk, "the JFK report"); assert.strictEqual(jfk.altFt, 6000); assert.strictEqual(jfk.turb[0].int, "MOD-SEV"); assert.strictEqual(jfk.acType, "M20P");
  assert.strictEqual(E.pirepText(jfk), "moderate to severe turbulence at 6,000 ft"); assert.strictEqual(jfk.observed, "2026-11-22T20:12:00.000Z");
  const layered = pireps.find((p) => p.turb[0] && p.turb[0].baseFt === 24000 && p.turb[0].topFt === 26000); assert(layered && /^light to moderate turbulence between FL240 and FL260$/.test(E.pirepText(layered)), "a report with its own layer: " + (layered && E.pirepText(layered)));
  const one = pireps.find((p) => /^MCO UA \/OV MCO\/TM 2105/.test(p.raw)); assert.strictEqual(E.pirepText(one), "light turbulence at 1,500 ft (during descent)");
});
ok("TURBULENCE REPORT AT ONE ALTITUDE: the 6,000 ft JFK report passes a below-10,000 ft filter and drops out of the FL180-FL290 filter", () => {
  const jfk = pireps.find((p) => /^JFK UA \/OV JFK 220005/.test(p.raw));
  assert(E.inBand(jfk, 0, 10000)); assert(!E.inBand(jfk, 18000, 29000)); assert(E.inBand(jfk, null, null));
  const pjc = pireps.find((p) => /^PJC UA/.test(p.raw)); assert(pjc && pjc.lowFt === 31000 && pjc.highFt === 32000); assert(!E.inBand(pjc, 0, 10000)); assert(E.inBand(pjc, 29000, 60000));
});
ok("SIGMETs: convective SIGMET with its valid time, top and outline; G-AIRMETs: five snapshots, freezing-level contours left out, FZL bases from the freezing level", () => {
  assert.strictEqual(sigmets.length, 2); assert(sigmets.every((s) => s.hazardFamily === "convective" && s.topFt >= 37000 && s.geometry.type === "Polygon" && s.validEnd === "2026-11-22T22:55:00.000Z"));
  assert(gairmets.length > 150 && !gairmets.some((g) => /FZLVL/.test(g.hazard)));
  assert.deepStrictEqual([...new Set(gairmets.map((g) => g.forecastHour))].sort((a, b) => a - b), [0, 3, 6, 9, 12]);
  const ice = gairmets.find((g) => g.tag === "3C" && g.hazard === "ICE" && g.forecastHour === 0); assert(ice.freezingLevel); assert.strictEqual(ice.baseFt, 6000); assert.strictEqual(ice.topFt, 20000);
  assert.strictEqual(ice.validStart, "2026-11-22T20:45:00.000Z"); assert.strictEqual(ice.validEnd, "2026-11-22T22:30:00.000Z"); // 90 minutes either side of 21Z, from issue time
  const ifr = gairmets.find((g) => g.hazard === "IFR"); assert(ifr.surface && ifr.baseFt === 0 && ifr.topFt == null);
});
ok("CWAs: today's IFR CWA; the archived samples' altitudes come from their text when the fields are empty; AWC's empty answer is none", () => {
  assert.strictEqual(cwas.length, 1); assert.strictEqual(cwas[0].hazard, "IFR"); assert(cwas[0].surface);
  const s = E.parseCWA(J("awc-cwa-samples-20261120-22.json")), turb = s.find((c) => c.hazard === "TURB"), ts = s.find((c) => c.hazard === "TS");
  assert.strictEqual(turb.baseFt, 29000); assert.strictEqual(turb.topFt, 39000); assert(ts && ts.topFt === 37000 && /TOPS EST TO FL370/.test(ts.raw));
  assert.deepStrictEqual(E.parseCWA(""), []); assert.deepStrictEqual(E.parseCWA(null), []); assert.throws(() => E.parseCWA({}));
});
ok("FAA: ground delay programs and stops with the FAA's cause and times; weather-related causes marked; NOTAM notices kept apart; ICAO to FAA IDs", () => {
  const ewr = faa.find((d) => d.airportFaa === "EWR" && d.type === "groundDelay"); assert(ewr.weather); assert.strictEqual(ewr.cause, "low ceilings"); assert.strictEqual(ewr.avgMin, 105); assert.strictEqual(ewr.maxMin, 355);
  assert.strictEqual(E.faaText(ewr), "ground delay program for low ceilings, average delay 1 hr 45 min (up to 5 hr 55 min)"); assert.strictEqual(ewr.end, "2026-11-23T04:59:00.000Z"); assert(!ewr.planned);
  const teb = faa.find((d) => d.airportFaa === "TEB"); assert.strictEqual(teb.type, "groundStop"); assert(teb.weather);
  const san = faa.find((d) => d.airportFaa === "SAN" && d.type === "groundDelay"); assert(!san.weather, "airport volume is not weather");
  const jfk = faa.find((d) => d.airportFaa === "JFK"); assert(jfk.weather, "TM metering for WX"); assert.strictEqual(jfk.causeText, "traffic management: metering, weather");
  assert(faa.filter((d) => d.notice).every((d) => d.airportFaa !== "EWR" && !d.weather));
  assert.strictEqual(E.faaId("KEWR"), "EWR"); assert.strictEqual(E.faaId("PHNL"), "HNL"); assert.strictEqual(E.faaId("CYYZ"), "CYYZ");
  assert.strictEqual(E.plainCause("OTHER: AIRSPACE SHARING WITH N90"), "airspace sharing with N90"); assert.strictEqual(E.plainCause("VOL: ZJX"), "traffic volume, ZJX");
});
ok("FAA WEATHER DISRUPTION: Newark's ground delay program (low ceilings) overlaps the arrival window, under the airport, active, with the cause", () => {
  const r = match({ airports: [EWR] }), gdp = r.items.find((i) => i.kind === "faa" && i.product.type === "groundDelay");
  assert.strictEqual(gdp.headline, "Ground delay program for low ceilings, average delay 1 hr 45 min (up to 5 hr 55 min) at Newark (KEWR) · active now, until Sun 11:59 p.m.");
  assert(/Weather-related \(FAA: low ceilings\)\. Overlaps your arrival window, Sun 6 p\.m\.–7 p\.m\.$/.test(gdp.line), gdp.line); assert.strictEqual(gdp.status, "active");
  const d = r.disruptions.find((x) => x.icao === "KEWR"); assert(d.lines.some((l) => l.concern && l.itemId === gdp.id));
  // no end time and a window 17 hours away: a plain line, not an item
  const dep = d.lines.find((l) => /Departure delays/.test(l.text)); assert(dep && !dep.concern && /more than 6 hours away/.test(dep.text), JSON.stringify(dep));
  assert(!r.statuses.some((s) => s.id === "awc-enroute"), "no route: no en-route source line"); assert(r.statuses.some((s) => s.id === "faa-nas" && s.ok));
});
ok("FAA: a planned program is 'planned' with its start; an airport with none says so; a source that isn't answering is never 'none'", () => {
  const plan = faa.map((d) => (d.airportFaa === "EWR" && d.type === "groundDelay" ? { ...d, start: "2026-11-22T22:30:00.000Z", planned: true } : d));
  const r = match({ airports: [EWR] }, [...airports, ...plan]), it = r.items.find((i) => i.kind === "faa" && i.product.type === "groundDelay");
  assert.strictEqual(it.status, "planned"); assert(/· planned, from Sun 5:30 p\.m\. until Sun 11:59 p\.m\.$/.test(it.headline), it.headline);
  const ord = match({ airports: [{ icao: "KORD", role: "primary", arrive: EWR.arrive }] }).disruptions[0]; assert.deepStrictEqual(ord.lines.map((l) => l.text), ["No FAA-reported delays, ground stops or closures at O'Hare (KORD) right now."]);
  const down = match({ airports: [{ icao: "KORD", role: "primary", arrive: EWR.arrive }] }, airports, { ...STATE, "faa-nas": { kind: "unavailable" } }).disruptions[0];
  assert(down.lines[0].unknown && /isn't answering/.test(down.lines[0].text));
});
ok("ADVISORY ON THE APPROXIMATE ROUTE: O'Hare to Newark at 10,000-16,000 ft, 4:30-6:30 p.m., meets G-AIRMET icing and turbulence areas; worded as potential overlap", () => {
  const r = match({ airports: [EWR], route: ROUTE }), en = r.items.filter((i) => i.kind === "enroute");
  assert.deepStrictEqual(en.map((i) => i.product.tag + " " + i.product.hazard).sort(), ["1W TURB-LO", "3C ICE", "3W TURB-LO", "4C ICE"]);
  const ice = en.find((i) => i.product.tag === "3C");
  assert.strictEqual(ice.headline, "Moderate icing forecast may overlap your approximate route, 6,000 ft to FL210, Sun 4:30 p.m. – 6:30 p.m. · G-AIRMET");
  assert(/^Potential overlap\. The straight-line route O'Hare → Newark passes through the area/.test(ice.line) && /An approximate route, not a flight plan\.$/.test(ice.line));
  assert.strictEqual(ice.snapshots.length, 2, "the 21Z and 00Z snapshots are one item");
  assert(r.route.set && r.route.label === "O'Hare → Newark" && r.route.band === "10,000 ft to 16,000 ft" && r.route.corridorMi === 25);
  assert(r.statuses.some((s) => s.id === "awc-enroute" && s.ok));
  // above the icing and the low-level turbulence: none of them
  const high = match({ route: { ...ROUTE, lowFt: 25000, highFt: 26000 } }); assert(!high.items.some((i) => i.kind === "enroute"));
  assert(/^No SIGMET, G-AIRMET or Center Weather Advisory/.test(high.route.lines[0].text));
  // later in the night the icing snapshots still run, the 1W turbulence has ended
  const late = match({ route: { ...ROUTE, startMs: Date.parse("2026-11-23T03:00:00Z"), endMs: Date.parse("2026-11-23T04:00:00Z") } });
  assert(!late.items.some((i) => i.product.tag === "1W") && late.items.some((i) => i.product.tag === "4C"));
});
ok("ROUTE: pilot reports near the line within 90 minutes and the band count; a route away from any area or a missing airport says so", () => {
  const jfkRep = pireps.find((p) => /^JFK UA \/OV JFK 220005/.test(p.raw)), lateClock = Date.parse(jfkRep.observed) + 30 * 60e3;
  const r = M.forEvent({ products: ALL, state: STATE, event: { ...METLIFE, route: { o: "KORD", d: "KJFK", lowFt: 4000, highFt: 8000, startMs: lateClock + 600e3, endMs: lateClock + 7200e3 } }, now: lateClock, families: ["aviation"] });
  const rep = r.items.find((i) => i.kind === "pirep" && i.product.id === jfkRep.id); assert(rep, "the JFK report is near the KORD-KJFK line");
  assert(/^Pilot reported moderate to severe turbulence at 6,000 ft near your approximate route, 30 min ago · pilot report$/.test(rep.headline), rep.headline);
  const miss = match({ route: { ...ROUTE, d: "KXYZ" } }); assert(miss.route.lines[0].unknown && /Can't place KXYZ/.test(miss.route.lines[0].text));
  const noTime = match({ route: { ...ROUTE, startMs: null, endMs: null } }); assert(/Add the time in the air/.test(noTime.route.lines[0].text));
});
ok("SEPARATION: venue hazards, airport weather, flight disruptions and route items stay apart; the venue summary ignores aviation sources", () => {
  const r = M.forEvent({ products: ALL, state: STATE, event: { ...METLIFE, airports: [EWR], route: ROUTE }, now: NOW, families: ["severe", "aviation"] });
  assert(r.items.every((i) => i.family === "aviation")); assert.deepStrictEqual([...new Set(r.items.map((i) => i.kind))].sort(), ["enroute", "faa"]);
  assert(!/aviation|airport|FAA/i.test(r.venueSummary));
  assert(Array.isArray(r.airports) && Array.isArray(r.disruptions) && r.route.set);
});
ok("AWC partial answer: a route checked with one product family missing is not confirmed", () => {
  const r = match({ route: ROUTE }, ALL, { ...STATE, "awc-enroute": { kind: "current", lastOk: CLOCK, partial: ["pilot reports: timeout"] } });
  const s = r.statuses.find((x) => x.id === "awc-enroute"); assert(!s.ok && /not answered: pilot reports: timeout/.test(s.text));
});
console.log(n + " passed");
