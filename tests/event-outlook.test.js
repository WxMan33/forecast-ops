/* Early weather outlook (event-outlook.js): which dates get daily figures, the likely-type rules, and the states. Synthetic. */
"use strict";
const assert = require("assert"), O = require("../assets/event-outlook.js");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; }, ok = (c, m) => { assert(c, m); n++; };
const H = 3600e3, D = 864e5, T0 = Date.UTC(2026, 10, 26, 10); // Thu Nov 26, 5 AM EST
const day = (ms) => new Date(ms - 5 * H).toISOString().slice(0, 10); // EST
const W = [["setup", "Setup", 0, 1.5], ["gates", "Gates", 1.5, 2.5], ["event", "Event", 2.5, 5.5], ["teardown", "Teardown", 5.5, 7]].map(([key, label, a, b]) => ({ key, label, startMs: T0 + a * H, endMs: T0 + b * H }));
const all = { key: "all", label: "All", startMs: T0, endMs: T0 + 7 * H };
const rows = [{ k: "2026-11-25", hi: 50, lo: 38, pop: 35, qpf: 0, sn: 0 }, { k: "2026-11-26", hi: 38.4, lo: 27.2, pop: 62, qpf: 0.4, sn: 1.4 }];
const R = (state) => ({ state, firstAt: T0 - 7 * D, readyAt: T0 + 7 * H - 7 * D });
/* type rules */
eq(O.dayType({ pop: 60, qpf: 0.3, sn: 0 }).kind, "rain", "no snowfall: rain");
eq(O.dayType({ pop: 60, qpf: 0.3, sn: 2.1 }).kind, "snow", "7 in snow per inch liquid: snow");
eq(O.dayType({ pop: 60, qpf: 0.4, sn: 1.4 }).kind, "mix", "half snow: rain/snow mix possible");
eq(O.dayType({ pop: 15, qpf: 0, sn: 0 }).kind, "unlikely", "low chance and no amount: no type");
eq(O.dayType({ pop: 50, qpf: 0.005, sn: 0 }).kind, "unclear", "a chance but no measurable amount: type not clear yet");
eq(O.dayType({ pop: null, qpf: null }).kind, "unknown", "no guidance: not available");
/* no hourly coverage: the race day gets daily figures */
let m = O.build({ windows: [...W, all], rows, hourlyEndMs: T0 - 6 * H, R: R("pending"), day, now: T0 - 7.5 * D });
eq([m.state, m.days.length, m.days[0].k, m.days[0].hi, m.days[0].lo, m.days[0].pop, m.days[0].type.kind], ["outlook", 1, "2026-11-26", 38, 27, 60, "mix"], "pending: one day, rounded, chance to 5%");
eq(m.days[0].parts, ["Setup", "Gates", "Event", "Teardown"], "the parts of the event on that day");
const h = O.html(m, { dayName: () => "Thu, Nov 26", when: () => "Thu, Nov 19, about 2 AM EST" }, '<a data-remind="ics">r</a>');
ok(/A lot can change this far out/.test(h) && /midnight to midnight venue time, not the event hours/.test(h) && /reach setup around/.test(h) && /data-remind/.test(h), "html: caution, period label, timing, reminder");
ok(!/7:30|start time weather/.test(h.replace("not a forecast for the start time", "")), "html: no start-time weather");
/* partial: only the uncovered part */
m = O.build({ windows: [...W, all], rows, hourlyEndMs: T0 + 3 * H, R: R("partial"), day, now: T0 - 6 * D });
eq([m.state, m.days[0].parts], ["outlook", ["Event", "Teardown"]], "partial: the uncovered parts only");
ok(/rest of the event should come into hourly range/.test(O.html(m, { dayName: () => "", when: () => "x" })), "partial: says when the rest comes into range");
/* full coverage: nothing */
eq(O.build({ windows: [...W, all], rows, hourlyEndMs: T0 + 8 * H, R: R("ready"), day, now: T0 - 6 * D }).state, "none", "ready: no outlook");
/* beyond the daily outlook, by date (not loaded) or by the rows' last day */
m = O.build({ windows: [...W, all], rows: [], hourlyEndMs: T0 - 10 * D, R: R("pending"), day, now: T0 - 18 * D });
eq([m.state, new Date(m.outlookAt).toISOString().slice(0, 10)], ["beyond", "2026-11-17"], "beyond: no numbers; outlook starts 9 days before");
eq(O.build({ windows: [...W, all], rows: rows.slice(0, 1), hourlyEndMs: T0 - 2 * D, R: R("pending"), day, now: T0 - 9.5 * D }).state, "beyond", "beyond: past the rows' last day");
eq(O.build({ windows: [...W, all], rows: null, hourlyEndMs: T0 - 2 * D, R: R("pending"), day, now: T0 - 8 * D }).state, "unavailable", "outlook failed to load: says so, keeps timing");
console.log(`ok - ${n} early outlook checks passed`);
