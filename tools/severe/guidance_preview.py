#!/usr/bin/env python3
"""Local research preview: v0.7 HRRR severe-wind probability beside raw RRFS and NBM layers.

Panels are on the production 16,413-sample grid with the production display mask. Only the
HRRR panel is a probability (the published v0.7 model). Every other panel is a raw model field,
labelled with its variable, statistic and units; no RRFS or NBM probability is made here.

  python tools/severe/guidance_preview.py --guidance tests/out/guidance-20261118-day1 \
      --hrrr tests/out/hrrr-20261118-day1 --output docs/images/severe-guidance-20261118-day1.png
"""
import argparse
import glob
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PROB_BOUNDS = [0, 0.001, 0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.30, 1]


def feature(path, name):
    with np.load(path, allow_pickle=False) as d:
        names = list(d["feature_names"])
        return d["features"][:, names.index(name)].astype(float), d["coordinates"]


def layers(guidance, hrrr):
    g, h = Path(guidance), Path(hrrr)
    manifest = json.loads((g / "manifest.json").read_text())
    candidate = json.loads((h / "candidate.json").read_text())
    hrrr_npz = glob.glob(str(h / "predictors" / "*features.npz"))[0]
    wind = np.asarray(candidate["probabilities"]["wind"], float)
    hrrr_uh, coords = feature(hrrr_npz, "x_uh25_nearby_max_max")
    out = [{"title": "HRRR v0.7 Day 1 severe-wind probability\n(published research model, within 25 mi)",
            "values": wind, "kind": "probability", "units": "probability"},
           {"title": "HRRR 2-5 km updraft helicity\n24 h max of hourly max, 25-mi neighborhood max",
            "values": hrrr_uh, "kind": "uh", "units": "m² s⁻² (GRIB 0/7/199)"}]
    window = manifest["window"]
    if manifest["sources"].get("rrfs", {}).get("status") == "complete":
        rrfs = g / manifest["sources"]["rrfs"]["features_file"]
        uh, rc = feature(rrfs, "x_uh25_nearby_max_max")
        if not np.array_equal(rc, coords):
            raise ValueError("RRFS and HRRR sample grids differ")
        out.append({"title": "RRFS 2-5 km updraft helicity (raw predictor, not a probability)\n"
                             "24 h max of hourly max, 25-mi neighborhood max",
                    "values": uh, "kind": "uh", "units": "m² s⁻² (GRIB 0/7/199)"})
    if manifest["sources"].get("nbm", {}).get("status") == "complete":
        nbm = g / manifest["sources"]["nbm"]["features_file"]
        t, nc = feature(nbm, "nbm_tstm12_nearby_max_max")
        if not np.array_equal(nc, coords):
            raise ValueError("NBM and HRRR sample grids differ")
        periods = manifest["sources"]["nbm"]["thunder_periods_forecast_hours"]
        out.append({"title": "NBM 12 h thunderstorm probability (context, not severe)\n"
                             f"max of f{periods[0][0]:02d}-{periods[0][1]:02d} and f{periods[1][0]:02d}-{periods[1][1]:02d}, "
                             "25-mi neighborhood max",
                    "values": t, "kind": "percent", "units": "% (GRIB 0/19/2, accumulation period 12 h)"})
    return out, coords, window, manifest


def render(guidance, hrrr, output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import BoundaryNorm
    items, coords, window, manifest = layers(guidance, hrrr)
    hidden = np.zeros(len(coords), bool)
    mask = json.loads((ROOT / "assets/severe-daily/display-mask.json").read_text())
    hidden[mask["hidden"]] = True
    states = json.loads((ROOT / "assets/severe-research/states.json").read_text())["features"]
    fig, axes = plt.subplots(2, 2, figsize=(14, 9.2), constrained_layout=True)
    cmaps = {"probability": ("YlOrRd", BoundaryNorm(PROB_BOUNDS, 256)),
             "uh": ("magma_r", BoundaryNorm([0, 5, 10, 25, 50, 75, 100, 150, 250], 256)),
             "percent": ("Blues", BoundaryNorm([0, 1, 5, 10, 20, 30, 50, 70, 100], 256))}
    summary = []
    for ax, item in zip(axes.ravel(), items):
        v = item["values"]
        cmap, norm = cmaps[item["kind"]]
        show = ~hidden
        sc = ax.scatter(coords[show, 0], coords[show, 1], c=v[show], s=5, marker="s", cmap=cmap, norm=norm,
                        linewidths=0)
        for f in states:
            polys = f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon" else [f["geometry"]["coordinates"]]
            for poly in polys:
                ring = np.asarray(poly[0])
                ax.plot(ring[:, 0], ring[:, 1], color="#444", lw=0.5)
        ax.set_xlim(-100, -75)
        ax.set_ylim(30, 45)
        ax.set_aspect(1 / np.cos(np.radians(38)))
        ax.set_title(item["title"], fontsize=10)
        ax.tick_params(labelsize=7)
        bar = fig.colorbar(sc, ax=ax, shrink=0.85)
        bar.set_label(item["units"], fontsize=8)
        bar.ax.tick_params(labelsize=7)
        summary.append({"title": item["title"].replace("\n", " "), "units": item["units"],
                        "shown_max": float(np.max(v[show])), "shown_p99": float(np.percentile(v[show], 99))})
    for ax in axes.ravel()[len(items):]:
        ax.axis("off")
    rrfs = manifest["sources"].get("rrfs", {})
    nbm = manifest["sources"].get("nbm", {})
    fig.suptitle(f"Research preview, Day 1 window {window['valid_start'][:16]}Z to {window['valid_end'][:16]}Z · "
                 f"HRRR {window['model_init_time'][:13]}Z · RRFS {rrfs.get('cycle', 'n/a')[:13]}Z "
                 f"({rrfs.get('status', 'not run')}) · NBM {nbm.get('cycle', 'n/a')[:13]}Z ({nbm.get('status', 'not run')})\n"
                 "Only the HRRR panel is a probability. RRFS and NBM panels are raw inputs; no RRFS-based probability "
                 "exists until a model is trained and calibrated.", fontsize=10)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=110)
    output.with_suffix(".json").write_text(json.dumps({"window": window, "panels": summary,
                                                        "masked_samples": int(hidden.sum())}, indent=1) + "\n")
    return summary


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--guidance", required=True)
    p.add_argument("--hrrr", required=True, help="Output directory of tools/severe/product.py for the same case")
    p.add_argument("--output", required=True)
    a = p.parse_args(argv)
    for row in render(a.guidance, a.hrrr, a.output):
        print(json.dumps(row))


if __name__ == "__main__":
    main()
