# Forecast Ops (static site)

Four point-forecast tools styled to match the Heads-Up ops console:

| Page | What it does |
| --- | --- |
| `index.html` | Overview and location picker |
| `blend.html` | Weighted multi-model blend: spread bands, daily table, confidence |
| `thunder.html` | Hour-by-hour thunder signal on the NORMAL / MONITOR / PREPARE / ACT scale |
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
- Tier rules: `tierOf()` in `thunder.js` and `severe.js`, `flags()` in `severe.js`, and `tierFor()` in `winter.js`. The rule text on each page sits beside them in the HTML.
