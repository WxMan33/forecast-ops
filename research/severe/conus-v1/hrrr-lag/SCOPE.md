# Time-lagged HRRR (06Z + 12Z) pilot for Day 2 damaging wind: scope and proposed pre-registration

Status: **proposal only.** Nothing has been extracted beyond the 3-date matching check, and no model has been fit.
Development data only; 2021 is spent and 2025 is sealed.

## 1. Archive coverage and arrival (`availability-audit.json`, `availability_audit.py`)

Source: `s3://noaa-hrrr-bdp-pds`, `wrfsfc` files, CONUS.

| Run | Hours needed | 728 development dates | Archive listed after the 15:10 UTC cutoff | Current arrival (Nov 17–25) |
|---|---|---|---|---|
| 06Z of the issue date | f30–f48 | all complete | 2022-01-06, 2022-01-08 | 07:46–07:57 UTC |
| 12Z of the issue date | f24–f42 | all complete | 2022-01-06, 2022-01-08, 2022-08-11 | 13:40–13:50 UTC |

- Record names are identical in 2022, 2023 and 2026:
  - `GUST:surface` (instant);
  - `REFC:entire atmosphere` (instant);
  - `MXUPHL:5000-2000 m above ground` (1 h max ending at the step).
- Both runs arrive well before the preview's 15:10 UTC issuance, so a daily feed could use the 06Z run. It is older
  guidance, not later guidance.

## 2. Common valid hours and matching check (`matching-check.json`, `matching_check.py`)

The Day 2 window is 12Z D+1 to 12Z D+2. The 06Z run reaches f48 = 06Z D+2, so it covers only the **first 18 valid
hours**, 12Z D+1 through 05Z D+2. **The last six hours (06Z–12Z D+2) are outside the lagged run's coverage.** For
them only the existing 12Z predictors apply, and no lagged or agreement value is computed.

| Valid hour H | 06Z run | 12Z run |
|---|---|---|
| instants (gust, reflectivity) | f(30+k) | f(24+k) |
| updraft helicity (max over (H, H+1]) | f(31+k) | f(25+k) |

Here k = 0..17.

Verified on 2022-03-11, 2022-07-15 and 2023-04-29:
- every message decoded to the expected initialization and valid time;
- updraft helicity is a 1 h maximum in both runs;
- the native grid is identical across runs, fields and hours.

Cost was 71–78 MB per date for three fields × two runs × 18 h.

Correlation of 06Z vs 12Z 18-hour maxima at the 40,311 samples:

| Date | Gust | Reflectivity | UH 2–5 km |
|---|---|---|---|
| 2022-03-11 | 0.97 | 0.94 | 0.51 |
| 2022-07-15 | 0.68 | 0.66 | 0.13 |
| 2023-04-29 | 0.92 | 0.90 | 0.29 |

## 3. Proposed predictors (9)

Each is computed over the 18 common valid hours as the maximum of the hourly 25-mile neighborhood maximum, the same
neighborhood rule as the existing extractor. For each field f in {gust, reflectivity, UH 2–5 km}:
1. `lag06_f_max`: the 06Z run's 18 h maximum;
2. `agree_f_min`: min(06Z, 12Z) over the same 18 h, so both runs must show it;
3. `spread_f_absdiff`: |06Z − 12Z| over the same 18 h, the run-to-run disagreement.

These are appended to the frozen 12Z predictors unchanged. Gust has no counterpart in the frozen set, so a control
arm separates new 12Z gust information from lagged-run agreement (see §5).

## 4. Extraction cost

- Data: about 75 MB per date, roughly 55 GB for the 728 development dates. Only three fields per hour are fetched,
  by byte range.
- Time: about 1–1.5 h wall time in 8 parallel batches, including the 12Z first-18-hour gust/reflectivity/UH needed
  for the agreement features.
- Storage: about 1–2 MB per date.

## 5. Proposed pre-registered comparison (not yet committed as a rule)

- **Dates:** the 728 development dates minus 2022-01-06 and 2022-01-08 (06Z run listed after the cutoff), so 726.
  The 12Z listing of 2022-08-11 is kept, as in every earlier gate. The HRRR-only baseline is **refit on this
  matched set**, because the NBM gates used a different 726-date set.
- **Arms:** six month-grouped held-out folds; the same training-row sample, seeds, tree settings, inner groups,
  monotone recalibration and scoring rows for every arm.
  - `hrrr`: frozen predictors only;
  - `hrrr_lag`: the same plus the nine predictors in §3. **This arm decides the verdict.**
  - `hrrr_12z18` (control, diagnostic only): the same plus only the 12Z 18 h maxima of gust, reflectivity and UH.
    `hrrr_lag − hrrr_12z18` isolates what the 06Z run adds.
- **Pass rule:** the original four criteria, applied to `hrrr_lag` vs `hrrr`:
  1. national Brier lower, with a 95% whole-date interval entirely below zero;
  2. no region significantly worse (original box, West, Plains outside box, Florida/Gulf/South, Northeast outside box);
  3. national calibration within 15%;
  4. hit retention at ≥5% of at least 95%.
- **Also reported:**
  - Florida/Gulf paired Brier and calibration;
  - hits at 5% and false-alarm area, national and Florida/Gulf;
  - the March–April Florida/Gulf no-report subset where both `hrrr` and `hrrr_lag` are ≥5%, as a diagnostic;
  - every excluded date and why.
- **If it passes:** bring back the scorecard and a prospective plan (the daily feed would fetch the 06Z run before
  the cutoff), then stop for review before freezing anything or changing any feed.
