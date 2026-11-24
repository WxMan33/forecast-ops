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

/* Event dashboard ("At a glance", dashModel): tiles from V.totals and the hourly gusts, coloured only where the hourly
   rows already carry a concern, and window rows from those concern hours. Synthetic view; times in America/New_York. */
{
  const H = 3600e3, t0 = Date.parse("2026-11-25T11:00:00Z"), n0 = n; // 6 AM EST
  const view = ({ gusts = [12, 14, 18, 16, 15, 13], rain = [null, "Likely", "Likely", "Plan", null, null], wind = null, light = null, temp = 50, totals = {} } = {}) => {
    const span = Array.from({ length: 6 }, (_, i) => t0 + i * H);
    const cells = (words, tierOf) => words.map((w) => (w ? { state: "concern", tier: tierOf[w], text: w } : { state: "clear", text: "–" }));
    const LV = { Watch: "monitor", Plan: "prepare", Likely: "action" }, LT = { Moderate: "monitor", High: "action" };
    const rows = [{ key: "phase", cells: [] }, { key: "hz-rain", label: "☂ Rain", cells: cells(rain, LV) }];
    if (wind) rows.push({ key: "hz-wind", label: "≋ Wind", cells: cells(wind, LV) });
    rows.push({ key: "lightning", label: "ϟ Lightning", cells: cells(light || Array(6).fill(null), LT) });
    return { span, hrs: span.map((ms, i) => ({ state: "ok", ms, gust: gusts[i], temp, qpf: 0.1, sn: 0 })),
      axis: span.map((ms, i) => ({ ms, date: "2026-11-25", hourText: `${6 + i} AM` })),
      cover: span.map((ms, i) => [{ key: i < 2 ? "setup" : "event", label: i < 2 ? "Setup" : "Event", from: 0, to: i === 5 ? 30 : 60 }]),
      rows, totals: { hours: 6, gap: 0, qpf: 1.28, qpfR: [0.95, 1.59], sn: 0, snR: [0, 0], peakQ: { v: 0.11, ms: t0 + 4 * H }, peakSn: null, types: ["rain", "mix", "rain"], ...totals } };
  };
  const M = E.dashModel(view(), { tz: "America/New_York", gustLimit: 25 }), tile = (m, k) => m.tiles.find((t) => t.key === k);
  eq([tile(M, "rain").value, tile(M, "rain").sub[0], tile(M, "rain").flag.tier, tile(M, "rain").flag.word], ["1.28", "Models 0.95–1.59 in", "action", "Likely disruptive"], "rain total tile: value, spread across sources, the concern's tier and full level word");
  eq([tile(M, "rate").value, tile(M, "rate").unit, tile(M, "rate").sub[0]], ["0.11", "in/hr", "Around 10 AM"], "heaviest rain tile: the heaviest hour's amount and when");
  eq([!!tile(M, "gust"), M.gustLine.state, M.gustLine.text], [false, "clear", "Gusts up to 18 mph · below your 25 mph limit, not a concern"], "gusts not flagged: no tile, one muted line with the peak");
  eq([!!tile(M, "snow"), !!tile(M, "lightning")], [false, false], "no snow tile when not wintry; no lightning tile when lightning is not flagged");
  eq(M.flags.map((f) => [f.key, f.tier, f.word, f.hours, f.runs.map((r) => r.parts.map((p) => p.tier).join("+"))]), [["rain", "action", "Likely disruptive", "7 AM–10 AM", ["action+prepare"]]], "window row: the concern hours as one run, coloured by level");
  eq(M.types, ["rain", "mix", "rain"], "precipitation type sequence");
  const W = E.dashModel(view({ gusts: [20, 27, 31, 22, 18, 16], wind: [null, "Watch", "Watch", null, null, "Watch"], light: [null, null, "Moderate", "High", null, null] }), { tz: "America/New_York", gustLimit: 25 });
  eq([tile(W, "gust").value, tile(W, "gust").sub[0], tile(W, "gust").flag.word, W.gustLine], ["31", "Around 8 AM · your limit 25 mph", "Watch", null], "gusts flagged: a full tile with the highest hourly gust and when");
  eq(W.flags.find((f) => f.key === "wind").hours, "7 AM–9 AM, 11 AM–11:30 AM", "two separate gust windows; the last ends where the event ends (11:30)");
  eq([tile(W, "lightning").value, tile(W, "lightning").flag.tier, W.flags.find((f) => f.key === "lightning").hours], ["High", "action", "8 AM–10 AM"], "lightning flagged: a tile with the peak level word");
  const Lo = E.dashModel(view({ gusts: [20, 27, 22, 18, 16, 15] }), { tz: "America/New_York", gustLimit: 25 });
  eq([!!tile(Lo, "gust"), Lo.gustLine.state], [false, "low"], "gusts reach the limit but the plan rates wind low: still a line, not a tile (no new threshold)");
  const S = E.dashModel(view({ temp: 33, totals: { sn: 0.3, snR: [0, 0.8], peakSn: { v: 0.2, ms: t0 + 3 * H } } }), { tz: "America/New_York" });
  eq([tile(S, "snow").value, tile(S, "snow").sub], ["0.3", ["Models 0.0–0.8 in · 7:1, before melting", "Heaviest 0.2 in/hr around 9 AM"]], "wintry: snow tile with spread, 7:1 note and heaviest hour");
  eq(E.wintry(view({ temp: 34 })), true, "wintry also when precipitation falls at 35°F or colder (the winter read's test)");
  const Q = E.dashModel(view({ rain: Array(6).fill(null), totals: { qpf: null, peakQ: null, types: [] } }), { tz: "America/New_York" });
  eq([Q.flags.length, tile(Q, "rain").value, tile(Q, "rain").sub[0], !!tile(Q, "rate")], [0, null, "No data (not zero)", false], "nothing flagged; a missing total is no data, not 0");
  const html = E.dashboardHtml(view({ rain: Array(6).fill(null) }), E.dashModel(view({ rain: Array(6).fill(null) }), { tz: "America/New_York" }), { tz: "America/New_York" });
  eq(/No weather concerns flagged for your event window/.test(html) && !/evd-seg/.test(html), true, "no concern: the calm line and no window rows");
  console.log(`ok - ${n - n0} dashboard checks`);
}
