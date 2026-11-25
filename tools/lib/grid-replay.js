/* Forecast-highlight replays: a real NWS grid (CVG, ILN 35,38) with the coming days rewritten into one scenario, placed
   relative to "now" so a replay always looks ahead. Eastern Standard Time (UTC-5) anchors; for checks only.
     heavy:  Thursday-style heavy rain crossing local midnight (1 PM – 7 AM, about 1.26 in), rain definite from 10 AM that day to
             3 AM, then a Friday-morning wintry mix (rain and snow possible 6 – 11 AM, snow about 0.2 in)
     hot:    a heat index of 100°F at 2 PM the next day, everything else dry
     quiet:  no rain amounts, no precipitation type, no heat index */
"use strict";
const H = 3600e3;
function anchors(now) { const est = new Date(now - 5 * H), d0 = Date.UTC(est.getUTCFullYear(), est.getUTCMonth(), est.getUTCDate()) + 5 * H; return { day1: d0 + 24 * H, day2: d0 + 48 * H }; } // local midnights, as UTC ms
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "+00:00");
const block = (t0, h, value) => ({ validTime: iso(t0) + "/PT" + h + "H", value });
function scenario(grid, name, now) {
  const g = JSON.parse(JSON.stringify(grid)), P = g.properties, { day1, day2 } = anchors(now), end = day1 + 6 * 24 * H;
  const zeroAmt = () => [block(Math.floor(now / H) * H, Math.max(1, Math.round((end - Math.floor(now / H) * H) / H)), 0)];
  P.updateTime = iso(now - 30 * 60e3);
  if (name === "quiet" || name === "hot") {
    P.quantitativePrecipitation.values = zeroAmt(); P.snowfallAmount.values = zeroAmt(); P.iceAccumulation.values = zeroAmt();
    P.weather.values = [{ validTime: iso(Math.floor(now / H) * H) + "/P7D", value: [{ coverage: null, weather: null, intensity: null }] }];
    P.heatIndex = { uom: "wmoUnit:degC", values: [block(Math.floor(now / H) * H, 168, null)] };
    if (name === "hot") P.heatIndex.values = [block(day1 + 13 * H, 1, 35), block(day1 + 14 * H, 1, 37.8), block(day1 + 15 * H, 1, 36)]; // 95, 100, 97 °F
    return g;
  }
  // heavy: amounts in 6-hour blocks (mm), 1 PM day 1 to 7 AM day 2 local, crossing midnight
  P.quantitativePrecipitation.values = [block(day1 + 7 * H, 6, 1.5), block(day1 + 13 * H, 6, 10), block(day1 + 19 * H, 6, 14), block(day2 + 1 * H, 6, 8), block(day2 + 7 * H, 6, 1)];
  P.snowfallAmount.values = [block(day2 + 6 * H, 5, 5)]; P.iceAccumulation.values = [block(day2 + 6 * H, 5, 0)];
  P.weather.values = [
    { validTime: iso(day1 + 10 * H) + "/PT17H", value: [{ coverage: "definite", weather: "rain", intensity: "moderate" }] },   // 10 AM – 3 AM
    { validTime: iso(day2 + 6 * H) + "/PT5H", value: [{ coverage: "chance", weather: "rain", intensity: "light" }, { coverage: "chance", weather: "snow", intensity: "light" }] }]; // 6 – 11 AM
  return g;
}
module.exports = { scenario, anchors };
