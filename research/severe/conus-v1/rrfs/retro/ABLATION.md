# Retrospective RRFS pilot, test 1: RRFS field-group ablation (fixed before scoring)

Committed 2026-11-27, before any ablation arm was fitted. This is exploratory development under the [pilot plan](../RETROSPECTIVE-PILOT.md).
The run stops after this scorecard. Regional recalibration and a two-cycle blend are out of scope.

## Question
Which RRFS 12Z field groups carry the gain of HRRR + RRFS over HRRR found in the [first scorecard](first/scorecard.md)?

## Field groups
Every one of the nine collector fields is in exactly one group:

| Group | Fields |
|---|---|
| `gust` | `gust` (surface gust), `wind10max` (hourly max 10 m wind) |
| `refl` | `refc` (composite reflectivity) |
| `updraft` | `uh25` (2–5 km updraft helicity), `uh03` (0–3 km updraft helicity), `maxuvv` (hourly max updraft speed, 100–1000 hPa) |
| `env` | `cape_sfc` (surface CAPE), `srh01` (0–1 km storm-relative helicity), `shear06` (0–6 km u-component bulk shear) |

Max updraft speed is grouped with updraft helicity because both measure storm-scale updraft strength. Max 10 m wind is grouped with gust because both are surface wind.

## Arms
All arms use identical held-out rows. Each field contributes 3 predictors: the 24 h neighborhood max, the first-18 h neighborhood max and the 24 h point mean.

| Arm | Predictors |
|---|---|
| `hrrr` | the HRRR-only control |
| `hrrr_rrfs` | the full HRRR + 12Z RRFS model (27 RRFS predictors) |
| `hrrr_rrfs_no_gust` | full model minus the 6 `gust` predictors |
| `hrrr_rrfs_no_refl` | full model minus the 3 `refl` predictors |
| `hrrr_rrfs_no_updraft` | full model minus the 9 `updraft` predictors |
| `hrrr_rrfs_no_env` | full model minus the 9 `env` predictors |

## Held fixed from RULES.md
- **Data:** the 92-date checksummed cache from run 46035459501 (artifact `rrfs-retro-cache`). Nothing is re-extracted.
- **Recipe:** L2 logistic, C = 0.1; source-specific asinh scaling and standardization fit on the training blocks only; no separate calibration step.
- **Held-out blocks:** July 2023, January–February 2024 and May 2024.
- **Training-only threshold method:** HRRR uses 5%; every other arm uses the threshold that matches, on its own training predictions, the HRRR arm's training false-alarm fraction.
- **Diagnostic:** the equal-area diagnostic and the whole-date bootstrap (2,000 draws, seed 20261127) are unchanged.

The `hrrr` and `hrrr_rrfs` arms repeat the first scorecard exactly. Their numbers must reproduce it, which serves as a consistency check.

## Reporting
- **The cost of each removal**, as `hrrr_rrfs_no_<group> − hrrr_rrfs`:
  - Brier difference with its interval;
  - calibration: forecast/observed ratio and reliability;
  - hits at the training-set threshold (comparable false-alarm area), with false-alarm km²/day;
  - the equal-area hit diagnostic.

  Positive Brier and negative hits mean the group was helping.
- **Scopes:** national and Florida/Gulf, pooled and for each held-out block, to show whether one block drives a result.
- **The full model's gain over HRRR**, `hrrr_rrfs − hrrr`, for reference.

## Reading
- Drop-one ablation measures what each group adds given the others. Correlated groups, such as gust and updraft, can each look small while carrying the gain together.
- This test does not choose a deployable predictor set. Any change to the set would be a separate committed test.
