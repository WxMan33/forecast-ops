# Gust-only NBM test for Day 2 damaging wind (committed 2026-11-25, before fitting)

Motivation: full HRRR + NBM failed only on Florida/Gulf (`nbm/OUTCOME.md`). The closed March–April diagnostic found
the loss came mainly from more confident existing false alarms. Nearby NBM thunder probability had the strongest
association with those increases, but that is a clue, not a cause. This controlled comparison asks whether the gust
guidance alone keeps the national gain without the Florida/Gulf loss.

## Arms (same 726 matched dates, six month-grouped held-out folds)
| Arm | Predictors | Source |
|---|---|---|
| `hrrr` | frozen engineered HRRR predictors | reused: verified totals, NBM gate run 45544910438 |
| `hrrr_gust` | the same plus `nbm_gust10m_nearby_max_max` and `nbm_gust10m_nearby_max_mean` (columns 0–1 of `conus_nbm.FEATURES`, unchanged) | **new fit** (`tools/severe/conus_nbm_gust.py`) |
| `hrrr_nbm` | the same plus all seven NBM predictors | reused: verified totals, run 45544910438 |

Held fixed, identical to the NBM gate:
- dates: the same matched set, with 2022-01-06 and 2023-01-20 excluded;
- folds: `phase2_study.fold_of`;
- training rows: every event row plus a per-date-seeded 20% of no-event rows, weight 5;
- tree settings, the 3 inner month-groups and the monotone recalibration;
- scoring: every row of every held-out date;
- inputs: the same NBM files (run 45544910438) and HRRR artifacts.

Each gust fold must score exactly the same (date, region) rows, with the same point and report counts, as the
verified artifact, or it stops. Uncertainty: whole-date bootstrap, 2,000 draws.

## Pass rule: the original four criteria, applied to `hrrr_gust` vs `hrrr`
1. National Brier lower, with a 95% interval entirely below zero.
2. No region significantly worse: no region's 95% interval entirely above zero. Regions:
   - original box
   - West
   - Plains outside box
   - Florida/Gulf/South
   - Northeast outside box
3. Calibration: national mean forecast within 15% of the observed rate.
4. Hit retention: report points at ≥ 5% are at least 95% of `hrrr`'s count.

Reported, but not part of the verdict:
- national and Florida/Gulf paired Brier differences, gust-only vs HRRR-only and vs full NBM;
- Florida/Gulf calibration;
- hits at 5% and false-alarm area, national and Florida/Gulf;
- the v4.0 / v4.1 split;
- **diagnostic subset:** the March–April Florida/Gulf Brier change at no-report points where HRRR-only and full NBM
  were both ≥ 5% (the 12,040 points of the closed diagnostic). It is compared across the gust and full-NBM arms, and
  also shown with the subset defined by the gust arm. The per-point HRRR and full-NBM forecasts come from the verified
  diagnostic artifacts (fold 2 from run 45654910378, fold 3 from run 45647038211).

## After the test
- **If it passes:** report the scorecard and a plan for prospective testing with current NBM (v5.x). Then stop for
  review before freezing anything or changing any feed.
- **If it fails:** nothing is frozen.
- **Either way:**
  - full HRRR + NBM stays failed;
  - v0.7 stays live and the preview keeps the 96-date model;
  - PR #35 stays draft and 2025 stays sealed.
