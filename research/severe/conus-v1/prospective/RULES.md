# Prospective CONUS Day 2 wind archive: rules (committed 2026-11-25, before the first record)

Purpose: a forward-in-time test set. 2021 is spent and 2025 stays sealed, so these forecasts are the only
fresh data for judging any new candidate.

## What is archived (one record per issue date, written by the daily feed)
- Issue cycle (12Z HRRR), Day 2 valid window (D+1 12Z to D+2 12Z), generation time, cutoff (= valid start), on_time flag.
- Input checksums: the audited predictor file and the raw-message audit.
- Model checksums:
  - 96-date `conus_gbt` (frozen models.pkl);
  - 728-date candidate (`fulldev-frozen/model.pkl`);
  - v0.7 (baseline-v07/models.json).
- Grid checksum (coordinates, extra-sample list) and coverage version (supported-sample mask; v0.7 box footprint).
- Probabilities on every supported sample for all three models (v0.7 only inside its original box),
  in a compressed file whose SHA-256 is in the record.
- A record is never overwritten. A forecast made after its cutoff is kept, marked late, and excluded from both scorecards.

## Ledger
`ledger.json` lists every issue date from 2026-11-25 as one of:
- on_time
- late
- missed (no record by the cutoff)
- pending

Nothing is backfilled.

## Preliminary scorecard (`prelim/`, early feedback only)
- Source: SPC filtered wind reports for the convective day of the valid window (12Z-12Z), fetched at least 36 h
  after the window ends. The fetched file's SHA-256 is recorded.
- Labels: a sample is positive if a report lies within 25 statute miles (40.2336 km). Two variants:
  - `spc_all_wind` (primary): every report, including unknown speed;
  - `spc_ge58mph`: measured or estimated speed >= 58 mph only (the 50 kt threshold).
- Scored: Brier and BSS against the fixed 2022-23 development climatology (0.01084), mean forecast and observed
  rate, by region. v0.7 is scored only inside its box.

## Final scorecard (`final/`)
- The same frozen probability files are rescored once a pinned NOAA Storm Events file (name, size, SHA-256)
  covers the whole valid window.
- Labels come from the training code (`labels.normalize`, `label_window`: Thunderstorm Wind >= 50 kt, unknown
  magnitude excluded).
- Never mixed with the preliminary scorecard.

## Use
- These scorecards monitor the models; they are not a gate. Any decision based on them needs its own rule,
  committed before it is applied, including a minimum number of scored days and of report days.
- v0.7 stays live and the preview keeps the 96-date model.
