# Retrospective RRFS pilot scorecard (12z RRFS, Day 2 damaging wind)

Scored dates: 92; dropped: 0. Rules: `research/severe/conus-v1/rrfs/retro/RULES.md`.

## all_blocks / national: 92 dates, 71 report days, 79200 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01944 | 0.103 | 0.92 | 69.3% | 783,413 | 69.3% |
| rrfs | 0.01961 | 0.095 | 1.10 | 69.2% | 921,179 | 65.2% |
| hrrr_rrfs | 0.01877 | 0.134 | 0.94 | 73.5% | 794,898 | 73.1% |

- hrrr_rrfs_minus_hrrr: Brier -0.000672 [-0.000936, -0.000422]; hits (training threshold) +4.2 pts [+2.6, +5.7]; equal-area hits +3.8 pts [+2.2, +5.3]
- rrfs_minus_hrrr: Brier +0.000173 [-0.000202, +0.000544]; hits (training threshold) -0.1 pts [-2.6, +2.6]; equal-area hits -4.1 pts [-6.7, -1.2]
- hrrr_rrfs_minus_rrfs: Brier -0.000845 [-0.001128, -0.000577]; hits (training threshold) +4.3 pts [+2.3, +6.2]; equal-area hits +7.8 pts [+5.6, +9.9]

## all_blocks / florida_gulf_south: 92 dates, 31 report days, 1133 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01440 | -0.166 | 3.44 | 78.6% | 62,540 | 78.6% |
| rrfs | 0.01482 | -0.199 | 3.14 | 75.1% | 49,339 | 80.1% |
| hrrr_rrfs | 0.01385 | -0.121 | 2.96 | 77.1% | 48,319 | 84.0% |

- hrrr_rrfs_minus_hrrr: Brier -0.000555 [-0.001279, +0.000256]; hits (training threshold) -1.4 pts [-7.6, +3.3]; equal-area hits +5.5 pts [+0.4, +11.5]
- rrfs_minus_hrrr: Brier +0.000415 [-0.000959, +0.002000]; hits (training threshold) -3.4 pts [-16.8, +7.2]; equal-area hits +1.5 pts [-10.3, +12.4]
- hrrr_rrfs_minus_rrfs: Brier -0.000969 [-0.002370, +0.000279]; hits (training threshold) +2.0 pts [-5.6, +12.2]; equal-area hits +4.0 pts [-2.7, +13.3]

## jul2023 / national: 30 dates, 30 report days, 42961 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.03292 | 0.085 | 0.65 | 59.2% | 1,091,588 | 59.2% |
| rrfs | 0.03253 | 0.096 | 0.64 | 57.5% | 1,038,900 | 58.8% |
| hrrr_rrfs | 0.03181 | 0.116 | 0.66 | 63.8% | 1,088,542 | 63.8% |

- hrrr_rrfs_minus_hrrr: Brier -0.001101 [-0.001574, -0.000708]; hits (training threshold) +4.6 pts [+2.1, +7.0]; equal-area hits +4.7 pts [+2.1, +7.1]
- rrfs_minus_hrrr: Brier -0.000389 [-0.000867, +0.000045]; hits (training threshold) -1.6 pts [-5.1, +1.8]; equal-area hits -0.4 pts [-3.8, +3.1]
- hrrr_rrfs_minus_rrfs: Brier -0.000712 [-0.001129, -0.000302]; hits (training threshold) +6.2 pts [+3.9, +8.6]; equal-area hits +5.0 pts [+2.7, +7.4]

## jul2023 / florida_gulf_south: 30 dates, 16 report days, 407 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01864 | -0.382 | 4.89 | 73.0% | 119,340 | 73.0% |
| rrfs | 0.01480 | -0.097 | 2.73 | 55.8% | 62,662 | 83.0% |
| hrrr_rrfs | 0.01639 | -0.215 | 3.51 | 69.3% | 79,448 | 86.2% |

- hrrr_rrfs_minus_hrrr: Brier -0.002248 [-0.003313, -0.000986]; hits (training threshold) -3.7 pts [-15.2, +4.7]; equal-area hits +13.3 pts [+2.5, +26.8]
- rrfs_minus_hrrr: Brier -0.003839 [-0.004786, -0.002857]; hits (training threshold) -17.2 pts [-44.4, +4.5]; equal-area hits +10.1 pts [-8.6, +31.2]
- hrrr_rrfs_minus_rrfs: Brier +0.001591 [+0.000565, +0.002868]; hits (training threshold) +13.5 pts [-1.9, +34.3]; equal-area hits +3.2 pts [-6.3, +14.8]

## janfeb2024 / national: 32 dates, 11 report days, 3741 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00270 | 0.302 | 1.40 | 72.4% | 137,820 | 72.4% |
| rrfs | 0.00278 | 0.281 | 3.66 | 90.9% | 400,022 | 75.0% |
| hrrr_rrfs | 0.00246 | 0.364 | 1.44 | 83.5% | 158,449 | 81.5% |

- hrrr_rrfs_minus_hrrr: Brier -0.000240 [-0.000644, -0.000024]; hits (training threshold) +11.1 pts [+1.4, +19.5]; equal-area hits +9.1 pts [-0.5, +17.2]
- rrfs_minus_hrrr: Brier +0.000080 [-0.000453, +0.000461]; hits (training threshold) +18.4 pts [+4.3, +23.8]; equal-area hits +2.6 pts [-28.4, +12.2]
- hrrr_rrfs_minus_rrfs: Brier -0.000320 [-0.000594, -0.000139]; hits (training threshold) -7.3 pts [-10.6, +2.1]; equal-area hits +6.5 pts [-0.6, +32.4]

## janfeb2024 / florida_gulf_south: 32 dates, 3 report days, 218 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00639 | 0.145 | 2.68 | 100.0% | 23,203 | 100.0% |
| rrfs | 0.00616 | 0.175 | 3.02 | 99.1% | 24,539 | 99.1% |
| hrrr_rrfs | 0.00570 | 0.238 | 2.52 | 100.0% | 20,482 | 100.0% |

- hrrr_rrfs_minus_hrrr: Brier -0.000694 [-0.001564, -0.000114]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- rrfs_minus_hrrr: Brier -0.000227 [-0.001178, +0.000527]; hits (training threshold) -0.9 pts [+nan, +nan]; equal-area hits -0.9 pts [+nan, +nan]
- hrrr_rrfs_minus_rrfs: Brier -0.000468 [-0.000982, -0.000099]; hits (training threshold) +0.9 pts [+nan, +nan]; equal-area hits +0.9 pts [+nan, +nan]

## may2024 / national: 30 dates, 30 report days, 32498 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02381 | 0.124 | 1.21 | 82.3% | 1,163,872 | 82.3% |
| rrfs | 0.02465 | 0.093 | 1.43 | 82.1% | 1,359,360 | 78.4% |
| hrrr_rrfs | 0.02311 | 0.150 | 1.25 | 85.1% | 1,180,132 | 84.9% |

- hrrr_rrfs_minus_hrrr: Brier -0.000702 [-0.001223, -0.000200]; hits (training threshold) +2.8 pts [+0.9, +4.8]; equal-area hits +2.6 pts [+0.7, +4.5]
- rrfs_minus_hrrr: Brier +0.000834 [-0.000023, +0.001696]; hits (training threshold) -0.2 pts [-3.5, +3.2]; equal-area hits -3.9 pts [-7.5, -0.5]
- hrrr_rrfs_minus_rrfs: Brier -0.001536 [-0.002174, -0.000922]; hits (training threshold) +3.0 pts [+0.9, +5.2]; equal-area hits +6.5 pts [+4.3, +8.9]

## may2024 / florida_gulf_south: 30 dates, 12 report days, 508 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01872 | -0.115 | 2.61 | 73.8% | 47,700 | 73.8% |
| rrfs | 0.02407 | -0.434 | 3.53 | 80.3% | 62,468 | 74.2% |
| hrrr_rrfs | 0.02001 | -0.192 | 2.70 | 73.6% | 46,882 | 74.0% |

- hrrr_rrfs_minus_hrrr: Brier +0.001287 [-0.000299, +0.003123]; hits (training threshold) -0.2 pts [-9.1, +7.7]; equal-area hits +0.2 pts [-8.7, +8.0]
- rrfs_minus_hrrr: Brier +0.005352 [+0.001889, +0.009308]; hits (training threshold) +6.5 pts [-10.2, +20.0]; equal-area hits +0.4 pts [-20.1, +15.0]
- hrrr_rrfs_minus_rrfs: Brier -0.004064 [-0.007676, -0.000653]; hits (training threshold) -6.7 pts [-15.5, +2.4]; equal-area hits -0.2 pts [-9.2, +12.2]

