#!/usr/bin/env python3
"""CONUS extraction for one cohort case (pilot or batch). Research only; never loads 2025.

For each lead, extracts HRRR predictors on the regional box samples PLUS the pinned CONUS land
samples (research/severe/conus-v1/extra-samples.npz) with the unchanged extractor, re-audits the
raw messages, builds report labels from the same pinned Storm Events files used by the regional
labels, and (when the restored regional case is given) proves that every overlapping point
reproduces the archived regional predictors and labels exactly.
"""
import argparse
import csv
import gzip
import json
import os
import time
from datetime import datetime
from pathlib import Path

import numpy as np

from audit_extraction import audit
from extract import Client, digest, extract, write_json
from labels import HAZARDS, label_window, normalize
from protocol import future_window

ROOT = Path(__file__).resolve().parents[2]
EXTRA = ROOT / "research/severe/conus-v1/extra-samples.npz"
LABEL_SOURCES = ROOT / "research/severe/labels-v04/manifest.json"
# Sealed 2021 verification only: opened when SEVERE_VERIFY_2021=1 and the case is on the sealed list.
VERIFY_2021_SOURCE = ROOT / "research/severe/conus-v1/verify2021/report-source.json"
VERIFY_2021_CASES = ROOT / "research/severe/conus-v1/twostage-verification-2021.json"
REGIONAL_BOX = (-100, -75, 30, 45)
CONUS_BOUNDS = REGIONAL_BOX  # unchanged regional box rule; the pinned list is OR-ed on top
SPOTS = {"Texas (Midland)": (-102.08, 31.94), "Texas (El Paso)": (-106.44, 31.76),
         "Texas (Brownsville)": (-97.50, 25.90), "Florida (Miami)": (-80.19, 25.76),
         "Florida (Tampa)": (-82.46, 27.95), "West (Denver)": (-104.99, 39.74),
         "West (Phoenix)": (-112.07, 33.45), "West (Seattle)": (-122.33, 47.61),
         "West (Sacramento)": (-121.49, 38.58), "New England (Boston)": (-71.06, 42.36),
         "New England (Portland ME)": (-70.26, 43.66), "Northern Plains (Bismarck)": (-100.78, 46.81)}


def in_box(coords):
    w, e, s, n = REGIONAL_BOX
    return (coords[:, 0] >= w) & (coords[:, 0] <= e) & (coords[:, 1] >= s) & (coords[:, 1] <= n)


def events_for(year, cache):
    manifest = json.loads((VERIFY_2021_SOURCE if year == 2021 else LABEL_SOURCES).read_text())
    source = next(s for s in manifest["sources"] if f"_d{year}_" in s["file"])
    path = Client(cache, 60).fetch(source["receipt"]["url"], source["file"], max_bytes=25000000)
    if digest(path) != source["sha256"]:
        raise ValueError(f"Pinned {year} Storm Events file changed")
    with gzip.open(path, "rt", newline="") as stream:
        events, stats = normalize(csv.DictReader(stream))
    return events, {"file": source["file"], "sha256": source["sha256"], "normalization": stats}


def run(case, output, cache, budget_mb=4000):
    sealed_2021 = (case.startswith("2021") and os.environ.get("SEVERE_VERIFY_2021") == "1"
                   and case in json.loads(VERIFY_2021_CASES.read_text())["cases"])
    if not (case.startswith(("2022", "2023", "2024")) or sealed_2021):
        raise ValueError("Only 2022-2024 cohort dates (or a sealed 2021 verification date); 2025 is sealed")
    output = Path(output) / case
    timing, features, labels, coords, windows = {}, [], [], None, []
    events, source = events_for(int(case[:4]), Path(cache) / "reports")
    for day in (1, 2):
        w = future_window(case, day)
        issue = datetime.fromisoformat(w["model_init_time"])
        dest, raw = output / f"day{day}", Path(cache) / case / f"{issue.hour:02d}z"
        started = time.time()
        if not (dest / "manifest.json").exists():
            extract(issue, dest, raw, budget_mb=budget_mb, days=(day,), target_windows=[w],
                    bounds=CONUS_BOUNDS, extra_samples=EXTRA)
        if not (dest / "raw-audit.json").exists():
            audit(dest, raw, dest / "raw-audit.json", extra_samples=EXTRA)
        m = json.loads((dest / "manifest.json").read_text())
        timing[f"day{day}"] = {"seconds": round(time.time() - started, 1), "downloaded_mb": round(m["downloaded_bytes"] / 1e6, 1)}
        with np.load(dest / m["products"][0]["file"], allow_pickle=False) as data:
            x, c, names = data["features"], data["coordinates"], data["feature_names"].tolist()
        if coords is None:
            coords = c
        if not np.array_equal(c, coords):
            raise ValueError("Day 1 and Day 2 grids differ")
        start, end = (datetime.fromisoformat(w[k]) for k in ("valid_start", "valid_end"))
        y, counts = label_window(coords, events, start, end)
        features.append(x)
        labels.append(y)
        windows.append({**w, "label_counts": counts, "predictor_sha256": m["products"][0]["sha256"]})
    path = output / "conus-joined.npz"
    np.savez_compressed(path, coordinates=coords, feature_names=np.array(names), features=np.stack(features),
                        labels=np.stack(labels), hazards=np.array(HAZARDS), days=np.array([1, 2]))
    result = {"case": case, "samples": int(len(coords)), "regional_box_samples": int(in_box(coords).sum()),
              "artifact": {"file": path.name, "sha256": digest(path), "bytes": path.stat().st_size},
              "report_source": source, "windows": windows, "timing": timing,
              "extra_samples_sha256": digest(EXTRA), "protected_2025_outcomes_accessed": False}
    write_json(output / "conus-case.json", result)
    return result


def compare(case, conus_dir, regional_dir):
    """Every regional sample must appear in the CONUS grid with identical predictors and labels."""
    with np.load(Path(conus_dir) / case / "conus-joined.npz", allow_pickle=False) as c, \
            np.load(Path(regional_dir) / "joined.npz", allow_pickle=False) as r:
        cc, rc = c["coordinates"], r["coordinates"]
        lookup = {tuple(p): i for i, p in enumerate(map(tuple, cc))}
        missing = [i for i, p in enumerate(map(tuple, rc)) if p not in lookup]
        if missing:
            return {"status": "failed", "regional_points_missing_from_conus": len(missing)}
        idx = np.array([lookup[tuple(p)] for p in rc])
        if list(c["feature_names"]) != list(r["feature_names"]):
            return {"status": "failed", "reason": "feature names differ"}
        xd = np.abs(c["features"][:, idx].astype(np.float64) - r["features"].astype(np.float64))
        lab = c["labels"][:, idx] != r["labels"]
        # Points whose 25-mile disk crosses the old box edge: nearest box edge closer than 40.2 km.
        lon, lat = rc[:, 0], rc[:, 1]
        kx = 111.32 * np.cos(np.radians(lat))
        edge_km = np.minimum.reduce([(lon + 100) * kx, (-75 - lon) * kx, (lat - 30) * 110.57, (45 - lat) * 110.57])
        boundary = edge_km < 40.2336
        names = list(r["feature_names"])
        per_feature = {n: float(xd[..., i].max()) for i, n in enumerate(names)}
        return {
            "status": "passed" if xd.max() == 0 and not lab.any() else "differences_found",
            "overlap_points": int(len(rc)), "conus_points": int(len(cc)),
            "max_abs_predictor_difference": float(xd.max()),
            "features_with_differences": {k: v for k, v in per_feature.items() if v > 0},
            "label_mismatches_by_day_hazard": {f"day{d + 1}_{h}": int(lab[d, :, i].sum())
                                               for d in range(2) for i, h in enumerate(HAZARDS)},
            "boundary_points": int(boundary.sum()),
            "boundary_max_abs_predictor_difference": float(xd[:, boundary].max()),
            "boundary_label_mismatches": int(lab[:, boundary].sum()),
        }


def spot_checks(case, conus_dir):
    with np.load(Path(conus_dir) / case / "conus-joined.npz", allow_pickle=False) as c:
        coords, x, y, names = c["coordinates"], c["features"], c["labels"], list(c["feature_names"])
    out = {}
    for name, (lon, lat) in SPOTS.items():
        kx = 111.32 * np.cos(np.radians(lat))
        d = np.hypot((coords[:, 0] - lon) * kx, (coords[:, 1] - lat) * 110.57)
        i = int(np.argmin(d))
        out[name] = {"sample": [round(float(v), 3) for v in coords[i]], "distance_km": round(float(d[i]), 1),
                     "inside_regional_box": bool(in_box(coords[i:i + 1])[0]),
                     **{f"day{k + 1}": {"dewpoint2m_max_K": round(float(x[k, i, names.index("x_dewpoint2m_max")]), 1),
                                        "sbcape_max": round(float(x[k, i, names.index("x_sbcape_max")]), 0),
                                        "uh25_nearby_max_max": round(float(x[k, i, names.index("x_uh25_nearby_max_max")]), 1),
                                        "labels": dict(zip(HAZARDS, y[k, i].tolist()))} for k in range(2)}}
    outside = ~in_box(coords)
    out["_new_area_summary"] = {
        "samples_outside_box": int(outside.sum()),
        "all_predictors_finite": bool(np.isfinite(x[:, outside]).all()),
        "event_points_outside_box": {f"day{k + 1}_{h}": int((y[k, outside, i] == 1).sum())
                                     for k in range(2) for i, h in enumerate(HAZARDS)},
        "event_points_inside_box": {f"day{k + 1}_{h}": int((y[k, ~outside, i] == 1).sum())
                                    for k in range(2) for i, h in enumerate(HAZARDS)},
    }
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--regional", type=Path, help="Restored regional case directory (has joined.npz)")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = run(args.case, args.output, args.cache)
    if args.regional:
        result["overlap_check"] = compare(args.case, args.output, args.regional)
    result["spot_checks"] = spot_checks(args.case, args.output)
    if args.report:
        write_json(args.report, result)
    print(json.dumps({k: result[k] for k in ("case", "samples", "timing")} | {"overlap": result.get("overlap_check", {}).get("status")}))


if __name__ == "__main__":
    main()
