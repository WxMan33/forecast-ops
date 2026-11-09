# Forecast Ops roadmap

Updated November 4, 2026. This is planned work, not a claim that these features are implemented. Forecast Ops remains a standalone forecasting workspace, with eventual integration into OPE Weather Ops.

## 1. Verification and the daily forecast workspace

**Before expanding collection (from the Nov 4 verification review):**

- [ ] Workflow concurrency: the collector's single concurrency group keeps only one waiting run, so a newer queued run (for example a personal-forecast push or an observation run) can cancel a waiting collection run. Split collection from scoring/receipt runs, or make every scheduled collection independently recoverable, before adding markets, stations or editions. Receipt evidence no longer depends on the push-triggered run (the activity API is read on every run), so this affects collection reliability, not issue times.
- [ ] Blend rain-probability composition by lead: the blend's chance of >=0.01 in is a weighted mix of the ensemble systems that cover the whole window. Short-range systems (RRFS ensemble) drop out at longer leads, changing the mix silently. Record and display the contributing systems per lead, and compare probabilities only between cases with the same contributing set.

- [ ] CVG forecast-versus-observed dashboard: overlay earlier archived forecasts with observed temperature, dew point and wind; summarize bias, timing and errors by source and actual lead time. Keep routine hourly observations separate from official daily climate extrema.
- [ ] Forecast history: follow a fixed valid hour, calendar day or event window through successive captures, including temperatures, precipitation and snowfall. Distinguish changed contributors/settings from changed guidance.
- [ ] My forecast: begin with the blend, edit lows/highs, precipitation and wording, and save immutable issued forecasts with issue times and method versions. Verify these separately from the untouched blend.
- [ ] Continue prospective CVG blend and local-TV verification through the private collector. Preserve matched cases, edition timing, source/product identity and uncertainty. Expand markets and official reporting stations after the pilot is operational.
- [ ] Evaluate variable-, lead- and location-specific blend candidates against held-out observations; provide regional fallback for locations with little history. Keep current production weights and Baseline v1 unchanged until evidence supports a change.

### Original verification dashboard and winter-impact workspace

- [ ] Build an original Forecast Ops verification presentation with a compact Model Blend report card and a detailed Verification page. Other sites are functional references only; use our own visual design, source handling and scoring methods.
- [ ] Begin with CVG, then add suitable Tri-State stations after collector concurrency and capture health are resolved. Hourly temperature, dew point and wind use quality-controlled station observations; daily extrema retain official climate-day definitions.
- [ ] Show matched-case MAE, bias, sample size and coverage by station, variable and lead group (0–24 h, 24–48 h, days 3–5 and days 6–10). Offer recent-pattern, 30-day and 90-day views as the archive supports them. Comparisons require the same valid cases and explicitly compatible methods.
- [ ] Compare individual models, NWS, frozen prospective blend recipes and immutable personal forecasts. Small-sample ranks must not automatically change production weights. Treat forecast disagreement as guidance spread rather than calibrated confidence.
- [ ] Build our own winter-impact view: distinguish snow falling, new accumulation and possible surface impacts; show timing, supported thresholds, usable member coverage and uncertainty. Inspect existing winter calculations before adding methods.
- [ ] Experimental sticking/melting estimates remain labelled scenarios until tested against observations; do not present an unverified rule-of-thumb score as a calibrated probability. Avoid double-counting seamless/duplicate model products.
- [ ] Retain the detailed meteorologist workspace while providing an original, simple one-page OPE decision briefing focused on what, when, uncertainty and operational relevance.

## 2. Event planning and briefings

- [ ] User-defined rain, gust, temperature and lightning-concern thresholds applied consistently to the existing setup, gates, event and teardown phases.
- [ ] Show supported planning windows, forecast coverage and uncertainty without implying an exact onset or all-clear from coarse guidance.
- [ ] One-page printable/exportable venue briefing with timing, thresholds, uncertainty, sources and forecaster notes.
- [ ] Later: calendar import/connection, routine daily event briefings and meaningful-change notifications using the same shared calculations.
- [ ] Keep forecast thunder potential distinct from detected lightning and OPE's operational lightning timer.

## Regional forecasting workspace

1. [x] Point blend transparency: source contributions by forecast day on Model Blend.
2. [x] Gridded model maps v1: HRRR 3 km over the Tri-State (temperature, precipitation windows, simulated reflectivity) on the native grid, published by WxMan33/forecast-ops-maps.
   - [ ] Next models through the same pipeline: RRFS, then GFS for days 3–10. Other forecast areas.
3. [ ] Area forecasts: county, venue-area and custom-polygon summaries showing spatial variation and where/when thresholds are exceeded.
4. [ ] Regional gridded blend: variable-specific weights, explicit handling of different grids and forecast horizons.
   - [ ] Verify at additional reporting stations before claiming CVG-tuned weights work across the region.
- [ ] Hosting plan for OPE Weather Ops: GitHub Pages is for this personal pilot only (size and bandwidth limits; not for commercial services).

## 3. Additional guidance and context

RRFS deterministic and the five-member RRFS ensemble are registered. A native CVG point feed is the initial implementation; full time-lagged REFS is a separate future integration. See [model status](MODEL-STATUS.md). HREF is legacy guidance under the November 2026 transition, rather than a new integration target.

- [ ] NBM temperature percentiles and precipitation exceedance guidance, shown with source, threshold, valid period and coverage. Keep these separate from the mixed guidance spread.
- [ ] RRFS/REFS short-range precipitation and convective guidance: timing differences, heavy-rain potential and ensemble/neighborhood products. Retain neighborhood radius/area definitions; do not label neighborhood probabilities as exact-point probabilities.
- [ ] WPC WSSI/WSSI-P winter impact context alongside accumulation guidance and official alerts.
- [ ] NWS Area Forecast Discussion drawer: automatically select the location's forecast office, show issuance time and provide the original discussion.
- [ ] SPC and WPC outlook context with valid times and location relevance.
- [ ] Continue real-setup evaluation of winter precipitation type, temperature profiles and accumulation uncertainty. Experimental diagnostics remain inspection tools, separate from automated alert decisions.
- [ ] Treat new guidance as comparison products first. Any later contribution to the blend requires compatible variables/windows, clear provenance and verification.

## 4. Usability and operational polish

- [ ] Compact operational mode with larger primary numbers and expandable explanations.
- [ ] Source-health drawer showing retrieval age, provider update/cycle provenance, coverage, missing variables and failures.
- [ ] Consistent explicit Low / High labels, while preserving NWS day/night period meanings.
- [ ] Location comparison for CVG, home and saved venues.
- [ ] Accessible chart inspection by keyboard, click and tap, with units and valid windows visible.
- [ ] Move or collapse empty Notes on phones so climate information appears sooner.
- [ ] Express daylight changes plainly, for example "2m 13s shorter."
- [ ] Continue desktop, phone, light/dark and print review, including returning-browser asset upgrades and actual deployed-page checks.

## 5. Long-term model-map workspace

Build an original model-data explorer inspired by the workflow of [WeatherBell's model maps](https://maps.weatherbell.com/view/model), integrated with Forecast Ops and eventually OPE. Use independently sourced model data and original rendering.

### Current map priorities

- [x] On-demand field loading, cached run switching, failure recovery and sparse geography labels. No DMA outline or road-number badges.
- [x] Use native MapLibre symbol placement for city and selected-venue labels, with locally hosted font glyphs, population hierarchy and restrained density.
- [ ] Validate real-phone playback and memory before enabling the larger Ohio Valley data area.
- [x] First additional HRRR surface batch: 2-m dew point, 10-m wind speed, surface gusts and total cloud cover, with GRIB-defined units/levels and independent point checks.
- [ ] Next HRRR products: precipitation type and snowfall, with explicit categorical and accumulation definitions.
- [ ] Follow with matched-valid-time run comparisons. Repair RRFS/GEM archive gaps separately from rendering changes.

### Initial scope

- [ ] Begin with a bounded Ohio Valley/Tri-State domain and a small field set before scaling nationally.
- [ ] Assess official/open or licensed gridded data access for GFS, ECMWF deterministic/ENS, GEFS, HRRR and NBM; add RRFS and full REFS where supported. Document actual fields, resolution, cadence, latency and usage/redistribution terms before committing to each source.
- [ ] Model, initialization cycle, forecast hour, variable and geographic-domain selectors.
- [ ] Play/pause, scrubbing, speed controls and keyboard stepping, with initialization time, valid local/UTC time, units and legend always visible.
- [ ] Initial fields: 2 m temperature/dew point, wind/gusts, pressure, interval/total precipitation, snow and precipitation type where supplied. Clearly distinguish provider fields from derived diagnostics.
- [ ] Click a location for values, a meteogram and a sounding where the underlying vertical data support it.
- [ ] Saved regions, bookmarked products and shareable links.

### Later capabilities

- [ ] Synchronized side-by-side model and cycle comparisons; run-to-run difference maps with matched valid times.
- [ ] Ensemble mean/median, percentiles, spread and threshold probabilities with explicit member coverage and accumulation periods.
- [ ] Upper-air fields, thermodynamic profiles and severe-weather diagnostics with documented methods and adequate vertical resolution.
- [ ] Venue/event overlays connecting the map to the same point forecast and event-window calculations used elsewhere.
- [ ] Archived runs for case review and verification, subject to storage budget and retention policy.

### Data and infrastructure foundation

- [ ] Design a server-side ingestion, decoding, derivation and tile/render pipeline with caching and object storage; keep large model files out of the site git repository.
- [ ] Estimate compute, storage, egress and update latency for a limited pilot before expansion.
- [ ] Preserve provider, model version, confirmed initialization when known, valid time, accumulation window, native grid and processing version.
- [ ] Choose interpolation, regridding, below-ground masking and missing-data policies explicitly. Validate sampled map values against the input grids and point products.
- [ ] Load only required fields/regions and provide clear stale, partial and unavailable states.
- [ ] Use WeatherBell as a workflow reference, not as a source of copied maps, assets or scraped subscriber data.

## Suggested sequence

1. Maintain collector health and accumulate prospective evidence.
2. Add the CVG observed-versus-forecast dashboard, fixed-window history and My forecast workspace.
3. Add event thresholds, briefing export and selected official guidance/context.
4. Prototype a limited model-map data pipeline and viewer, measure its cost/performance, then expand.
5. Integrate into OPE and add calendar briefing/notification delivery.

This roadmap does not authorize changing blend weights, starting paid services or enabling new notification delivery.



### Forecast trends and two audiences

- Implemented: forecast-first Model Blend; recipe/sliders in the left controls; individual-source saved-guidance comparisons; precipitation timing and timing shifts; compact decision briefing from the same forecast. See MODEL_TRENDS.md for limits.
- Next: collector-backed historical run comparisons across devices, with confirmed initialization times where supplied. Browser snapshots do not represent every model run.
- Later: snowfall transitions, wind and thunder timing with suitable inputs, and OPE integration using exact venue/event windows and operational thresholds. Keep the detailed meteorologist workspace alongside the simple presentation.

### Later: Forecast Editor Chrome extension

- [ ] Prototype a Chrome helper for The Weather Company's 10-day and 48-hour Forecast Editor tabs. Match daily and overnight periods and hourly timestamps to an editable Forecast Ops blend draft.
- [ ] Fill supported numeric and wind fields from the blend. Keep weather phrases and narratives manual. Round precipitation chances to the nearest 10 percentage points and confirm whether humidity should use the same rounding. Confirm whether icons can be edited independently and how to map the Weather Impact Index.
- [ ] Preview the changes, unlock the active tab, verify the applied values and relock the tab, including recovery after a partial fill. Leave Publish as a manual step.

### Shared design and colleague betas

- [ ] Create one visual system for Forecast Ops and OPE Lightning Ops: shared basemap styling, map controls, legends, status colors, typography and time labels. Keep the current Forecast Ops workspace as the starting point. Use Apple's hierarchy and F1's data density as references, with an original map-led layout, readable type, tabular numbers and purposeful color.
- [ ] Publish two separate colleague test links from the same codebase. The meteorologist beta keeps Forecast/Maps front and center, with model spread, soundings, comparisons and expert controls close at hand. The event manager beta leads with a mobile-friendly venue and event timeline, plain-language impacts, timing and what to check next. Use shared forecast and map components.
- [ ] Add private beta usage reporting for the meteorologist workspace: feature opens, interactions and active time by tool, excluding idle and hidden tabs. Use aggregate counts and active time to guide the next design pass. Keep forecast inputs and event or venue details out of analytics.
- [ ] Make calendar import a primary event workflow: read-only Google Calendar picker, event selection, and confirmation of the venue and time zone. Add opt-in heads-ups when an upcoming event crosses a configured weather threshold or the risk materially changes, with event name, timing and a link back to the briefing. Define repeat suppression and notification preferences before enabling delivery.
