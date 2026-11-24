# Weather Threats: NWS forwarding function (branch only)

**Status:** running on this branch's isolated Cloudflare Pages preview, `https://claude-beautiful-hawking-tnr.forecast-ops-beta.pages.dev`
(created automatically by the existing Forecast Ops Pages project when the branch was pushed; Cloudflare shortens branch names to 28 characters).
**Not** on the shared beta (`forecast-ops-beta.pages.dev`, where `/api/nws/*` returns the site's fallback page) or production.

**Cloudflare verification (2026-11-20, code of commit `ebc67f2`):** `node tools/threats-cf-function-check.js <host>` → `cloudflare-check.json`.
All 8 checks pass:
- Every NWS request from the browser went to `<host>/api/nws`; none went straight to api.weather.gov.
- The page's "last confirmed" equals the function's upstream time.
- A refresh within 30 s was a cache HIT and kept that time (20:25:17.945Z); the next refresh after the cache window was a MISS and advanced it (20:25:53.259Z).
- County (PAC101) and marine (ANZ430) shapes load through the function.
- The function reports the identifying User-Agent on every answer.

Desktop and phone smoke checks with `THREATS_QUERY=nws=function` (`screens/cloudflare/report.json`): 16 of 16 views pass, and 121 of 121 NWS requests went
through the function with HTTP 200. On Cloudflare, the upstream User-Agent is evidenced by the deployed code, which is byte-identical to this
commit, and by the function's own `X-Upstream-User-Agent` header. NWS does not echo back what it received, so the upstream request itself was
observed only in the local harness.

## What it does

`functions/api/nws/[[path]].js` is a Cloudflare Pages Function. It forwards only the NWS requests Weather Threats makes, and adds
the repo's app-identifying User-Agent, the same string the Node tools send (`assets/ops-data.js`):

`User-Agent: (forecast-ops, github.com/WxMan33/forecast-ops)`

| Route | Upstream | Cached for |
|---|---|---|
| `/api/nws/alerts/active?event=…` (only Tornado / Severe Thunderstorm Warning / Watch; no other parameters) | `api.weather.gov/alerts/active` | 30 s |
| `/api/nws/alerts/urn:oid:…` (the earlier message an update replaced; used for "What changed") | `api.weather.gov/alerts/{id}` | 1 h |
| `/api/nws/zones/county/XXC###`, `/api/nws/zones/forecast/XXZ###` (shapes for county-based alerts) | `api.weather.gov/zones/…` | 24 h |
| `/api/nws/points/LAT,LON` (up to 4 decimals; a venue's NWS office and grid cell) | `api.weather.gov/points/…` | 24 h |
| `/api/nws/gridpoints/WFO/X,Y` (added 2026-11-24: the venue's hourly forecast grid for "Next 12 hours"; refused without `updateTime` and `windGust`) | `api.weather.gov/gridpoints/…` | 15 min |
| anything else | not forwarded: **404** | — |

CORS allows the github.io site, the Pages hosts, raw.githack.com and localhost.

## Using it

The page calls NWS directly by default, which is how the branch preview on raw.githack.com still works. Two settings switch it:
- `threats.html?nws=function`: sends NWS requests through `/api/nws` on the same host (Pages, or the local harness).
- `threats.html?nwsBase=https://<host>/api/nws`: uses a function on another compatible host.

Local test host: `NODE_USE_ENV_PROXY=1 node tools/nws-function-harness.mjs 8822`, then open `http://localhost:8822/threats.html?nws=function`.
The harness serves the site and routes `/api/nws/*` to the function's own handler. It logs every upstream request with its headers,
so the identity NWS receives can be checked. Its test hooks (upstream URL, clock, timeout) are honoured only from the harness:
it passes a flag that Pages environment variables cannot set.

## Freshness

| | Interval |
|---|---|
| The browser checks NWS alerts and SPC MDs | every 60 s while the page is visible, and again when the tab comes back |
| The browser checks SPC outlooks and our research model | every 10 min |
| The function may answer active alerts from its cache | up to 30 s after NWS answered |
| The function may answer zone shapes / single alerts from cache | up to 24 h / 1 h |
| Alerts count as stale (shown as "last known") | 10 min after the last real NWS confirmation |

- **"Last confirmed" is when NWS actually answered.** Through the function that is its `X-Upstream-Fetched-At` header. A cache hit keeps
  the original time, so the page never treats a cached copy as a new check. Directly, it is the browser's time when the answer arrived. A
  "none active" shown through the function can therefore be up to about 90 s old (60 s poll + 30 s cache), and the time shown is its real age.
- **Failures are never cached and never answered from an old copy.** An upstream error, a timeout (15 s), a non-JSON body, an alert list
  without `features`, or a paged list all return **502** with a reason. The page treats that as a failed refresh: products stay as
  "last known" with the last confirmed time, until their published expiration.
- An answer older than the last confirmed check (for example a stale copy from another function instance) is ignored. It cannot end
  products or move the confirmation time back.

## Evidence (this branch)

- **Real NWS through the harness** (`function-check/real-nws.json`): the active list, zone shapes and a single alert all returned 200.
  NWS received `User-Agent: (forecast-ops, github.com/WxMan33/forecast-ops)` on every upstream request. A repeat request within 30 s was a cache
  HIT with the original upstream time. Out-of-scope requests (`event=Flood Warning`, `/points/…`) got 404 and were not forwarded.
- **End-to-end freshness** (`node tools/threats-function-check.mjs`, report in `function-check/report.json`, screenshots labelled
  FIXTURE). A mock NWS feeds the function harness, the real page loads with `?nws=function`, and the page and function clocks move together.
  All 10 steps pass:
  1. A normal refresh is a fresh confirmation (MISS; "Tornado Warning in effect at the venue").
  2. A cache hit within 30 s makes no upstream call, keeps the confirmation time, and doesn't pick up the newer upstream answer.
  3. Upstream 503: the function returns 502; the page shows "Last known: Tornado Warning at the venue" and keeps the time; nothing is cleared.
  4. Non-JSON upstream: 502; nothing cleared.
  5. A paged list: 502; nothing cleared.
  6. A 4 s upstream against a 1.5 s test timeout: 502; nothing cleared.
  7. Recovery: a fresh confirmation again.
  8. Expiration during a failure: the warning leaves the active view, with a "reached its published expiration" notice; status unknown.
  9. A confirmed empty answer after recovery: nothing active, freshly confirmed.

  The mock received only the identifying User-Agent.

## Open

- **A deployed check is still to do.** The function hasn't run on Cloudflare yet. This session can reach only `forecast-ops-beta.pages.dev`
  itself, not per-branch Pages hosts. I don't know whether the Pages project builds branch previews; if it does, this branch's push would
  create one. The next step, for review: run `tools/threats-function-check.mjs`'s real-NWS calls against a branch preview host or the beta.
- The Cache API may not persist on `*.pages.dev`. The per-instance memory cache still applies, and freshness is correct either way,
  because the time shown is always the upstream time.
- Cost on Cloudflare's free plan, per its published pricing (not re-checked here): 100,000 function requests a day.
