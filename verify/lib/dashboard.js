/* Private dashboard projections. Reads archived bundles; never captures or changes forecasts. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js"), ED = require("./editions.js"), OBS = require("./obs.js"), TG = require("./targets.js"), TM = require("./timing.js");
const VERSION = "dashboard-v2"; // v2: adds reports/dashboard/scorecard.json (matched source comparison and coverage)
const DAILY = ["tmax_clim", "tmin_clim", "precip_clim"];
const good = x => typeof x === "number" && Number.isFinite(x);
const time = s => Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;

function bundles(DATA, loc, version) {
  const caps = U.readJSONL(path.join(DATA, "captures", loc.id + ".jsonl"));
  return caps.slice().sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt))).slice(-40).flatMap(cap => {
    if (!/^[\w-]+$/.test(cap.captureId)) return [];
    const candidates = [`normalized/${loc.id}/${cap.localDate.slice(0,4)}/${cap.captureId}.${version}.json.gz`, cap.normalized && cap.normalized.path].filter(Boolean);
    for (const rel of [...new Set(candidates)]) {
      if (!rel.startsWith(`normalized/${loc.id}/`) || rel.includes("..")) continue;
      try { const b = JSON.parse(U.gunzip(fs.readFileSync(path.join(DATA,rel))).toString()); if (!b.error && b.hourly) return [{cap,b,rel}]; } catch(e) { /* try recorded bundle; absence is shown as missing */ }
    }
    return [];
  });
}

function writeDashboard(DATA, loc, res, nowMs = Date.now(), slots = []) {
  const base = path.join(DATA,"reports","dashboard"); U.mkdirp(base);
  const list = bundles(DATA,loc,res.normVersion || require("./normalize.js").VERSION);
  const recipes = require("../config/blends.js");
  const configured = recipes.recipes.concat(recipes.candidates || []);
  const labels = Object.fromEntries(configured.map(r=>["blend:"+r.id,r.label]));
  labels["my-forecast"]="Brad / My Forecast";
  const items=[];
  list.forEach(({cap,b})=>{
    const edition=ED.isEdition(cap)?`${loc.id}|${ED.editionId(cap)}`:null;
    Object.keys(b.hourly.temperature_2m || {}).forEach(id=>items.push({edition,key:id.startsWith("blend:")?id:"source:"+id,captureId:cap.captureId,retrievedAt:id.startsWith("blend:")?b.retrieval && b.retrieval.last:b.sourceIssue && b.sourceIssue[id] && b.sourceIssue[id].retrievedAt || b.retrieval && b.retrieval.last,target:cap.slotTarget}));
  });
  const selected=ED.select(items.filter(x=>x.edition));
  const best=OBS.best(U.readJSONLDir(path.join(DATA,"obs",loc.id)));
  const from=nowMs-35*86400e3, observed=[];
  best.forEach((v,k)=>{if(!k.startsWith("temp_hourly|"))return;const valid=+k.split("|")[1]; if(valid<from || !good(v.value) || !good(v.obsAt))return; observed.push({valid,measuredAt:v.obsAt,value:v.value,src:v.src,status:v.status,revised:!!v.revised,seenAt:v.seenAt,rawSha:v.sha});});
  observed.sort((a,b)=>a.valid-b.valid);
  const captures=[], history=[], ids=new Set();
  list.forEach(({cap,b,rel})=>{
    const edition=ED.isEdition(cap)?`${loc.id}|${ED.editionId(cap)}`:null;
    const classes={}, sources={};
    const allIds=new Set([...Object.keys(b.hourly.temperature_2m || {}),...Object.keys(b.sources || {}),...Object.keys(b.blends || {}).map(x=>"blend:"+x)]);
    allIds.forEach(id=>{
      const key=id.startsWith("blend:")?id:"source:"+id, pick=edition && selected.get(`${edition}|${key}|${cap.captureId}`);
      classes[id]=id.startsWith("blend:")&&require("./score.js").retrospective(id.slice(6),cap)?"retrospective":!edition?"pilot":!pick || !pick.selected?"superseded":pick.timeliness.status==="on_time"?"primary":"late";
      const blend=id.startsWith("blend:")?b.blends && b.blends[id.slice(6)]:null;
      sources[id]={label:blend && blend.label || labels[id] || id,hash:blend && blend.configHash || null,requested:blend && blend.requested || null,missing:blend && blend.missing || [],issue:b.sourceIssue && b.sourceIssue[id] || null};
      ids.add(id);
      const daily=blend?blend.values:b.sources && b.sources[id];
      DAILY.forEach(target=>Object.entries(daily && daily[target] || {}).forEach(([date,x])=>{
        if(!good(x.v))return;
        const win=TG.TARGETS[target].window(date,loc);
        const contributors=x.used || (x.ens?[[id,x.ens.n]]:id.startsWith("blend:")?null:[[id,1]]);
        history.push({captureId:cap.captureId,id,target,date,value:x.v,slot:cap.slot,cls:classes[id],retrievedAt:b.retrieval && b.retrieval.last,leadHours:time(b.retrieval && b.retrieval.last)==null?null:(win[0]-time(b.retrieval.last))/3600e3,window:win,hash:blend && blend.configHash || null,contributors,normVersion:b.version,bundle:rel,flags:x.flags || []});
      }));
    });
    const meta={captureId:cap.captureId,localDate:cap.localDate,slot:cap.slot,trigger:cap.trigger,startedAt:cap.startedAt,retrievedAt:b.retrieval && b.retrieval.last,normalizer:b.version,bundle:rel,classes,sources,file:`reports/dashboard/${cap.captureId}.json`};
    U.writeJSON(path.join(base,`${cap.captureId}.json`),{schema:1,...meta,hourly:b.hourly});
    captures.push(meta);
  });
  const personal=res.personal || {entries:[],cases:[],pairs:[],pending:[]};
  U.writeJSON(path.join(DATA,"reports/my-forecast.json"),{version:personal.version||"my-forecast-v1",scorer:personal.scorer||null,receipts:personal.receipts||null,issueTimeRule:"Eligibility, order and lead use receivedAt: GitHub's recorded receipt of the push. submittedAt (commit time) and processedAt (first collector run) are shown but never decide eligibility.",at:U.iso(nowMs),entries:personal.entries,pairs:personal.pairs,pending:personal.pending,excluded:personal.excluded||[]});
  personal.cases.forEach(c=>{history.push({captureId:c.captureId,id:c.id,target:c.target,date:c.date,value:c.v,slot:c.slot,cls:c.cls,retrievedAt:c.issuedAt,leadHours:c.leadHours,window:TG.TARGETS[c.target].window(c.date,loc),hash:null,contributors:null,normVersion:null,basisNormVersion:c.basisNormVersion,receivedAt:c.receivedAt,submittedAt:c.submittedAt,processedAt:c.processedAt,submissionId:c.submissionId,commit:c.commit});if(c.cls==="primary"){const cap=captures.find(x=>x.captureId===c.captureId);if(cap)cap.sources[c.id]={label:labels[c.id]};}});
  const historyFiles={};
  [...new Set(history.map(x=>x.date))].forEach(date=>{const file=`reports/dashboard/history-${date}.json`;historyFiles[date]=file;U.writeJSON(path.join(DATA,file),history.filter(x=>x.date===date));});
  const defaultId="blend:"+U.Core.blend.PREFERRED.id;
  const defaultCaptured=captures.some(c=>c.classes[defaultId]==="primary");
  const dailyPairs=(res.pairs || []).filter(p=>p.cls==="primary" && p.track!=="tv" && DAILY.includes(p.target)).map(p=>({track:p.track,conv:TG.TARGETS[p.target].conv,window:TG.TARGETS[p.target].window(p.date,loc),compatible:p.track==="personal"?p.compatible!==false:true,basisNormVersion:p.basisNormVersion||null,captureId:p.captureId,id:p.track==="blend"?"blend:"+p.id:p.id,target:p.target,date:p.date,lead:p.lead,leadHours:p.leadHours,slot:p.slot,cls:p.cls,v:p.v,o:p.o,normVersion:p.normVersion,obsStatus:p.obsStatus,obsRevised:p.obsRevised,obsSrc:p.obsSrc,flags:p.flags || []}));
  const hourlyPairs=(res.hourlyPairs || []).filter(p=>p.cls==="primary").map(p=>({captureId:p.captureId,id:p.id,valid:p.valid,date:new Date(Date.parse(p.valid)+loc.lstOffsetMin*60e3).toISOString().slice(0,10),leadHours:p.leadHours,lead:Math.ceil(p.leadHours/24),slot:p.slot,cls:p.cls,v:p.v,o:p.o,normVersion:p.normVersion,obsMeasured:p.obsMeasured,leadMin:p.leadMin}));
  const { scorecardPairs, scorecardRows } = writeScorecard(DATA, loc, res, nowMs, slots, labels);
  U.writeJSON(path.join(base,"index.json"),{schema:1,version:VERSION,scorecardFile:"reports/dashboard/scorecard.json",at:U.iso(nowMs),loc,minDates:res.minDates || 30,defaultId,defaultLabel:labels[defaultId] || "Default v2",defaultCaptured,minimumLeadMinutes:TM.MIN_LEAD_MIN,matchToleranceMinutes:TM.MATCH_TOLERANCE_MIN,captures,sourceLabels:labels,observed,historyFiles,dailyPairs,hourlyPairs,pendingDaily:(res.pending || []).filter(p=>DAILY.includes(p.target)),normalizer:res.normVersion,scoreVersion:res.version,missingBundles:U.readJSONL(path.join(DATA,"captures",loc.id+".jsonl")).slice(-40).filter(c=>!captures.some(x=>x.captureId===c.captureId)).map(c=>c.captureId)});
  return {captures:captures.length,observations:observed.length,history:history.length,dailyPairs:dailyPairs.length,hourlyPairs:hourlyPairs.length,scorecardPairs,scorecardRows};
}
/* The comparison covers the scored archive. The separate snapshot list is bounded for the
   tracking and forecast-history views. */
function writeScorecard(DATA, loc, res, nowMs, slots, labels) {
  const daily = ["tmax_clim", "tmin_clim", "tmin_night"];
  const targets = [...daily.map(id => ({ id, label: TG.TARGETS[id].label, conv: TG.TARGETS[id].conv })), TG.HOURLY];
  const captures = U.readJSONL(path.join(DATA, "captures", loc.id + ".jsonl")).filter(ED.isEdition);
  const capIndex = new Map(captures.map((cap, i) => [cap.captureId, i]));
  const attempts = captures.map(cap => ({
    captureId: cap.captureId, edition: ED.editionId(cap), localDate: cap.localDate, slot: cap.slot,
    eligible: ED.lateness(cap.startedAt, cap.slotTarget).status === "on_time",
    sources: Object.keys(cap.sources || {}),
    tv: Object.fromEntries((cap.tv || []).filter(t => t && t.product).map(t => [t.product, t.status || "unknown"])),
  }));
  const tvMeta = Object.fromEntries(require("../config/tv.js").products.map(p => [
    p.id, { label: p.label, location: p.location?.scope, authorship: p.authorship },
  ]));
  const tvVersions = new Map((res.tv || []).map(r => [r.captureId + "|" + r.product, r.extraction?.version || r.extractVersion]));
  const ids = new Map(), norms = new Map(), tracks = {}, rows = [];
  const index = (map, value) => {
    if (!map.has(value)) map.set(value, map.size);
    return map.get(value);
  };
  let scorecardPairs = 0;
  const add = (p, id, track, target, lead, date, norm, validHour = null) => {
    scorecardPairs++;
    const c = capIndex.get(p.captureId);
    if (c == null || U.addDays(attempts[c].localDate, lead) !== date) return;
    tracks[id] = track;
    const row = [index(ids, id), c, target, lead, p.leadHours ?? null, p.v, p.o, index(norms, norm || "unknown")];
    if (validHour != null) row.push(validHour);
    rows.push(row);
  };
  for (const p of res.pairs || []) {
    if (p.cls !== "primary" || !["source", "blend", "tv"].includes(p.track) || !daily.includes(p.target)) continue;
    const id = p.track === "blend" ? "blend:" + p.id : p.id;
    const norm = p.track === "tv" ? "tv:" + (tvVersions.get(p.captureId + "|" + id) || p.extractVersion || "unknown") : p.normVersion;
    add(p, id, p.track, daily.indexOf(p.target), p.lead, p.date, norm);
  }
  for (const p of res.hourlyPairs || []) {
    if (p.cls !== "primary") continue;
    const c = captures[capIndex.get(p.captureId)], valid = Date.parse(p.valid);
    if (!c || !Number.isFinite(valid)) continue;
    const date = new Date(valid + loc.lstOffsetMin * 60e3).toISOString().slice(0, 10);
    const lead = TG.leadDay(c.localDate, date);
    add(p, p.id, p.id.startsWith("blend:") ? "blend" : "source", daily.length, lead, date, p.normVersion, valid / TG.H);
  }
  const verifiedDates = Object.fromEntries(daily.map(t => [t, (res.obsBest || []).filter(o => o.target === t && good(o.value)).map(o => o.date)]));
  const projection = {
    schema: 3, version: "scorecard-v3", at: U.iso(nowMs), loc, minDates: res.minDates || 30, targets,
    sourceLabels: labels, tvMeta, tracks, attempts, verifiedDates,
    slots: slots.map(({ id, status }) => ({ id, status })),
    ids: [...ids.keys()], norms: [...norms.keys()],
    columns: ["id", "capture", "target", "lead", "leadHours", "v", "o", "normVersion", "validHourUtc"],
    rows, droppedInconsistent: scorecardPairs - rows.length,
  };
  // Compact hourly rows keep the authenticated download small as the archive grows.
  fs.writeFileSync(path.join(DATA, "reports", "dashboard", "scorecard.json"), JSON.stringify(projection) + "\n");
  return { scorecardPairs, scorecardRows: rows.length };
}
module.exports={VERSION,bundles,writeDashboard};
