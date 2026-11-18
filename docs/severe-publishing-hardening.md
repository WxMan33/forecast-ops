# Severe daily feed: publishing hardening (November 2026)

This covers publishing engineering only. The production model (v0.7, `a83218fb…e1e7e`), the
published feed in `assets/severe-daily/` and the registry are unchanged. No 2025 outcomes were
read or used.

## 1. Simultaneous publishers against an isolated remote

The publish loop that was inline in `severe-daily-product.yml` is now
`tools/severe/publish_feed.sh`. The workflow calls it with the same arguments and the same four
attempts. Each attempt does the same steps as before: fetch, reset to the newest tip, re-export,
run the three viewer checks, commit, push. The script also writes `publish-report.json`, which
records every attempt and is uploaded with the run's artifact. It has one test hook,
`PUBLISH_BEFORE_PUSH`, which the workflow never sets.

`tests/severe-publish.test.py` copies this checkout into a temporary bare repository and clones
it twice. It runs the real script against that repository. The synthetic Day 1/Day 2 candidates
pass every check in the real `export_daily.py`: registered model, frozen timing, raw audit,
predictor contract, checksums, and reproduced probabilities. Nothing reaches GitHub.

| Case | What is forced | Result |
|---|---|---|
| Rejected push recovers | Publisher A (Day 1) commits. Before A pushes, publisher B (Day 2) and an unrelated commit both land. | A's first push is rejected. A resets and re-exports on the new tip, then pushes on attempt 2. The tip has A's Day 1, B's Day 2 and the unrelated file. History is linear with no merges. The index checksums match, and all three viewer checks pass on the tip. |
| Truly simultaneous | A and B start at the same moment as separate processes. | Both succeed. The tip holds both forecasts. |
| Newer run lands mid-race | While A holds the 18th, a Day 1 run for the 19th is published. | A's retry is refused: `export_refused`, `::error::`, exit 1. The 19th stays published. |
| Retries exhausted | Every push loses a race (3 attempts). | Exit 1 with `::error::…could not be published after 3 attempts`. The remote is unchanged apart from the three unrelated commits, which are all kept. |
| Same run twice | B republishes A's identical run. | `already_current`, and no commit is made. |

**Mutation check.** I broke the script in two ways and re-ran the recovery case. Both broken
versions fail it:
- Switching to `git push --force` fails, because the rejection never happens and B's commit and
  the unrelated commit would be lost.
- Removing the reset to the newest tip fails, because nothing would be published.

Local run: 5 tests, OK, about 75 s. The test is added to `tests.yml`.

Not shown here: a rejection on GitHub itself. The loop that ran on the real remote is unchanged,
and the test covers the git behaviour that matters. A real GitHub race would mean dispatching two
production runs on purpose, which needs the owner's go-ahead.

## 2. Automatic health checks

`tools/severe/feed_health.py` and `.github/workflows/severe-feed-health.yml` cover the following.

| Check | Error (job fails) | Warning |
|---|---|---|
| feed | `index.json`, grid or run files disagree with their checksums; a run's model is unregistered; a file claims the wrong lead day | |
| freshness | Day 1 or Day 2 is missing, or still shows an older initialization after its deadline. Day 1's deadline is 12:00 UTC, when its window starts. Day 2's is 19:15 UTC, 45 min after its last catch-up. | |
| runs | The newest completed publishing run in the last 26 h failed, timed out or was cancelled | An earlier one did, and a later run succeeded |
| served | | The raw files the viewer reads differ from git, or can't be read (the CDN can lag a few minutes) |

When the workflow runs:
- After every completed publishing run (`workflow_run`), so a failure is reported within minutes.
- At 12:05 and 19:20 UTC, right after each deadline.
- On demand.

What it reports:
- A step summary with a per-day table, plus `::error::` and `::warning::` annotations.
- `feed-health.json` as an artifact.
- A failed job, which GitHub reports in its usual way.
- Optional: set the repository variable `SEVERE_HEALTH_ISSUES=true` to keep one tracking issue
  open while the feed is unhealthy and close it on recovery. It is off by default.

Tests: `tests/severe-feed-health.test.py` (11 cases) covers deadline edges, stale Day 1/Day 2,
missing day, checksum mismatch, unregistered model, newest vs. recovered failure, served
mismatch, and the CLI exit code and summary. On the current feed at 02:57Z it reports healthy.

## 3. Replacing expiring artifact downloads

Three workflows downloaded straight from Actions runs that expire:
- `severe-daily-baseline.yml` and `severe-expanded-cohort.yml` use run 42321856909, which
  expires 2026-12-07.
- `severe-tree-experiment.yml` uses run 43901185832, which expires 2027-02-14.

All three now call `tools/severe/fetch_archive.py`. It:
- reads a committed manifest, `research/severe/archives/run-<id>.json`;
- tries the GitHub Release named in the manifest first, then the original run;
- accepts a zip only if its SHA-256 matches the manifest;
- refuses unsafe zip paths;
- extracts in the same layout as `actions/download-artifact`.

A local folder, `--source dir:PATH`, works too, which lets the private backup be checked against
the manifest.

The manifest for run 42321856909 is committed: 37 artifacts (36 cases plus a summary), 203.9 MB.
The digests were transcribed from GitHub's artifact API. The test checks that its 36 case names
equal `cohort-v05.json` exactly. I could not download a zip from here to confirm that
digest = SHA-256 of the zip, because the proxy blocks Azure blob storage. The new workflow below
checks this on GitHub for every artifact.

`severe-archive-inputs.yml` (manual) does the following:
- Downloads every zip from the chosen run and checks each against GitHub's digest.
- Checks each against the committed manifest, if there is one.
- Uploads the manifest with `release_tag` filled in.
- Only if you give it a tag: creates the Release, uploads the zips, then re-downloads every asset
  through `fetch_archive.py --source release` to prove the copies verify. It refuses to reuse an
  existing tag.

Tests: `tests/severe-archive.test.py` (8 cases).

Until a Release exists, the rebuild workflows still fetch from the original run, now
checksum-verified. After 2026-12-07 the baseline and expanded-cohort workflows will fail with a
clear message unless the steps below are done.

### Decisions still needed from the owner

1. **Where the durable copy lives.** `severe-archive-inputs.yml` publishes a GitHub Release in
   this repository. If the repository is public, the Release is public. The earlier handoff judged
   that reasonable: the files are derived predictors and labels, with no raw GRIB. A private
   copy would need either:
   - another private repository's Release, which needs a cross-repository token stored as a
     secret; or
   - a cloud bucket, which needs credentials and a new source type in `fetch_archive.py`.

   The private backup you made can't be reached from Actions, so it stays a fallback only.
2. **Tag names.** Suggested: `severe-inputs-run-42321856909` and `severe-inputs-run-43901185832`.
3. **Approval to run it**, before 2026-12-07 for 42321856909:
   - (a) Run "Severe archive inputs" for 42321856909 with no tag, as a check only.
   - (b) Run it again with the tag.
   - (c) Commit the manifest artifact it produces. Its `release_tag` is set and it must match the
     committed one, which the workflow enforces.
   - (d) Repeat for 43901185832, whose manifest isn't committed yet. Until then the tree
     experiment stops with "not committed yet".

## Files

- New: `tools/severe/publish_feed.sh`, `feed_health.py`, `fetch_archive.py`,
  `archive_manifest.py`; `.github/workflows/severe-feed-health.yml`, `severe-archive-inputs.yml`;
  `research/severe/archives/run-42321856909.json`; three test files.
- Changed: `severe-daily-product.yml` (calls the script, same behaviour); `severe-daily-baseline.yml`,
  `severe-expanded-cohort.yml`, `severe-tree-experiment.yml` (verified fetch); `tests.yml` (three
  new tests).
- `actionlint` (with shellcheck) and `shellcheck` are clean on every new or changed workflow and
  script.
