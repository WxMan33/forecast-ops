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

`tools/severe/feed_health.js` and `.github/workflows/severe-feed-health.yml`, consolidated with
PR #24's checker. The check validates **the files the viewer actually downloads**: the public
raw feed, retried three times for CDN skew, and the committed copy. It uses the viewer's own
`severe-daily-core.js` validators.

| Check | Error (job fails) | Warning |
|---|---|---|
| served / committed | A file can't be read or isn't JSON. The index schema fails. A grid or run checksum is wrong. The display mask or registry is invalid. A payload's id, lead, initialization, window, preparation or model differs from `index.json`. Any hazard field is missing or out of range. The model is unregistered. | Served is valid and current but not yet byte-identical to git |
| freshness | A lead is missing, expired, claims a future time, or is older than required after its deadline. Day 1's deadline is 12:00 UTC; Day 2's is 19:15 UTC. | |
| runs | The newest completed publishing run **on main** in the last 26 h failed, timed out or was cancelled | An earlier main-branch failure that a later main-branch run recovered |

When it runs: after every publishing run on main, at 12:08, 14:04 and 19:20 UTC, and on demand.
It reports through the step summary, `::error::` annotations, a JSON artifact and a failed job.
It can also keep one tracking issue open if `SEVERE_HEALTH_ISSUES=true` is set (off by default).

Review findings fixed, each now covered by `tests/severe-feed-health.test.js`:
- A Day 1 payload with no hail field, or with an initialization that disagrees with the index,
  was called current. Both are now errors.
- Invalid public responses produced only warnings. They are now errors.
- A success on another branch downgraded a failed main run. Only runs on main are considered
  now, both in the runs filter and in the `workflow_run` trigger.

**Mutation check.** Removing the viewer's payload check makes the test fail, and so does removing
the branch filter.

On the current feed (Day 1 and Day 2 from 2026-11-18), both the committed copy and the live raw
feed check healthy.

## 3. Replacing expiring artifact downloads (private archive, from PR #24)

My first version published a public Release, and its workflow failed before downloading because
`gh api` has no `-c` flag. That version is removed. In its place is PR #24's private-archive path:
- `research/severe/rebuild-archive.json` pins all 146 ZIPs (36 v05 cases plus the summary, 108
  v07 cases, and the v07 labels) by size and SHA-256. I compared it with the 37 digests I had
  transcribed from the artifact API for run 42321856909, and all 37 match.
- `tools/severe/restore_rebuild_inputs.py` is #24's tool, extended. It reads from one of:
  - `--repository`: the private archive's release `severe-rebuild-inputs-v1`. A repository that
    isn't private is refused before anything is downloaded.
  - `--artifact-dir`: the verified backup.
  - `--actions`: the original run, until it expires. It finds each artifact by API id and refuses
    expired ones.

  Every location goes through the same check: all selected ZIPs must match size and SHA-256
  before any extraction, and absolute or escaping paths are refused.
- `tools/severe/restore_inputs.sh` is the single workflow entry point:
  - If `SEVERE_REBUILD_ARCHIVE_REPO` is set, it reads the private archive. It needs
    `SEVERE_REBUILD_ARCHIVE_TOKEN` and fails clearly without it.
  - Otherwise it warns and uses the verified Actions fallback.
- The baseline (36 cases), expanded-cohort reuse (one case per job) and tree experiment (108
  cases plus labels) all use it. The tree experiment no longer stops on a missing manifest.

Tests: `tests/severe-restore-inputs.test.py` (9 cases). It uses a stub `gh` on PATH and covers:
- manifest coverage, including no 2025 dates, and frozen case selection;
- the three layouts;
- size/SHA mismatch and missing ZIPs, which stop before extraction;
- zip-slip;
- a public archive, refused before download;
- the private release path;
- the Actions fallback, including expired artifacts;
- the wrapper's missing-token error.

All `gh` flags used were checked against `gh` 2.89.0.

### Owner steps before 2026-12-07

1. Create a **private** archive repository, for example `WxMan33/forecast-ops-archive`. In it,
   create the release `severe-rebuild-inputs-v1` and upload the 146 original ZIPs from the
   backup, named exactly as in `research/severe/rebuild-archive.json`. Before uploading, you can
   check the backup locally:
   `python3 tools/severe/restore_rebuild_inputs.py --artifact-dir <backup>/artifacts --source v05 --output /tmp/v05`,
   then `--source v07` and `--source labels`.
2. In forecast-ops, set the variable `SEVERE_REBUILD_ARCHIVE_REPO` to that repository's
   `owner/repo`, and the secret `SEVERE_REBUILD_ARCHIVE_TOKEN` to a fine-grained token with
   read-only Contents (and Metadata) access to that repository only.
3. Dispatch the daily baseline and tree workflows on this branch and check the restore counts:
   36 for the baseline, and 108 plus 1 for the tree experiment. Dispatching runs workflows, so it
   needs your go-ahead.

## Files

- Publishing: `tools/severe/publish_feed.sh` and `tests/severe-publish.test.py` (5 race cases).
  `severe-daily-product.yml` calls the script.
- Health: `tools/severe/feed_health.js`, `tests/severe-feed-health.test.js` and
  `.github/workflows/severe-feed-health.yml`.
- Archive: `research/severe/rebuild-archive.json`, `tools/severe/restore_rebuild_inputs.py` and
  `restore_inputs.sh`, `tests/severe-restore-inputs.test.py`. The baseline, expanded-cohort and
  tree workflows use them.
- Docs: `docs/severe-product.md` ("Rebuild inputs" and feed health) and
  `docs/severe-methods-review.md` §3, both from PR #24 and adapted.
- `actionlint` (with shellcheck) and `shellcheck` are clean on every new or changed workflow and
  script.
