/* Investigation cues, not calibrated probabilities or official advisories. No blend weights change. */
(function (root) {
  'use strict';
  const H = 3600000, finite = x => typeof x === 'number' && Number.isFinite(x);
  const criteria = {
    fog: 'Visibility gate: 3–9 AM local, HRRR, RRFS or IFS 9 km must predict ≤3 statute miles at two consecutive hourly samples at the same airport. Only dry/trace hours qualify: liquid precipitation ≤0.001 in., no snowfall >0.001 in. and no rain/snow weather code. Missing precipitation cannot qualify. AM fog? also requires a 0–3.6°F temperature/dew-point spread at two consecutive qualifying samples in that same source; otherwise the badge says AM vis↓. Humidity/light wind alone never creates either flag. This is model guidance, not an airport observation or advisory.',
    frost: 'Frost screen: midnight–9 AM local, temperature ≤36°F, dew-point spread 0–8°F, wind 0–5 mph and cloud cover 0–50% for at least two consecutive hourly samples in each of at least two sources. Exposed surfaces can freeze above a 32°F air temperature. Ground conditions and sheltered valleys are not resolved.',
    freeze: 'Freeze screen: air temperature ≤32°F during midnight–9 AM local for at least two consecutive hourly samples in each of at least two sources. This is an air-temperature heads-up, not a frost diagnosis or an official growing-season advisory.'
  };
  function consecutive(points) {
    return points.filter((p, i) => (i && p.ms - points[i - 1].ms === H) || (points[i + 1] && points[i + 1].ms - p.ms === H));
  }
  const MILE = 1609.344;
  function visibility(data, day, C, now = Date.now()) {
    const start = Math.floor(now / H) * H;
    const morning = (data.ms || []).map((ms, i) => ({ ms, i, local: C.time.toLocal(ms, data.tz) })).filter(p => p.ms >= start && p.local.slice(0, 10) === day && +p.local.slice(11, 13) >= 3 && +p.local.slice(11, 13) < 9);
    return [['gfs_hrrr', 'HRRR'], ['ncep_rrfs_conus', 'RRFS 3 km'], ['ecmwf_ifs', 'ECMWF IFS 9 km']].map(([id, name]) => {
      const model = id === 'ecmwf_ifs' ? data.visibilitySources?.[id] || data.models?.[id] : data.models?.[id], h = model?.h || {};
      const points = morning.map(p => ({ ...p, value: h.visibility?.[p.i] })).filter(p => finite(p.value) && p.value >= 0 && p.value <= 200000);
      const rawLow = consecutive(points.filter(p => p.value <= 3 * MILE));
      const dry = p => { const rain=h.precipitation?.[p.i], snow=h.snowfall?.[p.i], code=h.weather_code?.[p.i];return finite(rain)&&rain>=0&&rain<=.001&&!(finite(snow)&&snow>.001)&&!(finite(code)&&code>=51&&code<=99); };
      const low = consecutive(rawLow.filter(dry));
      const fog = consecutive(low.filter(p => { const t = h.temperature_2m?.[p.i], td = h.dew_point_2m?.[p.i]; return [t, td].every(finite) && t - td >= 0 && t - td <= 3.6; }));
      const min = points.length ? Math.min(...points.map(p => p.value)) : null;
      const minTimes = points.filter(p => p.value === min).map(p => p.ms);
      const first = low[0]?.ms;
      const prior = first == null ? [] : (data.ms || []).map((ms, i) => ({ ms, value: h.visibility?.[i] })).filter(p => p.ms < first && p.ms >= first - 6 * H && finite(p.value) && p.value >= 0 && p.value <= 200000);
      const before = prior.length ? Math.max(...prior.map(p => p.value)) : null;
      return { id, name, min, minTimes, count: points.length, expected: morning.length, lowTimes: low.map(p => p.ms), fogTimes: fog.map(p => p.ms), excludedTimes:rawLow.filter(p=>!dry(p)).map(p=>p.ms), before: before != null && min != null && before - min >= MILE ? before : null, retrievedAt: model?.retrievedAt || null, cycle: model?.provenance?.cycle || null };
    });
  }
  function assess(data, day, C, now = Date.now(), gust = null) {
    const by = { frost: [], freeze: [] }, coverage = { frost: 0, freeze: 0 };
    const start = Math.floor(now / H) * H;
    const axis = (data.ms || []).map((ms, i) => {
      const local = C.time.toLocal(ms, data.tz);
      return { ms, i, hour: +local.slice(11, 13), day: local.slice(0, 10) };
    }).filter(p => p.day === day && p.ms >= start);
    const at = (h, v, i) => h[v]?.[i];
    for (const [id, model] of Object.entries(data.models || {})) {
      // Hourly ensemble means cannot diagnose a joint event in individual members.
      if (model.kind === 'ens') continue;
      const h = model.h || {}, available = { frost: [], freeze: [] }, hits = { frost: [], freeze: [] };
      for (const p of axis) {
        if (p.hour >= 9) continue;
        const t = at(h, 'temperature_2m', p.i), td = at(h, 'dew_point_2m', p.i), w = at(h, 'wind_speed_10m', p.i), cloud = at(h, 'cloud_cover', p.i);
        if (finite(t)) { available.freeze.push(p); if (t <= 32) hits.freeze.push(p); }
        if (![t, td, w].every(finite) || w < 0 || td > t) continue;
        if (finite(cloud) && cloud >= 0 && cloud <= 100) {
          available.frost.push(p);
          if (t <= 36 && t - td <= 8 && w <= 5 && cloud <= 50) hits.frost.push(p);
        }
      }
      for (const kind of Object.keys(by)) {
        if (consecutive(available[kind]).length) coverage[kind]++;
        const points = consecutive(hits[kind]);
        if (points.length) by[kind].push({ id, times: points.map(p => p.ms) });
      }
    }
    const out = [], point=data.visibilityPoint||{id:'POINT',name:'Selected point'};
    const sites=[{...point,data},...(data.visibilitySites||[]).map(s=>({...s,data:s}))];
    const vis=sites.flatMap(s=>visibility(s.data,day,C,now).map(v=>({...v,site:s.id,siteName:s.name})));
    const fogSites=[...new Set(vis.filter(v=>v.fogTimes.length).map(v=>v.site))];
    const visSites=[...new Set(vis.filter(v=>v.lowTimes.length&&!fogSites.includes(v.site)).map(v=>v.site))];
    for(const [ids,label] of [[fogSites,'AM fog?'],[visSites,'AM vis↓']])if(ids.length){
      const suffix=ids.length===1&&ids[0]==='POINT'?'':' · '+ids.slice(0,2).join('/')+(ids.length>2?' +'+(ids.length-2):'');
      out.push({kind:'fog',label:label+suffix,sources:[],checked:0,visibility:vis,criteria:criteria.fog+' Qualifying locations: '+ids.map(id=>sites.find(s=>s.id===id)?.name||id).join(', ')+'.'});
    }
    const cold = by.freeze.length >= 2 ? 'freeze' : 'frost';
    if (by[cold].length >= 2) out.push({ kind: cold, label: cold === 'freeze' ? 'Freeze?' : 'Frost?', sources: by[cold], checked: coverage[cold], criteria: criteria[cold] });
    if (axis.length && finite(gust) && gust >= 20) out.push({ kind: 'wind', label: 'G:' + Math.floor(gust / 10) * 10 + '+', gust, sources: [], criteria: 'Upcoming blended peak hourly gust ' + gust.toFixed(0) + ' mph. The badge groups gusts into 10-mph bands starting at 20 mph; it is not an NWS wind-advisory threshold.' });
    return out;
  }
  function mount({ O, C }) {
    const E = O.esc;
    function badges(day, flags) {
      return flags.length ? `<div class="impact-flags">${flags.map(f => `<button type="button" class="impact-flag impact-${f.kind}" data-impact-day="${E(day)}" aria-expanded="false" aria-controls="impact-${E(day)}" title="${E(f.criteria)}">${E(f.label.split(" · ")[0])}${f.label.includes(" · ") ? `<span class="impact-sites">${E(f.label.split(" · ")[1])}</span>` : ""}<span class="sr"> Investigate guidance for ${E(day)}</span></button>`).join('')}</div>` : '';
    }
    function details(day, flags, names, tz, columns) {
      if (!flags.length) return '';
      const time = ms => new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      const times = a => { const groups = []; for (const ms of a) { const g = groups.at(-1); if (g && ms - g.at(-1) === H) g.push(ms); else groups.push([ms]); } return groups.map(g => time(g[0]) + (g.length > 1 ? '–' + time(g.at(-1)) : '')).join('; '); };
      const miles = m => m == null ? 'Unavailable' : (m / MILE).toFixed(m < MILE ? 2 : 1) + ' mi';
      const visTable = rows => `<div class="impact-visibility"><b>Model visibility · selected point and local airports</b><p class="msg">HRRR/RRFS and separately retrieved ECMWF IFS 9 km. The blend's IFS 0.25° feed does not supply visibility. Values are converted to statute miles; each airport is a model grid sample, not an area-wide minimum or an airport observation. Missing hours are unavailable, never clear.</p><div class="tablewrap"><table><thead><tr><th scope="col">Source</th><th scope="col">Morning minimum</th><th scope="col">Supporting forecast hours</th></tr></thead><tbody>${rows.map(v => `<tr><th scope="row">${E(v.name)}<br><span class="msg">${E(v.site)} · ${E(v.siteName)}</span></th><td>${E(miles(v.min))}${v.minTimes.length ? '<br>' + E(times(v.minTimes)) : ''}</td><td>${E(v.lowTimes.length ? 'Dry-hour ≤3 mi: ' + times(v.lowTimes) : v.excludedTimes.length ? 'Low visibility excluded: rain/snow or unknown precipitation' : v.count ? 'No sustained dry-hour ≤3 mi signal in available hours' : 'Visibility unavailable for this morning')}${v.fogTimes.length ? '<br>Fog ingredients: ' + E(times(v.fogTimes)) : v.lowTimes.length ? '<br>Fog cause unconfirmed; inspect precipitation and other guidance' : ''}${v.before != null ? '<br>Earlier forecast ' + E(miles(v.before)) + ' → morning minimum ' + E(miles(v.min)) + ' (same series; prior 6 h)' : ''}<br><span class="msg">${v.count}/${v.expected} upcoming morning samples${v.cycle ? '; confirmed NOAA cycle ' + E(v.cycle) : '; exact run not confirmed'}${v.retrievedAt ? '; retrieved ' + E(v.retrievedAt) : ''}</span></td></tr>`).join('')}</tbody></table></div></div>`;
      return `<tr class="impact-detail" id="impact-${E(day)}" hidden><td colspan="${columns}"><strong>Heads-up · ${E(O.fmtDay(day))}</strong><p class="msg">Investigation cues from upcoming guidance, not probabilities, observations or official advisories. Fog flags require sustained low visibility in a named visibility source. Frost/freeze screens use individual deterministic and NWS sources. Screens are independent of blend sliders; ensemble means are excluded. No flag is not an all-clear. Incomplete coverage can miss a signal; later forecast days are preliminary.</p>${flags.map(f => `<div class="impact-explanation"><b>${f.label}</b><p>${E(f.criteria)}</p>${f.visibility ? visTable(f.visibility) : ''}${f.sources.length ? `<p>${f.sources.length} of ${f.checked} sources with at least two consecutive usable samples support the temperature screen. Partial mornings can qualify; these counts do not measure full-window coverage.</p><ul>${f.sources.map(s => `<li>${E(names[s.id] || s.id)}: ${E(times(s.times))}</li>`).join('')}</ul>` : ''}</div>`).join('')}<p class="msg">Morning flags belong to the morning of this date. Sample times are hourly guidance points, not exact onset/end times. Past hours are excluded when guidance is rendered; refresh for an updated assessment.</p></td></tr>`;
    }
    function wire(table) {
      table.querySelectorAll('[data-impact-day]').forEach(b => {
        b.onclick = e => { e.stopPropagation(); const row = table.querySelector('#impact-' + b.dataset.impactDay); row.hidden = !row.hidden; table.querySelectorAll(`[data-impact-day="${b.dataset.impactDay}"]`).forEach(x => x.setAttribute('aria-expanded', String(!row.hidden))); };
        b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };
      });
    }
    return { badges, details, wire };
  }
  const api = { assess, consecutive, visibility, mount };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ImpactFlags = api;
})(typeof globalThis === 'object' ? globalThis : this);
