/* Beta usage analytics: client privacy rules and the weekly report (synthetic data only). */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const R = require("../tools/analytics/report.js");
let n = 0; const ok = (c, m) => { assert(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* ---------- client, in a fake browser ---------- */
function client({ page = "meteorologist-beta.html", endpoint = "https://collector.example/exec", ls = {}, dnt = null, gpc = false, search = "" } = {}) {
  const store = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } });
  const sent = [], L = { ...ls }, Ssn = {};
  const win = { location: { pathname: "/forecast-ops/beta-previews/" + page, hostname: "raw.githack.com", search }, localStorage: store(L), sessionStorage: store(Ssn),
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc, webdriver: false, sendBeacon: (u, blob) => { sent.push({ u, blob }); return true; } },
    crypto: { randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0") },
    BETA_ANALYTICS: { endpoint }, Blob: class { constructor(p) { this.text = p.join(""); } }, setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, fetch: () => Promise.resolve() };
  win.globalThis = win;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/beta-analytics.js"), "utf8").replace(/typeof globalThis !== "undefined" \? globalThis : this/, "win"), { win, URLSearchParams, JSON, Date, Math, Map, Set, Object, String, Number, setTimeout: () => 0, clearTimeout: () => {}, Blob: win.Blob, fetch: win.fetch });
  return { A: win.BetaAnalytics, sent, L, rows: () => sent.flatMap((s) => JSON.parse(s.blob.text)) };
}
{ const c = client(); for (let i = 0; i < 30; i++) c.A.track("timeline_used"); c.A.flush();
  const rows = c.rows();
  eq(rows.map((r) => r.type), ["session_start", "timeline_used"], "a 30-hour drag is one timeline use (plus the session start)");
  eq(Object.keys(rows[1]).sort(), ["aud", "b", "c", "int", "n", "s", "t", "type", "v"], "only the documented fields are sent");
  eq(rows[1].aud, "met", "audience from the beta page");
  c.A.track("city_selected", { market: "elsewhere", city: "Denver", lat: 39.7 }); c.A.flush();
  eq(c.rows().pop().c, { market: "elsewhere" }, "city names and coordinates are dropped; only the market class remains");
  c.A.track("not_a_type"); c.A.flush(); eq(c.rows().length, 3, "unknown interaction types are ignored"); }
{ const c = client({ endpoint: "" }); c.A.track("timeline_used"); c.A.flush(); eq(c.sent.length, 0, "no collector configured: nothing is sent"); eq(c.A._queue().length, 0, "…and nothing is kept"); }
{ const c = client({ ls: { fo_analytics_optout: "1" } }); c.A.track("timeline_used"); c.A.flush(); eq(c.sent.length, 0, "opted out: nothing is sent"); }
{ const c = client({ dnt: "1" }); c.A.track("timeline_used"); c.A.flush(); eq(c.sent.length, 0, "Do Not Track: nothing is sent"); }
{ const c = client({ gpc: true }); c.A.track("timeline_used"); c.A.flush(); eq(c.sent.length, 0, "Global Privacy Control: nothing is sent"); }
{ const c = client({ search: "?internal=1" }); c.A.track("sample_opened"); c.A.flush(); eq(c.rows()[0].int, 1, "?internal=1 marks this browser as internal testing"); }
{ const c = client({ page: "event-beta.html" }); c.A.track("sample_opened"); c.A.flush(); eq(c.rows()[1].aud, "event", "event beta audience"); }
{ const c = client({ page: "event-beta" }); c.A.track("sample_opened"); c.A.flush(); eq(c.rows()[1].aud, "event", "event beta audience without .html (Cloudflare Pages pretty URL)"); }

/* ---------- report ---------- */
eq(R.validate({ v: 1, aud: "met", type: "city_selected", b: "abcdef0123", s: "0123abcdef", n: 1, t: "2026-11-10T14:00Z", c: { market: "elsewhere", name: "Jane", venue: "Red Rocks" } }).c, { market: "elsewhere" }, "collector drops anything not on the allow-list");
eq(R.validate({ v: 1, aud: "met", type: "city_selected", b: "x", s: "0123abcdef", n: 1, t: "2026-11-10T14:00Z" }), null, "malformed IDs are rejected");
const row = (aud, b, s, type, t, c = {}, int = 0, nn = 1) => ({ v: 1, aud, b: b.padEnd(10, "0"), s: s.padEnd(10, "0"), n: nn, t, type, c, int });
const rows = [
  /* week of Nov 9: met browser m1 two sessions (timeline twice, models once); m2 one session; internal tester */
  row("met", "m1", "s1", "session_start", "2026-11-10T14:00Z"), row("met", "m1", "s1", "timeline_used", "2026-11-10T14:01Z"), row("met", "m1", "s1", "models_compared", "2026-11-10T14:02Z"),
  row("met", "m1", "s2", "session_start", "2026-11-11T14:00Z", {}, 0, 2), row("met", "m1", "s2", "timeline_used", "2026-11-11T14:01Z"),
  row("met", "m2", "s3", "session_start", "2026-11-11T15:00Z"), row("met", "m2", "s3", "city_searched", "2026-11-11T15:01Z"), row("met", "m2", "s3", "search_no_results", "2026-11-11T15:01Z"), row("met", "m2", "s3", "city_selected", "2026-11-11T15:02Z", { market: "elsewhere" }),
  row("met", "me", "s9", "session_start", "2026-11-11T16:00Z", {}, 1), row("met", "me", "s9", "timeline_used", "2026-11-11T16:01Z", {}, 1),
  /* event: e1 sample → started → saved, returns next week; e2 sample → started, no save */
  row("event", "e1", "t1", "sample_opened", "2026-11-10T18:00Z"), row("event", "e1", "t1", "custom_event_started", "2026-11-10T18:02Z"), row("event", "e1", "t1", "event_saved", "2026-11-10T18:05Z"),
  row("event", "e2", "t2", "sample_opened", "2026-11-12T18:00Z"), row("event", "e2", "t2", "custom_event_started", "2026-11-12T18:02Z"),
  row("event", "e1", "t3", "session_start", "2026-11-17T18:00Z", {}, 0, 2), row("event", "e1", "t3", "event_revisited", "2026-11-17T18:00Z"),
];
const rep = R.build(rows, { now: "2026-11-18T00:00Z" });
eq(rep.weeks.map((w) => w.week), ["2026-11-16", "2026-11-09"], "weeks start on Monday, newest first");
const met = rep.weeks[1].betas.met, f = (t) => met.features.find((x) => x.type === t);
eq([met.browsers, met.sessions, met.returning], [2, 3, 1], "met: 2 browsers, 3 sessions, 1 returning browser (internal tester excluded)");
eq([f("timeline_used").browsers, f("timeline_used").sessionShare, f("timeline_used").returnedTo], [1, 67, 1], "timeline: 1 browser, 2 of 3 sessions, came back to it");
eq([f("models_compared").browsers, f("models_compared").returnedTo], [1, 0], "models compared once, not returned to");
eq(met.stalls[0].count, 1, "a city search with no match is a stall");
eq(rep.internal, [{ week: "2026-11-09", met: 1, event: 0 }], "internal testing reported separately");
const ev1 = rep.weeks[1].betas.event, ev2 = rep.weeks[0].betas.event;
eq(ev1.funnel.map((x) => x.browsers), [2, 2, 1, 0], "funnel week 1: 2 sampled, 2 started, 1 saved, 0 returned");
eq(ev2.funnel.map((x) => x.browsers), [2, 2, 1, 1], "funnel is cumulative: through week 2 the one saver also returned later");
eq(ev1.stalls.find((x) => /did not save/.test(x.label)).count, 1, "started but not saved is a stall");
ok(/Event path/.test(R.html(rep)) && !/m1000/.test(R.html(rep)), "dashboard renders, without browser IDs");
fs.writeFileSync(path.join(__dirname, "../docs/beta/analytics-dashboard-sample.html"), R.html(rep));
console.log(`ok - ${n} beta analytics checks passed`);
