# Model status and Brad's selected blend

Checked November 3, 2026, before the noon Eastern collection window.

## Default recipe v2

The latest ten-source screenshot is now the code default, `brad-default-2026-11-03-v2`, and is archived separately for verification. No temperature multiplier applies.

| Source | Weight |
| --- | ---: |
| NWS point forecast | 3.00 |
| ECMWF ENS | 4.00 |
| GEFS | 0.75 |
| RRFS ensemble (5 members) | 1.25 |
| ECMWF IFS | 1.25 |
| ECMWF AIFS | 1.00 |
| GFS | 0.75 |
| NBM | 2.00 |
| HRRR | 1.50 |
| RRFS 3 km | 1.50 |

The default preset and Reset weights use this selection. Existing custom choices are preserved. The earlier eight-source screenshot (`brad-custom-2026-11-03-v1`), Baseline v1 and all historical evidence remain unchanged; future scheduled captures score the new default alongside those recipes.

## NAM removal and RRFS registration

NWS SCN 26-47 schedules retirement of NAM (including its nests), SREF, HREF, HiresW and NAM MOS for November 3 at 12 UTC, subject to the notice's weather-related deferral conditions. NAM has been removed from active site model configurations and future collector requests. Historical raw evidence and frozen recipes referencing NAM are retained.

HRRR remains operational. RRFS and REFS are the replacement direction for the retired systems; HRRR is not being removed by this change.

RRFS deterministic (`ncep_rrfs_conus`) and the five-member RRFS ensemble (`ncep_rrfs_conus_ensemble`, internal source `rrfs_ens`) are now registered in the shared loader configuration and collector. The five perturbed RRFS members are **not** the full time-lagged REFS product, which also includes other members/cycles. Do not label the five-member feed as full REFS.

## Native CVG fallback

A bounded NOAA point-feed worker now extracts the nearest native 3 km CONUS cell to CVG (about 0.83 km from the airport). It reads GRIB2 byte ranges for 2 m temperature, hourly precipitation and snow-water information from deterministic RRFS and all five perturbed members. It does not move the station or substitute 13 km RRFS, GFS or a seamless product.

The loader prefers this feed within 3 km of the CVG point. Outside that pilot area it uses the location's own provider grid, with explicit nearest-cell selection and elevation adjustment disabled for RRFS. The native feed has no elevation correction. The UI identifies NOAA native-grid use and its limited variable set. Upper-air, wind and thunder diagnostics are unavailable from this feed rather than invented.

The worker selects the newest cycle within its availability delay for which every requested deterministic hour (through f084) and every member hour (through f060) has an index. If the newest cycle is incomplete it checks the preceding six-hour cycle. It validates actual decoded temperature and precipitation values and refuses to replace a successful feed with gaps in those required fields. Invalid frozen fractions make derived snow unknown for the affected hours; they do not erase valid temperature or precipitation. Complete-window snow scoring excludes those member windows. Gaps in the 12Z November 3 listing were detected by this check; the earlier 06Z listing covered all required hours.

Each output records its actual initialization, generation time, native grid coordinates/distance and method version. A companion manifest records NOAA file keys, byte ranges and SHA-256 hashes of input messages. The browser rejects cycles older than 16 hours or feed generations older than eight hours. Analysis-time accumulation is unknown, never zero. Only exact preceding-hour APCP/TSNOWP intervals are used. Snow uses the site's fixed 7:1 display convention; member snow water is estimated from APCP times a valid reported frozen fraction (0–100%). Negative or missing fractions during wet hours stay unknown. This is not modeled ground accumulation or full REFS.

Refresh workflow: `.github/workflows/rrfs-point.yml`, every two hours. It skips re-downloading a cycle already published. Only a feed with complete required temperature and precipitation fields is committed; unknown derived snow hours are listed explicitly. The browser reads the public raw-repository JSON so a data-bot commit does not depend on another Pages deployment. Private verification archives the retrieved native feed and records its confirmed NOAA initialization separately from Open-Meteo metadata timestamps.

The Open-Meteo default 3 km and ensemble requests returned all-null CVG series during diagnosis. The 13 km request and a nearest-cell request without elevation correction returned values, but provider acceptance alone is not considered a successful data load.

## References

- NWS notices: https://www.weather.gov/notification/ (SCN 26-47 and 26-48)
- NOAA RRFS overview: https://gsl.noaa.gov/rrfs/
- Open-Meteo RRFS implementation and product distinctions: https://github.com/open-meteo/open-meteo/blob/main/docs/ncep-rrfs/README.md

Provider model identifiers being accepted is not evidence of current data availability. Check actual non-null values, valid-time coverage and update provenance before enabling a new source in an operational recipe.
