# Experimental severe probabilities

The Severe page includes a Nadocast-inspired viewer for Forecast Ops research v0.2. It displays archived HRRR-based predictions for tornadoes, severe wind and severe hail. It does not display a current severe-weather forecast, and dependable forecast skill has not been established.

## What the values mean

Each value estimates a qualifying report within 40.2336 km (25 statute miles) of a sampled grid center during the selected four-hour window. The archive uses 12 UTC HRRR initializations and an 18–22 UTC valid window. It is a neighborhood probability, not the probability of a direct hit at a house. Smaller-distance or shorter-window probabilities cannot be inferred from these outputs.

The viewer contains 12 development cases: the 15th of each month in 2024. The sampled domain spans 30–45°N and 100–75°W, with approximately 15 km spacing and 16,413 centers per case. The default filled contours use a linear display interpolation between nearby sampled centers. Dots mode shows the original centers without interpolation; Both combines the two. Map values below 0.1% are hidden but retained in the readout. Missing data and locations without a nearby sample remain unavailable, never zero.

The saved-location button selects the nearest grid center within 12 km. The dashed circle is centered on that grid sample and shows the forecast neighborhood. A peak button selects the highest available sample for the selected hazard. The map supports pan and zoom, separate light/dark basemap selection, opacity adjustment and a canvas fallback where WebGL is unavailable. States and lakes provide national context; local county, river and road detail uses the same assets as Model Maps at closer zooms.

## Evidence and limits

The research used 36 monthly cases across 2022–2024, totaling 590,868 grid samples. Model training used 2022; calibration used 2023; development evaluation used 2024. The 2025 final test remains untouched. The 2024 cases shown here therefore must not be represented as an independent final test.

There were only two tornado-positive development days, six wind-positive days and five hail-positive days. Wind and hail Brier point estimates were slightly better than the comparison systems, but every paired 95% confidence interval crossed zero. Tornado performance did not improve. These results do not establish reliable operational skill.

The page shows the archived benchmark scores, including the training-rate, seasonal/area-rate and calibrated updraft-helicity comparisons. Lower Brier scores are better. Additional independent cases, frozen evaluation, calibration checks and a reliable inference feed are needed before live probabilities should be offered.

## Provenance and reproduction

Source bundle: `OPE-severe-guidance-v0.2.zip`.

SHA-256: `973a746d04d9e28deebd52a01c2654da1b32b307a00f95551d7a5b3facc1f779`.

Run `python tools/export-severe-research.py /path/to/OPE-severe-guidance-v0.2.zip` from the repository root. The exporter verifies the prediction CSV against the model manifest, retains the calibrated `p_tornado`, `p_wind` and `p_hail` columns, and exports probabilities to eight significant digits and coordinates to six decimal degrees. It does not fit a model or derive probabilities from current environmental indices.

`assets/severe-research/index.json` records source hashes, per-file hashes, valid windows and benchmark results. `node tests/severe-research.test.js` verifies all exported case hashes and checks probability, missing-data, case-identity and geographic behavior.

State outlines derive from the US Census geometry distributed in `us-atlas@3.0.1/states-10m.json` (ISC). The viewer uses the repository's local MapLibre and font assets. The interface is inspired by [Nadocast](http://data.nadocast.com/viewer.html); this is an independent experimental model and implementation.

## Contour display

The probability bands follow the supplied Nadocast reference: 0.1%, 1%, 2%, 3%, 5%, 10%, 15%, 30%, 45% and 60%. They use neutral grays, greens, brown, yellow, red, magenta, purple and blue. These are experimental probability contours, not official SPC categorical outlooks. There are no significant-severe outputs or hatching.

The renderer triangulates nearby archived samples, rejects edges longer than 25 km and computes barycentric linear interpolation on a 0.06-degree display mesh. D3 constructs filled threshold polygons using linear contour interpolation. There is no spatial blur, probability inflation, extrapolation across large gaps or missing-as-zero substitution. Contours may extend at most half a display mesh cell around the supported raster boundary, clipped to the archive domain. Point readouts, maxima and the 25-mile neighborhood circle always use an original sampled location and probability.

Contour generation is shared by WebGL and canvas renderers. `node tests/severe-contours.test.js` checks the interpolation against a known linear field, missing-data masking, rejected geographic gaps and the actual archive. D3 array 3.2.4, contour 4.0.2 and delaunay 6.0.4 are pinned locally with their ISC licenses. Lakes use Natural Earth v5.1.2 110m data (public domain).

## Live Day 1 / Day 2 build

See [the daily-model specification](severe-daily.md). The user-facing goal is current model-based daily guidance. The existing archive model supports only one four-hour lead configuration; changing its display cannot turn it into a daily model. No live daily forecasts have been issued by this build.
