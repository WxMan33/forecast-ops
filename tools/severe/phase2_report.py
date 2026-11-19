#!/usr/bin/env python3
"""Render research/severe/phase2/scorecard.json (+ reproduction, CV, audit) as a Markdown scorecard."""
import argparse
import json
from pathlib import Path

NAMES = {"v07": "v0.7", "phase2_logistic": "P2 logistic", "phase2_gbt": "P2 trees"}


def f(x, fmt="{:.4f}"):
    return "-" if x is None else fmt.format(x)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    args = parser.parse_args()
    s = args.study
    card = json.loads((s / "scorecard.json").read_text())
    repro = json.loads((s / "baseline-reproduction.json").read_text())
    cv = json.loads((s / "cross-validation.json").read_text())
    audit = json.loads((s / "audit.json").read_text())
    maps = json.loads((s / "maps" / "map-days.json").read_text()) if (s / "maps" / "map-days.json").exists() else None
    models = list(next(iter(card["products"].values()))["all_samples"]["models"])
    out = ["# Phase 2 HRRR scorecard (research only)", "",
           f"Verification: {len(card['verification_dates'])} dates in 2024 ({', '.join(card['verification_dates'])}). "
           "Every model is scored on the same dates, points and 24-hour windows. Skill is against the 2022+2023 "
           "event rate. 2024 was already used to choose between earlier versions, so these results are "
           "exploratory; 2025 stays sealed and was not loaded.", "",
           f"v0.7 reproduction: **{'exact' if repro['reproduced'] else 'NOT exact'}** "
           f"(largest Brier difference {max(v['abs_difference'] for v in repro['products'].values()):.1e}, "
           f"largest coefficient difference {max(v['max_abs_coefficient_difference'] for v in repro['products'].values()):.1e}).", ""]
    out += ["## Data used", "", "| Split | Dates | Range | Day 1 dates with no report (any hazard) |", "|---|---|---|---|"]
    for name, sp in audit["splits"].items():
        out.append(f"| {name} | {sp['dates']} | {sp['first']} to {sp['last']} | {sp['quiet_dates_day1']} |")
    out += ["", "| Product | Train 2022 event dates / points | Calibration 2023 | Verification 2024 |", "|---|---|---|---|"]
    for product in card["products"]:
        cells = [f"{audit['splits'][k]['summary'][product]['event_dates']} / {audit['splits'][k]['summary'][product]['event_points']}"
                 for k in ("train", "calibration", "development")]
        out.append(f"| {product} | " + " | ".join(cells) + " |")
    out += ["", "## Headline (all samples, 2024)", "",
            "| Product | Event dates / points | " + " | ".join(f"{NAMES[m]} BSS" for m in models)
            + " | " + " | ".join(f"{NAMES[m]} AP" for m in models[1:] + models[:1]) + " | Paired date bootstrap: P2 logistic minus v0.7 Brier (95%) |",
            "|---|---|" + "---|" * (2 * len(models)) + "---|"]
    for product, e in card["products"].items():
        a = e["all_samples"]
        boot = e["bootstrap_all_samples"]["models"]["phase2_logistic"]
        out.append(f"| {product} | {a['event_dates']} / {a['event_points']} | "
                   + " | ".join(f(a["models"][m]["brier_skill_vs_climatology"], "{:+.3f}") for m in models) + " | "
                   + " | ".join(f(a["models"][m]["average_precision"], "{:.3f}") for m in models[1:] + models[:1]) + " | "
                   + f"{boot['brier_minus_reference_95'][0]:+.2e} to {boot['brier_minus_reference_95'][1]:+.2e} "
                   f"(better on {boot['dates_better_than_reference']} of {e['bootstrap_all_samples']['dates']} dates) |")
    out += ["", "BSS = Brier skill vs 2022+2023 climatology (positive is better). AP = average precision "
            "(area under the precision-recall curve; climatology AP equals the event rate).", "",
            "## Land only and by region (BSS)", "",
            "| Product | Subset | Event dates / points | " + " | ".join(NAMES[m] for m in models) + " |",
            "|---|---|---|" + "---|" * len(models)]
    for product, e in card["products"].items():
        subsets = [("land", e["land"])] + list(e["regions"].items())
        for name, b in subsets:
            out.append(f"| {product} | {name} | {b['event_dates']} / {b['event_points']} | "
                       + " | ".join(f(b["models"][m]["brier_skill_vs_climatology"], "{:+.3f}") for m in models) + " |")
    out += ["", "## Hits, misses and false alarms at practical thresholds (all samples, points)", "",
            "| Product | Threshold | Model | Hits | Misses | False alarms | POD | FAR | CSI |", "|---|---|---|---|---|---|---|---|---|"]
    for product, e in card["products"].items():
        for m in models:
            for c in e["all_samples"]["models"][m]["contingency"]:
                out.append(f"| {product} | {c['threshold']:.0%} | {NAMES[m]} | {c['hits']} | {c['misses']} | {c['false_alarms']} | "
                           f"{f(c['pod'], '{:.2f}')} | {f(c['false_alarm_ratio'], '{:.2f}')} | {f(c['csi'], '{:.3f}')} |")
    out += ["", "## Reliability (all samples)", "",
            "| Product | Model | Bin | Points | Dates | Mean forecast | Observed |", "|---|---|---|---|---|---|---|"]
    for product, e in card["products"].items():
        for m in models:
            for r in e["all_samples"]["models"][m]["reliability"]:
                out.append(f"| {product} | {NAMES[m]} | {r['lower']:.1%}-{r['upper']:.1%} | {r['points']} | {r['dates']} | "
                           f"{r['mean_probability']:.4f} | {r['observed_rate']:.4f} |")
    out += ["", "## Cross-validated recipe check on 2022+2023 (96 dates, month-grouped folds, uncalibrated)", "",
            "| Product | Event dates | Climatology Brier | v0.7 recipe Brier | P2 logistic recipe Brier | v0.7 log loss | P2 log loss |",
            "|---|---|---|---|---|---|---|"]
    for product, c in cv["products"].items():
        out.append(f"| {product} | {c['event_dates']} | {c['climatology_brier']:.5f} | {c['v07_recipe']['brier']:.5f} | "
                   f"{c['phase2_logistic_recipe']['brier']:.5f} | {c['v07_recipe']['log_loss']:.5f} | {c['phase2_logistic_recipe']['log_loss']:.5f} |")
    if maps:
        out += ["", "## Map days", "", f"Active: {maps['active']['case']} ({maps['active']['day1_event_points_land']} Day 1 land points "
                f"within 25 mi of a report). Quiet: {maps['quiet']['case']} ({maps['quiet']['day1_event_points_land']}). "
                f"Rule: {maps['rule']}."]
    (s / "scorecard.md").write_text("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
