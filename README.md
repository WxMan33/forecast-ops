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
| `tests/core.test.js` | Hand-worked math, missing-data rules, winter gaps, partial model days and snapshot comparability. Run with `node tests/core.test.js`. |
| `tests/live.test.js` | Pulls real Open-Meteo responses for two places through the same loader and math, then checks units, ranges, member counts, time axes, and that the daily highs match Open-Meteo's own. Run with `node tests/live.test.js`. |

GitHub Actions (`.github/workflows/tests.yml`) runs both tests on every push and the live test every morning. Results are under the repo's **Actions** tab.

## Data rules

- **Signal and completeness are separate.** Every hour gets a signal level (LOW to HIGH) and, independently, a limited-data flag listing what's missing. Limited hours are hatched on the timelines and tagged LTD in tables. A HIGH hour can also be limited.
- **A model counts for a day only if it has every hour of that day.** A model that ends mid-day (HRRR at 48 h, for example) is left out of that day rather than understating its totals.
- **Ensemble odds use only members that cover every hour of the window.** A member with gaps gives a lower bound ("at least") and is reported separately. It never decides a threshold. Plume lines stop at a gap.
- **"Since your last check" compares like with like.** Rows are compared only when they cover the same valid window. Each snapshot records the contributing models and your weights, and the page notes when either changed.
- **The overview matches the tools.** It uses the same config, the weights you've set on each tool page, and the same aggregation, over full calendar days.
- The header chip says **PARTIAL DATA** whenever a model failed, had no coverage, or lacked fields. Hover it for the list.

## Moving this into Heads-Up / OPE later

`ops-core.js` and `ops-data.js` are the pieces to carry over. They run unchanged in Node, which is how the live test uses them. A scheduled briefing service would:

1. Load each saved venue with `OpsData.loadModels` / `loadEnsemble` and the same `config`.
2. Compute the event window with the same `blend.dailyRows`, `thunder.hourly`, `severe.series` / `assess` and `winter.windowStats`.
3. Store each run's summary with its window, contributors and settings, and use `changes.diff` to decide whether anything meaningful moved.
4. Send a routine daily briefing, plus a notification only for meaningful changes.

The next step toward that is a shared **event window** (setup, gates, start, teardown) that every page and the briefing evaluate identically.

Advance thunder guidance stays separate from detected lightning and the all-clear clock, which remain Heads-Up's job.
