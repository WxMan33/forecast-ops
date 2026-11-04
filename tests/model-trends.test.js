'use strict';
const assert=require('node:assert/strict'),C=require('../assets/ops-core.js'),T=require('../assets/model-trends.js');
let count=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);count++;},ok=(a,m)=>{assert.ok(a,m);count++;};
const H=T.H,s=Date.parse('2026-11-04T00:00Z'),e=s+24*H,ms=Array.from({length:73},(_,i)=>s+i*H),zeros=()=>ms.map(()=>0);
function wet(start=7){const a=zeros();a[start]=.15;a[start+1]=.2;a[18]=.03;return a;}
let a=wet(),t=T.oneTiming(ms,a,s,e);
eq(t.rounds.map(r=>[r.start,r.end]),[[s+6*H,s+8*H],[s+17*H,s+18*H]],'two rounds stay separate; amounts end at labelled hour');
eq(t.onset,s+6*H,'onset is beginning of first accumulating hour');
eq(t.end,s+18*H,'end is end of last accumulating hour');
eq(t.onsetClipped,false,'bounded onset');
eq(T.oneTiming(ms,zeros(),s,e).status,'quiet','complete quiet window is distinct from missing');
a[10]=null;eq(T.oneTiming(ms,a,s,e).status,'limited','a missing dry hour still invalidates definitive timing');
a=wet(1);eq(T.oneTiming(ms,a,s,e).onsetClipped,true,'already wet at window boundary');
a=zeros();a[24]=.1;eq(T.oneTiming(ms,a,s,e).endClipped,true,'wet at end is clipped');
eq(T.oneTiming(ms.filter((_,i)=>i!==13),zeros(),s,e).status,'limited','missing timestamp invalidates timing');
eq(T.timing({kind:'nws',h:{precipitation:wet()}},ms,s,e).status,'intervals','NWS QPF cannot invent hourly onset');
const member=a=>({h:{temperature_2m:ms.map((_,i)=>40+i%24),precipitation:a,snowfall:zeros(),wind_gusts_10m:ms.map(()=>20)}});
const ens={kind:'ens',members:[member(wet()),member(zeros()),member(wet(9))]};ens.h=ens.members[0].h;
t=T.timing(ens,ms,s,e);eq([t.status,t.members,t.wet],['ensemble',3,2],'ensemble timing comes from individual members');
eq(t.onset,s+6*H,'wet-member median, not hourly mean onset');
ens.members[1].h.precipitation[9]=null;eq(T.timing(ens,ms,s,e).partial,true,'partial ensemble flagged');
function data(){const m=member(wet());return {tz:'UTC',times:ms.map(x=>new Date(x).toISOString().slice(0,16)),ms,dtimes:[],models:{gfs:{...m,d:{}},ens:structuredClone(ens)}};}
const loc={lat:39.05,lon:-84.66};const d=data(),first=T.capture(C,d,loc,100),day='2026-11-04';
ok(first.models.gfs.rows[day], 'capture requires a real full calendar window');
eq(first.models.gfs.rows[day].win,[s,e],'exact UTC valid window frozen');
eq(Object.keys(first.models.gfs.rows).length,3,'partial final date omitted');
eq(first.models.gfs.confirmedCycle,null,'retrieval alone is not a confirmed model run');
const next=structuredClone(first);next.at=200;next.models.gfs.rows[day].hi+=4;next.models.gfs.rows[day].qpf+=.2;
let diff=T.compare(next,first);eq(diff.changes.map(x=>x.field),['hi','qpf'],'individual-source changes in fixed window');
const changedWindow=structuredClone(next);changedWindow.models.gfs.rows[day].win[0]+=H;eq(T.compare(changedWindow,first).changes.length,0,'different valid windows never compare');
const changedPlace=structuredClone(next);changedPlace.loc[0]+=.1;eq(T.compare(changedPlace,first).changes.length,0,'different locations never compare');
const support=structuredClone(next);support.models.gfs.rows[day].support.qpf=['different'];diff=T.compare(support,first);eq(diff.changes.map(x=>x.field),['hi'],'coverage change is not forecast movement');eq(diff.coverage.length,1,'changed support is reported');
const prorated=structuredClone(next);prorated.models.gfs.rows[day].prorated=true;eq(T.compare(prorated,first).changes.map(x=>x.field),['hi'],'prorated NWS timing uncertainty suppresses amount delta');
const timing=structuredClone(first);timing.models.gfs.rows[day].timing.onset+=3*H;eq(T.compare(timing,first).changes[0].delta,3,'three-hour timing shift calculated');
timing.models.gfs.rows[day].timing.onsetClipped=true;eq(T.compare(timing,first).changes.length,0,'clipped boundary never becomes claimed timing shift');
const dry=structuredClone(first);dry.models.gfs.rows[day].timing=T.oneTiming(ms,zeros(),s,e);eq(T.compare(first,dry).changes[0].field,'rainSignal','new hourly signal is distinguished from missing data');
const memFirst=T.capture(C,data(),loc,100),memNext=structuredClone(memFirst);memNext.models.ens.rows[day].hi+=5;memNext.models.ens.rows[day].support.hi=[0];eq(T.compare(memNext,memFirst).changes.length,0,'ensemble member change cannot masquerade as warmer forecast');
let hist=T.history([],first);eq(hist.changed,true,'first load recorded');hist=T.history(hist.items,{...first,at:150});eq(hist.changed,false,'identical guidance refresh not counted');eq(hist.current.at,100,'original guidance-view timestamp preserved');
for(let i=0;i<8;i++){const x=structuredClone(first);x.at=300+i;x.models.gfs.rows[day].hi+=i;hist=T.history(hist.items,x);}eq(hist.items.length,6,'bounded history');eq(T.history(hist.items,hist.current).items.length,6,'identical refresh cannot shrink history');
const clone=structuredClone(first);clone.weights={gfs:5};eq(T.signature(clone),T.signature(first),'blend recipe never enters model guidance signature');
const missing=data();missing.ms.splice(10,1);missing.times.splice(10,1);eq(T.capture(C,missing,loc).models.gfs.rows[day],undefined,'a missing axis hour cannot pass calendar-day coverage');
for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]]){
 const start=C.time.toUtc(date+'T00:00','America/New_York'),end=start+hours*H,axis=Array.from({length:hours+1},(_,i)=>start+i*H);
 eq(T.oneTiming(axis,axis.map(()=>0),start,end).status,'quiet',date+' actual UTC duration supported');
 const dd={tz:'America/New_York',ms:axis,times:axis.map(x=>C.time.toLocal(x,'America/New_York')),dtimes:[],models:{gfs:{h:{temperature_2m:axis.map(()=>50),precipitation:axis.map(()=>0)},d:{}}}};
 eq(T.capture(C,dd,loc).models.gfs.rows[date].win,[start,end],date+' full DST window captured without duplicate instant');
}
// Real captured response exercises the capture representation, not forecast accuracy.
const fs=require('node:fs'),path=require('node:path');const j=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','om-cincinnati-gfs-blend.json')));
const offset=j.utc_offset_seconds||0;const real={tz:j.timezone||'UTC',times:j.hourly.time,ms:j.hourly.time.map(x=>Date.parse(x+'Z')-offset*1000),dtimes:j.daily.time,models:{gfs:{h:j.hourly,d:j.daily}}};
const snap=T.capture(C,real,loc);ok(Object.keys(snap.models.gfs.rows).length>0,'real captured GFS response yields usable windows');
console.log(`${count} model-trend checks pass`);
