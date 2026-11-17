#!/usr/bin/env python3
"""Build the daily viewer's display mask: samples more than 25 miles from US land.

Reports in the NCEI Storm Events database come from US land and its near coast, so labels
are structurally zero farther out (Gulf and Atlantic waters, Great Lakes interiors, Canada,
Mexico). The viewer hides those samples. This is a DISPLAY mask only: the model was trained
and calibrated with them, and its probabilities elsewhere are unchanged.

  pip install shapely==2.2.0
  python tools/severe/display_mask.py           write assets/severe-daily/display-mask.json
  python tools/severe/display_mask.py --check   exit 1 if the committed mask is stale
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

from shapely import prepared
from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
GRID = ROOT / "assets/severe-daily/grid.json"
STATES = ROOT / "assets/severe-research/states.json"
OUTPUT = ROOT / "assets/severe-daily/display-mask.json"
RADIUS_KM = 40.2336


def build():
    land = unary_union([shape(f["geometry"]) for f in json.loads(STATES.read_text())["features"]])
    inside, boundary = prepared.prep(land), land.boundary
    coordinates = json.loads(GRID.read_text())["coordinates"]
    hidden = []
    for i, (lon, lat) in enumerate(coordinates):
        point = Point(lon, lat)
        if inside.contains(point):
            continue
        # Local flat-earth distance to the nearest outline point; ample for a 40 km cut.
        near = boundary.interpolate(boundary.project(point))
        km = math.hypot((near.x - lon) * 111.32 * math.cos(math.radians(lat)), (near.y - lat) * 110.57)
        if km > RADIUS_KM:
            hidden.append(i)
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
