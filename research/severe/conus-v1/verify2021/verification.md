# 2021 verification of the 728-date Day 2 wind candidate: FAIL

96 sealed 2021 dates scored once (missing: none); BSS vs the 2022-23 development climatology 0.01084.

| Model | National | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box |
|---|---|---|---|---|---|---|
| fulldev | 0.099 | 0.111 | 0.056 | 0.077 | -0.038 | 0.120 |
| conus_gbt_96 | 0.102 | 0.119 | 0.053 | 0.064 | -0.065 | 0.126 |
| v07_frozen | 0.061 | 0.083 | -0.052 | 0.034 | -0.223 | 0.114 |

v07_frozen is a regional model: only its original_box column is a fair comparison.

Brier (728-date − 96-date), 95% whole-date interval:

- national: +0.000027 (-0.000037 to +0.000101)
- original_box: +0.000127 (-0.000014 to +0.000291)
- west: -0.000007 (-0.000029 to +0.000019)
- plains_outside_box: -0.000130 (-0.000256 to -0.000027)
- florida_gulf_south: -0.000116 (-0.000259 to +0.000016)
- northeast_outside_box: +0.000075 (-0.000322 to +0.000508)

Original box, 728-date − v0.7: -0.000412 (-0.000827 to -0.000065)
Event dates by region: {'original_box': 57, 'west': 27, 'plains_outside_box': 42, 'florida_gulf_south': 16, 'northeast_outside_box': 20}
Calibration: mean forecast 0.00953 vs observed 0.00883

Criteria: {'1_beats_96_nationally': False, '2_no_region_worse': True, '3_calibrated_25pct': True, '4_dates_ge_90': True}
