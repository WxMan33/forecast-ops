# Weather Threats: winter weather (map layer and Event Planner)

Branch `claude/threats-planner-flood`, isolated Cloudflare Pages preview
`https://claude-threats-planner-flood.forecast-ops-beta.pages.dev`. Shared beta, production and navigation are unchanged.

## Sources (verified 2026-11-20)

| Product | Source used | What it represents |
|---|---|---|
| NWS winter alerts: Winter Storm Warning and Watch, Blizzard Warning, Ice Storm Warning, Lake Effect Snow Warning, Winter Weather Advisory | `api.weather.gov/alerts/active?event=…` (the same request as the severe and flood products), through `/api/nws` on the preview | VTEC `WS.W`, `WS.A`, `BZ.W`, `IS.W`, `LE.W`, `WW.Y`. Issued for **NWS forecast zones** with no polygon (`geometry: null`), so the area is drawn from `api.weather.gov/zones/forecast/{UGC}`. One VTEC event can carry different end times per zone, so the store tracks each zone separately and regroups them. `onset` is the start of the hazard; the first message time is kept as "issued". United States coverage. |
| WPC **WSSI-P** (probabilistic Winter Storm Severity Index, Overall) | NOAA map service `outlooks/wpc_wssi_p/MapServer` layers 10 (winter weather area), 1 Minor, 2 Moderate, 3 Major, 4 Extreme. CORS echoes the origin. | For each **rolling 24-hour window** (every 6 hours from hour 24 to hour 168: Days 1–7), the probability (5–95%) of **at least** each impact level. Levels follow WPC's definitions (Minor: a few inconveniences, winter driving; Moderate: disruptions, hazardous driving; Major: considerable disruptions, dangerous or impossible driving; Extreme: substantial disruptions, life-saving actions may be needed). Contiguous U.S. Fields `prob`, `impact`, `validstart`/`validend` ("00Z 2026/11/21"), `fcsthr`, `idp_filedate` (the file time, shown as issued). Empirically cumulative: at Crystal Mountain every one of 25 windows had winter weather ≥ Minor ≥ Moderate. |

**Why WSSI-P.** For setup, gates or teardown several days out, WSSI-P answers "how likely is this to disrupt operations?" through Day 7, in 24-hour windows that can be matched to event phases. Alternatives considered:
- WPC's deterministic WSSI covers Days 1–3 only.
- The Day 4–7 PWPF snow/ice probabilities are published as raster images in KML.
- WPC's snowfall probabilities give amounts, not impacts.

**Limits.**
- WPC does not archive WSSI-P shapes. The ftp-wpc archive keeps PNG images only.
- The map service is sometimes slow. The Extreme layer once hung for 60 s while the others answered in under 3 s.
- Live, Planner retries a failed level once. If it still fails and the level below it has no area at the venue, the failed level is bounded "under 5%" and marked *inferred* in More info. Otherwise the source stays unconfirmed.

## Planner

- **Headlines:**
  - NWS alert: "Winter Storm Warning during setup", "Winter Weather Advisory during setup, gates, the event and teardown".
  - WSSI-P: "Winter weather likely Saturday", "Minor winter impacts possible Sunday". "Likely" means at least 60%, "possible" means 30–59%, and anything lower reads "Low chance of …".
  - The window shown is the most significant one overlapping the event (most severe level with at least a 30% chance).
- **Line:** shows the 24-hour window in the event's time zone and the phases it overlaps. It says it is a chance for the whole window, not timing within it.
- **More info (WSSI-P):** WPC file time, the window, the chance at each level, the overlapping phases, when the source was last checked, and "Covers through" (the end of the last published window). Also the venue basis (point query live, or the probability area in the archive) and WPC's meaning of the level.
- **More info (alert):** issued (first message), "from onset until end", last checked, and the forecast zones listed.
- **Coverage end:** an event running past the last WSSI-P window is "not fully confirmed", and the source line says where coverage ends.
- **View on map:**
  - WSSI-P opens the map's Winter · 7 days view at the venue, with the same window and level.
  - Alerts open Active now with the alert selected, Winter layer only.
- **Archived samples:** checked for their own hazard only. A flood sample is not marked unconfirmed because it has no winter data.

## Map

- **Winter layer toggle.** Winter alerts are drawn from their zones:
  - warnings solid and filled (pink, or orange for blizzard, purple for ice storm, teal for lake-effect snow);
  - watches dashed;
  - advisories as a thin outline.
- **"Winter · 7 days" view** (shown when Winter is on):
  - WSSI-P areas for one level and one 24-hour window, with a probability legend from 5% to 95%;
  - the window picker and level buttons;
  - the venue's chance at every level;
  - a 7-day list of the highest level with at least a 30% chance per window;
  - where coverage ends;
  - winter alerts in effect at the venue.
- **Live data:** the map service gives the windows (one distinct-values query), one level's shapes per window on demand, and the venue's point values.

## Archived cases (official)

| Sample | Clock | Venue → result |
|---|---|---|
| `archive-winter-advisory` | Nov 18 4:00 p.m. MST | Snowbird → Winter Weather Advisory (KSLC WW.Y 0018, UTZ110-112) |
| `archive-winter-warning` | Nov 19 10:00 a.m. MST | Snowbird → Winter Storm Warning (WS.W 0003; the advisory was upgraded for UTZ110/111). Park City (UTZ108) → still the advisory |
| `archive-winter-outlook` | Nov 20 2:30 p.m. MST, WSSI-P file 1848Z, captured 21:23Z | Crystal Mountain, Tue Nov 24 → "Minor winter impacts likely Tuesday · 60%"; Snowbird → warning and WSSI-P together |

Fixtures: `tests/fixtures/threats/nws-archive-kslc-*.json`, `nws-zones-utah-20261120.json`, `wpc-wssi-p-overall-{cascades,wasatch}-20261120.json`.
The WSSI-P fixtures are clipped to a box and simplified by 0.01°, so the archived map shows a rectangle of WPC's areas.

## Verification

See `docs/threats/planner-check/report.json` (hosted on the Cloudflare preview) and the screenshots beside it.
