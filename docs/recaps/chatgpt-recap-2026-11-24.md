# ChatGPT recap: forecast-ops severe research, Nov 22–24, 2026

Paste everything inside the box below into ChatGPT.

```text
CONTEXT: I run "forecast-ops", a personal experimental weather site (GitHub repo WxMan33/forecast-ops). Over the last 2–3 days (Nov 22–24, 2026) I worked with Claude Code (an AI coding agent) on severe-weather research. Please use this recap as background for follow-up questions.

GROUND RULES WE KEPT
- The live Severe product (regional model "v0.7"), its feed, the publisher and the model registry were never touched. v0.7 stays live.
- The RRFS/NBM data collector kept running on schedule.
- 2025 data stays sealed as the final untouched test year.
- 2021 is reserved for one-time verification, and only if a candidate first passes a pre-committed development gate.
- Every pass/fail rule is written and committed before the experiment runs. 2024 dates that were already looked at are labelled "exploratory".
- All work runs on branches. I approve anything that goes to main.

1) CONUS SEVERE RESEARCH PREVIEW (draft PR #35, not merged)
- Added a "View" switch to the severe page: Regional (the live v0.7 map, unchanged) or CONUS research.
- The CONUS view shows only Day 2 damaging wind: the chance of a ≥50 kt thunderstorm wind report within 25 miles, 12Z–12Z. It comes from a frozen national boosted-tree model trained on HRRR predictors, on a grid of about 40k points (15 km spacing).
- Features:
  - 3 historical replays (active, quiet, and a Florida/Gulf weakness case) plus a saved current forecast;
  - NOAA Storm Events report markers, checked so they exactly reproduce the scored data;
  - county lines;
  - land-only shading;
  - phone layout;
  - a "not available" panel for unsupported day/hazard combinations.
- Fixed an iPhone crash. The browser was building about 165k contour polygons, using 2.3–3.4 GB. Contours are now prebuilt, merged and simplified (about 21k points), and the phone peak is about 0.9 GB. I confirmed it works on my iPhone.
- Automated hosted checks (Playwright/Chromium with iPhone emulation) run on two beta hosts: 46 readability checks plus a 1.5 GB memory budget.

2) DAILY REFRESH (PR #46, merged to main)
- A small scheduled job on main runs every day at 15:10 UTC (10:10 AM ET). It rebuilds the saved CONUS forecast from that day's 12Z HRRR, pushes it to the preview and runs the hosted checks.
- Safety net: if a run is missed, the viewer labels the forecast "EXPIRED" and the hosted check fails.
- Tested end to end on Nov 24. Automated check-ins are scheduled for Nov 25–27.

3) WHERE THE NATIONAL MODEL STANDS
- Inside the original regional box it beats live v0.7 (Brier difference −0.00091, 95% CI −0.00141 to −0.00047).
- Against NadoCast (an established ML severe forecast) on 213 fresh 2024 days, it is clearly behind nationally: BSS 0.101 vs 0.204.
- It has negative skill in Florida/Gulf (−0.093). It over-forecasts summer convection there that rarely produces reports.
- Several earlier fixes failed their pre-committed gates and were not adopted: regional calibration, a two-stage regional correction, and a downburst-predictor experiment.

4) LEARNING-CURVE TEST: IS THE GAP MOSTLY TOO LITTLE TRAINING DATA?
- The national model was trained on only 96 days (four per month in 2022–23).
- Test: retrain on 20/40/60/80 of those days and score on whole held-out months (development data only).
- National BSS rose from 0.068 (20 days) to 0.079 (40), 0.088 (60) and 0.093 (80), about +0.013 per doubling.
- 40→80 days: +0.014 (95% CI +0.009 to +0.020). That met the pre-committed rule, so more data is the lead lever. West and Plains gained the most.
- Florida/Gulf stayed negative (about −0.07) at every size. More data won't fix it; it needs its own approach.

5) SCALING UP
- Extracted HRRR predictors and labels for the remaining 366 2022–23 days (0 failures). Combined with existing extractions, that makes 728 training days (about 7.5 times the original).
- Ran a pre-committed development gate: the same frozen recipe trained on all 728 days vs only the original 96, scored on held-out months.
- Pass required all three:
  1. national Brier improvement with a 95% CI excluding zero;
  2. no region significantly worse;
  3. mean forecast within 15% of observed frequency.
- Memory workaround: training keeps all event rows plus a fixed 20% of non-event rows, weighted ×5. Both arms use the same sample, and held-out days are scored on every row.
- RESULT (Nov 24): PASSED all three criteria on 728 held-out 2022–23 days.
  - National BSS: 0.098 (96 training days) → 0.115 (728 days).
  - Brier difference: −0.00018 (95% CI −0.00024 to −0.00013).
  - By region: original box 0.114→0.133, West 0.036→0.049, Plains 0.066→0.078, Florida/Gulf −0.039→−0.007, Northeast 0.124→0.127 (a tie).
  - Calibration ratio 0.999.
  - Reading: real progress, but still well short of NadoCast's 0.204 (2024 benchmark). Florida/Gulf moved from negative skill to roughly no skill.
- NEXT (approved Nov 24): freeze the 728-day model, then spend the sealed 2021 data once (96 dates) to verify it against the 96-day model and v0.7.

6) OTHER WORK (earlier, kept separate)
- A Day 1 tornado "corridor" model and a blend with the existing model were developed and tested. That decision sits in its own PR (#31, with the NadoCast benchmark) and was not mixed into the CONUS work.

OPEN QUESTIONS I MAY ASK YOU ABOUT
- How to read the gate and the 2021 verification results.
- How to fix the Florida/Gulf over-forecasting (new predictors? climatology-aware calibration?).
- What, besides more data, could close the remaining gap to NadoCast (e.g. HRRR time-lagged ensembles, more model runs, better report-density handling).
- When the CONUS view would be ready to go live.
```

## 2021 verification result

(Pending. Claude adds it here when the run finishes.)
