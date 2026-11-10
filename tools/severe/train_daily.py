#!/usr/bin/env python3
"""Fit and score frozen Day 1 and Day 2 HRRR research baselines."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

from protocol import PROTOCOL, SCHEMA, check_grid, future_window


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_cohort(root, config_path):
    config = json.loads(config_path.read_text())
    years = {2022: "train", 2023: "calibration", 2024: "development"}
    cases = [f"{year}-{month:02d}-15" for year in years for month in range(1, 13)]
    if (config["cases"] != cases or config["protocol"] != PROTOCOL
            or config["feature_schema"] != SCHEMA
            or [config[k] for k in ("training_year", "calibration_year", "development_year")] != list(years)):
        raise ValueError("Expected the frozen v0.5 cohort")
    label_root = Path(config["labels"])
    label_manifest = json.loads((label_root / "manifest.json").read_text())
    label_path = label_root / label_manifest["artifact"]["file"]
    label_hash = digest(label_path)
    if label_hash != label_manifest["artifact"]["sha256"]:
        raise ValueError("Frozen labels failed their checksum")
    groups = {split: [] for split in years.values()}
    feature_names = None
    sources = {}
    with np.load(label_path, allow_pickle=False) as truth:
        for case in cases:
            split = years[int(case[:4])]
            case_root = root / f"severe-history-v05-{case}"
            manifest = json.loads((case_root / "case-manifest.json").read_text())
            source = case_root / "joined.npz"
            if (manifest["case"] != case or manifest["timing_protocol"] != PROTOCOL
                    or manifest["feature_schema"] != SCHEMA or manifest["label_artifact_sha256"] != label_hash
                    or manifest["artifact"] != {"file": source.name, "sha256": digest(source)}
                    or [w["day"] for w in manifest["windows"]] != [1, 2]):
                raise ValueError(f"{case}: joined artifact metadata mismatch")
            with np.load(source, allow_pickle=False) as data:
                coordinates = data["coordinates"]
                check_grid(coordinates, truth["coordinates"])
                x, y = data["features"], data["labels"]
                names = data["feature_names"].tolist()
                if feature_names is None:
                    feature_names = names
                if (names != feature_names or len(set(names)) != 34
                        or x.shape != (2, len(coordinates), 34) or not np.isfinite(x).all()
                        or y.shape != (2, len(coordinates), 3)
                        or data["days"].tolist() != [1, 2]
                        or data["hazards"].tolist() != ["tornado", "wind", "hail"]
                        or not np.array_equal(data["hazards"], truth["hazards"])):
                    raise ValueError(f"{case}: unexpected predictors or labels")
                for window in manifest["windows"]:
                    day = window["day"]
                    expected = future_window(case, day)
                    product = label_manifest["products"][window["label_window_index"]]
                    if (any(window.get(k) != v for k, v in expected.items())
                            or window["split"] != split or product["split"] != split
                            or product["initialization_date"] != case or product["day"] != day
                            or any(product[k] != expected[k] for k in ("valid_start", "valid_end"))
                            or not np.array_equal(y[day - 1], truth["labels"][product["index"]])
                            or not np.isin(y[day - 1], [0, 1, 255]).all()):
                        raise ValueError(f"{case}: Day {day} label or timing mismatch")
                groups[split].append((case, x, y))
            sources[case] = manifest["artifact"]["sha256"]
    return groups, feature_names, sources, label_hash


def samples(group, day, hazard):
    features = np.stack([x[day - 1] for _, x, _ in group])
    labels = np.stack([y[day - 1, :, hazard] for _, _, y in group])
    known = labels != 255
    date_rows = np.broadcast_to(np.arange(len(group))[:, None], labels.shape)[known]
    return features[known].astype(np.float64), labels[known], date_rows, int((~known).sum())


def fit_logistic(features, labels, penalty, monotone=False):
    if not 0 < labels.sum() < len(labels):
        raise ValueError("Both outcome classes are required")
    rate = labels.mean()
    initial = np.zeros(features.shape[1] + 1)
    initial[0] = np.log(rate / (1 - rate))

    def objective(params):
        intercept, weights = params[0], params[1:]
        logits = intercept + features @ weights
        residual = expit(logits) - labels
        loss = (np.logaddexp(0, logits) - labels * logits).mean()
        gradient = features.T @ residual / len(labels)
        return (loss + penalty * (weights @ weights) / 2,
                np.r_[residual.mean(), gradient + penalty * weights])

    bounds = [(None, None), (0, None)] if monotone else None
    result = minimize(objective, initial, jac=True, method="L-BFGS-B", bounds=bounds,
                      options={"maxiter": 600, "ftol": 1e-13, "gtol": 1e-8})
    if not result.success or not np.isfinite(result.x).all():
        raise RuntimeError(f"Logistic fit failed: {result.message}")
    return result.x


def support(labels, dates, unknown):
    return {"known_points": len(labels), "positive_points": int(labels.sum()),
            "unknown_points": unknown, "positive_dates": len(np.unique(dates[labels == 1]))}


def scores(labels, logits):
    probability = expit(logits)
    return {"brier": float(np.mean((probability - labels) ** 2)),
            "log_loss": float(np.mean(np.logaddexp(0, logits) - labels * logits)),
            "mean_probability": float(probability.mean())}


def fit_product(groups, day, hazard):
    train, y_train, train_dates, train_unknown = samples(groups["train"], day, hazard)
    cal, y_cal, cal_dates, cal_unknown = samples(groups["calibration"], day, hazard)
    dev, y_dev, dev_dates, dev_unknown = samples(groups["development"], day, hazard)
    mean, scale = train.mean(axis=0), train.std(axis=0)
    scale[scale == 0] = 1
    fit = fit_logistic((train - mean) / scale, y_train, penalty=0.001)
    cal_logits = fit[0] + ((cal - mean) / scale) @ fit[1:]
    calibration = fit_logistic(cal_logits[:, None], y_cal, penalty=0.0001, monotone=True)
    raw = fit[0] + ((dev - mean) / scale) @ fit[1:]
    calibrated = calibration[0] + calibration[1] * raw
    rate = y_train.mean()
    constant = np.full_like(raw, np.log(rate / (1 - rate)))
    baseline = scores(y_dev, constant)
    result = {"train": support(y_train, train_dates, train_unknown),
              "calibration": support(y_cal, cal_dates, cal_unknown),
              "development": support(y_dev, dev_dates, dev_unknown),
              "training_climatology": baseline, "raw": scores(y_dev, raw),
              "calibrated": scores(y_dev, calibrated)}
    for key in ("raw", "calibrated"):
        result[key]["brier_skill_vs_training_climatology"] = (
            1 - result[key]["brier"] / baseline["brier"])
    result["development_by_date"] = [
        {"case": case, "positive_points": int(y_dev[dev_dates == i].sum()),
         "known_points": int((dev_dates == i).sum()),
         "brier": {key: scores(y_dev[dev_dates == i], logits[dev_dates == i])["brier"]
                   for key, logits in (("training_climatology", constant),
                                       ("raw", raw), ("calibrated", calibrated))}}
        for i, (case, _, _) in enumerate(groups["development"]) if (dev_dates == i).any()
    ]
    model = {"feature_mean": mean.tolist(), "feature_scale": scale.tolist(),
             "intercept": float(fit[0]), "coefficients": fit[1:].tolist(),
             "calibration_intercept": float(calibration[0]),
             "calibration_slope": float(calibration[1])}
    return model, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = Path("research/severe/cohort-v05.json")
    groups, names, sources, label_hash = load_cohort(args.history, config)
    metadata = {"feature_schema": SCHEMA, "timing_protocol": PROTOCOL,
                "status": "regional_research_baseline",
                "operational_forecast_eligible": False,
                "historical_public_availability_verified": False,
                "protected_2025_outcomes_accessed": False,
                "cohort_sha256": digest(config), "frozen_labels_sha256": label_hash,
                "joined_artifact_sha256_by_case": sources}
    models, report = {}, {}
    for day in (1, 2):
        for index, hazard in enumerate(("tornado", "wind", "hail")):
            name = f"day{day}_{hazard}"
            models[name], report[name] = fit_product(groups, day, index)
            print(name, json.dumps({k: report[name][k] for k in
                                   ("train", "calibration", "development", "calibrated")}), flush=True)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, payload in (
        ("models.json", {**metadata, "feature_names": names, "products": models}),
        ("development-scores.json", {**metadata, "products": report}),
    ):
        (args.output / name).write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
