# Retrospective RRFS pilot: first comparison (fixed before scoring)

Committed 2026-11-27, before any RRFS predictor was fitted or scored. This is development under the
[pilot plan](../RETROSPECTIVE-PILOT.md) and does not touch the [locked operational comparison](../TRAINING-VERIFICATION-PLAN.md),
the daily collection, the live feed, the publisher, the registry or the preview. 2025 stays sealed.
Prospective verification dates are not used.

## Roster and inputs
- **Dates:** the 92 12Z Day 2 candidates in [`roster.json`](roster.json):
  - July 2023: 30 dates;
  - January–February 2024: 32 dates;
  - May 2024: 30 dates.

  Issue date D, 12Z cycle, valid 12Z D+1 → 12Z D+2.
- **RRFS** (`tools/severe/conus_rrfs_retro.py`):
  - source: `noaa-rrfs-pds/retro_output_final/{summer,winter,spring}/rrfs.D/12/rrfs.t12z.prslev.fNNN.conus.grib2`, f024–f048, named byte ranges;
  - the nine collector fields, valid-hour pairing, 25-mile neighborhood and CONUS samples are the same as `conus_rrfs.py`.
- **RRFS per-message checks:**
  - init and valid time;
  - step type (instant or 1 h max);
  - GRIB2 parameter identity;
  - a plausible-value range;
  - native grid (Lambert 1799×1059, 3 km);
  - every CONUS sample coincides with exactly one native cell.
- **Units:** pinned by parameter identity, because eccodes labels REFC, MXUPHL and MAXUVV `unknown`. VUCSH is UPP's 0–6 km u-component bulk shear in m/s, although it is labelled s⁻¹.
- **One-date check, 2023-07-15:**
  - 216 messages decoded;
  - valid window 2023-07-16T12Z → 2023-07-17T12Z;
  - 205 MB of byte ranges, 52 s.
- **06Z:** the 06Z cycle (f030–f054) is extracted at the same time and cached, but it is not part of this comparison.
- **Provenance only:** archive timestamps are recorded as provenance. They cannot establish real-time availability.
- **HRRR and labels:** the existing CONUS case for each date is reused (sources listed in `roster.json`). The 8 dates without one are extracted with the unchanged `conus_pilot.py`, using the same pinned 2024 Storm Events file.
  - Target: Day 2 damaging wind, ≥ 50 kt within 25 miles; unknown magnitude is excluded.
  - Rows: the supported CONUS samples (frozen keep mask).
- **Dropped dates:** a date is dropped, with its reason logged, if either source is missing or fails a check, or if the RRFS and HRRR valid windows differ. Every arm uses the same remaining dates and rows.
- **Cache:** `tools/severe/conus_rrfs_pilot.py cache` writes one checksummed `.npz` per date (HRRR raw, RRFS 12Z and 06Z raw, labels, row index) and records SHA-256 in `manifest.json`. Later tests reuse it.

## Arms (identical held-out rows)
| Arm | Predictors |
|---|---|
| `hrrr` | the existing HRRR recipe, `phase2_study.engineer`: asinh(x / training median), plus the three interactions |
| `rrfs` | 27 RRFS predictors: 9 fields × (24 h neighborhood max, first-18 h neighborhood max, 24 h point mean), asinh(x / training median) |
| `hrrr_rrfs` | both sets, each with its own source-specific scales |

## Recipe (fixed, not tuned)
- `StandardScaler`, then `sklearn` `LogisticRegression`: L2, C = 0.1, lbfgs.
- Scales, standardization and coefficients are fit on the training blocks only.
- There is no separate calibration step. The logistic output is the probability.
- The HRRR arm is refit in every fold. The frozen HRRR model is not used, because it saw some of these dates.

## Folds
Each archive block is held out in turn, and the other two blocks are used for training:
- July 2023;
- January–February 2024;
- May 2024.

Every held-out date is scored once. Results are pooled and also reported for each block.

## Metrics
- **Brier and paired differences:**
  - Brier score, plus BSS against the training-block base rate;
  - paired differences `hrrr_rrfs − hrrr` (what RRFS adds), `rrfs − hrrr`, and `hrrr_rrfs − rrfs`;
  - 95% intervals from a whole-date bootstrap (2,000 draws, seed 20261127).
- **Hits at matched false-alarm area, deployable style:**
  - the HRRR arm uses 5%;
  - each other arm uses the threshold that gives, on its own training predictions, the same training false-alarm fraction as the HRRR arm at 5%;
  - reported as held-out hit fraction (report points covered) and false-alarm km²/day, with a bootstrap interval on the hit difference.
- **Hits at equal held-out false-alarm area, diagnostic:** each arm's held-out threshold allows the same number of no-report points as the HRRR arm at 5%. This is labelled diagnostic because the threshold is set on held-out data.
- **Calibration:** reliability by bin (0, 0.5, 1, 2, 5, 10, 15, 30, 100%) and the forecast/observed ratio.
- **Coverage:** dates, report days and event points, nationally and for Florida/Gulf (`florida_gulf_south`), for the pooled result and each block. A thin regional sample is reported with its counts and interval.

## Reading the result
- This is a development screen with no pass/fail gate.
- The headline is `hrrr_rrfs − hrrr`:
  - hits at matched false-alarm area;
  - Brier with its interval;
  - Florida/Gulf;
  - whether one block drives the result.
- If the screen gives a clear lead, one targeted follow-up is committed before it runs, and it reuses the cache.
- 06Z is tested only on its own matched roster, with the 12Z baseline rerun on the same dates.
- The retrospective is short and seasonally uneven, and it is not the current operational RRFS. It cannot establish operational skill.
