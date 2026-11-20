#!/usr/bin/env python3
"""Downburst predictor experiment, Day 2 wind (criterion 9 of docs/severe-phase2-criteria.md).

One run per candidate, on the 96 2022-23 development dates only:
  1. Regenerate the criterion-8 nested predictions (6 month-grouped outer folds, whole months held
     out from both stages) and check they reproduce the committed criterion-8 gate.
  2. Screening (decided before any stage-2 fit with the new features): missed hits vs false alarms
     in the West monsoon and Florida/Gulf summer regimes, AUC per meteorological feature.
  3. Only if screening passes: the same nested gate with the 14 meteorological features as stage-2
     predictors, regime reporting, drop-one-group ablations, and the population sensitivity gate.

Research only; original labels decide; 2021, 2024 and 2025 are never loaded.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.special import expit

import phase2_study as S
import conus_twostage as T
from conus_calibration import FL, REGIONS, auc, check_frozen, region_index
from conus_followup import SAMPLE_KM2
from conus_study import load, regions
from extract import digest

MET = ("wind10_max", "wind10_nearby_max", "gust_max", "gust_nearby_max", "downdraft_max",
       "downdraft_nearby_max", "dd2m_max", "lapse_700_500_max", "dd700_mean", "pwat_max",
       "maxref1km_max", "maxref1km_nearby_max", "ltng_max", "ltng_nearby_max")
GROUPS = {"wind": ("wind10_max", "wind10_nearby_max"), "gust": ("gust_max", "gust_nearby_max"),
          "downdraft": ("downdraft_max", "downdraft_nearby_max"), "dryness": ("dd2m_max", "dd700_mean"),
          "lapse": ("lapse_700_500_max",), "pwat": ("pwat_max",),
          "reflectivity": ("maxref1km_max", "maxref1km_nearby_max"), "lightning": ("ltng_max", "ltng_nearby_max")}
REGIMES = {"west_monsoon": ("west", (7, 8, 9)), "florida_spring": (FL, (3, 4, 5)), "florida_summer": (FL, (6, 7, 8))}
DECIDING = ("west_monsoon", "florida_summer")
SCREEN_MARGIN = 0.15
RADIUS_KM = 40.2336


# ---------------------------------------------------------------- inputs
def load_downburst(root, cases, coords):
    out = []
    for c in cases:
        meta = json.loads((Path(root) / c / "downburst-case.json").read_text())
        path = Path(root) / c / meta["artifact"]["file"]
        if meta["case"] != c or digest(path) != meta["artifact"]["sha256"]:
            raise ValueError(f"{c}: downburst artifact hash mismatch")
        with np.load(path, allow_pickle=False) as d:
            if d["feature_names"].tolist() != list(MET):
                raise ValueError(f"{c}: feature order differs from the locked list")
            if not np.array_equal(d["coordinates"], coords):
                raise ValueError(f"{c}: downburst grid differs from the CONUS grid")
            out.append(d["features"].astype(np.float64))
    return np.stack(out)


def population(census, pin, coords):
    """log1p of 2020 Census tract population with tract center within 25 miles of each sample."""
    from sklearn.neighbors import BallTree
    want = json.loads(Path(pin).read_text())["sha256"]
    if digest(census) != want:
        raise ValueError("Census file differs from its pin")
    import csv
    with open(census, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    lat = np.array([float(r["LATITUDE"]) for r in rows])
    lon = np.array([float(r["LONGITUDE"]) for r in rows])
    pop = np.array([float(r["POPULATION"]) for r in rows])
    tree = BallTree(np.radians(np.column_stack((lat, lon))), metric="haversine")
    idx = tree.query_radius(np.radians(coords[:, ::-1]), r=RADIUS_KM / 6371.0088)
    return np.log1p(np.array([pop[i].sum() for i in idx])), {"tracts": len(rows), "total_population": float(pop.sum())}


# ---------------------------------------------------------------- feature transform (fit on training rows only)
class Asinh:
    def __init__(self, F, rows):
        a = np.abs(F[rows])
        self.s = np.array([np.median(a[:, j][a[:, j] > 0]) if (a[:, j] > 0).any() else 1.0 for j in range(F.shape[1])])

    def __call__(self, F):
        return np.arcsinh(F / self.s)


# ---------------------------------------------------------------- reporting
def regime_rows(r, months, reg_row, month_row):
    return (reg_row == REGIONS.index(r)) & np.isin(month_row, months)


def regime_summary(y, p1, preds, d, rows, dates_n):
    rep = np.zeros(dates_n, bool)
    rep[np.unique(d[rows & (y == 1)])] = True
    present = np.zeros(dates_n, bool)
    present[np.unique(d[rows])] = True
    nr_days = int((present & ~rep).sum())
    nr = rows & ~rep[d]
    h1 = int((rows & (y == 1) & (p1 >= 0.05)).sum())
    a1 = (nr & (p1 >= 0.05)).sum() * SAMPLE_KM2 / max(nr_days, 1)
    out = {"report_dates": int((present & rep).sum()), "no_report_dates": nr_days,
           "event_points": int((rows & (y == 1)).sum()),
           "uncorrected": {"hits_ge_5pct": h1, "false_alarm_km2_per_no_report_day": float(a1)}}
    for k, p in preds.items():
        h = int((rows & (y == 1) & (p >= 0.05)).sum())
        a = (nr & (p >= 0.05)).sum() * SAMPLE_KM2 / max(nr_days, 1)
        out[k] = {"hits_ge_5pct": h, "hits_retained": h / h1 if h1 else None,
                  "false_alarm_km2_per_no_report_day": float(a), "false_alarm_ratio": float(a / a1) if a1 else None,
                  "recovered_of_old_misses": None}
    return out


def screen(y, p1, p2, d, reg_row, month_row, dates_n, met, pop):
    res = {"rule": f"continue only if {' and '.join(DECIDING)} each have a meteorological feature with |AUC-0.5| >= {SCREEN_MARGIN}",
           "regimes": {}}
    for name, (r, months) in REGIMES.items():
        rows = regime_rows(r, months, reg_row, month_row)
        rep = np.zeros(dates_n, bool)
        rep[np.unique(d[rows & (y == 1)])] = True
        missed = rows & (y == 1) & (p1 >= 0.05) & (p2 < 0.05)
        fa = rows & ~rep[d] & (p1 >= 0.05)
        lab = np.r_[np.ones(missed.sum()), np.zeros(fa.sum())]
        feats = []
        for j, n in enumerate(MET):
            a = auc(np.r_[met[missed, j], met[fa, j]], lab)
            feats.append({"feature": n, "auc_missed_vs_false_alarm": a, "abs_minus_half": abs(a - 0.5) if a is not None else None})
        feats.sort(key=lambda f: -(f["abs_minus_half"] or 0))
        pa = auc(np.r_[pop[missed], pop[fa]], lab)
        best = feats[0]["abs_minus_half"]
        res["regimes"][name] = {"region": r, "months": list(months), "missed_points": int(missed.sum()),
                                "missed_dates": int(len(np.unique(d[missed]))), "false_alarm_points": int(fa.sum()),
                                "false_alarm_dates": int(len(np.unique(d[fa]))), "features": feats,
                                "best_abs_auc_minus_half": best,
                                "population_auc_reported_not_deciding": pa,
                                "deciding": name in DECIDING,
                                "passes": bool(best is not None and best >= SCREEN_MARGIN)}
    res["pass"] = all(res["regimes"][n]["passes"] for n in DECIDING)
    return res


# ---------------------------------------------------------------- main
def run(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    cases, X, Y, coords, names, _ = load(a.conus)
    if any(not c.startswith(("2022", "2023")) for c in cases) or len(cases) != 96:
        raise ValueError("The experiment uses exactly the 96 2022-23 development dates")
    keep = fitted["keep"]
    ck = coords[keep]
    DB = load_downburst(a.downburst, cases, coords)[:, keep]
    pop_k, census_info = population(a.census, a.census_pin, ck)
    e, _ = S.engineer(X[:, T.DAY - 1][:, keep], names, fitted["scales"][T.DAY])
    x, y, d, p = S.rows(e, Y[:, T.DAY - 1][:, keep], T.HAZ)
    met = DB[d, p]
    pop = pop_k[p][:, None]
    folds = np.array([S.fold_of(c) for c in cases])[d]
    month_row = np.array([int(c[5:7]) for c in cases])[d]
    W = np.column_stack([T.blend_weights(ck)[r][p] for r in T.STAGE2_REGIONS])
    F_old = x[:, T.feature_index(names)]
    reg_row = region_index(None, regions(coords), keep)[p]
    stage1 = T.stage1_logistic if a.candidate == "conus_logistic" else T.stage1_trees
    n = len(y)
    z1, z_old = np.empty(n), np.empty(n)
    fold_cache = []
    for k in range(S.FOLDS):
        test, train = folds == k, folds != k
        if not test.any():
            continue
        z_tr_oof, z_te, _ = stage1(x, y, folds, train, test)
        s2 = T.Stage2().fit(z_tr_oof, F_old[train], W[train], y[train], folds[train])
        z1[test], z_old[test] = z_te, s2.logit(z_te, F_old[test], W[test])
        fold_cache.append((k, train, test, z_tr_oof, z_te))
        print(f"{a.candidate}: regenerated fold {k}", flush=True)
    p1, p_old = expit(z1), expit(z_old)
    clim = float(y.mean())
    a.output.mkdir(parents=True, exist_ok=True)
    regen = T.evaluate(y, p1, p_old, d, reg_row, len(cases), clim, np.random.default_rng(20261120))
    committed = json.loads(a.committed_gate.read_text())
    keys = [(s, t, m) for s in ("national", FL, "west") for t in ("ge_5pct", "ge_15pct") for m in ("uncorrected", "two_stage")]
    reproduces = all(regen["hits"][s][t][m] == committed["hits"][s][t][m] for s, t, m in keys) and \
        abs(regen["national_brier"]["two_stage"] - committed["national_brier"]["two_stage"]) < 1e-9
    base = {"candidate": a.candidate, "frozen_models_sha256": sha, "dates": len(cases),
            "rule": "docs/severe-phase2-criteria.md section 9", "census": census_info,
            "reproduces_committed_criterion8_gate": bool(reproduces),
            "protected_2025_outcomes_accessed": False, "verification_2021_loaded": False}
    if not reproduces:
        (a.output / f"screen-{a.candidate}.json").write_text(json.dumps({**base, "stopped": "regenerated predictions do not reproduce criterion 8"}, indent=1) + "\n")
        raise SystemExit("Regenerated criterion-8 predictions differ from the committed gate")
    scr = screen(y, p1, p_old, d, reg_row, month_row, len(cases), met, pop[:, 0])
    (a.output / f"screen-{a.candidate}.json").write_text(json.dumps({**base, "screening": scr}, indent=1, default=float) + "\n")
    print(json.dumps({"candidate": a.candidate, "screening_pass": scr["pass"],
                      "best": {k: v["best_abs_auc_minus_half"] for k, v in scr["regimes"].items()}}), flush=True)
    if not scr["pass"]:
        return
    # ---- gate (only after screening passed)
    def nested(Fall):
        z = np.empty(n)
        info = []
        for k, train, test, z_tr_oof, z_te in fold_cache:
            act = train & (W > 0).any(axis=1)
            tf = Asinh(Fall, act)
            s2 = T.Stage2().fit(z_tr_oof, tf(Fall[train]), W[train], y[train], folds[train])
            z[test] = s2.logit(z_te, tf(Fall[test]), W[test])
            info.append({"fold": k, "stage2_penalty": s2.penalty})
        return expit(z), info

    variants = {"meteorological": met, "meteorological_plus_population": np.column_stack((met, pop))}
    for g, cols in GROUPS.items():
        variants[f"drop_{g}"] = met[:, [j for j, f in enumerate(MET) if f not in cols]]
    preds, folds_info = {}, {}
    for v, Fv in variants.items():
        preds[v], folds_info[v] = nested(Fv)
        print(f"{a.candidate}: gate variant {v} done", flush=True)
    rng_seed = 20261120
    results = {}
    for v, pv in preds.items():
        r = T.evaluate(y, p1, pv, d, reg_row, len(cases), clim, np.random.default_rng(rng_seed))
        results[v] = {k: r[k] for k in ("pass", "failed", "requirements", "hits", "florida_no_report_area", "national_brier")}
    regimes = {}
    for name, (r, months) in REGIMES.items():
        rows = regime_rows(r, months, reg_row, month_row)
        summ = regime_summary(y, p1, {"criterion8_two_stage": p_old, **preds}, d, rows, len(cases))
        old_missed = rows & (y == 1) & (p1 >= 0.05) & (p_old < 0.05)
        for v, pv in preds.items():
            summ[v]["recovered_of_old_misses"] = int((old_missed & (pv >= 0.05)).sum())
        summ["criterion8_missed_points"] = int(old_missed.sum())
        regimes[name] = summ
    primary = results["meteorological"]
    out = {**base, "screening_pass": True, "verdict": "PASS" if primary["pass"] else "FAIL",
           "deciding_variant": "meteorological", "gate": primary,
           "population_sensitivity_not_deciding": results["meteorological_plus_population"],
           "ablations_not_deciding": {k: v for k, v in results.items() if k.startswith("drop_")},
           "regimes_not_deciding": regimes, "per_fold_penalties": folds_info,
           "boundary_steps": T.boundary_steps(ck[p], p1, preds["meteorological"]),
           "may_open_2021": bool(primary["pass"])}
    (a.output / f"gate-{a.candidate}.json").write_text(json.dumps(out, indent=1, default=float) + "\n")
    T.draw(a.output, f"downburst-gate-{a.candidate}", cases, ck, y, p1, preds["meteorological"], d, p, reg_row)
    print(json.dumps({"candidate": a.candidate, "verdict": out["verdict"], "failed": primary["failed"]}))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--candidate", choices=("conus_logistic", "conus_gbt"), required=True)
    p.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
    p.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    p.add_argument("--conus", type=Path, required=True, help="2022-23 <case>/conus-case.json directories")
    p.add_argument("--downburst", type=Path, required=True, help="<case>/downburst-case.json directories")
    p.add_argument("--census", type=Path, required=True)
    p.add_argument("--census-pin", type=Path, default=Path("research/severe/conus-v1/downburst/census-pin.json"))
    p.add_argument("--committed-gate", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    run(p.parse_args())


if __name__ == "__main__":
    main()
