const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../assets/severe-research-core.js');
const root = path.join(__dirname, '../assets/severe-research');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name)));
const index = C.validateIndex(read('index.json'));
const grid = read(index.grid.file).coordinates;
assert.equal(index.runs.length, 12);
assert.equal(grid.length, 16413);
function integrity(spec) {
  const bytes = fs.readFileSync(path.join(root, spec.file));
  assert.equal(bytes.length, spec.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), spec.sha256);
}
integrity(index.grid);
for (const run of index.runs) {
  integrity(run);
  const data = read(run.file);
  const values = C.validateCase(data, run, grid.length);
  for (const hazard of C.HAZARDS) {
    assert(values[hazard].every(p => p === null || C.available(p)));
  }
  assert.throws(() => C.validateCase({...data, id: 'wrong-case'}, run, grid.length));
  assert.throws(() => C.validateCase({...data, valid_end: run.valid_start}, run, grid.length));
}
assert.throws(() => C.validateIndex({...index, live_feed: true}));
assert.throws(() => C.validateIndex({...index, radius_km: 1.609344}));
assert.throws(() => C.validateIndex({...index, runs: [{...index.runs[0], file: '../index.json'}]}));
const run = index.runs[4], data = read(run.file);
assert.equal(C.validateCase({...data, probabilities: {}}, run, grid.length).wind[0], null);
assert.throws(() => C.validateCase({...data, probabilities: {wind: [2]}}, run, grid.length));
assert.equal(C.percent(null), 'Unavailable');
assert.equal(C.percent(NaN), 'Unavailable');
assert.equal(C.percent(0), '0.0%');
assert.equal(C.percent(.0001), '<0.1%');
assert.equal(C.percent(.545), '54.5%');
assert.equal(C.peak([null, 0, .5, .1]), 2);
assert.equal(C.peak([null, null]), null);
assert.equal(C.nearest(grid, -120, 40), null);
assert.equal(C.nearest(grid, -84, 80), null);
assert.equal(C.nearest(grid, NaN, 39), null);
assert.equal(C.nearest([[-84,39]], -85, 39), null);
const cvg = C.nearest(grid, -84.6678, 39.0488);
assert(cvg && cvg.km < 12);
assert.deepEqual(grid[cvg.index], [-84.750531,39.053589]);
assert.equal(C.percent(data.probabilities.wind[C.peak(data.probabilities.wind)]), '54.5%');
for (const point of C.ring(-84.75,39.05).geometry.coordinates)
  assert(Math.abs(C.distance([-84.75,39.05], point)-40.2336) < 1e-8);
console.log('Severe research: archive integrity, target semantics, missing data and geographic checks passed');
