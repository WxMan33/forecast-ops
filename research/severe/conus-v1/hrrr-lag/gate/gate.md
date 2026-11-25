# Time-lagged HRRR test (Day 2 wind): PASS

724 matched held-out 2022-23 dates, 6 month-grouped folds; 4 excluded from every arm: excluded_by_audit: 06Z and 12Z listed after cutoff: 2022-01-06, 2022-01-08; listed_after_cutoff (found during extraction): 2022-07-23; excluded_by_audit: 12Z listed after cutoff: 2022-08-11. BSS vs development climatology 0.01083.

| Arm | National | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box | mean p / obs | FL/Gulf mean p / obs |
|---|---|---|---|---|---|---|---|---|
| hrrr | 0.115 | 0.133 | 0.049 | 0.078 | -0.006 | 0.128 | 0.998 | 2.097 |
| hrrr_12z18 | 0.127 | 0.150 | 0.050 | 0.080 | -0.021 | 0.135 | 0.999 | 2.160 |
| hrrr_lag | 0.133 | 0.158 | 0.052 | 0.082 | -0.017 | 0.137 | 1.000 | 2.158 |

**Lagged − frozen HRRR** (criteria 1–4), Brier difference, 95% whole-date interval:

- national: -0.000193 (-0.000249 to -0.000141)
- original_box: -0.000478 (-0.000621 to -0.000353)
- west: -0.000006 (-0.000021 to +0.000008)
- plains_outside_box: -0.000032 (-0.000110 to +0.000047)
- florida_gulf_south: +0.000075 (-0.000054 to +0.000214)
- northeast_outside_box: -0.000071 (-0.000144 to -0.000004)

**Lagged − 12Z control** (criterion 5 uses national), Brier difference:

- national: -0.000066 (-0.000091 to -0.000042)
- original_box: -0.000156 (-0.000218 to -0.000096)
- west: -0.000005 (-0.000013 to +0.000002)
- plains_outside_box: -0.000012 (-0.000058 to +0.000029)
- florida_gulf_south: -0.000034 (-0.000100 to +0.000033)
- northeast_outside_box: -0.000018 (-0.000055 to +0.000019)

12Z control − frozen HRRR (context):

- national: -0.000127 (-0.000169 to -0.000086)
- florida_gulf_south: +0.000109 (+0.000013 to +0.000209)

| | frozen HRRR | 12Z control | lagged |
|---|---|---|---|
| Hits at ≥5% (national) | 218,950 | 221,262 | 222,778 |
| Hits at ≥5% (FL/Gulf) | 2,887 | 2,886 | 2,983 |
| False-alarm area ≥5%, km² (national) | 339,186,375 | 329,691,825 | 322,868,925 |
| False-alarm area ≥5%, km² (FL/Gulf) | 11,608,200 | 11,585,700 | 11,485,800 |
| Area ≥5% per no-report date, km² | 37,014 | 32,225 | 30,701 |

Hit retention (lagged vs frozen HRRR): 1.017

## March–April Florida/Gulf diagnostic (does not decide the verdict)

no-report points where hrrr and hrrr_lag are both >= 5%: 11,510 points; Brier change (sum) lagged − frozen +83.263, lagged − 12Z control +20.916; mean p hrrr 0.1329, hrrr_12z18 0.1444, hrrr_lag 0.1469

Criteria: {'1_national_better_than_hrrr': True, '2_no_region_worse_than_hrrr': True, '3_calibrated_15pct': True, '4_hit_retention_ge_95pct_vs_hrrr': True, '5_national_better_than_12z_control': True}
