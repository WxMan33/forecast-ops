# Retrospective RRFS pilot: 06Z follow-up (fixed before scoring)

Committed 2026-11-27, after the [first scorecard](first/scorecard.md) found a national lead for HRRR + 12Z RRFS over HRRR, and before any 06Z RRFS predictor was fitted.
Development only, under the [pilot plan](../RETROSPECTIVE-PILOT.md). Everything not listed here follows [RULES.md](RULES.md).

- **Roster:**
  - the 88 first-comparison dates with a complete 06Z extract (f030–f054, same valid window 12Z D+1 → 12Z D+2);
  - the four dates with no 06Z retrospective output (HTTP 404) are excluded and logged: 2024-01-08, 2024-01-09, 2024-05-02 and 2024-05-30.
- **Inputs:** the checksummed cache from run 46035459501 (artifact `rrfs-retro-cache`). Nothing is re-extracted.
- **Arms**, all on identical held-out rows:
  - `hrrr`;
  - `hrrr_rrfs`: the 12Z baseline, rerun on this roster;
  - `hrrr_rrfs06`: HRRR plus the same 27 predictors from the 06Z RRFS.
- **Held fixed from RULES.md:** the recipe (L2 logistic, C = 0.1, source-specific asinh scaling and standardization fit on the training blocks only), the three held-out blocks, the thresholds and the metrics.
- **Headline comparison:** `hrrr_rrfs06 − hrrr_rrfs` (does the earlier cycle carry the same information?). Also reported: `hrrr_rrfs06 − hrrr` and the rerun `hrrr_rrfs − hrrr`.
- **Not a real-time claim:** archive timestamps cannot establish real-time availability, so this result is about information content.
