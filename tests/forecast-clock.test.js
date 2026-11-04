'use strict';
const assert=require('node:assert/strict'),C=require('../assets/ops-core.js'),F=require('../assets/forecast-clock.js');
const tz='America/New_York',at=s=>C.time.toUtc('2026-11-04T'+s,tz);
let p=F.periods(C,tz,at('13:00'));assert.deepEqual(p.primary.map(x=>x.label),['Rest of today','Tonight','Tomorrow','Tomorrow night']);assert.equal(p.primary[1].kind,'low');assert.equal(p.primary[2].kind,'high');assert.equal(p.primary[1].e,C.time.toUtc('2026-11-05T06:00',tz));
p=F.periods(C,tz,at('14:00'));assert.equal(p.primary[0].label,'Tonight');assert.equal(p.remaining.label,'Rest of today');
p=F.periods(C,tz,at('23:00'));assert.equal(p.primary[0].s,at('23:00'));assert.equal(p.remaining,null);
p=F.periods(C,tz,at('03:00'));assert.equal(p.primary[0].label,'Early this morning');assert(p.primary.every(x=>x.e>x.s));
const wet=rounds=>({status:'wet',rounds}),now=at('13:00');
let t=F.timing([wet([{start:at('01:00'),end:at('22:00')}])],now);assert.equal(t.active,1);assert.equal(t.starts.length,0);assert.equal(t.ends[0],at('22:00'));
t=F.timing([wet([{start:at('01:00'),end:at('05:00')},{start:at('17:00'),end:at('22:00')}])],now);assert.equal(t.active,0);assert.equal(t.starts[0],at('17:00'));assert.equal(t.past,1);
t=F.timing([wet([{start:at('01:00'),end:at('05:00')}])],now);assert.equal(t.ended,true);
t=F.timing([{status:'wet',endClipped:true,rounds:[{start:now,end:at('23:00')}]}],now);assert.equal(t.continues,true);assert.equal(t.ends.length,0);
const rules=C.blend.presetRules('near48'),base=C.blend.presetWeights('near48',{},{}),ref=Date.parse('2026-11-04T18:00Z'),H=3600000,data={viewedAt:ref,ms:[ref,ref+36*H,ref+42*H,ref+48*H,ref+72*H,ref-H]};
assert.deepEqual(base,C.blend.PREFERRED.weights);assert.equal(C.blend.presetRules('preferred'),null);
const w=(id,v,i)=>C.blend.hourWeight(data,base,rules,id,v,i);
assert.equal(w('gfs_hrrr','precipitation',0),4.5);assert.equal(w('gfs_hrrr','temperature_2m',0),3);assert.equal(w('rrfs_ens','precipitation',0),2.5);assert.equal(w('ecmwf_ens','temperature_2m',0),4);assert.equal(w('nws','precipitation',0),3);assert.equal(w('gfs_hrrr','precipitation',2),3);assert.equal(w('gfs_hrrr','precipitation',3),1.5);assert.equal(w('gfs_hrrr','precipitation',4),1.5);assert.equal(w('gfs_hrrr','precipitation',5),1.5);
const period=C.blend.periodRules(data,rules,[0,3]);assert.equal(C.blend.w(base,period,'gfs_hrrr','precipitation'),3);assert.equal(rules.near48,true);
const spring=F.periods(C,tz,C.time.toUtc('2027-03-13T15:00',tz));assert.equal((spring.primary[0].e-spring.primary[0].s)/H,11); // DST night
console.log('33 planning-clock and near48 weighting checks pass');
// The actual daily table and its contribution panel must use the same boosted weights.
const times=Array.from({length:96},(_,i)=>new Date(ref+i*H).toISOString().slice(0,16));
const dd={viewedAt:ref,times,ms:times.map(t=>Date.parse(t+'Z')),dtimes:[],models:{gfs_hrrr:{h:{temperature_2m:times.map(()=>70),precipitation:times.map(()=>.1)}},ecmwf_ifs025:{h:{temperature_2m:times.map(()=>50),precipitation:times.map(()=>0)}}}};
const weights={gfs_hrrr:1.5,ecmwf_ifs025:1.25},rr=C.blend.dailyRows(dd,weights,{rules}),plain=C.blend.dailyRows(dd,weights),coverage=C.blend.coverage(dd,weights,weights,{rules});
rr.forEach((r,i)=>{assert.equal(r.hi,coverage.days[i].vars.hi.value);assert.equal(r.qpf,coverage.days[i].vars.qpf.value);assert.deepEqual(r.parts.hi.map(p=>[p.id,p.share]),coverage.days[i].vars.hi.contributors.sort((a,b)=>r.parts.hi.findIndex(p=>p.id===a.id)-r.parts.hi.findIndex(p=>p.id===b.id)).map(p=>[p.id,p.share]));});
assert(rr[0].hi>plain[0].hi);assert.equal(rr.at(-1).hi,plain.at(-1).hi);assert.equal(rr.at(-1).qpf,plain.at(-1).qpf);
console.log('Daily values and coverage shares match under near48 rules; beyond-48-hour values match the original blend');
