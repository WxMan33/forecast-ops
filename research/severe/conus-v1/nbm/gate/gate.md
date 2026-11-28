# NBM gate (Day 2 wind, HRRR-only vs HRRR + NBM): FAIL

726 matched held-out 2022-23 dates (6 month-grouped folds); 2 excluded from both arms: listed_after_cutoff: 2022-01-06, 2023-01-20.

BSS vs development climatology 0.01087.

| Arm | National | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box | mean p / obs | FL/Gulf mean p / obs |
|---|---|---|---|---|---|---|---|---|
| hrrr | 0.114 | 0.133 | 0.049 | 0.077 | -0.008 | 0.127 | 0.999 | 2.095 |
| hrrr_nbm | 0.122 | 0.142 | 0.049 | 0.084 | -0.018 | 0.140 | 0.999 | 2.082 |

Brier (HRRR + NBM − HRRR-only), 95% whole-date interval:

- national: -0.000082 (-0.000113 to -0.000055)
- original_box: -0.000177 (-0.000252 to -0.000113)
- west: +0.000002 (-0.000004 to +0.000007)
- plains_outside_box: -0.000065 (-0.000118 to -0.000017)
- florida_gulf_south: +0.000076 (+0.000016 to +0.000142)
- northeast_outside_box: -0.000107 (-0.000165 to -0.000053)

By NBM version period (national):

- v4.0 (before 2023-01-17) (380 dates): -0.000099 (-0.000135 to -0.000066)
- v4.1 (from 2023-01-17) (346 dates): -0.000063 (-0.000114 to -0.000017)

Hits at >=5% (of 306444 report samples): HRRR 220066, HRRR+NBM 223190 (retention 1.014)
False-alarm area at >=5% (samples with no report, summed over dates): HRRR 341,603,550 km², HRRR+NBM 336,090,150 km²
Area at >=5% per no-report date: HRRR 37,087 km², HRRR+NBM 32,050 km²

Criteria: {'1_national_better': True, '2_no_region_worse': False, '3_calibrated_15pct': True, '4_hit_retention_ge_95pct': True}
