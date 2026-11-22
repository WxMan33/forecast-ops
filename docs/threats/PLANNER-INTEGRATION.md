# Weather Threats ↔ Event Planner: flooding and winter weather

Winter weather is described in `WINTER.md`, fire weather and wildfire in `FIRE.md`, smoke and air quality in `SMOKE.md`, tropical and coastal in `TROPICAL-COASTAL.md`, aviation in `AVIATION.md`; all use the same records, matcher and checks.

Branch `claude/threats-planner-flood` (from the Threats branch at `2fd03e7`). Isolated Cloudflare Pages preview:
`https://claude-threats-planner-flood.forecast-ops-beta.pages.dev`. Shared beta, production and navigation are unchanged.

## Sources (verified 2026-11-20)

| Product | Source used | Notes |
|---|---|---|
| NWS Flash Flood Warning | `api.weather.gov/alerts/active?event=…,Flash Flood Warning`, the same request as the severe products, through `/api/nws` on the preview | 92 real messages in the 7-day window (42 Alert, 35 Update, 15 Cancel), **all with polygons**. VTEC phenomenon `FF.W`. Parameters `flashFloodDetection` and `flashFloodDamageThreat`. CORS `*`. |
| WPC Excessive Rainfall Outlook, Days 1–3 | WPC's own `https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/DayN_Latest.geojson`, through `/api/wpc/ero/dayN` on the preview | Fields `OUTLOOK` ("High (At Least 70%)"…), `ISSUE_TIME`, `START_TIME` and `END_TIME` in UTC, `VALID_TIME`. **No CORS header**, so the browser needs the same-origin function. One feature per category; the categories are bands, so a point falls in exactly one. |
| (fallback) WPC ERO mirror | NOAA map service `hazards/wpc_precip_hazards/MapServer/{0-4}` | Same fields in lower case, CORS echoes the origin. **Seen empty for Day 1 more than four hours after WPC issued a Day 1 with a High risk**, so an empty mirror answer is treated as unconfirmed, never as "no areas". Used only where the WPC function is not available. |

WPC also publishes Days 4–5. The map and Planner use Days 1–3 in this slice, and Planner says when an event runs past the outlooks.

## One representation, one matcher

- `assets/threats-feeds.js`: one adapter per feed, all producing the same record. Each record has an `id`, `kind` (warning / watch / md / outlook), `family`
  (`severe`, `flood`), `sourceId`, `program`, `issued`/`updated`, a valid window or `expires`, the geometry, and `source` (name and official URL). Freshness comes from the
  per-source store: last confirmed check, stale, unavailable. The source registry `SOURCES` gives each provider an explicit **coverage
  area**, so a venue outside it reads "not covered by this source", never "nothing". New regions and providers are new entries.
- `assets/threats-match.js`: the shared matcher. It checks that the product's own footprint covers the venue pin, and that the product's own
  window overlaps the event's phases (setup, gates, event, teardown), comparing real instants and displaying in the event's time zone.
  It returns one item per warning and one per outlook issuance and period, at the highest category at the venue. Each source gets a status line, and
  "no threats" is said only when every source is confirmed and its outlooks reach the end of the event.
- The **map** (`threats.html`) and **Event Planner** (`event-beta.html`, "Weather threats" section) both read these records
  (`assets/threats-live.js`). Planner knows nothing about individual feeds: adding a hazard means adding an adapter and registry entry, plus
  `family` in Planner's list.

## What a planner sees

- "Flash Flood Warning until 2:30 p.m. · Covers the venue during setup, gates and the event."
- "Excessive rainfall risk Friday · High (at least 70%) · The WPC Day 1 outlook includes the venue and its period (Fri 11 a.m. – Sat 7 a.m.)
  overlaps gates, the event and teardown. It is a risk for the whole period, not timing within it."
- **More info:** the issuing office and official product link, issued (and updated) time, valid window or "in effect until", when the source was
  last checked successfully, and the venue relationship.
- **View on map:** the interactive map centered on the venue, with the product's time view (Active now / Day N), the Flooding layer and the
  product selected. People can then pan, zoom and turn layers on.
- **Sources checked for this event:** each source's check time, or why it can't confirm (not responding, stale, outside its area, beyond the
  outlooks issued so far).

## Verification (Cloudflare preview, `node tools/threats-planner-check.js <host>`; flooding cases rerun with winter, see `planner-check/report.json`)

The archived samples are official NWS and WPC products from 2026-11-20, replayed at fixed times. Planner links use
`?threats=archive-flood-day|archive-flood-afternoon|archive-flood-night` and are labelled "Archived sample".

| Case | Result |
|---|---|
| Daytona International Speedway, Fri 9 a.m.–6 p.m. (archived, 12:35 p.m.) | Two items: Flash Flood Warning (KMLB 0036) and WPC Day 1 **High** |
| More info / View on map | Source, issued 10:04 · updated 12:23, until 2:30 p.m., last checked, venue, NWS record link. Both map links open on the venue with the right view, layer and product. |
| Venue moved to Atlanta | No items; "No flooding threats apply" only because both sources were confirmed |
| Same page: venue out and back, hours moved before the products and back | 2 → 0 → 2 → 0 → 2 |
| Event moved to Monday | No items; "Not fully confirmed", because the event runs past the outlooks issued so far |
| Overnight, Fri 9 p.m.–Sat 9 a.m. (archived, 3:30 p.m.) | Day 1 High (setup + gates + event) and Day 2 Marginal (event + teardown) |
| Flagler County Fairgrounds: the real KJAX 0054 update cut the polygon back | Warning item at 12:35 p.m.; gone at 2:20 p.m.; the WPC Moderate item stays |
| Live, Daytona on Saturday | "Excessive rainfall risk Saturday · Marginal (at least 5%)" from WPC's 2012Z Day 2. NWS and WPC requests go through the same-origin functions with their upstream times. |
| NWS route blocked in the browser (simulated outage) | "NWS warnings and watches: Not responding · status unknown"; summary "Not fully confirmed…", never "no threats" |
| Phone | No horizontal scroll |

Unit tests: `tests/threats-match.test.js` (12, on the archived products), `tests/threats-functions.test.mjs` (5),
`tests/threats-feeds.test.js` (31), `tests/threats-core.test.js` (17).

## Open

- The live severe-warning check from the Threats branch is still pending (independent of this branch).
- Event Manager's existing NWS point forecast and alert-banner requests still go straight to api.weather.gov. Only the Weather Threats
  feeds use the identifying function.
- Matching uses the venue pin only. Alternate sites (parking, arrival airport) are the next step: the matcher already takes a location per call.
- Nearby flash flood warnings (within a few miles, not covering the pin) are shown on the map but not yet listed in Planner.
- Email, text, push and export are outside this slice.

## Combining with the Event Manager beta (notes from the Event Manager session, 2026-11-21)

This branch is based on `main`. The Event Manager beta (`beta-previews`, working branch `claude/event-dashboard`) has since changed the files Weather Threats hooks into:
- **`event-beta.html`:** beta adds a Share menu, `#outlook`, `#daylight` inside `#secTimeline` and `#hourlyDaylight` in `#secHourly`, plus two scripts before `event-briefing-ui.js`. Expect a text conflict around `#secThreats` (right after `#secTimeline`) and in the script list. Rerun `node tools/stamp-assets.js` after merging.
- **`assets/beta-event.js`:** the one-line `window.EventThreats.update(ev)` call in `context()` should apply cleanly. The schedule now renders at load start via `showSchedule()`.
- **Untouched here:** `event-store.js`, `beta-upcoming.js`, `event-tv-export.js`, `event-outlook.js` and the beta check sections 14 and 14b.

The user decides when, and whether, the two are combined.
