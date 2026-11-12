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
 const ctx=await browser.newContext({viewport:{width:phone?390:1280,height:phone?844:960},timezoneId:'America/New_York'}),p=await ctx.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-11T20:30:00Z')});
 await p.addInitScript(t=>{localStorage.setItem('ops_theme',t);localStorage.setItem('beta_analytics_optout','1')},theme);
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.fulfill({status:200,body:'',contentType:u.pathname.endsWith('.js')?'application/javascript':'text/plain'});if(u.pathname==='/assets/beta-event.js')return r.fulfill({contentType:'application/javascript',body:fixture+'\n'+fs.readFileSync(path.join(root,'assets/beta-event.js'),'utf8')});return r.continue()});
 await p.goto(base+'/event-beta.html');await p.waitForFunction(()=>document.body.dataset.loaded,{timeout:15000});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 const label=(phone?'phone':'desktop')+' '+theme;
 check(errors.length===0,label+' no script errors '+errors.join('; '));
 check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' no horizontal page overflow');
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
 const pdf=await p.pdf({path:path.join(out,'event-polish-long-briefing.pdf'),preferCSSPageSize:true,printBackground:true});
 const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;check(pages===2,'three-day event prints two pages (got '+pages+')');
 check((await p.locator('#printView').innerText()).includes('First 24 hours only'),'long event clearly labels the hourly excerpt');
 }
 await ctx.close();
}
})().catch(e=>{failed++;console.error(e)}).finally(async()=>{if(browser)await browser.close();server.close();process.exitCode=failed?1:0});
