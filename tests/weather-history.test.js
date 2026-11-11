"use strict";
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'..'), context=vm.createContext({window:{}});
for(const file of ['assets/cincinnati-weather-history.js','assets/cincinnati-daily-climate-history.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const stories=context.window.CincinnatiWeatherHistory, records=context.window.CincinnatiDailyClimateHistory;
const ids=new Set();
for(const event of stories) {
 assert.match(event.date,/^\d{4}-\d{2}-\d{2}$/);
 assert.equal(new Date(event.date+'T12:00Z').toISOString().slice(0,10),event.date,'real event date');
 const key=event.date+'|'+event.title;assert.ok(!ids.has(key),'no duplicate story');ids.add(key);
 for(const k of ['title','place','summary','source'])assert.ok(event[k]?.trim(),k);
 for(const link of [{url:event.url},...(event.links||[])])assert.equal(new URL(link.url).protocol,'https:');
 if(event.photo){assert.ok(fs.existsSync(path.join(root,event.photo.src)));assert.ok(event.photo.alt&&event.photo.caption&&event.photo.credit&&event.photo.rights);assert.equal(new URL(event.photo.url).hostname,'www.loc.gov');}
}
const nodes={weatherHistoryCard:{hidden:false},weatherHistoryEntries:{innerHTML:''}};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
Object.assign(context,{$:id=>nodes[id],CLIM:{cincy:true},esc,climateHistoryEntry:r=>({date:r[0],title:'Record fallback',place:'Cincinnati',summary:'Record',url:'https://data.rcc-acis.org/',source:'RCC-ACIS'})});
const source=fs.readFileSync(path.join(root,'assets/almanac.js'),'utf8');
vm.runInContext(source.slice(source.indexOf('  function renderWeatherHistory('),source.indexOf('  function climateHistoryEntry(')),context);
for(let day=new Date('2024-01-01T12:00Z');day<=new Date('2024-12-31T12:00Z');day.setUTCDate(day.getUTCDate()+1)) {
 const date=day.toISOString().slice(0,10), matches=stories.filter(e=>e.date.slice(5)===date.slice(5));context.renderWeatherHistory(date);
 const html=nodes.weatherHistoryEntries.innerHTML;
 if(matches.length){for(const e of matches){assert.ok(html.includes(esc(e.title)));for(const l of e.links||[])assert.ok(html.includes(esc(l.url)));}assert.ok(!html.includes('Record fallback'),'verified stories take priority');}
 else if(records.some(r=>r[0].slice(5)===date.slice(5)))assert.ok(html.includes('Record fallback'),'unfilled day retains its real observation');
}
context.renderWeatherHistory('2026-07-07');assert.ok(nodes.weatherHistoryEntries.innerHTML.includes('July 8, 1915'),'next-day newspaper linked on event anniversary');
context.renderWeatherHistory('2026-03-27');assert.ok(nodes.weatherHistoryEntries.innerHTML.includes('loading="lazy"'));assert.ok(nodes.weatherHistoryEntries.innerHTML.includes('Bain News Service'));
context.renderWeatherHistory('2026-03-28');assert.ok(!nodes.weatherHistoryEntries.innerHTML.includes('cincinnati-flood-1913-bain.jpg'),'photo does not leak to adjacent day');
if(source.includes('if (!CLIM.cincy)')){context.CLIM.cincy=false;context.renderWeatherHistory('2026-07-07');assert.equal(nodes.weatherHistoryCard.hidden,true,'Cincinnati stories stay out of other markets');}
const audit=JSON.parse(fs.readFileSync(path.join(root,'docs/weather-history-calendar-audit.json'),'utf8'));
assert.equal(audit.days.length,366);assert.equal(new Set(audit.days.map(d=>d.monthDay)).size,366);assert.equal(audit.stories,stories.length);
assert.equal(audit.storyDays,new Set(stories.map(e=>e.date.slice(5))).size);
for(const d of audit.days)assert.equal(d.publishedStories.length,stories.filter(e=>e.date.slice(5)===d.monthDay).length);
console.log(`PASS: ${stories.length} sourced stories, ${audit.storyDays} story dates, all 366 calendar selections, archive links, photo credits and record fallback`);
