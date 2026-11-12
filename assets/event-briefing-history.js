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
 if(wet.length&&!wasWet.length)out.items.push({kind:'rain-window',priority:p.key==='gates'?3:4,phase:p.key,text:`Rain now reaches ${phase}. The previous briefing had no hourly rain signal during ${phase}.`});
 const wind=hours.filter(h=>finite(h.old.gust)&&finite(h.now.gust)&&h.old.gustSources===h.now.gustSources);
 if(wind.length&&Math.max(...wind.map(h=>h.old.gust))<now.gust&&Math.max(...wind.map(h=>h.now.gust))>=now.gust)out.items.push({kind:'gust-limit',priority:1,phase:p.key,text:`Gusts now reach your ${now.gust} mph venue limit during ${phase}; they were below it in the previous briefing.`});
 const lightning=hours.filter(h=>h.old.lightning!==null&&h.now.lightning!==null&&h.old.lightningSources===h.now.lightningSources);
 if(lightning.length){const prev=Math.max(...lightning.map(h=>h.old.lightning)),next=Math.max(...lightning.map(h=>h.now.lightning));if(next>prev&&next>=1)out.items.push({kind:'lightning',priority:2,phase:p.key,text:`Lightning potential during ${phase} is now ${['Low','Moderate','High'][next]}, up from ${['Low','Moderate','High'][prev]}. This is forecast potential, not detected lightning.`})}
 const pops=hours.filter(h=>finite(h.old.pop)&&finite(h.now.pop)&&h.old.popSources===h.now.popSources);
 if(pops.length&&!wet.length){const prev=Math.max(...pops.map(h=>h.old.pop)),next=Math.max(...pops.map(h=>h.now.pop));if(next-prev>=15)out.items.push({kind:'rain-chance',priority:5,phase:p.key,text:`The peak hourly rain chance during ${phase} rose from ${percent(prev)} to ${percent(next)}.`})}
 }
 out.items.sort((a,b)=>a.priority-b.priority);out.items=out.items.slice(0,3);out.state=out.items.length?'changed':paired?'same':'no-overlap';return out;
}
function visit(storage,id,current){
 let all={};try{const raw=JSON.parse(storage.getItem(KEY)||'{}');if(raw&&typeof raw==='object'&&!Array.isArray(raw))all=raw}catch{}
 const valid=Object.fromEntries(Object.entries(all).filter(([k,v])=>k.length<350&&v?.version===1&&finite(v.at)&&current.at-v.at<30*864e5));
 const result=compare(valid[id],current);result.stored=true;
 if(current.hours.some(h=>h.ok)){valid[id]=current;const keep=Object.entries(valid).sort((a,b)=>b[1].at-a[1].at).slice(0,25);try{storage.setItem(KEY,JSON.stringify(Object.fromEntries(keep)))}catch{result.stored=false}}
 return result;
}
const api={KEY,snapshot,compare,visit};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.EventBriefingHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
