#!/usr/bin/env python3
"""Collect one research window of HRRR, RRFS and NBM predictors without publishing."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from audit_extraction import audit
from extract import extract, write_json
from guidance import BOUNDS, ROOT, STRIDE, availability, fetch_receipt, run
from product import check_predictor_contract, read_model
from protocol import future_window


def collect(date, day, output, cache):
    if date.startswith("2025"):
        raise ValueError("2025 is the protected evaluation year")
    window = future_window(date, day)
    issue = datetime.fromisoformat(window["model_init_time"])
    if issue > datetime.now(timezone.utc):
        raise ValueError("The requested initialization is in the future")
    output.mkdir(parents=True, exist_ok=False)
    report = {
        "status": "started", "started_at": datetime.now(timezone.utc).isoformat(),
        "window": window, "sources": {},
    }
    write_json(output / "collection.json", report)

    def save(source, result):
        report["sources"][source] = result
        write_json(output / "collection.json", report)

    hrrr_dir, hrrr_cache = output / "hrrr", cache / "hrrr"
    hrrr = {"model": "hrrr-v4", "status": "failed", "cycle": issue.isoformat()}
    try:
        hours = list(range(window["first_forecast_hour"], window["last_forecast_hour"] + 1))
        hrrr["availability"] = availability("hrrr", window, issue, hours)
        missing = [row["forecast_hour"] for row in hrrr["availability"]["hours"] if row["status"] == "missing"]
        if missing:
            raise ValueError(f"Missing HRRR GRIB/index pairs at forecast hours {missing}")
        with np.load(ROOT / "research/severe/labels-v04/daily-labels.npz", allow_pickle=False) as labels:
            coordinates = labels["coordinates"]
        manifest = extract(issue, hrrr_dir, hrrr_cache, budget_mb=500, days=(day,), stride=STRIDE,
                           bounds=BOUNDS, target_windows=[window], expected_coordinates=coordinates)
        request = json.loads((ROOT / "research/severe/daily-request.json").read_text())
        model = read_model(ROOT / request["model"], request["model_sha256"])
        check_predictor_contract(model, manifest)
        for row in hrrr["availability"]["hours"]:
            f = row["forecast_hour"]
            row["index_fetch"] = fetch_receipt(hrrr_cache / f"f{f:02d}.idx", row["index"])
        for msg in manifest["source_receipts"]:
            row = hrrr["availability"]["hours"][msg["forecast_hour"] - hours[0]]
            if (msg["etag"] or "").strip('"') != row["grib"]["etag"]:
                raise ValueError(f"Fetched HRRR object differs from listing at f{msg['forecast_hour']:02d}")
        checked = audit(hrrr_dir, hrrr_cache, hrrr_dir / "raw-audit.json")
        if checked["status"] != "passed":
            raise ValueError("HRRR raw predictor audit failed")
        product = manifest["products"][0]
        hrrr.update(status="complete", manifest="hrrr/manifest.json",
                    features_file=f"hrrr/{product['file']}", features_sha256=product["sha256"])
    except (ValueError, OSError, RuntimeError) as error:
        hrrr["error"] = str(error)
    save("hrrr", hrrr)

    result = run(date, day, ["rrfs", "nbm"], output / "guidance", cache / "guidance", budget_mb=500)
    for source, entry in result["sources"].items():
        record = {key: entry[key] for key in ("model", "cycle", "status", "error", "features_sha256", "declared_version") if key in entry}
        record.update(manifest="guidance/manifest.json")
        if "features_file" in entry:
            record["features_file"] = f"guidance/{entry['features_file']}"
        save(source, record)

    report["status"] = "complete" if all(x["status"] == "complete" for x in report["sources"].values()) else "partial"
    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    write_json(output / "collection.json", report)
    print(json.dumps(report, indent=2), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True)
    parser.add_argument("--day", type=int, choices=(1, 2), required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    args = parser.parse_args()
    report = collect(args.date, args.day, args.output, args.cache)
    return 0 if report["status"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
