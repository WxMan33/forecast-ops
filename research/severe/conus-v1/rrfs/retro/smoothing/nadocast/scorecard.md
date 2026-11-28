# NadoCast vs HRRR + 12Z RRFS (retrospective pilot, Day 2 damaging wind)

Matched dates: 46; excluded: 16. Rules: `research/severe/conus-v1/rrfs/retro/NADOCAST.md`.

Hit changes are points of report coverage with whole-date 95% intervals. Equal area = each model's held-out threshold set to NadoCast's 5% false-alarm area in that scope (diagnostic).

| Scope | Region | Dates / report days | Hits at NadoCast 5% area: NadoCast / HRRR / HRRR+RRFS | HRRR+RRFS − NadoCast, equal area | HRRR+RRFS − NadoCast, training-set threshold (FA km²/day: NadoCast 5% → HRRR+RRFS) | Brier HRRR+RRFS − NadoCast |
|---|---|---|---|---|---|---|
| pooled | national | 46 / 32 | 84.4% / 73.8% / 78.0% | -6.3 [-10.8, -2.5] | +1.5 [-1.7, +5.2] (503,212 → 731,852) | +0.001310 [+0.000602, +0.002132] |
| pooled | florida_gulf_south | 46 / 11 | 55.1% / 52.9% / 59.3% | +4.2 [-5.7, +16.9] | +16.5 [+5.5, +38.5] (14,615 → 30,448) | -0.000008 [-0.001610, +0.001359] |
| janfeb2024 | national | 20 / 6 | 64.4% / 69.9% / 74.3% | +9.9 [-7.4, +39.6] | +18.8 [-0.5, +61.1] (69,041 → 117,664) | -0.000023 [-0.000153, +0.000063] |
| janfeb2024 | florida_gulf_south | 20 / 2 | 95.1% / 61.0% / 100.0% | +4.9 [+0.0, +100.0] | +4.9 [+0.0, +100.0] (13,489 → 20,891) | +0.000182 [-0.000816, +0.000935] |
| may2024 | national | 26 / 26 | 84.9% / 73.7% / 78.0% | -7.0 [-11.5, -3.3] | +1.1 [-2.3, +4.5] (837,190 → 1,204,304) | +0.002335 [+0.001193, +0.003707] |
| may2024 | florida_gulf_south | 26 / 9 | 51.1% / 49.6% / 48.4% | -2.7 [-14.7, +4.0] | +17.7 [+4.5, +44.0] (15,482 → 37,800) | -0.000154 [-0.002875, +0.002242] |

## Smoothed minus unsmoothed blend

| Scope | Region | Hits at NadoCast 5% area | Recovered / lost report points | NadoCast-only points now caught | Hits at training-set threshold (FA km²/day before → after) | Brier |
|---|---|---|---|---|---|---|
| pooled | national | +1.1 [+0.2, +1.8] | 1119 / 799 | 810 of 3371 | +1.7 [+1.1, +2.4] (731,852 → 742,730) | -0.000413 [-0.000568, -0.000274] |
| pooled | florida_gulf_south | -4.6 [-20.8, +3.9] | 15 / 36 | 2 of 19 | +12.8 [+1.9, +25.5] (30,448 → 31,290) | -0.000282 [-0.000876, +0.000288] |
| janfeb2024 | national | +8.7 [+3.5, +20.2] | 77 / 6 | 32 of 52 | +5.6 [-0.2, +14.1] (117,664 → 95,771) | -0.000014 [-0.000022, -0.000008] |
| janfeb2024 | florida_gulf_south | +0.0 [+0.0, +0.0] | 0 / 0 | 0 of 0 | +0.0 [+0.0, +0.0] (20,891 → 18,158) | -0.000028 [-0.000182, +0.000182] |
| may2024 | national | +0.8 [-0.1, +1.5] | 1051 / 816 | 756 of 3377 | +1.6 [+1.0, +2.2] (1,204,304 → 1,240,390) | -0.000720 [-0.000926, -0.000533] |
| may2024 | florida_gulf_south | -2.9 [-13.6, +2.1] | 5 / 17 | 0 of 22 | +14.0 [+2.5, +28.5] (37,800 → 41,391) | -0.000476 [-0.001466, +0.000594] |

- pooled / national: Brier hrrr 0.01415, hrrr_rrfs 0.01380, hrrr_rrfs_smooth 0.01338, nadocast 0.01249; forecast/observed hrrr 1.26, hrrr_rrfs 1.30, hrrr_rrfs_smooth 1.31, nadocast 1.02
- pooled / florida_gulf_south: Brier hrrr 0.01081, hrrr_rrfs 0.01138, hrrr_rrfs_smooth 0.01110, nadocast 0.01139; forecast/observed hrrr 2.90, hrrr_rrfs 2.85, hrrr_rrfs_smooth 2.96, nadocast 1.62
- janfeb2024 / national: Brier hrrr 0.00101, hrrr_rrfs 0.00099, hrrr_rrfs_smooth 0.00097, nadocast 0.00101; forecast/observed hrrr 3.21, hrrr_rrfs 3.17, hrrr_rrfs_smooth 3.18, nadocast 1.59
- janfeb2024 / florida_gulf_south: Brier hrrr 0.00288, hrrr_rrfs 0.00244, hrrr_rrfs_smooth 0.00241, nadocast 0.00226; forecast/observed hrrr 8.24, hrrr_rrfs 7.35, hrrr_rrfs_smooth 7.41, nadocast 4.51
- may2024 / national: Brier hrrr 0.02426, hrrr_rrfs 0.02365, hrrr_rrfs_smooth 0.02293, nadocast 0.02131; forecast/observed hrrr 1.21, hrrr_rrfs 1.25, hrrr_rrfs_smooth 1.26, nadocast 1.01
- may2024 / florida_gulf_south: Brier hrrr 0.01691, hrrr_rrfs 0.01826, hrrr_rrfs_smooth 0.01779, nadocast 0.01842; forecast/observed hrrr 2.38, hrrr_rrfs 2.40, hrrr_rrfs_smooth 2.52, nadocast 1.33
