# Three-arm RRFS comparison (Day 2 wind): chronological training and verification plan

Status: **proposal for review.** Step B stays on hold. Nothing is fitted until this plan is approved and committed as the
rule. Collection (Step A, `COLLECTION.md`) started with issue date 2026-11-26.

## Eligible day
An issue date counts toward either block only if all of these hold:
- the **lagged HRRR candidates** were issued on time (`prospective/ledger.json`: `lagged_candidates: ok`);
- **both RRFS cycles are ok and archived** (`rrfs/collection/tally.json`);
- the prospective record is on time.

A day failing any condition is excluded from every arm and listed with its reason. That keeps the comparison on
identical dates, windows, points and reports.

## Labels
- Both blocks use **final NOAA Storm Events labels**: Thunderstorm Wind ≥ 50 kt within 25 miles, unknown magnitude
  excluded, from a pinned file covering the whole window.
- SPC preliminary reports are monitoring only. They are never used to fit, select, calibrate or judge.
- **Report day:** at least one labelled report point, nationally or in Florida/Gulf/South respectively.

## Blocks (strictly chronological)
| Block | Dates | Closes when | Used for |
|---|---|---|---|
| **Training (T)** | eligible days from 2026-11-26 onward | **≥ 120 eligible days, ≥ 30 national report days, and ≥ 8 Florida/Gulf report days**, all counted on final labels. T is the earliest run of dates that meets all three. | fitting B, A′ and C; every choice of predictors, stacking form and calibration; all inner cross-validation |
| **Embargo** | the 7 issue dates after T's last date | fixed length | nothing; keeps multi-day systems and model-freeze timing out of both blocks |
| **Verification (V)** | eligible days after the embargo | **≥ 90 eligible days, ≥ 30 national report days, and ≥ 8 Florida/Gulf report days** on final labels | the one verdict: frozen models applied once |

- The 120/30/8 thresholds are the **training** milestone.
- The verification milestone is 90/30/8. V needs fewer days because it isn't split for cross-validation, but it needs
  the same number of report days, so its regional checks have the same support.

## What happens in each block
1. **During T:** collection only. No RRFS-arm score of any kind is computed. The HRRR prospective archive continues
   under its own rules (`hrrr-lag/PROSPECTIVE.md`).
2. **At T close** (once final labels cover T):
   - **Fixed now:**
     - the predictor set for B: the RRFS 12Z full-window and 06Z full-window neighborhood maxima and 24 h point means of
       the nine fields;
     - the tree settings (`phase2_study.GBT_PARAMS`) and the 20% no-event sampling;
     - C's stacking form: the logit of `lag_full` plus B's predictors.
   - **Chosen within T by month-grouped inner CV:** only the monotone recalibration, as in every earlier gate.
   - **Then:** fit B, A′ and C on all of T. Freeze them, commit their checksums, and record the T date list and its
     final tally. A stays the already-frozen `lag_full`; it is not refit.
3. **During V:** the frozen models are applied to V's archived inputs. Raw RRFS arrays are archived daily, so this needs
   no re-collection. No V label or score is computed until the models are frozen and committed.
4. **At V close:** one scorecard, scored once:
   - **Verdict:** C vs A (the five-criterion pattern, including hits at matched false-alarm area).
   - **Reported:** B vs A′; Florida/Gulf Brier, calibration, hits and false-alarm area against both A and A′; coverage
     loss from missing or late RRFS by cycle.
5. **Nothing from V flows back.** No refit, recalibration, threshold change or predictor change after V scores are
   seen. A changed model starts a new T.

## Known limits, stated now
- **Seasonality:** T starting in late November will be cool-season heavy, and V will fall in spring–summer. The report
  thresholds stop either block from closing on too few events. A cool-season-trained RRFS arm may still be
  disadvantaged in summer, and the scorecard will say so. Calendar balancing isn't attempted, because it would mean
  waiting a full year.
- **Version changes:** any RRFS, HRRR or HREF/REFS implementation change during T or V is logged. A change during V is
  reported as a caveat; a change during T before freezing restarts T on the new version.
- **Timing:** realistically, T closes around March 2027 by report counts, plus the final-label lag of about 2–4 months
  before fitting. V needs another 90+ eligible days. The verdict is therefore not expected before mid-to-late 2027.

## REFS (later, separate)
- The 06Z REFS is available for Day 2 well before the cutoff: 9 of 9 days (Nov 17–25) had all 8 products by
  09:10–09:18 UTC and all 5 members by 08:53–09:00 UTC. The 12Z REFS misses 15:10 UTC.
- A REFS test is anchored to whichever deterministic arm the V verdict favours. It gets its own T and V blocks after this
  comparison's V, so no REFS choice uses this comparison's V data.

v0.7 stays live, the CONUS preview keeps the 96-date model, PR #35 stays draft, and 2025 stays sealed.
