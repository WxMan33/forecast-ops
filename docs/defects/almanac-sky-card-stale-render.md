# Open defect: Almanac sky card briefly redraws the previous date

**Status:** open, reproducible, not fixed. The test assertions in `tests/climate-report-browser.py` are unchanged, and the test has not been relaxed.

## Where it fails
- Main `Tests` run 229 (commit bbbe9ad), job `dashboard-browser`, at `tests/climate-report-browser.py` line 75 (`assert '5:15' in page.locator('#skyCard').inner_text()`). The job passed in run 227, and the commit under test changed only verification code.
- Locally on main, with the same test, 1 of 3 and then 2 of 6 runs failed. Failures were at lines 75, 76 (`'< 1 min'`) and 85 (`'7:29'`).

## What the card showed
After a passing date-change wait, the card's visible text was sampled every 250 ms (2026-11-16, local reproduction, fixture ISS feed):

| Sample | Card shows |
|---|---|
| 0–1 | `Skywatch · Thu, Nov 5 … 5:15 AM EST` (the PREVIOUS date) |
| 2 | `Checking the selected date…` |
| 3–5 | `Skywatch · Sun, Nov 8 … 7:29 PM EST` (the selected date) |

The wait had already seen `Sun, Nov 8` before sample 0. So after the new date was drawn, the previous date's content was drawn again. The card then reloaded and settled on the selected date. In another run the first sample was `Checking the selected date…`, followed by the selected date.

## Hypothesis
`assets/skywatch.js` `load()` has a generation guard, so a second render path (or a second `load()` from the Almanac date handler in `assets/almanac.js`, around lines 98–107) may redraw older content. This has not been confirmed.

## Next step
Investigate as a separate fix, after the collector verification is complete. The fix must make the card show only the newest selected date. The existing assertions must pass without longer waits.
