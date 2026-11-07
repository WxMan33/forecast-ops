/* A compact, time-bounded investigation line; never changes the point forecast. */
(function(root){'use strict';
 const H=3600000,Impact=root.ImpactFlags||(typeof require==='function'?require('./impact-flags.js'):null);
 function collect({data,rows,impacts,records=[],gusts={},C,now=Date.now()}){
   const start=now,end=now+48*H,items=[];
   const within=times=>times.filter(t=>t>=start&&t<end);
   for(const row of rows){const day=row.k;
     for(const f of impacts.get(day)||[]){
       const key=day+'-'+f.kind+'-'+(f.signal||f.origin||'model')+(f.alertId?'-'+f.alertId:'');
       if(f.origin==='nws'){
         const morningStart=C.time.toUtc(day+'T00:00',data.tz),morningEnd=C.time.toUtc(day+'T09:00',data.tz);
         const s=Math.max(now,f.start,morningStart),e=Math.min(end,f.end,morningEnd,f.expires);
         if(e>s)items.push({key,day,kind:f.kind,label:f.label,origin:'nws',start:s,end:e,flag:f});
       }else if(f.kind==='frost'||f.kind==='freeze'){
         const sources=f.sources.map(s=>({...s,times:Impact.consecutive(within(s.times).map(ms=>({ms}))).map(p=>p.ms)})).filter(s=>s.times.length>=2);
         if(sources.length>=2)items.push({key,day,kind:f.kind,label:f.kind==='frost'?'Frost possible':'Freeze possible',origin:'model',start:Math.min(...sources.flatMap(s=>s.times)),end:Math.min(end,Math.max(...sources.flatMap(s=>s.times))+H),flag:{...f,sources}});
       }else if(f.kind==='fog'){
         const signal=f.signal||(f.label.startsWith('AM fog')?'fog':'visibility');
         const visibility=(f.visibility||[]).map(v=>({...v,lowMin:v.lowSamples?.some(p=>p.ms>=start&&p.ms<end)?Math.min(...v.lowSamples.filter(p=>p.ms>=start&&p.ms<end).map(p=>p.value)):v.lowMin,lowTimes:Impact.consecutive(within(v.lowTimes).map(ms=>({ms}))).map(p=>p.ms),fogTimes:Impact.consecutive(within(v.fogTimes).map(ms=>({ms}))).map(p=>p.ms)}));
         const qualifying=visibility.filter(v=>(signal==='fog'?v.fogTimes:v.lowTimes).length>=2&&(signal==='fog'||!(f.visibility||[]).some(other=>other.site===v.site&&other.fogTimes.length)));
         const sites=[...new Set(qualifying.map(v=>v.site))],times=qualifying.flatMap(v=>signal==='fog'?v.fogTimes:v.lowTimes);
         if(sites.length)items.push({key,day,kind:'fog',label:(signal==='fog'?'Fog: ':'Vis↓: ')+sites.join('/'),origin:'model',start:Math.min(...times),end:Math.min(end,Math.max(...times)+H),flag:{...f,visibility}});
       }
     }
     // Reaggregate only the part of this date inside the 48-hour window.
     const g=gusts[day],gustTimes=g?within(g.times):[];if(g&&Number.isFinite(g.value)&&g.value>=20&&gustTimes.length){
       items.push({key:day+'-wind',day,kind:'wind',label:'G:'+Math.floor(g.value/10)*10+'+',origin:'model',start:gustTimes[0],end:Math.min(end,gustTimes.at(-1)+H),flag:{kind:'wind',label:'G:'+Math.floor(g.value/10)*10+'+',sources:[],criteria:'Blended peak gust '+g.value.toFixed(0)+' mph over the upcoming part of this date inside the next 48 hours. This is an investigation cue, not an NWS wind advisory.'}});
     }
   }
   for(const r of records){const times=within(r.times||[]);if(times.length)items.push({...r,times,origin:'record',start:Math.min(...times),end:Math.min(end,Math.max(...times)+H)});}
   return items.sort((a,b)=>a.start-b.start||((a.origin==='nws'?0:1)-(b.origin==='nws'?0:1))||a.key.localeCompare(b.key));
 }
 function mount({O,C,host,details}){
   let active=null,current=[],zone='America/New_York';
   const labelDay=item=>{const d=new Date(C.time.toUtc(item.day+'T12:00',zone)).toLocaleDateString('en-US',{weekday:'short',timeZone:zone});return d+(item.kind==='frost'||item.kind==='freeze'||item.kind==='fog'?' AM':'');};
   function select(key){active=active===key?null:key;draw();if(active)host.querySelector('.heads-up-detail')?.focus({preventScroll:true});}
   function draw(){
     const selected=current.find(i=>i.key===active);
     const chips=host.querySelector('.heads-up-chips');
     chips.innerHTML=current.map((i,n)=>`<button type="button" class="heads-up-chip impact-${O.esc(i.kind)} ${i.origin==='nws'?'impact-official':''}" data-heads-up="${n}" aria-expanded="${i.key===active}" aria-controls="next48Detail">${i.origin==='nws'?'<span class="impact-agency">NWS</span> ':''}<span class="heads-up-day">${O.esc(labelDay(i))}</span><span>${O.esc(i.label)}</span></button>`).join('');
     const panel=host.querySelector('.heads-up-detail');panel.hidden=!selected;
     if(selected){panel.innerHTML=`<div class="heads-up-detail-head"><strong>${O.esc(labelDay(selected)+' · '+selected.label)}</strong><button class="btn ghost sm" type="button" data-close-heads-up aria-label="Close heads-up details">Close</button></div>`+(selected.origin==='record'?`<p>${O.esc(selected.detail)}</p>`:details(selected));panel.querySelector('[data-close-heads-up]').onclick=()=>{active=null;draw();host.querySelector(`[data-heads-up="${current.indexOf(selected)}"]`)?.focus();};}
     chips.querySelectorAll('[data-heads-up]').forEach(b=>b.onclick=()=>select(current[+b.dataset.headsUp].key));
   }
   function render(args){zone=args.data.tz;current=collect({...args,C});host.hidden=false;
     if(!host.querySelector('.heads-up-chips'))host.innerHTML='<div class="heads-up-line"><span class="heads-up-label">Next 48 hours</span><div class="heads-up-chips"></div><span class="heads-up-status msg"></span></div><div class="heads-up-detail" id="next48Detail" tabindex="-1" hidden></div>';
     const status=host.querySelector('.heads-up-status');status.textContent=args.modelStatus==='unavailable'?'Model guidance unavailable.':current.length?'':'No additional flags in available guidance.';
     if(args.recordStatus==='loading')status.textContent+=(status.textContent?' ':'')+'Checking records…';
     if(args.recordStatus==='unavailable')status.textContent+=(status.textContent?' ':'')+'Record checks incomplete.';
     if(args.alertStatus==='loading')status.textContent+=(status.textContent?' ':'')+'Checking NWS alerts…';
     if(args.alertStatus==='unavailable')status.textContent+=(status.textContent?' ':'')+'NWS alert check unavailable.';
     draw();
   }
   return {render};
 }
 const api={collect,mount};if(typeof module==='object'&&module.exports)module.exports=api;else root.Next48HeadsUp=api;
})(typeof globalThis==='object'?globalThis:this);
