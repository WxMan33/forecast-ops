#!/usr/bin/env python3
"""Research ingestion of operational RRFS and NBM guidance for one explicit forecast cycle.

Bounded: one cycle, one lead day, a hard download budget, byte ranges of named GRIB2 messages
only. Everything goes onto the production 16,413-sample grid and the frozen Day 1 / Day 2 windows
from tools/severe/protocol.py, so the outputs line up with HRRR v0.7 sample for sample.

This produces predictors and raw context layers, never probabilities. It does not touch the
production publisher, the feed, or any 2025 date.

Recorded for every input file: source, key, S3 LastModified (the observed arrival in the public
bucket), size, ETag, and for every message the index line, byte range, SHA-256 and decoded GRIB
identity. Each needed hour is classed on time / late / after window start / missing against the
production schedule. A window with any missing or invalid hour is reported and left without a
features file, rather than filled in.

  python tools/severe/guidance.py --date 2026-11-18 --day 1 --sources rrfs nbm \
      --output tests/out/guidance-20261118-day1 --cache tests/out/guidance-cache
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import Aggregate, Client, decode, digest, disk_max_at_samples, write_json  # noqa: E402
from protocol import check_grid, future_window  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RADIUS_KM = 40.2336
EARTH_KM = 6371.0088

# The production schedule the candidate would have to meet (severe-daily-product.yml).
SCHEDULED_RUN = {1: (9, 30), 2: (15, 30)}

# Native HRRR CONUS grid from the v0.7 input contract; RRFS CONUS 3 km must match it exactly.
HRRR_GRID_KEYS = ("gridType", "Ni", "Nj", "DxInMetres", "DyInMetres", "latitudeOfFirstGridPointInDegrees",
                  "longitudeOfFirstGridPointInDegrees", "LaDInDegrees", "LoVInDegrees", "Latin1InDegrees",
                  "Latin2InDegrees", "iScansNegatively", "jScansPositively")

# Identities verified on the 2026-11-18 06Z cycle (docs/severe-guidance-phase1.md). `hrrr` gives
# the v0.7 identity where RRFS differs; comparable=False means it must not be swapped into a model
# trained on HRRR, only used in a model trained on RRFS itself.
RRFS_FIELDS = {
    "sbcape": {"index": ("CAPE", "surface"), "id": (0, 7, 6, "surface", 0, "J kg**-1"), "comparable": True},
    "sbcin": {"index": ("CIN", "surface"), "id": (0, 7, 7, "surface", 0, "J kg**-1"), "comparable": True},
    "srh01": {"index": ("HLCY", "1000-0 m above ground"), "id": (0, 7, 8, "heightAboveGroundLayer", 1000, "m**2 s**-2"),
              "comparable": True},
    "uh25": {"index": ("MXUPHL", "5000-2000 m above ground"), "id": (0, 7, 199, "heightAboveGroundLayer", 5000, "unknown"),
             "comparable": False,
             "note": "Same 2-5 km hourly maximum, but RRFS (FV3) magnitudes run far above HRRR's; train separately"},
    "reflectivity": {"index": ("REFC", "entire atmosphere (considered as a single layer)"),
                     "id": (0, 16, 5, "atmosphereSingleLayer", 0, "unknown"), "comparable": False,
                     "hrrr": (0, 16, 196, "atmosphere", 0, "dB"),
                     "note": "WMO composite reflectivity (dBZ) vs HRRR's NCEP-local code; RRFS floor is -20 dBZ, HRRR -10"},
    "dewpoint2m": {"index": ("DPT", "2 m above ground"), "id": (0, 0, 6, "heightAboveGround", 2, "K"), "comparable": True},
    "shear06_u": {"index": ("VUCSH", "0-6000 m above ground"), "id": (0, 2, 15, "heightAboveGroundLayer", 0, "s**-1"),
                  "comparable": True, "note": "Labelled s**-1 but values are m s**-1, exactly as in HRRR"},
    "shear06_v": {"index": ("VVCSH", "0-6000 m above ground"), "id": (0, 2, 16, "heightAboveGroundLayer", 0, "s**-1"),
                  "comparable": True, "note": "Labelled s**-1 but values are m s**-1, exactly as in HRRR"},
}

SOURCES = {
    "rrfs": {"bucket": "noaa-rrfs-ops-pds", "model": "rrfs-v1 (operational, CONUS 3 km 2dfld)",
             "prefix": "rrfs.{d}/{h:02d}/", "file": "rrfs.t{h:02d}z.2dfld.3km.f{f:03d}.conus.grib2",
             "cycles": (0, 6, 12, 18)},
    "nbm": {"bucket": "noaa-nbm-grib2-pds", "model": "nbm (operational core, CONUS 2.5 km)",
            "prefix": "blend.{d}/{h:02d}/core/", "file": "blend.t{h:02d}z.core.f{f:03d}.co.grib2",
            "cycles": tuple(range(24))},
}


def url(source, key):
    return f"https://{SOURCES[source]['bucket']}.s3.amazonaws.com/{key}"


def list_prefix(source, prefix, opener=urllib.request.urlopen):
    """{key: {'last_modified', 'size', 'etag'}} for every object under prefix."""
    found, token = {}, None
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if token:
            query["continuation-token"] = token
        body = opener(f"https://{SOURCES[source]['bucket']}.s3.amazonaws.com/?" + urllib.parse.urlencode(query),
                      timeout=60).read().decode()
        for block in re.findall(r"<Contents>(.*?)</Contents>", body, re.S):
            key = re.search(r"<Key>([^<]*)</Key>", block)[1]
            found[key] = {"last_modified": re.search(r"<LastModified>([^<]*)</LastModified>", block)[1].replace(".000Z", "Z"),
                          "size": int(re.search(r"<Size>(\d+)</Size>", block)[1]),
                          "etag": re.search(r"<ETag>([^<]*)</ETag>", block)[1].replace("&quot;", "").strip('"')}
        nxt = re.search(r"<NextContinuationToken>([^<]*)</NextContinuationToken>", body)
        if not nxt:
            return found
        token = nxt[1]


def parse_index(text):
    records = []
    for line in text.splitlines():
        p = line.split(":")
        if len(p) >= 6:
            records.append({"offset": int(p[1]), "var": p[3], "level": p[4], "period": p[5],
                            "extra": ":".join(p[6:]).strip(":"), "line": line})
    if not records or any(a["offset"] >= b["offset"] for a, b in zip(records, records[1:])):
        raise ValueError("Invalid GRIB index offsets")
    return records


def select(records, want, file_size):
    """Exactly one record matching every given key; byte range ends where the next starts."""
    hits = [i for i, r in enumerate(records) if all(r[k] == v for k, v in want.items())]
    if len(hits) != 1:
        raise ValueError(f"{'Missing' if not hits else 'Ambiguous'} index record {want}")
    i = hits[0]
    end = records[i + 1]["offset"] - 1 if i + 1 < len(records) else file_size - 1
    return {"start": records[i]["offset"], "end": end, "index_line": records[i]["line"]}


def deadlines(window):
    """The candidate's deadlines: the scheduled production run, and the start of the window."""
    issue = datetime.fromisoformat(window["model_init_time"])
    hour, minute = SCHEDULED_RUN[window["day"]]
    return {"scheduled_run": issue.replace(hour=hour, minute=minute).isoformat(),
            "window_start": window["valid_start"]}


def classify(meta, limits):
    if meta is None:
        return "missing"
    arrived = datetime.fromisoformat(meta["last_modified"].replace("Z", "+00:00"))
    if arrived <= datetime.fromisoformat(limits["scheduled_run"]):
        return "on_time"
    if arrived <= datetime.fromisoformat(limits["window_start"]):
        return "late"
    return "after_window_start"


def cycle_for(source, window, cycle_hour):
    issue = datetime.fromisoformat(window["model_init_time"])
    cycle = issue.replace(hour=cycle_hour)
    if cycle_hour not in SOURCES[source]["cycles"]:
        raise ValueError(f"{source} has no long-enough cycle at {cycle_hour:02d}Z")
    if cycle > issue:
        raise ValueError("A guidance cycle later than the production initialization is not eligible")
    offset = int((issue - cycle).total_seconds() // 3600)
    return cycle, offset


def availability(source, window, cycle, hours, opener=urllib.request.urlopen):
    prefix = SOURCES[source]["prefix"].format(d=f"{cycle:%Y%m%d}", h=cycle.hour)
    listing = list_prefix(source, prefix, opener)
    limits = deadlines(window)
    rows = []
    for f in hours:
        key = prefix + SOURCES[source]["file"].format(h=cycle.hour, f=f)
        meta, index = listing.get(key), listing.get(key + ".idx")
        rows.append({"forecast_hour": f, "valid_time": (cycle + timedelta(hours=f)).isoformat(), "key": key,
                     "grib": meta, "index": index, "status": classify(meta, limits) if index else "missing"})
    counts = {s: sum(r["status"] == s for r in rows) for s in ("on_time", "late", "after_window_start", "missing")}
    return {"source": source, "bucket": SOURCES[source]["bucket"], "cycle": cycle.isoformat(), "prefix": prefix,
            "deadlines": limits, "arrival_basis": "S3 LastModified of the public object (observed, not assumed)",
            "hours": rows, "counts": counts, "complete_on_time": counts["on_time"] == len(rows)}


# ---------------------------------------------------------------- RRFS


def rrfs_requirements(first, last, offset):
    """Forecast hour -> fields. Valid hour H uses instants at H and the UH maximum over (H, H+1]."""
    need = {}
    for valid in range(first, last):
        f = valid + offset
        need.setdefault(f, set()).update(n for n in RRFS_FIELDS if n != "uh25")
        need.setdefault(f + 1, set()).add("uh25")
    return need


def check_identity(name, metadata):
    expected = RRFS_FIELDS[name]["id"]
    got = (metadata["discipline"], metadata["parameterCategory"], metadata["parameterNumber"],
           metadata["typeOfLevel"], metadata["level"], metadata["units"])
    if got != expected:
        raise ValueError(f"RRFS {name} identity {got} differs from verified {expected}")


def ingest_rrfs(window, cycle, offset, avail, client, expected_coordinates, budget_note):
    first, last = window["first_forecast_hour"], window["last_forecast_hour"]
    need = rrfs_requirements(first, last, offset)
    status = {r["forecast_hour"]: r for r in avail["hours"]}
    missing = sorted(f for f in need if status[f]["status"] == "missing")
    if missing:
        return {"status": "incomplete", "missing_forecast_hours": missing, "messages": []}, None
    aggregate, sampled, messages, rows = Aggregate(), {}, [], None
    for f in sorted(need):
        entry = status[f]
        index = client.fetch(url("rrfs", entry["key"] + ".idx"), f"rrfs/{cycle:%Y%m%d%H}/f{f:03d}.idx")
        records = parse_index(index.read_text())
        spec = {n: select(records, {"var": RRFS_FIELDS[n]["index"][0], "level": RRFS_FIELDS[n]["index"][1]},
                          entry["grib"]["size"]) for n in sorted(need[f])}

        def get(item):
            name, sel = item
            path = client.fetch(url("rrfs", entry["key"]), f"rrfs/{cycle:%Y%m%d%H}/f{f:03d}/{name}.grib2",
                                sel["start"], sel["end"])
            return name, path, sel
        with ThreadPoolExecutor(max_workers=4) as pool:
            got = list(pool.map(get, spec.items()))
        for name, path, sel in got:
            data = decode(path, cycle, f, name, coordinates=rows is None)
            if {k: data["geometry"][k] for k in HRRR_GRID_KEYS} != {k: HRRR_GRID[k] for k in HRRR_GRID_KEYS}:
                raise ValueError("RRFS CONUS grid differs from the HRRR native grid")
            check_identity(name, data["metadata"])
            if rows is None:
                w, e, s, n = BOUNDS
                mask = (data["lon"] >= w) & (data["lon"] <= e) & (data["lat"] >= s) & (data["lat"] <= n)
                take = np.zeros(mask.shape, bool)
                take[::STRIDE, ::STRIDE] = True
                rows, cols = np.where(mask & take)
                coords = np.column_stack((data["lon"][rows, cols], data["lat"][rows, cols]))
                grid_check = check_grid(coords, expected_coordinates)
            values = data["values"]
            sampled.setdefault(f, {})[name] = (values[rows, cols], disk_max_at_samples(values, rows, cols))
            messages.append({"forecast_hour": f, "field": name, "key": entry["key"], **sel,
                             "bytes": sel["end"] - sel["start"] + 1, "sha256": digest(path),
                             "metadata": data["metadata"]})
        previous = f - 1
        instants = {k: v for k, v in sampled.get(previous, {}).items() if k != "uh25"}
        if "uh25" in sampled[f] and len(instants) == len(RRFS_FIELDS) - 1:
            pairs = dict(instants)
            pairs["uh25"] = sampled[f]["uh25"]
            features = {}
            for name, (point, nearby) in pairs.items():
                features[name] = point
                features[name + "_nearby_max"] = nearby
            features["shear06"] = np.hypot(pairs["shear06_u"][0], pairs["shear06_v"][0])
            aggregate.add(previous - offset, features)
            del sampled[previous]
    columns, matrix = aggregate.finish(first)
    return ({"status": "complete", "missing_forecast_hours": [], "messages": messages, "grid_check": grid_check,
             "native_grid": "identical to the v0.7 HRRR native grid (checked per message)",
             "feature_names": columns, "budget": budget_note},
            {"coordinates": coords, "features": matrix, "feature_names": np.array(columns)})


# ---------------------------------------------------------------- NBM


def nbm_decode(path, cycle, f, kind, period=None):
    import eccodes as ec
    with open(path, "rb") as stream:
        gid = ec.codes_grib_new_from_file(stream)
        if gid is None:
            raise ValueError("Empty GRIB message")
        try:
            keys = ["dataDate", "dataTime", "startStep", "endStep", "stepType", "units", "discipline",
                    "parameterCategory", "parameterNumber", "typeOfLevel", "level", "missingValue"]
            meta = {k: ec.codes_get(gid, k) for k in keys}
            geometry = {k: ec.codes_get(gid, k) for k in ("gridType", "Ni", "Nj", "DxInMetres", "LaDInDegrees",
                                                          "LoVInDegrees", "latitudeOfFirstGridPointInDegrees",
                                                          "longitudeOfFirstGridPointInDegrees")}
            if meta["dataDate"] != int(f"{cycle:%Y%m%d}") or meta["dataTime"] != cycle.hour * 100:
                raise ValueError("NBM initialization mismatch")
            if kind == "gust":
                ok = (meta["stepType"], meta["startStep"], meta["endStep"], meta["parameterCategory"],
                      meta["parameterNumber"], meta["typeOfLevel"], meta["level"], meta["units"]) == \
                     ("instant", f, f, 2, 22, "heightAboveGround", 10, "m s**-1")
            else:
                ok = (meta["stepType"], meta["startStep"], meta["endStep"], meta["parameterCategory"],
                      meta["parameterNumber"], meta["typeOfLevel"], meta["units"]) == \
                     ("accum", period[0], period[1], 19, 2, "surface", "%")
            if not ok:
                raise ValueError(f"NBM {kind} identity or valid interval differs: {meta}")
            values = np.asarray(ec.codes_get_array(gid, "values"), dtype=np.float32)
            missing = values == meta["missingValue"]
            values[missing] = np.nan
            shape = (geometry["Nj"], geometry["Ni"])
            lat = lon = None
            if NBM_GRID.get("lat") is None:
                lat = ec.codes_get_array(gid, "latitudes").reshape(shape)
                lon = (ec.codes_get_array(gid, "longitudes").reshape(shape) + 180) % 360 - 180
            return values.reshape(shape), meta, geometry, lat, lon, int(missing.sum())
        finally:
            ec.codes_release(gid)


NBM_GRID = {}


def neighborhoods(lat, lon, samples):
    """For each sample, the NBM cells within RADIUS_KM (great-circle chord on the sphere)."""
    from scipy.spatial import cKDTree

    def xyz(la, lo):
        la, lo = np.radians(la), np.radians(lo)
        return np.column_stack((np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)))
    w, e, s, n = BOUNDS
    pad = 1.0
    box = (lon >= w - pad) & (lon <= e + pad) & (lat >= s - pad) & (lat <= n + pad)
    flat = np.flatnonzero(box.ravel())
    tree = cKDTree(xyz(lat.ravel()[flat], lon.ravel()[flat]))
    chord = 2 * np.sin(RADIUS_KM / EARTH_KM / 2)
    members = tree.query_ball_point(xyz(samples[:, 1], samples[:, 0]), chord)
    if any(len(m) == 0 for m in members):
        raise ValueError("A sample has no NBM cell within the neighborhood")
    lengths = np.array([len(m) for m in members])
    nearest = flat[tree.query(xyz(samples[:, 1], samples[:, 0]))[1]]
    return {"index": flat[np.concatenate(members)], "starts": np.concatenate(([0], np.cumsum(lengths)[:-1])),
            "nearest": nearest, "cells_per_sample": [int(lengths.min()), int(np.median(lengths)), int(lengths.max())]}


def neighborhood_max(values, hood):
    flat = values.ravel()[hood["index"]]
    if np.isnan(flat).any():
        raise ValueError("Missing NBM values inside a sample neighborhood")
    return np.maximum.reduceat(flat, hood["starts"])


def nbm_periods(first, last, offset):
    """The two 12-hour thunder periods that tile the window, in forecast hours of the NBM cycle."""
    a, b = first + offset, last + offset
    return [(a, a + 12), (a + 12, b)]


def ingest_nbm(window, cycle, offset, avail, client, samples):
    first, last = window["first_forecast_hour"], window["last_forecast_hour"]
    status = {r["forecast_hour"]: r for r in avail["hours"]}
    gust_hours = [h + offset for h in range(first, last)]
    periods = nbm_periods(first, last, offset)
    need = sorted(set(gust_hours) | {p[1] for p in periods})
    missing = [f for f in need if status[f]["status"] == "missing"]
    if missing:
        return {"status": "incomplete", "missing_forecast_hours": missing, "messages": []}, None
    NBM_GRID.clear()
    messages, hood, gust_max, gust_sum, tstm = [], None, None, None, {}
    for f in need:
        entry = status[f]
        records = parse_index(client.fetch(url("nbm", entry["key"] + ".idx"),
                                           f"nbm/{cycle:%Y%m%d%H}/f{f:03d}.idx").read_text())
        wanted = []
        if f in gust_hours:
            wanted.append(("gust", None, {"var": "GUST", "level": "10 m above ground",
                                          "period": f"{f} hour fcst", "extra": ""}))
        for p in periods:
            if p[1] == f:
                wanted.append((f"tstm_{p[0]}_{p[1]}", p, {"var": "TSTM", "level": "surface",
                                                          "period": f"{p[0]}-{p[1]} hour acc fcst",
                                                          "extra": "probability forecast"}))
        for name, period, want in wanted:
            sel = select(records, want, entry["grib"]["size"])
            path = client.fetch(url("nbm", entry["key"]), f"nbm/{cycle:%Y%m%d%H}/f{f:03d}/{name}.grib2",
                                sel["start"], sel["end"])
            values, meta, geometry, lat, lon, nmiss = nbm_decode(path, cycle, f, "gust" if period is None else "tstm",
                                                                 period)
            if hood is None:
                NBM_GRID.update(geometry=geometry, lat=lat)
                hood = neighborhoods(lat, lon, samples)
            elif geometry != NBM_GRID["geometry"]:
                raise ValueError("NBM grid changed within the cycle")
            nearby = neighborhood_max(values, hood)
            if period is None:
                gust_max = nearby if gust_max is None else np.maximum(gust_max, nearby)
                gust_sum = nearby.astype(np.float64) if gust_sum is None else gust_sum + nearby
            else:
                tstm[name] = {"nearby_max": nearby, "nearest": values.ravel()[hood["nearest"]]}
            messages.append({"forecast_hour": f, "field": name, "key": entry["key"], **sel,
                             "bytes": sel["end"] - sel["start"] + 1, "sha256": digest(path),
                             "metadata": meta, "missing_cells": nmiss})
    names = sorted(tstm)
    columns = ["nbm_gust10m_nearby_max_max", "nbm_gust10m_nearby_max_mean"] + \
              [f"nbm_{n}_nearby_max" for n in names] + [f"nbm_{n}_nearest" for n in names] + ["nbm_tstm12_nearby_max_max"]
    matrix = np.column_stack([gust_max, gust_sum / len(gust_hours)] + [tstm[n]["nearby_max"] for n in names] +
                             [tstm[n]["nearest"] for n in names] +
                             [np.maximum(*[tstm[n]["nearby_max"] for n in names])]).astype(np.float32)
    return ({"status": "complete", "missing_forecast_hours": [], "messages": messages, "feature_names": columns,
             "native_grid": NBM_GRID["geometry"], "cells_per_sample_min_median_max": hood["cells_per_sample"],
             "thunder_periods_forecast_hours": periods,
             "mapping": f"maximum over NBM cells within {RADIUS_KM} km of each sample center, and the nearest cell"},
            {"coordinates": samples, "features": matrix, "feature_names": np.array(columns)})


# ---------------------------------------------------------------- command


def contract():
    model = json.loads((ROOT / "research/severe/baseline-v07/models.json").read_text())["input_contract"]
    return model


CONTRACT = contract()
HRRR_GRID = CONTRACT["native_grid"]
BOUNDS = tuple(CONTRACT["bounds"])
STRIDE = CONTRACT["stride"]


def run(date, day, sources, output, cache, budget_mb=1500, cycles=None, opener=urllib.request.urlopen):
    if date.startswith("2025"):
        raise ValueError("2025 is the protected evaluation year")
    window = future_window(date, day)
    output = Path(output)
    if output.exists():
        raise ValueError("Output must be a new directory; reuse the verified cache to resume")
    with np.load(ROOT / "research/severe/labels-v04/daily-labels.npz", allow_pickle=False) as labels:
        expected = labels["coordinates"]
    client = Client(cache, budget_mb)
    manifest = {"schema_version": 1, "status": "research_inputs_only_not_a_forecast",
                "window": window, "deadlines": deadlines(window), "radius_km": RADIUS_KM,
                "grid": {"samples": int(len(expected)), "bounds": list(BOUNDS), "stride": STRIDE,
                         "sha256": hashlib.sha256(expected.astype("<f8").tobytes()).hexdigest()},
                "production_model_untouched": True, "protected_2025_outcomes_accessed": False, "sources": {}}
    arrays = {}
    issue_hour = datetime.fromisoformat(window["model_init_time"]).hour
    for source in sources:
        cycle_hour = (cycles or {}).get(source, issue_hour)
        cycle, offset = cycle_for(source, window, cycle_hour)
        first, last = window["first_forecast_hour"] + offset, window["last_forecast_hour"] + offset
        hours = list(range(first, last + 1))
        avail = availability(source, window, cycle, hours, opener)
        entry = {"model": SOURCES[source]["model"], "cycle": cycle.isoformat(), "forecast_hours": [first, last],
                 "availability": avail}
        try:
            if source == "rrfs":
                result, data = ingest_rrfs(window, cycle, offset, avail, client, expected,
                                           f"{budget_mb} MB cap")
                entry["field_notes"] = {k: {kk: v[kk] for kk in ("comparable", "note") if kk in v}
                                        for k, v in RRFS_FIELDS.items()}
            else:
                result, data = ingest_nbm(window, cycle, offset, avail, client, expected)
        except (ValueError, OSError) as error:
            result, data = {"status": "failed", "error": str(error), "messages": []}, None
        entry.update(result)
        if data is not None:
            path = output / f"{source}-day{day}-features.npz"
            arrays[path] = data
            entry["features_file"] = path.name
        manifest["sources"][source] = entry
    manifest["downloaded_bytes"] = client.used
    manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    output.mkdir(parents=True)
    for path, data in arrays.items():
        np.savez_compressed(path, **data)
        manifest["sources"][path.name.split("-")[0]]["features_sha256"] = digest(path)
    write_json(output / "manifest.json", manifest)
    return manifest


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--date", required=True, help="Production model date (UTC), e.g. 2026-11-18")
    p.add_argument("--day", type=int, choices=(1, 2), required=True)
    p.add_argument("--sources", nargs="+", choices=sorted(SOURCES), default=["rrfs", "nbm"])
    p.add_argument("--rrfs-cycle", type=int, help="RRFS cycle hour (default: the production initialization hour)")
    p.add_argument("--nbm-cycle", type=int, help="NBM cycle hour (default: the production initialization hour)")
    p.add_argument("--output", required=True)
    p.add_argument("--cache", required=True)
    p.add_argument("--max-download-mb", type=int, default=1500)
    a = p.parse_args(argv)
    cycles = {k: v for k, v in (("rrfs", a.rrfs_cycle), ("nbm", a.nbm_cycle)) if v is not None}
    m = run(a.date, a.day, a.sources, a.output, a.cache, a.max_download_mb, cycles)
    summary = {s: {"status": v["status"], "counts": v["availability"]["counts"]} for s, v in m["sources"].items()}
    print(json.dumps({"window": m["window"]["valid_start"], "downloaded_mb": round(m["downloaded_bytes"] / 1e6, 1),
                      "sources": summary}, indent=1))
    return 0 if all(v["status"] == "complete" for v in m["sources"].values()) else 2


if __name__ == "__main__":
    sys.exit(main())
