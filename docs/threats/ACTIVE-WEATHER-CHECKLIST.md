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

## Each time

- [ ] Run `node tools/threats-preview-check.js https://raw.githack.com/WxMan33/forecast-ops/<commit>/threats.html` and keep `report.json`.
- [ ] Note any requests that failed, and the source rows' "Checked …" times against the saved responses.
