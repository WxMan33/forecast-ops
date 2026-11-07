# Live severe guidance: Day 1 and Day 2

The product goal is current model-based tornado, wind and hail probability contours within 25 miles, with Day 1 and Day 2 selectors. Historical analog matching is deferred. The archive viewer is a development replay, not the completed replacement.

## Status of this build

- Implemented: filled probability contours, original sample dots, combined display, consistent color legend, light/dark basemaps, opacity, original-sample readouts and missing-data handling.
- Implemented: an explicit daily input contract, current NOAA HRRR index availability probe and rejection of incompatible four-hour/other-lead model artifacts.
- Verified: all 49 required hourly input indices from the November 6, 2026 12 UTC cycle contain the selected Day 1/2 fields. The exact index records, retrieval times and hashes are in `evidence/severe-daily-inputs-20261106.json`.
- Implemented in the next backend checkpoint: complete daily predictor extraction with native-grid neighborhood summaries, byte-range receipts, time/parameter/grid checks and immutable predictor artifacts. See the extraction section below.
- Not implemented: daily training/calibration, independent daily verification, daily inference or a current probability feed. Extracted predictors alone are not a forecast.

The current research model was fit only for f06–f10 of a 12 UTC cycle and a four-hour outcome. Its inference code rejects other leads. It cannot be applied to f24–f48 or treated as a daily forecast by renaming a file. A four-hour maximum, sum or independent-event product is not a calibrated 24-hour probability.

## Original engineering extraction (v1)

Start with the 12 UTC extended HRRR cycle and two separately trained/calibrated 24-hour targets:

| Product | Lead interval | Valid window | Instantaneous fields | Hourly UH maxima |
| --- | --- | --- | --- | --- |
| Day 1 | [0, 24) hours | Initialization to +24 h | f00–f23 | f01–f24 |
| Day 2 | [24, 48) hours | +24 h to +48 h | f24–f47 | f25–f48 |

All dates/times must be explicit. Labels are convective-day windows anchored at 12 UTC, not local midnight days. Later intraday cycles need their own lead-aware training and remaining-window coverage; partial windows must never be labeled complete Day 1 or Day 2.

The original engineering schema is `hrrr-daily-25mi-v1`; its zero-lead Day 1 window is not eligible for prospective daily forecast scoring. The future-window collection below uses a new schema and earlier cycle. Separate artifact manifests must identify the model family, cycle, forecast leads, 24-hour target, 40.2336 km radius, features, fitted hazards, calibration split and artifact hashes. Missing fields, partial windows, changed model versions or stale cycles produce unavailable guidance.

## Inputs and training work

The first adapter selects native HRRR surface CAPE/CIN, 0–1 km SRH, 2–5 km hourly maximum UH, composite reflectivity, 2 m dew point and the two 0–6 km shear components. These are the existing research selectors; availability does not establish predictor equivalence across a future model transition.

The daily build must extract fields over the complete target window with native-grid neighborhood summaries, then fit the daily report occurrence target directly. It needs a frozen, representative development cohort with storm and non-storm days, seasonal and geographic coverage, more tornado events and strict separation of training, calibration and evaluation episodes. Existing monthly dates are engineering checks, not sufficient operational validation. Keep the currently untouched 2025 evaluation protected until a final protocol is frozen.

Check calibration/reliability, Brier score, event-day support, false alarms and missed events, with uncertainty resampled by weather episode. Compare on matched windows and points with climatology and other appropriate baselines. The present four-hour scores do not validate daily forecasts.

Only after artifacts and complete current predictors exist should the publisher expose live probability JSON. Publish atomically with initialization, retrieval and valid times, model/schema version, completeness and hashes. Retain dated forecasts prospectively for verification. Never replace a failed live fetch with an archive map under a current date.

## Day 3

Extended HRRR reaches 48 hours, so it cannot provide a complete third 24-hour window. NOAA’s November 5, 2026 RRFS announcement documents an 84-hour range, making RRFS a candidate for a complete Day 3 window. It needs a separate RRFS/REFS adapter, verified cycle/field coverage and training/calibration for that lead and model version. The existing HRRR pipeline does not gain Day 3 support from this announcement. No HRRR extrapolation or recycled Day 2 forecast is allowed.

## Nadocast reference

[Nadocast's published implementation](https://github.com/brianhempel/nadocast) describes HREF/SREF features, neighborhood and temporal summaries, gradient-boosted trees and lead-specific training. Older versions also incorporated HRRR/RAP. That methodology is useful reference material; this implementation does not inherit Nadocast's trained skill or significance-hazard models.

[NOAA HRRR documentation](https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php) documents 48-hour forecasts from the extended cycles. The current input probe checks actual index availability rather than relying solely on that description.

## Run the input probe

`python tools/severe/daily.py --output tests/out/severe-daily-inputs.json`

An explicit initialization date can be passed with `--date YYYY-MM-DD`. The tool requests bounded index text only (four concurrent requests), records exact field ranges and creates no probabilities. `python tests/severe-daily.test.py` checks window alignment, UH endpoints, model compatibility and unsupported horizons.

## Complete daily predictor extraction

Install `tools/severe/requirements.txt`, then run:

```bash
python tools/severe/extract.py --date 2026-11-06 --output tests/out/severe-daily/20261106 --cache tests/out/severe-daily-cache/20261106 --max-download-mb 2000
```

The extractor downloads only the selected GRIB messages, enforces an overall byte budget and rejects servers that ignore exact byte ranges. Verified cache entries must match their URL, byte range and SHA-256; an unverified or corrupt entry fails closed. Use a separate cache directory for each initialization. The output directory must be new.

All requested windows must contain exactly 24 valid hours before a completed artifact is written. The extractor checks initialization, step units and instantaneous/UH interval semantics, native Lambert grid definition, parameter identities and unit strings across every hour. Nonfinite or missing predictors fail the build. Neighborhoods use a 40.2336 km disk at nominal 3 km native-grid spacing without missing-value or edge padding. No unit scaling is guessed. These engineering checks do not resolve all model-version and producer-unit interpretation questions before scientific evaluation.

The two predictor artifacts each contain 16,413 sampled locations across the initial eastern/central-U.S. domain (100–75°W, 30–45°N), not the full CONUS. There are 34 columns: temporal maximum and mean of eight native fields and their neighborhood maxima, plus the vector-magnitude shear maximum and mean. Means use float64 accumulation and final predictors use native float32 precision. The artifacts preserve the actual coordinates, feature names and independent Day 1/Day 2 time windows.

The manifest records valid windows, grid geometry/hash, parameter identities, source field hashes and download times, hourly sampled-feature hashes and completed-file hashes. Each artifact is marked `predictors_only_not_a_forecast`. No labels, models or probabilities are fabricated. The 2025 final outcomes remain untouched.

`python tests/severe-extraction.test.py` checks the daily statistics, window completeness, cross-day separation, missing/changed data rejection, native-disk calculations and GRIB time semantics. The `Severe daily predictor extraction` workflow runs these checks on relevant changes. A manual run can additionally extract both full windows and retain the completed artifacts; extraction is off by default.

The next training build must extract matching historical daily predictors, create full-window report labels and fit/calibrate separate daily models. Existing four-hour predictions and scores are not inputs or evidence of daily model skill.

An independent raw-data audit is available with `tools/severe/audit_extraction.py`. It verifies every retained source hash and time record, then recalculates full-day point and neighborhood CAPE/UH means and maxima at five distributed grid centers plus daily CAPE/UH maxima. The audit uses direct native-grid disk slices independently of the extractor's sampling routine. It also compares the preserved coordinates and complete 34-column matrix dimensions. A manual workflow runs this audit before retaining the predictor artifact.

A timing restriction remains before forecast training: the 12 UTC engineering window begins at initialization, while the complete model run becomes available later. Its first elapsed hours must not be counted as future forecast skill. An operational full-day Day 1 product needs an earlier available cycle, or a separately trained remaining-window target with the actual availability/issuance cutoff. The current extraction is an input-engineering replay and must not be promoted unchanged as a prospective full-day forecast.

### November 6 extraction checkpoint

The 12 UTC engineering run completed both windows, each with 16,413 centers and 34 predictors. It downloaded 471,745,406 bytes in bounded field/index requests and decoded 384 native GRIB messages. There are 48 complete hourly feature records. An independent audit verified all source hashes and time records and recalculated selected daily CAPE/UH statistics from raw fields; it passed. The sampled coordinate order also matches the archive viewer at six decimal places. The compact result is in `evidence/severe-daily-extraction-20261106.json`. This proves successful predictor extraction, not forecast skill or a completed daily model.

## Daily reported-event label build

`tools/severe/labels.py` now creates labels for the fixed 72 engineering windows (the 15th and 16th 12–12 UTC windows of each month, 2022–2024). Training, calibration and development years remain separate. No 2025 outcome file is fetched. These labels are not a trained daily forecast and are not yet paired with historical full-day predictors.

Labels use NCEI Storm Data: any tornado, thunderstorm wind of at least 50 kt and hail of at least one inch. Local-standard timezone offsets are converted explicitly; daylight saving time is not added. Wind/hail point records use the report start time. Tornadoes use great-circle segments between reported endpoints, clipped by event time to the daily window. Endpoint paths are proxies for surveyed tracks. Duplicates with matching IDs are removed; conflicting duplicates fail the build.

Codes are 0 for no qualifying report in the checked source, 1 for a qualifying report and 255 for unresolved magnitude/location/path metadata. Unknown records are excluded from fitting and scoring rather than turned into negatives. Report absence remains an imperfect proxy for no severe event. Unlocated eligible events conservatively mask the affected hazard/window; a known qualifying positive still takes precedence.

All annual input files, revision filenames, hashes and retrieval receipts are preserved. Eleven unit tests cover daily boundaries, thresholds, local-standard time, missing data, duplicates, time-clipped tracks and protected years. The separate `audit_labels.py` independently parses raw CSVs and uses unit-sphere nearest neighbors to check all wind/hail labels.

See [model and SPC source roles](severe-model-inputs.md) for how forecasts, reports, outlooks and contour rendering are kept distinct.

## Future-window historical collection (v0.5)

The next collection uses `hrrr-daily-25mi-v2-future-window` and the frozen protocol `day1-06z-f06-30__day2-12z-f24-48-v1`:

| Target | Model initialization | Input leads | Target window | Assumed issuance |
| --- | --- | --- | --- | --- |
| Day 1 | 06 UTC on case date | f06–f30 | Case-date 12 UTC to next-date 12 UTC | Case-date 09 UTC |
| Day 2 | 12 UTC on case date | f24–f48 | Next-date 12 UTC to following-date 12 UTC | Case-date 15 UTC |

Instantaneous fields use the first 24 hours of each lead interval; hourly UH maxima use the following forecast-hour endpoints. This removes f00 analysis hours from the Day 1 target. The three-hour release lag is an explicit replay assumption. Historical product availability has not been reconstructed, so this must not be described as verified as-issued operational performance. Retrieved-at times describe the present archive download, not original release times.

`research/severe/cohort-v05.json` freezes the 36 calendar cases and source labels. The tracked label dataset retains the verified v0.4 bytes and full-precision sample grid. The 2025 outcome protection remains in force. This is a limited regional engineering cohort, not a representative or final skill test.

```bash
python tools/severe/history.py --case 2022-01-15 --output tests/out/severe-history-v05 --cache tests/out/severe-history-cache-v05
```

Each case extracts both future windows, independently audits CAPE/UH summaries and all source hashes, verifies exact grid/column/field identity across days, and joins the report labels by date, day and exact valid window. The joined file contains original float32 features and 0/1/255 labels. Unknown labels remain excluded candidates, not invented negatives. An existing completed predictor window can be reused only with matching protocol, file hashes and a successful matching audit. No daily model is fitted by the collection.

The historical cohort workflow runs three cases at a time and preserves audited case artifacts for 30 days. Failed cases do not stop other cases. Its final summary lists complete, missing and invalid cases and fails if the requested collection is incomplete. Cache deletion is scoped to the completed case and occurs only after the joined artifact is written. The first collection is triggered when the frozen cohort configuration is published; individual frozen cases or the full set can be rerun manually.

`python tests/severe-history.test.py` checks future-window timing, 06 UTC metadata, release-assumption honesty, protected cases, day order and label/grid matching. The original engineering extractor remains available to reproduce the earlier checkpoint; it does not silently gain the new schema or daily forecast eligibility.

The initial `2022-01-15` case completed both new windows, passed both raw audits (384 source messages in total) and joined to the saved labels with exact grid equality. Its joined matrix has shape 2 × 16,413 × 34 and its label matrix 2 × 16,413 × 3. The result is recorded in `evidence/severe-history-v05-pilot.json`. This verifies the pipeline on one case; the rest of the fixed cohort still requires collection and audit.

The first hosted attempt exposed a label-grid equality failure absent from the local pilot. Collection revision 2 checks the grid immediately after decoding the first field and accepts only component-wise differences at most 1e-9 degree (about 0.1 mm), while requiring the original row order, shape and finite coordinates. Actual maximum differences are logged and retained. Raw coordinates and labels are preserved; there is no snapping, reordering or resampling. Larger shifts fail before the remaining downloads. Pushes of a corrected cohort revision cancel an obsolete collection run.
