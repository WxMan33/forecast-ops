"""Browser contract test using explicitly synthetic forecasts, never private archive data."""
import json, threading, http.server, functools
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root))
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
t=1793725200000
cap={'captureId':'synthetic_midday','slot':'midday','trigger':'scheduled','retrievedAt':'2026-11-03T17:00:00Z','file':'reports/dashboard/synthetic.json','sources':{'nws':{},'ecmwf_ens':{}},'classes':{'nws':'primary','ecmwf_ens':'primary'}}
D={'sourceLabels':{},'defaultId':'blend:default-v2','defaultCaptured':False,'minDates':30,'minimumLeadMinutes':60,'matchToleranceMinutes':15,'captures':[cap],'observed':[{'valid':t+7200000,'measuredAt':t+7140000,'value':62,'src':'synthetic METAR','status':'preliminary'}],'history':[{'captureId':cap['captureId'],'id':i,'date':'2026-11-04','target':'tmax_clim','value':v,'slot':'midday','cls':'primary','retrievedAt':cap['retrievedAt'],'window':[1,2],'hash':None,'contributors':[[i,1]],'normVersion':'synthetic'} for i,v in [('nws',64),('ecmwf_ens',65)]],'dailyPairs':[],'hourlyPairs':[]}
idx={'at':'synthetic fixture','loc':{'name':'CVG'},'reviewQueue':0,'health':{'expected':0,'slots':[],'gaps':[],'manual':0},'lastRuns':{},'captures':[],'runs':[],'latestBlendInfo':{},'tvLatest':[]}
history=D.pop('history');D['historyFiles']={'2026-11-04':'reports/dashboard/history-2026-11-04.json'}
files={'reports/dashboard/history-2026-11-04.json':history,'reports/index.json':idx,'reports/scores.json':{'pairsCount':0,'pendingCount':0,'summary':[],'comparisons':[],'hourly':[],'minDates':30},'reports/review-queue.json':{'items':[]},'reports/dashboard/index.json':D,'reports/dashboard/synthetic.json':{**cap,'bundle':'synthetic fixture','normalizer':'synthetic','hourly':{'t0':t,'stepMs':3600000,'n':5,'temperature_2m':{'nws':[60,61,62,63,64],'ecmwf_ens':[61,62,None,64,65]}}}}
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page()
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def route(r):
  rel=r.request.url.split('/contents/')[1].split('?')[0]
  r.fulfill(status=200 if rel in files else 404,content_type='application/json',body=json.dumps(files.get(rel,{})))
 page.route('https://api.github.com/**',route)
 page.goto(f'http://127.0.0.1:{server.server_port}/verify.html')
 page.locator('#tok').fill('synthetic-test-token')
 page.locator('#load').click()
 page.get_by_role('button',name='Temperature tracking',exact=True).click()
 page.locator('.vchart').wait_for()
 assert page.locator('#thour').count()==1
 page.locator('#thour').focus()
 page.keyboard.press('ArrowRight')
 assert page.locator('#thour').evaluate('(e)=>document.activeElement===e')
 page.get_by_role('button',name='Daily verification',exact=True).click()
 assert '0 matched cases' in page.locator('#pane').inner_text()
 page.get_by_role('button',name='Forecast history',exact=True).click()
 page.locator('#hdate').wait_for()
 page.locator('#hdate').fill('2026-11-04')
 page.locator('#hdate').dispatch_event('change')
 assert '64.0' in page.locator('#pane').inner_text()
 for width in [360,390,1280,1440]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),str((width,page.evaluate('[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().width]).slice(0,12)')))
  Path(root/'tests/out').mkdir(exist_ok=True)
  page.screenshot(path=str(root/f'tests/out/dashboard-{width}.png'),full_page=True)
 page.get_by_role('button',name='TV products & review',exact=True).click()
 assert 'Nothing to review.' in page.locator('#pane').inner_text()
 page.get_by_role('button',name='Blend recipes',exact=True).click()
 page.get_by_role('button',name='Exports',exact=True).click()
 assert not errors,errors
 browser.close()
server.shutdown()
print('Dashboard browser: chart, keyboard, daily/history, review, export and four viewport widths passed with synthetic fixtures.')
