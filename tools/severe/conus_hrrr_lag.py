#!/usr/bin/env python3
"""Time-lagged HRRR (06Z + 12Z) test for Day 2 damaging wind (research/severe/conus-v1/hrrr-lag/RULES.md).

  extract  per issue date: the 12Z and 06Z runs over the first 18 common valid hours of the Day 2 window
           (12Z D+1 .. 05Z D+2). Each hour gets a 25-mile neighborhood max at every CONUS sample (extract.disk_max_at_samples,
           the existing rule); then each run keeps its 18-hour maximum of gust, composite reflectivity and 2-5 km
           updraft helicity (1 h max over (H, H+1]). The archive listing of every needed object of both runs
           (12Z f24-f48, 06Z f30-f48) is checked against the 15:10 UTC cutoff.
  fold     three nested arms on one held-out month fold:
             hrrr        frozen predictors
             hrrr_12z18  frozen + the three 12Z 18-hour maxima
             hrrr_lag    frozen + the three 12Z maxima + 06Z maxima (3) + agreement min(06Z, 12Z) (3) + spread |06Z - 12Z| (3)
           Agreement is the minimum of the two runs' 18-hour maxima, so the two peaks may come from different hours.
  combine  apply the committed rule.
Development data only; 2021/2025 never load; nothing touches the live feed, publisher or registry.
"""
import argparse
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.special import expit

ROOT = Path(__file__).resolve().parents[2]
BUCKET = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
FIELDS = {"gust": ("GUST", "surface"), "refc": ("REFC", "entire atmosphere"), "uh25": ("MXUPHL", "5000-2000 m above ground")}
RUNS = {12: 24, 6: 30}  # cycle -> forecast hour of the first valid hour (12Z D+1)
LISTED = {12: range(24, 49), 6: range(30, 49)}  # objects that must be listed before the cutoff
HOURS = 18
CUTOFF_UTC = (15, 10)
FEATURES = ("h12_gust_max18", "h12_refc_max18", "h12_uh25_max18", "h06_gust_max18", "h06_refc_max18", "h06_uh25_max18")
EXCLUDED_BY_AUDIT = {"2022-01-06": "06Z and 12Z listed after cutoff", "2022-01-08": "06Z and 12Z listed after cutoff",
                     "2022-08-11": "12Z listed after cutoff"}


def get(url, rng=None):
    req = urllib.request.Request(url, headers={"Range": f"bytes={rng[0]}-{rng[1]}"} if rng else {})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if rng and len(data) != rng[1] - rng[0] + 1:
                raise IOError("short read")
            return data
        except Exception as e:  # retried, then raised
            err = e
    raise err


def listing(day, cyc):
    body = get(f"{BUCKET}/?list-type=2&prefix=hrrr.{day}/conus/hrrr.t{cyc:02d}z.wrfsfcf&max-keys=1000").decode()
    out = {}
    for k, lm in re.findall(r"<Key>([^<]*)</Key><LastModified>([^<]*)</LastModified>", body):
        out[k] = lm
    return out


def sample_cells(lat, lon, coords):
    from scipy.spatial import cKDTree
    t = cKDTree(np.column_stack([lon.ravel(), lat.ravel()]))
    dist, flat = t.query(coords, k=2)
    # Each sample must coincide with one native cell (floating-point tolerance 1e-9 degrees; decoders can differ
    # in the last bits), and that cell must be unambiguous (second-nearest cell at least ~1 km away).
    if dist[:, 0].max() > 1e-9 or dist[:, 1].min() < 0.009:
        raise ValueError(f"CONUS samples do not coincide with unique native HRRR cells "
                         f"(max offset {dist[:, 0].max():.2e} deg, min second-nearest {dist[:, 1].min():.4f} deg)")
    rows, cols = np.unravel_index(flat[:, 0], lat.shape)
    return rows, cols


CELLS = {}


def extract_date(date, coords, out_root):
    if not date.startswith(("2022", "2023")):
        raise ValueError("development dates only")
    return _extract(date, coords, out_root)


def live_lag(date, coords):
    """Current issue date for the prospective archive: returns (status, features or None, meta). Never raises for
    missing/late inputs; the reason is recorded instead. 2025 is refused."""
    if date.startswith("2025") or date < "2026-11-01":
        raise ValueError("live lag features are for current dates only")
    try:
        return _extract(date, coords, None)
    except Exception as e:
        return {"date": date, "status": "failed", "error": repr(e)[:400]}, None, None


def _extract(date, coords, out_root):
    import eccodes as ec
    from extract import disk_max_at_samples
    day = date.replace("-", "")
    base = datetime.strptime(day, "%Y%m%d").replace(tzinfo=timezone.utc)
    cutoff = base.replace(hour=CUTOFF_UTC[0], minute=CUTOFF_UTC[1])
    meta = {"date": date, "status": "complete", "cutoff": cutoff.isoformat(), "runs": {}, "messages": []}
    maxima = {}
    for cyc, f0 in RUNS.items():
        objs = listing(day, cyc)
        need = [f"hrrr.{day}/conus/hrrr.t{cyc:02d}z.wrfsfcf{f:02d}.grib2{s}" for f in LISTED[cyc] for s in ("", ".idx")]
        missing = [k for k in need if k not in objs]
        if missing:
            r = {"date": date, "status": "missing", "missing": missing[:5], "run": f"{cyc:02d}z"}
            return (r, None, None) if out_root is None else r
        latest = max(objs[k] for k in need)
        meta["runs"][f"{cyc:02d}z"] = {"latest_listed": latest,
                                       "listed_before_cutoff": datetime.fromisoformat(latest.replace("Z", "+00:00")) <= cutoff}
        for name, (var, lev) in FIELDS.items():
            agg = None
            for k in range(HOURS):
                f = f0 + k + (1 if name == "uh25" else 0)
                url = f"{BUCKET}/hrrr.{day}/conus/hrrr.t{cyc:02d}z.wrfsfcf{f:02d}.grib2"
                lines = get(url + ".idx").decode().splitlines()
                hits = [i for i, l in enumerate(lines) if l.split(":")[3] == var and l.split(":")[4] == lev]
                if len(hits) != 1:
                    raise ValueError(f"{url}: {len(hits)} {var} records")
                i = hits[0]
                rng = (int(lines[i].split(":")[1]), int(lines[i + 1].split(":")[1]) - 1)
                raw = get(url, rng)
                gid = ec.codes_new_from_message(raw)
                try:
                    m = {x: ec.codes_get(gid, x) for x in ("dataDate", "dataTime", "startStep", "endStep", "stepType", "units",
                                                          "discipline", "parameterCategory", "parameterNumber", "Nx", "Ny")}
                    init = datetime.strptime(f"{m['dataDate']}{m['dataTime']:04d}", "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
                    valid_end = init + timedelta(hours=m["endStep"])
                    expect = base + timedelta(days=1, hours=12 + k + (1 if name == "uh25" else 0))
                    if init.hour != cyc or valid_end != expect or (name == "uh25" and (m["stepType"] != "max" or m["endStep"] - m["startStep"] != 1)):
                        raise ValueError(f"{url} {name}: unexpected time identity {m}")
                    vals = ec.codes_get_values(gid).reshape(m["Ny"], m["Nx"]).astype(np.float32)
                    if "rc" not in CELLS:
                        lat = ec.codes_get_array(gid, "latitudes").reshape(m["Ny"], m["Nx"])
                        lon = (ec.codes_get_array(gid, "longitudes").reshape(m["Ny"], m["Nx"]) + 180) % 360 - 180
                        CELLS["rc"] = sample_cells(lat, lon, coords)
                        CELLS["shape"] = (m["Ny"], m["Nx"])
                    if (m["Ny"], m["Nx"]) != CELLS["shape"]:
                        raise ValueError("native grid changed")
                finally:
                    ec.codes_release(gid)
                rows, cols = CELLS["rc"]
                hood = disk_max_at_samples(vals, rows, cols)
                agg = hood if agg is None else np.maximum(agg, hood)
                meta["messages"].append({"run": cyc, "field": name, "forecast_hour": f, "range": rng,
                                         "sha256": hashlib.sha256(raw).hexdigest()})
            maxima[(cyc, name)] = agg
    feats = np.column_stack([maxima[(12, "gust")], maxima[(12, "refc")], maxima[(12, "uh25")],
                             maxima[(6, "gust")], maxima[(6, "refc")], maxima[(6, "uh25")]]).astype(np.float32)
    if not np.isfinite(feats).all():
        raise ValueError("non-finite lagged predictor")
    meta["listed_before_cutoff"] = all(r["listed_before_cutoff"] for r in meta["runs"].values())
    if out_root is None:
        status = "ok" if meta["listed_before_cutoff"] else "listed_after_cutoff"
        return {"date": date, "status": status, "runs": meta["runs"]}, feats, meta
    out = Path(out_root) / date
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / "lag.npz", features=feats, feature_names=np.array(FEATURES))
    meta["artifact"] = {"file": "lag.npz", "sha256": hashlib.sha256((out / "lag.npz").read_bytes()).hexdigest()}
    (out / "lag.json").write_text(json.dumps(meta) + "\n")
    return {"date": date, "status": "complete", "listed_before_cutoff": meta["listed_before_cutoff"]}


def extract(a):
    from conus_calibration import check_frozen
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    coords = np.asarray(fitted["coords"], dtype=float)
    (a.output / "status").mkdir(parents=True, exist_ok=True)
    status = 0
    for d in a.dates:
        try:
            r = extract_date(d, coords, a.output)
        except Exception as e:
            r = {"date": d, "status": "failed", "error": repr(e)[:400]}
            status = 1
        print(json.dumps(r), flush=True)
        (a.output / "status" / f"{d}.json").write_text(json.dumps(r) + "\n")
    raise SystemExit(status)


# ---------------------------------------------------------------- gate
ARMS = ("hrrr", "hrrr_12z18", "hrrr_lag")


def lag_load(root, case, keep):
    mp = Path(root) / case / "lag.json"
    if case in EXCLUDED_BY_AUDIT:
        return None, "excluded_by_audit: " + EXCLUDED_BY_AUDIT[case]
    if not mp.exists():
        st = Path(root) / "status" / f"{case}.json"
        return None, (json.loads(st.read_text()).get("status", "missing") if st.exists() else "not_extracted")
    meta = json.loads(mp.read_text())
    if not meta["listed_before_cutoff"]:
        return None, "listed_after_cutoff (found during extraction)"
    path = mp.parent / meta["artifact"]["file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != meta["artifact"]["sha256"]:
        raise ValueError(f"{case}: lag artifact hash mismatch")
    with np.load(path, allow_pickle=False) as z:
        return z["features"][keep].astype(np.float32), "ok"


def arm_inputs(x, lag):
    h12, h06 = lag[:, :3], lag[:, 3:]
    return {"hrrr": x, "hrrr_12z18": np.hstack([x, h12]),
            "hrrr_lag": np.hstack([x, h12, h06, np.minimum(h06, h12), np.abs(h06 - h12)])}


def fold(a):
    import phase2_study as S
    from conus_calibration import REGIONS, check_frozen, region_index
    from conus_fulldev import DAY, NEG_KEEP, case_files, fit, load_case
    from conus_study import regions
    fitted, sha = check_frozen(a.models, a.manifest)
    keep, scales, coords = fitted["keep"], fitted["scales"][DAY], fitted["coords"]
    files = case_files(a.conus)
    cases = sorted(files)
    excluded, lag = {}, {}
    for c in cases:
        f, why = lag_load(a.lag, c, keep)
        if f is None:
            excluded[c] = why
        else:
            lag[c] = f
    matched = [c for c in cases if c in lag]
    with np.load(files[cases[0]][0], allow_pickle=False) as d:
        names = d["feature_names"].tolist()
    reg = region_index(None, regions(coords), keep)
    FL = REGIONS.index("florida_gulf_south")
    test_cases = [c for c in matched if S.fold_of(c) == a.fold]
    train_cases = [c for c in matched if S.fold_of(c) != a.fold]
    xs, ls, ys, ws, gs = [], [], [], [], []
    for c in train_cases:
        x, y, pts = load_case(*files[c], keep, scales, names, coords)
        rng = np.random.default_rng(int(c.replace("-", "")))
        m = (y > 0) | (rng.random(len(y)) < NEG_KEEP)
        xs.append(x[m]); ls.append(lag[c][pts][m]); ys.append(y[m])
        ws.append(np.where(y[m] > 0, 1.0, 1.0 / NEG_KEEP)); gs.append(np.full(m.sum(), S.fold_of(c) % 3))
    x, xl, y, w, g = (np.concatenate(v) for v in (xs, ls, ys, ws, gs))
    del xs, ls
    inputs = arm_inputs(x, xl)
    del x
    models = {}
    for k in ARMS:
        models[k] = fit(inputs[k], y, w, g)
        print(f"fold {a.fold}: {k} fitted ({len(y)} rows, {inputs[k].shape[1]} predictors)", flush=True)
    del inputs
    sums = {k: [] for k in ARMS}
    saved = {"date": [], "sample": [], "y": []} | {k: [] for k in ARMS}
    keep_idx = np.nonzero(keep)[0]
    for c in test_cases:
        xt, yt, pts = load_case(*files[c], keep, scales, names, coords)
        rt = reg[pts]
        ins = arm_inputs(xt, lag[c][pts])
        probs = {}
        for k, (tree, cal) in models.items():
            p = expit(cal[0] + cal[1] * tree.decision_function(ins[k]))
            probs[k] = p
            hi = p >= 0.05
            for r in range(len(REGIONS)):
                m = rt == r
                sums[k].append([c, r, int(m.sum()), float(yt[m].sum()), float(((p[m] - yt[m]) ** 2).sum()), float(p[m].sum()),
                                int((hi[m] & (yt[m] > 0)).sum()), int((hi[m] & (yt[m] == 0)).sum())])
        if "-03-" in c or "-04-" in c:
            m = rt == FL
            saved["date"] += [c] * int(m.sum()); saved["sample"].append(keep_idx[pts[m]]); saved["y"].append(yt[m])
            for k in ARMS:
                saved[k].append(probs[k][m])
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / f"fold-{a.fold}.json").write_text(json.dumps(
        {"fold": a.fold, "frozen_models_sha256": sha, "matched_dates": len(matched), "excluded": excluded,
         "train_dates": len(train_cases), "test_dates": test_cases, "train_rows": int(len(y)), "neg_keep": NEG_KEEP,
         "regions": list(REGIONS), "sums": sums}) + "\n")
    if saved["date"]:
        np.savez_compressed(a.output / f"fl-mar-apr-fold-{a.fold}.npz", date=np.array(saved["date"]),
                            sample=np.concatenate(saved["sample"]), y=np.concatenate(saved["y"]).astype(np.uint8),
                            **{k: np.concatenate(saved[k]).astype(np.float32) for k in ARMS})


def combine(a):
    import phase2_study as S
    from conus_calibration import REGIONS
    from conus_followup import SAMPLE_KM2
    parts = [json.loads(f.read_text()) for f in sorted(a.input.glob("fold-*.json"))]
    if sorted(p["fold"] for p in parts) != list(range(S.FOLDS)):
        raise ValueError("Need all 6 folds")
    FL = REGIONS.index("florida_gulf_south")
    excluded = parts[0]["excluded"]
    rows = {k: [] for k in ARMS}
    for p in parts:
        for k in ARMS:
            rows[k] += p["sums"][k]
    dates = sorted({r[0] for r in rows["hrrr"]})
    di = {d: i for i, d in enumerate(dates)}
    A = {k: np.zeros((len(dates), len(REGIONS), 6)) for k in ARMS}
    for k in ARMS:
        for c, r, n, sy, sse, sp, hit, fa in rows[k]:
            A[k][di[c], r] = (n, sy, sse, sp, hit, fa)
    clim = float(A["hrrr"][..., 1].sum() / A["hrrr"][..., 0].sum())

    def bss(v):
        n, sy, sse = v[..., 0].sum(), v[..., 1].sum(), v[..., 2].sum()
        return float(1 - sse / (sy - 2 * clim * sy + n * clim * clim))

    def diff(m1, m2, sl):
        a1 = A[m1][:, sl, 2].reshape(len(dates), -1).sum(1)
        a2 = A[m2][:, sl, 2].reshape(len(dates), -1).sum(1)
        n = A[m2][:, sl, 0].reshape(len(dates), -1).sum(1)
        r = np.random.default_rng(7)
        bs = []
        for _ in range(2000):
            j = r.integers(0, len(dates), len(dates))
            bs.append((a1[j].sum() - a2[j].sum()) / n[j].sum())
        return [float((a1.sum() - a2.sum()) / n.sum()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]

    noreport = A["hrrr"][..., 1].sum(1) == 0
    res = {"matched_dates": len(dates), "excluded": excluded, "excluded_count": len(excluded), "development_climatology": clim,
           "bss": {k: {"national": bss(A[k])} | {REGIONS[r]: bss(A[k][:, r]) for r in range(len(REGIONS))} for k in ARMS},
           "lag_minus_hrrr": {"national": diff("hrrr_lag", "hrrr", slice(None))} | {REGIONS[r]: diff("hrrr_lag", "hrrr", slice(r, r + 1)) for r in range(len(REGIONS))},
           "lag_minus_12z18": {"national": diff("hrrr_lag", "hrrr_12z18", slice(None))} | {REGIONS[r]: diff("hrrr_lag", "hrrr_12z18", slice(r, r + 1)) for r in range(len(REGIONS))},
           "12z18_minus_hrrr": {"national": diff("hrrr_12z18", "hrrr", slice(None)), "florida_gulf_south": diff("hrrr_12z18", "hrrr", slice(FL, FL + 1))},
           "calibration_ratio": {k: float(A[k][..., 3].sum() / A[k][..., 1].sum()) for k in ARMS},
           "florida_gulf_calibration_ratio": {k: float(A[k][:, FL, 3].sum() / A[k][:, FL, 1].sum()) for k in ARMS},
           "hits_at_5pct": {k: int(A[k][..., 4].sum()) for k in ARMS},
           "florida_gulf_hits_at_5pct": {k: int(A[k][:, FL, 4].sum()) for k in ARMS},
           "false_alarm_area_km2_at_5pct": {k: float(A[k][..., 5].sum() * SAMPLE_KM2) for k in ARMS},
           "florida_gulf_false_alarm_area_km2_at_5pct": {k: float(A[k][:, FL, 5].sum() * SAMPLE_KM2) for k in ARMS},
           "area_at_5pct_on_no_report_dates_km2_per_date": {k: float(A[k][noreport][..., 5].sum() * SAMPLE_KM2 / max(1, noreport.sum())) for k in ARMS}}
    res["hit_retention_vs_hrrr"] = res["hits_at_5pct"]["hrrr_lag"] / max(1, res["hits_at_5pct"]["hrrr"])
    c1 = res["lag_minus_hrrr"]["national"][2] < 0
    c2 = not any(res["lag_minus_hrrr"][r][1] > 0 for r in REGIONS)
    c3 = abs(res["calibration_ratio"]["hrrr_lag"] - 1) <= 0.15
    c4 = res["hit_retention_vs_hrrr"] >= 0.95
    c5 = res["lag_minus_12z18"]["national"][2] < 0
    res["criteria"] = {"1_national_better_than_hrrr": bool(c1), "2_no_region_worse_than_hrrr": bool(c2), "3_calibrated_15pct": bool(c3),
                       "4_hit_retention_ge_95pct_vs_hrrr": bool(c4), "5_national_better_than_12z_control": bool(c5)}
    res["pass"] = bool(c1 and c2 and c3 and c4 and c5)
    npz = sorted(a.input.glob("fl-mar-apr-fold-*.npz"))
    if npz:
        D = {k: np.concatenate([np.load(f)[k] for f in npz]) for k in ("y",) + ARMS}
        y = D["y"].astype(float)
        sub = (y == 0) & (D["hrrr"] >= 0.05) & (D["hrrr_lag"] >= 0.05)
        res["mar_apr_florida_gulf_diagnostic"] = {
            "subset": "no-report points where hrrr and hrrr_lag are both >= 5%", "points": int(sub.sum()),
            "brier_change_sum_lag_minus_hrrr": float(((D["hrrr_lag"] - y) ** 2 - (D["hrrr"] - y) ** 2)[sub].sum()),
            "brier_change_sum_lag_minus_12z18": float(((D["hrrr_lag"] - y) ** 2 - (D["hrrr_12z18"] - y) ** 2)[sub].sum()),
            "mean_p": {k: float(D[k][sub].mean()) for k in ARMS}}
    res["protected_2025_outcomes_accessed"] = False
    res["verification_2021_loaded"] = False
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "gate.json").write_text(json.dumps(res, indent=1) + "\n")
    f = lambda v: f"{v[0]:+.6f} ({v[1]:+.6f} to {v[2]:+.6f})"
    why = {}
    for c, r in excluded.items():
        why.setdefault(r, []).append(c)
    L = [f"# Time-lagged HRRR test (Day 2 wind): {'PASS' if res['pass'] else 'FAIL'}", "",
         f"{len(dates)} matched held-out 2022-23 dates, 6 month-grouped folds; {len(excluded)} excluded from every arm: "
         + "; ".join(f"{k}: {', '.join(v)}" for k, v in why.items()) + f". BSS vs development climatology {clim:.5f}.", "",
         "| Arm | National | " + " | ".join(REGIONS) + " | mean p / obs | FL/Gulf mean p / obs |", "|---|---|" + "---|" * len(REGIONS) + "---|---|"]
    for k in ARMS:
        L.append(f"| {k} | {res['bss'][k]['national']:.3f} | " + " | ".join(f"{res['bss'][k][r]:.3f}" for r in REGIONS)
                 + f" | {res['calibration_ratio'][k]:.3f} | {res['florida_gulf_calibration_ratio'][k]:.3f} |")
    L += ["", "**Lagged − frozen HRRR** (criteria 1–4), Brier difference, 95% whole-date interval:", ""]
    L += [f"- {k}: {f(v)}" for k, v in res["lag_minus_hrrr"].items()]
    L += ["", "**Lagged − 12Z control** (criterion 5 uses national), Brier difference:", ""]
    L += [f"- {k}: {f(v)}" for k, v in res["lag_minus_12z18"].items()]
    L += ["", "12Z control − frozen HRRR (context):", "", f"- national: {f(res['12z18_minus_hrrr']['national'])}",
          f"- florida_gulf_south: {f(res['12z18_minus_hrrr']['florida_gulf_south'])}", "",
          "| | frozen HRRR | 12Z control | lagged |", "|---|---|---|---|",
          "| Hits at ≥5% (national) | " + " | ".join(f"{res['hits_at_5pct'][k]:,}" for k in ARMS) + " |",
          "| Hits at ≥5% (FL/Gulf) | " + " | ".join(f"{res['florida_gulf_hits_at_5pct'][k]:,}" for k in ARMS) + " |",
          "| False-alarm area ≥5%, km² (national) | " + " | ".join(f"{res['false_alarm_area_km2_at_5pct'][k]:,.0f}" for k in ARMS) + " |",
          "| False-alarm area ≥5%, km² (FL/Gulf) | " + " | ".join(f"{res['florida_gulf_false_alarm_area_km2_at_5pct'][k]:,.0f}" for k in ARMS) + " |",
          "| Area ≥5% per no-report date, km² | " + " | ".join(f"{res['area_at_5pct_on_no_report_dates_km2_per_date'][k]:,.0f}" for k in ARMS) + " |",
          "", f"Hit retention (lagged vs frozen HRRR): {res['hit_retention_vs_hrrr']:.3f}"]
    if "mar_apr_florida_gulf_diagnostic" in res:
        d = res["mar_apr_florida_gulf_diagnostic"]
        L += ["", "## March–April Florida/Gulf diagnostic (does not decide the verdict)", "",
              f"{d['subset']}: {d['points']:,} points; Brier change (sum) lagged − frozen {d['brier_change_sum_lag_minus_hrrr']:+.3f}, "
              f"lagged − 12Z control {d['brier_change_sum_lag_minus_12z18']:+.3f}; mean p " + ", ".join(f"{k} {v:.4f}" for k, v in d["mean_p"].items())]
    L += ["", f"Criteria: {res['criteria']}"]
    (a.output / "gate.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


def freeze(a):
    """Fit all three arms once on every matched development date (the gate's exact recipe) and commit them with
    checksums. Run before any prospective score is inspected."""
    import pickle
    import phase2_study as S
    from conus_calibration import check_frozen
    from conus_fulldev import DAY, NEG_KEEP, case_files, fit, load_case
    fitted, sha = check_frozen(a.models, a.manifest)
    keep, scales, coords = fitted["keep"], fitted["scales"][DAY], fitted["coords"]
    files = case_files(a.conus)
    cases = sorted(files)
    excluded, lag = {}, {}
    for c in cases:
        f, why = lag_load(a.lag, c, keep)
        if f is None:
            excluded[c] = why
        else:
            lag[c] = f
    matched = [c for c in cases if c in lag]
    if len(matched) != a.expected_dates:
        raise SystemExit(f"expected {a.expected_dates} matched dates (as in the gate), found {len(matched)}")
    with np.load(files[cases[0]][0], allow_pickle=False) as d:
        names = d["feature_names"].tolist()
    xs, ls, ys, ws, gs = [], [], [], [], []
    for c in matched:
        x, y, pts = load_case(*files[c], keep, scales, names, coords)
        rng = np.random.default_rng(int(c.replace("-", "")))
        m = (y > 0) | (rng.random(len(y)) < NEG_KEEP)
        xs.append(x[m]); ls.append(lag[c][pts][m]); ys.append(y[m])
        ws.append(np.where(y[m] > 0, 1.0, 1.0 / NEG_KEEP)); gs.append(np.full(m.sum(), S.fold_of(c) % 3))
    x, xl, y, w, g = (np.concatenate(v) for v in (xs, ls, ys, ws, gs))
    del xs, ls
    inputs = arm_inputs(x, xl)
    a.output.mkdir(parents=True, exist_ok=True)
    man = {"status": "frozen", "purpose": "prospective research archive only (not the preview, not production)",
           "rule": "research/severe/conus-v1/hrrr-lag/RULES.md (gate) and PROSPECTIVE.md (fresh verification)",
           "gate_run": 45675157126, "train_dates": len(matched), "excluded": excluded, "sampled_rows": int(len(y)),
           "events": int(y.sum()), "recipe_from_frozen_sha256": sha, "names": names, "lag_features": list(FEATURES),
           "arms": {}, "verification_2021_loaded": False, "protected_2025_outcomes_accessed": False}
    for k in ARMS:
        tree, cal = fit(inputs[k], y, w, g)
        raw = pickle.dumps({"arm": k, "tree": tree, "calibration": [float(cal[0]), float(cal[1])], "names": names,
                            "scales_day2": scales, "keep": keep, "lag_features": list(FEATURES), "train_dates": matched})
        (a.output / f"{k}.pkl").write_bytes(raw)
        man["arms"][k] = {"file": f"{k}.pkl", "sha256": hashlib.sha256(raw).hexdigest(), "predictors": int(inputs[k].shape[1]),
                          "calibration": [float(cal[0]), float(cal[1])]}
        print(f"froze {k}: {man['arms'][k]['sha256'][:12]}", flush=True)
    (a.output / "manifest.json").write_text(json.dumps(man, indent=1) + "\n")


def load_frozen_arms(root=ROOT / "research/severe/conus-v1/hrrr-lag/frozen"):
    import pickle
    man = json.loads((root / "manifest.json").read_text())
    out = {}
    for k, spec in man["arms"].items():
        raw = (root / spec["file"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != spec["sha256"]:
            raise ValueError(f"{k}: frozen lagged-arm file does not match its committed checksum")
        out[k] = (pickle.loads(raw), spec["sha256"])
    return out


def predict_arms(arms, x_raw_keep, lag_keep):
    """x_raw_keep: raw predictors at supported samples; lag_keep: the six lag features at the same samples."""
    import phase2_study as S
    any_model = next(iter(arms.values()))[0]
    e, _ = S.engineer(x_raw_keep, any_model["names"], any_model["scales_day2"])
    ins = arm_inputs(e.astype(np.float32), lag_keep.astype(np.float32))
    return {k: expit(m["calibration"][0] + m["calibration"][1] * m["tree"].decision_function(ins[k].astype(np.float64)))
            for k, (m, _) in arms.items()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("--dates", nargs="+", required=True)
    e.add_argument("--output", type=Path, required=True)
    f = sub.add_parser("fold")
    f.add_argument("--fold", type=int, required=True)
    f.add_argument("--conus", type=Path, required=True)
    f.add_argument("--lag", type=Path, required=True)
    f.add_argument("--output", type=Path, required=True)
    f.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
    f.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    c = sub.add_parser("combine")
    c.add_argument("--input", type=Path, required=True)
    c.add_argument("--output", type=Path, required=True)
    z = sub.add_parser("freeze")
    z.add_argument("--conus", type=Path, required=True)
    z.add_argument("--lag", type=Path, required=True)
    z.add_argument("--output", type=Path, required=True)
    z.add_argument("--expected-dates", type=int, default=724)
    z.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
    z.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    a = p.parse_args()
    {"extract": extract, "fold": fold, "combine": combine, "freeze": freeze}[a.cmd](a)


if __name__ == "__main__":
    main()
