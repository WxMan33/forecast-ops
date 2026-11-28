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

- pooled / national: Brier hrrr 0.01415, hrrr_rrfs 0.01380, nadocast 0.01249; forecast/observed hrrr 1.26, hrrr_rrfs 1.30, nadocast 1.02
- pooled / florida_gulf_south: Brier hrrr 0.01081, hrrr_rrfs 0.01138, nadocast 0.01139; forecast/observed hrrr 2.90, hrrr_rrfs 2.85, nadocast 1.62
- janfeb2024 / national: Brier hrrr 0.00101, hrrr_rrfs 0.00099, nadocast 0.00101; forecast/observed hrrr 3.21, hrrr_rrfs 3.17, nadocast 1.59
- janfeb2024 / florida_gulf_south: Brier hrrr 0.00288, hrrr_rrfs 0.00244, nadocast 0.00226; forecast/observed hrrr 8.24, hrrr_rrfs 7.35, nadocast 4.51
- may2024 / national: Brier hrrr 0.02426, hrrr_rrfs 0.02365, nadocast 0.02131; forecast/observed hrrr 1.21, hrrr_rrfs 1.25, nadocast 1.01
- may2024 / florida_gulf_south: Brier hrrr 0.01691, hrrr_rrfs 0.01826, nadocast 0.01842; forecast/observed hrrr 2.38, hrrr_rrfs 2.40, nadocast 1.33
