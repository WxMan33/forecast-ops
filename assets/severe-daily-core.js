/* Current daily research feed validation. Expiry always uses the visitor's clock. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SevereDailyCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const schema = 'hrrr-daily-25mi-v2-future-window';
  const protocol = 'day1-06z-f06-30__day2-12z-f24-48-v1';
  const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  function validateRun(run) {
    const issue = Date.parse(run.model_init_time), start = Date.parse(run.valid_start);
    const end = Date.parse(run.valid_end), prepared = Date.parse(run.prepared_at);
    const day = run.day;
    if (![1, 2].includes(day) || ![issue, start, end, prepared].every(Number.isFinite) ||
        new Date(issue).getUTCHours() !== (day === 1 ? 6 : 12) ||
        new Date(issue).getUTCMinutes() !== 0 || new Date(issue).getUTCSeconds() !== 0 ||
        start - issue !== (day === 1 ? 6 : 24) * 3600000 || end - start !== 86400000 ||
        run.file !== 'day' + day + '.json' || typeof run.id !== 'string' ||
        !sha(run.sha256) || !sha(run.model_sha256) ||
        typeof run.available_before_target_start !== 'boolean' ||
        run.available_before_target_start !== (prepared < start)) {
      throw Error('Invalid daily initialization, publication or valid window');
    }
    return run;
  }
  function validateIndex(index) {
    if (index?.schema_version !== 1 || index.status !== 'current_research' ||
        index.window_hours !== 24 || index.radius_km !== 40.2336 ||
        index.feature_schema !== schema || index.timing_protocol !== protocol ||
        index.operational_forecast_eligible !== false || index.grid?.file !== 'grid.json' ||
        !sha(index.grid.sha256) || !Array.isArray(index.runs) ||
        index.runs.length < 1 || index.runs.length > 2) throw Error('Unsupported daily research feed');
    index.runs.forEach(validateRun);
    if (new Set(index.runs.map(run => run.day)).size !== index.runs.length)
      throw Error('Duplicate daily forecast lead');
    return index;
  }
  function freshness(run, now = Date.now()) {
    if (Date.parse(run.prepared_at) > now) return 'unavailable';
    if (now >= Date.parse(run.valid_end)) return 'expired';
    return now < Date.parse(run.valid_start) ? 'upcoming' : 'valid';
  }
  function validateCase(data, run, count) {
    for (const key of ['id', 'day', 'model_init_time', 'valid_start', 'valid_end',
                       'prepared_at', 'model_sha256', 'available_before_target_start']) {
      if (data?.[key] !== run[key]) throw Error('Daily product identity mismatch');
    }
    const result = {};
    for (const hazard of ['tornado', 'wind', 'hail']) {
      const values = data.probabilities?.[hazard];
      if (!Array.isArray(values) || values.length !== count ||
          values.some(p => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1))
        throw Error('Incomplete daily probability field');
      result[hazard] = values;
    }
    return result;
  }
  return {validateRun, validateIndex, validateCase, freshness};
});
