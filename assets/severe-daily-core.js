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
  const HAZARD_NAMES = {tornado: 'tornado', wind: 'severe wind', hail: 'severe hail'};
  const pct = v => (v * 100).toFixed(v < .01 ? 1 : 0);
  const range = b => b.upper >= 1 ? pct(b.lower) + '%+' : pct(b.lower) + '–' + pct(b.upper) + '%';
  function validateRegistry(registry) {
    if (registry?.schema_version !== 1 || !registry.models || typeof registry.models !== 'object')
      throw Error('Unsupported daily model registry');
    for (const [hash, model] of Object.entries(registry.models)) {
      if (!sha(hash) || typeof model?.version !== 'string' || !/^v\d+\.\d+$/.test(model.version))
        throw Error('Invalid daily model registry entry');
      for (const day of [1, 2]) for (const hazard of Object.keys(HAZARD_NAMES)) {
        const p = model.products?.['day' + day + '_' + hazard];
        if (!p || !Number.isFinite(p.brier_skill_vs_training_climatology) ||
            typeof p.positive_development_skill !== 'boolean' ||
            p.positive_development_skill !== p.brier_skill_vs_training_climatology > 0 ||
            !Array.isArray(p.reliability) || !Array.isArray(p.reliability_flags) ||
            !Number.isInteger(p.evaluation_dates) || !Number.isInteger(p.dates_with_reports))
          throw Error('Incomplete daily model registry entry');
      }
    }
    return registry;
  }
  // The selected product's own development evidence. Unknown models are refused upstream.
  function productSummary(registry, run, hazard) {
    const model = registry.models[run.model_sha256];
    if (!model) return null;
    const p = model.products['day' + run.day + '_' + hazard];
    const skill = p.brier_skill_vs_training_climatology * 100;
    const name = 'Day ' + run.day + ' ' + HAZARD_NAMES[hazard];
    const signed = (skill > 0 ? '+' : skill < 0 ? '−' : '') + Math.abs(skill).toFixed(1) + '%';
    const over = p.reliability_flags.filter(f => f.direction === 'overforecast').map(range);
    const under = p.reliability_flags.filter(f => f.direction === 'underforecast').map(range);
    return {
      version: model.version, skill: p.positive_development_skill ? 'positive' : 'none',
      flag: p.positive_development_skill ? 'Development Brier skill ' + signed : 'No demonstrated development skill',
      headline: p.positive_development_skill
        ? name + ' (' + model.version + '): Brier skill ' + signed + ' against a constant training-period report rate on development dates.'
        : name + ' (' + model.version + '): Brier skill ' + signed + ', no better than a constant training-period report rate on development dates. Treat these values as experimental only.',
      reliability: [over.length ? 'Where it forecast ' + over.join(', ') + ', reports occurred at less than half the forecast rate.' : '',
                    under.length ? 'Where it forecast ' + under.join(', ') + ', reports occurred at more than double the forecast rate.' : ''].filter(Boolean).join(' '),
      dates: p.evaluation_dates + ' development dates in 2024, ' + p.dates_with_reports + ' with qualifying reports. Exploratory: the same dates were used to choose between model versions.',
      bins: p.reliability.map(b => ({range: range(b), mean: b.mean_probability, observed: b.observed_rate, points: b.known_points, dates: b.dates})),
    };
  }
  const utcDay = t => new Date(t).toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric'});
  const utcFull = t => new Date(t).toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}) +
    ' ' + new Date(t).toISOString().slice(11, 16) + ' UTC';
  const span = run => { const a = utcDay(run.valid_start), b = utcDay(run.valid_end);
    return a.split(' ')[0] === b.split(' ')[0] ? a + '–' + b.split(' ')[1] : a + '–' + b; };
  // Where a run stands against the visitor's clock. "Day 2" alone reads as "tomorrow", but a
  // Day 2 run issued yesterday covers today's window, so labels lead with this relation.
  function relation(run, now = Date.now()) {
    const state = freshness(run, now);
    if (state === 'valid') return 'In effect now';
    if (state === 'upcoming') return Date.parse(run.valid_start) - now <= 86400000 ? 'Next window' : 'Later window';
    return state === 'expired' ? 'Expired' : 'Not yet published';
  }
  const lead = run => 'Day ' + run.day + ' forecast (' + (run.day === 1 ? '6–30' : '24–48') + ' h after initialization)';
  function runLabel(run, version, now = Date.now()) {
    return relation(run, now) + ' · ' + span(run) + ' 12 UTC · Day ' + run.day +
      ' issued ' + utcDay(run.model_init_time) + ' ' + run.model_init_time.slice(11, 13) + 'Z · ' + (version || 'unregistered model');
  }
  // Prefer the window in effect now, then the next one; for the same window, the newest run.
  function defaultRun(runs, now = Date.now()) {
    const rank = run => ({valid: 0, upcoming: 1})[freshness(run, now)];
    return runs.filter(run => rank(run) !== undefined).sort((a, b) => rank(a) - rank(b) ||
      Date.parse(a.valid_start) - Date.parse(b.valid_start) || Date.parse(b.model_init_time) - Date.parse(a.model_init_time))[0] || null;
  }
  function issuanceNote(run, runs, now = Date.now()) {
    const same = runs.filter(other => other !== run && other.valid_start === run.valid_start && freshness(other, now) !== 'unavailable');
    const newer = same.find(other => Date.parse(other.model_init_time) > Date.parse(run.model_init_time));
    const older = same.find(other => Date.parse(other.model_init_time) < Date.parse(run.model_init_time));
    if (newer) return 'A newer Day ' + newer.day + ' run (issued ' + utcFull(newer.model_init_time) + ') covers this same window.';
    if (run.day === 2 && freshness(run, now) === 'valid')
      return 'This window is in effect now. It was forecast the previous day as Day 2; no Day 1 update for it is published.';
    if (run.day === 2 && freshness(run, now) === 'upcoming') return 'This is the next 24-hour window, forecast as Day 2.';
    return older ? 'Replaces the earlier Day ' + older.day + ' run for this window.' : '';
  }
  return {validateRun, validateIndex, validateCase, freshness, validateRegistry, productSummary,
          relation, runLabel, defaultRun, issuanceNote, lead, utcFull};
});
