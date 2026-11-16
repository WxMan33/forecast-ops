# Forecast Ops verification service

A durable collector and scorer that learns which forecast sources and blend recipes work best for each location, variable and lead time, starting at **CVG**. It also runs a separate, private **Cincinnati TV pilot**. Station products are benchmarks only, never blend ingredients.

The code is public in this folder. All data and results live in a **private data repository**. The forecast site never loads them, so a collection failure cannot affect it. `verify.html` is a stand-alone private dashboard that reads that repository with a token you keep in your own browser.

## Tracks

| Track | What | Ids |
|---|---|---|
| `source` | Each forecast source as delivered | ECMWF IFS/AIFS, GFS, NBM, HRRR, NAM, ICON, GEM, UKMO, Météo-France, JMA (Open-Meteo); `ecmwf_ens` (51 members), `gefs` (31 members); `nws` (grid, through the same calculations); `nws-official` (NWS's own MaxT/MinT and period PoP) |
| `blend` | OPE recipes, computed with the site's shared code (`assets/ops-core.js`) | `baseline-v1` (Brad's preferred, frozen 2026-11-03), `equal-raw-v1`, `ecmwf-ens-only`, `gefs-only`, `nbm-only`, `nws-only`; candidates later |
| `tv` | One specific published product per id | see the TV inventory below |

All tracks share the same location definitions, target windows, observation archive and scoring functions. Station results are never mixed into blend optimisation.

## CVG

Verified 2026-11-03 against three sources:

| Source | Coordinates | Elevation |
|---|---|---|
| `api.weather.gov/stations/KCVG` | 39.04456 N, 84.67229 W | 262.1 m |
| ACIS (uid 8337) | 39.04443 N, 84.67241 W | 861 ft |
| NCEI GHCN-Daily | station USW00093814 | — |

- **Identifiers:** WBAN 93814, COOP 151855, WMO 72421.
- **Climate reports:** NWS Wilmington OH issues the CLI/CF6 products `CLICVG` and `CF6CVG`. CVG is Cincinnati's official climate site.
- **NWS forecast point:** the point lookup at the station coordinates gives grid ILN 30,35 (relative location: Hebron KY).

Every forecast is requested **at the station coordinates**. None uses a downtown Cincinnati point.

## Schedule and late policy

| Item | Setting |
|---|---|
| Capture targets | 12:00 and 23:30 America/New_York (`config/schedule.js`) |
| Primary trigger | GitHub runs fire about 10 minutes early, in both the EST and EDT offsets; the collector waits for the target and records its actual start |
| On time | started at most 15 min after the target |
| Late | 15–180 min after the target; kept and labelled |
| Off schedule | more than 180 min after the target |
| Missed | the slot has no capture after 180 min; it is listed as a gap |
| Backup trigger | runs 35 min after the target; it captures only if the slot has no usable capture, and that capture is labelled late |
| Manual captures | always labelled `manual`, never on time |

Late, off-schedule and manual captures stay in the archive and in full-sample tables. They are excluded from matched comparisons.

**Prospective boundary (`lib/timing.js`, timing-v1).** An observation may verify a forecast only if it was **measured at least 60 minutes after the capture's last source retrieval**.
- **Daily and period windows:** the whole window must start at least 60 minutes after that retrieval, so every measurement inside it is later still.
- **Hourly temperature:** the routine report must fall within 15 minutes before the valid hour. The 60-minute lead is checked against the report's own measurement time, not the valid hour.
- **TV values:** the same rule applies, measured from the product's retrieval time.
- **Checked twice:** at normalization and again at scoring.
- **Traceability:** each scored pair records the last retrieval time, the source issue/run times, the observation's measurement and ingest times, the lead in minutes, and the normalizer version.

The first pilot run showed why this matters. A capture retrieved at 02:53Z had been matched to the 02:52Z report for 03:00Z, an observation made *before* the forecast was retrieved. That is now impossible, and a test uses those real timings. Nothing is reconstructed from later data. Historical forecasts may be added only with documented as-issued provenance.

## Editions and what counts (`lib/editions.js`)

**Editions.** An *edition* is one location, one local date and one slot, e.g. CVG 2026-11-04 midday. Only scheduled and backup triggers produce editions. Each attempt has its own capture id (the edition id, then `_a2`, `_a3`, …) so evidence never collides. A backup trigger re-attempts only an edition that is still incomplete.

**Collection window, not a cutoff.** An edition is a 15-minute collection window that *starts* at the target T. The collector waits for T, so nothing is retrieved before it. A retrieval is on time if T ≤ retrieval ≤ T + 15 min, so data a provider publishes inside that window can be included. Every pair keeps its actual retrieval time and delay, and matched comparisons report each member's mean and maximum retrieval delay. A retrieval before T is "early" and is not eligible.

**Selection rule.** For each edition and each source/product, exactly one capture is scored:
- the earliest on-time **source retrieval**;
- if none is on time, the earliest retrieval at or after T, labelled by its own lateness.

A blend uses its capture's last retrieval, because it is only as timely as its latest input. Retries and backups therefore never multiply a forecast's influence.

**Classes:**
- **Primary:** selected and on time. Only these go into scorecards and matched comparisons.
- **Late:** selected but late; kept and labelled.
- **Superseded:** not selected; never scored.
- **Pilot:** manual captures; reported separately as pipeline evidence, never as accuracy evidence.

**What every score shows:**
- the pair count, next to unique verifying dates (and hours, for hourly temperature);
- 7-day blocks;
- descriptive wet/dry groups: runs of consecutive days with the same observed wet/dry state, capped at 7 days. They describe the weather sampled; they are **not** evidence of statistical independence. Uncertainty comes from the 7-day block bootstrap;
- the **actual lead time** in hours (window start, or valid hour, minus last retrieval), alongside the lead day.

Comparisons are made only within the same lead day and slot.

**Collector runs vs. captured editions.** Every collector run is logged, including "not due" triggers. Each edition is reported separately as captured on time (all sources), partly on time, late, off schedule, missed, or failed, with its attempts and runs.

## Model-cycle provenance

Each source records a `cycle` object with `kind`, the reported value, `reportedBy`, `responseCycle`, `inferred` and `status`:
- **Open-Meteo models** (`kind: "latest-run-reported-by-metadata"`): the `last_run_initialisation_time` from the model's `/data/<model>/static/meta.json`, read at retrieval. It is the **latest run reported by the metadata**, not a confirmed cycle behind the forecast response. The response doesn't state its run, so `responseCycle` stays null (unknown). Seamless products blend several models, and the value is for the global component.
- **NWS** (`kind: "nws-grid-update-time"`): the gridpoint response's own `updateTime`, kept separately as `nwsGridUpdateTime`. It is a forecast update time, not a model run.
- **Nothing is inferred:** `inferred` is always null.
- **Missing or implausible values:** a missing value stays `unknown`. An implausible one (more than 72 h old, e.g. GEM reporting May 2026) keeps the reported value but is labelled `provider-reported-implausible`.

## Retention, backup and recovery

**Retention.** Everything is kept, and nothing is deleted automatically.

**Yearly archive.** `tools/archive.js pack` writes a tarball of a year's raw evidence and a committed manifest (every path, size and SHA-256, plus the tarball's hash). It verifies the tarball by re-extraction before the workflow uploads it as release `archive-<year>`.

**Restore.** `tools/archive.js restore` re-checks the manifest, then every content hash recorded in `captures/`.

**Prune.** `tools/archive.js prune` refuses to run without a verified manifest *and* a recorded upload. Git history keeps every file regardless.

**Code with the data.** The collector code is vendored in the data repository, so each capture's recorded commit reproduces its exact normalization. Details are in `deploy/DATA_README.md`.

## Storage (private data repository)

| Path | Contents |
|---|---|
| `raw/<loc>/<YYYY-MM>/<captureId>/*.json.gz` | Every source response as received (gzipped, SHA-256 recorded) |
| `captures/<loc>.jsonl` | One record per capture: slot, target, trigger, actual start and finish, timeliness, per-source outcome, HTTP status, retrieval time, provider run/cycle metadata, NWS update times, member counts, horizon, code commit and versions |
| `normalized/<loc>/<YYYY>/<captureId>.<normalizer-version>.json.gz` | Normalized bundle (below), one file per normalizer version. A new version is built from raw evidence **beside** the old ones, never over them. Scores always state the normalizer version that produced them |
| `tv/<loc>/<YYYY-MM>.jsonl` | One record per TV product per capture: evidence, extraction, confidence, freshness, review status |
| `evidence/<sha>` | Original TV graphics and pages, content-addressed (stored once) |
| `obs/<loc>/<YYYY-MM>.jsonl` | Observation versions, append-only; new rows only when a value, flag or status changes |
| `obs-raw/` | Raw METAR, CLI, CF6, ACIS and GHCN responses |
| `corrections/` | Review decisions and value corrections, one file per decision (audit trail; originals never edited) |
| `config-log.jsonl` | Every recipe, schedule, target-definition and TV-config change, by hash, before first use |
| `runs/<YYYY-MM>.jsonl` | Every job run, including failures and "not due" triggers |
| `reports/` | `STATUS.md`, `SCORECARD.md`, `scores.json`, `index.json`, `review-queue.json`, `exports/*.csv` |

**Normalized bundle.** For every source and blend, the bundle gives a value per target window and valid date, for leads 0–16 and as far as the data reaches.
- **Ensembles** add member statistics: n, min, max, p10, p50, p90.
- **Blends** add the requested weights, the weights actually used, missing sources, effective shares, contributing sources with member counts, the mixed-source spread and ensemble-only percentiles.
- **Hourly temperature:** the bundle also holds the hourly temperature series of every source and blend.

## Target windows (`lib/targets.js`, defined before scoring)

| Target | Window | Observed from |
|---|---|---|
| `tmax_clim`, `tmin_clim` | Climate day: local **standard** time midnight to midnight (05Z–05Z all year, so 1 AM–1 AM during EDT) | CLI (complete-day reports only), CF6, ACIS, GHCN-Daily |
| `tmax_day` | NWS daytime, 7 AM–7 PM LST (12Z–00Z) | METAR 6-h maxima ending 18Z and 00Z |
| `tmin_night` | The night **after** the date, 7 PM–7 AM LST (00Z–12Z) | METAR 6-h minima ending 06Z and 12Z. NWS MinT nominally runs to 8 AM; the flag says so |
| `precip_clim`, `pop01_clim` | Climate day; probability of ≥ 0.01 in | CLI/CF6/ACIS/GHCN daily precipitation |
| `precip_day12`, `pop01_day12`, `precip_night12`, `pop01_night12` | 12Z–00Z and 00Z–12Z | METAR 6-h precipitation groups |
| `snow_clim` | Climate day | CLI/ACIS/GHCN snowfall; collected, kept out of routine scorecards |
| `temp_hourly` | A valid top of the hour | The routine METAR within 15 min before it (tenths from the T-group) |

Rules applied to every target:
- **Hourly data vs daily extremes.** Model daily extremes are taken from hourly values over the window, and a source counts only if it has **every** hour. Routine hourly temperatures are never used as a substitute for official daily extremes.
- **Traces** are 0 with a `trace` flag, and are not measurable for probabilities.
- **Missing amounts** stay missing. A METAR with `PNO` or `6////` makes the 12-h amount unknown, not 0.
- **Precedence among observations:** GHCN-Daily final > ACIS revised > CLI corrected (CCA) > CF6/CLI preliminary > METAR. QC-failed values are never used. Every version is kept, and revisions are visible.
- **Rescoring.** Scores are rebuilt from the archive at every run, so a revised observation re-scores past forecasts automatically.
- **Probabilities are kept apart:**
  - Ensemble chance of ≥ 0.01 in is the share of members.
  - NWS period PoP is stored as `nws-official` with an `nws-period-pop` flag. NWS periods run 6 AM–6 PM local; the NDFD PoP12 runs 12Z–00Z.
  - Deterministic models' hourly precipitation chance is a different quantity and is not mapped to these targets.

## Cincinnati TV inventory (2026-11-03)

The inventory used only public pages and respected robots.txt. No authentication, paywall or bot challenge is bypassed.

| Station | Product | Type | Collected | Notes |
|---|---|---|---|---|
| WCPO 9 (Scripps) | 9 Day Forecast graphic (`A_7DAY.jpg`) | Weather-team broadcast graphic | Yes; OCR → review | Highs and following-night lows drawn between columns. Precipitation is in words only ("LIKELY", "SLIGHT"), so **no probability is recorded**. Issue time from HTTP Last-Modified. Cross-checked against the website data |
| WCPO 9 | Website daily forecast (weathercenter JSON) | Structured; team authorship probable (matches the graphic) | Yes; auto-accepted when clean | 4 days including today, explicit dates, numeric PoP (period unstated), "Cincinnati, OH" |
| WKRC Local 12 (Sinclair) | 7 Day Forecast JSON | Automated provider (TWC, location USOH0188) **with per-value team edits** | Yes | Each value is labelled `team` (a "modified" field) or `automated`. Location ZIP 45226 (39.128, −84.519) is an explicit non-CVG point. Issue time from the package's saved time |
| WXIX FOX19 (Gray) | TWC "daily-10day-custom" data on /weather/ | Automated provider, possibly station-customised; **authorship uncertain** | Yes | Day and night PoP for 7a–7p / 7p–7a local civil time; location 39.102, −84.513. Not attributed to the weather team |
| WLWT 5 (Hearst) | "In-depth weather forecast" story | Meteorologist-written story with byline and update time | Yes; text only → review | Mostly approximate wording ("mid-70s"). Only explicit numbers, after review, can ever be scored |
| WXIX FOX19 | Extended Forecast graphic | Weather-team graphic | **No** | robots.txt on webpubcontent.gray.tv disallows it |
| WKRC Local 12 | Station graphics | Weather-team graphics | **No** | Under `/resources/ftptransfer/`, which robots.txt disallows |
| WLWT 5 | Extended 10 Day list | Automated provider widget | **No** | Filled in by the browser from an undocumented Hearst feed; provider not identified |

How TV values are scored:
- **Lows.** Every collected product with lows assigns them to the **night after** the date. The evidence is the graphic's layout, the provider night phrases, and the WCPO graphic agreeing with its own website data.
- **Location comparability:**
  - `generic-market` ("Cincinnati") products verify at CVG, Cincinnati's official climate site, with that benchmark disclosed.
  - `explicit-other-point` products (Local 12 at ZIP 45226; FOX19 at downtown coordinates) are scored but **excluded from matched/definitive comparisons**.
- **Access.** Each capture records robots.txt exactly as returned (e.g. "robots.txt returned HTTP 403"), apart from the page's own HTTP status. A 4xx robots.txt does not disallow fetching under RFC 9309. That is not a claim that the site has no other restrictions; site terms are not evaluated by the collector, and any product can be switched off in `config/tv.js`.
- **Cross-checks** compare only the same station and location scope, fetched in the same capture run, on the same valid dates. A disagreement sends the product to review and never changes a value.
- **Scope of review decisions.** A decision applies to its own capture. It extends to another capture only if station, product, extraction version, evidence hash **and** assigned dates all match. The same image on a different date, or a newer extractor's output, goes back to review. Unresolved extractions never reach scoring.
- **Review.** Structured values are auto-accepted only when the extraction is clean and the product is fresh. OCR values are auto-accepted only at confidence ≥ 0.85 with no layout issues, and only when they agree with the station's own structured data. Everything else waits in the review queue. Corrections are versioned files applied at scoring time.

## Scorecards (`lib/score.js`)

**Temperature**
- MAE, bias and percentage within 2 °F.
- Ensembles add range coverage (min–max and 10–90 %) and sharpness (width).

**Precipitation and probability**
- Precipitation amount: MAE and bias, for all days and for wet observed days separately; dry days report the false-wet rate.
- Brier score and base rate for compatible probabilities only.

**How results are grouped**
- Every result is split by track, source/product, target, lead day and capture slot (midday/evening).
- **Full sample:** each source's own available cases, with exclusions explained.
- **Matched comparisons** use only cases that every competitor has, from on-time captures, for the same target, lead and slot. So nobody is rewarded for skipping hard days or penalised for a longer horizon.

**Uncertainty and verdicts**
- Uncertainty comes from a block bootstrap over 7-day blocks of valid dates, because one weather episode affects many forecasts.
- A verdict needs **30+ distinct valid dates** and a 90 % interval that excludes zero. Otherwise it reads "insufficient evidence".
- Coverage (expected vs captured slots, gaps, pending observations) is always shown next to scores.
- **National expansion:** scores will be expressed relative to local benchmarks (e.g. skill against `nws-official` or a climatology baseline), not as raw errors across climates.

## Context and conditions (`lib/context.js`, `lib/stratify.js`, `lib/experiments.js`)

Every scored temperature case carries context on three bases, which are never mixed:

| Basis | Known | Contents | Stored |
|---|---|---|---|
| target | Before issue | Valid date, month, season, lead band, slot, local day/night hour | Computed |
| issue | At retrieval | Source status and HTTP code, retrieval times, provider-reported cycle and its status, NWS grid update time, recipe weights requested and used, missing sources, code and normalizer versions, the forecast's own change from the previous day (Baseline v1, from its hourly series), ECMWF ENS 10–90 % width, mixed-source range, and the latest climate-day observation the archive had ingested before the last retrieval (`firstSeenAt`) | `context/<loc>/<YYYY>/<captureId>.context-v1.json`, written once at capture (or backfilled from the same issue-time evidence, labelled `builtAfterCapture`) and never rewritten |
| observed | Afterward | Observed change from the previous day, wet/dry, night sky and wind from the routine METARs (radiational, cloudy, windy, mixed) | `reports/context.json`, rebuilt every run because observations are revised |

- **Thresholds** were fixed by definition before any error was examined: a change of ±6 °F, ECMWF ENS width < 4, 4–8 and > 8 °F, and a radiational night when two thirds of its routine reports are clear or few with wind ≤ 5 kt.
- **Skill by condition** (`reports/CONTEXT.md`) uses matched cases only. A member joins a target/lead cell when it has 80 % of that cell's cases, and members left out are named. Each cell shows cases, distinct dates and 7-day blocks. Below 10 dates, no cell names a lowest error; below 30 dates, a cell is a small sample. Cells are descriptive: verdicts still come only from the matched comparisons above.
- **Observed classes explain errors; they never select weights.** Only target- and issue-basis classes may condition an experimental recipe.
- **Experimental weights** (`config/experiments.js`) wait until their matched training cases reach 60 distinct dates. A conditional experiment names every required class (for forecast change: warmup, cooldown, small change). Each class must reach 60 dates; a class with no cases is 0 dates and keeps the experiment at "insufficient training data". Wherever no usable fit exists (before fitting, a failed fit, or a case outside the named classes such as "unknown"), the experiment uses the prior recipe, unchanged. Each is then fitted once and recorded in `experiments/<id>.fit.json`, never refitted or edited. It is evaluated only on captures that started after the fit, for valid dates beyond a 3-day embargo. Nothing here changes a recipe or a default.
- **Climate patterns are archived as published** (`lib/climate-indices.js`, climidx-v1): NOAA CPC ONI, RONI, daily AO, NAO and PNA, and the BoM MJO RMM.
  - **Retrieval:** once per UTC day during the observation job, one attempt each. A 403 or 429 stops further requests to that host for the day.
  - **Log:** every retrieval is written to `climate/retrievals/` with its time, HTTP status, the server's Last-Modified header (its modification time, not an official issue time) and a SHA-256.
  - **Versions:** each distinct published version is saved as received under `climate/raw/`, so revisions are new versions, never edits.
  - **Isolation:** failures never affect observations or scoring.
  - **Times:** three are kept apart: retrieval (ours), the valid period (from the data), and official publication. These files do not state an official publication time, so it stays unknown. A version's earliest proven availability is our first retrieval of it, never backdated from Last-Modified, and `availableAt()` gives the version a capture at a given time could have used.
  - **Use:** the values are not yet attached to issue contexts, and no relationship with forecast skill is inferred before several seasons per phase.
- **Model versions:** no provider reports one. `MODEL_VERSIONS` in `lib/context.js` holds dated upgrades from cited notices, and is empty until such a notice is entered.
- **Coverage through days 8–10:** `reports/CONTEXT.md` lists primary pairs and dates per source, recipe, target and lead band, the matched cases at days 8–10, and each source's horizon. Overnight lows (7p–7a) and climate-day minimums stay separate targets.
- **Failures are visible:** a context failure at capture is recorded on the capture, and a failed condition report appears in `STATUS.md` under "Context layer"; collection and scoring continue either way.
- **Forecast cloud cover, wind and dewpoint** (`lib/context-vars.js`, ctxvars-v1):
  - **Requests:** after the primary sources, one separate request per deterministic model asks for `cloud_cover`, `wind_speed_10m`, `wind_direction_10m` and `dew_point_2m`. Each model gets one attempt, made one after another. The first HTTP 429 stops the rest for that capture, and so do three requests in a row without an answer.
  - **Storage:** responses are saved as received (`ctx-<model>.json.gz`), and the capture record lists each variable's unit, non-null hours, last valid time and any missing fields. NWS values come from the gridpoint response every capture already saves; no new request is made.
  - **Effect on existing data:** the primary requests, their raw responses, normalization (normalize-v4) and scores are unchanged, and a context failure never changes a capture's outcome.
- **Capture order** (`lib/capture-order.js`): core models and NWS first, then TV products, then optional context requests. Optional requests also have a total time budget of 180 s, so they can never delay a core or TV retrieval. Each step's start and end are recorded on the capture, and every response keeps its own retrieval time.
- **Forecast night classes** (forecast-night-v1), fixed before their errors were examined and using only the capture's own responses. Each night runs 7 PM to 7 AM local standard time and must start at least 60 minutes after the response was retrieved.
  - **clear/calm:** two thirds of the night's hours have cloud cover ≤ 25 % and wind ≤ 6 mph.
  - **windy:** mean wind ≥ 12 mph.
  - **cloudy:** two thirds of the hours have cloud cover ≥ 63 %.
  - **mixed:** otherwise. Any missing hour makes the night unknown.
  - **Sources:** each night is classed per model, from the NWS grid, and as a model consensus (a majority of at least three models).
  - **Kept apart from observed nights:** observed nights (radiational, cloudy, windy, mixed) come from METAR afterward and use separate names. Issue contexts built after their capture (context-v2 beside context-v1, never rewritten) are labelled retrospective.
- **Availability by lead and variable:** `reports/CONTEXT.md` gives, per source and variable, each of leads 1–10 separately as captures with every hour of that local day present out of captures where the variable was collected. "Not available in our current collection" means only that our captures did not receive it.
- **Originals are only read.** Raw responses, normalized bundles, observations and captures are never modified by this layer.

## Local blend learning (prepared, not active)

`lib/learn.js` provides the following:
- **Time-ordered splits** with an embargo gap, never random.
- **System-level weights** per variable and lead group (d1–2, d3–4, d5–7). They are non-negative, sum to 1 and are shrunk toward Baseline v1.
- **Shrunk bias corrections.**
- **Source-error correlations**, because NBM, NWS and raw models are not independent.
- **Evaluation on unseen dates** with the block bootstrap.

**Modes.** "Brad's preferred" is Baseline v1. "Local verified" holds no recipe yet. "Custom" is your own weights.

**Promotion rules:**
- At least 60 training dates.
- At least 60 later evaluation dates.
- A 90 % CI showing improvement.
- No lead group worse.
- A recorded decision in `config-log.jsonl`.

Candidates run in parallel first. Nothing changes a default automatically. New locations start from Baseline v1 with documented regional information, and gain local adjustments only as evidence accumulates.

## Deployment

1. Create a **private** repository, e.g. `WxMan33/forecast-ops-data` (no template, any initial commit).
2. Add `verify/deploy/collector.yml` to it as `.github/workflows/collector.yml`. Actions must be enabled, which is the default.
3. Run it once from the Actions tab with job `collect-manual`, then `observe-score`, to confirm a first successful capture.
4. Open `verify.html` on the site and enter the repository and a fine-grained token. Use Contents read-only, or read and write to save review decisions. Scope the token to that repository only. The token stays in that browser.

No credentials are stored in any repository.

**Operating cost.** Each day uses about 35 Actions minutes: 2 captures including the wait for the target, 6 no-op or backup triggers, and 8 observe/score runs. That is roughly 1,000–1,100 minutes a month, inside the free plan's 2,000 private minutes. Storage grows by about 1 MB per capture (raw responses, ensembles, TV evidence stored once by hash), roughly 0.5–0.7 GB a year. Plan a yearly archive of `raw/` to a release asset before the repository nears GitHub's recommended size.

## Before changing defaults or publishing anything

**Changing blend defaults** needs all of the following:
- At least 60 later, unseen on-time evaluation dates per lead group, after at least 60 training dates.
- A 90 % block-bootstrap interval showing improvement over Baseline v1, with no lead group worse.
- Agreement across both capture slots.
- A recorded decision.

**Publishing TV results** needs all of the following:
- At least a full season (~90+ matched dates per lead) with dependable collection: on-time rate and review backlog visible.
- Location and period comparability resolved for each product.
- Manual audit of OCR extractions.
- Explicit uncertainty.

TV results stay private during the pilot. No "most accurate" claims are made.
