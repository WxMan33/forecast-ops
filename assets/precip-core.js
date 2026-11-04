/* CVG precipitation verification. Exact common cases; unknown is never dry. */
(function(root){'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x),mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null,ratio=(a,b)=>b?a/b:null;
function select(pairs,{members,kind='amount',slot='midday',lead=1,from='',through='',includeProrated=false}){
 const target=kind==='probability'?'pop01_clim':'precip_clim',cases=new Map(),excluded={};
 const skip=why=>{excluded[why]=(excluded[why]||0)+1;};
 for(const p of pairs){if(!members.includes(p.id)||p.target!==target||p.slot!==slot||p.lead!==+lead||(from&&p.date<from)||(through&&p.date>through))continue;
 if(p.cls!=='primary'){skip('non-primary');continue;}
 if(!finite(p.v)||!finite(p.o)||p.v<0||p.o<0){skip('invalid or missing');continue;}
 const personal=p.track==='personal'||p.id==='my-forecast';
 if(p.period!=='climate-day-LST'||!Array.isArray(p.window)||p.window.length!==2||!p.window.every(finite)||(!personal&&!p.normVersion)){skip('unknown window or method');continue;}
 if(personal&&p.compatible===false){skip('target definition changed since submission');continue;}
 if(kind==='probability'&&(p.thresholdIn!==.01||p.v>1||![0,1].includes(p.o)||p.probabilityMethod!=='ensemble-frequency')){skip('incompatible probability');continue;}
 if(!includeProrated&&(p.flags||[]).includes('nws-prorated')){skip('prorated NWS timing');continue;}
 /* personal forecasts keep their starting snapshot version as provenance only; archive forecasts in one case must share a normalizer version (checked below) */
 const k=[p.captureId,p.target,p.date,p.period,p.window.join('/')].join('|');if(!cases.has(k))cases.set(k,new Map());const c=cases.get(k);c.set(p.id,c.has(p.id)?null:p);
 }
 const isP=p=>p.track==='personal'||p.id==='my-forecast';
 const rows=[...cases.values()].filter(c=>members.length&&members.every(id=>c.get(id))&&new Set(members.map(id=>c.get(id).o)).size===1).filter(c=>{const ok=new Set(members.map(id=>c.get(id)).filter(p=>!isP(p)).map(p=>p.normVersion)).size<=1;if(!ok)skip('mixed normalizer versions');return ok;});
 const dates=[...new Set(rows.map(c=>c.get(members[0]).date))],blocks=new Set(dates.map(d=>Math.floor(Date.parse(d+'T00:00:00Z')/(7*86400000))));
 const scores=members.map(id=>{const a=rows.map(c=>c.get(id)),errs=a.map(p=>p.v-p.o),leads=a.map(p=>p.leadHours).filter(finite);const out={id,n:a.length,leadMin:leads.length?Math.min(...leads):null,leadMax:leads.length?Math.max(...leads):null,prorated:a.filter(p=>(p.flags||[]).includes('nws-prorated')).length};
 if(kind==='amount'){const hits=a.filter(p=>p.v>=.01&&p.o>=.01).length,misses=a.filter(p=>p.v<.01&&p.o>=.01).length,falseAlarms=a.filter(p=>p.v>=.01&&p.o<.01).length,correctDry=a.filter(p=>p.v<.01&&p.o<.01).length;return {...out,mae:mean(errs.map(Math.abs)),bias:mean(errs),sumForecast:a.reduce((s,p)=>s+p.v,0),sumObserved:a.reduce((s,p)=>s+p.o,0),hits,misses,falseAlarms,correctDry,pod:ratio(hits,hits+misses),far:ratio(falseAlarms,hits+falseAlarms),frequencyBias:ratio(hits+falseAlarms,hits+misses)};}
 const bins=Array.from({length:10},(_,i)=>({lo:i/10,hi:(i+1)/10,n:0,sumP:0,sumO:0}));a.forEach(p=>{const b=bins[Math.min(9,Math.floor(p.v*10))];b.n++;b.sumP+=p.v;b.sumO+=p.o;});return {...out,brier:mean(errs.map(x=>x*x)),baseRate:mean(a.map(p=>p.o)),wet:a.filter(p=>p.o===1).length,bins:bins.map(b=>({...b,forecast:b.n?b.sumP/b.n:null,observed:b.n?b.sumO/b.n:null}))};
 });
 return {n:rows.length,dates:dates.length,blocks:blocks.size,from:dates.sort()[0]||null,through:dates.at(-1)||null,scores,excluded,rows:rows.map(c=>members.map(id=>c.get(id)))};
}
const api={select};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PrecipCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
