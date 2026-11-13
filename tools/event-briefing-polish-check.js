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
 check(await p.locator('#evCharts .evc-card').count()===4,label+' four separate variable charts');
 check(await p.locator('#hourlyTable').getAttribute('open')===null,label+' data table is secondary and collapsed');
 check(await p.evaluate(()=>[...document.querySelectorAll('.evc-card')].every(e=>e.scrollWidth<=e.clientWidth+1)),label+' variable charts fit without side scrolling');
 const chartValues=await p.evaluate(()=>[...document.querySelectorAll('#evCharts [data-value]')].every(e=>e.textContent.length>0));check(chartValues,label+' selected hour values shown on each chart');
 await p.locator('#evCharts [data-variable=pop] [data-hour]').nth(1).click();
 check(await p.evaluate(()=>{const s=document.body.dataset.selected;return [...document.querySelectorAll('#evCharts [aria-pressed=true]')].length===4&&[...document.querySelectorAll('#evCharts [aria-pressed=true]')].every(e=>e.dataset.hour===s)}),label+' selecting an hour synchronizes all four charts');
 const before=await p.locator('.evc-window').innerText();const later=p.locator('#evCharts [data-move="1"]');if(await later.isEnabled()){await later.click();check((await p.locator('.evc-window').innerText())!==before,label+' later hours use paging rather than horizontal scrolling')}
 check(await p.locator('.sch-labels li').count()===4,label+' all four schedule phases have full labels');
 check(await p.locator('#sourceCoverage').innerText().then(t=>t.includes('1 of 3')&&t.includes('HRRR')),label+' reduced source coverage is visible');
 check(!(await p.locator('#evGrid').innerText()).includes('†'),label+' hourly table has no unexplained phase-rating daggers');
 const head=await p.evaluate(()=>{const els=[...document.querySelectorAll('.bx-head button,.bx-head input,.bx-head a')].filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden');return els.every((e,i)=>els.slice(i+1).every(f=>{if(e.contains(f)||f.contains(e))return true;const a=e.getBoundingClientRect(),b=f.getBoundingClientRect();return a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1}))});check(head,label+' header controls do not overlap');
 await p.screenshot({path:path.join(out,'event-polish-'+(phone?'phone':'desktop')+'-'+theme+'.png'),fullPage:true});
 if(phone&&theme==='dark'){await p.locator('#secHourly').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'event-polish-hourly-phone.png')})}
 if(!phone&&theme==='light'){
  await p.emulateMedia({media:'print'});await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  const text=await p.locator('#printView').innerText();check(/Planning window/.test(text)&&/Event\n/.test(text)&&/Nov 13/.test(text),'print separates event from overnight planning window');
  const pdf=await p.pdf({path:path.join(out,'event-polish-briefing.pdf'),preferCSSPageSize:true,printBackground:true});const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;check(pages===2,'US Letter printout is exactly two pages (got '+pages+')');
  check(!text.includes('†')&&text.includes('1 / 2')&&text.includes('2 / 2'),'print has page numbers and no undefined daggers');
  check(await p.locator('.pv-p1').innerText().then(t=>t.includes('1 of 3')&&t.includes('HRRR')),'print page one names missing sources');
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
 await p.locator('#evCharts [data-variable=pop] [data-hour="'+Date.parse('2026-11-12T19:00Z')+'"]').click();
 check((await p.locator('#evCharts [data-value=pop]').innerText())==='—','missing rain guidance stays missing rather than zero');
 check(/n\/a|Unavail/.test(await p.locator('#evCharts [data-value=lightning]').innerText()),'missing lightning is never shown as Low');
 check(await p.locator('#evCharts .evc-gap').count()>=4,'missing hour is visibly marked in every variable chart');
 }
 if(!phone&&theme==='light'){
 await p.goto(base+'/event-beta.html?delta=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 check(/Gusts now reach your 25 mph venue limit/.test(await p.locator('#briefUpdate').innerText()),'return visit explains the venue gust-limit crossing');
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
 await p.goto(base+'/event-beta.html?live=1');await p.waitForFunction(()=>document.body.dataset.loaded);
 check(await p.evaluate(()=>!!(document.getElementById('opsHandoff').compareDocumentPosition(document.getElementById('decision'))&Node.DOCUMENT_POSITION_FOLLOWING)),'event-day monitoring handoff appears before the forecast decision');
 await p.screenshot({path:path.join(out,'event-polish-live-monitoring.png'),fullPage:true});
 }
 check(await p.locator('#loadGuard').count()===0,label+' no loading error banner after interaction and printing');
 check(errors.length===0,label+' no late script errors '+errors.join('; '));
 await ctx.close();
}
})().catch(e=>{failed++;console.error(e)}).finally(async()=>{if(browser)await browser.close();server.close();process.exitCode=failed?1:0});
