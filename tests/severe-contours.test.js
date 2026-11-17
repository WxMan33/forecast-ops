const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({});
for(const file of ['d3-array-3.2.4.js','d3-contour-4.0.2.js','d3-delaunay-6.0.4.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/vendor',file),'utf8'),context);
const G=require('../assets/severe-research-contours.js')(context.d3);
const read=file=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',file)));

// Geometry helpers kept independent of the renderer.
function inRing(pt,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)c=!c;}return c;}
function signedArea(ring){let a=0;for(let i=0;i<ring.length-1;i++)a+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];return a/2;}
// Bucket every band piece by bounding box so each lookup touches only nearby pieces.
function index(fc){const cell=.25,buckets=new Map(),bands=new Map();
  for(const f of fc.features){const b=G.BANDS.findIndex(x=>x[0]===f.properties.threshold);bands.set(b,true);
    for(const poly of f.geometry.coordinates){const ring=poly[0];let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const [x,y] of ring){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      for(let i=Math.floor(x0/cell);i<=Math.floor(x1/cell);i++)for(let j=Math.floor(y0/cell);j<=Math.floor(y1/cell);j++){const k=i+','+j;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push([b,ring]);}}}
  return pt=>{let best=-1;for(const [b,ring] of buckets.get(Math.floor(pt[0]/cell)+','+Math.floor(pt[1]/cell))||[])if(b>best&&inRing(pt,ring))best=b;return best;};}
const near=(p,threshold)=>G.BANDS.some(([t])=>Math.abs(p-t)<1e-7);

// Every sample must lie in its own band: probe just inside each incident valid triangle.
function faithful(name,grid,values,m){
  const shown=index(G.contours(m,values)),T=m.triangles,incident=new Map();
  for(let t=0;t<T.length;t+=3)for(let k=0;k<3;k++){if(!incident.has(T[t+k]))incident.set(T[t+k],[]);incident.get(T[t+k]).push(t);}
  let checked=0,edge=0;
  for(let i=0;i<grid.length;i++){
    const p=values[i];if(!G.valid(p)||near(p))continue;
    for(const t of incident.get(i)||[]){
      const ids=[T[t],T[t+1],T[t+2]];if(!ids.every(j=>G.valid(values[j])))continue;
      const c=[0,1].map(a=>ids.reduce((s,j)=>s+grid[j][a],0)/3),probe=[grid[i][0]+(c[0]-grid[i][0])*1e-6,grid[i][1]+(c[1]-grid[i][1])*1e-6];
      assert.equal(shown(probe),G.band(p),`${name}: sample ${i} (${(p*100).toFixed(3)}% at ${grid[i]}) is drawn in the wrong band`);
      checked++;if(incident.get(i).length<6)edge++;break;
    }
  }
  return{checked,edge};
}

// Small synthetic grid: a linear field must be reproduced exactly.
const grid=[[-85,39],[-84.9,39],[-84.8,39],[-85,39.1],[-84.9,39.1],[-84.8,39.1],[-85,39.2],[-84.9,39.2],[-84.8,39.2]];
const m=G.mesh(grid);
const values=grid.map(p=>(p[0]+85)*.5),before=JSON.stringify(values);
const fills=G.contours(m,values),lines=G.isolines(m,values);
assert.equal(JSON.stringify(values),before,'display contouring must not mutate source values');
for(const f of fills.features)for(const poly of f.geometry.coordinates)for(const ring of poly){
  assert.deepEqual(ring[0],ring[ring.length-1]);assert(signedArea(ring)>0,'rings must be counterclockwise for vector tiling');
  for(const [lon,lat] of ring)assert(lon>=-85-1e-12&&lon<=-84.8+1e-12&&lat>=39-1e-12&&lat<=39.2+1e-12);
}
for(const f of lines.features)for(const [lon] of f.geometry.coordinates)assert(Math.abs((lon+85)*.5-f.properties.threshold)<1e-12,'isolines lie exactly on their threshold');
const shown=index(fills);
for(let k=0;k<400;k++){const pt=[-85+.2*((k*37%400)+.5)/400,39+.2*((k*91%400)+.5)/400],v=(pt[0]+85)*.5;if(!near(v))assert.equal(shown(pt),G.band(v),'interior points match the linear field');}
faithful('synthetic',grid,values,m);

assert.equal(G.blend('#ffffff','#000000',.3),'rgb(77,77,77)');assert.equal(G.blend('#35852a','#ffffff',1),'rgb(53,133,42)');
assert.equal(G.color(null),null);assert.equal(G.color(0),null);assert.equal(G.color(.0009),null);assert.equal(G.color(.001),'#cfd8de');assert.equal(G.color(.019),'#a3adb5');assert.equal(G.color(.02),'#35852a');assert.equal(G.color(.15),'#ed3026');
assert.notEqual(G.BANDS[0][1].toLowerCase(),'#f1f1f1','the lowest band must differ from the light basemap');
assert.equal(G.contours(m,Array(9).fill(null)).features.length,0,'no contours from unavailable data');
assert.equal(G.contours(m,Array(9).fill(0)).features.length,0,'zero is valid but below the display threshold');
assert.equal(G.isolines(m,Array(9).fill(null)).features.length,0);
assert.throws(()=>G.contours(m,[]));assert.throws(()=>G.isolines(m,[]));
const missing=values.slice();missing[4]=null;
for(const f of G.contours(m,missing).features)for(const poly of f.geometry.coordinates)for(const [x,y] of poly[0])assert(Math.hypot(x+84.9,y-39.1)>1e-9,'missing source vertices cannot be treated as zero or bridged');
assert.equal(G.contours(G.mesh([[-85,39],[-84,39],[-85,40]]),[.5,.5,.5]).features.length,0,'do not bridge geographic gaps');

// Archived historical case: same guarantees on the native grid.
const native=read('assets/severe-research/grid.json').coordinates,archived=read('assets/severe-research/2024-05-15.json').probabilities.wind;
const real=G.mesh(native),historical=G.contours(real,archived);
assert(historical.features.some(f=>f.properties.threshold===.45));
const top=Math.max(...archived.filter(G.valid));assert(!historical.features.some(f=>f.properties.threshold>top),'no band above the largest sample');
const h=faithful('historical 2024-05-15 wind',native,archived,real);

// Committed daily feed: every product, including samples on the domain edge.
const dailyGrid=read('assets/severe-daily/grid.json').coordinates,dailyMesh=G.mesh(dailyGrid);
let total=0,edges=0;
for(const run of read('assets/severe-daily/index.json').runs)for(const [hazard,v] of Object.entries(read('assets/severe-daily/'+run.file).probabilities)){
  const r=faithful(`${run.file} ${hazard}`,dailyGrid,v,dailyMesh);total+=r.checked;edges+=r.edge;
  let peak=0;v.forEach((p,i)=>{if(p>v[peak])peak=i;});
  if(v[peak]>=.001&&!near(v[peak]))assert(r.checked>0);
}
assert(edges>0,'domain-edge samples must be covered');
console.log(`Severe contours: exact linear bands, gaps, missing data, winding, visible lowest band; ${h.checked} archived and ${total} daily samples (${edges} on the domain edge) drawn in their own band`);
