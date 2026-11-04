# Personal CVG forecasts

Open `verify.html`, connect to the private data repository and choose **My Forecast**. A Contents read/write token allows submission; a read-only token can inspect reports and download a draft.

Choose an archived snapshot and one of its actual archived recipes. **Use this blend** fills future climate-day low, high and liquid-precipitation amounts. Adjust values, exclude unwanted dates, add notes and **Save frozen edition**. Blank values are unknown; zero precipitation explicitly means dry. Drafts persist in this browser. Starting another draft replaces the unsaved draft.

Every save creates a unique `personal-forecasts/CVG/<UUID>.json`. No update SHA is ever sent. Copying a saved forecast creates a new UUID and records its parent. If a request times out after GitHub saved it, a retry checks the existing file instead of overwriting it.

**Issue time.** Three times are kept for every submission and never mixed:

| Time | Source | Used for |
|---|---|---|
| `submittedAt` | the commit's own committer time | display only (a local commit can carry any time) |
| `receivedAt` | GitHub's record of the push that first brought the commit onto `main` | **eligibility, order and lead** |
| `processedAt` | the first collector run that saw the file | display only (workflow start-up delay) |

`receivedAt` comes from GitHub, not from the client, and **must be confirmed with GitHub in the scoring run itself**:

- **live** — the repository activity API, queried by that run, returns the push (id, before, after, time);
- **event** — the push event that started that run (`repository.pushed_at`);
- **attested** — a commit status with context `forecast-ops/receipt` on the push's commit, created by `github-actions[bot]` (a collector run's built-in `GITHUB_TOKEN`). Collector runs create these while the push is still in the live activity API, so receipts stay checkable after GitHub's activity retention (about a month). A personal access token cannot create a status under that identity, and statuses cannot be deleted.

`receipts/pushes.jsonl` is only a log. A row in it is never evidence by itself: if a row covering the forecast's commit is contradicted by GitHub (inside the live API's coverage but not returned, or returned with different data, or disagreeing with an attestation), the submission is **excluded as tampered evidence**. Older rows without an attestation are ignored. Two GitHub sources (or two attestations) that disagree by more than 2 minutes also exclude the submission. If GitHub cannot be queried, nothing is confirmed and submissions wait. A delayed workflow therefore cannot make an on-time save late, and a backdated or late-pushed local commit cannot make a late save on time. Saving from the browser is the normal path; a downloaded draft committed by hand gets the time GitHub receives the push.

**Residual trust (owner-controlled evidence).** The repository owner controls the workflow file and the collector code it runs. A token that can change `.github/workflows/` or `collector/` could change how receipts are checked, so this is tamper-*evident* against edits to forecasts and to the receipt log, not proof against the repository owner. For forecast submission use a fine-grained token limited to this repository with Contents read/write and **without** the Workflows permission; GitHub rejects workflow-file changes from such a token. Changes to `collector/` are visible in Git history and recorded in every capture's code commit.

The original file bytes (from the first commit that added the file) must still match the current file. Altered files, deleted files, inconsistent starting-snapshot metadata and windows starting less than 60 minutes after `receivedAt` are excluded. Git history and the receipt log live in the owner's repository: they are an audit trail, not an independent tamper-proof service.

Daily targets use CVG's climate day: midnight to midnight local STANDARD time (EST throughout the year). In summer that is 1 a.m.–1 a.m. EDT. The minimum 60-minute lead also means a 11:30 p.m. EST save cannot verify the immediately following climate day; the editor excludes such dates.

**Selection policy (primary, revision, personal).** For each captured edition:

1. Candidates are accepted submissions *received* within the edition's on-time window (12:00–12:15 p.m. or 11:30–11:45 p.m. America/New_York, same local date) whose starting snapshot belongs to that edition and was retrieved before receipt.
2. The earliest received candidate is **primary**; ties break on forecast ID. Times are compared as instants, never as text.
3. An original that is later altered or deleted keeps its primary slot and is excluded, so changing a file can never promote a later revision.
4. A submission excluded for any other reason (invalid values, unverifiable starting snapshot, missing or conflicting receipt evidence) never held the slot; the next valid candidate is primary. Excluded submissions are listed with their reasons.
5. Later candidates are **revisions**; submissions received outside the window are **personal updates**. All are kept with individual results; only primary cases enter matched scorecards. Selection never looks at observations or scores.

**Method changes.** Personal values are frozen, and so is what they meant: `my-forecast-v1` defines its own targets in `lib/personal.js`, independently of `lib/targets.js` — convention `climate-day-LST` and the window 05:00 UTC to 05:00 UTC the next day (midnight to midnight EST, all year, CVG only). A personal case is compared only while the current target has the same convention label **and** produces the same UTC window; a change to either (for example a moved boundary under an unchanged label) excludes it as *target definition changed*. The starting snapshot's normalizer version is kept as provenance (`basisNormVersion`) and does not have to equal the version of the archive forecasts it is compared with, but all archive forecasts in one matched case must share a single normalizer version. Version mixes are excluded, never merged.

Scores record actual issue lead (from `receivedAt`), basis retrieval time, recipe hash, normalization version, file and commit. Temperature and precipitation are compared with the existing climate observations. Shared source scorecards match valid date, capture edition and method, and filter lead day and edition; they display each source's actual lead range. An earlier source retrieval can have a slightly longer lead than the personal submission within the same edition. At least 30 unique verifying dates and varied weather are needed before drawing skill conclusions. No weights change automatically.

Submitting a file triggers **score-only**, without collecting forecasts or observations. Scheduled observation/scoring runs subsequently update `reports/my-forecast.json` and the private dashboard projections. Forecast collection schedules are unchanged. A downloaded draft must be committed under the personal-forecasts path before it can be processed; its issue time will be the actual commit time, never its draft time.
