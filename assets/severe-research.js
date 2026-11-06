/* Nadocast-style interaction for verified HISTORICAL development outputs. No live probability feed. */
(function(){
'use strict';
const host=document.getElementById('severe-research');if(!host)return;
const O=window.Ops,C=window.SevereResearchCore,G=window.SevereResearchContours,$=id=>document.getElementById(id),N={tornado:'Tornado',wind:'Severe wind',hail:'Severe hail'};
const base='assets/severe-research/',empty={type:'FeatureCollection',features:[]};
let index,grid,values,activeRun,map,readyMap=false,selected=null,hazard='tornado',initializing=null,request=0,focusName='Saved location',mapError='';
const cache=new Map(),contourCache=new Map();
let display='contours',displayMesh,opacity=.85,basemap='light';
const status=(message,error=false)=>{$('srStatus').textContent=message;$('srStatus').dataset.error=String(error);};
async function json(path){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(base+path,{signal:controller.signal,cache:'no-cache'});if(!response.ok)throw Error('Archive request failed ('+response.status+')');return await response.json();}finally{clearTimeout(timer);}}
const eastern=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
function clearValues(){values=null;$('srValue').textContent='—';$('srCoordinates').textContent='';if(readyMap){map.getSource('sr-probabilities').setData(empty);map.getSource('sr-contours').setData(empty);map.getSource('sr-ring').setData(empty);map.getSource('sr-selected').setData(empty);}}
async function loadCase(){const seq=++request,run=index.runs.find(r=>r.id===$('srRun').value);clearValues();activeRun=null;host.setAttribute('aria-busy','true');$('srWindow').textContent='Loading historical window…';$('srRetry').hidden=true;status('Loading archived probabilities…');try{if(!cache.has(run.id))cache.set(run.id,json(run.file+'?v='+run.sha256.slice(0,10)).catch(e=>{cache.delete(run.id);throw e;}));const data=await cache.get(run.id);if(seq!==request)return;values=C.validateCase(data,run,grid.length);activeRun=run;$('srWindow').textContent=eastern(run.valid_start)+' → '+eastern(run.valid_end);$('srInit').textContent='Initialized '+run.model_init_time.slice(11,16)+' UTC · 4 hours';status(mapError||'Historical replay · '+run.date+' · Click a sampled point or inspect your saved location.',!!mapError);draw();inspectLocation(false);}catch(error){if(seq!==request)return;clearValues();$('srWindow').textContent='Historical case unavailable';$('srRetry').hidden=false;status('Could not load this archived case. '+error.message+'. No probability is available.',true);}finally{if(seq===request)host.setAttribute('aria-busy','false');}}
function palette(){const light=basemap==='light'||basemap==='site'&&document.documentElement.dataset.theme==='light';return{land:light?'#f1f2ee':'#151a22',line:light?'#353c47':'#cfd5de',county:light?'#b9bec6':'#3a4250',road:light?'#c08436':'#6d5a3c',water:light?'#e4edf8':'#192b3b',river:light?'#5f9bd0':'#2d5d86',text:light?'#172438':'#e7ecf3',halo:light?'#fff':'#101720'};}
function theme(){if(!readyMap)return;const p=palette();for(const [id,prop,value] of [['sr-background','background-color',p.land],['sr-states','line-color',p.line],['sr-lakes','fill-color',p.water],['sr-counties','line-color',p.county],['sr-roads','line-color',p.road],['sr-rivers','line-color',p.river],['sr-cities','text-color',p.text],['sr-cities','text-halo-color',p.halo],['sr-ring','line-color',p.text],['sr-selected','circle-color',p.land],['sr-selected','circle-stroke-color',p.text]])map.setPaintProperty(id,prop,value);presentation();}
function presentation(){
 host.querySelectorAll('[data-sr-display]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.srDisplay===display)));
 $('srDisplayNote').textContent=(display==='dots'?'Dots show original samples about 15 km apart, without interpolation.':'Filled contours linearly interpolate between samples about 15 km apart. '+(display==='both'?'Dots mark the original samples. ':''))+'Point readouts always use an original sample. Values below 0.1% are transparent; unavailable values are never zero.';
 if(!readyMap)return;
 for(const id of ['sr-fill','sr-contour-lines','sr-contour-labels'])map.setLayoutProperty(id,'visibility',display==='dots'?'none':'visible');
 map.setLayoutProperty('sr-points','visibility',display==='contours'?'none':'visible');
 const colors=['match',['get','color']];for(const [,color] of G.BANDS)colors.push(color,G.blend(color,palette().land,opacity));colors.push('#ffffff');map.setPaintProperty('sr-fill','fill-color',colors);map.setPaintProperty('sr-fill','fill-opacity',1);map.setPaintProperty('sr-points','circle-opacity',opacity);
}
async function createMap(){let states,lakes,detail;try{
 [states,lakes,detail]=await Promise.all([json('states.json'),json('lakes.json'),json('../maps/basemap.json')]);
 if(!window.maplibregl)throw Error('WebGL map library unavailable');const p=palette();
 map=new maplibregl.Map({container:'srMap',center:[-87.5,37.5],zoom:4,minZoom:3,maxZoom:8.5,renderWorldCopies:false,dragRotate:false,pitchWithRotate:false,attributionControl:false,style:{version:8,glyphs:new URL('assets/maps/fonts/open-sans-v1/{fontstack}/{range}.pbf',location.href).href.replace(/%7B/g,'{').replace(/%7D/g,'}'),sources:{},layers:[{id:'sr-background',type:'background',paint:{'background-color':p.land}}]}});
 map.touchZoomRotate.disableRotation();map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
 map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'Research v0.2 · NOAA HRRR / NCEI · US Census / us-atlas · Natural Earth'}),'bottom-left');
 map.on('load',()=>{
  for(const [id,data] of [['sr-states',states],['sr-lakes',lakes],['sr-counties',detail.layers.counties],['sr-roads',detail.layers.roads],['sr-rivers',detail.layers.rivers],['sr-probabilities',empty],['sr-contours',empty],['sr-ring',empty],['sr-selected',empty]])map.addSource(id,{type:'geojson',data});
  map.addLayer({id:'sr-fill',type:'fill',source:'sr-contours',paint:{'fill-color':['get','color'],'fill-opacity':opacity}});
  map.addLayer({id:'sr-lakes',type:'fill',source:'sr-lakes',paint:{'fill-color':p.water}});
  const steps=['step',['get','p'],'#f1f1f1'];G.BANDS.forEach(([v,c])=>steps.push(v,c));
  map.addLayer({id:'sr-points',type:'circle',source:'sr-probabilities',filter:['all',['!=',['get','p'],null],['>=',['get','p'],.001]],paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.5,6,3,8.5,6],'circle-opacity':opacity,'circle-color':steps,'circle-stroke-color':'#222','circle-stroke-width':.35}});
  for(const [id,key,minzoom,width] of [['sr-counties','county',6,.55],['sr-rivers','river',5.5,1],['sr-roads','road',6,1]])map.addLayer({id,type:'line',source:id,minzoom,paint:{'line-color':p[key],'line-width':width,'line-opacity':.65}});
  map.addLayer({id:'sr-contour-lines',type:'line',source:'sr-contours',paint:{'line-color':'#222','line-width':1,'line-opacity':.8}});
  map.addLayer({id:'sr-states',type:'line',source:'sr-states',paint:{'line-color':p.line,'line-width':1,'line-opacity':.85}});
  map.addLayer({id:'sr-contour-labels',type:'symbol',source:'sr-contours',filter:['>=',['get','threshold'],.02],layout:{'symbol-placement':'line','symbol-spacing':240,'text-field':['concat',['to-string',['*',['get','threshold'],100]],'%'],'text-font':['Open Sans Semibold'],'text-size':10,'text-padding':12},paint:{'text-color':'#171717','text-halo-color':'#fff','text-halo-width':1.5}});
  const cities=[['Cincinnati',-84.51,39.10],['Columbus',-83.00,39.96],['Indianapolis',-86.16,39.77],['Chicago',-87.63,41.88],['St. Louis',-90.20,38.63],['Louisville',-85.76,38.25],['Nashville',-86.78,36.16],['Memphis',-90.05,35.15],['Atlanta',-84.39,33.75],['Dallas',-96.80,32.78],['Washington',-77.04,38.90],['Raleigh',-78.64,35.78],['Detroit',-83.05,42.33],['Pittsburgh',-80.00,40.44]];
  map.addSource('sr-cities',{type:'geojson',data:{type:'FeatureCollection',features:cities.map(([name,lon,lat])=>({type:'Feature',properties:{name},geometry:{type:'Point',coordinates:[lon,lat]}}))}});
  map.addLayer({id:'sr-cities',type:'symbol',source:'sr-cities',layout:{'text-field':['get','name'],'text-font':['Open Sans Semibold'],'text-size':11,'text-padding':12},paint:{'text-color':p.text,'text-halo-color':p.halo,'text-halo-width':1.5}});
  map.addLayer({id:'sr-ring',type:'line',source:'sr-ring',paint:{'line-color':p.text,'line-width':2,'line-dasharray':[3,2]}});
  map.addLayer({id:'sr-selected',type:'circle',source:'sr-selected',paint:{'circle-color':p.land,'circle-radius':5,'circle-stroke-color':p.text,'circle-stroke-width':2}});
  readyMap=true;presentation();draw();showSample();map.fitBounds([[-100,30],[-75,45]],{padding:20,duration:0});
 });
 map.on('click',e=>selectCoordinate([e.lngLat.lng,e.lngLat.lat]));
 map.on('error',()=>status('A map layer could not load. Saved-location probabilities remain available.',true));
 }catch(error){if(states&&lakes&&detail&&window.createSevereResearchCanvas){
  map=window.createSevereResearchCanvas('srMap',states,{palette,lakes,detail,opacity:()=>opacity,onClick:selectCoordinate});readyMap=true;mapError='';presentation();draw();showSample();map.fitBounds([[-100,30],[-75,45]]);
 }else{mapError='The map could not load. Saved-location values remain available.';status(mapError,true);}}}
function selectCoordinate(coordinates){const found=C.nearest(grid,...coordinates);selected=found?found.index:null;focusName=found?'Selected map sample':'Outside the sampled grid';showSample();}
function draw(){if(!values||!readyMap)return;
 map.getSource('sr-probabilities').setData({type:'FeatureCollection',features:grid.map((coordinates,i)=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{p:values[hazard][i]}}))});
 if(display!=='dots'){
  if(!displayMesh)displayMesh=G.mesh(grid);
  const key=activeRun.id+'|'+hazard;if(!contourCache.has(key)){if(contourCache.size>=6)contourCache.delete(contourCache.keys().next().value);contourCache.set(key,G.contours(displayMesh,values[hazard]));}
  map.getSource('sr-contours').setData(contourCache.get(key));
 }
 $('srLegendHazard').textContent={tornado:'tornado',wind:'severe wind',hail:'severe hail'}[hazard];showSample();}
function showSample(){const p=selected===null||!values?null:values[hazard][selected];$('srSample').textContent=focusName;$('srHazardName').textContent=N[hazard]+' probability';$('srValue').textContent=values?C.percent(p):'—';if(selected!==null&&values){const [lon,lat]=grid[selected];$('srCoordinates').textContent=lat.toFixed(4)+'°, '+lon.toFixed(4)+'° · sampled grid center';}else $('srCoordinates').textContent=values?'No nearby archive sample. This is not a zero-risk result.':'';
if(readyMap){const coordinates=selected!==null&&values?grid[selected]:null;map.getSource('sr-ring').setData(coordinates?C.ring(...coordinates):empty);map.getSource('sr-selected').setData(coordinates?{type:'Feature',properties:{},geometry:{type:'Point',coordinates}}:empty);}}
function inspectLocation(move){if(!grid)return;const loc=O.location,found=C.nearest(grid,+loc.lon,+loc.lat);selected=found?found.index:null;focusName=found?'Nearest sample to '+loc.name:'Saved location outside archive coverage';showSample();if(move&&found&&map)map.easeTo({center:grid[selected],zoom:6,duration:400});}
function evidence(){const b=index.validation;const names={model:'Research model',global:'Training rate',seasonal_spatial:'Seasonal / area rate',uh:'Calibrated UH'};$('srEvidenceTable').innerHTML='<thead><tr><th>Hazard</th><th>Positive days</th>'+Object.values(names).map(n=>'<th>'+n+'</th>').join('')+'</tr></thead><tbody>'+C.HAZARDS.map(h=>'<tr><th>'+N[h]+'</th><td>'+b[h].positive_days+' / 12</td>'+Object.keys(names).map(k=>'<td>'+(Number.isFinite(b[h].brier[k])?b[h].brier[k].toFixed(7):'Unavailable')+'</td>').join('')+'</tr>').join('')+'</tbody>';}
async function init(){if(initializing)return initializing;initializing=(async()=>{try{index=C.validateIndex(await json('index.json'));const data=await json(index.grid.file+'?v='+index.grid.sha256.slice(0,10));grid=data.coordinates;if(!Array.isArray(grid)||!grid.length||grid.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))throw Error('Invalid archive coordinates');$('srRun').innerHTML=index.runs.map(r=>'<option value="'+O.esc(r.id)+'">'+new Date(r.valid_start).toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'})+'</option>').join('');$('srRun').value=index.runs.find(r=>r.date==='2024-05-15')?.id||index.runs[0].id;$('srRun').disabled=false;evidence();createMap();await loadCase();}catch(error){initializing=null;clearValues();$('srRetry').hidden=false;status('Research archive unavailable: '+error.message,true);}})();return initializing;}
$('srLegend').innerHTML=[[0,'#fff','0'],...G.BANDS].map(([,color,label])=>'<span class="sr-legend-band"><i style="background:'+color+'"></i>'+label+'</span>').join('');
presentation();
$('srRun').addEventListener('change',loadCase);
host.querySelectorAll('[data-sr-display]').forEach(button=>button.addEventListener('click',()=>{display=button.dataset.srDisplay;presentation();draw();}));
$('srBasemap').addEventListener('change',()=>{basemap=$('srBasemap').value;theme();});
$('srOpacity').addEventListener('input',()=>{opacity=+$('srOpacity').value/100;$('srOpacityValue').textContent=$('srOpacity').value+'%';presentation();});
host.querySelectorAll('[data-sr-hazard]').forEach(button=>button.addEventListener('click',()=>{hazard=button.dataset.srHazard;host.querySelectorAll('[data-sr-hazard]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));draw();showSample();}));
$('srLocation').addEventListener('click',()=>inspectLocation(true));$('srDomain').addEventListener('click',()=>{if(map)map.fitBounds([[-100,30],[-75,45]],{padding:20,duration:400});});$('srPeak').addEventListener('click',()=>{if(!values)return;selected=C.peak(values[hazard]);focusName='Highest '+N[hazard].toLowerCase()+' sample in this case';showSample();if(selected!==null&&map)map.easeTo({center:grid[selected],zoom:5.5,duration:400});});
$('srRetry').addEventListener('click',()=>index&&grid?loadCase():init());window.addEventListener('ops:research-location',()=>inspectLocation(false));window.addEventListener('ops:theme',theme);
host.addEventListener('toggle',()=>{if(host.open){init();if(map)requestAnimationFrame(()=>map.resize());}});
function anchor(){if(location.hash==='#severe-research'){host.open=true;init();}}
window.addEventListener('hashchange',anchor);anchor();
})();
