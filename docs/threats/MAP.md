# Weather Threats map: how it behaves now (2026-11-25)

| Where | What it runs |
|---|---|
| Main site: `https://wxman33.github.io/forecast-ops/threats.html`, plus the Overview card | `main` |
| Shared beta (`beta-previews`, raw.githack.com) | `main`'s map, plus Event Manager's Weather Threats section (beta only) |
| Rainfall preview: `https://claude-threats-rain.forecast-ops-beta.pages.dev/threats` | `claude-threats-rain` (not on main or the beta yet) |

The main site and the githack betas read the NWS, SPC and WPC files that refuse browsers through the Cloudflare Pages functions
at `https://forecast-ops-beta.pages.dev/api/…`. NOAA map services (`mapservices.weather.noaa.gov`: radar, rainfall, WPC outlooks,
WSSI, NHC, MDs) answer browsers directly. Sources are listed in `SOURCES.md`; the NWS forwarder is described in `NWS-FUNCTION.md`.

## Opening the map

- **A fresh visit** (no `layers`, `view`, selection or aviation in the link) opens on **Next 7 days at <venue>** in automatic layers
  (below). A venue link without `tz=` uses the venue's own time zone: the NWS point record first, Open-Meteo as fallback, shown
  the way people say it ("Eastern Time (EST)", or "EST/EDT" across a clock change).
- **Links keep their selection.** These restore as sent and switch automatic layers off: `layers=`, `view`, `scope`, `sel`, venue,
  airports, altitude, `radar`, `pin`, `rain`. `?layers=none` opens with nothing on; `?radar=0` without radar.
- **Demo and archived samples** open with every layer on.

## Automatic layers (fresh visit, until a layer is chosen)

- **Always:** radar (NOAA MRMS reflectivity) plus the NWS warnings, watches and advisories layers: Severe storms, Flooding, Winter,
  Heat & cold, Wind & visibility, Tropical and Coastal.
- **Added only when conditions near the venue call for them** (`autoNeed()` in `assets/threats.js`):

| Added | When |
|---|---|
| SPC outlooks, MDs, storm reports | a severe alert within 250 km (about 155 mi), or an SPC risk at the venue in Days 1–3 |
| WPC excessive rainfall | a flood alert within 250 km, or a WPC rainfall risk at the venue in Days 1–3 |
| NHC | a tropical alert within 800 km, or an NHC area at the venue in the next 7 days |
| Fire layer | a fire alert within 150 km, or an SPC fire risk at the venue |
| Smoke & air layer | an unhealthy AirNow forecast at the venue (Days 1–2) |
| Rainfall overlay (preview) | Flooding needed: a flood warning or advisory near the venue shows **rain that has fallen**, otherwise **rain still to come** |

- The layer picker says the map is automatic and why each extra is on. Choosing any layer, preset, Show all or Clear all
  switches to the user's own selection, and nothing changes automatically after that.
- **River gauges** (NOAA NWPS) load and draw only where a **Flood Warning** (river, areal or flash) is in effect in view. Otherwise
  their source row says "Not loaded · no flood warning in view", and it updates as the map is panned. The 7-day panel still makes one
  lookup within 25 mi of the venue for rivers forecast to flood.

## Next 7 days (the first view)

The headline names the highest threat ahead, with its day and source. Below it: NWS alerts at the venue now or scheduled, then one
card per local day. Sources at the venue's point:
- NWS alerts;
- SPC Days 1–3 (categorical) and Days 4–8 (15%/30%; "predictability too low" shown as a limit, not a failure);
- WPC excessive rainfall Days 1–5;
- WPC WSSI-P;
- SPC fire Days 1–8;
- NHC;
- AirNow;
- NOAA river gauges within 25 mi;
- NWS grid (gusts, heat index, feels-like, rain chance).

"Nearby" is a higher SPC or WPC area within 100 mi, shown one level lower. A source that doesn't answer makes that day "not
confirmed", never quiet. About 45 requests, refreshed every 10 minutes; a failed lookup is retried after a minute. The logic is in
`assets/threats-outlook.js`.

## Rainfall overlays (preview `claude-threats-rain`; with Flooding)

| | Rain that has fallen | Rain still to come |
|---|---|---|
| Source | NOAA MRMS QPE (radar-only estimate), image service `obs/mrms_qpe` | WPC QPF, map service `precip/wpc_qpf` |
| Periods | Past 1, 24 or 72 hours (picker) | Days 1–3 total, or Day 1, 2 or 3. By default it follows the Time tab: Day N view shows Day N, other views show Days 1–3 |
| Time shown | When the window ended, e.g. "24 hours ending Tue, Nov 24, 10:00 PM EST" | Issuance and exact period, e.g. "Days 1–3: Tue, Nov 24, 7:00 PM EST – Fri, Nov 27, 7:00 PM EST · issued Tue, Nov 24, 5:25 PM EST" |
| Coverage | CONUS, Alaska, Hawaii, Caribbean; 1 km | CONUS |
| Drawn as | NOAA-rendered image tiles for the area in view, with NOAA's own colour scale and legend swatches (each window has its own scale) | NOAA-rendered image tiles for the area in view (WPC's colours), with WPC's legend |
| Refresh | Window list checked every 10 min; new tiles only when a new window ends | Issuance checked every 10 min; new tiles only when WPC issues |
| Old | Window ended more than 3 h ago: "N h ago (delayed)" | Issued more than 18 h ago, or the period has ended: "older than expected" |

- **Only one rainfall overlay is drawn at a time.** Both use NOAA's rainfall colours, and NOAA's map service can't redraw the WPC
  areas as outlines: its custom-style option returns empty images, checked 2026-11-25. Turning one on turns the other off. The
  venue view lists **both amounts**, from point lookups of a few hundred bytes:
  - fallen: "less than 0.01 in over the past 24 hours · window ended …";
  - to come: a WPC range such as "1.50–1.75 in · Days 1–3: … · issued …".
- **Venue amounts from MRMS are converted from millimetres.** The service says inches, but its point values are millimetres; its
  own rendering classes them as value / 25.4 inches. See `SOURCES.md`.
- **Nothing reads as "no rain" without an answer.** A refused service shows:
  - in the source row: "Not responding · not drawn";
  - in the legend: "Not responding: not drawn";
  - in the venue view: "… at the venue is unknown".

  An earlier answer that stops refreshing shows "Last answer: … · not responding now". A map image that fails is named in the source
  row.
- **Links:** `rain=obs24` (or `obs1`, `obs72`), `rain=fcst` (or `fcst1-3`, `fcst1` … `fcst3`). A rainfall link without
  `layers=` opens Flooding with it.

## Layers and their feeds

Each layer's feeds load when it's on and stop refreshing when it's off. Turning a layer back on within its refresh interval reuses
what it has. Opening the picker downloads nothing.

| Layer | Feeds |
|---|---|
| Severe storms | NWS alerts; SPC MDs, Day 1–3 outlooks and storm reports (automatic: only when called for) |
| Flooding | NWS alerts (Flash Flood, river and areal Flood Warning, Watch, Advisory); WPC excessive rainfall Days 1–3; river gauges under a flood warning; rainfall overlays (preview) |
| Winter | NWS alerts (WSSI-P in the Winter view) |
| Heat & cold | NWS alerts: Extreme Heat, Heat Advisory, Extreme Cold, Cold Weather Advisory, Wind Chill, Freeze, Frost |
| Wind & visibility | NWS alerts: High Wind, Wind Advisory, Extreme Wind, Dust, Lake Wind, Dense Fog, Dense Smoke |
| Fire | NWS alerts, SPC fire outlooks Days 1–8, NIFC incidents |
| Smoke & air | NOAA HMS smoke, AirNow monitors (venue observations and forecast) |
| Tropical | NWS alerts, NHC |
| Coastal | NWS alerts |
| Aviation | Airports, pilot reports and advisories; GTG and IFI on request |

- **Alert outlines** for zone- or county-listed alerts download only for the hazards on, and only for the area in view: the
  states within half a degree of it. Advisories and statements (the most numerous) load from regional zoom (5). National zoom
  outlines warnings first, at most 150. Outlines are kept in the browser's Cache Storage for 7 days. Event Manager, which doesn't
  set an area, is unchanged.
- **Radar** (Layers › Under the hazards): NOAA MRMS base reflectivity at 60% under the hazards (and above the rainfall overlay),
  with the image time and age; refreshed every 5 minutes, only while on.
- **Storm reports:** SPC preliminary tornado, wind and hail reports from the last 24 h, through `/api/spc`.
- **County lines:** our own US Census file from regional zoom; names from zoom 7.5.
- **Venue marker:** pin, label and 15-mile ring; switchable, remembered on the device.

## The Overview card (main site front page)

The front page shows Core tools first, then **Weather threats · next 7 days**: the map embedded with `threats.html?embed=1`, then
changes, then the next 48 hours.
- The card's map follows the page's **Location** panel (city search, OpenStreetMap venue and address search on Enter, Quick pick
  including Event Manager venues, coordinates) and the **Event** panel. The front page has one location control.
- Changing the location moves the embedded map in place without reloading it (`__threats.setVenue`), keeping its layers and time.
- The embedded map never saves its venue as the site's forecast point.
- "Open the threats map →" opens the full map on the same point.

## Reading it

- **Quiet wording follows the layers on.** "No warning layer on" when none is on. An SPC outlook that hasn't answered reads
  "Risk unknown · … not responding"; WPC's "None Expected" reads as no rainfall risk.
- **Clicks:** a single feature under the pointer opens directly; overlapping features are listed under **At this spot**, with the
  highest SPC category once per day.
- **Next 12 hours at the venue** (on request): the NWS hourly grid's gusts, heat index or feels-like, and rain chance.

## Basemap

CARTO Voyager (light) and Dark Matter (dark) vector street maps. If CARTO doesn't answer in 6 s, the map uses the built-in outline
map and retries CARTO every 5 minutes, keeping every overlay. This matches the OPE lightning program. **Licence:** free for
non-commercial use within CARTO's monthly view limit; a paid or high-traffic launch needs a CARTO plan or self-hosted tiles.

## Stability (2026-11-24)

- **Redraw loop fixed.** With river gauges on screen, every redraw asked for gauges again, and the cached answer redrew again, so
  the panel and map redrew about twice a second. Gauges are now asked once per area (15-minute refresh).
- **Failed lookups back off.** A failed WSSI or 7-day lookup is retried after a minute, not on every redraw.
- **Area-limited alert outlines.** A venue view went from about 200 outline files (19 MB) to about 30.
- **Faster 7-day dates.** One date formatter per time zone (this was over a second of CPU).
- **Measured in a headless test browser without a GPU** (a before/after benchmark, not device timing):
  - first-load main-thread work went from about 28 s to about 7 s;
  - the longest freeze went from 0.78 s to about 0.2–0.3 s;
  - 6–8 venue changes plus a minute idle ran with no crash, against a crash on the 4th change before.

## Checks (`tools/`, against a hosted page)

| Tool | What it covers | Last result |
|---|---|---|
| `threats-rain-check.js` | Rainfall: live, replay (saved NOAA answers, clock pinned: current and delayed), outage, automatic and manual, desktop and phone | 19/19 on `70b1bab` (rainfall preview) |
| `threats-planner-check.js` | Full Threats regression, including Event Manager (combined beta) | 102/102 on the 2026-11-24 release; the earlier suite (103 cases) passed on `00ed0f5`, `de98663`, `7813e4a` and `25b9f10` |
| `threats-fixes-check.js` | Audit fixes, presets, radar, venue forecast, clicks, venue marker, basemap failover, river gauges under flood warnings | 44/44 on the 2026-11-24 release |
| `threats-feeds-check.js` | Request counts: fresh visit (automatic), picker, one layer, layer off, links | 16/16 on the 2026-11-24 release |
| `threats-ux-check.js` | Layout at desktop, 390 and 360 px | 39/39 on the 2026-11-24 release |
| `threats-point-check.js` | At this spot | 6/6 |
| `threats-live-warning-check.js` | Live severe-warning checklist, sections 1–3 | Scheduled hourly from Nov 25 19Z through Nov 26 09Z; dry run 6/6 |

The `threats-*-check.js` tools other than the rainfall check live on the combined beta branch (`claude/threats-em-combined`).
Unit tests: `tests/threats-core`, `threats-feeds`, `threats-match`, `threats-outlook`, `threats-rain` (`.test.js`) and
`threats-functions.test.mjs`, all run in CI.

## Open

- **Live severe warning** (checklist section 1): the automated check runs hourly from Wednesday Nov 25 19Z through Thursday 09Z.
  Shared-beta navigation sign-off stays open if no eligible warning occurs in that window.
- **Rainfall overlays:** on the preview only, awaiting sign-off before the shared beta or main.
- **Next condition sets** (proposed, not built):
  - fire weather: NWS gust and relative-humidity grids, NOAA satellite fire detections;
  - smoke: near-surface smoke forecast;
  - severe: MRMS hail size and rotation tracks;
  - winter: WPC snowfall chances, NOHRSC snow depth;
  - heat: NWS HeatRisk;
  - coastal and tropical: NHC surge, NOAA tide gauges.
- Basemap licence decision before any paid or high-traffic launch.
- Live FAA status stays explicitly unavailable; SLD (SIPD) stays out until its source codes are verified.
