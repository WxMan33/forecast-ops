/* Read-only forecast diagnostics. Coverage and agreement are separate, not skill probabilities.
   Each ensemble is one system; its complete members' mean is used only to compare systems.
   Forecast values, weights, hazard thresholds and verification records are never modified. */
(function(root){
'use strict';
const H=3600e3, fin=Number.isFinite;
const FIELDS=[['temp','Temperature','temperature_2m'],['rain','Rain amount','precipitation'],['pop','Rain chance','precipitation_probability'],['gust','Gusts','wind_gusts_10m']];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=(ms,tz)=>fin(ms)?new Date(ms).toLocaleString('en-US',{timeZone:tz,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Unknown';
const age=(ms,now)=>!fin(ms)?'unknown':now-ms<60e3?'less than a minute ago':now-ms<H?`${Math.floor((now-ms)/60e3)} min ago`:`${((now-ms)/H).toFixed(1)} h ago`;
function analyze({C,B,requested={},rules=null,start,end,now=Date.now(),names={},meta={},nws=null}){
 const hours=[];
 if(fin(start)&&fin(end)&&end>start)for(let m=Math.floor(start/H)*H;m<end&&hours.length<24*14;m+=H)hours.push(m);
 const ix=new Map((B.ms||[]).map((m,i)=>[m,i])), weightData={...B,ms:hours}, models=B.models||{};
 const fields=FIELDS.map(([key,label,v])=>{
  const sources=[];
  for(const id of Object.keys(requested)){
   // Ensembles only supply the fields requested from that endpoint. Unsupported fields are not missing forecasts.
   const ensembleSpec=C.config?.blendEns;
   if(ensembleSpec?.models.some(m=>m.source===id)&&!ensembleSpec.hourly.includes(v))continue;
   const expected=hours.map((m,j)=>C.blend.hourWeight(weightData,requested,rules,id,v,j)>0);
   if(!expected.some(Boolean))continue;
   const md=models[id],members=md?.kind==='ens'?md.members||[]:null;
   const completeMembers=members?.filter(mb=>hours.every((m,j)=>!expected[j]||fin(mb.h?.[v]?.[ix.get(m)])));
   const values=hours.map((m,j)=>{
    if(!expected[j])return null;
    const i=ix.get(m);if(i==null||!md)return null;
    const r=C.blend.sourceValue(md,v,v==='precipitation'?'sum':'max',[i],B);
    return fin(r?.v)?r.v:null;
   });
   const got=values.filter(fin).length,need=expected.filter(Boolean).length;
   const full=got===need&&(!members||(members.length>0&&completeMembers.length===members.length));
   const comparable=got===hours.length&&need===hours.length&&(!members||completeMembers.length>0);
   const agreedValues=comparable&&members?hours.map(m=>completeMembers.reduce((sum,mb)=>sum+mb.h[v][ix.get(m)],0)/completeMembers.length):values;
   sources.push({id,name:names[id]||id,got,need,full,comparable,values:agreedValues,memberCount:members?.length??null,completeMembers:completeMembers?.length??null,
    timing:!!md&&md.kind!=='nws',state:!md?'Unavailable':!got?'Does not cover these hours':full?'Complete':'Partial'});
  }
  const complete=sources.filter(s=>s.comparable),counts=hours.map((m,j)=>sources.filter(s=>fin(s.values[j])).length);
  let agreement='Unavailable',detail='At least two complete source systems are needed.';
  if(key!=='rain'&&complete.length>=2){
   const spread=Math.max(...hours.map((m,j)=>Math.max(...complete.map(s=>s.values[j]))-Math.min(...complete.map(s=>s.values[j]))));
   agreement=`Up to ${Math.ceil(spread)}${key==='temp'?'°F':key==='pop'?' percentage points':' mph'} apart`;
   detail=`Largest same-hour difference across ${complete.length} complete source systems.`;
  }
  if(key==='rain'){
   const eligible=complete.filter(s=>s.timing),wet=eligible.filter(s=>s.values.some(v=>v>=0.01));
   if(eligible.length>=2){
    if(!wet.length){agreement='No ≥0.01″ hourly signal';detail=`None of ${eligible.length} complete systems reaches 0.01″ in an hour. Smaller amounts or rain chances may remain.`;}
    else if(wet.length<2){agreement='Sources differ on rain';detail=`${wet.length} of ${eligible.length} complete systems reaches 0.01″ in an hour; timing agreement is unavailable.`;}
    else {const starts=wet.map(s=>hours[s.values.findIndex(v=>v>=0.01)]),span=(Math.max(...starts)-Math.min(...starts))/H;
     agreement=span===0?'First wet hour aligns':`First wet hours span ${span} h`;
     detail=`${wet.length} of ${eligible.length} complete systems reaches 0.01″ in an hour${wet.length<eligible.length?'; others stay below that amount':''}. First wet hour in this window, not necessarily storm onset.`;}
   }
   detail+=' NWS interval totals are excluded from this hourly timing comparison.';
  }
  return {key,label,sources,full:sources.filter(s=>s.full).length,total:sources.length,min:counts.length?Math.min(...counts):0,max:counts.length?Math.max(...counts):0,agreement,detail};
 });
 const truncated=hours.length>0&&hours.at(-1)+H<end;
 const any=fields.some(f=>f.max>0),good=!truncated&&any&&fields.every(f=>f.total>=2&&f.full===f.total);
 const ids=[...new Set(fields.flatMap(f=>f.sources.filter(s=>s.got).map(s=>s.id)))];
 const freshness=ids.map(id=>{
  const md=models[id],part=id==='nws'?nws?.parts?.grid:null;
  const retrieved=id==='nws'?Date.parse(part?.__retrievedAt):Date.parse(md.retrievedAt);
  const fromCache=id==='nws'?!!part?.__fromCache:!!md.fromCache;
  const mt=meta[id],providerRun=Date.parse(mt?.lastRunInit),cycle=Date.parse(md.provenance?.cycle);
  // This is only a metadata screening cue, never a claim that the forecast response is from that run.
  const delayed=fin(providerRun)&&fin(mt?.updateIntervalH)&&mt.updateIntervalH>0&&now-providerRun>2*mt.updateIntervalH*H;
  return {id,name:names[id]||id,retrieved,fromCache,cycle,providerRun,delayed};
 });
 const times=freshness.map(f=>f.retrieved).filter(fin),oldest=times.length?Math.min(...times):null,saved=freshness.filter(f=>f.fromCache&&fin(f.retrieved)&&now-f.retrieved>60e3).length;
 return {start,end,hours,truncated,now,tz:B.tz||'UTC',status:good?'Good coverage':any?'Limited coverage':'Unavailable',fields,freshness,oldest,saved,
  freshnessText:!any?'No guidance in this window':`${saved?`${saved} saved ${saved===1?'source':'sources'} · `:''}${fin(oldest)?`Oldest retrieval ${age(oldest,now)}`:'Retrieval time unavailable'}${freshness.some(f=>!fin(f.retrieved))?' · some retrieval times unknown':''}${freshness.some(f=>f.delayed)?' · older provider run metadata':''}`};
}
function html(d,{compact=false}={}){
 const summary=`${d.status} · ${d.freshnessText}`;
 if(compact)return `<div class="fs-print"><b>Guidance support:</b> ${esc(summary)}.<br>${d.fields.map(f=>`${esc(f.label)}: ${esc(f.agreement)}`).join(' · ')}. Coverage is not forecast confidence.</div>`;
 return `<section class="forecast-support" data-support="${esc(d.status)}" aria-label="Forecast guidance support">
 <div class="fs-heading"><h3>Guidance support</h3><b class="fs-status">${esc(d.status)}</b></div>
 <p class="fs-window">${d.end>d.start?`${esc(stamp(d.start,d.tz))} – ${esc(stamp(d.end,d.tz))}`:'No remaining planning hours'}${d.truncated?' · First 14 days checked; remaining hours unassessed':''}</p>
 <div class="fs-metrics">${d.fields.map(f=>`<div><span>${esc(f.key==='rain'?'Rain timing':f.label)}</span><b>${esc(f.agreement)}</b><small>${f.full} of ${f.total} sources complete</small></div>`).join('')}</div>
 <p class="fs-freshness">${esc(d.freshnessText)}${fin(d.oldest)?` · ${esc(stamp(d.oldest,d.tz))}`:''}</p>
 <details><summary>Coverage, agreement and source times</summary><p>Coverage describes available data, not verified forecast skill. Agreement compares source systems; ensembles count once using complete members’ means, so member spread can be wider. Retrieval time is when this browser downloaded guidance, not its issue time.</p>
 ${d.fields.map(f=>`<p><b>${esc(f.key==='rain'?'Rain timing':f.label)}:</b> ${esc(f.detail)} ${f.min}–${f.max} sources per hour.</p>`).join('')}
 <ul class="fs-source-list">${[...new Set(d.fields.flatMap(f=>f.sources.map(s=>s.id)))].map(id=>{const f=d.freshness.find(x=>x.id===id);return `<li><b>${esc(d.fields.flatMap(x=>x.sources).find(s=>s.id===id).name)}</b><span>${d.fields.map(x=>{const s=x.sources.find(s=>s.id===id);return s?`${x.label}: ${s.got}/${s.need} hours${s.memberCount!==null?`, ${s.completeMembers}/${s.memberCount} complete members`:''}`:null}).filter(Boolean).map(esc).join(' · ')}</span><span>${f?`Retrieved ${esc(stamp(f.retrieved,d.tz))}${f.fromCache?' · saved copy':''}${fin(f.cycle)?` · Confirmed run ${esc(stamp(f.cycle,d.tz))}`:fin(f.providerRun)?` · Provider latest run ${esc(stamp(f.providerRun,d.tz))} (not confirmed for this response)`:' · Run time unknown'}${f.delayed?' · Provider metadata older than two update intervals':''}`:'Unavailable for this window'}</span></li>`}).join('')}</ul></details></section>`;
}
const api={analyze,html,stamp};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ForecastSupport=api;
})(typeof globalThis!=='undefined'?globalThis:this);
