/* Private dashboard projections. Reads archived bundles; never captures or changes forecasts. */
"use strict";
const fs = require("fs"), path = require("path");
const U = require("./util.js"), ED = require("./editions.js"), OBS = require("./obs.js"), TG = require("./targets.js"), TM = require("./timing.js");
const VERSION = "dashboard-v1";
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

function writeDashboard(DATA, loc, res, nowMs = Date.now()) {
  const base = path.join(DATA,"reports","dashboard"); U.mkdirp(base);
  const list = bundles(DATA,loc,res.normVersion || require("./normalize.js").VERSION);
  const recipes = require("../config/blends.js");
  const configured = recipes.recipes.concat(recipes.candidates || []);
  const labels = Object.fromEntries(configured.map(r=>["blend:"+r.id,r.label]));
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
      classes[id]=!edition?"pilot":!pick || !pick.selected?"superseded":pick.timeliness.status==="on_time"?"primary":"late";
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
  const historyFiles={};
  [...new Set(history.map(x=>x.date))].forEach(date=>{const file=`reports/dashboard/history-${date}.json`;historyFiles[date]=file;U.writeJSON(path.join(DATA,file),history.filter(x=>x.date===date));});
  const defaultId="blend:"+U.Core.blend.PREFERRED.id;
  const defaultCaptured=captures.some(c=>c.classes[defaultId]==="primary");
  const dailyPairs=(res.pairs || []).filter(p=>p.cls==="primary" && p.track!=="tv" && DAILY.includes(p.target)).map(p=>({captureId:p.captureId,id:p.track==="blend"?"blend:"+p.id:p.id,target:p.target,date:p.date,lead:p.lead,leadHours:p.leadHours,slot:p.slot,cls:p.cls,v:p.v,o:p.o,normVersion:p.normVersion,obsStatus:p.obsStatus,obsRevised:p.obsRevised,obsSrc:p.obsSrc,flags:p.flags || []}));
  const hourlyPairs=(res.hourlyPairs || []).filter(p=>p.cls==="primary").map(p=>({captureId:p.captureId,id:p.id,valid:p.valid,date:new Date(Date.parse(p.valid)+loc.lstOffsetMin*60e3).toISOString().slice(0,10),leadHours:p.leadHours,lead:Math.ceil(p.leadHours/24),slot:p.slot,cls:p.cls,v:p.v,o:p.o,normVersion:p.normVersion,obsMeasured:p.obsMeasured,leadMin:p.leadMin}));
  U.writeJSON(path.join(base,"index.json"),{schema:1,version:VERSION,at:U.iso(nowMs),loc,minDates:res.minDates || 30,defaultId,defaultLabel:labels[defaultId] || "Default v2",defaultCaptured,minimumLeadMinutes:TM.MIN_LEAD_MIN,matchToleranceMinutes:TM.MATCH_TOLERANCE_MIN,captures,sourceLabels:labels,observed,historyFiles,dailyPairs,hourlyPairs,pendingDaily:(res.pending || []).filter(p=>DAILY.includes(p.target)),normalizer:res.normVersion,scoreVersion:res.version,missingBundles:U.readJSONL(path.join(DATA,"captures",loc.id+".jsonl")).slice(-40).filter(c=>!captures.some(x=>x.captureId===c.captureId)).map(c=>c.captureId)});
  return {captures:captures.length,observations:observed.length,history:history.length,dailyPairs:dailyPairs.length,hourlyPairs:hourlyPairs.length};
}
module.exports={VERSION,bundles,writeDashboard};
