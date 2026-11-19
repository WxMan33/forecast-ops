#!/usr/bin/env python3
"""CONUS coverage audit for the severe research product (no network, no outcomes).

Classifies every stride-5 sample of the full HRRR CONUS grid (the same grid family as the
production samples) by what currently supports it:
  regional_supported   inside the trained regional grid and within 25 mi of US land
  regional_masked      inside the regional grid but hidden by the viewer mask (no reports)
  gap_land             US land (within 25 mi) with no training predictors/labels yet
  outside_coverage     ocean / Canada / Mexico beyond 25 mi of US land (unverifiable)
and flags samples whose 25-mile neighborhood is truncated by the HRRR domain edge or partly
leaves report coverage (coasts and borders). Writes JSON + a coverage map.
"""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

import hrrr_grid  # noqa: E402
from display_mask import RADIUS_KM, distances, land  # noqa: E402

STRIDE = 5
EDGE_CELLS = int(np.ceil(RADIUS_KM / 3.0))  # native cells within 25 mi of the domain edge
CLASSES = {"regional_supported": "#2b8cbe", "regional_masked": "#9ecae1",
           "gap_land": "#fdae6b", "outside_coverage": "#e0e0e0"}


def classify():
    lon, lat = hrrr_grid.lonlat(STRIDE)
    jj, ii = np.meshgrid(np.arange(0, hrrr_grid.GRID["Nj"], STRIDE), np.arange(0, hrrr_grid.GRID["Ni"], STRIDE), indexing="ij")
    flat = np.c_[lon.ravel(), lat.ravel()]
    km = np.array(distances(flat, land()))
    box = ((lon >= -100) & (lon <= -75) & (lat >= 30) & (lat <= 45)).ravel()
    near_land = km <= RADIUS_KM
    cls = np.where(box & near_land, "regional_supported", np.where(box, "regional_masked",
                   np.where(near_land, "gap_land", "outside_coverage")))
    edge = ((jj < EDGE_CELLS) | (jj > hrrr_grid.GRID["Nj"] - 1 - EDGE_CELLS)
            | (ii < EDGE_CELLS) | (ii > hrrr_grid.GRID["Ni"] - 1 - EDGE_CELLS)).ravel()
    return lon, lat, flat, km, cls, edge, box


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("research/severe/phase2-conus"))
    args = parser.parse_args()
    lon, lat, flat, km, cls, edge, box = classify()
    # Coast/border exposure: land samples whose 25-mile disk reaches past the US outline.
    from display_mask import outline_km, segments
    edges = segments(land())
    to_outline = np.array([outline_km(x, y, edges) for x, y in flat])
    exposed = (km <= RADIUS_KM) & (to_outline < RADIUS_KM)
    counts = {c: int((cls == c).sum()) for c in CLASSES}
    land_total = counts["regional_supported"] + counts["gap_land"]
    report = {
        "grid": {"source": "HRRR CONUS 3 km Lambert grid, every 5th point (15 km)", "samples": int(len(cls)),
                 "regional_box": "100-75W, 30-45N", "regional_samples": int(box.sum())},
        "counts": counts,
        "us_land_samples_within_25mi": land_total,
        "share_of_us_land_supported": counts["regional_supported"] / land_total,
        "edge_truncated_neighborhood": {"total": int(edge.sum()), "on_us_land": int((edge & (km <= RADIUS_KM)).sum()),
                                        "rule": f"within {EDGE_CELLS} native cells (25 mi) of the HRRR domain edge"},
        "coast_or_border_exposed": {"us_land_total": int(exposed.sum()),
                                    "inside_regional_grid": int((exposed & box).sum()),
                                    "rule": "land sample whose 25-mile disk extends past the US outline; "
                                            "reports stop at the coast/border, so labels there are biased low"},
        "viewer_mask_hidden_in_regional_grid": counts["regional_masked"],
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "coverage.json").write_text(json.dumps(report, indent=1) + "\n")
    fig, ax = plt.subplots(figsize=(12, 6.5))
    for c, color in CLASSES.items():
        s = cls == c
        ax.scatter(flat[s, 0], flat[s, 1], s=1.4, marker="s", c=color, lw=0, label=f"{c.replace('_', ' ')} ({counts[c]:,})")
    ax.scatter(flat[exposed, 0], flat[exposed, 1], s=0.5, c="#636363", lw=0, label=f"coast/border exposed ({int(exposed.sum()):,})")
    ax.scatter(flat[edge, 0], flat[edge, 1], s=0.8, c="#d7301f", lw=0, label=f"domain-edge truncated ({int(edge.sum()):,})")
    feats = json.loads((Path(__file__).resolve().parents[2] / "assets/severe-research/states.json").read_text())["features"]
    for f in feats:
        g = f["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            r = np.asarray(poly[0])
            ax.plot(r[:, 0], r[:, 1], color="#333333", lw=0.35)
    ol, oa = hrrr_grid.outline()
    ax.plot(ol, oa, color="#225ea8", lw=1)
    ax.plot([-100, -75, -75, -100, -100], [30, 30, 45, 45, 30], "k--", lw=1)
    ax.set_xlim(-135, -58); ax.set_ylim(19, 56); ax.set_aspect(1 / np.cos(np.radians(37)))
    ax.set_xticks([]); ax.set_yticks([])
    ax.legend(loc="lower left", markerscale=6, fontsize=8, frameon=True)
    ax.set_title(f"Severe research coverage on the HRRR CONUS grid: {report['share_of_us_land_supported']:.0%} of US land samples "
                 f"have training data today (dashed box); orange = gap, unavailable not zero", fontsize=10)
    fig.tight_layout()
    fig.savefig(args.output / "coverage-map.png", dpi=130)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
