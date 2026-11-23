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
| **Gridded turbulence guidance (GTG)** | Not in AWC's Data API. Delivered by NCEP instead: see "Model guidance: GTG" below. | Model guidance. |

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

## Model guidance: GTG (map, and Planner along the route)

### Source verification (2026-11-22)

- **Inventory.** NCEP Products Inventory, Domestic Aviation Forecast System (DAFS).
  - File: `dafs.tCCz.gtg.3km.conus.fFFF.grib2`, forecast hours 000–018, "Available in GRIB2 via HTTPS", from NOMADS `pub/data/nccf/com/dafs/prod/dafs.YYYYMMDD/`.
  - Inventory page: 205 records.
- **Sample.** `dafs.t22z.gtg.3km.conus.f000.grib2`, Nov 22.
  - 152,440,498 bytes, matching the listing's "145M". Its `.idx` has 205 lines.
  - Decoded with ECMWF ecCodes 2.50.0.
- **Records:**

| Records | GRIB2 code | What | Heights |
|---|---|---|---|
| 1 | 0/19/31 MXEDPRM | Maximum EDR in the column | entire atmosphere |
| 51 | **0/19/30 EDPARM** | **Eddy dissipation parameter: the combined turbulence; used here** | 30 m, then every 1,000 ft (304.8 m, labelled 304, 609 … 15,240 m) |
| 51 | 0/19/29 CATEDR | Clear-air turbulence EDR | same |
| 51 | 0/19/28 MWTURB | Mountain-wave turbulence EDR | same |
| 51 | 0/19/50 | Not in the WMO tables used by ecCodes; probably convective turbulence | same |

- **Inventory discrepancy.** The inventory lists 102 MWTURB records. The file has 51 MWTURB and 51 of 0/19/50. The inventory notes that actual parameters may differ.
- **Units.** m^(2/3) s⁻¹ (EDR, the cube root of the dissipation rate).
- **Grid.** Lambert conformal, 1799 × 1059, 3 km, true at 38.5° N, LoV 262.5° E, spherical earth.
- **Packing.** Template 5.3 (complex packing with spatial differencing), with a bitmap.
- **Timing.** Cycles are **hourly**, each with forecast hours 0–18. Files are about 145–166 MB each; on Nov 22 a cycle's f000 appeared about 55 minutes after the cycle hour and f018 about 1.5 hours after (22Z: f000 at 22:53Z; 21Z: f018 at 22:27Z).
- **Our decoder** (`assets/threats-gtg.js`) matches ecCodes on every point of three full levels (largest difference 1.5×10⁻⁸, float32 rounding; same bitmap). Its Lambert projection returns ecCodes' own latitude and longitude for each cell.

### Delivery

- **Function.** `/api/gtg/latest` reads the NOMADS listing (today, else yesterday) and returns the newest cycle with all 19 hours and their `.idx`. Cached 5 minutes.
- **Records.** `/api/gtg/record?cycle=&fh=&m=` reads the file's `.idx`, then the one EDPARM record by HTTP byte range: about 1–1.3 MB of a 145–166 MB file. The bytes are checked as one whole record (GRIB … 7777, exact length). Cached 30 minutes.
- **Decoding.** The browser decodes the record (about 100 ms) and draws a Web Mercator image.

### Map

- **Toggle.** "Model guidance · NOAA GTG" in the en-route section; off until asked (`gtg=1`).
- **Controls:**
  - Altitude: 1,000 ft to FL500 MSL, every 1,000 ft (`gft=`).
  - Valid time: +0 to +18 h from the latest complete cycle (`gfh=`).
  - Aircraft class: light, medium or heavy (`gcls=`).
- **Look.** A violet fill under the advisory outlines and pilot-report dots. Categories use AWC's EDR thresholds by class (×100: light 13/16/36/64, medium 15/20/44/79, heavy 17/24/54/96).
- **Readouts.** The status line gives the cycle, valid time, height in feet and metres, and the record and file sizes. The value at the venue is shown, and tapping the map gives the value at a spot.
- **Replays.** Not shown in archived replays: GTG is live only.

### Checks

- `tests/threats-gtg.test.js` (8): a real record against ecCodes at 16 cells, plus the field statistics, projection and thresholds.
- `tests/threats-functions.test.mjs`: the latest-cycle listing and the byte-range read.
- `tools/threats-gtg-check.js` on the preview: switches FL300 → 10,000 ft → +6 h and aircraft class, on desktop and phone, and saves the records the page drew.
- `tools/threats-gtg-verify.py` reads those records with ecCodes: same field, height, cycle, hour and grid, and the same value and location at the sample cell.

### Limitations

- **Size.** One height and hour per view, about 1–1.3 MB each.
- **Timing.** The newest cycle may be incomplete; the map uses the newest complete one (the "newest" cycle is listed beside it).
- **Etiquette.** NOMADS is a shared NOAA server; the function caches, and the map fetches only when a control changes.
- **Delivery.** NOMADS sends no CORS header, so only the preview's function can read it; GitHub Pages and raw.githack copies of the map can't show GTG.
- **Meaning.** Guidance is EDR at a 3 km cell: atmospheric turbulence, not what a given aircraft will feel.
- **Not yet used:** the CAT, MWT and 0/19/50 fields separately.

### Planner: "Modeled turbulence along your route" (2026-11-23)

- **Where.** Under "Along the route", after the advisories and pilot reports, with its own sub-heading and a "Model guidance · NOAA GTG" badge. Items have a violet dotted edge.
- **On request.** The button says how much it will read ("about 8 MB"). Records are fetched only after the click.
- **Inputs.** The saved approximate route (origin, destination), its altitude band, the time in the air, and an optional aircraft class.
  - The aircraft class is new; it is stored as `c` in `?rt=` and the saved route, and is optional, so older links stay valid.
  - With no time in the air of its own, the route uses the arrival window at its destination (or the departure window at its origin).
- **What is read.**
  - Heights: up to 4 GTG heights spread over the band (always its lowest and highest).
  - Hours: the model's whole-hour valid times in the time in the air, up to 3 (first, middle, last), limited to the cycle's 18 hours.
  - The newest complete cycle; `?gtgcyc=YYYYMMDDHH` pins a recent cycle for checks and says so.
- **How it reads the route.** Points every 10 km along the straight line. At each point the value is the highest EDR over the checked heights. Stretches of moderate or worse for the aircraft class are findings. Light turbulence is summed up in one line.
  - **Timed** (the route has its own time in the air): each point's time comes from steady progress from departure to arrival along the line, and the nearest checked hour is used. A finding gives "around 7:27 a.m.". This is an estimate: the real path, speed and climb are unknown.
  - **Not timed** (window from an airport): every checked hour counts at every point. A finding reads "Potential overlap: … valid 7 a.m. and 8 a.m." and More info says when isn't known.
- **Each finding gives:**
  - where (miles from the origin, and the peak's latitude and longitude);
  - the cycle, valid times, and peak EDR and its height;
  - the category for the aircraft class, with AWC's thresholds;
  - for timed routes, the estimated time.
  - Its "View on map" opens the map at that height, hour, pinned cycle and spot (`gft`, `gfh`, `gcls`, `gcyc`, `focus`).
- **Coverage stated, never "none":**
  - outside the GTG grid (for example, toward San Juan);
  - no model value;
  - past the cycle's last hour ("No GTG forecast for 291–569 miles … (about 1:31 p.m. on): cycle 00Z Nov 23 reaches 1 p.m.");
  - already flown;
  - a record that couldn't be read;
  - a cycle more than 4 hours old.
  - Any of these makes the result incomplete (`data-gtg-complete="false"`).

**Verified** (`tools/threats-gtg-planner-check.js` on the preview, desktop and phone, 12 of 12). Pinned cycle 00Z Nov 23; Cincinnati (KCVG) to Newark (KEWR), 569 miles; medium aircraft.

| Case | Result |
|---|---|
| 6,000–12,000 ft, in the air 7–8 a.m. EST | "Moderate turbulence modeled 260–272 miles from Cincinnati, around 7:27–7:28 a.m., at 6,000 ft, 10,000 ft". Peak EDR 0.24 at 10,000 ft, valid 7 a.m. ecCodes reads 0.237 at that cell from the same NOAA record. |
| **Altitude changed** to FL240–FL360 | None ("No moderate or worse turbulence modeled…"; heights checked FL240, FL280, FL320, FL360). |
| **Flight window changed** to 10–11 a.m. | None. |
| **Incomplete coverage**: noon–3 p.m. | The part past 1 p.m. (the cycle's last hour) is named as having no forecast. Not complete. |
| No time in the air of its own (arrival window 7–8 a.m.) | "Potential overlap: moderate turbulence modeled …, valid 7 a.m. and 8 a.m.". No encounter time. |
| View on map | Opens GTG at the finding's height, hour and pinned cycle, centred on the spot, reading the same value there. |

Unit tests (`tests/threats-gtg.test.js`, synthetic fields on the real grid) cover:
- the plan;
- altitude, window and timed or not;
- the grid edge, a failed record and an old cycle;
- aircraft class.

**Limits:**
- The straight line, the band treated as flown throughout, and steady progress are assumptions, stated on the page.
- At most 4 heights and 3 hours are checked, named in the summary.
- About 1–1.3 MB per record, so up to about 15 MB for a long flight.

## Model guidance: In-Flight Icing (IFI) (map, and Planner along the route)

### Source verification (2026-11-23)

- **Inventory.** NCEP Products Inventory, DAFS: `dafs.tCCz.ifi.3km.conus.fFFF.grib2`, forecast hours **001–018** (no analysis hour), "Available in GRIB2 via HTTPS", on NOMADS `dafs.YYYYMMDD/`.
- **Sample.** `dafs.t01z.ifi.3km.conus.f003.grib2`, Nov 23.
  - 35,020,764 bytes, matching the listing's "33M". Its `.idx` has 180 lines, the same as the inventory's 180 records.
  - Decoded with ecCodes 2.50.
- **Grid.** The same 1799 × 1059 Lambert grid as GTG (3 km).
- **Packing.** Template 5.3.
- **Our decoder** matches ecCodes on every point of five records (largest difference 3×10⁻⁸; the same bitmaps).
- **Heights.** **60**, every 500 ft from 152.4 m (500 ft) to 9,144 m (30,000 ft) MSL. The levels are written with one decimal ("152.4 m", "762 m").
- **Timing.** Cycles are hourly, with 18 forecast hours. On Nov 23 the 01Z cycle's f003 appeared at 01:58Z, and the 02Z cycle reached f007 by 03:06Z.

**The three fields, named as NCEP's GRIB2 table publishes them** (`grib2_table4-2-0-19`). ecCodes names only SIPD; the index prints 0/19/37 as `var discipline=0 master_table=2 parmcat=19 parm=37`.

| Code | NCEP name | Units / values in the files | Missing data | On the map |
|---|---|---|---|---|
| 0/19/233 **ICPRB** | Icing probability | non-dim; 0 to 0.74 seen, steps of 0.01 | **bitmap**: no value below the ground | Drawn: four bins from 5% |
| 0/19/37 **ICESEV** | Icing Severity | **Table 4.228**: 0 None, 1 Trace, 2 Light, 3 Moderate, 4 Severe (5–254 reserved, 255 Missing); only 0–4 seen | **no bitmap**: cells below the ground carry **0 ("None")**. The map takes the ground mask from ICPRB at the same height and hour, and reads those cells as "no value", never "none". | Drawn: trace to severe |
| 0/19/217 **SIPD** | Supercooled Large Droplet (SLD) Icing (Note 2: SLD are droplets over 50 microns) | The table says Table 4.207 codes (0 None, 1 Light, 2 Moderate, 3 Severe, 4 Trace, 5 Heavy); the files hold **-0.1 and 0 to 1 in steps of 0.1** | bitmap below the ground; **-0.1** is not defined anywhere we found (it appears mostly where icing probability is above 0) | **Not drawn** until NOAA documents the values |

**Inventory discrepancy.** The inventory page lists 60 ICPRB and **120 SIPD** ("see Note 2", but the note's text isn't on the page). The file has 60 SIPD and 60 ICESEV (0/19/37). The page warns that actual parameters may differ.

### Delivery

`/api/ifi/latest` returns the newest cycle with all 18 hours and their `.idx`. `/api/ifi/record?cycle=&fh=1-18&ft=500-30000 (500 ft steps)&field=prob|sev` reads one record by byte range:
- **Sizes:** probability about 0.24–0.5 MB; severity about 0.1–0.2 MB, and 449 bytes when it's all zero.
- **The file's last record** (severity at 30,000 ft) has no next index offset. It is read to the end of the file and checked against its GRIB length field.

### Map

- **Layout.** "Model guidance · NOAA IFI" in the en-route section. Off until asked (`ifi=1`); `ifield=prob|sev`.
- **Shared controls.** The **altitude and valid-time controls are shared with GTG** ("Model guidance · height and time"; `gft`, `gfh`).
  - The valid time is the base cycle (GTG's while turbulence is on, else IFI's) plus the chosen hour. IFI reads its own cycle's hour for that time, so the two layers always show the same valid time.
  - The altitude control goes in 1,000 ft steps. IFI also has the 500 ft heights in between, which the shared control doesn't offer.
- **Look.** A cyan-to-teal fill, apart from GTG's violet fill, the blue outlines of icing advisories, and the rings of icing pilot reports. Its own legend: probability bins, or the severity categories.
- **Readouts.** The status line gives the field name and GRIB2 code, cycle, valid time, height in feet and metres, and the record size. The value at the venue is shown, and tapping the map gives the value at a spot.
- **Unavailable records** draw nothing (never another height, hour or an old field) and say why:
  - above 30,000 ft: "IFI stops at 30,000 ft (FL300)";
  - +0 h, or past +18 h for IFI's cycle: "has no forecast for that time (it covers +1 to +18 h)";
  - a record the function couldn't read: its error;
  - in the fixture replay, a record it doesn't hold: "not in this replay (it has …)".
- **Fixture replay.** `ifisrc=fixture` reads `tests/fixtures/threats/ifi/`: eight official records of cycle 01Z Nov 23 (probability and severity at 5,000 and 15,000 ft, +3 h and +6 h; 2.4 MB), with `ifi-fixture.eccodes.json` as the answer key and a replay clock of 02Z. On a demo page the banner says the icing overlay is saved official NOAA guidance, not demo data.
- **Readouts.** Probability readouts are percentages, like the legend ("icing probability 42%").

### Checks

- `tests/threats-ifi.test.js` (12): the fixture against ecCodes, field checks, the ground mask, the colours, and the route analysis.
- `tests/threats-functions.test.mjs`: the IFI routes.
- `tools/threats-ifi-check.js`, desktop and phone, on the fixture (local or deployed):
  - altitude 5,000 → 15,000 ft and hour +3 → +6 h each change the drawn image;
  - the map's values at 9 cells per record equal ecCodes';
  - severity uses Table 4.228 words, and a below-ground cell reads "no value";
  - unavailable records (not in the replay, above 30,000 ft, +0 h) draw nothing and say why;
  - returning to an available record draws the same image again.
- `--live` runs on the preview's newest cycle; `tools/threats-ifi-verify.py` checks the records it drew with ecCodes.

### Planner: "Modeled icing along your route" (2026-11-23)

- **Where.** Below "Modeled turbulence along your route", with its own heading, a cyan "Model guidance · NOAA IFI" badge, and dotted cyan edges. There are separate lists for **icing probability** and **modeled severity**.
- **On request** ("Check modeled icing (about N MB)"). It uses the same saved route, time in the air and altitude band as turbulence.
- **What is read.**
  - Heights: IFI heights on whole thousands of feet in the band (the map's control), up to 4, always the band's lowest and highest.
  - Hours: whole hours in the time in the air, up to 3, within the cycle's **+1 to +18 h**.
  - For each height and hour, **both** the probability (0/19/233) and severity (0/19/37) records are read.
  - SLD is not read.
- **Thresholds**, named in the summary:
  - icing probability **40% or more** (the legend's 40–60% bin and up);
  - modeled severity **moderate or worse** (Table 4.228 code 3 or 4).
- **Each finding gives** where (miles from the origin and the peak's position), the cycle and valid times, the peak and its height, and **the other field at the very same cell, height and valid time**. For example: "At the same spot, height and valid time, modeled severity is moderate (code 3)" or "… icing probability is 58%".
- **Times.** With the route's own time in the air, findings give an approximate time ("around 9:55 p.m. (approximate)", from steady progress along the straight line). Otherwise they read "Potential overlap: … valid 10 p.m.".
- **View on map** opens the map with that field, height, valid time (pinned cycle, or the saved records) and spot (`ifi=1`, `ifield`, `gft`, `gfh`, `icyc` or `ifisrc=fixture`, `focus`).
- **Quiet lines name what was sampled and the threshold:**
  - "No icing probability of 40% or more found at the sampled heights and times: 5,000 ft at 10 p.m. (highest 12%)."
  - "No modeled moderate or worse icing found at the sampled heights and times: … (highest: light)."
  - When something is missing they add "that could be checked".
- **Coverage gaps stay visible:**
  - a record that couldn't be read ("Couldn't read IFI icing probability and severity for 10,000 ft at 10 p.m. (not in the saved records)…");
  - stretches below the ground at every checked height ("… no icing value there (not 'no icing')");
  - the lowest heights below the ground for part of the route;
  - outside the grid;
  - before +1 h or past +18 h;
  - a band reaching above 30,000 ft;
  - an old cycle.
  - Any of these makes the result incomplete (`data-ifi-complete="false"`).
- **Sources.** Live, through `/api/ifi` (newest complete cycle, or `?ificyc=` pinned). `?ifisrc=fixture` uses the saved official records on their own replay clock.

**Verified** (`tools/threats-ifi-planner-check.js` on the preview, desktop and phone, 16 of 16). The saved records, cycle 01Z Nov 23; Atlanta (KATL) to St. Louis (KSTL), 483 miles.

| Case | Result |
|---|---|
| 15,000 ft, in the air 9:45–10:15 p.m. CST | Probability findings (up to 72%) and moderate or severe findings, with approximate times. Each names the other field at the same cell. |
| **Altitude changed** to 5,000 ft | None. Both quiet lines name 5,000 ft at 10 p.m. and their thresholds. |
| **Flight time changed** to 12:45–1:15 a.m. | No probability finding; different severity stretches. |
| **Unavailable record**: 10,000 ft (not saved) | Shown as a coverage gap naming both fields. Not complete; no quiet "none". |
| No time in the air of its own | Potential overlaps with valid times; no encounter time. |
| View on map, probability and severity | The same field, 15,000 ft, valid 04Z, centred on the spot; the same value there (58%; code 3). The readout is in percent; the banner names the saved NOAA guidance. |

Unit tests (`tests/threats-ifi.test.js`, on the saved records) cover:
- the plan (heights, +1..+18 h, above 30,000 ft);
- the base case, with the same-cell cross-reference checked against the records;
- altitude, flight time, and an unavailable record;
- below the ground (Denver toward Minneapolis at 5,000 ft starts below the ground);
- a flight before the first hour.

**Limits:**
- The same assumptions as turbulence: a straight line, the band treated as flown throughout, steady progress.
- At most 4 heights and 3 hours, each needing two records (about 0.6–0.7 MB per height and hour).

## Map and Planner usability (2026-11-23)

- **Layers.** The struck-through hazard row is now a **Layers** button that names what's on ("All 8", "Severe storms, Flooding +2").
  - It opens labelled checkboxes for the 8 hazards (several can be on together), with Aviation's parts nested under it: airport weather, pilot reports, advisories, turbulence guidance and icing guidance.
  - Actions: **Show all**, **Reset to default** (all 8 hazards; model overlays off) and **Done**.
  - Opening it downloads nothing; turning a model overlay on is the request. Escape closes it and returns focus.
  - On phones it fits the screen and scrolls inside itself.
- **Labelled controls.** The control groups are labelled **Time** (Active now, Day 1–3, Winter, Fire), **Layers** and **Map area** (National or Venue).
- **State line.** A line under Map area shows the view time and the layers, and stays in sight while the details scroll. When a selected layer isn't drawn at that time it says why in one line, for example "Not drawn in Day 2: Smoke & air, Tropical, Coastal (current only); Winter, Fire (see Layers)". The picker gives each layer's own reason.
- **Legend.** It adds an Aviation part only for what is drawn: airport categories, pilot reports, advisories, and each model overlay.
- **Aviation panel.**
  - It starts with "Aviation shows", the same switches as in Layers; pressed ones are marked ✓.
  - The shared altitude and valid-time controls stay together whenever turbulence or icing is on.
  - With only Aviation on, the panel leads with it and says the other hazards are off.
- **Planner.** "Model checks along the route" is one area with **Check turbulence** and **Check icing** side by side (each still on demand, with its size). Each result and its coverage gaps are under their own heading.
- **Check.** `tools/threats-ux-check.js` covers desktop, 390 and 360 px:
  - a busy national view, a venue view with several hazards, and Aviation with both overlays;
  - the picker: reachable layers, no downloads on opening, keyboard;
  - the state line staying in view;
  - links restoring venue, layers, airports, altitude, valid time and replays;
  - the Planner area.

## Not included

The alternate-airport legality rules (2-1-2) for flight planning, airways or filed routes (the route is a straight line), gridded turbulence guidance, international SIGMETs, and airport delays outside the event's airports on the Planner.
