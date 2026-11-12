/* Separate, aligned event charts. Uses the existing hourly values and concern tiers unchanged. */
(function(root){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fin=Number.isFinite,H=3600e3;
function windowFor(axis,selected,count){const i=Math.max(0,axis.findIndex(a=>a.ms===selected));return Math.min(Math.max(0,axis.length-count),Math.max(0,i-Math.floor(count/2)))}
function render(host,{view:V,selected,onSelect,gustLimit=25}){
 let sel=selected,start=0,width=0,first=true;const rows=Object.fromEntries(V.rows.map(r=>[r.key,r]));
 const specs=[{key:'pop',name:'Rain chance',unit:'%',color:'rain',type:'bar',hazard:'hz-rain',extra:'qpf',extraLabel:'Rain amount',max:100},
 {key:'temp',name:'Temperature',unit:'°F',color:'temp',second:'feel',secondLabel:'Feels like'},
 {key:'wind',name:'Wind & gusts',unit:'mph',color:'wind',second:'gust',secondLabel:'Gusts',hazard:'hz-wind',limit:gustLimit},
 {key:'lightning',name:'Lightning potential',unit:'',color:'lightning',type:'tier',hazard:'lightning',max:3}];
 const text=(key,i)=>rows[key]?.cells[i]?.text??'—';
 const value=(spec,i)=>{if(V.hrs[i].state!=='ok')return null;if(spec.type==='tier'){const c=rows.lightning.cells[i];return c.state==='missing'?null:{Low:1,Moderate:2,High:3}[c.text]??null}return fin(V.hrs[i][spec.key])?V.hrs[i][spec.key]:null};
 function draw(recenter=false){
 const count=host.clientWidth<600?6:12,w=Math.max(280,host.clientWidth),endMax=Math.max(0,V.axis.length-count);
 if(first||recenter)start=windowFor(V.axis,sel,count);start=Math.max(0,Math.min(start,endMax));first=false;width=w;
 const indices=V.axis.map((_,i)=>i).slice(start,start+count),end=indices[indices.length-1],a=V.axis[start],z=V.axis[end];if(!a)return;
 const iSel=V.span.indexOf(sel);
 host.innerHTML=`<div class="evc-tools"><div><b>One timeline. Four clear views.</b><span class="bx-note">Choose an hour in any chart to compare the conditions.</span></div><div class="evc-nav"><button class="bx-btn" data-move="-1" aria-label="Earlier forecast hours" ${start===0?'disabled':''}>← Earlier</button><button class="bx-btn" data-move="1" aria-label="Later forecast hours" ${start===endMax?'disabled':''}>Later →</button></div></div><p class="evc-window">${esc(a.date)} · ${esc(a.hourText)} ${esc(a.zone)} – ${a.date!==z.date?esc(z.date)+' · ':''}${esc(z.hourText)} ${esc(z.zone)}</p><p class="evc-selected">Selected: <b>${esc(V.axis[iSel]?.date)} · ${esc(V.axis[iSel]?.hourText)} ${esc(V.axis[iSel]?.zone)}</b> · ${esc(text('phase',iSel))}</p><div class="evc-stack">${specs.map(s=>card(s,indices,w,iSel)).join('')}</div><p class="bx-note evc-note">Dashed lines: feels like or gusts. Shading marks the briefing’s existing concern levels. Gaps mean missing guidance. Low lightning potential is not zero.</p>`;
 host.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{start=Math.max(0,Math.min(endMax,start+Number(b.dataset.move)*count));sel=V.span[start];draw();onSelect(sel)});
 host.querySelectorAll('[data-hour]').forEach(g=>{const choose=()=>{sel=+g.dataset.hour;draw();onSelect(sel)};g.onclick=choose;g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
 }
 function card(s,ids,w,iSel){
 const left=39,right=14,top=16,base=112,height=155,bw=(w-left-right)/ids.length,x=j=>left+(j+.5)*bw;
 let vals=ids.flatMap(i=>[value(s,i),s.second&&V.hrs[i][s.second]]).filter(fin),lo=s.key==='temp'?Math.floor((Math.min(...vals)-3)/5)*5:0,hi=s.max||(s.key==='temp'?Math.ceil((Math.max(...vals)+3)/5)*5:Math.ceil(Math.max(10,...vals,s.limit||0)/10)*10);
 if(!vals.length){lo=0;hi=s.max||10}if(hi<=lo)hi=lo+10;
 const y=v=>base-(v-lo)/(hi-lo)*(base-top),haz=rows[s.hazard];
 let marks=ids.map((i,j)=>{const c=haz?.cells[i],v=value(s,i),missing=v===null;return `${c?.state==='concern'?`<rect x="${left+j*bw}" y="${top}" width="${bw}" height="${base-top}" fill="var(--${c.tier})" opacity=".13"/>`:''}${missing?`<rect x="${left+j*bw+2}" y="${top}" width="${bw-4}" height="${base-top}" class="evc-gap"/><text x="${x(j)}" y="66" text-anchor="middle" class="evc-axis">—</text>`:''}${s.type&&v!==null?`<rect x="${x(j)-bw*.25}" y="${y(v)}" width="${bw*.5}" height="${v===0?0:Math.max(2,base-y(v))}" rx="3" class="evc-bar" ${s.type==='tier'?`style="fill:${v===1?'var(--muted)':v===2?'var(--monitor)':'var(--action)'}"`:''}/>`:''}`}).join('');
 const ticks=s.type==='tier'?[1,2,3]:[lo,(lo+hi)/2,hi];
 const axes=ticks.map(v=>`<line x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}" class="evc-rule"/><text x="${left-7}" y="${y(v)+4}" text-anchor="end" class="evc-axis">${s.type==='tier'?['','Low','Mod','High'][v]:Math.round(v)+(s.unit==='%'?'%':'')}</text>`).join('');
 function line(key,secondary){let path='',open=false;ids.forEach((i,j)=>{const v=key===s.key?value(s,i):V.hrs[i].state==='ok'&&fin(V.hrs[i][key])?V.hrs[i][key]:null;if(v===null){open=false;return}path+=(open?' L':' M')+x(j)+','+y(v);open=true});return `<path d="${path}" class="evc-line${secondary?' evc-second':''}"/>`}
 if(!s.type)marks+=line(s.key,false)+(s.second?line(s.second,true):'');
 if(s.limit&&s.limit<=hi)marks+=`<line x1="${left}" x2="${w-right}" y1="${y(s.limit)}" y2="${y(s.limit)}" class="evc-limit"/><text x="${w-right}" y="${y(s.limit)-5}" text-anchor="end" class="evc-axis">${s.limit} mph venue limit</text>`;
 const buttons=ids.map((i,j)=>{const a=V.axis[i],label=a.hourText,show=ids.length<=6||j%2===0||j===ids.length-1;return `<g role="button" tabindex="0" aria-label="${esc(a.date+' '+a.hourText+' '+a.zone+', '+s.name+': '+text(s.key,i))}" aria-pressed="${V.span[i]===sel}" data-hour="${a.ms}"><rect x="${left+j*bw}" y="${top-5}" width="${bw}" height="${base-top+28}" fill="transparent"/>${V.span[i]===sel?`<line x1="${x(j)}" x2="${x(j)}" y1="${top-5}" y2="${base}" class="evc-cursor"/>`:''}${show?`<text x="${x(j)}" y="${base+21}" text-anchor="middle" class="evc-axis">${esc(label)}${a.repeated||a.zoneChange?`<tspan x="${x(j)}" dy="12">${esc(a.zone)}</tspan>`:''}</text>`:''}</g>`}).join('');
 return `<section class="evc-card evc-${s.color}" data-variable="${s.key}"><header><h3>${esc(s.name)}</h3><div><b data-value="${s.key}">${esc(text(s.key,iSel))}${s.unit==='°F'?'F':s.unit&&s.unit!=='%'?' '+esc(s.unit):''}</b>${s.second?`<span>${esc(s.secondLabel)} ${esc(text(s.second,iSel))}${s.unit==='mph'?' mph':''}</span>`:s.extra?`<span>${esc(s.extraLabel)} ${esc(text(s.extra,iSel))} in.</span>`:'<span>Forecast potential, not detected lightning</span>'}</div></header><svg viewBox="0 0 ${w} ${height}" role="group" aria-label="${esc(s.name)} by hour">${axes}${marks}${buttons}</svg></section>`;
 }
 draw();let frame=null;const observer=new ResizeObserver(()=>{const next=host.clientWidth;if(next>0&&Math.abs(width-next)>1){if(frame!==null)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=null;if(host.clientWidth>0)draw(true)})}});observer.observe(host);
 return {setSelected(ms){if(sel===ms)return;sel=ms;const i=V.span.indexOf(ms),count=host.clientWidth<600?6:12;draw(i<start||i>=start+count)},destroy(){observer.disconnect();if(frame!==null)cancelAnimationFrame(frame)}};
}
const api={render,windowFor};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.EventHourlyCharts=api;
})(typeof globalThis!=='undefined'?globalThis:this);
