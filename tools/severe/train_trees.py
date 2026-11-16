#!/usr/bin/env python3
"""Fit one predeclared nonlinear candidate using the existing audited cohort."""
import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import sklearn
from scipy.special import expit
from sklearn.ensemble import HistGradientBoostingClassifier

from cohort import predictor_contract
from train_daily import digest, fit_logistic, load_cohort, samples, scores, support


def fit_product(groups, day, hazard, config):
    train, y_train, train_dates, train_unknown = samples(groups["train"], day, hazard)
    calibration, y_cal, cal_dates, cal_unknown = samples(groups["calibration"], day, hazard)
    development, y_dev, dev_dates, dev_unknown = samples(groups["development"], day, hazard)
    estimator = HistGradientBoostingClassifier(**config["parameters"])
    estimator.fit(train, y_train)
    if estimator.do_early_stopping_ or estimator.n_iter_ != config["parameters"]["max_iter"]:
        raise ValueError("Candidate deviated from the frozen iteration protocol")
    cal_logits = estimator.decision_function(calibration)
    scaling = fit_logistic(cal_logits[:, None], y_cal,
                           penalty=config["calibration_penalty"], monotone=True)
    raw = estimator.decision_function(development)
    calibrated = scaling[0] + scaling[1] * raw
    rate = y_train.mean()
    constant = np.full_like(raw, np.log(rate / (1 - rate)))
    baseline = scores(y_dev, constant)
    result = {
        "train": support(y_train, train_dates, train_unknown),
        "calibration": support(y_cal, cal_dates, cal_unknown),
        "development": support(y_dev, dev_dates, dev_unknown),
        "training_climatology": baseline,
        "raw": scores(y_dev, raw), "calibrated": scores(y_dev, calibrated),
        "calibrated_reliability": [], "development_by_date": [],
    }
    for key in ("raw", "calibrated"):
        result[key]["brier_skill_vs_training_climatology"] = 1 - result[key]["brier"] / baseline["brier"]
    probability = expit(calibrated)
    edges = (0, .001, .01, .02, .05, .10, .15, .30, 1.000001)
    for lower, upper in zip(edges, edges[1:]):
        selected = (probability >= lower) & (probability < upper)
        if selected.any():
            result["calibrated_reliability"].append({
                "lower": lower, "upper": min(upper, 1), "known_points": int(selected.sum()),
                "dates": len(np.unique(dev_dates[selected])),
                "mean_probability": float(probability[selected].mean()),
                "observed_rate": float(y_dev[selected].mean()),
            })
    for i, (case, _, _) in enumerate(groups["development"]):
        selected = dev_dates == i
        if selected.any():
            result["development_by_date"].append({
                "case": case, "known_points": int(selected.sum()),
                "positive_points": int(y_dev[selected].sum()),
                "brier": {name: scores(y_dev[selected], logits[selected])["brier"]
                          for name, logits in (("training_climatology", constant),
                                               ("raw", raw), ("calibrated", calibrated))},
                "tail_30_percent": {
                    "points": int(((probability >= .3) & selected).sum()),
                    "positives": int(y_dev[(probability >= .3) & selected].sum()),
                },
            })
    fitted = {"estimator": estimator, "calibration_intercept": float(scaling[0]),
              "calibration_slope": float(scaling[1])}
    predictions = {"labels": y_dev, "date_indices": dev_dates,
                   "raw": expit(raw), "calibrated": probability}
    return fitted, result, predictions, development, raw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", required=True, type=Path)
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    protocol_path = Path("research/severe/tree-experiment-v08.json")
    config = json.loads(protocol_path.read_text())
    cohort = Path(config["cohort"])
    reference = Path(config["reference_scores"])
    if (digest(cohort) != config["cohort_sha256"]
            or digest(reference) != config["reference_scores_sha256"]
            or config["parameters"]["early_stopping"] is not False
            or config["protected_outcome_year"] != 2025
            or [config[k] for k in ("training_year", "calibration_year", "development_year")] != [2022, 2023, 2024]):
        raise ValueError("Frozen protocol, reference or year split changed")
    if sklearn.__version__ != config["dependencies"]["scikit-learn"]:
        raise ValueError("Candidate requires the pinned sklearn version")
    groups, names, sources, label_hash = load_cohort(args.history, cohort, args.labels)
    baseline = json.loads(reference.read_text())
    if sources != baseline["joined_artifact_sha256_by_case"] or label_hash != baseline["frozen_labels_sha256"]:
        raise ValueError("Candidate and reference must use identical input artifacts")
    if args.output.exists():
        raise ValueError("Each experiment requires a new output directory")
    args.output.mkdir(parents=True)
    first = next(iter(sources))
    source_manifest = args.history / f"severe-history-v07-{first}" / "day1/manifest.json"
    metadata = {key: baseline[key] for key in
                ("feature_schema", "timing_protocol", "frozen_labels_sha256",
                 "historical_public_availability_verified", "cohort_sha256")}
    metadata.update(
        experiment=config["experiment"], protocol_sha256=digest(protocol_path),
        training_code_sha256=digest(Path(__file__)),
        joined_artifact_sha256_by_case=sources,
        input_contract=predictor_contract(json.loads(source_manifest.read_text())),
        feature_names=names, status="fixed_candidate_development_study",
        operational_forecast_eligible=False, protected_2025_outcomes_accessed=False,
        sklearn_version=sklearn.__version__)
    report, artifacts = {}, {}
    for day in (1, 2):
        for hazard_index, hazard in enumerate(("tornado", "wind", "hail")):
            name = f"day{day}_{hazard}"
            fitted, report[name], predictions, x_dev, raw = fit_product(groups, day, hazard_index, config)
            path = args.output / (name + ".joblib")
            joblib.dump({**fitted, "metadata": metadata}, path, compress=3)
            # The round trip uses only our just-written, local, checksum-recorded artifact.
            restored = joblib.load(path)
            np.testing.assert_array_equal(restored["estimator"].decision_function(x_dev), raw)
            prediction_path = args.output / (name + "-predictions.npz")
            np.savez_compressed(prediction_path, **predictions)
            artifacts[name] = {"file": path.name, "sha256": digest(path),
                               "predictions_file": prediction_path.name,
                               "predictions_sha256": digest(prediction_path),
                               "serialization_roundtrip": "passed"}
            print(name, json.dumps(report[name]["calibrated"]), flush=True)
    (args.output / "development-scores.json").write_text(
        json.dumps({**metadata, "products": report}, indent=2, allow_nan=False) + "\n")
    (args.output / "manifest.json").write_text(
        json.dumps({**metadata, "protocol": config, "artifacts": artifacts}, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
