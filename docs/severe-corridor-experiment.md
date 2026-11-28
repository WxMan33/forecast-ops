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

# Follow-up (v2), approved 2026-11-22. Roster, folds, extraction plan and rules locked before fitting
Files:
- `research/severe/corridor/v2/roster.json`
- `research/severe/corridor/v2/rules.json`

**Roster:** the original 96 dates plus every March-July day of 2022 and 2023, deduplicated: 362 dates.
- 266 dates are new and need extraction.
- The folds are the same whole-month folds as v1. They hold 70, 16, 70, 68, 70 and 68 dates. The
  16-date fold contains only February and August months.

**What changed from v1:**
- Arms b and c both use **beta calibration**: a logistic fit on ln p and −ln(1−p) with slopes
  constrained to ≥ 0. It is fitted inside each training fold on inner out-of-fold scores, and its
  smooth, monotone shape cannot form a top step.
- Arm a keeps the v0.7 Platt step.

**What is unchanged:** the features, edge handling, arms, nesting, all five pass criteria, 2024 as
diagnostic only, 2021 opened once only on a full pass, and 2025 sealed.

**Added reporting:**
- matched-area results before and after calibration;
- the original-96 subset alongside the full sample;
- event dates behind each reliability bin;
- a gap-filled map and a spread-along-front map, chosen by rule.

## v2 result: FAIL on criteria 4 and 5; passes 1-3 (run 45080256842). 2021 stays sealed; stopped for review
**Held-out sample:** the 362-date roster, with no dates missing: 175 report days and 19,741 report
points.
- Every fold chose penalty 1e-4 for both feature sets.
- The arm-c beta-calibration slopes on ln p are 1.00 to 1.05 in every fold.

| Criterion (c vs b) | Needed | Result | Verdict |
|---|---|---|---|
| 1. Hits at matched false-alarm area | ≥ 1.10×, lower bound > 0 | **1.22×** (9,834 vs 8,070); c−b [+720, +2,973] | pass |
| 2. Left-out reduction | ≥ 25%, lower bound > 0 | **44.4%** (3,826 vs 6,880); b−c [+1,882, +4,496] | pass |
| 3. Brier | interval < 0 | **−0.000120** (0.003323 vs 0.003443); [−0.000185, −0.000064] | pass |
| 4a. Wrong place | ≤ 1.05× | 0.98× (3,665 vs 3,749) | pass |
| **4b. No signal** | ≤ 1.05× | **2.32×** (2,416 vs 1,042 report points) | **FAIL** |
| **5. Reliability, ≥30% bin** | \|forecast − observed\| ≤ 0.30 × observed (8.0 points) | forecast **35.5%** vs observed **26.7%**: 8.9 points, supported by **15 event dates** and 543 report points | **FAIL (by 0.9 points)** |

The other bins pass: 2-5% → 3.2/2.9; 5-10% → 7.0/6.5; 10-15% → 12.1/13.7; 15-30% → 19.9/22.2.

**Event dates per bin (arm c):** 111, 100, 70, 51 and 15 event dates for 2-5%, 5-10%, 10-15%,
15-30% and ≥30%.
- Arm b has 30 event dates in its ≥30% bin, forecast 37.3% vs 20.8% observed.
- Arm a has 35, forecast 43.5% vs 20.0%.
- So arm c's top band is the best calibrated of the three, but it is still outside the tolerance.

**Calibration is not what drives the gain.** At matched area, c/b hits were 1.229 before calibration
and 1.219 after. Left-out reports were 3,837 vs 6,950 before and 3,826 vs 6,880 after. The gain
comes from placement.

**Why no-signal misses rose:**
- At matched area arm c's threshold is 6.4%, against arm b's 5.0%.
- Arm c spends its false-alarm budget on continuous corridors on active days. On marginal days it
  flags less than 2,250 km² anywhere, while arm b flagged scattered spots.
- So arm c reallocates area from marginal days to outbreak days.

**Original 96-date subset (same held-out predictions; not deciding):**
- Hits 1.04× [−273, +338].
- Left-out −27.8% [−153, +653].
- Brier −0.000026 [−0.000070, +0.000007].
- That is the same direction as the full sample but unresolved on 31 report days, consistent with
  v1's underpowered result.

**Proposed live thresholds (arm c; chosen in training folds; not adopted):**
- calibrated 5%: 11,130 hits at 56,700 km²/day;
- training-fold matched-area threshold (6.0-6.5%): 9,890 hits at 42,600 km²/day.

**Maps (by the locked rules):**
- **Fills a gap, 2023-03-31:** hits 980 → 1,312; left out 583 → 184; wrong place 50 → 117.
- **Spreads along a front, 2023-04-26:** both hit all 25 points; arm c's flagged area covers much of
  Texas.

**2024 diagnostic (never deciding; at NadoCast's 5% false-alarm area):**
| | Brier | Hits | Left out | Wrong place | No signal |
|---|---|---|---|---|---|
| Arm b | 0.003598 | 9,695 | 4,638 | 3,335 | 1,102 |
| **Arm c** | **0.003422** | **11,679** | 2,880 | 2,459 | 1,752 |
| NadoCast | 0.003403 | 11,456 | 2,597 | 2,376 | 2,341 |

- On 2024, arm c roughly matches NadoCast: 2% more hits at equal area, with Brier within 0.00002.
- On 2024-12-28: hits 629 → 763 and wrong place 70 → 19 (NadoCast hits 857).
- The map title on `corridor-2024-12-28.png` still says "all 96 development dates" (v1 wording). The
  fit actually used the full 362-date roster.

# Status: corridor v2 is a research candidate (passed 3 of 5)
Decision recorded 2026-11-23: corridor v2 is kept as a research candidate. It passed matched-area
hits, left-out and Brier, and failed no-signal and top-bin reliability. It is not frozen, and 2021
stays sealed.

# Blend follow-up (protocol locked 2026-11-23, before fitting): `research/severe/corridor/blend/rules.json`
1. **Regenerate v2 exactly.** It must reproduce the committed scorecard, or the run stops.
2. **Break down v2's no-signal failure.** Report days and report points; the top-5 share of the
   increase; and whether each date flagged a little area, narrowly missed the threshold, or was low
   across the board.
3. **Build one blend candidate:**
   - Surface: beta calibration of the probability blend (1−w)·p_b + w·p_c, with w in
     {0, .25, .5, .75, 1}.
   - Weight selection, inside the training folds only: eligible weights keep inner no-signal and
     wrong-place within 5% and inner Brier no worse than arm b. Among those, take the one with the
     most inner matched-area hits.
   - One threshold per fold, chosen in the training months to match arm b's 5% area. Held-out area
     must stay within 5% of arm b's.
   - The original five criteria decide, using report points.
   - Per-day no-signal, top-band reliability and top-band tornado days are reported against both
     arms.
4. **Outcome:** a full pass leads to freezing and one 2021 check. Anything else is posted and stops
   for review.

## Blend result (run 45094383941): FAIL. The blend collapsed to arm b in every fold; 2021 stays sealed; stopped for review
**Reproduction:** the regenerated v2 run matched the committed scorecard exactly (counts equal; Brier
difference 0.0). The refit fits file is byte-identical (sha 69e02247…).

**v2 no-signal breakdown** (v2 matched area; arm c threshold 6.36%):
- No-signal report points rose from 1,042 to 2,416 (+1,374).
- No-signal tornado days rose from 30 to 52. 25 days were arm-c only; 3 were arm-b only.
- The five largest contributors account for **60%** of the increase:

  | Date | Report points | b no-signal | c no-signal | c flagged samples | c max / threshold | Kind |
  |---|---|---|---|---|---|---|
  | 2022-05-27 | 205 | 0 | 204 | 3 | 1.12 | flagged 1-9 samples |
  | 2022-06-08 | 204 | 0 | 203 | 3 | 1.04 | flagged 1-9 samples |
  | 2023-05-13 | 154 | 0 | 154 | 1 | 1.09 | flagged 1-9 samples |
  | 2022-03-29 | 141 | 0 | 141 | 0 | 0.88 | narrow miss |
  | 2023-04-22 | 122 | 0 | 122 | 6 | 1.22 | flagged 1-9 samples |

- Arm c's no-signal points by kind:

  | Kind | Days | Points |
  |---|---|---|
  | Flagged 1-9 samples (under the 2,250 km² minimum) | 12 | 986 |
  | Narrow miss (max ≥ 75% of the threshold) | 11 | 494 |
  | Low across the board | 29 | 936 |

- **Reading:** most of the failure is arm c flagging the right spot too small (below the 10-sample
  area floor) or just under the threshold. It is not an absence of signal.

**Blend:**
- Inside the training folds, no weight above 0 kept inner no-signal and wrong-place within 5%, so
  every fold (and the all-roster fit) selected **weight 0**. The blend is therefore arm b.
- Results: hits 1.00× (8,070); left-out 0%; Brier difference 0. Criteria 1, 2, 3 and 5 fail
  (arm b's ≥30% bin is forecast 37.3% vs observed 20.8%, on 30 tornado days). Criterion 4 passes
  trivially.
- Blend vs arm c: Brier worse by [+0.000067, +0.000184]; hits [−2,977, −754].
- The 2024 diagnostic is identical to arm b.

**Status:** v2 remains a research candidate (3 of 5). Nothing is frozen. 2021 is sealed and 2025 is
sealed. Stopped for review.
