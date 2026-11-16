# Fixed defect: Almanac sky card kept the previous date on screen after a date change

**Status:** fixed (see "Cause" and "Fix" below). The test assertions in `tests/climate-report-browser.py` are unchanged, and the test has not been relaxed. The original evidence is kept as recorded.

## Where it fails
- Main `Tests` run 229 (commit bbbe9ad), job `dashboard-browser`, at `tests/climate-report-browser.py` line 75 (`assert '5:15' in page.locator('#skyCard').inner_text()`). The job passed in run 227, and the commit under test changed only verification code.
- Main `Tests` run 231 (commit a283189), same job, at line 76 (`'< 1 min'`); line 75 passed in that run.
- Locally on main, with the same test, 1 of 3 and then 2 of 6 runs failed. Failures were at lines 75, 76 (`'< 1 min'`) and 85 (`'7:29'`).

## What the card showed
After a passing date-change wait, the card's visible text was sampled every 250 ms (2026-11-16, local reproduction, fixture ISS feed):

| Sample | Card shows |
|---|---|
| 0–1 | `Skywatch · Thu, Nov 5 … 5:15 AM EST` (the PREVIOUS date) |
| 2 | `Checking the selected date…` |
| 3–5 | `Skywatch · Sun, Nov 8 … 7:29 PM EST` (the selected date) |

The wait had already seen `Sun, Nov 8` before sample 0. So after the new date was drawn, the previous date's content was drawn again. The card then reloaded and settled on the selected date. In another run the first sample was `Checking the selected date…`, followed by the selected date.

## Hypothesis (original, before tracing)
`assets/skywatch.js` `load()` has a generation guard, so a second render path (or a second `load()` from the Almanac date handler in `assets/almanac.js`, around lines 98–107) may redraw older content. This has not been confirmed.

## Cause (traced 2026-11-16)
The hypothesis was wrong: the previous date was never redrawn. Every draw of the card was logged with its call stack (an `innerHTML` setter wrapper on `#skyCard`). All draws came from one path, `almanac.js render()` → `skywatch.load(sel)` → `skywatch render(date)`, and always for the newest selected date. The generation guard in `load()` and the `run` guard in `render()` both held.

The defect was the time between a date change and the start of `load()`:
1. `render()` awaits the time-zone lookup and the climate-station lookup before it calls `skywatch.load()`. Only `load()` cleared the card.
2. Until then, the previous date's finished card stayed on screen, with its heading and working calendar buttons. Its "Next several days" list names the next dates; the Nov 5 card lists "Sun, Nov 8".
3. The test's wait (`#skyCard` text includes "Sun, Nov 8") could therefore pass on the old card. The card then changed to "Checking the selected date…" and the next assertion (`'7:29'`) read that. The same applies to lines 75–76 after the Nov 3 → Nov 5 change.
4. The sampled "Nov 5 → Checking → Nov 8" sequence above shows exactly this: the old card, which already listed Nov 8, then the loading state, then the new card.

For a user, a date heading on screen did not mean that date's passes were ready. A calendar button from the previous date could still download that date's pass after the date changed.

Measured on the old code, in the same task as the change to Nov 8, the card read heading `Skywatch · Thu, Nov 5` with 1 calendar button, and its text included "Sun, Nov 8".

## Fix
- `skywatch.loading(date)` puts the card in an explicit loading state: `data-state="loading"`, `data-date`, `aria-busy="true"`, no heading and no buttons. It also discards any response still in flight.
- `almanac.js render()` calls it synchronously, before any await, so the previous card is gone in the same task as the date change.
- A finished card is `data-state="ready"` with its `data-date`. A load failure is `data-state="error"`.
- A calendar button acts only while its own date is the card's ready date.
- No waits were lengthened.

## Checks
`tests/skywatch-race-browser.py` (deterministic; NASA-feed responses are held by the test and released in a chosen order; no sleeps):
- Loading state in the same task as the date change.
- A delayed response for the old date, released after the new date is ready, never changes the card.
- Rapid A→B→A changes, with the held responses released in both orders, settle on A, and B is never drawn as ready.
- A calendar button kept from the previous card downloads nothing after the date changes.
- The settled card downloads the selected date's pass (`DTSTART:20261105T101500Z`).

The new test fails on the old code (at the first loading-state check). It passed 3 of 3 runs with the fix.
