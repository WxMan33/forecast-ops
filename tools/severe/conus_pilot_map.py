#!/usr/bin/env python3
"""Pilot maps: one predictor (to show every new area is populated) and the report labels for each
hazard on the CONUS land grid, with the old regional box dashed and spot-check sites marked."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from conus_pilot import SPOTS  # noqa: E402
from protocol import future_window  # noqa: E402

STATES = Path(__file__).resolve().parents[2] / "assets/severe-research/states.json"


def outline(ax):
    for f in json.loads(STATES.read_text())["features"]:
        g = f["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            r = np.asarray(poly[0])
            ax.plot(r[:, 0], r[:, 1], color="#444444", lw=0.3)
    ax.plot([-100, -75, -75, -100, -100], [30, 30, 45, 45, 30], "k--", lw=0.9)
    ax.set_xlim(-126, -66); ax.set_ylim(24, 50); ax.set_aspect(1 / np.cos(np.radians(37)))
    ax.set_xticks([]); ax.set_yticks([])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--case", required=True); p.add_argument("--conus", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    with np.load(a.conus / a.case / "conus-joined.npz", allow_pickle=False) as d:
        c, x, y, names = d["coordinates"], d["features"], d["labels"], list(d["feature_names"])
    a.output.mkdir(parents=True, exist_ok=True)
    for day in (1, 2):
        w = future_window(a.case, day)
        fig, axes = plt.subplots(2, 2, figsize=(15, 8.6))
        ax = axes[0, 0]
        v = x[day - 1, :, names.index("x_dewpoint2m_max")] - 273.15
        sc = ax.scatter(c[:, 0], c[:, 1], c=v, s=1.3, marker="s", cmap="viridis", lw=0)
        fig.colorbar(sc, ax=ax, shrink=0.7, label="24-h max 2 m dewpoint (C)")
        for name, (lon, lat) in SPOTS.items():
            ax.plot(lon, lat, "r+", ms=7)
        outline(ax); ax.set_title(f"Predictor check: every CONUS land sample populated ({len(c):,} samples; + = spot checks)", fontsize=9)
        for k, hz in enumerate(("tornado", "wind", "hail")):
            ax = axes.flat[k + 1]
            lab = y[day - 1, :, k]
            ax.scatter(c[lab == 0, 0], c[lab == 0, 1], s=1.0, marker="s", c="#e6e6e6", lw=0)
            ax.scatter(c[lab == 255, 0], c[lab == 255, 1], s=1.0, marker="s", c="#fdae6b", lw=0)
            ax.scatter(c[lab == 1, 0], c[lab == 1, 1], s=1.3, marker="s", c="#08306b", lw=0)
            outline(ax)
            ax.set_title(f"{hz}: {int((lab == 1).sum())} points within 25 mi of a report "
                         f"({int(((lab == 1) & ~((c[:, 0] >= -100) & (c[:, 0] <= -75) & (c[:, 1] >= 30) & (c[:, 1] <= 45))).sum())} outside the old box); "
                         f"orange = unresolved report", fontsize=9)
        fig.suptitle(f"CONUS pilot {a.case} Day {day}: HRRR {w['model_init_time'][11:13]}Z, valid "
                     f"{w['valid_start'][:16]}Z to {w['valid_end'][:16]}Z. Labels: qualifying report within 25 miles. Research only.", fontsize=10)
        fig.tight_layout(rect=(0, 0, 1, 0.95))
        fig.savefig(a.output / f"pilot-{a.case}-day{day}.png", dpi=110)
        plt.close(fig)


if __name__ == "__main__":
    main()
