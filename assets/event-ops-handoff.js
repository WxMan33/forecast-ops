/* Only venue and schedule cross into OPE. Forecast threats and resumption rules never do. */
(function(root){
'use strict';
const KEY='forecast_ops_monitoring_address_v1';
function baseAddress(value){try{const u=new URL(value);if(u.username||u.password||u.search||u.hash)return null;if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))return null;return u.href.replace(/\/$/,'')}catch{return null}}
function payload(ev,b,now){const main=b.phases.find(p=>p.key==='event')||b.all;return {version:1,type:'forecast-ops/venue',venue:{name:ev.loc.name,lat:ev.loc.lat,lon:ev.loc.lon,tz:ev.tz},event:{name:ev.name,start:new Date(main.startMs).toISOString(),end:new Date(main.endMs).toISOString()},issuedAt:new Date(now).toISOString()}}
function link(base,data){const address=baseAddress(base);if(!address)return null;return address+'/forecast-event#'+new URLSearchParams({handoff:JSON.stringify(data)}).toString()}
function eventDay(ev,b,now){if(now>=b.all.endMs)return false;return now>=b.all.startMs-2*3600e3||new Date(now).toLocaleDateString('en-CA',{timeZone:ev.tz})===new Date(b.all.startMs).toLocaleDateString('en-CA',{timeZone:ev.tz})}
function venueText(data){return `${data.venue.name}\nLatitude: ${data.venue.lat}\nLongitude: ${data.venue.lon}\nTime zone: ${data.venue.tz}\n${data.event.name}\n${data.event.start} to ${data.event.end}`}
const api={KEY,baseAddress,payload,link,eventDay,venueText};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.EventOpsHandoff=api;
})(typeof globalThis!=='undefined'?globalThis:this);
