'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {check, leadStatus} = require('../tools/severe/check_daily_feed');

async function main() {
  const read = file => fs.readFile('assets/severe-daily/' + file);
  const indexBytes = await read('index.json');
  const index = JSON.parse(indexBytes);
  const day1 = index.runs.find(run => run.day === 1);
  const day2 = index.runs.find(run => run.day === 2);
  const latest = [day1.date, day2.date].sort().at(-1);
  const malformed = await check(file => file === 'day2.json' ? Buffer.from('{}') : read(file),
    Date.parse(latest + 'T20:00:00Z'));
  assert.match(malformed[1].error, /Day 2 failed feed validation.*checksum/);

  const omitted = Buffer.from(JSON.stringify({...index, runs: [day1]}));
  const missing = await check(file => file === 'index.json' ? omitted : read(file),
    Date.parse(latest + 'T20:00:00Z'));
  assert.match(missing[1].error, /Day 2 is missing/);

  const good = await check(read, Date.parse(latest + 'T20:00:00Z'));
  for (const [i, run] of [day1, day2].entries()) {
    if (run.date === latest) assert.match(good[i].message, /covers/);
    else assert.match(good[i].error, /stale/);
  }

  for (const [run, deadline] of [[day1, '12:00:00'], [day2, '19:15:00']]) {
    const date = new Date(Date.parse(run.model_init_time) + 86400000).toISOString().slice(0, 10);
    const cutoff = Date.parse(date + 'T' + deadline + 'Z');
    assert.match(leadStatus([run], run.day, cutoff - 1).message, /covers/);
    assert.match(leadStatus([run], run.day, cutoff).error, /stale/);
  }
  console.log('Severe feed health: validates served files and distinguishes missing, corrupt and stale leads');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
