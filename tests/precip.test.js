'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib');
const C=require('../assets/precip-core'),P=require('../verify/lib/precip'),loc=require('../verify/config/locations').CVG;
const base={captureId:'edition',cls:'primary',target:'precip_clim',slot:'midday',lead:1,date:'2026-11-04',period:'climate-day-LST',window:[1,2],normVersion:'normalize-v4',leadHours:12};
const a=[0,.2,0,.3],o=[0,.1,.2,0],pairs=a.flatMap((v,i)=>['a','b'].map(id=>({...base,captureId:'c'+i,date:'2026-11-'+String(i+4).padStart(2,'0'),id,v:id==='a'?v:o[i],o:o[i]})));
let r=C.select(pairs,{members:['a','b']});assert.equal(r.n,4);assert.equal(r.dates,4);assert.equal(r.scores[0].hits,1);assert.equal(r.scores[0].misses,1);assert.equal(r.scores[0].falseAlarms,1);assert.equal(r.scores[0].correctDry,1);assert.equal(r.scores[0].pod,.5);assert.equal(r.scores[0].far,.5);assert.equal(r.scores[0].frequencyBias,1);assert(Math.abs(r.scores[0].bias-.05)<1e-8);assert.equal(r.scores[1].mae,0);
assert.equal(C.select(pairs.concat({...pairs[0],cls:'pilot'}),{members:['a','b']}).n,4);
assert.equal(C.select(pairs.concat(pairs[0]),{members:['a','b']}).n,3,'duplicate excludes case');
assert.equal(C.select([{...base,id:'a',v:0,o:0},{...base,id:'b',v:0,o:0,window:[2,3]}],{members:['a','b']}).n,0);
let dry=C.select([{...base,id:'a',v:0,o:0}],{members:['a']});assert.equal(dry.scores[0].pod,null);assert.equal(dry.scores[0].far,null);assert.equal(dry.scores[0].frequencyBias,null);
assert.equal(C.select([{...base,id:'a',v:null,o:0}],{members:['a']}).n,0);
assert.equal(C.select([{...base,id:'a',v:.1,o:.1,flags:['nws-prorated']}],{members:['a']}).n,0);
assert.equal(C.select([{...base,id:'a',v:.1,o:.1,flags:['nws-prorated']}],{members:['a'],includeProrated:true}).n,1);
const prob=[0,.1,.3,1].map((v,i)=>({...base,id:'a',captureId:'p'+i,v,o:i===3?1:0,target:'pop01_clim',thresholdIn:.01,probabilityMethod:'ensemble-frequency'}));r=C.select(prob,{members:['a'],kind:'probability'});assert.equal(r.n,4);assert.equal(r.scores[0].bins[0].n,1);assert.equal(r.scores[0].bins[1].n,1);assert.equal(r.scores[0].bins[3].n,1);assert.equal(r.scores[0].bins[9].n,1);assert(Math.abs(r.scores[0].brier-.025)<1e-8);assert.equal(r.scores[0].bins[2].forecast,null);assert.equal(C.select([{...prob[0],thresholdIn:.1}],{members:['a'],kind:'probability'}).n,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rain-report-'));
try{const bundle={sources:{ecmwf_ens:{pop01_clim:{'2026-11-04':{v:.3,n:51}}}},blends:{}};const file=path.join(dir,'normalized/CVG/2026/2026-11-03_midday.normalize-v4.json.gz');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,zlib.gzipSync(JSON.stringify(bundle)));
const p={...base,captureId:'2026-11-03_midday',track:'source',id:'ecmwf_ens',target:'pop01_clim',v:.3,o:1,retrievedLast:'2026-11-03T17:00:00Z'};const out=P.project(dir,loc,{pairs:[p,{...p,track:'tv'},{...p,id:'nws'},{...p,cls:'pilot'}],pending:[]});assert.equal(out.pairs.length,1);assert.equal(out.excluded['incompatible or undocumented probability'],1);assert.equal(out.pairs[0].probabilityMethod,'ensemble-frequency');assert.equal(out.pairs[0].window[0],Date.parse('2026-11-04T05:00:00Z'));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('Precipitation: common-case joins, wet/dry contingencies, null ratios, timing exclusions, probability bins, Brier score and archive provenance pass.');
