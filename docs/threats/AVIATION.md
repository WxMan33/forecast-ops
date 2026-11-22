# Weather Threats: aviation (airport METAR and TAF)

Branch `claude/threats-planner-flood`, isolated Cloudflare Pages preview. Shared beta, production and navigation are unchanged.

## Sources (verified 2026-11-22)

| Product | Source | What it is |
|---|---|---|
| **METAR** | NOAA Aviation Weather Center Data API `aviationweather.gov/api/data/metar?ids=…&format=json`, through `/api/awc/metar` on the preview (AWC sends no CORS header). Cached 2 minutes. | The airport's latest routine or special observation: observation time, wind and gusts, visibility, cloud layers and ceiling, weather, and AWC's flight category. |
| **TAF** | `…/api/data/taf?ids=…&format=json`, through `/api/awc/taf`. Cached 5 minutes. | The terminal forecast for 5 statute miles around the airport, usually 24–30 hours, amended as needed. Its base period and FM, BECMG, TEMPO and PROB change groups each have their own times. |

**Flight category.** For TAF periods it is computed from ceiling (the lowest BKN/OVC layer or vertical visibility) and visibility, using FAA definitions:
- **LIFR:** ceiling under 500 ft or visibility under 1 mi.
- **IFR:** ceiling 500 to under 1,000 ft or visibility 1 to under 3 mi.
- **MVFR:** ceiling 1,000–3,000 ft or visibility 3–5 mi.
- **VFR:** above those.

METARs carry AWC's own category.

**Concern.** Any of:
- IFR or LIFR;
- gusts of 30 kt or more, or sustained wind of 25 kt or more;
- thunderstorms, or freezing or frozen precipitation.

MVFR is shown in More info, not as an item.

## Planner

- **Airports:**
  - An event has a primary and an optional alternate airport, each with its own arrival and departure window, entered in the event's local time.
  - They are kept with Weather Threats, per event in this browser, or passed in links as `?air=[{"i":"KORD","r":"p","a":[from,to],"d":[from,to]},…]`.
  - Event Manager's event record is unchanged, which keeps the beta merge clean.
- **TAF items:**
  - Each airport and window is matched against its own TAF periods, never the event's hours.
  - Example headline: "KORD arrival (Sun 10:45 a.m.–11:30 a.m.): temporarily IFR forecast".
  - The line names the airport and role, the TAF issue time (and whether amended), the overlapping period with its ceiling, visibility and weather, and "Terminal forecast for the airport, not the venue".
- **METAR item:** a current concern while the airport's windows are still ahead. Example: "KORD now: IFR (observed 10:31 a.m.)".
- **Source line:** each airport's METAR and TAF times, plus TAF coverage. A window that runs past the TAF is stated, and the source stays unconfirmed.
- **More info:** airport and role, issued and valid times, your window, the overlapping periods, the flight-category definition, and the raw TAF or METAR.
- **View on map:** opens the Aviation layer, with the event's airports drawn by flight category and the selected product's detail.

## Cases

| Case | Data | Result |
|---|---|---|
| Archived capture (`archive-aviation-chicago`, Nov 22 16:35Z) | Official KORD, KMDW and KMKE METARs and TAFs, captured live | United Center has no hazard item (the venue looks fine). O'Hare (primary): "temporarily IFR" in the TEMPO period overlapping the 10:45–11:30 a.m. arrival, and "IFR now" (BKN009 at 10:31 a.m.). Midway (alternate) is named separately. The Monday departure falls in VFR: no item. |
| Live (hosted, Nov 22 17:27Z) | The same airports through `/api/awc` | "KORD arrival (Sun 11:42 a.m.–12:42 p.m.): IFR forecast" (TAF 1706Z AMD), "KMDW now: IFR (observed 11:12 a.m.)", and "KMDW arrival: temporarily IFR". |

## Not included

PIREPs, SIGMETs and AIRMETs, airport delay programs (FAA), and the alternate-airport legality rules (2-1-2) for flight planning.
