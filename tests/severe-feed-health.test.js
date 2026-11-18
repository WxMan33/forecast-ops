'use strict';
// Feed health: the reviewer's three reproductions, plus deadlines, staleness and reporting.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const H = require('../tools/severe/feed_health');

const base = 'assets/severe-daily/';
const files = Object.fromEntries(['index.json', 'grid.json', 'display-mask.json', 'models.json', 'day1.json', 'day2.json']
  .map(f => [f, fs.readFileSync(base + f)]));
const index = JSON.parse(files['index.json']);
const run = day => index.runs.find(r => r.day === day);
const latest = [run(1).date, run(2).date].sort().at(-1);
// An hour before the earlier of the two committed windows ends: both runs are then current.
const nowBoth = Math.min(...[1, 2].map(d => Date.parse(run(d).valid_end))) - 3600000;
const sha = b => createHash('sha256').update(b).digest('hex');

// Replace a run file and keep index.json's checksum consistent, as a bad publisher would.
function withPayload(day, change) {
  const out = {...files};
  const payload = JSON.parse(files[`day${day}.json`]);
  change(payload);
  out[`day${day}.json`] = Buffer.from(JSON.stringify(payload));
  const changed = structuredClone(index);
  changed.runs.find(r => r.day === day).sha256 = sha(out[`day${day}.json`]);
  out['index.json'] = Buffer.from(JSON.stringify(changed));
  return out;
}
const reader = set => file => { if (!(file in set)) throw Error(`${file} returned HTTP 404`); return set[file]; };
const errors = result => result.findings.filter(f => f.level === 'error').map(f => f.message);
const served = (set, now = nowBoth, extra = {}) =>
  H.run({served: 'test', servedReader: () => reader(set), attempts: 1, now, ...extra});

async function main() {
  // Baseline: the committed feed is healthy while both runs are in effect or upcoming.
  const good = await served(files);
  assert.deepEqual(errors(good), [], good.report);
  assert.equal(good.days[1].state, 'current');

  // Reviewer 1a: Day 1 payload without hail probabilities (checksum kept consistent).
  const noHail = await served(withPayload(1, p => { delete p.probabilities.hail; }));
  assert.match(errors(noHail).join('\n'), /Day 1 fails the viewer's checks \(served\): Incomplete daily probability field/);
  assert.equal(noHail.days[1].state, 'invalid');
  // Reviewer 1b: payload initialization disagrees with index.json.
  const otherInit = await served(withPayload(1, p => { p.model_init_time = '2026-11-01T06:00:00+00:00'; }));
  assert.match(errors(otherInit).join('\n'), /Day 1 fails the viewer's checks.*identity mismatch/);
  // Checksum mismatch without index update.
  const tampered = await served({...files, 'day2.json': Buffer.from('{}')});
  assert.match(errors(tampered).join('\n'), /Day 2 fails.*checksum differs/);

  // Reviewer 2: invalid or unreachable public responses are errors, not warnings.
  for (const broken of [{...files, 'index.json': Buffer.from('<html>rate limited</html>')},
                        (({'models.json': _, ...rest}) => rest)(files)]) {
    const result = await served(broken);
    assert.equal(result.healthy, false);
    assert.match(errors(result)[0], /served feed is unusable/);
  }
  // The committed copy is checked the same way.
  const local = await H.run({local: base, served: null, now: nowBoth});
  assert.equal(local.healthy, true, local.report);

  // Reviewer 3: a success on another branch must not downgrade a failed main run.
  const now = Date.parse('2026-11-18T12:00:00Z');
  const r = (id, created, conclusion, branch = 'main', status = 'completed') =>
    ({id, created_at: created, conclusion, status, head_branch: branch, event: 'schedule', html_url: `u/${id}`});
  let checked = H.checkRuns([r(1, '2026-11-18T09:30:00Z', 'failure'),
                             r(2, '2026-11-18T10:00:00Z', 'success', 'claude/severe-publish-hardening')], now);
  assert.deepEqual(checked.findings.map(f => f.level), ['error']);
  assert.equal(checked.completed, 1);
  checked = H.checkRuns([r(1, '2026-11-18T09:30:00Z', 'timed_out'), r(2, '2026-11-18T10:30:00Z', 'success')], now);
  assert.deepEqual(checked.findings.map(f => f.level), ['warning']);
  checked = H.checkRuns([r(1, '2026-11-16T09:30:00Z', 'failure'), r(2, '2026-11-18T09:30:00Z', 'success'),
                         r(3, '2026-11-18T10:30:00Z', null, 'main', 'in_progress')], now);
  assert.deepEqual(checked.findings, []);
  assert.equal(checked.inProgress, 1);

  // Deadlines and staleness, relative to the committed runs.
  for (const [day, [h, m]] of [[1, [12, 0]], [2, [19, 15]]]) {
    const next = new Date(Date.parse(run(day).model_init_time) + 86400000).toISOString().slice(0, 10);
    const cutoff = Date.parse(`${next}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
    assert.equal(H.leadStatus(run(day), day, cutoff - 1).state, 'current');
    assert.match(H.leadStatus(run(day), day, cutoff).error, new RegExp(`Day ${day} is stale`));
  }
  const missing = await served({...files, 'index.json': Buffer.from(JSON.stringify({...index, runs: [run(1)]}))});
  assert.match(errors(missing).join('\n'), /Day 2 is missing/);
  assert.match(H.leadStatus({...run(1), model_init_time: '2099-01-01T06:00:00+00:00'}, 1, nowBoth).error, /future/);

  // Report and exit status.
  const failing = await served(withPayload(1, p => { delete p.probabilities.hail; }), nowBoth,
                               {runs: [r(9, new Date(nowBoth - 3600000).toISOString(), 'failure')]});
  assert.equal(failing.healthy, false);
  assert.match(failing.report, /\| Day 1 \| none \| .* \| invalid \|/);
  assert.match(failing.report, /\*\*ERROR\*\* \(runs\): Publishing run 9 on main/);
  console.log('Severe feed health: viewer validation of served and committed files, branch-filtered runs, deadlines');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
