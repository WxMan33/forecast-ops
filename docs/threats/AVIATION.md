# Weather Threats: aviation (airport METAR and TAF; en route and FAA status)

Branch `claude/threats-planner-flood`, isolated Cloudflare Pages preview. Shared beta, production and navigation are unchanged.

## Sources (verified 2026-11-22)

| Product | Source | What it is |
|---|---|---|
| **METAR** | NOAA Aviation Weather Center Data API `aviationweather.gov/api/data/metar?ids=…&format=json`, through `/api/awc/metar` on the preview (AWC sends no CORS header). Cached 2 minutes. | The airport's latest routine or special observation: observation time, wind and gusts, visibility, cloud layers and ceiling, weather, and AWC's flight category. |
| **TAF** | `…/api/data/taf?ids=…&format=json`, through `/api/awc/taf`. Cached 5 minutes. | The terminal forecast for 5 statute miles around the airport, usually 24–30 hours, amended as needed. Its base period and FM, BECMG, TEMPO and PROB change groups each have their own times. |

**Flight category.** For TAF periods it is computed from ceiling (the lowest BKN/OVC layer or vertical visibility) and visibility, using FAA definitions:
- **LIFR:** ceiling under 500 ft or visibility under 1 mi.
- **IFR:** ceiling 500 to under 1,000 ft or visibility 1 to under 3 mi.
- **MVFR:** ceiling 1,000–3,000 ft or visibility 3–5 mi.
- **VFR:** above those.

METARs carry AWC's own category.

**Concern.** Any of:
- IFR or LIFR;
- gusts of 30 kt or more, or sustained wind of 25 kt or more;
- thunderstorms, or freezing or frozen precipitation.

MVFR is shown in More info, not as an item.

## Planner

- **Airports:**
  - An event has a primary and an optional alternate airport, each with its own arrival and departure window, entered in the event's local time.
  - They are kept with Weather Threats, per event in this browser, or passed in links as `?air=[{"i":"KORD","r":"p","a":[from,to],"d":[from,to]},…]`.
  - Event Manager's event record is unchanged, which keeps the beta merge clean.
- **TAF items:**
  - Each airport and window is matched against its own TAF periods, never the event's hours.
  - Example headline: "KORD arrival (Sun 10:45 a.m.–11:30 a.m.): temporarily IFR forecast".
  - The line names the airport and role, the TAF issue time (and whether amended), the overlapping period with its ceiling, visibility and weather, and "Terminal forecast for the airport, not the venue".
- **METAR item:** a current concern while the airport's windows are still ahead. Example: "KORD now: IFR (observed 10:31 a.m.)".
- **Source line:** each airport's METAR and TAF times, plus TAF coverage. A window that runs past the TAF is stated, and the source stays unconfirmed.
- **More info:** airport and role, issued and valid times, your window, the overlapping periods, the flight-category definition, and the raw TAF or METAR.
- **View on map:** opens the Aviation layer, with the event's airports drawn by flight category and the selected product's detail.

## Cases

| Case | Data | Result |
|---|---|---|
| Archived capture (`archive-aviation-chicago`, Nov 22 16:35Z) | Official KORD, KMDW and KMKE METARs and TAFs, captured live | United Center has no hazard item (the venue looks fine). O'Hare (primary): "temporarily IFR" in the TEMPO period overlapping the 10:45–11:30 a.m. arrival, and "IFR now" (BKN009 at 10:31 a.m.). Midway (alternate) is named separately. The Monday departure falls in VFR: no item. |
| Live (hosted, Nov 22 17:27Z) | The same airports through `/api/awc` | "KORD arrival (Sun 11:42 a.m.–12:42 p.m.): IFR forecast" (TAF 1706Z AMD), "KMDW now: IFR (observed 11:12 a.m.)", and "KMDW arrival: temporarily IFR". |

## Phase 2: en route and flight disruptions (branch `claude/threats-em-combined`, 2026-11-22)

Built on the combined preview. Airport METARs, TAFs and Planner flight windows are unchanged.

### Sources (verified 2026-11-22)

| Product | Source | Kind |
|---|---|---|
| **Pilot reports (PIREPs)** | AWC Data API `/api/data/pirep?bbox=…&age=…`, through `/api/awc/pirep` (bbox and age 1–3 h only; AWC returns at most 400 per request, so the map asks for CONUS in three boxes). Cached 2 min. | Observation. Turbulence and icing of light or more, with intensity, altitude or layer, time and aircraft type. "Smooth" reports are left out. |
| **SIGMETs** | `/api/data/airsigmet`, through `/api/awc/airsigmet`. Cached 2 min. | Official advisory: convective, turbulence, icing, with valid time and altitudes. |
| **G-AIRMETs** | `/api/data/gairmet?fore=0,3,6,9,12`, through `/api/awc/gairmet?fore=…` (five requests). Cached 5 min. | Official forecast advisory, as snapshots every 3 hours. Each snapshot is read as 90 minutes either side of its time. Freezing-level contours are left out. An icing base of "FZL" uses the freezing level's own range. |
| **CWAs** | `/api/data/cwa`, through `/api/awc/cwa` (AWC's 204 becomes an empty list). Cached 2 min. | Official advisory from the Center Weather Service Units. Altitudes come from the fields, or from the text ("FL290 TO FL390", "TOPS EST TO FL370"). |
| **FAA airport status** | `nasstatus.faa.gov/api/airport-events` and `/api/operations-plan`, through `/api/faa/…`. Cached 1 min. | Ground stops, ground delay programs, arrival and departure delays, closures and NOTAM notices, each with the FAA's stated cause and times. A start time in the future means **planned**. The operations plan's terminal items are **possible**. |
| **Gridded turbulence guidance (GTG)** | Not used. | AWC's Data API (its OpenAPI spec, checked 2026-11-22) does not publish GTG, and no other supported machine-readable source was verified. The map says model guidance is not shown. |

**Weather-related.** The FAA's cause mentions ceilings, visibility, fog, wind, thunderstorms, snow, ice, rain or "WX" (for example, "TM Initiatives: Metering: WX"). Volume, staffing, equipment and airspace causes are not weather-related.

### Map (Aviation layer)

- **Pilot reports.** Dots for turbulence, rings for icing; darker means stronger. Shown at "Now" only, filtered by report age (last 1 or 2 hours live, up to 3 in the replay).
- **Advisories.**
  - SIGMETs and CWAs have solid outlines.
  - G-AIRMETs have dashed outlines (a forecast snapshot).
  - Colors by hazard: turbulence orange, icing blue, thunderstorms red, low clouds or obscured mountains grey, wind purple.
- **Filters:**
  - Time: Now, +3, +6, +9 or +12 h, matching the G-AIRMET snapshots.
  - Altitude: all; below 10,000 ft; 10,000 ft to FL180; FL180 to FL290; above FL290; or the route's own band.
  - Report age.
- **When it appears.** En-route context appears when the Aviation layer is asked for (`layers=aviation`, an event's airports or route, or a button in the panel), so the default map requests nothing new.
- **FAA status.** Listed for the event's airports under "Flight disruptions · FAA".
- **Approximate route.** Drawn as a dashed straight line labelled "Approximate route KORD to KEWR".

### Planner

Four separate headings: **Venue hazards**, **Airport weather**, **Flight disruptions** and **Along the route**.

- **Flight disruptions.**
  - Shown per airport (primary, alternate, and the route's origin or destination when different).
  - Each lists the FAA's disruption, the stated cause, whether it is weather-related, and whether it is active or planned with its times.
  - It also gives the relation to the arrival or departure window. Ground stops, ground delay programs and arrival delays concern the arrival; departure delays concern the departure.
  - A disruption with no end time counts for a window starting within 6 hours. Later windows get a plain line.
  - An airport with none says so. A source that isn't answering is never "none".
- **Along the route.** Optional: origin, destination, altitude band, and the time in the air. With no time given, it uses the arrival window at the destination, or else the departure window at the origin.
  - Advisories within 25 miles of the straight line, overlapping in time and altitude, are listed as **potential overlap** with the "approximate route" wording.
  - Pilot reports of moderate or worse near the line in the last 90 minutes, in the band, are listed as observations.
  - Surface-based advisories (IFR, obscured mountains, surface wind, low-level wind shear) are not matched to a cruise band. The airports' TAFs and the map cover them.
- **Without a route.** En-route hazards stay on the map as regional context, and a note links there.
- **Links.** The route travels as `?rt={"o":"KORD","d":"KEWR","lo":10000,"hi":16000,"w":[from,to]}` beside `?air=`, never inside `e`.
  - The Share menu names it.
  - "Include the airports and route in links" drops both.
  - Malformed routes are ignored.

### Cases (official replay `archive-aviation-enroute`, captured 2026-11-22 21:19Z)

| Case | Result |
|---|---|
| **Turbulence report at one altitude** | JFK, Mooney M20P, moderate to severe turbulence at 6,000 ft, 3:12 p.m. EST. Shown with the "Below 10,000 ft" filter; hidden at "FL180–FL290". Its detail reads "Pilot report · observation". |
| **Advisory overlapping the approximate route** | O'Hare → Newark, 10,000–16,000 ft, in the air 4:30–6:30 p.m. EST. Four G-AIRMETs: Zulu 3C icing (6,000 ft to FL210), Zulu 4C icing (10,000 ft to FL240), Tango 3W and 1W low-altitude turbulence. All are worded "may overlap your approximate route". Above them (25,000–26,000 ft) none apply. |
| **FAA weather-related disruption** | Newark ground delay program for low ceilings, average 1 hr 45 min (up to 5 hr 55 min), 1 p.m.–11:59 p.m. EST, overlapping the 6:15–7 p.m. arrival. It shows while Newark's METAR was VFR. LaGuardia (the alternate) had a ground delay for low visibility. Newark's departure delay ("airspace sharing with N90") is marked not weather-related. |

Tests: `tests/threats-enroute.test.js` (11), `tests/threats-functions.test.mjs` (en route and FAA routes), `tools/event-share-check.js` section 6 (route links), `tools/threats-planner-check.js` section 4l (replay cases on phone and desktop, plus the live functions).

## Not included

The alternate-airport legality rules (2-1-2) for flight planning, airways or filed routes (the route is a straight line), gridded turbulence guidance, international SIGMETs, and airport delays outside the event's airports on the Planner.
