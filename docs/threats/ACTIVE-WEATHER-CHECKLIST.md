# First active-weather verification

The archived replays already show how the map handles real warning updates, a cancellation, and Watch 705's county list.
Three things can only be confirmed live. Use an ordinary desktop browser and a phone. Open the live preview (Data: Live official feeds).
After the function is deployed for review, also open it with `?nws=function` on that host.

Save everything in `docs/threats/live-checks/<date>/`, labelled LIVE.

## 1. A warning drawn directly from the live feed

When NWS has an active tornado or severe thunderstorm warning in the contiguous U.S.:

- [ ] **Source response:** save `https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch,Severe%20Thunderstorm%20Watch` as JSON. Note the time.
- [ ] **National view (desktop):** the warning marker shows at national zoom, and it is the first item in "Most urgent now". Screenshot.
- [ ] **Venue view:** pick a venue inside or near the polygon (Venue menu, or `?lat=…&lon=…&name=…`). Check "in effect at the venue" or
      "N miles <direction> · the venue is outside the warning area". Screenshot on desktop and on phone with the sheet closed.
- [ ] **Detail:** headline, expires, venue relationship, the official bulletin text, and the source link to the alert record. Screenshot.
- [ ] **If it updates while open:** "What changed" appears with the right expiration and area change, and the venue relationship
      follows the new polygon. Save the second JSON response.
- [ ] **When it ends:** "cancelled by NWS at …" or "no longer listed" for a nearby venue. Nothing stays drawn.

## 2. A real NWS watch message

When SPC issues a tornado or severe thunderstorm watch:

- [ ] **Source response:** save the alert list JSON. Record whether watch messages have `geometry: null`, what `affectedZones` lists
      (county `…/zones/county/…`, forecast zones `…/zones/forecast/…`, marine zones), and whether one watch arrives as one message or
      one per issuing office.
- [ ] **Map:** a single outline with no internal county lines; the label "Area drawn from N counties and M marine zones". Screenshot of the
      national view and of a venue inside.
- [ ] **Venue just outside the watch:** "Nothing active", or the venue relationship. If any zone fails, the label reads "Incomplete area" and
      a venue that a missing zone could cover shows "unknown". Screenshot.
- [ ] Compare with SPC's own watch page (`https://www.spc.noaa.gov/products/watch/ww####.html`): same number, end time and counties.
- [ ] **Then:** add the saved JSON as a fixture and replace the WOU conversion in the watch tests with it.

## 3. The NOAA map service with an active MD

When SPC has an active Mesoscale Discussion:

- [ ] **Source response:** save `https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query?where=1%3D1&outFields=*&f=geojson`.
      Record the exact `name`, `popupinfo` and `folderpath` values, and how long after SPC's issue time the shape appeared.
- [ ] Also save SPC's `https://www.spc.noaa.gov/products/md/` and the MD's own page (from a normal browser), for the number, valid times and text.
- [ ] **In the preview:**
  - [ ] the MD source row says how it was checked: via SPC, or via the NOAA map service;
  - [ ] the MD outline is drawn;
  - [ ] the detail shows the number, valid time (or "Unavailable"), and a working link to the SPC bulletin.

  Screenshot of the national view and the MD detail.
- [ ] **Winter MDs** (snow, freezing rain): check whether the service lets them be told apart from severe MDs. They must not appear here.
- [ ] **Then:** add the saved service response as a fixture. Update `mdFromService` if the fields differ from the guess in the code, and the test.

## 4. Still pending live (recorded 2026-11-20, Planner branch `claude/threats-planner-flood`)

| Check | Status |
|---|---|
| Live tornado or severe thunderstorm **warning** drawn from the feed (section 1) | Pending: none active in a usable spot during the checks |
| Live **Flash Flood Warning** reaching Event Planner through `/api/nws` | **Done 2026-11-21 04:24Z (live):** KJAX FF.W.0055 (Gilchrist County, FL; 10:26 p.m.–12:30 a.m. EST). For a test point inside the polygon (29.67, -82.865) and an event inside the window, Planner showed "Flash Flood Warning until 12:30 a.m. Saturday · Covers the venue during the event", via `/api/nws` with its upstream time. Evidence: `live-checks/2026-11-21/live-planner-ffw-kjax-0055.json` and `.png`; official payload `tests/fixtures/threats/nws-live-kjax-ff-w-0055.json` |
| Live **wildfire within 15 miles** reaching Planner, and a live **smoke item** at a test venue | See below |
| Live NWS **watch** message (section 2) | Pending |
| NOAA map service with an **active MD** (section 3) | Pending |
| **Same storm**: WSSI-P in Planner several days before an event, then the NWS alert for that storm | Pending: WPC's WSSI-P shapes are not archived (ftp-wpc keeps images only), so it needs captures days apart. Capture with `python3 tools/capture-wssi-p.py NAME W S E N OUT.json` |
| Live **Red Flag Warning / Fire Weather Watch** reaching Planner through `/api/nws` | Pending: none active on Nov 20–21; proven on archived NWS Denver/Boulder messages |
| Live **SPC Day 1–2 Critical** fire area or a **Days 3–8 probability** (40/70%) at a venue | Pending. Live Elevated verified Nov 21 01:19Z (Cheyenne, `planner-check/live-planner-fire.json`). The 40/70% label format will be confirmed when SPC first draws one: the parser accepts "40", "40%" and "0.40" and rejects anything else (the source then reads not confirmed) |
| Live **wildfire within 15 miles** of a test venue | Pending as a live Planner item; live NIFC feeds (225+ incidents, perimeters) verified on the map |
| NOAA **NAQFC smoke unit** (service text says "micrograms per cubic feet") | Pending: confirm with NOAA. Until then Planner names phases only and More info shows the raw value with that note |
| Live **smoke item** at a test venue (HMS plume over it, or an AirNow monitor at USG or worse within 15 mi) | Pending as a live Planner item; live HMS (function), AirNow and NAQFC answers verified (`planner-check/live-planner-smoke.json`) |
| **WSSI-P failed-level fallback** (retry, then "inferred" from the level below) | Shipped (`0a80946`, present in the deployed file). Not triggered live yet: every hosted run since had all five levels answer |
| Live **Winter Storm Warning** in Planner and on the map | **Done 2026-11-20 21:43Z**: KSLC.WS.W.0003 at Snowbird through `/api/nws`, with live WSSI-P (5 point queries) on the same event. `docs/threats/planner-check/live-planner-winter.json` |

## Map crash fixed 2026-11-21

`TypeError: Cannot read properties of undefined (reading 'slice')` at `shade` ← `drawMap` ← `setView`. Deployed file `threats.js?v=d9b6aff3cd` (app files of `9599215`).
- **When it fired:** a live SPC fire weather Day 1 area existed and Day 1 was opened.
- **Cause:** fire outlooks were taken for convective outlooks.
- **Fix:** `2a5eddc`.
- **Regression checks** (`tools/threats-planner-check.js`, section 4f):
  - an archived replay that fails before the fix;
  - a live walk-through with 75 s of background refreshes;
  - partial feeds.

## Each time

- [ ] Run `node tools/threats-preview-check.js https://raw.githack.com/WxMan33/forecast-ops/<commit>/threats.html` and keep `report.json`.
- [ ] Note any requests that failed, and the source rows' "Checked …" times against the saved responses.
