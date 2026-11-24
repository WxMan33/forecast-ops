# Larger training set gate: PASS

728 held-out 2022-23 dates (6 month-grouped folds); BSS vs development climatology 0.01084.

| Arm | National | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box |
|---|---|---|---|---|---|---|
| all | 0.115 | 0.133 | 0.049 | 0.078 | -0.007 | 0.127 |
| cohort96 | 0.098 | 0.114 | 0.036 | 0.066 | -0.039 | 0.124 |

Brier (all − cohort96), 95% whole-date interval:

- national: -0.000180 (-0.000237 to -0.000129)
- original_box: -0.000370 (-0.000513 to -0.000246)
- west: -0.000037 (-0.000048 to -0.000026)
- plains_outside_box: -0.000111 (-0.000175 to -0.000049)
- florida_gulf_south: -0.000227 (-0.000344 to -0.000127)
- northeast_outside_box: -0.000018 (-0.000096 to +0.000061)

Calibration (all): mean forecast 0.01083 vs observed 0.01084 (ratio 0.999)

Criteria: {'1_national_better': True, '2_no_region_worse': True, '3_calibrated': True}
