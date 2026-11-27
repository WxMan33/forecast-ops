# Retrospective RRFS pilot scorecard (06z RRFS, Day 2 damaging wind)

Scored dates: 88; dropped: 4. Rules: `research/severe/conus-v1/rrfs/retro/FOLLOWUP-06Z.md`.

## all_blocks / national: 88 dates, 68 report days, 75968 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01939 | 0.108 | 0.89 | 69.6% | 787,239 | 69.6% |
| hrrr_rrfs | 0.01879 | 0.135 | 0.92 | 73.3% | 813,503 | 72.4% |
| hrrr_rrfs06 | 0.01897 | 0.127 | 0.93 | 74.3% | 826,878 | 73.0% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.000185 [-0.000036, +0.000413]; hits (training threshold) +0.9 pts [-0.5, +2.5]; equal-area hits +0.6 pts [-0.9, +2.2]
- hrrr_rrfs06_minus_hrrr: Brier -0.000413 [-0.000636, -0.000207]; hits (training threshold) +4.7 pts [+2.8, +6.8]; equal-area hits +3.4 pts [+1.6, +5.4]
- hrrr_rrfs_minus_hrrr: Brier -0.000598 [-0.000829, -0.000377]; hits (training threshold) +3.8 pts [+2.3, +5.4]; equal-area hits +2.9 pts [+1.4, +4.4]

## all_blocks / florida_gulf_south: 88 dates, 29 report days, 932 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01351 | -0.263 | 4.14 | 74.7% | 63,286 | 74.7% |
| hrrr_rrfs | 0.01289 | -0.205 | 3.59 | 75.1% | 52,701 | 81.2% |
| hrrr_rrfs06 | 0.01363 | -0.274 | 3.80 | 74.1% | 56,541 | 79.3% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.000739 [+0.000053, +0.001554]; hits (training threshold) -1.0 pts [-3.9, +2.0]; equal-area hits -1.9 pts [-5.1, +1.3]
- hrrr_rrfs06_minus_hrrr: Brier +0.000112 [-0.000762, +0.001196]; hits (training threshold) -0.5 pts [-5.2, +4.0]; equal-area hits +4.6 pts [-0.2, +10.8]
- hrrr_rrfs_minus_hrrr: Brier -0.000628 [-0.001298, +0.000083]; hits (training threshold) +0.4 pts [-5.0, +5.6]; equal-area hits +6.5 pts [+0.7, +13.6]

## jul2023 / national: 30 dates, 30 report days, 42961 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.03286 | 0.087 | 0.69 | 61.0% | 1,153,552 | 61.0% |
| hrrr_rrfs | 0.03181 | 0.116 | 0.69 | 65.4% | 1,168,192 | 65.0% |
| hrrr_rrfs06 | 0.03210 | 0.108 | 0.71 | 67.2% | 1,252,140 | 64.8% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.000287 [-0.000079, +0.000703]; hits (training threshold) +1.8 pts [-0.6, +4.3]; equal-area hits -0.3 pts [-2.7, +2.2]
- hrrr_rrfs06_minus_hrrr: Brier -0.000758 [-0.001147, -0.000403]; hits (training threshold) +6.2 pts [+3.4, +9.5]; equal-area hits +3.8 pts [+1.0, +7.1]
- hrrr_rrfs_minus_hrrr: Brier -0.001044 [-0.001441, -0.000683]; hits (training threshold) +4.4 pts [+2.3, +6.6]; equal-area hits +4.1 pts [+1.9, +6.2]

## jul2023 / florida_gulf_south: 30 dates, 16 report days, 407 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02055 | -0.523 | 5.32 | 73.0% | 118,050 | 73.0% |
| hrrr_rrfs | 0.01806 | -0.339 | 4.10 | 71.3% | 90,262 | 85.0% |
| hrrr_rrfs06 | 0.01877 | -0.392 | 4.66 | 74.0% | 106,838 | 79.9% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.000709 [-0.000339, +0.001673]; hits (training threshold) +2.7 pts [-0.5, +7.1]; equal-area hits -5.2 pts [-11.3, -0.5]
- hrrr_rrfs06_minus_hrrr: Brier -0.001774 [-0.002518, -0.001075]; hits (training threshold) +1.0 pts [-4.8, +6.9]; equal-area hits +6.9 pts [+0.2, +14.8]
- hrrr_rrfs_minus_hrrr: Brier -0.002484 [-0.003704, -0.001197]; hits (training threshold) -1.7 pts [-10.9, +5.8]; equal-area hits +12.0 pts [+1.5, +25.4]

## janfeb2024 / national: 30 dates, 10 report days, 1628 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00140 | 0.417 | 2.94 | 64.9% | 141,420 | 64.9% |
| hrrr_rrfs | 0.00134 | 0.439 | 2.88 | 76.7% | 162,540 | 74.4% |
| hrrr_rrfs06 | 0.00135 | 0.436 | 2.66 | 68.9% | 135,090 | 70.0% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.000008 [-0.000025, +0.000044]; hits (training threshold) -7.8 pts [-20.3, +1.9]; equal-area hits -4.5 pts [-17.0, +5.7]
- hrrr_rrfs06_minus_hrrr: Brier -0.000045 [-0.000085, -0.000007]; hits (training threshold) +4.0 pts [-10.5, +18.9]; equal-area hits +5.0 pts [-9.0, +19.9]
- hrrr_rrfs_minus_hrrr: Brier -0.000053 [-0.000094, -0.000019]; hits (training threshold) +11.8 pts [+0.3, +23.8]; equal-area hits +9.5 pts [-2.1, +21.8]

## janfeb2024 / florida_gulf_south: 30 dates, 2 report days, 41 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00211 | 0.111 | 11.00 | 100.0% | 20,078 | 100.0% |
| hrrr_rrfs | 0.00175 | 0.264 | 9.59 | 100.0% | 17,572 | 100.0% |
| hrrr_rrfs06 | 0.00178 | 0.253 | 8.30 | 92.7% | 14,632 | 100.0% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.000026 [-0.000213, +0.000341]; hits (training threshold) -7.3 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs06_minus_hrrr: Brier -0.000337 [-0.000539, -0.000167]; hits (training threshold) -7.3 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_minus_hrrr: Brier -0.000362 [-0.000770, -0.000087]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]

## may2024 / national: 28 dates, 28 report days, 31379 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02423 | 0.138 | 1.06 | 81.6% | 1,086,710 | 81.6% |
| hrrr_rrfs | 0.02353 | 0.163 | 1.13 | 84.0% | 1,130,938 | 83.3% |
| hrrr_rrfs06 | 0.02379 | 0.154 | 1.14 | 84.2% | 1,112,440 | 83.8% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.000266 [-0.000305, +0.000864]; hits (training threshold) +0.2 pts [-1.1, +1.4]; equal-area hits +0.4 pts [-1.0, +1.7]
- hrrr_rrfs06_minus_hrrr: Brier -0.000438 [-0.000979, +0.000031]; hits (training threshold) +2.7 pts [+1.1, +4.5]; equal-area hits +2.2 pts [+0.6, +3.9]
- hrrr_rrfs_minus_hrrr: Brier -0.000705 [-0.001291, -0.000246]; hits (training threshold) +2.5 pts [+0.8, +4.4]; equal-area hits +1.8 pts [+0.2, +3.7]

## may2024 / florida_gulf_south: 28 dates, 11 report days, 484 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01820 | -0.063 | 2.57 | 74.0% | 50,906 | 74.0% |
| hrrr_rrfs | 0.01928 | -0.126 | 2.65 | 76.2% | 50,095 | 76.4% |
| hrrr_rrfs06 | 0.02081 | -0.215 | 2.69 | 72.7% | 47,555 | 75.8% |

- hrrr_rrfs06_minus_hrrr_rrfs: Brier +0.001535 [-0.000335, +0.003905]; hits (training threshold) -3.5 pts [-8.9, +0.8]; equal-area hits -0.6 pts [-5.0, +3.8]
- hrrr_rrfs06_minus_hrrr: Brier +0.002612 [+0.000229, +0.005878]; hits (training threshold) -1.2 pts [-10.4, +6.2]; equal-area hits +1.9 pts [-6.9, +11.4]
- hrrr_rrfs_minus_hrrr: Brier +0.001077 [-0.000112, +0.002676]; hits (training threshold) +2.3 pts [-5.3, +9.7]; equal-area hits +2.5 pts [-5.3, +10.2]

