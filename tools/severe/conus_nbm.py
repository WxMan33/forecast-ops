#!/usr/bin/env python3
"""NBM thunder-probability and wind-gust predictors on the CONUS research grid (Day 2 wind).

Pinned by research/severe/conus-v1/nbm/RULES.md:
- cycle: the 12Z NBM core run of the issue date (same initialization as the 12Z HRRR); nothing later;
- thunder: TSTM 12 h probability (%), periods f24-36 and f36-48 (they tile the Day 2 window exactly);
- gust: GUST 10 m (m/s), instants f24-f36 hourly plus f39, f42, f45 (the hours NBM archived in 2022-23;
  current hourly output is subsampled to the same hours);
- mapping: maximum over NBM cells within 40.2336 km of each sample center, and the nearest cell.

  extract  one or more issue dates -> <out>/<date>/nbm.npz + nbm.json (all message checksums,
           listing times, version fingerprint, and whether every object was listed before the cutoff).
Research only; 2025 refused; nothing touches the live feed, publisher or registry.
"""
import argparse
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from extract import Client, digest
from guidance import nbm_decode, parse_index, select, NBM_GRID

ROOT = Path(__file__).resolve().parents[2]
BUCKET = "https://noaa-nbm-grib2-pds.s3.amazonaws.com"
CYCLE = 12
GUST_HOURS = tuple(range(24, 37)) + (39, 42, 45)
TSTM_PERIODS = ((24, 36), (36, 48))
NEED_HOURS = tuple(sorted(set(GUST_HOURS) | {p[1] for p in TSTM_PERIODS}))
CUTOFF_UTC = (15, 10)  # the research preview's daily issuance (15:10 UTC on the issue date)
RADIUS_KM = 40.2336
EARTH_KM = 6371.0088
FEATURES = ("nbm_gust10m_nearby_max_max", "nbm_gust10m_nearby_max_mean",
            "nbm_tstm_24_36_nearby_max", "nbm_tstm_36_48_nearby_max",
            "nbm_tstm_24_36_nearest", "nbm_tstm_36_48_nearest", "nbm_tstm12_nearby_max_max")


def listing(day):
    url = f"{BUCKET}/?list-type=2&prefix=blend.{day}/{CYCLE:02d}/core/&max-keys=1000"
    with urllib.request.urlopen(url, timeout=60) as r:
        body = r.read().decode()
    out = {}
    for block in re.findall(r"<Contents>(.*?)</Contents>", body, re.S):
        key = re.search(r"<Key>([^<]*)</Key>", block)[1]
        out[key] = {"last_modified": re.search(r"<LastModified>([^<]*)</LastModified>", block)[1],
                    "size": int(re.search(r"<Size>(\d+)</Size>", block)[1]),
                    "etag": re.search(r"<ETag>([^<]*)</ETag>", block)[1].replace("&quot;", "").strip('"')}
    return out


HOOD = {}


def neighborhoods(lat, lon, samples):
    from scipy.spatial import cKDTree

    def xyz(la, lo):
        la, lo = np.radians(la), np.radians(lo)
        return np.column_stack((np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)))
    pad = 1.0
    w, e = samples[:, 0].min() - pad, samples[:, 0].max() + pad
    s, n = samples[:, 1].min() - pad, samples[:, 1].max() + pad
    box = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
    flat = np.flatnonzero(box.ravel())
    tree = cKDTree(xyz(lat.ravel()[flat], lon.ravel()[flat]))
    chord = 2 * np.sin(RADIUS_KM / EARTH_KM / 2)
    q = xyz(samples[:, 1], samples[:, 0])
    members = tree.query_ball_point(q, chord)
    lengths = np.array([len(m) for m in members])
    nearest = flat[tree.query(q)[1]]
    # a sample with no cell inside the radius uses its nearest cell only (recorded)
    members = [m if len(m) else [int(np.searchsorted(flat, nearest[i]))] for i, m in enumerate(members)]
    lengths2 = np.array([len(m) for m in members])
    return {"index": flat[np.concatenate(members)], "starts": np.concatenate(([0], np.cumsum(lengths2)[:-1])),
            "nearest": nearest, "cells_per_sample": [int(lengths.min()), int(np.median(lengths)), int(lengths.max())],
            "samples_without_cell_in_radius": int((lengths == 0).sum())}


def hood_max(values, hood):
    flat = values.ravel()[hood["index"]].astype(np.float32)
    flat = np.where(np.isnan(flat), -np.inf, flat)
    out = np.maximum.reduceat(flat, hood["starts"])
    return np.where(np.isinf(out), np.nan, out).astype(np.float32)


def extract_date(date, coords, out_root, cache):
    if not date.startswith(("2022", "2023", "2024", "2026")) or date.startswith("2025"):
        raise ValueError("Only 2022-24 development dates or current 2026 dates; 2025 is sealed")
    day = date.replace("-", "")
    issue = datetime.strptime(day, "%Y%m%d").replace(hour=CYCLE, tzinfo=timezone.utc)
    cutoff = issue.replace(hour=CUTOFF_UTC[0], minute=CUTOFF_UTC[1])
    objs = listing(day)
    client = Client(cache, 3000)
    NBM_GRID.clear()  # decode returns coordinates on the first message of each date
    messages, gmax, gsum, tstm = [], None, None, {}
    last_seen, fingerprint = [], None
    for f in NEED_HOURS:
        key = f"blend.{day}/{CYCLE:02d}/core/blend.t{CYCLE:02d}z.core.f{f:03d}.co.grib2"
        if key not in objs or key + ".idx" not in objs:
            return {"date": date, "status": "missing", "missing_forecast_hour": f}
        last_seen += [objs[key]["last_modified"], objs[key + ".idx"]["last_modified"]]
        idx = client.fetch(f"{BUCKET}/{key}.idx", f"{day}/f{f:03d}.idx", max_bytes=2000000)
        records = parse_index(idx.read_text())
        if f == 36:
            fingerprint = len(records)
        wanted = []
        if f in GUST_HOURS:
            wanted.append(("gust", None, {"var": "GUST", "level": "10 m above ground", "period": f"{f} hour fcst", "extra": ""}))
        for p in TSTM_PERIODS:
            if p[1] == f:
                wanted.append((f"tstm_{p[0]}_{p[1]}", p, {"var": "TSTM", "level": "surface",
                                                         "period": f"{p[0]}-{p[1]} hour acc fcst", "extra": "probability forecast"}))
        for name, period, want in wanted:
            sel = select(records, want, objs[key]["size"])
            path = client.fetch(f"{BUCKET}/{key}", f"{day}/f{f:03d}-{name}.grib2", sel["start"], sel["end"])
            values, meta, geometry, lat, lon, nmiss = nbm_decode(path, issue, f, "gust" if period is None else "tstm", period)
            gkey = json.dumps(geometry, sort_keys=True)
            if lat is not None:
                NBM_GRID.update(geometry=geometry, lat=lat)
                if gkey not in HOOD:
                    HOOD[gkey] = neighborhoods(lat, lon, coords)
            if gkey not in HOOD:
                raise ValueError("NBM grid changed without coordinates")
            hood = HOOD[gkey]
            near = hood_max(values, hood)
            if period is None:
                gmax = near if gmax is None else np.fmax(gmax, near)
                gsum = np.nan_to_num(near).astype(np.float64) if gsum is None else gsum + np.nan_to_num(near)
            else:
                tstm[name] = (near, values.ravel()[hood["nearest"]].astype(np.float32))
            messages.append({"forecast_hour": f, "field": name, "key": key, **sel, "sha256": digest(path),
                             "etag": objs[key]["etag"], "metadata": meta, "missing_cells": nmiss})
            path.unlink()
    feats = np.column_stack([gmax, (gsum / len(GUST_HOURS)).astype(np.float32),
                             tstm["tstm_24_36"][0], tstm["tstm_36_48"][0], tstm["tstm_24_36"][1], tstm["tstm_36_48"][1],
                             np.fmax(tstm["tstm_24_36"][0], tstm["tstm_36_48"][0])]).astype(np.float32)
    out = Path(out_root) / date
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / "nbm.npz", features=feats, feature_names=np.array(FEATURES),
                        coords_sha256=np.array(hashlib.sha256(np.ascontiguousarray(coords, dtype="<f8").tobytes()).hexdigest()))
    latest = max(last_seen)
    on_time = datetime.fromisoformat(latest.replace("Z", "+00:00")) <= cutoff
    meta = {"date": date, "status": "complete", "cycle": issue.isoformat(), "cutoff": cutoff.isoformat(),
            "latest_listed_last_modified": latest, "listed_before_cutoff": on_time,
            "version_fingerprint_f036_index_records": fingerprint, "gust_hours": GUST_HOURS,
            "tstm_periods": TSTM_PERIODS, "feature_names": FEATURES, "messages": messages,
            "neighborhood": {k: v for k, v in hood.items() if k in ("cells_per_sample", "samples_without_cell_in_radius")},
            "artifact": {"file": "nbm.npz", "sha256": digest(out / "nbm.npz")}}
    (out / "nbm.json").write_text(json.dumps(meta, indent=1, default=str) + "\n")
    return {k: meta[k] for k in ("date", "status", "listed_before_cutoff", "version_fingerprint_f036_index_records")}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dates", nargs="+", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--cache", type=Path, default=Path("tests/out/nbm-cache"))
    a = p.parse_args()
    from conus_calibration import check_frozen
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    coords = np.asarray(fitted["coords"], dtype=float)
    status = 0
    for d in a.dates:
        try:
            r = extract_date(d, coords, a.output, a.cache)
        except Exception as e:  # recorded, never silently skipped
            r = {"date": d, "status": "failed", "error": repr(e)[:500]}
            status = 1
        print(json.dumps(r), flush=True)
        (a.output / "status").mkdir(parents=True, exist_ok=True)
        (a.output / "status" / f"{d}.json").write_text(json.dumps(r) + "\n")
    raise SystemExit(status)


if __name__ == "__main__":
    main()
