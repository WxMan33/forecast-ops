#!/usr/bin/env python3
"""Bounded CVG RRFS point feed from NOAA GRIB2 byte ranges. No whole-model downloads.

Requires eccodes==2.50.0. Output units are C, mm liquid, cm fixed-7:1 snow.
The five perturbed members are RRFS ensemble members, NOT full time-lagged REFS.
"""
import argparse
import concurrent.futures as futures
import datetime as dt
import hashlib
import json
import math
import os
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = "https://noaa-rrfs-ops-pds.s3.amazonaws.com/"
LAT, LON = 39.04456, -84.67229
UTC = dt.timezone.utc
GRID = {}
LOCK = threading.Lock()
EVIDENCE = []


def download(url, byte_range=None):
    headers = {"User-Agent": "forecast-ops RRFS CVG point collector"}
    if byte_range:
        headers["Range"] = "bytes=%d-%d" % byte_range
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as r:
                if byte_range and (r.status != 206 or r.headers.get("Content-Range", "").split("/")[0] != "bytes %d-%d" % byte_range):
                    raise ValueError("Server did not return requested byte range")
                b = r.read(4_000_001 if byte_range else 500_001)
                if len(b) > (4_000_000 if byte_range else 500_000):
                    raise ValueError("Response exceeded bounded download size")
                if byte_range and len(b) != byte_range[1] - byte_range[0] + 1:
                    raise ValueError("Truncated GRIB message")
                return b
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def key(cycle, hour, member=None):
    day, cc = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    if member is None:
        return f"rrfs.{day}/{cc}/rrfs.t{cc}z.2dfld.3km.f{hour:03d}.conus.grib2"
    return f"rrfsens.{day}/{cc}/m{member:03d}/rrfs.t{cc}z.m{member:03d}.2dfldnomads.3km.f{hour:03d}.conus.grib2"


def inventory(text):
    rows = [x.split(":") for x in text.splitlines() if re.match(r"^\d+:\d+:", x)]
    return [(r, int(r[1]), int(rows[i + 1][1]) - 1 if i + 1 < len(rows) else None) for i, r in enumerate(rows)]


def select(rows, field, level, hour, accumulation=False):
    for row, start, end in rows:
        if row[3:5] != [field, level] or end is None:
            continue
        if accumulation:
            expected = f"{hour - 1}-{hour} hour acc fcst"
            if row[5] != expected:
                continue
        elif row[5] != ("anl" if hour == 0 else f"{hour} hour fcst"):
            continue
        return start, end
    raise ValueError(f"No exact {field} {level} time window at f{hour:03d}")


def point_value(file_key, bounds, expected_field, cycle, hour, member):
    from eccodes import codes_new_from_message, codes_get, codes_get_double_element, codes_grib_find_nearest, codes_release
    blob = download(ROOT + file_key, bounds)
    g = codes_new_from_message(blob)
    try:
        if codes_get(g, "dataDate") != int(cycle.strftime("%Y%m%d")) or codes_get(g, "dataTime") != cycle.hour * 100:
            raise ValueError("GRIB cycle mismatch")
        if codes_get(g, "endStep") != hour:
            raise ValueError("GRIB valid-time mismatch")
        if member is not None and codes_get(g, "perturbationNumber") != member:
            raise ValueError("GRIB ensemble member mismatch")
        grid_id = (codes_get(g, "Nx"), codes_get(g, "Ny"), codes_get(g, "latitudeOfFirstGridPointInDegrees"), codes_get(g, "longitudeOfFirstGridPointInDegrees"))
        if grid_id[:2] != (1799, 1059):
            raise ValueError("Unexpected RRFS CONUS grid")
        with LOCK:
            if grid_id not in GRID:
                nearest = dict(codes_grib_find_nearest(g, LAT, LON % 360, npoints=1)[0])
                if nearest["distance"] > 3:
                    raise ValueError("Nearest grid point is more than 3 km from CVG")
                GRID[grid_id] = {k: nearest[k] for k in ["lat", "lon", "distance", "index"]}
            near = GRID[grid_id]
        value = float(codes_get_double_element(g, "values", near["index"]))
        if not math.isfinite(value) or abs(value) > 1e10 or value == codes_get(g, "missingValue"):
            raise ValueError("Missing native point value")
        units = codes_get(g, "units")
        # ecCodes 2.50 lacks WMO 0/1/50: Total Snow Precipitation (kg m-2).
        if expected_field == "TSNOWP" and tuple(codes_get(g, k) for k in ["discipline", "parameterCategory", "parameterNumber"]) != (0, 1, 50):
            raise ValueError("Unexpected TSNOWP parameter identity")
        with LOCK:
            EVIDENCE.append({"file": file_key, "bytes": list(bounds), "sha256": hashlib.sha256(blob).hexdigest(), "field": expected_field, "units": units, "member": member, "hour": hour, "pointValue": value})
        return value, units, dict(near)
    finally:
        codes_release(g)


def one_hour(cycle, hour, member):
    file_key = key(cycle, hour, member)
    idx = download(ROOT + file_key + ".idx")
    rows = inventory(idx.decode())
    with LOCK:
        EVIDENCE.append({"file": file_key + ".idx", "sha256": hashlib.sha256(idx).hexdigest()})
    t, unit, near = point_value(file_key, select(rows, "TMP", "2 m above ground", hour), "TMP", cycle, hour, member)
    if unit != "K" or not 180 <= t <= 340:
        raise ValueError("Unexpected temperature units/range")
    result = {"temperature_2m": round(t - 273.15, 3), "precipitation": None, "snowfall": None}
    if hour:
        p, unit, _ = point_value(file_key, select(rows, "APCP", "surface", hour, True), "APCP", cycle, hour, member)
        if unit not in ("kg m**-2", "kg m-2") or not 0 <= p <= 500:
            raise ValueError("Unexpected hourly precipitation units/range")
        result["precipitation"] = round(p, 4)
        if p == 0:
            swe = 0
        elif member is None:
            swe, unit, _ = point_value(file_key, select(rows, "TSNOWP", "surface", hour, True), "TSNOWP", cycle, hour, member)
            if unit not in ("kg m**-2", "kg m-2", "unknown") or not 0 <= swe <= 500:
                raise ValueError("Unexpected snow-water units/range")
        else:
            frozen, unit, _ = point_value(file_key, select(rows, "CPOFP", "surface", hour), "CPOFP", cycle, hour, member)
            # UPP may encode an undefined frozen fraction as negative in dry hours.
            if unit == "%" and 0 <= frozen <= 100:
                swe = p * frozen / 100
            else:
                swe = None  # Invalid native frozen fraction is unknown snow, never zero.
        result["snowfall"] = round(swe * 0.7, 4) if swe is not None else None
    return hour, result, near


def cycle_available(cycle, det_hours=84, ens_hours=60):
    try:
        # Require every index in the requested windows, not merely f001. New runs can
        # be visible in the bucket while later files are still missing or arriving.
        for member in [None, 1, 2, 3, 4, 5]:
            prefix = key(cycle, 0, member).split("f000.")[0] + "f"
            listing = ET.fromstring(download(ROOT + "?list-type=2&prefix=" + prefix))
            ns = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
            if listing.findtext("s:IsTruncated", namespaces=ns) != "false":
                return False
            keys = {x.text for x in listing.findall(".//s:Contents/s:Key", ns)}
            end = det_hours if member is None else ens_hours
            if any(key(cycle, h, member) + ".idx" not in keys for h in range(end + 1)):
                return False
        return True
    except Exception:
        return False


def produce(cycle, det_hours, ens_hours, workers):
    output, errors = {}, []
    for member in [None, 1, 2, 3, 4, 5]:
        end = det_hours if member is None else ens_hours
        vals = {v: [None] * (end + 1) for v in ["temperature_2m", "precipitation", "snowfall"]}
        near = None
        with futures.ThreadPoolExecutor(max_workers=workers) as pool:
            jobs = {pool.submit(one_hour, cycle, hour, member): hour for hour in range(end + 1)}
            for job in futures.as_completed(jobs):
                hour = jobs[job]
                try:
                    _, row, near = job.result()
                    for v, x in row.items():
                        vals[v][hour] = x
                except Exception as e:
                    errors.append({"member": member, "hour": hour, "error": str(e)})
        # Do not publish a truncated successful-looking member. Missing hours reject the new feed.
        if any(x is None for x in vals["temperature_2m"]) or any(x is None for x in vals["precipitation"][1:]):
            raise RuntimeError(f"Incomplete native member {member}: {json.dumps(errors[-8:])}")
        missing_snow = [h for h in range(1, end + 1) if vals["snowfall"][h] is None]
        output["deterministic" if member is None else f"member{member:02d}"] = {"hourly": vals, "grid": near, "snowUnavailableHours": missing_snow}
        print(f"RRFS {'deterministic' if member is None else f'member {member}'}: f000-f{end:03d} temp/precip complete; {len(missing_snow)} snow hours unknown", flush=True)
    now = dt.datetime.now(UTC).isoformat().replace("+00:00", "Z")
    payload = {"schema": 1, "method": "rrfs-cvg-native-v1", "generatedAt": now, "cycle": cycle.isoformat().replace("+00:00", "Z"), "point": {"name": "CVG", "lat": LAT, "lon": LON}, "source": ROOT, "timezone": "UTC", "units": {"temperature_2m": "°C", "precipitation": "mm", "snowfall": "cm"}, "snowMethod": "fixed 7:1 from TSNOWP (deterministic) or APCP times CPOFP (members); not ground accumulation", "members": output, "errors": errors}
    return payload


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cycle", help="Explicit UTC cycle YYYYMMDDHH")
    p.add_argument("--det-hours", type=int, default=84)
    p.add_argument("--ens-hours", type=int, default=60)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--out", default="feeds/rrfs-cvg.json")
    args = p.parse_args()
    if not 1 <= args.det_hours <= 84 or not 1 <= args.ens_hours <= 60 or not 1 <= args.workers <= 8:
        p.error("Unbounded horizon or concurrency")
    if args.cycle:
        cycle = dt.datetime.strptime(args.cycle, "%Y%m%d%H").replace(tzinfo=UTC)
    else:
        now = dt.datetime.now(UTC) - dt.timedelta(hours=4)
        latest = now.replace(hour=now.hour // 6 * 6, minute=0, second=0, microsecond=0)
        cycle = next((c for c in [latest, latest - dt.timedelta(hours=6)] if cycle_available(c, args.det_hours, args.ens_hours)), None)
        if cycle is None:
            raise RuntimeError("No complete current NOAA cycle found")
    if dt.datetime.now(UTC) - cycle > dt.timedelta(hours=16):
        raise RuntimeError("Refusing stale model cycle")
    output = Path(args.out)
    if output.exists():
        previous = json.loads(output.read_text())
        if previous.get("cycle") == cycle.isoformat().replace("+00:00", "Z") and len(previous.get("members", {}).get("deterministic", {}).get("hourly", {}).get("temperature_2m", [])) == args.det_hours + 1:
            print("Current complete cycle already published; no GRIB re-download", flush=True)
            return
    payload = produce(cycle, args.det_hours, args.ens_hours, args.workers)
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest = output.with_name(output.stem + "-manifest.json")
    tmp = output.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    manifest.write_text(json.dumps({"method": payload["method"], "cycle": payload["cycle"], "generatedAt": payload["generatedAt"], "source": ROOT, "point": payload["point"], "evidence": sorted(EVIDENCE, key=lambda x: (x["file"], x.get("bytes", [0])[0]))}, separators=(",", ":")) + "\n")
    os.replace(tmp, output)  # replace current successful feed only when every requested hour is valid
    print(f"Wrote {output} and hash/range manifest", flush=True)


if __name__ == "__main__":
    main()
