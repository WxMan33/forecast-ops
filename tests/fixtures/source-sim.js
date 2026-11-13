/* Simulated weather-data network for offline reliability checks. Every value is synthetic.
   A scenario decides, per request, whether a source answers normally, with HTTP 429/500, never (timeout),
   with partial hours, nulls or a shorter horizon. Used by tools/source-failure-check.js. */
'use strict';
const H = 3600e3;
const VENUES = {
  // two venues in the same zone, so switching venues never depends on a time-zone lookup
  cvg: { lat: 39.1005, lon: -84.5017, name: 'Sawyer Point, Cincinnati, OH', base: { t: 50, pop: 20, gust: 18 } },
  cmh: { lat: 39.9612, lon: -82.9988, name: 'Columbus, OH', base: { t: 62, pop: 70, gust: 31 } },
};
const venueOf = (lat, lon) => Object.entries(VENUES).find(([, v]) => Math.abs(v.lat - lat) < .05 && Math.abs(v.lon - lon) < .05)?.[0] || 'cvg';
const DAY0 = Date.parse('2026-11-11T05:00:00Z'); // local midnight, America/New_York (EST)
const local = (ms) => new Date(ms - 5 * H).toISOString().slice(0, 16);

/* one deterministic hourly value per variable, model and hour */
function value(v, model, i, venue) {
  const b = VENUES[venue].base, wobble = ((model.length * 7 + i * 3) % 5) - 2;
  switch (v) {
    case 'temperature_2m': return b.t + wobble + 6 * Math.sin((i % 24 - 9) / 24 * 2 * Math.PI);
    case 'dew_point_2m': return b.t - 10 + wobble;
    case 'apparent_temperature': return b.t - 3 + wobble;
    case 'precipitation_probability': return Math.max(0, Math.min(100, b.pop + wobble * 3));
    case 'precipitation': return b.pop >= 50 && i % 24 >= 12 && i % 24 <= 20 ? .04 : 0;
    case 'snowfall': return 0;
    case 'wind_speed_10m': return b.gust * .55;
    case 'wind_gusts_10m': return b.gust + wobble;
    case 'cloud_cover': return 60;
    case 'cape': return 50;
    case 'lifted_index': return 3;
    case 'convective_inhibition': return 0;
    case 'weather_code': return 3;
    case 'visibility': return 16000;
    case 'lightning_potential': return 0;
    default: return /_\d+hPa$/.test(v) ? 10 : 0;
  }
}
const daily = { temperature_2m_max: 'temperature_2m', temperature_2m_min: 'temperature_2m', precipitation_sum: 'precipitation', snowfall_sum: 'snowfall', precipitation_probability_max: 'precipitation_probability', wind_gusts_10m_max: 'wind_gusts_10m' };

/* rule: {status:429|500, retryAfter, hang:true, hoursAvailable:n, nullFrom:[i0,i1], nullVars:[...]} */
function forecast(u, rule = {}, ensemble = false) {
  const q = u.searchParams, model = q.get('models') || 'best_match', venue = venueOf(+q.get('latitude'), +q.get('longitude'));
  const days = +q.get('forecast_days') || 7, n = days * 24, hourly = (q.get('hourly') || '').split(',').filter(Boolean), dvars = (q.get('daily') || '').split(',').filter(Boolean);
  const avail = Math.min(n, rule.hoursAvailable ?? n), members = ensemble ? (model === 'ncep_rrfs_conus_ensemble' ? 5 : 3) : 0;
  const time = Array.from({ length: n }, (_, i) => local(DAY0 + i * H));
  const series = (v, k) => time.map((_, i) => i >= avail || (rule.nullFrom && i >= rule.nullFrom[0] && i < rule.nullFrom[1] && (!rule.nullVars || rule.nullVars.includes(v))) ? null : +(value(v, model + k, i, venue)).toFixed(3));
  const h = { time }, units = { time: 'iso8601' };
  hourly.forEach((v) => {
    if (ensemble) { h[v] = series(v, 0); for (let m = 1; m <= members; m++) h[`${v}_member${String(m).padStart(2, '0')}`] = series(v, m); }
    else h[v] = series(v, '');
    units[v] = /temperature|dew_point/.test(v) ? '°F' : /wind/.test(v) ? 'mp/h' : /precipitation_probability|cloud/.test(v) ? '%' : /precipitation|snowfall/.test(v) ? 'inch' : v === 'visibility' ? 'm' : '';
  });
  const out = { latitude: VENUES[venue].lat, longitude: VENUES[venue].lon, generationtime_ms: 1, utc_offset_seconds: -18000, timezone: 'America/New_York', timezone_abbreviation: 'EST', elevation: 150, hourly_units: units, hourly: h };
  if (dvars.length) {
    const dt = Array.from({ length: days }, (_, d) => local(DAY0 + d * 24 * H).slice(0, 10));
    out.daily = { time: dt };
    dvars.forEach((v) => { const src = daily[v]; out.daily[v] = dt.map((_, d) => { const xs = h[src] ? h[src].slice(d * 24, d * 24 + 24).filter((x) => x != null) : []; if (xs.length < 24) return null; return /_min$/.test(v) ? Math.min(...xs) : /_sum$/.test(v) ? xs.reduce((a, b) => a + b, 0) : Math.max(...xs); }); });
  }
  return out;
}

function nws(u, venue, now) {
  const iso = (ms) => new Date(ms).toISOString(), upd = iso(now - H), start = DAY0 + 5 * H, b = VENUES[venue].base;
  const p = u.pathname;
  if (p.startsWith('/points/')) return { properties: { gridId: 'ILN', gridX: venue === 'cvg' ? 36 : 82, gridY: venue === 'cvg' ? 37 : 70, timeZone: 'America/New_York',
    forecast: `https://api.weather.gov/gridpoints/ILN/${venue}/forecast`, forecastHourly: `https://api.weather.gov/gridpoints/ILN/${venue}/forecast/hourly`, forecastGridData: `https://api.weather.gov/gridpoints/ILN/${venue}`,
    relativeLocation: { properties: { city: venue === 'cvg' ? 'Cincinnati' : 'Columbus', state: 'OH' } } } };
  if (p.endsWith('/forecast')) return { properties: { updateTime: upd, periods: Array.from({ length: 10 }, (_, k) => ({ name: `Period ${k + 1}`, startTime: iso(start + k * 12 * H), endTime: iso(start + (k + 1) * 12 * H), isDaytime: k % 2 === 0, temperature: b.t, temperatureUnit: 'F', probabilityOfPrecipitation: { value: b.pop }, windSpeed: '10 mph', windDirection: 'SW', shortForecast: 'Partly Cloudy', detailedForecast: 'Synthetic.' })) } };
  if (p.endsWith('/forecast/hourly')) return { properties: { updateTime: upd, periods: Array.from({ length: 156 }, (_, k) => ({ startTime: iso(DAY0 + k * H), endTime: iso(DAY0 + (k + 1) * H), temperature: b.t, temperatureUnit: 'F', probabilityOfPrecipitation: { value: b.pop }, shortForecast: 'Partly Cloudy' })) } };
  const vals = (f) => Array.from({ length: 156 }, (_, k) => ({ validTime: `${iso(DAY0 + k * H)}/PT1H`, value: f(k) }));
  return { properties: { updateTime: upd, validTimes: `${iso(DAY0)}/P7D`, temperature: { uom: 'wmoUnit:degC', values: vals(() => (b.t - 32) * 5 / 9) },
    probabilityOfPrecipitation: { uom: 'wmoUnit:percent', values: vals(() => b.pop) }, windGust: { uom: 'wmoUnit:km_h-1', values: vals(() => b.gust * 1.609) } } };
}

/* scenario: { forecast: {model: rule}, ensemble: {model: rule}, nws: rule, alerts: rule|{features}, delay: {venue: ms} } */
async function answer(url, scenario, now, log) {
  const u = new URL(url), host = u.hostname, model = u.searchParams.get('models') || '';
  const venue = u.searchParams.has('latitude') ? venueOf(+u.searchParams.get('latitude'), +u.searchParams.get('longitude'))
    : (() => { const m = u.pathname.match(/points\/([-\d.]+),([-\d.]+)/) || (u.searchParams.get('point') || '').match(/([-\d.]+),([-\d.]+)/); return m ? venueOf(+m[1], +m[2]) : /\/cmh/.test(u.pathname) ? 'cmh' : 'cvg'; })();
  const pick = host === 'api.open-meteo.com' ? (scenario.forecast || {})[model] || (scenario.forecast || {})['*']
    : host === 'ensemble-api.open-meteo.com' ? (scenario.ensemble || {})[model] || (scenario.ensemble || {})['*']
    : host === 'api.weather.gov' ? (u.pathname.startsWith('/alerts') ? scenario.alerts : scenario.nws) : null;
  const rule = typeof pick === 'function' ? pick(u, venue) : pick || {};
  log.push({ host, path: u.pathname, model, venue, rule: rule.status || (rule.hang ? 'timeout' : 'ok') });
  const wait = (scenario.delay && scenario.delay[venue]) || 0;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  if (rule.hang) return { hang: true };
  if (rule.status) return { status: rule.status, headers: rule.retryAfter != null ? { 'Retry-After': String(rule.retryAfter) } : {}, body: JSON.stringify({ error: true, reason: rule.status === 429 ? 'Minutely API request limit exceeded. Please try again in one minute.' : 'Internal Server Error' }) };
  if (host === 'api.open-meteo.com' && u.pathname.startsWith('/data/')) return { status: 200, body: JSON.stringify({ last_run_initialisation_time: Math.floor((now - 6 * H) / 1000), last_run_availability_time: Math.floor((now - 3 * H) / 1000), update_interval_seconds: 21600 }) };
  if (host === 'api.open-meteo.com') return { status: 200, body: JSON.stringify(forecast(u, rule)) };
  if (host === 'ensemble-api.open-meteo.com') return { status: 200, body: JSON.stringify(forecast(u, rule, true)) };
  if (host === 'api.weather.gov' && u.pathname.startsWith('/alerts')) return { status: 200, body: JSON.stringify({ type: 'FeatureCollection', features: rule.features || [] }) };
  if (host === 'api.weather.gov') return { status: 200, body: JSON.stringify(nws(u, venue, now)) };
  return null;
}
module.exports = { answer, VENUES, DAY0, forecast };
