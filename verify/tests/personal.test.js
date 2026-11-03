'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),zlib=require('zlib');
const M=require('../../assets/my-forecast-core'),P=require('../lib/personal'),S=require('../lib/score'),loc=require('../config/locations').CVG;
const t=Date.parse('2026-11-03T17:05:00Z'),id='00000000-0000-4000-8000-000000000001';
const basis={captureId:'2026-11-03_midday',recipeId:'baseline-v1',hash:'hash',bundle:'normalized/CVG/2026/2026-11-03_midday.normalize-v4.json.gz',normalizer:'normalize-v4',retrievedAt:'2026-11-03T17:00:01Z'};
const make=()=>({schema:1,method:M.VERSION,id,location:'CVG',basis,note:'Cooler than blend',days:[{date:'2026-11-04',lo:40,hi:60,precip:0}]});
assert.deepEqual(M.validate(make(),t),[]);
for(const mutate of [r=>r.days[0].lo=61,r=>r.days[0].precip=-1,r=>r.days[0].hi=NaN,r=>r.days[0].date='2026-02-30',r=>r.days[0].date='2026-13-99',r=>r.days.push({...r.days[0]}),r=>r.days[0]=null,r=>r.days[0].date='2026-11-03']){const r=make();mutate(r);assert(M.validate(r,t).length);}
assert(M.validate({...make(),days:[{date:'2026-11-04',hi:null,lo:null,precip:null}]},t).length);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'personal-forecast-'));
const git=(args,date='2026-11-03T17:05:00Z')=>cp.execFileSync('git',['-C',dir,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date},stdio:['ignore','pipe','pipe']});
const put=(file,x)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),JSON.stringify(x)+'\n');};
try{
 git(['init','-q']);git(['config','user.name','Synthetic test']);git(['config','user.email','synthetic@example.invalid']);
 put('captures/CVG.jsonl',{captureId:basis.captureId,edition:basis.captureId,localDate:'2026-11-03',slot:'midday',trigger:'scheduled',slotTarget:'2026-11-03T17:00:00Z'});
 const bundle={captureId:basis.captureId,version:basis.normalizer,retrieval:{last:basis.retrievedAt},hourly:{t0:t,stepMs:3600000,n:0,temperature_2m:{}},sources:{},blends:{'baseline-v1':{configHash:'hash',values:{tmax_clim:{'2026-11-04':{v:62}}}}}};
 fs.mkdirSync(path.dirname(path.join(dir,basis.bundle)),{recursive:true});fs.writeFileSync(path.join(dir,basis.bundle),zlib.gzipSync(JSON.stringify(bundle)));
 const file='personal-forecasts/CVG/'+id+'.json';put(file,make());git(['add','.']);git(['commit','-qm','first synthetic forecast']);
 let p=P.load(dir,loc,t+60000);assert.equal(p.entries[0].status,'accepted');assert.equal(p.entries[0].scoringClass,'primary');assert.equal(Date.parse(p.entries[0].issuedAt),t);assert.equal(p.cases.length,3);assert.equal(p.cases.find(x=>x.target==='precip_clim').v,0);
 const best=new Map([['tmax_clim|2026-11-04',{value:59,src:'synthetic CLI'}]]);const scored=P.score(p,best,loc,t+86400000);assert.equal(scored.pairs[0].v,60);assert.equal(scored.pairs[0].o,59);assert.equal(scored.pending.length,2);
 let r=make();r.id='00000000-0000-4000-8000-000000000002';r.days[0].hi=59;put('personal-forecasts/CVG/'+r.id+'.json',r);git(['add','.']);git(['commit','-qm','synthetic revision'],'2026-11-03T17:06:00Z');p=P.load(dir,loc,t+120000);assert.equal(p.entries.find(e=>e.id===r.id).scoringClass,'revision',JSON.stringify(p.entries.find(e=>e.id===r.id))); assert.equal(p.cases.filter(c=>c.cls==='primary').length,3);
 r=make();r.id='00000000-0000-4000-8000-000000000003';put('personal-forecasts/CVG/'+r.id+'.json',r);git(['add','.']);git(['commit','-qm','synthetic outside window'],'2026-11-03T18:00:00Z');p=P.load(dir,loc,t+7200000);assert.equal(p.entries.find(e=>e.id===r.id).scoringClass,'personal');
 r=make();r.days[0].hi=99;put(file,r);p=P.load(dir,loc,t+7200000);assert.equal(p.entries.find(e=>e.id===id).status,'excluded','edits cannot replace issued values');assert.equal(p.cases.filter(c=>c.cls==='primary').length,0,'a revision must never be promoted after original tampering');
 r=make();r.id='00000000-0000-4000-8000-000000000004';r.basis={...basis,hash:'wrong'};put('personal-forecasts/CVG/'+r.id+'.json',r);git(['add','.']);git(['commit','-qm','bad basis'],'2026-11-03T18:01:00Z');p=P.load(dir,loc,t+7200000);assert.equal(p.entries.find(e=>e.id===r.id).status,'excluded');
 fs.unlinkSync(path.join(dir,file));p=P.load(dir,loc,t+7200000);assert.equal(p.entries.find(e=>e.id===id).status,'excluded');assert.equal(p.cases.filter(c=>c.cls==='primary').length,0,'deleting an original cannot promote a revision');assert.doesNotThrow(()=>S.scoreAll(dir,loc,t+7200000));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('Personal forecast: validation, Git issue times, revisions, late updates, zero/missing, tampering and scorer integration passed.');
