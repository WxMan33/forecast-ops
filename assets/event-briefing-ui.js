/* Event briefing presentation. No forecast calculations, weights or threat thresholds live here. */
(function (root) {
  'use strict';
  const H = 3600e3, esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = (ms, tz) => new Date(ms).toLocaleDateString('en-US', {timeZone:tz, weekday:'short', month:'short', day:'numeric', year:'numeric'});
  const dayKey = (ms, tz) => new Date(ms).toLocaleDateString('en-CA', {timeZone:tz});
  const clock = (ms, tz) => new Date(ms).toLocaleTimeString('en-US', {timeZone:tz, hour:'numeric', minute:'2-digit'}).replace(':00','');
  const zone = (ms, tz) => new Intl.DateTimeFormat('en-US', {timeZone:tz,timeZoneName:'short'}).formatToParts(new Date(ms)).find(x=>x.type==='timeZoneName').value;
  function dateSpan(s, e, tz) {
    const same = dayKey(s,tz) === dayKey(e,tz), zs = zone(s,tz), ze = zone(e,tz);
    return `${date(s,tz)} · ${clock(s,tz)}${zs !== ze ? ' '+zs : ''} – ${same ? '' : date(e,tz)+' · '}${clock(e,tz)} ${ze}`;
  }
  function hourWindow(ms, tz) {
    // These are whole-hour probabilities, even when the phase begins partway through the hour.
    const e = ms + H, zs = zone(ms,tz), ze = zone(e,tz);
    return `${clock(ms,tz)}${zs !== ze ? ' '+zs : ''}–${clock(e,tz)}${zs !== ze ? ' '+ze : ''} hour`;
  }
  function headline(b, fallback) {
    const t = b.top;
    if (t && t.key === 'rain' && t.level === 2 && t.from == null)
      return `Have a rain plan for ${t.phases.length ? t.phases.map(x=>x.toLowerCase()).join(' and ') : 'the event'}.`;
    return fallback;
  }
  function coverage(res) {
    const feeds = res.feeds || {used:[],missing:[]}, used = feeds.used.length, missing = feeds.missing || [];
    const down = missing.filter(x=>!x.range), short = missing.filter(x=>x.range);
    return {limited:missing.length>0, text:`${used} of ${used+missing.length} model sources available`,
      detail:missing.length ? `${down.length?`Unavailable: ${down.map(x=>x.name).join(', ')}. `:''}${short.length?`Forecast does not reach the event hours yet: ${short.map(x=>x.name).join(', ')}. `:''}The blend uses the sources available.` : 'All configured model sources returned guidance.'};
  }
  /* "available" for an event means guidance for at least one of its hours, not just a response: a model whose
     forecast ends before the event (HRRR at 48 h, say) is listed as not reaching it rather than counted */
  function eventFeeds(feeds, B, startMs, endMs) {
    if (!feeds || !Array.isArray(feeds.usedIds) || !B || !Array.isArray(B.ms)) return feeds;
    const idx = B.ms.map((m,i)=>m+3600e3>startMs&&m<endMs?i:-1).filter(i=>i>=0);
    const reaches = id => { const h = B.models && B.models[id] && B.models[id].h; return !!h && Object.values(h).some(a=>Array.isArray(a)&&idx.some(i=>Number.isFinite(a[i]))); };
    const used=[], usedIds=[], short=[];
    feeds.usedIds.forEach((id,k)=>{ if(reaches(id)){used.push(feeds.used[k]);usedIds.push(id);} else short.push({id,name:feeds.used[k],why:'does not reach the event hours yet',range:true}); });
    return {...feeds, used, usedIds, missing:[...(feeds.missing||[]), ...short]};
  }
  function sourceHtml(res) {
    const c = coverage(res);
    return `<aside class="brief-source${c.limited ? ' is-limited' : ''}" aria-label="Model source coverage"><span class="brief-source-dot" aria-hidden="true"></span><div><b>${esc(c.text)}</b><span>${esc(c.detail)}</span></div></aside>`;
  }
  const rainAmount = x => !Number.isFinite(x) ? '—' : x > 0 && x < 0.01 ? '<0.01' : x === 0 ? '0' : x.toFixed(2);
  const fin = Number.isFinite;
  const shortDay = (ms, tz) => new Date(ms).toLocaleDateString('en-US', {timeZone:tz, weekday:'short', month:'short', day:'numeric'});
  /* "Thu, Nov 12 · 2–5 PM EST" (or both dates when the window crosses midnight) */
  function windowText(s, e, tz) {
    const same = dayKey(s,tz) === dayKey(e - 1,tz), zs = zone(s,tz), ze = zone(e,tz);
    return `${shortDay(s,tz)} · ${clock(s,tz)}${zs !== ze ? ' '+zs : ''}–${same ? '' : shortDay(e,tz)+' · '}${clock(e,tz)} ${ze}`;
  }

  /* ---- Which part of the event needs attention, and when ----
     Presentation only. Every value comes from the briefing's hourly view (V.hrs, V.rows) and every test from the
     briefing engine's own hazard rules (S.HAZARDS[*].hour, with the venue's saved gust limit in thr). The same
     model feeds the screen and the printout. */
  const TRACK_KEYS = ['rain', 'wind', 'lightning'];
  function attention({ b, V, S, thr }) {
    const limit = (thr && thr.gust) || 25, row = k => V.rows.find(r => r.key === k);
    const lightRow = row('lightning'), rainRow = row('hz-rain'), windRow = row('hz-wind');
    const hours = V.span.map((ms, i) => {
      const h = V.hrs[i] || {}, ok = h.state === 'ok', lc = lightRow && lightRow.cells[i], rc = rainRow && rainRow.cells[i], wc = windRow && windRow.cells[i];
      const pop = ok && fin(h.pop) ? h.pop : null, gust = ok && fin(h.gust) ? h.gust : null;
      const lword = !ok || !lc || lc.state === 'missing' ? null : lc.state === 'concern' ? lc.text : 'Low';
      return { ms, i,
        rain: { v: pop, signal: ok && S.HAZARDS.rain.hour(h, thr), tier: rc && rc.state === 'concern' ? rc.tier : null },
        wind: { v: gust, signal: gust != null && S.HAZARDS.wind.hour(h, thr), tier: wc && wc.state === 'concern' ? wc.tier : null },
        lightning: { v: lword, signal: !!(lc && lc.state === 'concern'), tier: lc && lc.state === 'concern' ? lc.tier : null } };
    });
    const runs = key => { const out = []; let cur = null;
      hours.forEach(x => { if (!x[key].signal) { cur = null; return; } if (cur && cur.to === x.ms) { cur.to += H; cur.hours.push(x); } else out.push(cur = { from: x.ms, to: x.ms + H, hours: [x] }); });
      return out; };
    const phasesIn = (from, to) => b.phases.filter(p => p.startMs < to && p.endMs > from);
    const peakOf = (key, hs) => key === 'lightning' ? hs.reduce((a, x) => ({Low:0, Moderate:1, High:2}[x.lightning.v] > ({Low:0, Moderate:1, High:2}[a] ?? -1) ? x.lightning.v : a), null)
      : hs.filter(x => fin(x[key].v)).reduce((a, x) => (!a || x[key].v > a.v ? { v: x[key].v, at: x.ms } : a), null);
    const items = [], seen = new Set();
    const build = (key, c) => {
      const windows = TRACK_KEYS.includes(key) ? runs(key).map(w => ({ ...w, phases: phasesIn(w.from, w.to).map(p => p.label), peak: peakOf(key, w.hours) }))
        : c && c.from != null ? [{ from: c.from, to: c.to, hours: [], phases: phasesIn(c.from, c.to).map(p => p.label), peak: null }] : [];
      /* a phase rated for this hazard with no hour of its own that meets the hourly test: the phase is named, its timing is not */
      const phaseOnly = b.phases.filter(p => p.r && (p.levels[key] || 0) >= 1 && !windows.some(w => w.from < p.endMs && w.to > p.startMs)).map(p => p.label);
      const all = [...new Set([...windows.flatMap(w => w.phases), ...phaseOnly])];
      const order = b.phases.map(p => p.label);
      return { key, label: c ? c.label : S.HAZARDS[key].label, level: c ? c.level : 0, word: c ? c.word : null, tier: c ? c.tier : 'monitor',
        windows, phaseOnly, phases: all.sort((x, y) => order.indexOf(x) - order.indexOf(y)), limit: key === 'wind' ? limit : null,
        peak: TRACK_KEYS.includes(key) ? peakOf(key, hours.filter(x => b.phases.some(p => x.ms < p.endMs && x.ms + H > p.startMs))) : null };
    };
    (b.concerns || []).forEach(c => { seen.add(c.key); items.push(build(c.key, c)); });
    /* a venue limit below the briefing's lowest gust rating still has to be shown when gusts reach it */
    if (!seen.has('wind') && runs('wind').length) items.push(build('wind', null));
    return { limit, hours, items, primary: items[0] || null, phases: b.phases, startMs: b.all.startMs, endMs: b.all.endMs };
  }
  const listWords = a => a.length <= 1 ? (a[0] || '') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  /* "Thu 2–4 PM" (both days when it crosses midnight); the time zone is added once per line */
  function hoursText(s, e, tz) {
    const wd = ms => new Date(ms).toLocaleDateString('en-US', {timeZone:tz, weekday:'short'});
    return dayKey(s,tz) === dayKey(e - 1,tz) ? `${wd(s)} ${clock(s,tz)}–${clock(e,tz)}` : `${wd(s)} ${clock(s,tz)}–${wd(e)} ${clock(e,tz)}`;
  }
  const phaseSpan = a => a.length > 2 ? `${a[0]} through ${a[a.length - 1].toLowerCase()}` : a.length === 2 ? `${a[0]} and ${a[1].toLowerCase()}` : (a[0] || 'Outside the schedule');
  /* one short line per concern: what, then which part of the event and when */
  function attentionText(it, tz, maxWin = 2) {
    const parts = it.windows.slice(0, maxWin).map(w => `${phaseSpan(w.phases)} · ${hoursText(w.from, w.to, tz)}`);
    if (it.windows.length > maxWin) parts.push(`${it.windows.length - maxWin} more`);
    const z = it.windows.length ? ` ${zone(it.windows[0].to, tz)}` : '';
    const when = [parts.join(', ') + z, ...it.phaseOnly.map(l => `${l} · exact time uncertain`)].filter(x => x.trim()).join('; ');
    const peak = it.windows.length ? Math.max(...it.windows.map(w => w.peak && fin(w.peak.v) ? w.peak.v : 0)) : it.peak && fin(it.peak.v) ? it.peak.v : null;
    let what;
    if (it.key === 'wind') what = it.windows.length ? `Gusts reach your ${it.limit} mph limit (up to ${Math.round(peak)} mph)` : `Gusts up to ${fin(peak) ? Math.round(peak) : '—'} mph, below your ${it.limit} mph limit`;
    else if (it.key === 'rain') what = `Rain: ${it.word ? it.word.toLowerCase() : 'possible'}${fin(peak) && peak > 0 ? ` (up to ${Math.round(peak)}% chance)` : ''}`;
    else if (it.key === 'lightning') { const w = it.windows.map(x => x.peak).filter(Boolean); what = `Lightning potential ${w.includes('High') ? 'high' : w.includes('Moderate') ? 'moderate' : 'possible'} (a forecast, not detected lightning)`; }
    else what = `${it.label}${it.word ? `: ${it.word.toLowerCase()}` : ''}`;
    return { what, when: when || 'Exact time uncertain' };
  }
  /* Four aligned rows on one time axis. Kept deliberately plain: a bar per hour, darker where that hour needs
     attention (the briefing's own hourly rule; gusts at or above the venue limit), hatched where there is no data. */
  function attentionHtml(A, { tz, pageHours = null, idPrefix = 'at', interactive = false } = {}) {
    const s = A.startMs, e = A.endMs, span = e - s, pr = idPrefix === 'pv'; // the printout keeps its established pv-time-* hooks
    if (!(span > 0)) return '';
    const pos = ms => 100 * (Math.max(s, Math.min(e, ms)) - s) / span;
    const box = (a, z) => `left:${pos(a).toFixed(3)}%;width:${Math.max(0, pos(z) - pos(a)).toFixed(3)}%`;
    const inView = A.hours.filter(x => x.ms + H > s && x.ms < e);
    const phases = A.phases.map(p => { const w = pos(p.endMs) - pos(p.startMs), main = p.key === 'event';
      return `<span class="at-phase${pr ? ' pv-time-phase' : ''}${main ? ' at-main' + (pr ? ' pv-time-main' : '') : ''}" style="${box(p.startMs, p.endMs)}" data-phase="${esc(p.key)}" title="${esc(p.label)} ${esc(windowText(p.startMs, p.endMs, tz))}">${w >= 9 ? esc(p.label) : ''}</span>`; }).join('');
    const gmax = Math.max(10, Math.ceil(Math.max(A.limit * 1.5, ...inView.map(x => fin(x.wind.v) ? x.wind.v : 0)) / 10) * 10);
    const LH = { Low: 22, Moderate: 60, High: 100 };
    const bars = key => inView.map(x => {
      const c = x[key], miss = c.v == null, t = esc(hourWindow(x.ms, tz));
      if (miss) return `<span class="at-hour at-gap${pr && key === 'rain' ? ' pv-time-hour pv-time-gap' : ''}" style="${box(x.ms, x.ms + H)}" data-ms="${x.ms}" title="${t} · no forecast data"></span>`;
      const hgt = key === 'rain' ? Math.min(100, Math.max(0, c.v)) : key === 'wind' ? Math.min(100, 100 * c.v / gmax) : LH[c.v] || 0;
      const label = key === 'rain' ? `${Math.round(c.v)}%` : key === 'wind' ? `${Math.round(c.v)} mph${c.signal ? ' · at or above your limit' : ''}` : c.v;
      return `<span class="at-hour${pr && key === 'rain' ? ' pv-time-hour' : ''}${c.signal ? ' at-hit' : ''}${key === 'lightning' ? ' at-l' + esc(c.v) : ''}" style="${box(x.ms, x.ms + H)};--h:${hgt.toFixed(1)}%" data-ms="${x.ms}" data-v="${esc(key === 'lightning' ? c.v : Math.round(c.v))}" title="${t} · ${esc(label)}"></span>`;
    }).join('');
    const limitPct = 100 * A.limit / gmax;
    const midnights = []; for (let m = Math.ceil(s / H) * H + H; m < e; m += H) if (dayKey(m, tz) !== dayKey(m - H, tz)) midnights.push(m);
    /* ticks: schedule changes, midnights and the end, thinned so labels never collide or run off the page */
    const cand = [...A.phases.map(p => ({ ms: p.startMs, pri: 2 })), ...midnights.map(m => ({ ms: m, pri: 1, day: true })), { ms: e, pri: 3 }].sort((a, b) => a.ms - b.ms || b.pri - a.pri);
    const kept = []; cand.forEach(c => { const p = pos(c.ms), prev = kept[kept.length - 1];
      if (prev && p - pos(prev.ms) < 12) { if (c.pri > prev.pri && (kept.length > 1 || c.ms === e)) kept[kept.length - 1] = c; return; } kept.push(c); });
    const ticks = kept.map((c, k) => { const p = pos(c.ms), cls = k === kept.length - 1 || p >= 88 ? 'end' : k === 0 || p <= 12 ? 'start' : 'mid';
      const lab = c.day ? shortDay(c.ms, tz) : `${k === 0 || dayKey(c.ms, tz) !== dayKey(kept[k - 1].ms, tz) ? shortDay(c.ms, tz).replace(/^\w+, /, '') + ' ' : ''}${clock(c.ms, tz)}`;
      return `<span class="${cls}" style="left:${p.toFixed(3)}%">${esc(lab)}</span>`; }).join('');
    const day = midnights.map(m => `<span class="at-midnight" style="left:${pos(m).toFixed(3)}%"></span>`).join('');
    const page2 = pageHours && pageHours.clipped ? `<div class="at-row at-p2row"><b>Page 2</b><div class="at-track at-p2"><span style="${box(pageHours.from, pageHours.to)}">hours on page 2</span></div></div>` : '';
    const row = (key, name, sub, extra = '') => `<div class="at-row" data-track="${key}"><b>${name}<small>${sub}</small></b><div class="at-track at-${key}">${day}${bars(key)}${extra}</div></div>`;
    return `<figure class="at" id="${esc(idPrefix)}Tracks" aria-label="The event schedule with hourly rain chance, gusts against your ${A.limit} mph limit, and lightning potential on one time axis. What needs attention is listed after the graphic.">
      <div class="at-rows">
      <div class="at-row" data-track="schedule"><b>Schedule</b><div class="at-track at-sched${pr ? '' : ' sch-bar'}">${phases}</div></div>
      ${row('rain', 'Rain', 'chance')}
      ${row('wind', 'Gusts', `- - ${A.limit} mph limit`, limitPct <= 100 ? `<span class="at-limit" style="bottom:${limitPct.toFixed(1)}%"></span>` : '')}
      ${row('lightning', 'Lightning', 'forecast potential')}
      ${interactive ? `<div class="at-hitlayer"><span class="at-cursor" hidden></span>${inView.map((x) => `<button type="button" class="at-hb" data-hour="${x.ms}" style="${box(x.ms, x.ms + H)}" aria-label="${esc(hourWindow(x.ms, tz))}: rain ${x.rain.v == null ? 'no data' : Math.round(x.rain.v) + '%'}, gusts ${x.wind.v == null ? 'no data' : Math.round(x.wind.v) + ' mph'}, lightning potential ${x.lightning.v ? x.lightning.v.toLowerCase() : 'no data'}"></button>`).join('')}</div>` : ''}
      </div>
      ${page2}
      <div class="at-row"><span></span><div class="at-axis${pr ? '' : ' sch-ticks'}">${ticks}</div></div>
      <figcaption class="at-key"><span><i class="k-hit"></i>Needs attention</span><span><i class="k-val"></i>Forecast</span><span><i class="k-gap"></i>No data (not zero)</span></figcaption>
    </figure>`;
  }
  function attentionList(A, tz, max = 3, maxWin = 2) {
    if (!A.items.length) { const miss = A.hours.filter(x => x.rain.v == null || x.wind.v == null || x.lightning.v == null).length;
      return `<p class="at-none">Nothing in the schedule needs weather attention right now.${miss ? ` ${miss} hour${miss > 1 ? 's have' : ' has'} no forecast data (hatched), so that part is not an all-clear.` : ''}</p>`; }
    return `<ul class="at-list">${A.items.slice(0, max).map((it, k) => { const t = attentionText(it, tz, maxWin);
      return `<li data-item="${k + 1}" data-key="${esc(it.key)}"><div><b>${esc(t.what)}</b><span>${esc(t.when)}</span></div></li>`; }).join('')}${A.items.length > max ? `<li class="at-more">${A.items.length - max} more in the full briefing</li>` : ''}</ul>`;
  }
  /* Where a concern sits in the schedule, in a few words: "Mainly setup", "Across the planning window", or the phases.
     Counted from the hours that meet the briefing's own hourly rule; a rated phase without such an hour is named as such. */
  function focusOf(it, phases) {
    const hrs = it.windows.flatMap((w) => w.hours.length ? w.hours : [{ ms: w.from }]);
    if (!hrs.length) return it.phaseOnly.length ? { text: `${listWords(it.phaseOnly)} (exact time uncertain)`, from: null, to: null } : { text: '', from: null, to: null };
    const at = (ms) => phases.reduce((best, p) => { const o = Math.min(ms + H, p.endMs) - Math.max(ms, p.startMs); return o > 0 && (!best || o > best.o) ? { p, o } : best; }, null);
    const by = new Map(); hrs.forEach((x) => { const a = at(x.ms); if (a) by.set(a.p.label, (by.get(a.p.label) || 0) + 1); });
    const total = hrs.length, ranked = [...by].sort((a, b) => b[1] - a[1]), planH = Math.round((phases[phases.length - 1].endMs - phases[0].startMs) / H);
    const from = Math.min(...it.windows.map((w) => w.from)), to = Math.max(...it.windows.map((w) => w.to));
    let text;
    if (by.size >= 3 || total >= planH * 0.7) text = 'Across the planning window';
    else if (by.size === 1) text = `During ${ranked[0][0].toLowerCase()}`;
    else if (ranked[0][1] / total >= 0.6) text = `Mainly ${ranked[0][0].toLowerCase()}`;
    else text = listWords(ranked.map((r) => r[0].toLowerCase())).replace(/^./, (c) => c.toUpperCase());
    return { text, from, to };
  }
  /* "1–5 PM", "5–7:30 PM", "11 PM–1 AM"; a time on another day than `day0Ms` names that weekday */
  function clockSpan(s, e, tz, day0Ms = s) {
    const parts = (ms) => { const t = clock(ms, tz), m = t.match(/^(.*?)\s*(AM|PM)$/); return m ? { t: m[1], ap: m[2] } : { t, ap: '' }; };
    const wd = (ms) => new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    const a = parts(s), z = parts(e), d0 = dayKey(day0Ms, tz), lead = dayKey(s, tz) !== d0 ? `${wd(s)} ` : '', tail = dayKey(e - 1, tz) !== dayKey(s, tz) && dayKey(e, tz) !== d0 ? `${wd(e)} ` : '';
    return a.ap === z.ap && !tail ? `${lead}${a.t}–${z.t} ${z.ap}` : `${lead}${a.t} ${a.ap}–${tail}${z.t} ${z.ap}`;
  }
  /* the event schedule, once, for the screen and the printout alike */
  function scheduleHtml(phases, tz, cls = 'ev-schedule sch-bar sch-labels') {
    if (!phases.length) return '';
    return `<ol class="${cls}">${phases.map((p) => `<li data-phase="${esc(p.key)}"><b>${esc(p.label)}</b><span>${esc(clockSpan(p.startMs, p.endMs, tz, phases[0].startMs))}</span></li>`).join('')}</ol>`;
  }
  /* "during setup", "during setup and early gates", "from setup through teardown": the phases a window touches, with
     "early"/"late" when it covers less than half of the first or last of them */
  function phaseWords(from, to, phases) {
    const hit = phases.filter((p) => p.startMs < to && p.endMs > from);
    if (!hit.length) return '';
    const name = (p, i) => { const mid = (p.startMs + p.endMs) / 2, low = p.label.toLowerCase();
      if (hit.length > 1 && i === hit.length - 1 && to <= mid) return `early ${low}`;
      if (hit.length > 1 && i === 0 && from >= mid) return `late ${low}`;
      if (hit.length === 1 && to <= mid && from <= p.startMs) return `early ${low}`;
      if (hit.length === 1 && from >= mid && to >= p.endMs) return `late ${low}`;
      return low; };
    const w = hit.map(name);
    if (hit.length >= 3) return `from ${w[0]} through ${w[w.length - 1]}`;
    return `during ${w.join(' and ')}`;
  }
  /* page 1's "What to plan for": one plain line per concern, timed inside the planning window */
  function planLines(A, b, lightAll, tz, pct) {
    const lo = b.all.startMs, hi = b.all.endMs, out = [];
    const clip = (it) => { const ws = it.windows.map((w) => ({ ...w, from: Math.max(lo, w.from), to: Math.min(hi, w.to) })).filter((w) => w.to > w.from);
      return ws.length ? { from: ws[0].from, to: ws[ws.length - 1].to, ws } : null; };
    const when = (c) => `${phaseWords(c.from, c.to, b.phases)} (${clockSpan(c.from, c.to, tz, lo)})`;
    const uncertain = (it) => it.phaseOnly.length ? ` Exact time uncertain during ${listWords(it.phaseOnly.map((x) => x.toLowerCase()))}.` : '';
    A.items.forEach((it) => {
      const c = clip(it);
      if (it.key === 'rain') {
        const verb = it.level >= 3 ? 'Expect disruptive rain' : it.level === 2 ? 'Plan for rain' : 'Watch for rain';
        const pk = c ? Math.max(...c.ws.map((w) => (w.peak && Number.isFinite(w.peak.v) ? w.peak.v : 0))) : null;
        out.push({ key: 'rain', text: c ? `${verb} ${when(c)}${pk ? `; hourly chance up to ${pct(pk)}` : ''}.${uncertain(it)}` : `${verb} during ${listWords(it.phaseOnly.map((x) => x.toLowerCase()))}; exact time uncertain.` });
      } else if (it.key === 'wind') {
        const pk = c ? Math.max(...c.ws.map((w) => (w.peak && Number.isFinite(w.peak.v) ? w.peak.v : 0))) : it.peak && it.peak.v;
        out.push({ key: 'wind', text: c ? `Gusts may reach the venue’s ${it.limit} mph limit ${when(c)}; up to ${Math.round(pk)} mph.` : `Gusts up to ${Math.round(pk)} mph, below the venue’s ${it.limit} mph limit.` });
      } else if (it.key === 'lightning') {
        const w = c && c.ws.some((x) => x.peak === 'High') ? 'High' : 'Moderate';
        out.push({ key: 'lightning', text: c ? `${w} lightning potential ${when(c)}. This is a forecast, not detected lightning.` : `${w} lightning potential during ${listWords(it.phaseOnly.map((x) => x.toLowerCase()))}. This is a forecast, not detected lightning.` });
      } else out.push({ key: it.key, text: `${it.label}: ${(it.word || '').toLowerCase()}${c ? ` ${when(c)}` : ''}.` });
    });
    if (!A.items.some((x) => x.key === 'lightning')) out.push({ key: 'lightning', text: lightAll.state === 'missing' ? 'Lightning guidance is unavailable for these hours; follow NWS forecasts and your lightning policy.'
      : `Lightning potential is ${lightAll.base ? lightAll.base.toLowerCase() : 'low'}${lightAll.limited ? ', with some hours missing guidance' : ''}. This is a forecast, not detected lightning; low is not zero.` });
    if (!A.items.length) out.unshift({ key: 'none', text: 'No weather concern for the event in the current forecast.' });
    return out;
  }
  /* page 2's phase column in plain words: "Setup", "Gates from 4:30", "Teardown until 11:30", "Setup until 4:30, then Gates" */
  function phaseCellText(cover, ms, tz) {
    if (!cover || !cover.length) return '';
    const mm = (min) => clock(ms + Math.round(min) * 60e3, tz);
    if (cover.length === 1) { const c = cover[0]; return c.starts && c.from > 0 ? `${c.label} from ${mm(c.from)}` : c.ends && c.to < 60 ? `${c.label} until ${mm(c.to)}` : c.label; }
    return cover.map((c, i) => (i === 0 ? `${c.label} until ${mm(c.to)}` : `then ${c.label}`)).join(', ');
  }
  /* Page 2 shows up to 24 hours: from the start, unless the most important window would fall outside them */
  function pageHours(A, V, n = 24) {
    const total = V.span.length;
    if (total <= n) return { start: 0, count: total, clipped: false, from: V.span[0], to: V.span[total - 1] + H, total };
    let start = 0; const p = A.primary, w = p && p.windows[0];
    if (w) { const i = V.span.indexOf(w.from); if (i >= n - 2) start = Math.max(0, Math.min(total - n, i - 2)); }
    return { start, count: n, clipped: true, from: V.span[start], to: V.span[start + n - 1] + H, total, fromStart: start === 0 };
  }
  /* Printed NWS block with a fixed footprint: at most two periods, the one covering the main event first, each
     summary cut at a word near 64 characters. A thunder mention is never lost to the cut. Nothing is reworded. */
  const NWS_TH = /thunder|t-?storm/i;
  function nwsPrint(periods, main, all, { max = 2, chars = 64 } = {}) {
    const inWin = (periods || []).filter(p => p.e > all.startMs && p.s < all.endMs);
    const ov = p => Math.max(0, Math.min(p.e, main.endMs) - Math.max(p.s, main.startMs));
    const lead = inWin.find(p => p.s <= main.startMs && p.e > main.startMs) || inWin.filter(p => ov(p) > 0).sort((a, b) => ov(b) - ov(a))[0] || inWin[0];
    const rest = inWin.filter(p => p !== lead).sort((a, b) => (Math.abs(a.s - (lead ? lead.e : 0)) - Math.abs(b.s - (lead ? lead.e : 0))) || ov(b) - ov(a));
    /* a later period that mentions thunder outranks a quieter neighbour */
    const pick = lead ? [lead, ...rest.filter(p => NWS_TH.test(p.short || '')), ...rest.filter(p => !NWS_TH.test(p.short || ''))].slice(0, max) : [];
    let cut = false;
    const shown = pick.sort((a, b) => a.s - b.s).sort((a, b) => (b === lead) - (a === lead)).map(p => {
      const full = String(p.short || '').trim(); let text = full;
      if (full.length > chars) { const sp = full.lastIndexOf(' ', chars); text = full.slice(0, sp > chars * 0.6 ? sp : chars).replace(/[\s,;.]+$/, '') + '…'; cut = true; }
      return { ...p, text, thunder: NWS_TH.test(full) && !NWS_TH.test(text) };
    });
    return { shown, total: inWin.length, omitted: inWin.length - shown.length, cut, lead };
  }
  /* The two-page printout. Page 1 is a handout anyone can read: the event, official alerts, one planning headline,
     what to plan for and when, the schedule, and the next weather check. Page 2 is the hour-by-hour reference.
     Values come from the same briefing as the screen; nothing here recalculates the forecast. Black-and-white safe. */
  function printMarkup({ ev, res, view, S, U }) {
    const { b, V, lightAll, nwsTh, R, checks, top } = view, tz = ev.tz, now = res.ctx.now, name = ev.name.replace(/ \(sample\)$/, '');
    const A = view.A || attention({ b, V, S, thr: { gust: ev.gust || 25 } }), PH = pageHours(A, V), off = PH.start, hours = V.span.slice(off, off + PH.count), clipped = PH.clipped;
    const issued = res.ctx.B.viewedAt || now, issue = `${date(issued, tz)} · ${clock(issued, tz)} ${zone(issued, tz)}`;
    const main = b.phases.find((p) => p.key === 'event') || b.all, area = !!(ev.loc && ev.loc.approximate), nextCk = checks[0];
    const decision = headline(b, !top && R && R.state === 'partial' ? `No weather concern so far for ${R.inRange}.` : S.decision(b).text);
    const foot = (n) => `<footer class="pv-footer"><span class="pv-footer-l">${esc(name)}</span><span class="pv-policy">This is forecast planning guidance. For live decisions, follow official NWS warnings and your venue’s lightning and weather policy.</span><span>${n} / 2</span></footer>`;
    /* official alerts: their own labelled box; if alerts could not be checked, say so rather than imply none */
    const alerts = res.alerts || [], alertBox = res.alertsAvailable === false
      ? '<div class="pv-alerts pv-alerts-off"><b>Official NWS alerts</b><span>Could not be checked when this was printed. Check weather.gov before the event.</span></div>'
      : alerts.length ? `<div class="pv-alerts"><b>Official NWS alert${alerts.length > 1 ? 's' : ''} in effect</b>${alerts.slice(0, 3).map((x) => `<span>${esc(x.event)}${x.ends ? ` until ${esc(date(Date.parse(x.ends), tz))}, ${esc(clock(Date.parse(x.ends), tz))}` : ''}</span>`).join('')}</div>` : '';
    const lines = planLines(A, b, lightAll, tz, (v) => U.pct(v));
    /* amounts in plain words for readers without a weather background: event totals with the forecast range across
       models, and when the heaviest hour is (V.totals: one blend over setup through teardown; see hourly-views.js) */
    const T = V.totals || null, f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—'), f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
    const hr = (ms) => clock(ms, tz), lb = T && T.gap ? 'at least ' : 'about ';
    const rng = (r, f) => (r && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] - r[0] >= 0.01 ? ` (forecast range ${f(r[0])}–${f(r[1])} in.)` : '');
    const snowy = !!T && ((Number.isFinite(T.sn) && T.sn >= 0.05) || (T.peakSn && T.peakSn.v >= 0.02));
    const amounts = !T ? [] : [
      Number.isFinite(T.qpf) && T.qpf >= 0.005 ? `Rain: ${lb}${f2(T.qpf)} in. over the event${rng(T.qpfR, f2)}${T.peakQ ? `; heaviest around ${hr(T.peakQ.ms)}, about ${f2(T.peakQ.v)} in. in that hour` : ''}.` : Number.isFinite(T.qpf) ? 'Rain: no measurable rain in the forecast for the event.' : '',
      snowy ? `Snow: ${lb}${f1(T.sn)} in. could fall${rng(T.snR, f1)}${T.peakSn ? `, most around ${hr(T.peakSn.ms)}` : ''}. Forecast snowfall before melting; less may stay on the ground.` : '',
      T.types && T.types.some((k) => k !== 'rain') ? `Precipitation type: ${T.types.map((k) => ({ rain: 'rain', mix: 'a rain/snow mix', snow: 'snow' })[k]).join(', then ')}.` : '',
    ].filter(Boolean);
    const amountsHtml = amounts.length ? `<ul class="pv-amounts">${amounts.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
    const watch = lines.filter((l) => l.key !== 'none' && !(l.key === 'lightning' && !A.items.some((x) => x.key === 'lightning')));
    /* winter read (what could stick), when the event page loaded one: the same levels and hours as the screen */
    const WR = view.winter && view.winter.status === 'snow' ? view.winter : null, LVW = { favored: 'favored', possible: 'possible', unlikely: 'unlikely', none: 'not expected' };
    if (WR) watch.push({ key: 'winter', text: `Snow could stick: on grass and elevated surfaces ${LVW[WR.grass.level] || WR.grass.level}; on paved roads and sidewalks ${LVW[WR.paved.level] || WR.paved.level}${WR.ranges.length ? `, mainly ${WR.ranges.map((r) => `${clock(r.s, tz)}–${clock(r.e + H, tz)}`).join(', ')}` : ''}. Bridges and untreated roads are not assessed.` });
    /* a practical gap, in one line, only when it changes what a reader can rely on */
    const f = res.feeds, total = f ? f.used.length + f.missing.length : 0;
    const gap = R && R.state === 'partial' ? `The forecast does not reach the whole event yet: ${R.line}. Check again for the rest.`
      : total && f.used.length / total < 0.7 ? 'Only part of the usual forecast data reaches these hours, so timing could shift. Check again at the next weather check.' : '';
    const nws = res.NW && res.NW.ok ? res.NW : null, NP = nwsPrint(nws ? nws.periods : [], main, b.all), per = NP.shown;
    const p1 = `<section class="pv-page pv-p1">
      <header class="pv-head"><div><span class="pv-kicker">Event weather briefing</span><h1 class="pv-title">${esc(name)}</h1><div class="pv-venue">${esc(ev.loc.name)}</div>
        <div class="pv-when">${esc(dateSpan(main.startMs, main.endMs, tz))}</div>${area ? '<div class="pv-area">City-area forecast for planning, not a site-specific venue forecast.</div>' : ''}</div>
        <div class="pv-iss"><b>Issued</b><br>${esc(issue)}</div></header>
      ${alertBox}
      <div class="pv-takeaway"><h2 class="pv-dec">${esc(decision)}</h2></div>
      <h2 class="pv-section">What to plan for</h2>
      <ul class="pv-plan">${lines.map((l) => `<li data-key="${esc(l.key)}">${esc(l.text)}</li>`).join('')}</ul>
      ${gap ? `<p class="pv-gap">${esc(gap)}</p>` : ''}
      <h2 class="pv-section">Event schedule</h2>
      ${scheduleHtml(b.phases, tz, 'pv-sched')}
      ${view.daylight && root.EventDaylight ? root.EventDaylight.printLine(view.daylight) : ''}
      <p class="pv-nextcheck"><b>Next weather check:</b> ${nextCk ? `${esc(date(nextCk.at, tz))}, ${esc(clock(nextCk.at, tz))} ${esc(zone(nextCk.at, tz))} · ${esc(nextCk.what)}` : 'Now: use radar, lightning detection and official NWS warnings.'}</p>
      <h2 class="pv-section">Official NWS forecast</h2>
      ${per.length ? `<ul class="pv-nws">${per.map((p) => `<li data-nws-period><b>${esc(p.name)}:</b> ${esc(p.text)}${p.thunder ? ' Thunderstorms mentioned.' : ''}</li>`).join('')}</ul>` : '<p class="pv-note">The NWS forecast was unavailable when this was printed.</p>'}
      <p class="pv-note">From the National Weather Service${nws ? ` (${esc(nws.office)} office)` : ''}${NP.cut || NP.omitted ? '; shortened to fit, full wording on the website' : ''}.${nwsTh.length && lightAll.base === 'Low' ? ' The NWS mentions thunderstorms; treat them as possible.' : ''}</p>
      ${foot(1)}</section>`;
    /* page 2: one table; missing data is written out; the venue limit is named where gusts reach it */
    const row = (k) => V.rows.find((r) => r.key === k), cellText = (k, j) => { const c = row(k) && row(k).cells[j]; return c ? c.text || '' : ''; };
    const nd = '<span class="pv-nd">no data</span>';
    const body = hours.map((ms, i) => {
      const j = i + off, h = V.hrs[j] || {}, ok = h.state === 'ok', a = V.axis[j], x = A.hours[j] || {};
      const newDay = i === 0 || dayKey(ms, tz) !== dayKey(hours[i - 1], tz);
      const time = `${newDay ? `<span class="pv-day">${esc(shortDay(ms, tz))}</span>` : ''}${esc(a.hourText)}${a.showZone || i === 0 ? ` ${esc(a.zone)}` : ''}`;
      const pop = ok && Number.isFinite(h.pop) ? esc(cellText('pop', j)) : nd;
      const gust = ok && Number.isFinite(h.gust) ? `${Math.round(h.gust)} mph${x.wind && x.wind.signal ? `<small>Reaches ${A.limit} mph venue limit</small>` : ''}` : nd;
      const lc = row('lightning') && row('lightning').cells[j], light = !ok || !lc || lc.state === 'missing' ? nd : esc(lc.state === 'concern' ? lc.text : 'Low');
      const rc = row('hz-rain') && row('hz-rain').cells[j], rainHit = !!(rc && rc.state === 'concern'), lightHit = !!(lc && lc.state === 'concern'), windHit = !!(x.wind && x.wind.signal);
      const amt = (v, d) => (ok && Number.isFinite(v) ? (v < 0.005 ? '0 in.' : `${v.toFixed(d)} in.`) : nd);
      return `<tr data-ms="${ms}"${rainHit || lightHit || windHit ? ' class="pv-watchrow" data-watch' : ''}><td class="pv-time">${time}</td><td>${esc(phaseCellText(V.cover[j], ms, tz))}</td><td>${ok && Number.isFinite(h.temp) ? `${Math.round(h.temp)}°F` : nd}</td><td data-pop${rainHit ? ' class="pv-hit"' : ''}>${pop}</td><td data-qpf${rainHit ? ' class="pv-hit"' : ''}>${amt(h.qpf, 2)}</td>${snowy ? `<td data-sn>${amt(h.sn, 1)}</td>` : ''}<td${windHit ? ' class="pv-over" data-over' : ''}>${gust}</td><td${lightHit ? ' class="pv-hit"' : ''}>${light}</td></tr>`;
    }).join('');
    const span1 = hours.length ? dateSpan(hours[0], hours[hours.length - 1] + H, tz) : 'No hours available';
    const p2 = `<section class="pv-page pv-p2${hours.length > 16 ? ' pv-dense' : ''}">
      <header class="pv-head"><div><span class="pv-kicker">Hour-by-hour forecast</span><h2 class="pv-title">${esc(name)}</h2><div class="pv-venue">${esc(ev.loc.name)}</div></div><div class="pv-iss"><b>Issued</b><br>${esc(issue)}</div></header>
      <div class="pv-watch" data-watchbox><b>Watch for</b>${watch.length ? `<ul>${watch.map((l) => `<li data-key="${esc(l.key)}">${esc(l.text)}</li>`).join('')}</ul>` : '<p>No weather concern for the event in the current forecast.</p>'}${amountsHtml}</div>
      <p class="pv-hours-window" data-page-hours="${PH.start}-${PH.start + PH.count}"><b>Hours shown:</b> ${esc(span1)}${clipped ? `<br><b>${PH.fromStart ? 'First 24 hours only' : `24 of ${PH.total} planning hours`}</b>${PH.fromStart ? ` (24 of ${PH.total})` : ', chosen to include the first concern on page 1'}; open the briefing for the rest.` : ''}</p>
      <table class="pv-t pv-hours"><colgroup><col style="width:14%"><col style="width:${snowy ? 17 : 20}%"><col style="width:9%"><col style="width:11%"><col style="width:${snowy ? 10 : 12}%">${snowy ? '<col style="width:9%">' : ''}<col style="width:${snowy ? 16 : 19}%"><col style="width:${snowy ? 14 : 15}%"></colgroup><thead><tr><th>Local time</th><th>Phase</th><th>Temp</th><th>Rain chance</th><th>Rain amount</th>${snowy ? '<th>Snow</th>' : ''}<th>Wind gusts</th><th>Lightning</th></tr></thead><tbody>${body}</tbody></table>
      <p class="pv-legend">Times are the venue's local time (${esc(tz)}). Rain chance is the chance of rain at the venue in that hour; rain amount is how much is forecast to fall in that hour.${snowy ? ' Snow is forecast snowfall in that hour, before melting.' : ''} Lightning is forecast potential, not detected lightning; low is not zero. Marked rows are hours with a weather concern. “No data” means no forecast was available for that hour, not zero.${gap ? ` ${esc(gap)}` : ''}</p>
      <p class="pv-src">Data: Open-Meteo (CC BY 4.0), National Weather Service, NOAA. Model guidance only, not an official forecast or warning.${area ? ' City-area forecast, not site-specific.' : ''}</p>
      ${foot(2)}</section>`;
    return p1 + p2;
  }
  const api={date,dateSpan,hourWindow,windowText,headline,coverage,eventFeeds,sourceHtml,rainAmount,nwsPrint,focusOf,clockSpan,scheduleHtml,phaseWords,planLines,phaseCellText,attention,attentionText,attentionHtml,attentionList,pageHours,printMarkup};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.EventBriefingUI=api;
})(typeof globalThis!=='undefined'?globalThis:this);
