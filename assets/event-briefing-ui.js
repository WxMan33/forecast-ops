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
  function attentionHtml(A, { tz, pageHours = null, idPrefix = 'at' } = {}) {
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
      <div class="at-row" data-track="schedule"><b>Schedule</b><div class="at-track at-sched">${phases}</div></div>
      ${row('rain', 'Rain', 'chance')}
      ${row('wind', 'Gusts', `- - - your ${A.limit} mph limit`, limitPct <= 100 ? `<span class="at-limit" style="bottom:${limitPct.toFixed(1)}%"></span>` : '')}
      ${row('lightning', 'Lightning', 'forecast potential')}
      ${page2}
      <div class="at-row"><span></span><div class="at-axis">${ticks}</div></div>
      <figcaption class="at-key"><span><i class="k-hit"></i>Needs attention</span><span><i class="k-val"></i>Forecast</span><span><i class="k-gap"></i>No data (not zero)</span></figcaption>
    </figure>`;
  }
  function attentionList(A, tz, max = 3, maxWin = 2) {
    if (!A.items.length) { const miss = A.hours.filter(x => x.rain.v == null || x.wind.v == null || x.lightning.v == null).length;
      return `<p class="at-none">Nothing in the schedule needs weather attention right now.${miss ? ` ${miss} hour${miss > 1 ? 's have' : ' has'} no forecast data (hatched), so that part is not an all-clear.` : ''}</p>`; }
    return `<ul class="at-list">${A.items.slice(0, max).map((it, k) => { const t = attentionText(it, tz, maxWin);
      return `<li data-item="${k + 1}" data-key="${esc(it.key)}"><div><b>${esc(t.what)}</b><span>${esc(t.when)}</span></div></li>`; }).join('')}${A.items.length > max ? `<li class="at-more">${A.items.length - max} more in the full briefing</li>` : ''}</ul>`;
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
  function printMarkup({ev,res,view,S,U}) {
    const {b,V,PS,peak,lightAll,nwsTh,R,checks,top} = view, tz=ev.tz, now=res.ctx.now;
    const issued=res.ctx.B.viewedAt||now, issue=`${date(issued,tz)} · ${clock(issued,tz)} ${zone(issued,tz)}`;
    const main=b.phases.find(p=>p.key==='event')||b.all, A=view.A||attention({b,V,S,thr:{gust:ev.gust||25}}), PH=pageHours(A,V), off=PH.start, hours=V.span.slice(off,off+PH.count), clipped=PH.clipped;
    const area=!!(ev.loc&&ev.loc.approximate), first=A.primary?attentionText(A.primary,tz,1):null, nextCk=checks[0], missingH=A.hours.filter(x=>x.rain.v==null||x.wind.v==null||x.lightning.v==null).length;
    const decision=headline(b,!top&&R&&R.state==='partial'?`No weather concern so far for ${R.inRange}.`:S.decision(b).text);
    const row=k=>V.rows.find(r=>r.key===k), cell=(k,i)=>{const c=row(k)?.cells[i+off];return c ? c.text||'' : '—';};
    const temp=P=>P.temp?Math.round(P.temp.lo)===Math.round(P.temp.hi)?`${Math.round(P.temp.lo)}°`:`${Math.round(P.temp.lo)}–${Math.round(P.temp.hi)}°`:'—';
    const light=P=>P.lightning.word+(P.lightning.state==='limited'?' (limited)':'');
    const nws=res.NW&&res.NW.ok?res.NW:null, NP=nwsPrint(nws?nws.periods:[],main,b.all), per=NP.shown;
    const foot=(n,mid='')=>`<footer class="pv-footer"><span>Forecast Ops · ${esc(ev.name.replace(/ \(sample\)$/,''))}</span>${mid}<span>${n} / 2</span></footer>`;
    const sub=R?.state==='ready'?'Forecast covers setup through teardown.':R?.state==='partial'?R.line:'Hourly guidance does not reach this event yet.';
    return `<section class="pv-page pv-p1"><header class="pv-head"><div><span class="pv-kicker">FORECAST OPS / EVENT BRIEFING</span><h1 class="pv-title">${esc(ev.name.replace(/ \(sample\)$/, ''))}</h1><div class="pv-venue">${esc(ev.loc.name)}</div>${area?'<div class="pv-area">City-area forecast for planning, not a site-specific venue forecast.</div>':''}</div><div class="pv-iss"><b>Issued</b><br>${esc(issue)}</div></header>
      <div class="pv-takeaway"><h2 class="pv-dec">${esc(decision)}</h2><p>${esc(sub)}</p></div>
      <div class="pv-dates"><div><b>Event</b><span>${esc(dateSpan(main.startMs,main.endMs,tz))}</span></div><div><b>Planning window</b><span>${esc(dateSpan(b.all.startMs,b.all.endMs,tz))}</span></div></div>
      <dl class="pv-keys"><dt>Needs attention</dt><dd data-attention>${first?`<b>${esc(first.what)}</b><small>${esc(first.when)}</small>`:R&&R.state==='pending'?'Not in range yet':`<b>Nothing in the schedule needs weather attention right now</b><small>${missingH?`${missingH} hour${missingH>1?'s have':' has'} no forecast data, so that part is not an all-clear.`:`Rain, gusts against your ${A.limit} mph limit and lightning checked hour by hour.`}</small>`}</dd><dt>Next check</dt><dd data-next>${nextCk?`<b>${esc(date(nextCk.at,tz))}, ${esc(clock(nextCk.at,tz))} ${esc(zone(nextCk.at,tz))}</b><small>${esc(nextCk.what)}</small>`:'Now: use radar, lightning detection and NWS warnings.'}</dd><dt>Peak hourly rain chance</dt><dd>${peak?`<b>${esc(U.pct(peak.v))}</b> · ${esc(date(peak.at,tz))}, ${esc(hourWindow(peak.at,tz))}`:'Unavailable'}</dd><dt>Lightning potential</dt><dd><b>${esc(lightAll.word)}</b>${lightAll.base==='Low'?' · Low is not zero.':''}</dd></dl>
      ${sourceHtml(res)}
      <h2 class="pv-section">Which part needs attention, and when</h2>${attentionHtml(A,{tz,pageHours:PH,idPrefix:'pv'})}${attentionList(A,tz,3,1)}<table class="pv-t pv-phases"><thead><tr><th>Phase / local time</th><th>Planning note</th><th>Rain / lightning</th><th>Temperature / gusts</th></tr></thead><tbody>${b.phases.map((p,i)=>{const P=PS[i];return `<tr data-phase="${esc(p.key)}"><td><b>${esc(p.label)}</b> <small class="pv-in">${esc(U.fmt.span(p.startMs,p.endMs,tz))}</small></td><td>${p.level?`${esc(S.HAZARDS[p.top].label)}: ${esc(S.LEVEL_WORD[p.level].toLowerCase())}`:P.covered?'No concern identified':'Not in range yet'}${P.covered<P.of?`<small>${P.covered} of ${P.of} hours in range</small>`:''}</td><td><b data-peak>${esc(P.peakPop?U.pct(P.peakPop.v):'—')}</b> peak hourly${P.peakPop?` <small class="pv-in">${esc(hourWindow(P.peakPop.at,tz))}</small>`:''}<small>Lightning: ${esc(light(P))}</small></td><td><b>${esc(temp(P))}</b> <small class="pv-in">Gusts ${esc(P.gust?Math.round(P.gust.v)+' mph':'unavailable')}</small>${P.gust&&S.HAZARDS.wind.hour({gust:P.gust.v},{gust:A.limit})?`<small><b>≥ ${A.limit} mph venue limit</b></small>`:''}</td></tr>`;}).join('')}</tbody></table>
      
      <div class="pv-next"><section><h2 class="pv-section">Official NWS forecast</h2>${per.length?`<ul class="pv-nws">${per.map(p=>`<li data-nws-period><b>${esc(p.name)}:</b> ${esc(p.text)}${p.temp!=null?`, ${Math.round(p.temp)}°`:''}${Number.isFinite(p.pop)?` · ${esc(U.pct(p.pop))} precip chance`:''}${p.thunder?' · <b>Thunderstorms mentioned</b>':''}</li>`).join('')}</ul>`:'<p class="pv-note">NWS forecast unavailable for this window.</p>'}
      ${nwsTh.length?`<p class="pv-note"><b>NWS mentions thunderstorms.</b>${lightAll.base==='Low'?' The model signal is low; thunderstorms remain possible.':''}</p>`:''}<p class="pv-note">${nws?`NWS ${esc(nws.office)} · `:''}${NP.cut||NP.omitted?`${NP.omitted?`${NP.shown.length} of ${NP.total} periods${NP.cut?', shortened':''}`:'Shortened'} to fit this page; the on-screen briefing has the full NWS wording.`:'Forecast periods shown as issued.'}</p></section>
      <section><h2 class="pv-section">When to check again</h2><ul class="pv-checks">${(checks.length?checks.slice(0,3):[{at:now,what:'Use radar, lightning detection and NWS warnings'}]).map(c=>`<li><b>${esc(date(c.at,tz))}, ${esc(clock(c.at,tz))} ${esc(zone(c.at,tz))}</b> · ${esc(c.what)}</li>`).join('')}</ul></section></div>
      ${foot(1,'<span class="pv-policy">Forecast planning guidance. For live decisions, follow NWS warnings and your venue’s lightning policy.</span>')}</section>
      <section class="pv-page pv-p2${hours.length>16?' pv-dense':''}"><header class="pv-head"><div><span class="pv-kicker">FORECAST OPS / HOURLY DETAIL</span><h2 class="pv-title">Hour by hour</h2><div class="pv-venue">${esc(ev.loc.name)}</div></div><div class="pv-iss">Issued ${esc(issue)}</div></header>
      <p class="pv-hours-window" data-page-hours="${PH.start}-${PH.start+PH.count}"><b>Hours shown:</b> ${hours.length?esc(dateSpan(hours[0],hours[hours.length-1]+H,tz)): 'No hours available'}${clipped?`<br><b>${PH.fromStart?'First 24 hours only':'24 of '+PH.total+' planning hours'}</b>${PH.fromStart?` (24 of ${PH.total})`:', chosen to include the first concern on page 1'}; open the briefing for the rest.`:''}</p>
      <table class="pv-t pv-hours"><thead><tr><th>Hour / phase</th><th>Temp<br>°F</th><th>Feels<br>°F</th><th>Rain<br>chance</th><th>Amount<br>in.</th><th>Lightning</th><th>Wind<br>mph</th><th>Gusts<br>mph</th></tr></thead><tbody>${hours.map((ms,i)=>`<tr data-ms="${ms}"><td><b>${esc(V.axis[i+off].newDay||i===0?U.fmt.day(ms,tz)+' ':'')}${esc(V.axis[i+off].hourText)}${V.axis[i+off].showZone||i===0?` ${esc(V.axis[i+off].zone)}`:''}</b><small>${esc(cell('phase',i))}</small></td><td>${esc(cell('temp',i))}</td><td>${esc(cell('feel',i))}</td><td data-pop>${esc(cell('pop',i))}${V.hrs[i+off]?.state === 'ok' && Number.isFinite(V.hrs[i+off].pop) ? `<span class="pv-hour-bar" aria-hidden="true" style="--pop:${Math.min(100,Math.max(0,V.hrs[i+off].pop))}%"></span>` : ''}</td><td>${esc(cell('qpf',i))}</td><td>${esc(cell('lightning',i))}</td><td>${esc(cell('wind',i))}</td><td${A.hours[i+off]?.wind.signal?' class="pv-over" data-over':''}>${esc(cell('gust',i))}${A.hours[i+off]?.wind.signal?'<small> ≥ limit</small>':''}</td></tr>`).join('')}</tbody></table>
      ${res.support ? root.ForecastSupport.html(res.support,{compact:true}) : ""}
      <div class="pv-reading"><h2 class="pv-section">Reading this briefing</h2><p>Phase planning notes are on page 1. They do not mean every hour has the same threat. Each phase lists its highest single-hour rain chance; an hour that crosses a phase boundary counts in both phases. Rain is the blended hourly chance at the venue. Low lightning potential is not zero, and it is a forecast, not detected lightning; Unavailable means guidance is missing. Gusts marked “≥ limit” reach your ${A.limit} mph venue limit. A dash is missing data, not a forecast of none.</p></div>
      <p class="pv-src">${esc(res.recipe)}${res.market.tuned?' · Cincinnati weights; verification under way.':' · Weights unverified for this market.'} ${area?'City-area forecast at':'Forecast at'} ${Number(ev.loc.lat).toFixed(4)}, ${Number(ev.loc.lon).toFixed(4)}. Times are the venue's local time (${esc(tz)}). Data: Open-Meteo (CC BY 4.0), National Weather Service, NOAA. Model guidance only, not an official forecast or warning.</p>${foot(2)}</section>`;
  }
  const api={date,dateSpan,hourWindow,windowText,headline,coverage,eventFeeds,sourceHtml,rainAmount,nwsPrint,attention,attentionText,attentionHtml,attentionList,pageHours,printMarkup};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.EventBriefingUI=api;
})(typeof globalThis!=='undefined'?globalThis:this);
