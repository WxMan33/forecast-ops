#!/usr/bin/env python3
"""Label the expanded calendar from the exact report files used by v0.4."""
import argparse
import csv
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from cohort import calendar_cases
from daily import windows
from extract import Client, digest, write_json
from labels import HAZARDS, YEARS, label_window, normalize


def build(config_path, output, cache):
    config = json.loads(Path(config_path).read_text())
    cases = calendar_cases(config)
    frozen = Path("research/severe/labels-v04")
    previous = json.loads((frozen / "manifest.json").read_text())
    previous_path = frozen / previous["artifact"]["file"]
    if digest(previous_path) != previous["artifact"]["sha256"]:
        raise ValueError("Frozen labels failed checksum")
    if output.exists():
        raise ValueError("A new label output directory is required")
    client = Client(cache, 60)
    products, matrices, sources = [], [], []
    preserved = 0
    with np.load(previous_path, allow_pickle=False) as original:
        grid = original["coordinates"]
        old_windows = {(p["initialization_date"], p["day"]): p for p in previous["products"]}
        for year in YEARS:
            source = next(s for s in previous["sources"] if f"_d{year}_" in s["file"])
            path = client.fetch(source["receipt"]["url"], source["file"], max_bytes=25000000)
            if digest(path) != source["sha256"]:
                raise ValueError("Pinned report source changed")
            with gzip.open(path, "rt", newline="") as stream:
                events, _ = normalize(csv.DictReader(stream))
            sources.append(source)
            for case in (c for c in cases if c.startswith(str(year))):
                issue = datetime.strptime(case, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
                for window in windows(issue):
                    start, end = (datetime.fromisoformat(window[k]) for k in ("valid_start", "valid_end"))
                    labels, counts = label_window(grid, events, start, end)
                    old = old_windows.get((case, window["day"]))
                    if old:
                        np.testing.assert_array_equal(labels, original["labels"][old["index"]])
                        preserved += 1
                    products.append({
                        "index": len(products), "split": YEARS[year], "initialization_date": case,
                        "day": window["day"], "valid_start": window["valid_start"],
                        "valid_end": window["valid_end"], "counts": counts,
                    })
                    matrices.append(labels)
            print(f"Labeled {year}", flush=True)
        output.mkdir(parents=True)
        path = output / "daily-labels.npz"
        np.savez_compressed(path, coordinates=grid, labels=np.stack(matrices), hazards=np.array(HAZARDS))
    result = {**previous, "cohort": config["calendar_selection"], "products": products,
              "sources": sources, "artifact": {"file": path.name, "sha256": digest(path)},
              "cohort_sha256": digest(Path(config_path)),
              "original_windows_reproduced": preserved}
    if preserved != 72:
        raise ValueError("Every original window must be reproduced")
    write_json(output / "manifest.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    args = parser.parse_args()
    result = build(args.cohort, args.output, args.cache)
    print(json.dumps({"windows": len(result["products"]), "preserved": result["original_windows_reproduced"]}))
