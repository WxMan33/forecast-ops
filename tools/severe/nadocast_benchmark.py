#!/usr/bin/env python3
"""NadoCast head-to-head benchmark, Day 1 tornado (rules: research/severe/nadocast/benchmark-rules.json).

ours      v0.7 day1_tornado (frozen live coefficients) on the CONUS extraction's box samples
nadocast  D-1 12Z f24-47 TORPROB (2022 models, absolutely calibrated) at the nearest NadoCast
          grid point within 11 km; reported-only variants alongside
Scored on the shared footprint against the same Storm Events tornado labels. 2024 only; 2021 and
2025 are refused. Research only.
"""
import argparse
import email.utils
import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.special import expit

from conus_followup import SAMPLE_KM2
from conus_study import BOX, geography
from extract import digest

ROOT = "http://data.nadocast.com/"
UA = "forecast-ops-research-benchmark/0.1"
RULES = Path("research/severe/nadocast/benchmark-rules.json")
BASELINE = Path("research/severe/baseline-v07/models.json")
MAX_KM = 11.0
EARTH_KM = 6371.0088
SEED = 20261121
THRESHOLDS = (0.02, 0.05, 0.10, 0.15, 0.30)
BINS = (0, 0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.30, 1.0)
VARIANTS = {  # name -> (file pattern for valid day D, cutoff role)
    "nadocast": ("2022", True, "d1", "24-47"),
    "nadocast_spc_calibrated": ("2022", False, "d1", "24-47"),
    "nadocast_2024_preliminary": ("2024_preliminary", True, "d1", "24-47"),
    "nadocast_later_cutoff_day1": ("2022", True, "d0", "02-23"),
}


def nc_name(valid, v):
    model, abs_, which, period = VARIANTS[v]
    issue = date.fromisoformat(valid) - timedelta(days=1 if which == "d1" else 0)
    cal = "_abs_calib" if abs_ else ""
    return issue, f"nadocast_{model}_models_conus_tornado{cal}_{issue:%Y%m%d}_t12z_f{period}.grib2"


def fetch(valid, v, cache):
    issue, name = nc_name(valid, v)
    url = f"{ROOT}{issue:%Y%m}/{issue:%Y%m%d}/t12z/{name}"
    path = Path(cache) / name
    meta_path = path.with_suffix(".json")
    if path.exists() and meta_path.exists():
        return path, json.loads(meta_path.read_text())
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=90) as r:
                data, lm = r.read(), r.headers.get("Last-Modified")
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, {"url": url, "status": 404}
            if k == 3:
                raise
        except (urllib.error.URLError, TimeoutError):
            if k == 3:
                raise
        time.sleep(2 ** k)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    meta = {"url": url, "status": 200, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "last_modified": email.utils.parsedate_to_datetime(lm).astimezone(timezone.utc).isoformat() if lm else None}
    meta_path.write_text(json.dumps(meta))
    time.sleep(0.3)
    return path, meta


def decode(path, period):
    import eccodes as ec
    with open(path, "rb") as f:
        g = ec.codes_grib_new_from_file(f)
        try:
            meta = {k: ec.codes_get(g, k) for k in ("shortName", "units", "stepRange", "Nx", "Ny", "numberOfMissing")}
            a_, b_ = period.split("-")
            if meta["shortName"] != "torprob" or meta["units"] != "%" or meta["stepRange"] != f"{int(a_)}-{int(b_)}":
                raise ValueError(f"{path.name}: unexpected field {meta}")
            if (meta["Nx"], meta["Ny"]) != (387, 226) or meta["numberOfMissing"]:
                raise ValueError(f"{path.name}: unexpected grid {meta}")
            vals = np.asarray(ec.codes_get_array(g, "values"), float) / 100.0
            lat = np.asarray(ec.codes_get_array(g, "latitudes"))
            lon = (np.asarray(ec.codes_get_array(g, "longitudes")) + 180) % 360 - 180
        finally:
            ec.codes_release(g)
    if vals.min() < 0 or vals.max() > 1:
        raise ValueError(f"{path.name}: probabilities outside 0-100%")
    return vals, lat, lon


def unit(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.column_stack((np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)))


def load_box(root, wanted):
    """Day 1 features and tornado labels on the regional-box samples only (memory-light), with the
    same hash and grid checks as conus_study.load."""
    cases, xs, ys, coords, names, box = [], [], [], None, None, None
    for meta_path in sorted(Path(root).glob("*/conus-case.json")):
        meta = json.loads(meta_path.read_text())
        c = meta["case"]
        if not c.startswith("2024"):
            raise ValueError("Benchmark loads 2024 only (2021/2025 sealed)")
        if c not in wanted:
            continue
        path = meta_path.parent / meta["artifact"]["file"]
        if digest(path) != meta["artifact"]["sha256"]:
            raise ValueError(f"{c}: artifact hash mismatch")
        with np.load(path, allow_pickle=False) as d:
            if coords is None:
                coords, names = d["coordinates"], d["feature_names"].tolist()
                lon, lat = coords[:, 0], coords[:, 1]
                box = (lon >= BOX[0]) & (lon <= BOX[1]) & (lat >= BOX[2]) & (lat <= BOX[3])
            if not np.array_equal(d["coordinates"], coords) or d["feature_names"].tolist() != names:
                raise ValueError(f"{c}: grid or predictors differ")
            xs.append(d["features"][0][box])
            ys.append(d["labels"][0][box][:, 0])
        cases.append(c)
    return cases, np.stack(xs), np.stack(ys), coords[box], names


def v07(x, m):
    z = (x - np.array(m["feature_mean"])) / np.array(m["feature_scale"])
    return expit(m["calibration_intercept"] + m["calibration_slope"] * (m["intercept"] + z @ np.array(m["coefficients"])))


# ---------------------------------------------------------------- metrics
def boot_diff(se_a, se_b, n, rng, draws=5000):
    k = len(n)
    idx = rng.integers(0, k, size=(draws, k))
    da = se_a[idx].sum(1) / n[idx].sum(1)
    db = se_b[idx].sum(1) / n[idx].sum(1)
    return [float(np.percentile(da - db, 2.5)), float(np.percentile(da - db, 97.5))]


def scores(y, probs, d, ndays, rng):
    from sklearn.metrics import roc_auc_score
    base = float(y.mean())
    ref = float(np.mean((base - y) ** 2))
    out = {"points": int(len(y)), "report_points": int(y.sum()), "report_days": int(len(np.unique(d[y == 1]))),
           "dates": int(ndays), "base_rate": base, "models": {}}
    n_by = np.bincount(d, minlength=ndays).astype(float)
    se = {}
    rep_day = np.zeros(ndays, bool)
    rep_day[np.unique(d[y == 1])] = True
    nr_points = ~rep_day[d]
    for k, p in probs.items():
        se[k] = np.bincount(d, weights=(p - y) ** 2, minlength=ndays)
        b = float(np.mean((p - y) ** 2))
        rel = []
        for lo, hi in zip(BINS, BINS[1:]):
            s = (p >= lo) & (p < hi) if hi < 1 else (p >= lo)
            rel.append({"bin": [lo, hi], "n": int(s.sum()), "mean_forecast": float(p[s].mean()) if s.any() else None,
                        "observed": float(y[s].mean()) if s.any() else None, "reports": int(y[s].sum())})
        th = {}
        for t in THRESHOLDS:
            hit = (y == 1) & (p >= t)
            fa = (y == 0) & (p >= t)
            caught = np.zeros(ndays, bool)
            caught[np.unique(d[hit])] = True
            th[f"{t:.0%}"] = {"hits": int(hit.sum()), "misses": int(((y == 1) & (p < t)).sum()),
                              "pod": float(hit.sum() / max(y.sum(), 1)),
                              "false_alarm_km2_per_day": float(fa.sum() * SAMPLE_KM2 / ndays),
                              "area_km2_per_day": float((p >= t).sum() * SAMPLE_KM2 / ndays),
                              "no_report_day_area_km2_per_day": float(((p >= t) & nr_points).sum() * SAMPLE_KM2 / max((~rep_day).sum(), 1)),
                              "success_ratio": float(hit.sum() / max((p >= t).sum(), 1)),
                              "report_days_caught": int((caught & rep_day).sum())}
        out["models"][k] = {"brier": b, "brier_skill_vs_base_rate": float(1 - b / ref) if ref else None,
                            "roc_auc": float(roc_auc_score(y, p)) if 0 < y.sum() < len(y) else None,
                            "mean_forecast": float(p.mean()), "reliability": rel, "thresholds": th}
    if "nadocast" in se:
        for k in se:
            if k != "nadocast":
                out["models"][k]["brier_minus_nadocast"] = out["models"][k]["brier"] - out["models"]["nadocast"]["brier"]
                out["models"][k]["brier_minus_nadocast_95"] = boot_diff(se[k], se["nadocast"], n_by, rng)
    return out


# ---------------------------------------------------------------- run
def run(a):
    rules = json.loads(RULES.read_text())
    dates = rules["pilot"]["dates"] if a.stage == "pilot" else \
        rules["dates"]["primary_fresh_2024"] + rules["dates"]["exploratory_previously_inspected_2024"]
    if any(not d.startswith("2024") for d in dates):
        raise ValueError("Benchmark dates are 2024 only (2021/2025 sealed)")
    cases, X, Y, coords, names = load_box(a.conus, set(dates))
    missing = sorted(set(dates) - set(cases))
    use = [c for c in cases if c in set(dates)]
    idx = np.array([cases.index(c) for c in use])
    frozen = json.loads(BASELINE.read_text())
    if frozen["feature_names"] != names:
        raise ValueError("Frozen v0.7 feature order differs")
    lon, lat = coords[:, 0], coords[:, 1]
    supported, _ = geography(coords)
    cand = supported  # coords are already the box samples
    fetched, meta_all, dropped = {}, {}, {}
    grid = None
    for c in use:
        cutoff = datetime.fromisoformat(c).replace(hour=9, tzinfo=timezone.utc)
        for v in VARIANTS:
            path, meta = fetch(c, v, a.cache)
            meta_all.setdefault(c, {})[v] = meta
            if path is None:
                continue
            lm_v = meta.get("last_modified")
            v_cut = cutoff if VARIANTS[v][2] == "d1" else cutoff.replace(hour=18)
            if v != "nadocast" and (not lm_v or datetime.fromisoformat(lm_v) > v_cut):
                meta["excluded"] = f"Last-Modified {lm_v} after {v_cut.isoformat()} (amendment 1)"
                continue
            vals, glat, glon = decode(path, VARIANTS[v][3])
            if grid is None:
                grid = (glat, glon)
                tree = cKDTree(unit(glon, glat))
                dist, nn = tree.query(unit(lon[cand], lat[cand]))
                km = 2 * EARTH_KM * np.arcsin(np.minimum(dist / 2, 1))
            elif not (np.array_equal(glat, grid[0]) and np.array_equal(glon, grid[1])):
                raise ValueError(f"{c} {v}: NadoCast grid changed")
            fetched.setdefault(c, {})[v] = vals[nn]
        prim = meta_all[c].get("nadocast", {})
        lm = prim.get("last_modified")
        if prim.get("status") != 200:
            dropped[c] = "primary NadoCast file missing"
        elif lm and datetime.fromisoformat(lm) > cutoff:
            dropped[c] = f"primary file Last-Modified {lm} is after the 09Z cutoff"
        print(c, {v: m.get("status") for v, m in meta_all[c].items()}, "lm", lm, flush=True)
    within = km <= MAX_KM
    foot = np.zeros(len(coords), bool)
    foot[np.where(cand)[0][within]] = True
    keep_frac = float(foot.sum() / cand.sum())
    scored = [c for c in use if c not in dropped]
    m = frozen["products"]["day1_tornado"]
    fi = np.where(foot)[0]
    sub = within  # positions inside cand order
    rows = {k: [] for k in ("y", "d", "p")}
    probs = {k: [] for k in ["ours"] + list(VARIANTS)}
    have = {v: [] for v in VARIANTS}
    unknown = 0
    rows["pt"] = []
    for j, c in enumerate(scored):
        i = cases.index(c)
        lab = Y[i][fi]
        known = lab != 255  # 255 = label unknown; dropped for both forecasts
        unknown += int((~known).sum())
        rows["y"].append(lab[known].astype(float))
        rows["d"].append(np.full(int(known.sum()), j))
        rows["pt"].append(np.where(known)[0])
        probs["ours"].append(v07(X[i][fi][known].astype(float), m))
        for v in VARIANTS:
            ok = v in fetched.get(c, {})
            have[v].append(ok)
            probs[v].append(fetched[c][v][sub][known] if ok else np.full(int(known.sum()), np.nan))
    y = np.concatenate(rows["y"])
    d = np.concatenate(rows["d"])
    pt = np.concatenate(rows["pt"])
    P = {k: np.concatenate(v) for k, v in probs.items()}
    a.output.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    fresh = set(rules["dates"]["primary_fresh_2024"])

    def card(sel_dates):
        s = np.isin(d, [scored.index(c) for c in sel_dates])
        dd = np.unique(d[s], return_inverse=True)[1]
        nd = len(sel_dates)
        head = {k: P[k][s] for k in ("ours", "nadocast")}
        out = {"head_to_head": scores(y[s], head, dd, nd, rng)}
        for v in ("nadocast_spc_calibrated", "nadocast_2024_preliminary", "nadocast_later_cutoff_day1"):
            ok = s & np.isfinite(P[v])
            if not ok.any():
                continue
            dsel = sorted({scored[k] for k in np.unique(d[ok])})
            okd = np.unique(d[ok], return_inverse=True)[1]
            out[f"reported_{v}"] = {"dates": len(dsel),
                                    **scores(y[ok], {"ours": P["ours"][ok], "nadocast": P["nadocast"][ok], v: P[v][ok]},
                                             okd, len(dsel), rng)}
        return out

    sets = {"primary_fresh": [c for c in scored if c in fresh],
            "exploratory_previously_inspected": [c for c in scored if c not in fresh]}
    res = {"rules": str(RULES), "stage": a.stage, "requested_dates": len(dates), "extracted_dates": len(use),
           "missing_extraction": missing, "dropped": dropped, "scored_dates": len(scored),
           "footprint": {"box_supported_samples": int(cand.sum()), "footprint_samples": int(foot.sum()),
                         "kept_fraction": keep_frac, "max_nearest_km": float(km[within].max()),
                         "median_nearest_km": float(np.median(km[within])),
                         "unknown_label_points_dropped": unknown},
           "nadocast_files": meta_all, "protected_2025_outcomes_accessed": False, "sealed_2021_accessed": False}
    for k, sel in sets.items():
        if sel:
            res[k] = card(sel)
    checks = {"files_fetched_and_pinned": all(meta_all[c].get("nadocast", {}).get("sha256") for c in use),
              "nearest_within_11km_and_footprint_ge_95pct": bool(keep_frac >= 0.95),
              "v07_loaded": len(use) == len(dates),
              "finite": bool(np.isfinite(P["ours"]).all() and np.isfinite(P["nadocast"]).all())}
    res["pilot_checks"] = {**checks, "pass": all(checks.values())}
    (a.output / f"{a.stage}-scorecard.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    np.savez_compressed(a.output / f"{a.stage}-arrays.npz", y=y, d=d, pt=pt, coords=coords[fi], dates=np.array(scored),
                        **{f"p_{k}": v for k, v in P.items()})
    print(json.dumps({"stage": a.stage, "scored_dates": len(scored), "dropped": len(dropped), "checks": res["pilot_checks"]}))
    if a.stage == "score":
        maps(a.output, scored, sets["primary_fresh"], coords[fi], y, d, pt, P, res)


def maps(out, scored, fresh_dates, xy_all, y, d, pt, P, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    from phase2_maps import CMAP, COLORS, LEVELS, NORM, draw_states, states
    rings = states()
    fi = [scored.index(c) for c in fresh_dates]
    rep = {j: int(y[d == j].sum()) for j in fi}
    active = max(fi, key=lambda j: rep[j])
    quiet_pool = [j for j in fi if rep[j] == 0]
    quiet = max(quiet_pool, key=lambda j: float(np.max((P["ours"][d == j] + P["nadocast"][d == j]) / 2))) if quiet_pool else None
    picks = {"active": active, "quiet_or_false_alarm": quiet}
    res["map_cases"] = {k: scored[j] for k, j in picks.items() if j is not None}
    for kind, j in picks.items():
        if j is None:
            continue
        s = d == j
        xy = xy_all[pt[s]]
        fig, axes = plt.subplots(1, 2, figsize=(14, 5.6))
        for ax, (lab, key) in zip(axes, (("Forecast Ops v0.7 (06Z HRRR, issued ~09Z)", "ours"),
                                         ("NadoCast 2022 models, abs. calibrated (12Z of the previous day, f24-47)", "nadocast"))):
            pr = P[key][s]
            ax.scatter(xy[:, 0], xy[:, 1], c=pr, cmap=CMAP, norm=NORM, s=4, marker="s", lw=0)
            ev = y[s] == 1
            ax.scatter(xy[ev, 0], xy[ev, 1], s=3, c="#08306b", marker=".", lw=0)
            draw_states(ax, rings)
            ax.set_xlim(BOX[0] - 1, BOX[1] + 1); ax.set_ylim(BOX[2] - 1, BOX[3] + 1)
            ax.set_aspect(1 / np.cos(np.radians(37.5))); ax.set_xticks([]); ax.set_yticks([])
            a5 = int(((pr >= 0.05) & ~ev).sum() * SAMPLE_KM2)
            h5 = int((ev & (pr >= 0.05)).sum())
            ax.set_title(f"{lab}\nmax {pr.max():.0%}; >=5%: {h5} of {int(ev.sum())} report points hit, "
                         f"{a5:,} km2 with no report", fontsize=8.5)
        fig.suptitle(f"{kind.replace('_', ' ')} day: convective day {scored[j]} 12Z to 12Z. Tornado within 25 miles. "
                     "Dots = points with a tornado report within 25 miles. Research only; not an official outlook.", fontsize=9.5)
        fig.legend(handles=[Patch(color=c, label=f"{lo:.0%}-{hi:.0%}") for c, lo, hi in zip(COLORS, LEVELS, LEVELS[1:])],
                   loc="lower center", ncol=7, fontsize=8, frameon=False)
        fig.tight_layout(rect=(0, 0.05, 1, 0.93))
        fig.savefig(out / f"map-{kind}-{scored[j]}.png", dpi=110)
        plt.close(fig)
    (out / "score-scorecard.json").write_text(json.dumps(res, indent=1, default=float) + "\n")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--stage", choices=("pilot", "score"), required=True)
    p.add_argument("--conus", type=Path, required=True, help="<case>/conus-case.json directories")
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    run(p.parse_args())


if __name__ == "__main__":
    main()
