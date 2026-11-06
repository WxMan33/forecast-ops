/* Canvas map fallback for browsers without WebGL. Same archived sample centers and probabilities. */
(function(){'use strict';
window.createSevereResearchCanvas=function(container,states,options){
 const C=window.SevereResearchCore,G=window.SevereResearchContours,sources=new Map(),layouts=new Map(),paint=new Map(),el=document.getElementById(container);
 el.classList.remove('maplibregl-map');el.innerHTML='<canvas tabindex="0" role="img" aria-label="Historical probability map. Drag to pan; use zoom buttons and the saved-location or highest-sample buttons to inspect values."></canvas><div class="sr-canvas-controls"><button type="button" aria-label="Zoom research map in">+</button><button type="button" aria-label="Zoom research map out">−</button></div><div class="sr-canvas-credit">NOAA HRRR / NCEI · US Census / us-atlas</div>';
 el.dataset.renderer='canvas';el.style.position='relative';
 const cv=el.querySelector('canvas'),ctx=cv.getContext('2d');cv.style.cssText='display:block;width:100%;height:100%;touch-action:none;cursor:grab';
 let center=[-87.5,37.5],zoom=4,width=0,height=0,drag=null,pending=false;
 const visible=id=>layouts.get(id)!=='none';
 const redraw=()=>{if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;draw();});}};
 const project=([lon,lat])=>[(lon+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2];
 const inverse=([x,y])=>[x*360-180,(2*Math.atan(Math.exp((1-2*y)*Math.PI))-Math.PI/2)*180/Math.PI];
 const point=xy=>{const p=project(xy),o=project(center),scale=512*2**zoom;return[(p[0]-o[0])*scale+width/2,(p[1]-o[1])*scale+height/2];};
 const coord=xy=>{const o=project(center),scale=512*2**zoom;return inverse([o[0]+(xy[0]-width/2)/scale,o[1]+(xy[1]-height/2)/scale]);};
 const lines=g=>!g?[]:g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'||g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():[];
 function polygon(geometry,fill,stroke){for(const poly of geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates){ctx.beginPath();for(const ring of poly)ring.forEach((p,i)=>{const [x,y]=point(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.fillStyle=fill;if(fill)ctx.fill('evenodd');if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.9;ctx.stroke();}}}
 function path(line){ctx.beginPath();line.forEach((p,i)=>{const [x,y]=point(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
 function draw(){width=el.clientWidth;height=el.clientHeight;if(!width||!height)return;const dpr=devicePixelRatio||1;if(cv.width!==Math.round(width*dpr)||cv.height!==Math.round(height*dpr)){cv.width=Math.round(width*dpr);cv.height=Math.round(height*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);const p=options.palette();ctx.fillStyle=p.land;ctx.fillRect(0,0,width,height);
  const contours=sources.get('sr-contours')?.features||[];
  if(visible('sr-fill')){for(const f of contours)polygon(f.geometry,G.blend(f.properties.color,p.land,options.opacity()),null);}
  if(visible('sr-contour-lines'))for(const f of contours)polygon(f.geometry,null,'#222');
  for(const f of options.lakes.features)polygon(f.geometry,p.water,null);
  const dots=sources.get('sr-probabilities')?.features||[];ctx.globalAlpha=paint.get('sr-points:circle-opacity')??.85;
  if(visible('sr-points'))for(const f of dots){const v=f.properties.p;if(!C.available(v)||v<.001)continue;const [x,y]=point(f.geometry.coordinates);if(x< -10||y< -10||x>width+10||y>height+10)continue;ctx.fillStyle=G.color(v);ctx.beginPath();ctx.arc(x,y,Math.min(6,Math.max(1.5,zoom-3)),0,2*Math.PI);ctx.fill();ctx.strokeStyle='#222';ctx.lineWidth=.35;ctx.stroke();}ctx.globalAlpha=1;
  if(zoom>=5.5)for(const [name,key,min] of [['counties','county',6],['rivers','river',5.5],['roads','road',6]]){if(zoom<min)continue;ctx.strokeStyle=p[key];ctx.lineWidth=name==='counties'?.5:.8;ctx.globalAlpha=.65;for(const f of options.detail.layers[name].features)for(const line of lines(f.geometry))path(line);ctx.globalAlpha=1;}
  ctx.strokeStyle=p.line;ctx.lineWidth=1;for(const f of states.features)for(const line of lines(f.geometry))path(line);
  const cities=[['Cincinnati',-84.51,39.1],['Chicago',-87.63,41.88],['Nashville',-86.78,36.16],['St. Louis',-90.20,38.63],['Atlanta',-84.39,33.75],['Dallas',-96.8,32.78],['Washington',-77.04,38.9],['Columbus',-83,39.96],['Indianapolis',-86.16,39.77],['Memphis',-90.05,35.15],['Detroit',-83.05,42.33],['Raleigh',-78.64,35.78]];ctx.font='11px system-ui';ctx.textAlign='center';ctx.lineWidth=3;const anchors=[];for(const [name,lon,lat] of cities){const [x,y]=point([lon,lat]);if(x<30||x>width-30||y<18||y>height-20||anchors.some(a=>Math.hypot(a[0]-x,a[1]-y)<65))continue;anchors.push([x,y]);ctx.strokeStyle=p.halo;ctx.fillStyle=p.text;ctx.strokeText(name,x,y);ctx.fillText(name,x,y);}
  if(visible('sr-contour-labels'))for(const f of contours){if(f.properties.threshold<.02)continue;const rings=f.geometry.coordinates.map(poly=>poly[0]).sort((a,b)=>b.length-a.length);const ring=rings[0];if(!ring||ring.length<30)continue;const [x,y]=point(ring[Math.floor(ring.length*.3)]);if(x<30||x>width-30||y<20||y>height-20||anchors.some(a=>Math.hypot(a[0]-x,a[1]-y)<50))continue;anchors.push([x,y]);const label=+(f.properties.threshold*100).toFixed(1)+'%';ctx.strokeStyle='#fff';ctx.fillStyle='#171717';ctx.lineWidth=3;ctx.strokeText(label,x,y);ctx.fillText(label,x,y);}
  const r=sources.get('sr-ring');if(r?.geometry){ctx.strokeStyle=p.text;ctx.lineWidth=2;ctx.setLineDash([5,4]);for(const line of lines(r.geometry))path(line);ctx.setLineDash([]);}const s=sources.get('sr-selected');if(s?.geometry){const [x,y]=point(s.geometry.coordinates);ctx.beginPath();ctx.arc(x,y,5,0,2*Math.PI);ctx.fillStyle=p.land;ctx.fill();ctx.strokeStyle=p.text;ctx.lineWidth=2;ctx.stroke();}
 }
 function at(event){const r=cv.getBoundingClientRect();return[event.clientX-r.left,event.clientY-r.top];}
 cv.addEventListener('pointerdown',e=>{drag={start:at(e),center:project(center),moved:0};cv.setPointerCapture(e.pointerId);cv.style.cursor='grabbing';});
 cv.addEventListener('pointermove',e=>{if(!drag)return;const pos=at(e),dx=pos[0]-drag.start[0],dy=pos[1]-drag.start[1];drag.moved=Math.max(drag.moved,Math.hypot(dx,dy));center=inverse([drag.center[0]-dx/(512*2**zoom),drag.center[1]-dy/(512*2**zoom)]);center[1]=Math.max(20,Math.min(55,center[1]));draw();});
 cv.addEventListener('pointerup',e=>{if(drag&&drag.moved<5)options.onClick(coord(at(e)));drag=null;cv.style.cursor='grab';});cv.addEventListener('pointercancel',()=>{drag=null;cv.style.cursor='grab';});
 cv.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(3,Math.min(8.5,zoom+(e.deltaY<0?.3:-.3)));draw();},{passive:false});
 el.querySelectorAll('button').forEach((b,i)=>b.addEventListener('click',()=>{zoom=Math.max(3,Math.min(8.5,zoom+(i===0?.5:-.5)));draw();}));
 cv.addEventListener('keydown',e=>{if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(['+','=','-'].includes(e.key))zoom=Math.max(3,Math.min(8.5,zoom+(e.key==='-'?-.5:.5)));else{const o=project(center),d=60/(512*2**zoom);center=inverse([o[0]+(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0),o[1]+(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0)]);}draw();}});
 new ResizeObserver(draw).observe(el);draw();
 return{getSource:id=>({setData:data=>{sources.set(id,data);redraw();}}),setPaintProperty:(id,key,value)=>{paint.set(id+':'+key,value);redraw();},setLayoutProperty:(id,key,value)=>{layouts.set(id,value);redraw();},resize:draw,easeTo:o=>{center=o.center;zoom=o.zoom??zoom;draw();},fitBounds:bounds=>{const a=project(bounds[0]),b=project(bounds[1]);center=inverse([(a[0]+b[0])/2,(a[1]+b[1])/2]);zoom=Math.max(3,Math.min(8.5,Math.log2(Math.min((width-40)/(512*Math.abs(b[0]-a[0])),(height-40)/(512*Math.abs(b[1]-a[1]))))));draw();}};
};})();
