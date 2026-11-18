"""Compare sources view: synthetic data only (never private archive data), served through a mocked GitHub API after the
page's normal token load. Matched-case summary, one preliminary note, exclusions, coverage numerator and denominator,
missed editions, target and group filters, stacked rows on phones without horizontal scrolling, both themes."""
import json, threading, http.server, functools, os
from pathlib import Path
from datetime import datetime
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
days = [f'2026-11-{d:02d}' for d in range(1, 11)]
attempts = [{'captureId': f'{d}_midday', 'localDate': d, 'slot': 'midday', 'onTime': ['nws', 'gfs_seamless', 'blend:b1'], 'tv': {'wkrc-7day': 'not-collected' if i == 3 else 'ok'}} for i, d in enumerate(days)]
ids = ['nws', 'gfs_seamless', 'blend:b1', 'wkrc-7day']
rows = []
for ci, a in enumerate(attempts):
    rows += [[0, ci, 0, 1, 20, 50 + ci % 3, 50, 0], [2, ci, 0, 1, 20, 51, 50, 0]]
    if ci != 2: rows.append([1, ci, 0, 1, 20, 48, 50, 0])
    if a['tv']['wkrc-7day'] == 'ok' and ci != 6: rows.append([3, ci, 0, 1, 18, 52, 50, 1])
    rows += [[0, ci, 1, 1, 20, 30, 31, 0], [1, ci, 1, 1, 20, 29, 31, 0], [0, ci, 2, 1, 20, 40, 42, 0], [3, ci, 2, 1, 18, 41, 42, 1]]
first_hour = int(datetime.fromisoformat("2026-11-01T17:00:00+00:00").timestamp() // 3600)
rows += [[0, 0, 3, 0, 4, 51, 50, 0, first_hour], [1, 0, 3, 0, 4, 48, 50, 0, first_hour]]
sc = {'schema': 3, 'version': 'dashboard-v2', 'at': 'synthetic', 'minDates': 30, 'loc': {'lstOffsetMin': -300},
      'targets': [{'id': 'tmax_clim', 'label': 'Daily high (climate day)', 'conv': 'climate-day-LST'}, {'id': 'tmin_clim', 'label': 'Daily low (climate day)', 'conv': 'climate-day-LST'}, {'id': 'tmin_night', 'label': 'Overnight low (night after date)', 'conv': 'nws-night-12h'}, {'id': 'temp_hourly', 'label': 'Hourly temperature', 'conv': 'valid-instant'}],
      'sourceLabels': {'blend:b1': 'Synthetic blend', 'wkrc-7day': 'WKRC 7-day'}, 'tracks': {'nws': 'source', 'gfs_seamless': 'source', 'blend:b1': 'blend', 'wkrc-7day': 'tv'},
      'attempts': attempts, 'ids': ids, 'norms': ['normalize-v4', 'tv:tv-extract-v3'], 'columns': [], 'rows': rows, 'droppedInconsistent': 0}
health = {'expected': 12, 'manual': 0, 'gaps': [{'id': '2026-11-11_midday'}], 'slots': [{'id': a['captureId'], 'status': 'on_time'} for a in attempts] + [{'id': '2026-11-11_midday', 'status': 'missed'}, {'id': '2026-11-06_evening', 'status': 'partial', 'sourcesOnTime': 2, 'sourcesExpected': 4}],
          'partial': [{'id': '2026-11-06_evening', 'sourcesOnTime': 2, 'sourcesExpected': 4, 'recoveredLate': ['gfs_seamless'], 'notCaptured': ['wkrc-7day']}]}
idx = {'at': 'synthetic fixture', 'loc': {'name': 'CVG'}, 'reviewQueue': 0, 'health': health, 'lastRuns': {}, 'captures': [], 'runs': [], 'latestBlendInfo': {},
       'tvLatest': [{'product': 'wlwt-extended-10day', 'station': 'WLWT', 'label': 'WLWT Extended 10 Day Forecast', 'captureId': '2026-11-10_midday', 'reviewStatus': 'auto-accepted', 'days': [{'date': '2026-11-11', 'hi': 55, 'lo': 40, 'pop': 20}], 'evidence': []},
                    {'product': 'wlwt-indepth-story', 'station': 'WLWT', 'label': 'Synthetic story', 'captureId': '2026-11-02_midday', 'reviewStatus': 'needs-review', 'historical': True, 'historicalReason': 'Superseded by the numeric 10-day', 'days': [], 'evidence': []}]}
dash = {'schema': 1, 'version': 'dashboard-v2', 'scorecardFile': 'reports/dashboard/scorecard.json', 'sourceLabels': {}, 'captures': [], 'observed': [], 'historyFiles': {}, 'dailyPairs': [], 'hourlyPairs': [], 'minDates': 30, 'defaultId': 'blend:b1', 'defaultCaptured': True, 'loc': {'lstOffsetMin': -300}}
files = {'reports/index.json': idx, 'reports/scores.json': {'summary': [], 'comparisons': [], 'hourly': [], 'minDates': 30, 'pairsCount': 0, 'pendingCount': 0}, 'reports/review-queue.json': {'items': [{'captureId': '2026-11-02_midday', 'product': 'wlwt-indepth-story', 'historical': True, 'reason': 'story text', 'text': 'Synthetic story text mid-70s', 'days': [], 'evidence': []},
                                                  {'captureId': '2026-11-16_evening', 'product': 'wcpo-9day-graphic', 'lowsDisplay': 'morning-after', 'reason': 'graphic needs review', 'days': [{'date': '2026-11-17', 'hi': 55, 'lo': 35}, {'date': '2026-11-18', 'hi': 62, 'lo': 37}, {'date': '2026-11-19', 'hi': 64, 'lo': None}], 'evidence': []}]},
         'reports/dashboard/index.json': dash, 'reports/dashboard/scorecard.json': sc}
out = root / 'tests/out'; out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    page = browser.new_page(viewport={'width': 1280, 'height': 900}); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    writes = []
    def route(r):
        rel = r.request.url.split('/contents/')[1].split('?')[0]
        if r.request.method != 'GET': writes.append(r.request.post_data_json); r.fulfill(status=403, body='read-only'); return
        r.fulfill(status=200 if rel in files else 404, content_type='application/json', body=json.dumps(files.get(rel, {})))
    page.route('https://api.github.com/**', route)
    page.goto(f'http://127.0.0.1:{server.server_port}/verify.html')
    page.locator('#tok').fill('synthetic-test-token'); page.locator('#load').click()
    # collector health: a partly captured edition has its own tile and names what its on-time capture lacks
    page.locator('.vpartial').wait_for()
    tiles = page.locator('.tiles').inner_text().lower()
    assert 'partly captured\n1' in tiles and 'missed / failed\n1' in tiles, tiles
    prow = page.locator('.vpartial tbody tr').inner_text()
    assert '2026-11-06_evening' in prow and '2 of 4' in prow and 'gfs_seamless' in prow and 'WKRC 7-day' not in prow and 'wkrc-7day' in prow, prow
    assert 'never replace on-time evidence' in page.locator('.vpartial').inner_text()
    assert 'partly captured, 2 of 4' in page.locator('.slot.partial').get_attribute('title')
    # TV: the active numeric WLWT 10-day is the primary display; the discontinued story and its review entry are historical and read-only
    page.get_by_role('button', name='TV products & review').click(); page.locator('#tvItems').wait_for()
    active = page.locator('#tvItems').inner_text()
    assert 'WLWT Extended 10 Day Forecast' in active and 'Synthetic story' not in active, active
    assert 'Review queue (1)' in page.locator('#pane').inner_text() and 'wlwt-indepth-story' not in page.locator('#rq').inner_text()
    # WCPO graphic lows are labelled by the morning they verify: Nov 17 has none pictured, Nov 18 gets Tuesday night's 35
    wrow = lambda d: page.locator('#rq tr', has_text=d).inner_text()
    assert 'morning low (prior night)' in page.locator('#rq').inner_text().lower()
    assert 'not pictured' in wrow('2026-11-17') and '35' not in wrow('2026-11-17'), wrow('2026-11-17')
    assert '35' in wrow('2026-11-18') and 'Tue night' in wrow('2026-11-18') and '37' in wrow('2026-11-19') and 'Wed night' in wrow('2026-11-19'), wrow('2026-11-18')
    # a morning-low correction entered for Nov 18 is stored under the night it belongs to (Nov 17), not shifted twice
    page.on('dialog', lambda d: d.accept())
    page.locator('#cd0').fill('2026-11-18'); page.locator('#cf0').select_option('lo'); page.locator('#cv0').fill('34')
    with page.expect_download():
        page.locator('#rq [data-dec="correct"]').first.click()
    import base64
    rec = json.loads(base64.b64decode(writes[-1]['content']).decode())
    assert rec['date'] == '2026-11-17' and rec['field'] == 'lo' and rec['value'] == 34 and rec['enteredAs'] == {'morningOf': '2026-11-18'}, rec
    h = page.locator('.vhistorical'); assert h.get_attribute('open') is None, 'historical section starts collapsed'
    h.locator('> summary').click(); ht = h.inner_text()
    assert 'Historical: discontinued products (1)' in ht and 'old review entries (1)' in ht and 'never substitute' in ht and 'wlwt-indepth-story' in ht, ht
    assert h.locator('[data-dec]').count() == 0, 'archived story entries cannot be approved or converted into values'
    page.get_by_role('button', name='Compare sources', exact=True).click()
    page.locator('.vcompare').wait_for()
    # default: the sources present in every case; the others are offered with the matched cases they would leave
    d = page.locator('#pane').inner_text()
    assert '10 matched cases' in d and '2 sources' in d and 'GFS (adding it leaves 9 matched cases)' in d and 'WKRC 7-day (adding it leaves 8 matched cases)' in d, d[:900]
    page.locator('.vpick summary').click(); page.locator('#call').click(); page.locator('.vcompare').wait_for()
    text = page.locator('#pane').inner_text()
    assert '7 matched cases' in text and '7 distinct verifying dates' in text and '2026-11-02 to 2026-11-11' in text, text[:600]
    assert page.locator('.vprelim').count() == 1 and 'Preliminary' in page.locator('.vprelim').inner_text()
    cells = ' '.join(page.locator('.vcompare tbody').all_inner_texts())
    assert 'of 30' not in cells and 'preliminary' not in cells.lower(), 'the preliminary label is stated once, not in every cell'
    assert '3 cases without every selected source' in text and 'WKRC 7-day 2' in text, text
    tvrow = page.locator('.vcompare tbody tr', has_text='WKRC 7-day').inner_text()
    assert '8 of 9 attempted' in tvrow and 'not attempted in 1 of 10' in tvrow, tvrow
    assert 'missed or failed 1' in text, 'a missed scheduled edition stays visible'
    assert 'partly captured 0' in text and 'other' not in page.locator('.vsched').inner_text(), 'partial editions are named, never "other" (the evening one is filtered out by edition)'
    page.locator('#cslot').select_option('both'); page.locator('.vsummary').wait_for()
    assert 'partly captured 1' in page.locator('.vsched').inner_text(), page.locator('.vsched').inner_text()
    page.locator('#cslot').select_option('midday'); page.locator('.vpick summary').click(); page.locator('#call').click(); page.locator('.vcompare').wait_for()
    assert page.locator('.vcompare tbody tr').count() == 4
    page.screenshot(path=str(out / 'verify-compare-desktop-dark.png'), full_page=True)
    # targets stay distinct: the climate-day low has no TV product; the overnight low does
    page.locator('#ctarget').select_option('tmin_clim'); page.locator('.vcompare').wait_for()
    assert page.locator('.vcompare tbody tr', has_text='WKRC').count() == 0 and page.locator('.vcompare tbody tr').count() == 2
    page.locator('#ctarget').select_option('tmin_night'); page.locator('.vcompare').wait_for()
    assert page.locator('.vcompare tbody tr', has_text='WKRC').count() == 1 and '10 matched cases' in page.locator('.vsummary').inner_text(), 'TV and models match on the overnight low'
    page.locator('#ctarget').select_option('temp_hourly'); page.locator('.vcompare').wait_for()
    assert '1 matched case' in page.locator('.vsummary').inner_text() and '1 distinct valid hour' in page.locator('.vsummary').inner_text()
    assert page.locator('#clead option:checked').inner_text() == 'Same day'
    # group filter: TV products off
    page.locator('#ctarget').select_option('tmax_clim'); page.locator('.vpick summary').click(); page.locator('#call').click(); page.locator('[data-group="tv"]').uncheck(); page.locator('.vcompare').wait_for()
    assert page.locator('.vcompare tbody tr', has_text='WKRC').count() == 0 and page.locator('[data-src="wkrc-7day"]').count() == 0
    page.locator('[data-group="tv"]').check(); page.locator('.vcompare').wait_for()
    # phone: stacked rows, no horizontal page scroll, labels on each value
    for w in (360, 390):
        page.set_viewport_size({'width': w, 'height': 900})
        assert page.evaluate('Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1'), f'horizontal overflow at {w}'
        assert page.evaluate('getComputedStyle(document.querySelector(".vcompare tbody tr")).display') == 'block', 'rows stack as cards'
        assert page.evaluate('getComputedStyle(document.querySelector(".vcompare tbody td[data-label=\\"MAE °F\\"]"), "::before").content').strip('"') == 'MAE °F'
    page.screenshot(path=str(out / 'verify-compare-phone-dark.png'), full_page=True)
    page.evaluate('document.documentElement.setAttribute("data-theme","light")')
    page.screenshot(path=str(out / 'verify-compare-phone-light.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900}); page.screenshot(path=str(out / 'verify-compare-desktop-light.png'), full_page=True)
    assert not errors, errors
    print('Compare sources: matched cases, one preliminary note, exclusions, coverage numerator/denominator, missed editions, distinct targets, group filter, stacked phone rows, both themes pass')
    browser.close()
server.shutdown()
