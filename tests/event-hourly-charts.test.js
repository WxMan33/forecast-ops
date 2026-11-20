/* Precipitation type per hour for the Hour by hour charts and the TV image (event-hourly-charts.js). Synthetic hours. */
"use strict";
const assert = require("assert"), E = require("../assets/event-hourly-charts.js");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const h = (pop, qpf, sn, state = "ok") => ({ state, pop, qpf, sn });
const k = (hrs, nws) => E.precipTypes(hrs, nws).map((t) => t.kind);
eq(k([h(80, 0.05, 0), h(80, 0.05, 0.175), h(80, 0.05, 0.35)]), ["rain", "mix", "snow"], "snow fraction sn/(7 qpf): 0 rain, 0.5 mix, 1 snow");
eq(k([h(80, 0.05, 0.06), h(80, 0.05, 0.29)]), ["rain", "snow"], "<= 20% snow is rain, >= 80% is snow");
eq(k([h(10, 0, 0), h(40, 0, 0)]), ["dry", "uncertain"], "dry; a 40% chance with no amount and no NWS wording: type uncertain");
eq(k([h(40, 0, 0)], ["snow"]), ["snow"], "no amount: NWS wording gives the type");
eq(k([h(80, 0.05, 0.35)], ["rain"]), ["uncertain"], "blend snow vs NWS rain: uncertain");
eq(E.precipTypes([h(80, 0.05, 0)], ["freezing"]).map((t) => [t.kind, t.word]), [["uncertain", "Type uncertain"]], "blend rain vs NWS freezing rain: uncertain");
eq(E.precipTypes([h(40, 0, 0)], ["freezing"]).map((t) => [t.kind, t.word]), [["mix", "Freezing rain"]], "freezing rain is mix, named");
eq(k([h(null, null, null, "nodata"), h(null, 0, 0), h(null, 0.02, 0)]), ["missing", "missing", "rain"], "no guidance, or no chance and no amount: missing (not dry); a measurable amount still has a type");
eq(E.typeSummary(E.precipTypes([h(null, 0, 0), h(null, 0, 0)])).text, "No precipitation data", "all hours missing: says no data, not 'no precipitation'");
eq(E.typeSummary(E.precipTypes([h(10, 0, 0)])).text, "No precipitation expected", "dry hours: no precipitation expected");
eq(E.typeSummary(E.precipTypes([h(80, 0.05, 0), h(10, 0, 0)])).mode, "rain", "all wet hours rain: 'Type: rain'");
eq(E.typeSummary(E.precipTypes([h(80, 0.05, 0), h(80, 0.05, 0.35)])).mode, "bands", "a change of type: bands");
console.log(`ok - ${n} hourly chart type checks passed`);
