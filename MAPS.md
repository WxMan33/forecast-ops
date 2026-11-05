# Model map loading and coverage

The interactive viewer uses the existing native HRRR grid and MapLibre renderer. Point inspection always reads the packed original cell values. This update changes when data is downloaded, not the meteorological calculations, grid geometry or map domain.

## On-demand downloads

Opening a run downloads its manifest, coordinate array and selected weather field only. Selecting another field downloads that field once. Hourly/6-hour/24-hour precipitation uses `apcp_hour`; since-run-start uses `apcp_run`. These blocks are independent, from the same run, and retain the existing GRIB interval checks. An unavailable accumulation window stays unavailable.

Up to two recently used runs are cached in page memory. Their manifests, coordinates and successfully decoded fields are kept separate. Concurrent requests for the same block share one download. Failed field requests can be retried, and do not evict a working field. A late response from an earlier selection cannot replace the current selection. Loading pauses playback and hides the previous weather layer until a correctly labelled field is ready. A failed change restores the previous working run/field with an explanation.

The About section reports compressed data loaded for the selected run against its full published payload. This is the sum of successfully decoded blocks' manifest `gzipBytes`, not a network traffic meter: retries, basemap/library files and HTTP overhead are not included. NOAA GRIB download volume remains a separate pipeline measurement.

## Viewing area

Tri-State remains the fixed default extent. The closer preset is labelled Cincinnati area, with the previous zoom limit retained. No DMA outline is drawn. Road-number badges are omitted; city labels use native MapLibre symbol collision handling, variable anchors, population ranking and a lower count on phones. Stadiums are labelled only when selected or used as the venue view. These are display changes only; point inspection remains available everywhere inside the model grid.

Ohio Valley expansion is not enabled. The earlier benchmark indicated roughly 5.8 times the cells and 18.2 MB per full run when all fields load. On-demand loading removes that upfront requirement, but real-device playback and memory must be assessed before expanding the production area. This change does not expand collection or alter the data publishing workflow.

## Checks

- `node tests/maps-loader.test.js`: captured NOAA arrays, selected-field requests, independent precipitation blocks, shared downloads, retries, run isolation and cache eviction.
- `node tests/maps.test.js`: placement and original values against GRIB checkpoints, precipitation intervals, missing data and renderer geometry.
- `python tests/maps-browser.py` in GitHub Actions: renderer/browser integration, selected-field requests, an HTTP failure/retry, cached switching, valid-time matching and desktop/phone widths. Uses captured real NOAA data; not a physical phone frame-rate measurement.

The Almanac browser test separately checks the shared astronomy panel with the calendar outside it. Its ISS schedule is an immutable capture, rather than the rotating production schedule.

## Label fonts

MapLibre uses a locally hosted Open Sans Semibold Latin glyph block. City and venue labels stay above the weather and share collision placement; the canvas now draws only the selected grid-cell marker. Label candidates are reduced near controls and by screen-space spacing. Names are transliterated to the supported Latin block on the map; point-inspection text retains the original location name. No external tile or glyph service is called. Font provenance, checksum and license are in `assets/maps/fonts/open-sans-v1/README.md`.
