#!/usr/bin/env python3
"""Inventory the public NadoCast archive (data.nadocast.com) for the head-to-head benchmark.

Read-only crawl of directory listings for the allowed months (2022-2024 and 2026; 2021 and 2025
are never requested), plus a few sample GRIB2 downloads per product variant to record grid,
variable, time range and units. Records daily (24-h) products only: Day 1 tornado and Day 2 wind
are the benchmark targets, other hazards are listed for completeness. No outcomes are read.
"""
import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = "http://data.nadocast.com/"  # the archive is served over plain HTTP (port 443 refuses)
UA = "forecast-ops-research-benchmark/0.1"
SEALED_YEARS = ("2021", "2025")
NAME = re.compile(r"^nadocast(?:_(?P<model>\d{4}(?:_preliminary)?)_models)?_conus_(?P<hazard>[a-z_]+?)"
                  r"(?P<abs>_abs_calib)?_(?P<date>\d{8})_t(?P<cycle>\d{2})z_f(?P<start>\d{2})-(?P<end>\d{2})"
                  r"\.(?P<ext>grib2|png|pdf|csv|float16\.bin|json)$")


def get(url, binary=False, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if k == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if k == tries - 1:
                raise
        time.sleep(2 ** k)


def links(html, base):
    out = []
    for h in re.findall(r'href="([^"?#]+)"', html or ""):
        u = urllib.parse.urljoin(base, h)
        if u.startswith(base) and u != base:
            out.append(u)
    return sorted(set(out))


def sizes(html):
    """Best-effort sizes from a miniserve/autoindex listing: name -> text after the link."""
    out = {}
    for m in re.finditer(r'href="([^"?#]+)"[^>]*>[^<]*</a>(.{0,200})', html or "", re.S):
        out[urllib.parse.unquote(m.group(1).rstrip("/").split("/")[-1])] = re.sub(r"<[^>]+>", " ", m.group(2)).split()[:4]
    return out


def months(spec):
    out = []
    for y in spec:
        for m in range(1, 13):
            out.append(f"{y}{m:02d}")
    return out


def crawl(years, workers):
    root_html = get(ROOT)
    root_months = sorted({u.rstrip("/").split("/")[-1] for u in links(root_html, ROOT)})
    want = [m for m in months(years) if m in root_months]
    files, dirs_seen = [], []

    def month_job(m):
        base = f"{ROOT}{m}/"
        days = [u for u in links(get(base), base) if re.search(r"/\d{8}/$", u)]
        rows = []
        for d in days:
            dh = get(d)
            for c in [u for u in links(dh, d) if re.search(r"/t\d{2}z/$", u)]:
                ch = get(c)
                sz = sizes(ch)
                for u in links(ch, c):
                    n = urllib.parse.unquote(u.rstrip("/").split("/")[-1])
                    mm = NAME.match(n)
                    if mm:
                        rows.append({"url": u, "name": n, "listing": sz.get(n), **mm.groupdict()})
            time.sleep(0.2)
        return m, len(days), rows

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for m, nd, rows in pool.map(month_job, want):
            dirs_seen.append({"month": m, "dates": nd, "files": len(rows)})
            files += rows
            print(f"{m}: {nd} dates, {len(rows)} daily files", flush=True)
    if any(r["date"][:4] in SEALED_YEARS for r in files):
        raise SystemExit("sealed year listed")
    return {"root_months": root_months, "months_crawled": dirs_seen, "files": files}


def variant(r):
    return (r["model"] or "unversioned", r["hazard"], bool(r["abs"]), r["cycle"], f"f{r['start']}-{r['end']}")


def summarize(files):
    grib = [r for r in files if r["ext"] == "grib2"]
    by = defaultdict(list)
    for r in grib:
        by[variant(r)].append(r["date"])
    out = []
    for (model, hazard, abs_, cycle, period), dates in sorted(by.items()):
        ds = sorted(set(dates))
        out.append({"model": model, "hazard": hazard, "absolutely_calibrated": abs_, "cycle": f"{cycle}Z",
                    "period": period, "dates": len(ds), "first": ds[0], "last": ds[-1],
                    "by_year": {y: sum(d.startswith(y) for d in ds) for y in sorted({d[:4] for d in ds})}})
    return out


def sample(files, out_dir, per_variant=2):
    import eccodes as ec
    grib = [r for r in files if r["ext"] == "grib2"]
    by = defaultdict(list)
    for r in grib:
        by[variant(r)].append(r)
    results = []
    out_dir.mkdir(parents=True, exist_ok=True)
    for v, rows in sorted(by.items()):
        if v[1] not in ("tornado", "wind", "wind_adj"):
            continue
        rows.sort(key=lambda r: r["date"])
        for r in ([rows[0], rows[-1]] if len(rows) > 1 else rows)[:per_variant]:
            data = get(r["url"], binary=True)
            if data is None:
                results.append({"name": r["name"], "status": "404"})
                continue
            p = out_dir / r["name"]
            p.write_bytes(data)
            with open(p, "rb") as f:
                g = ec.codes_grib_new_from_file(f)
                keys = ["shortName", "name", "units", "discipline", "parameterCategory", "parameterNumber",
                        "gridType", "Ni", "Nj", "Nx", "Ny", "DxInMetres", "DyInMetres", "LaDInDegrees", "LoVInDegrees",
                        "Latin1InDegrees", "Latin2InDegrees", "latitudeOfFirstGridPointInDegrees",
                        "longitudeOfFirstGridPointInDegrees", "dataDate", "dataTime", "stepRange", "stepType",
                        "probabilityType", "numberOfMissing"]
                meta = {}
                for k in keys:
                    try:
                        meta[k] = ec.codes_get(g, k)
                    except Exception:
                        meta[k] = None
                vals = ec.codes_get_array(g, "values")
                meta["values"] = {"min": float(vals.min()), "max": float(vals.max()), "n": int(vals.size)}
                if r is rows[0]:
                    lat = ec.codes_get_array(g, "latitudes")
                    lon = ec.codes_get_array(g, "longitudes")
                    meta["bbox"] = [float(((lon + 180) % 360 - 180).min()), float(((lon + 180) % 360 - 180).max()),
                                    float(lat.min()), float(lat.max())]
                ec.codes_release(g)
            results.append({"name": r["name"], "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "grib": meta})
            print(r["name"], meta["shortName"], meta["stepRange"], meta["values"], flush=True)
            time.sleep(0.5)
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--years", nargs="+", default=["2022", "2023", "2024", "2026"])
    p.add_argument("--workers", type=int, default=3)
    a = p.parse_args()
    if any(y in SEALED_YEARS for y in a.years):
        raise SystemExit("2021 and 2025 are sealed")
    a.output.mkdir(parents=True, exist_ok=True)
    inv = crawl(a.years, a.workers)
    summ = summarize(inv["files"])
    samples = sample(inv["files"], a.output / "samples")
    (a.output / "files-all.json").write_text(json.dumps(inv["files"]) + "\n")  # artifact only
    keep = [{k: r[k] for k in ("name", "model", "hazard", "abs", "date", "cycle", "start", "end")}
            for r in inv["files"] if r["ext"] == "grib2" and r["hazard"] in ("tornado", "wind", "wind_adj")]
    (a.output / "tornado-wind-grib2.json").write_text(json.dumps(keep, separators=(",", ":")) + "\n")
    (a.output / "inventory.json").write_text(json.dumps({
        "source": ROOT, "years_requested": a.years, "sealed_years_not_requested": list(SEALED_YEARS),
        "root_months": inv["root_months"], "months_crawled": inv["months_crawled"],
        "daily_grib2_variants": summ, "samples": samples, "outcomes_accessed": False}, indent=1) + "\n")


if __name__ == "__main__":
    main()
