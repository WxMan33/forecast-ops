# Retrospective RRFS pilot scorecard (12z RRFS, Day 2 damaging wind)

Scored dates: 92; dropped: 0. Rules: `research/severe/conus-v1/rrfs/retro/ABLATION.md`.

## Cost of dropping each group (drop-one minus full HRRR + RRFS; positive Brier / negative hits = the group helps)

| Scope | Region | Group | Brier | Hits, training threshold (pts) | Hits, equal area, diagnostic (pts) | Fcst/obs |
|---|---|---|---|---|---|---|
| all_blocks | national | gust | +0.000169 [+0.000045, +0.000289] | -0.5 [-1.2, +0.4] | -0.3 [-1.0, +0.5] | 0.93 (full 0.94) |
| all_blocks | national | refl | +0.000092 [+0.000058, +0.000128] | -0.7 [-1.1, -0.4] | -0.6 [-0.9, -0.3] | 0.94 (full 0.94) |
| all_blocks | national | updraft | +0.000093 [+0.000040, +0.000153] | -0.4 [-0.8, -0.0] | -0.4 [-0.8, -0.0] | 0.94 (full 0.94) |
| all_blocks | national | env | +0.000082 [-0.000039, +0.000221] | +0.4 [-0.1, +1.0] | +0.2 [-0.3, +0.8] | 0.93 (full 0.94) |
| all_blocks | florida_gulf_south | gust | +0.000553 [+0.000090, +0.001033] | +0.0 [-3.2, +3.2] | -3.4 [-7.2, -0.8] | 3.28 (full 2.96) |
| all_blocks | florida_gulf_south | refl | +0.000265 [+0.000132, +0.000415] | -0.2 [-1.8, +1.3] | +0.1 [-1.1, +1.1] | 2.99 (full 2.96) |
| all_blocks | florida_gulf_south | updraft | +0.000444 [+0.000168, +0.000739] | +0.9 [-0.8, +3.1] | -0.8 [-2.8, +1.0] | 3.11 (full 2.96) |
| all_blocks | florida_gulf_south | env | +0.000346 [+0.000034, +0.000645] | +1.1 [-0.9, +3.6] | -1.0 [-3.8, +1.4] | 3.18 (full 2.96) |
| jul2023 | national | gust | +0.000272 [+0.000052, +0.000546] | -0.0 [-1.3, +1.2] | -0.8 [-2.1, +0.5] | 0.66 (full 0.66) |
| jul2023 | national | refl | +0.000106 [+0.000058, +0.000157] | -1.5 [-1.9, -1.1] | -0.1 [-0.4, +0.3] | 0.63 (full 0.66) |
| jul2023 | national | updraft | +0.000157 [+0.000050, +0.000293] | -0.6 [-1.1, +0.0] | -0.3 [-0.9, +0.3] | 0.65 (full 0.66) |
| jul2023 | national | env | +0.000236 [+0.000061, +0.000407] | +0.6 [-0.2, +1.5] | -0.7 [-1.5, +0.2] | 0.69 (full 0.66) |
| jul2023 | florida_gulf_south | gust | +0.000302 [-0.000711, +0.001033] | -1.5 [-8.4, +4.2] | -9.1 [-18.9, -2.3] | 3.99 (full 3.54) |
| jul2023 | florida_gulf_south | refl | +0.000349 [+0.000204, +0.000512] | -0.5 [-3.8, +2.3] | -1.0 [-3.7, +0.8] | 3.62 (full 3.54) |
| jul2023 | florida_gulf_south | updraft | +0.001356 [+0.000825, +0.001938] | +2.9 [-1.2, +7.6] | -2.7 [-7.7, +0.5] | 3.96 (full 3.54) |
| jul2023 | florida_gulf_south | env | +0.001474 [+0.000756, +0.002056] | +2.2 [-1.4, +6.8] | -4.4 [-11.7, +0.3] | 4.27 (full 3.54) |
| janfeb2024 | national | gust | +0.000112 [+0.000002, +0.000320] | -3.7 [-6.9, -2.0] | -2.1 [-5.2, +0.1] | 1.30 (full 1.44) |
| janfeb2024 | national | refl | +0.000035 [-0.000002, +0.000104] | -1.3 [-1.9, +0.5] | -1.5 [-2.0, +0.3] | 1.42 (full 1.44) |
| janfeb2024 | national | updraft | +0.000024 [-0.000004, +0.000069] | +0.4 [-0.5, +3.2] | -0.6 [-1.6, +2.5] | 1.46 (full 1.44) |
| janfeb2024 | national | env | +0.000021 [+0.000002, +0.000046] | -0.9 [-2.1, +1.8] | -0.9 [-2.1, +1.6] | 1.42 (full 1.44) |
| janfeb2024 | florida_gulf_south | gust | +0.000631 [+0.000154, +0.001368] | +0.0 [+nan, +nan] | +0.0 [+nan, +nan] | 2.83 (full 2.52) |
| janfeb2024 | florida_gulf_south | refl | +0.000022 [-0.000081, +0.000119] | +0.0 [+nan, +nan] | +0.0 [+nan, +nan] | 2.41 (full 2.52) |
| janfeb2024 | florida_gulf_south | updraft | +0.000129 [+0.000036, +0.000256] | +0.0 [+nan, +nan] | +0.0 [+nan, +nan] | 2.51 (full 2.52) |
| janfeb2024 | florida_gulf_south | env | -0.000043 [-0.000124, +0.000023] | +0.0 [+nan, +nan] | +0.0 [+nan, +nan] | 2.40 (full 2.52) |
| may2024 | national | gust | +0.000127 [-0.000096, +0.000364] | -0.7 [-1.5, -0.0] | -0.2 [-0.9, +0.5] | 1.23 (full 1.25) |
| may2024 | national | refl | +0.000138 [+0.000075, +0.000214] | +0.3 [+0.0, +0.6] | -0.2 [-0.6, +0.0] | 1.29 (full 1.25) |
| may2024 | national | updraft | +0.000102 [-0.000008, +0.000218] | -0.3 [-0.8, +0.2] | -0.4 [-1.1, +0.1] | 1.26 (full 1.25) |
| may2024 | national | env | -0.000006 [-0.000310, +0.000347] | +0.4 [-0.4, +1.3] | +0.8 [-0.0, +1.8] | 1.20 (full 1.25) |
| may2024 | florida_gulf_south | gust | +0.000722 [-0.000216, +0.001624] | +1.2 [-2.8, +6.8] | -1.2 [-5.4, +3.6] | 2.90 (full 2.70) |
| may2024 | florida_gulf_south | refl | +0.000441 [+0.000117, +0.000867] | +0.0 [-2.4, +2.2] | +0.8 [-1.2, +2.9] | 2.74 (full 2.70) |
| may2024 | florida_gulf_south | updraft | -0.000131 [-0.000652, +0.000425] | -0.4 [-2.4, +1.3] | +0.2 [-1.0, +1.5] | 2.69 (full 2.70) |
| may2024 | florida_gulf_south | env | -0.000367 [-0.000875, +0.000088] | +0.8 [-3.0, +4.7] | +1.0 [-3.3, +5.8] | 2.65 (full 2.70) |

## all_blocks / national: 92 dates, 71 report days, 79200 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01944 | 0.103 | 0.92 | 69.3% | 783,240 | 69.3% |
| hrrr_rrfs | 0.01877 | 0.134 | 0.94 | 73.5% | 794,920 | 73.0% |
| hrrr_rrfs_no_gust | 0.01894 | 0.126 | 0.93 | 73.0% | 789,415 | 72.8% |
| hrrr_rrfs_no_refl | 0.01886 | 0.130 | 0.94 | 72.7% | 789,356 | 72.4% |
| hrrr_rrfs_no_updraft | 0.01886 | 0.130 | 0.94 | 73.0% | 794,306 | 72.6% |
| hrrr_rrfs_no_env | 0.01885 | 0.130 | 0.93 | 73.9% | 800,327 | 73.3% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000169 [+0.000045, +0.000289]; hits (training threshold) -0.5 pts [-1.2, +0.4]; equal-area hits -0.3 pts [-1.0, +0.5]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000092 [+0.000058, +0.000128]; hits (training threshold) -0.7 pts [-1.1, -0.4]; equal-area hits -0.6 pts [-0.9, -0.3]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier +0.000093 [+0.000040, +0.000153]; hits (training threshold) -0.4 pts [-0.8, -0.0]; equal-area hits -0.4 pts [-0.8, -0.0]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier +0.000082 [-0.000039, +0.000221]; hits (training threshold) +0.4 pts [-0.1, +1.0]; equal-area hits +0.2 pts [-0.3, +0.8]
- hrrr_rrfs_minus_hrrr: Brier -0.000670 [-0.000936, -0.000422]; hits (training threshold) +4.2 pts [+2.6, +5.7]; equal-area hits +3.8 pts [+2.2, +5.3]

## all_blocks / florida_gulf_south: 92 dates, 31 report days, 1133 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01441 | -0.166 | 3.44 | 78.6% | 62,540 | 78.6% |
| hrrr_rrfs | 0.01387 | -0.122 | 2.96 | 77.1% | 48,446 | 84.0% |
| hrrr_rrfs_no_gust | 0.01442 | -0.167 | 3.28 | 77.1% | 55,450 | 80.7% |
| hrrr_rrfs_no_refl | 0.01413 | -0.143 | 2.99 | 76.9% | 49,008 | 84.1% |
| hrrr_rrfs_no_updraft | 0.01431 | -0.158 | 3.11 | 77.9% | 51,197 | 83.2% |
| hrrr_rrfs_no_env | 0.01421 | -0.150 | 3.18 | 78.2% | 52,665 | 83.1% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000553 [+0.000090, +0.001033]; hits (training threshold) +0.0 pts [-3.2, +3.2]; equal-area hits -3.4 pts [-7.2, -0.8]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000265 [+0.000132, +0.000415]; hits (training threshold) -0.2 pts [-1.8, +1.3]; equal-area hits +0.1 pts [-1.1, +1.1]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier +0.000444 [+0.000168, +0.000739]; hits (training threshold) +0.9 pts [-0.8, +3.1]; equal-area hits -0.8 pts [-2.8, +1.0]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier +0.000346 [+0.000034, +0.000645]; hits (training threshold) +1.1 pts [-0.9, +3.6]; equal-area hits -1.0 pts [-3.8, +1.4]
- hrrr_rrfs_minus_hrrr: Brier -0.000549 [-0.001273, +0.000263]; hits (training threshold) -1.5 pts [-7.8, +3.2]; equal-area hits +5.5 pts [+0.4, +11.8]

## jul2023 / national: 30 dates, 30 report days, 42961 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.03292 | 0.085 | 0.65 | 59.1% | 1,091,460 | 59.1% |
| hrrr_rrfs | 0.03182 | 0.116 | 0.66 | 63.8% | 1,088,775 | 63.8% |
| hrrr_rrfs_no_gust | 0.03209 | 0.108 | 0.66 | 63.8% | 1,120,035 | 63.0% |
| hrrr_rrfs_no_refl | 0.03192 | 0.113 | 0.63 | 62.3% | 1,038,472 | 63.7% |
| hrrr_rrfs_no_updraft | 0.03197 | 0.112 | 0.65 | 63.2% | 1,078,358 | 63.5% |
| hrrr_rrfs_no_env | 0.03205 | 0.109 | 0.69 | 64.4% | 1,138,192 | 63.1% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000272 [+0.000052, +0.000546]; hits (training threshold) -0.0 pts [-1.3, +1.2]; equal-area hits -0.8 pts [-2.1, +0.5]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000106 [+0.000058, +0.000157]; hits (training threshold) -1.5 pts [-1.9, -1.1]; equal-area hits -0.1 pts [-0.4, +0.3]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier +0.000157 [+0.000050, +0.000293]; hits (training threshold) -0.6 pts [-1.1, +0.0]; equal-area hits -0.3 pts [-0.9, +0.3]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier +0.000236 [+0.000061, +0.000407]; hits (training threshold) +0.6 pts [-0.2, +1.5]; equal-area hits -0.7 pts [-1.5, +0.2]
- hrrr_rrfs_minus_hrrr: Brier -0.001103 [-0.001576, -0.000709]; hits (training threshold) +4.7 pts [+2.1, +7.1]; equal-area hits +4.7 pts [+2.2, +7.1]

## jul2023 / florida_gulf_south: 30 dates, 16 report days, 407 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01868 | -0.384 | 4.90 | 73.0% | 119,422 | 73.0% |
| hrrr_rrfs | 0.01643 | -0.218 | 3.54 | 69.0% | 79,875 | 86.2% |
| hrrr_rrfs_no_gust | 0.01673 | -0.240 | 3.99 | 67.6% | 95,078 | 77.1% |
| hrrr_rrfs_no_refl | 0.01678 | -0.244 | 3.62 | 68.6% | 82,440 | 85.3% |
| hrrr_rrfs_no_updraft | 0.01779 | -0.319 | 3.96 | 72.0% | 87,082 | 83.5% |
| hrrr_rrfs_no_env | 0.01791 | -0.327 | 4.27 | 71.3% | 94,928 | 81.8% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000302 [-0.000711, +0.001033]; hits (training threshold) -1.5 pts [-8.4, +4.2]; equal-area hits -9.1 pts [-18.9, -2.3]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000349 [+0.000204, +0.000512]; hits (training threshold) -0.5 pts [-3.8, +2.3]; equal-area hits -1.0 pts [-3.7, +0.8]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier +0.001356 [+0.000825, +0.001938]; hits (training threshold) +2.9 pts [-1.2, +7.6]; equal-area hits -2.7 pts [-7.7, +0.5]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier +0.001474 [+0.000756, +0.002056]; hits (training threshold) +2.2 pts [-1.4, +6.8]; equal-area hits -4.4 pts [-11.7, +0.3]
- hrrr_rrfs_minus_hrrr: Brier -0.002244 [-0.003316, -0.000979]; hits (training threshold) -3.9 pts [-15.8, +4.7]; equal-area hits +13.3 pts [+2.3, +27.1]

## janfeb2024 / national: 32 dates, 11 report days, 3741 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00270 | 0.302 | 1.41 | 72.8% | 138,227 | 72.8% |
| hrrr_rrfs | 0.00246 | 0.364 | 1.44 | 83.4% | 158,302 | 81.4% |
| hrrr_rrfs_no_gust | 0.00257 | 0.335 | 1.30 | 79.7% | 142,868 | 79.3% |
| hrrr_rrfs_no_refl | 0.00249 | 0.355 | 1.42 | 82.1% | 156,403 | 79.9% |
| hrrr_rrfs_no_updraft | 0.00248 | 0.357 | 1.46 | 83.9% | 160,158 | 80.8% |
| hrrr_rrfs_no_env | 0.00248 | 0.358 | 1.42 | 82.5% | 155,025 | 80.5% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000112 [+0.000002, +0.000320]; hits (training threshold) -3.7 pts [-6.9, -2.0]; equal-area hits -2.1 pts [-5.2, +0.1]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000035 [-0.000002, +0.000104]; hits (training threshold) -1.3 pts [-1.9, +0.5]; equal-area hits -1.5 pts [-2.0, +0.3]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier +0.000024 [-0.000004, +0.000069]; hits (training threshold) +0.4 pts [-0.5, +3.2]; equal-area hits -0.6 pts [-1.6, +2.5]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier +0.000021 [+0.000002, +0.000046]; hits (training threshold) -0.9 pts [-2.1, +1.8]; equal-area hits -0.9 pts [-2.1, +1.6]
- hrrr_rrfs_minus_hrrr: Brier -0.000237 [-0.000635, -0.000024]; hits (training threshold) +10.7 pts [+1.4, +19.0]; equal-area hits +8.6 pts [-0.6, +16.7]

## janfeb2024 / florida_gulf_south: 32 dates, 3 report days, 218 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.00639 | 0.145 | 2.68 | 100.0% | 23,196 | 100.0% |
| hrrr_rrfs | 0.00570 | 0.238 | 2.52 | 100.0% | 20,447 | 100.0% |
| hrrr_rrfs_no_gust | 0.00633 | 0.153 | 2.83 | 100.0% | 23,189 | 100.0% |
| hrrr_rrfs_no_refl | 0.00572 | 0.235 | 2.41 | 100.0% | 20,327 | 100.0% |
| hrrr_rrfs_no_updraft | 0.00583 | 0.220 | 2.51 | 100.0% | 21,551 | 100.0% |
| hrrr_rrfs_no_env | 0.00565 | 0.243 | 2.40 | 100.0% | 18,316 | 100.0% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000631 [+0.000154, +0.001368]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000022 [-0.000081, +0.000119]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier +0.000129 [+0.000036, +0.000256]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier -0.000043 [-0.000124, +0.000023]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]
- hrrr_rrfs_minus_hrrr: Brier -0.000692 [-0.001553, -0.000115]; hits (training threshold) +0.0 pts [+nan, +nan]; equal-area hits +0.0 pts [+nan, +nan]

## may2024 / national: 30 dates, 30 report days, 32498 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.02382 | 0.124 | 1.21 | 82.3% | 1,163,032 | 82.3% |
| hrrr_rrfs | 0.02312 | 0.150 | 1.25 | 85.1% | 1,180,125 | 84.9% |
| hrrr_rrfs_no_gust | 0.02324 | 0.145 | 1.23 | 84.4% | 1,148,445 | 84.7% |
| hrrr_rrfs_no_refl | 0.02325 | 0.145 | 1.29 | 85.4% | 1,215,390 | 84.6% |
| hrrr_rrfs_no_updraft | 0.02322 | 0.146 | 1.26 | 84.9% | 1,186,680 | 84.4% |
| hrrr_rrfs_no_env | 0.02311 | 0.150 | 1.20 | 85.5% | 1,150,785 | 85.7% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000127 [-0.000096, +0.000364]; hits (training threshold) -0.7 pts [-1.5, -0.0]; equal-area hits -0.2 pts [-0.9, +0.5]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000138 [+0.000075, +0.000214]; hits (training threshold) +0.3 pts [+0.0, +0.6]; equal-area hits -0.2 pts [-0.6, +0.0]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier +0.000102 [-0.000008, +0.000218]; hits (training threshold) -0.3 pts [-0.8, +0.2]; equal-area hits -0.4 pts [-1.1, +0.1]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier -0.000006 [-0.000310, +0.000347]; hits (training threshold) +0.4 pts [-0.4, +1.3]; equal-area hits +0.8 pts [-0.0, +1.8]
- hrrr_rrfs_minus_hrrr: Brier -0.000699 [-0.001216, -0.000197]; hits (training threshold) +2.8 pts [+1.0, +4.8]; equal-area hits +2.6 pts [+0.7, +4.5]

## may2024 / florida_gulf_south: 30 dates, 12 report days, 508 event points
| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |
|---|---|---|---|---|---|---|
| hrrr | 0.01871 | -0.115 | 2.60 | 73.8% | 47,625 | 73.8% |
| hrrr_rrfs | 0.02001 | -0.192 | 2.70 | 73.6% | 46,882 | 74.0% |
| hrrr_rrfs_no_gust | 0.02073 | -0.235 | 2.90 | 74.8% | 50,235 | 72.8% |
| hrrr_rrfs_no_refl | 0.02045 | -0.219 | 2.74 | 73.6% | 46,170 | 74.8% |
| hrrr_rrfs_no_updraft | 0.01988 | -0.185 | 2.69 | 73.2% | 46,935 | 74.2% |
| hrrr_rrfs_no_env | 0.01965 | -0.170 | 2.65 | 74.4% | 47,040 | 75.0% |

- hrrr_rrfs_no_gust_minus_hrrr_rrfs: Brier +0.000722 [-0.000216, +0.001624]; hits (training threshold) +1.2 pts [-2.8, +6.8]; equal-area hits -1.2 pts [-5.4, +3.6]
- hrrr_rrfs_no_refl_minus_hrrr_rrfs: Brier +0.000441 [+0.000117, +0.000867]; hits (training threshold) +0.0 pts [-2.4, +2.2]; equal-area hits +0.8 pts [-1.2, +2.9]
- hrrr_rrfs_no_updraft_minus_hrrr_rrfs: Brier -0.000131 [-0.000652, +0.000425]; hits (training threshold) -0.4 pts [-2.4, +1.3]; equal-area hits +0.2 pts [-1.0, +1.5]
- hrrr_rrfs_no_env_minus_hrrr_rrfs: Brier -0.000367 [-0.000875, +0.000088]; hits (training threshold) +0.8 pts [-3.0, +4.7]; equal-area hits +1.0 pts [-3.3, +5.8]
- hrrr_rrfs_minus_hrrr: Brier +0.001300 [-0.000300, +0.003145]; hits (training threshold) -0.2 pts [-9.1, +7.7]; equal-area hits +0.2 pts [-8.7, +8.0]

