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

The backend schedule runs on the default branch: Day 1 at 09:30 UTC with catch-ups at
10:30, 11:45 and 13:15, and Day 2 at 15:30 with catch-ups at 16:30 and 18:30. A catch-up
reads the latest published feed and exits at once if that run is already there. A Day 1
run published after 12 UTC is flagged late. Scheduled lead selection uses the trigger
expression even when a runner starts late. Each schedule entry and manual lead day has
its own concurrency queue, so a manual run cannot cancel a waiting scheduled run.

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

### Timing labels

Each run is labeled against the visitor's clock first ("In effect now", "Next window",
"Expired"), then by its 12 UTC valid dates, lead day, full initialization date and model
version. The default is the run in effect now, and for the same window the newest
initialization. When a Day 1 run is missing, the previous day's Day 2 run for today's
window says it is in effect and was forecast the previous day; when both exist, the older
run points to the newer one.

The Severe-page daily panel shares the existing map and contour renderer with
the historical viewer. It offers Day 1/Day 2, tornado/wind/hail, contours/dots/both,
map themes and original-sample point readouts. The daily parser enforces the
24-hour protocol and requires all three complete probability fields. Index-linked
checksums protect both grid and forecast files. Expired values are removed even
if a new run failed. A corrupted refresh clears the old readout and can be retried.

Successful current runs export a reproducible feed under assets/severe-daily.
The runner independently reproduces probabilities within 1e-14 absolute numerical
roundoff and preserves the original candidate values. All three hazards share the
same canonical sample order. Export refuses a model with no registry entry and refuses
to replace a newer run of the same lead day. Each publish attempt starts from the
newest branch tip, exports again, runs the viewer's feed, contour and registry checks
on the exact files to be committed, and pushes; up to four attempts. index.json is a
single line, so the previous rebase approach failed whenever two runs overlapped.
A failed generation, audit or check reaches no commit.

The hosted viewer reads the public default-branch raw feed, matching the site's
existing NOAA feed pattern, so daily data updates do not depend on a Pages rebuild.
Local tests use the checked local feed. An open, visible panel revalidates the index
and registry every five minutes (and on returning to a hidden tab after that), and
downloads a run file or the grid only when its checksum changed. A clicked sample stays
selected across refreshes; "highest sample" follows the current field. Expiry is
checked every 30 seconds. Deployment of the daily viewer remains part of website integration. The backend
schedule runs independently on the default branch.
