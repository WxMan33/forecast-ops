#!/usr/bin/env python3
"""Produce timestamped experimental Day 1/2 probabilities from audited current HRRR."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.special import expit

from audit_extraction import audit
from extract import digest, extract, write_json
from protocol import PROTOCOL, SCHEMA, future_window

HAZARDS = ("tornado", "wind", "hail")


def read_model(path, expected_sha256):
    if digest(path) != expected_sha256:
        raise ValueError("Model checksum differs from the approved request")
    model = json.loads(path.read_text())
    if model.get("feature_schema") != SCHEMA or model.get("timing_protocol") != PROTOCOL:
        raise ValueError("Model does not support this daily predictor protocol")
    names = model["feature_names"]
    if len(names) != 34 or len(set(names)) != 34:
        raise ValueError("Expected 34 unique feature names")
    for day in (1, 2):
        for hazard in HAZARDS:
            product = model["products"][f"day{day}_{hazard}"]
            for key in ("feature_mean", "feature_scale", "coefficients"):
                values = np.asarray(product[key], dtype=float)
                if values.shape != (34,) or not np.isfinite(values).all():
                    raise ValueError("Invalid fitted feature transform")
            if np.any(np.asarray(product["feature_scale"]) <= 0):
                raise ValueError("Feature scales must be positive")
            scalars = [product[k] for k in ("intercept", "calibration_intercept", "calibration_slope")]
            if not np.isfinite(scalars).all() or product["calibration_slope"] < 0:
                raise ValueError("Invalid fitted calibration")
    return model


def predict(model, day, features, names):
    if names.tolist() != model["feature_names"]:
        raise ValueError("Prediction feature order differs from training")
    if features.ndim != 2 or not len(features) or features.shape[1] != 34 or not np.isfinite(features).all():
        raise ValueError("Incomplete or invalid daily features")
    result = {}
    for hazard in HAZARDS:
        fitted = model["products"][f"day{day}_{hazard}"]
        normalized = (features.astype(float) - fitted["feature_mean"]) / fitted["feature_scale"]
        raw = fitted["intercept"] + normalized @ np.asarray(fitted["coefficients"])
        values = expit(fitted["calibration_intercept"] + fitted["calibration_slope"] * raw)
        if not np.isfinite(values).all():
            raise ValueError("Invalid inferred probabilities")
        result[hazard] = values.tolist()
    return result


def freshness(product, now):
    if now.tzinfo is None:
        raise ValueError("An aware current time is required")
    start = datetime.fromisoformat(product["valid_start"])
    end = datetime.fromisoformat(product["valid_end"])
    published = datetime.fromisoformat(product["prepared_at"])
    if published > now:
        return "unavailable"
    if now >= end:
        return "expired"
    return "upcoming" if now < start else "valid"


def produce(date, day, model_path, model_sha256, output, cache):
    model = read_model(model_path, model_sha256)
    window = future_window(date, day)
    issue = datetime.fromisoformat(window["model_init_time"])
    if issue > datetime.now(timezone.utc):
        raise ValueError("Future initialization requested")
    with np.load("research/severe/labels-v04/daily-labels.npz", allow_pickle=False) as reference:
        coordinates = reference["coordinates"]
    features_root = output / "predictors"
    manifest = extract(issue, features_root, cache, budget_mb=1000, days=(day,),
                       target_windows=[window], expected_coordinates=coordinates)
    checked = audit(features_root, cache, features_root / "raw-audit.json")
    if checked["status"] != "passed" or checked["source_messages_checked"] != 192:
        raise ValueError("Raw predictor audit failed")
    spec = manifest["products"][0]
    source = features_root / spec["file"]
    if digest(source) != spec["sha256"]:
        raise ValueError("Predictor checksum changed")
    with np.load(source, allow_pickle=False) as data:
        probabilities = predict(model, day, data["features"], data["feature_names"])
        grid = data["coordinates"].tolist()
    prepared = datetime.now(timezone.utc)
    candidate = {
        **window, "status": "experimental_research", "prepared_at": prepared.isoformat(),
        "expires_at": window["valid_end"],
        "available_before_target_start": prepared < datetime.fromisoformat(window["valid_start"]),
        "coordinates": grid, "probabilities": probabilities, "model_sha256": model_sha256,
        "predictor_sha256": spec["sha256"], "raw_audit_sha256": digest(features_root / "raw-audit.json"),
        "grid_sha256": manifest["grid_sha256"], "operational_forecast_eligible": False,
        "notice": "Experimental regional probabilities. Development overforecasting remains under review.",
    }
    candidate["freshness_at_preparation"] = freshness(candidate, prepared)
    # Consumers must recompute expiry from valid_end, even after a failed later run.
    write_json(output / "candidate.json", candidate)
    return {"day": day, "model_init_time": window["model_init_time"],
            "candidate_sha256": digest(output / "candidate.json"),
            "prepared_at": candidate["prepared_at"], "expires_at": candidate["expires_at"],
            "available_before_target_start": candidate["available_before_target_start"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True)
    parser.add_argument("--day", required=True, type=int, choices=(1, 2))
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--model-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Each attempt requires a new output directory")
    args.output.mkdir(parents=True)
    attempt = {"date": args.date, "day": args.day, "started_at": datetime.now(timezone.utc).isoformat(),
               "model_sha256": args.model_sha256, "status": "failed"}
    try:
        attempt.update(produce(args.date, args.day, args.model, args.model_sha256, args.output, args.cache))
        attempt["status"] = "complete"
    except Exception as error:
        attempt["error"] = str(error)
        raise
    finally:
        attempt["finished_at"] = datetime.now(timezone.utc).isoformat()
        write_json(args.output / "attempt.json", attempt)


if __name__ == "__main__":
    main()
