# Forecast Ops betas

Two previews built from the same code on the `beta-previews` branch. They are separate from the live site
(GitHub Pages serves `main` only) and open without an account, calendar connection or GitHub sign-in.

| Beta | Preview link |
|---|---|
| Meteorologist | https://raw.githack.com/WxMan33/forecast-ops/beta-previews/meteorologist-beta.html |
| Event manager | https://raw.githack.com/WxMan33/forecast-ops/beta-previews/event-beta.html |

The links serve the branch's files directly from GitHub through raw.githack.com (a free static file CDN for
public repositories). They update a few minutes after each push. The `Beta preview check` workflow opens both
links on desktop and phone from a fresh, signed-out browser on every push and refreshes the screenshots in
[`screens/`](screens/).

## What both betas share

- One visual identity (`assets/beta.css`): larger forecast numbers, Archivo typography, explicit valid times
  (weekday, clock time, zone, "in 5 h"), rules and whitespace instead of a card per item.
- One weather story (`assets/beta-story.js`): the Model Blend data request and recipe, `C.blend.windowRow`
  aggregation, `Core.event` phase windows, `ModelTrends.timing` precipitation windows and the Thunder signal.
  The betas add selection and wording, not forecast methods.
- The existing HRRR map, embedded (`maps.html?embed=1`).
- No private verification records: none are in this public repository, the betas do not link to
  verification, and on the preview host the workspace footer omits its verification links.

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
