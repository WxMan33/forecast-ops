#!/usr/bin/env node
/* Generate CONUS county lines (us-atlas 3.0.1, US Census 1:10m) and local place names
   (Natural Earth 10m populated places v5.1.2 and the existing Tri-State basemap).
   Usage: node tools/build-conus-detail.js path/to/counties-10m.json path/to/ne_10m_populated_places_simple.geojson
   Requires topojson-client (3.1.0). */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const { mesh } = require("topojson-client");

const atlas = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const stateFips = (county) => String(county.id).padStart(5, "0").slice(0, 2);
const outsideConus = new Set(["02", "15"]);
const counties = mesh(atlas, atlas.objects.counties, (a, b) => {
  const state = stateFips(a);
  return a !== b && state === stateFips(b) && Number(state) <= 56 && !outsideConus.has(state);
});

const lines = counties.coordinates.map((line) => {
  const rounded = [];
  for (const point of line) {
    const next = point.map((coord) => Math.round(coord * 1000) / 1000);
    const previous = rounded.at(-1);
    if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) rounded.push(next);
  }
  return rounded;
}).filter((line) => line.length > 1);

const naturalEarth = JSON.parse(fs.readFileSync(process.argv[3], "utf8")).features
  .filter(({ geometry, properties }) => {
    if (geometry?.type !== "Point") return false;
    const [lon, lat] = geometry.coordinates;
    return ["USA", "CAN", "MEX"].includes(properties.adm0_a3) && properties.name &&
      properties.pop_max >= 5000 && properties.pop_max < 100000 &&
      lon >= -140 && lon <= -55 && lat >= 18 && lat <= 58;
  })
  .map(({ geometry, properties }) => ({
    type: "Feature",
    properties: { name: properties.name, pop: properties.pop_max },
    geometry: { type: "Point", coordinates: geometry.coordinates.map((coord) => Math.round(coord * 1000) / 1000) },
  }));

const triState = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../assets/maps/basemap.json"), "utf8"));
const towns = triState.layers.places.features.filter(({ properties, geometry }) =>
  properties.src === "geonames" && properties.pop < 100000 &&
  !naturalEarth.some((f) => f.properties.name === properties.name &&
    Math.abs(f.geometry.coordinates[0] - geometry.coordinates[0]) < 0.15 &&
    Math.abs(f.geometry.coordinates[1] - geometry.coordinates[1]) < 0.12))
  .map(({ properties, geometry }) => ({
    type: "Feature",
    properties: { name: properties.name, pop: properties.pop },
    geometry,
  }));
const places = [...naturalEarth, ...towns].sort((a, b) => b.properties.pop - a.properties.pop);

const countiesFeature = {
  type: "Feature",
  properties: {},
  geometry: { type: "MultiLineString", coordinates: lines },
};
const file = path.resolve(__dirname, "../assets/maps/conus-detail.geojson.gz");
const data = JSON.stringify({ type: "FeatureCollection", features: [countiesFeature, ...places] }) + "\n";
fs.writeFileSync(file, gzipSync(data, { level: 9 }));
console.log(`Wrote ${lines.length} county boundary lines and ${places.length} places to ${file}`);
