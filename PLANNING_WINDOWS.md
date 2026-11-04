# Forecast-first planning windows and near48 preset

## Location and low/high meaning

CVG airport (39.04456, -84.67229) is the built-in default and first quick pick. A one-time migration makes it the starting point for returning browsers without an explicit location URL. An old TQL-default URL also migrates once; other explicit URL locations keep precedence. Saved locations are retained; subsequent selections are remembered normally.

Overview uses explicitly labeled local planning periods: remaining today, tonight 6 PM–6 AM, tomorrow 6 AM–6 PM and tomorrow night. At 2 PM, tonight/tomorrow lead and remaining today moves to a compact line above them. After 6 PM, tonight starts at the current hour. Early-morning users get a remaining-morning period before today's daytime period. DST boundaries use actual UTC instants, not assumed 12-hour night lengths.

Each card prints its date/time window and one temperature labeled high or low. Temperatures/gusts use instants within [start,end); precipitation uses hour-ending amounts inside (start,end]. The partial current hour's full accumulation may include elapsed minutes; no subhour precision is invented. Snow/thunder guidance follows each card's own period, with missing coverage kept unavailable.

The daily Model Blend table stays low first/high second for midnight-to-midnight calendar days. Its morning low is not a forecast for the following night. Decision briefing on today's date instead uses the remaining period, extending through tomorrow at 6 PM after 2 PM. Future-day briefing cards explicitly say calendar low/high.

Overview and briefing presentation refresh their clock every minute while open, without fetching again. Refresh the forecast for new model data.

## Timing language

Timing is recomputed from the current hour forward for today's selection. After 2 PM the planning window extends through tomorrow at 6 PM. Existing model history remains an exact-window model comparison and is not trimmed or rewritten.

Past rain onsets are never presented as upcoming. Guidance spanning the current time is described as model precipitation underway, with future end signals or a boundary caveat. Later separate rounds use their own future onset; missing/limited guidance is not a dry forecast. This is model timing, not observed radar or evidence that rain is currently at a venue.

## New near48 preset

The separately labeled `near48` website preset starts with the unchanged frozen preferred recipe. It gives HRRR and RRFS temperature/apparent-temperature weight ×2 and precipitation/snow/gust weight ×3; RRFS ensemble factors are ×1.5 for temperature and ×2 otherwise. Other source weights, including NWS and ECMWF ENS, stay at base values. Only loaded sources with adequate coverage contribute. No new source is substituted for missing guidance.

Full enhancement applies to future valid times through 36 hours from forecast retrieval/view. It tapers linearly to base at 48 hours. Beyond 48 hours the original preferred recipe applies exactly. Hourly charts use each valid hour's factors. Daily extremes remain member-first: daily/event values use each source's own extreme/total with the average of the corresponding period's hourly weight factors. Source-contribution tables use the same calculation.

The website selects this default once for users on the preferred or custom view. Saved custom weights are retained and can be selected again; NBM-only and equal-model selections are kept. All original presets and custom sliders remain available. This is a user-preferred experimental emphasis, not a verified improvement.

The separate `near48` recipe name and rules are recorded in browser forecast exports. Frozen Baseline v1/Default v2 and private scheduled verification collection are unchanged. The private collector does not yet archive near48 as a new prospective recipe; it must be deliberately added with a version/effective time before claiming scheduled verification for it. No historical capture is rewritten.

Checks: forecast-clock.test.js includes morning/afternoon/night transitions, DST, past/ongoing/later precipitation rounds, clipped timing, hourly taper, day-3 identity with the base recipe and agreement between actual daily blend values and source-contribution shares.
