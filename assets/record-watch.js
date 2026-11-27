/* Record heads-up only. Forecast values/weights are never modified.
   Records come from the forecast point's climate station (ClimateStation): its threaded city record where one
   exists, otherwise the station's own record. Cache keys carry the record ID; a point change clears pending work. */
(function(root){'use strict';
 const TYPES={hi:[['highMax','Record high','warm',1],['lowMax','Record cold high','cold',-1]],lo:[['lowMin','Record low','cold',-1],['highMin','Record warm low','warm',1]]};
 function eligible(loc){if(!loc||!Number.isFinite(+loc.lat)||!Number.isFinite(+loc.lon))return false;const dy=(+loc.lat-39.04456)*111.2,dx=(+loc.lon+84.67229)*86.4;return Math.hypot(dx,dy)<=5;}
 function records(rows,date){const out={};for(const [col,key,dir] of [[1,'highMax',1],[1,'lowMax',-1],[2,'lowMin',-1],[2,'highMin',1],[3,'pcpn',1],[4,'snow',1]]){const ok=(rows||[]).filter(r=>String(r[0]).slice(5)===date.slice(5)&&+String(r[0]).slice(0,4)<+date.slice(0,4)&&r[col]!==null&&r[col]!==''&&Number.isFinite(Number(r[col])));if(ok.length<30)continue;const value=dir===1?Math.max(...ok.map(r=>+r[col])):Math.min(...ok.map(r=>+r[col]));out[key]={value,years:ok.filter(r=>+r[col]===value).map(r=>+r[0].slice(0,4)),n:ok.length,missing:Math.max(0,+date.slice(0,4)-1871-ok.length)};}return out;}
 function assess(row,kind,rec){if(row.hours!==24||!Number.isFinite(row[kind]))return [];const forecast=Math.round(row[kind]);return TYPES[kind].flatMap(([key,label,color,dir])=>{const r=rec?.[key];if(!r||r.n<30)return [];const margin=(forecast-r.value)*dir;if(margin < -2)return [];return [{key,label,color,forecast,record:r.value,years:r.years,n:r.n,missing:r.missing||0,status:margin>0?'Potential record':margin===0?'Potential tie':'Near record',gap:Math.abs(forecast-r.value)}];});}
 function mount({O,C,rerender,station:fixed=null}){const cache=new Map(),pending=new Set();let queue=[],busy=0,notifyQueued=false,st=null,stKey=null;
 /* the climate reference for the current point; resolving it again for a new point drops everything from the old one */
 function station(loc){if(fixed){st=st||fixed;return st;}const CS=root.ClimateStation;if(!CS||!loc)return null;const k=CS.keyOf(loc);if(k!==stKey){stKey=k;st=null;cache.clear();pending.clear();queue=[];
   const fetchJSON=(u,o)=>fetch(u,o).then(r=>r.ok?r.json():{error:'HTTP '+r.status}).catch(e=>({error:String(e)}));
   CS.forPoint(loc,{fetchJSON}).then(r=>{if(stKey!==k)return;const x=r.station;st=x?{sid:x.thr?x.thr.sid:x.faa,faa:x.faa,name:x.thr?x.thr.name:x.name+' station record',since:(x.thr&&x.thr.since)||x.since||1900}:{none:true};notify();}).catch(()=>{if(stKey===k){st={none:true};notify();}});}
   return st&&!st.none?st:null;}
 const usable=(loc)=>!!station(loc);
 function notify(){if(notifyQueued)return;notifyQueued=true;setTimeout(()=>{notifyQueued=false;rerender();},0);}
 function drain(){while(busy<3&&queue.length){const date=queue.shift();busy++;load(date).finally(()=>{busy--;drain();});}}
 async function load(date){const ref=st,k=stKey;if(!ref)return;const key='record-watch-v3:'+ref.sid+':'+date;let result=null;try{const saved=O.store.get(key,null);if(saved&&Date.now()-saved.at<7*86400000&&saved.date===date){result=saved;return;}const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);let j;try{const response=await fetch('https://data.rcc-acis.org/StnData',{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({sid:ref.sid,sdate:ref.since+'-'+date.slice(5),edate:(+date.slice(0,4)-1)+'-'+date.slice(5),elems:[{name:'maxt',interval:[1,0,0]},{name:'mint',interval:[1,0,0]},{name:'pcpn',interval:[1,0,0]},{name:'snow',interval:[1,0,0]}],meta:['name','valid_daterange']})});if(!response.ok)throw Error('ACIS '+response.status);j=await response.json();}finally{clearTimeout(timer);}if(j.error||!Array.isArray(j.data))throw Error('Record data unavailable');const parsed=records(j.data,date);if(!['highMax','lowMax','lowMin','highMin'].every(k=>parsed[k]))throw Error('Insufficient historical record coverage');result={date,at:Date.now(),records:parsed};O.store.set(key,result);}catch(e){result={date,error:'Record check unavailable'};}finally{if(stKey===k){cache.set(date,result);pending.delete(date);notify();}}}
 function prepare(rows,loc,tz){if(!usable(loc))return;for(const r of rows){if(r.hours!==24||cache.has(r.k)||pending.has(r.k))continue;/* Feb 29 needs a leap-specific query, so do not infer it. */if(r.k.endsWith('02-29')){cache.set(r.k,{error:'Leap-day record check unavailable'});continue;}pending.add(r.k);queue.push(r.k);}drain();}
 function badge(row,kind,loc,tz){if(!usable(loc))return '';const today=C.time.toLocal(Date.now(),tz).slice(0,10);if(row.k<today)return '';const item=cache.get(row.k);if(!item||item.error)return '';return assess(row,kind,item.records).map(hit=>{const id='rw-'+row.k+'-'+hit.key;const start=C.time.toUtc(row.k+'T00:00',tz);const aligned=(()=>{/* climate day = local standard-time midnight: the larger UTC offset of January and July */const y=+row.k.slice(0,4);const std=Math.max(C.time.toUtc(y+'-01-15T00:00',tz)-Date.UTC(y,0,15),C.time.toUtc(y+'-07-15T00:00',tz)-Date.UTC(y,6,15));return start-Date.parse(row.k+'T00:00:00Z')===std;})();const detail=`${hit.label}: ${hit.record}°F (${hit.years.join(', ')}). Blend ${hit.forecast}°F for ${row.k}. ${st?st.name+' ('+st.sid+')':'Climate station record'} via RCC-ACIS, ${hit.n} usable years before ${row.k.slice(0,4)}${hit.missing?'; '+hit.missing+' years missing':''}. Forecast point's climate station; this is guidance, not a confirmed record. ${aligned?'Forecast calendar day matches midnight-to-midnight EST.':'Forecast uses daylight-saving calendar hours; official records use midnight-to-midnight EST. This is an approximate heads-up.'} Checked ${new Date(item.at).toISOString().slice(0,10)}.`;return `<button type="button" class="record-watch ${hit.color}" data-record-detail="${O.esc(detail)}" aria-expanded="false" aria-controls="${id}" title="${O.esc(detail)}">${hit.status==='Near record'?'Near rec · '+hit.gap+'°':hit.status==='Potential tie'?'Record tie?':'Record?'}<span class="sr"> ${O.esc(hit.label)}</span></button><span id="${id}" class="record-watch-detail" hidden></span>`;}).join('');}
 function wire(host){host.querySelectorAll('.record-watch').forEach(b=>{b.onclick=e=>{e.stopPropagation();const panel=document.getElementById(b.getAttribute('aria-controls'));panel.hidden=!panel.hidden;panel.textContent=b.dataset.recordDetail;b.setAttribute('aria-expanded',String(!panel.hidden));};b.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')e.stopPropagation();};});}
 function note(rows,loc,tz){if(!usable(loc))return '';const errors=rows.filter(r=>cache.get(r.k)?.error).length;return ' Record watch: small badges flag a full-day blend within 2°F of, tying or exceeding a temperature record in the '+(st?st.name+' ('+st.sid+')':'climate station record')+'. Tap for record, year and time-window caveats. '+(errors?`Record checks unavailable for ${errors} day${errors===1?'':'s'}; no badge does not mean no record risk.`:'');}
 function summary(rows,loc,tz,start,end,ms,temperatures){
   if(!usable(loc))return [];
   return rows.flatMap(row=>{const item=cache.get(row.k);if(!item||item.error)return [];
     const ix=ms.map((time,i)=>({time,i})).filter(p=>p.time>=start&&p.time<end&&C.time.toLocal(p.time,tz).slice(0,10)===row.k);
     if(!ix.length||!ix.every(p=>Number.isFinite(temperatures[p.i])))return [];
     const values=ix.map(p=>temperatures[p.i]),upcoming={...row,hi:Math.max(...values),lo:Math.min(...values)};
     return ['hi','lo'].flatMap(kind=>{const daily=new Set(assess(row,kind,item.records).map(h=>h.key));return assess(upcoming,kind,item.records).filter(hit=>daily.has(hit.key)).map(hit=>{
       const dir=TYPES[kind].find(t=>t[0]===hit.key)[3],times=ix.filter(p=>(temperatures[p.i]-hit.record)*dir>=-2).map(p=>p.time);
       return {key:row.k+'-'+hit.key,day:row.k,kind:'record',color:hit.color,label:hit.status==='Near record'?'Near '+hit.label.toLowerCase():hit.label+'?',times,
         detail:`${hit.label}: ${hit.record}°F (${hit.years.join(', ')}). Upcoming hourly blend ${hit.forecast}°F for ${row.k}, also supported by the full calendar-day blend. ${st?st.name+' ('+st.sid+')':'Climate station record'} via RCC-ACIS, ${hit.n} usable years. This is guidance, not a confirmed record. Forecast uses local calendar hours; official records use midnight-to-midnight EST.`};
     });});
   });
 }
 function status(rows,loc,tz,start,end){if(!usable(loc))return 'not-applicable';const relevant=rows.filter(r=>r.hours===24&&C.time.toUtc(r.k+'T00:00',tz)<end&&C.time.toUtc(r.k+'T00:00',tz)+25*3600000>start);if(relevant.some(r=>!cache.has(r.k)))return 'loading';return relevant.some(r=>cache.get(r.k)?.error)?'unavailable':'ready';}
 function candidates(rows,loc,tz,now,snowFor){if(!usable(loc))return {items:[],approx:new Set(),station:null};const today=C.time.toLocal(now,tz).slice(0,10),approx=new Set(),items=[];
   for(const row of rows){if(row.k<=today||row.hours!==24)continue;const item=cache.get(row.k);if(!item||item.error)continue;const start=C.time.toUtc(row.k+'T00:00',tz),y=+row.k.slice(0,4),std=Math.max(C.time.toUtc(y+'-01-15T00:00',tz)-Date.UTC(y,0,15),C.time.toUtc(y+'-07-15T00:00',tz)-Date.UTC(y,6,15));if(start-Date.parse(row.k+'T00:00:00Z')!==std)approx.add(row.k);
     items.push(...potential(row,item.records,{snow:snowFor?snowFor(row.k):null}));}
   return {items,approx,station:st?st.name+' ('+st.sid+')':null};}
 return {prepare,badge,wire,note,summary,status,candidates};}
 /* ---------- Forecast record potential (Model Blend card) ----------
   Compares a full forecast calendar day with the daily record for the same measurement and period, at the forecast
   point's climate station. Temperatures: the four extremes, as the badges (within 2°F on the approach side, a tie, or
   beyond). Precipitation: the blend's daily liquid total against the daily precipitation record, shown at 80% of the
   record or more (at least 0.25 in), or when the upper guidance (90th percentile) reaches it from at least half of it.
   Snowfall: only NWS's gridded snowfall forecast, which forecasts measured snowfall; the models' own snowfall (a fixed
   7:1 ratio) is never compared with a snowfall record. NWS intervals must cover the calendar day; when they straddle its
   edges, only a total whose low end already reaches the record is shown. Thresholds are display choices, not
   probabilities. Partial days (today, 23/25-hour days) are never compared with a full-day record. Period totals (month,
   season) are not compared yet: observations to date and the remaining forecast don't share a cutoff on the page. */
 const DAYW=(k)=>new Date(k+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long'});
 const MD=(k)=>new Date(k+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
 const TEMPW={highMax:['high','record high'],lowMax:['high','record cold high'],lowMin:['low','record low'],highMin:['low','record warm low']};
 const in2=(x)=>(+x).toFixed(2)+' in',in1=(x)=>(+x).toFixed(1)+' in';
 /* "All guidance" only when every source's own value is the same; bounds that merely round alike read "Guidance around" */
 const agree=(parts)=>{const v=(parts||[]).map(p=>p&&p.v).filter(Number.isFinite);return v.length>1&&Math.max(...v)-Math.min(...v)<1e-9;};
 function potential(row,rec,{snow=null,dayName=null}={}){
   if(!row||row.hours!==24||!rec)return [];const day=dayName||DAYW(row.k),out=[];
   for(const kind of ['hi','lo'])for(const hit of assess(row,kind,rec)){const [word,name]=TEMPW[hit.key],dir=TYPES[kind].find(t=>t[0]===hit.key)[3],margin=(hit.forecast-hit.record)*dir,R=kind==='hi'?row.hiR:row.loR;
     const has=R&&Number.isFinite(R[0])&&Number.isFinite(R[1]),far=has?Math.round(dir>0?R[1]:R[0]):null,near=has?Math.round(dir>0?R[0]:R[1]):null;
     const extra=!has?'':margin<0&&(far-hit.record)*dir>=0?', and its '+(dir>0?'upper':'lower')+' end reaches the record':margin>=0&&(near-hit.record)*dir<0?', and its '+(dir>0?'lower':'upper')+' end stays short of it':'';
     out.push({date:row.k,key:hit.key,kind:'temp',color:hit.color,label:name,forecast:hit.forecast+'°F',record:hit.record+'°F',years:hit.years,state:margin>0?'break':margin===0?'tie':'near',
       sentence:margin>0?`The current blend would break ${day}'s ${name} by ${margin}°F`:margin===0?`The current blend would tie ${day}'s ${name}`:`${day}'s forecast ${word} is within ${-margin}°F of the ${name}`,
       closeness:margin>0?`${margin}°F past the record`:margin===0?'ties the record':`${-margin}°F short`,
       spread:has?(Math.round(R[0])===Math.round(R[1])?`${agree(row.parts&&row.parts[kind])?'All guidance':'Guidance around'} ${Math.round(R[0])}°F`:`Guidance range ${Math.round(R[0])}–${Math.round(R[1])}°F${extra}`):null});}
   const P=rec.pcpn;if(P&&P.n>=30&&Number.isFinite(row.qpf)&&P.value>0){const f=Math.round(row.qpf*100)/100,hi=row.qpfR&&Number.isFinite(row.qpfR[1])?row.qpfR[1]:null;
     const near=f>=0.8*P.value&&f>=0.25,upper=hi!=null&&hi>=P.value&&f>=0.5*P.value;
     if(f>=P.value||near||upper)out.push({date:row.k,key:'pcpn',kind:'pcpn',color:'wet',label:'daily precipitation record',forecast:in2(f),record:in2(P.value),years:P.years,state:f>P.value?'break':f===P.value?'tie':'near',
       sentence:f>P.value?`The current blend would break ${day}'s daily precipitation record`:f===P.value?`The current blend would tie ${day}'s daily precipitation record`:near?`${day}'s blend precipitation is within ${in2(P.value-f)} of the daily record`:`The upper guidance for ${day} reaches the daily precipitation record`,
       closeness:f>P.value?`${in2(f-P.value)} past the record`:f===P.value?'ties the record':`${in2(P.value-f)} short (${Math.round(100*f/P.value)}% of the record)`,
       spread:row.qpfR&&Number.isFinite(row.qpfR[0])&&hi!=null?(in2(row.qpfR[0])===in2(hi)?`${agree(row.parts&&row.parts.qpf)?'All guidance':'Guidance around'} ${in2(hi)}`:`Guidance range ${(+row.qpfR[0]).toFixed(2)}–${in2(hi)}`):null});}
   const SN=rec.snow;if(SN&&SN.n>=30&&SN.value>0&&snow&&snow.covers){const exact=snow.exact,lo=snow.lower,up=snow.upper;
     const v=exact?Math.round(lo*10)/10:null,low=Math.round(lo*10)/10,ok=exact?(v>=SN.value||(v>=0.8*SN.value&&v>=1)):low>=SN.value;
     if(ok)out.push({date:row.k,key:'snow',kind:'snow',color:'cold',label:'daily snowfall record',forecast:exact?in1(v):`${in1(lo)}–${in1(up)}`,record:in1(SN.value),years:SN.years,state:exact?(v>SN.value?'break':v===SN.value?'tie':'near'):low>SN.value?'break':'tie',
       sentence:!exact?(low>SN.value?`Even the low end of NWS's snowfall forecast would break ${day}'s daily snowfall record`:`NWS's snowfall forecast would at least tie ${day}'s daily snowfall record`):v>SN.value?`NWS's snowfall forecast would break ${day}'s daily snowfall record`:v===SN.value?`NWS's snowfall forecast would tie ${day}'s daily snowfall record`:`${day}'s NWS snowfall forecast is within ${in1(SN.value-v)} of the daily record`,
       closeness:!exact?(low>SN.value?`low end ${in1(low-SN.value)} past the record`:'low end ties the record'):v>SN.value?`${in1(v-SN.value)} past the record`:v===SN.value?'ties the record':`${in1(SN.value-v)} short`,
       spread:exact?null:'NWS snowfall intervals cross the calendar day\'s edges, so this is a range',src:'NWS snowfall forecast'});}
   return out;}
 /* the card: one row per candidate, grouped by day; hidden (empty string) when there is nothing meaningful */
 function card(items,{esc,station,approxDays=new Set()}){if(!items.length)return '';
   const rank={break:0,tie:1,near:2};items=items.slice().sort((a,b)=>a.date.localeCompare(b.date)||rank[a.state]-rank[b.state]);
   return `<div class="rp-head"><h2 class="rp-title">Forecast record potential</h2><span class="rp-sub">Guidance compared with the daily records at ${esc(station)}</span></div><ul class="rp-list">`+
     items.map(it=>`<li class="rp-item" data-key="${esc(it.date+'-'+it.key)}" data-state="${it.state}" data-kind="${it.kind}"><div class="rp-when"><b>${esc(DAYW(it.date))}</b><span>${esc(MD(it.date))}</span></div>`+
       `<div class="rp-body"><p class="rp-sentence"><span class="rp-tag" data-state="${it.state}">${it.state==='break'?'Would break':it.state==='tie'?'Would tie':'Near record'}</span> ${esc(it.sentence)}.</p>`+
       `<p class="rp-nums"><span><i>${esc(it.src||'Blend')}</i> <b>${esc(it.forecast)}</b></span><span><i>Record</i> <b>${esc(it.record)}</b> (${esc(it.years.join(', '))})</span><span><i>Gap</i> ${esc(it.closeness)}</span></p>`+
       (it.spread||approxDays.has(it.date)?`<p class="rp-note">${esc([it.spread,approxDays.has(it.date)?'Daylight-time calendar day; official records use midnight to midnight standard time, so this is approximate':null].filter(Boolean).join('. '))}.</p>`:'')+`</div></li>`).join('')+
     `</ul><p class="rp-foot">Forecast record potential: guidance only, never an observed record. Full forecast days only. Records: ${esc(station)} via RCC-ACIS. Thresholds (2°F; 80% of a precipitation record) are display choices, not probabilities.</p>`;}
 const api={eligible,records,assess,potential,card,mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.RecordWatch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
