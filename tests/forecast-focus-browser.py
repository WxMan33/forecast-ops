"""Forecast workspace/briefing browser contracts. Model forecasts are synthetic; NWS is a saved public fixture."""
import functools,http.server,json,threading
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
fixtures={key:json.loads((ROOT/'tests/fixtures'/f'nws-cincinnati-{key}.json').read_text())['json'] for key in ['points','grid','hourly','forecast']}
base=datetime(2026,11,4,tzinfo=timezone.utc)
revision=0

def om_response(url):
 q=parse_qs(urlparse(url).query);n=int(q.get('forecast_days',['7'])[0])*24;model=q.get('models',[''])[0]
 ens='ensemble-api' in url;members=5 if 'rrfs' in model else 3
 axis=[(base+timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(n)]
 def values(v,k):
  if v=='temperature_2m':return [42+(i%24)/2+revision*4+k/10 for i in range(n)]
  if v=='precipitation':return [.12+revision*.08 if i%24 in [8+revision*3,9+revision*3,19] else 0 for i in range(n)]
  if v in ['snowfall','rain','showers']:return [0]*n
  if v=='precipitation_probability':return [60]*n
  if v in ['wind_gusts_10m','wind_speed_10m']:return [18]*n
  if v=='weather_code':return [3]*n
  return [30]*n
 h={'time':axis}
 for v in q.get('hourly',[''])[0].split(','):
  if not v:continue
  for k in range(members if ens else 1):h[v+(f'_member{k:02}' if k else '')]=values(v,k)
 dates=list(dict.fromkeys(x[:10] for x in axis));d={'time':dates}
 for v in q.get('daily',[''])[0].split(','):
  if not v:continue
  d[v]=[54+revision*4 if v=='temperature_2m_max' else 42+revision*4 if v=='temperature_2m_min' else .36+revision*.24 if v=='precipitation_sum' else 18 if 'gust' in v else 0 for _ in dates]
 return {'latitude':39.05,'longitude':-84.66,'timezone':'UTC','utc_offset_seconds':0,'hourly':h,'daily':d,'hourly_units':{v:('°F' if 'temperature' in v else 'inch' if v in ['precipitation','snowfall'] else 'mph') for v in h}}

with sync_playwright() as p:
 browser=p.chromium.launch()
 context=browser.new_context(viewport={'width':1440,'height':1000})
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("localStorage.setItem('ops_blend_days','14')")
 page.clock.install(time=datetime(2026,11,4,6,tzinfo=timezone.utc))
 def external(route):
  url=route.request.url
  if 'open-meteo.com' in url:
   if 'meta.json' in url:route.fulfill(status=200,content_type='application/json',body='{}')
   else:route.fulfill(status=200,content_type='application/json',body=json.dumps(om_response(url)))
  elif 'api.weather.gov' in url:
   key='points' if '/points/' in url else 'hourly' if '/forecast/hourly' in url else 'forecast' if '/forecast' in url else 'grid'
   route.fulfill(status=200,content_type='application/json',body=json.dumps({'features':[]} if '/alerts/' in url else fixtures[key]))
  else:route.fulfill(status=404,content_type='application/json',body='{}')
 context.route('**/*',lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1:') else external(r))
 url=f'http://127.0.0.1:{server.server_port}/blend.html?lat=39.05&lon=-84.66&name=Synthetic+QA'
 page.goto(url)
 page.wait_for_function('document.querySelector("#modelTrendCard").textContent.includes("first guidance")')
 assert page.locator('#loadGuard').count()==0,errors
 assert page.locator('.side #models').count()==1
 assert page.locator('.side #presetTabs').count()==1
 assert page.locator('.main #recipeNote').count()==0
 assert page.locator('#daily tbody tr').count()>=14
 assert page.evaluate('document.querySelector("#daily").closest(".card").nextElementSibling.id')=='forecastChartCard','graph immediately follows daily blend'
 def history():return page.evaluate('Object.values(JSON.parse(localStorage.getItem("ops_model_guidance_history_v1")))[0].items')
 assert len(history())==1,'first snapshot persisted'
 assert history()[0]['tz']=='UTC','synthetic model response must be used, not live data'
 # Repeated refresh (including cache) never creates a new guidance update.
 page.reload();page.wait_for_function('document.querySelector("#modelTrendCard").textContent.includes("first guidance")')
 assert len(history())==1
 revision=1
 page.evaluate('sessionStorage.clear()');page.clock.run_for(60_000)
 page.reload();page.wait_for_function('!document.querySelector("#runBtn").disabled && !document.querySelector("#dataChip").textContent.includes("FETCHING")')
 page.wait_for_function('document.querySelectorAll("#modelTrendCard .model-change-list li").length>0')
 assert len(history())==2
 text=page.locator('#modelTrendCard').inner_text()
 assert 'High' in text or 'Low' in text
 assert 'Liquid precip' in text
 assert 'recipe changed' not in text
 assert 'later' in page.locator('#timingCard').inner_text()
 # Changing a preset is deliberately not a model-data change.
 page.get_by_role('tab',name='CUSTOM WEIGHTS',exact=True).click()
 assert len(history())==2
 assert 'High' in page.locator('#modelTrendCard').inner_text() or 'Low' in page.locator('#modelTrendCard').inner_text()
 # The meteorologist tools stay available under a disclosure.
 page.locator('.technical>summary').click()
 assert page.locator('#covCard').is_visible()
 for width in [360,390,900,1280,1440]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1'),f'open diagnostics overflow at {width}'
  assert page.evaluate('[...document.querySelectorAll(".technical .tablewrap")].every(e=>e.getBoundingClientRect().right<=e.closest(".technical").getBoundingClientRect().right+1)'),f'table escaped card at {width}'
 page.set_viewport_size({'width':1440,'height':1000})
 page.screenshot(path=str(ROOT/'tests/out/focus-diagnostics-desktop.png'),full_page=True)
 page.locator('.technical>summary').click()
 page.locator('#viewMode').click()
 assert page.locator('#briefingView').is_visible()
 assert not page.locator('.side').is_visible()
 assert 'view=brief' in page.url
 assert 'What changed' in page.locator('#briefingView').inner_text()
 page.locator('#briefDay').select_option('2026-11-05')
 assert 'THU NOV 5' in page.locator('#briefingView').inner_text()
 out=ROOT/'tests/out';out.mkdir(exist_ok=True)
 page.screenshot(path=str(out/'focus-brief-desktop.png'),full_page=True)
 # Direct briefing links survive shell URL normalization and reloads.
 page.reload();page.wait_for_function('document.querySelector("#briefingView h1")!==null')
 assert page.locator('#briefingView').is_visible() and 'view=brief' in page.url
 for width in [360,390,900,1280,1440]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1'),f'brief overflow at {width}'
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'focus-brief-phone.png'),full_page=True)
 page.locator('#viewMode').click()
 for width in [360,390,900,1280,1440]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1'),f'workspace overflow at {width}'
 page.set_viewport_size({'width':1440,'height':1000})
 page.screenshot(path=str(out/'focus-workspace-desktop.png'),full_page=True)
 page.set_viewport_size({'width':390,'height':844})
 assert not page.locator('#forecastControls').get_attribute('open'),'phone controls start collapsed'
 page.screenshot(path=str(out/'focus-workspace-phone.png'),full_page=True)
 page.locator('#forecastControls>summary').click();assert page.locator('#locCard').is_visible()
 page.locator('#forecastControls>summary').click()
 page.locator('#themeBtn').click()
 assert page.locator('html').get_attribute('data-theme')=='light'
 assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1')
 page.locator('#viewMode').click();page.emulate_media(media='print')
 assert page.locator('#briefingView').is_visible()
 page.screenshot(path=str(out/'focus-brief-print.png'),full_page=True)
 # Full failure state, with retained local history/settings.
 page.emulate_media(media='screen');context.unroute('**/*');context.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:') else r.fulfill(status=503,content_type='application/json',body='{"error":true,"reason":"synthetic outage"}'))
 page.evaluate('sessionStorage.clear()');page.reload()
 page.wait_for_function('document.querySelector("#briefingView").textContent.includes("could not be loaded")')
 assert len(history())==2,'failed fetch leaves saved history intact'
 assert not errors,errors
 print('Forecast-first, trends, timing, briefing, reload, failure, themes, print and five viewport widths pass')
 browser.close()
server.shutdown()
