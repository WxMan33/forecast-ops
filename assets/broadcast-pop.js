/* Regional ensemble sampling for broadcast planning, separate from the point blend. */
(function(root){'use strict';
 const H=3600000,systems=[{id:'ecmwf_ifs025_ensemble',source:'ecmwf_ens',name:'Euro ENS',members:51},{id:'ncep_gefs025',source:'gefs',name:'GEFS',members:31}];
 function grid(p){const dy=80/111.2,dx=80/(111.2*Math.cos(p.lat*Math.PI/180));return [-1,0,1].flatMap(y=>[-1,0,1].map(x=>({lat:+(p.lat+y*dy).toFixed(4),lon:+(p.lon+x*dx).toFixed(4)})));}
 function parse(json,points,spec,D){const a=Array.isArray(json)?json:[];if(a.length!==points.length)throw Error('Regional point count mismatch');return a.map((j,i)=>{
  if(j.location_id!=null&&j.location_id!==i)throw Error('Regional point identity mismatch');
  const km=Math.hypot((j.latitude-points[i].lat)*111.2,(j.longitude-points[i].lon)*111.2*Math.cos(points[i].lat*Math.PI/180));
  if(!Number.isFinite(km)||km>40||!Array.isArray(j.hourly?.time)||!j.timezone)throw Error('Regional grid/time mismatch');
  const keys=Object.keys(j.hourly).filter(k=>k==='precipitation'||/^precipitation_member\d+$/.test(k));
  if(keys.some(k=>!Array.isArray(j.hourly[k])||j.hourly[k].length!==j.hourly.time.length))throw Error('Regional member axis mismatch');
  const members=keys.map(k=>{const u=String(j.hourly_units?.[k]||'').toLowerCase(),scale=['inch','in'].includes(u)?1:u==='mm'?1/25.4:null;return j.hourly[k].map(x=>scale!=null&&typeof x==='number'&&Number.isFinite(x)&&x>=0?x*scale:null);});
  if(keys.length!==spec.members)throw Error('Regional member count incomplete');
  return D.withAxis({times:j.hourly.time,tz:j.timezone,offset:j.utc_offset_seconds,members});
 });}
 async function load(where,days,D){if(Math.abs(where.lat)>65)return {systems:[],points:[],status:'outside supported latitude range'};const points=grid(where),out=[];
  await Promise.allSettled(systems.map(async s=>{const q=new URLSearchParams({latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),models:s.id,hourly:'precipitation',forecast_days:Math.min(16,days+1),timezone:'UTC',precipitation_unit:'inch',cell_selection:'nearest',elevation:points.map(()=> 'nan').join(',')});const j=await D.getJSON('https://ensemble-api.open-meteo.com/v1/ensemble?'+q);const sites=parse(j,points,s,D);out.push({...s,sites,retrievedAt:j.__retrievedAt||null,fromCache:!!j.__fromCache});}));
  return {systems:out.sort((a,b)=>a.id.localeCompare(b.id)),points,status:out.length?'ready':'unavailable'};
 }
 function assess(area,day,C,weights,rules,reference,now=Date.now()){
  if(!area?.systems?.length)return null;
  const tz=area.tz||'America/New_York',start=Math.max(C.time.toUtc(day+'T00:00',tz),Math.floor(now/H)*H),next=new Date(Date.parse(day+'T12:00Z')+86400000).toISOString().slice(0,10),end=C.time.toUtc(next+'T00:00',tz);
  if(end<=start)return null;const hours=(end-start)/H,out=[],hourMs=Array.from({length:hours},(_,i)=>start+(i+1)*H),binsByHour=hourMs.map(ms=>Math.floor(+C.time.toLocal(ms-1,tz).slice(11,13)/6));
  for(const s of area.systems){if(s.sites.length!==9||area.points.length!==9)continue;let wet=0,heavy=0;const amounts=[0,0,0,0];let valid=true,used=0;
   for(const site of s.sites){const ix=site.ms.map((ms,i)=>({ms,i})).filter(p=>p.ms>start&&p.ms<=end);
    if(ix.length!==hours||ix.some((p,i)=>p.ms!==start+(i+1)*H)){valid=false;break;}
    const members=site.members.filter(a=>ix.every(p=>typeof a[p.i]==='number'&&Number.isFinite(a[p.i])&&a[p.i]>=0));
    if(members.length<Math.ceil(s.members*.9)){valid=false;break;}
    let sw=0,sh=0;const am=[0,0,0,0];
    for(const a of members){const v=ix.map(p=>a[p.i]);if(v.reduce((x,y)=>x+y,0)>=.01-1e-9)sw++;if(v.some((_,i)=>i>=2&&v[i]+v[i-1]+v[i-2]>=.5))sh++;
     v.forEach((value,i)=>{am[binsByHour[i]]+=value/members.length;});}
    wet+=sw/members.length/s.sites.length;heavy+=sh/members.length/s.sites.length;am.forEach((v,i)=>amounts[i]+=v/s.sites.length);used+=members.length;
   }
   const axis={ms:hourMs,viewedAt:reference},w=C.blend.w(weights,C.blend.periodRules(axis,rules,axis.ms.map((_,i)=>i)),s.source,'precipitation');
   if(valid&&w>0)out.push({name:s.name,w,wet,heavy,amounts,used});
  }
  if(!out.length)return null;const total=out.reduce((a,s)=>a+s.w,0),probability=Math.max(0,Math.min(100,100*out.reduce((a,s)=>a+s.w*s.wet,0)/total)),heavyShare=Math.max(0,Math.min(1,out.reduce((a,s)=>a+s.w*s.heavy,0)/total));
  const amounts=[0,1,2,3].map(i=>out.reduce((a,s)=>a+s.w*s.amounts[i],0)/total),max=Math.max(...amounts),bins=amounts.map((v,i)=>({v,i})).filter(p=>max>0&&p.v>=max*.6).map(p=>['Overnight','AM','PM','Evening'][p.i]);
  return {probability,heavyShare,timing:bins.length>2?'Several windows':bins.join(' / ')||'Mostly dry',systems:out.map(s=>s.name),points:area.points.length,members:out.reduce((a,s)=>a+s.used,0),start,end,partial:out.length<2,areaLabel:'160-km regional sample'};
 }
 const api={grid,parse,load,assess,systems};if(typeof module==='object'&&module.exports)module.exports=api;else root.BroadcastPoP=api;
})(typeof globalThis==='object'?globalThis:this);
