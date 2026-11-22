# Day 1 tornado corridor experiment (locked 2026-11-22, before any fitting)
Approved in PR #31. The full rules are in `research/severe/corridor/rules.json`. Research only: the
live v0.7 map and the RRFS/NBM collector are unchanged.

**Question:** do 50- and 100-mile neighbourhood HRRR features, plus recalibration, fill in the
corridors v0.7 leaves patchy?

**Arms** (all on the same 96 development dates from 2022-23, regional box):
- **(a)** the v0.7 recipe refit, with Platt calibration.
- **(b)** (a) with isotonic recalibration only.
- **(c)** (a)'s inputs plus 20 wider features, with isotonic recalibration.

**Wider features:**
- Fields: the 24-hour point maxima already saved for UH25, 0-1 km SRH, 0-6 km shear, SBCAPE and
  reflectivity.
- Statistics: mean and max over every saved CONUS-grid sample within 50 and 100 miles.
- Edges: no padding or zero fill. Neighbourhoods that reach outside the box use the real grid samples
  there; where the grid ends, only existing samples count.
  - 99.5% of box points have at least 80% of a full 50-mile disk.
  - 98.5% have at least 80% of a full 100-mile disk.
  - The worst case is a coastal corner with about half a disk.
- Transform: asinh for UH, SRH and CAPE; standardised within training folds.

**Nesting:**
- Six month-grouped outer folds; whole months are held out from fitting, tuning and calibration.
- Inside the training months, the penalty and the calibration use inner month folds.
- A proposed live threshold is chosen inside the training folds only.

**Pass criteria (c vs b, held-out months, paired date bootstrap):**
1. At least 10% more hits at matched false-alarm area, with a lower bound above 0.
2. At least 25% fewer report points left out of a correctly placed corridor, with a lower bound
   above 0.
3. A clear Brier improvement (interval below 0).
4. Wrong-place and no-signal misses up by no more than 5%.
5. Reliability within ±30% of the observed rate in every bin above 2% that has at least 20 report
   points.

**Outcome rules:**
- 2024 is diagnostic only.
- If the candidate passes, it is frozen and verified once on the sealed 2021 list.
- If it fails, 2021 stays sealed.

## Result: FAIL (gate run 45056423427). 2021 stays sealed.
**Held-out development sample:** 96 dates, 31 report days, 2,796 report points in the box.
- Every outer fold chose penalty 0.001 for both feature sets.
- Neighbourhood coverage matched the pre-fit measurement: 0.5% (50 mi) and 1.5% (100 mi) of points
  have less than 80% of a full disk.

| Criterion (c vs b) | Needed | Result | Shortfall |
|---|---|---|---|
| 1. Hits at matched false-alarm area | ≥ 1.10×, lower bound > 0 | **0.93×** (843 vs 907); c−b [−342, +210] | −17 points from the target ratio |
| 2. Left-out reduction | ≥ 25%, lower bound > 0 | **23.8%** (494 vs 648); b−c [−39, +374] | 1.2 points short; interval includes 0 |
| 3. Brier | interval < 0 | **+0.00024** (0.00210 vs 0.00186); [−0.00001, +0.00072] | worse |
| 4. Wrong place / no signal | ≤ 1.05× | **1.08× / 1.33×** (840 vs 776; 619 vs 465) | both above the limit |
| 5. Reliability above 2% | within ±30% | 2-5%, 5-10%, 10-15% and 15-30% pass; **≥30% fails** (mean forecast 89% vs observed 20%, 135 report points) | top bin |

**Other held-out results:**
- Arm (a): Brier 0.001862, AUC 0.948.
- Arm (b): Brier 0.001863, AUC 0.943.
- Arm (c): Brier 0.002101, AUC 0.953. Its ranking is the best of the three, but the isotonic
  calibration fitted on so few events produces a top step near 90%.
- Proposed live thresholds for (c), chosen in training folds:
  - calibrated 5%: 944 hits, 20,900 km²/day;
  - training-fold matched-area threshold (4.3-5.5%): 823 hits, 16,600 km²/day.
- Neither proposal is adopted because (c) failed.

**Maps (rule-selected):**
- 2022-03-22, the most-reports day: left-out 99 → 40 and hits 318 → 377.
- 2023-06-15, the day with the most left-out points under (b): (c) smeared probability along a long
  front; hits 140 → 81 and left-out 123 → 160.

## 2024 diagnostic (never deciding; 323 benchmark days; NadoCast's 5% false-alarm area)
| | Brier | Hits | Left out | Wrong place | No signal |
|---|---|---|---|---|---|
| Arm b | 0.003654 | 8,851 | 4,684 | 3,941 | 1,294 |
| Arm c | 0.003512 | **10,283** | **3,303** | **3,387** | 1,797 |
| NadoCast | 0.003403 | 11,456 | 2,597 | 2,376 | 2,341 |

On 2024, (c) gains 16% in hits, cuts left-out reports by 29% and cuts wrong-place misses by 14%. That
closes about 55% of the hit gap to NadoCast. On 2024-12-28, hits rise from 505 to 655 and wrong-place
misses fall from 175 to 78. These days were already inspected, so this cannot decide anything.

## Reading
- The corridor idea shows up where there is enough tornado data: 139 report days in 2024, and the
  biggest development outbreak.
- The 2022-23 development set has only 31 report days. That makes the gate underpowered (wide
  intervals).
- Isotonic calibration on that set overfits the top tail, which is what fails Brier and reliability.
- Under the locked rules this is a fail. Nothing is frozen, and 2021 stays sealed.
