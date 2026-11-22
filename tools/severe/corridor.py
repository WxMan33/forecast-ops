#!/usr/bin/env python3
"""Day 1 tornado corridor experiment (rules: research/severe/corridor/rules.json, locked before fitting).

  gate      nested month-held-out comparison of arms a (v0.7 recipe refit, Platt), b (a + isotonic
            recalibration only) and c (v0.7 inputs + 20 wider 50/100-mile features + isotonic) on the
            96 2022-23 development dates; pass/fail against the locked criteria (c vs b); then refits
            b and c on all 96 dates for the 2024 diagnostic (and freezing, if c passed).
  diag2024  applies the all-96 fits of b and c to the 323 NadoCast benchmark days (diagnostic only).

Research only. 2021 is not loaded here; 2025 is refused.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.special import expit

import nadocast_benchmark as B
import nadocast_diagnose as D
import phase2_study as S
from conus_followup import SAMPLE_KM2
from conus_study import BOX, geography, load
from extract import digest
from train_daily import fit_logistic

RULES = Path("research/severe/corridor/rules.json")
PENALTIES = (1e-4, 1e-3, 1e-2, 1e-1)
SEED = 20261124
EXPECTED_DEV = 96
FIELDS = ("x_uh25_max", "x_srh01_max", "x_shear06_max", "x_sbcape_max", "x_reflectivity_max")
ASINH = ("x_uh25_max", "x_srh01_max", "x_sbcape_max")
RADII_KM = (80.4672, 160.9344)
REL_BINS = ((0.02, 0.05), (0.05, 0.10), (0.10, 0.15), (0.15, 0.30), (0.30, 1.01))


# ---------------------------------------------------------------- wider features
def neighbourhoods(coords, target):
    tree = cKDTree(B.unit(coords[:, 0], coords[:, 1]))
    out = []
    for r in RADII_KM:
        chord = 2 * np.sin(r / 2 / B.EARTH_KM)
        lists = tree.query_ball_point(B.unit(coords[target, 0], coords[target, 1]), chord)
        sizes = np.array([len(x) for x in lists])
        out.append((np.r_[0, np.cumsum(sizes)], np.concatenate([np.sort(x) for x in lists]).astype(np.int64), sizes))
    return out


def wider(x_full, names, nb):
    """x_full: (n_grid, 34) one date's features on the whole CONUS grid -> (n_target, 20)."""
    cols = []
    for f in FIELDS:
        v = x_full[:, names.index(f)].astype(np.float64)
        for indptr, idx, sizes in nb:
            vals = v[idx]
            mean = np.add.reduceat(vals, indptr[:-1]) / sizes
            mx = np.maximum.reduceat(vals, indptr[:-1])
            for s in (mean, mx):
                cols.append(np.arcsinh(s) if f in ASINH else s)
    return np.column_stack(cols)


def wide_names():
    return [f"{f}_{int(round(r / 1.609344))}mi_{s}" for f in FIELDS for r in RADII_KM for s in ("mean", "max")]


# ---------------------------------------------------------------- model pieces
class Arm:
    def __init__(self, cal):
        self.cal = cal

    def fit(self, x, y, groups):
        """Penalty by inner held-out log loss over `groups`; calibration on inner out-of-fold logits."""
        search = {}
        for pen in PENALTIES:
            oof = np.empty(len(y))
            for g in np.unique(groups):
                h = groups == g
                z = S.Standard(x[~h])
                w = fit_logistic(z(x[~h]), y[~h], pen)
                oof[h] = w[0] + z(x[h]) @ w[1:]
            search[pen] = (S.mean_log_loss(y, oof), oof)
        self.penalty = min(search, key=lambda p: search[p][0])
        oof = search[self.penalty][1]
        self.z = S.Standard(x)
        self.w = fit_logistic(self.z(x), y, self.penalty)
        if self.cal == "platt":
            self.c = fit_logistic(oof[:, None], y, penalty=0.0001, monotone=True)
        elif self.cal == "beta":
            self.c = fit_beta(oof, y)
        else:
            from sklearn.isotonic import IsotonicRegression
            iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(oof, y)
            self.c = (iso.X_thresholds_.astype(float), iso.y_thresholds_.astype(float))
        self.oof_raw = oof
        self.oof_p = self.calibrate(oof)
        self.loss = {str(k): v[0] for k, v in search.items()}
        return self

    def calibrate(self, logit):
        if self.cal == "platt":
            return expit(self.c[0] + self.c[1] * logit)
        if self.cal == "beta":
            return expit(self.c[0] + beta_design(logit) @ self.c[1:])
        return np.interp(logit, self.c[0], self.c[1])

    def predict(self, x):
        return self.calibrate(self.w[0] + self.z(x) @ self.w[1:])

    def to_dict(self):
        return {"calibration": self.cal, "penalty": self.penalty, "mean": self.z.mean.tolist(),
                "scale": self.z.scale.tolist(), "w": self.w.tolist(),
                "c": [np.asarray(v).tolist() for v in self.c] if self.cal == "isotonic" else np.asarray(self.c).tolist()}

    def raw(self, x):
        """Uncalibrated logistic score (for before/after-calibration comparisons)."""
        return expit(self.w[0] + self.z(x) @ self.w[1:])

    @classmethod
    def from_dict(cls, d):
        a = cls(d["calibration"])
        a.penalty = d["penalty"]
        a.z = S.Standard(np.zeros((2, len(d["mean"]))))
        a.z.mean, a.z.scale = np.array(d["mean"]), np.array(d["scale"])
        a.w = np.array(d["w"])
        a.c = tuple(np.array(v) for v in d["c"]) if d["calibration"] == "isotonic" else np.array(d["c"])
        return a


def beta_design(logit):
    """Beta-calibration inputs [ln p, -ln(1-p)] from a logit, computed stably."""
    return np.column_stack((-np.logaddexp(0, -logit), np.logaddexp(0, logit)))


def fit_beta(logit, y, penalty=1e-4):
    """Beta calibration (v2 rules): logistic on [ln p, -ln(1-p)], both slopes >= 0, intercept free."""
    from scipy.optimize import minimize
    F = beta_design(logit)
    rate = y.mean()

    def obj(b):
        t = b[0] + F @ b[1:]
        r = expit(t) - y
        return (np.mean(np.logaddexp(0, t) - y * t) + penalty * (b[1:] @ b[1:]) / 2,
                np.r_[r.mean(), F.T @ r / len(y) + penalty * b[1:]])
    res = minimize(obj, np.array([np.log(rate / (1 - rate)), 1.0, 0.0]), jac=True, method="L-BFGS-B",
                   bounds=[(None, None), (0, None), (0, None)], options={"maxiter": 600, "ftol": 1e-13, "gtol": 1e-8})
    if not np.isfinite(res.x).all():
        raise RuntimeError("beta calibration failed")
    return res.x


def recalibrated(ab, y, cal="isotonic"):
    """Arm b: arm a's fitted logistic, recalibrated on arm a's inner out-of-fold logits (isotonic in v1, beta in v2)."""
    bb = Arm(cal)
    bb.penalty, bb.z, bb.w, bb.loss, bb.oof_raw = ab.penalty, ab.z, ab.w, ab.loss, ab.oof_raw
    if cal == "beta":
        bb.c = fit_beta(ab.oof_raw, y)
    else:
        from sklearn.isotonic import IsotonicRegression
        iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(ab.oof_raw, y)
        bb.c = (iso.X_thresholds_.astype(float), iso.y_thresholds_.astype(float))
    bb.oof_p = bb.calibrate(ab.oof_raw)
    return bb


# ---------------------------------------------------------------- data
def dev_rows(root):
    cases, X, Y, coords, names, hashes = load(root)
    dev = [i for i, c in enumerate(cases) if c.startswith(("2022", "2023"))]
    if len(dev) != EXPECTED_DEV or any(c.startswith("2025") for c in cases):
        raise ValueError(f"expected the 96 2022-23 development dates, found {len(dev)}")
    sup, _ = geography(coords)
    lon, lat = coords[:, 0], coords[:, 1]
    tgt = np.where(sup & (lon >= BOX[0]) & (lon <= BOX[1]) & (lat >= BOX[2]) & (lat <= BOX[3]))[0]
    nb = neighbourhoods(coords, tgt)
    xb, xw, ys, ds, pts = [], [], [], [], []
    for j, i in enumerate(dev):
        lab = Y[i, 0][tgt, 0]
        k = lab != 255
        xb.append(X[i, 0][tgt][k].astype(np.float64))
        xw.append(wider(X[i, 0], names, nb)[k])
        ys.append(lab[k].astype(float))
        ds.append(np.full(int(k.sum()), j))
        pts.append(np.where(k)[0])
    info = {"targets": int(len(tgt)), "neighbourhood_sizes": {f"{int(round(r / 1.609344))}mi":
            {"min": int(s.min()), "median": float(np.median(s)), "share_lt_80pct_of_full":
             float((s < 0.8 * np.pi * r * r / SAMPLE_KM2).mean())} for r, (_, _, s) in zip(RADII_KM, nb)},
            "artifact_sha256_by_case": {cases[i]: hashes[cases[i]] for i in dev}}
    return ([cases[i] for i in dev], np.vstack(xb), np.vstack(xw), np.concatenate(ys), np.concatenate(ds),
            np.concatenate(pts), coords[tgt], names, info)


# ---------------------------------------------------------------- evaluation
def reliability(p, y):
    out = []
    for lo, hi in REL_BINS:
        s = (p >= lo) & (p < hi)
        ev = int(y[s].sum())
        mf, ob = (float(p[s].mean()), float(y[s].mean())) if s.any() else (None, None)
        out.append({"bin": [lo, hi], "n": int(s.sum()), "report_points": ev, "mean_forecast": mf, "observed": ob,
                    "within_30pct": None if ev < 20 else bool(abs(mf - ob) <= 0.30 * ob)})
    return out


def compare(P, y, d, xyz, nd, rng):
    """P: {'a','b','c'} held-out probabilities. Locked c-vs-b criteria plus reported extras."""
    D.DRAWS = 5000
    n_by = np.bincount(d, minlength=nd).astype(float)
    se = {k: np.bincount(d, weights=(p - y) ** 2, minlength=nd) for k, p in P.items()}
    from sklearn.metrics import roc_auc_score
    summary = {k: {"brier": float(se[k].sum() / n_by.sum()), "roc_auc": float(roc_auc_score(y, p)),
                   "mean_forecast": float(p.mean()), "reliability": reliability(p, y),
                   "thresholds": {f"{t:.0%}": {"hits": int(((y == 1) & (p >= t)).sum()),
                                                "false_alarm_km2_per_day": float(((y == 0) & (p >= t)).sum() * SAMPLE_KM2 / nd)}
                                  for t in (0.02, 0.05)}} for k, p in P.items()}
    fa_b = int(((y == 0) & (P["b"] >= 0.05)).sum())
    flags = {"b": P["b"] >= 0.05}
    thr = {"b": 0.05}
    for k in ("a", "c"):
        thr[k] = D.thresholds_for_count(P[k][y == 0], fa_b)
        flags[k] = P[k] > thr[k]
    classes = {k: D.miss_classes(xyz, y, d, flags[k], nd)[0] for k in P}
    hits = {k: D.per_date((y == 1) & flags[k], d, nd) for k in P}
    matched = {k: {"threshold": thr[k], "false_alarm_km2_per_day": float(((y == 0) & flags[k]).sum() * SAMPLE_KM2 / nd),
                   **{c: int(classes[k][c].sum()) for c in ("hit", "left_out", "wrong_place", "no_signal")}} for k in P}
    hb, hc = hits["b"].sum(), hits["c"].sum()
    lb, lc = classes["b"]["left_out"].sum(), classes["c"]["left_out"].sum()
    crit = {
        "1_matched_area_hits": {"c": int(hc), "b": int(hb), "ratio": float(hc / hb), "c_minus_b_95": D.boot(hits["c"], hits["b"], rng),
                                "need": "ratio >= 1.10 and lower bound > 0"},
        "2_left_out": {"c": int(lc), "b": int(lb), "reduction": float(1 - lc / lb) if lb else None,
                       "b_minus_c_95": D.boot(classes["b"]["left_out"], classes["c"]["left_out"], rng),
                       "need": "reduction >= 0.25 and lower bound > 0"},
        "3_brier": {"c": summary["c"]["brier"], "b": summary["b"]["brier"], "c_minus_b": summary["c"]["brier"] - summary["b"]["brier"],
                    "c_minus_b_95": B.boot_diff(se["c"], se["b"], n_by, rng), "need": "upper bound < 0"},
        "4_no_regression": {k: {"c": int(classes["c"][k].sum()), "b": int(classes["b"][k].sum()),
                                "ratio": float(classes["c"][k].sum() / max(classes["b"][k].sum(), 1))}
                            for k in ("wrong_place", "no_signal")},
        "5_reliability": [r for r in summary["c"]["reliability"]],
    }
    c1 = crit["1_matched_area_hits"]
    c2 = crit["2_left_out"]
    passed = {"1_matched_area_hits": c1["ratio"] >= 1.10 and c1["c_minus_b_95"][0] > 0,
              "2_left_out": (c2["reduction"] or 0) >= 0.25 and c2["b_minus_c_95"][0] > 0,
              "3_brier": crit["3_brier"]["c_minus_b_95"][1] < 0,
              "4_no_regression": all(v["ratio"] <= 1.05 for v in crit["4_no_regression"].values()),
              "5_reliability": all(r["within_30pct"] is not False for r in crit["5_reliability"])}
    return {"arms": summary, "matched_false_alarm_area": {"reference": "arm b pooled held-out 5% false-alarm area",
                                                          "false_alarm_points": fa_b, "by_arm": matched},
            "criteria": crit, "criteria_pass": passed, "pass": all(passed.values()),
            "failed": [k for k, v in passed.items() if not v]}


# ---------------------------------------------------------------- stages
def gate(a):
    rules = json.loads(RULES.read_text())
    cases, xb, xw, y, d, pt, xy, names, info = dev_rows(a.conus)
    xc = np.hstack([xb, xw])
    fold = np.array([S.fold_of(c) for c in cases])[d]
    nd = len(cases)
    P = {k: np.full(len(y), np.nan) for k in ("a", "b", "c")}
    thr_live, per_fold = [], []
    for k in range(S.FOLDS):
        te, tr = fold == k, fold != k
        if not te.any():
            continue
        ab = Arm("platt").fit(xb[tr], y[tr], fold[tr])
        bb = recalibrated(ab, y[tr])  # arm a's logistic, isotonic on its inner out-of-fold logits
        cc = Arm("isotonic").fit(xc[tr], y[tr], fold[tr])
        P["a"][te], P["b"][te], P["c"][te] = ab.predict(xb[te]), bb.predict(xb[te]), cc.predict(xc[te])
        # live threshold proposals, inside the training months only
        fa_b_in = int(((y[tr] == 0) & (bb.oof_p >= 0.05)).sum())
        t_match = D.thresholds_for_count(cc.oof_p[y[tr] == 0], fa_b_in)
        thr_live.append({"fold": k, "calibrated_5pct": 0.05, "c_threshold_matching_b_5pct_area_in_training": t_match})
        per_fold.append({"fold": k, "test_dates": int(len(np.unique(d[te]))), "penalty_ab": ab.penalty, "penalty_c": cc.penalty,
                         "inner_log_loss_ab": ab.loss, "inner_log_loss_c": cc.loss})
        print(f"outer fold {k} done (penalties {ab.penalty} / {cc.penalty})", flush=True)
    rng = np.random.default_rng(SEED)
    xyz = B.unit(xy[pt, 0], xy[pt, 1])
    res = {"rules": str(RULES), "dates": nd, "points": int(len(y)), "report_points": int(y.sum()),
           "report_days": int(len(np.unique(d[y == 1]))), "wider_features": wide_names(), "data": info,
           "per_fold": per_fold, "protected_2025_outcomes_accessed": False, "verification_2021_loaded": False}
    res.update(compare(P, y, d, xyz, nd, rng))
    # proposed live thresholds evaluated on held-out months
    live = {}
    t5 = P["c"] >= 0.05
    live["calibrated_5pct"] = {"hits": int((t5 & (y == 1)).sum()), "false_alarm_km2_per_day": float((t5 & (y == 0)).sum() * SAMPLE_KM2 / nd)}
    tm = np.empty(len(y))
    for r in thr_live:
        tm[fold == r["fold"]] = r["c_threshold_matching_b_5pct_area_in_training"]
    fm = P["c"] > tm
    live["matched_area_threshold_from_training_folds"] = {"thresholds_by_fold": [r["c_threshold_matching_b_5pct_area_in_training"] for r in thr_live],
                                                          "hits": int((fm & (y == 1)).sum()),
                                                          "false_alarm_km2_per_day": float((fm & (y == 0)).sum() * SAMPLE_KM2 / nd)}
    res["live_threshold_proposals_heldout"] = live
    # refit b and c on all 96 dates (2024 diagnostic; frozen candidate if c passed)
    allg = np.array([S.fold_of(c) for c in cases])[d]
    fa = Arm("platt").fit(xb, y, allg)
    fb = recalibrated(fa, y)
    fc = Arm("isotonic").fit(xc, y, allg)
    fits = {"b": fb.to_dict(), "c": fc.to_dict(), "a": fa.to_dict(), "base_features": names, "wider_features": wide_names(),
            "fit_dates": cases, "rules_sha256": digest(RULES)}
    a.output.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(fits).encode()
    (a.output / "fits-all96.json").write_bytes(blob)
    res["fits_all96_sha256"] = hashlib.sha256(blob).hexdigest()
    res["frozen_candidate"] = res["pass"]
    (a.output / "gate.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    np.savez_compressed(a.output / "gate-arrays.npz", y=y, d=d, pt=pt, xy=xy, dates=np.array(cases), **{f"p_{k}": v for k, v in P.items()})
    maps_dev(a.output, cases, xy, y, d, pt, P, res)
    (a.output / "gate.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    print(json.dumps({"pass": res["pass"], "failed": res["failed"],
                      "criteria": {k: {kk: vv for kk, vv in v.items() if kk != "need"} if isinstance(v, dict) else None
                                   for k, v in res["criteria"].items() if k != "5_reliability"}}, default=float))


def flag_panels(ax, xs, p, flag, lab, title, rings):
    from phase2_maps import CMAP, NORM, draw_states
    colors = {"hit": "#08306b", "left_out": "#e7298a", "wrong_place": "#ff7f00", "no_signal": "#000000"}
    ax.scatter(xs[:, 0], xs[:, 1], c=p, cmap=CMAP, norm=NORM, s=5, marker="s", lw=0)
    ax.scatter(xs[flag, 0], xs[flag, 1], s=7, marker="s", facecolors="none", edgecolors="#444444", lw=0.25)
    for k, c in colors.items():
        m = lab == k
        ax.scatter(xs[m, 0], xs[m, 1], s=7, c=c, marker="o", lw=0)
    draw_states(ax, rings)
    ax.set_xlim(-101, -74); ax.set_ylim(29, 46); ax.set_aspect(1 / np.cos(np.radians(37.5)))
    ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(title + f"\nhits {int((lab == 'hit').sum())}, left out {int((lab == 'left_out').sum())}, wrong place "
                 f"{int((lab == 'wrong_place').sum())}, no signal {int((lab == 'no_signal').sum())}", fontsize=8.5)
    return colors


def save_fig(fig, colors, path, title):
    from matplotlib.lines import Line2D
    import matplotlib.pyplot as plt
    fig.legend(handles=[Line2D([], [], marker="o", ls="", color=c, label=k.replace("_", " ")) for k, c in colors.items()] +
               [Line2D([], [], marker="s", ls="", mfc="none", mec="#444444", label="flagged (same false-alarm area)")],
               loc="lower center", ncol=5, fontsize=8.5, frameon=False)
    fig.suptitle(title, fontsize=10)
    fig.tight_layout(rect=(0, 0.05, 1, 0.93))
    fig.savefig(path, dpi=105)
    plt.close(fig)


def maps_dev(out, cases, xy, y, d, pt, P, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from phase2_maps import states
    rings = states()
    mb = res["matched_false_alarm_area"]["by_arm"]
    xyz = B.unit(xy[pt, 0], xy[pt, 1])
    nd = len(cases)
    flag = {"b": P["b"] >= 0.05, "c": P["c"] > mb["c"]["threshold"]}
    lab = {k: D.miss_classes(xyz, y, d, flag[k], nd)[1] for k in flag}
    rep = np.bincount(d[y == 1], minlength=nd)
    left_b = np.bincount(d[lab["b"] == "left_out"], minlength=nd)
    picks = {"most_reports": int(rep.argmax()), "most_left_out_arm_b": int(left_b.argmax())}
    res["map_cases"] = {k: cases[j] for k, j in picks.items()}
    for kind, j in picks.items():
        s = d == j
        fig, axes = plt.subplots(1, 2, figsize=(15, 6))
        for ax, k, t in zip(axes, ("b", "c"), ("Arm b: v0.7 refit + recalibration", "Arm c: + 50/100-mile corridor features")):
            colors = flag_panels(ax, xy[pt[s]], P[k][s], flag[k][s], lab[k][s], f"{t} (held-out month)", rings)
        save_fig(fig, colors, out / f"corridor-dev-{kind}-{cases[j]}.png",
                 f"Day 1 tornado, development day {cases[j]} ({kind.replace('_', ' ')}), held-out predictions; both arms flagged "
                 "at the same false-alarm area (arm b 5%). Research only.")


def diag2024(a):
    fits = json.loads(Path(a.fits).read_text())
    arr = np.load(a.arrays, allow_pickle=False)
    y, d, pt, xy = arr["y"], arr["d"], arr["pt"], arr["coords"]
    dates = [str(x) for x in arr["dates"]]
    if any(not x.startswith("2024") for x in dates):
        raise ValueError("2024 diagnostic only")
    pn = arr["p_nadocast"]
    coords = names = nb = tgt = None
    P = {"b": np.empty(len(y)), "c": np.empty(len(y))}
    fb, fc = Arm.from_dict(fits["b"]), Arm.from_dict(fits["c"])
    for j, case in enumerate(dates):
        meta = json.loads((Path(a.conus) / case / "conus-case.json").read_text())
        path = Path(a.conus) / case / meta["artifact"]["file"]
        if digest(path) != meta["artifact"]["sha256"]:
            raise ValueError(f"{case}: hash mismatch")
        with np.load(path, allow_pickle=False) as z:
            if coords is None:
                coords, names = z["coordinates"], z["feature_names"].tolist()
                sup, _ = geography(coords)
                lon, lat = coords[:, 0], coords[:, 1]
                tgt = np.where(sup & (lon >= BOX[0]) & (lon <= BOX[1]) & (lat >= BOX[2]) & (lat <= BOX[3]))[0]
                if not np.array_equal(coords[tgt], xy):
                    raise ValueError("benchmark footprint differs from the corridor target set")
                nb = neighbourhoods(coords, tgt)
            x0 = z["features"][0]
        s = d == j
        xb = x0[tgt][pt[s]].astype(np.float64)
        xw = wider(x0, names, nb)[pt[s]]
        P["b"][s], P["c"][s] = fb.predict(xb), fc.predict(np.hstack([xb, xw]))
    nd = len(dates)
    xyz = B.unit(xy[pt, 0], xy[pt, 1])
    fa_n = int(((y == 0) & (pn >= 0.05)).sum())
    flags = {"nadocast": pn >= 0.05}
    out = {"status": "2024 diagnostic only (323 benchmark days); never deciding", "reference": "NadoCast 5% false-alarm area",
           "by_model": {}}
    for k in ("b", "c"):
        t = D.thresholds_for_count(P[k][y == 0], fa_n)
        flags[k] = P[k] > t
    allp = {**P, "nadocast": pn}
    for k, f in flags.items():
        cl = D.miss_classes(xyz, y, d, f, nd)[0]
        out["by_model"][k] = {"brier": float(np.mean((allp[k] - y) ** 2)), **{c: int(cl[c].sum()) for c in cl},
                              "false_alarm_km2_per_day": float(((y == 0) & f).sum() * SAMPLE_KM2 / nd)}
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "diag2024.json").write_text(json.dumps(out, indent=1) + "\n")
    if "2024-12-28" in dates:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from phase2_maps import states
        rings = states()
        j = dates.index("2024-12-28")
        s = d == j
        fig, axes = plt.subplots(1, 3, figsize=(21, 6))
        for ax, k, t in zip(axes, ("b", "c", "nadocast"), ("Arm b (refit + recalibration)", "Arm c (+ corridor features)",
                                                          "NadoCast (D-1 12Z, abs. calibrated)")):
            lab = D.miss_classes(xyz[s], y[s], np.zeros(int(s.sum()), int), flags[k][s], 1)[1]
            colors = flag_panels(ax, xy[pt[s]], allp[k][s], flags[k][s], lab, t, rings)
        save_fig(fig, colors, a.output / "corridor-2024-12-28.png",
                 "2024-12-28 (diagnostic): arms b and c fitted on all 96 development dates vs NadoCast, each flagged at NadoCast's "
                 "5% false-alarm area. Research only.")
    print(json.dumps(out))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gate")
    g.add_argument("--conus", type=Path, required=True)
    g.add_argument("--output", type=Path, required=True)
    q = sub.add_parser("diag2024")
    q.add_argument("--conus", type=Path, required=True)
    q.add_argument("--arrays", type=Path, required=True)
    q.add_argument("--fits", type=Path, required=True)
    q.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    {"gate": gate, "diag2024": diag2024}[a.cmd](a)


if __name__ == "__main__":
    main()
