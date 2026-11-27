#!/usr/bin/env node
/* Builds assets/maps/basemap-conus.json for the full-CONUS model maps (beta) from openly licensed sources:
     state lines             us-atlas 3.0.1 (US Census cartographic boundaries, 1:10m; ISC)
     coastline, borders      world-atlas 2.0.2 (Natural Earth 1:50m, public domain)
     lakes                   Natural Earth 50m lakes v5.1.2 (public domain)
     cities                  Natural Earth 10m populated places v5.1.2 (public domain)
   Clipped to the HRRR CONUS footprint plus a margin; coordinates rounded to 0.001 degree (about 100 m).
   Usage: node tools/build-basemap-conus.js <node_modules dir> <dir with ne_50m_lakes / ne_10m_populated_places_simple .geojson> */
"use strict";
const fs = require("fs"), path = require("path");
const [MODS, NE] = process.argv.slice(2);
const topo = require(path.join(MODS, "topojson-client"));
const BOX = { w: -140, e: -55, s: 18, n: 58 };
const r3 = (x) => Math.round(x * 1e3) / 1e3;
const inBox = ([x, y]) => x >= BOX.w && x <= BOX.e && y >= BOX.s && y <= BOX.n;
function clipLines(lines) { const out = []; lines.forEach((ln) => { let cur = []; ln.forEach((p) => { if (inBox(p)) { const q = [r3(p[0]), r3(p[1])], l = cur[cur.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) cur.push(q); } else { if (cur.length > 1) out.push(cur); cur = []; } }); if (cur.length > 1) out.push(cur); }); return out; }
const linesOf = (g) => (!g ? [] : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : []);
const lineFeat = (props, lines) => (lines.length ? [{ type: "Feature", properties: props, geometry: { type: "MultiLineString", coordinates: lines } }] : []);
const fc = (features) => ({ type: "FeatureCollection", features });
const S = JSON.parse(fs.readFileSync(path.join(MODS, "us-atlas", "states-10m.json")));
const W = JSON.parse(fs.readFileSync(path.join(MODS, "world-atlas", "countries-50m.json")));
const states = lineFeat({ kind: "state" }, clipLines(linesOf(topo.mesh(S, S.objects.states, (a, b) => a !== b))));
const borders = lineFeat({ kind: "border" }, clipLines(linesOf(topo.mesh(W, W.objects.countries, (a, b) => a !== b))));
const coast = lineFeat({ kind: "coast" }, clipLines(linesOf(topo.mesh(W, W.objects.countries, (a, b) => a === b))));
const lakes = JSON.parse(fs.readFileSync(path.join(NE, "ne_50m_lakes.geojson"))).features
  .filter((f) => (f.properties.scalerank || 0) <= 2).flatMap((f) => lineFeat({ kind: "lake", name: f.properties.name || null }, clipLines(linesOf(f.geometry))));
const places = JSON.parse(fs.readFileSync(path.join(NE, "ne_10m_populated_places_simple.geojson"))).features
  .filter((f) => ["USA", "CAN", "MEX"].includes(f.properties.adm0_a3) && f.properties.pop_max >= 100000 && inBox(f.geometry.coordinates))
  .map((f) => ({ type: "Feature", properties: { name: f.properties.name, pop: f.properties.pop_max, cap: f.properties.adm0cap === 1 || f.properties.featurecla === "Admin-1 capital" }, geometry: { type: "Point", coordinates: f.geometry.coordinates.map(r3) } }))
  .sort((a, b) => b.properties.pop - a.properties.pop);
const out = { version: "basemap-conus-v1", box: BOX,
  sources: { boundaries: "US Census cartographic boundaries via us-atlas 3.0.1 (ISC)", coast: "Natural Earth 1:50m via world-atlas 2.0.2 (public domain)", lakes: "Natural Earth 50m lakes v5.1.2 (public domain)", places: "Natural Earth 10m populated places v5.1.2 (public domain)" },
  layers: { states: fc(states), borders: fc(borders), coast: fc(coast), lakes: fc(lakes), places: fc(places) } };
const file = path.join(__dirname, "..", "assets", "maps", "basemap-conus.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${file}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB · ${places.length} places`);
