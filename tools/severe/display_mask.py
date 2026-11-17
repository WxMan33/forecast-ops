#!/usr/bin/env python3
"""Build the daily viewer's display mask: samples more than 25 miles from US land.

Reports in the NCEI Storm Events database come from US land and its near coast, so labels
are structurally zero farther out (Gulf and Atlantic waters, Great Lakes interiors, Canada,
Mexico). The viewer hides those samples. This is a DISPLAY mask only: the model was trained
and calibrated with them, and its probabilities elsewhere are unchanged.

  pip install numpy==2.3.5 shapely==2.2.0
  python tools/severe/display_mask.py           write assets/severe-daily/display-mask.json
  python tools/severe/display_mask.py --check   exit 1 if the committed mask is stale
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from shapely import prepared
from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
GRID = ROOT / "assets/severe-daily/grid.json"
STATES = ROOT / "assets/severe-research/states.json"
OUTPUT = ROOT / "assets/severe-daily/display-mask.json"
RADIUS_KM = 40.2336


def land():
    return unary_union([shape(f["geometry"]) for f in json.loads(STATES.read_text())["features"]])


def segments(geometry):
    """Every outline edge as (lon1, lat1, lon2, lat2) rows."""
    rows = []
    for line in getattr(geometry.boundary, "geoms", [geometry.boundary]):
        xy = np.asarray(line.coords)
        rows.append(np.hstack([xy[:-1], xy[1:]]))
    return np.vstack(rows)


def outline_km(lon, lat, edges, search_km=120.0):
    """Shortest distance (km) from a point to the outline edges, measured in a flat frame centered
    on the point (km east and north). Within ~100 km this differs from the geodesic distance by a
    small fraction of a kilometer. Linear referencing (project/interpolate) is not used: on a
    multi-part boundary it can return a point on the wrong part, which hid nearshore samples."""
    kx, ky = 111.32 * np.cos(np.radians(lat)), 110.57
    ax, ay = (edges[:, 0] - lon) * kx, (edges[:, 1] - lat) * ky
    bx, by = (edges[:, 2] - lon) * kx, (edges[:, 3] - lat) * ky
    near = (np.minimum(ax, bx) <= search_km) & (np.maximum(ax, bx) >= -search_km) & \
           (np.minimum(ay, by) <= search_km) & (np.maximum(ay, by) >= -search_km)
    if not near.any():
        return float("inf")
    ax, ay, bx, by = ax[near], ay[near], bx[near], by[near]
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    t = np.clip(np.where(length > 0, -(ax * dx + ay * dy) / np.where(length > 0, length, 1), 0), 0, 1)
    return float(np.min(np.hypot(ax + t * dx, ay + t * dy)))


def distances(coordinates, geometry=None):
    """km from each sample to US land: 0 inside an outline, else the shortest edge distance."""
    geometry = geometry or land()
    inside, edges = prepared.prep(geometry), segments(geometry)
    return [0.0 if inside.contains(Point(lon, lat)) else outline_km(lon, lat, edges) for lon, lat in coordinates]


def build():
    coordinates = json.loads(GRID.read_text())["coordinates"]
    hidden = [i for i, km in enumerate(distances(coordinates)) if km > RADIUS_KM]
    return {
        "schema_version": 1,
        "grid_sha256": hashlib.sha256(GRID.read_bytes()).hexdigest(),
        "rule": "Samples more than 25 miles from any US state outline (assets/severe-research/states.json)",
        "reason": ("Outside report coverage: Gulf and Atlantic waters, Great Lakes interiors, Canada and "
                   "Mexico have essentially no qualifying reports, so these values cannot be verified"),
        "display_only": True,
        "hidden": hidden,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = json.dumps(build(), separators=(",", ":")) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != text:
            sys.exit("assets/severe-daily/display-mask.json is stale; run tools/severe/display_mask.py")
        print("Daily display mask matches the grid and land outlines")
        return
    OUTPUT.write_text(text)
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {len(json.loads(text)['hidden'])} hidden samples")


if __name__ == "__main__":
    main()
