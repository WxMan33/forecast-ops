#!/usr/bin/env python3
"""Extract the locked downburst predictors (criterion 9) for one development date, Day 2 only.

Every GRIB message must match research/severe/conus-v1/downburst/field-contract.json: identity
(discipline, category, number, level type, level), step type, and time window (instantaneous at fH,
hourly max over (H-1, H]). Samples are the CONUS grid: regional box + pinned extra land samples,
stride 5, exactly as tools/severe/conus_pilot.py. Research only; refuses 2021 and 2025.
"""
import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from daily import ROOT, select_ranges
from extract import Client, digest, disk_max_at_samples, write_json

HERE = Path(__file__).resolve().parents[2]
CONTRACT = HERE / "research/severe/conus-v1/downburst/field-contract.json"
EXTRA = HERE / "research/severe/conus-v1/extra-samples.npz"
BOX = (-100, -75, 30, 45)
STRIDE = 5
INSTANT = ("gust", "tmp2m", "dpt2m", "tmp700", "dpt700", "tmp500", "hgt700", "hgt500", "pwat", "ltng")
HOURLY_MAX = ("maxuw", "maxvw", "maxdvv", "maxref1km")
GEOMETRY = ("gridType", "Ni", "Nj", "DxInMetres", "DyInMetres", "latitudeOfFirstGridPointInDegrees",
            "longitudeOfFirstGridPointInDegrees", "LaDInDegrees", "LoVInDegrees", "Latin1InDegrees",
            "Latin2InDegrees", "iScansNegatively", "jScansPositively")
FEATURES = ("wind10_max", "wind10_nearby_max", "gust_max", "gust_nearby_max", "downdraft_max",
            "downdraft_nearby_max", "dd2m_max", "lapse_700_500_max", "dd700_mean", "pwat_max",
            "maxref1km_max", "maxref1km_nearby_max", "ltng_max", "ltng_nearby_max")


def decode(path, contract, name, issue, hour, coords=False):
    import eccodes as ec
    with open(path, "rb") as f:
        g = ec.codes_grib_new_from_file(f)
        if g is None:
            raise ValueError(f"{name} f{hour}: empty GRIB message")
        try:
            meta = {k: ec.codes_get(g, k) for k in ("dataDate", "dataTime", "startStep", "endStep", "stepType",
                                                   "discipline", "parameterCategory", "parameterNumber",
                                                   "typeOfLevel", "level", "numberOfMissing", "stepUnits")}
            spec = contract["fields"][name]
            ident = [meta["discipline"], meta["parameterCategory"], meta["parameterNumber"], meta["typeOfLevel"], meta["level"]]
            if ident != spec["id"]:
                raise ValueError(f"{name} f{hour}: identity {ident} != contract {spec['id']}")
            if meta["dataDate"] != int(issue.strftime("%Y%m%d")) or meta["dataTime"] != issue.hour * 100:
                raise ValueError(f"{name} f{hour}: wrong initialization")
            want = (hour - 1, hour, "max") if spec["stepType"] == "max" else (hour, hour, "instant")
            if (meta["startStep"], meta["endStep"], meta["stepType"]) != want:
                raise ValueError(f"{name} f{hour}: time window {meta['startStep']}-{meta['endStep']} {meta['stepType']} != {want}")
            if meta["stepUnits"] != 1:
                raise ValueError(f"{name} f{hour}: step units are not hours")
            if meta["numberOfMissing"]:
                raise ValueError(f"{name} f{hour}: {meta['numberOfMissing']} missing values")
            shape = (ec.codes_get(g, "Nj"), ec.codes_get(g, "Ni"))
            v = np.asarray(ec.codes_get_array(g, "values"), dtype=np.float32).reshape(shape)
            if not np.isfinite(v).all() or np.abs(v).max() > 1e6:
                raise ValueError(f"{name} f{hour}: invalid values")
            geometry = {k: ec.codes_get(g, k) for k in GEOMETRY}
            if geometry["gridType"] != "lambert" or geometry["DxInMetres"] != 3000 or geometry["DyInMetres"] != 3000:
                raise ValueError(f"{name} f{hour}: unsupported native grid")
            out = {"values": v, "meta": meta, "geometry": geometry}
            if coords:
                out["lat"] = ec.codes_get_array(g, "latitudes").reshape(shape)
                out["lon"] = (ec.codes_get_array(g, "longitudes").reshape(shape) + 180) % 360 - 180
            second = ec.codes_grib_new_from_file(f)
            if second is not None:
                ec.codes_release(second)
                raise ValueError(f"{name} f{hour}: expected exactly one GRIB message")
            return out
        finally:
            ec.codes_release(g)


def samples(d):
    w, e, s_, nn = BOX
    mask = (d["lon"] >= w) & (d["lon"] <= e) & (d["lat"] >= s_) & (d["lat"] <= nn)
    with np.load(EXTRA, allow_pickle=False) as ex:
        er, ecol = ex["rows"], ex["cols"]
    if (er % STRIDE).any() or (ecol % STRIDE).any():
        raise ValueError("Extra samples must lie on the stride lattice")
    mask[er, ecol] = True
    sample = np.zeros(mask.shape, bool)
    sample[::STRIDE, ::STRIDE] = True
    rows, cols = np.where(mask & sample)
    return rows, cols, np.column_stack((d["lon"][rows, cols], d["lat"][rows, cols]))


def run_wind(case, output, cache, budget_mb=200):
    """Amendment 9a: the direct hourly max 10 m wind speed (WIND 10 m max), f25-f48 -> valid hours 24-47."""
    if not case.startswith(("2022", "2023")):
        raise ValueError("Development dates only (2022-23)")
    contract = json.loads(CONTRACT.read_text())
    target = tuple(contract["fields"]["wind10max"]["index"])
    issue = datetime.strptime(case, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
    client = Client(Path(cache) / case, budget_mb)
    rows = cols = coords = geometry = None
    point = nearby = None
    receipts = []
    for hour in range(25, 49):
        url = f"{ROOT}/hrrr.{issue:%Y%m%d}/conus/hrrr.t12z.wrfsfcf{hour:02d}.grib2"
        idx = client.fetch(url + ".idx", f"f{hour:02d}.idx")
        sel = select_ranges(idx.read_text(), {"wind10max": target})["wind10max"]
        pth = client.fetch(url, f"f{hour:02d}/wind10max.grib2", sel["start"], sel["end"])
        d = decode(pth, contract, "wind10max", issue, hour, coords=rows is None)
        if geometry is None:
            geometry = d["geometry"]
        if d["geometry"] != geometry:
            raise ValueError(f"f{hour}: native grid changed")
        if rows is None:
            rows, cols, coords = samples(d)
        v = d["values"]
        a, b = v[rows, cols].astype(np.float64), disk_max_at_samples(v, rows, cols).astype(np.float64)
        point = a if point is None else np.maximum(point, a)
        nearby = b if nearby is None else np.maximum(nearby, b)
        receipts.append({"hour": hour, "field": "wind10max", "sha256": digest(pth)})
    out = Path(output) / case
    out.mkdir(parents=True, exist_ok=True)
    path = out / "day2-wind10max.npz"
    names = ("wind10_max", "wind10_nearby_max")
    np.savez_compressed(path, coordinates=coords, features=np.column_stack((point, nearby)).astype(np.float32),
                        feature_names=np.array(names))
    manifest = {"case": case, "day": 2, "cycle": "12Z", "forecast_hours": "25-48", "samples": int(len(coords)),
                "features": list(names), "amendment": "9a", "artifact": {"file": path.name, "sha256": digest(path)},
                "contract_sha256": digest(CONTRACT), "extra_samples_sha256": digest(EXTRA), "messages": len(receipts),
                "receipts_sha256": hashlib.sha256(json.dumps(receipts).encode()).hexdigest(),
                "downloaded_mb": round(client.used / 1e6, 1), "protected_2025_outcomes_accessed": False}
    write_json(out / "wind10max-case.json", manifest)
    return manifest


def run(case, output, cache, budget_mb=1500):
    if not case.startswith(("2022", "2023")):
        raise ValueError("Development dates only (2022-23); 2021, 2024 and 2025 are not extracted here")
    contract = json.loads(CONTRACT.read_text())
    fields = {n: tuple(s["index"]) for n, s in contract["fields"].items()}
    issue = datetime.strptime(case, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
    client = Client(Path(cache) / case, budget_mb)
    rows = cols = coords = geometry = None
    acc = {f: None for f in FEATURES}
    sums = {}
    receipts = []
    for hour in range(24, 49):
        need = {n: fields[n] for n in (INSTANT if hour < 48 else ())}
        if hour > 24:
            need.update({n: fields[n] for n in HOURLY_MAX})
        url = f"{ROOT}/hrrr.{issue:%Y%m%d}/conus/hrrr.t12z.wrfsfcf{hour:02d}.grib2"
        idx = client.fetch(url + ".idx", f"f{hour:02d}.idx")
        spec = select_ranges(idx.read_text(), need)

        def get(item):
            n, s = item
            return n, client.fetch(url, f"f{hour:02d}/{n}.grib2", s["start"], s["end"])
        with ThreadPoolExecutor(max_workers=4) as pool:
            paths = dict(pool.map(get, spec.items()))
        dec = {}
        for n, pth in paths.items():
            d = decode(pth, contract, n, issue, hour, coords=rows is None)
            if geometry is None:
                geometry = d["geometry"]
            if d["geometry"] != geometry:
                raise ValueError(f"{n} f{hour}: native grid changed")
            if rows is None:
                rows, cols, coords = samples(d)
            dec[n] = d["values"]
            receipts.append({"hour": hour, "field": n, "sha256": digest(pth)})

        def upd(key, vec, how="max"):
            vec = vec.astype(np.float64)
            if how == "mean":
                sums[key] = sums.get(key, 0) + vec
            else:
                acc[key] = vec.copy() if acc[key] is None else np.maximum(acc[key], vec)
        if hour > 24:  # hourly-max fields at f(H+1) describe valid hour H = hour - 1
            # Component-max proxy (amendment 9a): stored as wind10_* here, relabelled downstream.
            speed = np.hypot(dec["maxuw"], dec["maxvw"])
            upd("wind10_max", speed[rows, cols]); upd("wind10_nearby_max", disk_max_at_samples(speed, rows, cols))
            down = -dec["maxdvv"]
            upd("downdraft_max", down[rows, cols]); upd("downdraft_nearby_max", disk_max_at_samples(down, rows, cols))
            ref = dec["maxref1km"]
            upd("maxref1km_max", ref[rows, cols]); upd("maxref1km_nearby_max", disk_max_at_samples(ref, rows, cols))
        if hour < 48:  # instantaneous fields at fH describe valid hour H
            g = dec["gust"]
            upd("gust_max", g[rows, cols]); upd("gust_nearby_max", disk_max_at_samples(g, rows, cols))
            upd("dd2m_max", (dec["tmp2m"] - dec["dpt2m"])[rows, cols])
            dz = (dec["hgt500"] - dec["hgt700"])[rows, cols] / 1000.0
            if (dz <= 0).any():
                raise ValueError(f"f{hour}: non-positive 700-500 mb thickness")
            upd("lapse_700_500_max", (dec["tmp700"] - dec["tmp500"])[rows, cols] / dz)
            upd("dd700_mean", (dec["tmp700"] - dec["dpt700"])[rows, cols], "mean")
            upd("pwat_max", dec["pwat"][rows, cols])
            l = dec["ltng"]
            upd("ltng_max", l[rows, cols]); upd("ltng_nearby_max", disk_max_at_samples(l, rows, cols))
        print(f"{case} f{hour:02d}: {client.used / 1e6:.0f} MB", flush=True)
    acc["dd700_mean"] = sums["dd700_mean"] / 24.0
    matrix = np.column_stack([acc[f] for f in FEATURES]).astype(np.float32)
    if not np.isfinite(matrix).all():
        raise ValueError("Non-finite features")
    out = Path(output) / case
    out.mkdir(parents=True, exist_ok=True)
    path = out / "day2-downburst.npz"
    np.savez_compressed(path, coordinates=coords, features=matrix, feature_names=np.array(FEATURES))
    manifest = {"case": case, "day": 2, "cycle": "12Z", "forecast_hours": "24-48", "samples": int(len(coords)),
                "features": list(FEATURES), "artifact": {"file": path.name, "sha256": digest(path)},
                "contract_sha256": digest(CONTRACT), "extra_samples_sha256": digest(EXTRA),
                "messages": len(receipts), "receipts_sha256": hashlib.sha256(json.dumps(receipts).encode()).hexdigest(),
                "downloaded_mb": round(client.used / 1e6, 1), "protected_2025_outcomes_accessed": False}
    write_json(out / "downburst-case.json", manifest)
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--case", required=True); p.add_argument("--output", type=Path, required=True)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--wind-only", action="store_true", help="Amendment 9a: direct hourly max 10 m wind speed only")
    a = p.parse_args()
    m = (run_wind if a.wind_only else run)(a.case, a.output, a.cache)
    print(json.dumps({k: m[k] for k in ("case", "samples", "messages", "downloaded_mb")}))


if __name__ == "__main__":
    main()
