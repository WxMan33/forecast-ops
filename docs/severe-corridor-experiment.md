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
