/* Run-to-run trends from the shared CVG archive (WxMan33/forecast-ops-maps, data/trends/CVG/).
   Plain-language lines first; the per-source numbers, run identities and limitations are expandable.
   The browser's own saved updates remain available below as a fallback. */
(function (root) {
  "use strict";
  const TA = root.TrendArchive;
  const CVG = { lat: 39.04456, lon: -84.67229 };
  const near = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180)) <= 5;
  const LAGS = [[12, "previous run (12 h earlier)"], [24, "the run 24 h earlier"], [48, "the run 48 h earlier"]];
  function create({ E, dayLabel, name, rerender, base }) {
    const BASE = (base || "https://wxman33.github.io/forecast-ops-maps/data/trends/CVG/").replace(/\/?$/, "/");
    let st = { status: "idle", index: null, files: {}, lag: 12, err: null, forLoc: null };
    try { st.lag = +(localStorage.getItem("ops_trend_lag") || 12) || 12; } catch (e) { /* default */ }
    const get = (p) => { const c = new AbortController(), t = setTimeout(() => c.abort(), 20000); return fetch(BASE + p, { signal: c.signal, cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).finally(() => clearTimeout(t)); };
    async function load(loc) {
      const key = loc ? `${(+loc.lat).toFixed(3)},${(+loc.lon).toFixed(3)}` : "";
      if (st.forLoc === key && st.status !== "idle") return; st.forLoc = key;
      if (!loc || !near({ lat: +loc.lat, lon: +loc.lon }, CVG)) { st.status = "elsewhere"; rerender(); return; }
      st.status = "loading"; rerender();
      try {
        const idx = await get("index.json"); const want = new Set();
        (idx.cycles || []).forEach((c) => Object.values(c.sources).forEach((s) => s.file && want.add(s.file)));
        (idx.snapshots || []).slice(0, 2).forEach((s) => Object.values(s.sources).forEach((x) => x.file && want.add(x.file)));
        const files = {}; await Promise.all([...want].map(async (f) => { try { files[f] = await get(f); } catch (e) { /* listed as unavailable */ } }));
        st = { ...st, status: "ready", index: idx, files };
      } catch (e) { st = { ...st, status: "error", err: e.message }; }
      rerender();
    }
    const cyc = (ms) => TA.cycleLabel(ms);
    const fmt = (k, v) => (v == null ? "—" : k === "qpf" ? `${v.toFixed(2)}″` : k === "sn" ? `${v.toFixed(1)}″` : ["onset", "end"].includes(k) ? new Date(v).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric" }) : typeof v === "number" ? `${v.toFixed(0)}°F` : String(v));
    function result() { return st.status === "ready" ? TA.trend(st.index, st.files, st.lag) : null; }
    function newest() { const ids = (st.index.cycles || []).filter((c) => Object.values(c.sources).some((s) => s.identity === "confirmed-run")); return ids.length ? Date.parse(ids[0].cycle) : null; }
    function linesHtml(lines, day) {
      const by = new Map(); lines.filter((l) => !day || l.day === day).forEach((l) => { if (!by.has(l.day)) by.set(l.day, []); by.get(l.day).push(l); });
      return [...by.entries()].map(([d, ls]) => `<li><b>${E(dayLabel(d))}</b><br>${ls.map((l) => `<span>${E(l.text)}</span>`).join("<br>")}</li>`).join("");
    }
    function detailsHtml(t) {
      const rows = t.lines.map((l) => `<tr><td>${E(dayLabel(l.day))}</td><td>${E(l.text)}</td><td>${(l.sources || []).map((s) => `${E(name(s.id))}: ${E(fmt(l.kind, s.from))} → ${E(fmt(l.kind, s.to))}`).join("<br>")}</td></tr>`).join("");
      const runs = t.perSource.map((p) => `<tr><td>${E(name(p.id))}</td><td>${E(cyc(p.cur))}</td><td>${E(cyc(p.ref))}</td></tr>`).join("");
      return `<details><summary>Source details · ${t.perSource.length} sources compared${t.skipped.length ? `, ${t.skipped.length} without a matching earlier run` : ""}</summary>
        ${rows ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Trend</th><th>Each source, earlier run → newest run</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
        <div class="tablewrap"><table><thead><tr><th>Source</th><th>Newest run</th><th>Compared with</th></tr></thead><tbody>${runs}</tbody></table></div>
        ${t.skipped.length ? `<p class="msg">Not compared: ${t.skipped.map((s) => `${E(name(s.id))} (${E(s.why)})`).join("; ")}.</p>` : ""}
        <p class="msg">Runs are confirmed by the source itself (Open-Meteo Single Runs API: the run requested and a response that starts at that run). Each source is compared only with its own earlier run, over identical local calendar days and hours with the same member coverage; precipitation as liquid-equivalent amounts; timing as the first and last hour with ≥0.01″, each rain round kept separate. A line needs at least three sources and two-thirds agreement. Wording: temperatures "slightly" 1–3°F, plain 3–6°F, "sharply" 6°F+; precipitation "slightly" 0.03–0.10″, plain 0.10–0.35″, "sharply" 0.35″+. These describe guidance changes, not forecast skill. No blend weights are involved.</p>
        ${snapshotsHtml()}</details>`;
    }
    function snapshotsHtml() {
      const sn = (st.index.snapshots || []).slice(0, 2); if (!sn.length) return "";
      const [a, b] = sn, items = [];
      Object.entries(a.sources).forEach(([id, s]) => {
        const lab = s.nwsUpdated ? `NWS issued ${new Date(s.nwsUpdated).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : s.reportedCycle ? `provider reported ${cyc(Date.parse(s.reportedCycle))} as latest (not confirmed)` : "run unknown";
        let ch = "";
        if (b && b.sources[id] && st.files[s.file] && st.files[b.sources[id].file]) {
          const items2 = TA.compareSource(st.files[s.file].rows, st.files[b.sources[id].file].rows), notes = [];
          items2.forEach((it) => Object.entries(it.fields).forEach(([f, v]) => { if (Math.abs(v.delta) >= TA.WORD[f][1]) notes.push(`${dayLabel(it.day)} ${f === "qpf" ? "precip" : f === "sn" ? "snow" : f} ${fmt(f, v.from)} → ${fmt(f, v.to)}`); }));
          ch = notes.length ? ` · since the previous snapshot: ${E(notes.slice(0, 4).join("; "))}` : " · no material change since the previous snapshot";
        }
        items.push(`<li>${E(name(id))}: snapshot ${E(new Date(s.retrievedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}, ${E(lab)}${ch}</li>`);
      });
      return `<p class="msg"><b>Ensembles and NWS</b> cannot be retrieved by run, so they are archived as timestamped snapshots and kept out of the run-to-run lines above:</p><ul class="msg">${items.join("")}</ul>`;
    }
    /* Guidance updates card: archive block (or why it is unavailable) */
    function cardHtml() {
      if (st.status === "elsewhere") return `<p class="msg">The shared run archive covers CVG only. For this location, the comparison below uses updates saved in this browser.</p>`;
      if (st.status === "loading" || st.status === "idle") return `<p class="msg">Loading the CVG run archive…</p>`;
      if (st.status === "error") return `<p class="msg">The CVG run archive is unavailable right now (${E(st.err)}); the comparison below uses updates saved in this browser.</p>`;
      const t = result(), nw = newest();
      return `<div class="archive-trends"><div class="row" style="justify-content:space-between;align-items:end;gap:8px;flex-wrap:wrap"><h3 style="margin:0">Run-to-run trends at CVG</h3>
        <label>Compare newest run with<select id="archiveLag" class="input">${LAGS.map(([h, l]) => `<option value="${h}" ${h === st.lag ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <p class="msg">Newest archived run ${nw ? E(cyc(nw)) : "—"} · archive updated ${E(new Date(st.index.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}. Each model compared with its own run ${st.lag} h earlier.</p>
        ${t.lines.length ? `<ul class="model-change-list">${linesHtml(t.lines)}</ul>` : `<p class="focus-empty">${t.perSource.length >= 3 ? "No consistent trend across models for these runs." : "Not enough archived runs to compare yet."}</p>`}
        ${detailsHtml(t)}</div><h3 style="margin-top:14px">Updates saved in this browser</h3>`;
    }
    function timingHtml(day) {
      if (st.status !== "ready") return "";
      const t = result(), ls = t.lines.filter((l) => l.day === day && ["onset", "end", "signal", "rounds"].includes(l.kind));
      return `<p class="msg" style="margin-top:8px"><b>Run-to-run timing trend (CVG archive, vs ${st.lag} h earlier):</b> ${ls.length ? "" : "no consistent change for this date."}</p>${ls.length ? `<ul class="model-change-list">${ls.map((l) => `<li>${E(l.text)}</li>`).join("")}</ul>` : ""}`;
    }
    function wire(container) {
      const s = container && container.querySelector("#archiveLag");
      if (s) s.addEventListener("change", () => { st.lag = +s.value; try { localStorage.setItem("ops_trend_lag", String(st.lag)); } catch (e) { /* ok */ } rerender(); });
    }
    return { load, cardHtml, timingHtml, wire, state: () => st };
  }
  root.TrendArchiveUI = { create, near, CVG };
})(typeof globalThis !== "undefined" ? globalThis : this);
