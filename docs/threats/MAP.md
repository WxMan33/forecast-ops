# Weather Threats map: how it behaves now (combined preview, 2026-11-24)

Preview: `https://claude-threats-em-combined.forecast-ops-beta.pages.dev/threats` (branch `claude/threats-em-combined`).
Shared beta, production and navigation are unchanged. Sources are listed in `SOURCES.md`; the NWS forwarder in `NWS-FUNCTION.md`.

## Opening the map

- **A fresh visit draws the street basemap and the venue marker with every threat layer off, and downloads no threat data.** The picker
  reads **Layers · None selected**; the panel offers **Warnings at my venue** (severe storms, flooding, winter and coastal, venue view),
  **Everything** (all 8 hazards) and **Choose layers**. On a phone the collapsed sheet says the same in one line.
- **Links keep their selection:** `layers=` (and `view`, `scope`, `sel`, venue, airports, altitude, radar, `pin`) restore as sent. A Planner
  "View on map" link opens its own layer. Demo and archived samples open with every layer on.
- A venue link without `tz=` uses the venue's own time zone (looked up), not Eastern.

## Layers and their feeds

Each layer's feeds load when it is turned on and stop refreshing when it is off; turning it back on within its refresh interval reuses
what it has. Opening the picker downloads nothing.

| Layer | Feeds |
|---|---|
| Severe storms | NWS alerts, SPC MDs (NOAA map service), SPC Day 1–3 outlooks |
| Flooding | NWS alerts, WPC excessive rainfall Days 1–3 |
| Winter | NWS alerts (WSSI-P in the Winter view) |
| Fire | NWS alerts, SPC fire outlooks Days 1–8, NIFC incidents |
| Smoke & air | NOAA HMS smoke, AirNow monitors (venue observations and forecast) |
| Tropical | NWS alerts, NHC |
| Coastal | NWS alerts |
| Aviation | airports, pilot reports and advisories, GTG and IFI on request |

- **Zone outlines** (alerts issued by county or zone) are downloaded only for the hazards on, at most 6 at a time, and kept in the
  browser's Cache Storage for 7 days.
- **What changed** fetches the earlier message only when that alert is opened.
- **Fully contained fires** are hidden unless **Fully contained fires** is ticked in the legend (or a link points to one).
- **Radar** (Layers › Under the hazards; live only, off by default): NOAA MRMS base reflectivity under the hazards at 60%, with the image
  time and age in the source list; refreshed every 5 minutes only while on.
- **Venue marker** (Layers › On the map): off hides the pin, label and 15-mile ring and the venue strip, for just the map; remembered on
  this device; choosing the Venue view turns it back on.

## Reading it

- **Quiet wording follows the layers on:** "No severe storm or winter warning, watch or advisory is in effect at the venue"; with no
  warning layer on, "No warning layer on". SPC MDs are mentioned only with Severe storms on.
- **Never a false all-clear:** an SPC outlook that hasn't answered reads "Risk unknown · SPC Day N outlook not responding" (or Loading);
  WPC's quiet-day "None Expected" reads as no rainfall risk, not an outage.
- **Clicks:** one thing under the pointer (a dot or an advisory, with nothing else there) opens its details. Several overlapping things
  open **At this spot**: what was under the click first (pilot reports, SIGMETs, G-AIRMETs, CWAs, fires, monitors, airports, storm points),
  then the areas covering the spot (warnings, the highest SPC category, smoke areas, fire perimeters). Each row opens its details; Back
  returns to the list. Dots have a larger hit area on phones.
- **Next 12 hours at the venue** (venue view, and in the no-layers panel): on request, the NWS hourly forecast grid for the venue:
  gust, heat index (or feels-like), rain chance per hour, the peak of each, and the grid's office and update time.

## Basemap

CARTO Voyager (light) and Dark Matter (dark), the vector street maps Heads-Up uses: streets, towns, water and place names from
OpenStreetMap, zoom to 14. County lines from zoom 8 (where the tiles carry them), clearer state lines; hazards draw under the basemap's
labels and our labels on top. Switching the page theme swaps the style and keeps the layers. If CARTO doesn't answer in 6 s, the built-in
outline map (states, lakes, major cities). **Licence:** free for non-commercial use within CARTO's monthly view limit; a paid or
high-traffic launch needs a CARTO plan or self-hosted OpenStreetMap tiles.

## Speed (busy live day, 2026-11-23/24: 565–912 products)

- National grouping compares two areas only inside their common box, keeps each pair's answer, and is reused until the active list
  changes. Zone-listed alerts keep their dissolved outline; each product's relation to the venue is kept per outline.
- A full redraw takes about 0.2 s (was 8–12 s); a layer toggle with all 8 on 0.65–1.1 s on a headless machine without a GPU
  (was 25–34 s). Map ready with Severe storms on a phone: about 1.9 s.

## Checks (`tools/`, all against the hosted preview)

| Tool | What it covers | Last result |
|---|---|---|
| `threats-planner-check.js` | Full Threats regression | 103/103 on `7813e4a` |
| `threats-fixes-check.js` | Audit fixes, presets, radar, venue forecast, clicks (overlapping aviation), venue marker, Watch 705 replay | 36/36 |
| `threats-feeds-check.js` | Threat-feed request counts: fresh visit and picker 0; one layer only its feeds; off stops refreshes; links | 14/14 |
| `threats-ux-check.js` | Layout at desktop, 390 and 360 px | 39/39 |
| `threats-point-check.js` | At this spot (SPC highest category) | 6/6 |
| `threats-audit.js` | Layer-by-layer audit (findings, not a gate) | `docs/threats/audit/` |
| `threats-live-warning-check.js` | Checklist sections 1–3 against whatever is live (exit 3 when nothing is); `LIVE_REPLAY=archive-lox` dry run | dry run 6/6; live pending |

Unit tests: `tests/threats-core.test.js`, `tests/threats-feeds.test.js` (rainfall placeholder, NWS grid, radar time),
`tests/threats-match.test.js`, `tests/threats-functions.test.mjs` (gridpoints route).

## Open

- **Live severe warning** (checklist section 1): no TOR/SVR warning has been active in a usable spot. The live check runs from Wednesday
  Nov 25 19Z (SPC's Marginal risk) hourly through Thursday 09Z, and is what shared-beta navigation waits on.
- **Basemap licence** decision before any paid or high-traffic launch.
- Live FAA status stays explicitly unavailable (the FAA blocks Cloudflare); SLD (SIPD) stays out until its source codes are verified.
- Not planned: a venue forecast in Event Planner (Event Manager's "Hour by hour" already charts rain, temperature and gusts against the
  venue limit); a radar loop only if wanted (more clutter and downloads).
