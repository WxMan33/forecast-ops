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

/* calendar locations with both a venue name and a street address (Inter&Co Stadium, Orlando: real answers recorded
   2026-11-19; OpenStreetMap names it "Inter.co Stadium" on W Pine St, ~110 m from 655 W Church St) */
const ORL = "Inter & Co Stadium, 655 W Church St, Orlando, FL 32805, USA";
eq(V.splitLocation(ORL), { venue: "Inter & Co Stadium", street: "655 W Church St", city: "Orlando", state: "FL", zip: "32805", nameQuery: "Inter & Co Stadium, Orlando, FL", addressQuery: "655 W Church St, Orlando, FL 32805" }, "the pasted calendar location splits into venue, street, city, state and ZIP");
eq(F[ORL], [], "the whole pasted string finds nothing (why the split is needed)");
eq(["655 W Church St, Orlando, FL 32805", "Inter & Co Stadium", "Inter & Co Stadium, Orlando", "Cincinnati, OH", "Memorial Stadium"].map(V.splitLocation), [null, null, null, null, null], "address only, name only, name + city and city are not split");
eq(V.splitLocation("Riverbend Music Center, 6295 Kellogg Ave, Cincinnati, Ohio 45230").state, "OH", "state names become codes");
const recorded = (asked, edit = {}) => async (q) => { asked.push(q); return V.parse(q in edit ? edit[q] : F[q] || []); };
const NQ = "Inter & Co Stadium, Orlando, FL", AQ = "655 W Church St, Orlando, FL 32805";
(async () => {
  let asked = [], r = await V.resolve(ORL, recorded(asked));
  eq(asked, [NQ, AQ], "name + city first, then the address to check it; the raw pasted string is never sent");
  eq([r.status, r.place.name, r.place.matched, r.place.lat, r.place.lon, r.place.address, r.via], ["found", "Inter & Co Stadium", "Inter.co Stadium", 28.5411, -81.38914, "655 W Church St, Orlando, FL 32805", "name+address"], "exact Orlando input: the stadium's map point, labelled and addressed as the calendar gives them");
  ok(/matches 655 W Church St/.test(r.note) && V.matchNote(r.place) === "", "says it matched the address; no 'on the map as' note when the names differ only in punctuation");
  ok(/on the map as Inter Miami Stadium/.test(V.matchNote({ ...r.place, matched: "Inter Miami Stadium" })), "a differently named map entry is shown");
  asked = []; r = await V.resolve(AQ, recorded(asked));
  eq([asked, r.status, r.place.kind, r.place.name], [[AQ], "found", "address", "655 W Church St"], "address-only search: found at the address, named by it");
  ok(V.km(r.place, { lat: 28.5411, lon: -81.3891 }) < 0.2, "address result is at the stadium");
  r = await V.resolve("Inter & Co Stadium", recorded([]));
  eq([r.status, r.place.name, r.place.kind], ["found", "Inter.co Stadium", "venue"], "venue name alone: found");
  r = await V.resolve("Inter & Co Stadium, Orlando", recorded([]));
  eq([r.status, r.place.lat, r.place.lon], ["found", 28.5411, -81.38914], "venue name with city: found");
  /* the name search comes up empty: the address stands in, keeps the venue's name, and must be confirmed */
  asked = []; r = await V.resolve(ORL, recorded(asked, { [NQ]: [] }));
  eq([asked, r.status, r.candidates.length, r.candidates[0].name, r.candidates[0].address, r.candidates[0].via], [[NQ, AQ], "ambiguous", 1, "Inter & Co Stadium", "655 W Church St, Orlando, FL 32805", "address"], "name not found: the address result is offered as Inter & Co Stadium for the planner to confirm");
  ok(/Confirm it's the venue/.test(r.note) && /matched by street address/.test(V.matchNote(r.candidates[0])), "asks for confirmation and says it matched by address");
  /* the named result is somewhere else: both are offered, address first */
  const far = F[NQ].map((x) => ({ ...x, lat: "28.6000", lon: "-81.2000" }));
  r = await V.resolve(ORL, recorded([], { [NQ]: far }));
  eq([r.status, r.via, r.candidates.map((c) => c.via), r.candidates[0].name], ["ambiguous", "conflict", ["address", "name"], "Inter & Co Stadium"], "name and address disagree: the planner chooses");
  /* the name finds it but the address lookup finds nothing: still found, with a note */
  r = await V.resolve(ORL, recorded([], { [AQ]: [] }));
  eq([r.status, r.place.name, r.via], ["found", "Inter & Co Stadium", "name"], "address not found: the named stadium, noted as unchecked");
  /* other provider shape (LocationIQ classic format) gives the same answer */
  r = await V.resolve(ORL, async (q) => V.parse(classic(F[q] || [])));
  eq([r.status, r.place.name, r.place.lat], ["found", "Inter & Co Stadium", 28.5411], "classic format: same result");
  /* Barleycorn's (Northern Kentucky): two restaurants with the same name; OpenStreetMap writes Barleycorn’s with a curly
     apostrophe and files the Dixie Highway one under Fort Mitchell, while its postal address says Lakeside Park */
  for (const [cal, nq, aq, lat] of [["Barleycorn's, 2642 Dixie Hwy, Lakeside Park, KY 41017, USA", "Barleycorn's, Lakeside Park, KY", "2642 Dixie Hwy, Lakeside Park, KY 41017", 39.03308],
    ["Barleycorn's, 1073 Industrial Rd, Cold Spring, KY 41076, USA", "Barleycorn's, Cold Spring, KY", "1073 Industrial Rd, Cold Spring, KY 41076", 39.02819]]) {
    asked = []; r = await V.resolve(cal, recorded(asked));
    eq([asked, r.status, r.place.name, r.place.address, r.place.lat, r.via], [[nq, aq], "found", "Barleycorn's", aq, lat, "name+address"], `${cal}: the right Barleycorn's, by name and address`);
  }
  r = await V.resolve("Barleycorn's", recorded([]));
  eq([r.status, r.candidates.length, r.candidates.map((c) => c.address.split(", ")[1]).sort()], ["ambiguous", 2, ["Cold Spring", "Fort Mitchell"]], "Barleycorn's alone: the planner chooses between the two");
  /* neither found */
  r = await V.resolve(ORL, async () => []); eq(r.status, "unknown", "nothing found: unknown");
})().then(() => cacheChecks()).catch((e) => { console.error(e); process.exit(1); });

/* cached LocationIQ responses expire after 48 hours (free-plan terms); saved venues are separate user records */
async function cacheChecks() {
  const mem = {}; global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const calls = []; global.fetch = async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => classic(F["Paycor Stadium"]) }; };
  global.location = { origin: "https://forecast-ops-beta.pages.dev" }; global.BETA_GEOCODER = { locationiq: { key: "pk.beta", origins: ["https://forecast-ops-beta.pages.dev"] } };
  await V.search("Paycor Stadium");
  ok(calls.length === 1 && /us1\.locationiq\.com\/v1\/search/.test(calls[0]) && /key=pk\.beta/.test(calls[0]) && /namedetails=1/.test(calls[0]), "LocationIQ request with the beta token");
  await V.search("Paycor Stadium"); eq(calls.length, 1, "a repeat search within 48 h uses the cached response");
  const k = Object.keys(mem).find((x) => x.startsWith("venue_geo_v3:locationiq:")), c = JSON.parse(mem[k]); c.at = Date.now() - 49 * 3600e3; mem[k] = JSON.stringify(c);
  await V.search("Paycor Stadium"); eq(calls.length, 2, "after 48 h the cached response is dropped and searched again");
  global.location = { origin: "https://raw.githack.com" }; await V.search("TQL Stadium");
  ok(/nominatim\.openstreetmap\.org/.test(calls[2]) && !/pk\.beta/.test(calls[2]), "the demo host's search never carries the LocationIQ token");
  console.log(`ok - ${n} venue search checks passed`);
}

