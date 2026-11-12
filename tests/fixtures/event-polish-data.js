/* Synthetic guidance for layout checks only. Real engines and the full event page render it. */
(function(){
const delta=new URLSearchParams(location.search).has("delta");
const C=OpsCore,S=BetaStory,H=3600e3,tz="America/New_York",now=Date.parse(new URLSearchParams(location.search).has("live")?"2026-11-12T19:30Z":"2026-11-11T20:30Z")+(delta?3600e3:0),t0=Date.parse("2026-11-12T14:00Z");
const ms=Array.from({length:96},(_,i)=>t0+i*H), h={};
["temperature_2m","apparent_temperature","precipitation_probability","precipitation","wind_speed_10m","wind_gusts_10m","snowfall"].forEach(k=>h[k]=[]);
const gaps=new URLSearchParams(location.search).has("gaps");
ms.forEach((m,i)=>{const hour=+C.time.toLocal(m,tz).slice(11,13),v={temperature_2m:Math.max(43,57-hour*.5),apparent_temperature:Math.max(39,53-hour*.5),precipitation_probability:hour>=16&&hour<=21?30:hour>=12?15:3,precipitation:hour>=12&&hour<17?.025:hour===18?.002:0,wind_speed_10m:10,wind_gusts_10m:delta?40:20,snowfall:0};Object.keys(h).forEach(k=>h[k].push(gaps&&hour===14?null:v[k]))});
const B={ms,times:ms.map(m=>C.time.toLocal(m,tz)),tz,models:{gfs_seamless:{h,d:{}}},viewedAt:now};
const NW={ok:true,office:"ILN",gridX:36,gridY:37,periods:[{s:t0,e:t0+15*H,name:"Thursday",short:"Chance of rain",temp:54,pop:30},{s:t0+15*H,e:t0+24*H,name:"Thursday night",short:"A chance of showers before midnight",temp:43,pop:30},{s:t0+24*H,e:t0+40*H,name:"Friday",short:"Mostly cloudy",temp:54,pop:15}],hourly:[]};
const ctx=S.context({C,T:ModelTrends,B,ws:{gfs_seamless:1},rules:null,nws:NW,now});ctx.th={at:()=>"normal",perModel:()=>null,ids:[]};
const long=new URLSearchParams(location.search).has("long");
const ev=EventStore.saveEvent({id:"ev_layout",name:"Riverfront Music Night",loc:{name:"Sawyer Point, Cincinnati, OH",lat:39.1005,lon:-84.5017},tz,times:{setup:"2026-11-12T12:00",gates:"2026-11-12T16:30",start:"2026-11-12T17:00",end:long?"2026-11-14T22:00":"2026-11-12T22:00",teardown:long?"2026-11-15T00:00":"2026-11-13T00:00"},gust:25});
history.replaceState(null,"","?ev="+ev.id);
BetaUI.load=async()=>({ctx,NW,RB:{},problems:[],feeds:{used:["GFS"],missing:[{name:"HRRR",why:"fixture"},{name:"ECMWF ENS",why:"fixture"}]},market:{tuned:true},recipe:"Cincinnati-tuned blend",verified:"Synthetic layout fixture — not a live forecast."});
BetaUI.alerts=async()=>[];BetaUI.timeline=()=>{};BetaUI.mapPanel=el=>el.innerHTML='<p class="bx-note">Map imagery is omitted from this offline layout check.</p>';
})();
