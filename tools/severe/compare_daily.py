#!/usr/bin/env python3
"""Compare fixed-date candidate scores with the original daily baseline."""
import argparse
import json
from pathlib import Path

import numpy as np

from train_daily import digest


def compare(original_path, candidate_path, output):
    original = json.loads(original_path.read_text())
    candidate = json.loads(candidate_path.read_text())
    if (original["feature_schema"] != candidate["feature_schema"]
            or original["timing_protocol"] != candidate["timing_protocol"]):
        raise ValueError("Forecast targets differ")
    result = {
        "original_scores_sha256": digest(original_path),
        "candidate_scores_sha256": digest(candidate_path),
        "comparison": "candidate minus original calibrated Brier score; negative is improvement",
        "resampling_unit": "whole evaluation date",
        "bootstrap_replicates": 10000,
        "bootstrap_seed": 20261116,
        "operational_forecast_eligible": False,
        "products": {},
    }
    rng = np.random.default_rng(result["bootstrap_seed"])
    for name, baseline in original["products"].items():
        revised = candidate["products"][name]
        old_dates = {r["case"]: r for r in baseline["development_by_date"]}
        new_dates = {r["case"]: r for r in revised["development_by_date"]}
        if len(old_dates) != 12 or set(old_dates) != set(new_dates):
            raise ValueError("The original 12 evaluation dates must stay fixed")
        dates = sorted(old_dates)
        if any(old_dates[d]["known_points"] != new_dates[d]["known_points"]
               or old_dates[d]["positive_points"] != new_dates[d]["positive_points"] for d in dates):
            raise ValueError("Evaluation labels or population changed")
        difference = np.array([new_dates[d]["brier"]["calibrated"]
                               - old_dates[d]["brier"]["calibrated"] for d in dates])
        draws = rng.integers(0, len(dates), size=(result["bootstrap_replicates"], len(dates)))
        ci = np.quantile(difference[draws].mean(axis=1), [0.025, 0.975]).tolist()
        result["products"][name] = {
            "original_train": baseline["train"], "candidate_train": revised["train"],
            "original_calibration": baseline["calibration"], "candidate_calibration": revised["calibration"],
            "evaluation_dates": dates, "original_brier": baseline["calibrated"]["brier"],
            "candidate_brier": revised["calibrated"]["brier"],
            "mean_date_brier_difference": float(difference.mean()), "paired_date_ci95": ci,
            "candidate_reliability": revised["calibrated_reliability"],
            "date_differences": dict(zip(dates, difference.tolist())),
        }
        print(name, json.dumps({k: result["products"][name][k] for k in
                               ("original_brier", "candidate_brier", "paired_date_ci95")}), flush=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    compare(args.original, args.candidate, args.output)
