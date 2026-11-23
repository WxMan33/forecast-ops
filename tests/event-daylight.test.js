/* Event Manager daylight: the Almanac's NOAA calculation at the venue, venue-local dates, and the one schedule note.
   NOAA reference: tests/fixtures/almanac/noaa-solcalc-2026.html (NOAA GML's 2026 table, downtown Cincinnati,
   about 2 km from TQL Stadium). Event records here are synthetic. Run: node tests/event-daylight.test.js */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const A = require("../assets/almanac-core.js"), C = require("../assets/ops-core.js"), D = require("../assets/event-daylight.js");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const tz = "America/New_York", TQL = { lat: 39.1113, lon: -84.5222 };
const day = (times, at = TQL, zone = tz, fold) => D.compute({ A, C, windows: C.event.windows({ tz: zone, times, fold }), lat: at.lat, lon: at.lon, tz: zone });
const times = (r) => r.shown.map((d) => [d.date, r.hm(d.rise), r.hm(d.set)]);

/* ---- the same numbers as NOAA's own table, through the Event Manager path (sunOn), on the review dates ---- */
{
  const html = fs.readFileSync(path.join(__dirname, "fixtures/almanac/noaa-solcalc-2026.html"), "utf8");
  const tables = html.split(/Sunrise Table|Sunset Table/).slice(1, 3).map((t) => t.split(/<tr/i).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim())).filter((r) => r.length >= 13 && /^\d+$/.test(r[0])));
  const noaa = (k, ymd) => tables[k].find((x) => +x[0] === +ymd.slice(8))[+ymd.slice(5, 7)];
  const pt = { lat: 39.124556, lon: -84.50386 }, hhmm = (ms) => C.time.toLocal(ms, tz).slice(11, 16);
  ["2026-11-26", "2026-11-21", "2026-11-01", "2026-10-31", "2026-03-08", "2026-03-07", "2026-12-31", "2026-06-21"].forEach((d) => {
    const s = D.sunOn(A, C, d, pt.lat, pt.lon, tz);
    eq([hhmm(s.rise), hhmm(s.set)], [noaa(0, d), noaa(1, d)], `${d}: sunrise and sunset equal NOAA's table`);
  });
  /* TQL Stadium is 0.018° west and 0.013° south of that point: the same minute on Thanksgiving */
  const t = D.sunOn(A, C, "2026-11-26", TQL.lat, TQL.lon, tz);
  eq([hhmm(t.rise), hhmm(t.set)], [noaa(0, "2026-11-26"), noaa(1, "2026-11-26")], "TQL Stadium, Nov 26: the same minute as NOAA's downtown table");
}

/* ---- Thanksgiving Day Race at TQL Stadium: the public 10K start (9:00 AM) with SAMPLE crew times (setup 5:00, gates 6:30, end 10:30, teardown 12:00 are placeholders, not confirmed race-day times) ---- */
const race = day({ setup: "2026-11-26T05:00", gates: "2026-11-26T06:30", start: "2026-11-26T09:00", end: "2026-11-26T10:30", teardown: "2026-11-26T12:00" });
eq(times(race), [["2026-11-26", "7:33 AM", "5:17 PM"]], "race: Thu Nov 26 sunrise 7:33 AM, sunset 5:17 PM");
eq([race.zone, race.note], ["EST", "Setup starts before sunrise (7:33 AM)."], "race: EST; setup starts before sunrise");
ok(/Daylight/.test(D.rowHtml(race)) && /Thu, Nov 26/.test(D.rowHtml(race)) && /data-sunrise="2026-11-26">7:33 AM/.test(D.rowHtml(race)) && /times EST/.test(D.rowHtml(race)), "race: the row has the Almanac's labels, the date, the times and the zone once");
eq(D.printLine(race).replace(/<[^>]+>/g, ""), "Daylight Thu, Nov 26: Sunrise 7:33 AM · Sunset 5:17 PM EST · Setup starts before sunrise (7:33 AM).", "race: one compact print line");

/* ---- a daytime match: no note ---- */
const noon = day({ setup: "2026-11-21T09:00", gates: "2026-11-21T11:30", start: "2026-11-21T13:00", end: "2026-11-21T15:00", teardown: "2026-11-21T16:30" });
eq([noon.note, noon.days.length, /ev-dl-note/.test(D.rowHtml(noon))], ["", 1, false], "daytime match: times only, no note");

/* ---- crosses sunset ---- */
const dusk = day({ setup: "2026-11-21T14:00", gates: "2026-11-21T16:30", start: "2026-11-21T17:30", end: "2026-11-21T19:30", teardown: "2026-11-21T21:30" });
eq([times(dusk), dusk.note], [[["2026-11-21", "7:28 AM", "5:20 PM"]], "Sunset during gates (5:20 PM)."], "crosses sunset: names the phase");

/* ---- overnight: both dates labelled; starts after sunset, sunrise during teardown ---- */
const night = day({ setup: "2026-12-31T18:00", start: "2026-12-31T21:00", end: "2027-01-01T01:00", teardown: "2027-01-01T08:30" });
eq(times(night).map((x) => x[0]), ["2026-12-31", "2027-01-01"], "overnight: both venue-local dates");
eq(night.note, "Setup starts after sunset (5:25 PM); then sunrise during teardown (7:57 AM).", "overnight: one line with both");
ok((D.rowHtml(night).match(/ev-dl-date/g) || []).length === 2 && /Thu, Dec 31/.test(D.rowHtml(night)) && /Fri, Jan 1/.test(D.rowHtml(night)), "overnight: each date is labelled on the row");
/* an end at midnight doesn't add the next date */
eq(day({ start: "2026-11-21T19:00", end: "2026-11-22T00:00" }).days.length, 1, "an end at midnight stays on one date");

/* ---- daylight-saving change dates ---- */
const fall = day({ setup: "2026-11-01T05:30", start: "2026-11-01T07:00", end: "2026-11-01T10:00", teardown: "2026-11-01T11:00" });
eq([times(fall), fall.zone, fall.note], [[["2026-11-01", "7:06 AM", "5:37 PM"]], "EST", "Setup starts before sunrise (7:06 AM)."], "fall-back day (Nov 1): EST times");
const spring = day({ setup: "2026-03-08T06:00", start: "2026-03-08T08:00", end: "2026-03-08T11:00", teardown: "2026-03-08T12:00" });
eq([times(spring), spring.zone], [[["2026-03-08", "8:00 AM", "7:38 PM"]], "EDT"], "spring-forward day (Mar 8): EDT times");
const across = day({ setup: "2026-10-31T20:00", start: "2026-10-31T22:00", end: "2026-11-01T02:00", teardown: "2026-11-01T03:00" }, TQL, tz, { end: 1 });
eq([times(across), across.zones, across.note], [[["2026-10-31", "8:05 AM", "6:38 PM"], ["2026-11-01", "7:06 AM", "5:37 PM"]], ["EDT", "EST"], "The whole event is after sunset (6:38 PM)."], "overnight across the fall-back change: each date in its own zone");
ok(/EDT<\/span>.*EST<\/span>/.test(D.rowHtml(across)) && !/times EDT\/EST/.test(D.rowHtml(across)), "across a change: the zone is shown per date");

/* ---- multi-day: first and last dates, nothing flagged for phases that span nights ---- */
const fair = day({ setup: "2026-11-25T08:00", start: "2026-11-25T10:00", end: "2026-11-29T18:00", teardown: "2026-11-29T20:00" });
eq([fair.days.length, fair.shown.map((d) => d.date), fair.skipped, fair.note], [5, ["2026-11-25", "2026-11-29"], 3, ""], "multi-day: five dates, first and last shown, 3 more noted");
ok(/3 more days/.test(D.rowHtml(fair)), "multi-day: says how many dates are between");
eq(day({ setup: "2026-11-25T08:00", start: "2026-11-25T10:00", end: "2026-11-27T18:00" }).shown.length, 3, "a three-day event lists all three dates");

/* ---- another time zone and an unknown venue ---- */
const den = day({ start: "2026-11-26T17:00", end: "2026-11-26T19:00" }, { lat: 39.7439, lon: -105.0201 }, "America/Denver");
eq([den.zone, /^4:\d\d PM$/.test(den.hm(den.days[0].set)), den.note], ["MST", true, "The whole event is after sunset (" + den.hm(den.days[0].set) + ")."], "Denver: venue-local MST");
eq(D.compute({ A, C, windows: C.event.windows({ tz, times: { start: "2026-11-26T17:00", end: "2026-11-26T19:00" } }), lat: NaN, lon: NaN, tz }), null, "no venue coordinates: no row");
console.log(`event daylight: ${n} checks passed`);
