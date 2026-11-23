/* Weather threats, aviation: NOAA NCEP In-Flight Icing (IFI), model guidance. Pure; uses ThreatsGTG's GRIB2 decoder and
   Lambert projection (same 3 km CONUS grid). Shared by the map and the Node tests.

   Source: NCEP Domestic Aviation Forecast System (DAFS), dafs.tCCz.ifi.3km.conus.fFFF.grib2 on NOMADS: hourly cycles, forecast
   hours 1-18 (no analysis hour), 180 records = 60 heights x 3 fields. Heights: 152.4 m (500 ft) to 9,144 m (30,000 ft) above
   MSL every 500 ft. Fields, as NCEP's GRIB2 tables name them (grib2_table4-2-0-19):
     prob  0/19/233 ICPRB "Icing probability", non-dim (0-1 in steps of 0.01). Bitmap: no value below the ground.
     sev   0/19/37  ICESEV "Icing Severity", Table 4.228: 0 None, 1 Trace, 2 Light, 3 Moderate, 4 Severe, 255 Missing. No
           bitmap: cells below the ground carry 0 ("None"), so the map takes the ground mask from the probability record of the
           same height and hour, and never reads a below-ground cell as "None".
     (not drawn) 0/19/217 SIPD "Supercooled Large Droplet (SLD) Icing", which NCEP's table gives in Table 4.207 codes, but the
           files hold -0.1 and 0 to 1 in steps of 0.1; -0.1 is not defined in the tables, so the field is left out. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./threats-gtg.js"));
  else root.ThreatsIFI = factory(root.ThreatsGTG);
})(typeof globalThis !== "undefined" ? globalThis : this, function (G) {
  "use strict";
  const HEIGHTS = Array.from({ length: 60 }, (_, k) => ({ ft: (k + 1) * 500, m: Math.round((k + 1) * 500 * 0.3048 * 10) / 10 }));
  const FIELDS = {
    prob: { label: "Icing probability", grib: "GRIB2 0/19/233 (ICPRB)", unit: "non-dimensional, 0–1", category: 19, number: 233 },
    sev: { label: "Icing severity", grib: "GRIB2 0/19/37 (ICESEV), NCEP Table 4.228", unit: "category", category: 19, number: 37 },
  };
  const SEV_WORD = ["none", "trace", "light", "moderate", "severe"];
  /* modeled icing is drawn in cyan-to-teal fills, apart from turbulence guidance (violet), icing advisories (blue outlines) and
     pilot reports (dots and rings) */
  const PROB_BINS = [[0.05, "5–20%"], [0.2, "20–40%"], [0.4, "40–60%"], [0.6, "60% or more"]];
  const PROB_COLORS = [[207, 250, 254, 110], [103, 232, 249, 150], [8, 145, 178, 190], [22, 78, 99, 225]];
  const SEV_COLORS = { 1: [207, 250, 254, 110], 2: [103, 232, 249, 150], 3: [8, 145, 178, 195], 4: [22, 78, 99, 230] };
  const probBin = (v) => { let b = -1; for (let i = 0; i < PROB_BINS.length; i++) if (v >= PROB_BINS[i][0]) b = i; return b; };
  const sevCode = (v) => (Number.isFinite(v) && v >= 0 && v <= 4 && Math.round(v) === v ? v : v === 255 ? null : NaN);
  function check(dec, field, ft, fh) {
    const f = FIELDS[field], h = HEIGHTS.find((x) => x.ft === ft);
    if (!f || !h) throw Error("unknown IFI field or height");
    if (dec.product.category !== f.category || dec.product.number !== f.number) throw Error("expected " + f.grib + ", got 0/" + dec.product.category + "/" + dec.product.number);
    if (Math.abs(dec.product.level - h.m) > 0.05) throw Error("expected " + h.m + " m, got " + dec.product.level + " m");
    if (fh != null && dec.product.forecast !== fh) throw Error("expected +" + fh + " h, got +" + dec.product.forecast + " h");
    return true;
  }
  /* the value at a spot: probability as published (0-1); severity as its Table 4.228 word, masked where the probability record
     has no value (below the ground) */
  function valueAt(dec, field, lon, lat, mask, P) {
    const v = G.valueAt(dec, lon, lat, P); if (!v.inside) return { inside: false };
    if (field === "prob") return { inside: true, i: v.i, j: v.j, value: v.value, text: v.value == null ? "no value (below the ground)" : "icing probability " + v.value.toFixed(2) };
    const m = mask ? mask.field[v.j * dec.grid.nx + v.i] : 0; if (!Number.isFinite(m)) return { inside: true, i: v.i, j: v.j, value: null, text: "no value (below the ground)" };
    const c = sevCode(v.value); return { inside: true, i: v.i, j: v.j, value: v.value, code: c, text: c == null ? "missing (255)" : Number.isNaN(c) ? "not a Table 4.228 code (" + v.value + ")" : "icing severity " + SEV_WORD[c] + " (code " + c + ")" };
  }
  function render(dec, field, opts = {}) {
    const mask = opts.mask ? opts.mask.field : null;
    return G.renderWith(dec, field === "prob" ? (v) => { const b = probBin(v); return b < 0 ? null : PROB_COLORS[b]; } : (v, k) => { if (mask && !Number.isFinite(mask[k])) return null; const c = sevCode(v); return c >= 1 ? SEV_COLORS[c] : null; }, opts);
  }
  const levelLabel = (ft) => (ft >= 18000 ? "FL" + String(ft / 100).padStart(3, "0") : ft.toLocaleString("en-US") + " ft");
  return { HEIGHTS, FIELDS, SEV_WORD, PROB_BINS, PROB_COLORS, SEV_COLORS, check, valueAt, render, levelLabel, sevCode, TOP_FT: 30000, FIRST_FH: 1, LAST_FH: 18 };
});
