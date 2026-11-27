# Threats radar: measured MRMS reflectivity in Predictable's style

Branch `claude/threats-radar-style`. Not on shared beta or main.

## What it matches

Predictable (heads-up a6a83c1) draws MRMS with:
- `lib/mrms.ts`;
- `lib/mrmsComposite/{source,indexedPng,render}.ts`;
- `lib/level3/colorTable.ts`.

| | Predictable | Forecast Ops (this branch) |
|---|---|---|
| Source | IEM `lcref` (MRMS lowest-elevation composite reflectivity): `lcref.json` (scan time, product, units), `lcref.png` (indexed, the pixel values are the measurements), `lcref.wld` | the same three files, read by the browser (IEM sends `Access-Control-Allow-Origin: *`) |
| Values | dBZ = index × 0.5 − 32 | same |
| Colours | Reflectivity 2026, 14 bands from 5 to 70 dBZ, each with its own transparency; below 5 dBZ transparent; the source's own tRNS respected | same table (`assets/threats-radar.js` `STOPS`) |
| Sampling | nearest neighbour into 256 px web-mercator tiles | same; MapLibre `raster-resampling: nearest` |
| Opacity | 85% default | 85% |
| Refresh | scan time every 60 s; image only for a new scan; scan time re-read after download so a turnover is never mislabelled | same |
| Where it runs | Node server: decode in a worker thread, tiles over HTTP | the browser: decode and tiles in a Web Worker, tiles through a MapLibre `lcref://` protocol |

The previous Forecast Ops radar (NOAA's pre-coloured MRMS base-reflectivity tiles at 60%) is kept only as a fallback when IEM can't be read. The source row and the legend say which one is shown.

## Checked against Predictable's own code

On a real scan (2026-11-26 19:36Z), `assets/threats-radar.js` was run alongside Predictable's `decodeIndexedPng`, `mrmsPalette` and `renderMrmsTile`, taken from a6a83c1 and run under Node. Predictable's PNG encoder was replaced by a pass-through of the RGBA it would encode.
- **Grid:** 7000 × 3500; 0 index differences; tRNS identical.
- **Palette:** the 256-entry lookup is identical.
- **dBZ probes:** −10, 4.5, 5, 9.5, 10, 17, 20, 29.5, 30, 37, 45, 52, 58, 62, 66, 70 and 75 give the same RGBA.
- **Tiles around CVG** (z5/8/12, z6/17/24, z7/34/48, z8/68/97, z9/137/195): 0 differing bytes.

`tools/threats-radar-check.js` also compares a tile drawn in the browser with the reference renderer on the same scan.

## Cost

There is no new server, and no request to our `/api`.
- **Per viewer with radar on:** `lcref.json` (about 130 bytes) every 60 s, plus `lcref.png` (about 1.2 MB) and `lcref.wld` (36 bytes) once per new scan. IEM updates about every 2 minutes.
- **Tiles:** drawn locally, so there are no tile requests. The old fallback made one NOAA export request per tile per image.
- **Phone, 4× slower CPU:** about 100 ms to decode a scan and single-digit milliseconds per tile; see the check's results.
