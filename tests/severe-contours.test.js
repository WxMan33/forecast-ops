const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({});
for(const file of ['d3-array-3.2.4.js','d3-contour-4.0.2.js','d3-delaunay-6.0.4.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/vendor',file),'utf8'),context);
const G=require('../assets/severe-research-contours.js')(context.d3);
const grid=[[-85,39],[-84.9,39],[-84.8,39],[-85,39.1],[-84.9,39.1],[-84.8,39.1],[-85,39.2],[-84.9,39.2],[-84.8,39.2]];
const m=G.mesh(grid,{west:-85,east:-84.8,south:39,north:39.2,step:.025});
const values=grid.map(p=>(p[0]+85)*.5),before=JSON.stringify(values);
const field=G.raster(m,values);
for(let y=0;y<m.ny;y++)for(let x=0;x<m.nx;x++)if(Number.isFinite(field[y*m.nx+x]))assert(Math.abs(field[y*m.nx+x]-x*.025*.5)<1e-10);
assert.equal(JSON.stringify(values),before,'display interpolation must not mutate source values');
assert.equal(G.blend('#ffffff','#000000',.3),'rgb(77,77,77)');assert.equal(G.blend('#35852a','#ffffff',1),'rgb(53,133,42)');assert.equal(G.color(null),null);assert.equal(G.color(0),null);assert.equal(G.color(.019),'#d5d5d5');assert.equal(G.color(.02),'#35852a');assert.equal(G.color(.15),'#ed3026');
const geometry=G.contours(m,values);
assert(geometry.features.length>0);
for(const f of geometry.features)for(const poly of f.geometry.coordinates)for(const ring of poly){
 assert.deepEqual(ring[0],ring[ring.length-1]);
 for(const [lon,lat] of ring){assert(lon>=-85&&lon<=-84.8&&lat>=39&&lat<=39.2);assert(Number.isFinite(lon)&&Number.isFinite(lat));}
}
assert.equal(G.contours(m,Array(9).fill(null)).features.length,0,'no contours from unavailable data');
assert.equal(G.contours(m,Array(9).fill(0)).features.length,0,'zero is valid but below the display threshold');
assert.throws(()=>G.raster(m,[]));
const missing=values.slice();missing[4]=null;const masked=G.raster(m,missing);
for(let i=0;i<masked.length;i++)if([m.indices[i*3],m.indices[i*3+1],m.indices[i*3+2]].includes(4))assert(Number.isNaN(masked[i]),'missing source vertices cannot be treated as zero');
const far=G.mesh([[-85,39],[-84,39],[-85,40]],{west:-85,east:-84,south:39,north:40,step:.1});
assert(Array.from(G.raster(far,[.5,.5,.5])).every(Number.isNaN),'do not bridge geographic gaps');
const native=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/severe-research/grid.json'))).coordinates;
const sample=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/severe-research/2024-05-15.json'))).probabilities.wind;
const real=G.mesh(native),r=G.raster(real,sample),v=r.filter(Number.isFinite);
assert(v.length>90000&&v.length<r.length);
assert(Math.max(...v)<=Math.max(...sample)+1e-12,'linear interpolation must not create a new probability maximum');
assert(G.contours(real,sample).features.some(f=>f.properties.threshold===.45));
console.log('Severe contours: linear field, probability bands, gaps, missing data and archived-grid checks passed');
