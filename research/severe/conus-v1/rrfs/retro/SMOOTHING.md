# Retrospective RRFS pilot: spatial smoothing of HRRR + 12Z RRFS (fixed before scoring)

Committed 2026-11-28 with owner approval, after the [May diagnosis](nadocast/may-diagnosis/may-diagnosis.json). In that diagnosis, 62% of the report points NadoCast caught and the blend missed had at least half the blend's threshold probability, and the maps showed fragmented risk areas. This is one exploratory test, and it stops after the scorecard. May 2024 has already been inspected, so its results are exploratory.

## Smoothing (`hrrr_rrfs_smooth`)
- **What is smoothed:** the pinned held-out HRRR + 12Z RRFS probabilities, unchanged and fingerprint-gated against [`repro/scorecard-pinned-1.json`](repro/scorecard-pinned-1.json).
- **Method:** each date is smoothed separately with a distance-based neighborhood mean. Each sample's value becomes the unweighted mean over all supported CONUS samples (including itself) within radius r, measured by great-circle distance.
- **Coastal and edge handling:** only supported samples that have a prediction on that date are averaged. These are land-supported samples, within 25 miles of US land, with known labels. The mean is renormalized by the number of such neighbors. Ocean, Canada, Mexico and unsupported cells are never counted as zero, so coastal values are not diluted. A constant field stays constant.
- **Candidate radii:** 0, 25, 50, 75 and 100 km. At the 15 km sample spacing, these cover 1, 9, 37, 81 and 137 samples (interior medians). 0 means no smoothing.
- **Radius selection (training blocks only, in each outer fold):**
  - for each training block, `hrrr_rrfs` is refit on the other training block and predicts it;
  - each radius is applied to those out-of-fold predictions;
  - the radius with the lowest out-of-fold Brier is chosen, with ties going to the smaller radius;
  - the held-out block is never used. The chosen radius and the out-of-fold Brier for every radius are recorded for each fold.
- **Applying it:** the chosen radius is applied to the outer model's held-out predictions.

## Thresholds (training data only)
- **Unchanged rule:** HRRR uses 5%. Every other arm matches the HRRR arm's training false-alarm fraction on its own training predictions.
- **For the smoothed arm:** those training predictions are the outer model's in-sample training predictions, smoothed with the chosen radius.

## Comparisons (identical held-out dates and rows)
1. **Pilot scorecard,** all 92 dates (July 2023, Jan–Feb 2024, May 2024): `hrrr`, `hrrr_rrfs` and `hrrr_rrfs_smooth`.
   - Brier with paired whole-date intervals;
   - hits and false-alarm area at training-set thresholds;
   - calibration;
   - national and Florida/Gulf, pooled and by block.
2. **NadoCast comparison,** on the committed 46-date roster: the same metrics as [NADOCAST.md](NADOCAST.md), with the smoothed arm added.
   - **Headline:** May 2024 report points recovered at NadoCast's 5% false-alarm area (diagnostic). That means points the smoothed blend catches and the unsmoothed blend missed, and the reverse ("lost"). It includes how many of the points only NadoCast caught are now caught.
   - Paired hit change with whole-date intervals, national and Florida/Gulf.
   - Training-set-threshold hits with false-alarm km²/day, and Brier.

## Maps
Before and after for May 16, May 24 and May 30, the dates the owner named:
- NadoCast;
- the original blend;
- the smoothed blend.

Each panel shows its flagged area at the May equal-area thresholds, plus the reports and counts. The maps show whether smoothing fills gaps, washes out a real signal or spreads risk into quiet areas.

## Reading
- This is exploratory, not a deployable change.
- If training selects 0 km, the smoothed arm is identical to the blend, and that is the result.
- The usual limits apply: dates that are not fresh, a pre-operational RRFS and a fixed logistic recipe.
- 2025 stays sealed. The daily scoring job runs on its existing schedule.
