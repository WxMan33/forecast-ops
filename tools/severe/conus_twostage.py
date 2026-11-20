#!/usr/bin/env python3
"""Day 2 wind two-stage regional experiment (criterion 8 of docs/severe-phase2-criteria.md).

  gate    nested development test for one candidate: whole months held out from BOTH stages
          (6 month-grouped outer folds over the 96 2022-23 dates). Stage 1 is refit on the
          training months with the frozen recipe; stage-2 inputs are out-of-fold stage-1
          predictions inside the training months; the complete model and its uncorrected
          counterpart are scored on the held-out months.
  freeze  final stage 2 on the full 96-date out-of-fold predictions of the frozen stage 1.
  verify  one-time check of frozen stage 1 + frozen stage 2 on the sealed 2021 dates.

Research only; original labels decide; 2025 refused; nothing touches the live feed.
"""
import argparse
import hashlib
import json
import pickle
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, logit

import phase2_study as S
from conus_calibration import FL, REGIONS, auc, check_frozen, oof_predictions, region_index
from conus_followup import SAMPLE_KM2, predict
from conus_study import load, regions
from protocol import future_window
from train_daily import fit_logistic

DAY, HAZ, PRODUCT = 2, 1, "day2_wind"
STAGE2_REGIONS = (FL, "west")
PREDICTORS = ("x_srh01_max", "x_srh01_nearby_max_max", "x_shear06_max", "x_sbcin_mean", "int_srh_shear",
              "x_sbcape_nearby_max_max")
PENALTIES = (1e-4, 1e-3, 1e-2, 1e-1)
BLEND_KM = 150.0
EPS = 1e-6


# ---------------------------------------------------------------- geometry
def signed_distance_km(coords):
    """Signed distance (km, positive inside) to the Florida/Gulf and West boundaries."""
    lon, lat = coords[:, 0], coords[:, 1]
    kx = 111.32 * np.cos(np.radians(lat))
    ky = 110.57
    # Florida/Gulf: lon >= -90 and lat < 30
    inside = (lon >= -90) & (lat < 30)
    d_in = np.minimum((30 - lat) * ky, (lon + 90) * kx)
    dx, dy = np.maximum(0, -90 - lon) * kx, np.maximum(0, lat - 30) * ky
    d_fl = np.where(inside, d_in, -np.hypot(dx, dy))
    # West: lon < -104
    d_w = (-104 - lon) * kx
    return {FL: d_fl, "west": d_w}


def blend_weights(coords):
    d = signed_distance_km(coords)
    return {r: np.clip(0.5 + d[r] / BLEND_KM, 0, 1) for r in STAGE2_REGIONS}


def feature_index(names):
    full = list(names) + ["int_cape_shear", "int_srh_shear", "int_uh_shear"]  # S.engineer column order
    return [full.index(f) for f in PREDICTORS]


# ---------------------------------------------------------------- stage 2
class Stage2:
    def __init__(self, beta=None, mu=None, sd=None, penalty=None):
        self.beta, self.mu, self.sd, self.penalty = beta, mu, sd, penalty

    def design(self, z, F, W):
        cols = []
        for i, r in enumerate(STAGE2_REGIONS):
            w = W[:, i]
            Fs = (F - self.mu[r]) / self.sd[r]
            cols += [w, w * z] + [w * Fs[:, j] for j in range(F.shape[1])]
        return np.column_stack(cols)

    def standardize_from(self, F, W):
        self.mu, self.sd = {}, {}
        for i, r in enumerate(STAGE2_REGIONS):
            s = W[:, i] > 0
            self.mu[r] = F[s].mean(axis=0) if s.any() else np.zeros(F.shape[1])
            sd = F[s].std(axis=0) if s.any() else np.ones(F.shape[1])
            self.sd[r] = np.where(sd > 0, sd, 1.0)

    @staticmethod
    def _fit(D, z, y, penalty):
        def obj(b):
            t = z + D @ b
            r = expit(t) - y
            return (np.mean(np.logaddexp(0, t) - y * t) + penalty * b @ b / 2,
                    D.T @ r / len(y) + penalty * b)
        res = minimize(obj, np.zeros(D.shape[1]), jac=True, method="L-BFGS-B",
                       options={"maxiter": 1000, "ftol": 1e-12, "gtol": 1e-8})
        if not np.isfinite(res.x).all():
            raise RuntimeError("Stage-2 fit failed")
        return res.x

    def fit(self, z, F, W, y, groups):
        active = (W > 0).any(axis=1)
        z, F, W, y, groups = z[active], F[active], W[active], y[active], groups[active]
        self.standardize_from(F, W)
        D = self.design(z, F, W)
        scores = {}
        for pen in PENALTIES:
            loss, n = 0.0, 0
            for g in np.unique(groups):
                h = groups == g
                b = self._fit(D[~h], z[~h], y[~h], pen)
                t = z[h] + D[h] @ b
                loss += np.sum(np.logaddexp(0, t) - y[h] * t)
                n += h.sum()
            scores[pen] = loss / n
        self.penalty = min(scores, key=scores.get)
        self.beta = self._fit(D, z, y, self.penalty)
        self.cv_loss = scores
        return self

    def logit(self, z, F, W):
        out = z.copy()
        active = (W > 0).any(axis=1)
        out[active] = z[active] + self.design(z[active], F[active], W[active]) @ self.beta
        return out

    def to_dict(self):
        return {"predictors": list(PREDICTORS), "regions": list(STAGE2_REGIONS), "blend_km": BLEND_KM,
                "penalty": self.penalty, "beta": self.beta.tolist(),
                "mu": {r: v.tolist() for r, v in self.mu.items()}, "sd": {r: v.tolist() for r, v in self.sd.items()}}

    @classmethod
    def from_dict(cls, d):
        return cls(np.array(d["beta"]), {r: np.array(v) for r, v in d["mu"].items()},
                   {r: np.array(v) for r, v in d["sd"].items()}, d["penalty"])


# ---------------------------------------------------------------- stage 1 refit (frozen recipe)
def stage1_logistic(x, y, folds, train, test):
    inner = [k for k in np.unique(folds[train])]
    search = {}
    for pen in PENALTIES:
        oof = np.empty(train.sum())
        ft = folds[train]
        xt, yt = x[train], y[train]
        for k in inner:
            h = ft == k
            z = S.Standard(xt[~h])
            w = fit_logistic(z(xt[~h]), yt[~h], pen)
            oof[h] = w[0] + z(xt[h]) @ w[1:]
        search[pen] = (S.mean_log_loss(yt, oof), oof)
    pen = min(search, key=lambda p: search[p][0])
    oof = search[pen][1]
    cal = fit_logistic(oof[:, None], y[train], penalty=0.0001, monotone=True)
    z = S.Standard(x[train])
    w = fit_logistic(z(x[train]), y[train], pen)
    raw_te = w[0] + z(x[test]) @ w[1:]
    return cal[0] + cal[1] * oof, cal[0] + cal[1] * raw_te, {"penalty": pen}


def stage1_trees(x, y, folds, train, test):
    from sklearn.ensemble import HistGradientBoostingClassifier
    g = folds[train] % 3
    xt, yt = x[train], y[train]
    oof = np.empty(train.sum())
    for k in np.unique(g):
        h = g == k
        oof[h] = HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(xt[~h], yt[~h]).decision_function(xt[h])
    cal = fit_logistic(oof[:, None], yt, penalty=0.0001, monotone=True)
    tree = HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(xt, yt)
    return cal[0] + cal[1] * oof, cal[0] + cal[1] * tree.decision_function(x[test]), {}


# ---------------------------------------------------------------- metrics (gate and verification)
def ratio_ci(num_by_date, den_by_date, rng, n=5000):
    k = len(num_by_date)
    draws = rng.integers(0, k, size=(n, k))
    num, den = num_by_date[draws].sum(1), den_by_date[draws].sum(1)
    r = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
    return [float(np.nanpercentile(r, 2.5)), float(np.nanpercentile(r, 97.5))]


def evaluate(y, p1, p2, d, reg_row, dates_n, climatology, rng):
    """y, p1 (uncorrected), p2 (two-stage), d (date index), reg_row (region index per row)."""
    out = {"hits": {}, "requirements": {}}

    def hits(mask, thr):
        h1 = np.bincount(d[mask & (y == 1) & (p1 >= thr)], minlength=dates_n).astype(float)
        h2 = np.bincount(d[mask & (y == 1) & (p2 >= thr)], minlength=dates_n).astype(float)
        ev = int((mask & (y == 1)).sum())
        r = float(h2.sum() / h1.sum()) if h1.sum() else None
        return {"event_points": ev, "uncorrected": int(h1.sum()), "two_stage": int(h2.sum()), "ratio": r,
                "ratio_95": ratio_ci(h2, h1, rng) if h1.sum() else None}
    allrows = np.ones(len(y), bool)
    scopes = {"national": allrows, FL: reg_row == REGIONS.index(FL), "west": reg_row == REGIONS.index("west")}
    for name, m in scopes.items():
        out["hits"][name] = {"ge_5pct": hits(m, 0.05), "ge_15pct": hits(m, 0.15)}
    fl = scopes[FL]
    rep = np.zeros(dates_n, bool)
    rep[np.unique(d[fl & (y == 1)])] = True
    a1 = np.bincount(d[fl & (p1 >= 0.05)], minlength=dates_n) * SAMPLE_KM2
    a2 = np.bincount(d[fl & (p2 >= 0.05)], minlength=dates_n) * SAMPLE_KM2
    present = np.zeros(dates_n, bool)
    present[np.unique(d[fl])] = True
    nr = present & ~rep
    out["florida_no_report_area"] = {"no_report_dates": int(nr.sum()), "report_dates": int((present & rep).sum()),
                                     "uncorrected_km2_per_day": float(a1[nr].mean()) if nr.any() else None,
                                     "two_stage_km2_per_day": float(a2[nr].mean()) if nr.any() else None,
                                     "ratio": float(a2[nr].sum() / a1[nr].sum()) if a1[nr].sum() else None,
                                     "ratio_95": ratio_ci(a2[nr], a1[nr], rng) if a1[nr].sum() else None}
    b = S.bootstrap(y, {"uncorrected": p1, "two_stage": p2}, d, climatology, "uncorrected", rng)
    out["national_brier"] = {"uncorrected": float(np.mean((p1 - y) ** 2)), "two_stage": float(np.mean((p2 - y) ** 2)),
                             "diff_95": b["models"]["two_stage"]["brier_minus_reference_95"]}
    obs = float(y[fl].mean()) if fl.any() else None
    out["florida_ratio"] = {"observed_rate": obs, "uncorrected": float(p1[fl].mean() / obs) if obs else None,
                            "two_stage": float(p2[fl].mean() / obs) if obs else None}
    h = out["hits"]
    req = {
        "fl_hits5_ratio_ge_0.90": (h[FL]["ge_5pct"]["ratio"] or 0) >= 0.90,
        "fl_hits5_lower_ge_0.75": bool(h[FL]["ge_5pct"]["ratio_95"] and h[FL]["ge_5pct"]["ratio_95"][0] >= 0.75),
        "west_hits5_ratio_ge_0.90": (h["west"]["ge_5pct"]["ratio"] or 0) >= 0.90,
        "west_hits5_lower_ge_0.75": bool(h["west"]["ge_5pct"]["ratio_95"] and h["west"]["ge_5pct"]["ratio_95"][0] >= 0.75),
        "national_hits5_ratio_ge_0.90": (h["national"]["ge_5pct"]["ratio"] or 0) >= 0.90,
        "national_hits5_lower_ge_0.90": bool(h["national"]["ge_5pct"]["ratio_95"] and h["national"]["ge_5pct"]["ratio_95"][0] >= 0.90),
        "national_hits15_ratio_ge_0.90": (h["national"]["ge_15pct"]["ratio"] or 0) >= 0.90,
        "fl_no_report_area_ratio_le_0.60": (out["florida_no_report_area"]["ratio"] if out["florida_no_report_area"]["ratio"] is not None else 9) <= 0.60,
        "national_brier_no_worse": out["national_brier"]["two_stage"] <= out["national_brier"]["uncorrected"],
    }
    out["requirements"] = {k: bool(v) for k, v in req.items()}
    out["pass"] = all(out["requirements"].values())
    out["failed"] = [k for k, v in out["requirements"].items() if not v]
    return out


def boundary_steps(coords_rows, p1, p2):
    """Mean probability in 25 km bins of signed distance across each stage-2 boundary; largest step."""
    d = signed_distance_km(coords_rows)
    edges = np.arange(-150, 151, 25)
    res = {}
    for r in STAGE2_REGIONS:
        prof = {}
        for name, p in (("uncorrected", p1), ("two_stage", p2)):
            means = []
            for lo, hi in zip(edges, edges[1:]):
                s = (d[r] >= lo) & (d[r] < hi)
                means.append(float(p[s].mean()) if s.any() else None)
            vals = [m for m in means if m is not None]
            prof[name] = {"bins_km": edges.tolist(), "mean_probability": means,
                          "largest_step": float(np.max(np.abs(np.diff(vals)))) if len(vals) > 1 else None}
        res[r] = prof
    return res


# ---------------------------------------------------------------- gate
def gate(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    cases, X, Y, coords, names, _ = load(a.conus)
    if any(not c.startswith(("2022", "2023")) for c in cases) or len(cases) != a.expected_fit_dates:
        raise ValueError("The gate uses exactly the 2022-23 development dates")
    keep = fitted["keep"]
    ck = coords[keep]
    e, _ = S.engineer(X[:, DAY - 1][:, keep], names, fitted["scales"][DAY])
    x, y, d, p = S.rows(e, Y[:, DAY - 1][:, keep], HAZ)
    folds = np.array([S.fold_of(c) for c in cases])[d]
    W = np.column_stack([blend_weights(ck)[r][p] for r in STAGE2_REGIONS])
    F = x[:, feature_index(names)]
    reg_row = region_index(None, regions(coords), keep)[p]
    stage1 = stage1_logistic if a.candidate == "conus_logistic" else stage1_trees
    z1 = np.empty(len(y))
    z2 = np.empty(len(y))
    per_fold = []
    for k in range(S.FOLDS):
        test, train = folds == k, folds != k
        if not test.any():
            continue
        z_tr_oof, z_te, info = stage1(x, y, folds, train, test)
        s2 = Stage2().fit(z_tr_oof, F[train], W[train], y[train], folds[train])
        z1[test] = z_te
        z2[test] = s2.logit(z_te, F[test], W[test])
        per_fold.append({"fold": k, "test_dates": int(len(np.unique(d[test]))), **info,
                         "stage2_penalty": s2.penalty, "stage2_cv_loss": {str(q): v for q, v in s2.cv_loss.items()}})
        print(f"{a.candidate}: outer fold {k} done", flush=True)
    p1, p2 = expit(z1), expit(z2)
    rng = np.random.default_rng(20261120)
    clim = float(y.mean())
    res = evaluate(y, p1, p2, d, reg_row, len(cases), clim, rng)
    res.update({"candidate": a.candidate, "frozen_models_sha256": sha, "dates": len(cases),
                "design": "6 month-grouped outer folds; whole months held out from both stages",
                "per_fold": per_fold, "boundary_steps": boundary_steps(ck[p], p1, p2),
                "rule": "docs/severe-phase2-criteria.md section 8", "protected_2025_outcomes_accessed": False,
                "verification_2021_loaded": False})
    a.output.mkdir(parents=True, exist_ok=True)
    if a.analyze:
        committed = json.loads(a.analyze.read_text())
        fnames = list(names) + ["int_cape_shear", "int_srh_shear", "int_uh_shear"]
        analyze(a.output, a.candidate, committed, y, p1, p2, d, p, reg_row, x, fnames, cases)
        return
    (a.output / f"gate-{a.candidate}.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    draw(a.output, f"gate-{a.candidate}", cases, ck, y, p1, p2, d, p, reg_row)
    print(json.dumps({"candidate": a.candidate, "pass": res["pass"], "failed": res["failed"]}))


# ---------------------------------------------------------------- trade-off and missed-setup analysis
def tradeoff_curve(y, pr, d, region_rows, dates_n, A0, H0, thresholds):
    """False-alarm area on the region's no-report days, and hits, at each threshold; both relative to
    the uncorrected model at 5% (A0, H0)."""
    rep = np.zeros(dates_n, bool)
    rep[np.unique(d[region_rows & (y == 1)])] = True
    present = np.zeros(dates_n, bool)
    present[np.unique(d[region_rows])] = True
    nr_rows = region_rows & ~rep[d]
    n_nr = int((present & ~rep).sum())
    out = []
    for t in thresholds:
        area = (nr_rows & (pr >= t)).sum() * SAMPLE_KM2 / max(n_nr, 1)
        hits = int((region_rows & (y == 1) & (pr >= t)).sum())
        out.append({"threshold": float(t), "area_km2_per_no_report_day": float(area),
                     "area_rel": float(area / A0) if A0 else None, "hits": hits, "hits_rel": float(hits / H0) if H0 else None})
    return out


def analyze(out_dir, tag, committed, y, p1, p2, d, p, reg_row, x, fnames, cases):
    res = {"candidate": tag, "status": "diagnostic_on_held_out_development_predictions"}
    # 1. the regenerated predictions must reproduce the committed gate
    regen = evaluate(y, p1, p2, d, reg_row, len(cases), float(y.mean()), np.random.default_rng(20261120))
    keys = [("hits", s, t, k) for s in ("national", FL, "west") for t in ("ge_5pct", "ge_15pct") for k in ("uncorrected", "two_stage")]
    diffs = [abs(regen["hits"][s][t][k] - committed["hits"][s][t][k]) for _, s, t, k in keys]
    diffs.append(abs(regen["national_brier"]["two_stage"] - committed["national_brier"]["two_stage"]) * 1e6)
    res["reproduces_committed_gate"] = bool(max(diffs) == 0 or max(diffs) < 1e-6)
    thresholds = np.unique(np.r_[np.geomspace(0.003, 0.5, 60), 0.05])
    res["regions"] = {}
    for r in (FL, "west"):
        rows = reg_row == REGIONS.index(r)
        rep = np.zeros(len(cases), bool)
        rep[np.unique(d[rows & (y == 1)])] = True
        nr = rows & ~rep[d]
        n_nr = max(int(len(set(d[rows].tolist())) - rep.sum()), 1)
        A0 = (nr & (p1 >= 0.05)).sum() * SAMPLE_KM2 / n_nr
        H0 = int((rows & (y == 1) & (p1 >= 0.05)).sum())
        curves = {"uncorrected": tradeoff_curve(y, p1, d, rows, len(cases), A0, H0, thresholds),
                  "two_stage": tradeoff_curve(y, p2, d, rows, len(cases), A0, H0, thresholds)}
        ok = lambda c: c["area_rel"] is not None and c["hits_rel"] is not None
        feas = {m: [c for c in cv if ok(c) and c["area_rel"] <= 0.60 and c["hits_rel"] >= 0.90]
                for m, cv in curves.items()}
        best_hits = {m: max((c["hits_rel"] for c in cv if ok(c) and c["area_rel"] <= 0.60), default=None)
                     for m, cv in curves.items()}
        best_area = {m: min((c["area_rel"] for c in cv if ok(c) and c["hits_rel"] >= 0.90), default=None)
                     for m, cv in curves.items()}
        # 2. missed setups: uncorrected hits the two-stage model dropped below 5%, versus false alarms
        hit1 = rows & (y == 1) & (p1 >= 0.05)
        missed, kept = hit1 & (p2 < 0.05), hit1 & (p2 >= 0.05)
        fa = nr & (p1 >= 0.05)
        feats = []
        for j, n in enumerate(fnames):
            col = x[:, j]
            feats.append({"predictor": n,
                          "auc_missed_vs_false_alarm": auc(np.r_[col[missed], col[fa]], np.r_[np.ones(missed.sum()), np.zeros(fa.sum())]),
                          "auc_kept_vs_false_alarm": auc(np.r_[col[kept], col[fa]], np.r_[np.ones(kept.sum()), np.zeros(fa.sum())]),
                          "auc_missed_vs_kept": auc(np.r_[col[missed], col[kept]], np.r_[np.ones(missed.sum()), np.zeros(kept.sum())])})
        sep = [f for f in feats if f["auc_missed_vs_false_alarm"] is not None]
        sep.sort(key=lambda f: -abs(f["auc_missed_vs_false_alarm"] - 0.5))
        by_date = {}
        for i in np.unique(d[missed]):
            by_date[cases[i]] = int((missed & (d == i)).sum())
        months = {}
        for c, n in by_date.items():
            months[c[5:7]] = months.get(c[5:7], 0) + n
        res["regions"][r] = {
            "uncorrected_at_5pct": {"area_km2_per_no_report_day": float(A0), "hits": H0},
            "feasible_points": {m: len(v) for m, v in feas.items()},
            "best_hits_rel_with_area_le_0.60": best_hits, "best_area_rel_with_hits_ge_0.90": best_area,
            "curves": curves,
            "missed": {"count": int(missed.sum()), "kept": int(kept.sum()), "false_alarm_points": int(fa.sum()),
                       "missed_dates": len(by_date), "missed_by_date_top": sorted(by_date.items(), key=lambda t: -t[1])[:10],
                       "missed_by_month": dict(sorted(months.items())),
                       "share_missed_on_top3_dates": float(sum(sorted(by_date.values(), reverse=True)[:3]) / max(missed.sum(), 1)),
                       "max_abs_auc_minus_half_missed_vs_false_alarm": float(abs(sep[0]["auc_missed_vs_false_alarm"] - 0.5)) if sep else None,
                       "top_predictors_missed_vs_false_alarm": sep[:8]}}
    (out_dir / f"analysis-{tag}.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for ax, r in zip(axes, (FL, "west")):
        for m, col in (("uncorrected", "#636363"), ("two_stage", "#d95f02")):
            cv = res["regions"][r]["curves"][m]
            pts = [(c["area_rel"], c["hits_rel"]) for c in cv if c["area_rel"] is not None and c["hits_rel"] is not None]
            if pts:
                ax.plot(*zip(*pts), "-", color=col, label=m.replace("_", " "))
            c5 = [c for c in cv if abs(c["threshold"] - 0.05) < 1e-9][0]
            if c5["area_rel"] is not None and c5["hits_rel"] is not None:
                ax.plot(c5["area_rel"], c5["hits_rel"], "o", color=col)
        ax.axvline(0.60, color="k", ls=":", lw=0.8); ax.axhline(0.90, color="k", ls=":", lw=0.8)
        ax.fill_between([0, 0.60], 0.90, 1.6, color="#1b9e77", alpha=0.12, label="target region")
        ax.set_xlim(0, 1.6); ax.set_ylim(0, 1.6)
        ax.set_xlabel("False-alarm area on no-report days (relative to uncorrected at 5%)")
        ax.set_ylabel("Report points captured (relative to uncorrected at 5%)")
        ax.set_title(f"{r}: threshold swept 0.3%-50%; dots = 5%", fontsize=9)
        ax.legend(fontsize=8, loc="lower right")
    fig.suptitle(f"{tag}: held-out development predictions (whole months unseen by both stages), Day 2 wind", fontsize=10)
    fig.tight_layout(rect=(0, 0, 1, 0.94)); fig.savefig(out_dir / f"tradeoff-{tag}.png", dpi=110); plt.close(fig)


# ---------------------------------------------------------------- freeze and verify
def freeze(a):
    o = oof_predictions(a)
    fitted, _ = check_frozen(a.models, a.manifest)
    cases, _, _, coords, names, _ = load(a.conus)
    ck = coords[fitted["keep"]]
    W = np.column_stack([blend_weights(ck)[r][o["p"]] for r in STAGE2_REGIONS])
    F = o["x"][:, feature_index(names)]
    folds = np.array([S.fold_of(c) for c in o["fit_cases"]])[o["d"]]
    out = {}
    for m in a.candidates:
        s2 = Stage2().fit(o["oof_logit"][m], F, W, o["y"], folds)
        out[m] = s2.to_dict()
    doc = {"status": "frozen_stage2", "frozen_stage1_sha256": o["sha"], "fit_dates": o["fit_cases"],
           "rule": "docs/severe-phase2-criteria.md section 8", "stage2": out}
    a.output.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(doc, indent=1, default=float).encode()
    (a.output / "stage2.json").write_bytes(raw)
    (a.output / "stage2.sha256").write_text(hashlib.sha256(raw).hexdigest() + "\n")
    print(hashlib.sha256(raw).hexdigest())


def verify(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    raw = a.stage2.read_bytes()
    if hashlib.sha256(raw).hexdigest() != a.stage2_sha.read_text().strip():
        raise ValueError("Stage-2 file does not match its committed hash")
    doc = json.loads(raw)
    if doc["frozen_stage1_sha256"] != sha:
        raise ValueError("Stage 2 was fit for a different stage 1")
    sealed = json.loads(a.request.read_text())["cases"]
    baseline = json.loads(a.baseline.read_text())
    cases, X, Y, coords, names, _ = load(a.conus)
    if sorted(cases) != sorted(sealed):
        print(f"::warning::missing: {sorted(set(sealed) - set(cases))}")
    if any(not c.startswith("2021") for c in cases):
        raise ValueError("Verification is the sealed 2021 list only")
    keep = fitted["keep"]
    ck = coords[keep]
    preds = predict(fitted, baseline, X[:, DAY - 1][:, keep], DAY, PRODUCT)
    e, _ = S.engineer(X[:, DAY - 1][:, keep], names, fitted["scales"][DAY])
    yk = Y[:, DAY - 1][:, keep][..., HAZ]
    known = yk != 255
    d, p = np.nonzero(known)
    y = yk[known].astype(float)
    W = np.column_stack([blend_weights(ck)[r][p] for r in STAGE2_REGIONS])
    F = e[d, p][:, feature_index(names)]
    reg_row = region_index(None, regions(coords), keep)[p]
    clim = json.loads(a.study_scorecard.read_text())["products"][PRODUCT]["all_supported"]["climatology_rate"]
    results = {}
    for m in doc["stage2"]:
        p1 = np.clip(preds[m][known], EPS, 1 - EPS)
        p2 = expit(Stage2.from_dict(doc["stage2"][m]).logit(logit(p1), F, W))
        r = evaluate(y, p1, p2, d, reg_row, len(cases), clim, np.random.default_rng(20261121))
        r["boundary_steps"] = boundary_steps(ck[p], p1, p2)
        results[m] = r
        draw(a.output, f"verify-{m}", cases, ck, y, p1, p2, d, p, reg_row)
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "verification.json").write_text(json.dumps(
        {"rule": "docs/severe-phase2-criteria.md section 8", "dates": cases, "frozen_stage1_sha256": sha,
         "stage2_sha256": a.stage2_sha.read_text().strip(), "protected_2025_outcomes_accessed": False,
         "results": results}, indent=1, default=float) + "\n")


# ---------------------------------------------------------------- maps
def draw(out, tag, cases, ck, y, p1, p2, d, p, reg_row):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    from phase2_maps import CMAP, COLORS, LEVELS, NORM, draw_states, states
    rings = states()
    n = len(ck)
    fl = reg_row == REGIONS.index(FL)
    rep_fl = set(np.unique(d[fl & (y == 1)]).tolist())
    area = {i: int((fl & (d == i) & (p1 >= 0.05)).sum()) for i in range(len(cases)) if i not in rep_fl}
    picks = []
    if area:
        picks.append(("florida-no-report", max(area, key=area.get)))
    if rep_fl:
        picks.append(("florida-report", max(rep_fl, key=lambda i: int((fl & (d == i) & (y == 1)).sum()))))
    W = blend_weights(ck)
    fig, ax = plt.subplots(figsize=(9, 5.2))
    ax.scatter(ck[:, 0], ck[:, 1], c=np.maximum(W[FL], W["west"]), cmap="Purples", s=1.2, marker="s", lw=0, vmin=0, vmax=1)
    draw_states(ax, rings)
    ax.set_xlim(-126, -66); ax.set_ylim(24, 50); ax.set_aspect(1 / np.cos(np.radians(37)))
    ax.set_xticks([]); ax.set_yticks([])
    ax.set_title("Stage-2 weight (0 = stage 1 unchanged, 1 = full regional terms); 150 km blend at each boundary", fontsize=9)
    fig.tight_layout(); fig.savefig(out / f"{tag}-weights.png", dpi=105); plt.close(fig)
    for kind, i in picks:
        w = future_window(cases[i], DAY)
        fig, axes = plt.subplots(1, 2, figsize=(14, 5.2))
        for ax, (lab, pr) in zip(axes, (("stage 1 (uncorrected)", p1), ("two-stage", p2))):
            grid = np.full(n, np.nan)
            s = d == i
            grid[p[s]] = pr[s]
            ok = np.isfinite(grid)
            ax.scatter(ck[ok, 0], ck[ok, 1], c=grid[ok], cmap=CMAP, norm=NORM, s=1.4, marker="s", lw=0)
            ev = np.zeros(n, bool)
            ev[p[s & (y == 1)]] = True
            ax.scatter(ck[ev, 0], ck[ev, 1], s=1.2, c="#08306b", marker=".", lw=0)
            draw_states(ax, rings)
            ax.plot([-90, -90, -75], [24, 30, 30], "k:", lw=0.8)
            ax.plot([-104, -104], [24, 50], "k:", lw=0.8)
            ax.set_xlim(-126, -66); ax.set_ylim(24, 50); ax.set_aspect(1 / np.cos(np.radians(37)))
            ax.set_xticks([]); ax.set_yticks([])
            a5 = int((fl & s & (pr >= 0.05)).sum() * SAMPLE_KM2)
            ax.set_title(f"{lab}: FL/Gulf area >=5% {a5:,} km^2; {int(ev.sum())} report points", fontsize=9)
        fig.suptitle(f"{tag} ({kind}): 12Z HRRR of {cases[i]}, valid {w['valid_start'][:16]}Z to {w['valid_end'][:16]}Z. "
                     "Day 2 thunderstorm wind within 25 miles. Dotted = region boundaries. Research only.", fontsize=9.5)
        fig.legend(handles=[Patch(color=c, label=f"{lo:.0%}-{hi:.0%}") for c, lo, hi in zip(COLORS, LEVELS, LEVELS[1:])],
                   loc="lower center", ncol=7, fontsize=8, frameon=False)
        fig.tight_layout(rect=(0, 0.05, 1, 0.93))
        fig.savefig(out / f"{tag}-{kind}-{cases[i]}.png", dpi=105)
        plt.close(fig)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("gate", "freeze", "verify"):
        s = sub.add_parser(name)
        s.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
        s.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
        s.add_argument("--conus", type=Path, required=True)
        s.add_argument("--output", type=Path, required=True)
        s.add_argument("--expected-fit-dates", type=int, default=96)
    sub.choices["gate"].add_argument("--candidate", choices=("conus_logistic", "conus_gbt"), required=True)
    sub.choices["gate"].add_argument("--analyze", type=Path, help="Committed gate JSON: regenerate it exactly, then run the trade-off/missed-setup analysis")
    sub.choices["freeze"].add_argument("--candidates", nargs="+", required=True)
    v = sub.choices["verify"]
    v.add_argument("--stage2", type=Path, default=Path("research/severe/conus-v1/twostage-frozen/stage2.json"))
    v.add_argument("--stage2-sha", type=Path, default=Path("research/severe/conus-v1/twostage-frozen/stage2.sha256"))
    v.add_argument("--request", type=Path, default=Path("research/severe/conus-v1/twostage-verification-2021.json"))
    v.add_argument("--baseline", type=Path, default=Path("research/severe/baseline-v07/models.json"))
    v.add_argument("--study-scorecard", type=Path, default=Path("research/severe/conus-v1/study/scorecard.json"))
    a = p.parse_args()
    {"gate": gate, "freeze": freeze, "verify": verify}[a.cmd](a)


if __name__ == "__main__":
    main()
