"""Decode 06Z (f30-f47 instants, UH f31-f48) and 12Z (f24-f41, UH f25-f42) over valid hours 12Z D+1 .. 05Z D+2 and check alignment."""
import json, sys, urllib.request, datetime as dt, numpy as np, eccodes as ec, pickle, hashlib
from pathlib import Path
B = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
REC = {"gust": ("GUST", "surface"), "refc": ("REFC", "entire atmosphere"), "uh25": ("MXUPHL", "5000-2000 m above ground")}
def get(u, rng=None):
    req = urllib.request.Request(u, headers={"Range": f"bytes={rng[0]}-{rng[1]}"} if rng else {})
    with urllib.request.urlopen(req, timeout=120) as r: return r.read()
def field(day, cyc, f, name):
    url = f"{B}/hrrr.{day}/conus/hrrr.t{cyc:02d}z.wrfsfcf{f:02d}.grib2"
    lines = get(url + ".idx").decode().splitlines()
    var, lev = REC[name]
    hits = [i for i, l in enumerate(lines) if l.split(":")[3] == var and l.split(":")[4] == lev]
    assert len(hits) == 1, (url, name, len(hits))
    i = hits[0]; start = int(lines[i].split(":")[1]); end = int(lines[i + 1].split(":")[1]) - 1
    raw = get(url, (start, end))
    gid = ec.codes_new_from_message(raw)
    meta = {k: ec.codes_get(gid, k) for k in ("dataDate", "dataTime", "startStep", "endStep", "stepType", "units", "Nx", "Ny", "LaDInDegrees", "LoVInDegrees", "latitudeOfFirstGridPointInDegrees", "longitudeOfFirstGridPointInDegrees")}
    vals = ec.codes_get_values(gid).reshape(meta["Ny"], meta["Nx"]); ec.codes_release(gid)
    return vals, meta, len(raw)
def run(date, idx):
    day = date.replace("-", ""); out = {"date": date, "bytes": 0, "valid_hours": []}
    agg = {c: {n: None for n in REC} for c in (6, 12)}; geo = set()
    for k in range(18):  # valid hour H = 12Z D+1 + k
        for cyc in (6, 12):
            f = 30 + k if cyc == 6 else 24 + k
            for n in REC:
                ff = f + 1 if n == "uh25" else f
                v, m, nb = field(day, cyc, ff, n); out["bytes"] += nb
                init = dt.datetime.strptime(f"{m['dataDate']}{m['dataTime']:04d}", "%Y%m%d%H%M")
                valid_end = init + dt.timedelta(hours=m["endStep"])
                expect = dt.datetime.strptime(day, "%Y%m%d") + dt.timedelta(days=1, hours=12 + k + (1 if n == "uh25" else 0))
                assert init.hour == cyc and valid_end == expect, (date, cyc, n, init, valid_end, expect)
                if n == "uh25": assert m["stepType"] == "max" and m["endStep"] - m["startStep"] == 1, m
                geo.add(json.dumps({x: m[x] for x in ("Nx", "Ny", "LaDInDegrees", "LoVInDegrees", "latitudeOfFirstGridPointInDegrees", "longitudeOfFirstGridPointInDegrees")}))
                pv = v.ravel()[idx]
                agg[cyc][n] = pv if agg[cyc][n] is None else np.maximum(agg[cyc][n], pv)
        out["valid_hours"].append((dt.datetime.strptime(day, "%Y%m%d") + dt.timedelta(days=1, hours=12 + k)).strftime("%Y-%m-%dT%HZ"))
    assert len(geo) == 1, "grid differs between runs/fields"
    out["grid_identical_across_runs_fields_hours"] = True
    for n in REC:
        a, b = agg[6][n], agg[12][n]
        out[n] = {"corr_06z_vs_12z_18h_max": float(np.corrcoef(a, b)[0, 1]), "mean_06z": float(a.mean()), "mean_12z": float(b.mean()),
                  "p95_06z": float(np.percentile(a, 95)), "p95_12z": float(np.percentile(b, 95))}
    out["agree_refc_ge_40dbz"] = {"both": int(((agg[6]["refc"] >= 40) & (agg[12]["refc"] >= 40)).sum()), "only_06z": int(((agg[6]["refc"] >= 40) & (agg[12]["refc"] < 40)).sum()),
                                  "only_12z": int(((agg[6]["refc"] < 40) & (agg[12]["refc"] >= 40)).sum())}
    return out
if __name__ == "__main__":
    # sample cells: nearest native cell to each CONUS research sample (decoded lat/lon once)
    v0 = get(f"{B}/hrrr.20220311/conus/hrrr.t12z.wrfsfcf24.grib2.idx").decode().splitlines()
    i = [j for j, l in enumerate(v0) if ":REFC:entire atmosphere:" in l][0]
    raw = get(f"{B}/hrrr.20220311/conus/hrrr.t12z.wrfsfcf24.grib2", (int(v0[i].split(":")[1]), int(v0[i + 1].split(":")[1]) - 1))
    gid = ec.codes_new_from_message(raw); lat = ec.codes_get_array(gid, "latitudes"); lon = (ec.codes_get_array(gid, "longitudes") + 180) % 360 - 180; ec.codes_release(gid)
    coords = np.asarray(pickle.loads(open(sys.argv[1], "rb").read())["coords"])
    from scipy.spatial import cKDTree
    t = cKDTree(np.column_stack([lon, lat])); _, idx = t.query(coords)
    res = [run(d, idx) for d in sys.argv[3:]]
    json.dump(res, open(sys.argv[2], "w"), indent=1)
    for r in res:
        print(r["date"], f"{r['bytes']/1e6:.0f} MB", r["valid_hours"][0], "..", r["valid_hours"][-1], {n: round(r[n]["corr_06z_vs_12z_18h_max"], 2) for n in REC}, r["agree_refc_ge_40dbz"])
