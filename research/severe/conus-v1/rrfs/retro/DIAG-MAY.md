# Retrospective RRFS pilot: May 2024 miss diagnosis vs NadoCast (fixed before running)

Committed 2026-11-28 with owner approval, after the [NadoCast scorecard](nadocast/scorecard.md). May 2024 carried most of the national gap: at NadoCast's 5% false-alarm area, HRRR + 12Z RRFS was −7.0 points of report coverage. This step is a diagnosis only. It fits nothing, changes no model and produces no new skill score.

## Inputs (unchanged)
- **Dates:** the 26 May 2024 dates of the committed [NadoCast roster](nadocast/nadocast-roster.json). The NadoCast files are SHA-checked against it.
- **Our predictions:** the pinned held-out HRRR + 12Z RRFS predictions, regenerated behind the same fingerprint gate.
- **Labels:** the same pinned Storm Events labels and supported CONUS samples.
- **Thresholds:** the May equal-area thresholds already in the committed scorecard. NadoCast is flagged at ≥ 5%. The blend is flagged above 7.495%, its May national threshold matched to NadoCast's 5% false-alarm area.

## Per date
- report points;
- hits and false-alarm points for each model;
- the gap: NadoCast hits minus blend hits;
- the blend-to-NadoCast false-alarm area ratio.

## Points NadoCast caught and the blend missed
Each such point goes into exactly one class:
1. **Ranked a little too low:** the blend's probability is at least 50% of its threshold.
2. **Displaced:** otherwise, if a blend-flagged point lies within 150 km.
3. **Absent:** otherwise, meaning the blend flagged nothing within 150 km.

Also reported:
- each missed point's rank percentile within the blend's forecast for that day;
- points the blend caught and NadoCast missed;
- points both models caught;
- points both models missed.

## Concentration and spread
- the share of the total gap from the top 1, 3 and 5 dates;
- how many dates the blend flags more false-alarm area than NadoCast. The two areas match only in total over May, not on each date.

## Maps (dates chosen by rule, not by eye)
- the 4 May dates with the largest positive gap;
- the 1 date where the blend most outperformed NadoCast.

Each map shows NadoCast and the blend with their flagged areas at the thresholds above, the report points, and the per-date counts.

## Reading
- The class cut-offs (50% of threshold, 150 km) are fixed descriptive choices, not tuned.
- This identifies a problem to solve before any further fitting.
- 2025 stays sealed. The daily scoring job runs on its existing schedule.
