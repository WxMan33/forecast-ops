# HRRR + NBM (Day 2 wind): FAILED candidate under the original rule

- **Rule:** `RULES.md` (committed before fitting, f357b87).
- **Run:** [45544910438](https://github.com/WxMan33/forecast-ops/actions/runs/45544910438).
- **Scorecard:** `gate/gate.md`.
- **Verdict:** FAIL on criterion 2, "no region significantly worse". Florida/Gulf/South Brier +0.000076, 95% whole-date interval +0.000016 to +0.000142; BSS −0.008 → −0.018.
- **Criteria that passed:**
  - national Brier −0.000082 (−0.000113 to −0.000055); BSS 0.114 → 0.122;
  - calibration 0.999;
  - hit retention 1.014.
- **Status:**
  - not frozen, not added to the prospective archive, never shown in the preview;
  - kept on the research list because of the national gain, which held in both NBM version periods;
  - v0.7 stays live; the CONUS preview keeps the 96-date model; 2025 stays sealed.
- **Follow-up:** a breakdown of the Florida/Gulf loss (by date, season and largest dates; false alarms vs missed reports) comes before any new training run.
