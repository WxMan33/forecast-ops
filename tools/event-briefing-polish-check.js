#!/usr/bin/env node
/* Offline full-page visual regression. Only the data provider is substituted; rendering and engines are real. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/beta/screens');fs.mkdirSync(out,{recursive:true});
const fixture=fs.readFileSync(path.join(root,'tests/fixtures/event-polish-data.js'),'utf8');
const server=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');const file=path.resolve(root,rel||'event-beta.html');if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});
let browser,failed=0;
function check(ok,name){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failed++}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch();
for(const theme of ['dark','light'])for(const phone of [true,false]){
 const ctx=await browser.newContext({viewport:{width:phone?390:1280,height:phone?664:960},timezoneId:'America/New_York'}),p=await ctx.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-11T20:30:00Z')});
 await p.addInitScript(t=>{localStorage.setItem('ops_theme',JSON.stringify(t));localStorage.setItem('beta_analytics_optout','1');window.__analytics=[];let A;Object.defineProperty(window,'BetaAnalytics',{configurable:true,get:()=>A,set:v=>{const t=v.track;v.track=(type,c)=>{window.__analytics.push([type,c]);return t(type,c)};A=v}})},theme);
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.fulfill({status:200,body:'',contentType:u.pathname.endsWith('.js')?'application/javascript':'text/plain'});if(u.pathname==='/assets/beta-event.js')return r.fulfill({contentType:'application/javascript',body:fixture+'\n'+fs.readFileSync(path.join(root,'assets/beta-event.js'),'utf8')});return r.continue()});
 await p.goto(base+'/event-beta.html');await p.waitForFunction(()=>document.body.dataset.loaded,{timeout:15000});check(await p.evaluate(t=>document.documentElement.dataset.theme===t,theme),'saved '+theme+' theme restored');
 await p.locator('#bxTheme').click();check(await p.evaluate(t=>document.documentElement.dataset.theme!==t,theme),'theme toggle changes the page');await p.locator('#bxTheme').click();
 const label=(phone?'phone':'desktop')+' '+theme;
 if(phone)check(await p.evaluate(()=>[...document.querySelectorAll('#keys dd')].at(-1).getBoundingClientRect().bottom<=innerHeight),'decision and next check fit a smaller phone screen');
 check(errors.length===0,label+' no script errors '+errors.join('; '));
 check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' no horizontal page overflow');
 /* the hourly charts are details on demand: open the "Hour by hour" group as a planner would */
 await p.locator('#secHourly > summary').click(); await p.waitForTimeout(250);
 check(await p.locator('#evCharts .evc-card').count()===4,label+' four separate variable charts');
 check(await p.locator('#hourlyTable').getAttribute('open')===null,label+' data table is secondary and collapsed');
 check(await p.evaluate(()=>[...document.querySelectorAll('.evc-card')].every(e=>e.scrollWidth<=e.clientWidth+1)),label+' variable charts fit without side scrolling');
 const chartValues=await p.evaluate(()=>[...document.querySelectorAll('#evCharts [data-value]')].every(e=>e.textContent.length>0));check(chartValues,label+' selected hour values shown on each chart');
 await p.locator('#evCharts [data-variable=pop] [data-hour]').nth(1).click();
 check(await p.evaluate(()=>{const s=document.body.dataset.selected;return [...document.querySelectorAll('#evCharts [aria-pressed=true]')].length===4&&[...document.querySelectorAll('#evCharts [aria-pressed=true]')].every(e=>e.dataset.hour===s)}),label+' selecting an hour synchronizes all four charts');
 const before=await p.locator('.evc-window').innerText();const later=p.locator('#evCharts [data-move="1"]');if(await later.isEnabled()){await later.click();check((await p.locator('.evc-window').innerText())!==before,label+' later hours use paging rather than horizontal scrolling')}
 check(await p.locator('.sch-labels li').count()===4,label+' all four schedule phases have full labels');
 /* a material coverage gap is flagged next to the decision; the full coverage panel is under "Sources and model details" */
 check(await p.locator('#gapFlag').isVisible() && /1 of 3/.test(await p.locator('#gapFlag').innerText()) && /HRRR/.test(await p.locator('#gapFlag').innerText()),label+' material coverage gap is flagged in the briefing');
 await p.locator('#detail > summary').click(); await p.waitForTimeout(150);
 check(await p.locator('#sourceCoverage [data-support]').getAttribute('data-support')==='Limited coverage',label+' one source never implies good coverage');
 check(await p.locator('#sourceCoverage .fs-metrics').innerText().then(t=>t.includes('Unavailable')&&t.includes('1 of 1')),label+' agreement unavailable with one source, hours still counted');
 check(await p.locator('#sourceCoverage .fs-freshness').innerText().then(t=>t.includes('unavailable')||t.includes('unknown')),label+' missing retrieval times are explicit');
 check(await p.locator('#sourceCoverage').innerText().then(t=>t.includes('1 of 3')&&t.includes('HRRR')),label+' reduced source coverage is visible');
 check(!(await p.locator('#evGrid').innerText()).includes('†'),label+' hourly table has no unexplained phase-rating daggers');
 const head=await p.evaluate(()=>{const els=[...document.querySelectorAll('.bx-head button,.bx-head input,.bx-head a')].filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden');return els.every((e,i)=>els.slice(i+1).every(f=>{if(e.contains(f)||f.contains(e))return true;const a=e.getBoundingClientRect(),b=f.getBoundingClientRect();return a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1}))});check(head,label+' header controls do not overlap');
 await p.screenshot({path:path.join(out,'event-polish-'+(phone?'phone':'desktop')+'-'+theme+'.png'),fullPage:true});
 if(phone&&theme==='dark'){await p.locator('#secHourly').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'event-polish-hourly-phone.png')})}
 if(!phone&&theme==='light'){
  await p.emulateMedia({media:'print'});await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  const text=await p.locator('#printView').innerText();check(!/Guidance support|model sources|ensemble/i.test(text)&&/What to plan for/.test(text)&&/Event schedule/.test(text)&&/Next weather check/.test(text),'print page 1 is a plain handout: what to plan for, schedule, next check; model diagnostics stay on the website');check(/Nov 12/.test(text)&&/Setup\s*12–4:30 PM/.test(text)&&/Teardown\s*10 PM–12 AM/.test(text),'print gives the event date and each part of the schedule once with local times');
  const pdf=await p.pdf({path:path.join(out,'event-polish-briefing.pdf'),preferCSSPageSize:true,printBackground:true});const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;check(pages===2,'US Letter printout is exactly two pages (got '+pages+')');
  check(!text.includes('†')&&text.includes('1 / 2')&&text.includes('2 / 2'),'print has page numbers and no undefined daggers');
  check(await p.locator('.pv-p1').innerText().then(t=>/Only part of the usual forecast data/.test(t)&&!/HRRR|1 of 3/.test(t)),'print page one states the practical guidance gap in plain words, without model names');
  check(await p.locator('.pv-sched li').count()===4 && await p.locator('.pv-time-phase, .pv-time-hour, .at-key').count()===0,'print shows the four-part schedule once, with no weather bar chart or legend');
  check(await p.locator('.pv-hour-bar').count()===0 && (await p.locator('.pv-hours thead th').allInnerTexts()).join('|')==='Local time|Phase|Temp|Rain chance|Rain amount|Wind gusts|Lightning','hourly page is one plain table: local time, phase, temperature, rain chance, wind gusts, lightning potential');
 }
 if(!phone&&theme==='light'){
 await p.emulateMedia({media:'screen'});await p.goto(base+'/event-beta.html?long=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 await p.emulateMedia({media:'print'});await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 check(await p.evaluate(()=>getComputedStyle(document.documentElement).colorScheme==='light'),'dark theme prints with light paper margins');
 const pdf=await p.pdf({path:path.join(out,'event-polish-long-briefing.pdf'),preferCSSPageSize:true,printBackground:true});
 const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;check(pages===2,'three-day event prints two pages (got '+pages+')');
 check((await p.locator('#printView').innerText()).includes('First 24 hours only'),'long event clearly labels the hourly excerpt');
 }
 if(!phone&&theme==='light'){
 await p.emulateMedia({media:'screen'});await p.goto(base+'/event-beta.html?gaps=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 await p.locator('#secHourly > summary').click(); await p.waitForTimeout(250);
 await p.locator('#evCharts [data-variable=pop] [data-hour="'+Date.parse('2026-11-12T19:00Z')+'"]').click();
 check((await p.locator('#evCharts [data-value=pop]').innerText())==='—','missing rain guidance stays missing rather than zero');
 check(/n\/a|Unavail/.test(await p.locator('#evCharts [data-value=lightning]').innerText()),'missing lightning is never shown as Low');
 check(await p.locator('#evCharts .evc-gap').count()>=4,'missing hour is visibly marked in every variable chart');
 await p.emulateMedia({media:'print'});await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 check(await p.locator('.pv-hours tr[data-ms="'+Date.parse('2026-11-12T19:00Z')+'"] .pv-nd').count()===5,'print writes no data in every value column of the missing hour (temp, rain chance, rain amount, gusts, lightning)');
 const gap=p.locator('.pv-hours tr[data-ms="'+Date.parse('2026-11-12T19:00Z')+'"] [data-pop]');
 check((await gap.innerText()).trim()==='no data' && await gap.locator('.pv-hour-bar').count()===0,'missing printed rain chance reads no data, not zero, and has no bar');
 await p.emulateMedia({media:'screen'});
 }
 if(!phone&&theme==='light'){
 // Restore complete guidance before testing a weather change; the preceding fixture intentionally removed an hour.
 await p.goto(base+'/event-beta.html');await p.waitForFunction(()=>document.body.dataset.loaded);
 await p.goto(base+'/event-beta.html?delta=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 check(/Gusts now reach your 25 mph venue limit/.test(await p.locator('#briefUpdate').innerText()),'return visit explains the venue gust-limit crossing');
 /* before event day the OPE handoff sits in the check-in schedule group */
 if(!(await p.locator('#opsHandoff').isVisible()))await p.locator('#secChecks > summary').click();
 const details=p.locator('#opsHandoff details');await details.locator('summary').click();
 await p.locator('[data-ops-address]').fill('http://localhost:3000');await p.locator('[data-save-ops]').click();
 const href=await p.locator('#opsHandoff a').getAttribute('href'),u=new URL(href),data=JSON.parse(new URLSearchParams(u.hash.slice(1)).get('handoff'));
 check(u.pathname==='/forecast-event'&&u.search===''&&data.venue.lat===39.1005&&data.venue.lon===-84.5017&&!JSON.stringify(data).includes('lightning'),'OPE link carries the exact venue in a fragment, with no forecast threats');
 await p.goto(base+'/event-beta.html?improve=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 const better=await p.locator('#briefUpdate').innerText();
 check(/^Improved since your last briefing/.test(better)&&/Better:/.test(better)&&!/No meaningful change/.test(better),'return visit explains improving conditions instead of reporting no change');
 check(/no longer reaches|now stay below your 25 mph venue limit|fell from/.test(better)&&!/Worse:/.test(better),'improvement names what got better in the same event hours');
 check(await p.evaluate(()=>{const s=JSON.stringify(window.__analytics||[]);const q=JSON.stringify(window.BetaAnalytics?._queue?.()||[]);return Array.isArray(window.__analytics)&&String(window.BetaAnalytics.track).includes('__analytics')&&!/Improved|no longer|venue limit|briefing|Riverfront|Sawyer|39\.1|84\.5/.test(s+q)}),'comparison text never reaches analytics');
 await p.screenshot({path:path.join(out,'event-polish-improved.png'),fullPage:false});
 await p.evaluate(()=>localStorage.removeItem('forecast_ops_briefing_history_v1'));
 await p.goto(base+'/event-beta.html');await p.waitForFunction(()=>document.body.dataset.loaded);
 await p.goto(base+'/event-beta.html?shift=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 const timing=await p.locator('#briefUpdate').innerText();
 check(/Timing:/.test(timing)&&/2 hours later/.test(timing)&&!/Worse:/.test(timing),'same-source rain shift is labelled Timing, not worsening or an all-clear ('+timing+')');
 await p.goto(base+'/event-beta.html?live=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 check(await p.evaluate(()=>!!(document.getElementById('opsHandoff').compareDocumentPosition(document.getElementById('decision'))&Node.DOCUMENT_POSITION_FOLLOWING)),'event-day monitoring handoff appears before the forecast decision');
 await p.screenshot({path:path.join(out,'event-polish-live-monitoring.png'),fullPage:true});
 await p.route('https://nominatim.openstreetmap.org/search?**',r=>r.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:[{category:'boundary',type:'administrative',addresstype:'city',name:'Miami',display_name:'Miami, Florida, United States',lat:'25.77417',lon:'-80.19362',address:{city:'Miami',state:'Florida'}}]}));
 await p.locator('#editBtn').click();
 await p.locator('#fCity .vs-q').fill('miami, fl');
 await p.locator('#fCity .vs-go').click();
 await p.locator('#fCity .vs-hit', {hasText:'Use Miami for planning'}).click();
 check(!(await p.locator('#fSaveVenue').isEnabled()),'a city forecast cannot become a saved exact venue');
 await p.locator('#fSave').click();
 await p.locator('#editDlg').waitFor({state:'hidden'});
 const miami=await p.evaluate(()=>EventStore.getEvent('ev_layout'));
 check(miami.loc.approximate && miami.loc.lat===25.77417 && miami.tz==='America/New_York','city selection replaces the old coordinates and resolves Miami time when the lookup fails');
 check((await p.locator('#evVenue').innerText()).includes('Miami, FL (area forecast)') && !(await p.locator('#opsHandoff').isVisible()),'city forecast is labeled and has no exact-venue monitoring link');
 }
 check(await p.locator('#loadGuard').count()===0,label+' no loading error banner after interaction and printing');
 check(errors.length===0,label+' no late script errors '+errors.join('; '));
 await ctx.close();
}
})().catch(e=>{failed++;console.error(e)}).finally(async()=>{if(browser)await browser.close();server.close();process.exitCode=failed?1:0});
