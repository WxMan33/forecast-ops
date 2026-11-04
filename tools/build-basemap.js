#!/usr/bin/env node
/* Builds assets/maps/basemap.json for the model maps from public-domain / openly licensed sources:
     counties, states        us-atlas 3.0.1 (US Census cartographic boundaries, 1:10m; ISC)
     roads, rivers, lakes,   Natural Earth 10m v5.1.2 (public domain), from
     populated places        github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson
     towns (pop >= 5,000)    GeoNames cities1000 (CC BY 4.0) via the all-the-cities 3.1.0 npm package
   Clipped to the Ohio Valley extent so the same file serves every preset. The Cincinnati DMA outline
   is the union of the counties listed in DMA_COUNTIES (Nielsen assigns DMAs by county; the list is
   recorded in the output so it can be checked and corrected).
   Usage: node tools/build-basemap.js <dir with ne_10m_*.geojson> <us-atlas dir> <all-the-cities module dir> */
"use strict";
const fs = require("fs"), path = require("path");
const [NE, ATLAS, TOWNS] = process.argv.slice(2);
const topo = require(require.resolve("topojson-client", { paths: [path.join(ATLAS, "..", "..")] }));
const BOX = { w: -90.5, e: -79.5, s: 35.5, n: 42.5 };
const DMA_COUNTIES = { name: "Cincinnati DMA", note: "county-based outline; verify against the current Nielsen county list",
  fips: ["39001", "39015", "39017", "39025", "39027", "39061", "39071", "39165", "21015", "21023", "21037", "21077", "21081", "21117", "21161", "21187", "21191", "21201", "18029", "18047", "18115", "18137", "18155"] };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const inBox = ([x, y]) => x >= BOX.w && x <= BOX.e && y >= BOX.s && y <= BOX.n;
function clipLines(lines) { const out = []; lines.forEach((ln) => { let cur = []; ln.forEach((p) => { if (inBox(p)) cur.push([r4(p[0]), r4(p[1])]); else { if (cur.length > 1) out.push(cur); cur = []; } }); if (cur.length > 1) out.push(cur); }); return out; }
const linesOf = (g) => (!g ? [] : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : []);
const fc = (features) => ({ type: "FeatureCollection", features });
const read = (f) => JSON.parse(fs.readFileSync(path.join(NE, f + ".geojson"), "utf8")).features;
const C = JSON.parse(fs.readFileSync(path.join(ATLAS, "counties-10m.json"))), S = JSON.parse(fs.readFileSync(path.join(ATLAS, "states-10m.json")));
const lineFeat = (props, lines) => lines.length ? [{ type: "Feature", properties: props, geometry: { type: "MultiLineString", coordinates: lines } }] : [];
const counties = lineFeat({ kind: "county" }, clipLines(linesOf(topo.mesh(C, C.objects.counties, (a, b) => a !== b && Math.floor(a.id / 1000) === Math.floor(b.id / 1000)))));
const states = lineFeat({ kind: "state" }, clipLines(linesOf(topo.mesh(S, S.objects.states, (a, b) => a !== b))));
/* roads: Natural Earth highway classes, kept with their route labels (e.g. I-71) */
const roads = read("ne_10m_roads").filter((f) => f.properties.sov_a3 === "USA" && /Major Highway|Secondary Highway/.test(f.properties.type))
  .flatMap((f) => lineFeat({ kind: f.properties.type === "Major Highway" ? "major" : "secondary", label: f.properties.label || f.properties.name || null, expressway: f.properties.expressway === 1 }, clipLines(linesOf(f.geometry))));
const rivers = [...read("ne_10m_rivers_lake_centerlines"), ...read("ne_10m_rivers_north_america")]
  .flatMap((f) => lineFeat({ kind: "river", name: f.properties.name || null, rank: f.properties.scalerank ?? 9 }, clipLines(linesOf(f.geometry))));
const places = read("ne_10m_populated_places_simple").filter((f) => f.properties.adm0_a3 === "USA" && inBox(f.geometry.coordinates))
  .map((f) => ({ type: "Feature", properties: { kind: "city", name: f.properties.name, pop: f.properties.pop_max || 0, rank: f.properties.scalerank ?? 10 }, geometry: { type: "Point", coordinates: f.geometry.coordinates.map(r4) } }))
  ;
/* towns so the closest (DMA) view has places to read; skipped where Natural Earth already has the same name nearby */
const near = (a, b) => Math.abs(a[0] - b[0]) < 0.15 && Math.abs(a[1] - b[1]) < 0.12;
require(TOWNS).filter((c) => c.country === "US" && c.population >= 5000 && c.featureCode !== "PPLX" && inBox(c.loc.coordinates))
  .forEach((c) => { const xy = c.loc.coordinates.map(r4); if (places.some((f) => f.properties.name === c.name && near(f.geometry.coordinates, xy))) return;
    places.push({ type: "Feature", properties: { kind: "town", name: c.name, pop: c.population, rank: 11, src: "geonames" }, geometry: { type: "Point", coordinates: xy } }); });
places.sort((a, b) => b.properties.pop - a.properties.pop);
const dmaGeoms = C.objects.counties.geometries.filter((g) => DMA_COUNTIES.fips.includes(String(g.id).padStart(5, "0")));
const dma = { type: "Feature", properties: { kind: "dma", name: DMA_COUNTIES.name, note: DMA_COUNTIES.note, counties: dmaGeoms.length }, geometry: topo.merge(C, dmaGeoms) };
const xs = dma.geometry.coordinates.flat(2).map((p) => p[0]), ys = dma.geometry.coordinates.flat(2).map((p) => p[1]);
const out = { version: "basemap-v1", box: BOX, sources: { boundaries: "us-atlas 3.0.1 (US Census cartographic boundaries 1:10m, ISC)", features: "Natural Earth 10m v5.1.2 (public domain)", towns: "GeoNames (CC BY 4.0) via all-the-cities 3.1.0" },
  dma: { ...DMA_COUNTIES, bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], found: dmaGeoms.length },
  layers: { counties: fc(counties), states: fc(states), roads: fc(roads), rivers: fc(rivers), places: fc(places), dma: fc([dma]) } };
fs.writeFileSync(path.join(__dirname, "..", "assets", "maps", "basemap.json"), JSON.stringify(out));
console.log(`counties ${counties.length} states ${states.length} roads ${roads.length} rivers ${rivers.length} places ${places.length} dma counties ${dmaGeoms.length}/${DMA_COUNTIES.fips.length} bounds ${JSON.stringify(out.dma.bounds.map((p) => p.map((x) => x.toFixed(2))))} size ${fs.statSync(path.join(__dirname, "..", "assets", "maps", "basemap.json")).size}`);
