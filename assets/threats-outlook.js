/* Weather Threats: the venue's next 7 days, from official sources, as one row per local day.
   Pure logic (no fetching): ThreatsOutlook.build(input) -> { headline, alerts, days, sources }.
   Levels: 0 information, 1 low, 2 moderate, 3 high, 4 extreme. They order and colour what is shown; each item still names its
   source's own wording (SPC category, WPC risk, NWS product), and a source that did not answer makes that part "not confirmed",
   never quiet. SPC Days 6-8 often say "predictability too low": that is shown as unknown, not as no risk. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./threats-core.js"));
  else root.ThreatsOutlook = factory(root.ThreatsCore);
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";
  const SPC_LEVEL = { TSTM: 0, MRGL: 1, SLGT: 2, ENH: 3, MDT: 4, HIGH: 4 }, SPC_NAME = { TSTM: "General thunderstorms", MRGL: "Marginal risk (1 of 5)", SLGT: "Slight risk (2 of 5)", ENH: "Enhanced risk (3 of 5)", MDT: "Moderate risk (4 of 5)", HIGH: "High risk (5 of 5)" };
  const ERO_LEVEL = { MRGL: 1, SLGT: 2, MDT: 3, HIGH: 4 }, ERO_NAME = { MRGL: "Marginal (1 of 4)", SLGT: "Slight (2 of 4)", MDT: "Moderate (3 of 4)", HIGH: "High (4 of 4)" };
  const FIRE_LEVEL = { ELEV: 1, CRIT: 2, EXTM: 3, IDRT: 1, SDRT: 2, P40: 1, P70: 2 }, FIRE_NAME = { ELEV: "Elevated", CRIT: "Critical", EXTM: "Extremely critical", IDRT: "Isolated dry thunderstorms", SDRT: "Scattered dry thunderstorms", P40: "40% chance of critical conditions", P70: "70% chance of critical conditions" };
  const WSSI_LEVELS = ["WWA", "MINOR", "MODERATE", "MAJOR", "EXTREME"], WSSI_NAME = { WWA: "winter weather", MINOR: "Minor", MODERATE: "Moderate", MAJOR: "Major", EXTREME: "Extreme" }, WSSI_LEVEL = { WWA: 0, MINOR: 1, MODERATE: 2, MAJOR: 3, EXTREME: 4 };
  const AQ_LEVEL = { "Unhealthy for Sensitive Groups": 1, Unhealthy: 2, "Very Unhealthy": 3, Hazardous: 4 };
  /* NWS alerts by kind: warnings 3 (tornado, extreme wind 4), watches 2, advisories 1, statements 0 */
  const alertLevel = (ev) => /^(Tornado|Extreme Wind|Hurricane|Storm Surge) Warning/.test(ev) ? 4 : / Warning$/.test(ev) ? 3 : / Watch$/.test(ev) ? 2 : / Advisory$/.test(ev) ? 1 : 0;
  /* the local calendar date (YYYY-MM-DD) of an instant in the venue's zone */
  // one formatter per zone (making a new one per call took over a second on a busy day)
  const fmts = new Map(), localDate = (ms, tz) => { let f = fmts.get(tz); if (!f) { f = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); fmts.set(tz, f); } return f.format(new Date(ms)); };
  const dayLabel = (date, i, tz) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  /* ---------- forecast highlights for the site (NWS forecast grid) ----------
     Weather that can matter to an event or a commute without any alert or outlook: heavy rain (the wettest rolling 24 hours,
     from the grid's amounts, so a rain event crossing midnight counts once), a wintry mix (snow, sleet or freezing rain in the
     forecast, with accumulation only when the grid gives it), rain that lingers (6+ hours likely or definite), and heat (peak
     heat index and when). Thresholds: 1 inch in 24 h and a 90°F heat index unless the caller sets others. Every highlight
     says where its numbers come from and how far the data reaches; nothing here is an alert or an outlook. */
  const COMMUTE = [[6, 9, "morning commute"], [16, 19, "evening commute"]];
  const fmtH = (ms, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric" }).format(new Date(ms)).replace(" ", " ");
  const fmtDay = (ms, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(ms));
  const span = (a, b, tz) => fmtDay(a, tz) + " " + fmtH(a, tz) + " – " + (fmtDay(a, tz) === fmtDay(b, tz) ? "" : fmtDay(b, tz) + " ") + fmtH(b, tz);
  const partOfDay = (ms, tz) => { const h = +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(ms)); return h < 5 ? "overnight" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night"; };
  function highlights(grid, tz, now, opt = {}) {
    const rainIn = opt.rainIn || 1, heatF = opt.heatF || 90, rows = (grid && grid.rows) || [], H = 3600e3, out = [], notes = [];
    if (!rows.length) return { list: out, notes, missing: true };
    const T = (r) => Date.parse(r.t);
    // heavy rain: the wettest rolling 24 hours of forecast amounts
    const q = rows.map((r) => (r.qpf == null ? null : r.qpf)), have = q.some((v) => v != null);
    /* NWS gives rain amounts per interval (usually 6 hours) and parseGrid spreads each evenly over its hours, so a window or a
       peak may only start and end on interval edges: anything finer would be timing the forecast doesn't have. Rows without
       interval edges (hourly amounts) are their own 1-hour intervals. */
    const blk = (r) => (r.qpfFrom ? [Date.parse(r.qpfFrom), Date.parse(r.qpfTo)] : [T(r), T(r) + H]);
    if (have) { let best = null; for (let i = 0; i < rows.length; i++) { if (q[i] == null || (i > 0 && T(rows[i]) !== blk(rows[i])[0])) continue; let sum = 0, n = 0, keep = 0, kept = 0;
        for (let j = i; j < Math.min(rows.length, i + 24) && q[j] != null; j++) { sum += q[j]; n++; if (T(rows[j]) + H === blk(rows[j])[1] || j === rows.length - 1) { keep = n; kept = sum; } }
        if (keep >= 6 && (!best || kept > best.sum)) best = { i, sum: kept, n: keep }; }
      if (best && best.sum >= rainIn) { const w = rows.slice(best.i, best.i + best.n), wet = w.filter((r) => r.qpf >= 0.01), a = T(wet[0]), b = T(wet[wet.length - 1]) + H;
        let pk = null; const blocked = w.some((r) => r.qpfFrom);
        if (blocked) { for (const r of w) { if (r.qpfFrom && T(r) !== blk(r)[0]) continue; const [b0, b1] = blk(r), s = w.filter((x) => T(x) >= b0 && T(x) < b1).reduce((m, x) => m + x.qpf, 0); if (!pk || s > pk.s) pk = { s, t: b0, e: b1 }; } }
        else for (let i = 0; i + 6 <= w.length; i++) { const s6 = w.slice(i, i + 6).reduce((m, r) => m + (r.qpf || 0), 0); if (!pk || s6 > pk.s) pk = { s: s6, t: T(w[i]), e: T(w[i]) + 6 * H }; }
        const mid = pk ? (pk.t + pk.e) / 2 : a;
        out.push({ kind: "rain", rank: 4, at: mid, start: a, end: b, value: +best.sum.toFixed(2), short: "Heavy rain " + dayName(mid, tz, now), text: "Heavy rain: about " + best.sum.toFixed(1) + " in from " + span(a, b, tz) + (pk ? "; heaviest " + span(pk.t, pk.e, tz) + " (about " + pk.s.toFixed(1) + " in)" : ""), source: "NWS forecast (rain amounts)", link: "rain",
          partial: grid.qpfThrough && b >= Date.parse(grid.qpfThrough) - H, amountsEnd: grid.qpfThrough ? Date.parse(grid.qpfThrough) : null }); } }
    if (grid.qpfThrough) notes.push("Rain amounts forecast through " + fmtDay(Date.parse(grid.qpfThrough), tz) + " " + fmtH(Date.parse(grid.qpfThrough), tz));
    else notes.push("No rain amounts in the NWS forecast for this site");
    // wintry mix: contiguous hours with snow, sleet or freezing rain/drizzle at least a chance
    const WINTRY = /snow|sleet|freezing/;
    const runs = (pred) => { const r = []; let cur = null; for (const x of rows) { if (pred(x)) { if (!cur) { cur = { from: T(x), rows: [] }; r.push(cur); } cur.rows.push(x); cur.to = T(x) + H; } else cur = null; } return r; };
    for (const w of runs((r) => (r.wx || []).some((x) => WINTRY.test(x.type) && x.cov >= 2))) {
      const types = [...new Set(w.rows.flatMap((r) => (r.wx || []).filter((x) => x.cov >= 2).map((x) => x.type.replace(/_/g, " "))))], cov = Math.max(...w.rows.flatMap((r) => (r.wx || []).filter((x) => WINTRY.test(x.type)).map((x) => x.cov)));
      const snow = w.rows.reduce((m, r) => m + (r.snow || 0), 0), ice = w.rows.reduce((m, r) => m + (r.ice || 0), 0), mixed = types.length > 1, frz = types.some((t) => /freezing/.test(t));
      const word = cov >= 3 ? "likely" : "possible", name = frz ? "Freezing rain" : mixed ? "Wintry mix" : types[0].charAt(0).toUpperCase() + types[0].slice(1);
      out.push({ kind: "winter", rank: frz ? 4 : 3, at: w.from, short: name + " " + word + " " + dayName(w.from, tz, now) + " " + partOfDay(w.from, tz), text: name + " " + word + " " + span(w.from, w.to, tz) + ": " + types.join(", ")
        + (snow >= 0.1 ? "; snow about " + snow.toFixed(1) + " in" : "") + (ice >= 0.01 ? "; ice about " + ice.toFixed(2) + " in" : ""), source: "NWS forecast (precipitation type" + (snow >= 0.1 || ice >= 0.01 ? " and amounts" : "") + ")", link: "winter" }); }
    /* lingering rain: 6 or more hours of rain likely or definite, as separate rounds.
       An hour counts when its weather type says rain likely or definite and, where the grid gives amounts, its NWS interval holds a
       measurable amount (0.01 in or more; NWS spreads each interval's amount evenly over its hours). A round ends at 3 or more
       hours without that, so a dry spell is never counted as rain and two rounds stay two. Where the grid gives no amount, the
       weather type alone decides and the text says amounts aren't in the forecast yet. An hour with no weather type at all
       (missing guidance) always ends a round: nothing is bridged across hours the forecast doesn't cover. A round crossing
       midnight stays one round and is named by every day it covers ("Thursday into Friday").
       Timing is said only as finely as the guidance resolves it: an edge set by the weather type is to the hour; an edge set by the
       amounts (rain still "likely" but its interval holds none) is only known to fall inside that interval, so it reads
       "between Fri 1 AM and 7 AM". Light rain (0.01 in or less per 6 hours) at the end of a round is said ("light after …"). */
    const RAINY = (r) => (r.wx || []).some((x) => /rain|drizzle|showers/.test(x.type) && !/freezing/.test(x.type) && x.cov >= 3);
    const DRY_GAP = 3, total = (r) => r.qpf * (blk(r)[1] - blk(r)[0]) / H, LIGHT = 0.01 / 6 + 1e-9;
    const measurable = (r) => r.qpf == null || total(r) >= 0.01 - 1e-6, wetHour = (r) => RAINY(r) && measurable(r);
    const rowAt = new Map(rows.map((r) => [T(r), r]));
    const rounds = []; { let cur = null, gap = [];
      for (const x of rows) {
        if (wetHour(x)) { if (cur && gap.length < DRY_GAP && gap.every((g) => g.wx)) { cur.rows.push(...gap, x); cur.to = T(x) + H; } else { cur = { from: T(x), to: T(x) + H, rows: [x] }; rounds.push(cur); } gap = []; }
        else if (cur) { gap.push(x); if (!x.wx || gap.length >= DRY_GAP) { cur = null; gap = []; } }
      } }
    const dayRange = (a, b) => { const d0 = dayName(a, tz, now), d1 = dayName(b - H, tz, now); return d0 === d1 ? d0 : d0 + (localDate(b - H, tz) <= localDate(a + 864e5, tz) ? " into " : " to ") + d1; };
    const byAmounts = (r) => r && RAINY(r) && r.qpf != null && !measurable(r);
    const at = (t) => fmtDay(t, tz) + " " + fmtH(t, tz), between = (b) => "between " + at(b[0]) + " and " + (fmtDay(b[0], tz) === fmtDay(b[1], tz) ? "" : fmtDay(b[1], tz) + " ") + fmtH(b[1], tz);
    /* the headline's timing line, in words (the hour and AM/PM never split across lines): "from 3 AM Thursday through 7 PM Friday, with light rain after 7 AM Friday".
       An edge known only to its 6-hour interval reads "between 6 PM Thursday and 12 AM Friday". */
    const hm = (t) => fmtH(t, tz).replace(" ", "\u00a0"), long = (t) => hm(t) + " " + dayName(t, tz, now), sameDay = (a, b) => localDate(a, tz) === localDate(b, tz);
    const longBetween = (b) => "between " + (sameDay(b[0], b[1]) ? hm(b[0]) + " and " + long(b[1]) : long(b[0]) + " and " + long(b[1]));
    const timing = (w, startIn, endIn, lightFrom) => (startIn || endIn
      ? (startIn ? "starting " + longBetween(startIn) : "from " + long(w.from)) + (endIn ? ", ending " + longBetween(endIn) : (startIn ? " and lasting" : "") + " through " + long(w.to))
      : sameDay(w.from, w.to) ? "from " + hm(w.from) + " through " + long(w.to) : "from " + long(w.from) + " through " + long(w.to))
      + (lightFrom != null ? ", with light rain after " + long(lightFrom) : "");
    for (const w of rounds) {
      const first = w.rows[0], last = w.rows[w.rows.length - 1];
      const startIn = byAmounts(rowAt.get(w.from - H)) && blk(first)[1] - blk(first)[0] > H ? blk(first) : null;
      const endIn = byAmounts(rowAt.get(w.to)) && blk(last)[1] - blk(last)[0] > H ? blk(last) : null;
      const sure0 = startIn ? startIn[1] : w.from, sure1 = endIn ? endIn[0] : w.to;
      const hrs = Math.round((w.to - w.from) / H), least = Math.max(0, Math.round((sure1 - sure0) / H)); if (hrs < 6) continue;
      const when = startIn || endIn ? (startIn ? between(startIn) : at(w.from)) + " until " + (endIn ? between(endIn) : at(w.to)) : span(w.from, w.to, tz);
      let lightFrom = null; for (let k = w.rows.length - 1; k >= 0 && w.rows[k].qpf != null && w.rows[k].qpf <= LIGHT; k--) lightFrom = T(w.rows[k]);
      if (lightFrom != null && (lightFrom <= w.from || w.to - lightFrom < 6 * H)) lightFrom = null;
      const hits = new Set(); for (let t = sure0; t < sure1; t += H) { const d = new Date(t), dow = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d), h = +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(d); if (/Sat|Sun/.test(dow)) continue; for (const [a, b, n] of COMMUTE) if (h >= a && h < b) hits.add(dow + " " + n); }
      const amt = w.rows.every((r) => r.qpf != null) ? w.rows.reduce((m, r) => m + r.qpf, 0) : null, c = [...hits];
      out.push({ kind: "linger", rank: 2, at: w.from, start: w.from, end: w.to, day: dayName(w.from, tz, now), days: dayRange(w.from, w.to), amountsKnown: amt != null,
        when: when + (lightFrom != null ? ", light after " + at(lightFrom) : ""), lightFrom, timing: timing(w, startIn, endIn, lightFrom),
        short: "Rain likely " + dayRange(w.from, w.to),
        text: "Rain likely for about " + (least < hrs ? least + "–" : "") + hrs + " hours, " + when + (amt != null ? (amt >= 0.05 ? " (about " + amt.toFixed(1) + " in)" : "") : " (rain amounts not in the NWS forecast yet)")
          + (c.length ? "; covers " + (c.length === 1 ? "the " + c[0] : c.length + " commutes: " + c.join(", ")) : "")
          + (lightFrom != null ? "; light after " + at(lightFrom) + " (0.01 in or less per 6 hours)" : ""),
        source: "NWS forecast (precipitation type, chance" + (amt != null ? " and amounts" : "") + ")", link: "rain" }); }
    // heat: the peak heat index and when
    const hp = rows.reduce((b, r) => (r.heat != null && (!b || r.heat > b.heat) ? r : b), null);
    if (hp && hp.heat >= heatF) out.push({ kind: "heat", rank: hp.heat >= 103 ? 4 : 3, at: T(hp), value: hp.heat, short: "Heat index " + hp.heat + "°F " + dayName(T(hp), tz, now), text: "Heat index to " + hp.heat + "°F around " + fmtDay(T(hp), tz) + " " + fmtH(T(hp), tz), source: "NWS forecast (heat index)", link: null });
    out.sort((a, b) => b.rank - a.rank || a.at - b.at);
    /* checks the grid's answer couldn't support: NWS sometimes serves a grid with whole layers empty (rain amounts, weather types).
       Heat counts as checked while temperatures are there: winter grids carry no heat index, and that is not a gap. */
    /* heavy rain's own timing line (used when no lingering-rain round shares its hours), in the same words as the rounds */
    for (const h of out) if (h.kind === "rain") { h.timing = "from " + (sameDay(h.start, h.end) ? hm(h.start) : long(h.start)) + " through " + long(h.end);
      if (h.partial && h.amountsEnd) h.amountsNote = "rain amounts stop at " + long(h.amountsEnd) + ", so the total may be higher"; }
    /* rain amounts that stop in the middle of rain: where the known hours just before the stop don't reach the threshold, heavy
       rain past that point can't be ruled out. Counted when the last known hour has rain or the next hour has rain likely. */
    const gaps = [], coverage = [], COVER_H = 60, wetType = /rain|drizzle|showers|thunderstorms|snow|sleet/;
    for (let i = 0; i + 1 < rows.length; i++) {
      if (q[i] == null || q[i + 1] != null) continue;
      const next = rows[i + 1], goesOn = q[i] >= 0.01 || (next.wx || []).some((x) => wetType.test(x.type) && x.cov >= 3); if (!goesOn) continue;
      const stop = T(rows[i]) + H; if (out.some((h) => h.kind === "rain" && h.end > stop - 24 * H)) continue; // a heavy-rain highlight already covers these hours (and says if its amounts stop)
      /* where the amounts end is normal forecast coverage when it is the end of the grid's amounts and at least COVER_H after
         the grid's update (NWS forecasts amounts about 3 days ahead: 69-75 h in the saved CVG grids). That is a quiet note on
         the day ("Sunday rain amounts after 7 PM aren't available yet"), not "Not fully checked". Amounts that stop earlier, or a
         hole with amounts again after it, are missing data inside the forecast window and stay "Not fully checked". */
      const isEnd = !q.slice(i + 1).some((v) => v != null), upd = Date.parse(grid.updated || "");
      if (isEnd && Number.isFinite(upd) && stop >= upd + COVER_H * H) { coverage.push({ at: stop, text: dayName(stop, tz, now, true) + " rain amounts after " + fmtH(stop, tz) + " aren't available yet (NWS forecasts them about 3 days ahead)" }); continue; }
      let known = 0; for (let j = i; j > i - 24 && j >= 0 && q[j] != null; j--) known += q[j];
      gaps.push({ at: stop, text: "heavy rain after " + fmtDay(stop, tz) + " " + fmtH(stop, tz) + " (rain amounts stop while rain is still forecast; about " + known.toFixed(2) + " in before then)" }); }
    /* rain likely on a later day, entirely past the end of the amounts: said on that day */
    if (coverage.length) for (const it of out) if (it.kind === "linger" && it.start >= coverage[0].at && localDate(it.start, tz) !== localDate(coverage[0].at - H, tz))
      coverage.push({ at: it.start, text: dayName(it.start, tz, now, true) + " rain amounts aren't available yet" });
    const unchecked = [];
    if (!grid.qpfThrough) unchecked.push("heavy rain (no rain amounts)");
    if (!grid.wxThrough) unchecked.push("wintry mix and long rain (no precipitation types)");
    if (!grid.heatThrough && !rows.some((r) => r.temp != null)) unchecked.push("heat (no heat index or temperatures)");
    const uncheckedAt = unchecked.map(() => now);
    for (const g of gaps) { unchecked.push(g.text); uncheckedAt.push(g.at); }
    return { list: out, notes, missing: false, unchecked, uncheckedAt, coverage };
  }
  /* The site headline from the highlights: the main impact first. Lingering rain that overlaps the heavy-rain window is the same
     event (its hours go in the timing line, not a second headline item). A separate round of rain reads "More rain <day>"; it is
     only there when the highlights hold one, i.e. 6+ hours of rain likely or definite after a dry gap. */
  /* the lead (beta's headline: "Heavy rain Thursday · More rain Sunday"). Underneath, each rain event has its own timing: the
     first event's line, then the later round's on a line of its own ("More rain likely Sunday · from 1 PM through 7 PM Sunday"),
     so Sunday never reads as sharing Thursday's window. Heavy rain with no lingering round gets its own window; where its
     amounts stop inside the window, the timing says so. */
  function highlightLead(list, tz) {
    const heavy = list.find((item) => item.kind === "rain");
    const sameEvent = (item) => heavy && item.kind === "linger" && item.start < heavy.end && item.end > heavy.start;
    const related = list.find(sameEvent);
    const top = list.filter((item) => !sameEvent(item)).slice(0, 2);
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    const words = top.map((item, i) => (i > 0 && item.kind === "linger" && ["rain", "linger"].includes(top[0].kind) ? "More rain " + item.days : item.short));
    const rain = top.includes(heavy) ? related || heavy : top.find((item) => item.kind === "linger");
    const note = top.includes(heavy) && heavy.amountsNote ? "; " + heavy.amountsNote : "";
    const isRain = (item) => item.kind === "rain" || item.kind === "linger";
    const later = top[0] && isRain(top[0]) ? list.filter((item) => item !== top[0] && item !== rain && isRain(item) && !sameEvent(item) && item.timing).sort((x, y) => x.start - y.start)[0] : null;
    const more = later ? "More " + (later.kind === "rain" ? "heavy rain " + later.short.replace(/^Heavy rain /, "") : "rain likely " + later.days) + " · " + later.timing : "";
    return { text: words.map(cap).join(" · "), timing: rain && rain.timing ? (rain === heavy && !related ? "Rain " : "Rain likely ") + rain.timing + note : "", more };
  }
  const dayName = (ms, tz, now, weekday) => !weekday && localDate(ms, tz) === localDate(now, tz) ? "today" : new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(ms)); // weekdays: planners count by them

  function build(inp) {
    const tz = inp.tz, now = inp.now, pt = [inp.venue.lon, inp.venue.lat], nDays = inp.days || 7;
    const dates = []; for (let i = 0; i < nDays; i++) dates.push(localDate(now + i * 864e5, tz));
    const days = dates.map((date, i) => ({ date, label: dayLabel(date, i, tz), items: [], unknown: [], limits: [] }));
    const at = (ms) => days.find((d) => d.date === localDate(ms, tz));
    const put = (ms, item) => { const d = at(ms); if (d) d.items.push(item); };
    const unknownOn = (ms, why) => { const d = at(ms); if (d && !d.unknown.includes(why)) d.unknown.push(why); };
    /* a known limit of a source (SPC can't say yet for Days 6-8): shown, but not a failure */
    const limitOn = (ms, why) => { const d = at(ms); if (d && !d.limits.includes(why)) d.limits.push(why); };
    const inside = (g) => g && T.contains(g, pt);
    /* approaching: the highest area within 100 miles that is higher than the venue's own (distance and direction from the venue) */
    const NEAR_KM = 161, nearHigher = (ps, levelOf, atLevel) => { let best = null; for (const p of ps) { if (!p.geometry || inside(p.geometry)) continue; const lv = levelOf(p); if (!(lv > atLevel)) continue; const r = T.relation({ kind: "outlook", geometry: p.geometry }, inp.venue, NEAR_KM); if (r.kind === "near" && (!best || lv > best.lv || (lv === best.lv && r.km < best.r.km))) best = { p, lv, r }; } return best; };
    const nearText = (b) => Math.max(1, Math.round(T.miles(b.r.km))) + " mi " + b.r.dir;
    /* a convective day's afternoon (12Z start + 6 h) decides which local day it belongs to */
    const mid = (p) => Date.parse(p.validStart) + 6 * 3600e3;

    // SPC Days 1-3: the highest category over the venue
    for (const d of [1, 2, 3]) {
      const st = (inp.states.spc || {})[d], ps = (inp.spc || []).filter((p) => p.day === d);
      if (st !== "ok") { const ref = ps[0] || null; if (ref) unknownOn(mid(ref), "SPC Day " + d + " outlook not confirmed"); else if (inp.spcDayStart && inp.spcDayStart[d]) unknownOn(mid({ validStart: inp.spcDayStart[d] }), "SPC Day " + d + " outlook not confirmed"); continue; }
      const top = T.outlookAt(ps, pt); if (top) put(mid(top), { key: "severe", level: SPC_LEVEL[top.category] || 0, text: top.category === "TSTM" ? "Thunderstorms possible" : "Severe storms: " + SPC_NAME[top.category], source: "SPC Day " + d, link: "day" + d });
      const nb = nearHigher(ps.filter((p) => p.category !== "TSTM"), (p) => SPC_LEVEL[p.category] || 0, top ? SPC_LEVEL[top.category] || 0 : 0);
      if (nb) put(mid(nb.p), { key: "severe", level: Math.max(0, nb.lv - 1), text: "Nearby: " + SPC_NAME[nb.p.category] + ", " + nearText(nb), source: "SPC Day " + d, link: "day" + d, near: true });
    }
    // SPC Days 4-8: 15% / 30% areas; "predictability too low" is unknown
    for (const o of inp.spc48 || []) {
      if (o.failed) { if (o.validStart) unknownOn(mid(o), "SPC Day " + o.day + " outlook not confirmed"); continue; }
      const hit = o.products.filter((p) => inside(p.geometry)).sort((a, b) => b.prob - a.prob)[0];
      if (hit) put(mid(o), { key: "severe", level: hit.prob >= 30 ? 3 : 2, text: "Severe storms: " + hit.prob + "% chance within 25 miles", source: "SPC Day " + o.day, link: null });
      const nb = nearHigher(o.products, (p) => (p.prob >= 30 ? 3 : 2), hit ? (hit.prob >= 30 ? 3 : 2) : 0);
      if (nb) put(mid(o), { key: "severe", level: Math.max(0, nb.lv - 1), text: "Nearby: " + nb.p.prob + "% severe area, " + nearText(nb), source: "SPC Day " + o.day, link: null, near: true });
      else if (o.status === "predictability-too-low") limitOn(mid(o), "SPC can't say yet for severe storms (Day " + o.day + ": predictability too low)");
    }
    // WPC excessive rainfall Days 1-5
    for (const o of inp.ero || []) {
      if (o.failed) { if (o.validStart) unknownOn(mid(o), "WPC Day " + o.day + " rainfall outlook not confirmed"); continue; }
      const hit = (o.products || []).filter((p) => inside(p.geometry)).sort((a, b) => (ERO_LEVEL[b.category] || 0) - (ERO_LEVEL[a.category] || 0))[0];
      if (hit) put(mid(o), { key: "rain", level: ERO_LEVEL[hit.category] || 1, text: "Excessive rainfall: " + ERO_NAME[hit.category], source: "WPC Day " + o.day, link: o.day <= 3 ? "day" + o.day : null });
      const nb = nearHigher(o.products || [], (p) => ERO_LEVEL[p.category] || 0, hit ? ERO_LEVEL[hit.category] || 0 : 0);
      if (nb && o.validStart) put(mid(o), { key: "rain", level: Math.max(0, nb.lv - 1), text: "Nearby: excessive rainfall " + ERO_NAME[nb.p.category] + ", " + nearText(nb), source: "WPC Day " + o.day, link: o.day <= 3 ? "day" + o.day : null, near: true });
    }
    // SPC fire weather Days 1-8 (the highest of the day's parts)
    if (inp.states.fire === "ok") {
      const byDay = new Map(); for (const p of inp.fire || []) if (inside(p.geometry)) { const k = p.day, cur = byDay.get(k); if (!cur || (FIRE_LEVEL[p.category] || 0) > (FIRE_LEVEL[cur.category] || 0)) byDay.set(k, p); }
      for (const p of byDay.values()) put(mid(p), { key: "fire", level: FIRE_LEVEL[p.category] || 1, text: "Fire weather: " + (FIRE_NAME[p.category] || p.category), source: "SPC fire Day " + p.day, link: "fire" });
    } else if (inp.states.fire && inp.states.fire !== "off") unknownOn(now, "SPC fire weather outlooks not confirmed");
    // WPC WSSI-P (winter): the highest impact level with at least a 30% chance, per window
    if (inp.states.wssi === "ok") for (const w of inp.wssi || []) {
      let top = null; for (const L of WSSI_LEVELS) if ((w.levels[L] || 0) >= 30) top = L;
      if (top && top !== "WWA") put(Date.parse(w.start) + 6 * 3600e3, { key: "winter", level: WSSI_LEVEL[top], text: "Winter storm impacts: " + w.levels[top] + "% chance of " + WSSI_NAME[top] + " or worse", source: "WPC WSSI-P", link: "winter" });
      else if (top === "WWA") put(Date.parse(w.start) + 6 * 3600e3, { key: "winter", level: 0, text: "Winter weather possible (" + w.levels.WWA + "%)", source: "WPC WSSI-P", link: "winter" });
    } else if (inp.states.wssi === "failed") unknownOn(now, "WPC winter outlook not confirmed");
    // NHC: the venue inside a forecast cone, or inside a 7-day formation area
    for (const p of inp.nhc || []) if (inside(p.geometry)) {
      if (p.kind === "tctrack" && p.part === "cone") put(now, { key: "tropical", level: 3, text: "Inside the forecast cone of " + (p.name || "a tropical system"), source: "NHC", link: "active" });
      else if (p.kind === "tcoutlook") put(now, { key: "tropical", level: (p.prob7 || 0) >= 60 ? 2 : 1, text: "In NHC's 7-day formation area (" + (p.prob7 || "?") + " chance)", source: "NHC", link: "active" });
    }
    // the NWS forecast grid: gusts, heat index, wind chill / feels-like, rain chance, per local day
    if (inp.grid && inp.grid.rows) {
      const by = new Map(); for (const r of inp.grid.rows) { const k = localDate(Date.parse(r.t), tz); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
      for (const d of days) { const rs = by.get(d.date); if (!rs || !rs.length) continue; const max = (k) => rs.reduce((m, r) => (r[k] != null && (m == null || r[k] > m) ? r[k] : m), null), min = (k) => rs.reduce((m, r) => (r[k] != null && (m == null || r[k] < m) ? r[k] : m), null);
        const g = max("gust"), h = max("heat"), c = min("feels"), pop = max("pop");
        if (g != null && g >= 25) d.items.push({ key: "wind", level: g >= 58 ? 3 : g >= 40 ? 2 : g >= 30 ? 1 : 0, text: "Gusts to " + g + " mph", source: "NWS forecast", link: null });
        if (h != null && h >= 90) d.items.push({ key: "heat", level: h >= 125 ? 3 : h >= 103 ? 2 : 1, text: "Heat index to " + h + "°F", source: "NWS forecast", link: null });
        if (c != null && c <= 20) d.items.push({ key: "cold", level: c <= -30 ? 3 : c <= -15 ? 2 : c <= 10 ? 1 : 0, text: "Feels like " + c + "°F", source: "NWS forecast", link: null });
        if (pop != null && pop >= 40) d.items.push({ key: "precip", level: 0, text: "Rain or snow chance " + pop + "%", source: "NWS forecast", link: null });
        /* fire weather at the site, from the same grid: the day's minimum relative humidity, and the hours that are both dry and
           gusty (humidity at or below 25% with gusts of 25 mph or more; 15% and 35 mph is a higher concern). This is the NWS
           forecast grid, not an official fire weather product: Red Flag Warnings and SPC fire outlooks stay the official word. */
        const rh = min("rh"), dg = rs.filter((r) => r.rh != null && r.gust != null && r.rh <= 25 && r.gust >= 25);
        if (dg.length) { const worst = dg.reduce((b, r) => (r.rh * 100 - r.gust < b.rh * 100 - b.gust ? r : b)), hi = dg.some((r) => r.rh <= 15 && r.gust >= 35);
          d.items.push({ key: "dry", level: hi ? 2 : 1, text: "Dry and gusty: humidity " + worst.rh + "% with gusts to " + worst.gust + " mph (" + dg.length + " h)", source: "NWS forecast", link: "fire", rh, gust: g, hours: dg.length }); }
        else if (rh != null && rh <= 30) d.items.push({ key: "dry", level: 0, text: "Humidity as low as " + rh + "%", source: "NWS forecast", link: "fire", rh, gust: g }); }
    } else if (inp.states.grid === "failed") unknownOn(now, "NWS forecast for the venue not confirmed");
    const HL = inp.grid && inp.grid.rows ? highlights(inp.grid, tz, now, inp.highlightOpts) : { list: [], notes: [], missing: true };
    (HL.coverage || []).forEach((c) => limitOn(c.at, c.text)); // normal forecast coverage: a note on the day, not a failure
    (HL.unchecked || []).forEach((u, k) => unknownOn((HL.uncheckedAt || [])[k] || now, "NWS forecast for the venue came back incomplete; not checked: " + u));
    for (const h of HL.list) { const d = at(h.at); if (d) d.items.unshift({ key: "hl-" + h.kind, level: 0, highlight: true, text: h.text, source: h.source, link: h.link }); }
    // NOAA river gauges within 25 miles: forecast (or observed) at or above action stage, on the day it is expected
    const GL = { action: 0, minor: 1, moderate: 2, major: 3 }, GW = { action: "action stage", minor: "minor flooding", moderate: "moderate flooding", major: "major flooding" };
    for (const g of inp.gauges || []) {
      const d = T.pointDistance(pt, g.point); if (T.miles(d.km) > 25) continue;
      if (g.obs && GL[g.obs.category] != null && g.obs.category !== "action") put(now, { key: "river", level: GL[g.obs.category], text: g.name + ": " + GW[g.obs.category] + " now (" + g.obs.value + " " + g.obs.unit + ")", source: "NOAA river gauge", link: null });
      if (g.fcst && GL[g.fcst.category] != null && g.fcst.time) put(Date.parse(g.fcst.time), { key: "river", level: GL[g.fcst.category], text: g.name + ": forecast " + GW[g.fcst.category] + " (" + g.fcst.value + " " + g.fcst.unit + ")", source: "NOAA river forecast", link: null });
    }
    if (inp.states.gauges === "failed") unknownOn(now, "NOAA river gauges not confirmed");
    // AirNow forecast for the venue's reporting area
    for (const p of inp.aq || []) { const lv = AQ_LEVEL[p.category]; if (lv) put(Date.parse(p.validDate + "T18:00:00Z"), { key: "air", level: lv, text: "Air quality: " + p.category + (p.aqi ? " (AQI " + p.aqi + ")" : "") + (p.pollutant ? ", " + p.pollutant : ""), source: "AirNow forecast", link: null }); }
    // NWS alerts covering the venue: listed on top, and on each day they cover
    const alerts = (inp.alerts || []).map((a) => ({ event: a.event, level: alertLevel(a.event), headline: a.headline || "", start: Date.parse(a.onset || a.effective), end: Date.parse(a.ends || a.expires), sender: a.senderName || "" }))
      .filter((a) => isFinite(a.end) && a.end > now).sort((a, b) => b.level - a.level || a.start - b.start);
    for (const a of alerts) for (const d of days) { const d0 = Date.parse(new Date(d.date + "T00:00:00Z").toISOString()), s = localDate(Math.max(a.start, now), tz), e = localDate(a.end - 1, tz); if (d.date >= s && d.date <= e) d.items.push({ key: "alert", level: a.level, text: a.event, source: "NWS", link: "active" }); }
    if (inp.states.alerts === "failed") unknownOn(now, "NWS alerts for the venue not confirmed");
    for (const d of days) d.items.sort((a, b) => b.level - a.level);
    // the headline: the highest level ahead (earliest on a tie)
    let best = null; days.forEach((d, i) => d.items.forEach((it) => { if (it.level >= 1 && (!best || it.level > best.it.level)) best = { it, d, i }; }));
    const unknownAll = [...new Set(days.flatMap((d) => d.unknown))];
    const headline = best ? { level: best.it.level, text: best.it.text, when: best.d.label, source: best.it.source }
      : { level: 0, text: unknownAll.length ? "No significant threat in the sources that answered" : "No significant threats in the next " + nDays + " days", when: null, source: null };
    return { headline, alerts, days, unknown: unknownAll, highlights: HL };
  }
  return { build, alertLevel, localDate, highlights, highlightLead };
});
