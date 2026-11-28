# Retrospective RRFS pilot: tree model vs the logistic blends (fixed before scoring)

Committed 2026-11-28 with owner approval. This is one exploratory test, and it stops after the scorecard. Retrospective results are exploratory, and May 2024 has already been inspected.

## Question
Does a nonlinear model on the same HRRR + 12Z RRFS inputs catch more damaging-wind reports at the same false-alarm area than the logistic blends? The case to watch is under-ranked regional events like the May 16, 2024 northern Plains event.

## Arms (identical held-out dates and rows, same three held-out blocks)
| Arm | Definition |
|---|---|
| `hrrr` | HRRR-only logistic (reference only) |
| `hrrr_rrfs` | the logistic blend (pinned) |
| `hrrr_rrfs_smooth` | the logistic blend with a fixed 100 km neighborhood mean, as in [SMOOTHING.md](SMOOTHING.md) but with no radius re-selection. This is the stronger baseline. |
| `hrrr_rrfs_gbt` | **the tree, unsmoothed and calibrated** |
| `hrrr_rrfs_gbt_raw` | the same tree without the calibration step (diagnostic) |

## Tree recipe (fixed; nothing tuned)
- **Model:** `sklearn` `HistGradientBoostingClassifier` with the project's existing `phase2_study.GBT_PARAMS`:
  - learning rate 0.05;
  - 200 iterations;
  - 15 leaf nodes;
  - at least 2,000 samples per leaf;
  - L2 regularization 1.0;
  - no early stopping;
  - `random_state` 20260119.
- **Inputs:** the same predictors as `hrrr_rrfs`: the HRRR engineered predictors plus the 27 12Z RRFS predictors, with all four field groups. Source scales are fit on the training blocks.
- **Training rows:** every event row, plus a 20% sample of no-event rows seeded by each date, with weight 5. This is the sampling used in the earlier full-development tree experiments.
  - The logistic arms train on all rows, so this test compares the **full tree recipe** with the logistic recipes, not trees alone.
- **Calibration (training blocks only):**
  - for each training block, a tree is fit on the other training block and scores this one;
  - a weighted monotone Platt step (`conus_fulldev.weighted_platt`, slope ≥ 0) is fit on those out-of-fold scores;
  - the final tree is fit on both training blocks, and the calibration is applied to it.
- **Ranking across blocks:** calibration is fit separately in each fold. It preserves ranking within each held-out block, but can change ranking across blocks when they are pooled. So the uncalibrated tree's equal-area result is reported as a diagnostic.

## Thresholds (training data only)
- **Unchanged rule:** HRRR uses 5%. Every other arm matches the HRRR arm's training false-alarm fraction on its own in-sample training predictions.

## Fingerprint gate (before anything is evaluated)
- `hrrr` and `hrrr_rrfs` must reproduce the predictions and coefficients in [`repro/scorecard-pinned-1.json`](repro/scorecard-pinned-1.json).
- `hrrr_rrfs_smooth` must reproduce the predictions in [`smoothing/scorecard.json`](smoothing/scorecard.json). That run chose 100 km in every fold.
- Otherwise the run stops.
- The run uses the pinned numerical environment, and the tree's fingerprints are recorded.

## Metrics
- **Headline: paired equal-area report coverage, tree minus each logistic blend.**
  - nationally and in Florida/Gulf, pooled and per block;
  - whole-date 95% intervals (2,000 draws).
- **Pilot scorecard (all 92 dates):** areas matched to the `hrrr_rrfs` false-alarm area at its training-set threshold.
- **NadoCast comparison (46 matched dates):** areas matched to NadoCast's 5% false-alarm area. NadoCast stays in as the benchmark. Also reported: the tree's report points relative to each blend, and NadoCast-only points the tree now catches.
- **Also reported:** the same for the uncalibrated tree; hits and false-alarm km²/day at training-set thresholds; Brier; calibration; report days.
- **May 16, 2024 case study** (plus May 24 and May 30 for context): NadoCast, logistic blend, smoothed blend and tree side by side, each flagged at the May equal-area thresholds, with counts.

## Reading
- This is exploratory and not a deployable change.
- The tree recipe also differs from the logistic recipes in training-row sampling.
- 2025 stays sealed. Daily collection and scoring stay on their current schedule.
