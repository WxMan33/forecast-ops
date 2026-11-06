# Broadcast PoP and probability display

The daily blend's former **Source highs** column now shows **Broadcast PoP** with a short timing cue and, when present, a heavier-burst signal. The existing point ensemble chance and maximum hourly PoP remain separate.

## Meaning

This is experimental model guidance for a typical location in a regional sample centered on the selected forecast point. It is not calibrated probability, a DMA boundary, or the probability of rain anywhere in the region. Nine equally weighted points form a 3×3 grid spanning roughly 160 km north–south and east–west. Each selected location gets its own grid.

For each Euro ENS and GEFS member, sum hourly precipitation over the same local calendar day (only remaining hourly accumulation windows for today). A member is wet at a sampled point when its total reaches 0.01 inch. Average the wet-member fraction across the nine points, then average the two systems using their active precipitation weights over that window. Members share their system's weight; the larger ensemble does not gain extra influence just by having more members.

Six-hour local bins summarize precipitation timing (Overnight, AM, PM, Evening). Bins with at least 60% of the largest bin's mean precipitation are highlighted; more than two yields “Several windows.” These are broad windows, not predicted onset times. A separate “Heavier burst signal” appears when at least 20% of the weighted point/member sample produces 0.50 inch in a rolling three hours. This provisional investigation cue does not inflate the PoP or constitute a hazard advisory. Liquid-equivalent precipitation includes rain and snow.

## Availability and cost

Two additional precipitation-only, nine-location ensemble requests load asynchronously after the point forecast. A location/run change cannot attach old results to the new forecast. The API's existing short session cache applies. Initial response identity, units, nominal member count and axis lengths are validated. Every hour in the scoring window must be present, at least 90% of members must have complete values at each point, and all nine points must qualify. A single usable system is labeled explicitly; no usable system displays Unavailable. Missing data never become dry. Above 65° latitude the sample is unavailable. No broad product-grid expansion or verification-collector change is involved.

API reference: https://open-meteo.com/en/docs/ensemble-api (precipitation is the preceding-hour accumulation).

## Rounding

User-facing precipitation chances display to the nearest five percentage points (63% → 65%, 42% → 40%). The shared formatter is used on the blend, overview, thunder and winter views, including precipitation chart tooltips. Snow probabilities use the same display convention. Underlying model values, chart data, forecast weights, saved guidance and verification values retain their full precision. Cloud cover, relative humidity and model-weight shares are not precipitation chances and keep their existing formatting.

Tests cover the spatial versus rain-anywhere distinction, full-window accumulation, partial-day exclusion, missing data, disabled systems, the 48-hour weighting boundary, both DST transitions, API validation, unit conversion and rounding. The forecast browser test checks the replacement column and displayed values with synthetic ensemble data.
