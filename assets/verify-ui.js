/* Private verification dashboard. Independent of the forecast pages: it loads report files from the
   private data repository through the GitHub contents API, using a token kept in localStorage.
   Review decisions are written as new files under corrections/ (never edits), so every change has an
   audit trail; without a write token the decision can be downloaded and committed by hand. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  $("repo").value = ls.get("vf_repo", "WxMan33/forecast-ops-data"); $("tok").value = ls.get("vf_tok", ""); $("branch").value = ls.get("vf_branch", "main"); $("root").value = ls.get("vf_root", "");
  const f = (x, d = 1) => (x == null || !isFinite(x) ? "—" : (+x).toFixed(d)), pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
  let IDX = null, SC = null, RQ = null;
  const cfg = () => ({ repo: $("repo").value.trim(), tok: $("tok").value.trim(), branch: $("branch").value.trim() || "main", root: $("root").value.trim().replace(/^\/|\/$/g, "") });
  const p = (rel) => (cfg().root ? `${cfg().root}/${rel}` : rel);
  async function gh(rel, { raw = true, method = "GET", body } = {}) {
    const c = cfg(), url = `https://api.github.com/repos/${c.repo}/contents/${p(rel).split("/").map(encodeURIComponent).join("/")}${method === "GET" ? `?ref=${encodeURIComponent(c.branch)}` : ""}`;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
    let r;
    try { r = await fetch(url, { signal: ctl.signal, method, headers: { Authorization: `Bearer ${c.tok}`, Accept: raw && method === "GET" ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error(`${rel}: ${e.name === "AbortError" ? "no response after 30 s" : e.message}`); }
    finally { clearTimeout(to); }
    if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
    return r;
  }
  const getJSON = async (rel) => (await gh(rel)).json();
  async function imgURL(rel) { const b = await (await gh(rel)).blob(); return URL.createObjectURL(b); }

  $("forget").addEventListener("click", () => { ls.del("vf_tok"); $("tok").value = ""; $("msg").textContent = "Token removed from this browser."; });
  $("load").addEventListener("click", load);
  if ($("tok").value) load();

  async function load() {
    const c = cfg(); ls.set("vf_repo", c.repo); ls.set("vf_tok", c.tok); ls.set("vf_branch", c.branch); ls.set("vf_root", c.root);
    $("msg").className = "msg"; $("msg").textContent = "Loading reports…";
    try { [IDX, SC, RQ] = await Promise.all([getJSON("reports/index.json"), getJSON("reports/scores.json"), getJSON("reports/review-queue.json")]); }
    catch (e) { $("msg").className = "msg err"; $("msg").textContent = `Couldn't load: ${e.message}. Check the repository, branch, folder and token.`; return; }
    $("msg").textContent = `Reports generated ${IDX.at}.`;
    render();
  }

  let tab = ls.get("vf_tab", "health");
  function render() {
    const tabs = [["health", "Collector health"], ["scores", "Scorecards"], ["tv", "TV products & review"], ["recipes", "Blend recipes"], ["export", "Exports"]];
    $("out").innerHTML = `<div class="vtabs">${tabs.map(([k, l]) => `<button class="btn ${k === tab ? "" : "ghost"} sm" data-tab="${k}" type="button">${l}${k === "tv" && IDX.reviewQueue ? ` (${IDX.reviewQueue})` : ""}</button>`).join("")}</div><div id="pane" style="margin-top:12px"></div>`;
    $("out").querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; ls.set("vf_tab", tab); render(); }));
    ({ health, scores, tv, recipes, exportsPane })[tab === "export" ? "exportsPane" : tab]();
  }

  function health() {
    const H = IDX.health, L = IDX.lastRuns || {};
    const tile = (k, v, s) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s || ""}</span></div>`;
    $("pane").innerHTML = `<section class="card"><div class="section-title">Collector health · ${esc(IDX.loc.name)}</div>
      <div class="tiles">${tile("Scheduled slots", H.expected, "since the first scheduled capture")}${tile("On time", H.slots.filter((s) => s.status === "on_time").length, "")}${tile("Late", H.slots.filter((s) => s.status === "late").length, "kept, labelled, excluded from matched comparisons")}${tile("Missed / failed", H.gaps.length, "")}${tile("Manual captures", H.manual, "pilot runs, never on-time")}${tile("Review queue", IDX.reviewQueue, "TV values awaiting review")}</div>
      <p class="msg" style="margin-top:10px">Recent slots (oldest → newest): green on time · yellow late · orange off schedule · red missed/failed · dashed pending.</p>
      <div class="slots">${H.slots.map((s) => `<span class="slot ${esc(s.status)}" title="${esc(`${s.id}: ${s.status}${s.delayMin != null ? ` (${f(s.delayMin)} min)` : ""}`)}"></span>`).join("") || '<span class="msg">No scheduled captures yet.</span>'}</div>
      <p class="msg" style="margin-top:8px">Last collect: ${esc(L.collect ? `${L.collect.at} · ${L.collect.outcome}` : "—")} · last successful observe: ${esc(L.observe ? L.observe.at : "—")} · last score: ${esc(L.score ? L.score.at : "—")}</p></section>
      <section class="card" style="margin-top:14px"><div class="section-title">Captures</div><div class="tablewrap"><table><thead><tr><th>Capture</th><th>Trigger</th><th>Started (UTC)</th><th>Timeliness</th><th>Outcome</th><th style="text-align:left">Problems</th><th style="text-align:left">TV</th></tr></thead><tbody>
      ${IDX.captures.slice().reverse().map((c) => `<tr><td class="mono">${esc(c.captureId)}</td><td>${esc(c.trigger)}</td><td class="mono">${esc(c.startedAt)}</td><td class="${c.timeliness.status === "on_time" ? "" : "warn"}">${esc(c.timeliness.status)}${c.timeliness.delayMin != null ? ` ${f(c.timeliness.delayMin)}m` : ""}</td><td class="${c.outcome === "ok" ? "" : "bad"}">${esc(c.outcome)}</td><td style="text-align:left;white-space:normal">${esc((c.summary.failed || []).join("; ") || "—")}</td><td style="text-align:left;white-space:normal">${esc((c.tv || []).map((t) => `${t.product}: ${t.status}${t.review ? "/" + t.review : ""}`).join(" · "))}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="card" style="margin-top:14px"><div class="section-title">Recent job runs</div><div class="tablewrap"><table><thead><tr><th>Job</th><th>At</th><th>Outcome</th><th style="text-align:left">Detail</th></tr></thead><tbody>
      ${IDX.runs.slice().reverse().slice(0, 40).map((r) => `<tr><td>${esc(r.job)}</td><td class="mono">${esc(r.at)}</td><td class="${/ok|not-due|skipped/.test(r.outcome) ? "" : "bad"}">${esc(r.outcome)}</td><td style="text-align:left;white-space:normal">${esc(r.error || r.detail || (r.outcomes ? Object.entries(r.outcomes).map(([k, o]) => `${k}:${o.status}`).join(" ") : "") || (r.failed || []).join("; "))}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="card" style="margin-top:14px"><div class="section-title">Observations</div><p class="msg">${SC.pairsCount} forecast values scored · ${SC.pendingCount} past-window values waiting for observations (they stay unscored until an observation arrives).</p></section>`;
  }

  function scores() {
    const S = SC.summary.filter((x) => x.timeliness === "on_time" && x.lead >= 1 && x.lead <= 7);
    const targets = [...new Set(S.map((x) => x.target))];
    const tbl = (t) => {
      const rows = S.filter((x) => x.target === t), ids = [...new Set(rows.map((x) => `${x.track}|${x.id}|${x.slot}`))];
      const prob = /pop/.test(t);
      return `<section class="card" style="margin-top:14px"><div class="section-title">${esc(t)} · ${prob ? "Brier score" : "MAE"} by lead day (n in brackets)</div><div class="tablewrap"><table><thead><tr><th>Track</th><th style="text-align:left">Source / product</th><th>Slot</th>${[1, 2, 3, 4, 5, 6, 7].map((l) => `<th>D${l}</th>`).join("")}</tr></thead><tbody>
      ${ids.map((k) => { const [tr, id, sl] = k.split("|"); return `<tr><td>${esc(tr)}</td><td style="text-align:left">${esc(id)}</td><td>${esc(sl)}</td>${[1, 2, 3, 4, 5, 6, 7].map((l) => { const x = rows.find((r) => r.track === tr && r.id === id && r.slot === sl && r.lead === l); return `<td class="num" title="${x ? esc(prob ? `n ${x.n}, base rate ${pct(x.baseRate)}` : `n ${x.n}, bias ${f(x.bias)}, within 2°F ${pct(x.within2)}${x.ens ? `, ens range coverage ${pct(x.ens.inRange)}, 10–90% ${pct(x.ens.in10_90)}, width ${f(x.ens.width)}` : ""}`) : ""}">${x ? `${f(prob ? x.brier : x.mae, prob ? 3 : 1)} <span class="msg">(${x.n})</span>` : "—"}</td>`; }).join("")}</tr>`; }).join("")}</tbody></table></div></section>`;
    };
    const comps = SC.comparisons || [];
    $("pane").innerHTML = `<section class="card"><div class="section-title">Scorecards</div><p class="msg">On-time captures, lead days 1–7, each source's full available sample. Hover a cell for bias, within-2°F and ensemble coverage. Matched comparisons below use only cases every member has. Verdicts need ${SC.minDates}+ distinct valid dates and a 90% block-bootstrap interval excluding zero.</p></section>
      ${targets.map(tbl).join("") || '<section class="card"><p class="msg">Nothing scored yet: forecasts verify as their target windows end and observations arrive.</p></section>'}
      <section class="card" style="margin-top:14px"><div class="section-title">Matched comparisons</div>${comps.length ? comps.map((c) => `<div style="margin-bottom:10px"><b>${esc(c.set)} · ${esc(c.target)} · D${c.lead} · ${esc(c.slot)}</b> <span class="msg">${c.n} cases, ${c.dates} dates, ${esc(c.metric)}</span><div class="msg">${Object.entries(c.members).map(([m, x]) => `${esc(m)} ${f(x.score, 2)}${x.verdict ? ` (${esc(x.verdict)}${x.ci90 ? `, Δ ${f(x.diffVsRef, 2)}, 90% CI ${f(x.ci90[0], 2)}…${f(x.ci90[1], 2)}` : ""})` : ""}`).join(" · ")}</div></div>`).join("") : '<p class="msg">No matched cases yet.</p>'}</section>
      ${SC.hourly && SC.hourly.length ? `<section class="card" style="margin-top:14px"><div class="section-title">Hourly temperature</div><div class="tablewrap"><table><thead><tr><th style="text-align:left">Source</th><th>Slot</th><th>Lead day</th><th>n</th><th>MAE</th><th>Bias</th><th>Within 2°F</th></tr></thead><tbody>${SC.hourly.sort((a, b) => a.id.localeCompare(b.id) || a.leadDay - b.leadDay).map((h) => `<tr><td style="text-align:left">${esc(h.id)}</td><td>${esc(h.slot)}</td><td>${h.leadDay}</td><td>${h.n}</td><td class="num">${f(h.mae)}</td><td class="num">${f(h.bias)}</td><td class="num">${pct(h.within2)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  }

  async function tv() {
    const items = (IDX.tvLatest || []);
    $("pane").innerHTML = `<section class="card"><div class="section-title">TV products · latest capture each</div><p class="msg">Benchmarks only, not blend ingredients. Location and authorship are as recorded; values flagged "automated" are not attributed to the weather team.</p></section>
      <div id="tvItems"></div><section class="card" style="margin-top:14px"><div class="section-title">Review queue (${RQ.items.length})</div><div id="rq"></div></section>`;
    $("tvItems").innerHTML = items.map((r, i) => `<section class="card" style="margin-top:14px"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><b>${esc(r.station)} · ${esc(r.label || r.product)}</b><span class="msg">${esc(r.captureId)} · ${esc(r.reviewStatus)}</span></div>
      <p class="msg">Retrieved ${esc(r.retrievedAt)} · issued ${esc(r.issuedAt || "unknown")} · age ${f(r.freshness && r.freshness.ageH)} h${r.freshness && r.freshness.stale ? ' · <b style="color:var(--action)">STALE</b>' : ""} · location: ${esc(r.location && r.location.scope)} (${esc(r.location && r.location.class)}) · lows: ${esc(r.lows)} · extraction ${esc(r.extraction && r.extraction.method)} conf ${f(r.extraction && r.extraction.confidence, 2)}${r.crossCheck ? ` · cross-check ${r.crossCheck.diffs.length ? esc(r.crossCheck.diffs.join("; ")) : "agrees"}` : ""}</p>
      <div class="ev"><div id="ev${i}">${r.evidence && r.evidence[0] && /jpg|png/.test(r.evidence[0].type) ? '<span class="msg">loading evidence…</span>' : `<span class="msg">Evidence: ${esc(r.evidence && r.evidence[0] ? r.evidence[0].path : "none")} (sha256 ${esc(r.evidence && r.evidence[0] ? r.evidence[0].sha256.slice(0, 12) : "")})</span>`}</div>
      <div class="tablewrap"><table><thead><tr><th>Date</th><th>High</th><th>Low</th><th>PoP</th><th>By</th></tr></thead><tbody>${(r.days || []).map((d) => `<tr><td class="mono">${esc(d.date)}</td><td class="num">${d.hi ?? "—"}</td><td class="num">${d.lo ?? "—"}</td><td class="num">${d.pop != null ? d.pop + "%" : d.popDay != null ? `${d.popDay}/${d.popNight}%` : "—"}</td><td class="msg">${esc(d.by ? [...new Set(Object.values(d.by).filter(Boolean))].join("/") : "")}</td></tr>`).join("")}</tbody></table></div></div></section>`).join("");
    items.forEach(async (r, i) => { if (r.evidence && r.evidence[0] && /jpg|png/.test(r.evidence[0].type)) { try { $("ev" + i).innerHTML = `<img alt="Original evidence" src="${await imgURL(r.evidence[0].path)}">`; } catch (e) { $("ev" + i).innerHTML = `<span class="msg err">${esc(e.message)}</span>`; } } });
    $("rq").innerHTML = RQ.items.length ? RQ.items.map((q, i) => `<div class="card tight" style="margin-bottom:10px"><b>${esc(q.captureId)} · ${esc(q.product)}</b> <span class="msg">${esc(q.reason)}${q.captures > 1 ? ` · identical evidence in ${q.captures} captures since ${esc(q.firstCapture)}` : ""}</span>
      <div class="ev" style="margin-top:8px"><div id="rqe${i}">${q.text ? `<pre>${esc(q.text)}</pre>` : '<span class="msg">loading…</span>'}</div><div>
      <div class="tablewrap"><table><thead><tr><th>Date</th><th>High</th><th>Low</th></tr></thead><tbody>${(q.days || []).map((d) => `<tr><td class="mono">${esc(d.date || d.dayName)}</td><td>${d.hi ?? "—"}</td><td>${d.lo ?? "—"}</td></tr>`).join("") || '<tr><td colspan="3" class="msg">No extracted values.</td></tr>'}</tbody></table></div>
      <p class="msg">${esc((q.issues || []).join("; "))}</p>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn sm" data-dec="approve" data-i="${i}" type="button">APPROVE</button><button class="btn ghost sm" data-dec="reject" data-i="${i}" type="button">REJECT</button>
      <input class="input mono" id="cd${i}" placeholder="YYYY-MM-DD" style="width:120px"><select class="input" id="cf${i}"><option value="hi">high</option><option value="lo">low</option><option value="pop">PoP %</option></select><input class="input mono" id="cv${i}" placeholder="value" style="width:70px"><button class="btn ghost sm" data-dec="correct" data-i="${i}" type="button">CORRECT</button></div>
      <input class="input" id="cn${i}" placeholder="note (why)" style="margin-top:6px"></div></div></div>`).join("") : '<p class="msg">Nothing to review.</p>';
    RQ.items.forEach(async (q, i) => { const e = q.evidence && q.evidence[0]; if (e && /jpg|png/.test(e.type)) { try { $("rqe" + i).innerHTML = `<img alt="Original evidence" src="${await imgURL(e.path)}">`; } catch (er) { $("rqe" + i).innerHTML = `<span class="msg err">${esc(er.message)}</span>`; } } });
    $("rq").querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => decide(RQ.items[+b.dataset.i], b.dataset.dec, +b.dataset.i)));
  }
  async function decide(q, decision, i) {
    const rec = { kind: "tv-review", captureId: q.captureId, product: q.product, scope: q.scope && q.scope.contentSha256 && q.scope.firstDate ? q.scope : undefined, appliesTo: "this capture, plus captures with the same station, product, extraction version, evidence hash and assigned dates", decision, at: new Date().toISOString(), by: "dashboard", note: $("cn" + i).value.trim() };
    if (decision === "correct") { rec.date = $("cd" + i).value.trim(); rec.field = $("cf" + i).value; rec.value = +$("cv" + i).value; if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date) || !isFinite(rec.value)) { alert("Enter a date (YYYY-MM-DD) and a numeric value."); return; } }
    const name = `corrections/${rec.at.slice(0, 7)}/${rec.at.replace(/[:.]/g, "")}-${q.product}.jsonl`;
    try {
      await gh(name, { method: "PUT", body: { message: `Review: ${decision} ${q.product} ${q.captureId}`, content: btoa(unescape(encodeURIComponent(JSON.stringify(rec) + "\n"))), branch: cfg().branch } });
      alert("Saved. It applies at the next scoring run; the original record is unchanged.");
    } catch (e) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(rec) + "\n"], { type: "application/json" })); a.download = name.split("/").pop(); a.click();
      alert(`Couldn't write to the repository (${e.message}). The decision was downloaded instead: commit it under ${name}.`);
    }
  }
  function recipes() {
    const B = IDX.latestBlendInfo || {};
    $("pane").innerHTML = `<section class="card"><div class="section-title">Blend recipes in the latest capture</div><p class="msg">Requested weights, the weights actually used (sources present), missing sources and effective shares. Baseline v1 is frozen; candidates run in parallel and never become defaults on their own. Modes: Brad's preferred = Baseline v1 · Local verified = none yet (requires demonstrated improvement on unseen dates and a recorded decision) · Custom.</p>
      <div class="tablewrap"><table><thead><tr><th style="text-align:left">Recipe</th><th>Hash</th><th style="text-align:left">Missing</th><th style="text-align:left">Temperature shares</th><th style="text-align:left">Precip shares</th></tr></thead><tbody>
      ${Object.entries(B).map(([k, v]) => `<tr><td style="text-align:left">${esc(v.label)}</td><td class="mono">${esc(v.configHash)}</td><td style="text-align:left">${esc(v.missing.join(", ") || "none")}</td><td style="text-align:left;white-space:normal">${esc(v.shares.temperature_2m.map(([id, s]) => `${id} ${Math.round(s * 100)}%`).join(", "))}</td><td style="text-align:left;white-space:normal">${esc(v.shares.precipitation.map(([id, s]) => `${id} ${Math.round(s * 100)}%`).join(", "))}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  function exportsPane() {
    const files = ["reports/scores.json", "reports/index.json", "reports/review-queue.json", "reports/exports/pairs.csv", "reports/exports/observations.csv", "reports/STATUS.md", "reports/SCORECARD.md"];
    $("pane").innerHTML = `<section class="card"><div class="section-title">Exports</div><p class="msg">Forecast archives (raw evidence and normalized bundles), observations and the correction audit trail live in the data repository itself; clone it for a complete export.</p>${files.map((x) => `<button class="btn ghost sm" data-f="${x}" type="button" style="margin:4px">${esc(x)}</button>`).join("")}</section>`;
    $("pane").querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", async () => { try { const bl = await (await gh(b.dataset.f)).blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = b.dataset.f.split("/").pop(); a.click(); } catch (e) { alert(e.message); } }));
  }
})();
