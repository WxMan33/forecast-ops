# Retrospective RRFS pilot: Florida/Gulf recalibration test (fixed before scoring)

Committed 2026-11-27 with owner approval, before the adjustment was fitted or scored. This is exploratory development under the [pilot plan](../RETROSPECTIVE-PILOT.md). The run stops after this scorecard.

## Question
Can one Florida/Gulf-only probability adjustment bring the full HRRR + 12Z RRFS forecast closer to the observed frequency there, while keeping report coverage at thresholds set from training data? The full model currently forecasts about 3× the observed frequency in Florida/Gulf.

## Fixed inputs
- **Data:** the 92-date checksummed cache from run 46035459501. All four RRFS field groups are kept, with the full 27-predictor 12Z set.
- **Model:** the recipe, held-out blocks and bootstrap are unchanged from [RULES.md](RULES.md).
- **Numerical environment:** the [pinned environment](REPRODUCIBILITY.md):
  - `OPENBLAS_NUM_THREADS=1` and `OMP_NUM_THREADS=1`;
  - `OPENBLAS_CORETYPE=Haswell`;
  - numpy AVX-512 dispatch disabled.
- **Fingerprint gate:** before anything is evaluated, the unchanged `hrrr` and `hrrr_rrfs` arms must reproduce the pinned fingerprints in [`repro/scorecard-pinned-1.json`](repro/scorecard-pinned-1.json). That means every held-out prediction and every outer-fold coefficient vector. If they do not match, the run stops and nothing about the adjustment is scored.

## Adjustment (`hrrr_rrfs_flcal`)
- **Form:** `logit p′ = a + b · logit p`, with b ≥ 0.001 so the slope is strictly positive. Inputs are clipped to [1e-7, 1 − 1e-7]. It is fit by unweighted log loss (L-BFGS-B), and the record shows whether the lower bound is active.
- **Fit data:** within each outer fold, only the two training blocks are used. For each training block, `hrrr_rrfs` is refit on the other training block and predicts this one. Those out-of-fold predictions, on Florida/Gulf rows only (`florida_gulf_south`), fit a and b.
  - The held-out block is never used.
  - Each inner model is trained on a single block, so these out-of-fold forecasts come from a model that has not seen that season. This is a known limitation of a three-block archive.
- **Where it applies:** the outer `hrrr_rrfs` model is unchanged. The adjustment changes its Florida/Gulf probabilities only; every other region is left as it is.
- **Ranking:** because the slope is positive, the ranking within Florida/Gulf is unchanged. So the Florida/Gulf equal-area diagnostic must be identical to `hrrr_rrfs`, which works as a check.

## Thresholds (training data only)
- **Matched-threshold rule:** unchanged from RULES.md:
  - HRRR uses 5%;
  - every other arm, including `hrrr_rrfs_flcal`, uses the threshold that matches, on its own training predictions, the HRRR arm's training false-alarm fraction;
  - for `hrrr_rrfs_flcal`, the training predictions are the in-sample `hrrr_rrfs` predictions with the same Florida/Gulf adjustment applied.
- **Practical impact:** judged at these training-set thresholds.
- **Also reported:** hits and false-alarm area at a fixed 5%, for every arm.

## Reporting
For Florida/Gulf and national, pooled and for each block:
- forecast/observed ratio and reliability;
- the paired Brier change, with whole-date 95% intervals (2,000 draws):
  - `hrrr_rrfs_flcal − hrrr_rrfs` (the effect of the adjustment);
  - `hrrr_rrfs_flcal − hrrr`;
  - `hrrr_rrfs − hrrr`;
- hits alongside false-alarm km²/day, at the training-set threshold and at 5%;
- the equal-area diagnostic: Florida/Gulf must be unchanged, and national is reported;
- the fitted a and b per fold, with their out-of-fold row and event counts.

## Reading
- This is exploratory, not a deployable calibration.
- Florida/Gulf has 31 report days in total (3 in winter).
- 2025 stays sealed.
- Daily collection continues under its current rules.
