'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const D = require('../assets/severe-daily-core');
const base = 'assets/severe-daily/';
const read = file => JSON.parse(fs.readFileSync(base + file));
const index = D.validateIndex(read('index.json'));
for (const spec of [index.grid, ...index.runs]) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(base + spec.file)).digest('hex'), spec.sha256);
}
const count = read('grid.json').coordinates.length;
assert.equal(count, 16413);
for (const run of index.runs) {
  const values = D.validateCase(read(run.file), run, count);
  assert.equal(values.wind.length, count);
  assert.equal(D.freshness(run, Date.parse(run.prepared_at) - 1), 'unavailable');
  assert.equal(D.freshness(run, Date.parse(run.valid_end)), 'expired');
  const changed = structuredClone(read(run.file));
  delete changed.probabilities.hail;
  assert.throws(() => D.validateCase(changed, run, count));
  const invalid = structuredClone(read(run.file));
  invalid.probabilities.wind[0] = null;
  assert.throws(() => D.validateCase(invalid, run, count));
  assert.throws(() => D.validateRun({...run, file: '../index.json'}));
  assert.throws(() => D.validateRun({...run, valid_end: run.valid_start}));
  assert.throws(() => D.validateRun({...run, available_before_target_start: !run.available_before_target_start}));
}
assert.throws(() => D.validateIndex({...index, window_hours: 4}));
assert.throws(() => D.validateIndex({...index, runs: [index.runs[0], index.runs[0]]}));
// Model registry: every published run is registered, and the evidence matches the rule.
const registry = D.validateRegistry(read('models.json'));
for (const run of index.runs) assert(registry.models[run.model_sha256], 'published run model must be registered');
const v07 = Object.values(registry.models).find(m => m.version === 'v0.7');
const run2 = {day: 2, model_sha256: Object.keys(registry.models).find(h => registry.models[h] === v07)};
for (const hazard of ['tornado', 'hail']) {
  const s = D.productSummary(registry, run2, hazard);
  assert.equal(s.skill, 'none');
  assert.match(s.flag, /No demonstrated development skill/);
  assert.match(s.headline, /no better than a constant/);
}
assert.equal(D.productSummary(registry, run2, 'wind').skill, 'positive');
assert.match(D.productSummary(registry, {...run2, day: 1}, 'tornado').reliability, /more than double/);
assert.equal(D.productSummary(registry, {day: 1, model_sha256: '0'.repeat(64)}, 'wind'), null);
const broken = structuredClone(registry);
Object.values(broken.models)[0].products.day1_wind.positive_development_skill = false;
assert.throws(() => D.validateRegistry(broken));
// Display mask: tied to the grid checksum, applied without touching other samples.
const hidden = D.validateMask(read('display-mask.json'), index.grid.sha256, count);
assert(hidden.size > 1000 && hidden.size < count / 5);
assert.throws(() => D.validateMask(read('display-mask.json'), '0'.repeat(64), count), /does not match/);
assert.throws(() => D.validateMask({...read('display-mask.json'), hidden: [count]}, index.grid.sha256, count));
const raw = D.validateCase(read(index.runs[0].file), index.runs[0], count), shownValues = D.applyMask(raw, hidden);
for (const hazard of ['tornado', 'wind', 'hail']) shownValues[hazard].forEach((p, i) => assert.equal(p, hidden.has(i) ? null : raw[hazard][i]));
// Timing labels: a Day 2 issued yesterday that covers today's window must not read as tomorrow.
const day1 = {day: 1, id: 'd1', model_init_time: '2026-11-16T06:00:00+00:00', valid_start: '2026-11-16T12:00:00+00:00', valid_end: '2026-11-17T12:00:00+00:00', prepared_at: '2026-11-16T09:50:00+00:00'};
const day2 = {day: 2, id: 'd2', model_init_time: '2026-11-16T12:00:00+00:00', valid_start: '2026-11-17T12:00:00+00:00', valid_end: '2026-11-18T12:00:00+00:00', prepared_at: '2026-11-16T15:50:00+00:00'};
const newDay1 = {...day1, id: 'n1', model_init_time: '2026-11-17T06:00:00+00:00', valid_start: day2.valid_start, valid_end: day2.valid_end, prepared_at: '2026-11-17T09:50:00+00:00'};
const evening = Date.parse('2026-11-16T22:00:00Z'), nextMorning = Date.parse('2026-11-17T13:00:00Z');
assert.equal(D.runLabel(day1, 'v0.7', evening), 'In effect now · Nov 16–17 12 UTC · Day 1 issued Nov 16 06Z · v0.7');
assert.match(D.runLabel(day2, 'v0.7', evening), /^Next window · Nov 17–18 12 UTC · Day 2 issued Nov 16 12Z/);
assert.equal(D.defaultRun([day1, day2], evening).id, 'd1');
// The Day 1 run failed: yesterday's Day 2 is in effect, says so, and is the default.
assert.match(D.runLabel(day2, 'v0.7', nextMorning), /^In effect now/);
assert.match(D.runLabel(day1, 'v0.7', nextMorning), /^Expired/);
assert.equal(D.defaultRun([day1, day2], nextMorning).id, 'd2');
assert.match(D.issuanceNote(day2, [day1, day2], nextMorning), /forecast the previous day as Day 2; no Day 1 update/);
// When the Day 1 update exists for the same window, it wins and the older run says so.
assert.equal(D.defaultRun([newDay1, day2], nextMorning).id, 'n1');
assert.match(D.issuanceNote(day2, [newDay1, day2], nextMorning), /newer Day 1 run \(issued Nov 17, 2026 06:00 UTC\)/);
assert.equal(D.issuanceNote(day2, [day1, day2], Date.parse('2026-11-18T13:00:00Z')), '');
assert.equal(D.defaultRun([day1, day2], Date.parse('2026-11-18T13:00:00Z')), null);
assert.match(D.lead(day2), /24–48 h after initialization/);
console.log('Daily viewer: checksums, daily targets, missing values, late flags, expiry, model evidence and timing labels passed');
