import argparse
import asyncio,json,hashlib
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('directory',type=Path)
    root=parser.parse_args().directory.resolve()
    checks=json.loads((root/'checks.json').read_text())
    for name,sha in checks['files'].items():
        assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha
    errors=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,args=['--no-sandbox'])
        page=await browser.new_page(viewport={'width':1280,'height':1000})
        page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto((root/'replay.html').as_uri())
        await page.wait_for_function("document.querySelectorAll('#states path').length > 0")
        assert await page.locator('#case option').count()==12
        totals=[]
        for option in await page.locator('#case option').all():
            date=await option.get_attribute('value')
            await page.select_option('#case',date)
            assert await page.locator('#error').inner_text()==''
            assert 'Valid '+date+' 12:00:00 UTC' in await page.locator('#timing').inner_text()
            totals.append(await page.locator('#observations path').count())
        assert sum(totals)==923
        await page.select_option('#case','2024-05-15')
        await page.get_by_role('button',name='Dots',exact=True).click()
        assert await page.locator('#fills path').count()==0
        assert await page.locator('#dots circle').count()>0
        await page.get_by_role('button',name='Both',exact=True).click()
        assert await page.locator('#fills path').count()>0
        assert await page.locator('#dots circle').count()>0
        await page.locator('#reports').uncheck()
        assert await page.locator('#observations path').count()==0
        await page.locator('#reports').check()
        await page.select_option('#theme','dark')
        await page.locator('#map').click(position={'x':620,'y':230})
        assert '%' in await page.locator('#inspect').inner_text()
        await page.select_option('#theme','light')
        await page.get_by_role('button',name='Contours',exact=True).click()
        await page.screenshot(path=str(root.parent/'wind-replay-desktop.png'),full_page=True)
        await page.set_viewport_size({'width':390,'height':844})
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        await page.screenshot(path=str(root.parent/'wind-replay-mobile.png'),full_page=True)
        assert not errors,errors
        (root/'browser-checks.json').write_text(json.dumps({'cases':12,'report_markers':sum(totals),'display_modes':3,'themes':2,'sample_click':True,'mobile_overflow':False,'page_errors':errors},indent=2)+'\n')
        print(json.dumps({'case_controls_passed':12,'report_markers_verified':sum(totals),'display_modes':3,'light_and_dark':True,'sample_click':True,'mobile_no_overflow':True,'browser_errors':errors}))
        await browser.close()
asyncio.run(main())
