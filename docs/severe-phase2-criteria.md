# Phase 2 judging criteria (written before any Phase 2 score was seen)

Committed while study run 44569153989 was still training, before its scorecard existed.
These rules decide what the 12-date 2024 comparison may claim. 2024 was already used to
choose earlier versions, so every outcome below is **exploratory**; 2025 stays sealed.

Products: Day 1 and Day 2 x tornado, wind (>= 50 kt), hail (>= 1 in) = six products.
Candidates: Phase 2 logistic, Phase 2 boosted trees. Reference: v0.7, same dates/points/windows.

## 1. Overall improvement
A candidate "improves on v0.7" for a product only if its Brier score is lower AND the paired
date-bootstrap 95% interval of (candidate - v0.7) excludes zero. Lower Brier with an interval
that includes zero is "not distinguishable".
A candidate "clearly worse" for a product: the interval lies entirely above zero.

## 2. Higher-probability calibration
Judged on the reliability bins at and above the first practical threshold
(tornado >= 2%, wind/hail >= 5%), pooled across those bins per product:
- Evidence needed: at least 10 event points AND at least 3 distinct event dates with a forecast
  in those bins, for that model. Fewer = **inconclusive** for that product.
- Calibrated: pooled observed rate within a factor of 2 of the pooled mean forecast (ratio 0.5-2.0).
- Over-forecast: ratio < 0.5. Under-forecast: ratio > 2.0.
- A candidate passes this test if, for every product where the test is conclusive for both
  models, it is calibrated, or its ratio is closer to 1 (in log terms) than v0.7's.

## 3. Gains beyond one region
Four land-only quadrants of the regional grid (split at 87.5W and 37.5N).
- A quadrant counts for a product only with at least 3 event dates there; otherwise it is
  inconclusive for that product.
- "Gain extends beyond one region": Brier skill (vs 2022+2023 climatology) is higher than v0.7's
  in at least 2 of the conclusive quadrants, and in a majority of them.
- If fewer than 2 quadrants are conclusive for a product, regional breadth is **inconclusive**.

## 4. Decision
A candidate "deserves a larger test" only if: it improves (rule 1) or is not distinguishable on
at least four of six products, with lower Brier on a majority; is clearly worse on none; passes
rule 2 where conclusive; and passes rule 3 where conclusive. If rules 2 or 3 are inconclusive on
most products, the result is reported as inconclusive and the 12-date comparison stays
exploratory; it does not by itself justify a change to the production model.

## 5. CONUS first national test: do the Day 2 gains hold across regions?
(Added before the CONUS study produced any score; extraction run 44577990940.)

- Reference: the **v0.7 recipe refit on the same CONUS data** (train 2022, calibrate 2023), so
  the comparison isolates the recipe. "v0.7 as-is" (frozen coefficients extended beyond the box)
  is reported alongside but is not the yardstick, because it extrapolates.
- Regions: original box, west, plains outside box, Florida/Gulf south, northeast outside box;
  interior samples only (coast/border-exposed samples are reported separately and do not vote).
- A region counts for a product only with >= 3 verification event dates there; else inconclusive.
- "Day 2 gain holds across regions" for a hazard and candidate: higher BSS than the reference in
  >= 2 conclusive regions AND in a majority of them, AND the all-supported paired date-bootstrap
  Brier difference vs the reference is not entirely above zero.
- Day 1 is judged the same way, separately. With 12 verification dates every result stays
  exploratory; region/hazard pairs with < 5 verification or < 10 training event dates are
  listed as needing more dates before their probabilities can be trusted.

## 6. 36-date CONUS follow-up (frozen before extraction, refit or scoring)
Dates: the 1st, 8th and 22nd of each month of 2024 (36 dates). Day 1 and Day 2 windows run
D 12Z to D+2 12Z, so they cannot overlap the 15th-17th windows used in earlier selection. No
earlier cohort, label set, study or tuning step loaded these dates (checked: cohort-v05,
cohort-v07, labels-v04/v07 and all research/severe, tools/severe and workflow files). 2025 stays sealed.

Frozen models: exactly the four models scored in run 44589486745 (v0.7 as-is, the v0.7 recipe
refit on CONUS, CONUS logistic and CONUS trees). They are refit with that commit's code on the same
96 dates, their 12-date predictions must reproduce the committed ones, and their parameters and
hashes are committed before the follow-up dates are scored. Nothing is re-tuned.

Reference: the v0.7 recipe refit on CONUS. Lead products: **Day 2 wind and Day 2 hail.**

For each candidate and product:
- **Repeats nationally:** lower all-supported Brier than the reference, and the paired whole-date
  bootstrap 95% interval of (candidate - reference) lies entirely below zero.
- **Holds across regions:** criterion 5 on the 36 dates (interior samples; a region enters with
  >= 3 verification event dates; better in >= 2 entered regions and in a majority).
- **Enough data to trust a region** (stricter, reported separately): >= 5 verification and >= 10
  training event dates. A region can enter the comparison yet still be flagged as thin.
- Per region: paired Brier difference with 95% whole-date bootstrap interval, plus event-date
  counts.
- Day 1 and Day 2 tornado are reported by the same rules, as secondary results.

False-alarm size, for Florida/Gulf and the West (and the other regions, for context):
- mean forecast vs observed report rate;
- on no-report days (no qualifying report in that region for that hazard and window), the
  land area (km^2; 225 km^2 per sample) with forecast >= 5%, >= 15% and >= 30%, as a mean per
  no-report day and a total.

If the Florida/Gulf or West errors persist, the next step is a **proposal only**: a
calibration experiment fit on development data, verified on a separate, named set of dates.
Production stays on v0.7 whatever the outcome.
