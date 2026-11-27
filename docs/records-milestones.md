# Weather Records & Milestones

Forecast Ops finds the notable weather story for the selected market. **Overview** shows up to three timely highlights. **Almanac** shows each finding with its evidence and a stand-alone "Copy fact" line. One engine (`assets/records-engine.js`) does the calculations for every market.

## How a finding is labelled

| Label | Meaning |
|---|---|
| **Observed record** | The value is confirmed in the quality-controlled archive (NCEI GHCN-Daily for U.S. stations): same station, date, measurement and value, no quality flag. Only records packs do this check. |
| **Preliminary observation** | The value comes from the NWS daily climate report or CF6, carried by ACIS, and isn't final yet. Copy says "(preliminary)". |
| **Archive confirmation unavailable** | A real historical observation from the station's record whose value hasn't been checked against the archive: Almanac findings for places without a records pack. Never inferred from age (a 1953 record is not called final, and not called preliminary). Copy says "(archive confirmation unavailable)". |
| **Interim report** | A same-day report before the day is complete. It never produces a finding. |
| **Forecast record potential** | Reserved for phase 4. Guidance near a record, never written into observed records. |

## Station selection

- **A market's record** is the official one where it exists: the NWS threaded city record (ThreadEx, for example `CVGthr`), which joins the stations that kept the city's record over time. Otherwise it's a single station.
- **Every finding names the record and its kind.** "Official city record" and "station record" are kept apart. For example, Cincinnati's Nov 26 record is 1.49 in (1946) in the city record, but 1.44 in (2007) in the airport-only record that starts in 1947.
- **Cincinnati's record segments:**
  - downtown city office, 1871 to Mar 1915;
  - Abbe Observatory, Apr 1915 to Mar 1947;
  - CVG airport from Apr 1947. From then on the thread and CVG agree day for day.
- **The normals** are the observing station's 1991-2020 normals.
- **Final or preliminary** is decided per value, never by date alone. A finding is final only when NCEI's GHCN-Daily archive for the market's current observing station (`ghcnd` in `feeds/insights/markets.json`) has the same date and measurement, with the same value (precipitation within 0.005 in, snowfall within 0.05 in, temperature exact, trace only matching trace) and no quality flag (`RecordsEngine.confirm`). The archive's latest date is shown for context only: an earlier date can still be missing from the archive or differ from the value the finding used. Month to date is final only when every day of the month so far is confirmed. If NCEI can't be read, everything stays preliminary.
- **Markets** are configured in `feeds/insights/markets.json`: id, name, country, region, time zone, units, record id and kind, normals station, GHCN-D id and thresholds.
- **Places without a pack:** the Almanac judges daily records only, from the calendar-day history it already loads (ClimateStation's record for the point), labels them Archive confirmation unavailable (no extra NCEI request on page load), and says that holiday rankings and longer context need a pack. Checked offline with recorded real responses for Columbus on Sep 2, 1953 (`tests/fixtures/records/columbus-1953-almanac.json`).

## Coverage rules (every finder)

- **Missing ("M")** never counts as zero and is left out of every sample and denominator. The number left out is reported.
- **Trace ("T")** stays apart from zero. It is never a record amount and never meets a threshold.
- **Ties** list every tied year.
- **Leap days** compare leap years only.
- **Suppression:** a claim is suppressed with fewer than 30 usable years, or with under 80% of the possible years in its window.
- **Partial-period rankings** (month to date) compare the same day span in every year and use only complete spans.
- **Forecast or model values** never enter an observed record or ranking.

## Holiday rules (`assets/records-holidays.js`)

| Holiday | Rule |
|---|---|
| US Thanksgiving | 1863 to 1938: last Thursday of November. 1939 to 1941: the federal date (next-to-last Thursday) and the last Thursday are both candidates, because states split ("Franksgiving"); Ohio's and Kentucky's choices aren't verified. From 1942: fourth Thursday of November. |
| Memorial Day | May 30 through 1970; last Monday of May from 1971. |
| Labor Day | First Monday of September from 1894. |
| New Year's, Independence Day, Veterans Day (from 1919), Christmas | Fixed dates. |
| Canada Thanksgiving | Second Monday of October from 1957. Earlier years are left out, not guessed. |

**Uncertain years:** when a year has more than one candidate date, the ranking and frequency are computed under each candidate. The result is published only if it is the same for all of them. Cincinnati's Thanksgiving results are identical either way.

## First acceptance case: Cincinnati, Thanksgiving Nov 26, 2026

- **Observation:** CVG measured 2.16 in. The NWS daily climate report (final for the day, issued 12:55 AM EST Nov 27), the CF6 and ACIS agree. NCEI's archive runs through Nov 15 and doesn't have Nov 26, so the value is **preliminary**.
- **Calendar-day record:**

  | Record | Result |
  |---|---|
  | City record (CVGthr) | Breaks 1.49 in (1946) by 0.67 in. The record was 80 years old; 155 prior years, none missing. |
  | Airport-only (CVG) | Breaks 1.44 in (2007) by 0.72 in; 79 prior years. |

- **Thanksgiving ranking** (each year's own observed date):
  - 2nd of 156 since 1871, behind 2010 (2.62 in). Then 1961 (1.16 in) and 1968 (0.93 in).
  - Airport-only: 2nd of 80.
- **Historical frequency:** 2 of 156 Thanksgivings had at least 2.00 in (1.3%). Before 2026, it was 1 of 155.
- **Context:**
  - the 4th wettest November day (behind Nov 5, 1948, Nov 25, 2010 and Nov 3, 2011);
  - the last day of any month this wet was Jul 20, 2025 (2.94 in);
  - November had 4.34 in through the 26th, 1.57 in above normal to date (157%), already above the full-month normal of 3.23 in.

These are fixed in `tests/records-engine.test.js` from a real ACIS snapshot (`tests/fixtures/records/cvg-november.json`).

## Data flow and caching

- **Packs:** `tools/build-insights.js` reads each market's full daily record from RCC-ACIS once, plus normals and NCEI status. It writes `feeds/insights/<id>.json` (about 4 KB) and `feeds/insights/index.json`.
- **Overview** reads only the pack and caches it for 15 minutes in sessionStorage. It never downloads a climate archive. With no pack, or a failure, the section stays hidden and the page is unchanged.
- **Almanac** shows the pack's findings for the selected date. Without a pack it computes daily records from data it already has.
- **What a pack holds:** findings for the last 60 days (`windowDays`), with `through` (last day covered), `finalThrough` (the archive's latest date, for context only) and `generated` (when the refresh ran). The index lists each market's name, official record, centre and radius (60 km), so a place is matched to the nearest market whose radius covers it.

## Preview coverage

The preview has two packs, both built from real RCC-ACIS and NCEI data for the 60 days through Nov 26, 2026:

| Pack | Official record | Days with findings |
|---|---|---|
| Cincinnati (`cvg`) | Cincinnati Area threaded record (CVGthr) | Oct 1, Oct 13, Oct 14, Nov 3, Nov 4, Nov 26 (Nov 26 preliminary; every other finding confirmed in NCEI's archive, same value, no flag) |
| Denver (`den`) | Denver Area threaded record (DENthr), America/Denver | Sep 28, Oct 5, Oct 6, Oct 8 to 11, Oct 20 to 23 (all confirmed in NCEI's archive for USW00003017). Oct 6: record warm low (59°F, old record 55°F in 1947) and a tie with the record high (87°F, 1975 and 2020) |

Every other place has no pack. Overview hides the section there. Almanac shows daily records from the point's own climate station history when that loads, with a note naming the preview's packs. The Almanac coverage line for a pack names the record, the 60-day window, how far the data is final and when the pack was refreshed.

**Changing places never carries facts over.** The section is cleared the moment the place changes, before the next pack loads, and a slow answer for the earlier place is dropped. `tools/records-check.js` covers Cincinnati to Denver (with the Denver pack held back 1.5 seconds), Denver to Columbus (no pack) and back, on Overview without a reload and on Almanac in one tab with a shared session cache.

## Refresh

**Existing workflow.** `.github/workflows/astronomy.yml` ("Refresh Cincinnati astronomy") already runs four times a day on standard GitHub-hosted runners: 1:43 AM, 7:43 AM, 1:43 PM and 7:43 PM ET (`43 0,6,12,18 * * *` UTC; an hour later in summer). Each run takes about 42 seconds, recent runs all succeeded, and it commits `feeds/iss-cincinnati.json` to `main`.

**It can build the packs** by adding two steps after its own: `node tools/build-insights.js` and `git add feeds/insights`. The builder takes under 10 seconds for both markets (6.5 s in a test run) (one ACIS request per market for the full record, one for normals, one NCEI request for status) and needs no keys. Two conditions:

1. `tools/build-insights.js`, `assets/records-engine.js`, `assets/records-holidays.js` and `feeds/insights/markets.json` must be on `main`, because the workflow runs there. That means after the feature ships to production, not before.
2. The step should not fail the astronomy refresh: run it with `continue-on-error: true`, so a records outage never stops the ISS feed.

The 7:43 AM and 7:43 PM ET runs line up with the overnight daily climate report (the prior day, complete) and the late-afternoon report (today so far, which the builder never uses, since it stops at yesterday in the market's time zone). No separate twice-daily job is needed unless the owner wants a different time. Nothing has been added yet.

**Preliminary to final, and revisions.** Every refresh recomputes every finding in the 60-day window from the source; nothing is patched. So:

- When NCEI's archive confirms a value (same station, date, measurement and value, no quality flag), the next refresh relabels the findings that use it **Observed record** and drops "(preliminary)" from the copy. If the archive has a different value or a flag, the finding stays preliminary.
- When the source revises a value, the next refresh uses the new value. A record claim that no longer holds disappears; a new one appears. `tests/records-engine.test.js` ("refresh: ...") builds the Cincinnati Nov 26 pack three ways: as issued (2.16 in, preliminary), after a downward revision to 1.40 in (the record claim is gone), with the archive's latest date past Nov 26 but no matching value (still preliminary), with a different archive value or a quality flag (still preliminary), and with the archive confirming 2.16 in (Observed record, no preliminary note; month to date stays preliminary until every November day is confirmed).
- Browsers keep a pack for up to 15 minutes, so a change shows within 15 minutes of the commit reaching the site.

**When a refresh fails.** The builder writes each pack to a temporary file and renames it only when complete, so a failed market keeps its last good pack. It logs "refresh failed (...); its last pack stays in place", keeps that market's index entry and exits with an error, so the run shows red. On the page, findings stay visible with their original labels. Once a pack is more than 36 hours old, Almanac's coverage line adds: "This refresh is N hours old, so newer observations or revisions aren't reflected yet." If the pack can't be read at all, both sections stay hidden and the rest of each page works (both are checked in `tools/records-check.js`).

## Toronto plan (not built)

- **Data:** Environment and Climate Change Canada, through MSC GeoMet's OGC API: `climate-daily` for daily observations, `climate-normals` for 1991-2020 normals and ECCC's long-term threaded extremes for Toronto (station IDs and how ECCC joins the city and airport records to be confirmed from ECCC's own metadata). These hosts are blocked from this build environment; whether GitHub-hosted runners reach them needs one manual run to confirm.
- **Units:** keep ECCC's native metric (mm, cm, °C) in the pack and copy. Never convert to inches for Canadian markets; the engine already formats mm and is unit tested for Toronto.
- **Final or preliminary:** ECCC's per-value quality flags take the place of the NCEI comparison. Unflagged, quality-controlled values are final; values flagged estimated or not yet reviewed are preliminary.
- **Holidays:** Canadian Thanksgiving is fixed as the second Monday of October from 1957. Earlier years were set by proclamation each year; they need a table from the Canada Gazette, and until then those years are left out, not guessed. Provincial holidays (Civic Holiday, Family Day) and Victoria Day need their own rules and per-province tables before they're offered.
- **Acceptance:** a verified Toronto case, like Cincinnati's, checked by hand against ECCC before Toronto is listed.

## Markets checked

| Market | What the engine supports |
|---|---|
| Cincinnati (CVGthr since 1871; CVG since 1947) | Everything above. |
| Denver (DENthr since 1872; DEN since 1994) | In the preview (pack `den`). Daily records and holiday rankings for temperature and precipitation. Oct 6 2026's 87°F **tied** the threaded record's daily record (1975 and 2020), but only 2020 in the airport record. Snowfall has a gap in 1995 to 2005. Airport-only Thanksgiving snowfall has 21 usable years, so it's suppressed. Dec 2013 precipitation is missing. No ACIS snowfall normals for DEN. |
| Toronto (non-U.S., metric, Canadian Thanksgiving) | The engine runs in mm with the Canadian holiday (unit tested; an ACIS copy of Toronto 1957 to 2017 behaves as expected, suppressing claims with under 30 years). The authoritative source is ECCC (MSC GeoMet climate-daily, normals and threaded long-term extremes). Its hosts aren't reachable from the build environment, and the ACIS copies end in 2017 to 2025. See the Toronto plan above. |

## Phases

1. **This slice.** The engine (daily records for highs, lows, warm lows, cold highs, precipitation and snowfall; holiday rankings and frequency; last comparable day; month to date versus normal and its rank), holiday rules, the pack builder, the Overview strip, the Almanac section with Copy fact, and tests.
2. **Streaks** (wet, dry, heat, cold, freeze, snow-free), first and last seasonal occurrences, annual threshold counts, time since a comparable event, and season- and year-to-date rankings over equivalent windows. Rolling totals.
3. **Temperature swings,** normals milestones, and daylight milestones from the Almanac's NOAA sun calculations (labelled computed, not observed).
4. **Forecast record potential from the Forecaster Blend.** For example, the blend high is within 2°F of the daily record, with the guidance range (10th to 90th percentile) shown. No odds, and never written into observed records.
5. **Non-U.S. markets:** the ECCC adapter, Canadian provinces' holiday tables, and quality flags.

## Known follow-ups found in the audit

- `assets/climate-station.js` takes a threaded record's first year from the temperature element. For CVGthr that gives 1872, but precipitation starts in 1871. It should read the period of record per element.
- `assets/record-watch.js` hard-codes 1871 when counting missing years, and `RECORD_WATCH.md` still describes a CVG-only limit that the code no longer applies.
- `assets/climate-report.js` defaults the station to CVG.
- The threaded record's start year differs by source: the NWS daily climate report says the record starts in 1869, but ACIS precipitation starts in 1871. Copy uses the ACIS period.
