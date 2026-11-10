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

/* LocationIQ returns the classic Nominatim format: class instead of category, no addresstype, state names, name in
   namedetails. The same captured places, re-shaped that way, give the same decisions. */
const NAMES = { "US-OH": "Ohio", "US-NE": "Nebraska", "US-TX": "Texas", "US-IL": "Illinois", "US-SC": "South Carolina", "US-MO": "Missouri", "US-KY": "Kentucky", "US-IN": "Indiana" };
const classic = (rs) => rs.map(({ category, addresstype, name, address = {}, ...x }) => { const { ["ISO3166-2-lvl4"]: iso, ...a } = address; return { ...x, class: category, address: { ...a, state: a.state || NAMES[iso] }, ...(name ? { namedetails: { name } } : {}) }; });
const dc = (q) => V.decide(q, V.parse(classic(F[q])));
eq([dc("Paycor Stadium").status, dc("Paycor Stadium").place.name, dc("Paycor Stadium").place.address], ["found", "Paycor Stadium", d("Paycor Stadium").place.address], "classic format: a venue by name, same place and address");
eq([dc("6295 Kellogg Ave, Cincinnati, OH 45230").status, dc("6295 Kellogg Ave, Cincinnati, OH 45230").place.name], ["found", "6295 Kellogg Ave"], "classic format: a full street address");
eq([dc("Memorial Stadium").status, dc("Memorial Stadium").candidates.length], ["ambiguous", d("Memorial Stadium").candidates.length], "classic format: an ambiguous name lists the same candidates");
eq(dc("Cincinnati, OH").status, "unknown", "classic format: city-only stays unconfirmed");
ok(/, NE \d{5}$/.test(dc("Memorial Stadium").candidates.find((c) => /Lincoln/.test(c.address)).address), "classic format: state names become codes in addresses");
/* provider choice: LocationIQ only on its authorized origin with a token; the demo host never uses it */
global.BETA_GEOCODER = { locationiq: { key: "pk.test", origins: ["https://forecast-ops-beta.pages.dev"] } };
eq([V.provider({ origin: "https://forecast-ops-beta.pages.dev" }), V.provider({ origin: "https://raw.githack.com" })], ["locationiq", "nominatim"], "LocationIQ on the Cloudflare beta only; the Githack demo never sends the token");
global.BETA_GEOCODER = { locationiq: { key: "", origins: ["https://forecast-ops-beta.pages.dev"] } };
eq(V.provider({ origin: "https://forecast-ops-beta.pages.dev" }), "nominatim", "no token: LocationIQ stays off");

/* cached LocationIQ responses expire after 48 hours (free-plan terms); saved venues are separate user records */
(async () => {
  const mem = {}; global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const calls = []; global.fetch = async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => classic(F["Paycor Stadium"]) }; };
  global.location = { origin: "https://forecast-ops-beta.pages.dev" }; global.BETA_GEOCODER = { locationiq: { key: "pk.beta", origins: ["https://forecast-ops-beta.pages.dev"] } };
  await V.search("Paycor Stadium");
  ok(calls.length === 1 && /us1\.locationiq\.com\/v1\/search/.test(calls[0]) && /key=pk\.beta/.test(calls[0]) && /namedetails=1/.test(calls[0]), "LocationIQ request with the beta token");
  await V.search("Paycor Stadium"); eq(calls.length, 1, "a repeat search within 48 h uses the cached response");
  const k = Object.keys(mem).find((x) => x.startsWith("venue_geo_v2:locationiq:")), c = JSON.parse(mem[k]); c.at = Date.now() - 49 * 3600e3; mem[k] = JSON.stringify(c);
  await V.search("Paycor Stadium"); eq(calls.length, 2, "after 48 h the cached response is dropped and searched again");
  global.location = { origin: "https://raw.githack.com" }; await V.search("TQL Stadium");
  ok(/nominatim\.openstreetmap\.org/.test(calls[2]) && !/pk\.beta/.test(calls[2]), "the demo host's search never carries the LocationIQ token");
  console.log(`ok - ${n} venue search checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

