"""Forecast workspace/briefing browser contracts. Model forecasts are synthetic; NWS is a saved public fixture."""
import functools,http.server,json,threading
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urlparse,parse_qs,urlencode
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
fixtures={key:json.loads((ROOT/'tests/fixtures'/f'nws-cincinnati-{key}.json').read_text())['json'] for key in ['points','grid','hourly','forecast']}
base=datetime(2026,11,4,tzinfo=timezone.utc)
revision=0
impact_mode=False
visibility_clear=False
valley_mode=False
rain_mode=False

def om_response(url):
 q=parse_qs(urlparse(url).query);n=int(q.get('forecast_days',['7'])[0])*24;model=q.get('models',[''])[0]
 lats=q.get('latitude',['39.05'])[0].split(',');lons=q.get('longitude',['-84.66'])[0].split(',')
 if len(lats)>1:
  rows=[]
  for i,(lat,lon) in enumerate(zip(lats,lons)):
   qq={**q,'latitude':[lat],'longitude':[lon]}
   j=om_response(urlparse(url)._replace(query=urlencode(qq,doseq=True)).geturl())
   j.update(latitude=float(lat),longitude=float(lon),location_id=i);rows.append(j)
  return rows
 ens='ensemble-api' in url;members=(51 if 'ecmwf' in model else 31) if ens and q.get('hourly')==['precipitation'] else 5 if 'rrfs' in model else 3
 axis=[(base+timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(n)]
 def values(v,k):
  if v=='visibility':
   if valley_mode and abs(float(lats[0])-39.10583)<.01:return [2640 if 3<=i%24<9 else 52800 for i in range(n)]
   if visibility_clear:return [({'gfs_hrrr':8.5,'ncep_rrfs_conus':8.7,'ecmwf_ifs':17.4}.get(model,10))*5280]*n
   low=2640 if model=='gfs_hrrr' else 5280 if model=='ecmwf_ifs' else 10560
   return [low if impact_mode and 3<=i%24<9 else 52800 for i in range(n)]
  if rain_mode and v=='precipitation':return [.2]*n
  if impact_mode and v in ['temperature_2m','dew_point_2m','wind_speed_10m','wind_gusts_10m','cloud_cover','precipitation']:
   return [{'temperature_2m':35,'dew_point_2m':34,'wind_speed_10m':3,'wind_gusts_10m':26,'cloud_cover':20,'precipitation':0}[v]]*n
  if v=='temperature_2m':return [42+(i%24)/2+revision*4+k/10 for i in range(n)]
  if v=='precipitation':return [.12+revision*.08 if i%24 in [8+revision*3,9+revision*3,19] else 0 for i in range(n)]
  if v in ['snowfall','rain','showers']:return [0]*n
  if v=='precipitation_probability':return [63]*n
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
  if impact_mode and 'gust' in v:d[v]=[26]*len(dates)
 return {'latitude':float(lats[0]),'longitude':float(lons[0]),'timezone':'UTC','utc_offset_seconds':0,'hourly':h,'daily':d,'hourly_units':{v:('ft' if v=='visibility' else 'wmo code' if v=='weather_code' else '°F' if v in ['temperature_2m','dew_point_2m'] else 'inch' if v.split('_member')[0] in ['precipitation','snowfall'] else 'mph') for v in h}}

with sync_playwright() as p:
 browser=p.chromium.launch()
 context=browser.new_context(viewport={'width':1440,'height':1000})
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("localStorage.setItem('ops_blend_days','14')")
 # Keep the captured NWS issuance fresh so its wide comparison table is exercised.
 page.clock.install(time=datetime(2026,11,3,17,tzinfo=timezone.utc))
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
 assert page.locator('#weightScope').input_value()=='nearTemp'
 profiles=page.evaluate('JSON.parse(localStorage.getItem("ops_blend_period_weights_v1"))')
 assert profiles['nearTemp']['gfs_hrrr']['w']==2.5 and profiles['near']['gfs_hrrr']['w']==3
 assert profiles['nearTemp']['ecmwf_ens']['w']==4 and profiles['near']['ecmwf_ens']['w']==3
 page.locator('#fold_ops_blend_models > summary').click()
 page.locator('#weightScope').select_option('near')
 assert 'other fields' in page.locator('#weightScope option:checked').inner_text()
 page.locator('#weightScope').select_option('nearTemp')
 assert 'Only 2-m temperature' in page.locator('#weightScopeHelp').text_content()
 page.locator('#fold_ops_blend_models > summary').click()

 assert page.locator('#daily tbody tr').count()>=14
 headings=page.locator('#daily thead').text_content().lower()
 assert 'broadcast' in headings and 'source highs' not in headings
 page.wait_for_function("""Array.from(document.querySelectorAll('#daily td')).some(el=>el.title.includes('regional sample'))""")
 regional=page.locator('#daily td[title*="regional sample"]').first
 assert regional.locator('strong').text_content()=='100%'
 assert any(x in regional.text_content() for x in ['AM','PM','Overnight','Evening','windows'])
 assert page.evaluate('Ops.pct5(63)')=='65%', '63% displays as 65%'
 for cell in page.locator('#daily tr[data-k] td:nth-child(7)').all_text_contents():
  if '%' in cell:assert float(cell.rstrip('%'))%5==0, cell
 assert headings.index('morning')<headings.index('nws day'),'NWS morning low precedes daytime high'

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
 assert page.locator('#nwsCard tbody tr').count()>1,'exercise populated NWS comparison, not an unavailable placeholder'
 page.locator('#daily tr[data-k="2026-11-05"]').click()
 assert 'THU NOV 5' in page.locator('#driverCard .section-title').inner_text()
 assert page.locator('#timingDay').input_value()=='2026-11-05'
 assert 'THU NOV 5' in page.locator('#scenCard .section-sub').inner_text()
 page.get_by_role('tab',name='48 H',exact=True).click()
 assert 'WED NOV 4' in page.locator('#driverCard .section-title').inner_text(),'range reset refreshes source breakdown'
 page.locator('#daily tr[data-k="2026-11-04"]').click()
 for width in [360,390,900,1280,1440]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1'),str((width,page.evaluate('[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&!e.closest(".tablewrap")&&!e.closest(".navbar")).slice(0,12).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().width])')))
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
 # Compact investigation flags: sustained two-source screens, inline details and keyboard operation.
 page.emulate_media(media='screen');page.locator('#viewMode').click()
 impact_mode=True
 page.evaluate('sessionStorage.clear()');page.reload()
 page.wait_for_function('document.querySelectorAll(".impact-flag").length>0 && !document.querySelector("#runBtn").disabled')
 dayrow=page.locator('#daily tr[data-k="2026-11-04"]')
 assert dayrow.locator('.impact-fog').count()==1 and dayrow.locator('.impact-frost').count()==1
 assert dayrow.locator('.impact-wind').inner_text().startswith('G:20+')
 assert 20<=float(dayrow.locator('td').nth(8).inner_text().split()[0])<30,'future wind badge matches the displayed daily gust band'
 dayrow.locator('.impact-fog').click()
 assert page.locator('#impact-2026-11-04').is_visible()
 assert 'ECMWF IFS' in page.locator('#impact-2026-11-04').inner_text()
 assert 'Sustained visibility of 3 miles or less' in page.locator('#impact-2026-11-04').inner_text()
 vis_text=page.locator('#impact-2026-11-04 .impact-visibility').inner_text()
 assert '0.50 mi' in vis_text and '1.0 mi' in vis_text and '2.0 mi' in vis_text,'visibility is converted from feet to miles by source'
 assert 'ECMWF IFS 9 km' in vis_text
 assert not page.locator('#impact-2026-11-04 .impact-visibility-diagnostics').get_attribute('open')
 assert page.evaluate('!("ecmwf_ifs" in JSON.parse(JSON.stringify(window.Ops.Core.config.blend.models)).reduce((a,m)=>(a[m.id]=true,a),{}))'),'visibility-only IFS 9 km must not enter blend sources'
 assert 'sel' not in (dayrow.get_attribute('class') or ''),'flag click must not select the whole day'
 dayrow.locator('.impact-fog').press('Enter')
 assert not page.locator('#impact-2026-11-04').is_visible()
 for width in [360,390,1440]:
  page.set_viewport_size({'width':width,'height':900})
  dayrow.locator('.impact-frost').click()
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1'),str((width,page.evaluate('[...document.querySelectorAll(".impact-flags,.impact-flag,.impact-visibility,.dailywrap,#daily")].map(e=>[e.className,e.getBoundingClientRect().width,e.getBoundingClientRect().right])')))
  page.screenshot(path=str(out/f'focus-impacts-{width}.png'),full_page=True)
  dayrow.locator('.impact-frost').click()
 # Reproduce the report: all humidity/light-wind ingredients persist, but visibility is clear.
 visibility_clear=True
 page.evaluate('sessionStorage.clear()');page.reload()
 page.wait_for_function('document.querySelector("#daily tr[data-k]") && !document.querySelector("#runBtn").disabled')
 assert page.locator('#daily .impact-fog').count()==0,'8.5/8.7/17.4 mi must not show fog or limited-visibility flags'
 assert page.locator('#daily .impact-frost').count()>0,'frost screening stays independent'
 valley_mode=True
 page.evaluate('sessionStorage.clear()');page.reload()
 page.wait_for_function('document.querySelector("#daily .impact-fog") && !document.querySelector("#runBtn").disabled')
 valley_flag=page.locator('#daily tr[data-k="2026-11-04"] .impact-fog')
 assert valley_flag.inner_text().startswith('AM fog?') and 'LUK' in valley_flag.inner_text() and 'CVG' not in valley_flag.inner_text(),'valley-only flag names LUK despite clear CVG'
 valley_flag.click()
 valley_text=page.locator('#impact-2026-11-04 .impact-visibility').inner_text()
 assert 'Lunken Field' in valley_text and '0.50 mi' in valley_text
 assert '8.5 mi' not in valley_text and 'retrieved' not in valley_text
 assert page.locator('#impact-2026-11-04 .impact-airport').count()==1
 assert 'No qualifying signal: CVG, HAO, MWO' in valley_text
 page.locator('#impact-2026-11-04 .impact-visibility-diagnostics summary').click()
 assert '8.5 mi' in page.locator('#impact-2026-11-04 .impact-visibility').inner_text()
 page.locator('#impact-2026-11-04 .impact-visibility-diagnostics summary').click()
 for width in [360,390,1440]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1'),f'airport visibility overflow at {width}'
  page.screenshot(path=str(out/f'focus-valley-fog-{width}.png'),full_page=True)
 rain_mode=True
 page.evaluate('sessionStorage.clear()');page.reload()
 page.wait_for_function('document.querySelector("#daily tr[data-k]") && !document.querySelector("#runBtn").disabled')
 assert page.locator('#daily .impact-fog').count()==0,'rain-obscured LUK must not produce a regional fog/visibility flag'
 # At 9 AM, elapsed morning lows disappear while today stays available.
 page.clock.set_fixed_time(datetime(2026,11,4,9,0,tzinfo=timezone.utc))
 page.reload();page.wait_for_function('!document.querySelector("#runBtn").disabled && document.querySelector("#daily tr[data-k]")')
 tile_text=page.locator('#tiles').inner_text().casefold()
 assert 'today high' in tile_text and 'tonight low' in tile_text,tile_text
 assert page.locator('#daily tr[data-k="2026-11-04"] td').nth(1).inner_text()=='—'
 # At 2 PM, tonight leads but today remains in the table.
 page.clock.set_fixed_time(datetime(2026,11,4,14,0,tzinfo=timezone.utc))
 page.reload();page.wait_for_function('!document.querySelector("#runBtn").disabled && document.querySelector("#daily tr[data-k]")')
 assert page.locator('#tiles .tile .k').first.inner_text().casefold()=='tonight low'
 assert page.locator('#daily tr[data-k]').first.get_attribute('data-k')=='2026-11-04'
 # Evening planning focus and an explicit way to reopen the elapsed calendar day.
 page.clock.set_fixed_time(datetime(2026,11,4,17,0,tzinfo=timezone.utc))
 page.reload();page.wait_for_function('!document.querySelector("#runBtn").disabled && document.querySelector("#daily tr[data-k]")')
 assert page.locator('#daily tr[data-k]').first.get_attribute('data-k')=='2026-11-05'
 tile_text=page.locator('#tiles').inner_text().casefold()
 assert 'tonight low' in tile_text and 'tomorrow high' in tile_text,tile_text
 assert page.locator('#timingDay option:checked').inner_text()=='Tonight / tomorrow'
 page.locator('#elapsedToday').click()
 assert page.locator('#daily tr[data-k]').first.get_attribute('data-k')=='2026-11-04'
 page.locator('#elapsedToday').click()
 assert page.locator('#daily tr[data-k]').first.get_attribute('data-k')=='2026-11-05'
 for width in [360,1440]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)<=innerWidth+1')
  page.screenshot(path=str(out/f'focus-evening-{width}.png'),full_page=True)
 saved_history_count=len(history())
 page.locator('#viewMode').click()
 # Full failure state, with retained local history/settings.
 page.emulate_media(media='screen');context.unroute('**/*');context.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:') else r.fulfill(status=503,content_type='application/json',body='{"error":true,"reason":"synthetic outage"}'))
 page.evaluate('sessionStorage.clear()');page.reload()
 page.wait_for_function('document.querySelector("#briefingView").textContent.includes("could not be loaded")')
 assert len(history())==saved_history_count,'failed fetch leaves saved history intact'
 assert not errors,errors
 print('Forecast-first, trends, timing, briefing, reload, failure, themes, print and five viewport widths pass')
 browser.close()
server.shutdown()
