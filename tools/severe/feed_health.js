'use strict';
/*
 * Health check for the daily severe research feed, using the viewer's own validators
 * (assets/severe-daily-core.js) on the same files the viewer downloads.
 *
 * Errors (exit 1):
 *   - the served feed cannot be read, is not valid JSON, or fails the viewer's checks:
 *     index schema, grid/run checksums, display mask, registry, a run's payload identity
 *     (id, lead, initialization, window, preparation, model) and all three hazard fields
 *   - a lead is missing, stale after its deadline (Day 1 12:00 UTC, Day 2 19:15 UTC),
 *     expired, or claims a future initialization or preparation
 *   - the same checks fail on the committed copy (--local), so a bad commit is caught even
 *     before the raw CDN serves it
 *   - the newest completed publishing run on main failed, timed out or was cancelled
 * Warnings: an earlier main-branch failure that a later main-branch run recovered; served
 * files that are valid and current but not yet byte-identical to git (CDN lag).
 *
 * Usage: node tools/severe/feed_health.js [--local DIR] [--served URL|none] [--runs FILE]
 *        [--branch main] [--summary FILE] [--json FILE] [--now ISO]
 */
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../../assets/severe-daily-core');

const RAW = 'https://raw.githubusercontent.com/WxMan33/forecast-ops/main/assets/severe-daily/';
const GRID_SAMPLES = 16413;
const DAY_MS = 86400000;
const DEADLINE = {1: [12, 0], 2: [19, 15]};
const BAD = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function expectedInit(day, now) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const due = +today + (DEADLINE[day][0] * 60 + DEADLINE[day][1]) * 60000;
  return +today - (now < due ? DAY_MS : 0) + (day === 1 ? 6 : 12) * 3600000;
}

function leadStatus(run, day, now) {
  const expected = new Date(expectedInit(day, now)).toISOString();
  if (!run) return {state: 'missing', expected, error: `Day ${day} is missing; expected the ${expected} run.`};
  const init = Date.parse(run.model_init_time);
  if (init > now || D.freshness(run, now) === 'unavailable')
    return {state: 'invalid', expected, error: `Day ${day} claims a future initialization or preparation time.`};
  if (init < Date.parse(expected) || D.freshness(run, now) === 'expired')
    return {state: 'stale', expected,
            error: `Day ${day} is stale: it shows ${run.model_init_time}; the ${expected} run was due.`};
  return {state: 'current', expected, published: run.model_init_time,
          message: `Day ${day} ${run.model_init_time} covers ${run.valid_start} to ${run.valid_end} (${D.freshness(run, now)}).`};
}

// `read(file)` returns a Buffer (or a Promise of one). Every finding is labelled with `where`.
async function validateFeed(read, now, where) {
  const findings = [], days = {};
  const error = message => findings.push({level: 'error', check: where, message});
  const json = async (file, expectedSha) => {
    const bytes = await read(file);
    if (expectedSha && sha(bytes) !== expectedSha) throw Error(`${file} checksum differs from index.json`);
    return JSON.parse(bytes);
  };
  let index, registry, count, indexSha = null;
  try {
    const indexBytes = await read('index.json');
    indexSha = sha(indexBytes);
    index = D.validateIndex(JSON.parse(indexBytes));
    const [grid, mask, models] = await Promise.all([
      json(index.grid.file, index.grid.sha256), json('display-mask.json'), json('models.json')]);
    count = grid.coordinates?.length;
    if (count !== GRID_SAMPLES) throw Error(`unexpected grid sample count ${count}`);
    D.validateMask(mask, index.grid.sha256, count);
    registry = D.validateRegistry(models);
  } catch (e) {
    error(`The ${where} feed is unusable: ${e.message}`);
    return {findings, days, indexSha: null};
  }
  for (const day of [1, 2]) {
    const run = index.runs.find(r => r.day === day);
    if (run) {
      try {
        if (!registry.models[run.model_sha256]) throw Error(`unregistered model ${run.model_sha256}`);
        D.validateCase(await json(run.file, run.sha256), run, count);
      } catch (e) {
        error(`Day ${day} fails the viewer's checks (${where}): ${e.message}`);
        days[day] = {state: 'invalid'};
        continue;
      }
    }
    const status = leadStatus(run, day, now);
    if (status.error) error(`${status.error} (${where})`);
    days[day] = {state: status.state, expected: status.expected, published: run?.model_init_time ?? null,
                 message: status.message};
  }
  return {findings, days, indexSha};
}

function checkRuns(runs, now, branch = 'main', lookbackHours = 26) {
  const since = now - lookbackHours * 3600000;
  const completed = runs
    .filter(r => r.head_branch === branch && r.status === 'completed' && Date.parse(r.created_at) >= since)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const findings = [];
  completed.forEach((run, i) => {
    if (!BAD.has(run.conclusion)) return;
    const recovered = completed.slice(0, i).some(r => r.conclusion === 'success');
    findings.push({level: recovered ? 'warning' : 'error', check: 'runs',
      message: `Publishing run ${run.id} on ${branch} (${run.event}, ${run.created_at}) ended ${run.conclusion}` +
               `${recovered ? '; a later run on ' + branch + ' succeeded' : ''}: ${run.html_url || ''}`});
  });
  return {findings, completed: completed.length,
          inProgress: runs.filter(r => r.head_branch === branch && r.status !== 'completed').length};
}

function summary(now, served, runs, findings) {
  const lines = [`## Severe daily feed health, ${new Date(now).toISOString().slice(0, 16)}Z`, '',
    '| Lead | Served run | Required run | State |', '|---|---|---|---|'];
  for (const day of [1, 2]) {
    const d = served?.days?.[day] || {};
    lines.push(`| Day ${day} | ${d.published || 'none'} | ${d.expected || ''} | ${d.state || 'unknown'} |`);
  }
  if (runs) lines.push('', `Publishing runs on main in the last 26 h: ${runs.completed} completed, ${runs.inProgress} running.`);
  lines.push('', findings.length ? '### Findings' : 'No problems found.');
  for (const f of findings) lines.push(`- **${f.level.toUpperCase()}** (${f.check}): ${f.message}`);
  return lines.join('\n') + '\n';
}

function httpReader(base, attempt) {
  return async file => {
    const res = await fetch(`${base}${file}?severe-health=${Date.now()}-${attempt}`, {signal: AbortSignal.timeout(15000)});
    if (!res.ok) throw Error(`${file} returned HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
}

async function run(options) {
  const now = options.now ?? Date.now();
  const findings = [];
  let local = null, served = null, runs = null;
  if (options.local) {
    local = await validateFeed(file => fs.readFileSync(path.join(options.local, file)), now, 'committed');
    findings.push(...local.findings);
  }
  if (options.served) {
    // The raw host can briefly serve an index and a payload from different commits; retry.
    for (let attempt = 1; attempt <= (options.attempts ?? 3); attempt++) {
      served = await validateFeed(options.servedReader?.(attempt) ?? httpReader(options.served, attempt), now, 'served');
      if (!served.findings.length) break;
      if (attempt < (options.attempts ?? 3)) await new Promise(r => setTimeout(r, options.retryMs ?? 5000));
    }
    findings.push(...served.findings);
    if (local?.indexSha && served.indexSha && local.indexSha !== served.indexSha && !served.findings.length)
      findings.push({level: 'warning', check: 'served',
                     message: 'Served index.json is valid and current but differs from git (the raw CDN may still be updating).'});
  }
  if (options.runs) {
    runs = checkRuns(options.runs, now, options.branch ?? 'main');
    findings.push(...runs.findings);
  }
  const report = summary(now, served || local, runs, findings);
  return {healthy: !findings.some(f => f.level === 'error'), findings, report,
          days: (served || local)?.days ?? {}, checkedAt: new Date(now).toISOString()};
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  const result = await run({
    local: args.local,
    served: args.served === 'none' ? null : (args.served || RAW),
    runs: args.runs ? (j => j.workflow_runs ?? j)(JSON.parse(fs.readFileSync(args.runs))) : null,
    branch: args.branch, now: args.now ? Date.parse(args.now) : undefined,
  });
  process.stdout.write(result.report);
  for (const f of result.findings) console.log(`::${f.level} title=Severe feed ${f.check}::${f.message}`);
  if (args.summary) fs.appendFileSync(args.summary, result.report);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({checked_at: result.checkedAt, healthy: result.healthy,
                                                              days: result.days, findings: result.findings}, null, 2) + '\n');
  process.exitCode = result.healthy ? 0 : 1;
}

module.exports = {expectedInit, leadStatus, validateFeed, checkRuns, run};
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(`::error::${e.stack}`); process.exitCode = 1; });
