# HRRR + NBM gust only (Day 2 wind): FAILED candidate under the original rule

- **Run:** [45658640918](https://github.com/WxMan33/forecast-ops/actions/runs/45658640918).
- **Rule:** `RULES.md` (pre-registered in 362e65c).
- **Verdict:** FAIL on criteria 1 and 2.
  - National Brier: −0.000003 (95% CI −0.000024 to +0.000015).
  - Florida/Gulf: +0.000043 (95% CI +0.000007 to +0.000079).
  - Calibration and hit retention passed.
- **Controlled-comparison reading** (development folds):
  - The thunder predictors carry essentially all of full NBM's national gain. Removing them also removes most of the March–April Florida false-alarm sharpening (subset change +7.5 vs +50.1).
  - Gust-only still has its own, smaller Florida/Gulf loss.
  - Neither NBM variant is a clean improvement.
- **Status:**
  - Closed. Nothing frozen, and nothing added to the archive or any feed.
  - NBM remains on the research list only as context.
