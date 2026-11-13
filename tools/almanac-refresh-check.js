/* Deterministic browser regression: ACIS lags, NWS publishes, then the user changes station.
   Source responses and station resolution are fixtures. No request reaches a weather provider. */
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const product = JSON.parse(await fs.readFile(path.join(root, 'tests/fixtures/almanac/nws-cli-cvg-20261110.json'), 'utf8'));
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
      const body = await fs.readFile(file);
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html');
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext({timezoneId:'Asia/Tokyo'});
    const page = await context.newPage(), errors = [], calls = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.clock.install({time: new Date('2026-11-10T23:00:00Z')});
    let cvgHigh = '72';
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const reply = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      if (url.pathname.endsWith('/assets/climate-station.js')) {
        return route.fulfill({status:200,contentType:'application/javascript',body:`
          (() => { let selected='CVG'; const stations=['CVG','IND'].map(faa => ({faa,name:faa+' airport',office:faa==='IND'?'IND':'ILN',ll:[-84.67,39.04],km:0,since:1900}));
          window.ClimateStation={setOverride:(_p,faa)=>selected=faa||'CVG',forPoint:async()=>({pointOffice:'ILN',station:stations.find(s=>s.faa===selected),alternatives:stations,missing:[],override:selected!=='CVG'})}; })();`});
      }
      if (url.hostname==='127.0.0.1') return route.continue();
      if (url.hostname==='api.open-meteo.com') return reply({timezone:'America/New_York'});
      if (url.hostname==='api.weather.gov' && url.pathname.includes('/products/')) {
        calls.push(url.pathname);
        const station = url.pathname.split('/').pop();
        if (url.pathname.includes('/locations/')) return reply({'@graph':[{id:station,issuingOffice:station==='IND'?'KIND':'KILN',issuanceTime:product.issuanceTime}]});
        return reply({...product,id:station,productText:product.productText.replace('CLICVG','CLI'+station).replace('MAXIMUM         72','MAXIMUM         '+(station==='CVG'?cvgHigh:'65'))});
      }
      if (url.hostname==='data.rcc-acis.org') {
        const q = route.request().postDataJSON();
        if (q.elems.some(e=>e.duration)) return reply({data:[]});
        if (typeof q.elems[0]==='object' && !q.elems[0].normal) return reply({data:[['2025-11-10','75','20','0.5','0']]});
        const normal = !!q.elems[0].normal, data=[];
        for(let d=new Date(q.sdate+'T12:00Z');d<=new Date(q.edate+'T12:00Z');d.setUTCDate(d.getUTCDate()+1)) {
          const day=d.toISOString().slice(0,10);
          data.push([day,...(normal?['56','37','0.10','0.0']:day==='2026-11-10'?['M','M','M','M','M']:['64','37','0.00','0.0','0'])]);
        }
        return reply({data});
      }
      return route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture: unavailable"}'});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/almanac.html?date=2026-11-10&lat=39.04456&lon=-84.67229&name=CVG`);
    const high=page.locator('[data-climo-row="maxt"] .climo-observed');
    await page.waitForFunction(()=>document.querySelector('[data-climo-row="maxt"] .climo-observed')?.textContent==='72');
    assert.match(await page.locator('.climo-nws').innerText(),/CVG.*5:00 PM/);
    assert.equal(await page.locator('.climo-context').getAttribute('data-cutoff'),'2026-11-09');
    cvgHigh='73';
    await page.clock.fastForward(5*60*1000);
    await page.waitForFunction(()=>document.querySelector('[data-climo-row="maxt"] .climo-observed')?.textContent==='73');
    assert.equal(calls.filter(u=>u.endsWith('/locations/CVG')).length,2,'NWS report checked again automatically');
    await page.selectOption('#climStn','IND');
    await page.waitForFunction(()=>document.querySelector('[data-climo-row="maxt"] .climo-observed')?.textContent==='65');
    assert.match(await page.locator('.climo-nws').innerText(),/IND/);
    assert.ok(calls.some(u=>u.endsWith('/locations/IND')),'station override requests its own CLI');
    await page.locator('#almDate').fill('2026-11-09'); await page.locator('#almDate').press('Tab');
    await page.waitForFunction(()=>document.querySelector('#climCard h2')?.textContent.includes('Nov 9, 2026'));
    assert.equal(await high.innerText(),'64','wrong-date NWS product never leaks into the sheet');
    assert.equal(await page.locator('.climo-nws').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: NWS fallback, preliminary cutoff, five-minute refresh, station change and wrong-date rejection (viewer in Tokyo)');
  } finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
