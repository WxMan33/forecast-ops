# Development-fold diagnostic: Day 2 wind (out-of-fold 2022-23 only; no verification data)

AUC 0.5 = no separation, 1.0 = perfect. 'High-probability points' = out-of-fold forecast >= 5%.

| Region | Model | Report / no-report days | Point AUC | Day AUC (area >=5%) | Day AUC (max prob) | Mean area >=5% report / no-report day (km^2) | Share of >=5% area on no-report days | Hi-prob points: AUC report-day vs not | Hi-prob points: AUC event vs not |
|---|---|---|---|---|---|---|---|---|---|
| original_box | logistic | 56 / 40 | 0.94 | 0.99 | 0.99 | 507,492 / 10,974 | 0.02 | 0.79 | 0.65 |
| original_box | trees | 56 / 40 | 0.93 | 0.98 | 0.97 | 568,579 / 10,794 | 0.01 | 0.73 | 0.63 |
| west | logistic | 34 / 62 | 0.94 | 0.91 | 0.92 | 136,218 / 11,522 | 0.13 | 0.55 | 0.66 |
| west | trees | 34 / 62 | 0.95 | 0.93 | 0.93 | 135,986 / 12,644 | 0.14 | 0.57 | 0.67 |
| plains_outside_box | logistic | 43 / 53 | 0.94 | 0.94 | 0.94 | 218,574 / 20,050 | 0.10 | 0.68 | 0.68 |
| plains_outside_box | trees | 43 / 53 | 0.93 | 0.94 | 0.90 | 232,619 / 22,058 | 0.10 | 0.59 | 0.63 |
| florida_gulf_south | logistic | 24 / 72 | 0.88 | 0.88 | 0.85 | 85,303 / 22,381 | 0.44 | 0.60 | 0.73 |
| florida_gulf_south | trees | 24 / 72 | 0.87 | 0.84 | 0.80 | 57,000 / 14,131 | 0.43 | 0.55 | 0.60 |
| northeast_outside_box | logistic | 19 / 77 | 0.96 | 0.90 | 0.92 | 53,171 / 2,463 | 0.16 | 0.59 | 0.61 |
| northeast_outside_box | trees | 19 / 77 | 0.95 | 0.92 | 0.92 | 78,845 / 3,352 | 0.15 | 0.63 | 0.58 |

## Predictors that separate report-day from no-report-day high-probability points

- florida_gulf_south, logistic: x_sbcin_mean 0.33, x_srh01_max 0.66, x_sbcin_nearby_max_mean 0.34, x_srh01_mean 0.64, x_srh01_nearby_max_mean 0.64, x_srh01_nearby_max_max 0.60, int_srh_shear 0.60, x_shear06_v_nearby_max_max 0.59
- florida_gulf_south, trees: x_srh01_max 0.67, x_sbcin_mean 0.35, int_srh_shear 0.64, x_sbcin_nearby_max_mean 0.36, x_srh01_nearby_max_max 0.63, x_srh01_nearby_max_mean 0.62, x_shear06_v_nearby_max_max 0.62, int_cape_shear 0.62
- west, logistic: x_sbcin_mean 0.36, x_sbcin_nearby_max_mean 0.39, x_sbcape_nearby_max_max 0.60, x_sbcape_nearby_max_mean 0.59, x_shear06_u_mean 0.41, x_reflectivity_mean 0.57, int_cape_shear 0.57, x_uh25_nearby_max_max 0.43
- west, trees: x_sbcin_mean 0.37, x_sbcape_nearby_max_max 0.62, x_sbcin_nearby_max_mean 0.38, x_reflectivity_mean 0.60, x_sbcape_nearby_max_mean 0.59, int_cape_shear 0.58, x_shear06_u_mean 0.42, x_reflectivity_max 0.56

## Hits at >= 5% under the committed correction (in-sample on these folds; indicative only)

| Region | Model | Event points | Hits uncalibrated | Hits corrected |
|---|---|---|---|---|
| original_box | logistic | 28847 | 19997 | 22405 |
| original_box | trees | 28847 | 21231 | 23106 |
| west | logistic | 3590 | 1367 | 816 |
| west | trees | 3590 | 1245 | 845 |
| plains_outside_box | logistic | 6166 | 4444 | 3751 |
| plains_outside_box | trees | 6166 | 4470 | 3821 |
| florida_gulf_south | logistic | 729 | 517 | 208 |
| florida_gulf_south | trees | 729 | 415 | 95 |
| northeast_outside_box | logistic | 2004 | 969 | 1506 |
| northeast_outside_box | trees | 2004 | 1186 | 1496 |
