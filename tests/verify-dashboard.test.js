'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib');
const V=require('../assets/verify-core'),D=require('../verify/lib/dashboard'),loc=require('../verify/config/locations').CVG;
const t=Date.parse('2026-11-03T17:00:00Z'),stamp=n=>new Date(n).toISOString();
const base={captureId:'edition',target:'tmax_clim',date:'2026-11-04',slot:'midday',cls:'primary',lead:1,leadHours:12,normVersion:'v1',o:60};
const ps=[{...base,id:'a',v:62},{...base,id:'b',v:59},{...base,id:'a',v:100,cls:'pilot'},{...base,id:'b',v:100,captureId:'other'}];
let m=V.matched(ps,{members:['a','b'],target:'tmax_clim',slot:'midday',lead:1});assert.equal(m.n,1);assert.equal(m.scores[0].mae,2);assert.equal(m.scores[1].bias,-1);
assert.equal(V.matched(ps.concat(ps[0]),{members:['a','b']}).n,0,'duplicate source cannot multiply cases');
assert.equal(V.matched([{...ps[0],normVersion:'v2'},ps[1]],{members:['a','b']}).n,0,'methods must match');
assert.equal(V.matched([ps[0],{...ps[1],o:61}],{members:['a','b']}).n,0,'observations must match');
const hp=[0,1].flatMap(i=>['a','b'].map(id=>({captureId:'edition',cls:'primary',id,date:'2026-11-04',valid:stamp(t+i*3600e3),v:60,o:60,leadHours:2+i})));
assert.equal(V.matched(hp,{members:['a','b']}).n,2,'hours cannot collapse to one date');
assert.equal(V.matched(hp,{members:['a','b']}).dates,1);
assert.equal(V.recipeChange({...base,hash:'a',window:[1,2],contributors:[['x',1]]},{...base,hash:'b',window:[1,2],contributors:[['x',1]]}),'recipe changed');
assert.equal(V.recipeChange({...base,window:[1,2]},{...base,window:[2,3]}),'different valid windows');
assert.equal(V.observationAt([{valid:t+3600e3,measuredAt:t+55*60000,value:60}],t+3600e3,stamp(t)).value,null,'must use measurement time for lead');
assert.equal(V.observationAt([{valid:t+7200e3,measuredAt:t+7200e3-60000,value:60}],t+7200e3,stamp(t)).value,60);
assert.equal(V.hourlyAt({retrievedAt:stamp(t),hourly:{t0:t,stepMs:3600e3,temperature_2m:{a:[60,null,62]}}},'a',t),null);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'verify-dashboard-'));
try{
 fs.mkdirSync(path.join(dir,'captures'),{recursive:true});fs.mkdirSync(path.join(dir,'normalized/CVG/2026'),{recursive:true});
 const cap={captureId:'2026-11-03_midday',edition:'2026-11-03_midday',localDate:'2026-11-03',slot:'midday',trigger:'scheduled',slotTarget:stamp(t),startedAt:stamp(t+100)};
 const rel='normalized/CVG/2026/'+cap.captureId+'.normalize-v4.json.gz';
 const b={version:'normalize-v4',retrieval:{last:stamp(t+1000)},hourly:{t0:t,stepMs:3600e3,n:3,temperature_2m:{nws:[60,61,62]}},sources:{nws:{tmax_clim:{'2026-11-04':{v:62}}}},sourceIssue:{nws:{retrievedAt:stamp(t+500)}}};
 fs.writeFileSync(path.join(dir,rel),zlib.gzipSync(JSON.stringify(b)));fs.writeFileSync(path.join(dir,'captures/CVG.jsonl'),JSON.stringify({...cap,normalized:{path:rel}})+'\n');
 D.writeDashboard(dir,loc,{normVersion:'normalize-v4',pairs:[],hourlyPairs:[]},t+3600e3);
 const idx=JSON.parse(fs.readFileSync(path.join(dir,'reports/dashboard/index.json')));assert.equal(idx.captures.length,1);assert.equal(idx.captures[0].classes.nws,'primary');assert.equal(idx.defaultCaptured,false);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,idx.historyFiles["2026-11-04"])))[0].value,62);assert.equal(idx.dailyPairs.length,0);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('Dashboard: 17 matching, timing, archive and prospective-default checks passed.');
