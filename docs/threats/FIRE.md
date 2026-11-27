# Weather Threats: fire weather and wildfire (map layer and Event Planner)

Branch `claude/threats-planner-flood`, isolated Cloudflare Pages preview
`https://claude-threats-planner-flood.forecast-ops-beta.pages.dev`. Shared beta, production and navigation are unchanged.

## Sources (verified 2026-11-20/21)

| Product | Source used | What it represents |
|---|---|---|
| **SPC Fire Weather Outlooks, Days 1–2** | `www.spc.noaa.gov/products/fire_wx/dayNfw_{windrh,dryt}.lyr.geojson` (CORS `*`) | Categories are bands: wind/RH **ELEV** Elevated, **CRIT** Critical, **EXTM** Extremely Critical; dry thunderstorms **IDRT** isolated (elevated risk), **SDRT** scattered (critical risk). SPC: outlooks "will be verified based on meteorological conditions (e.g., dry thunderstorm occurrence, wind speed, RH), not whether wildfire ignitions occur"; receptive fuels must be present for any area. Day 1 runs from issuance to 12Z, Day 2 runs 12Z–12Z. Contiguous U.S. |
| **SPC Fire Weather Outlooks, Days 3–8** | `products/exper/fire_wx/dayNfw_{windrh,dryt}prob.lyr.geojson`, issued once a day around 22Z | SPC's probabilistic forecast, from SPC's own definition (`/misc/SPC_Fire_Probabilistic_Information.pdf`): the forecaster's probability of critical fire weather conditions (or dry thunderstorms) "within 12 miles of a point" (40%, 70%). "Predictability Too Low" or "Potential Too Low" means no area. SPC archives Days 3–8 only as categorical Critical areas (points text). |
| **NWS Red Flag Warning, Fire Weather Watch** | `api.weather.gov/alerts/active` (the same request as the other families), through `/api/nws` | VTEC `FW.W` / `FW.A`. Issued for **fire weather zones** (`/zones/fire/COZ238`), drawn from those zones. |
| **NIFC WFIGS current incidents and perimeters** | `services3.arcgis.com/T4QMspbfLg3qTGWY/.../WFIGS_Incident_Locations_Current` and `WFIGS_Interagency_Perimeters_Current` (CORS `*`, no key) | NIFC's definition: wildfire (WF), complex (CX) or prescribed fire (RX) records that have "not been declared contained, controlled, nor out". Records fall off after 3 days without an update (under 10 acres), 8 days (10–100 acres) or 14 days (over 100 acres). Refreshed from the federal incident system (IRWIN) every 5 minutes. Perimeters exist only for some incidents and can be older than the incident record (both dates are shown). NIFC: the data "are not legal documents". 229 wildfires, 3 complexes and 336 prescribed fires current on Nov 21; 57 perimeters. |

## Planner

- **Outlook headlines:**
  - "Extremely Critical fire weather risk Saturday".
  - "Dry thunderstorm risk Saturday · Scattered dry thunderstorms".
  - Days 3–8: "40% chance of critical fire weather Tuesday", or in the archive "Critical fire weather area Saturday (Day 4 outlook)".
  - The line gives the period, the overlapping phases and SPC's meaning. It says the outlook rates weather and fuels, not whether a fire starts.
- **Alert headlines:** "Red Flag Warning during setup, gates and the event", with "In effect at the venue from 8 a.m. Wednesday until 4 p.m." and the fire weather zones.
- **Incidents:**
  - Listed when the perimeter includes the venue or is within 15 miles, or, with no perimeter, when the reported point is within 15 miles.
  - Example: "Wildfire 12 miles southwest: Aspen Acres · 102,007 acres · 96% contained".
  - Incidents have no end time. They apply while the event is ahead or under way, and the line says conditions can change.
  - Prescribed fires are not listed in Planner.
- **More info:**
  - Incidents: type, size, containment, discovered, NIFC update, perimeter date and method, distance, location, incident ID.
  - Outlooks: SPC day, issued, valid, category, forecaster.
- **View on map:**
  - Outlooks open the Fire · 8 days view at that day, with the area selected.
  - Alerts and incidents open Active now, Fire layer only, with the product selected.

## Map

- **Fire layer:**
  - Red Flag Warnings and Fire Weather Watches drawn from their zones.
  - Incident perimeters, with dots sized by acres.
  - A legend toggle for prescribed fires (off by default).
  - The largest active wildfires in the national panel, and nearby wildfires in the venue panel.
- **Fire · 8 days view:** day buttons for Days 1–8, the venue's category for that day, the outlook areas, wildfires within 15 miles, and fire weather alerts at the venue.
- **Loading:** fire outlooks (16 files) and NIFC load in the background. Their sources read "Loading" until the first answer, and the rest of the page doesn't wait for them.

## Archived cases (official)

| Sample | Clock | Result |
|---|---|---|
| `archive-fire-day4` | Jul 29, 3:30 p.m. PDT | Moses Lake, Sat Aug 1 → "Critical fire weather area Saturday (Day 4 outlook)" |
| `archive-fire-day2` | Jul 31, 2:00 p.m. PDT | Moses Lake → Extremely Critical; Spokane → Critical; Missoula → Elevated. The Day 3–8 issued at 21:46Z isn't counted yet. |
| `archive-fire-day1` | Aug 1, 11:30 a.m. MDT (1700Z update) | Missoula raised to Critical |
| `archive-fire-watch` | Nov 17, 1:00 p.m. MST | Fort Collins → Fire Weather Watch (KBOU FW.A 0044) from 8 a.m. Wednesday |
| `archive-fire-warning` | Nov 18, midnight MST | Fort Collins → Red Flag Warning (FW.W 0057, upgrade for COZ238/239). Denver → none (its watch was cancelled) |
| `archive-fire-incidents` | NIFC snapshot, Nov 21 01:0xZ | Lake Pueblo State Park → Aspen Acres 12 mi SW. Colorado State Fairgrounds (17.5 mi) → none |

**Tools:**
- `tools/capture-spc-fire.py` converts SPC's archived shapefiles and Day 3–8 point lists to SPC's live GeoJSON shape.
- `tools/capture-nifc.py` snapshots NIFC with the same fields and simplification the page requests.

## Not included

- Smoke and air quality (NOAA's satellite smoke analysis, HMS).
- Red Flag Warnings issued as polygons. None seen; the adapter would use the polygon if present.
- Alerts from Alaska and Hawaii fire weather zones are handled the same way, but are untested.
