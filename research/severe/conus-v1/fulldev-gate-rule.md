# Larger training set: development gate (committed 2026-11-24, before the extraction ran)

Candidate: the frozen `conus_gbt` recipe (same predictors, scaling, tree settings and monotone
recalibration), Day 2 wind, trained on all ~728 extracted 2022-23 development dates instead of 96.

Test (development data only; 2021, 2024 and 2025 are not loaded):
- 6 month-grouped outer folds over all 2022-23 dates (`phase2_study.fold_of`).
- For each held-out fold, fit (a) the recipe on all other dates and (b) the recipe on only the
  original 96-date cohort dates among them. Score both on every held-out date.
- BSS against the 2022-23 development climatology; whole-date bootstrap (2,000 draws) of the
  paired Brier difference.

Pass (all must hold):
1. National Brier of (a) lower than (b), 95% interval excluding zero.
2. No region (original box, West, Plains outside box, Florida/Gulf/South, Northeast outside box)
   significantly worse for (a): no 95% interval entirely above zero.
3. Calibration: the mean forecast on held-out dates is within 15% of the observed frequency nationally.

If it passes, the candidate is frozen and a one-time 2021 verification is proposed (separate
approval, under the existing protocol). If it fails, nothing is frozen and 2021 stays sealed.
v0.7 stays live either way; 2025 stays sealed.
