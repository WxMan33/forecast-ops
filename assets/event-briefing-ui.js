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
  function printMarkup({ev,res,view,S,U}) {
    const {b,V,PS,peak,lightAll,nwsTh,R,checks,top} = view, tz=ev.tz, now=res.ctx.now;
    const issued=res.ctx.B.viewedAt||now, issue=`${date(issued,tz)} · ${clock(issued,tz)} ${zone(issued,tz)}`;
    const main=b.phases.find(p=>p.key==='event')||b.all, hours=V.span.slice(0,24), clipped=V.span.length>24;
    const decision=headline(b,!top&&R&&R.state==='partial'?`No weather concern so far for ${R.inRange}.`:S.decision(b).text);
    const row=k=>V.rows.find(r=>r.key===k), cell=(k,i)=>{const c=row(k)?.cells[i];return c ? c.text||'' : '—';};
    const temp=P=>P.temp?Math.round(P.temp.lo)===Math.round(P.temp.hi)?`${Math.round(P.temp.lo)}°`:`${Math.round(P.temp.lo)}–${Math.round(P.temp.hi)}°`:'—';
    const light=P=>P.lightning.word+(P.lightning.state==='limited'?' (limited)':'');
    const nws=res.NW&&res.NW.ok?res.NW:null, per=nws?nws.periods.filter(p=>p.e>b.all.startMs&&p.s<b.all.endMs).slice(0,3):[];
    const foot=n=>`<footer class="pv-footer"><span>Forecast Ops · ${esc(ev.name.replace(/ \(sample\)$/,''))}</span><span>${n} / 2</span></footer>`;
    const phaseName=p=>`${p.label} · ${U.fmt.span(p.startMs,p.endMs,tz)} ${zone(p.startMs,tz)}`;
    const sub=R?.state==='ready'?'Forecast covers setup through teardown.':R?.state==='partial'?R.line:'Hourly guidance does not reach this event yet.';
    const keyWhen=top ? top.from!=null?U.fmt.span(top.from,top.to,tz):`During ${top.phases.map(x=>x.toLowerCase()).join(' and ')}; hourly timing uncertain` : '';
    return `<section class="pv-page pv-p1"><header class="pv-head"><div><span class="pv-kicker">FORECAST OPS / EVENT BRIEFING</span><h1 class="pv-title">${esc(ev.name.replace(/ \(sample\)$/, ''))}</h1><div class="pv-venue">${esc(ev.loc.name)}</div></div><div class="pv-iss"><b>Issued</b><br>${esc(issue)}</div></header>
      <div class="pv-dates"><div><b>Event</b><span>${esc(dateSpan(main.startMs,main.endMs,tz))}</span></div><div><b>Planning window</b><span>${esc(dateSpan(b.all.startMs,b.all.endMs,tz))}</span></div></div>
      <div class="pv-takeaway"><h2 class="pv-dec">${esc(decision)}</h2><p>${esc(sub)}</p></div>
      <dl class="pv-keys">${keyWhen?`<dt>Timing</dt><dd>${esc(keyWhen)}</dd>`:''}<dt>Peak hourly rain chance</dt><dd>${peak?`<b>${esc(U.pct(peak.v))}</b> · ${esc(date(peak.at,tz))}, ${esc(hourWindow(peak.at,tz))}`:'Unavailable'}<small>Across the planning window, at this venue.</small></dd><dt>Lightning potential</dt><dd><b>${esc(lightAll.word)}</b>${lightAll.base==='Low'?' · Low is not zero.':''}</dd></dl>
      ${sourceHtml(res)}
      <h2 class="pv-section">Your schedule</h2><table class="pv-t pv-phases"><thead><tr><th>Phase / local time</th><th>Planning note</th><th>Rain / lightning</th><th>Temperature / gusts</th></tr></thead><tbody>${b.phases.map((p,i)=>{const P=PS[i];return `<tr data-phase="${esc(p.key)}"><td><b>${esc(p.label)}</b><small>${esc(U.fmt.span(p.startMs,p.endMs,tz))}</small></td><td>${p.level?`${esc(S.HAZARDS[p.top].label)}: ${esc(S.LEVEL_WORD[p.level].toLowerCase())}`:P.covered?'No concern identified':'Not in range yet'}${P.covered<P.of?`<small>${P.covered} of ${P.of} hours in range</small>`:''}</td><td><b data-peak>${esc(P.peakPop?U.pct(P.peakPop.v):'—')}</b> peak hourly${P.peakPop?`<small>${esc(hourWindow(P.peakPop.at,tz))}</small>`:''}<small>Lightning: ${esc(light(P))}</small></td><td><b>${esc(temp(P))}</b><small>Gusts ${esc(P.gust?Math.round(P.gust.v)+' mph':'unavailable')}</small></td></tr>`;}).join('')}</tbody></table>
      <p class="pv-note">Rain percentages are the peak single-hour chance, not the chance over a whole phase. An hour crossing a phase boundary contributes to both phases.</p>
      <h2 class="pv-section">Official NWS forecast</h2>${per.length?`<ul class="pv-nws">${per.map(p=>`<li><b>${esc(p.name)}:</b> ${esc(p.short)}${p.temp!=null?`, ${Math.round(p.temp)}°`:''}${Number.isFinite(p.pop)?` · ${esc(U.pct(p.pop))} precip chance`:''}</li>`).join('')}</ul>`:'<p class="pv-note">NWS forecast unavailable for this window.</p>'}
      ${nwsTh.length?`<p class="pv-note"><b>NWS mentions thunderstorms.</b>${lightAll.base==='Low'?' The model signal is low; thunderstorms remain possible.':''}</p>`:''}<p class="pv-note">${nws?`NWS ${esc(nws.office)} · `:''}Official wording is separate from the model blend.</p>
      <h2 class="pv-section">When to check again</h2><ul class="pv-checks">${(checks.length?checks.slice(0,3):[{at:now,what:'Use radar, lightning detection and NWS warnings'}]).map(c=>`<li><b>${esc(date(c.at,tz))}, ${esc(clock(c.at,tz))} ${esc(zone(c.at,tz))}</b> · ${esc(c.what)}</li>`).join('')}</ul>
      <p class="pv-policy">Forecast planning guidance. For live decisions, follow NWS warnings and your venue’s lightning policy.</p>${foot(1)}</section>
      <section class="pv-page pv-p2${hours.length>16?' pv-dense':''}"><header class="pv-head"><div><span class="pv-kicker">FORECAST OPS / HOURLY DETAIL</span><h2 class="pv-title">Hour by hour</h2><div class="pv-venue">${esc(ev.loc.name)}</div></div><div class="pv-iss">Issued ${esc(issue)}</div></header>
      <p class="pv-hours-window">${hours.length?esc(dateSpan(hours[0],hours[hours.length-1]+H,tz)): 'No hours available'}${clipped?`<br><b>First 24 hours only.</b> Planning continues through ${esc(date(b.all.endMs,tz))}, ${esc(clock(b.all.endMs,tz))} ${esc(zone(b.all.endMs,tz))}; open the briefing for the rest.`:''}</p>
      <table class="pv-t pv-hours"><thead><tr><th>Hour / phase</th><th>Temp<br>°F</th><th>Feels<br>°F</th><th>Rain<br>chance</th><th>Amount<br>in.</th><th>Lightning</th><th>Wind<br>mph</th><th>Gusts<br>mph</th></tr></thead><tbody>${hours.map((ms,i)=>`<tr data-ms="${ms}"><td><b>${esc(V.axis[i].newDay||i===0?U.fmt.day(ms,tz)+' ':'')}${esc(V.axis[i].hourText)}${V.axis[i].showZone?` ${esc(V.axis[i].zone)}`:''}</b><small>${esc(cell('phase',i))}</small></td><td>${esc(cell('temp',i))}</td><td>${esc(cell('feel',i))}</td><td data-pop>${esc(cell('pop',i))}</td><td>${esc(cell('qpf',i))}</td><td>${esc(cell('lightning',i))}</td><td>${esc(cell('wind',i))}</td><td>${esc(cell('gust',i))}</td></tr>`).join('')}</tbody></table>
      <div class="pv-reading"><h2 class="pv-section">Reading this briefing</h2><p>Phase planning notes are on page 1. They do not mean every hour has the same threat. Rain is the blended hourly chance at the venue. Low lightning potential is not zero; Unavailable means guidance is missing. A dash is missing data, not a forecast of none.</p></div>
      <p class="pv-src">${esc(res.recipe)}${res.market.tuned?' · Cincinnati weights; verification under way.':' · Weights unverified for this market.'} Forecast at ${Number(ev.loc.lat).toFixed(4)}, ${Number(ev.loc.lon).toFixed(4)}. Times are the venue's local time (${esc(tz)}). Data: Open-Meteo (CC BY 4.0), National Weather Service, NOAA. Model guidance only, not an official forecast or warning.</p>${foot(2)}</section>`;
  }
  const api={date,dateSpan,hourWindow,headline,coverage,eventFeeds,sourceHtml,rainAmount,printMarkup};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.EventBriefingUI=api;
})(typeof globalThis!=='undefined'?globalThis:this);
