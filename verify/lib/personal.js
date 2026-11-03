/* Append-only personal forecasts: issue time and original bytes come from the first Git commit.
   Browser timestamps are descriptive only. Unknown provenance or later edits cannot enter scores. */
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),U=require('./util'),TG=require('./targets'),ED=require('./editions'),TM=require('./timing'),M=require('../../assets/my-forecast-core');
function files(dir){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.json')?[path.join(dir,e.name)]:[]);}
function provenance(DATA,rel){
 const git=(args)=>cp.execFileSync('git',['-C',DATA,...args],{encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','ignore']}).trim();
 try {if(git(['rev-parse','--is-shallow-repository'])!=='false')return {error:'Full repository history required to establish issue time.'};
 const commits=git(['log','--no-renames','--diff-filter=A','--format=%H','--',rel]).split('\n').filter(Boolean),commit=commits.at(-1);if(!commit)return {error:'Not committed yet; no authoritative issue time.'};
 const original=cp.execFileSync('git',['-C',DATA,'show',commit+':'+rel],{maxBuffer:4e6,stdio:['ignore','pipe','ignore']}),current=fs.existsSync(path.join(DATA,rel))?fs.readFileSync(path.join(DATA,rel)):null;
 if(!current||!original.equals(current))return {error:'Saved forecast was modified after its first commit; excluded from scoring.',commit,issuedAt:git(['show','-s','--format=%cI',commit]),originalRecord:JSON.parse(original.toString()),tampered:true};
 return {commit,issuedAt:git(['show','-s','--format=%cI',commit]),sha256:U.sha256(original)};
 }catch(e){return {error:'Git provenance unavailable; excluded from scoring.'};}
}
function load(DATA,loc,nowMs=Date.now()){
 const entries=[],cases=[],caps=U.readJSONL(path.join(DATA,'captures',loc.id+'.jsonl'));
 const paths=new Set(files(path.join(DATA,'personal-forecasts',loc.id)).map(f=>path.relative(DATA,f).split(path.sep).join('/')));
 try{const history=cp.execFileSync('git',['-C',DATA,'log','--no-renames','--diff-filter=A','--format=','--name-only','--','personal-forecasts/'+loc.id],{encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','ignore']});history.split('\n').filter(p=>p.startsWith('personal-forecasts/'+loc.id+'/')&&p.endsWith('.json')&&!p.includes('..')).forEach(p=>paths.add(p));}catch(e){/* provenance errors on current files remain explicit */}
 for(const rel of paths){let r;const p=provenance(DATA,rel);
 try{r=p.originalRecord||JSON.parse(fs.readFileSync(path.join(DATA,rel)));}catch(e){entries.push({path:rel,status:'invalid',errors:['Invalid JSON or deleted unverified file.']});continue;}
 const issued=Date.parse(p.issuedAt),errors=M.validate(r,issued,loc.lstOffsetMin);
 if(p.error)errors.push(p.error);if(rel!=='personal-forecasts/'+loc.id+'/'+r.id+'.json')errors.push('Forecast ID must match its unique file name.');if(issued>nowMs+60000)errors.push('Issue commit is in the future.');
 let cap,b,blend;
 try{cap=caps.find(c=>c.captureId===r.basis.captureId);const rel=r.basis.bundle;if(!cap||!rel.startsWith('normalized/'+loc.id+'/')||rel.includes('..'))throw Error();b=JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA,rel))).toString());blend=b.blends[r.basis.recipeId];if(!blend||blend.configHash!==r.basis.hash||b.version!==r.basis.normalizer||b.captureId!==cap.captureId||Date.parse(b.retrieval.last)>issued)throw Error();}catch(e){errors.push('Starting blend snapshot could not be verified.');}
 const e={...r,path:rel,issuedAt:p.issuedAt||null,commit:p.commit||null,sha256:p.sha256||null,status:errors.length?'excluded':'accepted',errors,tampered:!!p.tampered};entries.push(e);
 const localDate=Number.isFinite(issued)?U.localParts(issued,loc.tz).date:null;
 const tl=ED.lateness(p.issuedAt,cap?.slotTarget),sameDate=!!cap&&localDate===cap.localDate;
 e.timeliness=cap&&ED.isEdition(cap)&&sameDate?tl.status:'personal';
 e.slot=cap&&ED.isEdition(cap)&&sameDate?cap.slot:'personal';
 e.edition=cap&&ED.isEdition(cap)&&sameDate?ED.editionId(cap):null;
 if(errors.length)continue;
 e.baseRetrievedAt=b.retrieval.last;
 r.days.forEach(d=>Object.entries(M.targets).forEach(([key,target])=>{if(d[key]==null)return;const win=TG.TARGETS[target].window(d.date,loc);cases.push({track:'personal',id:'my-forecast',submissionId:r.id,captureId:cap.captureId,slot:e.slot,edition:e.edition,target,date:d.date,lead:TG.leadDay(localDate,d.date),v:d[key],retrievedLast:p.issuedAt,issuedAt:p.issuedAt,leadHours:(win[0]-issued)/3600000,normVersion:b.version,basis:r.basis,baseValue:blend.values?.[target]?.[d.date]?.v??null,baseRetrievedAt:b.retrieval.last,commit:p.commit,file:rel,flags:['personal forecast','issue time: first Git commit'],cls:e.timeliness==='on_time'?'eligible':'personal'});}));
 }
 /* Earliest accepted, on-time submission per edition is the scored version. Later saves remain
    immutable revisions. Never choose the best revision after observations arrive. */
 const first=new Map();entries.filter(e=>(e.status==='accepted'||e.tampered)&&e.timeliness==='on_time').sort((a,b)=>a.issuedAt.localeCompare(b.issuedAt)||a.id.localeCompare(b.id)).forEach(e=>{if(!first.has(e.edition))first.set(e.edition,e.id);});
 cases.forEach(c=>{if(c.cls==='eligible')c.cls=first.get(c.edition)===c.submissionId?'primary':'revision';});
 entries.forEach(e=>{e.scoringClass=e.status!=='accepted'?'excluded':e.timeliness!=='on_time'?'personal':first.get(e.edition)===e.id?'primary':'revision';});
 return {version:M.VERSION,entries,cases};
}
function score(personal,best,loc,nowMs){const pairs=[],pending=[];personal.cases.forEach(c=>{const w=TG.TARGETS[c.target].window(c.date,loc);if(!TM.windowOk(w[0],Date.parse(c.issuedAt)))return;const o=best.get(c.target+'|'+c.date);if(o)pairs.push({...c,o:o.value,obsSrc:o.src,obsStatus:o.status,obsRevised:o.revised});else pending.push({...c,status:w[1]>nowMs?'future':'waiting for observation'});});return {pairs,pending};}
module.exports={load,score,provenance};
