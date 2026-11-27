# Weather Threats: smoke and air quality (map layer and Event Planner)

Branch `claude/threats-planner-flood`, isolated Cloudflare Pages preview
`https://claude-threats-planner-flood.forecast-ops-beta.pages.dev`. Shared beta, production and navigation are unchanged.
The 15-mile nearby-wildfire radius is unchanged. Smoke and air quality are their own family: a venue can be in smoke, or have poor
air, with no fire anywhere near it.

## Sources (verified 2026-11-21)

Three kinds of information, kept apart in the data, in Planner and on the map:

| Kind | Source | What it measures | Coverage · cadence · times |
|---|---|---|---|
| **Smoke seen by satellite** | NOAA NESDIS **Hazard Mapping System (HMS)** smoke analysis, daily KML (`satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/YYYY/MM/hms_smokeYYYYMMDD.kml`). No CORS header upstream, so it goes through `/api/smoke/hms/YYYYMMDD` on the preview. | Analysts outline smoke visible in GOES-East, GOES-West and polar-orbiter imagery, with a **density** (Light, Medium, Heavy). It is smoke **anywhere in the air column**; it says nothing about air at the ground. | North America. Each polygon has its own satellite window, e.g. `Start Time: 2026197 1700UTC` to `End Time: 2026197 2000UTC`. Analysts add windows through the UTC day, so today's file can be missing early in the UTC day (the function answers 404 and the page uses yesterday's). Planner uses the latest window that ended in the last 24 hours. |
| **Surface air quality, observed** | EPA **AirNow** current monitor data (EPA map service `Air Now Current Monitor Data Public`), point query within 25 miles. | Latest hourly AQI per monitor for PM2.5, PM10 and ozone (and the PM2.5 concentration). AirNow: data are "not fully verified and validated". | U.S. (plus some of Canada and Mexico). Hourly, posted after the hour. Each reading's own hour is shown. Readings older than 3 hours are not used. |
| **Surface air quality, forecast** | AirNow **reporting-area forecasts** by state and local agencies. The venue's area comes from EPA's `AirNow_National_Air_Quality_Index_(AQI)_Forecast` polygons; that area's rows come from `files.airnowtech.org/airnow/today/reportingarea.dat`, via `/api/smoke/airnow-area` on the preview. | The agency's forecast **for a calendar day**: AQI category, a value when given, the pollutant, and action days. | Issue date and valid date on every row. Usually today and tomorrow, sometimes more. |
| **Smoke forecast (model guidance)** | NOAA **NAQFC** near-surface smoke (`mapservices.weather.noaa.gov/raster/.../air_quality/ndgd_smoke_sfc_1hr_avg_time`, getSamples at the venue). | Hourly model guidance for smoke from fires near the ground. | Contiguous U.S., 48 hours, runs at 06Z and 12Z. **Unit unconfirmed:** the service says "micrograms per cubic feet", and NOAA's pages reachable from here don't state the unit. Planner therefore says only which phases have smoke in the guidance; More info shows the peak value with that note. |

**Attribution.** Only HMS and NAQFC are smoke products. AirNow readings and forecasts are described by pollutant (PM2.5, ozone), never as wildfire smoke. In the New York case the day's Unhealthy-for-Sensitive-Groups forecast was for **ozone**, and it says so.

## Planner wording

- **Satellite:** "Smoke detected over the area · Heavy (satellite, 1 p.m.–4 p.m.)" + "…smoke in the air column overhead; it does not say what the air is like at the ground."
- **Monitor (Unhealthy for Sensitive Groups or worse, within 15 miles):** "Air quality now: Hazardous (AQI 689, PM2.5) at CHI_MAYFAIR, 10 miles northwest" + "AirNow monitor reading for 5 p.m. (Chicago reporting area, Illinois EPA). Preliminary data; current conditions, not a forecast."
  - When nothing is that bad, the source line still gives the nearest reading with its time.
  - With no reading within 15 miles, it says surface air quality isn't reported for the venue (not confirmed).
- **Forecast:** "Air quality forecast Thursday: Unhealthy (AQI 180, PM2.5)" + "Philadelphia reporting area forecast by …, issued Jul 15. A forecast for the whole day (the event falls on it), not timing within it."
  - No phase wording, because the forecast is daily.
- **NOAA guidance:** "Smoke in NOAA's forecast during setup and gates". Phase words are used only here, for the phases whose hours the guidance covers.
- **Event timing:**
  - Current observations show beside an event that hasn't ended, with their own time and "Your event starts …".
  - A past event gets none.
- **More info, View on map:**
  - More info gives each source's own times, monitor, satellite, density, agency and notes.
  - View on map opens the Smoke & air layer, with the monitor or plume selected.

## Map

- **Smoke & air layer:**
  - HMS polygons from the last 24 hours, shaded by density.
  - AirNow monitors nationwide (latest hour, EPA AQI colors).
  - **National panel:** monitors at Unhealthy for Sensitive Groups or worse.
  - **Venue panel:** smoke over the venue, the nearest monitors with their times, and the area forecast by day.
- **Loading:** smoke and monitor feeds load in the background. A slow or failed feed shows on its own source row ("Loading" or "Not responding") and doesn't hold up the page; both cases are checked.

## Archived cases (official)

| Sample | Clock | Result |
|---|---|---|
| `archive-smoke-chicago` | Jul 16, 2026, 5:30 p.m. CDT | Soldier Field: Hazardous AQI at nearby monitors, medium smoke overhead (12–3 p.m. window), Hazardous forecast for Thursday. **No wildfire within 15 miles:** NIFC's 2026 year-to-date records show only two prescribed burns nearby, both out by Apr 10. |
| `archive-smoke-metlife` | Jul 14, 2026, 5:30 p.m. EDT | MetLife: heavy smoke overhead (1–4 p.m. window). The surface is reported separately: the nearest monitor read AQI 53 Moderate. The ozone forecast is labeled ozone. |
| `archive-smoke-forecast-0714` / `-0715` | Jul 14 / Jul 15 | Philadelphia, Thursday: Moderate 100 (no item), then Unhealthy 180 |

- **Fixtures:** `hms-smoke-2026071{4,6}-east.kml` (clipped to the region), `airnow-ra-2026071{4,5,6}.dat` (three areas), `airnow-monitors-2026071622-chicago.geojson` and `-2026071421-nyc.geojson` (from AirNow's HourlyAQObs, hour in UTC).
- **Tool:** `tools/capture-smoke-aq.py`.
- **No NAQFC archive:** the smoke guidance is verified live only.
