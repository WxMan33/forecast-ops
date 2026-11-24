#!/usr/bin/env node
/* Offline check of the Event Manager radar map: time slider, "Event | Full run" switch, jump chips, coverage note and
   guidance disclaimer. Real page, real map viewer (maps.html embed) and real map engine; the weather is the synthetic
   winter sample (tests/fixtures/event-winter-data.js: setup 1 PM tomorrow, teardown 11:30 PM) and the HRRR runs are the
   captured Tri-State fixture (tests/fixtures/maps/2026110500) re-timed and repeated to the run lengths each case needs.
   Cases: a run that ends mid-event (6 PM), one that covers the whole event, and one that ends before setup.
   Usage: node tools/event-map-check.js [screenshot-dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-map')); fs.mkdirSync(out, { recursive: true });
const FIX = fs.readFileSync(path.join(root, 'tests/fixtures/event-winter-data.js'), 'utf8');
/* the winter sample stubs the map out of its design sample; this check puts the real map panel back */
const PAGE_JS = () => 'window.__realMapPanel = BetaUI.mapPanel;\n' + FIX + '\nBetaUI.mapPanel = window.__realMapPanel;\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8');
const MAPFIX = path.join(root, 'tests/fixtures/maps/2026110500'), BASE_MAN = JSON.parse(fs.readFileSync(path.join(MAPFIX, 'manifest.json'), 'utf8'));
const H = 3600e3, NY = 'America/New_York';
const server = http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.pbf': 'application/x-protobuf' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res); });
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

/* NY wall clock → UTC ms (the fixture's own "tomorrow") */
const nyLocal = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: NY }).replace(' ', 'T').slice(0, 16);
const fromNY = (s) => { let g = Date.parse(s + ':00Z'); for (let i = 0; i < 3; i++) { const d = Date.parse(nyLocal(g) + ':00Z') - Date.parse(s + ':00Z'); g -= d; } return g; };
const tomorrow = nyLocal(fromNY(nyLocal(Date.now()).slice(0, 10) + 'T00:00') + 30 * H).slice(0, 10);
const at = (hhmm, day = tomorrow) => fromNY(`${day}T${hhmm}`);
const nextDay = nyLocal(at('12:00') + 24 * H).slice(0, 10);
const SETUP = at('13:00'), GATES = at('17:00'), START = at('19:30'), END = at('21:30'), TEAR = at('23:30'), WIN0 = SETUP - 2 * H;

/* one synthetic HRRR run: the fixture's four hours repeated to n hours, valid from cycle */
const FIELD_CACHE = new Map();
function fieldBytes(file, n) { const key = file + n; if (FIELD_CACHE.has(key)) return FIELD_CACHE.get(key);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(MAPFIX, file))), per = raw.length / BASE_MAN.hours.length, outB = Buffer.alloc(per * n);
  for (let h = 0; h < n; h++) raw.copy(outB, h * per, (h % BASE_MAN.hours.length) * per, (h % BASE_MAN.hours.length + 1) * per);
  const gz = zlib.gzipSync(outB); FIELD_CACHE.set(key, gz); return gz; }
function manifest(cycle, n) { const m = JSON.parse(JSON.stringify(BASE_MAN)), hours = Array.from({ length: n }, (_, i) => i);
  m.cycle = new Date(cycle).toISOString().replace('.000Z', 'Z'); m.hours = hours; m.valid = hours.map((h) => new Date(cycle + h * H).toISOString().replace('.000Z', 'Z'));
  for (const f of Object.values(m.fields)) { if (f.intervals) { const iv = f.intervals, b = iv.filter(Boolean).pop(); f.intervals = hours.map((h) => (!iv[0] && h === 0 ? null : { ...b, startStep: b.startStep === b.endStep ? h : b.startStep === 0 ? 0 : h - 1, endStep: h })); } f.missingHours = []; }
  delete m.sources; return m; }
let RUNS = []; // [{ id, cycle, n }]
const runCycle = Math.floor(Date.now() / H) * H - 2 * H;
const runTo = (endMs) => ({ id: 'r' + new Date(runCycle).toISOString().slice(0, 13).replace(/\D/g, ''), cycle: runCycle, n: Math.round((endMs - runCycle) / H) + 1 });
async function routeMaps(r) {
  const u = new URL(r.request().url());
  if (u.hostname !== 'wxman33.github.io' || !u.pathname.startsWith('/forecast-ops-maps/')) return false;
  const rel = u.pathname.replace('/forecast-ops-maps/', '');
  if (rel === 'data/index.json') { await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generatedAt: new Date().toISOString(), runs: RUNS.map((x) => ({ id: x.id, cycle: new Date(x.cycle).toISOString(), path: `qa/${x.id}`, hoursExpected: x.n - 1, role: 'extended' })) }) }); return true; }
  const m = rel.match(/^qa\/([^/]+)\/(.+)$/), run = m && RUNS.find((x) => x.id === m[1]);
  if (!run) { await r.fulfill({ status: 404, body: '' }); return true; }
  if (m[2] === 'manifest.json') { await r.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest(run.cycle, run.n)) }); return true; }
  if (m[2] === 'latlon.bin.gz') { await r.fulfill({ contentType: 'application/octet-stream', body: fs.readFileSync(path.join(MAPFIX, 'latlon.bin.gz')) }); return true; }
  if (fs.existsSync(path.join(MAPFIX, m[2]))) { await r.fulfill({ contentType: 'application/octet-stream', body: fieldBytes(m[2], run.n) }); return true; }
  await r.fulfill({ status: 404, body: '' }); return true;
}

async function open(browser, base, { device = DESK, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ ...device, timezoneId: NY }), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript((t) => { localStorage.setItem('ops_theme', JSON.stringify(t)); localStorage.setItem('beta_analytics_optout', '1'); }, theme);
  await ctx.route('**/*', async (r) => { const u = new URL(r.request().url());
    if (await routeMaps(r)) return;
    if (u.origin !== base) return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: PAGE_JS() });
    return r.continue(); });
  await p.goto(`${base}/event-beta.html`);
  await p.waitForFunction(() => document.body.dataset.loaded, null, { timeout: 30000 });
  await p.locator('#map').scrollIntoViewIfNeeded();
  const ready = await p.waitForFunction(() => { const m = document.querySelector('#map'); return m && m.dataset.ready === 'true' && m.dataset.mapValid && document.getElementById('mpSlider') && m.dataset.cover; }, null, { timeout: 60000 }).then(() => true, () => false);
  if (!ready) throw new Error('map did not become ready: ' + errors.join('; '));
  await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const state = (p) => p.evaluate(() => { const m = document.getElementById('map'), sl = document.getElementById('mpSlider'), cov = document.getElementById('mpCover'), sel = document.querySelector('#evCharts [data-hour][aria-pressed="true"]');
  return { selected: +document.body.dataset.selected, map: +m.dataset.mapValid, range: m.dataset.range, mode: m.dataset.mode, slider: m.dataset.slider, cover: m.dataset.cover, chart: sel ? +sel.dataset.hour : null,
    min: +sl.min, max: +sl.max, value: +sl.value, disabled: sl.disabled, valuetext: sl.getAttribute('aria-valuetext'), note: cov.hidden ? null : cov.innerText.replace(/\s+/g, ' ').trim(),
    chips: [...document.querySelectorAll('#mpChips .bx-chip')].map((c) => ({ text: c.innerText.replace(/\s+/g, ' ').trim(), disabled: c.disabled, jump: c.dataset.jump ? +c.dataset.jump : null })),
    disc: (document.getElementById('mpDisc') || {}).innerText || '', vt: document.getElementById('mpVt').innerText.replace(/\s+/g, ' ') }; });
const span = (x) => x.slider ? x.slider.split('-').map(Number) : [];
const iso = (ms) => (ms ? nyLocal(ms).replace('T', ' ') : '—');
/* screenshots of the map section: sticky page bars are unpinned while capturing so they do not cover it */
const shot = async (p, name) => { await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { const ps = getComputedStyle(e).position; if (ps === 'sticky' || ps === 'fixed') e.style.position = 'static'; }));
  await p.locator('#map').scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await p.locator('#secMap').screenshot({ path: path.join(out, name) }); await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { if (e.style.position === 'static') e.style.position = ''; })); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  console.log(`event tomorrow ${tomorrow}: setup ${iso(SETUP)}, teardown ${iso(TEAR)}; Event window from ${iso(WIN0)}`);

  /* ---------- 1. a run that ends mid-event (6 PM) ---------- */
  const R1 = runTo(at('18:00')); RUNS = [R1];
  {
    const { ctx, p, errors } = await open(browser, base, { device: DESK, theme: 'light' }); let x = await state(p);
    check(x.mode === 'event', `mid-event run: opens in Event mode (${x.mode})`);
    check(x.selected >= WIN0 && x.selected <= at('18:00') && x.map === x.selected, `mid-event run: the map opens on the event, not the run's first hour (selected ${iso(x.selected)} · map ${iso(x.map)} · run starts ${iso(R1.cycle)})`);
    check(span(x)[0] === WIN0 && span(x)[1] === at('18:00'), `Event window = 2 h before setup → end of the run (clipped): ${iso(span(x)[0])} – ${iso(span(x)[1])}`);
    console.log('   coverage note: ' + x.note);
    check(/^This is as far as the HRRR model currently reaches: \w{3} 6 PM E[SD]T\. The rest of your event \(\w{3} 6 PM – 11:30 PM\) is beyond this model run\. Newer runs reach further; check back later\./.test(x.note || ''), 'coverage note: blunt, names where the model stops and the rest of the event');
    check(x.cover === 'part', `coverage state is "part" (${x.cover})`);
    const chips = x.chips.map((c) => c.text).join(' | '); console.log('   chips: ' + chips);
    check(x.chips.length === 4 && /^Setup 1 PM$/.test(x.chips[0].text) && !x.chips[0].disabled && /^Gates 5 PM$/.test(x.chips[1].text) && !x.chips[1].disabled
      && /^Event 7:30 PM beyond model$/.test(x.chips[2].text) && x.chips[2].disabled && /^Teardown 9:30 PM beyond model$/.test(x.chips[3].text) && x.chips[3].disabled, 'one chip per part; parts past the run are disabled and say "beyond model"');
    check(/^This is computer model guidance, not a forecast or a guarantee\. Models can be wrong on timing, placement and strength\. Use it alongside NWS forecasts and warnings and your own weather plan\.$/.test(x.disc.trim()), 'guidance disclaimer is shown in plain words');
    const disc = await p.evaluate(() => { const d = document.getElementById('mpDisc').getBoundingClientRect(), f = document.querySelector('.bx-mapframe').getBoundingClientRect(), cs = getComputedStyle(document.getElementById('mpDisc')); return { below: d.top >= f.bottom - 1 && d.top - f.bottom < 4, visible: d.height > 10 && cs.visibility === 'visible' && cs.display !== 'none' }; });
    check(disc.below && disc.visible, 'disclaimer sits right under the map, always visible');
    check(/^\w{3} \d{1,2}(:\d\d)? [AP]M E[SD]T/.test(x.vt) && /model run/.test(x.vt) && !/\bF\d\d\b/.test(x.vt), `time label leads with the local time and says "model run", no forecast-hour code (${x.vt})`);
    check(/^\w{3} \d{1,2}(:\d\d)? [AP]M E[SD]T/.test(x.valuetext || ''), `slider aria-valuetext is the local time (${x.valuetext})`);
    const role = await p.evaluate(() => { const s = document.getElementById('mpSlider'); return { type: s.type, label: document.querySelector('label[for="mpSlider"]').textContent, h: s.getBoundingClientRect().height }; });
    check(role.type === 'range' && role.label === 'Map time' && role.h >= 44, `slider is a labelled range input with a ≥44 px hit area (${role.h} px)`);
    /* keyboard: Home, ArrowRight, End move the selected time; the map and the hourly charts follow */
    await p.focus('#mpSlider'); await p.keyboard.press('Home'); await p.waitForTimeout(500); x = await state(p);
    check(x.selected === WIN0 && x.map === WIN0, `slider Home → window start, map follows (selected ${iso(x.selected)} · map ${iso(x.map)})`);
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500); x = await state(p);
    check(x.selected === WIN0 + 2 * H && x.map === x.selected && x.chart === x.selected, `slider arrow keys step the shared time; map and hourly charts follow (selected ${iso(x.selected)} · map ${iso(x.map)} · chart ${iso(x.chart)})`);
    const ring = await p.evaluate(() => { const s = document.getElementById('mpSlider'); return s.matches(':focus-visible') ? getComputedStyle(s).outlineStyle : 'no focus-visible'; });
    check(ring === 'solid', `slider has a visible focus ring (${ring})`);
    await p.keyboard.press('End'); await p.waitForTimeout(500); x = await state(p);
    check(x.selected === at('18:00') && x.map === x.selected, `slider End → last hour the run reaches (${iso(x.selected)})`);
    /* drag / tap: a pointer click on the track jumps straight there */
    const box = await p.locator('#mpSlider').boundingBox(); await p.mouse.click(box.x + 12 + (box.width - 24) * 0.5, box.y + box.height / 2); await p.waitForTimeout(500); x = await state(p);
    check(x.selected > WIN0 && x.selected < at('18:00') && x.map === x.selected && x.value === (await p.evaluate(() => +document.getElementById('mpSlider').value)), `tapping the middle of the slider jumps there (${iso(x.selected)})`);
    /* chips */
    await p.click('#mpChips [data-part="gates"]'); await p.waitForTimeout(500); x = await state(p);
    check(x.selected === GATES && x.map === GATES && x.chart === GATES, `Gates chip jumps to 5 PM (selected ${iso(x.selected)} · map ${iso(x.map)} · chart ${iso(x.chart)})`);
    await p.click('#mpChips [data-part="setup"]'); await p.waitForTimeout(500); x = await state(p);
    check(x.selected === SETUP && x.map === SETUP, `Setup chip jumps to 1 PM (${iso(x.selected)})`);
    /* play loops inside the window */
    const seen = []; await p.click('#mpPlay');
    for (let i = 0; i < 30; i++) { await p.waitForTimeout(250); seen.push(+(await p.evaluate(() => document.body.dataset.selected))); }
    await p.click('#mpPlay'); await p.waitForTimeout(400);
    const inWin = seen.every((t) => t >= WIN0 && t <= at('18:00')), wrapped = seen.some((t, i) => i && t < seen[i - 1]);
    check(inWin && wrapped && new Set(seen).size >= 6, `Play loops inside the Event window (${[...new Set(seen)].map((t) => nyLocal(t).slice(11)).join(' ')})`);
    x = await state(p); check(x.map === x.selected, 'after pause the map and the selected time agree');
    await shot(p, 'event-map-desktop-light-event.png');
    /* Full run */
    await p.click('[data-mode="full"]'); await p.waitForTimeout(500); x = await state(p);
    check(x.mode === 'full' && span(x)[0] === R1.cycle && span(x)[1] === at('18:00'), `Full run: the slider spans every hour of the run (${iso(span(x)[0])} – ${iso(span(x)[1])})`);
    check(!!x.note, 'Full run still shows the coverage note');
    await p.focus('#mpSlider'); await p.keyboard.press('Home'); await p.waitForTimeout(500); x = await state(p);
    check(x.selected === R1.cycle && x.map === R1.cycle, `Full run: slider reaches the run's first hour (${iso(x.selected)})`);
    await shot(p, 'event-map-desktop-light-full.png');
    await p.click('[data-mode="event"]'); await p.waitForTimeout(500); x = await state(p);
    check(x.mode === 'event' && x.selected === Math.floor(SETUP / H) * H && span(x)[0] === WIN0, `back to Event: a time outside the window moves to the first part's start (${iso(x.selected)})`);
    check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
    await ctx.close();
  }
  /* screenshots and layout: desktop dark, phone light and dark (no sideways scroll) */
  for (const [dev, device, theme] of [['desktop', DESK, 'dark'], ['phone', PHONE, 'light'], ['phone', PHONE, 'dark']]) {
    const { ctx, p, errors } = await open(browser, base, { device, theme });
    const lay = await p.evaluate(() => { const pan = document.querySelector('#map .bx-mappanel').getBoundingClientRect(), inside = [...document.querySelectorAll('#map .bx-chip, #map .bx-seg, #mpSlider, #mpCover, #mpDisc')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= pan.left - 1 && r.right <= pan.right + 1; });
      return { hscroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1, inside, chipH: Math.min(...[...document.querySelectorAll('#map .bx-chip')].map((c) => c.getBoundingClientRect().height)), slH: document.getElementById('mpSlider').getBoundingClientRect().height }; });
    check(!lay.hscroll && lay.inside, `${dev} ${theme}: no sideways scroll; switch, chips, slider, note and disclaimer stay inside the map panel`);
    if (dev === 'phone') check(lay.slH >= 44 && lay.chipH >= 44, `phone ${theme}: slider and chips have ≥44 px touch targets (slider ${lay.slH}, chips ${lay.chipH})`);
    if (dev === 'phone') { await p.locator('#mpSlider').scrollIntoViewIfNeeded(); const b = await p.locator('#mpSlider').boundingBox(); await p.touchscreen.tap(b.x + b.width - 14, b.y + b.height / 2); await p.waitForTimeout(500); const x = await state(p);
      check(x.selected === at('18:00') && x.map === x.selected, `phone ${theme}: tapping the end of the slider jumps to the last hour (${iso(x.selected)})`); }
    await shot(p, `event-map-${dev}-${theme}-event.png`);
    if (dev === 'phone') { await p.click('[data-mode="full"]'); await p.waitForTimeout(500); await shot(p, `event-map-${dev}-${theme}-full.png`);
      const h = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1); check(!h, `phone ${theme}: Full run, no sideways scroll`); }
    if (dev === 'desktop') { await p.click('[data-mode="full"]'); await p.waitForTimeout(500); await shot(p, `event-map-${dev}-${theme}-full.png`); }
    check(!errors.length, `${dev} ${theme}: no page errors` + (errors.length ? ': ' + errors.join('; ') : ''));
    await ctx.close();
  }

  /* ---------- 2. a run that covers the whole event ---------- */
  RUNS = [runTo(at('06:00', nextDay))];
  {
    const { ctx, p, errors } = await open(browser, base, { device: DESK }); const x = await state(p);
    check(x.cover === 'all' && x.note === null, `whole event covered: no coverage note (${x.cover})`);
    check(span(x)[0] === WIN0 && span(x)[1] === at('23:00'), `Event window = 11 AM → the last hour of teardown (${iso(span(x)[0])} – ${iso(span(x)[1])})`);
    check(x.chips.length === 4 && x.chips.every((c) => !c.disabled), 'every part has a working chip');
    await p.click('#mpChips [data-part="teardown"]'); await p.waitForTimeout(500); const y = await state(p);
    check(y.selected === at('21:00') && y.map === y.selected, `Teardown chip jumps to 9:30 PM's hour (${iso(y.selected)})`);
    check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
    await shot(p, 'event-map-desktop-light-covered.png'); await ctx.close();
  }

  /* ---------- 3. a run that ends before setup ---------- */
  RUNS = [runTo(at('09:00'))];
  {
    const { ctx, p, errors } = await open(browser, base, { device: DESK }); const x = await state(p);
    console.log('   coverage note: ' + x.note);
    check(x.cover === 'none' && /^This is as far as the HRRR model currently reaches: \w{3} 9 AM E[SD]T\. Your event \(\w{3} 1 PM – 11:30 PM\) is beyond this model run\. Newer runs reach further; check back later\./.test(x.note || ''), 'run ends before setup: the note says the whole event is beyond this model run');
    check(x.chips.every((c) => c.disabled && /beyond model/.test(c.text)), 'every chip is disabled, "beyond model"');
    check(x.disabled, 'Event mode slider is disabled (no hours of the event in this run)');
    const fr = await p.evaluate(() => { const f = document.getElementById('mpFlag'); return f.hidden ? '' : f.innerText.replace(/\s+/g, ' '); });
    check(/Last HRRR hour/.test(fr) && x.range === 'beyond', `the map never passes another hour off as the selected time (flag "${fr}")`);
    await p.click('[data-mode="full"]'); await p.waitForTimeout(400); const y = await state(p);
    check(!y.disabled && span(y)[1] === at('09:00'), 'Full run still lets you scrub the run');
    check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall event map checks passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
