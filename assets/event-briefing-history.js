/* Local, bounded briefing history. Compares the same future hours; never changes a forecast or rating. */
(function(root){
'use strict';
const KEY='forecast_ops_briefing_history_v1',H=3600e3,finite=Number.isFinite;
const percent=x=>x>0&&Math.round(x/5)*5===0?'<5%':`${Math.round(x/5)*5}%`;
const identity=(ev,b)=>JSON.stringify([ev.loc.lat,ev.loc.lon,ev.tz,ev.gust||25,b.phases.map(p=>[p.key,p.startMs,p.endMs])]);
function snapshot(ev,b,V,res){
 const row=k=>V.rows.find(r=>r.key===k),sources=(h,key)=>Object.entries(res.ctx.B.models).filter(([id,m])=>(res.ctx.ws[id]||0)>0&&finite(m.h?.[key]?.[h.i??res.ctx.B.ms.indexOf(h.ms)])).map(([id])=>id+':'+res.ctx.C.blend.hourWeight(res.ctx.B,res.ctx.ws,res.ctx.rules,id,key,h.i??res.ctx.B.ms.indexOf(h.ms))).sort().join(','),alerts=(res.alerts||[]).filter(a=>(!a.ends||Date.parse(a.ends)>res.ctx.now)&&(a.ends?Date.parse(a.ends)>b.all.startMs:res.ctx.now>=b.all.startMs&&res.ctx.now<b.all.endMs)&&(!a.starts||Date.parse(a.starts)<b.all.endMs)).map(a=>({event:String(a.event||'NWS alert').slice(0,100),id:String(a.url||a.event||'').slice(0,300),ends:a.ends||null}));
 return {version:1,identity:identity(ev,b),at:res.ctx.now,recipe:JSON.stringify([Object.entries(res.ctx.ws).sort(),res.ctx.rules||null,res.ctx.thRecipe||null]),gust:ev.gust||25,feeds:[...(res.feeds?.used||[])].sort(),readiness:res.readiness||null,alertsAvailable:res.alertsAvailable===true,alerts,
 phases:b.phases.map(p=>({key:p.key,label:p.label,start:p.startMs,end:p.endMs,levels:p.levels})),hours:V.hrs.slice(0,240).map((h,i)=>({ms:h.ms,ok:h.state==='ok',popSources:sources(h,'precipitation_probability'),rainSources:sources(h,'precipitation_probability')+'|'+sources(h,'precipitation'),gustSources:sources(h,'wind_gusts_10m'),lightningSources:(res.ctx.th?.ids||[]).filter(id=>{const t=res.ctx.th.perModel(id,h.ms);return t&&t!=='nodata'}).sort().join(','),pop:finite(h.pop)?h.pop:null,gust:finite(h.gust)?h.gust:null,lightning:row('lightning')?.cells[i]?.state==='missing'?null:({Low:0,Moderate:1,High:2}[row('lightning')?.cells[i]?.text]??null),rain:finite(h.pop)||finite(h.qpf)?['concern','flag'].includes(row('hz-rain')?.cells[i]?.state):null}))};
}
function compare(old,now){
 const out={state:'first',previousAt:old?.at||null,items:[]};
 if(!old||old.version!==1||!Array.isArray(old.hours)||!Array.isArray(old.phases)||!Array.isArray(old.feeds)||!Array.isArray(old.alerts)||old.hours.some(h=>!h||!finite(h.ms)))return out;
 if(old.identity!==now.identity){out.state='event-changed';return out}
 if(!(old.at<now.at)){out.state='same';return out}
 const aKeys=new Set((old.alerts||[]).map(a=>a.id));
 if(old.alertsAvailable&&now.alertsAvailable)for(const a of now.alerts)if(!aKeys.has(a.id))out.items.push({kind:'alert',priority:0,text:`New official NWS alert for this venue: ${a.event}.`});
 if(old.recipe!==now.recipe){out.state='recipe-changed';return out}
 if(JSON.stringify(old.feeds)!==JSON.stringify(now.feeds)){out.state='sources-changed';return out}
 const previous=new Map(old.hours.map(h=>[h.ms,h]));let paired=0;
 for(const p of now.phases){
 const hours=now.hours.filter(h=>h.ms+H>now.at&&h.ms<p.end&&h.ms+H>p.start&&h.ok&&previous.get(h.ms)?.ok).map(h=>({old:previous.get(h.ms),now:h}));if(!hours.length)continue;paired+=hours.filter(h=>(h.old.rain!==null&&h.now.rain!==null&&h.old.rainSources===h.now.rainSources)||(finite(h.old.gust)&&finite(h.now.gust)&&h.old.gustSources===h.now.gustSources)||(h.old.lightning!==null&&h.now.lightning!==null&&h.old.lightningSources===h.now.lightningSources)).length;
 const phase=p.label.toLowerCase(),rain=hours.filter(h=>h.old.rain!==null&&h.now.rain!==null&&h.old.rainSources===h.now.rainSources),wet=rain.filter(h=>h.now.rain),wasWet=rain.filter(h=>h.old.rain);
 if(wet.length&&!wasWet.length)out.items.push({kind:'rain-window',trend:'worse',priority:p.key==='gates'?3:4,phase:p.key});
 /* improvements: the same matching hours, the same contributors, and never from missing guidance */
 if(wasWet.length&&!wet.length)out.items.push({kind:'rain-clear',trend:'better',priority:6,phase:p.key});
 const wind=hours.filter(h=>finite(h.old.gust)&&finite(h.now.gust)&&h.old.gustSources===h.now.gustSources);
 if(wind.length){const was=Math.max(...wind.map(h=>h.old.gust)),is=Math.max(...wind.map(h=>h.now.gust));
 if(was<now.gust&&is>=now.gust)out.items.push({kind:'gust-limit',trend:'worse',priority:1,phase:p.key,from:was,to:is});
 else if(was>=now.gust&&is<now.gust)out.items.push({kind:'gust-below',trend:'better',priority:7,phase:p.key,from:was,to:is})}
 const lightning=hours.filter(h=>h.old.lightning!==null&&h.now.lightning!==null&&h.old.lightningSources===h.now.lightningSources);
 if(lightning.length){const prev=Math.max(...lightning.map(h=>h.old.lightning)),next=Math.max(...lightning.map(h=>h.now.lightning));
 if(next>prev&&next>=1)out.items.push({kind:'lightning',trend:'worse',priority:2,phase:p.key,from:prev,to:next});
 else if(next<prev)out.items.push({kind:'lightning-down',trend:'better',priority:8,phase:p.key,from:prev,to:next})}
 const pops=hours.filter(h=>finite(h.old.pop)&&finite(h.now.pop)&&h.old.popSources===h.now.popSources);
 if(pops.length){const prev=Math.max(...pops.map(h=>h.old.pop)),next=Math.max(...pops.map(h=>h.now.pop));
 if(!wet.length&&next-prev>=15)out.items.push({kind:'rain-chance',trend:'worse',priority:5,phase:p.key,from:prev,to:next});
 else if(!(wasWet.length&&!wet.length)&&prev-next>=15)out.items.push({kind:'rain-chance-down',trend:'better',priority:9,phase:p.key,from:prev,to:next})}
 }
 const W=['Low','Moderate','High'],list=xs=>xs.length<3?xs.join(' and '):xs.slice(0,-1).join(', ')+' and '+xs.at(-1),label=k=>now.phases.find(p=>p.key===k).label.toLowerCase(),r=Math.round;
 /* one line per kind of change: phases joined, worst-case values kept */
 const TEXT={'rain-window':(w)=>`Rain now reaches ${w}. The previous briefing had no hourly rain signal there.`,'rain-clear':(w)=>`Rain no longer reaches ${w}. The previous briefing had an hourly rain signal there; the same hours now show none.`,
 'gust-limit':(w,a,b)=>`Gusts now reach your ${now.gust} mph venue limit during ${w} (peak about ${r(b)} mph, up from ${r(a)} mph).`,'gust-below':(w,a,b)=>`Gusts during ${w} now stay below your ${now.gust} mph venue limit (peak about ${r(b)} mph, down from ${r(a)} mph).`,
 lightning:(w,a,b)=>`Lightning potential during ${w} is now ${W[b]}, up from ${W[a]}. This is forecast potential, not detected lightning.`,'lightning-down':(w,a,b)=>`Lightning potential during ${w} is now ${W[b]}${b===0?' (not zero)':''}, down from ${W[a]}. It is forecast potential, not detected lightning, and never permission to resume; your venue's lightning policy decides.`,
 'rain-chance':(w,a,b)=>`The peak hourly rain chance during ${w} rose from ${percent(a)} to ${percent(b)}.`,'rain-chance-down':(w,a,b)=>`The peak hourly rain chance during ${w} fell from ${percent(a)} to ${percent(b)}.`};
 const merged=[];for(const x of out.items){if(x.kind==='alert'){merged.push(x);continue}const g=merged.find(y=>y.kind===x.kind);if(!g){merged.push({...x,phases:[x.phase]});continue}g.phases.push(x.phase);g.priority=Math.min(g.priority,x.priority);if(finite(x.from)){g.from=Math.max(g.from,x.from);g.to=Math.max(g.to,x.to)}}
 for(const x of merged)if(x.kind!=='alert'){x.text=TEXT[x.kind](list(x.phases.map(label)),x.from,x.to);delete x.phase}
 out.items=merged;
 out.items.sort((a,b)=>a.priority-b.priority);out.better=out.items.filter(x=>x.trend==='better').length;out.items=out.items.slice(0,3);out.state=out.items.length?'changed':paired?'same':'no-overlap';return out;
}
function visit(storage,id,current){
 let all={};try{const raw=JSON.parse(storage.getItem(KEY)||'{}');if(raw&&typeof raw==='object'&&!Array.isArray(raw))all=raw}catch{}
 const valid=Object.fromEntries(Object.entries(all).filter(([k,v])=>k.length<350&&v?.version===1&&finite(v.at)&&current.at-v.at<30*864e5));
 const result=compare(valid[id],current);result.stored=true;
 if(current.hours.some(h=>h.ok)){valid[id]=current;const keep=Object.entries(valid).sort((a,b)=>b[1].at-a[1].at).slice(0,25);try{storage.setItem(KEY,JSON.stringify(Object.fromEntries(keep)))}catch{result.stored=false}}
 return result;
}
const api={KEY,snapshot,compare,visit,percent};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.EventBriefingHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
