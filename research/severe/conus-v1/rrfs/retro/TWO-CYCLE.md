# Retrospective RRFS pilot: two-cycle blend test (fixed before scoring)

Committed 2026-11-28 with owner approval, before the two-cycle arm was fitted. This is exploratory development under the [pilot plan](../RETROSPECTIVE-PILOT.md). The run stops after this scorecard.

## Question
Does adding the 06Z RRFS to the HRRR + 12Z RRFS blend improve where risk is placed? In other words, does it catch more report points without drawing a larger false-alarm area, nationally and in Florida/Gulf? On its own, the 06Z run had a worse Florida/Gulf Brier than the 12Z run.

## Fixed inputs
- **Roster:** the 88 matched dates of the [06Z follow-up](FOLLOWUP-06Z.md). Four dates have no 06Z retrospective output: 2024-01-08, 2024-01-09, 2024-05-02 and 2024-05-30.
- **Data:** the checksummed cache from run 46035459501. Nothing is re-extracted.
- **Model:** all four RRFS field groups are kept. The recipe is unchanged from [RULES.md](RULES.md): L2 logistic, C = 0.1, source-specific asinh scaling and standardization fit on the training blocks only. The same held-out blocks are used, and there is no recalibration.
- **Numerical environment:** the [pinned environment](REPRODUCIBILITY.md):
  - `OPENBLAS_NUM_THREADS=1` and `OMP_NUM_THREADS=1`;
  - `OPENBLAS_CORETYPE=Haswell`;
  - numpy AVX-512 dispatch disabled.

## Arms (identical held-out rows)
| Arm | Predictors |
|---|---|
| `hrrr` | HRRR only |
| `hrrr_rrfs` | the current blend: HRRR + 27 12Z RRFS predictors (reference) |
| `hrrr_rrfs_2cyc` | the two-cycle blend: HRRR + 27 12Z + 27 06Z RRFS predictors; each cycle's predictors are scaled separately |

## Metrics (headline: `hrrr_rrfs_2cyc − hrrr_rrfs`)
- **Equal-area hits vs the blend (diagnostic):**
  - within each scope, the reference is the `hrrr_rrfs` false-alarm area at its training-set threshold;
  - each arm's held-out threshold is set so its no-report points do not exceed that count;
  - the paired change in hits, as points of report coverage, comes with whole-date 95% intervals (2,000 draws).
- **Scopes:** matching is done separately in each scope: national, Florida/Gulf, pooled and each block.
- **Why diagnostic:** the matching uses held-out data, so this measures ranking quality and is labelled diagnostic.
- **Hits at the training-set threshold, alongside the diagnostic:**
  - the threshold rule is unchanged: HRRR uses 5%, and the other arms match the HRRR arm's training false-alarm fraction;
  - shown as hit change and false-alarm km²/day for both blends, to show how the gain holds at a cutoff set in advance.
- **Also reported:** paired Brier with whole-date intervals, forecast/observed ratio, reliability, the previous HRRR-referenced equal-area diagnostic, and hits and false-alarm area at a fixed 5%.
- **Florida/Gulf** is reported in full for every scope, whatever the national result. It has 29 report days, 2 of them in winter.

## Reproducibility
- **No pinned reference yet:** the `hrrr` and `hrrr_rrfs` arms have not been run pinned on this roster, so there is no pinned fingerprint to check against.
- **Comparison instead:** their values are compared with the unpinned 06Z follow-up (run 46040031703), with the largest relative Brier and hit-count differences reported.
- **New reference:** this run's prediction and coefficient fingerprints become the reference for later tests on this roster.

## Reading
- This tests whether the 06Z run carries extra information. It cannot show real-time availability, because archive timestamps are provenance only.
- The usual retrospective limits apply: 88 dates, uneven seasons and a pre-operational RRFS.
- 2025 stays sealed. Daily collection continues under its current rules.
