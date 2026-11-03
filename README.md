# Forecast Ops (static site)

Four point-forecast tools styled to match the Heads-Up ops console:

| Page | What it does |
| --- | --- |
| `index.html` | 3-day summary for the location (blend, thunder signal, ensemble snow odds) and links to the tools |
| `blend.html` | Weighted multi-model blend: spread bands, daily table, temperature agreement |
| `thunder.html` | Hour-by-hour thunder signal in the Heads-Up status colors (LOW / MARGINAL / ELEVATED / HIGH) |
| `severe.html` | Severe environment from model soundings: shear, SRH, Bunkers motion, lapse rates, LCL, STP and SCP, plus a hodograph |
| `winter.html` | Ensemble snow odds, accumulation plume, temperature spread |

Plain HTML, CSS and JavaScript. There is no build step and no server. Each browser pulls free model data straight from [Open-Meteo](https://open-meteo.com/), which needs no API key. The free tier is for non-commercial use.

Live at **https://wxman33.github.io/forecast-ops/**

## Try it locally

Double-click `index.html`, or run `python -m http.server 8000` in this folder and open http://localhost:8000.

## Publishing

GitHub Pages serves this repo straight from the `main` branch, so every push to `main` goes live within a minute or two. That's set in **Settings → Pages**: Source is **Deploy from a branch**, branch `main`, folder `/ (root)`. `.nojekyll` tells Pages to serve the files as-is.

## Adding your own domain later

Buy a name from a registrar (Cloudflare, Porkbun, Namecheap: about $10–15 a year). In **Settings → Pages → Custom domain**, enter it, then add the DNS records GitHub shows you at the registrar. The site files don't change.

## NWS comparison

NWS point forecasts come from api.weather.gov. In **Model Blend** NWS is one weighted source inside the blend (heavy by default, adjustable like any other). Everywhere else, and in the comparison tables, NWS values are shown as a labelled source of their own.

- **Lookup:** each location is resolved through `/points/{lat},{lon}`, then its forecast, hourly and grid-data URLs are followed. The point mapping is cached for a week; forecasts refresh every 15 minutes.
- **Units and times:** grid values carry their WMO units (°C, km/h, mm) and are converted to °F, mph and inches. They keep their own valid intervals; official forecast periods keep their day/night start and end times.
- **Accumulations stay in intervals.** NWS precip, snow and ice are interval totals (usually 6 h), never spread into hours. A window total is exact when intervals line up with the window, and is shown as a lower–upper range when an interval straddles an edge. Uncovered windows say "not covered", never 0.
- **Probabilities stay what they are.** Official period PoP is shown as-is. Hourly grid PoP is shown only as hourly values, or a range of them; it is never summed, and never treated as a daily or phase probability.
- **Freshness:** data older than 12 hours counts as stale and is dropped, not shown. NWS failures are isolated: the model tools keep working and the header chip says what's missing.
- **Where it appears:**
  - Blend: inside the blend at its weight (temperatures, dew point, feels-like, wind, gusts, cloud from the grid; precip and snow from its interval totals, exact when aligned with the window and otherwise prorated by overlap and marked \*; its hourly PoP is excluded because its threshold and period differ from Open-Meteo's). Also an NWS line on compatible charts, NWS day-high and night-low columns, an NWS-vs-blend table over each official period's own hours, and NWS columns in event tables.
  - Overview: NWS day/night values on the day cards and in the event briefing.
  - Thunder: NWS gridded thunder probability, kept with its own multi-hour validity intervals. NWS doesn't document the probability's period, so hourly displays only sample each value across its interval.
  - Winter: NWS weather wording (the only source that can say sleet), plus NWS snow and ice totals.

## Winter diagnostics

Field availability comes from a real inventory, `tests/fixtures/om-inventory.json`:

- **Wet-bulb temperature** is provided by every deterministic model.
- **Temperature profiles:** GFS, HRRR, ICON, GEM and UKMO have 8–10 levels below 500 hPa; ECMWF and AIFS have 6; NBM and NAM have none.
- **Ensembles** carry surface fields only.

The Winter page shows:

- **Precipitation type**, side by side from three sources:
  - each model's own WMO weather code, which has no sleet category
  - NWS wording
  - an **experimental** profile reading using the *original* Bourgouin energy method as implemented in NCEP UPP (`CALWXT_BOURG`), not the revised method (Birk et al. 2021). It is shown only for profiles that pass its provisional coverage checks (surface, first level within 1500 m, data through 3000 m, sub-freezing top). Passing does not mean every warm or cold layer was resolved; these are sparse pressure levels. The energy sums and decision tree (`winter.bourgouinLayers`) are compared in CI with the **original UPP Fortran** on identical layer inputs (see below). Turning sparse levels into layers (`winter.pointsToLayers`: linear in height, 25 m layers) is this tool's own representation choice, and its effect is reported separately
  It also shows each model's transition times and the spread of transition timing across models.
- **Profiles:** for any clicked hour, every model's profile, with surface temperature, wet-bulb, dew point, warm nose, warm-layer depth, cold-layer depth and Kuchera ratio. Charts for surface T/Td/wet-bulb, 925/850 hPa temperatures and the warm-nose peak.
- **Snow amounts, kept distinct:**
  - model snow as reported (Open-Meteo's fixed 7:1 conversion)
  - snow water
  - 10:1
  - Kuchera (experimental; shown only when the profile passes its own coverage checks: through 500 hPa, no gap over 1800 m)
  - NWS snow and ice from its interval totals
  - hours where warm ground likely limits accumulation
  None of these claim ground or road accumulation.
- **Ensemble odds** use only members that cover the whole window.
- **COARSE** marks the largest gap between levels in any interval overlapping the lowest 3 km, shown in metres, when it exceeds 1000 m. The rule and threshold are the same for every model, and provisional.
- **Representation sensitivity is shown, not hidden.** Each profile is also diagnosed with step layers between level midpoints (`winter.pointsToStepLayers`). Where that changes the type, the hour is marked REP-SENSITIVE and both diagnoses (with PA / NA / surface energies) are available beside the result.
- **Reconstructable p-type log.** For every hour with precipitation, one record per model holds: UTC valid time, retrieval time, model, location and elevation, the exact input profile (`z, p, t, rh`), method versions (`winter.METHOD`), coverage flags for p-type and Kuchera, the model's own code type, primary and alternate diagnoses with energies, and `repSensitive`. NWS wording is saved per hour with its grid update time. Stored under `ops_verify_ptype` (last 3000 records, about 1 KB each; export regularly during an event).
- **Observations are logged separately** (Winter page, `ops_obs`): time, every type seen (mixes are first-class), certainty (certain / probable / uncertain), intensity, report source and notes. The footer export writes forecasts, p-type records and observations as separate arrays in one file.
- **Three distinctions are kept.** *Algorithm agreement*: the energy sums and decision tree match UPP on the tested layers. *Profile representation*: converting sparse levels to layers is an approximation (12 of 842 test profiles change category; refreezing energy gaps up to 1,280 J/kg). *Forecast skill*: neither establishes which type will fall; only observations do, and agreement with NWS is a comparison, not truth.

### How the Bourgouin implementation is checked

- **Original code:** `tests/upp/` holds the unmodified UPP `CALWXT_BOURG.f`, pinned to a commit with its SHA-256 (`tests/upp/SOURCE.md`).
- **CI:** the `upp` job compiles it with gfortran and runs it on about 840 layer profiles: named cases, sweeps across every threshold, and random profiles. It runs 8 random seeds per case for UPP's transition-zone draws, plus a build-time copy with one added `write` line to expose the energies.
- **Comparison:** melting, refreezing and surface energies must agree to float precision. Categories must agree, threshold cases included.
- **Offline cross-check:** `tests/reference/upp-bourgouin.js` is a separately written JavaScript port with its own points-to-layers conversion, used for quick offline checks. It is not the original code.

## Blend sources, presets and weighting

- **Sources:** deterministic models, two ensemble systems (ECMWF ENS, 51 members; GEFS, 31 members; temperature, precip and snow) and the NWS point forecast. Each source has one total weight; an ensemble's weight is shared equally by its members, so member count never decides its influence.
- **Highs and lows from members:** each ensemble member's own daily (or phase) high, low and total is computed first, then the members are averaged. Taking the high of the hourly ensemble mean would flatten the extremes. Members (like models) count only when they cover every hour; dropped members don't shrink the system's weight. ECMWF ENS is 3-hourly at longer leads, so its interpolated hourly peaks can run slightly low.
- **Weighted guidance spread:** under each daily value, the 10th–90th percentile across all sources, with ensemble members carrying their share of the system weight and NWS, NBM and each model counting once. It mixes ensembles with single forecasts, so it is **not** a calibrated probability. An ensembles-only 10–90% range is kept separately (hover, and in the source breakdown).
- **Effective shares:** weights are relative, so the recipe shows each source's actual share. With every preferred source present, ECMWF ENS is about 30% of temperatures and NWS about 23%: the largest single sources, not a majority. Shares grow when short-range models drop out; the per-day breakdown shows the real numbers.
- **NWS highs and lows:** NWS enters the blend's calendar-day high and low through its hourly temperatures. Its official day-high and night-low stay in their own columns and are not used directly.
- **NWS precip bounds:** when NWS intervals cross a day or phase edge, its share is prorated assuming a uniform rate. The blend at NWS's lower and upper bounds is shown beside the value (hover on days; in brackets for event phases).
- **Probabilities kept apart:** "Chance ≥0.01″ (ens.)" is the weighted share of ensemble members with measurable precipitation over the same calendar day or phase. Open-Meteo's hourly precipitation_probability (models) and NWS PoP use other thresholds and periods, so they are never mixed into it, and NWS hourly PoP is excluded from the model chance.
- **Presets:** **Your preferred weighting** (default): NWS ×3, ECMWF ENS ×2 and ×4 for temperatures (the heaviest temperature source), GEFS ×1, ECMWF IFS and NBM ×1, other models ×0.5, NAM ×0.25. It is your stated preference, labelled as such until verification supports changes. **Custom weights** (your sliders; ensembles and NWS now appear in the list), **Equal raw consensus** (every raw deterministic model at weight 1, NBM excluded because NBM already blends and calibrates these models) and **NBM only**.
- **What's driving the blend:** for the selected day, every source's own high, low and precip and its share of the weight.
- The overview uses the same recipe as the Blend page (preset, weights, ensembles, NWS).
- **Variable- and lead-time weighting:** `blend.weightFor` supports both in shared code. Only the preferred preset's temperature factor for ECMWF ENS is enabled. Ideas are recorded in `blend.HYPOTHESES` as untested hypotheses, to be verified before use.
- **Precip timing scenarios** group models by onset, so different storm timings aren't averaged into a long light event.
- Severe keeps each model's extremes beside the consensus.
- Model agreement is never presented as a calibrated probability.
- **Verification records** (source, retrieval time, NWS update time where available, valid window, contributors, weights, values) are saved in the browser on each load and exported from the footer. They make it possible to score these alternatives against observations later. The Open-Meteo forecast API doesn't report model cycles, so cycle is null for model records.

## Time zones

Everything is computed on real UTC instants. Each provider response's labelling is detected, not assumed:

- **Fixed offset:** Open-Meteo, observed November 2026 and checked daily by the live test.
- **True local:** repeated or skipped hours.

Every label, tooltip, shaded event phase and table is shown in the venue's real IANA time zone. A repeated fall-back hour shows its zone ("1a EDT", "1a EST").

Event times that don't exist (spring-forward) are rejected. Event times that occur twice (fall-back) require you to choose which occurrence.

## Events

Save an event in the **Event** card under Location. Each event has a name, a location and up to five local times: setup starts, gates open, event starts, event ends and teardown ends. Start and end are required.

- Every page shows the same phases (Setup, Gates, Event, Teardown and the whole event) in an **Event windows** table, and shades them on the charts and hourly strips.
- **Coverage** says whether each phase is fully inside the forecast (FULL), only partly (PARTIAL x/y h), already over (PAST) or not reached yet (NOT IN RANGE YET). Values only show for fully covered phases.
- The **Overview** has an event briefing: blend temperatures, precip and gusts, ensemble snow odds and the thunder signal for each phase. It tracks changes per phase by event ID and exact window.
- The event record is plain data with a stable ID, kept in the browser for now: `{id, name, loc, tz, times: {setup, gates, start, end, teardown}}`. A calendar connection or server could create the same record.

Event times are local to the event's location and stored with its IANA time zone; see **Time zones** for how they are converted and shown.

## Customizing

- Name, owner and contact: the `BRAND` block at the top of `assets/ops.js`.
- Quick-pick locations: `PRESETS` in the same file. Places you save with ★ are kept in your browser.
- Models, default weights, variables and request settings: `config` in `assets/ops-core.js`. Every page, the overview and the tests read from it.
- Signal rules: `thunder.assess`, `severe.assess`, `severe.flags` and `winter.tier` in `assets/ops-core.js`. The rule text on each page sits beside them in the HTML.

## How it's organized

| File | Role |
| --- | --- |
| `assets/ops-core.js` | Model configuration, daily and hourly aggregation, sounding math, signal rules, ensemble odds and change comparison. No page code; runs in a browser or Node. |
| `assets/ops-data.js` | Requests and aligns Open-Meteo data for a config spec. Used by every page, the overview and the live test. |
| `assets/ops.js` | Page shell: header, nav, location, NWS alerts, data status, change display and chart helpers. |
| `assets/*.js` | One script per page. They only draw; the numbers come from the two files above. |
| `tests/core.test.js` | Hand-worked math, missing-data rules, winter gaps, partial model days, snapshot comparability, time zones (midnight, spring-forward, fall-back), NWS units/intervals/allocation, Bourgouin and Kuchera cases, presets, weighting and timing scenarios. Run with `node tests/core.test.js`. |
| `tests/fixtures.test.js` | Repeatable regression checks on real captured responses in `tests/fixtures/` (NWS points, forecast, hourly, grid for two places; Open-Meteo winter fields, inventory and a time-change response). Run with `node tests/fixtures.test.js`. |
| `tests/capture.js` | Refreshes those fixtures from the live APIs (Actions → "Capture fixtures"). |
| `tests/live.test.js` | Pulls real Open-Meteo responses for two places through the same loader and math. Checks that every expected field has real values (with an explicit exceptions list), units, ranges, member counts, time axes, daily highs against Open-Meteo's own, and the fixed-offset labeling across a recent daylight-saving change. Run with `node tests/live.test.js`. |

GitHub Actions (`.github/workflows/tests.yml`) runs the unit and fixture tests on every push, and the live test on every push and every morning. A provider outage is reported as a skipped block with a warning, separately from calculation failures. Passing tests establish correctness, compatibility and plausibility, not forecast accuracy. Results are under the repo's **Actions** tab.

## Data rules

- **Signal and completeness are separate.** Every hour gets a signal level (LOW to HIGH) and, independently, a limited-data flag listing what's missing. Limited hours are hatched on the timelines and tagged LTD in tables. A HIGH hour can also be limited.
- **A model counts for a day only if it has every hour of that day.** A model that ends mid-day (HRRR at 48 h, for example) is left out of that day rather than understating its totals.
- **Ensemble odds use only members that cover every hour of the window.** A member with gaps gives a lower bound ("at least") and is reported separately. It never decides a threshold. Plume lines stop at a gap.
- **"Since your last check" compares like with like.** Rows are compared only when they cover the same valid window. Each snapshot records the contributing models and your weights. If either changed, those differences go in a separate **recipe changed** group (`affected` in `changes.diff`). They are never treated as forecast changes, so they can't trigger a "forecast worsened" alert later.
- **The overview matches the tools.** It uses the same config, the weights you've set on each tool page, and the same aggregation, over full calendar days.
- The header chip says **PARTIAL DATA** whenever a model failed, had no coverage, or lacked fields. Hover it for the list.

## Forecast verification (private)

`verify/` holds a separate verification service: twice-daily captures of every source, OPE blend recipes (Baseline v1 frozen) and a Cincinnati TV pilot at CVG, with observations, scoring and a review queue. It runs on GitHub Actions in a **private data repository** and never touches these pages; `verify.html` is a private dashboard that reads that repository with your own token. See [verify/README.md](verify/README.md).

## Moving this into Heads-Up / OPE later

`ops-core.js` and `ops-data.js` are the pieces to carry over. They run unchanged in Node, which is how the live test uses them. A scheduled briefing service would:

1. Load each saved venue with `OpsData.loadModels` / `loadEnsemble` and the same `config`.
2. Compute the event window with the same `blend.dailyRows`, `thunder.hourly`, `severe.series` / `assess` and `winter.windowStats`.
3. Store each run's summary with its window, contributors and settings, and use `changes.diff` to decide whether anything meaningful moved.
4. Send a routine daily briefing, plus a notification only for meaningful changes.

The shared event window, NWS comparison and verification log are in place. The next step is to use the workspace on real setups and collect verification records; those, scored against observations, are the evidence for any change to blend weights.

Advance thunder guidance stays separate from detected lightning and the all-clear clock, which remain Heads-Up's job.

## Publishing changes to assets

After editing anything in `assets/`, run `node tools/stamp-assets.js` before committing. It gives each
asset reference a content-hash version (`assets/ops.js?v=…`), so a returning browser can never
combine new HTML with cached older JavaScript or CSS. It also keeps a small load guard in each page that shows a
"didn't finish loading" message with a Reload button if a script fails. The Tests workflow runs
`node tools/stamp-assets.js --check` and fails if a stamp is out of date. Saved locations,
settings and logs (browser localStorage) are not affected.
