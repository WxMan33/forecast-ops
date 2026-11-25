/* Event Manager: the lead of the briefing. One plain-language event concern, the parts of the event it could affect,
   what it means in practice and what would change the plan; then a "Why this is flagged" disclosure for the
   meteorologist. Three kinds of information stay visibly apart:
     Forecast concern   from the model blend (BetaStory.eventBrief: its hazards, tiers and timing)
     Official alert     NWS products for the venue (shown in their own block, never as "no threats")
     Missing guidance   a source or coverage gap that limits confidence (sources, hours, an alert check that failed)
   Presentation only: every value is read from what the page already computed (the brief, the attention model, the
   hourly view, the feeds, run metadata and briefing history). No forecast value, weight, rule or threshold is changed
   or added here; the tier rules below are the briefing's own rules written out in words (tests/event-lead.test.js
   holds them to BetaStory.HAZARDS). */
(function (root) {
  'use strict';
  const H = 3600e3, fin = Number.isFinite;
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = (ms, tz) => new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const zone = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName').value;
  const wd = (ms, tz) => new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  const dayKey = (ms, tz) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
  const at = (ms, tz) => `${clock(ms, tz)} ${wd(ms, tz)}`;
  const listWords = (a) => (a.length <= 1 ? a[0] || '' : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  /* "6–9 AM", "11 AM–1 PM" */
  const span = (s, e, tz) => { const a = clock(s, tz), b = clock(e, tz), ma = a.match(/^(.*) (AM|PM)$/), mb = b.match(/^(.*) (AM|PM)$/);
    return ma && mb && ma[2] === mb[2] && dayKey(s, tz) === dayKey(e - 1, tz) ? `${ma[1]}–${b}` : `${a}–${b}`; };

  /* what the main part of the event is called, from its name ("race", "game", …); otherwise "event" */
  const eventWord = (name) => { const m = String(name || '').match(/\b(race|run|marathon|walk|game|match|concert|show|festival|parade|ceremony|tournament)\b/i); return m ? m[1].toLowerCase() : 'event'; };
  /* The briefing's tier rules (BetaStory.HAZARDS[k].level), in words, per level 1..3. Wording only. */
  const TIER_RULE = {
    rain: [null, 'at least a 20% chance or 0.02″ of rain in a part of the event', 'at least a 50% chance or 0.10″ of rain in a part of the event', 'at least a 70% chance and 0.25″ of rain in a part of the event'],
    wind: [null, 'a peak gust of 25 mph or more in a part of the event', 'a peak gust of 35 mph or more', 'a peak gust of 45 mph or more'],
    lightning: [null, 'a marginal thunder signal in the guidance', 'an elevated thunder signal', 'a high thunder signal'],
    snow: [null, '0.05″ or more of model snowfall in a part of the event', '0.3″ or more of model snowfall', '1″ or more of model snowfall'],
    heat: [null, 'a high of 90° or more', 'a high of 95° or more'],
    cold: [null, 'a feels-like temperature of 32° or colder', 'a feels-like temperature of 20° or colder'],
  };
  /* what it means in practice, per hazard and level (1 watch, 2 plan for it, 3 likely disruptive) */
  const IMPLICATION = {
    rain: [null, 'Keep rain gear and covers handy.', 'Cover gear and protect power.', 'Plan for wet footing and keep check-in and equipment covered.'],
    wind: [null, 'Check that tents, banners and signage are secured.', 'Secure or lower tents, banners and signage.', 'Expect wind to limit tents, staging and signage.'],
    lightning: [null, 'Know where people would shelter.', 'Have shelter ready; detected lightning on the day matters most.', 'Expect thunderstorms to interrupt outdoor activity; have shelter ready.'],
    snow: [null, 'Have snow clearing on call.', 'Plan snow clearing and salt for walkways.', 'Expect snow to slow setup and access.'],
    heat: [null, 'Plan water and shade.', 'Plan shade, water and cooling.'],
    cold: [null, 'Plan warm layers for long shifts.', 'Plan warming areas for staff outdoors.'],
  };
  const URGENT = /Warning$/i; // NWS warning-level products (Tornado, Severe Thunderstorm, Flash Flood, Winter Storm, High Wind Warning, …)

  /* where the guidance is missing or thin, from what the page already has */
  function gaps({ b, V, R, feeds, alertsAvailable, now, tz }) {
    const f = feeds || { used: [], missing: [] }, total = f.used.length + (f.missing || []).length;
    const thin = total > 0 && f.used.length / total < 0.7; // the briefing's own "material gap" rule (gapFlag)
    const inEvent = (ms) => b.phases.some((p) => ms + H > p.startMs && ms < p.endMs);
    const missingHours = (V ? V.span : []).filter((ms, i) => inEvent(ms) && ms + H > now && V.hrs[i] && V.hrs[i].state !== 'ok' && V.hrs[i].state !== 'beyond');
    const partial = R && R.state === 'partial' ? R.line : null;
    const hoursText = missingHours.length ? `${missingHours.length === 1 ? `the ${clock(missingHours[0], tz)} hour has` : `${missingHours.length} event hours (${span(missingHours[0], missingHours[missingHours.length - 1] + H, tz)}) have`} no forecast data` : '';
    const why = [thin ? `only ${f.used.length} of ${total} model sources reach these hours (missing ${f.missing.length > 3 ? `${f.missing.slice(0, 3).map((m) => m.name).join(', ')} and ${f.missing.length - 3} more` : listWords(f.missing.map((m) => m.name))})` : '', hoursText, partial ? partial.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()) : ''].filter(Boolean);
    const limited = why.length > 0;
    /* missing hours inside the schedule: name the window and the part of the event it falls in ("the 9–11 AM race window").
       Hours with no value for any variable ("nodata") are forecast guidance; hours that have other values but neither a
       rain chance nor an amount are rain guidance only. The Rain chance row always uses the rain wording. */
    const windowOf = (hs) => { if (!hs.length) return ''; const a = hs[0], z = hs[hs.length - 1] + H, ph = b.phases.find((p) => a + H > p.startMs && a < p.endMs);
      return `${span(a, z, tz)} ${ph && ph.key !== 'event' ? ph.label.toLowerCase() : eventWord(b.ev && b.ev.name)} window`; };
    const rainHours = (V ? V.span : []).filter((ms, i) => { const h = V.hrs[i]; return inEvent(ms) && ms + H > now && h && h.state !== 'beyond' && (h.state !== 'ok' || (!fin(h.pop) && !fin(h.qpf))); });
    const incompleteRain = rainHours.length ? `Rain guidance is incomplete for the ${windowOf(rainHours)}` : '';
    const incomplete = missingHours.length ? `Forecast guidance is incomplete for the ${windowOf(missingHours)}` : incompleteRain;
    const brief = [thin ? `${f.used.length} of ${total} model sources` : '', missingHours.length ? `${missingHours.length} hour${missingHours.length > 1 ? 's' : ''} without data` : '', partial ? 'part of the event not covered yet' : ''].filter(Boolean);
    return { thin, used: f.used.length, total, missing: f.missing || [], missingHours, partial, alertsOff: alertsAvailable === false, limited,
      why, incomplete, incompleteRain, short: limited ? `Confidence is limited: ${why.join('; ')}.` : '', brief: limited ? `Confidence is limited: ${brief.join(', ')}.` : '' };
  }

  /* the official alerts at the venue: urgent (warning-level) ones lead; an empty set is said only when the check succeeded */
  function official(alerts, alertsAvailable) {
    const list = Array.isArray(alerts) ? alerts : [];
    return { state: alertsAvailable === false ? 'unchecked' : list.length ? 'active' : 'none', urgent: list.filter((a) => URGENT.test(a.event || '')), other: list.filter((a) => !URGENT.test(a.event || '')), all: list };
  }

  /* One concern for the lead. o: { b, A, R, S, V, ctx, feeds, alerts, alertsAvailable, tz, now, limit, recipe, names, update, mapOk, hrrrEnd, BUI } */
  function model(o) {
    const { b, A, S, tz } = o, top = b.top, item = top ? A.items.find((x) => x.key === top.key) || A.items[0] : null;
    const G = gaps(o), OF = official(o.alerts, o.alertsAvailable);
    const kind = top ? 'forecast' : G.limited ? 'missing' : 'none';
    const evp = b.phases.find((p) => p.key === 'event') || b.phases[0] || b.all;
    const hit = top ? b.phases.filter((p) => (item && item.phases.includes(p.label)) || top.phases.includes(p.label)) : [];
    const phases = b.phases.map((p) => ({ key: p.key, label: p.label, startMs: p.startMs, endMs: p.endMs, time: span(p.startMs, p.endMs, tz), hit: hit.includes(p) }));
    const focus = top && fin(top.from) ? top.from : Math.floor(evp.startMs / H) * H;
    const when = top && fin(top.from) ? `${wd(top.from, tz)} ${span(top.from, top.to, tz)}` : ''; // the headline names the hazard; times are venue-local (zone in the header)
    const implication = top ? (IMPLICATION[top.key] || [])[top.level] || '' : kind === 'missing' ? 'Treat it as unconfirmed until the guidance returns.' : 'no weather change needed.';
    return { kind, top, item, gaps: G, official: OF, phases, hit, focus, when, implication, watch: watchFor(o, { top, hit, G }), changes: changes(o, { top, hit, evp, G }), evidence: evidence(o, focus) };
  }
  /* heavier rain at the busiest moment: the heaviest hour(s) of the blend's hourly rain amounts (V.hrs qpf; ties at the
     two decimals the page shows) falling in gates ("lineup" for a race or run) and/or within an hour of the event start.
     Read from the existing hourly values only; no new threshold. Null when the timing doesn't support it. */
  function heavier(o) {
    const { b, V, tz } = o, ev = b.phases.find((p) => p.key === 'event'), gates = b.phases.find((p) => p.key === 'gates');
    if (!V || !ev) return null;
    const hrs = V.span.map((ms, i) => ({ ms, q: V.hrs[i] && V.hrs[i].state === 'ok' && fin(V.hrs[i].qpf) ? Math.round(V.hrs[i].qpf * 100) : null })).filter((x) => x.q != null && x.ms + H > b.all.startMs && x.ms < b.all.endMs);
    const top = Math.max(0, ...hrs.map((x) => x.q)); if (!(top > 0)) return null;
    const peak = hrs.filter((x) => x.q === top), word = /^(race|run|marathon|walk)$/.test(eventWord(b.ev && b.ev.name)) ? 'lineup' : 'gates';
    const inGates = !!gates && peak.some((x) => x.ms < gates.endMs && x.ms + H > gates.startMs), nearStart = peak.some((x) => Math.abs(x.ms - ev.startMs) <= H);
    const at = `the ${clock(ev.startMs, tz)} start`;
    return inGates && nearStart ? `heavier rain during ${word} and around ${at}.` : inGates ? `heavier rain during ${word} (${span(gates.startMs, gates.endMs, tz)}).` : nearStart ? `heavier rain around ${at}.` : null;
  }
  /* "Watch for": one short line for the first screen. The organizer's own threshold where the event has one (its gust
     limit); otherwise what to watch in the next update, with no implied delay or cancellation rule. */
  function watchFor(o, { top, hit, G }) {
    const tz = o.tz, first = hit[0], during = first ? ` during ${first.label.toLowerCase()}` : '';
    if (top && top.key === 'wind') { const pk = Math.round(o.b.phases.reduce((m, p) => Math.max(m, p.r && fin(p.r.gust) ? p.r.gust : 0), 0));
      return `gusts at or above your ${o.limit || 25} mph limit${during} (now up to ${pk} mph).`; }
    if (top && top.key === 'lightning') return `the thunder signal${during} holding or fading.`;
    if (top && top.key === 'rain') { const h = heavier(o); if (h) return h; }
    if (top && fin(top.from)) return `the ${top.noun} arriving earlier or later than ${clock(top.from, tz)}.`;
    if (top) return `whether the ${top.noun}${during} firms up in the next update.`;
    if (G.limited) return G.incomplete ? 'the missing hours filling in.' : 'the missing guidance returning.';
    return 'any new rain, wind or thunder signal.';
  }

  /* "What would change the plan": a concrete trigger tied to the affected part of the event. It uses the event's own
     decision criteria where the organizer set one (the gust limit) and the briefing's tier rules otherwise; it never
     implies a delay or cancellation policy the venue may not have. */
  function changes(o, { top, hit, evp, G }) {
    const { b, S, tz } = o, out = [];
    const firstHit = hit[0], evLabel = evp.key === 'event' ? 'event' : evp.label.toLowerCase();
    if (top) {
      const t = top.timing || {};
      if (top.key === 'rain') {
        /* each source's own onset (the same per-source timing the briefing's certainty uses) */
        const s0 = Math.max(b.all.startMs, Math.floor(o.now / H) * H), all = S.precipTiming ? S.precipTiming(o.ctx, s0, b.all.endMs).rows.filter((r) => r.status === 'wet') : [];
        const rows = all.filter((r) => fin(r.onset) && !r.onsetClipped), under = all.filter((r) => r.onsetClipped);
        const name = (id) => ((o.names && o.names[id]) || id).replace(/ \(.*\)$/, ''), early = rows.slice().sort((a, c) => a.onset - c.onset)[0], late = rows.slice().sort((a, c) => c.onset - a.onset)[0];
        const range = early && late ? (late.onset - early.onset >= H ? `sources now start it between ${clock(early.onset, tz)} (${name(early.id)}) and ${clock(late.onset, tz)} (${name(late.id)})` : `sources agree on about ${clock(early.onset, tz)}`)
          : fin(t.first) && fin(t.last) ? (t.last - t.first >= H ? `sources now start it between ${clock(t.first, tz)} and ${clock(t.last, tz)}` : `sources agree on about ${clock(t.first, tz)}`) : '';
        const already = under.length ? `${listWords(under.map((r) => name(r.id)))} ${under.length > 1 ? 'have' : 'has'} it falling by ${clock(s0, tz)}` : '';
        if (fin(top.from) && top.from <= evp.startMs) out.push(`Watch whether the rain window (now ${span(top.from, top.to, tz)}) shifts clear of the ${clock(evp.startMs, tz)} ${evLabel} start in the next update${range ? `; ${range}` : ''}${already ? `${range ? ', and ' : '; '}${already}` : ''}.`);
        else if (fin(top.from) && top.from < evp.endMs) out.push(`Watch whether the rain moves earlier than ${clock(top.from, tz)} or holds off until after the ${clock(evp.endMs, tz)} finish in the next update${range ? `; ${range}` : ''}.`);
        else if (fin(top.from)) out.push(`Watch whether the rain moves earlier than ${clock(top.from, tz)}, into the ${evLabel} itself (it ends ${clock(evp.endMs, tz)}).`);
      } else if (top.key === 'wind') {
        const pk = Math.round(b.phases.reduce((m, p) => Math.max(m, p.r && fin(p.r.gust) ? p.r.gust : 0), 0)), lim = o.limit || 25;
        out.push(`Your event’s gust limit is ${lim} mph and gusts reach up to ${pk} mph${firstHit ? ` during ${firstHit.label.toLowerCase()} (${span(firstHit.startMs, firstHit.endMs, tz)})` : ''}. Watch whether they stay at or above ${lim} mph in the next update.`);
      } else if (top.key === 'lightning') {
        out.push(`Watch whether the thunder signal${firstHit ? ` during ${firstHit.label.toLowerCase()} (${span(firstHit.startMs, firstHit.endMs, tz)})` : ''} holds in the next update. It is forecast potential, not detected lightning.`);
      } else if (fin(top.from)) out.push(`Watch whether the ${top.noun} moves earlier or later than ${span(top.from, top.to, tz)} in the next update.`);
      const rule = (TIER_RULE[top.key] || [])[top.level], below = top.level > 1 ? S.LEVEL_WORD[top.level - 1] : null;
      if (rule) out.push(`It is rated ${top.word.toLowerCase()} by the briefing’s ${top.label.toLowerCase()} rule (${rule}).${below ? ` If the next update falls below that, it would be “${below.toLowerCase()}”.` : ' If the next update falls below that, it would drop off the list.'}`);
    } else if (G.limited) {
      if (G.thin) out.push(`If ${listWords(G.missing.slice(0, 3).map((m) => m.name))} answer at the next check, the assessment could change.`);
      if (G.missingHours.length) out.push(`The ${span(G.missingHours[0], G.missingHours[G.missingHours.length - 1] + H, tz)} hours have no forecast data yet; a concern there would not show here.`);
      if (G.partial) out.push('The rest of the event fills in as the date gets closer.');
    } else {
      const nu = S.nextUpdates ? S.nextUpdates(o.ctx, o.names)[0] : null;
      out.push(`No part of the event reaches a planning threshold. A new rain, wind or thunder signal in the next update${nu ? ` (${nu.name} about ${clock(nu.at, tz)})` : ''} would change that.`);
    }
    return out.slice(0, 2);
  }

  /* evidence one tap away, at the concern's hour; the forecast radar says plainly when it does not reach that hour */
  function evidence(o, focus) {
    const tz = o.tz, label = at(focus, tz);
    const radar = !o.mapOk ? { ok: false, note: 'Forecast radar isn’t available for this venue; the charts use the model blend.' }
      : !fin(o.hrrrEnd) || focus > o.hrrrEnd ? { ok: false, note: `Forecast radar doesn’t reach ${label} yet; the charts use the model blend.` } : { ok: true, note: '' };
    return { at: focus, label, radar };
  }

  /* ---- screen ---- */
  const KIND = { forecast: 'Forecast concern', none: 'No forecast concern', missing: 'Missing guidance', official: 'Official alert' };
  const tag = (k, extra = '') => `<span class="ev-kind" data-kind="${k}">${esc(KIND[k])}</span>${extra}`;
  const alertLine = (a, tz, lat, lon) => `<div class="bx-alert${URGENT.test(a.event || '') ? ' ev-urgent' : ''}" role="alert" data-official="${URGENT.test(a.event || '') ? 'urgent' : 'active'}">${tag('official')}<b>${esc(a.event)} in effect</b>${a.ends ? `<span class="bx-note">until ${esc(clock(Date.parse(a.ends), tz))} ${esc(wd(Date.parse(a.ends), tz))}</span>` : ''}<a href="https://forecast.weather.gov/MapClick.php?lat=${esc(lat)}&lon=${esc(lon)}" target="_blank" rel="noopener">NWS ↗</a></div>`;
  /* the lead's top part: kind, then (with #decision placed between by the page) when, phases, implication, urgent alerts */
  function leadKind(L) { return tag(L.kind); }
  function leadHtml(L, { tz, lat, lon }) {
    const hit = L.phases.filter((p) => p.hit), all = L.phases.length > 1 && hit.length === L.phases.length, P = L.phases;
    const whole = P.length ? `${P[0].label.toLowerCase()} through ${P[P.length - 1].label.toLowerCase()}` : 'the event';
    let text;
    /* the implication now sits with the tier word in the concern's callout row just below ("Likely disruptive. Plan …") */
    if (L.kind === 'forecast') text = `<b>${esc(L.when || cap(L.top.noun))}</b>, ${all ? esc(whole) : hit.length ? listWords(hit.map((p) => `<span class="ev-ph">${esc(p.label.toLowerCase())} ${esc(p.time)}</span>`)) : 'exact time uncertain'}.${L.gaps.limited ? ` <span class="ev-lead-gap" data-lead="gap">${esc(L.gaps.brief)}</span>` : ''}`;
    /* missing guidance: the headline names the window; one short line says why (the missing sources are named under
       "Why this is flagged" and in the Missing guidance block below), with "Watch for" in the same paragraph */
    else if (L.kind === 'missing') { const G = L.gaps, w = [G.thin ? `Only ${G.used} of ${G.total} model sources reach these hours.` : '', G.partial ? `${G.partial.replace(/\.$/, '')}.` : '',
        !G.incomplete && G.missingHours.length ? `${cap(G.why.find((x) => /no forecast data/.test(x)) || '')}.` : ''].filter((x) => x && x !== '.');
      text = `<span data-lead="gap">${esc(w.join(' ') || 'Treat it as unconfirmed until the guidance returns.')}</span> <span class="ev-lead-watch" data-lead="watch"><b>Watch for:</b> ${esc(L.watch)}</span>`; }
    else text = `Checked ${esc(whole)}${P.length ? `, ${esc(span(P[0].startMs, P[P.length - 1].endMs, tz))}` : ''}: ${esc(L.implication.replace(/^./, (c) => c.toLowerCase()))}`;
    const urgent = L.official.urgent.map((a) => alertLine(a, tz, lat, lon)).join('');
    return `<p class="ev-lead-when" data-lead="when">${leadKind(L)} ${text}</p>${L.kind === 'missing' ? '' : `<p class="ev-lead-watch" data-lead="watch"><b>Watch for:</b> ${esc(L.watch)}</p>`}${urgent ? `<div class="ev-lead-urgent" data-lead="urgent">${urgent}</div>` : ''}`;
  }
  /* below the callouts: what would change the plan, the evidence links and the disclosure */
  function afterHtml(L, W) {
    const ev = L.evidence;
    return `<div class="ev-lead-change" data-lead="change"><b>What would change the plan</b><ul>${L.changes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <p class="ev-evidence" data-lead="evidence"><a class="bx-link" href="#secHourly" data-evidence="charts" data-at="${ev.at}">Hourly charts at ${esc(ev.label)} ↓</a><a class="bx-link" href="#secMap" data-evidence="radar" data-at="${ev.at}">Forecast radar at ${esc(ev.label)} ↓</a></p>
      ${ev.radar.ok ? '' : `<p class="bx-note ev-evnote" data-lead="radar-note">${esc(ev.radar.note)}</p>`}
      ${whyHtml(W)}`;
  }
  /* the official alerts block: its own section, after the forecast concern; empty only when the check succeeded */
  function officialHtml(L, { tz, lat, lon, checkedAt }) {
    const O = L.official, rest = O.all.filter((a) => !URGENT.test(a.event || ''));
    if (O.state === 'unchecked') return `<div class="bx-alert-off ev-official" role="status" data-alerts="unavailable" data-official="unchecked">${tag('missing')} <b>Official alerts could not be checked${checkedAt ? ` (${esc(clock(checkedAt, tz))})` : ''}</b>. NWS alerts could not be checked just now. No alert shown here does not mean none is in effect; check <a href="https://www.weather.gov/" target="_blank" rel="noopener">weather.gov</a>.</div>`;
    if (O.state === 'none') return `<p class="ev-official ev-official-none" data-official="none">${tag('official')} <span><b>No active official alerts</b> for your site right now${checkedAt ? ` (checked ${esc(clock(checkedAt, tz))})` : ''}. This doesn’t mean no weather concern: the forecast concern is above. <a class="bx-link" href="#secThreats">Outlooks and other official products ↓</a></span></p>`;
    return `${rest.map((a) => alertLine(a, tz, lat, lon)).join('')}${O.urgent.length ? `<p class="bx-note ev-official-more" data-official="urgent-above">${O.urgent.length === 1 ? 'The warning in effect is shown' : `${O.urgent.length} warnings in effect are shown`} with the forecast concern above.</p>` : ''}`;
  }

  /* ---- "Why this is flagged": the evidence behind the lead, for the meteorologist ---- */
  function why(o, L) {
    const { b, S, V, tz, ctx } = o, top = L.top, G = L.gaps, f = o.feeds || { used: [], missing: [] }, rows = [];
    const pct = (v) => (fin(v) ? `${Math.round(v * 100)}%` : '—'), inch = (v) => (fin(v) ? `${v.toFixed(2)}″` : '—');
    const phaseVal = (p, k) => { const r = p.r; if (!r) return ''; return k === 'rain' ? `${fin(r.chanceV) ? `${pct(r.chanceV)} chance, ` : ''}${inch(r.qpf)}` : k === 'wind' ? `gusts ${fin(r.gust) ? Math.round(r.gust) : '—'} mph` : k === 'lightning' ? `thunder signal ${r.thunder || 'unavailable'}` : k === 'snow' ? `${fin(r.sn) ? r.sn.toFixed(1) : '—'}″ snow` : k === 'heat' ? `high ${fin(r.hi) ? Math.round(r.hi) : '—'}°` : `feels like ${fin(r.feel) ? Math.round(r.feel) : '—'}°`; };
    /* 1. the guidance behind the headline */
    const blend = `${o.recipe || 'Model blend'} of ${f.used.length} source${f.used.length === 1 ? '' : 's'}${f.used.length ? ` (${f.used.join(', ')})` : ''}`;
    if (top) {
      const per = b.phases.filter((p) => p.r && (p.levels[top.key] || 0) > 0).map((p) => `${p.label} ${S.LEVEL_WORD[p.levels[top.key]].toLowerCase()} (${phaseVal(p, top.key)})`);
      rows.push(['Guidance', `${blend}. ${top.label}: ${top.word.toLowerCase()} — ${top.why} in the highest-rated part.`]);
      rows.push(['Against the rule', `${cap(top.word)} means ${(TIER_RULE[top.key] || [])[top.level] || 'the briefing’s top tier'}. By part: ${per.join('; ') || 'no single part rated'}.`]);
    } else {
      const live = b.phases.filter((p) => p.r), mx = (k) => live.reduce((a, p) => (fin(p.r[k]) && (!a || p.r[k] > a.v) ? { v: p.r[k], p } : a), null), c = mx('chanceV'), g = mx('gust');
      rows.push(['Guidance', `${blend}. No hazard reaches the briefing’s lowest tier in any part of the event${c ? `; highest rain chance ${pct(c.v)} (${c.p.label.toLowerCase()})` : ''}${g ? `, peak gust ${Math.round(g.v)} mph (${g.p.label.toLowerCase()})` : ''}.${G.incomplete ? ` ${G.incomplete}: those hours are missing, not quiet.` : ''}`]);
    }
    /* 2. model spread: the forecast range across sources the page already computes */
    const T = V && V.totals, spread = [];
    if (T && fin(T.qpf)) spread.push(`Rain over the event ${inch(T.qpf)} in the blend${T.qpfR && fin(T.qpfR[0]) && fin(T.qpfR[1]) ? (T.qpfR[1] - T.qpfR[0] >= 0.005 ? `; sources range ${inch(T.qpfR[0])}–${inch(T.qpfR[1])} (10th–90th percentile, weighted)` : '; the sources agree on that amount') : ''}${T.gap ? `, with ${T.gap} hour${T.gap > 1 ? 's' : ''} missing` : ''}.`);
    if (top && top.timing && top.timing.of) spread.push(`${top.timing.show} of ${top.timing.of} sources show ${top.noun} in these hours${fin(top.timing.first) && top.key !== 'lightning' ? `, first between ${clock(top.timing.first, tz)} and ${clock(top.timing.last, tz)}` : ''}. Timing: ${top.certainty.word.replace(/^./, (c) => c.toLowerCase())}.`);
    const ev = b.phases.find((p) => p.key === 'event'), er = ev && ev.r;
    if (er && fin(er.hiR[0]) && fin(er.hiR[1])) spread.push(`Temperature during the ${ev.label.toLowerCase()}: ${Math.round(er.hiR[0]) === Math.round(er.hiR[1]) ? `${Math.round(er.hiR[1])}° in every source` : `${Math.round(er.hiR[0])}–${Math.round(er.hiR[1])}° across sources`} (${er.ag.word.toLowerCase()}).`);
    rows.push(['Model spread', spread.join(' ') || 'Not enough sources to show a spread.']);
    /* 3. trend: only against a comparable earlier briefing */
    const u = o.update, trend = u && u.items && u.items.length ? `Since your briefing of ${clock(u.previousAt, tz)} ${wd(u.previousAt, tz)}: ${u.items.map((x) => x.text).join(' ')}`
      : u && u.state === 'same' ? 'No meaningful change since your last briefing.' : u && u.previousAt && ['recipe-changed', 'sources-changed', 'event-changed', 'no-overlap'].includes(u.state) ? 'Your last briefing is not comparable with this one (its sources, recipe or schedule differ).'
      : u && u.previousAt ? 'No meaningful change since your last briefing.' : 'No earlier briefing to compare yet.';
    rows.push(['Trend', trend]);
    /* 4. source timing: run times, retrieval and the next expected updates */
    const ages = S.guidanceAge ? S.guidanceAge(ctx, o.names || {}).filter((a) => !a.nws) : [], next = S.nextUpdates ? S.nextUpdates(ctx, o.names || {}) : [];
    const retrieved = ctx.B && ctx.B.viewedAt;
    rows.push(['Source timing', `${ages.length ? ages.map((a) => `${a.name} run ${a.unknown ? 'time unknown' : `${clock(a.init, tz)} ${wd(a.init, tz)} (${Math.round(a.ageH)} h old${a.late ? ', late' : ''})`}`).join('; ') : 'Run times were not reported'}. ${fin(retrieved) ? `Retrieved ${clock(retrieved, tz)} ${zone(retrieved, tz)}. ` : ''}${next.length ? `Next: ${next.map((n) => `${n.name} about ${clock(n.at, tz)} ${wd(n.at, tz)}`).join(', ')}.` : ''}`.trim()]);
    /* 5. coverage and gaps */
    const cov = [`${G.used} of ${G.total} model sources reach the event hours${G.missing.length ? ` (not available: ${G.missing.map((m) => `${m.name}${m.why ? `, ${m.why}` : ''}`).join('; ')})` : ''}.`];
    if (G.missingHours.length) cov.push(`${G.missingHours.length} event hour${G.missingHours.length > 1 ? 's have' : ' has'} no forecast data (${span(G.missingHours[0], G.missingHours[G.missingHours.length - 1] + H, tz)}): missing, not zero.`);
    if (G.partial) cov.push(G.partial);
    if (G.alertsOff) cov.push('Official NWS alerts could not be checked.');
    cov.push(G.thin ? 'Coverage is thin: treat timing and amounts as rough.' : G.limited ? 'Treat the affected hours as unconfirmed.' : 'No coverage gaps for the event hours.');
    rows.push(['Coverage', cov.join(' ')]);
    /* 6. what would change this assessment */
    const pc = S.planChanges ? S.planChanges(b, (ms) => `${clock(ms, tz)}`) : [];
    rows.push(['What would change it', [...new Set([...L.changes, ...pc])].slice(0, 4).join(' ')]);
    /* the printout's compact summary: the same values, fewer words */
    const T2 = top && top.timing, nx = next[0], newest = ages[0];
    /* the printout's compact summary on page 1: the same values in plain words; model names and source counts stay on
       the website (the handout rule), so coverage points to the "Missing guidance" line instead */
    const print = [
      top ? `${top.label} ${top.word.toLowerCase()}: ${(TIER_RULE[top.key] || [])[top.level] || ''}.` : G.incomplete ? `${G.incomplete}; no hazard reaches the briefing’s lowest tier in the hours that have guidance.` : 'No hazard reaches the briefing’s lowest tier in any part of the event.',
      `${T && fin(T.qpf) && T.qpf >= 0.005 ? `Event rain ${inch(T.qpf)} in the blend${T.qpfR && fin(T.qpfR[1]) && T.qpfR[1] - T.qpfR[0] >= 0.005 ? `, forecast range ${inch(T.qpfR[0])}–${inch(T.qpfR[1])}` : ''}. ` : ''}${T2 && T2.of && fin(T2.first) && top.key !== 'lightning' ? `First ${top.noun} ${clock(T2.first, tz)}–${clock(T2.last, tz)} across the guidance (${top.certainty.word.replace(/ —.*$/, '').toLowerCase()}). ` : ''}`.trim(),
      `${newest ? `Newest model run ${clock(newest.init, tz)} ${wd(newest.init, tz)}` : 'Model run times not reported'}${nx ? `; next update about ${clock(nx.at, tz)} ${wd(nx.at, tz)}` : ''}.`,
      G.limited ? 'Coverage is limited: see Missing guidance above.' : 'Coverage: the guidance reaches every event hour.',
      trend,
    ].filter(Boolean);
    return { rows, print };
  }
  function whyHtml(W) {
    return `<details class="ev-why" id="whyFlagged" data-lead="why"><summary>Why this is flagged</summary><dl class="ev-why-list">${W.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd data-why="${esc(k.toLowerCase().replace(/\s+/g, '-'))}">${esc(v)}</dd>`).join('')}</dl><p class="bx-note">Model guidance for planning, read from the values on this page. Follow official NWS warnings for live decisions.</p></details>`;
  }

  /* ---- printout: page 1's lead, official alerts and missing guidance, and a compact "why" ---- */
  function printLead(L, { tz, next, checkedAt, headline }) {
    const O = L.official, nextTxt = next ? `${wd(next.at, tz)} ${clock(next.at, tz)} ${zone(next.at, tz)} · ${next.what}` : 'Now: use radar, lightning detection and official NWS warnings.';
    const official = O.state === 'unchecked' ? `<div class="pv-alerts pv-alerts-off" data-pv="official"><b>Official NWS alerts</b><span>Could not be checked when this was printed. Check weather.gov before the event.</span></div>`
      : O.state === 'none' ? `<div class="pv-alerts pv-alerts-none" data-pv="official"><span><b>Official NWS alerts:</b> none active for the site${checkedAt ? ` (checked ${esc(clock(checkedAt, tz))})` : ''}. This doesn’t mean no weather concern.</span></div>`
      : `<div class="pv-alerts" data-pv="official"><b>Official NWS alert${O.all.length > 1 ? 's' : ''} in effect</b>${O.all.slice(0, 3).map((x) => `<span>${esc(x.event)}${x.ends ? ` until ${esc(wd(Date.parse(x.ends), tz))} ${esc(clock(Date.parse(x.ends), tz))}` : ''}</span>`).join('')}</div>`;
    /* page 1 is a handout: the gap in plain words (model names and counts are in the "why" summary on page 2) */
    const G = L.gaps, plain = [G.thin ? 'Only part of the usual forecast data reaches these hours, so timing could shift.' : '', G.missingHours.length ? `${cap(G.missingHours.length === 1 ? `the ${clock(G.missingHours[0], tz)} hour has` : `${span(G.missingHours[0], G.missingHours[G.missingHours.length - 1] + H, tz)} (${G.missingHours.length} hours) have`)} no forecast data: missing, not zero.` : '', G.partial ? `${G.partial} Check again for the rest.` : '', G.alertsOff ? 'Official alerts could not be checked.' : ''].filter(Boolean);
    const gap = plain.length ? `<p class="pv-gap" data-pv="missing"><b>Missing guidance:</b> ${esc(plain.join(' '))}</p>` : '';
    const P = L.phases, hit = P.filter((p) => p.hit), all = P.length > 1 && hit.length === P.length;
    const where = L.kind === 'forecast' ? (all ? `${P[0].label.toLowerCase()} through ${P[P.length - 1].label.toLowerCase()}` : hit.map((p) => `${p.label.toLowerCase()} ${p.time}`).join(', ') || 'exact time uncertain')
      : `checked ${P.length ? `${P[0].label.toLowerCase()} through ${P[P.length - 1].label.toLowerCase()}` : 'the event'}`;
    return `<div class="pv-takeaway pv-takeaway-lead"><div class="pv-lead" data-pv="lead"><span class="pv-kind">${esc(KIND[L.kind])}</span><h2 class="pv-dec">${esc(headline)}</h2>
      <p class="pv-lead-when">${L.when ? `<b>${esc(L.when)}</b>, ${esc(where)}` : esc(cap(where))}. ${L.top && L.top.word ? `<b>${esc(L.top.word)}.</b> ` : ''}${esc(L.implication)}</p>
      <p class="pv-lead-watch"><b>Watch for:</b> ${esc(L.watch)}</p>
      <p class="pv-lead-change"><b>What would change the plan:</b> ${esc(L.kind === 'missing' ? 'If the missing forecast data returns at the next check, the assessment could change.' : L.changes[0] || '')}</p>
      <p class="pv-lead-next"><b>Next weather check:</b> ${esc(nextTxt)}</p></div></div>${official}${gap}`;
  }
  function printWhy(W) {
    return `<div class="pv-why" data-pv="why"><b>Why this is flagged</b> ${W.print.map((t) => `<span>${esc(t)}</span>`).join(' ')}</div>`;
  }

  const api = { eventWord, watchFor, heavier, TIER_RULE, IMPLICATION, URGENT, gaps, official, model, changes, evidence, why, leadKind, leadHtml, afterHtml, officialHtml, whyHtml, printLead, printWhy, span };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EventLead = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
