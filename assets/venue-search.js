/* Venue search for the Event Manager beta: find the actual place (stadium, venue, business, park, school or street
   address) for an event, the way OPE's location setup does: OpenStreetMap Nominatim search, a short list of real
   candidates with addresses, and a dropped pin when search can't find it. City search stays for the forecast tools.

   decide(): one answer per calendar location.
     found      one place (results within ~1.5 km of each other are the same place, e.g. a venue and its building)
     ambiguous  several places in different spots (e.g. "Memorial Stadium" in five states): show the candidates
     unknown    nothing, or only a city / county / bare street: the venue stays unconfirmed
   Pure helpers (parse, decide, formatAddress, km) run in Node; search() and the picker are browser-only.
   Searches are started by the planner on reviewed text only (no automatic lookups of calendar locations, no
   autocomplete); one request a second at most, results cached in this browser for 30 days. */
(function (root) {
  "use strict";
  const ENDPOINT = "https://nominatim.openstreetmap.org/search";
  const AREA = new Set(["city", "town", "village", "hamlet", "municipality", "county", "state", "postcode", "suburb", "neighbourhood", "quarter", "city_district", "borough", "region", "country", "state_district", "district", "province"]);
  const SETTLEMENT = new Set(["city", "town", "village", "hamlet", "municipality"]);
  const SAME_PLACE_KM = 1.5;
  const km = (a, b) => { const R = 6371, t = (x) => (x * Math.PI) / 180, h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const STREET = { Avenue: "Ave", Street: "St", Boulevard: "Blvd", Parkway: "Pkwy", Road: "Rd", Drive: "Dr", Lane: "Ln", Court: "Ct", Place: "Pl", Highway: "Hwy", West: "W", East: "E", North: "N", South: "S" };
  const shortStreet = (r) => String(r || "").split(" ").map((w) => STREET[w] || w).join(" ");

  /* "1 Elm St, Cincinnati, OH 45202" from Nominatim address details */
  function formatAddress(a) {
    a = a || {};
    const street = [a.house_number, shortStreet(a.road)].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || "";
    const st = stateCode(a) || a.state || "";
    return [street, city, [st, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }
  /* Nominatim jsonv2 results → places with a kind */
  const STATES = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
    indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR" };
  const stateCode = (a) => String(a["ISO3166-2-lvl4"] || "").replace(/^US-/, "") || STATES[String(a.state || "").toLowerCase()] || null;
  /* both result formats: Nominatim jsonv2 (category, addresstype, name) and the classic format LocationIQ returns
     (class, no addresstype; the place's own name, when it has one, comes from namedetails or the address part named by its type) */
  function parse(results) {
    return (results || []).map((x0) => {
      const a = x0.address || {}, category = x0.category || x0.class;
      const name = x0.name || (x0.namedetails && (x0.namedetails.name || x0.namedetails["name:en"])) || (category !== "place" && category !== "boundary" && a[x0.type]) || "";
      const at = x0.addresstype || (category === "place" || category === "boundary" ? x0.type : category === "highway" ? "road" : x0.type);
      const x = { ...x0, category, name };
      const named = !!(x.name && String(x.name).trim());
      const kind = AREA.has(at) || x.category === "boundary" ? "area" : at === "road" && !a.house_number ? "street" : named && x.category !== "place" ? "venue" : "address";
      const address = formatAddress(a);
      const settlement = SETTLEMENT.has(at) ? at : category === "boundary" ? [...SETTLEMENT].find(key => norm(a[key]) === norm(name) && norm(name)) : null;
      const state = stateCode(a);
      return { name: kind === "venue" ? x.name : address.split(",")[0] || x.display_name.split(",")[0], address, state, settlement, lat: +(+x.lat).toFixed(5), lon: +(+x.lon).toFixed(5), kind, type: `${x.category}/${x.type}`, osm: x.osm_type && x.osm_id ? `${x.osm_type}/${x.osm_id}` : null, label: x.display_name };
    }).filter((p) => isFinite(p.lat) && isFinite(p.lon));
  }
  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  /* decide what a calendar location points to */
  function decide(location, places) {
    const exact = places.filter((p) => p.kind === "venue" || p.kind === "address");
    if (!exact.length) return { status: "unknown", why: places.some((p) => p.kind === "area") ? "area" : places.some((p) => p.kind === "street") ? "street" : "none", candidates: [] };
    const groups = [];
    exact.forEach((p) => { const g = groups.find((x) => km(x[0], p) <= SAME_PLACE_KM); if (g) g.push(p); else groups.push([p]); });
    /* the best representative of a group: a named venue whose name the location mentions, else the first result */
    const loc = norm(location), addressOnly = /^\s*\d+\s+\S/.test(location);
    const numbered = (p) => /^\d/.test(p.address || ""), named = (p) => p.kind === "venue" && loc.includes(norm(p.name));
    /* prefer the entry the location names, and among those one with a street number (a venue's building over its map point) */
    const best = (g) => (addressOnly ? g.find((p) => p.kind === "address") || g[0] : g.find((p) => named(p) && numbered(p)) || g.find(named) || g.find((p) => p.kind === "venue") || g[0]);
    const reps = groups.map((g) => { const b = best(g); return addressOnly ? { ...b, name: b.address.split(",")[0], kind: "address" } : b; });
    if (reps.length === 1) return { status: "found", place: reps[0], candidates: reps };
    return { status: "ambiguous", candidates: reps.slice(0, 6) };
  }

  /* Calendar locations often carry both a venue name and its street address, e.g.
       "Inter & Co Stadium, 655 W Church St, Orlando, FL 32805, USA"
     Geocoders find neither the whole string nor (always) the name with the street. splitLocation() pulls out the parts:
     the venue name (everything before the part that starts with a house number), the street, city, state and ZIP.
     null when the text is not "name + street address" (a name alone, an address alone, a city). */
  function splitLocation(text) {
    const parts = String(text || "").split(",").map((x) => x.trim()).filter(Boolean);
    while (parts.length && /^(usa|us|u\.s\.a?\.?|united states( of america)?)$/i.test(parts[parts.length - 1])) parts.pop();
    const k = parts.findIndex((x) => /^\d+[a-z]?(-\d+)?\s+\S/i.test(x));
    if (k < 1 || k + 1 >= parts.length) return null;
    const venue = parts.slice(0, k).join(", "), street = parts[k], rest = parts.slice(k + 1);
    let city = rest[0] || "", state = "", zip = "";
    const tail = rest[rest.length - 1].match(/^([A-Za-z]{2}|[A-Za-z ]{4,})\s*(\d{5}(-\d{4})?)?$/);
    if (rest.length >= 2 && tail) { state = tail[1].length === 2 ? tail[1].toUpperCase() : STATES[tail[1].trim().toLowerCase()] || tail[1].trim(); zip = tail[2] || ""; city = rest.slice(0, -1).join(", "); }
    else { const m = city.match(/^(.*?)\s+([A-Z]{2})\s*(\d{5})?$/); if (m) { city = m[1]; state = m[2]; zip = m[3] || ""; } }
    if (!city || /^\d/.test(city)) return null;
    const area = [city, state].filter(Boolean).join(", ");
    return { venue, street, city, state, zip, nameQuery: `${venue}, ${area}`, addressQuery: [street, area + (zip ? ` ${zip}` : "")].join(", ") };
  }
  const MATCH_KM = 0.5;   // a named result this close to the calendar's street address is the same place
  /* Resolve a calendar or typed location, venue name first. Returns decide()'s shape plus `note`:
       found      one place; for "name + address" text the venue name stays the label (the address is the place's)
       ambiguous  the planner chooses (several places, the name and address disagree, or only the address was found)
       unknown    nothing usable
     searchFn is search() in the browser; tests pass recorded answers. */
  async function resolve(text, searchFn = search) {
    const s = splitLocation(text);
    if (!s) { const r = decide(text, await searchFn(text)); return { ...r, via: "text" }; }
    const label = (p, via) => ({ ...p, name: s.venue, matched: p.name, via });
    const inState = (p) => !s.state || !p.state || p.state === s.state;
    const byName = decide(s.nameQuery, await searchFn(s.nameQuery));
    const named = (byName.status === "found" ? [byName.place] : byName.candidates || []).filter(inState);
    let addr = null;
    const address = async () => { if (addr) return addr; const r = decide(s.addressQuery, await searchFn(s.addressQuery)); addr = r.status === "found" ? r.place : null; return addr; };
    if (named.length) {
      const a = await address();
      if (a) {
        const near = named.filter((p) => km(p, a) <= MATCH_KM);
        /* confirmed by the address: the stadium's own map point, shown with the calendar's street address */
        if (near.length === 1) { const pl = { ...label(near[0], "name+address"), address: a.address || s.addressQuery };
          return { status: "found", place: pl, candidates: [pl], via: "name+address", note: `${near[0].name} matches ${s.street}.` }; }
        if (near.length > 1) return { status: "ambiguous", candidates: near.map((p) => label(p, "name+address")), via: "name+address", note: "Several places at this address. Choose one:" };
        /* the name points somewhere else: let the planner choose, the address first */
        return { status: "ambiguous", candidates: [label({ ...a, kind: "address" }, "address"), ...named.slice(0, 5).map((p) => ({ ...p, via: "name" }))], via: "conflict",
          note: `“${s.venue}” was found away from ${s.street}. Choose the right place:` };
      }
      if (named.length === 1) return { status: "found", place: label(named[0], "name"), candidates: [label(named[0], "name")], via: "name", note: `Found by name; ${s.street} could not be checked.` };
      return { status: "ambiguous", candidates: named.slice(0, 6).map((p) => label(p, "name")), via: "name", note: `“${s.venue}” matches several places. Choose one:` };
    }
    const a = await address();
    if (a) { const c = label({ ...a, kind: "address" }, "address"); return { status: "ambiguous", candidates: [c], via: "address", note: `“${s.venue}” wasn't found by name; ${s.street} was. Confirm it's the venue:` }; }
    return { status: "unknown", why: byName.why || "none", candidates: [], via: "none" };
  }

  /* where the label and the map's own name differ, say how the place was matched */
  const matchNote = (p) => { const e = root.Ops ? root.Ops.esc : (x) => x;
    return p.via === "address" ? " · matched by street address" : p.matched && norm(p.matched) !== norm(p.name) ? ` · on the map as ${e(p.matched)}` : ""; };

  /* a U.S. venue's time zone from its state (and longitude where a state spans two zones): the fallback when the
     time-zone lookup service is unavailable, so an out-of-town venue never takes the calendar's zone by mistake */
  const ZONE = { AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York",
    FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago", KS: "America/Chicago", KY: "America/Kentucky/Louisville",
    LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
    NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles",
    PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
    WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver", PR: "America/Puerto_Rico" };
  function tzGuess(p) {
    const st = p && (p.state || (String(p.address || "").match(/,\s*([A-Z]{2})(\s+\d{5})?\s*$/) || [])[1]); if (!st || !ZONE[st]) return null;
    const lon = +p.lon, lat = +p.lat;
    if (st === "TN" && lon > -85.3) return "America/New_York"; // East Tennessee
    if (st === "KY" && lon < -86.0) return "America/Chicago"; // western Kentucky
    if (st === "IN" && (lat > 41.0 && lon < -86.8 || lat < 38.4 && lon < -87.0)) return "America/Chicago"; // NW and SW corners
    if (st === "FL" && lon < -85.0) return "America/Chicago"; // western panhandle
    if (st === "MI" && lon < -87.6) return "America/Menominee";
    if ((st === "NE" && lon < -101.0) || (st === "KS" && lon < -101.5) || (st === "SD" && lon < -100.5) || (st === "ND" && lon < -101.5 && lat < 47.0)) return "America/Denver";
    if (st === "TX" && lon < -104.9) return "America/Denver"; // El Paso
    if (st === "ID" && lat > 45.4) return "America/Los_Angeles"; // northern Idaho
    if (st === "OR" && lon > -117.6 && lat < 44.5) return "America/Boise"; // Malheur County
    return ZONE[st];
  }

  /* ---------------- browser: cached, rate-limited search ---------------- */
  const CACHE = "venue_geo_v3:", DAY = 864e5;
  const store = () => { try { return root.localStorage; } catch (e) { return null; } };
  let last = 0, chain = Promise.resolve();
  /* Searches run only when a planner presses Search on text they have reviewed: never automatically for calendar
     locations, never as-you-type. The provider is set in beta-config.js (BETA_GEOCODER); "nominatim" is the public
     OpenStreetMap service OPE uses, suitable only for these occasional, user-started, reviewed searches. */
  /* LocationIQ (Search by LocationIQ.com) on its authorized origin when a token is set; elsewhere (e.g. the Githack demo)
     the reviewed public search. Cached responses: 48 h for LocationIQ (free-plan terms), 30 days otherwise. */
  function provider(loc = root.location) {
    const c = root.BETA_GEOCODER || {}, l = c.locationiq || {};
    if (l.key && loc && Array.isArray(l.origins) && l.origins.includes(loc.origin)) return "locationiq";
    return "nominatim";
  }
  const PROVIDERS = {
    nominatim: { url: ENDPOINT, ttl: 30 * DAY, params: (q) => ({ format: "jsonv2", addressdetails: "1", countrycodes: "us", limit: "6", q }) },
    locationiq: { url: "https://us1.locationiq.com/v1/search", ttl: 2 * DAY, params: (q) => ({ key: (root.BETA_GEOCODER.locationiq || {}).key, format: "json", addressdetails: "1", namedetails: "1", countrycodes: "us", limit: "6", q }) },
  };
  const attribution = () => (provider() === "locationiq" ? '<a class="vs-attr" href="https://locationiq.com" target="_blank" rel="noopener">Search by LocationIQ.com</a>' : '<span class="vs-attr">Search: © OpenStreetMap contributors</span>');
  function search(q) {
    const P = PROVIDERS[provider()];
    const key = CACHE + provider() + ":" + norm(q), s = store();
    try { const c = s && JSON.parse(s.getItem(key)); if (c && Date.now() - c.at < P.ttl) return Promise.resolve(c.places); if (c) s.removeItem(key); } catch (e) { /* ignore */ }
    const run = async () => {
      const wait = Math.max(0, last + 1100 - Date.now()); if (wait) await new Promise((ok) => setTimeout(ok, wait)); last = Date.now();
      const u = new URL(P.url); Object.entries(P.params(q)).forEach(([k, v]) => u.searchParams.set(k, v));
      const ctl = typeof AbortController === "function" ? new AbortController() : null, to = ctl && setTimeout(() => ctl.abort(), 15000);
      try { const r = await fetch(u, { headers: { Accept: "application/json" }, signal: ctl && ctl.signal }); if (r.status === 404) return []; if (!r.ok) throw new Error(`HTTP ${r.status}`); const places = parse(await r.json());
        try { s && s.setItem(key, JSON.stringify({ at: Date.now(), places })); } catch (e) { /* storage full */ } return places; }
      finally { if (to) clearTimeout(to); }
    };
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  }
  /* ---------------- browser: drop a pin (Leaflet + OpenStreetMap tiles, loaded on first use) ---------------- */
  let leaflet = null;
  const loadLeaflet = () => leaflet || (leaflet = new Promise((ok, no) => {
    if (root.L) return ok(root.L);
    const css = root.document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; root.document.head.append(css);
    const s = root.document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload = () => ok(root.L); s.onerror = () => { leaflet = null; no(new Error("The map didn't load.")); }; root.document.head.append(s);
  }));
  function pinDialog(start) {
    return new Promise((done) => {
      const d = root.document.createElement("dialog"); d.className = "vs-pin";
      d.innerHTML = `<form method="dialog" class="bx-form"><h2>Drop a pin at the venue</h2><p class="bx-note" style="margin:0">Tap the map where the event is; drag the pin to adjust. The forecast uses this exact point.</p>
        <div class="vs-map" id="vsMap"></div><p class="bx-note" id="vsPinAt" style="margin:0">No pin yet.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button class="bx-btn" value="cancel">Cancel</button><button class="bx-btn primary" value="ok" id="vsPinOk" disabled>Use this point</button></div></form>`;
      root.document.body.append(d); d.showModal();
      let pin = null;
      loadLeaflet().then((L) => {
        const map = L.map(d.querySelector("#vsMap")).setView(start ? [start.lat, start.lon] : [39.1, -84.51], start ? 16 : 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
        let m = null; const set = (ll) => { pin = { lat: +ll.lat.toFixed(5), lon: +ll.lng.toFixed(5) }; if (!m) { m = L.marker(ll, { draggable: true }).addTo(map); m.on("dragend", () => set(m.getLatLng())); } else m.setLatLng(ll); d.querySelector("#vsPinAt").textContent = `Pin at ${pin.lat}, ${pin.lon}`; d.querySelector("#vsPinOk").disabled = false; };
        map.on("click", (e) => set(e.latlng)); if (start) set({ lat: start.lat, lng: start.lon });
        setTimeout(() => map.invalidateSize(), 50);
      }).catch((e) => { d.querySelector("#vsMap").innerHTML = `<p class="err" style="padding:12px">${String(e.message)} Enter coordinates instead.</p>`; });
      d.addEventListener("close", () => { const v = d.returnValue === "ok" ? pin : null; d.remove(); done(v); });
    });
  }

  /* ---------------- browser: venue picker (search box, candidates, drop a pin) ----------------
     onPick(place) with { name, address, lat, lon, kind } */
  function picker(host, { initial = "", onPick, onNewSearch, allowArea = false, label = "Venue name or street address" } = {}) { // searches only on Search / Enter
    const esc = root.Ops.esc, id = `vs${Math.random().toString(36).slice(2, 8)}`;
    host.innerHTML = `<div class="vs"><div class="vs-row"><input type="search" class="vs-q" id="${id}" aria-label="${esc(label)}" placeholder="${esc(label)}" value="${esc(initial)}"><button type="button" class="bx-btn vs-go">Search</button><button type="button" class="bx-btn vs-pinbtn">Drop a pin</button></div>
      <div class="vs-msg bx-note" aria-live="polite"></div><div class="vs-res"></div><div class="vs-foot bx-note">${attribution()}</div></div>`;
    const q = host.querySelector(".vs-q"), msg = host.querySelector(".vs-msg"), res = host.querySelector(".vs-res");
    let searchId = 0;
    const show = (places, note) => {
      msg.textContent = note || "";
      res.innerHTML = places.map((p, i) => `<button type="button" class="vs-hit" data-i="${i}"><b>${esc(p.kind === "area" ? `Use ${p.name} for planning` : p.name)}</b><span class="bx-note">${esc(p.address || p.label || "")}${p.kind === "area" ? " · area forecast" : ""}${matchNote(p)}</span></button>`).join("");
      res.querySelectorAll(".vs-hit").forEach((b) => b.addEventListener("click", () => { const p = places[+b.dataset.i]; res.innerHTML = ""; msg.textContent = `Selected: ${p.name}${p.address ? " · " + p.address : ""}`; if (onPick) onPick(p); }));
    };
    const go = async () => {
      const text = q.value.trim(); if (!text) return;
      const id = ++searchId;
      if (onNewSearch) onNewSearch();
      msg.textContent = "Searching…"; res.innerHTML = "";
      try {
        if (splitLocation(text)) { /* "venue, street address": venue name + city first, the address checks it or stands in */
          const r = await resolve(text); if (id !== searchId) return;
          if (r.status === "unknown") show([], `Neither “${splitLocation(text).venue}” nor the street address was found. Try the venue name with its city, or drop a pin.`);
          else show(r.status === "found" ? [r.place] : r.candidates, r.note ? r.note + (r.status === "found" ? " Select it to use it." : "") : "");
          return;
        }
        const places = await search(text), exact = places.filter((p) => p.kind !== "area" && p.kind !== "street");
        if (id !== searchId) return;
        const cities = allowArea ? places.filter(p => p.kind === "area" && p.settlement) : [];
        if (!exact.length && cities.length) show(cities.slice(0, 6), "Choose a city for an area forecast, or search for a venue or street address for a site-specific forecast.");
        else if (!exact.length) show([], places.length ? `Only a ${places[0].kind === "street" ? "street" : "city or area"} matches "${text}". Search for the venue name or street address, or drop a pin.` : `No place found for "${text}". Try the venue name with its city, or drop a pin.`);
        else show(exact.slice(0, 6), exact.length > 1 ? "Choose the place:" : "");
      } catch (e) { if (id === searchId) show([], "Venue search is unavailable right now. Drop a pin or enter coordinates."); }
    };
    q.addEventListener("input", () => {
      searchId++;
      show([], "");
      if (onNewSearch) onNewSearch();
    });
    host.querySelector(".vs-go").addEventListener("click", go);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    host.querySelector(".vs-pinbtn").addEventListener("click", async () => { const id = ++searchId, p = await pinDialog(null); if (p && id === searchId) { const place = { name: q.value.trim() || "Dropped pin", address: `Pin at ${p.lat}, ${p.lon}`, lat: p.lat, lon: p.lon, kind: "pin" }; msg.textContent = `Selected: ${place.address}`; res.innerHTML = ""; if (onPick) onPick(place); } });
    return { search: go, set(v) { q.value = v; } };
  }

  const api = { provider, attribution, tzGuess, parse, decide, formatAddress, km, search, picker, pinDialog, SAME_PLACE_KM, splitLocation, resolve, MATCH_KM, matchNote };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.VenueSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
