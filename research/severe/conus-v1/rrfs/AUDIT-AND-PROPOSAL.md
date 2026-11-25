# RRFS / REFS for Day 2 damaging wind: availability audit and proposed comparison

Status: **read-only audit plus a draft rule for review.** Nothing has been extracted, fitted, frozen or changed in any
feed or collector. Requested in the PR #31 handoff (comment 7175373664) and roadmap §8 (`docs/severe-phase2.md`).
Audited 2026-11-25 from `s3://noaa-rrfs-ops-pds`, the collector's run history and committed inventories.

## 1. Existing collector and the 60/20 milestone
- **Workflow:** `severe-guidance-collection.yml` (on main). It has been scheduled and enabled since **2026-11-21**:
  - earlier slots show `skipped`;
  - Day 1 runs at 09:4x UTC, Day 2 at 15:4x UTC.
- **What it collects:**
  - HRRR (the v0.7 contract), RRFS 12Z and NBM 12Z;
  - on the **regional production grid** (16,413 samples), **not the CONUS research grid**;
  - classed against the production deadline of **15:30 UTC** (Day 2), not the 15:10 UTC cutoff the CONUS work uses.
- **Day 2 coverage-eligible scheduled collections:** 5 dates, 2026-11-21 through 2026-11-25. All are complete and all
  sources were on time against 15:30 UTC.
- **Finding:** the 2026-11-25 Day 2 collection was complete and coverage-eligible, but the **publish to the private
  archive failed** with a transient GitHub `HTTP 502: Error creating policy` (run 45648173453). The bundle survives
  only as the run artifact `severe-research-guidance-2026-11-25-day2-1`, kept 90 days. It needs a re-publish of that
  exact bundle. Not done here: it changes the collector's archive and needs your approval.
- **Milestone tally:**
  - **5 of 60** matched on-time Day 2 dates;
  - report dates: **not yet known**. No report scoring of these windows exists yet, and late-November wind reports are
    sparse.
  - At about one date per day, 60 dates arrives in late January 2027 at the earliest. The 20 report-date requirement
    will likely take longer, because winter has few qualifying wind reports.
  - The milestone is counted on the regional grid at 15:30 UTC. A CONUS comparison needs its own CONUS, 15:10 UTC
    collection (§5).

## 2. Operational RRFS (deterministic)
- **Archive:** `rrfs.YYYYMMDD/HH/` from **2026-08-12**. NOAA implemented RRFS v1 on **2026-11-03**. Days before that
  are pre-implementation parallel output and must be version-pinned per date before use.
- **Cycles:** 00/06/12/18Z run to **f84**; other hours are shorter.
- **Day 2 arrival** (latest S3 LastModified, 2026-11-17 to 11-25, 9 of 9 days complete):

  | Cycle | Hours covering the Day 2 window | Landed by | Margin to 15:10 UTC |
  |---|---|---|---|
  | 12Z | f24–f48 | 14:44–14:49 UTC | 21–25 min |
  | 06Z | f30–f54 (**the full window**, unlike HRRR 06Z) | 08:16–08:20 UTC | about 7 h |

- **Fields in `2dfld.3km.conus`:**
  - `GUST:surface`;
  - `REFC` (labelled `entire atmosphere (considered as a single layer)`, unlike HRRR's `entire atmosphere`, so the
    contract must map it explicitly);
  - `MXUPHL` 5000–2000 m and 3000–0 m (1 h max);
  - `CAPE` (several layers), `HLCY` 0–1 and 0–3 km, `VUCSH` 0–1 and 0–6 km;
  - `MAXUVV`, `MAXREF`, and `WIND` 10 m 1 h max.
- **Grid:** the same native 3 km grid as HRRR (Phase 1).
- **Magnitudes:** Phase 1 found materially larger RRFS updraft helicity on one case. Distributions must be checked by
  source; an HRRR-trained model must not be fed RRFS values.

## 3. Pre-operational retrospective RRFS
`research/severe/phase2-guidance/retro-inventory.json`:
- **93 days:** July 2023, Jan–Feb 2024, May 2024. 92 can serve Day 2 (12Z f24–f48).
- **Format:** `prslev` files from the pre-operational final retrospective, **not operational v1**.
- **Overlaps:** 5 days overlap the v0.7 cohort, and 2 are 2024 verification dates.
- **Use:** too few, too seasonal and the wrong version to train an RRFS arm, and 2024 days are already inspected. Useful
  only as an exploratory pilot of the field contract and of RRFS-vs-HRRR distributions.

## 4. REFS (ensemble)
- **`refs.YYYYMMDD/HH/ensprod/`** (from 2026-08-12): CONUS ensemble products, hourly to f60:
  - `mean`, `avrg`, `sprd`, `prob`;
  - `eas`, `lpmm`, `pmmn`, `ffri`.
- **`rrfsens.YYYYMMDD/HH/mNNN/`** (from 2026-09-09): members **m001–m005**, `2dfldnomads` and `prslevnomads`.
- **Arrival for Day 2:**
  - **12Z misses the cutoff:** members landed by 15:14–15:26 UTC and products by 15:28–15:31 UTC (Nov 24–25).
  - **06Z** (f30–f54, the full window) was in by 09:14 UTC for products and 08:56 UTC for members on 2026-11-21. That
    was the one day checked before the listing connection dropped; it needs confirming over more days.
  - **A Day 2 REFS test therefore uses the 06Z ensemble**, which is a lagged ensemble relative to the 12Z deterministic
    runs.

## 5. Proposed comparison (draft for review; not locked)
There is **no version-matched history**: operational RRFS exists only from Aug 12, 2026 (v1 from Nov 3). An RRFS arm
can't be trained on the 2022–23 development years, so the test has to be **prospective**.

**Step A: collection** (needs approval, because it adds to the daily research archive). Extend
`conus_prospective.record` to save CONUS-grid RRFS predictors each day with the same 15:10 UTC cutoff:
- the 12Z run over the full Day 2 window, mirroring the frozen HRRR predictor definitions with an explicit field-name
  map;
- the 06Z run's 18 h maxima, plus agreement and spread, as in the HRRR lag recipe;
- a status and reason for every missing or late input. The existing forecast and archive still complete.

No model is fitted in Step A.

**Step B: the comparison**, run once a pre-set sample exists. Identical dates, valid windows, CONUS points and reports
for every arm.

| Arm | Model | Role |
|---|---|---|
| A: HRRR | frozen `lag_full` (06Z + 12Z HRRR, already in the archive) | control |
| B: RRFS-only | the same recipe on RRFS predictors, trained by month-grouped CV on the collected days | diagnostic |
| A′: HRRR refit | the same recipe on HRRR predictors, trained the same way on the same days | like-for-like control for B |
| C: HRRR + RRFS | stacked: `lag_full` logit + RRFS predictors, trained by the same CV | **decides the verdict** |

- **Verdict, C vs A** (the five-criterion pattern):
  1. national Brier better, 95% whole-date interval below zero;
  2. no region significantly worse;
  3. calibration within 15%;
  4. hit retention ≥ 95%;
  5. **hits at matched false-alarm area**: C's 5% hits when its threshold is set to give A's false-alarm area, at
     least equal to A's.
- **Reported against A:**
  - Florida/Gulf Brier, calibration, hits and false-alarm area;
  - B vs A′ (what RRFS alone can do, like for like);
  - coverage loss from missing or late RRFS.
- **Sample before running** (fixed now): ≥ 120 paired days with final Storm Events scores, at least 30 of them with
  national reports and at least 8 with Florida/Gulf reports. That most likely means late spring 2027. Preliminary
  scores are monitoring only.
- **NadoCast head-to-head:** only on dates where an archived NadoCast forecast exists with a matching valid window,
  footprint and issuance before 15:10 UTC. Availability for 2026–27 dates is still to be audited.

**How this fits the Phase 1 four-way protocol** (A HRRR, B +NBM, C +RRFS, D +RRFS+NBM):
- The HRRR baseline becomes the lagged HRRR recipe.
- The grid is CONUS, not regional, and the cutoff is 15:10 UTC, not 15:30.
- Both NBM arms failed CONUS gates (`nbm/OUTCOME.md`, `nbm-gust/OUTCOME.md`), so B and D are dropped from the primary
  test. NBM features can be reported as context only.
- The 60/20 milestone stays as the regional collector's milestone. This CONUS test uses its own 120/30/8 sample rule.

**REFS** (a separate later test, anchored to the best deterministic arm): 06Z REFS `prob`/`eas`/`sprd` (or member
agreement) added to the winner of Step B. It's judged on reliability and on hits at matched false-alarm area, with
ensemble coverage and model-version changes tracked.

**Optional exploratory pilot** (development only, cheap): the 92 retrospective days to check the RRFS field map and
compare RRFS-vs-HRRR value distributions, especially updraft helicity. No verdict comes from it.

v0.7 stays live, the CONUS preview keeps the 96-date model, the lagged HRRR trial keeps collecting on its locked rules,
PR #35 stays draft, and 2025 stays sealed.
