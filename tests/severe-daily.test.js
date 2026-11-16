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
console.log('Daily viewer: checksums, daily targets, missing values, late flags and expiry passed');
