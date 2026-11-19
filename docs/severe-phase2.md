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
- NOAA has replaced the pinned 2022-2024 Storm Events files (old URLs return 404). All three pinned
  files are now in the private release `severe-replay-sources-v1`: 2024 (uploaded by the owner),
  and 2022 and 2023 (run 44589317670: copied from the checkpoint artifact, uploaded without
  overwrite, then read back with the read-only token; size and SHA-256 match the pins).
- This cloud session cannot reach NOAA's NCEI site or the private archive, so heavy steps run in
  GitHub Actions and commit their results to this branch.

## 9. CONUS first national test (run 44589486745; criterion 5, committed before scores)
Inputs: 108/108 cases (run 44577990940), every case reproducing the regional overlap exactly;
51.5 GB downloaded, 2.9 h extraction, 728 MB stored. Fit on 96 dates (2022-23), scored on the 12
2024 dates (exploratory). 38,838 US-land samples scored, 7,582 coast/border-exposed scored
separately, 1,473 offshore unavailable. Full tables: `research/severe/conus-v1/study/scorecard.md`.

All-supported BSS vs 2022-23 climatology:
| Product | Event dates / pts | v0.7 as-is | v0.7 recipe refit (reference) | CONUS logistic | CONUS trees |
|---|---|---|---|---|---|
| Day 1 tornado | 7 / 797 | +0.009 | +0.034 | +0.040 | +0.013 |
| Day 1 wind | 7 / 7270 | +0.163 | +0.163 | +0.164 | +0.158 |
| Day 1 hail | 7 / 3185 | +0.016 | -0.021 | +0.017 | +0.029 |
| Day 2 tornado | 5 / 638 | -0.029 | -0.045 | +0.030 | +0.045 |
| Day 2 wind | 9 / 6036 | +0.002 | +0.019 | +0.064 | +0.070 |
| Day 2 hail | 8 / 1715 | -0.066 | -0.113 | +0.022 | +0.041 |

**Do the Day 2 gains hold across regions?** (`research/severe/conus-v1/study/judgement.json`)
- **Wind: yes, for both candidates.** They beat the reference in the original box and the plains outside it; the trees also beat it in the West. Overall paired date bootstrap vs the reference excludes zero (logistic -1.1e-3 to -5.5e-5; trees -1.5e-3 to -2.9e-5).
- **Hail: yes by the regional rule**, in the original box and plains outside it (the only two conclusive regions). The overall interval just includes zero.
- **Tornado: inconclusive.** Only the original box has >= 3 verification event dates. The overall difference vs the reference is significant for both candidates, but that comes from one region.
- **Day 1** no longer trails: the candidates roughly tie the reference (wind) or beat it (hail, regional rule holds; logistic significant overall). Day 1 tornado is inconclusive.
- **Extending v0.7 as-is is the weakest option at Day 2** (negative skill for tornado and hail nationally).

**Problems the national test exposes**
- **Florida/Gulf over-forecasting.** On 12 dates with almost no reports there, every model averages 2.5-4% wind probability against an observed 0-0.4%. The active-day map shows 15-45% wind over Florida and Arizona with no reports. No model has learned that summer HRRR convection in Florida rarely produces qualifying reports.
- **West under-forecasting wind** by about 2x (mean 0.3-0.4% vs observed 0.6%).
- **Too few dates.** 21 region/hazard pairs have < 5 verification or < 10 training event dates (`event-support.json`):
  - all six products in the West, Florida/Gulf and the Northeast outside the box;
  - tornado (both leads) in the plains outside the box;
  - Day 2 tornado in the original box.
  Probabilities there cannot be trusted yet.

**Recommendation**
- Keep v0.7 in production.
- The Day 2 gain is now supported nationally for wind and hail. It earns a larger test on dates never used for selection: the 1st/8th/22nd of each month in 2024 (36 dates; extraction cost ~2.5 min/case). 2025 stays sealed.
- Before any national map is published, add regional calibration (or regional terms) and re-check Florida and the West.

## 10. 36-date follow-up with frozen models (criterion 6)
- **Runs:** extraction 44616848705 (36/36 dates, both leads, 17.1 GB, 1.1 h, 241 MB); freeze
  44616849079 (refit Brier difference 0.0 vs run 44589486745; saved models reproduce its predictions
  to 3e-8; models sha256 a9ff6aa7...); scoring 44628021635. Rule committed first (4fcb6c1).
- **Dates:** the 1st/8th/22nd of 2024, confirmed unused in any earlier cohort, label set or
  selection step. Their windows (D 12Z to D+2 12Z) cannot overlap the 15th-17th. 2025 sealed.
- **Full tables:** `research/severe/conus-v1/followup-study/`.

**Day 2 wind repeats.** Both candidates have lower Brier than the v0.7 refit nationally, with whole-date
95% intervals below zero (logistic -7.1e-4 to -2.5e-5; trees -9.1e-4 to -6.7e-5). Both are better in
all five regions, and every region has enough data (>= 5 verification and >= 10 training event dates).
National BSS: v0.7 as-is +0.053, v0.7 refit +0.065, logistic +0.095, trees +0.105.

| Day 2 wind, interior | Event dates (verify / train) | logistic - ref (95%) | trees - ref (95%) | BSS ref / logistic / trees |
|---|---|---|---|---|
| original box | 22 / 56 | -1.5e-3 to +8.5e-5 | -1.9e-3 to +3.0e-4 | +0.076 / +0.108 / +0.112 |
| plains outside box | 18 / 43 | -6.0e-4 to +8.3e-5 | -9.3e-4 to +1.2e-4 | +0.049 / +0.067 / +0.077 |
| West | 15 / 34 | -5.5e-5 to +1.6e-5 | -9.5e-5 to +4.0e-5 | +0.021 / +0.024 / +0.024 |
| northeast outside box | 5 / 19 | -5.0e-3 to -9.1e-5 | -5.2e-3 to -2.0e-4 | +0.160 / +0.244 / +0.264 |
| Florida/Gulf | 5 / 24 | -2.4e-3 to +2.8e-4 | -2.6e-3 to +1.1e-3 | -0.068 / -0.007 / -0.018 |

Every region is better on its point estimate. Individually, only the Northeast interval excludes zero:
the regional gains are consistent but each one is small relative to its date-to-date noise.

**Day 2 hail:**
- The logistic repeats nationally (-5.2e-4 to -1.0e-4; BSS +0.075 vs +0.009) and is better in 4 of 4
  entered regions; it is clearly better in the original box and the plains outside it.
- The trees pass the regional rule, but their national interval includes zero.
- Florida/Gulf (1 event date) and the Northeast (4) are too thin to trust.

**Secondary results:**
- Day 2 tornado: the logistic repeats and holds; the trees do not hold.
- Day 1 hail: the logistic repeats; the trees do not repeat but hold regionally.
- Day 1 tornado: both repeat and hold, in the two regions with enough events.
- Day 1 wind: neither repeats nationally.

**False alarms in practical terms (Day 2, no-report days):**
- **Florida/Gulf** (about 223,000 km^2 of land and 25-mile coastal buffer):
  - Wind: the observed report rate is 0.72%, against mean forecasts of 3.0% (v0.7 as-is), 2.6% (refit),
    2.5% (logistic) and 1.9% (trees).
  - On a typical no-report day (31 of 36), the area at >= 5% is 28,000 km^2 for the refit (13% of the
    region), 26,000 for the logistic and 16,000 for the trees (7%).
  - At >= 15% and >= 30% the area is mostly one day: 2024-10-09/10, Hurricane Milton's landfall. For
    the logistic that day is 93% of the >= 15% area and all of the >= 30% area.
  - **This is a label gap, not only a model error.** The labels use only Storm Events "Tornado",
    "Thunderstorm Wind" and "Hail" (`tools/severe/labels.py`). Hurricane and tropical-storm winds are
    recorded under other event types, so a landfalling hurricane scores as a no-report wind day.
  - Excluding the single largest day, the >= 5% over-forecast is broad: about 21,000 km^2 per no-report day for the
    logistic and 12,000 for the trees.
  - Hail: the observed rate is 0.02%, against mean forecasts of 0.5-1.2%. The trees put no area >= 15%;
    the refit puts 1,400 km^2 per day.
- **West** (about 3.26 million km^2): the earlier under-forecast did not repeat. Wind mean forecast
  0.29-0.37% vs 0.38% observed. Area >= 15% on no-report days is at most 536 km^2 per day (trees) and
  zero at >= 30% for the refit, logistic and trees.

**Maps:** `followup-active-2024-01-08-day2.png` (the Southeast wind outbreak of 2024-01-09/10; the
trees concentrate on the Georgia/Carolinas reports, but all models also paint 10-30% over the Florida
peninsula) and `followup-false-alarm-2024-10-08-day2.png` (Milton landfall, see the label gap above).

### Proposed calibration experiment (not run; needs approval)
1. **Fix the label gap first**, decided before any fitting:
   - Treat samples within 25 miles of a Storm Events "Hurricane (Typhoon)", "Tropical Storm" or
     "Tropical Depression" record in the window as *unknown* (255) for wind, not zero.
   - Report how many samples and dates this removes.
2. **Regional recalibration on top of the frozen models:**
   - A per-region monotone Platt correction (intercept and slope on the frozen logit, by the five
     regions), fit on the existing month-grouped out-of-fold predictions from the 96 development
     dates (2022-23).
   - No change to the underlying models. Lead with the trees for Day 2 wind and the logistic for Day 2 hail.
3. **Verify on a separate, named, unused set:**
   - Dates: the 5th, 12th, 19th and 26th of each month of 2024 (48 dates). Their windows (5-7, 12-14,
     19-21, 26-28) cannot overlap any window used so far.
   - Extraction cost is about 2 hours.
   - The 36 follow-up dates are now spent and would not be reused for verification.
4. **Pre-register before fitting:**
   - Success: Florida/Gulf mean wind forecast within a factor of 2 of the observed rate on the
     verification dates, and the area >= 5% on no-report days at least halved.
   - Guardrail: national Day 2 wind BSS not worse than the frozen model's, by the paired date bootstrap.
5. Production stays on v0.7 throughout. 2025 stays sealed as the eventual untouched test.
