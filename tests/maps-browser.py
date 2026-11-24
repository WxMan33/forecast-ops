"""On-demand field downloads and recovery using the captured NOAA HRRR grid."""
import functools,gzip,http.server,json,struct,threading,math
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
fixture=root/'tests/fixtures/maps/2026110418'
manifest=json.loads((fixture/'manifest.json').read_text())
new_fixture=root/'tests/fixtures/maps/2026110500'
new_manifest=json.loads((new_fixture/'manifest.json').read_text())
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
requests=[];glyph_requests=[];fail={'refc':True};errors=[]
index={'generatedAt':'2026-11-05T01:00:00Z','runs':[{'id':'a','cycle':manifest['cycle'],'path':'qa-map/a','hoursExpected':3,'role':'latest-extended'},{'id':'b','cycle':'2026-11-04T17:00:00Z','path':'qa-map/b','hoursExpected':3,'role':'extended'},{'id':'surface','cycle':new_manifest['cycle'],'path':'qa-map/surface','hoursExpected':3,'role':'extended'}]}
# One synthetic CONUS hour on HRRR's projection, cropped to the Ohio Valley.
# Native tiles hold 0.24 in, while the packed Cincinnati label is dry.
conus_cycle='2026-11-04T18:00:00Z'
conus_run={'id':'conus','cycle':conus_cycle,'path':'qa-map/conus/run','hours':[1],'hoursExpected':1,'status':'complete','fields':['apcp_run']}
conus_manifest={
 'cycle':conus_cycle,'hours':[1],'hoursExpected':1,'status':'complete',
 'valid':{'1':'2026-11-04T19:00:00Z'},'layout':'tiles','tile':128,
 'grid':{'radius':6371229,'Latin1InDegrees':38.5,'Latin2InDegrees':38.5,'LaDInDegrees':38.5,'LoVInDegrees':-97.5,
         'DxInMetres':3000,'DyInMetres':3000,'i0':0,'j0':0,'x0':928241,'y0':-91566,'nx':128,'ny':128},
 'levels':[{'level':0,'every':1,'nx':128,'ny':128,'tilesX':1,'tilesY':1}],
 'points':{'places':[['Cincinnati',39.136,-84.504,1640000]],'lattice':{'i0':0,'j0':0,'every':16,'nx':0,'ny':0}},
 'fields':{'apcp_run':{'scale':0.01,'displayStep':1,'hours':{'1':{'points':True}}}},
}
conus_tile=gzip.compress((bytes([48])+bytes(127))*128+bytes(128*128))
# One synthetic ECMWF hour on a regular lat-lon crop (0.25 degree cells from 20N 100W), every cell 40.0 degF
ecmwf_run={'id':'ec','cycle':conus_cycle,'path':'qa-map/conus/ecmwf/run','hours':[1],'hoursExpected':1,'status':'complete','fields':['t2m','asnow_run','asnowk_run']}
ecmwf_manifest={**conus_manifest,'grid':{'gridType':'regular_ll','Ni':1440,'Nj':721,'latitudeOfFirstGridPointInDegrees':90.0,'longitudeOfFirstGridPointInDegrees':180.0,
 'iDirectionIncrementInDegrees':0.25,'jDirectionIncrementInDegrees':0.25,'iScansNegatively':0,'jScansPositively':0,'jPointsAreConsecutive':0,
 'i0':320,'j0':280,'rowStep':-1,'nx':128,'ny':128,'lat0':20.0,'lon0':-100.0,'dlat':0.25,'dlon':0.25},
 'fields':{'t2m':{'scale':0.1,'displayStep':5,'hours':{'1':{'points':True}}},
  'asnow_run':{'scale':0.01,'displayStep':10,'coarse':'block max','snowRatio':10,'hours':{'1':{'points':True}}},
  'asnowk_run':{'scale':0.01,'displayStep':10,'coarse':'block max','snowRatio':'kuchera','hours':{'1':{'points':True}}}}}
ecmwf_tile=gzip.compress((bytes([32])+bytes(127))*128+(bytes([3])+bytes(127))*128)
def route(r):
 url=r.request.url
 if '/fonts/open-sans-v1/' in urlsplit(url).path:glyph_requests.append(url)
 if url.startswith('https://wxman33.github.io/forecast-ops-maps/data/conus/index.json'):r.fulfill(json={'runs':[conus_run]});return   # the GitHub Pages data host
 if '/qa-map/' not in urlsplit(url).path:
  if url.startswith(origin):r.continue_()
  else:r.fulfill(status=404,body='')
  return
 requests.append(url)
 name=urlsplit(url).path.split('/')[-1]
 if '/conus/ecmwf/' in urlsplit(url).path:
  if name=='index.json':r.fulfill(json={'runs':[ecmwf_run]})
  elif name=='manifest.json':r.fulfill(json=ecmwf_manifest)
  elif name=='p01.bin.gz':r.fulfill(body=gzip.compress(struct.pack('<h',400)))
  elif name=='L0_0_0.bin.gz':r.fulfill(body=ecmwf_tile)
  else:r.fulfill(status=404,body='')
  return
 if '/qa-map/conus/' in urlsplit(url).path or '/qa-map/data/conus/' in urlsplit(url).path:
  if name=='index.json':r.fulfill(json={'runs':[conus_run]})
  elif name=='manifest.json':r.fulfill(json=conus_manifest)
  elif name=='p01.bin.gz':r.fulfill(body=gzip.compress(struct.pack('<h',0)))
  elif name=='L0_0_0.bin.gz':r.fulfill(body=conus_tile)
  else:r.fulfill(status=404,body='')
  return
 if name=='index.json':r.fulfill(content_type='application/json',body=json.dumps(index));return
 if name=='manifest.json':
  m=json.loads(json.dumps(new_manifest if '/surface/' in url else manifest))
  if '/b/' in url:
   m['cycle']='2026-11-04T17:00:00Z';m['valid']=['2026-11-04T17:00:00Z','2026-11-04T18:00:00Z','2026-11-04T19:00:00Z','2026-11-04T20:00:00Z']
  r.fulfill(content_type='application/json',body=json.dumps(m));return
 if name=='refc.bin.gz' and fail['refc']:
  r.fulfill(status=503,body='test outage');return
 r.fulfill(content_type='application/octet-stream',body=((new_fixture if '/surface/' in url else fixture)/name).read_bytes())
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
 assert page.locator('#fieldSel option[value="d2m"]').is_disabled(),'new fields remain unavailable on legacy runs'
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
  assert page.locator('#mapCtl .seg[aria-label="Map view"]').evaluate('(e)=>Array.from(e.children).every(b=>b.getBoundingClientRect().right<=e.getBoundingClientRect().right+1)'),'view shortcuts stay inside their group'
  if width==1440:
   names=page.evaluate('__maps.map.getSource("map-labels").serialize().data.features.map(f=>f.properties.name)')
   assert len(names)>=5,('regional cities remain available after phone-to-desktop resize',names)
   print('Desktop label candidates:',names)
  page.screenshot(path=str(out/f'maps-demand-{width}.png'),full_page=True)
 # New surface package: actual GRIB definitions, point values and one download per selected field.
 page.locator('#runSel').select_option('surface')
 page.wait_for_function('document.querySelector("#mapInfo").textContent.includes("11/05 00Z")')
 page.locator('#hourSl').press('Home')
 for field,label,units in [('d2m','2-m dew point','°F'),('w10m','10-m wind speed','mph'),('gust','Surface wind gust','mph'),('cloud','Total cloud cover','%')]:
  assert page.locator(f'#fieldSel option[value="{field}"]').is_enabled()
  page.locator('#fieldSel').select_option(field)
  page.wait_for_function('(label)=>document.querySelector("#mapInfo").textContent.includes(label)',arg=label)
  value=page.locator('#inspect .inspect-v b').inner_text()
  cp=new_manifest['fieldCheckpoints'][field]['points'][0];expected=cp['value']
  if field=='d2m':expected=(expected-273.15)*9/5+32
  elif field in ['w10m','gust']:expected*=2.2369362920544
  assert units in value and abs(float(value.split()[0])-expected)<= (0.55 if field in ['d2m','cloud'] else 0.051),(field,value,expected)
  assert count(field+'.bin.gz')==1,(field,'only selected field downloaded once')
 assert '100+' not in page.locator('#legend').inner_text(),'cloud cover stops at 100 percent'
 for width in [390,1440]:
  page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(600)
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1')
  page.screenshot(path=str(out/f'maps-demand-surface-{width}.png'),full_page=True)
 # County geography and town forecasts stay distinct from the Values toggle.
 page.goto(origin+'/maps.html?domain=conus&data='+origin+'/qa-map/data&field=apcp_run&map=39.1,-84.5,8.1')
 page.wait_for_function("window.__conus?.map.queryRenderedFeatures({layers:['counties']}).length > 0")
 page.wait_for_function("window.__conus?.labelsShown?.some(x => String(x.k).startsWith('town:') && x.name && x.text === '0.24')")
 page.wait_for_function("window.__conus?.map.queryRenderedFeatures({layers:['places']}).some(f => f.properties.name === 'Cincinnati')")
 page.locator('#valBtn').click()
 page.wait_for_function("window.__conus?.labelsShown?.length === 0")
 assert page.evaluate("__conus.map.queryRenderedFeatures({layers:['counties']}).length > 0")
 assert page.evaluate("__conus.map.queryRenderedFeatures({layers:['places']}).some(f => f.properties.name === 'Cincinnati')")
 page.evaluate("__conus.map.jumpTo({zoom:4})")
 page.wait_for_function("window.__conus?.map.queryRenderedFeatures({layers:['counties']}).length === 0")
 print('CONUS browser: county lines at local zoom, native named plots, dry city name and Values Off pass')
 # ECMWF on its lat-lon grid: offered in the model menu off GitHub Pages, drawn on the lat-lon projection, its own credit
 page.goto(origin+'/maps.html?domain=conus&model=ecmwf&data='+origin+'/qa-map/data&field=t2m&map=39.1,-84.5,5')
 page.wait_for_function("window.__conus?.man && __conus.draw && __conus.draw.length > 0")
 assert page.evaluate("__conus.P.kind")=='latlon','a regular_ll manifest selects the lat-lon projection'
 assert 'ecmwf' in page.evaluate("[...document.querySelectorAll('#modelSel option')].map(o=>o.value)"),'ECMWF is in the model menu off GitHub Pages'
 assert 'ECMWF IFS 0.25' in page.locator('#modelSel option[value="ecmwf"]').inner_text()
 page.evaluate("MapsConus.api.point(39.1,-84.5)")
 page.wait_for_function("document.querySelector('#inspect').innerText.includes('40.0 °F')")
 assert 'centred at 39.0000, -84.5000' in page.locator('#inspect').inner_text(),page.locator('#inspect').inner_text()
 assert '© ECMWF, CC BY 4.0' in page.locator('.maplibregl-ctrl-attrib').inner_text()
 assert page.locator('#fieldSel option[value="refc"]').count()==0,'fields ECMWF does not publish are not offered'
 # ECMWF snowfall: the 10:1 field keeps its label; the Kuchera run total and its same-window 6-h/12-h fields are offered beside it
 opts=dict(page.evaluate("[...document.querySelectorAll('#fieldSel option')].map(o=>[o.value,o.textContent])"))
 assert opts.get('asnow_run')=='Total snowfall since run start (ECMWF, 10:1)',opts.get('asnow_run')
 assert opts.get('asnowk_run')=='Total snowfall since run start (ECMWF, Kuchera)',opts.get('asnowk_run')
 assert '6-h snowfall (ECMWF, Kuchera' in opts.get('asnowk6','') and '12-h snowfall (ECMWF, Kuchera' in opts.get('asnowk12',''),opts
 assert page.evaluate("__conus.man.fields.asnowk6.derivedFrom")=='asnowk_run' and page.evaluate("__conus.man.fields.asnowk12.derivedFrom")=='asnowk_run','same-window Kuchera fields derive from the Kuchera run total'
 page.select_option('#fieldSel','asnowk_run')
 page.wait_for_function("MapsConus.api.state().field==='asnowk_run' && __conus.draw && __conus.draw.length > 0")
 info=page.locator('#mapInfo').inner_text()
 assert 'Kuchera' in info and '18,000 ft' in info and 'colder columns give fluffier snow, near-freezing columns wetter snow' in info,info
 assert page.locator('#legend').inner_text().startswith('Run-total snowfall (Kuchera)'),page.locator('#legend').inner_text()
 page.evaluate("MapsConus.api.point(39.1,-84.5)")
 page.wait_for_function("document.querySelector('#inspect').innerText.includes('Total snowfall since run start (ECMWF, Kuchera)')")
 page.select_option('#fieldSel','t2m')
 page.goto(origin+'/maps.html?domain=conus&field=t2m')
 page.wait_for_function("document.querySelectorAll('#modelSel option').length>0")
 assert not {'ecmwf','rrfs'}&set(page.evaluate("[...document.querySelectorAll('#modelSel option')].map(o=>o.value)")),'R2-only models are not offered on GitHub Pages'
 print('CONUS browser: ECMWF lat-lon grid, menu, native cell value, Kuchera snowfall entries and credit pass')
 assert not errors,errors
 print('Map browser: new surface fields against GRIB checkpoints, native labels, local glyphs, no DMA outline, selected-field requests, outage/retry, cached switches, original-cell inspection, precip dependencies, valid-time matching and three widths pass')
 browser.close()
server.shutdown()
