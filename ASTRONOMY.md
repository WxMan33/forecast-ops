# Almanac astronomy

Astronomy is first, beneath the shared date picker. Sun/moon, Cincinnati ISS sightings and reviewed sky highlights follow that date. The Notes UI is removed; existing browser notes are left untouched.

## ISS source and refresh

NASA now links its city viewer from https://www.nasa.gov/spot-the-station/. The city index at `https://iss-sts.hqmce.nasa.gov/sts-config/cities.json` identifies Cincinnati as `United_States-Ohio-Cincinnati.html`. The old spotthestation RSS endpoint returned 404 during implementation.

`tools/refresh-astronomy.js` retrieves NASA's Cincinnati city table and strictly parses dates, rounded durations, peak heights and appearance/disappearance directions. It does not calculate orbits or independently determine sunlight/visibility. Source HTML is captured in the test fixtures. NASA's date strings omit the year: the parser selects the nearest year within 45 days, verifies the weekday and rejects ambiguous/nonexistent daylight-saving wall times. This inference is recorded in the feed. NASA's listed local times become America/New_York instants.

The public `Refresh Cincinnati astronomy` workflow refreshes `feeds/iss-cincinnati.json` every six hours. A failed request or format change does not overwrite the last good file. `retrievedAt` means when the table was fetched; a provider Last-Modified header is kept separately when supplied. The source hash records the precise HTML parsed. The initial feed uses the actual captured file's retrieval timestamp.

The site reads the raw repository feed because pushes made by GITHUB_TOKEN do not trigger ordinary Pages deployments. A same-origin copy is a fallback. Entries older than 72 hours are unavailable. Dates beyond the first/last listed date are outside the saved schedule, not “no pass.” Within the listed range, a day with zero entries is described specifically as having no opportunity listed in that NASA table. This is not a historical ISS archive.

Calendar downloads use UTC instants with a 15-minute display alarm. The calendar block uses NASA's rounded duration; it is not an exact predicted disappearance time. Past opportunities cannot create a calendar reminder through the panel. Calendar delivery depends on the importing app; the site itself does not send background push alerts. NASA's official app is linked for its own alerts. Clouds, trees and horizon obstructions can prevent viewing even when NASA lists an opportunity.

## Other highlights

`assets/sky-events.json` is a short reviewed catalog, currently for November 2026, sourced to NASA's monthly skywatching guide and the International Meteor Organization's 2026 calendar. It includes meteor viewing windows, a planet pairing and a full supermoon. It does not copy Tony Rice's posts. Entries are selected for northern midlatitude viewing near Cincinnati; occultations/eclipses need local circumstances checked before inclusion. Empty reviewed dates and dates outside the reviewed catalog are distinguished. Add reviewed entries with sources and explicit date ranges; do not roll annual events into another year automatically.

## Weather-number badges

Every complete card with a usable rank now gets a standing badge. The existing ranking method and strong threshold remain: top 10 **and** top 10% of usable years, with at least seven elapsed days. Top-third standings use lighter emphasis; early and typical standings have quiet badges. Incomplete or unranked periods do not get invented standings. The four cards no longer repeat the rank both in a badge and in the coverage line.
