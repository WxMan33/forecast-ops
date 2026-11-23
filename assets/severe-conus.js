/* CONUS Severe research preview: Day 2 damaging wind from the frozen CONUS boosted-tree candidate.
   Lives inside the "Daily severe probability research" panel next to the Regional view. Replay cases,
   their original Storm Events wind reports, and one saved forecast come from assets/severe-conus/.
   Research only. */
(function(){
'use strict';
const host=document.getElementById('severe-daily');if(!host)return;
const O=window.Ops,C=window.SevereResearchCore,G=window.SevereResearchContours,$=id=>document.getElementById(id);
const BASE='assets/severe-conus/',none=()=>({type:'FeatureCollection',features:[]});let empty=none();
const HZ={tornado:'Tornado',wind:'Damaging wind',hail:'Severe hail'};
const SEL='#22d3ee';
const NCEI_EVENT='https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=';
let offDisplay=false,landPolys=null,onLand=null,offGrid=false,mode='regional',day=2,hazard='wind',index,grid,supported,mesh,outsideFill=none(),map,ready=false,values=null,active=null,reports=null,selected=null,focusName='',
 showReports=true,showCounties=true,showNear=false,request=0,loaded=false,lastView=null,popup=null;
const cache=new Map(),contourCache=new Map(),reportCache=new Map();
const esc=s=>O&&O.esc?O.esc(s):String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const status=(m,err=false)=>{$('scStatus').textContent=m;$('scStatus').dataset.error=String(err);};
const ET={timeZone:'America/New_York'};
const eastern=t=>new Date(t).toLocaleString('en-US',{...ET,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const easternTime=t=>new Date(t).toLocaleString('en-US',{...ET,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const utc=t=>new Date(t).toISOString().slice(0,16).replace('T',' ')+'Z';
const n=x=>Number(x).toLocaleString('en-US');
async function fetchBytes(url,ms=30000){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),ms);try{const r=await fetch(url,{signal:ctl.signal,cache:'no-cache'});if(!r.ok)throw Error('request failed ('+r.status+')');return new Uint8Array(await r.arrayBuffer());}finally{clearTimeout(timer);}}
async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
async function fetchJson(file,hash){let bytes;try{bytes=await fetchBytes(BASE+file);}catch(e){throw Error('CONUS preview data '+e.message);}
 if(hash&&crypto.subtle&&await sha256(bytes)!==hash)throw Error('CONUS preview file checksum changed; refresh');return JSON.parse(new TextDecoder().decode(bytes));}
/* County lines for all of CONUS (us-atlas, same file as the Maps page). Some hosts already decompress .gz. */
async function counties(){try{let b=await fetchBytes('assets/maps/conus-detail.geojson.gz',20000);
  if(b[0]===0x1f&&b[1]===0x8b)b=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const g=JSON.parse(new TextDecoder().decode(b));const lines=g.features.filter(f=>/LineString/.test(f.geometry.type));if(lines.length)return{type:'FeatureCollection',features:lines};}catch(e){}
 try{const d=await fetch('assets/maps/basemap.json').then(r=>r.json());return d.layers.counties||null;}catch(e){return null;}}

/* ---------- state per point ---------- */
function state(i){if(i===null||i===undefined)return offDisplay?{kind:'offdisplay',text:'Outside display area'}:offGrid?{kind:'outside',text:'Outside coverage'}:{kind:'none',text:'—'};if(!supported[i])return{kind:'outside',text:'Outside coverage'};const p=values?values[i]:null;if(p===null||!C.available(p))return{kind:'unavailable',text:'Data unavailable'};if(p<.001)return{kind:'below',text:'<0.1%',note:'Below the lowest displayed contour (0.1%)'};return{kind:'value',text:C.percent(p)};}
function nearest(lon,lat){if(!grid)return null;let best=-1,d=Infinity;for(let i=0;i<grid.length;i++){const g=grid[i];if(Math.abs(g[1]-lat)>0.4||Math.abs(g[0]-lon)>0.6)continue;const v=C.distance(g,[lon,lat]);if(v<d){d=v;best=i;}}return best>=0&&d<=12?best:null;}
/* Mesh triangles that touch a sample outside coverage: one quiet neutral tint instead of dots. */
function outsideArea(){const T=mesh.triangles,polys=[];for(let t=0;t<T.length;t+=3){const ids=[T[t],T[t+1],T[t+2]];if(ids.every(i=>supported[i]))continue;const r=ids.map(i=>grid[i]);
  const a=(r[1][0]-r[0][0])*(r[2][1]-r[0][1])-(r[2][0]-r[0][0])*(r[1][1]-r[0][1]);if(a<0)r.reverse();r.push(r[0]);polys.push([r]);}
 return{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:polys}}]};}

/* ---------- land-only display (render-time clip; values, reports and the 25-mile definition are unchanged) ---------- */
const ringArea=r=>{let a=0;for(let i=0,n=r.length;i<n;i++){const p=r[i],q=r[(i+1)%n];a+=p[0]*q[1]-q[0]*p[1];}return a/2;};
const orient=(r,ccw)=>(ringArea(r)>0)===ccw?r:r.slice().reverse();
function setLand(mask){const polys=mask.land.coordinates;landPolys=polys.map(rings=>{let x0=180,y0=90,x1=-180,y1=-90;for(const [x,y] of rings[0]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}return{rings,box:[x0,y0,x1,y1]};});
 onLand=new Uint8Array(grid.length);for(const i of mask.grid_on_land)onLand[i]=1;}
function inRing(r,x,y){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
function inLand(x,y){if(!landPolys)return true;for(const {rings,box} of landPolys){if(x<box[0]||x>box[2]||y<box[1]||y>box[3])continue;if(inRing(rings[0],x,y)&&!rings.slice(1).some(h=>inRing(h,x,y)))return true;}return false;}
/* Everything that is not lower-48 land, as one plain-background polygon drawn above the shading. */
function waterMask(){if(!landPolys)return none();const outer=orient([[-179.9,-85],[179.9,-85],[179.9,85],[-179.9,85],[-179.9,-85]],true);
 const polys=[[outer,...landPolys.map(p=>orient(p.rings[0],false))]];for(const p of landPolys)for(const h of p.rings.slice(1))polys.push([orient(h,true)]);
 return{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:polys}}]};}

/* ---------- availability ---------- */
const available=()=>day===2&&hazard==='wind';
function syncButtons(){
 host.querySelectorAll('[data-sc-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scView===mode)));
 host.querySelectorAll('[data-sc-hazard]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scHazard===hazard)));
 $('scDay').value=String(day);
}
function showUnavailable(){const box=$('scUnavailable');box.hidden=available();if(!available()){box.querySelector('p').textContent=(day===1?'Day 1':'Day 2')+' '+HZ[hazard].toLowerCase()+' is not available in CONUS research. Only Day 2 damaging wind has a national candidate; Day 1 and tornado/hail stay Regional.';}}

/* ---------- map ---------- */
function palette(){const light=document.documentElement.dataset.theme!=='dark';return{land:light?'#f4f5f2':'#151a22',line:light?'#3d4450':'#c9d0da',county:light?'#8d949e':'#6c7583',water:light?'#e2ebf5':'#192b3b',text:light?'#172438':'#e7ecf3',outside:light?'#dde1e6':'#262d37',report:'#0b0f14',reportEdge:'#ffffff'};}
async function createMap(view){const [states,lakes,cty,land]=await Promise.all([fetch('assets/severe-research/states.json').then(r=>r.json()),fetch('assets/severe-research/lakes.json').then(r=>r.json()),counties(),fetch('assets/severe-conus-land.json').then(r=>r.ok?r.json():null).catch(()=>null)]);
 if(land&&Array.isArray(land.grid_on_land))setLand(land);
 const p=palette(),compact=$('scMap').clientWidth<560;
 map=new maplibregl.Map({container:'scMap',center:view?.center||[-96,38.5],zoom:view?.zoom??3.4,minZoom:2.5,maxZoom:10,renderWorldCopies:false,dragRotate:false,pitchWithRotate:false,attributionControl:false,style:{version:8,glyphs:new URL('assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf',location.href).href.replace(/%7B/g,'{').replace(/%7D/g,'}'),sources:{},layers:[{id:'sc-bg',type:'background',paint:{'background-color':p.land}}]}});
 map.touchZoomRotate.disableRotation();map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
 map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'CONUS research preview · NOAA HRRR / NCEI Storm Events · US Census / us-atlas · Natural Earth'}),'bottom-left');
 await new Promise(res=>map.on('load',res));
 const attrib=map.getContainer().querySelector('.maplibregl-ctrl-attrib');if(attrib)attrib.classList.remove('maplibregl-compact-show');
 for(const [id,data] of [['sc-states',states],['sc-water',waterMask()],['sc-outside',outsideFill],['sc-fill',none()],['sc-lines',none()],['sc-unavail',none()],['sc-near',none()],['sc-ring',none()],['sc-sel',none()]])map.addSource(id,{type:'geojson',data});
 map.addSource('sc-reports',{type:'geojson',data:none(),cluster:true,clusterRadius:26,clusterMaxZoom:6});
 if(cty)map.addSource('sc-counties',{type:'geojson',data:cty});
 // Layer order: neutral outside tint, probability fill, water, thin band outlines, counties, states, labels, footprint, reports, selection.
 map.addLayer({id:'sc-outside',type:'fill',source:'sc-outside',paint:{'fill-color':p.outside,'fill-opacity':.7,'fill-antialias':false}});
 map.addLayer({id:'sc-fill',type:'fill',source:'sc-fill',paint:{'fill-color':['get','color'],'fill-opacity':['case',['<',['get','threshold'],.02],.42,.66],'fill-antialias':false}});
 map.addLayer({id:'sc-lines',type:'line',source:'sc-lines',paint:{'line-color':'#1f2329','line-width':['case',['<',['get','threshold'],.02],.3,.55],'line-opacity':['case',['<',['get','threshold'],.02],.25,.45]}});
 // Land-only: water, Canada/Mexico and inland lakes are plain background above the shading, contours and tint.
 map.addLayer({id:'sc-water',type:'fill',source:'sc-water',paint:{'fill-color':p.land,'fill-opacity':1}});
 // County lines: a light core over a faint dark edge, so they read on the dark basemap and on the gray low-probability bands.
 // Always thinner than state borders (core 0.45-1.0 px vs states 0.9-1.8 px); same zoom fade-in as before.
 if(cty){map.addLayer({id:'sc-counties-edge',type:'line',source:'sc-counties',minzoom:4.8,layout:{visibility:showCounties?'visible':'none'},paint:{'line-color':'#0b0f14','line-width':['interpolate',['linear'],['zoom'],5,1.2,8,2],'line-opacity':['interpolate',['linear'],['zoom'],4.8,0,5.8,.28,8,.35]}});
  map.addLayer({id:'sc-counties',type:'line',source:'sc-counties',minzoom:4.8,layout:{visibility:showCounties?'visible':'none'},paint:{'line-color':'#dfe5ee','line-width':['interpolate',['linear'],['zoom'],5,.45,8,1],'line-opacity':['interpolate',['linear'],['zoom'],4.8,0,5.8,.6,8,.78]}});}
 map.addLayer({id:'sc-states',type:'line',source:'sc-states',paint:{'line-color':'#f3f6fa','line-width':['interpolate',['linear'],['zoom'],3,.9,8,1.8],'line-opacity':.95}});
 map.addLayer({id:'sc-labels',type:'symbol',source:'sc-lines',filter:['>=',['get','threshold'],.05],layout:{'symbol-placement':'line','symbol-spacing':300,'text-field':['concat',['to-string',['*',['get','threshold'],100]],'%'],'text-font':['Open Sans Semibold'],'text-size':10,'text-padding':12},paint:{'text-color':'#171717','text-halo-color':'#fff','text-halo-width':1.5}});
 map.addLayer({id:'sc-unavail',type:'circle',source:'sc-unavail',paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.5,7,3.5],'circle-color':'rgba(0,0,0,0)','circle-stroke-color':'#7a2a8c','circle-stroke-width':1}});
 map.addLayer({id:'sc-near',type:'circle',source:'sc-near',layout:{visibility:'none'},paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.2,7,3],'circle-color':'#ffffff','circle-stroke-color':'#3b4250','circle-stroke-width':.5,'circle-opacity':.8}});
 map.addLayer({id:'sc-clusters',type:'circle',source:'sc-reports',filter:['has','point_count'],paint:{'circle-color':p.report,'circle-opacity':.82,'circle-stroke-color':p.reportEdge,'circle-stroke-width':compact?1.2:1.5,'circle-radius':['step',['get','point_count']].concat(compact?[6,10,8,50,10,200,12]:[8,10,10,50,13,200,16])}});
 map.addLayer({id:'sc-cluster-count',type:'symbol',source:'sc-reports',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Open Sans Semibold'],'text-size':compact?8.5:10,'text-allow-overlap':true},paint:{'text-color':p.reportEdge}});
 map.addLayer({id:'sc-report',type:'circle',source:'sc-reports',filter:['!',['has','point_count']],paint:{'circle-color':p.report,'circle-radius':['interpolate',['linear'],['zoom'],4,compact?3:3.5,8,compact?5:6],'circle-stroke-color':p.reportEdge,'circle-stroke-width':compact?1.5:2}});
 map.addLayer({id:'sc-ring',type:'line',source:'sc-ring',paint:{'line-color':SEL,'line-width':2,'line-dasharray':[3,2]}});
 // Selected forecast point: a hollow cyan target (reports are filled dark dots with a white ring).
 map.addLayer({id:'sc-sel',type:'circle',source:'sc-sel',paint:{'circle-color':'rgba(0,0,0,0)','circle-radius':9,'circle-stroke-color':SEL,'circle-stroke-width':2.5}});
 map.addLayer({id:'sc-sel-dot',type:'circle',source:'sc-sel',paint:{'circle-color':SEL,'circle-radius':2.5,'circle-stroke-color':'#0b0f14','circle-stroke-width':1}});
 map.moveLayer('sc-labels','sc-water');
 for(const id of ['sc-report','sc-clusters']){map.on('mouseenter',id,()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave',id,()=>{map.getCanvas().style.cursor='';});}
 map.on('click',e=>{const hit=map.queryRenderedFeatures(e.point,{layers:['sc-report','sc-clusters']})[0];
  if(hit&&hit.layer.id==='sc-clusters'){map.getSource('sc-reports').getClusterExpansionZoom(hit.properties.cluster_id).then(z=>map.easeTo({center:hit.geometry.coordinates,zoom:Math.min(z+0.3,10),duration:400})).catch(()=>{});return;}
  if(hit){openReport(hit.properties.rid,hit.geometry.coordinates);return;}
  select([e.lngLat.lng,e.lngLat.lat],'Selected map point');});
 ready=true;}

/* ---------- reports ---------- */
function magnitude(r){if(r.magnitude_kt==null)return 'Magnitude not given';const how=r.measured===true?'measured':r.measured===false?'estimated':'';const what=r.gust===true?'gust':r.gust===false?'sustained wind':'wind';return Math.round(r.magnitude_kt)+' kt '+(how?how+' ':'')+what+(r.magnitude_type?' ('+r.magnitude_type+')':'');}
const tidy=l=>(l||'').replace(/^0 mi [NSEW]{1,3} /,'').replace(/^\.(\d)/,'0.$1');
function reportHtml(r){const place=[tidy(r.location),r.county_zone&&r.county_zone+(/county|parish/i.test(r.county_zone)?'':' Co.'),r.state].filter(Boolean).join(', ');
 return '<div class="sc-pop"><b>'+esc(magnitude(r))+'</b><div>'+esc(easternTime(r.time_utc))+' · '+esc(utc(r.time_utc))+'</div><div>'+esc(place)+'</div><div class="sr-caption">'+esc(r.lat.toFixed(4)+'°, '+r.lon.toFixed(4)+'°')+' · source time '+esc(r.source_local_time+' '+r.source_timezone)+'</div><a href="'+NCEI_EVENT+encodeURIComponent(r.id)+'" target="_blank" rel="noopener">NCEI Storm Events record '+esc(r.id)+'</a></div>';}
function openReport(id,coord){const r=reports&&reports.byId.get(String(id));if(!r)return;if(popup)popup.remove();popup=new maplibregl.Popup({closeButton:true,maxWidth:'280px',offset:8}).setLngLat(coord).setHTML(reportHtml(r)).addTo(map);}
function reportFeatures(){if(!reports)return none();return{type:'FeatureCollection',features:reports.list.filter(r=>r.lat!=null&&r.lon!=null).map(r=>({type:'Feature',properties:{rid:r.id},geometry:{type:'Point',coordinates:[r.lon,r.lat]}}))};}
function reportUi(){const c=active,box=$('scReportsWrap'),near=$('scNearWrap'),note=$('scReportNote'),cnt=$('scReportCount'),cb=$('scReports');
 if(!c){box.hidden=near.hidden=true;note.textContent='';return;}
 if(c.kind!=='replay'){box.hidden=near.hidden=true;note.textContent='Saved forecast: no storm reports yet for this window.';return;}
 box.hidden=near.hidden=false;const meta=c.reports;
 if(reports){cb.disabled=false;cnt.textContent='('+n(reports.list.length)+')';note.textContent=reports.list.length?(reports.uncertain?n(reports.uncertain)+' more record'+(reports.uncertain>1?'s':'')+' had no usable magnitude or location and are not shown.':''):'No qualifying reports in this window.';}
 else if(meta&&meta.status==='available'){cb.disabled=true;cnt.textContent='';note.textContent='Loading storm reports…';}
 else{cb.disabled=true;cnt.textContent='';note.textContent='Reports unavailable for this replay.';}}
async function loadReports(c,seq){reports=null;reportUi();const meta=c.reports;if(c.kind!=='replay'||!meta||meta.status!=='available')return;
 try{if(!reportCache.has(c.id))reportCache.set(c.id,fetchJson(meta.file,meta.sha256).catch(e=>{reportCache.delete(c.id);throw e;}));const d=await reportCache.get(c.id);if(seq!==request)return;
  if(d.case_id!==c.id||!Array.isArray(d.reports)||d.count!==d.reports.length)throw Error('report file mismatch');
  reports={list:d.reports,byId:new Map(d.reports.map(r=>[String(r.id),r])),uncertain:(d.uncertain||[]).length,source:d.source};}
 catch(e){if(seq!==request)return;reports=null;$('scReportNote').textContent='Reports unavailable: '+e.message+'.';$('scReports').disabled=true;draw();return;}
 reportUi();draw();}

/* ---------- loading ---------- */
const caseLabel=c=>c.kind==='current'?'SAVED FORECAST · valid '+new Date(c.valid_start).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'})+'–'+new Date(c.valid_end).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}):'REPLAY · '+c.label;
async function init(){if(loaded)return;loaded=true;host.setAttribute('aria-busy','true');status('Loading CONUS research preview…');try{
 index=await fetchJson('index.json');if(index.schema_version!==1||index.status!=='research_preview'||index.operational_forecast_eligible!==false)throw Error('Unsupported CONUS preview feed');
 const g=await fetchJson(index.grid.file,index.grid.sha256);grid=g.coordinates;supported=g.supported.map(Boolean);if(grid.length!==index.coverage.samples||supported.length!==grid.length)throw Error('CONUS grid size mismatch');
 mesh=G.mesh(grid);outsideFill=outsideArea();
 $('scCase').innerHTML=index.cases.map(c=>'<option value="'+esc(c.id)+'">'+esc(caseLabel(c))+'</option>').join('');$('scCase').disabled=false;
 const replay=index.cases.find(c=>c.case_type==='active')||index.cases[0];$('scCase').value=replay.id;
 benchmark();coverageNote();
 await createMap(lastView);await loadCase();
}catch(e){loaded=false;status('CONUS research preview unavailable: '+e.message,true);}finally{host.setAttribute('aria-busy','false');}}
async function loadCase(){const seq=++request,c=index.cases.find(x=>x.id===$('scCase').value);values=null;active=null;reports=null;if(popup)popup.remove();draw();try{
 if(!cache.has(c.id))cache.set(c.id,fetchJson(c.file,c.sha256).catch(e=>{cache.delete(c.id);throw e;}));const data=await cache.get(c.id);if(seq!==request)return;
 const w=data.probabilities&&data.probabilities.wind;if(!Array.isArray(w)||w.length!==grid.length||data.id!==c.id||Number(data.day)!==2)throw Error('Case identity or size mismatch');
 values=w;active={...c,data};meta();draw();restore();status((c.kind==='current'?'Saved forecast (does not update)':'Replay of '+c.issue_date)+' · click the map to read a point.');
 loadReports(c,seq);
}catch(e){if(seq!==request)return;status('Could not load this CONUS case: '+e.message+'. No probability is shown.',true);}}
function meta(){const c=active,d=c.data;
 $('scWindow').innerHTML=(c.kind==='current'?'<span class="sc-kind sc-kind-saved">SAVED FORECAST</span>':'<span class="sc-kind">REPLAY</span>')+' Valid '+esc(eastern(d.valid_start))+' → '+esc(eastern(d.valid_end));
 $('scCycle').textContent='HRRR '+utc(d.model_init_time)+' run (f24–48) · Day 2 · '+utc(d.valid_start)+' – '+utc(d.valid_end)+(c.kind==='current'?' · fixed snapshot, does not update':'');
 $('scCaseNote').textContent=c.description;reportUi();}
function coverageNote(){const v=index.coverage;$('scCoverage').textContent='Coverage: '+n(v.supported)+' of '+n(v.samples)+' grid points (within 25 miles of US land). The neutral tint marks grid points beyond that; areas off the grid have no forecast. Blank inside coverage means below 0.1%.';$('scDefinition').textContent='Chance of a ≥50 kt thunderstorm wind report within 25 miles of a point during the 24-hour window. Unshaded inside the US: below 0.1%. Water and areas outside the lower 48 are not shaded.';}
function benchmark(){const b=index.benchmark,names={conus:'All CONUS',original_box:'Old regional box',plains_outside_box:'Plains (outside box)',northeast_outside_box:'Northeast (outside box)',west:'West',florida_gulf_south:'Florida / Gulf'};const f=x=>x==null?'—':(x*100).toFixed(1)+'%',s=x=>x==null?'—':(x>=0?'+':'')+x.toFixed(3);
 $('scBench').innerHTML='<thead><tr><th>Region</th><th>Report days</th><th>Skill vs base rate: candidate / NadoCast</th><th>Reports caught at 5%: candidate / NadoCast</th></tr></thead><tbody>'+Object.keys(names).filter(k=>b.regions[k]).map(k=>{const r=b.regions[k];return '<tr><th>'+names[k]+'</th><td>'+r.report_days+'</td><td>'+s(r.candidate.bss)+' / '+s(r.nadocast.bss)+'</td><td>'+f(r.candidate.pod_5pct)+' / '+f(r.nadocast.pod_5pct)+'</td></tr>';}).join('')+'</tbody>';
 const box=b.regional_box_vs_live_v07;$('scBenchNote').textContent='Source: '+b.source+'. Inside the old regional box the candidate beat live v0.7 (Brier '+box.candidate_minus_live_brier.toFixed(5)+', 95% '+box.candidate_minus_live_brier_95.map(x=>x.toFixed(5)).join(' to ')+'). It trails NadoCast nationally and in the West; Florida/Gulf has no skill for any model and the candidate paints far too much area there.';}

/* ---------- drawing ---------- */
function draw(){if(!ready)return;showUnavailable();const ok=available()&&values;
 if(ok){const key=active.id;if(!contourCache.has(key))contourCache.set(key,{fills:G.contours(mesh,values),lines:G.isolines(mesh,values)});const s=contourCache.get(key);map.getSource('sc-fill').setData(s.fills);map.getSource('sc-lines').setData(s.lines);}
 else{map.getSource('sc-fill').setData(none());map.getSource('sc-lines').setData(none());}
 const pts=(f)=>({type:'FeatureCollection',features:grid.map((c,i)=>f(i)?{type:'Feature',properties:{},geometry:{type:'Point',coordinates:c}}:null).filter(Boolean)});
 map.getSource('sc-outside').setData(grid?outsideFill:none());
 map.getSource('sc-unavail').setData(ok?pts(i=>supported[i]&&(values[i]===null)):none());
 const replay=ok&&active.kind==='replay';
 const near=replay&&active.data.observed?active.data.observed.report_sample_indices:[];
 map.getSource('sc-near').setData({type:'FeatureCollection',features:near.map(i=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:grid[i]}}))});
 map.setLayoutProperty('sc-near','visibility',replay&&showNear?'visible':'none');
 map.getSource('sc-reports').setData(replay?reportFeatures():none());
 for(const id of ['sc-clusters','sc-cluster-count','sc-report'])map.setLayoutProperty(id,'visibility',replay&&showReports?'visible':'none');
 for(const id of ['sc-counties','sc-counties-edge'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',showCounties?'visible':'none');
 map.triggerRepaint();showSample();}
function select(coord,name){if(!inLand(coord[0],coord[1])){selected=null;offGrid=false;offDisplay=true;focusName='Outside display area';showSample();return;}offDisplay=false;const i=nearest(...coord);selected=i;offGrid=i===null;focusName=i===null?'Outside coverage (no grid point within 12 km)':name;showSample();}
function inspectLocation(move){const l=O&&O.location;if(!l)return;select([+l.lon,+l.lat],'Nearest point to '+l.name);if(move&&selected!==null&&map)map.easeTo({center:grid[selected],zoom:7,duration:400});}
function restore(){if(selected===null&&!focusName)inspectLocation(false);else showSample();}
function showSample(){$('scSample').textContent=focusName||'Saved location';if(!available()){$('scValue').textContent='—';$('scState').textContent='Not available: switch to Day 2 damaging wind, or go back to Regional.';}else{const s=state(selected);$('scValue').textContent=values?s.text:'—';$('scState').textContent=s.kind==='offdisplay'?'Water or outside the lower 48. The preview shades US land only; forecast values and storm reports are unchanged.':s.kind==='outside'?'Outside coverage: more than 25 miles from US land or off the grid. Not a zero-risk result.':s.kind==='unavailable'?'Data unavailable for this point in this run.':s.kind==='below'?s.note+'.':s.kind==='value'?'Damaging wind chance within 25 miles':'';}
 $('scCoords').textContent=selected!==null?grid[selected][1].toFixed(3)+'°, '+grid[selected][0].toFixed(3)+'° · sampled grid center':'No grid point selected.';
 if(!ready)return;const c=selected!==null?grid[selected]:null;map.getSource('sc-ring').setData(c?C.ring(...c):none());map.getSource('sc-sel').setData(c?{type:'Feature',properties:{},geometry:{type:'Point',coordinates:c}}:none());}

/* ---------- mode switching (preserve location and zoom) ---------- */
function setMode(next,opts={}){if(next===mode&&!opts.force)return;const bridge=window.SevereDailyBridge;
 if(next==='conus'){const v=bridge&&bridge.get?bridge.get():null;if(v){if(v.day)day=v.day;if(v.hazard)hazard=v.hazard;if(opts.direct){day=2;hazard='wind';}lastView=v.center?{center:v.center,zoom:Math.max(2.5,v.zoom)}:null;if(v.coord){selected=null;focusName='';}}
  mode='conus';host.classList.add('sc-conus');$('scBody').hidden=false;syncButtons();
  init().then(()=>{if(map){map.resize();if(lastView)map.jumpTo(lastView);}if(v&&v.coord)select(v.coord,'Selected map point');draw();});
 }else{mode='regional';host.classList.remove('sc-conus');$('scBody').hidden=true;syncButtons();
  if(bridge&&bridge.set&&map&&ready){const c=map.getCenter();bridge.set({center:[c.lng,c.lat],zoom:Math.min(map.getZoom(),8.5),coord:selected!==null?grid[selected]:null,hazard});}}
 try{history.replaceState(null,'',mode==='conus'?'#severe-conus':'#severe-daily');}catch(e){}}

$('scLegend').innerHTML='<span class="sr-legend-band sr-legend-none"><i title="Below 0.1%: not colored"></i>&lt;0.1%</span>'+G.BANDS.map(([,color,label])=>'<span class="sr-legend-band"><i style="background:'+color+';opacity:.75"></i>'+label+'</span>').join('');
$('scLegend').insertAdjacentHTML('afterend','<div class="sc-keys" id="scKeys"><span class="sc-key"><i class="sc-k-rep"></i>Storm report (numbers: grouped reports)</span><span class="sc-key"><i class="sc-k-sel"></i>Selected point (dashed: 25-mile area)</span><span class="sc-key"><i class="sc-k-out"></i>Outside coverage</span><span class="sc-key"><i class="sc-k-na"></i>Data unavailable</span></div>');
host.querySelectorAll('[data-sc-view]').forEach(b=>b.addEventListener('click',()=>{host.open=true;setMode(b.dataset.scView);}));
host.querySelectorAll('[data-sc-hazard]').forEach(b=>b.addEventListener('click',()=>{hazard=b.dataset.scHazard;syncButtons();draw();}));
$('scDay').addEventListener('change',()=>{day=+$('scDay').value;syncButtons();draw();});
$('scCase').addEventListener('change',loadCase);
$('scReports').addEventListener('change',()=>{showReports=$('scReports').checked;if(!showReports&&popup)popup.remove();draw();});
$('scCounties').addEventListener('change',()=>{showCounties=$('scCounties').checked;draw();});
$('scNear').addEventListener('change',()=>{showNear=$('scNear').checked;draw();});
$('scBack').addEventListener('click',()=>setMode('regional'));
$('scWind').addEventListener('click',()=>{day=2;hazard='wind';syncButtons();draw();});
$('scLocation').addEventListener('click',()=>inspectLocation(true));
$('scWhole').addEventListener('click',()=>{if(map)map.fitBounds([[-125,24],[-66.5,49.5]],{padding:16,duration:400});});
$('scPeak').addEventListener('click',()=>{if(!values||!available())return;let b=null;values.forEach((p,i)=>{if(supported[i]&&(!onLand||onLand[i])&&C.available(p)&&(b===null||p>values[b]))b=i;});if(b!==null){offDisplay=false;selected=b;focusName='Highest point in this case';showSample();map.easeTo({center:grid[b],zoom:6,duration:400});}});
$('scAboutLink').addEventListener('click',e=>{e.preventDefault();$('scAbout').open=true;$('scAbout').scrollIntoView({block:'start',behavior:'smooth'});});
window.addEventListener('ops:research-location',()=>{if(mode==='conus')inspectLocation(false);});
function anchor(){if(location.hash==='#severe-conus'){host.open=true;setMode('conus',{force:true,direct:true});host.scrollIntoView({block:'start'});}}
window.addEventListener('hashchange',anchor);anchor();
window.SevereConusPreview={state:()=>({mode,day,hazard,selected,case:active&&active.id,value:selected!==null&&values?values[selected]:undefined,kind:state(selected).kind,ready,reports:reports?reports.list.length:null,
  view:map&&ready?{center:map.getCenter().toArray(),zoom:map.getZoom()}:null}),
 select:(lon,lat)=>select([lon,lat],'Test point'),setMode,
 view:(center,zoom)=>new Promise(res=>{if(!map)return res(false);map.once('idle',()=>res(true));map.jumpTo({center,zoom});}),
 project:(lon,lat)=>{const p=map.project([lon,lat]),r=map.getCanvas().getBoundingClientRect();return[r.left+p.x,r.top+p.y];},
 debug:()=>({showReports,src:map&&map.getSource('sc-reports')?(map.getSource('sc-reports').serialize().data.features||[]).length:null}),style:()=>({compact:$('scMap').clientWidth<560,clusterRadius:map.getPaintProperty('sc-clusters','circle-radius'),selColor:map.getPaintProperty('sc-sel','circle-stroke-color'),selFill:map.getPaintProperty('sc-sel','circle-color'),reportColor:map.getPaintProperty('sc-report','circle-color'),attribOpen:!!map.getContainer().querySelector('.maplibregl-compact-show')}),inLand:(x,y)=>inLand(x,y),gridPoint:i=>grid&&i!=null?grid[i]:null,landReady:()=>!!landPolys,rendered:(layer)=>map&&map.getLayer(layer)?map.queryRenderedFeatures({layers:[layer]}).length:-1,
 report:(id)=>reports&&reports.byId.get(String(id))||null,reportList:()=>reports?reports.list:null};
})();
