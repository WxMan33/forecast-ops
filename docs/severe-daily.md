# Live severe guidance: Day 1 and Day 2

The product goal is current model-based tornado, wind and hail probability contours within 25 miles, with Day 1 and Day 2 selectors. Historical analog matching is deferred. The archive viewer is a development replay, not the completed replacement.

## Status of this build

- Implemented: filled probability contours, original sample dots, combined display, consistent color legend, light/dark basemaps, opacity, original-sample readouts and missing-data handling.
- Implemented: an explicit daily input contract, current NOAA HRRR index availability probe and rejection of incompatible four-hour/other-lead model artifacts.
- Verified: all 49 required hourly input indices from the November 6, 2026 12 UTC cycle contain the selected Day 1/2 fields. The exact index records, retrieval times and hashes are in `evidence/severe-daily-inputs-20261106.json`.
- Not implemented: daily feature extraction/training/calibration, independent daily verification, daily inference or a current probability feed. Input availability is not a successful GRIB decode or a forecast.

The current research model was fit only for f06–f10 of a 12 UTC cycle and a four-hour outcome. Its inference code rejects other leads. It cannot be applied to f24–f48 or treated as a daily forecast by renaming a file. A four-hour maximum, sum or independent-event product is not a calibrated 24-hour probability.

## First daily version

Start with the 12 UTC extended HRRR cycle and two separately trained/calibrated 24-hour targets:

| Product | Lead interval | Valid window | Instantaneous fields | Hourly UH maxima |
| --- | --- | --- | --- | --- |
| Day 1 | [0, 24) hours | Initialization to +24 h | f00–f23 | f01–f24 |
| Day 2 | [24, 48) hours | +24 h to +48 h | f24–f47 | f25–f48 |

All dates/times must be explicit. Labels are convective-day windows anchored at 12 UTC, not local midnight days. Later intraday cycles need their own lead-aware training and remaining-window coverage; partial windows must never be labeled complete Day 1 or Day 2.

The initial daily schema is `hrrr-daily-25mi-v1`. Separate artifact manifests must identify the model family, cycle, forecast leads, 24-hour target, 40.2336 km radius, features, fitted hazards, calibration split and artifact hashes. Missing fields, partial windows, changed model versions or stale cycles produce unavailable guidance.

## Inputs and training work

The first adapter selects native HRRR surface CAPE/CIN, 0–1 km SRH, 2–5 km hourly maximum UH, composite reflectivity, 2 m dew point and the two 0–6 km shear components. These are the existing research selectors; availability does not establish predictor equivalence across a future model transition.

The daily build must extract fields over the complete target window with native-grid neighborhood summaries, then fit the daily report occurrence target directly. It needs a frozen, representative development cohort with storm and non-storm days, seasonal and geographic coverage, more tornado events and strict separation of training, calibration and evaluation episodes. Existing monthly dates are engineering checks, not sufficient operational validation. Keep the currently untouched 2025 evaluation protected until a final protocol is frozen.

Check calibration/reliability, Brier score, event-day support, false alarms and missed events, with uncertainty resampled by weather episode. Compare on matched windows and points with climatology and other appropriate baselines. The present four-hour scores do not validate daily forecasts.

Only after artifacts and complete current predictors exist should the publisher expose live probability JSON. Publish atomically with initialization, retrieval and valid times, model/schema version, completeness and hashes. Retain dated forecasts prospectively for verification. Never replace a failed live fetch with an archive map under a current date.

## Day 3

Extended HRRR reaches 48 hours, so it cannot provide a complete third 24-hour window. Day 3 needs a separate longer-range model/ensemble adapter and training/calibration for that lead and model family. No HRRR extrapolation or recycled Day 2 forecast is allowed.

## Nadocast reference

[Nadocast's published implementation](https://github.com/brianhempel/nadocast) describes HREF/SREF features, neighborhood and temporal summaries, gradient-boosted trees and lead-specific training. Older versions also incorporated HRRR/RAP. That methodology is useful reference material; this implementation does not inherit Nadocast's trained skill or significance-hazard models.

[NOAA HRRR documentation](https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php) documents 48-hour forecasts from the extended cycles. The current input probe checks actual index availability rather than relying solely on that description.

## Run the input probe

`python tools/severe/daily.py --output tests/out/severe-daily-inputs.json`

An explicit initialization date can be passed with `--date YYYY-MM-DD`. The tool requests bounded index text only (four concurrent requests), records exact field ranges and creates no probabilities. `python tests/severe-daily.test.py` checks window alignment, UH endpoints, model compatibility and unsupported horizons.
