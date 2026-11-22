# Weather threats: live source inventory (2026-11-20)

All endpoints below were fetched from this repository's Forecast Ops cloud environment on 2026-11-20 (about 19:00 UTC). Trimmed real
responses are in [`samples/`](samples/). These feeds now drive the branch preview's live mode; status by feed is at the end.

| Product | Endpoint (verified 200) | Format | Geometry | Identity and time fields | Browser CORS |
|---|---|---|---|---|---|
| Tornado and severe thunderstorm warnings | `https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning` | GeoJSON (`application/geo+json`) | Polygon on all 44 warning messages in the last-7-days sample | `id`, `sent`, `effective`, `onset`, `expires`, `ends`, `messageType` (Alert / Update / Cancel), `references[]`, `parameters.VTEC`, `parameters.eventEndingTime`, `parameters.NWSheadline`, `geocode.UGC` | `*` |
| Tornado and severe thunderstorm watches | same endpoint with `Tornado%20Watch,Severe%20Thunderstorm%20Watch` | GeoJSON | **Not verified:** no watch was issued in the API's recent window. Expected: county-based, `geometry: null`, counties in `affectedZones` | as above | `*` |
| County shapes for zone-only alerts | `https://api.weather.gov/zones/county/{UGC}` (e.g. `OHC061`) | GeoJSON | Polygon (verified for Hamilton County) | `properties.id`, `name` | `*` |
| SPC Day 1 / Day 2 categorical outlook | `https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson`, `…/day2otlk_cat.nolyr.geojson` | GeoJSON | Polygon / MultiPolygon per category | `LABEL` (TSTM…HIGH), `LABEL2`, `DN`, `VALID_ISO`, `EXPIRE_ISO`, `ISSUE_ISO`, `FORECASTER`, SPC `fill` and `stroke` | `*` |
| SPC Mesoscale Discussions: list | `https://www.spc.noaa.gov/products/md/` | HTML; says "No Mesoscale Discussions are currently in effect." when empty | links `md####.html` | n/a | `*` |
| SPC Mesoscale Discussion: text | `https://www.spc.noaa.gov/products/md/md2458.html` | HTML with `<pre>` text | `LAT...LON` line with 8-digit `DDddDDdd` pairs | number, "Areas affected", "Concerning…", `Valid DDHHMMZ - DDHHMMZ`, "Probability of Watch Issuance" | `*` |
| SPC Mesoscale Discussion: shapes (NOAA map service) | `https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query?where=1%3D1&outFields=*&f=geojson` | GeoJSON | **When none is active it returns a 0.001° placeholder square named `NoArea`.** It must be read as "none", never drawn. | `name`, `idp_filedate`, `idp_ingestdate` (fields while an MD is active are not yet verified) | echoes the Origin (verified for `wxman33.github.io`) |
| SPC watch list / KMZ | `https://www.spc.noaa.gov/products/watch/`, `…/watch/ActiveWW.kmz` | HTML, KMZ | KMZ polygons (not parsed yet) | watch number | `*` |
| Watch shapes (NOAA map service) | `…/outlooks/spc_wwa/MapServer` | **404: service not found** | n/a | n/a | n/a |
| Our research model | `https://raw.githubusercontent.com/WxMan33/forecast-ops/main/assets/severe-daily/index.json` (+ `grid.json`, `day1.json`, `day2.json`, `display-mask.json`, `models.json`) | JSON | grid points; existing contour code | `runs[].id`, `day`, `model_init_time`, `valid_start/end`, `prepared_at`, `sha256`; `operational_forecast_eligible: false` | used by `severe.html` today |

The sample's `ends` and `expires` were equal on warning messages. Times carry the issuing office's offset (e.g. `-08:00`) and are always parsed as instants.

## How the beta will handle them

**Identity and lineage.** A warning or watch is one product across its messages, keyed by its VTEC event
(`office.phenomenon.significance.ETN`, e.g. `KILN.TO.W.0071`). `references[]` links a message to the ones it replaces. The newest
message per key wins. "What changed" compares that message with the previous one for the same key: expiration, area, and
hazard tags.

**Updates, cancellations, expiration.** VTEC action decides the state: `NEW`/`CON`/`EXT`/`EXA`/`EXB` mean active; `CAN` means cancelled; `EXP` means expired;
`UPG` means upgraded. A cancellation is shown briefly as "Cancelled at 3:52 PM" (confirmed by the source), and an expiry is handled the same way.
The end time shown is `ends`, falling back to `eventEndingTime` and then `expires`. A product past its end time is removed whether or not a closing
message arrives. When a statement cancels some counties and continues others, the remaining area is the message's polygon or zones.

**Failed refresh vs. empty answer.** A 200 response with zero features is "none active", with its check time. A failed or timed-out
request keeps the last good copy on the map as "last known", with the last successful check time, until its published end time. After that it is
listed as "reached its published expiration; status unknown". The page never shows a product as cleared because a refresh failed. Each source has
its own freshness: alerts and MDs every 60 s (stale after 10 and 15 min); outlooks every 10 min (stale after 60 min).

**County-only coverage.** If an alert has `geometry: null`, fetch each `affectedZones` county (cached 7 days), draw them merged, and label
the item "Area drawn from counties". If a county shape fails, the venue relation is "unknown" ("Area not drawn; check the listed
counties"), never "outside". Watches are expected to need this path. That will be verified on the first live watch, with a fixture added from it.

**MDs.** Read the SPC list page for current numbers, then each `md####.html` for text, valid times and the `LAT...LON` polygon. In that line,
`37301946` means 37.30°N, 119.46°W: a longitude field under 50 gets 100 added. The NOAA map service is a geometry cross-check only, with
`NoArea` treated as empty. An MD past its `Valid … Z` end time is removed.

**Outlooks.** Poll the categorical GeoJSON. `ISSUE_ISO` identifies the issuance. "What changed" appears only between two issuances of the same
day's outlook. The SPC `fill` colors match the legend already on the page.

**Research model.** Reuse the existing `SevereDailyCore` validation (checksums, timing protocol, registry, expiry) and display mask. It stays
opt-in on Day 1 and Day 2, labelled experimental, with "no guidance" outside the research grid (-100° to -75°, 30° to 45°).

## Gaps found

- Watch geometry is unverified until a live watch exists.
- MD map-service fields while an MD is active are unverified.
- The `api.weather.gov` docs ask for an identifying User-Agent. Browsers cannot set it, so the page sends a standard browser request.
  A server-side collector would be needed only if NWS throttles browser polling. That would be new infrastructure, so it's your call.
- Alaska, Hawaii and Puerto Rico alerts exist in the feed, but the map and outlooks cover the contiguous U.S. The page says so.

## Mesoscale Discussion source options (checked 2026-11-20)

| Source | Official | Reaches the hosted page | Active list | Geometry | Validity | Bulletin |
|---|---|---|---|---|---|---|
| SPC list page `products/md/` + `md####.html` | Yes | **No for automated browsers** (HTTP 403 to the `HeadlessChrome` identity, with no CORS header). Ordinary requests get 200 with CORS `*`. | Image-map entries | `LAT...LON` | `Valid DDHHMMZ - DDHHMMZ` | the page itself |
| SPC `products/md/ActiveMD.kmz` (listed on spc.noaa.gov/gis) | Yes | Same 403 to automated browsers (same `/products/md/` path); 200 with CORS `*` otherwise | KML placemarks; when none: "No Active MDs as of …" (seen) | KML (active form not seen) | not seen | link to SPC |
| NOAA map service `outlooks/spc_mesoscale_discussion` | Yes (NOAA) | **Yes**: 200 with CORS echoing the origin, from the hosted preview | Features; when none: the `NoArea` placeholder (seen repeatedly) | Polygon | **Unknown**: fields are `name`, `folderpath`, `popupinfo`, `idp_filedate`; active contents never observed | not provided; we link to SPC |
| SPC archive `products/md/2026/md####.html` | Yes | Same `/products/md/` path | n/a | `LAT...LON` | yes | yes |

NOAA's service description: it covers SPC MDs (severe *and* winter) and updates "within 15 minutes" of issuance.

**What the page does now.** It tries SPC's list and text first, which is complete. If SPC can't be reached, the NOAA service decides:
- **`NoArea`:** "Checked … via NOAA map service · none active" (it may lag SPC by up to 15 minutes).
- **Shapes:** drawn, with the MD number taken from the feature's name or popup text when present. Valid time, area and text are marked "Unavailable", and the official bulletin link goes to SPC's MD page, or SPC's MD list page when the number is unknown.
- **Anything else** (an error, or a shape-less or malformed answer): MD status unknown.

**Verified:** the quiet state from the hosted browser (service `NoArea`); the SPC text parser on official archived MD 2458.
**Still unknown:** what the map service returns for an active MD (name format, whether `popupinfo` carries validity or text, how winter MDs can be told apart). No active MD has occurred during this work, and I found no official archived sample of the service's active response. The active path is fixture-tested only.

## Archived official samples (replayed, not live observations)

The NWS API keeps about 7 days of alerts; queries for Oct 1–Nov 15 return none. Samples used:

| Sample | Source | What it exercises |
|---|---|---|
| `nws-archive-klox-sv-w-0015.json` | 3 unmodified CAP messages from api.weather.gov (NWS Los Angeles, Nov 19, NEW → CON → CON) | A real polygon and real updates. SoFi Stadium: "in effect at the venue" → after the last update "8 miles southeast · the venue is outside the warning area", "What changed: area reduced by about 47%". Long Beach Convention Center stays covered. |
| `nws-archive-kmtr-to-w-0003.json` | 3 unmodified CAP messages (NWS San Francisco tornado warning, Nov 16, NEW → CON → CAN) | Cancellation by the source: "cancelled by NWS at 1:22 PM PST" |
| `spc-wou0705.txt` | Official SPC watch outline update for Tornado Watch 705 (Nov 12), converted to the NWS alert shape (`geometry: null`, `affectedZones` from its UGC list, its VTEC) | A real county-based watch: 20 counties plus 3 marine zones. In the hosted page, all 23 shapes resolve live from api.weather.gov. Lincoln Financial Field is inside; MetLife Stadium is outside. |

The WOU conversion is ours: the CAP watch messages for #705 are no longer served by the API. A live CAP watch may also list zones by forecast zone, and may come split by issuing office. Watch handling is therefore **archive- and fixture-tested, not yet observed live**.

Malformed, failed and incomplete answers never produce "none active" and never clear the last known products. This covers an unreadable severe message, a paged response, null entries, an HTML error page, a network failure and a timeout. Each counts as a failed refresh. Tested in `tests/threats-feeds.test.js`.

## Identifying Forecast Ops to NWS

**The requirement** (weather.gov/documentation/services-web-api, "Authentication"): "A User Agent is required to identify your application… If you include contact information… This will be replaced with an API key in the future." The same page: "Proxies are more likely to reach the limit, whereas requests directly from clients are not likely."

**What identifies the app in the actual hosted request** (recorded by `tools/threats-preview-check.js`):
- `User-Agent`: the browser's own. Chromium replaced the page's requested `(forecast-ops, github.com/WxMan33/forecast-ops)` with its own string; NWS still answered 200.
- `Origin: https://raw.githack.com` and a `Referer` naming the page. On github.io or Pages this would be that domain.
- No app identifier, and no contact.

**Can existing Forecast Ops infrastructure supply the documented identifier?**
- **Node tools and CI:** yes. They already send `(forecast-ops, github.com/WxMan33/forecast-ops)` (`assets/ops-data.js`).
- **Browser pages (all existing tool pages, and this one):** no. A browser cannot set it.
- **Cloudflare Pages beta origin (`forecast-ops-beta.pages.dev`):** it could, but only by adding a request-forwarding function. That is the collector option, on hold.
- **GitHub Actions (the `verify/` pattern):** it can send the header, but runs every 5 minutes at best and often late. Too slow for warnings.

**Update (this branch):** a branch-only Pages Function now forwards Threats' NWS requests with that identifier (see [NWS-FUNCTION.md](NWS-FUNCTION.md)).
It is tested locally against real NWS (NWS received the identifier) and end to end. It is **not deployed**, so the hosted preview still calls NWS directly.

**Status of the direct browser path, unchanged:** The page works today, and every request returned 200. It does not send the documented app identifier, and no existing infrastructure can add one without a new forwarding layer. The collector and any outreach to NWS remain on hold, as decided.

## Branch live preview: feed-by-feed status

| Feed | Live (hosted browser) | Archived official sample | Fixture only | Open |
|---|---|---|---|---|
| NWS warnings | Request, CORS and a confirmed empty answer | Real polygon, updates moving off a venue, cancellation | Extension, duplicates, out-of-order messages, split CAN/CON, expiry during an outage, malformed and paged answers | A live active warning |
| NWS watches | Same request | WOU 705 converted; real county shapes resolved live | County-only with unresolved counties → "unknown" | A live CAP watch (format and zone types) |
| SPC outlooks | Drawn with SPC issue and valid times | n/a | Rollover; failed fetch keeps the last good copy | Rollover observed live |
| SPC MDs | Quiet state via the NOAA service (SPC pages refuse automated browsers) | MD 2458 text | Active service response; active SPC list | The service's active fields |
| Research model | Published Severe-viewer feed, checksummed | n/a | n/a | — |
