#!/usr/bin/env python3
"""Markdown scorecard and an active-day map for the CONUS study (research only)."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from phase2_maps import CMAP, COLORS, DEFINITION, LEVELS, NORM, draw_states, states  # noqa: E402
from protocol import future_window  # noqa: E402
import hrrr_grid  # noqa: E402

NAMES = {"v07_frozen": "v0.7 as-is", "conus_v07_recipe": "v0.7 recipe refit", "conus_logistic": "CONUS logistic",
         "conus_gbt": "CONUS trees"}
HAZARDS = ("tornado", "wind", "hail")


def f(x, fmt="{:+.3f}"):
    return "-" if x is None else fmt.format(x)


def report(study):
    card = json.loads((study / "scorecard.json").read_text())
    sup = json.loads((study / "event-support.json").read_text())
    models = list(next(iter(card["products"].values()))["all_supported"]["models"])
    out = ["# CONUS HRRR first national test (research only)", "",
           f"{card['cases']} cohort cases; fit on {card['fit_dates']} dates (2022-2023), scored on "
           f"{len(card['verification_dates'])} dates in 2024 (exploratory; 2025 sealed). Samples: "
           f"{card['samples']['supported_scored']:,} US-land samples scored, {card['samples']['coast_border_exposed']:,} of them "
           f"coast/border-exposed and scored separately; {card['samples']['unavailable_offshore']:,} offshore samples unavailable.", "",
           "## Brier skill vs 2022-23 climatology (all supported samples)", "",
           "| Product | Event dates / pts | " + " | ".join(NAMES[m] for m in models) + " | CONUS logistic - v0.7 as-is (95%) |",
           "|---|---|" + "---|" * len(models) + "---|"]
    for p, e in card["products"].items():
        a = e["all_supported"]; b = e["bootstrap_all_supported"]["models"]["conus_logistic"]
        out.append(f"| {p} | {a['event_dates']} / {a['event_points']} | " + " | ".join(f(a["models"][m]["brier_skill_vs_climatology"]) for m in models)
                   + f" | {b['brier_minus_reference_95'][0]:+.1e} to {b['brier_minus_reference_95'][1]:+.1e} |")
    out += ["", "## Interior vs coast/border-exposed (BSS)", "", "| Product | Subset | Event dates / pts | " + " | ".join(NAMES[m] for m in models) + " |",
            "|---|---|---|" + "---|" * len(models)]
    for p, e in card["products"].items():
        for s in ("interior", "coast_border_exposed"):
            b = e[s]
            out.append(f"| {p} | {s} | {b['event_dates']} / {b['event_points']} | " + " | ".join(f(b["models"][m]["brier_skill_vs_climatology"]) for m in models) + " |")
    out += ["", "## By region, interior samples (BSS)", "", "| Product | Region | Event dates / pts | " + " | ".join(NAMES[m] for m in models) + " |",
            "|---|---|---|" + "---|" * len(models)]
    for p, e in card["products"].items():
        for r, parts in e["regions"].items():
            b = parts["interior"]
            out.append(f"| {p} | {r} | {b['event_dates']} / {b['event_points']} | " + " | ".join(f(b["models"][m]["brier_skill_vs_climatology"]) for m in models) + " |")
    out += ["", "## Reliability at practical thresholds (all supported, CONUS logistic)", "",
            "| Product | Threshold | Hits | Misses | False alarms | POD | FAR | CSI |", "|---|---|---|---|---|---|---|---|"]
    for p, e in card["products"].items():
        for c in e["all_supported"]["models"]["conus_logistic"]["contingency"]:
            out.append(f"| {p} | {c['threshold']:.0%} | {c['hits']} | {c['misses']} | {c['false_alarms']} | {f(c['pod'], '{:.2f}')} | "
                       f"{f(c['false_alarm_ratio'], '{:.2f}')} | {f(c['csi'], '{:.3f}')} |")
    out += ["", "## Regions and hazards that need more dates before the probabilities can be trusted", "",
            "Rule: fewer than 5 event dates in the 12 verification dates, or fewer than 10 in the 96 training dates.", "",
            "| Product | Region | Train event dates | Verify event dates |", "|---|---|---|---|"]
    for fl in sup["needs_more_dates"]:
        out.append(f"| {fl['product']} | {fl['region']} | {fl['train_event_dates']} | {fl['verify_event_dates']} |")
    (study / "scorecard.md").write_text("\n".join(out) + "\n")


def active_map(arrays, study):
    cases = json.loads((arrays / "dev_cases.json").read_text())
    labels = np.load(arrays / "labels_dev.npy")
    coords = np.load(arrays / "coordinates.npy")
    totals = (labels[:, 0] == 1).sum(axis=(1, 2))
    i = int(np.argmax(totals)); case = cases[i]
    w = future_window(case, 1)
    models = ["v07_frozen", "conus_logistic"]
    fig, axes = plt.subplots(2, 3, figsize=(19, 8.8))
    ol, oa = hrrr_grid.outline(); rings = states()
    for r, m in enumerate(models):
        for c, hz in enumerate(HAZARDS):
            ax = axes[r, c]
            pr = np.load(arrays / f"day1_{hz}_{m}.npy")[i]
            ok = np.isfinite(pr)
            ax.scatter(coords[ok, 0], coords[ok, 1], c=pr[ok], cmap=CMAP, norm=NORM, s=1.6, marker="s", lw=0)
            hit = labels[i, 0, :, c] == 1
            ax.scatter(coords[hit, 0], coords[hit, 1], s=1.2, c="#08306b", marker=".", lw=0)
            draw_states(ax, rings)
            ax.plot([-100, -75, -75, -100, -100], [30, 30, 45, 45, 30], "k--", lw=0.8)
            ax.set_xlim(-126, -66); ax.set_ylim(24, 50); ax.set_aspect(1 / np.cos(np.radians(37)))
            ax.set_xticks([]); ax.set_yticks([])
            ax.set_title(f"{hz.title()} - {NAMES[m]}; {int(hit.sum())} points within 25 mi of a report", fontsize=9)
    fig.suptitle(f"CONUS experimental: Day 1 from the 06Z HRRR of {case} (issued {w['assumed_issuance_time'][:16]}Z), valid "
                 f"{w['valid_start'][:16]}Z to {w['valid_end'][:16]}Z. {DEFINITION}. Dark dots = observed. Offshore not drawn "
                 f"(unavailable). Dashed = old training box. Research only.", fontsize=9.5)
    from matplotlib.patches import Patch
    fig.legend(handles=[Patch(color=col, label=f"{lo:.0%}-{hi:.0%}") for col, lo, hi in zip(COLORS, LEVELS, LEVELS[1:])],
               loc="lower center", ncol=7, fontsize=8, frameon=False)
    fig.tight_layout(rect=(0, 0.04, 1, 0.94))
    fig.savefig(study / f"conus-active-{case}-day1.png", dpi=110)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--study", type=Path, required=True); p.add_argument("--arrays", type=Path, required=True)
    a = p.parse_args()
    report(a.study); active_map(a.arrays, a.study)
