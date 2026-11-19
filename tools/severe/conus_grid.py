#!/usr/bin/env python3
"""Pin the CONUS pilot sample list: stride-5 HRRR lattice points within 25 miles of US land that
lie OUTSIDE the regional box. extract(..., extra_samples=...) adds them to the unchanged regional
box samples, so every regional point is produced by exactly the same code path as before.

  python tools/severe/conus_grid.py            write research/severe/conus-v1/extra-samples.npz
  python tools/severe/conus_grid.py --check    exit 1 if the committed list is stale
"""
import argparse
import hashlib
import io
import sys
from pathlib import Path

import numpy as np

import hrrr_grid
from display_mask import RADIUS_KM, distances, land

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "research/severe/conus-v1/extra-samples.npz"
STRIDE = 5
BOX = (-100, -75, 30, 45)


def build():
    lon, lat = hrrr_grid.lonlat(STRIDE)
    rows, cols = np.meshgrid(np.arange(0, hrrr_grid.GRID["Nj"], STRIDE), np.arange(0, hrrr_grid.GRID["Ni"], STRIDE), indexing="ij")
    w, e, s, n = BOX
    margin = 1e-6  # stay clear of the box edge; points there are taken by the unchanged box rule
    outside = ~((lon >= w - margin) & (lon <= e + margin) & (lat >= s - margin) & (lat <= n + margin))
    km = np.array(distances(np.c_[lon[outside], lat[outside]], land()))
    keep = km <= RADIUS_KM
    return rows[outside][keep].astype(np.int32), cols[outside][keep].astype(np.int32)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rows, cols = build()
    buffer = io.BytesIO()
    np.savez(buffer, rows=rows, cols=cols)
    if args.check:
        with np.load(OUTPUT) as old:
            if not (np.array_equal(old["rows"], rows) and np.array_equal(old["cols"], cols)):
                sys.exit("conus-v1/extra-samples.npz is stale")
        print("CONUS extra sample list matches")
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(buffer.getvalue())
    print(f"{len(rows)} extra samples; sha256 {hashlib.sha256(buffer.getvalue()).hexdigest()}")


if __name__ == "__main__":
    main()
