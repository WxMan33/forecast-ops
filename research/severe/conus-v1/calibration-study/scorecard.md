# Day 2 wind regional calibration test (research only)

48 unused 2024 dates (5th/12th/19th/26th). Frozen models sha256 a9ff6aa76b94; corrections fit only on out-of-fold 2022-23 predictions. Rule: docs/severe-phase2-criteria.md section 7. 2025 sealed.

## Primary (original labels)

| Candidate | Pass | FL forecast/observed (95%) | FL area >=5% on no-report days: calibrated/uncalibrated (95%) | National Brier uncal -> cal | Paired diff (95%) |
|---|---|---|---|---|---|
| logistic | **FAIL** | 8.44 -> 2.51 (1.29-8.34) | 0.05 (0.02-0.08) | 0.009441 -> 0.009438 | -1.7e-04 to +1.7e-04 |
| trees | **FAIL** | 5.41 -> 2.04 (1.13-6.96) | 0.00 (0.00-0.01) | 0.009294 -> 0.009294 | -9.6e-05 to +9.1e-05 |

Florida/Gulf: 42 of 48 dates without a qualifying wind report; observed rate 0.0028.

| Model | FL mean forecast | FL ratio | FL area >=5% per no-report day (km^2) | National BSS |
|---|---|---|---|---|
| v0.7 as-is | 0.0273 | 9.78 | 33,691 | +0.061 |
| v0.7 refit | 0.0242 | 8.65 | 24,568 | +0.071 |
| logistic | 0.0236 | 8.44 | 23,523 | +0.102 |
| trees | 0.0151 | 5.41 | 8,245 | +0.116 |
| logistic + regional cal | 0.0070 | 2.51 | 1,211 | +0.102 |
| trees + regional cal | 0.0057 | 2.04 | 38 | +0.116 |

Paired Brier change, calibrated minus uncalibrated (whole-date bootstrap 95%; negative = better):

| Scope | Event dates | logistic | trees |
|---|---|---|---|
| national | 30 | -1.7e-04 to +1.7e-04 | -9.6e-05 to +9.1e-05 |
| original_box | 28 | -1.3e-04 to +5.1e-04 | -1.4e-04 to +2.1e-04 |
| west | 17 | -9.2e-05 to +1.2e-04 | -7.2e-05 to +9.2e-05 |
| plains_outside_box | 20 | -6.9e-04 to +1.7e-04 | -2.8e-04 to +2.6e-04 |
| florida_gulf_south | 6 | -2.7e-03 to -4.8e-04 | -1.3e-03 to +2.5e-05 |
| northeast_outside_box | 5 | -2.1e-03 to +1.7e-03 | -1.1e-03 to +7.5e-04 |

Hits on report days (event points with forecast at or above the threshold):

| Scope | Report days / event points | Model | >=5% | >=15% | >=30% |
|---|---|---|---|---|---|
| national | 30 / 19802 | logistic | 13426 | 7133 | 3091 |
| national | 30 / 19802 | logistic + regional cal | 13456 | 7528 | 3558 |
| national | 30 / 19802 | trees | 13660 | 7344 | 1445 |
| national | 30 / 19802 | trees + regional cal | 13559 | 7292 | 2400 |
| national | 30 / 19802 | v0.7 refit | 11480 | 5613 | 2835 |
| florida_gulf_south | 6 / 133 | logistic | 122 | 52 | 9 |
| florida_gulf_south | 6 / 133 | logistic + regional cal | 57 | 9 | 3 |
| florida_gulf_south | 6 / 133 | trees | 130 | 29 | 5 |
| florida_gulf_south | 6 / 133 | trees + regional cal | 36 | 0 | 0 |
| florida_gulf_south | 6 / 133 | v0.7 refit | 130 | 37 | 10 |
| original_box | 28 / 12219 | logistic | 8857 | 5178 | 2384 |
| original_box | 28 / 12219 | logistic + regional cal | 9629 | 6004 | 3121 |
| original_box | 28 / 12219 | trees | 9398 | 5381 | 1225 |
| original_box | 28 / 12219 | trees + regional cal | 10131 | 6091 | 2161 |
| original_box | 28 / 12219 | v0.7 refit | 7785 | 4116 | 2166 |
| west | 17 / 3465 | logistic | 1555 | 332 | 38 |
| west | 17 / 3465 | logistic + regional cal | 995 | 76 | 10 |
| west | 17 / 3465 | trees | 1146 | 301 | 7 |
| west | 17 / 3465 | trees + regional cal | 689 | 47 | 0 |
| west | 17 / 3465 | v0.7 refit | 1006 | 153 | 34 |

## Tropical-event sensitivity (no-report samples within 400 km of a HURDAT2 track set to unknown)

| Candidate | Pass | FL forecast/observed (95%) | FL area >=5% on no-report days: calibrated/uncalibrated (95%) | National Brier uncal -> cal | Paired diff (95%) |
|---|---|---|---|---|---|
| logistic | **FAIL** | 8.19 -> 2.44 (1.24-8.05) | 0.05 (0.02-0.08) | 0.009466 -> 0.009462 | -1.7e-04 to +1.7e-04 |
| trees | **PASS** | 5.22 -> 1.97 (1.08-6.80) | 0.00 (0.00-0.01) | 0.009321 -> 0.009320 | -9.7e-05 to +9.1e-05 |

Florida/Gulf: 42 of 48 dates without a qualifying wind report; observed rate 0.0029.

| Model | FL mean forecast | FL ratio | FL area >=5% per no-report day (km^2) | National BSS |
|---|---|---|---|---|
| v0.7 as-is | 0.0273 | 9.58 | 33,370 | +0.062 |
| v0.7 refit | 0.0241 | 8.45 | 24,348 | +0.072 |
| logistic | 0.0234 | 8.19 | 23,014 | +0.102 |
| trees | 0.0149 | 5.22 | 8,245 | +0.116 |
| logistic + regional cal | 0.0070 | 2.44 | 1,211 | +0.103 |
| trees + regional cal | 0.0056 | 1.97 | 38 | +0.116 |

Paired Brier change, calibrated minus uncalibrated (whole-date bootstrap 95%; negative = better):

| Scope | Event dates | logistic | trees |
|---|---|---|---|
| national | 30 | -1.7e-04 to +1.7e-04 | -9.7e-05 to +9.1e-05 |
| original_box | 28 | -1.4e-04 to +5.1e-04 | -1.5e-04 to +2.1e-04 |
| west | 17 | -9.2e-05 to +1.2e-04 | -7.2e-05 to +9.2e-05 |
| plains_outside_box | 20 | -6.9e-04 to +1.7e-04 | -2.8e-04 to +2.6e-04 |
| florida_gulf_south | 6 | -2.7e-03 to -4.4e-04 | -1.3e-03 to +6.2e-05 |
| northeast_outside_box | 5 | -2.1e-03 to +1.7e-03 | -1.1e-03 to +7.5e-04 |

Hits on report days (event points with forecast at or above the threshold):

| Scope | Report days / event points | Model | >=5% | >=15% | >=30% |
|---|---|---|---|---|---|
| national | 30 / 19802 | logistic | 13426 | 7133 | 3091 |
| national | 30 / 19802 | logistic + regional cal | 13456 | 7528 | 3558 |
| national | 30 / 19802 | trees | 13660 | 7344 | 1445 |
| national | 30 / 19802 | trees + regional cal | 13559 | 7292 | 2400 |
| national | 30 / 19802 | v0.7 refit | 11480 | 5613 | 2835 |
| florida_gulf_south | 6 / 133 | logistic | 122 | 52 | 9 |
| florida_gulf_south | 6 / 133 | logistic + regional cal | 57 | 9 | 3 |
| florida_gulf_south | 6 / 133 | trees | 130 | 29 | 5 |
| florida_gulf_south | 6 / 133 | trees + regional cal | 36 | 0 | 0 |
| florida_gulf_south | 6 / 133 | v0.7 refit | 130 | 37 | 10 |
| original_box | 28 / 12219 | logistic | 8857 | 5178 | 2384 |
| original_box | 28 / 12219 | logistic + regional cal | 9629 | 6004 | 3121 |
| original_box | 28 / 12219 | trees | 9398 | 5381 | 1225 |
| original_box | 28 / 12219 | trees + regional cal | 10131 | 6091 | 2161 |
| original_box | 28 / 12219 | v0.7 refit | 7785 | 4116 | 2166 |
| west | 17 / 3465 | logistic | 1555 | 332 | 38 |
| west | 17 / 3465 | logistic + regional cal | 995 | 76 | 10 |
| west | 17 / 3465 | trees | 1146 | 301 | 7 |
| west | 17 / 3465 | trees + regional cal | 689 | 47 | 0 |
| west | 17 / 3465 | v0.7 refit | 1006 | 153 | 34 |

## Tropical mask

HURDAT2 files: hurdat2-1851-2025-092326.txt (75202780ce56). No-report samples masked: 5,904; qualifying reports kept positive inside the mask: 88. Dates affected: 2024-06-19, 2024-07-05, 2024-08-05, 2024-09-26, 2024-10-05, 2024-11-05.
