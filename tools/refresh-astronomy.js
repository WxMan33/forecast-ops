/* NASA's city sightings table is the prediction source; this is a parser, not an orbital model. */
'use strict';
const C=require('../assets/ops-core.js'),crypto=require('node:crypto'),fs=require('node:fs');
const SOURCE='https://iss-sts.hqmce.nasa.gov/iss-sts-cities-html/United_States-Ohio-Cincinnati.html';
const TZ='America/New_York',DAY=86400000;
const clean=s=>s.replace(/<[^>]+>/g,' ').replace(/&deg;|&#176;/g,'°').replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function parse(html,at=Date.now(),lastModified=null){
 if(!html.includes('Sightings Location: United States, Ohio, Cincinnati'))throw Error('NASA location does not match Cincinnati');
 if(!['Date','Visible','Max Height','Appears','Disappears'].every(s=>html.includes('>'+s+'<')))throw Error('NASA table format changed');
 const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const year=+C.time.toLocal(at,TZ).slice(0,4),rows=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(x=>[...x[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>clean(x[1]))).filter(x=>x.length);
 if(!rows.length)throw Error('No parseable sightings; keep previous feed rather than invent a clear schedule');
 const passes=rows.map((r,index)=>{
  if(r.length!==5)throw Error('Unexpected NASA column count');
  const m=/^(\w{3}) (\w{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(r[0]);
  if(!m||!months.includes(m[2])||+m[4]<1||+m[4]>12||+m[5]>59)throw Error('Invalid NASA date/time');
  const md=String(months.indexOf(m[2])+1).padStart(2,'0')+'-'+m[3].padStart(2,'0');
  const dates=[year-1,year,year+1].map(y=>`${y}-${md}`).filter(d=>new Date(d+'T12:00Z').toISOString().slice(0,10)===d);
  const date=dates.sort((a,b)=>Math.abs(Date.parse(a+'T12:00Z')-at)-Math.abs(Date.parse(b+'T12:00Z')-at))[0];
  if(!date||Math.abs(Date.parse(date+'T12:00Z')-at)>45*DAY||weekdays[new Date(date+'T12:00Z').getUTCDay()]!==m[1])throw Error('NASA date outside supported year-inference window');
  const h=(+m[4]%12)+(m[6]==='PM'?12:0),label=`${date}T${String(h).padStart(2,'0')}:${m[5]}`,start=C.time.toUtc(label,TZ);
  // Reject DST ambiguity/nonexistent wall times instead of silently choosing an instant.
  if(C.time.toLocal(start,TZ).slice(0,16)!==label||C.time.toLocal(start+3600000,TZ).slice(0,16)===label||C.time.toLocal(start-3600000,TZ).slice(0,16)===label)throw Error('Ambiguous NASA local time');
  const duration=/^(<\s*)?(\d+) min$/.exec(r[1]),max=/^(\d+)°$/.exec(r[2]);
  const direction=s=>{const m=/^(\d+)° above (N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW)$/.exec(s);if(!m||+m[1]>90)throw Error('Invalid direction');return {elevation:+m[1],direction:m[2]};};
  if(!duration||+duration[2]>20||+duration[2]<1||!max||+max[1]>90)throw Error('Invalid pass values');
  return {id:`iss-cincinnati-${start}`,date,start:new Date(start).toISOString(),duration:r[1],durationMinutes:+duration[2],durationLessThan:!!duration[1],maxElevation:+max[1],appears:direction(r[3]),disappears:direction(r[4])};
 }).sort((a,b)=>a.start.localeCompare(b.start));
 if(new Set(passes.map(p=>p.id)).size!==passes.length)throw Error('Duplicate NASA passes');
 if(passes.at(-1).date<C.time.toLocal(at,TZ).slice(0,10))throw Error('NASA table contains only past dates');
 return {schema:1,location:{name:'Cincinnati, Ohio',timeZone:TZ},retrievedAt:new Date(at).toISOString(),sourceLastModified:lastModified,source:SOURCE,sourceHash:crypto.createHash('sha256').update(html).digest('hex'),dateYearInferred:true,from:passes[0].date,through:passes.at(-1).date,passes};
}
async function main(){const r=await fetch(SOURCE,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('NASA HTTP '+r.status);const html=await r.text();const feed=parse(html,Date.now(),r.headers.get('last-modified'));fs.mkdirSync('feeds',{recursive:true});fs.writeFileSync('feeds/iss-cincinnati.json',JSON.stringify(feed,null,2)+'\n');console.log(`${feed.passes.length} NASA sightings; listed dates ${feed.from}–${feed.through}`);}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={parse,SOURCE};
