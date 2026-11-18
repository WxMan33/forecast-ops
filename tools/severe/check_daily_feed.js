'use strict';
const {createHash} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const D = require('../../assets/severe-daily-core');

const base = 'https://raw.githubusercontent.com/WxMan33/forecast-ops/main/assets/severe-daily/';
const dayMs = 86400000;

function leadStatus(runs, day, now) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const due = new Date(today);
  due.setUTCHours(...(day === 1 ? [12, 0] : [19, 15]));
  const cycle = new Date(+today - (now < +due ? dayMs : 0));
  cycle.setUTCHours(day === 1 ? 6 : 12);
  const expected = cycle.toISOString();
  const run = runs.find(run => run.day === day);
  if (!run) return {error: `Day ${day} is missing. Expected at least ${expected}.`};
  const state = D.freshness(run, now);
  if (Date.parse(run.model_init_time) < +cycle || state === 'expired')
    return {error: `Day ${day} is stale. Expected at least ${expected}; found ${run.model_init_time}.`};
  if (state === 'unavailable' || Date.parse(run.model_init_time) > now)
    return {error: `Day ${day} has a future initialization or preparation time.`};
  return {message: `Day ${day} ${run.model_init_time} covers ${run.valid_start} to ${run.valid_end} (${state}).`};
}

async function readPublic(file, query) {
  const res = await fetch(`${base}${file}?${query}`, {signal: AbortSignal.timeout(15000)});
  if (!res.ok) throw Error(`${file} returned HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function check(read, now) {
  const query = `severe-health=${now}`;
  async function json(file, sha) {
    const bytes = await read(file, query);
    if (sha && createHash('sha256').update(bytes).digest('hex') !== sha)
      throw Error(`${file} checksum differs from index.json`);
    return JSON.parse(bytes);
  }
  const index = D.validateIndex(await json('index.json'));
  const [grid, mask, models] = await Promise.all([
    json(index.grid.file, index.grid.sha256), json('display-mask.json'), json('models.json'),
  ]);
  const count = grid.coordinates.length;
  if (count !== 16413) throw Error(`Unexpected severe grid sample count (${count})`);
  D.validateMask(mask, index.grid.sha256, count);
  const registry = D.validateRegistry(models);
  return Promise.all([1, 2].map(async day => {
    const run = index.runs.find(run => run.day === day);
    if (run) {
      try {
        if (!registry.models[run.model_sha256]) throw Error('Unregistered model');
        D.validateCase(await json(run.file, run.sha256), run, count);
      } catch (error) {
        return {error: `Day ${day} failed feed validation. ${error.message}`};
      }
    }
    return leadStatus(index.runs, day, now);
  }));
}

async function main() {
  let results;
  // The raw host can briefly serve an index and payload from different commits.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      results = await check(readPublic, Date.now());
      if (results.every(result => !result.error)) break;
    } catch (error) {
      results = [{error: `Could not validate the public severe feed. ${error.message}`}];
    }
    if (attempt < 3) await delay(5000);
  }
  const {appendFileSync} = require('node:fs');
  for (const result of results) {
    if (result.error) {
      console.error(`::error::${result.error}`);
      process.exitCode = 1;
    } else {
      console.log(result.message);
    }
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${result.error || result.message}\n`);
  }
}

module.exports = {check, leadStatus};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
