# Forecast Ops betas

Two previews built from the same code on the `beta-previews` branch. They are separate from the live site
(GitHub Pages serves `main` only) and open without an account, calendar connection or GitHub sign-in.

| Beta | Preview link |
|---|---|
| Meteorologist (tool menu) | https://raw.githack.com/WxMan33/forecast-ops/beta-previews/meteorologist-beta.html |
| Event manager | https://raw.githack.com/WxMan33/forecast-ops/beta-previews/event-beta.html |

The links serve the branch's files directly from GitHub through raw.githack.com (a free static file CDN for
public repositories). They update a few minutes after each push. **On the first visit, raw.githack.com shows its
own "One more step" notice; click "Open the page" once.** The notice is the host's, not ours, and it is
remembered for that browser, so the second beta opens directly.

For links without that notice, give the previews their own GitHub Pages site: create an empty public repository
(for example `WxMan33/forecast-ops-beta`) with Settings → Pages → Source: GitHub Actions, and add a workflow
there that checks out `WxMan33/forecast-ops@beta-previews` and deploys it. The links would then be
`https://wxman33.github.io/forecast-ops-beta/meteorologist-beta.html` and `…/event-beta.html`. The `Beta preview check` workflow opens both
links on desktop and phone from a fresh, signed-out browser on every push and refreshes the screenshots in
[`screens/`](screens/).

## Meteorologist beta: a tool menu

The meteorologist beta opens on a menu in the existing Forecast Ops style (same header, navigation, theme and
tool cards). City search and Copy link sit at the top, with CVG as the default. Model Blend is the lead card
("Daily and hourly forecasts, adjustable model weights and official NWS highs and lows"), with Weights and Runs
as shortcuts; Thunder, Severe & Soundings, Winter, Almanac and Model Maps (in development) follow. Every tool
opens for the selected city, and MENU in the shared navigation returns to the menu with it.

## Two location values: forecast point and climate station

The forecast point (the selected city or venue) drives forecasts, the NWS point forecast, alerts, the event
briefing and astronomy. The climate station drives Almanac observations, normals and records and Model Blend's
record-watch flags. It is the nearest official NWS daily climate reporting site (one NWS issues a CLI report for)
served by the same NWS office as the point, with usable recent observations and normals in RCC-ACIS; a site with a
threaded city record (for example IND, DEN) is preferred within 50 km. Examples verified live: CVG → CVG (CVGthr),
Indianapolis and Carmel → IND (INDthr), Muncie → MIE (station record; no threaded record), Terre Haute → HUF,
Lafayette → LAF, Charleston WV → CRW (CRWthr), Denver → DEN (DENthr). The Almanac shows the station name and ID and
lets you pick another verified station without moving the forecast point.

## Any U.S. market

- City search on both betas (the site's own place search; results shown as "City, ST"). The meteorologist beta
  opens on CVG; **Copy link** gives a link that opens the selected city (or, on the event beta, the event).
- The selected point drives the blend, hourly timeline, signals, active NWS alerts, the official NWS point
  forecast (grid and serving office resolved from the coordinates) and links into the full tools.
- Times follow the selected location's time zone; event phases follow the venue's clock wherever the planner is,
  including events that cross midnight. The event editor takes a venue name, a city and optional coordinates.
- Inside the Cincinnati DMA the Cincinnati-tuned blend applies; elsewhere the default recipe is used and labelled
  unverified for that market, with contributing and missing sources listed.
- The HRRR map (in development) covers the Cincinnati Tri-State only; elsewhere it is replaced by a short note.
- Usage analytics: see `tools/analytics/README.md` (off until a collector URL is configured).

## Calendar import (read-only; sample data on this link)

In **Upcoming events**, **Import from calendar** walks through: choose a calendar → tick the events to import → each
event at a saved venue gets that venue's setup, gates and teardown times; an unfamiliar location can be matched to a
saved venue right there or left as **Venue needs confirmation** (no briefing until a venue is chosen with Edit).
Importing again updates events in place: the calendar's name and start/end win, a confirmed venue and the
planner's own times are kept (an override keeps its offset from the start). All-day items are skipped.

- **Live Google Calendar import:** https://forecast-ops-beta.pages.dev/event-beta.html#upcoming (Cloudflare Pages,
  `beta-previews` branch). OAuth client ID set in `assets/beta-config.js`, authorized for that exact origin only;
  testers must be listed under Google Auth Platform → Audience → Test users while the app is in testing.
- **Venue matching:** a calendar location is matched automatically when it fits exactly one saved or built-in
  venue (Paycor Stadium, TQL Stadium, Great American Ball Park) by name, street address or a known alias. The
  import list shows the match with **Change**. It only asks when the location is blank, unknown or fits more than one
  venue. A location matched by hand (in the import list or later with Edit) is remembered as an alias of that venue,
  so the next import of that location matches automatically. If the calendar later changes an event's location, the
  new location is matched again rather than keeping the old venue.
- **Venue search (like OPE's location setup), reviewed before anything is sent:** saved venues and remembered
  calendar locations match automatically, with no lookup. An unfamiliar location is shown in an editable box; nothing
  leaves the browser until the planner checks the text (removing anything private, such as a home address or
  directions) and presses **Search**. Calendar locations are never looked up automatically and there is no
  as-you-type search. A search with one clear place (results within ~1.5 km are one place) selects it automatically
  with its name, address and **Change**; several places are listed with their addresses; a city, county or bare
  street only leaves the venue unconfirmed, with **Search again**, **Drop a pin** (OpenStreetMap map) or a saved
  venue. A found or chosen place becomes a saved venue at its exact point and is remembered for that calendar
  location, so a re-import neither asks nor sends a lookup. Add Event, Edit Event and Add Venue use the same search;
  city search stays in the forecast tools.
- **Search provider:** on the Cloudflare beta (`forecast-ops-beta.pages.dev`), **LocationIQ** once its token is set in
  `assets/beta-config.js` (`BETA_GEOCODER.locationiq`): a token dedicated to this beta, restricted by HTTP referrer to
  that host. Results carry "Search by LocationIQ.com". Confirmed venues and their coordinates are saved as the
  planner's records; cached search responses expire after 48 hours (free-plan terms, 5,000 requests a day). Everywhere
  else, including the Githack demo, the reviewed public OpenStreetMap search is used and the token is never sent. If a
  lookup fails, saved venues and Drop a pin still work.
- **Times:** the calendar's original start/end instants are kept with each imported event; venue-local times are
  always computed from them in the venue's time zone (or the calendar's, until a venue is known). Re-importing an
  event imported by an earlier build corrects its times.
- **On the Githack preview link only the sample calendar is offered** (synthetic demo data). Google sign-in is off here and
  is only enabled when `BETA_CALENDAR.clientId` is set and the page is served from an origin listed in
  `BETA_CALENDAR.origins` (never raw.githack.com).
- **Live Google Calendar** (on the dedicated beta origin): Google Identity Services token client, scopes
  `calendar.calendarlist.readonly` and `calendar.events.readonly` only; the access token stays in memory for the
  tab; requests ask Google for just the fields used (id, summary, location, start, end, status, etag).
- **Stored:** only the events the planner imports (in this browser). Not the calendar list, unselected events or the
  token. **Analytics:** `calendar_import_opened`, `calendar_import_started` (provider: sample/google) and
  `calendar_events_imported` (provider and count) only; no calendar names, event details or tokens.

## Upcoming events and saved venues

The briefing stays the main screen; **Upcoming events** (link at the top, or `event-beta.html#upcoming`) lists every saved event:

- One row per event: name, venue, local time at the venue (plus your own time when it differs) and one status: **Weather concern**, **Briefing ready**, **Briefing partly ready**, **Waiting for guidance** or **Venue needs confirmation** (calendar imports without a recognised venue). Events that need a weather decision come first, then the rest by start time; past events fold away.
- Tap an event to open its briefing (`?ev=<id>`, so a refresh keeps it). Add, edit and remove from the list.
- **Saved venues:** name, coordinates, time zone and default offsets (setup before the start, gates before the start, teardown after the end) plus the tent gust limit. New events at a venue start from its defaults; a time changed for one event is kept as that event's override ("Gates set for this event") and can be reset to the defaults.
- Everything is stored in this browser (`beta_events_v2`, `beta_venues_v1`). The records carry a `source` (`manual` now; `calendar` with calendar and event IDs later), and `EventStore.fromCalendar` already maps a Google Calendar event onto the same record, matching its location to a saved venue.
- **Events of any length.** An event has a start date and an end date ("Starts on" / "Ends on"), so overnight and multi-day events keep their real end. Setup and gates count back from the start and teardown forward from the end, in real elapsed time: across a clock change "4 h before" is still 4 hours. A calendar event keeps the calendar's own start and end instants (`source.start/end`); its venue-local dates and times are always worked out from them, at import, venue confirmation, re-import and in the editor. A time that happens twice on a fall-back night is recorded with which occurrence it is (`fold`), so the briefing covers the real hours.
- **Backup.** *Export backup* saves a versioned JSON file (`forecast-ops-event-backup`, version 1) with the saved events (per-event times and overrides, venue confirmation, calendar IDs and instants) and saved venues (default schedules and remembered calendar locations). Each record is rebuilt field by field, so sign-in tokens, API keys, analytics IDs and cached lookups are never included. *Restore backup* checks the whole file before writing anything (a damaged or foreign file is refused with the reasons), then shows what it would do: new records are added, identical ones skipped, and records that differ from what's saved here are kept as saved here unless the planner ticks "Replace … with the backup's version". Remembered calendar locations from both are kept either way. If the browser refuses to save (private browsing, storage full), the restore stops and nothing changes.
- The calendar reminder on a pending or partly covered briefing reads "Add a calendar reminder" and says it is set for the estimated time the full briefing will be ready. It is counted as `reminder_exported` (a link click or .ics download; the beta can't tell whether it was saved).

## Event briefing: simple outdoor-event planning

- **Leads with the decision and its timing**, then four facts: when, rain chance, lightning potential, next check. Then one card per part of the event (setup, gates, event, teardown), the NWS forecast, what could change the plan, when to check again, the map, and one hour-by-hour grid. The chart view, the ensemble share, source ages and how the briefing is built sit under Details.
- **Rain chance is site-specific:** the model-blended hourly chance of rain at the venue's exact coordinates (the same hourly values the grid shows). Each card shows *Peak hourly rain chance* — the highest single hour among the hours that part of the event overlaps — never a chance of rain sometime during the whole part. A small but real chance reads *<5%*, never 0%.
- **Why the numbers can differ:** the rating (watch / plan for it / likely disruptive) weighs all the guidance for each part, including the ensemble share and how much rain falls, so a part can be rated *plan for it* with a modest hourly chance. Details explains the distinction. The hourly signal row highlights actual hourly signals; a phase-wide plan is kept in the phase card rather than repeated as a dagger in every hour. The ensemble share is under Details, labelled as a different measure.
- **Lightning potential:** Low / Moderate / High from the Thunder page's tiers, thresholds unchanged (LOW → Low, MARGINAL or ELEVATED → Moderate, HIGH → High). Low says it isn't zero. Hours without thunder guidance read *Unavailable* (or *Limited guidance* when only some hours have it), never Low. NWS thunderstorm wording during the event is shown, with one line when it differs from the model signal. It is a forecast planning signal, not detected lightning or permission to resume.
- **Schedule presets:** a saved venue keeps its standard (outdoor event) schedule and can add named presets such as Practice or Match day (setup, gates — or none — and teardown). An event picks one; changing a time for one event is that event's override and never changes the saved preset (*Update the saved preset* is a separate, explicit choice; *Save these times as a new preset* adds one). Nothing is inferred from an event's name. Presets and each event's preset travel in backups and survive calendar re-imports.
- **Print / PDF:** a print-only layout on US Letter. Page 1: event, site and coordinates, time and time zone, issue time, the decision, rain chance, lightning, a phase table, the NWS forecast and the next checks. Page 2: a compact hourly table (up to 24 hours; longer events say which hours are included) and essentials, attribution and limitations. No controls, map, collapsed diagnostics or duplicate charts; table text stays 9 pt or larger. Single-day and three-day fixture events print on two pages. Event hours and the full planning window have separate date ranges; missing model sources are named on page 1, and both pages carry issue dates and page numbers. Dark-mode printouts use white paper.
- Visual checks: `node tools/event-briefing-polish-check.js` renders the full briefing with synthetic data, checks phone/desktop in both themes, and verifies two-page single-day and long-event PDFs. The saved visual proofs are in `docs/beta/screens/event-polish-*`.
- Checks: `tests/hourly-model.test.js` (phase peaks from the grid's hours, overnight phases, missing thunder, <5%), `tests/event-presets.test.js`, and signed-out section 17 (card = grid = printout, lightning wording, a real two-page PDF, a three-day printout, the preset flow).

## Hourly forecast (shared grid)

One hour-by-hour grid, used by Model Blend and the Event Manager briefing (`assets/hourly-grid.js` draws it, `assets/hourly-model.js` supplies the data, `assets/hourly-views.js` arranges each page's rows). It adds no calculation, weight or threshold.

- **Values per hour** are the blend's own `windowRow` over that hour (same recipe and weights as the daily table and the briefing): local date and time, temperature, feels like, hourly precipitation chance, hourly precipitation amount, sustained wind and gusts. Sustained wind is the same weighted combination as gusts (a new field on the aggregate; nothing else reads it).
- **Two different probabilities, two rows.** *Precip chance (hourly PoP)* is the models' own hourly probability of precipitation, blended. *Ensemble ≥0.01″* is the weighted share of ensemble members with measurable precipitation in that hour. Neither is relabelled as the other.
- **Model Blend:** next 24, 48 or 72 hours, or a custom start and end (in the forecast point's time). Tapping an hour lists the sources that contributed, their values and weight shares, ensemble member counts and the NWS grid value for comparison. Earlier hours in a custom window are marked as guidance, not observations.
- **Event Manager:** setup through teardown, with the phases on the first row (a 7:30 gates time fills the second half of the 7 PM hour). Concerns come from the briefing engine: a hazard's hourly rule marks the hour, and its colour is the level the briefing gives that phase (yellow *Watch*, orange *Plan for it*, red *Likely disruptive*); lightning uses the Thunder page's tier for the hour. A flagged hour in a phase the engine rates low stays unshaded and says *Low*. Overlapping hazards each get their own row, and the summary row counts them. Every coloured cell also carries text and an icon.
- **Missing is never clear.** Hours beyond the guidance or without any source read *n/a* (hatched); hours with values but no thunder guidance read *None\**. Selecting an hour moves the briefing's shared time, so the timeline and map follow, and the timeline and map move the grid.
- Midnight starts a new date column; on a fall-back night both 1 AM hours appear (labelled EDT and EST); the skipped spring-forward hour does not.
- Phones: the hours scroll sideways inside the grid while the row labels stay put. Light and dark themes use the site's existing colour tokens.
- The cell vocabulary (state + tier + text + icon) is presentation only, so other threat displays could share its look later; it does not read or represent any other engine.
- Checks: `tests/hourly-model.test.js` (deterministic synthetic guidance: ordinary, overnight, multi-day, DST, overlapping, missing data), `tools/hourly-grid-check.js` (the same cases in a browser via `tests/fixtures/hourly/harness.html`, desktop and phone, both themes), and section 16 of the signed-out check on the live pages.

## Event briefing before there is a forecast

An event weeks out (for example one imported from a calendar later) gets a useful screen from day one:

- **Pending:** the event, venue and schedule strip, then "Weather briefing pending": hourly guidance doesn't reach the event yet, with the dates it should start covering setup and cover the whole event. Phase cards, the hourly chart, the map and "what could change the plan" stay collapsed until they have event-time data.
- **Partly covered:** the briefing shows what the guidance reaches, phase by phase (e.g. "Setup and gates covered · the event and teardown pending"); pending phases show when they come into range. "No phase reaches a planning threshold" only appears once every phase is covered.
- **Reminder:** "Add a calendar reminder" adds a reminder to the planner's own calendar (Google Calendar link or an .ics file for Apple/Outlook) at the time the guidance should reach the end of teardown, with a link back to the event. Nothing is stored on a server.
- Dates come from how far the loaded guidance actually reaches (about 6–7 days here), so they move with the data rather than a fixed rule.

## Design direction (pass 2)

The organizing idea is the weather itself: how it moves across the map and when it reaches a place.

- One selected time drives the map and the timeline (click the timeline, step or play the map). The map
  toolbar (layer, run, step/play, valid time) and the valid-time treatment ("Wed 8 PM EST · in 2 days") are
  shared components meant to carry into OPE Lightning Ops.
- When the selected time is outside the HRRR run, a note beside the map says so instead of quietly showing
  another hour.
- Typography: Archivo for text and numbers, medium-weight headings, Archivo Black for one moment per page (the
  event decision). Strong colour only for a real weather concern, the selected time and active controls.
- Meteorologist: a workspace. Compact context bar and tool rail (Models, Weights, Runs, Soundings, Thunder,
  Winter, Full map); map beside timeline; signals strongest first ("Rain onset differs by 3 hours").
  Phone: Map | Timeline switch.
- Event manager: decision first ("Plan for rain late in the event."), then likely window, timing and next
  check; the schedule strip (Setup → Gates → Event → Teardown) is the graphic, with the affected window and
  the possible-start range across sources marked.

## What both betas share

- One visual identity (`assets/beta.css`): larger forecast numbers, Archivo typography, explicit valid times
  (weekday, clock time, zone, "in 5 h"), rules and whitespace instead of a card per item.
- One weather story (`assets/beta-story.js`): the Model Blend data request and recipe, `C.blend.windowRow`
  aggregation, `Core.event` phase windows, `ModelTrends.timing` precipitation windows and the Thunder signal.
  The betas add selection and wording, not forecast methods.
- The existing HRRR map, embedded (`maps.html?embed=1`).
- No private verification records: none are in this public repository, the betas do not link to
  verification, and on the preview host the workspace footer omits its verification links.

## First feedback round: one task each

Keep typography and colours as they are for this round. Give each colleague one task and note where they hesitate.

- **Meteorologist:** "Find the hour when the guidance starts to diverge." (Signals, timeline and map are on one
  selected time; the strongest signal is listed first.)
- **Event manager:** "Save a venue, add two events there, then change the gates time for just one of them."
  Open **Upcoming events** at the top of the briefing. Ask where they hesitated: choosing or saving the venue,
  seeing that the second event picked up the venue's setup, gates and teardown times, changing one event's gates
  without touching the venue, or finding each event again in the list. This is the same workflow planners will
  use after importing events from Google Calendar.

## Automated checks before sharing

The `Beta preview check` workflow opens the public preview links signed out and fails if any of these break:
- Meteorologist desktop: clicking an hour, stepping the map and playing it back keep the page, chart and map on
  the same valid time.
- Event phone: the decision sentence and likely window / timing / next check fit on the first screen; the phase
  strip fits the width; precipitation chances are in 5-point steps.
- Out-of-range event (six days out): the map shows the HRRR run that reaches furthest, flags "Last HRRR hour ·
  not the selected time" on the map, and says when coverage ends.

## Feedback checklist: meteorologists

1. Does the first screen tell you the next 48 hours at a glance? Are the numbers large enough, and are the
   periods (rest of today, tonight, tomorrow…) the right ones?
2. Are valid times and the time zone always clear (period spans, timeline, map valid time)?
3. Does "Model disagreement" match your own read of the guidance for temperature, precipitation and timing?
   Are the agree / some / split cut-offs sensible?
4. Is "Guidance age" useful? Which sources should it list, and is "late" flagged correctly?
5. Is the timeline readable (temperature with guidance range, precipitation and chance, gusts, thunder)?
   Does tap/hover give the values you want?
6. Is the map large enough to use comfortably, with a useful default field and view?
7. Are weights, individual guidance, soundings and run comparisons one click away? What is missing?
8. Anything that would make you distrust the page (wrong values, stale data, confusing wording)?

## Feedback checklist: event managers (try it on your phone)

1. Without reading the details, can you say what the biggest weather concern is, when it matters and how
   sure the timing is?
2. Are setup, gates, event and teardown broken out the way you plan? Are the status words (No concern, Watch,
   Plan for it, Likely disruptive) clear?
3. Is "What could change the plan" useful, or too vague? What would you want instead?
4. Would you actually check again at the times suggested?
5. Edit the sample to one of your events (Edit event). Was that easy on a phone? Which fields are missing
   (venue list, thresholds such as tent wind limits, multiple days)?
6. Is the map and supporting detail useful below the briefing, or is it noise?
7. Would you share or print this briefing as is? What would you change first?
8. Is any wording too technical?

### Event variable charts

The event briefing leads with four separate, vertically stacked charts: rain chance (with the selected hour's amount), temperature and feels like, sustained wind and gusts, and lightning potential. All use the same six-hour phone or twelve-hour desktop window and selected hour. Earlier/Later pages through the event without sideways scrolling. The exact data table and old combined overview are secondary, collapsed views. Values and concern shading come from the existing hourly model and briefing ratings; no forecast weights or thresholds change. Missing values break the plotted line or bar and never become zero. Print continues to use the compact two-page briefing.
