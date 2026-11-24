// Mobile memory budget for the CONUS preview. iPhone 13 emulation (390x844, DPR 3, touch, mobile UA) in Chromium;
// NOT real iOS Safari. Sums RSS of this browser's whole process tree (browser, renderer, GPU, map workers) at:
// first draw, Whole CONUS, after switching all four cases, Whole CONUS again. Fails above BUDGET_MB, on a page
// crash or script error, or if the map did not use the prebuilt display contours.
// Usage: node tools/conus-preview-memory-check.js BASE [BUDGET_MB]
const {chromium,devices}=require('playwright');const {execSync}=require('child_process');
const BASE=process.argv[2],BUDGET=+(process.argv[3]||1500);const dir='/tmp/conus-mem-'+Date.now();
const rss=()=>{const rows=execSync('ps -eo pid=,ppid=,rss=,args=').toString().trim().split('\n').map(l=>{const m=l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);return m&&{pid:+m[1],ppid:+m[2],rss:+m[3],args:m[4]};}).filter(Boolean);
 const keep=new Set(rows.filter(r=>r.args.includes(dir)&&!r.args.includes('--type=')).map(r=>r.pid));let grew=true;while(grew){grew=false;for(const r of rows)if(keep.has(r.ppid)&&!keep.has(r.pid)){keep.add(r.pid);grew=true;}}
 return Math.round(rows.filter(r=>keep.has(r.pid)).reduce((a,r)=>a+r.rss,0)/1024);};
async function notice(p){for(let i=0;i<3;i++){if(!/External Content Notice/i.test(await p.title().catch(()=>'')))return;const b=p.getByRole('button',{name:/open the page/i}).first();await b.waitFor({timeout:30000});await Promise.all([p.waitForURL(u=>!/External/.test(String(u)),{timeout:30000}).catch(()=>{}),b.click()]);await p.waitForLoadState('load').catch(()=>{});await p.waitForTimeout(2500);}}
(async()=>{const ctx=await chromium.launchPersistentContext(dir,{...devices['iPhone 13'],args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=ctx.pages()[0]||await ctx.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('crash',()=>errs.push('PAGE CRASH'));
 const settle=async()=>{let prev='',same=0;for(let k=0;k<120&&same<4;k++){await p.waitForTimeout(500);const v=JSON.stringify(await p.evaluate(()=>{const s=window.SevereConusPreview.state();return [s.view,s.case,window.SevereConusPreview.rendered('sc-fill')];}));same=v===prev?same+1:0;prev=v;}};
 const out={device:'Chromium, iPhone 13 emulation (390x844, DPR 3, touch)',budgetMB:BUDGET};const t0=Date.now();
 await p.goto(BASE+'severe.html#severe-conus');await notice(p);await p.waitForFunction(()=>window.SevereConusPreview&&window.SevereConusPreview.state().ready&&window.SevereConusPreview.state().case,null,{timeout:120000});
 await p.waitForFunction(()=>window.SevereConusPreview.rendered('sc-fill')>0,null,{timeout:120000});out.firstDrawSec=+((Date.now()-t0)/1000).toFixed(1);await settle();out.firstDrawMB=rss();
 await p.click('#scWhole');await settle();out.wholeConusMB=rss();
 const ids=await p.evaluate(async()=>(await fetch('assets/severe-conus/index.json',{cache:'no-cache'}).then(r=>r.json())).cases.map(c=>c.id));ids.push(ids.splice(ids.indexOf('replay-2024-05-25'),1)[0]);
 for(const id of ids){await p.selectOption('#scCase',id);await p.waitForTimeout(500);await settle();}
 out.afterAllCasesMB=rss();await p.click('#scWhole');await settle();out.wholeAgainMB=rss();
 out.contourSource=await p.evaluate(()=>window.SevereConusPreview.contourSource());out.meshBuilt=await p.evaluate(()=>window.SevereConusPreview.meshBuilt());out.errors=errs;
 const peak=Math.max(out.firstDrawMB,out.wholeConusMB,out.afterAllCasesMB,out.wholeAgainMB);out.peakMB=peak;
 const ok=peak<=BUDGET&&!errs.length&&out.contourSource==='prebuilt'&&!out.meshBuilt;console.log((ok?'PASS':'FAIL')+' mobile memory budget '+JSON.stringify(out));await ctx.close();process.exit(ok?0:1);})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
