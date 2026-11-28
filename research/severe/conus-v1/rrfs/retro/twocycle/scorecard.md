# Retrospective RRFS pilot scorecard (06z RRFS, Day 2 damaging wind)

Scored dates: 88; dropped: 4. Rules: `research/severe/conus-v1/rrfs/retro/TWO-CYCLE.md`.

## Two-cycle blend minus HRRR + 12Z RRFS (hit change in points of report coverage, 95% whole-date intervals)

| Scope | Region | Report days | Hits, equal area vs blend (diagnostic) | Hits, training-set threshold | False-alarm km²/day, training threshold (blend → two-cycle) | Brier |
|---|---|---|---|---|---|---|
| all_blocks | national | 68 | +1.3 [+0.4, +2.3] | +1.9 [+1.0, +3.0] | 814,173 → 837,606 | -0.000104 [-0.000210, +0.000003] |
| all_blocks | florida_gulf_south | 29 | -1.3 [-3.2, +0.2] | -1.2 [-3.1, +0.5] | 52,883 → 51,822 | +0.000352 [-0.000042, +0.000831] |
| jul2023 | national | 30 | +1.3 [+0.0, +2.9] | +3.4 [+2.0, +4.9] | 1,169,925 → 1,267,628 | -0.000233 [-0.000424, -0.000037] |
| jul2023 | florida_gulf_south | 16 | -2.2 [-5.6, +0.7] | -2.2 [-5.6, +0.7] | 90,705 → 90,158 | -0.000036 [-0.000510, +0.000424] |
| janfeb2024 | national | 10 | -0.2 [-2.8, +2.5] | -1.7 [-4.3, +0.9] | 162,608 → 150,000 | -0.000001 [-0.000032, +0.000033] |
| janfeb2024 | florida_gulf_south | 2 | +0.0 [+nan, +nan] | +0.0 [+nan, +nan] | 17,595 → 15,360 | -0.000070 [-0.000195, +0.000058] |
| may2024 | national | 28 | +0.4 [-0.1, +0.9] | +0.2 [-0.3, +0.6] | 1,131,115 → 1,113,589 | -0.000077 [-0.000352, +0.000159] |
| may2024 | florida_gulf_south | 11 | -0.4 [-2.7, +1.4] | -0.4 [-2.7, +1.4] | 50,167 → 49,813 | +0.001218 [+0.000151, +0.002599] |

## all_blocks / national: 88 dates, 68 report days, 75968 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01939 | 0.108 | 0.89 | 69.6% | 788,226 | 69.6% |
| hrrr_rrfs | 0.01879 | 0.136 | 0.92 | 73.4% | 814,173 | 72.5% |
| hrrr_rrfs_2cyc | 0.01868 | 0.140 | 0.94 | 75.3% | 837,606 | 73.9% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier -0.000104 [-0.000210, +0.000003]; hits (training threshold) +1.9 pts [+1.0, +3.0]; equal-area hits +1.4 pts [+0.5, +2.4]
- hrrr_rrfs_2cyc_minus_hrrr: Brier -0.000705 [-0.000975, -0.000456]; hits (training threshold) +5.7 pts [+3.8, +7.8]; equal-area hits +4.3 pts [+2.4, +6.3]
- hrrr_rrfs_minus_hrrr: Brier -0.000601 [-0.000830, -0.000379]; hits (training threshold) +3.8 pts [+2.3, +5.4]; equal-area hits +2.8 pts [+1.4, +4.4]

## all_blocks / florida_gulf_south: 88 dates, 29 report days, 932 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01355 | -0.267 | 4.16 | 74.6% | 63,516 | 74.6% |
| hrrr_rrfs | 0.01292 | -0.208 | 3.60 | 75.1% | 52,883 | 81.3% |
| hrrr_rrfs_2cyc | 0.01327 | -0.241 | 3.54 | 73.9% | 51,822 | 80.2% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier +0.000352 [-0.000042, +0.000831]; hits (training threshold) -1.2 pts [-3.1, +0.5]; equal-area hits -1.2 pts [-3.0, +0.3]
- hrrr_rrfs_2cyc_minus_hrrr: Brier -0.000284 [-0.001105, +0.000622]; hits (training threshold) -0.6 pts [-7.5, +6.0]; equal-area hits +5.6 pts [-0.4, +12.5]
- hrrr_rrfs_minus_hrrr: Brier -0.000635 [-0.001312, +0.000085]; hits (training threshold) +0.5 pts [-4.9, +5.7]; equal-area hits +6.8 pts [+0.9, +14.0]

## jul2023 / national: 30 dates, 30 report days, 42961 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.03286 | 0.087 | 0.69 | 61.1% | 1,156,478 | 61.1% |
| hrrr_rrfs | 0.03181 | 0.116 | 0.69 | 65.5% | 1,169,925 | 65.1% |
| hrrr_rrfs_2cyc | 0.03158 | 0.123 | 0.73 | 68.8% | 1,267,628 | 66.5% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier -0.000233 [-0.000424, -0.000037]; hits (training threshold) +3.4 pts [+2.0, +4.9]; equal-area hits +1.4 pts [+0.0, +2.9]
- hrrr_rrfs_2cyc_minus_hrrr: Brier -0.001277 [-0.001713, -0.000852]; hits (training threshold) +7.7 pts [+4.8, +10.9]; equal-area hits +5.4 pts [+2.6, +8.4]
- hrrr_rrfs_minus_hrrr: Brier -0.001044 [-0.001439, -0.000682]; hits (training threshold) +4.4 pts [+2.2, +6.5]; equal-area hits +4.0 pts [+1.9, +6.1]

## jul2023 / florida_gulf_south: 30 dates, 16 report days, 407 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02065 | -0.531 | 5.35 | 73.0% | 118,605 | 73.0% |
| hrrr_rrfs | 0.01815 | -0.345 | 4.12 | 71.3% | 90,705 | 85.3% |
| hrrr_rrfs_2cyc | 0.01811 | -0.343 | 4.03 | 69.0% | 90,158 | 83.8% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier -0.000036 [-0.000510, +0.000424]; hits (training threshold) -2.2 pts [-5.6, +0.7]; equal-area hits -1.5 pts [-4.1, +0.4]
- hrrr_rrfs_2cyc_minus_hrrr: Brier -0.002541 [-0.003705, -0.001337]; hits (training threshold) -3.9 pts [-15.7, +6.0]; equal-area hits +10.8 pts [+0.3, +24.4]
- hrrr_rrfs_minus_hrrr: Brier -0.002505 [-0.003748, -0.001185]; hits (training threshold) -1.7 pts [-10.9, +5.8]; equal-area hits +12.3 pts [+1.8, +25.7]

## janfeb2024 / national: 30 dates, 10 report days, 1628 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00140 | 0.417 | 2.93 | 64.7% | 141,622 | 64.7% |
| hrrr_rrfs | 0.00134 | 0.439 | 2.88 | 76.8% | 162,608 | 74.4% |
| hrrr_rrfs_2cyc | 0.00134 | 0.440 | 2.67 | 75.1% | 150,000 | 74.3% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier -0.000001 [-0.000032, +0.000033]; hits (training threshold) -1.7 pts [-4.3, +0.9]; equal-area hits -0.2 pts [-3.7, +3.0]
- hrrr_rrfs_2cyc_minus_hrrr: Brier -0.000054 [-0.000109, -0.000002]; hits (training threshold) +10.4 pts [-1.7, +24.6]; equal-area hits +9.6 pts [-2.1, +24.0]
- hrrr_rrfs_minus_hrrr: Brier -0.000053 [-0.000095, -0.000019]; hits (training threshold) +12.1 pts [+0.5, +24.4]; equal-area hits +9.8 pts [-2.0, +22.2]

## janfeb2024 / florida_gulf_south: 30 dates, 2 report days, 41 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00212 | 0.109 | 11.03 | 100.0% | 20,138 | 100.0% |
| hrrr_rrfs | 0.00175 | 0.264 | 9.59 | 100.0% | 17,595 | 100.0% |
| hrrr_rrfs_2cyc | 0.00168 | 0.293 | 8.36 | 100.0% | 15,360 | 100.0% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier -0.000070 [-0.000195, +0.000058]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_2cyc_minus_hrrr: Brier -0.000437 [-0.000782, -0.000176]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_minus_hrrr: Brier -0.000367 [-0.000776, -0.000089]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]

## may2024 / national: 28 dates, 28 report days, 31379 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02423 | 0.138 | 1.06 | 81.5% | 1,086,461 | 81.5% |
| hrrr_rrfs | 0.02352 | 0.164 | 1.13 | 84.0% | 1,131,115 | 83.3% |
| hrrr_rrfs_2cyc | 0.02344 | 0.166 | 1.14 | 84.2% | 1,113,589 | 83.7% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier -0.000077 [-0.000352, +0.000159]; hits (training threshold) +0.2 pts [-0.3, +0.6]; equal-area hits +0.4 pts [-0.1, +0.9]
- hrrr_rrfs_2cyc_minus_hrrr: Brier -0.000791 [-0.001407, -0.000261]; hits (training threshold) +2.7 pts [+0.8, +4.7]; equal-area hits +2.2 pts [+0.4, +4.2]
- hrrr_rrfs_minus_hrrr: Brier -0.000714 [-0.001299, -0.000256]; hits (training threshold) +2.5 pts [+0.8, +4.5]; equal-area hits +1.8 pts [+0.1, +3.7]

## may2024 / florida_gulf_south: 28 dates, 11 report days, 484 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01820 | -0.063 | 2.57 | 73.8% | 50,971 | 73.8% |
| hrrr_rrfs | 0.01928 | -0.126 | 2.65 | 76.2% | 50,167 | 76.7% |
| hrrr_rrfs_2cyc | 0.02050 | -0.197 | 2.72 | 75.8% | 49,813 | 75.8% |

- hrrr_rrfs_2cyc_minus_hrrr_rrfs: Brier +0.001218 [+0.000151, +0.002599]; hits (training threshold) -0.4 pts [-2.7, +1.4]; equal-area hits -0.8 pts [-3.1, +0.6]
- hrrr_rrfs_2cyc_minus_hrrr: Brier +0.002300 [+0.000545, +0.004592]; hits (training threshold) +2.1 pts [-6.9, +11.0]; equal-area hits +2.1 pts [-6.9, +11.0]
- hrrr_rrfs_minus_hrrr: Brier +0.001081 [-0.000108, +0.002670]; hits (training threshold) +2.5 pts [-4.9, +9.9]; equal-area hits +2.9 pts [-4.7, +11.0]

