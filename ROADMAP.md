# Forecast Ops roadmap

Updated November 3, 2026. This is planned work, not a claim that these features are implemented. Forecast Ops remains a standalone forecasting workspace, with eventual integration into OPE Weather Ops.

## 1. Verification and the daily forecast workspace

- [ ] CVG forecast-versus-observed dashboard: overlay earlier archived forecasts with observed temperature, dew point and wind; summarize bias, timing and errors by source and actual lead time. Keep routine hourly observations separate from official daily climate extrema.
- [ ] Forecast history: follow a fixed valid hour, calendar day or event window through successive captures, including temperatures, precipitation and snowfall. Distinguish changed contributors/settings from changed guidance.
- [ ] My forecast: begin with the blend, edit lows/highs, precipitation and wording, and save immutable issued forecasts with issue times and method versions. Verify these separately from the untouched blend.
- [ ] Continue prospective CVG blend and local-TV verification through the private collector. Preserve matched cases, edition timing, source/product identity and uncertainty. Expand markets and official reporting stations after the pilot is operational.
- [ ] Evaluate variable-, lead- and location-specific blend candidates against held-out observations; provide regional fallback for locations with little history. Keep current production weights and Baseline v1 unchanged until evidence supports a change.

## 2. Event planning and briefings

- [ ] User-defined rain, gust, temperature and lightning-concern thresholds applied consistently to the existing setup, gates, event and teardown phases.
- [ ] Show supported planning windows, forecast coverage and uncertainty without implying an exact onset or all-clear from coarse guidance.
- [ ] One-page printable/exportable venue briefing with timing, thresholds, uncertainty, sources and forecaster notes.
- [ ] Later: calendar import/connection, routine daily event briefings and meaningful-change notifications using the same shared calculations.
- [ ] Keep forecast thunder potential distinct from detected lightning and OPE's operational lightning timer.

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

