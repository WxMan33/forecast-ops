// Hosted check for the CONUS Severe research preview: opens the beta URL headlessly and confirms the CONUS view
// loads the expected cases, the unavailable panel works, and the Regional view returns. Writes two screenshots.
const {chromium,devices}=require('playwright');
const [BASE,OUT]=process.argv.slice(2);
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(BASE+'severe.html#severe-conus');await p.waitForFunction(()=>window.SevereConusPreview&&window.SevereConusPreview.state().ready&&window.SevereConusPreview.state().case,null,{timeout:90000});await p.waitForTimeout(3000);
 const st=await p.evaluate(()=>({s:window.SevereConusPreview.state(),cases:[...document.querySelectorAll('#scCase option')].map(o=>o.value),win:document.getElementById('scWindow').textContent}));
 console.log(JSON.stringify(st));if(st.cases.length<4||st.s.day!==2||st.s.hazard!=='wind')throw Error('CONUS view did not load the expected cases');
 await p.evaluate(()=>window.SevereConusPreview.select(-84.5,38.0));const v=await p.evaluate(()=>window.SevereConusPreview.state());console.log('KY sample',v.kind,v.value);if(v.kind!=='value')throw Error('inside-box sample not a value');
 await p.click('[data-sc-hazard="tornado"]');if(await p.isHidden('#scUnavailable'))throw Error('unavailable panel not shown');
 await p.click('#scWind');await p.waitForTimeout(1500);await p.locator('#scMap').screenshot({path:OUT+'/hosted-conus.png'});
 await p.click('[data-sc-view="regional"]');await p.waitForTimeout(2000);if(!(await p.isVisible('.sd-regional')))throw Error('Regional view not visible');
 const m=await (await b.newContext({...devices['iPhone 13']})).newPage();await m.goto(BASE+'severe.html#severe-conus');await m.waitForFunction(()=>window.SevereConusPreview&&window.SevereConusPreview.state().ready,null,{timeout:90000});
 const w=await m.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);console.log('mobile widths',w);if(w[0]>w[1])throw Error('horizontal scroll on phone');
 await m.locator('#scMap').screenshot({path:OUT+'/hosted-conus-mobile.png'});
 if(errs.length)throw Error('page errors: '+errs.join(' | '));console.log('hosted check passed');await b.close();})().catch(e=>{console.error(e);process.exit(1);});
