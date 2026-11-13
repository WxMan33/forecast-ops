/* Google provider contract: complete results across pages, without live credentials. */
'use strict';
const assert = require('node:assert/strict');
const CI = require('../assets/calendar-import.js');
const E = require('../assets/event-store.js');
let checks = 0, requests = [], replies = [], signs = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
global.BETA_CALENDAR = { clientId: 'synthetic-client' };
global.google = { accounts: { oauth2: { initTokenClient(options) {
  return { requestAccessToken() { signs++; options.callback({ access_token: 'synthetic-token', expires_in: 3600 }); } };
} } } };
global.fetch = async (url, options) => {
  requests.push({ url: new URL(url), options });
  assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
  assert.ok(replies.length, 'unexpected request');
  const reply = replies.shift();
  return { ok: !reply.error, status: reply.error || 200, json: async () => reply };
};
async function run() {
  const p = CI.googleProvider();
  replies = [{ items: [{ id: 'first' }], nextPageToken: 'page2' }, { nextPageToken: 'page3' }, { items: [{ id: 'last' }] }];
  check((await p.listCalendars()).map(x => x.id), ['first', 'last']);
  check(requests.map(x => x.url.searchParams.get('pageToken')), [null, 'page2', 'page3']);
  check(requests.every(x => x.url.searchParams.get('fields').includes('nextPageToken')), true);
  check(signs, 1);
  requests = [];
  const window = { timeMin: '2026-11-10T00:00:00Z', timeMax: '2027-02-10T00:00:00Z' };
  replies = [{ items: Array.from({ length: 250 }, (_, i) => ({ id: String(i), status: 'confirmed' })), nextPageToken: 'next' },
    { items: [{ id: 'cancelled', status: 'cancelled' }, { id: 'beyond-first-page', status: 'confirmed' }] }];
  const events = await p.listEvents('calendar/a@example.org', window);
  check([events.length, events.at(-1).id], [251, 'beyond-first-page']);
  check(requests.map(x => [x.url.searchParams.get('timeMin'), x.url.searchParams.get('timeMax'), x.url.searchParams.get('singleEvents')]),
    Array(2).fill([window.timeMin, window.timeMax, 'true']));
  check(requests[1].url.searchParams.get('pageToken'), 'next');
  check(requests[0].url.pathname.endsWith('/calendar%2Fa%40example.org/events'), true);
  replies = [{ items: [{ id: 'partial' }], nextPageToken: 'next' }, { error: 503 }];
  await assert.rejects(p.listEvents('c', window), /HTTP 503/); checks++; // never present a partial list as complete
  replies = [{ nextPageToken: 'loop' }, { nextPageToken: 'loop' }];
  await assert.rejects(p.listCalendars(), /repeated a results page/); checks++;

  const g = { id: 'same-event-id', summary: 'First calendar', location: 'Paycor Stadium',
    start: { dateTime: '2026-11-15T20:00:00Z' }, end: { dateTime: '2026-11-15T22:00:00Z' } };
  const a = E.fromCalendar(g, [], 'calendar-a', 'America/New_York');
  const b = E.fromCalendar({ ...g, summary: 'Second calendar' }, [], 'calendar-b', 'America/New_York');
  const first = E.mergeImported([], [a, b]);
  check([first.added, first.updated, first.list.length], [2, 0, 2]);
  check(new Set(first.list.map(x => x.id)).size, 2);
  check(first.list[0].id, a.id); // existing links continue working
  const own = first.list.map(x => x.source.calendarId === 'calendar-b'
    ? { ...x, times: { ...x.times, gates: '2026-11-15T13:00' }, overrides: ['gates'] } : x);
  const moved = { ...b, name: 'Second calendar moved', times: { ...b.times, start: '2026-11-15T16:00', end: '2026-11-15T18:00' },
    source: { ...b.source, start: '2026-11-15T21:00:00Z', end: '2026-11-15T23:00:00Z' } };
  const second = E.mergeImported(own, [moved]);
  check([second.added, second.updated, second.list.length], [0, 1, 2]);
  check([second.list[0].name, second.list[1].name, second.list[1].times.gates], ['First calendar', 'Second calendar moved', '2026-11-15T14:00']);
  check(second.list.map(x => x.id), first.list.map(x => x.id));
  const reversed = E.mergeImported(second.list, [moved, a]);
  check([reversed.added, reversed.updated, reversed.unchanged], [0, 0, 2]);
  check(reversed.list.map(x => x.id), first.list.map(x => x.id));
  console.log(`ok - ${checks} calendar provider and identity checks passed`);
}
run().catch(e => { console.error(e); process.exitCode = 1; });
