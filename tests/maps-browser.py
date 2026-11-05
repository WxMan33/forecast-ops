"""On-demand field downloads and recovery using the captured NOAA HRRR grid."""
import functools,http.server,json,threading
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
fixture=root/'tests/fixtures/maps/2026110418'
manifest=json.loads((fixture/'manifest.json').read_text())
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
requests=[];glyph_requests=[];fail={'refc':True};errors=[]
index={'generatedAt':'2026-11-05T01:00:00Z','runs':[{'id':'a','cycle':manifest['cycle'],'path':'qa-map/a','hoursExpected':3,'role':'latest-extended'},{'id':'b','cycle':'2026-11-04T17:00:00Z','path':'qa-map/b','hoursExpected':3,'role':'extended'}]}
def route(r):
 url=r.request.url
 if '/fonts/open-sans-v1/' in urlsplit(url).path:glyph_requests.append(url)
 if '/qa-map/' not in urlsplit(url).path:
  if url.startswith(origin):r.continue_()
  else:r.fulfill(status=404,body='')
  return
 requests.append(url)
 name=urlsplit(url).path.split('/')[-1]
 if name=='index.json':r.fulfill(content_type='application/json',body=json.dumps(index));return
 if name=='manifest.json':
  m=json.loads(json.dumps(manifest))
  if '/b/' in url:
   m['cycle']='2026-11-04T17:00:00Z';m['valid']=['2026-11-04T17:00:00Z','2026-11-04T18:00:00Z','2026-11-04T19:00:00Z','2026-11-04T20:00:00Z']
  r.fulfill(content_type='application/json',body=json.dumps(m));return
 if name=='refc.bin.gz' and fail['refc']:
  r.fulfill(status=503,body='test outage');return
 r.fulfill(content_type='application/octet-stream',body=(fixture/name).read_bytes())
def count(name):return sum(u.endswith(name) for u in requests)
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 context=browser.new_context(viewport={'width':1440,'height':1000})
 context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(origin+'/maps.html?data='+origin+'/qa-map/data')
 page.wait_for_function('document.querySelector("#runInfo").textContent.includes("loaded for this run")')
 page.wait_for_function('window.__maps && __maps.map.queryRenderedFeatures({layers:["place-labels"]}).length>0')
 assert glyph_requests and all(u.startswith(origin) for u in glyph_requests),'native labels use same-origin font glyphs'
 assert not page.evaluate('!!__maps.map.getLayer("dma")'),'no DMA outline'
 assert page.evaluate('__maps.map.getLayoutProperty("place-labels","text-allow-overlap")') is False
 assert count('t2m.bin.gz')==1 and count('latlon.bin.gz')==1
 assert count('refc.bin.gz')==count('apcp_hour.bin.gz')==count('apcp_run.bin.gz')==0
 assert page.locator('#fieldSel option[value="refd1km"]').is_disabled()
 page.locator('#placeSel').select_option(label='CVG airport')
 assert '64 °F' in page.locator('#inspect').inner_text()
 page.locator('#fieldSel').select_option('refc')
 page.wait_for_function('document.querySelector("#mapNote").textContent.includes("Could not load")')
 assert page.locator('#fieldSel').input_value()=='t2m'
 assert '2-m temperature' in page.locator('#mapInfo').inner_text()
 fail['refc']=False;page.locator('#fieldSel').select_option('refc')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("Composite reflectivity")')
 assert count('refc.bin.gz')==2
 page.locator('#fieldSel').select_option('t2m')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("2-m temperature")')
 assert count('t2m.bin.gz')==1
 page.locator('#hourSl').press('Home');page.locator('#hourSl').press('ArrowRight');page.locator('#hourSl').press('ArrowRight')
 page.locator('#fieldSel').select_option('precip')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("Precipitation")')
 assert count('apcp_hour.bin.gz')==1 and count('apcp_run.bin.gz')==0
 page.locator('#winSel').select_option('run')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("since run start")')
 assert count('apcp_run.bin.gz')==1
 page.locator('#winSel').select_option('24')
 page.wait_for_function('document.querySelector("#mapNote").textContent.includes("Unavailable at this hour")')
 assert count('apcp_hour.bin.gz')==1
 page.locator('#fieldSel').select_option('t2m')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("2-m temperature")')
 page.locator('#runSel').select_option('b')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("17Z")')
 assert page.locator('#hourSl').input_value()=='3','same valid time retained across runs'
 assert count('refc.bin.gz')==2 and count('apcp_run.bin.gz')==1,'switching run only loads the selected field'
 page.locator('#runSel').select_option('a')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("18Z")')
 assert count('t2m.bin.gz')==2 and count('latlon.bin.gz')==2,'both recent runs retained'
 assert page.locator('#hourSl').input_value()=='2','return to first run keeps the same valid time'
 out=root/'tests/out';out.mkdir(exist_ok=True)
 for width in [360,390,1440]:
  page.set_viewport_size({'width':width,'height':1000})
  page.wait_for_timeout(600) # allow the 200-ms resize handler and MapLibre's symbol placement to settle
  page.wait_for_function('window.__maps && __maps.map.areTilesLoaded()')
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1')
  assert page.locator('#venueBtn').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),'saved-location text stays inside its button'
  assert page.locator('#mapCtl .seg').evaluate('(e)=>Array.from(e.children).every(b=>b.getBoundingClientRect().right<=e.getBoundingClientRect().right+1)'),'view shortcuts stay inside their group'
  if width==1440:
   names=page.evaluate('__maps.map.getSource("map-labels").serialize().data.features.map(f=>f.properties.name)')
   assert len(names)>=5,('regional cities remain available after phone-to-desktop resize',names)
   print('Desktop label candidates:',names)
  page.screenshot(path=str(out/f'maps-demand-{width}.png'),full_page=True)
 assert not errors,errors
 print('Map browser: native labels, local glyphs, no DMA outline, selected-field requests, outage/retry, cached switches, original-cell inspection, precip dependencies, valid-time matching and three widths pass')
 browser.close()
server.shutdown()
