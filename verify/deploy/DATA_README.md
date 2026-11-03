# forecast-ops-data (private)

The private archive and scheduled collector for Forecast Ops verification. The collector code is in `collector/`; design notes are in `collector/verify/README.md`. Nothing here is published.

## What runs, and when

`.github/workflows/collector.yml` runs on GitHub's servers whether or not your browser is open:
- **Captures:** at 12:00 and 23:30 America/New_York, with backup triggers.
- **Observations and scoring:** every 3 hours.
- **Archive:** a yearly archive job on 20 January.

**Collector runs vs. captured editions.** These are reported separately:
- A run that *executed* is a job that started.
- An edition *captured within its window* means its sources were retrieved within 15 minutes of the target.
- Each edition is reported as captured on time, partly on time, late, off schedule, missed, or failed.
- See `reports/STATUS.md`, or the dashboard (`verify.html` on the forecast site, with a token for this repository).
- GitHub's Actions tab also emails failures if notifications are on.

**Pilot data.** The pilot captures from 2026-11-03 are labelled `manual`. They are kept as evidence but never enter primary scorecards.

## Layout
| Path | Contents |
|---|---|
| `raw/`, `obs-raw/`, `evidence/` | Original responses, observations and TV evidence (hash-recorded) |
| `captures/`, `tv/`, `obs/`, `runs/`, `corrections/`, `config-log.jsonl` | Append-only records |
| `normalized/` | One bundle per capture **per normalizer version** (never overwritten) |
| `reports/` | STATUS, SCORECARD, scores, review queue, CSV exports, a traceable example pair (regenerated each run) |
| `archives/<year>/manifest.json` | Yearly archive manifests |
| `collector/` | The code that produced everything here, versioned with it |

## Retention, backup and recovery

**Retention:** everything is kept. Nothing is deleted automatically.

**Copies of the data:**
1. **This repository, including its full git history.** Every file ever committed stays recoverable from history, even if later removed from the working tree.
2. **Yearly archive release assets.** On 20 January, `collector/verify/tools/archive.js pack` builds a tarball of the previous year's raw evidence and writes `archives/<year>/manifest.json`. The manifest lists every file's path, size and SHA-256, plus the tarball's own hash. The tool re-extracts the tarball and verifies every file before the release `archive-<year>` is created; the upload is then recorded in the manifest.
3. **Your own offline copy (recommended).** About once a month, run:
   ```bash
   git clone --mirror https://github.com/WxMan33/forecast-ops-data.git
   ```
   Keep it somewhere outside GitHub.

**Pruning:** nothing is pruned automatically. `archive.js prune` refuses to run unless the manifest is verified and the release upload is recorded.

**Recovery:**
- Clone the repository (or restore your mirror).
- For a year whose raw files were pruned, download the release asset and run `node collector/verify/tools/archive.js restore --year <year> --tar <file>`. It re-checks every file against the manifest, then checks every content hash recorded in `captures/` at collection time.
- To re-create any normalized bundle, check out the commit stored in that capture's `code.commit`, then run `node collector/verify/run.js renormalize`.

**Size:** expect roughly 0.5–0.7 GB per year. If the repository nears ~4 GB, start a new data repository for the next year and keep this one read-only. The archives and manifests keep every evidence link and hash.
