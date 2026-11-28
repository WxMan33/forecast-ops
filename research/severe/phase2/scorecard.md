# Phase 2 HRRR scorecard (research only)

Verification: 12 dates in 2024 (2024-01-15, 2024-02-15, 2024-03-15, 2024-04-15, 2024-05-15, 2024-06-15, 2024-07-15, 2024-08-15, 2024-09-15, 2024-10-15, 2024-11-15, 2024-12-15). Every model is scored on the same dates, points and 24-hour windows. Skill is against the 2022+2023 event rate. 2024 was already used to choose between earlier versions, so these results are exploratory; 2025 stays sealed and was not loaded.

v0.7 reproduction: **exact** (largest Brier difference 7.8e-10, largest coefficient difference 3.7e-06).

## Data used

| Split | Dates | Range | Day 1 dates with no report (any hazard) |
|---|---|---|---|
| train | 48 | 2022-01-01 to 2022-12-22 | 18 |
| calibration | 48 | 2023-01-01 to 2023-12-22 | 17 |
| development | 12 | 2024-01-15 to 2024-12-15 | 5 |

| Product | Train 2022 event dates / points | Calibration 2023 | Verification 2024 |
|---|---|---|---|
| day1_tornado | 15 / 1480 | 16 / 1316 | 6 / 751 |
| day1_wind | 28 / 13571 | 28 / 15055 | 7 / 4569 |
| day1_hail | 24 / 5242 | 27 / 6582 | 6 / 1924 |
| day2_tornado | 15 / 1094 | 21 / 2005 | 4 / 468 |
| day2_wind | 28 / 13670 | 28 / 15178 | 7 / 4063 |
| day2_hail | 23 / 3950 | 28 / 7690 | 7 / 1174 |

## Headline (all samples, 2024)

| Product | Event dates / points | v0.7 BSS | P2 logistic BSS | P2 trees BSS | P2 logistic AP | P2 trees AP | v0.7 AP | Paired date bootstrap: P2 logistic minus v0.7 Brier (95%) |
|---|---|---|---|---|---|---|---|---|
| day1_tornado | 6 / 751 | +0.050 | +0.043 | +0.026 | 0.083 | 0.055 | 0.135 | -4.02e-05 to +1.06e-04 (better on 6 of 12 dates) |
| day1_wind | 7 / 4569 | +0.230 | +0.213 | +0.195 | 0.350 | 0.376 | 0.394 | -1.61e-04 to +9.85e-04 (better on 5 of 12 dates) |
| day1_hail | 6 / 1924 | +0.008 | -0.032 | +0.023 | 0.095 | 0.092 | 0.070 | -6.71e-04 to +1.88e-03 (better on 8 of 12 dates) |
| day2_tornado | 4 / 468 | -0.009 | +0.080 | +0.084 | 0.115 | 0.139 | 0.044 | -4.69e-04 to -1.63e-05 (better on 8 of 12 dates) |
| day2_wind | 7 / 4063 | +0.054 | +0.083 | +0.080 | 0.199 | 0.171 | 0.184 | -1.22e-03 to -2.98e-05 (better on 9 of 12 dates) |
| day2_hail | 7 / 1174 | -0.015 | +0.075 | +0.067 | 0.152 | 0.147 | 0.112 | -1.45e-03 to +3.95e-05 (better on 9 of 12 dates) |

BSS = Brier skill vs 2022+2023 climatology (positive is better). AP = average precision (area under the precision-recall curve; climatology AP equals the event rate).

## Land only and by region (BSS)

| Product | Subset | Event dates / points | v0.7 | P2 logistic | P2 trees |
|---|---|---|---|---|---|
| day1_tornado | land | 6 / 751 | +0.060 | +0.049 | +0.027 |
| day1_tornado | southwest | 2 / 46 | -0.047 | -0.080 | -0.038 |
| day1_tornado | northwest | 4 / 508 | +0.087 | +0.067 | +0.037 |
| day1_tornado | southeast | 1 / 24 | +0.006 | -0.015 | -0.018 |
| day1_tornado | northeast | 1 / 173 | +0.017 | +0.036 | +0.021 |
| day1_wind | land | 7 / 4569 | +0.237 | +0.222 | +0.199 |
| day1_wind | southwest | 5 / 740 | +0.095 | +0.029 | +0.058 |
| day1_wind | northwest | 5 / 1776 | +0.389 | +0.367 | +0.285 |
| day1_wind | southeast | 5 / 817 | +0.081 | +0.083 | +0.098 |
| day1_wind | northeast | 2 / 1236 | +0.210 | +0.222 | +0.228 |
| day1_hail | land | 6 / 1924 | +0.011 | -0.030 | +0.024 |
| day1_hail | southwest | 5 / 496 | +0.023 | -0.019 | +0.047 |
| day1_hail | northwest | 5 / 480 | -0.024 | -0.283 | -0.095 |
| day1_hail | southeast | 4 / 386 | +0.035 | +0.102 | +0.076 |
| day1_hail | northeast | 2 / 562 | +0.015 | +0.084 | +0.071 |
| day2_tornado | land | 4 / 468 | -0.008 | +0.081 | +0.086 |
| day2_tornado | southwest | 1 / 30 | -0.673 | -0.128 | -0.306 |
| day2_tornado | northwest | 2 / 370 | +0.043 | +0.108 | +0.131 |
| day2_tornado | southeast | 1 / 23 | +0.035 | +0.063 | +0.042 |
| day2_tornado | northeast | 1 / 45 | +0.001 | +0.005 | -0.003 |
| day2_wind | land | 7 / 4063 | +0.057 | +0.085 | +0.081 |
| day2_wind | southwest | 5 / 1378 | +0.139 | +0.150 | +0.142 |
| day2_wind | northwest | 5 / 1253 | -0.038 | +0.035 | +0.052 |
| day2_wind | southeast | 5 / 668 | +0.034 | +0.037 | +0.052 |
| day2_wind | northeast | 4 / 764 | +0.085 | +0.090 | +0.044 |
| day2_hail | land | 7 / 1174 | -0.013 | +0.075 | +0.067 |
| day2_hail | southwest | 5 / 417 | -0.153 | +0.027 | +0.048 |
| day2_hail | northwest | 5 / 583 | +0.084 | +0.121 | +0.089 |
| day2_hail | southeast | 1 / 21 | -0.129 | -0.014 | -0.187 |
| day2_hail | northeast | 3 / 153 | +0.015 | +0.044 | +0.076 |

## Hits, misses and false alarms at practical thresholds (all samples, points)

| Product | Threshold | Model | Hits | Misses | False alarms | POD | FAR | CSI |
|---|---|---|---|---|---|---|---|---|
| day1_tornado | 2% | v0.7 | 320 | 431 | 2244 | 0.43 | 0.88 | 0.107 |
| day1_tornado | 5% | v0.7 | 126 | 625 | 441 | 0.17 | 0.78 | 0.106 |
| day1_tornado | 10% | v0.7 | 52 | 699 | 112 | 0.07 | 0.68 | 0.060 |
| day1_tornado | 2% | P2 logistic | 455 | 296 | 5178 | 0.61 | 0.92 | 0.077 |
| day1_tornado | 5% | P2 logistic | 199 | 552 | 1640 | 0.26 | 0.89 | 0.083 |
| day1_tornado | 10% | P2 logistic | 33 | 718 | 316 | 0.04 | 0.91 | 0.031 |
| day1_tornado | 2% | P2 trees | 287 | 464 | 3835 | 0.38 | 0.93 | 0.063 |
| day1_tornado | 5% | P2 trees | 67 | 684 | 586 | 0.09 | 0.90 | 0.050 |
| day1_tornado | 10% | P2 trees | 14 | 737 | 121 | 0.02 | 0.90 | 0.016 |
| day1_wind | 5% | v0.7 | 3812 | 757 | 18850 | 0.83 | 0.83 | 0.163 |
| day1_wind | 15% | v0.7 | 2389 | 2180 | 4363 | 0.52 | 0.65 | 0.267 |
| day1_wind | 30% | v0.7 | 1169 | 3400 | 1088 | 0.26 | 0.48 | 0.207 |
| day1_wind | 5% | P2 logistic | 3833 | 736 | 18988 | 0.84 | 0.83 | 0.163 |
| day1_wind | 15% | P2 logistic | 2743 | 1826 | 6963 | 0.60 | 0.72 | 0.238 |
| day1_wind | 30% | P2 logistic | 1409 | 3160 | 1907 | 0.31 | 0.58 | 0.218 |
| day1_wind | 5% | P2 trees | 4146 | 423 | 23978 | 0.91 | 0.85 | 0.145 |
| day1_wind | 15% | P2 trees | 2098 | 2471 | 4262 | 0.46 | 0.67 | 0.238 |
| day1_wind | 30% | P2 trees | 642 | 3927 | 391 | 0.14 | 0.38 | 0.129 |
| day1_hail | 5% | v0.7 | 587 | 1337 | 8032 | 0.31 | 0.93 | 0.059 |
| day1_hail | 15% | v0.7 | 181 | 1743 | 1241 | 0.09 | 0.87 | 0.057 |
| day1_hail | 30% | v0.7 | 60 | 1864 | 349 | 0.03 | 0.85 | 0.026 |
| day1_hail | 5% | P2 logistic | 1099 | 825 | 9853 | 0.57 | 0.90 | 0.093 |
| day1_hail | 15% | P2 logistic | 423 | 1501 | 3304 | 0.22 | 0.89 | 0.081 |
| day1_hail | 30% | P2 logistic | 122 | 1802 | 921 | 0.06 | 0.88 | 0.043 |
| day1_hail | 5% | P2 trees | 1000 | 924 | 9910 | 0.52 | 0.91 | 0.085 |
| day1_hail | 15% | P2 trees | 342 | 1582 | 2372 | 0.18 | 0.87 | 0.080 |
| day1_hail | 30% | P2 trees | 100 | 1824 | 525 | 0.05 | 0.84 | 0.041 |
| day2_tornado | 2% | v0.7 | 277 | 191 | 4957 | 0.59 | 0.95 | 0.051 |
| day2_tornado | 5% | v0.7 | 113 | 355 | 1741 | 0.24 | 0.94 | 0.051 |
| day2_tornado | 10% | v0.7 | 14 | 454 | 723 | 0.03 | 0.98 | 0.012 |
| day2_tornado | 2% | P2 logistic | 392 | 76 | 4815 | 0.84 | 0.92 | 0.074 |
| day2_tornado | 5% | P2 logistic | 298 | 170 | 1920 | 0.64 | 0.87 | 0.125 |
| day2_tornado | 10% | P2 logistic | 124 | 344 | 689 | 0.26 | 0.85 | 0.107 |
| day2_tornado | 2% | P2 trees | 380 | 88 | 7986 | 0.81 | 0.95 | 0.045 |
| day2_tornado | 5% | P2 trees | 255 | 213 | 2719 | 0.54 | 0.91 | 0.080 |
| day2_tornado | 10% | P2 trees | 206 | 262 | 946 | 0.44 | 0.82 | 0.146 |
| day2_wind | 5% | v0.7 | 2863 | 1200 | 20365 | 0.70 | 0.88 | 0.117 |
| day2_wind | 15% | v0.7 | 1408 | 2655 | 5585 | 0.35 | 0.80 | 0.146 |
| day2_wind | 30% | v0.7 | 660 | 3403 | 1895 | 0.16 | 0.74 | 0.111 |
| day2_wind | 5% | P2 logistic | 3010 | 1053 | 22833 | 0.74 | 0.88 | 0.112 |
| day2_wind | 15% | P2 logistic | 1516 | 2547 | 7430 | 0.37 | 0.83 | 0.132 |
| day2_wind | 30% | P2 logistic | 897 | 3166 | 1885 | 0.22 | 0.68 | 0.151 |
| day2_wind | 5% | P2 trees | 3300 | 763 | 27349 | 0.81 | 0.89 | 0.105 |
| day2_wind | 15% | P2 trees | 1719 | 2344 | 8361 | 0.42 | 0.83 | 0.138 |
| day2_wind | 30% | P2 trees | 669 | 3394 | 1758 | 0.16 | 0.72 | 0.115 |
| day2_hail | 5% | v0.7 | 730 | 444 | 7688 | 0.62 | 0.91 | 0.082 |
| day2_hail | 15% | v0.7 | 356 | 818 | 1773 | 0.30 | 0.83 | 0.121 |
| day2_hail | 30% | v0.7 | 181 | 993 | 730 | 0.15 | 0.80 | 0.095 |
| day2_hail | 5% | P2 logistic | 820 | 354 | 8197 | 0.70 | 0.91 | 0.088 |
| day2_hail | 15% | P2 logistic | 458 | 716 | 1862 | 0.39 | 0.80 | 0.151 |
| day2_hail | 30% | P2 logistic | 137 | 1037 | 406 | 0.12 | 0.75 | 0.087 |
| day2_hail | 5% | P2 trees | 856 | 318 | 9680 | 0.73 | 0.92 | 0.079 |
| day2_hail | 15% | P2 trees | 421 | 753 | 1730 | 0.36 | 0.80 | 0.145 |
| day2_hail | 30% | P2 trees | 154 | 1020 | 435 | 0.13 | 0.74 | 0.096 |

## Reliability (all samples)

| Product | Model | Bin | Points | Dates | Mean forecast | Observed |
|---|---|---|---|---|---|---|
| day1_tornado | v0.7 | 0.0%-0.1% | 152652 | 12 | 0.0003 | 0.0000 |
| day1_tornado | v0.7 | 0.1%-1.0% | 38817 | 12 | 0.0028 | 0.0075 |
| day1_tornado | v0.7 | 1.0%-2.0% | 2923 | 8 | 0.0138 | 0.0476 |
| day1_tornado | v0.7 | 2.0%-5.0% | 1997 | 8 | 0.0306 | 0.0971 |
| day1_tornado | v0.7 | 5.0%-10.0% | 403 | 8 | 0.0652 | 0.1836 |
| day1_tornado | v0.7 | 10.0%-15.0% | 53 | 4 | 0.1210 | 0.2642 |
| day1_tornado | v0.7 | 15.0%-30.0% | 57 | 4 | 0.2132 | 0.2456 |
| day1_tornado | v0.7 | 30.0%-100.0% | 54 | 3 | 0.4292 | 0.4444 |
| day1_tornado | P2 logistic | 0.0%-0.1% | 169744 | 12 | 0.0001 | 0.0003 |
| day1_tornado | P2 logistic | 0.1%-1.0% | 17946 | 11 | 0.0034 | 0.0073 |
| day1_tornado | P2 logistic | 1.0%-2.0% | 3633 | 10 | 0.0143 | 0.0311 |
| day1_tornado | P2 logistic | 2.0%-5.0% | 3794 | 8 | 0.0316 | 0.0675 |
| day1_tornado | P2 logistic | 5.0%-10.0% | 1490 | 8 | 0.0673 | 0.1114 |
| day1_tornado | P2 logistic | 10.0%-15.0% | 226 | 8 | 0.1207 | 0.0664 |
| day1_tornado | P2 logistic | 15.0%-30.0% | 116 | 4 | 0.1920 | 0.1552 |
| day1_tornado | P2 logistic | 30.0%-100.0% | 7 | 1 | 0.3575 | 0.0000 |
| day1_tornado | P2 trees | 0.0%-0.1% | 137714 | 12 | 0.0005 | 0.0001 |
| day1_tornado | P2 trees | 0.1%-1.0% | 46787 | 12 | 0.0034 | 0.0064 |
| day1_tornado | P2 trees | 1.0%-2.0% | 8333 | 11 | 0.0137 | 0.0188 |
| day1_tornado | P2 trees | 2.0%-5.0% | 3469 | 10 | 0.0289 | 0.0634 |
| day1_tornado | P2 trees | 5.0%-10.0% | 518 | 9 | 0.0671 | 0.1023 |
| day1_tornado | P2 trees | 10.0%-15.0% | 105 | 7 | 0.1180 | 0.1143 |
| day1_tornado | P2 trees | 15.0%-30.0% | 30 | 4 | 0.1807 | 0.0667 |
| day1_wind | v0.7 | 0.0%-0.1% | 51042 | 11 | 0.0005 | 0.0000 |
| day1_wind | v0.7 | 0.1%-1.0% | 81836 | 12 | 0.0037 | 0.0009 |
| day1_wind | v0.7 | 1.0%-2.0% | 19319 | 12 | 0.0145 | 0.0043 |
| day1_wind | v0.7 | 2.0%-5.0% | 22097 | 11 | 0.0318 | 0.0271 |
| day1_wind | v0.7 | 5.0%-10.0% | 11528 | 11 | 0.0706 | 0.0804 |
| day1_wind | v0.7 | 10.0%-15.0% | 4382 | 9 | 0.1214 | 0.1132 |
| day1_wind | v0.7 | 15.0%-30.0% | 4495 | 8 | 0.2090 | 0.2714 |
| day1_wind | v0.7 | 30.0%-100.0% | 2257 | 7 | 0.4625 | 0.5179 |
| day1_wind | P2 logistic | 0.0%-0.1% | 76582 | 11 | 0.0005 | 0.0000 |
| day1_wind | P2 logistic | 0.1%-1.0% | 66294 | 12 | 0.0037 | 0.0008 |
| day1_wind | P2 logistic | 1.0%-2.0% | 15767 | 12 | 0.0141 | 0.0073 |
| day1_wind | P2 logistic | 2.0%-5.0% | 15492 | 11 | 0.0321 | 0.0365 |
| day1_wind | P2 logistic | 5.0%-10.0% | 8849 | 11 | 0.0706 | 0.0718 |
| day1_wind | P2 logistic | 10.0%-15.0% | 4266 | 10 | 0.1231 | 0.1067 |
| day1_wind | P2 logistic | 15.0%-30.0% | 6390 | 7 | 0.2123 | 0.2088 |
| day1_wind | P2 logistic | 30.0%-100.0% | 3316 | 7 | 0.4169 | 0.4249 |
| day1_wind | P2 trees | 0.0%-0.1% | 76991 | 11 | 0.0006 | 0.0000 |
| day1_wind | P2 trees | 0.1%-1.0% | 59192 | 12 | 0.0036 | 0.0008 |
| day1_wind | P2 trees | 1.0%-2.0% | 15169 | 12 | 0.0144 | 0.0036 |
| day1_wind | P2 trees | 2.0%-5.0% | 17480 | 12 | 0.0329 | 0.0183 |
| day1_wind | P2 trees | 5.0%-10.0% | 14295 | 11 | 0.0716 | 0.0612 |
| day1_wind | P2 trees | 10.0%-15.0% | 7469 | 11 | 0.1226 | 0.1570 |
| day1_wind | P2 trees | 15.0%-30.0% | 5327 | 8 | 0.1997 | 0.2733 |
| day1_wind | P2 trees | 30.0%-100.0% | 1033 | 6 | 0.3611 | 0.6215 |
| day1_hail | v0.7 | 0.0%-0.1% | 27965 | 10 | 0.0007 | 0.0000 |
| day1_hail | v0.7 | 0.1%-1.0% | 129305 | 12 | 0.0034 | 0.0024 |
| day1_hail | v0.7 | 1.0%-2.0% | 17704 | 12 | 0.0141 | 0.0196 |
| day1_hail | v0.7 | 2.0%-5.0% | 13363 | 11 | 0.0315 | 0.0513 |
| day1_hail | v0.7 | 5.0%-10.0% | 5672 | 8 | 0.0685 | 0.0559 |
| day1_hail | v0.7 | 10.0%-15.0% | 1525 | 7 | 0.1205 | 0.0584 |
| day1_hail | v0.7 | 15.0%-30.0% | 1013 | 7 | 0.2029 | 0.1194 |
| day1_hail | v0.7 | 30.0%-100.0% | 409 | 5 | 0.4398 | 0.1467 |
| day1_hail | P2 logistic | 0.0%-0.1% | 104725 | 12 | 0.0003 | 0.0001 |
| day1_hail | P2 logistic | 0.1%-1.0% | 63011 | 12 | 0.0037 | 0.0040 |
| day1_hail | P2 logistic | 1.0%-2.0% | 9673 | 12 | 0.0140 | 0.0194 |
| day1_hail | P2 logistic | 2.0%-5.0% | 8595 | 10 | 0.0315 | 0.0436 |
| day1_hail | P2 logistic | 5.0%-10.0% | 4942 | 10 | 0.0711 | 0.0902 |
| day1_hail | P2 logistic | 10.0%-15.0% | 2283 | 8 | 0.1228 | 0.1007 |
| day1_hail | P2 logistic | 15.0%-30.0% | 2684 | 6 | 0.2079 | 0.1121 |
| day1_hail | P2 logistic | 30.0%-100.0% | 1043 | 6 | 0.4550 | 0.1170 |
| day1_hail | P2 trees | 0.0%-0.1% | 103184 | 12 | 0.0003 | 0.0000 |
| day1_hail | P2 trees | 0.1%-1.0% | 56177 | 12 | 0.0036 | 0.0013 |
| day1_hail | P2 trees | 1.0%-2.0% | 12826 | 12 | 0.0143 | 0.0209 |
| day1_hail | P2 trees | 2.0%-5.0% | 13859 | 11 | 0.0319 | 0.0421 |
| day1_hail | P2 trees | 5.0%-10.0% | 5918 | 9 | 0.0698 | 0.0781 |
| day1_hail | P2 trees | 10.0%-15.0% | 2278 | 8 | 0.1225 | 0.0860 |
| day1_hail | P2 trees | 15.0%-30.0% | 2089 | 7 | 0.1991 | 0.1158 |
| day1_hail | P2 trees | 30.0%-100.0% | 625 | 5 | 0.4004 | 0.1600 |
| day2_tornado | v0.7 | 0.0%-0.1% | 133170 | 12 | 0.0002 | 0.0000 |
| day2_tornado | v0.7 | 0.1%-1.0% | 53685 | 12 | 0.0031 | 0.0023 |
| day2_tornado | v0.7 | 1.0%-2.0% | 4867 | 10 | 0.0139 | 0.0134 |
| day2_tornado | v0.7 | 2.0%-5.0% | 3380 | 8 | 0.0314 | 0.0485 |
| day2_tornado | v0.7 | 5.0%-10.0% | 1117 | 6 | 0.0680 | 0.0886 |
| day2_tornado | v0.7 | 10.0%-15.0% | 369 | 5 | 0.1212 | 0.0325 |
| day2_tornado | v0.7 | 15.0%-30.0% | 334 | 5 | 0.2025 | 0.0060 |
| day2_tornado | v0.7 | 30.0%-100.0% | 34 | 2 | 0.3462 | 0.0000 |
| day2_tornado | P2 logistic | 0.0%-0.1% | 153114 | 12 | 0.0002 | 0.0000 |
| day2_tornado | P2 logistic | 0.1%-1.0% | 33650 | 12 | 0.0034 | 0.0018 |
| day2_tornado | P2 logistic | 1.0%-2.0% | 4985 | 10 | 0.0139 | 0.0032 |
| day2_tornado | P2 logistic | 2.0%-5.0% | 2989 | 9 | 0.0304 | 0.0314 |
| day2_tornado | P2 logistic | 5.0%-10.0% | 1405 | 8 | 0.0753 | 0.1238 |
| day2_tornado | P2 logistic | 10.0%-15.0% | 706 | 3 | 0.1179 | 0.1671 |
| day2_tornado | P2 logistic | 15.0%-30.0% | 107 | 3 | 0.1725 | 0.0561 |
| day2_tornado | P2 trees | 0.0%-0.1% | 143553 | 12 | 0.0002 | 0.0000 |
| day2_tornado | P2 trees | 0.1%-1.0% | 36089 | 11 | 0.0038 | 0.0007 |
| day2_tornado | P2 trees | 1.0%-2.0% | 8948 | 11 | 0.0141 | 0.0070 |
| day2_tornado | P2 trees | 2.0%-5.0% | 5392 | 11 | 0.0307 | 0.0232 |
| day2_tornado | P2 trees | 5.0%-10.0% | 1822 | 9 | 0.0681 | 0.0269 |
| day2_tornado | P2 trees | 10.0%-15.0% | 480 | 4 | 0.1241 | 0.1271 |
| day2_tornado | P2 trees | 15.0%-30.0% | 669 | 3 | 0.1890 | 0.2152 |
| day2_tornado | P2 trees | 30.0%-100.0% | 3 | 1 | 0.3097 | 0.3333 |
| day2_wind | v0.7 | 0.0%-0.1% | 65309 | 12 | 0.0003 | 0.0000 |
| day2_wind | v0.7 | 0.1%-1.0% | 69988 | 12 | 0.0040 | 0.0017 |
| day2_wind | v0.7 | 1.0%-2.0% | 17978 | 12 | 0.0142 | 0.0170 |
| day2_wind | v0.7 | 2.0%-5.0% | 20453 | 11 | 0.0325 | 0.0380 |
| day2_wind | v0.7 | 5.0%-10.0% | 11872 | 10 | 0.0704 | 0.0797 |
| day2_wind | v0.7 | 10.0%-15.0% | 4363 | 8 | 0.1220 | 0.1167 |
| day2_wind | v0.7 | 15.0%-30.0% | 4438 | 8 | 0.2065 | 0.1685 |
| day2_wind | v0.7 | 30.0%-100.0% | 2555 | 7 | 0.5107 | 0.2583 |
| day2_wind | P2 logistic | 0.0%-0.1% | 86870 | 12 | 0.0003 | 0.0000 |
| day2_wind | P2 logistic | 0.1%-1.0% | 54539 | 12 | 0.0037 | 0.0024 |
| day2_wind | P2 logistic | 1.0%-2.0% | 13138 | 11 | 0.0145 | 0.0193 |
| day2_wind | P2 logistic | 2.0%-5.0% | 16566 | 11 | 0.0324 | 0.0403 |
| day2_wind | P2 logistic | 5.0%-10.0% | 11299 | 11 | 0.0722 | 0.0851 |
| day2_wind | P2 logistic | 10.0%-15.0% | 5598 | 9 | 0.1227 | 0.0952 |
| day2_wind | P2 logistic | 15.0%-30.0% | 6164 | 8 | 0.2066 | 0.1004 |
| day2_wind | P2 logistic | 30.0%-100.0% | 2782 | 7 | 0.4408 | 0.3224 |
| day2_wind | P2 trees | 0.0%-0.1% | 93326 | 12 | 0.0004 | 0.0002 |
| day2_wind | P2 trees | 0.1%-1.0% | 45421 | 12 | 0.0037 | 0.0018 |
| day2_wind | P2 trees | 1.0%-2.0% | 11681 | 11 | 0.0144 | 0.0117 |
| day2_wind | P2 trees | 2.0%-5.0% | 15879 | 11 | 0.0327 | 0.0329 |
| day2_wind | P2 trees | 5.0%-10.0% | 13726 | 11 | 0.0724 | 0.0711 |
| day2_wind | P2 trees | 10.0%-15.0% | 6843 | 9 | 0.1229 | 0.0884 |
| day2_wind | P2 trees | 15.0%-30.0% | 7653 | 8 | 0.2071 | 0.1372 |
| day2_wind | P2 trees | 30.0%-100.0% | 2427 | 8 | 0.3691 | 0.2756 |
| day2_hail | v0.7 | 0.0%-0.1% | 64051 | 12 | 0.0004 | 0.0003 |
| day2_hail | v0.7 | 0.1%-1.0% | 90603 | 12 | 0.0038 | 0.0010 |
| day2_hail | v0.7 | 1.0%-2.0% | 19317 | 12 | 0.0142 | 0.0053 |
| day2_hail | v0.7 | 2.0%-5.0% | 14567 | 11 | 0.0309 | 0.0154 |
| day2_hail | v0.7 | 5.0%-10.0% | 4770 | 9 | 0.0687 | 0.0465 |
| day2_hail | v0.7 | 10.0%-15.0% | 1519 | 7 | 0.1217 | 0.1001 |
| day2_hail | v0.7 | 15.0%-30.0% | 1218 | 7 | 0.2050 | 0.1437 |
| day2_hail | v0.7 | 30.0%-100.0% | 911 | 5 | 0.4724 | 0.1987 |
| day2_hail | P2 logistic | 0.0%-0.1% | 98679 | 12 | 0.0003 | 0.0004 |
| day2_hail | P2 logistic | 0.1%-1.0% | 66519 | 12 | 0.0032 | 0.0014 |
| day2_hail | P2 logistic | 1.0%-2.0% | 10971 | 11 | 0.0144 | 0.0026 |
| day2_hail | P2 logistic | 2.0%-5.0% | 11770 | 11 | 0.0314 | 0.0166 |
| day2_hail | P2 logistic | 5.0%-10.0% | 5146 | 10 | 0.0702 | 0.0464 |
| day2_hail | P2 logistic | 10.0%-15.0% | 1551 | 9 | 0.1212 | 0.0793 |
| day2_hail | P2 logistic | 15.0%-30.0% | 1777 | 6 | 0.2047 | 0.1806 |
| day2_hail | P2 logistic | 30.0%-100.0% | 543 | 4 | 0.4091 | 0.2523 |
| day2_hail | P2 trees | 0.0%-0.1% | 102890 | 12 | 0.0003 | 0.0003 |
| day2_hail | P2 trees | 0.1%-1.0% | 59120 | 12 | 0.0036 | 0.0018 |
| day2_hail | P2 trees | 1.0%-2.0% | 12277 | 11 | 0.0143 | 0.0039 |
| day2_hail | P2 trees | 2.0%-5.0% | 12133 | 11 | 0.0318 | 0.0109 |
| day2_hail | P2 trees | 5.0%-10.0% | 6128 | 9 | 0.0697 | 0.0351 |
| day2_hail | P2 trees | 10.0%-15.0% | 2257 | 8 | 0.1210 | 0.0975 |
| day2_hail | P2 trees | 15.0%-30.0% | 1562 | 7 | 0.2010 | 0.1709 |
| day2_hail | P2 trees | 30.0%-100.0% | 589 | 6 | 0.4079 | 0.2615 |

## Cross-validated recipe check on 2022+2023 (96 dates, month-grouped folds, uncalibrated)

| Product | Event dates | Climatology Brier | v0.7 recipe Brier | P2 logistic recipe Brier | v0.7 log loss | P2 log loss |
|---|---|---|---|---|---|---|
| day1_tornado | 31 | 0.00177 | 0.00170 | 0.00168 | 0.00917 | 0.00856 |
| day1_wind | 56 | 0.01784 | 0.01624 | 0.01597 | 0.06458 | 0.06186 |
| day1_hail | 51 | 0.00745 | 0.00720 | 0.00667 | 0.03283 | 0.02913 |
| day2_tornado | 36 | 0.00196 | 0.00194 | 0.00192 | 0.01059 | 0.00972 |
| day2_wind | 56 | 0.01797 | 0.01612 | 0.01573 | 0.06301 | 0.06015 |
| day2_hail | 51 | 0.00733 | 0.00707 | 0.00675 | 0.03212 | 0.02928 |

## Map days

Active: 2024-07-15 (3386 Day 1 land points within 25 mi of a report). Quiet: 2024-01-15 (0). Rule: Most and fewest Day 1 land points within 25 mi of a report among the 12 verification dates.
