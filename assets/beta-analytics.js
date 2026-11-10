/* Forecast Ops beta usage analytics: privacy-conscious interaction counts for a private report.
   What is sent: interaction type, beta (meteorologist/event), a random browser ID and session ID, the
   session's sequence number for that browser, an internal-testing flag and a small allow-listed context
   (e.g. market "cincinnati"/"elsewhere", tool or map layer name). Never: names, emails, search text, city or
   venue names, coordinates, event names or schedules, page URLs or the IP-derived location (the collector
   does not store request metadata).
   Nothing is sent when: no collector URL is configured, the person opted out, Do Not Track / Global Privacy
   Control is on, or the request is blocked. The page never depends on it. */
(function (root) {
  "use strict";
  const CFG = root.BETA_ANALYTICS || {}, LS = root.localStorage, SS = root.sessionStorage;
  const get = (st, k) => { try { return st.getItem(k); } catch (e) { return null; } };
  const set = (st, k, v) => { try { st.setItem(k, v); } catch (e) { /* storage blocked: stay anonymous and stateless */ } };
  const del = (st, k) => { try { st.removeItem(k); } catch (e) { /* ignore */ } };
  const rid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 16);

  /* ---- what may be recorded: types per beta and allow-listed context values ---- */
  const TYPES = new Set(["session_start", "city_selected", "tool_opened", "models_compared", "weights_adjusted", "map_layer_changed", "playback_started", "timeline_used",
    "sample_opened", "custom_event_started", "event_saved", "phase_details_opened", "event_revisited",
    "city_searched", "search_no_results", "search_failed", "load_failed", "feeds_missing", "link_copied", "feedback", "analytics_opt_out"]);
  const CTX = { market: ["cincinnati", "elsewhere"], tool: ["models", "weights", "runs", "soundings", "thunder", "winter", "map"], what: ["models", "nws"],
    phase: ["setup", "gates", "event", "teardown"], layer: ["refc", "refd1km", "precip", "t2m", "d2m", "gust", "w10m", "cloud"], rating: ["useful", "not_useful"], returning: [true, false] };
  const clean = (c) => { const o = {}; Object.entries(c || {}).forEach(([k, v]) => { if (CTX[k] && CTX[k].includes(v)) o[k] = v; else if (k === "n" && Number.isInteger(v) && v >= 0 && v < 100) o.n = v; }); return o; };

  /* ---- who: random browser ID (approximate returning browsers), 30-minute sessions ---- */
  const page = (root.location && root.location.pathname.split("/").pop()) || "";
  const AUD = page === "meteorologist-beta.html" ? "met" : page === "event-beta.html" ? "event" : get(SS, "fo_beta_aud");
  if (page === "meteorologist-beta.html" || page === "event-beta.html") set(SS, "fo_beta_aud", AUD);
  const q = (() => { try { return new URLSearchParams(root.location.search); } catch (e) { return new URLSearchParams(); } })();
  if (q.get("internal") === "1") set(LS, "fo_internal", "1"); if (q.get("internal") === "0") del(LS, "fo_internal");
  const internal = () => get(LS, "fo_internal") === "1" || /^(localhost|127\.|0\.0\.0\.0)/.test(root.location.hostname) || !!(root.navigator && root.navigator.webdriver);
  const privacyOff = () => (root.navigator && (root.navigator.doNotTrack === "1" || root.navigator.globalPrivacyControl === true));
  const optedOut = () => get(LS, "fo_analytics_optout") === "1" || privacyOff();
  const endpoint = () => get(LS, "fo_analytics_endpoint_test") || CFG.endpoint || "";
  const enabled = () => !!AUD && !!endpoint() && !optedOut();

  let browser = get(LS, "fo_bid"); if (!browser) { browser = rid(); set(LS, "fo_bid", browser); }
  function session() {
    const now = Date.now(), last = +get(LS, "fo_last") || 0; let sid = get(SS, "fo_sid"), n = +get(LS, "fo_sn") || 0, fresh = false;
    if (!sid || now - last > 30 * 60e3) { sid = rid(); n += 1; fresh = true; set(SS, "fo_sid", sid); set(LS, "fo_sn", String(n)); }
    set(LS, "fo_last", String(now)); return { sid, n, fresh };
  }

  /* ---- queue and send (text/plain beacon: no cookies, no preflight) ---- */
  let queue = [], timer = null;
  const recent = new Map(); // coalesce bursts: one interaction per type+context per 3 s (a timeline drag is one use)
  function track(type, ctx) {
    if (!TYPES.has(type) || !AUD || optedOut()) return;
    const c = clean(ctx), key = type + JSON.stringify(c), now = Date.now();
    if (type !== "session_start" && recent.has(key) && now - recent.get(key) < 3000) return; recent.set(key, now);
    const s = session();
    if (s.fresh && type !== "session_start") queue.push(row("session_start", { returning: s.n > 1 }, s));
    queue.push(row(type, c, s));
    if (!enabled()) { queue = []; return; } // without a collector nothing leaves the browser
    clearTimeout(timer); timer = setTimeout(flush, 8000);
    if (queue.length >= 20) flush();
  }
  const row = (type, c, s) => ({ v: 1, t: new Date().toISOString().slice(0, 16) + "Z", aud: AUD, int: internal() ? 1 : 0, b: browser, s: s.sid, n: s.n, type, c });
  function flush() {
    clearTimeout(timer); if (!queue.length || !enabled()) { queue = []; return; }
    const body = JSON.stringify(queue.splice(0, 50));
    try { if (!(root.navigator.sendBeacon && root.navigator.sendBeacon(endpoint(), new Blob([body], { type: "text/plain" })))) fetch(endpoint(), { method: "POST", body, mode: "no-cors", keepalive: true, credentials: "omit" }).catch(() => {}); }
    catch (e) { /* blocked: fine */ }
  }
  root.addEventListener && root.addEventListener("pagehide", flush);
  root.document && root.document.addEventListener("visibilitychange", () => { if (root.document.visibilityState === "hidden") flush(); });

  /* ---- notice, opt-out and feedback (beta pages only) ---- */
  function notice() {
    const foot = root.document.getElementById("foot"); if (!foot || root.document.getElementById("bxPrivacy")) return;
    const el = root.document.createElement("div"); el.id = "bxPrivacy"; el.className = "bx-privacy";
    const draw = () => { el.innerHTML = optedOut()
      ? `<span>Usage analytics are off in this browser${privacyOff() ? " (your browser's privacy setting)" : ""}.</span>${privacyOff() ? "" : '<button type="button" class="bx-link" data-a="on">Turn on</button>'}`
      : `<span>This beta counts which features are used (anonymous; never names, places, searches or event details) to decide what to build next.</span><button type="button" class="bx-link" data-a="off">Turn off</button>`;
      el.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.a === "off") { track("analytics_opt_out"); flush(); set(LS, "fo_analytics_optout", "1"); queue = []; } else del(LS, "fo_analytics_optout"); draw(); })); };
    draw(); foot.after(el); // beside the footer, which pages redraw
  }
  function feedback() {
    const head = root.document.querySelector(".bx-head-in"); if (!head || root.document.getElementById("bxFeedback")) return;
    const b = root.document.createElement("button"); b.id = "bxFeedback"; b.type = "button"; b.className = "bx-btn"; b.textContent = "Feedback";
    b.addEventListener("click", () => {
      let d = root.document.getElementById("bxFbDlg");
      if (!d) { d = root.document.createElement("dialog"); d.id = "bxFbDlg"; root.document.body.append(d); }
      d.innerHTML = `<form class="bx-form" method="dialog"><h2>Is this beta useful?</h2><p class="bx-note" style="margin:0">One tap is enough. Feedback is counted anonymously with the beta name, nothing else.</p>
        <div style="display:flex;gap:8px"><button class="bx-btn" value="useful">Useful</button><button class="bx-btn" value="not_useful">Not useful yet</button><button class="bx-btn" value="cancel" style="margin-left:auto">Close</button></div>
        ${optedOut() ? '<p class="bx-note" style="margin:0">Analytics are off in this browser, so feedback is not sent.</p>' : ""}</form>`;
      d.addEventListener("close", () => { if (["useful", "not_useful"].includes(d.returnValue)) { track("feedback", { rating: d.returnValue }); flush(); } }, { once: true });
      d.showModal(); });
    head.insertBefore(b, head.querySelector("#bxRefresh"));
  }
  /* full tools opened from a beta (same browser tab): weights adjusted / models compared on Model Blend */
  function toolHooks() {
    if (page !== "blend.html" || !get(SS, "fo_beta_aud")) return;
    const on = (sel, ev, type) => { const el = root.document.querySelector(sel); if (el) el.addEventListener(ev, () => track(type), { once: true }); };
    on("#models", "change", "weights_adjusted"); on("#models", "input", "weights_adjusted"); on("#presetTabs", "click", "weights_adjusted");
    on("#linesBtn", "click", "models_compared"); on("#tabs", "click", "models_compared"); on("#modelTrendCard", "click", "models_compared");
  }
  function boot() { if (AUD && (page === "meteorologist-beta.html" || page === "event-beta.html")) { notice(); feedback(); } toolHooks(); }
  if (root.document) { if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot); else boot(); root.setTimeout(notice, 3000); }

  root.BetaAnalytics = { track, flush, optedOut, enabled, internal, TYPES, CTX, clean, _queue: () => queue };
})(typeof globalThis !== "undefined" ? globalThis : this);
