/* Venue search decisions on real Nominatim responses captured in tests/fixtures/nominatim/venues.json. */
"use strict";
const assert = require("assert"), V = require("../assets/venue-search.js"), F = require("./fixtures/nominatim/venues.json").queries;
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const d = (q) => V.decide(q, V.parse(F[q]));

let r = d("Paycor Stadium");
eq([r.status, r.place.name, r.place.kind, r.place.lat, r.place.lon], ["found", "Paycor Stadium", "venue", 39.09546, -84.51605], "a venue by name: found at the stadium itself, not the city centre");
ok(/Cincinnati, OH 45202/.test(r.place.address), "found venue carries its street address");
eq(d("Paycor Stadium, Cincinnati, OH").place.lat, 39.09546, "the city helps narrow the search; the pin stays at the stadium");
r = d("Riverbend Music Center");
eq([r.status, r.place.name, r.place.address], ["found", "Riverbend Music Center", "6295 Kellogg Ave, Cincinnati, OH 45230"], "two results 150 m apart (venue and its building) are one place, shown with its street address");
r = d("6295 Kellogg Ave, Cincinnati, OH 45230");
eq([r.status, r.place.kind, r.place.name], ["found", "address", "6295 Kellogg Ave"], "an address-only event is found at that address and named by it");
ok(V.km(r.place, { lat: 39.0519, lon: -84.4189 }) < 1.0, "address result lands at the address (within 1 km of the venue there)");
r = d("Memorial Stadium");
ok(r.status === "ambiguous" && r.candidates.length >= 4, "same venue name in different cities: several candidates");
ok(r.candidates.every((c) => /, [A-Z]{2}\b/.test(c.address)) && new Set(r.candidates.map((c) => c.address.split(", ").slice(-2).join(", "))).size === r.candidates.length, "each candidate shows its own city and state");
ok(r.candidates.some((c) => /Lincoln, NE/.test(c.address)) && r.candidates.some((c) => /Columbia, MO/.test(c.address)), "e.g. Lincoln, NE and Columbia, MO");
r = d("Cincinnati, OH");
eq([r.status, r.why], ["unknown", "area"], "a city-only match leaves the venue unconfirmed");
eq(V.decide("Nowhere", []).status, "unknown", "no results: unknown");
eq(V.formatAddress({ house_number: "1501", road: "Central Parkway West", city: "Cincinnati", "ISO3166-2-lvl4": "US-OH", postcode: "45214" }), "1501 Central Pkwy W, Cincinnati, OH 45214", "addresses are written the short way");
const L = d("Memorial Stadium").candidates;
eq(V.tzGuess(L.find((c) => /Lincoln, NE/.test(c.address))), "America/Chicago", "time-zone fallback: Lincoln, NE is Central");
eq([V.tzGuess({ state: "OH", lat: 39.1, lon: -84.5 }), V.tzGuess({ state: "KY", lat: 37.08, lon: -88.6 }), V.tzGuess({ state: "TX", lat: 31.76, lon: -106.48 }), V.tzGuess({ state: "AZ", lat: 33.45, lon: -112.07 }), V.tzGuess({ address: "1 Main St, Boise, ID 83702", lat: 43.6, lon: -116.2 }), V.tzGuess({ lat: 1, lon: 1 })],
  ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Boise", null], "state fallback handles split states (west KY Central, El Paso Mountain), Arizona and addresses without state data");
console.log(`ok - ${n} venue search checks passed`);
