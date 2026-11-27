# Weather Threats: tropical and coastal (map layers and Event Planner)

Branch `claude/threats-planner-flood`, isolated Cloudflare Pages preview
`https://claude-threats-planner-flood.forecast-ops-beta.pages.dev`. Shared beta, production and navigation are unchanged.

## Sources (verified 2026-11-21)

| Product | Source | Use |
|---|---|---|
| **NWS Hurricane, Tropical Storm and Storm Surge Warnings and Watches** | `api.weather.gov/alerts/active` (same request and `/api/nws` function as the other families) | **Planner, venue-specific.** NWS issues these per forecast zone in its Tropical Cyclone Watch/Warning product (TCV), coordinated with NHC. VTEC `HU`, `TR`, `SS` (`.W`/`.A`). The VTEC end is open (`000000T0000Z`): in effect until further notice, so Planner says so and shows when the next NWS update is due. The message expiry is not presented as an end. NWS's local "Window for Tropical Storm force winds" is kept as timing. |
| **NWS Coastal Flood Warning, Watch and Advisory; High Surf Warning and Advisory; Rip Current Statement; Beach Hazards Statement** | same | **Planner, venue-specific.** VTEC `CF`, `SU`, `RP.S`, `BH.S`. Zone-based, with real end times. |
| **NHC Graphical Tropical Weather Outlook** | NOAA map service `tropical/NHC_tropical_weather_summary`, layer 3 (Seven-Day Potential Development Region: `prob2day`, `prob7day`, risk Low/Medium/High). Allows browser requests. | **Map only.** Where a tropical cyclone could form; not a forecast of impacts. |
| **NHC storm products** (forecast cone, track, forecast points, coastal watch/warning segments) | same service, layers 5–8 | **Map only, as regional context.** The cone is the probable track of the storm's center (about two-thirds of the time); impacts reach well outside it, and the map says so. |
| **NHC wind speed probabilities** (34, 50, 64 kt) | same service, layers 30–32, point query at the venue (bands such as "20-30%") | **Planner**, as a 5-day cumulative chance at the venue, from 10% for 34 kt, with no phase timing ("70% chance of tropical-storm-force winds at the venue through Monday"). Only asked while NHC has an active storm. |

**Shoreline rule.** NWS forecast zones stop at the coastline, and their outlines are simplified there. A pier or beach venue just outside a coastal or tropical alert's zone (within 1.5 miles) is treated as on that zone's shoreline, and the line says so. The Flagler Beach Pier sits 1.1 miles from Coastal Flagler's drawn edge.

## Archived and live cases

| Case | Data | Result |
|---|---|---|
| **Tropical (replay):** Hurricane Isaias, AL092026 | The NWS Mobile TCV texts for Oct 7–10, 2026 (official products, from the Iowa Environmental Mesonet's NWS text archive; replayed through `tcvToAlerts`), and NHC advisory GIS 4 and 6 (NHC archive) | **Oct 7, noon CDT:** The Wharf, Orange Beach (Baldwin Coastal) shows Hurricane Watch and Storm Surge Watch for a Friday event, until further notice, with the wind window "Friday afternoon until early Saturday morning". **Oct 8, midnight:** Hurricane Warning and Storm Surge Warning; inland Bay Minette (Baldwin Inland) gets the Hurricane Warning only. **Oct 10, 2 a.m.:** cancelled, nothing. The map shows NHC's cone, track, points and coastal warning segments. |
| **Coastal, standalone (live capture):** NWS Jacksonville, Nov 21, 2026 | Payload captured from `api.weather.gov` | Flagler Beach Pier: Coastal Flood Warning until 5 a.m. Monday, High Surf Advisory and Rip Current Statement. Jacksonville Beach Pier: Coastal Flood Advisory, not the warning. A Monday-noon event: nothing. The hosted check also runs the same pier against the live feed. |

**Fixtures:**
- `tests/fixtures/threats/tcv-kmob-al092026/*.txt`
- `nws-zones-gulf-al092026.json`
- `nhc-al092026-adv00{4,6}.geojson`
- `nws-live-kjax-coastal-20261121.json`
- `nws-zones-kjax-coastal-20261121.json`

**Tool:** `tools/capture-nhc.py`.

## Carryovers in this round

- **NOAA NAQFC smoke:**
  - The service's values are kg/m³, despite its "micrograms per cubic feet" description: every value is an exact multiple of 1e-9, the legend runs 1–150, and the stated maximum is 1.06e-7.
  - Values are converted to µg/m³, and Planner lists smoke at 9 µg/m³ or more, the top of EPA's "Good" PM2.5 range.
  - The earlier threshold, in raw units, could never fire.
- **WSSI-P failed level:** the fallback is now `ThreatsFeeds.combineWSSI`, unit-tested. The hosted check blocks NOAA's Extreme layer in the browser to exercise it live.

## Not included

- NHC storm-surge inundation and arrival-time graphics.
- Marine-zone hazards (offshore and coastal waters).
- Hurricane Local Statements.
