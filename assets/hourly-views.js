/* Hourly views: turn HourlyModel data into HourlyGrid rows for each page. Shared by Model Blend, the Event Manager
   briefing and the fixture harness, so all three draw exactly the same thing from the same data.
   Formatting and wording only; values, levels and tiers come from HourlyModel (the blend and the briefing engine). */
(function (root) {
  "use strict";
  const H = 3600e3, fin = (x) => typeof x === "number" && Number.isFinite(x);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (x) => (fin(x) ? `${Math.round(x / 5) * 5}%` : "—"); // the site's 5-point precipitation steps
  const day = (ms, tz) => new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const HZ_ICON = { lightning: "ϟ", wind: "≋", rain: "☂", snow: "❄", heat: "☀", cold: "❆" };
  const SHORT = { "Plan for it": "Plan", "Likely disruptive": "Likely" };
  const PROB_NOTE = "Precip chance is the models' own hourly probability of precipitation (PoP), blended. Ensemble ≥0.01″ is a different number: the weighted share of ensemble members with at least 0.01″ in that hour.";

  /* the value rows both pages share: same order, same definitions */
  function valueRows(hrs, now) {
    const miss = (h) => ({ state: "missing", text: "—", why: h.state === "beyond" ? "Beyond the hourly guidance" : "No guidance for this hour" });
    const val = (k, f) => hrs.map((h) => {
      if (h.state !== "ok") return miss(h);
      const past = now != null && h.ms + H <= now;
      return fin(h[k]) ? { state: "ok", text: f(h[k]), past, why: past ? "Earlier hour: model guidance, not an observation" : "" } : { state: "missing", text: "—", why: "Not in the guidance for this hour", past };
    });
    return [
      { key: "temp", label: "Temperature", sub: "°F", cells: val("temp", (x) => `${Math.round(x)}°`) },
      { key: "feel", label: "Feels like", sub: "°F", cells: val("feel", (x) => `${Math.round(x)}°`) },
      { key: "pop", label: "Precip chance", sub: "hourly PoP", cells: val("pop", (x) => pct(x)) },
      { key: "chance", label: "Ensemble ≥0.01″", sub: "share of members", cells: val("chance", (x) => pct(x * 100)) },
      { key: "qpf", label: "Precip amount", sub: "inches", cells: val("qpf", (x) => (x < 0.005 ? "0" : x.toFixed(2))) },
      { key: "wind", label: "Wind", sub: "sustained mph", cells: val("wind", (x) => `${Math.round(x)}`) },
      { key: "gust", label: "Gusts", sub: "mph", cells: val("gust", (x) => `${Math.round(x)}`) },
    ];
  }

  /* ---------- Event Manager: setup through teardown ---------- */
  function eventView({ C, S, M, ctx, brief, thr, tz, now }) {
    const span = M.eventSpan(brief), hrs = M.blendHours(C, ctx.B, ctx.ws, ctx.opts, span, ctx.th), axis = M.axis(C, span, tz);
    const cover = M.phaseCover(span, brief.phases), con = M.eventConcerns(S, C, brief, hrs, thr);
    const clock = (min) => `:${String(Math.round(min)).padStart(2, "0")}`;
    const phaseCells = cover.map((ps) => {
      if (!ps.length) return { state: "clear", text: "" };
      const main = ps.reduce((a, c) => (c.fraction > a.fraction ? c : a));
      const text = ps.length > 1 ? ps.map((p, i) => (i && p.starts ? `${p.label} ${clock(p.from)}` : p.label)).join(" → ") : main.starts ? `${main.label} ${clock(main.from)}` : main.ends ? `${main.label} to ${clock(main.to)}` : main.label;
      return { state: "ok", text, split: ps.length === 1 && main.fraction < 1 ? { from: main.from, to: main.to } : null, title: ps.map((p) => `${p.label} ${clock(p.from)}–${p.to === 60 ? ":00 next hour" : clock(p.to)}`).join(" · ") };
    });
    const cellOf = (c, icon) => c.state === "concern" ? { state: "concern", tier: c.tier, icon, text: SHORT[c.word] || c.word, why: c.why }
      : c.state === "flag" ? { state: "flag", icon, text: "Low", why: c.why } : c.state === "missing" ? { state: "missing", text: "n/a", why: c.why }
      : c.state === "partial" ? { state: "partial", text: "None*", why: c.why } : { state: "clear", text: "–", why: c.why || "No concern identified" };
    const summary = con.summary.map((c) => { const x = cellOf(c, c.keys ? c.keys.map((k) => HZ_ICON[k]).join("") : ""); if (c.count > 1) x.text += ` ×${c.count}`; return x; });
    const rows = [
      { key: "phase", kind: "phase", label: "Phase", cells: phaseCells },
      { key: "concern", kind: "summary", label: "Any concern", sub: "highest in the hour", cells: summary },
      ...con.rows.map((r) => ({ key: `hz-${r.key}`, kind: "concern", label: `${HZ_ICON[r.key]} ${r.label}`, sub: r.key === "lightning" ? "Thunder tier" : "Phase level", cells: r.cells.map((c) => cellOf(c, "")) })),
      ...valueRows(hrs, now),
    ];
    const tiers = [...new Set(con.rows.flatMap((r) => r.cells.filter((c) => c.state === "concern").map((c) => c.tier)))];
    const legend = [
      ...["monitor", "prepare", "action"].filter((t) => tiers.includes(t)).map((t) => ({ state: "concern", tier: t, text: { monitor: "Watch · marginal", prepare: "Plan for it · elevated", action: "Likely disruptive · high" }[t] })),
      { state: "flag", text: "Low — meets an hourly rule; phase rated low" }, { state: "clear", text: "– no concern identified" },
      { state: "partial", text: "None* — thunder guidance missing" }, { state: "missing", text: "n/a — no guidance (not an all-clear)" }];
    const note = `Concerns use the briefing's own ratings: a hazard's hourly rule marks the hour, coloured by the level the briefing gives that phase (lightning: the Thunder page's tier for the hour). ${PROB_NOTE}`;
    function detail(i) {
      const h = hrs[i], a = axis[i], hits = con.rows.map((r) => ({ r, c: r.cells[i] })).filter((x) => x.c.state === "concern" || x.c.state === "flag");
      const head = `<h3>${esc(day(h.ms, tz))}, ${esc(a.hourText)} ${esc(a.zone)}${cover[i].length ? ` · ${esc(cover[i].map((p) => p.label).join(", "))}` : ""}</h3>`;
      if (h.state !== "ok") return head + `<p>${esc(h.state === "beyond" ? "Beyond the hourly guidance: this hour fills in as the date gets closer." : "No guidance source has values for this hour.")} This is missing guidance, not an all-clear.</p>`;
      return head + `<p>${hits.length ? hits.map((x) => `<b>${esc(x.r.label)}</b>: ${esc(x.c.word || "low")} — ${esc(x.c.why)}`).join("<br>") : esc(con.summary[i].why || "No concern identified")}</p>
        <p class="hg-note">${h.n} model source${h.n === 1 ? "" : "s"} in the blend this hour · ${h.thunder && h.thunder !== "nodata" ? `thunder signal ${esc(C.TIERS[h.thunder].word.toLowerCase())}` : "thunder guidance unavailable"}. Model guidance, not observed weather.</p>`;
    }
    return { span, hrs, axis, cover, con, rows, legend, note, detail };
  }

  /* ---------- Model Blend: next 24/48/72 hours or a custom window ---------- */
  function blendView({ C, M, B, ws, opts, span, tz, names = {}, nwsAxis = null, now }) {
    const hrs = M.blendHours(C, B, ws, opts, span), axis = M.axis(C, span, tz), rows = valueRows(hrs, now);
    const legend = [{ state: "ok", text: "Blend value" }, { state: "missing", text: "— no guidance for this hour (not zero)" }];
    const note = `${PROB_NOTE} Values are the blend's own hourly calculation (same recipe and weights as the daily table). Earlier hours, if shown, are model guidance, not observations.`;
    function detail(i) {
      const h = hrs[i], a = axis[i], past = now != null && h.ms + H <= now;
      const head = `<h3>${esc(day(h.ms, tz))}, ${esc(a.hourText)} ${esc(a.zone)}${past ? " · earlier hour (guidance, not observed)" : ""}</h3>`;
      if (h.state !== "ok") return head + `<p>${esc(h.state === "beyond" ? "Beyond the loaded forecast. Fetch more days to reach this hour." : "No source in the blend has values for this hour.")}</p>`;
      const parts = (h.parts && h.parts.hi) || [], wsum = parts.reduce((t, p) => t + (p.w || 0), 0) || 1;
      const qp = new Map(((h.parts && h.parts.qpf) || []).map((p) => [p.id, p.v]));
      const srcRows = parts.slice().sort((a2, b2) => (b2.w || 0) - (a2.w || 0)).map((p) => `<tr><td>${esc(names[p.id] || p.id)}${p.n > 1 && !/members\)/.test(names[p.id] || "") ? ` <span class="hg-note">(${p.n} members)</span>` : ""}</td><td class="n">${fin(p.v) ? Math.round(p.v) + "°" : "—"}</td><td class="n">${fin(qp.get(p.id)) ? qp.get(p.id).toFixed(2) + "″" : "—"}</td><td class="n">${Math.round((100 * (p.w || 0)) / wsum)}%</td></tr>`).join("");
      const ens = h.chanceInfo ? `${pct(h.chanceInfo.v)} of ${h.chanceInfo.members} ensemble members with ≥0.01″` : "no ensemble members this hour";
      const nw = nwsAxis && h.i != null ? { t: nwsAxis.temperature_2m && nwsAxis.temperature_2m[h.i], p: nwsAxis.precipitation_probability && nwsAxis.precipitation_probability[h.i] } : null;
      return head + `<p>Blend ${fin(h.temp) ? Math.round(h.temp) + "°" : "—"}${fin(h.tempR && h.tempR[0]) && fin(h.tempR[1]) ? ` <span class="hg-note">(sources ${Math.round(h.tempR[0])}–${Math.round(h.tempR[1])}°, 10th–90th weighted)</span>` : ""} · hourly PoP ${pct(h.pop)} · ${esc(ens)}</p>
        <table><thead><tr><th>Source (${h.n})</th><th class="n">Temp</th><th class="n">Precip</th><th class="n">Weight</th></tr></thead><tbody>${srcRows}</tbody></table>
        ${nw && (fin(nw.t) || fin(nw.p)) ? `<p class="hg-note">NWS grid this hour: ${fin(nw.t) ? Math.round(nw.t) + "°" : "—"}, ${fin(nw.p) ? pct(nw.p) + " chance" : "chance —"} (shown for comparison; in the blend at its own weight).</p>` : ""}
        <p class="hg-note">Weights are shares of the temperature blend this hour. A source missing from the table has no value for this hour.</p>`;
    }
    return { hrs, axis, rows, legend, note, detail };
  }

  const api = { eventView, blendView, valueRows, HZ_ICON, PROB_NOTE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HourlyViews = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
