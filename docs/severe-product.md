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
Each case artifact and the fitted models have 90-day Actions retention.

## Rebuild inputs

The daily baseline, expanded-cohort reuse jobs and tree experiment restore their
frozen cases through `tools/severe/restore_inputs.sh`, which verifies every ZIP
against its pinned size and SHA-256 in `research/severe/rebuild-archive.json`
(146 ZIPs) before anything is extracted. With a private archive configured they
read its release; otherwise they read the original Actions run, with the same
verification, until it expires: run 42321856909 on December 7, 2026 UTC and run
43901185832 on February 14, 2027 UTC. Same-run artifact transfers keep using Actions.

- Select a private archive repository and publish the release tag
  `severe-rebuild-inputs-v1` there. Upload the original individual ZIPs from the
  preserved backups' `artifacts/` directory with the filenames listed in
  `research/severe/rebuild-archive.json`. Keep each ZIP's original bytes.
- In the forecast-ops Actions settings, set the repository variable
  `SEVERE_REBUILD_ARCHIVE_REPO` to the archive's `owner/repo` and the secret
  `SEVERE_REBUILD_ARCHIVE_TOKEN` to a credential with read-only Contents access to
  the private archive. The restore refuses a repository that is not private.
- Trigger the daily baseline and tree workflows on the branch containing the
  migration. Check the restore counts (36 cases for the baseline, 108 cases and
  one label ZIP for the tree experiment) and the downstream job results. The
  expanded cohort restores one original case in each reuse job.
- To verify a backup or run a local rebuild, extract the backup volumes together
  and pass `--artifact-dir /path/to/artifacts` to
  `tools/severe/restore_rebuild_inputs.py`. Use `--source v05`, `--source v07`, or
  `--source labels` and `--output`. A single `--case YYYY-MM-DD` restores directly
  into the output directory, matching the matrix workflow layout.

- The baseline's Day 1 wind replay also needs the frozen 2024 Storm Events file,
  `StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz` (12,693,243 bytes, SHA-256
  `2070b83eccab041b36360ab73645b9a249c3eefc5b92b5b3fc0cbba4d9fcc09c`, pinned in
  `research/severe/labels-v04/manifest.json`). NOAA has replaced it, so its URL returns 404.
  Upload it unchanged to a separate release, `severe-replay-sources-v1`, in the same private
  archive. `tools/severe/stage_report_source.py` stages it into the replay cache after checking
  its size and SHA-256, so the export never contacts NOAA. Until it is uploaded, the workflow
  stages it from the frozen-source checkpoint artifact (run 43909210291, artifact 14247375303,
  retained to February 14, 2027 UTC) with a warning. A copy that fails the check stops the run.

A configured archive that fails verification, or a variable set without the
secret, produces a workflow error naming the source or ZIP. Without the variable,
each restore logs a warning that it is still reading expiring Actions storage.

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

Open methodological questions (offshore samples, the climatology baseline, archived inputs,
uncertain report locations) and the decisions to freeze before the single 2025 evaluation
are in docs/severe-methods-review.md.

## Viewer and publication

### Product evidence

assets/severe-daily/models.json is generated from each model's committed
development-scores.json by tools/severe/model_registry.py (CI runs it with --check).
The viewer looks up every run by model_sha256 and shows, for the selected lead day and
hazard, the model version, the Brier skill against a constant training-period report
rate, a "No demonstrated development skill" flag when that skill is not positive, the
rule-flagged reliability ranges and the full reliability table. A run whose model is
not in the registry is refused, so no probability is shown without its evidence.

### Display mask

Samples more than 25 miles from US land (Gulf and Atlantic waters, Great Lakes interiors,
Canada, Mexico) are hidden in the viewer, because qualifying reports are essentially never
made there and those values cannot be verified. assets/severe-daily/display-mask.json is
generated by tools/severe/display_mask.py and tied to the grid checksum; a mismatched mask
withholds the whole product. Hidden samples are excluded from contours, dots and the
highest-sample search; their readout says "Not shown". The model and the published
probabilities are unchanged.

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

The Severe daily feed health workflow (`tools/severe/feed_health.js`) runs after
every publishing run on main, at 12:08, 14:04 and 19:20 UTC, and on demand. It
reads the same public raw files as the viewer and validates them, and the committed
copy, with the viewer's own checks: index schema, grid and run checksums, display
mask, registry, each payload's identity against the index and all three hazard
fields. An unreadable or invalid served file is an error. Each lead must show the
expected cycle: Day 1 advances at 12 UTC, when its target opens, and Day 2 at
19:15 UTC, after its last catch-up. The newest completed publishing run on main
must not have failed; runs on other branches are ignored. Failures appear in
GitHub Actions with the details in the job summary, and optionally in one tracking
issue (repository variable `SEVERE_HEALTH_ISSUES=true`).

The hosted viewer reads the public default-branch raw feed, matching the site's
existing NOAA feed pattern, so daily data updates do not depend on a Pages rebuild.
Local tests use the checked local feed. An open, visible panel revalidates the index
and registry every five minutes (and on returning to a hidden tab after that), and
downloads a run file or the grid only when its checksum changed. A clicked sample stays
selected across refreshes; "highest sample" follows the current field. Expiry is
checked every 30 seconds. Deployment of the daily viewer remains part of website integration. The backend
schedule runs independently on the default branch.
