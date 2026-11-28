#!/usr/bin/env python3
"""Experimental maps for one active and one quiet 2024 verification day (research only).

Forecast probability and observed reports are separate layers. Offshore/Canada/Mexico samples
(the display mask) and everything outside the regional training grid are drawn as UNAVAILABLE,
never as zero risk. Also draws a CONUS-extent prototype of the same active day.
"""
import argparse
import csv
import gzip
import json
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import BoundaryNorm, ListedColormap  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

import hrrr_grid  # noqa: E402
from protocol import future_window  # noqa: E402

HAZARDS = ("tornado", "wind", "hail")
LEVELS = [0, 0.02, 0.05, 0.10, 0.15, 0.30, 0.45, 1.0]
COLORS = ["#f7f7f7", "#c7e9c0", "#fdd49e", "#fc8d59", "#e34a33", "#b30000", "#7a0177"]
CMAP, NORM = ListedColormap(COLORS), BoundaryNorm(LEVELS, len(COLORS))
LABEL = {"v07": "v0.7 (production research reference)", "phase2_logistic": "Phase 2 logistic (experimental)",
         "phase2_gbt": "Phase 2 boosted trees (experimental)"}
DEFINITION = ("Probability of at least one qualifying report within 25 miles "
              "(tornado; wind >= 50 kt; hail >= 1 in)")
UNAVAILABLE = "#bdbdbd"


def states():
    feats = json.loads(Path("assets/severe-research/states.json").read_text())["features"]
    rings = []
    for f in feats:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            rings.extend(np.asarray(r) for r in poly)
    return rings


def draw_states(ax, rings):
    for r in rings:
        ax.plot(r[:, 0], r[:, 1], color="#555555", lw=0.35, zorder=3)


def reports(source, day_window):
    """Accepted report locations in the window, from the pinned Storm Events file (if staged)."""
    if source is None or not Path(source).exists():
        return None
    from labels import normalize
    with gzip.open(source, "rt", newline="") as stream:
        events, _ = normalize(csv.DictReader(stream))
    start, end = (datetime.fromisoformat(day_window[k]) for k in ("valid_start", "valid_end"))
    out = {h: [] for h in HAZARDS}
    for e in events:
        if e["uncertainty"] or e["a"] is None:
            continue
        instant = e["start"] == e["end"]
        if (instant and not start <= e["start"] < end) or (not instant and (e["start"] >= end or e["end"] < start)):
            continue
        x, y, z = e["a"]
        out[e["hazard"]].append((np.degrees(np.arctan2(y, x)), np.degrees(np.arcsin(z))))
    return {h: np.array(v).reshape(-1, 2) for h, v in out.items()}


def pick_days(labels, cases, land):
    totals = [int(((labels[i, 0] == 1) & land[:, None]).sum()) for i in range(len(cases))]
    active = int(np.argmax(totals))
    quiet = min(range(len(cases)), key=lambda i: (totals[i], i))
    return active, quiet, totals


def day_map(path, title, case, day, coordinates, land, labels, fields, obs, rings, extent, models):
    window = future_window(case, day)
    fig, axes = plt.subplots(len(models), 3, figsize=(15, 4.5 * len(models) + 1.2), squeeze=False)
    lon, lat = coordinates[:, 0], coordinates[:, 1]
    for r, model in enumerate(models):
        for c, hazard in enumerate(HAZARDS):
            ax = axes[r, c]
            p = fields[(day, hazard, model)]
            ok = land & np.isfinite(p)
            ax.scatter(lon[~ok], lat[~ok], s=3.4, marker="s", c=UNAVAILABLE, lw=0, zorder=1)
            ax.scatter(lon[ok], lat[ok], s=3.4, marker="s", c=p[ok], cmap=CMAP, norm=NORM, lw=0, zorder=2)
            hit = labels[:, c] == 1
            ax.scatter(lon[hit], lat[hit], s=2.0, marker=".", c="#08306b", lw=0, alpha=0.8, zorder=4)
            if obs is not None and len(obs[hazard]):
                ax.scatter(obs[hazard][:, 0], obs[hazard][:, 1], s=14, marker="^" if hazard == "tornado" else "o",
                           facecolors="none", edgecolors="black", lw=0.7, zorder=5)
            draw_states(ax, rings)
            ax.set_xlim(extent[:2]); ax.set_ylim(extent[2:])
            ax.set_aspect(1 / np.cos(np.radians(np.mean(extent[2:]))))
            ax.set_xticks([]); ax.set_yticks([])
            n_obs = 0 if obs is None else len(obs[hazard])
            ax.set_title(f"{hazard.title()} - {LABEL[model]}\npeak {np.nanmax(np.where(ok, p, np.nan)):.0%}; "
                         f"{int(hit.sum())} points within 25 mi of a report"
                         + (f"; {n_obs} reports" if obs is not None else ""), fontsize=8.5)
    issued = window["assumed_issuance_time"].replace("+00:00", "Z")
    fig.suptitle(f"{title}: Day {day} from the {window['model_init_time'][11:13]}Z HRRR of {case} (issued {issued})\n"
                 f"Valid {window['valid_start'].replace('+00:00', 'Z')} to {window['valid_end'].replace('+00:00', 'Z')}. "
                 f"{DEFINITION}. Verification day not used for fitting; research only, not a forecast.",
                 fontsize=10)
    handles = [Patch(color=col, label=f"{lo:.0%}-{hi:.0%}") for col, lo, hi in zip(COLORS, LEVELS, LEVELS[1:])]
    handles += [Patch(color=UNAVAILABLE, label="Unavailable (outside report coverage)"),
                Line2D([], [], ls="", marker=".", color="#08306b", label="Observed: within 25 mi of a report")]
    if obs is not None:
        handles.append(Line2D([], [], ls="", marker="o", mfc="none", mec="black", label="Observed report location"))
    fig.legend(handles=handles, loc="lower center", ncol=6, fontsize=8, frameon=False)
    fig.tight_layout(rect=(0, 0.06, 1, 0.93))
    fig.savefig(path, dpi=130)
    plt.close(fig)


def conus_prototype(path, case, day, coordinates, land, labels, fields, obs, rings, model):
    """Same active day on the full HRRR CONUS footprint: regional values shown, the rest marked
    unavailable (no training predictors or labels yet), never zero."""
    window = future_window(case, day)
    lon_c, lat_c = hrrr_grid.lonlat(5)
    inside_box = (lon_c >= -100) & (lon_c <= -75) & (lat_c >= 30) & (lat_c <= 45)
    ol, oa = hrrr_grid.outline()
    fig, axes = plt.subplots(1, 3, figsize=(18, 4.8))
    lon, lat = coordinates[:, 0], coordinates[:, 1]
    for c, hazard in enumerate(HAZARDS):
        ax = axes[c]
        ax.scatter(lon_c[~inside_box], lat_c[~inside_box], s=1.6, marker="s", c="#e3e3e3", lw=0, zorder=1)
        p = fields[(day, hazard, model)]
        ok = land & np.isfinite(p)
        ax.scatter(lon[~ok], lat[~ok], s=1.6, marker="s", c=UNAVAILABLE, lw=0, zorder=1)
        ax.scatter(lon[ok], lat[ok], s=1.6, marker="s", c=p[ok], cmap=CMAP, norm=NORM, lw=0, zorder=2)
        hit = labels[:, c] == 1
        ax.scatter(lon[hit], lat[hit], s=0.5, marker=".", c="#08306b", lw=0, alpha=0.6, zorder=4)
        if obs is not None and len(obs[hazard]):
            ax.scatter(obs[hazard][:, 0], obs[hazard][:, 1], s=6, marker="o", facecolors="none",
                       edgecolors="black", lw=0.5, zorder=5)
        draw_states(ax, rings)
        ax.plot(ol, oa, color="#225ea8", lw=0.9, zorder=6)
        ax.plot([-100, -75, -75, -100, -100], [30, 30, 45, 45, 30], color="black", lw=0.9, ls="--", zorder=6)
        ax.set_xlim(-126, -64); ax.set_ylim(22, 51)
        ax.set_aspect(1 / np.cos(np.radians(37)))
        ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(f"{hazard.title()} - {LABEL[model]}", fontsize=9)
    fig.suptitle(f"CONUS grid prototype: Day {day}, {case} HRRR, valid {window['valid_start'][:16]}Z-"
                 f"{window['valid_end'][:16]}Z. Values only inside the regional training grid (dashed); "
                 f"light gray = HRRR CONUS grid with no training data yet (unavailable, not zero risk); "
                 f"blue = HRRR domain edge.", fontsize=9.5)
    fig.tight_layout(rect=(0, 0, 1, 0.92))
    fig.savefig(path, dpi=130)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arrays", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reports", type=Path, help="Pinned 2024 Storm Events file (optional)")
    args = parser.parse_args()
    a = args.arrays
    cases = json.loads((a / "dev_cases.json").read_text())
    if any(not c.startswith("2024") for c in cases):
        raise ValueError("Maps are drawn only for 2024 verification dates")
    coordinates = np.load(a / "coordinates.npy")
    labels = np.load(a / "labels_dev.npy")
    hidden = json.loads(Path("assets/severe-daily/display-mask.json").read_text())["hidden"]
    land = np.ones(len(coordinates), bool)
    land[hidden] = False
    models = [m for m in ("v07", "phase2_logistic", "phase2_gbt") if (a / f"day1_tornado_{m}.npy").exists()]
    active, quiet, totals = pick_days(labels, cases, land)
    rings = states()
    args.output.mkdir(parents=True, exist_ok=True)
    chosen = {"active": {"case": cases[active], "day1_event_points_land": totals[active]},
              "quiet": {"case": cases[quiet], "day1_event_points_land": totals[quiet]},
              "rule": "Most and fewest Day 1 land points within 25 mi of a report among the 12 verification dates",
              "event_points_by_date": dict(zip(cases, totals)), "report_locations_drawn": args.reports is not None}
    for kind, i in (("active", active), ("quiet", quiet)):
        fields = {(d, h, m): np.load(a / f"day{d}_{h}_{m}.npy")[i] for d in (1, 2) for h in HAZARDS for m in models}
        for day in (1, 2):
            obs = reports(args.reports, future_window(cases[i], day))
            day_map(args.output / f"{kind}-{cases[i]}-day{day}.png", f"{kind.title()} verification day",
                    cases[i], day, coordinates, land, labels[i, day - 1], fields, obs, rings, (-101, -74, 29.5, 45.5),
                    models)
            if kind == "active" and day == 1:
                conus_prototype(args.output / f"conus-prototype-{cases[i]}-day1.png", cases[i], 1, coordinates, land,
                                labels[i, 0], fields, obs, rings, "phase2_logistic")
    (args.output / "map-days.json").write_text(json.dumps(chosen, indent=1) + "\n")


if __name__ == "__main__":
    main()
