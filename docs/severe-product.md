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

The schedule is prepared for 09:30 UTC Day 1 and 15:30 UTC Day 2. GitHub activates
scheduled workflows on the default branch, so the research-branch trials use explicit
push requests. Recurring execution starts after integration into the default branch.
Scheduled lead selection uses the trigger expression even when a runner starts late.

Current trials use the original v0.6 fitted baseline. Expanded models are evaluated
separately before selecting any replacement. All outputs remain regional research
products over approximately 100°W–75°W, 30°N–45°N. Operational publication,
national coverage, independent final evaluation and the ongoing verification feed
remain subsequent integration and validation work.
