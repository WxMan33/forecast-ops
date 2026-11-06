'use strict';
const assert=require('node:assert/strict'),C=require('../assets/ops-core.js'),D=require('../assets/ops-data.js'),B=require('../assets/broadcast-pop.js'),H=3600000;
for(const [v,want] of [[0,0],[1,0],[2.49,0],[2.5,5],[37,35],[42,40],[63,65],[97.5,100],[100,100],[null,null],[NaN,null],['42',null],[-1,null],[101,null]])assert.equal(C.stats.roundProbability(v),want);
const points=B.grid({lat:39.05,lon:-84.66});assert.equal(points.length,9);assert.deepEqual(points[4],{lat:39.05,lon:-84.66});
function area(day='2026-11-07',tz='America/New_York'){
 const start=C.time.toUtc(day+'T00:00',tz),next=new Date(Date.parse(day+'T12:00Z')+86400000).toISOString().slice(0,10),end=C.time.toUtc(next+'T00:00',tz),ms=Array.from({length:(end-start)/H},(_,i)=>start+(i+1)*H);
 return {tz,points,systems:B.systems.map(s=>({...s,sites:points.map(()=>({ms:[...ms],members:Array.from({length:s.members},()=>ms.map(()=>0))}))})),start,end};
}
const weights={ecmwf_ens:3,gefs:1};
const score=(a,day='2026-11-07',now=a.start,rules=null)=>B.assess(a,day,C,weights,rules,a.start,now);
let a=area();assert.equal(score(a).probability,0);assert.equal(score(a).timing,'Mostly dry');
// One wet third of the sample area in every member: this is typical-point chance, not rain-anywhere.
for(const s of a.systems)for(const site of s.sites.slice(0,3))for(const m of site.members)m[10]=.02;
assert(Math.abs(score(a).probability-100/3)<1e-9);assert.equal(score(a).timing,'AM');
// A member counts once over the whole day, even when its rain falls in several hours.
a=area();for(const s of a.systems)for(const site of s.sites)for(const m of site.members){m[10]=.005;m[11]=.005;}
assert.equal(score(a).probability,100);assert.equal(score(a).heavyShare,0);
const original=JSON.stringify(a);score(a);assert.equal(JSON.stringify(a),original);
// Only future accumulations count today.
assert.equal(score(a,'2026-11-07',a.start+12*H).probability,0);
for(const s of a.systems)for(const site of s.sites)for(const m of site.members)m[15]=.5;
assert.equal(score(a).heavyShare,1);
// A missing hour at any sampled point excludes that system, and never counts it dry.
a.systems[0].sites[0].ms.pop();let r=score(a);assert(r.partial);assert.deepEqual(r.systems,['GEFS']);assert.equal(r.probability,100);
a.systems[1].sites[0].members.forEach(m=>m[2]=null);assert.equal(score(a),null);
a=area();a.systems[0].sites.pop();assert.deepEqual(score(a).systems,['GEFS']);
// Source weights averaged over the actual daily hours, including a near/far boundary.
a=area();for(const site of a.systems[0].sites)for(const m of site.members)m[10]=.1;
const rules={referenceMs:a.start-36*H,periodWeights:{near:{ecmwf_ens:3,gefs:1},far:{ecmwf_ens:1,gefs:1}}};
assert(Math.abs(score(a,'2026-11-07',a.start,rules).probability-100*(11*3+13)/(11*4+13*2))<1e-9);
assert.equal(B.assess(a,'2026-11-07',C,{ecmwf_ens:0,gefs:0},null,a.start,a.start),null);
for(const [day,n] of [['2026-03-08',23],['2026-11-01',25]]){a=area(day);assert.equal(a.systems[0].sites[0].ms.length,n);assert.equal(score(a,day).probability,0);}
// Validate identities, member counts, lengths and unit conversion at the API boundary.
const spec=B.systems[0],j=points.map((p,i)=>({...p,latitude:p.lat,longitude:p.lon,location_id:i,timezone:'UTC',hourly:{time:['2026-11-07T00:00'],...Object.fromEntries(Array.from({length:51},(_,k)=>['precipitation'+(k?'_member'+String(k).padStart(2,'0'):''),[25.4]]))},hourly_units:Object.fromEntries(Array.from({length:51},(_,k)=>['precipitation'+(k?'_member'+String(k).padStart(2,'0'):''),'mm']))}));
assert(Math.abs(B.parse(j,points,spec,D)[0].members[0][0]-1)<1e-12);
j[0].hourly.precipitation=[null];assert.equal(B.parse(j,points,spec,D)[0].members[0][0],null);
j[0].hourly.precipitation=[];assert.throws(()=>B.parse(j,points,spec,D),/axis/);j[0].hourly.precipitation=[0];
delete j[0].hourly.precipitation_member50;assert.throws(()=>B.parse(j,points,spec,D),/member count/);
console.log('Broadcast PoP: 5% display rounding, spatial sampling, whole-period chance, future hours, heavy bursts, missing data, source weights, DST and response validation pass');
