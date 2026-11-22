# NadoCast head-to-head benchmark: Day 1 tornado (research)

The rules and date lists in `research/severe/nadocast/benchmark-rules.json` were committed before any
of our forecasts or NadoCast grids for these dates were fetched or scored. This page summarizes them.
The live v0.7 map and the RRFS/NBM collector schedule are unchanged.

## What the archive holds
Source: read-only inventory of `data.nadocast.com`, run 44939962476. It covered 2022-2024 and 2026;
2021 and 2025 were never requested. Daily NadoCast grids are GRIB2 TORPROB/WINDPROB fields in
percent, on a 387x226 Lambert grid at 15.237 km (the cropped HREF grid), with no missing values.

| Model | Cycle / period | Meaning | 2024 coverage |
|---|---|---|---|
| 2022 models, SPC-calibrated and absolutely calibrated | 12Z f24-47 | Day 2 for the next convective day | 331 issue dates |
| 2022 models | 12Z f02-23 | Day 1, starting about 13:30Z | 316 |
| 2022 models | 18Z f02-17 | Day 1 update | 333 |
| 2024_preliminary models | 12Z f01-23, 12Z f24-47 and 18Z f01-17 | From 2024-03-01 | about 280 |
| 2020 models | 10Z, 14Z and 20Z intraday updates | Tornado only | — |

Archive gaps:
- There is **no 0Z cycle**.
- Only a few dates exist for 2023-01 and 2023-08; 2023-11 is absent.
- 36 valid days in 2024 have no matched file.

## Fair pairing
- **Same decision cutoff.** Our Day 1 comes from 06Z HRRR and is issued about 09Z on day D. The
  latest NadoCast forecast available by then is the **D-1 12Z f24-47** run, valid for the same
  12Z-12Z convective day. NadoCast's own Day 1 (12Z f02-23 on D) is issued after the day has started.
  It uses newer data and a window that starts about 13:30Z, so it is reported only as a later-cutoff
  reference.
- **Availability.** The HTTP Last-Modified time of each NadoCast file must be at or before 09Z on D.
  Dates that fail this are dropped and listed.
- **Same event.** Both forecasts are the probability of a tornado report within 25 miles during
  12Z-12Z. Both are verified against the same pinned NCEI Storm Events Tornado reports.
- **Common grid and shared footprint.**
  - Forecasts are scored at our v0.7 sample centres in the regional box (-100 to -75 E, 30 to 45 N)
    that lie within 25 miles of US land.
  - Each centre takes the nearest NadoCast grid point, which must be within 11 km.
  - The footprint keeps only centres where both forecasts exist.
- **Primary NadoCast product.** 2022 models, absolutely calibrated. Also reported, never deciding:
  - the SPC-calibrated version;
  - the 2024_preliminary models;
  - the later-cutoff Day 1.

## Dates
- **Primary sample:** 246 fresh 2024 days.
- **Exploratory:** 84 days of 2024 that were already inspected in earlier experiments. They are
  scored separately and labelled exploratory.
- **Excluded:**
  - 2021 and 2025, which are sealed;
  - 2022-23, which are v0.7's training and calibration years;
  - 2026, because Storm Events are not final yet.
- **Pilot:** 2024-04-14 and 2024-10-14, the fresh dates nearest mid-April and mid-October.

## Metrics
- **Brier score and difference:** Brier score and Brier skill score against the sample base rate.
  The ours-minus-NadoCast Brier difference gets a 95% date-bootstrap interval.
- **Reliability:** bins at 0.5, 1, 2, 5, 10, 15 and 30%.
- **ROC AUC.**
- **Thresholds:** at 2, 5, 10, 15 and 30%, we report:
  - hits;
  - misses;
  - report days caught;
  - false-alarm area, in km² per day of points at or above the threshold with no report within
    25 miles.
- **Reading rule:** a difference is called only when its 95% interval excludes zero.

## Maps
Both maps are chosen by fixed rules, after the labels are known but before any scoring:
- **Active day:** the fresh day with the most tornado report points in the footprint.
- **Quiet or false-alarm day:** the fresh day with no report points in the footprint and the highest
  maximum of the mean of the two forecasts. Using the mean means the choice favours neither model.

## Day 2 wind
The archive supports a fair Day 2 wind comparison. NadoCast's 12Z f24-47 wind runs (2022 models,
absolutely and SPC-calibrated, plus `wind_adj`) cover 330 valid days of 2024. They have the same
cycle and valid window as our Day 2, which uses 12Z HRRR f24-48. That comparison is not scored in
this run.

## Amendment 1 (2026-11-21, after the pilot, before full scoring)
The reported-only variants now get the same availability check as the primary product:
- the SPC-calibrated and 2024_preliminary D-1 files must be written by 09Z on D;
- the later-cutoff Day 1 must be written by 18Z on D.

A file that fails the check is treated as unavailable for that variant only.

Why: in the pilot, the 2024_preliminary file for 2024-04-14 was written on 2024-07-24, so it was
regenerated later and is not a real-time forecast. The primary files were written at 15:28Z on D-1.
Nothing else changed.

## Result (score run 44961880902; extraction runs 44942885255 and 44961446546)
All pipeline checks passed.
- The footprint has 14,940 points (100% of the supported box). The nearest NadoCast point is at most
  10.6 km away (median 6.0 km).
- 323 of 330 dates were scored. Seven were dropped because the primary NadoCast file was written
  after 09Z on D: 2024-02-14, 02-21, 04-30, 07-17, 07-24, 11-24 and 12-22.
- 2024-05-31 failed once with a transient error and was re-extracted.

### Primary sample: 240 fresh 2024 days, 103 with tornado reports
| | Ours (v0.7) | NadoCast (2022, abs. calibrated, D-1 12Z) |
|---|---|---|
| Brier score | 0.003529 | **0.003228** |
| Brier skill vs base rate | 0.026 | **0.109** |
| ROC AUC | 0.954 | **0.973** |
| Mean forecast (observed 0.0036) | 0.0024 | 0.0036 |

The difference (ours minus NadoCast) is +0.00030 [0.00013, 0.00051], so **NadoCast is clearly better**.

| Threshold | Ours: hits / POD / FA km²/day / report days caught | NadoCast: hits / POD / FA km²/day / report days caught |
|---|---|---|
| 2% | 6,144 / 0.47 / 50,000 / 61 | 10,172 / 0.78 / 117,500 / 81 |
| 5% | 3,220 / 0.25 / 17,800 / 38 | 7,729 / 0.59 / 51,700 / 56 |
| 10% | 1,892 / 0.15 / 8,200 / 25 | 5,624 / 0.43 / 25,700 / 41 |
| 15% | 1,396 / 0.11 / 5,300 / 21 | 3,704 / 0.28 / 11,300 / 27 |
| 30% | 702 / 0.05 / 2,400 / 18 | 1,157 / 0.09 / 1,700 / 9 |

Out of 13,039 report points in total.

**Reliability (observed frequency for a forecast in the bin):**
- NadoCast tracks the diagonal: 2-5% → 3.4%; 5-10% → 7.0%; 10-15% → 11.2%; 15-30% → 19.9%;
  ≥30% → 38.8%.
- Ours is under-confident at low and middle values: 2-5% → 7.9%; 5-10% → 11.4%.
- Ours is over-confident at the top: 15-30% → 18.4%; ≥30% (mean 50%) → 21.7%.

### Reported only
- **Exploratory (83 previously inspected days):** the same ranking. Brier 0.00432 vs 0.00391, with
  difference [0.00013, 0.00074].
- **NadoCast SPC-calibrated:** slightly worse than its absolutely calibrated field, with a fresh-day
  difference of [-0.00001, 0.00015].
- **NadoCast 2024_preliminary:** 195 of its files failed the availability check (regenerated later).
  On the 103 days that passed it matches the 2022 models.
- **NadoCast later-cutoff Day 1 (12Z f02-23 on D):** better again than its D-1 run, by
  [-0.00021, -0.00007]. That is expected from fresher data, but the window starts at about 13:30Z.

### Maps (preselected by rule)
- **Active day: 2024-12-28** (896 report points in the footprint, Louisiana to Georgia).
  - Ours focused on Louisiana and Mississippi, peaking at 46%. It hit 246 of 896 report points at
    ≥5% and missed the Alabama/Georgia corridor.
  - NadoCast covered the whole corridor, peaking at 59%, and hit 857 of 896. It also had 374,000 km²
    at ≥5% with no report, against 79,000 km² for ours.
- **Quiet / false-alarm day: 2024-09-11** (Hurricane Francine landfall, no tornado report points in
  the footprint).
  - Both models flagged the coast, ours at up to 30% and NadoCast at up to 35%.
  - Ours flagged 35,100 km² at ≥5%; NadoCast flagged 114,750 km².

### What this means on shift
**NadoCast was the better guide.** Its probabilities mean what they say. It caught more than twice
as many report points at every threshold from 2% to 15%, and it outlined whole outbreak corridors
that ours missed (2024-12-28).

**Where ours helped:**
- It drew much smaller areas. At 5% that was 17,800 vs 51,700 km² per day of false-alarm area, and
  2,900 vs 9,000 km² per day on days with no reports.
- At ≥30% it flagged 18 report days versus NadoCast's 9.

**Ours is not ready to replace NadoCast:**
- About three-quarters of its tornado report points fall below 5%.
- Its high values verify at about 22%, not 50%.
- It covers only the regional box.

# Day 2 damaging wind benchmark (rules locked 2026-11-22, before scoring)
The full rules and date lists are in `research/severe/nadocast/day2-wind-rules.json`. In brief:

**Event:** a Thunderstorm Wind report of at least 50 kt within 25 miles during convective day D+1
(12Z D+1 to 12Z D+2).
- Our labels use NCEI Storm Events. Points near reports with no magnitude are marked unknown and
  dropped for every model.
- NadoCast's `wind` target is the same Storm Data definition.
- `wind_adj`, which re-weights estimated reports, is reported only.

**Pairing:** both forecasts come from the same 12Z cycle on D.
- Ours is 12Z HRRR f24-48, issued about 15Z.
- NadoCast's is 12Z f24-47, written about 15:30Z.
- The decision cutoff is 18Z on D. NadoCast files written after it are dropped.

**Models:**
- live v0.7 (regional box only);
- the frozen CONUS v0.7 refit;
- the frozen logistic and boosted-tree candidates;
- NadoCast 2022 models, absolutely calibrated.

**Footprints:**
- **Regional box:** all five models.
- **CONUS:** the four national models, with Florida/Gulf, the West and the other regions broken out.

**Dates:** 315 matched 2024 issue dates, all reusing the existing extraction outputs.
- 234 fresh dates form the primary sample.
- 81 dates already scored for Day 2 wind are kept separate as exploratory.
- 2024-12-30 and 12-31 are excluded because their window reaches 2025.
- 13 dates have no NadoCast wind file.
- **Pilot:** the fresh dates nearest 2024-05-15 and 2024-08-15.

**Metrics:**
- Brier score, with paired date-bootstrap intervals against NadoCast (and against live v0.7 in the box);
- reliability;
- hits, misses, POD and false-alarm area at 5% and 15%;
- hits at NadoCast's false-alarm area.

**Maps:** chosen by the rules in the JSON file.

## Day 2 wind result (score run 45046549803; pilot 45045882278)
All locked checks passed.
- Footprints: 38,838 CONUS points and 14,940 box points, all kept. The nearest NadoCast point is
  at most 10.6 km away (median 6.0 km).
- All models produced finite probabilities. No label points were unknown.

**Exclusions** (all listed in the scorecard):
- 28 issue dates: NadoCast's file was written after the 18Z cutoff on the issue date, mostly
  overnight or the next day, so those runs are not treated as real time.
- 2 dates whose window reaches 2025.
- 13 dates with no NadoCast wind file.

**Scored:** 287 issue dates (213 fresh primary, 74 previously inspected and kept separate).

### Primary: 213 fresh days, regional box (all five models; observed rate 2.13%)
| Model | Brier | BSS | AUC | Minus NadoCast [95% paired] | Minus live v0.7 [95% paired] |
|---|---|---|---|---|---|
| Live v0.7 | 0.01911 | 0.082 | 0.925 | +0.00318 [0.00223, 0.00425] | — |
| CONUS v0.7 refit | 0.01898 | 0.088 | 0.927 | +0.00305 [0.00208, 0.00418] | -0.00013 [-0.00028, 0.00002] |
| Logistic | 0.01833 | 0.119 | 0.933 | +0.00241 [0.00160, 0.00335] | **-0.00077 [-0.00113, -0.00045]** |
| Boosted trees | 0.01820 | 0.126 | 0.934 | +0.00227 [0.00146, 0.00323] | **-0.00091 [-0.00141, -0.00047]** |
| **NadoCast** | **0.01593** | **0.235** | **0.963** | — | **-0.00318** |

Hits, out of 67,689 report points:

| Model | 5%: hits / misses / FA km²/day | 15%: hits / misses / FA km²/day | Hits at NadoCast's 5% / 15% FA area |
|---|---|---|---|
| Live v0.7 | 47,974 / 19,715 / 298,000 | 24,671 / 43,018 / 82,000 | 45,666 / 29,333 |
| CONUS refit | 43,299 / 24,390 / 241,000 | 22,037 / 45,652 / 67,000 | 45,237 / 29,442 |
| Logistic | 49,524 / 18,165 / 293,000 | 26,702 / 40,987 / 86,000 | 47,418 / 30,502 |
| Boosted trees | 53,601 / 14,088 / 343,000 | 28,258 / 39,431 / 99,000 | 48,310 / 30,329 |
| **NadoCast** | **59,229 / 8,460** / 266,000 | **44,079 / 23,610** / 110,000 | **59,229 / 44,079** |

### Primary: CONUS footprint (four national models; observed rate 1.18%)
| Model | Brier | BSS | Minus NadoCast | 5% POD | 15% POD | Hits at NadoCast's 5% / 15% FA area |
|---|---|---|---|---|---|---|
| CONUS refit | 0.01095 | 0.063 | +0.00166 [0.00122, 0.00214] | 0.59 | 0.28 | 56,761 / 34,205 |
| Logistic | 0.01062 | 0.091 | +0.00133 [0.00096, 0.00174] | 0.67 | 0.34 | 59,750 / 35,460 |
| Boosted trees | 0.01051 | 0.101 | +0.00121 [0.00087, 0.00163] | 0.71 | 0.35 | 60,803 / 35,171 |
| **NadoCast** | **0.00929** | **0.204** | — | **0.81** | **0.56** | **78,891 / 54,901** |

### Regional breakouts (primary, CONUS models)
- **West** (11,249 report points, 83 report days): NadoCast is better than every model, and every
  interval excludes zero.
  - NadoCast POD is 0.43 at 5% and 0.16 at 15%; ours is 0.23-0.32 and 0.05-0.07.
  - At NadoCast's 5% FA area, NadoCast hits 4,791 points; ours hit at most 3,258.
- **Florida/Gulf** (906 report points, 33 report days): every model is worse than the base rate.
  - BSS: NadoCast -0.06; boosted trees -0.09; logistic and refit -0.20.
  - None of the Brier differences is clear (all intervals include 0).
  - Ours over-forecasts badly. Our 5-10% forecasts verify at 1.4-2.4%, and our 5% FA area is
    14,000-31,000 km²/day against NadoCast's 5,600.
  - At NadoCast's FA area, ours catch 286-323 hits against NadoCast's 446.
- **Plains outside the box:** NadoCast is clearly better. The CONUS refit and logistic have negative
  skill there.
- **Northeast:** NadoCast is better, but not clearly (the intervals include 0).

### Reliability (primary, box)
- NadoCast follows the diagonal up to 45%+: forecasts of 58% verify at 53%.
- All of ours over-forecast above 30%: forecasts of 52-64% verify at 33-38%.
- Live v0.7 and the refit under-forecast at 2-10%.

### Reported only
- **Exploratory 74 days:** the same ranking in every footprint.
- **NadoCast SPC-calibrated:** slightly worse than its absolutely calibrated field.
- **`wind_adj`:** worse on our raw Storm Data labels, as expected for a different target.

### Maps (chosen by the locked rules)
- **Active day: issued 2024-05-25, valid 2024-05-26** (Ohio Valley to Mid-Atlantic, 3,455 report
  points).
  - NadoCast hit 3,048 at 15%.
  - Our models hit 1,585-2,164 at 15%, with high values scattered over a wider area.
- **False-alarm rule day: issued 2024-07-14, valid 2024-07-15** (2,995 report points).
  - The symmetric "largest no-report area at 5%" rule picked a broad active day, not a quiet one, so
    this map shows false-alarm footprint on a busy day.
  - The boosted trees spread the most area (2.06 million km² with no report).
  - NadoCast hit 2,200 at 15%; ours hit 1,218-1,605.
