/* Bounded Cincinnati airport diagnostics; never add these point series to the blend. */
(function(root){'use strict';
 const airports=[
  {id:'CVG',name:'Cincinnati/Northern Kentucky',lat:39.04456,lon:-84.67229},
  {id:'LUK',name:'Lunken Field',lat:39.10583,lon:-84.41583},
  {id:'HAO',name:'Butler County Regional',lat:39.36121,lon:-84.52061},
  {id:'MWO',name:'Middletown / Hook Field',lat:39.531,lon:-84.3953}
 ]; // NWS station metadata KLUK, KHAO, KMWO; CVG uses the existing pilot coordinates.
 const distance=(a,b)=>Math.hypot((a.lat-b.lat)*111.2,(a.lon-b.lon)*86.4);
 function identify(where){return airports.find(p=>distance(p,where)<=3)||{id:'POINT',name:'Selected point',...where};}
 function nearby(where){return distance(airports[0],where)<=80?airports.filter(p=>distance(p,where)>3):[];}
 const fields=['visibility','temperature_2m','dew_point_2m','precipitation','snowfall','weather_code'];
 function parseBatch(json,points,D){
  const responses=Array.isArray(json)?json:points.length===1?[json]:[];
  if(responses.length!==points.length)throw Error('Airport response count mismatch');
  return responses.map((j,i)=>{
   if(j.location_id!=null&&j.location_id!==i)throw Error('Airport response identity mismatch');
   if(!Number.isFinite(j.latitude)||!Number.isFinite(j.longitude)||distance(points[i],{lat:j.latitude,lon:j.longitude})>25)throw Error('Airport grid point mismatch');
   if(!Array.isArray(j.hourly?.time)||!j.timezone)throw Error('Airport time axis unavailable');
   const h={},n=j.hourly.time.length,u=j.hourly_units||{};
   for(const v of fields){
    const raw=Array.isArray(j.hourly[v])&&j.hourly[v].length===n?j.hourly[v]:Array(n).fill(null);
    const unit=String(u[v]||'').toLowerCase();
    if(v==='visibility')h[v]=D.toMeters(v,raw,unit);
    else {const valid=['temperature_2m','dew_point_2m'].includes(v)?['°f','fahrenheit'].includes(unit):['precipitation','snowfall'].includes(v)?['inch','in'].includes(unit):unit==='wmo code';h[v]=raw.map(x=>valid&&typeof x==='number'&&Number.isFinite(x)?x:null);}
   }
   return D.withAxis({times:j.hourly.time,tz:j.timezone,offset:j.utc_offset_seconds,models:{},h});
  });
 }
 async function load(where,days,D,C){
  const points=nearby(where);if(!points.length)return [];
  const sites=points.map(p=>({...p,tz:'America/New_York',ms:[],models:{}}));
  await Promise.allSettled(['gfs_hrrr','ncep_rrfs_conus','ecmwf_ifs'].map(async id=>{
   const q=new URLSearchParams({latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),models:id,hourly:fields.join(','),forecast_days:Math.min(days,3),timezone:'America/New_York',temperature_unit:'fahrenheit',precipitation_unit:'inch',wind_speed_unit:'mph',cell_selection:'nearest',elevation:points.map(()=> 'nan').join(',')});
   const j=await D.getJSON('https://api.open-meteo.com/v1/forecast?'+q);if(j.error)throw Error(j.reason||'Airport visibility unavailable');
   const rows=parseBatch(j,points,D);
   rows.forEach((r,i)=>{const s=sites[i];if(!s.ms.length){s.ms=r.ms;s.tz=r.tz;}s.models[id]={h:Object.fromEntries(Object.entries(r.h).map(([v,a])=>[v,C.stats.align(s.ms,r.ms,a)])),retrievedAt:j.__retrievedAt||null,fromCache:!!j.__fromCache};});
  }));
  return sites;
 }
 const api={airports,distance,identify,nearby,parseBatch,load};if(typeof module==='object'&&module.exports)module.exports=api;else root.AirportVisibility=api;
})(typeof globalThis==='object'?globalThis:this);
