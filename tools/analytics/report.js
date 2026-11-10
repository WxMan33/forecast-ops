/* Forecast Ops beta usage report. One file, used by the Apps Script collector/dashboard (copied as Report.gs)
   and by the Node tests. Input rows are the anonymous events the betas send; output is a weekly breakdown per
   beta. Browser counts are estimates: one browser ≈ one person on one device, and clearing storage or using a
   second browser counts again. */
var BetaReport = (function () {
  "use strict";
  var TYPES = ["session_start", "city_selected", "tool_opened", "models_compared", "weights_adjusted", "map_layer_changed", "playback_started", "timeline_used",
    "sample_opened", "custom_event_started", "event_saved", "phase_details_opened", "event_revisited", "reminder_exported", "upcoming_opened", "venue_saved", "event_removed",
    "city_searched", "search_no_results", "search_failed", "load_failed", "feeds_missing", "link_copied", "feedback", "analytics_opt_out"];
  var CTX = { market: ["cincinnati", "elsewhere"], tool: ["models", "weights", "runs", "soundings", "thunder", "winter", "map"], what: ["models", "nws"],
    phase: ["setup", "gates", "event", "teardown"], layer: ["refc", "refd1km", "precip", "t2m", "d2m", "gust", "w10m", "cloud"], rating: ["useful", "not_useful"], via: ["google", "ics"], returning: [true, false] };
  var AUDS = { met: "Meteorologist beta", event: "Event manager beta" };
  var FEATURES = {
    met: [["city_selected", "Selected a city"], ["tool_opened", "Opened a forecast tool"], ["models_compared", "Compared models"], ["weights_adjusted", "Adjusted weights"],
      ["map_layer_changed", "Changed map layer"], ["playback_started", "Started map playback"], ["timeline_used", "Used the timeline"], ["link_copied", "Copied a link"]],
    event: [["sample_opened", "Opened the sample briefing"], ["custom_event_started", "Started a custom event"], ["event_saved", "Saved an event"], ["upcoming_opened", "Opened Upcoming events"], ["venue_saved", "Saved a venue"], ["reminder_exported", "Exported a calendar reminder (link or .ics; saving not confirmed)"],
      ["phase_details_opened", "Opened phase details"], ["event_revisited", "Revisited a saved event"], ["city_selected", "Selected a city"], ["timeline_used", "Used the timeline"], ["link_copied", "Copied a link"]],
  };
  var FUNNEL = [["sample_opened", "Sample opened"], ["custom_event_started", "Custom event started"], ["event_saved", "Event saved"], ["event_revisited", "Returned later"]];

  /* one incoming row: keep only allow-listed fields and values; anything else is dropped */
  function validate(x) {
    if (!x || x.v !== 1 || !AUDS[x.aud] || TYPES.indexOf(x.type) < 0) return null;
    if (!/^[a-z0-9]{8,32}$/.test(String(x.b)) || !/^[a-z0-9]{8,32}$/.test(String(x.s))) return null;
    var t = Date.parse(x.t); if (!isFinite(t)) return null;
    var c = {}; Object.keys(x.c || {}).forEach(function (k) { var v = x.c[k]; if (CTX[k] && CTX[k].indexOf(v) >= 0) c[k] = v; else if (k === "n" && v === (v | 0) && v >= 0 && v < 100) c.n = v; });
    return { t: new Date(t).toISOString().slice(0, 16) + "Z", aud: x.aud, int: x.int ? 1 : 0, b: String(x.b), s: String(x.s), n: Math.max(1, Math.min(9999, x.n | 0)), type: x.type, c: c };
  }
  function weekOf(iso) { var d = new Date(iso.slice(0, 10) + "T00:00:00Z"), dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 864e5).toISOString().slice(0, 10); }
  function uniq(a) { var o = {}; a.forEach(function (x) { o[x] = 1; }); return Object.keys(o); }
  function pct(a, b) { return b ? Math.round((100 * a) / b) : null; }

  function build(rows, opts) {
    opts = opts || {};
    var all = rows.map(validate).filter(Boolean).sort(function (a, b) { return a.t < b.t ? -1 : 1; });
    var colleague = all.filter(function (r) { return !r.int; }), internal = all.filter(function (r) { return r.int; });
    var weeks = uniq(all.map(function (r) { return weekOf(r.t); })).sort().reverse();
    var out = { generated: opts.now || new Date().toISOString(), weeks: [], internal: [], totals: { rows: all.length, colleague: colleague.length, internal: internal.length } };
    weeks.forEach(function (w) {
      var wk = { week: w, betas: {} };
      Object.keys(AUDS).forEach(function (aud) {
        var upto = colleague.filter(function (r) { return r.aud === aud && weekOf(r.t) <= w; }), cur = upto.filter(function (r) { return weekOf(r.t) === w; });
        if (!cur.length) return;
        var sessions = uniq(cur.map(function (r) { return r.s; })), browsers = uniq(cur.map(function (r) { return r.b; }));
        /* returning browser: a session before this week, or more than one session this week (estimate) */
        var returning = browsers.filter(function (b) { var ss = uniq(upto.filter(function (r) { return r.b === b; }).map(function (r) { return r.s; }));
          var earlier = upto.some(function (r) { return r.b === b && weekOf(r.t) < w; }); return earlier || ss.length > 1; });
        var features = FEATURES[aud].map(function (f) {
          var hits = cur.filter(function (r) { return r.type === f[0]; }), ever = upto.filter(function (r) { return r.type === f[0]; });
          var sess = uniq(hits.map(function (r) { return r.s; })), br = uniq(hits.map(function (r) { return r.b; }));
          /* returned to: browsers that used it in two or more separate sessions (through this week) */
          var back = uniq(ever.map(function (r) { return r.b; })).filter(function (b) { return uniq(ever.filter(function (r) { return r.b === b; }).map(function (r) { return r.s; })).length >= 2; });
          return { type: f[0], label: f[1], browsers: br.length, sessionShare: pct(sess.length, sessions.length), returnedTo: back.length };
        });
        var inSess = function (type) { return uniq(cur.filter(function (r) { return r.type === type; }).map(function (r) { return r.s; })); };
        var started = inSess("custom_event_started"), saved = inSess("event_saved");
        var stalls = [
          { label: "City search found no U.S. match", count: inSess("search_no_results").length, of: inSess("city_searched").length + inSess("search_no_results").length, unit: "searching sessions" },
          { label: "Forecast failed to load", count: inSess("load_failed").length, of: sessions.length, unit: "sessions" },
          { label: "Some guidance feeds missing", count: inSess("feeds_missing").length, of: sessions.length, unit: "sessions" },
        ];
        if (aud === "event") stalls.push({ label: "Started an event but did not save it", count: started.filter(function (s) { return saved.indexOf(s) < 0; }).length, of: started.length, unit: "sessions that started one" });
        stalls.forEach(function (x) { x.share = pct(x.count, x.of); });
        var fb = cur.filter(function (r) { return r.type === "feedback"; });
        var b = { label: AUDS[aud], sessions: sessions.length, browsers: browsers.length, returning: returning.length, features: features, stalls: stalls,
          feedback: { useful: fb.filter(function (r) { return r.c.rating === "useful"; }).length, notUseful: fb.filter(function (r) { return r.c.rating === "not_useful"; }).length },
          markets: { cincinnati: uniq(cur.filter(function (r) { return r.c.market === "cincinnati"; }).map(function (r) { return r.b; })).length, elsewhere: uniq(cur.filter(function (r) { return r.c.market === "elsewhere"; }).map(function (r) { return r.b; })).length } };
        if (aud === "event") {
          /* sample opened → custom started → saved → returned later: browsers that reached each step in order (through this week) */
          var prev = null; b.funnel = FUNNEL.map(function (f) {
            var br = uniq(upto.filter(function (r) { return r.type === f[0]; }).map(function (r) { return r.b; }));
            if (prev) br = br.filter(function (x) { return prev.indexOf(x) >= 0; }); prev = br; return { type: f[0], label: f[1], browsers: br.length }; });
        }
        wk.betas[aud] = b;
      });
      var iw = internal.filter(function (r) { return weekOf(r.t) === w; });
      if (iw.length) out.internal.push({ week: w, met: uniq(iw.filter(function (r) { return r.aud === "met"; }).map(function (r) { return r.s; })).length, event: uniq(iw.filter(function (r) { return r.aud === "event"; }).map(function (r) { return r.s; })).length });
      if (Object.keys(wk.betas).length) out.weeks.push(wk);
    });
    return out;
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function html(rep) {
    var p = function (x) { return x == null ? "—" : x + "%"; };
    var parts = ['<!doctype html><html><head><meta charset="utf-8"><title>Forecast Ops beta usage</title><style>body{font:14px/1.45 system-ui,sans-serif;margin:20px;color:#12161d;max-width:1100px}h1{font-size:20px}h2{font-size:16px;margin:22px 0 6px}h3{font-size:14px;margin:14px 0 4px}table{border-collapse:collapse;width:100%;margin:4px 0 10px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #d3d9e0}th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#4b5563}td.n,th.n{text-align:right}.note{color:#4b5563;font-size:12.5px}.kpi{display:flex;gap:18px;flex-wrap:wrap}.kpi div b{display:block;font-size:20px}.bar{display:inline-block;height:8px;background:#0369a1;border-radius:2px;vertical-align:middle}</style></head><body>',
      "<h1>Forecast Ops beta usage</h1><p class=\"note\">Colleague traffic only; internal testing is counted separately below. Browser counts are estimates (one browser ≈ one person on one device). Generated " + esc(rep.generated) + ".</p>"];
    if (!rep.weeks.length) parts.push("<p>No colleague usage recorded yet.</p>");
    rep.weeks.forEach(function (w) {
      parts.push("<h2>Week of " + esc(w.week) + "</h2>");
      Object.keys(w.betas).forEach(function (aud) {
        var b = w.betas[aud];
        parts.push("<h3>" + esc(b.label) + '</h3><div class="kpi"><div><b>' + b.browsers + "</b>browsers</div><div><b>" + b.sessions + "</b>sessions</div><div><b>" + b.returning + "</b>returning browsers (est.)</div><div><b>" + b.markets.cincinnati + " / " + b.markets.elsewhere + "</b>browsers choosing Cincinnati / elsewhere</div><div><b>" + b.feedback.useful + " / " + b.feedback.notUseful + "</b>useful / not yet</div></div>");
        var max = Math.max.apply(null, b.features.map(function (f) { return f.browsers; }).concat([1]));
        parts.push("<table><thead><tr><th>Feature</th><th class=n>Browsers</th><th class=n>Share of sessions</th><th class=n>Came back to it</th><th></th></tr></thead><tbody>" + b.features.map(function (f) {
          return "<tr><td>" + esc(f.label) + "</td><td class=n>" + f.browsers + "</td><td class=n>" + p(f.sessionShare) + "</td><td class=n>" + f.returnedTo + '</td><td><span class="bar" style="width:' + Math.round((120 * f.browsers) / max) + 'px"></span></td></tr>'; }).join("") + "</tbody></table>");
        if (b.funnel) parts.push("<table><thead><tr><th>Event path (browsers)</th>" + b.funnel.map(function (f) { return "<th class=n>" + esc(f.label) + "</th>"; }).join("") + "</tr></thead><tbody><tr><td>Reached this step</td>" + b.funnel.map(function (f) { return "<td class=n>" + f.browsers + "</td>"; }).join("") + "</tr></tbody></table>");
        parts.push("<table><thead><tr><th>Where tasks stalled</th><th class=n>Count</th><th class=n>Share</th><th>Of</th></tr></thead><tbody>" + b.stalls.map(function (x) { return "<tr><td>" + esc(x.label) + "</td><td class=n>" + x.count + "</td><td class=n>" + p(x.share) + "</td><td>" + x.of + " " + esc(x.unit) + "</td></tr>"; }).join("") + "</tbody></table>");
      });
    });
    parts.push("<h2>Internal testing (excluded above)</h2>" + (rep.internal.length ? "<table><thead><tr><th>Week</th><th class=n>Meteorologist sessions</th><th class=n>Event sessions</th></tr></thead><tbody>" + rep.internal.map(function (i) { return "<tr><td>" + esc(i.week) + "</td><td class=n>" + i.met + "</td><td class=n>" + i.event + "</td></tr>"; }).join("") + "</tbody></table>" : '<p class="note">None.</p>'));
    parts.push('<p class="note">Recorded per interaction: beta, interaction type, random browser and session IDs, session number, internal flag and allow-listed context (market Cincinnati/elsewhere, tool, map layer, phase, feedback rating). Never names, emails, search text, places, coordinates, event details or IP addresses.</p></body></html>');
    return parts.join("");
  }
  return { TYPES: TYPES, CTX: CTX, FEATURES: FEATURES, validate: validate, weekOf: weekOf, build: build, html: html };
})();
if (typeof module !== "undefined" && module.exports) module.exports = BetaReport;
