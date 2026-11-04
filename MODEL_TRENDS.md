# Forecast workspace, model updates and decision briefing

Model Blend opens with the forecast. Location, events, the preset and custom sliders are in the left column; on phones they share a collapsible controls panel. Source contribution tables and the NWS comparison remain available under “Source breakdown & detailed diagnostics.” Forecast weights, sources, calculations and the private verification collector are unchanged.

“Model changes” and “Timing” jump to the two guidance sections. “Decision briefing” switches the same page to a compact calendar-day briefing. `blend.html?view=brief` opens it directly; location parameters can accompany that link. The briefing has its own date control and print view. It is a presentation layer for future OPE integration, not a connection to the main OPE software or an automated alert service.

## What a saved update means

- The browser retains at most six distinct snapshots at three locations. Snapshots are taken when guidance is loaded here, with session-only fallback if persistent storage is full or unavailable.
- This does **not** archive every model cycle or run while the site is closed. Previous, three-updates-ago and five-updates-ago refer to guidance actually seen in this browser. Repeated identical responses and slider changes do not create another update.
- All loaded sources are inspected, independent of blend selection. A trend is an individual source's change, not a change in the recipe or the blend's composition.
- A native NOAA run identity is retained when the response supplies one. Open-Meteo's “latest run” metadata does not establish the initialization time of its forecast response, so those snapshots are called guidance updates rather than confirmed successive runs.
- Windows must match in UTC, time zone, method and location. Partial/shrinking calendar days are excluded. Ensemble daily values are calculated member-first using the existing source aggregation; changes in usable member identities suppress numerical change claims. Prorated NWS amounts are not presented as definitive amount changes.
- Display filters: 3°F for highs/lows, 0.10 inch liquid precipitation, 0.5 inch model snowfall, 8 mph gusts, two hours for onset/end, 20 percentage points for the fraction of usable members with a distinct hourly precipitation signal. These are provisional display filters, not statistical significance or skill thresholds.

## Timing

Timing uses the hourly precipitation output supplied by each model. An hourly amount belongs to the preceding hour. Every hour in the fixed local-calendar window must be present, including the ending midnight amount. DST windows therefore have 23 or 25 actual hours when appropriate.

A distinct signal means at least 0.01 inch in an hour; “no distinct signal” does not mean a dry day. Separate precipitation rounds stay separate. Signals touching either date boundary are explicitly clipped and cannot produce a claimed onset/end shift at that edge. A missing hour is unavailable, not zero. NWS multi-hour QPF intervals do not become invented hourly onsets.

Ensemble timing is calculated separately for each complete member, then summarized among wet members. It is not taken from the hourly ensemble mean. Partial ensembles cannot drive timing-shift claims. The headline timing spread includes deterministic signals and ensemble systems where at least half the usable members have a signal. It is a spread of loaded systems, not a calibrated probability or an operational clearance time. Coarse/interpolated provider output limits timing precision.

Timing follows true calendar boundaries; the existing daily table's accumulation aggregation is unchanged and can differ at its edges. The briefing's forecast values always come directly from that displayed daily blend. Official NWS alerts remain in the shared site alert bar. The briefing is not an event-phase forecast, observed weather, or a lightning/severe clearance tool.

## Next stages

1. Use the archived, timestamped collector evidence for an actual run-history backend before offering cross-device or every-cycle trends. Preserve receipt and verification trust boundaries.
2. Add weather-specific timing (snow transitions, gust peaks and thunder windows) only with supported inputs and explicit limits; avoid inferring those from rain timing.
3. Bring the briefing presentation into OPE with actual venue/event windows and user thresholds. Keep the meteorologist's detailed workspace available.

## Validation

`node tests/model-trends.test.js` tests fixed windows, coverage changes, distinct snapshots, missing hours, boundary clipping, separate rounds, DST, member-first diagnostics and a captured GFS response. `tests/forecast-focus-browser.py` exercises both views, model update history, preset changes, direct links, failure states, light/dark, print and five viewport widths. Its model data is synthetic and its NWS data is a saved public response; screenshots are not real forecasts. The browser test runs in CI alongside the existing verification browser test.
