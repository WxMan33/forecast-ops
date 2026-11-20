# Weather threats: clickable preview (Phase 1)

**Status:** fixture-driven preview for layout review. Every product on the page is **fictional demo data**,
marked as such on screen. No live feeds are wired in, and nothing here is promoted to `main` or the live site.

Preview link (served from this branch through raw.githack.com; the first visit shows the host's "One more step" notice once):
`https://raw.githack.com/WxMan33/forecast-ops/claude/beautiful-hawking-tnr183/threats.html`

## What is on the page

- **Map first.** On desktop the map fills the screen next to a compact 380 px panel. On phone the panel becomes a bottom sheet that starts
  as a one-line bar ("Tornado Warning at TQL Stadium · until 4:15 PM EST"), opens with a tap and closes with Close or Esc.
- **Time:** `Active now | Day 1 | Day 2`, with actual valid times in the venue's zone plus SPC Z times.
- **National view:** a one-line venue status at the top, then "Most urgent now", where overlapping products are grouped by area and led by
  the most urgent one, then "Forecast for later" (the highest Day 1 and Day 2 categories).
- **Venue view:** a brief you could read across a room (headline, how long it has left, anything else that covers the venue), then
  "Covers the venue", "Nearby · does not cover the venue (within 15 mi)" and "Later at the venue".
- **Product detail:** the plain-English headline, hazard, area, issued/updated, valid or expiration time, venue relationship, issuing office,
  source and **Read the official bulletin**. "What changed" appears only when an earlier version of the same product exists. In the demo,
  only the warning has one.
- **Map click:** lists every product covering that spot.
- **Our research model (Day 1/2 only, off by default):** filled contours with their own legend, labelled experimental. SPC outlooks switch to
  outlines while it is on. Areas without guidance (outside the regional grid, and the existing display mask over water) are hatched.
  It uses the real research grid and mask, but the values are invented for the demo.

## How urgency reads without color

| Product | Map | List |
|---|---|---|
| Warning | solid, filled, thick edge with a contrasting outline; a marker at national zoom; drawn on top | `WARNING` badge, solid swatch |
| Watch | dashed edge, name repeated along the edge | `WATCH` |
| Mesoscale Discussion (MD) | dotted edge, name repeated along the edge | `MD` |
| SPC outlook | category fill in its own day view; thin outlines plus labels as context in Active now | `OUTLOOK`, category name and level "(3 of 5)" |

Ordering follows a fixed product order: warnings first, then watches, MDs and outlooks, with tornado before severe thunderstorm. There is no cross-product score.

## Demo controls (top bar)

- **Scenario:** Overlapping threats · Quiet day · Source unavailable (NWS alerts stale: the last copy stays on the map marked
  "unconfirmed"; SPC MDs never reached: the status is reported as unknown, not "none").
- **Venue:** Inside the warning (TQL Stadium) · Near the warning edge (NKU, 2 mi) · Outside the warning (Dayton, inside the watch).
  Only the venue moves.

URL state for review links: `?scenario=quiet|unavailable`, `?venue=edge|outside`, `?view=day1|day2`, `?scope=venue`, `?model=1`,
`?sel=<product id>`, `?sheet=open`.

## Reused from Forecast Ops

Shell, navigation, theme tokens and the light/dark toggle (`ops.js`, `ops.css`), MapLibre 4.7.1 with local Open Sans glyphs, the state and lake
outlines, plus the research grid, display mask and contour code from the Severe research viewer.
Venue records follow the Event Manager shape (`{name, city, lat, lon, tz}`). There is a link to the regional Severe viewer (`severe.html#severe-daily`).

## Files

`threats.html`, `assets/threats.js` (page), `assets/threats-core.js` (pure logic), `assets/threats-demo.js` (fixtures),
`assets/threats.css`, `tests/threats-core.test.js` (14 checks), `docs/threats/screens/`.
No existing page, navigation entry or workflow was changed.
