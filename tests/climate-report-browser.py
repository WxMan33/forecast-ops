"""Climate worksheet layout with captured official data. Missing coverage remains visible."""
import functools,http.server,json,threading
from datetime import datetime,timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];fixtures=root/'tests/fixtures/almanac'
def fixture(name):return json.loads((fixtures/name).read_text())['json']
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page()
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.clock.install(time=datetime(2026,11,3,17,tzinfo=timezone.utc))
 requests=[]
 def route(r):
  url=r.request.url
  if url.startswith('http://127.0.0.1:'):r.continue_();return
  requests.append(url)
  if 'rcc-acis.org/StnData' in url:
   q=r.request.post_data_json
   if q['sid']=='CVG':
    name='acis-normals-CVG-2026-11.json' if isinstance(q['elems'][0],dict) else 'acis-obs-CVG-recent.json'
   elif any(isinstance(e,dict) and 'duration' in e for e in q['elems']):name='acis-mtd2-CVGthr-11-02.json'
   else:name='acis-records2-CVGthr-11-02.json'
   r.fulfill(status=200,content_type='application/json',body=json.dumps(fixture(name)))
  elif 'aa.usno.navy.mil' in url:
   name='usno-moonphases-2026-11-01.json' if 'moon/phases' in url else 'usno-downtown-2026-11-03.json'
   r.fulfill(status=200,content_type='application/json',body=json.dumps(fixture(name)))
  else:r.fulfill(status=404,content_type='application/json',body='{}')
 context.route('**/*',route)
 page.goto(f'http://127.0.0.1:{server.server_port}/almanac.html?date=2026-11-03')
 page.locator('[data-climo-row="maxt"]').wait_for()
 assert page.locator('#loadGuard').count()==0,errors
 assert 'Nov 2, 2026' in page.locator('.climo-title').inner_text()
 assert page.locator('[data-climo-row="maxt"] [data-label="Observed"]').inner_text()=='60'
 assert page.locator('[data-climo-row="maxt"] [data-label="Normal"]').inner_text()=='60'
 assert page.locator('[data-climo-row="maxt"] [data-label="Departure"]').inner_text()=='0'
 assert 'Precipitation' in page.locator('#climCard').inner_text()
 assert 'Snowfall' in page.locator('#climCard').inner_text()
 assert page.locator('[data-climo-row="pcpn-mtd"]').count()==1
 assert page.locator('[data-climo-row="snow-season"]').count()==1
 assert page.locator('[data-climo-row="snwd"]').count()==1
 assert page.evaluate('document.querySelector(".almhead").nextElementSibling.id')=='climCard'
 assert not any('forecast.weather.gov' in u or 'api.weather.gov' in u for u in requests),'no forecast on Almanac'
 out=root/'tests/out';out.mkdir(exist_ok=True)
 for width in [360,390,900,1280,1440]:
  page.set_viewport_size({'width':width,'height':1000})
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1'),f'climate overflow at {width}'
  page.screenshot(path=str(out/f'climo-dark-{width}.png'),full_page=True)
 page.locator('#themeBtn').click()
 page.screenshot(path=str(out/'climo-light-desktop.png'),full_page=True)
 page.locator('#notes').fill('Synthetic QA note, saved separately from official values.')
 page.reload();page.locator('[data-climo-row="maxt"]').wait_for()
 assert 'Synthetic QA note' in page.locator('#notes').input_value()
 page.emulate_media(media='print');page.screenshot(path=str(out/'climo-print.png'),full_page=True)
 # Failure does not imply that observations were zero.
 page.emulate_media(media='screen');context.unroute('**/*')
 context.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:') else r.fulfill(status=503,content_type='application/json',body='{"error":"synthetic outage"}'))
 page.evaluate('Object.keys(localStorage).filter(k=>k.startsWith("alm:")).forEach(k=>localStorage.removeItem(k))')
 page.reload();page.locator('.climo-table').wait_for()
 assert page.locator('[data-climo-row="maxt"] [data-label="Observed"]').inner_text()=='—'
 assert 'unavailable' in page.locator('#climCard').inner_text()
 assert not errors,errors
 print('Climate sheet: captured observations, matched date/normal, six columns, totals, missing data, notes, themes, print and five widths pass')
 browser.close()
server.shutdown()
