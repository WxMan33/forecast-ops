# Daily severe model: methods review and decisions to freeze before 2025

Status: proposal. Nothing here changes v0.7, its labels, its training or the published feed.
The 2025 outcomes remain untouched. All numbers come from committed 2022–2024 labels, the
committed v0.7 development scores and the 2026-11-16 live feed, using the scripts in
tools/severe/exploratory. The 2024 development dates have already been used to choose
between model versions, so every 2024 result below is exploratory.

## 1. Offshore samples

The 100°W–75°W, 30°N–45°N grid includes the Gulf of Mexico and the Atlantic. Using the site's
state outlines as a land mask:

| Sample class | Samples | 2022–2024 report rate (tornado / wind / hail) | Share ever positive (tornado / wind / hail) |
| --- | ---: | --- | --- |
| Land | 14,163 | 0.25% / 2.47% / 1.24% | 16% / 79% / 56% |
| Water within 25 miles of land | 762 | 0.19% / 1.19% / 0.37% | 13% / 49% / 24% |
| Open water beyond 25 miles | 1,488 | 0.001% / 0.003% / 0% | 0.07% / 0.2% / 0% |

Reports essentially never occur more than 25 miles offshore, because nobody is there to make
them, not because storms are absent. The model has no land/sea or population input, so open-water
samples teach it that strong convective environments often produce no report.

On 2026-11-16 the live feed's mean open-water probability was 2–10 times its land mean for
every product. Five of the six product peaks were offshore: Day 1 tornado 40 km out, Day 1 hail
263 km, Day 2 tornado 44 km, Day 2 wind 95 km, Day 2 hail 174 km.

**Proposal.** Treat samples more than 25 miles from land as outside the target population. That
means excluding them from training, calibration and scoring, and showing them as "no forecast" in
the viewer. The inside edge stays because coastal reports still reach it.

As you noted, this changes the training population. It therefore needs a new model version
(v0.9), retrained and recalibrated, then compared with v0.7 on the 2024 dates as one more
exploratory comparison. Withholding open-water values in the viewer alone, with v0.7 unchanged,
is a display decision. It could ship sooner, labeled as a display mask.

## 2. Climatology baseline

Skill is currently measured against a single constant training-period report rate. I tested one
alternative, with its parameters fixed before scoring:

- **Inputs:** report occurrence from the 2022–2023 15th-of-month windows.
- **Season:** the target month ±1.
- **Smoothing:** Gaussian, sigma 100 km, truncated at 300 km.
- **Scoring:** once, on the 2024 dates.

| Product | v0.7 vs constant | v0.7 vs seasonal-spatial | Seasonal-spatial vs constant |
| --- | ---: | ---: | ---: |
| Day 1 tornado | +5.0% | +5.5% | −0.5% |
| Day 1 wind | +23.1% | +23.9% | −1.2% |
| Day 1 hail | +0.8% | +3.0% | −2.3% |
| Day 2 tornado | −0.8% | +0.2% | −1.0% |
| Day 2 wind | +5.4% | +7.2% | −1.8% |
| Day 2 hail | −1.5% | +3.7% | −5.5% |

With only 24 report dates behind it, the seasonal-spatial baseline is noisier than the constant
and scores worse for every product. It is not a stronger reference at this sample size. That
v0.7 "beats" it should not be read as skill.

**Proposal.** A report climatology needs reports only, not HRRR. Build it from many earlier
Storm Events years, for example 2010–2021, using the frozen label definition, then fix its
parameters before any further scoring. 2022 onward stays out of it, and 2025 is never used.
Report both baselines.

## 3. Reproducible inputs

Joined predictor/label artifacts live only in GitHub Actions storage:

- **Run 42321856909:** the original 36 cases (about 204 MB). It expires **2026-12-07**.
  severe-daily-baseline.yml (the v0.6 reproduction) and severe-expanded-cohort.yml (rebuilding
  the v0.7 cohort) download from it, so neither can be re-run after that date.
- **Run 43901185832:** all 108 v0.7 cases, re-uploaded, plus the v0.7 models (about 559 MB). It
  expires **2027-02-14**. Both v0.7 and the v0.8 experiment depend on it.

**Proposal.** Before 2026-12-07, copy both runs' artifacts to a GitHub Release. Commit a manifest
of names, sizes and SHA-256 hashes, and point the workflows at the release. The NCEI report files
are already pinned by hash. Creating the release publishes about 760 MB, so it is left for the
owner to approve.

## 4. Uncertain report locations

A tornado with no end point, or any report with no location, currently marks that hazard unknown
for the whole grid and window. That would drop the entire day from fitting and scoring. No such
record occurred in 2022–2024: all three sources normalized with zero uncertain records. It will
matter for prospective verification and for 2025, where busy days are the most likely to carry a
bad record.

**Proposal.** Bound the unknown area instead of blanking the grid:

- **Missing location:** mark unknown the record's county or zone (CZ_FIPS) plus 25 miles.
- **Missing tornado end point:** mark unknown a circle of plausible path length (for example
  100 km) plus 25 miles around the begin point.
- **Unreadable magnitude:** keep the current 25-mile rule.

Fix the rule before 2025 labels are built, and report how many windows each case touches.

## 5. Uncertainty from twelve dates

Each product's development result rests on twelve dates, four to seven of which had any reports.
The percentile bootstrap over dates is fragile at this size. That does not show its intervals are
too narrow, but they should not carry a decision on their own.

**Proposal.** Alongside each interval, report:

- the per-date differences;
- how many dates favor each model;
- the dates with reports.

Decisions for 2025 should be stated as rules fixed in advance.

## Decisions to freeze before the single 2025 evaluation

1. The model under evaluation: v0.7 as published (model hash a83218fb…), or a successor chosen and
   frozen before 2025 is opened.
2. The target population: whether open water beyond 25 miles is excluded (section 1).
3. The label definition, including the uncertain-location rule (section 4).
4. Metrics and baselines: Brier score, the constant rate, the long-record report climatology
   (section 2), reliability bins as in assets/severe-daily/models.json, and the product-level
   rules for "no demonstrated skill" and over/underforecast flags.
5. The resampling unit (whole dates), the reporting format (section 5), and what result would
   keep, retrain or withdraw each product.
6. Archived, hash-pinned inputs (section 3).

After these are written down and committed, 2025 is opened once and the results are published
whatever they show.
