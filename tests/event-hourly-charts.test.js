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

/* TV image palettes (event-tv-export.js): readable from across a room in both themes (WCAG contrast ratios) */
{
  const X = require("../assets/event-tv-export.js"), hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c) => { const [r, g, b] = hex(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (a, b, t) => "#" + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
  for (const P of Object.values(X.PALETTES)) {
    const min = (pairs) => Math.min(...pairs.map(([a, b]) => ratio(a, b)));
    const r = { text: min([[P.text, P.panel], [P.text, P.bg]]), muted: min([[P.muted, P.panel], [P.muted, P.bg], [P.muted, P.gap]]), lines: min([[P.pop, P.panel], [P.temp, P.panel], [P.wind, P.panel], [P.limit, P.panel], [P.red, P.panel]]),
      bands: min(Object.values(P.band).map((c) => [P.text, mix(c, P.panel, P.bandAlpha)])), popOverBands: min(Object.values(P.band).map((c) => [P.pop, mix(c, P.panel, P.bandAlpha)])),
      tiers: min([1, 2, 3].map((v) => [P.tierText[v], P.tier[v]])), tierVsPanel: min([1, 2, 3].map((v) => [P.tier[v], P.panel])) };
    const ok = r.text >= 7 && r.muted >= 4.5 && r.lines >= 3 && r.bands >= 7 && r.popOverBands >= 3 && r.tiers >= 4.5 && r.tierVsPanel >= 1.4;
    assert(ok, `${P.name} palette contrast ${JSON.stringify(r)}`); n++;
    console.log(`  ${P.name}: text ${r.text.toFixed(1)}, muted ${r.muted.toFixed(1)}, lines ${r.lines.toFixed(1)}, band labels ${r.bands.toFixed(1)}, chance line over bands ${r.popOverBands.toFixed(1)}, lightning labels ${r.tiers.toFixed(1)}`);
  }
  console.log(`ok - ${n} checks including TV palette contrast`);
}
