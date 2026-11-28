/* Weather Records & Milestones: one calculation engine for any market (no network).
   Browser: window.RecordsEngine (needs AlmanacCore and RecordsHolidays loaded first); Node: require().

   Inputs are daily observations for one climate record (an official threaded city record or a single station), as
   ACIS-style rows [date, value] per element, plus a market descriptor:
     { id, name, country, region, tz, units: { precip: "in"|"mm", temp: "F"|"C" },
       record: { sid, name, kind: "threaded"|"station", from, sources } , normals?: { monthly: { "11": 3.23 }, daily?: Map } }
   Every finding carries the record it came from, its date range, the usable sample, what was excluded and the
   observation status, so Overview and Almanac can show the evidence and the copy can stand alone.

   Rules (all finders)
   - Missing ("M") never counts as zero and is left out of every sample and denominator; the count is reported.
   - Trace ("T") is kept apart from zero: it is never a record amount and never meets a threshold.
   - Ties are listed (all tied years), never broken arbitrarily.
   - Leap days are compared with leap years only.
   - A claim is suppressed when its usable sample is under minYears (default 30) or under minShare (default 80%) of the
     years in the record's span for that comparison.
   - Holidays use each year's observed date (RecordsHolidays). Where the observed date is uncertain (1939-1941 US
     Thanksgiving), every candidate is tried and the result is published only if it is the same for all of them.
   - Observed values only: forecast or model values never enter a record or ranking. Status comes from the caller:
     "final" (the value is confirmed in the quality-controlled archive), "preliminary" (a provisional report, such as
     the daily climate report, not yet confirmed), "unconfirmed" (a historical observation whose value hasn't been
     checked against the archive, e.g. a place without a records pack; never inferred from its age) or "interim" (a
     same-day report before the day is complete); interim values are never used for record claims. */
(function (root) {
  "use strict";
  const A = typeof module !== "undefined" && module.exports ? require("./almanac-core.js") : root.AlmanacCore;
  const HOL = typeof module !== "undefined" && module.exports ? require("./records-holidays.js") : root.RecordsHolidays;
  const val = A.val, ordinal = A.ordinal || ((n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); });
  const yearOf = (d) => +d.slice(0, 4), mdOf = (d) => d.slice(5, 10);
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const longDate = (d) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`;
  const shortDate = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
  const DAY = 86400e3, addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

  /* ---------- elements: what a record means for each kind of value ---------- */
  const ELEMENTS = {
    pcpn: { col: "pcpn", dir: "max", kind: "amount", noun: "rain", nounLong: "precipitation", record: "rainfall record", label: "Precipitation" },
    snow: { col: "snow", dir: "max", kind: "amount", noun: "snow", nounLong: "snowfall", record: "snowfall record", label: "Snowfall" },
    hiMax: { col: "maxt", dir: "max", kind: "temp", noun: "high", record: "record high", label: "Record high" },
    loMin: { col: "mint", dir: "min", kind: "temp", noun: "low", record: "record low", label: "Record low" },
    hiMin: { col: "mint", dir: "max", kind: "temp", noun: "warm low", record: "record warm low (warmest minimum)", label: "Warmest low" },
    loMax: { col: "maxt", dir: "min", kind: "temp", noun: "cold high", record: "record cold high (coldest maximum)", label: "Coldest high" },
  };
  /* ---------- units ---------- */
  function fmt(v, el, units = {}) {
    if (el.kind === "temp") return `${Math.round(v)}°${units.temp || "F"}`;
    const mm = units.precip === "mm"; if (el.col === "snow") return mm ? `${(v * (units.raw === "mm" ? 0.1 : 2.54)).toFixed(1)} cm` : `${v.toFixed(1)} in`;
    return mm ? `${(units.raw === "mm" ? v : v * 25.4).toFixed(1)} mm` : `${v.toFixed(2)} in`;
  }
  const better = (a, b, dir) => (dir === "max" ? a > b : a < b);

  /* ---------- series ---------- */
  /* rows [[date, value], ...] or [[date, v1, v2, ...]] with col index -> Map(date -> {v, trace, missing}) */
  function series(rows, col = 1) { const m = new Map(); rows.forEach((r) => m.set(r[0], val(r[col]))); return m; }
  const span = (S) => { const ks = [...S.keys()].sort(); return { from: ks[0], to: ks[ks.length - 1] }; };

  /* the status words used everywhere, so observed, preliminary and forecast never blur */
  const STATUS = { final: "Observed record", preliminary: "Preliminary observation", unconfirmed: "Archive confirmation unavailable", interim: "Interim report", forecast: "Forecast record potential" };
  /* what a stand-alone Copy fact adds for a status that isn't final */
  const NOTE = (st, long = false) => (st === "preliminary" ? (long ? " (preliminary data)" : " (preliminary)") : st === "unconfirmed" ? " (archive confirmation unavailable)" : "");

  /* ---------- daily record ---------- */
  /* opts: { S (series), date, el (ELEMENTS key), value? (defaults to S.get(date)), minYears = 30, minShare = 0.8, top = 10 } */
  function dailyRecord({ S, date, el: key, value = null, minYears = 30, minShare = 0.8, top = 10 }) {
    const el = ELEMENTS[key], y0 = yearOf(date), md = mdOf(date), leap = md === "02-29";
    const today = value != null ? (typeof value === "object" ? value : { v: value }) : S.get(date);
    if (!today || today.missing || today.v == null) return null;
    if (el.kind === "amount" && (today.trace || today.v <= 0)) return null; // a dry day sets no amount record
    const { from } = span(S), first = yearOf(from) + (mdOf(from) > md ? 1 : 0);
    const hist = [], missing = [];
    for (let y = first; y < y0; y++) { if (leap && !isLeap(y)) continue; const x = S.get(`${y}-${md}`); if (!x || x.missing) missing.push(y); else hist.push({ y, v: x.v, trace: !!x.trace }); }
    const possible = hist.length + missing.length;
    const enough = hist.length >= minYears && possible > 0 && hist.length / possible >= minShare;
    if (!hist.length) return null;
    const best = hist.reduce((a, x) => (better(x.v, a, el.dir) ? x.v : a), hist[0].v), tied = hist.filter((x) => x.v === best).map((x) => x.y);
    const outcome = today.v === best ? "tie" : better(today.v, best, el.dir) ? "new" : "none";
    /* rank of this year's value among every usable year including this one (1 = most extreme); ties share a rank */
    const all = [...hist, { y: y0, v: today.v, trace: !!today.trace }].filter((x) => el.kind !== "amount" || (!x.trace && x.v > 0) || x.y === y0);
    const sorted = [...hist, { y: y0, v: today.v }].sort((a, b) => (el.dir === "max" ? b.v - a.v : a.v - b.v));
    const rank = 1 + sorted.filter((x) => better(x.v, today.v, el.dir)).length;
    const ranked = [...hist, { y: y0, v: today.v }].sort((a, b) => (el.dir === "max" ? b.v - a.v : a.v - b.v) || a.y - b.y).slice(0, top);
    return { kind: "dailyRecord", el: key, date, value: today.v, outcome, enough, rank, of: hist.length + 1,
      previous: { value: best, years: tied, age: y0 - Math.max(...tied), margin: +(Math.abs(today.v - best)).toFixed(el.kind === "temp" ? 0 : 2) },
      top: ranked, sample: { n: hist.length, from: first, to: y0 - 1, missing: missing.length, missingYears: missing.slice(0, 20), leapOnly: leap }, unusedAll: all.length };
  }

  /* ---------- holiday ranking and historical frequency ---------- */
  /* opts: { S, holiday (RecordsHolidays key), year, region, el = "pcpn", threshold?, minYears, minShare, top } */
  function holidayRank({ S, holiday, year, region = null, el: key = "pcpn", threshold = null, minYears = 30, minShare = 0.8, top = 10 }) {
    const el = ELEMENTS[key], rule = HOL.RULES[holiday]; if (!rule) return null;
    const { from } = span(S), y1 = Math.max(yearOf(from), rule.from || 0);
    const thisDates = HOL.datesFor(holiday, year, region); if (!thisDates || thisDates.dates.length !== 1) return null;
    const thisDate = thisDates.dates[0], now = S.get(thisDate); if (!now || now.missing) return null;
    /* scenarios: for years with more than one candidate date, try each candidate position (all first, all second, ...) */
    const years = []; let maxC = 1;
    for (let y = y1; y <= year; y++) { const d = HOL.datesFor(holiday, y, region); if (d) { years.push({ y, dates: d.dates, note: d.note }); maxC = Math.max(maxC, d.dates.length); } }
    const run = (pick) => {
      const used = [], missing = [], unavailable = [];
      years.forEach(({ y, dates }) => { const d = dates[Math.min(pick, dates.length - 1)]; if (d > span(S).to || d < from) { unavailable.push(y); return; }
        const x = S.get(d); if (!x || x.missing) missing.push(y); else used.push({ y, date: d, v: x.v, trace: !!x.trace }); });
      const me = used.find((u) => u.y === year), sorted = [...used].sort((a, b) => (el.dir === "max" ? b.v - a.v : a.v - b.v) || a.y - b.y);
      const rank = me ? 1 + used.filter((u) => better(u.v, me.v, el.dir)).length : null;
      const meets = (u) => threshold != null && !u.trace && (el.dir === "max" ? u.v >= threshold : u.v <= threshold);
      const freq = threshold != null ? { threshold, count: used.filter(meets).length, n: used.length, before: { count: used.filter((u) => u.y < year && meets(u)).length, n: used.filter((u) => u.y < year).length } } : null;
      const dry = el.kind === "amount" ? { measurable: used.filter((u) => !u.trace && u.v > 0).length, trace: used.filter((u) => u.trace).length, zero: used.filter((u) => !u.trace && u.v === 0).length } : null;
      return { rank, n: used.length, top: sorted.slice(0, top), freq, dry, missing, unavailable, wettest: sorted[0] };
    };
    const runs = Array.from({ length: maxC }, (_, i) => run(i));
    const sig = (r) => JSON.stringify([r.rank, r.n, r.top.map((t) => [t.y, t.v]), r.freq && [r.freq.count, r.freq.n, r.freq.before.count, r.freq.before.n]]);
    const robust = runs.every((r) => sig(r) === sig(runs[0]));
    const R = runs[0], possible = R.n + R.missing.length;
    return { kind: "holidayRank", holiday, name: rule.name, el: key, year, date: thisDate, value: now.v, trace: !!now.trace, robust,
      enough: R.n >= minYears && possible > 0 && R.n / possible >= minShare, rank: R.rank, of: R.n, top: R.top, freq: R.freq, dry: R.dry,
      uncertainYears: years.filter((x) => x.dates.length > 1).map((x) => x.y), dryRange: runs.length > 1 ? runs.map((r) => r.dry && r.dry.measurable) : null,
      sample: { n: R.n, from: years.length ? years[0].y : null, to: year, missing: R.missing.length, missingYears: R.missing.slice(0, 20), unavailable: R.unavailable.length } };
  }

  /* ---------- last comparable occurrence ---------- */
  function lastOccurrence({ S, date, el: key = "pcpn", value = null }) {
    const el = ELEMENTS[key], v = value != null ? value : (S.get(date) || {}).v; if (v == null) return null;
    const meets = (x) => x && !x.missing && !x.trace && (el.dir === "max" ? x.v >= v : x.v <= v);
    let any = null, sameMonth = null; const m = date.slice(5, 7);
    const keys = [...S.keys()].filter((d) => d < date).sort();
    for (let i = keys.length - 1; i >= 0 && !(any && sameMonth); i--) { const d = keys[i], x = S.get(d); if (!meets(x)) continue; if (!any) any = { date: d, value: x.v }; if (!sameMonth && d.slice(5, 7) === m) sameMonth = { date: d, value: x.v }; }
    /* how this day ranks among all days of the same month in the record */
    const monthDays = keys.filter((d) => d.slice(5, 7) === m).map((d) => ({ d, x: S.get(d) })).filter((o) => o.x && !o.x.missing && !o.x.trace);
    const monthRank = 1 + monthDays.filter((o) => better(o.x.v, v, el.dir)).length;
    const above = monthDays.filter((o) => better(o.x.v, v, el.dir)).sort((a, b) => (el.dir === "max" ? b.x.v - a.x.v : a.x.v - b.x.v)).map((o) => ({ date: o.d, value: o.x.v }));
    return { kind: "lastOccurrence", el: key, date, value: v, any, sameMonth, monthRank, monthAbove: above, monthDays: monthDays.length + 1 };
  }

  /* ---------- month to date, against normal and against the same window in other years ---------- */
  /* normals: { month: total for the month, toDate: normal from day 1 through this day } (same units as S) */
  function monthToDate({ S, date, el: key = "pcpn", normals = null, minYears = 30 }) {
    const el = ELEMENTS[key], y0 = yearOf(date), mm = date.slice(5, 7), dd = +date.slice(8, 10);
    const sumYear = (y) => { let t = 0, miss = 0; for (let d = 1; d <= dd; d++) { const k = `${y}-${mm}-${String(d).padStart(2, "0")}`, x = S.get(k); if (!x || x.missing) { if (!(mm === "02" && d === 29 && !isLeap(y))) miss++; } else t += x.v; } return { t: +t.toFixed(2), miss }; };
    const me = sumYear(y0); if (me.miss) return { kind: "monthToDate", date, incomplete: true, missingDays: me.miss };
    const { from } = span(S), hist = [];
    for (let y = yearOf(from); y < y0; y++) { const s = sumYear(y); if (!s.miss) hist.push({ y, t: s.t }); }
    const rank = 1 + hist.filter((h) => better(h.t, me.t, el.dir)).length;
    return { kind: "monthToDate", el: key, date, total: me.t, normalToDate: normals && normals.toDate != null ? normals.toDate : null, monthNormal: normals && normals.month != null ? normals.month : null,
      departure: normals && normals.toDate != null ? +(me.t - normals.toDate).toFixed(2) : null, pct: normals && normals.toDate ? Math.round((100 * me.t) / normals.toDate) : null,
      rank, of: hist.length + 1, enough: hist.length >= minYears, sample: { n: hist.length, from: hist.length ? hist[0].y : null, to: y0 - 1 } };
  }

  /* ---------- the story: rank by significance, combine related findings, write plain copy ---------- */
  /* ctx: { market, date, S: { pcpn, snow, maxt, mint }, status(date, el?) -> "final"|"preliminary"|"interim" (el: "pcpn", "snow", "maxt" or
           "mint"; a value is final only once that station, date and measurement is confirmed, so it is asked per element), normals?: { pcpn: {month, toDate} },
           holidays?: [keys], thresholds?: { pcpn: 2 } } -> { items: [...], highlights: [...up to 3] } */
  function findings(ctx) {
    const { market, date } = ctx, units = market.units || {}, st0 = ctx.status ? ctx.status(date) : "final";
    const stOf = (el, d = date) => (ctx.status ? ctx.status(d, el) : "final"), COL = { pcpn: "pcpn", snow: "snow", hiMax: "maxt", loMax: "maxt", loMin: "mint", hiMin: "mint" };
    const items = [], rec = market.record, src = `${rec.name} (${rec.kind === "threaded" ? "official city record" : "station record"}, ${rec.sid})`;
    if (st0 === "interim") return { items, highlights: [], note: "Only an interim report so far: findings wait for the complete day." };
    /* a day is final only when every finding on it is */
    const dayStatus = () => { if (!items.length) return st0 === "final" ? "final" : st0 === "unconfirmed" ? "unconfirmed" : "preliminary";
      return items.every((i) => i.status === "final") ? "final" : items.some((i) => i.status === "preliminary") ? "preliminary" : "unconfirmed"; };
    const dayWord = longDate(date), sDate = shortDate(date);
    /* daily records for each element present */
    const recs = [];
    [["pcpn", "pcpn"], ["snow", "snow"], ["maxt", "hiMax"], ["mint", "loMin"], ["mint", "hiMin"], ["maxt", "loMax"]].forEach(([col, k]) => {
      const S = ctx.S[col]; if (!S) return; const r = dailyRecord({ S, date, el: k }); if (r && r.enough && (r.outcome !== "none" || r.rank <= 3)) recs.push(r); });
    recs.forEach((r) => {
      const el = ELEMENTS[r.el], v = fmt(r.value, el, units), pv = fmt(r.previous.value, el, units), yrs = listWords(r.previous.years), st = stOf(COL[r.el]), label = STATUS[st] || STATUS.final;
      const head = r.outcome === "new" ? `${el.kind === "amount" ? "Record " + el.noun : cap(el.record)} on ${sDate}` : r.outcome === "tie" ? `Tied the ${sDate} ${el.record}` : `${ordinal(r.rank)} ${el.dir === "max" ? "highest" : "lowest"} ${el.kind === "amount" ? el.nounLong : el.noun} for ${sDate}`;
      const body = r.outcome === "new" ? `${v} broke the ${sDate} record of ${pv} set in ${yrs}, a record ${r.previous.age} years old, by ${fmt(r.previous.margin, el, units).replace(/°[FC]$/, "°")}.`
        : r.outcome === "tie" ? `${v} tied the ${sDate} record set in ${yrs}.` : `${v} ranks ${ordinal(r.rank)} of ${r.of} years for ${sDate}. The record is ${pv} (${yrs}).`;
      const short = r.outcome === "new" ? `${v}, breaking ${pv} from ${yrs}.` : r.outcome === "tie" ? `${v}, tying ${yrs}.` : `${v}; the record is ${pv} (${yrs}).`;
      /* fact: the structured record for the Spotlight and the climate-table badge (row = the table's row id) */
      const fact = { el: r.el, row: COL[r.el], outcome: r.outcome, rank: r.rank, v, pv, yrs, age: r.previous.age, record: el.record.replace(/ \(.*\)$/, ""), noun: el.noun };
      items.push({ id: `rec-${r.el}`, fact, short, score: (r.outcome === "new" ? 100 : r.outcome === "tie" ? 85 : 40 - r.rank * 5) + Math.min(10, r.previous.age / 10), status: st, label, head, body,
        copyFact: `${market.name}'s ${v} ${el.kind === "amount" ? "of " + el.noun : el.noun} on ${dayWord} ${r.outcome === "new" ? `broke the ${sDate} record of ${pv} set in ${yrs}` : r.outcome === "tie" ? `tied the ${sDate} record set in ${yrs}` : `ranked ${ordinal(r.rank)} for the date`}${NOTE(st, true)}.`,
        evidence: { finding: r, source: src, range: `${r.sample.from} to ${r.sample.to}`, sample: `${r.sample.n} prior years with an observation${r.sample.missing ? `, ${r.sample.missing} missing and left out` : ", none missing"}${r.sample.leapOnly ? " (leap years only)" : ""}` } });
    });
    /* scope "calendarDay": the caller has only this calendar date's yearly values (e.g. the Almanac's records query), so
       only daily records can be judged; holiday rankings and context need the full daily record (a market pack) */
    if (ctx.scope === "calendarDay") { items.sort((a, b) => b.score - a.score); return { items, highlights: items.filter((i) => i.score >= 30).slice(0, 3), date, status: dayStatus(), scope: "calendarDay" }; }
    /* holidays on this date */
    const hols = (HOL.on(date, market.country || "US", market.region) || []).filter((h) => !ctx.holidays || ctx.holidays.includes(h.key));
    hols.forEach((h) => {
      const S = ctx.S.pcpn; if (!S) return; const thr = (ctx.thresholds && ctx.thresholds.pcpn) || null, st = stOf("pcpn"), label = STATUS[st] || STATUS.final;
      const r = holidayRank({ S, holiday: h.key, year: yearOf(date), region: market.region, el: "pcpn", threshold: thr && (S.get(date) || {}).v >= thr ? thr : null });
      if (!r || !r.enough || !r.robust || r.trace || !(r.value > 0)) return;
      const el = ELEMENTS.pcpn, v = fmt(r.value, el, units), ahead = r.top.filter((t) => t.v > r.value);
      if (r.rank <= 5) items.push({ id: `hol-${h.key}`, short: r.rank === 1 ? `${v}, wetter than any ${h.name} since ${r.sample.from}.` : `${v}. Only ${listWords(ahead.map((t) => `${t.y} (${fmt(t.v, el, units)})`))} ${ahead.length === 1 ? "was" : "were"} wetter.`, score: 90 - r.rank * 6 + (r.rank === 1 ? 20 : 0), status: st, label,
        head: r.rank === 1 ? `Wettest ${h.name} on record` : `${ordinal(r.rank)} wettest ${h.name} on record`,
        body: `${v} on ${h.name}, ${sDate}. ${r.rank === 1 ? `That tops ${r.top[1] ? `${r.top[1].y} (${fmt(r.top[1].v, el, units)})` : "every other year"}` : `Only ${listWords(ahead.map((t) => `${t.y} (${fmt(t.v, el, units)})`))} ${ahead.length === 1 ? "was" : "were"} wetter`}, ranked against each year's own ${h.name} date since ${r.sample.from}.`,
        copyFact: `${h.name} ${yearOf(date)} was ${market.name}'s ${r.rank === 1 ? "wettest" : `${ordinal(r.rank)} wettest`} on record${r.rank > 1 ? `, behind only ${listWords(ahead.map((t) => t.y))}` : ""}${NOTE(st)}.`,
        evidence: { finding: r, source: src, range: `${r.sample.from} to ${r.sample.to}`, sample: `${r.of} ${h.name}s with an observation${r.sample.missing ? `, ${r.sample.missing} missing and left out` : ", none missing"}${r.uncertainYears.length ? `; ${r.uncertainYears.join(", ")} dates varied by state, and the ranking is the same for every candidate date` : ""}` } });
      if (r.freq && r.freq.count <= Math.max(3, r.freq.n * 0.05)) {
        const t = fmt(r.freq.threshold, el, units).replace(/\.00 in$/, " inches"), pct = (100 * r.freq.count / r.freq.n).toFixed(1);
        const yrs = r.top.filter((x) => x.v >= r.freq.threshold).map((x) => x.y);
        items.push({ id: `freq-${h.key}`, short: `${r.freq.count} of ${r.freq.n} ${h.name}s since ${r.sample.from} reached ${t}.`, score: 55, status: st, label: `Frequency${st === "preliminary" ? ` · ${yearOf(date)} preliminary` : ""}`,
          head: `${t} on ${h.name} is rare`, body: `Only ${r.freq.count} of ${r.freq.n} ${h.name}s since ${r.sample.from} had at least ${t}${yrs.length ? ` (${listWords(yrs)})` : ""}, ${pct}% in this record. Before ${yearOf(date)}, ${r.freq.before.count} of ${r.freq.before.n}.`,
          copyFact: `Only ${r.freq.count === 2 ? "two" : r.freq.count} ${market.name} ${h.name}s since ${r.sample.from} have had at least ${t} of rain${yrs.length ? `: ${listWords(yrs)}` : ""}.`,
          evidence: { finding: r.freq, source: src, range: `${r.sample.from} to ${r.sample.to}`, sample: `${r.freq.n} ${h.name}s with an observation; historical frequency, not a probability` } });
      }
    });
    /* context: how rare a day like this is, and the month so far */
    const S = ctx.S.pcpn, today = S && S.get(date);
    if (S && today && !today.missing && !today.trace && today.v >= 1) {
      const st = stOf("pcpn"), label = STATUS[st] || STATUS.final;
      const lo = lastOccurrence({ S, date, el: "pcpn" }), el = ELEMENTS.pcpn;
      if (lo && lo.monthRank <= 5) items.push({ id: "ctx-month-day", short: `${ordinal(lo.monthRank)} wettest ${MONTHS[+date.slice(5, 7) - 1]} day since ${span(S).from.slice(0, 4)}.`, score: 45 - lo.monthRank, status: st, label, head: `${ordinal(lo.monthRank)} wettest ${MONTHS[+date.slice(5, 7) - 1]} day on record`,
        body: `Only ${listWords(lo.monthAbove.map((a) => `${longDate(a.date)} (${fmt(a.value, el, units)})`))} ${lo.monthAbove.length === 1 ? "was" : "were"} wetter. The last day of any month with this much rain was ${lo.any ? `${longDate(lo.any.date)} (${fmt(lo.any.value, el, units)})` : "never"}.`,
        copyFact: `${market.name}'s ${fmt(today.v, el, units)} on ${dayWord} was its ${ordinal(lo.monthRank)} wettest ${MONTHS[+date.slice(5, 7) - 1]} day on record${NOTE(st)}.`,
        evidence: { finding: lo, source: src, range: `${span(S).from.slice(0, 4)} to ${date.slice(0, 4)}`, sample: `${lo.monthDays} ${MONTHS[+date.slice(5, 7) - 1]} days with a measurable observation` } });
      const n = ctx.normals && ctx.normals.pcpn, mt = monthToDate({ S, date, el: "pcpn", normals: n });
      const stM = Array.from({ length: +date.slice(8, 10) }, (_, i) => stOf("pcpn", `${date.slice(0, 8)}${String(i + 1).padStart(2, "0")}`)).every((x) => x === "final") ? "final" : "preliminary";
      if (mt && !mt.incomplete && mt.normalToDate != null && Math.abs(mt.departure) >= 1) items.push({ id: "ctx-mtd", short: `${fmt(mt.total, el, units)} so far, ${mt.pct}% of normal to date.`, score: 30, status: stM, label: STATUS[stM],
        head: `${MONTHS[+date.slice(5, 7) - 1]} is running ${mt.departure > 0 ? "wet" : "dry"}`,
        body: `${fmt(mt.total, el, units)} through the ${ordinal(+date.slice(8, 10))}, ${fmt(Math.abs(mt.departure), el, units)} ${mt.departure > 0 ? "above" : "below"} normal to date (${mt.pct}%).${mt.monthNormal != null && mt.total > mt.monthNormal ? ` Already more than a normal full ${MONTHS[+date.slice(5, 7) - 1]} (${fmt(mt.monthNormal, el, units)}).` : ""}`,
        copyFact: `${market.name}'s ${MONTHS[+date.slice(5, 7) - 1]} is ${fmt(Math.abs(mt.departure), el, units).replace(/ in$/, " inches")} ${mt.departure > 0 ? "above" : "below"} normal through the ${ordinal(+date.slice(8, 10))}${NOTE(stM)}.`,
        evidence: { finding: mt, source: `${src}; normals ${market.normals && market.normals.label || "1991-2020"}`, range: `${MONTHS[+date.slice(5, 7) - 1]} 1 to ${+date.slice(8, 10)}`, sample: `${mt.of} years with a complete ${MONTHS[+date.slice(5, 7) - 1]} 1 to ${+date.slice(8, 10)}` } });
    }
    items.sort((a, b) => b.score - a.score);
    /* combine: a record day that is also a top holiday leads as one story (the holiday ranking becomes its supporting line) */
    const recP = items.find((i) => i.id === "rec-pcpn" && i.score >= 85), holP = items.find((i) => i.id.startsWith("hol-"));
    const highlights = items.filter((i) => i.score >= 30).slice(0, 3).map((i) => ({ ...i }));
    if (recP && holP) { const h = highlights.find((i) => i.id === recP.id); if (h) h.related = [holP.id]; }
    return { items, highlights, date, status: dayStatus() };
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const listWords = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
  /* ---------- a market's pack: the findings for its recent days, as the site reads them ----------
     Recomputed from the source on every refresh, so a revised value or a status change (preliminary -> final) simply
     replaces the earlier finding: nothing is carried over from the previous pack. A finding that no longer holds after a
     revision disappears. opts: { market, S, through, days = 7, finalThrough (latest final date or null), normalsFor(date)
     -> { month, toDate } | null, thresholds, sources, generated (ISO) } */
  /* confirmed: { "YYYY-MM-DD": { pcpn: true, snow: true, maxt: true, mint: true } }, the values the builder found in the
     quality-controlled archive (NCEI GHCN-Daily) for the same station and date with the same value and no quality flag.
     Anything not confirmed is preliminary. finalThrough is only the archive's latest date, for the coverage line: a date
     before it can still be missing or differ, so it never makes a value final by itself. */
  function pack({ market, S, through, days = 7, finalThrough = null, confirmed = {}, normalsFor = () => null, thresholds = { pcpn: 2 }, sources = [], generated = new Date().toISOString() }) {
    const status = (d, el) => (el && confirmed[d] && confirmed[d][el] ? "final" : "preliminary");
    const out = { schema: 2, id: market.id, generated, through, windowDays: days, finalThrough, market, sources, days: {} };
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(through, -i), f = findings({ market, date: d, S, status, normals: { pcpn: normalsFor(d) }, thresholds });
      if (f.items.length) out.days[d] = { status: f.status, items: f.items.map(({ evidence, ...it }) => ({ ...it, evidence: { source: evidence.source, range: evidence.range, sample: evidence.sample } })), highlights: f.highlights.map((h) => h.id) };
    }
    return out;
  }
  /* which values the quality-controlled archive confirms. rows: NCEI GHCN-Daily daily-summaries JSON for the market's
     station (units=standard, includeAttributes=true). A value is confirmed when the archive has that date and measurement,
     with no quality flag, and the same value as the record (precipitation within 0.005 in, snowfall within 0.05 in,
     temperature exact; a trace only matches a trace). -> { date: { pcpn, snow, maxt, mint } } */
  const NCEI = { pcpn: ["PRCP", 0.005], snow: ["SNOW", 0.05], maxt: ["TMAX", 0], mint: ["TMIN", 0] };
  function confirm({ S, rows }) {
    const out = {};
    (rows || []).forEach((r) => { const d = String(r.DATE || "").slice(0, 10);
      Object.entries(NCEI).forEach(([el, [k, tol]]) => {
        if (!S[el] || r[k] == null || r[k] === "") return;
        const [mflag = "", qflag = ""] = String(r[`${k}_ATTRIBUTES`] || "").split(","); if (qflag.trim()) return;
        const ours = S[el].get(d); if (!ours || ours.missing) return;
        const theirs = parseFloat(r[k]), trace = mflag.trim() === "T";
        const ok = ours.trace ? trace : !trace && isFinite(theirs) && Math.abs(theirs - ours.v) <= tol + 1e-9;
        if (ok) (out[d] = out[d] || {})[el] = true; }); });
    return out;
  }
  const api = { ELEMENTS, STATUS, series, confirm, dailyRecord, holidayRank, lastOccurrence, monthToDate, findings, pack, fmt, longDate, shortDate, addDays };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RecordsEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
