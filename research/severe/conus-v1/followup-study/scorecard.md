# CONUS 36-date follow-up with frozen models (research only)

Dates: 36 unused 2024 dates. Frozen models sha256 a9ff6aa76b94. Reference: v0.7 recipe refit on CONUS. Rule: docs/severe-phase2-criteria.md section 6. 2025 sealed.

## Verdict (lead: Day 2 wind and hail)

| Product | Candidate | Repeats nationally | Brier diff vs ref (95%) | Regions | Better in / entered | Thin regions |
|---|---|---|---|---|---|---|
| day2_wind | logistic | yes | -7.1e-04 to -2.5e-05 | holds | florida_gulf_south, northeast_outside_box, original_box, plains_outside_box, west / florida_gulf_south, northeast_outside_box, original_box, plains_outside_box, west | - |
| day2_wind | trees | yes | -9.1e-04 to -6.7e-05 | holds | florida_gulf_south, northeast_outside_box, original_box, plains_outside_box, west / florida_gulf_south, northeast_outside_box, original_box, plains_outside_box, west | - |
| day2_hail | logistic | yes | -5.2e-04 to -1.0e-04 | holds | northeast_outside_box, original_box, plains_outside_box, west / northeast_outside_box, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box |
| day2_hail | trees | no | -5.8e-04 to +1.6e-04 | holds | northeast_outside_box, original_box, plains_outside_box / northeast_outside_box, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box |
| day2_tornado | logistic | yes | -1.6e-04 to -3.5e-05 | holds | florida_gulf_south, original_box, plains_outside_box / florida_gulf_south, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box, west |
| day2_tornado | trees | no | -1.2e-04 to +1.3e-06 | does_not_hold | original_box, plains_outside_box / florida_gulf_south, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box, west |
| day1_wind | logistic | no | -3.8e-04 to +2.0e-04 | holds | florida_gulf_south, northeast_outside_box, original_box, west / florida_gulf_south, northeast_outside_box, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box |
| day1_wind | trees | no | -5.1e-04 to +5.0e-04 | does_not_hold | florida_gulf_south, original_box / florida_gulf_south, northeast_outside_box, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box |
| day1_hail | logistic | yes | -4.6e-04 to -5.8e-05 | holds | northeast_outside_box, original_box, plains_outside_box / northeast_outside_box, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box |
| day1_hail | trees | no | -5.2e-04 to +2.5e-04 | holds | northeast_outside_box, original_box, plains_outside_box / northeast_outside_box, original_box, plains_outside_box, west | florida_gulf_south, northeast_outside_box |
| day1_tornado | logistic | yes | -3.9e-04 to -3.9e-05 | holds | original_box, plains_outside_box / original_box, plains_outside_box | florida_gulf_south, northeast_outside_box, west |
| day1_tornado | trees | yes | -3.6e-04 to -2.9e-05 | holds | original_box, plains_outside_box / original_box, plains_outside_box | florida_gulf_south, northeast_outside_box, west |

## Paired Brier difference vs the v0.7 refit by region (interior samples; negative = candidate better)

| Product | Region | Verify / train event dates | logistic (95%) | trees (95%) | BSS ref / logistic / trees |
|---|---|---|---|---|---|
| day2_wind | original_box | 22 / 56 | -1.5e-03..+8.5e-05 | -1.9e-03..+3.0e-04 | +0.076 / +0.108 / +0.112 |
| day2_wind | west | 15 / 34 | -5.5e-05..+1.6e-05 | -9.5e-05..+4.0e-05 | +0.021 / +0.024 / +0.024 |
| day2_wind | plains_outside_box | 18 / 43 | -6.0e-04..+8.3e-05 | -9.3e-04..+1.2e-04 | +0.049 / +0.067 / +0.077 |
| day2_wind | florida_gulf_south | 5 / 24 | -2.4e-03..+2.8e-04 | -2.6e-03..+1.1e-03 | -0.068 / -0.007 / -0.018 |
| day2_wind | northeast_outside_box | 5 / 19 | -5.0e-03..-9.1e-05 | -5.2e-03..-2.0e-04 | +0.160 / +0.244 / +0.264 |
| day2_hail | original_box | 15 / 51 | -1.2e-03..-1.7e-04 | -1.1e-03..+7.2e-04 | +0.007 / +0.084 / +0.031 |
| day2_hail | west | 7 / 24 | -3.0e-05..+1.0e-05 | -2.2e-05..+2.6e-05 | +0.030 / +0.042 / +0.029 |
| day2_hail | plains_outside_box | 14 / 37 | -1.0e-03..-5.5e-05 | -1.6e-03..-4.5e-05 | +0.036 / +0.090 / +0.118 |
| day2_hail | florida_gulf_south | 1 / 5 | -1.8e-03..-2.8e-05 | -2.2e-03..+8.7e-05 | -37.717 / -12.255 / -7.942 |
| day2_hail | northeast_outside_box | 4 / 11 | -1.5e-04..+1.3e-05 | -4.8e-04..+2.4e-04 | +0.105 / +0.113 / +0.121 |
| day2_tornado | original_box | 13 / 36 | -4.0e-04..-6.0e-05 | -3.4e-04..-2.1e-05 | +0.018 / +0.061 / +0.052 |
| day2_tornado | west | 5 / 7 | -1.0e-06..+2.1e-06 | +1.1e-07..+8.2e-06 | +0.005 / +0.004 / -0.009 |
| day2_tornado | plains_outside_box | 7 / 14 | -9.2e-05..-2.6e-06 | -1.3e-04..-2.6e-07 | -0.010 / +0.006 / +0.013 |
| day2_tornado | florida_gulf_south | 4 / 9 | -1.3e-03..+1.8e-04 | -2.1e-05..+3.3e-03 | +0.198 / +0.219 / +0.138 |
| day2_tornado | northeast_outside_box | 2 / 3 | -1.4e-04..-7.5e-07 | -1.0e-04..+1.9e-04 | +0.013 / +0.045 / -0.004 |
| day1_wind | original_box | 19 / 56 | -1.1e-03..+6.6e-04 | -1.4e-03..+1.6e-03 | +0.158 / +0.170 / +0.159 |
| day1_wind | west | 10 / 35 | -3.0e-05..+2.2e-05 | -6.5e-06..+5.8e-05 | +0.069 / +0.071 / +0.059 |
| day1_wind | plains_outside_box | 14 / 37 | -6.5e-05..+5.4e-04 | -5.8e-04..+6.8e-04 | +0.076 / +0.052 / +0.075 |
| day1_wind | florida_gulf_south | 4 / 18 | -7.2e-04..-9.2e-05 | -9.0e-04..-7.1e-05 | -0.094 / -0.036 / -0.022 |
| day1_wind | northeast_outside_box | 3 / 19 | -5.6e-04..+3.7e-05 | -3.9e-05..+9.5e-04 | +0.161 / +0.188 / +0.106 |
| day1_hail | original_box | 20 / 51 | -1.1e-03..-5.7e-05 | -1.3e-03..+7.5e-04 | +0.121 / +0.171 / +0.156 |
| day1_hail | west | 7 / 27 | -2.7e-05..+4.7e-05 | +4.9e-06..+9.9e-05 | +0.061 / +0.045 / -0.037 |
| day1_hail | plains_outside_box | 13 / 31 | -9.0e-04..+2.0e-04 | -8.6e-04..+5.5e-04 | +0.084 / +0.113 / +0.088 |
| day1_hail | florida_gulf_south | 2 / 7 | -1.1e-04..-3.3e-05 | -1.3e-04..-4.1e-05 | -3.819 / -1.324 / -0.630 |
| day1_hail | northeast_outside_box | 4 / 11 | -4.5e-04..+4.2e-05 | -1.8e-04..+1.8e-05 | +0.060 / +0.097 / +0.075 |
| day1_tornado | original_box | 12 / 31 | -1.1e-03..-5.2e-05 | -9.1e-04..-2.1e-05 | -0.016 / +0.100 / +0.071 |
| day1_tornado | west | 2 / 11 | -3.0e-07..+8.4e-07 | +4.7e-07..+2.9e-06 | +0.007 / +0.004 / -0.009 |
| day1_tornado | plains_outside_box | 9 / 21 | -2.9e-04..+1.8e-05 | -3.4e-04..+1.1e-05 | -0.067 / +0.013 / +0.028 |
| day1_tornado | florida_gulf_south | 2 / 7 | -1.9e-05..+3.9e-06 | -3.0e-06..+2.0e-05 | -0.019 / +0.002 / -0.047 |
| day1_tornado | northeast_outside_box | 1 / 5 | -1.3e-05..+1.8e-05 | +1.1e-06..+1.4e-05 | +0.019 / +0.013 / -0.005 |

## False-alarm size (all supported samples in region)

Mean forecast vs observed report rate; land area at or above 5/15/30% on no-report days (mean km^2 per no-report day).

| Product | Region | No-report days / dates | Observed rate | Model | Mean forecast | >=5% | >=15% | >=30% |
|---|---|---|---|---|---|---|---|---|
| day2_wind | florida_gulf_south | 31 / 36 | 0.0072 | v0.7 as-is | 0.0300 | 35,260 | 4,681 | 1,894 |
| day2_wind | florida_gulf_south | 31 / 36 | 0.0072 | v0.7 refit | 0.0263 | 28,357 | 3,673 | 1,691 |
| day2_wind | florida_gulf_south | 31 / 36 | 0.0072 | logistic | 0.0254 | 26,115 | 4,130 | 1,597 |
| day2_wind | florida_gulf_south | 31 / 36 | 0.0072 | trees | 0.0187 | 15,997 | 3,680 | 1,285 |
| day2_wind | west | 21 / 36 | 0.0038 | v0.7 as-is | 0.0051 | 2,839 | 364 | 21 |
| day2_wind | west | 21 / 36 | 0.0038 | v0.7 refit | 0.0029 | 964 | 32 | 0 |
| day2_wind | west | 21 / 36 | 0.0038 | logistic | 0.0032 | 1,832 | 75 | 0 |
| day2_wind | west | 21 / 36 | 0.0038 | trees | 0.0037 | 2,807 | 536 | 0 |
| day2_hail | florida_gulf_south | 35 / 36 | 0.0002 | v0.7 as-is | 0.0122 | 8,036 | 1,414 | 456 |
| day2_hail | florida_gulf_south | 35 / 36 | 0.0002 | v0.7 refit | 0.0119 | 6,911 | 1,401 | 469 |
| day2_hail | florida_gulf_south | 35 / 36 | 0.0002 | logistic | 0.0065 | 6,191 | 264 | 0 |
| day2_hail | florida_gulf_south | 35 / 36 | 0.0002 | trees | 0.0047 | 3,433 | 0 | 0 |
| day2_hail | west | 29 / 36 | 0.0007 | v0.7 as-is | 0.0022 | 3,228 | 70 | 0 |
| day2_hail | west | 29 / 36 | 0.0007 | v0.7 refit | 0.0017 | 2,110 | 54 | 0 |
| day2_hail | west | 29 / 36 | 0.0007 | logistic | 0.0016 | 2,863 | 62 | 0 |
| day2_hail | west | 29 / 36 | 0.0007 | trees | 0.0017 | 6,991 | 163 | 47 |
| day2_tornado | florida_gulf_south | 32 / 36 | 0.0104 | v0.7 as-is | 0.0052 | 0 | 0 | 0 |
| day2_tornado | florida_gulf_south | 32 / 36 | 0.0104 | v0.7 refit | 0.0054 | 0 | 0 | 0 |
| day2_tornado | florida_gulf_south | 32 / 36 | 0.0104 | logistic | 0.0047 | 42 | 0 | 0 |
| day2_tornado | florida_gulf_south | 32 / 36 | 0.0104 | trees | 0.0045 | 148 | 0 | 0 |
| day2_tornado | west | 31 / 36 | 0.0002 | v0.7 as-is | 0.0003 | 0 | 0 | 0 |
| day2_tornado | west | 31 / 36 | 0.0002 | v0.7 refit | 0.0003 | 0 | 0 | 0 |
| day2_tornado | west | 31 / 36 | 0.0002 | logistic | 0.0003 | 7 | 0 | 0 |
| day2_tornado | west | 31 / 36 | 0.0002 | trees | 0.0006 | 1,662 | 7 | 0 |
| day1_wind | florida_gulf_south | 32 / 36 | 0.0024 | v0.7 as-is | 0.0308 | 34,397 | 3,023 | 998 |
| day1_wind | florida_gulf_south | 32 / 36 | 0.0024 | v0.7 refit | 0.0260 | 25,516 | 2,566 | 1,048 |
| day1_wind | florida_gulf_south | 32 / 36 | 0.0024 | logistic | 0.0223 | 23,449 | 2,700 | 274 |
| day1_wind | florida_gulf_south | 32 / 36 | 0.0024 | trees | 0.0148 | 11,742 | 1,631 | 218 |
| day1_wind | west | 26 / 36 | 0.0019 | v0.7 as-is | 0.0044 | 14,538 | 2,129 | 173 |
| day1_wind | west | 26 / 36 | 0.0019 | v0.7 refit | 0.0027 | 7,382 | 874 | 17 |
| day1_wind | west | 26 / 36 | 0.0019 | logistic | 0.0027 | 9,424 | 597 | 0 |
| day1_wind | west | 26 / 36 | 0.0019 | trees | 0.0032 | 10,921 | 277 | 9 |
| day1_hail | florida_gulf_south | 34 / 36 | 0.0002 | v0.7 as-is | 0.0100 | 2,429 | 543 | 13 |
| day1_hail | florida_gulf_south | 34 / 36 | 0.0002 | v0.7 refit | 0.0100 | 2,879 | 926 | 139 |
| day1_hail | florida_gulf_south | 34 / 36 | 0.0002 | logistic | 0.0055 | 2,449 | 93 | 0 |
| day1_hail | florida_gulf_south | 34 / 36 | 0.0002 | trees | 0.0044 | 2,190 | 73 | 0 |
| day1_hail | west | 29 / 36 | 0.0004 | v0.7 as-is | 0.0027 | 2,638 | 365 | 8 |
| day1_hail | west | 29 / 36 | 0.0004 | v0.7 refit | 0.0017 | 2,622 | 450 | 0 |
| day1_hail | west | 29 / 36 | 0.0004 | logistic | 0.0016 | 7,922 | 1,606 | 124 |
| day1_hail | west | 29 / 36 | 0.0004 | trees | 0.0018 | 13,166 | 962 | 334 |
| day1_tornado | florida_gulf_south | 34 / 36 | 0.0016 | v0.7 as-is | 0.0037 | 1,535 | 344 | 7 |
| day1_tornado | florida_gulf_south | 34 / 36 | 0.0016 | v0.7 refit | 0.0038 | 1,654 | 397 | 13 |
| day1_tornado | florida_gulf_south | 34 / 36 | 0.0016 | logistic | 0.0039 | 2,038 | 364 | 0 |
| day1_tornado | florida_gulf_south | 34 / 36 | 0.0016 | trees | 0.0029 | 1,118 | 13 | 0 |
| day1_tornado | west | 34 / 36 | 0.0001 | v0.7 as-is | 0.0003 | 0 | 0 | 0 |
| day1_tornado | west | 34 / 36 | 0.0001 | v0.7 refit | 0.0003 | 0 | 0 | 0 |
| day1_tornado | west | 34 / 36 | 0.0001 | logistic | 0.0002 | 0 | 0 | 0 |
| day1_tornado | west | 34 / 36 | 0.0001 | trees | 0.0005 | 218 | 0 | 0 |

## All-supported BSS vs 2022-23 climatology

| Product | Event dates / pts | v0.7 as-is | v0.7 refit | logistic | trees |
|---|---|---|---|---|---|
| day2_wind | 28 / 16368 | +0.053 | +0.065 | +0.095 | +0.105 |
| day2_hail | 19 / 6171 | +0.019 | +0.009 | +0.075 | +0.052 |
| day2_tornado | 19 / 3500 | +0.036 | +0.027 | +0.064 | +0.047 |
| day1_wind | 23 / 12418 | +0.120 | +0.121 | +0.131 | +0.126 |
| day1_hail | 23 / 7537 | +0.107 | +0.089 | +0.133 | +0.117 |
| day1_tornado | 17 / 2649 | +0.002 | -0.026 | +0.076 | +0.061 |
