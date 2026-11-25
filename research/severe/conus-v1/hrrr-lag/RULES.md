# Time-lagged HRRR (06Z + 12Z) test for Day 2 damaging wind: pre-registered rule

Committed 2026-11-25, before full extraction or any fitting. Scope and audit: `SCOPE.md`. Development data only;
2021 is spent and 2025 is sealed. Code: `tools/severe/conus_hrrr_lag.py`.

## Dates
- **Primary comparison:** 725 eligible development dates (`dates.json`).
  - Inputs of **both** cycles must be listed before the 15:10 UTC issuance cutoff on the issue date.
  - The audit excluded three dates from every arm:
    - 2022-01-06 (06Z and 12Z listed late);
    - 2022-01-08 (06Z and 12Z listed late);
    - 2022-08-11 (12Z listed late).
  - Extraction re-checks every needed object of both runs: 12Z f24–f48 and 06Z f30–f48. Any further late-listed or
    failed date is excluded from every arm and reported with its reason.
- **Optional sensitivity check (not part of the verdict; not run unless requested):** the 726-date set that keeps
  2022-08-11.

## Lagged features (first 18 common valid hours only: 12Z D+1 through 05Z D+2)
- **Field values:** for each run and field, take the hourly 25-mile neighborhood maximum (`extract.disk_max_at_samples`,
  the existing rule), then the maximum over the 18 valid hours. The fields are:
  - gust (`GUST:surface`);
  - composite reflectivity (`REFC:entire atmosphere`);
  - 2–5 km updraft helicity (`MXUPHL`, 1 h max over (H, H+1]).
- **Forecast hours used:**
  - 12Z instants: f24–f41;
  - 12Z helicity: f25–f42;
  - 06Z instants: f30–f47;
  - 06Z helicity: f31–f48.
- **The last six hours (06Z–12Z D+2) are outside the 06Z run's coverage.** No lagged value is computed for them; only
  the frozen 12Z predictors cover them.
- **Agreement** = min(06Z 18 h max, 12Z 18 h max): the minimum of the two run-level maxima. The two peaks may occur at
  different hours.
- **Spread** = |06Z 18 h max − 12Z 18 h max|.

## Arms (nested; same matched dates and evaluation for all three)
| Arm | Predictors |
|---|---|
| `hrrr` | the frozen engineered HRRR predictors |
| `hrrr_12z18` | `hrrr` + the three 12Z 18 h maxima (gust, reflectivity, UH) |
| `hrrr_lag` | `hrrr_12z18` + the three 06Z 18 h maxima + three agreement + three spread (12 added in total) |

Held fixed across arms:
- six month-grouped held-out folds (`phase2_study.fold_of`);
- training rows: every event row plus a per-date-seeded 20% of no-event rows, weight 5;
- tree settings (`phase2_study.GBT_PARAMS`), the 3 inner month-groups and the monotone recalibration;
- scoring: every row of every held-out date.

Uncertainty: whole-date bootstrap, 2,000 draws.

## Pass rule (all five must hold)
Against frozen HRRR (`hrrr_lag` vs `hrrr`), the original four:
1. National Brier lower, with a 95% interval entirely below zero.
2. No region significantly worse: no region's 95% interval entirely above zero. Regions:
   - original box
   - West
   - Plains outside box
   - Florida/Gulf/South
   - Northeast outside box
3. National mean forecast within 15% of the observed rate.
4. Report points at ≥ 5% are at least 95% of `hrrr`'s count.

To credit the 06Z run with added value:

5. National Brier of `hrrr_lag` lower than `hrrr_12z18`, with the paired 95% interval entirely below zero.

Reported, but not part of the verdict:
- Florida/Gulf skill, calibration, hits at 5% and false-alarm area, against both baselines;
- all regional differences against both baselines;
- `hrrr_12z18` − `hrrr` (context);
- area ≥ 5% per no-report date;
- the March–April Florida/Gulf no-report subset where `hrrr` and `hrrr_lag` are both ≥ 5% (diagnostic);
- every excluded date and why.

## After the test
- Post the scorecard on PR #31, then stop for review before freezing any model or changing any feed.
- v0.7 stays live and the CONUS preview keeps the 96-date model.
- The prospective archive keeps running unchanged.
- 2025 stays sealed.
