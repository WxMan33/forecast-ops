/* Model maps: HRRR cycle comparison (maps.html?domain=conus&compare=1&a=RUN&b=RUN&field=F&valid=ISO&map=lat,lon,zoom).
   Two runs side by side at the same valid time, field, zoom and position. Each panel is the single-run viewer embedded
   (maps.html?domain=conus&embed=1), so values, tiles and checks are exactly the single-run ones; this page only keeps
   the panels in step: field, valid time, pan/zoom and the tapped point. Phone: one panel at a time with an A/B toggle.
   Run totals of different lengths are flagged; a valid time one run doesn't cover is said so in that panel. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, esc = O.esc, Q = new URLSearchParams(location.search), TZ = "America/New_York";
  const DATA = (Q.get("data") || "https://wxman33.github.io/forecast-ops-maps/data").replace(/\/$/, ""), SITE = DATA.replace(/\/data$/, "");
  const PHONE = () => innerWidth < 700;
  const fmtLocal = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" });
  const fmtUTC = (ms) => { const d = new Date(ms).toISOString(); return `${d.slice(11, 13)}Z ${new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}`; };
  const getJSON = async (u) => { const r = await fetch(u + (u.includes("?") ? "&" : "?") + "t=" + Math.floor(Date.now() / 60000)); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  const st = { shade: (() => { const v = Number(Q.get("shade")); return Q.get("shade") != null && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 100; })(), values: (() => { try { return Q.get("values") === "0" ? false : localStorage.getItem("conus_values") !== "0"; } catch (e) { return Q.get("values") !== "0"; } })(), index: null, man: {}, run: { A: null, B: null }, field: Q.get("field") || "asnow_run", valid: null, times: [], view: null, active: "A", frames: {}, play: null };

  const FIELDS = () => window.MapsConus.FIELDS, MOD = () => window.MapsConus.MODEL;
  const withModel = (q) => { if (MOD().key !== "hrrr") q.set("model", MOD().key); return q; };
  const panel = (k) => st.frames[k] && st.frames[k].contentWindow && st.frames[k].contentWindow.MapsConus && st.frames[k].contentWindow.MapsConus.api;
  const fhAt = (k, ms) => { const m = st.man[k]; if (!m) return null; const h = m.hours.find((x) => Date.parse(m.valid[x]) === ms); return h == null ? null : h; };
  const runLabel = (r, i) => `${fmtUTC(Date.parse(r.cycle))}${r.status === "in progress" ? " · in progress" : ""}${i === 0 ? " · newest" : ""}`;

  function layout() {
    const main = document.querySelector(".main");
    main.innerHTML = `<section class="cmp" aria-label="${esc(MOD().name)} cycle comparison">
      <div class="cmp-ctl">
        <label><span>Field</span><select class="input inline" id="cmpField"></select></label>
        <label><span><b class="panel">A</b> run</span><select class="input inline" id="cmpA"></select></label>
        <label><span><b class="panel b">B</b> run</span><select class="input inline" id="cmpB"></select></label>
        <button type="button" class="btn ghost sm" id="cmpVals" aria-pressed="true">VALUES ON</button>
        <div class="shadectl" id="cmpShadeCtl"><label for="cmpShade">Shading</label><input type="range" id="cmpShade" min="0" max="100" step="5" value="100" aria-valuetext="100%" title="Fade the forecast colours in both panels; numbers, names, boundaries and legend stay as they are"><output id="cmpShadeOut" for="cmpShade">100%</output><button type="button" class="btn ghost sm" id="cmpShadeReset" title="Back to full shading" disabled>RESET</button></div>
        <a class="btn ghost sm" id="cmpSingle" href="#">SINGLE RUN</a>
      </div>
      <div class="cmp-time">
        <button type="button" class="btn sm" id="cmpPlay" aria-pressed="false">PLAY</button>
        <button type="button" class="btn ghost sm" id="cmpPrev" aria-label="Previous valid time">◀</button>
        <input type="range" id="cmpSl" min="0" max="0" step="1" aria-label="Valid time">
        <button type="button" class="btn ghost sm" id="cmpNext" aria-label="Next valid time">▶</button>
        <div class="cmp-valid mono" id="cmpValid"></div>
      </div>
      <div class="cmp-status" id="cmpStatus" role="status" hidden></div>
      <div class="cmp-note" id="cmpNote" role="status"></div>
      <div class="cmp-ab" role="tablist" aria-label="Show run"><button type="button" role="tab" id="abA" aria-selected="true"></button><button type="button" role="tab" id="abB" aria-selected="false"></button></div>
      <div class="cmp-panels" id="cmpPanels">
        <div class="cmp-p" data-p="A" data-active="1"><iframe id="frA" title="Run A"></iframe></div>
        <div class="cmp-p" data-p="B"><iframe id="frB" title="Run B"></iframe></div>
      </div>
      <p class="cmp-credit">Data: ${esc(MOD().source)} · Forecast Ops output · Model guidance, not an official forecast · Not endorsed by NOAA · Basemap: U.S. Census Bureau via us-atlas, Natural Earth</p>
      <p class="msg cmp-help">Both panels are the full-precision single-run viewer: pan, zoom or tap a point in either and the other follows. Each panel states its own run, forecast hour and accumulation window.</p>
    </section>`;
    st.frames = { A: $("frA"), B: $("frB") };
  }
  function frameSrc(k) {
    const q = new URLSearchParams({ domain: "conus", embed: "1", panel: k, run: st.run[k].id, field: st.field, ...(st.values ? {} : { values: "0" }), ...(st.shade !== 100 ? { shade: String(st.shade) } : {}) });
    withModel(q); if (Q.get("data")) q.set("data", Q.get("data"));
    if (st.view) q.set("map", `${st.view[1].toFixed(4)},${st.view[0].toFixed(4)},${st.view[2].toFixed(2)}`);
    if (st.valid != null) q.set("valid", new Date(st.valid).toISOString());
    return `maps.html?${q.toString()}`;
  }
  async function loadRun(k, id) {
    const r = st.index.runs.find((x) => x.id === id) || st.index.runs[k === "A" ? 0 : 1] || st.index.runs[0];
    st.run[k] = r; st.man[k] = await getJSON(`${SITE}/${r.path}/manifest.json`);
  }
  function times() {
    const set = new Set(); ["A", "B"].forEach((k) => { const m = st.man[k]; if (m) m.hours.forEach((h) => set.add(Date.parse(m.valid[h]))); });
    st.times = [...set].sort((a, b) => a - b);
    $("cmpSl").max = String(Math.max(0, st.times.length - 1));
  }
  /* default valid time: the one asked for, else the first both runs share where the field exists in both (F06 of A if possible) */
  function defaultValid() {
    const want = Q.get("valid") ? Date.parse(Q.get("valid")) : null; if (want != null && st.times.includes(want)) return want;
    const shown = st.mode === "single" ? ["A"] : ["A", "B"];
    const both = st.times.filter((t) => shown.every((k) => { const h = fhAt(k, t), rec = h == null ? null : st.man[k].fields[st.field] && st.man[k].fields[st.field].hours[String(h)]; return rec && !rec.notApplicable; }));
    const a6 = both.find((t) => fhAt("A", t) === 6); return a6 != null ? a6 : both.length ? both[Math.min(both.length - 1, 5)] : st.times[0];
  }
  /* what each panel shows, and whether the two are like for like */
  function compareNote() {
    const F = FIELDS()[st.field], v = st.valid, h = { A: fhAt("A", v), B: fhAt("B", v) }, init = (k) => Date.parse(st.man[k].cycle);
    const f2 = (x) => `F${String(x).padStart(2, "0")}`;
    const lines = [];
    if (st.mode === "single") {
      const f2s = (x) => `F${String(x).padStart(2, "0")}`;
      $("cmpNote").innerHTML = h.A == null ? `This run has no forecast hour valid at ${esc(fmtLocal(v))}.` : `${esc(fmtLocal(v))} (${f2s(h.A)}).`; $("cmpNote").dataset.likeForLike = "true";
      $("cmpValid").textContent = `${fmtLocal(v)} · A ${h.A == null ? "—" : f2s(h.A)}`; $("cmpSl").value = String(st.times.indexOf(v)); return;
    }
    ["A", "B"].forEach((k) => { if (h[k] == null) lines.push(`<b>${k}</b> (${esc(fmtUTC(init(k)))} run) has no forecast hour valid at ${esc(fmtLocal(v))}.`); });
    if (h.A != null && h.B != null) {
      if (F.window === "run") lines.push(h.A === h.B ? `Both run totals cover ${h.A} h.` :
        `<b>Not like for like:</b> A totals ${h.A} h (${esc(fmtLocal(init("A")))} to ${esc(fmtLocal(v))}, ${f2(0)}–${f2(h.A)}); B totals ${h.B} h (${esc(fmtLocal(init("B")))} to ${esc(fmtLocal(v))}, ${f2(0)}–${f2(h.B)}). ` +
          `The ${h.B > h.A ? "B" : "A"} total includes ${Math.abs(h.B - h.A)} more hour${Math.abs(h.B - h.A) === 1 ? "" : "s"}; compare the 1-h field for the same hour, or allow for the extra time.`);
      else if (typeof F.window === "number") lines.push(`Like for like: both panels show the ${F.window === 1 ? "hour" : `${F.window} h`} ending ${esc(fmtLocal(v))} (A ${f2(h.A)}, B ${f2(h.B)}).`);
      else lines.push(`Same valid time: ${esc(fmtLocal(v))} (A ${f2(h.A)}, B ${f2(h.B)}).`);
    }
    $("cmpNote").innerHTML = lines.join(" "); $("cmpNote").dataset.likeForLike = String(!(F.window === "run" && h.A != null && h.B != null && h.A !== h.B));
    $("cmpValid").textContent = `${fmtLocal(v)} · A ${h.A == null ? "—" : f2(h.A)} · B ${h.B == null ? "—" : f2(h.B)}`;
    $("cmpSl").value = String(st.times.indexOf(v));
    ["A", "B"].forEach((k) => { $(`ab${k}`).innerHTML = `<b class="panel${k === "B" ? " b" : ""}">${k}</b> ${esc(fmtUTC(init(k)).slice(0, 3))} ${h[k] == null ? "no hour" : f2(h[k])}`; });
  }
  function share() {
    const q = new URLSearchParams({ domain: "conus", compare: "1", a: st.run.A.id, ...(st.run.B ? { b: st.run.B.id } : {}), field: st.field, valid: new Date(st.valid).toISOString() });
    withModel(q); if (Q.get("data")) q.set("data", Q.get("data")); if (st.view) q.set("map", `${st.view[1].toFixed(3)},${st.view[0].toFixed(3)},${st.view[2].toFixed(2)}`); if (!st.values) q.set("values", "0"); if (st.shade !== 100) q.set("shade", String(st.shade));
    try { history.replaceState(null, "", `${location.pathname}?${q.toString()}`); } catch (e) { /* file:// */ }
    const s = withModel(new URLSearchParams({ domain: "conus", run: st.run.A.id, field: st.field })); if (Q.get("data")) s.set("data", Q.get("data"));
    const hA = fhAt("A", st.valid); if (hA != null) s.set("fh", String(hA)); if (st.view) s.set("map", q.get("map")); if (st.shade !== 100) s.set("shade", String(st.shade)); if (!st.values) s.set("values", "0");
    $("cmpSingle").href = `maps.html?${s.toString()}`;
  }
  const ready = (k) => new Promise((ok, no) => { const t0 = Date.now(); const tick = () => { const a = panel(k); if (a && a.ready()) return ok(a); if (Date.now() - t0 > 90000) return no(new Error(`panel ${k} did not load`)); setTimeout(tick, 150); }; tick(); });
  async function openPanel(k) { st.frames[k].src = frameSrc(k); await new Promise((r) => st.frames[k].addEventListener("load", r, { once: true })); const a = await ready(k); a.setValid(st.valid); return a; }
  function setValid(ms) { st.valid = ms; ["A", "B"].forEach((k) => { const a = panel(k); if (a) a.setValid(ms); }); compareNote(); share(); }
  function setActive(k) {
    st.active = k; document.querySelectorAll(".cmp-p").forEach((p) => (p.dataset.active = p.dataset.p === k ? "1" : "0"));
    ["A", "B"].forEach((x) => $(`ab${x}`).setAttribute("aria-selected", String(x === k)));
    const a = panel(k); if (a) a.resize();
  }
  function stop() { if (st.play) clearInterval(st.play); st.play = null; $("cmpPlay").textContent = "PLAY"; $("cmpPlay").setAttribute("aria-pressed", "false"); }

  /* nothing to show (no runs, or the run list failed): say why, and switch every control off */
  function unavailable(msg) {
    st.mode = "none"; $("cmpStatus").innerHTML = `<p><b>${esc(msg)}</b></p>`; $("cmpStatus").hidden = false; $("cmpNote").textContent = "";
    ["cmpField", "cmpA", "cmpB", "cmpPlay", "cmpPrev", "cmpNext", "cmpSl", "cmpVals", "cmpShade", "cmpShadeReset"].forEach((id) => { $(id).disabled = true; $(id).setAttribute("aria-disabled", "true"); });
    $("cmpValid").textContent = "—"; $("cmpPanels").hidden = true; document.querySelector(".cmp-ab").hidden = true;
    window.__cmp = { st, panel };
  }
  async function start() {
    O.shell("maps", "Model maps", { forecastPoint: false, subtitle: `Beta · ${MOD().label} · cycle comparison` });
    document.body.classList.add("maps-conus", "conus-compare"); layout();
    const bar = document.querySelector("header.statusbar"); if (bar) document.documentElement.style.setProperty("--statusbar-h", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    /* what the index actually says: no runs, one run, or a pair; and why a run is missing, when the build recorded it */
    let idx;
    try { idx = await getJSON(`${DATA}/${MOD().index}`); }
    catch (e) { return unavailable(`The ${MOD().name} run list could not be loaded (${e.message}), so there is nothing to show. Try again in a few minutes.`); }
    const runs = (idx.runs || []).slice().sort((a, b) => Date.parse(b.cycle) - Date.parse(a.cycle)); st.index = { ...idx, runs };
    const failed = (idx.failures || []).map((f) => `the ${fmtUTC(Date.UTC(+f.id.slice(0, 4), +f.id.slice(4, 6) - 1, +f.id.slice(6, 8), +f.id.slice(8, 10)))} run didn't publish in the latest build (${String(f.error || "").replace(/: Unknown Error$/, "")})`);
    if (!runs.length) return unavailable(`No ${MOD().name} runs are published right now${failed.length ? `: ${failed.join("; ")}` : ""}.`);
    const published = new Set(runs.flatMap((r) => r.fields || [])), F = FIELDS();
    if (!F[st.field] || (published.size && !published.has(st.field))) st.field = ["asnow_run", "pop6h", "t2m"].find((f) => published.has(f)) || [...published][0];
    $("cmpField").innerHTML = window.MapsConus.fieldOptions(published); $("cmpField").value = st.field;
    ["A", "B"].forEach((k) => { $(`cmp${k}`).innerHTML = runs.map((r, i) => `<option value="${esc(r.id)}">${esc(runLabel(r, i))}</option>`).join(""); });
    /* a shared link whose run has rotated out: say so and use the nearest published runs, never the same run twice */
    const want = { A: Q.get("a"), B: Q.get("b") }, has = (id) => runs.some((r) => r.id === id), notes = [];
    let a = has(want.A) ? want.A : null, b = has(want.B) && want.B !== a ? want.B : null;
    if (!a) a = (runs.find((r) => r.id !== b) || runs[0]).id;
    if (!b) b = (runs.find((r) => r.id !== a) || {}).id || null;
    ["A", "B"].forEach((k) => { const got = k === "A" ? a : b; if (want[k] && want[k] !== got) notes.push(`The ${fmtUTC(Date.UTC(+want[k].slice(0, 4), +want[k].slice(4, 6) - 1, +want[k].slice(6, 8), +want[k].slice(8, 10)))} run in this link is no longer published (${MOD().name} runs rotate out)${got ? `; ${k} shows the ${fmtUTC(Date.parse(runs.find((r) => r.id === got).cycle))} run instead` : ""}.`); });
    if (!b) {   /* one run: show it, and explain why there is no comparison */
      st.mode = "single"; await loadRun("A", a); $("cmpA").value = st.run.A.id;
      $("cmpB").innerHTML = '<option value="">No second run</option>'; $("cmpB").disabled = true;
      notes.push(`Comparison needs two runs. Only the ${fmtUTC(Date.parse(st.run.A.cycle))} run is published right now${failed.length ? `; ${failed.join("; ")}` : ""}. It is shown on its own; this page compares side by side once a second run is published.`);
      document.querySelector(".cmp").classList.add("single"); st.frames.B.closest(".cmp-p").hidden = true; document.querySelector(".cmp-ab").hidden = true;
    } else { st.mode = "pair"; await Promise.all([loadRun("A", a), loadRun("B", b)]); $("cmpA").value = st.run.A.id; $("cmpB").value = st.run.B.id; }
    $("cmpStatus").innerHTML = notes.map((n) => `<p>${esc(n)}</p>`).join(""); $("cmpStatus").hidden = !notes.length;
    const mv = (Q.get("map") || "").split(",").map(Number); st.view = mv.length === 3 && mv.every(Number.isFinite) ? [mv[1], mv[0], mv[2]] : null;
    times(); st.valid = defaultValid(); compareNote(); share();
    setActive("A");
    if (st.mode === "single") { await openPanel("A"); }
    else
    await Promise.all([openPanel("A"), openPanel("B")]);
    if (!st.view) { const c = st.frames.A.contentWindow.__conus.map, cc = c.getCenter(); st.view = [cc.lng, cc.lat, c.getZoom()]; if (st.mode === "pair") panel("B").view([cc.lng, cc.lat], c.getZoom()); }
    compareNote(); share();
    /* keep the two panels in step */
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || !e.data || !e.data.conus) return; const from = e.data.panel, other = from === "A" ? "B" : "A", o = panel(other);
      if (e.data.conus === "view") { st.view = [e.data.center[0], e.data.center[1], e.data.zoom]; if (o) o.view(e.data.center, e.data.zoom); share(); }
      if (e.data.conus === "point" && o) o.point(e.data.lat, e.data.lon);
    });
    $("cmpField").addEventListener("change", () => { stop(); st.field = $("cmpField").value; ["A", "B"].forEach((k) => panel(k) && panel(k).setField(st.field)); compareNote(); share(); });
    ["A", "B"].forEach((k) => $(`cmp${k}`).addEventListener("change", async () => { stop(); await loadRun(k, $(`cmp${k}`).value); times(); if (!st.times.includes(st.valid)) st.valid = defaultValid(); compareNote(); share(); await openPanel(k); compareNote(); }));
    const step = (d) => { const i = st.times.indexOf(st.valid), j = Math.min(st.times.length - 1, Math.max(0, i + d)); if (j !== i) setValid(st.times[j]); };
    $("cmpSl").addEventListener("input", () => { stop(); setValid(st.times[+$("cmpSl").value]); });
    $("cmpPrev").addEventListener("click", () => { stop(); step(-1); }); $("cmpNext").addEventListener("click", () => { stop(); step(1); });
    $("cmpPlay").addEventListener("click", () => { if (st.play) { stop(); return; } $("cmpPlay").textContent = "PAUSE"; $("cmpPlay").setAttribute("aria-pressed", "true");
      st.play = setInterval(() => { const i = st.times.indexOf(st.valid); setValid(st.times[(i + 1) % st.times.length]); }, PHONE() ? 1100 : 900); });
    ["A", "B"].forEach((k) => $(`ab${k}`).addEventListener("click", () => setActive(k)));
    const vals = (on) => { st.values = on; $("cmpVals").setAttribute("aria-pressed", String(on)); $("cmpVals").textContent = on ? "VALUES ON" : "VALUES OFF"; ["A", "B"].forEach((k) => panel(k) && panel(k).setValues(on)); share(); };
    $("cmpVals").addEventListener("click", () => vals(!st.values)); vals(st.values);
    /* one shading slider for both panels, so A and B always look alike */
    const shade = (v) => { st.shade = Math.max(0, Math.min(100, Math.round(+v))); $("cmpShade").value = String(st.shade); $("cmpShade").setAttribute("aria-valuetext", `${st.shade}%`);
      $("cmpShadeOut").textContent = `${st.shade}%`; $("cmpShadeReset").disabled = st.shade === 100; ["A", "B"].forEach((k) => panel(k) && panel(k).setShade(st.shade)); share(); };
    $("cmpShade").addEventListener("input", () => shade($("cmpShade").value)); $("cmpShadeReset").addEventListener("click", () => shade(100)); shade(st.shade);
    window.__cmp = { st, panel };   // test hook
  }
  window.MapsConusCompare = { start };
})();
