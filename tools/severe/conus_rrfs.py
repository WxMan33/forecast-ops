#!/usr/bin/env python3
"""Daily CONUS RRFS predictor collection for the Day 2 damaging-wind research archive (Step A).

Research collection only: no model is fitted and nothing is shown anywhere. Rules:
research/severe/conus-v1/rrfs/COLLECTION.md.

  collect  one issue date: the operational RRFS 06Z and 12Z runs over the Day 2 window
           (12Z D+1 .. 12Z D+2), mapped to every CONUS research sample with the existing 25-mile neighborhood
           rule. Each cycle is checked against the 15:10 UTC cutoff separately; a missing, late or failed cycle
           is logged with its reason, and the other cycle is still saved.
  tally    the separate CONUS coverage tally (per cycle and both cycles).
Never touches the live feed, publisher, registry, the preview, or the regional collector.
"""
import argparse
import hashlib
import io
import json
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BUCKET = "https://noaa-rrfs-ops-pds.s3.amazonaws.com"
ARCHIVE = ROOT / "research/severe/conus-v1/rrfs/collection"
START = "2026-11-26"
CUTOFF_UTC = (15, 10)
# name -> (GRIB var, level text in the .idx, kind). "hourmax" fields are 1 h maxima ending at the step and
# are paired with valid hour H through step H+1, as in the HRRR extractor.
FIELDS = {
    "gust": ("GUST", "surface", "instant"),
    "refc": ("REFC", "entire atmosphere (considered as a single layer)", "instant"),
    "uh25": ("MXUPHL", "5000-2000 m above ground", "hourmax"),
    "uh03": ("MXUPHL", "3000-0 m above ground", "hourmax"),
    "maxuvv": ("MAXUVV", "100-1000 mb", "hourmax"),
    "wind10max": ("WIND", "10 m above ground", "hourmax"),
    "cape_sfc": ("CAPE", "surface", "instant"),
    "srh01": ("HLCY", "1000-0 m above ground", "instant"),
    "shear06": ("VUCSH", "0-6000 m above ground", "instant"),
}
RUNS = {12: 24, 6: 30}  # cycle -> forecast hour of the first valid hour (12Z D+1)
HOURS = 24


def get(url, rng=None):
    req = urllib.request.Request(url, headers={"Range": f"bytes={rng[0]}-{rng[1]}"} if rng else {})
    err = None
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if rng and len(data) != rng[1] - rng[0] + 1:
                raise IOError("short read")
            return data
        except Exception as e:
            err = e
    raise err


def listing(day, cyc):
    body = get(f"{BUCKET}/?list-type=2&prefix=rrfs.{day}/{cyc:02d}/rrfs.t{cyc:02d}z.2dfld.3km.f0&max-keys=1000").decode()
    return dict(re.findall(r"<Key>([^<]*)</Key><LastModified>([^<]*)</LastModified>", body))


def collect_cycle(date, cyc, coords, cells):
    import eccodes as ec
    from extract import disk_max_at_samples
    day = date.replace("-", "")
    base = datetime.strptime(day, "%Y%m%d").replace(tzinfo=timezone.utc)
    cutoff = base.replace(hour=CUTOFF_UTC[0], minute=CUTOFF_UTC[1])
    f0 = RUNS[cyc]
    need_hours = range(f0, f0 + HOURS + 1)
    objs = listing(day, cyc)
    keys = [f"rrfs.{day}/{cyc:02d}/rrfs.t{cyc:02d}z.2dfld.3km.f{f:03d}.conus.grib2{s}" for f in need_hours for s in ("", ".idx")]
    missing = [k for k in keys if k not in objs]
    if missing:
        return {"status": "missing", "missing": missing[:6], "missing_count": len(missing)}, None
    latest = max(objs[k] for k in keys)
    if datetime.fromisoformat(latest.replace("Z", "+00:00")) > cutoff:
        return {"status": "listed_after_cutoff", "latest_listed": latest, "cutoff": cutoff.isoformat()}, None
    acc = {n: {"max24": None, "max18": None, "sum24": None} for n in FIELDS}
    messages = []
    for k in range(HOURS):
        for name, (var, lev, kind) in FIELDS.items():
            f = f0 + k + (1 if kind == "hourmax" else 0)
            url = f"{BUCKET}/rrfs.{day}/{cyc:02d}/rrfs.t{cyc:02d}z.2dfld.3km.f{f:03d}.conus.grib2"
            lines = get(url + ".idx").decode().splitlines()
            hits = [i for i, l in enumerate(lines) if l.split(":")[3] == var and l.split(":")[4] == lev]
            if len(hits) != 1:
                raise ValueError(f"{url}: {len(hits)} records for {var} {lev}")
            i = hits[0]
            rng = (int(lines[i].split(":")[1]), int(lines[i + 1].split(":")[1]) - 1)
            raw = get(url, rng)
            gid = ec.codes_new_from_message(raw)
            try:
                m = {x: ec.codes_get(gid, x) for x in ("dataDate", "dataTime", "startStep", "endStep", "stepType", "Nx", "Ny")}
                init = datetime.strptime(f"{m['dataDate']}{m['dataTime']:04d}", "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
                valid_end = init + timedelta(hours=m["endStep"])
                expect = base + timedelta(days=1, hours=12 + k + (1 if kind == "hourmax" else 0))
                if init.hour != cyc or valid_end != expect or (kind == "hourmax" and m["endStep"] - m["startStep"] != 1):
                    raise ValueError(f"{url} {name}: unexpected time identity {m}")
                vals = ec.codes_get_values(gid).reshape(m["Ny"], m["Nx"]).astype(np.float32)
                if "rc" not in cells:
                    from conus_hrrr_lag import sample_cells
                    lat = ec.codes_get_array(gid, "latitudes").reshape(m["Ny"], m["Nx"])
                    lon = (ec.codes_get_array(gid, "longitudes").reshape(m["Ny"], m["Nx"]) + 180) % 360 - 180
                    cells["rc"] = sample_cells(lat, lon, coords)
                    cells["shape"] = (m["Ny"], m["Nx"])
                if (m["Ny"], m["Nx"]) != cells["shape"]:
                    raise ValueError("native grid changed")
            finally:
                ec.codes_release(gid)
            rows, cols = cells["rc"]
            hood = disk_max_at_samples(vals, rows, cols)
            point = vals[rows, cols].astype(np.float64)
            a = acc[name]
            a["max24"] = hood if a["max24"] is None else np.maximum(a["max24"], hood)
            if k < 18:
                a["max18"] = hood if a["max18"] is None else np.maximum(a["max18"], hood)
            a["sum24"] = point if a["sum24"] is None else a["sum24"] + point
            messages.append({"field": name, "forecast_hour": f, "range": rng, "sha256": hashlib.sha256(raw).hexdigest()})
    arrays = {}
    for name, a in acc.items():
        arrays[f"c{cyc:02d}_{name}_nbhdmax24"] = a["max24"]
        arrays[f"c{cyc:02d}_{name}_nbhdmax18"] = a["max18"]
        arrays[f"c{cyc:02d}_{name}_mean24"] = (a["sum24"] / HOURS).astype(np.float32)
    return {"status": "ok", "latest_listed": latest, "cutoff": cutoff.isoformat(), "messages": len(messages),
            "input_sha256": hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest()}, arrays


def collect(a):
    from conus_calibration import check_frozen
    fitted, model_sha = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    coords = np.asarray(fitted["coords"], dtype=float)
    keep = fitted["keep"]
    date = a.date
    if date < START or date.startswith("2025"):
        raise SystemExit("CONUS RRFS collection is for current issue dates from 2026-11-26 only")
    out = Path(a.archive)
    out.mkdir(parents=True, exist_ok=True)
    meta_path = out / f"{date}.json"
    if meta_path.exists():
        print(f"RRFS collection record for {date} already exists; not overwritten")
        return
    now = datetime.now(timezone.utc)
    cells, cycles, arrays = {}, {}, {}
    for cyc in (6, 12):
        try:
            st, arr = collect_cycle(date, cyc, coords, cells)
        except Exception as e:  # logged; the other cycle and every other job still complete
            st, arr = {"status": "failed", "error": repr(e)[:400]}, None
        cycles[f"{cyc:02d}z"] = st
        if arr:
            arrays.update({k: v[keep].astype(np.float16) for k, v in arr.items()})
        print(f"RRFS {date} {cyc:02d}Z: {st['status']}", flush=True)
    meta = {"issue_date": date, "collected_at": now.isoformat(), "cycles": cycles,
            "both_cycles_ok": all(c["status"] == "ok" for c in cycles.values()),
            "grid": {"samples": int(len(coords)), "supported_samples": int(keep.sum()), "frozen_grid_from_sha256": model_sha},
            "fields": {k: list(v) for k, v in FIELDS.items()}, "rules": "research/severe/conus-v1/rrfs/COLLECTION.md",
            "generator": {k: __import__("os").environ.get(v) for k, v in (("run_id", "GITHUB_RUN_ID"), ("workflow", "GITHUB_WORKFLOW"),
                                                                            ("event", "GITHUB_EVENT_NAME"), ("sha", "GITHUB_SHA"))}}
    if arrays:
        buf = io.BytesIO()
        np.savez_compressed(buf, sample_index=np.nonzero(keep)[0].astype(np.int32), **arrays)
        data = buf.getvalue()
        name = f"severe-conus-rrfs-{date}.npz"
        Path(a.data_dir).mkdir(parents=True, exist_ok=True)
        (Path(a.data_dir) / name).write_bytes(data)
        meta["data"] = {"file": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "arrays": sorted(arrays),
                        "storage": "private archive release severe-conus-rrfs-YYYY-MM (uploaded by the workflow; never overwritten)"}
    meta_path.write_text(json.dumps(meta, indent=1) + "\n")
    print(json.dumps({k: meta[k] for k in ("issue_date", "both_cycles_ok")} | {"cycles": {c: v["status"] for c, v in cycles.items()}}))


def tally(a):
    out = Path(a.archive)
    rows = []
    for f in sorted(out.glob("20*.json")):
        m = json.loads(f.read_text())
        rows.append({"issue_date": m["issue_date"], "06z": m["cycles"]["06z"]["status"], "12z": m["cycles"]["12z"]["status"],
                     "both_cycles_ok": m["both_cycles_ok"], "archived": bool(m.get("archive", {}).get("verified"))})
    have = {r["issue_date"] for r in rows}
    d = datetime.strptime(START, "%Y-%m-%d").date()
    today = datetime.now(timezone.utc).date()
    while d <= today:
        cutoff = datetime(d.year, d.month, d.day, CUTOFF_UTC[0], CUTOFF_UTC[1], tzinfo=timezone.utc)
        if d.isoformat() not in have and datetime.now(timezone.utc) > cutoff + timedelta(hours=2):
            rows.append({"issue_date": d.isoformat(), "06z": "not_collected", "12z": "not_collected", "both_cycles_ok": False, "archived": False})
        d += timedelta(days=1)
    rows.sort(key=lambda r: r["issue_date"])
    summary = {"basis": "CONUS research grid, 15:10 UTC cutoff (separate from the regional collector's 15:30 UTC milestone)",
               "days": len(rows), "both_cycles_ok_and_archived": sum(r["both_cycles_ok"] and r["archived"] for r in rows),
               "06z_ok": sum(r["06z"] == "ok" for r in rows), "12z_ok": sum(r["12z"] == "ok" for r in rows), "rows": rows}
    (out / "tally.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--date", required=True)
    c.add_argument("--archive", default=str(ARCHIVE))
    c.add_argument("--data-dir", default="tests/out/rrfs-data")
    t = sub.add_parser("tally")
    t.add_argument("--archive", default=str(ARCHIVE))
    a = p.parse_args()
    {"collect": collect, "tally": tally}[a.cmd](a)


if __name__ == "__main__":
    main()
