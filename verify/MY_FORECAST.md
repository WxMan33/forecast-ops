# Personal CVG forecasts

Open `verify.html`, connect to the private data repository and choose **My Forecast**. A Contents read/write token allows submission; a read-only token can inspect reports and download a draft.

Choose an archived snapshot and one of its actual archived recipes. **Use this blend** fills future climate-day low, high and liquid-precipitation amounts. Adjust values, exclude unwanted dates, add notes and **Save frozen edition**. Blank values are unknown; zero precipitation explicitly means dry. Drafts persist in this browser. Starting another draft replaces the unsaved draft.

Every save creates a unique `personal-forecasts/CVG/<UUID>.json`. No update SHA is ever sent. Copying a saved forecast creates a new UUID and records its parent. If a request times out after GitHub saved it, a retry checks the existing file instead of overwriting it.

The collector uses full Git history. Issue time is the first addition commit's committer time, not the client's clock, source-model cycle or age of the starting blend. The original file bytes must match the current file. Altered files, unverifiable timestamps, inconsistent basis metadata and windows starting less than 60 minutes after issue are excluded. Git history is the audit authority within the owner's repository, not an independent tamper-proof service.

Daily targets use CVG's climate day: midnight to midnight local STANDARD time (EST throughout the year). In summer that is 1 a.m.–1 a.m. EDT. The minimum 60-minute lead also means a 11:30 p.m. EST save cannot verify the immediately following climate day; the editor excludes such dates.

The first accepted submission within the same captured edition's noon–12:15 p.m. or 11:30–11:45 p.m. America/New_York window is primary. Its starting snapshot must belong to that edition and predate the submission. Later saves are revisions; saves outside those windows are personal updates. These are all retained and individual results are shown, but only primary cases enter equal-edition matched scorecards. A changed original cannot promote a later revision into primary scoring.

Scores record actual issue lead, basis retrieval time, recipe hash, normalization version, file and commit. Temperature and precipitation are compared with the existing climate observations. Shared source scorecards match valid date, capture edition and method, and filter lead day and edition; they display each source's actual lead range. An earlier source retrieval can have a slightly longer lead than the personal submission within the same edition. At least 30 unique verifying dates and varied weather are needed before drawing skill conclusions. No weights change automatically.

Submitting a file triggers **score-only**, without collecting forecasts or observations. Scheduled observation/scoring runs subsequently update `reports/my-forecast.json` and the private dashboard projections. Forecast collection schedules are unchanged. A downloaded draft must be committed under the personal-forecasts path before it can be processed; its issue time will be the actual commit time, never its draft time.
