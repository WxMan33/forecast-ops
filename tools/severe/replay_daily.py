#!/usr/bin/env python3
"""Export frozen Day 1 wind development predictions and a portable replay viewer."""
import argparse
import csv
import gzip
import hashlib
import json
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.special import expit

from extract import Client
from labels import normalize, label_window
from train_daily import digest, load_cohort


def report_source(cache, source):
    """The frozen report file, from the cache when staged (tools/severe/stage_report_source.py),
    otherwise from its original URL. Either way it must be the pinned bytes."""
    path = Client(cache, 30).fetch(source["receipt"]["url"], source["file"], max_bytes=25000000)
    if digest(path) != source["sha256"]:
        raise ValueError("Report source differs from the frozen label source")
    return path


def export(history, output, cache):
    model_path = Path("research/severe/baseline-v06/models.json")
    score_path = Path("research/severe/baseline-v06/development-scores.json")
    models = json.loads(model_path.read_text())
    scores = json.loads(score_path.read_text())
    groups, names, sources, label_hash = load_cohort(history, Path("research/severe/cohort-v05.json"))
    if (models["feature_names"] != names or models["joined_artifact_sha256_by_case"] != sources
            or models["frozen_labels_sha256"] != label_hash
            or scores["joined_artifact_sha256_by_case"] != sources):
        raise ValueError("Model provenance differs from the frozen cohort")
    labels_path = Path("research/severe/labels-v04/manifest.json")
    labels_manifest = json.loads(labels_path.read_text())
    source = next(s for s in labels_manifest["sources"] if "_d2024_" in s["file"])
    report_path = report_source(cache, source)
    with gzip.open(report_path, "rt", newline="") as stream:
        events, _ = normalize(csv.DictReader(stream))
    model = models["products"]["day1_wind"]
    mean, scale, weights = (np.array(model[k]) for k in
                             ("feature_mean", "feature_scale", "coefficients"))
    grid = None
    runs = []
    for case, features, labels in groups["development"]:
        root = history / f"severe-history-v05-{case}"
        manifest = json.loads((root / "case-manifest.json").read_text())
        with np.load(root / "joined.npz", allow_pickle=False) as joined:
            coordinates = joined["coordinates"]
        if grid is None:
            grid = coordinates
        elif not np.array_equal(grid, coordinates):
            raise ValueError("Development grid changed")
        window = manifest["windows"][0]
        start, end = (datetime.fromisoformat(window[k]) for k in ("valid_start", "valid_end"))
        rebuilt, _ = label_window(grid, events, start, end)
        if not np.array_equal(rebuilt[:, 1], labels[0, :, 1]):
            raise ValueError("Independent report reconstruction differs from saved wind labels")
        raw = model["intercept"] + ((features[0].astype(float) - mean) / scale) @ weights
        probability = expit(model["calibration_intercept"] + model["calibration_slope"] * raw)
        known = labels[0, :, 1] != 255
        brier = float(np.mean((probability[known] - labels[0, known, 1]) ** 2))
        expected = next(s for s in scores["products"]["day1_wind"]["development_by_date"]
                        if s["case"] == case)["brier"]["calibrated"]
        if not np.isclose(brier, expected, rtol=0, atol=1e-12):
            raise ValueError("Replay probabilities differ from recorded scores")
        reports = []
        for event in events:
            if event["hazard"] != "wind" or event["uncertainty"] or not start <= event["start"] < end:
                continue
            x, y, z = event["a"]
            lon, lat = np.degrees(np.arctan2(y, x)), np.degrees(np.arctan2(z, np.hypot(x, y)))
            if -100 <= lon <= -75 and 30 <= lat <= 45:
                reports.append({"id": event["id"], "longitude": float(lon), "latitude": float(lat),
                                "time": event["start"].isoformat(),
                                "magnitude_type": event["magnitude_type"]})
        runs.append({"date": case, "model_init_time": window["model_init_time"],
                     "assumed_issuance_time": window["assumed_issuance_time"],
                     "valid_start": window["valid_start"], "valid_end": window["valid_end"],
                     "probabilities": probability.tolist(), "labels": labels[0, :, 1].tolist(),
                     "reports": reports, "reconstructed_brier": brier})
    payload = {"status": "historical_development_replay", "hazard": "wind", "day": 1,
               "window_hours": 24, "radius_km": 40.2336, "coordinates": grid.tolist(), "runs": runs,
               "model_sha256": digest(model_path), "scores_sha256": digest(score_path),
               "reports_source_sha256": source["sha256"], "joined_artifact_sha256_by_case": sources,
               "historical_public_availability_verified": False,
               "operational_forecast_eligible": False, "protected_2025_outcomes_accessed": False}
    output.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    (output / "replay.json").write_text(data + "\n")
    vendor = "\n".join((Path("assets/vendor") / name).read_text() for name in
                       ("d3-array-3.2.4.js", "d3-contour-4.0.2.js", "d3-delaunay-6.0.4.js"))
    contours = Path("assets/severe-research-contours.js").read_text()
    states = Path("assets/severe-research/states.json").read_text()
    template = Path("tools/severe/replay_daily.html").read_text()
    html = template.replace("/*VENDOR*/", vendor + "\n" + contours)
    html = html.replace("/*PAYLOAD*/", "const archive=" + data + ";const states=" + states + ";")
    (output / "replay.html").write_text(html)
    license_root = output / "licenses"
    license_root.mkdir(exist_ok=True)
    for license_path in Path("assets/vendor").glob("d3*-LICENSE"):
        (license_root / license_path.name).write_bytes(license_path.read_bytes())
    (output / "README.txt").write_text(
        "Forecast Ops Day 1 wind historical replay\n\n"
        "Extract this ZIP and open replay.html in a browser. Everything needed for "
        "the map is embedded, so no server or live connection is required.\n"
        "Select any of the 12 calendar-selected 2024 dates. Contours, Dots and Both "
        "use the same calibrated predictions. Black crosses show NCEI wind report records.\n"
        "The 25-mile target and exact 24-hour valid window appear on the map.\n"
        "This is a regional development study. The small cohort and assumed "
        "three-hour issuance lag limit performance claims.\n"
        "The checks file records independent label reconstruction and score reproduction. "
        "Source and model hashes are in replay.json. Third-party licenses are included.\n"
    )
    receipts = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir() if p.is_file()}
    (output / "checks.json").write_text(json.dumps({
        "cases": len(runs), "independent_wind_label_reconstructions_passed": len(runs),
        "brier_reproductions_passed": len(runs), "files": receipts,
        "report_records_in_map": sum(len(r["reports"]) for r in runs),
        "target": "wind reports of at least 50 kt within 25 miles during a 24-hour window",
    }, indent=2) + "\n")
    print(json.dumps({"cases": len(runs), "checks": receipts}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    args = parser.parse_args()
    export(args.history, args.output, args.cache)
