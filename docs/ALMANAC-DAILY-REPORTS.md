# Almanac daily reports

How the Almanac's morning flow decides what "yesterday" and "today" mean, which report it shows, and how often it
checks. Code: `assets/climate-daily.js` (rules, no network), `assets/almanac.js` (loading, refresh, rendering).
Tests: `tests/climate-daily.test.js`, `tools/almanac-daily-check.js`, `tools/almanac-refresh-check.js`.

## What the page shows

For the location's **today** (its own time zone, not the viewer's):

1. The date, today's normals and records, sun and moon, and the day's weather history. Today's normals and records
   always belong to today, even while yesterday's observations are shown.
2. **Yesterday's weather**: reported high, low, precipitation and snowfall, each with its departure from normal where
   a normal exists. It stays on the page after today's report arrives.
3. **Today's climate update**, only when NWS has issued a climate report (CLI) dated today. It is labelled
   **Interim · as of <time>** when the product is valid only to an afternoon or evening cutoff, or **Completed day**
   when it covers the whole day.

An explicitly chosen date (date picker, ◀ ▶, or `?date=` in a link) stays on that date. "Today" follows the
location's day, including across midnight in an open tab; it is not written into the address, so a reloaded or
restored tab opens on the current day. TODAY returns to following the location's day.

## Which report

- **Observation date** comes from the product's own line `CLIMATE SUMMARY FOR <MONTH> <DAY> <YEAR>`. It is never
  inferred from the issue time. A report issued after midnight usually describes the previous day.
- **Station**: only a product carrying `CLI<station>` for the selected climate station, from that station's office.
- **Interim or completed**: a product with `VALID (TODAY) AS OF <hhmm> <AM|PM>` before 11:59 PM is interim. A product
  without that line, or valid as of 11:59 PM, is a completed day. NWS climate days run midnight to midnight
  **local standard time** all year, so during daylight saving time the day ends at 1 AM clock time.
- **Corrections**: a correction is a new issuance (often marked `CC?` in the WMO heading). For each date, a completed
  report wins over an interim one; within the same kind the latest issuance wins, so a correction replaces the
  report it corrects.
- **Yesterday's source order**: completed NWS report → complete RCC-ACIS day → NWS interim report (labelled as
  interim, "not the day's final values") → nothing ("Not reported yet", or "Couldn't check…" if the check failed).
- **Departures**: from the report's own NORMAL/DEPARTURE columns when the NWS report is the source; otherwise
  observed minus the NCEI 1991–2020 daily normal from ACIS. A trace counts as zero for a departure.

## Totals and ACIS lag

- Cumulative totals (month, season, year to date) stay labelled with their actual cutoff date.
- A **completed** NWS report for a day ACIS has not filled yet may fill that day. The page does not wait for ACIS.
  It fills only values ACIS lacks, so a day is never counted twice.
- An **interim** report never extends a complete-day total. Today's values are shown as preliminary, and totals stop
  at the last completed day.

## Refresh cadence

| When | What happens |
| --- | --- |
| Page load | Full load: station, sun and moon, climate sheet, NWS reports. |
| Returning to the tab | Reports and observations rechecked if the last check is over 1 minute old. |
| While visible | Rechecked every 5 minutes. A 1-minute timer only decides whether a check is due and detects midnight. |
| Hidden tab | No requests. |
| Midnight (location's zone), date not chosen | The sheet moves to the new day; yesterday becomes the day that just ended. |

Each check makes one request for the station's CLI product list. That request is revalidated (`cache: no-cache`, so a
304 is cheap). It then fetches the up to 8 newest products from the station's office. Product URLs never change, so
their bodies may come from the browser's HTTP cache. Only one check runs per station at a time. ACIS observations
are cached in the browser for 5 minutes for recent dates.

If a check fails, the page keeps the last valid reports from this browser and says "Couldn't refresh NWS climate
reports at <time> (<reason>). Showing the reports retrieved at <time>." It never turns a failed check into "not
reported yet". A later successful check clears the message. ACIS data behaves the same way: the last valid copy
stays, with its own retrieval time, and the failure is stated.

## Observed publication behaviour (not a schedule)

These are observations, not promises. Offices issue CLI products when they can, and times vary.

Live check on 2026-11-13 04:18 UTC. KILN (Wilmington, OH) CLI products for CVG, Nov 9–12, 2026:

- One product per day around **21:49–22:05 UTC** (about 4:50–5:05 PM EST). It is interim, for that day, "VALID TODAY
  AS OF 0400 PM" or "0500 PM".
- One product per day around **05:32–05:51 UTC** (about 12:30–12:50 AM EST). It is a completed report for the
  **previous** day ("YESTERDAY" rows). For example, the product issued 2026-11-12 05:51 UTC is the Nov 11 report.
- RCC-ACIS had Nov 11 (matching the completed NWS report) and Nov 12 still missing at 11:18 PM EST on Nov 12.

Other offices and stations may issue at different times, more or fewer times a day, or late. The page relies on the
dates and validity lines inside each product, not on these times.

## Where it runs

`almanac.html` and its scripts are shared by every deployment of this repository:

- **Beta previews** (`beta-previews` branch): the Cloudflare Pages beta origin (forecast-ops-beta.pages.dev) and the
  raw.githack.com preview. A merge into `beta-previews` reaches both; the Beta preview check workflow verifies them.
- **Production** (GitHub Pages from `main`, wxman33.github.io/forecast-ops): only through the existing release
  process (beta-previews → main). Merging this change into `beta-previews` does not deploy it there.
