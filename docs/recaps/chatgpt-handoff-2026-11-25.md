# ChatGPT handoff: forecast-ops severe research, Sun Nov 22 – Wed Nov 25, 2026

Paste everything inside the box below into ChatGPT.

```text
HANDOFF: I run "forecast-ops", a personal experimental weather site (GitHub repo WxMan33/forecast-ops). From Sunday Nov 22 to Wednesday Nov 25, 2026 I worked with Claude Code (an AI coding agent) on severe-weather research. Please treat this as background for my follow-up questions.

GROUND RULES (all kept)
- The live Severe product (regional model "v0.7"), its feed, the publisher and the model registry were never touched. v0.7 is still live.
- The RRFS/NBM data collector kept running on schedule.
- 2025 stays sealed as the final untouched test year.
- 2021 was reserved for one-time verification, allowed only after a pre-committed development gate passes. It was used this week and is now spent.
- Every pass/fail rule was committed before its experiment ran. Already-inspected 2024 dates are "exploratory".
- All work runs on branches. I approve anything that goes to main.

1) CONUS SEVERE RESEARCH PREVIEW (draft PR #35, not merged)
- The severe page gets a "View" switch: Regional (live v0.7, unchanged) or CONUS research.
- The CONUS view shows Day 2 damaging wind only: the chance of a ≥50 kt thunderstorm wind report within 25 miles, 12Z–12Z. It comes from a frozen national boosted-tree model trained on HRRR predictors, on about 40k grid points (15 km spacing), trained on 96 days of 2022–23.
- Features:
  - 3 historical replays (active, quiet, and a Florida/Gulf weakness case) plus a saved current forecast;
  - NOAA Storm Events report markers, checked so they exactly reproduce the scored data;
  - county lines;
  - land-only shading;
  - phone layout;
  - a "not available" panel for other day/hazard combinations.
- Fixed an iPhone crash. Browser-built contours (about 165k polygons) used 2.3–3.4 GB. Prebuilt, simplified contours (about 21k points) bring the phone peak to about 0.9 GB. I confirmed it works on my iPhone.
- Automated hosted checks (Playwright/Chromium with iPhone emulation) on two beta hosts: 46 readability checks plus a 1.5 GB memory budget.

2) DAILY REFRESH (PR #46, merged to main Nov 24)
- Every day at 15:10 UTC (10:10 AM ET) a scheduled job rebuilds the saved CONUS forecast from that day's 12Z HRRR, pushes it to the preview and runs the hosted checks.
- If a run is missed, the viewer labels the forecast "EXPIRED" and the hosted check fails.
- Tested end to end on Nov 24. The first scheduled run is today, Nov 25. Claude checks it Nov 25–27.

3) WHERE THE NATIONAL MODEL STANDS (before this week's experiments)
- Inside the original regional box it beats live v0.7 (Brier difference −0.00091, 95% CI −0.00141 to −0.00047).
- Against NadoCast (an established ML severe forecast) on 213 fresh 2024 days, it is well behind nationally: BSS 0.101 vs 0.204.
- It has negative skill in Florida/Gulf (−0.093). It over-forecasts summer convection there that rarely produces reports.
- Earlier fixes that failed their gates: regional calibration, a two-stage regional correction, and downburst predictors.

4) LEARNING CURVE (development data only)
- Trained on 20/40/60/80 of the 96 days and scored on held-out months. National BSS: 0.068 / 0.079 / 0.088 / 0.093, about +0.013 per doubling.
- 40→80 days: +0.014 (95% CI +0.009 to +0.020). That met the pre-committed rule: more data is the lead lever.
- Florida/Gulf stayed about −0.07 at every size.

5) MORE TRAINING DATA: 96 → 728 DAYS
- Extracted the remaining 366 days of 2022–23 (0 failures). Together with earlier extractions, that makes 728 days.
- Memory workaround: training keeps all event rows plus a fixed 20% of non-event rows, weighted ×5.
- DEVELOPMENT GATE (pre-committed): PASSED. On 728 held-out 2022–23 days, comparing the same recipe and the same sampling, 728 vs 96 days:
  - National BSS 0.098 → 0.115; Brier −0.00018 (95% CI −0.00024 to −0.00013).
  - Florida/Gulf −0.039 → −0.007.
  - No region worse; calibration ratio 0.999.
- The model was then frozen on all 728 days, with its checksum committed before any 2021 data was fetched.
- ONE-TIME 2021 VERIFICATION (96 sealed dates, 0 missing): FAILED criterion 1.
  - National BSS: 728-day 0.099 vs 96-day 0.102. Brier +0.000027 (95% CI −0.000037 to +0.000101), a tie. A clear win was required.
  - Passed: no region significantly worse; calibration (0.95% forecast vs 0.88% observed); all dates scored.
  - By region (728 vs 96):
    - Plains 0.077 vs 0.064 (significantly better);
    - Florida/Gulf −0.038 vs −0.065 (better, not significant);
    - original box 0.111 vs 0.119 (slightly worse, not significant);
    - West 0.056 vs 0.053;
    - Northeast 0.120 vs 0.126.
  - Both national models clearly beat v0.7 inside the original box (728-day minus v0.7 Brier −0.00041, 95% CI −0.00083 to −0.00007).
  - CAVEAT: in the development gate, both arms used the same 20% non-event sampling. On 2021, the sampled 728-day model was compared with the original 96-day model, which was trained on all rows. So "more data" and "sampling" are mixed in this result.
  - Outcome: nothing goes to production, v0.7 stays live, the preview keeps the 96-day model, 2021 is spent, 2025 stays sealed.

6) OTHER WORK (kept separate)
- A Day 1 tornado "corridor" model and a blend were developed and tested. That decision is in its own PR (#31, with the NadoCast benchmark) and was not mixed into the CONUS work.

UPDATE, Nov 25 early morning (03:30 UTC)
- PROSPECTIVE ARCHIVE is live.
  - Rules were committed before the first record. Every daily forecast is saved with: issue cycle, valid window, generation time, cutoff (= valid start), on_time flag, input/model/grid/coverage checksums, and probabilities for the 96-day, 728-day and v0.7 models (v0.7 inside its box only).
  - Records are never overwritten. Late forecasts are excluded from scoring. A ledger tracks every date as on_time / late / missed / pending.
  - Preliminary scorecard: SPC filtered wind reports, 36+ h after the window ends; two variants, all reports and ≥58 mph only.
  - Final scorecard: the same frozen files rescored against pinned NOAA Storm Events. The two scorecards are kept separate.
  - First record: 12Z Nov 24 HRRR, valid Nov 25 12Z – Nov 26 12Z. Generated 03:17 UTC, before the 12:00 UTC cutoff: on time. Max probability 19% (96-day), 19% (728-day), 12% (v0.7 in box).
  - The feed and hosted checks still pass. The first scheduled refresh is Nov 25 15:10 UTC.
  - Earliest preliminary scoring of this first record: window end (Nov 26 12Z) + 36 h = Nov 28 00Z (7 PM EST Nov 27). The code already used this rule; an earlier chat message said Nov 27 12Z by mistake.
- NBM TEST (option B chosen): pre-registered and running. NBM 12Z thunder probability (two 12 h periods tiling the Day 2 window) and 10 m gust are added to the HRRR predictors.
  - Audit: 728/728 development dates complete. NBM v4.0 until Jan 16, 2023, v4.1 after; current output is v5.x, a known version shift.
  - Two dates were listed after the 15:10 UTC cutoff and are excluded from both arms.
  - In 2022–23 gusts were archived hourly to f36, then 3-hourly, so the same 16 hours are used for history and for current runs.
  - Pass rule: national Brier better (CI excludes 0), no region worse, calibration within 15%, hit retention ≥95%.
  - RESULT (Nov 25, run 45544910438): FAIL on criterion 2 — Florida/Gulf got significantly WORSE.
    - 726 matched dates; 2 excluded (listed after cutoff); 0 extraction failures.
    - National BSS 0.114 → 0.122; Brier −0.000082 (95% CI −0.000113 to −0.000055).
    - Better: original box 0.133→0.142, Plains 0.077→0.084, Northeast 0.127→0.140. West unchanged.
    - Florida/Gulf BSS −0.008 → −0.018; Brier +0.000076 (CI +0.000016 to +0.000142). Calibration there is about 2.1× over-forecast in both arms.
    - National calibration 0.999; hit retention 1.014; area ≥5% on no-report dates 37,087 → 32,050 km² per date.
    - The national gain held in both NBM version periods (v4.0 −0.000099, v4.1 −0.000063).
    - Outcome: nothing frozen; not added to the archive. NBM helps nationally but makes the Florida/Gulf weakness slightly worse.
  - MARCH–APRIL FLORIDA/GULF DIAGNOSTIC (closed out Nov 25; run 45654910378; verdict unchanged):
    - Reproduction: both folds matched the original gate exactly. Fold 2's first attempt mismatched for an unknown reason (an audit found no code, input, package or thread difference; the CPU model was never logged). The rerun matched all 1,220 rows with zero difference.
    - March–April = 76% of the net Florida/Gulf loss.
    - Main net driver: more confident existing false alarms. At no-report points where both arms were at or above 5%, mean p went 12.9% → 13.9%, which is +92% of the net loss. Points that stayed below 5% improved.
    - Report points: big offsetting effects (NBM lowered: +57%; NBM raised: −54%).
      - Mar 11, 2022: NBM lowered probabilities where reports were (report points at ≥5%: 155 → 134).
      - Apr 29, 2023: NBM raised an already-elevated no-report area in southeast Florida.
    - Clue only: nearby NBM 12 h thunder probability has the strongest association (r ≈ +0.26). A controlled comparison would be needed to show that removing it fixes Florida/Gulf while keeping the national gain.
  - GUST-ONLY NBM TEST (pre-registered; run 45658640918): FAIL on criteria 1 and 2.
    - National: no gain. Brier −0.000003 (95% CI −0.000024 to +0.000015); BSS 0.114 → 0.115.
    - Florida/Gulf still significantly worse: +0.000043 (CI +0.000007 to +0.000079); BSS −0.008 → −0.014; calibration about 2.14× over-forecast.
    - Against full NBM: gust-only gives up nearly all of the national gain (+0.000079, CI +0.000056 to +0.000105). Its Florida/Gulf difference from full NBM is not significant.
    - March–April subset: gust-only largely avoids the spring false-alarm sharpening (+7.5 vs +50.1). Its Florida/Gulf loss mostly comes outside March–April.
    - Reading: the thunder predictors carry both the national gain and much of the spring Florida loss. Neither NBM variant is a clean improvement.
- SAMPLING CHECK (development only; same folds, recipe, calibration and scoring rows): sampling does NOT explain the 2021 tie.
  - National BSS: 96 days all rows 0.096; 96 days sampled 0.098; 728 days sampled 0.115.
  - Sampling effect: −0.000017 Brier (95% CI −0.000030 to −0.000005). Sampling helped slightly.
  - Data effect with sampling fixed: −0.000180 (CI −0.000236 to −0.000128).
  - The exact 2021 comparison, on development data: −0.000197 (CI −0.000255 to −0.000145), clearly better in development but a tie on 2021.
  - Reading (pre-committed rule): sampling is not the cause. The development gain did not transfer to a different year (year-to-year variability or a 2022–23-specific fit).
  - Next per the rule: one pre-registered test of a new input.

PROPOSED NEXT STEPS (as first written Nov 25; a and b now done)
a) Development-only check of the sampling confound, about 30 minutes. Compare three arms on held-out 2022–23 months: 96 days with all rows, 96 days with sampling, 728 days with sampling.
   - If sampling hurt: try "728 days, all rows", which needs chunked training to fit in memory.
   - If not: more data simply didn't transfer to 2021, and the next lever is new inputs (e.g. HRRR time-lagged runs or other fields).
b) Prospective verification. Archive each day's CONUS forecast from the daily refresh (with model checksum, plus the 96-day and v0.7 versions) so a true forward-in-time test set accumulates. Score it against preliminary storm reports within days, and against official NOAA Storm Events later. With 2021 spent and 2025 sealed, this is the only fresh test data left for any new candidate.
c) Lower priority: a targeted Florida/Gulf fix (predictors that separate report-producing summer storms from non-producing ones). It also needs (b) for a fair test.

QUESTIONS I MAY ASK YOU
- Why a clear development gain (+0.017 BSS) became a tie on 2021: year-to-year variance, the sampling confound, or overfitting to 2022–23?
- Is the proposed sampling check well designed? What else would separate the explanations?
- Best ways to close the gap to NadoCast (BSS ~0.10 vs ~0.20) beyond more days of data.
- How to design prospective verification fairly, given the lag and quality differences between preliminary and final storm reports.
- When, if ever, the CONUS view should go live.
```
