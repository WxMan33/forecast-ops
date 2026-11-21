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
