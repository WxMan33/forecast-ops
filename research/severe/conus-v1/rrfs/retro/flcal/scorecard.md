# Retrospective RRFS pilot scorecard (12z RRFS, Day 2 damaging wind)

Scored dates: 92; dropped: 0. Rules: `research/severe/conus-v1/rrfs/retro/FL-RECAL.md`.

## all_blocks / national: 92 dates, 71 report days, 79200 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01943 | 0.103 | 0.92 | 69.3% | 783,836 | 69.3% |
| hrrr_rrfs | 0.01877 | 0.134 | 0.94 | 73.5% | 794,886 | 73.1% |
| hrrr_rrfs_flcal | 0.01871 | 0.137 | 0.91 | 74.0% | 791,802 | 73.7% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier -0.000055 [-0.000109, -0.000008]; hits (training threshold) +0.5 pts [+0.3, +0.7]; equal-area hits +0.7 pts [+0.5, +0.9]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.000724 [-0.000986, -0.000483]; hits (training threshold) +4.6 pts [+3.0, +6.3]; equal-area hits +4.4 pts [+2.8, +6.0]
- hrrr_rrfs_minus_hrrr: Brier -0.000669 [-0.000934, -0.000420]; hits (training threshold) +4.1 pts [+2.6, +5.7]; equal-area hits +3.7 pts [+2.2, +5.3]

## all_blocks / florida_gulf_south: 92 dates, 31 report days, 1133 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01438 | -0.163 | 3.43 | 78.6% | 62,337 | 78.6% |
| hrrr_rrfs | 0.01385 | -0.121 | 2.96 | 77.1% | 48,316 | 83.6% |
| hrrr_rrfs_flcal | 0.01169 | 0.054 | 1.26 | 56.2% | 18,682 | 85.7% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier -0.002158 [-0.004337, -0.000384]; hits (training threshold) -20.9 pts [-32.8, -12.8]; equal-area hits +2.1 pts [-1.2, +6.6]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.002684 [-0.004442, -0.001205]; hits (training threshold) -22.3 pts [-36.4, -12.7]; equal-area hits +7.1 pts [+1.3, +15.1]
- hrrr_rrfs_minus_hrrr: Brier -0.000525 [-0.001252, +0.000283]; hits (training threshold) -1.4 pts [-7.6, +3.3]; equal-area hits +5.0 pts [+0.1, +11.0]

## jul2023 / national: 30 dates, 30 report days, 42961 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.03291 | 0.085 | 0.65 | 59.2% | 1,092,525 | 59.2% |
| hrrr_rrfs | 0.03181 | 0.116 | 0.66 | 63.8% | 1,088,205 | 63.9% |
| hrrr_rrfs_flcal | 0.03174 | 0.118 | 0.64 | 64.4% | 1,074,210 | 64.9% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier -0.000076 [-0.000121, -0.000040]; hits (training threshold) +0.7 pts [+0.4, +0.9]; equal-area hits +1.1 pts [+0.7, +1.3]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.001173 [-0.001635, -0.000790]; hits (training threshold) +5.2 pts [+2.6, +7.7]; equal-area hits +5.7 pts [+3.1, +8.2]
- hrrr_rrfs_minus_hrrr: Brier -0.001098 [-0.001574, -0.000703]; hits (training threshold) +4.6 pts [+2.0, +7.0]; equal-area hits +4.7 pts [+2.1, +7.1]

## jul2023 / florida_gulf_south: 30 dates, 16 report days, 407 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01857 | -0.377 | 4.86 | 73.0% | 118,778 | 73.0% |
| hrrr_rrfs | 0.01639 | -0.215 | 3.51 | 69.3% | 79,425 | 86.2% |
| hrrr_rrfs_flcal | 0.01343 | 0.004 | 1.85 | 39.3% | 31,560 | 86.2% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier -0.002959 [-0.004726, -0.001524]; hits (training threshold) -30.0 pts [-46.8, -16.3]; equal-area hits +0.0 pts [+0.0, +0.0]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.005139 [-0.006084, -0.004226]; hits (training threshold) -33.7 pts [-55.2, -17.6]; equal-area hits +13.3 pts [+2.3, +27.2]
- hrrr_rrfs_minus_hrrr: Brier -0.002179 [-0.003248, -0.000911]; hits (training threshold) -3.7 pts [-15.4, +4.8]; equal-area hits +13.3 pts [+2.3, +27.2]

## janfeb2024 / national: 32 dates, 11 report days, 3741 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00270 | 0.302 | 1.40 | 72.7% | 138,192 | 72.7% |
| hrrr_rrfs | 0.00246 | 0.364 | 1.44 | 83.5% | 158,456 | 81.5% |
| hrrr_rrfs_flcal | 0.00247 | 0.361 | 1.35 | 84.1% | 149,766 | 82.4% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier +0.000012 [-0.000017, +0.000062]; hits (training threshold) +0.6 pts [-0.1, +0.9]; equal-area hits +0.9 pts [-0.0, +2.1]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.000226 [-0.000586, -0.000032]; hits (training threshold) +11.5 pts [+1.7, +19.7]; equal-area hits +9.7 pts [+0.1, +18.4]
- hrrr_rrfs_minus_hrrr: Brier -0.000238 [-0.000639, -0.000024]; hits (training threshold) +10.9 pts [+1.4, +19.2]; equal-area hits +8.9 pts [-0.5, +16.9]

## janfeb2024 / florida_gulf_south: 32 dates, 3 report days, 218 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00639 | 0.145 | 2.68 | 100.0% | 23,196 | 100.0% |
| hrrr_rrfs | 0.00570 | 0.238 | 2.52 | 100.0% | 20,482 | 100.0% |
| hrrr_rrfs_flcal | 0.00617 | 0.175 | 0.86 | 90.8% | 4,177 | 100.0% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier +0.000471 [-0.000661, +0.002407]; hits (training threshold) -9.2 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.000223 [-0.001132, +0.001075]; hits (training threshold) -9.2 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_minus_hrrr: Brier -0.000693 [-0.001556, -0.000116]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]

## may2024 / national: 30 dates, 30 report days, 32498 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02381 | 0.124 | 1.21 | 82.3% | 1,163,835 | 82.3% |
| hrrr_rrfs | 0.02311 | 0.150 | 1.25 | 85.1% | 1,180,425 | 84.9% |
| hrrr_rrfs_flcal | 0.02301 | 0.154 | 1.22 | 85.4% | 1,194,232 | 85.0% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier -0.000106 [-0.000268, +0.000020]; hits (training threshold) +0.3 pts [+0.0, +0.5]; equal-area hits +0.1 pts [-0.2, +0.3]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.000805 [-0.001337, -0.000279]; hits (training threshold) +3.1 pts [+1.2, +5.1]; equal-area hits +2.6 pts [+0.7, +4.7]
- hrrr_rrfs_minus_hrrr: Brier -0.000699 [-0.001216, -0.000197]; hits (training threshold) +2.8 pts [+0.9, +4.8]; equal-area hits +2.6 pts [+0.7, +4.5]

## may2024 / florida_gulf_south: 30 dates, 12 report days, 508 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01870 | -0.114 | 2.60 | 73.8% | 47,648 | 73.8% |
| hrrr_rrfs | 0.02001 | -0.192 | 2.70 | 73.6% | 46,898 | 74.0% |
| hrrr_rrfs_flcal | 0.01584 | 0.056 | 0.96 | 54.9% | 21,278 | 74.0% |

- hrrr_rrfs_flcal_minus_hrrr_rrfs: Brier -0.004161 [-0.010088, +0.000741]; hits (training threshold) -18.7 pts [-34.8, -7.5]; equal-area hits +0.0 pts [+0.0, +0.0]
- hrrr_rrfs_flcal_minus_hrrr: Brier -0.002854 [-0.007615, +0.001160]; hits (training threshold) -18.9 pts [-40.8, -6.3]; equal-area hits +0.2 pts [-8.7, +8.0]
- hrrr_rrfs_minus_hrrr: Brier +0.001307 [-0.000292, +0.003157]; hits (training threshold) -0.2 pts [-9.1, +7.7]; equal-area hits +0.2 pts [-8.7, +8.0]

