/* Personal forecast schema and validation, shared by the browser and archive scorer. */
(function(root){'use strict';
const VERSION='my-forecast-v1',targets={lo:'tmin_clim',hi:'tmax_clim',precip:'precip_clim'};
function validate(r,issuedMs,lstOffsetMin=-300){
 const errors=[];if(!r||r.schema!==1||r.method!==VERSION||r.location!=='CVG')return ['Unsupported forecast format or location.'];
 if(!/^[a-zA-Z0-9-]{10,80}$/.test(r.id||''))errors.push('Invalid forecast ID.');
 if(!Number.isFinite(issuedMs))errors.push('Issue time is unavailable.');
 if(!r.basis||!r.basis.captureId||!r.basis.recipeId||!r.basis.bundle||!r.basis.hash||!r.basis.normalizer)errors.push('A traceable blend snapshot is required.');
 if(typeof r.note!=='string'||r.note.length>2000)errors.push('Keep notes under 2,000 characters.');
 if(!Array.isArray(r.days)||!r.days.length||r.days.length>14)return errors.concat('Enter between 1 and 14 forecast days.');
 const dates=new Set();let values=0;
 r.days.forEach(d=>{if(!d||typeof d!=='object'){errors.push('Invalid forecast day.');return;}if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date||'')||(!Number.isFinite(Date.parse(d.date+'T00:00:00Z'))||new Date(d.date+'T00:00:00Z').toISOString().slice(0,10)!==d.date)){errors.push('Invalid valid date.');return;}
  if(dates.has(d.date))errors.push('Each valid date may appear only once.');dates.add(d.date);
  const start=Date.parse(d.date+'T00:00:00Z')-lstOffsetMin*60000;
  if(start<issuedMs+3600000)errors.push(d.date+': the full climate day must begin at least 60 minutes after saving.');
  if(start>issuedMs+15*86400000)errors.push(d.date+': outside the 14-day forecast horizon.');
  Object.keys(targets).forEach(k=>{const x=d[k];if(x==null)return;values++;if(typeof x!=='number'||!Number.isFinite(x)||(k==='precip'?(x<0||x>50):(x < -100||x>150)))errors.push(d.date+': invalid '+k+'.');});
  if(d.hi!=null&&d.lo!=null&&d.lo>d.hi)errors.push(d.date+': low cannot exceed high.');
 });if(!values)errors.push('Enter at least one forecast value.');return errors;
}
const api={VERSION,targets,validate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MyForecastCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
