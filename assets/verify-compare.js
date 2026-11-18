/* Compare sources: matched cases across the selected sources (VC.matched), never independently aggregated
   scores. Shows the shared date range, exclusions, sample size and coverage with numerator and denominator, plus the
   scheduled editions that were missed. Presentation only: no capture, scoring or recalculation of forecasts. */
(function () {
  "use strict";
  const E = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const F = (v, d = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
  const S = (v, d = 1) => (typeof v === "number" && Number.isFinite(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : "—");
  const NAMES = { nws: "NWS", "nws-official": "NWS (official text)", ecmwf_ens: "ECMWF ENS", gefs: "GEFS", gfs_seamless: "GFS", ecmwf_ifs025: "ECMWF IFS", ecmwf_aifs025_single: "ECMWF AIFS", ncep_nbm_conus: "NBM", gfs_hrrr: "HRRR", ncep_rrfs_conus: "RRFS", rrfs_ens: "RRFS ensemble", ncep_nam_conus: "NAM", icon_seamless: "ICON", gem_seamless: "GEM", ukmo_seamless: "UKMO", meteofrance_seamless: "Météo-France", jma_seamless: "JMA" };
  const GROUPS = [["models", "Models, blends & NWS"], ["tv", "TV products"]];
  const groupOf = (track) => (track === "tv" ? "tv" : "models");
  let gen = 0;
  const VC = typeof VerifyCore !== "undefined" ? VerifyCore : require("./verify-core.js");

  /* everything the view computes, from the expanded pairs, attempts and schedule; pure so it can be tested */
  function compute(sc, pairs, health, st) {
    const verDates = [...new Set(sc.verifiedDates?.[st.target] || pairs.filter((p) => p.target === st.target).map((p) => p.date))].sort();
    const last = verDates[verDates.length - 1] || null, start = last && st.period === "week" ? VC.addDays(last, -6) : null;
    const inPeriod = (d) => !start || (d >= start && d <= last);
    const slotOk = (s) => st.slot === "both" || s === st.slot;
    const ps = pairs.filter((p) => p.target === st.target && p.lead === +st.lead && slotOk(p.slot) && inPeriod(p.date));
    const available = [...new Set(ps.map((p) => p.id))].filter((id) => st.groups.includes(groupOf(sc.tracks[id])));
    /* default selection: the sources present in the most candidate cases (a sparse source would otherwise remove
       every case); each other source is offered with the matched cases adding it would leave */
    const caseCount = {}; ps.forEach((p) => { (caseCount[p.id] = caseCount[p.id] || new Set()).add(p.captureId + "|" + (p.valid || p.date)); });
    const most = Math.max(0, ...available.map((id) => caseCount[id].size));
    const fullest = available.filter((id) => caseCount[id].size === most);
    const members = (st.members || fullest).filter((id) => available.includes(id));
    const adding = members.length >= 1 ? available.filter((id) => !members.includes(id)).map((id) => ({ id, cases: members.length + 1 >= 2 ? VC.matched(ps, { members: members.concat(id) }).n : 0, own: caseCount[id].size })) : [];
    const m = members.length >= 2 ? VC.matched(ps, { members }) : { n: 0, dates: 0, scores: [], reason: "Select at least two sources for a matched comparison.", excluded: null, onlyMissing: {} };
    const att = sc.attempts.filter((a) => slotOk(a.slot) && inPeriod(VC.addDays(a.localDate, +st.lead)));
    const cov = Object.fromEntries(members.map((id) => [id, VC.coverage(att, ps, { id, target: st.target, lead: st.lead, track: sc.tracks[id], verifiedDates: verDates })]));
    /* scheduled editions whose verifying date for this lead falls in the period: on time, late, missed/failed */
    const slots = (sc.slots || health?.slots || []).filter((x) => x.status !== "pending" && slotOk(String(x.id).split("_").pop()) && inPeriod(VC.addDays(String(x.id).slice(0, 10), +st.lead)));
    const sched = { total: slots.length, onTime: slots.filter((x) => x.status === "on_time").length, late: slots.filter((x) => x.status === "late").length, missed: slots.filter((x) => /missed|failed/.test(x.status)).length,
      partial: slots.filter((x) => x.status === "partial").length, offSchedule: slots.filter((x) => x.status === "off_schedule").length, others: {} };
    /* any status not named above is listed by its own name, never folded into an unnamed "other" */
    slots.filter((x) => !/^(on_time|late|partial|off_schedule)$/.test(x.status) && !/missed|failed/.test(x.status)).forEach((x) => { sched.others[x.status] = (sched.others[x.status] || 0) + 1; });
    return { available, members, defaultMembers: fullest, adding, m, cov, sched, period: { start: start || verDates[0] || null, end: last } };
  }

  function open(dash, getJSON, pane, idx) {
    const me = ++gen;
    if (!dash || !dash.scorecardFile) { pane.innerHTML = `<section class="card vdcard"><h2>Compare sources</h2><p class="msg">The archive has not produced the comparison projection yet (dashboard-v2). Other views are unaffected.</p></section>`; return; }
    pane.innerHTML = `<section class="card vdcard"><h2>Compare sources</h2><p class="msg">Loading the private comparison projection…</p></section>`;
    getJSON(dash.scorecardFile).then((sc) => { if (me !== gen) return; draw(sc, VC.expandScorecard(sc), idx && idx.health, pane, me); })
      .catch((e) => { if (me === gen) pane.innerHTML = `<section class="card vdcard"><h2>Compare sources</h2><p class="msg err">${E(e.message)}</p></section>`; });
  }

  function draw(sc, pairs, health, pane, me) {
    const label = (id) => NAMES[id] || sc.tvMeta?.[id]?.label || sc.sourceLabels?.[id] || id;
    const leadsFor = (t) => [...new Set(pairs.filter((p) => p.target === t).map((p) => p.lead))].filter((l) => l >= (t === "temp_hourly" ? 0 : 1) && l <= 10).sort((a, b) => a - b);
    const st = { target: "tmax_clim", lead: 1, slot: "midday", period: "all", groups: ["models", "tv"], members: null };
    const sel = (id, opts, v, text) => `<label>${E(text)}<select id="${id}">${opts.map(([k, l]) => `<option value="${E(k)}" ${String(k) === String(v) ? "selected" : ""}>${E(l)}</option>`).join("")}</select></label>`;
    const render = () => {
      if (me !== gen) return;
      const leads = leadsFor(st.target); if (!leads.includes(+st.lead)) st.lead = leads[0] ?? 1;
      const r = compute(sc, pairs, health, st), mm = r.m, prelim = mm.dates < (sc.minDates || 30);
      const ex = mm.excluded, only = Object.entries(mm.onlyMissing || {}).sort((a, b) => b[1] - a[1]);
      const pickable = r.available.slice().sort((a, b) => groupOf(sc.tracks[a]).localeCompare(groupOf(sc.tracks[b])) || label(a).localeCompare(label(b)));
      const rows = r.members.slice().sort((a, b) => groupOf(sc.tracks[a]).localeCompare(groupOf(sc.tracks[b])) || label(a).localeCompare(label(b))).map((id) => {
        const s = (mm.scores || []).find((x) => x.id === id), c = r.cov[id], tv = sc.tvMeta?.[id];
        return `<tr><td data-label="Source"><b>${E(label(id))}</b> <span class="vtag">${sc.tracks[id] === "tv" ? "TV" : sc.tracks[id] === "blend" ? "blend" : "model"}</span>${tv ? `<br><span class="msg">${E(tv.location)} · ${E(tv.authorship)}</span>` : ""}</td>
          <td data-label="MAE °F" class="num">${F(s && s.mae)}</td><td data-label="Bias °F" class="num">${S(s && s.bias)}</td>
          <td data-label="Distinct dates" class="num">${mm.dates || 0}</td><td data-label="Cases" class="num">${s ? s.n : 0}</td>
          <td data-label="Coverage" class="vcov">${c.delivered} of ${c.attempted} attempted${c.notAttempted ? `<br><span class="msg">not attempted in ${c.notAttempted} of ${c.eligible} on-time editions</span>` : ""}</td></tr>`;
      }).join("");
      pane.innerHTML = `<section class="card vdcard"><h2>Compare sources · CVG</h2>
        <p class="msg">Matched cases only: a case counts when every selected source forecast the same valid window from the same capture, with a shared observation and compatible methods.</p>
        <div class="vcontrols">${sel("ctarget", sc.targets.map((t) => [t.id, t.label]), st.target, "Target")}${sel("clead", leadsFor(st.target).map((l) => [l, l === 0 ? "Same day" : `Day ${l}`]), st.lead, "Lead")}${sel("cslot", [["midday", "Midday edition"], ["evening", "Evening edition"], ["both", "Both editions"]], st.slot, "Edition")}${sel("cperiod", [["all", "Full archive"], ["week", "Recent week"]], st.period, "Period")}</div>
        <div class="vgroups">${GROUPS.map(([k, l]) => `<label class="vcheck"><input type="checkbox" data-group="${k}" ${st.groups.includes(k) ? "checked" : ""}> ${E(l)}</label>`).join("")}</div>
        <details class="vpick"><summary>Sources (${r.members.length} of ${r.available.length} selected)</summary><div class="vpicklist">${pickable.map((id) => `<label class="vcheck"><input type="checkbox" data-src="${E(id)}" ${r.members.includes(id) ? "checked" : ""}> ${E(label(id))}</label>`).join("") || '<span class="msg">No source has verified forecasts for this selection.</span>'}</div>
          <div class="vpickbtns"><button type="button" class="btn ghost sm" id="cdef">Default</button><button type="button" class="btn ghost sm" id="call">All</button><button type="button" class="btn ghost sm" id="cnone">None</button></div></details>
        ${r.adding.length ? `<p class="msg">Not selected${st.members ? "" : " (fewer cases than the selected sources)"}: ${r.adding.slice().sort((a, b) => b.cases - a.cases).map((x) => `${E(label(x.id))} (adding it leaves ${x.cases} matched case${x.cases === 1 ? "" : "s"})`).join(" · ")}.</p>` : ""}
        ${prelim && mm.n ? `<p class="vprelim" role="note"><b>Preliminary.</b> ${mm.dates} distinct verifying date${mm.dates === 1 ? "" : "s"}. The archive treats fewer than ${sc.minDates || 30} as too few for accuracy conclusions, and reaching that number would not by itself show one source is better.</p>` : ""}
        <p class="vsummary">${mm.n ? `<b>${mm.n}</b> matched case${mm.n === 1 ? "" : "s"} · <b>${mm.dates}</b> distinct verifying date${mm.dates === 1 ? "" : "s"} · ${E(mm.from)} to ${E(mm.to)} · ${r.members.length} sources${mm.hours ? ` · ${mm.hours} distinct valid hours` : ""}` : E(mm.reason || "No matched cases.")}</p>
        ${ex ? `<p class="msg">Excluded: ${ex.missingSource} case${ex.missingSource === 1 ? "" : "s"} without every selected source${ex.duplicate ? ` · ${ex.duplicate} with a repeated forecast` : ""}${ex.observationDiffers ? ` · ${ex.observationDiffers} with differing observations` : ""}${ex.methodMismatch ? ` · ${ex.methodMismatch} made with a different method` : ""}.${only.length ? ` Missing only one source: ${only.slice(0, 4).map(([id, n]) => `${E(label(id))} ${n}`).join(", ")}.` : ""}</p>` : ""}
        ${r.members.length ? `<div class="tablewrap vstack"><table class="vcompare"><thead><tr><th>Source</th><th>MAE °F</th><th>Bias °F</th><th>Distinct dates</th><th>Cases</th><th>Coverage</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
        <p class="msg">Bias is forecast minus observed. Coverage counts on-time editions that yielded a verified forecast for this lead out of editions where the source was attempted. ${st.target === "temp_hourly" ? "An hourly edition counts when it has at least one verified hour on the selected lead day." : ""}</p>
        <p class="vsched">Scheduled editions for this lead and period: ${r.sched.total} · on time ${r.sched.onTime} · late ${r.sched.late} (kept, excluded from comparisons) · <b>partly captured ${r.sched.partial}</b> (some sources arrived on time) · <b>missed or failed ${r.sched.missed}</b>${r.sched.offSchedule ? ` · off schedule ${r.sched.offSchedule}` : ""}${Object.entries(r.sched.others).map(([k, n]) => ` · ${E(k.replace(/_/g, " "))} ${n}`).join("")}. Missed editions are outside every coverage count above.</p></section>`;
      const on = (id, ev, f) => { const el = pane.querySelector("#" + id); if (el) el.addEventListener(ev, f); };
      on("ctarget", "change", (e) => { st.target = e.target.value; st.members = null; render(); });
      on("clead", "change", (e) => { st.lead = +e.target.value; st.members = null; render(); });
      on("cslot", "change", (e) => { st.slot = e.target.value; st.members = null; render(); });
      on("cperiod", "change", (e) => { st.period = e.target.value; st.members = null; render(); });
      on("cdef", "click", () => { st.members = null; render(); });
      on("call", "click", () => { st.members = r.available.slice(); render(); });
      on("cnone", "click", () => { st.members = []; render(); });
      pane.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("change", () => { st.groups = [...pane.querySelectorAll("[data-group]:checked")].map((x) => x.dataset.group); st.members = null; render(); }));
      pane.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("change", () => { st.members = [...pane.querySelectorAll("[data-src]:checked")].map((x) => x.dataset.src); render(); const d = pane.querySelector(".vpick"); if (d) d.open = true; }));
    };
    render();
  }
  const api = { open, compute };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.VerifyCompare = api;
})();
