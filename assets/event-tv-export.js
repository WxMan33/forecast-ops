/* Event Manager: "Export hourly image": a 1920 x 1080 PNG for TV rotations that show images.
   Header: event, venue and local time, then sunrise and sunset at the venue ("Sunrise 7:33 AM · Sunset 5:17 PM EST",
   the same line as Hour by hour; the schedule note after it only when both fit), the briefing's one-line takeaway, and
   when the forecast was updated. The four panels keep the same size and position with or without the daylight line.
   Below: four large panels in a 2 x 2 grid on one shared hour axis:
     precipitation chance (line + dot per hour, 0-100%, labelled type bands when the type changes),
     temperature (coral; dashed feels like), wind & gusts (teal; dashed gusts; dotted venue limit),
     lightning potential ("Low throughout" when every hour is covered and Low; otherwise Low / Moderate / High blocks).
   Missing guidance is labelled "No data", never drawn as zero. Values, flags and types come from the same view the
   page shows (HourlyViews rows, EventHourlyCharts.precipTypes); nothing is recomputed here.
   Drawn with the canvas 2D API so the page's own fonts are used and the PNG is exactly 1920 x 1080. */
(function (root) {
  "use strict";
  const W = 1920, HGT = 1080, fin = Number.isFinite, MAX_HOURS = 24;
  /* two palettes; the layout and every value are the same in both. Dark: a solid background for TVs, brighter lines,
     stronger type tints, and lightning blocks that brighten with the level. */
  const PALETTES = {
    light: { name: "light", bg: "#ffffff", text: "#0f172a", muted: "#475569", rule: "#d7dde5", ruleSoft: "#eef1f5", panel: "#f8fafc", border: "#cbd5e1",
      pop: "#0b4f78", temp: "#d4553b", wind: "#127a6c", limit: "#334155", red: "#c62828", sel: "#0b6bcb", dotRing: "#ffffff", lowThroughout: "#3b2a7a",
      band: { rain: "#3aa757", mix: "#e25ca4", snow: "#3b82f6" }, bandAlpha: 0.18, tier: ["", "#c9bfe6", "#9b87d6", "#5b3fb0"], tierText: ["", "#1e1b4b", "#1e1b4b", "#ffffff"], gap: "#e2e8f0" },
    dark: { name: "dark", bg: "#0a0f1a", text: "#f1f5f9", muted: "#aab6c8", rule: "#2b3850", ruleSoft: "#1d2840", panel: "#111a2b", border: "#2e3c56",
      pop: "#8fd6ff", temp: "#ff8f75", wind: "#45d6c2", limit: "#d5dde8", red: "#ff6b6b", sel: "#7cc4ff", dotRing: "#111a2b", lowThroughout: "#c9bbff",
      band: { rain: "#4cc76c", mix: "#f06fb5", snow: "#5b9dff" }, bandAlpha: 0.3, tier: ["", "#4a427e", "#7262cc", "#c9bbff"], tierText: ["", "#ffffff", "#ffffff", "#1e1b4b"], gap: "#27334a" },
  };
  let C = PALETTES.light;
  const FONT = (w, px) => `${w} ${px}px Archivo, "Segoe UI", system-ui, sans-serif`;
  const SYM = { rain: "☂", mix: "✱", snow: "❄" };

  /* the hours to show: the event's hours, at most 24 */
  function hoursOf(V) { const n = Math.min(V.span.length, MAX_HOURS); return { ids: V.span.slice(0, n).map((_, i) => i), total: V.span.length, cut: V.span.length > n }; }
  /* lightning summary: "Low throughout" only when every shown hour is covered and Low */
  function lightningSummary(V, ids) {
    const cells = ids.map((i) => (V.rows.find((r) => r.key === "lightning") || { cells: [] }).cells[i]);
    const lv = cells.map((c) => (!c || c.state === "missing" ? null : { Low: 1, Moderate: 2, High: 3 }[c.text] ?? null));
    ids.forEach((i, k) => { if (!V.hrs[i] || V.hrs[i].state !== "ok") lv[k] = null; });
    return { levels: lv, allLow: lv.length > 0 && lv.every((v) => v === 1) };
  }

  function draw(canvas, d) {
    C = PALETTES[d.theme === "dark" ? "dark" : "light"];
    canvas.width = W; canvas.height = HGT;
    const g = canvas.getContext("2d"), V = d.view, { ids, total, cut } = hoursOf(V), rows = Object.fromEntries(V.rows.map((r) => [r.key, r]));
    const types = root.EventHourlyCharts.precipTypes(V.hrs, d.nwsTypes || []), tsum = root.EventHourlyCharts.typeSummary(ids.map((i) => types[i]));
    g.fillStyle = C.bg; g.fillRect(0, 0, W, HGT);
    let minFont = Infinity; // smallest text drawn, for the readability check
    const text = (s, x, y, { font = FONT(500, 24), color = C.text, align = "left", base = "alphabetic", max } = {}) => { if (String(s).trim()) minFont = Math.min(minFont, +font.match(/(\d+)px/)[1]); g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; if (max) { let t = String(s); while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2); if (t !== String(s)) t = t.trimEnd() + "…"; g.fillText(t, x, y); return; } g.fillText(String(s), x, y); };
    /* ---- header ---- */
    const PAD = 56;
    /* with a daylight line, the left column tightens (title 78, details 120, daylight 160, takeaway 202); the rule at
       214 and the four panels below stay exactly where they are */
    const dlLine = d.daylightLine || "", Y = dlLine ? { title: 78, details: 120, day: 160, take: 202 } : { title: 84, details: 132, take: 190 };
    text(d.title, PAD, Y.title, { font: FONT(800, 56), max: 1260 });
    text([d.venue, d.when].filter(Boolean).join("  ·  "), PAD, Y.details, { font: FONT(500, 30), color: C.muted, max: 1260 });
    const widthOf = (t, f) => { g.font = f; return g.measureText(t).width; };
    let daylightAt = "none";
    if (dlLine) {
      /* the sunrise / sunset line, readable across a room; the schedule note follows it only when both fit in the column */
      const withNote = d.daylight ? `${dlLine}  ·  ${d.daylight}` : "", dlFont = FONT(700, 30);
      const shown = withNote && widthOf(withNote, dlFont) <= 1260 ? withNote : dlLine;
      text(shown, PAD, Y.day, { font: dlFont, color: C.text, max: 1260 }); daylightAt = shown === withNote ? "line+note" : "line";
    }
    text(d.takeaway || "", PAD, Y.take, { font: FONT(700, 36), max: W - 2 * PAD });
    text("Forecast updated", W - PAD, 70, { font: FONT(500, 24), color: C.muted, align: "right" });
    text(d.updated || "Unavailable", W - PAD, 108, { font: FONT(700, 32), align: "right" });
    text("Model guidance · not an official forecast", W - PAD, 140, { font: FONT(500, 20), color: C.muted, align: "right" });
    g.fillStyle = C.rule; g.fillRect(PAD, 214, W - 2 * PAD, 2);
    /* ---- 2 x 2 panels ---- */
    const top0 = 236, gap = 24, pw = (W - 2 * PAD - gap) / 2, ph = (HGT - top0 - 58 - gap) / 2;
    const panels = [["pop", 0, 0], ["temp", 1, 0], ["wind", 0, 1], ["lightning", 1, 1]];
    panels.forEach(([k, cx, cy]) => panel(k, PAD + cx * (pw + gap), top0 + cy * (ph + gap), pw, ph));
    /* ---- footer ---- */
    const foot = `${cut ? `First ${ids.length} of ${total} event hours · ` : ""}${V.custom ? "Chance, rain and gusts: the hour ending at each time · " : ""}Times are the venue's local time${d.zone ? ` (${d.zone})` : ""} · Forecast Ops · NOAA/NWS and Open-Meteo guidance`;
    text(foot, PAD, HGT - 22, { font: FONT(500, 20), color: C.muted });
    canvas.daylight = daylightAt;
    canvas.theme = C.name; canvas.minFontPx = minFont; canvas.lightning = lightningSummary(V, ids).allLow ? "low-throughout" : "blocks"; canvas.typeMode = tsum.mode;
    return canvas;

    function panel(key, x, y, w, h) {
      g.fillStyle = C.panel; g.strokeStyle = C.border; g.lineWidth = 2; roundRect(x, y, w, h, 14); g.fill(); g.stroke();
      const title = { pop: "Precipitation chance", temp: "Temperature", wind: "Wind & gusts", lightning: "Lightning potential" }[key];
      text(title, x + 24, y + 46, { font: FONT(800, 32) });
      const hz = { pop: "hz-rain", wind: "hz-wind" }[key], flagged = hz && rows[hz] && ids.some((i) => rows[hz].cells[i] && rows[hz].cells[i].state === "concern");
      const L = x + 84, R = x + w - 24, T = y + (flagged ? 150 : 116), B = y + h - 62, n = ids.length, bw = (R - L) / n, X = (j) => L + (j + 0.5) * bw;
      /* hour labels: every hour when they fit at 24 px, otherwise every 2nd or 3rd */
      const hourLabels = () => { g.font = FONT(700, 24); const wide = Math.max(...ids.map((i) => g.measureText(V.axis[i].hourText).width)), every = Math.max(1, Math.ceil((wide + 14) / bw));
        ids.forEach((i, j) => { if (j % every) return; text(V.axis[i].hourText, X(j), B + 36, { font: FONT(700, 24), align: "center" }); }); };
      const missing = (i) => !V.hrs[i] || V.hrs[i].state !== "ok";
      const gaps = (val) => ids.forEach((i, j) => { if (val(i) != null) return; g.fillStyle = C.gap; g.fillRect(L + j * bw + 2, T, bw - 4, B - T); text(bw >= 70 ? "No data" : "", X(j), (T + B) / 2 + 8, { font: FONT(700, 20), color: C.muted, align: "center" }); });
      const grid = (lo, hi, ticks, fmt) => ticks.forEach((v) => { const yy = B - ((v - lo) / (hi - lo)) * (B - T); g.strokeStyle = C.rule; g.lineWidth = 1.5; line(L, yy, R, yy); text(fmt(v), L - 12, yy + 8, { font: FONT(600, 22), color: C.muted, align: "right" }); });
      const series = (vals, lo, hi, color, { dash = false, width = 5, dots = false } = {}) => { const yy = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
        g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash ? [16, 10] : []); g.lineJoin = "round"; g.lineCap = "round"; let open = false; g.beginPath();
        vals.forEach((v, j) => { if (v == null) { open = false; return; } if (open) g.lineTo(X(j), yy(v)); else g.moveTo(X(j), yy(v)); open = true; }); g.stroke(); g.setLineDash([]);
        if (dots) vals.forEach((v, j) => { if (v == null) return; g.beginPath(); g.arc(X(j), yy(v), 9, 0, 2 * Math.PI); g.fillStyle = color; g.fill(); g.lineWidth = 3; g.strokeStyle = C.dotRing; g.stroke(); }); };
      const keyItems = (items) => { let kx = x + 24; items.forEach(([kind, color, label]) => { const ky = y + 84;
        if (kind === "line" || kind === "dash" || kind === "dot") { g.strokeStyle = color; g.lineWidth = kind === "dot" ? 3 : 5; g.setLineDash(kind === "dash" ? [12, 8] : kind === "dot" ? [3, 6] : []); line(kx, ky - 8, kx + 40, ky - 8); g.setLineDash([]); kx += 50; }
        else if (kind === "box") { g.globalAlpha = 0.35; g.fillStyle = color; g.fillRect(kx, ky - 22, 26, 26); g.globalAlpha = 1; kx += 34; }
        else if (kind === "solid") { g.fillStyle = color; g.fillRect(kx, ky - 22, 26, 26); kx += 34; }
        else if (kind === "gap") { g.fillStyle = C.gap; g.fillRect(kx, ky - 22, 26, 26); kx += 34; }
        else if (kind === "between") { g.globalAlpha = 0.5; g.fillStyle = C.muted; g.fillRect(kx, ky - 22, 26, 26); g.globalAlpha = 1; kx += 34; }
        g.font = FONT(600, 22); text(label, kx, ky, { font: FONT(600, 22), color: C.muted }); kx += g.measureText(label).width + 26; }); };
      /* planner-defined slots (as the page shows them): hours between slots shaded in the panels of hour-ending values
         (precipitation chance and gusts) and labelled, and the
         slot names along the top of the precipitation panel over the hours they cover (rain, chance and gusts there are
         for the hour ending at each time) */
      const phaseRow = rows.phase, between = (i) => !!(V.custom && phaseRow && phaseRow.cells[i] && phaseRow.cells[i].text === "Between slots");
      const schedule = (withNames) => { if (!V.custom) return; let run = null; const out = [];
        ids.forEach((i, j) => { const k = between(i) ? "|gap" : V.cover && V.cover[i] && V.cover[i].length ? V.cover[i].reduce((a, c) => (c.fraction > a.fraction ? c : a)).label : null;
          if (k && run && run.k === k && run.b === j - 1) run.b = j; else { if (run) out.push(run); run = k ? { k, a: j, b: j } : null; } }); if (run) out.push(run);
        out.forEach((r) => { const x0 = L + r.a * bw, wd = (r.b - r.a + 1) * bw;
          if (r.k === "|gap") { g.globalAlpha = C.name === "dark" ? 0.22 : 0.14; g.fillStyle = C.muted; g.fillRect(x0 + 1, T, wd - 2, B - T); g.globalAlpha = 1;
            if (withNames) { g.font = FONT(700, 20); const t = g.measureText("Between slots").width + 10 <= wd ? "Between slots" : "Gap"; text(g.measureText(t).width + 6 <= wd ? t : "", x0 + wd / 2, T + 26, { font: FONT(700, 20), color: C.muted, align: "center" }); } return; }
          if (!withNames) return; g.strokeStyle = C.border; g.lineWidth = 2; line(x0, T, x0, T + 34);
          g.font = FONT(700, 20); text(r.k, x0 + 8, T + 26, { font: FONT(700, 20), color: C.muted, max: Math.max(40, wd - 12) }); }); };
      const flags = (hz, word) => { const r = rows[hz]; if (!r) return; let run = null; const out = [];
        ids.forEach((i, j) => { const c = r.cells[i], k = c && c.state === "concern" ? `${c.tier}|${c.text}` : null; if (k && run && run.k === k && run.b === j - 1) run.b = j; else { if (run) out.push(run); run = k ? { k, a: j, b: j } : null; } }); if (run) out.push(run);
        out.forEach((f) => { const [tier, wd] = f.k.split("|"), x0 = L + f.a * bw + 4, x1 = L + (f.b + 1) * bw - 4, col = tier === "action" ? C.red : C.text; g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, T - 6); g.lineTo(x0, T - 16); g.lineTo(x1, T - 16); g.lineTo(x1, T - 6); g.stroke();
          text(`${word}: ${wd}`, x0, T - 24, { font: FONT(800, 22), color: col, max: Math.max(80, x1 - x0) }); }); };

      if (key === "pop") {
        keyItems([["line", C.pop, V.custom ? "Chance, hour ending at each time" : "Chance each hour"], ...(tsum.mode === "bands" ? [["box", C.band.rain, "☂ Rain"], ["box", C.band.mix, "✱ Mix"], ["box", C.band.snow, "❄ Snow"]] : []), ["gap", null, "No data"], ...(V.custom && ids.some(between) ? [["between", null, "Between slots"]] : [])]);
        if (tsum.mode !== "bands") text(tsum.text, R, y + 46, { font: FONT(700, 26), align: "right", color: C.text });
        if (tsum.mode === "bands") { let run = null; const out = []; ids.forEach((i, j) => { const t = types[i], k = ["dry", "missing"].includes(t.kind) ? null : `${t.kind}|${t.word}`; if (k && run && run.k === k && run.b === j - 1) run.b = j; else { if (run) out.push(run); run = k ? { k, a: j, b: j } : null; } }); if (run) out.push(run);
          out.forEach((r) => { const [kind, word] = r.k.split("|"), x0 = L + r.a * bw, wd = (r.b - r.a + 1) * bw; if (C.band[kind]) { g.globalAlpha = C.bandAlpha; g.fillStyle = C.band[kind]; g.fillRect(x0, T, wd, B - T); g.globalAlpha = 1; }
            const label = C.band[kind] ? `${SYM[kind]} ${word}` : `? ${word}`; g.font = FONT(800, 24); text(g.measureText(label).width + 12 <= wd ? label : C.band[kind] ? SYM[kind] : "?", x0 + 8, B - 12, { font: FONT(800, 24), color: C.band[kind] ? C.text : C.muted }); }); }
        grid(0, 100, [0, 50, 100], (v) => `${v}%`); schedule(true);
        const vals = ids.map((i) => (missing(i) || !fin(V.hrs[i].pop) ? null : V.hrs[i].pop)); gaps((i) => vals[ids.indexOf(i)]);
        flags("hz-rain", "Precip"); series(vals, 0, 100, C.pop, { dots: true });
      } else if (key === "temp" || key === "wind") {
        const a = key === "temp" ? "temp" : "wind", b2 = key === "temp" ? "feel" : "gust", color = key === "temp" ? C.temp : C.wind;
        const v1 = ids.map((i) => (missing(i) || !fin(V.hrs[i][a]) ? null : V.hrs[i][a])), v2 = ids.map((i) => (missing(i) || !fin(V.hrs[i][b2]) ? null : V.hrs[i][b2]));
        const all = [...v1, ...v2].filter(fin), lim = key === "wind" ? d.gustLimit : null;
        let lo = key === "temp" ? Math.floor((Math.min(...all) - 3) / 5) * 5 : 0, hi = key === "temp" ? Math.ceil((Math.max(...all) + 3) / 5) * 5 : Math.ceil(Math.max(10, ...all, lim || 0) / 10) * 10; if (!all.length) { lo = 0; hi = 10; } if (hi <= lo) hi = lo + 10;
        keyItems(key === "temp" ? [["line", color, "Temperature °F"], ["dash", color, "Feels like"]] : [["line", color, "Sustained mph"], ["dash", color, "Gusts"], ["dot", C.limit, "Venue gust limit"]]);
        const sel = (i) => i; grid(lo, hi, [lo, (lo + hi) / 2, hi], (v) => `${Math.round(v)}`); if (key === "wind") schedule(false); // gusts are hour-ending values; temperature is read at its time gaps((i) => v1[ids.indexOf(sel(i))]);
        if (lim && lim <= hi) { const yy = B - ((lim - lo) / (hi - lo)) * (B - T); g.strokeStyle = C.limit; g.lineWidth = 3; g.setLineDash([3, 7]); line(L, yy, R, yy); g.setLineDash([]); text(`${lim} mph limit`, R - 6, yy - 10, { font: FONT(700, 22), color: C.limit, align: "right" }); }
        if (key === "wind") flags("hz-wind", "Wind");
        series(v2, lo, hi, color, { dash: true, width: 4 }); series(v1, lo, hi, color, { width: 6 });
        /* the shown range's high and low, labelled, so the panel reads at a glance */
        /* the high (and, for temperature, the low) labelled inside the plot */
        const lab = (vals, pick) => { let best = -1; vals.forEach((v, j) => { if (v != null && (best < 0 || (pick === "max" ? v > vals[best] : v < vals[best]))) best = j; }); if (best < 0) return; const yy = B - ((vals[best] - lo) / (hi - lo)) * (B - T);
          /* above a high / below a low; beside the point when that would leave the plot; a panel-coloured halo keeps it
             readable over the other line */
          let tx = X(best), ty = pick === "max" ? yy - 18 : yy + 36, align = "center";
          if (ty < T + 22 || ty > B - 4) { const right = tx > (L + R) / 2; tx += right ? -18 : 18; align = right ? "right" : "left"; ty = yy + 9; }
          else tx = Math.min(R - 34, Math.max(L + 34, tx));
          const label = `${Math.round(vals[best])}${key === "temp" ? "°" : " mph"}`; g.font = FONT(800, 26); g.textAlign = align; g.lineJoin = "round"; g.lineWidth = 8; g.strokeStyle = C.panel; g.strokeText(label, tx, ty);
          text(label, tx, ty, { font: FONT(800, 26), color, align }); };
        const real = v1.filter((v) => v != null); lab(v1, "max"); if (key === "temp" && real.length && Math.round(Math.min(...real)) !== Math.round(Math.max(...real))) lab(v1, "min");
      } else {
        const { levels, allLow } = lightningSummary(V, ids);
        text("Forecast potential, not detected lightning or a warning", R, y + 46, { font: FONT(600, 20), color: C.muted, align: "right" });
        if (allLow) {
          text("Low throughout", x + w / 2, (T + B) / 2 + 10, { font: FONT(800, 64), align: "center", color: C.lowThroughout });
          text("Low is not zero · every event hour covered", x + w / 2, (T + B) / 2 + 60, { font: FONT(600, 26), color: C.muted, align: "center" });
          return;
        } else {
          keyItems([["solid", C.tier[1], "Low"], ["solid", C.tier[2], "Moderate"], ["solid", C.tier[3], "High"], ["gap", null, "No data"]]);
          const yy = (v) => B - (v / 3) * (B - T);
          [1, 2, 3].forEach((v) => { g.strokeStyle = C.ruleSoft; g.lineWidth = 1.5; line(L, yy(v), R, yy(v)); text(["", "Low", "Mod", "High"][v], L - 12, yy(v) + 8, { font: FONT(600, 22), color: C.muted, align: "right" }); });
          levels.forEach((v, j) => { if (v == null) { g.fillStyle = C.gap; g.fillRect(L + j * bw + 2, T, bw - 4, B - T); text(bw >= 70 ? "No data" : "", X(j), (T + B) / 2 + 8, { font: FONT(700, 20), color: C.muted, align: "center" }); return; }
            g.fillStyle = C.tier[v]; roundRect(X(j) - bw * 0.36, yy(v), bw * 0.72, B - yy(v), 4); g.fill(); text(bw >= 80 ? ["", "Low", "Mod", "High"][v] : ["", "L", "M", "H"][v], X(j), B - 12, { font: FONT(800, 20), color: C.tierText[v], align: "center" }); });
        }
      }
      hourLabels();
    }
    function line(a, b, c, e) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, e); g.stroke(); }
    function roundRect(a, b, c, e, r) { g.beginPath(); g.moveTo(a + r, b); g.arcTo(a + c, b, a + c, b + e, r); g.arcTo(a + c, b + e, a, b + e, r); g.arcTo(a, b + e, a, b, r); g.arcTo(a, b, a + c, b, r); g.closePath(); }
  }

  /* draw and download; returns the PNG blob */
  async function exportPng(d) {
    if (root.document.fonts && root.document.fonts.ready) { try { await root.document.fonts.load(FONT(800, 56)); await root.document.fonts.ready; } catch (e) { /* system font fallback */ } }
    const canvas = draw(root.document.createElement("canvas"), d);
    const blob = await new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("This browser could not make the image."))), "image/png"));
    const a = root.document.createElement("a"), safe = String(d.title || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";
    a.href = URL.createObjectURL(blob); a.download = `${safe}-hourly-${d.theme === "dark" ? "dark" : "light"}-1920x1080${d.stamp ? "-" + d.stamp : ""}.png`; root.document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
    return { blob, canvas, name: a.download };
  }
  const api = { draw, exportPng, lightningSummary, hoursOf, PALETTES, W, H: HGT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventTvExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
