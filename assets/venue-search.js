/* Venue search for the Event Manager beta: find the actual place (stadium, venue, business, park, school or street
   address) for an event, the way OPE's location setup does: OpenStreetMap Nominatim search, a short list of real
   candidates with addresses, and a dropped pin when search can't find it. City search stays for the forecast tools.

   decide(): one answer per calendar location.
     found      one place (results within ~1.5 km of each other are the same place, e.g. a venue and its building)
     ambiguous  several places in different spots (e.g. "Memorial Stadium" in five states): show the candidates
     unknown    nothing, or only a city / county / bare street: the venue stays unconfirmed
   Pure helpers (parse, decide, formatAddress, km) run in Node; search() and the picker are browser-only.
   Nominatim usage policy: at most one request per second, results cached in this browser for 30 days. */
(function (root) {
  "use strict";
  const ENDPOINT = "https://nominatim.openstreetmap.org/search";
  const AREA = new Set(["city", "town", "village", "hamlet", "municipality", "county", "state", "postcode", "suburb", "neighbourhood", "quarter", "city_district", "borough", "region", "country", "state_district", "district", "province"]);
  const SAME_PLACE_KM = 1.5;
  const km = (a, b) => { const R = 6371, t = (x) => (x * Math.PI) / 180, h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const STREET = { Avenue: "Ave", Street: "St", Boulevard: "Blvd", Parkway: "Pkwy", Road: "Rd", Drive: "Dr", Lane: "Ln", Court: "Ct", Place: "Pl", Highway: "Hwy", West: "W", East: "E", North: "N", South: "S" };
  const shortStreet = (r) => String(r || "").split(" ").map((w) => STREET[w] || w).join(" ");

  /* "1 Elm St, Cincinnati, OH 45202" from Nominatim address details */
  function formatAddress(a) {
    a = a || {};
    const street = [a.house_number, shortStreet(a.road)].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || "";
    const st = String(a["ISO3166-2-lvl4"] || "").replace(/^US-/, "") || a.state || "";
    return [street, city, [st, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }
  /* Nominatim jsonv2 results → places with a kind */
  function parse(results) {
    return (results || []).map((x) => {
      const at = x.addresstype || x.type, a = x.address || {}, named = !!(x.name && x.name.trim());
      const kind = AREA.has(at) || x.category === "boundary" ? "area" : at === "road" && !a.house_number ? "street" : named && x.category !== "place" ? "venue" : "address";
      const address = formatAddress(a);
      const state = String(a["ISO3166-2-lvl4"] || "").replace(/^US-/, "") || null;
      return { name: kind === "venue" ? x.name : address.split(",")[0] || x.display_name.split(",")[0], address, state, lat: +(+x.lat).toFixed(5), lon: +(+x.lon).toFixed(5), kind, type: `${x.category}/${x.type}`, osm: x.osm_type && x.osm_id ? `${x.osm_type}/${x.osm_id}` : null, label: x.display_name };
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
  const CACHE = "venue_geo_v1:", DAY = 864e5;
  const store = () => { try { return root.localStorage; } catch (e) { return null; } };
  let last = 0, chain = Promise.resolve();
  function search(q) {
    const key = CACHE + norm(q), s = store();
    try { const c = s && JSON.parse(s.getItem(key)); if (c && Date.now() - c.at < 30 * DAY) return Promise.resolve(c.places); } catch (e) { /* ignore */ }
    const run = async () => {
      const wait = Math.max(0, last + 1100 - Date.now()); if (wait) await new Promise((ok) => setTimeout(ok, wait)); last = Date.now();
      const u = new URL(ENDPOINT); Object.entries({ format: "jsonv2", addressdetails: "1", countrycodes: "us", limit: "6", q }).forEach(([k, v]) => u.searchParams.set(k, v));
      const ctl = typeof AbortController === "function" ? new AbortController() : null, to = ctl && setTimeout(() => ctl.abort(), 15000);
      try { const r = await fetch(u, { headers: { Accept: "application/json" }, signal: ctl && ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const places = parse(await r.json());
        try { s && s.setItem(key, JSON.stringify({ at: Date.now(), places })); } catch (e) { /* storage full */ } return places; }
      finally { if (to) clearTimeout(to); }
    };
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  }
  /* saved venues and remembered locations first (EventStore.matchVenue), then the map search */
  async function resolve(location, venues) {
    const E = root.EventStore, m = E.matchVenue(location, venues);
    if (m.status === "matched") return { status: "matched", venue: m.venue, via: m.via };
    if (!String(location || "").trim()) return { status: "unknown", why: "blank", candidates: [] };
    try { return { ...decide(location, await search(location)), searched: true }; }
    catch (e) { return { status: "unknown", why: "failed", candidates: [], error: String(e.message || e) }; }
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
  function picker(host, { initial = "", onPick, label = "Venue name or street address", auto = false } = {}) {
    const esc = root.Ops.esc, id = `vs${Math.random().toString(36).slice(2, 8)}`;
    host.innerHTML = `<div class="vs"><div class="vs-row"><input type="search" class="vs-q" id="${id}" aria-label="${esc(label)}" placeholder="${esc(label)}" value="${esc(initial)}"><button type="button" class="bx-btn vs-go">Search</button><button type="button" class="bx-btn vs-pinbtn">Drop a pin</button></div>
      <div class="vs-msg bx-note" aria-live="polite"></div><div class="vs-res"></div></div>`;
    const q = host.querySelector(".vs-q"), msg = host.querySelector(".vs-msg"), res = host.querySelector(".vs-res");
    const show = (places, note) => {
      msg.textContent = note || "";
      res.innerHTML = places.map((p, i) => `<button type="button" class="vs-hit" data-i="${i}"><b>${esc(p.name)}</b><span class="bx-note">${esc(p.address || p.label || "")}${p.kind === "area" ? " · area only" : ""}</span></button>`).join("");
      res.querySelectorAll(".vs-hit").forEach((b) => b.addEventListener("click", () => { const p = places[+b.dataset.i]; res.innerHTML = ""; msg.textContent = `Selected: ${p.name}${p.address ? " · " + p.address : ""}`; if (onPick) onPick(p); }));
    };
    const go = async () => {
      const text = q.value.trim(); if (!text) return;
      msg.textContent = "Searching…"; res.innerHTML = "";
      try {
        const places = await search(text), exact = places.filter((p) => p.kind !== "area" && p.kind !== "street");
        if (!exact.length) show([], places.length ? `Only a ${places[0].kind === "street" ? "street" : "city or area"} matches "${text}". Search for the venue name or street address, or drop a pin.` : `No place found for "${text}". Try the venue name with its city, or drop a pin.`);
        else show(exact.slice(0, 6), exact.length > 1 ? "Choose the place:" : "");
      } catch (e) { show([], "Venue search is unavailable right now. Drop a pin or enter coordinates."); }
    };
    host.querySelector(".vs-go").addEventListener("click", go);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    host.querySelector(".vs-pinbtn").addEventListener("click", async () => { const p = await pinDialog(null); if (p) { const place = { name: q.value.trim() || "Dropped pin", address: `Pin at ${p.lat}, ${p.lon}`, lat: p.lat, lon: p.lon, kind: "pin" }; msg.textContent = `Selected: ${place.address}`; res.innerHTML = ""; if (onPick) onPick(place); } });
    if (auto && initial) go();
    return { search: go, set(v) { q.value = v; } };
  }

  const api = { tzGuess, parse, decide, formatAddress, km, search, resolve, picker, pinDialog, SAME_PLACE_KM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.VenueSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
