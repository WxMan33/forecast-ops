/* Event Manager "Hour by hour": four aligned charts on one timeline (precipitation chance, temperature, wind & gusts,
   lightning potential). Presentation only: the hourly values, concern tiers and missing hours come unchanged from the
   briefing (HourlyViews / BetaStory); nothing here changes a forecast number.

   Readable from across a room: large hour labels and selected values; each chart explains itself in its own legend.
   - Precipitation chance: a line with a dot at each forecast hour on a fixed 0-100% scale, straight segments (no
     smoothing), broken where guidance is missing. The selected hour's amount is shown separately from the chance.
   - Precipitation type: when the guidance shows a meaningful type change (any mix or snow among the wet hours), lightly
     tinted, directly labelled bands behind the chance line: green rain, pink mix, blue snow, each with its word and
     symbol. Hours where the type is uncertain (blend and NWS disagree) or unknown stay unshaded and are labelled.
     An all-rain event just says "Type: rain".
   - Hours the briefing flags are labelled directly over those hours (no unlabelled wash). Red is used only for the
     briefing's highest level ("Likely disruptive"), and always with its words.
   - Temperature coral (dashed: feels like); wind teal (solid sustained, dashed gusts, dotted venue limit); lightning
     potential as Low / Moderate / High blocks, labelled as forecast potential, not detected lightning or a warning. */
(function (root) {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fin = Number.isFinite, H = 3600e3;
  const windowFor = (axis, selected, count) => { const i = Math.max(0, axis.findIndex((a) => a.ms === selected)); return Math.min(Math.max(0, axis.length - count), Math.max(0, i - Math.floor(count / 2))); };

  /* ---------- precipitation type per hour, from guidance the page already has ----------
     Blend: snowfall vs liquid precipitation in the same hour. Open-Meteo snowfall is 7 cm per 10 mm of water, i.e.
     7 in of snow per inch of liquid, so snowFraction = sn / (7 * qpf): >= 0.8 snow, <= 0.2 rain, otherwise mix.
     NWS hourly weather wording (rain / snow / mix / freezing / sleet), when the page has it, is a second opinion:
     where it disagrees with the blend the hour is "uncertain". Freezing rain and sleet count as mix and are named.
     Returns per hour { kind: "rain" | "mix" | "snow" | "uncertain" | "dry" | "missing", word, why }. */
  const WET_QPF = 0.005, WET_POP = 30;
  function precipTypes(hrs, nws = []) {
    return hrs.map((h, i) => {
      const n = nws[i] || null, nk = n === "snow" ? "snow" : n === "rain" ? "rain" : n ? "mix" : null, nWord = n === "freezing" ? "Freezing rain" : n === "sleet" ? "Sleet" : null;
      if (!h || h.state !== "ok") return { kind: "missing", word: "No data", why: "No guidance for this hour" };
      const wetQ = fin(h.qpf) && h.qpf >= WET_QPF, wetP = fin(h.pop) && h.pop >= WET_POP;
      if (!wetQ && !wetP) return { kind: "dry", word: "", why: "" };
      let mk = null;
      if (wetQ) { const f = fin(h.sn) ? Math.min(1, Math.max(0, h.sn / (7 * h.qpf))) : null; mk = f == null ? null : f >= 0.8 ? "snow" : f <= 0.2 ? "rain" : "mix"; }
      if (mk && nk && mk !== nk) return { kind: "uncertain", word: "Type uncertain", why: `Blend: ${mk}; NWS: ${nWord || n}` };
      const k = mk || nk;
      if (!k) return { kind: "uncertain", word: "Type uncertain", why: "The guidance does not say which type" };
      return { kind: k, word: nWord || { rain: "Rain", mix: "Mix", snow: "Snow" }[k], why: mk && nk ? "Blend and NWS agree" : mk ? "Blend snowfall vs precipitation" : "NWS hourly wording" };
    });
  }
  /* bands are shown only when the type is worth reading: any mix, snow or uncertain hour among the wet hours */
  function typeSummary(types) {
    const wet = types.filter((t) => !["dry", "missing"].includes(t.kind));
    if (!wet.length) return { mode: "none", text: "No precipitation expected" };
    if (wet.every((t) => t.kind === "rain")) return { mode: "rain", text: "Type: rain" };
    return { mode: "bands", text: "Type changes: see the labelled bands" };
  }
  const TYPE = { rain: { sym: "☂", cls: "rain" }, mix: { sym: "✱", cls: "mix" }, snow: { sym: "❄", cls: "snow" } };

  function render(host, { view: V, selected, onSelect, gustLimit = 25, tz, nwsTypes = [] }) {
    let sel = selected, start = 0, width = 0, first = true;
    const rows = Object.fromEntries(V.rows.map((r) => [r.key, r]));
    const types = precipTypes(V.hrs, nwsTypes), tsum = typeSummary(types);
    const specs = [
      { key: "pop", name: "Precipitation chance", unit: "%", color: "rain", type: "dots", hazard: "hz-rain", hazardWord: "Precip", max: 100 },
      { key: "temp", name: "Temperature", unit: "°F", color: "temp", second: "feel", secondLabel: "Feels like" },
      { key: "wind", name: "Wind & gusts", unit: "mph", color: "wind", second: "gust", secondLabel: "Gusts", hazard: "hz-wind", hazardWord: "Wind", limit: gustLimit },
      { key: "lightning", name: "Lightning potential", unit: "", color: "lightning", type: "tier", max: 3 },
    ];
    const text = (key, i) => rows[key]?.cells[i]?.text ?? "—";
    const value = (spec, i) => {
      if (!V.hrs[i] || V.hrs[i].state !== "ok") return null;
      if (spec.type === "tier") { const c = rows.lightning?.cells[i]; return !c || c.state === "missing" ? null : { Low: 1, Moderate: 2, High: 3 }[c.text] ?? null; }
      return fin(V.hrs[i][spec.key]) ? V.hrs[i][spec.key] : null;
    };
    function draw(recenter = false) {
      const phone = host.clientWidth < 600, count = phone ? 6 : 12, w = Math.max(280, host.clientWidth), endMax = Math.max(0, V.axis.length - count);
      if (first || recenter) start = windowFor(V.axis, sel, count);
      start = Math.max(0, Math.min(start, endMax)); first = false; width = w;
      const ids = V.axis.map((_, i) => i).slice(start, start + count), a = V.axis[start], z = V.axis[ids[ids.length - 1]]; if (!a) return;
      const iSel = V.span.indexOf(sel), dayLabel = (d) => new Date(d + "T12:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
      host.innerHTML = `<div class="evc-tools"><div><b>One timeline. Four clear views.</b><span class="bx-note">Choose an hour in any chart to compare the conditions.</span></div><div class="evc-nav"><button class="bx-btn" data-move="-1" aria-label="Earlier forecast hours" ${start === 0 ? "disabled" : ""}>← Earlier</button><button class="bx-btn" data-move="1" aria-label="Later forecast hours" ${start === endMax ? "disabled" : ""}>Later →</button></div></div>` +
        `<p class="evc-window">${esc(root.EventBriefingUI.dateSpan(a.ms, z.ms + H, tz))}</p>` +
        `<p class="evc-selected">Selected <b>${esc(dayLabel(V.axis[iSel]?.date))} · ${esc(V.axis[iSel]?.hourText)} ${esc(V.axis[iSel]?.zone)}</b><span> · ${esc(text("phase", iSel))}</span></p>` +
        `<div class="evc-stack">${specs.map((s) => card(s, ids, w, iSel, phone)).join("")}</div>`;
      host.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => { start = Math.max(0, Math.min(endMax, start + Number(b.dataset.move) * count)); sel = V.span[start]; draw(); onSelect(sel); }));
      host.querySelectorAll("[data-hour]").forEach((g) => { const choose = () => { sel = +g.dataset.hour; draw(); onSelect(sel); }; g.onclick = choose; g.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } }; });
    }
    /* runs of consecutive chart columns with the same key: [{key, a, b}] (column indexes, inclusive) */
    const runs = (keys) => keys.reduce((o, k, j) => { const r = o[o.length - 1]; if (k != null && r && r.key === k && r.b === j - 1) r.b = j; else if (k != null) o.push({ key: k, a: j, b: j }); return o; }, []);
    function card(s, ids, w, iSel, phone) {
      const flags = s.hazard ? ids.map((i) => { const c = rows[s.hazard]?.cells[i]; return c && c.state === "concern" ? `${c.tier}|${c.text}` : null; }) : [];
      const hasFlags = flags.some(Boolean), bands = s.key === "pop" && tsum.mode === "bands";
      const left = phone ? 40 : 46, right = 12, top = hasFlags ? 34 : 14, base = top + (phone ? 104 : 120), height = base + 40, bw = (w - left - right) / ids.length, x = (j) => left + (j + 0.5) * bw;
      let vals = ids.flatMap((i) => [value(s, i), s.second && V.hrs[i]?.state === "ok" ? V.hrs[i][s.second] : null]).filter(fin);
      let lo = s.key === "temp" ? Math.floor((Math.min(...vals) - 3) / 5) * 5 : 0, hi = s.max || (s.key === "temp" ? Math.ceil((Math.max(...vals) + 3) / 5) * 5 : Math.ceil(Math.max(10, ...vals, s.limit || 0) / 10) * 10);
      if (!vals.length) { lo = 0; hi = s.max || 10; } if (hi <= lo) hi = lo + 10;
      const y = (v) => base - ((v - lo) / (hi - lo)) * (base - top);
      let under = "", marks = "", over = "";
      /* precipitation type bands (behind everything), labelled in the band */
      if (bands) runs(ids.map((i) => types[i].kind === "dry" ? null : types[i].kind === "missing" ? null : types[i].kind + "|" + types[i].word)).forEach((r) => {
        const [kind, word] = r.key.split("|"), x0 = left + r.a * bw, wd = (r.b - r.a + 1) * bw, T = TYPE[kind];
        if (T) under += `<rect x="${x0}" y="${top}" width="${wd}" height="${base - top}" class="evc-band evc-band-${T.cls}" data-type="${kind}"/>`;
        const label = T ? `${T.sym} ${word}` : `? ${word}`, fit = wd >= label.length * 7.2 + 8;
        under += `<text x="${x0 + 5}" y="${base - 7}" class="evc-bandlabel${T ? "" : " evc-bandlabel-unc"}" data-type-label="${kind}">${esc(fit ? label : T ? T.sym : "?")}</text>`;
      });
      /* missing hours: a light gap, "No data" when there is room */
      ids.forEach((i, j) => { if (value(s, i) === null) marks += `<rect x="${left + j * bw + 2}" y="${top}" width="${bw - 4}" height="${base - top}" class="evc-gap"/><text x="${x(j)}" y="${(top + base) / 2 + 5}" text-anchor="middle" class="evc-gaptext">${bw >= 58 ? "No data" : "—"}</text>`; });
      /* flagged hours: a labelled bracket over those hours; red only for the highest level */
      runs(flags).forEach((r) => { const [tier, word] = r.key.split("|"), x0 = left + r.a * bw + 3, x1 = left + (r.b + 1) * bw - 3, label = `${s.hazardWord}: ${word}`;
        over += `<g class="evc-flag evc-flag-${tier === "action" ? "high" : "watch"}" data-flag="${esc(tier)}"><path d="M${x0},${top - 6} V${top - 12} H${x1} V${top - 6}"/><text x="${x0}" y="${top - 16}">${esc(x1 - x0 >= label.length * 6.8 ? label : word)}</text></g>`; });
      /* the series */
      if (s.type === "tier") ids.forEach((i, j) => { const v = value(s, i); if (v === null) return;
        const lab = ["", "Low", "Moderate", "High"][v], short = ["", "L", "M", "H"][v];
        marks += `<rect x="${x(j) - bw * 0.36}" y="${y(v)}" width="${bw * 0.72}" height="${base - y(v)}" rx="3" class="evc-tier evc-tier-${v}"/><text x="${x(j)}" y="${base - 7}" text-anchor="middle" class="evc-tiertext">${bw >= 64 ? lab : short}</text>`; });
      const line = (key, secondary) => { let path = "", open = false;
        ids.forEach((i, j) => { const v = key === s.key ? value(s, i) : V.hrs[i]?.state === "ok" && fin(V.hrs[i][key]) ? V.hrs[i][key] : null; if (v === null) { open = false; return; } path += (open ? " L" : " M") + x(j) + "," + y(v); open = true; });
        return `<path d="${path}" class="evc-line${secondary ? " evc-second" : ""}"/>`; };
      if (s.type !== "tier") marks += line(s.key, false) + (s.second ? line(s.second, true) : "");
      if (s.type === "dots") ids.forEach((i, j) => { const v = value(s, i); if (v !== null) marks += `<circle cx="${x(j)}" cy="${y(v)}" r="${V.span[i] === sel ? 6.5 : 4.5}" class="evc-dot${V.span[i] === sel ? " evc-dot-sel" : ""}"/>`; });
      if (s.limit && s.limit <= hi) marks += `<line x1="${left}" x2="${w - right}" y1="${y(s.limit)}" y2="${y(s.limit)}" class="evc-limit"/><text x="${w - right}" y="${y(s.limit) - 6}" text-anchor="end" class="evc-axis evc-limittext">${s.limit} mph venue limit</text>`;
      const ticks = s.type === "tier" ? [1, 2, 3] : s.key === "pop" ? [0, 50, 100] : [lo, (lo + hi) / 2, hi];
      const axes = (s.key === "pop" ? [25, 75].map((v) => `<line x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}" class="evc-rule evc-rule-minor"/>`).join("") : "") +
        ticks.map((v) => `<line x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}" class="evc-rule"/><text x="${left - 7}" y="${y(v) + 5}" text-anchor="end" class="evc-axis">${s.type === "tier" ? ["", "Low", "Mod", "High"][v] : Math.round(v) + (s.unit === "%" ? "%" : "")}</text>`).join("");
      const every = phone ? 1 : bw >= 52 ? 1 : 2;
      const buttons = ids.map((i, j) => { const a = V.axis[i], on = V.span[i] === sel, show = j % every === 0 || on;
        return `<g role="button" tabindex="0" aria-label="${esc(`${a.date} ${a.hourText} ${a.zone}, ${s.name}: ${text(s.key, i)}`)}" aria-pressed="${on}" data-hour="${a.ms}"><rect x="${left + j * bw}" y="${top - 4}" width="${bw}" height="${base - top + 36}" fill="transparent"/>${on ? `<rect x="${left + j * bw + 1}" y="${top}" width="${bw - 2}" height="${base - top}" class="evc-selcol"/>` : ""}${show ? `<text x="${x(j)}" y="${base + 22}" text-anchor="middle" class="evc-hour${on ? " evc-hour-sel" : ""}">${esc(a.hourText)}${a.repeated || a.zoneChange ? `<tspan x="${x(j)}" dy="14" class="evc-zone">${esc(a.zone)}</tspan>` : ""}</text>` : ""}</g>`; }).join("");
      /* the header: the selected hour's value, large; amount separate from chance */
      const amount = s.key === "pop" ? `<span>Amount <b data-amount>${esc(text("qpf", iSel))}${text("qpf", iSel) === "—" ? "" : " in."}</b>${tsum.mode !== "none" && types[iSel] && !["dry"].includes(types[iSel].kind) ? ` · <b data-sel-type>${esc(types[iSel].word || "")}</b>` : ""}</span>` : "";
      const head = s.type === "tier" ? `<b data-value="${s.key}">${esc(text(s.key, iSel))}</b><span>Forecast potential, not detected lightning or a warning</span>`
        : `<b data-value="${s.key}">${esc(text(s.key, iSel))}${s.unit === "°F" ? "F" : s.unit && s.unit !== "%" ? " " + esc(s.unit) : ""}</b>${s.second ? `<span>${esc(s.secondLabel)} <b>${esc(text(s.second, iSel))}${s.unit === "mph" ? " mph" : s.unit === "°F" ? "F" : ""}</b></span>` : amount}`;
      return `<section class="evc-card evc-${s.color}" data-variable="${s.key}"><header><h3>${esc(s.name)}</h3><div class="evc-val">${head}</div></header>${legend(s)}<svg viewBox="0 0 ${w} ${height}" role="group" aria-label="${esc(s.name)} by hour">${under}${axes}${marks}${over}${buttons}</svg></section>`;
    }
    /* each chart's own key */
    function legend(s) {
      const sw = (cls, t) => `<span class="evc-key"><i class="${cls}"></i>${esc(t)}</span>`;
      if (s.key === "pop") return `<p class="evc-legend">${sw("k-line k-dots", "Chance of precipitation each hour (0–100%)")}${tsum.mode === "bands" ? sw("k-band k-rain", "☂ Rain") + sw("k-band k-mix", "✱ Mix") + sw("k-band k-snow", "❄ Snow") + sw("k-band k-unc", "? Type uncertain (unshaded)") : `<span class="evc-key evc-type" data-type-summary="${tsum.mode}">${esc(tsum.text)}</span>`}${sw("k-gap", "No data: guidance missing, not 0%")}</p>`;
      if (s.key === "temp") return `<p class="evc-legend">${sw("k-line", "Temperature")}${sw("k-line k-dash", "Feels like")}</p>`;
      if (s.key === "wind") return `<p class="evc-legend">${sw("k-line", "Sustained wind")}${sw("k-line k-dash", "Gusts")}${sw("k-limit", "Venue gust limit")}</p>`;
      return `<p class="evc-legend">${sw("k-tier k-t1", "Low")}${sw("k-tier k-t2", "Moderate")}${sw("k-tier k-t3", "High")}<span class="evc-key">Low is not zero</span></p>`;
    }
    draw();
    let frame = null;
    const observer = new ResizeObserver(() => { const next = host.clientWidth; if (next > 0 && Math.abs(width - next) > 1) { if (frame !== null) cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = null; if (host.clientWidth > 0) draw(true); }); } });
    observer.observe(host);
    return {
      setSelected(ms) { if (sel === ms) return; sel = ms; const i = V.span.indexOf(ms), count = host.clientWidth < 600 ? 6 : 12; draw(i < start || i >= start + count); },
      destroy() { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); },
    };
  }
  const api = { render, windowFor, precipTypes, typeSummary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventHourlyCharts = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
