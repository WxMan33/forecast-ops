#!/usr/bin/env python3
"""Prebuild light display geometry for the CONUS Severe preview (mobile-safe).

For each case in assets/severe-conus/index.json: run the viewer's own contour code (tools/conus-contours-raw.js:
same mesh, same band thresholds), merge the per-triangle pieces of each band into whole areas, clip fills and
isolines to the lower-48 land mask (assets/severe-conus-land.json), and simplify by 0.003 deg (~300 m, far below
the ~15 km sample spacing). Writes assets/severe-conus-display/<case>.json plus manifest.json (each entry records
the sha256 of the case file it was built from, so the viewer can tell when it is stale and fall back to
computing contours in the browser). Display only: values, readouts, storm reports and the 25-mile definition
come from the unchanged feed."""
import hashlib, json, subprocess, sys, tempfile
from pathlib import Path
from shapely.geometry import shape, mapping, MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
FEED, OUT = ROOT / "assets/severe-conus", ROOT / "assets/severe-conus-display"
TOL = 0.003
sha = lambda b: hashlib.sha256(b).hexdigest()
land = shape(json.loads((ROOT / "assets/severe-conus-land.json").read_text())["land"]).buffer(0)
rnd = lambda cs: [[round(x, 4), round(y, 4)] for x, y in cs]


def polys(g):
    return [g] if isinstance(g, Polygon) else [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


def ccw(coords, outer):
    a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(coords, coords[1:]))
    return coords if (a > 0) == outer else coords[::-1]


def build(case):
    raw_path = Path(tempfile.mkdtemp()) / "raw.json"
    subprocess.run(["node", str(ROOT / "tools/conus-contours-raw.js"), str(FEED / case["file"]), str(raw_path)], check=True)
    raw = json.loads(raw_path.read_text())
    fills = []
    for f in raw["fills"]["features"]:
        merged = unary_union([Polygon(p[0]) for p in f["geometry"]["coordinates"]]).buffer(0)
        clipped = merged.intersection(land).simplify(TOL, preserve_topology=True)
        ps = [p for p in polys(clipped) if p.area > 1e-6]
        if not ps:
            continue
        coords = [[ccw(rnd(p.exterior.coords), True)] + [ccw(rnd(r.coords), False) for r in p.interiors] for p in ps]
        fills.append({"type": "Feature", "properties": f["properties"], "geometry": {"type": "MultiPolygon", "coordinates": coords}})
    lines = []
    for f in raw["lines"]["features"]:
        g = shape(f["geometry"]).intersection(land).simplify(TOL)
        parts = [g] if g.geom_type == "LineString" else [x for x in getattr(g, "geoms", []) if x.geom_type == "LineString"]
        for x in parts:
            if len(x.coords) > 1:
                lines.append({"type": "Feature", "properties": f["properties"], "geometry": {"type": "LineString", "coordinates": rnd(x.coords)}})
    body = {"case_id": case["id"], "case_sha256": case["sha256"], "tolerance_deg": TOL,
            "fills": {"type": "FeatureCollection", "features": fills}, "lines": {"type": "FeatureCollection", "features": lines}}
    blob = json.dumps(body, separators=(",", ":")).encode()
    raw_v = sum(len(p[0]) for f in raw["fills"]["features"] for p in f["geometry"]["coordinates"])
    new_v = sum(len(r) for f in fills for p in f["geometry"]["coordinates"] for r in p)
    return blob, {"raw_polygons": sum(len(f["geometry"]["coordinates"]) for f in raw["fills"]["features"]), "raw_vertices": raw_v,
                  "polygons": sum(len(f["geometry"]["coordinates"]) for f in fills), "vertices": new_v}


def main():
    index = json.loads((FEED / "index.json").read_text())
    OUT.mkdir(exist_ok=True)
    man = {"description": "Prebuilt, land-clipped display contours for the CONUS preview (see tools/build-conus-display.py).",
           "land_sha256": sha((ROOT / "assets/severe-conus-land.json").read_bytes()), "cases": {}}
    for case in index["cases"]:
        blob, stats = build(case)
        name = case["id"] + ".json"
        (OUT / name).write_bytes(blob)
        man["cases"][case["id"]] = {"file": name, "sha256": sha(blob), "case_sha256": case["sha256"], "bytes": len(blob), **stats}
        print(case["id"], stats, len(blob), "bytes", flush=True)
    (OUT / "manifest.json").write_text(json.dumps(man, indent=1) + "\n")


if __name__ == "__main__":
    main()
