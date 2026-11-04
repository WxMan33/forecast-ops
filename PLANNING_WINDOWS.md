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

## Custom weight ranges

The Custom weights foldout has an Edit weights for selector: First 48 hours, Days 3–14 (after 48 h), or Entire forecast. Both time ranges independently store enabled sources and direct weights in `ops_blend_period_weights_v1`. Existing custom weights seed both ranges when first opened from Custom; the hi-res preset seeds the early range with its precipitation/gust-sized multipliers and the later range with the preferred base. This initialization does not activate Custom or change the selected preset. The first slider/checkbox edit activates Custom. Custom weights have no extra hidden variable multipliers.

The First 48 h range is the half-open interval from the loaded forecast's viewedAt through viewedAt+48h; later hours and already-past hours use the later profile. Unlike the automatic near48 preset, these explicit custom ranges switch exactly at 48h. Periods spanning the boundary use the time average of the absolute source weights; highs/lows remain each source's own extreme and ensembles remain member-first. Hourly charts, period summaries, daily rows and source diagnostics use this same rule.

Entire forecast shows the longer-range settings. When profiles differ the editor says so. Changing one source's slider or checkbox copies only that source's setting to both profiles, retaining differences for other sources. Reset restores the displayed picker defaults only for the selected profile, or both profiles in Entire forecast. Simply switching the editor scope never edits a forecast weight.

Both profiles persist across reloads and are shared with Overview. Older `ops_blend_models` values remain saved. Browser exports record custom range rules; private scheduled scoring is unchanged and does not yet verify this recipe prospectively.

## Requested default weights, revision 2 (Nov. 4, 2026)

Default Custom profiles now use `OpsCore.blend.CUSTOM_DEFAULTS`, ID `brad-scoped-default-2026-11-04-v2`. First 48 h: NWS 4, ECMWF ENS 3, GEFS .75, RRFS ENS 2, ECMWF IFS 1, ECMWF AIFS .75, GFS .5, NBM 3, HRRR 3, RRFS 3. After 48 h: NWS 3, ECMWF ENS 4, GEFS 1, RRFS ENS .5, ECMWF IFS 1.25, ECMWF AIFS 1, GFS .75, NBM 2, HRRR off, RRFS .5. Other sources are off in both defaults. These are provisional preference-based settings, not verified station skill or independent information weights; sources overlap substantially.

The user's request authorizes a one-time switch to these default profiles and Custom mode. Prior scoped settings, when present, are preserved under `ops_blend_period_weights_before_defaults_v2`; original frozen preferred weights remain unchanged. Later edits survive normal reloads. Reset restores the recommended profile for the selected range; resetting Entire forecast restores each range's distinct defaults.

Nominal all-source short-range weight is 21: NWS 19%, NBM 14%, HRRR/RRFS/RRFS ensemble together 38%, ECMWF ENS 14%. Later total is 14: ECMWF ENS 29%, NWS 21%, NBM 14%. Real shares depend on each variable's usable contributors. Horizons are enforced by data availability, so an RRFS late-range setting does not extend RRFS past its actual forecast. This revision is website-only until deliberately adopted as a new prospective scheduled-verification recipe.
