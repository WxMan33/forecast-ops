# Retrospective RRFS pilot scorecard (12z RRFS, Day 2 damaging wind)

Scored dates: 92; dropped: 0. Rules: `research/severe/conus-v1/rrfs/retro/SMOOTHING.md`.

## all_blocks / national: 92 dates, 71 report days, 79200 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01943 | 0.103 | 0.92 | 69.3% | 783,836 | 69.3% |
| hrrr_rrfs | 0.01877 | 0.134 | 0.94 | 73.5% | 794,886 | 73.1% |
| hrrr_rrfs_smooth | 0.01843 | 0.150 | 0.94 | 75.2% | 780,420 | 75.4% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000333 [-0.000437, -0.000240]; hits (training threshold) +1.7 pts [+0.9, +2.6]; equal-area hits +2.3 pts [+1.4, +3.1]
- hrrr_rrfs_smooth_minus_hrrr: Brier -0.001002 [-0.001295, -0.000727]; hits (training threshold) +5.9 pts [+3.8, +7.8]; equal-area hits +6.0 pts [+3.9, +8.0]
- hrrr_rrfs_minus_hrrr: Brier -0.000669 [-0.000934, -0.000420]; hits (training threshold) +4.1 pts [+2.6, +5.7]; equal-area hits +3.7 pts [+2.2, +5.3]

## all_blocks / florida_gulf_south: 92 dates, 31 report days, 1133 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01438 | -0.163 | 3.43 | 78.6% | 62,337 | 78.6% |
| hrrr_rrfs | 0.01385 | -0.121 | 2.96 | 77.1% | 48,316 | 83.6% |
| hrrr_rrfs_smooth | 0.01348 | -0.090 | 3.10 | 82.2% | 51,366 | 89.0% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000375 [-0.000783, +0.000063]; hits (training threshold) +5.0 pts [-0.4, +12.4]; equal-area hits +5.4 pts [+0.2, +12.6]
- hrrr_rrfs_smooth_minus_hrrr: Brier -0.000900 [-0.001574, -0.000181]; hits (training threshold) +3.6 pts [-4.7, +12.5]; equal-area hits +10.4 pts [+2.8, +19.9]
- hrrr_rrfs_minus_hrrr: Brier -0.000525 [-0.001252, +0.000283]; hits (training threshold) -1.4 pts [-7.6, +3.3]; equal-area hits +5.0 pts [+0.1, +11.0]

## jul2023 / national: 30 dates, 30 report days, 42961 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.03291 | 0.085 | 0.65 | 59.2% | 1,092,525 | 59.2% |
| hrrr_rrfs | 0.03181 | 0.116 | 0.66 | 63.8% | 1,088,205 | 63.9% |
| hrrr_rrfs_smooth | 0.03145 | 0.126 | 0.66 | 65.7% | 1,027,522 | 67.4% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000362 [-0.000545, -0.000195]; hits (training threshold) +1.9 pts [+0.3, +3.3]; equal-area hits +3.5 pts [+1.9, +5.0]
- hrrr_rrfs_smooth_minus_hrrr: Brier -0.001459 [-0.001979, -0.001022]; hits (training threshold) +6.5 pts [+2.8, +9.8]; equal-area hits +8.2 pts [+4.5, +11.6]
- hrrr_rrfs_minus_hrrr: Brier -0.001098 [-0.001574, -0.000703]; hits (training threshold) +4.6 pts [+2.0, +7.0]; equal-area hits +4.7 pts [+2.1, +7.1]

## jul2023 / florida_gulf_south: 30 dates, 16 report days, 407 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01857 | -0.377 | 4.86 | 73.0% | 118,778 | 73.0% |
| hrrr_rrfs | 0.01639 | -0.215 | 3.51 | 69.3% | 79,425 | 86.2% |
| hrrr_rrfs_smooth | 0.01562 | -0.158 | 3.73 | 67.8% | 84,202 | 83.0% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000776 [-0.001377, -0.000137]; hits (training threshold) -1.5 pts [-9.5, +5.9]; equal-area hits -3.2 pts [-12.3, +5.2]
- hrrr_rrfs_smooth_minus_hrrr: Brier -0.002955 [-0.003824, -0.002057]; hits (training threshold) -5.2 pts [-20.8, +5.4]; equal-area hits +10.1 pts [+0.4, +23.3]
- hrrr_rrfs_minus_hrrr: Brier -0.002179 [-0.003248, -0.000911]; hits (training threshold) -3.7 pts [-15.4, +4.8]; equal-area hits +13.3 pts [+2.3, +27.2]

## janfeb2024 / national: 32 dates, 11 report days, 3741 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00270 | 0.302 | 1.40 | 72.7% | 138,192 | 72.7% |
| hrrr_rrfs | 0.00246 | 0.364 | 1.44 | 83.5% | 158,456 | 81.5% |
| hrrr_rrfs_smooth | 0.00244 | 0.367 | 1.45 | 85.2% | 142,031 | 84.9% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000013 [-0.000032, +0.000008]; hits (training threshold) +1.7 pts [+0.5, +5.6]; equal-area hits +3.4 pts [+2.1, +7.6]
- hrrr_rrfs_smooth_minus_hrrr: Brier -0.000251 [-0.000640, -0.000040]; hits (training threshold) +12.5 pts [+5.2, +21.3]; equal-area hits +12.3 pts [+4.8, +21.1]
- hrrr_rrfs_minus_hrrr: Brier -0.000238 [-0.000639, -0.000024]; hits (training threshold) +10.9 pts [+1.4, +19.2]; equal-area hits +8.9 pts [-0.5, +16.9]

## janfeb2024 / florida_gulf_south: 32 dates, 3 report days, 218 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00639 | 0.145 | 2.68 | 100.0% | 23,196 | 100.0% |
| hrrr_rrfs | 0.00570 | 0.238 | 2.52 | 100.0% | 20,482 | 100.0% |
| hrrr_rrfs_smooth | 0.00567 | 0.242 | 2.59 | 100.0% | 19,223 | 100.0% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000028 [-0.000137, +0.000101]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_smooth_minus_hrrr: Brier -0.000722 [-0.001593, -0.000169]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_minus_hrrr: Brier -0.000693 [-0.001556, -0.000116]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]

## may2024 / national: 30 dates, 30 report days, 32498 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02381 | 0.124 | 1.21 | 82.3% | 1,163,835 | 82.3% |
| hrrr_rrfs | 0.02311 | 0.150 | 1.25 | 85.1% | 1,180,425 | 84.9% |
| hrrr_rrfs_smooth | 0.02247 | 0.174 | 1.25 | 86.7% | 1,214,265 | 85.7% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000646 [-0.000848, -0.000466]; hits (training threshold) +1.6 pts [+0.9, +2.1]; equal-area hits +0.8 pts [+0.1, +1.4]
- hrrr_rrfs_smooth_minus_hrrr: Brier -0.001345 [-0.001957, -0.000810]; hits (training threshold) +4.3 pts [+2.5, +6.2]; equal-area hits +3.4 pts [+1.6, +5.3]
- hrrr_rrfs_minus_hrrr: Brier -0.000699 [-0.001216, -0.000197]; hits (training threshold) +2.8 pts [+0.9, +4.8]; equal-area hits +2.6 pts [+0.7, +4.5]

## may2024 / florida_gulf_south: 30 dates, 12 report days, 508 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01870 | -0.114 | 2.60 | 73.8% | 47,648 | 73.8% |
| hrrr_rrfs | 0.02001 | -0.192 | 2.70 | 73.6% | 46,898 | 74.0% |
| hrrr_rrfs_smooth | 0.01966 | -0.171 | 2.83 | 86.0% | 52,815 | 78.7% |

- hrrr_rrfs_smooth_minus_hrrr_rrfs: Brier -0.000344 [-0.001373, +0.000779]; hits (training threshold) +12.4 pts [+3.0, +22.8]; equal-area hits +4.7 pts [-5.0, +12.8]
- hrrr_rrfs_smooth_minus_hrrr: Brier +0.000964 [-0.000409, +0.002536]; hits (training threshold) +12.2 pts [-1.3, +25.5]; equal-area hits +4.9 pts [-13.0, +18.6]
- hrrr_rrfs_minus_hrrr: Brier +0.001307 [-0.000292, +0.003157]; hits (training threshold) -0.2 pts [-9.1, +7.7]; equal-area hits +0.2 pts [-8.7, +8.0]

