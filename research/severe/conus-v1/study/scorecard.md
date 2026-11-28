# CONUS HRRR first national test (research only)

108 cohort cases; fit on 96 dates (2022-2023), scored on 12 dates in 2024 (exploratory; 2025 sealed). Samples: 38,838 US-land samples scored, 7,582 of them coast/border-exposed and scored separately; 1,473 offshore samples unavailable.

## Brier skill vs 2022-23 climatology (all supported samples)

| Product | Event dates / pts | v0.7 as-is | v0.7 recipe refit | CONUS logistic | CONUS trees | CONUS logistic - v0.7 as-is (95%) |
|---|---|---|---|---|---|---|
| day1_tornado | 7 / 797 | +0.009 | +0.034 | +0.040 | +0.013 | -1.5e-04 to +5.9e-06 |
| day1_wind | 7 / 7270 | +0.163 | +0.163 | +0.164 | +0.158 | -2.8e-04 to +2.1e-04 |
| day1_hail | 7 / 3185 | +0.016 | -0.021 | +0.017 | +0.029 | -2.6e-04 to +2.6e-04 |
| day2_tornado | 5 / 638 | -0.029 | -0.045 | +0.030 | +0.045 | -1.6e-04 to -1.2e-05 |
| day2_wind | 9 / 6036 | +0.002 | +0.019 | +0.064 | +0.070 | -1.6e-03 to -1.3e-04 |
| day2_hail | 8 / 1715 | -0.066 | -0.113 | +0.022 | +0.041 | -8.4e-04 to +7.0e-05 |

## Interior vs coast/border-exposed (BSS)

| Product | Subset | Event dates / pts | v0.7 as-is | v0.7 recipe refit | CONUS logistic | CONUS trees |
|---|---|---|---|---|---|---|
| day1_tornado | interior | 6 / 648 | +0.030 | +0.060 | +0.048 | +0.018 |
| day1_tornado | coast_border_exposed | 4 / 149 | -0.079 | -0.080 | +0.003 | -0.007 |
| day1_wind | interior | 7 / 6488 | +0.173 | +0.173 | +0.172 | +0.163 |
| day1_wind | coast_border_exposed | 7 / 782 | +0.080 | +0.084 | +0.094 | +0.114 |
| day1_hail | interior | 7 / 2741 | +0.015 | -0.022 | +0.015 | +0.026 |
| day1_hail | coast_border_exposed | 6 / 444 | +0.020 | -0.016 | +0.031 | +0.049 |
| day2_tornado | interior | 4 / 565 | -0.025 | -0.040 | +0.033 | +0.051 |
| day2_tornado | coast_border_exposed | 4 / 73 | -0.058 | -0.078 | +0.000 | -0.006 |
| day2_wind | interior | 9 / 5275 | +0.003 | +0.018 | +0.063 | +0.072 |
| day2_wind | coast_border_exposed | 7 / 761 | -0.004 | +0.030 | +0.067 | +0.058 |
| day2_hail | interior | 7 / 1664 | -0.041 | -0.087 | +0.040 | +0.058 |
| day2_hail | coast_border_exposed | 4 / 51 | -0.860 | -0.959 | -0.550 | -0.481 |

## By region, interior samples (BSS)

| Product | Region | Event dates / pts | v0.7 as-is | v0.7 recipe refit | CONUS logistic | CONUS trees |
|---|---|---|---|---|---|---|
| day1_tornado | original_box | 5 / 630 | +0.068 | +0.096 | +0.065 | +0.023 |
| day1_tornado | west | 0 / 0 | +0.710 | +0.769 | +0.205 | +0.143 |
| day1_tornado | plains_outside_box | 1 / 13 | -1.804 | -1.657 | -0.725 | -0.225 |
| day1_tornado | florida_gulf_south | 1 / 5 | -0.029 | -0.046 | -0.065 | -0.003 |
| day1_tornado | northeast_outside_box | 0 / 0 | +0.122 | +0.010 | -3.241 | -4.664 |
| day1_wind | original_box | 7 / 4108 | +0.244 | +0.246 | +0.230 | +0.215 |
| day1_wind | west | 4 / 926 | +0.030 | +0.028 | +0.049 | +0.044 |
| day1_wind | plains_outside_box | 7 / 1148 | +0.066 | +0.067 | +0.104 | +0.092 |
| day1_wind | florida_gulf_south | 0 / 0 | -42.019 | -35.243 | -44.883 | -29.504 |
| day1_wind | northeast_outside_box | 2 / 306 | +0.107 | +0.081 | +0.075 | +0.131 |
| day1_hail | original_box | 6 / 1667 | +0.006 | -0.036 | -0.001 | +0.017 |
| day1_hail | west | 3 / 91 | +0.013 | +0.025 | -0.044 | -0.085 |
| day1_hail | plains_outside_box | 6 / 838 | +0.033 | -0.004 | +0.054 | +0.049 |
| day1_hail | florida_gulf_south | 0 / 0 | -17.417 | -32.766 | -24.147 | -10.442 |
| day1_hail | northeast_outside_box | 2 / 145 | +0.028 | +0.018 | +0.032 | +0.068 |
| day2_tornado | original_box | 3 / 441 | -0.009 | -0.023 | +0.058 | +0.073 |
| day2_tornado | west | 1 / 1 | -0.114 | +0.020 | -0.874 | -0.894 |
| day2_tornado | plains_outside_box | 1 / 30 | -0.351 | -0.430 | -0.211 | -0.187 |
| day2_tornado | florida_gulf_south | 1 / 3 | -0.015 | -0.014 | -0.044 | -0.045 |
| day2_tornado | northeast_outside_box | 1 / 90 | +0.005 | +0.005 | +0.007 | +0.037 |
| day2_wind | original_box | 7 / 3613 | +0.054 | +0.052 | +0.093 | +0.089 |
| day2_wind | west | 4 / 417 | -0.037 | +0.029 | +0.018 | +0.037 |
| day2_wind | plains_outside_box | 6 / 888 | -0.223 | -0.147 | -0.053 | -0.011 |
| day2_wind | florida_gulf_south | 1 / 12 | -0.659 | -0.352 | -0.360 | -0.301 |
| day2_wind | northeast_outside_box | 1 / 345 | +0.132 | +0.085 | +0.117 | +0.161 |
| day2_hail | original_box | 7 / 1147 | -0.007 | -0.053 | +0.075 | +0.081 |
| day2_hail | west | 1 / 24 | -0.126 | -0.036 | -0.264 | -0.462 |
| day2_hail | plains_outside_box | 5 / 447 | -0.127 | -0.185 | -0.027 | +0.036 |
| day2_hail | florida_gulf_south | 0 / 0 | -18.308 | -18.078 | -11.695 | -4.060 |
| day2_hail | northeast_outside_box | 1 / 46 | +0.031 | +0.027 | +0.018 | +0.014 |

## Reliability at practical thresholds (all supported, CONUS logistic)

| Product | Threshold | Hits | Misses | False alarms | POD | FAR | CSI |
|---|---|---|---|---|---|---|---|
| day1_tornado | 2% | 502 | 295 | 6267 | 0.63 | 0.93 | 0.071 |
| day1_tornado | 5% | 253 | 544 | 2068 | 0.32 | 0.89 | 0.088 |
| day1_tornado | 10% | 68 | 729 | 585 | 0.09 | 0.90 | 0.049 |
| day1_wind | 5% | 5018 | 2252 | 24880 | 0.69 | 0.83 | 0.156 |
| day1_wind | 15% | 3069 | 4201 | 8486 | 0.42 | 0.73 | 0.195 |
| day1_wind | 30% | 1477 | 5793 | 2114 | 0.20 | 0.59 | 0.157 |
| day1_hail | 5% | 1568 | 1617 | 14468 | 0.49 | 0.90 | 0.089 |
| day1_hail | 15% | 610 | 2575 | 4386 | 0.19 | 0.88 | 0.081 |
| day1_hail | 30% | 193 | 2992 | 1058 | 0.06 | 0.85 | 0.045 |
| day2_tornado | 2% | 409 | 229 | 7705 | 0.64 | 0.95 | 0.049 |
| day2_tornado | 5% | 282 | 356 | 2705 | 0.44 | 0.91 | 0.084 |
| day2_tornado | 10% | 32 | 606 | 850 | 0.05 | 0.96 | 0.022 |
| day2_wind | 5% | 3882 | 2154 | 31218 | 0.64 | 0.89 | 0.104 |
| day2_wind | 15% | 1745 | 4291 | 8748 | 0.29 | 0.83 | 0.118 |
| day2_wind | 30% | 813 | 5223 | 2198 | 0.13 | 0.73 | 0.099 |
| day2_hail | 5% | 1012 | 703 | 13347 | 0.59 | 0.93 | 0.067 |
| day2_hail | 15% | 516 | 1199 | 2842 | 0.30 | 0.85 | 0.113 |
| day2_hail | 30% | 196 | 1519 | 766 | 0.11 | 0.80 | 0.079 |

## Regions and hazards that need more dates before the probabilities can be trusted

Rule: fewer than 5 event dates in the 12 verification dates, or fewer than 10 in the 96 training dates.

| Product | Region | Train event dates | Verify event dates |
|---|---|---|---|
| day1_tornado | west | 11 | 0 |
| day1_tornado | plains_outside_box | 21 | 1 |
| day1_tornado | florida_gulf_south | 7 | 2 |
| day1_tornado | northeast_outside_box | 5 | 0 |
| day1_wind | west | 35 | 4 |
| day1_wind | florida_gulf_south | 18 | 1 |
| day1_wind | northeast_outside_box | 19 | 2 |
| day1_hail | west | 27 | 3 |
| day1_hail | florida_gulf_south | 7 | 0 |
| day1_hail | northeast_outside_box | 11 | 2 |
| day2_tornado | original_box | 36 | 4 |
| day2_tornado | west | 7 | 1 |
| day2_tornado | plains_outside_box | 14 | 1 |
| day2_tornado | florida_gulf_south | 9 | 1 |
| day2_tornado | northeast_outside_box | 3 | 1 |
| day2_wind | west | 34 | 4 |
| day2_wind | florida_gulf_south | 24 | 1 |
| day2_wind | northeast_outside_box | 19 | 1 |
| day2_hail | west | 24 | 1 |
| day2_hail | florida_gulf_south | 5 | 0 |
| day2_hail | northeast_outside_box | 11 | 1 |
