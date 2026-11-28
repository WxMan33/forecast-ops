# CONUS RRFS predictor collection for Day 2 wind (Step A, approved 2026-11-25)

Research collection only. **No model is fitted**: Step B (the three-arm comparison) and every feed change stay on hold
for review. Nothing here changes the regional collector, its 15:30 UTC milestone, the live v0.7 feed, the CONUS
preview, or the HRRR prospective archive records.

## What is collected each day
Starting with issue date **2026-11-26**, after the daily feed's 12Z HRRR run:
- **Cycles:** the operational RRFS (`noaa-rrfs-ops-pds`, `2dfld.3km.conus`) **06Z and 12Z** runs of the issue date.
- **Window:** the full Day 2 window, 12Z D+1 to 12Z D+2.
  - 12Z: forecast hours f24–f48.
  - 06Z: f30–f54. The 06Z RRFS runs to f84, so unlike HRRR it covers the whole window.
- **Fields:**

  | Name | Record |
  |---|---|
  | gust | `GUST:surface` |
  | refc | `REFC:entire atmosphere (considered as a single layer)` (RRFS's label; HRRR's differs) |
  | uh25 | `MXUPHL:5000-2000 m` |
  | uh03 | `MXUPHL:3000-0 m` |
  | maxuvv | `MAXUVV:100-1000 mb` |
  | wind10max | `WIND:10 m` 1 h max |
  | cape_sfc | `CAPE:surface` |
  | srh01 | `HLCY:1000-0 m` |
  | shear06 | `VUCSH:0-6000 m` |

  1 h maxima are paired with valid hour H through step H+1, as in the HRRR extractor. Every message's initialization,
  valid time and step type are checked.
- **Mapping:** each CONUS research sample uses its own native RRFS cell (the grid matches HRRR's) and the existing
  25-mile neighborhood rule. Stored per cycle and field, at the 38,838 supported samples (float16):
  - the 24 h maximum of the neighborhood max;
  - the first-18 h maximum of the neighborhood max (to mirror the HRRR lag window);
  - the 24 h point mean.
- **Storage:** the arrays go to the private archive (release `severe-conus-rrfs-YYYY-MM`). They are never overwritten
  and are verified by download. The JSON manifest (`collection/<date>.json`) is committed here with the data checksum,
  per-cycle status and the generating run.

## Cutoff and missing inputs
- Each cycle is judged **separately**. Every needed GRIB and index object must be listed on S3 by **15:10 UTC** on
  the issue date.
- A missing, late or failed cycle is recorded with its reason (`missing`, `listed_after_cutoff`, `failed`) and the
  other cycle is still saved.
- If RRFS is unavailable entirely, the HRRR forecast, the preview refresh and the prospective archive record still
  complete. The RRFS job is independent of them.

## Coverage tally (separate from the regional milestone)
`collection/tally.json` counts, on the CONUS grid at the 15:10 UTC cutoff:
- days with **both cycles ok and archived**;
- 06Z ok and 12Z ok separately;
- every missing day with its reason.

The regional collector's 60/20 milestone (15:30 UTC, regional grid) is counted separately and is unaffected.

## Reference
The real-data check on 2026-11-24 (not archived; before the start date):
- both cycles complete, 216 messages each;
- 12Z listed by 14:48:50 UTC;
- 1.7 MB per day, about 4.5 min.

RRFS 2–5 km updraft helicity peaked at 214 (12Z) and 422 (06Z) m²/s², which supports the Phase 1 caution about
source-specific magnitudes.
