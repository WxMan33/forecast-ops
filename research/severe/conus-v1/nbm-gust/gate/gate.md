# Gust-only NBM test (Day 2 wind): HRRR + NBM gust vs HRRR only: FAIL

726 matched held-out 2022-23 dates, 6 month-grouped folds. HRRR-only and full-NBM totals reused from verified run 45544910438. BSS vs development climatology 0.01087.

| Arm | National | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box | mean p / obs | FL/Gulf mean p / obs |
|---|---|---|---|---|---|---|---|---|
| hrrr | 0.114 | 0.133 | 0.049 | 0.077 | -0.008 | 0.127 | 0.999 | 2.095 |
| hrrr_gust | 0.115 | 0.133 | 0.050 | 0.077 | -0.014 | 0.127 | 1.001 | 2.143 |
| hrrr_nbm | 0.122 | 0.142 | 0.049 | 0.084 | -0.018 | 0.140 | 0.999 | 2.082 |

**Gust-only − HRRR-only** (decides the verdict), Brier difference, 95% whole-date interval:

- national: -0.000003 (-0.000024 to +0.000015)
- original_box: -0.000007 (-0.000057 to +0.000036)
- west: -0.000003 (-0.000007 to +0.000002)
- plains_outside_box: -0.000004 (-0.000038 to +0.000027)
- florida_gulf_south: +0.000043 (+0.000007 to +0.000079)
- northeast_outside_box: +0.000001 (-0.000032 to +0.000038)

**Gust-only − full NBM** (diagnostic):

- national: +0.000079 (+0.000056 to +0.000105)
- florida_gulf_south: -0.000033 (-0.000096 to +0.000026)

Full NBM − HRRR-only (reference, from the verified gate):

- national: -0.000082 (-0.000113 to -0.000055)
- florida_gulf_south: +0.000076 (+0.000016 to +0.000142)

Gust-only − HRRR-only by NBM version period (national):

- v4.0 (before 2023-01-17) (380 dates): -0.000014 (-0.000032 to +0.000003)
- v4.1 (from 2023-01-17) (346 dates): +0.000009 (-0.000028 to +0.000043)

| | HRRR only | HRRR + gust | HRRR + all NBM |
|---|---|---|---|
| Hits at ≥5% (national) | 220,066 | 220,655 | 223,190 |
| Hits at ≥5% (FL/Gulf) | 2,852 | 2,865 | 2,869 |
| False-alarm area ≥5%, km² (national) | 341,603,550 | 340,703,325 | 336,090,150 |
| False-alarm area ≥5%, km² (FL/Gulf) | 11,572,650 | 11,868,750 | 11,396,475 |
| Area ≥5% per no-report date, km² | 37,087 | 36,153 | 32,050 |

Hit retention (gust vs HRRR): 1.003

## March–April Florida/Gulf diagnostic subset (does not decide the verdict)

No-report points where HRRR-only and full NBM were both ≥5% (12,040 points, as in the closed diagnostic):

- Brier change (sum): full NBM +50.116; gust-only +7.538
- Mean probability: HRRR 0.1291; full NBM 0.1385; gust-only 0.1314
- Same subset defined with the gust arm (13,806 points): change +7.603
- All March–April Florida/Gulf points: full NBM +41.479; gust-only +5.235

Criteria: {'1_national_better': False, '2_no_region_worse': False, '3_calibrated_15pct': True, '4_hit_retention_ge_95pct': True}
