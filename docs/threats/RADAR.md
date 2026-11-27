# Threats radar: MRMS precipitation type and reflectivity

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
| Opacity | 85% default | 70% to start; slider under Layers → Radar (20–100%), remembered in the browser |
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

## Precipitation type (the default mode)

Layers → Radar → **Show: Precipitation type | Reflectivity**. The choice is remembered in the browser, and the opacity slider applies to both modes.

| | |
|---|---|
| Source | NOAA MRMS **PrecipFlag**: `https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag.latest.grib2.gz`. GRIB2, NCEP centre 161, discipline 209, category 6, parameter 0. 7000 × 3500 at 0.01°, the same grid as lcref. PNG packing (template 5.41), 8-bit, value = byte − 3. |
| Browser access | NOAA sends no `Access-Control-Allow-Origin`, so browsers can't read it directly (checked). The page reads it through `functions/api/mrms`: `GET /api/mrms/precipflag/time` (about 100 bytes) every 60 s, and `GET /api/mrms/precipflag/latest` (about 230 KB) only for a new scan. The forwarder checks the file is PrecipFlag on that grid before serving it and sends our User-Agent. Failures return 502 and are never cached. |
| Sharing | Requests in one worker that arrive during a read join it. The workers in one Cloudflare data centre share a Cache API copy. Each worker's copy expires at 60 s plus its own random 0–15 s, so the first refresh is stored before the others look. Data centres don't share with each other, so NOAA sees at most about one read a minute from each data centre that has viewers. Measured at ORD on 2026-11-27: 5 NOAA reads in 5.5 minutes; 4 bursts of 30 simultaneous requests at expiry, 1 read each. Before the stagger: 3 reads at every expiry. |
| Cadence | A new scan about every 2 minutes; the file appears 2–3 minutes after its scan time. |
| Codes drawn | NOAA's documented codes only: 1 warm stratiform rain, 10 cool stratiform rain, 6 convective rain, 7 rain with hail, 3 snow, 91 tropical/stratiform rain mix, 96 tropical/convective rain mix. Each has its own colour (ours). |
| No precipitation | 0 is transparent. |
| No coverage | −3 is drawn as grey stripes, so outside radar coverage never looks dry: light grey on the dark basemap, dark grey on the light one. |
| Unknown codes | Any other code is drawn as a dark-and-light checker, and the legend adds "Code not in NOAA's table (n)". It can't pass for no precipitation or a category. The codes are counted in `ptypeStats.unknown`. |
| Not in the product | Sleet and freezing rain. The legend says so. |
| Rendering | Decoded in a Web Worker; nearest-neighbour into 256 px tiles through a `ptype://` protocol; the same `radar` layer, so the layer order is unchanged. |
| Fallback | A scan over 15 minutes old, or the forwarder failing, switches to the reflectivity layer. The map credit, the legend (Reflectivity 2026 with its scan time), the source row and the Layers note all say "Precipitation type unavailable · showing reflectivity" and give the reflectivity scan time. The legend also gives the last precipitation-type scan. |
| Recovery | Precipitation type is retried every minute. When a fresh scan arrives the map switches back without a reload, keeping the saved opacity. |

The colour shows type, not intensity; Reflectivity shows intensity.

`tools/threats-ptype-check.js` checks all of this on a hosted page:
- live, on desktop;
- 360 and 390 px phones at 4× slower CPU on a throttled network;
- both fallbacks;
- a TEST REPLAY rain-to-snow transition at CVG in both modes, read pixel by pixel from tiles the page drew.

`tools/precipflag-grib.js` builds PrecipFlag files for the tests and the replay.
