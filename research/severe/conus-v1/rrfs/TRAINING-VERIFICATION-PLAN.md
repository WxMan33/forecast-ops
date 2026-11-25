# Three-arm RRFS comparison (Day 2 wind): chronological training and verification plan

Status: **revised proposal for review** (2026-11-25: verification is real-time only, starting after the freeze; pre-freeze dates are replay). Step B stays on hold. Nothing is fitted until this plan is approved and committed as the
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
| Block | Dates | Closes / starts when | Used for |
|---|---|---|---|
| **Training (T)** | eligible days from 2026-11-26 | Closes on the earliest run of dates reaching **≥ 120 eligible days, ≥ 30 national report days, and ≥ 8 Florida/Gulf report days**, all counted on final labels. Whether T has closed is only known once final labels cover it. | fitting B, A′ and C; every choice of predictors, stacking form and calibration; all inner cross-validation |
| **Embargo** | the 7 issue dates after T's last date | fixed length | nothing |
| **Replay (R)** | eligible days after the embargo and before the first live issuance of the frozen arms | ends at the freeze (below) | **not verification.** Inputs are kept, so R may later be scored as a clearly labelled historical replay diagnostic. Never counted in the prospective tally or the verdict. |
| **Verification (V)** | eligible days from the **first issue date on which the frozen arms are issued live, on time** (see below) | closes at **≥ 90 eligible days, ≥ 30 national report days, and ≥ 8 Florida/Gulf report days** on final labels | the one verdict: real-time forecasts, scored once |

- The 120/30/8 thresholds are the **training** milestone.
- The 90/30/8 thresholds are the **verification** milestone.
- **V starts on the first eligible issue date that is after both:**
  1. the 7-day embargo; and
  2. the freeze: B, A′ and C fitted on T, their checksums committed, and the daily archive issuing them.
- **Issued live** means the daily feed produces all three frozen arms (and A) before 15:10 UTC from that morning's inputs, and archives them **before their valid window opens**, under the existing archive rules: never rewritten, late records excluded. V measures what the frozen models would actually have shown a meteorologist that morning.
- **An eligible V day** additionally requires that all four arms were issued on time that day. Days where a frozen arm was missing or late are excluded, with their reasons, and count against coverage.

## What happens in each block
1. **During T and the embargo:** collection only. No RRFS-arm score of any kind is computed. The HRRR prospective archive continues under its own rules (`hrrr-lag/PROSPECTIVE.md`).
2. **At the freeze** (once final labels confirm T closed):
   - **Fixed now:**
     - the predictor set for B: the RRFS 12Z full-window and 06Z full-window neighborhood maxima and 24 h point means of the nine fields;
     - the tree settings (`phase2_study.GBT_PARAMS`) and the 20% no-event sampling;
     - C's stacking form: the logit of `lag_full` plus B's predictors.
   - **Chosen within T by month-grouped inner CV:** only the monotone recalibration, as in every earlier gate.
   - **Then:** fit B, A′ and C on all of T. Freeze them, commit their checksums, and record the T date list and its final tally. A stays the already-frozen `lag_full`.
   - **Feed change, for separate approval at that time:** add the frozen arms to the daily archive record or sidecar, so they are issued live before the cutoff. V begins with the first eligible issue date after that change is live.
3. **Replay (R):** dates collected between the embargo and the freeze keep their inputs. They may be scored afterwards only as a labelled replay diagnostic. Replay never enters the prospective tally, the verdict, or any model choice.
4. **During V:** nothing is fitted or tuned. Preliminary SPC scores may be monitored, as for every archive candidate, but they don't decide anything.
5. **At V close** (once final labels cover V): one scorecard, scored once:
   - **Verdict:** C vs A (the five-criterion pattern, including hits at matched false-alarm area).
   - **Reported:** B vs A′; Florida/Gulf Brier, calibration, hits and false-alarm area against both A and A′; coverage loss from missing or late RRFS and frozen arms, by cycle.
6. **Nothing from V flows back.** No refit, recalibration, threshold change or predictor change after V scores are seen. A changed model starts a new T.

## Known limits, stated now
- **Seasonality:** T is cool-season heavy. With the freeze around mid-2027, V falls mostly in summer and early autumn 2027. The report thresholds stop either block closing on too few events. A cool-season-trained RRFS arm may be disadvantaged in summer, and the scorecard will say so.
- **Version changes:** any RRFS, HRRR or REFS implementation change is logged. A change before the freeze restarts T on the new version; a change during V is reported as a caveat.
- **Expected timeline** (estimates; report counts and the NCEI final-label lag of about 2–4 months decide):
  - **T closes about late March 2027:** 120 eligible days from Nov 26 at near-full coverage, provided the 30 national and 8 Florida/Gulf report days are reached.
  - **Final labels covering T: about June–July 2027.** The freeze and the feed change follow, around July 2027.
  - **The first V date is then the first eligible day after the freeze is live, about July 2027.** The days from the embargo to the freeze (roughly April–July 2027) are replay only.
  - **V reaches 90 days / 30 / 8 around October 2027.** Final labels follow about 2–4 months later, so **the verdict is expected around early 2028.**

## REFS (later, separate)
- The 06Z REFS is available for Day 2 well before the cutoff: 9 of 9 days (Nov 17–25) had all 8 products by
  09:10–09:18 UTC and all 5 members by 08:53–09:00 UTC. The 12Z REFS misses 15:10 UTC.
- A REFS test is anchored to whichever deterministic arm the V verdict favours. It gets its own T and V blocks after this
  comparison's V, so no REFS choice uses this comparison's V data.

v0.7 stays live, the CONUS preview keeps the 96-date model, PR #35 stays draft, and 2025 stays sealed.
