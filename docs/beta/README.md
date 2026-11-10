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

## Upcoming events and saved venues

The briefing stays the main screen; **Upcoming events** (link at the top, or `event-beta.html#upcoming`) lists every saved event:

- One row per event: name, venue, local time at the venue (plus your own time when it differs) and one status: **Weather concern**, **Briefing ready**, **Briefing partly ready**, **Waiting for guidance** or **Venue needs confirmation** (calendar imports without a recognised venue). Events that need a weather decision come first, then the rest by start time; past events fold away.
- Tap an event to open its briefing (`?ev=<id>`, so a refresh keeps it). Add, edit and remove from the list.
- **Saved venues:** name, coordinates, time zone and default offsets (setup before the start, gates before the start, teardown after the end) plus the tent gust limit. New events at a venue start from its defaults; a time changed for one event is kept as that event's override ("Gates set for this event") and can be reset to the defaults.
- Everything is stored in this browser (`beta_events_v2`, `beta_venues_v1`). The records carry a `source` (`manual` now; `calendar` with calendar and event IDs later), and `EventStore.fromCalendar` already maps a Google Calendar event onto the same record, matching its location to a saved venue.
- The calendar reminder on a pending or partly covered briefing reads "Add a calendar reminder" and says it is set for the estimated time the full briefing will be ready. It is counted as `reminder_exported` (a link click or .ics download; the beta can't tell whether it was saved).

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
- **Event manager:** "Decide which phase needs a rain plan." (Decision sentence, schedule strip, phase details.)

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
