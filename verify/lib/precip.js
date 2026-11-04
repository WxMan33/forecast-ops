/* Private daily rainfall projection. Does not renormalize archives or infer PoP from QPF. */
'use strict';
const fs=require('fs'),path=require('path'),U=require('./util'),TG=require('./targets'),TM=require('./timing');
function project(DATA,loc,res,nowMs=Date.now()){
 const pairs=[],excluded={},cache=new Map();const skip=k=>excluded[k]=(excluded[k]||0)+1;
 for(const p of res.pairs||[]){if(p.track==='tv'||p.cls!=='primary'||!['precip_clim','pop01_clim'].includes(p.target))continue;
 if(typeof p.v!=='number'||!Number.isFinite(p.v)||typeof p.o!=='number'||!Number.isFinite(p.o)||p.v<0||p.o<0){skip('missing or invalid');continue;}
 const window=TG.TARGETS[p.target].window(p.date,loc);if(!TM.windowOk(window[0],Date.parse(p.retrievedLast))){skip('insufficient issue lead');continue;}
 let value=null,bundle=null;
 if(p.track!=='personal'){
  const file=`normalized/${loc.id}/${p.captureId.slice(0,4)}/${p.captureId}.${p.normVersion}.json.gz`;
  if(!/^[\w-]+$/.test(p.captureId)||!/^normalize-v\d+$/.test(p.normVersion)){skip('unknown archive path');continue;}
  if(!cache.has(file)){try{cache.set(file,JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA,file))).toString()));}catch(e){cache.set(file,null);}}
  bundle=cache.get(file);value=p.track==='blend'?bundle?.blends?.[p.id]?.values?.[p.target]?.[p.date]:bundle?.sources?.[p.id]?.[p.target]?.[p.date];
 }
 let probabilityMethod=null;
 if(p.target==='pop01_clim'){
  const supported=value&&Number.isInteger(value.n)&&value.n>0&&(p.track==='source'||value.note==='ensemble members only');
  if(!supported||p.v>1||![0,1].includes(p.o)||(p.flags||[]).some(f=>/period-unspecified|nws-period-pop/.test(f))){skip('incompatible or undocumented probability');continue;}probabilityMethod='ensemble-frequency';
 }
 pairs.push({captureId:p.captureId,id:p.track==='blend'?'blend:'+p.id:p.id,target:p.target,date:p.date,slot:p.slot,lead:p.lead,leadHours:p.leadHours,cls:p.cls,v:p.v,o:p.o,period:'climate-day-LST',window,thresholdIn:p.target==='pop01_clim'?.01:null,probabilityMethod,flags:p.flags||[],normVersion:p.normVersion,issuedAt:p.retrievedLast,obsSrc:p.obsSrc,obsStatus:p.obsStatus,obsRevised:!!p.obsRevised,configHash:bundle?.blends?.[p.id]?.configHash||null,bounds:value?.bounds||value?.range||null,submissionId:p.submissionId||null});
 }
 return {schema:1,version:'precip-verification-v1',at:U.iso(nowMs),loc,minDates:res.minDates||30,wetThresholdIn:.01,period:'climate-day-LST',pairs,excluded,pendingCount:(res.pending||[]).filter(p=>['precip_clim','pop01_clim'].includes(p.target)).length};
}
function write(DATA,loc,res,nowMs){const out=project(DATA,loc,res,nowMs);U.writeJSON(path.join(DATA,'reports/precip.json'),out);return out;}
module.exports={project,write};
