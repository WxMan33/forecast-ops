/* Verification target windows. Every window is a pair of UTC instants [start, end), defined before
   scoring, with the convention named explicitly. Conventions never mix:
     climate day  = local STANDARD time midnight to midnight (NWS CLI/CF6, ACIS, GHCN-Daily)
     NWS daytime  = 7 AM to 7 PM local standard time (12Z-00Z for EST)
     NWS night    = 7 PM to 8 AM local standard time; observed here from the 00Z-12Z METAR 6-h groups
     synoptic 12h = 12Z-00Z and 00Z-12Z (NWS PoP12 / QPF periods)
     hourly       = a valid instant (top of the hour, UTC)   */
"use strict";
const { addDays } = require("./util.js");
const H = 3600e3;
const VERSION = "targets-v1";

const dayStartUtc = (d, lstOffsetMin) => Date.parse(d + "T00:00:00Z") - lstOffsetMin * 60e3;
const TARGETS = {
  tmax_clim: { label: "Daily high (climate day)", unit: "F", kind: "temp", conv: "climate-day-LST", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin), dayStartUtc(addDays(d, 1), L.lstOffsetMin)], obs: "CLI/ACIS daily maximum" },
  tmin_clim: { label: "Daily low (climate day)", unit: "F", kind: "temp", conv: "climate-day-LST", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin), dayStartUtc(addDays(d, 1), L.lstOffsetMin)], obs: "CLI/ACIS daily minimum" },
  tmax_day: { label: "Daytime high (7a-7p LST)", unit: "F", kind: "temp", conv: "nws-daytime-12h", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin) + 7 * H, dayStartUtc(d, L.lstOffsetMin) + 19 * H], obs: "METAR 6-h maxima ending 18Z and 00Z" },
  tmin_night: { label: "Overnight low (night after date)", unit: "F", kind: "temp", conv: "nws-night-12h", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin) + 19 * H, dayStartUtc(d, L.lstOffsetMin) + 31 * H], obs: "METAR 6-h minima ending 06Z and 12Z (7p-7a LST; NWS MinT nominally runs to 8 AM)" },
  precip_clim: { label: "Precipitation (climate day)", unit: "in", kind: "precip", conv: "climate-day-LST", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin), dayStartUtc(addDays(d, 1), L.lstOffsetMin)], obs: "CLI/ACIS daily precipitation; trace = 0 with trace flag" },
  pop01_clim: { label: "Chance of >= 0.01 in (climate day)", unit: "prob", kind: "prob", threshold: 0.01, conv: "climate-day-LST", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin), dayStartUtc(addDays(d, 1), L.lstOffsetMin)], obs: "climate-day precipitation >= 0.01 in" },
  pop01_day12: { label: "Chance of >= 0.01 in (12Z-00Z)", unit: "prob", kind: "prob", threshold: 0.01, conv: "synoptic-12h", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin) + 7 * H, dayStartUtc(d, L.lstOffsetMin) + 19 * H], obs: "METAR 6-h precipitation ending 18Z and 00Z" },
  pop01_night12: { label: "Chance of >= 0.01 in (00Z-12Z)", unit: "prob", kind: "prob", threshold: 0.01, conv: "synoptic-12h", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin) + 19 * H, dayStartUtc(d, L.lstOffsetMin) + 31 * H], obs: "METAR 6-h precipitation ending 06Z and 12Z" },
  precip_day12: { label: "Precipitation (12Z-00Z)", unit: "in", kind: "precip", conv: "synoptic-12h", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin) + 7 * H, dayStartUtc(d, L.lstOffsetMin) + 19 * H], obs: "METAR 6-h precipitation ending 18Z and 00Z" },
  precip_night12: { label: "Precipitation (00Z-12Z)", unit: "in", kind: "precip", conv: "synoptic-12h", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin) + 19 * H, dayStartUtc(d, L.lstOffsetMin) + 31 * H], obs: "METAR 6-h precipitation ending 06Z and 12Z" },
  snow_clim: { label: "Snowfall (climate day)", unit: "in", kind: "snow", conv: "climate-day-LST", window: (d, L) => [dayStartUtc(d, L.lstOffsetMin), dayStartUtc(addDays(d, 1), L.lstOffsetMin)], obs: "CLI snowfall (collected, scored separately)" },
};
/* Hourly temperature target: observed from the routine METAR in the 15 minutes before the valid hour. */
const HOURLY = { id: "temp_hourly", label: "Hourly temperature", unit: "F", conv: "valid-instant", obs: "routine METAR (tenths from T-group) within 15 min before the hour" };
/* Lead day of a valid date relative to a capture's local date (0 = same date). */
const leadDay = (captureLocalDate, validDate) => Math.round((Date.parse(validDate + "T00:00:00Z") - Date.parse(captureLocalDate + "T00:00:00Z")) / 86400e3);
const LEAD_GROUPS = [{ id: "d1-2", min: 1, max: 2 }, { id: "d3-4", min: 3, max: 4 }, { id: "d5-7", min: 5, max: 7 }, { id: "d8+", min: 8, max: 99 }];
const leadGroup = (lead) => (LEAD_GROUPS.find((g) => lead >= g.min && lead <= g.max) || { id: lead <= 0 ? "d0" : "?" }).id;
module.exports = { VERSION, TARGETS, HOURLY, dayStartUtc, leadDay, LEAD_GROUPS, leadGroup, H };
