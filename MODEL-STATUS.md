# Model status and Brad's selected blend

Checked November 3, 2026, before the noon Eastern collection window.

## Selected recipe

The eight-source screenshot is archived as `brad-custom-2026-11-03-v1` in the verification configurations. It uses the following weights, with **no additional temperature multiplier**:

| Source | Weight |
| --- | ---: |
| NWS point forecast | 2.25 |
| ECMWF ENS | 2.00 |
| GEFS | 0.75 |
| ECMWF IFS | 1.50 |
| ECMWF AIFS | 1.50 |
| GFS | 0.75 |
| NBM | 2.00 |
| HRRR | 2.00 |

Other sources remain outside this recipe. Existing browser custom weights are preserved. Baseline v1 and other frozen historical recipes remain unchanged; the screenshot recipe is scored alongside them.

## NAM removal and RRFS registration

NWS SCN 26-47 schedules retirement of NAM (including its nests), SREF, HREF, HiresW and NAM MOS for November 3 at 12 UTC, subject to the notice's weather-related deferral conditions. NAM has been removed from active site model configurations and future collector requests. Historical raw evidence and frozen recipes referencing NAM are retained.

HRRR remains operational. RRFS and REFS are the replacement direction for the retired systems; HRRR is not being removed by this change.

RRFS deterministic (`ncep_rrfs_conus`) and the five-member RRFS ensemble (`ncep_rrfs_conus_ensemble`, internal source `rrfs_ens`) are now registered in the shared loader configuration and collector. The five perturbed RRFS members are **not** the full time-lagged REFS product, which also includes other members/cycles. Do not label the five-member feed as full REFS.

**Current limitation:** live CVG requests to both RRFS endpoints on November 3 returned HTTP 200 but entirely null temperature, precipitation and snowfall series; both metadata endpoints returned 404. These are unavailable sources, not successful data loads. They are optional and off by default in the selection controls. Missing data never count as zero or contribute to a blend. The collector records the empty response/status for audit. Usable RRFS data and any full REFS integration still require further verification.

## References

- NWS notices: https://www.weather.gov/notification/ (SCN 26-47 and 26-48)
- NOAA RRFS overview: https://gsl.noaa.gov/rrfs/
- Open-Meteo RRFS implementation and product distinctions: https://github.com/open-meteo/open-meteo/blob/main/docs/ncep-rrfs/README.md

Provider model identifiers being accepted is not evidence of current data availability. Check actual non-null values, valid-time coverage and update provenance before enabling a new source in an operational recipe.
