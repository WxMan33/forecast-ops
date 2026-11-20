#!/usr/bin/env node
/* Offline check of Workspace export and import (Upcoming events → Workspace). Two local servers give two origins,
   standing in for two browsers or two beta addresses. Covers: export (OPE address left out unless asked), import into a
   clean browser on another origin with a preview and counts, Merge as the default over an overlapping workspace,
   preferences only when ticked, Replace everything (save first + confirm), an older (v1) file, a newer (v3) file and a
   damaged file refused with nothing changed, and Bill's one-event TV workflow (import, open, Export hourly image).
   Synthetic records and weather (tests/fixtures/event-winter-data.js). Usage: node tools/event-workspace-check.js [dir] */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'event-workspace')); fs.mkdirSync(out, { recursive: true });
const FIX = fs.readFileSync(path.join(root, 'tests/fixtures/event-winter-data.js'), 'utf8');
const serve = () => http.createServer((req, res) => { const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''); const file = path.resolve(root, rel || 'event-beta.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res); });
let failed = 0; const check = (ok, name) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, DESK = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
const NY = 'America/New_York', J = JSON.stringify;
const dayNY = (d) => new Date(Date.now() + d * 864e5).toLocaleDateString('en-CA', { timeZone: NY });
const VENUE = { id: 'vn_ws_tql', name: 'Synthetic Stadium', city: 'Cincinnati, OH', address: '', lat: 39.1113, lon: -84.5222, tz: NY, aliases: ['Synthetic Stadium, Gate A'], defaults: { setup: 300, gates: 90, teardown: 120, gust: 25 } };
const tom = dayNY(1);
/* Bill's one event: tomorrow evening, inside the synthetic hourly guidance */
const TV = { id: 'ev_ws_tv', name: 'Synthetic TV Match', venueId: VENUE.id, loc: { name: VENUE.name, lat: VENUE.lat, lon: VENUE.lon }, tz: NY,
  times: { setup: `${tom}T12:00`, gates: `${tom}T15:30`, start: `${tom}T17:00`, end: `${tom}T19:00`, teardown: `${tom}T21:00` }, gust: 25, overrides: [], source: { kind: 'manual' }, created: 1, updated: 1 };
const LATER = { ...TV, id: 'ev_ws_later', name: 'Synthetic Spring Fair', times: { setup: '2027-04-10T07:00', gates: '2027-04-10T08:30', start: '2027-04-10T10:00', end: '2027-04-10T16:00', teardown: '2027-04-10T18:00' } };
const MODELS = { gfs_seamless: { on: true, w: 0.5 }, ecmwf_ifs025: { on: true, w: 1.5 } };
const SENDER_PREFS = { ops_blend_preset: J('custom'), ops_blend_models: J(MODELS), ops_thunder_models: J(MODELS), ops_blend_cfg_v: '3', ops_theme: J('dark'), forecast_ops_monitoring_address_v1: 'https://ope.example.test' };

async function browserCtx(browser, device, store = {}) {
  const ctx = await browser.newContext({ ...device, timezoneId: NY, acceptDownloads: true }), errors = [];
  await ctx.addInitScript((store) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('beta_analytics_optout', '1'); for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v); }, store);
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/beta-event.js') return r.fulfill({ contentType: 'application/javascript', body: FIX + '\n' + fs.readFileSync(path.join(root, 'assets/beta-event.js'), 'utf8') }); return r.continue(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p, errors };
}
const upcoming = async (p, base) => { await p.goto(`${base}/event-beta.html#upcoming`); await p.waitForFunction(() => document.querySelector('#upView:not([hidden]) #upWorkspace'), null, { timeout: 20000 }); };
const exportFile = async (p, ops = false) => {
  await p.click('#upWorkspace > summary'); if (ops) await p.check('#upExportOps');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#upExport')]);
  const f = path.join(out, `tmp-${Date.now()}.json`); await dl.saveAs(f); const text = fs.readFileSync(f, 'utf8'); fs.unlinkSync(f);
  return { name: dl.suggestedFilename(), text, note: await p.locator('#upNote').innerText() };
};
const pick = async (p, text, name = 'workspace.json') => { await p.setInputFiles('#upRestoreFile', { name, mimeType: 'application/json', buffer: Buffer.from(text) }); };
const dialog = async (p) => { await p.waitForFunction(() => document.getElementById('editDlg').open, null, { timeout: 10000 }); return p.evaluate(() => document.getElementById('editForm').innerText.replace(/\s+/g, ' ')); };
const importNow = async (p) => { await p.click('#rsGo'); await p.waitForFunction(() => !document.getElementById('editDlg').open, null, { timeout: 10000 }); return p.locator('#upNote').innerText(); };
const state = (p) => p.evaluate(() => { const g = (k) => localStorage.getItem(k); return { events: JSON.parse(g('beta_events_v2') || '[]'), venues: JSON.parse(g('beta_venues_v1') || '[]'),
  preset: g('ops_blend_preset'), models: g('ops_blend_models'), theme: g('ops_theme'), ope: g('forecast_ops_monitoring_address_v1'), raw: g('beta_events_v2') + '|' + g('beta_venues_v1') + '|' + g('ops_blend_preset') + '|' + g('ops_theme') }; });

(async () => {
  const s1 = serve(), s2 = serve(); await Promise.all([s1, s2].map((s) => new Promise((ok) => s.listen(0, '127.0.0.1', ok))));
  const A = `http://127.0.0.1:${s1.address().port}`, Bo = `http://localhost:${s2.address().port}`; // two origins
  const browser = await chromium.launch();
  try {
    for (const [dev, device] of [['phone', PHONE], ['desktop', DESK]]) {
      /* 1. the sender: two events, a venue with a remembered calendar location, forecast preferences, theme, an OPE address */
      const S = await browserCtx(browser, device, { beta_events_v2: J([TV, LATER]), beta_venues_v1: J([VENUE]), ...SENDER_PREFS });
      await upcoming(S.p, A); await S.p.click('#upWorkspace > summary'); await S.p.waitForTimeout(200);
      const menu = await S.p.evaluate(() => { const pop = document.querySelector('.up-wspop'), r = pop.getBoundingClientRect(); return { text: pop.innerText.replace(/\s+/g, ' '), fits: r.left >= 0 && r.right <= innerWidth + 1, ops: document.getElementById('upExportOps').checked }; });
      check(/stored only in this browser/.test(menu.text) && /never contains sign-ins, API keys or cached forecasts/.test(menu.text) && !menu.ops && menu.fits, `${dev}: Workspace menu by Upcoming events explains what travels; OPE address unticked; fits the screen`);
      await S.p.screenshot({ path: path.join(out, `workspace-menu-${dev}.png`) }); await S.p.click('#upWorkspace > summary');
      const X = await exportFile(S.p), W = JSON.parse(X.text);
      check(/^forecast-ops-workspace-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(X.name) && W.version === 2 && W.counts.events === 2 && W.counts.venues === 1 && W.counts.aliases === 1 && J(W.counts.preferences) === J(['forecast', 'display']),
        `${dev} export: ${X.name} · v${W.version} · ${W.counts.events} events, ${W.counts.venues} venue, ${W.counts.aliases} alias, ${W.counts.preferences.join('+')}`);
      check(!/ope\.example|beta_analytics|fo_bid|token/i.test(X.text) && /Workspace exported: 2 events · 1 venue · 1 remembered calendar location · forecast preferences, theme/.test(X.note), `${dev} export: OPE address left out by default; note "${X.note.slice(0, 100)}"`);
      const Xo = await exportFile(S.p, true), Wo = JSON.parse(Xo.text);
      check(Wo.preferences.monitoring && Wo.preferences.monitoring.forecast_ops_monitoring_address_v1 === 'https://ope.example.test', `${dev} export: the OPE address only when "Include the OPE monitoring address" is ticked`);
      check(!S.errors.length, `${dev} sender: no script errors ${S.errors.join('; ')}`); await S.ctx.close();

      /* 2. a clean browser on another address: preview with counts, preferences unticked, nothing changed until Import */
      const C = await browserCtx(browser, device); await upcoming(C.p, Bo);
      const before = await state(C.p); await pick(C.p, Xo.text); const d1 = await dialog(C.p);
      const boxes = await C.p.evaluate(() => ({ merge: document.getElementById('rsModeMerge').checked, prefs: [...document.querySelectorAll('[data-pref]')].map((c) => [c.dataset.pref, c.checked]) }));
      check(/Events: 2 new · 0 already here/.test(d1) && /Venues: 1 new · 0 already here/.test(d1) && boxes.merge && J(boxes.prefs) === J([['forecast', false], ['display', false], ['monitoring', false]]) && (await state(C.p)).raw === before.raw,
        `${dev} clean browser: preview "${(d1.match(/Events:[^]*?Venues:[^·]*/) || [''])[0].slice(0, 80)}" · Merge chosen · preferences ${boxes.prefs.map((x) => x[0] + '=' + x[1]).join(' ')} · nothing written yet`);
      await C.p.screenshot({ path: path.join(out, `workspace-import-clean-${dev}.png`), fullPage: dev === 'phone' });
      const n1 = await importNow(C.p), c1 = await state(C.p);
      check(/Workspace imported: 2 events and 1 venue added/.test(n1) && c1.events.length === 2 && c1.venues[0].aliases.join() === VENUE.aliases.join() && c1.events[0].venueId === VENUE.id && c1.preset === before.preset && c1.models === before.models && c1.theme === before.theme && !c1.ope,
        `${dev} clean browser: events, venue and its calendar location arrive with references intact; no preference applied unasked ("${n1.slice(0, 70)}")`);
      /* Bill's TV workflow: open the imported event, Export hourly image */
      await C.p.click(`text=${TV.name}`).catch(() => C.p.goto(`${Bo}/event-beta.html?ev=${TV.id}`));
      await C.p.waitForFunction(() => document.body.dataset.loaded && /\?ev=/.test(location.search), null, { timeout: 20000 });
      await C.p.waitForFunction(() => !document.getElementById('shareImage').disabled, null, { timeout: 20000 }).catch(() => {});
      const opened = await C.p.evaluate(() => ({ name: document.getElementById('evName').innerText, search: location.search, missing: document.body.dataset.missing }));
      await C.p.click('#shareMenu > summary'); const [png] = await Promise.all([C.p.waitForEvent('download', { timeout: 20000 }), C.p.click('#shareImage')]);
      check(opened.name === TV.name && opened.search.startsWith(`?ev=${TV.id}`) && !opened.missing && /-hourly-(light|dark)-1920x1080-\d{4}-\d{2}-\d{2}-\d{4}\.png$/.test(png.suggestedFilename()),
        `${dev} Bill's TV workflow: imported event opens at ${opened.search} and Export hourly image saves ${png.suggestedFilename()}`);
      check(!C.errors.length, `${dev} clean browser: no script errors ${C.errors.join('; ')}`); await C.ctx.close();

      /* 3. an overlapping workspace: one event the same, one different here, one only here; Merge keeps what's here */
      const mine = { ...LATER, name: 'Synthetic Spring Fair (moved)', times: { ...LATER.times, start: '2027-04-10T11:00' }, updated: 2 }, own = { ...TV, id: 'ev_ws_own', name: 'Synthetic Local Event', venueId: null };
      const O = await browserCtx(browser, device, { beta_events_v2: J([TV, mine, own]), beta_venues_v1: J([VENUE]), ops_theme: J('light'), ops_blend_preset: J('near48') });
      await upcoming(O.p, Bo); const o0 = await state(O.p); await pick(O.p, X.text); const d2 = await dialog(O.p);
      check(/Events: 0 new · 1 already here · 1 different from what's saved here/.test(d2) && /Synthetic Spring Fair \(moved\)|Synthetic Spring Fair/.test(d2) && !(await O.p.isChecked('#rsReplace')), `${dev} overlap: preview names the conflict; "Replace … with the file's version" unticked`);
      await O.p.screenshot({ path: path.join(out, `workspace-import-overlap-${dev}.png`), fullPage: dev === 'phone' });
      const n2 = await importNow(O.p), o1 = await state(O.p);
      check(o1.events.length === 3 && o1.events.find((e) => e.id === LATER.id).name === mine.name && o1.events.some((e) => e.id === own.id) && JSON.parse(o1.theme) === 'light' && o1.preset === o0.preset && o1.models === o0.models && /1 record kept as saved here/.test(n2),
        `${dev} overlap, Merge: no duplicates, the version here kept, the local-only event kept, this browser's theme and weights untouched ("${n2.slice(0, 90)}")`);
      /* opt in: forecast preferences only, and replace the conflict */
      await pick(O.p, X.text, 'again.json'); await dialog(O.p); await O.p.check('#rsReplace'); await O.p.check('#rsPref_forecast');
      const n3 = await importNow(O.p), o2 = await state(O.p);
      check(o2.events.find((e) => e.id === LATER.id).name === LATER.name && JSON.parse(o2.preset) === 'custom' && J(JSON.parse(o2.models)) === J(MODELS) && JSON.parse(o2.theme) === 'light' && /forecast preferences applied/.test(n3) && /1 replaced/.test(n3),
        `${dev} opt-in: the file's forecast preferences applied only when ticked; theme left alone; conflict replaced when chosen ("${n3.slice(0, 100)}")`);

      /* 4. old, newer and damaged files */
      const v1 = J({ kind: 'forecast-ops-event-backup', version: 1, app: 'forecast-ops', exportedAt: '2026-10-01T12:00:00Z', counts: { events: 1, venues: 0, aliases: 0 }, events: [{ ...TV, id: 'ev_ws_v1', name: 'Synthetic Old File Event', venueId: null }], venues: [] });
      await pick(O.p, v1, 'old.json'); const d3 = await dialog(O.p);
      check(/older backup: events and venues only/.test(d3) && /Events: 1 new/.test(d3) && !(await O.p.$('[data-pref]')), `${dev} v1 file: read as an older backup, no preference choices`);
      const n4 = await importNow(O.p); check(/1 event and 0 venues added/.test(n4) && (await state(O.p)).events.some((e) => e.id === 'ev_ws_v1'), `${dev} v1 file: migrates in ("${n4.slice(0, 60)}")`);
      const snap = (await state(O.p)).raw;
      for (const [what, text, re] of [['newer (v3)', J({ ...W, version: 3 }), /newer/i], ['damaged', X.text.slice(0, 300), /valid JSON/], ['bad preference value', J({ ...W, preferences: { forecast: { ops_blend_preset: 42 } } }), /value this page can't use/]]) {
        await pick(O.p, text, `${what}.json`); await O.p.waitForFunction(() => !document.getElementById('upBackupErr').hidden, null, { timeout: 10000 });
        const err = await O.p.locator('#upBackupErr').innerText(), dlg = await O.p.evaluate(() => document.getElementById('editDlg').open);
        check(/can't be imported, so nothing was changed/.test(err) && re.test(err) && !dlg && (await state(O.p)).raw === snap, `${dev} ${what} file refused before anything is written: "${err.replace(/\s+/g, ' ').slice(0, 110)}"`);
      }

      /* 5. Replace everything: needs a saved copy of this browser and a confirmation */
      await pick(O.p, X.text, 'replace.json'); await dialog(O.p); await O.p.check('#rsModeAll');
      const g0 = await O.p.evaluate(() => ({ dis: document.getElementById('rsGo').disabled, txt: document.getElementById('rsAllBox').innerText.replace(/\s+/g, ' ') }));
      await O.p.check('#rsConfirmAll'); const g1 = await O.p.isDisabled('#rsGo');
      const [save] = await Promise.all([O.p.waitForEvent('download', { timeout: 15000 }), O.p.click('#rsSaveFirst')]); const g2 = await O.p.isDisabled('#rsGo');
      const sf = path.join(out, 'tmp-save-first.json'); await save.saveAs(sf); const saved = JSON.parse(fs.readFileSync(sf, 'utf8')); fs.unlinkSync(sf);
      check(g0.dis && g1 && !g2 && /This removes the 4 events and 1 venue saved in this browser/.test(g0.txt) && saved.counts.events === 4, `${dev} replace all: Import stays off until this browser's workspace is saved (${saved.counts.events} events in ${save.suggestedFilename()}) and the box is ticked`);
      await O.p.screenshot({ path: path.join(out, `workspace-replace-all-${dev}.png`), fullPage: dev === 'phone' });
      const n5 = await importNow(O.p), o3 = await state(O.p);
      check(o3.events.map((e) => e.id).sort().join() === [TV.id, LATER.id].sort().join() && o3.venues.length === 1 && /replacing this browser's: 2 events and 1 venue/.test(n5), `${dev} replace all: exactly the file's records remain ("${n5.slice(0, 80)}")`);
      check(!O.errors.length, `${dev} overlap browser: no script errors ${O.errors.join('; ')}`); await O.ctx.close();
    }
  } finally { await browser.close(); s1.close(); s2.close(); }
  console.log(failed ? `${failed} check(s) failed` : 'all workspace checks passed'); process.exit(failed ? 1 : 0);
})();
