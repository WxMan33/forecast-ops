/* Pure dashboard joins. Null is not zero; only selected on-time scheduled cases enter scores. */
(function(root){
  "use strict";
  const finite=x=>typeof x==="number" && Number.isFinite(x);
  const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  /* Join key: same capture, target, valid date/hour, and the same target definition (convention and
     exact UTC window). Personal forecasts keep their starting snapshot's normalizer only as provenance;
     the compared archive forecasts must all come from ONE normalizer version, and a personal case is
     used only while its definition is still compatible. Version mixes are excluded, never merged. */
  const defKey=p=>p.target?[p.conv||"",Array.isArray(p.window)?p.window.join("/"):""].join("@"):"hourly";
  /* One method per kind: archive model/blend forecasts must share one normalizer version, and TV products (never
     normalized; their method is the TV extraction version) must share one extraction version. A case mixing versions
     within either kind is excluded. Without TV members this is exactly the single-normalizer rule. */
  const sameMethod=(c,members)=>{const ps=members.map(id=>c.get(id)).filter(p=>p.track!=="personal"&&p.id!=="my-forecast"),kind=p=>p.track==="tv"?"tv":"model";const ok=["model","tv"].every(k=>new Set(ps.filter(p=>kind(p)===k).map(p=>p.normVersion||"unknown")).size<=1);return ok&&members.every(id=>{const p=c.get(id);return (p.track!=="personal"&&p.id!=="my-forecast")||p.compatible!==false;});};
  function matched(pairs,options){
    const {members,target,slot,lead,captureId}=options;
    if(!members || members.length<2)return {n:0,dates:0,hours:0,rows:[],scores:[],reason:"Select at least two sources for matching."};
    const cases=new Map();
    pairs.filter(p=>p.cls==="primary" && members.includes(p.id) && (!target || p.target===target) && (!slot || p.slot===slot) && (lead==null || p.lead===+lead) && (!captureId || p.captureId===captureId) && finite(p.v) && finite(p.o)).forEach(p=>{
      const key=[p.captureId,p.target || "hourly",(p.target ? p.date : p.valid),defKey(p)].join("|");
      if(!cases.has(key))cases.set(key,new Map());const c=cases.get(key);
      // Repeated/ambiguous cases are excluded, not silently given additional weight.
      c.set(p.id,c.has(p.id)?null:p);
    });
    let methodMismatch=0;
    /* every case that did not enter, by the first rule that excluded it (additive detail; the rules are unchanged) */
    const excluded={missingSource:0,duplicate:0,observationDiffers:0,methodMismatch:0},onlyMissing={};
    [...cases.values()].forEach(c=>{const absent=members.filter(id=>!c.has(id));
      if(absent.length){excluded.missingSource++;if(absent.length===1)onlyMissing[absent[0]]=(onlyMissing[absent[0]]||0)+1;return;}
      if(members.some(id=>c.get(id)===null)){excluded.duplicate++;return;}
      if(new Set(members.map(id=>c.get(id).o)).size!==1)excluded.observationDiffers++;});
    const rows=[...cases.values()].filter(c=>members.every(id=>c.get(id)) && new Set(members.map(id=>c.get(id).o)).size===1).filter(c=>{const ok=sameMethod(c,members);if(!ok)methodMismatch++;return ok;});
    excluded.methodMismatch=methodMismatch;
    const dates=new Set(rows.map(c=>c.get(members[0]).date || String(c.get(members[0]).valid).slice(0,10)));
    const sortedDates=[...dates].sort();
    const hours=new Set(rows.map(c=>c.get(members[0]).valid).filter(Boolean));
    const blocks=new Set([...dates].map(d=>Math.floor(Date.parse(d+"T00:00:00Z")/(7*86400e3))));
    const scores=members.map(id=>{const ps=rows.map(c=>c.get(id)),e=ps.map(p=>p.v-p.o),leads=ps.map(p=>p.leadHours).filter(finite);return {id,n:ps.length,mae:mean(e.map(Math.abs)),bias:mean(e),within2:mean(e.map(x=>Math.abs(x)<=2?1:0)),leadMin:leads.length?Math.min(...leads):null,leadMax:leads.length?Math.max(...leads):null};});
    return {n:rows.length,dates:dates.size,hours:hours.size,blocks:blocks.size,scores,methodMismatch,reason:rows.length?null:methodMismatch?"Cases exist, but the forecasts were made with incompatible methods or target definitions.":"No common verified cases for this selection.",from:sortedDates[0]||null,to:sortedDates[sortedDates.length-1]||null,candidates:cases.size,excluded,onlyMissing};
  }
  /* Coverage for one source, target and lead over a set of capture attempts (each: captureId, localDate, slot,
     onTime: ids captured on time, tv: {product: status}). Eligible: on-time scheduled captures whose verifying date
     (capture date + lead) has an observation for the target. Attempted: eligible captures where the source was
     captured on time (a TV product: present and not "not-collected"). Delivered: attempted captures with a verified
     pair for that lead. Not attempted is reported, never dropped. Missed scheduled editions are outside this count;
     they come from the collector's schedule (see the scheduled-editions summary). */
  const addDays=(d,n)=>{const t=new Date(d+"T00:00:00Z");t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
  function coverage(attempts,pairs,{id,target,lead,track}){
    const verified=new Set(pairs.filter(p=>p.target===target&&finite(p.o)).map(p=>p.date));
    const have=new Set(pairs.filter(p=>p.id===id&&p.target===target&&p.lead===+lead&&finite(p.v)&&finite(p.o)).map(p=>p.captureId));
    const eligible=attempts.filter(a=>a.onTime&&a.onTime.length&&verified.has(addDays(a.localDate,+lead)));
    /* a delivered forecast proves an attempt (derived sources such as the NWS official text have no capture class) */
    const tried=a=>have.has(a.captureId)||(track==="tv"?!!(a.tv&&a.tv[id]&&a.tv[id]!=="not-collected"):a.onTime.includes(id));
    const attempted=eligible.filter(tried);
    return {eligible:eligible.length,attempted:attempted.length,notAttempted:eligible.length-attempted.length,delivered:attempted.filter(a=>have.has(a.captureId)).length};
  }
  /* scorecard.json rows -> the pair records matched() and coverage() use (the definition window stands for the
     target's window on that date: identical for every source of one case, which is all matching compares) */
  function expandScorecard(sc){
    const caps=sc.attempts,conv=Object.fromEntries(sc.targets.map(t=>[t.id,t.conv]));
    return sc.rows.map(([i,c,t,lead,leadHours,v,o,n])=>{const id=sc.ids[i],cap=caps[c],target=sc.targets[t].id,date=addDays(cap.localDate,lead);
      return {track:sc.tracks[id],conv:conv[target],window:[target,date],compatible:true,basisNormVersion:null,captureId:cap.captureId,id,target,date,lead,leadHours,slot:cap.slot,cls:"primary",v,o,normVersion:sc.norms[n]};});
  }
  function recipeChange(a,b){
    if(!a || !b)return null;
    if(a.target!==b.target || a.date!==b.date || JSON.stringify(a.window)!==JSON.stringify(b.window))return "different valid windows";
    if(a.normVersion!==b.normVersion)return "method changed";
    if(a.hash!==b.hash)return "recipe changed";
    if(a.contributors==null || b.contributors==null)return "coverage comparison unavailable";
    const signature=x=>JSON.stringify(x.slice().sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    return signature(a.contributors)!==signature(b.contributors)?"coverage changed":null;
  }
  function hourlyAt(snapshot,id,valid,minLead=60){
    const h=snapshot.hourly,a=h && h.temperature_2m && h.temperature_2m[id];
    const index=h?(valid-h.t0)/h.stepMs:-1;
    const last=Date.parse(snapshot.retrievedAt);
    if(!a || !Number.isInteger(index) || index<0 || !Number.isFinite(last) || valid<last+minLead*60e3)return null;
    return finite(a[index])?a[index]:null;
  }
  function observationAt(observed,valid,retrievedAt,minLead=60,tolerance=15){
    const last=Date.parse(retrievedAt);
    const found=observed.find(o=>o.valid===valid && finite(o.value) && finite(o.measuredAt) && o.measuredAt<=valid && o.measuredAt>=valid-tolerance*60e3);
    if(!found)return {value:null,reason:"No qualifying observation yet"};
    if(!Number.isFinite(last) || found.measuredAt<last+minLead*60e3)return {value:null,reason:"Observation was too close to capture to verify prospectively",measuredAt:found.measuredAt};
    return found;
  }
  const api={finite,matched,coverage,expandScorecard,addDays,defKey,recipeChange,hourlyAt,observationAt};
  if(typeof module!=="undefined" && module.exports)module.exports=api;else root.VerifyCore=api;
})(typeof globalThis!=="undefined"?globalThis:this);
