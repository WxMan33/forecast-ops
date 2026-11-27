# Weather Records & Milestones

Forecast Ops finds the notable weather story for the selected market. **Overview** shows up to three timely highlights. **Almanac** shows each finding with its evidence and a stand-alone "Copy fact" line. One engine (`assets/records-engine.js`) does the calculations for every market.

## How a finding is labelled

| Label | Meaning |
|---|---|
| **Observed record** | The day is in the quality-controlled archive (NCEI GHCN-Daily for U.S. stations). |
| **Preliminary observation** | The value comes from the NWS daily climate report or CF6, carried by ACIS, and isn't final yet. Copy says "(preliminary)". |
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
- **Final or preliminary** is decided by the latest date in GHCN-Daily for the current observing station (`ghcnd` in `feeds/insights/markets.json`).
- **Markets** are configured in `feeds/insights/markets.json`: id, name, country, region, time zone, units, record id and kind, normals station, GHCN-D id and thresholds.
- **Places without a pack:** the Almanac judges daily records only, from the calendar-day history it already loads (ClimateStation's record for the point), and says that holiday rankings and longer context need a pack.

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

- **Observation:** CVG measured 2.16 in. The NWS daily climate report (final for the day, issued 12:55 AM EST Nov 27), the CF6 and ACIS agree. NCEI's final archive runs through Nov 15, so the value is **preliminary**.
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
- **Rebuilding the pack** needs a schedule: daily after the morning daily climate report, and again after the afternoon report. A scheduled workflow is proposed, but not added without the owner's approval.

## Markets checked

| Market | What the engine supports |
|---|---|
| Cincinnati (CVGthr since 1871; CVG since 1947) | Everything above. |
| Denver (DENthr since 1872; DEN since 1994) | Daily records and holiday rankings for temperature and precipitation. Oct 6 2026's 87°F **tied** the threaded record's daily record (1975 and 2020), but only 2020 in the airport record. Snowfall has a gap in 1995 to 2005. Airport-only Thanksgiving snowfall has 21 usable years, so it's suppressed. Dec 2013 precipitation is missing. No ACIS snowfall normals for DEN. |
| Toronto (non-U.S., metric, Canadian Thanksgiving) | The engine runs in mm with the Canadian holiday (unit tested; an ACIS copy of Toronto 1957 to 2017 behaves as expected, suppressing claims with under 30 years). The authoritative source is ECCC (MSC GeoMet climate-daily, normals and threaded long-term extremes). Its hosts aren't reachable from the build environment, and the ACIS copies end in 2017 to 2025. Needs an ECCC adapter, native metric values and ECCC quality flags for final or preliminary. |

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
