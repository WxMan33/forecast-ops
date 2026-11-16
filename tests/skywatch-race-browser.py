"""Almanac sky card: date changes never show, or let anyone act on, an earlier date's results.
Deterministic: NASA-feed responses are held by the test and released in a chosen order; no sleeps.
- the card is explicitly loading (no heading, no buttons) in the same task as the date change;
- a delayed response for the old date, released after the new date is ready, never redraws the card;
- rapid A -> B -> A changes settle on A, whichever held response is released last;
- a calendar button kept from an earlier date's card downloads nothing after the date changes;
- the settled card's calendar download is for the selected date's pass."""
import functools,http.server,json,threading
from datetime import datetime,timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];fixtures=root/'tests/fixtures/almanac'
iss_fixture=(root/'tests/fixtures/astro/iss-cincinnati-20261104.json').read_text()
def fixture(name):return json.loads((fixtures/name).read_text())['json']
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
A,B='2026-11-08','2026-11-05'  # Sun, Nov 8 (ISS 7:29 PM EST) and Thu, Nov 5 (ISS 5:15 AM EST)
RECORDER="""(()=>{window.__sky=[];window.__feedDone=0;window.__downloads=[];
 const j=Response.prototype.json;Response.prototype.json=function(){const u=this.url;return j.call(this).finally(()=>{if(/iss-cincinnati/.test(u))window.__feedDone++;});};
 const c=URL.createObjectURL;URL.createObjectURL=function(b){window.__downloads.push(b&&b.size);return c.call(URL,b);};
 const rec=()=>{const el=document.getElementById('skyCard');if(!el)return;const h=el.querySelector('h2');
  window.__sky.push({state:el.dataset.state||'',date:el.dataset.date||'',heading:h?h.textContent:'',buttons:el.querySelectorAll('[data-calendar]').length});};
 new MutationObserver(rec).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-state','data-date']});})();"""
held=[];hold=[False]
with sync_playwright() as p:
 try:browser=p.chromium.launch()
 except Exception:browser=p.chromium.launch(executable_path='/opt/pw-browsers/chromium')  # a preinstalled browser of another build
 context=browser.new_context(viewport={'width':1280,'height':1000},accept_downloads=True);page=context.new_page()
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 context.add_init_script(RECORDER)
 page.route('**/assets/climate-station.js*',lambda r:r.fulfill(status=200,content_type='application/javascript',body="window.ClimateStation={setOverride(){},forPoint:async()=>({pointOffice:'ILN',station:{faa:'CVG',name:'CVG airport',office:'ILN',ll:[-84.67,39.04],km:0,since:1871,thr:{sid:'CVGthr',name:'Cincinnati',since:1871}},alternatives:[],missing:[]})};"))
 page.clock.install(time=datetime.fromisoformat(json.loads(iss_fixture)['retrievedAt'].replace('Z','+00:00'))+timedelta(minutes=1))
 def route(r):
  url=r.request.url
  if 'iss-cincinnati.json' in url:
   if hold[0]:held.append(r);return  # released later by the test, in a chosen order
   r.fulfill(status=200,content_type='application/json',body=iss_fixture);return
  if url.startswith('http://127.0.0.1:'):r.continue_();return
  if 'rcc-acis.org/StnData' in url:
   q=r.request.post_data_json
   if q['sid']=='CVG':name='acis-normals-CVG-2026-11.json' if isinstance(q['elems'][0],dict) else 'acis-obs-CVG-recent.json'
   elif any(isinstance(e,dict) and 'duration' in e for e in q['elems']):name='acis-mtd2-CVGthr-11-02.json'
   else:name='acis-records2-CVGthr-11-02.json'
   r.fulfill(status=200,content_type='application/json',body=json.dumps(fixture(name)));return
  if 'aa.usno.navy.mil' in url:
   r.fulfill(status=200,content_type='application/json',body=json.dumps(fixture('usno-moonphases-2026-11-01.json' if 'moon/phases' in url else 'usno-downtown-2026-11-03.json')));return
  r.fulfill(status=404,content_type='application/json',body='{}')
 context.route('**/*',route)
 def release(which):
  r=held.pop(len(held)-1 if which=='newer' else 0);before=page.evaluate('window.__feedDone')
  r.fulfill(status=200,content_type='application/json',body=iss_fixture)
  # the response is fully read and handled once its JSON settles; the card's continuation runs in the same microtask chain
  page.wait_for_function(f'window.__feedDone>{before}')
 def held_count(n):
  for _ in range(500):  # each round trip lets Playwright dispatch pending route callbacks; no fixed delay
   if len(held)>=n:return
   page.evaluate('1')
  raise AssertionError(f'expected {n} held NASA-feed requests, have {len(held)}')
 ready=lambda d:page.wait_for_function(f'document.querySelector("#skyCard").dataset.state==="ready"&&document.querySelector("#skyCard").dataset.date==="{d}"')
 card=lambda:page.evaluate('(()=>{const el=document.querySelector("#skyCard");return {state:el.dataset.state,date:el.dataset.date,busy:el.getAttribute("aria-busy"),text:el.innerText,buttons:el.querySelectorAll("[data-calendar]").length}})()')
 select=lambda d:page.evaluate(f'(()=>{{const i=document.querySelector("#almDate");i.value="{d}";i.dispatchEvent(new Event("change",{{bubbles:true}}));const el=document.querySelector("#skyCard");return {{state:el.dataset.state,date:el.dataset.date,heading:!!el.querySelector("h2"),buttons:el.querySelectorAll("[data-calendar]").length}}}})()')

 # 1. Delayed old-date response: B's request is held, A is selected and completes, then B's response arrives.
 hold[0]=True
 page.goto(f'http://127.0.0.1:{server.server_port}/almanac.html?date={B}')
 held_count(1)
 c=card();assert c['state']=='loading' and c['date']==B and c['busy']=='true' and c['buttons']==0 and 'Skywatch ·' not in c['text'],c
 hold[0]=False
 s=select(A)
 assert s=={'state':'loading','date':A,'heading':False,'buttons':0},f'the date change must clear the card in the same task: {s}'
 ready(A);mark=page.evaluate('window.__sky.length')
 release('older')
 c=card();assert c['state']=='ready' and c['date']==A and 'Sun, Nov 8' in c['text'] and '7:29' in c['text'],c
 after=page.evaluate(f'window.__sky.slice({mark})')
 assert not any(x['date']!=A or 'Nov 5' in x['heading'] for x in after),f'the old date came back after the new one was ready: {after}'

 # 2. Rapid A -> B -> A, both responses held; release the newer first (stale last), then the reverse.
 for order in (['newer','older'],['older','newer']):  # stale (B) released last, then first
  hold[0]=True;n0=len(held);mark=page.evaluate('window.__sky.length')
  assert select(B)['state']=='loading';held_count(n0+1)
  assert select(A)=={'state':'loading','date':A,'heading':False,'buttons':0};held_count(n0+2)
  hold[0]=False
  for k in order:release(k)
  ready(A)
  hist=page.evaluate(f'window.__sky.slice({mark})')
  assert not any(x['state']=='ready' and x['date']==B for x in hist),f'B ({B}) was drawn as ready during A->B->A ({order}): {hist}'
  assert hist[-1]['state']=='ready' and hist[-1]['date']==A and 'Sun, Nov 8' in hist[-1]['heading'],hist[-1]
  c=card();assert '7:29' in c['text'] and c['buttons']>=1,c
 assert not held

 # 3. Calendar downloads: a button kept from the previous date's card downloads nothing once the date changes;
 #    the settled card's download is the selected date's pass.
 page.evaluate('window.__oldCal=document.querySelector("#skyCard [data-calendar]")')
 assert page.evaluate('!!window.__oldCal')
 hold[0]=True;n0=page.evaluate('window.__downloads.length')
 assert select(B)['buttons']==0;held_count(1)
 page.evaluate('window.__oldCal.click()')
 assert page.evaluate('window.__downloads.length')==n0,'a calendar button from the previous date must not download after the date changed'
 hold[0]=False;release('older');ready(B)
 assert '5:15' in card()['text']
 with page.expect_download() as download:
  page.locator('#skyCard [data-calendar]').first.click()
 cal=Path(download.value.path()).read_text()
 assert 'DTSTART:20261105T101500Z' in cal and 'TRIGGER:-PT15M' in cal,cal
 assert not errors,errors
 print('Sky card race: explicit loading/ready states, delayed old response ignored, A->B->A in both release orders, stale calendar button inert, calendar download for the selected date pass')
 browser.close()
server.shutdown()
