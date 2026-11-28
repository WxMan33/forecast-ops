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

## 7. Day 2 wind regional calibration test (frozen before fitting or scoring)
**Dates:**
- Verification: the 5th, 12th, 19th and 26th of each month of 2024 (48 dates). Their windows
  (D 12Z to D+2 12Z: the 5th-7th, 12th-14th, 19th-21st and 26th-28th) overlap none of the 2024 windows
  used so far (the 1st, 8th, 15th and 22nd), and no severe file references them.
- The 36 follow-up dates and the 12 dates on the 15th are kept out of fitting.
- 2025 stays sealed.

**Models:** the frozen CONUS logistic and CONUS trees (sha256 a9ff6aa7...) for Day 2 wind, unchanged.
Each is tested against itself, calibrated vs uncalibrated. The v0.7 refit and v0.7 as-is are
reported for context.

**Correction:**
- Per region (original box, West, plains outside box, Florida/Gulf, Northeast outside box), a monotone
  Platt map on the frozen model's logit: p' = expit(c_r + d_r * logit(p)), with d_r >= 0.
- Fit only on **out-of-fold** 2022-23 predictions (the same month-grouped folds the frozen models
  used: 6 folds for the logistic, 3 for the trees, at the frozen penalty and settings), passed through
  the frozen model's own calibration.
- Before any correction is fit, the recomputed out-of-fold predictions must re-derive each frozen
  model's calibration intercept and slope (to 1e-6).
- All supported samples in the region are used (interior and coast/border-exposed). Labels: original.

**Target:** unchanged. A qualifying convective wind report (Storm Events "Thunderstorm Wind",
>= 50 kt) within 25 miles. Qualifying reports stay positive everywhere, including during tropical
events.

**Primary scoring:** original labels. A candidate passes only if all three hold on the 48 dates:
1. **Florida/Gulf mean forecast** (all supported samples) is within a factor of 2 of the observed
   report rate (ratio between 0.5 and 2.0).
2. **Florida/Gulf area >= 5% on no-report days** (days with no qualifying wind report in the region)
   falls by at least half versus the same uncalibrated model (total km^2 over those days).
3. **National Day 2 wind Brier** is no worse than the same uncalibrated model. The point estimate
   must not be higher, and the paired whole-date bootstrap 95% interval of (calibrated - uncalibrated)
   is reported.

**Also reported:**
- Paired whole-date bootstrap intervals for the national and per-region Brier change, the
  Florida/Gulf ratio, and the area reduction.
- **Hits on report days:** on days with a qualifying wind report, the number of event points
  forecast >= 5%, >= 15% and >= 30%, before and after, nationally and per region.
- The v0.7 refit and v0.7 as-is for context.

**Tropical-event sensitivity analysis** (reported separately; not used for pass/fail):
- Mask: the NHC HURDAT2 best-track file, fetched in the run with its SHA-256 recorded. Any
  tropical or subtropical system (status TD, TS, HU, SD or SS) with a 6-hourly fix, linearly
  interpolated to hourly, between the window start minus 6 h and the window end.
- No-report samples within 400 km of such a track position are set to unknown. Qualifying reports
  stay positive.
- The same mask is used for every model. Scores are shown both with and without it, so the share of
  any change due to the mask is visible.

Production stays on v0.7 whatever the outcome.

## 8. Day 2 wind two-stage regional experiment (locked before any fitting)
**Stage 1:** each frozen CONUS candidate (logistic, trees; sha256 a9ff6aa7...), unchanged.

**Stage 2:** a penalized logistic correction on the stage-1 logit z (calibrated logit of the stage-1
probability), with z entering as a fixed offset:

    logit p2 = z + sum_r w_r(s) * (a_r + c_r * z + sum_j b_rj * f_j(s)),   r in {Florida/Gulf, West}

- **Predictors f_j (locked):** x_srh01_max, x_srh01_nearby_max_max, x_shear06_max, x_sbcin_mean,
  the SRH x shear interaction (int_srh_shear), and x_sbcape_nearby_max_max. They use the frozen asinh
  scaling and are standardized on each fit's training rows for the region.
- **Penalty:** L2 on (a_r, c_r, b_rj), chosen from {1e-4, 1e-3, 1e-2, 1e-1} by month-grouped
  cross-validation inside the stage-2 training data.
- **Boundary blend (locked):** w_r(s) = clip(0.5 + d_r(s) / 150 km, 0, 1). Here d_r is the signed
  distance to the region boundary, positive inside. That gives a 150 km linear ramp centered on the
  boundary.
  - Florida/Gulf (lon >= -90, lat < 30) is bounded by lat 30 and lon -90.
  - The West (lon < -104) is bounded by lon -104.
  - Everywhere with w = 0 keeps the stage-1 forecast exactly.

**Development gate: nested, whole months held out from both stages.**
- Outer folds: the 6 month-grouped folds of the 96 development dates (2022-23).
- For each outer fold, the held-out months are unseen by both stages:
  1. Refit stage 1 on the training months with the frozen recipe. For the logistic, the penalty is
     re-selected inside those months. For the trees, the parameters are fixed and calibration uses
     out-of-fold predictions inside those months.
  2. Generate stage-2 training inputs from out-of-fold stage-1 predictions **within the training
     months only**.
  3. Fit stage 2 on them.
  4. Predict the held-out months with both the refit stage 1 alone (the uncorrected counterpart) and
     the complete two-stage model.
- Pooled over the 6 outer folds, every development date is scored once, by models that never saw its
  month. Labels are the original labels. The whole-date bootstrap uses 5,000 resamples.

**Gate (all must hold; per candidate):**
1. **Report points captured at >= 5%:** two-stage / uncorrected >= 0.90, separately in Florida/Gulf,
   the West and nationally. The bootstrap 2.5% lower bound must be >= 0.75 in Florida/Gulf and the
   West, and >= 0.90 nationally.
2. **National report points captured at >= 15%:** ratio >= 0.90.
3. **Florida/Gulf area >= 5% on no-report days:** two-stage / uncorrected <= 0.60, i.e. at least a 40%
   reduction.
4. **National Day 2 wind Brier:** two-stage <= uncorrected (point estimate), with the paired interval
   reported.

**Reported, not gating:**
- the Florida/Gulf forecast / observed ratio;
- the largest step in mean probability across each region boundary;
- boundary maps (stage-2 weight field, before/after examples on held-out development dates);
- uncertainty on every gate quantity.

**If a candidate clears the gate:**
1. Fit its final stage 2 on the full 96-date out-of-fold stage-1 predictions (the same ones that
   re-derive the frozen calibration).
2. Freeze it with a SHA-256.
3. Pin the 2021 Storm Events file and archive it to the private replay-source release.
4. Verify **once** on the 96 dates in `research/severe/conus-v1/twostage-verification-2021.json`
   (the 1st, 5th, 8th, 12th, 15th, 19th, 22nd and 26th of each month of 2021), against the same frozen
   stage 1, with the same four requirements.

**If neither clears it:** no 2021 predictor or outcome is loaded. 2021 is preserved for the next
experiment, and the failing requirement is reported.

2025 stays sealed. The 48- and 36-date 2024 sets remain diagnostic only. v0.7 stays live.

## 9. Downburst predictor experiment (locked before any extraction or fitting)
**Inputs:** the field contract, the 14 meteorological feature definitions and the population definition are in
`research/severe/conus-v1/downburst/field-contract.json`. They were verified on a real HRRR file
(2023-06-15 12Z, f30/f31): units, instantaneous vs hourly-max type, accumulation window, and GRIB
identity.
- Hourly-max fields (MAXUW, MAXVW, MAXDVV, MAXREF) cover (H-1, H].
- Wind speed is taken only from the MAXUW/MAXVW pair of the same hourly message.
- Valid hour [H, H+1) uses instantaneous fields at fH and hourly-max fields at f(H+1), the existing UH
  convention.
- Day 2 only: 12Z f24-f48.
- HGT at the LCL is excluded for missing values; the 2 m dewpoint depression replaces it.
- The extractor rejects any message whose identity, time window or validity differs from the contract.

**Dates:** the 96 development dates only (2022-23). 2021 stays sealed unless a candidate passes the
full gate. 2025 stays sealed.

**Meteorological set (primary), 14 features:**
- wind10_max, wind10_nearby_max
- gust_max, gust_nearby_max
- downdraft_max, downdraft_nearby_max
- dd2m_max, lapse_700_500_max, dd700_mean
- pwat_max
- maxref1km_max, maxref1km_nearby_max
- ltng_max, ltng_nearby_max

Each is transformed asinh(x / s), where s = the median |x| (x != 0) over the stage-2 training rows,
then standardized per region as in criterion 8.

**Population (sensitivity only):** log1p of 2020 Census tract population within 25 miles. It is never
part of the screening decision or the verdict, and can never open 2021 on its own.

**Screening stop rule (per candidate; decided before any stage-2 fit with the new features):**
- Sets, on the regenerated held-out development predictions:
  - **missed** = uncorrected (refit stage 1) hits at >= 5% that the criterion-8 two-stage model
    dropped below 5%;
  - **false alarms** = >= 5% points on no-report days in the same region and the same months.
- Regimes:
  - **West monsoon:** West, July-September.
  - **Florida/Gulf spring:** March-May.
  - **Florida/Gulf summer:** June-August.
- **Continue** only if **both** the West-monsoon misses **and** the Florida/Gulf-summer misses have at
  least one meteorological feature with |AUC(missed vs false alarm) - 0.5| >= 0.15. Otherwise
  **stop** and report.
- Florida/Gulf spring and population AUCs are reported but do not decide.

**Gate (only for candidates that pass screening):**
- The nested design is identical to criterion 8: 6 month-grouped outer folds, whole months held out
  from both stages, stage-2 inputs from out-of-fold stage-1 predictions inside the training months.
- The stage-2 structure, regions and 150 km blend are unchanged. The predictors are the 14
  meteorological features.
- **Pass requirements are unchanged from criterion 8:**
  - hits >= 5% retained >= 0.90 in Florida/Gulf, the West and nationally, with bootstrap lower bounds
    >= 0.75 regionally and >= 0.90 nationally;
  - national >= 15% hits retained >= 0.90;
  - Florida/Gulf no-report area >= 5% ratio <= 0.60;
  - national Brier no worse.
- Original labels decide.

**Reported, not deciding:**
- The same three regimes separately: hits retained and false-alarm area.
- What each predictor group helps recover: drop-one-group stage-2 refits on the same stage-1 folds,
  with groups wind, gust, downdraft, dryness (dd2m, dd700), lapse, pwat, reflectivity and lightning.
- The meteorological + population sensitivity gate.

**2021 opens only if a candidate's meteorological gate passes in full.** v0.7 stays live.

### 9a. Amendment: direct hourly max 10 m wind speed (recorded 2026-11-20, before any screening or scoring)
- **Why:** review found that `wind10_max` and `wind10_nearby_max` were built as hypot(MAXUW, MAXVW).
  MAXUW and MAXVW are each an hourly maximum, and their peaks can occur at different moments. Their
  hypot is a **component-max proxy**, not the hourly maximum wind speed.
- **Check:** HRRR wrfsfc does provide a direct field, `WIND:10 m above ground:(H-1)-H hour max fcst`
  (GRIB 0/2/1, heightAboveGround 10, stepType max, m/s; eccodes `max_10si`, "Time-maximum 10 metre
  wind speed"). It was verified on 2022-01-01 and 2023-06-15 12Z f31: single message, no missing
  values, window (H-1, H].
  - Hour by hour (2023-06-15 f31), the proxy is below the direct field at 36% of grid points and up
    to 1.36x above it elsewhere.
  - After the 24-h maximum, both Day 2 features agree within about 1% on that date.
- **Change:**
  - `wind10_max` and `wind10_nearby_max` now come from the direct field. It is extracted separately
    (`extract_downburst.py --wind-only`, workflow `severe-conus-downburst-wind.yml`) on the same grid
    and window convention.
  - All other extracted features are reused unchanged.
  - The proxy values already extracted are relabelled `wind10_component_proxy_*` and are **reported
    only, never deciding**.
  - Gust stays a separate group.
- **Also reported, not deciding:** whether screening would pass with the wind group excluded.
- **Unchanged:** the 14-feature count, transforms, screening margin and deciding regimes, the gate
  design and every pass requirement, the 2021 rule, and the 2025 seal.
