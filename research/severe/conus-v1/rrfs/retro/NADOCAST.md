# Retrospective RRFS pilot: NadoCast head-to-head (fixed before comparing)

Committed 2026-11-28 with owner approval, before any NadoCast forecast was compared with the pilot models. This is exploratory development under the [pilot plan](../RETROSPECTIVE-PILOT.md). The run stops after this scorecard.

## Question
Can HRRR + 12Z RRFS catch as many Day 2 damaging-wind reports as NadoCast without drawing a larger risk area?

## Matched dates (stage 1, committed before stage 2)
- **Candidates:** the 62 2024 dates of the pilot roster (January–February and May 2024). July 2023 has no NadoCast counterpart in the earlier benchmark, and 2025 stays sealed.
- **NadoCast product:** the same as the [Day 2 wind benchmark](../../../nadocast/day2-wind-rules.json): 2022 models, absolutely calibrated wind, `nadocast_2022_models_conus_wind_abs_calib_<D>_t12z_f24-47.grib2`. It comes from the same 12Z cycle on issue date D and covers the same convective day as ours (12Z D+1 → 12Z D+2).
- **Eligible date**, all of these must hold:
  1. the file is archived (HTTP 200);
  2. its HTTP Last-Modified is at or before 18Z on D, the benchmark's issue-time rule;
  3. where the earlier benchmark pinned a SHA-256 for the date, the fetched file matches it;
  4. it decodes as WINDPROB 24–47 h in percent on the 387×226 grid with no missing values.
- **Inventory output:** `tools/severe/nadocast_rrfs.py inventory` writes `nadocast/nadocast-roster.json`, listing every matched date, every exclusion with its reason, and each file's URL, SHA-256 and Last-Modified. It scores nothing. The comparison runs only on a later request, after the roster is committed.
- **Expected outcome:** from the earlier benchmark's records, about 44 dates should match: 19 in Jan–Feb and 25 in May. The expected exclusions are 6 late files (after 18Z) and 4 known missing files. 8 dates were never checked because they had no HRRR case then. The inventory decides all 62.

## Our predictions
- **Arms:** `hrrr` and `hrrr_rrfs`, the held-out predictions of the first comparison:
  - fit on the other two blocks;
  - fixed L2 logistic recipe;
  - all four RRFS field groups.
- **How they are produced:** regenerated in the [pinned environment](REPRODUCIBILITY.md).
  - Before they are saved or compared, they must reproduce the pinned prediction and coefficient fingerprints in [`repro/scorecard-pinned-1.json`](repro/scorecard-pinned-1.json). The run stops otherwise.
- **Their thresholds:** the training-set thresholds recorded for each held-out block.

## Grid and labels
- **Grid:** our CONUS sample centres (supported samples). NadoCast is taken at its nearest grid point, which must be within 11 km, as in the earlier benchmark. That benchmark kept 100% of samples, with a maximum distance of 10.6 km.
- **Labels:** the same pinned 2024 Storm Events labels as the pilot cache:
  - Thunderstorm Wind ≥ 50 kt within 25 miles;
  - unknown magnitude excluded;
  - identical rows for all three models.

## Metrics
- **Headline: report coverage at NadoCast's 5% false-alarm area (diagnostic).**
  - in each scope, NadoCast's no-report points at p ≥ 5% set the reference area;
  - each of our models' held-out threshold allows at most that many no-report points;
  - hits are reported as points of report coverage, with the paired change from NadoCast and a whole-date 95% interval (2,000 draws, seed 20261128);
  - this is labelled diagnostic because our thresholds are matched on held-out data.
- **At thresholds set in advance:** our training-set thresholds against NadoCast at 5%, as hits and false-alarm km²/day for each model, with a paired hit-change interval.
- **Paired Brier:** our models minus NadoCast, with whole-date intervals. HRRR + RRFS minus HRRR is also reported.
- **Calibration:** forecast/observed ratio and reliability.
- **Counts:** dates and report days.
- **Scopes:** pooled, Jan–Feb 2024 and May 2024, each nationally and for Florida/Gulf (`florida_gulf_south`, its own table).

## Reading
- **Dates are not fresh:** most of these dates were already inspected in the earlier NadoCast benchmark and in this pilot's held-out scorecards.
- **Seasons:** only two 2024 periods.
- **NadoCast's target:** NadoCast treats missing wind magnitudes as 50 kt in training, while our labels exclude them.
- **RRFS:** this is the pre-operational retrospective RRFS, not current operations.
- 2025 stays sealed. The daily scoring job runs on its existing schedule.
