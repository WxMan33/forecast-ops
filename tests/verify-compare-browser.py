"""Compare sources view: synthetic data only (never private archive data), served through a mocked GitHub API after the
page's normal token load. Matched-case summary, one preliminary note, exclusions, coverage numerator and denominator,
missed editions, target and group filters, stacked rows on phones without horizontal scrolling, both themes."""
import json, threading, http.server, functools, os
from pathlib import Path
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
sc = {'schema': 2, 'version': 'dashboard-v2', 'at': 'synthetic', 'minDates': 30, 'loc': {'lstOffsetMin': -300},
      'targets': [{'id': 'tmax_clim', 'label': 'Daily high (climate day)', 'conv': 'climate-day-LST'}, {'id': 'tmin_clim', 'label': 'Daily low (climate day)', 'conv': 'climate-day-LST'}, {'id': 'tmin_night', 'label': 'Overnight low (night after date)', 'conv': 'nws-night-12h'}],
      'sourceLabels': {'blend:b1': 'Synthetic blend', 'wkrc-7day': 'WKRC 7-day'}, 'tracks': {'nws': 'source', 'gfs_seamless': 'source', 'blend:b1': 'blend', 'wkrc-7day': 'tv'},
      'attempts': attempts, 'ids': ids, 'norms': ['normalize-v4', 'tv:tv-extract-v3'], 'columns': [], 'rows': rows, 'droppedInconsistent': 0}
health = {'expected': 12, 'manual': 0, 'gaps': [{'id': '2026-11-11_midday'}], 'slots': [{'id': a['captureId'], 'status': 'on_time'} for a in attempts] + [{'id': '2026-11-11_midday', 'status': 'missed'}, {'id': '2026-11-06_evening', 'status': 'partial'}]}
idx = {'at': 'synthetic fixture', 'loc': {'name': 'CVG'}, 'reviewQueue': 0, 'health': health, 'lastRuns': {}, 'captures': [], 'runs': [], 'latestBlendInfo': {}, 'tvLatest': []}
dash = {'schema': 1, 'version': 'dashboard-v2', 'scorecardFile': 'reports/dashboard/scorecard.json', 'sourceLabels': {}, 'captures': [], 'observed': [], 'historyFiles': {}, 'dailyPairs': [], 'hourlyPairs': [], 'minDates': 30, 'defaultId': 'blend:b1', 'defaultCaptured': True, 'loc': {'lstOffsetMin': -300}}
files = {'reports/index.json': idx, 'reports/scores.json': {'summary': [], 'comparisons': [], 'hourly': [], 'minDates': 30, 'pairsCount': 0, 'pendingCount': 0}, 'reports/review-queue.json': {'items': []},
         'reports/dashboard/index.json': dash, 'reports/dashboard/scorecard.json': sc}
out = root / 'tests/out'; out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    page = browser.new_page(viewport={'width': 1280, 'height': 900}); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def route(r):
        rel = r.request.url.split('/contents/')[1].split('?')[0]
        if r.request.method != 'GET': r.fulfill(status=403, body='read-only'); return
        r.fulfill(status=200 if rel in files else 404, content_type='application/json', body=json.dumps(files.get(rel, {})))
    page.route('https://api.github.com/**', route)
    page.goto(f'http://127.0.0.1:{server.server_port}/verify.html')
    page.locator('#tok').fill('synthetic-test-token'); page.locator('#load').click()
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
