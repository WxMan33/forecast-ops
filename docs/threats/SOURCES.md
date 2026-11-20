# Weather threats: live source inventory (2026-11-20)

All endpoints below were fetched from this repository's Forecast Ops cloud environment on 2026-11-20 (about 19:00 UTC). Trimmed real
responses are in [`samples/`](samples/). Nothing is wired into the page yet; this is the plan for Phase 2.

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

## Branch live preview: feed-by-feed status (2026-11-20, hosted preview on raw.githack.com)

Evidence: `node tools/threats-preview-check.js` opens the hosted preview as a signed-out visitor (clicking through the host's
one-time notice) and records every feed request the browser makes. Results are in `screens/live/report.json`. The tests are
`node tests/threats-feeds.test.js` (21 checks on real captured responses and labelled fixtures) and `node tests/threats-core.test.js`.

| Feed | Verified live from the hosted browser | Tested with fixtures | Still open |
|---|---|---|---|
| NWS warnings | Yes. HTTP 200, CORS `*`, a confirmed empty answer ("none active", none in effect nationally at check time) | New issuance, update shrinking the warning off the venue, extension, cancellation, duplicate and out-of-order messages, split CAN/CON statement, expiration during a failed refresh, empty answer ends unlisted products, unrecognized response counted as a failure. The real 44-message sample all normalizes. | An active warning has not been rendered live yet; none was in effect during the check |
| NWS watches | Same request and answer as warnings | **Fixture-tested only.** County-only watch: titled by number, area drawn from real county shapes, venue relation "unknown" while a listed county is unresolved | No live watch sample yet; watch geometry is still unconfirmed |
| SPC Day 1 / Day 2 outlooks | Yes. HTTP 200, CORS `*`, drawn with their own issue and valid times (Day 1 issued 1624Z, valid 1630Z–1200Z) | Real Day 1 file; rollover (past its valid end it is no longer drawn and the page says "awaiting next issuance"); a failed fetch keeps the last good issuance; an unrecognized answer counts as failed | No live rollover observed yet |
| SPC MDs: list and MD pages | **No.** SPC answers HTTP 403 to automated (headless) browsers, with no CORS header, so the check sees "Not responding · status unknown", the intended failure display. The check does not disguise its browser identity. | Real "none in effect" list page (confirmed empty; the "most recently issued" link is ignored), real MD 2458 text (valid window, LAT...LON polygon), unrecognized pages | Verify in an ordinary browser: the MD source row should read "Checked … · none active". The active-list markup is fixture-only. |
| NOAA MD map service (cross-check) | Yes. HTTP 200, CORS echoes the origin, the real `NoArea` placeholder read as empty | Placeholder filter; unrecognized answer | Fields while an MD is active |
| Our research model | Yes. The Severe viewer's published files on `main` (`index.json`, `models.json`, `grid.json`, `display-mask.json`, `day1.json`, `day2.json`), all checksum-verified; all three hazards, Day 1 and Day 2 | Same validation code as the Severe viewer (`SevereDailyCore`) | Its 24-hour window (12Z–12Z) differs from SPC's Day 1; the page shows both windows |

## Identifying Forecast Ops to NWS

**The requirement.** The API docs (weather.gov/documentation/services-web-api, "Authentication") say: "A User Agent is required to identify
your application… If you include contact information (website or email), we can contact you… This will be replaced with an API key
in the future." The same page says: "Proxies are more likely to reach the limit, whereas requests directly from clients are not likely."

**What Forecast Ops does today.** Node tools and CI send `User-Agent: (forecast-ops, github.com/WxMan33/forecast-ops)` (`assets/ops-data.js`).
Browser pages, including every existing tool page's NWS alerts and forecasts, call api.weather.gov directly and cannot set a User-Agent.

**What the hosted preview actually sends (verified).** The browser's own User-Agent, plus `Origin: https://raw.githack.com` and a `Referer`.
A page script that asks for `User-Agent: (forecast-ops, github.com/WxMan33/forecast-ops)` is overridden: Chromium sent its own string, and NWS
answered 200. From here, a request with an empty User-Agent gets 403 and a browser string gets 200.

**Path that meets the requirement, smallest first.**
1. **Branch preview and beta: direct browser requests (no new infrastructure).** This is the client path the NWS docs describe as least likely
   to be limited. The site is identified by `Origin`/`Referer` (the github.io or Pages domain), not by User-Agent. Any Node-side job keeps the identifying
   User-Agent. Open question for NWS: whether browser apps identified by Origin are acceptable. Asking (API GitHub discussions or nco.ops@noaa.gov) is your call.
2. **If NWS asks for a User-Agent with contact, or throttles browser polling:** a Cloudflare Pages Function on the existing
   `forecast-ops-beta` Pages project (already used for the calendar beta). One route proxies `alerts/active?event=…` with the identifying
   User-Agent and a 30-second edge cache. **Refresh latency:** up to 30 s added (cache) plus about 0.1–0.3 s. **Cost:** $0 on Cloudflare's free plan
   (100,000 function requests a day, about 70 viewers polling every minute all day); the paid plan is $5 a month for 10 million; these figures are from Cloudflare's published pricing and were not re-checked in this session. It adds
   one deployable function; it is not a server to run. Per the docs, it is *more* likely to meet rate limits than browsers, so it should cache.
3. **Not suitable for warnings:** a GitHub Actions collector (the pattern `verify/` uses). Scheduled runs are at best every 5 minutes and often
   run late, too slow for warnings. It would be fine for outlooks.

**Evidence for a collector today:** none beyond the documented requirement. Every browser request in these checks returned 200. This
preview stays on option 1, and option 2 is your decision.
