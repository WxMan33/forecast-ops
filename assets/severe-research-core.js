/* Historical research viewer math. Probabilities retain their original 25-mile / four-hour target. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SevereResearchCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const HAZARDS=['tornado','wind','hail'];
  const available=p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1;
  function percent(p){return !available(p)?'Unavailable':p>0&&p<.001?'<0.1%':(p*100).toFixed(1)+'%';}
  function distance(a,b){const r=Math.PI/180,dy=(a[1]-b[1])*r,dx=(a[0]-b[0])*r;const q=Math.sin(dy/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dx/2)**2;return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,q)));}
  function nearest(grid,lon,lat,limit=12){if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon < -100||lon > -75||lat < 30||lat > 45)return null;let best=null,d=Infinity;grid.forEach((p,i)=>{const v=distance(p,[lon,lat]);if(v<d){d=v;best=i;}});return d<=limit?{index:best,km:d}:null;}
  function validateIndex(m){if(m?.schema_version!==1||m.status!=='historical_replay'||m.live_feed!==false||m.operational_skill_established!==false||m.radius_km!==40.2336||m.window_hours!==4||!Array.isArray(m.runs)||!m.runs.length)throw Error('Unsupported research archive');m.runs.forEach(r=>{if(!/^2024-\d{2}-\d{2}\.json$/.test(r.file)||r.file!==r.date+'.json'||!/^hrrr-v4-2024\d{6}$/.test(r.id)||!r.valid_start.startsWith(r.date+'T')||!/^2024-/.test(r.valid_start)||!Number.isFinite(Date.parse(r.valid_start))||Date.parse(r.valid_end)-Date.parse(r.valid_start)!==14400000)throw Error('Invalid historical window');});return m;}
  function validateCase(data,run,n){if(!data||data.id!==run.id||data.valid_start!==run.valid_start||data.valid_end!==run.valid_end)throw Error('Archive case identity mismatch');const out={};HAZARDS.forEach(h=>{const a=data.probabilities?.[h];if(a==null){out[h]=Array(n).fill(null);return;}if(!Array.isArray(a)||a.length!==n||a.some(p=>p!==null&&!available(p)))throw Error('Invalid probability grid');out[h]=a;});return out;}
  function peak(a){let best=null;a.forEach((p,i)=>{if(available(p)&&(best===null||p>a[best]))best=i;});return best;}
  function ring(lon,lat,km=40.2336){const rad=Math.PI/180,phi=lat*rad,lambda=lon*rad,d=km/6371.0088,coords=[];for(let k=0;k<=72;k++){const b=k*2*Math.PI/72,p=Math.asin(Math.sin(phi)*Math.cos(d)+Math.cos(phi)*Math.sin(d)*Math.cos(b));const l=lambda+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(phi),Math.cos(d)-Math.sin(phi)*Math.sin(p));coords.push([l/rad,p/rad]);}return{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}};}
  return{HAZARDS,available,percent,distance,nearest,validateIndex,validateCase,peak,ring};
});
