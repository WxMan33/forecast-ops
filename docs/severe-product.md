# Daily severe research product

The expanded calendar contains 108 initialization dates and 216 daily target windows.
Training uses the 1st, 8th, 15th and 22nd of every month in 2022. Calibration uses
the same selection in 2023. Development evaluation retains the original 15th of
each month in 2024. Selection uses the calendar. The 2025 outcomes remain reserved.

The collection reuses the 36 original predictor cases, reconstructs the expanded
labels from the pinned original NCEI files, and requires identical labels for all
72 overlapping windows. The independent raw-CSV wind/hail audit covers all 216
windows. Both predictor windows are independently audited before joining. Training
requires every case and matching predictor, label, timing and feature identities.

The expanded run uses three concurrent cases and a 2 GB per-case transfer limit.
Each case artifact and the fitted models have 90-day Actions retention. Original
predictor artifacts are fetched from run 42321856909 before their December expiry.
Reproducing a later run after those artifacts expire requires retrieving a retained
copy or recollecting those inputs.

## Current-input contract

The current research runner uses the same HRRR field definitions, preprocessing,
40.2336 km target radius and daily timing protocol as training. It validates a
pinned model checksum, extracts all required hours and performs the raw predictor
audit before writing candidate.json. Incomplete inputs fail the attempt. Every
attempt has its own output directory and status record.

| Field | Consumer behavior |
| --- | --- |
| prepared_at | Display the actual preparation time |
| valid_start / valid_end | Display the exact 24-hour UTC target |
| expires_at | Suppress expired guidance, including after a later run fails |
| available_before_target_start | Flag a late whole-window forecast |
| freshness_at_preparation | A snapshot only; recompute against the current clock |
| model_sha256 | Identify the pinned fitted model |
| predictor_sha256 / raw_audit_sha256 | Link probabilities to checked inputs |
| operational_forecast_eligible | Currently false for research candidates |

candidate.json contains original sample coordinates and three probability arrays,
ordered identically. No field may be substituted with zero after a failure.
attempt.json records success or failure and actual timestamps. The upload contains
the predictor files, manifests and raw audit so the result can be reproduced.

The backend schedule is enabled on the default branch for 09:30 UTC Day 1 and
15:30 UTC Day 2. Research-branch trials use explicit push requests. The daily
viewer integration is staged separately in PR #22.
Scheduled lead selection uses the trigger expression even when a runner starts late.

The original v0.6 baseline remains archived. The expanded v0.7 model is the next
research candidate after fixed-date comparison. Five of six products reduced Brier
error against v0.6. Day 1 tornado changed slightly in the opposite direction.
Day 2 tornado and hail still score worse than training climatology, and the May 15
high-probability wind area remains overforecast. Errors run in both directions: Day 1
tornado forecasts of 1–15% verified at more than double the forecast rate, while high
Day 1 hail and Day 2 tornado/hail forecasts verified at less than half. The 2024
development dates were also used to choose between model versions, so all of these
results are exploratory; with twelve dates the uncertainty estimates are fragile.
This is a prospective research
trial rather than an operational release. All outputs remain regional research
products over approximately 100°W–75°W, 30°N–45°N. Operational publication,
national coverage, independent final evaluation and the ongoing verification feed
remain subsequent integration and validation work.

## Viewer and publication

### Product evidence

assets/severe-daily/models.json is generated from each model's committed
development-scores.json by tools/severe/model_registry.py (CI runs it with --check).
The viewer looks up every run by model_sha256 and shows, for the selected lead day and
hazard, the model version, the Brier skill against a constant training-period report
rate, a "No demonstrated development skill" flag when that skill is not positive, the
rule-flagged reliability ranges and the full reliability table. A run whose model is
not in the registry is refused, so no probability is shown without its evidence.

The Severe-page daily panel shares the existing map and contour renderer with
the historical viewer. It offers Day 1/Day 2, tornado/wind/hail, contours/dots/both,
map themes and original-sample point readouts. The daily parser enforces the
24-hour protocol and requires all three complete probability fields. Index-linked
checksums protect both grid and forecast files. Expired values are removed even
if a new run failed. A corrupted refresh clears the old readout and can be retried.

Successful current runs export a reproducible feed under assets/severe-daily.
The runner independently reproduces probabilities within 1e-14 absolute numerical
roundoff and preserves the original candidate values. All three hazards share the
same canonical sample order. The feed is committed atomically, with bounded
push/rebase retries that preserve other changes. A failed generation or audit
reaches no feed publication step.

The hosted viewer reads the public default-branch raw feed, matching the site's
existing NOAA feed pattern, so daily data updates do not depend on a Pages rebuild.
Local tests use the checked local feed. An open panel refreshes every five minutes
and checks expiry every 30 seconds. Deployment of the daily viewer remains part of website integration. The backend
schedule runs independently on the default branch.
