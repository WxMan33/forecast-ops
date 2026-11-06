/* Local planning periods and present-tense model timing. No observations are inferred. */
(function(root){'use strict';const H=3600000;
function add(date,n){return new Date(Date.parse(date+'T12:00Z')+n*86400000).toISOString().slice(0,10);}
function periods(C,tz,now){const wall=C.time.toLocal(now,tz),day=wall.slice(0,10),hour=+wall.slice(11,13),at=(d,h)=>C.time.toUtc(d+'T'+String(h).padStart(2,'0')+':00',tz),tom=add(day,1);const remaining={key:day,label:hour<6?'Early this morning':'Rest of today',s:Math.floor(now/H)*H,e:at(day,hour<6?6:18),kind:hour<6?'low':'high'};const tonight={key:day,label:'Tonight',s:at(day,18),e:at(tom,6),kind:'low'},tomorrow={key:tom,label:'Tomorrow',s:at(tom,6),e:at(tom,18),kind:'high'},nextNight={key:tom,label:'Tomorrow night',s:at(tom,18),e:at(add(day,2),6),kind:'low'};if(hour<6)return {primary:[remaining,{key:day,label:'Today',s:at(day,6),e:at(day,18),kind:'high'},tonight,tomorrow],remaining:null};return {primary:hour<14?[remaining,tonight,tomorrow,nextNight]:[hour<18?tonight:{...tonight,s:Math.floor(now/H)*H},tomorrow,nextNight],remaining:hour>=14&&hour<18?remaining:null};}
function timing(rows,now){const valid=rows.filter(t=>t.status==='wet'||t.status==='ensemble'&&!t.partial&&t.wet>=t.members/2);const future=[],active=[],past=[];for(const t of valid){const rounds=t.status==='wet'?(t.rounds||[]).map((r,i,a)=>({...r,clipped:!!t.endClipped&&i===a.length-1})):[{start:t.onset,end:t.end,clipped:t.endClipped}];for(const r of rounds){if(!Number.isFinite(r.start)||!Number.isFinite(r.end))continue;if(r.end<=now){past.push(r);continue;}future.push(r);if(r.start<=now)active.push(r);}}
 const starts=future.filter(r=>r.start>now).map(r=>r.start),ends=future.filter(r=>!r.clipped).map(r=>r.end);return {active:active.length,future:future.length,past:past.length,starts,ends,continues:future.some(r=>r.clipped),ended:valid.length>0&&!future.length&&past.length>0};}
// NWS lows belong to the morning when the night period ends, not the evening it starts.
function nwsMorning(C,tz,periods,day){return {day:periods.find(p=>p.isDaytime&&C.time.toLocal(p.s,tz).slice(0,10)===day),morning:periods.find(p=>!p.isDaytime&&C.time.toLocal(p.e,tz).slice(0,10)===day&&+C.time.toLocal(p.e,tz).slice(11,13)<12)};}
function focus(C,tz,now){const wall=C.time.toLocal(now,tz),day=wall.slice(0,10),hour=+wall.slice(11,13);return {day,tomorrow:add(day,1),evening:hour>=18,forward:hour>=14};}
// Conservative display cues from complete hourly windows. No trend is inferred across missing hours.
function temperaturePattern(C,tz,ms,values,day){
 const points=ms.map((ms,i)=>({ms,v:values[i],wall:C.time.toLocal(ms,tz)}));
 const window=(start,end)=>{const a=C.time.toUtc(start,tz),b=C.time.toUtc(end,tz),p=points.filter(p=>p.ms>=a&&p.ms<b);return p.length===(b-a)/H&&p.every((x,i)=>typeof x.v==='number'&&Number.isFinite(x.v)&&(!i||x.ms-p[i-1].ms===H))?p:null;};
 const cues=[],avg=p=>p.reduce((n,p)=>n+p.v,0)/p.length;
 const daytime=window(day+'T06:00',day+'T18:00'),night=window(day+'T18:00',add(day,1)+'T06:00');
 if(daytime){const a=avg(daytime.slice(0,3)),b=avg(daytime.slice(-3));if(a-b>=5&&daytime.filter((p,i)=>i&&p.v<=daytime[i-1].v+1).length>=8)cues.push({kind:'falling',label:'↓ Daytime cooling',text:'Hourly temperatures fall from about '+Math.round(a)+'° early to '+Math.round(b)+'° late in the daytime window.'});}
 if(night){const a=avg(night.slice(0,3)),b=avg(night.slice(-3));if(b-a>=5&&night.filter((p,i)=>i&&p.v>=night[i-1].v-1).length>=8)cues.push({kind:'rising',label:'↑ Overnight warming',text:'Hourly temperatures rise from about '+Math.round(a)+'° in the evening to '+Math.round(b)+'° toward morning.'});}
 const full=window(day+'T00:00',add(day,1)+'T00:00');
 if(full){const hi=Math.max(...full.map(p=>p.v)),lo=Math.min(...full.map(p=>p.v));if(hi-lo>=5){
 const nearHi=full.filter(p=>p.v>=hi-1),nearLo=full.filter(p=>p.v<=lo+1),hour=p=>+p.wall.slice(11,13);
 if(!cues.some(c=>c.kind==='falling')&&nearHi.every(p=>hour(p)<9||hour(p)>=21))cues.push({kind:'oddHigh',label:nearHi.every(p=>hour(p)<9)?'High early':'High at night',text:'The hourly calendar-day high occurs outside the usual daytime heating window.'});
 if(nearLo.every(p=>hour(p)>=10&&hour(p)<21))cues.push({kind:'oddLow',label:'Low late',text:'The hourly calendar-day low occurs during the day or evening, not early morning.'});}}
 return cues;
}
const api={periods,timing,add,nwsMorning,focus,temperaturePattern};if(typeof module==='object'&&module.exports)module.exports=api;else root.ForecastClock=api;})(typeof globalThis!=='undefined'?globalThis:this);
