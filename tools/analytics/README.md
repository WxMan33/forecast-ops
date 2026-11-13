# Beta usage analytics (private)

The betas count which features colleagues use, to decide what to build next. Collection is off until you set
up the collector below; until then nothing leaves anyone's browser.

## What is recorded

Per interaction: which beta, the interaction type, a random browser ID (approximate returning browsers), a
random session ID (30 minutes of inactivity starts a new one), that browser's session number, an internal-testing
flag and allow-listed context: market (`cincinnati` or `elsewhere`), tool, map layer, event phase, load
failure kind, feedback rating.

Never recorded: names, emails, search text, city or venue names, coordinates, event names or schedules, page
URLs, IP addresses or user agents. The collector validates every row against the same allow-list
(`report.js`) and stores no request metadata.

Interactions: city selected, forecast tool opened, models compared, weights adjusted (on Model Blend, when opened
from the beta), map layer changed, playback started, timeline used (a click or drag counts once; repeats within
3 seconds are merged), sample briefing opened, custom event started, event saved, phase details opened, saved
event revisited in a later session, city searched, search with no U.S. results, forecast load failure, missing
feeds, link copied, feedback (useful / not useful yet).

## Separating your own testing

Open either beta once with `?internal=1` in each browser you test with. That browser is then marked internal
(undo with `?internal=0`). `localhost` and automated browsers (the CI check) are always internal. Internal
sessions are reported separately and excluded from the colleague numbers.

## Notice and opt-out

Both betas show a one-line notice with **Turn off** in the footer. Turning it off, Do Not Track or Global
Privacy Control stops all sending. Blocked requests are ignored and the betas keep working.

## Set up the collector (about 5 minutes)

1. Create a new Google Sheet (private to you), for example "Forecast Ops beta usage".
2. Extensions → Apps Script. Replace `Code.gs` with `apps-script/Code.gs`; add a script file `Report` and paste
   `apps-script/Report.gs`. Save.
3. Deploy → New deployment → type **Web app**. Execute as: **Me**. Who has access: **Anyone** (the betas are
   used signed out). Deploy, authorize, and copy the URL ending in `/exec`.
4. Put that URL in `assets/beta-config.js` (`endpoint: "https://script.google.com/macros/s/…/exec"`), stamp
   assets and push. The collector URL only accepts rows; `GET` returns `{"ok":true}` and never data.
5. Reload the Sheet. Use **Forecast Ops → Beta usage dashboard**. Only people with access to the Sheet can open it.

## Dashboard

Weekly, per beta: browsers, sessions, returning browsers (estimate), browsers choosing Cincinnati vs elsewhere,
feedback; per feature, browsers who used it, share of sessions and how many came back to it in a later
session; where tasks stalled (no search match, load failures, missing feeds, events started but not saved);
for the event beta, sample opened → custom event started → event saved → returned later.
