'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const MC=require('../assets/maps-core.js');
const dir=path.join(__dirname,'fixtures/maps/2026110500'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),g=m.grid;
let n=0;const ok=(c,msg)=>{assert.ok(c,msg);n++;};
for(const name of ['d2m','w10m','gust','cloud']) {
 const spec=m.fields[name],b=zlib.gunzipSync(fs.readFileSync(path.join(dir,spec.file)));
 const f=MC.field(spec,b.buffer.slice(b.byteOffset,b.byteOffset+b.length),m.hours.length,g.ny,g.nx);
 const checks=m.fieldCheckpoints[name];ok(checks.points.length===9,name+' has independent GRIB checkpoints');
 for(const p of checks.points) {
  let expected=p.value;if(name==='d2m')expected=(expected-273.15)*9/5+32;else if(name==='w10m'||name==='gust')expected*=2.2369362920544;
  const [i,j]=p.cell;ok(Math.abs(f.at(checks.fh,i,j)-expected)<=.051,name+' matches original GRIB value at '+p.name);
  assert.deepEqual(MC.projector(g).nearest(p.lat,p.lon),p.cell);
 }
 ok(m.fields[name].missingHours.length===0,name+' covers all four captured forecast hours');
}
for(const sc of ['d2m','wind','cloud']) {
 ok(MC.colorTable(sc).length===1024,sc+' has a GPU color table');
 ok(MC.scaleU(sc,null)===null,sc+' missing stays missing');
}
ok(MC.scaleU('wind',0)>=0,'calm winds are valid, not missing');
ok(MC.scaleU('cloud',0)>=0,'clear sky is valid, not missing');
ok(MC.color('cloud',100)!==null,'100-percent cloud cover is valid');
ok(MC.color('d2m',-40)!==null,'dew point below color range stays visible');
console.log(`ok - ${n} real-GRIB surface-map checks passed`);
