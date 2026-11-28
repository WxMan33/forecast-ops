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
- 2021 VERIFICATION (one-time, Nov 24): FAILED the pre-committed rule.
  - The frozen 728-day model was scored once on 96 sealed 2021 dates (0 missing).
  - National BSS: 0.099 for the 728-day model vs 0.102 for the 96-day model. Brier difference +0.000027 (95% CI −0.000037 to +0.000101), a statistical tie. Criterion 1 needed a clear win.
  - The other criteria held: no region significantly worse; calibration 0.00953 forecast vs 0.00883 observed; all 96 dates scored.
  - By region (728 vs 96): Plains 0.077 vs 0.064 (significantly better); Florida/Gulf −0.038 vs −0.065 (better, not significant); original box 0.111 vs 0.119 (slightly worse, not significant); West 0.056 vs 0.053; Northeast 0.120 vs 0.126.
  - Both national models clearly beat live v0.7 inside the original box. 728-day minus v0.7 Brier: −0.00041 (95% CI −0.00083 to −0.00007).
  - Caveat: in the development gate, both arms used the same 20% sampling of non-event rows. On 2021 the 728-day model (sampled) was compared with the original 96-day model, which was trained on all rows. So the sampling change and the extra data are mixed in this comparison.
  - Consequences: 2021 is now spent. Nothing is frozen into production. v0.7 stays live. 2025 stays sealed.

6) OTHER WORK (earlier, kept separate)
- A Day 1 tornado "corridor" model and a blend with the existing model were developed and tested. That decision sits in its own PR (#31, with the NadoCast benchmark) and was not mixed into the CONUS work.

OPEN QUESTIONS I MAY ASK YOU ABOUT
- Why a clear development-gate gain (+0.017 BSS on 728 held-out 2022–23 days) became a tie on 2021, and what to try next.
- How to fix the Florida/Gulf over-forecasting (new predictors? climatology-aware calibration?).
- What, besides more data, could close the remaining gap to NadoCast (e.g. HRRR time-lagged ensembles, more model runs, better report-density handling).
- When the CONUS view would be ready to go live.
```

## 2021 verification result

FAIL. Full table: `research/severe/conus-v1/verify2021/verification.md` (run 45490929880). The summary is inside the paste box above, under section 5.
