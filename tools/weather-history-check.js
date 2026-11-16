/* Documentary weather-history browser check. Weather providers are mocked; archive photos are local. */
let pw;
try { pw = require('playwright'); } catch {
  const driver = require('node:child_process').execFileSync('python', ['-c', 'import pathlib,playwright;print(pathlib.Path(playwright.__file__).parent/"driver/package")'], {encoding:'utf8'}).trim();
  pw = require(driver);
}
const { chromium } = pw;
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
    const base = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(`${base}almanac.html?date=2026-03-27&lat=39.04456&lon=-84.67229&name=CVG`);
    const card=page.locator('#weatherHistoryCard');
    await page.waitForFunction(()=>document.querySelector('#weatherHistoryEntries h3')?.textContent==='A city seen across floodwaters');
    const photo=page.locator('.weather-history-photo img');
    await photo.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelector('.weather-history-photo img')?.naturalWidth===640);
    assert.match(await page.locator('.weather-history-photo figcaption').innerText(),/Bain News Service/);
    assert.match(await page.locator('.weather-history-photo figcaption').innerText(),/not a photograph of the April 1 crest/);
    await fs.mkdir(path.join(root,'tests/out'),{recursive:true});
    for(const width of [360,390,1440]) {
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1),'history fits '+width);
      await card.screenshot({path:path.join(root,`tests/out/history-${width}.png`)});
    }
    await page.locator('#almDate').fill('2026-07-07');await page.locator('#almDate').press('Tab');
    await page.waitForFunction(()=>document.querySelector('#weatherHistoryEntries').textContent.includes('The windstorm that wrecked church steeples'));
    assert.match(await card.innerText(),/July 8, 1915/,'later publication date is visible on the event anniversary');
    assert.match(await page.locator('#sheetTitle').innerText(),/July 7, 2026/);
    assert.ok(await page.locator('a[href="https://www.nkyviews.com/Links/tornado_July_7_1915.htm"]').count());
    await page.locator('#almDate').fill('2026-01-10');await page.locator('#almDate').press('Tab');
    await page.waitForFunction(()=>document.querySelector('#weatherHistoryEntries h3')?.textContent==='The Freezer Bowl');
    assert.equal(await page.locator('.weather-history-photo').count(),0,'photo stays with its event');
    await page.locator('#almDate').fill('2024-02-29');await page.locator('#almDate').press('Tab');
    await page.waitForFunction(()=>document.querySelector('#weatherHistoryEntries').textContent.includes('Cincinnati climate record'));
    assert.match(await card.innerText(),/RCC-ACIS daily observation/,'leap day retains the real observation fallback');
    assert.deepEqual(errors,[]);
    console.log('PASS: documentary photo and credit, three widths, original-report links, date selection and leap-day fallback');
  } finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
