#!/usr/bin/env python3
"""Retrospective RRFS development pilot, first comparison (Day 2 damaging wind).

Rules: research/severe/conus-v1/rrfs/retro/RULES.md (committed before any score was computed).

  cache  per roster date: the existing (or newly extracted) HRRR Day 2 case + the retrospective RRFS extract ->
         <cache>/<date>.npz (HRRR raw predictors, RRFS raw predictors per cycle, wind labels, row index) with
         SHA-256 in <cache>/manifest.json. Every dropped date is logged with its reason.
  score  hold out each archive block in turn; fit HRRR-only, RRFS-only and HRRR+RRFS with the fixed regularized
         logistic recipe on the other blocks only; score identical held-out rows; write scorecard.json/.md.
Research only. 2025 is refused; nothing touches the live feed, publisher, registry, preview or collectors.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BLOCKS = {"jul2023": ("2023-07",), "janfeb2024": ("2024-01", "2024-02"), "may2024": ("2024-05",)}
FIELDS = ("gust", "refc", "uh25", "uh03", "maxuvv", "wind10max", "cape_sfc", "srh01", "shear06")
STATS = ("nbhdmax24", "nbhdmax18", "mean24")
C_REG = 0.1           # inverse L2 strength on standardized predictors (fixed; not tuned)
FA_REF = 0.05         # HRRR-arm probability that defines the reference false-alarm area
BINS = (0, 0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.30, 1.0)
BOOT, SEED = 2000, 20261127
FL = "florida_gulf_south"
SAMPLE_KM2 = 225.0


def sha(b):
    return hashlib.sha256(b).hexdigest()


def block_of(date):
    return next((k for k, v in BLOCKS.items() if date.startswith(v)), None)


def rrfs_names(cyc):
    return [f"c{cyc:02d}_{f}_{s}" for f in FIELDS for s in STATS]


# ---------------------------------------------------------------- cache
def cache(a):
    from conus_calibration import check_frozen
    fitted, gsha = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    keep, coords_ref = fitted["keep"], np.asarray(fitted["coords"])
    kidx = np.nonzero(keep)[0]
    roster = json.loads(Path(a.roster).read_text())["dates"]
    hrrr = {}
    for root in a.hrrr:
        for m in sorted(Path(root).glob("*/conus-case.json")):
            c = json.loads(m.read_text())["case"]
            hrrr.setdefault(c, []).append(m.parent)
    out = Path(a.output)
    out.mkdir(parents=True, exist_ok=True)
    rows, names_ref = [], None
    for d in roster:
        if d.startswith("2025") or block_of(d) is None:
            raise ValueError(f"{d}: not a pilot date")
        rec = {"date": d, "block": block_of(d)}
        try:
            if d not in hrrr:
                raise LookupError("no HRRR case")
            src = hrrr[d][0]
            meta = json.loads((src / "conus-case.json").read_text())
            raw = (src / meta["artifact"]["file"]).read_bytes()
            if sha(raw) != meta["artifact"]["sha256"]:
                raise ValueError("HRRR case artifact hash mismatch")
            w2 = next(w for w in meta["windows"] if w["day"] == 2)
            with np.load(io.BytesIO(raw), allow_pickle=False) as z:
                if not np.array_equal(z["coordinates"], coords_ref):
                    raise ValueError("HRRR grid differs")
                names = z["feature_names"].tolist()
                if names_ref is None:
                    names_ref = names
                if names != names_ref:
                    raise ValueError("HRRR predictor names differ")
                xh = z["features"][1][keep].astype(np.float32)
                y = z["labels"][1][keep][:, 1]
            r_arrays, cyc_status = {}, {}
            for cyc in (12, 6):
                mp = Path(a.rrfs) / d / f"rrfs-{cyc:02d}z.json"
                st = json.loads(mp.read_text()) if mp.exists() else {"status": "not_extracted"}
                cyc_status[f"{cyc:02d}z"] = st["status"] if st["status"] == "ok" else f"{st['status']}: {st.get('error', '')[:200]}"
                if st["status"] != "ok":
                    continue
                b = (mp.parent / st["artifact"]["file"]).read_bytes()
                if sha(b) != st["artifact"]["sha256"]:
                    raise ValueError(f"RRFS {cyc:02d}Z artifact hash mismatch")
                if st["valid_window"][0] != w2["valid_start"] or st["valid_window"][1] != w2["valid_end"]:
                    raise ValueError(f"RRFS {cyc:02d}Z valid window {st['valid_window']} != HRRR {w2['valid_start']}..{w2['valid_end']}")
                with np.load(io.BytesIO(b), allow_pickle=False) as z:
                    if not np.array_equal(z["sample_index"], kidx):
                        raise ValueError("RRFS sample rows differ")
                    r_arrays[f"rrfs{cyc:02d}"] = np.stack([z[n] for n in rrfs_names(cyc)], axis=1).astype(np.float32)
            if "rrfs12" not in r_arrays:
                raise LookupError(f"RRFS 12Z not usable ({cyc_status['12z']})")
            buf = io.BytesIO()
            np.savez_compressed(buf, hrrr=xh, labels=y, row_index=kidx.astype(np.int32), **r_arrays)
            data = buf.getvalue()
            (out / f"{d}.npz").write_bytes(data)
            rec |= {"status": "ok", "hrrr_source": str(src), "hrrr_case_sha256": meta["artifact"]["sha256"],
                    "report_source": meta["report_source"]["file"], "valid_window": [w2["valid_start"], w2["valid_end"]],
                    "rrfs": cyc_status, "known_label_rows": int((y != 255).sum()), "event_rows": int((y == 1).sum()),
                    "cache": {"file": f"{d}.npz", "sha256": sha(data), "bytes": len(data)}}
        except Exception as e:
            rec |= {"status": "dropped", "reason": repr(e)[:300]}
        rows.append(rec)
        print(d, rec["status"], rec.get("reason", ""), flush=True)
    man = {"version": "rrfs-retro-pilot-cache-v1", "frozen_grid_from_sha256": gsha, "hrrr_feature_names": names_ref,
           "rrfs_feature_names": {"12z": rrfs_names(12), "06z": rrfs_names(6)}, "rows": "supported CONUS samples (frozen keep mask)",
           "label": "Day 2 damaging wind (>= 50 kt within 25 miles, pinned final Storm Events); 255 = unknown magnitude, excluded",
           "dates": rows, "ok": sum(r["status"] == "ok" for r in rows), "dropped": sum(r["status"] != "ok" for r in rows)}
    (out / "manifest.json").write_text(json.dumps(man, indent=1) + "\n")
    print(json.dumps({k: man[k] for k in ("ok", "dropped")}))


# ---------------------------------------------------------------- score
def load_cache(root, cyc=12, dates=None):
    root = Path(root)
    man = json.loads((root / "manifest.json").read_text())
    use = [r for r in man["dates"] if r["status"] == "ok" and (dates is None or r["date"] in dates)]
    if cyc == 6:
        use = [r for r in use if r["rrfs"]["06z"] == "ok"]
    D = {}
    for r in use:
        b = (root / r["cache"]["file"]).read_bytes()
        if sha(b) != r["cache"]["sha256"]:
            raise ValueError(f"{r['date']}: cache hash mismatch")
        with np.load(io.BytesIO(b), allow_pickle=False) as z:
            y = z["labels"]
            k = y != 255
            xr = z["rrfs12"][k] if cyc == 12 else np.concatenate([z["rrfs12"][k], z["rrfs06"][k]], axis=1)
            D[r["date"]] = (z["hrrr"][k], xr, y[k].astype(np.float64), z["row_index"][k])
    return man, D


def asinh_scales(x):
    a = np.abs(x)
    return np.array([np.median(c[c > 0]) if (c > 0).any() else 1.0 for c in a.T])


# RRFS columns per arm: 12Z occupies columns 0-26; in the 06Z follow-up the cache adds 06Z as columns 27-53
RRFS_COLS = {"rrfs": slice(0, 27), "rrfs06": slice(27, 54), "rrfs_2cyc": slice(0, 54)}
# Field-group ablation (research/severe/conus-v1/rrfs/retro/ABLATION.md): every one of the nine fields is in exactly
# one group; each ablation arm drops one group's 3 predictors per field from the full 12Z set.
GROUPS = {"gust": ("gust", "wind10max"), "refl": ("refc",), "updraft": ("uh25", "uh03", "maxuvv"),
          "env": ("cape_sfc", "srh01", "shear06")}
assert sorted(sum(GROUPS.values(), ())) == sorted(FIELDS)
for _g, _fs in GROUPS.items():
    RRFS_COLS[f"rrfs_no_{_g}"] = np.array([3 * i + j for i, f in enumerate(FIELDS) if f not in _fs for j in range(3)])
ABL_ARMS = ("hrrr", "hrrr_rrfs") + tuple(f"hrrr_rrfs_no_{g}" for g in GROUPS)
BLEND_REF = "hrrr_rrfs"
TREE_ARMS = ("hrrr", "hrrr_rrfs", "hrrr_rrfs_smooth", "hrrr_rrfs_gbt", "hrrr_rrfs_gbt_raw")
TREE_PAIRS = (("hrrr_rrfs_gbt", "hrrr_rrfs"), ("hrrr_rrfs_gbt", "hrrr_rrfs_smooth"), ("hrrr_rrfs_gbt_raw", "hrrr_rrfs"),
              ("hrrr_rrfs_gbt_raw", "hrrr_rrfs_smooth"), ("hrrr_rrfs_smooth", "hrrr_rrfs"), ("hrrr_rrfs_gbt", "hrrr"))
SMOOTH_ARMS = ("hrrr", "hrrr_rrfs", "hrrr_rrfs_smooth")
SMOOTH_PAIRS = (("hrrr_rrfs_smooth", "hrrr_rrfs"), ("hrrr_rrfs_smooth", "hrrr"), ("hrrr_rrfs", "hrrr"))
TWO_ARMS = ("hrrr", "hrrr_rrfs", "hrrr_rrfs_2cyc")
TWO_PAIRS = (("hrrr_rrfs_2cyc", "hrrr_rrfs"), ("hrrr_rrfs_2cyc", "hrrr"), ("hrrr_rrfs", "hrrr"))
FLCAL_ARMS = ("hrrr", "hrrr_rrfs", "hrrr_rrfs_flcal")
FLCAL_PAIRS = (("hrrr_rrfs_flcal", "hrrr_rrfs"), ("hrrr_rrfs_flcal", "hrrr"), ("hrrr_rrfs", "hrrr"))
ABL_PAIRS = tuple((f"hrrr_rrfs_no_{g}", "hrrr_rrfs") for g in GROUPS) + (("hrrr_rrfs", "hrrr"),)


def design(arm, xh, xr, names, sc):
    import phase2_study as S
    parts = []
    if arm.startswith("hrrr"):
        parts.append(S.engineer(xh, names, sc["hrrr"])[0])
    cols = RRFS_COLS.get(arm.replace("hrrr_", "").replace("hrrr", ""))
    if cols is not None:
        parts.append(np.arcsinh(xr[:, cols] / sc["rrfs"][cols]))
    return np.concatenate(parts, axis=1)


def fit_arm(arm, xh, xr, y, names):
    import phase2_study as S
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    sc = {"hrrr": S.engineer(xh, names)[1], "rrfs": asinh_scales(xr)}
    X = design(arm, xh, xr, names, sc)
    st = StandardScaler().fit(X)
    lr = LogisticRegression(C=C_REG, max_iter=5000, tol=1e-7).fit(st.transform(X), y)
    return {"sc": sc, "st": st, "lr": lr}


def predict(model, arm, xh, xr, names):
    X = model["st"].transform(design(arm, xh, xr, names, model["sc"]))
    return model["lr"].predict_proba(X)[:, 1]


def fa_threshold(p, y, frac):
    """Smallest threshold whose no-report exceedance fraction is <= frac."""
    p0 = np.sort(p[y == 0])[::-1]
    k = int(np.floor(frac * len(p0)))
    return float(p0[k]) if k < len(p0) else -1.0


def run_comparison(D, names, arms=("hrrr", "rrfs", "hrrr_rrfs"), log=print):
    from conus_calibration import REGIONS, region_index
    from conus_calibration import check_frozen
    from conus_study import regions
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    reg_all = region_index(None, regions(np.asarray(fitted["coords"])), fitted["keep"])
    kidx = np.nonzero(fitted["keep"])[0]
    pos = np.full(int(kidx.max()) + 1, -1)
    pos[kidx] = np.arange(len(kidx))
    dates = sorted(D)
    P = {a: {} for a in arms}
    thr = {}
    folds = {}
    for blk in BLOCKS:
        test = [d for d in dates if block_of(d) == blk]
        train = [d for d in dates if block_of(d) != blk]
        if not test or not train:
            continue
        xh = np.concatenate([D[d][0] for d in train]); xr = np.concatenate([D[d][1] for d in train])
        y = np.concatenate([D[d][2] for d in train])
        thr[blk] = {}
        for arm in arms:
            if arm in ("hrrr_rrfs_flcal", "hrrr_rrfs_smooth", "hrrr_rrfs_gbt", "hrrr_rrfs_gbt_raw"):
                continue  # derived below from the unchanged hrrr_rrfs model
            m = fit_arm(arm, xh, xr, y, names)
            ptr = predict(m, arm, xh, xr, names)
            thr[blk][arm] = ptr
            for d in test:
                P[arm][d] = predict(m, arm, D[d][0], D[d][1], names).astype(np.float64)
            log(f"{blk}: {arm} fitted on {len(train)} dates ({int(y.sum())} event rows), iters {int(m['lr'].n_iter_[0])}")
            FINGERPRINTS.setdefault("coefficients", {})[f"{blk}/{arm}"] = sha(np.concatenate([m["lr"].coef_.ravel(), m["lr"].intercept_]).tobytes())
        if "hrrr_rrfs_flcal" in arms:
            # Florida/Gulf-only monotone logit adjustment, fit on out-of-fold predictions inside the training blocks:
            # for each training block, hrrr_rrfs is refit on the other training block and predicts it.
            fl_id = REGIONS.index(FL)
            rtr = np.concatenate([reg_all[pos[D[d][3]]] for d in train]) == fl_id
            tblocks = sorted({block_of(d) for d in train})
            oof_p, oof_y = [], []
            for tb in tblocks:
                inner_fit = [d for d in train if block_of(d) != tb]
                inner_pred = [d for d in train if block_of(d) == tb]
                mi = fit_arm("hrrr_rrfs", np.concatenate([D[d][0] for d in inner_fit]), np.concatenate([D[d][1] for d in inner_fit]),
                             np.concatenate([D[d][2] for d in inner_fit]), names)
                for d in inner_pred:
                    f = reg_all[pos[D[d][3]]] == fl_id
                    oof_p.append(predict(mi, "hrrr_rrfs", D[d][0][f], D[d][1][f], names)); oof_y.append(D[d][2][f])
                log(f"{blk}: inner hrrr_rrfs fit on {tb} complement ({len(inner_fit)} dates) -> out-of-fold {tb} Florida/Gulf rows")
            cal = fit_logit_adjust(np.concatenate(oof_p), np.concatenate(oof_y))
            CALIBRATIONS[blk] = cal | {"oof_rows": int(sum(len(v) for v in oof_y)), "oof_event_rows": int(sum(v.sum() for v in oof_y)),
                                      "oof_forecast_to_observed": float(np.concatenate(oof_p).sum() / max(np.concatenate(oof_y).sum(), 1))}
            log(f"{blk}: Florida/Gulf adjustment a={cal['a']:.4f} b={cal['b']:.4f} (lower bound active: {cal['b_at_lower_bound']})")
            thr[blk]["hrrr_rrfs_flcal"] = np.where(rtr, apply_logit_adjust(thr[blk]["hrrr_rrfs"], cal), thr[blk]["hrrr_rrfs"])
            for d in test:
                f = reg_all[pos[D[d][3]]] == fl_id
                P["hrrr_rrfs_flcal"][d] = np.where(f, apply_logit_adjust(P["hrrr_rrfs"][d], cal), P["hrrr_rrfs"][d])
        if "hrrr_rrfs_gbt" in arms:
            # fixed tree recipe (phase2_study.GBT_PARAMS) on the same HRRR + 12Z RRFS inputs, weighted sampling;
            # monotone calibration fit on out-of-fold tree scores inside the training blocks only
            from conus_fulldev import weighted_platt
            from scipy.special import expit
            import phase2_study as S
            xh_tr = np.concatenate([D[d][0] for d in train]); xr_tr = np.concatenate([D[d][1] for d in train])
            sc = {"hrrr": S.engineer(xh_tr, names)[1], "rrfs": asinh_scales(xr_tr)}
            del xh_tr, xr_tr
            oz, oy, ow = [], [], []
            for tb in sorted({block_of(d) for d in train}):
                ti, _ = fit_tree([d for d in train if block_of(d) != tb], D, names, sc)
                pm = tree_sample([d for d in train if block_of(d) == tb], D)
                for d, k in zip([d for d in train if block_of(d) == tb], pm):
                    oz.append(ti.decision_function(design("hrrr_rrfs", D[d][0][k], D[d][1][k], names, sc).astype(np.float32)))
                    oy.append(D[d][2][k]); ow.append(np.where(D[d][2][k] > 0, 1.0, 1.0 / TREE_NEG_KEEP))
                log(f"{blk}: inner tree fit without {tb} -> out-of-fold scores for {tb}")
            cal = weighted_platt(np.concatenate(oz), np.concatenate(oy), np.concatenate(ow))
            tree, _ = fit_tree(train, D, names, sc)
            TREES[blk] = {"calibration": [float(cal[0]), float(cal[1])], "n_iter": int(tree.n_iter_)}
            FINGERPRINTS.setdefault("coefficients", {})[f"{blk}/hrrr_rrfs_gbt"] = sha(
                np.concatenate([np.asarray(cal, float), tree.decision_function(design("hrrr_rrfs", D[train[0]][0][:2000], D[train[0]][1][:2000], names, sc).astype(np.float32))]).tobytes())
            log(f"{blk}: tree fitted ({tree.n_iter_} iterations); calibration a={cal[0]:.4f} b={cal[1]:.4f}")
            dtr = np.concatenate([tree.decision_function(design("hrrr_rrfs", D[d][0], D[d][1], names, sc).astype(np.float32)) for d in train])
            thr[blk]["hrrr_rrfs_gbt"] = expit(cal[0] + cal[1] * dtr)
            thr[blk]["hrrr_rrfs_gbt_raw"] = expit(dtr)
            for d in test:
                z_ = tree.decision_function(design("hrrr_rrfs", D[d][0], D[d][1], names, sc).astype(np.float32))
                P["hrrr_rrfs_gbt"][d] = expit(cal[0] + cal[1] * z_)
                P["hrrr_rrfs_gbt_raw"][d] = expit(z_)
        if "hrrr_rrfs_smooth" in arms and FIXED_RADIUS is not None:
            ck = np.asarray(fitted["coords"])[kidx]
            SMOOTHING[blk] = {"radius_km": FIXED_RADIUS, "fixed": True}
            lens = np.cumsum([0] + [len(D[d][2]) for d in train])
            thr[blk]["hrrr_rrfs_smooth"] = np.concatenate([smooth_date(thr[blk]["hrrr_rrfs"][lens[i]:lens[i + 1]], pos[D[d][3]], FIXED_RADIUS, ck)
                                                           for i, d in enumerate(train)])
            for d in test:
                P["hrrr_rrfs_smooth"][d] = smooth_date(P["hrrr_rrfs"][d], pos[D[d][3]], FIXED_RADIUS, ck)
        elif "hrrr_rrfs_smooth" in arms:
            # radius chosen on out-of-fold predictions inside the training blocks only (Brier, ties -> smaller radius)
            ck = np.asarray(fitted["coords"])[kidx]
            tblocks = sorted({block_of(d) for d in train})
            bs = {r: 0.0 for r in SMOOTH_RADII_KM}
            n_oof = 0
            for tb in tblocks:
                inner_fit = [d for d in train if block_of(d) != tb]
                mi = fit_arm("hrrr_rrfs", np.concatenate([D[d][0] for d in inner_fit]), np.concatenate([D[d][1] for d in inner_fit]),
                             np.concatenate([D[d][2] for d in inner_fit]), names)
                for d in [d for d in train if block_of(d) == tb]:
                    po = predict(mi, "hrrr_rrfs", D[d][0], D[d][1], names)
                    for r in SMOOTH_RADII_KM:
                        bs[r] += float(((smooth_date(po, pos[D[d][3]], r, ck) - D[d][2]) ** 2).sum())
                    n_oof += len(po)
            best = min(SMOOTH_RADII_KM, key=lambda r: (round(bs[r] / n_oof, 12), r))
            SMOOTHING[blk] = {"radius_km": best, "oof_brier_by_radius": {str(r): bs[r] / n_oof for r in SMOOTH_RADII_KM}, "oof_rows": n_oof}
            log(f"{blk}: smoothing radius {best} km (out-of-fold Brier by radius: " + ", ".join(f"{r}: {bs[r]/n_oof:.6f}" for r in SMOOTH_RADII_KM) + ")")
            lens = np.cumsum([0] + [len(D[d][2]) for d in train])
            thr[blk]["hrrr_rrfs_smooth"] = np.concatenate([smooth_date(thr[blk]["hrrr_rrfs"][lens[i]:lens[i + 1]], pos[D[d][3]], best, ck)
                                                           for i, d in enumerate(train)])
            for d in test:
                P["hrrr_rrfs_smooth"][d] = smooth_date(P["hrrr_rrfs"][d], pos[D[d][3]], best, ck)
        # deployable thresholds: each arm matches, on its own training predictions, the training false-alarm
        # fraction of the HRRR arm at FA_REF
        frac = float(((thr[blk]["hrrr"] >= FA_REF) & (y == 0)).sum() / (y == 0).sum())
        thr[blk] = {"train_fa_fraction_ref": frac, "thresholds": {arm: (FA_REF if arm == "hrrr" else fa_threshold(thr[blk][arm], y, frac)) for arm in arms}}
        folds[blk] = {"test_dates": test, "train_dates": len(train), "train_event_rows": int(y.sum()), "train_base_rate": float(y.mean()),
                      **thr[blk]}
        del xh, xr
    return P, folds, reg_all, pos


FINGERPRINTS = {}
CALIBRATIONS = {}
SMOOTHING = {}
TREES = {}
FIXED_RADIUS = None  # set by the tree experiment (the smoothed baseline uses 100 km, no re-selection)
SMOOTH_RADII_KM = (0, 25, 50, 75, 100)  # 0 = no smoothing; chosen per fold on training blocks only
_ADJ = {}


def adjacency(r_km, coords_keep):
    """0/1 neighbour matrix over the supported samples within r_km (great-circle), self included."""
    from scipy.sparse import csr_matrix
    from scipy.spatial import cKDTree
    if r_km not in _ADJ:
        lon, lat = np.radians(coords_keep[:, 0]), np.radians(coords_keep[:, 1])
        xyz = np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))
        nb = cKDTree(xyz).query_ball_point(xyz, 2 * np.sin(r_km / 6371.0088 / 2))
        rows = np.repeat(np.arange(len(nb)), [len(x) for x in nb])
        _ADJ[r_km] = csr_matrix((np.ones(len(rows)), (rows, np.concatenate(nb))), shape=(len(nb), len(nb)))
    return _ADJ[r_km]


def smooth_date(p, keep_pos, r_km, coords_keep):
    """Neighbourhood mean of one date's probabilities over the supported samples that have a prediction
    (coastal/edge cells average only over available neighbours; nothing outside the supported set counts as zero)."""
    if r_km == 0:
        return p
    A = adjacency(r_km, coords_keep)
    full = np.zeros(A.shape[0]); have = np.zeros(A.shape[0])
    full[keep_pos] = p; have[keep_pos] = 1.0
    return (A @ full)[keep_pos] / (A @ have)[keep_pos]
B_MIN = 1e-3  # strictly positive slope (lower bound); whether it binds is reported


def logit(p):
    p = np.clip(p, 1e-7, 1 - 1e-7)
    return np.log(p / (1 - p))


def fit_logit_adjust(p, y):
    """logit p' = a + b * logit p, b >= B_MIN > 0, unweighted log loss (monotone; ranking preserved)."""
    from scipy.optimize import minimize
    from scipy.special import expit
    z = logit(p)
    def f(q):
        t = q[0] + q[1] * z
        g = (expit(t) - y) / len(y)
        return np.mean(np.logaddexp(0, t) - y * t), np.array([g.sum(), (g * z).sum()])
    r = minimize(f, np.array([0.0, 1.0]), jac=True, method="L-BFGS-B", bounds=[(None, None), (B_MIN, None)])
    return {"a": float(r.x[0]), "b": float(r.x[1]), "b_at_lower_bound": bool(r.x[1] <= B_MIN * 1.0001), "converged": bool(r.success)}


TREE_NEG_KEEP = 0.2


def tree_sample(dates, D):
    """Every event row plus a per-date-seeded 20% of no-event rows (weight 5), as in the fulldev tree experiments."""
    idx = []
    for d in dates:
        y = D[d][2]
        rng = np.random.default_rng(int(d.replace("-", "")))
        idx.append((y > 0) | (rng.random(len(y)) < TREE_NEG_KEEP))
    return idx


def fit_tree(dates, D, names, sc):
    import phase2_study as S
    from sklearn.ensemble import HistGradientBoostingClassifier
    m = tree_sample(dates, D)
    X = np.concatenate([design("hrrr_rrfs", D[d][0][k], D[d][1][k], names, sc) for d, k in zip(dates, m)]).astype(np.float32)
    y = np.concatenate([D[d][2][k] for d, k in zip(dates, m)])
    w = np.where(y > 0, 1.0, 1.0 / TREE_NEG_KEEP)
    return HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(X, y, sample_weight=w), (X, y, w)


def apply_logit_adjust(p, cal):
    from scipy.special import expit
    return expit(cal["a"] + cal["b"] * logit(p))


def run_environment():
    """CPU and math-library settings that decide floating-point kernels (recorded for reproducibility)."""
    import os
    import platform
    info = {"python": platform.python_version(), "numpy": np.__version__,
            "env": {k: os.environ.get(k) for k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "OPENBLAS_CORETYPE", "NPY_DISABLE_CPU_FEATURES")}}
    try:
        cpu = Path("/proc/cpuinfo").read_text()
        info["cpu_model"] = next((l.split(":", 1)[1].strip() for l in cpu.splitlines() if l.startswith("model name")), None)
        info["cpu_avx512f"] = " avx512f" in cpu
    except OSError:
        pass
    try:
        from numpy._core._multiarray_umath import __cpu_features__ as f
        info["numpy_active_avx512"] = sorted(k for k, v in f.items() if v and k.startswith("AVX512"))
    except Exception:
        pass
    try:
        import sklearn
        import threadpoolctl
        info["sklearn"] = sklearn.__version__
        info["threadpools"] = [{k: t.get(k) for k in ("internal_api", "version", "num_threads", "architecture")} for t in threadpoolctl.threadpool_info()]
    except Exception:
        pass
    return info


PAIRS = (("hrrr_rrfs", "hrrr"), ("rrfs", "hrrr"), ("hrrr_rrfs", "rrfs"))
PAIRS06 = (("hrrr_rrfs06", "hrrr_rrfs"), ("hrrr_rrfs06", "hrrr"), ("hrrr_rrfs", "hrrr"))


def summarize(D, P, folds, reg_all, pos, arms, names_regions, pairs=PAIRS):
    rng = np.random.default_rng(SEED)
    out = {}
    scopes = {"all_blocks": list(folds)} | {b: [b] for b in folds}
    for scope, blks in scopes.items():
        dates = sorted(d for b in blks for d in folds[b]["test_dates"])
        for region in ("national", FL):
            per = []  # per date: [n, events, sse_a..., sump_a..., hits_a, fa_a, eqhits_a]
            ys, ps, ds = [], {a: [] for a in arms}, []
            for d in dates:
                y = D[d][2]
                rsel = np.ones(len(y), bool) if region == "national" else reg_all[pos[D[d][3]]] == names_regions.index(FL)
                ys.append(y[rsel]); ds.append(np.full(rsel.sum(), len(ds)))
                for a in arms:
                    ps[a].append(P[a][d][rsel])
            y = np.concatenate(ys); dd = np.concatenate(ds)
            p = {a: np.concatenate(ps[a]) for a in arms}
            blk_of_row = np.array([block_of(dates[i]) for i in dd]) if len(dd) else np.array([])
            nd = len(dates)
            res = {"dates": nd, "rows": int(len(y)), "event_rows": int(y.sum()),
                   "report_days": int(len(np.unique(dd[y == 1]))), "base_rate": float(y.mean()) if len(y) else None, "arms": {}}
            if len(y) == 0 or y.sum() == 0:
                out.setdefault(scope, {})[region] = res
                continue
            # per-date sums for bootstrap
            def per_date(v):
                return np.bincount(dd, weights=v, minlength=nd)
            n_d = per_date(np.ones(len(y))); e_d = per_date(y)
            sse = {a: per_date((p[a] - y) ** 2) for a in arms}
            # deployable: training-selected thresholds (per block)
            hits_dep, fa_dep = {}, {}
            for a in arms:
                t = np.array([folds[b]["thresholds"][a] for b in blk_of_row])
                hits_dep[a] = per_date(((p[a] >= t) & (y == 1)).astype(float))
                fa_dep[a] = per_date(((p[a] >= t) & (y == 0)).astype(float))
            # diagnostic: held-out equal false-alarm area to the HRRR arm at FA_REF
            ref_fa = int(((p["hrrr"] >= FA_REF) & (y == 0)).sum())
            hits_eq = {}
            for a in arms:
                p0 = np.sort(p[a][y == 0])[::-1]
                t = float(p0[ref_fa]) if ref_fa < len(p0) else -1.0
                hits_eq[a] = (t, per_date(((p[a] > t) & (y == 1)).astype(float)), int((p0 > t).sum()))
            # diagnostic: held-out equal false-alarm area to the HRRR + 12Z RRFS blend at its training-set threshold
            hits_eqb = {}
            if BLEND_REF in arms:
                ref_b = int(fa_dep[BLEND_REF].sum())
                for a in arms:
                    p0 = np.sort(p[a][y == 0])[::-1]
                    t = float(p0[ref_b]) if ref_b < len(p0) else -1.0
                    hits_eqb[a] = (t, per_date(((p[a] > t) & (y == 1)).astype(float)), int((p0 > t).sum()), ref_b)
            clim = folds_base(folds, blks)
            for a in arms:
                bs = sse[a].sum() / n_d.sum()
                rel = []
                for lo, hi in zip(BINS[:-1], BINS[1:]):
                    m = (p[a] >= lo) & (p[a] < hi)
                    if m.any():
                        rel.append({"bin": [lo, hi], "rows": int(m.sum()), "mean_forecast": float(p[a][m].mean()), "observed": float(y[m].mean())})
                res["arms"][a] = {
                    "brier": float(bs), "bss_vs_training_climatology": float(1 - bs / np.mean((clim - y) ** 2)),
                    "forecast_to_observed_ratio": float(p[a].sum() / y.sum()), "reliability": rel,
                    "deployable": {"hits": int(hits_dep[a].sum()), "hit_fraction": float(hits_dep[a].sum() / y.sum()),
                                   "false_alarm_points": int(fa_dep[a].sum()),
                                   "false_alarm_km2_per_day": float(fa_dep[a].sum() * SAMPLE_KM2 / nd)},
                    "fixed_5pct": {"hit_fraction": float(((p[a] >= 0.05) & (y == 1)).sum() / y.sum()),
                                   "false_alarm_km2_per_day": float(((p[a] >= 0.05) & (y == 0)).sum() * SAMPLE_KM2 / nd)},
                    "diagnostic_equal_area_vs_blend": ({"threshold": hits_eqb[a][0], "hits": int(hits_eqb[a][1].sum()),
                                                        "hit_fraction": float(hits_eqb[a][1].sum() / y.sum()), "false_alarm_points": hits_eqb[a][2],
                                                        "reference_false_alarm_points": hits_eqb[a][3],
                                                        "false_alarm_km2_per_day": float(hits_eqb[a][2] * SAMPLE_KM2 / nd)} if hits_eqb else None),
                    "diagnostic_equal_area": {"threshold": hits_eq[a][0], "hits": int(hits_eq[a][1].sum()),
                                              "hit_fraction": float(hits_eq[a][1].sum() / y.sum()), "false_alarm_points": hits_eq[a][2],
                                              "reference_false_alarm_points": ref_fa}}
            idx = rng.integers(0, nd, size=(BOOT, nd))
            diffs = {}
            for a, b in pairs:
                def ci(num_a, num_b, den):
                    pt = (num_a.sum() - num_b.sum()) / den.sum()
                    bt = (num_a[idx].sum(1) - num_b[idx].sum(1)) / den[idx].sum(1)
                    return {"estimate": float(pt), "ci95": [float(np.percentile(bt, 2.5)), float(np.percentile(bt, 97.5))]}
                diffs[f"{a}_minus_{b}"] = {
                    "brier": ci(sse[a], sse[b], n_d),
                    "deployable_hit_fraction": ci(hits_dep[a], hits_dep[b], e_d),
                    "deployable_false_alarm_km2_per_day": {"estimate": float((fa_dep[a].sum() - fa_dep[b].sum()) * SAMPLE_KM2 / nd)},
                    "diagnostic_equal_area_hit_fraction": ci(hits_eq[a][1], hits_eq[b][1], e_d),
                    "diagnostic_equal_area_vs_blend_hit_fraction": (ci(hits_eqb[a][1], hits_eqb[b][1], e_d) if hits_eqb else None)}
            res["paired"] = diffs
            out.setdefault(scope, {})[region] = res
    return out


def folds_base(folds, blks):
    return float(np.mean([folds[b]["train_base_rate"] for b in blks]))


def score(a):
    from conus_calibration import REGIONS
    man, D = load_cache(a.cache, cyc=a.cycle, dates=None)
    names = man["hrrr_feature_names"]
    log_lines = []
    def log(s):
        print(s, flush=True); log_lines.append(s)
    if a.experiment == "ablation":
        arms, pairs = ABL_ARMS, ABL_PAIRS
    elif a.experiment == "flcal":
        arms, pairs = FLCAL_ARMS, FLCAL_PAIRS
    elif a.experiment == "tree":
        global FIXED_RADIUS
        FIXED_RADIUS = 100
        arms, pairs = TREE_ARMS, TREE_PAIRS
    elif a.experiment == "smooth":
        arms, pairs = SMOOTH_ARMS, SMOOTH_PAIRS
    elif a.experiment == "twocycle":
        if a.cycle != 6:
            raise SystemExit("twocycle needs --cycle 6 (loads the matched 12Z + 06Z roster)")
        arms, pairs = TWO_ARMS, TWO_PAIRS
    else:
        arms, pairs = (("hrrr", "rrfs", "hrrr_rrfs"), PAIRS) if a.cycle == 12 else (("hrrr", "hrrr_rrfs", "hrrr_rrfs06"), PAIRS06)
    P, folds, reg_all, pos = run_comparison(D, names, arms, log)
    check = None
    if a.expect_fingerprints:
        # verify the unchanged arms against a pinned reference BEFORE anything is evaluated
        refs = a.expect_fingerprints if isinstance(a.expect_fingerprints, list) else [a.expect_fingerprints]
        check = {"reference": refs, "predictions_match": True, "coefficients_match": True, "predictions": {}, "checked": []}
        for rf in refs:
            ref = json.loads(Path(rf).read_text())["fingerprints"]
            base = [arm for arm in ("hrrr", "hrrr_rrfs", "hrrr_rrfs_smooth") if arm in arms and arm in ref["predictions"]]
            if rf != refs[0]:
                base = [arm for arm in base if arm not in ("hrrr", "hrrr_rrfs")]
            for arm in base:
                got = sha(np.concatenate([P[arm][d] for d in sorted(P[arm])]).tobytes())
                check["predictions"][arm] = got
                check["predictions_match"] &= got == ref["predictions"][arm]
                check["checked"].append(f"{arm} predictions vs {rf}")
            fitted_arms = [arm for arm in base if arm in ("hrrr", "hrrr_rrfs")]
            got_c = {k: v for k, v in FINGERPRINTS["coefficients"].items() if k.split("/")[1] in fitted_arms}
            ref_c = {k: v for k, v in ref["coefficients"].items() if k.split("/")[1] in fitted_arms}
            check["coefficients_match"] &= got_c == ref_c
        log(f"fingerprint check vs {a.expect_fingerprints}: predictions {check['predictions_match']}, coefficients {check['coefficients_match']}")
        if not (check["predictions_match"] and check["coefficients_match"]):
            Path(a.output).mkdir(parents=True, exist_ok=True)
            (Path(a.output) / "fingerprint-mismatch.json").write_text(json.dumps(check, indent=1) + "\n")
            raise SystemExit("Unchanged arms do not reproduce the pinned fingerprints; adjustment not evaluated")
    if a.save_predictions:
        # held-out predictions per date (written only after the fingerprint gate above has passed)
        ds = sorted(D)
        offs = np.cumsum([0] + [len(D[d][2]) for d in ds])
        Path(a.save_predictions).parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(a.save_predictions, dates=np.array(ds), offsets=offs,
                            row_index=np.concatenate([D[d][3] for d in ds]).astype(np.int32),
                            labels=np.concatenate([D[d][2] for d in ds]).astype(np.uint8),
                            **{arm: np.concatenate([P[arm][d] for d in ds]) for arm in arms})
        Path(a.save_predictions).with_suffix(".thresholds.json").write_text(
            json.dumps({b: f["thresholds"] for b, f in folds.items()}, indent=1) + "\n")
        Path(a.save_predictions).with_suffix(".fingerprint-check.json").write_text(json.dumps(check, indent=1) + "\n")
    res = summarize(D, P, folds, reg_all, pos, arms, list(REGIONS), pairs)
    dropped = [r for r in man["dates"] if r["status"] != "ok"]
    if a.cycle == 6:
        dropped += [{"date": r["date"], "status": "dropped", "reason": f"06Z {r['rrfs']['06z']}"} for r in man["dates"] if r["status"] == "ok" and r["rrfs"]["06z"] != "ok"]
    out = {"rules": "research/severe/conus-v1/rrfs/retro/" + ("TREE.md" if a.experiment == "tree" else "SMOOTHING.md" if a.experiment == "smooth" else "TWO-CYCLE.md" if a.experiment == "twocycle" else "FL-RECAL.md" if a.experiment == "flcal" else "ABLATION.md" if a.experiment == "ablation" else "RULES.md" if a.cycle == 12 else "FOLLOWUP-06Z.md"),
           "experiment": a.experiment, "groups": GROUPS if a.experiment == "ablation" else None, "rrfs_cycle": f"{a.cycle:02d}z", "arms": list(arms),
           "recipe": {"model": "sklearn LogisticRegression (L2, lbfgs)", "C": C_REG, "scaling": "asinh(x / training median |x|) per source, then StandardScaler, fit on training blocks only",
                      "hrrr_predictors": "phase2_study.engineer on the cached HRRR raw predictors", "rrfs_predictors": "27 per cycle = 9 fields x (nbhdmax24, nbhdmax18, mean24)"},
           "folds": {b: {k: v for k, v in f.items()} for b, f in folds.items()}, "dropped_dates": dropped,
           "scored_dates": len(D), "results": res, "log": log_lines,
           "fingerprints": {"predictions": {arm: sha(np.concatenate([P[arm][d] for d in sorted(P[arm])]).tobytes()) for arm in arms},
                            "coefficients": FINGERPRINTS.get("coefficients", {})},
           "run_environment": run_environment(), "fingerprint_check": check,
           "florida_gulf_adjustment": CALIBRATIONS or None, "smoothing": SMOOTHING or None, "tree": TREES or None}
    Path(a.output).mkdir(parents=True, exist_ok=True)
    (Path(a.output) / "scorecard.json").write_text(json.dumps(out, indent=1) + "\n")
    (Path(a.output) / "scorecard.md").write_text(render(out) + "\n")
    print(render(out))


def pct(x):
    return f"{100 * x:.1f}%"


def render(o):
    R = o["results"]
    L = [f"# Retrospective RRFS pilot scorecard ({o['rrfs_cycle']} RRFS, Day 2 damaging wind)", "",
         f"Scored dates: {o['scored_dates']}; dropped: {len(o['dropped_dates'])}. Rules: `{o['rules']}`.", ""]
    if o.get("experiment") == "twocycle":
        L += ["## Two-cycle blend minus HRRR + 12Z RRFS (hit change in points of report coverage, 95% whole-date intervals)", "",
              "| Scope | Region | Report days | Hits, equal area vs blend (diagnostic) | Hits, training-set threshold | False-alarm km²/day, training threshold (blend → two-cycle) | Brier |",
              "|---|---|---|---|---|---|---|"]
        for scope in ["all_blocks"] + [b for b in BLOCKS if b in R]:
            for region in ("national", FL):
                r = R[scope][region]
                if "paired" not in r:
                    continue
                v = r["paired"]["hrrr_rrfs_2cyc_minus_hrrr_rrfs"]
                e, h, b = v["diagnostic_equal_area_vs_blend_hit_fraction"], v["deployable_hit_fraction"], v["brier"]
                fb, f2 = r["arms"]["hrrr_rrfs"]["deployable"]["false_alarm_km2_per_day"], r["arms"]["hrrr_rrfs_2cyc"]["deployable"]["false_alarm_km2_per_day"]
                L.append(f"| {scope} | {region} | {r['report_days']} | {100*e['estimate']:+.1f} [{100*e['ci95'][0]:+.1f}, {100*e['ci95'][1]:+.1f}] | "
                         f"{100*h['estimate']:+.1f} [{100*h['ci95'][0]:+.1f}, {100*h['ci95'][1]:+.1f}] | {fb:,.0f} → {f2:,.0f} | "
                         f"{b['estimate']:+.6f} [{b['ci95'][0]:+.6f}, {b['ci95'][1]:+.6f}] |")
        L.append("")
    if o.get("experiment") == "ablation":
        L += ["## Cost of dropping each group (drop-one minus full HRRR + RRFS; positive Brier / negative hits = the group helps)", "",
              "| Scope | Region | Group | Brier | Hits, training threshold (pts) | Hits, equal area, diagnostic (pts) | Fcst/obs |", "|---|---|---|---|---|---|---|"]
        for scope in ["all_blocks"] + [b for b in BLOCKS if b in R]:
            for region in ("national", FL):
                r = R[scope][region]
                if "paired" not in r:
                    continue
                for g in o["groups"]:
                    v = r["paired"][f"hrrr_rrfs_no_{g}_minus_hrrr_rrfs"]
                    b, h, e = v["brier"], v["deployable_hit_fraction"], v["diagnostic_equal_area_hit_fraction"]
                    L.append(f"| {scope} | {region} | {g} | {b['estimate']:+.6f} [{b['ci95'][0]:+.6f}, {b['ci95'][1]:+.6f}] | "
                             f"{100*h['estimate']:+.1f} [{100*h['ci95'][0]:+.1f}, {100*h['ci95'][1]:+.1f}] | "
                             f"{100*e['estimate']:+.1f} [{100*e['ci95'][0]:+.1f}, {100*e['ci95'][1]:+.1f}] | "
                             f"{r['arms'][f'hrrr_rrfs_no_{g}']['forecast_to_observed_ratio']:.2f} (full {r['arms']['hrrr_rrfs']['forecast_to_observed_ratio']:.2f}) |")
        L.append("")
    for scope in ["all_blocks"] + [b for b in BLOCKS if b in R]:
        for region in ("national", FL):
            r = R[scope][region]
            L.append(f"## {scope} / {region}: {r['dates']} dates, {r['report_days']} report days, {r['event_rows']} event points")
            if "paired" not in r:
                L += ["Unscorable (no events).", ""]
                continue
            L.append("| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |")
            L.append("|---|---|---|---|---|---|---|")
            for a, m in r["arms"].items():
                L.append(f"| {a} | {m['brier']:.5f} | {m['bss_vs_training_climatology']:.3f} | {m['forecast_to_observed_ratio']:.2f} | "
                         f"{pct(m['deployable']['hit_fraction'])} | {m['deployable']['false_alarm_km2_per_day']:,.0f} | {pct(m['diagnostic_equal_area']['hit_fraction'])} |")
            L.append("")
            for k, v in r["paired"].items():
                b = v["brier"]; h = v["deployable_hit_fraction"]; e = v["diagnostic_equal_area_hit_fraction"]
                L.append(f"- {k}: Brier {b['estimate']:+.6f} [{b['ci95'][0]:+.6f}, {b['ci95'][1]:+.6f}]; hits (training threshold) "
                         f"{100*h['estimate']:+.1f} pts [{100*h['ci95'][0]:+.1f}, {100*h['ci95'][1]:+.1f}]; equal-area hits {100*e['estimate']:+.1f} pts "
                         f"[{100*e['ci95'][0]:+.1f}, {100*e['ci95'][1]:+.1f}]")
            L.append("")
    return "\n".join(L)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cache")
    c.add_argument("--roster", required=True)
    c.add_argument("--hrrr", nargs="+", required=True)
    c.add_argument("--rrfs", required=True)
    c.add_argument("--output", required=True)
    s = sub.add_parser("score")
    s.add_argument("--cache", required=True)
    s.add_argument("--cycle", type=int, default=12, choices=[12, 6])
    s.add_argument("--experiment", default="first", choices=["first", "ablation", "flcal", "twocycle", "smooth", "tree"])
    s.add_argument("--save-predictions", help="write held-out predictions (npz) after the fingerprint gate")
    s.add_argument("--expect-fingerprints", nargs="+", help="scorecard whose hrrr / hrrr_rrfs fingerprints must be reproduced first")
    s.add_argument("--output", required=True)
    a = p.parse_args()
    {"cache": cache, "score": score}[a.cmd](a)


if __name__ == "__main__":
    main()
