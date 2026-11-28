# Retrospective RRFS pilot scorecard (12z RRFS, Day 2 damaging wind)

Scored dates: 92; dropped: 0. Rules: `research/severe/conus-v1/rrfs/retro/TREE.md`.

## all_blocks / national: 92 dates, 71 report days, 79200 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01943 | 0.103 | 0.92 | 69.3% | 783,836 | 69.3% |
| hrrr_rrfs | 0.01877 | 0.134 | 0.94 | 73.5% | 794,886 | 73.1% |
| hrrr_rrfs_smooth | 0.01843 | 0.150 | 0.94 | 75.2% | 780,420 | 75.4% |
| hrrr_rrfs_gbt | 0.01897 | 0.125 | 1.54 | 73.6% | 802,438 | 74.0% |
| hrrr_rrfs_gbt_raw | 0.01874 | 0.135 | 0.86 | 73.6% | 802,438 | 73.1% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier +0.000203 [-0.000128, +0.000527]; hits (training threshold) +0.1 pts [-1.3, +1.6]; equal-area hits +0.9 pts [-1.3, +2.9]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier +0.000536 [+0.000217, +0.000856]; hits (training threshold) -1.6 pts [-3.3, +0.2]; equal-area hits -1.4 pts [-3.7, +0.8]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier -0.000023 [-0.000282, +0.000219]; hits (training threshold) +0.1 pts [-1.3, +1.6]; equal-area hits +0.0 pts [-1.4, +1.4]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier +0.000310 [+0.000062, +0.000552]; hits (training threshold) -1.6 pts [-3.3, +0.2]; equal-area hits -2.3 pts [-4.0, -0.5]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000333 [-0.000437, -0.000240]; hits (training threshold) +1.7 pts [+0.9, +2.6]; equal-area hits +2.3 pts [+1.4, +3.1]
- hrrr_rrfs_gbt_minus_hrrr: Brier -0.000466 [-0.000892, -0.000059]; hits (training threshold) +4.3 pts [+2.2, +6.3]; equal-area hits +4.6 pts [+1.9, +7.3]

## all_blocks / florida_gulf_south: 92 dates, 31 report days, 1133 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01438 | -0.163 | 3.43 | 78.6% | 62,337 | 78.6% |
| hrrr_rrfs | 0.01385 | -0.121 | 2.96 | 77.1% | 48,316 | 83.6% |
| hrrr_rrfs_smooth | 0.01348 | -0.090 | 3.10 | 82.2% | 51,366 | 89.0% |
| hrrr_rrfs_gbt | 0.01496 | -0.211 | 4.02 | 71.4% | 36,037 | 82.0% |
| hrrr_rrfs_gbt_raw | 0.01355 | -0.097 | 2.36 | 71.4% | 36,037 | 80.6% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier +0.001110 [+0.000099, +0.002034]; hits (training threshold) -5.7 pts [-13.5, -0.6]; equal-area hits -1.6 pts [-9.4, +4.1]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier +0.001485 [+0.000610, +0.002278]; hits (training threshold) -10.8 pts [-21.4, -2.8]; equal-area hits -7.0 pts [-17.9, +1.7]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier -0.000297 [-0.001077, +0.000422]; hits (training threshold) -5.7 pts [-13.5, -0.6]; equal-area hits -3.0 pts [-11.3, +2.7]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier +0.000078 [-0.000627, +0.000820]; hits (training threshold) -10.8 pts [-21.4, -2.8]; equal-area hits -8.4 pts [-19.5, +0.2]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000375 [-0.000783, +0.000063]; hits (training threshold) +5.0 pts [-0.4, +12.4]; equal-area hits +5.4 pts [+0.2, +12.6]
- hrrr_rrfs_gbt_minus_hrrr: Brier +0.000585 [-0.000063, +0.001312]; hits (training threshold) -7.1 pts [-17.5, +0.4]; equal-area hits +3.4 pts [-6.9, +13.2]

## jul2023 / national: 30 dates, 30 report days, 42961 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.03291 | 0.085 | 0.65 | 59.2% | 1,092,525 | 59.2% |
| hrrr_rrfs | 0.03181 | 0.116 | 0.66 | 63.8% | 1,088,205 | 63.9% |
| hrrr_rrfs_smooth | 0.03145 | 0.126 | 0.66 | 65.7% | 1,027,522 | 67.4% |
| hrrr_rrfs_gbt | 0.03230 | 0.103 | 1.44 | 64.5% | 1,082,970 | 64.7% |
| hrrr_rrfs_gbt_raw | 0.03215 | 0.107 | 0.64 | 64.5% | 1,082,970 | 64.7% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier +0.000484 [-0.000213, +0.001214]; hits (training threshold) +0.7 pts [-1.2, +2.7]; equal-area hits +0.8 pts [-1.1, +2.8]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier +0.000845 [+0.000131, +0.001557]; hits (training threshold) -1.2 pts [-3.7, +1.8]; equal-area hits -2.7 pts [-5.1, +0.1]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier +0.000340 [-0.000046, +0.000740]; hits (training threshold) +0.7 pts [-1.2, +2.7]; equal-area hits +0.8 pts [-1.1, +2.8]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier +0.000702 [+0.000315, +0.001098]; hits (training threshold) -1.2 pts [-3.7, +1.8]; equal-area hits -2.7 pts [-5.1, +0.1]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000362 [-0.000545, -0.000195]; hits (training threshold) +1.9 pts [+0.3, +3.3]; equal-area hits +3.5 pts [+1.9, +5.0]
- hrrr_rrfs_gbt_minus_hrrr: Brier -0.000614 [-0.001540, +0.000316]; hits (training threshold) +5.3 pts [+1.9, +8.6]; equal-area hits +5.5 pts [+2.2, +8.8]

## jul2023 / florida_gulf_south: 30 dates, 16 report days, 407 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01857 | -0.377 | 4.86 | 73.0% | 118,778 | 73.0% |
| hrrr_rrfs | 0.01639 | -0.215 | 3.51 | 69.3% | 79,425 | 86.2% |
| hrrr_rrfs_smooth | 0.01562 | -0.158 | 3.73 | 67.8% | 84,202 | 83.0% |
| hrrr_rrfs_gbt | 0.01900 | -0.409 | 4.71 | 52.1% | 39,818 | 82.1% |
| hrrr_rrfs_gbt_raw | 0.01442 | -0.069 | 1.86 | 52.1% | 39,818 | 82.1% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier +0.002609 [+0.001144, +0.003992]; hits (training threshold) -17.2 pts [-32.5, -7.1]; equal-area hits -4.2 pts [-17.6, +6.4]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier +0.003385 [+0.002094, +0.004716]; hits (training threshold) -15.7 pts [-35.0, -0.8]; equal-area hits -1.0 pts [-21.1, +16.9]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier -0.001973 [-0.003590, -0.000711]; hits (training threshold) -17.2 pts [-32.5, -7.1]; equal-area hits -4.2 pts [-17.6, +6.4]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier -0.001197 [-0.002430, -0.000207]; hits (training threshold) -15.7 pts [-35.0, -0.8]; equal-area hits -1.0 pts [-21.1, +16.9]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000776 [-0.001377, -0.000137]; hits (training threshold) -1.5 pts [-9.5, +5.9]; equal-area hits -3.2 pts [-12.3, +5.2]
- hrrr_rrfs_gbt_minus_hrrr: Brier +0.000430 [-0.001034, +0.001858]; hits (training threshold) -20.9 pts [-41.9, -5.6]; equal-area hits +9.1 pts [-6.3, +27.9]

## janfeb2024 / national: 32 dates, 11 report days, 3741 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00270 | 0.302 | 1.40 | 72.7% | 138,192 | 72.7% |
| hrrr_rrfs | 0.00246 | 0.364 | 1.44 | 83.5% | 158,456 | 81.5% |
| hrrr_rrfs_smooth | 0.00244 | 0.367 | 1.45 | 85.2% | 142,031 | 84.9% |
| hrrr_rrfs_gbt | 0.00244 | 0.369 | 1.68 | 72.4% | 118,294 | 75.8% |
| hrrr_rrfs_gbt_raw | 0.00238 | 0.383 | 1.07 | 72.4% | 118,294 | 75.8% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier -0.000019 [-0.000186, +0.000089]; hits (training threshold) -11.2 pts [-29.4, -1.3]; equal-area hits -5.8 pts [-18.4, +4.4]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier -0.000006 [-0.000188, +0.000114]; hits (training threshold) -12.8 pts [-32.0, -3.6]; equal-area hits -9.2 pts [-23.5, -0.2]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier -0.000073 [-0.000298, +0.000064]; hits (training threshold) -11.2 pts [-29.4, -1.3]; equal-area hits -5.8 pts [-18.4, +4.4]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier -0.000060 [-0.000303, +0.000087]; hits (training threshold) -12.8 pts [-32.0, -3.6]; equal-area hits -9.2 pts [-23.5, -0.2]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000013 [-0.000032, +0.000008]; hits (training threshold) +1.7 pts [+0.5, +5.6]; equal-area hits +3.4 pts [+2.1, +7.6]
- hrrr_rrfs_gbt_minus_hrrr: Brier -0.000258 [-0.000812, +0.000047]; hits (training threshold) -0.3 pts [-13.9, +6.1]; equal-area hits +3.1 pts [-5.8, +9.4]

## janfeb2024 / florida_gulf_south: 32 dates, 3 report days, 218 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00639 | 0.145 | 2.68 | 100.0% | 23,196 | 100.0% |
| hrrr_rrfs | 0.00570 | 0.238 | 2.52 | 100.0% | 20,482 | 100.0% |
| hrrr_rrfs_smooth | 0.00567 | 0.242 | 2.59 | 100.0% | 19,223 | 100.0% |
| hrrr_rrfs_gbt | 0.00648 | 0.132 | 3.17 | 100.0% | 18,984 | 100.0% |
| hrrr_rrfs_gbt_raw | 0.00660 | 0.117 | 2.74 | 100.0% | 18,984 | 100.0% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier +0.000788 [+0.000300, +0.001425]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier +0.000816 [+0.000306, +0.001483]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier +0.000901 [+0.000158, +0.001955]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier +0.000930 [+0.000157, +0.002029]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000028 [-0.000137, +0.000101]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_gbt_minus_hrrr: Brier +0.000095 [-0.000466, +0.000689]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]

## may2024 / national: 30 dates, 30 report days, 32498 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02381 | 0.124 | 1.21 | 82.3% | 1,163,835 | 82.3% |
| hrrr_rrfs | 0.02311 | 0.150 | 1.25 | 85.1% | 1,180,425 | 84.9% |
| hrrr_rrfs_smooth | 0.02247 | 0.174 | 1.25 | 86.7% | 1,214,265 | 85.7% |
| hrrr_rrfs_gbt | 0.02327 | 0.144 | 1.65 | 85.8% | 1,251,660 | 83.9% |
| hrrr_rrfs_gbt_raw | 0.02278 | 0.162 | 1.12 | 85.8% | 1,251,660 | 83.9% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier +0.000158 [-0.000578, +0.000832]; hits (training threshold) +0.7 pts [-1.2, +2.7]; equal-area hits -1.0 pts [-2.9, +0.9]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier +0.000804 [+0.000104, +0.001433]; hits (training threshold) -0.9 pts [-2.8, +1.3]; equal-area hits -1.8 pts [-3.8, +0.4]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier -0.000332 [-0.000977, +0.000224]; hits (training threshold) +0.7 pts [-1.2, +2.7]; equal-area hits -1.0 pts [-2.9, +0.9]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier +0.000314 [-0.000299, +0.000866]; hits (training threshold) -0.9 pts [-2.8, +1.3]; equal-area hits -1.8 pts [-3.8, +0.4]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000646 [-0.000848, -0.000466]; hits (training threshold) +1.6 pts [+0.9, +2.1]; equal-area hits +0.8 pts [+0.1, +1.4]
- hrrr_rrfs_gbt_minus_hrrr: Brier -0.000540 [-0.001346, +0.000151]; hits (training threshold) +3.5 pts [+1.3, +6.0]; equal-area hits +1.6 pts [-0.6, +3.9]

## may2024 / florida_gulf_south: 30 dates, 12 report days, 508 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01870 | -0.114 | 2.60 | 73.8% | 47,648 | 73.8% |
| hrrr_rrfs | 0.02001 | -0.192 | 2.70 | 73.6% | 46,898 | 74.0% |
| hrrr_rrfs_smooth | 0.01966 | -0.171 | 2.83 | 86.0% | 52,815 | 78.7% |
| hrrr_rrfs_gbt | 0.01996 | -0.189 | 3.84 | 74.6% | 50,445 | 74.2% |
| hrrr_rrfs_gbt_raw | 0.02011 | -0.198 | 2.60 | 74.6% | 50,445 | 74.2% |

- hrrr_rrfs_gbt_minus_hrrr_rrfs: Brier -0.000046 [-0.002834, +0.002105]; hits (training threshold) +1.0 pts [-4.5, +7.2]; equal-area hits +0.2 pts [-5.4, +6.4]
- hrrr_rrfs_gbt_minus_hrrr_rrfs_smooth: Brier +0.000298 [-0.001934, +0.001983]; hits (training threshold) -11.4 pts [-24.0, +0.9]; equal-area hits -4.5 pts [-15.2, +10.0]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs: Brier +0.000100 [-0.001144, +0.001176]; hits (training threshold) +1.0 pts [-4.5, +7.2]; equal-area hits +0.2 pts [-5.4, +6.4]
- hrrr_rrfs_gbt_raw_minus_hrrr_rrfs_smooth: Brier +0.000443 [-0.001043, +0.001839]; hits (training threshold) -11.4 pts [-24.0, +0.9]; equal-area hits -4.5 pts [-15.2, +10.0]
- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000344 [-0.001373, +0.000779]; hits (training threshold) +12.4 pts [+3.0, +22.8]; equal-area hits +4.7 pts [-5.0, +12.8]
- hrrr_rrfs_gbt_minus_hrrr: Brier +0.001262 [-0.000262, +0.002612]; hits (training threshold) +0.8 pts [-9.0, +10.5]; equal-area hits +0.4 pts [-9.7, +10.4]

