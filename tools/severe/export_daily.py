#!/usr/bin/env python3
"""Export a checked candidate into the current research viewer's static feed."""
import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np

from extract import digest
from product import read_model, check_predictor_contract, predict
from protocol import check_grid, future_window


def compact(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(path)


def check_publishable(output, candidate):
    """The viewer refuses unregistered models, and a late or manual rerun of an old date must
    not replace a newer run of the same lead day."""
    registry_path = output / "models.json"
    if not registry_path.exists() or candidate["model_sha256"] not in json.loads(registry_path.read_text())["models"]:
        raise ValueError("The run's model has no registry entry; run tools/severe/model_registry.py first")
    existing = output / f"day{candidate['day']}.json"
    if existing.exists():
        published = json.loads(existing.read_text())
        if datetime.fromisoformat(published["model_init_time"]) > datetime.fromisoformat(candidate["model_init_time"]):
            raise ValueError(f"A newer Day {candidate['day']} run is already published; an older run must not replace it")


def export(source, output, model_path):
    candidate = json.loads((source / "candidate.json").read_text())
    attempt = json.loads((source / "attempt.json").read_text())
    if attempt["status"] != "complete" or attempt["candidate_sha256"] != digest(source / "candidate.json"):
        raise ValueError("A complete checked candidate is required")
    model = read_model(model_path, candidate["model_sha256"])
    root = source / "predictors"
    manifest = json.loads((root / "manifest.json").read_text())
    checked = json.loads((root / "raw-audit.json").read_text())
    day = candidate["day"]
    expected = future_window(candidate["model_init_time"][:10], day)
    if any(candidate.get(k) != value for k, value in expected.items()):
        raise ValueError("Candidate timing differs from the daily contract")
    if (checked["status"] != "passed" or checked["source_messages_checked"] != 192
            or digest(root / "raw-audit.json") != candidate["raw_audit_sha256"]
            or checked["model_init_time"] != candidate["model_init_time"]):
        raise ValueError("Matching raw audit is required")
    check_predictor_contract(model, manifest)
    spec = manifest["products"][0]
    features_path = root / spec["file"]
    if digest(features_path) != spec["sha256"] or spec["sha256"] != candidate["predictor_sha256"]:
        raise ValueError("Predictor checksum mismatch")
    with np.load(features_path, allow_pickle=False) as data:
        predictions = predict(model, day, data["features"], data["feature_names"])
        check_grid(data["coordinates"], np.array(candidate["coordinates"]))
    for hazard, values in predictions.items():
        if not np.allclose(values, candidate["probabilities"][hazard], atol=1e-14, rtol=0):
            raise ValueError("Export probabilities differ from inference")
    with np.load("research/severe/labels-v04/daily-labels.npz", allow_pickle=False) as labels:
        coordinates = labels["coordinates"]
    check_grid(np.asarray(candidate["coordinates"]), coordinates)
    prepared = datetime.fromisoformat(candidate["prepared_at"])
    if prepared.tzinfo is None:
        raise ValueError("Actual preparation time required")
    check_publishable(output, candidate)
    output.mkdir(parents=True, exist_ok=True)
    compact(output / "grid.json", {"coordinates": coordinates.tolist()})
    identity = candidate["model_init_time"][:13].replace("-", "").replace("T", "") + f"-day{day}"
    payload = {k: candidate[k] for k in (
        "valid_start", "valid_end", "model_init_time", "prepared_at", "model_sha256",
        "day", "available_before_target_start", "raw_audit_sha256", "predictor_sha256")}
    payload.update(id=identity, probabilities=candidate["probabilities"])
    compact(output / f"day{day}.json", payload)
    runs = []
    for selected in (1, 2):
        path = output / f"day{selected}.json"
        if not path.exists():
            continue
        product = json.loads(path.read_text())
        runs.append({k: v for k, v in product.items() if k != "probabilities"} | {
            "file": path.name, "sha256": digest(path), "date": product["model_init_time"][:10]})
    compact(output / "index.json", {
        "schema_version": 1, "status": "current_research", "window_hours": 24,
        "radius_km": 40.2336, "feature_schema": expected["feature_schema"],
        "timing_protocol": expected["timing_protocol"], "model_version": "daily research",
        "operational_skill_established": False, "operational_forecast_eligible": False,
        "domain": {"west": -100, "east": -75, "south": 30, "north": 45},
        "grid": {"file": "grid.json", "sha256": digest(output / "grid.json")},
        "runs": runs,
    })
    print(json.dumps({"day": day, "runs": len(runs), "probabilities_reproduced": True}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    args = parser.parse_args()
    export(args.source, args.output, args.model)
