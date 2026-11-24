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
     potential as Low / Moderate / High blocks, labelled as forecast potential, not detected lightning or a warning.
   The same file draws the event dashboard ("At a glance", below the briefing's callouts): the event totals as large
   tiles and a window bar of the hours each flagged hazard covers (see dashModel). */
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
      /* no chance for this hour and no measurable amount: the type is unknown, not "dry" */
      if (!fin(h.pop) && !(fin(h.qpf) && h.qpf >= WET_QPF)) return { kind: "missing", word: "No data", why: "No precipitation guidance for this hour" };
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
    if (!wet.length) return types.length && types.every((t) => t.kind === "missing") ? { mode: "none", text: "No precipitation data" } : { mode: "none", text: "No precipitation expected" };
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
      ids.forEach((i, j) => { if (value(s, i) === null && V.hrs[i]?.state !== "beyond") marks += `<rect x="${left + j * bw + 2}" y="${top}" width="${bw - 4}" height="${base - top}" class="evc-gap"/><text x="${x(j)}" y="${(top + base) / 2 + 5}" text-anchor="middle" class="evc-gaptext">${bw >= 58 ? "No data" : "—"}</text>`; });
      /* hours the hourly guidance doesn't reach yet: left blank, with one label over them */
      runs(ids.map((i) => (V.hrs[i]?.state === "beyond" ? "b" : null))).forEach((r) => { const x0 = left + r.a * bw, wd = (r.b - r.a + 1) * bw;
        marks += `<text x="${x0 + wd / 2}" y="${(top + base) / 2 + 5}" text-anchor="middle" class="evc-beyond" data-beyond="${r.b - r.a + 1}">${wd >= 150 ? "Not in hourly range yet" : wd >= 60 ? "Not yet" : ""}</text>`; });
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
      const amount = s.key === "pop" ? `<span>This hour <b data-amount>${esc(text("qpf", iSel))}${text("qpf", iSel) === "—" ? "" : " in."}</b>${tsum.mode !== "none" && types[iSel] && !["dry"].includes(types[iSel].kind) ? ` · <b data-sel-type>${esc(types[iSel].word || "")}</b>` : ""}</span>` : "";
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

  /* ---------- the event dashboard: the most impactful totals and when the flagged conditions are possible ----------
     Presentation only, from the same briefing view as the charts: V.totals (blend event totals, the spread across
     sources, the heaviest hour, type sequence), the hourly rows' concern cells (the briefing engine's tiers, the same
     ones the charts label and the attention outline uses) and the hourly gusts the wind chart draws. No new thresholds:
     a tile or a window row is coloured only where the briefing already flags that hazard, always with its level word. */
  const RANK = { monitor: 1, prepare: 2, action: 3 };
  const LEVEL_FULL = { Watch: "Watch", Plan: "Plan for it", Likely: "Likely disruptive" };
  const HAZ = { "hz-rain": { key: "rain", label: "Rain", order: 0 }, "hz-wind": { key: "wind", label: "Gusts", order: 1 }, lightning: { key: "lightning", label: "Lightning potential", order: 2 }, "hz-snow": { key: "snow", label: "Snow", order: 3 } };
  /* the same test the winter read uses: modeled snow, or measurable precipitation at 35°F or colder */
  const wintry = (V) => !!((V.totals && fin(V.totals.sn) && V.totals.sn >= 0.05) || V.hrs.some((h) => h && h.state === "ok" && fin(h.temp) && h.temp <= 35 && fin(h.qpf) && h.qpf >= 0.005));
  function dashModel(V, { tz, gustLimit = 25 } = {}) {
    const n = V.span.length, T = V.totals || {}, ok = V.hrs.filter((h) => h && h.state === "ok");
    const clock = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hour: "numeric", minute: "2-digit" }).format(new Date(ms)).replace(":00", "");
    const dayOf = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, weekday: "short" }).format(new Date(ms));
    const multiDay = new Set(V.axis.map((a) => a.date)).size > 1;
    /* the event's own edges inside its first and last hours (setup at 1:30 starts the window at 1:30) */
    const cov = (i) => (V.cover && V.cover[i]) || [];
    const fromOf = (i) => V.span[i] + (cov(i).length ? Math.min(...cov(i).map((p) => p.from)) : 0) * 60e3;
    const toOf = (i) => V.span[i] + (cov(i).length ? Math.max(...cov(i).map((p) => p.to)) : 60) * 60e3;
    const s = fromOf(0), e = toOf(n - 1);
    const when = (a, b) => { const da = dayOf(a), db = dayOf(b - 1); return multiDay ? `${da} ${clock(a)}–${db !== da ? db + " " : ""}${clock(b)}` : `${clock(a)}–${clock(b)}`; };
    const around = (ms) => { const a = V.axis[V.span.indexOf(ms)]; return a ? `${multiDay ? dayOf(ms) + " " : ""}${a.hourText}` : clock(ms); };
    /* flagged hazards: hours whose cell is a concern (Watch or higher), in runs of consecutive hours */
    const flags = V.rows.filter((r) => HAZ[r.key] || /^hz-/.test(r.key)).map((r) => {
      const idx = r.cells.map((c, i) => (c && c.state === "concern" ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return null;
      const top = idx.reduce((a, i) => ((RANK[r.cells[i].tier] || 0) > (RANK[r.cells[a].tier] || 0) ? i : a), idx[0]), c = r.cells[top];
      const runs = idx.reduce((o, i) => { const l = o[o.length - 1]; if (l && l.b === i - 1) l.b = i; else o.push({ a: i, b: i }); return o; }, []).map((x) => ({ ...x, from: fromOf(x.a), to: toOf(x.b), text: when(fromOf(x.a), toOf(x.b)),
        /* parts of the run by level, so a run that steps up from Watch to Plan for it shows both colours */
        parts: Array.from({ length: x.b - x.a + 1 }, (_, k) => x.a + k).reduce((o, i) => { const t = r.cells[i].tier || "monitor", l = o[o.length - 1]; if (l && l.tier === t) { l.b = i; l.to = toOf(i); } else o.push({ tier: t, word: r.key === "lightning" ? r.cells[i].text : LEVEL_FULL[r.cells[i].text] || r.cells[i].text, a: i, b: i, from: fromOf(i), to: toOf(i) }); return o; }, []) }));
      const meta = HAZ[r.key] || { key: r.key.replace(/^hz-/, ""), label: String(r.label || r.key).replace(/^[^A-Za-z]+/, ""), order: 9 };
      return { ...meta, row: r.key, tier: c.tier || "monitor", word: r.key === "lightning" ? c.text : LEVEL_FULL[c.text] || c.text, why: c.why || "", peakMs: V.span[top], runs, hours: runs.map((x) => x.text).join(", ") };
    }).filter(Boolean).sort((a, b) => a.order - b.order);
    const by = Object.fromEntries(flags.map((f) => [f.key, f]));
    const f2 = (v) => v.toFixed(2), f1 = (v) => v.toFixed(1), lb = T.gap ? "at least" : "";
    const range = (r, f) => (r && fin(r[0]) && fin(r[1]) && r[1] - r[0] >= 0.01 ? `Models ${f(r[0])}–${f(r[1])} in` : "");
    const tiles = [];
    const rain = by.rain || null;
    tiles.push(fin(T.qpf) ? { key: "rain", label: "Rain total", value: f2(T.qpf), pre: lb, unit: "in", unitWord: "inches", sub: [range(T.qpfR, f2) || (T.gap ? `${T.gap} hour${T.gap > 1 ? "s" : ""} without guidance` : "Setup through teardown")], flag: rain }
      : { key: "rain", label: "Rain total", value: null, sub: ["No data (not zero)"], flag: null });
    if (T.peakQ) tiles.push({ key: "rate", label: "Heaviest rain", value: f2(T.peakQ.v), unit: "in/hr", unitWord: "inches per hour", sub: [`Around ${around(T.peakQ.ms)}`], flag: rain, at: T.peakQ.ms });
    /* gusts: the highest hourly gust the wind chart shows; a full tile only when the briefing flags wind */
    const g = ok.filter((h) => fin(h.gust)).reduce((a, h) => (!a || h.gust > a.v ? { v: h.gust, ms: h.ms } : a), null), wind = by.wind || null;
    let gustLine = null;
    if (wind && g) tiles.push({ key: "gust", label: "Peak gusts", value: String(Math.round(g.v)), unit: "mph", unitWord: "miles per hour", sub: [`Around ${around(g.ms)} · your limit ${gustLimit} mph`], flag: wind, at: g.ms });
    else gustLine = !g ? { text: "Gusts: no data for these hours (not zero)", state: "missing" }
      : { text: `Gusts up to ${Math.round(g.v)} mph · ${g.v >= gustLimit ? `reach your ${gustLimit} mph limit around ${around(g.ms)}, rated low for this plan` : `below your ${gustLimit} mph limit, not a concern`}`, state: g.v >= gustLimit ? "low" : "clear", v: Math.round(g.v) };
    if (wintry(V)) {
      const snow = by.snow || null, sub = [range(T.snR, f1), "7:1, before melting"].filter(Boolean).join(" · ");
      tiles.push(fin(T.sn) ? { key: "snow", label: "Snow total", value: f1(T.sn), pre: lb, unit: "in", unitWord: "inches", sub: [sub, ...(T.peakSn && f1(T.peakSn.v) !== "0.0" ? [`Heaviest ${f1(T.peakSn.v)} in/hr around ${around(T.peakSn.ms)}`] : [])], flag: snow }
        : { key: "snow", label: "Snow total", value: null, sub: ["No data (not zero)"], flag: null });
    }
    if (by.lightning) tiles.push({ key: "lightning", label: "Lightning potential", value: by.lightning.word, unit: "", sub: [`Peaks around ${around(by.lightning.peakMs)} · forecast potential, not detected lightning`], flag: by.lightning, at: by.lightning.peakMs });
    /* event parts on the window axis, from the hours each part covers */
    const parts = []; (V.cover || []).forEach((ps, i) => ps.forEach((p) => { let x = parts.find((q) => q.key === p.key); if (!x) parts.push(x = { key: p.key, label: p.label, from: V.span[i] + p.from * 60e3, to: 0 }); x.to = V.span[i] + p.to * 60e3; }));
    const missing = V.hrs.filter((h) => !h || h.state !== "ok").length;
    return { s, e, flags, tiles, gustLine, types: (T.types || []).slice(), parts, missing, gap: T.gap || 0, when, around, clock, dayOf, multiDay };
  }
  const TYPE_WORD = { rain: "Rain", mix: "Mix", snow: "Snow" };
  function dashboardHtml(V, M, { tz, sel = null } = {}) {
    const pos = (ms) => (100 * (Math.max(M.s, Math.min(M.e, ms)) - M.s)) / (M.e - M.s);
    const box = (a, b) => `--l:${pos(a).toFixed(3)}%;--w:${Math.max(0, pos(b) - pos(a)).toFixed(3)}%`;
    const tier = (f) => (f ? ` data-tier="${esc(f.tier)}" style="--tier:var(--${esc(f.tier)})"` : "");
    const tile = (t) => `<li class="evd-tile" data-tile="${t.key}"${tier(t.flag)}><span class="evd-lab">${esc(t.label)}</span>` +
      `<span class="evd-val">${t.value == null ? `<b data-value>—</b>` : `${t.pre ? `<small>${esc(t.pre)}</small> ` : ""}<b data-value>${esc(t.value)}</b>${t.unit ? ` <span class="evd-unit"><span aria-hidden="true">${esc(t.unit)}</span><span class="sr-only">${esc(t.unitWord)}</span></span>` : ""}`}</span>` +
      t.sub.filter(Boolean).map((x) => `<span class="evd-sub">${esc(x)}</span>`).join("") +
      (t.flag && t.key !== "lightning" ? `<span class="evd-badge" data-level>${esc(t.flag.word)}</span>` : "") /* lightning's value is its level word */ + `</li>`;
    const types = M.types.length ? `<p class="evd-types" data-types><span class="evd-note-lab">Precipitation type</span> ${M.types.map((k) => `<span class="evd-chip evd-chip-${esc(k)}">${TYPE[k] ? TYPE[k].sym + " " : ""}${esc(TYPE_WORD[k] || k)}</span>`).join('<span class="evd-arrow" aria-label="then">→</span>')}</p>` : "";
    const gust = M.gustLine ? `<p class="evd-gust" data-gust-line="${esc(M.gustLine.state)}">${esc(M.gustLine.text)}</p>` : "";
    /* the window: event parts, one row per flagged hazard, then time ticks */
    const cur = sel != null && V.span.includes(sel) ? `<span class="evd-cur" style="left:${pos(sel + 1800e3).toFixed(3)}%"></span>` : `<span class="evd-cur" hidden></span>`;
    const partsLane = `<div class="evd-parts" aria-hidden="true">${M.parts.map((p) => { const w = pos(p.to) - pos(p.from); return `<span class="evd-part${p.key === "event" ? " evd-main" : ""}" style="${box(p.from, p.to)}" title="${esc(p.label)} ${esc(M.when(p.from, p.to))}">${w >= 11 ? esc(p.label) : ""}</span>`; }).join("")}${cur}</div>`;
    const rows = M.flags.map((f) => `<div class="evd-row" data-hazard="${esc(f.key)}"${tier(f)}><p class="evd-rowlab"><b>${esc(f.label)}: ${esc(f.word.toLowerCase())}</b> <span data-hours>${esc(f.hours)}</span></p>` +
      `<div class="evd-track">${f.runs.flatMap((r) => r.parts).map((p) => `<i class="evd-fill" data-from="${p.from}" data-to="${p.to}" data-tier="${esc(p.tier)}" style="${box(p.from, p.to)};--tier:var(--${esc(p.tier)})"><span>${esc(p.word)}</span></i>`).join("")}` +
      f.runs.map((r) => `<button type="button" class="evd-seg" data-a="${r.a}" data-b="${r.b}" style="${box(r.from, r.to)}" aria-label="${esc(`${f.label}: ${f.word}, ${r.text}. Show this time in the hourly forecast`)}"></button>`).join("") + `${cur}</div></div>`).join("");
    const cand = [...M.parts.map((p) => ({ ms: p.from, pri: 2 })), { ms: M.e, pri: 3 }].sort((a, b) => a.ms - b.ms || b.pri - a.pri), kept = [];
    cand.forEach((c) => { const prev = kept[kept.length - 1]; if (prev && pos(c.ms) - pos(prev.ms) < 13) { if (c.pri > prev.pri && kept.length > 1) kept[kept.length - 1] = c; return; } kept.push(c); });
    const ticks = kept.map((c, k) => { const p = pos(c.ms), cls = k === kept.length - 1 || p >= 90 ? "end" : k === 0 || p <= 8 ? "start" : "mid";
      const day = M.multiDay && (k === 0 || M.dayOf(c.ms - 1) !== M.dayOf(kept[k - 1].ms)) ? M.dayOf(c.ms - (c.ms === M.e ? 1 : 0)) + " " : "";
      return `<span class="${cls}" style="left:${p.toFixed(3)}%">${esc(day + M.clock(c.ms))}</span>`; }).join("");
    const none = `<p class="evd-none" data-none>No weather concerns flagged for your event window.${M.missing ? ` ${M.missing} hour${M.missing > 1 ? "s have" : " has"} no forecast data, so that part is not an all-clear.` : ""}</p>`;
    const span = root.EventBriefingUI && root.EventBriefingUI.dateSpan ? root.EventBriefingUI.dateSpan(M.s, M.e, tz) : M.when(M.s, M.e);
    return `<section class="evd" aria-labelledby="evdTitle"><div class="evd-head"><h2 id="evdTitle">At a glance</h2><span class="evd-span">Setup through teardown · ${esc(span)}</span></div>` +
      `<ul class="evd-tiles" aria-label="Event weather totals">${M.tiles.map(tile).join("")}</ul>` +
      (types || gust ? `<div class="evd-notes">${types}${gust}</div>` : "") +
      `<div class="evd-when" data-window><h3>When conditions could affect the event</h3>${M.flags.length ? `<div class="evd-lanes">${partsLane}${rows}<div class="evd-axis" aria-hidden="true">${ticks}</div></div>` +
        `<p class="evd-sel" data-sel aria-live="polite"></p>` : none}</div></section>`;
  }
  /* render into host; tapping a flagged window selects that hour on the page's shared timeline, like the charts */
  function dashboard(host, { view: V, tz, gustLimit = 25, selected = null, onSelect = () => {}, onOpenHourly = null }) {
    const M = dashModel(V, { tz, gustLimit });
    let sel = selected;
    host.innerHTML = dashboardHtml(V, M, { tz, sel });
    const readout = () => {
      const pos = (ms) => (100 * (Math.max(M.s, Math.min(M.e, ms)) - M.s)) / (M.e - M.s), on = sel != null && V.span.includes(sel);
      host.querySelectorAll(".evd-cur").forEach((c) => { c.hidden = !on; if (on) c.style.left = pos(sel + 1800e3).toFixed(3) + "%"; });
      const p = host.querySelector("[data-sel]"); if (!p) return;
      const hits = on ? M.flags.filter((f) => f.runs.some((r) => V.span.indexOf(sel) >= r.a && V.span.indexOf(sel) <= r.b)).map((f) => `${f.label.toLowerCase()} ${f.word.toLowerCase()}`) : [];
      p.innerHTML = on ? `<span>Selected <b>${esc(M.around(sel))}</b>${hits.length ? ` · ${esc(hits.join(", "))}` : ""}</span>${onOpenHourly ? `<button type="button" class="bx-link evd-open">See this hour ↓</button>` : ""}` : "<span>Tap a coloured bar to choose an hour.</span>";
      const o = p.querySelector(".evd-open"); if (o) o.onclick = () => onOpenHourly(sel);
    };
    host.querySelectorAll(".evd-seg").forEach((b) => (b.onclick = (ev) => {
      const a = +b.dataset.a, z = +b.dataset.b, cur = V.span.indexOf(sel); let i;
      if (!ev.detail) i = cur >= a && cur < z ? cur + 1 : a; // keyboard: the window's first hour, then step through it
      else { const r = b.parentElement.getBoundingClientRect(), t = M.s + ((ev.clientX - r.left) / r.width) * (M.e - M.s); i = Math.floor((t - V.span[0]) / H); }
      sel = V.span[Math.min(z, Math.max(a, i))]; readout(); onSelect(sel);
    }));
    /* time labels that would touch at this width are dropped (the first and the end stay), measured, not guessed */
    const thin = () => { host.querySelectorAll(".evd-fill span").forEach((t) => { t.hidden = false; t.hidden = t.scrollWidth > t.parentElement.clientWidth - 8; });
      const ts = [...host.querySelectorAll(".evd-axis span")]; ts.forEach((t) => (t.hidden = false)); let prev = null;
      ts.forEach((t, k) => { const r = t.getBoundingClientRect(); if (prev && r.left < prev.r.right + 8) { if (k === ts.length - 1 && prev.k > 0) { prev.t.hidden = true; } else { t.hidden = true; return; } } prev = { t, r, k }; }); };
    readout(); thin();
    let width = host.clientWidth; const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (Math.abs(host.clientWidth - width) > 1) { width = host.clientWidth; thin(); } }) : null;
    if (observer) observer.observe(host);
    return { model: M, setSelected(ms) { if (ms === sel) return; sel = ms; readout(); }, destroy() { if (observer) observer.disconnect(); } };
  }
  const api = { render, windowFor, precipTypes, typeSummary, dashboard, dashModel, dashboardHtml, wintry };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EventHourlyCharts = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
