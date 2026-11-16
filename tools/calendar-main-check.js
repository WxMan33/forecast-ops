#!/usr/bin/env node
/* Main-origin import contract. Google authorization is synthetic: no live credentials or calendar are used. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');let fail=0,browser;const check=(ok,s)=>{console.log((ok?'PASS ':'FAIL ')+s);if(!ok)fail++};
const venue={id:'vn_test',name:'Fixture Park',city:'Cincinnati, OH',lat:39.1,lon:-84.5,tz:'America/New_York',defaults:{setup:120,gates:30,teardown:60,gust:25}};
(async()=>{browser=await chromium.launch();for(const width of [390,1280])for(const origin of ['https://wxman33.github.io','https://forecast-ops-beta.pages.dev']){
 const ctx=await browser.newContext({viewport:{width,height:900},timezoneId:'America/New_York'}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(v=>{localStorage.setItem('beta_venues_v1',JSON.stringify([v]));localStorage.setItem('fo_analytics_optout','1');window.__testScopes=[];window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>{window.__testScopes.push(o.scope);o.callback({access_token:'test-calendar-token',expires_in:3600})}})}}};},venue);
 await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname==='www.googleapis.com'){const body=u.pathname.endsWith('/calendarList')?{items:[{id:'fixture',summary:'Fixture calendar',primary:true}]}:{items:[]};return r.fulfill({contentType:'application/json',body:JSON.stringify(body)})}if(u.origin===origin){let rel=u.pathname.replace(/^\/forecast-ops\//,'').replace(/^\//,'');if(!rel)rel='event-beta.html';try{return r.fulfill({contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(root,rel))})}catch{return r.fulfill({status:404,body:''})}}return r.fulfill({contentType:'application/javascript',body:''})});
 const url=origin+(origin.includes('github')?'/forecast-ops/':'/')+'event-beta.html#upcoming';await p.goto(url);await p.locator('#upImport').click();
 check(await p.locator('#ciGoogle').isVisible(),`${width}px ${origin}: Connect Google Calendar is offered`);
 await p.locator('#ciGoogle').click();await p.locator('#ciNext').waitFor();
 check((await p.locator('#editForm').innerText()).includes('Fixture calendar'),`${width}px: provider response reaches calendar selection on the same origin`);
 check(await p.evaluate(()=>window.__testScopes.length===1&&window.__testScopes[0].includes('calendar.events.readonly')&&!JSON.stringify([localStorage,sessionStorage]).includes('test-calendar-token')),`${width}px: access remains read-only and token is never stored`);
 await p.locator('#editForm button[value="cancel"]').click();
 await p.evaluate(()=>{const w=document.createElement('div');w.className='tablewrap';w.id='test-wide';w.innerHTML='<table><thead><tr><th>Source</th>'+Array.from({length:7},(_,i)=>'<th>Field '+(i+1)+'</th>').join('')+'</tr></thead><tbody><tr><th>Test source</th>'+Array.from({length:7},(_,i)=>'<td>Value '+(i+1)+'</td>').join('')+'</tr></tbody></table>';document.getElementById('upView').append(w)});
 await p.locator('#test-wide .table-pager').waitFor();
 const reached=new Set();for(let page=0;page<20;page++){for(const name of await p.locator('#test-wide thead th:not([hidden])').allTextContents())reached.add(name);if(!(await p.locator('#test-wide [data-table-next]').isEnabled()))break;await p.locator('#test-wide [data-table-next]').click();}
 const geometry=await p.evaluate(()=>{const w=document.getElementById('test-wide');return {wrapper:w.clientWidth,contents:w.scrollWidth,page:document.documentElement.scrollWidth,viewport:innerWidth,wide:[...document.querySelectorAll('#test-wide *')].filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>[e.tagName,e.className,e.clientWidth,e.scrollWidth]).slice(0,6)}});
 check(reached.size===8&&geometry.contents<=geometry.wrapper+1&&geometry.page<=geometry.viewport+1,`${width}px: every detailed-table column is reachable without horizontal scrolling (${reached.size}/8; ${JSON.stringify(geometry)})`);
 check(errors.length===0,`${width}px: no script errors ${errors.join(';')}`);await ctx.close();
}
})().catch(e=>{fail++;console.error(e)}).finally(async()=>{if(browser)await browser.close();process.exitCode=fail?1:0});
