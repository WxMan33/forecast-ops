"""Normal Severe-page checks using synthetic publication times and controlled failures."""
import functools
import hashlib
import http.server
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root)),
)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{server.server_port}"
corrupt = False
errors = []
# Reuse sample arrays while fixing synthetic dates, so future feed updates cannot
# make this clock/late-publication regression test depend on the wall clock.
fixture_index = json.loads((root / "assets/severe-daily/index.json").read_text())
fixture_files = {}
for spec in fixture_index["runs"]:
    day = spec["day"]
    data = json.loads((root / "assets/severe-daily" / spec["file"]).read_text())
    timing = {
        "id": f"synthetic-day{day}", "day": day,
        "model_init_time": f"2026-11-16T{6 if day == 1 else 12:02d}:00:00+00:00",
        "valid_start": f"2026-11-{16 if day == 1 else 17}T12:00:00+00:00",
        "valid_end": f"2026-11-{17 if day == 1 else 18}T12:00:00+00:00",
        "prepared_at": f"2026-11-16T{15 if day == 1 else 16}:00:00+00:00",
        "available_before_target_start": day == 2,
    }
    data.update(timing)
    body = json.dumps(data).encode()
    fixture_files[spec["file"]] = body
    spec.update(timing)
    spec["date"] = "2026-11-16"
    spec["sha256"] = hashlib.sha256(body).hexdigest()
fixture_files["index.json"] = json.dumps(fixture_index).encode()



def route(request):
    if not request.request.url.startswith(origin):
        request.fulfill(status=404, body="")
        return
    if corrupt and urlsplit(request.request.url).path == "/assets/severe-daily/day2.json":
        request.fulfill(content_type="application/json", body="{}")
        return
    path = urlsplit(request.request.url).path
    if path.startswith("/assets/severe-daily/") and path.split("/")[-1] in fixture_files:
        request.fulfill(content_type="application/json", body=fixture_files[path.split("/")[-1]])
        return
    request.continue_()


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    context = browser.new_context(viewport={"width": 1440, "height": 1100})
    context.route("**/*", route)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.clock.install(time=datetime(2026, 11, 16, 23, tzinfo=timezone.utc))
    page.goto(origin + "/severe.html#severe-daily")
    page.wait_for_function("document.querySelector('#sdValue').textContent !== '—'")
    assert page.locator("#sdRun option").count() == 2
    assert "24 hours" in page.locator("#sdInit").inner_text()
    assert "LATE FOR FULL WINDOW" in page.locator("#sdInit").inner_text()
    for hazard in ("wind", "hail", "tornado"):
        page.locator(f"#severe-daily [data-sr-hazard='{hazard}']").click()
        assert page.locator("#sdValue").inner_text() != "—"
    for display in ("dots", "both", "contours"):
        button = page.locator(f"#severe-daily [data-sr-display='{display}']")
        button.click()
        assert button.get_attribute("aria-pressed") == "true"
    page.select_option("#sdBasemap", "dark")
    page.select_option("#sdBasemap", "light")
    day2 = page.locator("#sdRun option").nth(1).get_attribute("value")
    page.select_option("#sdRun", day2)
    page.wait_for_function("document.querySelector('#sdValue').textContent !== '—'")
    assert "LATE FOR FULL WINDOW" not in page.locator("#sdInit").inner_text()
    # A failed refresh must clear the previous values, including cached data.
    corrupt = True
    page.locator("#sdRetry").evaluate("(el) => el.click()")
    page.wait_for_function("document.querySelector('#sdStatus').textContent.includes('checksum')")
    assert page.locator("#sdValue").inner_text() == "—"
    corrupt = False
    page.locator("#sdRetry").click()
    page.wait_for_function("document.querySelector('#sdValue').textContent !== '—'")
    assert page.locator("#sdRun").input_value() == day2
    page.locator("#severe-research summary").first.click()
    page.wait_for_function("document.querySelector('#srValue').textContent !== '—'")
    assert "4 hours" in page.locator("#srInit").inner_text()
    assert "24 hours" in page.locator("#sdInit").inner_text()
    target = root / "tests/out"
    target.mkdir(parents=True, exist_ok=True)
    page.locator("#severe-daily").screenshot(path=str(target / "severe-current-desktop.png"))
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.locator("#severe-daily").screenshot(path=str(target / "severe-current-mobile.png"))
    page.evaluate("Date.now = () => Date.parse('2030-01-01T00:00:00Z')")
    page.select_option("#sdRun", page.locator("#sdRun option").first.get_attribute("value"))
    page.wait_for_function("document.querySelector('#sdWindow').textContent.includes('expired')")
    assert page.locator("#sdValue").inner_text() == "—"
    assert not errors, errors
    (target / "severe-current-browser.json").write_text(json.dumps({
        "days": 2, "hazards": 3, "displays": 3, "checksum_failure_recovery": True,
        "late_flag": True, "expired_values_suppressed": True, "archive_preserved": True,
        "mobile_no_overflow": True, "page_errors": errors,
    }, indent=2) + "\n")
    print("Current Severe panel: days, hazards, displays, corrupt recovery, expiry, archive and mobile passed")
    browser.close()
server.shutdown()
