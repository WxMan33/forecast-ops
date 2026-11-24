#!/usr/bin/env python3
"""Build the viewer's daily model registry from the committed development scores.

The viewer looks up each published run by model_sha256 and shows that product's own
development evidence. All numbers come from the 2024 development dates, which were also
used to choose between model versions, so they are exploratory, not a final evaluation.
2025 outcomes are not read here.

  python tools/severe/model_registry.py           write assets/severe-daily/models.json
  python tools/severe/model_registry.py --check   exit 1 if the committed registry is stale
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "assets/severe-daily/models.json"
PRODUCTS = [f"day{d}_{h}" for d in (1, 2) for h in ("tornado", "wind", "hail")]
SHARED = ("feature_schema", "timing_protocol", "cohort_sha256", "frozen_labels_sha256",
          "joined_artifact_sha256_by_case")
# Rule, fixed before display: a reliability bin is flagged only if it has forecasts on at
# least this many dates and the observed rate is below half or above double the forecast.
FLAG_MIN_DATES, FLAG_RATIO = 3, 2.0


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def product_entry(scores):
    calibrated, development = scores["calibrated"], scores["development"]
    reliability = [{k: b[k] for k in ("lower", "upper", "known_points", "dates",
                                      "mean_probability", "observed_rate")}
                   for b in scores["calibrated_reliability"]]
    flags = []
    for b in reliability:
        if b["lower"] < 0.01 or b["dates"] < FLAG_MIN_DATES:
            continue
        ratio = b["observed_rate"] / b["mean_probability"]
        if ratio < 1 / FLAG_RATIO or ratio > FLAG_RATIO:
            flags.append({"lower": b["lower"], "upper": b["upper"],
                          "direction": "overforecast" if ratio < 1 else "underforecast"})
    skill = calibrated["brier_skill_vs_training_climatology"]
    return {
        "brier_skill_vs_training_climatology": skill,
        "positive_development_skill": skill > 0,
        "mean_probability": calibrated["mean_probability"],
        "observed_rate": development["positive_points"] / development["known_points"],
        "evaluation_dates": len(scores["development_by_date"]),
        "dates_with_reports": development["positive_dates"],
        "reliability": reliability,
        "reliability_flags": flags,
    }


def build():
    models = {}
    for directory in sorted((ROOT / "research/severe").glob("baseline-v*")):
        model_path, scores_path = directory / "models.json", directory / "development-scores.json"
        if not model_path.exists() or not scores_path.exists():
            continue
        match = re.fullmatch(r"baseline-v(\d)(\d)", directory.name)
        if not match:
            raise ValueError(f"Unrecognized model directory {directory.name}")
        model, scores = json.loads(model_path.read_text()), json.loads(scores_path.read_text())
        if any(model.get(k) != scores.get(k) for k in SHARED):
            raise ValueError(f"{directory.name}: scores do not belong to this model's cohort and labels")
        if scores.get("protected_2025_outcomes_accessed") is not False:
            raise ValueError(f"{directory.name}: scores must not use protected 2025 outcomes")
        if sorted(scores["products"]) != sorted(PRODUCTS):
            raise ValueError(f"{directory.name}: all six daily products are required")
        models[sha(model_path)] = {
            "version": f"v{match[1]}.{match[2]}",
            "model_file": str(model_path.relative_to(ROOT)),
            "development_scores_sha256": sha(scores_path),
            "products": {name: product_entry(scores["products"][name]) for name in PRODUCTS},
        }
    return {
        "schema_version": 1,
        "evidence": ("2024 development dates. These dates were also used to choose between model "
                     "versions, so the results are exploratory, not a final evaluation."),
        "skill_reference": "Brier skill against a constant training-period report rate",
        "reliability_flag_rule": (f"Bins from 1% upward with forecasts on at least {FLAG_MIN_DATES} dates "
                                  f"whose observed rate is below 1/{FLAG_RATIO:g} or above {FLAG_RATIO:g} times the mean forecast"),
        "models": models,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = json.dumps(build(), indent=1, allow_nan=False) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != text:
            sys.exit("assets/severe-daily/models.json is stale; run tools/severe/model_registry.py")
        print("Daily model registry matches the committed development scores")
        return
    OUTPUT.write_text(text)
    print(f"Wrote {OUTPUT.relative_to(ROOT)} with {len(json.loads(text)['models'])} models")


if __name__ == "__main__":
    main()
