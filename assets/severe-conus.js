/* CONUS Severe research preview: Day 2 damaging wind from the frozen CONUS boosted-tree candidate.
   Lives inside the "Daily severe probability research" panel next to the Regional view. Replay cases
   and (when available) one current run come from assets/severe-conus/. Research only. */
(function(){
'use strict';
const host=document.getElementById('severe-daily');if(!host)return;
const O=window.Ops,C=window.SevereResearchCore,G=window.SevereResearchContours,$=id=>document.getElementById(id);
const BASE='assets/severe-conus/',empty={type:'FeatureCollection',features:[]};
const HZ={tornado:'Tornado',wind:'Damaging wind',hail:'Severe hail'};
let offGrid=false,mode='regional',day=2,hazard='wind',index,grid,supported,mesh,map,ready=false,values=null,active=null,selected=null,focusName='',showReports=true,request=0,loaded=false,lastView=null;
const cache=new Map(),contourCache=new Map();
const esc=s=>O&&O.esc?O.esc(s):String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const status=(m,err=false)=>{$('scStatus').textContent=m;$('scStatus').dataset.error=String(err);};
const eastern=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const utc=t=>new Date(t).toISOString().slice(0,16).replace('T',' ')+'Z';
async function fetchJson(file,hash){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),30000);try{const r=await fetch(BASE+file,{signal:ctl.signal,cache:'no-cache'});if(!r.ok)throw Error('CONUS preview data request failed ('+r.status+')');const body=await r.text();if(hash&&crypto.subtle){const d=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');if(d!==hash)throw Error('CONUS preview file checksum changed; refresh');}return JSON.parse(body);}finally{clearTimeout(timer);}}

/* ---------- state per point ---------- */
function state(i){if(i===null||i===undefined)return offGrid?{kind:'outside',text:'Outside coverage'}:{kind:'none',text:'—'};if(!supported[i])return{kind:'outside',text:'Outside coverage'};const p=values?values[i]:null;if(p===null||!C.available(p))return{kind:'unavailable',text:'Data unavailable'};if(p<.001)return{kind:'below',text:'<0.1%',note:'Below the lowest displayed contour (0.1%)'};return{kind:'value',text:C.percent(p)};}
function nearest(lon,lat){if(!grid)return null;let best=-1,d=Infinity;for(let i=0;i<grid.length;i++){const g=grid[i];if(Math.abs(g[1]-lat)>0.4||Math.abs(g[0]-lon)>0.6)continue;const v=C.distance(g,[lon,lat]);if(v<d){d=v;best=i;}}return best>=0&&d<=12?best:null;}

/* ---------- availability ---------- */
const available=()=>day===2&&hazard==='wind';
function syncButtons(){
 host.querySelectorAll('[data-sc-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scView===mode)));
 host.querySelectorAll('[data-sc-hazard]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scHazard===hazard)));
 $('scDay').value=String(day);
}
function showUnavailable(){const box=$('scUnavailable');box.hidden=available();if(!available()){box.querySelector('p').textContent=(day===1?'Day 1':'Day 2')+' '+HZ[hazard].toLowerCase()+' is not available in CONUS research. Only Day 2 damaging wind has a national candidate; Day 1 and tornado/hail stay Regional.';}}

/* ---------- map ---------- */
function palette(){const light=document.documentElement.dataset.theme!=='dark';return{land:light?'#f1f2ee':'#151a22',line:light?'#353c47':'#cfd5de',county:light?'#c4c8ce':'#353d4a',water:light?'#e4edf8':'#192b3b',text:light?'#172438':'#e7ecf3',halo:light?'#fff':'#101720',outside:light?'#9aa0a8':'#6b7380'};}
async function createMap(view){const [states,lakes,detail]=await Promise.all([fetch('assets/severe-research/states.json').then(r=>r.json()),fetch('assets/severe-research/lakes.json').then(r=>r.json()),fetch('assets/maps/basemap.json').then(r=>r.json()).catch(()=>null)]);
 const p=palette();
 map=new maplibregl.Map({container:'scMap',center:view?.center||[-96,38.5],zoom:view?.zoom??3.4,minZoom:2.5,maxZoom:8.5,renderWorldCopies:false,dragRotate:false,pitchWithRotate:false,attributionControl:false,style:{version:8,glyphs:new URL('assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf',location.href).href.replace(/%7B/g,'{').replace(/%7D/g,'}'),sources:{},layers:[{id:'sc-bg',type:'background',paint:{'background-color':p.land}}]}});
 map.touchZoomRotate.disableRotation();map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
 map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'CONUS research preview · NOAA HRRR / NCEI Storm Events · US Census / us-atlas · Natural Earth'}),'bottom-left');
 await new Promise(res=>map.on('load',res));
 const src=[['sc-states',states],['sc-lakes',lakes],['sc-fill',empty],['sc-lines',empty],['sc-outside',empty],['sc-unavail',empty],['sc-reports',empty],['sc-ring',empty],['sc-sel',empty]];
 if(detail&&detail.layers&&detail.layers.counties)src.push(['sc-counties',detail.layers.counties]);
 for(const [id,data] of src)map.addSource(id,{type:'geojson',data});
 map.addLayer({id:'sc-fill',type:'fill',source:'sc-fill',paint:{'fill-color':['get','color'],'fill-opacity':.82}});
 map.addLayer({id:'sc-lakes',type:'fill',source:'sc-lakes',paint:{'fill-color':p.water}});
 if(map.getSource('sc-counties'))map.addLayer({id:'sc-counties',type:'line',source:'sc-counties',minzoom:6,paint:{'line-color':p.county,'line-width':.5,'line-opacity':.6}});
 map.addLayer({id:'sc-outside',type:'circle',source:'sc-outside',paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,.8,7,2.4],'circle-color':p.outside,'circle-opacity':.55}});
 map.addLayer({id:'sc-unavail',type:'circle',source:'sc-unavail',paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.5,7,3.5],'circle-color':'rgba(0,0,0,0)','circle-stroke-color':'#7a2a8c','circle-stroke-width':1}});
 map.addLayer({id:'sc-lines',type:'line',source:'sc-lines',paint:{'line-color':'#222','line-width':['case',['<',['get','threshold'],.01],.5,.9],'line-opacity':.7}});
 map.addLayer({id:'sc-states',type:'line',source:'sc-states',paint:{'line-color':p.line,'line-width':.9,'line-opacity':.85}});
 map.addLayer({id:'sc-labels',type:'symbol',source:'sc-lines',filter:['>=',['get','threshold'],.05],layout:{'symbol-placement':'line','symbol-spacing':260,'text-field':['concat',['to-string',['*',['get','threshold'],100]],'%'],'text-font':['Open Sans Semibold'],'text-size':10,'text-padding':12},paint:{'text-color':'#171717','text-halo-color':'#fff','text-halo-width':1.5}});
 map.addLayer({id:'sc-reports',type:'circle',source:'sc-reports',paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.4,7,3.6],'circle-color':'#08306b','circle-opacity':.85}});
 map.addLayer({id:'sc-ring',type:'line',source:'sc-ring',paint:{'line-color':p.text,'line-width':2,'line-dasharray':[3,2]}});
 map.addLayer({id:'sc-sel',type:'circle',source:'sc-sel',paint:{'circle-color':p.land,'circle-radius':5,'circle-stroke-color':p.text,'circle-stroke-width':2}});
 map.on('click',e=>select([e.lngLat.lng,e.lngLat.lat],'Selected map sample'));
 ready=true;}

/* ---------- loading ---------- */
async function init(){if(loaded)return;loaded=true;host.setAttribute('aria-busy','true');status('Loading CONUS research preview…');try{
 index=await fetchJson('index.json');if(index.schema_version!==1||index.status!=='research_preview'||index.operational_forecast_eligible!==false)throw Error('Unsupported CONUS preview feed');
 const g=await fetchJson(index.grid.file,index.grid.sha256);grid=g.coordinates;supported=g.supported.map(Boolean);if(grid.length!==index.coverage.samples||supported.length!==grid.length)throw Error('CONUS grid size mismatch');
 mesh=G.mesh(grid);
 $('scCase').innerHTML=index.cases.map(c=>'<option value="'+esc(c.id)+'">'+esc((c.kind==='current'?'CURRENT · ':'REPLAY · ')+c.label)+'</option>').join('');$('scCase').disabled=false;
 const replay=index.cases.find(c=>c.case_type==='active')||index.cases[0];$('scCase').value=replay.id;
 benchmark();coverageNote();
 await createMap(lastView);await loadCase();
}catch(e){loaded=false;status('CONUS research preview unavailable: '+e.message,true);}finally{host.setAttribute('aria-busy','false');}}
async function loadCase(){const seq=++request,c=index.cases.find(x=>x.id===$('scCase').value);values=null;active=null;draw();try{
 if(!cache.has(c.id))cache.set(c.id,fetchJson(c.file,c.sha256).catch(e=>{cache.delete(c.id);throw e;}));const data=await cache.get(c.id);if(seq!==request)return;
 const w=data.probabilities&&data.probabilities.wind;if(!Array.isArray(w)||w.length!==grid.length||data.id!==c.id||data.day!==2)throw Error('Case identity or size mismatch');
 values=w;active={...c,data};meta();draw();restore();status((c.kind==='current'?'Current research run':'Replay of '+c.issue_date)+' · click any sample, or inspect your saved location.');
}catch(e){if(seq!==request)return;status('Could not load this CONUS case: '+e.message+'. No probability is shown.',true);}}
function meta(){const c=active,d=c.data;$('scWindow').textContent=(c.kind==='current'?'CURRENT RUN · ':'REPLAY · '+c.issue_date+' · ')+eastern(d.valid_start)+' → '+eastern(d.valid_end);
 $('scCycle').textContent='Cycle: HRRR '+utc(d.model_init_time)+' (12Z, f24–48) · Day 2 · 24-hour window '+utc(d.valid_start)+' – '+utc(d.valid_end);
 $('scCaseNote').textContent=c.description+(c.kind==='replay'?' · '+(c.report_points||0).toLocaleString('en-US')+' samples had a qualifying report within 25 miles.':'');
 $('scReportsWrap').hidden=c.kind!=='replay';}
function coverageNote(){const v=index.coverage;$('scCoverage').textContent='Coverage: '+v.supported.toLocaleString('en-US')+' of '+v.samples.toLocaleString('en-US')+' samples (within 25 miles of US land). '+v.outside.toLocaleString('en-US')+' offshore samples and everything off the grid are outside coverage.';$('scDefinition').textContent=index.product.definition+'.';}
function benchmark(){const b=index.benchmark,names={conus:'All CONUS',original_box:'Old regional box',plains_outside_box:'Plains (outside box)',northeast_outside_box:'Northeast (outside box)',west:'West',florida_gulf_south:'Florida / Gulf'};const f=x=>x==null?'—':(x*100).toFixed(1)+'%',s=x=>x==null?'—':(x>=0?'+':'')+x.toFixed(3);
 $('scBench').innerHTML='<thead><tr><th>Region</th><th>Report days</th><th>Skill vs base rate: candidate / NadoCast</th><th>Reports caught at 5%: candidate / NadoCast</th></tr></thead><tbody>'+Object.keys(names).filter(k=>b.regions[k]).map(k=>{const r=b.regions[k];return '<tr><th>'+names[k]+'</th><td>'+r.report_days+'</td><td>'+s(r.candidate.bss)+' / '+s(r.nadocast.bss)+'</td><td>'+f(r.candidate.pod_5pct)+' / '+f(r.nadocast.pod_5pct)+'</td></tr>';}).join('')+'</tbody>';
 const box=b.regional_box_vs_live_v07;$('scBenchNote').textContent='Source: '+b.source+'. Inside the old regional box the candidate beat live v0.7 (Brier '+box.candidate_minus_live_brier.toFixed(5)+', 95% '+box.candidate_minus_live_brier_95.map(x=>x.toFixed(5)).join(' to ')+'). It trails NadoCast nationally and in the West; Florida/Gulf has no skill for any model and the candidate paints far too much area there.';}

/* ---------- drawing ---------- */
function draw(){if(!ready)return;showUnavailable();const ok=available()&&values;
 if(ok){const key=active.id;if(!contourCache.has(key))contourCache.set(key,{fills:G.contours(mesh,values),lines:G.isolines(mesh,values)});const s=contourCache.get(key);map.getSource('sc-fill').setData(s.fills);map.getSource('sc-lines').setData(s.lines);}
 else{map.getSource('sc-fill').setData(empty);map.getSource('sc-lines').setData(empty);}
 const pts=(f)=>({type:'FeatureCollection',features:grid.map((c,i)=>f(i)?{type:'Feature',properties:{},geometry:{type:'Point',coordinates:c}}:null).filter(Boolean)});
 map.getSource('sc-outside').setData(grid?pts(i=>!supported[i]):empty);
 map.getSource('sc-unavail').setData(ok?pts(i=>supported[i]&&(values[i]===null)):empty);
 const rep=ok&&showReports&&active.data.observed?active.data.observed.report_sample_indices:[];
 map.getSource('sc-reports').setData({type:'FeatureCollection',features:rep.map(i=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:grid[i]}}))});
 showSample();}
function select(coord,name){const i=nearest(...coord);selected=i;offGrid=i===null;focusName=i===null?'Outside coverage (no CONUS sample within 12 km)':name;showSample();}
function inspectLocation(move){const l=O&&O.location;if(!l)return;select([+l.lon,+l.lat],'Nearest sample to '+l.name);if(move&&selected!==null&&map)map.easeTo({center:grid[selected],zoom:6,duration:400});}
function restore(){if(selected===null&&!focusName)inspectLocation(false);else showSample();}
function showSample(){$('scSample').textContent=focusName||'Saved location';if(!available()){$('scValue').textContent='Not available';$('scState').textContent='Switch to Day 2 damaging wind, or go back to Regional.';}else{const s=state(selected);$('scValue').textContent=values?s.text:'—';$('scState').textContent=s.kind==='outside'?'Outside coverage: more than 25 miles from US land or off the CONUS grid. This is not a zero-risk result.':s.kind==='unavailable'?'Data unavailable for this sample in this run.':s.kind==='below'?s.note+'.':s.kind==='value'?'Damaging wind probability (≥50 kt report within 25 miles, 24 hours).':'';}
 $('scCoords').textContent=selected!==null?grid[selected][1].toFixed(3)+'°, '+grid[selected][0].toFixed(3)+'° · sampled grid center':'';
 if(!ready)return;const c=selected!==null?grid[selected]:null;map.getSource('sc-ring').setData(c?C.ring(...c):empty);map.getSource('sc-sel').setData(c?{type:'Feature',properties:{},geometry:{type:'Point',coordinates:c}}:empty);}

/* ---------- mode switching (preserve location and zoom) ---------- */
function setMode(next,opts={}){if(next===mode&&!opts.force)return;const bridge=window.SevereDailyBridge;
 if(next==='conus'){const v=bridge&&bridge.get?bridge.get():null;if(v){if(v.day)day=v.day;if(v.hazard)hazard=v.hazard;if(opts.direct){day=2;hazard='wind';}lastView=v.center?{center:v.center,zoom:Math.max(2.5,v.zoom)}:null;if(v.coord){selected=null;focusName='';}}
  mode='conus';host.classList.add('sc-conus');$('scBody').hidden=false;syncButtons();
  init().then(()=>{if(map){map.resize();if(lastView)map.jumpTo(lastView);}if(v&&v.coord)select(v.coord,'Selected map sample');draw();});
 }else{mode='regional';host.classList.remove('sc-conus');$('scBody').hidden=true;syncButtons();
  if(bridge&&bridge.set&&map&&ready){const c=map.getCenter();bridge.set({center:[c.lng,c.lat],zoom:map.getZoom(),coord:selected!==null?grid[selected]:null,hazard});}}
 try{history.replaceState(null,'',mode==='conus'?'#severe-conus':'#severe-daily');}catch(e){}}

$('scLegend').innerHTML='<span class="sr-legend-band sr-legend-none"><i title="Below 0.1%: not colored"></i>Below 0.1%: no color</span>'+G.BANDS.map(([,color,label])=>'<span class="sr-legend-band"><i style="background:'+color+'"></i>'+label+'</span>').join('')+'<span class="sc-key"><i class="sc-k-out"></i>Outside coverage (grey dots, or no samples)</span><span class="sc-key"><i class="sc-k-na"></i>Data unavailable</span><span class="sc-key"><i class="sc-k-rep"></i>Observed report within 25 mi (replay)</span>';
host.querySelectorAll('[data-sc-view]').forEach(b=>b.addEventListener('click',()=>{host.open=true;setMode(b.dataset.scView);}));
host.querySelectorAll('[data-sc-hazard]').forEach(b=>b.addEventListener('click',()=>{hazard=b.dataset.scHazard;syncButtons();draw();}));
$('scDay').addEventListener('change',()=>{day=+$('scDay').value;syncButtons();draw();});
$('scCase').addEventListener('change',loadCase);
$('scReports').addEventListener('change',()=>{showReports=$('scReports').checked;draw();});
$('scBack').addEventListener('click',()=>setMode('regional'));
$('scWind').addEventListener('click',()=>{day=2;hazard='wind';syncButtons();draw();});
$('scLocation').addEventListener('click',()=>inspectLocation(true));
$('scWhole').addEventListener('click',()=>{if(map)map.fitBounds([[-125,24],[-66.5,49.5]],{padding:16,duration:400});});
$('scPeak').addEventListener('click',()=>{if(!values||!available())return;let b=null;values.forEach((p,i)=>{if(supported[i]&&C.available(p)&&(b===null||p>values[b]))b=i;});if(b!==null){selected=b;focusName='Highest sample in this case';showSample();map.easeTo({center:grid[b],zoom:5.5,duration:400});}});
window.addEventListener('ops:research-location',()=>{if(mode==='conus')inspectLocation(false);});
function anchor(){if(location.hash==='#severe-conus'){host.open=true;setMode('conus',{force:true,direct:true});host.scrollIntoView({block:'start'});}}
window.addEventListener('hashchange',anchor);anchor();
window.SevereConusPreview={state:()=>({mode,day,hazard,selected,case:active&&active.id,value:selected!==null&&values?values[selected]:undefined,kind:state(selected).kind,ready,view:map&&ready?{center:map.getCenter().toArray(),zoom:map.getZoom()}:null}),select:(lon,lat)=>select([lon,lat],'Test sample'),setMode};
})();
