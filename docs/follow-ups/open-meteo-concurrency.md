# Follow-up: Open-Meteo "Too many concurrent requests"

**Status:** open. Recorded separately from the verification dashboard work; nothing has been changed for it yet.

## Evidence (beta preview run 80, 2026-11-17)
- All 88 HTTP 429 answers stated the same reason: `Too many concurrent requests`, with no `Retry-After` and no rate-limit window.
- They arrived with 7 to 64 Open-Meteo requests in flight from the browser. The run's peak was 65.
- The per-minute budget was not exhausted: the lowest remaining value on successful answers was 371 of 600 units.
- Run 79 had 71 such 429s. The reason was not recorded then.

## What this rules out, and what it does not
- The per-minute unit budget and `Retry-After` handling do not address these refusals. The exact-request `Retry-After` wait (ops-data.js) never triggers for them because no `Retry-After` is sent.
- This is one run's evidence. It does not establish the provider's concurrency limit, or whether real users reach it. A single page such as Overview starts about 25 forecast and ensemble requests at once.

## Candidate next step (needs its own task)
A bounded cap on the app's concurrent Open-Meteo requests, measured with the recorder's peak-in-flight and 429-reason output. It changes page timing, so it needs the location-race, navigation-cache and source-failure checks and a before/after live comparison.
