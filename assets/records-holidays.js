/* Holiday dates for Weather Records & Milestones (no network). Browser: window.RecordsHolidays; Node: require().
   A rule gives the date a holiday was actually observed in a given year, so a "wettest Thanksgiving" compares each
   year's own Thanksgiving, not a fixed calendar date.

   datesFor(key, year, region) -> { dates: ["YYYY-MM-DD", ...], note } or null when the holiday was not observed (or its
   date is unknown) that year. More than one date means the observed date is uncertain for that region (e.g. 1939-1941
   Thanksgiving): a result is published only when it is the same for every candidate date (see RecordsEngine).

   Sources and rules
   - US Thanksgiving: a national holiday from 1863 (Lincoln's proclamation), on the last Thursday of November through
     1938. In 1939-1941 the federal date moved to the next-to-last Thursday while about half the states kept the last
     Thursday ("Franksgiving"); which date Ohio and Kentucky observed has not been verified, so both are candidates there.
     From 1942 on, the fourth Thursday of November (Public Law 77-379, 1941).
   - US fixed dates: New Year's Day (Jan 1), Independence Day (Jul 4), Christmas Day (Dec 25), Veterans Day (Nov 11).
   - US Memorial Day: May 30 through 1970; the last Monday of May from 1971 (Uniform Monday Holiday Act).
   - US Labor Day: the first Monday of September from 1894 (federal holiday).
   - Canada Thanksgiving: the second Monday of October from 1957; earlier dates varied by proclamation and are not
     tabled here yet, so those years are left out (counted as unavailable, never guessed). */
(function (root) {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun .. 6 Sat
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  /* the nth weekday (n >= 1) of a month, or the last (n = -1) or next-to-last (n = -2) */
  function nthWeekday(y, m, wd, n) {
    const all = []; for (let d = 1; d <= daysIn(y, m); d++) if (dow(y, m, d) === wd) all.push(d);
    const d = n > 0 ? all[n - 1] : all[all.length + n];
    return d ? ymd(y, m, d) : null;
  }
  /* regions whose 1939-1941 Thanksgiving date is verified; others get both candidates */
  const FRANKSGIVING_VERIFIED = {};
  const RULES = {
    "US-thanksgiving": {
      name: "Thanksgiving", country: "US", from: 1863,
      dates(y, region) {
        if (y < 1863) return null;
        if (y <= 1938) return { dates: [nthWeekday(y, 11, 4, -1)] };
        if (y <= 1941) {
          const fed = nthWeekday(y, 11, 4, -2), last = nthWeekday(y, 11, 4, -1), v = region && FRANKSGIVING_VERIFIED[`${region}:${y}`];
          if (v) return { dates: [v === "federal" ? fed : last] };
          return { dates: [fed, last], note: `${y}: the federal date (${fed.slice(5)}) and the last Thursday (${last.slice(5)}) were both observed in different states` };
        }
        return { dates: [nthWeekday(y, 11, 4, 4)] };
      },
    },
    "US-newyear": { name: "New Year's Day", country: "US", dates: (y) => ({ dates: [ymd(y, 1, 1)] }) },
    "US-independence": { name: "Independence Day", country: "US", dates: (y) => ({ dates: [ymd(y, 7, 4)] }) },
    "US-christmas": { name: "Christmas Day", country: "US", dates: (y) => ({ dates: [ymd(y, 12, 25)] }) },
    "US-veterans": { name: "Veterans Day", country: "US", from: 1919, dates: (y) => (y < 1919 ? null : { dates: [ymd(y, 11, 11)] }) },
    "US-memorial": { name: "Memorial Day", country: "US", from: 1868, dates: (y) => (y < 1868 ? null : { dates: [y <= 1970 ? ymd(y, 5, 30) : nthWeekday(y, 5, 1, -1)] }) },
    "US-labor": { name: "Labor Day", country: "US", from: 1894, dates: (y) => (y < 1894 ? null : { dates: [nthWeekday(y, 9, 1, 1)] }) },
    "CA-thanksgiving": { name: "Thanksgiving", country: "CA", from: 1957, dates: (y) => (y < 1957 ? null : { dates: [nthWeekday(y, 10, 1, 2)] }) },
  };
  function datesFor(key, year, region) { const r = RULES[key]; return r ? r.dates(year, region) : null; }
  /* holidays observed on a date (any candidate), for the given country */
  function on(date, country = "US", region) {
    const y = +date.slice(0, 4);
    return Object.entries(RULES).filter(([, r]) => r.country === country).filter(([k]) => { const d = datesFor(k, y, region); return d && d.dates.includes(date); }).map(([k, r]) => ({ key: k, name: r.name }));
  }
  const api = { RULES, datesFor, on, nthWeekday, FRANKSGIVING_VERIFIED };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RecordsHolidays = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
