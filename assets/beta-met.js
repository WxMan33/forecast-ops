/* Meteorologist beta: a tool menu in the Forecast Ops style. The selected city (CVG by default) is the shared
   forecast point: every tool opens for it, and MENU in the shared navigation comes back here with it. */
(function () {
  "use strict";
  const O = window.Ops, $ = O.$, esc = O.esc, U = window.BetaUI, S = window.BetaStory;
  const CVG = { name: O.PRESETS[0][0], lat: O.PRESETS[0][1], lon: O.PRESETS[0][2] };
  const hasPoint = (() => { const q = new URLSearchParams(location.search); return isFinite(parseFloat(q.get("lat"))) && isFinite(parseFloat(q.get("lon"))); })(); // read before the shell rewrites the URL
  try { sessionStorage.setItem("fo_beta_aud", "met"); } catch (e) { /* no storage */ }
  O.shell("betamenu", "Forecast Ops");
  if (!hasPoint) O.setLocation(CVG); // a fresh link opens on CVG; a shared or returning link keeps its city
  document.title = "Forecast Ops · Meteorologist beta";

  const TOOLS = [
    { id: "thunder", page: "thunder.html", kick: "Storms", name: "Thunder", desc: "Storm timing and how guidance differs on thunder potential." },
    { id: "soundings", page: "severe.html", kick: "Severe", name: "Severe & Soundings", desc: "Forecast profiles and the ingredients that could support severe storms." },
    { id: "winter", page: "winter.html", kick: "Winter", name: "Winter", desc: "Snow and ice guidance, ensemble ranges and chances of reaching key thresholds." },
    { id: "almanac", page: "almanac.html", kick: "Climate", name: "Almanac", desc: "Normals, records and observations from the nearest official climate station, plus daylight for this point." },
    { id: "map", page: "maps.html", kick: "Maps · in development", name: "Model Maps", desc: "HRRR forecast layers for the Cincinnati Tri-State only.", dev: true },
  ];
  const url = (page, hash) => O.shareUrl(page) + (hash ? "#" + hash : "");
  function draw() {
    const here = O.location, short = here.name.split(",")[0];
    $("lead").innerHTML = `<div class="hubcard lead">
        <a class="lead-main" href="${esc(url("blend.html"))}" data-tool="models"><span class="kicker">Start here · ${esc(short)}</span><h2>Model Blend</h2>
          <p>Daily and hourly forecasts, adjustable model weights and official NWS highs and lows.</p><span class="go">OPEN MODEL BLEND →</span></a>
        <div class="lead-links"><span class="kick">Shortcuts</span><a href="${esc(url("blend.html", "forecastControls"))}" data-tool="weights">Weights</a><a href="${esc(url("blend.html", "modelTrendCard"))}" data-tool="runs">Runs</a></div></div>`;
    $("tools").innerHTML = TOOLS.map((t) => `<a class="hubcard${t.dev ? " dev" : ""}" href="${esc(url(t.page))}" data-tool="${t.id}"><span class="kicker">${esc(t.kick)}</span><h2>${esc(t.name)}</h2><p>${esc(t.desc)}</p><span class="go">OPEN →</span></a>`).join("");
    document.querySelectorAll("[data-tool]").forEach((a) => a.addEventListener("click", () => { U.track("tool_opened", { tool: a.dataset.tool === "soundings" ? "soundings" : a.dataset.tool }); if (["models", "runs"].includes(a.dataset.tool)) U.track("models_compared"); }));
    document.body.dataset.place = here.name;
  }
  /* climate station for this point: shown here so the Almanac's reference is never a surprise */
  let gen = 0;
  async function station() {
    const g = ++gen, here = O.location; $("climName").textContent = "Finding…"; $("climMeta").textContent = ""; document.body.dataset.station = "";
    const fetchJSON = (u, o) => fetch(u, o).then((r) => (r.ok ? r.json() : { error: "HTTP " + r.status })).catch((e) => ({ error: String(e) }));
    const r = await window.ClimateStation.forPoint(here, { fetchJSON }).catch(() => ({ station: null, missing: ["lookup failed"] }));
    if (g !== gen) return; // a slow answer for the previous city is dropped
    const st = r.station;
    $("climName").textContent = st ? `${st.faa} · ${st.name}` : "No verified station";
    $("climMeta").textContent = st ? `NWS ${st.office} climate site · ${Math.round(st.km)} km away · ${st.thr ? `${st.thr.name} since ${st.thr.since}` : "station record (no threaded city record)"}. Change it on the Almanac.` : (r.missing || []).join(" ");
    document.body.dataset.station = st ? st.faa : "none";
  }
  U.placePicker($("picker"), { current: O.location, link: () => O.shareUrl(), label: "Search a U.S. city",
    onPick(p) { O.setLocation({ name: p.name, lat: p.lat, lon: p.lon }); U.track("city_selected", { market: S.market(p.lat, p.lon).tuned ? "cincinnati" : "elsewhere" }); } });
  O.onLocation(() => { draw(); station(); });
  draw(); station();
})();
