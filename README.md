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
- Quick-pick locations: `PRESETS` in the same file.
- Models and default weights: the `MODELS` / `ENS` lists at the top of `blend.js`, `thunder.js`, `severe.js` and `winter.js`.
- Signal rules and all forecast math: `assets/ops-core.js` (`thunder.tier`, `severe.tier`, `severe.flags`, `winter.tier`). The rule text on each page sits beside them in the HTML.

## How it's organized

- `assets/ops-core.js` holds all forecast math: blending, sounding indices, signal rules and ensemble odds. It has no page code and runs in a browser or Node.
- `assets/ops.js` is the shared page shell: header, nav, location, NWS alerts, data status, change tracking and chart helpers.
- One script per page: `overview.js`, `blend.js`, `thunder.js`, `severe.js` and `winter.js`.
- `tests/core.test.js` checks the math against hand-worked cases and missing-data rules. Run it with `node tests/core.test.js`.

## Data rules

- Missing data never reads as a quiet LOW. If instability is present but the inputs needed to judge it are missing, the hour shows **LIMITED DATA**.
- Ensemble totals only count members with at least 90% of the window. Plume lines stop at a gap instead of treating missing hours as zero.
- The header chip says **PARTIAL DATA** whenever a model failed, had no coverage, or lacked fields. Hover it for the list.

## Moving this into Heads-Up / OPE later

`ops-core.js` is the piece to carry over. Each function takes plain arrays (Open-Meteo naming) and returns plain numbers or signal keys (`normal`, `monitor`, `prepare`, `action`, `limited`, `nodata`). Those keys map straight onto Heads-Up's fixed status colors.

The intended path for calendar-based event briefings is:

1. Run the same core functions server-side on a schedule for each saved venue and event window.
2. Store each run's summary. This is what the "since your last check" snapshots already do, in the browser.
3. Send a routine daily briefing, plus a notification only when something meaningful changes: the signal tier, the precip or snow odds, or the timing.

Advance thunder guidance stays separate from detected lightning and the all-clear clock, which remain Heads-Up's job.
