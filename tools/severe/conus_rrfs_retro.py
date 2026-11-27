#!/usr/bin/env python3
"""Retrospective RRFS predictors for the Day 2 damaging-wind development pilot.

Plan: research/severe/conus-v1/rrfs/RETROSPECTIVE-PILOT.md (owner approved 2026-11-27; development only).

  extract  issue dates -> <out>/<date>/rrfs-<cyc>z.npz + .json. Source: s3://noaa-rrfs-pds/retro_output_final/
           {summer,winter,spring}/rrfs.YYYYMMDD/HH/rrfs.tHHz.prslev.fNNN.conus.grib2, named byte ranges only.
           Same nine fields, valid hours, 25-mile neighborhood and CONUS samples as the daily collector
           (conus_rrfs.FIELDS). Each hourly index is fetched once; every decoded message is checked for init,
           valid time, step type, units and native grid. Output is a checksummed per-date feature cache
           (float32, supported samples only) that later comparisons reuse.
Archive LastModified times are provenance only: a historical backfill cannot establish real-time availability.
2025 is refused. Never touches the live feed, publisher, registry, the preview, or either collector.
"""
import argparse
import hashlib
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from conus_rrfs import FIELDS, HOURS, RUNS, get

BUCKET = "https://noaa-rrfs-pds.s3.amazonaws.com"
SEASON = {"202307": "summer", "202401": "winter", "202402": "winter", "202405": "spring"}
# Pinned GRIB2 identity (discipline, category, number) per field, the physical units that identity carries,
# and a plausible value range. REFC, MXUPHL and MAXUVV are NCEP-local parameters that eccodes reports as
# 'unknown', so units are pinned by identity rather than by the decoder's label. VUCSH is UPP's 0-6 km
# u-component bulk shear: it is labelled s**-1 but its values are m s**-1 (a known UPP labelling quirk).
IDENT = {"gust": ((0, 2, 22), "m s-1", (0, 120)), "refc": ((0, 16, 5), "dBZ", (-40, 95)),
         "uh25": ((0, 7, 199), "m2 s-2", (0, 5000)), "uh03": ((0, 7, 199), "m2 s-2", (0, 5000)),
         "maxuvv": ((0, 2, 220), "m s-1", (-20, 200)), "wind10max": ((0, 2, 1), "m s-1", (0, 120)),
         "cape_sfc": ((0, 7, 6), "J kg-1", (0, 15000)), "srh01": ((0, 7, 8), "m2 s-2", (-3000, 5000)),
         "shear06": ((0, 2, 15), "m s-1 (u-component bulk shear)", (-150, 150))}
UNITS = {k: v[1] for k, v in IDENT.items()}
VERSION = "rrfs-retro-v1"


def base_url(day, cyc):
    return f"{BUCKET}/retro_output_final/{SEASON[day[:6]]}/rrfs.{day}/{cyc:02d}/rrfs.t{cyc:02d}z.prslev"


def frozen_grid():
    from conus_calibration import check_frozen
    root = Path(__file__).resolve().parents[2] / "research/severe/conus-v1/frozen"
    fitted, sha = check_frozen(root / "models.pkl", root / "manifest.json")
    return np.asarray(fitted["coords"], dtype=float), fitted["keep"], sha


def extract_cycle(date, cyc, coords, keep, workers=12):
    import eccodes as ec
    from extract import disk_max_at_samples
    from conus_hrrr_lag import sample_cells
    day = date.replace("-", "")
    if day.startswith("2025") or day[:6] not in SEASON:
        raise ValueError(f"{date}: not a retrospective pilot date")
    base = datetime.strptime(day, "%Y%m%d").replace(tzinfo=timezone.utc)
    f0 = RUNS[cyc]
    url0 = base_url(day, cyc)
    t0 = time.time()
    hours = range(f0, f0 + HOURS + 1)
    with ThreadPoolExecutor(workers) as ex:
        idx = dict(zip(hours, ex.map(lambda f: get(f"{url0}.f{f:03d}.conus.grib2.idx").decode().splitlines(), hours)))
    jobs = []
    for k in range(HOURS):
        for name, (var, lev, kind) in FIELDS.items():
            f = f0 + k + (1 if kind == "hourmax" else 0)
            lines = idx[f]
            hits = [i for i, l in enumerate(lines) if l.split(":")[3] == var and l.split(":")[4] == lev]
            if len(hits) != 1:
                raise ValueError(f"f{f:03d}: {len(hits)} records for {var} {lev}")
            i = hits[0]
            if i + 1 >= len(lines):
                raise ValueError("record is last in file; open-ended range not supported")
            jobs.append((k, name, kind, f, (int(lines[i].split(":")[1]), int(lines[i + 1].split(":")[1]) - 1)))
    t_idx = time.time() - t0
    with ThreadPoolExecutor(workers) as ex:
        raws = list(ex.map(lambda j: get(f"{url0}.f{j[3]:03d}.conus.grib2", j[4]), jobs))
    t_get = time.time() - t0 - t_idx
    rng_seen = {}
    cells, acc, messages, nbytes = {}, {n: {"max24": None, "max18": None, "sum24": None} for n in FIELDS}, [], 0
    for (k, name, kind, f, rng), raw in zip(jobs, raws):
        gid = ec.codes_new_from_message(raw)
        try:
            m = {x: ec.codes_get(gid, x) for x in ("dataDate", "dataTime", "startStep", "endStep", "stepType", "Nx", "Ny", "gridType",
                                             "discipline", "parameterCategory", "parameterNumber", "DxInMetres")}
            init = datetime.strptime(f"{m['dataDate']}{m['dataTime']:04d}", "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
            expect = base + timedelta(days=1, hours=12 + k + (1 if kind == "hourmax" else 0))
            if init != base + timedelta(hours=cyc) or init + timedelta(hours=m["endStep"]) != expect:
                raise ValueError(f"f{f:03d} {name}: unexpected time identity {m}")
            if kind == "hourmax" and (m["endStep"] - m["startStep"] != 1 or m["stepType"] != "max"):
                raise ValueError(f"f{f:03d} {name}: not a 1 h maximum {m}")
            if kind == "instant" and m["stepType"] != "instant":
                raise ValueError(f"f{f:03d} {name}: not instantaneous {m}")
            if (m["discipline"], m["parameterCategory"], m["parameterNumber"]) != IDENT[name][0]:
                raise ValueError(f"f{f:03d} {name}: GRIB identity {m}, expected {IDENT[name][0]}")
            vals = ec.codes_get_values(gid).reshape(m["Ny"], m["Nx"]).astype(np.float32)
            if "rc" not in cells:
                lat = ec.codes_get_array(gid, "latitudes").reshape(m["Ny"], m["Nx"])
                lon = (ec.codes_get_array(gid, "longitudes").reshape(m["Ny"], m["Nx"]) + 180) % 360 - 180
                cells["rc"] = sample_cells(lat, lon, coords)
                cells["grid"] = {"gridType": m["gridType"], "Nx": m["Nx"], "Ny": m["Ny"], "DxInMetres": m["DxInMetres"]}
                if cells["grid"] != {"gridType": "lambert", "Nx": 1799, "Ny": 1059, "DxInMetres": 3000.0}:
                    raise ValueError(f"unexpected native grid {cells['grid']}")
            if {"gridType": m["gridType"], "Nx": m["Nx"], "Ny": m["Ny"], "DxInMetres": m["DxInMetres"]} != cells["grid"]:
                raise ValueError("native grid changed within the run")
        finally:
            ec.codes_release(gid)
        lo, hi = IDENT[name][2]
        if not np.isfinite(vals).all() or vals.min() < lo or vals.max() > hi:
            raise ValueError(f"f{f:03d} {name}: values outside {lo}..{hi} ({vals.min()}, {vals.max()})")
        rng_seen.setdefault(name, [np.inf, -np.inf])
        rng_seen[name] = [min(rng_seen[name][0], float(vals.min())), max(rng_seen[name][1], float(vals.max()))]
        rows, cols = cells["rc"]
        hood = disk_max_at_samples(vals, rows, cols)
        point = vals[rows, cols].astype(np.float64)
        a = acc[name]
        a["max24"] = hood if a["max24"] is None else np.maximum(a["max24"], hood)
        if k < 18:
            a["max18"] = hood if a["max18"] is None else np.maximum(a["max18"], hood)
        a["sum24"] = point if a["sum24"] is None else a["sum24"] + point
        nbytes += len(raw)
        messages.append({"field": name, "forecast_hour": f, "range": list(rng), "sha256": hashlib.sha256(raw).hexdigest()})
    arrays = {}
    for name, a in acc.items():
        arrays[f"c{cyc:02d}_{name}_nbhdmax24"] = a["max24"][keep].astype(np.float32)
        arrays[f"c{cyc:02d}_{name}_nbhdmax18"] = a["max18"][keep].astype(np.float32)
        arrays[f"c{cyc:02d}_{name}_mean24"] = (a["sum24"] / HOURS)[keep].astype(np.float32)
    meta = {"status": "ok", "cycle": f"{cyc:02d}z", "source": url0 + ".fNNN.conus.grib2", "grid": cells["grid"],
            "messages": len(messages), "downloaded_bytes": nbytes,
            "input_sha256": hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest(),
            "timing_seconds": {"index": round(t_idx, 1), "ranges": round(t_get, 1), "total": round(time.time() - t0, 1)},
            "valid_window": [(base + timedelta(days=1, hours=12)).isoformat(), (base + timedelta(days=2, hours=12)).isoformat()],
            "units": UNITS, "native_value_range": rng_seen}
    return meta, arrays


def extract(a):
    coords, keep, grid_sha = frozen_grid()
    out = Path(a.output)
    for date in a.dates:
        for cyc in a.cycles:
            dest = out / date
            meta_path = dest / f"rrfs-{cyc:02d}z.json"
            if meta_path.exists() and json.loads(meta_path.read_text()).get("status") == "ok":
                print(f"{date} {cyc:02d}Z cached", flush=True)
                continue
            dest.mkdir(parents=True, exist_ok=True)
            try:
                meta, arrays = extract_cycle(date, cyc, coords, keep)
                buf = io.BytesIO()
                np.savez_compressed(buf, sample_index=np.nonzero(keep)[0].astype(np.int32), **arrays)
                data = buf.getvalue()
                (dest / f"rrfs-{cyc:02d}z.npz").write_bytes(data)
                meta["artifact"] = {"file": f"rrfs-{cyc:02d}z.npz", "sha256": hashlib.sha256(data).hexdigest(),
                                    "bytes": len(data), "arrays": sorted(arrays)}
            except Exception as e:  # recorded; the roster logs every dropped date with its reason
                meta = {"status": "failed", "cycle": f"{cyc:02d}z", "error": repr(e)[:600]}
            meta |= {"issue_date": date, "version": VERSION, "frozen_grid_from_sha256": grid_sha,
                     "protected_2025_outcomes_accessed": False}
            meta_path.write_text(json.dumps(meta, indent=1) + "\n")
            print(f"{date} {cyc:02d}Z {meta['status']} {meta.get('timing_seconds', meta.get('error', ''))}", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("--dates", nargs="+", required=True)
    e.add_argument("--cycles", nargs="+", type=int, default=[12])
    e.add_argument("--output", required=True)
    a = p.parse_args()
    {"extract": extract}[a.cmd](a)


if __name__ == "__main__":
    main()
