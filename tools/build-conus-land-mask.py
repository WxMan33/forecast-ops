#!/usr/bin/env python3
"""Build assets/severe-conus-land.json: the lower-48 land mask used to clip the CONUS preview's shading
at render time. Land = union of the 48 states + DC from assets/severe-research/states.json (the same geometry
that draws the state outlines, so shading meets the drawn coastline), minus inland lakes from
assets/severe-research/lakes.json that lie inside it (Lake Okeechobee, Great Salt Lake). The Great Lakes,
oceans, Canada and Mexico are outside. Also lists the CONUS grid points that fall on land.
Display only: forecast values, storm reports and the 25-mile definition are unchanged."""
import hashlib, json
from pathlib import Path
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
STATES, LAKES = ROOT / "assets/severe-research/states.json", ROOT / "assets/severe-research/lakes.json"
GRID, OUT = ROOT / "assets/severe-conus/grid.json", ROOT / "assets/severe-conus-land.json"
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

land = unary_union([shape(f["geometry"]).buffer(0) for f in json.loads(STATES.read_text())["features"]])
inland = [shape(f["geometry"]) for f in json.loads(LAKES.read_text())["features"]]
inland = [g for g in inland if g.intersection(land).area / g.area > 0.9]
land = land.difference(unary_union(inland)).buffer(0)
rnd = lambda c: [[round(x, 4), round(y, 4)] for x, y in c]
polys = [[rnd(p.exterior.coords)] + [rnd(r.coords) for r in p.interiors] for p in getattr(land, "geoms", [land])]
grid = json.loads(GRID.read_text())["coordinates"]
pl = prep(land)
on_land = [i for i, (x, y) in enumerate(grid) if pl.contains(Point(x, y))]
out = {"description": "Lower-48 land mask for the CONUS Severe research preview (display clip only).",
       "sources": {"states": {"file": str(STATES.relative_to(ROOT)), "sha256": sha(STATES)},
                   "lakes_removed": [f["properties"]["name"] for f in json.loads(LAKES.read_text())["features"] if shape(f["geometry"]).intersection(land.union(unary_union(inland))).area / shape(f["geometry"]).area > 0.9],
                   "grid": {"file": str(GRID.relative_to(ROOT)), "sha256": sha(GRID)}},
       "land": {"type": "MultiPolygon", "coordinates": polys}, "grid_on_land": on_land}
OUT.write_text(json.dumps(out, separators=(",", ":")))
print(len(polys), "polygons;", len(on_land), "of", len(grid), "grid points on land;", OUT.stat().st_size, "bytes")
