/* Scoped (short/long-range) default in prospective verification. Synthetic model data. */
"use strict";
const assert = require("assert"), NORM = require("../lib/normalize"), BL = require("../config/blends"), SC = require("../lib/score"), U = require("../lib/util"), loc = require("../config/locations").CVG;
let n = 0; const ok = (c, m) => { assert(c, m); n++; }, eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const R = BL.recipes.find((r) => r.id === "brad-scoped-default-2026-11-04-v2");
ok(R && R.effectiveFrom && R.rules.periodWeights, "scoped default archived with near/far weights and an effectiveFrom");
eq(U.configHash({ weights: R.weights, rules: R.rules }), BL.FROZEN[R.id], "recipe is frozen by hash");
const C = U.Core, site = C.blend.scopedWeights(C.blend.defaultProfiles([...C.config.blend.extra, ...C.config.blend.models].map((m) => ({ id: m.id, w: m.w }))));
ok(!R.rules.periodWeights.nearTemp, "old scoped recipe retains its original shared-variable rules");
/* synthetic: HRRR (near 3, far 0) at 50 F and ECMWF IFS (near 1, far 1.25) at 70 F */
const t0 = Date.parse(R.effectiveFrom) + 6 * 3600e3, start = Date.parse(new Date(t0).toISOString().slice(0, 10) + "T00:00Z");
const hours = Array.from({ length: 24 * 5 }, (_, i) => new Date(start + i * 3600e3).toISOString().slice(0, 16));
const det = (v) => ({ hourly: { time: hours, temperature_2m: hours.map(() => v), precipitation: hours.map(() => 0), snowfall: hours.map(() => 0), precipitation_probability: hours.map(() => 0) } });
const raw = { det: { gfs_hrrr: det(50), ecmwf_ifs025: det(70) }, ens: {}, nws: {} };
const cap = { captureId: "x", slot: "midday", localDate: new Date(t0 - 5 * 3600e3).toISOString().slice(0, 10), slotTarget: new Date(t0).toISOString(), startedAt: new Date(t0).toISOString(), sources: { gfs_hrrr: { id: "gfs_hrrr", retrievedAt: new Date(t0).toISOString() } } };
const b1 = NORM.normalize(raw, cap, loc, BL.recipes), v = b1.blends[R.id];
ok(v && v.periodBoundary === new Date(t0 + 48 * 3600e3).toISOString(), "the 48-h boundary is pinned to the capture's last retrieval");
const hi = v.values.tmax_clim || {}, days = Object.keys(hi).sort();
ok(days.length >= 3, `daily highs produced (${days})`);
const firstFull = days[0], late = days[days.length - 1];
ok(Math.abs(hi[firstFull].v - 55) < 0.05, `inside the first 48 h: near weights (3x50 + 1x70)/4 = 55 (got ${hi[firstFull].v})`);
ok(Math.abs(hi[late].v - 70) < 0.05, `beyond 48 h: far weights (HRRR 0) give 70 (got ${hi[late].v})`);
ok(v.shares.near && v.shares.far, "near and far shares are recorded separately");
const realNow = Date.now; Date.now = () => realNow() + 30 * 86400e3; // re-normalize "a month later"
try { eq(NORM.normalize(raw, cap, loc, BL.recipes).blends[R.id].values, v.values, "re-normalizing later gives identical values (no dependence on the current time)"); } finally { Date.now = realNow; }
const series = b1.hourly.temperature_2m["blend:" + R.id], i48 = Math.round((t0 + 48 * 3600e3 - start) / 3600e3);
ok(Math.abs(series[i48 - 2] - 55) < 0.05 && Math.abs(series[i48 + 2] - 70) < 0.05, "hourly blend series switches weights at the boundary");
eq(SC.retrospective(R.id, { startedAt: new Date(Date.parse(R.effectiveFrom) - 1000).toISOString() }), true, "captures before effectiveFrom are retrospective");
const early = NORM.normalize(raw, { ...cap, startedAt: new Date(Date.parse(R.effectiveFrom) - 3600e3).toISOString() }, loc, BL.recipes);
ok(!early.blends[R.id] && early.recipesNotApplied.some((x) => x.id === R.id), "not applied to captures made before it existed");
console.log(`ok - ${n} scoped-recipe checks passed`);

const V3=BL.recipes.find(r=>r.id===C.blend.CUSTOM_DEFAULTS.id);
eq({weights:V3.weights,rules:V3.rules},{weights:site.ws,rules:site.rules},'v3 matches website defaults');
eq(U.configHash({weights:V3.weights,rules:V3.rules}),BL.FROZEN[V3.id],'v3 recipe hash is frozen');
const tuneTime=Date.parse(V3.effectiveFrom)+6*3600e3;
const tuneStart=Date.parse(new Date(tuneTime).toISOString().slice(0,10)+'T00:00Z');
const tuneHours=Array.from({length:120},(_,i)=>new Date(tuneStart+i*3600e3).toISOString().slice(0,16));
const tuneDet=t=>({hourly:{time:tuneHours,temperature_2m:tuneHours.map(()=>t),precipitation:tuneHours.map(()=>.01),snowfall:tuneHours.map(()=>0)}});
const tuneRaw={det:{gfs_hrrr:tuneDet(50),ecmwf_ifs025:tuneDet(70)},ens:{},nws:{}};
const tuneCap={...cap,startedAt:new Date(tuneTime).toISOString(),slotTarget:new Date(tuneTime).toISOString(),sources:{gfs_hrrr:{retrievedAt:new Date(tuneTime).toISOString()}}};
const tuned=NORM.normalize(tuneRaw,tuneCap,loc,BL.recipes),old=tuned.blends[R.id],next=tuned.blends[V3.id];
eq(next.values.precip_clim,old.values.precip_clim,'precipitation amounts/spreads stay identical');
const ti=Math.round((tuneTime+3*3600e3-tuneStart)/3600e3);
ok(tuned.hourly.temperature_2m['blend:'+V3.id][ti]>tuned.hourly.temperature_2m['blend:'+R.id][ti],'new temperature profile reduces the cold HRRR contribution');
ok(next.shares.near.temperature_2m.find(x=>x[0]==='gfs_hrrr')[1]<next.shares.near.precipitation.find(x=>x[0]==='gfs_hrrr')[1],'archive records distinct temperature and precipitation shares');
ok(SC.retrospective(V3.id,{startedAt:new Date(Date.parse(V3.effectiveFrom)-1000).toISOString()}),'v3 cannot score earlier captures as prospective');
console.log('Temperature-tuned v3 prospective normalization and unchanged precipitation checks pass');
