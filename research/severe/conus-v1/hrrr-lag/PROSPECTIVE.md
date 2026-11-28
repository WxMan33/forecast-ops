# Time-lagged HRRR candidates: prospective research verification (pre-registered)

Committed 2026-11-25, before the candidates were frozen and before any prospective record or score existed.
Approved for the **prospective research archive only**. This is not the CONUS preview, not production, and not a
rollout.

## Candidates (frozen once, checksums in `frozen/manifest.json`)
All three are fitted on the same 724 matched 2022-23 development dates with the gate's exact recipe (gate run
45675157126, `RULES.md`), so their differences are the comparison:

| Archive name | Gate arm | Predictors |
|---|---|---|
| `lag_hrrr` | `hrrr` | frozen engineered HRRR predictors (matched control) |
| `lag_12z18` | `hrrr_12z18` | + 12Z 18 h maxima of gust, reflectivity, UH 2–5 km |
| `lag_full` | `hrrr_lag` | + 06Z 18 h maxima, agreement min(06Z, 12Z), spread \|06Z − 12Z\| |

The archive also keeps the 96-date preview model, the 728-date model and v0.7 (in its box) unchanged, for context.

## Daily issuance (`conus_prospective.lagged_candidates`, called by the daily feed)
- **Inputs:** the 12Z and 06Z HRRR runs of the issue date, over the first 18 valid hours of the Day 2 window. Every
  needed object (12Z f24–f48, 06Z f30–f48) must be listed on S3 by **15:10 UTC** on the issue date, the same
  cutoff for both cycles.
- **If either run is missing, late or fails:** the reason is logged in the record (`lagged_candidates.status`:
  `missing`, `listed_after_cutoff` or `failed`) and in the ledger. The three candidate arrays are written as empty
  (NaN). The existing forecast, preview refresh and archive record still complete.
- A record is never rewritten; the existing archive rules (`../prospective/RULES.md`) apply, including late records
  being excluded.

## Scoring
- **Paired dates only:** days where all three candidates were issued on time. Coverage is reported as
  paired days / on-time archive days, with the reasons for every unpaired day.
- **Preliminary (SPC reports) and final (NOAA Storm Events) scorecards stay separate**, as in the archive rules.
- **National and Florida/Gulf are reported separately.** For each:
  - Brier and calibration (mean forecast / observed);
  - report points at ≥5%;
  - false-alarm area at ≥5%;
  - paired Brier differences `lag_full − lag_hrrr` and `lag_full − lag_12z18`, with whole-date bootstrap 95% intervals.

## Review checkpoints (no rollout is proposed before these)
1. **Monitoring:** weekly preliminary scorecard. It is not used for any decision.
2. **First review:** once at least 60 paired days have preliminary scores and at least 20 of them have
   national reports. Everything above is reported, and no decision is made from it alone.
3. **A rollout proposal may be brought only when the final (Storm Events) scorecard has at least 90 paired days**,
   and all of these hold:
   - coverage ≥ 90% of on-time archive days;
   - national `lag_full − lag_hrrr` with the 95% interval below zero;
   - national `lag_full − lag_12z18` with the 95% interval below zero, so the 06Z contribution holds up on fresh data;
   - Florida/Gulf `lag_full − lag_hrrr` with no 95% interval entirely above zero;
   - national calibration within 15%.

   Florida/Gulf calibration, hits and false-alarm area are reported and weighed in review, but do not alone decide.
4. These criteria are fixed now and are not changed after scores are seen.

v0.7 stays live, the CONUS preview keeps the 96-date model, PR #35 stays draft, and 2025 stays sealed.
