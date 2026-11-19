# Severe Phase 2: HRRR study, CONUS pilot and RRFS/NBM readiness (research only)

Nothing here changes the live Severe feed, the publisher, the production model (v0.7) or the
model registry. 2025 outcomes stay sealed: no tool loads them, and the scripts refuse 2025 dates.
Judging rules were committed (7c2ef99, `docs/severe-phase2-criteria.md`) while the study was
still training, before any score existed.

## 1. Training-data audit
| Split | Dates | Range | Day 1 dates with no report |
|---|---|---|---|
| train | 48 | 2022-01-01 to 2022-12-22 (1st/8th/15th/22nd) | 18 |
| calibration | 48 | 2023-01-01 to 2023-12-22 | 17 |
| development | 12 | 2024-01-15 to 2024-12-15 (15th) | 5 |

- Calendar-selected, not event-selected: quiet days are about 37% of dates, matching climatology rather than
  over-weighting outbreaks. Labels: NCEI Storm Events (tornado; wind >= 50 kt; hail >= 1 in)
  within 25 miles; Day 1 = 06Z HRRR f06-30, Day 2 = 12Z HRRR f24-48; 3 h release-lag assumption.
- All 108 cases and labels restored from the pinned archive and passed hash checks.
- 2024 was already used to pick v0.6/v0.7/v0.8, so 2024 scores are **exploratory**.
- Event support is thin on the 12 verification dates: tornado 4-6 event dates, hail 6-7, wind 7.
- Full per-date counts: `research/severe/phase2/audit.json`.

## 2. v0.7 reproduction
Exact: largest Brier difference 7.8e-10, largest coefficient difference 3.7e-06
(`research/severe/phase2/baseline-reproduction.json`).

## 3. Candidates (fit on 2022+2023 only)
- **Phase 2 logistic**: asinh-scaled predictors plus CAPE x shear, SRH x shear and UH x shear; L2
  penalty chosen by month-grouped 6-fold CV (each calendar month stays in one fold); monotone
  Platt calibration on the out-of-fold predictions.
- **Phase 2 boosted trees**: small fixed model (200 trees, 15 leaves, >= 2000 samples/leaf), same
  calibration. (The v0.8 trees, trained on 2022 only, were rejected earlier.)

## 4. Scorecard (2024, same dates/points/windows; BSS vs 2022+2023 climatology)
| Product | Event dates / pts | v0.7 | P2 logistic | P2 trees | P2 logistic - v0.7 Brier, 95% date bootstrap |
|---|---|---|---|---|---|
| Day 1 tornado | 6 / 751 | +0.050 | +0.043 | +0.026 | includes 0 |
| Day 1 wind | 7 / 4569 | +0.230 | +0.213 | +0.195 | includes 0 |
| Day 1 hail | 6 / 1924 | +0.008 | -0.032 | +0.023 | includes 0 |
| Day 2 tornado | 4 / 468 | -0.009 | +0.080 | +0.084 | **better (excludes 0)** |
| Day 2 wind | 7 / 4063 | +0.054 | +0.083 | +0.080 | **better (excludes 0)** |
| Day 2 hail | 7 / 1174 | -0.015 | +0.075 | +0.067 | includes 0 (9 of 12 dates better) |

Full tables (land-only, four regions, precision-recall, reliability, hits/misses/false alarms at
2/5/10% tornado and 5/15/30% wind/hail): `research/severe/phase2/scorecard.md`.

Cross-validated recipe check (96 dates in 2022-23, same folds, uncalibrated): the Phase 2
logistic recipe has lower Brier than the v0.7 recipe on all six products, by 1-7%.

## 5. Verdict under the pre-committed rules (`research/severe/phase2/judgement.json`)
| | Logistic | Trees |
|---|---|---|
| Lower Brier than v0.7 | 3 of 6 | 4 of 6 |
| Clearly worse anywhere | none | none |
| Higher-probability calibration | passes all 6 | passes all 6 |
| Gains beyond one region | fails Day 1 wind, Day 1 hail; inconclusive both tornado leads | fails Day 1 wind; inconclusive both tornado leads |
| **Decision** | **does not meet the bar** | **does not meet the bar** |

Reading: both candidates beat v0.7 at **Day 2** (tornado and wind significantly for the logistic)
and trail it at **Day 1**. Calibration note: the saved tables give dates *with a forecast* in the
high bins, not event dates; every product had >= 287 event points there, but the
event-date count is an upper bound. Regional tornado tests are inconclusive (< 3 event dates
per quadrant).

**Recommendation:** keep v0.7. Carry the Day 2 result forward as a hypothesis, not a change:
re-test both candidates on the 108-case CONUS set (more regions, more event dates), with Day 1 and
Day 2 judged separately.

## 6. Experimental maps (verification days, not used for fitting)
- Active: 2024-07-15 (3,386 Day 1 land points within 25 mi of a report).
- Quiet: 2024-01-15 (0).
- Forecast probability and observed reports are separate layers. Each map labels the probability
  definition, issue time and valid window. Offshore/Canada samples are shown as unavailable.
- Files: `research/severe/phase2/maps/` (`conus-prototype-*` shows the regional values on the full
  CONUS footprint, with everything outside the box marked unavailable, never zero).

## 7. CONUS coverage and pilot
- Coverage (`research/severe/phase2-conus/coverage.json`, `coverage-map.png`): 38% of US land
  samples (14,940 / 38,838) had training data; the 23,898-sample gap covers the West, western Plains,
  Texas, Florida and New England. 1,473 masked regional samples = the viewer mask exactly. 7,582
  land samples are coast/border exposed (labels biased low); none is truncated by the HRRR edge.
- Grid design: the regional box rule is unchanged; a pinned list
  (`research/severe/conus-v1/extra-samples.npz`) adds 23,898 land samples (40,311 total).
- **Pilot passed** (run 44575042202; 2023-06-15 active, 2023-12-15 quiet; both leads):
  - All 16,413 overlapping points reproduce the archived regional predictors and labels exactly:
    0.0 difference, 0 label mismatches.
  - That includes the 1,395 points whose 25-mile disk crosses the old box edge. Neighborhood maxima
    were always computed on the full native HRRR field, and labels always counted reports outside
    the box, so nothing changes there.
  - Raw audits passed (192 messages per lead).
  - Spot checks in Texas, Florida, the West and New England are populated with plausible seasonal values.
  - On the active day, 87/374/208 Day 1 tornado/wind/hail event points fall outside the old box.
  - Cost: ~63 s and ~235 MB per lead, ~6.5 MB stored per case.
- Full 108-case extraction: 12 restartable month batches (`.github/workflows/severe-conus-extraction.yml`).

## 8. RRFS/NBM readiness
- Operational: 0 coverage-eligible matched dates so far (1 manual), against the 60 matched / 20
  with-reports checkpoint. The collector stays on its own schedule.
- History: 93 retrospective pre-operational RRFS days (Jul 2023, Jan-Feb 2024, May 2024). 89 support
  both leads and carry all eight v0.7 fields. HRRR and NBM history exists for them
  (`research/severe/phase2-guidance/retro-inventory.json`).
- Not yet built: the extraction for those historical RRFS files (~950 MB prslev files, read by byte
  range). There's no data blocker; this is the remaining work for the four-way comparison.

## Blockers met and how they were handled
- NOAA has replaced the pinned 2022-2024 Storm Events files (old URLs return 404). The exact
  pinned bytes come from the frozen-source checkpoint artifact (run 43909210291, expires
  2027-02-14), verified by size and SHA-256. To make this permanent, upload the 2022 and 2023 files to
  the private release `severe-replay-sources-v1` (2024 is already pending there).
- This cloud session cannot reach NOAA's NCEI site or the private archive, so heavy steps run in
  GitHub Actions and commit their results to this branch.
