# NBM thunder and gust guidance for Day 2 damaging wind: audit, pinned inputs and pass rule

Committed 2026-11-25, after the availability audit and before any NBM predictor was fitted.
Development data only. 2021 results remain diagnostic; 2025 stays sealed.

## 1. Availability audit (`availability-audit.json`, made by `availability_audit.py` on 2026-11-25)

Archive: `s3://noaa-nbm-grib2-pds`, 12Z core run of each issue date.
- **728 development dates:** every needed GRIB and index object present, and every needed record present (both 12 h thunder periods, all pinned gust hours). 0 missing.
- **Output hours:**
  - 2022-23 core output is hourly to f036, then 3-hourly (f039, f042, f045, f048);
  - current output (2026-11-17..24) is hourly to f048.
- **Version fingerprint** (number of index records at f036):

  | Records | Dates | Version |
  |---|---|---|
  | 119 | 2022-01-01 → 2023-01-16 | NBM v4.0 |
  | 164 | 2023-01-17 → 2023-12-29 | consistent with the NBM v4.1 implementation |
  | 213 | 2026-11-17 → 2026-11-24 | current operational v5.x |

  Training therefore uses v4.0 and v4.1; prospective use would be v5.x. This version shift is a known limitation.
- **Cutoff evidence:** the latest S3 LastModified of the needed objects is after the 15:10 UTC issuance cutoff on two dates:
  - 2022-01-06 (re-uploaded at 2022-01-07T02:53Z);
  - 2023-01-20 (15:14Z).

  Both are excluded from both arms. All other dates, and every current day, are listed by about 13:10Z.
  LastModified on archived objects is evidence of listing time, not proof of first availability.

## 2. Pinned inputs
- **Cycle:** the 12Z NBM core run of the issue date only, the same initialization as the 12Z HRRR. No later cycle or update is ever used.
- **Thunder:** `TSTM:surface:24-36 hour acc fcst:probability forecast` (in f036) and `...36-48...` (in f048), in %.
  The two 12 h periods tile the Day 2 window (12Z D+1 to 12Z D+2) exactly.
- **Gust:** `GUST:10 m above ground:N hour fcst:` (the ensemble std-dev record is excluded), in m/s.
  N = 24..36 hourly, plus 39, 42, 45. These are the hours present in 2022-23, inside [f24, f48).
  Current hourly output is subsampled to the same 16 hours.
- **GRIB identity checks** (from the collector's `nbm_decode`):
  - gust: instant, discipline 0 / category 2 / number 22, 10 m;
  - thunder: accumulation over exactly the pinned period, category 19 / number 2, units %.
- **Mapping:** the maximum over NBM 2.5 km cells within 40.2336 km of each CONUS sample, plus the nearest cell. 783 / 840 / 974 cells per sample (min / median / max), with no sample lacking a cell.
- **Seven predictors** (`conus_nbm.FEATURES`), appended in raw units to the frozen engineered HRRR predictors:
  - gust max and gust mean;
  - each 12 h thunder period (neighborhood max and nearest);
  - the larger of the two thunder maxima.

## 3. Comparison (fixed before fitting)
- **Arms:**
  - `hrrr`: the frozen predictors only;
  - `hrrr_nbm`: the same plus the seven NBM predictors.
- **Dates:** the 728 extracted 2022-23 development dates minus NBM exclusions. The same matched set is used for both arms.
- **Held fixed across arms:**
  - 6 month-grouped outer folds (`phase2_study.fold_of`);
  - the same training-row sample (every event row plus a per-date-seeded 20% of no-event rows, weight 5);
  - the same tree settings, 3 inner month-groups and monotone recalibration;
  - every row of every held-out date scored.
- **Uncertainty:** whole-date bootstrap, 2,000 draws.

## 4. Pass rule (all must hold)
1. National Brier of `hrrr_nbm` lower than `hrrr`, with a 95% interval entirely below zero.
2. No region significantly worse: no 95% interval entirely above zero, in any of:
   - original box;
   - West;
   - Plains outside box;
   - Florida/Gulf/South;
   - Northeast outside box.
3. Calibration: the `hrrr_nbm` mean forecast within 15% of the observed rate nationally.
4. Hit retention: report samples with forecast ≥ 5% under `hrrr_nbm` are at least 95% of those under `hrrr`.

Also reported, but not deciding the verdict:
- Florida/Gulf BSS and calibration;
- false-alarm area at ≥ 5% (no-report samples, km², and per no-report date);
- the national Brier difference separately for the v4.0 and v4.1 periods;
- every excluded date and why.

## 5. After the gate
- **If it passes:** freeze `hrrr_nbm` on all matched dates (commit model and checksum). Add it to the prospective archive as a research candidate, with NBM 12Z fetched by the daily feed before the cutoff. Its records note the v5.x version shift. Fresh verification comes only from that archive.
- **If it fails:** nothing is frozen.
- **Either way:** v0.7 stays live, the CONUS preview keeps the 96-date model, and PR #35 stays draft.
