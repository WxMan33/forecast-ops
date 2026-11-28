// Emit the CONUS preview's per-triangle contour fills and isolines for one case, using the viewer's own
// contour code (assets/severe-research-contours.js) and vendored d3-delaunay. Usage: node tools/conus-contours-raw.js CASE.json OUT.json
const fs=require('fs'),vm=require('vm'),path=require('path');const root=path.resolve(__dirname,'..');
const ctx={};ctx.globalThis=ctx;ctx.window=ctx;ctx.self=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'assets/vendor/d3-delaunay-6.0.4.js'),'utf8'),ctx);
const factory=require(path.join(root,'assets/severe-research-contours.js'));const G=factory(ctx.d3);
const grid=JSON.parse(fs.readFileSync(path.join(root,'assets/severe-conus/grid.json'))).coordinates;
const c=JSON.parse(fs.readFileSync(process.argv[2]));const mesh=G.mesh(grid);const v=c.probabilities.wind;
fs.writeFileSync(process.argv[3],JSON.stringify({fills:G.contours(mesh,v),lines:G.isolines(mesh,v)}));
