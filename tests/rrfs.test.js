/* Captured NOAA CVG point values; controlled clock tests for units, coverage and provenance. */
const assert = require("assert");
const D = require("../assets/ops-data.js");
const C = require("../assets/ops-core.js");
const feed = require("./fixtures/rrfs/cvg-native-smoke.json");
const now = Date.parse(feed.generatedAt), loc = {lat:39.04456,lon:-84.67229};
const us = {temperature_unit:"fahrenheit",precipitation_unit:"inch",timezone:"GMT"};
const metric = {temperature_unit:"celsius",precipitation_unit:"mm",timezone:"auto"};
let n=0;
const check=(test)=>{test();n++;};
check(()=>assert.throws(()=>D.directRrfsResponse(feed,"ncep_rrfs_conus",us,{lat:39.7,lon:-86.2},now),/only available at CVG/));
check(()=>assert.throws(()=>D.directRrfsResponse(feed,"ncep_rrfs_conus",us,loc,now+17*3600e3),/stale/));
check(()=>assert.throws(()=>D.directRrfsResponse({...feed,cycle:"bad"},"ncep_rrfs_conus",us,loc,now),/invalid timestamps/));
const det=D.directRrfsResponse(feed,"ncep_rrfs_conus",us,loc,now);
check(()=>assert.equal(det.hourly.temperature_2m[0],feed.members.deterministic.hourly.temperature_2m[0]*9/5+32));
check(()=>assert.equal(det.hourly.precipitation[1],feed.members.deterministic.hourly.precipitation[1]/25.4));
check(()=>assert.equal(det.hourly.snowfall[1],feed.members.deterministic.hourly.snowfall[1]/2.54));
check(()=>assert.equal(det.hourly.precipitation[0],null));
check(()=>assert.equal(det.__rrfs.cycle,feed.cycle));
check(()=>assert.equal(det.__rrfs.elevationAdjusted,false));
const ens=D.directRrfsResponse(feed,"ncep_rrfs_conus_ensemble",metric,loc,now);
check(()=>assert.equal(Object.keys(ens.hourly).filter(k=>k.startsWith("temperature_2m")).length,5));
check(()=>assert.deepStrictEqual(ens.hourly.temperature_2m_member04,feed.members.member05.hourly.temperature_2m));
check(()=>assert.equal(C.time.instants(ens.hourly.time,ens.timezone,ens.utc_offset_seconds).ms[0],Date.parse(feed.cycle)));
const broken=JSON.parse(JSON.stringify(feed));delete broken.members.member03;
check(()=>assert.throws(()=>D.directRrfsResponse(broken,"ncep_rrfs_conus_ensemble",us,loc,now),/member missing/));
check(()=>assert.throws(()=>D.directRrfsResponse(feed,"ncep_rrfs_north_america",us,loc,now),/Unsupported/));
// Exercise the loader against failed API coverage, using real captured point values and a fresh clock.
(async()=>{
 const current=JSON.parse(JSON.stringify(feed));
 current.generatedAt=new Date().toISOString();current.cycle=new Date(Math.floor(Date.now()/21600e3)*21600e3).toISOString();
 current.members.member02.hourly.snowfall=[null,null];
 current.members.member03.hourly.snowfall=[null,2];
 const fetch0=global.fetch;
 global.fetch=async url=>({ok:true,json:async()=>String(url).includes("feeds/rrfs-cvg.json")?current:{hourly:{time:[],temperature_2m:[]}}});
 try {
  const spec={...C.config.blend,models:[C.config.blend.models.find(m=>m.id==="ncep_rrfs_conus")],hourly:["temperature_2m","precipitation","snowfall"],daily:[]};
  const a=await D.loadModels(spec,loc);
  check(()=>assert.equal(a.empty,undefined));
  check(()=>assert.equal(a.models.ncep_rrfs_conus.provenance.provider,"NOAA native GRIB2"));
  const e=await D.loadEnsemble({...C.config.blendEns,models:[C.config.blendEns.models.find(m=>m.source==="rrfs_ens")]},loc);
  check(()=>assert.equal(e.ens.ncep_rrfs_conus_ensemble.temperature_2m.length,5));
  check(()=>assert.deepStrictEqual(e.ens.ncep_rrfs_conus_ensemble.snowfall[1],[null,null]));
  check(()=>assert.equal(e.ens.ncep_rrfs_conus_ensemble.snowfall[2][1],2/2.54));
  C.blend.addSources(a,e,null);
  check(()=>assert.equal(a.models.rrfs_ens.provenance.cycle,current.cycle));
  check(()=>assert.equal(C.blend.windowRow(a,{rrfs_ens:1},[0,1]).qpf,null));
 } finally {global.fetch=fetch0;}
 console.log(`ok - ${n} RRFS native-feed checks`);
})().catch(e=>{console.error(e);process.exitCode=1;});
