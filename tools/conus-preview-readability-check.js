// CONUS Severe preview readability checks (reports, counties, layers, saved forecast, phone). Usage: node tools/conus-preview-readability-check.js BASE OUTDIR
// Readability-pass checks + "after" screenshots. Usage: node after.js BASE OUTDIR [hosted]
const {chromium,devices}=require('playwright');const [BASE,OUT,HOSTED]=process.argv.slice(2);const fs=require('fs');fs.mkdirSync(OUT,{recursive:true});
const R=[];const ok=(name,pass,detail)=>{R.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name+(detail!==undefined?' '+JSON.stringify(detail):''));};
async function notice(p){for(let i=0;i<3;i++){if(!/External Content Notice/i.test(await p.title().catch(()=>'')))return;const b=p.getByRole('button',{name:/open the page/i}).first();await b.waitFor({timeout:30000});await Promise.all([p.waitForURL(u=>!/External/.test(String(u)),{timeout:30000}).catch(()=>{}),b.click()]);await p.waitForLoadState('load').catch(()=>{});await p.waitForTimeout(2500);}}
async function open(p){await p.goto(BASE+'severe.html#severe-conus');await notice(p);await p.waitForFunction(()=>window.SevereConusPreview&&window.SevereConusPreview.state().ready&&window.SevereConusPreview.state().case,null,{timeout:90000});}
const S=p=>p.evaluate(()=>window.SevereConusPreview.state());
async function waitReports(p){await p.waitForFunction(()=>window.SevereConusPreview.state().reports!==null||/unavailable|No qualifying|Saved forecast/.test(document.getElementById('scReportNote').textContent),null,{timeout:60000});}
(async()=>{const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const p=await b.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:2});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await open(p);await p.selectOption('#scCase','replay-2024-05-25');await waitReports(p);await p.evaluate(()=>window.SevereConusPreview.view([-96,38.5],3.4));await p.waitForTimeout(800);
 const mapShot=async n=>{await p.locator('#scMap').scrollIntoViewIfNeeded();const m=await p.locator('#scMap').boundingBox();await p.screenshot({path:`${OUT}/after-${n}.png`,clip:{x:m.x-4,y:m.y-4,width:m.width+8,height:m.height+8}});};
 const st=await S(p);ok('active replay loads 776 original reports',st.reports===776,st.reports);
 ok('report count shown next to toggle',/\(776\)/.test(await p.textContent('#scReportCount')),await p.textContent('#scReportCount'));
 ok('clusters at national zoom',await p.evaluate(()=>window.SevereConusPreview.rendered('sc-clusters'))>0,await p.evaluate(()=>window.SevereConusPreview.rendered('sc-clusters')));
 ok('grid-point footprint layer off by default',!(await p.isChecked('#scNear'))&&await p.evaluate(()=>window.SevereConusPreview.rendered('sc-near'))===0);
 ok('outside-coverage grey dots removed (tint instead)',await p.evaluate(()=>window.SevereConusPreview.rendered('sc-outside'))>0);
 const fillOn=await p.evaluate(()=>window.SevereConusPreview.rendered('sc-fill'));
 await mapShot('national');
 // full panel shot (controls + map + legend)
 await p.locator('[data-sc-view="regional"]').scrollIntoViewIfNeeded();const top=await p.locator('[data-sc-view="regional"]').boundingBox();const kb=await p.locator('#scKeys').boundingBox();const card=await p.locator('#scBody').boundingBox();
 await p.screenshot({path:`${OUT}/after-panel.png`,clip:{x:card.x-8,y:Math.max(0,top.y-10),width:card.width+16,height:Math.min(1100-Math.max(0,top.y-10),kb.y+kb.height-top.y+20)}});
 ok('legend directly below the map',(await p.locator('#scLegend').boundingBox()).y-((await p.locator('#scMap').boundingBox()).y+(await p.locator('#scMap').boundingBox()).height)<40);
 await p.uncheck('#scReports');await p.waitForTimeout(1500);
 const off=await p.evaluate(()=>({rep:window.SevereConusPreview.rendered('sc-clusters')+window.SevereConusPreview.rendered('sc-report'),fill:window.SevereConusPreview.rendered('sc-fill')}));
 ok('reports off leaves the forecast shading',off.rep===0&&off.fill>0,{before:fillOn,after:off});
 await mapShot('national-reports-off');
 await p.check('#scReports');await p.waitForTimeout(400);
 // CVG zoom with counties
 await p.evaluate(()=>window.SevereConusPreview.view([-84.6,39.1],7.7));await p.waitForTimeout(1500);
 const cty=await p.evaluate(()=>window.SevereConusPreview.rendered('sc-counties'));ok('county lines render around CVG',cty>0,cty);
 const ind=await p.evaluate(()=>window.SevereConusPreview.rendered('sc-report'));ok('individual report markers at CVG zoom',ind>0,ind);
 await mapShot('cvg');
 // click a report → popup matches record
 const pick=await p.evaluate(()=>{const s=window.SevereConusPreview;const L=s.reportList();const c=[-84.6,39.1];let best=null,d=1e9;for(const r of L){const dd=Math.hypot(r.lon-c[0],r.lat-c[1]);if(dd<d){d=dd;best=r;}}return best;});
 const xy=await p.evaluate(r=>window.SevereConusPreview.project(r.lon,r.lat),pick);await p.mouse.click(xy[0],xy[1]);await p.waitForTimeout(700);
 const pop=await p.textContent('.maplibregl-popup-content').catch(()=>null);
 ok('clicking a report opens its record',pop&&pop.includes(pick.id)&&pop.includes(String(Math.round(pick.magnitude_kt))+' kt'),{id:pick.id,time:pick.time_utc,src:pick.source_local_time+' '+pick.source_timezone,loc:pick.location,county:pick.county_zone,state:pick.state,kt:pick.magnitude_kt,type:pick.magnitude_type,popup:pop&&pop.slice(0,200)});
 ok('popup links to the NCEI record',await p.getAttribute('.maplibregl-popup-content a','href').catch(()=>'')===('https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id='+pick.id));
 await mapShot('cvg-popup');
 await p.uncheck('#scCounties');await p.waitForTimeout(500);ok('county toggle hides county lines',await p.evaluate(()=>window.SevereConusPreview.rendered('sc-counties'))===0);await p.check('#scCounties');
 // quiet replay
 await p.selectOption('#scCase','replay-2024-09-27');await waitReports(p);await p.evaluate(()=>window.SevereConusPreview.view([-96,38.5],3.4));await p.waitForTimeout(800);
 ok('quiet replay says no qualifying reports',/No qualifying reports/.test(await p.textContent('#scReportNote')),await p.textContent('#scReportNote'));await mapShot('quiet');
 // saved forecast
 await p.selectOption('#scCase','current-2026-11-22');await p.waitForTimeout(2500);
 const w=await p.textContent('#scWindow');ok('saved forecast labelled with absolute valid times',/SAVED FORECAST/.test(w)&&/Nov 23, 2026/.test(w)&&/Nov 24, 2026/.test(w),w);
 ok('reports toggle hidden for saved forecast',await p.isHidden('#scReportsWrap'));
 ok('case picker says Saved forecast',/SAVED FORECAST/.test(await p.evaluate(()=>[...document.querySelectorAll('#scCase option')].map(o=>o.textContent).join('|'))));
 // weakness replay national
 await p.selectOption('#scCase','replay-2024-05-14');await waitReports(p);await p.evaluate(()=>window.SevereConusPreview.view([-90,33],4.3));await p.waitForTimeout(1000);ok('weakness replay 36 reports',(await S(p)).reports===36);await mapShot('weakness');
 // regional still fine
 await p.click('[data-sc-view="regional"]');await p.waitForTimeout(1500);ok('regional view visible',await p.isVisible('.sd-regional'));
 ok('no page errors',errs.length===0,errs);
 // selected point vs storm report (desktop)
 const sty=await p.evaluate(()=>window.SevereConusPreview.style());ok('selected point uses a distinct symbol from a storm report',sty.selFill==='rgba(0,0,0,0)'&&sty.selColor!==sty.reportColor,{sel:sty.selColor,report:sty.reportColor});
 // phones: 360 and 390 px, May 26 replay, national and CVG
 for(const [w,h,label] of [[360,740,'360'],[390,844,'390']]){
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13'].userAgent});const m=await ctx.newPage();const merr=[];m.on('pageerror',e=>merr.push(e.message));
  await open(m);await m.selectOption('#scCase','replay-2024-05-25');await waitReports(m);await m.evaluate(()=>window.SevereConusPreview.view([-88,37.5],3.2));await m.waitForTimeout(800);
  const st=await m.evaluate(()=>window.SevereConusPreview.style());
  const radii=st.clusterRadius.slice(2).filter((x,i)=>i%2===0);
  ok(label+'px: attribution starts collapsed',!st.attribOpen);
  ok(label+'px: compact cluster badges (largest ≤ 12 px)',st.compact&&Math.max(...radii)<=12,radii);
  const dims=await m.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,mh:document.getElementById('scMap').getBoundingClientRect().height,vh:innerHeight}));ok(label+'px: no sideways scroll, map ≥ 60% of screen',dims.sw<=dims.cw&&dims.mh>=0.6*dims.vh,dims);
  ok(label+'px: national clusters drawn',await m.evaluate(()=>window.SevereConusPreview.rendered('sc-clusters'))>0);
  await m.evaluate(()=>{const e=document.querySelector('#scWindow');window.scrollTo(0,e.getBoundingClientRect().top+scrollY-8);});await m.waitForTimeout(600);await m.screenshot({path:`${OUT}/after-phone${label}-national.png`});
  await m.evaluate(()=>window.SevereConusPreview.view([-84.6,39.1],7.4));await m.waitForTimeout(1200);
  ok(label+'px: county lines at CVG',await m.evaluate(()=>window.SevereConusPreview.rendered('sc-counties'))>0);
  const pick=await m.evaluate(()=>{const L=window.SevereConusPreview.reportList(),c=[-84.6,39.1];let best=null,d=1e9;for(const r of L){const dd=Math.hypot(r.lon-c[0],r.lat-c[1]);if(dd<d){d=dd;best=r;}}return best;});
  await m.locator('#scMap').scrollIntoViewIfNeeded();await m.waitForTimeout(400);const xy=await m.evaluate(r=>window.SevereConusPreview.project(r.lon,r.lat),pick);await m.touchscreen.tap(xy[0],xy[1]);await m.waitForTimeout(800);
  const pop=await m.textContent('.maplibregl-popup-content').catch(()=>null);const href=await m.getAttribute('.maplibregl-popup-content a','href').catch(()=>null);
  ok(label+'px: tapping a report opens its NOAA record details',pop&&pop.includes(pick.id)&&href===('https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id='+pick.id),{id:pick.id,popup:pop&&pop.slice(0,120)});
  await m.screenshot({path:`${OUT}/after-phone${label}-cvg.png`});
  ok(label+'px: no page errors',merr.length===0,merr);await ctx.close();}
 fs.writeFileSync(`${OUT}/checks.json`,JSON.stringify(R,null,1));await b.close();if(R.some(r=>!r.pass))process.exit(1);})().catch(e=>{console.error(e);process.exit(1);});
