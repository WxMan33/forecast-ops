/* Selected-date skywatching and calendar export. No orbital propagation or visibility claims are inferred. */
(function(root){'use strict';
const DAY=86400000,ZONE='America/New_York';
function issDay(feed,date,now=Date.now()){
 if(!feed||feed.schema!==1||!Array.isArray(feed.passes)||feed.location?.timeZone!==ZONE||!/^https:\/\/iss-sts\.hqmce\.nasa\.gov\//.test(feed.source||''))return {status:'unavailable',passes:[],upcoming:[]};
 const at=Date.parse(feed.retrievedAt);if(!Number.isFinite(at)||at>now+300000)return {status:'unavailable',passes:[],upcoming:[]};
 if(now-at>3*DAY)return {status:'stale',passes:[],upcoming:[]};
 if(date<feed.from||date>feed.through)return {status:'outside',passes:[],upcoming:[]};
 const passes=feed.passes.filter(p=>p.date===date),end=new Date(Date.parse(date+'T12:00Z')+7*DAY).toISOString().slice(0,10);
 return {status:'ready',passes,next:feed.passes.find(p=>p.date>=date&&Date.parse(p.start)>=now)||null,upcoming:feed.passes.filter(p=>p.date>date&&p.date<end),through:feed.through};
}
function skyDay(catalog,date){
 const reviewed=catalog&&date>=catalog.reviewedFrom&&date<=catalog.reviewedThrough;
 return {reviewed:!!reviewed,events:reviewed?catalog.events.filter(e=>e.from<=date&&e.to>=date):[],upcoming:reviewed?catalog.events.filter(e=>e.from>date).sort((a,b)=>a.from.localeCompare(b.from)).slice(0,3):[]};
}
function calendar(pass,now=Date.now()){
 const clean=s=>String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const encoder=new TextEncoder();const fold=line=>{let out='',n=0;for(const ch of line){const len=encoder.encode(ch).length;if(n+len>75){out+='\r\n ';n=1;}out+=ch;n+=len;}return out;};
 const utc=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
 const start=Date.parse(pass.start);if(!Number.isFinite(start))throw Error('Invalid pass time');
 const text=`NASA Cincinnati viewing opportunity. Duration ${pass.duration}; maximum elevation ${pass.maxElevation}°. Appears ${pass.appears.elevation}° above ${pass.appears.direction}; disappears ${pass.disappears.elevation}° above ${pass.disappears.direction}. Rounded prediction, not guaranteed visibility; check for updates and clouds.`;
 // NASA durations are rounded; DTEND is a calendar block, not a computed disappearance instant.
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Forecast Ops//Cincinnati Skywatch//EN','BEGIN:VEVENT','UID:'+clean(pass.id)+'@forecast-ops','DTSTAMP:'+utc(now),'DTSTART:'+utc(start),'DTEND:'+utc(start+Math.max(1,pass.durationMinutes)*60000),'SUMMARY:ISS viewing opportunity · Cincinnati','LOCATION:Cincinnati Ohio','DESCRIPTION:'+clean(text),'URL:https://www.nasa.gov/spot-the-station/','BEGIN:VALARM','TRIGGER:-PT15M','ACTION:DISPLAY','DESCRIPTION:ISS viewing opportunity in 15 minutes; check the latest schedule.','END:VALARM','END:VEVENT','END:VCALENDAR',''].map(fold).join('\r\n');
}
const api={issDay,skyDay,calendar};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AstronomyCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
