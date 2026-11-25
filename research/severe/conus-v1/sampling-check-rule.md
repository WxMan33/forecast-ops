# Sampling check (committed 2026-11-25, before running)

Question: did the 20% no-event-row sampling (weight 5) used for the 728-date model cost skill? The 2021
verification compared a sampled 728-date model with the original all-rows 96-date model, so sampling and data
size were mixed.

Design (development data only; 2021, 2024 and 2025 not loaded). The same 6 month-grouped outer folds over the
728 2022-23 dates. For each held-out fold, three arms:
- `cohort96_all_rows`: the 96 cohort dates in the training months, every row, weight 1;
- `cohort96_sampled`: the same dates, every event row plus the same fixed 20% of no-event rows (weight 5);
- `all728_sampled`: all training-month dates, sampled the same way (the arm the gate passed).

Held fixed across arms:
- the boosted-tree settings (`phase2_study.GBT_PARAMS`);
- the 3 inner month-groups for the monotone recalibration and the recalibration itself;
- predictors and scaling (frozen);
- scoring: every row of every held-out date, BSS against the development climatology, whole-date bootstrap
  (2,000 draws) of paired Brier differences.

Reading (national Brier, `cohort96_sampled − cohort96_all_rows`):
- **sampling hurts**: the 95% interval is entirely above zero. Next: propose a memory-safe 728-date all-rows fit
  and say whether it keeps the original recipe.
- **little or no effect**: the interval includes zero, or is entirely below zero. Sampling does not explain the
  2021 tie. Next: one pre-registered test of a new input (e.g. time-lagged HRRR guidance).

Also reported:
- the data effect with sampling fixed;
- the exact comparison 2021 made;
- per-region intervals;
- calibration ratios.

Diagnostic only: nothing is frozen from it. v0.7 stays live; the preview keeps the 96-date model.
