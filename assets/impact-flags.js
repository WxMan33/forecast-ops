/* Investigation cues, not calibrated probabilities or official advisories. No blend weights change. */
(function (root) {
  'use strict';
  const H = 3600000, finite = x => typeof x === 'number' && Number.isFinite(x);
  const criteria = {
    fog: 'Morning fog screen: 3–9 AM local, temperature/dew-point spread 0–2°F, wind 0–7 mph and hourly precipitation 0–0.01 in. for at least two consecutive hourly samples in each of at least two sources. Near saturation can also mean low cloud; this is not a visibility forecast and does not cover every fog mechanism.',
    frost: 'Frost screen: midnight–9 AM local, temperature ≤36°F, dew-point spread 0–8°F, wind 0–5 mph and cloud cover 0–50% for at least two consecutive hourly samples in each of at least two sources. Exposed surfaces can freeze above a 32°F air temperature. Ground conditions and sheltered valleys are not resolved.',
    freeze: 'Freeze screen: air temperature ≤32°F during midnight–9 AM local for at least two consecutive hourly samples in each of at least two sources. This is an air-temperature heads-up, not a frost diagnosis or an official growing-season advisory.'
  };
  function consecutive(points) {
    return points.filter((p, i) => (i && p.ms - points[i - 1].ms === H) || (points[i + 1] && points[i + 1].ms - p.ms === H));
  }
  function assess(data, day, C, now = Date.now(), gust = null) {
    const by = { fog: [], frost: [], freeze: [] }, coverage = { fog: 0, frost: 0, freeze: 0 };
    const start = Math.floor(now / H) * H;
    const axis = (data.ms || []).map((ms, i) => {
      const local = C.time.toLocal(ms, data.tz);
      return { ms, i, hour: +local.slice(11, 13), day: local.slice(0, 10) };
    }).filter(p => p.day === day && p.ms >= start);
    const at = (h, v, i) => h[v]?.[i];
    for (const [id, model] of Object.entries(data.models || {})) {
      // Hourly ensemble means cannot diagnose a joint event in individual members.
      if (model.kind === 'ens') continue;
      const h = model.h || {}, available = { fog: [], frost: [], freeze: [] }, hits = { fog: [], frost: [], freeze: [] };
      for (const p of axis) {
        if (p.hour >= 9) continue;
        const t = at(h, 'temperature_2m', p.i), td = at(h, 'dew_point_2m', p.i), w = at(h, 'wind_speed_10m', p.i), cloud = at(h, 'cloud_cover', p.i), rain = at(h, 'precipitation', p.i);
        if (finite(t)) { available.freeze.push(p); if (t <= 32) hits.freeze.push(p); }
        if (![t, td, w].every(finite) || w < 0 || td > t) continue;
        if (finite(cloud) && cloud >= 0 && cloud <= 100) {
          available.frost.push(p);
          if (t <= 36 && t - td <= 8 && w <= 5 && cloud <= 50) hits.frost.push(p);
        }
        if (p.hour >= 3 && finite(rain) && rain >= 0) {
          available.fog.push(p);
          if (t - td <= 2 && w <= 7 && rain <= .01) hits.fog.push(p);
        }
      }
      for (const kind of Object.keys(by)) {
        if (consecutive(available[kind]).length) coverage[kind]++;
        const points = consecutive(hits[kind]);
        if (points.length) by[kind].push({ id, times: points.map(p => p.ms) });
      }
    }
    const out = [];
    for (const kind of ['fog', by.freeze.length >= 2 ? 'freeze' : 'frost']) {
      if (by[kind].length >= 2) out.push({ kind, label: { fog: 'AM fog?', frost: 'Frost?', freeze: 'Freeze?' }[kind], sources: by[kind], checked: coverage[kind], criteria: criteria[kind] });
    }
    if (axis.length && finite(gust) && gust >= 20) out.push({ kind: 'wind', label: 'G:' + Math.floor(gust / 10) * 10 + '+', gust, sources: [], criteria: 'Upcoming blended peak hourly gust ' + gust.toFixed(0) + ' mph. The badge groups gusts into 10-mph bands starting at 20 mph; it is not an NWS wind-advisory threshold.' });
    return out;
  }
  function mount({ O, C }) {
    const E = O.esc;
    function badges(day, flags) {
      return flags.length ? `<div class="impact-flags">${flags.map(f => `<button type="button" class="impact-flag impact-${f.kind}" data-impact-day="${E(day)}" aria-expanded="false" aria-controls="impact-${E(day)}" title="${E(f.criteria)}">${f.label}<span class="sr"> Investigate guidance for ${E(day)}</span></button>`).join('')}</div>` : '';
    }
    function details(day, flags, names, tz, columns) {
      if (!flags.length) return '';
      const time = ms => new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      const times = a => { const groups = []; for (const ms of a) { const g = groups.at(-1); if (g && ms - g.at(-1) === H) g.push(ms); else groups.push([ms]); } return groups.map(g => time(g[0]) + (g.length > 1 ? '–' + time(g.at(-1)) : '')).join('; '); };
      return `<tr class="impact-detail" id="impact-${E(day)}" hidden><td colspan="${columns}"><strong>Heads-up · ${E(O.fmtDay(day))}</strong><p class="msg">Investigation cues from upcoming guidance, not probabilities, observations or official advisories. Fog/frost screens use individual deterministic and NWS sources independently of blend sliders; ensemble means are excluded. No flag is not an all-clear. Incomplete coverage can miss a signal; later forecast days are preliminary.</p>${flags.map(f => `<div class="impact-explanation"><b>${f.label}</b><p>${E(f.criteria)}</p>${f.sources.length ? `<p>${f.sources.length} of ${f.checked} sources with at least two consecutive usable samples support the screen. Partial mornings can qualify; these counts do not measure full-window coverage.</p><ul>${f.sources.map(s => `<li>${E(names[s.id] || s.id)}: ${E(times(s.times))}</li>`).join('')}</ul>` : ''}</div>`).join('')}<p class="msg">Morning flags belong to the morning of this date. Sample times are hourly guidance points, not exact onset/end times. Past hours are excluded when guidance is rendered; refresh for an updated assessment.</p></td></tr>`;
    }
    function wire(table) {
      table.querySelectorAll('[data-impact-day]').forEach(b => {
        b.onclick = e => { e.stopPropagation(); const row = table.querySelector('#impact-' + b.dataset.impactDay); row.hidden = !row.hidden; table.querySelectorAll(`[data-impact-day="${b.dataset.impactDay}"]`).forEach(x => x.setAttribute('aria-expanded', String(!row.hidden))); };
        b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };
      });
    }
    return { badges, details, wire };
  }
  const api = { assess, consecutive, mount };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ImpactFlags = api;
})(typeof globalThis === 'object' ? globalThis : this);
