# Retrospective RRFS pilot: status (2026-11-28)

**Retrospective reference:** HRRR + 12Z RRFS logistic blend with a 100 km neighborhood mean ([SMOOTHING.md](SMOOTHING.md); 100 km chosen in every fold on training blocks only).

## Results that led here (all on PR #31; exploratory)
| Test | Rule | Result |
|---|---|---|
| First comparison, 92 dates | [RULES.md](RULES.md) | HRRR + 12Z RRFS beats HRRR: +4.2 points of hits at the training-set threshold, with 1.5% more false-alarm area; +3.8 points at exactly equal area (diagnostic); Brier better in every block |
| 06Z RRFS | [FOLLOWUP-06Z.md](FOLLOWUP-06Z.md) | about equal to 12Z nationally; worse Brier in Florida/Gulf |
| Field-group ablation | [ABLATION.md](ABLATION.md) | keep all four groups |
| Florida/Gulf recalibration | [FL-RECAL.md](FL-RECAL.md) | forecast/observed 2.96 → 1.26, but −20.9 points of coverage at the training-set threshold; research candidate only |
| Two-cycle (06Z + 12Z) blend | [TWO-CYCLE.md](TWO-CYCLE.md) | +1.3 points nationally (mostly July); Florida/Gulf leans worse; research option |
| NadoCast head-to-head, 46 dates | [NADOCAST.md](NADOCAST.md) | NadoCast 84.4% vs blend 78.0% at NadoCast's 5% area |
| May 2024 diagnosis | [DIAG-MAY.md](DIAG-MAY.md) | gaps mostly from fragmented fields and edges ranked just below threshold |
| Spatial smoothing | [SMOOTHING.md](SMOOTHING.md) | 79.1% at NadoCast's area (gap −5.2); Brier better overall and in July and May, while the Jan–Feb interval includes zero; **lead** |
| Tree model | [TREE.md](TREE.md) | 75.1% at NadoCast's area; −4.1 points vs smoothed blend; calibration step over-forecast (1.54×) |
| Reproducibility | [REPRODUCIBILITY.md](REPRODUCIBILITY.md) | pinned environment is bit-identical across CPUs; later tests are fingerprint-gated |

## Decisions (owner, 2026-11-28)
- **Tuning on the 92 retrospective dates is paused.**
- **Smoothing on operational RRFS:** once operational fitting is approved, smoothing is tested separately inside the training block of the [locked plan](../TRAINING-VERIFICATION-PLAN.md), using operational RRFS. The locked comparison is unchanged unless an amendment is approved and its rule is committed before fitting.
- **Ongoing:** daily CONUS RRFS (06Z + 12Z) and lagged-HRRR collection and scoring continue under their current rules.
- **Held out:** prospective verification dates stay out of tuning. 2025 stays sealed for independent verification.
